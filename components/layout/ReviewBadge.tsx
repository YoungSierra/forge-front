'use client'

import { useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { useAuth } from '@/lib/auth-context'
import { getMemberByAuth, getPendingReviews } from '@/lib/api'
import type { GenerationJob } from '@/lib/types'

export default function ReviewBadge() {
  const { user } = useAuth()
  const [memberId, setMemberId] = useState<string | null>(null)
  const [jobs, setJobs] = useState<(GenerationJob & { projects: { id: string; name: string } })[]>([])
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (user?.id) getMemberByAuth(user.id).then(m => setMemberId(m?.id ?? null))
  }, [user?.id])

  useEffect(() => {
    if (!memberId) return
    // getPendingReviews(memberId).then(setJobs)
    // const interval = setInterval(() => getPendingReviews(memberId).then(setJobs), 30000)
    // return () => clearInterval(interval)
  }, [memberId])

  useEffect(() => {
    if (!open) return
    function handler(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as unknown as globalThis.Node)) setOpen(false)
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [open])

  if (!jobs.length) return null

  return (
    <div ref={ref} style={{ position: 'relative' }}>
      <button
        onClick={() => setOpen(p => !p)}
        style={{
          position: 'relative', background: 'color-mix(in oklch, var(--cat-output) 12%, var(--bg-2))',
          border: '1px solid color-mix(in oklch, var(--cat-output) 40%, transparent)',
          borderRadius: 6, padding: '4px 10px', cursor: 'pointer',
          fontFamily: 'var(--font-mono)', fontSize: 10, color: 'var(--cat-output)',
          display: 'flex', alignItems: 'center', gap: 6,
        }}
      >
        <span style={{ width: 7, height: 7, borderRadius: '50%', background: 'var(--cat-output)', display: 'inline-block', animation: 'led-pulse 1.8s ease-in-out infinite' }} />
        {jobs.length} review{jobs.length > 1 ? 's' : ''} pending
      </button>
      {open && (
        <div style={{
          position: 'absolute', top: 'calc(100% + 6px)', right: 0, zIndex: 100,
          background: 'var(--bg-1)', border: '1px solid var(--line-2)', borderRadius: 8,
          minWidth: 220, boxShadow: '0 8px 24px rgba(0,0,0,0.35)',
          overflow: 'hidden',
        }}>
          <div style={{ fontFamily: 'var(--font-mono)', fontSize: 9, color: 'var(--text-3)', textTransform: 'uppercase', letterSpacing: '0.08em', padding: '8px 12px 4px' }}>
            Pending reviews
          </div>
          {jobs.map(j => (
            <Link
              key={j.id}
              href={`/projects/${j.project_id}`}
              onClick={() => setOpen(false)}
              style={{ display: 'block', padding: '7px 12px', textDecoration: 'none', borderTop: '1px solid var(--line-2)' }}
            >
              <div style={{ fontSize: 11, color: 'var(--text-0)', fontWeight: 600 }}>{j.projects?.name ?? j.project_id}</div>
              <div style={{ fontSize: 10, color: 'var(--cat-gate)', fontFamily: 'var(--font-mono)' }}>{j.current_step}</div>
            </Link>
          ))}
        </div>
      )}
    </div>
  )
}
