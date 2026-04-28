'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
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

import ForgeNode, { CAT_VAR, type ForgeNodeData, type ForgeNodeCategory } from './ForgeNode'
import ForgeGroupNode, { type ForgeGroupNodeData } from './ForgeGroupNode'
import ForgeEdge from './ForgeEdge'
import LibraryPanel from './LibraryPanel'
import InspectorPanel from './InspectorPanel'
import ForgeToolbar from './ForgeToolbar'
import ForgeStatusBar from './ForgeStatusBar'
import ContextMenu, { type ContextMenuState } from './ContextMenu'
import type { Project } from '@/lib/types'
import { getTemplate, type TemplateCatalogNode } from '@/lib/templates'
import { saveLayout, loadLayout, seedLayoutFromDB } from '@/lib/canvas-storage'
import type { CanvasLayout } from '@/lib/canvas-storage'

const FIXED_NODE_IDS = new Set(['gdd', 'export'])

/* ─── Unified node hydration — graph-based dependency logic ─── */

function hydrateNodes(nodes: Node[], project: Project | null, edges: Edge[] = []): Node[] {
  // Map stepKey → nodeId (to resolve generation_jobs which store stepKey)
  const stepKeyToNodeId = new Map<string, string>()
  for (const n of nodes) {
    const sk = (n.data as unknown as ForgeNodeData).stepKey
    if (sk) stepKeyToNodeId.set(sk, n.id)
  }

  // Build set of approved node IDs
  const approved = new Set<string>()
  if (project) {
    if ((project.current_wizard_step ?? 0) > 1) approved.add('gdd')
    for (const job of project.generation_jobs ?? []) {
      if (job.status === 'approved') {
        approved.add(stepKeyToNodeId.get(job.current_step) ?? job.current_step)
      }
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
    if (data.comingSoon) return n

    const nodeApproved = approved.has(n.id)
    const parents = parentMap.get(n.id) ?? []

    let status: ForgeNodeData['status']
    if (nodeApproved) {
      status = 'complete'
    } else if (parents.length === 0 || parents.every(pid => approved.has(pid))) {
      // No parents in graph (e.g. GDD) or all parents approved → available
      status = project ? 'idle' : (n.id === 'gdd' ? 'idle' : 'locked')
    } else {
      status = 'locked'
    }

    return { ...n, data: { ...n.data, status, approved: nodeApproved } }
  })
}

function fe(id: string, src: string, tgt: string, cat: ForgeNodeCategory, active = true): Edge {
  return {
    id, source: src, target: tgt,
    type: 'forgeEdge',
    data: { color: CAT_VAR[cat], active },
    style: { stroke: CAT_VAR[cat] },
  }
}

const NODE_TYPES = { forgeNode: ForgeNode, forgeGroup: ForgeGroupNode }
const EDGE_TYPES = { forgeEdge: ForgeEdge }

