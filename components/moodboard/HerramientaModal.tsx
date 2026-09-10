'use client'

import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import MaskPainter, { type MaskPainterHandle } from '@/components/shared/MaskPainter'
import { runAssetTool, uploadToComfyUI, type HerramientaDeAsset } from '@/lib/api'

// ─── Segmentación y Nuevo Ángulo ─────────────────────────────────────────────
//
// Las dos herramientas del sector «Editar 2D» del radial (documento de integración del Moodboard,
// §3 y §4). Comparten recuadro porque comparten el gesto: se mira la pieza, se ajusta una sola
// cosa —la máscara o el ángulo— y se corre. Lo que producen NO reemplaza la página: se publica a
// su derecha, colgado de ella.
//
// El recuadro previo no es decorativo. Cada corrida es pago y no se reproduce —ComfyUI devuelve
// una imagen distinta con el mismo payload—, así que decir qué se va a generar antes de disparar
// es lo que separa ejecutar de apostar.

// El fetch directo a R2 lo bloquea CORS, y sin poder leer los píxeles no hay máscara que componer.
async function urlAArchivo(imageUrl: string): Promise<File> {
  const res = await fetch(`/api/proxy-image?url=${encodeURIComponent(imageUrl)}`)
  if (!res.ok) throw new Error(`No se pudo cargar la imagen de origen (${res.status})`)
  const blob = await res.blob()
  return new File([blob], `origen-${Date.now()}.png`, { type: blob.type || 'image/png' })
}

const mono: React.CSSProperties = { fontFamily: 'var(--font-mono)' }

