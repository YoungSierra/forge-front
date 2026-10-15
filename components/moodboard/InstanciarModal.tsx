'use client'

import React, { useEffect, useMemo, useRef, useState } from 'react'
import { getCorridaDeInstancias, getPlanDeInstancias, instanciarHojas,
         type CorridaDeInstancias, type PlanDeInstancias } from '@/lib/api'

// Cada cuánto se pregunta cómo va. Una hoja tarda unos 35 s, así que más seguido no enseña nada.
const SONDEO_MS = 4000
// Cortes de red seguidos que se toleran antes de rendirse: el servidor sigue produciendo aunque
// el navegador pierda la conexión un momento, y lo hecho queda publicado igual.
const CORTES_TOLERADOS = 8

// Crear una hoja por ítem del alcance.
//
// El ASG dejó de ser 25 páginas fijas: la plantilla emite una hoja de cada tipo y Forge la
// instancia una vez por ítem —tres personajes, tres Character Sheets—. Lo confirmó Miguel el 15-09.
//
// Esta ventana existe por una razón concreta: **cada instancia es un despacho pago**. En el
// proyecto de SMACK el alcance pide veintiséis, tres veces lo que el deck emite hoy. Así que el
// número va arriba del todo y en grande, nada se dispara sin que se vea la lista, y se puede
// desmarcar por página o por ítem. El tope lo pone el servidor; acá se puede además pedir «solo
// las primeras N» para mirar una antes de comprometer las veintiséis.
export default function InstanciarModal({ projectId, accent, onCerrar, onListo }: {
  projectId: string
  accent: string
  onCerrar: () => void
  onListo: (r: { creados: number; fallos: number }) => void
}) {
  const [plan,  setPlan]  = useState<PlanDeInstancias | null>(null)
  const [fuera, setFuera] = useState<Set<string>>(new Set())   // «página::ítem» desmarcados
  const [limite, setLimite] = useState(0)
  const [busy,  setBusy]  = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [hecho, setHecho] = useState<{ creados: number; fallos: { pagina: string; item: { nombre: string }; motivo: string }[] } | null>(null)
  const [avance, setAvance] = useState<CorridaDeInstancias | null>(null)
  const vivoRef = useRef(true)
  // Se vuelve a poner en true al montar: en desarrollo React monta, desmonta y monta otra vez.
  useEffect(() => { vivoRef.current = true; return () => { vivoRef.current = false } }, [])

  // Antes esperaba la respuesta con la petición abierta los trece minutos que tardan veinte hojas,
  // y el 15-10 se cortó: las 21 de Migue se pagaron y publicaron, pero el recuadro dijo «Failed to
  // fetch» y el lienzo no se enteró. Ahora el servidor corre solo y acá se le pregunta.
  async function seguir(c: CorridaDeInstancias) {
    setBusy(true); setError(null); setAvance(c)
    let cortes = 0
    while (vivoRef.current) {
      if (c.estado === 'terminada') { setHecho({ creados: c.creados.length, fallos: c.fallos }); break }
      if (c.estado === 'fallida') {
        if (c.creados.length) setHecho({ creados: c.creados.length, fallos: [...c.fallos,
          { pagina: '', item: { nombre: 'the rest of the run' }, motivo: c.error || 'the run stopped' }] })
        else setError(c.error || 'the run stopped')
        break
      }
      await new Promise(r => setTimeout(r, SONDEO_MS))
      if (!vivoRef.current) break
      try {
        c = (await getCorridaDeInstancias(projectId, c.id)).corrida
        cortes = 0
        setAvance(c)
      } catch (e) {
        // Un TypeError es la red (el «Failed to fetch»): se reintenta. Lo demás es el servidor
        // diciendo algo —la corrida ya no existe— y se enseña tal cual.
        if (e instanceof TypeError && ++cortes <= CORTES_TOLERADOS) continue
        setError(e instanceof TypeError
          ? 'Lost contact with the server. The run keeps going there and every finished sheet is published — reopen this window in a few minutes to see where it is.'
          : e instanceof Error ? e.message : 'could not read the run')
        break
      }
    }
    if (vivoRef.current) setBusy(false)
  }

  useEffect(() => {
    let vivo = true
    getPlanDeInstancias(projectId)
      .then(r => {
        if (!vivo) return
        setPlan(r)
        // Lo que YA tiene su hoja entra DESMARCADO. Marcándolo, el número grande de arriba decía
        // 33 cuando solo se iban a pagar 14 —el motor se salta lo hecho al despachar, pero la
        // ventana no lo decía— y nadie se atreve a pulsar un botón que promete cobrar el doble de
        // lo que cobra. Tras una corrida cortada, esto es justo lo que la convierte en «continuar».
        const hechas = new Set<string>()
        for (const p of r.paginas || []) for (const i of p.items || []) {
          if (i.hecha) hechas.add(`${p.pagina}::${i.nombre}`)
        }
        if (hechas.size) setFuera(hechas)
        // Ya hay una corrida en marcha (otra pestaña, o se recargó la página): se sigue esa.
        if (r.corrida) seguir(r.corrida)
      })
      .catch(e => vivo && setError(e instanceof Error ? e.message : 'could not read the scope'))
    return () => { vivo = false }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- se lee el plan una vez por proyecto
  }, [projectId])

  const clave = (pagina: string, item: string) => `${pagina}::${item}`

  const elegidas = useMemo(() => (plan?.paginas || [])
    .map(p => ({ ...p, items: p.items.filter(i => !fuera.has(clave(p.pagina, i.nombre))) }))
    .filter(p => p.items.length), [plan, fuera])

  const total = elegidas.reduce((n, p) => n + p.items.length, 0)
  const aDespachar = limite > 0 ? Math.min(limite, total) : total

  const alternar = (pagina: string, item: string) => setFuera(s => {
    const n = new Set(s); const k = clave(pagina, item)
    if (n.has(k)) n.delete(k); else n.add(k)
    return n
  })

  const alternarPagina = (p: PlanDeInstancias['paginas'][number]) => setFuera(s => {
    const n = new Set(s)
    const todosFuera = p.items.every(i => n.has(clave(p.pagina, i.nombre)))
    for (const i of p.items) {
      if (todosFuera) n.delete(clave(p.pagina, i.nombre))
      else n.add(clave(p.pagina, i.nombre))
    }
    return n
  })

  async function correr() {
    setBusy(true); setError(null)
    let c: CorridaDeInstancias
    try {
      c = (await instanciarHojas(projectId, elegidas, limite)).corrida
    } catch (e) {
      setError(e instanceof Error ? e.message : 'the run failed')
      setBusy(false)
      return
    }
    await seguir(c)
  }

  return (
    <div
      onClick={() => !busy && onCerrar()}
      style={{
        position: 'fixed', inset: 0, zIndex: 12200, display: 'flex',
        alignItems: 'center', justifyContent: 'center',
        background: 'rgba(6,7,9,0.5)', backdropFilter: 'blur(3px)',
      }}
    >
      <div onClick={e => e.stopPropagation()} style={{
        width: 560, maxHeight: '84vh', overflowY: 'auto', padding: '22px 24px', borderRadius: 13,
        background: 'var(--bg-3)', border: '1px solid var(--line-2)',
        boxShadow: '0 22px 64px rgba(0,0,0,0.6)', animation: 'mb-in 180ms ease',
      }}>
        <div style={{
          fontSize: 10, fontFamily: 'var(--font-mono)', letterSpacing: '.08em',
          color: accent, marginBottom: 10,
        }}>SHEETS THE SCOPE ASKS FOR</div>

        {hecho ? (
          <>
            <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--text-0)', marginBottom: 10 }}>
              {hecho.creados} sheet{hecho.creados === 1 ? '' : 's'} created
            </div>
            {!!hecho.fallos.length && (
              <>
                <div style={{ fontSize: 12, color: 'var(--text-2)', marginBottom: 6 }}>
                  {hecho.fallos.length} did not come out. What was produced is published and paid for; these can be run again:
                </div>
                <ul style={{ margin: '0 0 12px', paddingLeft: 16, fontSize: 11, color: 'var(--text-3)', lineHeight: 1.6 }}>
                  {hecho.fallos.map((f, i) => <li key={i}>{f.item.nombre} — {f.motivo}</li>)}
                </ul>
              </>
            )}
            <button onClick={() => onListo({ creados: hecho.creados, fallos: hecho.fallos.length })} style={{
              width: '100%', padding: '9px 0', borderRadius: 8, cursor: 'pointer',
              background: 'transparent', border: `1px solid ${accent}66`, color: accent,
              fontSize: 12, fontFamily: 'var(--font-sans)',
            }}>Done</button>
          </>
        ) : !plan ? (
          <div style={{ fontSize: 12, color: 'var(--text-3)' }}>{error || 'Reading the scope…'}</div>
        ) : !plan.hay ? (
          <>
            <div style={{ fontSize: 13, color: 'var(--text-1)', lineHeight: 1.6, marginBottom: 16 }}>
              {plan.motivo || 'This project has no Vertical Slice Specification yet, so there is nothing to count from.'}
            </div>
            <button onClick={onCerrar} style={{
              width: '100%', padding: '9px 0', borderRadius: 8, cursor: 'pointer',
              background: 'transparent', border: `1px solid ${accent}66`, color: accent,
              fontSize: 12, fontFamily: 'var(--font-sans)',
            }}>Got it</button>
          </>
        ) : (
          <>
            <div style={{ display: 'flex', alignItems: 'baseline', gap: 9, marginBottom: 4 }}>
              <span style={{ fontSize: 26, fontWeight: 600, color: 'var(--text-0)', fontFamily: 'var(--font-mono)' }}>
                {aDespachar}
              </span>
              <span style={{ fontSize: 12.5, color: 'var(--text-2)' }}>
                paid run{aDespachar === 1 ? '' : 's'}, one per sheet
              </span>
            </div>
            <div style={{ fontSize: 11.5, color: 'var(--text-3)', lineHeight: 1.6, marginBottom: 14 }}>
              {/* De dónde salió la cuenta. Desde la v2.9.35 la fuente correcta es el manifiesto de
                  instancias del nodo 3.20 —un mapa declarado—; la prosa del VS Spec queda de
                  respaldo para los proyectos que no lo hayan producido todavía. Es un número que
                  se paga: tiene que decir quién lo dijo. */}
              {plan.fuente === 'manifest'
                ? 'Read from the sheet instance manifest of node 3.20.'
                : 'Counted from this project\u2019s Vertical Slice Specification.'}{' '}
              Untick anything you do not want produced now — what you leave out stays available later.
            </div>

            {/* Lo que el manifiesto no puede garantizar: páginas que todavía no tienen su propia
                spec, instancias fuera del slice, o una cuenta declarada que no coincide con su
                lista —que su propia especificación llama conformance failure—. Callarlo haría
                pagar despachos creyendo que la lista está completa. */}
            {!!plan.avisos?.length && (
              <ul style={{ margin: '0 0 14px', paddingLeft: 16, fontSize: 11, color: 'var(--text-3)', lineHeight: 1.7 }}>
                {plan.avisos.map((a, i) => <li key={i}>{a}</li>)}
              </ul>
            )}

            {plan.paginas.map(p => {
              const dentro = p.items.filter(i => !fuera.has(clave(p.pagina, i.nombre))).length
              return (
                <div key={p.pagina} style={{ marginBottom: 10, border: '1px solid var(--line-2)', borderRadius: 9 }}>
                  <button onClick={() => alternarPagina(p)} style={{
                    display: 'flex', width: '100%', alignItems: 'center', gap: 8, padding: '7px 11px',
                    background: 'transparent', border: 'none', cursor: 'pointer',
                    color: 'var(--text-1)', fontSize: 12, fontFamily: 'var(--font-sans)', textAlign: 'left',
                  }}>
                    <span style={{ flex: 1 }}>{p.pagina.replace(/^\d+_/, '')}</span>
                    <span style={{ fontSize: 10, fontFamily: 'var(--font-mono)', color: dentro ? accent : 'var(--text-4)' }}>
                      {dentro}/{p.items.length}
                    </span>
                  </button>
                  <div style={{ padding: '0 11px 8px' }}>
                    {p.items.map(i => {
                      const marcado = !fuera.has(clave(p.pagina, i.nombre))
                      return (
                        <div key={i.nombre} onClick={() => alternar(p.pagina, i.nombre)} style={{
                          display: 'flex', alignItems: 'baseline', gap: 7, padding: '3px 0', cursor: 'pointer',
                        }}>
                          <span style={{ fontSize: 10, width: 11, color: marcado ? accent : 'var(--text-4)' }}>
                            {marcado ? '●' : '○'}
                          </span>
                          <span style={{
                            flex: 1, fontSize: 11.5,
                            color: marcado ? 'var(--text-1)' : 'var(--text-4)',
                            textDecoration: marcado ? 'none' : 'line-through',
                          }}>{i.nombre}</span>
                          <span style={{ fontSize: 9, fontFamily: 'var(--font-mono)', color: 'var(--text-4)' }}>{i.de}</span>
                        </div>
                      )
                    })}
                  </div>
                </div>
              )
            })}

            {/* Lo que el alcance nombra y no es una lámina, y lo que no se supo clasificar. Se
                enseña en vez de callarse: si algo falta en la lista de arriba, acá está el porqué. */}
            {!!plan.sin_clasificar?.length && (
              <div style={{ fontSize: 10.5, color: 'var(--text-3)', lineHeight: 1.6, marginTop: 6 }}>
                Not placed in any sheet: {plan.sin_clasificar.map(x => x.nombre).join(' · ')}
              </div>
            )}
            {!!plan.no_son_laminas?.length && (
              <div style={{ fontSize: 10.5, color: 'var(--text-4)', lineHeight: 1.6, marginTop: 4 }}>
                Not art sheets, left out on purpose: {plan.no_son_laminas.length} entries (scenes, systems, render profiles)
              </div>
            )}

            <div style={{ display: 'flex', alignItems: 'center', gap: 8, margin: '14px 0 4px' }}>
              <span style={{ fontSize: 11.5, color: 'var(--text-2)' }}>Only the first</span>
              <input type="number" min={0} max={total} value={limite || ''}
                     onChange={e => setLimite(Math.max(0, Number(e.target.value) || 0))}
                     placeholder="all"
                     style={{
                       width: 62, padding: '4px 7px', borderRadius: 7, textAlign: 'center',
                       background: 'var(--bg-2)', border: '1px solid var(--line-2)',
                       color: 'var(--text-0)', fontSize: 11.5, fontFamily: 'var(--font-mono)',
                     }} />
              <span style={{ fontSize: 11.5, color: 'var(--text-3)' }}>— to look at one before committing the rest</span>
            </div>

            {busy && avance && (
              <div style={{ fontSize: 11.5, color: 'var(--text-2)', lineHeight: 1.6, marginTop: 10 }}>
                {avance.ya_en_curso && <div style={{ color: 'var(--text-3)' }}>A run was already going in this project — following it instead of starting another.</div>}
                <div>
                  <span style={{ fontFamily: 'var(--font-mono)', color: accent }}>{avance.hechas}/{avance.total || '…'}</span>
                  {avance.actual ? ` — now ${avance.actual.replace(/^\d+_/, '')}` : ''}
                </div>
                <div style={{ fontSize: 10.5, color: 'var(--text-4)' }}>
                  Each finished sheet is published as it comes out. Closing this window does not stop the run.
                </div>
              </div>
            )}
            {error && <div style={{ fontSize: 11.5, color: '#e8736a', lineHeight: 1.6, marginTop: 10 }}>{error}</div>}

            <div style={{ display: 'flex', gap: 8, marginTop: 16 }}>
              {/* Con la corrida en marcha, cerrar no la para —sigue en el servidor—: se cierra y se
                  recarga el lienzo para que se vea lo que ya salió. */}
              <button onClick={busy && avance
                ? () => onListo({ creados: avance.creados.length, fallos: avance.fallos.length })
                : onCerrar} disabled={busy && !avance} style={{
                flex: 1, padding: '9px 0', borderRadius: 8, cursor: busy && !avance ? 'default' : 'pointer',
                background: 'transparent', border: '1px solid var(--line-2)', color: 'var(--text-2)',
                fontSize: 12, fontFamily: 'var(--font-sans)',
              }}>{busy && avance ? 'Close' : 'Cancel'}</button>
              <button onClick={correr} disabled={busy || !aDespachar} style={{
                flex: 2, padding: '9px 0', borderRadius: 8,
                cursor: busy || !aDespachar ? 'default' : 'pointer',
                background: busy || !aDespachar ? 'var(--bg-2)' : accent,
                border: 'none', color: busy || !aDespachar ? 'var(--text-3)' : '#0b0c0e',
                fontSize: 12, fontWeight: 600, fontFamily: 'var(--font-sans)',
              }}>{busy ? `Producing ${avance?.total || aDespachar}…` : `Produce ${aDespachar} sheet${aDespachar === 1 ? '' : 's'}`}</button>
            </div>
          </>
        )}
      </div>
    </div>
  )
}
