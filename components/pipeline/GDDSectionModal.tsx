'use client'

import { useEffect } from 'react'
import { createPortal } from 'react-dom'
import type { GDD } from '@/lib/types'
import type { GDDSectionId } from './GDDCardDeck'
import { GDD_SECTIONS } from './GDDCardDeck'

function Badge({ label, color }: { label: string; color: string }) {
  return (
    <span style={{
      fontFamily: 'var(--font-mono)', fontSize: 9, padding: '2px 7px', borderRadius: 99,
      background: `color-mix(in oklch, ${color} 12%, var(--bg-2))`,
      border: `1px solid color-mix(in oklch, ${color} 30%, transparent)`,
      color, whiteSpace: 'nowrap',
    }}>{label}</span>
  )
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div style={{ display: 'flex', gap: 8, alignItems: 'flex-start', fontSize: 12 }}>
      <span style={{ fontFamily: 'var(--font-mono)', fontSize: 9, color: 'var(--text-3)', textTransform: 'uppercase', letterSpacing: '0.07em', paddingTop: 2, flexShrink: 0, minWidth: 90 }}>{label}</span>
      <span style={{ color: 'var(--text-2)', lineHeight: 1.6 }}>{value}</span>
    </div>
  )
}

/* ─── Section renderers ─── */

