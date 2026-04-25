'use client'

import { useState } from 'react'
import type { Node } from '@xyflow/react'
import type { ForgeNodeData } from './ForgeNode'
import { CAT_VAR } from './ForgeNode'
import DetailModal from './DetailModal'
import type {
  Project, GameFormData, GDD, ValidationResult,
  SpritePreview, ScriptFile,
} from '@/lib/types'
import {
  validateIdea, generateGDD, approveStep1,
  generateSprites, approveStep2,
  generateLevels, approveStep3,
  generateCode, approveStep4,
  generateAudio, approveStep5,
  exportProject,
  generateVisualGuide, generateBackgrounds, generateSfx, generateConceptArt,
  generateUIUX, generateIcons, generateHUD, approveNode,
  generateModeling, generateCharaters, generateVfx, generateTexturing,
  generateRigging, generateLighting, generateAnimation, generateCinematics, generateVoice,
  assetUrl,
  type VisualGuide, type BackgroundPreview, type SfxEntry, type ConceptArtResult,
  type UIUXResult, type IconsResult, type HUDResult,
} from '@/lib/api'

/* ─── Shared sub-components ─── */

function SectionTitle({ children }: { children: React.ReactNode }) {
  return (
    <div style={{
      fontFamily: 'var(--font-mono)', fontSize: 10,
      textTransform: 'uppercase', letterSpacing: '0.08em',
      color: 'var(--text-3)', marginBottom: 6,
    }}>{children}</div>
  )
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
      <label style={{ fontSize: 10, color: 'var(--text-2)', fontFamily: 'var(--font-mono)' }}>{label}</label>
      {children}
    </div>
  )
}

const INPUT_STYLE: React.CSSProperties = {
  background: 'var(--bg-2)', border: '1px solid var(--line-2)',
  borderRadius: 4, padding: '6px 8px',
  color: 'var(--text-0)', fontFamily: 'var(--font-sans)', fontSize: 11,
  outline: 'none', width: '100%',
}

const SELECT_STYLE: React.CSSProperties = { ...INPUT_STYLE, cursor: 'pointer' }

function ActionBtn({
  label, onClick, variant = 'run', disabled = false,
}: {
  label: string; onClick: () => void; variant?: 'run' | 'approve' | 'reject' | 'ghost'; disabled?: boolean
}) {
  const styles: Record<string, React.CSSProperties> = {
    run:     { background: 'var(--cat-code)', color: '#0a0a0c', border: '1px solid transparent' },
    approve: { background: 'color-mix(in oklch, var(--cat-code) 14%, var(--bg-2))', border: '1px solid color-mix(in oklch, var(--cat-code) 45%, transparent)', color: 'var(--cat-code)' },
    reject:  { background: 'color-mix(in oklch, var(--cat-output) 12%, var(--bg-2))', border: '1px solid color-mix(in oklch, var(--cat-output) 40%, transparent)', color: 'var(--cat-output)' },
    ghost:   { background: 'var(--bg-2)', border: '1px solid var(--line-2)', color: 'var(--text-1)' },
  }
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      style={{
        display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
        width: '100%', height: 32, borderRadius: 5,
        fontSize: 12, fontWeight: 600, cursor: disabled ? 'not-allowed' : 'pointer',
        transition: 'all 100ms', fontFamily: 'var(--font-sans)',
        opacity: disabled ? 0.4 : 1,
        ...styles[variant],
      }}
    >{label}</button>
  )
}

function MonoRow({ k, v, accent }: { k: string; v: string; accent?: boolean }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', fontFamily: 'var(--font-mono)', fontSize: 10, gap: 6 }}>
      <span style={{ color: 'var(--text-3)' }}>{k}</span>
      <span style={{ color: accent ? 'var(--node-color, var(--text-1))' : 'var(--text-1)', textAlign: 'right', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 160 }}>{v}</span>
    </div>
  )
}

function Divider() {
  return <div style={{ height: 1, background: 'var(--line)', margin: '4px 0' }} />
}

/* ─── GDD param schema (driven by lib/gdd-params.json) ─── */

import { exportGDDToPDF } from '@/lib/gdd-pdf'
import GDD_PARAMS_RAW from '@/lib/gdd-params.json'
import GDD_RULES_RAW from '@/lib/gdd-param-rules.json'

interface ParamOption { value: string; label: string }
interface GDDParam {
  id: string
  label: string
  type: 'select' | 'multiselect' | 'text'
  default: string | string[]
  promptKey: string
  options?: ParamOption[]
  placeholder?: string
}

const GDD_PARAMS = GDD_PARAMS_RAW as GDDParam[]

interface ParamRule {
  id: string
  severity: 'low' | 'medium' | 'high'
  message: string
  conditions: { param: string; values: string[] }[]
}

const GDD_RULES = GDD_RULES_RAW as ParamRule[]

function evalRules(values: Record<string, string | string[]>): ParamRule[] {
  return GDD_RULES.filter(rule =>
    rule.conditions.every(cond => {
      const v = values[cond.param]
      if (Array.isArray(v)) return v.some(x => cond.values.includes(x))
      return cond.values.includes(v as string)
    })
  )
}

function initParamValues(): Record<string, string | string[]> {
  return Object.fromEntries(GDD_PARAMS.map(p => [p.id, p.default]))
}

interface SavedGDDInput {
  ideaPrompt: string
  params: Record<string, string | string[]>
}

function saveGDDInput(projectId: string, data: SavedGDDInput) {
  try { localStorage.setItem(`forge:gdd-input:${projectId}`, JSON.stringify(data)) } catch {}
}

function loadGDDInput(projectId: string): SavedGDDInput | null {
  try {
    const raw = localStorage.getItem(`forge:gdd-input:${projectId}`)
    return raw ? JSON.parse(raw) : null
  } catch { return null }
}

function buildParamPrompt(values: Record<string, string | string[]>): string {
  const lines: string[] = []
  for (const p of GDD_PARAMS) {
    const v = values[p.id]
    if (!v || (Array.isArray(v) && v.length === 0) || v === '') continue
    const display = Array.isArray(v) ? v.join(', ') : v
    lines.push(`${p.promptKey}: ${display}`)
  }
  return lines.join('\n')
}

/* Multi-select chip toggle */
function ChipGroup({ param, value, onChange }: {
  param: GDDParam
  value: string[]
  onChange: (v: string[]) => void
}) {
  function toggle(opt: string) {
    onChange(value.includes(opt) ? value.filter(x => x !== opt) : [...value, opt])
  }
  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5 }}>
      {(param.options ?? []).map(opt => {
        const active = value.includes(opt.value)
        return (
          <button
            key={opt.value}
            type="button"
            onClick={() => toggle(opt.value)}
            style={{
              padding: '4px 9px', borderRadius: 4, fontSize: 10,
              fontFamily: 'var(--font-sans)', cursor: 'pointer',
              transition: 'all 80ms',
              background: active
                ? 'color-mix(in oklch, var(--cat-design) 18%, var(--bg-2))'
                : 'var(--bg-3)',
              border: active
                ? '1px solid color-mix(in oklch, var(--cat-design) 55%, transparent)'
                : '1px solid var(--line-2)',
              color: active ? 'var(--cat-design)' : 'var(--text-2)',
            }}
          >
            {opt.label}
          </button>
        )
      })}
    </div>
  )
}

/* Render a single param field */
function ParamField({ param, value, onChange }: {
  param: GDDParam
  value: string | string[]
  onChange: (id: string, v: string | string[]) => void
}) {
  if (param.type === 'multiselect') {
    return (
      <Field label={param.label}>
        <ChipGroup param={param} value={value as string[]} onChange={v => onChange(param.id, v)} />
      </Field>
    )
  }
  if (param.type === 'text') {
    return (
      <Field label={param.label}>
        <input
          value={value as string}
          onChange={e => onChange(param.id, e.target.value)}
          placeholder={param.placeholder ?? ''}
          style={INPUT_STYLE}
        />
      </Field>
    )
  }
  return (
    <Field label={param.label}>
      <select value={value as string} onChange={e => onChange(param.id, e.target.value)} style={SELECT_STYLE}>
        {(param.options ?? []).map(opt => (
          <option key={opt.value} value={opt.value}>{opt.label}</option>
        ))}
      </select>
    </Field>
  )
}

const SEVERITY_STYLE: Record<ParamRule['severity'], { bg: string; border: string; color: string; icon: string }> = {
  high:   { bg: 'color-mix(in oklch, var(--cat-output) 8%, var(--bg-2))',  border: 'color-mix(in oklch, var(--cat-output) 30%, transparent)',  color: 'var(--cat-output)', icon: '⚠' },
  medium: { bg: 'color-mix(in oklch, var(--cat-gate) 8%, var(--bg-2))',    border: 'color-mix(in oklch, var(--cat-gate) 30%, transparent)',    color: 'var(--cat-gate)',   icon: '⚡' },
  low:    { bg: 'color-mix(in oklch, var(--cat-audio) 7%, var(--bg-2))',   border: 'color-mix(in oklch, var(--cat-audio) 25%, transparent)',   color: 'var(--cat-audio)',  icon: '◌' },
}

function ParamWarnings({ values }: { values: Record<string, string | string[]> }) {
  const warnings = evalRules(values)
  if (warnings.length === 0) return null
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
      {warnings.map(w => {
        const s = SEVERITY_STYLE[w.severity]
        return (
          <div key={w.id} style={{
            display: 'flex', gap: 7, alignItems: 'flex-start',
            background: s.bg, border: `1px solid ${s.border}`,
            borderRadius: 5, padding: '6px 9px',
          }}>
            <span style={{ color: s.color, fontSize: 11, flexShrink: 0, marginTop: 1 }}>{s.icon}</span>
            <span style={{ fontSize: 10, color: 'var(--text-1)', fontFamily: 'var(--font-sans)', lineHeight: 1.5 }}>
              {w.message}
            </span>
          </div>
        )
      })}
    </div>
  )
}

/* ─── GDD full preview modal (pre-approval) ─── */

type GDDTab = 'overview' | 'characters' | 'levels' | 'direction' | 'dev'

