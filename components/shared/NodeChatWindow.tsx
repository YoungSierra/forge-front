'use client'

import React, { useState, useRef, useEffect, useCallback } from 'react'
import { createPortal } from 'react-dom'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { chatWithNode } from '@/lib/api'
import type { ChatMessage, ChatAttachment, ChatToolCall, ApprovedAsset, OutputImageItem, OutputImagesMap } from '@/lib/api'
import type { Project } from '@/lib/types'
import { MD_COMPONENTS } from '@/lib/md-components'
import AttachmentCard from './AttachmentCard'
import { Paperclip } from 'lucide-react'

// ─── Utilidad — parsear items de un output para image gen ────────────────────

export function parseOutputItems(content: string, format: string): string[] {
  // Outputs de imagen: el contenido completo es el prompt — una sola imagen por output
  if (format === 'png' || format === 'image') return [content.trim().slice(0, 700)]

  if (format === 'json') {
    try {
      const parsed = JSON.parse(content)
      if (Array.isArray(parsed)) return parsed.map(String).filter(s => s.trim().length > 0)
    } catch { /* continúa */ }
  }
  // Bullet list: "- item", "* item", "• item"
  const bulletRx   = /^[ \t]*[-*•][ \t]+(.+)$/gm
  // Numbered list: "1. item", "1) item"
  const numberedRx = /^[ \t]*\d+[.)]\s+(.+)$/gm
  // Labeled: "Variation 1: title", "Option 2: title", "Concept 3: title"
  const labeledRx  = /^[A-Za-z]+\s+\d+[:.]\s+(.+)$/gm
  // Markdown heading con número: "## 1. title", "### Variation 1: title", "### **Variation 1:** title"
  const headingRx  = /^#{1,4}\s+(?:\*{0,2})(?:[A-Za-z]+\s+)?\d+[:.)]?\s+(.+)$/gm

  const bullets  = [...content.matchAll(bulletRx)].map(m => m[1].trim())
  if (bullets.length > 0) return bullets

  const numbered = [...content.matchAll(numberedRx)].map(m => m[1].trim())
  if (numbered.length > 0) return numbered

  // Labeled con descripción: dividir por el inicio de cada "Variation N:" y capturar el bloque completo
  const labeledParts = content
    .split(/(?=^[A-Za-z]+[ \t]+\d+[:.]\s)/m)
    .map(p => p.trim())
    .filter(p => /^[A-Za-z]+[ \t]+\d+[:.]\s/.test(p))
  if (labeledParts.length > 0) return labeledParts.map(p => p.slice(0, 900))

  // Heading con número + descripción subsiguiente (captura bloque completo)
  // Cada variación = "### Variation N: título\n\ndescripción..."
  const richBlocks: string[] = []
  const richRx = /^#{1,4}[ \t]+([^\n]+(?:\n(?!#{1,4}[ \t])[^\n]*)*)/gm
  for (const m of content.matchAll(richRx)) {
    const block = m[1].trim()
    // Solo incluir bloques que empiecen con "Palabra N:" o "**Palabra N:**" — son ítems de variación
    if (/^(?:\*{0,2})(?:[A-Za-z]+[ \t]+)?\d+[:.]\s?/.test(block)) {
      richBlocks.push(block.slice(0, 700))   // máx 700 chars para no saturar el prompt
    }
  }
  if (richBlocks.length > 0) return richBlocks

  const headings = [...content.matchAll(headingRx)].map(m => m[1].trim())
  if (headings.length > 0) return headings

  // Fallback: líneas no vacías (máx 20)
  return content.split('\n').map(l => l.trim()).filter(l => l.length > 5).slice(0, 20)
}

const KEYFRAMES = `
  @keyframes chat-dot { 0%,80%,100%{opacity:.2;transform:scale(0.8)} 40%{opacity:1;transform:scale(1)} }
  @keyframes img-gen-pulse { 0%,100%{opacity:.35} 50%{opacity:1} }
`

const WINDOW_W = 560
const WINDOW_H = 820
// Margen mínimo respecto al borde de pantalla
const MARGIN   = 12

// ─── Typing dots ──────────────────────────────────────────────────────────────

function TypingDots() {
  return (
    <div style={{ display: 'flex', gap: 4, alignItems: 'center', padding: '4px 0' }}>
      {[0, 1, 2].map(i => (
        <div key={i} style={{
          width: 6, height: 6, borderRadius: '50%',
          background: 'var(--text-3)',
          animation: 'chat-dot 1.2s ease-in-out infinite',
          animationDelay: `${i * 0.2}s`,
        }} />
      ))}
    </div>
  )
}

// ─── Tipos para image gen inline ─────────────────────────────────────────────

export interface InlineImageItem {
  itemKey:      string   // "outputKey:index" — único entre todos los outputs
  index:        number
  text:         string
  imageUrl:     string | null                // última variación generada (null si ninguna)
  allVariations: { url: string; condition?: string | null }[]
  isGenerating: boolean
  onGenerate:   (condition?: string) => void
  onZoom:       (url: string) => void
}

const VP_W = 480
const VP_H = 520

