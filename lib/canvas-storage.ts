import type { Node, Edge, Viewport } from '@xyflow/react'
import { saveCanvasLayout } from './api'

export interface CanvasLayout {
  templateId: string | null
  nodes: Node[]
  edges: Edge[]
  viewport?: Viewport
  container_layouts?: Record<string, ContainerLayoutData>
}

export interface ContainerLayoutData {
  positions: Record<string, { x: number; y: number }>
  viewport?: Viewport
}

const key    = (projectId: string) => `forge_canvas_${projectId}`
const ctrKey = (projectId: string, containerKey: string) => `forge_canvas_${projectId}_ctr_${containerKey}`

const dbTimers: Record<string, ReturnType<typeof setTimeout>> = {}

export function saveLayout(projectId: string, layout: CanvasLayout, immediate = false): void {
  try {
    localStorage.setItem(key(projectId), JSON.stringify(layout))
  } catch { /* storage full or SSR */ }

  if (dbTimers[projectId]) clearTimeout(dbTimers[projectId])
  if (immediate) {
    saveCanvasLayout(projectId, layout).catch(() => {})
  } else {
    dbTimers[projectId] = setTimeout(() => {
      saveCanvasLayout(projectId, layout).catch(() => {})
      delete dbTimers[projectId]
    }, 3000)
  }
}

export function loadLayout(projectId: string): CanvasLayout | null {
  try {
    const raw = localStorage.getItem(key(projectId))
    return raw ? (JSON.parse(raw) as CanvasLayout) : null
  } catch { return null }
}

export function seedLayoutFromDB(projectId: string, layout: CanvasLayout): void {
  try {
    // Normaliza handles legacy (out-xxx → out, in-xxx → in) al sembrar desde DB
    const normalized: CanvasLayout = {
      ...layout,
      edges: (layout.edges ?? []).map(e => ({
        ...e,
        sourceHandle: e.sourceHandle?.startsWith('out-') ? 'out' : e.sourceHandle,
        targetHandle: e.targetHandle?.startsWith('in-')  ? 'in'  : e.targetHandle,
      })),
    }
    localStorage.setItem(key(projectId), JSON.stringify(normalized))
  } catch { /* noop */ }
}

export function clearLayout(projectId: string): void {
  try { localStorage.removeItem(key(projectId)) } catch { /* noop */ }
}

// ─── Container layouts ────────────────────────────────────────────────────────

export function saveContainerLayout(
  projectId: string,
  containerKey: string,
  positions: Record<string, { x: number; y: number }>,
  viewport?: Viewport,
): void {
  const data: ContainerLayoutData = { positions, viewport }
  try {
    localStorage.setItem(ctrKey(projectId, containerKey), JSON.stringify(data))
  } catch { /* noop */ }

  const timerKey = `${projectId}_${containerKey}`
  if (dbTimers[timerKey]) clearTimeout(dbTimers[timerKey])
  dbTimers[timerKey] = setTimeout(() => {
    const existing: CanvasLayout = loadLayout(projectId) ?? { templateId: null, nodes: [], edges: [] }
    const merged: CanvasLayout = {
      ...existing,
      container_layouts: { ...existing.container_layouts, [containerKey]: data },
    }
    saveCanvasLayout(projectId, merged).catch(() => {})
    delete dbTimers[timerKey]
  }, 3000)
}

export function loadContainerLayout(
  projectId: string,
  containerKey: string,
): ContainerLayoutData | null {
  try {
    const raw = localStorage.getItem(ctrKey(projectId, containerKey))
    if (!raw) return null
    const parsed = JSON.parse(raw)
    // Backward compat: formato viejo era un Record<string, {x,y}> plano (sin clave "positions")
    if (parsed && typeof parsed === 'object' && !('positions' in parsed)) {
      return { positions: parsed as Record<string, { x: number; y: number }> }
    }
    return parsed as ContainerLayoutData
  } catch { return null }
}

export function seedContainerLayoutFromDB(
  projectId: string,
  containerKey: string,
  canvasLayout: unknown,
): void {
  const raw = (canvasLayout as CanvasLayout)?.container_layouts?.[containerKey]
  if (!raw) return
  // Backward compat: el DB puede tener el formato viejo (posiciones planas)
  const rawAny = raw as unknown as Record<string, unknown>
  const data: ContainerLayoutData = ('positions' in rawAny)
    ? raw as ContainerLayoutData
    : { positions: rawAny as unknown as Record<string, { x: number; y: number }> }
  try {
    localStorage.setItem(ctrKey(projectId, containerKey), JSON.stringify(data))
  } catch { /* noop */ }
}
