'use client'

import { memo } from 'react'
import { Handle, Position } from '@xyflow/react'
import type { PipelineNodeStatus } from '../constants'

export interface ExportNodeData {
  status: PipelineNodeStatus
  locked: boolean
  pendingGates: string[]
  onExport?: () => void
}

function ExportNode({ data }: { data: ExportNodeData }) {
  const isReady = !data.locked && data.status !== 'locked'
  const isRunning = data.status === 'running'
  const isDone = data.status === 'approved'

  return (
    <div
      className="relative rounded-xl border-2 transition-all duration-300"
      style={{
        background: '#111111',
        width: 200,
        borderColor: isDone ? '#16a34a' : isReady ? '#dc2626' : '#2a2a2a',
        boxShadow: isDone
          ? '0 0 24px #16a34a44'
          : isReady
          ? '0 0 20px #dc262644'
          : 'none',
        opacity: data.locked ? 0.45 : 1,
      }}
    >
      <div className="absolute left-0 top-3 bottom-3 w-1 rounded-full" style={{ background: '#dc2626' }} />

      <div className="px-4 pt-3 pb-2 pl-5">
        <div className="flex items-center gap-2">
          {data.locked ? (
            <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
              <rect x="2" y="5" width="8" height="6" rx="1" stroke="#6b7280" strokeWidth="1.2" />
              <path d="M4 5V3.5C4 2.12 4.9 1 6 1C7.1 1 8 2.12 8 3.5V5" stroke="#6b7280" strokeWidth="1.2" strokeLinecap="round" />
            </svg>
          ) : (
            <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
              <rect x="2" y="5" width="8" height="6" rx="1" stroke="#dc2626" strokeWidth="1.2" />
              <path d="M2 5V3.5C2 2.12 2.9 1 4 1C5.1 1 6 2.12 6 3.5V5" stroke="#dc2626" strokeWidth="1.2" strokeLinecap="round" />
            </svg>
          )}
          <span
            className="text-xs font-bold uppercase tracking-widest"
            style={{ color: data.locked ? '#6b7280' : '#dc2626' }}
          >
            Export
          </span>
          {isRunning && (
            <span className="flex gap-0.5 ml-auto">
              {[0, 1, 2].map((i) => (
                <span key={i} className="w-1 h-1 rounded-full bg-red-400 animate-bounce" style={{ animationDelay: `${i * 0.15}s` }} />
              ))}
            </span>
          )}
        </div>
      </div>

      <div className="h-px mx-4" style={{ background: '#dc262622' }} />

      <div className="px-4 py-2.5 pl-5">
        <div className="flex flex-col gap-1">
          {['Build (.zip)', 'Itch.io Package', 'Web Build'].map((out) => (
            <div key={out} className="flex items-center justify-end gap-1.5 text-[10px] text-[#666]">
              {out}
              <span className="w-1.5 h-1.5 rounded-full" style={{ background: isDone ? '#16a34a' : '#dc262644' }} />
            </div>
          ))}
        </div>
      </div>

      <div className="px-4 pb-3 pl-5">
        {data.locked ? (
          <div>
            <span className="text-[9px] text-[#555] uppercase tracking-wider">
              Waiting for:
            </span>
            <div className="flex flex-wrap gap-1 mt-1">
              {data.pendingGates.map((g) => (
                <span key={g} className="text-[8px] px-1.5 py-0.5 rounded bg-orange-500/10 text-orange-400 border border-orange-500/20">
                  {g}
                </span>
              ))}
            </div>
          </div>
        ) : isDone ? (
          <span className="text-[9px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-full bg-green-500/10 text-green-400">
            Exported
          </span>
        ) : (
          <button
            onClick={data.onExport}
            className="w-full text-[10px] font-bold uppercase tracking-wider py-1.5 rounded transition-colors"
            style={{ background: '#dc262622', color: '#dc2626', border: '1px solid #dc262644' }}
          >
            Export Project
          </button>
        )}
      </div>

      <Handle
        type="target"
        position={Position.Left}
        style={{ background: '#dc2626', border: 'none', width: 8, height: 8, left: -4 }}
      />
    </div>
  )
}

export default memo(ExportNode)
