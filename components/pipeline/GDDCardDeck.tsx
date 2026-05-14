'use client'

import { useState } from 'react'
import { createPortal } from 'react-dom'
import type { GDD } from '@/lib/types'

export type GDDSectionId = 'overview' | 'characters' | 'mechanics' | 'levels' | 'direction'

// Definición de cada sección del GDD: icono, título, color temático y posición en el abanico
export const GDD_SECTIONS: {
  id: GDDSectionId; icon: string; title: string; color: string; rot: number; tx: number
}[] = [
  { id: 'overview',   icon: '📋', title: 'Overview',   color: '#a78bfa', rot: -30, tx: -76 },
  { id: 'characters', icon: '👥', title: 'Characters', color: '#34d399', rot: -14, tx: -36 },
  { id: 'mechanics',  icon: '⚙️', title: 'Mechanics',  color: '#60a5fa', rot:   0, tx:   0 },
  { id: 'levels',     icon: '🗺️', title: 'Levels',     color: '#fbbf24', rot:  14, tx:  36 },
  { id: 'direction',  icon: '🎨', title: 'Direction',  color: '#f472b6', rot:  30, tx:  76 },
]

// Extrae un resumen breve de cada sección para mostrarlo en la tarjeta del abanico
export function gddSectionSummary(id: GDDSectionId, gdd: GDD): { headline: string; chips: string[] } {
  switch (id) {
    case 'overview': return {
      headline: [gdd.project.genre, gdd.project.tone].filter(Boolean).join(' · ') || 'Concept',
      chips: [
        gdd.development?.suggested_engine,
        gdd.development?.estimated_scope,
        (gdd.key_features?.length ?? 0) > 0 ? `${gdd.key_features!.length} features` : undefined,
      ].filter(Boolean) as string[],
    }
    case 'characters': return {
      headline: `${gdd.characters?.length ?? 0} character${(gdd.characters?.length ?? 0) !== 1 ? 's' : ''}`,
      chips: (gdd.characters ?? []).slice(0, 3).map(c => c.name),
    }
    case 'mechanics': return {
      headline: `${gdd.mechanics?.length ?? 0} mechanic${(gdd.mechanics?.length ?? 0) !== 1 ? 's' : ''}`,
      chips: (gdd.mechanics ?? []).slice(0, 3).map(m => m.name),
    }
    case 'levels': return {
      headline: `${gdd.levels?.length ?? 0} environment${(gdd.levels?.length ?? 0) !== 1 ? 's' : ''}`,
      chips: (gdd.levels ?? []).slice(0, 3).map(l => l.name),
    }
    case 'direction': return {
      headline: gdd.art_direction?.style?.slice(0, 42) ?? 'Art & audio',
      chips: [
        gdd.audio_direction?.music_genre,
        gdd.art_direction?.character_style ? 'char style' : undefined,
        gdd.development?.suggested_engine,
      ].filter(Boolean) as string[],
    }
  }
}

interface Props {
  gdd: GDD
  // Posición en screen coords (centro-X, top-Y del nodo) para anclar el portal
  anchorX: number
  anchorY: number
  // Cancela el cierre programado cuando el mouse entra al deck o a una tarjeta
  onKeepOpen: () => void
  // Programa el cierre con delay cuando el mouse sale del deck
  onScheduleClose: () => void
  onSectionClick: (id: GDDSectionId) => void
}

// Espacio vertical reservado sobre el nodo para el abanico de tarjetas
const DECK_HEIGHT = 220

export default function GDDCardDeck({
  gdd, anchorX, anchorY,
  onKeepOpen, onScheduleClose, onSectionClick,
}: Props) {
  // Sección actualmente bajo el cursor — controla escala y resaltado
  const [hovered, setHovered] = useState<GDDSectionId | null>(null)

  // Portal renderizado en document.body para escapar cualquier overflow:hidden del canvas
  return createPortal(
    <div
      onMouseEnter={onKeepOpen}
      onMouseLeave={onScheduleClose}
      style={{
        // Posición fija en screen coords, centrado horizontalmente sobre el nodo
        position: 'fixed',
        left:   anchorX,
        top:    anchorY - DECK_HEIGHT,
        width:  340,
        height: DECK_HEIGHT,
        transform: 'translateX(-50%)',
        zIndex: 9999,
        pointerEvents: 'auto',
      }}
    >
      {GDD_SECTIONS.map((s, i) => {
        const isActive = hovered === s.id
        const anyHov   = hovered !== null
        const summary  = gddSectionSummary(s.id, gdd)
        // Escalonado de animación para efecto de abanico suave
        const delay    = `${i * 30}ms`

        return (
          <div
            key={s.id}
            onMouseEnter={() => { onKeepOpen(); setHovered(s.id) }}
            onMouseLeave={() => setHovered(null)}
            onClick={e => {
              e.stopPropagation()
              setHovered(null)
              onSectionClick(s.id)
            }}
            style={{
              position: 'absolute',
              bottom: 16,
              left: '50%',
              width: 106,
              // El abanico rota y traslada desde el centro hacia afuera
              transformOrigin: 'bottom center',
              transform: `translateX(calc(-50% + ${s.tx}px)) translateY(${isActive ? -24 : 0}px) rotate(${s.rot}deg) scale(${isActive ? 1.09 : anyHov ? 0.93 : 1})`,
              transition: `transform 300ms cubic-bezier(0.34, 1.28, 0.64, 1) ${delay}, opacity 180ms ease ${delay}`,
              opacity: anyHov && !isActive ? 0.45 : 1,
              filter: isActive ? `drop-shadow(0 6px 18px ${s.color}55)` : 'none',
              zIndex: isActive ? 10 : i + 1,
              cursor: 'pointer',
            }}
          >
            <div style={{
              background: isActive
                ? `color-mix(in srgb, ${s.color} 11%, var(--bg-1))`
                : 'var(--bg-1)',
              border: `1.5px solid ${isActive
                ? `color-mix(in srgb, ${s.color} 40%, transparent)`
                : 'var(--line-2)'}`,
              borderRadius: 9,
              padding: '9px 8px 8px',
              display: 'flex', flexDirection: 'column', gap: 4,
              transition: 'background 130ms, border-color 130ms',
            }}>
              <div style={{ fontSize: 19, lineHeight: 1 }}>{s.icon}</div>
              <div style={{
                fontSize: 10, fontWeight: 700, letterSpacing: '0.02em',
                fontFamily: 'var(--font-mono)',
                color: isActive ? s.color : 'var(--text-1)',
                transition: 'color 130ms',
              }}>{s.title}</div>
              {/* Titular resumido de la sección */}
              <div style={{
                fontSize: 8.5, color: 'var(--text-3)', fontFamily: 'var(--font-mono)',
                overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
              }}>{summary.headline}</div>
              {/* Chips con los primeros elementos de la sección */}
              {summary.chips.slice(0, 2).map((chip, ci) => (
                <div key={ci} style={{
                  fontSize: 7.5, padding: '1px 5px', borderRadius: 3,
                  background: isActive
                    ? `color-mix(in srgb, ${s.color} 13%, transparent)`
                    : 'var(--bg-3)',
                  color: isActive ? s.color : 'var(--text-3)',
                  fontFamily: 'var(--font-mono)',
                  border: `1px solid ${isActive
                    ? `color-mix(in srgb, ${s.color} 25%, transparent)`
                    : 'var(--line)'}`,
                  transition: 'all 130ms',
                  overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                }}>{chip}</div>
              ))}
            </div>
          </div>
        )
      })}
    </div>,
    document.body
  )
}
