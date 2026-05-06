'use client'

import Link from 'next/link'
import type { Node } from '@xyflow/react'
import type { Project } from '@/lib/types'
import type { ForgeNodeData } from './ForgeNode'
import UserMenu from '@/components/layout/UserMenu'
import ReviewBadge from '@/components/layout/ReviewBadge'

type PipelinePhase = 'idle' | 'running' | 'error'

interface Props {
  project: Project
  phase: PipelinePhase
  onRefresh: () => void
  onRunPipeline?: () => void
  runProgress?: { done: number; total: number }
  nodes?: Node[]
}

export default function ForgeToolbar({ project, phase, onRefresh, onRunPipeline, runProgress, nodes = [] }: Props) {
  const approvable = nodes.filter(n => {
    if (n.type === 'forgeGroup') return false
    const d = n.data as unknown as ForgeNodeData
    return !d.comingSoon
  })
  const approvedCount = approvable.filter(n => (n.data as unknown as ForgeNodeData).approved).length
  const totalCount    = approvable.length
  const idleCount     = approvable.filter(n => (n.data as unknown as ForgeNodeData).status === 'idle').length
  const hasProject    = !!project.id

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

      {/* Run All button — only when project exists and there are idle nodes */}
      {hasProject && onRunPipeline && idleCount > 0 && phase !== 'running' && (
        <button
          className="tb-btn"
          onClick={onRunPipeline}
          title={`Auto-generate and approve ${idleCount} idle node${idleCount !== 1 ? 's' : ''}`}
          style={{ color: 'var(--cat-code)', borderColor: 'color-mix(in oklch, var(--cat-code) 35%, transparent)' }}
        >
          ▶ Run {idleCount} idle
        </button>
      )}

      <div className="tb-spacer" />

      {/* Progress during execution */}
      {phase === 'running' && runProgress && (
        <span style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color: 'var(--cat-code)' }}>
          {runProgress.done}/{runProgress.total} nodes
        </span>
      )}

      {/* Static progress */}
      {phase !== 'running' && (
        <span style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color: 'var(--text-3)' }}>
          {approvedCount}/{totalCount} approved
        </span>
      )}

      <div className="tb-divider" />

      {/* Status pill */}
      {phase !== 'idle' && (
        <div className={`tb-status-pill${phase === 'running' ? ' running' : ' error'}`}>
          <div className="dot" />
          <span>{phase === 'running' ? 'Running' : 'Error'}</span>
        </div>
      )}

      <ReviewBadge />

      <div className="tb-divider" />

      <UserMenu />
    </header>
  )
}
