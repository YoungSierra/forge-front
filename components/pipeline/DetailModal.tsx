'use client'

import React, { useEffect, useState } from 'react'
import type { Project } from '@/lib/types'
import { exportGDDToPDF, } from '@/lib/gdd-pdf'
import { assetUrl } from '@/lib/api'
import { InputContext, getInputSources } from './InputContext'

interface Props {
  stepKey: string
  project: Project
  pendingData?: unknown
  onClose: () => void
  nodeContext?: Record<string, unknown>
}

/* Determine if a step already has generated output */
function stepHasOutput(stepKey: string, project: Project, pendingData?: unknown): boolean {
  if (pendingData != null) return true
  const key = stepKey.replace('-gate', '')
  const g   = project.concept?.pipeline?.gdd
  const pipeline = project.concept?.pipeline
  switch (key) {
    case 'gdd':     return !!g?.project?.name
    case 'sprites': return (g?.characters?.length ?? 0) > 0
    case 'levels':  return (g?.levels?.length ?? 0) > 0
    case 'audio':   return !!g?.audio_direction?.music_mood
    case 'code':    return (g?.development?.core_features?.length ?? 0) > 0
    case 'export':  return true
    default: {
      const d = pipeline?.[key] as Record<string, unknown> | undefined
      return !!d && Object.keys(d).filter(k => k !== 'approved' && k !== 'approved_at').length > 0
    }
  }
}

function toStr(v: unknown): string {
  if (v == null) return '–'
  if (typeof v === 'string') return v
  if (typeof v === 'number' || typeof v === 'boolean') return String(v)
  if (typeof v === 'object') {
    const o = v as Record<string, unknown>
    return String(o.name ?? o.label ?? o.description ?? o.title ?? JSON.stringify(v))
  }
  return String(v)
}

type EnvObj = { type?: string; theme?: string; lighting?: string }
function envLabel(env: unknown): string {
  if (!env) return '–'
  if (typeof env === 'string') return env
  const o = env as EnvObj
  return o.theme ?? o.type ?? JSON.stringify(env)
}

function Badge({ label, color = 'var(--text-3)' }: { label: string; color?: string }) {
  return (
    <span style={{
      display: 'inline-block', fontFamily: 'var(--font-mono)', fontSize: 10,
      padding: '2px 8px', borderRadius: 99,
      background: `color-mix(in oklch, ${color} 12%, var(--bg-2))`,
      border: `1px solid color-mix(in oklch, ${color} 30%, transparent)`,
      color, whiteSpace: 'nowrap',
    }}>{label}</span>
  )
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginBottom: 28 }}>
      <div style={{
        fontFamily: 'var(--font-mono)', fontSize: 10, textTransform: 'uppercase',
        letterSpacing: '0.1em', color: 'var(--text-3)',
        borderBottom: '1px solid var(--line)', paddingBottom: 6,
      }}>{title}</div>
      {children}
    </div>
  )
}

function Card({ children }: { children: React.ReactNode }) {
  return (
    <div style={{
      background: 'var(--bg-2)', border: '1px solid var(--line-2)',
      borderRadius: 8, padding: '12px 14px',
    }}>{children}</div>
  )
}

/* ─── Per-step detail views ─── */

