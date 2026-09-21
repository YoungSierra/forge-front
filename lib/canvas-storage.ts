import type { Node, Edge, Viewport } from '@xyflow/react'
import { saveCanvasLayout } from './api'

export interface CanvasLayout {
  templateId: string | null
  // Opcionales a propósito: `canvas_layout` tiene dos dueños -el canvas y el moodboard- y en la
  // base hay filas que quedaron solo con `moodboard`. Declararlos obligatorios hacía que el
  // compilador aprobara `layout.nodes.reduce(...)` sobre algo que en producción era undefined.
  nodes?: Node[]
  edges?: Edge[]
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

/**
 * El acomodo, reducido a lo que ES un acomodo: dónde va cada cosa.
 *
 * Se guardaba el array de nodos de React Flow tal cual, y cada nodo arrastra dentro su
 * `data.canvasNode` — la DNA, sus salidas, sus sesiones. Medido el 21-09 en `13_lives_kitten_TEST`:
 * UN nodo pesaba **738 KB** y los 21 sumaban **2.428 KB**. Lo que hace falta para recolocarlos son
 * **1,5 KB**.
 *
 * Eso es lo que reventó: escribir 2,4 MB cada vez que alguien mueve un nodo hacía que Postgres
 * cancelara la sentencia a los 34 segundos, y que la lectura previa del otro dueño de la columna
 * expirara — y una mezcla sobre una lectura fallida borra la mitad que no trae. `v.09` perdió así
 * el acomodo de sus 29 nodos.
 *
 * Lo que se quita no se pierde: vive en la base y el canvas lo vuelve a pedir al cargar, que es de
 * donde salió. Guardarlo acá era tener dos copias y mantener la mala.
 */
function soloPosiciones(layout: CanvasLayout): CanvasLayout {
  return {
    ...layout,
    nodes: layout.nodes?.map(n => ({
      id: n.id,
      position: n.position,
      ...(n.type ? { type: n.type } : {}),
      // Dos números que evitan el salto del primer pintado mientras React Flow mide.
      ...(n.measured ? { measured: n.measured } : {}),
    })) as Node[] | undefined,
    // Las aristas NO son el problema —154 pesaban 51 KB— y llevan algo que no se puede tirar: los
    // `waypoints`, los puntos por los que alguien hizo pasar un cable a mano. Se conservan esos y
    // se deja fuera el resto de su `data`, que se reconstruye.
    edges: layout.edges?.map(e => {
      const wp = (e.data as { waypoints?: unknown[] } | undefined)?.waypoints
      return {
        id: e.id, source: e.source, target: e.target,
        ...(e.sourceHandle ? { sourceHandle: e.sourceHandle } : {}),
        ...(e.targetHandle ? { targetHandle: e.targetHandle } : {}),
        ...(e.type ? { type: e.type } : {}),
        ...(wp?.length ? { data: { waypoints: wp } } : {}),
      }
    }) as Edge[] | undefined,
  }
}

export function saveLayout(projectId: string, layout: CanvasLayout, immediate = false): void {
  const magro = soloPosiciones(layout)
  try {
    // También en `localStorage`, que tiene un tope de unos 5 MB por origen: con dos proyectos
    // gordos abiertos se llenaba y el `catch` se lo tragaba en silencio.
    localStorage.setItem(key(projectId), JSON.stringify(magro))
  } catch { /* storage full or SSR */ }

  if (dbTimers[projectId]) clearTimeout(dbTimers[projectId])
  if (immediate) {
    saveCanvasLayout(projectId, magro).catch(() => {})
  } else {
    dbTimers[projectId] = setTimeout(() => {
      saveCanvasLayout(projectId, magro).catch(() => {})
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
    // También por acá: este camino reconstruye el acomodo desde lo guardado y lo reescribe, así
    // que sin recortar volvería a subir los nodos enteros aunque el otro camino ya no lo haga.
    saveCanvasLayout(projectId, soloPosiciones(merged)).catch(() => {})
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
