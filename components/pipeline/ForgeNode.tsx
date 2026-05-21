'use client'

import React, { memo, useEffect } from 'react'
import { Handle, Position, useUpdateNodeInternals } from '@xyflow/react'

export type ForgeNodeStatus = 'idle' | 'running' | 'review' | 'complete' | 'error' | 'locked' | 'pending_review'

export type ForgeNodeCategory =
  | 'design' | 'asset' | 'level' | 'code'
  | 'audio'  | 'output' | 'test' | 'input'

export const CAT_VAR: Record<ForgeNodeCategory, string> = {
  design: 'var(--cat-design)',
  asset:  'var(--cat-asset)',
  level:  'var(--cat-level)',
  code:   'var(--cat-code)',
  audio:  'var(--cat-audio)',
  output: 'var(--cat-output)',
  test:   'var(--cat-test)',
  input:  'var(--cat-input)',
}

/* Data-type palette — what each category's output socket produces */
export const TYPE_VAR: Record<ForgeNodeCategory, string> = {
  design: 'var(--type-text)',
  asset:  'var(--type-image)',
  level:  'var(--type-3d)',
  code:   'var(--type-code)',
  audio:  'var(--type-audio)',
  output: 'var(--type-final)',
  test:   'var(--type-code)',
  input:  'var(--type-text)',
}

/* Role rail color — 2px left-edge strip indicating the agent role */
function roleRailColor(category: ForgeNodeCategory): string {
  switch (category) {
    case 'output': return 'var(--action)'
    case 'input':  return 'var(--accent-violet)'
    default:       return 'var(--accent-blue)'
  }
}

export interface ForgePort {
  id: string
  label: string
}

export type PreviewType = 'code' | 'waveform' | 'sprite' | 'tilemap' | 'text' | 'progress' | 'none'

export interface ForgeNodeData {
  label: string
  category: ForgeNodeCategory
  icon: string        // 2-char display in node icon box
  num: string         // "01" "02" etc
  status: ForgeNodeStatus
  rows?: { key: string; value: string; accent?: boolean }[]
  inputs?: ForgePort[]
  outputs?: ForgePort[]
  description?: string
  previewType?: PreviewType
  previewContent?: string
  comingSoon?: boolean
  compact?: boolean
  stepKey?: string
  approved?: boolean
  stale?: boolean
}

const BADGE: React.CSSProperties = {
  fontFamily: 'var(--font-mono)', lineHeight: 1.2, borderRadius: 99,
  padding: '1px 6px', fontSize: 9, whiteSpace: 'nowrap',
}
const BADGE_SM: React.CSSProperties = { ...BADGE, padding: '1px 4px', fontSize: 8 }

function NodeStatusBadge({ status, approved, compact }: {
  status: ForgeNodeStatus; approved?: boolean; compact?: boolean
}) {
  const s = compact ? BADGE_SM : BADGE
  if (approved || status === 'complete') return (
    <span style={{ ...s, fontWeight: 700, color: 'var(--state-success)', background: 'color-mix(in oklch, var(--state-success) 14%, transparent)', border: '1px solid color-mix(in oklch, var(--state-success) 38%, transparent)' }}>
      ✓{!compact && ' done'}
    </span>
  )
  if (status === 'pending_review') return (
    <span style={{ ...s, color: 'var(--state-human)', background: 'color-mix(in oklch, var(--state-human) 12%, transparent)', border: '1px solid color-mix(in oklch, var(--state-human) 35%, transparent)', animation: 'led-pulse 1.8s ease-in-out infinite', display: 'inline-block' }}>
      ◈{!compact && ' review'}
    </span>
  )
  if (status === 'running') return (
    <span style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--accent-teal)', animation: 'ledPulse 0.8s infinite', lineHeight: 1 }}>⟳</span>
  )
  if (status === 'error') return (
    <span style={{ ...s, fontWeight: 700, color: 'var(--state-error)', background: 'color-mix(in oklch, var(--state-error) 12%, transparent)', border: '1px solid color-mix(in oklch, var(--state-error) 35%, transparent)' }}>
      ✕{!compact && ' error'}
    </span>
  )
  if (status === 'locked') return (
    <span style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color: 'var(--text-3)', lineHeight: 1, userSelect: 'none' }}>⊘</span>
  )
  // idle — dot LED
  return <div className="node-led" />
}

