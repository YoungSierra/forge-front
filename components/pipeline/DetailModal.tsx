'use client'

import React, { useEffect, useState, useCallback } from 'react'
import type { Project } from '@/lib/types'
import type { GlobalRefStatus, ImageRef } from '@/lib/types'
import { exportGDDToPDF, } from '@/lib/gdd-pdf'
import { assetUrl, getImageReferenceStatus, getImageReferencePool, generateImageReferenceRound, approveImageReferenceSelection, approveNode, getCharatersStatus, generateCharacterRender, approveCharacterRender, approveCharatersNode, getIdeaCandidate } from '@/lib/api'
import type { IdeaCard } from '@/lib/api'
import type { CharacterRenderStatus, AssetVersion } from '@/lib/types'
import { InputContext, getInputSources } from './InputContext'
import RefinementModal from '@/components/shared/RefinementModal'

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
    case 'export':          return true
    case 'image_reference': return true
    case 'charaters':       return true
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
  const [lightbox, setLightbox] = useState<{ url: string; name: string } | null>(null)
  const [ideaCandidate, setIdeaCandidate] = useState<{ title: string; idea_data: IdeaCard; original_description: string | null } | null>(null)

  React.useEffect(() => {
    if (!lightbox) return
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.stopImmediatePropagation(); setLightbox(null) } }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [lightbox])

  React.useEffect(() => {
    getIdeaCandidate(project.id).then(c => { if (c) setIdeaCandidate(c) }).catch(() => {})
  }, [project.id])

  if (!gdd) return <p style={{ color: 'var(--text-3)', fontFamily: 'var(--font-mono)', fontSize: 11 }}>No GDD available.</p>

  const roleColor = (role: string) => ({
    hero: 'var(--cat-design)', protagonist: 'var(--cat-design)',
    enemy: 'var(--cat-output)', antagonist: 'var(--cat-output)',
    npc: 'var(--cat-asset)', mentor: 'var(--cat-asset)',
    boss: 'oklch(0.65 0.25 340)',
  }[role?.toLowerCase()] ?? 'var(--text-3)')

  const paletteIsArray = Array.isArray(gdd.art_direction?.palette)
  const refsAreObjects = Array.isArray(gdd.art_direction?.references) &&
    (gdd.art_direction.references as unknown[]).length > 0 &&
    typeof (gdd.art_direction.references as unknown[])[0] === 'object'

  const mono9: React.CSSProperties = { color: 'var(--text-3)', fontFamily: 'var(--font-mono)', fontSize: 9, textTransform: 'uppercase', letterSpacing: '0.08em' }

  return (
    <div>
      {/* ── Header ── */}
      <div style={{ marginBottom: 28 }}>
        <h2 style={{ fontSize: 22, fontWeight: 700, color: 'var(--text-0)', marginBottom: 4 }}>
          {gdd.project.name}
        </h2>
        {gdd.project.tagline && (
          <p style={{ fontSize: 13, color: 'var(--text-3)', fontStyle: 'italic', marginBottom: 10 }}>
            {gdd.project.tagline}
          </p>
        )}
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 12 }}>
          {gdd.project.genre && <Badge label={gdd.project.genre} color="var(--cat-design)" />}
          {gdd.project.tone && <Badge label={gdd.project.tone} color="var(--cat-audio)" />}
          {gdd.project.target_platform && <Badge label={gdd.project.target_platform} color="var(--cat-code)" />}
          {gdd.project.player_mode && <Badge label={gdd.project.player_mode} color="var(--text-3)" />}
          {gdd.development?.suggested_engine && <Badge label={gdd.development.suggested_engine} color="var(--cat-gate)" />}
        </div>
        {(gdd.project.logline || gdd.project.elevator_pitch) && (
          <p style={{ fontSize: 14, color: 'var(--text-2)', lineHeight: 1.65, fontStyle: 'italic' }}>
            {gdd.project.logline || gdd.project.elevator_pitch}
          </p>
        )}
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

      {/* ── Design Pillars ── */}
      {(gdd.design_pillars?.length ?? 0) > 0 && (
        <Section title="Design Pillars">
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: 10 }}>
            {gdd.design_pillars!.map((p, i) => (
              <Card key={i}>
                <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--cat-design)', marginBottom: 6 }}>{p.pillar}</div>
                <div style={{ fontSize: 11, color: 'var(--text-2)', lineHeight: 1.55 }}>{p.description}</div>
              </Card>
            ))}
          </div>
        </Section>
      )}

      {/* ── Overview ── */}
      {(gdd.project.description || (gdd.key_features?.length ?? 0) > 0) && (
        <Section title="Overview">
          {gdd.project.description && (
            <p style={{ fontSize: 13, color: 'var(--text-2)', lineHeight: 1.65, marginBottom: (gdd.key_features?.length ?? 0) > 0 ? 12 : 0 }}>
              {gdd.project.description}
            </p>
          )}
          {(gdd.key_features?.length ?? 0) > 0 && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              {gdd.key_features!.map((f, i) => (
                <div key={i} style={{ display: 'flex', gap: 10, fontSize: 12, color: 'var(--text-2)', lineHeight: 1.55 }}>
                  <span style={{ color: 'var(--cat-design)', fontWeight: 700, flexShrink: 0 }}>›</span>
                  {f}
                </div>
              ))}
            </div>
          )}
        </Section>
      )}

      {/* ── Characters ── */}
      {(gdd.characters?.length ?? 0) > 0 && (
        <Section title={`Characters · ${gdd.characters.length}`}>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))', gap: 10 }}>
            {gdd.characters.map((c, i) => (
              <Card key={i}>
                <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10, marginBottom: 10 }}>
                  <div
                    onClick={() => c.preview_url && setLightbox({ url: assetUrl(c.preview_url), name: c.name })}
                    style={{ cursor: c.preview_url ? 'zoom-in' : 'default', flexShrink: 0 }}
                  >
                    <SpriteImgBox url={c.preview_url} name={c.name} color={roleColor(c.role)} />
                  </div>
                  <div style={{ flex: 1, minWidth: 0, paddingTop: 2 }}>
                    <div style={{ fontWeight: 700, fontSize: 13, color: 'var(--text-0)', marginBottom: 5 }}>{c.name}</div>
                    <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
                      <Badge label={c.role} color={roleColor(c.role)} />
                      {c.age && <Badge label={`Age: ${c.age}`} color="var(--text-3)" />}
                    </div>
                  </div>
                </div>
                {c.appearance && (
                  <div style={{ fontSize: 11, color: 'var(--text-2)', lineHeight: 1.55, marginBottom: 6 }}>
                    <span style={mono9}>APPEARANCE · </span>{c.appearance}
                  </div>
                )}
                {c.personality && (
                  <div style={{ fontSize: 11, color: 'var(--text-2)', lineHeight: 1.55, marginBottom: 6 }}>
                    <span style={mono9}>PERSONALITY · </span>{c.personality}
                  </div>
                )}
                {!c.appearance && !c.personality && c.description && (
                  <p style={{ fontSize: 11, color: 'var(--text-2)', lineHeight: 1.55, marginBottom: 6 }}>{c.description}</p>
                )}
                {c.motivation && (
                  <div style={{ fontSize: 11, color: 'var(--text-2)', lineHeight: 1.55, marginBottom: 6 }}>
                    <span style={mono9}>MOTIVATION · </span>{c.motivation}
                  </div>
                )}
                {(c.backstory || c.arc) && (
                  <details style={{ marginTop: 4 }}>
                    <summary style={{ fontSize: 10, fontFamily: 'var(--font-mono)', color: 'var(--text-3)', cursor: 'pointer' }}>backstory & arc</summary>
                    <div style={{ marginTop: 8, display: 'flex', flexDirection: 'column', gap: 6 }}>
                      {c.backstory && <div style={{ fontSize: 11, color: 'var(--text-2)', lineHeight: 1.55 }}><span style={mono9}>BACKSTORY · </span>{c.backstory}</div>}
                      {c.arc && <div style={{ fontSize: 11, color: 'var(--text-2)', lineHeight: 1.55 }}><span style={mono9}>ARC · </span>{c.arc}</div>}
                    </div>
                  </details>
                )}
                {c.gameplay_role && (
                  <div style={{ marginTop: 8, padding: '6px 8px', background: 'var(--bg-1)', borderRadius: 5, border: '1px solid var(--line)', fontSize: 10, color: 'var(--text-3)', fontFamily: 'var(--font-mono)' }}>
                    <span style={{ color: 'var(--cat-design)' }}>GAMEPLAY · </span>{c.gameplay_role}
                  </div>
                )}
                {!c.gameplay_role && (c.abilities?.length ?? 0) > 0 && (
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, marginTop: 8 }}>
                    {c.abilities!.map((a, j) => (
                      <span key={j} style={{ fontSize: 9, fontFamily: 'var(--font-mono)', padding: '1px 6px', borderRadius: 3, background: 'var(--bg-3)', color: 'var(--text-3)', border: '1px solid var(--line)' }}>
                        {toStr(a)}
                      </span>
                    ))}
                  </div>
                )}
              </Card>
            ))}
          </div>
        </Section>
      )}

      {/* ── Mechanics ── */}
      {(gdd.mechanics?.length ?? 0) > 0 && (
        <Section title={`Game Mechanics · ${gdd.mechanics.length}`}>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(340px, 1fr))', gap: 10 }}>
            {gdd.mechanics.map((m, i) => (
              <Card key={i}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
                  <span style={{ fontWeight: 700, fontSize: 13, color: 'var(--text-0)', flex: 1 }}>{toStr(m.name)}</span>
                  {(m.category || m.type) && <Badge label={m.category ?? toStr(m.type)} color={m.category ? 'var(--cat-gate)' : 'var(--text-3)'} />}
                </div>
                {m.description && <p style={{ fontSize: 12, color: 'var(--text-2)', lineHeight: 1.55, marginBottom: 8 }}>{m.description}</p>}
                {m.player_goal && (
                  <div style={{ fontSize: 11, color: 'var(--text-2)', lineHeight: 1.5, marginBottom: 6 }}>
                    <span style={mono9}>GOAL · </span>{m.player_goal}
                  </div>
                )}
                {(m.rules || m.depth || m.integration) && (
                  <details style={{ marginTop: 4 }}>
                    <summary style={{ fontSize: 10, fontFamily: 'var(--font-mono)', color: 'var(--text-3)', cursor: 'pointer' }}>rules & depth</summary>
                    <div style={{ marginTop: 8, display: 'flex', flexDirection: 'column', gap: 6 }}>
                      {m.rules && <div style={{ fontSize: 11, color: 'var(--text-2)', lineHeight: 1.5 }}><span style={mono9}>RULES · </span>{m.rules}</div>}
                      {m.depth && <div style={{ fontSize: 11, color: 'var(--text-2)', lineHeight: 1.5 }}><span style={mono9}>DEPTH · </span>{m.depth}</div>}
                      {m.integration && <div style={{ fontSize: 11, color: 'var(--text-2)', lineHeight: 1.5 }}><span style={mono9}>CONNECTS · </span>{m.integration}</div>}
                    </div>
                  </details>
                )}
              </Card>
            ))}
          </div>
        </Section>
      )}

      {/* ── Narrative & World ── */}
      {(gdd.project.setting || gdd.project.lore || (gdd.story_acts?.length ?? 0) > 0 || (gdd.factions?.length ?? 0) > 0) && (
        <Section title="Narrative & World">
          {gdd.project.setting && (
            <Card>
              <div style={{ ...mono9, marginBottom: 6 }}>Setting</div>
              <p style={{ fontSize: 12, color: 'var(--text-2)', lineHeight: 1.65 }}>{gdd.project.setting}</p>
            </Card>
          )}
          {gdd.project.lore && (
            <Card>
              <div style={{ ...mono9, marginBottom: 6 }}>Lore</div>
              <p style={{ fontSize: 12, color: 'var(--text-2)', lineHeight: 1.65 }}>{gdd.project.lore}</p>
            </Card>
          )}
          {(gdd.story_acts?.length ?? 0) > 0 && (
            <div>
              <div style={{ ...mono9, marginBottom: 10 }}>Story Acts</div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                {gdd.story_acts!.map((a, i) => (
                  <div key={i} style={{ display: 'flex', gap: 12, alignItems: 'flex-start' }}>
                    <div style={{
                      flexShrink: 0, width: 28, height: 28, borderRadius: 99,
                      background: 'color-mix(in oklch, var(--cat-design) 15%, var(--bg-2))',
                      border: '1px solid color-mix(in oklch, var(--cat-design) 30%, transparent)',
                      display: 'grid', placeItems: 'center',
                      fontFamily: 'var(--font-mono)', fontSize: 11, fontWeight: 700, color: 'var(--cat-design)',
                    }}>{a.act}</div>
                    <div style={{ flex: 1, paddingTop: 3 }}>
                      <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--text-0)', marginBottom: 4 }}>{a.title}</div>
                      <div style={{ fontSize: 11, color: 'var(--text-2)', lineHeight: 1.6 }}>{a.summary}</div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
          {(gdd.factions?.length ?? 0) > 0 && (
            <div>
              <div style={{ ...mono9, marginBottom: 10 }}>Factions</div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: 8 }}>
                {gdd.factions!.map((f, i) => {
                  const alignLower = f.alignment?.toLowerCase() ?? ''
                  const alignColor = alignLower.includes('allied') ? 'var(--cat-design)' : alignLower.includes('enemy') ? 'var(--cat-output)' : 'var(--text-3)'
                  return (
                    <Card key={i}>
                      <div style={{ fontWeight: 700, fontSize: 12, color: 'var(--text-0)', marginBottom: 5 }}>{f.name}</div>
                      <Badge label={f.alignment} color={alignColor} />
                      {f.goals && <p style={{ fontSize: 11, color: 'var(--text-2)', lineHeight: 1.5, marginTop: 6, marginBottom: 4 }}>{f.goals}</p>}
                      {f.player_relationship && <div style={{ fontSize: 10, color: 'var(--text-3)', fontStyle: 'italic' }}>{f.player_relationship}</div>}
                    </Card>
                  )
                })}
              </div>
            </div>
          )}
          {(gdd.themes?.length ?? 0) > 0 && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              {gdd.themes!.map((t, i) => (
                <div key={i} style={{ display: 'flex', gap: 10, fontSize: 12, alignItems: 'flex-start' }}>
                  <span style={{ color: 'var(--cat-design)', fontWeight: 700, flexShrink: 0 }}>›</span>
                  <div><span style={{ fontWeight: 700, color: 'var(--text-1)' }}>{t.theme}</span>{t.manifestation && <span style={{ color: 'var(--text-3)' }}> — {t.manifestation}</span>}</div>
                </div>
              ))}
            </div>
          )}
        </Section>
      )}

      {/* ── Environments / Levels ── */}
      {(gdd.levels?.length ?? 0) > 0 && (
        <Section title={`Environments · ${gdd.levels.length}`}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {gdd.levels.map((l, i) => (
              <Card key={i}>
                {l.preview_url && (
                  <div style={{ margin: '-12px -14px 12px', borderRadius: '8px 8px 0 0', overflow: 'hidden', height: 160 }}>
                    <img src={assetUrl(l.preview_url)} alt={l.name}
                      style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }}
                      onError={e => { (e.currentTarget.parentElement as HTMLElement).style.display = 'none' }}
                    />
                  </div>
                )}
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 8 }}>
                  {l.order != null && (
                    <span style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--text-3)', background: 'var(--bg-3)', border: '1px solid var(--line)', borderRadius: 4, padding: '1px 7px' }}>
                      {String(l.order).padStart(2, '0')}
                    </span>
                  )}
                  <span style={{ fontWeight: 700, fontSize: 13, color: 'var(--text-0)', flex: 1 }}>{toStr(l.name)}</span>
                  {l.difficulty && <Badge label={toStr(l.difficulty)} color="var(--cat-level)" />}
                </div>
                {l.visual_feel && <div style={{ fontSize: 11, color: 'var(--text-2)', lineHeight: 1.5, marginBottom: 6 }}><span style={mono9}>VISUAL · </span>{l.visual_feel}</div>}
                {l.gameplay_role && <div style={{ fontSize: 11, color: 'var(--text-2)', lineHeight: 1.5, marginBottom: 6 }}><span style={mono9}>ROLE · </span>{l.gameplay_role}</div>}
                {l.narrative_significance && <div style={{ fontSize: 11, color: 'var(--text-3)', lineHeight: 1.5, fontStyle: 'italic' }}>{l.narrative_significance}</div>}
                {!l.visual_feel && l.description && <p style={{ fontSize: 12, color: 'var(--text-2)', lineHeight: 1.55 }}>{toStr(l.description)}</p>}
              </Card>
            ))}
          </div>
        </Section>
      )}

      {/* ── Art Direction ── */}
      <Section title="Art Direction">
        <Card>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {gdd.art_direction?.style && (
              <p style={{ fontSize: 12, color: 'var(--text-2)', lineHeight: 1.65 }}>{gdd.art_direction.style}</p>
            )}
            {paletteIsArray
              ? (gdd.art_direction.palette as import('@/lib/types').GDDPaletteSwatch[]).map((p, i) => (
                  <div key={i} style={{ display: 'flex', gap: 10, alignItems: 'flex-start' }}>
                    <div style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color: 'var(--text-3)', width: 90, flexShrink: 0 }}>{p.role}</div>
                    <div>
                      <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-1)' }}>{p.color_description}</div>
                      {p.usage && <div style={{ fontSize: 10, color: 'var(--text-3)' }}>{p.usage}</div>}
                    </div>
                  </div>
                ))
              : gdd.art_direction?.palette && (
                  <div style={{ fontFamily: 'var(--font-mono)', fontSize: 11, display: 'flex', gap: 8 }}>
                    <span style={{ color: 'var(--text-3)' }}>palette</span>
                    <span style={{ color: 'var(--text-1)' }}>{gdd.art_direction.palette as string}</span>
                  </div>
                )
            }
            {refsAreObjects
              ? (
                <div>
                  <div style={{ ...mono9, marginBottom: 6 }}>References</div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                    {(gdd.art_direction.references as import('@/lib/types').GDDArtRef[]).map((r, i) => (
                      <div key={i} style={{ display: 'flex', gap: 10, alignItems: 'flex-start' }}>
                        <span style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color: 'var(--cat-asset)', width: 140, flexShrink: 0 }}>{r.reference}</span>
                        <span style={{ fontSize: 11, color: 'var(--text-2)' }}>{r.what_we_take}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )
              : (gdd.art_direction?.references?.length ?? 0) > 0 && (
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
                    {(gdd.art_direction.references as string[]).map((r, i) => (
                      <span key={i} style={{ fontSize: 9, padding: '1px 6px', borderRadius: 3, background: 'var(--bg-3)', color: 'var(--text-2)', border: '1px solid var(--line)' }}>{r}</span>
                    ))}
                  </div>
                )
            }
            {gdd.art_direction?.character_style && (
              <div style={{ fontSize: 11, color: 'var(--text-2)', lineHeight: 1.55 }}>
                <span style={mono9}>CHARACTERS · </span>{gdd.art_direction.character_style}
              </div>
            )}
            {gdd.art_direction?.environment_style && (
              <div style={{ fontSize: 11, color: 'var(--text-2)', lineHeight: 1.55 }}>
                <span style={mono9}>ENVIRONMENTS · </span>{gdd.art_direction.environment_style}
              </div>
            )}
            {gdd.art_direction?.technical_targets && (
              <div style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color: 'var(--text-3)', padding: '6px 8px', background: 'var(--bg-1)', borderRadius: 5, border: '1px solid var(--line)' }}>
                {gdd.art_direction.technical_targets}
              </div>
            )}
          </div>
        </Card>
      </Section>

      {/* ── Audio Direction ── */}
      <Section title="Audio Direction">
        <Card>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8, fontFamily: 'var(--font-mono)', fontSize: 11 }}>
            {gdd.audio_direction?.music_genre
              ? <>
                  {gdd.audio_direction.music_genre && <div><span style={{ color: 'var(--text-3)' }}>genre · </span><span style={{ color: 'var(--text-1)' }}>{gdd.audio_direction.music_genre}</span></div>}
                  {gdd.audio_direction.instrumentation && <div><span style={{ color: 'var(--text-3)' }}>instruments · </span><span style={{ color: 'var(--text-2)' }}>{gdd.audio_direction.instrumentation}</span></div>}
                  {gdd.audio_direction.adaptive_music && <div><span style={{ color: 'var(--text-3)' }}>adaptive · </span><span style={{ color: 'var(--text-2)' }}>{gdd.audio_direction.adaptive_music}</span></div>}
                  {gdd.audio_direction.sound_design_style && <div><span style={{ color: 'var(--text-3)' }}>sfx · </span><span style={{ color: 'var(--text-2)' }}>{gdd.audio_direction.sound_design_style}</span></div>}
                  {gdd.audio_direction.voice_over && <div><span style={{ color: 'var(--text-3)' }}>voice over · </span><span style={{ color: 'var(--text-2)' }}>{gdd.audio_direction.voice_over}</span></div>}
                  {gdd.audio_direction.ambience && <div><span style={{ color: 'var(--text-3)' }}>ambience · </span><span style={{ color: 'var(--text-2)' }}>{gdd.audio_direction.ambience}</span></div>}
                </>
              : <>
                  {gdd.audio_direction?.music_mood && <div style={{ display: 'flex', justifyContent: 'space-between' }}><span style={{ color: 'var(--text-3)' }}>mood</span><span style={{ color: 'var(--text-1)' }}>{gdd.audio_direction.music_mood}</span></div>}
                  {gdd.audio_direction?.music_style && <div style={{ display: 'flex', justifyContent: 'space-between' }}><span style={{ color: 'var(--text-3)' }}>style</span><span style={{ color: 'var(--text-1)' }}>{gdd.audio_direction.music_style}</span></div>}
                  {gdd.audio_direction?.sfx_notes && <div style={{ color: 'var(--text-2)', fontSize: 11, lineHeight: 1.5 }}><span style={{ color: 'var(--text-3)' }}>sfx · </span>{gdd.audio_direction.sfx_notes}</div>}
                </>
            }
          </div>
        </Card>
      </Section>

      {/* ── Progression ── */}
      {((gdd.game_phases?.length ?? 0) > 0 || (gdd.player_abilities?.length ?? 0) > 0) && (
        <Section title="Progression">
          {(gdd.game_phases?.length ?? 0) > 0 && (
            <div style={{ display: 'flex', gap: 8, marginBottom: 10, flexWrap: 'wrap' }}>
              {gdd.game_phases!.map((p, i) => (
                <div key={i} style={{ flex: '1 1 140px', background: 'var(--bg-2)', border: '1px solid var(--line-2)', borderRadius: 8, padding: '10px 12px' }}>
                  <div style={{ fontWeight: 700, fontSize: 12, color: 'var(--text-0)', marginBottom: 2 }}>{p.phase}</div>
                  <div style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color: 'var(--text-3)', marginBottom: 6 }}>{p.time_range}</div>
                  {p.key_unlock && <Badge label={p.key_unlock} color="var(--cat-gate)" />}
                </div>
              ))}
            </div>
          )}
          {(gdd.player_abilities?.length ?? 0) > 0 && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 7 }}>
              {gdd.player_abilities!.map((a, i) => (
                <div key={i} style={{ display: 'flex', gap: 10, alignItems: 'flex-start', fontSize: 12 }}>
                  <div style={{ flexShrink: 0 }}><Badge label={a.ability} color="var(--cat-design)" /></div>
                  <span style={{ color: 'var(--text-2)', flex: 1, lineHeight: 1.5 }}>{a.description}</span>
                  {a.cooldown_cost && <span style={{ color: 'var(--text-3)', fontFamily: 'var(--font-mono)', fontSize: 10, whiteSpace: 'nowrap', paddingTop: 2 }}>{a.cooldown_cost}</span>}
                </div>
              ))}
            </div>
          )}
        </Section>
      )}

      {/* ── Economy ── */}
      {gdd.economy?.model && (
        <Section title="Economy">
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
            <Card>
              <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--text-0)', marginBottom: 4 }}>{gdd.economy.model}</div>
              {gdd.economy.price && <div style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--cat-design)', marginBottom: 10 }}>{gdd.economy.price}</div>}
              {(gdd.economy.currencies?.length ?? 0) > 0 && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                  {gdd.economy.currencies.map((c, i) => (
                    <div key={i} style={{ display: 'flex', gap: 8, alignItems: 'center', fontSize: 11 }}>
                      <Badge label={c.currency} color="var(--cat-asset)" />
                      <span style={{ color: 'var(--text-3)' }}>{c.how_earned}</span>
                    </div>
                  ))}
                </div>
              )}
            </Card>
            {(gdd.economy.reward_structure?.length ?? 0) > 0 && (
              <Card>
                <div style={{ ...mono9, marginBottom: 8 }}>Reward Structure</div>
                {gdd.economy.reward_structure.map((r, i) => (
                  <div key={i} style={{ display: 'flex', gap: 8, fontSize: 11, marginBottom: 5 }}>
                    <span style={{ fontWeight: 600, color: 'var(--text-1)', flex: 1 }}>{r.reward_type}</span>
                    <span style={{ color: 'var(--text-3)', fontFamily: 'var(--font-mono)', fontSize: 10 }}>{r.frequency}</span>
                  </div>
                ))}
              </Card>
            )}
          </div>
        </Section>
      )}

      {/* ── Magic Moments ── */}
      {(gdd.magic_moments?.length ?? 0) > 0 && (
        <Section title="Magic Moments">
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {gdd.magic_moments!.map((m, i) => (
              <div key={i} style={{ display: 'flex', gap: 12, alignItems: 'flex-start' }}>
                <div style={{
                  flexShrink: 0, width: 22, height: 22, borderRadius: 99,
                  background: 'color-mix(in oklch, var(--cat-audio) 15%, var(--bg-2))',
                  border: '1px solid color-mix(in oklch, var(--cat-audio) 30%, transparent)',
                  display: 'grid', placeItems: 'center',
                  fontFamily: 'var(--font-mono)', fontSize: 10, fontWeight: 700, color: 'var(--cat-audio)',
                }}>{i + 1}</div>
                <div style={{ fontSize: 12, color: 'var(--text-2)', lineHeight: 1.65, paddingTop: 2 }}>{m}</div>
              </div>
            ))}
          </div>
        </Section>
      )}

      {/* ── Development ── */}
      <Section title="Development">
        <Card>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              {gdd.development?.suggested_engine && <Badge label={gdd.development.suggested_engine} color="var(--cat-code)" />}
              {gdd.development?.language && <Badge label={gdd.development.language} color="var(--cat-gate)" />}
              {gdd.development?.estimated_scope && <Badge label={gdd.development.estimated_scope} color="var(--text-3)" />}
            </div>
            {(gdd.development?.tools?.length ?? 0) > 0 && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
                {gdd.development!.tools!.map((t, i) => (
                  <div key={i} style={{ display: 'flex', gap: 10, fontSize: 11 }}>
                    <span style={{ color: 'var(--text-3)', fontFamily: 'var(--font-mono)', fontSize: 10, width: 130, flexShrink: 0 }}>{t.category}</span>
                    <span style={{ color: 'var(--text-2)' }}>{t.tool}</span>
                  </div>
                ))}
              </div>
            )}
            {(gdd.development?.tools?.length ?? 0) === 0 && (gdd.development?.core_features?.length ?? 0) > 0 && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
                {gdd.development!.core_features!.map((f, i) => (
                  <div key={i} style={{ display: 'flex', gap: 8, fontSize: 12, color: 'var(--text-2)' }}>
                    <span style={{ color: 'var(--cat-code)' }}>›</span>
                    {typeof f === 'string' ? f : (f as Record<string,string>).name ?? ''}
                  </div>
                ))}
              </div>
            )}
          </div>
        </Card>
      </Section>

      {/* ── Concept origin ── */}
      {ideaCandidate && (
        <div style={{ marginTop: 32, paddingTop: 24, borderTop: '1px solid var(--line-2)' }}>
          <div style={{ ...mono9, marginBottom: 12 }}>Concept origin</div>
          <div style={{ display: 'flex', gap: 16, alignItems: 'flex-start' }}>
            {ideaCandidate.idea_data.image_url && (
              <img src={ideaCandidate.idea_data.image_url} alt={ideaCandidate.title}
                style={{ width: 160, aspectRatio: '16/9', objectFit: 'cover', borderRadius: 6, flexShrink: 0, border: '1px solid var(--line-2)' }}
              />
            )}
            <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 8 }}>
              <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--text-0)' }}>{ideaCandidate.title}</div>
              <div style={{ fontSize: 11, color: 'var(--text-2)', lineHeight: 1.6 }}>{ideaCandidate.idea_data.elevator_pitch}</div>
              {ideaCandidate.original_description && (
                <div style={{ paddingTop: 8, borderTop: '1px solid var(--line-2)' }}>
                  <div style={{ ...mono9, marginBottom: 4 }}>Original description</div>
                  <div style={{ fontSize: 11, color: 'var(--text-3)', lineHeight: 1.6, fontStyle: 'italic' }}>"{ideaCandidate.original_description}"</div>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* ── Lightbox ── */}
      {lightbox && (
        <div
          onClick={() => setLightbox(null)}
          style={{
            position: 'fixed', inset: 0, zIndex: 2000,
            background: 'rgba(0,0,0,0.88)', backdropFilter: 'blur(6px)',
            display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 14,
            cursor: 'zoom-out',
          }}
        >
          <img
            src={lightbox.url}
            alt={lightbox.name}
            onClick={e => e.stopPropagation()}
            style={{
              maxWidth: '80vw', maxHeight: '75vh',
              borderRadius: 12, objectFit: 'contain',
              boxShadow: '0 32px 80px rgba(0,0,0,0.7)',
              cursor: 'default',
            }}
          />
          <div style={{ fontFamily: 'var(--font-mono)', fontSize: 12, color: 'var(--text-2)', letterSpacing: '0.04em' }}>
            {lightbox.name} · <span style={{ color: 'var(--text-3)' }}>click anywhere or Esc to close</span>
          </div>
        </div>
      )}
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
        &nbsp;·&nbsp;Palette: <strong style={{ color: 'var(--text-1)' }}>{Array.isArray(g?.art_direction?.palette) ? (g!.art_direction.palette as import('@/lib/types').GDDPaletteSwatch[]).map(p => p.role).join(', ') : (g?.art_direction?.palette ?? '–')}</strong>
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
              {(c.abilities?.length ?? 0) > 0 && (
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, marginBottom: 10 }}>
                  {c.abilities!.map((a, j) => (
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

// ─── Image Reference Detail ───────────────────────────────────────────────────

const STATUS_COLOR: Record<string, string> = {
  empty:     'var(--text-3)',
  pending:   'var(--cat-gate)',
  generated: 'var(--cat-asset)',
  approved:  'var(--cat-code)',
}

function ImageReferenceDetail({ project, onNodeApproved }: { project: Project; onNodeApproved: () => void }) {
  const [status,        setStatus]       = useState<GlobalRefStatus | null>(null)
  const [promptUsed,    setPromptUsed]   = useState<string>('')
  const [maxPool,       setMaxPool]      = useState(20)
  const [pool,          setPool]         = useState<ImageRef[]>([])
  const [selectedIds,   setSelectedIds]  = useState<Set<string>>(new Set())
  const [genCount,      setGenCount]     = useState(5)
  const [loading,       setLoading]      = useState(true)
  const [poolLoading,   setPoolLoading]  = useState(false)
  const [generating,    setGenerating]   = useState(false)
  const [approving,     setApproving]    = useState(false)
  const [approvingNode, setApprovingNode] = useState(false)
  const [error,         setError]        = useState<string | null>(null)
  const [zoomedUrl,     setZoomedUrl]    = useState<string | null>(null)
  const [refiningImage, setRefiningImage] = useState<{ id: string; url: string } | null>(null)

  const nodeApproved = !!((project.concept?.pipeline?.image_reference as Record<string, unknown> | undefined)?.approved)

  const loadStatus = useCallback(async () => {
    try {
      const res = await getImageReferenceStatus(project.id)
      setStatus(res.status)
      setPromptUsed(res.prompt_used)
      setMaxPool(res.max_pool)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Error loading status')
    } finally { setLoading(false) }
  }, [project.id])

  const loadPool = useCallback(async () => {
    setPoolLoading(true)
    try {
      const images = await getImageReferencePool(project.id)
      setPool(images)
      setSelectedIds(new Set(images.filter(i => i.selected).map(i => i.id)))
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Error loading pool')
    } finally { setPoolLoading(false) }
  }, [project.id])

  useEffect(() => { loadStatus(); loadPool() }, [loadStatus, loadPool])

  useEffect(() => {
    if (!zoomedUrl) return
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') { e.stopPropagation(); setZoomedUrl(null) }
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [zoomedUrl])

  async function handleGenerate() {
    if (generating) return
    setGenerating(true); setError(null)
    try {
      const images = await generateImageReferenceRound(project.id, genCount)
      setPool(prev => [...prev, ...images])
      await loadStatus()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Error generating')
    } finally { setGenerating(false) }
  }

  async function handleApproveSelection() {
    if (selectedIds.size !== 2 || approving) return
    setApproving(true); setError(null)
    try {
      await approveImageReferenceSelection(project.id, Array.from(selectedIds))
      setPool(prev => prev.map(i => ({ ...i, selected: selectedIds.has(i.id) })))
      await loadStatus()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Error approving')
    } finally { setApproving(false) }
  }

  async function handleApproveNode() {
    setApprovingNode(true); setError(null)
    try {
      await approveNode(project.id, 'image_reference', {})
      onNodeApproved()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Error approving node')
    } finally { setApprovingNode(false) }
  }

  function toggleImage(id: string) {
    setSelectedIds(prev => {
      const next = new Set(prev)
      next.has(id) ? next.delete(id) : next.add(id)
      return next
    })
  }

  function handleRefined({ image_url, refined_from_id }: { image_url: string; refined_from_id: string }) {
    const nextRound = Math.max(...pool.map(i => i.round), 0) + 1
    const newImg: ImageRef = {
      id:              `refined-${Date.now()}`,
      project_id:      project.id,
      character_key:   'global',
      image_url,
      storage_path:    '',
      round:           nextRound,
      selected:        false,
      refined_from_id,
      created_at:      new Date().toISOString(),
    }
    setPool(prev => [...prev, newImg])
  }

  const isApproved  = status?.status === 'approved'
  const atPoolLimit = status?.at_pool_limit ?? false
  const poolByRound = pool.reduce<Record<number, ImageRef[]>>((acc, img) => {
    (acc[img.round] ??= []).push(img)
    return acc
  }, {})

  if (loading) return (
    <div style={{ padding: 24, color: 'var(--text-3)', fontFamily: 'var(--font-mono)', fontSize: 12 }}>Loading…</div>
  )

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>

      {error && (
        <div style={{ fontSize: 11, fontFamily: 'var(--font-mono)', color: 'var(--cat-output)', background: 'color-mix(in oklch, var(--cat-output) 10%, var(--bg-2))', padding: '8px 12px', borderRadius: 6 }}>{error}</div>
      )}

      <Section title="Global Reference Pool">
        {/* Game concept prompt */}
        <div style={{ fontSize: 10, fontFamily: 'var(--font-mono)', color: 'var(--text-3)', background: 'var(--bg-2)', borderRadius: 6, padding: '8px 10px', marginBottom: 6 }}>
          <strong style={{ color: 'var(--text-2)' }}>Prompt used:</strong>{' '}
          {promptUsed || '—'}
        </div>

        {/* Status badge + counters */}
        {status && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12 }}>
            <span style={{
              fontSize: 9, fontFamily: 'var(--font-mono)', padding: '2px 7px', borderRadius: 99,
              background: `color-mix(in oklch, ${STATUS_COLOR[status.status]} 12%, var(--bg-1))`,
              border: `1px solid color-mix(in oklch, ${STATUS_COLOR[status.status]} 30%, transparent)`,
              color: STATUS_COLOR[status.status],
            }}>{status.status}</span>
            <span style={{ fontSize: 10, fontFamily: 'var(--font-mono)', color: 'var(--text-3)' }}>
              {status.total_images} image{status.total_images !== 1 ? 's' : ''} · {status.rounds} round{status.rounds !== 1 ? 's' : ''} · {status.selected_count}/2 selected
            </span>
          </div>
        )}

        {/* Generate controls */}
        {nodeApproved && (
          <div style={{ fontSize: 10, fontFamily: 'var(--font-mono)', color: 'var(--text-3)', background: 'var(--bg-2)', border: '1px solid var(--line-2)', borderRadius: 6, padding: '8px 12px', marginBottom: 12 }}>
            🔒 Node approved — regeneration locked
          </div>
        )}
        {!nodeApproved && !isApproved && !atPoolLimit && (
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 12 }}>
            <input
              type="number" min={1} max={10} value={genCount}
              onChange={e => setGenCount(Math.min(10, Math.max(1, Number(e.target.value))))}
              style={{
                width: 56, background: 'var(--bg-2)', border: '1px solid var(--line-2)',
                borderRadius: 5, padding: '5px 8px', fontSize: 11, color: 'var(--text-0)',
                fontFamily: 'var(--font-mono)',
              }}
            />
            <button
              onClick={handleGenerate} disabled={generating}
              style={{
                padding: '6px 14px', borderRadius: 5, border: 'none', cursor: generating ? 'not-allowed' : 'pointer',
                background: 'var(--cat-code)', color: '#0a0a0c',
                fontSize: 11, fontFamily: 'var(--font-mono)', fontWeight: 600, opacity: generating ? 0.6 : 1,
                display: 'flex', alignItems: 'center', gap: 6,
              }}
            >
              {generating
                ? <><span style={{ display: 'inline-block', width: 10, height: 10, border: '2px solid currentColor', borderTopColor: 'transparent', borderRadius: '50%', animation: 'spin 0.7s linear infinite' }} />Generating…</>
                : `▶ Generate ${genCount} image${genCount !== 1 ? 's' : ''}`}
            </button>
            <span style={{ fontSize: 10, fontFamily: 'var(--font-mono)', color: 'var(--text-3)' }}>
              {pool.length}/{maxPool} in pool
            </span>
          </div>
        )}
        {!nodeApproved && !isApproved && atPoolLimit && (
          <div style={{ fontSize: 10, fontFamily: 'var(--font-mono)', color: 'var(--cat-output)', marginBottom: 12 }}>
            Pool limit reached ({maxPool} images)
          </div>
        )}

        {poolLoading && (
          <div style={{ fontSize: 11, fontFamily: 'var(--font-mono)', color: 'var(--text-3)' }}>Loading images…</div>
        )}

        {!poolLoading && pool.length === 0 && (
          <div style={{ fontSize: 11, fontFamily: 'var(--font-mono)', color: 'var(--text-3)' }}>No images yet. Generate the first round.</div>
        )}

        {/* Approved: flat row — selected green, deselected gray */}
        {!poolLoading && isApproved && pool.length > 0 && (
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            {pool.map(img => (
              <div key={img.id} style={{ position: 'relative', borderRadius: 6, overflow: 'hidden', border: `2px solid ${img.selected ? 'var(--cat-code)' : 'var(--line-2)'}`, flexShrink: 0, opacity: img.selected ? 1 : 0.4 }}>
                <img src={img.image_url} alt="" style={{ width: 140, height: 140, display: 'block', objectFit: 'cover' }} />
                {img.selected && (
                  <div style={{ position: 'absolute', top: 6, left: 6, width: 20, height: 20, borderRadius: '50%', background: 'var(--cat-code)', display: 'grid', placeItems: 'center', fontSize: 11, color: '#0a0a0c', fontWeight: 700 }}>✓</div>
                )}
                {img.refined_from_id && (
                  <div style={{ position: 'absolute', top: 6, right: 6, fontSize: 8, fontFamily: 'var(--font-mono)', padding: '1px 5px', borderRadius: 3, background: 'rgba(0,0,0,0.6)', color: 'var(--cat-asset)' }}>refined</div>
                )}
                {img.selected && (
                  <button
                    onClick={e => { e.stopPropagation(); setRefiningImage({ id: img.id, url: img.image_url }) }}
                    style={{ position: 'absolute', bottom: 6, left: 6, width: 24, height: 24, borderRadius: 5, background: 'rgba(0,0,0,0.6)', border: 'none', display: 'grid', placeItems: 'center', cursor: 'pointer', color: '#fff', fontSize: 13, opacity: 0.7, transition: 'opacity 150ms' }}
                    onMouseEnter={e => (e.currentTarget.style.opacity = '1')}
                    onMouseLeave={e => (e.currentTarget.style.opacity = '0.7')}
                    title="Refinar imagen"
                  >⚙</button>
                )}
                <button
                  onClick={e => { e.stopPropagation(); setZoomedUrl(img.image_url) }}
                  style={{ position: 'absolute', bottom: 6, right: 6, width: 24, height: 24, borderRadius: 5, background: 'rgba(0,0,0,0.6)', border: 'none', display: 'grid', placeItems: 'center', cursor: 'pointer', color: '#fff', fontSize: 13, opacity: 0.7, transition: 'opacity 150ms' }}
                  onMouseEnter={e => (e.currentTarget.style.opacity = '1')}
                  onMouseLeave={e => (e.currentTarget.style.opacity = '0.7')}
                  title="Zoom"
                >⊕</button>
              </div>
            ))}
          </div>
        )}

        {/* Pending: grouped by round, selectable */}
        {!poolLoading && !isApproved && Object.entries(poolByRound).map(([round, images]) => (
          <div key={round} style={{ marginBottom: 16 }}>
            <div style={{ fontSize: 10, fontFamily: 'var(--font-mono)', color: 'var(--text-3)', marginBottom: 8 }}>Round {round}</div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(140px, 1fr))', gap: 8 }}>
              {images.map(img => {
                const sel = selectedIds.has(img.id)
                return (
                  <div
                    key={img.id}
                    onClick={() => !nodeApproved && toggleImage(img.id)}
                    style={{
                      position: 'relative', cursor: nodeApproved ? 'default' : 'pointer', borderRadius: 6, overflow: 'hidden',
                      border: `2px solid ${sel ? 'var(--cat-code)' : 'var(--line-2)'}`,
                      transition: 'border-color 100ms',
                    }}
                  >
                    <img src={img.image_url} alt="" style={{ width: '100%', display: 'block', aspectRatio: '1', objectFit: 'cover' }} />
                    {sel && (
                      <div style={{ position: 'absolute', top: 6, right: 6, width: 20, height: 20, borderRadius: '50%', background: 'var(--cat-code)', display: 'grid', placeItems: 'center', fontSize: 11, color: '#0a0a0c', fontWeight: 700 }}>✓</div>
                    )}
                    <button
                      onClick={e => { e.stopPropagation(); setZoomedUrl(img.image_url) }}
                      style={{ position: 'absolute', bottom: 6, right: 6, width: 24, height: 24, borderRadius: 5, background: 'rgba(0,0,0,0.6)', border: 'none', display: 'grid', placeItems: 'center', cursor: 'pointer', color: '#fff', fontSize: 13, opacity: 0.7, transition: 'opacity 150ms' }}
                      onMouseEnter={e => (e.currentTarget.style.opacity = '1')}
                      onMouseLeave={e => (e.currentTarget.style.opacity = '0.7')}
                      title="Zoom"
                    >⊕</button>
                  </div>
                )
              })}
            </div>
          </div>
        ))}

        {/* Approve selection — exactly 2 required */}
        {pool.length > 0 && !isApproved && !nodeApproved && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, paddingTop: 8, borderTop: '1px solid var(--line-2)' }}>
            <span style={{ fontSize: 11, fontFamily: 'var(--font-mono)', color: selectedIds.size === 2 ? 'var(--cat-code)' : 'var(--text-3)' }}>
              {selectedIds.size}/2 selected
            </span>
            <button
              onClick={handleApproveSelection}
              disabled={selectedIds.size !== 2 || approving}
              style={{
                padding: '6px 16px', borderRadius: 5, border: 'none',
                cursor: selectedIds.size !== 2 || approving ? 'not-allowed' : 'pointer',
                background: selectedIds.size === 2 ? 'var(--cat-code)' : 'var(--bg-3)',
                color: selectedIds.size === 2 ? '#0a0a0c' : 'var(--text-3)',
                fontSize: 11, fontFamily: 'var(--font-mono)', fontWeight: 600,
                opacity: approving ? 0.6 : 1,
              }}
            >
              {approving ? 'Saving…' : 'Approve selection'}
            </button>
          </div>
        )}
      </Section>

      {/* Approve full node */}
      {isApproved && !nodeApproved && (
        <div style={{ borderTop: '1px solid var(--line-2)', paddingTop: 16, display: 'flex', alignItems: 'center', gap: 12 }}>
          <span style={{ fontSize: 11, fontFamily: 'var(--font-mono)', color: 'var(--cat-code)' }}>
            2 reference images selected
          </span>
          <button
            onClick={handleApproveNode}
            disabled={approvingNode}
            style={{
              padding: '8px 20px', borderRadius: 6, border: 'none',
              cursor: approvingNode ? 'not-allowed' : 'pointer',
              background: 'var(--cat-code)', color: '#0a0a0c',
              fontSize: 12, fontFamily: 'var(--font-mono)', fontWeight: 700,
              opacity: approvingNode ? 0.6 : 1,
            }}
          >
            {approvingNode ? 'Approving…' : 'Approve Image Reference node'}
          </button>
        </div>
      )}

      <style>{`@keyframes spin { to { transform: rotate(360deg) } }`}</style>

      {/* Modal de refinamiento */}
      {refiningImage && (
        <RefinementModal
          imageUrl={refiningImage.url}
          imageId={refiningImage.id}
          project={project}
          onRefined={handleRefined}
          onClose={() => setRefiningImage(null)}
        />
      )}

      {/* Lightbox */}
      {zoomedUrl && (
        <div
          onClick={() => setZoomedUrl(null)}
          style={{ position: 'fixed', inset: 0, zIndex: 2000, background: 'rgba(0,0,0,0.88)', backdropFilter: 'blur(6px)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 32 }}
        >
          <button
            onClick={() => setZoomedUrl(null)}
            style={{ position: 'absolute', top: 20, right: 20, background: 'rgba(255,255,255,0.1)', border: '1px solid rgba(255,255,255,0.2)', borderRadius: 8, width: 36, height: 36, display: 'grid', placeItems: 'center', cursor: 'pointer', color: '#fff', fontSize: 18 }}
          >✕</button>
          <img src={zoomedUrl} alt="" onClick={e => e.stopPropagation()} style={{ maxWidth: '100%', maxHeight: '100%', objectFit: 'contain', borderRadius: 10, boxShadow: '0 24px 80px rgba(0,0,0,0.8)' }} />
        </div>
      )}
    </div>
  )
}

