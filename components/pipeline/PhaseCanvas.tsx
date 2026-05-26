'use client'

import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react'
import {
  ReactFlow, ReactFlowProvider,
  useNodesState, useEdgesState,
  useReactFlow, useViewport,
  Background, BackgroundVariant,
  Handle, Position,
  type Node, type Edge,
} from '@xyflow/react'
import '@xyflow/react/dist/style.css'
import ForgeEdge from '@/components/pipeline/ForgeEdge'
import { saveContainerLayout, loadContainerLayout } from '@/lib/canvas-storage'
import type { CanvasLayout } from '@/lib/canvas-storage'
import { getPipelinePhases, saveChatHistory, getActionNodes, addActionInstance, removeActionInstance } from '@/lib/api'
import type { PhaseConfig, PhaseContainerConfig, PhaseNodeConfig, PipelineNodeConfig, PipelineContainerConfig, ChatMessage } from '@/lib/api'
import type { Project, ActionInstance, StepConfig } from '@/lib/types'
import ForgeToolbar from '@/components/pipeline/ForgeToolbar'
import NodeRunModal from '@/components/pipeline/NodeRunModal'
import IdeaGeneratorModal from '@/components/pipeline/IdeaGeneratorModal'
import MarketResearchModal from '@/components/pipeline/MarketResearchModal'
import HumanNodeModal from '@/components/pipeline/HumanNodeModal'
import NodeChatWindow from '@/components/shared/NodeChatWindow'
import ActionStepNode, { type ActionStepNodeData } from '@/components/pipeline/ActionStepNode'
import ActionModal from '@/components/pipeline/ActionModal'

const FORGYI_KEYFRAME = `@keyframes forgyi-ping { 0%,100%{opacity:1;transform:scale(1)} 50%{opacity:0.45;transform:scale(1.25)} }`

// ─── Constantes visuales ──────────────────────────────────────────────────────

const INTEGRATION: Record<string, { icon: string; label: string; color: string; bgColor: string }> = {
  llm:           { icon: '🤖', label: 'AI Agent',  color: '#A78BFA', bgColor: 'rgba(167,139,250,0.13)' },
  comfyui:       { icon: '🤖', label: 'ComfyUI',   color: '#A78BFA', bgColor: 'rgba(167,139,250,0.13)' },
  n8n:           { icon: '🤖', label: 'n8n',        color: '#A78BFA', bgColor: 'rgba(167,139,250,0.13)' },
  human:         { icon: '👤', label: 'Human',      color: '#60A5FA', bgColor: 'rgba(96,165,250,0.13)'  },
  collaborative: { icon: '🤝', label: 'Collab',     color: '#FBBF24', bgColor: 'rgba(251,191,36,0.13)' },
}

// Icono representativo por step_key de container (igual que en el diseño HTML)
const CONTAINER_ICON: Record<string, string> = {
  idtn_idea_generation:  '💡',
  idtn_market_research:  '📊',
  idtn_selection:        '🎯',
  cncpt_concept_doc:     '📄',
  cncpt_art_direction:   '🎨',
  cncpt_core_loop:       '🔄',
  cncpt_review:          '✋',
  pprod_gdd:             '📋',
  pprod_prototype:       '🎮',
  pprod_planning:        '🗓️',
}

const CARD_W        = 300
const COMPACT_CARD_W = 280
const CARD_GAP      = 48
const CANVAS_PAD    = 60

// ─── NodeRow ──────────────────────────────────────────────────────────────────

function NodeRow({ node, locked, status = 'idle', onClick }: {
  node:     PhaseNodeConfig
  locked?:  boolean
  status?:  'done' | 'review' | 'idle'
  onClick?: () => void
}) {
  const intg = node.integration_type ? INTEGRATION[node.integration_type] : null

  const statusDot = status === 'done'
    ? <span style={{ fontSize: 11, color: '#34D399', flexShrink: 0, lineHeight: 1 }}>✓</span>
    : status === 'review'
      ? <div style={{ width: 7, height: 7, borderRadius: '50%', flexShrink: 0, background: '#FBBF24' }} />
      : <div style={{ width: 7, height: 7, borderRadius: '50%', flexShrink: 0, background: 'var(--line-1)', border: '1px solid var(--line-2)' }} />

  if (locked) {
    return (
      <div style={{
        display: 'flex', alignItems: 'center', gap: 8,
        padding: '7px 14px', borderRadius: 6,
        background: 'var(--bg-2)', border: '1px solid var(--line-2)',
        opacity: 0.38, cursor: 'not-allowed',
      }}>
        <span style={{ fontSize: 10, flexShrink: 0 }}>🔒</span>
        <span style={{ fontSize: 9, fontFamily: 'var(--font-mono)', color: 'var(--text-3)', flexShrink: 0 }}>
          {node.order_index}
        </span>
        <span style={{ fontSize: 11, color: 'var(--text-2)', flex: 1, lineHeight: 1.3 }}>
          {node.label}
        </span>
      </div>
    )
  }

  return (
    <div
      onClick={onClick}
      style={{
        display: 'flex', alignItems: 'center', gap: 8,
        padding: '7px 14px', borderRadius: 6,
        background: status === 'done' ? 'color-mix(in srgb, #34D399 6%, var(--bg-2))' : 'var(--bg-2)',
        border: `1px solid ${status === 'done' ? 'color-mix(in srgb, #34D399 30%, var(--line-2))' : status === 'review' ? 'color-mix(in srgb, #FBBF24 30%, var(--line-2))' : 'var(--line-2)'}`,
        cursor: onClick ? 'pointer' : 'default',
        transition: 'border-color 120ms, background 120ms',
      }}
      onMouseEnter={onClick ? e => {
        e.currentTarget.style.borderColor = intg?.color ?? 'var(--line-1)'
        e.currentTarget.style.background = `color-mix(in srgb, ${intg?.color ?? 'var(--action)'} 6%, var(--bg-2))`
      } : undefined}
      onMouseLeave={onClick ? e => {
        e.currentTarget.style.borderColor = status === 'done' ? 'color-mix(in srgb, #34D399 30%, var(--line-2))' : status === 'review' ? 'color-mix(in srgb, #FBBF24 30%, var(--line-2))' : 'var(--line-2)'
        e.currentTarget.style.background  = status === 'done' ? 'color-mix(in srgb, #34D399 6%, var(--bg-2))' : 'var(--bg-2)'
      } : undefined}
    >
      {statusDot}
      <span style={{ fontSize: 9, fontFamily: 'var(--font-mono)', color: 'var(--text-3)', flexShrink: 0 }}>
        {node.order_index}
      </span>
      <span style={{ fontSize: 11, color: status === 'done' ? 'var(--text-2)' : 'var(--text-1)', flex: 1, lineHeight: 1.3 }}>
        {node.label}
      </span>
      {intg && status !== 'done' && (
        <span style={{
          fontSize: 8, fontFamily: 'var(--font-mono)',
          padding: '2px 6px', borderRadius: 99, flexShrink: 0,
          background: `color-mix(in srgb, ${intg.color} 14%, var(--bg-3))`,
          color: intg.color,
          border: `1px solid color-mix(in srgb, ${intg.color} 25%, transparent)`,
        }}>
          {intg.icon} {intg.label}
        </span>
      )}
    </div>
  )
}

// ─── ContainerCard ────────────────────────────────────────────────────────────