function GDDDetail({ project }: { project: Project }) {
  const gdd = project.concept?.pipeline?.gdd
  if (!gdd) return <p style={{ color: 'var(--text-3)', fontFamily: 'var(--font-mono)', fontSize: 11 }}>No GDD available.</p>

  const DIFFICULTY_COLOR: Record<string, string> = {
    easy: 'var(--cat-code)', medium: 'var(--cat-gate)',
    hard: 'var(--cat-output)', boss: 'oklch(0.65 0.25 340)',
  }
  const ROLE_COLOR: Record<string, string> = {
    hero: 'var(--cat-design)', enemy: 'var(--cat-output)',
    npc: 'var(--cat-asset)', boss: 'oklch(0.65 0.25 340)',
  }
  const MECHANIC_COLOR: Record<string, string> = {
    core: 'var(--cat-gate)', secondary: 'var(--text-3)', progression: 'var(--cat-level)',
  }

  return (
    <div>
      {/* Header */}
      <div style={{ marginBottom: 28 }}>
        <h2 style={{ fontSize: 22, fontWeight: 700, color: 'var(--text-0)', marginBottom: 6 }}>
          {gdd.project.name}
        </h2>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 12 }}>
          <Badge label={gdd.project.genre} color="var(--cat-design)" />
          <Badge label={gdd.project.tone} color="var(--cat-audio)" />
          <Badge label={gdd.development.suggested_engine} color="var(--cat-code)" />
          <Badge label={gdd.development.estimated_scope} color="var(--text-3)" />
        </div>
        <p style={{ fontSize: 14, color: 'var(--text-2)', lineHeight: 1.65, fontStyle: 'italic' }}>
          {gdd.project.elevator_pitch}
        </p>
        {gdd.project.core_loop && (
          <div style={{
            marginTop: 12, padding: '8px 12px',
            background: 'color-mix(in oklch, var(--cat-design) 8%, var(--bg-2))',
            border: '1px solid color-mix(in oklch, var(--cat-design) 20%, transparent)',
            borderRadius: 6, fontSize: 12, color: 'var(--text-2)',
          }}>
            <span style={{ color: 'var(--cat-design)', fontFamily: 'var(--font-mono)', fontSize: 10 }}>CORE LOOP · </span>
            {gdd.project.core_loop}
          </div>
        )}
      </div>

      {/* Characters */}
      {gdd.characters?.length > 0 && (
        <Section title={`Characters · ${gdd.characters.length}`}>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))', gap: 10 }}>
            {gdd.characters.map((c, i) => (
              <Card key={i}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
                  <div style={{
                    width: 32, height: 32, borderRadius: 6, flexShrink: 0,
                    background: `color-mix(in oklch, ${ROLE_COLOR[c.role] ?? 'var(--text-3)'} 20%, var(--bg-3))`,
                    border: `1px solid color-mix(in oklch, ${ROLE_COLOR[c.role] ?? 'var(--text-3)'} 35%, transparent)`,
                    display: 'grid', placeItems: 'center',
                    fontFamily: 'var(--font-mono)', fontWeight: 700, fontSize: 13,
                    color: ROLE_COLOR[c.role] ?? 'var(--text-3)',
                  }}>
                    {c.name[0].toUpperCase()}
                  </div>
                  <div>
                    <div style={{ fontWeight: 600, fontSize: 13, color: 'var(--text-0)' }}>{c.name}</div>
                    <Badge label={c.role} color={ROLE_COLOR[c.role] ?? 'var(--text-3)'} />
                  </div>
                </div>
                <p style={{ fontSize: 11, color: 'var(--text-2)', lineHeight: 1.55, marginBottom: 8 }}>{c.description}</p>
                {c.abilities?.length > 0 && (
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, marginBottom: 8 }}>
                    {c.abilities.map((a, j) => (
                      <span key={j} style={{
                        fontSize: 9, fontFamily: 'var(--font-mono)', padding: '1px 6px',
                        borderRadius: 3, background: 'var(--bg-3)', color: 'var(--text-3)',
                        border: '1px solid var(--line)',
                      }}>{toStr(a)}</span>
                    ))}
                  </div>
                )}
                {c.sprite_prompt && (
                  <details style={{ marginTop: 4 }}>
                    <summary style={{ fontSize: 10, fontFamily: 'var(--font-mono)', color: 'var(--text-3)', cursor: 'pointer' }}>
                      sprite prompt
                    </summary>
                    <p style={{ fontSize: 10, color: 'var(--text-3)', lineHeight: 1.5, marginTop: 4 }}>{c.sprite_prompt}</p>
                  </details>
                )}
              </Card>
            ))}
          </div>
        </Section>
      )}

      {/* Mechanics */}
      {gdd.mechanics?.length > 0 && (
        <Section title={`Mechanics · ${gdd.mechanics.length}`}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {gdd.mechanics.map((m, i) => (
              <Card key={i}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
                  <span style={{ fontWeight: 600, fontSize: 13, color: 'var(--text-0)', flex: 1 }}>{toStr(m.name)}</span>
                  <Badge label={toStr(m.type)} color={MECHANIC_COLOR[toStr(m.type)] ?? 'var(--text-3)'} />
                </div>
                <p style={{ fontSize: 12, color: 'var(--text-2)', lineHeight: 1.55 }}>{toStr(m.description)}</p>
              </Card>
            ))}
          </div>
        </Section>
      )}

      {/* Levels */}
      {gdd.levels?.length > 0 && (
        <Section title={`Levels · ${gdd.levels.length}`}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {gdd.levels.map((l, i) => (
              <Card key={i}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 6 }}>
                  <span style={{
                    fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--text-3)',
                    background: 'var(--bg-3)', border: '1px solid var(--line)', borderRadius: 4, padding: '1px 7px',
                  }}>
                    {String(l.order).padStart(2, '0')}
                  </span>
                  <span style={{ fontWeight: 600, fontSize: 13, color: 'var(--text-0)', flex: 1 }}>{toStr(l.name)}</span>
                  <Badge label={toStr(l.difficulty)} color={DIFFICULTY_COLOR[toStr(l.difficulty)] ?? 'var(--text-3)'} />
                  <Badge label={envLabel(l.environment)} color="var(--cat-level)" />
                </div>
                <p style={{ fontSize: 12, color: 'var(--text-2)', lineHeight: 1.55, marginBottom: 6 }}>{toStr(l.description)}</p>
                {l.background_prompt && (
                  <details>
                    <summary style={{ fontSize: 10, fontFamily: 'var(--font-mono)', color: 'var(--text-3)', cursor: 'pointer' }}>
                      background prompt
                    </summary>
                    <p style={{ fontSize: 10, color: 'var(--text-3)', lineHeight: 1.5, marginTop: 4 }}>{toStr(l.background_prompt)}</p>
                  </details>
                )}
              </Card>
            ))}
          </div>
        </Section>
      )}

      {/* Art + Audio + Dev */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 20 }}>
        <div>
          <Section title="Art Direction">
            <Card>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6, fontFamily: 'var(--font-mono)', fontSize: 11 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                  <span style={{ color: 'var(--text-3)' }}>style</span>
                  <span style={{ color: 'var(--text-1)' }}>{gdd.art_direction?.style ?? '–'}</span>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                  <span style={{ color: 'var(--text-3)' }}>palette</span>
                  <span style={{ color: 'var(--text-1)' }}>{gdd.art_direction?.palette ?? '–'}</span>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                  <span style={{ color: 'var(--text-3)' }}>resolution</span>
                  <span style={{ color: 'var(--text-1)' }}>{gdd.art_direction?.resolution ?? '–'}</span>
                </div>
                {gdd.art_direction?.references?.length > 0 && (
                  <div style={{ marginTop: 4 }}>
                    <div style={{ color: 'var(--text-3)', marginBottom: 4 }}>references</div>
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
                      {gdd.art_direction.references.map((r, i) => (
                        <span key={i} style={{
                          fontSize: 9, padding: '1px 6px', borderRadius: 3,
                          background: 'var(--bg-3)', color: 'var(--text-2)', border: '1px solid var(--line)',
                        }}>{toStr(r)}</span>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            </Card>
          </Section>

          <Section title="Audio Direction">
            <Card>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6, fontFamily: 'var(--font-mono)', fontSize: 11 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                  <span style={{ color: 'var(--text-3)' }}>mood</span>
                  <span style={{ color: 'var(--text-1)' }}>{gdd.audio_direction?.music_mood ?? '–'}</span>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                  <span style={{ color: 'var(--text-3)' }}>style</span>
                  <span style={{ color: 'var(--text-1)' }}>{gdd.audio_direction?.music_style ?? '–'}</span>
                </div>
                {gdd.audio_direction?.sfx_notes && (
                  <div style={{ marginTop: 4 }}>
                    <div style={{ color: 'var(--text-3)', marginBottom: 3 }}>sfx notes</div>
                    <div style={{ color: 'var(--text-2)', fontSize: 11, lineHeight: 1.5 }}>{gdd.audio_direction.sfx_notes}</div>
                  </div>
                )}
              </div>
            </Card>
          </Section>
        </div>

        <div>
          <Section title="Development">
            <Card>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                <div style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color: 'var(--text-3)' }}>CORE FEATURES</div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
                  {(gdd.development?.core_features ?? []).map((f, i) => (
                    <div key={i} style={{ display: 'flex', gap: 8, fontSize: 12, color: 'var(--text-2)' }}>
                      <span style={{ color: 'var(--cat-code)' }}>›</span>
                      {typeof f === 'string' ? f : (f as Record<string,string>).name ?? (f as Record<string,string>).description ?? ''}
                    </div>
                  ))}
                </div>
                {(gdd.development?.out_of_scope ?? []).length > 0 && (
                  <>
                    <div style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color: 'var(--text-3)', marginTop: 6 }}>OUT OF SCOPE</div>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
                      {(gdd.development?.out_of_scope ?? []).map((f, i) => (
                        <div key={i} style={{ display: 'flex', gap: 8, fontSize: 12, color: 'var(--text-3)' }}>
                          <span style={{ color: 'var(--cat-output)' }}>✕</span>
                          {typeof f === 'string' ? f : (f as Record<string,string>).name ?? (f as Record<string,string>).description ?? ''}
                        </div>
                      ))}
                    </div>
                  </>
                )}
              </div>
            </Card>
          </Section>
        </div>
      </div>
    </div>
  )
}

