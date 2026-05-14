'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import type { Node } from '@xyflow/react'
import type { Project, ProjectMember } from '@/lib/types'
import type { ForgeNodeData } from './ForgeNode'
import UserMenu from '@/components/layout/UserMenu'
import ReviewBadge from '@/components/layout/ReviewBadge'
import MembersModal from '@/components/projects/MembersModal'
import PipelineSuggestionModal from './PipelineSuggestionModal'
import { useAuth } from '@/lib/auth-context'
import { getProjectMembers } from '@/lib/api'
import { useTheme } from '@/lib/theme'

type PipelinePhase = 'idle' | 'running' | 'error'

interface Props {
  project: Project
  phase: PipelinePhase
  onRefresh: () => void
  onPipelineApply?: (activeNodes: string[]) => void
  onRunPipeline?: () => void
  runProgress?: { done: number; total: number }
  nodes?: Node[]
}

/* Avatar individual — usa inicial si no hay imagen */
function Avatar({ name, url, size = 24 }: { name: string; url?: string; size?: number }) {
  if (url) {
    return (
      <img
        src={url} alt={name}
        style={{ width: size, height: size, borderRadius: '50%', objectFit: 'cover', border: '2px solid var(--bg-1)', flexShrink: 0 }}
      />
    )
  }
  return (
    <div style={{
      width: size, height: size, borderRadius: '50%', flexShrink: 0,
      background: 'var(--bg-4)', border: '2px solid var(--bg-1)',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      fontSize: size * 0.38, fontWeight: 700, color: 'var(--text-2)',
    }}>
      {name.charAt(0).toUpperCase()}
    </div>
  )
}

/* Stack de avatares + botón que abre el modal */
function MembersButton({ project, currentMemberId }: { project: Project; currentMemberId: string | null }) {
  const [members, setMembers]     = useState<ProjectMember[]>([])
  const [showModal, setShowModal] = useState(false)

  function loadMembers() {
    getProjectMembers(project.id).then(setMembers).catch(() => {})
  }

  useEffect(() => { loadMembers() }, [project.id])

  const visible  = members.slice(0, 3)
  const overflow = members.length - visible.length

  return (
    <>
      <button
        onClick={() => setShowModal(true)}
        title="Ver equipo del proyecto"
        style={{
          display: 'flex', alignItems: 'center', gap: 4,
          background: 'none', border: '1px solid var(--line-2)',
          borderRadius: 99, padding: '3px 10px 3px 4px',
          cursor: 'pointer', transition: 'border-color 100ms',
        }}
        onMouseEnter={e => (e.currentTarget.style.borderColor = 'var(--line)')}
        onMouseLeave={e => (e.currentTarget.style.borderColor = 'var(--line-2)')}
      >
        {/* Stack de avatares (superpuestos) */}
        <div style={{ display: 'flex', alignItems: 'center' }}>
          {visible.map((pm, i) => (
            <div key={pm.id} style={{ marginLeft: i === 0 ? 0 : -8, zIndex: visible.length - i }}>
              <Avatar name={pm.members.display_name} url={pm.members.avatar_url} size={22} />
            </div>
          ))}
          {overflow > 0 && (
            <div style={{
              marginLeft: -8, zIndex: 0,
              width: 22, height: 22, borderRadius: '50%',
              background: 'var(--bg-4)', border: '2px solid var(--bg-1)',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              fontSize: 8, fontWeight: 700, color: 'var(--text-3)',
              fontFamily: 'var(--font-mono)',
            }}>
              +{overflow}
            </div>
          )}
        </div>
        <span style={{ fontSize: 10, fontFamily: 'var(--font-mono)', color: 'var(--text-3)', marginLeft: 4 }}>
          {members.length} {members.length === 1 ? 'member' : 'members'}
        </span>
      </button>

      {showModal && (
        <MembersModal
          projectId={project.id}
          projectName={project.name}
          ownerMemberId={project.owner_member_id}
          currentMemberId={currentMemberId}
          onClose={() => { setShowModal(false); loadMembers() }}
        />
      )}
    </>
  )
}

