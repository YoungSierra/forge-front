'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { getProjects } from '@/lib/api'
import type { Project } from '@/lib/types'
import ProjectCard from './ProjectCard'
import { useAuth } from '@/lib/auth-context'

const PAGE_SIZES = [6, 12, 18, 24]

type SortKey = 'created_desc' | 'created_asc' | 'updated_desc' | 'name_asc' | 'name_desc' | 'genre_asc' | 'progress_desc'
const SORT_OPTIONS: { value: SortKey; label: string }[] = [
  { value: 'created_desc',  label: 'Newest first' },
  { value: 'created_asc',   label: 'Oldest first' },
  { value: 'updated_desc',  label: 'Last modified' },
  { value: 'name_asc',      label: 'Name A → Z' },
  { value: 'name_desc',     label: 'Name Z → A' },
  { value: 'genre_asc',     label: 'Genre A → Z' },
  { value: 'progress_desc', label: 'Most progress' },
]

function sortProjects(list: Project[], key: SortKey): Project[] {
  return [...list].sort((a, b) => {
    switch (key) {
      case 'created_desc':  return (b.created_at ?? '').localeCompare(a.created_at ?? '')
      case 'created_asc':   return (a.created_at ?? '').localeCompare(b.created_at ?? '')
      case 'updated_desc':  return (b.updated_at ?? b.created_at ?? '').localeCompare(a.updated_at ?? a.created_at ?? '')
      case 'name_asc':      return a.name.localeCompare(b.name)
      case 'name_desc':     return b.name.localeCompare(a.name)
      case 'genre_asc':     return (a.genre ?? '').localeCompare(b.genre ?? '')
      case 'progress_desc': {
        const pa = (a.node_approved_count ?? a.approved_wizard_count ?? 0)
        const pb = (b.node_approved_count ?? b.approved_wizard_count ?? 0)
        return pb - pa
      }
    }
  })
}

