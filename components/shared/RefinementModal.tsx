'use client'

import { useState, useEffect, useRef } from 'react'
import MaskPainter, { type MaskPainterHandle } from './MaskPainter'
import { getAdminWorkflows, uploadToComfyUI, testAdminWorkflow } from '@/lib/api'
import type { ComfyUIWorkflow, Project, AssetVersion } from '@/lib/types'

export interface HistoryImage {
  id:         string
  url:        string
  label:      string
  isCurrent?: boolean
}

interface Props {
  imageUrl:       string
  imageId:        string
  project:        Project
  storagePath?:   string
  allVersions?:   AssetVersion[]
  historyImages?: HistoryImage[]
  onRefined:      (result: { image_url: string; refined_from_id: string }) => Promise<void> | void
  onClose:        () => void
}

// Ensambla el bloque de estilo del GDD para concatenarlo al prompt del usuario
function buildStyleContext(project: Project): string {
  const gdd = project.concept?.pipeline?.gdd as Record<string, unknown> | undefined
  if (!gdd) return ''
  const art  = (gdd.art_direction as Record<string, unknown> | undefined) ?? {}
  const proj = (gdd.project       as Record<string, string>  | undefined) ?? {}

  const parts: string[] = []
  if (art.style) parts.push(`Visual style: ${art.style}`)

  if (art.palette) {
    if (Array.isArray(art.palette)) {
      const swatches = (art.palette as Array<Record<string, string>>)
        .map(s => [s.role, s.color_description, s.tone].filter(Boolean).join(' — '))
        .filter(Boolean).join('; ')
      if (swatches) parts.push(`Color palette: ${swatches}`)
    } else {
      parts.push(`Color palette: ${art.palette}`)
    }
  }

  const genreTone = [proj.genre, proj.tone].filter(Boolean).join(', ')
  if (genreTone) parts.push(`Genre / tone: ${genreTone}`)
  return parts.join('. ')
}

const mono: React.CSSProperties = { fontFamily: 'var(--font-mono)' }

// Carga imagen via proxy Next.js para evitar bloqueo CORS al hacer fetch() desde el browser
async function urlToFile(imageUrl: string): Promise<File> {
  const proxyUrl = `/api/proxy-image?url=${encodeURIComponent(imageUrl)}`
  const res      = await fetch(proxyUrl)
  if (!res.ok) throw new Error(`Could not load source image (${res.status})`)
  const blob = await res.blob()
  return new File([blob], `source-${Date.now()}.png`, { type: blob.type || 'image/png' })
}

