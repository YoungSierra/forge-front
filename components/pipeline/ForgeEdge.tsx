'use client'

import { memo } from 'react'
import { getBezierPath, EdgeLabelRenderer, type EdgeProps } from '@xyflow/react'

const FORGYI_CLR = '#F59E0B'

const FORGYI_KF = `
@keyframes forgyi-flow {
  from { stroke-dashoffset: 28; }
  to   { stroke-dashoffset: 0; }
}
@keyframes forgyi-pulse {
  0%, 100% { opacity: 0.18; }
  50%       { opacity: 0.52; }
}
`

export interface ForgeEdgeData extends Record<string, unknown> {
  color?:    string
  active?:   boolean
  approved?: boolean
  dimmed?:   boolean
  onDelete?: () => void
}

function ForgeEdge({
  id, sourceX, sourceY, targetX, targetY,
  sourcePosition, targetPosition,
  data, style, selected,
}: EdgeProps) {
  const d        = data as ForgeEdgeData
  const onDelete = d?.onDelete
  const approved = d?.approved ?? false
  const active   = d?.active   ?? false
  const dimmed   = d?.dimmed   ?? false
  const color    = approved ? FORGYI_CLR : (d?.color ?? (style?.stroke as string) ?? 'var(--text-3)')
  const edgeColor = selected ? '#EF4444' : color

  const [edgePath, labelX, labelY] = getBezierPath({
    sourceX, sourceY, targetX, targetY,
    sourcePosition, targetPosition,
  })

  return (
    <>
      {approved && <style>{FORGYI_KF}</style>}
      <g style={{ opacity: dimmed ? 0.07 : 1, transition: 'opacity 120ms ease' }}>
        {/* Hit area */}
        <path
          d={edgePath}
          fill="none"
          stroke="transparent"
          strokeWidth={14}
          style={{ cursor: 'pointer', pointerEvents: 'all' }}
        />

        {approved ? (
          <>
            {/* Glow exterior pulsante */}
            <path
              className="forge-edge-fx"
              d={edgePath}
              fill="none"
              stroke={FORGYI_CLR}
              strokeWidth={8}
              strokeLinecap="round"
              style={{
                filter: 'blur(6px)',
                animation: 'forgyi-pulse 1.8s ease-in-out infinite',
              }}
            />
            {/* Cable base — semitransparente */}
            <path
              d={edgePath}
              fill="none"
              stroke={FORGYI_CLR}
              strokeWidth={1.5}
              opacity={0.35}
              strokeLinecap="round"
            />
            {/* Dashes animados que fluyen */}
            <path
              className="forge-edge-fx"
              d={edgePath}
              fill="none"
              stroke={FORGYI_CLR}
              strokeWidth={2}
              strokeDasharray="10 18"
              strokeLinecap="round"
              style={{
                filter: `drop-shadow(0 0 5px ${FORGYI_CLR})`,
                animation: 'forgyi-flow 1s linear infinite',
              }}
            />
          </>
        ) : (
          <>
            {/* Glow estático */}
            <path
              className="forge-edge-fx"
              d={edgePath}
              fill="none"
              stroke={edgeColor}
              strokeWidth={active || selected ? 3 : 2}
              opacity={active || selected ? 0.35 : 0.1}
              strokeLinecap="round"
              style={{ filter: 'blur(3px)' }}
            />
            {/* Cable principal */}
            <path
              id={id}
              d={edgePath}
              fill="none"
              stroke={edgeColor}
              strokeWidth={active || selected ? 2 : 1.6}
              opacity={selected ? 0.95 : active ? 0.85 : 0.5}
              strokeLinecap="round"
              style={{ filter: `drop-shadow(0 0 3px ${edgeColor})` }}
            />
          </>
        )}
      </g>

      {selected && (
        <EdgeLabelRenderer>
          <button
            className="nodrag nopan"
            onClick={() => onDelete?.()}
            title="Delete edge"
            style={{
              position: 'absolute',
              transform: `translate(-50%, -50%) translate(${labelX}px,${labelY}px)`,
              pointerEvents: 'all',
              width: 18, height: 18, borderRadius: '50%',
              border: `1px solid ${approved ? FORGYI_CLR : '#EF4444'}`,
              background: 'var(--bg-1)',
              color: approved ? FORGYI_CLR : '#EF4444',
              fontSize: 12, fontWeight: 700,
              cursor: 'pointer',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              lineHeight: 1, padding: 0,
              boxShadow: `0 0 8px ${approved ? FORGYI_CLR + '55' : '#EF444455'}`,
            }}
          >
            ×
          </button>
        </EdgeLabelRenderer>
      )}
    </>
  )
}

export default memo(ForgeEdge)