function ImageReferenceOutput({ project }: { project: Project }) {
  const [pool,       setPool]       = useState<ImageRef[]>([])
  const [promptUsed, setPromptUsed] = useState<string>('')
  const [loading,    setLoading]    = useState(true)
  const [zoomedUrl,  setZoomedUrl]  = useState<string | null>(null)

  useEffect(() => {
    if (!zoomedUrl) return
    function onKey(e: KeyboardEvent) { if (e.key === 'Escape') { e.stopPropagation(); setZoomedUrl(null) } }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [zoomedUrl])

  useEffect(() => {
    async function load() {
      const [statusRes, poolRes] = await Promise.all([
        getImageReferenceStatus(project.id),
        getImageReferencePool(project.id),
      ])
      setPromptUsed(statusRes.prompt_used)
      setPool(poolRes.filter(i => i.selected))
      setLoading(false)
    }
    load().catch(() => setLoading(false))
  }, [project.id])

  if (loading) return <div style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--text-3)', padding: 12 }}>Loading…</div>

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      {promptUsed && (
        <div style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color: 'var(--text-2)', background: 'var(--bg-2)', border: '1px solid var(--line-2)', borderRadius: 6, padding: '10px 12px', lineHeight: 1.6 }}>
          <strong style={{ color: 'var(--text-3)' }}>Prompt used:</strong>{' '}{promptUsed}
        </div>
      )}
      <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
        {pool.map(img => (
          <div key={img.id} style={{ position: 'relative', flexShrink: 0 }}>
            <img src={img.image_url} alt="reference"
              style={{ width: 200, height: 200, objectFit: 'cover', borderRadius: 8, border: '2px solid var(--cat-code)', display: 'block' }} />
            <button
              onClick={() => setZoomedUrl(img.image_url)}
              style={{ position: 'absolute', bottom: 6, right: 6, width: 24, height: 24, borderRadius: 5, background: 'rgba(0,0,0,0.6)', border: 'none', display: 'grid', placeItems: 'center', cursor: 'pointer', color: '#fff', fontSize: 13, opacity: 0.7, transition: 'opacity 150ms' }}
              onMouseEnter={e => (e.currentTarget.style.opacity = '1')}
              onMouseLeave={e => (e.currentTarget.style.opacity = '0.7')}
              title="Zoom"
            >⊕</button>
          </div>
        ))}
        {pool.length === 0 && (
          <div style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color: 'var(--text-3)' }}>No reference images selected yet.</div>
        )}
      </div>
      {zoomedUrl && (
        <div onClick={() => setZoomedUrl(null)} style={{ position: 'fixed', inset: 0, zIndex: 2000, background: 'rgba(0,0,0,0.88)', backdropFilter: 'blur(6px)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 32 }}>
          <button onClick={() => setZoomedUrl(null)} style={{ position: 'absolute', top: 20, right: 20, background: 'rgba(255,255,255,0.1)', border: '1px solid rgba(255,255,255,0.2)', borderRadius: 8, width: 36, height: 36, display: 'grid', placeItems: 'center', cursor: 'pointer', color: '#fff', fontSize: 18 }}>✕</button>
          <img src={zoomedUrl} alt="" onClick={e => e.stopPropagation()} style={{ maxWidth: '100%', maxHeight: '100%', objectFit: 'contain', borderRadius: 10, boxShadow: '0 24px 80px rgba(0,0,0,0.8)' }} />
        </div>
      )}
    </div>
  )
}