export default function ForgeToolbar({ project, phase, onRefresh, onPipelineApply, onRunPipeline, runProgress, nodes = [] }: Props) {
  const { user } = useAuth()
  const { theme, toggle: toggleTheme } = useTheme()
  const [currentMemberId,       setCurrentMemberId]       = useState<string | null>(null)
  const [showPipelineModal,     setShowPipelineModal]     = useState(false)

  /* Carga el memberId del usuario actual desde localStorage (ya guardado por AuthProvider) */
  useEffect(() => {
    const stored = typeof window !== 'undefined' ? localStorage.getItem('forge_member_id') : null
    if (stored) setCurrentMemberId(stored)
  }, [user])

  const approvable    = nodes.filter(n => {
    if (n.type === 'forgeGroup') return false
    const d = n.data as unknown as ForgeNodeData
    return !d.comingSoon
  })
  const approvedCount = approvable.filter(n => (n.data as unknown as ForgeNodeData).approved).length
  const totalCount    = approvable.length
  const idleCount     = approvable.filter(n => (n.data as unknown as ForgeNodeData).status === 'idle').length
  const hasProject    = !!project.id

  return (
    <>
    <header className="forge-toolbar">
      {/* Brand */}
      <div className="brand">
        <Link href="/" className="forge-logo">
          <svg width="20" height="20" viewBox="0 0 32 32" aria-hidden="true">
            <path d="M16 4 L26 14 L26 22 L20 28 L12 28 L6 22 L6 14 Z" fill="#ff8a3d" stroke="#1a0d04" strokeWidth="0.5"/>
            <path d="M16 10 L22 16 L22 21 L18 25 L14 25 L10 21 L10 16 Z" fill="#ffe7d4" opacity="0.85"/>
          </svg>
          <span className="forge-logo-wordmark" style={{ fontSize: 14 }}>Forge</span>
        </Link>
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

      {/* Acciones */}
      <button className="tb-btn" onClick={onRefresh} title="Refresh pipeline state (R)">
        ↻ Refresh
      </button>

      {/* Botón Run All — solo cuando hay nodos idle */}
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

      {/* Progreso durante ejecución */}
      {phase === 'running' && runProgress && (
        <span style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color: 'var(--cat-code)' }}>
          {runProgress.done}/{runProgress.total} nodes
        </span>
      )}

      {/* Progreso estático */}
      {phase !== 'running' && (
        <span style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color: 'var(--text-3)' }}>
          {approvedCount}/{totalCount} approved
        </span>
      )}

      <div className="tb-divider" />

      {/* Botón de configuración del pipeline */}
      {hasProject && (
        <button
          className="tb-btn"
          onClick={() => setShowPipelineModal(true)}
          title="Configurar pipeline del proyecto"
          style={{ color: 'var(--text-2)' }}
        >
          ⚙ Pipeline
        </button>
      )}

      <div className="tb-divider" />

      {/* Stack de miembros del proyecto */}
      {hasProject && (
        <MembersButton project={project} currentMemberId={currentMemberId} />
      )}

      <div className="tb-divider" />

      {/* Pill de estado */}
      {phase !== 'idle' && (
        <div className={`tb-status-pill${phase === 'running' ? ' running' : ' error'}`}>
          <div className="dot" />
          <span>{phase === 'running' ? 'Running' : 'Error'}</span>
        </div>
      )}

      <ReviewBadge />

      <div className="tb-divider" />

      {/* Theme toggle — brand v0.1 */}
      <div className="theme-toggle" role="group" aria-label="Theme">
        <button
          type="button"
          className={theme === 'dark' ? 'is-active' : ''}
          onClick={() => theme !== 'dark' && toggleTheme()}
          title="Dark mode"
        >
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/>
          </svg>
          Dark
        </button>
        <button
          type="button"
          className={theme === 'light' ? 'is-active' : ''}
          onClick={() => theme !== 'light' && toggleTheme()}
          title="Light mode"
        >
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M4.93 19.07l1.41-1.41M17.66 6.34l1.41-1.41"/>
          </svg>
          Light
        </button>
      </div>

      <div className="tb-divider" />

      <UserMenu />
    </header>

    {showPipelineModal && (
      <PipelineSuggestionModal
        project={project}
        onConfirm={activeNodes => { setShowPipelineModal(false); onPipelineApply?.(activeNodes) }}
        onSkip={()             => setShowPipelineModal(false)}
      />
    )}
  </>
  )
}
