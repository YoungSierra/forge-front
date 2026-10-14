'use client'

// ─── Engine v1.8 · «Regenerate slice breakdowns» (panel del 3.9) ─────────────────────────────
// Llama a POST /api/projects/:id/canvas/nodes/:project_node_id/regenerate-slice: el motor rehace SOLO
// los grupos del ADD que dependen del Vertical Slice (§7.3.1, §7.9.1, §7.10.1, §7.11.1) sobre el ADD
// aprobado, con el VS Spec del 3.13 a la vista, y vuelve a extraer los 11 ADI. Visible solo cuando el
// proyecto tiene un 3.13 aprobado (lo decide quien lo monta). El 422 SLICE_SCOPE_MISSING y cualquier
// otro error se muestran tal cual los manda el back (`request` lanza Error(body.error)).

import { useState } from 'react'
import { regenerateSliceBreakdowns, type SliceRegeneration } from '@/lib/api'

export type EstadoSlice = 'idle' | 'running' | 'done' | 'error'
export const MENSAJE_SLICE_OK = 'Breakdowns regenerated and ADI re-extracted. Re-run 3.20 to use them.'

/** El aviso del canvas tras aprobar el 3.13: qué pasó con la regeneración automática de los desgloses del ADD. */
export function mensajeDeRegeneracion(d: SliceRegeneration[] | undefined | null): string | null {
  if (!d?.length) return null
  return d.map(x => {
    const doc = `${x.node_key} ${x.output_key}`
    if (x.started) return `Regenerating the slice breakdowns of ${doc} in the background (§7.3.1 · §7.9.1 · §7.10.1 · §7.11.1), then re-extracting the ADI packages. Open ${x.node_key} to follow it; 3.20 unlocks when they are done.`
    switch (x.skipped) {
      case 'NO_MASTER':   return `${doc} is not generated yet: when ${x.node_key} runs it will read the approved Vertical Slice directly.`
      case 'IN_PROGRESS': return `The slice breakdowns of ${doc} are already being regenerated.`
      case 'SEALED':      return `The phase of ${x.node_key} is sealed: its slice breakdowns were not regenerated.`
      case 'NO_CREDIT':   return `No credit to regenerate the slice breakdowns of ${doc}: top up, then use 'Regenerate slice breakdowns' on ${x.node_key}.`
      default:            return `The slice breakdowns of ${doc} were not regenerated (${x.skipped ?? 'skipped'}). Use 'Regenerate slice breakdowns' on ${x.node_key}.`
    }
  }).join(' ')
}

/** La parte visual, sin estado: así se puede renderizar en cada estado en una prueba. */
export function RegenerateSliceView({ estado, mensaje, onClick }: { estado: EstadoSlice; mensaje: string | null; onClick: () => void }) {
  const corriendo = estado === 'running'
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      <button
        onClick={onClick}
        disabled={corriendo}
        title="Rewrite only the slice-dependent breakdowns of the Art Direction Document (§7.3.1 · §7.9.1 · §7.10.1 · §7.11.1) from the approved Vertical Slice Specification, then re-extract the ADI packages"
        style={{
          width: '100%', padding: '9px 12px', borderRadius: 6, cursor: corriendo ? 'default' : 'pointer',
          border: '1px solid color-mix(in srgb, #F59E0B 40%, var(--line-2))',
          background: 'color-mix(in srgb, #F59E0B 10%, var(--bg-2))',
          color: '#F59E0B', fontSize: 11, fontFamily: 'var(--font-mono)', fontWeight: 700, letterSpacing: '0.03em',
          opacity: corriendo ? 0.6 : 1,
        }}
      >
        {corriendo ? '◷ Regenerating slice breakdowns…' : '↻ Regenerate slice breakdowns'}
      </button>
      {mensaje && (
        <div
          role="status"
          style={{
            fontSize: 10, fontFamily: 'var(--font-mono)', lineHeight: 1.5, padding: '6px 9px', borderRadius: 5,
            color: estado === 'error' ? '#F87171' : '#34D399',
            background: estado === 'error' ? 'rgba(248,113,113,0.08)' : 'rgba(52,211,153,0.08)',
            border: `1px solid ${estado === 'error' ? 'rgba(248,113,113,0.35)' : 'rgba(52,211,153,0.35)'}`,
          }}
        >{mensaje}</div>
      )}
    </div>
  )
}

export default function RegenerateSliceButton({ projectId, projectNodeId, onDone }: { projectId: string; projectNodeId: string; onDone?: () => void }) {
  const [estado, setEstado] = useState<EstadoSlice>('idle')
  const [mensaje, setMensaje] = useState<string | null>(null)
  const correr = async () => {
    if (estado === 'running') return
    setEstado('running'); setMensaje(null)
    try {
      await regenerateSliceBreakdowns(projectId, projectNodeId)
      setEstado('done'); setMensaje(MENSAJE_SLICE_OK)
      onDone?.()
    } catch (e) {
      // el texto del back, tal cual: «This project has no approved Vertical Slice Specification yet: …» (422)
      setEstado('error'); setMensaje(e instanceof Error ? e.message : String(e))
    }
  }
  return <RegenerateSliceView estado={estado} mensaje={mensaje} onClick={correr} />
}