function ContainerCard({
  container, phaseIdx, compact, locked, unlockedNodeIdx, getNodeStatus, onClick, onNodeClick,
}: {
  container: PhaseContainerConfig
  phaseIdx: number
  compact: boolean
  locked?: boolean
  unlockedNodeIdx?: number
  getNodeStatus?: (stepKey: string) => 'done' | 'review' | 'idle'
  onClick?: () => void
  onNodeClick?: (node: PhaseNodeConfig) => void
}) {
  // Tipos de integración únicos presentes en los nodos
  const uniqueIntgTypes = Array.from(
    new Set(container.nodes.map(n => n.integration_type).filter(Boolean))
  ) as string[]

  // Icono dominante (primero encontrado, o genérico)
  const dominantIntg = uniqueIntgTypes[0] ? INTEGRATION[uniqueIntgTypes[0]] : null

  if (compact) {
    const hasAI    = uniqueIntgTypes.some(t => ['llm','comfyui','n8n'].includes(t))
    const hasHuman = uniqueIntgTypes.some(t => ['human','collaborative'].includes(t))
    const iconBg   = hasAI && hasHuman
      ? 'linear-gradient(135deg, rgba(167,139,250,0.15), rgba(96,165,250,0.15))'
      : hasHuman ? 'rgba(96,165,250,0.13)' : 'rgba(167,139,250,0.13)'

    const containerIcon = CONTAINER_ICON[container.step_key] ?? '⬡'

    if (locked) {
      return (
        <div style={{
          width: COMPACT_CARD_W, borderRadius: 12, overflow: 'hidden', flexShrink: 0,
          background: 'var(--bg-1)', border: '1px solid var(--line-2)',
          boxShadow: '0 2px 12px rgba(0,0,0,0.12)',
          opacity: 0.42, cursor: 'not-allowed', position: 'relative',
        }}>
          <div style={{ padding: '16px 18px 12px', display: 'flex', alignItems: 'flex-start', gap: 12 }}>
            <div style={{ width: 40, height: 40, borderRadius: 8, flexShrink: 0, background: iconBg, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 20 }}>
              {containerIcon}
            </div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 14, fontWeight: 700, lineHeight: 1.3, color: 'var(--text-0)' }}>{container.label}</div>
            </div>
            <span style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--text-3)' }}>🔒</span>
          </div>
          {container.description && (
            <div style={{ padding: '0 18px 12px', fontSize: 11, color: 'var(--text-2)', lineHeight: 1.5 }}>{container.description}</div>
          )}
          <div style={{ padding: '10px 18px', borderTop: '1px solid var(--line-2)', display: 'flex', justifyContent: 'flex-end' }}>
            <span style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color: 'var(--text-3)' }}>0/{container.nodes.length}</span>
          </div>
        </div>
      )
    }

    return (
      <div style={{
        width: COMPACT_CARD_W, borderRadius: 12, overflow: 'hidden', flexShrink: 0,
        background: 'var(--bg-1)', border: '1px solid var(--line-2)',
        boxShadow: '0 2px 12px rgba(0,0,0,0.2)',
        cursor: 'pointer',
        transition: 'border-color 0.25s, transform 0.25s, box-shadow 0.25s',
      }}
        onMouseEnter={e => {
          e.currentTarget.style.borderColor = '#FF8A3D'
          e.currentTarget.style.transform   = 'translateY(-3px)'
          e.currentTarget.style.boxShadow   = '0 12px 32px rgba(255,138,61,0.1)'
        }}
        onMouseLeave={e => {
          e.currentTarget.style.borderColor = 'var(--line-2)'
          e.currentTarget.style.transform   = 'translateY(0)'
          e.currentTarget.style.boxShadow   = '0 2px 12px rgba(0,0,0,0.2)'
        }}
        onClick={onClick}
      >
        {/* Header: icono representativo + título + badge de índice */}
        <div style={{ padding: '16px 18px 12px', display: 'flex', alignItems: 'flex-start', gap: 12 }}>
          <div style={{
            width: 40, height: 40, borderRadius: 8, flexShrink: 0,
            background: iconBg,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            fontSize: 20,
          }}>
            {containerIcon}
          </div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 14, fontWeight: 700, lineHeight: 1.3, color: 'var(--text-0)' }}>
              {container.label}
            </div>
          </div>
          <span style={{
            fontFamily: 'var(--font-mono)', fontSize: 10, color: 'var(--text-3)',
            background: 'var(--bg-2)', padding: '2px 6px', borderRadius: 4, flexShrink: 0,
          }}>
            {phaseIdx}.{container.order_index}
          </span>
        </div>

        {/* Descripción del container */}
        {container.description && (
          <div style={{ padding: '0 18px 12px', fontSize: 11, color: 'var(--text-2)', lineHeight: 1.5 }}>
            {container.description}
          </div>
        )}

        {/* Footer: iconos de tipo + estado + conteo de nodos */}
        <div style={{ padding: '10px 18px', borderTop: '1px solid var(--line-2)', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div style={{ display: 'flex', gap: 6 }}>
            {hasAI && (
              <span style={{
                fontSize: 10, fontWeight: 600, padding: '3px 8px', borderRadius: 4,
                background: 'rgba(167,139,250,0.12)', color: '#A78BFA',
              }}>
                🤖 AI
              </span>
            )}
            {hasHuman && (
              <span style={{
                fontSize: 10, fontWeight: 600, padding: '3px 8px', borderRadius: 4,
                background: 'rgba(96,165,250,0.12)', color: '#60A5FA',
              }}>
                👤 Human
              </span>
            )}
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            {(() => {
              const total       = container.nodes.length
              const doneCount   = getNodeStatus ? container.nodes.filter(n => getNodeStatus(n.step_key) === 'done').length : 0
              const reviewCount = getNodeStatus ? container.nodes.filter(n => getNodeStatus(n.step_key) === 'review').length : 0
              if (doneCount === total && total > 0) return (
                <span style={{ fontFamily: 'var(--font-mono)', fontSize: 10, fontWeight: 600, padding: '2px 6px', borderRadius: 4, background: 'rgba(52,211,153,0.12)', color: '#34D399' }}>
                  ✓ {total}/{total}
                </span>
              )
              if (reviewCount > 0) return (
                <span style={{ fontFamily: 'var(--font-mono)', fontSize: 10, fontWeight: 600, padding: '2px 6px', borderRadius: 4, background: 'rgba(251,191,36,0.12)', color: '#FBBF24' }}>
                  {doneCount}/{total}
                </span>
              )
              if (doneCount > 0) return (
                <span style={{ fontFamily: 'var(--font-mono)', fontSize: 10, fontWeight: 600, padding: '2px 6px', borderRadius: 4, background: 'rgba(52,211,153,0.10)', color: '#34D399' }}>
                  {doneCount}/{total}
                </span>
              )
              return (
                <span style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color: 'var(--text-3)' }}>
                  {doneCount}/{total}
                </span>
              )
            })()}
          </div>
        </div>
      </div>
    )
  }

  // ── Vista expandida ────────────────────────────────────────────────────────
  return (
    <div style={{
      width: CARD_W, background: 'var(--bg-1)',
      border: '1px solid var(--line-2)', borderRadius: 12,
      overflow: 'hidden', flexShrink: 0,
      boxShadow: '0 2px 16px rgba(0,0,0,0.18)',
      transition: 'border-color 150ms, box-shadow 150ms',
      opacity: locked ? 0.42 : 1,
    }}
      onMouseEnter={locked ? undefined : e => {
        e.currentTarget.style.borderColor = 'var(--action)'
        e.currentTarget.style.boxShadow   = '0 2px 16px rgba(0,0,0,0.18), 0 0 0 1px color-mix(in srgb, var(--action) 25%, transparent)'
      }}
      onMouseLeave={locked ? undefined : e => {
        e.currentTarget.style.borderColor = 'var(--line-2)'
        e.currentTarget.style.boxShadow   = '0 2px 16px rgba(0,0,0,0.18)'
      }}
    >
      {/* Header: icono + título + índice */}
      <div style={{ padding: '16px 16px 12px', borderBottom: '1px solid var(--line-2)', background: 'var(--bg-2)', display: 'flex', alignItems: 'flex-start', gap: 12 }}>
        <div style={{
          width: 38, height: 38, borderRadius: 8, flexShrink: 0,
          background: dominantIntg ? dominantIntg.bgColor : 'var(--bg-3)',
          display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 18,
        }}>
          {CONTAINER_ICON[container.step_key] ?? '⬡'}
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--text-0)', lineHeight: 1.3 }}>
            {container.label}
          </div>
          {container.description && (
            <div style={{ fontSize: 10, color: 'var(--text-2)', lineHeight: 1.5, marginTop: 4 }}>
              {container.description}
            </div>
          )}
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 4, flexShrink: 0 }}>
          <span style={{
            fontSize: 9, fontFamily: 'var(--font-mono)', color: 'var(--text-3)',
            background: 'var(--bg-3)', padding: '2px 7px', borderRadius: 4,
          }}>
            {locked ? '🔒' : `${phaseIdx}.${container.order_index}`}
          </span>
          {(() => {
            const total       = container.nodes.length
            const doneCount   = getNodeStatus ? container.nodes.filter(n => getNodeStatus(n.step_key) === 'done').length : 0
            const reviewCount = getNodeStatus ? container.nodes.filter(n => getNodeStatus(n.step_key) === 'review').length : 0
            if (doneCount === total && total > 0) return (
              <span style={{ fontSize: 8, fontWeight: 600, padding: '2px 5px', borderRadius: 4, background: 'rgba(52,211,153,0.12)', color: '#34D399' }}>✓ Done</span>
            )
            if (reviewCount > 0) return (
              <span style={{ fontSize: 8, fontWeight: 600, padding: '2px 5px', borderRadius: 4, background: 'rgba(251,191,36,0.12)', color: '#FBBF24' }}>● {doneCount}/{total}</span>
            )
            if (doneCount > 0) return (
              <span style={{ fontSize: 8, fontWeight: 600, padding: '2px 5px', borderRadius: 4, background: 'rgba(52,211,153,0.10)', color: '#34D399' }}>{doneCount}/{total}</span>
            )
            return null
          })()}
        </div>
      </div>

      {/* Nodes */}
      <div style={{ padding: '10px 12px', display: 'flex', flexDirection: 'column', gap: 6 }}>
        {container.nodes.map(n => {
          const nodeLocked = unlockedNodeIdx !== undefined && n.order_index > unlockedNodeIdx
          const nodeStatus = getNodeStatus?.(n.step_key) ?? 'idle'
          return (
            <NodeRow
              key={n.step_key}
              node={n}
              locked={nodeLocked}
              status={nodeStatus}
              onClick={!nodeLocked && onNodeClick ? () => onNodeClick(n) : undefined}
            />
          )
        })}
        {container.nodes.length === 0 && (
          <div style={{ fontSize: 10, fontFamily: 'var(--font-mono)', color: 'var(--text-4)', textAlign: 'center', padding: '12px 0' }}>
            No steps configured
          </div>
        )}
      </div>

      {/* Footer: conteo de nodos */}
      <div style={{
        padding: '8px 16px', borderTop: '1px solid var(--line-2)',
        display: 'flex', justifyContent: 'flex-end',
      }}>
        <span style={{ fontSize: 10, fontFamily: 'var(--font-mono)', color: 'var(--text-3)' }}>
          {container.nodes.length} steps
        </span>
      </div>
    </div>
  )
}


// ─── ConnectorLine ───────────────────────────────────────────────────────────

