'use client'

import Link from 'next/link'
import type { Node } from '@xyflow/react'
import type { Project } from '@/lib/types'
import type { ForgeNodeData } from './ForgeNode'
import UserMenu from '@/components/layout/UserMenu'

type PipelinePhase = 'idle' | 'running' | 'error'

interface Props {
  project: Project
  phase: PipelinePhase
  onRefresh: () => void
  nodes?: Node[]
}

export default function ForgeToolbar({ project, phase, onRefresh, nodes = [] }: Props) {
  const approvable = nodes.filter(n => {
    if (n.type === 'forgeGroup') return false
    const d = n.data as unknown as ForgeNodeData
    return !d.comingSoon
  })
  const approvedCount = approvable.filter(n => (n.data as unknown as ForgeNodeData).approved).length
  const totalCount    = approvable.length

  return (
    <header className="forge-toolbar">
      {/* Brand */}
      <div className="brand">
        <Link href="/" style={{ display: 'flex', alignItems: 'center', gap: 8, textDecoration: 'none' }}>
          <div className="brand-mark" />
          <span className="brand-name">FORGE</span>
        </Link>
        <span className="brand-sub">AI Pipeline</span>
      </div>

      {/* Breadcrumb */}
      <Link
        href="/"
        style={{ color: 'var(--text-3)', fontSize: 11, fontFamily: 'var(--font-mono)', textDecoration: 'none', whiteSpace: 'nowrap', transition: 'color 100ms' }}
        onMouseEnter={e => (e.currentTarget.style.color = 'var(--text-1)')}
        onMouseLeave={e => (e.currentTarget.style.color = 'var(--text-3)')}
      >
        ← Projects
      </Link>
      <span style={{ color: 'var(--text-3)', fontSize: 11, fontFamily: 'var(--font-mono)' }}>/</span>
      <span style={{ color: 'var(--text-1)', fontSize: 11, fontFamily: 'var(--font-mono)', maxWidth: 180, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
        {project.name}
      </span>

      <div className="tb-divider" />

      {/* Actions */}
      <button className="tb-btn" onClick={onRefresh} title="Refresh pipeline state (R)">
        ↻ Refresh
      </button>

      <div className="tb-spacer" />

      {/* Dynamic progress */}
      <span style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color: 'var(--text-3)' }}>
        {approvedCount}/{totalCount} approved
      </span>

      <div className="tb-divider" />

      {/* Status pill — only when something is happening */}
      {phase !== 'idle' && (
        <div className={`tb-status-pill${phase === 'running' ? ' running' : ' error'}`}>
          <div className="dot" />
          <span>{phase === 'running' ? 'Running' : 'Error'}</span>
        </div>
      )}

      <div className="tb-divider" />

      <UserMenu />
    </header>
  )
}
