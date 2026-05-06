'use client'

import React from 'react'
import type { Project } from '@/lib/types'
import { assetUrl } from '@/lib/api'

/* ─── Types ─── */

type InputSource = {
  label: string
  color: string
  data: unknown
}

/* ─── Canvas-driven source metadata ─── */

const SOURCE_META: Record<string, { label: string; color: string }> = {
  gdd:                  { label: 'Game Design Doc',       color: 'var(--cat-design)' },
  art_direction_intake: { label: 'Art Direction Intake',  color: 'var(--cat-design)' },
  visual_guide:         { label: 'Visual Guide',          color: 'var(--cat-asset)'  },
  concept_art:          { label: 'Concept Art',           color: 'var(--cat-design)' },
  sprites:              { label: 'Sprites',               color: 'var(--cat-asset)'  },
  levels:               { label: 'Levels',                color: 'var(--cat-level)'  },
  code:                 { label: 'Code',                  color: 'var(--cat-code)'   },
  audio:                { label: 'Audio',                 color: 'var(--cat-audio)'  },
  sfx:                  { label: 'SFX',                   color: 'var(--cat-audio)'  },
  backgrounds:          { label: 'Backgrounds',           color: 'var(--cat-asset)'  },
  uiux:                 { label: 'UI/UX',                 color: 'var(--cat-design)' },
  icons:                { label: 'Icons',                 color: 'var(--cat-asset)'  },
  hud:                  { label: 'HUD',                   color: 'var(--cat-asset)'  },
  splash_art:           { label: 'Splash Art',            color: 'var(--cat-output)' },
  marketing:            { label: 'Marketing',             color: 'var(--cat-output)' },
  modeling:             { label: 'Modeling',              color: 'var(--cat-asset)'  },
  charaters:            { label: 'Characters',            color: 'var(--cat-design)' },
  vfx:                  { label: 'VFX',                   color: 'var(--cat-asset)'  },
  texturing:            { label: 'Texturing',             color: 'var(--cat-asset)'  },
  rigging:              { label: 'Rigging',               color: 'var(--cat-level)'  },
  lighting:             { label: 'Lighting',              color: 'var(--cat-asset)'  },
  animation:            { label: 'Animation',             color: 'var(--cat-level)'  },
  cinematics:           { label: 'Cinematics',            color: 'var(--cat-output)' },
  voice:                { label: 'Voice',                 color: 'var(--cat-audio)'  },
}

/* ─── Helpers ─── */

function getPipeline(project: Project, key: string): unknown {
  const pipeline = (project.concept as Record<string, unknown>)?.pipeline as Record<string, unknown> | undefined
  return pipeline?.[key]
}

/** Returns true if the current canvas layout contains a node with the given stepKey */
function hasCanvasStep(project: Project, stepKey: string): boolean {
  const layout = project.canvas_layout as { nodes?: { data?: { stepKey?: string } }[] } | undefined
  return layout?.nodes?.some(n => n.data?.stepKey === stepKey) ?? false
}

/** Returns the art guide source (art_direction_intake for 2D Traditional, visual_guide for 2D Game) */
function getArtGuide(project: Project): { label: string; data: unknown; color: string } {
  const use2dT = hasCanvasStep(project, 'art_direction_intake')
  return use2dT
    ? { label: 'Art Direction Intake', color: 'var(--cat-design)', data: getPipeline(project, 'art_direction_intake') }
    : { label: 'Visual Guide',         color: 'var(--cat-asset)',  data: getPipeline(project, 'visual_guide') }
}

/* ─── Input sources map ─── */