function GDDPreviewModal({ gdd, onClose }: { gdd: GDD; onClose: () => void }) {
  const [tab, setTab] = useState<GDDTab>('overview')

  const TYPE_COLOR: Record<string, string> = {
    core: 'var(--cat-code)', secondary: 'var(--cat-gate)', progression: 'var(--cat-design)',
  }
  const ROLE_COLOR: Record<string, string> = {
    hero: 'var(--cat-design)', enemy: 'var(--cat-output)', npc: 'var(--cat-asset)', boss: 'oklch(0.65 0.25 340)',
  }
  const DIFF_COLOR: Record<string, string> = {
    easy: 'var(--cat-code)', medium: 'var(--cat-gate)', hard: 'var(--cat-output)', boss: 'oklch(0.65 0.25 340)',
  }
  const mechNames: Record<string, string> = Object.fromEntries(gdd.mechanics.map(m => [m.id, m.name]))

  const TABS: { id: GDDTab; label: string; count?: number }[] = [
    { id: 'overview',    label: 'Overview' },
    { id: 'characters',  label: 'Characters', count: gdd.characters.length },
    { id: 'levels',      label: 'Levels',     count: gdd.levels.length },
    { id: 'direction',   label: 'Direction' },
    { id: 'dev',         label: 'Dev' },
  ]

  return (
    <div
      onClick={onClose}
      style={{
        position: 'fixed', inset: 0, zIndex: 1000,
        background: 'rgba(0,0,0,0.65)', backdropFilter: 'blur(4px)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        padding: '24px 16px',
      }}
    >
      <div
        onClick={e => e.stopPropagation()}
        style={{
          background: 'var(--bg-1)', border: '1px solid var(--line)',
          borderRadius: 12, width: '100%', maxWidth: 680,
          display: 'flex', flexDirection: 'column',
          maxHeight: 'calc(100vh - 48px)',
        }}
      >
        {/* Header — fixed */}
        <div style={{ padding: '20px 24px 0', flexShrink: 0 }}>
          <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12, marginBottom: 16 }}>
            <div>
              <div style={{ fontWeight: 700, fontSize: 17, color: 'var(--text-0)', marginBottom: 3 }}>{gdd.project.name}</div>
              <div style={{ fontSize: 11, color: 'var(--text-2)', lineHeight: 1.5 }}>{gdd.project.elevator_pitch}</div>
            </div>
            <button onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-3)', fontSize: 18, flexShrink: 0, paddingTop: 2 }}>✕</button>
          </div>

          {/* Tab bar */}
          <div style={{ display: 'flex', gap: 2, borderBottom: '1px solid var(--line)' }}>
            {TABS.map(t => {
              const active = tab === t.id
              return (
                <button
                  key={t.id}
                  onClick={() => setTab(t.id)}
                  style={{
                    background: 'none', border: 'none', cursor: 'pointer',
                    padding: '7px 12px', fontFamily: 'var(--font-sans)', fontSize: 11,
                    fontWeight: active ? 600 : 400,
                    color: active ? 'var(--text-0)' : 'var(--text-3)',
                    borderBottom: active ? '2px solid var(--node-color, var(--cat-design))' : '2px solid transparent',
                    marginBottom: -1, transition: 'color 100ms',
                    display: 'flex', alignItems: 'center', gap: 5,
                  }}
                >
                  {t.label}
                  {t.count !== undefined && (
                    <span style={{
                      fontFamily: 'var(--font-mono)', fontSize: 9,
                      color: active ? 'var(--node-color, var(--cat-design))' : 'var(--text-3)',
                      background: 'var(--bg-3)', padding: '1px 5px', borderRadius: 8,
                    }}>{t.count}</span>
                  )}
                </button>
              )
            })}
          </div>
        </div>

        {/* Tab content — scrollable */}
        <div style={{ overflowY: 'auto', padding: '20px 24px', display: 'flex', flexDirection: 'column', gap: 12, flex: 1 }}>

          {/* ── Overview ── */}
          {tab === 'overview' && (
            <>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
                {[
                  ['Genre', gdd.project.genre], ['Tone', gdd.project.tone],
                  ['Engine', gdd.development.suggested_engine], ['Scope', gdd.development.estimated_scope],
                  ['Platform', gdd.project.target_platform ?? '–'], ['Camera', gdd.project.camera ?? '–'],
                ].map(([k, v]) => (
                  <div key={k} style={{ background: 'var(--bg-2)', border: '1px solid var(--line-2)', borderRadius: 6, padding: '8px 12px' }}>
                    <div style={{ fontFamily: 'var(--font-mono)', fontSize: 9, color: 'var(--text-3)', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 3 }}>{k}</div>
                    <div style={{ fontSize: 12, color: 'var(--text-0)', fontWeight: 500 }}>{v}</div>
                  </div>
                ))}
              </div>
              {gdd.project.core_loop && (
                <div style={{ background: 'var(--bg-2)', border: '1px solid var(--line-2)', borderRadius: 6, padding: '10px 14px' }}>
                  <div style={{ fontFamily: 'var(--font-mono)', fontSize: 9, color: 'var(--text-3)', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 5 }}>Core Loop</div>
                  <div style={{ fontSize: 12, color: 'var(--text-1)', lineHeight: 1.6 }}>{gdd.project.core_loop}</div>
                </div>
              )}
              <div style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color: 'var(--text-3)', textTransform: 'uppercase', letterSpacing: '0.1em', borderBottom: '1px solid var(--line)', paddingBottom: 6, marginTop: 4 }}>
                Mechanics ({gdd.mechanics.length})
              </div>
              {gdd.mechanics.map((m, i) => (
                <div key={i} style={{ background: 'var(--bg-2)', border: '1px solid var(--line-2)', borderRadius: 6, padding: '10px 14px' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
                    <span style={{ fontWeight: 600, fontSize: 12, color: 'var(--text-0)' }}>{m.name}</span>
                    <span style={{ fontFamily: 'var(--font-mono)', fontSize: 9, color: TYPE_COLOR[m.type] ?? 'var(--text-3)', background: `color-mix(in oklch, ${TYPE_COLOR[m.type] ?? 'var(--text-3)'} 10%, var(--bg-3))`, padding: '2px 7px', borderRadius: 3 }}>{m.type}</span>
                  </div>
                  <div style={{ fontSize: 11, color: 'var(--text-2)', lineHeight: 1.5 }}>{m.description}</div>
                  {m.gameplay_tags && m.gameplay_tags.length > 0 && (
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 3, marginTop: 6 }}>
                      {m.gameplay_tags.map((t, j) => (
                        <span key={j} style={{ fontFamily: 'var(--font-mono)', fontSize: 9, color: 'var(--text-3)', background: 'var(--bg-3)', padding: '2px 6px', borderRadius: 3 }}>{t}</span>
                      ))}
                    </div>
                  )}
                </div>
              ))}
            </>
          )}

          {/* ── Characters ── */}
          {tab === 'characters' && gdd.characters.map((c, i) => (
            <div key={i} style={{ background: 'var(--bg-2)', border: '1px solid var(--line-2)', borderRadius: 6, padding: '10px 14px' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
                <span style={{ fontWeight: 600, fontSize: 12, color: 'var(--text-0)' }}>{c.name}</span>
                <span style={{ fontFamily: 'var(--font-mono)', fontSize: 9, color: ROLE_COLOR[c.role] ?? 'var(--text-3)', background: `color-mix(in oklch, ${ROLE_COLOR[c.role] ?? 'var(--text-3)'} 10%, var(--bg-3))`, padding: '2px 7px', borderRadius: 3 }}>{c.role}</span>
              </div>
              <div style={{ fontSize: 11, color: 'var(--text-2)', lineHeight: 1.5, marginBottom: c.personality ? 4 : 6 }}>{c.description}</div>
              {c.personality && (
                <div style={{ fontSize: 10, color: 'var(--text-3)', fontStyle: 'italic', marginBottom: 6, lineHeight: 1.4 }}>{c.personality}</div>
              )}
              {c.abilities && c.abilities.length > 0 && (
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, marginBottom: 6 }}>
                  {c.abilities.map((a, j) => (
                    <span key={j} style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color: 'var(--text-2)', background: 'var(--bg-3)', border: '1px solid var(--line-2)', padding: '2px 7px', borderRadius: 3 }}>
                      {typeof a === 'string' ? a : a.name}
                    </span>
                  ))}
                </div>
              )}
              {c.gameplay_tags && c.gameplay_tags.length > 0 && (
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 3, marginBottom: 6 }}>
                  {c.gameplay_tags.map((t, j) => (
                    <span key={j} style={{ fontFamily: 'var(--font-mono)', fontSize: 9, color: 'var(--cat-design)', background: 'color-mix(in oklch, var(--cat-design) 10%, var(--bg-3))', padding: '2px 6px', borderRadius: 3 }}>{t}</span>
                  ))}
                </div>
              )}
              {c.sprite_prompt && (
                <div style={{ borderTop: '1px solid var(--line-2)', paddingTop: 7, marginTop: 4 }}>
                  <div style={{ fontFamily: 'var(--font-mono)', fontSize: 9, color: 'var(--cat-asset)', marginBottom: 4, textTransform: 'uppercase', letterSpacing: '0.06em' }}>Sprite prompt</div>
                  <div style={{ fontSize: 10, color: 'var(--text-1)', lineHeight: 1.6, background: 'var(--bg-3)', borderRadius: 4, padding: '6px 9px' }}>{c.sprite_prompt}</div>
                </div>
              )}
            </div>
          ))}

          {/* ── Levels ── */}
          {tab === 'levels' && gdd.levels.map((l, i) => (
            <div key={i} style={{ background: 'var(--bg-2)', border: '1px solid var(--line-2)', borderRadius: 6, padding: '10px 14px' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
                <span style={{ fontFamily: 'var(--font-mono)', fontSize: 9, color: 'var(--text-3)' }}>#{l.order ?? i + 1}</span>
                <span style={{ fontWeight: 600, fontSize: 12, color: 'var(--text-0)' }}>{l.name}</span>
                <span style={{ fontFamily: 'var(--font-mono)', fontSize: 9, color: DIFF_COLOR[l.difficulty] ?? 'var(--text-3)', background: `color-mix(in oklch, ${DIFF_COLOR[l.difficulty] ?? 'var(--text-3)'} 10%, var(--bg-3))`, padding: '2px 7px', borderRadius: 3 }}>{l.difficulty}</span>
              </div>
              <div style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color: 'var(--text-3)', marginBottom: 4 }}>{l.environment}</div>
              <div style={{ fontSize: 11, color: 'var(--text-2)', lineHeight: 1.5 }}>{l.description}</div>
              {l.objectives && l.objectives.length > 0 && (
                <div style={{ marginTop: 5 }}>
                  {l.objectives.map((o, j) => (
                    <div key={j} style={{ fontSize: 10, color: 'var(--text-2)', lineHeight: 1.5 }}>› {o}</div>
                  ))}
                </div>
              )}
              {l.introduced_mechanics && l.introduced_mechanics.length > 0 && (
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, marginTop: 6 }}>
                  {l.introduced_mechanics.map((mid, j) => (
                    <span key={j} style={{ fontFamily: 'var(--font-mono)', fontSize: 9, color: 'var(--cat-code)', background: 'color-mix(in oklch, var(--cat-code) 10%, var(--bg-3))', padding: '2px 6px', borderRadius: 3 }}>
                      {mechNames[mid] ?? mid}
                    </span>
                  ))}
                </div>
              )}
              {l.background_prompt && (
                <div style={{ borderTop: '1px solid var(--line-2)', paddingTop: 7, marginTop: 6 }}>
                  <div style={{ fontFamily: 'var(--font-mono)', fontSize: 9, color: 'var(--cat-asset)', marginBottom: 4, textTransform: 'uppercase', letterSpacing: '0.06em' }}>Background prompt</div>
                  <div style={{ fontSize: 10, color: 'var(--text-1)', lineHeight: 1.6, background: 'var(--bg-3)', borderRadius: 4, padding: '6px 9px' }}>{l.background_prompt}</div>
                </div>
              )}
            </div>
          ))}

          {/* ── Direction (Art + Audio) ── */}
          {tab === 'direction' && (
            <>
              <div style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color: 'var(--text-3)', textTransform: 'uppercase', letterSpacing: '0.1em', borderBottom: '1px solid var(--line)', paddingBottom: 6 }}>Art Direction</div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
                {[
                  ['Style', gdd.art_direction.style],
                  ['Palette', gdd.art_direction.palette],
                  ['Sprite res.', gdd.art_direction.sprite_resolution ?? gdd.art_direction.resolution ?? '–'],
                  ['Background res.', gdd.art_direction.background_resolution ?? '–'],
                  ['Lighting', gdd.art_direction.lighting_style ?? '–'],
                  ['UI style', gdd.art_direction.ui_style ?? '–'],
                ].map(([k, v]) => (
                  <div key={k} style={{ background: 'var(--bg-2)', border: '1px solid var(--line-2)', borderRadius: 6, padding: '8px 12px' }}>
                    <div style={{ fontFamily: 'var(--font-mono)', fontSize: 9, color: 'var(--text-3)', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 3 }}>{k}</div>
                    <div style={{ fontSize: 12, color: 'var(--text-0)', fontWeight: 500 }}>{v}</div>
                  </div>
                ))}
              </div>
              {gdd.art_direction.references && gdd.art_direction.references.length > 0 && (
                <div style={{ background: 'var(--bg-2)', border: '1px solid var(--line-2)', borderRadius: 6, padding: '8px 12px' }}>
                  <div style={{ fontFamily: 'var(--font-mono)', fontSize: 9, color: 'var(--text-3)', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 5 }}>References</div>
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
                    {gdd.art_direction.references.map((r, i) => (
                      <span key={i} style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color: 'var(--cat-design)', background: 'color-mix(in oklch, var(--cat-design) 10%, var(--bg-3))', border: '1px solid color-mix(in oklch, var(--cat-design) 25%, transparent)', padding: '2px 8px', borderRadius: 3 }}>{r}</span>
                    ))}
                  </div>
                </div>
              )}

              <div style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color: 'var(--text-3)', textTransform: 'uppercase', letterSpacing: '0.1em', borderBottom: '1px solid var(--line)', paddingBottom: 6, marginTop: 8 }}>Audio Direction</div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
                {[
                  ['Mood', gdd.audio_direction.music_mood],
                  ['Style', gdd.audio_direction.music_style],
                  ['Adaptive', gdd.audio_direction.adaptive_audio ?? '–'],
                  ['SFX notes', gdd.audio_direction.sfx_notes],
                ].map(([k, v]) => (
                  <div key={k} style={{ background: 'var(--bg-2)', border: '1px solid var(--line-2)', borderRadius: 6, padding: '8px 12px' }}>
                    <div style={{ fontFamily: 'var(--font-mono)', fontSize: 9, color: 'var(--text-3)', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 3 }}>{k}</div>
                    <div style={{ fontSize: 12, color: 'var(--text-0)', fontWeight: 500 }}>{v}</div>
                  </div>
                ))}
              </div>
            </>
          )}

          {/* ── Dev ── */}
          {tab === 'dev' && (
            <>
              {gdd.development.core_features && gdd.development.core_features.length > 0 && (
                <div style={{ background: 'var(--bg-2)', border: '1px solid var(--line-2)', borderRadius: 6, padding: '10px 14px' }}>
                  <div style={{ fontFamily: 'var(--font-mono)', fontSize: 9, color: 'var(--cat-code)', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 6 }}>Core Features</div>
                  {gdd.development.core_features.map((f, i) => (
                    <div key={i} style={{ fontSize: 11, color: 'var(--text-1)', lineHeight: 1.7 }}>› {f}</div>
                  ))}
                </div>
              )}
              {gdd.development.out_of_scope && gdd.development.out_of_scope.length > 0 && (
                <div style={{ background: 'var(--bg-2)', border: '1px solid var(--line-2)', borderRadius: 6, padding: '10px 14px' }}>
                  <div style={{ fontFamily: 'var(--font-mono)', fontSize: 9, color: 'var(--cat-output)', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 6 }}>Out of Scope</div>
                  {gdd.development.out_of_scope.map((f, i) => (
                    <div key={i} style={{ fontSize: 11, color: 'var(--text-2)', lineHeight: 1.7 }}>✕ {f}</div>
                  ))}
                </div>
              )}
              {gdd.development.technical_risks && gdd.development.technical_risks.length > 0 && (
                <div style={{ background: 'var(--bg-2)', border: '1px solid var(--line-2)', borderRadius: 6, padding: '10px 14px' }}>
                  <div style={{ fontFamily: 'var(--font-mono)', fontSize: 9, color: 'var(--cat-gate)', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 6 }}>Technical Risks</div>
                  {gdd.development.technical_risks.map((r, i) => (
                    <div key={i} style={{ fontSize: 11, color: 'var(--text-2)', lineHeight: 1.7 }}>⚡ {r}</div>
                  ))}
                </div>
              )}
              {gdd.systems && Object.values(gdd.systems).some(Boolean) && (
                <div style={{ background: 'var(--bg-2)', border: '1px solid var(--line-2)', borderRadius: 6, padding: '10px 14px' }}>
                  <div style={{ fontFamily: 'var(--font-mono)', fontSize: 9, color: 'var(--text-3)', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 8 }}>Game Systems</div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                    {Object.entries(gdd.systems).filter(([, v]) => v).map(([k, v]) => (
                      <div key={k}>
                        <div style={{ fontFamily: 'var(--font-mono)', fontSize: 9, color: 'var(--text-3)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 2 }}>{k.replace(/_/g, ' ')}</div>
                        <div style={{ fontSize: 11, color: 'var(--text-1)', lineHeight: 1.5 }}>{v}</div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </>
          )}

        </div>

        {/* Footer — fixed */}
        <div style={{ padding: '12px 24px', borderTop: '1px solid var(--line)', flexShrink: 0, display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10 }}>
          <button
            onClick={() => exportGDDToPDF(gdd)}
            style={{
              display: 'flex', alignItems: 'center', gap: 6,
              background: 'var(--bg-2)', border: '1px solid var(--line-2)',
              borderRadius: 6, padding: '7px 14px',
              color: 'var(--text-2)', fontFamily: 'var(--font-sans)', fontSize: 11, cursor: 'pointer',
            }}
          >
            ⬇ Export PDF
          </button>
          <button
            onClick={onClose}
            style={{ background: 'var(--bg-2)', border: '1px solid var(--line-2)', borderRadius: 6, padding: '7px 28px', color: 'var(--text-1)', fontFamily: 'var(--font-sans)', fontSize: 12, cursor: 'pointer' }}
          >
            Cerrar
          </button>
        </div>
      </div>
    </div>
  )
}

/* ─── New-game flow (shown in GDD node when project=null) ─── */

type NewGamePhase = 'form' | 'validating' | 'generating' | 'review'

interface NewGamePanelProps {
  onProjectCreated: (project: Project) => void
  onLog: (msg: string) => void
}

function NewGamePanel({ onProjectCreated, onLog }: NewGamePanelProps) {
  const [phase, setPhase] = useState<NewGamePhase>('form')
  const [approving, setApproving] = useState(false)
  const [showGDDPreview, setShowGDDPreview] = useState(false)
  const [ideaPrompt, setIdeaPrompt] = useState('')
  const [params, setParams] = useState<Record<string, string | string[]>>(initParamValues)
  const [showParams, setShowParams] = useState(true)
  const [validation, setValidation] = useState<ValidationResult | null>(null)
  const [gdd, setGdd] = useState<GDD | null>(null)
  const [meta, setMeta] = useState<unknown>(null)
  const [error, setError] = useState<string | null>(null)

  function setParam(id: string, v: string | string[]) {
    setParams(prev => ({ ...prev, [id]: v }))
  }

  function buildFullPrompt(): string {
    const paramLines = buildParamPrompt(params)
    return [ideaPrompt.trim(), paramLines].filter(Boolean).join('\n')
  }

  async function doGenerate(fullPrompt: string) {
    setPhase('generating')
    setError(null)
    try {
      const res = await generateGDD(fullPrompt)
      setGdd(res.gdd)
      setMeta(res.meta)
      setPhase('review')
      onLog('GDD generated — review and approve')
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Generation failed')
      setPhase('form')
    }
  }

  async function handleSubmit() {
    if (ideaPrompt.trim().length < 10) return
    setError(null)
    setPhase('validating')
    const fullPrompt = buildFullPrompt()
    try {
      const genre    = (params.genre          as string[]).join(', ') || undefined
      const tone     = (params.tone           as string[]).join(', ') || undefined
      const audience = (params.target_audience as string[]).join(', ') || undefined
      const v = await validateIdea({
        prompt: fullPrompt,
        genre,
        tone,
        scope:      params.scope       as string || undefined,
        engine:     params.engine      as string || undefined,
        audience,
        references: params.inspiration as string || undefined,
      })
      setValidation(v)
      onLog(`Validation: ${v.coherence_score}/100`)
      if (v.coherence_score >= 60) {
        await doGenerate(fullPrompt)
      } else {
        setPhase('form')
        setError(`Low coherence (${v.coherence_score}/100): ${v.coherence_summary}`)
      }
    } catch {
      await doGenerate(fullPrompt)
    }
  }

  async function handleApprove() {
    if (!gdd) return
    setApproving(true)
    setError(null)
    const payload = { gdd, prompt: buildFullPrompt(), meta }
    for (let attempt = 1; attempt <= 2; attempt++) {
      try {
        if (attempt > 1) {
          onLog('Retrying… (Supabase cold start, please wait)')
          await new Promise(r => setTimeout(r, 2000))
        } else {
          onLog('Creating project… (may take ~60s on first run)')
        }
        const res = await approveStep1(payload)
        saveGDDInput(res.project.id, { ideaPrompt, params })
        onLog('Project created!')
        onProjectCreated(res.project)
        return
      } catch (e) {
        if (attempt === 2) {
          setError(e instanceof Error ? e.message : 'Failed to create project')
          setApproving(false)
        }
      }
    }
  }

  /* ── Review ── */
  if (phase === 'review' && gdd) {
    return (
      <>
        {showGDDPreview && <GDDPreviewModal gdd={gdd} onClose={() => setShowGDDPreview(false)} />}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <SectionTitle>GDD Preview</SectionTitle>
          <div style={{ background: 'var(--bg-2)', border: '1px solid var(--line-2)', borderRadius: 6, padding: '10px 12px', display: 'flex', flexDirection: 'column', gap: 6 }}>
            <div style={{ fontWeight: 600, fontSize: 13, color: 'var(--text-0)', marginBottom: 2 }}>{gdd.project.name}</div>
            <MonoRow k="genre"  v={gdd.project.genre} accent />
            <MonoRow k="tone"   v={gdd.project.tone} />
            <MonoRow k="engine" v={gdd.development.suggested_engine} />
            <MonoRow k="scope"  v={gdd.development.estimated_scope} />
            <Divider />
            <div style={{ fontSize: 11, color: 'var(--text-2)', lineHeight: 1.55 }}>{gdd.project.elevator_pitch}</div>
          </div>
          <div style={{ background: 'var(--bg-2)', border: '1px solid var(--line-2)', borderRadius: 6, padding: '8px 12px', display: 'flex', flexDirection: 'column', gap: 4 }}>
            <MonoRow k="mechanics"  v={String(gdd.mechanics.length)} />
            <MonoRow k="levels"     v={String(gdd.levels.length)} />
            <MonoRow k="characters" v={String(gdd.characters.length)} />
          </div>
          <ActionBtn label="◈ Ver GDD completo" onClick={() => setShowGDDPreview(true)} variant="ghost" disabled={approving} />
          {error && <div style={{ fontSize: 10, color: 'var(--cat-output)', fontFamily: 'var(--font-mono)', lineHeight: 1.5 }}>{error}</div>}
          <ActionBtn label={approving ? 'Creating project…' : '✓ Approve & create project'} onClick={handleApprove} variant="approve" disabled={approving} />
          <ActionBtn label="↺ Regenerate" onClick={() => doGenerate(buildFullPrompt())} variant="ghost" disabled={approving} />
          <ActionBtn label="← Edit idea" onClick={() => setPhase('form')} variant="ghost" disabled={approving} />
        </div>
      </>
    )
  }

  /* ── Generating / Validating ── */
  if (phase === 'validating' || phase === 'generating') {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 14, padding: '24px 0' }}>
        <div style={{
          width: 28, height: 28,
          background: 'conic-gradient(from 45deg, var(--cat-asset), var(--cat-code), var(--cat-audio), var(--cat-gate), var(--cat-asset))',
          clipPath: 'polygon(50% 0,100% 50%,50% 100%,0 50%)',
          animation: 'spin 1.2s linear infinite',
        }} />
        <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
        <div style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color: 'var(--text-3)', textAlign: 'center', lineHeight: 1.6 }}>
          {phase === 'validating' ? 'Validating idea…' : 'Generating GDD…'}
          {validation && phase === 'generating' && (
            <><br />Coherence: {validation.coherence_score}/100</>
          )}
        </div>
      </div>
    )
  }

  /* ── Form ── */
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      <SectionTitle>New game idea</SectionTitle>
      {error && (
        <div style={{ fontSize: 10, color: 'var(--cat-output)', fontFamily: 'var(--font-mono)', background: 'color-mix(in oklch, var(--cat-output) 8%, var(--bg-2))', border: '1px solid color-mix(in oklch, var(--cat-output) 25%, transparent)', borderRadius: 4, padding: '6px 8px', lineHeight: 1.5 }}>
          {error}
        </div>
      )}

      <Field label="Describe your game">
        <textarea
          value={ideaPrompt}
          onChange={e => setIdeaPrompt(e.target.value)}
          placeholder="e.g. A rogue-like dungeon crawler where you collect spells..."
          rows={5}
          style={{ ...INPUT_STYLE, resize: 'vertical', lineHeight: 1.5, fontFamily: 'var(--font-sans)', fontSize: 11 }}
        />
      </Field>

      <button
        type="button"
        onClick={() => setShowParams(p => !p)}
        style={{ background: 'none', border: 'none', cursor: 'pointer', textAlign: 'left', padding: '2px 0', fontFamily: 'var(--font-mono)', fontSize: 10, color: 'var(--text-3)', display: 'flex', alignItems: 'center', gap: 6 }}
      >
        {showParams ? '▲' : '▼'} Parameters
      </button>

      {showParams && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {GDD_PARAMS.map(param => (
            <ParamField
              key={param.id}
              param={param}
              value={params[param.id]}
              onChange={setParam}
            />
          ))}
        </div>
      )}

      <ParamWarnings values={params} />

      <ActionBtn
        label={ideaPrompt.trim().length < 10 ? 'Min. 10 characters' : '▶ Validate & generate GDD'}
        onClick={handleSubmit}
        variant="run"
        disabled={ideaPrompt.trim().length < 10}
      />
      <div style={{ fontSize: 10, color: 'var(--text-3)', fontFamily: 'var(--font-mono)', textAlign: 'center' }}>
        Ctrl+Enter to submit
      </div>
    </div>
  )
}

