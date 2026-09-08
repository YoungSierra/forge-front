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
  const visor = useRef<HTMLElement | null>(null)

  // El visor es un custom element que trae `@google/model-viewer`. Hasta que ese módulo carga y
  // registra el elemento, `<model-viewer>` es una etiqueta desconocida: el navegador la acepta,
  // no dibuja nada y no protesta. Con el `.catch(() => {})` que había, un fallo de carga se veía
  // exactamente igual que un modelo que no gira — que es como se reportó dos informes seguidos.
  //
  // Ahora se espera al registro y se dice si no llega. No arregla la carga; hace que la próxima
  // vez se sepa si el problema es este o es otro.
  const [visorListo, setVisorListo] = useState(() =>
    typeof window !== 'undefined' && !!window.customElements?.get('model-viewer'))

  useEffect(() => {
    if (visorListo) return
    let vivo = true
    import('@google/model-viewer')
      .then(() => window.customElements?.whenDefined('model-viewer'))
      .then(() => { if (vivo) setVisorListo(true) })
      .catch(e => {
        if (!vivo) return
        console.error('[ModelViewer] no se pudo cargar el visor 3D:', e)
        setError('3D viewer failed to load — reload the page')
      })
    return () => { vivo = false }
  }, [visorListo])

  // El primer gesto del usuario apaga el giro automático, y no vuelve.
  //
  // `auto-rotate` por sí solo se reanuda tras `auto-rotate-delay`, así que el encuadre que uno
  // acaba de elegir se lo lleva la animación a los pocos segundos. Quitar el atributo al primer
  // toque lo convierte en lo que tiene que ser: una presentación de bienvenida, no un estado.
  //
  // El evento es `camera-change`, que model-viewer emite con `detail.source`: solo cuenta
  // `user-interaction`, porque el propio giro automático también mueve la cámara y si no se
  // filtrara se apagaría solo en el primer fotograma.
  useEffect(() => {
    const el = visor.current
    if (!el || !blobUrl || !visorListo) return
    const onCambio = (e: Event) => {
      if ((e as CustomEvent).detail?.source !== 'user-interaction') return
      el.removeAttribute('auto-rotate')
      el.removeEventListener('camera-change', onCambio)
    }
    el.addEventListener('camera-change', onCambio)
    return () => el.removeEventListener('camera-change', onCambio)
  }, [blobUrl, visorListo])

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
        <div style={{ color: 'var(--state-error)', marginBottom: 6 }}>⚠ {error}</div>
        <div style={{ color: 'var(--text-3)' }}>Drop a .glb to preview locally</div>
      </div>
      {overlay}
    </div>
  )

  if (!blobUrl || !visorListo) return (
    <div style={base} {...dropProps}>
      <div style={{ textAlign: 'center', fontFamily: 'monospace', fontSize: 11, color: 'var(--text-3)' }}>
        {!url ? 'Drop a .glb file here' : !visorListo ? 'Starting the 3D viewer…' : 'Loading model…'}
      </div>
      {overlay}
    </div>
  )

  return (
    <div style={{ ...base, display: 'block', padding: 0 }} {...dropProps}>
      {/* Gira solo al abrirlo, y se para PARA SIEMPRE en cuanto lo tocás.
          El giro automático estuvo apagado un tiempo porque `auto-rotate` vuelve a arrancar a los
          pocos segundos de soltar el ratón: uno elegía un ángulo y el modelo se lo llevaba. Eso
          era el «funciona de forma extraña» del punto 7. Pero sin girar tampoco se ve que es una
          pieza 3D — parece una foto, que es el punto 1 del informe v4.
          Las dos cosas se arreglan si el giro es una PRESENTACIÓN y no un estado: arranca solo,
          muestra la pieza por todos lados, y el primer gesto del usuario se lo queda. No vuelve.
          `touch-action: none` es lo que deja orbitar arrastrando también en tableta: sin él el
          navegador se queda el gesto para hacer scroll de la página. */}
      <model-viewer
        ref={visor}
        src={blobUrl}
        alt="3D model"
        camera-controls=""
        auto-rotate=""
        interaction-prompt="none"
        shadow-intensity="1"
        style={{ width: '100%', height: '100%', display: 'block', borderRadius: 'inherit', touchAction: 'none' }}
      />
      {overlay}
    </div>
  )
}