export default function ProjectsList() {
  const [projects, setProjects] = useState<Project[]>([])
  const [loading, setLoading]   = useState(true)
  const [error, setError]       = useState<string | null>(null)
  const [search, setSearch]     = useState('')
  const [sortKey, setSortKey]   = useState<SortKey>('created_desc')
  const [pageSize, setPageSize] = useState(12)
  const [page, setPage]         = useState(0)
  const { user } = useAuth()

  useEffect(() => {
    if (user === undefined) return
    getProjects(user?.id)
      .then(setProjects)
      .catch(e => setError(e.message))
      .finally(() => setLoading(false))
  }, [user])

  useEffect(() => { setPage(0) }, [search, pageSize, sortKey])

  const q = search.toLowerCase()
  const filtered = sortProjects(
    projects.filter(p =>
      p.name.toLowerCase().includes(q) ||
      (p.genre ?? '').toLowerCase().includes(q) ||
      (p.description ?? '').toLowerCase().includes(q) ||
      (p.target_engine ?? '').toLowerCase().includes(q)
    ),
    sortKey,
  )
  const totalPages = Math.ceil(filtered.length / pageSize)
  const paginated  = filtered.slice(page * pageSize, (page + 1) * pageSize)

  if (loading) {
    return (
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))', gap: 12 }}>
        {[1, 2, 3].map(i => (
          <div key={i} style={{ height: 130, borderRadius: 8, border: '1px solid var(--line)', background: 'var(--bg-2)', opacity: 0.5, animation: 'pulse 1.5s ease-in-out infinite' }} />
        ))}
        <style>{`@keyframes pulse { 0%,100%{opacity:.5} 50%{opacity:.3} }`}</style>
      </div>
    )
  }

  if (error) {
    return (
      <div style={{ textAlign: 'center', padding: '60px 0' }}>
        <p style={{ fontSize: 12, color: 'var(--state-error)', fontFamily: 'monospace', marginBottom: 4 }}>Error loading projects</p>
        <p style={{ fontSize: 11, color: 'var(--text-3)', fontFamily: 'monospace' }}>{error}</p>
      </div>
    )
  }

  if (projects.length === 0) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: '80px 0', gap: 16, textAlign: 'center' }}>
        <img src="/forgy/forgyi.png" alt="Forge" width={48} height={48} style={{ objectFit: 'contain', opacity: 0.3, flexShrink: 0 }} />
        <div>
          <p style={{ fontSize: 14, fontWeight: 600, color: 'var(--text-1)', marginBottom: 4 }}>No projects yet</p>
          <p style={{ fontSize: 12, color: 'var(--text-3)', fontFamily: 'monospace' }}>Start your first prototype</p>
        </div>
        <Link href="/projects/new" style={{ display: 'inline-flex', alignItems: 'center', gap: 6, height: 32, padding: '0 16px', background: 'var(--action)', color: 'var(--action-fg)', borderRadius: 5, fontSize: 12, fontWeight: 600, textDecoration: 'none' }}>
          + New project
        </Link>
      </div>
    )
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: 'calc(100vh - 180px)' }}>

      {/* Toolbar */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 16, flexShrink: 0 }}>
        <div style={{ position: 'relative', flex: 1, maxWidth: 320 }}>
          <span style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)', fontSize: 12, color: 'var(--text-3)', pointerEvents: 'none' }}>⌕</span>
          <input
            type="text"
            placeholder="Search by name, genre, description…"
            value={search}
            onChange={e => setSearch(e.target.value)}
            style={{
              width: '100%', paddingLeft: 28, paddingRight: 10, height: 32,
              background: 'var(--bg-2)', border: '1px solid var(--line-2)', borderRadius: 6,
              fontSize: 12, color: 'var(--text-0)', fontFamily: 'var(--font-mono)',
              outline: 'none', boxSizing: 'border-box',
            }}
          />
        </div>
        <select
          value={sortKey}
          onChange={e => setSortKey(e.target.value as SortKey)}
          style={{
            background: 'var(--bg-2)', border: '1px solid var(--line-2)', borderRadius: 6,
            padding: '4px 8px', fontSize: 11, color: 'var(--text-1)', fontFamily: 'var(--font-mono)',
            cursor: 'pointer', outline: 'none',
          }}
        >
          {SORT_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
        </select>
        <span style={{ fontSize: 10, fontFamily: 'var(--font-mono)', color: 'var(--text-3)', marginLeft: 'auto' }}>
          {filtered.length} project{filtered.length !== 1 ? 's' : ''}
        </span>
        <select
          value={pageSize}
          onChange={e => setPageSize(Number(e.target.value))}
          style={{
            background: 'var(--bg-2)', border: '1px solid var(--line-2)', borderRadius: 6,
            padding: '4px 8px', fontSize: 11, color: 'var(--text-1)', fontFamily: 'var(--font-mono)',
            cursor: 'pointer', outline: 'none',
          }}
        >
          {PAGE_SIZES.map(s => <option key={s} value={s}>{s} per page</option>)}
        </select>
      </div>

      {/* Scrollable grid */}
      <div style={{ flex: 1, overflowY: 'auto', minHeight: 0 }}>
        {paginated.length === 0 ? (
          <div style={{ textAlign: 'center', padding: '60px 0' }}>
            <p style={{ fontSize: 13, color: 'var(--text-3)', fontFamily: 'var(--font-mono)' }}>No projects match "{search}"</p>
          </div>
        ) : (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))', gap: 12 }}>
            {paginated.map(p => <ProjectCard key={p.id} project={p} />)}
          </div>
        )}
      </div>

      {/* Pagination — always at bottom, outside scroll */}
      {totalPages > 1 && (
        <div style={{ flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6, paddingTop: 16, marginTop: 12, borderTop: '1px solid var(--line-2)' }}>
          <button
            onClick={() => setPage(p => Math.max(0, p - 1))}
            disabled={page === 0}
            style={{ background: 'var(--bg-2)', border: '1px solid var(--line-2)', borderRadius: 6, padding: '5px 12px', fontSize: 11, color: page === 0 ? 'var(--text-3)' : 'var(--text-1)', cursor: page === 0 ? 'default' : 'pointer', fontFamily: 'var(--font-mono)' }}
          >←</button>
          {Array.from({ length: totalPages }).map((_, i) => (
            <button
              key={i}
              onClick={() => setPage(i)}
              style={{ background: i === page ? 'var(--action)' : 'var(--bg-2)', border: '1px solid var(--line-2)', borderRadius: 6, padding: '5px 10px', fontSize: 11, color: i === page ? 'var(--action-fg)' : 'var(--text-2)', cursor: 'pointer', fontFamily: 'var(--font-mono)', fontWeight: i === page ? 600 : 400, minWidth: 32 }}
            >{i + 1}</button>
          ))}
          <button
            onClick={() => setPage(p => Math.min(totalPages - 1, p + 1))}
            disabled={page === totalPages - 1}
            style={{ background: 'var(--bg-2)', border: '1px solid var(--line-2)', borderRadius: 6, padding: '5px 12px', fontSize: 11, color: page === totalPages - 1 ? 'var(--text-3)' : 'var(--text-1)', cursor: page === totalPages - 1 ? 'default' : 'pointer', fontFamily: 'var(--font-mono)' }}
          >→</button>
        </div>
      )}
    </div>
  )
}