/* ─── Per-node result panels ─── */

function SpriteCard({ name, role, prompt, url }: { name: string; role: string; prompt?: string; url?: string }) {
  const [imgErr, setImgErr] = useState(false)
  const src = url ? assetUrl(url) : ''
  return (
    <div style={{ background: 'var(--bg-2)', border: '1px solid var(--line-2)', borderRadius: 6, overflow: 'hidden' }}>
      {src && !imgErr && (
        <img
          src={src}
          alt={name}
          onError={() => setImgErr(true)}
          style={{ width: '100%', height: 120, objectFit: 'cover', display: 'block', borderBottom: '1px solid var(--line-2)' }}
        />
      )}
      <div style={{ padding: '6px 10px' }}>
        <div style={{ fontWeight: 600, fontSize: 11, color: 'var(--text-0)' }}>{name}</div>
        <div style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color: 'var(--cat-asset)', marginTop: 1 }}>{role}</div>
        {prompt && (
          <div style={{ fontSize: 10, color: 'var(--text-3)', marginTop: 4, lineHeight: 1.45, display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>
            {prompt}
          </div>
        )}
      </div>
    </div>
  )
}

function SpritesPanel({ project, onRefresh, onLog }: { project: Project; onRefresh: () => void; onLog: (m: string) => void }) {
  const [busy, setBusy] = useState(false)
  const [sprites, setSprites] = useState<SpritePreview[] | null>(null)
  const approved = (project.current_wizard_step ?? 0) > 2

  async function generate() {
    setBusy(true)
    try {
      onLog('Generating sprites… (this may take 30–60s)')
      const res = await generateSprites(project.id)
      setSprites(res)
      onLog('Sprites ready — review and approve')
    } catch (e) { onLog(e instanceof Error ? e.message : 'Error') }
    finally { setBusy(false) }
  }

  async function approve() {
    if (!sprites && !project.concept?.characters) return
    setBusy(true)
    try {
      const chars = project.concept?.characters ?? []
      const payload = sprites ?? chars.map(c => ({
        character_name: c.name, character_role: c.role,
        sprite_prompt: c.sprite_prompt, preview_url: '', placeholder: true,
      }))
      await approveStep2(project.id, payload)
      onRefresh()
      onLog('Sprites approved')
    } catch (e) { onLog(e instanceof Error ? e.message : 'Error') }
    finally { setBusy(false) }
  }

  const list = sprites ?? (approved ? project.concept?.characters?.map(c => ({
    character_name: c.name, character_role: c.role, sprite_prompt: c.sprite_prompt,
    preview_url: c.preview_url ?? '',
    placeholder: !c.preview_url,
  })) : null)

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      <SectionTitle>Sprites</SectionTitle>
      <MonoRow k="art style" v={project.concept?.art_direction?.style ?? '–'} accent />
      <MonoRow k="resolution" v={project.concept?.art_direction?.sprite_resolution ?? '–'} />
      <MonoRow k="characters" v={String(project.concept?.characters?.length ?? 0)} />
      <Divider />
      {list && list.length > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          {list.map((s, i) => (
            <SpriteCard
              key={i}
              name={s.character_name}
              role={s.character_role}
              prompt={s.sprite_prompt}
              url={s.preview_url}
            />
          ))}
        </div>
      )}
      {!approved && (
        <ActionBtn label={busy ? '⟳ Generating sprites…' : '▶ Generate sprites'} onClick={generate} variant="run" disabled={busy} />
      )}
      {sprites && !approved && (
        <ActionBtn label={busy ? '⟳ Approving…' : '✓ Approve sprites'} onClick={approve} variant="approve" disabled={busy} />
      )}
      {approved && (
        <div style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color: 'var(--cat-code)', textAlign: 'center' }}>✓ Approved</div>
      )}
    </div>
  )
}

