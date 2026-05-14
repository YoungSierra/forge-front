'use client'

import { memo } from 'react'
import { getBezierPath, type EdgeProps } from '@xyflow/react'

export interface ForgeEdgeData extends Record<string, unknown> {
  color?: string
  active?: boolean
}

function ForgeEdge({
  id, sourceX, sourceY, targetX, targetY,
  sourcePosition, targetPosition,
  data, style,
}: EdgeProps) {
  const color = (data as ForgeEdgeData)?.color ?? (style?.stroke as string) ?? 'var(--text-3)'
  const active = (data as ForgeEdgeData)?.active ?? false

  const [edgePath] = getBezierPath({
    sourceX, sourceY, targetX, targetY,
    sourcePosition, targetPosition,
  })

  return (
    <g>
      {/* Glow layer */}
      <path
        d={edgePath}
        fill="none"
        stroke={color}
        strokeWidth={active ? 3 : 2}
        opacity={active ? 0.25 : 0.1}
        strokeLinecap="round"
        style={{ filter: `blur(3px)` }}
      />
      {/* Main cable */}
      <path
        id={id}
        d={edgePath}
        fill="none"
        stroke={color}
        strokeWidth={active ? 2 : 1.6}
        opacity={active ? 0.85 : 0.5}
        strokeLinecap="round"
        style={{ filter: `drop-shadow(0 0 3px ${color})` }}
      />
    </g>
  )
}

export default memo(ForgeEdge)
