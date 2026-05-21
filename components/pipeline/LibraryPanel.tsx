'use client'

import { useState, useRef, useEffect, useCallback } from 'react'
import type { Node } from '@xyflow/react'
import { CAT_VAR, type ForgeNodeData, type ForgeNodeCategory } from './ForgeNode'
import type { ForgeGroupNodeData } from './ForgeGroupNode'
import type { Project } from '@/lib/types'
import ExportModal from '@/components/shared/ExportModal'

interface Props {
  nodes: Node[]
  selectedNodeId: string | null
  onSelect: (id: string) => void
  onFocus: (id: string) => void
  isOpen: boolean
  onToggle: () => void
  width?: number
  onWidthChange?: (w: number) => void
  project?: Project | null
  onProjectRepoSaved?: () => void
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

function statusDot(status: ForgeNodeData['status'], approved?: boolean): { char: string; color: string; pulse?: boolean } {
  if (approved) return { char: '✓', color: 'var(--cat-code)' }
  switch (status) {
    case 'complete':        return { char: '✓', color: 'var(--cat-code)' }
    case 'pending_review':  return { char: '◈', color: 'var(--state-human)', pulse: true }
    case 'running':         return { char: '⟳', color: 'var(--state-running)', pulse: true }
    case 'error':           return { char: '✕', color: 'var(--state-error)' }
    case 'idle':            return { char: '●', color: 'var(--cat-design)' }
    case 'locked':
    default:                return { char: '○', color: 'var(--text-3)' }
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
      <span style={{ fontSize: 9, color: dot.color, flexShrink: 0, ...(dot.pulse ? { animation: 'led-pulse 1.8s ease-in-out infinite', display: 'inline-block' } : {}) }}>{dot.char}</span>
      <span className="lib-item-label">{data.label}</span>
      <span className="lib-meta" style={{ color }}>#{data.num}</span>
    </div>
  )
}

export default function LibraryPanel({ nodes, selectedNodeId, onSelect, onFocus, isOpen, onToggle, width = 220, onWidthChange, project, onProjectRepoSaved }: Props) {
  const [collapsed, setCollapsed]     = useState<Record<string, boolean>>({})
  const [exportOpen, setExportOpen]   = useState(false)

  const hasApprovedNodes = nodes.some(n => (n.data as unknown as ForgeNodeData).approved === true)
  const toggle = (id: string) => setCollapsed(p => ({ ...p, [id]: !p[id] }))

  const dragging = useRef(false)
  const startX = useRef(0)
  const startW = useRef(0)
  const handleRef = useRef<HTMLDivElement>(null)

  const onMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault()
    dragging.current = true
    startX.current = e.clientX
    startW.current = width
    handleRef.current?.classList.add('dragging')
  }, [width])

  useEffect(() => {
    function onMove(e: MouseEvent) {
      if (!dragging.current) return
      const delta = e.clientX - startX.current
      const next = Math.max(160, Math.min(480, startW.current + delta))
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

  const fontSize = isOpen
    ? (Math.max(9, Math.min(17, 11 * width / 220)).toFixed(1) + 'px')
    : undefined

  const sections = buildOutliner(nodes)

  return (
    <aside className="forge-library" style={fontSize ? { fontSize } : undefined}>
      {isOpen && <div ref={handleRef} className="lib-resize-handle" onMouseDown={onMouseDown} />}
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

          {/* Botón Export — sticky al fondo del panel aunque la lista haga scroll */}
          {project && (
            <div style={{ position: 'sticky', bottom: 0, padding: '10px 10px 12px', background: 'var(--bg-1)', borderTop: '1px solid var(--line)' }}>
              <button
                onClick={() => setExportOpen(true)}
                disabled={!hasApprovedNodes}
                title={!hasApprovedNodes ? 'Approve at least one node to export' : 'Export to repository'}
                style={{
                  width: '100%', padding: '7px 0', borderRadius: 6,
                  fontFamily: 'var(--font-mono)', fontSize: 10, fontWeight: 600,
                  cursor: hasApprovedNodes ? 'pointer' : 'not-allowed',
                  border: `1px solid ${hasApprovedNodes ? 'var(--action)' : 'var(--line-2)'}`,
                  background: hasApprovedNodes ? 'color-mix(in oklch, var(--action) 10%, var(--bg-2))' : 'transparent',
                  color: hasApprovedNodes ? 'var(--action)' : 'var(--text-3)',
                  transition: 'all 0.15s',
                  letterSpacing: '0.06em', textTransform: 'uppercase',
                }}
              >
                ↑ Export
              </button>
            </div>
          )}
        </>
      )}

      {exportOpen && project && (
        <ExportModal
          project={project}
          nodes={nodes}
          onClose={() => setExportOpen(false)}
          onRepoSaved={onProjectRepoSaved}
        />
      )}
    </aside>
  )
}