function PlaceholderBadge() {
  return (
    <span style={{
      position: 'absolute', top: 6, right: 6,
      fontFamily: 'var(--font-mono)', fontSize: 8, fontWeight: 700,
      textTransform: 'uppercase', letterSpacing: '0.08em',
      padding: '2px 6px', borderRadius: 3,
      background: 'rgba(0,0,0,0.7)', color: 'var(--text-3)',
      border: '1px solid var(--line-2)',
    }}>placeholder</span>
  )
}

function SpriteImgBox({ url, placeholder, name, color }: { url?: string; placeholder?: boolean; name: string; color: string }) {
  const [err, setErr] = useState(false)
  const src = url ? assetUrl(url) : null

  if (!src || err) {
    return (
      <div style={{
        width: 72, height: 72, borderRadius: 8, flexShrink: 0,
        background: `color-mix(in oklch, ${color} 18%, var(--bg-3))`,
        border: `1px solid color-mix(in oklch, ${color} 35%, transparent)`,
        display: 'grid', placeItems: 'center',
        fontFamily: 'var(--font-mono)', fontWeight: 700, fontSize: 22, color,
      }}>
        {name[0].toUpperCase()}
      </div>
    )
  }

  return (
    <div style={{ width: 72, height: 72, borderRadius: 8, flexShrink: 0, position: 'relative', overflow: 'hidden' }}>
      <img src={src} alt={name} onError={() => setErr(true)}
        style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block',
          imageRendering: 'pixelated',
          border: `1px solid color-mix(in oklch, ${color} 25%, transparent)`,
          borderRadius: 8,
        }} />
      {placeholder && <PlaceholderBadge />}
    </div>
  )
}

function SpritesDetail({ project }: { project: Project }) {
  const g = project.concept?.pipeline?.gdd
  const chars = g?.characters ?? []
  const ROLE_COLOR: Record<string, string> = {
    hero: 'var(--cat-design)', enemy: 'var(--cat-output)',
    npc: 'var(--cat-asset)', boss: 'oklch(0.65 0.25 340)',
  }
  return (
    <div>
      <p style={{ fontSize: 13, color: 'var(--text-2)', marginBottom: 20 }}>
        Style: <strong style={{ color: 'var(--cat-asset)' }}>{g?.art_direction?.style ?? '–'}</strong>
        &nbsp;·&nbsp;Palette: <strong style={{ color: 'var(--text-1)' }}>{g?.art_direction?.palette ?? '–'}</strong>
      </p>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: 12 }}>
        {chars.map((c, i) => {
          const color = ROLE_COLOR[c.role] ?? 'var(--text-3)'
          const previewUrl = c.preview_url
          return (
            <Card key={i}>
              <div style={{ display: 'flex', gap: 12, marginBottom: 10 }}>
                <SpriteImgBox url={previewUrl} name={c.name} color={color} />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontWeight: 600, fontSize: 14, color: 'var(--text-0)', marginBottom: 4 }}>{c.name}</div>
                  <Badge label={c.role} color={color} />
                </div>
              </div>
              <p style={{ fontSize: 11, color: 'var(--text-2)', lineHeight: 1.55, marginBottom: 10 }}>{c.description}</p>
              {c.abilities?.length > 0 && (
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, marginBottom: 10 }}>
                  {c.abilities.map((a, j) => (
                    <span key={j} style={{
                      fontSize: 9, fontFamily: 'var(--font-mono)', padding: '1px 6px',
                      borderRadius: 3, background: 'var(--bg-3)', color: 'var(--text-3)', border: '1px solid var(--line)',
                    }}>{toStr(a)}</span>
                  ))}
                </div>
              )}
              <div style={{
                fontSize: 10, fontFamily: 'var(--font-mono)', color: 'var(--text-3)', lineHeight: 1.6,
                background: 'var(--bg-1)', borderRadius: 5, padding: '8px 10px',
                border: '1px solid var(--line)',
              }}>
                <span style={{ color: 'var(--cat-asset)' }}>SPRITE PROMPT · </span>
                {c.sprite_prompt}
              </div>
            </Card>
          )
        })}
      </div>
    </div>
  )
}

type LevelItem = {
  name: string; order: number | string; description: string
  expanded_description?: string; difficulty: string
  environment: string | EnvObj
  pacing?: { start?: string; mid?: string; end?: string }
  enemy_placements?: { enemy_name?: string; zone?: string; behavior?: string }[]
  collectibles?: { name?: string; effect?: string }[]
  hazards?: { name?: string; type?: string; effect?: string }[]
  background_prompt?: string; preview_url?: string
}

