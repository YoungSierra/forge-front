import type { Node, Edge, Viewport } from '@xyflow/react'
import { saveCanvasLayout } from './api'

export interface CanvasLayout {
  templateId: string | null
  nodes: Node[]
  edges: Edge[]
  viewport?: Viewport
  container_layouts?: Record<string, Record<string, { x: number; y: number }>>
}

const key    = (projectId: string) => `forge_canvas_${projectId}`
const ctrKey = (projectId: string, containerKey: string) => `forge_canvas_${projectId}_ctr_${containerKey}`

const dbTimers: Record<string, ReturnType<typeof setTimeout>> = {}

export function saveLayout(projectId: string, layout: CanvasLayout): void {
  try {
    localStorage.setItem(key(projectId), JSON.stringify(layout))
  } catch { /* storage full or SSR */ }

  // Debounced DB save — 3 seconds after last change
  if (dbTimers[projectId]) clearTimeout(dbTimers[projectId])
  dbTimers[projectId] = setTimeout(() => {
    saveCanvasLayout(projectId, layout).catch(() => { /* silent — localStorage is the fallback */ })
    delete dbTimers[projectId]
  }, 3000)
}

export function loadLayout(projectId: string): CanvasLayout | null {
  try {
    const raw = localStorage.getItem(key(projectId))
    return raw ? (JSON.parse(raw) as CanvasLayout) : null
  } catch { return null }
}

export function seedLayoutFromDB(projectId: string, layout: CanvasLayout): void {
  try {
    localStorage.setItem(key(projectId), JSON.stringify(layout))
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
): void {
  try {
    localStorage.setItem(ctrKey(projectId, containerKey), JSON.stringify(positions))
  } catch { /* noop */ }

  const timerKey = `${projectId}_${containerKey}`
  if (dbTimers[timerKey]) clearTimeout(dbTimers[timerKey])
  dbTimers[timerKey] = setTimeout(() => {
    const existing: CanvasLayout = loadLayout(projectId) ?? { templateId: null, nodes: [], edges: [] }
    const merged: CanvasLayout = {
      ...existing,
      container_layouts: { ...existing.container_layouts, [containerKey]: positions },
    }
    saveCanvasLayout(projectId, merged).catch(() => {})
    delete dbTimers[timerKey]
  }, 3000)
}

export function loadContainerLayout(
  projectId: string,
  containerKey: string,
): Record<string, { x: number; y: number }> | null {
  try {
    const raw = localStorage.getItem(ctrKey(projectId, containerKey))
    return raw ? JSON.parse(raw) : null
  } catch { return null }
}

export function seedContainerLayoutFromDB(
  projectId: string,
  containerKey: string,
  canvasLayout: unknown,
): void {
  const positions = (canvasLayout as CanvasLayout)?.container_layouts?.[containerKey]
  if (!positions) return
  try {
    localStorage.setItem(ctrKey(projectId, containerKey), JSON.stringify(positions))
  } catch { /* noop */ }
}
