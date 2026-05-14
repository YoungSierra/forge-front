'use client'

import { useState } from 'react'

const CARDS = [
  {
    id: 'overview',
    icon: '📋',
    title: 'Overview',
    sub: 'Concept · Genre · Core Loop',
    tags: ['elevator pitch', 'tone', 'scope'],
    color: '#a78bfa',       // violet
    bg: 'rgba(167,139,250,0.08)',
    border: 'rgba(167,139,250,0.25)',
    rot: -32,
    tx: -60,
  },
  {
    id: 'characters',
    icon: '👥',
    title: 'Characters',
    sub: 'Heroes · Enemies · Bosses',
    tags: ['abilities', 'backstory', 'sprites'],
    color: '#34d399',       // green
    bg: 'rgba(52,211,153,0.08)',
    border: 'rgba(52,211,153,0.25)',
    rot: -16,
    tx: -24,
  },
  {
    id: 'mechanics',
    icon: '⚙️',
    title: 'Mechanics',
    sub: 'Systems · Controls · Rules',
    tags: ['core loop', 'progression', 'physics'],
    color: '#60a5fa',       // blue
    bg: 'rgba(96,165,250,0.08)',
    border: 'rgba(96,165,250,0.25)',
    rot: 0,
    tx: 0,
  },
  {
    id: 'levels',
    icon: '🗺️',
    title: 'Levels',
    sub: 'Worlds · Stages · Challenges',
    tags: ['layout', 'objectives', 'enemies'],
    color: '#fbbf24',       // amber
    bg: 'rgba(251,191,36,0.08)',
    border: 'rgba(251,191,36,0.25)',
    rot: 16,
    tx: 24,
  },
  {
    id: 'direction',
    icon: '🎨',
    title: 'Direction',
    sub: 'Art · Audio · Engine',
    tags: ['palette', 'sfx', 'tech stack'],
    color: '#f472b6',       // pink
    bg: 'rgba(244,114,182,0.08)',
    border: 'rgba(244,114,182,0.25)',
    rot: 32,
    tx: 60,
  },
]

// Altura reservada sobre el nodo para que las cartas queden dentro del bounding box
const DECK_CLEARANCE = 220

