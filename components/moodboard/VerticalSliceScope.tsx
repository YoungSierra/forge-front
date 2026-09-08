'use client'

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  ALCANCE_VS, calcularGuia, claveDe, esProducible, estadoDe, progresoCategoria, progresoGlobal,
  type CategoriaAlcance, type EstadoElemento, type Estados,
} from './vs-scope'

// Panel flotante «Alcance del Vertical Slice».
//
// Muestra por categorías todo lo que hay que producir para cerrar el slice, y responde una sola
// pregunta: ¿por dónde sigo? Vive sobre el lienzo del moodboard, se arrastra por la cabecera y se
// pliega a su mínimo para no tapar el trabajo.
//
// Lo que este componente NO hace, a propósito: mover un estado por su cuenta. Los estados los
// alimenta Forge desde eventos reales de producción; mientras ese cableado no exista, el panel los
// recibe y los devuelve por `onEstados`, y quien lo monte decide de dónde salen. Un panel que
// avanza solo con clics enseña un progreso que nadie produjo.

type Props = {
  /** Estado de cada elemento, por `categoria.elemento`. */
  estados:    Estados
  /** Devuelve el estado cambiado. Sin este callback el panel es de solo lectura. */
  onEstados?: (e: Estados) => void
  /** La página del ASG señalada en el lienzo, para que menú y lienzo se sigan mutuamente. */
  paginaActiva?: string | null
  onPagina?:  (pagina: string | null) => void
  onCerrar?:  () => void
  /** Color de identidad del proyecto; el moodboard ya lo resuelve desde el 3.9. */
  accent?:    string
}

const SIGUIENTE: Record<EstadoElemento, EstadoElemento> = {
  pendiente: 'en_progreso', en_progreso: 'aprobado', aprobado: 'pendiente',
}

const COLOR: Record<EstadoElemento, string> = {
  pendiente: 'var(--text-4)', en_progreso: '#4a9eff', aprobado: '#3fb950',
}

const MARCA: Record<EstadoElemento, string> = { pendiente: '○', en_progreso: '●', aprobado: '✓' }

const pct = (n: number) => Math.round(n * 100)

// ── Anillo de progreso ───────────────────────────────────────────────────────
function Anillo ({ valor, accent }: { valor: number; accent: string }) {
  const r = 15, c = 2 * Math.PI * r
  return (
    <svg width="38" height="38" viewBox="0 0 38 38" style={{ flexShrink: 0 }} aria-hidden>
      <circle cx="19" cy="19" r={r} fill="none" stroke="var(--line-2)" strokeWidth="3" />
      <circle
        cx="19" cy="19" r={r} fill="none" stroke={accent} strokeWidth="3" strokeLinecap="round"
        strokeDasharray={`${c * valor} ${c}`} transform="rotate(-90 19 19)"
        style={{ transition: 'stroke-dasharray .35s ease' }}
      />
      <text
        x="19" y="19" textAnchor="middle" dominantBaseline="central"
        style={{ fontFamily: 'var(--font-mono)', fontSize: 10, fill: 'var(--text-1)' }}
      >{pct(valor)}</text>
    </svg>
  )
}

// ── Barra de una categoría ───────────────────────────────────────────────────
function Barra ({ valor, accent }: { valor: number; accent: string }) {
  return (
    <div style={{ height: 3, borderRadius: 2, background: 'var(--line-2)', overflow: 'hidden' }}>
      <div style={{
        width: `${pct(valor)}%`, height: '100%',
        background: valor >= 1 ? '#3fb950' : accent,
        transition: 'width .3s ease, background .3s ease',
      }} />
    </div>
  )
}

