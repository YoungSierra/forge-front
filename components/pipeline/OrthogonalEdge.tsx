'use client'

import { memo, useCallback, useRef } from 'react'
import { EdgeLabelRenderer, type EdgeProps, useViewport } from '@xyflow/react'

// ─── Tipos ────────────────────────────────────────────────────────────────────

export interface WayPoint { x: number; y: number }

export interface OrthogonalEdgeData extends Record<string, unknown> {
  color?:             string
  active?:            boolean
  approved?:          boolean
  dimmed?:            boolean
  waypoints?:         WayPoint[]
  onWaypointsChange?: (id: string, waypoints: WayPoint[]) => void
  onDelete?:          () => void
}

// ─── Animaciones (mismas que ForgeEdge) ──────────────────────────────────────

const FORGYI_CLR = '#F59E0B'
const ANIM_KF = `
@keyframes forgyi-flow {
  from { stroke-dashoffset: 28; }
  to   { stroke-dashoffset: 0; }
}
@keyframes forgyi-pulse {
  0%, 100% { opacity: 0.18; }
  50%       { opacity: 0.52; }
}
`

// ─── Lógica de path ───────────────────────────────────────────────────────────

/**
 * Construye el SVG path ortogonal (segmentos H/V) pasando por los waypoints.
 * Sin waypoints → enrutado automático: H hasta midX, V hasta targetY, H hasta targetX.
 * Con waypoints → rutar por cada punto intermedio usando H primero, luego V.
 */
export function buildOrthogonalPath(
  sx: number, sy: number,
  tx: number, ty: number,
  waypoints: WayPoint[],
): string {
  const pts: WayPoint[] = [{ x: sx, y: sy }, ...waypoints, { x: tx, y: ty }]

  if (waypoints.length === 0) {
    const midX = (sx + tx) / 2
    // 3 segmentos: H midX → V ty → H tx
    return `M ${sx},${sy} H ${midX} V ${ty} H ${tx}`
  }

  let d = `M ${sx},${sy}`
  for (let i = 1; i < pts.length; i++) {
    const dx = pts[i].x - pts[i - 1].x
    const dy = pts[i].y - pts[i - 1].y
    if (Math.abs(dx) > 0.1) d += ` H ${pts[i].x}`
    if (Math.abs(dy) > 0.1) d += ` V ${pts[i].y}`
  }
  return d
}

/**
 * Devuelve los waypoints efectivos para arrastrar.
 * Sin waypoints guardados → materializa los 2 corners del auto-route (midX).
 */
function effectiveWaypoints(
  sx: number, sy: number,
  tx: number, ty: number,
  stored: WayPoint[],
): WayPoint[] {
  if (stored.length > 0) return stored
  const midX = (sx + tx) / 2
  return [{ x: midX, y: sy }, { x: midX, y: ty }]
}

// ─── Componente ───────────────────────────────────────────────────────────────

