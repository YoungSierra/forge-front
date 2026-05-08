'use client'

import { useState, useEffect, useCallback, useRef } from 'react'
import { createProject, validateIdea, generateGDD, approveStep1, searchMembers, addProjectMember } from '@/lib/api'
import type { GDD, Project, ValidationResult, Member, Discipline } from '@/lib/types'
import PipelineSuggestionModal from './PipelineSuggestionModal'
import GDD_PARAMS_RAW from '@/lib/gdd-params.json'
import GDD_RULES_RAW from '@/lib/gdd-param-rules.json'

// ─── Types ────────────────────────────────────────────────────────────────────

type GDDParam = {
  id: string; label: string; type: 'multiselect' | 'select' | 'text'
  default: string | string[]; promptKey: string; placeholder?: string
  options?: { value: string; label: string }[]
}
type ParamRule = {
  id: string; severity: 'high' | 'medium' | 'low'; message: string
  conditions: { param: string; values: string[] }[]
}
type Phase = 'name' | 'form' | 'validating' | 'generating' | 'review'
type StagedMember = { member: Member; discipline: Discipline; role: string }

const DISCIPLINES: Discipline[] = ['design', 'art', 'vfx', 'code', 'audio', 'infra']
const ROLES = ['reviewer', 'editor', 'lead']
const DISC_COLOR: Record<Discipline, string> = {
  design: 'var(--cat-design)', art: 'var(--cat-asset)', vfx: 'var(--cat-level)',
  code: 'var(--cat-code)', audio: 'var(--cat-audio)', infra: 'var(--cat-output)',
}

const GDD_PARAMS = GDD_PARAMS_RAW as GDDParam[]
const GDD_RULES  = GDD_RULES_RAW  as ParamRule[]

// ─── Helpers ──────────────────────────────────────────────────────────────────

function initParams(): Record<string, string | string[]> {
  return Object.fromEntries(GDD_PARAMS.map(p => [p.id, p.default]))
}

function buildParamPrompt(values: Record<string, string | string[]>): string {
  const lines: string[] = []
  for (const p of GDD_PARAMS) {
    const v = values[p.id]
    const str = Array.isArray(v) ? v.join(', ') : v
    if (str) lines.push(`${p.promptKey}: ${str}`)
  }
  return lines.join('\n')
}

function evalRules(values: Record<string, string | string[]>): ParamRule[] {
  return GDD_RULES.filter(rule =>
    rule.conditions.every(c => {
      const v = values[c.param]
      const arr = Array.isArray(v) ? v : [v]
      return c.values.some(cv => arr.includes(cv))
    })
  )
}

function conflictedParamIds(values: Record<string, string | string[]>): Set<string> {
  const ids = new Set<string>()
  evalRules(values).forEach(rule => rule.conditions.forEach(c => ids.add(c.param)))
  return ids
}

function saveGDDInput(projectId: string, data: { ideaPrompt: string; params: Record<string, string | string[]> }) {
  try { localStorage.setItem(`forge:gdd-input:${projectId}`, JSON.stringify(data)) } catch {}
}

// ─── Small UI components ──────────────────────────────────────────────────────

const INPUT: React.CSSProperties = {
  width: '100%', background: 'var(--bg-1)', border: '1px solid var(--line-2)',
  borderRadius: 6, padding: '8px 10px', fontSize: 12, color: 'var(--text-0)',
  outline: 'none', boxSizing: 'border-box', fontFamily: 'inherit',
}

function Field({ label, children }: { label: React.ReactNode; children: React.ReactNode }) {
  return (
    <div>
      <div style={{ fontSize: 10, fontFamily: 'var(--font-mono)', color: 'var(--text-3)', textTransform: 'uppercase', letterSpacing: '0.07em', marginBottom: 5 }}>{label}</div>
      {children}
    </div>
  )
}

function Btn({ label, onClick, accent, disabled, small }: { label: string; onClick: () => void; accent?: boolean; disabled?: boolean; small?: boolean }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      style={{
        padding: small ? '6px 14px' : '9px 18px', borderRadius: 6, border: 'none', cursor: disabled ? 'not-allowed' : 'pointer',
        background: accent ? 'var(--cat-code)' : 'var(--bg-3)',
        color: accent ? '#0a0a0c' : 'var(--text-0)',
        fontSize: 12, fontFamily: 'var(--font-mono)', fontWeight: 600, opacity: disabled ? 0.5 : 1,
        width: '100%',
      }}
    >{label}</button>
  )
}

