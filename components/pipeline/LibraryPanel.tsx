'use client'

import { useState } from 'react'
import type { Node } from '@xyflow/react'
import { CAT_VAR, type ForgeNodeData, type ForgeNodeCategory } from './ForgeNode'
import type { ForgeGroupNodeData } from './ForgeGroupNode'

interface Props {
  nodes: Node[]
  selectedNodeId: string | null
  onSelect: (id: string) => void
  onFocus: (id: string) => void
  isOpen: boolean
  onToggle: () => void
}

interface OutlinerFrame {
  frameNode: Node
  children: Node[]
}

interface OutlinerSection {
  type: 'node' | 'frame'
  sortX: number
  sortY: number
  node?: Node
  frame?: OutlinerFrame
}

function buildOutliner(nodes: Node[]): OutlinerSection[] {
  const frames = nodes.filter(n => n.type === 'forgeGroup')
  const leaves = nodes.filter(n => n.type !== 'forgeGroup')

  // For each leaf, check if its center falls inside any frame
  const assignedIds = new Set<string>()
  const frameGroups: OutlinerFrame[] = frames.map(frame => {
    const fw = typeof frame.style?.width === 'number' ? frame.style.width : (frame.measured?.width ?? 600)
    const fh = typeof frame.style?.height === 'number' ? frame.style.height : (frame.measured?.height ?? 400)
    const children = leaves.filter(n => {
      const cx = n.position.x + ((n.measured?.width ?? 260) / 2)
      const cy = n.position.y + ((n.measured?.height ?? 80) / 2)
      return cx > frame.position.x && cx < frame.position.x + fw &&
             cy > frame.position.y && cy < frame.position.y + fh
    })
    children.forEach(n => assignedIds.add(n.id))
    return { frameNode: frame, children: [...children].sort(byPos) }
  })

  const ungrouped = leaves.filter(n => !assignedIds.has(n.id))

  const sections: OutlinerSection[] = [
    ...ungrouped.map(n => ({
      type: 'node' as const,
      sortX: n.position.x,
      sortY: n.position.y,
      node: n,
    })),
    ...frameGroups.map(fg => ({
      type: 'frame' as const,
      sortX: fg.frameNode.position.x,
      sortY: fg.frameNode.position.y,
      frame: fg,
    })),
  ]

  return sections.sort((a, b) => a.sortX - b.sortX || a.sortY - b.sortY)
}

function byPos(a: Node, b: Node) {
  return a.position.x - b.position.x || a.position.y - b.position.y
}

function statusDot(status: ForgeNodeData['status'], approved?: boolean) {
  if (approved) return { char: '✓', color: 'var(--cat-code)' }
  switch (status) {
    case 'complete':     return { char: '●', color: 'var(--cat-code)' }
    case 'running':      return { char: '◉', color: 'var(--cat-audio)' }
    case 'error':        return { char: '✕', color: 'var(--cat-output)' }
    case 'idle':         return { char: '●', color: 'var(--cat-design)' }
    case 'locked':
    default:             return { char: '○', color: 'var(--text-3)' }
  }
}

function NodeRow({ node, selectedId, onSelect, onFocus, indent = 0 }: {
  node: Node
  selectedId: string | null
  onSelect: (id: string) => void
  onFocus: (id: string) => void
  indent?: number
}) {
  const data = node.data as unknown as ForgeNodeData
  const color = CAT_VAR[data.category as ForgeNodeCategory] ?? 'var(--text-3)'
  const dot = statusDot(data.status, data.approved)
  const isSelected = selectedId === node.id

  return (
    <div
      className={`lib-item${isSelected ? ' active' : ''}`}
      style={{ '--item-color': color, paddingLeft: 12 + indent * 14 } as React.CSSProperties}
      onClick={() => { onSelect(node.id); onFocus(node.id) }}
    >
      <span style={{ fontSize: 9, color: dot.color, flexShrink: 0 }}>{dot.char}</span>
      <span className="lib-item-label">{data.label}</span>
      <span className="lib-meta" style={{ color }}>#{data.num}</span>
    </div>
  )
}

export default function LibraryPanel({ nodes, selectedNodeId, onSelect, onFocus, isOpen, onToggle }: Props) {
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({})
  const toggle = (id: string) => setCollapsed(p => ({ ...p, [id]: !p[id] }))

  const sections = buildOutliner(nodes)

  return (
    <aside className="forge-library">
      <button className="lib-collapse-btn" onClick={onToggle} title={isOpen ? 'Collapse' : 'Expand'}>
        {isOpen ? '‹' : '›'}
      </button>

      {isOpen && (
        <>
          <div className="lib-panel-title">CANVAS</div>

          {sections.length === 0 && (
            <div style={{ padding: '12px 14px', fontSize: 10, color: 'var(--text-3)', fontFamily: 'var(--font-mono)' }}>
              No nodes yet. Right-click the canvas to add.
            </div>
          )}

          {sections.map((section, i) => {
            if (section.type === 'node' && section.node) {
              return (
                <NodeRow
                  key={section.node.id}
                  node={section.node}
                  selectedId={selectedNodeId}
                  onSelect={onSelect}
                  onFocus={onFocus}
                />
              )
            }

            if (section.type === 'frame' && section.frame) {
              const { frameNode, children } = section.frame
              const frameData = frameNode.data as unknown as ForgeGroupNodeData
              const frameId = frameNode.id
              const isOpen = !collapsed[frameId]

              return (
                <div key={frameId} className="lib-frame-group">
                  <button
                    className={`lib-frame-header${selectedNodeId === frameId ? ' active' : ''}`}
                    style={{ '--frame-color': frameData.color } as React.CSSProperties}
                    onClick={() => { toggle(frameId); onSelect(frameId); onFocus(frameId) }}
                  >
                    <span className="lib-chevron">{isOpen ? '▾' : '▸'}</span>
                    <span className="lib-frame-label">{frameData.label}</span>
                    <span className="lib-frame-count">{children.length}</span>
                  </button>

                  {isOpen && children.map(child => (
                    <NodeRow
                      key={child.id}
                      node={child}
                      selectedId={selectedNodeId}
                      onSelect={onSelect}
                      onFocus={onFocus}
                      indent={1}
                    />
                  ))}
                </div>
              )
            }

            return null
          })}
        </>
      )}
    </aside>
  )
}
