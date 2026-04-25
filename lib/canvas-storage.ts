import type { Node, Edge, Viewport } from '@xyflow/react'

export interface CanvasLayout {
  templateId: string | null
  nodes: Node[]
  edges: Edge[]
  viewport?: Viewport
}

const key = (projectId: string) => `forge_canvas_${projectId}`

export function saveLayout(projectId: string, layout: CanvasLayout): void {
  try {
    localStorage.setItem(key(projectId), JSON.stringify(layout))
  } catch { /* storage full or SSR */ }
}

export function loadLayout(projectId: string): CanvasLayout | null {
  try {
    const raw = localStorage.getItem(key(projectId))
    return raw ? (JSON.parse(raw) as CanvasLayout) : null
  } catch { return null }
}

export function clearLayout(projectId: string): void {
  try { localStorage.removeItem(key(projectId)) } catch { /* noop */ }
}