// Panel modal para generar una nueva variación con condiciones del usuario
export function VariationPanel({ item, onClose }: { item: InlineImageItem; onClose: () => void }) {
  const [condition,      setCondition]      = useState('')
  const [generating,     setGenerating]     = useState(false)
  const [internalZoomUrl,setInternalZoomUrl]= useState<string | null>(null)
  const [vpPos,          setVpPos]          = useState({ x: 0, y: 0 })
  const [vpSize,         setVpSize]         = useState({ w: VP_W, h: VP_H })
  const [vpMaximized,    setVpMaximized]    = useState(false)
  const [vpDragging,     setVpDragging]     = useState(false)
  const [vpResizing,     setVpResizing]     = useState(false)
  const vpDragOrigin   = useRef({ sx: 0, sy: 0, ox: 0, oy: 0 })
  const vpResizeOrigin = useRef({ sx: 0, sy: 0, ow: 0, oh: 0 })
  const vpSizeRef      = useRef({ w: VP_W, h: VP_H })
  const vpSavedGeom    = useRef<{ pos: { x: number; y: number }; size: { w: number; h: number } } | null>(null)
  const textareaRef    = useRef<HTMLTextAreaElement>(null)

  // Centrar al montar
  useEffect(() => {
    setVpPos({
      x: Math.max(0, (window.innerWidth  - VP_W) / 2),
      y: Math.max(0, (window.innerHeight - VP_H) / 2),
    })
    textareaRef.current?.focus()
  }, [])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { internalZoomUrl ? setInternalZoomUrl(null) : onClose() }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose, internalZoomUrl])

  // Drag
  const onVpDragStart = (e: React.MouseEvent) => {
    if (vpMaximized) return
    e.preventDefault()
    vpDragOrigin.current = { sx: e.clientX, sy: e.clientY, ox: vpPos.x, oy: vpPos.y }
    setVpDragging(true)
  }
  useEffect(() => {
    if (!vpDragging) return
    const onMove = (e: MouseEvent) => setVpPos({ x: vpDragOrigin.current.ox + e.clientX - vpDragOrigin.current.sx, y: vpDragOrigin.current.oy + e.clientY - vpDragOrigin.current.sy })
    const onUp   = () => setVpDragging(false)
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup',   onUp)
    return () => { window.removeEventListener('mousemove', onMove); window.removeEventListener('mouseup', onUp) }
  }, [vpDragging])

  // Resize
  const onVpResizeStart = (e: React.MouseEvent) => {
    e.preventDefault(); e.stopPropagation()
    vpResizeOrigin.current = { sx: e.clientX, sy: e.clientY, ow: vpSizeRef.current.w, oh: vpSizeRef.current.h }
    setVpResizing(true)
  }
  useEffect(() => {
    if (!vpResizing) return
    const onMove = (e: MouseEvent) => {
      const nw = Math.max(360, vpResizeOrigin.current.ow + e.clientX - vpResizeOrigin.current.sx)
      const nh = Math.max(280, vpResizeOrigin.current.oh + e.clientY - vpResizeOrigin.current.sy)
      vpSizeRef.current = { w: nw, h: nh }
      setVpSize({ w: nw, h: nh })
    }
    const onUp = () => setVpResizing(false)
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup',   onUp)
    return () => { window.removeEventListener('mousemove', onMove); window.removeEventListener('mouseup', onUp) }
  }, [vpResizing])

  const toggleVpMaximize = () => {
    if (vpMaximized) {
      const g = vpSavedGeom.current
      if (g) { vpSizeRef.current = g.size; setVpSize(g.size); setVpPos(g.pos) }
    } else {
      vpSavedGeom.current = { pos: vpPos, size: vpSizeRef.current }
    }
    setVpMaximized(v => !v)
  }

  const handleGenerate = async () => {
    setGenerating(true)
    try { await item.onGenerate(condition.trim() || undefined); onClose() }
    finally { setGenerating(false) }
  }

  return createPortal(
    <>
      {/* Backdrop */}
      <div onClick={onClose} style={{ position: 'fixed', inset: 0, zIndex: 20000, background: 'rgba(0,0,0,0.72)' }} />

      {/* Modal draggable/resizable */}
      <div
        onClick={e => e.stopPropagation()}
        style={{
          position: 'fixed',
          left:   vpMaximized ? 0 : vpPos.x,
          top:    vpMaximized ? 0 : vpPos.y,
          width:  vpMaximized ? '100vw' : vpSize.w,
          height: vpMaximized ? '100vh' : vpSize.h,
          zIndex: 20001,
          background: 'var(--bg-1)', border: '1px solid var(--line-2)',
          borderRadius: vpMaximized ? 0 : 12,
          boxShadow: vpMaximized ? 'none' : '0 24px 64px rgba(0,0,0,0.55)',
          display: 'flex', flexDirection: 'column', overflow: 'hidden',
          userSelect: vpDragging || vpResizing ? 'none' : 'auto',
        }}
      >
        {/* Header */}
        <div
          onMouseDown={onVpDragStart}
          style={{
            padding: '12px 16px', borderBottom: '1px solid var(--line-2)', flexShrink: 0,
            display: 'flex', alignItems: 'center', justifyContent: 'space-between',
            cursor: vpMaximized ? 'default' : (vpDragging ? 'grabbing' : 'grab'),
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <div style={{ width: 30, height: 30, borderRadius: '50%', flexShrink: 0, border: '1px solid rgba(255,138,61,0.25)', background: 'rgba(255,138,61,0.12)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <img src="/forgy/forgyi.png" alt="Forge" style={{ width: 16, height: 16, objectFit: 'contain' }} />
            </div>
            <span style={{ fontFamily: 'var(--font-mono)', fontSize: 10, fontWeight: 700, color: 'var(--text-0)', letterSpacing: '0.05em' }}>GENERATE VARIATION</span>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 4 }} onMouseDown={e => e.stopPropagation()}>
            <button onClick={toggleVpMaximize} title={vpMaximized ? 'Restore' : 'Maximize'} style={{ border: 'none', background: 'transparent', cursor: 'pointer', color: 'var(--text-2)', padding: '4px 8px', borderRadius: 6, flexShrink: 0 }}>
              {vpMaximized ? (
                <svg width="13" height="13" viewBox="0 0 13 13" fill="none" style={{ display: 'block' }}>
                  <rect x="3.75" y="0.75" width="8.5" height="8.5" stroke="currentColor" strokeWidth="1.5" rx="1"/>
                  <rect x="0.75" y="3.75" width="8.5" height="8.5" stroke="currentColor" strokeWidth="1.5" rx="1" fill="var(--bg-1)"/>
                </svg>
              ) : (
                <svg width="13" height="13" viewBox="0 0 13 13" fill="none" style={{ display: 'block' }}>
                  <rect x="0.75" y="0.75" width="11.5" height="11.5" stroke="currentColor" strokeWidth="1.5" rx="1"/>
                </svg>
              )}
            </button>
            <button onClick={onClose} style={{ background: 'transparent', border: 'none', cursor: 'pointer', color: 'var(--text-2)', fontSize: 16, padding: '4px 8px', borderRadius: 6, lineHeight: 1 }}>✕</button>
          </div>
        </div>

        {/* Contenido — columna flex que llena el alto del modal */}
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minHeight: 0 }}>
          {/* Galería de variaciones existentes */}
          {item.allVariations.length > 0 && (
            <div style={{ padding: '12px 16px 0', display: 'flex', gap: 8, overflowX: 'auto', flexShrink: 0 }}>
              {item.allVariations.map((v, i) => (
                <div key={i} style={{ flexShrink: 0, display: 'flex', flexDirection: 'column', gap: 4 }}>
                  <img src={v.url} alt={`Variation ${i + 1}`} onClick={e => { e.stopPropagation(); setInternalZoomUrl(v.url) }}
                    style={{ width: 90, height: 90, objectFit: 'cover', borderRadius: 6, border: '1px solid var(--line-2)', cursor: 'zoom-in', display: 'block' }} />
                  {v.condition && (
                    <span style={{ fontSize: 8, color: 'var(--text-3)', fontFamily: 'var(--font-mono)', maxWidth: 90, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={v.condition}>
                      {v.condition}
                    </span>
                  )}
                </div>
              ))}
            </div>
          )}

          {/* Concepto de referencia */}
          <div style={{ padding: '12px 16px 0', flexShrink: 0 }}>
            <div style={{ fontSize: 9, color: 'var(--text-3)', fontFamily: 'var(--font-mono)', marginBottom: 4 }}>CONCEPT</div>
            <div style={{ fontSize: 11, color: 'var(--text-2)', lineHeight: 1.5, background: 'var(--bg-2)', borderRadius: 6, padding: '8px 10px', border: '1px solid var(--line-2)' }}>
              {item.text.replace(/\*{1,2}([^*]+)\*{1,2}/g, '$1')}
            </div>
          </div>

          {/* Input de condiciones — crece para llenar el alto restante */}
          <div style={{ padding: '12px 16px', flex: 1, display: 'flex', flexDirection: 'column', minHeight: 0 }}>
            <div style={{ fontSize: 9, color: 'var(--text-3)', fontFamily: 'var(--font-mono)', marginBottom: 6, flexShrink: 0 }}>VARIATION INSTRUCTIONS <span style={{ color: 'var(--text-4)' }}>(optional)</span></div>
            <div style={{ display: 'flex', gap: 7, flex: 1, minHeight: 0 }}>
              <textarea
                ref={textareaRef}
                value={condition}
                onChange={e => setCondition(e.target.value)}
                placeholder="Describe what to change — style, mood, color palette, composition…"
                style={{ flex: 1, resize: 'none', background: 'var(--bg-2)', border: '1px solid var(--line-2)', borderRadius: 8, padding: '8px 10px', fontSize: 12, color: 'var(--text-0)', lineHeight: 1.5, fontFamily: 'inherit', outline: 'none', minHeight: 80 }}
                onFocus={e => { e.currentTarget.style.borderColor = 'var(--action)' }}
                onBlur={e  => { e.currentTarget.style.borderColor = 'var(--line-2)' }}
              />
              <button
                onClick={handleGenerate} disabled={generating}
                style={{ width: 38, borderRadius: 8, border: 'none', flexShrink: 0, background: generating ? 'var(--bg-3)' : 'var(--action)', color: generating ? 'var(--text-4)' : 'var(--action-fg)', fontSize: 18, cursor: generating ? 'not-allowed' : 'pointer', transition: 'background 120ms', display: 'flex', alignItems: 'center', justifyContent: 'center', animation: generating ? 'img-gen-pulse 1.2s ease-in-out infinite' : 'none' }}
              >→</button>
            </div>
          </div>
        </div>

        {/* Handle de resize */}
        {!vpMaximized && (
          <div onMouseDown={onVpResizeStart} style={{ position: 'absolute', bottom: 0, right: 0, width: 18, height: 18, cursor: 'se-resize', display: 'flex', alignItems: 'flex-end', justifyContent: 'flex-end', padding: 4 }}>
            <svg width="10" height="10" viewBox="0 0 10 10" style={{ opacity: 0.3 }}>
              <line x1="2" y1="10" x2="10" y2="2" stroke="var(--text-1)" strokeWidth="1.5" strokeLinecap="round"/>
              <line x1="5" y1="10" x2="10" y2="5" stroke="var(--text-1)" strokeWidth="1.5" strokeLinecap="round"/>
              <line x1="8" y1="10" x2="10" y2="8" stroke="var(--text-1)" strokeWidth="1.5" strokeLinecap="round"/>
            </svg>
          </div>
        )}
      </div>

      {/* Zoom interno */}
      {internalZoomUrl && (
        <div onClick={() => setInternalZoomUrl(null)} style={{ position: 'fixed', inset: 0, zIndex: 30000, background: 'rgba(0,0,0,0.92)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <img src={internalZoomUrl} onClick={e => e.stopPropagation()} style={{ maxWidth: '90vw', maxHeight: '85vh', borderRadius: 10, display: 'block' }} />
        </div>
      )}
    </>,
    document.body,
  )
}

// Botón inline pegado al texto del ítem
function InlineGenButton({ item }: { item: InlineImageItem }) {
  const [showPanel, setShowPanel] = useState(false)

  return (
    <>
      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 3, marginLeft: 6, verticalAlign: 'middle' }}>
        {item.allVariations.map((v, i) => (
          <img
            key={i}
            src={v.url}
            onClick={e => { e.stopPropagation(); item.onZoom(v.url) }}
            title={v.condition ?? 'Click to view'}
            style={{ width: 22, height: 22, borderRadius: 3, objectFit: 'cover', cursor: 'zoom-in', border: '1px solid var(--line-2)', flexShrink: 0 }}
          />
        ))}
        <button
          disabled={item.isGenerating}
          onClick={e => {
            e.stopPropagation()
            if (item.imageUrl) { setShowPanel(true) } else { item.onGenerate() }
          }}
          title={item.isGenerating ? 'Generating image…' : item.imageUrl ? 'Generate a new variation' : 'Generate image for this item'}
          style={{
            fontSize: 9, padding: '1px 5px', borderRadius: 3, lineHeight: 1.4,
            border: '1px solid color-mix(in srgb, var(--action) 40%, transparent)',
            background: item.isGenerating
              ? 'color-mix(in srgb, var(--action) 14%, var(--bg-2))'
              : 'color-mix(in srgb, var(--action) 8%, var(--bg-2))',
            color: 'var(--action)', cursor: item.isGenerating ? 'not-allowed' : 'pointer',
            fontFamily: 'var(--font-mono)', flexShrink: 0,
            animation: item.isGenerating ? 'img-gen-pulse 1.2s ease-in-out infinite' : 'none',
          }}
        >
          {item.isGenerating ? 'Processing…' : item.imageUrl ? '↺' : '✦'}
        </button>
      </span>
      {showPanel && <VariationPanel item={item} onClose={() => setShowPanel(false)} />}
    </>
  )
}

// Tarjeta individual — muestra todas las variaciones como thumbnails separados
function ThumbnailCard({ item }: { item: InlineImageItem }) {
  const [showPanel, setShowPanel] = useState(false)
  const S = 80

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
      <div style={{ display: 'flex', gap: 4, alignItems: 'flex-end' }}>
        {/* Una thumbnail por variación */}
        {item.allVariations.map((v, i) => (
          <div
            key={i}
            style={{ width: S, height: S, borderRadius: 6, overflow: 'hidden', border: '1px solid var(--line-2)', flexShrink: 0 }}
          >
            <img
              src={v.url} alt=""
              onClick={() => item.onZoom(v.url)}
              style={{ width: '100%', height: '100%', objectFit: 'cover', cursor: 'zoom-in', display: 'block' }}
            />
          </div>
        ))}

        {/* Placeholder cuando no hay variaciones */}
        {item.allVariations.length === 0 && (
          <div style={{
            width: S, height: S, borderRadius: 6, border: '1px solid var(--line-2)',
            background: 'var(--bg-2)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
          }}>
            <span style={{
              fontSize: 9, color: 'var(--text-3)', textAlign: 'center',
              animation: item.isGenerating ? 'img-gen-pulse 1.2s ease-in-out infinite' : 'none',
            }}>
              {item.isGenerating ? 'Generating…' : '–'}
            </span>
          </div>
        )}

        {/* Botón generate / re-generate */}
        <button
          disabled={item.isGenerating}
          onClick={e => {
            e.stopPropagation()
            if (item.imageUrl) { setShowPanel(true) } else { item.onGenerate() }
          }}
          title={item.isGenerating ? 'Generating…' : item.imageUrl ? 'Generate a new variation' : 'Generate image'}
          style={{
            fontSize: 9, padding: '2px 6px', borderRadius: 5, lineHeight: 1.6,
            border: '1px solid color-mix(in srgb, var(--action) 40%, transparent)',
            background: item.isGenerating
              ? 'color-mix(in srgb, var(--action) 14%, var(--bg-2))'
              : 'color-mix(in srgb, var(--action) 8%, var(--bg-2))',
            color: 'var(--action)', cursor: item.isGenerating ? 'not-allowed' : 'pointer',
            fontFamily: 'var(--font-mono)', flexShrink: 0,
            animation: item.isGenerating ? 'img-gen-pulse 1.2s ease-in-out infinite' : 'none',
          }}
        >
          {item.isGenerating ? '…' : item.imageUrl ? '↺' : '✦'}
        </button>
      </div>
      <span style={{
        fontSize: 9, color: 'var(--text-3)', lineHeight: 1.35,
        overflow: 'hidden', display: '-webkit-box',
        WebkitLineClamp: 2, WebkitBoxOrient: 'vertical' as const,
        maxWidth: Math.max(item.allVariations.length, 1) * (S + 4),
      }}>
        {item.text.replace(/\*{1,2}([^*]+)\*{1,2}/g, '$1').split('\n')[0].slice(0, 70)}
      </span>
      {showPanel && <VariationPanel item={item} onClose={() => setShowPanel(false)} />}
    </div>
  )
}