export function getInputSources(stepKey: string, project: Project): InputSource[] {
  const key = stepKey.replace('-gate', '')
  const p   = project
  const g   = p.concept?.pipeline?.gdd  // GDD data accessor

  switch (key) {
    case 'export':
      return []

    case 'gdd': {
      const saved = (() => {
        try {
          const raw = typeof window !== 'undefined' ? localStorage.getItem(`forge:gdd-input:${p.id}`) : null
          return raw ? JSON.parse(raw) as { ideaPrompt: string; params: Record<string, string | string[]> } : null
        } catch { return null }
      })()
      if (!saved) return []
      return [
        { label: 'Idea / Prompt', color: 'var(--cat-design)', data: saved.ideaPrompt },
        { label: 'Parameters',    color: 'var(--cat-asset)',   data: saved.params },
      ]
    }

    case 'sprites':
      return [
        { label: 'Characters (GDD)',  color: 'var(--cat-design)', data: g?.characters },
        { label: 'Art Direction',     color: 'var(--cat-asset)',  data: g?.art_direction },
      ]

    case 'levels':
      return [
        { label: 'Levels (GDD)',  color: 'var(--cat-level)', data: g?.levels },
        { label: 'Mechanics',     color: 'var(--cat-gate)',  data: g?.mechanics },
      ]

    case 'code':
      return [
        { label: 'Development',   color: 'var(--cat-code)',    data: g?.development },
        { label: 'Mechanics',     color: 'var(--cat-gate)',    data: g?.mechanics },
        { label: 'Characters',    color: 'var(--cat-design)',  data: g?.characters },
        { label: 'Levels',        color: 'var(--cat-level)',   data: g?.levels },
      ]

    case 'audio':
    case 'sfx':
      return [
        { label: 'Audio Direction', color: 'var(--cat-audio)', data: g?.audio_direction },
        { label: 'Levels',          color: 'var(--cat-level)', data: g?.levels },
        { label: 'Mechanics',       color: 'var(--cat-gate)',  data: g?.mechanics },
      ]

    case 'concept_art':
      return [
        { label: 'Characters (GDD)', color: 'var(--cat-design)', data: g?.characters },
        { label: 'Art Direction',    color: 'var(--cat-asset)',  data: g?.art_direction },
        { label: 'Levels',           color: 'var(--cat-level)', data: g?.levels },
      ]

    case 'visual_guide':
      return [
        { label: 'Art Direction', color: 'var(--cat-asset)',  data: g?.art_direction },
        { label: 'Concept Art',   color: 'var(--cat-design)', data: getPipeline(p, 'concept_art') },
      ]

    case 'backgrounds':
      return [
        { label: 'Levels (GDD)',  color: 'var(--cat-level)',  data: g?.levels },
        { label: 'Art Direction', color: 'var(--cat-asset)',  data: g?.art_direction },
        { label: 'Visual Guide',  color: 'var(--cat-design)', data: getPipeline(p, 'visual_guide') },
      ]

    case 'uiux': {
      const ag = getArtGuide(p)
      return [
        { label: ag.label,           color: ag.color,             data: ag.data },
        { label: 'Project Overview', color: 'var(--cat-design)',  data: g?.project },
        { label: 'Mechanics',        color: 'var(--cat-gate)',    data: g?.mechanics },
      ]
    }

    case 'icons': {
      const ag = getArtGuide(p)
      return [
        { label: ag.label,        color: ag.color,            data: ag.data },
        { label: 'Art Direction', color: 'var(--cat-asset)',  data: g?.art_direction },
        { label: 'Mechanics',     color: 'var(--cat-gate)',   data: g?.mechanics },
      ]
    }

    case 'hud': {
      const ag = getArtGuide(p)
      return [
        { label: ag.label,    color: ag.color,           data: ag.data },
        { label: 'Mechanics', color: 'var(--cat-gate)',  data: g?.mechanics },
      ]
    }

    case 'charaters':
      return [
        { label: 'Characters (GDD)', color: 'var(--cat-design)', data: g?.characters },
        { label: 'Concept Art',      color: 'var(--cat-asset)',  data: getPipeline(p, 'concept_art') },
      ]

    case 'modeling':
      return [
        { label: 'Characters (GDD)', color: 'var(--cat-design)', data: g?.characters },
        { label: 'Art Direction',    color: 'var(--cat-asset)',  data: g?.art_direction },
        { label: 'Concept Art',      color: 'var(--cat-design)', data: getPipeline(p, 'concept_art') },
      ]

    case 'texturing':
      return [
        { label: 'Art Direction', color: 'var(--cat-asset)',  data: g?.art_direction },
        { label: 'Visual Guide',  color: 'var(--cat-design)', data: getPipeline(p, 'visual_guide') },
        { label: 'Concept Art',   color: 'var(--cat-asset)',  data: getPipeline(p, 'concept_art') },
      ]

    case 'lighting':
      return [
        { label: 'Art Direction', color: 'var(--cat-asset)',  data: g?.art_direction },
        { label: 'Levels',        color: 'var(--cat-level)',  data: g?.levels },
        { label: 'Concept Art',   color: 'var(--cat-design)', data: getPipeline(p, 'concept_art') },
      ]

    case 'rigging':
      return [
        { label: 'Characters (GDD)', color: 'var(--cat-design)', data: g?.characters },
        { label: '3D Characters',    color: 'var(--cat-asset)',  data: getPipeline(p, 'charaters') },
        { label: 'Modeling',         color: 'var(--cat-level)',  data: getPipeline(p, 'modeling') },
      ]

    case 'animation':
      return [
        { label: 'Characters (GDD)', color: 'var(--cat-design)', data: g?.characters },
        { label: '3D Characters',    color: 'var(--cat-asset)',  data: getPipeline(p, 'charaters') },
        { label: 'Rigging',          color: 'var(--cat-level)',  data: getPipeline(p, 'rigging') },
      ]

    case 'cinematics':
      return [
        { label: 'Project Overview', color: 'var(--cat-design)', data: g?.project },
        { label: 'Characters (GDD)', color: 'var(--cat-design)', data: g?.characters },
        { label: 'Animation',        color: 'var(--cat-level)',  data: getPipeline(p, 'animation') },
      ]

    case 'vfx':
      return [
        { label: 'Art Direction', color: 'var(--cat-asset)',  data: g?.art_direction },
        { label: 'Levels',        color: 'var(--cat-level)',  data: g?.levels },
        { label: 'Concept Art',   color: 'var(--cat-design)', data: getPipeline(p, 'concept_art') },
      ]

    case 'voice':
      return [
        { label: 'Characters (GDD)', color: 'var(--cat-design)', data: g?.characters },
        { label: 'Project Overview', color: 'var(--cat-design)', data: g?.project },
      ]

    case 'art_direction_intake':
      return [
        { label: 'Project Overview', color: 'var(--cat-design)', data: g?.project },
        { label: 'Art Direction',    color: 'var(--cat-asset)',  data: g?.art_direction },
        { label: 'Characters',       color: 'var(--cat-design)', data: g?.characters },
        { label: 'Levels',           color: 'var(--cat-level)',  data: g?.levels },
        { label: 'Mechanics',        color: 'var(--cat-gate)',   data: g?.mechanics },
        { label: 'UI/UX Direction',  color: 'var(--cat-asset)',  data: g?.uiux_direction },
        { label: 'Narrative',        color: 'var(--cat-audio)',  data: g?.narrative },
      ]

    case 'splash_art':
    case 'marketing':
      return [
        { label: 'Art Direction Intake', color: 'var(--cat-design)', data: getPipeline(p, 'art_direction_intake') },
        { label: 'Project Overview',     color: 'var(--cat-asset)',  data: g?.project },
      ]

    default:
      return [
        { label: 'GDD', color: 'var(--cat-design)', data: {
          name:  g?.project?.name,
          genre: g?.project?.genre,
          tone:  g?.project?.tone,
        }},
      ]
  }
}