function ChipGroup({ param, value, onChange }: { param: GDDParam; value: string[]; onChange: (v: string[]) => void }) {
  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5 }}>
      {(param.options ?? []).map(opt => {
        const active = value.includes(opt.value)
        return (
          <button key={opt.value} type="button"
            onClick={() => onChange(active ? value.filter(x => x !== opt.value) : [...value, opt.value])}
            style={{
              padding: '4px 9px', borderRadius: 4, fontSize: 11, cursor: 'pointer', transition: 'all 80ms',
              background: active ? 'color-mix(in oklch, var(--cat-design) 18%, var(--bg-2))' : 'var(--bg-3)',
              border: active ? '1px solid color-mix(in oklch, var(--cat-design) 55%, transparent)' : '1px solid var(--line-2)',
              color: active ? 'var(--cat-design)' : 'var(--text-2)',
            }}
          >{opt.label}</button>
        )
      })}
    </div>
  )
}

function ParamField({ param, value, onChange, conflicted }: {
  param: GDDParam; value: string | string[]
  onChange: (id: string, v: string | string[]) => void; conflicted?: boolean
}) {
  const borderStyle = conflicted ? { borderColor: 'color-mix(in oklch, var(--cat-output) 55%, transparent)' } : {}
  const labelEl = conflicted
    ? <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}>{param.label} <span style={{ color: 'var(--cat-output)', fontSize: 9 }}>⚠</span></span>
    : param.label
  if (param.type === 'multiselect') {
    return <Field label={labelEl}><ChipGroup param={param} value={value as string[]} onChange={v => onChange(param.id, v)} /></Field>
  }
  if (param.type === 'text') {
    return <Field label={labelEl}><input value={value as string} onChange={e => onChange(param.id, e.target.value)} placeholder={param.placeholder ?? ''} style={{ ...INPUT, ...borderStyle }} /></Field>
  }
  return (
    <Field label={labelEl}>
      <select value={value as string} onChange={e => onChange(param.id, e.target.value)} style={{ ...INPUT, cursor: 'pointer', ...borderStyle }}>
        {(param.options ?? []).map(opt => <option key={opt.value} value={opt.value}>{opt.label}</option>)}
      </select>
    </Field>
  )
}