// Grid de thumbnails — muestra todas las variaciones de cada ítem
export function ImageThumbnailRow({ items }: { items?: InlineImageItem[] }) {
  if (!items || items.length === 0) return null
  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, margin: '8px 0 4px 34px' }}>
      {items.map(item => <ThumbnailCard key={item.itemKey} item={item} />)}
    </div>
  )
}

// Extrae texto plano recursivamente de React children (más fiable que el AST hast)
function extractChildrenText(children: React.ReactNode): string {
  if (children === null || children === undefined) return ''
  if (typeof children === 'string') return children
  if (typeof children === 'number') return String(children)
  if (Array.isArray(children)) return children.map(extractChildrenText).join(' ')
  if (React.isValidElement(children)) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const cp = (children as any).props as { children?: React.ReactNode }
    return extractChildrenText(cp?.children)
  }
  return ''
}

// Construye components de ReactMarkdown que inyectan InlineGenButton en los ítems correspondientes
export function buildImageGenComponents(imageItems: InlineImageItem[]) {
  // Keys de outputs que tienen image gen — solo se inyectan botones dentro de esas secciones
  const imageGenKeys = new Set(imageItems.map(item => item.itemKey.split(':')[0]))

  // Flag mutable: true solo cuando el render está dentro de una sección image-gen (## outputKey)
  // Se actualiza al renderizar cada h2 — React renderiza el árbol depth-first, por lo que
  // el h2 se procesa antes que sus li/p hermanos, haciendo este patrón seguro
  let inImageGenSection = false

  // Mapa de número de variación → item — soporta "Variation 1:", "**Variation 1:**", etc.
  const byNumber = new Map<number, InlineImageItem>()
  for (const item of imageItems) {
    const m = /(?:^|\*{1,2})(?:[A-Za-z]+[ \t]+)?(\d+)[:.]/i.exec(item.text.trim())
    if (m && !byNumber.has(parseInt(m[1], 10))) {
      byNumber.set(parseInt(m[1], 10), item)
    }
  }

  // Normaliza texto para comparación robusta: strip markdown inline, colapsa espacios, lowercase, 60 chars
  function normKey(text: string): string {
    return text.replace(/\*{1,2}([^*]+)\*{1,2}/g, '$1').replace(/\s+/g, ' ').trim().toLowerCase().slice(0, 60)
  }

  // Mapa de texto normalizado → item — fallback para ítems nombrados sin número
  const byText = new Map<string, InlineImageItem>()
  for (const item of imageItems) {
    const key = normKey(item.text)
    if (key && !byText.has(key)) byText.set(key, item)
  }

  function findItemByNumber(text: string): InlineImageItem | undefined {
    const m = /(?:^|\s)([A-Za-z]+)\s+(\d+)\s*[:.]/i.exec(text.trim())
    if (!m) return undefined
    return byNumber.get(parseInt(m[2], 10))
  }

  function findItemByText(text: string): InlineImageItem | undefined {
    return byText.get(normKey(text))
  }

  // Inyecta botón en headings de nivel 3/4 dentro de secciones image-gen
  const wrapInner = (Tag: string, children: React.ReactNode, props: Record<string, unknown>) => {
    if (!inImageGenSection) return React.createElement(Tag, props, children)
    const text = extractChildrenText(children)
    const item = findItemByNumber(text) ?? findItemByText(text)
    if (item) {
      return React.createElement(Tag, props, children, React.createElement(InlineGenButton, { key: item.itemKey, item }))
    }
    return React.createElement(Tag, props, children)
  }

  // Inyecta botón en li/p solo si estamos dentro de una sección image-gen
  const wrapStrict = (Tag: string, children: React.ReactNode, props: Record<string, unknown>) => {
    if (!inImageGenSection) return React.createElement(Tag, props, children)
    const text = extractChildrenText(children)
    const atStart = /^(?:[A-Za-z_]+[ \t]*[\r\n]+)?[A-Za-z]+\s+\d+[ \t]*[:.]/i.test(text)
    const item = (atStart ? findItemByNumber(text) : undefined) ?? findItemByText(text)
    if (item) {
      return React.createElement(Tag, props, children, React.createElement(InlineGenButton, { key: item.itemKey, item }))
    }
    return React.createElement(Tag, props, children)
  }

  // node es un objeto hast de react-markdown — no debe pasarse al DOM
  /* eslint-disable @typescript-eslint/no-explicit-any */
  return {
    ...MD_COMPONENTS,
    // h2 es el heading de sección — actualiza el flag y nunca inyecta botón
    h2: ({ children, node: _n, ...p }: any) => {
      const key = extractChildrenText(children).trim().toLowerCase().replace(/[\s-]+/g, '_')
      inImageGenSection = imageGenKeys.has(key) || [...imageGenKeys].some(k => key.includes(k) || k.includes(key))
      return React.createElement('h2', p, children)
    },
    h1: ({ children, node: _n, ...p }: any) => wrapInner('h1', children, p),
    h3: ({ children, node: _n, ...p }: any) => wrapInner('h3', children, p),
    h4: ({ children, node: _n, ...p }: any) => wrapInner('h4', children, p),
    p:  ({ children, node: _n, ...p }: any) => wrapStrict('p',  children, p),
    li: ({ children, node: _n, ...p }: any) => wrapStrict('li', children, p),
  }
  /* eslint-enable @typescript-eslint/no-explicit-any */
}