export default function HerramientaModal({
  asset, projectId, herramienta, accent, memberId, onCancel, onListo,
}: {
  asset: { id: string; name: string; url: string | null }
  projectId: string
  herramienta: HerramientaDeAsset
  accent: string
  memberId?: string | null
  onCancel: () => void
  onListo: (ids: string[]) => void
}) {
  const esMascara = herramienta.pide_mascara
  const campos    = herramienta.controles?.campos ?? []

  const [archivo,  setArchivo]  = useState<File | null>(null)
  const [cargando, setCargando] = useState(esMascara)
  const [pincel,   setPincel]   = useState(48)
  const [valores,  setValores]  = useState<Record<string, number>>(
    () => Object.fromEntries(campos.map(c => [c.campo, c.defecto ?? c.min ?? 0])),
  )
  const [corriendo, setCorriendo] = useState(false)
  const [error,     setError]     = useState<string | null>(null)
  const mascaraRef = useRef<MaskPainterHandle>(null)

  useEffect(() => {
    if (!esMascara || !asset.url) return
    let vivo = true
    urlAArchivo(asset.url)
      .then(f => { if (vivo) setArchivo(f) })
      .catch(e => { if (vivo) setError(e instanceof Error ? e.message : String(e)) })
      .finally(() => { if (vivo) setCargando(false) })
    return () => { vivo = false }
  }, [esMascara, asset.url])

  useEffect(() => {
    const k = (e: KeyboardEvent) => { if (e.key === 'Escape' && !corriendo) { e.stopPropagation(); onCancel() } }
    window.addEventListener('keydown', k, true)
    return () => window.removeEventListener('keydown', k, true)
  }, [onCancel, corriendo])

  async function correr() {
    setError(null)
    setCorriendo(true)
    try {
      let imagenComfy: string | null = null
      if (esMascara) {
        // Sin trazos no hay nada que aislar: el workflow devolvería la lámina entera recortada
        // contra una máscara vacía. Se corta acá, antes de pagar la corrida.
        if (!mascaraRef.current?.hasStrokes()) throw new Error('Pintá la parte que querés aislar antes de correr.')
        const compuesta = await mascaraRef.current.getComposedBlob()
        if (!compuesta) throw new Error('No se pudo componer la máscara.')
        imagenComfy = await uploadToComfyUI(compuesta, `mask-${Date.now()}.png`)
      }
      const r = await runAssetTool(projectId, asset.id, {
        herramienta: herramienta.clave,
        opciones: campos.length ? valores : null,
        imagenComfy,
        memberId,
      })
      onListo((r.creados || []).map(c => c.id))
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
      setCorriendo(false)
    }
  }

  return createPortal(
    <div
      data-mb-menu
      onClick={e => { e.stopPropagation(); if (!corriendo) onCancel() }}
      style={{
        position: 'fixed', inset: 0, zIndex: 12200, background: 'rgba(6,8,11,0.86)',
        display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 28,
      }}
    >
      <div
        onClick={e => e.stopPropagation()}
        style={{
          width: esMascara ? 'min(940px, 94vw)' : 'min(560px, 94vw)',
          maxHeight: '92vh', overflowY: 'auto',
          background: 'var(--bg-1, #0e1116)', border: '1px solid var(--line-2, #232830)',
          borderRadius: 14, boxShadow: '0 28px 90px rgba(0,0,0,0.66)',
        }}
      >
        <div style={{ padding: '16px 20px', borderBottom: '1px solid var(--line-2, #232830)' }}>
          <div style={{ ...mono, fontSize: 10, letterSpacing: '.14em', color: accent, textTransform: 'uppercase' }}>
            {herramienta.etiqueta}
          </div>
          <div style={{ fontSize: 14, color: 'var(--text-0, #e8eef7)', marginTop: 4 }}>{asset.name}</div>
          <div style={{ fontSize: 11.5, color: 'var(--text-2, #8a92a3)', marginTop: 6, lineHeight: 1.5 }}>
            {esMascara
              ? 'Pintá la parte que querés aislar. Sale limpia sobre fondo blanco, como pieza nueva a la derecha de esta página — esta no se toca.'
              : 'Una vista nueva del mismo asset, sin cambiar diseño, color ni proporciones. Se publica a la derecha, colgada de esta pieza.'}
          </div>
        </div>

        <div style={{ padding: 20 }}>
          {esMascara && (
            <>
              {cargando && <div style={{ ...mono, fontSize: 12, color: 'var(--text-2, #8a92a3)' }}>Cargando la imagen…</div>}
              {archivo && (
                <>
                  <MaskPainter ref={mascaraRef} imageFile={archivo} brushSize={pincel} />
                  <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginTop: 12 }}>
                    <span style={{ ...mono, fontSize: 10, color: 'var(--text-2, #8a92a3)' }}>PINCEL</span>
                    <input type="range" min={8} max={140} value={pincel}
                           onChange={e => setPincel(Number(e.target.value))} style={{ flex: 1 }} />
                    <span style={{ ...mono, fontSize: 10, color: 'var(--text-2, #8a92a3)', width: 28 }}>{pincel}</span>
                    <button onClick={() => mascaraRef.current?.clear()}
                            style={{ ...mono, fontSize: 10, padding: '4px 10px', borderRadius: 6, cursor: 'pointer',
                                     border: '1px solid var(--line-2, #232830)', background: 'transparent', color: 'var(--text-2, #8a92a3)' }}>
                      LIMPIAR
                    </button>
                  </div>
                </>
              )}
            </>
          )}

          {campos.map(c => (
            <div key={c.campo} style={{ marginBottom: 18 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 6 }}>
                <span style={{ ...mono, fontSize: 10, letterSpacing: '.1em', color: 'var(--text-2, #8a92a3)', textTransform: 'uppercase' }}>
                  {c.etiqueta}
                </span>
                <span style={{ ...mono, fontSize: 12, color: accent }}>
                  {valores[c.campo]}{c.campo.includes('angle') ? '°' : ''}
                </span>
              </div>
              <input
                type="range" min={c.min} max={c.max} step={c.step || 1}
                value={valores[c.campo]}
                onChange={e => setValores(v => ({ ...v, [c.campo]: Number(e.target.value) }))}
                style={{ width: '100%' }}
              />
              {/* Los presets son la lectura humana del número: «Perfil Der» en vez de 90°. */}
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 8 }}>
                {c.presets.map(p => {
                  const activo = valores[c.campo] === p.valor
                  return (
                    <button key={p.nombre}
                      onClick={() => setValores(v => ({ ...v, [c.campo]: p.valor }))}
                      style={{
                        ...mono, fontSize: 10, padding: '4px 9px', borderRadius: 6, cursor: 'pointer',
                        border: `1px solid ${activo ? accent : 'var(--line-2, #232830)'}`,
                        background: activo ? `${accent}22` : 'transparent',
                        color: activo ? accent : 'var(--text-2, #8a92a3)',
                      }}>
                      {p.nombre}
                    </button>
                  )
                })}
              </div>
              {c.ayuda && <div style={{ fontSize: 10.5, color: 'var(--text-3, #6b7280)', marginTop: 6 }}>{c.ayuda}</div>}
            </div>
          ))}

          {herramienta.controles?.nota && (
            <div style={{ fontSize: 10.5, color: 'var(--text-3, #6b7280)', lineHeight: 1.5, marginTop: -6 }}>
              Una vista por corrida: para otro ángulo, se repite.
            </div>
          )}

          {error && (
            <div style={{ marginTop: 14, padding: '10px 12px', borderRadius: 8, fontSize: 12,
                          background: 'rgba(255,51,51,0.08)', border: '1px solid rgba(255,51,51,0.3)', color: '#ff8080' }}>
              {error}
            </div>
          )}
        </div>

        <div style={{ padding: '14px 20px', borderTop: '1px solid var(--line-2, #232830)',
                      display: 'flex', justifyContent: 'flex-end', gap: 10 }}>
          <button onClick={onCancel} disabled={corriendo}
                  style={{ ...mono, fontSize: 11, padding: '8px 14px', borderRadius: 7,
                           border: '1px solid var(--line-2, #232830)', background: 'transparent',
                           color: 'var(--text-2, #8a92a3)', cursor: corriendo ? 'not-allowed' : 'pointer' }}>
            CANCELAR
          </button>
          <button onClick={correr} disabled={corriendo || (esMascara && !archivo)}
                  style={{ ...mono, fontSize: 11, padding: '8px 18px', borderRadius: 7,
                           border: `1px solid ${accent}`, background: `${accent}22`, color: accent,
                           cursor: corriendo || (esMascara && !archivo) ? 'not-allowed' : 'pointer',
                           opacity: corriendo || (esMascara && !archivo) ? 0.6 : 1 }}>
            {corriendo ? 'GENERANDO…' : 'GENERAR'}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  )
}