function LevelsDetail({ project, pendingData }: { project: Project; pendingData?: unknown }) {
  const levels: LevelItem[] = (Array.isArray(pendingData) ? pendingData as LevelItem[] : null)
    ?? (project.concept?.pipeline?.gdd?.levels as LevelItem[] | undefined) ?? []

  const DIFFICULTY_COLOR: Record<string, string> = {
    easy: 'var(--cat-code)', medium: 'var(--cat-gate)',
    hard: 'var(--cat-output)', boss: 'oklch(0.65 0.25 340)',
  }
  type BgItem = { level_name: string; preview_url: string }
  const pipeline = (project.concept as Record<string, unknown>)?.pipeline as Record<string, unknown> | undefined
  const bgItems = (pipeline?.backgrounds as { items?: BgItem[] } | undefined)?.items ?? []
  const bgByLevel: Record<string, string> = {}
  for (const bg of bgItems) bgByLevel[bg.level_name] = bg.preview_url

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      {levels.map((l, i) => {
        const bgUrl = bgByLevel[l.name] ?? l.preview_url
        const imgUrl = bgUrl ? assetUrl(bgUrl) : null
        const envObj = typeof l.environment === 'object' && l.environment != null ? l.environment as EnvObj : null

        return (
          <Card key={i}>
            {imgUrl && (
              <div style={{ margin: '-12px -14px 12px', borderRadius: '8px 8px 0 0', overflow: 'hidden', height: 180, position: 'relative' }}>
                <img src={imgUrl} alt={l.name}
                  style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }}
                  onError={e => { (e.currentTarget.parentElement as HTMLElement).style.display = 'none' }}
                />
              </div>
            )}

            {/* Header row */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 8 }}>
              <span style={{ fontFamily: 'var(--font-mono)', fontSize: 18, fontWeight: 700, color: 'var(--text-3)', minWidth: 32 }}>
                {String(l.order).padStart(2, '0')}
              </span>
              <div style={{ flex: 1 }}>
                <div style={{ fontWeight: 600, fontSize: 15, color: 'var(--text-0)' }}>{l.name}</div>
              </div>
              <Badge label={l.difficulty} color={DIFFICULTY_COLOR[l.difficulty] ?? 'var(--text-3)'} />
              <Badge label={envLabel(l.environment)} color="var(--cat-level)" />
            </div>

            {/* Environment detail badges */}
            {envObj && (
              <div style={{ display: 'flex', gap: 5, flexWrap: 'wrap', marginBottom: 8 }}>
                {envObj.type && <Badge label={envObj.type} color="var(--text-3)" />}
                {envObj.lighting && <Badge label={envObj.lighting} color="var(--cat-audio)" />}
              </div>
            )}

            {/* Description */}
            <p style={{ fontSize: 12, color: 'var(--text-2)', lineHeight: 1.65, marginBottom: l.expanded_description ? 6 : 10 }}>{l.description}</p>

            {/* Expanded description */}
            {l.expanded_description && (
              <p style={{ fontSize: 12, color: 'var(--text-1)', lineHeight: 1.65, marginBottom: 10, fontStyle: 'italic' }}>{l.expanded_description}</p>
            )}

            {/* Pacing */}
            {l.pacing && (
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 6, marginBottom: 10 }}>
                {(['start', 'mid', 'end'] as const).map(phase => l.pacing![phase] ? (
                  <div key={phase} style={{ background: 'var(--bg-1)', borderRadius: 5, padding: '5px 8px', border: '1px solid var(--line)' }}>
                    <div style={{ fontFamily: 'var(--font-mono)', fontSize: 8, color: 'var(--text-3)', textTransform: 'uppercase', marginBottom: 3 }}>{phase}</div>
                    <div style={{ fontSize: 10, color: 'var(--text-2)', lineHeight: 1.5 }}>{l.pacing![phase]}</div>
                  </div>
                ) : null)}
              </div>
            )}

            {/* Enemies */}
            {l.enemy_placements && l.enemy_placements.length > 0 && (
              <div style={{ marginBottom: 10 }}>
                <div style={{ fontFamily: 'var(--font-mono)', fontSize: 8, color: 'var(--text-3)', textTransform: 'uppercase', marginBottom: 5 }}>enemies</div>
                <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
                  {l.enemy_placements.map((ep, j) => (
                    <div key={j} style={{
                      background: 'var(--bg-1)', borderRadius: 5, padding: '3px 8px',
                      border: '1px solid color-mix(in oklch, var(--cat-output) 25%, transparent)',
                      display: 'flex', gap: 5, alignItems: 'center',
                    }}>
                      <span style={{ fontSize: 10, fontWeight: 600, color: 'var(--cat-output)' }}>{ep.enemy_name}</span>
                      {ep.zone && <span style={{ fontSize: 9, fontFamily: 'var(--font-mono)', color: 'var(--text-3)' }}>{ep.zone}</span>}
                      {ep.behavior && <span style={{ fontSize: 9, fontFamily: 'var(--font-mono)', color: 'var(--text-3)' }}>· {ep.behavior}</span>}
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Collectibles + Hazards */}
            {((l.collectibles?.length ?? 0) > 0 || (l.hazards?.length ?? 0) > 0) && (
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginBottom: 10 }}>
                {l.collectibles && l.collectibles.length > 0 && (
                  <div>
                    <div style={{ fontFamily: 'var(--font-mono)', fontSize: 8, color: 'var(--cat-code)', textTransform: 'uppercase', marginBottom: 5 }}>collectibles</div>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
                      {l.collectibles.map((c, j) => (
                        <div key={j} style={{ fontSize: 10, color: 'var(--text-2)' }}>
                          <span style={{ color: 'var(--cat-code)' }}>+</span> {c.name}{c.effect ? ` — ${c.effect}` : ''}
                        </div>
                      ))}
                    </div>
                  </div>
                )}
                {l.hazards && l.hazards.length > 0 && (
                  <div>
                    <div style={{ fontFamily: 'var(--font-mono)', fontSize: 8, color: 'var(--cat-output)', textTransform: 'uppercase', marginBottom: 5 }}>hazards</div>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
                      {l.hazards.map((h, j) => (
                        <div key={j} style={{ fontSize: 10, color: 'var(--text-2)' }}>
                          <span style={{ color: 'var(--cat-output)' }}>!</span> {h.name}{h.effect ? ` — ${h.effect}` : ''}
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* Background prompt */}
            {l.background_prompt && (
              <div style={{
                fontSize: 10, fontFamily: 'var(--font-mono)', color: 'var(--text-3)', lineHeight: 1.6,
                background: 'var(--bg-1)', borderRadius: 5, padding: '8px 10px',
                border: '1px solid var(--line)',
              }}>
                <span style={{ color: 'var(--cat-level)' }}>BG PROMPT · </span>
                {l.background_prompt}
              </div>
            )}
          </Card>
        )
      })}
    </div>
  )
}

function AudioDetail({ project }: { project: Project }) {
  const ad = project.concept?.pipeline?.gdd?.audio_direction
  return (
    <div>
      <Section title="Music Direction">
        <Card>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, fontFamily: 'var(--font-mono)', fontSize: 12 }}>
            <div>
              <div style={{ color: 'var(--text-3)', fontSize: 10, marginBottom: 4 }}>MOOD</div>
              <div style={{ color: 'var(--cat-audio)' }}>{ad?.music_mood ?? '–'}</div>
            </div>
            <div>
              <div style={{ color: 'var(--text-3)', fontSize: 10, marginBottom: 4 }}>STYLE</div>
              <div style={{ color: 'var(--text-1)' }}>{ad?.music_style ?? '–'}</div>
            </div>
          </div>
        </Card>
      </Section>
      {ad?.sfx_notes && (
        <Section title="SFX Notes">
          <Card>
            <p style={{ fontSize: 12, color: 'var(--text-2)', lineHeight: 1.65 }}>{ad.sfx_notes}</p>
          </Card>
        </Section>
      )}
      <Section title="Per-Level Music">
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {(project.concept?.pipeline?.gdd?.levels ?? []).map((l, i) => (
            <Card key={i}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 4 }}>
                <span style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--text-3)' }}>
                  Level {l.order}
                </span>
                <span style={{ fontWeight: 600, fontSize: 13, color: 'var(--text-0)', flex: 1 }}>{l.name}</span>
                <Badge label={envLabel(l.environment)} color="var(--cat-audio)" />
              </div>
              <p style={{ fontSize: 11, color: 'var(--text-3)', fontFamily: 'var(--font-mono)' }}>
                Mood: <span style={{ color: 'var(--text-2)' }}>{ad?.music_mood}</span>
                &nbsp;· Style: <span style={{ color: 'var(--text-2)' }}>{ad?.music_style}</span>
              </p>
            </Card>
          ))}
        </div>
      </Section>
    </div>
  )
}

