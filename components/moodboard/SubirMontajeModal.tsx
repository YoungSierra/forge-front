'use client'

import { useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { subirMontajeDeNivel, type UnifiedAsset } from '@/lib/api'

// ─── Recibir el nivel ya montado ─────────────────────────────────────────────
//
// Informe v9, punto 5 · documento de JuanK del 18-09. El nivel se arma fuera de Forge, en Blender,
// con el `.zip` de insumos que exporta esta misma página. Vuelve a mano: el modelo y sus renders.
//
// Los dos a la vez, y no es un capricho de la interfaz: «modelo y renders se suben y se reemplazan
// SIEMPRE juntos». Un montaje con el modelo nuevo y los renders viejos se lee como completo y
// miente sobre lo que hay. Por eso el botón no se habilita hasta tener las dos cosas.
//
// Y en el moodboard vive UN montaje por nivel, el último. Si ya había uno, este lo reemplaza y el
// anterior queda en la Asset Library.

const mono: React.CSSProperties = { fontFamily: 'var(--font-mono)' }

/** Lo que el documento nombra. No se exige el nombre exacto —quien monta decide cómo llamarlos—
 *  pero se enseña, para que se entienda qué se espera ver en la galería del nivel. */
const RENDERS_ESPERADOS = [
  ['perspectiva', 'The view comparable with the Environment Sheet'],
  ['pov_jugador', 'The level at the player’s camera height'],
  ['planta',      'Orthographic plan of the whole level'],
  ['detalle',     'Optional: a zone worth showing'],
] as const

export default function SubirMontajeModal({
  asset, projectId, accent, onCancel, onListo,
}: {
  asset: UnifiedAsset
  projectId: string
  accent: string
  onCancel: () => void
  onListo: (reemplazado: boolean) => void
}) {
  const [modelo, setModelo]   = useState<File | null>(null)
  const [renders, setRenders] = useState<File[]>([])
  const [subiendo, setSubiendo] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const refModelo  = useRef<HTMLInputElement>(null)
  const refRenders = useRef<HTMLInputElement>(null)

  const puede = !!modelo && renders.length > 0 && !subiendo

  const tomarModelo = (f: File | null) => {
    setError(null)
    if (!f) return
    if (!/\.glb$/i.test(f.name)) { setError('The level model must be a .glb.'); return }
    setModelo(f)
  }

  const tomarRenders = (fs: FileList | null) => {
    setError(null)
    if (!fs?.length) return
    const lista = Array.from(fs)
    const malo = lista.find(f => !/\.(png|jpe?g)$/i.test(f.name))
    if (malo) { setError(`Renders must be .png or .jpg — "${malo.name}" is not.`); return }
    if (lista.length > 4) { setError('Up to four renders.'); return }
    setRenders(lista)
  }

  async function subir() {
    if (!modelo || !renders.length) return
    setSubiendo(true); setError(null)
    try {
      const r = await subirMontajeDeNivel(projectId, asset.id, modelo, renders)
      onListo(r.reemplazado)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
      setSubiendo(false)
    }
  }

  const caja = (activo: boolean): React.CSSProperties => ({
    padding: '18px 16px', borderRadius: 10, cursor: 'pointer', textAlign: 'center',
    border: `1px dashed ${activo ? accent : 'var(--line-2, #232830)'}`,
    background: activo ? `${accent}10` : 'transparent',
  })

  return createPortal(
    <div
      data-mb-menu
      onClick={e => { e.stopPropagation(); if (!subiendo) onCancel() }}
      style={{
        position: 'fixed', inset: 0, zIndex: 12200, background: 'rgba(6,8,11,0.86)',
        display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 28,
      }}
    >
      <div onClick={e => e.stopPropagation()} style={{
        width: 'min(560px, 94vw)', maxHeight: '92vh', overflowY: 'auto', borderRadius: 14,
        background: 'var(--bg-1, #0e1116)', border: '1px solid var(--line-2, #232830)',
        boxShadow: '0 28px 90px rgba(0,0,0,0.66)',
      }}>
        <div style={{ padding: '16px 20px', borderBottom: '1px solid var(--line-2, #232830)' }}>
          <div style={{ ...mono, fontSize: 10, letterSpacing: '.14em', color: accent, textTransform: 'uppercase' }}>
            Level assembly
          </div>
          <div style={{ fontSize: 14, color: 'var(--text-0, #e8eef7)', marginTop: 4 }}>{asset.name}</div>
          <div style={{ fontSize: 11.5, color: 'var(--text-2, #8a92a3)', marginTop: 6, lineHeight: 1.5 }}>
            The assembled level comes back here: the model and its renders, together. One assembly
            per level lives on the moodboard — this replaces the previous one, which stays in the
            Asset Library.
          </div>
        </div>

        <div style={{ padding: 20, display: 'flex', flexDirection: 'column', gap: 14 }}>
          <div onClick={() => refModelo.current?.click()} style={caja(!!modelo)}>
            {modelo ? (
              <>
                <div style={{ fontSize: 12.5, color: 'var(--text-0, #e8eef7)' }}>{modelo.name}</div>
                <div style={{ ...mono, fontSize: 10.5, color: accent, marginTop: 5 }}>
                  level model · {(modelo.size / 1048576).toFixed(1)} MB
                </div>
              </>
            ) : (
              <>
                <div style={{ fontSize: 12.5, color: 'var(--text-2, #8a92a3)' }}>The level model — a .glb</div>
                <div style={{ ...mono, fontSize: 10, color: 'var(--text-3, #6b7280)', marginTop: 5 }}>
                  glTF 2.0 binary, metres, textures embedded
                </div>
              </>
            )}
            <input ref={refModelo} type="file" accept=".glb" hidden
                   onChange={e => tomarModelo(e.target.files?.[0] ?? null)} />
          </div>

          <div onClick={() => refRenders.current?.click()} style={caja(renders.length > 0)}>
            {renders.length ? (
              <>
                <div style={{ fontSize: 12.5, color: 'var(--text-0, #e8eef7)' }}>
                  {renders.length} render{renders.length === 1 ? '' : 's'}
                </div>
                <div style={{ ...mono, fontSize: 10.5, color: accent, marginTop: 5 }}>
                  {renders.map(r => r.name).join(' · ')}
                </div>
              </>
            ) : (
              <>
                <div style={{ fontSize: 12.5, color: 'var(--text-2, #8a92a3)' }}>The renders — up to four .png</div>
                <div style={{ ...mono, fontSize: 10, color: 'var(--text-3, #6b7280)', marginTop: 5 }}>
                  select them all at once
                </div>
              </>
            )}
            <input ref={refRenders} type="file" accept=".png,.jpg,.jpeg" multiple hidden
                   onChange={e => tomarRenders(e.target.files)} />
          </div>

          <div style={{ fontSize: 10.5, color: 'var(--text-3, #6b7280)', lineHeight: 1.7 }}>
            {RENDERS_ESPERADOS.map(([k, q]) => (
              <div key={k}><span style={{ ...mono, color: 'var(--text-2, #8a92a3)' }}>{k}</span> — {q}</div>
            ))}
          </div>

          {error && (
            <div style={{ ...mono, fontSize: 11, color: '#ff8080', padding: '9px 11px', borderRadius: 8,
                          background: 'rgba(255,51,51,0.08)', border: '1px solid rgba(255,51,51,0.3)' }}>
              {error}
            </div>
          )}
        </div>

        <div style={{ padding: '14px 20px', borderTop: '1px solid var(--line-2, #232830)',
                      display: 'flex', justifyContent: 'flex-end', gap: 10 }}>
          <button onClick={onCancel} disabled={subiendo} style={{
            ...mono, fontSize: 11, padding: '8px 14px', borderRadius: 7,
            border: '1px solid var(--line-2, #232830)', background: 'transparent',
            color: 'var(--text-2, #8a92a3)', cursor: subiendo ? 'default' : 'pointer',
          }}>Cancel</button>
          <button onClick={subir} disabled={!puede} style={{
            ...mono, fontSize: 11, fontWeight: 700, padding: '8px 16px', borderRadius: 7,
            background: puede ? `${accent}22` : 'transparent',
            border: `1px solid ${puede ? accent + '88' : 'var(--line-2, #232830)'}`,
            color: puede ? accent : 'var(--text-4, #50505e)',
            cursor: puede ? 'pointer' : 'default',
          }}>{subiendo ? 'Uploading…' : 'Upload the assembly'}</button>
        </div>
      </div>
    </div>,
    document.body,
  )
}