function GDDNode() {
  const [open, setOpen]           = useState(false)
  const [cardHovered, setCardHovered] = useState<string | null>(null)
  const [clicked, setClicked]         = useState<string | null>(null)

  function handleCardClick(title: string) {
    setClicked(title)
    setOpen(false)
    setCardHovered(null)
    setTimeout(() => setClicked(null), 2500)
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 0 }}>

      {/* Toast — encima de todo */}
      <div style={{
        height: 36,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        marginBottom: 8,
        transition: 'opacity 200ms ease, transform 200ms ease',
        transform: `translateY(${clicked ? 0 : 6}px)`,
        opacity: clicked ? 1 : 0,
        pointerEvents: 'none',
        whiteSpace: 'nowrap',
        background: 'rgba(13,15,22,0.95)',
        border: '1px solid rgba(167,139,250,0.35)',
        borderRadius: 8,
        padding: '0 14px',
        fontSize: 11,
        fontFamily: 'monospace',
        color: '#a78bfa',
        boxShadow: '0 4px 20px rgba(139,92,246,0.25)',
      }}>
        ✅ diste clic en <strong style={{ color: '#e2e8f0', marginLeft: 4 }}>{clicked}</strong>
      </div>

      {/*
        Wrapper con altura fija que incluye zona de cartas + nodo.
        onMouseLeave solo dispara al salir de TODO este bloque.
      */}
      <div
        style={{
          position: 'relative',
          width: 320,
          height: DECK_CLEARANCE + 96, // 96 = alto aprox del nodo
          display: 'flex',
          alignItems: 'flex-end',
          justifyContent: 'center',
        }}
        onMouseLeave={() => { setOpen(false); setCardHovered(null) }}
      >

        {/* Cartas — absolutas dentro del wrapper, zona superior */}
        {CARDS.map((card, i) => {
          const isActive = cardHovered === card.id
          const anyHovered = cardHovered !== null
          const delay = `${i * 35}ms`
          // posición abanico: desde -120px a +120px horizontal, -170px vertical desde el fondo
          const tx = card.tx * 1.8
          const ty = isActive ? -DECK_CLEARANCE + 10 : -DECK_CLEARANCE + 24

          return (
            <div
              key={card.id}
              onMouseEnter={() => open && setCardHovered(card.id)}
              onMouseLeave={() => setCardHovered(null)}
              onClick={() => open && handleCardClick(card.title)}
              style={{
                position: 'absolute',
                bottom: 0,
                left: '50%',
                width: 110,
                transformOrigin: 'bottom center',
                transform: open
                  ? `translateX(calc(-50% + ${tx}px)) translateY(${ty}px) rotate(${card.rot}deg) scale(${isActive ? 1.08 : anyHovered ? 0.94 : 1})`
                  : `translateX(-50%) translateY(-20px) rotate(0deg) scale(0.85)`,
                transition: `transform 340ms cubic-bezier(0.34, 1.25, 0.64, 1) ${delay}, opacity 220ms ease ${delay}, filter 150ms ease`,
                opacity: open ? (anyHovered && !isActive ? 0.5 : 1) : 0,
                filter: isActive ? `drop-shadow(0 8px 28px ${card.color}66)` : 'none',
                zIndex: isActive ? 10 : i + 1,
                pointerEvents: open ? 'auto' : 'none',
                cursor: open ? 'pointer' : 'default',
              }}
            >
              <div style={{
                background: isActive ? card.bg : 'rgba(13,15,22,0.96)',
                border: `1.5px solid ${isActive ? card.border : 'rgba(255,255,255,0.08)'}`,
                borderRadius: 10,
                padding: '10px 9px 9px',
                display: 'flex', flexDirection: 'column', gap: 5,
                transition: 'background 150ms, border-color 150ms',
              }}>
                <div style={{ fontSize: 22, lineHeight: 1 }}>{card.icon}</div>
                <div style={{
                  fontSize: 11, fontWeight: 700,
                  color: isActive ? card.color : '#e2e8f0',
                  fontFamily: 'monospace',
                  transition: 'color 150ms',
                }}>{card.title}</div>
                <div style={{
                  fontSize: 8.5, color: 'rgba(148,163,184,0.75)',
                  fontFamily: 'monospace', lineHeight: 1.4,
                }}>{card.sub}</div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 3, marginTop: 2 }}>
                  {card.tags.map(tag => (
                    <span key={tag} style={{
                      fontSize: 7.5, padding: '1.5px 5px', borderRadius: 3,
                      background: isActive ? `color-mix(in srgb, ${card.color} 15%, transparent)` : 'rgba(255,255,255,0.04)',
                      color: isActive ? card.color : 'rgba(148,163,184,0.55)',
                      fontFamily: 'monospace',
                      border: `1px solid ${isActive ? `color-mix(in srgb, ${card.color} 22%, transparent)` : 'rgba(255,255,255,0.06)'}`,
                      transition: 'all 150ms',
                    }}>{tag}</span>
                  ))}
                </div>
              </div>
            </div>
          )
        })}

        {/* Nodo GDD — en la parte inferior del wrapper */}
        <div
          onMouseEnter={() => setOpen(true)}
          style={{
            width: 140, position: 'relative', zIndex: 20,
            background: open
              ? 'linear-gradient(135deg, #1a1040 0%, #130d2e 100%)'
              : 'linear-gradient(135deg, #13111e 0%, #0d0b18 100%)',
            border: `1.5px solid ${open ? 'rgba(167,139,250,0.5)' : 'rgba(167,139,250,0.2)'}`,
            borderRadius: 12, padding: '12px 14px',
            cursor: 'default',
            transition: 'all 200ms ease',
            boxShadow: open ? '0 0 32px rgba(139,92,246,0.2)' : 'none',
            userSelect: 'none',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 7 }}>
            <div style={{
              width: 24, height: 24, borderRadius: 6,
              background: 'rgba(139,92,246,0.2)', border: '1px solid rgba(139,92,246,0.35)',
              display: 'grid', placeItems: 'center', fontSize: 12,
            }}>📄</div>
            <span style={{ fontSize: 11, fontWeight: 700, color: '#e2e8f0', fontFamily: 'monospace' }}>GDD</span>
            <span style={{
              marginLeft: 'auto', fontSize: 8, padding: '1px 6px', borderRadius: 99,
              background: 'rgba(52,211,153,0.12)', border: '1px solid rgba(52,211,153,0.3)',
              color: '#34d399', fontFamily: 'monospace',
            }}>approved</span>
          </div>
          <div style={{ fontSize: 9, color: 'rgba(148,163,184,0.6)', fontFamily: 'monospace', lineHeight: 1.5 }}>
            5 sections · 3 chars<br />4 levels · unity
          </div>
          <div style={{
            marginTop: 8, paddingTop: 7,
            borderTop: '1px solid rgba(255,255,255,0.06)',
            display: 'flex', alignItems: 'center', gap: 5,
          }}>
            <div style={{ display: 'flex', gap: 2 }}>
              {CARDS.map((c, ci) => (
                <div key={c.id} style={{
                  width: 6, height: 6, borderRadius: 2, background: c.color,
                  opacity: open ? 1 : 0.35,
                  transition: `opacity 200ms ${ci * 30}ms`,
                }} />
              ))}
            </div>
            <span style={{
              fontSize: 8, fontFamily: 'monospace', marginLeft: 2,
              color: open ? 'rgba(167,139,250,0.9)' : 'rgba(148,163,184,0.35)',
              transition: 'color 200ms',
            }}>
              {open ? 'click a section' : 'hover to explore'}
            </span>
          </div>
        </div>
      </div>
    </div>
  )
}