function ConnectorLine() {
  return (
    <div style={{ width: CARD_GAP, flexShrink: 0, alignSelf: 'center', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <svg viewBox="0 0 32 24" fill="none" width="32" height="24" style={{ color: 'var(--line-1)', flexShrink: 0 }}>
        <path d="M0 12h28M22 6l6 6-6 6" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    </div>
  )
}

// ─── ContainerDrawer ──────────────────────────────────────────────────────────

// Adapta PhaseContainerConfig al formato legacy que espera NodeRunModal
function toLegacyContainer(c: PhaseContainerConfig): PipelineContainerConfig {
  return {
    step_key:         c.step_key,
    label:            c.label,
    order_index:      c.order_index,
    integration_type: (c.integration_type ?? '') as string,
    is_active:        c.is_active,
    children:         c.nodes as unknown as PipelineNodeConfig[],
  }
}

function ContainerDrawer({
  container, phaseIdx, allContainers, project, unlockedNodeIdx, getNodeStatus, onClose, onRefresh,
}: {
  container:       PhaseContainerConfig
  phaseIdx:        number
  allContainers:   PhaseContainerConfig[]
  project:         Project
  unlockedNodeIdx: number
  getNodeStatus?:  (stepKey: string) => 'done' | 'review' | 'idle'
  onClose:         () => void
  onRefresh?:      () => void
}) {
  const [runNode,        setRunNode]        = useState<PhaseNodeConfig | null>(null)
  const [ideaGenOpen,    setIdeaGenOpen]    = useState<number | false>(false)
  const [mktResOpen,     setMktResOpen]     = useState<number | false>(false)
  const [sourceModal,    setSourceModal]    = useState<{ containerStepKey: string; nodeStep: number } | null>(null)

  const isIdeaGenContainer = container.step_key === 'idtn_idea_generation'
  const isMktResContainer  = container.step_key === 'idtn_market_research'

  const containerIcon    = CONTAINER_ICON[container.step_key] ?? '⬡'
  const uniqueIntgTypes  = Array.from(new Set(container.nodes.map(n => n.integration_type).filter(Boolean))) as string[]
  const hasAI            = uniqueIntgTypes.some(t => ['llm','comfyui','n8n'].includes(t))
  const hasHuman         = uniqueIntgTypes.some(t => ['human','collaborative'].includes(t))
  const iconBg           = hasAI && hasHuman
    ? 'linear-gradient(135deg, rgba(167,139,250,0.15), rgba(96,165,250,0.15))'
    : hasHuman ? 'rgba(96,165,250,0.13)' : 'rgba(167,139,250,0.13)'

  const legacyContainer  = toLegacyContainer(container)
  const legacyContainers = allContainers.map(toLegacyContainer)

  return (
    <>
      {/* Overlay semi-transparente */}
      <div
        onClick={onClose}
        style={{ position: 'fixed', inset: 0, zIndex: 40, background: 'rgba(0,0,0,0.35)' }}
      />

      {/* Drawer */}
      <div style={{
        position: 'fixed', top: 0, right: 0, bottom: 0, width: 380, zIndex: 50,
        background: 'var(--bg-1)', borderLeft: '1px solid var(--line-2)',
        boxShadow: '-8px 0 40px rgba(0,0,0,0.3)',
        display: 'flex', flexDirection: 'column',
      }}>
        {/* Header del drawer */}
        <div style={{ padding: '20px 20px 16px', borderBottom: '1px solid var(--line-2)', display: 'flex', alignItems: 'flex-start', gap: 12 }}>
          <div style={{
            width: 44, height: 44, borderRadius: 10, flexShrink: 0,
            background: iconBg, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 22,
          }}>
            {containerIcon}
          </div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 10, fontFamily: 'var(--font-mono)', color: 'var(--text-3)', marginBottom: 3 }}>
              {phaseIdx}.{container.order_index}
            </div>
            <div style={{ fontSize: 15, fontWeight: 700, color: 'var(--text-0)', lineHeight: 1.2, marginBottom: container.description ? 6 : 0 }}>
              {container.label}
            </div>
            {container.description && (
              <div style={{ fontSize: 11, color: 'var(--text-2)', lineHeight: 1.5 }}>
                {container.description}
              </div>
            )}
          </div>
          <button
            onClick={onClose}
            style={{ border: 'none', background: 'var(--bg-2)', cursor: 'pointer', color: 'var(--text-2)', fontSize: 14, padding: '5px 8px', borderRadius: 6, flexShrink: 0, lineHeight: 1 }}
          >
            ✕
          </button>
        </div>

        {/* Badges de tipo + estado del container */}
        <div style={{ padding: '10px 20px', borderBottom: '1px solid var(--line-2)', display: 'flex', gap: 6, alignItems: 'center' }}>
          {hasAI && (
            <span style={{ fontSize: 10, fontWeight: 600, padding: '3px 8px', borderRadius: 4, background: 'rgba(167,139,250,0.12)', color: '#A78BFA' }}>
              🤖 AI
            </span>
          )}
          {hasHuman && (
            <span style={{ fontSize: 10, fontWeight: 600, padding: '3px 8px', borderRadius: 4, background: 'rgba(96,165,250,0.12)', color: '#60A5FA' }}>
              👤 Human
            </span>
          )}
          <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 6 }}>
            {(() => {
              const total       = container.nodes.length
              const doneCount   = getNodeStatus ? container.nodes.filter(n => getNodeStatus(n.step_key) === 'done').length : 0
              const reviewCount = getNodeStatus ? container.nodes.filter(n => getNodeStatus(n.step_key) === 'review').length : 0
              if (doneCount === total && total > 0) return (
                <span style={{ fontSize: 10, fontWeight: 600, padding: '2px 7px', borderRadius: 4, background: 'rgba(52,211,153,0.12)', color: '#34D399' }}>✓ Done</span>
              )
              if (reviewCount > 0) return (
                <span style={{ fontSize: 10, fontWeight: 600, padding: '2px 7px', borderRadius: 4, background: 'rgba(251,191,36,0.12)', color: '#FBBF24' }}>● {doneCount}/{total}</span>
              )
              if (doneCount > 0) return (
                <span style={{ fontSize: 10, fontWeight: 600, padding: '2px 7px', borderRadius: 4, background: 'rgba(52,211,153,0.10)', color: '#34D399' }}>{doneCount}/{total}</span>
              )
              return null
            })()}
            <span style={{ fontSize: 10, fontFamily: 'var(--font-mono)', color: 'var(--text-3)' }}>
              {container.nodes.length} steps
            </span>
          </div>
        </div>

        {/* Lista de nodos */}
        <div style={{ flex: 1, overflowY: 'auto', padding: '14px 16px', display: 'flex', flexDirection: 'column', gap: 6 }}>
          {container.nodes.map(n => {
            const nodeIsLocked = n.order_index > unlockedNodeIdx
            const intg = n.integration_type ? INTEGRATION[n.integration_type] : null

            if (nodeIsLocked) {
              return (
                <div
                  key={n.step_key}
                  style={{
                    display: 'flex', alignItems: 'center', gap: 10,
                    padding: '11px 14px', borderRadius: 8,
                    background: 'var(--bg-2)', border: '1px solid var(--line-2)',
                    opacity: 0.38, cursor: 'not-allowed',
                  }}
                >
                  <span style={{ fontSize: 11, flexShrink: 0 }}>🔒</span>
                  <span style={{ fontSize: 9, fontFamily: 'var(--font-mono)', color: 'var(--text-3)', flexShrink: 0 }}>
                    {n.order_index}
                  </span>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 12, color: 'var(--text-2)', lineHeight: 1.3 }}>{n.label}</div>
                    {n.description && (
                      <div style={{ fontSize: 10, color: 'var(--text-3)', lineHeight: 1.4, marginTop: 2 }}>{n.description}</div>
                    )}
                  </div>
                </div>
              )
            }

            const nodeStatus = getNodeStatus?.(n.step_key) ?? 'idle'
            const nodeBorderColor = nodeStatus === 'done'
              ? 'color-mix(in srgb, #34D399 30%, var(--line-2))'
              : nodeStatus === 'review'
                ? 'color-mix(in srgb, #FBBF24 30%, var(--line-2))'
                : 'var(--line-2)'
            const nodeBg = nodeStatus === 'done'
              ? 'color-mix(in srgb, #34D399 6%, var(--bg-2))'
              : 'var(--bg-2)'

            return (
              <button
                key={n.step_key}
                onClick={() => isIdeaGenContainer ? setIdeaGenOpen(n.order_index) : isMktResContainer ? setMktResOpen(n.order_index) : setRunNode(n)}
                style={{
                  display: 'flex', alignItems: 'center', gap: 10,
                  padding: '11px 14px', borderRadius: 8, width: '100%', textAlign: 'left',
                  background: nodeBg, border: `1px solid ${nodeBorderColor}`,
                  cursor: 'pointer',
                  transition: 'border-color 120ms, background 120ms',
                }}
                onMouseEnter={e => {
                  e.currentTarget.style.borderColor = intg?.color ?? 'var(--action)'
                  e.currentTarget.style.background  = `color-mix(in srgb, ${intg?.color ?? 'var(--action)'} 6%, var(--bg-2))`
                }}
                onMouseLeave={e => {
                  e.currentTarget.style.borderColor = nodeBorderColor
                  e.currentTarget.style.background  = nodeBg
                }}
              >
                {nodeStatus === 'done'
                  ? <span style={{ fontSize: 12, color: '#34D399', flexShrink: 0, lineHeight: 1 }}>✓</span>
                  : nodeStatus === 'review'
                    ? <div style={{ width: 7, height: 7, borderRadius: '50%', flexShrink: 0, background: '#FBBF24' }} />
                    : <div style={{ width: 7, height: 7, borderRadius: '50%', flexShrink: 0, background: 'var(--line-1)', border: '1px solid var(--line-2)' }} />
                }
                <span style={{ fontSize: 9, fontFamily: 'var(--font-mono)', color: 'var(--text-3)', flexShrink: 0 }}>
                  {n.order_index}
                </span>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 12, color: nodeStatus === 'done' ? 'var(--text-2)' : 'var(--text-0)', lineHeight: 1.3 }}>{n.label}</div>
                  {n.description && (
                    <div style={{ fontSize: 10, color: 'var(--text-3)', lineHeight: 1.4, marginTop: 2 }}>{n.description}</div>
                  )}
                </div>
                {intg && nodeStatus !== 'done' && (
                  <span style={{
                    fontSize: 8, fontFamily: 'var(--font-mono)', padding: '2px 6px', borderRadius: 99, flexShrink: 0,
                    background: `color-mix(in srgb, ${intg.color} 14%, var(--bg-3))`,
                    color: intg.color,
                    border: `1px solid color-mix(in srgb, ${intg.color} 25%, transparent)`,
                  }}>
                    {intg.icon} {intg.label}
                  </span>
                )}
                <span style={{ fontSize: 12, color: 'var(--text-3)', flexShrink: 0 }}>›</span>
              </button>
            )
          })}
          {container.nodes.length === 0 && (
            <div style={{ fontSize: 11, fontFamily: 'var(--font-mono)', color: 'var(--text-3)', textAlign: 'center', padding: '32px 0' }}>
              No steps configured
            </div>
          )}
        </div>
      </div>

      {/* NodeRunModal al hacer clic en un nodo normal */}
      {runNode && (
        <NodeRunModal
          node={runNode as PipelineNodeConfig}
          container={legacyContainer}
          containers={legacyContainers}
          project={project}
          color='#A78BFA'
          onClose={() => setRunNode(null)}
          onApproved={() => setRunNode(null)}
        />
      )}

      {/* IdeaGeneratorModal para el container idtn_idea_generation */}
      {ideaGenOpen !== false && (
        <IdeaGeneratorModal
          project={project}
          nodes={container.nodes}
          label={container.label}
          description={container.description}
          icon={containerIcon}
          initialStep={ideaGenOpen}
          onClose={() => { setIdeaGenOpen(false); onRefresh?.() }}
        />
      )}

      {/* MarketResearchModal para el container idtn_market_research */}
      {mktResOpen !== false && (
        <MarketResearchModal
          project={project}
          nodes={container.nodes}
          label={container.label}
          description={container.description}
          icon={containerIcon}
          initialStep={mktResOpen}
          onOpenSource={(key, step) => setSourceModal({ containerStepKey: key, nodeStep: step })}
          onClose={() => { setMktResOpen(false); onRefresh?.() }}
        />
      )}

      {/* IdeaGeneratorModal apilado al abrir "Open 1.1.3 →" */}
      {sourceModal && (() => {
        const src = allContainers.find(c => c.step_key === sourceModal.containerStepKey)
        if (!src) return null
        return (
          <IdeaGeneratorModal
            project={project}
            nodes={src.nodes}
            label={src.label}
            description={src.description}
            icon={CONTAINER_ICON[src.step_key] ?? '⬡'}
            initialStep={sourceModal.nodeStep}
            layered={true}
            onClose={() => setSourceModal(null)}
          />
        )
      })()}
    </>
  )
}

