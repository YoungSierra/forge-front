'use client'

import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import type { ImageRef, CharacterRenderStatus } from '@/lib/types'
import { getImageReferencePool, getCharatersStatus } from '@/lib/api'

type Item = { url: string; label: string }

// Caché de sesión para evitar re-fetches al hacer hover repetido
const CACHE = new Map<string, Item[]>()

// Calcula rotación y desplazamiento horizontal para cada carta según su posición en el abanico
function fanParams(index: number, total: number): { rot: number; tx: number } {
  const maxRot = Math.min(28, total * 7)
  const maxTx  = Math.min(68, total * 17)
  const t = total === 1 ? 0.5 : index / (total - 1)
  return { rot: -maxRot + t * 2 * maxRot, tx: -maxTx + t * 2 * maxTx }
}

// Máximo de tarjetas visibles en el abanico antes de colapsar en "+N more"
const MAX_FAN = 5
// Espacio vertical reservado sobre el nodo para el abanico
const DECK_HEIGHT = 195

interface Props {
  stepKey:         string
  projectId:       string
  // Centro-X y top-Y del nodo en screen coords (position: fixed)
  anchorX:         number
  anchorY:         number
  onKeepOpen:      () => void
  onScheduleClose: () => void
}

export default function ImageCardDeck({
  stepKey, projectId, anchorX, anchorY, onKeepOpen, onScheduleClose,
}: Props) {
  // null = cargando, [] = vacío (no renderizar), [...] = listo
  const [items, setItems]     = useState<Item[] | null>(null)
  const [hovered, setHovered] = useState<number | null>(null)
  const [zoomed, setZoomed]   = useState<Item | null>(null)

  // Listener de teclado para cerrar el lightbox con Escape
  useEffect(() => {
    if (!zoomed) return
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') { setZoomed(null); onScheduleClose() } }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [zoomed, onScheduleClose])

  // Carga de imágenes con caché de sesión
  useEffect(() => {
    let cancelled = false
    const key = `${projectId}:${stepKey}`
    const cached = CACHE.get(key)
    if (cached !== undefined) { setItems(cached); return }

    async function load() {
      try {
        let loaded: Item[] = []
        if (stepKey === 'image_reference') {
          const pool: ImageRef[] = await getImageReferencePool(projectId)
          const selected = pool.filter(i => i.selected)
          loaded = (selected.length > 0 ? selected : pool)
            .map((i, idx) => ({ url: i.image_url, label: `ref ${idx + 1}` }))
        } else if (stepKey === 'charaters') {
          const chars: CharacterRenderStatus[] = await getCharatersStatus(projectId)
          loaded = chars
            .filter(c => c.current_version?.storage_url)
            .map(c => ({ url: c.current_version!.storage_url, label: c.character_name }))
        }
        if (!cancelled) { CACHE.set(key, loaded); setItems(loaded) }
      } catch {
        if (!cancelled) setItems([])
      }
    }
    load()
    return () => { cancelled = true }
  }, [stepKey, projectId])

  // No renderizar si ya sabemos que no hay imágenes
  if (items !== null && items.length === 0) return null

  // Construir las tarjetas del abanico — skeletons durante la carga
  const isLoading = items === null
  const fanItems  = isLoading
    ? Array.from({ length: 3 }, (_, i) => ({ url: '', label: `···` }))
    : items.slice(0, MAX_FAN)

  const overflow = !isLoading && items!.length > MAX_FAN ? items!.length - MAX_FAN : 0
  // Si hay overflow: reemplazar la última carta por "+N more"
  const cards = overflow > 0
    ? [...fanItems.slice(0, MAX_FAN - 1), { url: '', label: `+${overflow + 1}` }]
    : fanItems

  return createPortal(
    <>
      {/* Contenedor del abanico — escapa overflow:hidden del canvas vía portal */}
      <div
        onMouseEnter={onKeepOpen}
        onMouseLeave={() => { if (!zoomed) onScheduleClose() }}
        style={{
          position: 'fixed',
          left:      anchorX,
          top:       anchorY - DECK_HEIGHT,
          width:     320,
          height:    DECK_HEIGHT,
          transform: 'translateX(-50%)',
          zIndex:    9999,
          pointerEvents: 'auto',
        }}
      >
        {cards.map((item, i) => {
          const { rot, tx } = fanParams(i, cards.length)
          const isActive  = hovered === i
          const anyHov    = hovered !== null
          const isOverflow = overflow > 0 && i === cards.length - 1

          return (
            <div
              key={i}
              onMouseEnter={() => { onKeepOpen(); setHovered(i) }}
              onMouseLeave={() => setHovered(null)}
              onClick={e => {
                e.stopPropagation()
                if (isLoading || isOverflow) return
                setZoomed(item)
              }}
              style={{
                position: 'absolute',
                bottom: 16,
                left: '50%',
                width: 88,
                transformOrigin: 'bottom center',
                transform: `translateX(calc(-50% + ${tx}px)) translateY(${isActive ? -22 : 0}px) rotate(${rot}deg) scale(${isActive ? 1.1 : anyHov ? 0.92 : 1})`,
                transition: `transform 300ms cubic-bezier(0.34, 1.28, 0.64, 1) ${i * 30}ms, opacity 180ms ease ${i * 30}ms`,
                opacity:    anyHov && !isActive ? 0.45 : 1,
                filter:     isActive && !isLoading ? 'drop-shadow(0 6px 22px rgba(255,255,255,0.14))' : 'none',
                zIndex:     isActive ? 10 : i + 1,
                cursor:     isLoading || isOverflow ? 'default' : 'zoom-in',
              }}
            >
              <div style={{
                background:   'var(--bg-1)',
                border:       `1.5px solid ${isActive ? 'rgba(255,255,255,0.28)' : 'var(--line-2)'}`,
                borderRadius: 8,
                overflow:     'hidden',
                display:      'flex', flexDirection: 'column',
                transition:   'border-color 130ms',
              }}>
                {/* Área de imagen / skeleton / overflow */}
                <div style={{ width: '100%', height: 68, background: 'var(--bg-3)', position: 'relative', overflow: 'hidden' }}>
                  {isLoading ? (
                    // Skeleton pulsante mientras cargan las imágenes
                    <div style={{
                      width: '100%', height: '100%',
                      background: 'linear-gradient(90deg, var(--bg-3) 25%, var(--bg-4) 50%, var(--bg-3) 75%)',
                      backgroundSize: '200% 100%',
                      animation: 'shimmer 1.4s infinite',
                    }} />
                  ) : isOverflow ? (
                    // Carta de overflow "+N more"
                    <div style={{
                      width: '100%', height: '100%',
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                      fontFamily: 'var(--font-mono)', fontSize: 13, fontWeight: 700,
                      color: 'var(--text-2)',
                    }}>{item.label}</div>
                  ) : (
                    <img
                      src={item.url}
                      alt={item.label}
                      style={{ width: '100%', height: '100%', objectFit: 'cover', objectPosition: 'top', display: 'block' }}
                    />
                  )}
                  {/* Tint de hover sobre la imagen */}
                  {isActive && !isLoading && !isOverflow && (
                    <div style={{ position: 'absolute', inset: 0, background: 'rgba(255,255,255,0.07)' }} />
                  )}
                </div>

                {/* Label debajo de la imagen */}
                <div style={{
                  padding:        '3px 5px 4px',
                  fontFamily:     'var(--font-mono)', fontSize: 8,
                  color:          isActive ? 'var(--text-1)' : 'var(--text-3)',
                  overflow:       'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                  textAlign:      'center',
                  transition:     'color 130ms',
                }}>{item.label}</div>
              </div>
            </div>
          )
        })}
      </div>

      {/* Lightbox — overlay oscuro con la imagen a tamaño completo */}
      {zoomed && (
        <div
          onClick={() => { setZoomed(null); onScheduleClose() }}
          style={{
            position: 'fixed', inset: 0,
            background: 'rgba(0,0,0,0.9)',
            zIndex: 10000,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}
        >
          <button
            onClick={() => { setZoomed(null); onScheduleClose() }}
            style={{
              position: 'fixed', top: 20, right: 24,
              background: 'none', border: 'none', cursor: 'pointer',
              color: '#fff', fontSize: 22, lineHeight: 1, opacity: 0.65,
              fontFamily: 'var(--font-mono)',
            }}
          >✕</button>

          {/* Imagen centrada — detiene propagación para no cerrar al hacer click en ella */}
          <div onClick={e => e.stopPropagation()} style={{ position: 'relative', maxWidth: '90vw', maxHeight: '90vh' }}>
            <img
              src={zoomed.url}
              alt={zoomed.label}
              style={{ maxWidth: '90vw', maxHeight: '90vh', objectFit: 'contain', borderRadius: 6, display: 'block' }}
            />
            <div style={{
              position:     'absolute', bottom: 0, left: 0, right: 0,
              background:   'linear-gradient(transparent, rgba(0,0,0,0.75))',
              padding:      '24px 16px 10px',
              fontFamily:   'var(--font-mono)', fontSize: 11, color: '#fff',
              borderRadius: '0 0 6px 6px',
            }}>{zoomed.label}</div>
          </div>
        </div>
      )}

      {/* Keyframe para el skeleton shimmer */}
      <style>{`@keyframes shimmer { 0%{background-position:200% 0} 100%{background-position:-200% 0} }`}</style>
    </>,
    document.body
  )
}

// Invalida la caché de un proyecto (llamar tras aprobar o regenerar imágenes)
export function invalidateImageDeckCache(projectId: string) {
  for (const key of CACHE.keys()) {
    if (key.startsWith(`${projectId}:`)) CACHE.delete(key)
  }
}
