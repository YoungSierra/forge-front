'use client'

// Botón flotante que lanza el Moodboard. Se arrastra a donde el usuario quiera y la posición
// queda guardada: es una herramienta siempre disponible sobre el canvas, y según en qué esté
// trabajando cada quien la va a querer en un lado distinto.
//
// El mismo componente sirve para el botón dentro de un nodo: se le pasa `nodeKey` y el
// moodboard abre filtrado a lo que ese nodo produjo.

import { useCallback, useEffect, useRef, useState } from 'react'
import Moodboard from './Moodboard'

const KEY  = 'forge_moodboard_button_pos'
const SIZE = 58
const EDGE = 16   // margen mínimo contra los bordes de la ventana

interface Props {
  projectId:    string
  projectName?: string
  nodeKey?:     string | null
}

export default function MoodboardButton({ projectId, projectName, nodeKey }: Props) {
  const [pos,   setPos]   = useState<{ x: number; y: number } | null>(null)
  const [open,  setOpen]  = useState(false)
  const [hover, setHover] = useState(false)
  const [drag,  setDrag]  = useState(false)
  // Un arrastre no debe abrir el moodboard al soltar: se distingue por distancia recorrida.
  const moved  = useRef(false)
  const offset = useRef({ x: 0, y: 0 })

  const clamp = useCallback((x: number, y: number) => ({
    x: Math.min(Math.max(x, EDGE), window.innerWidth  - SIZE - EDGE),
    y: Math.min(Math.max(y, EDGE), window.innerHeight - SIZE - EDGE),
  }), [])

  // Posición inicial: la guardada, o abajo a la derecha como en la referencia.
  useEffect(() => {
    const saved = typeof window !== 'undefined' ? localStorage.getItem(KEY) : null
    if (saved) {
      try { const p = JSON.parse(saved); setPos(clamp(p.x, p.y)); return } catch { /* posición corrupta */ }
    }
    setPos({ x: window.innerWidth - SIZE - 22, y: window.innerHeight - SIZE - 22 })
  }, [clamp])

  // Si la ventana se achica, el botón podría quedar fuera de vista.
  useEffect(() => {
    const onResize = () => setPos(p => (p ? clamp(p.x, p.y) : p))
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [clamp])

  // Ctrl+Alt+M abre el moodboard sin buscar el botón, que el usuario pudo arrastrar a cualquier
  // lado. Misma combinación que el Ctrl+Alt+P del canvas. Cerrar ya lo hace Escape, adentro.
  // Solo responde la instancia del proyecto: la de un nodo lleva `nodeKey` y no debe secuestrar
  // el atajo global si algún día conviven las dos.
  useEffect(() => {
    if (nodeKey) return
    const onKey = (e: KeyboardEvent) => {
      if (e.ctrlKey && e.altKey && (e.code === 'KeyM' || e.key.toLowerCase() === 'm')) {
        e.preventDefault()
        setOpen(v => !v)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [nodeKey])

  useEffect(() => {
    if (!drag) return
    const onMove = (e: PointerEvent) => {
      const next = clamp(e.clientX - offset.current.x, e.clientY - offset.current.y)
      moved.current = true
      setPos(next)
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

  if (!pos) return null

  return (
    <>
      <button
        onPointerDown={e => {
          moved.current = false
          offset.current = { x: e.clientX - pos.x, y: e.clientY - pos.y }
          setDrag(true)
        }}
        onClick={() => { if (!moved.current) setOpen(true) }}
        onMouseEnter={() => setHover(true)}
        onMouseLeave={() => setHover(false)}
        title={nodeKey ? `Moodboard — ${nodeKey}` : 'Project moodboard · Ctrl+Alt+M · drag to move'}
        style={{
          position: 'fixed', left: pos.x, top: pos.y, zIndex: 400,
          width: SIZE, height: SIZE, borderRadius: '50%',
          cursor: drag ? 'grabbing' : 'pointer',
          background: 'radial-gradient(circle at 38% 32%, #23303a 0%, #141a20 72%)',
          border: `1px solid ${hover || drag ? '#4fd2c2' : 'rgba(79,210,194,0.35)'}`,
          boxShadow: hover || drag
            ? '0 0 0 1px #4fd2c2, 0 0 34px rgba(79,210,194,0.42)'
            : '0 0 20px rgba(79,210,194,0.16), 0 6px 22px rgba(0,0,0,0.45)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          transition: drag
            ? 'none'
            : 'border-color 160ms ease, box-shadow 160ms ease, transform 160ms ease',
          transform: hover && !drag ? 'translateY(-2px)' : 'none',
          touchAction: 'none',
        }}
      >
        <img src="/forgy/forgyi.png" alt="Moodboard" width={32} height={32}
             draggable={false} style={{ objectFit: 'contain', pointerEvents: 'none' }} />
      </button>

      {open && (
        <Moodboard
          projectId={projectId}
          projectName={projectName}
          nodeKey={nodeKey}
          origin={{ x: pos.x + SIZE / 2, y: pos.y + SIZE / 2 }}
          onClose={() => setOpen(false)}
        />
      )}
    </>
  )
}