// ─── PhaseProgressBar ────────────────────────────────────────────────────────

function PhaseProgressBar({ containers, getNodeStatus }: {
  containers:    PhaseContainerConfig[]
  getNodeStatus: (stepKey: string) => 'done' | 'review' | 'idle'
}) {
  const sorted = [...containers].sort((a, b) => a.order_index - b.order_index)
  const n = sorted.length

  // N containers → N secciones → N+1 puntos
  // Punto 0: inicio (siempre activo)
  // Punto i (1..N): se desbloquea cuando container[i-1] está done
  // Sección i (0..N-1): se rellena cuando container[i] está done

  const getProgress = (i: number) => {
    const total = sorted[i].nodes.length
    if (total === 0) return 0
    const done = sorted[i].nodes.filter(n => getNodeStatus(n.step_key) === 'done').length
    return done / total
  }

  return (
    <div style={{
      height: 48, flexShrink: 0,
      display: 'flex', alignItems: 'center',
      padding: '0 32px',
    }}>
      {/* Punto 0 — inicio (siempre activo) */}
      <div style={{
        width: 10, height: 10, borderRadius: '50%', flexShrink: 0,
        background: '#FF8A3D',
        boxShadow: '0 0 6px rgba(255,138,61,0.5)',
      }} />

      {sorted.map((container, i) => {
        const progress   = getProgress(i)
        const isDone     = progress === 1

        return (
          <React.Fragment key={container.step_key}>
            {/* Sección i — fill proporcional al progreso */}
            <div style={{
              flex: 1, height: 2, borderRadius: 1,
              background: 'var(--line-2)',
              position: 'relative', overflow: 'hidden',
            }}>
              <div style={{
                position: 'absolute', left: 0, top: 0, bottom: 0,
                width: `${progress * 100}%`,
                background: '#FF8A3D',
                borderRadius: 1,
                transition: 'width 600ms ease',
              }} />
            </div>

            {/* Punto i+1 — Forgyi si done, círculo vacío si no */}
            {isDone ? (
              <div style={{
                width: 28, height: 28, borderRadius: '50%', flexShrink: 0,
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                border: '2px solid #FF8A3D',
                background: 'color-mix(in srgb, #FF8A3D 12%, var(--bg-1))',
                boxShadow: '0 0 8px rgba(255,138,61,0.35)',
                transition: 'all 600ms ease',
              }}>
                <img src="/forgy/forgyi.png" alt="done" width={18} height={18}
                  style={{ objectFit: 'contain', display: 'block' }} />
              </div>
            ) : (
              <div style={{
                width: 28, height: 28, borderRadius: '50%', flexShrink: 0,
                border: `2px solid ${progress > 0 ? 'color-mix(in srgb, #FF8A3D 40%, var(--line-2))' : 'var(--line-2)'}`,
                background: 'var(--bg-1)',
                transition: 'border-color 600ms ease',
              }} />
            )}
          </React.Fragment>
        )
      })}

      {n === 0 && (
        <div style={{ flex: 1, height: 2, background: 'var(--line-2)', borderRadius: 1 }} />
      )}
    </div>
  )
}

// ─── NodeProgressBar — barra de progreso de nodos dentro del container ───────

function NodeProgressBar({ nodes, getNodeStatus }: {
  nodes:         PhaseNodeConfig[]
  getNodeStatus: (stepKey: string) => 'done' | 'review' | 'idle'
}) {
  const sorted = [...nodes].sort((a, b) => a.order_index - b.order_index)

  const getProgress = (node: PhaseNodeConfig) => {
    const s = getNodeStatus(node.step_key)
    return s === 'done' ? 1 : s === 'review' ? 0.5 : 0
  }

  return (
    <div style={{
      height: 48,
      display: 'flex', alignItems: 'center',
      padding: '0 32px',
    }}>
      {/* Punto inicial */}
      <div style={{
        width: 10, height: 10, borderRadius: '50%', flexShrink: 0,
        background: '#FF8A3D', boxShadow: '0 0 6px rgba(255,138,61,0.5)',
      }} />

      {sorted.map(node => {
        const progress = getProgress(node)
        const isDone   = progress === 1
        return (
          <React.Fragment key={node.step_key}>
            <div style={{
              flex: 1, height: 2, borderRadius: 1,
              background: 'var(--line-2)', position: 'relative', overflow: 'hidden',
            }}>
              <div style={{
                position: 'absolute', left: 0, top: 0, bottom: 0,
                width: `${progress * 100}%`, background: '#FF8A3D',
                borderRadius: 1, transition: 'width 600ms ease',
              }} />
            </div>
            {isDone ? (
              <div style={{
                width: 28, height: 28, borderRadius: '50%', flexShrink: 0,
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                border: '2px solid #FF8A3D',
                background: 'color-mix(in srgb, #FF8A3D 12%, var(--bg-1))',
                boxShadow: '0 0 8px rgba(255,138,61,0.35)',
                transition: 'all 600ms ease',
              }}>
                <img src="/forgy/forgyi.png" alt="done" width={18} height={18} style={{ objectFit: 'contain', display: 'block' }} />
              </div>
            ) : (
              <div style={{
                width: 28, height: 28, borderRadius: '50%', flexShrink: 0,
                border: `2px solid ${progress > 0 ? 'color-mix(in srgb, #FF8A3D 40%, var(--line-2))' : 'var(--line-2)'}`,
                background: 'var(--bg-1)', transition: 'border-color 600ms ease',
              }} />
            )}
          </React.Fragment>
        )
      })}
    </div>
  )
}

// ─── ContainerCanvas — vista grafo de nodos dentro de un container ───────────

interface ContainerStepNodeData extends Record<string, unknown> {
  node:        PhaseNodeConfig
  status:      'done' | 'review' | 'idle'
  locked:      boolean
  onChatClick: () => void
}

const ContainerStepNode = React.memo(function ContainerStepNode({ data }: { data: ContainerStepNodeData }) {
  const { node, status, locked } = data
  const intg = node.integration_type ? INTEGRATION[node.integration_type] : null

  const railColor = locked
    ? '#374151'
    : status === 'done'   ? '#34D399'
    : status === 'review' ? '#FBBF24'
    : '#4B5563'

  const numColor = locked ? '#374151' : status === 'done' ? '#34D399' : status === 'review' ? '#FBBF24' : '#374151'

  return (
    <div style={{
      width: 260,
      background: 'var(--bg-1)',
      border: '1px solid var(--line-2)',
      borderRadius: 12,
      overflow: 'hidden',
      opacity: locked ? 0.45 : 1,
      boxShadow: '0 4px 20px rgba(0,0,0,0.22)',
      cursor: locked ? 'not-allowed' : 'pointer',
      display: 'flex',
      transition: 'box-shadow 150ms',
    }}>
      <Handle type="target" position={Position.Left} isConnectable={false}
        style={{ background: '#4B5563', border: '2px solid var(--bg-1)', width: 10, height: 10 }} />

      {/* Rail de color izquierdo */}
      <div style={{ width: 4, flexShrink: 0, background: railColor, borderRadius: '0 0 0 0', transition: 'background 200ms' }} />

      {/* Contenido */}
      <div style={{ flex: 1, minWidth: 0, padding: '14px 14px 12px', position: 'relative' }}>
        {/* Número de step decorativo + status badge */}
        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 6 }}>
          <span style={{
            fontSize: 28, fontFamily: 'var(--font-mono)', fontWeight: 800, lineHeight: 1,
            color: numColor, opacity: locked ? 0.4 : 0.22, letterSpacing: '-1px', userSelect: 'none',
          }}>
            {String(node.order_index).padStart(2, '0')}
          </span>
          <div style={{ display: 'flex', alignItems: 'center', gap: 4, paddingTop: 2 }}>
            {status === 'done'   && <span style={{ fontSize: 9, fontFamily: 'var(--font-mono)', fontWeight: 700, color: '#34D399', background: 'rgba(52,211,153,0.12)', padding: '2px 6px', borderRadius: 99 }}>✓ done</span>}
            {status === 'review' && <span style={{ fontSize: 9, fontFamily: 'var(--font-mono)', color: '#FBBF24', background: 'rgba(251,191,36,0.10)', padding: '2px 6px', borderRadius: 99 }}>● review</span>}
            {locked              && <span style={{ fontSize: 11 }}>🔒</span>}
          </div>
        </div>

        {/* Label */}
        <div style={{ fontSize: 12, fontWeight: 700, fontFamily: 'var(--font-mono)', color: locked ? 'var(--text-3)' : 'var(--text-0)', lineHeight: 1.35, marginBottom: node.description ? 4 : 8 }}>
          {node.label}
        </div>

        {/* Description */}
        {node.description && (
          <div style={{ fontSize: 10, fontFamily: 'var(--font-mono)', color: 'var(--text-3)', lineHeight: 1.5, marginBottom: 8 }}>
            {node.description}
          </div>
        )}

        {/* Integration badge */}
        {intg && (
          <span style={{
            fontSize: 8, fontFamily: 'var(--font-mono)', padding: '2px 7px', borderRadius: 99,
            background: `color-mix(in srgb, ${intg.color} 14%, var(--bg-2))`,
            color: intg.color,
            border: `1px solid color-mix(in srgb, ${intg.color} 25%, transparent)`,
          }}>
            {intg.icon} {intg.label}
          </span>
        )}

        {/* Botón Forgyi — acceso directo al chat, solo en nodos desbloqueados */}
        {!locked && (
          <>
            <style>{FORGYI_KEYFRAME}</style>
            <button
              onClick={e => { e.stopPropagation(); data.onChatClick() }}
              title="Ask Forge AI about this step"
              style={{
                position: 'absolute', bottom: 8, right: 8,
                width: 28, height: 28, borderRadius: '50%',
                border: '1px solid rgba(255,138,61,0.25)',
                background: 'rgba(255,138,61,0.12)', cursor: 'pointer',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                padding: 0, animation: 'forgyi-ping 2s ease-in-out infinite',
              }}
              onMouseEnter={e => { e.currentTarget.style.animationPlayState = 'paused'; e.currentTarget.style.background = 'rgba(255,138,61,0.28)' }}
              onMouseLeave={e => { e.currentTarget.style.animationPlayState = 'running'; e.currentTarget.style.background = 'rgba(255,138,61,0.12)' }}
            >
              <img src="/forgy/forgyi.png" alt="AI chat" width={16} height={16} style={{ objectFit: 'contain', display: 'block' }} />
            </button>
          </>
        )}
      </div>

      <Handle type="source" position={Position.Right} isConnectable={false}
        style={{ background: '#4B5563', border: '2px solid var(--bg-1)', width: 10, height: 10 }} />
    </div>
  )
})

