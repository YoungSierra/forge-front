'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { getProjects } from '@/lib/api'
import type { Project } from '@/lib/types'
import ProjectCard from './ProjectCard'
import { useAuth } from '@/lib/auth-context'

export default function ProjectsList() {
  const [projects, setProjects] = useState<Project[]>([])
  const [loading, setLoading]   = useState(true)
  const [error, setError]       = useState<string | null>(null)
  const { user } = useAuth()

  useEffect(() => {
    if (user === undefined) return
    getProjects(user?.id)
      .then(setProjects)
      .catch(e => setError(e.message))
      .finally(() => setLoading(false))
  }, [user])

  if (loading) {
    return (
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))', gap: 12 }}>
        {[1, 2, 3].map(i => (
          <div key={i} style={{
            height: 130, borderRadius: 8, border: '1px solid var(--line)',
            background: 'var(--bg-2)', opacity: 0.5,
            animation: 'pulse 1.5s ease-in-out infinite',
          }} />
        ))}
        <style>{`@keyframes pulse { 0%,100%{opacity:.5} 50%{opacity:.3} }`}</style>
      </div>
    )
  }

  if (error) {
    return (
      <div style={{ textAlign: 'center', padding: '60px 0' }}>
        <p style={{ fontSize: 12, color: 'var(--cat-output)', fontFamily: 'monospace', marginBottom: 4 }}>
          Error loading projects
        </p>
        <p style={{ fontSize: 11, color: 'var(--text-3)', fontFamily: 'monospace' }}>{error}</p>
      </div>
    )
  }

  if (projects.length === 0) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: '80px 0', gap: 16, textAlign: 'center' }}>
        <div style={{
          width: 48, height: 48, flexShrink: 0,
          background: 'conic-gradient(from 45deg, var(--cat-asset), var(--cat-code), var(--cat-audio), var(--cat-gate), var(--cat-asset))',
          clipPath: 'polygon(50% 0, 100% 50%, 50% 100%, 0 50%)',
          opacity: 0.4,
        }} />
        <div>
          <p style={{ fontSize: 14, fontWeight: 600, color: 'var(--text-1)', marginBottom: 4 }}>No projects yet</p>
          <p style={{ fontSize: 12, color: 'var(--text-3)', fontFamily: 'monospace' }}>Start your first prototype</p>
        </div>
        <Link href="/projects/new" style={{
          display: 'inline-flex', alignItems: 'center', gap: 6,
          height: 32, padding: '0 16px',
          background: 'var(--cat-code)', color: '#0a0a0c',
          borderRadius: 5, fontSize: 12, fontWeight: 600, textDecoration: 'none',
        }}>
          + New game
        </Link>
      </div>
    )
  }

  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))', gap: 12 }}>
      {projects.map(p => <ProjectCard key={p.id} project={p} />)}
    </div>
  )
}
