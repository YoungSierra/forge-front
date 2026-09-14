'use client'

// El Prototype Laboratory, dentro de Forge.
//
// Va embebido y no en otra pestaña porque no es otro sitio: es otra vista del MISMO proyecto, con
// su TDD ya puesto. Mandar a alguien a una pestaña aparte le hace perder de dónde venía, y volver
// cuesta encontrar la ventana.
//
// Lo que se embebe es la herramienta entera, tal cual, servida desde su propio despliegue. Forge
// no reimplementa nada suyo — solo le pone un marco, un título que dice con qué documento abrió, y
// una salida.

import { createPortal } from 'react-dom'
import { useEffect, useState } from 'react'

interface Props {
  url:       string
  documento: string
  proyecto?: string
  mecanicas?: number
  /** De dónde crece el panel al abrirse: el botón que lo lanzó. */
  origin?:   { x: number; y: number } | null
  onClose:   () => void
}

export default function LaboratoryPanel({ url, documento, proyecto, mecanicas, origin, onClose }: Props) {
  const [shown, setShown] = useState(false)
  // El iframe tarda: el servicio duerme y el primer arranque puede irse a veinte segundos. Sin
  // decirlo, un rectángulo vacío se lee como que falló.
  const [cargado, setCargado] = useState(false)

  useEffect(() => { const r = requestAnimationFrame(() => setShown(true)); return () => cancelAnimationFrame(r) }, [])

  useEffect(() => {
    const k = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.stopPropagation(); onClose() } }
    window.addEventListener('keydown', k, true)
    return () => window.removeEventListener('keydown', k, true)
  }, [onClose])

  const ACENTO = '#c9a227'

  return createPortal(
    <div
      style={{
        position: 'fixed', inset: 0, zIndex: 12400, background: 'rgba(6,8,11,0.9)',
        display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 22,
        opacity: shown ? 1 : 0, transition: 'opacity 220ms ease',
      }}
    >
      <div
        style={{
          width: '100%', height: '100%', display: 'flex', flexDirection: 'column',
          background: 'var(--bg-0, #0b0e12)', border: `1px solid ${ACENTO}55`,
          borderRadius: 14, overflow: 'hidden',
          boxShadow: `0 0 50px ${ACENTO}22, 0 30px 90px rgba(0,0,0,0.7)`,
          transform: shown ? 'scale(1)' : 'scale(0.96)',
          transformOrigin: origin ? `${origin.x}px ${origin.y}px` : 'center',
          transition: 'transform 320ms cubic-bezier(0.22,1,0.36,1)',
        }}
      >
        <div style={{
          display: 'flex', alignItems: 'center', gap: 12, padding: '10px 14px',
          borderBottom: '1px solid var(--line-2, #232830)', flexShrink: 0,
        }}>
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke={ACENTO}
               strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
            <path d="M9.5 3h5" />
            <path d="M10 3v5.6L4.6 18.2A1.6 1.6 0 0 0 6 20.6h12a1.6 1.6 0 0 0 1.4-2.4L14 8.6V3" />
            <path d="M7.1 14h9.8" />
          </svg>
          <div style={{ minWidth: 0 }}>
            <div style={{ fontSize: 13, color: 'var(--text-0, #e8eef7)' }}>
              Prototype Laboratory{proyecto ? ` · ${proyecto}` : ''}
            </div>
            <div style={{
              fontSize: 11, color: 'var(--text-2, #8a92a3)', marginTop: 2,
              overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
            }}>
              {documento}{typeof mecanicas === 'number' ? ` — ${mecanicas} mechanic${mecanicas === 1 ? '' : 's'}` : ''}
            </div>
          </div>
          <div style={{ flex: 1 }} />
          {/* La salida a su propia pestaña se queda a mano: el laboratorio se usa a pantalla
              completa durante un rato largo, y el marco de Forge ahí estorba. */}
          <a href={url} target="_blank" rel="noreferrer"
             style={{ fontSize: 11, color: 'var(--text-2, #8a92a3)', textDecoration: 'none' }}>
            Open in a tab ↗
          </a>
          <button onClick={onClose} title="Close · Esc"
            style={{
              width: 28, height: 28, borderRadius: 7, cursor: 'pointer',
              background: 'transparent', border: '1px solid var(--line-2, #232830)',
              color: 'var(--text-1, #c7cedb)', fontSize: 14, lineHeight: 1,
            }}>×</button>
        </div>

        <div style={{ position: 'relative', flex: 1, minHeight: 0 }}>
          {!cargado && (
            <div style={{
              position: 'absolute', inset: 0, display: 'flex', alignItems: 'center',
              justifyContent: 'center', flexDirection: 'column', gap: 8,
              color: 'var(--text-2, #8a92a3)', fontSize: 12,
            }}>
              <div>Waking the Laboratory…</div>
              <div style={{ fontSize: 11, opacity: 0.7 }}>the first load takes about twenty seconds</div>
            </div>
          )}
          <iframe
            src={url}
            title="Prototype Laboratory"
            onLoad={() => setCargado(true)}
            // El laboratorio corre su propio jugable y pide pantalla completa y el puntero.
            allow="fullscreen; pointer-lock; gamepad; clipboard-write"
            style={{
              width: '100%', height: '100%', border: 0, display: 'block',
              opacity: cargado ? 1 : 0, transition: 'opacity 260ms ease',
              background: 'var(--bg-0, #0b0e12)',
            }}
          />
        </div>
      </div>
    </div>,
    document.body,
  )
}
