'use client'

import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { BACKEND_URL, authHeaders } from '@/lib/api'
import { MD_COMPONENTS } from '@/lib/md-components'
import { jsonToCards } from '@/lib/json-display'

// ─── Types ────────────────────────────────────────────────────────────────────

type TextCard  = { kind: 'text';  title: string; body: string }
type ImageCard = { kind: 'image'; label: string; url: string }
type DeckCard  = TextCard | ImageCard

type DeckState =
  | { status: 'loading' }
  | { status: 'empty' }
  | { status: 'ready'; cards: DeckCard[] }

// ─── Caché de sesión para evitar re-fetches en cada hover ────────────────────
const CACHE = new Map<string, DeckCard[]>()

export function invalidateAssetDeckCache(projectId: string, nodeId: string) {
  CACHE.delete(`${projectId}:${nodeId}`)
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function fanParams(index: number, total: number): { rot: number; tx: number } {
  const maxRot = Math.min(28, total * 7)
  const maxTx  = Math.min(72, total * 18)
  const t = total === 1 ? 0.5 : index / (total - 1)
  return { rot: -maxRot + t * 2 * maxRot, tx: -maxTx + t * 2 * maxTx }
}

// Divide markdown por secciones ## — cada sección = una carta
// Secciones wrapper de output format que se omiten si están vacías
const OUTPUT_WRAPPER_RE = /^(investor_deck|output|result|response|deck)$/i

// Si un body es una lista pura de 4+ items bullet, expande a sub-cartas individuales
function expandListItems(title: string, body: string): TextCard[] {
  const lines = body.split('\n').filter(s => s.trim())
  const allBullets = lines.length >= 4 && lines.every(l => /^[-*•]\s/.test(l.trim()))
  if (!allBullets) return [{ kind: 'text', title, body }]
  const items = lines

  return items.map(item => {
    const raw      = item.replace(/^[-*•]\s+/, '').replace(/^\*\*/, '').replace(/\*\*$/, '')
    const dashIdx  = raw.search(/\s+[—–]\s+/)
    if (dashIdx > 0) {
      return { kind: 'text' as const,
        title: raw.slice(0, dashIdx).replace(/\*\*/g, '').trim(),
        body:  raw.slice(dashIdx).replace(/^\s*[—–]\s*/, '').trim() }
    }
    const colonIdx = raw.indexOf(': ')
    if (colonIdx > 0 && colonIdx < 50) {
      return { kind: 'text' as const,
        title: raw.slice(0, colonIdx).replace(/\*\*/g, '').trim(),
        body:  raw.slice(colonIdx + 2).trim() }
    }
    return { kind: 'text' as const, title: raw.slice(0, 60).trim(), body: raw }
  })
}

function splitMarkdown(content: string): TextCard[] {
  const parts = content.split(/^(?=##\s)/m).filter(s => s.trim())
  const cards: TextCard[] = []

  // Preamble antes del primer ## (puede no tener heading)
  const hasPreamble = parts.length > 0 && !parts[0].startsWith('##')
  if (hasPreamble) {
    cards.push(...expandListItems('Overview', parts[0].trim()))
  }

  for (let i = hasPreamble ? 1 : 0; i < parts.length; i++) {
    const lines = parts[i].trim().split('\n')
    const title = lines[0].replace(/^##\s+/, '').trim()
    const body  = lines.slice(1).join('\n').trim()
    // Omitir secciones wrapper vacías (investor_deck, output, etc.)
    if (title && OUTPUT_WRAPPER_RE.test(title) && !body) continue
    if (title) cards.push(...expandListItems(title, body))
  }

  // Sin secciones — todo el texto como una carta
  if (cards.length === 0 && content.trim()) {
    cards.push({ kind: 'text', title: 'Output', body: content.trim() })
  }

  return cards
}

// ─── Constantes de layout ─────────────────────────────────────────────────────

const MAX_FAN     = 5
const DECK_HEIGHT = 200
const CARD_W      = 108

// ─── Componente ───────────────────────────────────────────────────────────────

interface Props {
  nodeId:          string
  projectNodeId:   string   // la INSTANCIA: con fan-out el mismo nodo vive en varios lanes
  projectId:       string
  anchorX:         number   // centro X del nodo en coords de pantalla
  anchorY:         number   // top Y del nodo en coords de pantalla
  onKeepOpen:      () => void
  onScheduleClose: () => void
}

export default function AssetCardDeck({
  nodeId, projectNodeId, projectId, anchorX, anchorY, onKeepOpen, onScheduleClose,
}: Props) {
  const [deck,     setDeck]     = useState<DeckState>({ status: 'loading' })
  const [hovered,  setHovered]  = useState<number | null>(null)
  const [expanded, setExpanded] = useState<DeckCard | null>(null)

  // Cerrar modal expandido con Escape
  useEffect(() => {
    if (!expanded) return
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') { setExpanded(null); onScheduleClose() } }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [expanded, onScheduleClose])

  // Cargar asset al montar — con caché
  useEffect(() => {
    let cancelled = false
    // La caché va por instancia: con la clave por nodo, los dos lanes compartían baraja.
    const key = `${projectId}:${nodeId}:${projectNodeId}`
    const cached = CACHE.get(key)

    // Solo usar caché si tiene contenido — resultados vacíos se reintentan siempre
    if (cached !== undefined && cached.length > 0) {
      setDeck({ status: 'ready', cards: cached })
      return
    }

    async function load() {
      try {
        const res  = await fetch(
          `${BACKEND_URL}/api/projects/${projectId}/canvas/nodes/${nodeId}/session?project_node_id=${projectNodeId}`,
          { headers: await authHeaders() },
        )
        const data = await res.json()

        if (!data.success) {
          if (!cancelled) setDeck({ status: 'empty' })
          return
        }

        // Cards de texto del asset aprobado
        let textCards: DeckCard[] = []
        if (data.asset) {
          const { format, content, storage_url, name } = data.asset
          if (content && format !== 'png') {
            // JSON → una card por objeto con título = el output real (seed title, etc.);
            // si no es JSON, se usa el split de markdown normal por secciones ##.
            const jsonCards = jsonToCards(content)
            textCards = jsonCards
              ? jsonCards.map(c => ({ kind: 'text' as const, title: c.title, body: c.body }))
              : splitMarkdown(content)
          } else if (storage_url && format === 'png') {
            textCards = [{ kind: 'image', label: name ?? 'Asset', url: storage_url }]
          }
        }

        // Cards de imágenes aprobadas (forge_assets)
        const assetImageCards: DeckCard[] = (data.image_assets ?? [])
          .filter((img: { storage_url?: string }) => img.storage_url)
          .map((img: { name?: string; storage_url: string }) => ({
            kind:  'image' as const,
            label: img.name ?? 'Image',
            url:   img.storage_url,
          }))

        // Cards de variaciones generadas por ítem (última variación de cada ítem)
        const outputImages: Record<string, Array<{ index: number; variations?: Array<{ url: string }> }>> =
          data.session?.output_images ?? {}
        const outputImageCards: DeckCard[] = []
        for (const [outputKey, items] of Object.entries(outputImages)) {
          for (const item of items) {
            const lastVar = item.variations?.at(-1)
            if (lastVar?.url) {
              outputImageCards.push({
                kind:  'image' as const,
                label: `${outputKey} #${item.index + 1}`,
                url:   lastVar.url,
              })
            }
          }
        }

        // Deduplicar: si una URL ya está en outputImageCards, omitirla de assetImageCards
        const outputUrls = new Set(outputImageCards.map(c => (c as ImageCard).url))
        const uniqueAssetCards = assetImageCards.filter(c => !outputUrls.has((c as ImageCard).url))

        // Imágenes generadas primero, luego assets únicos, luego texto para llenar los slots
        const cards: DeckCard[] = [...outputImageCards, ...uniqueAssetCards, ...textCards]

        if (!cancelled) {
          CACHE.set(key, cards)
          setDeck(cards.length > 0 ? { status: 'ready', cards } : { status: 'empty' })
        }
      } catch {
        if (!cancelled) setDeck({ status: 'empty' })
      }
    }

    load()
    return () => { cancelled = true }
  }, [nodeId, projectId, projectNodeId])

  if (deck.status === 'empty') return null

  const isLoading = deck.status === 'loading'
  const allCards  = isLoading
    ? Array.from({ length: 3 }, (): DeckCard => ({ kind: 'text', title: '···', body: '' }))
    : deck.cards

  const fanCards = allCards.slice(0, MAX_FAN)
  const overflow = !isLoading && allCards.length > MAX_FAN ? allCards.length - MAX_FAN : 0
  const cards = overflow > 0
    ? [...fanCards.slice(0, MAX_FAN - 1), { kind: 'text' as const, title: `+${overflow + 1} more`, body: '' }]
    : fanCards

  return createPortal(
    <>
      {/* Abanico de cartas — portal para escapar overflow:hidden del canvas */}
      <div
        onMouseEnter={onKeepOpen}
        onMouseLeave={() => { if (!expanded) onScheduleClose() }}
        style={{
          position:  'fixed',
          left:      anchorX,
          top:       anchorY - DECK_HEIGHT,
          width:     360,
          height:    DECK_HEIGHT,
          transform: 'translateX(-50%)',
          zIndex:    9999,
          pointerEvents: 'auto',
        }}
      >
        {cards.map((card, i) => {
          const { rot, tx } = fanParams(i, cards.length)
          const isActive   = hovered === i
          const anyHov     = hovered !== null
          const isOverflow = overflow > 0 && i === cards.length - 1
          const isText     = card.kind === 'text'

          // Preview limpio: quitar markdown chars, tomar primeras líneas
          const previewText = isText
            ? card.body.replace(/[#*`>_~\[\]]/g, '').split('\n').filter(Boolean).join(' ').slice(0, 130)
            : ''

          return (
            <div
              key={i}
              onMouseEnter={() => { onKeepOpen(); setHovered(i) }}
              onMouseLeave={() => setHovered(null)}
              onClick={e => {
                e.stopPropagation()
                if (isLoading || isOverflow) return
                setExpanded(card)
              }}
              style={{
                position:        'absolute',
                bottom:          16,
                left:            '50%',
                width:           CARD_W,
                transformOrigin: 'bottom center',
                transform:       `translateX(calc(-50% + ${tx}px)) translateY(${isActive ? -24 : 0}px) rotate(${rot}deg) scale(${isActive ? 1.12 : anyHov ? 0.91 : 1})`,
                transition:      `transform 300ms cubic-bezier(0.34,1.28,0.64,1) ${i * 30}ms, opacity 180ms ease ${i * 30}ms`,
                opacity:         anyHov && !isActive ? 0.42 : 1,
                filter:          isActive && !isLoading ? 'drop-shadow(0 8px 24px rgba(255,255,255,0.13))' : 'none',
                zIndex:          isActive ? 10 : i + 1,
                cursor:          isLoading || isOverflow ? 'default' : 'pointer',
              }}
            >
              <div style={{
                background:   'var(--bg-1)',
                border:       `1.5px solid ${isActive ? 'rgba(255,255,255,0.30)' : 'var(--line-2)'}`,
                borderRadius: 8,
                overflow:     'hidden',
                display:      'flex',
                flexDirection:'column',
                height:       130,
                transition:   'border-color 130ms',
              }}>
                {/* Header de la carta */}
                <div style={{
                  padding:      '5px 7px',
                  background:   'var(--bg-2)',
                  borderBottom: '1px solid var(--line-2)',
                  fontFamily:   'var(--font-mono)',
                  fontSize:     8,
                  fontWeight:   700,
                  color:        isActive ? 'var(--text-0)' : 'var(--text-2)',
                  overflow:     'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace:   'nowrap',
                  transition:   'color 130ms',
                  flexShrink:   0,
                }}>
                  {isLoading ? '···' : isText ? card.title : (card as ImageCard).label}
                </div>

                {/* Cuerpo de la carta */}
                {isLoading ? (
                  <div style={{
                    flex: 1,
                    background:     'linear-gradient(90deg, var(--bg-3) 25%, var(--bg-4) 50%, var(--bg-3) 75%)',
                    backgroundSize: '200% 100%',
                    animation:      'asset-shimmer 1.4s infinite',
                  }} />
                ) : isText && !isOverflow ? (
                  <div style={{
                    flex:       1,
                    padding:    '5px 7px',
                    fontFamily: 'var(--font-mono)',
                    fontSize:   7.5,
                    lineHeight: 1.55,
                    color:      isActive ? 'var(--text-2)' : 'var(--text-3)',
                    overflow:   'hidden',
                    transition: 'color 130ms',
                  }}>
                    {previewText}{previewText.length >= 130 ? '…' : ''}
                  </div>
                ) : isText && isOverflow ? (
                  <div style={{
                    flex:            1,
                    display:         'flex',
                    alignItems:      'center',
                    justifyContent:  'center',
                    fontFamily:      'var(--font-mono)',
                    fontSize:        11,
                    fontWeight:      700,
                    color:           'var(--text-2)',
                  }}>
                    {card.title}
                  </div>
                ) : (
                  // Imagen
                  <img
                    src={(card as ImageCard).url}
                    alt={(card as ImageCard).label}
                    style={{ width: '100%', flex: 1, objectFit: 'cover', objectPosition: 'top', display: 'block' }}
                  />
                )}
              </div>
            </div>
          )
        })}
      </div>

      {/* Modal expandido al hacer click en una carta */}
      {expanded && (
        <div
          onClick={() => { setExpanded(null); onScheduleClose() }}
          style={{
            position:        'fixed',
            inset:           0,
            background:      'rgba(0,0,0,0.88)',
            zIndex:          10000,
            display:         'flex',
            alignItems:      'center',
            justifyContent:  'center',
          }}
        >
          <button
            onClick={() => { setExpanded(null); onScheduleClose() }}
            style={{
              position:   'fixed',
              top:        20,
              right:      24,
              background: 'none',
              border:     'none',
              cursor:     'pointer',
              color:      '#fff',
              fontSize:   22,
              lineHeight: 1,
              opacity:    0.65,
              fontFamily: 'var(--font-mono)',
            }}
          >✕</button>

          <div
            onClick={e => e.stopPropagation()}
            style={{
              width:        760,
              maxHeight:    '86vh',
              background:   'var(--bg-1)',
              border:       '1px solid var(--line-2)',
              borderRadius: 10,
              overflow:     'hidden',
              display:      'flex',
              flexDirection:'column',
              boxShadow:    '0 24px 64px rgba(0,0,0,0.6)',
            }}
          >
            {/* Header del modal */}
            <div style={{
              padding:      '12px 20px',
              borderBottom: '1px solid var(--line-2)',
              fontFamily:   'var(--font-mono)',
              fontSize:     11,
              fontWeight:   700,
              color:        'var(--text-0)',
              flexShrink:   0,
              display:      'flex',
              alignItems:   'center',
              gap:          8,
            }}>
              <span style={{ color: 'var(--text-4)', fontWeight: 400 }}>Section —</span>
              {expanded.kind === 'text' ? expanded.title : expanded.label}
            </div>

            {/* Contenido */}
            <div style={{ flex: 1, overflowY: 'auto', padding: '20px 28px', fontSize: 12, color: 'var(--text-1)', lineHeight: 1.7 }}>
              {expanded.kind === 'text' ? (
                <ReactMarkdown remarkPlugins={[remarkGfm]} components={MD_COMPONENTS}>
                  {expanded.body}
                </ReactMarkdown>
              ) : (
                <img
                  src={expanded.url}
                  alt={expanded.label}
                  style={{ maxWidth: '100%', borderRadius: 6, display: 'block' }}
                />
              )}
            </div>
          </div>
        </div>
      )}

      <style>{`@keyframes asset-shimmer { 0%{background-position:200% 0} 100%{background-position:-200% 0} }`}</style>
    </>,
    document.body
  )
}