const ACTION_ICON_SMALL: Record<string, string> = {
  'docx':          '📄',
  'pptx':          '📊',
  'pdf':           '📑',
  'artefact-html': '🌐',
  'pitch-deck':    '🎯',
  'one-pager':     '📋',
  'social-kit':    '📢',
  'press-release': '📰',
  'spreadsheet':   '🗂️',
  'email-draft':   '✉️',
  'wiki-starter':  '📚',
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const CONTAINER_STEP_NODE_TYPES: Record<string, any> = {
  containerStep: ContainerStepNode,
  actionStep:    ActionStepNode,
}
const CONTAINER_EDGE_TYPES = { forgeEdge: ForgeEdge }

const CNODE_W   = 260
const CNODE_GAP = 100

interface ContainerCanvasProps {
  container:       PhaseContainerConfig
  phaseIdx:        number
  project:         Project
  allContainers:   PhaseContainerConfig[]
  unlockedNodeIdx: number
  getNodeStatus:   (stepKey: string) => 'done' | 'review' | 'idle'
  onBack:          () => void
  onRefresh?:      () => void
}

function ContainerCanvasInner({
  container, phaseIdx, project, allContainers, unlockedNodeIdx, getNodeStatus, onBack, onRefresh,
}: ContainerCanvasProps) {
  const sorted = useMemo(
    () => [...container.nodes].sort((a, b) => a.order_index - b.order_index),
    [container.nodes]
  )

  // Catálogo de action nodes disponibles
  const [actionCatalog, setActionCatalog] = useState<StepConfig[]>([])
  useEffect(() => {
    getActionNodes().then(r => setActionCatalog(r.action_nodes)).catch(() => {})
  }, [])

  // Instancias de este container
  const containerInstances = useMemo(
    () => (project.action_instances ?? []).filter(i => i.container_key === container.step_key),
    [project.action_instances, container.step_key]
  )

  const savedLayoutData = useMemo(
    () =>
      loadContainerLayout(project.id, container.step_key) ??
      (project.canvas_layout as CanvasLayout)?.container_layouts?.[container.step_key] ??
      null,
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [project.id, container.step_key]
  )
  const savedLayout   = savedLayoutData?.positions ?? null
  const savedViewport = savedLayoutData?.viewport   ?? null

  const buildPipelineNodes = useCallback((): Node[] =>
    sorted.map((node, i) => ({
      id:       node.step_key,
      type:     'containerStep',
      position: savedLayout?.[node.step_key] ?? { x: i * (CNODE_W + CNODE_GAP), y: 0 },
      data: {
        node,
        status:      getNodeStatus(node.step_key),
        locked:      node.order_index > unlockedNodeIdx,
        onChatClick: () => setChatNode(node),
      },
    })),
    [sorted, getNodeStatus, unlockedNodeIdx, savedLayout]
  )

  const buildActionNodes = useCallback((instances: ActionInstance[], pipelineNodes: Node[], existingNodes: Node[] = []): Node[] =>
    instances.map((inst, i) => {
      const catalog  = actionCatalog.find(c => c.step_key === inst.action_step_key)
      const label    = catalog?.label ?? inst.action_type
      const existing = existingNodes.find(n => n.id === `action:${inst.id}`)
      // Si ya existe, conservar posición pero actualizar instance, label Y callbacks (closure fresca con inst actualizado)
      if (existing) return {
        ...existing,
        data: {
          ...existing.data,
          instance: inst,
          label,
          onOpen:   () => { setActionAutoRun(false); setActionModal(inst) },
          onRun:    () => { setActionAutoRun(true);  setActionModal(inst) },
          onRemove: () => handleRemoveAction(inst.id),
        },
      }
      const src = pipelineNodes.find(n => n.id === inst.source_step_key)
      const defaultPos = src
        ? { x: src.position.x + CNODE_W + 80, y: src.position.y + i * 95 }
        : { x: i * 200, y: 250 }
      return {
        id:       `action:${inst.id}`,
        type:     'actionStep',
        position: savedLayout?.[`action:${inst.id}`] ?? defaultPos,
        data: {
          instance: inst,
          label,
          onOpen:   () => { setActionAutoRun(false); setActionModal(inst) },
          onRun:    () => { setActionAutoRun(true);  setActionModal(inst) },
          onRemove: () => handleRemoveAction(inst.id),
        } as ActionStepNodeData,
      }
    }),
    [actionCatalog, savedLayout]
  )

  const buildPipelineEdges = useCallback((): Edge[] =>
    sorted.slice(0, -1).map((n, i) => ({
      id:         `e-${n.step_key}`,
      source:     n.step_key,
      target:     sorted[i + 1].step_key,
      type:       'forgeEdge',
      deletable:  false,
      selectable: false,
      data:       { color: '#6b7280', active: false },
    })),
    [sorted]
  )

  const buildActionEdges = useCallback((instances: ActionInstance[]): Edge[] =>
    instances.map(inst => ({
      id:         `ae-${inst.id}`,
      source:     inst.source_step_key,
      target:     `action:${inst.id}`,
      type:       'forgeEdge',
      deletable:  false,
      selectable: false,
      data:       { color: '#ff8a3d', active: inst.status === 'done' },
    })),
    []
  )

  const initPipelineNodes = useMemo(() => buildPipelineNodes(), [buildPipelineNodes])
  const initPipelineEdges = useMemo(() => buildPipelineEdges(), [buildPipelineEdges])
  const initActionNodes   = useMemo(() => buildActionNodes(containerInstances, initPipelineNodes, []), [buildActionNodes, containerInstances, initPipelineNodes])
  const initActionEdges   = useMemo(() => buildActionEdges(containerInstances), [buildActionEdges, containerInstances])

  const [nodes, setNodes, onNodesChange] = useNodesState([...initPipelineNodes, ...initActionNodes])
  const [edges, setEdges]                = useEdgesState([...initPipelineEdges, ...initActionEdges])

  const nodesRef = useRef(nodes)
  nodesRef.current = nodes

  const [runNode,      setRunNode]      = useState<PhaseNodeConfig | null>(null)
  const [humanNode,    setHumanNode]    = useState<PhaseNodeConfig | null>(null)
  const [ideaGenStep,  setIdeaGenStep]  = useState<number | false>(false)
  const [mktResStep,   setMktResStep]   = useState<number | false>(false)
  const [sourceModal,  setSourceModal]  = useState<{ containerStepKey: string; nodeStep: number } | null>(null)
  const [chatNode,     setChatNode]     = useState<PhaseNodeConfig | null>(null)
  const [actionModal,  setActionModal]  = useState<ActionInstance | null>(null)
  const [actionAutoRun, setActionAutoRun] = useState(false)
  const [ctxMenu,      setCtxMenu]      = useState<{ x: number; y: number; sourceStepKey: string; sourceLabel: string } | null>(null)
  const ctxMenuRef = useRef<HTMLDivElement>(null)

  // Sincroniza status/locked en pipeline nodes cuando cambia generation_jobs
  useEffect(() => {
    setNodes(prev => prev.map(n => {
      if (n.id.startsWith('action:')) return n
      const phaseNode = sorted.find(s => s.step_key === n.id)
      if (!phaseNode) return n
      const newStatus = getNodeStatus(phaseNode.step_key)
      const newLocked = phaseNode.order_index > unlockedNodeIdx
      const d = n.data as ContainerStepNodeData
      if (d.status === newStatus && d.locked === newLocked) return n
      return { ...n, data: { ...n.data, status: newStatus, locked: newLocked } }
    }))
  }, [getNodeStatus, unlockedNodeIdx, sorted, setNodes])

  // Sincroniza action nodes cuando cambian las instancias
  useEffect(() => {
    const all          = nodesRef.current
    const pipelineNodes = all.filter(n => !n.id.startsWith('action:'))
    const newActionNodes = buildActionNodes(containerInstances, pipelineNodes, all)
    setNodes(prev => [
      ...prev.filter(n => !n.id.startsWith('action:')),
      ...newActionNodes,
    ])
    setEdges(prev => [
      ...prev.filter(e => !e.id.startsWith('ae-')),
      ...buildActionEdges(containerInstances),
    ])
  }, [containerInstances, buildActionNodes, buildActionEdges, setNodes, setEdges])

  async function handleRemoveAction(instanceId: string) {
    try {
      await removeActionInstance(project.id, instanceId)
      onRefresh?.()
    } catch (err) {
      console.error('[action-nodes] remove failed', err)
    }
  }

  const isIdeaGen        = container.step_key === 'idtn_idea_generation'
  const isMktRes         = container.step_key === 'idtn_market_research'
  const containerIcon    = CONTAINER_ICON[container.step_key] ?? '⬡'
  const legacyContainer  = useMemo(() => toLegacyContainer(container), [container])
  const legacyContainers = useMemo(() => allContainers.map(toLegacyContainer), [allContainers])

  const { zoomIn, zoomOut, fitView, getViewport } = useReactFlow()
  const { zoom } = useViewport()

  const handleNodeClick = useCallback((_: React.MouseEvent, rfNode: Node) => {
    setCtxMenu(null)
    if (rfNode.id.startsWith('action:')) return // action nodes usan su propio onClick
    const d = rfNode.data as ContainerStepNodeData
    if (d.locked) return
    const phaseNode = container.nodes.find(n => n.step_key === rfNode.id)
    if (!phaseNode) return
    if      (isIdeaGen)                              setIdeaGenStep(phaseNode.order_index)
    else if (isMktRes)                               setMktResStep(phaseNode.order_index)
    else if (phaseNode.integration_type === 'human') setHumanNode(phaseNode)
    else                                             setRunNode(phaseNode)
  }, [container.nodes, isIdeaGen, isMktRes])

  const handleNodeContextMenu = useCallback((e: React.MouseEvent, rfNode: Node) => {
    e.preventDefault()
    if (rfNode.id.startsWith('action:')) return
    const d = rfNode.data as ContainerStepNodeData
    if (d.locked) return
    setCtxMenu({ x: e.clientX, y: e.clientY, sourceStepKey: rfNode.id, sourceLabel: d.node.label })
  }, [])

  const handleAddAction = useCallback(async (actionStepKey: string) => {
    if (!ctxMenu) return
    setCtxMenu(null)
    try {
      await addActionInstance(project.id, {
        action_step_key: actionStepKey,
        source_step_key: ctxMenu.sourceStepKey,
        container_key:   container.step_key,
      })
      onRefresh?.()
    } catch (err) {
      console.error('[action-nodes] add failed', err)
    }
  }, [ctxMenu, project.id, container.step_key, onRefresh])

  // Guarda posiciones + viewport actual
  const saveLayout = useCallback(() => {
    const positions: Record<string, { x: number; y: number }> = {}
    nodesRef.current.forEach(n => { positions[n.id] = n.position })
    saveContainerLayout(project.id, container.step_key, positions, getViewport())
  }, [project.id, container.step_key, getViewport])

  const handleNodeDragStop = useCallback(() => { saveLayout() }, [saveLayout])
  const handleMoveEnd      = useCallback(() => { saveLayout() }, [saveLayout])

  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>

      {/* Breadcrumb / back */}
      <div style={{
        flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center',
        padding: '0 16px', height: 44,
        borderBottom: '1px solid var(--line-2)',
        background: 'var(--bg-1)', gap: 0,
      }}>
        {/* Botón back */}
        <button onClick={onBack} style={{
          border: 'none', background: 'transparent', cursor: 'pointer',
          color: 'var(--text-3)', fontSize: 11, fontFamily: 'var(--font-mono)',
          padding: '5px 10px 5px 0', display: 'flex', alignItems: 'center', gap: 5,
          transition: 'color 120ms',
        }}
          onMouseEnter={e => (e.currentTarget.style.color = 'var(--text-0)')}
          onMouseLeave={e => (e.currentTarget.style.color = 'var(--text-3)')}
        >
          <span style={{ fontSize: 13 }}>←</span>
          <span>Back</span>
        </button>

        {/* Separador */}
        <span style={{ color: 'var(--line-2)', fontSize: 14, marginRight: 10 }}>/</span>

        {/* Índice */}
        <span style={{
          fontSize: 9, fontFamily: 'var(--font-mono)', fontWeight: 700,
          color: 'var(--text-4)', letterSpacing: '0.05em', marginRight: 8,
        }}>
          {phaseIdx}.{container.order_index}
        </span>

        {/* Icono */}
        <span style={{ fontSize: 16, lineHeight: 1, marginRight: 7 }}>{containerIcon}</span>

        {/* Label */}
        <span style={{
          fontSize: 15, fontFamily: 'var(--font-mono)', fontWeight: 700,
          color: 'var(--text-0)', letterSpacing: '-0.01em',
        }}>
          {container.label}
        </span>
      </div>

      {/* Canvas React Flow */}
      <div style={{ flex: 1, position: 'relative', overflow: 'hidden' }}>

      {/* Barra de progreso de nodos — overlay sobre el canvas, sin fondo */}
      <div style={{ position: 'absolute', top: 0, left: 0, right: 0, zIndex: 10, pointerEvents: 'none' }}>
        <NodeProgressBar nodes={sorted} getNodeStatus={getNodeStatus} />
      </div>

      {/* Fondo punteado */}
      <div style={{
        position: 'absolute', inset: 0, pointerEvents: 'none',
        backgroundImage: 'radial-gradient(circle, var(--line-2) 1px, transparent 1px)',
        backgroundSize: '28px 28px', opacity: 0.6,
      }} />

      {/* Controles de zoom — bottom right */}
      <div style={{
        position: 'absolute', bottom: 16, right: 16, zIndex: 10,
        display: 'flex', alignItems: 'center', gap: 4,
        background: 'var(--bg-1)', borderRadius: 10,
        border: '1px solid var(--line-2)',
        boxShadow: '0 2px 12px rgba(0,0,0,0.22)', padding: '5px 8px',
      }}>
        {([
          { label: '+', action: () => zoomIn({ duration: 200 }),        title: 'Zoom in'    },
          { label: '−', action: () => zoomOut({ duration: 200 }),       title: 'Zoom out'   },
          { label: '⊡', action: () => fitView({ padding: 0.3, duration: 300 }), title: 'Fit view' },
        ] as const).map(({ label, action, title }) => (
          <button key={label} title={title} onClick={action} style={{
            padding: '5px 10px', borderRadius: 6, border: '1px solid var(--line-2)',
            background: 'var(--bg-2)', color: 'var(--text-1)', cursor: 'pointer',
            fontSize: 11, fontFamily: 'var(--font-mono)', fontWeight: 600,
          }}>
            {label}
          </button>
        ))}
        <span style={{ fontSize: 10, fontFamily: 'var(--font-mono)', color: 'var(--text-3)', minWidth: 32, textAlign: 'right' }}>
          {Math.round(zoom * 100)}%
        </span>
      </div>

      <ReactFlow
        nodes={nodes}
        edges={edges}
        onNodesChange={onNodesChange}
        nodeTypes={CONTAINER_STEP_NODE_TYPES}
        edgeTypes={CONTAINER_EDGE_TYPES}
        onNodeClick={handleNodeClick}
        onNodeContextMenu={handleNodeContextMenu}
        onNodeDragStop={handleNodeDragStop}
        onMoveEnd={handleMoveEnd}
        proOptions={{ hideAttribution: true }}
        fitView={!savedViewport}
        fitViewOptions={{ padding: 0.3 }}
        defaultViewport={savedViewport ?? undefined}
        nodesDraggable
        nodesConnectable={false}
        deleteKeyCode={null}
        style={{ background: 'transparent' }}
      >
        <Background variant={BackgroundVariant.Dots} color="var(--line-2)" gap={28} size={1} style={{ opacity: 0 }} />
      </ReactFlow>

      {/* Context menu — click derecho en un pipeline node */}
      {ctxMenu && actionCatalog.length > 0 && (
        <>
        <div
          style={{ position: 'fixed', inset: 0, zIndex: 199 }}
          onClick={() => setCtxMenu(null)}
          onContextMenu={e => { e.preventDefault(); setCtxMenu(null) }}
        />
        <div
          ref={ctxMenuRef}
          style={{
            position: 'fixed', zIndex: 200,
            left: Math.min(ctxMenu.x, window.innerWidth - 220),
            top:  Math.min(ctxMenu.y, window.innerHeight - 40),
            background: 'var(--bg-1)',
            border: '1px solid var(--line-2)',
            borderRadius: 10,
            boxShadow: '0 8px 32px rgba(0,0,0,0.4)',
            minWidth: 200,
            overflow: 'hidden',
          }}
          onContextMenu={e => e.preventDefault()}
        >
          <div style={{
            padding: '8px 12px', borderBottom: '1px solid var(--line-2)',
            fontSize: 9, fontFamily: 'var(--font-mono)', color: 'var(--text-3)',
            textTransform: 'uppercase', letterSpacing: '0.08em',
          }}>
            Attach action to <span style={{ color: 'var(--text-1)' }}>{ctxMenu.sourceLabel}</span>
          </div>
          {actionCatalog.map(a => (
            <button
              key={a.step_key}
              onClick={() => handleAddAction(a.step_key)}
              style={{
                display: 'block', width: '100%', textAlign: 'left',
                padding: '8px 12px', border: 'none',
                background: 'transparent', cursor: 'pointer',
                fontSize: 11, fontFamily: 'var(--font-mono)', color: 'var(--text-0)',
                borderBottom: '1px solid var(--line-2)',
              }}
              onMouseEnter={e => { e.currentTarget.style.background = 'var(--bg-2)' }}
              onMouseLeave={e => { e.currentTarget.style.background = 'transparent' }}
            >
              <span style={{ marginRight: 6 }}>{ACTION_ICON_SMALL[a.action_type ?? ''] ?? '⚡'}</span>
              {a.label ?? a.step_key}
            </button>
          ))}
        </div>
        </>
      )}

      {runNode && (
        <NodeRunModal
          node={runNode as PipelineNodeConfig}
          container={legacyContainer}
          containers={legacyContainers}
          project={project}
          color="#A78BFA"
          onClose={() => setRunNode(null)}
          onApproved={() => { setRunNode(null); onRefresh?.() }}
        />
      )}

      {humanNode && (
        <HumanNodeModal
          node={humanNode}
          project={project}
          onClose={() => setHumanNode(null)}
          onSaved={() => { onRefresh?.() }}
        />
      )}
      {ideaGenStep !== false && (
        <IdeaGeneratorModal
          project={project}
          nodes={container.nodes}
          label={container.label}
          description={container.description}
          icon={containerIcon}
          initialStep={ideaGenStep}
          onClose={() => { setIdeaGenStep(false); onRefresh?.() }}
        />
      )}
      {mktResStep !== false && (
        <MarketResearchModal
          project={project}
          nodes={container.nodes}
          label={container.label}
          description={container.description}
          icon={containerIcon}
          initialStep={mktResStep}
          onOpenSource={(key, step) => setSourceModal({ containerStepKey: key, nodeStep: step })}
          onClose={() => { setMktResStep(false); onRefresh?.() }}
        />
      )}

      {/* IdeaGeneratorModal apilado al abrir "Open 1.1.3 →" */}
      {sourceModal && (() => {
        const src = allContainers.find(c => c.step_key === sourceModal.containerStepKey)
        if (!src) return null
        return (
          <IdeaGeneratorModal
            project={project}
            nodes={src.nodes}
            label={src.label}
            description={src.description}
            icon={CONTAINER_ICON[src.step_key] ?? '⬡'}
            initialStep={sourceModal.nodeStep}
            layered={true}
            onClose={() => setSourceModal(null)}
          />
        )
      })()}

      {chatNode && (() => {
        const artifact    = project.concept?.pipeline?.[chatNode.step_key] as { chat_history?: ChatMessage[] } | undefined
        const initialMsgs = artifact?.chat_history ?? []
        const isDone      = getNodeStatus(chatNode.step_key) === 'done'
        return (
          <NodeChatWindow
            stepKey={chatNode.step_key}
            stepLabel={chatNode.label}
            currentOutput={(project.concept?.pipeline?.[chatNode.step_key] as Record<string, unknown>) ?? null}
            project={project}
            locked={isDone}
            initialMessages={initialMsgs}
            onMessagesChange={msgs => saveChatHistory(project.id, chatNode.step_key, msgs).catch(() => {})}
            onClose={() => setChatNode(null)}
          />
        )
      })()}

      {actionModal && (() => {
        const catalog = actionCatalog.find(c => c.step_key === actionModal.action_step_key)
        const srcNode = container.nodes.find(n => n.step_key === actionModal.source_step_key)
        return (
          <ActionModal
            instance={actionModal}
            sourceLabel={srcNode?.label ?? actionModal.source_step_key}
            actionLabel={catalog?.label ?? actionModal.action_type}
            projectId={project.id}
            autoRun={actionAutoRun}
            onClose={() => { setActionModal(null); setActionAutoRun(false) }}
            onRunComplete={() => { setActionAutoRun(false); onRefresh?.() }}
          />
        )
      })()}
      </div>{/* fin canvas React Flow */}
    </div>
  )
}