function OverviewSection({ gdd }: { gdd: GDD }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      {/* Elevator pitch */}
      {(gdd.project.logline || gdd.project.elevator_pitch) && (
        <p style={{ fontSize: 14, color: 'var(--text-1)', lineHeight: 1.7, fontStyle: 'italic', borderLeft: '3px solid var(--cat-design)', paddingLeft: 12 }}>
          {gdd.project.logline || gdd.project.elevator_pitch}
        </p>
      )}

      {/* Quick badges */}
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
        {gdd.project.genre     && <Badge label={gdd.project.genre}     color="var(--cat-design)" />}
        {gdd.project.tone      && <Badge label={gdd.project.tone}      color="var(--cat-audio)"  />}
        {gdd.project.player_mode && <Badge label={gdd.project.player_mode} color="var(--text-3)"  />}
        {gdd.development?.suggested_engine && <Badge label={gdd.development.suggested_engine} color="var(--cat-gate)" />}
        {gdd.development?.estimated_scope  && <Badge label={gdd.development.estimated_scope}  color="var(--text-3)"  />}
      </div>

      {/* Core loop */}
      {gdd.project.core_loop && (
        <div style={{
          padding: '8px 12px', borderRadius: 6, fontSize: 12, color: 'var(--text-2)',
          background: 'color-mix(in oklch, var(--cat-design) 7%, var(--bg-2))',
          border: '1px solid color-mix(in oklch, var(--cat-design) 20%, transparent)',
        }}>
          <span style={{ fontFamily: 'var(--font-mono)', fontSize: 9, color: 'var(--cat-design)', textTransform: 'uppercase', letterSpacing: '0.1em' }}>Core Loop · </span>
          {gdd.project.core_loop}
        </div>
      )}

      {/* Description */}
      {gdd.project.description && (
        <p style={{ fontSize: 13, color: 'var(--text-2)', lineHeight: 1.65 }}>{gdd.project.description}</p>
      )}

      {/* Key features */}
      {(gdd.key_features?.length ?? 0) > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          <div style={{ fontFamily: 'var(--font-mono)', fontSize: 9, color: 'var(--text-3)', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 2 }}>Key Features</div>
          {gdd.key_features!.map((f, i) => (
            <div key={i} style={{ display: 'flex', gap: 10, fontSize: 12, color: 'var(--text-2)', lineHeight: 1.55 }}>
              <span style={{ color: 'var(--cat-design)', fontWeight: 700, flexShrink: 0 }}>›</span>{f}
            </div>
          ))}
        </div>
      )}

      {/* Design pillars */}
      {(gdd.design_pillars?.length ?? 0) > 0 && (
        <div>
          <div style={{ fontFamily: 'var(--font-mono)', fontSize: 9, color: 'var(--text-3)', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 8 }}>Design Pillars</div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))', gap: 8 }}>
            {gdd.design_pillars!.map((p, i) => (
              <div key={i} style={{ padding: '8px 10px', borderRadius: 6, background: 'var(--bg-2)', border: '1px solid var(--line-2)' }}>
                <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--cat-design)', marginBottom: 4 }}>{p.pillar}</div>
                <div style={{ fontSize: 10, color: 'var(--text-3)', lineHeight: 1.5 }}>{p.description}</div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

function CharactersSection({ gdd }: { gdd: GDD }) {
  const chars = gdd.characters ?? []
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      {chars.length === 0 && (
        <p style={{ fontSize: 12, color: 'var(--text-3)', fontFamily: 'var(--font-mono)' }}>No characters defined.</p>
      )}
      {chars.map((c, i) => (
        <div key={i} style={{ padding: '12px 14px', borderRadius: 8, background: 'var(--bg-2)', border: '1px solid var(--line-2)' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
            <span style={{ fontSize: 14, fontWeight: 700, color: 'var(--text-0)' }}>{c.name}</span>
            {c.role && <Badge label={c.role} color="var(--cat-design)" />}
            {c.age  && <Badge label={`Age ${c.age}`} color="var(--text-3)" />}
          </div>
          {c.appearance  && <Row label="Appearance"  value={c.appearance} />}
          {c.personality && <Row label="Personality" value={c.personality} />}
          {c.motivation  && <Row label="Motivation"  value={c.motivation} />}
          {!c.appearance && !c.personality && c.description && (
            <p style={{ fontSize: 12, color: 'var(--text-2)', lineHeight: 1.55 }}>{c.description}</p>
          )}
          {c.gameplay_role && (
            <div style={{ marginTop: 8, padding: '5px 8px', borderRadius: 4, background: 'var(--bg-1)', border: '1px solid var(--line)', fontSize: 10, color: 'var(--text-3)', fontFamily: 'var(--font-mono)' }}>
              <span style={{ color: 'var(--cat-design)' }}>GAMEPLAY · </span>{c.gameplay_role}
            </div>
          )}
        </div>
      ))}
    </div>
  )
}

function MechanicsSection({ gdd }: { gdd: GDD }) {
  const mechs = gdd.mechanics ?? []
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      {mechs.length === 0 && (
        <p style={{ fontSize: 12, color: 'var(--text-3)', fontFamily: 'var(--font-mono)' }}>No mechanics defined.</p>
      )}
      {mechs.map((m, i) => (
        <div key={i} style={{ padding: '11px 13px', borderRadius: 8, background: 'var(--bg-2)', border: '1px solid var(--line-2)' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
            <span style={{ fontSize: 13, fontWeight: 700, color: 'var(--text-0)', flex: 1 }}>{m.name}</span>
            {(m.category ?? m.type) && <Badge label={m.category ?? String(m.type)} color="var(--cat-gate)" />}
          </div>
          {m.description  && <p style={{ fontSize: 12, color: 'var(--text-2)', lineHeight: 1.55, marginBottom: 6 }}>{m.description}</p>}
          {m.player_goal  && <Row label="Player goal" value={m.player_goal} />}
          {m.rules        && <Row label="Rules"       value={m.rules} />}
        </div>
      ))}
    </div>
  )
}

function LevelsSection({ gdd }: { gdd: GDD }) {
  const levels = gdd.levels ?? []
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      {levels.length === 0 && (
        <p style={{ fontSize: 12, color: 'var(--text-3)', fontFamily: 'var(--font-mono)' }}>No levels defined.</p>
      )}
      {levels.map((l, i) => (
        <div key={i} style={{ padding: '11px 13px', borderRadius: 8, background: 'var(--bg-2)', border: '1px solid var(--line-2)' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
            {l.order != null && (
              <span style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color: 'var(--text-3)', background: 'var(--bg-3)', border: '1px solid var(--line)', borderRadius: 4, padding: '1px 6px' }}>
                {String(l.order).padStart(2, '0')}
              </span>
            )}
            <span style={{ fontSize: 13, fontWeight: 700, color: 'var(--text-0)', flex: 1 }}>{l.name}</span>
            {l.difficulty && <Badge label={String(l.difficulty)} color="var(--cat-level)" />}
          </div>
          {l.visual_feel      && <Row label="Visual"    value={l.visual_feel} />}
          {l.gameplay_role    && <Row label="Role"       value={l.gameplay_role} />}
          {!l.visual_feel && l.description && (
            <p style={{ fontSize: 12, color: 'var(--text-2)', lineHeight: 1.55 }}>{String(l.description)}</p>
          )}
        </div>
      ))}
    </div>
  )
}

function DirectionSection({ gdd }: { gdd: GDD }) {
  const art   = gdd.art_direction ?? {}
  const audio = gdd.audio_direction ?? {}
  const dev   = gdd.development ?? {}
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      {/* Art */}
      <div>
        <div style={{ fontFamily: 'var(--font-mono)', fontSize: 9, color: 'var(--text-3)', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 8 }}>Art Direction</div>
        <div style={{ padding: '11px 13px', borderRadius: 8, background: 'var(--bg-2)', border: '1px solid var(--line-2)', display: 'flex', flexDirection: 'column', gap: 7 }}>
          {art.style             && <Row label="Style"       value={art.style} />}
          {art.character_style   && <Row label="Characters"  value={art.character_style} />}
          {art.environment_style && <Row label="Environments" value={art.environment_style} />}
          {art.mood              && <Row label="Mood"         value={art.mood} />}
          {art.ui_style          && <Row label="UI"           value={art.ui_style} />}
          {Array.isArray(art.palette) && (
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 2 }}>
              {(art.palette as { role: string; color_description: string }[]).map((p, i) => (
                <span key={i} style={{ fontSize: 9, fontFamily: 'var(--font-mono)', padding: '2px 6px', borderRadius: 3, background: 'var(--bg-3)', color: 'var(--text-3)', border: '1px solid var(--line)' }}>
                  {p.role}
                </span>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Audio */}
      <div>
        <div style={{ fontFamily: 'var(--font-mono)', fontSize: 9, color: 'var(--text-3)', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 8 }}>Audio Direction</div>
        <div style={{ padding: '11px 13px', borderRadius: 8, background: 'var(--bg-2)', border: '1px solid var(--line-2)', display: 'flex', flexDirection: 'column', gap: 7 }}>
          {(audio.music_genre || audio.music_style || audio.music_mood) &&
            <Row label="Music" value={audio.music_genre ?? audio.music_style ?? audio.music_mood ?? ''} />}
          {audio.instrumentation  && <Row label="Instruments" value={audio.instrumentation} />}
          {audio.sound_design_style && <Row label="SFX Style"  value={audio.sound_design_style} />}
          {audio.ambience         && <Row label="Ambience"    value={audio.ambience} />}
          {audio.voice_over       && <Row label="Voice over"  value={audio.voice_over} />}
        </div>
      </div>

      {/* Dev */}
      {(dev.suggested_engine || dev.language || (dev.tools?.length ?? 0) > 0) && (
        <div>
          <div style={{ fontFamily: 'var(--font-mono)', fontSize: 9, color: 'var(--text-3)', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 8 }}>Development</div>
          <div style={{ padding: '11px 13px', borderRadius: 8, background: 'var(--bg-2)', border: '1px solid var(--line-2)', display: 'flex', flexDirection: 'column', gap: 7 }}>
            {dev.suggested_engine  && <Row label="Engine"   value={dev.suggested_engine} />}
            {dev.language          && <Row label="Language" value={dev.language} />}
            {dev.estimated_scope   && <Row label="Scope"    value={dev.estimated_scope} />}
          </div>
        </div>
      )}
    </div>
  )
}

/* ─── Main modal ─── */

interface Props {
  gdd: GDD
  section: GDDSectionId
  onClose: () => void
  onViewFull: () => void
}

export default function GDDSectionModal({ gdd, section, onClose, onViewFull }: Props) {
  const meta = GDD_SECTIONS.find(s => s.id === section)!

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.stopPropagation(); onClose() } }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [onClose])

  const content = (() => {
    switch (section) {
      case 'overview':    return <OverviewSection   gdd={gdd} />
      case 'characters':  return <CharactersSection gdd={gdd} />
      case 'mechanics':   return <MechanicsSection  gdd={gdd} />
      case 'levels':      return <LevelsSection     gdd={gdd} />
      case 'direction':   return <DirectionSection  gdd={gdd} />
    }
  })()

  return createPortal(
    <div
      style={{
        position: 'fixed', inset: 0, zIndex: 1100,
        background: 'rgba(0,0,0,0.55)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        padding: 24,
      }}
    >
      <div
        onClick={e => e.stopPropagation()}
        style={{
          width: '100%', maxWidth: 560,
          maxHeight: '80vh',
          background: 'var(--bg-1)',
          border: `1px solid color-mix(in srgb, ${meta.color} 30%, var(--line-2))`,
          borderRadius: 14,
          display: 'flex', flexDirection: 'column',
          overflow: 'hidden',
          boxShadow: `0 24px 64px rgba(0,0,0,0.5), 0 0 0 1px color-mix(in srgb, ${meta.color} 15%, transparent)`,
        }}
      >
        {/* Header */}
        <div style={{
          display: 'flex', alignItems: 'center', gap: 10,
          padding: '14px 18px',
          borderBottom: '1px solid var(--line-2)',
          flexShrink: 0,
        }}>
          <span style={{ fontSize: 20 }}>{meta.icon}</span>
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 13, fontWeight: 700, color: meta.color, fontFamily: 'var(--font-mono)' }}>
              {meta.title}
            </div>
            <div style={{ fontSize: 10, color: 'var(--text-3)', fontFamily: 'var(--font-mono)' }}>
              {gdd.project.name}
            </div>
          </div>
          <button
            onClick={onViewFull}
            style={{
              fontSize: 10, fontFamily: 'var(--font-mono)', padding: '5px 12px',
              borderRadius: 5, border: '1px solid var(--line-2)',
              background: 'var(--bg-2)', color: 'var(--text-2)',
              cursor: 'pointer',
            }}
          >
            View full GDD →
          </button>
          <button
            onClick={onClose}
            style={{
              width: 26, height: 26, borderRadius: 5, border: 'none',
              background: 'var(--bg-3)', color: 'var(--text-2)',
              display: 'grid', placeItems: 'center', cursor: 'pointer',
              fontSize: 14, flexShrink: 0,
            }}
          >✕</button>
        </div>

        {/* Body */}
        <div style={{ flex: 1, overflowY: 'auto', padding: '18px 18px 22px' }}>
          {content}
        </div>
      </div>
    </div>,
    document.body
  )
}