function Preview({ type, content, color }: { type: PreviewType; content?: string; color: string }) {
  if (type === 'none' || !type) return null

  if (type === 'code') return (
    <pre className="preview-code" style={{ color: 'var(--text-2)', fontSize: 9, lineHeight: 1.45, maxHeight: 52, overflow: 'hidden' }}>
      {content ?? '// waiting for generation…'}
    </pre>
  )

  if (type === 'waveform') return (
    <div style={{ display: 'flex', alignItems: 'flex-end', gap: 1, height: 32 }}>
      {Array.from({ length: 28 }).map((_, i) => {
        const h = content
          ? (20 + Math.abs(Math.sin(i * 0.8) * 18 + Math.cos(i * 1.3) * 10)) + 'px'
          : (4 + (i % 3) * 3) + 'px'
        return (
          <div key={i} style={{
            flex: 1, borderRadius: 1,
            height: h,
            background: color,
            opacity: content ? 0.7 : 0.3,
          }} />
        )
      })}
    </div>
  )

  if (type === 'sprite') return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(6,1fr)', gap: 2 }}>
      {Array.from({ length: 6 }).map((_, i) => (
        <div key={i} style={{
          aspectRatio: '1', borderRadius: 2,
          background: content ? color + '22' : 'var(--bg-3)',
          border: content ? `1px solid ${color}44` : '1px solid var(--line)',
          display: 'grid', placeItems: 'center',
          fontSize: 8, color: content ? color : 'var(--text-3)',
        }}>
          {content ? '●' : '·'}
        </div>
      ))}
    </div>
  )

  if (type === 'tilemap') return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(14,1fr)', gap: 1 }}>
      {Array.from({ length: 28 }).map((_, i) => (
        <div key={i} style={{
          aspectRatio: '1', borderRadius: 1,
          background: content
            ? (i % 3 === 0 ? color + '44' : i % 5 === 0 ? color + '22' : 'var(--bg-3)')
            : 'var(--bg-3)',
        }} />
      ))}
    </div>
  )

  if (type === 'progress') {
    const pct = content ? parseInt(content) : 0
    return (
      <div>
        <div style={{ height: 4, background: 'var(--bg-3)', borderRadius: 2, overflow: 'hidden', marginBottom: 4 }}>
          <div style={{ height: '100%', width: `${pct}%`, background: color, transition: 'width 400ms' }} />
        </div>
        <span style={{ fontSize: 9, color: 'var(--text-3)' }}>{pct}% complete</span>
      </div>
    )
  }

  if (type === 'text') return (
    <p style={{ fontSize: 9, lineHeight: 1.5, color: 'var(--text-2)', overflow: 'hidden', maxHeight: 48 }}>
      {content ?? 'Awaiting generation…'}
    </p>
  )

  return null
}