/* ─── Data renderers ─── */

function renderGenericValue(v: unknown, depth = 0): React.ReactNode {
  if (v == null) return <span style={{ color: 'var(--text-3)' }}>–</span>
  if (typeof v === 'string') {
    const isImg = v.startsWith('/assets/') || (v.startsWith('http') && /\.(jpe?g|png|webp|gif)(\?|$)/i.test(v))
    if (isImg)
      return <img src={assetUrl(v)} style={{ maxWidth: '100%', maxHeight: 160, borderRadius: 6, objectFit: 'cover', display: 'block', marginTop: 4 }}
               onError={e => { (e.currentTarget as HTMLImageElement).style.display = 'none' }} />
    return <span style={{ color: 'var(--text-1)', fontFamily: 'var(--font-mono)', fontSize: 11 }}>{v}</span>
  }
  if (typeof v === 'number' || typeof v === 'boolean')
    return <span style={{ color: 'var(--text-1)', fontFamily: 'var(--font-mono)', fontSize: 11 }}>{String(v)}</span>

  if (Array.isArray(v)) {
    if (!v.length) return <span style={{ color: 'var(--text-3)', fontSize: 11 }}>empty</span>
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
        {v.map((item, i) => (
          <div key={i} style={{ display: 'flex', gap: 8, alignItems: 'flex-start' }}>
            <span style={{ color: 'var(--text-3)', fontFamily: 'var(--font-mono)', fontSize: 10, flexShrink: 0, marginTop: 1 }}>›</span>
            <div style={{ flex: 1 }}>{renderGenericValue(item, depth + 1)}</div>
          </div>
        ))}
      </div>
    )
  }

  if (typeof v === 'object') {
    const obj = v as Record<string, unknown>
    const entries = Object.entries(obj).filter(([k]) => k !== 'approved' && k !== 'approved_at' && k !== 'placeholder')
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: depth > 0 ? 3 : 5, paddingLeft: depth > 0 ? 10 : 0 }}>
        {entries.map(([k, val]) => (
          <div key={k} style={{ display: 'flex', gap: 8, alignItems: 'flex-start', flexWrap: depth > 0 ? 'wrap' : 'nowrap' }}>
            <span style={{ fontFamily: 'var(--font-mono)', fontSize: 9, textTransform: 'uppercase', letterSpacing: '0.08em', color: 'var(--text-3)', flexShrink: 0, minWidth: 80, paddingTop: 2 }}>
              {k.replace(/_/g, ' ')}
            </span>
            <div style={{ flex: 1, minWidth: 0 }}>{renderGenericValue(val, depth + 1)}</div>
          </div>
        ))}
      </div>
    )
  }
  return null
}