type LevelItem = {
  id?: string; name?: string; difficulty?: string; environment?: string;
  description?: string; preview_url?: string; background_prompt?: string;
  introduced_mechanics?: string[]; objectives?: string[]
}

function LevelCard({ level, mechNames }: { level: LevelItem; mechNames: Record<string, string> }) {
  const [imgErr, setImgErr] = useState(false)
  const src = level.preview_url ? assetUrl(level.preview_url) : ''
  const DIFF_COLOR: Record<string, string> = {
    easy: 'var(--cat-code)', medium: 'var(--cat-gate)',
    hard: 'var(--cat-output)', boss: '#ff4488',
  }
  return (
    <div style={{ background: 'var(--bg-2)', border: '1px solid var(--line-2)', borderRadius: 6, overflow: 'hidden' }}>
      {src && !imgErr && (
        <img
          src={src}
          alt={level.name}
          onError={() => setImgErr(true)}
          style={{ width: '100%', height: 90, objectFit: 'cover', display: 'block', borderBottom: '1px solid var(--line-2)' }}
        />
      )}
      <div style={{ padding: '6px 10px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 7, marginBottom: 2 }}>
          <span style={{ fontWeight: 600, fontSize: 11, color: 'var(--text-0)' }}>{level.name}</span>
          {level.difficulty && (
            <span style={{ fontFamily: 'var(--font-mono)', fontSize: 9, color: DIFF_COLOR[level.difficulty] ?? 'var(--text-3)', background: 'var(--bg-3)', padding: '2px 5px', borderRadius: 3 }}>
              {level.difficulty}
            </span>
          )}
        </div>
        {level.environment && (
          <div style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color: 'var(--text-3)', marginBottom: 4 }}>{level.environment}</div>
        )}
        {level.introduced_mechanics && level.introduced_mechanics.length > 0 && (
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 3, marginTop: 3 }}>
            {level.introduced_mechanics.map((mid, i) => (
              <span key={i} style={{ fontSize: 9, fontFamily: 'var(--font-mono)', color: 'var(--cat-design)', background: 'color-mix(in oklch, var(--cat-design) 10%, var(--bg-3))', padding: '2px 6px', borderRadius: 3 }}>
                {mechNames[mid] ?? mid}
              </span>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

function LevelsPanel({ project, onRefresh, onLog }: { project: Project; onRefresh: () => void; onLog: (m: string) => void }) {
  const [busy, setBusy] = useState(false)
  const [levels, setLevels] = useState<LevelItem[] | null>(null)
  const approved = (project.current_wizard_step ?? 0) > 3

  const mechNames: Record<string, string> = Object.fromEntries(
    (project.concept?.mechanics ?? []).map((m: { id: string; name: string }) => [m.id, m.name])
  )

  async function generate() {
    setBusy(true)
    try {
      onLog('Generating levels… (this may take 30–90s)')
      const res = await generateLevels(project.id)
      setLevels(res as LevelItem[])
      onLog('Levels ready — review and approve')
    } catch (e) { onLog(e instanceof Error ? e.message : 'Error') }
    finally { setBusy(false) }
  }

  async function approve() {
    setBusy(true)
    try {
      await approveStep3(project.id, levels ?? project.concept?.levels ?? [])
      onRefresh()
      onLog('Levels approved')
    } catch (e) { onLog(e instanceof Error ? e.message : 'Error') }
    finally { setBusy(false) }
  }

  const displayList: LevelItem[] = levels ?? (project.concept?.levels ?? [])

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      <SectionTitle>Level Design</SectionTitle>
      <MonoRow k="total levels" v={String(displayList.length)} accent />
      <MonoRow k="camera" v={project.concept?.project?.camera ?? '–'} />
      <Divider />
      {displayList.length > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          {displayList.map((l, i) => (
            <LevelCard key={i} level={l} mechNames={mechNames} />
          ))}
        </div>
      )}
      {!approved && (
        <ActionBtn label={busy ? '⟳ Generating levels…' : '▶ Generate levels'} onClick={generate} variant="run" disabled={busy} />
      )}
      {levels && !approved && (
        <ActionBtn label={busy ? '⟳ Approving…' : '✓ Approve levels'} onClick={approve} variant="approve" disabled={busy} />
      )}
      {approved && (
        <div style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color: 'var(--cat-code)', textAlign: 'center' }}>✓ Approved</div>
      )}
    </div>
  )
}

function AudioPanel({ project, onRefresh, onLog }: { project: Project; onRefresh: () => void; onLog: (m: string) => void }) {
  const [busy, setBusy] = useState(false)
  const [audio, setAudio] = useState<{ sfx: unknown[]; music: unknown[] } | null>(null)
  const approved = (project.current_wizard_step ?? 0) > 5

  async function generate() {
    setBusy(true)
    try {
      onLog('Generating audio…')
      const res = await generateAudio(project.id)
      setAudio(res)
      onLog('Audio ready — review and approve')
    } catch (e) { onLog(e instanceof Error ? e.message : 'Error') }
    finally { setBusy(false) }
  }

  async function approve() {
    setBusy(true)
    try {
      await approveStep5(project.id, audio ?? { sfx: [], music: [] })
      onRefresh()
      onLog('Audio approved')
    } catch (e) { onLog(e instanceof Error ? e.message : 'Error') }
    finally { setBusy(false) }
  }

  type SfxTrack = { name: string; trigger?: string; description?: string; mood?: string; duration_ms?: number }
  type MusicTrack = { level_name?: string; mood?: string; style?: string; tempo?: string; description?: string; instruments?: string[] }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      <SectionTitle>Audio Pack</SectionTitle>
      <MonoRow k="mood"  v={project.concept?.audio_direction?.music_mood  ?? '–'} accent />
      <MonoRow k="style" v={project.concept?.audio_direction?.music_style ?? '–'} />
      <MonoRow k="adaptive" v={project.concept?.audio_direction?.adaptive_audio ?? '–'} />
      <Divider />
      {audio && (
        <>
          {(audio.music as MusicTrack[]).length > 0 && (
            <>
              <div style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color: 'var(--text-3)' }}>MUSIC TRACKS</div>
              {(audio.music as MusicTrack[]).map((t, i) => (
                <div key={i} style={{ background: 'var(--bg-2)', border: '1px solid var(--line-2)', borderRadius: 5, padding: '6px 10px' }}>
                  <div style={{ fontWeight: 600, fontSize: 11, color: 'var(--cat-audio)' }}>{t.level_name ?? `Track ${i + 1}`}</div>
                  <div style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color: 'var(--text-3)', marginTop: 2 }}>
                    {[t.style, t.tempo, t.mood].filter(Boolean).join(' · ')}
                  </div>
                  {t.instruments && t.instruments.length > 0 && (
                    <div style={{ fontSize: 10, color: 'var(--text-2)', marginTop: 3 }}>{t.instruments.join(', ')}</div>
                  )}
                </div>
              ))}
            </>
          )}
          {(audio.sfx as SfxTrack[]).length > 0 && (
            <>
              <div style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color: 'var(--text-3)' }}>SFX ({(audio.sfx as SfxTrack[]).length})</div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                {(audio.sfx as SfxTrack[]).map((s, i) => (
                  <div key={i} style={{ display: 'flex', gap: 6, fontFamily: 'var(--font-mono)', fontSize: 10 }}>
                    <span style={{ color: 'var(--cat-audio)' }}>♪</span>
                    <span style={{ color: 'var(--text-1)' }}>{s.name}</span>
                    {s.trigger && <span style={{ color: 'var(--text-3)', marginLeft: 'auto', flexShrink: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 80 }}>{s.trigger}</span>}
                  </div>
                ))}
              </div>
            </>
          )}
        </>
      )}
      {!approved && (
        <ActionBtn label={busy ? '⟳ Generating…' : '▶ Generate audio'} onClick={generate} variant="run" disabled={busy} />
      )}
      {audio && !approved && (
        <ActionBtn label={busy ? '⟳ Approving…' : '✓ Approve audio'} onClick={approve} variant="approve" disabled={busy} />
      )}
      {approved && (
        <div style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color: 'var(--cat-code)', textAlign: 'center' }}>✓ Approved</div>
      )}
    </div>
  )
}

function CodePanel({ project, onRefresh, onLog }: { project: Project; onRefresh: () => void; onLog: (m: string) => void }) {
  const [busy, setBusy] = useState(false)
  const [result, setResult] = useState<{ engine: string; files: ScriptFile[]; architecture_md: string } | null>(null)
  const [engine, setEngine] = useState(project.target_engine ?? project.concept?.development?.suggested_engine?.toLowerCase() ?? 'godot')
  const approved = (project.current_wizard_step ?? 0) > 4

  const mechanics = project.concept?.mechanics ?? []
  const suggested = project.concept?.development?.suggested_engine

  async function generate() {
    setBusy(true)
    try {
      onLog('Generating code…')
      const res = await generateCode(project.id)
      setResult(res)
      onLog(`Code generated (${res.files.length} files) — review and approve`)
    } catch (e) { onLog(e instanceof Error ? e.message : 'Error') }
    finally { setBusy(false) }
  }

  async function approve() {
    if (!result) return
    setBusy(true)
    try {
      await approveStep4(project.id, result)
      onRefresh()
      onLog('Code approved')
    } catch (e) { onLog(e instanceof Error ? e.message : 'Error') }
    finally { setBusy(false) }
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      <SectionTitle>Source Code</SectionTitle>
      {!approved && (
        <Field label="Target Engine">
          <select value={engine} onChange={e => setEngine(e.target.value)} style={SELECT_STYLE} disabled={busy}>
            <option value="godot">Godot</option>
            <option value="unity">Unity</option>
            <option value="phaser">Phaser.js</option>
            <option value="unreal">Unreal Engine</option>
          </select>
        </Field>
      )}
      <MonoRow k="engine" v={result?.engine ?? engine} accent />
      {suggested && suggested.toLowerCase() !== engine && (
        <div style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color: 'var(--cat-gate)', background: 'color-mix(in oklch, var(--cat-gate) 8%, var(--bg-2))', border: '1px solid color-mix(in oklch, var(--cat-gate) 25%, transparent)', borderRadius: 4, padding: '5px 8px' }}>
          GDD suggests: {suggested}
        </div>
      )}
      {mechanics.length > 0 && (
        <>
          <Divider />
          <div style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color: 'var(--text-3)', marginBottom: 2 }}>MECHANICS TO IMPLEMENT</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
            {mechanics.map((m: { id: string; name: string; type: string; description?: string }, i: number) => (
              <div key={i} style={{ display: 'flex', gap: 6, alignItems: 'baseline' }}>
                <span style={{ color: m.type === 'core' ? 'var(--cat-code)' : m.type === 'progression' ? 'var(--cat-gate)' : 'var(--text-3)', fontFamily: 'var(--font-mono)', fontSize: 10, flexShrink: 0 }}>›</span>
                <span style={{ fontSize: 11, color: 'var(--text-1)' }}>{m.name}</span>
                <span style={{ fontFamily: 'var(--font-mono)', fontSize: 9, color: 'var(--text-3)', marginLeft: 'auto', flexShrink: 0 }}>{m.type}</span>
              </div>
            ))}
          </div>
        </>
      )}
      {result && result.files.length > 0 && (
        <>
          <Divider />
          <div style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color: 'var(--text-3)', marginBottom: 2 }}>FILES</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
            {result.files.map((f, i) => (
              <div key={i} style={{ display: 'flex', gap: 6, alignItems: 'center', fontFamily: 'var(--font-mono)', fontSize: 10 }}>
                <span style={{ color: 'var(--cat-code)' }}>›</span>
                <span style={{ color: 'var(--text-1)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{f.filename}</span>
                {f.size_bytes > 0 && <span style={{ color: 'var(--text-3)', marginLeft: 'auto', flexShrink: 0 }}>{Math.round(f.size_bytes / 1024)}kb</span>}
              </div>
            ))}
          </div>
        </>
      )}
      {!approved && (
        <ActionBtn label={busy ? '⟳ Generating…' : '▶ Generate code'} onClick={generate} variant="run" disabled={busy} />
      )}
      {result && !approved && (
        <ActionBtn label={busy ? '⟳ Approving…' : '✓ Approve code'} onClick={approve} variant="approve" disabled={busy} />
      )}
      {approved && (
        <div style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color: 'var(--cat-code)', textAlign: 'center' }}>✓ Approved</div>
      )}
    </div>
  )
}

