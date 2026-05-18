'use client'

import React, { useEffect, useState, useCallback, useRef, useMemo } from 'react'
import { useRouter } from 'next/navigation'
import type { Node } from '@xyflow/react'
import { getPipelineConfig, saveCanvasLayout, type PipelineContainerConfig, type PipelineNodeConfig } from '@/lib/api'
import type { Project } from '@/lib/types'
import ForgeToolbar from './ForgeToolbar'
import InspectorPanel from './InspectorPanel'
import NewProjectModal from './NewProjectModal'
import NodeRunModal from './NodeRunModal'
import type { ForgeNodeCategory } from './ForgeNode'

// ─── Types ────────────────────────────────────────────────────────────────────

type ViewMode = 'compact' | 'expanded' | 'sub'
type NodeStatus = 'idle' | 'running' | 'review' | 'done'

interface NodeState {
  status:  NodeStatus
  output:  string | null
}

// ─── Estado local inmediato — set a nivel de módulo, sin prop threading ───────
// Clave: "projectId:stepKey". Marcado al generar, limpiado al aprobar.

const _pendingReview = new Set<string>()
const _reviewSubs    = new Set<() => void>()

function markPendingReview(projectId: string, stepKey: string) {
  _pendingReview.add(`${projectId}:${stepKey}`)
  _reviewSubs.forEach(fn => fn())
}
function clearPendingReview(projectId: string, stepKey: string) {
  _pendingReview.delete(`${projectId}:${stepKey}`)
  _reviewSubs.forEach(fn => fn())
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function getNodeState(project: Project | null, stepKey: string): NodeState {
  if (!project) return { status: 'idle', output: null }

  // La aprobación en BD es definitiva — tiene prioridad sobre el set local
  const entry = (project.concept?.pipeline as Record<string, unknown> | undefined)?.[stepKey] as Record<string, unknown> | undefined
  const savedOutput = typeof entry?.output === 'string' ? entry.output : null
  if (entry?.approved === true) return { status: 'done', output: savedOutput }

  // Estado local inmediato — marcado al generar, sin esperar refresh de BD
  if (_pendingReview.has(`${project.id}:${stepKey}`)) return { status: 'review', output: savedOutput }

  // Estado persistido pendiente de revisión
  if (entry?.pending_review === true) return { status: 'review', output: savedOutput }

  // Fallback: generation_jobs para nodos del wizard anterior
  const jobs = project.generation_jobs?.filter(j => j.current_step === stepKey) ?? []
  if (!jobs.length) return { status: 'idle', output: null }
  const job = jobs[jobs.length - 1]
  if (job.status === 'approved') return { status: 'done',    output: null }
  if (job.status === 'review')   return { status: 'review',  output: null }
  if (job.status === 'running')  return { status: 'running', output: null }
  return { status: 'idle', output: null }
}

function containerStatus(project: Project | null, container: PipelineContainerConfig): NodeStatus {
  if (!container.children.length) return 'idle'
  const states = container.children.map(c => getNodeState(project, c.step_key).status)
  if (states.every(s => s === 'done'))                      return 'done'
  if (states.some(s => s === 'running'))                    return 'running'
  if (states.some(s => s === 'review'))                     return 'review'
  if (states.some(s => s === 'done'))                       return 'running'
  return 'idle'
}

function doneCount(project: Project | null, container: PipelineContainerConfig): number {
  return container.children.filter(c => getNodeState(project, c.step_key).status === 'done').length
}

// ─── Status colors ────────────────────────────────────────────────────────────

const LED: Record<NodeStatus, string> = {
  idle:    'var(--text-4)',
  running: 'var(--state-running)',
  review:  'var(--state-human)',
  done:    'var(--state-success)',
}

const BORDER: Record<NodeStatus, string> = {
  idle:    'var(--line-2)',
  running: 'var(--state-running)',
  review:  'color-mix(in srgb, var(--state-human) 50%, var(--line-2))',
  done:    'color-mix(in srgb, var(--state-success) 50%, var(--line-2))',
}

const BADGE: Record<NodeStatus, { color: string; bg: string; label: string }> = {
  idle:    { color: 'var(--text-3)',        bg: 'var(--bg-3)',                                                          label: 'Idle' },
  running: { color: 'var(--state-running)', bg: 'color-mix(in srgb, var(--state-running) 12%, transparent)',           label: 'Running' },
  review:  { color: 'var(--state-human)',   bg: 'color-mix(in srgb, var(--state-human)  12%, transparent)',            label: 'Review' },
  done:    { color: 'var(--state-success)', bg: 'color-mix(in srgb, var(--state-success) 12%, transparent)',           label: 'Done' },
}

// Paleta de colores distintos por container (cíclica)
const CONTAINER_COLORS = [
  'var(--cat-design)',  // violet
  'var(--cat-asset)',   // blue
  'var(--cat-level)',   // teal
  'var(--cat-code)',    // lime
  'var(--cat-audio)',   // yellow
  'var(--cat-output)',  // ember
  'var(--cat-gate)',    // amber
  'var(--cat-test)',    // gray
  'var(--cat-input)',   // blue-muted
]

// ─── Tooltip position ─────────────────────────────────────────────────────────

// Posiciona el tooltip de un nodo padre centrado horizontalmente sobre la card.
// preferAbove=true → intenta abrir arriba, fallback abajo si no cabe.
// preferAbove=false → intenta abrir abajo, fallback arriba si no cabe.
function calcParentTooltipPos(rect: DOMRect, w: number, h: number, preferAbove: boolean): { left: number; top: number; above: boolean } {
  if (typeof window === 'undefined') return { left: rect.left, top: rect.bottom, above: false }
  const W = window.innerWidth, H = window.innerHeight

  // Centrado horizontal sobre la card, ajustado a bordes de pantalla
  let tx = rect.left + (rect.width - w) / 2
  tx = Math.max(10, Math.min(tx, W - w - 10))

  const TOOLBAR = 44  // altura del toolbar
  const above = preferAbove
  let ty = above ? rect.top - h - 10 : rect.bottom + 10

  // Clampear sin cambiar de lado: respetar siempre la preferencia de fila
  if (above)  ty = Math.max(TOOLBAR + 4, ty)
  else        ty = Math.min(H - h - 10, ty)

  return { left: tx, top: ty, above }
}

// Posiciona un tooltip de nodo hijo cerca del cursor
function calcChildTooltipPos(x: number, y: number, w: number, h: number): { left: number; top: number } {
  if (typeof window === 'undefined') return { left: x, top: y }
  const W = window.innerWidth, H = window.innerHeight
  let tx = x + 14, ty = y - 20
  if (tx + w > W - 10) tx = x - w - 14
  if (ty + h > H - 10) ty = H - h - 10
  if (ty < 50) ty = 50
  return { left: tx, top: ty }
}

// ─── Arc de progreso circular ─────────────────────────────────────────────────

function ProgressArc({ pct, color, size = 44 }: { pct: number; color: string; size?: number }) {
  const r = (size - 8) / 2
  const circumference = 2 * Math.PI * r
  const offset = circumference * (1 - Math.max(0, Math.min(100, pct)) / 100)
  const c = size / 2
  return (
    <svg width={size} height={size} style={{ transform: 'rotate(-90deg)', display: 'block' }}>
      <circle cx={c} cy={c} r={r} fill="none" stroke="var(--bg-4)" strokeWidth={3.5} />
      {pct > 0 && (
        <circle cx={c} cy={c} r={r} fill="none" stroke={color} strokeWidth={3.5}
          strokeDasharray={`${circumference}`} strokeDashoffset={`${offset}`}
          strokeLinecap="round" style={{ transition: 'stroke-dashoffset 500ms ease' }} />
      )}
    </svg>
  )
}

// ─── Compact view — card de un container ─────────────────────────────────────

function CompactCard({
  container, project, onClick, onTooltipEnter, onTooltipLeave, color,
}: {
  container:       PipelineContainerConfig
  project:         Project | null
  onClick:         () => void
  onTooltipEnter?: (e: React.MouseEvent, c: PipelineContainerConfig) => void
  onTooltipLeave?: () => void
  color:           string
}) {
  const status = containerStatus(project, container)
  const done   = doneCount(project, container)
  const total  = container.children.length
  const pct    = total ? Math.round((done / total) * 100) : 0
  const badge  = BADGE[status]

  return (
    <div
      data-no-pan
      onClick={onClick}
      style={{
        width: 272, flexShrink: 0,
        background: 'var(--bg-2)',
        border: `1px solid ${BORDER[status]}`,
        borderRadius: 12, cursor: 'pointer', overflow: 'hidden',
        transition: 'border-color 130ms, transform 130ms, box-shadow 130ms',
      }}
      onMouseEnter={e => {
        const el = e.currentTarget as HTMLDivElement
        el.style.borderColor = color
        el.style.transform = 'translateY(-4px)'
        el.style.boxShadow = `0 0 0 1px ${color}22, 0 20px 52px rgba(0,0,0,.65)`
        onTooltipEnter?.(e, container)
      }}
      onMouseLeave={e => {
        const el = e.currentTarget as HTMLDivElement
        el.style.borderColor = BORDER[status]
        el.style.transform = 'none'
        el.style.boxShadow = 'none'
        onTooltipLeave?.()
      }}
    >
      {/* Header con banda de color tintada */}
      <div style={{
        background: `color-mix(in srgb, ${color} 13%, var(--bg-3))`,
        borderBottom: `1px solid color-mix(in srgb, ${color} 20%, var(--line-2))`,
        padding: '13px 15px 12px',
        display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between',
      }}>
        <div>
          <div style={{ fontFamily: 'var(--font-mono)', fontSize: 8, color, opacity: 0.75, marginBottom: 5, letterSpacing: '.08em', textTransform: 'uppercase' }}>
            Stage {container.order_index}
          </div>
          <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--text-0)', lineHeight: 1.2, letterSpacing: '.01em' }}>
            {container.label}
          </div>
        </div>
        <div style={{ width: 8, height: 8, borderRadius: '50%', background: LED[status], flexShrink: 0, marginTop: 3, animation: status === 'running' ? 'ledpulse 1s ease-in-out infinite' : 'none' }} />
      </div>

      {/* Body */}
      <div style={{ padding: '14px 15px 15px' }}>

        {/* Arc de progreso + badge de estado */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 13, marginBottom: 13 }}>
          <div style={{ position: 'relative', width: 58, height: 58, flexShrink: 0 }}>
            <ProgressArc pct={pct} color={color} size={58} />
            <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <span style={{ fontFamily: 'var(--font-mono)', fontSize: 11, fontWeight: 700, color: 'var(--text-2)' }}>
                {pct}%
              </span>
            </div>
          </div>
          <div>
            <div style={{ fontFamily: 'var(--font-mono)', fontSize: 11, fontWeight: 700, color: badge.color, textTransform: 'uppercase', letterSpacing: '.04em' }}>
              {badge.label}
            </div>
            <div style={{ fontFamily: 'var(--font-mono)', fontSize: 9, color: 'var(--text-4)', marginTop: 5 }}>
              {done}/{total} steps
            </div>
          </div>
        </div>

        {/* Mini dots — un dot por nodo hijo */}
        {total > 0 && (
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
            {container.children.map(node => {
              const { status: ns } = getNodeState(project, node.step_key)
              return (
                <div
                  key={node.step_key}
                  title={node.label}
                  style={{
                    width: 8, height: 8, borderRadius: '50%',
                    background: ns === 'idle' ? 'transparent' : LED[ns],
                    border: `1.5px solid ${ns === 'idle' ? 'var(--line-2)' : LED[ns]}`,
                    animation: ns === 'running' ? 'ledpulse 1s infinite' : 'none',
                    transition: 'background 200ms',
                  }}
                />
              )
            })}
          </div>
        )}
      </div>

      {/* Shimmer de progreso cuando running */}
      {status === 'running' && (
        <div style={{ height: 2, background: 'var(--bg-3)', overflow: 'hidden' }}>
          <div style={{ height: '100%', width: '55%', background: `linear-gradient(90deg, transparent, ${color}, transparent)`, animation: 'shimmer 1.8s ease-in-out infinite' }} />
        </div>
      )}
    </div>
  )
}