/* Compact character card */
function CharacterChip({ c }: { c: Record<string, unknown> }) {
  const ROLE_COLOR: Record<string, string> = {
    hero: 'var(--cat-design)', enemy: 'var(--cat-output)',
    npc: 'var(--cat-asset)', boss: 'oklch(0.65 0.25 340)',
  }
  const role  = String(c.role ?? 'npc')
  const color = ROLE_COLOR[role] ?? 'var(--text-3)'
  return (
    <div style={{ display: 'flex', gap: 10, padding: '8px 10px', background: 'var(--bg-2)', borderRadius: 7, border: '1px solid var(--line-2)', alignItems: 'flex-start' }}>
      <div style={{
        width: 28, height: 28, borderRadius: 5, flexShrink: 0,
        background: `color-mix(in oklch, ${color} 18%, var(--bg-3))`,
        border: `1px solid color-mix(in oklch, ${color} 35%, transparent)`,
        display: 'grid', placeItems: 'center',
        fontFamily: 'var(--font-mono)', fontWeight: 700, fontSize: 11, color,
      }}>
        {String(c.name ?? '?')[0].toUpperCase()}
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontWeight: 600, fontSize: 12, color: 'var(--text-0)', marginBottom: 2 }}>{String(c.name ?? '–')}</div>
        <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
          <span style={{ fontSize: 9, fontFamily: 'var(--font-mono)', color, background: `color-mix(in oklch, ${color} 12%, transparent)`, padding: '1px 6px', borderRadius: 99 }}>{role}</span>
        </div>
        {!!c.description && <p style={{ fontSize: 10, color: 'var(--text-3)', marginTop: 4, lineHeight: 1.5 }}>{String(c.description).slice(0, 120)}{String(c.description).length > 120 ? '…' : ''}</p>}
      </div>
    </div>
  )
}