function ConflictBanner({ values }: { values: Record<string, string | string[]> }) {
  const warnings = evalRules(values)
  const [open, setOpen] = useState(false)
  if (warnings.length === 0) return null
  const hasHigh = warnings.some(w => w.severity === 'high')
  const color = hasHigh ? 'var(--cat-output)' : 'var(--cat-gate)'
  return (
    <div style={{ borderRadius: 5, overflow: 'hidden', border: `1px solid color-mix(in oklch, ${color} 35%, transparent)` }}>
      <button type="button" onClick={() => setOpen(p => !p)} style={{ width: '100%', background: `color-mix(in oklch, ${color} 10%, var(--bg-2))`, border: 'none', cursor: 'pointer', padding: '7px 10px', display: 'flex', alignItems: 'center', gap: 7 }}>
        <span style={{ color, fontSize: 11 }}>⚠</span>
        <span style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color }}>{warnings.length} parameter conflict{warnings.length > 1 ? 's' : ''}</span>
        <span style={{ marginLeft: 'auto', fontFamily: 'var(--font-mono)', fontSize: 9, color: 'var(--text-3)' }}>{open ? '▲' : '▼'}</span>
      </button>
      {open && (
        <div style={{ padding: '8px 10px', display: 'flex', flexDirection: 'column', gap: 6, background: 'var(--bg-2)' }}>
          {warnings.map(w => (
            <div key={w.id} style={{ fontSize: 10, fontFamily: 'var(--font-mono)', color: 'var(--text-2)', lineHeight: 1.5 }}>
              <span style={{ color: w.severity === 'high' ? 'var(--cat-output)' : 'var(--cat-gate)', marginRight: 6 }}>
                {w.severity === 'high' ? '⚠' : '⚡'}
              </span>
              {w.message}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

function ValidationFeedback({ result }: { result: ValidationResult }) {
  return (
    <div style={{ background: 'color-mix(in oklch, var(--cat-output) 8%, var(--bg-2))', border: '1px solid color-mix(in oklch, var(--cat-output) 30%, transparent)', borderRadius: 6, padding: '10px 12px' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
        <span style={{ fontSize: 11, fontFamily: 'var(--font-mono)', color: 'var(--cat-output)', fontWeight: 600 }}>Score {result.coherence_score}/100</span>
        <span style={{ fontSize: 10, fontFamily: 'var(--font-mono)', color: 'var(--text-3)' }}>below threshold (60)</span>
      </div>
      {result.issues?.length > 0 && (
        <ul style={{ margin: 0, paddingLeft: 14, display: 'flex', flexDirection: 'column', gap: 3 }}>
          {result.issues.map((issue, i) => (
            <li key={i} style={{ fontSize: 11, color: 'var(--text-2)', lineHeight: 1.5 }}>
              {typeof issue === 'string' ? issue : issue.description}
            </li>
          ))}
        </ul>
      )}
      {result.suggestions?.length > 0 && (
        <div style={{ marginTop: 8, fontSize: 10, fontFamily: 'var(--font-mono)', color: 'var(--cat-audio)' }}>
          Suggestions: {result.suggestions.join(' · ')}
        </div>
      )}
    </div>
  )
}

function Spinner({ label }: { label: string }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 16, padding: '48px 0' }}>
      <div style={{
        width: 32, height: 32,
        background: 'conic-gradient(from 45deg, var(--cat-asset), var(--cat-code), var(--cat-audio), var(--cat-gate), var(--cat-asset))',
        clipPath: 'polygon(50% 0,100% 50%,50% 100%,0 50%)',
        animation: 'modal-spin 1.2s linear infinite',
      }} />
      <style>{`@keyframes modal-spin { to { transform: rotate(360deg); } }`}</style>
      <div style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--text-3)', textAlign: 'center', lineHeight: 1.7 }}>{label}</div>
    </div>
  )
}

function GenCheckItem({ label, status, detail }: { label: string; status: 'running' | 'done'; detail?: string }) {
  const running = status === 'running'
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 10, animation: running ? 'item-pulse 1.6s ease-in-out infinite' : 'none' }}>
      <style>{`@keyframes item-pulse { 0%,100%{opacity:1} 50%{opacity:0.45} }`}</style>
      <div style={{ width: 18, height: 18, flexShrink: 0, display: 'grid', placeItems: 'center' }}>
        {running
          ? <div style={{
              width: 10, height: 10, borderRadius: '50%',
              background: 'var(--cat-design)',
              animation: 'dot-ping 1.6s ease-in-out infinite',
            }} />
          : <span style={{ color: 'var(--cat-code)', fontSize: 13, fontWeight: 700 }}>✓</span>
        }
      </div>
      <style>{`@keyframes dot-ping { 0%,100%{transform:scale(1);opacity:1} 50%{transform:scale(1.5);opacity:0.5} }`}</style>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
        <span style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: running ? 'var(--cat-design)' : 'var(--text-3)' }}>
          {label}
        </span>
        {detail && (
          <span style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color: 'var(--cat-code)' }}>{detail}</span>
        )}
      </div>
    </div>
  )
}

// ─── Main component ───────────────────────────────────────────────────────────

export interface NewProjectModalProps {
  open: boolean
  /** If provided, skips Step 1 (regeneration mode — project already exists) */
  projectId?: string | null
  projectName?: string
  initialIdea?: string
  initialParams?: Record<string, string | string[]>
  memberId?: string | null
  onProjectCreated: (project: Project) => void
  onClose: () => void
}

