'use client'

import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { getEdit3D, runEdit3D, type Herramienta3D } from '@/lib/api'

// ─── Edit 3D: una herramienta de Tripo sobre un modelo ───────────────────────
//
// Pedido de Miguel León (W43 #7): las herramientas de la web de Tripo en el sector «Edit 3D» del
// radial —Segment, Retopo, Smart UV, Texture, Rig—, cada una con sus opciones. El resultado es un
// modelo NUEVO a la derecha del que se editó; el original no se toca.
//
// Las opciones no se escriben acá: el backend las descubre de ComfyUI para cada herramienta, igual
// que las de generación. Este recuadro solo las dibuja y manda las que el usuario cambió.

const mono: React.CSSProperties = { fontFamily: 'var(--font-mono)' }
const campoCss: React.CSSProperties = {
  width: 200, padding: '5px 8px', borderRadius: 6,
  background: 'var(--bg-3, #161a20)', border: '1px solid var(--line-2, #232830)',
  color: 'var(--text-0, #e8eef7)', fontSize: 11.5,
}

export default function Edit3DModal({
  asset, projectId, clave, accent, memberId, onCancel, onListo,
}: {
  asset: { id: string; name: string }
  projectId: string
  clave: string
  accent: string
  memberId?: string | null
  onCancel: () => void
  onListo: (ids: string[]) => void
}) {
  const [h,        setH]        = useState<Herramienta3D | null | undefined>(undefined)
  const [partes,   setPartes]   = useState<string[]>([])
  const [elegidas, setElegidas] = useState<Record<string, unknown>>({})
  const [corriendo, setCorriendo] = useState(false)
  const [error,    setError]    = useState<string | null>(null)

  useEffect(() => {
    let vivo = true
    getEdit3D(projectId, asset.id)
      .then(r => { if (!vivo) return; setH(r.herramientas.find(x => x.clave === clave) ?? null); setPartes(r.partes || []) })
      .catch(e => { if (vivo) { setH(null); setError(e instanceof Error ? e.message : String(e)) } })
    return () => { vivo = false }
  }, [projectId, asset.id, clave])

  useEffect(() => {
    const k = (e: KeyboardEvent) => { if (e.key === 'Escape' && !corriendo) { e.stopPropagation(); onCancel() } }
    window.addEventListener('keydown', k, true)
    return () => window.removeEventListener('keydown', k, true)
  }, [onCancel, corriendo])

  const ops = h?.opciones ?? []
  // Solo lo que el usuario cambió: el resto corre con lo que trae el grafo.
  const cambiadas = Object.fromEntries(Object.entries(elegidas).filter(([k, v]) => {
    const def = ops.find(o => o.clave === k)
    return def && JSON.stringify(v) !== JSON.stringify(def.valor)
  }))
  // Texture sin prompt no corre: sobre un modelo importado Tripo no acepta imagen de referencia.
  const faltaPrompt = clave === 'texture' && !String(elegidas.texture_prompt ?? '').trim()

  async function correr() {
    setError(null)
    setCorriendo(true)
    try {
      const r = await runEdit3D(projectId, asset.id, clave, Object.keys(cambiadas).length ? cambiadas : null, memberId)
      onListo((r.creados || []).map(c => c.id))
    } catch (e) {
      // No se reintenta solo: cada corrida de Tripo se paga.
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
          width: 'min(560px, 94vw)', maxHeight: '92vh', overflowY: 'auto',
          background: 'var(--bg-1, #0e1116)', border: '1px solid var(--line-2, #232830)',
          borderRadius: 14, boxShadow: '0 28px 90px rgba(0,0,0,0.66)',
        }}
      >
        <div style={{ padding: '16px 20px', borderBottom: '1px solid var(--line-2, #232830)' }}>
          <div style={{ ...mono, fontSize: 10, letterSpacing: '.14em', color: accent, textTransform: 'uppercase' }}>
            Edit 3D · {h?.etiqueta ?? clave}
          </div>
          <div style={{ fontSize: 14, color: 'var(--text-0, #e8eef7)', marginTop: 4 }}>{asset.name}</div>
          <div style={{ fontSize: 11.5, color: 'var(--text-2, #8a92a3)', marginTop: 6, lineHeight: 1.5 }}>
            {h?.ayuda ?? 'Reading the tool options…'} The result is a new model to the right; this one is left untouched.
          </div>
        </div>

        <div style={{ padding: 20, display: 'flex', flexDirection: 'column', gap: 12 }}>
          {h === undefined && <div style={{ ...mono, fontSize: 12, color: 'var(--text-2, #8a92a3)' }}>Loading…</div>}
          {h === null && !error && <div style={{ fontSize: 12, color: 'var(--text-2, #8a92a3)' }}>This tool does not apply to this piece.</div>}

          {ops.map(o => {
            const valor = elegidas[o.clave] ?? o.valor
            const set = (v: unknown) => setElegidas(prev => ({ ...prev, [o.clave]: v }))
            const hoja = o.clave.split('.').pop() || o.clave
            const largo = hoja === 'texture_prompt' || hoja === 'hint'
            return (
              <div key={o.clave} style={{ display: 'flex', flexDirection: largo ? 'column' : 'row', alignItems: largo ? 'stretch' : 'center', gap: largo ? 6 : 10 }}>
                <label title={o.ayuda ?? undefined} style={{ flex: 1, fontSize: 11.5, color: 'var(--text-2, #8a92a3)', textTransform: 'capitalize', cursor: o.ayuda ? 'help' : 'default' }}>
                  {o.etiqueta}{hoja === 'texture_prompt' && <span style={{ color: accent }}> *</span>}
                </label>
                {o.tipo === 'BOOLEAN' ? (
                  <input type="checkbox" checked={!!valor} disabled={corriendo} onChange={e => set(e.target.checked)}
                         style={{ width: 15, height: 15, accentColor: accent, cursor: 'pointer' }} />
                ) : o.valores ? (
                  <select value={String(valor)} disabled={corriendo} onChange={e => set(e.target.value)} style={{ ...campoCss, cursor: 'pointer' }}>
                    {o.valores.map(v => <option key={v} value={v}>{v}{(o.sube_costo ?? []).includes(v) ? '  ·  costs more' : ''}</option>)}
                  </select>
                ) : o.tipo === 'STRING' ? (
                  largo
                    ? <textarea value={String(valor ?? '')} disabled={corriendo} rows={3} onChange={e => set(e.target.value)}
                                placeholder={hoja === 'texture_prompt' ? 'Materials, colors, wear… The concept art goes along as the style image.' : 'Optional: name the parts to look for'}
                                style={{ ...campoCss, width: '100%', resize: 'vertical', fontFamily: 'var(--font-sans)' }} />
                    : <input type="text" value={String(valor ?? '')} disabled={corriendo} onChange={e => set(e.target.value)}
                             placeholder={hoja === 'part_names' ? (partes.length ? partes.join(', ') : 'empty = whole model') : ''}
                             style={campoCss} />
                ) : (
                  <input type="number" value={Number(valor)} disabled={corriendo} onChange={e => set(Number(e.target.value))} style={campoCss} />
                )}
              </div>
            )
          })}

          {partes.length > 0 && ops.some(o => o.clave.endsWith('part_names')) && (
            <div style={{ fontSize: 10.5, color: 'var(--text-3, #6b7280)', lineHeight: 1.5 }}>
              Parts of this model: {partes.join(', ')}. Leave part names empty to work on the whole model.
            </div>
          )}

          {error && (
            <div style={{ padding: '10px 12px', borderRadius: 8, fontSize: 12,
                          background: 'rgba(255,51,51,0.08)', border: '1px solid rgba(255,51,51,0.3)', color: '#ff8080' }}>
              {error}
            </div>
          )}
        </div>

        <div style={{ padding: '14px 20px', borderTop: '1px solid var(--line-2, #232830)', display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: 10 }}>
          {corriendo && <span style={{ ...mono, fontSize: 10.5, color: 'var(--text-3, #6b7280)', marginRight: 'auto' }}>Tripo takes 1–3 minutes</span>}
          <button onClick={onCancel} disabled={corriendo}
                  style={{ ...mono, fontSize: 11, padding: '8px 14px', borderRadius: 7, border: '1px solid var(--line-2, #232830)',
                           background: 'transparent', color: 'var(--text-2, #8a92a3)', cursor: corriendo ? 'not-allowed' : 'pointer' }}>
            CANCEL
          </button>
          <button onClick={correr} disabled={corriendo || !h || faltaPrompt}
                  title={faltaPrompt ? 'Write a texture prompt first' : undefined}
                  style={{ ...mono, fontSize: 11, padding: '8px 18px', borderRadius: 7, border: `1px solid ${accent}`,
                           background: `${accent}22`, color: accent,
                           cursor: corriendo || !h || faltaPrompt ? 'not-allowed' : 'pointer',
                           opacity: corriendo || !h || faltaPrompt ? 0.6 : 1 }}>
            {corriendo ? 'GENERATING…' : 'GENERATE'}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  )
}