/* Compact level chip */
function LevelChip({ l }: { l: Record<string, unknown> }) {
  const DIFF_COLOR: Record<string, string> = {
    easy: 'var(--cat-code)', medium: 'var(--cat-gate)', hard: 'var(--cat-output)', boss: 'oklch(0.65 0.25 340)',
  }
  const diff  = String(l.difficulty ?? 'easy')
  const color = DIFF_COLOR[diff] ?? 'var(--text-3)'
  return (
    <div style={{ display: 'flex', gap: 8, padding: '7px 10px', background: 'var(--bg-2)', borderRadius: 7, border: '1px solid var(--line-2)', alignItems: 'center' }}>
      <span style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--text-3)', minWidth: 22 }}>{String(l.order ?? '').padStart(2, '0')}</span>
      <span style={{ fontWeight: 600, fontSize: 12, color: 'var(--text-0)', flex: 1 }}>{String(l.name ?? '–')}</span>
      <span style={{ fontSize: 9, fontFamily: 'var(--font-mono)', color: 'var(--cat-level)', background: 'color-mix(in oklch, var(--cat-level) 12%, transparent)', padding: '1px 6px', borderRadius: 99 }}>{String(l.environment ?? '')}</span>
      <span style={{ fontSize: 9, fontFamily: 'var(--font-mono)', color, background: `color-mix(in oklch, ${color} 12%, transparent)`, padding: '1px 6px', borderRadius: 99 }}>{diff}</span>
    </div>
  )
}

/* Compact mechanic chip */
function MechanicChip({ m }: { m: Record<string, unknown> }) {
  const TYPE_COLOR: Record<string, string> = { core: 'var(--cat-gate)', secondary: 'var(--text-3)', progression: 'var(--cat-level)' }
  const type  = String(m.type ?? 'core')
  const color = TYPE_COLOR[type] ?? 'var(--text-3)'
  return (
    <div style={{ display: 'flex', gap: 8, padding: '7px 10px', background: 'var(--bg-2)', borderRadius: 7, border: '1px solid var(--line-2)', alignItems: 'flex-start' }}>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontWeight: 600, fontSize: 12, color: 'var(--text-0)', marginBottom: 2 }}>{String(m.name ?? '–')}</div>
        {!!m.description && <p style={{ fontSize: 10, color: 'var(--text-3)', lineHeight: 1.5 }}>{String(m.description).slice(0, 100)}{String(m.description).length > 100 ? '…' : ''}</p>}
      </div>
      <span style={{ fontSize: 9, fontFamily: 'var(--font-mono)', color, background: `color-mix(in oklch, ${color} 12%, transparent)`, padding: '1px 6px', borderRadius: 99, flexShrink: 0 }}>{type}</span>
    </div>
  )
}