/* ─── Fixed nodes: GDD + Export ─── */
function buildFixedNodes(project: Project | null): Node[] {
  const gdd = project?.concept
  return [
    {
      id: 'gdd', type: 'forgeNode', position: { x: 60, y: 300 },
      data: {
        label: 'Game Design Doc', category: 'design', icon: 'GD', num: '01',
        status: 'idle', stepKey: 'gdd',
        rows: [
          { key: 'genre',  value: gdd?.project.genre ?? '–', accent: true },
          { key: 'tone',   value: gdd?.project.tone  ?? '–' },
          { key: 'engine', value: gdd?.development.suggested_engine ?? '–' },
        ],
        inputs: [], outputs: [{ id: 'o', label: 'GDD Draft' }],
        previewType: 'text', previewContent: gdd?.project.elevator_pitch,
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
  const [log, setLog] = useState('')
  const [zoom, setZoom] = useState(0.85)
  const [ctxMenu, setCtxMenu] = useState<ContextMenuState | null>(null)
  const [framePrompt, setFramePrompt] = useState<XYPosition | null>(null)

  const initialState = (() => {
    if (initialProject?.id) {
      // If DB has a canvas_layout, seed localStorage with it (cross-device sync)
      if (initialProject.canvas_layout) {
        seedLayoutFromDB(initialProject.id, initialProject.canvas_layout as CanvasLayout)
      }
      const saved = loadLayout(initialProject.id)
      if (saved) return { nodes: hydrateNodes(saved.nodes, initialProject, saved.edges), edges: saved.edges }
      // Existing project with no saved layout → auto-apply 2D template
      const fixed = buildFixedNodes(initialProject)
      const { nodes, edges } = applyTemplate('2d_game', fixed)
      return { nodes: hydrateNodes(nodes, initialProject, edges), edges }
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
      const { nodes, edges } = applyTemplate('2d_game', fixed)
      setFlowNodes(hydrateNodes(nodes, initialProject, edges)); setFlowEdges(edges); return
    }
    setFlowNodes(buildFixedNodes(initialProject))
    setFlowEdges([])
  }, [initialProject]) // eslint-disable-line react-hooks/exhaustive-deps

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
    setFlowNodes(ns => ns.filter(n => n.id !== nodeId))
    setFlowEdges(es => es.filter(e => e.source !== nodeId && e.target !== nodeId))
    if (selectedId === nodeId) setSelectedId(null)
    setLog(`Deleted "${nodeId}"`)
  }

  function handleDeleteEdge(edgeId: string) {
    setFlowEdges(es => es.filter(e => e.id !== edgeId))
    setLog('Edge deleted')
  }

  function handleCreateFrame(flowX: number, flowY: number) {
    setFramePrompt({ x: flowX, y: flowY })
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

  function handleRefresh() {
    onRefresh()
    setLog('Pipeline refreshed')
  }

  function handleNodeApproved(stepKey: string) {
    setFlowNodes(ns => ns.map(n => {
      const d = n.data as unknown as ForgeNodeData
      if (d.stepKey === stepKey) return { ...n, data: { ...d, status: 'complete' as const, approved: true } }
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

  function handleProjectCreated(p: Project) {
    setLiveProject(p)
    // Auto-apply 2D template so the full pipeline is visible immediately
    const fixed = buildFixedNodes(p)
    const { nodes, edges } = applyTemplate('2d_game', fixed)
    setFlowNodes(hydrateNodes(nodes, p, edges))
    setFlowEdges(edges)
    prevRef.current = p
    setSelectedId('sprites')       // focus the next active node
    setLog(`Project "${p.name}" created! Pipeline ready — start with Sprites.`)
    onProjectCreated?.(p)
    if (typeof window !== 'undefined') {
      window.history.replaceState(null, '', `/projects/${p.id}`)
    }
  }

  const toolbarProject = liveProject ?? {
    id: '', name: 'New game', description: '', genre: '',
    target_engine: '', status: 'draft', owner_member_id: '',
    concept: null as unknown as Project['concept'],
    created_at: '',
  }

  return (
    <div
      className="forge-app"
      style={{ gridTemplateColumns: `${libraryOpen ? 220 : 32}px 1fr 280px` }}
    >
      <ForgeToolbar project={toolbarProject} phase="idle" onRefresh={handleRefresh} nodes={flowNodes} />

      <LibraryPanel
        nodes={flowNodes}
        selectedNodeId={selectedId}
        onSelect={setSelectedId}
        onFocus={handleFocusNode}
        isOpen={libraryOpen}
        onToggle={() => setLibraryOpen(o => !o)}
      />

      <div className="forge-canvas">
        <div style={{ position: 'absolute', inset: 0 }}>
          <ReactFlow
            nodes={flowNodes.map(n => ({ ...n, selected: n.id === selectedId }))}
            edges={flowEdges}
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
            fitView
            fitViewOptions={{ padding: 0.12, maxZoom: 0.8 }}
            minZoom={0.06}
            maxZoom={2}
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
          />
        )}

        {framePrompt && (
          <FrameNameModal
            onConfirm={confirmFrame}
            onCancel={() => setFramePrompt(null)}
          />
        )}
      </div>

      <InspectorPanel
        node={selectedNode}
        project={liveProject}
        onRefresh={handleRefresh}
        onApproved={handleNodeApproved}
        onLog={setLog}
        onProjectCreated={handleProjectCreated}
        onApproveNode={handleApproveNode}
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