function ExportPanel({ project, onRefresh, onLog }: { project: Project; onRefresh: () => void; onLog: (m: string) => void }) {
  const [busy, setBusy] = useState(false)
  const [exportUrl, setExportUrl] = useState<string | null>(null)
  const [engine, setEngine] = useState(project.target_engine ?? 'godot')

  async function doExport() {
    setBusy(true)
    try {
      onLog('Exporting project…')
      const res = await exportProject(project.id, engine)
      setExportUrl(res.package_url)
      onRefresh()
      onLog('Export complete!')
    } catch (e) { onLog(e instanceof Error ? e.message : 'Error') }
    finally { setBusy(false) }
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      <SectionTitle>Export</SectionTitle>
      <Field label="Engine / Format">
        <select value={engine} onChange={e => setEngine(e.target.value)} style={SELECT_STYLE} disabled={busy}>
          <option value="godot">Godot (zip)</option>
          <option value="unity">Unity (zip)</option>
          <option value="phaser">Phaser.js (web)</option>
          <option value="unreal">Unreal Engine (zip)</option>
        </select>
      </Field>
      <Divider />
      {exportUrl ? (
        <a
          href={exportUrl}
          download
          style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: 32, borderRadius: 5, background: 'var(--cat-code)', color: '#0a0a0c', fontSize: 12, fontWeight: 600, textDecoration: 'none' }}
        >
          ⬇ Download package
        </a>
      ) : (
        <ActionBtn label={busy ? '⟳ Exporting…' : '⬡ Export project'} onClick={doExport} variant="run" disabled={busy} />
      )}
    </div>
  )
}

function GDDSummaryPanel({ project }: { project: Project }) {
  const gdd = project.concept
  const [showInput, setShowInput] = useState(false)
  const saved = loadGDDInput(project.id)

  if (!gdd) return null

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      <SectionTitle>Game Design Doc</SectionTitle>
      <div style={{ fontWeight: 600, fontSize: 13, color: 'var(--text-0)' }}>{gdd.project.name}</div>
      <div style={{ fontSize: 11, color: 'var(--text-2)', lineHeight: 1.55 }}>{gdd.project.elevator_pitch}</div>
      <Divider />
      <MonoRow k="genre"  v={gdd.project.genre} accent />
      <MonoRow k="tone"   v={gdd.project.tone} />
      <MonoRow k="engine" v={gdd.development.suggested_engine} />
      <MonoRow k="scope"  v={gdd.development.estimated_scope} />
      <Divider />
      <MonoRow k="mechanics"  v={String(gdd.mechanics.length)} />
      <MonoRow k="levels"     v={String(gdd.levels.length)} />
      <MonoRow k="characters" v={String(gdd.characters.length)} />
      {gdd.project.core_loop && (
        <>
          <Divider />
          <div style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color: 'var(--text-3)', marginBottom: 2 }}>CORE LOOP</div>
          <div style={{ fontSize: 11, color: 'var(--text-2)', lineHeight: 1.5 }}>{gdd.project.core_loop}</div>
        </>
      )}

      {saved && (
        <>
          <Divider />
          <button
            onClick={() => setShowInput(p => !p)}
            style={{ background: 'none', border: 'none', cursor: 'pointer', textAlign: 'left', padding: 0, fontFamily: 'var(--font-mono)', fontSize: 10, color: 'var(--text-3)', display: 'flex', alignItems: 'center', gap: 6 }}
          >
            {showInput ? '▲' : '▼'} Original prompt & parameters
          </button>

          {showInput && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              <div style={{ background: 'var(--bg-2)', border: '1px solid var(--line-2)', borderRadius: 5, padding: '8px 10px' }}>
                <div style={{ fontFamily: 'var(--font-mono)', fontSize: 9, color: 'var(--text-3)', marginBottom: 4, textTransform: 'uppercase', letterSpacing: '0.08em' }}>Idea</div>
                <div style={{ fontSize: 11, color: 'var(--text-1)', lineHeight: 1.55 }}>{saved.ideaPrompt}</div>
              </div>
              {GDD_PARAMS.filter(p => {
                const v = saved.params[p.id]
                return v && (Array.isArray(v) ? v.length > 0 : v !== '')
              }).map(p => {
                const v = saved.params[p.id]
                const display = Array.isArray(v) ? v.join(', ') : v as string
                return <MonoRow key={p.id} k={p.label} v={display} />
              })}
            </div>
          )}
        </>
      )}
    </div>
  )
}

/* ─── Visual Guide Panel ─── */

function ColorSwatch({ hex, name, usage }: { hex: string; name: string; usage: string }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
      <div style={{
        width: 28, height: 28, borderRadius: 5, flexShrink: 0,
        background: hex, border: '1px solid rgba(255,255,255,0.08)',
      }} />
      <div style={{ minWidth: 0 }}>
        <div style={{ display: 'flex', gap: 6, alignItems: 'baseline' }}>
          <span style={{ fontWeight: 600, fontSize: 11, color: 'var(--text-0)' }}>{name}</span>
          <span style={{ fontFamily: 'var(--font-mono)', fontSize: 9, color: 'var(--text-3)' }}>{hex}</span>
        </div>
        <div style={{ fontSize: 10, color: 'var(--text-3)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{usage}</div>
      </div>
    </div>
  )
}

function RuleList({ rules }: { rules: string[] }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
      {rules.map((r, i) => (
        <div key={i} style={{ fontSize: 10, color: 'var(--text-1)', lineHeight: 1.5, display: 'flex', gap: 5 }}>
          <span style={{ color: 'var(--node-color, var(--text-3))', flexShrink: 0 }}>›</span>
          <span>{r}</span>
        </div>
      ))}
    </div>
  )
}

function VisualGuidePanel({ project, onRefresh, onLog }: { project: Project; onRefresh: () => void; onLog: (m: string) => void }) {
  const [busy, setBusy] = useState(false)
  const [guide, setGuide] = useState<VisualGuide | null>(null)
  const [tab, setTab] = useState<'palette' | 'rules' | 'refs'>('palette')

  const stored = project.concept?.pipeline?.visual_guide as (VisualGuide & { approved?: boolean }) | undefined
  const approved = !!stored?.approved
  const display = guide ?? (stored?.approved ? stored as VisualGuide : null)

  async function generate() {
    setBusy(true)
    try {
      onLog('Generating visual style guide…')
      const result = await generateVisualGuide(project.id)
      setGuide(result)
      onLog('Visual guide ready — review and approve')
    } catch (e) { onLog(e instanceof Error ? e.message : 'Error') }
    finally { setBusy(false) }
  }

  async function approve() {
    if (!guide) return
    setBusy(true)
    try {
      await approveNode(project.id, 'visual_guide', guide)
      onRefresh()
      onLog('Visual guide approved')
    } catch (e) { onLog(e instanceof Error ? e.message : 'Error') }
    finally { setBusy(false) }
  }

  const TABS = [
    { id: 'palette' as const, label: 'Palette' },
    { id: 'rules'   as const, label: 'Rules' },
    { id: 'refs'    as const, label: 'Refs' },
  ]

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      <SectionTitle>Visual Style Guide</SectionTitle>
      <MonoRow k="art style" v={project.concept?.art_direction?.style ?? '–'} accent />
      <MonoRow k="palette" v={project.concept?.art_direction?.palette ?? '–'} />
      <Divider />

      {display && (
        <>
          {display.style_summary && (
            <div style={{ fontSize: 10, color: 'var(--text-2)', lineHeight: 1.6, background: 'var(--bg-2)', border: '1px solid var(--line-2)', borderRadius: 5, padding: '8px 10px' }}>
              {display.style_summary}
            </div>
          )}

          {/* Tab bar */}
          <div style={{ display: 'flex', gap: 2, borderBottom: '1px solid var(--line)' }}>
            {TABS.map(t => {
              const active = tab === t.id
              return (
                <button
                  key={t.id}
                  onClick={() => setTab(t.id)}
                  style={{
                    background: 'none', border: 'none', cursor: 'pointer',
                    padding: '5px 10px', fontFamily: 'var(--font-sans)', fontSize: 10,
                    fontWeight: active ? 600 : 400,
                    color: active ? 'var(--text-0)' : 'var(--text-3)',
                    borderBottom: active ? '2px solid var(--node-color, var(--cat-design))' : '2px solid transparent',
                    marginBottom: -1,
                  }}
                >{t.label}</button>
              )
            })}
          </div>

          {tab === 'palette' && display.palette && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              {display.palette.map((c, i) => (
                <ColorSwatch key={i} hex={c.hex} name={c.name} usage={c.usage} />
              ))}
              {display.lighting && (
                <>
                  <Divider />
                  <MonoRow k="lighting" v={display.lighting} />
                </>
              )}
            </div>
          )}

          {tab === 'rules' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {display.sprite_rules?.length > 0 && (
                <>
                  <div style={{ fontFamily: 'var(--font-mono)', fontSize: 9, color: 'var(--text-3)', textTransform: 'uppercase', letterSpacing: '0.08em' }}>Sprites</div>
                  <RuleList rules={display.sprite_rules} />
                </>
              )}
              {display.background_rules?.length > 0 && (
                <>
                  <div style={{ fontFamily: 'var(--font-mono)', fontSize: 9, color: 'var(--text-3)', textTransform: 'uppercase', letterSpacing: '0.08em' }}>Backgrounds</div>
                  <RuleList rules={display.background_rules} />
                </>
              )}
              {display.ui_rules?.length > 0 && (
                <>
                  <div style={{ fontFamily: 'var(--font-mono)', fontSize: 9, color: 'var(--text-3)', textTransform: 'uppercase', letterSpacing: '0.08em' }}>UI</div>
                  <RuleList rules={display.ui_rules} />
                </>
              )}
              {display.typography && (
                <>
                  <Divider />
                  <div style={{ fontFamily: 'var(--font-mono)', fontSize: 9, color: 'var(--text-3)', textTransform: 'uppercase', letterSpacing: '0.08em' }}>Typography</div>
                  <MonoRow k="heading" v={display.typography.heading} />
                  <MonoRow k="body" v={display.typography.body} />
                  <MonoRow k="hud" v={display.typography.hud} />
                </>
              )}
            </div>
          )}

          {tab === 'refs' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {display.key_references?.length > 0 && (
                <>
                  <div style={{ fontFamily: 'var(--font-mono)', fontSize: 9, color: 'var(--text-3)', textTransform: 'uppercase', letterSpacing: '0.08em' }}>References</div>
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
                    {display.key_references.map((r, i) => (
                      <span key={i} style={{ fontFamily: 'var(--font-mono)', fontSize: 9, color: 'var(--cat-design)', background: 'color-mix(in oklch, var(--cat-design) 10%, var(--bg-3))', border: '1px solid color-mix(in oklch, var(--cat-design) 25%, transparent)', padding: '2px 7px', borderRadius: 3 }}>{r}</span>
                    ))}
                  </div>
                </>
              )}
              {display.do_list?.length > 0 && (
                <>
                  <div style={{ fontFamily: 'var(--font-mono)', fontSize: 9, color: 'var(--cat-code)', textTransform: 'uppercase', letterSpacing: '0.08em' }}>Do</div>
                  <RuleList rules={display.do_list} />
                </>
              )}
              {display.dont_list?.length > 0 && (
                <>
                  <div style={{ fontFamily: 'var(--font-mono)', fontSize: 9, color: 'var(--cat-output)', textTransform: 'uppercase', letterSpacing: '0.08em' }}>Don't</div>
                  <RuleList rules={display.dont_list} />
                </>
              )}
            </div>
          )}
        </>
      )}

      {!approved && (
        <ActionBtn label={busy ? '⟳ Generating…' : '▶ Generate visual guide'} onClick={generate} variant="run" disabled={busy} />
      )}
      {guide && !approved && (
        <ActionBtn label={busy ? '⟳ Approving…' : '✓ Approve style guide'} onClick={approve} variant="approve" disabled={busy} />
      )}
      {approved && (
        <div style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color: 'var(--cat-code)', textAlign: 'center' }}>✓ Approved</div>
      )}
    </div>
  )
}

/* ─── Backgrounds Panel ─── */