function CodeDetail({ project }: { project: Project }) {
  const g = project.concept?.pipeline?.gdd
  return (
    <div>
      <Section title="Architecture Overview">
        <Card>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 20 }}>
            <div>
              <div style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color: 'var(--text-3)', marginBottom: 8 }}>ENGINE</div>
              <Badge label={project.target_engine ?? 'godot'} color="var(--cat-code)" />
            </div>
            <div>
              <div style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color: 'var(--text-3)', marginBottom: 8 }}>SCOPE</div>
              <span style={{ fontSize: 12, color: 'var(--text-2)' }}>{g?.development?.estimated_scope ?? '–'}</span>
            </div>
          </div>
        </Card>
      </Section>
      <Section title="Core Features to Implement">
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          {(g?.development?.core_features ?? []).map((f, i) => {
            const label = typeof f === 'string' ? f : (f as Record<string, string>).name ?? (f as Record<string, string>).description ?? JSON.stringify(f)
            const sub   = typeof f === 'string' ? null : (f as Record<string, string>).description
            return (
              <Card key={i}>
                <div style={{ display: 'flex', gap: 10, alignItems: 'flex-start', fontSize: 12, color: 'var(--text-2)' }}>
                  <span style={{ color: 'var(--cat-code)', fontFamily: 'var(--font-mono)', flexShrink: 0 }}>›</span>
                  <div>
                    <div>{label}</div>
                    {sub && label !== sub && <div style={{ fontSize: 10, color: 'var(--text-3)', marginTop: 2 }}>{sub}</div>}
                  </div>
                </div>
              </Card>
            )
          })}
        </div>
      </Section>
      <Section title="Mechanics Reference">
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          {(g?.mechanics ?? []).map((m, i) => (
            <Card key={i}>
              <div style={{ display: 'flex', gap: 10, alignItems: 'center', marginBottom: 4 }}>
                <span style={{ fontWeight: 600, fontSize: 13, color: 'var(--text-0)', flex: 1 }}>{toStr(m.name)}</span>
                <Badge label={toStr(m.type)} color={toStr(m.type) === 'core' ? 'var(--cat-gate)' : toStr(m.type) === 'progression' ? 'var(--cat-level)' : 'var(--text-3)'} />
              </div>
              <p style={{ fontSize: 11, color: 'var(--text-2)', lineHeight: 1.5 }}>{toStr(m.description)}</p>
            </Card>
          ))}
        </div>
      </Section>
    </div>
  )
}

function ExportDetail({ project }: { project: Project }) {
  const g = project.concept?.pipeline?.gdd
  const chars = g?.characters ?? []
  const levels = g?.levels ?? []
  return (
    <div>
      <Section title="Package Contents">
        <Card>
          <div style={{ fontFamily: 'var(--font-mono)', fontSize: 11, lineHeight: 2, color: 'var(--text-2)' }}>
            <div style={{ color: 'var(--text-3)' }}>Assets/Forge/</div>
            <div style={{ paddingLeft: 16 }}>
              <div><span style={{ color: 'var(--cat-code)' }}>Scripts/</span> — {project.target_engine} source files</div>
              <div><span style={{ color: 'var(--cat-asset)' }}>Sprites/</span> — {chars.length} character placeholders</div>
              <div><span style={{ color: 'var(--cat-level)' }}>Backgrounds/</span> — {levels.length} level backgrounds</div>
              <div><span style={{ color: 'var(--cat-audio)' }}>Audio/</span> — music + sfx descriptions</div>
              <div><span style={{ color: 'var(--cat-design)' }}>Docs/</span> — gdd.json, architecture.md</div>
            </div>
          </div>
        </Card>
      </Section>
      <Section title="Project Summary">
        <Card>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, fontFamily: 'var(--font-mono)', fontSize: 11 }}>
            {[
              ['name', project.name],
              ['genre', g?.project?.genre ?? '–'],
              ['engine', project.target_engine ?? 'godot'],
              ['scope', g?.development?.estimated_scope ?? '–'],
              ['characters', String(chars.length)],
              ['levels', String(levels.length)],
              ['mechanics', String(g?.mechanics?.length ?? 0)],
              ['status', project.status],
            ].map(([k, v]) => (
              <div key={k} style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}>
                <span style={{ color: 'var(--text-3)' }}>{k}</span>
                <span style={{ color: 'var(--text-1)', textAlign: 'right' }}>{v}</span>
              </div>
            ))}
          </div>
        </Card>
      </Section>
    </div>
  )
}

