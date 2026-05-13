'use client'
import { useEffect, useState, useRef } from 'react'
import { BACKEND_URL } from '@/lib/api'

function resolveUrl(url: string) {
  if (!url) return ''
  return url.startsWith('http') ? url : `${BACKEND_URL}${url}`
}

interface Props {
  url?: string
  style?: React.CSSProperties
}

export default function ModelViewer({ url, style }: Props) {
  const [blobUrl, setBlobUrl] = useState<string | null>(null)
  const [error, setError]     = useState<string | null>(null)
  const [dragging, setDragging] = useState(false)
  const currentBlob = useRef<string | null>(null)

  useEffect(() => {
    import('@google/model-viewer').catch(() => {})
  }, [])

  function loadBlob(blob: Blob) {
    if (currentBlob.current) URL.revokeObjectURL(currentBlob.current)
    const objUrl = URL.createObjectURL(blob)
    currentBlob.current = objUrl
    setBlobUrl(objUrl)
    setError(null)
  }

  useEffect(() => {
    if (!url) return
    setBlobUrl(null)
    setError(null)

    const resolved = resolveUrl(url)
    // Proxy server-side para evitar CORS con R2 u otros orígenes externos
    const proxyUrl = `/api/proxy-image?url=${encodeURIComponent(resolved)}`

    fetch(proxyUrl)
      .then(r => { if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.blob() })
      .then(blob => loadBlob(blob))
      .catch(e => {
        console.error('[ModelViewer] fetch error:', e, 'url:', resolved)
        setError(`${e.message ?? 'Error'} — ${resolved}`)
      })

    return () => {
      if (currentBlob.current) { URL.revokeObjectURL(currentBlob.current); currentBlob.current = null }
    }
  }, [url])

  function handleDrop(e: React.DragEvent) {
    e.preventDefault(); setDragging(false)
    const file = e.dataTransfer.files[0]
    if (file) loadBlob(file)
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