export default function VerticalSliceScope ({
  estados, onEstados, paginaActiva, onPagina, onCerrar, accent = '#7d8493',
}: Props) {
  const [abiertas,  setAbiertas]  = useState<Set<string>>(() => new Set())
  const [minimos,   setMinimos]   = useState(false)
  const [plegado,   setPlegado]   = useState(false)
  const [pos,       setPos]       = useState({ x: 24, y: 24 })
  const arrastre = useRef<{ dx: number; dy: number } | null>(null)

  const guia    = useMemo(() => calcularGuia(estados), [estados])
  const global  = useMemo(() => progresoGlobal(estados), [estados])

  // El lienzo manda: señalar una hoja allá abre su sección acá. Es la mitad que hace que los dos
  // se sigan; sin esto el vínculo sería de ida y el usuario tendría que buscar a mano.
  useEffect(() => {
    if (!paginaActiva) return
    const cat = ALCANCE_VS.find(c => c.pagina === paginaActiva)
    if (cat) setAbiertas(prev => new Set(prev).add(cat.id))
  }, [paginaActiva])

  const alternar = useCallback((id: string) => {
    setAbiertas(prev => {
      const s = new Set(prev)
      if (s.has(id)) s.delete(id); else s.add(id)
      return s
    })
  }, [])

  const señalar = useCallback((cat: CategoriaAlcance) => {
    setAbiertas(prev => new Set(prev).add(cat.id))
    onPagina?.(cat.pagina)
  }, [onPagina])

  const avanzar = useCallback((catId: string, elemId: string) => {
    if (!onEstados) return
    const k = claveDe(catId, elemId)
    onEstados({ ...estados, [k]: SIGUIENTE[estados[k] ?? 'pendiente'] })
  }, [estados, onEstados])

  // Arrastre por la cabecera. Los listeners van en `window` y no en el panel: soltando el botón
  // fuera de él —que pasa siempre que uno se apura— el panel se quedaba pegado al cursor.
  useEffect(() => {
    if (!arrastre.current) return
    const mover = (e: MouseEvent) => {
      if (!arrastre.current) return
      setPos({ x: e.clientX - arrastre.current.dx, y: e.clientY - arrastre.current.dy })
    }
    const soltar = () => { arrastre.current = null }
    window.addEventListener('mousemove', mover)
    window.addEventListener('mouseup', soltar)
    return () => {
      window.removeEventListener('mousemove', mover)
      window.removeEventListener('mouseup', soltar)
    }
  })

  const asg = ALCANCE_VS.filter(c => c.grupo === 'asg').sort((a, b) => a.orden - b.orden)
  const gdd = ALCANCE_VS.filter(c => c.grupo === 'gdd').sort((a, b) => a.orden - b.orden)

  return (
    <div
      style={{
        position: 'absolute', left: pos.x, top: pos.y, zIndex: 40,
        width: 320, maxHeight: 'calc(100% - 48px)', display: 'flex', flexDirection: 'column',
        background: 'var(--bg-2)', border: '1px solid var(--line-2)', borderRadius: 10,
        boxShadow: '0 8px 28px rgba(0,0,0,.35)', fontFamily: 'var(--font-sans)',
      }}
    >
      {/* ── Cabecera: se arrastra por acá ── */}
      <div
        onMouseDown={e => { arrastre.current = { dx: e.clientX - pos.x, dy: e.clientY - pos.y } }}
        style={{
          display: 'flex', alignItems: 'center', gap: 10, padding: '10px 12px',
          borderBottom: '1px solid var(--line-2)', cursor: 'grab', userSelect: 'none',
        }}
      >
        <Anillo valor={global} accent={accent} />
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 12.5, fontWeight: 600, color: 'var(--text-0)' }}>Vertical Slice</div>
          <div style={{ fontSize: 10, color: 'var(--text-3)' }}>Alcance de producción</div>
        </div>
        <button
          onClick={() => setPlegado(p => !p)}
          title={plegado ? 'Desplegar' : 'Plegar'}
          style={botonIcono}
        >{plegado ? '▢' : '—'}</button>
        {onCerrar && <button onClick={onCerrar} title="Cerrar" style={botonIcono}>✕</button>}
      </div>

      {/* ── Franja «Continúa por aquí» ── */}
      {guia && (
        <button
          onClick={() => señalar(guia.categoria)}
          style={{
            textAlign: 'left', padding: '9px 12px', border: 'none', cursor: 'pointer',
            borderBottom: plegado ? 'none' : '1px solid var(--line-2)',
            background: 'var(--bg-3)', color: 'var(--text-1)', fontFamily: 'inherit',
          }}
        >
          <div style={{ fontSize: 9.5, letterSpacing: .5, color: 'var(--text-3)', textTransform: 'uppercase' }}>
            Continúa por aquí
          </div>
          <div style={{ fontSize: 12, fontWeight: 600, marginTop: 2, color: accent }}>
            {guia.categoria.nombre}
            {guia.categoria.grupo === 'gdd' && (
              <span style={{ fontWeight: 400, color: 'var(--text-3)', fontSize: 10 }}> · vive en el GDD</span>
            )}
          </div>
          {guia.falta.length > 0 && (
            <div style={{ fontSize: 10.5, color: 'var(--text-2)', marginTop: 3 }}>
              Falta: {guia.falta.map(e => e.nombre).join(' · ')}
            </div>
          )}
          {guia.alternativas.length > 0 && (
            <div style={{ fontSize: 10, color: 'var(--text-3)', marginTop: 4 }}>
              También:{' '}
              {guia.alternativas.map(c => (
                <span
                  key={c.id}
                  onClick={ev => { ev.stopPropagation(); señalar(c) }}
                  style={{
                    display: 'inline-block', margin: '0 4px 2px 0', padding: '1px 6px',
                    borderRadius: 9, border: '1px solid var(--line-2)', cursor: 'pointer',
                  }}
                >{c.nombre}</span>
              ))}
            </div>
          )}
          {/* Lo que no se puede producir se NOMBRA. La guía las salta para no mandar a nadie a una
              hoja sin Run, pero callarlas las volvería invisibles y nadie las destrabaría. */}
          {guia.bloqueadas.length > 0 && (
            <div style={{ fontSize: 9.5, color: 'var(--text-3)', marginTop: 5, fontStyle: 'italic' }}>
              Sin cadena de producción todavía: {guia.bloqueadas.map(c => c.nombre).join(', ')}
            </div>
          )}
        </button>
      )}
      {!guia && !plegado && (
        <div style={{ padding: '10px 12px', fontSize: 11.5, color: '#3fb950', borderBottom: '1px solid var(--line-2)' }}>
          Alcance completo — listo para la ola de validación con jugadores.
        </div>
      )}

      {!plegado && (
        <>
          {/* ── Lista de categorías ── */}
          <div style={{ overflowY: 'auto', flex: 1, padding: '6px 0' }}>
            {[['Art Style Guide · páginas', asg], ['Diseño · GDD', gdd]].map(([titulo, cats]) => (
              <div key={titulo as string}>
                <div style={{
                  padding: '6px 12px 3px', fontSize: 9, letterSpacing: .6, textTransform: 'uppercase',
                  color: 'var(--text-4)',
                }}>{titulo as string}</div>
                {(cats as CategoriaAlcance[]).map(cat => {
                  const p = progresoCategoria(cat, estados)
                  const aprobados = cat.elementos.filter(e => estadoDe(estados, cat.id, e.id) === 'aprobado').length
                  const abierta = abiertas.has(cat.id)
                  const señalada = !!cat.pagina && cat.pagina === paginaActiva
                  return (
                    <div key={cat.id} style={{
                      margin: '0 8px 4px', borderRadius: 6,
                      border: `1px solid ${señalada ? accent : 'transparent'}`,
                      background: señalada ? 'var(--bg-3)' : 'transparent',
                    }}>
                      <button
                        onClick={() => { alternar(cat.id); if (cat.pagina) onPagina?.(cat.pagina) }}
                        style={{
                          width: '100%', textAlign: 'left', background: 'none', border: 'none',
                          padding: '6px 8px', cursor: 'pointer', color: 'var(--text-1)', fontFamily: 'inherit',
                        }}
                      >
                        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                          <span style={{ fontSize: 8, color: 'var(--text-4)' }}>{abierta ? '▼' : '▶'}</span>
                          <span style={{ flex: 1, fontSize: 11.5 }}>{cat.nombre}</span>
                          {!esProducible(cat) && (
                            <span title="Todavía no tiene cadena de producción"
                              style={{ fontSize: 9, color: 'var(--text-4)' }}>sin cadena</span>
                          )}
                          <span style={{ fontSize: 9.5, fontFamily: 'var(--font-mono)', color: 'var(--text-3)' }}>
                            {aprobados}/{cat.elementos.length}
                          </span>
                        </div>
                        <div style={{ marginTop: 5 }}><Barra valor={p} accent={accent} /></div>
                      </button>

                      {abierta && (
                        <div style={{ padding: '2px 8px 8px 22px' }}>
                          {cat.elementos.map(el => {
                            const est = estadoDe(estados, cat.id, el.id)
                            return (
                              <div key={el.id} style={{ padding: '4px 0' }}>
                                <div
                                  onClick={() => avanzar(cat.id, el.id)}
                                  style={{
                                    display: 'flex', gap: 6, alignItems: 'baseline',
                                    cursor: onEstados ? 'pointer' : 'default',
                                  }}
                                >
                                  <span style={{ color: COLOR[est], fontSize: 10, width: 10 }}>{MARCA[est]}</span>
                                  <span style={{ flex: 1, fontSize: 11, color: 'var(--text-1)' }}>{el.nombre}</span>
                                </div>
                                <div style={{ fontSize: 9.5, color: 'var(--text-3)', marginLeft: 16 }}>{el.regla}</div>
                                {minimos && (
                                  <div style={{
                                    fontSize: 9.5, color: 'var(--text-2)', marginLeft: 16, marginTop: 2,
                                    paddingLeft: 6, borderLeft: '2px solid var(--line-2)',
                                  }}>{el.minimo}</div>
                                )}
                              </div>
                            )
                          })}
                        </div>
                      )}
                    </div>
                  )
                })}
              </div>
            ))}
          </div>

          {/* ── Pie ── */}
          <div style={{
            display: 'flex', alignItems: 'center', gap: 8, padding: '7px 12px',
            borderTop: '1px solid var(--line-2)', fontSize: 9.5, color: 'var(--text-3)',
          }}>
            <span style={{ color: COLOR.pendiente }}>○</span><span>pendiente</span>
            <span style={{ color: COLOR.en_progreso }}>●</span><span>en progreso</span>
            <span style={{ color: COLOR.aprobado }}>✓</span><span>aprobado</span>
            <button onClick={() => setMinimos(m => !m)} style={{ ...botonIcono, marginLeft: 'auto', fontSize: 9.5, width: 'auto', padding: '2px 6px' }}>
              {minimos ? 'Ocultar mínimos' : 'Mostrar mínimos'}
            </button>
          </div>
        </>
      )}
    </div>
  )
}

const botonIcono: React.CSSProperties = {
  width: 22, height: 22, borderRadius: 5, border: '1px solid var(--line-2)',
  background: 'transparent', color: 'var(--text-3)', cursor: 'pointer',
  fontSize: 11, lineHeight: 1, fontFamily: 'inherit', flexShrink: 0,
}
