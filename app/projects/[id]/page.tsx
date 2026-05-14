'use client'

import { useEffect, useState, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import { getProject } from '@/lib/api'
import type { Project } from '@/lib/types'
import PipelineCanvas from '@/components/pipeline/PipelineCanvas'

interface PageProps {
  params: Promise<{ id: string }>
}

export default function ProjectPage({ params }: PageProps) {
  const router = useRouter()
  const [id, setId]           = useState<string | null>(null)
  const [project, setProject] = useState<Project | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError]     = useState<string | null>(null)

  useEffect(() => { params.then(({ id }) => setId(id)) }, [params])

  const load = useCallback(async () => {
    if (!id) return
    setLoading(true)
    try {
      setProject(await getProject(id))
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load project')
    } finally {
      setLoading(false)
    }
  }, [id])

  useEffect(() => { load() }, [load])

  if (loading && !project) {
    return (
      <div style={{
        position: 'fixed', inset: 0,
        background: 'var(--bg-0)',
        display: 'flex', flexDirection: 'column',
        alignItems: 'center', justifyContent: 'center', gap: 14,
      }}>
        <svg width="32" height="32" viewBox="0 0 32 32" style={{ animation: 'spin 2s linear infinite', flexShrink: 0 }}>
          <path d="M16 4 L26 14 L26 22 L20 28 L12 28 L6 22 L6 14 Z" fill="#ff8a3d" stroke="#1a0d04" strokeWidth="0.5"/>
          <path d="M16 10 L22 16 L22 21 L18 25 L14 25 L10 21 L10 16 Z" fill="#ffe7d4" opacity="0.85"/>
        </svg>
        <span style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--text-3)', textTransform: 'uppercase', letterSpacing: '0.1em' }}>
          Loading pipeline…
        </span>
        <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
      </div>
    )
  }

  if (error || !project) {
    return (
      <div style={{
        position: 'fixed', inset: 0, background: 'var(--bg-0)',
        display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 10,
      }}>
        <span style={{ color: 'var(--cat-output)', fontSize: 13 }}>{error ?? 'Project not found'}</span>
        <button
          onClick={() => router.push('/')}
          style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--text-3)', background: 'none', border: 'none', cursor: 'pointer' }}
        >
          ← back to home
        </button>
      </div>
    )
  }

  return <PipelineCanvas project={project} onRefresh={load} />
}