// ─── Connector entre cards ────────────────────────────────────────────────────

function Edge({ done }: { done: boolean }) {
  const c = done ? 'var(--state-success)' : 'var(--line-2)'
  const op = done ? 1 : 0.6
  return (
    <div style={{ display: 'flex', alignItems: 'center', width: 36, flexShrink: 0 }}>
      <div style={{ flex: 1, height: 1, background: c, opacity: op }} />
      <svg width={7} height={11} viewBox="0 0 7 11" style={{ flexShrink: 0 }}>
        <polyline points="1,1 6,5.5 1,10" fill="none" stroke={c} strokeWidth={1.5}
          strokeLinecap="round" strokeLinejoin="round" opacity={op} />
      </svg>
    </div>
  )
}

// ─── Expanded view — subcard de un nodo hijo ──────────────────────────────────

function ChildSubcard({
  node, project, onClick, onRunNode, onTooltipEnter, onTooltipLeave, color = 'var(--accent-blue)', parentIdx, locked,
}: {
  node:            PipelineNodeConfig
  project:         Project | null
  onClick:         () => void
  onRunNode?:      () => void
  onTooltipEnter?: (e: React.MouseEvent, n: PipelineNodeConfig) => void
  onTooltipLeave?: () => void
  color?:          string
  parentIdx?:      number
  locked?:         boolean
}) {
  const { status } = getNodeState(project, node.step_key)
  return (
    <div
      data-no-pan
      onClick={onClick}
      style={{
        background: 'var(--bg-3)', border: `1px solid ${BORDER[status]}`,
        borderRadius: 7, padding: '8px 10px', cursor: 'pointer',
        transition: 'border-color 120ms, background 120ms', position: 'relative',
      }}
      onMouseEnter={e => {
        const el = e.currentTarget as HTMLDivElement
        el.style.borderColor = color
        el.style.background = `color-mix(in srgb, ${color} 5%, var(--bg-3))`
        onTooltipEnter?.(e, node)
      }}
      onMouseLeave={e => {
        const el = e.currentTarget as HTMLDivElement
        el.style.borderColor = BORDER[status]
        el.style.background = 'var(--bg-3)'
        onTooltipLeave?.()
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
        <span style={{ fontFamily: 'var(--font-mono)', fontSize: 8, color, fontWeight: 700, flexShrink: 0 }}>
          {parentIdx != null ? `${parentIdx}.${node.order_index ?? ''}` : node.order_index ?? ''}
        </span>
        <span style={{ fontSize: 10, color: 'var(--text-1)', flex: 1, lineHeight: 1.3 }}>{node.label}</span>
        {/* Botón de run — detiene propagación para no abrir el inspector */}
        <button
          onClick={e => { e.stopPropagation(); if (!locked) onRunNode?.() }}
          title={locked ? 'Previous node must be approved first' : status === 'done' ? 'View / Regenerate' : 'Generate'}
          disabled={locked && status === 'idle'}
          style={{
            width: 17, height: 17, borderRadius: 4, flexShrink: 0,
            border: `1px solid ${locked && status === 'idle' ? 'var(--line-2)' : `color-mix(in srgb, ${color} 35%, transparent)`}`,
            background: locked && status === 'idle' ? 'var(--bg-4)' : `color-mix(in srgb, ${color} 12%, transparent)`,
            color: locked && status === 'idle' ? 'var(--text-4)' : color,
            cursor: locked && status === 'idle' ? 'not-allowed' : 'pointer',
            display: 'grid', placeItems: 'center', fontSize: 8,
          }}
        >
          {locked && status === 'idle' ? '⊘' : status === 'done' ? '◈' : '▶'}
        </button>
        <div style={{ width: 5, height: 5, borderRadius: '50%', background: LED[status], flexShrink: 0, animation: status === 'running' ? 'ledpulse 1s infinite' : 'none' }} />
      </div>
      {node.model_name && (
        <div style={{ fontFamily: 'var(--font-mono)', fontSize: 7.5, color: 'var(--text-3)', marginTop: 4, paddingLeft: 20 }}>
          {node.model_name}
        </div>
      )}
    </div>
  )
}

// ─── Expanded view — columna de un container ─────────────────────────────────

function ExpandedColumn({
  container, project, onNodeClick, onRunNode, onNodeTooltipEnter, onNodeTooltipLeave, color, lockedNodes,
}: {
  container:           PipelineContainerConfig
  project:             Project | null
  onNodeClick:         (node: PipelineNodeConfig) => void
  onRunNode?:          (node: PipelineNodeConfig) => void
  onNodeTooltipEnter?: (e: React.MouseEvent, n: PipelineNodeConfig) => void
  onNodeTooltipLeave?: () => void
  color:               string
  lockedNodes?:        Set<string>
}) {
  const status = containerStatus(project, container)
  const done   = doneCount(project, container)
  const total  = container.children.length

  return (
    <div style={{
      flexShrink: 0, width: 220, background: 'var(--bg-2)',
      border: `1px solid ${BORDER[status]}`,
      borderRadius: 10, display: 'flex', flexDirection: 'column',
      maxHeight: 'calc(100vh - 40px - 64px)', position: 'relative', overflow: 'hidden',
      transition: 'border-color 130ms',
    }}>
      {/* Rail */}
      <div style={{ position: 'absolute', left: 0, top: 0, bottom: 0, width: 3, borderRadius: '10px 0 0 10px', background: color, zIndex: 1 }} />

      {/* Header */}
      <div style={{ padding: '12px 12px 10px 15px', borderBottom: '1px solid var(--line)', flexShrink: 0, display: 'flex', alignItems: 'center', gap: 8 }}>
        <div style={{ flex: 1 }}>
          <div style={{ fontFamily: 'var(--font-mono)', fontSize: 8, color: 'var(--text-3)', marginBottom: 2 }}>
            #{container.order_index ?? ''}
          </div>
          <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--text-0)', letterSpacing: '.03em' }}>{container.label}</div>
        </div>
        <div style={{ width: 6, height: 6, borderRadius: '50%', background: LED[status], flexShrink: 0, animation: status === 'running' ? 'ledpulse 1s infinite' : 'none' }} />
      </div>

      {/* Children */}
      <div style={{ overflowY: 'auto', flex: 1, padding: 8, display: 'flex', flexDirection: 'column', gap: 5 }}>
        {container.children.map(node => (
          <ChildSubcard
            key={node.step_key}
            node={node}
            project={project}
            onClick={() => onNodeClick(node)}
            onRunNode={() => onRunNode?.(node)}
            onTooltipEnter={onNodeTooltipEnter}
            onTooltipLeave={onNodeTooltipLeave}
            color={color}
            parentIdx={container.order_index ?? undefined}
            locked={lockedNodes?.has(node.step_key)}
          />
        ))}
        {container.children.length === 0 && (
          <div style={{ fontSize: 10, fontFamily: 'var(--font-mono)', color: 'var(--text-4)', padding: '8px 4px' }}>No steps configured</div>
        )}
      </div>

      {/* Footer */}
      <div style={{ flexShrink: 0, padding: '8px 12px', borderTop: '1px solid var(--line)', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <span style={{ fontFamily: 'var(--font-mono)', fontSize: 8, color: 'var(--text-3)' }}>{done}/{total} done</span>
        <span style={{ fontFamily: 'var(--font-mono)', fontSize: 8, padding: '2px 6px', borderRadius: 99, color: BADGE[status].color, background: BADGE[status].bg, border: `1px solid ${BADGE[status].color}44` }}>
          {BADGE[status].label}
        </span>
      </div>
    </div>
  )
}

// ─── Subcanvas view — grid de nodos de un container ──────────────────────────

function SubcanvasGrid({
  container, project, onNodeClick, onRunNode, onNodeTooltipEnter, onNodeTooltipLeave, color, lockedNodes,
}: {
  container:           PipelineContainerConfig
  project:             Project | null
  onNodeClick:         (node: PipelineNodeConfig) => void
  onRunNode?:          (node: PipelineNodeConfig) => void
  onNodeTooltipEnter?: (e: React.MouseEvent, n: PipelineNodeConfig) => void
  onNodeTooltipLeave?: () => void
  color:               string
  lockedNodes?:        Set<string>
}) {
  return (
    <div style={{
      position: 'absolute', inset: 0,
      display: 'grid',
      gridTemplateColumns: 'repeat(auto-fill, minmax(210px, 1fr))',
      gap: 14, padding: '80px 40px 100px',
      width: '100%', maxWidth: 1100, margin: '0 auto', alignItems: 'start',
      alignContent: 'start',
    }}>
      {container.children.map(node => {
        const { status, output } = getNodeState(project, node.step_key)
        const badge = BADGE[status]
        const isLocked = !!(lockedNodes?.has(node.step_key) && status === 'idle')
        return (
          <div
            key={node.step_key}
            data-no-pan
            onClick={() => onNodeClick(node)}
            style={{
              background: 'var(--bg-2)', border: `1px solid ${BORDER[status]}`,
              borderRadius: 8, cursor: 'pointer', position: 'relative', overflow: 'hidden',
              transition: 'border-color 120ms, transform 120ms, box-shadow 120ms',
            }}
            onMouseEnter={e => {
              const el = e.currentTarget as HTMLDivElement
              el.style.borderColor = color
              el.style.transform = 'translateY(-2px)'
              el.style.boxShadow = '0 10px 28px rgba(0,0,0,.5)'
              onNodeTooltipEnter?.(e, node)
            }}
            onMouseLeave={e => {
              const el = e.currentTarget as HTMLDivElement
              el.style.borderColor = BORDER[status]
              el.style.transform = 'none'
              el.style.boxShadow = 'none'
              onNodeTooltipLeave?.()
            }}
          >
            {/* Rail */}
            <div style={{ position: 'absolute', left: 0, top: 0, bottom: 0, width: 2, borderRadius: '8px 0 0 8px', background: color, zIndex: 1 }} />

            {/* Header */}
            <div style={{ padding: '8px 10px 6px 12px', display: 'flex', alignItems: 'center', gap: 6 }}>
              <div style={{ width: 22, height: 22, borderRadius: 5, flexShrink: 0, background: 'var(--bg-3)', border: '1px solid var(--line-2)', display: 'grid', placeItems: 'center', fontFamily: 'var(--font-mono)', fontSize: 9, fontWeight: 700, color }}>
                {container.order_index}.{node.order_index}
              </div>
              <span style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-0)', lineHeight: 1.3, flex: 1 }}>{node.label}</span>
              {/* Botón de run */}
              <button
                onClick={e => { e.stopPropagation(); if (!isLocked) onRunNode?.(node) }}
                title={isLocked ? 'Previous node must be approved first' : status === 'done' ? 'View / Regenerate' : 'Generate'}
                disabled={isLocked}
                style={{
                  width: 20, height: 20, borderRadius: 5, flexShrink: 0,
                  border: `1px solid ${isLocked ? 'var(--line-2)' : `color-mix(in srgb, ${color} 40%, transparent)`}`,
                  background: isLocked ? 'var(--bg-4)' : `color-mix(in srgb, ${color} 14%, transparent)`,
                  color: isLocked ? 'var(--text-4)' : color,
                  cursor: isLocked ? 'not-allowed' : 'pointer',
                  display: 'grid', placeItems: 'center', fontSize: 9,
                }}
              >
                {isLocked ? '⊘' : status === 'done' ? '◈' : '▶'}
              </button>
            </div>

            {/* Badge */}
            <div style={{ padding: '0 10px 6px 12px' }}>
              <span style={{ fontFamily: 'var(--font-mono)', fontSize: 8, padding: '1px 6px', borderRadius: 99, color: badge.color, background: badge.bg, border: `1px solid ${badge.color}44`, display: 'inline-flex', alignItems: 'center', gap: 3 }}>
                {status === 'running' && '⟳ '}{status === 'done' && '✓ '}{badge.label}
              </span>
            </div>

            {/* Preview output */}
            <div style={{ margin: '0 10px 10px 12px', background: 'var(--bg-3)', border: '1px solid var(--line)', borderRadius: 5, padding: 8, fontFamily: 'var(--font-mono)', fontSize: 8, color: 'var(--text-3)', minHeight: 34, display: 'flex', alignItems: 'center' }}>
              {output
                ? output.slice(0, 120) + (output.length > 120 ? '…' : '')
                : 'No output yet — click ▶ to generate'}
            </div>
          </div>
        )
      })}
    </div>
  )
}


// ─── Subcanvas graph view — nodos arrastrables con edges SVG ─────────────────

const GR_NODE_W = 210, GR_NODE_H = 150, GR_COL_GAP = 80, GR_ROW_GAP = 30, GR_COLS = 3

function SubcanvasGraph({
  container, project, onNodeClick, onRunNode, onNodeTooltipEnter, onNodeTooltipLeave, color, scale,
  savedPositions, onPositionsChange, lockedNodes,
}: {
  container:            PipelineContainerConfig
  project:              Project | null
  onNodeClick:          (node: PipelineNodeConfig) => void
  onRunNode?:           (node: PipelineNodeConfig) => void
  onNodeTooltipEnter?:  (e: React.MouseEvent, n: PipelineNodeConfig) => void
  onNodeTooltipLeave?:  () => void
  color:                string
  scale:                number
  savedPositions?:      { x: number; y: number }[]
  onPositionsChange?:   (pos: { x: number; y: number }[]) => void
  lockedNodes?:         Set<string>
}) {
  const wrapRef  = useRef<HTMLDivElement>(null)
  const [positions, setPositions] = useState<{ x: number; y: number }[]>([])
  const posRef   = useRef<{ x: number; y: number }[]>([])  // ref para leer en mouseUp sin stale closure
  const dragRef  = useRef<{ idx: number; startX: number; startY: number; startPX: number; startPY: number; moved: boolean } | null>(null)
  const prevKey  = useRef('')

  // Inicializar posiciones: usa las guardadas si coinciden en cantidad, si no calcula grid centrado
  useEffect(() => {
    if (prevKey.current === container.step_key) return
    prevKey.current = container.step_key
    if (savedPositions && savedPositions.length === container.children.length) {
      setPositions(savedPositions)
      posRef.current = savedPositions
      return
    }
    const n     = container.children.length
    const cols  = Math.min(n, GR_COLS)
    const rows  = Math.ceil(n / GR_COLS)
    const gridW = cols * GR_NODE_W + (cols - 1) * GR_COL_GAP
    const gridH = rows * GR_NODE_H + (rows - 1) * GR_ROW_GAP
    const areaW = wrapRef.current?.clientWidth  || 900
    const areaH = (wrapRef.current?.clientHeight || 600) - 100
    const ox = Math.max(40, (areaW - gridW) / 2)
    const oy = Math.max(40, (areaH - gridH) / 2)
    const initial = container.children.map((_, i) => ({
      x: ox + (i % GR_COLS) * (GR_NODE_W + GR_COL_GAP),
      y: oy + Math.floor(i / GR_COLS) * (GR_NODE_H + GR_ROW_GAP),
    }))
    setPositions(initial)
    posRef.current = initial
  }, [container.step_key, container.children.length]) // eslint-disable-line react-hooks/exhaustive-deps

  // Listeners de drag a nivel de documento para no perder el tracking si el mouse sale del nodo
  useEffect(() => {
    function onMouseMove(e: MouseEvent) {
      const d = dragRef.current
      if (!d || !(e.buttons & 1)) return
      d.moved = true
      const nx = d.startPX + (e.clientX - d.startX) / scale
      const ny = d.startPY + (e.clientY - d.startY) / scale
      const next = posRef.current.map((p, j) => j === d.idx ? { x: nx, y: ny } : p)
      posRef.current = next
      setPositions(next)
    }
    function onMouseUp() {
      const d = dragRef.current
      if (!d) return
      if (!d.moved) onNodeClick(container.children[d.idx])
      else onPositionsChange?.(posRef.current)  // persiste solo al soltar
      dragRef.current = null
    }
    document.addEventListener('mousemove', onMouseMove)
    document.addEventListener('mouseup',   onMouseUp)
    return () => {
      document.removeEventListener('mousemove', onMouseMove)
      document.removeEventListener('mouseup',   onMouseUp)
    }
  }, [scale, onNodeClick, onPositionsChange, container.children])

  // Dimensiones base del canvas — los nodos pueden salir hacia posiciones negativas (overflow: visible)
  const canvasW = positions.length ? Math.max(900, ...positions.map(p => p.x + GR_NODE_W + 80)) : 900
  const canvasH = positions.length ? Math.max(600, ...positions.map(p => p.y + GR_NODE_H + 100)) : 600

  function onNodeMouseDown(e: React.MouseEvent<HTMLDivElement>, i: number) {
    if ((e.target as HTMLElement).tagName === 'BUTTON') return
    e.stopPropagation()
    e.preventDefault()
    dragRef.current = {
      idx: i, moved: false,
      startX: e.clientX, startY: e.clientY,
      startPX: positions[i]?.x ?? 0, startPY: positions[i]?.y ?? 0,
    }
  }

  return (
    <div ref={wrapRef} style={{ position: 'absolute', inset: 0, overflow: 'visible' }}>
      <div style={{ position: 'relative', width: canvasW, height: canvasH }}>

        {/* Edges SVG */}
        <svg
          style={{ position: 'absolute', inset: 0, width: canvasW, height: canvasH, pointerEvents: 'none', overflow: 'visible' }}
        >
          {positions.length > 1 && container.children.slice(0, -1).map((node, i) => {
            const from = positions[i], to = positions[i + 1]
            if (!from || !to) return null
            const { status } = getNodeState(project, node.step_key)
            const color   = status === 'done' ? 'var(--state-success)' : status === 'running' ? 'var(--state-running)' : 'var(--text-3)'
            const opacity = status === 'idle' ? 0.5 : 1
            const x1 = from.x + GR_NODE_W, y1 = from.y + GR_NODE_H / 2
            const x2 = to.x,               y2 = to.y + GR_NODE_H / 2
            const cx = Math.max(40, Math.abs(x2 - x1) * 0.45)
            return (
              <path
                key={`e-${i}`}
                d={`M${x1},${y1} C${x1 + cx},${y1} ${x2 - cx},${y2} ${x2},${y2}`}
                fill="none" stroke={color}
                strokeWidth={status === 'idle' ? 1.5 : 2}
                strokeDasharray={status === 'idle' ? '5 4' : undefined}
                opacity={opacity}
              />
            )
          })}
        </svg>

        {/* Nodos arrastrables */}
        {container.children.map((node, i) => {
          const pos = positions[i]
          if (!pos) return null
          const { status, output } = getNodeState(project, node.step_key)
          const badge = BADGE[status]
          const isLocked = !!(lockedNodes?.has(node.step_key) && status === 'idle')
          return (
            <div
              key={node.step_key}
              data-no-pan
              style={{
                position: 'absolute', left: pos.x, top: pos.y, width: GR_NODE_W,
                background: 'var(--bg-2)', border: `1px solid ${BORDER[status]}`,
                borderRadius: 8, overflow: 'visible', cursor: 'grab',
                transition: 'border-color 120ms, box-shadow 120ms',
                userSelect: 'none',
              }}
              onMouseDown={e => onNodeMouseDown(e, i)}
              onMouseEnter={e => onNodeTooltipEnter?.(e, node)}
              onMouseLeave={() => onNodeTooltipLeave?.()}
            >
              {/* Rail */}
              <div style={{ position: 'absolute', left: 0, top: 0, bottom: 0, width: 2, borderRadius: '8px 0 0 8px', background: color, zIndex: 1 }} />

              {/* Puerto entrada */}
              <div style={{ position: 'absolute', left: -6, top: '50%', transform: 'translateY(-50%)', width: 10, height: 10, borderRadius: '50%', background: 'var(--bg-2)', border: `2px solid ${color}`, zIndex: 2 }} />
              {/* Puerto salida */}
              <div style={{ position: 'absolute', right: -6, top: '50%', transform: 'translateY(-50%)', width: 10, height: 10, borderRadius: '50%', background: 'var(--bg-2)', border: `2px solid ${color}`, zIndex: 2 }} />

              {/* Header */}
              <div style={{ padding: '8px 10px 6px 12px', display: 'flex', alignItems: 'center', gap: 6 }}>
                <div style={{ width: 22, height: 22, borderRadius: 5, flexShrink: 0, background: 'var(--bg-3)', border: '1px solid var(--line-2)', display: 'grid', placeItems: 'center', fontFamily: 'var(--font-mono)', fontSize: 9, fontWeight: 700, color }}>
                  {container.order_index}.{node.order_index}
                </div>
                <span style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-0)', lineHeight: 1.3, flex: 1 }}>{node.label}</span>
                {/* Botón de run */}
                <button
                  onClick={e => { e.stopPropagation(); if (!isLocked) onRunNode?.(node) }}
                  title={isLocked ? 'Previous node must be approved first' : status === 'done' ? 'View / Regenerate' : 'Generate'}
                  disabled={isLocked}
                  style={{
                    width: 20, height: 20, borderRadius: 5, flexShrink: 0,
                    border: `1px solid ${isLocked ? 'var(--line-2)' : `color-mix(in srgb, ${color} 40%, transparent)`}`,
                    background: isLocked ? 'var(--bg-4)' : `color-mix(in srgb, ${color} 14%, transparent)`,
                    color: isLocked ? 'var(--text-4)' : color,
                    cursor: isLocked ? 'not-allowed' : 'pointer',
                    display: 'grid', placeItems: 'center', fontSize: 9,
                  }}
                >
                  {isLocked ? '⊘' : status === 'done' ? '◈' : '▶'}
                </button>
                <div style={{ width: 6, height: 6, borderRadius: '50%', background: LED[status], flexShrink: 0, animation: status === 'running' ? 'ledpulse 1s infinite' : 'none' }} />
              </div>

              {/* Badge */}
              <div style={{ padding: '0 10px 5px 12px' }}>
                <span style={{ fontFamily: 'var(--font-mono)', fontSize: 8, padding: '1px 6px', borderRadius: 99, color: badge.color, background: badge.bg, border: `1px solid ${badge.color}44`, display: 'inline-flex', alignItems: 'center', gap: 3 }}>
                  {status === 'running' && '⟳ '}{status === 'done' && '✓ '}{badge.label}
                </span>
              </div>

              {/* Modelo */}
              {node.model_name && (
                <div style={{ padding: '0 10px 3px 12px', fontFamily: 'var(--font-mono)', fontSize: 8, color: 'var(--text-3)' }}>{node.model_name}</div>
              )}

              {/* Preview */}
              <div style={{ margin: '0 10px 10px 12px', background: 'var(--bg-3)', border: '1px solid var(--line)', borderRadius: 5, padding: 8, fontFamily: 'var(--font-mono)', fontSize: 8, color: 'var(--text-3)', minHeight: 28, display: 'flex', alignItems: 'center' }}>
                {output ? output.slice(0, 80) + (output.length > 80 ? '…' : '') : 'Awaiting generation…'}
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}

// ─── Adaptador PipelineNodeConfig → React Flow Node sintético ────────────────

function toFlowNode(node: PipelineNodeConfig, project: Project | null): Node {
  const { status } = getNodeState(project, node.step_key)
  const flowStatus = status === 'done' ? 'complete' : status === 'review' ? 'review' : status === 'running' ? 'running' : 'idle'
  const catMap: Record<string, ForgeNodeCategory> = { llm: 'design', comfyui: 'asset', n8n: 'design' }
  const category: ForgeNodeCategory = catMap[node.integration_type ?? ''] ?? 'design'
  return {
    id: node.step_key,
    type: 'forgeNode',
    position: { x: 0, y: 0 },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    data: {
      label: node.label,
      stepKey: node.step_key,
      category,
      icon: (node.label ?? '--').slice(0, 2).toUpperCase(),
      num: String(node.order_index ?? 0).padStart(2, '0'),
      status: flowStatus,
      approved: status === 'done',
      comingSoon: false,
    } as unknown as Record<string, unknown>,
  }
}

// ─── Library panel izquierdo ─────────────────────────────────────────────────

function PipelineLibrary({
  containers, project, activeContainer, selectedNode, isOpen, onToggle, onEnterSub, onSelectNode,
  width = 220, onWidthChange,
}: {
  containers:      PipelineContainerConfig[]
  project:         Project | null
  activeContainer: PipelineContainerConfig | null
  selectedNode:    PipelineNodeConfig | null
  isOpen:          boolean
  onToggle:        () => void
  onEnterSub:      (c: PipelineContainerConfig) => void
  onSelectNode:    (n: PipelineNodeConfig, c: PipelineContainerConfig) => void
  width?:          number
  onWidthChange?:  (w: number) => void
}) {
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set(containers.map(c => c.step_key)))
  const dragging   = useRef(false)
  const startX     = useRef(0)
  const startW     = useRef(0)
  const handleRef  = useRef<HTMLDivElement>(null)
  const rowRefs    = useRef<Map<string, HTMLDivElement>>(new Map())
  const scrollRef  = useRef<HTMLDivElement>(null)

  function toggleSection(key: string) {
    setExpanded(prev => { const next = new Set(prev); next.has(key) ? next.delete(key) : next.add(key); return next })
  }

  // Al entrar a un container: expandirlo en el panel y hacer scroll hasta él
  useEffect(() => {
    if (!activeContainer || !isOpen) return
    setExpanded(prev => {
      if (prev.has(activeContainer.step_key)) return prev
      const next = new Set(prev)
      next.add(activeContainer.step_key)
      return next
    })
    const timer = setTimeout(() => {
      rowRefs.current.get(activeContainer.step_key)?.scrollIntoView({ behavior: 'smooth', block: 'nearest' })
    }, 60)
    return () => clearTimeout(timer)
  }, [activeContainer?.step_key, isOpen])

  const onResizeMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault()
    dragging.current = true
    startX.current   = e.clientX
    startW.current   = width
    handleRef.current?.classList.add('dragging')
  }, [width])

  useEffect(() => {
    function onMove(e: MouseEvent) {
      if (!dragging.current) return
      const next = Math.max(160, Math.min(480, startW.current + (e.clientX - startX.current)))
      onWidthChange?.(next)
    }
    function onUp() {
      if (!dragging.current) return
      dragging.current = false
      handleRef.current?.classList.remove('dragging')
    }
    document.addEventListener('mousemove', onMove)
    document.addEventListener('mouseup', onUp)
    return () => {
      document.removeEventListener('mousemove', onMove)
      document.removeEventListener('mouseup', onUp)
    }
  }, [onWidthChange])

  // Escala la fuente proporcionalmente al ancho (base 11px a 220px)
  const fontSize = isOpen ? `${Math.max(9, Math.min(17, 11 * width / 220)).toFixed(1)}px` : undefined

  if (!isOpen) {
    return (
      <div className="forge-library" onClick={onToggle} title="Open panel" style={{ cursor: 'pointer', display: 'flex', alignItems: 'flex-start', justifyContent: 'center', paddingTop: 14 }}>
        <span style={{ fontFamily: 'var(--font-mono)', fontSize: 9, color: 'var(--text-3)', writingMode: 'vertical-rl', letterSpacing: '.07em', textTransform: 'uppercase', userSelect: 'none' }}>Pipeline</span>
      </div>
    )
  }

  return (
    <div className="forge-library" style={{ display: 'flex', flexDirection: 'column', overflow: 'hidden', fontSize, position: 'relative' }}>
      {/* Handle de resize — arrastra el borde derecho */}
      <div ref={handleRef} className="lib-resize-handle" onMouseDown={onResizeMouseDown} />
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', padding: '10px 12px 9px', borderBottom: '1px solid var(--line)', flexShrink: 0, gap: 6 }}>
        <span style={{ fontFamily: 'var(--font-mono)', fontSize: '0.82em', fontWeight: 700, color: 'var(--text-2)', textTransform: 'uppercase', letterSpacing: '.08em', flex: 1 }}>Pipeline</span>
        <button onClick={onToggle} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-3)', fontSize: '1.45em', lineHeight: 1, padding: '0 2px' }}>‹</button>
      </div>

      {/* Lista de containers */}
      <div ref={scrollRef} style={{ flex: 1, overflowY: 'auto', padding: '4px 0' }}>
        {containers.map((c, idx) => {
          const cStatus  = containerStatus(project, c)
          const isActive = activeContainer?.step_key === c.step_key
          const isExp    = expanded.has(c.step_key)
          const cColor   = CONTAINER_COLORS[idx % CONTAINER_COLORS.length]
          return (
            <div key={c.step_key} ref={el => { if (el) rowRefs.current.set(c.step_key, el); else rowRefs.current.delete(c.step_key) }}>
              {/* Fila del container padre — franja de color izquierda, fondo neutro */}
              <div
                onClick={() => onEnterSub(c)}
                style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '5px 12px 5px 9px', cursor: 'pointer', borderLeft: `3px solid ${cColor}`, background: isActive ? 'var(--bg-3)' : 'transparent', transition: 'background 100ms' }}
                onMouseEnter={e => { if (!isActive) e.currentTarget.style.background = 'var(--bg-2)' }}
                onMouseLeave={e => { e.currentTarget.style.background = isActive ? 'var(--bg-3)' : 'transparent' }}
              >
                {/* Arrow — solo hace toggle de expansión sin propagar al row */}
                <span
                  onClick={e => { e.stopPropagation(); toggleSection(c.step_key) }}
                  style={{ fontFamily: 'var(--font-mono)', fontSize: '0.82em', color: 'var(--text-4)', width: '0.9em', flexShrink: 0 }}
                >{isExp ? '▾' : '▸'}</span>
                <div style={{ width: 5, height: 5, borderRadius: '50%', background: LED[cStatus], flexShrink: 0, animation: cStatus === 'running' ? 'ledpulse 1s infinite' : 'none' }} />
                <span style={{ fontFamily: 'var(--font-mono)', fontSize: '0.73em', color: 'var(--text-3)', flexShrink: 0 }}>{c.order_index}</span>
                <span style={{ fontSize: '1em', fontWeight: isActive ? 700 : 500, color: isActive ? 'var(--text-0)' : 'var(--text-1)', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{c.label}</span>
                <span style={{ fontFamily: 'var(--font-mono)', fontSize: '0.73em', color: 'var(--text-4)' }}>{doneCount(project, c)}/{c.children.length}</span>
              </div>
              {isExp && c.children.map(node => {
                const { status } = getNodeState(project, node.step_key)
                const isSel = selectedNode?.step_key === node.step_key
                return (
                  <div
                    key={node.step_key}
                    onClick={() => { onEnterSub(c); onSelectNode(node, c) }}
                    style={{ display: 'flex', alignItems: 'center', gap: 5, padding: '4px 12px 4px 25px', cursor: 'pointer', borderLeft: `3px solid ${cColor}`, background: isSel ? 'var(--bg-3)' : 'transparent', transition: 'background 100ms' }}
                    onMouseEnter={e => { if (!isSel) e.currentTarget.style.background = 'var(--bg-2)' }}
                    onMouseLeave={e => { e.currentTarget.style.background = isSel ? 'var(--bg-3)' : 'transparent' }}
                  >
                    <div style={{ width: 4, height: 4, borderRadius: '50%', background: LED[status], flexShrink: 0 }} />
                    <span style={{ fontFamily: 'var(--font-mono)', fontSize: '0.73em', color: 'var(--text-3)', flexShrink: 0 }}>{c.order_index}.{node.order_index}</span>
                    <span style={{ fontSize: '0.91em', color: isSel ? 'var(--text-0)' : 'var(--text-2)', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{node.label}</span>
                  </div>
                )
              })}
            </div>
          )
        })}
      </div>
    </div>
  )
}

// ─── Subcanvas layout — frame completo con lista de nodos a la izquierda ──────

function SubcanvasLayout({
  container, project, color, containers, lockedNodes,
  selectedNode, onSelectedNodeChange,
  onBack, onApproved, onDraftSaved, onSaveComplete, onNavigateTo,
}: {
  container:            PipelineContainerConfig
  project:              Project | null
  color:                string
  containers:           PipelineContainerConfig[]
  lockedNodes:          Set<string>
  selectedNode:         PipelineNodeConfig | null
  onSelectedNodeChange: (node: PipelineNodeConfig | null) => void
  onBack:               () => void
  onApproved:           (node: PipelineNodeConfig) => void
  onDraftSaved:         (node: PipelineNodeConfig) => void
  onSaveComplete:       () => void
  onNavigateTo:         (node: PipelineNodeConfig) => void
}) {

  const handleNavigateTo = useCallback((node: PipelineNodeConfig) => {
    if (container.children.some(c => c.step_key === node.step_key)) {
      onSelectedNodeChange(node)
    } else {
      onNavigateTo(node)
    }
  }, [container.children, onSelectedNodeChange, onNavigateTo])

  return (
    <div style={{ position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column', background: 'var(--bg-0)', zIndex: 5 }}>

      {/* Header del frame */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '0 16px', height: 46, borderBottom: '1px solid var(--line-2)', flexShrink: 0, background: 'var(--bg-1)' }}>
        <button
          onClick={onBack}
          style={{ fontFamily: 'var(--font-mono)', fontSize: 10, fontWeight: 600, color: 'var(--text-2)', background: 'var(--bg-3)', border: '1px solid var(--line-2)', borderRadius: 5, padding: '4px 10px', cursor: 'pointer' }}
        >← Back</button>
        <div style={{ width: 3, height: 16, borderRadius: 2, background: color, flexShrink: 0 }} />
        <span style={{ fontWeight: 700, fontSize: 13, color: 'var(--text-0)', flex: 1 }}>{container.label}</span>
        <span style={{ fontFamily: 'var(--font-mono)', fontSize: 9, color: 'var(--text-3)' }}>
          {doneCount(project, container)}/{container.children.length} done
        </span>
        <button
          onClick={onBack}
          style={{ width: 28, height: 28, borderRadius: 7, border: '1px solid var(--line-2)', background: 'var(--bg-3)', cursor: 'pointer', color: 'var(--text-3)', fontSize: 15, display: 'grid', placeItems: 'center' }}
          onMouseEnter={e => (e.currentTarget.style.color = 'var(--text-0)')}
          onMouseLeave={e => (e.currentTarget.style.color = 'var(--text-3)')}
        >✕</button>
      </div>

      {/* Body: lista izquierda + modal inline derecha */}
      <div style={{ flex: 1, display: 'flex', overflow: 'hidden' }}>

        {/* Panel izquierdo — lista de nodos hijos */}
        <div style={{ width: 230, flexShrink: 0, borderRight: '1px solid var(--line-2)', overflowY: 'auto', background: 'var(--bg-1)', display: 'flex', flexDirection: 'column' }}>
          {container.children.map(node => {
            const { status } = getNodeState(project, node.step_key)
            const isSelected = selectedNode?.step_key === node.step_key
            const isLocked   = lockedNodes.has(node.step_key)
            return (
              <div
                key={node.step_key}
                onClick={() => onSelectedNodeChange(node)}
                style={{
                  display: 'flex', alignItems: 'center', gap: 8,
                  padding: '11px 14px',
                  cursor: 'pointer',
                  borderBottom: '1px solid var(--line-2)',
                  borderLeft: `3px solid ${isSelected ? color : 'transparent'}`,
                  background: isSelected ? `color-mix(in srgb, ${color} 8%, var(--bg-2))` : 'transparent',
                  transition: 'background 100ms',
                }}
                onMouseEnter={e => { if (!isSelected) e.currentTarget.style.background = 'var(--bg-2)' }}
                onMouseLeave={e => { if (!isSelected) e.currentTarget.style.background = 'transparent' }}
              >
                <span style={{ fontFamily: 'var(--font-mono)', fontSize: 9, color, fontWeight: 700, flexShrink: 0, opacity: isLocked ? 0.5 : 1 }}>
                  {container.order_index}.{node.order_index}
                </span>
                <span style={{ fontSize: 12, color: isSelected ? 'var(--text-0)' : 'var(--text-2)', flex: 1, fontWeight: isSelected ? 600 : 400, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', opacity: isLocked ? 0.6 : 1 }}>
                  {node.label}
                </span>
                <span style={{
                  fontFamily: 'var(--font-mono)', fontSize: 8, flexShrink: 0,
                  padding: '2px 6px', borderRadius: 99,
                  color: BADGE[status].color,
                  background: BADGE[status].bg,
                  border: `1px solid ${BADGE[status].color}44`,
                  opacity: isLocked && status === 'idle' ? 0.5 : 1,
                }}>
                  {isLocked && status === 'idle' ? '⊘ Locked' : BADGE[status].label}
                </span>
              </div>
            )
          })}
        </div>

        {/* Área derecha — NodeRunModal en modo inline */}
        <div style={{ flex: 1, overflow: 'hidden', position: 'relative' }}>
          {selectedNode && project ? (
            <NodeRunModal
              key={selectedNode.step_key}
              node={selectedNode}
              container={container}
              containers={containers}
              project={project}
              color={color}
              inline={true}
              onClose={() => onSelectedNodeChange(null)}
              onApproved={() => {
                onApproved(selectedNode)
              }}
              onDraftSaved={() => onDraftSaved(selectedNode)}
              onSaveComplete={onSaveComplete}
              onNavigateTo={handleNavigateTo}
              isLocked={lockedNodes.has(selectedNode.step_key)}
            />
          ) : (
            <div style={{ height: '100%', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 8, color: 'var(--text-4)', fontFamily: 'var(--font-mono)', fontSize: 11 }}>
              <div style={{ fontSize: 28, opacity: 0.15 }}>◈</div>
              <div>Select a step from the left panel</div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

// ─── Main component ───────────────────────────────────────────────────────────

export default function ForgePipeline({
  project,
  onRefresh,
}: {
  project:   Project | null
  onRefresh: () => void
}) {
  const router = useRouter()
  const [containers, setContainers]           = useState<PipelineContainerConfig[]>([])
  const [loading, setLoading]                 = useState(true)
  const [newProjectOpen, setNewProjectOpen]   = useState(project === null)
  const [inspectorOpen, setInspectorOpen]     = useState(false)
  const [view, setView]                       = useState<ViewMode>('compact')
  const [activeContainer, setActiveContainer] = useState<PipelineContainerConfig | null>(null)
  const [subSelectedNode, setSubSelectedNode] = useState<PipelineNodeConfig | null>(null)
  const [runningNode, setRunningNode]         = useState<string | null>(null)
  const [libraryOpen, setLibraryOpen]         = useState(true)
  const [libraryWidth, setLibraryWidth]       = useState(220)
  const [tf, setTf]                           = useState({ x: 0, y: 0, s: 1 })
  const panRef    = useRef({ active: false, startX: 0, startY: 0, startTx: 0, startTy: 0 })
  const canvasRef = useRef<HTMLDivElement>(null)

  // Suscripción al set de nodos pendientes — fuerza re-render al marcar/desmarcar
  const [, _forceReview] = useState(0)
  useEffect(() => {
    const notify = () => _forceReview(n => n + 1)
    _reviewSubs.add(notify)
    return () => { _reviewSubs.delete(notify) }
  }, [])

  // Posiciones del grafo — leídas desde canvas_layout.graph_layouts del proyecto, guardadas en BD con debounce 3s
  const [graphPositions, setGraphPositions] = useState<Record<string, { x: number; y: number }[]>>(() => {
    const layout = project?.canvas_layout as Record<string, unknown> | undefined
    return (layout?.graph_layouts as Record<string, { x: number; y: number }[]>) ?? {}
  })
  const saveGPTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const handleGraphPositionsChange = useCallback((containerKey: string, pos: { x: number; y: number }[]) => {
    setGraphPositions(prev => {
      const next = { ...prev, [containerKey]: pos }
      if (saveGPTimer.current) clearTimeout(saveGPTimer.current)
      saveGPTimer.current = setTimeout(() => {
        if (!project) return
        const layout = (project.canvas_layout as Record<string, unknown> | undefined) ?? {}
        saveCanvasLayout(project.id, { ...layout, graph_layouts: next })
          .catch(err => console.error('[ForgePipeline] error saving graph positions:', err))
      }, 3000)
      return next
    })
  }, [project])

  // Modal de run/generación de un nodo individual
  const [runModal,        setRunModal]        = useState<PipelineNodeConfig | null>(null)
  const [runModalInitTab, setRunModalInitTab] = useState<'input' | 'output' | undefined>(undefined)
  const runModalContainer = runModal
    ? containers.find(c => c.children.some(n => n.step_key === runModal.step_key)) ?? null
    : null

  function openRunModal(node: PipelineNodeConfig, initialTab?: 'input' | 'output') {
    setRunModal(node)
    setRunModalInitTab(initialTab)
  }

  // Estado de overlays / tooltips
  const [parentTooltip, setParentTooltip] = useState<{ container: PipelineContainerConfig; rect: DOMRect; preferAbove: boolean } | null>(null)
  const [childOverlay, setChildOverlay]   = useState<{ node: PipelineNodeConfig; x: number; y: number } | null>(null)
  const hoverTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const hideTimerRef  = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    getPipelineConfig()
      .then(setContainers)
      .catch(console.error)
      .finally(() => setLoading(false))
  }, [])

  // Limpiar timers al desmontar
  useEffect(() => {
    return () => {
      if (hoverTimerRef.current) clearTimeout(hoverTimerRef.current)
      if (hideTimerRef.current)  clearTimeout(hideTimerRef.current)
      if (saveGPTimer.current)   clearTimeout(saveGPTimer.current)
    }
  }, [])

  // Expone el ancho del panel izquierdo como CSS var global para que FeedbackWidget calcule su posición
  useEffect(() => {
    const w = libraryOpen ? libraryWidth : 32
    document.documentElement.style.setProperty('--forge-library-w', `${w}px`)
    return () => { document.documentElement.style.removeProperty('--forge-library-w') }
  }, [libraryOpen, libraryWidth])

  const handleEnterSub = useCallback((container: PipelineContainerConfig) => {
    setActiveContainer(container)
    setSubSelectedNode(null)
    setView('sub')
  }, [])

  const handleGoBack = useCallback(() => {
    setView('compact')
    setActiveContainer(null)
    setSubSelectedNode(null)
    setInspectorOpen(false)
  }, [])

  const handleNodeClick = useCallback((node: PipelineNodeConfig) => {
    setSubSelectedNode(node)
  }, [])

  // Resetear viewport al cambiar de vista
  useEffect(() => { setTf({ x: 0, y: 0, s: 1 }) }, [view])

  // ── Tooltip helpers ──────────────────────────────────────────────────────────

  function showParentTooltip(e: React.MouseEvent, container: PipelineContainerConfig, preferAbove = false) {
    if (hoverTimerRef.current) clearTimeout(hoverTimerRef.current)
    if (hideTimerRef.current)  clearTimeout(hideTimerRef.current)
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect()
    hoverTimerRef.current = setTimeout(() => {
      setParentTooltip({ container, rect, preferAbove })
      setChildOverlay(null)
    }, 160)
  }

  function showChildOverlayFn(e: React.MouseEvent, node: PipelineNodeConfig) {
    if (hoverTimerRef.current) clearTimeout(hoverTimerRef.current)
    if (hideTimerRef.current)  clearTimeout(hideTimerRef.current)
    const x = e.clientX, y = e.clientY
    hoverTimerRef.current = setTimeout(() => {
      setChildOverlay({ node, x, y })
      setParentTooltip(null)
    }, 160)
  }

  function scheduleHide() {
    if (hoverTimerRef.current) clearTimeout(hoverTimerRef.current)
    hideTimerRef.current = setTimeout(() => {
      setParentTooltip(null)
      setChildOverlay(null)
    }, 120)
  }

  function hideOverlaysFn() {
    if (hoverTimerRef.current) clearTimeout(hoverTimerRef.current)
    if (hideTimerRef.current)  clearTimeout(hideTimerRef.current)
    setParentTooltip(null)
    setChildOverlay(null)
  }

  // ── Pan / zoom ───────────────────────────────────────────────────────────────

  function onCanvasWheel(e: React.WheelEvent<HTMLDivElement>) {
    e.preventDefault()
    const rect = e.currentTarget.getBoundingClientRect()
    const mx   = e.clientX - rect.left
    const my   = e.clientY - rect.top
    const factor = e.deltaY < 0 ? 1.1 : 1 / 1.1
    setTf(t => {
      const ns = Math.min(Math.max(t.s * factor, 0.15), 4)
      const r  = ns / t.s
      return { s: ns, x: mx - r * (mx - t.x), y: my - r * (my - t.y) }
    })
  }

  function onCanvasMouseDown(e: React.MouseEvent<HTMLDivElement>) {
    if (e.button !== 0 && e.button !== 1) return
    if ((e.target as HTMLElement).closest('[data-no-pan]')) return
    e.preventDefault()
    panRef.current = { active: true, startX: e.clientX, startY: e.clientY, startTx: tf.x, startTy: tf.y }
  }

  function onCanvasMouseMove(e: React.MouseEvent<HTMLDivElement>) {
    if (!panRef.current.active) return
    const dx = e.clientX - panRef.current.startX
    const dy = e.clientY - panRef.current.startY
    setTf(t => ({ ...t, x: panRef.current.startTx + dx, y: panRef.current.startTy + dy }))
  }

  function onCanvasMouseUp() { panRef.current.active = false }

  function resetView() { setTf({ x: 0, y: 0, s: 1 }) }

  // Nodos bloqueados — un nodo está bloqueado si su predecesor inmediato no está aprobado.
  // Debe estar ANTES del early return para no violar Rules of Hooks.
  const lockedNodes = useMemo(() => {
    const allNodes: PipelineNodeConfig[] = []
    for (const c of [...containers].sort((a, b) => (a.order_index ?? 0) - (b.order_index ?? 0))) {
      for (const n of [...c.children].sort((a, b) => (a.order_index ?? 0) - (b.order_index ?? 0))) {
        allNodes.push(n)
      }
    }
    const locked = new Set<string>()
    for (let i = 1; i < allNodes.length; i++) {
      if (getNodeState(project, allNodes[i - 1].step_key).status !== 'done') {
        locked.add(allNodes[i].step_key)
      }
    }
    return locked
  }, [containers, project])

  if (loading) {
    return (
      <div style={{ height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'var(--bg-0)' }}>
        <span style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--text-3)' }}>Loading pipeline…</span>
      </div>
    )
  }

  const activeContainerIdx = activeContainer
    ? containers.findIndex(c => c.step_key === activeContainer.step_key)
    : 0
  const activeContainerColor = CONTAINER_COLORS[activeContainerIdx % CONTAINER_COLORS.length]

  return (
    <div
      className="forge-app"
      style={{
        gridTemplateRows: '40px 1fr',
        gridTemplateColumns: `${libraryOpen ? libraryWidth : 32}px 1fr`,
        transition: 'grid-template-columns 200ms ease',
      }}
    >
      <style>{`
        @keyframes ledpulse { 0%,100%{opacity:1;transform:scale(1)} 50%{opacity:.4;transform:scale(.7)} }
        @keyframes shimmer  { 0%{transform:translateX(-100%)} 100%{transform:translateX(250%)} }
      `}</style>

      {/* Toolbar — usa grid-area: toolbar via .forge-toolbar */}
      {project
        ? <ForgeToolbar project={project} phase={runningNode ? 'running' : 'idle'} onRefresh={onRefresh} />
        : <div style={{ gridArea: 'toolbar', background: 'var(--bg-1)', borderBottom: '1px solid var(--line)' }} />
      }

      {/* Library panel — usa grid-area: library via .forge-library */}
      <PipelineLibrary
        containers={containers}
        project={project}
        activeContainer={activeContainer}
        selectedNode={subSelectedNode}
        isOpen={libraryOpen}
        onToggle={() => setLibraryOpen(o => !o)}
        width={libraryWidth}
        onWidthChange={setLibraryWidth}
        onEnterSub={handleEnterSub}
        onSelectNode={(node, container) => { setActiveContainer(container); setSubSelectedNode(node); setView('sub') }}
      />

      {/* Canvas principal — usa grid-area: canvas via .forge-canvas */}
      <div
        ref={canvasRef}
        className="forge-canvas"
        onWheel={onCanvasWheel}
        onMouseDown={onCanvasMouseDown}
        onMouseMove={onCanvasMouseMove}
        onMouseUp={onCanvasMouseUp}
        onMouseLeave={onCanvasMouseUp}
        style={{ cursor: panRef.current.active ? 'grabbing' : 'default' }}
      >
        {/* Dot grid background — estático */}
        <div style={{ position: 'absolute', inset: 0, backgroundImage: 'radial-gradient(circle, var(--line-2) 1px, transparent 1px)', backgroundSize: '30px 30px', opacity: 0.45, pointerEvents: 'none' }} />

        {/* Controles flotantes */}
        <div data-no-pan style={{ position: 'absolute', top: 14, right: 16, display: 'flex', gap: 6, zIndex: 10 }}>
          {view !== 'sub' && (
            <div style={{ display: 'flex', background: 'var(--bg-2)', border: '1px solid var(--line-2)', borderRadius: 7, padding: 2, gap: 2, boxShadow: '0 4px 16px rgba(0,0,0,.35)' }}>
              {(['compact', 'expanded'] as const).map(v => (
                <button key={v} onClick={() => { setView(v); setInspectorOpen(false) }} style={{ fontFamily: 'var(--font-mono)', fontSize: 9, fontWeight: 600, padding: '4px 10px', borderRadius: 5, border: 'none', cursor: 'pointer', background: view === v ? 'var(--bg-4)' : 'transparent', color: view === v ? 'var(--text-0)' : 'var(--text-3)', letterSpacing: '.04em' }}>
                  {v === 'compact' ? '⊟ Compact' : '⊞ Expanded'}
                </button>
              ))}
            </div>
          )}
        </div>

        {/* SubcanvasLayout — frame completo que cubre el canvas cuando view === 'sub' */}
        {view === 'sub' && activeContainer && project && (
          <SubcanvasLayout
            container={activeContainer}
            project={project}
            color={activeContainerColor}
            containers={containers}
            lockedNodes={lockedNodes}
            selectedNode={subSelectedNode}
            onSelectedNodeChange={setSubSelectedNode}
            onBack={handleGoBack}
            onApproved={node => { clearPendingReview(project.id, node.step_key); onRefresh() }}
            onDraftSaved={node => markPendingReview(project.id, node.step_key)}
            onSaveComplete={onRefresh}
            onNavigateTo={node => openRunModal(node, 'output')}
          />
        )}

        {/* Controles de zoom — ocultos en modo sub */}
        {view !== 'sub' && <div data-no-pan style={{ position: 'absolute', top: 14, left: 16, display: 'flex', background: 'var(--bg-2)', border: '1px solid var(--line-2)', borderRadius: 7, boxShadow: '0 4px 16px rgba(0,0,0,.35)', overflow: 'hidden', zIndex: 10 }}>
          <button
            onClick={() => {
              const r = canvasRef.current?.getBoundingClientRect()
              const mx = r ? r.width / 2 : 0, my = r ? r.height / 2 : 0
              setTf(t => { const ns = Math.min(t.s * 1.2, 4); const f = ns / t.s; return { s: ns, x: mx - f * (mx - t.x), y: my - f * (my - t.y) } })
            }}
            title="Zoom in"
            style={{ fontFamily: 'var(--font-mono)', fontSize: 14, fontWeight: 400, padding: '3px 11px', border: 'none', borderRight: '1px solid var(--line-2)', cursor: 'pointer', background: 'transparent', color: 'var(--text-2)', lineHeight: 1 }}
          >+</button>
          <button
            onClick={resetView}
            title="Reset view (100%)"
            style={{ fontFamily: 'var(--font-mono)', fontSize: 9, fontWeight: 600, padding: '4px 10px', border: 'none', borderRight: '1px solid var(--line-2)', cursor: 'pointer', background: 'transparent', color: 'var(--text-3)', minWidth: 42, textAlign: 'center' }}
          >{Math.round(tf.s * 100)}%</button>
          <button
            onClick={() => {
              const r = canvasRef.current?.getBoundingClientRect()
              const mx = r ? r.width / 2 : 0, my = r ? r.height / 2 : 0
              setTf(t => { const ns = Math.max(t.s / 1.2, 0.15); const f = ns / t.s; return { s: ns, x: mx - f * (mx - t.x), y: my - f * (my - t.y) } })
            }}
            title="Zoom out"
            style={{ fontFamily: 'var(--font-mono)', fontSize: 14, fontWeight: 400, padding: '3px 11px', border: 'none', cursor: 'pointer', background: 'transparent', color: 'var(--text-2)', lineHeight: 1 }}
          >−</button>
        </div>}

        {/* Viewport — transform zoom/pan se aplica a los nodos en todos los modos */}
        <div style={{ position: 'absolute', inset: 0, transformOrigin: '0 0', transform: `translate(${tf.x}px, ${tf.y}px) scale(${tf.s})` }}>

          {/* ── Compact view ── */}
          {view === 'compact' && (() => {
            const n    = containers.length
            const cols = Math.min(n, 4)  // filas de 4 máximo
            const rows: PipelineContainerConfig[][] = []
            for (let i = 0; i < n; i += cols) rows.push(containers.slice(i, i + cols))
            return (
              <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 20, padding: '40px 60px' }}>
                  {rows.map((row, rowIdx) => (
                    <div key={rowIdx} style={{ display: 'flex', alignItems: 'center' }}>
                      {row.map((c, colIdx) => {
                        const gi = rowIdx * cols + colIdx
                        return (
                          <React.Fragment key={c.step_key}>
                            {colIdx > 0 && <Edge done={containerStatus(project, containers[gi - 1]) === 'done'} />}
                            <CompactCard
                              container={c}
                              project={project}
                              onClick={() => { hideOverlaysFn(); handleEnterSub(c) }}
                              onTooltipEnter={(e, cont) => showParentTooltip(e, cont, rowIdx === 0)}
                              onTooltipLeave={scheduleHide}
                              color={CONTAINER_COLORS[gi % CONTAINER_COLORS.length]}
                            />
                          </React.Fragment>
                        )
                      })}
                    </div>
                  ))}
                </div>
              </div>
            )
          })()}

          {/* ── Expanded view ── */}
          {view === 'expanded' && (
            <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'flex-start', padding: '32px 40px', gap: 16 }}>
              {containers.map((c, idx) => (
                <ExpandedColumn
                  key={c.step_key}
                  container={c}
                  project={project}
                  onNodeClick={node => { setActiveContainer(c); openRunModal(node) }}
                  onRunNode={node => openRunModal(node)}
                  color={CONTAINER_COLORS[idx % CONTAINER_COLORS.length]}
                  lockedNodes={lockedNodes}
                />
              ))}
            </div>
          )}

        </div>{/* /viewport */}
      </div>

      {/* Inspector oculto — pendiente de rediseño */}

      {/* ── Parent hover tooltip ─────────────────────────────────────────────── */}
      {parentTooltip && (() => {
        const { container, rect, preferAbove } = parentTooltip
        const TT_W = 340, TT_H = 310
        const pos     = calcParentTooltipPos(rect, TT_W, TT_H, preferAbove)
        const done    = doneCount(project, container)
        const running = container.children.filter(c => getNodeState(project, c.step_key).status === 'running').length
        const idle    = container.children.length - done - running
        const pct     = container.children.length ? Math.round((done / container.children.length) * 100) : 0
        const preview = container.children.slice(0, 4)
        const more    = container.children.length - 4

        // Mini-nodos con edges intercalados
        const miniItems: React.ReactNode[] = []
        preview.forEach((node, i) => {
          const { status: ns } = getNodeState(project, node.step_key)
          if (i > 0) {
            const prevStatus = getNodeState(project, preview[i - 1].step_key).status
            miniItems.push(
              <div key={`edge-${i}`} style={{ flexShrink: 0, width: 12, height: 1, background: prevStatus === 'done' ? 'var(--state-success)' : 'var(--line-2)' }} />
            )
          }
          const nodeBorder = ns === 'done'
            ? 'color-mix(in srgb, var(--state-success) 40%, var(--line-2))'
            : ns === 'running'
              ? 'color-mix(in srgb, var(--state-running) 40%, var(--line-2))'
              : 'var(--line-2)'
          miniItems.push(
            <div key={node.step_key} style={{ flex: 1, minWidth: 0, background: 'var(--bg-3)', border: `1px solid ${nodeBorder}`, borderRadius: 7, padding: '8px 9px' }}>
              <div style={{ fontFamily: 'var(--font-mono)', fontSize: 8, fontWeight: 700, color: 'var(--accent-blue)', marginBottom: 3 }}>
                {container.order_index}.{node.order_index}
              </div>
              <div style={{ fontSize: 9, color: 'var(--text-1)', lineHeight: 1.3, marginBottom: 6, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                {node.label}
              </div>
              <span style={{ fontFamily: 'var(--font-mono)', fontSize: 8, padding: '1px 5px', borderRadius: 99, color: BADGE[ns].color, background: BADGE[ns].bg, border: `1px solid ${BADGE[ns].color}44` }}>
                {BADGE[ns].label}
              </span>
            </div>
          )
        })

        // Flecha que apunta hacia la card
        const arrowStyle: React.CSSProperties = {
          position: 'absolute',
          left: '50%', transform: 'translateX(-50%)',
          width: 0, height: 0,
          borderLeft: '7px solid transparent',
          borderRight: '7px solid transparent',
        }

        return (
          <div
            style={{
              position: 'fixed', zIndex: 800, left: pos.left, top: pos.top,
              background: 'var(--bg-2)', border: '1px solid var(--line-2)',
              borderRadius: 12, padding: 16, width: TT_W,
              boxShadow: '0 24px 64px rgba(0,0,0,.75)',
            }}
            onMouseEnter={() => { if (hideTimerRef.current) clearTimeout(hideTimerRef.current) }}
            onMouseLeave={scheduleHide}
          >
            {/* Flecha — apunta hacia la card */}
            {pos.above
              ? <div style={{ ...arrowStyle, bottom: -7, borderTop: '7px solid var(--line-2)' }}>
                  <div style={{ ...arrowStyle, bottom: 1, borderTop: '7px solid var(--bg-2)' }} />
                </div>
              : <div style={{ ...arrowStyle, top: -7, borderBottom: '7px solid var(--line-2)' }}>
                  <div style={{ ...arrowStyle, top: 1, borderBottom: '7px solid var(--bg-2)' }} />
                </div>
            }

            {/* Cabecera */}
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
              <div>
                <div style={{ fontFamily: 'var(--font-mono)', fontSize: 8, textTransform: 'uppercase', letterSpacing: '.08em', color: 'var(--text-3)', marginBottom: 3 }}>Stage {container.order_index}</div>
                <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--text-0)' }}>{container.label}</div>
              </div>
              <span style={{ fontFamily: 'var(--font-mono)', fontSize: 9, padding: '3px 8px', borderRadius: 99, color: BADGE[containerStatus(project, container)].color, background: BADGE[containerStatus(project, container)].bg, border: `1px solid ${BADGE[containerStatus(project, container)].color}44` }}>
                {BADGE[containerStatus(project, container)].label}
              </span>
            </div>

            {/* Barra de progreso */}
            <div style={{ marginBottom: 12 }}>
              <div style={{ height: 5, background: 'var(--bg-4)', borderRadius: 3, overflow: 'hidden', marginBottom: 6 }}>
                <div style={{ height: '100%', width: `${pct}%`, background: 'var(--state-success)', borderRadius: 3, transition: 'width 300ms' }} />
              </div>
              <div style={{ display: 'flex', gap: 12, fontFamily: 'var(--font-mono)', fontSize: 9 }}>
                <span style={{ color: 'var(--state-success)' }}>✓ {done} done</span>
                {running > 0 && <span style={{ color: 'var(--state-running)' }}>⟳ {running} running</span>}
                <span style={{ color: 'var(--text-3)' }}>● {idle} idle</span>
              </div>
            </div>

            {/* Mini-nodes preview */}
            {preview.length > 0 && (
              <div style={{ display: 'flex', flexDirection: 'row', alignItems: 'stretch', gap: 0, marginBottom: more > 0 ? 6 : 14 }}>
                {miniItems}
              </div>
            )}
            {more > 0 && (
              <div style={{ fontFamily: 'var(--font-mono)', fontSize: 8, color: 'var(--text-3)', marginBottom: 14 }}>+ {more} more steps inside</div>
            )}

            {/* Footer */}
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end', paddingTop: 12, borderTop: '1px solid var(--line)' }}>
              <button
                onClick={() => { hideOverlaysFn(); handleEnterSub(container) }}
                style={{ fontFamily: 'var(--font-mono)', fontSize: 10, fontWeight: 700, color: 'var(--action-fg)', background: 'var(--action)', border: 'none', borderRadius: 6, padding: '7px 16px', cursor: 'pointer' }}
              >
                Enter →
              </button>
            </div>
          </div>
        )
      })()}

      {/* Modal de creación de proyecto — aparece automáticamente cuando project es null */}
      <NewProjectModal
        open={newProjectOpen}
        memberId={null}
        onProjectCreated={p => {
          setNewProjectOpen(false)
          router.push(`/projects/${p.id}`)
        }}
        onClose={() => {
          setNewProjectOpen(false)
          if (!project) router.push('/')
        }}
      />

      {/* Modal de run individual — se abre al pulsar ▶ en cualquier nodo */}
      {runModal && runModalContainer && project && (
        <NodeRunModal
          key={runModal.step_key}
          node={runModal}
          container={runModalContainer}
          containers={containers}
          project={project}
          color={CONTAINER_COLORS[containers.findIndex(c => c.step_key === runModalContainer.step_key) % CONTAINER_COLORS.length]}
          onClose={() => setRunModal(null)}
          onApproved={() => { clearPendingReview(project.id, runModal.step_key); setRunModal(null); onRefresh() }}
          onDraftSaved={() => markPendingReview(project.id, runModal.step_key)}
          onSaveComplete={() => onRefresh()}
          onNavigateTo={node => openRunModal(node, 'output')}
          initialTab={runModalInitTab}
          isLocked={lockedNodes.has(runModal.step_key)}
        />
      )}

      {/* ── Child hover overlay ──────────────────────────────────────────────── */}
      {childOverlay && (() => {
        const { node, x, y } = childOverlay
        const { status, output } = getNodeState(project, node.step_key)
        const pos        = calcChildTooltipPos(x, y, 260, 170)
        const statusText = status === 'done' ? '✓ complete' : status === 'running' ? '⟳ running' : '● idle'
        return (
          <div
            style={{
              position: 'fixed', zIndex: 800, left: pos.left, top: pos.top,
              background: 'var(--bg-2)', border: '1px solid var(--line-2)',
              borderRadius: 10, padding: 14, width: 260,
              boxShadow: '0 20px 60px rgba(0,0,0,.7)',
              pointerEvents: 'none',
            }}
          >
            <div style={{ fontFamily: 'var(--font-mono)', fontSize: 8, textTransform: 'uppercase', letterSpacing: '.08em', color: 'var(--text-3)', marginBottom: 3 }}>Step output</div>
            <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--text-0)', marginBottom: 10 }}>{node.label}</div>
            <div style={{ background: 'var(--bg-3)', border: '1px solid var(--line)', borderRadius: 6, padding: 10 }}>
              <div style={{ fontFamily: 'var(--font-mono)', fontSize: 8, textTransform: 'uppercase', letterSpacing: '.06em', color: 'var(--text-3)', marginBottom: 5 }}>Output</div>
              <div style={{ fontFamily: 'var(--font-mono)', fontSize: 9, color: 'var(--text-2)', lineHeight: 1.65 }}>
                {output
                  ? output.slice(0, 140) + (output.length > 140 ? '…' : '')
                  : 'No output yet — step has not been run.'}
              </div>
            </div>
            <div style={{ marginTop: 8, fontFamily: 'var(--font-mono)', fontSize: 8, color: 'var(--text-3)', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <span>{statusText}</span>
              {node.model_name && (
                <span style={{ background: 'var(--bg-4)', border: '1px solid var(--line-2)', borderRadius: 4, padding: '2px 6px' }}>{node.model_name}</span>
              )}
            </div>
          </div>
        )
      })()}

    </div>
  )
}