/* Smart data renderer — picks the best visual format */
function renderSourceData(data: unknown): React.ReactNode {
  if (data == null)
    return <div style={{ fontSize: 11, fontFamily: 'var(--font-mono)', color: 'var(--text-3)', fontStyle: 'italic', padding: '8px 0' }}>Not yet generated</div>

  // Plain string — render as readable text block
  if (typeof data === 'string')
    return <div style={{ fontSize: 12, color: 'var(--text-1)', lineHeight: 1.6, padding: '8px 10px', background: 'var(--bg-2)', borderRadius: 6, border: '1px solid var(--line-2)' }}>{data}</div>

  // Array of objects with 'name' key — could be characters, levels, mechanics, features
  if (Array.isArray(data) && data.length > 0 && typeof data[0] === 'object' && data[0] !== null) {
    const items = data as Record<string, unknown>[]
    // Characters
    if ('role' in items[0] && 'abilities' in items[0]) {
      return <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>{items.map((c, i) => <CharacterChip key={i} c={c} />)}</div>
    }
    // Levels
    if ('order' in items[0] && 'environment' in items[0]) {
      return <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>{items.map((l, i) => <LevelChip key={i} l={l} />)}</div>
    }
    // Mechanics
    if ('type' in items[0] && 'description' in items[0] && !('role' in items[0])) {
      return <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>{items.map((m, i) => <MechanicChip key={i} m={m} />)}</div>
    }
    // Generic array
    return renderGenericValue(data)
  }

  // Plain object — key-value
  if (typeof data === 'object' && !Array.isArray(data)) {
    const obj = data as Record<string, unknown>
    // Filter meta fields
    const entries = Object.entries(obj).filter(([k]) => k !== 'approved' && k !== 'approved_at' && k !== 'placeholder')
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 7 }}>
        {entries.map(([k, v]) => (
          <div key={k} style={{ display: 'grid', gridTemplateColumns: '100px 1fr', gap: 8 }}>
            <span style={{ fontFamily: 'var(--font-mono)', fontSize: 9, textTransform: 'uppercase', letterSpacing: '0.08em', color: 'var(--text-3)', paddingTop: 2 }}>
              {k.replace(/_/g, ' ')}
            </span>
            <div style={{ minWidth: 0 }}>
              {renderGenericValue(v)}
            </div>
          </div>
        ))}
      </div>
    )
  }

  return renderGenericValue(data)
}

/* ─── Main component ─── */

export function InputContext({ stepKey, project, nodeContext }: { stepKey: string; project: Project; nodeContext?: Record<string, unknown> }) {
  // Canvas-driven: use actual connected parents. Fall back to hardcoded only when no nodeContext provided.
  const sources: InputSource[] = nodeContext != null
    ? Object.entries(nodeContext).map(([key, data]) => ({
        label: SOURCE_META[key]?.label ?? key.replace(/_/g, ' '),
        color: SOURCE_META[key]?.color ?? 'var(--cat-design)',
        data,
      }))
    : getInputSources(stepKey, project)

  if (!sources.length) return null

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
      <div style={{ fontSize: 11, color: 'var(--text-3)', fontFamily: 'var(--font-mono)', padding: '8px 12px', background: 'color-mix(in oklch, var(--cat-design) 6%, var(--bg-2))', border: '1px solid color-mix(in oklch, var(--cat-design) 15%, transparent)', borderRadius: 6 }}>
        The following data sources are used as input to generate this step.
      </div>

      {sources.map((source, i) => {
        const hasData = source.data != null && (Array.isArray(source.data) ? (source.data as unknown[]).length > 0 : true)
        return (
          <div key={i}>
            {/* Source header */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
              <div style={{ width: 3, height: 16, borderRadius: 2, background: source.color, flexShrink: 0 }} />
              <span style={{ fontFamily: 'var(--font-mono)', fontSize: 10, textTransform: 'uppercase', letterSpacing: '0.1em', color: source.color }}>
                {source.label}
              </span>
              {!hasData && (
                <span style={{ fontSize: 9, fontFamily: 'var(--font-mono)', color: 'var(--text-3)', background: 'var(--bg-3)', border: '1px solid var(--line-2)', padding: '1px 7px', borderRadius: 99 }}>
                  pending
                </span>
              )}
            </div>
            {/* Source data */}
            <div style={{ paddingLeft: 11, borderLeft: `1px solid color-mix(in oklch, ${source.color} 25%, var(--line-2))` }}>
              {renderSourceData(source.data)}
            </div>
          </div>
        )
      })}
    </div>
  )
}