function ContainerCanvas(props: ContainerCanvasProps) {
  return (
    <ReactFlowProvider>
      <ContainerCanvasInner {...props} />
    </ReactFlowProvider>
  )
}

// ─── PhaseTab ─────────────────────────────────────────────────────────────────

function PhaseTab({
  phase, index, active, locked, onClick,
}: {
  phase: PhaseConfig
  index: number
  active: boolean
  locked: boolean
  onClick: () => void
}) {
  return (
    <button
      onClick={locked ? undefined : onClick}
      style={{
        display: 'flex', alignItems: 'center', gap: 8,
        padding: '8px 16px', borderRadius: 8, border: 'none',
        background: active
          ? 'color-mix(in srgb, var(--action) 15%, var(--bg-2))'
          : 'transparent',
        cursor: locked ? 'not-allowed' : 'pointer',
        opacity: locked ? 0.38 : 1,
        transition: 'background 120ms, opacity 120ms',
        outline: active ? '1px solid color-mix(in srgb, var(--action) 40%, transparent)' : 'none',
        outlineOffset: -1,
        flexShrink: 0,
      }}
    >
      <span style={{
        width: 20, height: 20, borderRadius: '50%', flexShrink: 0,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        fontSize: 9, fontFamily: 'var(--font-mono)', fontWeight: 700,
        background: active ? 'var(--action)' : 'var(--bg-3)',
        color: active ? 'var(--action-fg)' : 'var(--text-3)',
      }}>
        {locked ? '🔒' : index + 1}
      </span>
      <span style={{
        fontSize: 12, fontFamily: 'var(--font-mono)', fontWeight: active ? 700 : 500,
        color: active ? 'var(--text-0)' : 'var(--text-2)',
        whiteSpace: 'nowrap',
      }}>
        {phase.label}
      </span>
    </button>
  )
}