const STEP_TITLES: Record<string, string> = {
  // Wizard steps
  'gdd':           'Game Design Document',
  'gdd-gate':      'GDD Gate — Review',
  'sprites':       'Sprites — Characters',
  'sprites-gate':  'Sprites Gate — Review',
  'levels':        'Level Layouts',
  'levels-gate':   'Levels Gate — Review',
  'code':          'Source Code — Architecture',
  'code-gate':     'Code Gate — Review',
  'audio':         'Audio Direction',
  'audio-gate':    'Audio Gate — Review',
  'export':        'Export — Package',
  'playtesting':   'Playtesting',
  // Pipeline nodes (2D)
  'visual_guide':  'Visual Style Guide',
  'concept_art':   'Concept Art',
  'backgrounds':   'Backgrounds',
  'sfx':           'Sound Effects',
  'uiux':          'UI / UX Design',
  'icons':         'Icons',
  'hud':           'HUD Design',
  // Pipeline nodes (3D)
  'modeling':      '3D Modeling',
  'charaters':     '3D Characters',
  'vfx':           'Visual FX',
  'texturing':     'Texturing',
  'rigging':       'Rigging',
  'lighting':      'Lighting',
  'animation':     'Animation',
  'cinematics':    'Cinematics',
  'voice':         'Voice Acting',
}

/* ─── Concept Art detail — dedicated component with images ─── */

type ConceptArtData = {
  character_concepts?: { name: string; role?: string; prompt?: string; design_notes?: string; preview_url?: string; placeholder?: boolean }[]
  environment_concepts?: { name: string; type?: string; mood?: string; prompt?: string; design_notes?: string; preview_url?: string; placeholder?: boolean }[]
  style_notes?: string
  approved?: boolean
  approved_at?: string
}

function ConceptArtDetail({ project, pendingData }: { project: Project; pendingData?: unknown }) {
  const pipeline = (project.concept as Record<string, unknown>)?.pipeline as Record<string, unknown> | undefined
  const data = (pipeline?.concept_art as ConceptArtData | undefined) ?? (pendingData as ConceptArtData | undefined)

  if (!data?.character_concepts && !data?.environment_concepts) {
    return <div style={{ color: 'var(--text-3)', fontFamily: 'var(--font-mono)', fontSize: 11, padding: '20px 0', textAlign: 'center' }}>Concept art has not been generated yet.</div>
  }

  const ROLE_COLOR: Record<string, string> = { hero: 'var(--cat-design)', enemy: 'var(--cat-output)', npc: 'var(--cat-asset)', boss: 'oklch(0.65 0.25 340)' }

  function ConceptImgCard({ item, height = 140 }: { item: { name: string; role?: string; type?: string; mood?: string; design_notes?: string; preview_url?: string; placeholder?: boolean }; height?: number }) {
    const color = item.role ? (ROLE_COLOR[item.role] ?? 'var(--text-3)') : 'var(--cat-level)'
    const imgUrl = item.preview_url ? assetUrl(item.preview_url) : null
    return (
      <Card>
        {imgUrl && (
          <div style={{ margin: '-12px -14px 12px', borderRadius: '8px 8px 0 0', overflow: 'hidden', height, position: 'relative' }}>
            <img src={imgUrl} alt={item.name} style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }}
              onError={e => { (e.currentTarget.parentElement as HTMLElement).style.display = 'none' }} />
            {item.placeholder && <PlaceholderBadge />}
          </div>
        )}
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
          <span style={{ fontWeight: 600, fontSize: 13, color: 'var(--text-0)', flex: 1 }}>{item.name}</span>
          {(item.role || item.type) && <Badge label={item.role ?? item.type ?? ''} color={color} />}
          {item.mood && <Badge label={item.mood} color="var(--cat-audio)" />}
        </div>
        {item.design_notes && <p style={{ fontSize: 11, color: 'var(--text-2)', lineHeight: 1.55, marginBottom: 0 }}>{item.design_notes}</p>}
      </Card>
    )
  }

  return (
    <div>
      {data.style_notes && (
        <div style={{ marginBottom: 20, padding: '10px 14px', background: 'color-mix(in oklch, var(--cat-design) 8%, var(--bg-2))', border: '1px solid color-mix(in oklch, var(--cat-design) 20%, transparent)', borderRadius: 7, fontSize: 12, color: 'var(--text-2)', lineHeight: 1.6 }}>
          <span style={{ color: 'var(--cat-design)', fontFamily: 'var(--font-mono)', fontSize: 10 }}>STYLE NOTES · </span>
          {data.style_notes}
        </div>
      )}
      {(data.character_concepts?.length ?? 0) > 0 && (
        <Section title={`Characters · ${data.character_concepts!.length}`}>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(240px, 1fr))', gap: 10 }}>
            {data.character_concepts!.map((c, i) => <ConceptImgCard key={i} item={c} height={150} />)}
          </div>
        </Section>
      )}
      {(data.environment_concepts?.length ?? 0) > 0 && (
        <Section title={`Environments · ${data.environment_concepts!.length}`}>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: 10 }}>
            {data.environment_concepts!.map((e, i) => <ConceptImgCard key={i} item={e} height={120} />)}
          </div>
        </Section>
      )}
    </div>
  )
}

/* ─── Backgrounds detail — dedicated component with images ─── */