function BgCard({ bg }: { bg: BackgroundPreview }) {
  const [imgErr, setImgErr] = useState(false)
  const src = bg.preview_url ? assetUrl(bg.preview_url) : ''
  return (
    <div style={{ background: 'var(--bg-2)', border: '1px solid var(--line-2)', borderRadius: 6, overflow: 'hidden' }}>
      {src && !imgErr && (
        <img
          src={src}
          alt={bg.level_name}
          onError={() => setImgErr(true)}
          style={{ width: '100%', height: 80, objectFit: 'cover', display: 'block', borderBottom: '1px solid var(--line-2)' }}
        />
      )}
      <div style={{ padding: '6px 10px' }}>
        <div style={{ fontWeight: 600, fontSize: 11, color: 'var(--text-0)' }}>{bg.level_name}</div>
        <div style={{ fontFamily: 'var(--font-mono)', fontSize: 9, color: 'var(--text-3)', marginTop: 2 }}>{bg.environment}</div>
        {bg.layers && bg.layers.length > 0 && (
          <div style={{ display: 'flex', gap: 3, flexWrap: 'wrap', marginTop: 4 }}>
            {bg.layers.map((l, i) => (
              <span key={i} style={{ fontFamily: 'var(--font-mono)', fontSize: 8, color: 'var(--text-3)', background: 'var(--bg-3)', padding: '1px 5px', borderRadius: 2 }}>{l.slice(0, 20)}</span>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

function BackgroundsPanel({ project, onRefresh, onLog }: { project: Project; onRefresh: () => void; onLog: (m: string) => void }) {
  const [busy, setBusy] = useState(false)
  const [backgrounds, setBackgrounds] = useState<BackgroundPreview[] | null>(null)

  const stored = project.concept?.pipeline?.backgrounds as ({ items?: BackgroundPreview[]; approved?: boolean }) | undefined
  const approved = !!stored?.approved
  const display = backgrounds ?? (stored?.approved ? stored.items ?? null : null)

  async function generate() {
    setBusy(true)
    try {
      onLog('Generating backgrounds… (may take 30–60s)')
      const result = await generateBackgrounds(project.id)
      setBackgrounds(result)
      onLog('Backgrounds ready — review and approve')
    } catch (e) { onLog(e instanceof Error ? e.message : 'Error') }
    finally { setBusy(false) }
  }

  async function approve() {
    if (!backgrounds) return
    setBusy(true)
    try {
      await approveNode(project.id, 'backgrounds', { items: backgrounds })
      onRefresh()
      onLog('Backgrounds approved')
    } catch (e) { onLog(e instanceof Error ? e.message : 'Error') }
    finally { setBusy(false) }
  }

  const levels = project.concept?.levels ?? []

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      <SectionTitle>Backgrounds</SectionTitle>
      <MonoRow k="levels" v={String(levels.length)} accent />
      <MonoRow k="style" v={project.concept?.art_direction?.style ?? '–'} />
      <Divider />
      {display && display.length > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          {display.map((bg, i) => <BgCard key={i} bg={bg} />)}
        </div>
      )}
      {!approved && (
        <ActionBtn label={busy ? '⟳ Generating…' : '▶ Generate backgrounds'} onClick={generate} variant="run" disabled={busy} />
      )}
      {backgrounds && !approved && (
        <ActionBtn label={busy ? '⟳ Approving…' : '✓ Approve backgrounds'} onClick={approve} variant="approve" disabled={busy} />
      )}
      {approved && (
        <div style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color: 'var(--cat-code)', textAlign: 'center' }}>✓ Approved</div>
      )}
    </div>
  )
}

/* ─── Concept Art Panel ─── */

function ConceptCard({ item, size = 'char' }: { item: { name: string; prompt: string; design_notes?: string; preview_url?: string; placeholder?: boolean; role?: string; type?: string; mood?: string }; size?: 'char' | 'env' }) {
  const [imgErr, setImgErr] = useState(false)
  const src = item.preview_url ? assetUrl(item.preview_url) : ''
  const h = size === 'char' ? 110 : 80
  return (
    <div style={{ background: 'var(--bg-2)', border: '1px solid var(--line-2)', borderRadius: 6, overflow: 'hidden' }}>
      {src && !imgErr && (
        <img src={src} alt={item.name} onError={() => setImgErr(true)}
          style={{ width: '100%', height: h, objectFit: 'cover', display: 'block', borderBottom: '1px solid var(--line-2)' }} />
      )}
      <div style={{ padding: '6px 10px' }}>
        <div style={{ display: 'flex', gap: 6, alignItems: 'center', marginBottom: 2 }}>
          <span style={{ fontWeight: 600, fontSize: 11, color: 'var(--text-0)' }}>{item.name}</span>
          {(item.role || item.type) && (
            <span style={{ fontFamily: 'var(--font-mono)', fontSize: 8, color: 'var(--cat-design)', background: 'color-mix(in oklch, var(--cat-design) 10%, var(--bg-3))', padding: '1px 5px', borderRadius: 2 }}>
              {item.role ?? item.type}
            </span>
          )}
        </div>
        {item.design_notes && (
          <div style={{ fontSize: 9, color: 'var(--text-3)', lineHeight: 1.4 }}>{item.design_notes}</div>
        )}
      </div>
    </div>
  )
}

function ConceptArtPanel({ project, onRefresh, onLog }: { project: Project; onRefresh: () => void; onLog: (m: string) => void }) {
  const [busy, setBusy] = useState(false)
  const [result, setResult] = useState<ConceptArtResult | null>(null)
  const [tab, setTab] = useState<'chars' | 'envs'>('chars')

  const stored = project.concept?.pipeline?.concept_art as (ConceptArtResult & { approved?: boolean }) | undefined
  const approved = !!stored?.approved
  const display = result ?? (stored?.approved ? stored as ConceptArtResult : null)

  async function generate() {
    setBusy(true)
    try {
      onLog('Generating concept art… (may take 30–60s)')
      const res = await generateConceptArt(project.id)
      setResult(res)
      onLog(`Concept art ready (${res.character_concepts.length} chars, ${res.environment_concepts.length} envs) — review and approve`)
    } catch (e) { onLog(e instanceof Error ? e.message : 'Error') }
    finally { setBusy(false) }
  }

  async function approve() {
    if (!result) return
    setBusy(true)
    try {
      await approveNode(project.id, 'concept_art', result)
      onRefresh()
      onLog('Concept art approved')
    } catch (e) { onLog(e instanceof Error ? e.message : 'Error') }
    finally { setBusy(false) }
  }

  const TABS = [
    { id: 'chars' as const, label: 'Characters', count: display?.character_concepts.length },
    { id: 'envs'  as const, label: 'Environments', count: display?.environment_concepts.length },
  ]

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      <SectionTitle>Concept Art</SectionTitle>
      <MonoRow k="characters" v={String(project.concept?.characters?.length ?? 0)} accent />
      <MonoRow k="environments" v={String(project.concept?.levels?.length ?? 0)} />
      <Divider />

      {display && (
        <>
          {display.style_notes && (
            <div style={{ fontSize: 10, color: 'var(--text-2)', lineHeight: 1.6, background: 'var(--bg-2)', border: '1px solid var(--line-2)', borderRadius: 5, padding: '7px 9px' }}>
              {display.style_notes}
            </div>
          )}

          <div style={{ display: 'flex', gap: 2, borderBottom: '1px solid var(--line)' }}>
            {TABS.map(t => {
              const active = tab === t.id
              return (
                <button key={t.id} onClick={() => setTab(t.id)}
                  style={{ background: 'none', border: 'none', cursor: 'pointer', padding: '5px 10px', fontFamily: 'var(--font-sans)', fontSize: 10, fontWeight: active ? 600 : 400, color: active ? 'var(--text-0)' : 'var(--text-3)', borderBottom: active ? '2px solid var(--node-color, var(--cat-design))' : '2px solid transparent', marginBottom: -1, display: 'flex', alignItems: 'center', gap: 5 }}>
                  {t.label}
                  {t.count !== undefined && <span style={{ fontFamily: 'var(--font-mono)', fontSize: 8, color: active ? 'var(--node-color, var(--cat-design))' : 'var(--text-3)', background: 'var(--bg-3)', padding: '1px 5px', borderRadius: 8 }}>{t.count}</span>}
                </button>
              )
            })}
          </div>

          {tab === 'chars' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              {display.character_concepts.map((c, i) => <ConceptCard key={i} item={c} size="char" />)}
            </div>
          )}
          {tab === 'envs' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              {display.environment_concepts.map((e, i) => <ConceptCard key={i} item={e} size="env" />)}
            </div>
          )}
        </>
      )}

      {!approved && (
        <ActionBtn label={busy ? '⟳ Generating…' : '▶ Generate concept art'} onClick={generate} variant="run" disabled={busy} />
      )}
      {result && !approved && (
        <ActionBtn label={busy ? '⟳ Approving…' : '✓ Approve concept art'} onClick={approve} variant="approve" disabled={busy} />
      )}
      {approved && (
        <div style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color: 'var(--cat-code)', textAlign: 'center' }}>✓ Approved</div>
      )}
    </div>
  )
}

/* ─── SFX Panel ─── */

const SFX_CAT_COLOR: Record<string, string> = {
  ui:          'var(--cat-design)',
  gameplay:    'var(--cat-code)',
  ambient:     'var(--cat-audio)',
  character:   'var(--cat-asset)',
  environment: 'var(--cat-gate)',
}

function SfxPanel({ project, onRefresh, onLog }: { project: Project; onRefresh: () => void; onLog: (m: string) => void }) {
  const [busy, setBusy] = useState(false)
  const [result, setResult] = useState<{ sfx_pack: SfxEntry[]; implementation_notes: string } | null>(null)

  const stored = project.concept?.pipeline?.sfx as ({ sfx_pack?: SfxEntry[]; implementation_notes?: string; approved?: boolean }) | undefined
  const approved = !!stored?.approved
  const display = result ?? (stored?.approved ? { sfx_pack: stored.sfx_pack ?? [], implementation_notes: stored.implementation_notes ?? '' } : null)

  async function generate() {
    setBusy(true)
    try {
      onLog('Generating SFX design…')
      const res = await generateSfx(project.id)
      setResult(res)
      onLog(`SFX pack ready (${res.sfx_pack.length} sounds) — review and approve`)
    } catch (e) { onLog(e instanceof Error ? e.message : 'Error') }
    finally { setBusy(false) }
  }

  async function approve() {
    if (!result) return
    setBusy(true)
    try {
      await approveNode(project.id, 'sfx', result)
      onRefresh()
      onLog('SFX approved')
    } catch (e) { onLog(e instanceof Error ? e.message : 'Error') }
    finally { setBusy(false) }
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      <SectionTitle>SFX Pack</SectionTitle>
      <MonoRow k="genre" v={project.concept?.project?.genre ?? project.genre ?? '–'} accent />
      <MonoRow k="sfx notes" v={project.concept?.audio_direction?.sfx_notes ?? '–'} />
      <Divider />

      {display && display.sfx_pack.length > 0 && (
        <>
          <div style={{ fontFamily: 'var(--font-mono)', fontSize: 9, color: 'var(--text-3)', textTransform: 'uppercase', letterSpacing: '0.08em' }}>
            {display.sfx_pack.length} sounds
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            {display.sfx_pack.map((s, i) => (
              <div key={i} style={{ display: 'flex', gap: 8, alignItems: 'flex-start', background: 'var(--bg-2)', border: '1px solid var(--line-2)', borderRadius: 4, padding: '5px 8px' }}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ display: 'flex', gap: 6, alignItems: 'center', marginBottom: 2 }}>
                    <span style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color: 'var(--cat-audio)' }}>♪</span>
                    <span style={{ fontSize: 10, fontWeight: 600, color: 'var(--text-0)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{s.name}</span>
                    <span style={{
                      fontFamily: 'var(--font-mono)', fontSize: 8,
                      color: SFX_CAT_COLOR[s.category] ?? 'var(--text-3)',
                      background: `color-mix(in oklch, ${SFX_CAT_COLOR[s.category] ?? 'var(--text-3)'} 10%, var(--bg-3))`,
                      padding: '1px 5px', borderRadius: 2, flexShrink: 0
                    }}>{s.category}</span>
                  </div>
                  <div style={{ fontSize: 9, color: 'var(--text-3)', fontFamily: 'var(--font-mono)' }}>{s.trigger}</div>
                </div>
                <div style={{ fontFamily: 'var(--font-mono)', fontSize: 9, color: 'var(--text-3)', flexShrink: 0, marginTop: 2 }}>
                  {s.duration_ms}ms{s.loop ? ' ∞' : ''}
                </div>
              </div>
            ))}
          </div>
          {display.implementation_notes && (
            <>
              <Divider />
              <div style={{ fontSize: 10, color: 'var(--text-2)', lineHeight: 1.5, fontFamily: 'var(--font-sans)' }}>{display.implementation_notes}</div>
            </>
          )}
        </>
      )}

      {!approved && (
        <ActionBtn label={busy ? '⟳ Generating…' : '▶ Generate SFX'} onClick={generate} variant="run" disabled={busy} />
      )}
      {result && !approved && (
        <ActionBtn label={busy ? '⟳ Approving…' : '✓ Approve SFX'} onClick={approve} variant="approve" disabled={busy} />
      )}
      {approved && (
        <div style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color: 'var(--cat-code)', textAlign: 'center' }}>✓ Approved</div>
      )}
    </div>
  )
}

/* ─── Generic raw-JSON doc renderer (for 3D spec nodes) ─── */

function JsonDocRenderer({ data }: { data: unknown }) {
  if (!data || typeof data !== 'object') return null
  const entries = Object.entries(data as Record<string, unknown>).filter(([k]) => k !== 'approved' && k !== 'approved_at')
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      {entries.map(([k, v]) => {
        const label = k.replace(/_/g, ' ')
        if (Array.isArray(v) && v.length > 0) {
          const first = v[0]
          if (typeof first === 'object' && first !== null) {
            return (
              <div key={k}>
                <div style={{ fontFamily: 'var(--font-mono)', fontSize: 9, color: 'var(--text-3)', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 4 }}>{label} ({v.length})</div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
                  {(v as Record<string, unknown>[]).slice(0, 5).map((item, i) => {
                    const name = (item.name || item.level_name || item.character || `#${i + 1}`) as string
                    const sub = (item.type || item.role || item.category || '') as string
                    return (
                      <div key={i} style={{ display: 'flex', gap: 6, background: 'var(--bg-2)', border: '1px solid var(--line-2)', borderRadius: 3, padding: '4px 8px', alignItems: 'center' }}>
                        <span style={{ fontSize: 10, color: 'var(--text-0)', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{String(name)}</span>
                        {sub && <span style={{ fontFamily: 'var(--font-mono)', fontSize: 8, color: 'var(--text-3)' }}>{String(sub)}</span>}
                      </div>
                    )
                  })}
                  {v.length > 5 && <div style={{ fontFamily: 'var(--font-mono)', fontSize: 9, color: 'var(--text-3)', textAlign: 'center' }}>+{v.length - 5} more</div>}
                </div>
              </div>
            )
          }
          return (
            <div key={k}>
              <div style={{ fontFamily: 'var(--font-mono)', fontSize: 9, color: 'var(--text-3)', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 3 }}>{label}</div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 3 }}>
                {(v as string[]).slice(0, 8).map((s, i) => (
                  <span key={i} style={{ fontFamily: 'var(--font-mono)', fontSize: 8, color: 'var(--text-2)', background: 'var(--bg-2)', border: '1px solid var(--line-2)', padding: '1px 6px', borderRadius: 2 }}>{String(s)}</span>
                ))}
              </div>
            </div>
          )
        }
        if (typeof v === 'object' && v !== null) {
          const subEntries = Object.entries(v as Record<string, unknown>).slice(0, 4)
          return (
            <div key={k} style={{ background: 'var(--bg-2)', border: '1px solid var(--line-2)', borderRadius: 4, padding: '6px 8px' }}>
              <div style={{ fontFamily: 'var(--font-mono)', fontSize: 9, color: 'var(--text-3)', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 4 }}>{label}</div>
              {subEntries.map(([sk, sv]) => (
                <MonoRow key={sk} k={sk.replace(/_/g, ' ')} v={String(sv ?? '–')} />
              ))}
            </div>
          )
        }
        if (typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean') {
          return <MonoRow key={k} k={label} v={String(v)} />
        }
        return null
      })}
    </div>
  )
}

