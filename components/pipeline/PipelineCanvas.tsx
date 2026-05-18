'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import {
  ReactFlow, ReactFlowProvider,
  Background, BackgroundVariant,
  Controls, MiniMap,
  useNodesState, useEdgesState,
  addEdge,
  type Node, type Edge, type Connection, type XYPosition,
  type NodeMouseHandler, type EdgeMouseHandler,
  type OnMove,
  useReactFlow,
} from '@xyflow/react'
import '@xyflow/react/dist/style.css'

import ForgeNode, { CAT_VAR, TYPE_VAR, type ForgeNodeData, type ForgeNodeCategory } from './ForgeNode'
import ForgeGroupNode, { type ForgeGroupNodeData } from './ForgeGroupNode'
import ForgeEdge from './ForgeEdge'
import LibraryPanel from './LibraryPanel'
import InspectorPanel from './InspectorPanel'
import ForgeToolbar from './ForgeToolbar'
import ForgeStatusBar from './ForgeStatusBar'
import ContextMenu, { type ContextMenuState } from './ContextMenu'
import NewProjectModal from './NewProjectModal'
import ImageCardDeck, { invalidateImageDeckCache } from './ImageCardDeck'
import GDDCardDeck from './GDDCardDeck'
import GDDSectionModal from './GDDSectionModal'
import type { GDDSectionId } from './GDDCardDeck'
import type { Project } from '@/lib/types'
import { getTemplate, CATALOG_ALL, TEMPLATES, type TemplateCatalogNode } from '@/lib/templates'
import { saveLayout, loadLayout, seedLayoutFromDB } from '@/lib/canvas-storage'
import type { CanvasLayout } from '@/lib/canvas-storage'
import { executePipeline } from '@/lib/pipelineExecutor'
import { getNodeExecutionContext } from '@/lib/nodeExecutionContext'

const FIXED_NODE_IDS = new Set(['gdd', 'export'])

/* ─── Unified node hydration — graph-based dependency logic ─── */

function hydrateNodes(nodes: Node[], project: Project | null, edges: Edge[] = []): Node[] {
  // Map stepKey → nodeId (to resolve generation_jobs which store stepKey)
  const stepKeyToNodeId = new Map<string, string>()
  for (const n of nodes) {
    const sk = (n.data as unknown as ForgeNodeData).stepKey
    if (sk) stepKeyToNodeId.set(sk, n.id)
  }

  // Nodos excluidos del pipeline config — siempre visibles
  const REQUIRED_IDS = new Set(['gdd', 'export'])

  // active_nodes del pipeline config guardado (si existe)
  const activeNodes = project?.concept?.pipeline_config?.active_nodes

  // Build approved + pending_review sets — generation_jobs es la única fuente de verdad
  const approved = new Set<string>()
  const pendingReview = new Set<string>()
  if (project) {
    for (const job of project.generation_jobs ?? []) {
      const nodeId = stepKeyToNodeId.get(job.current_step) ?? job.current_step
      if (job.status === 'approved') approved.add(nodeId)
      else if (job.status === 'review' && job.review_status === 'pending') pendingReview.add(nodeId)
    }
  }

  // Build parent map: nodeId → [parentNodeIds] from edges
  const parentMap = new Map<string, string[]>()
  for (const edge of edges) {
    const tgt = edge.target as string
    const src = edge.source as string
    if (!tgt || !src) continue
    const parents = parentMap.get(tgt) ?? []
    parents.push(src)
    parentMap.set(tgt, parents)
  }

  return nodes.map(n => {
    if (n.type === 'forgeGroup') return n
    const data = n.data as unknown as ForgeNodeData

    // Si hay pipeline config y este nodo no está en la lista de activos, marcarlo como comingSoon
    if (activeNodes && !REQUIRED_IDS.has(n.id) && !activeNodes.includes(n.id) && !approved.has(n.id)) {
      return { ...n, data: { ...data, comingSoon: true } }
    }

    if (data.comingSoon) return n

    const nodeApproved = approved.has(n.id)

    // Export is an output node — always available regardless of upstream state
    if (n.id === 'export') {
      return { ...n, data: { ...n.data, status: 'idle' as const, approved: false } }
    }

    const parents = parentMap.get(n.id) ?? []

    let status: ForgeNodeData['status']
    if (nodeApproved) {
      status = 'complete'
    } else if (pendingReview.has(n.id)) {
      status = 'pending_review'
    } else if (parents.length === 0) {
      // No incoming edges → locked until the user connects a parent (GDD is the only self-sufficient node)
      status = n.id === 'gdd' ? 'idle' : 'locked'
    } else if (parents.every(pid => approved.has(pid))) {
      status = 'idle'
    } else {
      status = 'locked'
    }

    return { ...n, data: { ...n.data, status, approved: nodeApproved } }
  })
}

function fe(id: string, src: string, tgt: string, cat: ForgeNodeCategory): Edge {
  const color = TYPE_VAR[cat]
  return {
    id, source: src, target: tgt,
    type: 'forgeEdge',
    data: { color, active: false },
    style: { stroke: color },
  }
}

const NODE_TYPES = { forgeNode: ForgeNode, forgeGroup: ForgeGroupNode }
const EDGE_TYPES = { forgeEdge: ForgeEdge }