function ForgeNode({ id, data, selected }: { id: string; data: ForgeNodeData; selected: boolean }) {
  const color     = CAT_VAR[data.category]
  const typeColor = TYPE_VAR[data.category]
  const updateNodeInternals = useUpdateNodeInternals()
  useEffect(() => { updateNodeInternals(id) }, [id, updateNodeInternals])

  const stateClass = [
    'forge-node',
    data.compact                   ? 'compact' : '',
    data.status === 'running'        ? 'running' : '',
    data.status === 'complete'       ? 'complete' : '',
    data.status === 'error'          ? 'error' : '',
    data.status === 'locked'         ? 'locked' : '',
    data.status === 'pending_review' ? 'pending-review' : '',
    data.approved                    ? 'approved' : '',
    selected                       ? 'selected' : '',
  ].filter(Boolean).join(' ')

  const hasPreview = !data.compact && data.previewType && data.previewType !== 'none'
  const rows = data.compact ? (data.rows ?? []).slice(0, 1) : (data.rows ?? [])

  return (
    <div
      className={stateClass}
      style={{ '--node-color': color, '--socket-color': typeColor } as React.CSSProperties}
    >
      {/* Role rail — 2px left edge strip colored by agent role */}
      <div style={{
        position: 'absolute', left: 0, top: 0, bottom: 0, width: 2,
        background: roleRailColor(data.category),
        borderRadius: '7px 0 0 7px',
        zIndex: 1, pointerEvents: 'none',
      }} />
      {/* Stale warning overlay */}
      {data.stale && (
        <div style={{
          position: 'absolute', top: 4, right: 4, zIndex: 10,
          background: 'color-mix(in oklch, var(--state-warning) 15%, var(--bg-2))',
          border: '1px solid color-mix(in oklch, var(--state-warning) 45%, transparent)',
          borderRadius: 4, padding: '1px 5px',
          fontFamily: 'var(--font-mono)', fontSize: 8,
          color: 'var(--state-warning)', pointerEvents: 'none',
        }}>⚠ stale</div>
      )}

      {/* Header */}
      <div className="node-header">
        <div className="node-icon">{data.icon}</div>
        <div className="node-title">{data.label}</div>
        {!data.compact && data.num && <div className="node-num">#{data.num}</div>}
        <NodeStatusBadge status={data.status} approved={data.approved} compact={data.compact} />
      </div>

      {/* Description */}
      {!data.compact && data.description && (
        <div className="node-desc">{data.description}</div>
      )}

      {/* Body rows */}
      {rows.length > 0 && (
        <div className="node-body">
          {rows.map((r, i) => (
            <div key={i} className="node-row">
              <span className="k">{r.key}</span>
              <span className={`v${r.accent ? ' accent' : ''}`}>{r.value}</span>
            </div>
          ))}
        </div>
      )}

      {/* Coming soon badge (compact mode) */}
      {data.compact && data.comingSoon && (
        <div style={{
          padding: '2px 8px 4px',
          fontFamily: 'var(--font-mono)', fontSize: 8,
          color: 'var(--text-3)', letterSpacing: '0.05em',
        }}>COMING SOON</div>
      )}

      {/* Preview area (full nodes only) */}
      {hasPreview && (
        <div className="node-preview" style={{ '--node-color': color } as React.CSSProperties}>
          {data.comingSoon ? (
            <span style={{ fontSize: 9, color: 'var(--text-3)', fontFamily: 'var(--font-mono)' }}>COMING SOON</span>
          ) : (
            <Preview type={data.previewType!} content={data.previewContent} color={`var(--cat-${data.category})`} />
          )}
        </div>
      )}

      {/* Input handle — rendered outside node-ports so top is relative to node root */}
      {!data.compact && (data.inputs ?? []).length > 0 && (
        <Handle
          type="target"
          position={Position.Left}
          style={{ '--socket-color': typeColor, top: '20px' } as React.CSSProperties}
        />
      )}

      {/* Port labels + output handle */}
      {!data.compact && (
        <div className="node-ports">
          <div className="node-port node-port--in">
            <span className="port-label">{data.inputs?.[0]?.label}</span>
          </div>
          <div className="node-port node-port--out">
            <span className="port-label">{data.outputs?.[0]?.label}</span>
            {(data.outputs ?? []).length > 0 && (
              <Handle
                type="source"
                position={Position.Right}
                style={{ '--socket-color': typeColor } as React.CSSProperties}
              />
            )}
          </div>
        </div>
      )}

      {/* Compact mode handles (no labels) */}
      {data.compact && (data.inputs ?? []).length > 0 && (
        <Handle
          type="target"
          position={Position.Left}
          style={{ '--socket-color': typeColor, top: '20px' } as React.CSSProperties}
        />
      )}
      {data.compact && (data.outputs ?? []).length > 0 && (
        <Handle
          type="source"
          position={Position.Right}
          style={{ '--socket-color': typeColor } as React.CSSProperties}
        />
      )}
    </div>
  )
}

export default memo(ForgeNode)
