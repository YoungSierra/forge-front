'use client'

import { useEffect, useState, useRef, useCallback } from 'react'
import Link from 'next/link'
import type { Node } from '@xyflow/react'
import type { Project, ProjectMember } from '@/lib/types'
import type { ForgeNodeData } from './ForgeNode'
import UserMenu from '@/components/layout/UserMenu'
import ReviewBadge from '@/components/layout/ReviewBadge'
import MembersModal from '@/components/projects/MembersModal'
import PipelineSuggestionModal from './PipelineSuggestionModal'
import { useAuth } from '@/lib/auth-context'
import { getProjectMembers, BACKEND_URL } from '@/lib/api'
import { useTheme } from '@/lib/theme'

type PipelinePhase = 'idle' | 'running' | 'error'

interface Props {
  project: Project
  phase: PipelinePhase
  onRefresh: () => void
  onPipelineApply?: (activeNodes: string[]) => void
  onRunPipeline?: () => void
  onExport?: () => void
  onNameChange?: (name: string) => Promise<void>
  runProgress?: { done: number; total: number }
  nodes?: Node[]
  approvedCount?: number
  totalCount?: number
  runnableCount?: number
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

// ─── CostChip — chip de costo total del proyecto con dropdown de desglose ─────

function adminFetch(path: string) {
  const memberId = typeof window !== 'undefined' ? localStorage.getItem('forge_member_id') : null
  return fetch(`${BACKEND_URL}${path}`, {
    headers: { 'Content-Type': 'application/json', ...(memberId ? { 'x-member-id': memberId } : {}) },
  })
}

function fmtCost(v: number) {
  if (v === 0)   return '$0.00'
  if (v >= 1)    return `$${v.toFixed(2)}`
  if (v >= 0.01) return `$${v.toFixed(4)}`
  return `$${v.toFixed(5)}`
}

interface ProviderRow { key: string; label: string; calls: number; cost_usd: number }
interface CostSummary { total_cost: number; total_calls: number; llm_calls: number; image_calls: number }

function CostChip({ projectId }: { projectId: string }) {
  const [open,      setOpen]      = useState(false)
  const [summary,   setSummary]   = useState<CostSummary | null>(null)
  const [providers, setProviders] = useState<ProviderRow[]>([])
  const [loaded,    setLoaded]    = useState(false)
  const [dots,      setDots]      = useState('·')
  const ref = useRef<HTMLDivElement>(null)

  // Cicla · → ·· → ··· mientras no está cargado
  useEffect(() => {
    if (loaded) return
    const id = setInterval(() => setDots(d => d.length >= 3 ? '·' : d + '·'), 400)
    return () => clearInterval(id)
  }, [loaded])

  // Fetch del chip — reutilizable para mount, open y polling
  const fetchChip = useCallback(() => {
    adminFetch(`/api/admin/analytics/project-chip/${projectId}`)
      .then(r => r.json())
      .then(d => {
        if (d.success) {
          setSummary({ total_cost: d.total_cost, total_calls: d.total_calls, llm_calls: d.llm_calls, image_calls: d.image_calls })
          setProviders(d.providers || [])
        }
        setLoaded(true)
      })
      .catch(() => setLoaded(true))
  }, [projectId])

  // Fetch eager al montar
  useEffect(() => { fetchChip() }, [fetchChip])

  // Polling cada 30s para reflejar nuevas generaciones sin recargar
  useEffect(() => {
    const id = setInterval(fetchChip, 30_000)
    return () => clearInterval(id)
  }, [fetchChip])

  // Cerrar al hacer click fuera — capture:true para que ReactFlow no lo bloquee
  useEffect(() => {
    if (!open) return
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as globalThis.Node)) setOpen(false)
    }
    document.addEventListener('pointerdown', handler, { capture: true })
    return () => document.removeEventListener('pointerdown', handler, { capture: true })
  }, [open])

  const totalCost = summary?.total_cost ?? 0

  return (
    <div ref={ref} style={{ position: 'relative' }}>
      <button
        onClick={() => { setOpen(o => !o); fetchChip() }}
        title="Project execution cost"
        style={{
          fontSize: 10, fontFamily: 'var(--font-mono)', fontWeight: 600,
          padding: '3px 9px', borderRadius: 6,
          border: '1px solid var(--line-2)',
          background: open ? 'var(--bg-3)' : 'var(--bg-2)',
          color: totalCost > 0 ? 'var(--action)' : 'var(--text-4)',
          cursor: 'pointer', transition: 'all 120ms',
        }}
        onMouseEnter={e => (e.currentTarget.style.borderColor = 'var(--line)')}
        onMouseLeave={e => (e.currentTarget.style.borderColor = 'var(--line-2)')}
      >
        {loaded ? fmtCost(totalCost) : dots}
      </button>

      {open && (
        <div style={{
          position: 'absolute', top: 'calc(100% + 8px)', right: 0,
          width: 280, background: 'var(--bg-1)',
          border: '1px solid var(--line-2)', borderRadius: 10,
          boxShadow: '0 12px 40px rgba(0,0,0,0.45)',
          zIndex: 5000, overflow: 'hidden',
        }}>
          {/* Header */}
          <div style={{ padding: '12px 14px', borderBottom: '1px solid var(--line-2)', display: 'flex', alignItems: 'baseline', justifyContent: 'space-between' }}>
            <div>
              <div style={{ fontSize: 9, fontFamily: 'var(--font-mono)', color: 'var(--text-3)', letterSpacing: '0.06em', marginBottom: 4 }}>TOTAL COST</div>
              <div style={{ fontSize: 22, fontWeight: 700, color: 'var(--text-0)', fontFamily: 'var(--font-mono)' }}>{fmtCost(totalCost)}</div>
            </div>
            {summary && (
              <div style={{ textAlign: 'right' }}>
                <div style={{ fontSize: 10, color: 'var(--text-3)' }}>{summary.total_calls} calls</div>
                <div style={{ fontSize: 10, color: 'var(--text-4)' }}>{summary.llm_calls} LLM · {summary.image_calls} img</div>
              </div>
            )}
          </div>

          {/* Desglose por provider */}
          {providers.length > 0 && (
            <div style={{ padding: '8px 0' }}>
              {providers.map(p => (
                <div key={p.key} style={{ display: 'flex', alignItems: 'center', padding: '5px 14px', gap: 8 }}>
                  <span style={{ flex: 1, fontSize: 11, color: 'var(--text-1)', fontFamily: 'var(--font-mono)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {p.label}
                  </span>
                  <span style={{ fontSize: 10, color: 'var(--text-3)', flexShrink: 0 }}>{p.calls}×</span>
                  <span style={{ fontSize: 11, fontWeight: 600, color: 'var(--action)', fontFamily: 'var(--font-mono)', flexShrink: 0, minWidth: 52, textAlign: 'right' }}>
                    {fmtCost(p.cost_usd)}
                  </span>
                </div>
              ))}
            </div>
          )}

          {!loaded && (
            <div style={{ padding: '16px', textAlign: 'center', fontSize: 10, color: 'var(--text-4)', fontFamily: 'var(--font-mono)' }}>Loading…</div>
          )}

          {loaded && providers.length === 0 && (
            <div style={{ padding: '16px', textAlign: 'center', fontSize: 10, color: 'var(--text-4)', fontFamily: 'var(--font-mono)' }}>No executions yet</div>
          )}

          {/* Footer — link a analytics completo */}
          <div style={{ borderTop: '1px solid var(--line-2)', padding: '8px 14px' }}>
            <Link
              href={`/admin/analytics?project_id=${projectId}`}
              style={{ fontSize: 10, fontFamily: 'var(--font-mono)', color: 'var(--text-3)', textDecoration: 'none', transition: 'color 100ms' }}
              onMouseEnter={e => (e.currentTarget.style.color = 'var(--text-0)')}
              onMouseLeave={e => (e.currentTarget.style.color = 'var(--text-3)')}
            >
              View full analytics →
            </Link>
          </div>
        </div>
      )}
    </div>
  )
}

export default function ForgeToolbar({ project, phase, onRefresh, onPipelineApply, onRunPipeline, onExport, onNameChange, runProgress, nodes = [], approvedCount: approvedCountProp, totalCount: totalCountProp, runnableCount }: Props) {
  const { user, member } = useAuth()
  const { theme, toggle: toggleTheme } = useTheme()
  const [currentMemberId,       setCurrentMemberId]       = useState<string | null>(null)
  const [showPipelineModal,     setShowPipelineModal]     = useState(false)

  /* Carga el memberId del usuario actual desde localStorage (ya guardado por AuthProvider) */
  useEffect(() => {
    const stored = typeof window !== 'undefined' ? localStorage.getItem('forge_member_id') : null
    if (stored) setCurrentMemberId(stored)
  }, [user])

  const isOwner = !!currentMemberId && currentMemberId === project.owner_member_id

  const approvable    = nodes.filter(n => {
    if (n.type === 'forgeGroup') return false
    const d = n.data as unknown as ForgeNodeData
    return !d.comingSoon
  })
  const approvedCount = approvedCountProp ?? approvable.filter(n => (n.data as unknown as ForgeNodeData).approved).length
  const totalCount    = totalCountProp    ?? approvable.length
  const idleCount     = approvable.filter(n => (n.data as unknown as ForgeNodeData).status === 'idle').length
  const hasProject    = !!project.id

  return (
    <>
    <header className="forge-toolbar">
      {/* Brand */}
      <div className="brand">
        <Link href="/" className="forge-logo">
          <img src="/forgy/forgyi.png" alt="Forge" width={22} height={22} style={{ objectFit: 'contain', display: 'block' }} />
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

      {/* Botón Export — solo cuando hay nodos aprobados */}
      {hasProject && onExport && (approvedCountProp ?? 0) > 0 && (
        <button
          className="tb-btn"
          onClick={onExport}
          title="Export approved outputs to repository"
        >
          ↑ Export
        </button>
      )}

      {/* Botón Run All — oculto temporalmente */}

      <div className="tb-spacer" />

      {/* Progreso durante ejecución */}
      {phase === 'running' && runProgress && (
        <span style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color: 'var(--action)' }}>
          {runProgress.done}/{runProgress.total} nodes
        </span>
      )}

      {/* Progreso estático */}
      {phase !== 'running' && (
        <span style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color: 'var(--text-3)' }}>
          {approvedCount}/{totalCount} approved
        </span>
      )}

      {/* Chip de costo — solo admins */}
      {hasProject && member?.role === 'admin' && (
        <CostChip projectId={project.id} />
      )}

      <div className="tb-divider" />

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
