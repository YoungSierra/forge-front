'use client'
import { useEffect, useState, useRef } from 'react'
import { BACKEND_URL } from '@/lib/api'

function resolveUrl(url: string) {
  if (!url) return ''
  return url.startsWith('http') ? url : `${BACKEND_URL}${url}`
}

// Blob URLs cacheadas por sesión (proxyUrl → blobUrl).
// Son "propiedad del cache" — nunca se revocan, viven hasta que se recarga la página.
const glbCache = new Map<string, string>()

interface Props {
  url?: string
  style?: React.CSSProperties
}

export default function ModelViewer({ url, style }: Props) {
  const [blobUrl,  setBlobUrl]  = useState<string | null>(null)
  const [error,    setError]    = useState<string | null>(null)
  const [dragging, setDragging] = useState(false)
  // Solo para drag & drop — blobs locales que SÍ revocamos al reemplazar
  const localBlob = useRef<string | null>(null)

  useEffect(() => {
    import('@google/model-viewer').catch(() => {})
  }, [])

  // Drag & drop: crea blob local (no se cachea, se revoca al reemplazar)
  function loadLocalBlob(blob: Blob) {
    if (localBlob.current) { URL.revokeObjectURL(localBlob.current); localBlob.current = null }
    const objUrl = URL.createObjectURL(blob)
    localBlob.current = objUrl
    setBlobUrl(objUrl)
    setError(null)
  }

  useEffect(() => {
    if (!url) {
      setBlobUrl(null)
      setError(null)
      return
    }
    setError(null)

    const resolved = resolveUrl(url)
    const proxyUrl = `/api/proxy-image?url=${encodeURIComponent(resolved)}`

    // Cache hit: mostrar de inmediato sin red
    if (glbCache.has(proxyUrl)) {
      setBlobUrl(glbCache.get(proxyUrl)!)
      return
    }

    // Cache miss: descargar, guardar en cache y mostrar
    setBlobUrl(null)
    const controller = new AbortController()

    fetch(proxyUrl, { signal: controller.signal })
      .then(r => { if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.blob() })
      .then(blob => {
        if (controller.signal.aborted) return
        const objUrl = URL.createObjectURL(blob)
        glbCache.set(proxyUrl, objUrl) // propiedad del cache, no se revoca
        setBlobUrl(objUrl)
        setError(null)
      })
      .catch(e => {
        if (e.name === 'AbortError') return
        console.error('[ModelViewer] fetch error:', e, 'url:', resolved)
        setError(`${e.message ?? 'Error'} — ${resolved}`)
      })

    // Solo abortar la request; el blob URL queda en cache si llegó a crearse
    return () => { controller.abort() }
  }, [url])

  // Revocar blob local al desmontar (solo drag & drop)
  useEffect(() => {
    return () => {
      if (localBlob.current) { URL.revokeObjectURL(localBlob.current); localBlob.current = null }
    }
  }, [])

  function handleDrop(e: React.DragEvent) {
    e.preventDefault(); setDragging(false)
    const file = e.dataTransfer.files[0]
    if (file) loadLocalBlob(file)
  }

  const base: React.CSSProperties = {
    width: '100%', height: '100%', borderRadius: 8,
    border: `1px solid ${dragging ? 'var(--cat-asset)' : 'var(--line-2)'}`,
    background: dragging ? 'color-mix(in oklch, var(--cat-asset) 8%, #111)' : '#111',
    display: 'flex', alignItems: 'center', justifyContent: 'center',
    position: 'relative', boxSizing: 'border-box',
    transition: 'border-color 0.15s, background 0.15s',
    ...style,
  }

  const dropProps = {
    onDragOver:  (e: React.DragEvent) => { e.preventDefault(); setDragging(true) },
    onDragLeave: () => setDragging(false),
    onDrop:      handleDrop,
  }

  const overlay = dragging && (
    <div style={{
      position: 'absolute', inset: 0, borderRadius: 'inherit',
      background: 'color-mix(in oklch, var(--cat-asset) 15%, transparent)',
      border: '2px dashed var(--cat-asset)',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      fontFamily: 'monospace', fontSize: 12, color: 'var(--cat-asset)',
      pointerEvents: 'none',
    }}>
      Drop to load
    </div>
  )

  if (error) return (
    <div style={base} {...dropProps}>
      <div style={{ textAlign: 'center', fontFamily: 'monospace', fontSize: 11 }}>
        <div style={{ color: 'var(--cat-output)', marginBottom: 6 }}>⚠ {error}</div>
        <div style={{ color: 'var(--text-3)' }}>Drop a .glb to preview locally</div>
      </div>
      {overlay}
    </div>
  )

  if (!blobUrl) return (
    <div style={base} {...dropProps}>
      <div style={{ textAlign: 'center', fontFamily: 'monospace', fontSize: 11, color: 'var(--text-3)' }}>
        {url ? 'Loading model…' : 'Drop a .glb file here'}
      </div>
      {overlay}
    </div>
  )

  return (
    <div style={{ ...base, display: 'block', padding: 0 }} {...dropProps}>
      <model-viewer
        src={blobUrl}
        alt="3D model"
        camera-controls=""
        auto-rotate=""
        shadow-intensity="1"
        style={{ width: '100%', height: '100%', display: 'block', borderRadius: 'inherit' }}
      />
      {overlay}
    </div>
  )
}