function OrthogonalEdge({
  id, sourceX, sourceY, targetX, targetY,
  data, selected,
}: EdgeProps) {
  const d         = data as OrthogonalEdgeData
  const approved  = d?.approved ?? false
  const active    = d?.active   ?? false
  const dimmed    = d?.dimmed   ?? false
  const color     = approved ? FORGYI_CLR : (d?.color ?? 'var(--text-3)')
  const edgeColor = selected ? '#EF4444' : color
  const stored    = (d?.waypoints ?? []) as WayPoint[]
  const { zoom }  = useViewport()

  const edgePath   = buildOrthogonalPath(sourceX, sourceY, targetX, targetY, stored)
  const handles    = effectiveWaypoints(sourceX, sourceY, targetX, targetY, stored)

  // midpoint para el botón de eliminar
  const midX = (sourceX + targetX) / 2
  const midY = (sourceY + targetY) / 2

  // Ref de zoom para evitar stale closures en drag handlers
  const zoomRef = useRef(zoom)
  zoomRef.current = zoom

  // ── Drag de un waypoint ────────────────────────────────────────────────────
  const handleWpMouseDown = useCallback((e: React.MouseEvent, idx: number) => {
    e.stopPropagation()
    e.preventDefault()

    const startCX = e.clientX
    const startCY = e.clientY
    // Snapshot de waypoints al iniciar el drag
    const snapshot = effectiveWaypoints(sourceX, sourceY, targetX, targetY, stored)
    const origin   = { ...snapshot[idx] }

    const onMove = (me: MouseEvent) => {
      const dx = (me.clientX - startCX) / zoomRef.current
      const dy = (me.clientY - startCY) / zoomRef.current
      const updated = snapshot.map((wp, i) =>
        i === idx ? { x: origin.x + dx, y: origin.y + dy } : { ...wp },
      )
      d?.onWaypointsChange?.(id, updated)
    }

    const onUp = () => {
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup',   onUp)
    }

    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup',   onUp)
  }, [id, sourceX, sourceY, targetX, targetY, stored, d])

  // ── Doble click en un handle → eliminar ese waypoint ──────────────────────
  const handleWpDblClick = useCallback((e: React.MouseEvent, idx: number) => {
    e.stopPropagation()
    // Solo eliminar si hay waypoints guardados (no auto-generados)
    if (stored.length === 0) return
    const updated = stored.filter((_, i) => i !== idx)
    d?.onWaypointsChange?.(id, updated)
  }, [id, stored, d])

  const btnBase: React.CSSProperties = {
    position:     'absolute',
    pointerEvents:'all',
    borderRadius: '50%',
    background:   'var(--bg-1)',
    cursor:       'pointer',
    display:      'flex',
    alignItems:   'center',
    justifyContent: 'center',
    lineHeight:   1,
    padding:      0,
  }

  return (
    <>
      {(approved) && <style>{ANIM_KF}</style>}
      <g style={{ opacity: dimmed ? 0.07 : 1, transition: 'opacity 120ms ease' }}>
        {/* Hit area amplio para facilitar selección y futuro click-to-add-waypoint */}
        <path
          d={edgePath}
          fill="none"
          stroke="transparent"
          strokeWidth={14}
          style={{ cursor: 'pointer', pointerEvents: 'all' }}
        />

        {approved ? (
          <>
            <path className="forge-edge-fx" d={edgePath} fill="none" stroke={FORGYI_CLR} strokeWidth={8}
              strokeLinejoin="miter"
              style={{ filter: 'blur(6px)', animation: 'forgyi-pulse 1.8s ease-in-out infinite' }} />
            <path d={edgePath} fill="none" stroke={FORGYI_CLR} strokeWidth={1.5}
              opacity={0.35} strokeLinejoin="miter" />
            <path className="forge-edge-fx" d={edgePath} fill="none" stroke={FORGYI_CLR} strokeWidth={2}
              strokeDasharray="10 18" strokeLinejoin="miter"
              style={{ filter: `drop-shadow(0 0 5px ${FORGYI_CLR})`, animation: 'forgyi-flow 1s linear infinite' }} />
          </>
        ) : (
          <>
            {/* Glow */}
            <path className="forge-edge-fx" d={edgePath} fill="none" stroke={edgeColor}
              strokeWidth={active || selected ? 3 : 2}
              opacity={active || selected ? 0.35 : 0.1}
              strokeLinejoin="miter"
              style={{ filter: 'blur(3px)' }} />
            {/* Cable principal */}
            <path id={id} d={edgePath} fill="none" stroke={edgeColor}
              strokeWidth={active || selected ? 2 : 1.6}
              opacity={selected ? 0.95 : active ? 0.85 : 0.5}
              strokeLinejoin="miter"
              style={{ filter: `drop-shadow(0 0 3px ${edgeColor})` }} />
          </>
        )}
      </g>

      <EdgeLabelRenderer>
        {/* Handles de waypoints — visibles al seleccionar */}
        {selected && handles.map((wp, i) => (
          <div
            key={i}
            title={stored.length > 0 ? 'Drag to move · Double-click to remove' : 'Drag to adjust routing'}
            className="nodrag nopan"
            onMouseDown={e => handleWpMouseDown(e, i)}
            onDoubleClick={e => handleWpDblClick(e, i)}
            style={{
              ...btnBase,
              transform: `translate(-50%, -50%) translate(${wp.x}px, ${wp.y}px)`,
              width:  10,
              height: 10,
              border: `2px solid ${edgeColor}`,
              boxShadow: `0 0 6px ${edgeColor}88`,
              cursor: 'move',
            }}
          />
        ))}

        {/* Botón eliminar edge */}
        {selected && d?.onDelete && (
          <button
            className="nodrag nopan"
            onClick={() => d?.onDelete?.()}
            title="Delete edge"
            style={{
              ...btnBase,
              transform: `translate(-50%, -50%) translate(${midX}px, ${midY}px)`,
              width:  18,
              height: 18,
              border: `1px solid ${approved ? FORGYI_CLR : '#EF4444'}`,
              color:  approved ? FORGYI_CLR : '#EF4444',
              fontSize: 12, fontWeight: 700,
              boxShadow: `0 0 8px ${approved ? FORGYI_CLR + '55' : '#EF444455'}`,
            }}
          >
            ×
          </button>
        )}
      </EdgeLabelRenderer>
    </>
  )
}

export default memo(OrthogonalEdge)
