'use client'

import { memo } from 'react'
import { Handle, Position } from '@xyflow/react'
import { CATEGORY_COLOR, type NodeCategory, type PipelineNodeStatus } from '../constants'

export interface AINodeData {
  label: string
  category: NodeCategory
  status: PipelineNodeStatus
  inputs: string[]
  outputs: string[]
  description?: string
  comingSoon?: boolean
}

const STATUS_RING: Record<PipelineNodeStatus, string> = {
  idle: 'border-[#2a2a2a]',
  running: 'border-blue-500 animate-pulse',
  awaiting_approval: 'border-orange-500',
  approved: 'border-green-600',
  rejected: 'border-red-600',
  error: 'border-red-700',
  locked: 'border-[#1a1a1a]',
}

const STATUS_BADGE: Record<PipelineNodeStatus, { label: string; color: string }> = {
  idle: { label: 'Idle', color: '#4b5563' },
  running: { label: 'Generating…', color: '#3b82f6' },
  awaiting_approval: { label: 'Awaiting Review', color: '#ea580c' },
  approved: { label: 'Approved', color: '#16a34a' },
  rejected: { label: 'Rejected', color: '#dc2626' },
  error: { label: 'Error', color: '#dc2626' },
  locked: { label: 'Locked', color: '#374151' },
}

function AINode({ data }: { data: AINodeData }) {
  const color = CATEGORY_COLOR[data.category]
  const ring = STATUS_RING[data.status]
  const badge = STATUS_BADGE[data.status]
  const isLocked = data.status === 'locked' || data.comingSoon

  return (
    <div
      className={`relative rounded-xl border-2 ${ring} transition-all duration-300 select-none group`}
      style={{
        background: '#111111',
        width: 220,
        cursor: 'pointer',
        boxShadow: data.status === 'approved'
          ? `0 0 20px ${color}33`
          : data.status === 'running'
          ? '0 0 20px #3b82f633'
          : 'none',
        opacity: isLocked ? 0.5 : 1,
      }}
    >
      {/* Left color accent bar */}
      <div
        className="absolute left-0 top-3 bottom-3 w-1 rounded-full"
        style={{ background: color }}
      />

      {/* Header */}
      <div className="px-4 pt-3 pb-2 pl-5">
        <div className="flex items-center justify-between gap-2">
          <span className="text-xs font-bold uppercase tracking-widest" style={{ color }}>
            {data.label}
          </span>
          {data.status === 'running' && (
            <span className="flex gap-0.5">
              {[0, 1, 2].map((i) => (
                <span
                  key={i}
                  className="w-1 h-1 rounded-full bg-blue-400 animate-bounce"
                  style={{ animationDelay: `${i * 0.15}s` }}
                />
              ))}
            </span>
          )}
        </div>
        {data.description && (
          <p className="text-[10px] text-[#555] mt-0.5 leading-tight">{data.description}</p>
        )}
      </div>

      {/* Divider */}
      <div className="h-px mx-4" style={{ background: `${color}22` }} />

      {/* Ports */}
      <div className="px-4 py-2.5 pl-5 flex flex-col gap-1.5">
        {data.inputs.map((inp) => (
          <div key={inp} className="flex items-center gap-1.5 text-[10px] text-[#666]">
            <span className="w-1.5 h-1.5 rounded-full flex-shrink-0" style={{ background: `${color}88` }} />
            {inp}
          </div>
        ))}
        {data.outputs.map((out) => (
          <div key={out} className="flex items-center justify-end gap-1.5 text-[10px] text-[#666]">
            {out}
            <span className="w-1.5 h-1.5 rounded-full flex-shrink-0" style={{ background: color }} />
          </div>
        ))}
      </div>

      {/* Status badge */}
      <div className="px-4 pb-3 pl-5">
        <span
          className="text-[9px] font-semibold uppercase tracking-wider px-2 py-0.5 rounded-full"
          style={{ background: `${badge.color}22`, color: badge.color }}
        >
          {data.comingSoon ? 'Coming Soon' : badge.label}
        </span>
      </div>

      {/* React Flow handles */}
      <Handle
        type="target"
        position={Position.Left}
        style={{ background: `${color}88`, border: 'none', width: 8, height: 8, left: -4 }}
      />
      <Handle
        type="source"
        position={Position.Right}
        style={{ background: color, border: 'none', width: 8, height: 8, right: -4 }}
      />
    </div>
  )
}

export default memo(AINode)