function CharatersOutput({ project }: { project: Project }) {
  const [chars,     setChars]     = useState<CharacterRenderStatus[]>([])
  const [loading,   setLoading]   = useState(true)
  const [zoomedUrl, setZoomedUrl] = useState<string | null>(null)

  useEffect(() => {
    if (!zoomedUrl) return
    function onKey(e: KeyboardEvent) { if (e.key === 'Escape') { e.stopPropagation(); setZoomedUrl(null) } }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [zoomedUrl])

  useEffect(() => {
    getCharatersStatus(project.id).then(setChars).catch(() => {}).finally(() => setLoading(false))
  }, [project.id])

  const approved = chars.filter(c => c.status === 'approved')

  if (loading) return <div style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--text-3)', padding: 12 }}>Loading…</div>
  if (!approved.length) return <div style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--text-3)', padding: 12 }}>No approved characters yet.</div>

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
      {approved.map(c => (
        <div key={c.character_key} style={{ borderBottom: '1px solid var(--line-2)', paddingBottom: 20 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
            <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-0)' }}>{c.character_name}</span>
            <span style={{ fontSize: 9, fontFamily: 'var(--font-mono)', padding: '2px 7px', borderRadius: 99, background: 'color-mix(in oklch, var(--cat-code) 12%, var(--bg-1))', border: '1px solid color-mix(in oklch, var(--cat-code) 30%, transparent)', color: 'var(--cat-code)' }}>approved</span>
          </div>
          <div style={{ display: 'flex', gap: 12, alignItems: 'flex-start' }}>
            {c.current_version?.storage_url ? (
              <div style={{ position: 'relative', flexShrink: 0 }}>
                <img src={c.current_version.storage_url} alt={c.character_name}
                  style={{ width: 140, height: 140, objectFit: 'cover', borderRadius: 8, border: '2px solid var(--cat-code)', display: 'block' }} />
                <button
                  onClick={() => setZoomedUrl(c.current_version!.storage_url)}
                  style={{ position: 'absolute', bottom: 6, right: 6, width: 24, height: 24, borderRadius: 5, background: 'rgba(0,0,0,0.6)', border: 'none', display: 'grid', placeItems: 'center', cursor: 'pointer', color: '#fff', fontSize: 13, opacity: 0.7, transition: 'opacity 150ms' }}
                  onMouseEnter={e => (e.currentTarget.style.opacity = '1')}
                  onMouseLeave={e => (e.currentTarget.style.opacity = '0.7')}
                  title="Zoom"
                >⊕</button>
              </div>
            ) : null}
            {c.sprite_prompt && (
              <div style={{ flex: 1, fontFamily: 'var(--font-mono)', fontSize: 10, color: 'var(--text-2)', background: 'var(--bg-2)', border: '1px solid var(--line-2)', borderRadius: 6, padding: '10px 12px', lineHeight: 1.6, alignSelf: 'stretch', display: 'flex', alignItems: 'center' }}>
                {c.sprite_prompt}
              </div>
            )}
          </div>
        </div>
      ))}
      {zoomedUrl && (
        <div onClick={() => setZoomedUrl(null)} style={{ position: 'fixed', inset: 0, zIndex: 2000, background: 'rgba(0,0,0,0.88)', backdropFilter: 'blur(6px)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 32 }}>
          <button onClick={() => setZoomedUrl(null)} style={{ position: 'absolute', top: 20, right: 20, background: 'rgba(255,255,255,0.1)', border: '1px solid rgba(255,255,255,0.2)', borderRadius: 8, width: 36, height: 36, display: 'grid', placeItems: 'center', cursor: 'pointer', color: '#fff', fontSize: 18 }}>✕</button>
          <img src={zoomedUrl} alt="" onClick={e => e.stopPropagation()} style={{ maxWidth: '100%', maxHeight: '100%', objectFit: 'contain', borderRadius: 10, boxShadow: '0 24px 80px rgba(0,0,0,0.8)' }} />
        </div>
      )}
    </div>
  )
}

export function ImageReferenceModal({ project, onClose, onApproved }: { project: Project; onClose: () => void; onApproved: () => void }) {
  useEffect(() => {
    function onKey(e: KeyboardEvent) { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

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
          width: '100%', maxWidth: 1000,
          maxHeight: '90vh',
          background: 'var(--bg-1)',
          border: '1px solid var(--line-2)',
          borderRadius: 12,
          display: 'flex', flexDirection: 'column',
          boxShadow: '0 32px 80px rgba(0,0,0,0.6)',
          overflow: 'hidden',
        }}
      >
        {/* Header */}
        <div style={{
          display: 'flex', alignItems: 'center', gap: 12,
          padding: '14px 20px',
          borderBottom: '1px solid var(--line)',
          flexShrink: 0,
        }}>
          <div style={{ flex: 1 }}>
            <div style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color: 'var(--text-3)', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 2 }}>
              Image Reference
            </div>
            <div style={{ fontSize: 15, fontWeight: 600, color: 'var(--text-0)' }}>
              Character Reference Images
            </div>
          </div>
          <div style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color: 'var(--text-3)' }}>
            {project.name}
          </div>
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
          >✕</button>
        </div>

        {/* Body */}
        <div style={{ flex: 1, overflow: 'auto', padding: '20px 24px' }}>
          <ImageReferenceDetail project={project} onNodeApproved={() => { onApproved(); onClose() }} />
        </div>
      </div>
    </div>
  )
}