// ─── PhaseCanvas ──────────────────────────────────────────────────────────────

export interface PhaseCanvasProps {
  project: Project
  memberId?: string | null
  onRefresh?: () => void
  unlockedUpTo?: number          // order_index de la última fase desbloqueada (default 1)
  unlockedContainerIdx?: number  // order_index del último contenedor desbloqueado en la fase activa (default 1)
  unlockedNodeIdx?: number       // order_index del último nodo desbloqueado en el drawer (default 1)
}

export default function PhaseCanvas({ project, unlockedUpTo = 1, onRefresh }: PhaseCanvasProps) {
  const [phases,          setPhases]          = useState<PhaseConfig[]>([])
  const [loading,         setLoading]         = useState(true)
  const [activeKey,       setActiveKey]       = useState<string | null>(null)
  const [compact,         setCompact]         = useState(true)
  const [activeContainer, setActiveContainer] = useState<PhaseContainerConfig | null>(null)
  const [scale,           setScale]           = useState(1)

  // Modales directos desde vista expandida
  const [expandedRunModal,    setExpandedRunModal]    = useState<{ container: PhaseContainerConfig; node: PhaseNodeConfig } | null>(null)
  const [expandedIdeaGen,     setExpandedIdeaGen]     = useState<{ container: PhaseContainerConfig; nodeOrderIndex: number } | null>(null)
  const [expandedMktRes,      setExpandedMktRes]      = useState<{ container: PhaseContainerConfig; nodeOrderIndex: number } | null>(null)
  const [expandedSourceModal, setExpandedSourceModal] = useState<{ containerStepKey: string; nodeStep: number } | null>(null)

  function handleNodeClick(container: PhaseContainerConfig, node: PhaseNodeConfig) {
    if (container.step_key === 'idtn_idea_generation') {
      setExpandedIdeaGen({ container, nodeOrderIndex: node.order_index })
    } else if (container.step_key === 'idtn_market_research') {
      setExpandedMktRes({ container, nodeOrderIndex: node.order_index })
    } else {
      setExpandedRunModal({ container, node })
    }
  }

  const canvasRef = useRef<HTMLDivElement>(null)
  const scrollRef = useRef<HTMLDivElement>(null)

  // Ref para evitar stale closure sobre activeContainer en el listener global
  const activeContainerRef = useRef<PhaseContainerConfig | null>(null)
  activeContainerRef.current = activeContainer

  // Wheel zoom — listener en window para evitar conflicto con overflow:auto de scrollRef
  // Solo actúa cuando el cursor está dentro del canvasRef y no hay ContainerCanvas abierto
  useEffect(() => {
    const onWheel = (e: WheelEvent) => {
      if (activeContainerRef.current) return
      if (!canvasRef.current?.contains(e.target as globalThis.Node)) return
      e.preventDefault()
      setScale(s => Math.min(Math.max(s * (e.deltaY > 0 ? 0.92 : 1.09), 0.3), 2))
    }
    window.addEventListener('wheel', onWheel, { passive: false })
    return () => window.removeEventListener('wheel', onWheel)
  }, [])

  // Cargar fases
  useEffect(() => {
    getPipelinePhases().then(data => {
      setPhases(data)
      if (data.length) setActiveKey(data[0].step_key)
    }).finally(() => setLoading(false))
  }, [])

  const activePhase = phases.find(p => p.step_key === activeKey) ?? null

  // ── Recarga fases ──────────────────────────────────────────────────────────

  const refreshPhases = useCallback(() => {
    getPipelinePhases().then(data => {
      setPhases(data)
      if (data.length && !activeKey) setActiveKey(data[0].step_key)
    })
  }, [activeKey])

  // ── Unlock dinámico desde generation_jobs ──────────────────────────────────

  // Devuelve el estado de un nodo leyendo generation_jobs
  const getNodeStatus = useCallback((stepKey: string): 'done' | 'review' | 'idle' => {
    const jobs = project.generation_jobs ?? []
    const job  = jobs.find(j => j.current_step === stepKey)
    if (!job) return 'idle'
    if (job.status === 'approved') return 'done'
    if (job.status === 'review')   return 'review'
    return 'idle'
  }, [project.generation_jobs])

  // Devuelve el order_index del último nodo accesible dentro del container
  // (todos los nodos con order_index <= resultado estarán desbloqueados)
  const getNodeUnlockIdx = useCallback((container: PhaseContainerConfig): number => {
    const jobs = project.generation_jobs ?? []
    const isDone = (sk: string) => jobs.some(j => j.current_step === sk && j.status === 'approved')
    const sorted = [...container.nodes].sort((a, b) => a.order_index - b.order_index)
    let ni = 1
    for (const n of sorted) {
      if (!isDone(n.step_key)) { ni = n.order_index; break }
      ni = n.order_index + 1
    }
    return ni
  }, [project.generation_jobs])

  // Devuelve el order_index de la última fase accesible
  // Una fase se desbloquea cuando TODOS los nodos de TODOS sus containers están aprobados
  const computedPhaseIdx = useMemo(() => {
    if (!phases.length) return 1
    const jobs   = project.generation_jobs ?? []
    const isDone = (sk: string) => jobs.some(j => j.current_step === sk && j.status === 'approved')
    const sorted = [...phases].sort((a, b) => a.order_index - b.order_index)
    let idx = 1
    for (const phase of sorted) {
      const allDone = phase.containers.every(c => c.nodes.every(n => isDone(n.step_key)))
      if (allDone) {
        idx = phase.order_index + 1
      } else {
        idx = phase.order_index
        break
      }
    }
    return idx
  }, [phases, project.generation_jobs])

  // Devuelve el order_index del último container accesible en la fase activa
  const computedContainerIdx = useMemo(() => {
    if (!activePhase) return 1
    const jobs = project.generation_jobs ?? []
    const isDone = (sk: string) => jobs.some(j => j.current_step === sk && j.status === 'approved')
    const sorted = [...activePhase.containers].sort((a, b) => a.order_index - b.order_index)
    let idx = 1
    for (const c of sorted) {
      if (c.nodes.every(n => isDone(n.step_key))) {
        idx = c.order_index + 1
      } else {
        idx = c.order_index
        break
      }
    }
    return idx
  }, [activePhase, project.generation_jobs])

  // ── Render ─────────────────────────────────────────────────────────────────

  if (loading) {
    return (
      <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <span style={{ fontSize: 11, fontFamily: 'var(--font-mono)', color: 'var(--text-3)' }}>Loading…</span>
      </div>
    )
  }

  return (
    <div style={{ position: 'fixed', inset: 0, display: 'flex', flexDirection: 'column', overflow: 'hidden', background: 'var(--bg-0, var(--bg-1))' }}>

      {/* ── Toolbar con logo, breadcrumb, theme toggle, user menu ── */}
      <ForgeToolbar project={project} phase="idle" onRefresh={refreshPhases} />

      {/* ── Vista de grafo del container ── */}
      {activeContainer && activePhase && (
        <ContainerCanvas
          container={activeContainer}
          phaseIdx={activePhase.order_index}
          project={project}
          allContainers={activePhase.containers}
          unlockedNodeIdx={getNodeUnlockIdx(activeContainer)}
          getNodeStatus={getNodeStatus}
          onBack={() => setActiveContainer(null)}
          onRefresh={onRefresh}
        />
      )}

      {/* ── Phase tabs + canvas — ocultos cuando hay container activo ── */}
      <div style={{ display: activeContainer ? 'none' : 'contents' }}>

      {/* ── Phase tabs ── */}
      <div style={{
        padding: '8px 16px', borderBottom: '1px solid var(--line-2)',
        display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 4,
        background: 'var(--bg-1)', flexShrink: 0, overflowX: 'auto',
      }}>
        {phases.map((phase, i) => {
          const locked = phase.order_index > computedPhaseIdx
          return (
            <PhaseTab
              key={phase.step_key}
              phase={phase}
              index={i}
              active={activeKey === phase.step_key}
              locked={locked}
              onClick={() => setActiveKey(phase.step_key)}
            />
          )
        })}
      </div>

      {/* ── Canvas — wrapper no-scrollable para posicionar controles fijos ── */}
      <div ref={canvasRef} style={{ flex: 1, overflow: 'hidden', position: 'relative' }}>

        {/* Fondo punteado decorativo */}
        <div style={{
          position: 'absolute', inset: 0, pointerEvents: 'none',
          backgroundImage: 'radial-gradient(circle, var(--line-2) 1px, transparent 1px)',
          backgroundSize: '28px 28px', opacity: 0.6,
        }} />

        {/* ── Toggle compact / expanded — top right (fuera del scroll) ── */}
        <div style={{
          position: 'absolute', top: 16, right: 16, zIndex: 10,
          display: 'flex', gap: 1,
          background: 'var(--bg-1)', borderRadius: 8,
          border: '1px solid var(--line-2)',
          boxShadow: '0 2px 8px rgba(0,0,0,0.2)', padding: 3,
        }}>
          {([
            { key: true,  icon: '▦', title: 'Compact'  },
            { key: false, icon: '▤', title: 'Expanded' },
          ] as const).map(({ key, icon, title }) => (
            <button key={String(key)} title={title} onClick={() => setCompact(key)} style={{
              border: 'none', borderRadius: 5, padding: '5px 11px', cursor: 'pointer',
              fontSize: 12, fontFamily: 'var(--font-mono)',
              background: compact === key ? 'var(--bg-3)' : 'transparent',
              color: compact === key ? 'var(--text-0)' : 'var(--text-3)',
              boxShadow: compact === key ? '0 1px 4px rgba(0,0,0,0.2)' : 'none',
            }}>{icon}</button>
          ))}
        </div>

        {/* ── Controles de zoom — bottom right (fuera del scroll) ── */}
        <div style={{
          position: 'absolute', bottom: 16, right: 16, zIndex: 10,
          display: 'flex', alignItems: 'center', gap: 4,
          background: 'var(--bg-1)', borderRadius: 10,
          border: '1px solid var(--line-2)',
          boxShadow: '0 2px 12px rgba(0,0,0,0.22)', padding: '5px 8px',
        }}>
          {([
            { label: '+', factor: 1.2,     title: 'Zoom in'    },
            { label: '−', factor: 1 / 1.2, title: 'Zoom out'   },
            { label: '⊡', factor: null,    title: 'Reset zoom' },
          ] as const).map(({ label, factor, title }) => (
            <button key={label} title={title}
              onClick={() => factor ? setScale(s => Math.min(Math.max(s * factor, 0.3), 2)) : setScale(1)}
              style={{
                padding: '5px 10px', borderRadius: 6, border: '1px solid var(--line-2)',
                background: 'var(--bg-2)', color: 'var(--text-1)', cursor: 'pointer',
                fontSize: 11, fontFamily: 'var(--font-mono)', fontWeight: 600,
              }}>
              {label}
            </button>
          ))}
          <span style={{ fontSize: 10, fontFamily: 'var(--font-mono)', color: 'var(--text-3)', minWidth: 32, textAlign: 'right' }}>
            {Math.round(scale * 100)}%
          </span>
        </div>

        {/* ── Scroll container — siempre montado, listener de rueda adjunto aquí ── */}
        <div
          ref={scrollRef}
          style={{ position: 'absolute', inset: 0, overflow: 'auto' }}
        >
          {activePhase && (
            <div style={{
              display: 'flex', flexDirection: 'column', alignItems: 'center',
              minWidth: '100%', minHeight: '100%',
              padding: CANVAS_PAD, boxSizing: 'border-box',
            }}>
              {/* Phase header — sin zoom */}
              <div style={{
                display: 'flex', alignItems: 'flex-start', justifyContent: 'center', gap: 20,
                marginBottom: 32, paddingBottom: 24,
                alignSelf: 'stretch', flexShrink: 0,
              }}>
                <span style={{
                  fontFamily: 'var(--font-mono)', fontSize: 56, fontWeight: 800,
                  color: 'var(--action)', opacity: 0.25, lineHeight: 1, flexShrink: 0,
                  letterSpacing: '-2px',
                }}>
                  {String(activePhase.order_index).padStart(2, '0')}
                </span>
                <div style={{ paddingTop: 6 }}>
                  <div style={{ fontSize: 24, fontWeight: 800, color: 'var(--text-0)', letterSpacing: '-0.4px', lineHeight: 1, marginBottom: 8 }}>
                    {activePhase.label}
                  </div>
                  {activePhase.description && (
                    <div style={{ fontSize: 13, color: 'var(--text-2)', lineHeight: 1.6, maxWidth: 560 }}>
                      {activePhase.description}
                    </div>
                  )}
                </div>
              </div>

              {/* Barra de progreso — sin zoom */}
              <div style={{ alignSelf: 'stretch', marginBottom: 32, flexShrink: 0 }}>
                <PhaseProgressBar
                  containers={activePhase.containers}
                  getNodeStatus={getNodeStatus}
                />
              </div>

              {/* Containers en fila — con zoom aplicado solo aquí */}
              <div style={{ zoom: scale, display: 'flex', alignItems: 'flex-start', flexShrink: 0, paddingBottom: 8 }}>
                {activePhase.containers.map((c, i) => {
                  const containerLocked = c.order_index > computedContainerIdx
                  return (
                    <React.Fragment key={c.step_key}>
                      {i > 0 && <ConnectorLine />}
                      <ContainerCard
                        container={c}
                        phaseIdx={activePhase.order_index}
                        compact={compact}
                        locked={containerLocked}
                        unlockedNodeIdx={containerLocked ? 0 : getNodeUnlockIdx(c)}
                        getNodeStatus={getNodeStatus}
                        onClick={compact && !containerLocked ? () => setActiveContainer(c) : undefined}
                        onNodeClick={!compact && !containerLocked ? n => handleNodeClick(c, n) : undefined}
                      />
                    </React.Fragment>
                  )
                })}

                {activePhase.containers.length === 0 && (
                  <div style={{ width: 360, padding: '48px 32px', borderRadius: 12, border: '1px dashed var(--line-2)', textAlign: 'center' }}>
                    <div style={{ fontSize: 28, marginBottom: 10, opacity: 0.3 }}>⬡</div>
                    <div style={{ fontSize: 12, fontFamily: 'var(--font-mono)', color: 'var(--text-3)' }}>
                      This phase has no containers yet
                    </div>
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      </div>

      </div>{/* fin display:contents */}

      {/* Modales directos desde vista expandida */}
      {expandedIdeaGen && (
        <IdeaGeneratorModal
          project={project}
          nodes={expandedIdeaGen.container.nodes}
          label={expandedIdeaGen.container.label}
          description={expandedIdeaGen.container.description}
          icon={CONTAINER_ICON[expandedIdeaGen.container.step_key] ?? '⬡'}
          initialStep={expandedIdeaGen.nodeOrderIndex}
          onClose={() => { setExpandedIdeaGen(null); onRefresh?.() }}
        />
      )}

      {expandedMktRes && (
        <MarketResearchModal
          project={project}
          nodes={expandedMktRes.container.nodes}
          label={expandedMktRes.container.label}
          description={expandedMktRes.container.description}
          icon={CONTAINER_ICON[expandedMktRes.container.step_key] ?? '⬡'}
          initialStep={expandedMktRes.nodeOrderIndex}
          onOpenSource={(key, step) => setExpandedSourceModal({ containerStepKey: key, nodeStep: step })}
          onClose={() => { setExpandedMktRes(null); onRefresh?.() }}
        />
      )}

      {/* IdeaGeneratorModal apilado al abrir "Open 1.1.3 →" desde vista expandida */}
      {expandedSourceModal && (() => {
        const src = activePhase?.containers.find(c => c.step_key === expandedSourceModal.containerStepKey)
        if (!src) return null
        return (
          <IdeaGeneratorModal
            project={project}
            nodes={src.nodes}
            label={src.label}
            description={src.description}
            icon={CONTAINER_ICON[src.step_key] ?? '⬡'}
            initialStep={expandedSourceModal.nodeStep}
            layered={true}
            onClose={() => setExpandedSourceModal(null)}
          />
        )
      })()}

      {expandedRunModal && (
        <NodeRunModal
          node={expandedRunModal.node as PipelineNodeConfig}
          container={toLegacyContainer(expandedRunModal.container)}
          containers={activePhase ? activePhase.containers.map(toLegacyContainer) : []}
          project={project}
          color='#A78BFA'
          onClose={() => setExpandedRunModal(null)}
          onApproved={() => setExpandedRunModal(null)}
        />
      )}
    </div>
  )
}