export default function NewProjectModal({
  open, projectId, projectName, initialIdea, initialParams,
  memberId, onProjectCreated, onClose,
}: NewProjectModalProps) {
  const isRegenMode = !!projectId

  const [phase, setPhase]                 = useState<Phase>(isRegenMode ? 'form' : 'name')
  const [draftProjectId, setDraftProjectId] = useState<string | null>(projectId ?? null)

  // Step 1
  const [nameInput, setNameInput]   = useState('')
  const [nameLoading, setNameLoading] = useState(false)
  const [nameError, setNameError]   = useState('')
  const [stagedMembers, setStagedMembers] = useState<StagedMember[]>([])
  const [memberSearch, setMemberSearch]   = useState('')
  const [memberResults, setMemberResults] = useState<Member[]>([])
  const [memberSearching, setMemberSearching] = useState(false)
  const [selectedMember, setSelectedMember]   = useState<Member | null>(null)
  const [memberDisc, setMemberDisc]   = useState<Discipline>('design')
  const [memberRole, setMemberRole]   = useState('reviewer')
  const searchTimeout = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Step 2
  const [ideaPrompt, setIdeaPrompt]             = useState(initialIdea ?? '')
  const [params, setParams]                     = useState<Record<string, string | string[]>>(initialParams ?? initParams())
  const [showParams, setShowParams]             = useState(true)
  const [validation, setValidation]             = useState<ValidationResult | null>(null)
  const [validationFailure, setValidationFailure] = useState<ValidationResult | null>(null)
  const [gdd, setGdd]                           = useState<GDD | null>(null)
  const [meta, setMeta]                         = useState<unknown>(null)
  const [error, setError]                       = useState<string | null>(null)
  const [approving, setApproving]               = useState(false)
  const [pendingProject,         setPendingProject]         = useState<Project | null>(null)
  const [showPipelineSuggestion, setShowPipelineSuggestion] = useState(false)
  const [genStep, setGenStep]                   = useState<'gdd' | 'images' | 'done' | null>(null)
  const genStepTimer                            = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Reset on open
  useEffect(() => {
    if (!open) return
    setPhase(isRegenMode ? 'form' : 'name')
    setDraftProjectId(projectId ?? null)
    setNameInput(''); setNameError('')
    setStagedMembers([]); setMemberSearch(''); setMemberResults([]); setSelectedMember(null)
    setIdeaPrompt(initialIdea ?? '')
    setParams(initialParams ?? initParams())
    setValidation(null); setValidationFailure(null)
    setGdd(null); setMeta(null); setError(null); setApproving(false)
  }, [open]) // eslint-disable-line react-hooks/exhaustive-deps

  // Escape key
  const handleKey = useCallback((e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }, [onClose])
  useEffect(() => {
    if (!open) return
    window.addEventListener('keydown', handleKey)
    return () => window.removeEventListener('keydown', handleKey)
  }, [open, handleKey])

  useEffect(() => {
    if (!memberSearch.trim()) { setMemberResults([]); return }
    if (searchTimeout.current) clearTimeout(searchTimeout.current)
    searchTimeout.current = setTimeout(async () => {
      setMemberSearching(true)
      const results = await searchMembers(memberSearch)
      const existingIds = new Set(stagedMembers.map(s => s.member.id))
      setMemberResults(results.filter(r => !existingIds.has(r.id)))
      setMemberSearching(false)
    }, 300)
  }, [memberSearch, stagedMembers])

  function addStagedMember() {
    if (!selectedMember) return
    setStagedMembers(prev => [...prev, { member: selectedMember, discipline: memberDisc, role: memberRole }])
    setSelectedMember(null); setMemberSearch(''); setMemberResults([])
  }

  function setParam(id: string, v: string | string[]) { setParams(prev => ({ ...prev, [id]: v })) }

  function buildFullPrompt() {
    return [ideaPrompt.trim(), buildParamPrompt(params)].filter(Boolean).join('\n')
  }

  // ── Step 1: create project ──────────────────────────────────────────────────
  async function handleCreateProject() {
    if (!nameInput.trim()) return
    setNameLoading(true); setNameError('')
    try {
      const res = await createProject(nameInput.trim(), memberId ?? undefined)
      const pid = res.project_id
      setDraftProjectId(pid)
      await Promise.allSettled(
        stagedMembers.map(s => addProjectMember(pid, s.member.id, s.role, s.discipline))
      )
      setPhase('form')
    } catch (e) {
      setNameError(e instanceof Error ? e.message : 'Failed to create project')
    } finally { setNameLoading(false) }
  }

  // ── Step 2: generate ───────────────────────────────────────────────────────
  async function doGenerate(fullPrompt: string) {
    setPhase('generating'); setError(null); setGenStep('gdd')
    genStepTimer.current = setTimeout(() => setGenStep('images'), 46000)
    try {
      const res = await generateGDD(fullPrompt, draftProjectId ?? undefined)
      if (genStepTimer.current) clearTimeout(genStepTimer.current)
      setGenStep('done')
      setGdd(res.gdd); setMeta(res.meta)
      setPhase('review')
    } catch (e) {
      if (genStepTimer.current) clearTimeout(genStepTimer.current)
      setGenStep(null)
      setError(e instanceof Error ? e.message : 'Generation failed')
      setPhase('form')
    }
  }

  async function handleSubmit() {
    if (ideaPrompt.trim().length < 10) return
    setError(null); setValidationFailure(null); setPhase('validating')
    const fullPrompt = buildFullPrompt()
    try {
      const genre    = (params.genre          as string[]).join(', ') || undefined
      const tone     = (params.tone           as string[]).join(', ') || undefined
      const audience = (params.target_audience as string[]).join(', ') || undefined
      const v = await validateIdea({ prompt: fullPrompt, genre, tone, audience,
        scope:      params.scope      as string || undefined,
        engine:     params.engine     as string || undefined,
        references: params.inspiration as string || undefined,
      })
      setValidation(v)
      if (v.coherence_score >= 60) {
        await doGenerate(fullPrompt)
      } else {
        setPhase('form'); setValidationFailure(v)
      }
    } catch (e) {
      setPhase('form'); setError(e instanceof Error ? e.message : 'Validation failed — please retry')
    }
  }

  async function handleApprove() {
    if (!gdd || !draftProjectId) return
    setApproving(true); setError(null)
    const payload = { project_id: draftProjectId, gdd, prompt: buildFullPrompt(), meta, member_id: memberId ?? undefined }
    for (let attempt = 1; attempt <= 2; attempt++) {
      try {
        if (attempt > 1) await new Promise(r => setTimeout(r, 2000))
        const res = await approveStep1(payload)
        saveGDDInput(res.project_id, { ideaPrompt, params })
        if (isRegenMode) {
          // Regeneración del GDD: el concepto pudo cambiar, preguntar si ajustar pipeline
          setPendingProject(res.project)
          setShowPipelineSuggestion(true)
          setApproving(false)
        } else {
          // Proyecto nuevo: abrir canvas directamente sin interrupciones
          onProjectCreated(res.project)
        }
        return
      } catch (e) {
        if (attempt === 2) {
          setError(e instanceof Error ? e.message : 'Failed to approve project')
          setApproving(false)
        }
      }
    }
  }

  if (showPipelineSuggestion && pendingProject) {
    return (
      <PipelineSuggestionModal
        project={pendingProject}
        onConfirm={() => { setShowPipelineSuggestion(false); onProjectCreated(pendingProject) }}
        onSkip={()    => { setShowPipelineSuggestion(false); onProjectCreated(pendingProject) }}
      />
    )
  }

  if (!open) return null

  const conflicted = conflictedParamIds(params)

  // ── Overlay ────────────────────────────────────────────────────────────────
  return (
    <div
      style={{
        position: 'fixed', inset: 0, zIndex: 2000,
        background: 'rgba(0,0,0,0.75)', backdropFilter: 'blur(3px)',
        display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24,
      }}
      onClick={e => { if (e.target === e.currentTarget) onClose() }}
    >
      <div style={{
        background: 'var(--bg-1)', border: '1px solid var(--line-2)', borderRadius: 12,
        width: '100%', maxWidth: 600, maxHeight: '90vh', display: 'flex', flexDirection: 'column',
        overflow: 'hidden', boxShadow: '0 24px 80px rgba(0,0,0,0.6)',
      }}>

        {/* Header */}
        <div style={{ padding: '18px 24px 14px', borderBottom: '1px solid var(--line-2)', display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexShrink: 0 }}>
          <div>
            <div style={{ fontSize: 15, fontWeight: 700, color: 'var(--text-0)', letterSpacing: '-0.01em' }}>
              {isRegenMode ? 'Regenerate GDD' : phase === 'name' ? 'New project' : (nameInput || projectName || 'New project')}
            </div>
            {!isRegenMode && (
              <div style={{ display: 'flex', gap: 16, marginTop: 6 }}>
                {(['name', 'form'] as const).map((s, i) => {
                  const done = phase !== 'name' && s === 'name'
                  const active = phase === s || (s === 'form' && ['validating', 'generating', 'review'].includes(phase))
                  return (
                    <div key={s} style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
                      <div style={{ width: 16, height: 16, borderRadius: '50%', fontSize: 9, fontFamily: 'var(--font-mono)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 700, background: done ? 'var(--cat-code)' : active ? 'var(--cat-design)' : 'var(--bg-3)', color: done || active ? '#0a0a0c' : 'var(--text-3)' }}>
                        {done ? '✓' : i + 1}
                      </div>
                      <span style={{ fontSize: 10, fontFamily: 'var(--font-mono)', color: active ? 'var(--text-1)' : done ? 'var(--cat-code)' : 'var(--text-3)' }}>
                        {s === 'name' ? 'Project' : 'Blueprint'}
                      </span>
                    </div>
                  )
                })}
              </div>
            )}
          </div>
          <button onClick={onClose} style={{ background: 'none', border: 'none', color: 'var(--text-3)', cursor: 'pointer', fontSize: 20, padding: 0, lineHeight: 1 }}>×</button>
        </div>

        {/* Body */}
        <div style={{ flex: 1, overflowY: 'auto', padding: '20px 24px' }}>

          {/* ── Step 1: project name + members ── */}
          {phase === 'name' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
              <Field label="Project name">
                <input
                  autoFocus
                  value={nameInput}
                  onChange={e => setNameInput(e.target.value)}
                  onKeyDown={e => { if (e.key === 'Enter' && !nameLoading && nameInput.trim()) handleCreateProject() }}
                  placeholder="My Awesome Game"
                  style={INPUT}
                />
              </Field>

              {/* Members section */}
              <div style={{ borderTop: '1px solid var(--line-2)', paddingTop: 14, display: 'flex', flexDirection: 'column', gap: 10 }}>
                <div style={{ fontSize: 10, fontFamily: 'var(--font-mono)', color: 'var(--text-3)', textTransform: 'uppercase', letterSpacing: '0.07em' }}>Team members <span style={{ color: 'var(--text-4)', fontWeight: 400 }}>(optional)</span></div>

                {/* Staged list */}
                {stagedMembers.length > 0 && (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
                    {stagedMembers.map((s, i) => (
                      <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 10px', background: 'var(--bg-2)', borderRadius: 6, border: '1px solid var(--line-2)' }}>
                        <div style={{ width: 24, height: 24, borderRadius: '50%', background: 'var(--bg-4)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 10, fontWeight: 700, color: 'var(--text-2)', flexShrink: 0 }}>
                          {s.member.display_name.charAt(0).toUpperCase()}
                        </div>
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-0)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{s.member.display_name}</div>
                          <div style={{ display: 'flex', gap: 4, marginTop: 2 }}>
                            <span style={{ fontSize: 9, fontFamily: 'var(--font-mono)', color: DISC_COLOR[s.discipline], background: `color-mix(in srgb, ${DISC_COLOR[s.discipline]} 12%, transparent)`, padding: '1px 6px', borderRadius: 99 }}>{s.discipline}</span>
                            <span style={{ fontSize: 9, fontFamily: 'var(--font-mono)', color: 'var(--text-3)', background: 'var(--bg-3)', padding: '1px 6px', borderRadius: 99 }}>{s.role}</span>
                          </div>
                        </div>
                        <button type="button" onClick={() => setStagedMembers(prev => prev.filter((_, j) => j !== i))} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-3)', fontSize: 14, padding: 4, lineHeight: 1 }}>✕</button>
                      </div>
                    ))}
                  </div>
                )}

                {/* Search input */}
                <div style={{ position: 'relative' }}>
                  <input
                    value={memberSearch}
                    onChange={e => { setMemberSearch(e.target.value); setSelectedMember(null) }}
                    placeholder="Search by name…"
                    style={INPUT}
                  />
                  {memberSearching && (
                    <div style={{ position: 'absolute', right: 10, top: '50%', transform: 'translateY(-50%)', fontSize: 10, color: 'var(--text-3)', fontFamily: 'var(--font-mono)' }}>…</div>
                  )}
                  {memberResults.length > 0 && !selectedMember && (
                    <div style={{ position: 'absolute', top: '100%', left: 0, right: 0, background: 'var(--bg-2)', border: '1px solid var(--line-2)', borderRadius: 6, marginTop: 2, zIndex: 10, overflow: 'hidden' }}>
                      {memberResults.map(m => (
                        <div
                          key={m.id}
                          onClick={() => { setSelectedMember(m); setMemberSearch(m.display_name); setMemberResults([]) }}
                          style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 10px', cursor: 'pointer', fontSize: 12, color: 'var(--text-0)' }}
                          onMouseEnter={e => (e.currentTarget.style.background = 'var(--bg-3)')}
                          onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
                        >
                          <div style={{ width: 22, height: 22, borderRadius: '50%', background: 'var(--bg-4)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 9, fontWeight: 700, color: 'var(--text-2)' }}>
                            {m.display_name.charAt(0).toUpperCase()}
                          </div>
                          {m.display_name}
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                {/* Discipline + Role + Add */}
                <div style={{ display: 'flex', gap: 8 }}>
                  <select value={memberDisc} onChange={e => setMemberDisc(e.target.value as Discipline)} style={{ ...INPUT, flex: 1, cursor: 'pointer' }}>
                    {DISCIPLINES.map(d => <option key={d} value={d}>{d}</option>)}
                  </select>
                  <select value={memberRole} onChange={e => setMemberRole(e.target.value)} style={{ ...INPUT, flex: 1, cursor: 'pointer' }}>
                    {ROLES.map(r => <option key={r} value={r}>{r}</option>)}
                  </select>
                  <button
                    type="button"
                    onClick={addStagedMember}
                    disabled={!selectedMember}
                    style={{ padding: '8px 14px', borderRadius: 6, border: 'none', cursor: selectedMember ? 'pointer' : 'not-allowed', background: selectedMember ? 'var(--bg-3)' : 'var(--bg-2)', color: selectedMember ? 'var(--text-0)' : 'var(--text-4)', fontSize: 12, fontFamily: 'var(--font-mono)', fontWeight: 600, flexShrink: 0 }}
                  >+ Add</button>
                </div>
              </div>

              {nameError && <div style={{ fontSize: 11, fontFamily: 'var(--font-mono)', color: 'var(--cat-output)' }}>{nameError}</div>}
              <Btn
                label={nameLoading ? 'Creating…' : 'Create project →'}
                onClick={handleCreateProject}
                accent
                disabled={nameLoading || !nameInput.trim()}
              />
            </div>
          )}

          {/* ── Step 2 loading states ── */}
          {(phase === 'validating' || phase === 'generating') && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 16, padding: '24px 0' }}>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginBottom: 8 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                  <span style={{ fontSize: 22, animation: 'brain-pulse 1.4s ease-in-out infinite' }}>🧠</span>
                  <span style={{ fontSize: 15, fontWeight: 700, color: 'var(--text-0)', letterSpacing: '-0.01em' }}>
                    Forge AI is analyzing your game vision
                  </span>
                </div>
                <style>{`@keyframes brain-pulse { 0%,100%{opacity:1;transform:scale(1)} 50%{opacity:0.5;transform:scale(0.88)} }`}</style>
                <p style={{ fontSize: 11, fontFamily: 'var(--font-mono)', color: 'var(--text-3)', margin: 0, paddingLeft: 32 }}>
                  This may take a minute — images are being generated in parallel
                </p>
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10, paddingLeft: 4 }}>
              {/* Validating */}
              <GenCheckItem
                label="Validating idea…"
                status={phase === 'validating' ? 'running' : 'done'}
                detail={validation ? `Coherence ${validation.coherence_score}/100` : undefined}
              />
              {/* GDD text */}
              {phase === 'generating' && (
                <GenCheckItem
                  label="Generating GDD…"
                  status={genStep === 'gdd' ? 'running' : 'done'}
                />
              )}
              {/* Images */}
              {phase === 'generating' && (genStep === 'images' || genStep === 'done') && (
                <GenCheckItem
                  label="Generating images…"
                  status={genStep === 'images' ? 'running' : 'done'}
                />
              )}
              </div>
            </div>
          )}

          {/* ── Step 2: idea form ── */}
          {phase === 'form' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
              {validationFailure && <ValidationFeedback result={validationFailure} />}
              {error && (
                <div style={{ fontSize: 11, fontFamily: 'var(--font-mono)', color: 'var(--cat-output)', background: 'color-mix(in oklch, var(--cat-output) 8%, var(--bg-2))', border: '1px solid color-mix(in oklch, var(--cat-output) 25%, transparent)', borderRadius: 4, padding: '8px 10px', lineHeight: 1.5 }}>
                  {error}
                </div>
              )}
              <Field label="Describe your game">
                <textarea
                  autoFocus
                  value={ideaPrompt}
                  onChange={e => setIdeaPrompt(e.target.value)}
                  placeholder="e.g. A rogue-like dungeon crawler where you collect spells…"
                  rows={5}
                  style={{ ...INPUT, resize: 'vertical', lineHeight: 1.5, fontFamily: 'var(--font-sans)', fontSize: 12 }}
                />
              </Field>
              <button type="button" onClick={() => setShowParams(p => !p)} style={{ background: 'none', border: 'none', cursor: 'pointer', textAlign: 'left', padding: 0, fontFamily: 'var(--font-mono)', fontSize: 10, color: 'var(--text-3)', display: 'flex', alignItems: 'center', gap: 6 }}>
                {showParams ? '▲' : '▼'} Parameters
              </button>
              {showParams && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                  <ConflictBanner values={params} />
                  {GDD_PARAMS.map(param => (
                    <ParamField key={param.id} param={param} value={params[param.id]} onChange={setParam} conflicted={conflicted.has(param.id)} />
                  ))}
                </div>
              )}
              <Btn
                label={ideaPrompt.trim().length < 10 ? 'Min. 10 characters' : '▶ Validate & generate GDD'}
                onClick={handleSubmit}
                accent
                disabled={ideaPrompt.trim().length < 10}
              />
            </div>
          )}

          {/* ── Step 2: review ── */}
          {phase === 'review' && gdd && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
              <div style={{ background: 'var(--bg-2)', border: '1px solid var(--line-2)', borderRadius: 8, padding: '14px 16px', display: 'flex', flexDirection: 'column', gap: 10 }}>
                {/* Title + tags */}
                <div style={{ fontSize: 15, fontWeight: 700, color: 'var(--text-0)', letterSpacing: '-0.01em' }}>{gdd.project.name}</div>
                <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                  {gdd.project.genre && <span style={{ fontSize: 10, fontFamily: 'var(--font-mono)', padding: '2px 8px', borderRadius: 99, background: 'color-mix(in oklch, var(--cat-design) 12%, var(--bg-3))', border: '1px solid color-mix(in oklch, var(--cat-design) 25%, transparent)', color: 'var(--cat-design)' }}>{gdd.project.genre}</span>}
                  {gdd.project.tone && <span style={{ fontSize: 10, fontFamily: 'var(--font-mono)', padding: '2px 8px', borderRadius: 99, background: 'var(--bg-3)', border: '1px solid var(--line-2)', color: 'var(--text-2)' }}>{gdd.project.tone}</span>}
                  {(gdd.development?.suggested_engine || (params.engine as string)) && (
                    <span style={{ fontSize: 10, fontFamily: 'var(--font-mono)', padding: '2px 8px', borderRadius: 99, background: 'color-mix(in oklch, var(--cat-code) 10%, var(--bg-3))', border: '1px solid color-mix(in oklch, var(--cat-code) 25%, transparent)', color: 'var(--cat-code)' }}>
                      {gdd.development?.suggested_engine || (params.engine as string)}
                    </span>
                  )}
                </div>

                {/* Elevator pitch */}
                {gdd.project.elevator_pitch && (
                  <div style={{ fontSize: 12, color: 'var(--text-2)', lineHeight: 1.6 }}>{gdd.project.elevator_pitch}</div>
                )}

                {/* Core loop */}
                {gdd.project.core_loop && (
                  <div style={{ paddingTop: 8, borderTop: '1px solid var(--line-2)' }}>
                    <div style={{ fontSize: 9, fontFamily: 'var(--font-mono)', color: 'var(--text-3)', textTransform: 'uppercase', letterSpacing: '0.07em', marginBottom: 4 }}>Core loop</div>
                    <div style={{ fontSize: 11, color: 'var(--text-2)', lineHeight: 1.5 }}>{gdd.project.core_loop}</div>
                  </div>
                )}

                {/* Named lists */}
                {(() => {
                  const sections: { label: string; items: string[] }[] = []
                  if (gdd.mechanics?.length)   sections.push({ label: 'Mechanics',   items: gdd.mechanics.slice(0, 4).map((m: { name: string }) => m.name) })
                  if (gdd.characters?.length)  sections.push({ label: 'Characters',  items: gdd.characters.slice(0, 4).map((c: { name: string }) => c.name) })
                  if (gdd.levels?.length)      sections.push({ label: 'Levels',      items: gdd.levels.slice(0, 4).map((l: { name: string }) => l.name) })
                  if (gdd.art_direction?.style) sections.push({ label: 'Art style',  items: [gdd.art_direction.style] })
                  if (sections.length === 0) return null
                  return (
                    <div style={{ paddingTop: 8, borderTop: '1px solid var(--line-2)', display: 'flex', flexDirection: 'column', gap: 8 }}>
                      {sections.map(s => (
                        <div key={s.label}>
                          <div style={{ fontSize: 9, fontFamily: 'var(--font-mono)', color: 'var(--text-3)', textTransform: 'uppercase', letterSpacing: '0.07em', marginBottom: 3 }}>{s.label}</div>
                          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
                            {s.items.map(name => (
                              <span key={name} style={{ fontSize: 10, fontFamily: 'var(--font-mono)', padding: '2px 7px', borderRadius: 4, background: 'var(--bg-3)', border: '1px solid var(--line-2)', color: 'var(--text-1)' }}>{name}</span>
                            ))}
                          </div>
                        </div>
                      ))}
                    </div>
                  )
                })()}
              </div>
              {error && <div style={{ fontSize: 11, fontFamily: 'var(--font-mono)', color: 'var(--cat-output)' }}>{error}</div>}
              <Btn label={approving ? 'Saving…' : 'Save & open canvas →'} onClick={handleApprove} accent disabled={approving} />
              <div style={{ display: 'flex', gap: 8 }}>
                <Btn label="↺ Regenerate" onClick={() => doGenerate(buildFullPrompt())} disabled={approving} small />
                <Btn label="← Edit idea"  onClick={() => setPhase('form')} disabled={approving} small />
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