export default function MockupPage() {
  return (
    <div style={{
      minHeight: '100vh',
      background: '#07080f',
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      justifyContent: 'center',
      gap: 48,
      padding: 40,
    }}>
      <div style={{ textAlign: 'center', marginBottom: 8 }}>
        <div style={{ fontSize: 11, fontFamily: 'monospace', color: 'rgba(148,163,184,0.4)', letterSpacing: '0.15em', marginBottom: 6 }}>
          MOCKUP — GDD NODE CARD DECK
        </div>
        <div style={{ fontSize: 13, color: 'rgba(148,163,184,0.6)', fontFamily: 'monospace' }}>
          Hover over the node
        </div>
      </div>

      {/* Simulated pipeline canvas fragment */}
      <div style={{
        position: 'relative',
        background: 'rgba(255,255,255,0.015)',
        border: '1px solid rgba(255,255,255,0.05)',
        borderRadius: 20,
        padding: '80px 120px 50px',
        display: 'flex',
        alignItems: 'flex-end',
        gap: 60,
      }}>
        {/* Fake upstream node */}
        <div style={{
          width: 100, height: 72, borderRadius: 10,
          background: '#0d0f16',
          border: '1px solid rgba(255,255,255,0.07)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          flexDirection: 'column', gap: 4,
          opacity: 0.4,
        }}>
          <span style={{ fontSize: 16 }}>💡</span>
          <span style={{ fontSize: 9, color: '#64748b', fontFamily: 'monospace' }}>game idea</span>
        </div>

        {/* Fake edge */}
        <svg width={40} height={2} style={{ marginBottom: 36, opacity: 0.2 }}>
          <line x1={0} y1={1} x2={40} y2={1} stroke="#64748b" strokeWidth={1.5} strokeDasharray="4 3" />
        </svg>

        {/* GDD Node — the real interactive piece */}
        <GDDNode />

        {/* Fake edge */}
        <svg width={40} height={2} style={{ marginBottom: 36, opacity: 0.2 }}>
          <line x1={0} y1={1} x2={40} y2={1} stroke="#64748b" strokeWidth={1.5} strokeDasharray="4 3" />
        </svg>

        {/* Fake downstream node */}
        <div style={{
          width: 100, height: 72, borderRadius: 10,
          background: '#0d0f16',
          border: '1px solid rgba(255,255,255,0.07)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          flexDirection: 'column', gap: 4,
          opacity: 0.4,
        }}>
          <span style={{ fontSize: 16 }}>👥</span>
          <span style={{ fontSize: 9, color: '#64748b', fontFamily: 'monospace' }}>characters</span>
        </div>
      </div>

      <div style={{
        fontSize: 10, fontFamily: 'monospace', color: 'rgba(100,116,139,0.45)',
        maxWidth: 420, textAlign: 'center', lineHeight: 1.7,
      }}>
        Cards fan out on hover · Each card = one GDD section<br />
        Hover a card to highlight · Click would open that section
      </div>
    </div>
  )
}