/* ─── CharatersDetail ─── */

function CharatersDetail({ project, onNodeApproved }: { project: Project; onNodeApproved: () => void }) {
  const [chars,        setChars]        = useState<CharacterRenderStatus[]>([])
  const [selectedChar, setSelectedChar] = useState<string | null>(null)
  const [refImages,    setRefImages]    = useState<ImageRef[]>([])
  const [loading,      setLoading]      = useState(true)
  const [generating,   setGenerating]   = useState(false)
  const [approving,    setApproving]    = useState(false)
  const [approvingNode, setApprovingNode] = useState(false)
  const [error,        setError]        = useState<string | null>(null)
  const [zoomedUrl,    setZoomedUrl]    = useState<string | null>(null)
  const [freshUrl,     setFreshUrl]     = useState<string | null>(null)

  const loadStatus = useCallback(async () => {
    try {
      const res = await getCharatersStatus(project.id)
      setChars(res)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Error loading status')
    } finally { setLoading(false) }
  }, [project.id])

  useEffect(() => { loadStatus() }, [loadStatus])

  useEffect(() => {
    if (!zoomedUrl) return
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') { e.stopPropagation(); setZoomedUrl(null) }
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [zoomedUrl])

  async function selectChar(key: string) {
    setSelectedChar(key)
    setFreshUrl(null)
    setError(null)
    setRefImages([])
    try {
      const imgs = await getImageReferencePool(project.id)
      setRefImages(imgs.filter(i => i.selected))
    } catch { /* no refs is fine */ }
  }

  async function handleGenerate() {
    if (!selectedChar || generating) return
    setGenerating(true); setError(null)
    try {
      const res = await generateCharacterRender(project.id, selectedChar)
      setFreshUrl(res.image_url ?? res.version?.storage_url ?? null)
      await loadStatus()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Error generating')
    } finally { setGenerating(false) }
  }

  async function handleApprove() {
    if (!selectedChar || approving) return
    setApproving(true); setError(null)
    try {
      await approveCharacterRender(project.id, selectedChar)
      await loadStatus()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Error approving')
    } finally { setApproving(false) }
  }

  async function handleApproveNode() {
    setApprovingNode(true); setError(null)
    try {
      await approveCharatersNode(project.id)
      onNodeApproved()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Error approving node')
    } finally { setApprovingNode(false) }
  }

  const nodeApproved = !!((project.concept?.pipeline?.charaters as Record<string, unknown> | undefined)?.approved)
  const allApproved  = chars.length > 0 && chars.every(c => c.status === 'approved')
  const charByKey    = Object.fromEntries(chars.map(c => [c.character_key, c]))
  const selected     = selectedChar ? charByKey[selectedChar] : null
  const displayUrl   = freshUrl ?? selected?.current_version?.storage_url ?? null

  if (loading) return (
    <div style={{ padding: 24, color: 'var(--text-3)', fontFamily: 'var(--font-mono)', fontSize: 12 }}>Loading characters…</div>
  )

  if (!chars.length) return (
    <div style={{ padding: 24, color: 'var(--text-3)', fontFamily: 'var(--font-mono)', fontSize: 12 }}>
      No characters found in GDD. Generate the GDD first.
    </div>
  )

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>

      {error && (
        <div style={{ fontSize: 11, fontFamily: 'var(--font-mono)', color: 'var(--cat-output)', background: 'color-mix(in oklch, var(--cat-output) 10%, var(--bg-2))', padding: '8px 12px', borderRadius: 6 }}>{error}</div>
      )}

      {/* Character cards */}
      <Section title={`Characters (${chars.filter(c => c.status === 'approved').length}/${chars.length} approved)`}>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: 10 }}>
          {chars.map(c => {
            const statusColor = STATUS_COLOR[c.status] ?? STATUS_COLOR.empty
            return (
              <div
                key={c.character_key}
                onClick={() => selectChar(c.character_key)}
                style={{
                  background: selectedChar === c.character_key ? 'color-mix(in oklch, var(--cat-code) 10%, var(--bg-2))' : 'var(--bg-2)',
                  border: `1px solid ${selectedChar === c.character_key ? 'var(--cat-code)' : 'var(--line-2)'}`,
                  borderRadius: 8, padding: '12px 14px', cursor: 'pointer',
                  transition: 'all 100ms',
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
                  <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-0)' }}>{c.character_name}</span>
                  <span style={{
                    fontSize: 9, fontFamily: 'var(--font-mono)', padding: '2px 7px', borderRadius: 99,
                    background: `color-mix(in oklch, ${statusColor} 12%, var(--bg-1))`,
                    border: `1px solid color-mix(in oklch, ${statusColor} 30%, transparent)`,
                    color: statusColor,
                  }}>{c.status}</span>
                </div>
                <div style={{ fontSize: 10, fontFamily: 'var(--font-mono)', color: 'var(--text-3)' }}>
                  {c.total_versions} version{c.total_versions !== 1 ? 's' : ''}
                </div>
              </div>
            )
          })}
        </div>
      </Section>

      {/* Selected character panel */}
      {selected && (
        <Section title={`${selected.character_name} — render`}>
          <div style={{ fontSize: 10, fontFamily: 'var(--font-mono)', color: 'var(--text-3)', background: 'var(--bg-2)', borderRadius: 6, padding: '8px 10px', marginBottom: 12 }}>
            <strong style={{ color: 'var(--text-2)' }}>Sprite prompt:</strong>{' '}
            {selected.sprite_prompt || '—'}
          </div>

          {/* Reference images */}
          {refImages.length > 0 && (
            <div style={{ marginBottom: 16 }}>
              <div style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color: 'var(--text-3)', marginBottom: 8 }}>Reference images</div>
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                {refImages.map(img => (
                  <div key={img.id} style={{ position: 'relative', borderRadius: 6, overflow: 'hidden', border: '1px solid var(--line-2)', flexShrink: 0 }}>
                    <img src={img.image_url} alt="" style={{ width: 90, height: 90, display: 'block', objectFit: 'cover' }} />
                    <button
                      onClick={() => setZoomedUrl(img.image_url)}
                      style={{ position: 'absolute', bottom: 4, right: 4, width: 20, height: 20, borderRadius: 4, background: 'rgba(0,0,0,0.6)', border: 'none', display: 'grid', placeItems: 'center', cursor: 'pointer', color: '#fff', fontSize: 11, opacity: 0.7, transition: 'opacity 150ms' }}
                      onMouseEnter={e => (e.currentTarget.style.opacity = '1')}
                      onMouseLeave={e => (e.currentTarget.style.opacity = '0.7')}
                      title="Zoom"
                    >⊕</button>
                  </div>
                ))}
              </div>
            </div>
          )}


          <div style={{ display: 'flex', gap: 20, alignItems: 'flex-start' }}>
            {/* Render image */}
            <div style={{ flexShrink: 0 }}>
              {displayUrl ? (
                <div style={{ position: 'relative', borderRadius: 8, overflow: 'hidden', border: `2px solid ${selected.status === 'approved' ? 'var(--cat-code)' : 'var(--line-2)'}` }}>
                  <img src={displayUrl} alt={selected.character_name} style={{ width: 200, height: 200, display: 'block', objectFit: 'cover' }} />
                  <button
                    onClick={() => setZoomedUrl(displayUrl)}
                    style={{ position: 'absolute', bottom: 6, right: 6, width: 24, height: 24, borderRadius: 5, background: 'rgba(0,0,0,0.6)', border: 'none', display: 'grid', placeItems: 'center', cursor: 'pointer', color: '#fff', fontSize: 13, opacity: 0.7, transition: 'opacity 150ms' }}
                    onMouseEnter={e => (e.currentTarget.style.opacity = '1')}
                    onMouseLeave={e => (e.currentTarget.style.opacity = '0.7')}
                    title="Zoom"
                  >⊕</button>
                  {selected.status === 'approved' && (
                    <div style={{ position: 'absolute', top: 6, left: 6, width: 20, height: 20, borderRadius: '50%', background: 'var(--cat-code)', display: 'grid', placeItems: 'center', fontSize: 11, color: '#0a0a0c', fontWeight: 700 }}>✓</div>
                  )}
                </div>
              ) : (
                <div style={{ width: 200, height: 200, border: '2px dashed var(--line-2)', borderRadius: 8, display: 'grid', placeItems: 'center', color: 'var(--text-3)', fontSize: 11, fontFamily: 'var(--font-mono)' }}>
                  No render yet
                </div>
              )}
            </div>

            {/* Action controls */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              {nodeApproved ? (
                <div style={{ fontSize: 10, fontFamily: 'var(--font-mono)', color: 'var(--text-3)', background: 'var(--bg-2)', border: '1px solid var(--line-2)', borderRadius: 6, padding: '8px 12px' }}>
                  🔒 Node approved — regeneration locked
                </div>
              ) : (
                <button
                  onClick={handleGenerate}
                  disabled={generating}
                  style={{
                    padding: '8px 16px', borderRadius: 6, border: 'none', cursor: generating ? 'not-allowed' : 'pointer',
                    background: 'var(--cat-code)', color: '#0a0a0c',
                    fontSize: 11, fontFamily: 'var(--font-mono)', fontWeight: 700, opacity: generating ? 0.6 : 1,
                    display: 'flex', alignItems: 'center', gap: 6,
                  }}
                >
                  {generating
                    ? <><span style={{ display: 'inline-block', width: 10, height: 10, border: '2px solid currentColor', borderTopColor: 'transparent', borderRadius: '50%', animation: 'spin 0.7s linear infinite' }} />Generating…</>
                    : displayUrl ? '↺ Regenerate' : '▶ Generate'}
                </button>
              )}

              {displayUrl && selected.status !== 'approved' && !nodeApproved && (
                <button
                  onClick={handleApprove}
                  disabled={approving}
                  style={{
                    padding: '8px 16px', borderRadius: 6, border: '1px solid var(--cat-code)', cursor: approving ? 'not-allowed' : 'pointer',
                    background: 'transparent', color: 'var(--cat-code)',
                    fontSize: 11, fontFamily: 'var(--font-mono)', fontWeight: 600, opacity: approving ? 0.6 : 1,
                  }}
                >
                  {approving ? 'Approving…' : '✓ Approve character'}
                </button>
              )}

              {selected.status === 'approved' && (
                <div style={{ fontSize: 10, fontFamily: 'var(--font-mono)', color: 'var(--cat-code)' }}>✓ Character approved</div>
              )}

              {selected.total_versions > 0 && (
                <div style={{ fontSize: 10, fontFamily: 'var(--font-mono)', color: 'var(--text-3)' }}>
                  {selected.total_versions} version{selected.total_versions !== 1 ? 's' : ''} generated
                </div>
              )}
            </div>
          </div>
        </Section>
      )}

      {/* Approve full node */}
      {allApproved && (
        <div style={{ borderTop: '1px solid var(--line-2)', paddingTop: 16, display: 'flex', alignItems: 'center', gap: 12 }}>
          <span style={{ fontSize: 11, fontFamily: 'var(--font-mono)', color: 'var(--cat-code)' }}>
            All characters approved
          </span>
          <button
            onClick={handleApproveNode}
            disabled={approvingNode}
            style={{
              padding: '8px 20px', borderRadius: 6, border: 'none',
              cursor: approvingNode ? 'not-allowed' : 'pointer',
              background: 'var(--cat-code)', color: '#0a0a0c',
              fontSize: 12, fontFamily: 'var(--font-mono)', fontWeight: 700,
              opacity: approvingNode ? 0.6 : 1,
            }}
          >
            {approvingNode ? 'Approving…' : '✓ Approve Characters node'}
          </button>
        </div>
      )}

      <style>{`@keyframes spin { to { transform: rotate(360deg) } }`}</style>

      {/* Lightbox */}
      {zoomedUrl && (
        <div
          onClick={() => setZoomedUrl(null)}
          style={{ position: 'fixed', inset: 0, zIndex: 2000, background: 'rgba(0,0,0,0.88)', backdropFilter: 'blur(6px)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 32 }}
        >
          <button
            onClick={() => setZoomedUrl(null)}
            style={{ position: 'absolute', top: 20, right: 20, background: 'rgba(255,255,255,0.1)', border: '1px solid rgba(255,255,255,0.2)', borderRadius: 8, width: 36, height: 36, display: 'grid', placeItems: 'center', cursor: 'pointer', color: '#fff', fontSize: 18 }}
          >✕</button>
          <img
            src={zoomedUrl} alt="" onClick={e => e.stopPropagation()}
            style={{ maxWidth: '100%', maxHeight: '100%', objectFit: 'contain', borderRadius: 10, boxShadow: '0 24px 80px rgba(0,0,0,0.8)' }}
          />
        </div>
      )}
    </div>
  )
}

