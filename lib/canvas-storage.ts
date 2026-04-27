import type { Node, Edge, Viewport } from '@xyflow/react'
import { saveCanvasLayout } from './api'

export interface CanvasLayout {
  templateId: string | null
  nodes: Node[]
  edges: Edge[]
  viewport?: Viewport
}

const key = (projectId: string) => `forge_canvas_${projectId}`

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