function JsonDocPanel({
  title, stepKey, project, onRefresh, onLog, generateFn, summaryRows,
}: {
  title: string
  stepKey: string
  project: Project
  onRefresh: () => void
  onLog: (m: string) => void
  generateFn: (id: string) => Promise<unknown>
  summaryRows: { k: string; v: string; accent?: boolean }[]
}) {
  const [busy, setBusy] = useState(false)
  const [result, setResult] = useState<unknown | null>(null)

  const stored = project.concept?.pipeline?.[stepKey] as ({ approved?: boolean } & Record<string, unknown>) | undefined
  const approved = !!stored?.approved
  const display = result ?? (stored?.approved ? stored : null)

  async function generate() {
    setBusy(true)
    try {
      onLog(`Generating ${title.toLowerCase()}…`)
      const res = await generateFn(project.id)
      setResult(res)
      onLog(`${title} ready — review and approve`)
    } catch (e) { onLog(e instanceof Error ? e.message : 'Error') }
    finally { setBusy(false) }
  }

  async function approve() {
    if (!result) return
    setBusy(true)
    try {
      await approveNode(project.id, stepKey, result)
      onRefresh()
      onLog(`${title} approved`)
    } catch (e) { onLog(e instanceof Error ? e.message : 'Error') }
    finally { setBusy(false) }
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      <SectionTitle>{title}</SectionTitle>
      {summaryRows.map(r => <MonoRow key={r.k} k={r.k} v={r.v} accent={r.accent} />)}
      <Divider />
      {display && <JsonDocRenderer data={display} />}
      {!approved && (
        <ActionBtn label={busy ? '⟳ Generating…' : `▶ Generate ${title.toLowerCase()}`} onClick={generate} variant="run" disabled={busy} />
      )}
      {result != null && !approved && (
        <ActionBtn label={busy ? '⟳ Approving…' : `✓ Approve ${title.toLowerCase()}`} onClick={approve} variant="approve" disabled={busy} />
      )}
      {approved && (
        <div style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color: 'var(--cat-code)', textAlign: 'center' }}>✓ Approved</div>
      )}
    </div>
  )
}

/* ─── Generic "generate + approve" doc panel factory ─── */

function DocPanel<T>({
  title, project, onRefresh, onLog,
  storedKey, summaryRows, generateFn, renderContent,
}: {
  title: string
  project: Project
  onRefresh: () => void
  onLog: (m: string) => void
  storedKey: string
  summaryRows: { k: string; v: string; accent?: boolean }[]
  generateFn: (project_id: string) => Promise<T>
  renderContent: (data: T) => React.ReactNode
}) {
  const [busy, setBusy] = useState(false)
  const [result, setResult] = useState<T | null>(null)

  const stored = project.concept?.pipeline?.[storedKey] as (T & { approved?: boolean }) | undefined
  const approved = !!stored?.approved
  const display = result ?? (stored?.approved ? stored as T : null)

  async function generate() {
    setBusy(true)
    try {
      onLog(`Generating ${title.toLowerCase()}…`)
      const res = await generateFn(project.id)
      setResult(res)
      onLog(`${title} ready — review and approve`)
    } catch (e) { onLog(e instanceof Error ? e.message : 'Error') }
    finally { setBusy(false) }
  }

  async function approve() {
    if (!result) return
    setBusy(true)
    try {
      await approveNode(project.id, storedKey, result)
      onRefresh()
      onLog(`${title} approved`)
    } catch (e) { onLog(e instanceof Error ? e.message : 'Error') }
    finally { setBusy(false) }
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      <SectionTitle>{title}</SectionTitle>
      {summaryRows.map(r => <MonoRow key={r.k} k={r.k} v={r.v} accent={r.accent} />)}
      <Divider />
      {display && renderContent(display)}
      {!approved && (
        <ActionBtn label={busy ? `⟳ Generating…` : `▶ Generate ${title.toLowerCase()}`} onClick={generate} variant="run" disabled={busy} />
      )}
      {result && !approved && (
        <ActionBtn label={busy ? '⟳ Approving…' : `✓ Approve ${title.toLowerCase()}`} onClick={approve} variant="approve" disabled={busy} />
      )}
      {approved && (
        <div style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color: 'var(--cat-code)', textAlign: 'center' }}>✓ Approved</div>
      )}
    </div>
  )
}

function UIUXPanel({ project, onRefresh, onLog }: { project: Project; onRefresh: () => void; onLog: (m: string) => void }) {
  return (
    <DocPanel<UIUXResult>
      title="UI/UX"
      project={project}
      onRefresh={onRefresh}
      onLog={onLog}
      storedKey="uiux"
      summaryRows={[
        { k: 'platform', v: project.concept?.project?.target_platform ?? 'PC', accent: true },
        { k: 'style', v: project.concept?.art_direction?.ui_style ?? '–' },
      ]}
      generateFn={generateUIUX}
      renderContent={(data) => (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {data.design_system && (
            <div style={{ background: 'var(--bg-2)', border: '1px solid var(--line-2)', borderRadius: 5, padding: '8px 10px' }}>
              <div style={{ fontFamily: 'var(--font-mono)', fontSize: 9, color: 'var(--text-3)', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 6 }}>Design System</div>
              <div style={{ display: 'flex', gap: 6, marginBottom: 5 }}>
                {[data.design_system.color_primary, data.design_system.color_secondary, data.design_system.color_accent].filter(Boolean).map((hex, i) => (
                  <div key={i} style={{ width: 20, height: 20, borderRadius: 3, background: hex, border: '1px solid rgba(255,255,255,0.08)', flexShrink: 0 }} title={hex} />
                ))}
              </div>
              <MonoRow k="corner radius" v={data.design_system.corner_radius} />
              <MonoRow k="buttons" v={data.design_system.button_style} />
            </div>
          )}
          {data.screens && data.screens.length > 0 && (
            <>
              <div style={{ fontFamily: 'var(--font-mono)', fontSize: 9, color: 'var(--text-3)', textTransform: 'uppercase', letterSpacing: '0.08em' }}>Screens ({data.screens.length})</div>
              {data.screens.map((s, i) => (
                <div key={i} style={{ background: 'var(--bg-2)', border: '1px solid var(--line-2)', borderRadius: 5, padding: '7px 9px' }}>
                  <div style={{ fontWeight: 600, fontSize: 11, color: 'var(--text-0)', marginBottom: 3 }}>{s.name}</div>
                  <div style={{ fontSize: 10, color: 'var(--text-2)', lineHeight: 1.5 }}>{s.description}</div>
                  {s.elements && s.elements.length > 0 && (
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 3, marginTop: 5 }}>
                      {s.elements.map((el, j) => (
                        <span key={j} style={{ fontFamily: 'var(--font-mono)', fontSize: 8, color: 'var(--text-3)', background: 'var(--bg-3)', padding: '1px 5px', borderRadius: 2 }}>{el}</span>
                      ))}
                    </div>
                  )}
                </div>
              ))}
            </>
          )}
          {data.navigation_flow && (
            <div style={{ fontSize: 10, color: 'var(--text-2)', lineHeight: 1.5 }}>{data.navigation_flow}</div>
          )}
        </div>
      )}
    />
  )
}

