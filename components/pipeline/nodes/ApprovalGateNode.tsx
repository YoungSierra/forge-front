'use client'

import { memo } from 'react'
import { Handle, Position } from '@xyflow/react'
import type { PipelineNodeStatus } from '../constants'

export interface ApprovalGateNodeData {
  label: string
  status: PipelineNodeStatus
  artifactType?: 'text' | 'image' | 'code' | 'audio'
  onApprove?: () => void
  onReject?: () => void
  comingSoon?: boolean
}

const GATE_STYLES: Record<PipelineNodeStatus, { border: string; glow: string; pulse: boolean }> = {
  idle: { border: '#ea580c55', glow: 'none', pulse: false },
  locked: { border: '#2a2a2a', glow: 'none', pulse: false },
  running: { border: '#ea580c88', glow: 'none', pulse: false },
  awaiting_approval: { border: '#ea580c', glow: '0 0 24px #ea580c55', pulse: true },
  approved: { border: '#16a34a', glow: '0 0 20px #16a34a44', pulse: false },
  rejected: { border: '#dc2626', glow: '0 0 20px #dc262644', pulse: false },
  error: { border: '#dc2626', glow: 'none', pulse: false },
}

const STATUS_LABEL: Record<PipelineNodeStatus, string> = {
  idle: 'Waiting',
  locked: 'Locked',
  running: 'Processing',
  awaiting_approval: 'Needs Review',
  approved: 'Approved',
  rejected: 'Rejected',
  error: 'Error',
}

function ApprovalGateNode({ data }: { data: ApprovalGateNodeData }) {
  const style = GATE_STYLES[data.status] ?? GATE_STYLES.idle
  const isPending = data.status === 'awaiting_approval'
  const isLocked = data.status === 'locked'

  return (
    <div
      style={{
        width: 180,
        opacity: isLocked ? 0.45 : 1,
      }}
    >
      {/* Hexagonal clip container */}
      <div
        className="relative flex flex-col items-center justify-center"
        style={{
          background: '#0f0f0f',
          border: `2px solid ${style.border}`,
          boxShadow: style.glow,
          clipPath: 'polygon(12px 0%, calc(100% - 12px) 0%, 100% 12px, 100% calc(100% - 12px), calc(100% - 12px) 100%, 12px 100%, 0% calc(100% - 12px), 0% 12px)',
          animation: style.pulse ? 'gatePulse 2s ease-in-out infinite' : 'none',
          padding: '14px 16px',
          cursor: 'pointer',
        }}
      >
        {/* Shield icon + label */}
        <div className="flex items-center gap-1.5 mb-2">
          <svg width="10" height="12" viewBox="0 0 10 12" fill="none">
            <path
              d="M5 0L0 2.5V6C0 9 2.5 11.5 5 12C7.5 11.5 10 9 10 6V2.5L5 0Z"
              fill={style.border}
              opacity="0.9"
            />
          </svg>
          <span className="text-[9px] font-bold uppercase tracking-[0.15em]" style={{ color: style.border }}>
            Approval Gate
          </span>
        </div>

        <div className="text-[11px] font-semibold text-[#cccccc] text-center mb-2">
          {data.label}
        </div>

        {/* Status */}
        <div
          className="text-[9px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-full mb-2"
          style={{
            background: `${style.border}22`,
            color: style.border,
          }}
        >
          {STATUS_LABEL[data.status]}
        </div>

        {/* Action buttons — only shown when awaiting */}
        {isPending && (
          <div className="flex gap-1.5 mt-1">
            <button
              onClick={data.onApprove}
              className="text-[9px] font-bold uppercase tracking-wider px-2.5 py-1 rounded transition-colors"
              style={{ background: 'color-mix(in oklch, var(--action) 18%, transparent)', color: 'var(--action)', border: '1px solid color-mix(in oklch, var(--action) 40%, transparent)' }}
            >
              Approve
            </button>
            <button
              onClick={data.onReject}
              className="text-[9px] font-bold uppercase tracking-wider px-2.5 py-1 rounded transition-colors"
              style={{ background: '#dc262633', color: '#dc2626', border: '1px solid #dc262666' }}
            >
              Reject
            </button>
          </div>
        )}

        {data.status === 'approved' && (
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none" className="mt-1">
            <circle cx="8" cy="8" r="7" stroke="#16a34a" strokeWidth="1.5" />
            <path d="M4.5 8L7 10.5L11.5 6" stroke="#16a34a" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        )}

        {data.status === 'rejected' && (
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none" className="mt-1">
            <circle cx="8" cy="8" r="7" stroke="#dc2626" strokeWidth="1.5" />
            <path d="M5.5 5.5L10.5 10.5M10.5 5.5L5.5 10.5" stroke="#dc2626" strokeWidth="1.5" strokeLinecap="round" />
          </svg>
        )}
      </div>

      {/* React Flow handles */}
      <Handle
        type="target"
        position={Position.Left}
        style={{ background: style.border, border: 'none', width: 8, height: 8, left: -4 }}
      />
      <Handle
        type="source"
        position={Position.Right}
        style={{ background: style.border, border: 'none', width: 8, height: 8, right: -4 }}
      />
    </div>
  )
}

export default memo(ApprovalGateNode)