/* ─── Fixed nodes: GDD + Export ─── */
function buildFixedNodes(project: Project | null): Node[] {
  const gdd = project?.concept?.pipeline?.gdd
  return [
    {
      id: 'gdd', type: 'forgeNode', position: { x: 60, y: 300 },
      data: {
        label: 'Game Design Doc', category: 'design', icon: 'GD', num: '01',
        status: 'idle', stepKey: 'gdd',
        rows: [
          { key: 'genre',  value: gdd?.project?.genre ?? '–', accent: true },
          { key: 'tone',   value: gdd?.project?.tone  ?? '–' },
          { key: 'engine', value: gdd?.development?.suggested_engine ?? '–' },
        ],
        inputs: [], outputs: [{ id: 'o', label: 'GDD Draft' }],
        previewType: 'text', previewContent: gdd?.project?.elevator_pitch,
        approved: false,
      } satisfies ForgeNodeData,
    },
    {
      id: 'export', type: 'forgeNode', position: { x: 2200, y: 300 },
      data: {
        label: 'Export', category: 'output', icon: '⬡', num: '99',
        status: 'locked', stepKey: 'export',
        rows: [
          { key: 'engine',  value: project?.target_engine ?? 'godot', accent: true },
          { key: 'formats', value: 'zip / web / itch.io' },
        ],
        inputs:  [{ id: 'i', label: 'All Approved' }],
        outputs: [],
        previewType: 'progress', previewContent: '0',
      } satisfies ForgeNodeData,
    },
  ]
}

let nodeCounter = 100
function makeForgeNode(entry: TemplateCatalogNode, x: number, y: number): Node {
  const num = String(nodeCounter++).padStart(2, '0')
  return {
    id: entry.id,
    type: 'forgeNode',
    position: { x, y },
    data: {
      label: entry.label, category: entry.category, icon: entry.icon, num,
      status: 'locked',
      rows: [],
      inputs:  [{ id: 'i', label: entry.inputLabel  ?? '' }],
      outputs: [{ id: 'o', label: entry.outputLabel ?? '' }],
      description: entry.description,
      previewType: 'none',
      comingSoon: entry.comingSoon,
      stepKey: entry.stepKey,
      approved: false,
    } satisfies ForgeNodeData,
  }
}

function applyTemplate(templateId: string, fixedNodes: Node[]): { nodes: Node[]; edges: Edge[] } {
  const template = getTemplate(templateId)
  if (!template) return { nodes: fixedNodes, edges: [] }

  nodeCounter = 100
  const allNodes = [...fixedNodes]

  for (const tn of template.nodes) {
    if (fixedNodes.some(n => n.id === tn.id)) continue
    allNodes.push(makeForgeNode(tn, tn.x, tn.y))
  }

  const edges: Edge[] = template.edges.map(te => {
    const srcNode = allNodes.find(n => n.id === te.source)
    const cat = srcNode ? (srcNode.data as unknown as ForgeNodeData).category : 'design'
    return fe(te.id, te.source, te.target, cat as ForgeNodeCategory)
  })

  return { nodes: allNodes, edges }
}

/* ─── Styled frame-name modal ─── */
function FrameNameModal({
  onConfirm, onCancel,
}: {
  onConfirm: (name: string) => void
  onCancel: () => void
}) {
  const inputRef = useRef<HTMLInputElement>(null)

  return createPortal(
    <div
      style={{
        position: 'fixed', inset: 0, zIndex: 10000,
        background: 'rgba(0,0,0,0.5)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
      }}
      onClick={onCancel}
    >
      <div
        style={{
          background: 'var(--bg-2)', border: '1px solid var(--line-2)',
          borderRadius: 10, padding: '20px 24px',
          minWidth: 300, display: 'flex', flexDirection: 'column', gap: 14,
          boxShadow: '0 16px 48px rgba(0,0,0,0.7)',
        }}
        onClick={e => e.stopPropagation()}
      >
        <div style={{
          fontFamily: 'var(--font-mono)', fontSize: 10,
          color: 'var(--text-3)', textTransform: 'uppercase', letterSpacing: '0.1em',
        }}>
          Name your frame
        </div>
        <input
          ref={inputRef}
          autoFocus
          defaultValue="New Frame"
          onFocus={e => e.target.select()}
          onKeyDown={e => {
            if (e.key === 'Enter') onConfirm(inputRef.current?.value.trim() || 'Frame')
            if (e.key === 'Escape') onCancel()
          }}
          style={{
            background: 'var(--bg-3)', border: '1px solid var(--line-2)',
            borderRadius: 5, padding: '9px 12px',
            color: 'var(--text-0)', fontFamily: 'var(--font-sans)', fontSize: 13,
            outline: 'none', width: '100%', boxSizing: 'border-box',
          }}
        />
        <div style={{ display: 'flex', gap: 8 }}>
          <button
            onClick={onCancel}
            style={{
              flex: 1, height: 34, background: 'var(--bg-3)',
              border: '1px solid var(--line-2)', borderRadius: 5,
              color: 'var(--text-2)', cursor: 'pointer',
              fontFamily: 'var(--font-sans)', fontSize: 12,
            }}
          >
            Cancel
          </button>
          <button
            onClick={() => onConfirm(inputRef.current?.value.trim() || 'Frame')}
            style={{
              flex: 2, height: 34, background: 'var(--cat-design)',
              border: 'none', borderRadius: 5,
              color: '#0a0a0c', cursor: 'pointer',
              fontFamily: 'var(--font-sans)', fontSize: 12, fontWeight: 700,
            }}
          >
            Create Frame
          </button>
        </div>
      </div>
    </div>,
    document.body
  )
}

