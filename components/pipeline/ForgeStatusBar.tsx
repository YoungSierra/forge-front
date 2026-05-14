'use client'

import type { Node, Edge } from '@xyflow/react'

interface Props {
  nodes: Node[]
  edges: Edge[]
  selectedId: string | null
  log: string
  zoom?: number
}

export default function ForgeStatusBar({ nodes, edges, selectedId, log, zoom }: Props) {
  const zoomPct = zoom ? Math.round(zoom * 100) : 100

  return (
    <footer className="forge-statusbar">
      <div className="sb-item">
        <span className="lbl">nodes</span>
        <span>{nodes.length}</span>
      </div>
      <div className="sb-item">
        <span className="lbl">edges</span>
        <span>{edges.length}</span>
      </div>
      <div className="sb-item">
        <span className="lbl">zoom</span>
        <span>{zoomPct}%</span>
      </div>
      {selectedId && (
        <div className="sb-item">
          <span className="lbl">sel</span>
          <span style={{ color: 'var(--text-1)' }}>{selectedId}</span>
        </div>
      )}
      <div className="sb-spacer" />
      {log && <div className="sb-log">› {log}</div>}
      <div className="sb-item" style={{ marginLeft: 'auto' }}>
        <span style={{ color: 'var(--text-3)' }}>Forge AI Pipeline</span>
      </div>
    </footer>
  )
}
