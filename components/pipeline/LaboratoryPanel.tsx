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
import { publicarJugable } from '@/lib/api'

interface Props {
  /** El proyecto, para poder publicar lo que se genere aquí dentro. */
  projectId: string
  slug:      string
  url:       string
  documento: string
  proyecto?: string
  mecanicas?: number
  /** De dónde crece el panel al abrirse: el botón que lo lanzó. */
  origin?:   { x: number; y: number } | null
  onClose:   () => void
}

export default function LaboratoryPanel({ projectId, slug, url, documento, proyecto, mecanicas, origin, onClose }: Props) {
  const [shown, setShown] = useState(false)
  // El iframe tarda: el servicio duerme y el primer arranque puede irse a veinte segundos. Sin
  // decirlo, un rectángulo vacío se lee como que falló.
  const [cargado, setCargado] = useState(false)
  // Publicar el jugable: lo que el laboratorio generó se sube a R2 y queda en una dirección que
  // se abre y se juega. Vive acá arriba y no dentro del iframe porque es Forge quien tiene el
  // almacenamiento del proyecto, y porque el enlace es del proyecto, no de la sesión.
  const [publicando, setPublicando] = useState(false)
  const [enlace, setEnlace] = useState<{ url: string; archivos: number; bytes: number } | null>(null)
  const [fallo, setFallo] = useState<string | null>(null)
  const [copiado, setCopiado] = useState(false)

  async function publicar() {
    setFallo(null)
    setPublicando(true)
    try {
      const r = await publicarJugable(projectId, slug)
      setEnlace({ url: r.url, archivos: r.archivos, bytes: r.bytes })
    } catch (e) {
      setFallo(e instanceof Error ? e.message : String(e))
    } finally {
      setPublicando(false)
    }
  }

  async function copiar() {
    if (!enlace) return
    try {
      await navigator.clipboard.writeText(enlace.url)
      setCopiado(true)
      setTimeout(() => setCopiado(false), 1800)
    } catch {
      // Sin permiso de portapapeles el campo sigue ahí para seleccionar a mano.
      setFallo('Could not copy — select the link and copy it by hand.')
    }
  }

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
          <button
            onClick={publicar}
            disabled={publicando}
            title="Upload the generated playable and get a link anyone can open"
            style={{
              padding: '6px 12px', borderRadius: 8, cursor: publicando ? 'wait' : 'pointer',
              background: publicando ? 'transparent' : ACENTO,
              border: `1px solid ${ACENTO}`,
              color: publicando ? ACENTO : '#1a0d04',
              fontSize: 11.5, fontFamily: 'var(--font-sans)', fontWeight: 600,
            }}
          >{publicando ? 'Publishing…' : 'Publish playable'}</button>

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

      {/* El enlace, cuando ya existe. Encima del panel y no dentro del iframe: lo que se comparte
          es del proyecto, y el laboratorio no sabe que esto ocurrió. */}
      {(enlace || fallo) && (
        <div
          onClick={() => { setEnlace(null); setFallo(null) }}
          style={{
            position: 'fixed', inset: 0, zIndex: 12500, background: 'rgba(6,8,11,0.82)',
            display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24,
          }}
        >
          <div
            onClick={e => e.stopPropagation()}
            style={{
              width: 'min(620px, 94vw)', padding: '20px 22px 18px', borderRadius: 14,
              background: 'var(--bg-1, #15171c)', border: `1px solid ${fallo ? '#8d3b3b' : `${ACENTO}66`}`,
              boxShadow: '0 30px 90px rgba(0,0,0,0.7)',
            }}
          >
            {fallo ? (
              <>
                <div style={{ fontSize: 14, color: 'var(--text-0, #e8eef7)', marginBottom: 8 }}>
                  The playable could not be published
                </div>
                <div style={{ fontSize: 12.5, color: 'var(--text-2, #8a92a3)', lineHeight: 1.6 }}>{fallo}</div>
              </>
            ) : (
              <>
                <div style={{ fontSize: 14, color: 'var(--text-0, #e8eef7)', marginBottom: 4 }}>
                  Your playable is live
                </div>
                <div style={{ fontSize: 11.5, color: 'var(--text-2, #8a92a3)', marginBottom: 14 }}>
                  {enlace!.archivos} files · {(enlace!.bytes / 1024 / 1024).toFixed(1)} MB · anyone with the link can play it
                </div>

                <div style={{ display: 'flex', gap: 8, alignItems: 'stretch' }}>
                  <input
                    readOnly
                    value={enlace!.url}
                    onFocus={e => e.currentTarget.select()}
                    style={{
                      flex: 1, minWidth: 0, padding: '9px 11px', borderRadius: 8,
                      background: 'var(--bg-0, #0b0e12)', border: '1px solid var(--line-2, #232830)',
                      color: 'var(--text-1, #c7cedb)', fontSize: 12, fontFamily: 'var(--font-mono)',
                    }}
                  />
                  <button
                    onClick={copiar}
                    style={{
                      padding: '0 16px', borderRadius: 8, cursor: 'pointer', whiteSpace: 'nowrap',
                      background: copiado ? 'transparent' : ACENTO,
                      border: `1px solid ${ACENTO}`,
                      color: copiado ? ACENTO : '#1a0d04',
                      fontSize: 12, fontWeight: 600, fontFamily: 'var(--font-sans)',
                    }}
                  >{copiado ? 'Copied' : 'Copy'}</button>
                  <a
                    href={enlace!.url} target="_blank" rel="noreferrer"
                    style={{
                      padding: '9px 14px', borderRadius: 8, whiteSpace: 'nowrap',
                      border: '1px solid var(--line-2, #232830)', color: 'var(--text-1, #c7cedb)',
                      fontSize: 12, textDecoration: 'none', display: 'flex', alignItems: 'center',
                    }}
                  >Play ↗</a>
                </div>
              </>
            )}

            <button
              onClick={() => { setEnlace(null); setFallo(null) }}
              style={{
                marginTop: 16, width: '100%', padding: '8px 0', borderRadius: 8, cursor: 'pointer',
                background: 'transparent', border: '1px solid var(--line-2, #232830)',
                color: 'var(--text-2, #8a92a3)', fontSize: 12, fontFamily: 'var(--font-sans)',
              }}
            >Back to the Laboratory</button>
          </div>
        </div>
      )}
    </div>,
    document.body,
  )
}
