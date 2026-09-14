'use client'

// Botón que lanza el Prototype Laboratory con el TDD de ESTE proyecto ya puesto.
//
// Mismo peso que el del Moodboard: mismo tamaño, mismo aro encendido, y se arrastra a donde uno
// quiera con la posición guardada. Son las dos salidas del canvas y no tiene sentido que una se
// vea como una herramienta y la otra como un detalle.
//
// Se distingue por el color y por el ícono: un matraz Erlenmeyer, que es lo que hay del otro lado
// —un laboratorio donde se prueba si el diseño se sostiene jugándolo—.
//
// Se dibuja SIEMPRE, y apagado cuando no puede correr. Esconderlo era la idea original —un botón
// que solo sabe dar error no ayuda— pero deja dos fallos distintos con la misma cara: sin `LAB_URL`
// en el servidor y sin TDD en el proyecto se ve exactamente lo mismo que si el front no se hubiera
// desplegado, y no hay forma de saber cuál de los tres es. Apagado y diciendo qué falta, sí.

import { useCallback, useEffect, useRef, useState } from 'react'
import { getLaboratorio, abrirLaboratorio } from '@/lib/api'
import LaboratoryPanel from './LaboratoryPanel'

const KEY  = 'forge_laboratory_button_pos'
const SIZE = 58
const EDGE = 16

interface Props {
  projectId: string
}