// ─── Tool call chips ──────────────────────────────────────────────────────────

const TOOL_ICONS: Record<string, string> = {
  web_search:   '⌕',
  web_fetch:    '⌕',
  doc_gen_docx: '⬡',
  doc_gen_pptx: '⬡',
  kb_read:      '⎘',
}

function ToolCallChips({ calls }: { calls: ChatToolCall[] }) {
  const [open, setOpen] = React.useState(false)
  if (!calls.length) return null
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 4, paddingLeft: 34, marginBottom: 4 }}>
      <button
        onClick={() => setOpen(o => !o)}
        style={{
          display: 'inline-flex', alignItems: 'center', gap: 5,
          background: 'none', border: '1px solid var(--line-2)',
          borderRadius: 5, padding: '2px 8px',
          color: 'var(--text-3)', fontSize: 10, fontFamily: 'var(--font-mono)',
          cursor: 'pointer', width: 'fit-content', letterSpacing: '.02em',
        }}
      >
        <span style={{ fontSize: 9, opacity: 0.7 }}>{open ? '▾' : '▸'}</span>
        {calls.length} tool{calls.length > 1 ? 's' : ''} used
      </button>
      {open && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
          {calls.map((c, i) => (
            <div key={i} style={{
              display: 'flex', alignItems: 'flex-start', gap: 6,
              background: 'var(--bg-2)', border: '1px solid var(--line-2)',
              borderRadius: 5, padding: '4px 8px',
              fontSize: 10, fontFamily: 'var(--font-mono)', color: 'var(--text-2)',
            }}>
              <span style={{ color: 'var(--text-3)', flexShrink: 0 }}>{TOOL_ICONS[c.tool] ?? '⚙'}</span>
              <span style={{ color: 'var(--action)', flexShrink: 0 }}>{c.tool}</span>
              {c.args && Object.keys(c.args).length > 0 && (
                <span style={{ color: 'var(--text-3)', wordBreak: 'break-all' }}>
                  {Object.values(c.args).map(String).join(' · ').slice(0, 120)}
                </span>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

// ─── Burbuja ──────────────────────────────────────────────────────────────────

function MessageBubble({ msg, onExpand }: {
  msg:       ChatMessage
  onExpand?: () => void
}) {
  const isUser = msg.role === 'user'
  return (
    <div style={{ display: 'flex', justifyContent: isUser ? 'flex-end' : 'flex-start', gap: 8, flexDirection: 'column', alignItems: isUser ? 'flex-end' : 'flex-start' }}>
      {!isUser && msg.tool_calls && msg.tool_calls.length > 0 && (
        <ToolCallChips calls={msg.tool_calls} />
      )}
      <div style={{ display: 'flex', justifyContent: isUser ? 'flex-end' : 'flex-start', gap: 8, width: '100%' }}>
        {!isUser && (
          <div style={{
            width: 26, height: 26, borderRadius: '50%', flexShrink: 0,
            border: '1px solid rgba(255,138,61,0.25)',
            background: 'rgba(255,138,61,0.12)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            marginTop: 2,
          }}>
            <img src="/forgy/forgyi.png" alt="Forge" style={{ width: 14, height: 14, objectFit: 'contain' }} />
          </div>
        )}
        <div style={{ maxWidth: isUser ? '80%' : '96%', position: 'relative' }}>
          <div style={{
            padding: '9px 13px',
            borderRadius: isUser ? '12px 12px 4px 12px' : '12px 12px 12px 4px',
            background: isUser
              ? 'color-mix(in srgb, var(--action) 16%, var(--bg-2))'
              : 'var(--bg-2)',
            border: `1px solid ${isUser
              ? 'color-mix(in srgb, var(--action) 30%, transparent)'
              : 'var(--line-2)'}`,
            fontSize: 12, color: 'var(--text-0)', lineHeight: 1.65,
            wordBreak: 'break-word',
          }}>
            {isUser ? (
              <span style={{ whiteSpace: 'pre-wrap' }}>{msg.content}</span>
            ) : (
              <div style={{ fontSize: 12, color: 'var(--text-0)', lineHeight: 1.65 }}>
                <ReactMarkdown remarkPlugins={[remarkGfm]} components={MD_COMPONENTS}>
                  {msg.content}
                </ReactMarkdown>
              </div>
            )}
          </div>

          {/* Botón expandir — solo en mensajes del asistente */}
          {!isUser && onExpand && (
            <button
              onClick={onExpand}
              title="Expand response"
              style={{
                position: 'absolute', top: 6, right: 6,
                width: 20, height: 20, borderRadius: 4,
                border: '1px solid var(--line-2)',
                background: 'var(--bg-3)',
                color: 'var(--text-3)', fontSize: 10,
                cursor: 'pointer', display: 'flex',
                alignItems: 'center', justifyContent: 'center',
                lineHeight: 1, padding: 0,
                opacity: 0, transition: 'opacity 120ms',
              }}
              className="msg-expand-btn"
            >
              ⊞
            </button>
          )}
        </div>
      </div>

      {/* Attachments del mensaje (historial) */}
      {isUser && msg.attachments && msg.attachments.length > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4, alignItems: 'flex-end', paddingRight: 0 }}>
          {msg.attachments.map((att, i) => (
            <AttachmentCard key={i} attachment={att} variant="history" />
          ))}
        </div>
      )}
    </div>
  )
}


// ─── NodeChatWindow ───────────────────────────────────────────────────────────

export interface ImageOutputDef {
  outputKey:      string
  format:         string
  imageGenModel:  string  // "provider:model" — ej: comfyui:concept_ref, openai:dall-e-3
}

export interface NodeChatWindowProps {
  stepKey:          string
  stepLabel:        string
  currentOutput:    unknown
  project:          Project
  locked:           boolean
  modelName?:       string | null
  initialMessages?:  ChatMessage[]
  onMessagesChange?: (msgs: ChatMessage[]) => void
  onApply?:          (data: unknown) => void
  validateOutput?:   (data: unknown) => string | null  // null = válido, string = mensaje de error
  onClose:           () => void
  // Si se provee, reemplaza la llamada interna a chatWithNode
  onSend?:          (userMessage: string, file?: File | null, attachmentUrl?: string) => Promise<{ reply: string; attachment?: ChatAttachment }>
  onAccept?:        (content: string) => Promise<void>
  docUrl?:          string
  docFormat?:       string
  approvedAsset?:       ApprovedAsset
  // Image gen por item
  imageGenOutputs?:     ImageOutputDef[]
  outputImages?:        OutputImagesMap
  onGenerateItemImage?: (outputKey: string, itemIndex: number, itemText: string, condition?: string) => Promise<{ image_url: string; output_images: OutputImagesMap }>
}

export default function NodeChatWindow({
  stepKey, stepLabel, currentOutput, project, locked, modelName,
  initialMessages, onMessagesChange, onApply, validateOutput, onClose, onSend, onAccept, docUrl, docFormat,
  approvedAsset, imageGenOutputs, outputImages: outputImagesProp, onGenerateItemImage,
}: NodeChatWindowProps) {
  const [messages,        setMessages]        = useState<ChatMessage[]>(initialMessages ?? [])
  const [input,           setInput]           = useState('')
  const [sending,         setSending]         = useState(false)
  const [applying,        setApplying]        = useState(false)
  const [accepting,       setAccepting]       = useState(false)
  const [error,           setError]           = useState<string | null>(null)
  const [expandedContent, setExpandedContent] = useState<{ content: string; imageItems?: InlineImageItem[]; pngImages?: OutputImagesMap } | null>(null)
  const [pendingFile,     setPendingFile]     = useState<File | null>(null)
  const [pendingUrl,      setPendingUrl]      = useState<string | null>(null)
  const [dropTarget,      setDropTarget]      = useState(false)
  const [outputImages,    setOutputImages]    = useState<OutputImagesMap>(outputImagesProp ?? {})
  const [generatingImgKeys, setGeneratingImgKeys] = useState<Set<string>>(new Set())  // set de "outputKey:index" en progreso
  const [zoomImageUrl,    setZoomImageUrl]    = useState<string | null>(null)

  // Posición y tamaño del modal — calculados tras mount para evitar SSR
  const [pos,        setPos]        = useState({ x: 0, y: 0 })
  const [size,       setSize]       = useState({ w: WINDOW_W, h: WINDOW_H })
  const [maximized,  setMaximized]  = useState(false)
  const [positioned, setPositioned] = useState(false)
  const [dragging,   setDragging]   = useState(false)
  const [resizing,   setResizing]   = useState(false)
  const dragOrigin   = useRef<{ sx: number; sy: number; ox: number; oy: number } | null>(null)
  const resizeOrigin = useRef<{ sx: number; sy: number; ow: number; oh: number } | null>(null)
  const savedGeom    = useRef<{ pos: { x: number; y: number }; size: { w: number; h: number } } | null>(null)
  // Ref para acceder al tamaño actual sin closure stale
  const sizeRef      = useRef({ w: WINDOW_W, h: WINDOW_H })

  const bottomRef  = useRef<HTMLDivElement>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)

  const inputRef = useRef<HTMLTextAreaElement>(null)

  // Posición y tamaño iniciales: lado derecho, centrado verticalmente
  useEffect(() => {
    const w = Math.min(WINDOW_W, window.innerWidth  - MARGIN * 2)
    const h = Math.min(WINDOW_H, window.innerHeight - MARGIN * 2)
    const x = Math.max(window.innerWidth  - w - MARGIN, MARGIN)
    const y = Math.max((window.innerHeight - h) / 2,    MARGIN)
    sizeRef.current = { w, h }
    setSize({ w, h })
    setPos({ x, y })
    setPositioned(true)
  }, [])

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages, sending])

  // Sincroniza el historial al padre para que persista entre aperturas
  useEffect(() => {
    if (messages.length > 0) onMessagesChange?.(messages)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [messages])

  useEffect(() => {
    if (!sending) inputRef.current?.focus()
  }, [sending])

  // ── Drag ──────────────────────────────────────────────────────────────────

  const onMouseMove = useCallback((e: MouseEvent) => {
    if (!dragOrigin.current) return
    const nx = dragOrigin.current.ox + e.clientX - dragOrigin.current.sx
    const ny = dragOrigin.current.oy + e.clientY - dragOrigin.current.sy
    // Clamp usando sizeRef para evitar closure stale
    setPos({
      x: Math.max(MARGIN, Math.min(nx, window.innerWidth  - sizeRef.current.w - MARGIN)),
      y: Math.max(MARGIN, Math.min(ny, window.innerHeight - sizeRef.current.h - MARGIN)),
    })
  }, [])

  const onMouseUp = useCallback(() => {
    dragOrigin.current = null
    setDragging(false)
    window.removeEventListener('mousemove', onMouseMove)
    window.removeEventListener('mouseup',   onMouseUp)
  }, [onMouseMove])

  const onDragStart = (e: React.MouseEvent) => {
    if (maximized) return
    e.preventDefault()
    dragOrigin.current = { sx: e.clientX, sy: e.clientY, ox: pos.x, oy: pos.y }
    setDragging(true)
    window.addEventListener('mousemove', onMouseMove)
    window.addEventListener('mouseup',   onMouseUp)
  }

  // ── Resize ────────────────────────────────────────────────────────────────

  const onResizeMove = useCallback((e: MouseEvent) => {
    if (!resizeOrigin.current) return
    const MIN_W = 300, MIN_H = 360
    const nw = Math.max(MIN_W, Math.min(resizeOrigin.current.ow + e.clientX - resizeOrigin.current.sx, window.innerWidth  - MARGIN))
    const nh = Math.max(MIN_H, Math.min(resizeOrigin.current.oh + e.clientY - resizeOrigin.current.sy, window.innerHeight - MARGIN))
    sizeRef.current = { w: nw, h: nh }
    setSize({ w: nw, h: nh })
  }, [])

  const onResizeEnd = useCallback(() => {
    resizeOrigin.current = null
    setResizing(false)
    window.removeEventListener('mousemove', onResizeMove)
    window.removeEventListener('mouseup',   onResizeEnd)
  }, [onResizeMove])

  const onResizeStart = (e: React.MouseEvent) => {
    e.preventDefault()
    e.stopPropagation()
    resizeOrigin.current = { sx: e.clientX, sy: e.clientY, ow: sizeRef.current.w, oh: sizeRef.current.h }
    setResizing(true)
    window.addEventListener('mousemove', onResizeMove)
    window.addEventListener('mouseup',   onResizeEnd)
  }

  // ── Maximizar ─────────────────────────────────────────────────────────────

  const toggleMaximize = () => {
    if (maximized) {
      // Restaurar geometría guardada
      const g = savedGeom.current
      if (g) {
        sizeRef.current = g.size
        setSize(g.size)
        setPos(g.pos)
      }
      setMaximized(false)
    } else {
      savedGeom.current = { pos, size }
      setMaximized(true)
    }
  }

  // ── Auto-generación de imágenes al recibir respuesta del asistente ──────────

  const triggerAutoImageGen = (content: string) => {
    if (!imageGenOutputs?.length || !onGenerateItemImage) return
    let fullMsgUsed = false
    const autoItems: Array<{ outputKey: string; idx: number; text: string; key: string }> = []

    // Fix 2: detectar si al menos un output tiene sección en este mensaje
    const anySectionFound = imageGenOutputs.some(def => {
      const esc = def.outputKey.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/_/g, '[_\\s]')
      return new RegExp(`^(?:#{1,4}\\s+)?${esc}\\s*$`, 'im').test(content)
    })

    for (const def of imageGenOutputs) {
      const isPng = def.format === 'png' || def.format === 'image'
      // Auto-gen solo para outputs PNG/image — otros formatos usan botón on-demand
      if (!isPng) continue
      const escaped = def.outputKey.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/_/g, '[_\\s]')
      const startRx = new RegExp(`^(?:#{1,4}\\s+)?${escaped}\\s*$`, 'im')
      const sectionMatch = startRx.exec(content)

      if (!sectionMatch && fullMsgUsed && !isPng) continue
      // Fix 2: PNG sin sección cuando otros SÍ tienen sección → no usar fallback al contenido completo
      if (!sectionMatch && isPng && anySectionFound) continue

      const otherEscaped = imageGenOutputs
        .filter(d => d.outputKey !== def.outputKey)
        .map(d => d.outputKey.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/_/g, '[_\\s]'))
      const nextRx = otherEscaped.length > 0
        ? new RegExp(`^(?:#{1,4}\\s+)?(?:${otherEscaped.join('|')})\\s*$`, 'im')
        : null
      const section = sectionMatch
        ? (() => {
            const after = content.slice(sectionMatch.index + sectionMatch[0].length)
            const next  = nextRx ? nextRx.exec(after) : null
            const s = (next ? after.slice(0, next.index) : after).trim()
            return s || content
          })()
        : content
      if (!sectionMatch && !isPng) fullMsgUsed = true

      parseOutputItems(section, def.format).forEach((text, idx) => {
        // Fix 1: no regenerar si ya existe imagen para este ítem
        const alreadySaved = (outputImages[def.outputKey] ?? []).some(s => s.index === idx && s.variations?.length > 0)
        if (alreadySaved) return
        autoItems.push({ outputKey: def.outputKey, idx, text, key: `${def.outputKey}:${idx}` })
      })
    }
    if (!autoItems.length) return
    setGeneratingImgKeys(new Set(autoItems.map(i => i.key)))
    for (const { outputKey, idx, text, key } of autoItems) {
      onGenerateItemImage(outputKey, idx, text)
        .then(r => setOutputImages(r.output_images))
        .catch(e => console.error('[auto-image-gen]', outputKey, idx, e))
        .finally(() => setGeneratingImgKeys(prev => { const n = new Set(prev); n.delete(key); return n }))
    }
  }

  // ── Chat ──────────────────────────────────────────────────────────────────

  const send = async () => {
    const text = input.trim()
    if (!text || sending) return
    const file    = pendingFile
    const urlAtt  = pendingUrl
    setMessages(prev => [...prev, { role: 'user', content: text }])
    setInput('')
    setPendingFile(null)
    setPendingUrl(null)
    setSending(true)
    setError(null)
    try {
      if (onSend) {
        const result = await onSend(text, file, urlAtt ?? undefined)
        setMessages(prev => {
          // Adjuntar info de attachment al último mensaje humano si la respuesta lo incluye
          const updated = result.attachment
            ? prev.map((m, i) => i === prev.length - 1 && m.role === 'user'
                ? { ...m, attachments: [result.attachment!] }
                : m
              )
            : [...prev]
          return [...updated, { role: 'assistant', content: result.reply }]
        })
        triggerAutoImageGen(result.reply)
      } else {
        const res = await chatWithNode(stepKey, messages, text, currentOutput, project.id)
        setMessages(prev => [...prev, { role: 'assistant', content: res.reply }])
        triggerAutoImageGen(res.reply)
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Error contacting assistant')
    } finally {
      setSending(false)
    }
  }

  // Extrae JSON de la conversación, valida y llama onApply
  const applyOutput = async () => {
    if (!onApply || applying || sending) return
    setApplying(true)
    setError(null)
    try {
      const { reply } = await chatWithNode(
        stepKey, messages,
        'Return the complete updated list as a raw JSON array only. No markdown fences, no explanations.',
        currentOutput, project.id, true,
      )
      // Limpiar posibles markdown fences que el LLM incluya de todas formas
      const clean = reply.replace(/```(?:json)?\s*/gi, '').replace(/```/g, '').trim()
      let parsed: unknown
      try {
        parsed = JSON.parse(clean)
      } catch {
        setError('The assistant did not return valid JSON. Ask it to list the items again before applying.')
        return
      }
      // Validar estructura esperada
      if (validateOutput) {
        const validationError = validateOutput(parsed)
        if (validationError) {
          setError(validationError)
          return
        }
      }
      onApply(parsed)
    } catch {
      setError('Could not contact the assistant. Try again.')
    } finally {
      setApplying(false)
    }
  }

  // Construye InlineImageItem[] desde cualquier contenido usando el estado actual de outputImages
  const buildItemsFromContent = (content: string): InlineImageItem[] | undefined => {
    if (!imageGenOutputs?.length || !onGenerateItemImage) return undefined
    const items: InlineImageItem[] = []
    let fullMsgUsed = false
    for (const def of imageGenOutputs) {
      const isPng = def.format === 'png' || def.format === 'image'
      const escaped = def.outputKey.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/_/g, '[_\\s]')
      const startRx = new RegExp(`^(?:#{1,4}\\s+)?${escaped}\\s*$`, 'im')
      const sectionMatch = startRx.exec(content)
      if (!sectionMatch && fullMsgUsed && !isPng) continue
      const otherEscaped = imageGenOutputs.filter(d => d.outputKey !== def.outputKey)
        .map(d => d.outputKey.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/_/g, '[_\\s]'))
      const nextRx = otherEscaped.length > 0
        ? new RegExp(`^(?:#{1,4}\\s+)?(?:${otherEscaped.join('|')})\\s*$`, 'im') : null
      const section = sectionMatch
        ? (() => {
            const after = content.slice(sectionMatch.index + sectionMatch[0].length)
            const next = nextRx ? nextRx.exec(after) : null
            const s = (next ? after.slice(0, next.index) : after).trim()
            return s || content
          })()
        : content
      if (!sectionMatch && !isPng) fullMsgUsed = true
      const parsed = parseOutputItems(section, def.format)
      const savedList = outputImages[def.outputKey] ?? []
      for (let idx = 0; idx < parsed.length; idx++) {
        const itemText = parsed[idx]
        const saved = savedList.find(s => s.index === idx)
        const variations = saved?.variations ?? []
        const key = `${def.outputKey}:${idx}`
        items.push({
          itemKey: key, index: idx, text: itemText,
          imageUrl: variations.at(-1)?.url ?? null,
          allVariations: variations,
          isGenerating: generatingImgKeys.has(key),
          onZoom: url => setZoomImageUrl(url),
          onGenerate: async (condition?: string) => {
            setGeneratingImgKeys(prev => new Set(prev).add(key))
            try {
              const r = await onGenerateItemImage(def.outputKey, idx, itemText, condition)
              setOutputImages(r.output_images)
            } catch (e) {
              setError(e instanceof Error ? e.message : 'Image generation failed')
            } finally {
              setGeneratingImgKeys(prev => { const n = new Set(prev); n.delete(key); return n })
            }
          },
        })
      }
    }
    return items.length > 0 ? items : undefined
  }

  if (!positioned) return null

  return (
    <>
      <style>{KEYFRAMES}</style>

      {/* Ventana flotante — sin overlay, no bloquea el modal de fondo */}
      <div style={{
        position:     'fixed',
        left:         maximized ? 0 : pos.x,
        top:          maximized ? 0 : pos.y,
        zIndex:       110,
        width:        maximized ? '100vw' : size.w,
        height:       maximized ? '100vh' : size.h,
        background:   'var(--bg-1)',
        borderRadius: maximized ? 0 : 14,
        border:       '1px solid var(--line-2)',
        boxShadow:    maximized ? 'none' : '0 24px 64px rgba(0,0,0,0.55), 0 0 0 1px rgba(255,255,255,0.04)',
        display:      'flex', flexDirection: 'column', overflow: 'hidden',
        userSelect:   dragging || resizing ? 'none' : 'auto',
        transition:   maximized ? 'none' : undefined,
      }}>

        {/* Header — drag handle */}
        <div
          onMouseDown={onDragStart}
          style={{
            padding: '12px 14px',
            borderBottom: '1px solid var(--line-2)',
            display: 'flex', alignItems: 'center', gap: 10,
            flexShrink: 0,
            background: 'var(--bg-2)',
            cursor: dragging ? 'grabbing' : 'grab',
          }}
        >
          <div style={{
            width: 30, height: 30, borderRadius: '50%', flexShrink: 0,
            border: '1px solid rgba(255,138,61,0.25)',
            background: 'rgba(255,138,61,0.12)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}>
            <img src="/forgy/forgyi.png" alt="Forge" style={{ width: 16, height: 16, objectFit: 'contain' }} />
          </div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--text-0)', lineHeight: 1.2 }}>
              Forge Assistant
            </div>
            <div style={{ fontSize: 9, fontFamily: 'var(--font-mono)', color: 'var(--text-3)', marginTop: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {stepLabel}
            </div>
          </div>
          {locked && (
            <span style={{
              fontSize: 9, fontFamily: 'var(--font-mono)', fontWeight: 600,
              padding: '2px 7px', borderRadius: 4, flexShrink: 0,
              background: 'rgba(52,211,153,0.10)', color: '#34D399',
              border: '1px solid rgba(52,211,153,0.20)',
            }}>
              ✓ Read only
            </span>
          )}
          {/* Grip — mano blanca, igual al cursor grab del modal */}
          <span style={{ fontSize: 15, flexShrink: 0, lineHeight: 1, opacity: 0.55, userSelect: 'none', filter: 'brightness(0) invert(1)' }}>🖐️</span>
          {/* Botón maximizar */}
          <button
            onMouseDown={e => e.stopPropagation()}
            onClick={toggleMaximize}
            title={maximized ? 'Restore' : 'Maximize'}
            style={{
              border: 'none', background: 'var(--bg-3)', cursor: 'pointer',
              color: 'var(--text-2)', fontSize: 11, padding: '4px 7px',
              borderRadius: 5, lineHeight: 1, flexShrink: 0,
            }}
          >
            {maximized ? '⊡' : '⊞'}
          </button>
          <button
            onMouseDown={e => e.stopPropagation()}
            onClick={onClose}
            style={{
              border: 'none', background: 'var(--bg-3)', cursor: 'pointer',
              color: 'var(--text-2)', fontSize: 12, padding: '4px 8px',
              borderRadius: 5, lineHeight: 1, flexShrink: 0,
            }}
          >
            ✕
          </button>
        </div>

        {/* Input de archivo oculto */}
        <input
          ref={fileInputRef}
          type="file"
          accept=".pdf,.doc,.docx,.ppt,.pptx,.txt,.md,.json,image/*"
          style={{ display: 'none' }}
          onChange={e => {
            const f = e.target.files?.[0] ?? null
            if (f) { setPendingFile(f); setPendingUrl(null) }
            e.target.value = ''
          }}
        />

        {/* Mensajes */}
        <div
          style={{
            flex: '1 1 0', minHeight: 0, overflowY: 'auto',
            padding: '16px 14px',
            display: 'flex', flexDirection: 'column', gap: 12,
            position: 'relative',
            outline: dropTarget ? '2px dashed var(--action)' : 'none',
            outlineOffset: -4,
            transition: 'outline 120ms',
          }}
          onDragOver={e => { e.preventDefault(); setDropTarget(true) }}
          onDragLeave={() => setDropTarget(false)}
          onDrop={e => {
            e.preventDefault()
            setDropTarget(false)
            const f = e.dataTransfer.files[0]
            if (f) { setPendingFile(f); setPendingUrl(null) }
          }}
        >
          {messages.length === 0 && (
            <div style={{ margin: 'auto', textAlign: 'center', maxWidth: 280, padding: '12px 0', display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
              <img src="/forgy/forgyi.png" alt="Forge" style={{ width: 36, height: 36, objectFit: 'contain', marginBottom: 10, opacity: 0.6 }} />
              <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--text-0)', marginBottom: 6, lineHeight: 1.3 }}>
                {locked ? 'Ask about this output' : 'How can I help?'}
              </div>
              <div style={{ fontSize: 11, color: 'var(--text-2)', lineHeight: 1.6 }}>
                {locked
                  ? 'Step is approved. You can ask questions but changes are disabled.'
                  : 'Ask me to adjust tone, focus, constraints, or explain my reasoning.'}
              </div>
            </div>
          )}

          {messages.map((msg, i) => {
            if (msg.role !== 'assistant') {
              return <MessageBubble key={i} msg={msg} />
            }

            // Solo el último mensaje del asistente muestra el grid de imágenes
            const isLastAssistant = messages.slice(i + 1).every(m => m.role !== 'assistant')

            // Para mensajes del asistente: construir imageItems para el modal expandido
            const buildItems = (): InlineImageItem[] | undefined => {
              if (!imageGenOutputs || imageGenOutputs.length === 0 || !onGenerateItemImage) return undefined
              const items: InlineImageItem[] = []
              let fullMsgUsed = false  // evita agregar ítems duplicados cuando múltiples outputs usan el msg completo

              for (const def of imageGenOutputs) {
                const isPng = def.format === 'png' || def.format === 'image'
                const escaped = def.outputKey.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
                                             .replace(/_/g, '[_\\s]')  // "concept_list" también matchea "concept list"
                const startRx     = new RegExp(`^(?:#{1,4}\\s+)?${escaped}\\s*$`, 'im')
                const sectionMatch = startRx.exec(msg.content)

                // PNG outputs nunca se saltan: cada output imagen genera su propia imagen independientemente
                if (!sectionMatch && fullMsgUsed && !isPng) continue

                // nextRx dinámico: solo cortar en otras claves conocidas, nunca en headings arbitrarios
                const otherEscaped = imageGenOutputs
                  .filter(d => d.outputKey !== def.outputKey)
                  .map(d => d.outputKey.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/_/g, '[_\\s]'))
                const nextRx = otherEscaped.length > 0
                  ? new RegExp(`^(?:#{1,4}\\s+)?(?:${otherEscaped.join('|')})\\s*$`, 'im')
                  : null

                const section = sectionMatch
                  ? (() => {
                      const after = msg.content.slice(sectionMatch.index + sectionMatch[0].length)
                      const next  = nextRx ? nextRx.exec(after) : null
                      const s = (next ? after.slice(0, next.index) : after).trim()
                      return s || msg.content  // sección vacía → fallback a mensaje completo
                    })()
                  : msg.content

                // Solo marcar fullMsgUsed para outputs no-imagen
                if (!sectionMatch && !isPng) fullMsgUsed = true

                const parsed = parseOutputItems(section, def.format)

                const savedList = outputImages[def.outputKey] ?? []
                for (let idx = 0; idx < parsed.length; idx++) {
                  const itemText   = parsed[idx]
                  const saved      = savedList.find(s => s.index === idx)
                  const variations = saved?.variations ?? []
                  const key        = `${def.outputKey}:${idx}`
                  items.push({
                    itemKey:      key,
                    index:        idx,
                    text:         itemText,
                    imageUrl:     variations.at(-1)?.url ?? null,
                    allVariations: variations,
                    isGenerating: generatingImgKeys.has(key),
                    onZoom:       url => setZoomImageUrl(url),
                    onGenerate:   async (condition?: string) => {
                      setGeneratingImgKeys(prev => new Set(prev).add(key))
                      try {
                        const r = await onGenerateItemImage(def.outputKey, idx, itemText, condition)
                        setOutputImages(r.output_images)
                      } catch (e) {
                        setError(e instanceof Error ? e.message : 'Image generation failed')
                      } finally {
                        setGeneratingImgKeys(prev => { const n = new Set(prev); n.delete(key); return n })
                      }
                    },
                  })
                }
              }
              return items.length > 0 ? items : undefined
            }

            // Computar items una vez: se usa para el grid inline y para el expand modal
            const imageItems = isLastAssistant ? buildItems() : undefined

            return (
              <React.Fragment key={i}>
                <MessageBubble
                  msg={msg}
                  onExpand={() => setExpandedContent({ content: msg.content, imageItems: imageItems ?? buildItems(), pngImages: outputImages })}
                />
                {isLastAssistant && <ImageThumbnailRow items={imageItems} />}
              </React.Fragment>
            )
          })}

          {sending && (
            <div style={{ display: 'flex', gap: 8 }}>
              <div style={{
                width: 26, height: 26, borderRadius: 7, flexShrink: 0,
                background: 'rgba(255,138,61,0.15)',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
              }}>
                <img src="/forgy/forgyi.png" alt="Forge" style={{ width: 16, height: 16, objectFit: 'contain' }} />
              </div>
              <div style={{
                padding: '9px 13px', borderRadius: '12px 12px 12px 4px',
                background: 'var(--bg-2)', border: '1px solid var(--line-2)',
              }}>
                <TypingDots />
              </div>
            </div>
          )}

          {error && (
            <div style={{
              fontSize: 11, color: '#F87171', lineHeight: 1.5,
              padding: '8px 12px', borderRadius: 8,
              background: 'rgba(248,113,113,0.07)',
              border: '1px solid rgba(248,113,113,0.20)',
            }}>
              {error}
            </div>
          )}

          {/* Card de asset aprobado — visible cuando la sesión está locked */}
          {locked && approvedAsset && (
            <div style={{
              margin: '12px 0 4px',
              padding: '10px 12px',
              borderRadius: 8,
              background: 'color-mix(in srgb, #34D399 8%, var(--bg-2))',
              border: '1px solid color-mix(in srgb, #34D399 30%, transparent)',
              display: 'flex', flexDirection: 'column', gap: 6,
            }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <span style={{ color: '#34D399', fontSize: 11 }}>✓</span>
                <span style={{ fontFamily: 'var(--font-mono)', fontSize: 11, fontWeight: 700, color: 'var(--text-0)', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {approvedAsset.name}
                </span>
                <span style={{ fontFamily: 'var(--font-mono)', fontSize: 9, color: 'var(--text-3)', textTransform: 'uppercase', letterSpacing: '.06em', flexShrink: 0 }}>
                  {approvedAsset.format}
                </span>
              </div>
              <div style={{ display: 'flex', gap: 6 }}>
                {approvedAsset.storage_url && (
                  <a
                    href={approvedAsset.storage_url}
                    target="_blank"
                    rel="noopener noreferrer"
                    style={{
                      flex: 1, padding: '5px 0', borderRadius: 5, textDecoration: 'none', textAlign: 'center',
                      background: 'color-mix(in srgb, #34D399 15%, var(--bg-2))',
                      border: '1px solid color-mix(in srgb, #34D399 35%, transparent)',
                      color: '#34D399', fontSize: 10, fontFamily: 'var(--font-mono)', fontWeight: 600,
                    }}
                  >
                    Open ↗
                  </a>
                )}
                {approvedAsset.storage_url && (
                  <a
                    href={approvedAsset.storage_url}
                    download
                    style={{
                      flex: 1, padding: '5px 0', borderRadius: 5, textDecoration: 'none', textAlign: 'center',
                      background: 'var(--bg-3)',
                      border: '1px solid var(--line-2)',
                      color: 'var(--text-2)', fontSize: 10, fontFamily: 'var(--font-mono)', fontWeight: 600,
                    }}
                  >
                    ↓ Download
                  </a>
                )}
              </div>
            </div>
          )}

          <div ref={bottomRef} />
        </div>

        {/* Chip de descarga de PDF — aparece tras doc_gen_docx */}
        {docUrl && (
          <div style={{ padding: '6px 12px 0', borderTop: '1px solid var(--line-2)', background: 'var(--bg-2)' }}>
            <a
              href={docUrl}
              target="_blank"
              rel="noopener noreferrer"
              style={{
                display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
                width: '100%', padding: '7px 0', borderRadius: 6, textDecoration: 'none',
                background: 'color-mix(in srgb, #F59E0B 12%, var(--bg-2))',
                border: '1px solid color-mix(in srgb, #F59E0B 40%, transparent)',
                color: '#F59E0B',
                fontSize: 11, fontFamily: 'var(--font-mono)', fontWeight: 700,
                letterSpacing: '.04em', transition: 'all 120ms',
              }}
            >
              ↓ Download {docFormat === 'pptx' ? 'PPTX' : 'PDF'}
            </a>
          </div>
        )}

        {/* Botón Accept — convierte el último output en forge_asset aprobado */}
        {onAccept && messages.some(m => m.role === 'assistant') && !locked && (
          <div style={{ padding: '6px 12px 0', borderTop: docUrl ? 'none' : '1px solid var(--line-2)', background: 'var(--bg-2)' }}>
            <button
              onClick={async () => {
                const lastAssistant = [...messages].reverse().find(m => m.role === 'assistant')
                if (!lastAssistant || accepting || sending) return
                setAccepting(true)
                setError(null)
                try {
                  await onAccept(lastAssistant.content)
                } catch (err) {
                  setError(err instanceof Error ? err.message : 'Error accepting output')
                } finally {
                  setAccepting(false)
                }
              }}
              disabled={accepting || sending}
              style={{
                width: '100%', padding: '7px 0', borderRadius: 6, border: 'none',
                background: accepting || sending ? 'var(--bg-4)' : '#34D399',
                color: accepting || sending ? 'var(--text-3)' : '#0a2e1f',
                fontSize: 11, fontFamily: 'var(--font-mono)', fontWeight: 700,
                cursor: accepting || sending ? 'not-allowed' : 'pointer',
                letterSpacing: '.04em', transition: 'all 120ms',
              }}
            >
              {accepting ? '⟳ Accepting…' : '✓ Accept as output'}
            </button>
          </div>
        )}

        {/* Botón Apply — visible cuando hay conversación y onApply está definido */}
        {onApply && messages.length > 0 && messages.some(m => m.role === 'assistant') && (
          <div style={{ padding: '6px 12px', borderTop: '1px solid var(--line-2)', background: 'var(--bg-2)' }}>
            <button
              onClick={applyOutput}
              disabled={applying || sending || locked}
              style={{
                width: '100%', padding: '6px 0', borderRadius: 6, border: '1px solid',
                borderColor: applying || sending || locked ? 'var(--line-2)' : 'color-mix(in srgb, var(--action) 50%, transparent)',
                background: applying || sending || locked ? 'var(--bg-3)' : 'color-mix(in srgb, var(--action) 10%, var(--bg-2))',
                color: applying || sending || locked ? 'var(--text-4)' : 'var(--action)',
                fontSize: 11, fontFamily: 'var(--font-mono)', fontWeight: 600,
                cursor: applying || sending || locked ? 'not-allowed' : 'pointer',
                transition: 'all 120ms',
              }}
            >
              {applying ? 'Applying…' : '↑ Apply as output'}
            </button>
          </div>
        )}

        {/* Input — 30% de la altura de la ventana */}
        <div style={{
          flex: '0 0 30%', minHeight: 0,
          padding: '8px 12px 10px', borderTop: '1px solid var(--line-2)',
          display: 'flex', flexDirection: 'column', gap: 6,
          background: 'var(--bg-2)',
          overflowY: 'auto',
        }}>

          {/* Attachment pendiente — visible antes de enviar */}
          {(pendingFile || pendingUrl) && (
            <div style={{ paddingBottom: 2 }}>
              <AttachmentCard
                attachment={{
                  file_name:       pendingFile ? pendingFile.name : (pendingUrl ?? ''),
                  mime_type:       pendingFile ? pendingFile.type || null : 'text/uri-list',
                  file_size_bytes: pendingFile ? pendingFile.size : null,
                  storage_url:     pendingUrl ?? '',
                }}
                variant="composing"
                onRemove={() => { setPendingFile(null); setPendingUrl(null) }}
              />
            </div>
          )}

          <div style={{ display: 'flex', gap: 7, flex: '1 1 0', minHeight: 0 }}>
            <textarea
              ref={inputRef}
              value={input}
              onChange={e => setInput(e.target.value)}
              onKeyDown={e => {
                if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send() }
              }}
              onPaste={e => {
                // Detectar URL pegada — convertir en attachment de URL
                const text = e.clipboardData.getData('text').trim()
                if (/^https?:\/\/\S+$/.test(text) && !input.trim()) {
                  e.preventDefault()
                  setPendingUrl(text)
                  setPendingFile(null)
                }
              }}
              disabled={sending || locked}
              placeholder={locked
                ? 'Step is approved — read only'
                : 'Ask or describe an adjustment… (Enter to send, or paste a URL / drop a file)'}
              style={{
                flex: '1 1 0', resize: 'none', overflow: 'auto',
                background: 'var(--bg-1)', border: '1px solid var(--line-2)',
                borderRadius: 8, padding: '8px 11px',
                color: 'var(--text-0)', fontSize: 12, lineHeight: 1.5,
                outline: 'none', fontFamily: 'inherit',
                opacity: locked ? 0.4 : 1,
                transition: 'border-color 120ms',
                minHeight: 0,
              }}
              onFocus={e => { if (!locked) e.currentTarget.style.borderColor = 'var(--action)' }}
              onBlur={e => { e.currentTarget.style.borderColor = 'var(--line-2)' }}
            />
            {/* Botones derechos: clip (20%) + send (80%) apilados */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 5, flexShrink: 0, alignSelf: 'stretch', width: 38 }}>
              {!locked && (
                <button
                  onClick={() => fileInputRef.current?.click()}
                  title="Attach file"
                  disabled={sending}
                  style={{
                    flex: '0 0 20%', width: '100%', borderRadius: 7, border: '1px solid var(--line-2)',
                    background: pendingFile || pendingUrl ? 'color-mix(in srgb, var(--action) 14%, var(--bg-3))' : 'var(--bg-3)',
                    color: pendingFile || pendingUrl ? 'var(--action)' : 'var(--text-3)',
                    cursor: sending ? 'not-allowed' : 'pointer',
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    transition: 'all 120ms',
                    opacity: sending ? 0.4 : 1,
                  }}
                >
                  <Paperclip size={15} strokeWidth={1.75} />
                </button>
              )}
              <button
                onClick={send}
                disabled={sending || !input.trim() || locked}
                style={{
                  flex: '1 1 0', width: '100%', borderRadius: 8, border: 'none',
                  background: sending || !input.trim() || locked ? 'var(--bg-3)' : 'var(--action)',
                  color:  sending || !input.trim() || locked ? 'var(--text-4)' : 'var(--action-fg)',
                  fontSize: 18, cursor: sending || !input.trim() || locked ? 'not-allowed' : 'pointer',
                  transition: 'background 120ms',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                }}
              >
                →
              </button>
            </div>
          </div>
        </div>

        {/* Modelo configurado para este step */}
        {modelName && (
          <div style={{
            padding: '5px 12px', borderTop: '1px solid var(--line-2)',
            background: 'var(--bg-2)',
            fontSize: 9, fontFamily: 'var(--font-mono)', color: 'var(--text-4)',
            textAlign: 'center', letterSpacing: '0.04em',
          }}>
            {modelName}
          </div>
        )}

        {/* Handle de resize — esquina inferior derecha, oculto en maximizado */}
        {!maximized && (
          <div
            onMouseDown={onResizeStart}
            style={{
              position: 'absolute', bottom: 0, right: 0,
              width: 18, height: 18, cursor: 'se-resize',
              display: 'flex', alignItems: 'flex-end', justifyContent: 'flex-end',
              padding: 4,
            }}
          >
            <svg width="10" height="10" viewBox="0 0 10 10" style={{ opacity: 0.3 }}>
              <line x1="2" y1="10" x2="10" y2="2" stroke="var(--text-1)" strokeWidth="1.5" strokeLinecap="round"/>
              <line x1="5" y1="10" x2="10" y2="5" stroke="var(--text-1)" strokeWidth="1.5" strokeLinecap="round"/>
              <line x1="8" y1="10" x2="10" y2="8" stroke="var(--text-1)" strokeWidth="1.5" strokeLinecap="round"/>
            </svg>
          </div>
        )}
      </div>

      {/* Modal de lectura expandida */}
      {expandedContent && (
        <div
          onClick={() => setExpandedContent(null)}
          style={{
            position: 'fixed', inset: 0, zIndex: 200,
            background: 'rgba(0,0,0,0.65)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            padding: 32,
          }}
        >
          <div
            onClick={e => e.stopPropagation()}
            style={{
              background: 'var(--bg-1)',
              border: '1px solid var(--line-2)',
              borderRadius: 12,
              width: '100%', maxWidth: 860,
              maxHeight: '88vh',
              display: 'flex', flexDirection: 'column',
              boxShadow: '0 32px 80px rgba(0,0,0,0.7)',
              overflow: 'hidden',
            }}
          >
            {/* Header */}
            <div style={{
              padding: '12px 16px', borderBottom: '1px solid var(--line-2)',
              display: 'flex', alignItems: 'center', gap: 10,
              flexShrink: 0, background: 'var(--bg-2)',
            }}>
              <span style={{ fontSize: 11, fontFamily: 'var(--font-mono)', color: 'var(--text-3)', textTransform: 'uppercase', letterSpacing: '.08em', flex: 1 }}>
                {stepLabel}
              </span>
              {docUrl && (
                <a
                  href={docUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  onClick={e => e.stopPropagation()}
                  style={{
                    fontSize: 9, fontFamily: 'var(--font-mono)', fontWeight: 700,
                    color: '#F59E0B', textDecoration: 'none',
                    padding: '3px 10px', border: '1px solid color-mix(in srgb, #F59E0B 50%, transparent)',
                    borderRadius: 4, letterSpacing: '.04em', flexShrink: 0,
                  }}
                >
                  ↓ {docFormat === 'pptx' ? 'PPTX' : 'PDF'}
                </a>
              )}
              <button
                onClick={() => setExpandedContent(null)}
                style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-3)', fontSize: 16, lineHeight: 1, padding: '2px 6px', flexShrink: 0 }}
              >
                ✕
              </button>
            </div>

            {/* Contenido */}
            {(() => {
              // Items siempre frescos desde el estado actual de outputImages
              const expandedItems = buildItemsFromContent(expandedContent.content)
              const hasThumbs = expandedItems?.some(i => i.imageUrl || i.isGenerating) ?? false
              return (
                <div style={{ flex: 1, overflowY: 'auto', padding: '24px 32px' }}>
                  <div style={{ fontSize: 13, color: 'var(--text-0)', lineHeight: 1.7 }}>
                    <ReactMarkdown
                      remarkPlugins={[remarkGfm]}
                      components={expandedItems?.length ? buildImageGenComponents(expandedItems) : MD_COMPONENTS}
                    >
                      {expandedContent.content}
                    </ReactMarkdown>
                  </div>

                </div>
              )
            })()}
          </div>
        </div>
      )}

      {/* Zoom overlay de imagen generada */}
      {zoomImageUrl && (
        <div
          onClick={() => setZoomImageUrl(null)}
          style={{
            position: 'fixed', inset: 0, zIndex: 300,
            background: 'rgba(0,0,0,0.82)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            padding: 32, cursor: 'zoom-out',
          }}
        >
          <img
            src={zoomImageUrl}
            alt="Generated"
            onClick={e => e.stopPropagation()}
            style={{
              maxWidth: '90vw', maxHeight: '85vh',
              borderRadius: 10, boxShadow: '0 24px 80px rgba(0,0,0,0.7)',
              cursor: 'default',
            }}
          />
          <button
            onClick={() => setZoomImageUrl(null)}
            style={{
              position: 'absolute', top: 20, right: 20,
              background: 'rgba(255,255,255,0.1)', border: '1px solid rgba(255,255,255,0.2)',
              borderRadius: 6, color: '#fff', fontSize: 14, padding: '4px 10px',
              cursor: 'pointer',
            }}
          >
            ✕
          </button>
        </div>
      )}
    </>
  )
}