function BackgroundsDetail({ project }: { project: Project }) {
  const pipeline = (project.concept as Record<string, unknown>)?.pipeline as Record<string, unknown> | undefined
  const data = pipeline?.backgrounds as { items?: { level_name: string; environment: string; prompt?: string; layers?: string[]; preview_url: string; placeholder?: boolean }[]; approved?: boolean } | undefined
  const items = data?.items ?? []

  if (!items.length) {
    return <div style={{ color: 'var(--text-3)', fontFamily: 'var(--font-mono)', fontSize: 11, padding: '20px 0', textAlign: 'center' }}>Backgrounds have not been generated yet.</div>
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      {items.map((bg, i) => {
        const imgUrl = bg.preview_url ? assetUrl(bg.preview_url) : null
        return (
          <Card key={i}>
            {imgUrl && (
              <div style={{ margin: '-12px -14px 12px', borderRadius: '8px 8px 0 0', overflow: 'hidden', height: 200, position: 'relative' }}>
                <img src={imgUrl} alt={bg.level_name} style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }}
                  onError={e => { (e.currentTarget.parentElement as HTMLElement).style.display = 'none' }} />
                {bg.placeholder && <PlaceholderBadge />}
              </div>
            )}
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
              <span style={{ fontWeight: 600, fontSize: 14, color: 'var(--text-0)', flex: 1 }}>{bg.level_name}</span>
              <Badge label={bg.environment} color="var(--cat-level)" />
            </div>
            {bg.layers && bg.layers.length > 0 && (
              <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap', marginBottom: 6 }}>
                {bg.layers.map((l, j) => <span key={j} style={{ fontFamily: 'var(--font-mono)', fontSize: 9, color: 'var(--text-3)', background: 'var(--bg-3)', padding: '1px 6px', borderRadius: 3 }}>{l}</span>)}
              </div>
            )}
            {bg.prompt && (
              <div style={{ fontSize: 10, fontFamily: 'var(--font-mono)', color: 'var(--text-3)', lineHeight: 1.5, background: 'var(--bg-1)', borderRadius: 4, padding: '7px 9px', border: '1px solid var(--line)' }}>
                <span style={{ color: 'var(--cat-level)' }}>PROMPT · </span>{bg.prompt}
              </div>
            )}
          </Card>
        )
      })}
    </div>
  )
}

/* ─── Generic pipeline node detail ─── */

function PipelineNodeDetail({ stepKey, project, pendingData }: { stepKey: string; project: Project; pendingData?: unknown }) {
  const pipeline = (project.concept as Record<string, unknown>)?.pipeline as Record<string, unknown> | undefined
  const data = pipeline?.[stepKey] ?? pendingData

  if (!data) {
    return (
      <div style={{ color: 'var(--text-3)', fontFamily: 'var(--font-mono)', fontSize: 11, padding: '20px 0', textAlign: 'center' }}>
        This node has not been generated yet.
      </div>
    )
  }

  function renderValue(v: unknown, depth = 0): React.ReactNode {
    if (v == null) return <span style={{ color: 'var(--text-3)' }}>–</span>
    if (typeof v === 'string') {
      // Render image assets inline (relative /assets/ path or absolute Supabase/http URL with image extension)
      const isImg = v.startsWith('/assets/') || (v.startsWith('http') && /\.(jpe?g|png|webp|gif)(\?|$)/i.test(v))
      if (isImg) {
        return (
          <img src={assetUrl(v)} style={{ maxWidth: '100%', maxHeight: 200, borderRadius: 6, objectFit: 'cover', display: 'block', marginTop: 4 }}
            onError={e => { (e.currentTarget as HTMLImageElement).style.display = 'none' }} />
        )
      }
      return <span style={{ color: 'var(--text-1)', fontFamily: 'var(--font-mono)', fontSize: 11 }}>{v}</span>
    }
    if (typeof v === 'number' || typeof v === 'boolean') {
      return <span style={{ color: 'var(--text-1)', fontFamily: 'var(--font-mono)', fontSize: 11 }}>{String(v)}</span>
    }
    if (Array.isArray(v)) {
      return (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4, paddingLeft: depth > 0 ? 12 : 0 }}>
          {v.map((item, i) => (
            <div key={i} style={{ display: 'flex', gap: 8, alignItems: 'flex-start' }}>
              <span style={{ color: 'var(--text-3)', fontFamily: 'var(--font-mono)', fontSize: 10, flexShrink: 0, marginTop: 1 }}>›</span>
              <div style={{ flex: 1 }}>{renderValue(item, depth + 1)}</div>
            </div>
          ))}
        </div>
      )
    }
    if (typeof v === 'object') {
      const obj = v as Record<string, unknown>
      // If the object has a preview_url, render the image prominently
      if (obj.preview_url && typeof obj.preview_url === 'string' && !obj.placeholder) {
        return (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            <img src={assetUrl(obj.preview_url)} style={{ width: '100%', maxHeight: 180, borderRadius: 6, objectFit: 'cover', display: 'block' }}
              onError={e => { (e.currentTarget as HTMLImageElement).style.display = 'none' }} />
            {Object.entries(obj).filter(([k]) => k !== 'preview_url' && k !== 'placeholder' && k !== 'approved' && k !== 'approved_at').map(([k, val]) => (
              <div key={k} style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
                <div style={{ fontFamily: 'var(--font-mono)', fontSize: 9, textTransform: 'uppercase', letterSpacing: '0.1em', color: 'var(--text-3)' }}>{k.replace(/_/g, ' ')}</div>
                <div>{renderValue(val, depth + 1)}</div>
              </div>
            ))}
          </div>
        )
      }
      return (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6, paddingLeft: depth > 0 ? 12 : 0 }}>
          {Object.entries(obj).map(([k, val]) => {
            if (k === 'approved' || k === 'approved_at' || k === 'placeholder') return null
            return (
              <div key={k} style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
                <div style={{ fontFamily: 'var(--font-mono)', fontSize: 9, textTransform: 'uppercase', letterSpacing: '0.1em', color: 'var(--text-3)' }}>{k.replace(/_/g, ' ')}</div>
                <div>{renderValue(val, depth + 1)}</div>
              </div>
            )
          })}
        </div>
      )
    }
    return null
  }

  const entries = Object.entries(data as Record<string, unknown>).filter(([k]) => k !== 'approved' && k !== 'approved_at')

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
      {entries.map(([key, val]) => (
        <div key={key} style={{
          background: 'var(--bg-2)', border: '1px solid var(--line-2)',
          borderRadius: 8, padding: '14px 16px',
          display: 'flex', flexDirection: 'column', gap: 10,
        }}>
          <div style={{
            fontFamily: 'var(--font-mono)', fontSize: 10, textTransform: 'uppercase',
            letterSpacing: '0.1em', color: 'var(--text-3)',
            borderBottom: '1px solid var(--line)', paddingBottom: 8, marginBottom: 2,
          }}>
            {key.replace(/_/g, ' ')}
          </div>
          {renderValue(val)}
        </div>
      ))}
    </div>
  )
}