export function CharatersModal({ project, onClose, onApproved }: { project: Project; onClose: () => void; onApproved: () => void }) {
  useEffect(() => {
    function onKey(e: KeyboardEvent) { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  return (
    <div
      onClick={onClose}
      style={{ position: 'fixed', inset: 0, zIndex: 1000, background: 'rgba(0,0,0,0.72)', backdropFilter: 'blur(4px)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24 }}
    >
      <div
        onClick={e => e.stopPropagation()}
        style={{ width: '100%', maxWidth: 1000, maxHeight: '90vh', background: 'var(--bg-1)', border: '1px solid var(--line-2)', borderRadius: 12, display: 'flex', flexDirection: 'column', boxShadow: '0 32px 80px rgba(0,0,0,0.6)', overflow: 'hidden' }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '14px 20px', borderBottom: '1px solid var(--line)', flexShrink: 0 }}>
          <div style={{ flex: 1 }}>
            <div style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color: 'var(--text-3)', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 2 }}>
              Characters
            </div>
            <div style={{ fontSize: 15, fontWeight: 600, color: 'var(--text-0)' }}>Character Renders</div>
          </div>
          <div style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color: 'var(--text-3)' }}>{project.name}</div>
          <button
            onClick={onClose}
            style={{ background: 'var(--bg-3)', border: '1px solid var(--line-2)', borderRadius: 6, width: 28, height: 28, display: 'grid', placeItems: 'center', cursor: 'pointer', color: 'var(--text-2)', fontSize: 16, transition: 'all 100ms' }}
            onMouseEnter={e => { (e.currentTarget as HTMLButtonElement).style.background = 'var(--bg-4)'; (e.currentTarget as HTMLButtonElement).style.color = 'var(--text-0)' }}
            onMouseLeave={e => { (e.currentTarget as HTMLButtonElement).style.background = 'var(--bg-3)'; (e.currentTarget as HTMLButtonElement).style.color = 'var(--text-2)' }}
          >✕</button>
        </div>
        <div style={{ flex: 1, overflow: 'auto', padding: '20px 24px' }}>
          <CharatersDetail project={project} onNodeApproved={() => { onApproved(); onClose() }} />
        </div>
      </div>
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
  'image_reference': 'Image Reference',
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

export default function DetailModal({ stepKey, project, pendingData, onClose, nodeContext, onNodeApproved }: Props & { onNodeApproved?: () => void }) {
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
      case 'concept_art':      return <ConceptArtDetail project={project} pendingData={pendingData} />
      case 'image_reference':  return <ImageReferenceOutput project={project} />
      case 'charaters':        return <CharatersOutput project={project} />
      default:                 return <PipelineNodeDetail stepKey={contentKey} project={project} pendingData={pendingData} />
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