export default function LaboratoryButton({ projectId }: Props) {
  const [pos,   setPos]   = useState<{ x: number; y: number } | null>(null)
  // Qué contestó el servidor sobre este proyecto. `null` mientras no contesta.
  const [estado, setEstado] = useState<{ configurado: boolean; tiene_tdd: boolean } | null>(null)
  const [doc,   setDoc]   = useState<string | null>(null)
  const [yendo, setYendo] = useState(false)
  const [hover, setHover] = useState(false)
  const [drag,  setDrag]  = useState(false)
  const [error, setError] = useState<string | null>(null)
  // El laboratorio abierto, con lo que contestó el empuje del TDD: el panel muestra con qué
  // documento abrió y cuántas mecánicas se le leyeron.
  const [abierto, setAbierto] = useState<
    { url: string; documento: string; proyecto: string; mecanicas: number } | null>(null)
  const moved  = useRef(false)
  const inicio = useRef({ x: 0, y: 0 })
  const offset = useRef({ x: 0, y: 0 })

  const clamp = useCallback((x: number, y: number) => ({
    x: Math.min(Math.max(x, EDGE), window.innerWidth  - SIZE - EDGE),
    y: Math.min(Math.max(y, EDGE), window.innerHeight - SIZE - EDGE),
  }), [])

  // Arranca a la izquierda de Forgy, que vive abajo a la derecha. Después manda lo guardado.
  useEffect(() => {
    const saved = typeof window !== 'undefined' ? localStorage.getItem(KEY) : null
    if (saved) {
      try { const p = JSON.parse(saved); setPos(clamp(p.x, p.y)); return } catch { /* posición corrupta */ }
    }
    setPos({ x: window.innerWidth - SIZE * 2 - 34, y: window.innerHeight - SIZE - 22 })
  }, [clamp])

  useEffect(() => {
    const onResize = () => setPos(p => (p ? clamp(p.x, p.y) : p))
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [clamp])

  useEffect(() => {
    let vivo = true
    getLaboratorio(projectId)
      .then(r => { if (vivo) { setEstado({ configurado: r.configurado, tiene_tdd: r.tiene_tdd }); setDoc(r.documento ?? null) } })
      .catch(() => { if (vivo) setEstado({ configurado: false, tiene_tdd: false }) })
    return () => { vivo = false }
  }, [projectId])

  useEffect(() => {
    if (!drag) return
    const onMove = (e: PointerEvent) => {
      const d = Math.hypot(e.clientX - inicio.current.x, e.clientY - inicio.current.y)
      if (d > 4) moved.current = true
      if (moved.current) setPos(clamp(e.clientX - offset.current.x, e.clientY - offset.current.y))
    }
    const onUp = () => {
      setDrag(false)
      setPos(p => { if (p) localStorage.setItem(KEY, JSON.stringify(p)); return p })
    }
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup',   onUp)
    return () => {
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup',   onUp)
    }
  }, [drag, clamp])

  async function lanzar() {
    setError(null)
    setYendo(true)
    try {
      // El TDD se empuja ANTES de abrir el panel: así el iframe ya carga sobre el documento
      // correcto y no se ve pasar la lista de TDDs de la que no queremos que nadie elija.
      const r = await abrirLaboratorio(projectId)
      if (!r.usable) {
        // El Laboratory construye a partir de las mecánicas del TDD. Sin ninguna abre una pantalla
        // vacía, y es mejor decirlo que dejar que lo descubra allá.
        const seguir = window.confirm(
          `The Laboratory could not read a single mechanic from “${r.documento}”.\n\n` +
          'It builds from the mechanics the TDD declares, so it will open with nothing to work ' +
          'from. Open it anyway?')
        if (!seguir) { setYendo(false); return }
      }
      setAbierto({ url: r.url, documento: r.documento, proyecto: r.proyecto, mecanicas: r.mecanicas })
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setYendo(false)
    }
  }

  if (!pos) return null

  const listo = Boolean(estado?.configurado && estado?.tiene_tdd)
  const porQueNo = !estado
    ? 'Checking…'
    : !estado.configurado
      ? 'The Laboratory is not configured on this server (LAB_URL).'
      : 'This project has no assembled TDD yet — run node 3.12 first.'

  const ACENTO = '#c9a227'   // ámbar: la otra salida es turquesa, y se distinguen de un vistazo

  return (
    <>
      <button
        onPointerDown={e => {
          moved.current = false
          inicio.current = { x: e.clientX, y: e.clientY }
          offset.current = { x: e.clientX - pos.x, y: e.clientY - pos.y }
          setDrag(true)
        }}
        onClick={() => {
          if (moved.current || yendo) return
          // Apagado, el clic explica en vez de no hacer nada: quedarse mudo es lo que hace que un
          // botón parezca roto.
          if (!listo) { setError(porQueNo); return }
          lanzar()
        }}
        onMouseEnter={() => setHover(true)}
        onMouseLeave={() => setHover(false)}
        title={listo
          ? `Prototype Laboratory — opens with “${doc}” · drag to move`
          : `Prototype Laboratory — ${porQueNo}`}
        style={{
          position: 'fixed', left: pos.x, top: pos.y, zIndex: 400,
          width: SIZE, height: SIZE, borderRadius: '50%',
          cursor: yendo ? 'wait' : drag ? 'grabbing' : 'pointer',
          background: 'radial-gradient(circle at 38% 32%, #2e2a1e 0%, #17140e 72%)',
          border: `1px solid ${!listo ? 'rgba(255,255,255,0.14)' : hover || drag ? ACENTO : 'rgba(201,162,39,0.35)'}`,
          boxShadow: !listo
            ? '0 6px 22px rgba(0,0,0,0.45)'
            : hover || drag
              ? `0 0 0 1px ${ACENTO}, 0 0 34px rgba(201,162,39,0.42)`
              : '0 0 20px rgba(201,162,39,0.16), 0 6px 22px rgba(0,0,0,0.45)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          transition: drag ? 'none' : 'border-color 160ms ease, box-shadow 160ms ease, transform 160ms ease',
          transform: hover && !drag ? 'translateY(-2px)' : 'none',
          opacity: yendo ? 0.65 : listo ? 1 : 0.45,
          touchAction: 'none',
        }}
      >
        {/* Matraz Erlenmeyer: cuello estrecho, hombros en diagonal, base ancha, y el líquido
            dentro para que se lea como lleno y no como un triángulo. */}
        <svg width="30" height="30" viewBox="0 0 24 24" fill="none" stroke={listo ? ACENTO : '#7d8493'}
             strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"
             style={{ pointerEvents: 'none' }}>
          <path d="M9.5 3h5" />
          <path d="M10 3v5.6L4.6 18.2A1.6 1.6 0 0 0 6 20.6h12a1.6 1.6 0 0 0 1.4-2.4L14 8.6V3" />
          <path d="M7.1 14h9.8" fill="none" opacity="0.9" />
          <circle cx="10.4" cy="16.6" r="0.7" fill={ACENTO} stroke="none" opacity="0.85" />
          <circle cx="13.6" cy="17.4" r="0.5" fill={ACENTO} stroke="none" opacity="0.7" />
        </svg>
      </button>

      {abierto && (
        <LaboratoryPanel
          url={abierto.url}
          documento={abierto.documento}
          proyecto={abierto.proyecto}
          mecanicas={abierto.mecanicas}
          origin={{ x: pos.x + SIZE / 2, y: pos.y + SIZE / 2 }}
          onClose={() => setAbierto(null)}
        />
      )}

      {error && (
        <div style={{
          position: 'fixed', left: Math.max(EDGE, pos.x - 250), top: pos.y - 8,
          width: 250, padding: '9px 11px', borderRadius: 9, zIndex: 401,
          background: 'rgba(10,12,16,0.96)', border: '1px solid #8d3b3b',
          color: 'var(--text-1, #c7cedb)', fontSize: 11.5, lineHeight: 1.5,
        }}
          onClick={() => setError(null)}
        >{error}</div>
      )}
    </>
  )
}