export default function DetailModal({ stepKey, project, pendingData, onClose, nodeContext }: Props) {
  // Close on Escape
  useEffect(() => {
    function onKey(e: KeyboardEvent) { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  const contentKey   = stepKey.replace('-gate', '')
  const hasOutput    = stepHasOutput(stepKey, project, pendingData)
  const hasSources   = nodeContext != null
    ? Object.keys(nodeContext).length > 0
    : getInputSources(stepKey, project).length > 0
  const [tab, setTab] = useState<'output' | 'context'>(hasOutput ? 'output' : 'context')

  function renderContent() {
    switch (contentKey) {
      case 'gdd':     return <GDDDetail project={project} />
      case 'sprites': return <SpritesDetail project={project} />
      case 'levels':  return <LevelsDetail project={project} pendingData={pendingData} />
      case 'audio':   return <AudioDetail project={project} />
      case 'code':    return <CodeDetail project={project} />
      case 'export':       return <ExportDetail project={project} />
      case 'concept_art':  return <ConceptArtDetail project={project} pendingData={pendingData} />
      default:             return <PipelineNodeDetail stepKey={contentKey} project={project} pendingData={pendingData} />
    }
  }

  function TabBtn({ id, label }: { id: 'output' | 'context'; label: string }) {
    const active = tab === id
    return (
      <button
        onClick={() => setTab(id)}
        style={{
          padding: '6px 14px', borderRadius: 5, border: 'none', cursor: 'pointer',
          fontFamily: 'var(--font-mono)', fontSize: 10, textTransform: 'uppercase', letterSpacing: '0.08em',
          background: active ? 'var(--bg-3)' : 'transparent',
          color: active ? 'var(--text-0)' : 'var(--text-3)',
          transition: 'all 100ms',
        }}
      >{label}</button>
    )
  }

  return (
    <div
      onClick={onClose}
      style={{
        position: 'fixed', inset: 0, zIndex: 1000,
        background: 'rgba(0,0,0,0.72)',
        backdropFilter: 'blur(4px)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        padding: 24,
      }}
    >
      <div
        onClick={e => e.stopPropagation()}
        style={{
          width: '100%', maxWidth: 900,
          maxHeight: '90vh',
          background: 'var(--bg-1)',
          border: '1px solid var(--line-2)',
          borderRadius: 12,
          display: 'flex', flexDirection: 'column',
          boxShadow: '0 32px 80px rgba(0,0,0,0.6)',
          overflow: 'hidden',
        }}
      >
        {/* Modal header */}
        <div style={{
          display: 'flex', alignItems: 'center', gap: 12,
          padding: '14px 20px',
          borderBottom: hasSources ? 'none' : '1px solid var(--line)',
          flexShrink: 0,
        }}>
          <div style={{ flex: 1 }}>
            <div style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color: 'var(--text-3)', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 2 }}>
              Detail View
            </div>
            <div style={{ fontSize: 15, fontWeight: 600, color: 'var(--text-0)' }}>
              {STEP_TITLES[stepKey] ?? stepKey}
            </div>
          </div>
          <div style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color: 'var(--text-3)' }}>
            {project.name}
          </div>
          {(contentKey === 'gdd') && project.concept?.pipeline?.gdd && (
            <button
              onClick={() => exportGDDToPDF(project.concept.pipeline!.gdd!)}
              style={{
                display: 'flex', alignItems: 'center', gap: 5,
                background: 'var(--bg-3)', border: '1px solid var(--line-2)',
                borderRadius: 6, padding: '5px 12px',
                color: 'var(--text-2)', fontFamily: 'var(--font-sans)', fontSize: 11,
                cursor: 'pointer', whiteSpace: 'nowrap', transition: 'all 100ms',
              }}
              onMouseEnter={e => { (e.currentTarget as HTMLButtonElement).style.color = 'var(--text-0)'; (e.currentTarget as HTMLButtonElement).style.borderColor = 'var(--line)' }}
              onMouseLeave={e => { (e.currentTarget as HTMLButtonElement).style.color = 'var(--text-2)'; (e.currentTarget as HTMLButtonElement).style.borderColor = 'var(--line-2)' }}
            >
              ⬇ Export PDF
            </button>
          )}
          <button
            onClick={onClose}
            style={{
              background: 'var(--bg-3)', border: '1px solid var(--line-2)',
              borderRadius: 6, width: 28, height: 28,
              display: 'grid', placeItems: 'center',
              cursor: 'pointer', color: 'var(--text-2)', fontSize: 16,
              transition: 'all 100ms',
            }}
            onMouseEnter={e => { (e.currentTarget as HTMLButtonElement).style.background = 'var(--bg-4)'; (e.currentTarget as HTMLButtonElement).style.color = 'var(--text-0)' }}
            onMouseLeave={e => { (e.currentTarget as HTMLButtonElement).style.background = 'var(--bg-3)'; (e.currentTarget as HTMLButtonElement).style.color = 'var(--text-2)' }}
          >
            ✕
          </button>
        </div>

        {/* Tab bar — only when input context is available */}
        {hasSources && (
          <div style={{
            display: 'flex', alignItems: 'center', gap: 2,
            padding: '6px 16px',
            borderBottom: '1px solid var(--line)',
            background: 'var(--bg-1)',
            flexShrink: 0,
          }}>
            <TabBtn id="context" label="Input Context" />
            <TabBtn id="output"  label="Output" />
          </div>
        )}

        {/* Modal body — scrollable */}
        <div style={{ flex: 1, overflow: 'auto', padding: '20px 24px' }}>
          {tab === 'context'
            ? <InputContext stepKey={stepKey} project={project} nodeContext={nodeContext} />
            : renderContent()
          }
        </div>
      </div>
    </div>
  )
}
