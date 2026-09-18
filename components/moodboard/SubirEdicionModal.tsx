'use client'

import { useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { subirEdicionManual, type ClaseDeCambio, type UnifiedAsset } from '@/lib/api'

// ─── Upload manual edits ─────────────────────────────────────────────────────
//
// Informe v9, punto 3. Alguien se llevó la pieza a Photoshop, a Blender o a un editor de audio, la
// arregló a mano, y quiere que ESA sea la versión vigente.
//
// Lo que sube REEMPLAZA a la página; no se publica al lado. Por eso se guarda como una versión más
// de la misma pieza: conserva su `id`, y con él su sitio en el lienzo, su instancia en el menú del
// Vertical Slice, sus «Must comply with» y todo lo que cuelga de ella. La versión anterior queda
// en la Asset Library, como cualquier otra.
//
// El tipo NO se pregunta: lo deduce el servidor por la extensión, que es lo que pide el informe.
// Acá solo se enseña lo que se reconoció, para que quien sube pueda ver que acertó antes de soltar.

/** Lo que el servidor sabe recibir. Se declara acá SOLO para el filtro del selector y para poder
 *  avisar antes de subir; la decisión de verdad la toma el backend, que es quien la aplica. */
const ACEPTA = '.png,.jpg,.jpeg,.webp,.gif,.tif,.tiff,.glb,.gltf,.fbx,.obj,.mp4,.webm,.mov,.mp3,.wav,.ogg,.flac'

const FAMILIA: Record<string, string> = {
  png: '2D image', jpg: '2D image', jpeg: '2D image', webp: '2D image', gif: '2D image',
  tif: '2D image', tiff: '2D image',
  glb: '3D model', gltf: '3D model', fbx: '3D model', obj: '3D model',
  mp4: 'video', webm: 'video', mov: 'video',
  mp3: 'audio', wav: 'audio', ogg: 'audio', flac: 'audio',
}

const extDe = (n: string) => (/\.([a-z0-9]{1,5})$/i.exec(n)?.[1] || '').toLowerCase()
const mono: React.CSSProperties = { fontFamily: 'var(--font-mono)' }

export default function SubirEdicionModal({
  asset, projectId, accent, onCancel, onListo,
}: {
  asset: UnifiedAsset
  projectId: string
  accent: string
  onCancel: () => void
  onListo: () => void
}) {
  const [archivo, setArchivo] = useState<File | null>(null)
  const [cambio,  setCambio]  = useState<ClaseDeCambio | null>(null)
  const [subiendo, setSubiendo] = useState(false)
  const [error,   setError]   = useState<string | null>(null)
  const [arrastra, setArrastra] = useState(false)
  const input = useRef<HTMLInputElement>(null)

  const ext = archivo ? extDe(archivo.name) : ''
  const familia = FAMILIA[ext] ?? null
  const puede = !!archivo && !!familia && !!cambio && !subiendo

  const tomar = (f: File | null) => {
    setError(null)
    if (!f) return
    const e = extDe(f.name)
    if (!FAMILIA[e]) { setError(`Forge does not know what a ".${e || '?'}" is.`); setArchivo(null); return }
    setArchivo(f)
  }

  async function subir() {
    if (!archivo || !cambio) return
    setSubiendo(true); setError(null)
    try {
      await subirEdicionManual(projectId, asset.id, archivo, cambio)
      onListo()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
      setSubiendo(false)
    }
  }

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
        width: 'min(520px, 94vw)', borderRadius: 14,
        background: 'var(--bg-1, #0e1116)', border: '1px solid var(--line-2, #232830)',
        boxShadow: '0 28px 90px rgba(0,0,0,0.66)',
      }}>
        <div style={{ padding: '16px 20px', borderBottom: '1px solid var(--line-2, #232830)' }}>
          <div style={{ ...mono, fontSize: 10, letterSpacing: '.14em', color: accent, textTransform: 'uppercase' }}>
            Upload manual edits
          </div>
          <div style={{ fontSize: 14, color: 'var(--text-0, #e8eef7)', marginTop: 4 }}>{asset.name}</div>
          <div style={{ fontSize: 11.5, color: 'var(--text-2, #8a92a3)', marginTop: 6, lineHeight: 1.5 }}>
            The file you upload replaces this page. It keeps its place on the canvas, its instance in
            the Vertical Slice menu and everything that hangs off it; the current version moves to the
            Asset Library.
          </div>
        </div>

        <div style={{ padding: 20, display: 'flex', flexDirection: 'column', gap: 16 }}>
          {/* Soltar o elegir. Arrastrar es el gesto natural cuando venís del explorador de
              archivos con la pieza recién guardada. */}
          <div
            onClick={() => input.current?.click()}
            onDragOver={e => { e.preventDefault(); setArrastra(true) }}
            onDragLeave={() => setArrastra(false)}
            onDrop={e => { e.preventDefault(); setArrastra(false); tomar(e.dataTransfer.files?.[0] ?? null) }}
            style={{
              padding: '22px 16px', borderRadius: 10, cursor: 'pointer', textAlign: 'center',
              border: `1px dashed ${arrastra ? accent : 'var(--line-2, #232830)'}`,
              background: arrastra ? `${accent}12` : 'transparent',
              transition: 'border-color 140ms, background 140ms',
            }}
          >
            {archivo ? (
              <>
                <div style={{ fontSize: 12.5, color: 'var(--text-0, #e8eef7)' }}>{archivo.name}</div>
                <div style={{ ...mono, fontSize: 10.5, color: accent, marginTop: 5 }}>
                  {familia} · {(archivo.size / 1048576).toFixed(1)} MB
                </div>
              </>
            ) : (
              <>
                <div style={{ fontSize: 12.5, color: 'var(--text-2, #8a92a3)' }}>Drop the file here, or click to choose</div>
                <div style={{ ...mono, fontSize: 10, color: 'var(--text-3, #6b7280)', marginTop: 5 }}>
                  2D · 3D · audio · video — the type is read from the extension
                </div>
              </>
            )}
            <input ref={input} type="file" accept={ACEPTA} hidden
                   onChange={e => tomar(e.target.files?.[0] ?? null)} />
          </div>

          {/* La misma pregunta que Design Edits, y por la misma razón: lo que salió de esta página
              se marca para rehacer o solo para revisar según QUÉ cambió, y eso no se deduce de un
              archivo. Es obligatoria — dejarla sin responder mandaba todo a «revalidate» en
              silencio, que es lo que pasó con las 22 páginas del informe v9. */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
            <span style={{ fontSize: 11, color: 'var(--text-3, #6b7280)' }}>What did you change?</span>
            {([
              ['tratamiento', 'How it looks', 'Light, palette, materials — what came out of this page probably still holds.'],
              ['sujeto',      'What it shows', 'A different subject — what came out of this page will need redoing.'],
            ] as const).map(([clave, etiqueta, ayuda]) => (
              <button key={clave} onClick={() => setCambio(clave)} title={ayuda} style={{
                padding: '4px 10px', borderRadius: 999, cursor: 'pointer', fontSize: 11,
                background: cambio === clave ? `${accent}22` : 'transparent',
                border: `1px solid ${cambio === clave ? accent : 'var(--line-2, #232830)'}`,
                color: cambio === clave ? accent : 'var(--text-2, #8a92a3)',
              }}>{etiqueta}</button>
            ))}
          </div>
          {cambio === 'sujeto' && (
            <div style={{ fontSize: 11, color: 'var(--text-3, #6b7280)', lineHeight: 1.5, marginTop: -8 }}>
              Everything produced from this page will be marked <strong>regenerate</strong>. Nothing
              runs on its own — someone approves each one.
            </div>
          )}

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
          }}>{subiendo ? 'Uploading…' : 'Replace this page'}</button>
        </div>
      </div>
    </div>,
    document.body,
  )
}