function IconsPanel({ project, onRefresh, onLog }: { project: Project; onRefresh: () => void; onLog: (m: string) => void }) {
  return (
    <DocPanel<IconsResult>
      title="Icons"
      project={project}
      onRefresh={onRefresh}
      onLog={onLog}
      storedKey="icons"
      summaryRows={[
        { k: 'art style', v: project.concept?.art_direction?.style ?? '–', accent: true },
        { k: 'mechanics', v: String(project.concept?.mechanics?.length ?? 0) },
      ]}
      generateFn={generateIcons}
      renderContent={(data) => (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {data.icon_style && (
            <div style={{ background: 'var(--bg-2)', border: '1px solid var(--line-2)', borderRadius: 5, padding: '7px 9px' }}>
              <MonoRow k="shape" v={data.icon_style.shape} accent />
              <MonoRow k="size" v={data.icon_style.size_base} />
              <MonoRow k="style" v={data.icon_style.color_scheme} />
            </div>
          )}
          <div style={{ fontFamily: 'var(--font-mono)', fontSize: 9, color: 'var(--text-3)', textTransform: 'uppercase', letterSpacing: '0.08em' }}>
            {data.icons?.length ?? 0} icons
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
            {(data.icons ?? []).map((icon, i) => (
              <div key={i} style={{ display: 'flex', gap: 8, alignItems: 'center', background: 'var(--bg-2)', border: '1px solid var(--line-2)', borderRadius: 4, padding: '4px 8px' }}>
                <div style={{ width: 12, height: 12, borderRadius: 2, background: icon.color_hint || 'var(--bg-3)', flexShrink: 0, border: '1px solid rgba(255,255,255,0.08)' }} />
                <span style={{ fontSize: 10, fontWeight: 500, color: 'var(--text-0)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1 }}>{icon.name}</span>
                <span style={{ fontFamily: 'var(--font-mono)', fontSize: 8, color: 'var(--text-3)', flexShrink: 0 }}>{icon.category}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    />
  )
}

function HUDPanel({ project, onRefresh, onLog }: { project: Project; onRefresh: () => void; onLog: (m: string) => void }) {
  return (
    <DocPanel<HUDResult>
      title="HUD"
      project={project}
      onRefresh={onRefresh}
      onLog={onLog}
      storedKey="hud"
      summaryRows={[
        { k: 'platform', v: project.concept?.project?.target_platform ?? 'PC', accent: true },
        { k: 'genre', v: project.concept?.project?.genre ?? '–' },
      ]}
      generateFn={generateHUD}
      renderContent={(data) => (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {data.layout && (
            <div style={{ fontSize: 10, color: 'var(--text-2)', lineHeight: 1.5, background: 'var(--bg-2)', border: '1px solid var(--line-2)', borderRadius: 5, padding: '7px 9px' }}>
              {data.layout}
            </div>
          )}
          {data.style && (
            <div style={{ background: 'var(--bg-2)', border: '1px solid var(--line-2)', borderRadius: 5, padding: '7px 9px' }}>
              <MonoRow k="theme" v={data.style.theme} accent />
              <MonoRow k="opacity" v={data.style.opacity} />
              <MonoRow k="animation" v={data.style.animation} />
            </div>
          )}
          {data.elements && data.elements.length > 0 && (
            <>
              <div style={{ fontFamily: 'var(--font-mono)', fontSize: 9, color: 'var(--text-3)', textTransform: 'uppercase', letterSpacing: '0.08em' }}>
                Elements ({data.elements.length})
              </div>
              {data.elements.map((el, i) => (
                <div key={i} style={{ background: 'var(--bg-2)', border: '1px solid var(--line-2)', borderRadius: 4, padding: '5px 8px' }}>
                  <div style={{ display: 'flex', gap: 6, alignItems: 'center', marginBottom: 2 }}>
                    <span style={{ fontWeight: 600, fontSize: 10, color: 'var(--text-0)' }}>{el.name}</span>
                    <span style={{ fontFamily: 'var(--font-mono)', fontSize: 8, color: 'var(--cat-design)', background: 'color-mix(in oklch, var(--cat-design) 10%, var(--bg-3))', padding: '1px 5px', borderRadius: 2 }}>{el.type}</span>
                    <span style={{ fontFamily: 'var(--font-mono)', fontSize: 8, color: 'var(--text-3)', marginLeft: 'auto' }}>{el.position}</span>
                  </div>
                  <div style={{ fontSize: 9, color: 'var(--text-3)' }}>{el.data_source}</div>
                </div>
              ))}
            </>
          )}
          {data.implementation_notes && (
            <>
              <Divider />
              <div style={{ fontSize: 10, color: 'var(--text-2)', lineHeight: 1.5 }}>{data.implementation_notes}</div>
            </>
          )}
        </div>
      )}
    />
  )
}

/* ─── Main Inspector ─── */

interface Props {
  node: Node | null
  project: Project | null
  onRefresh: () => void
  onApproved?: (stepKey: string) => void
  onLog: (msg: string) => void
  onProjectCreated?: (project: Project) => void
  onApproveNode?: (nodeId: string) => void
}

export default function InspectorPanel({ node, project, onRefresh, onApproved, onLog, onProjectCreated, onApproveNode }: Props) {

  /* No selection */
  if (!node) {
    return (
      <aside className="forge-inspector">
        <div className="insp-empty">
          <div className="big">◈</div>
          <div className="sm">
            {project === null
              ? 'Select the GDD node\nto start a new game'
              : 'Select a node to\ninspect its properties'}
          </div>
        </div>
      </aside>
    )
  }

  const data = node.data as unknown as ForgeNodeData
  const color = CAT_VAR[data.category]

  const STATUS_LABEL: Record<string, string> = {
    idle:           'Idle — ready to run',
    running:        'Generating…',
    complete:       'Output ready',
    error:          'Error',
    locked:         'Locked — upstream pending',
    'gate-pending': 'Awaiting your review',
  }

  return (
    <aside className="forge-inspector" style={{ '--node-color': color } as React.CSSProperties}>
      {/* Header */}
      <div className="insp-header">
        <div className="insp-icon">{data.icon}</div>
        <div>
          <div className="insp-title">{data.label}</div>
          <div className="insp-sub">{STATUS_LABEL[data.status] ?? data.status}</div>
        </div>
      </div>

      <div className="insp-body">
        <NodeContent
          node={node}
          data={data}
          project={project}
          onRefresh={onRefresh}
          onApproved={onApproved}
          onLog={onLog}
          onProjectCreated={onProjectCreated}
          onApproveNode={onApproveNode}
        />
      </div>
    </aside>
  )
}

function ViewDetailBtn({ onClick }: { onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      style={{
        display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
        width: '100%', height: 28, borderRadius: 5, marginTop: 4,
        fontSize: 11, cursor: 'pointer', transition: 'all 100ms',
        fontFamily: 'var(--font-sans)',
        background: 'var(--bg-2)',
        border: '1px solid var(--line-2)',
        color: 'var(--text-2)',
      }}
      onMouseEnter={e => {
        const b = e.currentTarget as HTMLButtonElement
        b.style.borderColor = 'var(--node-color, var(--text-3))'
        b.style.color = 'var(--text-0)'
      }}
      onMouseLeave={e => {
        const b = e.currentTarget as HTMLButtonElement
        b.style.borderColor = 'var(--line-2)'
        b.style.color = 'var(--text-2)'
      }}
    >
      ⊞ Ver detalle completo
    </button>
  )
}

function ApproveRow({ approved, nodeId, onApproveNode }: {
  approved: boolean
  nodeId: string
  onApproveNode?: (id: string) => void
}) {
  if (!onApproveNode) return null
  if (approved) return (
    <div style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color: 'var(--cat-code)', textAlign: 'center', padding: '4px 0' }}>
      ✓ Approved
    </div>
  )
  return <ActionBtn label="✓ Mark as Approved" onClick={() => onApproveNode(nodeId)} variant="approve" />
}

function NodeContent({
  node, data, project, onRefresh, onApproved, onLog, onProjectCreated, onApproveNode,
}: {
  node: Node
  data: ForgeNodeData
  project: Project | null
  onRefresh: () => void
  onApproved?: (stepKey: string) => void
  onLog: (m: string) => void
  onProjectCreated?: (p: Project) => void
  onApproveNode?: (nodeId: string) => void
}) {
  const [modalOpen, setModalOpen] = useState(false)
  const stepKey = data.stepKey ?? node.id

  /* ── GDD node ── */
  if (stepKey === 'gdd') {
    if (!project) {
      return (
        <NewGamePanel
          onProjectCreated={p => { onProjectCreated?.(p); onRefresh() }}
          onLog={onLog}
        />
      )
    }
    return (
      <>
        <GDDSummaryPanel project={project} />
        <ViewDetailBtn onClick={() => setModalOpen(true)} />
        {modalOpen && <DetailModal stepKey={stepKey} project={project} onClose={() => setModalOpen(false)} />}
      </>
    )
  }

  /* ── GDD Gate ── */
  if (stepKey === 'gdd-gate' && project) {
    const gddApproved = (project.current_wizard_step ?? 0) > 1
    return (
      <>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          <SectionTitle>GDD Gate</SectionTitle>
          <MonoRow k="artifact" v="GDD Document" accent />
          <MonoRow k="status" v={gddApproved ? 'approved' : 'pending'} />
          {gddApproved && <div style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color: 'var(--cat-code)', textAlign: 'center' }}>✓ GDD approved — pipeline unlocked</div>}
          <ViewDetailBtn onClick={() => setModalOpen(true)} />
        </div>
        {modalOpen && <DetailModal stepKey={stepKey} project={project} onClose={() => setModalOpen(false)} />}
      </>
    )
  }

  /* ── Generation nodes ── */
  if (!project) {
    return (
      <div style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color: 'var(--text-3)', textAlign: 'center', padding: '20px 0' }}>
        Create a project first
      </div>
    )
  }

  if (stepKey === 'sprites' || stepKey === 'sprites-gate') {
    return (
      <>
        <SpritesPanel project={project} onRefresh={onRefresh} onLog={onLog} />
        <ViewDetailBtn onClick={() => setModalOpen(true)} />
        {modalOpen && <DetailModal stepKey={stepKey} project={project} onClose={() => setModalOpen(false)} />}
      </>
    )
  }
  if (stepKey === 'levels' || stepKey === 'levels-gate') {
    return (
      <>
        <LevelsPanel project={project} onRefresh={onRefresh} onLog={onLog} />
        <ViewDetailBtn onClick={() => setModalOpen(true)} />
        {modalOpen && <DetailModal stepKey={stepKey} project={project} onClose={() => setModalOpen(false)} />}
      </>
    )
  }
  if (stepKey === 'audio' || stepKey === 'audio-gate') {
    return (
      <>
        <AudioPanel project={project} onRefresh={onRefresh} onLog={onLog} />
        <ViewDetailBtn onClick={() => setModalOpen(true)} />
        {modalOpen && <DetailModal stepKey={stepKey} project={project} onClose={() => setModalOpen(false)} />}
      </>
    )
  }
  if (stepKey === 'code' || stepKey === 'code-gate') {
    return (
      <>
        <CodePanel project={project} onRefresh={onRefresh} onLog={onLog} />
        <ViewDetailBtn onClick={() => setModalOpen(true)} />
        {modalOpen && <DetailModal stepKey={stepKey} project={project} onClose={() => setModalOpen(false)} />}
      </>
    )
  }
  if (stepKey === 'export') {
    return (
      <>
        <ExportPanel project={project} onRefresh={onRefresh} onLog={onLog} />
        <ViewDetailBtn onClick={() => setModalOpen(true)} />
        {modalOpen && <DetailModal stepKey={stepKey} project={project} onClose={() => setModalOpen(false)} />}
      </>
    )
  }

  // 3D pipeline nodes using JsonDocPanel
  const doc3dNodes: Record<string, { title: string; fn: (id: string) => Promise<unknown>; rows: { k: string; v: string; accent?: boolean }[] }> = {
    modeling:   { title: 'Modeling',    fn: generateModeling,   rows: [{ k: 'engine', v: project.target_engine ?? '–', accent: true }, { k: 'characters', v: String(project.concept?.characters?.length ?? 0) }] },
    charaters:  { title: 'Characters',  fn: generateCharaters,  rows: [{ k: 'characters', v: String(project.concept?.characters?.length ?? 0), accent: true }] },
    vfx:        { title: 'VFX',         fn: generateVfx,        rows: [{ k: 'genre', v: project.concept?.project?.genre ?? '–', accent: true }, { k: 'engine', v: project.target_engine ?? '–' }] },
    texturing:  { title: 'Texturing',   fn: generateTexturing,  rows: [{ k: 'style', v: project.concept?.art_direction?.style ?? '–', accent: true }] },
    rigging:    { title: 'Rigging',     fn: generateRigging,    rows: [{ k: 'characters', v: String(project.concept?.characters?.length ?? 0), accent: true }] },
    lighting:   { title: 'Lighting',    fn: generateLighting,   rows: [{ k: 'levels', v: String(project.concept?.levels?.length ?? 0), accent: true }] },
    animation:  { title: 'Animation',   fn: generateAnimation,  rows: [{ k: 'characters', v: String(project.concept?.characters?.length ?? 0), accent: true }] },
    cinematics: { title: 'Cinematics',  fn: generateCinematics, rows: [{ k: 'levels', v: String(project.concept?.levels?.length ?? 0), accent: true }] },
    voice:      { title: 'Voice Acting',fn: generateVoice,      rows: [{ k: 'characters', v: String(project.concept?.characters?.length ?? 0), accent: true }, { k: 'tone', v: project.concept?.project?.tone ?? '–' }] },
  }

  const ar = (sk: string) => onApproved ? () => onApproved(sk) : onRefresh

  if (stepKey in doc3dNodes) {
    const cfg = doc3dNodes[stepKey]
    return (
      <>
        <JsonDocPanel title={cfg.title} stepKey={stepKey} project={project} onRefresh={ar(stepKey)} onLog={onLog} generateFn={cfg.fn} summaryRows={cfg.rows} />
        <ViewDetailBtn onClick={() => setModalOpen(true)} />
        {modalOpen && <DetailModal stepKey={stepKey} project={project} onClose={() => setModalOpen(false)} />}
      </>
    )
  }

  if (stepKey === 'concept_art') {
    return (
      <>
        <ConceptArtPanel project={project} onRefresh={ar('concept_art')} onLog={onLog} />
        <ViewDetailBtn onClick={() => setModalOpen(true)} />
        {modalOpen && <DetailModal stepKey={stepKey} project={project} onClose={() => setModalOpen(false)} />}
      </>
    )
  }

  if (stepKey === 'visual_guide') {
    return (
      <>
        <VisualGuidePanel project={project} onRefresh={ar('visual_guide')} onLog={onLog} />
        <ViewDetailBtn onClick={() => setModalOpen(true)} />
        {modalOpen && <DetailModal stepKey={stepKey} project={project} onClose={() => setModalOpen(false)} />}
      </>
    )
  }

  if (stepKey === 'backgrounds') {
    return (
      <>
        <BackgroundsPanel project={project} onRefresh={ar('backgrounds')} onLog={onLog} />
        <ViewDetailBtn onClick={() => setModalOpen(true)} />
        {modalOpen && <DetailModal stepKey={stepKey} project={project} onClose={() => setModalOpen(false)} />}
      </>
    )
  }

  if (stepKey === 'uiux') {
    return (
      <>
        <UIUXPanel project={project} onRefresh={ar('uiux')} onLog={onLog} />
        <ViewDetailBtn onClick={() => setModalOpen(true)} />
        {modalOpen && <DetailModal stepKey={stepKey} project={project} onClose={() => setModalOpen(false)} />}
      </>
    )
  }

  if (stepKey === 'icons') {
    return (
      <>
        <IconsPanel project={project} onRefresh={ar('icons')} onLog={onLog} />
        <ViewDetailBtn onClick={() => setModalOpen(true)} />
        {modalOpen && <DetailModal stepKey={stepKey} project={project} onClose={() => setModalOpen(false)} />}
      </>
    )
  }

  if (stepKey === 'hud') {
    return (
      <>
        <HUDPanel project={project} onRefresh={ar('hud')} onLog={onLog} />
        <ViewDetailBtn onClick={() => setModalOpen(true)} />
        {modalOpen && <DetailModal stepKey={stepKey} project={project} onClose={() => setModalOpen(false)} />}
      </>
    )
  }

  if (stepKey === 'sfx') {
    return (
      <>
        <SfxPanel project={project} onRefresh={ar('sfx')} onLog={onLog} />
        <ViewDetailBtn onClick={() => setModalOpen(true)} />
        {modalOpen && <DetailModal stepKey={stepKey} project={project} onClose={() => setModalOpen(false)} />}
      </>
    )
  }

  if (stepKey === 'playtesting') {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        <SectionTitle>Playtesting</SectionTitle>
        <div style={{ background: 'var(--bg-2)', border: '1px solid var(--line-2)', borderRadius: 5, padding: '12px', textAlign: 'center' }}>
          <div style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color: 'var(--cat-gate)' }}>Coming soon</div>
          <div style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color: 'var(--text-3)', marginTop: 4 }}>AI simulation playtesting</div>
        </div>
      </div>
    )
  }

  /* Coming soon nodes */
  if (data.comingSoon) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        <SectionTitle>{data.label}</SectionTitle>
        <div style={{
          background: 'var(--bg-2)', border: '1px solid var(--line-2)',
          borderRadius: 6, padding: '16px 12px', textAlign: 'center',
        }}>
          <div style={{ fontSize: 20, marginBottom: 8, opacity: 0.4 }}>◷</div>
          <div style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--cat-gate)', fontWeight: 600 }}>
            Coming Soon
          </div>
          <div style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color: 'var(--text-3)', marginTop: 6, lineHeight: 1.6 }}>
            This module is planned for a future release.
          </div>
        </div>
        <MonoRow k="id" v={node.id} />
        <MonoRow k="category" v={data.category} />
        <ApproveRow approved={!!data.approved} nodeId={node.id} onApproveNode={onApproveNode} />
      </div>
    )
  }

  /* Fallback */
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      <SectionTitle>Node Info</SectionTitle>
      <MonoRow k="id" v={node.id} />
      <MonoRow k="category" v={data.category} />
      <MonoRow k="status" v={data.status} />
      {data.rows?.map(r => <MonoRow key={r.key} k={r.key} v={r.value} accent={r.accent} />)}
      <ApproveRow approved={!!data.approved} nodeId={node.id} onApproveNode={onApproveNode} />
    </div>
  )
}
