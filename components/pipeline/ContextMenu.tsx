'use client'

import { useEffect, useRef } from 'react'
import { createPortal } from 'react-dom'
import { TEMPLATES, CATALOG_ALL, type TemplateCatalogNode } from '@/lib/templates'

export interface ContextMenuState {
  x: number
  y: number
  flowX: number
  flowY: number
  nodeId?: string
  edgeId?: string
}

interface Props {
  menu: ContextMenuState
  fixedNodeIds: Set<string>
  hasProject: boolean
  onClose: () => void
  onApplyTemplate: (templateId: string) => void
  onAddNode: (node: TemplateCatalogNode, flowX: number, flowY: number) => void
  onDeleteNode: (nodeId: string) => void
  onDeleteEdge: (edgeId: string) => void
  onCreateFrame: (flowX: number, flowY: number) => void
}

export default function ContextMenu({
  menu,
  fixedNodeIds,
  hasProject,
  onClose,
  onApplyTemplate,
  onAddNode,
  onDeleteNode,
  onDeleteEdge,
  onCreateFrame,
}: Props) {
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    function handle(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose()
    }
    document.addEventListener('mousedown', handle)
    return () => document.removeEventListener('mousedown', handle)
  }, [onClose])

  const isNode = !!menu.nodeId
  const isEdge = !!menu.edgeId
  const canDelete = isNode && !fixedNodeIds.has(menu.nodeId!)

  // Clamp to viewport so menu never goes off-screen
  const menuStyle: React.CSSProperties = {
    left: Math.min(menu.x, window.innerWidth - 220),
    top: Math.min(menu.y, window.innerHeight - 40),
  }

  const content = (
    <div
      ref={ref}
      className="ctx-menu"
      style={menuStyle}
      onContextMenu={e => e.preventDefault()}
    >
      {!isNode && (
        <>
          {/* Templates submenu */}
          <div className={`ctx-item ctx-item--submenu${!hasProject ? ' ctx-item--disabled' : ''}`}>
            <span>Apply Template</span>
            <span className="ctx-arrow">›</span>
            {hasProject && (
              <div className="ctx-submenu">
                {TEMPLATES.map(t => (
                  <button
                    key={t.id}
                    className="ctx-item"
                    onClick={() => { onApplyTemplate(t.id); onClose() }}
                  >
                    <div>
                      <div>{t.name}</div>
                      <span className="ctx-desc">{t.description}</span>
                    </div>
                  </button>
                ))}
              </div>
            )}
          </div>

          <div className="ctx-divider" />

          {/* Add Node submenu */}
          <div className={`ctx-item ctx-item--submenu${!hasProject ? ' ctx-item--disabled' : ''}`}>
            <span>Add Node</span>
            <span className="ctx-arrow">›</span>
            {hasProject && (
              <div className="ctx-submenu ctx-submenu--tall">
                {CATALOG_ALL.map(n => (
                  <button
                    key={n.id}
                    className="ctx-item"
                    onClick={() => { onAddNode(n, menu.flowX, menu.flowY); onClose() }}
                  >
                    <span className="ctx-icon" style={{ background: `var(--cat-${n.category})` }}>{n.icon}</span>
                    {n.label}
                    {n.comingSoon && <span className="ctx-badge">soon</span>}
                  </button>
                ))}
              </div>
            )}
          </div>

          <div className="ctx-divider" />

          <button className="ctx-item" onClick={() => { onCreateFrame(menu.flowX, menu.flowY); onClose() }}>
            Create Frame
          </button>

          {!hasProject && (
            <>
              <div className="ctx-divider" />
              <div className="ctx-hint">Complete the GDD wizard first to unlock templates and nodes.</div>
            </>
          )}
        </>
      )}

      {isNode && canDelete && (
        <button className="ctx-item ctx-item--danger" onClick={() => { onDeleteNode(menu.nodeId!); onClose() }}>
          Delete Node
        </button>
      )}

      {isNode && !canDelete && (
        <div className="ctx-item ctx-item--disabled">Cannot delete fixed node</div>
      )}

      {isEdge && (
        <button className="ctx-item ctx-item--danger" onClick={() => { onDeleteEdge(menu.edgeId!); onClose() }}>
          Delete Edge
        </button>
      )}
    </div>
  )

  return createPortal(content, document.body)
}