/* ─── Inner app ─── */
function PipelineApp({
  project: initialProject, onRefresh, onProjectCreated,
}: {
  project: Project | null
  onRefresh: () => void
  onProjectCreated?: (p: Project) => void
}) {
  const [liveProject, setLiveProject] = useState<Project | null>(initialProject)
  const [selectedId, setSelectedId] = useState<string | null>(initialProject === null ? 'gdd' : null)
  const [libraryOpen, setLibraryOpen] = useState(true)
  const [libraryWidth, setLibraryWidth] = useState(220)
  const [log, setLog] = useState('')
  const [zoom, setZoom] = useState(0.85)
  const [ctxMenu, setCtxMenu] = useState<ContextMenuState | null>(null)
  const [framePrompt, setFramePrompt] = useState<XYPosition | null>(null)
  const [phase, setPhase] = useState<'idle' | 'running' | 'error'>('idle')
  const [runProgress, setRunProgress] = useState<{ done: number; total: number } | undefined>()
  const [gddSection, setGddSection] = useState<GDDSectionId | null>(null)

  // Estado del abanico GDD — posición del nodo en screen coords
  type GDDDeckState = { anchorX: number; anchorY: number } | null
  const [gddDeck, setGddDeck] = useState<GDDDeckState>(null)
  const gddHoverTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const gddCloseTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Draft = no GDD generado (flow viejo) y sin game_idea locked (flow nuevo)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const isDraft = (p: Project | null) => !p?.concept?.pipeline?.gdd && !(p?.concept?.pipeline as any)?.game_idea?.text
  const [modalOpen, setModalOpen]           = useState(isDraft(initialProject))
  const [regenProjectId, setRegenProjectId] = useState<string | null>(
    initialProject && isDraft(initialProject) ? initialProject.id : null
  )
  const [regenInitialInput, setRegenInitialInput] = useState<{ ideaPrompt: string; params: Record<string, string | string[]> } | null>(null)

  const initialState = (() => {
    if (initialProject?.id) {
      if (initialProject.canvas_layout) {
        seedLayoutFromDB(initialProject.id, initialProject.canvas_layout as CanvasLayout)
      }
      const saved = loadLayout(initialProject.id)
      if (saved) return { nodes: hydrateNodes(saved.nodes, initialProject, saved.edges), edges: saved.edges }
      const fixed = buildFixedNodes(initialProject)
      return { nodes: hydrateNodes(fixed, initialProject), edges: [] as Edge[] }
    }
    return { nodes: buildFixedNodes(initialProject), edges: [] as Edge[] }
  })()

  const [flowNodes, setFlowNodes, onNodesChange] = useNodesState(initialState.nodes)
  const [flowEdges, setFlowEdges, onEdgesChange] = useEdgesState(initialState.edges)

  // Track frame positions at drag-start for virtual grouping
  const frameDragStartRef = useRef<Map<string, XYPosition>>(new Map())

  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  useEffect(() => {
    if (!liveProject?.id) return
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current)
    saveTimerRef.current = setTimeout(() => {
      saveLayout(liveProject.id, { templateId: null, nodes: flowNodes, edges: flowEdges })
    }, 800)
    return () => { if (saveTimerRef.current) clearTimeout(saveTimerRef.current) }
  }, [flowNodes, flowEdges, liveProject?.id])

  const prevRef = useRef(initialProject)
  useEffect(() => {
    if (initialProject === prevRef.current) return
    prevRef.current = initialProject
    setLiveProject(initialProject)
    if (initialProject?.id) {
      if (initialProject.canvas_layout) {
        seedLayoutFromDB(initialProject.id, initialProject.canvas_layout as CanvasLayout)
      }
      const saved = loadLayout(initialProject.id)
      if (saved) { setFlowNodes(hydrateNodes(saved.nodes, initialProject, saved.edges)); setFlowEdges(saved.edges); return }
      const fixed = buildFixedNodes(initialProject)
      setFlowNodes(hydrateNodes(fixed, initialProject)); setFlowEdges([]); return
    }
    setFlowNodes(buildFixedNodes(initialProject))
    setFlowEdges([])
  }, [initialProject]) // eslint-disable-line react-hooks/exhaustive-deps

  // Re-hydrate node statuses whenever canvas connections change
  useEffect(() => {
    if (!liveProject) return
    setFlowNodes(ns => hydrateNodes(ns, liveProject, flowEdges))
  }, [flowEdges, liveProject]) // eslint-disable-line react-hooks/exhaustive-deps

  const { getViewport, screenToFlowPosition, fitView } = useReactFlow()

  const handleFocusNode = useCallback((id: string) => {
    fitView({ nodes: [{ id }], duration: 350, padding: 0.35, maxZoom: 1 })
  }, [fitView])

  const onNodeClick: NodeMouseHandler = useCallback((_e, node) => {
    if (node.type === 'forgeGroup') { setSelectedId(node.id); return }
    setSelectedId(node.id)
  }, [])
  const onPaneClick = useCallback(() => { setSelectedId(null); setCtxMenu(null) }, [])
  const onMoveEnd: OnMove = useCallback(() => setZoom(getViewport().zoom), [getViewport])

  /* ── Manual edge connections ── */
  const onConnect = useCallback((connection: Connection) => {
    const srcNode = flowNodes.find(n => n.id === connection.source)
    const cat: ForgeNodeCategory = srcNode
      ? (srcNode.data as unknown as ForgeNodeData).category
      : 'design'
    setFlowEdges(es => addEdge(
      fe(`e-${connection.source}-${connection.target}-${Date.now()}`, connection.source!, connection.target!, cat),
      es
    ))
  }, [flowNodes, setFlowEdges])

  /* ── Virtual frame grouping ──
     When a frame is dragged, nodes inside its bounds move with it. */
  const onNodeDragStart: NodeMouseHandler = useCallback((_e, node) => {
    if (node.type !== 'forgeGroup') return
    frameDragStartRef.current.set(node.id, { x: node.position.x, y: node.position.y })
  }, [])

  const onNodeDragStop: NodeMouseHandler = useCallback((_e, node) => {
    if (node.type !== 'forgeGroup') return

    const startPos = frameDragStartRef.current.get(node.id)
    if (!startPos) return
    frameDragStartRef.current.delete(node.id)

    const delta = { x: node.position.x - startPos.x, y: node.position.y - startPos.y }
    if (delta.x === 0 && delta.y === 0) return

    const rawW = node.style?.width
    const rawH = node.style?.height
    const fw = typeof rawW === 'number' ? rawW : (node.measured?.width ?? 600)
    const fh = typeof rawH === 'number' ? rawH : (node.measured?.height ?? 400)

    setFlowNodes(ns => ns.map(n => {
      if (n.type === 'forgeGroup') return n
      // Use node center for reliable hit detection
      const cx = n.position.x + ((n.measured?.width ?? 260) / 2)
      const cy = n.position.y + ((n.measured?.height ?? 80) / 2)
      const inside =
        cx > startPos.x && cx < startPos.x + fw &&
        cy > startPos.y && cy < startPos.y + fh
      return inside
        ? { ...n, position: { x: n.position.x + delta.x, y: n.position.y + delta.y } }
        : n
    }))
  }, [setFlowNodes])

  /* ── Context menus ── */
  const onPaneContextMenu = useCallback((e: MouseEvent | React.MouseEvent) => {
    e.preventDefault()
    const flow = screenToFlowPosition({ x: e.clientX, y: e.clientY })
    setCtxMenu({ x: e.clientX, y: e.clientY, flowX: flow.x, flowY: flow.y })
  }, [screenToFlowPosition])

  const onNodeContextMenu: NodeMouseHandler = useCallback((e, node) => {
    e.preventDefault(); e.stopPropagation()
    const flow = screenToFlowPosition({ x: e.clientX, y: e.clientY })
    setCtxMenu({ x: e.clientX, y: e.clientY, flowX: flow.x, flowY: flow.y, nodeId: node.id })
  }, [screenToFlowPosition])

  const onEdgeContextMenu: EdgeMouseHandler = useCallback((e, edge) => {
    e.preventDefault(); e.stopPropagation()
    const flow = screenToFlowPosition({ x: e.clientX, y: e.clientY })
    setCtxMenu({ x: e.clientX, y: e.clientY, flowX: flow.x, flowY: flow.y, edgeId: edge.id })
  }, [screenToFlowPosition])

  /* ── Image card deck on hover (image_reference, charaters) ── */
  const PREVIEW_KEYS = useMemo(() => new Set(['image_reference', 'charaters']), [])
  type HoverState = { stepKey: string; anchorX: number; anchorY: number } | null
  const [hoverPreview, setHoverPreview] = useState<HoverState>(null)
  const hoverTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const closeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const scheduleClose = useCallback(() => {
    if (closeTimerRef.current) clearTimeout(closeTimerRef.current)
    closeTimerRef.current = setTimeout(() => setHoverPreview(null), 160)
  }, [])

  const cancelClose = useCallback(() => {
    if (closeTimerRef.current) clearTimeout(closeTimerRef.current)
  }, [])

  const onNodeMouseEnter: NodeMouseHandler = useCallback((_e, node) => {
    if (!liveProject?.id) return
    const stepKey = (node.data as unknown as ForgeNodeData).stepKey ?? ''

    // Preview de assets (image_reference, characters)
    if (PREVIEW_KEYS.has(stepKey)) {
      cancelClose()
      if (hoverTimerRef.current) clearTimeout(hoverTimerRef.current)
      hoverTimerRef.current = setTimeout(() => {
        const el = document.querySelector(`[data-id="${node.id}"]`) as HTMLElement | null
        if (!el) return
        const r = el.getBoundingClientRect()
        setHoverPreview({ stepKey, anchorX: r.left + r.width / 2, anchorY: r.top })
      }, 320)
    }

    // Abanico GDD — se despliega al hacer hover sobre el nodo GDD con GDD disponible
    if (stepKey === 'gdd' && liveProject?.concept?.pipeline?.gdd) {
      if (gddCloseTimerRef.current) clearTimeout(gddCloseTimerRef.current)
      if (gddHoverTimerRef.current) clearTimeout(gddHoverTimerRef.current)
      gddHoverTimerRef.current = setTimeout(() => {
        const el = document.querySelector('[data-id="gdd"]') as HTMLElement | null
        if (!el) return
        const r = el.getBoundingClientRect()
        setGddDeck({ anchorX: r.left + r.width / 2, anchorY: r.top })
      }, 200)
    }
  }, [liveProject?.id, liveProject?.concept?.pipeline?.gdd, PREVIEW_KEYS, cancelClose]) // eslint-disable-line react-hooks/exhaustive-deps

  const onNodeMouseLeave: NodeMouseHandler = useCallback((_e, node) => {
    if (hoverTimerRef.current) clearTimeout(hoverTimerRef.current)
    scheduleClose()

    // Programa cierre del abanico GDD con un breve delay para permitir mover el mouse a las tarjetas
    const stepKey = (node.data as unknown as ForgeNodeData).stepKey ?? ''
    if (stepKey === 'gdd') {
      if (gddHoverTimerRef.current) clearTimeout(gddHoverTimerRef.current)
      if (gddCloseTimerRef.current) clearTimeout(gddCloseTimerRef.current)
      gddCloseTimerRef.current = setTimeout(() => setGddDeck(null), 180)
    }
  }, [scheduleClose]) // eslint-disable-line react-hooks/exhaustive-deps

  /* ── Actions ── */
  function handleApplyTemplate(templateId: string) {
    const fixed = buildFixedNodes(liveProject)
    const { nodes, edges } = applyTemplate(templateId, fixed)
    setFlowNodes(hydrateNodes(nodes, liveProject, edges))
    setFlowEdges(edges)
    setLog(`Template "${getTemplate(templateId)?.name}" applied`)
  }

  function handleAddNode(entry: TemplateCatalogNode, flowX: number, flowY: number) {
    if (flowNodes.some(n => n.id === entry.id)) {
      setLog(`"${entry.label}" already on canvas`); return
    }
    setFlowNodes(ns => [...ns, makeForgeNode(entry, flowX, flowY)])
    setLog(`Added "${entry.label}"`)
  }

  function handleDeleteNode(nodeId: string) {
    if (FIXED_NODE_IDS.has(nodeId)) return
    const outgoing = flowEdges.filter(e => e.source === nodeId)
    const edgesAfter = flowEdges.filter(e => e.source !== nodeId && e.target !== nodeId)
    if (outgoing.length > 0) {
      setFlowNodes(ns => ns.map(n => {
        if (!outgoing.some(e => e.target === n.id)) return n
        const d = n.data as unknown as ForgeNodeData
        const stillHasParent = edgesAfter.some(e => e.target === n.id)
        if (d.approved) return { ...n, data: { ...n.data, stale: true } }
        if (!stillHasParent) return { ...n, data: { ...n.data, status: 'locked' as const } }
        return n
      }))
    }
    setFlowNodes(ns => ns.filter(n => n.id !== nodeId))
    setFlowEdges(es => es.filter(e => e.source !== nodeId && e.target !== nodeId))
    if (selectedId === nodeId) setSelectedId(null)
    setLog(`Deleted "${nodeId}"`)
  }

  function handleDeleteEdge(edgeId: string) {
    const edge = flowEdges.find(e => e.id === edgeId)
    if (edge) {
      const targetNode = flowNodes.find(n => n.id === edge.target)
      if (targetNode && targetNode.id !== 'gdd') {
        const d = targetNode.data as unknown as ForgeNodeData
        const remainingIncoming = flowEdges.filter(e => e.id !== edgeId && e.target === edge.target)
        setFlowNodes(ns => ns.map(n => {
          if (n.id !== edge.target) return n
          if (d.approved) return { ...n, data: { ...n.data, stale: true } }
          if (remainingIncoming.length === 0) return { ...n, data: { ...n.data, status: 'locked' as const } }
          return n
        }))
      }
    }
    setFlowEdges(es => es.filter(e => e.id !== edgeId))
    setLog('Edge deleted')
  }

  function handleCreateFrame(flowX: number, flowY: number) {
    setFramePrompt({ x: flowX, y: flowY })
  }

  function handleCleanCanvas() {
    const keptIds = new Set<string>()
    const keptNodes = flowNodes.filter(n => {
      if (n.type === 'forgeGroup') return true
      if (FIXED_NODE_IDS.has(n.id)) { keptIds.add(n.id); return true }
      const d = n.data as unknown as ForgeNodeData
      if (d.approved || d.status === 'complete' || d.status === 'pending_review') {
        keptIds.add(n.id); return true
      }
      return false
    })
    const keptEdges = flowEdges.filter(e =>
      keptIds.has(e.source as string) && keptIds.has(e.target as string)
    )
    setFlowNodes(keptNodes)
    setFlowEdges(keptEdges)
    if (selectedId && !keptIds.has(selectedId) && flowNodes.find(n => n.id === selectedId)?.type !== 'forgeGroup') {
      setSelectedId(null)
    }
    setLog('Canvas cleaned — idle and locked nodes removed')
  }

  function confirmFrame(name: string) {
    if (!framePrompt) return
    const id = `frame-${Date.now()}`
    const frame: Node = {
      id,
      type: 'forgeGroup',
      position: { x: framePrompt.x, y: framePrompt.y },
      style: { width: 600, height: 400 },
      data: { label: name, color: 'var(--cat-design)' } satisfies ForgeGroupNodeData,
    }
    // Insert at start so it renders behind other nodes (lower DOM order = lower stacking)
    setFlowNodes(ns => [frame, ...ns])
    setSelectedId(id)
    setFramePrompt(null)
    setLog(`Frame "${name}" created`)
  }

  function handleApproveNode(nodeId: string) {
    setFlowNodes(ns => ns.map(n =>
      n.id === nodeId ? { ...n, data: { ...n.data, approved: true, status: 'complete' } } : n
    ))
    setLog(`"${nodeId}" approved`)
  }

  const selectedNode = flowNodes.find(n => n.id === selectedId) ?? null

  const nodeContext = useMemo(() => {
    if (!selectedNode) return {}
    const stepKey = (selectedNode.data as unknown as ForgeNodeData).stepKey
    if (!stepKey) return {}
    return getNodeExecutionContext(stepKey, flowNodes, flowEdges, liveProject)
  }, [selectedNode, flowNodes, flowEdges, liveProject])

  // Edge glow only when source node is approved
  const approvedIds = new Set(
    flowNodes
      .filter(n => (n.data as unknown as ForgeNodeData).approved === true)
      .map(n => n.id)
  )
  const displayEdges = flowEdges.map(e => ({
    ...e,
    data: { ...(e.data ?? {}), active: approvedIds.has(e.source as string) },
  }))

  function handleRefresh() {
    onRefresh()
    setLog('Pipeline refreshed')
  }

  function handleNodeApproved(stepKey: string) {
    // Invalida caché de imágenes para que el próximo hover traiga datos frescos
    if (liveProject?.id) invalidateImageDeckCache(liveProject.id)
    setFlowNodes(ns => ns.map(n => {
      const d = n.data as unknown as ForgeNodeData
      if (d.stepKey === stepKey) return { ...n, data: { ...d, status: 'complete' as const, approved: true, stale: false } }
      return n
    }))
    setLiveProject(prev => {
      if (!prev) return prev
      const existingJobs = prev.generation_jobs ?? []
      const alreadyApproved = existingJobs.some(j => j.current_step === stepKey && j.status === 'approved')
      if (alreadyApproved) return prev
      return {
        ...prev,
        generation_jobs: [
          ...existingJobs,
          { id: `optimistic-${stepKey}`, project_id: prev.id, current_step: stepKey, status: 'approved' },
        ],
      }
    })
    onRefresh()
  }

  async function handleRunPipeline() {
    if (!liveProject?.id || phase === 'running') return
    const idleNodes = flowNodes.filter(n => {
      if (n.type === 'forgeGroup') return false
      const d = n.data as unknown as ForgeNodeData
      return d.status === 'idle' && !d.comingSoon
    })
    if (idleNodes.length === 0) { setLog('No idle nodes to run'); return }
    setPhase('running')
    setRunProgress({ done: 0, total: idleNodes.length })
    setLog(`Running pipeline — ${idleNodes.length} node${idleNodes.length !== 1 ? 's' : ''}…`)

    await executePipeline(liveProject.id, flowNodes, flowEdges, {
      onNodeStart: (stepKey) => {
        setFlowNodes(ns => ns.map(n => {
          const d = n.data as unknown as ForgeNodeData
          if (d.stepKey === stepKey || n.id === stepKey)
            return { ...n, data: { ...d, status: 'running' as const } }
          return n
        }))
        setLog(`Generating ${stepKey}…`)
      },
      onNodeDone: (stepKey) => {
        setFlowNodes(ns => ns.map(n => {
          const d = n.data as unknown as ForgeNodeData
          if (d.stepKey === stepKey || n.id === stepKey)
            return { ...n, data: { ...d, status: 'complete' as const, approved: true } }
          return n
        }))
        setLiveProject(prev => {
          if (!prev) return prev
          return {
            ...prev,
            generation_jobs: [
              ...(prev.generation_jobs ?? []),
              { id: `run-${stepKey}`, project_id: prev.id, current_step: stepKey, status: 'approved' },
            ],
          }
        })
        setRunProgress(p => p ? { done: p.done + 1, total: p.total } : undefined)
      },
      onNodePendingReview: (stepKey) => {
        setFlowNodes(ns => ns.map(n => {
          const d = n.data as unknown as ForgeNodeData
          if (d.stepKey === stepKey || n.id === stepKey)
            return { ...n, data: { ...d, status: 'pending_review' as const } }
          return n
        }))
        setLiveProject(prev => {
          if (!prev) return prev
          return {
            ...prev,
            generation_jobs: [
              ...(prev.generation_jobs ?? []),
              { id: `pending-${stepKey}`, project_id: prev.id, current_step: stepKey, status: 'review', review_status: 'pending' } as never,
            ],
          }
        })
        setPhase('idle')
        setRunProgress(undefined)
        setLog(`"${stepKey}" is waiting for your review — open the node to select references`)
      },
      onNodeError: (stepKey, error) => {
        setFlowNodes(ns => ns.map(n => {
          const d = n.data as unknown as ForgeNodeData
          if (d.stepKey === stepKey || n.id === stepKey)
            return { ...n, data: { ...d, status: 'error' as const } }
          return n
        }))
        setPhase('error')
        setLog(`Error in "${stepKey}": ${error}`)
        setRunProgress(undefined)
        onRefresh()
      },
      onDone: () => {
        setPhase('idle')
        setRunProgress(undefined)
        setLog('Pipeline complete — all nodes generated and approved')
        onRefresh()
      },
    }, liveProject)
  }

  function handleProjectCreated(p: Project) {
    // GDD saved — inject pending_review job so hydrateNodes marks it for review in the Inspector Panel
    const pWithGdd: typeof p = {
      ...p,
      generation_jobs: [
        ...(p.generation_jobs ?? []),
        { id: 'optimistic-gdd', project_id: p.id, current_step: 'gdd', status: 'review', review_status: 'pending' } as never,
      ],
    }
    setLiveProject(pWithGdd)
    const fixed = buildFixedNodes(pWithGdd)
    setFlowNodes(hydrateNodes(fixed, pWithGdd))
    setFlowEdges([])
    prevRef.current = p
    setSelectedId('gdd')
    setLog(`Project "${p.name}" created! Apply a template or add nodes manually.`)
    onProjectCreated?.(p)
    if (typeof window !== 'undefined') {
      window.history.replaceState(null, '', `/projects/${p.id}`)
    }
  }

  // Aplica pipeline config al canvas sin esperar recarga del servidor.
  // Construye el canvas desde CATALOG_ALL para no estar atado a un solo template.
  function handlePipelineApply(activeNodes: string[]) {
    const updatedProject = liveProject ? {
      ...liveProject,
      concept: {
        ...liveProject.concept,
        pipeline_config: { active_nodes: activeNodes, configured_at: new Date().toISOString() },
      },
    } : null

    setLiveProject(updatedProject)

    // Solo dibujar nodos si el canvas aún está vacío (sin template aplicado)
    const nonFixed = flowNodes.filter(n => n.id !== 'gdd' && n.id !== 'export' && n.type !== 'forgeGroup')
    if (nonFixed.length > 0 || !updatedProject) return

    // Construir solo los nodos activos + fijos
    const activeSet = new Set(activeNodes)
    const fixed = buildFixedNodes(updatedProject)
    const allNodes = [...fixed]
    for (const entry of CATALOG_ALL) {
      if (fixed.some(n => n.id === entry.id)) continue
      if (!activeSet.has(entry.id)) continue
      allNodes.push(makeForgeNode(entry, entry.x, entry.y))
    }

    // Solo edges donde ambos extremos están en el canvas
    const nodeIds = new Set(allNodes.map(n => n.id))
    const edgeMap = new Map<string, Edge>()
    for (const template of TEMPLATES) {
      for (const te of template.edges) {
        if (edgeMap.has(te.id)) continue
        if (!nodeIds.has(te.source) || !nodeIds.has(te.target)) continue
        const srcNode = allNodes.find(n => n.id === te.source)
        const cat = srcNode ? (srcNode.data as unknown as ForgeNodeData).category : 'design'
        edgeMap.set(te.id, fe(te.id, te.source, te.target, cat as ForgeNodeCategory))
      }
    }
    const edges = Array.from(edgeMap.values())

    setFlowNodes(hydrateNodes(allNodes, updatedProject, edges))
    setFlowEdges(edges)
    setLog('Pipeline applied')
  }

  const toolbarProject = liveProject ?? {
    id: '', name: 'New project', description: '', genre: '',
    target_engine: '', status: 'draft', owner_member_id: '',
    concept: null as unknown as Project['concept'],
    created_at: '',
  }

  return (
    <div
      className="forge-app"
      style={{ gridTemplateColumns: `${libraryOpen ? libraryWidth : 32}px 1fr 280px` }}
    >
      <ForgeToolbar
        project={toolbarProject}
        phase={phase}
        onRefresh={handleRefresh}
        onPipelineApply={liveProject?.id ? handlePipelineApply : undefined}
        onRunPipeline={liveProject?.id ? handleRunPipeline : undefined}
        runProgress={runProgress}
        nodes={flowNodes}
      />

      <LibraryPanel
        nodes={flowNodes}
        selectedNodeId={selectedId}
        onSelect={setSelectedId}
        onFocus={handleFocusNode}
        isOpen={libraryOpen}
        onToggle={() => setLibraryOpen(o => !o)}
        width={libraryWidth}
        onWidthChange={setLibraryWidth}
        project={liveProject}
        onProjectRepoSaved={onRefresh}
      />

      <div className="forge-canvas">
        <div style={{ position: 'absolute', inset: 0 }}>
          <ReactFlow
            nodes={flowNodes.map(n => ({ ...n, selected: n.id === selectedId }))}
            edges={displayEdges}
            nodeTypes={NODE_TYPES}
            edgeTypes={EDGE_TYPES}
            onNodesChange={onNodesChange}
            onEdgesChange={onEdgesChange}
            onNodeClick={onNodeClick}
            onPaneClick={onPaneClick}
            onMoveEnd={onMoveEnd}
            onConnect={onConnect}
            onNodeDragStart={onNodeDragStart}
            onNodeDragStop={onNodeDragStop}
            onPaneContextMenu={onPaneContextMenu}
            onNodeContextMenu={onNodeContextMenu}
            onEdgeContextMenu={onEdgeContextMenu}
            onNodeMouseEnter={onNodeMouseEnter}
            onNodeMouseLeave={onNodeMouseLeave}
            fitView
            fitViewOptions={{ padding: 0.12, maxZoom: 0.8 }}
            minZoom={0.06}
            maxZoom={2}
            deleteKeyCode={null}
            proOptions={{ hideAttribution: true }}
            style={{ background: 'transparent', width: '100%', height: '100%' }}
          >
            <Background variant={BackgroundVariant.Dots} gap={24} size={1} color="var(--bg-4)" />
            <Controls showInteractive={false} />
            <MiniMap
              nodeColor={(n) => {
                if (n.type === 'forgeGroup') return (n.data as unknown as ForgeGroupNodeData).color
                return CAT_VAR[(n.data as unknown as ForgeNodeData).category] ?? 'var(--text-3)'
              }}
              maskColor="rgba(0,0,0,0.55)"
            />
          </ReactFlow>
        </div>

        {ctxMenu && (
          <ContextMenu
            menu={ctxMenu}
            fixedNodeIds={FIXED_NODE_IDS}
            hasProject={!!liveProject?.id}
            onClose={() => setCtxMenu(null)}
            onApplyTemplate={handleApplyTemplate}
            onAddNode={handleAddNode}
            onDeleteNode={handleDeleteNode}
            onDeleteEdge={handleDeleteEdge}
            onCreateFrame={handleCreateFrame}
            onCleanCanvas={handleCleanCanvas}
          />
        )}

        {framePrompt && (
          <FrameNameModal
            onConfirm={confirmFrame}
            onCancel={() => setFramePrompt(null)}
          />
        )}
      </div>

      {hoverPreview && liveProject?.id && (
        <ImageCardDeck
          stepKey={hoverPreview.stepKey}
          projectId={liveProject.id}
          anchorX={hoverPreview.anchorX}
          anchorY={hoverPreview.anchorY}
          onKeepOpen={cancelClose}
          onScheduleClose={scheduleClose}
        />
      )}

      {/* Abanico GDD — portal en document.body, escapa el overflow:hidden del canvas */}
      {gddDeck && liveProject?.concept?.pipeline?.gdd && (
        <GDDCardDeck
          gdd={liveProject.concept.pipeline.gdd}
          anchorX={gddDeck.anchorX}
          anchorY={gddDeck.anchorY}
          onKeepOpen={() => {
            if (gddCloseTimerRef.current) clearTimeout(gddCloseTimerRef.current)
          }}
          onScheduleClose={() => {
            if (gddCloseTimerRef.current) clearTimeout(gddCloseTimerRef.current)
            gddCloseTimerRef.current = setTimeout(() => setGddDeck(null), 180)
          }}
          onSectionClick={id => { setGddDeck(null); setGddSection(id) }}
        />
      )}

      <InspectorPanel
        node={selectedNode}
        project={liveProject}
        onRefresh={handleRefresh}
        onApproved={handleNodeApproved}
        onLog={setLog}
        onProjectCreated={handleProjectCreated}
        onApproveNode={handleApproveNode}
        nodeContext={nodeContext}
        onRequestNewProject={() => setModalOpen(true)}
        onRequestRegenerate={projectId => {
          try {
            const raw = localStorage.getItem(`forge:gdd-input:${projectId}`)
            setRegenInitialInput(raw ? JSON.parse(raw) : null)
          } catch { setRegenInitialInput(null) }
          setRegenProjectId(projectId)
          setModalOpen(true)
        }}
      />

      {gddSection && liveProject?.concept?.pipeline?.gdd && (
        <GDDSectionModal
          gdd={liveProject.concept.pipeline.gdd}
          section={gddSection}
          onClose={() => setGddSection(null)}
          onViewFull={() => { setGddSection(null); setSelectedId('gdd') }}
        />
      )}

      <NewProjectModal
        open={modalOpen}
        projectId={regenProjectId}
        projectName={regenProjectId ? (liveProject?.name ?? '') : undefined}
        initialIdea={regenInitialInput?.ideaPrompt}
        initialParams={regenInitialInput?.params}
        memberId={null}
        onProjectCreated={p => { setModalOpen(false); setRegenProjectId(null); setRegenInitialInput(null); handleProjectCreated(p) }}
        onClose={() => { setModalOpen(false); setRegenProjectId(null); setRegenInitialInput(null) }}
      />

      <ForgeStatusBar
        nodes={flowNodes}
        edges={flowEdges}
        selectedId={selectedId}
        log={log}
        zoom={zoom}
      />
    </div>
  )
}

export default function PipelineCanvas({ project, onRefresh, onProjectCreated }: {
  project: Project | null
  onRefresh: () => void
  onProjectCreated?: (p: Project) => void
}) {
  return (
    <ReactFlowProvider>
      <PipelineApp project={project} onRefresh={onRefresh} onProjectCreated={onProjectCreated} />
    </ReactFlowProvider>
  )
}
