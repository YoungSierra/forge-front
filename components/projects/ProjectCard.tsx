'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import type { Project } from '@/lib/types'
import { formatDate } from '@/lib/utils'
import { loadLayout } from '@/lib/canvas-storage'
import MembersModal from './MembersModal'
import { useAuth } from '@/lib/auth-context'
import { getMemberByAuth } from '@/lib/api'

const STEP_COLORS = [
  'var(--cat-design)',
  'var(--cat-asset)',
  'var(--cat-level)',
  'var(--cat-code)',
  'var(--cat-audio)',
  'var(--cat-output)',
]

const STATUS_COLOR: Record<string, string> = {
  draft:     'var(--text-3)',
  active:    'var(--cat-design)',
  completed: 'var(--cat-code)',
}

export default function ProjectCard({ project }: { project: Project }) {
  const wizStep      = project.current_wizard_step ?? 1
  const wizApproved  = project.approved_wizard_count ?? Math.max(0, wizStep - 1)
  const { user } = useAuth()
  const [showMembers, setShowMembers] = useState(false)
  const [currentMemberId, setCurrentMemberId] = useState<string | null>(null)
  const [tipVisible, setTipVisible] = useState(false)
  const [tipPos, setTipPos] = useState({ x: 0, y: 0 })

  useEffect(() => {
    if (user?.id) getMemberByAuth(user.id).then(m => setCurrentMemberId(m?.id ?? null))
  }, [user?.id])

  // Prefer server-computed node stats (from DB canvas_layout), fallback to localStorage
  const [localNodeStats, setLocalNodeStats] = useState<{ approved: number; total: number } | null>(null)

  useEffect(() => {
    if (project.node_total_count != null) return // server has it, skip localStorage
    const layout = loadLayout(project.id)
    if (!layout?.nodes?.length) return
    const approvable = layout.nodes.filter(n => {
      if (n.type === 'forgeGroup') return false
      const d = n.data as Record<string, unknown>
      return !d.comingSoon
    })
    setLocalNodeStats({
      total:    approvable.length,
      approved: approvable.filter(n => !!(n.data as Record<string, unknown>).approved).length,
    })
  }, [project.id, project.node_total_count])

  const nodeStats = project.node_total_count != null
    ? { approved: project.node_approved_count ?? 0, total: project.node_total_count }
    : localNodeStats

  // Use canvas stats when available, fall back to wizard steps
  const displayApproved = nodeStats?.approved ?? wizApproved
  const displayTotal    = nodeStats?.total    ?? 6
  // Clamp dot count to 6 for the visual bar (more dots = visual noise)
  const dotCount        = Math.min(displayTotal, 6)
  const dotApproved     = nodeStats
    ? Math.round((displayApproved / displayTotal) * dotCount)
    : wizApproved

  return (
    <>
    {showMembers && (
      <MembersModal
        projectId={project.id}
        projectName={project.name}
        ownerMemberId={project.owner_member_id}
        currentMemberId={currentMemberId}
        onClose={() => setShowMembers(false)}
      />
    )}
    <Link href={`/projects/${project.id}`} style={{ textDecoration: 'none', display: 'block' }}>
      <div style={{
        background: 'var(--bg-2)', border: '1px solid var(--line-2)',
        borderRadius: 8, padding: '14px 16px',
        transition: 'border-color 120ms, box-shadow 120ms',
        cursor: 'pointer',
      }}
        onMouseEnter={e => {
          ;(e.currentTarget as HTMLDivElement).style.borderColor = 'var(--action)'
          ;(e.currentTarget as HTMLDivElement).style.boxShadow = `0 4px 20px rgba(0,0,0,0.3)`
        }}
        onMouseLeave={e => {
          (e.currentTarget as HTMLDivElement).style.borderColor = 'var(--line-2)'
          ;(e.currentTarget as HTMLDivElement).style.boxShadow = 'none'
        }}
      >
        <div
          style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 10, marginBottom: 10 }}
          onMouseEnter={e => {
            if (!project.description) return
            const r = e.currentTarget.getBoundingClientRect()
            setTipPos({ x: r.left, y: r.bottom + 6 })
            setTipVisible(true)
          }}
          onMouseLeave={() => setTipVisible(false)}
        >
          <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-0)', lineHeight: 1.3 }}>
            {project.name}
          </span>
          <span style={{
            fontSize: 9, fontFamily: 'monospace', textTransform: 'uppercase', letterSpacing: '0.08em',
            color: STATUS_COLOR[project.status] ?? 'var(--text-3)',
            background: 'var(--bg-3)', padding: '2px 7px', borderRadius: 99,
            border: '1px solid var(--line-2)', whiteSpace: 'nowrap', flexShrink: 0,
          }}>
            {project.status}
          </span>
        </div>

        {project.description && (
          <p style={{ fontSize: 11, color: 'var(--text-3)', lineHeight: 1.5, marginBottom: 12,
            display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden',
          }}>
            {project.description}
          </p>
        )}

        <div style={{ display: 'flex', alignItems: 'center', gap: 3, marginBottom: 10 }}>
          {Array.from({ length: dotCount }).map((_, i) => {
            const done    = i < dotApproved
            const current = i === dotApproved && dotApproved < dotCount
            return (
              <div key={i} style={{
                width: current ? 14 : 6, height: 6, borderRadius: 3,
                background: done ? STEP_COLORS[i % STEP_COLORS.length]
                  : current ? STEP_COLORS[i % STEP_COLORS.length] + '88'
                  : 'var(--bg-4)',
                transition: 'all 200ms',
                boxShadow: done ? `0 0 6px ${STEP_COLORS[i % STEP_COLORS.length]}66` : 'none',
              }} />
            )
          })}
          <span style={{ marginLeft: 6, fontSize: 10, fontFamily: 'monospace', color: 'var(--text-3)' }}>
            {displayApproved}/{displayTotal}
          </span>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
          {project.genre && (
            <span style={{
              fontSize: 10, fontFamily: 'monospace', color: 'var(--cat-design)',
              background: 'color-mix(in srgb, var(--cat-design) 10%, var(--bg-1))',
              border: '1px solid color-mix(in srgb, var(--cat-design) 25%, transparent)',
              padding: '2px 8px', borderRadius: 99,
            }}>
              {project.genre}
            </span>
          )}
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginLeft: 'auto' }}>
            <button
              onClick={e => { e.preventDefault(); e.stopPropagation(); setShowMembers(true) }}
              style={{
                background: 'var(--bg-3)', border: '1px solid var(--line-2)', borderRadius: 5,
                padding: '2px 8px', fontSize: 9, fontFamily: 'monospace', color: 'var(--text-2)',
                cursor: 'pointer', textTransform: 'uppercase', letterSpacing: '0.06em',
              }}
            >
              Members
            </button>
            <span style={{ fontSize: 10, fontFamily: 'monospace', color: 'var(--text-3)' }}>
              {formatDate(project.created_at)}
            </span>
          </div>
        </div>
      </div>
    </Link>

    {tipVisible && project.description && (
      <div style={{
        position: 'fixed', left: tipPos.x, top: tipPos.y, zIndex: 9999,
        maxWidth: 300, background: 'var(--bg-3)', border: '1px solid var(--line)',
        borderRadius: 6, padding: '8px 12px',
        fontSize: 11, color: 'var(--text-2)', lineHeight: 1.6,
        fontFamily: 'var(--font-mono)', pointerEvents: 'none',
        boxShadow: '0 4px 20px rgba(0,0,0,0.45)',
      }}>
        {project.description}
      </div>
    )}
    </>
  )
}
