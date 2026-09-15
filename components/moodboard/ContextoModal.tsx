'use client'

import React, { useEffect, useMemo, useState } from 'react'
import {
  destinoDeContexto, guardarContexto, uploadLibraryAsset,
  type DestinoDeContexto, type UnifiedAsset,
} from '@/lib/api'

// «Agregar contexto» — la ventana de cuatro pasos del handoff de Miguel (§2).
//
// Subir una referencia no es adjuntarla: es decidir a qué página entra, con qué estado y bajo qué
// sección del ADI queda anclada. Esas reglas viven en el backend a propósito —igual que las
// herramientas— porque si vivieran acá bastaría abrir el menú desde otro visor para saltárselas.
// Esta ventana solo pregunta, enseña lo que el servidor resolvió, y deja confirmar.
//
// Tres decisiones de forma:
//   · El destino NUNCA se aplica solo. Se propone uno y se muestran las alternativas, porque la
//     spec lo pide y porque una referencia puesta en la página equivocada se descubre tarde.
//   · Los avisos del servidor se enseñan enteros. El más importante —«esta página no tiene hueco
//     REF_* todavía»— es la diferencia entre inyectar de verdad e influir por el ADI.
//   · Sin archivo y sin texto no hay paso 2: no hay nada que enrutar.

type Paso = 1 | 2 | 3 | 4

const ROLES: { clave: string; etiqueta: string; ayuda: string }[] = [
  { clave: 'referencia_aprobada',     etiqueta: 'Approved style reference', ayuda: 'The model should follow it while generating.' },
  { clave: 'ejemplo_a_evitar',        etiqueta: 'Example to avoid',         ayuda: 'Never reaches the model: it is a curatorial filter.' },
  { clave: 'especificacion_de_asset', etiqueta: 'Asset specification',      ayuda: 'Attaches to one sheet and inherits its §ADI anchor.' },
  { clave: 'identidad',               etiqueta: 'Identity (palette / light / material)', ayuda: 'Governs every page its ADI section covers.' },
]

const AMBITOS: { clave: string; etiqueta: string }[] = [
  { clave: 'proyecto', etiqueta: 'The whole project / identity' },
  { clave: 'pagina',   etiqueta: 'One specific page' },
  { clave: 'ficha',    etiqueta: 'One asset sheet' },
]