export default function RefinementModal({ imageUrl, imageId, project, storagePath, allVersions, historyImages, onRefined, onClose }: Props) {
  const [workflows,    setWorkflows]    = useState<ComfyUIWorkflow[]>([])
  const [selectedWf,   setSelectedWf]   = useState<ComfyUIWorkflow | null>(null)
  const [prompt,       setPrompt]       = useState('')
  const [activeUrl,    setActiveUrl]    = useState(imageUrl)
  const [imageFile,    setImageFile]    = useState<File | null>(null)
  const [brushSize,    setBrushSize]    = useState(30)
  const [running,      setRunning]      = useState(false)
  const [saving,       setSaving]       = useState(false)
  const [resultUrl,    setResultUrl]    = useState<string | null>(null)
  const [error,        setError]        = useState<string | null>(null)
  const [loadingImg,   setLoadingImg]   = useState(true)
  const [fakeProgress, setFakeProgress] = useState(0)
  const maskRef = useRef<MaskPainterHandle>(null)

  useEffect(() => {
    if (!running) {
      if (resultUrl) setFakeProgress(100)
      return
    }
    setFakeProgress(0)
    const iv = setInterval(() => {
      setFakeProgress(prev => {
        if (prev >= 88) return prev
        const step = prev < 30 ? 2.5 : prev < 60 ? 0.9 : 0.35
        return Math.min(88, prev + step)
      })
    }, 300)
    return () => clearInterval(iv)
  }, [running, resultUrl])

  // Cargar workflows marcados como refinement_capable
  useEffect(() => {
    getAdminWorkflows()
      .then(wfs => {
        const refWfs = wfs.filter(w => w.is_active && w.refinement_capable)
        setWorkflows(refWfs)
        if (refWfs.length === 1) setSelectedWf(refWfs[0])
      })
      .catch(() => setError('Error loading refinement workflows'))
  }, [])

  // Convertir URL → File via canvas (evita bloqueo CORS de fetch)
  useEffect(() => {
    setLoadingImg(true)
    setError(null)
    urlToFile(activeUrl)
      .then(file => setImageFile(file))
      .catch(e => setError(e.message))
      .finally(() => setLoadingImg(false))
  }, [activeUrl])

  useEffect(() => {
    function onKey(_e: KeyboardEvent) { /* Escape no cierra */ }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  async function handleRun() {
    if (!selectedWf || running) return
    setRunning(true); setError(null); setResultUrl(null)
    try {
      const imageExtras = Object.entries(selectedWf.inject_config?.extra ?? {})
        .filter(([, pt]) => pt.type === 'image')

      const extras: Record<string, string | number> = {}

      if (imageExtras.length > 0 && imageFile) {
        let blob: Blob
        if (selectedWf.mask_capable && maskRef.current?.hasStrokes()) {
          const composed = await maskRef.current.getComposedBlob()
          if (!composed) throw new Error('Could not compose mask — paint at least one stroke')
          blob = composed
        } else {
          blob = imageFile
        }
        const filename = await uploadToComfyUI(blob, `refine-${Date.now()}.png`)
        for (const [key] of imageExtras) extras[key] = filename
      }

      const fullPrompt       = [prompt, styleContext].filter(Boolean).join('. ')
      const resolvedStorage  = storagePath ?? `projects/${project.id}/refined/${imageId}_${Date.now()}.png`
      const res = await testAdminWorkflow(selectedWf.id, {
        ...(fullPrompt ? { prompt: fullPrompt } : {}),
        ...(Object.keys(extras).length ? { extras } : {}),
        storage_path: resolvedStorage,
      })
      setResultUrl(res.image_url)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Refinement error')
    } finally { setRunning(false) }
  }

  function handleDiscard() {
    setResultUrl(null)
    maskRef.current?.clear()
  }

  const styleContext = buildStyleContext(project)
  const isMask       = !!(selectedWf?.mask_capable)
  const hasResult    = !!resultUrl

  return (
    <div
      style={{ position: 'fixed', inset: 0, zIndex: 1200, background: 'rgba(0,0,0,0.82)', backdropFilter: 'blur(5px)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 8 }}
    >
      <div
        onClick={e => e.stopPropagation()}
        style={{ width: '100%', maxWidth: hasResult ? 1400 : 1100, maxHeight: '98vh', background: 'var(--bg-1)', border: '1px solid var(--line-2)', borderRadius: 12, display: 'flex', flexDirection: 'column', boxShadow: '0 32px 80px rgba(0,0,0,0.65)', overflow: 'hidden', transition: 'max-width 200ms ease' }}
      >
        {/* Header */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '14px 20px', borderBottom: '1px solid var(--line)', flexShrink: 0 }}>
          <span style={{ fontSize: 15, opacity: 0.7 }}>🖌</span>
          <div style={{ flex: 1 }}>
            <div style={{ ...mono, fontSize: 9, color: 'var(--text-3)', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 2 }}>
              Refinement tool
            </div>
            <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--text-0)' }}>
              {hasResult ? 'Review result before applying' : 'Refine image'}
            </div>
          </div>
          <button
            onClick={onClose}
            style={{ background: 'var(--bg-3)', border: '1px solid var(--line-2)', borderRadius: 6, width: 28, height: 28, display: 'grid', placeItems: 'center', cursor: 'pointer', color: 'var(--text-2)', fontSize: 16 }}
          >✕</button>
        </div>

        {/* ── VISTA PREVIA: antes / después ── */}
        {hasResult && (
          <div style={{ flex: 1, overflow: 'auto', display: 'flex', flexDirection: 'column', gap: 16, padding: '20px 24px' }}>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
              {/* Original */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                <div style={{ ...mono, fontSize: 9, color: 'var(--text-3)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>Original</div>
                <img src={activeUrl} alt="original" style={{ width: '100%', borderRadius: 8, border: '1px solid var(--line-2)', objectFit: 'cover', display: 'block' }} />
              </div>
              {/* Result */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <div style={{ ...mono, fontSize: 9, color: 'var(--state-success)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>Refined</div>
                  <div style={{ ...mono, fontSize: 9, color: 'var(--text-3)' }}>— new version</div>
                </div>
                <div style={{ position: 'relative' }}>
                  <img src={resultUrl!} alt="refined" style={{ width: '100%', borderRadius: 8, border: '2px solid var(--state-success)', objectFit: 'cover', display: 'block' }} />
                </div>
              </div>
            </div>

            {/* Error */}
            {error && (
              <div style={{ ...mono, fontSize: 10, color: 'var(--state-error)', background: 'color-mix(in oklch, var(--state-error) 10%, var(--bg-2))', padding: '8px 12px', borderRadius: 6 }}>
                {error}
              </div>
            )}

            {/* Acciones */}
            <div style={{ display: 'flex', gap: 10, paddingTop: 4 }}>
              <button
                onClick={async () => {
                  setSaving(true); setError(null)
                  try {
                    await onRefined({ image_url: resultUrl!, refined_from_id: imageId })
                    onClose()
                  } catch (e) {
                    setError(e instanceof Error ? e.message : 'Error applying result')
                    setSaving(false)
                  }
                }}
                disabled={saving}
                style={{ flex: 1, padding: '10px 20px', borderRadius: 7, border: 'none', cursor: saving ? 'not-allowed' : 'pointer', background: 'var(--action)', color: 'var(--action-fg)', fontSize: 13, ...mono, fontWeight: 700, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, opacity: saving ? 0.7 : 1 }}
              >
                {saving
                  ? <><span style={{ display: 'inline-block', width: 11, height: 11, border: '2px solid currentColor', borderTopColor: 'transparent', borderRadius: '50%', animation: 'spin 0.7s linear infinite' }} />Saving…</>
                  : '✓ Apply as current version'}
              </button>
              <button
                onClick={handleDiscard}
                style={{ padding: '10px 20px', borderRadius: 7, border: '1px solid var(--line-2)', cursor: 'pointer', background: 'transparent', color: 'var(--text-2)', fontSize: 12, ...mono, display: 'flex', alignItems: 'center', gap: 6 }}
              >
                ↩ Refine again
              </button>
            </div>
          </div>
        )}

        {/* ── CONTROLES: edición ── */}
        {!hasResult && (
          <div style={{ flex: 1, overflow: 'auto', display: 'grid', gridTemplateColumns: '3fr 2fr', gap: 20, padding: '14px 20px' }}>

            {/* Col izquierda: imagen / mask painter */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              <div style={{ ...mono, fontSize: 9, color: 'var(--text-3)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>
                {isMask ? 'Paint the area to edit' : 'Source image'}
              </div>

              {/* History strip — versiones de asset O imágenes del pool de referencia */}
              {(() => {
                const items: HistoryImage[] = historyImages
                  ?? allVersions?.map(v => ({
                    id: v.id,
                    url: v.storage_url,
                    label: v.is_current ? `v${v.version_number} ✓` : `v${v.version_number}`,
                    isCurrent: v.is_current,
                  })) ?? []
                if (items.length < 2) return null
                return (
                  <div>
                    <div style={{ ...mono, fontSize: 9, color: 'var(--text-3)', marginBottom: 4 }}>
                      History — click to refine from that image
                    </div>
                    <div style={{ display: 'flex', gap: 5, flexWrap: 'wrap' }}>
                      {items.map(item => {
                        const isActive = item.url === activeUrl
                        return (
                          <button
                            key={item.id}
                            onClick={() => { setActiveUrl(item.url); maskRef.current?.clear() }}
                            title={item.label}
                            style={{
                              flexShrink: 0, padding: 0,
                              border: `2px solid ${isActive ? 'var(--action)' : item.isCurrent ? 'var(--state-success)' : 'var(--line-2)'}`,
                              borderRadius: 5, overflow: 'hidden', cursor: 'pointer',
                              background: 'transparent', position: 'relative',
                            }}
                          >
                            <img src={item.url} alt={item.label} style={{ width: 52, height: 52, display: 'block', objectFit: 'cover', objectPosition: 'top' }} />
                            <div style={{
                              position: 'absolute', bottom: 0, left: 0, right: 0,
                              background: 'rgba(0,0,0,0.6)',
                              fontFamily: 'var(--font-mono)', fontSize: 8,
                              color: isActive ? 'var(--action)' : item.isCurrent ? 'var(--state-success)' : '#fff',
                              textAlign: 'center', padding: '1px 0',
                            }}>
                              {item.label}
                            </div>
                          </button>
                        )
                      })}
                    </div>
                  </div>
                )
              })()}

              {loadingImg && (
                <div style={{ ...mono, fontSize: 10, color: 'var(--text-3)', padding: '24px 0', textAlign: 'center' }}>
                  Loading image…
                </div>
              )}

              {!loadingImg && imageFile && isMask && (
                <>
                  <MaskPainter ref={maskRef} imageFile={imageFile} brushSize={brushSize} />
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <span style={{ ...mono, fontSize: 10, color: 'var(--text-3)', whiteSpace: 'nowrap' }}>Brush</span>
                    <input
                      type="range" min={5} max={120} value={brushSize}
                      onChange={e => setBrushSize(Number(e.target.value))}
                      className="forge-range"
                      style={{ flex: 1 }}
                    />
                    <span style={{ ...mono, fontSize: 10, color: 'var(--text-3)', width: 32, textAlign: 'right' }}>{brushSize}px</span>
                    <button
                      onClick={() => maskRef.current?.clear()}
                      style={{ ...mono, fontSize: 10, padding: '3px 10px', borderRadius: 5, cursor: 'pointer', border: '1px solid var(--line-2)', background: 'transparent', color: 'var(--text-3)' }}
                    >Clear</button>
                  </div>
                </>
              )}

              {/* Fallback: imagen estática si no hay File o no hay mask */}
              {!loadingImg && (!imageFile || !isMask) && (
                <img src={activeUrl} alt="" style={{ width: '100%', borderRadius: 6, border: '1px solid var(--line-2)', objectFit: 'cover', display: 'block' }} />
              )}
            </div>

            {/* Col derecha: controles */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>

              {/* Workflow selector */}
              <div>
                <div style={{ ...mono, fontSize: 9, color: 'var(--text-3)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 6 }}>Workflow</div>
                {workflows.length === 0
                  ? <div style={{ ...mono, fontSize: 10, color: 'var(--state-warning)' }}>No active refinement workflows</div>
                  : (
                    <select
                      value={selectedWf?.id ?? ''}
                      onChange={e => setSelectedWf(workflows.find(w => w.id === e.target.value) ?? null)}
                      style={{ width: '100%', background: 'var(--bg-2)', border: '1px solid var(--line-2)', borderRadius: 5, padding: '6px 10px', fontSize: 11, color: 'var(--text-0)', ...mono }}
                    >
                      <option value="">— select —</option>
                      {workflows.map(w => (
                        <option key={w.id} value={w.id}>{w.name}{w.mask_capable ? ' · mask' : ''}</option>
                      ))}
                    </select>
                  )
                }
                {selectedWf && (
                  <div style={{ ...mono, marginTop: 4, fontSize: 9, color: 'var(--text-3)' }}>
                    {selectedWf.mask_capable
                      ? '⊕ Paint the area to modify on the image'
                      : '↳ Prompt only, no mask'}
                    {selectedWf.description ? ` · ${selectedWf.description}` : ''}
                  </div>
                )}
              </div>

              {/* Prompt */}
              <div>
                <div style={{ ...mono, fontSize: 9, color: 'var(--text-3)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 6 }}>Refinement prompt</div>
                <textarea
                  value={prompt}
                  onChange={e => setPrompt(e.target.value)}
                  placeholder="Describe what to change or refine…"
                  rows={4}
                  style={{ width: '100%', background: 'var(--bg-2)', border: '1px solid var(--line-2)', borderRadius: 5, padding: '8px 10px', fontSize: 11, color: 'var(--text-0)', ...mono, resize: 'vertical', boxSizing: 'border-box' }}
                />
              </div>

              {/* Error (carga de imagen o workflow) */}
              {error && (
                <div style={{ ...mono, fontSize: 10, color: 'var(--state-error)', background: 'color-mix(in oklch, var(--state-error) 10%, var(--bg-2))', padding: '8px 12px', borderRadius: 6 }}>
                  {error}
                </div>
              )}

              {/* Run button / progress */}
              {running ? (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8, padding: '4px 0' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <span style={{ ...mono, fontSize: 10, color: 'var(--text-3)', animation: 'item-pulse 1.6s ease-in-out infinite' }}>
                      {fakeProgress < 30 ? 'Sending to ComfyUI…' : fakeProgress < 65 ? 'Generating…' : 'Almost ready…'}
                    </span>
                    <span style={{ ...mono, fontSize: 10, color: 'var(--action)' }}>{Math.round(fakeProgress)}%</span>
                  </div>
                  <div style={{ width: '100%', height: 3, background: 'var(--bg-3)', borderRadius: 99, overflow: 'hidden' }}>
                    <div style={{ height: '100%', borderRadius: 99, background: 'linear-gradient(90deg, var(--action), var(--action-hover))', width: `${fakeProgress}%`, transition: 'width 0.4s ease' }} />
                  </div>
                </div>
              ) : (
                <button
                  onClick={handleRun}
                  disabled={!selectedWf}
                  style={{ padding: '8px 16px', borderRadius: 6, border: 'none', cursor: !selectedWf ? 'not-allowed' : 'pointer', background: 'var(--action)', color: 'var(--action-fg)', fontSize: 12, ...mono, fontWeight: 700, opacity: !selectedWf ? 0.6 : 1, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8 }}
                >
                  ▶ Refine image
                </button>
              )}
            </div>
          </div>
        )}

        <style>{`@keyframes spin { to { transform: rotate(360deg) } } @keyframes item-pulse { 0%,100%{opacity:1} 50%{opacity:0.45} }`}</style>
      </div>
    </div>
  )
}