export default function ContextoModal({ projectId, paginas, accent, onCerrar, onListo }: {
  projectId: string
  /** Las páginas del ASG que hay en el lienzo, para la pregunta 3. Autocompleta por nombre. */
  paginas: UnifiedAsset[]
  accent: string
  onCerrar: () => void
  onListo: (resumen: { nombre: string; destino: string; marcadas: number }) => void
}) {
  const [paso,    setPaso]    = useState<Paso>(1)
  const [archivo, setArchivo] = useState<File | null>(null)
  const [texto,   setTexto]   = useState('')
  const [rol,     setRol]     = useState<string | null>(null)
  const [ambito,  setAmbito]  = useState<string | null>(null)
  const [cual,    setCual]    = useState('')
  const [busy,    setBusy]    = useState(false)
  const [error,   setError]   = useState<string | null>(null)
  const [propuesta, setPropuesta] = useState<{
    principal: DestinoDeContexto; alternativas: DestinoDeContexto[]; avisos: string[]; estado: string
  } | null>(null)
  const [elegido, setElegido] = useState<DestinoDeContexto | null>(null)

  const formato: 'imagen' | 'texto' = archivo ? 'imagen' : 'texto'
  const hayEntrada = Boolean(archivo || texto.trim())

  // El nombre de página tal como lo lleva la hoja: «19_EnvironmentSheet». Se saca del último tramo
  // del nombre, que es como el resto del moodboard identifica una página.
  const nombresDePagina = useMemo(() => {
    const vistos = new Set<string>()
    for (const a of paginas) {
      const cola = String(a.name).split(/\s+[—–]\s+/).pop()?.trim()
      if (cola && /^\d{2}_/.test(cola)) vistos.add(cola)
    }
    return [...vistos].sort()
  }, [paginas])

  // El paso 3 lo resuelve el servidor en cuanto hay rol y ámbito.
  useEffect(() => {
    if (paso !== 3 || !rol || !ambito) return
    let vivo = true
    setBusy(true); setError(null)
    destinoDeContexto(projectId, { rol, ambito, cual: cual || null, formato })
      .then(r => {
        if (!vivo) return
        setPropuesta({ principal: r.principal, alternativas: r.alternativas, avisos: r.avisos, estado: r.estado })
        setElegido(r.principal)
      })
      .catch(e => vivo && setError(e instanceof Error ? e.message : 'could not resolve a destination'))
      .finally(() => vivo && setBusy(false))
    return () => { vivo = false }
  }, [paso, rol, ambito, cual, formato, projectId])

  async function aprobar() {
    if (!elegido || !rol || !ambito) return
    setBusy(true); setError(null)
    try {
      // La imagen viaja por el camino que ya existe para subir a la librería; no hay razón para
      // abrir un segundo uploader que mantener.
      let url: string | null = null
      let nombre = texto.trim().slice(0, 60) || 'Context'
      if (archivo) {
        const subido = await uploadLibraryAsset(projectId, archivo, archivo.name)
        url = subido.storage_url
        nombre = archivo.name
      }
      const r = await guardarContexto(projectId, {
        nombre, url, texto: archivo ? null : texto.trim(),
        destino: elegido, rol, ambito,
        estado: propuesta?.estado || 'approved',
      })
      onListo({
        nombre,
        destino: elegido.titulo,
        marcadas: r.cascada?.marcadas?.length ?? 0,
      })
    } catch (e) {
      setError(e instanceof Error ? e.message : 'could not save the context')
      setBusy(false)
    }
  }

  const puedeSeguir = paso === 1 ? hayEntrada
    : paso === 2 ? Boolean(rol && ambito && (ambito === 'proyecto' || cual))
    : paso === 3 ? Boolean(elegido)
    : true

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
        width: 520, maxHeight: '84vh', overflowY: 'auto', padding: '22px 24px', borderRadius: 13,
        background: 'var(--bg-3)', border: '1px solid var(--line-2)',
        boxShadow: '0 22px 64px rgba(0,0,0,0.6)', animation: 'mb-in 180ms ease',
      }}>
        <div style={{
          fontSize: 10, fontFamily: 'var(--font-mono)', letterSpacing: '.08em',
          color: accent, marginBottom: 12,
        }}>ADD CONTEXT · STEP {paso} OF 4</div>

        {paso === 1 && (
          <>
            <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--text-0)', marginBottom: 10 }}>
              What are you adding?
            </div>
            <div style={{ fontSize: 12.5, color: 'var(--text-2)', lineHeight: 1.6, marginBottom: 14 }}>
              An image or a note. Audio and video are stored but their context is not read yet, so
              they are not accepted here.
            </div>
            <label style={{
              display: 'block', padding: '14px 12px', borderRadius: 9, cursor: 'pointer',
              border: `1px dashed ${archivo ? accent : 'var(--line-2)'}`, textAlign: 'center',
              fontSize: 12, color: archivo ? 'var(--text-0)' : 'var(--text-3)', marginBottom: 12,
            }}>
              {archivo ? archivo.name : 'Choose an image…'}
              <input type="file" accept="image/*" style={{ display: 'none' }}
                     onChange={e => { setArchivo(e.target.files?.[0] || null); setTexto('') }} />
            </label>
            <textarea
              value={texto}
              onChange={e => { setTexto(e.target.value); setArchivo(null) }}
              placeholder="…or write the note that should become context"
              rows={4}
              style={{
                width: '100%', padding: '9px 11px', borderRadius: 8, resize: 'vertical',
                background: 'var(--bg-2)', border: '1px solid var(--line-2)',
                color: 'var(--text-0)', fontSize: 12.5, fontFamily: 'var(--font-sans)',
              }}
            />
          </>
        )}

        {paso === 2 && (
          <>
            <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-0)', marginBottom: 8 }}>
              What is it for?
            </div>
            {ROLES.map(r => (
              <button key={r.clave} onClick={() => setRol(r.clave)} style={{
                display: 'block', width: '100%', textAlign: 'left', marginBottom: 6,
                padding: '8px 10px', borderRadius: 8, cursor: 'pointer',
                background: rol === r.clave ? `${accent}1f` : 'transparent',
                border: `1px solid ${rol === r.clave ? accent : 'var(--line-2)'}`,
                color: 'var(--text-1)', fontSize: 12, fontFamily: 'var(--font-sans)',
              }}>
                {r.etiqueta}
                <span style={{ display: 'block', fontSize: 10.5, color: 'var(--text-3)', marginTop: 2 }}>{r.ayuda}</span>
              </button>
            ))}

            <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-0)', margin: '14px 0 8px' }}>
              How far does it reach?
            </div>
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 10 }}>
              {AMBITOS.map(a => (
                <button key={a.clave} onClick={() => setAmbito(a.clave)} style={{
                  padding: '6px 10px', borderRadius: 999, cursor: 'pointer', fontSize: 11.5,
                  background: ambito === a.clave ? `${accent}26` : 'transparent',
                  border: `1px solid ${ambito === a.clave ? accent : 'var(--line-2)'}`,
                  color: ambito === a.clave ? 'var(--text-0)' : 'var(--text-2)',
                  fontFamily: 'var(--font-sans)',
                }}>{a.etiqueta}</button>
              ))}
            </div>

            {ambito && ambito !== 'proyecto' && (
              <>
                <div style={{ fontSize: 12, color: 'var(--text-1)', marginBottom: 6 }}>Which one?</div>
                <input
                  list="paginas-del-asg" value={cual} onChange={e => setCual(e.target.value)}
                  placeholder="19_EnvironmentSheet"
                  style={{
                    width: '100%', padding: '7px 10px', borderRadius: 8,
                    background: 'var(--bg-2)', border: '1px solid var(--line-2)',
                    color: 'var(--text-0)', fontSize: 12, fontFamily: 'var(--font-sans)',
                  }}
                />
                <datalist id="paginas-del-asg">
                  {nombresDePagina.map(n => <option key={n} value={n} />)}
                </datalist>
              </>
            )}
          </>
        )}

        {paso === 3 && (
          <>
            <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-0)', marginBottom: 10 }}>
              Where it lands
            </div>
            {busy && <div style={{ fontSize: 12, color: 'var(--text-3)' }}>Working it out…</div>}
            {propuesta && [propuesta.principal, ...propuesta.alternativas].map((d, i) => (
              <button key={d.clave + i} onClick={() => setElegido(d)} style={{
                display: 'block', width: '100%', textAlign: 'left', marginBottom: 7,
                padding: '9px 11px', borderRadius: 8, cursor: 'pointer',
                background: elegido === d ? `${accent}1f` : 'transparent',
                border: `1px solid ${elegido === d ? accent : 'var(--line-2)'}`,
                color: 'var(--text-1)', fontSize: 12, fontFamily: 'var(--font-sans)',
              }}>
                <span style={{ fontWeight: i === 0 ? 600 : 400 }}>{d.titulo}</span>
                {i === 0 && <span style={{ fontSize: 9.5, color: accent, marginLeft: 7 }}>SUGGESTED</span>}
                <span style={{ display: 'block', fontSize: 10.5, color: 'var(--text-3)', marginTop: 3 }}>
                  {d.inyeccion === 'directa' ? 'Injected into the page' : d.inyeccion === 'ninguna' ? 'Never reaches the model' : 'Influences through its ADI section'}
                  {d.adi ? ` · ${d.adi}` : ''}
                </span>
                {d.porque && <span style={{ display: 'block', fontSize: 10.5, color: 'var(--text-3)', marginTop: 2 }}>{d.porque}</span>}
              </button>
            ))}
            {propuesta?.avisos?.map((a, i) => (
              <div key={i} style={{ fontSize: 11, color: '#e8b562', lineHeight: 1.6, marginTop: 8 }}>{a}</div>
            ))}
          </>
        )}

        {paso === 4 && (
          <>
            <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-0)', marginBottom: 10 }}>
              Approve
            </div>
            <div style={{ fontSize: 12.5, color: 'var(--text-2)', lineHeight: 1.7 }}>
              <div><strong style={{ color: 'var(--text-1)' }}>What.</strong> {archivo ? archivo.name : `${texto.trim().slice(0, 70)}…`}</div>
              <div><strong style={{ color: 'var(--text-1)' }}>Where.</strong> {elegido?.titulo}</div>
              <div><strong style={{ color: 'var(--text-1)' }}>State.</strong> {propuesta?.estado === 'rejected' ? 'Rejected — kept as a curatorial filter, never sent to the model' : 'Approved'}</div>
            </div>
            <div style={{ fontSize: 11, color: 'var(--text-3)', lineHeight: 1.6, marginTop: 12 }}>
              Approving also feeds node 3.9 and marks the pages that depend on the destination, so a
              person can decide what to regenerate. Nothing is regenerated on its own.
            </div>
          </>
        )}

        {error && <div style={{ fontSize: 11.5, color: '#e8736a', lineHeight: 1.6, marginTop: 12 }}>{error}</div>}

        <div style={{ display: 'flex', gap: 8, marginTop: 18 }}>
          <button onClick={() => (paso === 1 ? onCerrar() : setPaso((paso - 1) as Paso))} disabled={busy} style={{
            flex: 1, padding: '9px 0', borderRadius: 8, cursor: busy ? 'default' : 'pointer',
            background: 'transparent', border: '1px solid var(--line-2)', color: 'var(--text-2)',
            fontSize: 12, fontFamily: 'var(--font-sans)',
          }}>{paso === 1 ? 'Cancel' : 'Back'}</button>
          <button
            onClick={() => (paso === 4 ? aprobar() : setPaso((paso + 1) as Paso))}
            disabled={busy || !puedeSeguir}
            style={{
              flex: 2, padding: '9px 0', borderRadius: 8,
              cursor: busy || !puedeSeguir ? 'default' : 'pointer',
              background: busy || !puedeSeguir ? 'var(--bg-2)' : accent,
              border: 'none', color: busy || !puedeSeguir ? 'var(--text-3)' : '#0b0c0e',
              fontSize: 12, fontWeight: 600, fontFamily: 'var(--font-sans)',
            }}
          >{busy ? 'Working…' : paso === 4 ? 'Approve and add' : 'Continue'}</button>
        </div>
      </div>
    </div>
  )
}
