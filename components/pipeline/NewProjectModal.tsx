'use client'

import { useState, useEffect, useCallback, useRef } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { createProject, validateIdea, ideaExpansion, directionLock, getProject, getIdeaCandidate, searchMembers, addProjectMember, generateIdeas, saveIdeaCandidate, updateProjectName } from '@/lib/api'
import type { IdeaCard } from '@/lib/api'
import type { Project, ValidationResult, Member, Discipline } from '@/lib/types'
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
type Phase = 'name' | 'form' | 'validating' | 'expanding' | 'directions' | 'locking' | 'locked'
type StagedMember = { member: Member; discipline: Discipline; role: string }

const DISCIPLINES: Discipline[] = ['design', 'art', 'vfx', 'code', 'audio', 'infra']
const ROLES = ['reviewer', 'editor', 'lead']
const DISC_COLOR: Record<Discipline, string> = {
  design: 'var(--cat-design)', art: 'var(--cat-asset)', vfx: 'var(--cat-level)',
  code: 'var(--cat-code)', audio: 'var(--cat-audio)', infra: 'var(--cat-output)',
}

const GDD_PARAMS = GDD_PARAMS_RAW as GDDParam[]
const GDD_RULES  = GDD_RULES_RAW  as ParamRule[]

// Grupos de fases para el indicador de pasos
const STEP_PHASES: { label: string; phases: Phase[] }[] = [
  { label: 'Project',   phases: ['name'] },
  { label: 'Idea',      phases: ['form', 'validating', 'expanding'] },
  { label: 'Direction', phases: ['directions', 'locking', 'locked'] },
]

// ─── Helpers ──────────────────────────────────────────────────────────────────

// Limpia artefactos del LLM: bloques <think> de razonamiento e instrucciones meta del prompt
function stripThink(text: string): string {
  return text
    .replace(/<think>[\s\S]*?<\/think>/gi, '')
    .replace(/stop here\.[\s\S]*$/i, '')
    .replace(/the next pipeline step[\s\S]*$/i, '')
    .trim()
}

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

// Extrae solo la parte del brief (antes de que aparezcan las direcciones)
function extractBrief(output: string): string {
  const match = output.search(/(?:##?\s*)?(?:DESIGN\s+)?DIRECTION\s+1/i)
  return match > 0 ? output.slice(0, match).trim() : ''
}

type ParsedDirection = { title: string; fantasy: string; differentiator: string }

// Extrae título, core fantasy y diferenciador de cada dirección del output de 00a
function parseDirections(output: string): ParsedDirection[] {
  const headerRegex = /(?:##?\s*)?(?:DESIGN\s+)?DIRECTION\s+(\d)[:\s–\-–—]+([^\n]+)/gi
  const matches: { index: number; num: number; title: string }[] = []
  let m
  while ((m = headerRegex.exec(output)) !== null) {
    const num = parseInt(m[1]) - 1
    if (num >= 0 && num <= 2)
      matches.push({ index: m.index, num, title: m[2].trim().replace(/\*+/g, '').replace(/`+/g, '').slice(0, 70) })
  }

  const dirs: ParsedDirection[] = []
  for (let i = 0; i < matches.length; i++) {
    const block = output.slice(matches[i].index, matches[i + 1]?.index ?? output.length)
    // El LLM puede formatear como "Core fantasy:" o "**Core fantasy:**" — acepta ambos
    const fantasy = block.match(/\*{0,2}core fantasy\*{0,2}:?\*{0,2}\s*([\s\S]+?)(?=\n\s*\n|\n\s*\*{0,2}(?:differentiator|main risk)\*{0,2}:|$)/i)?.[1]?.replace(/\*/g, '').trim() ?? ''
    const diff    = block.match(/\*{0,2}differentiator\*{0,2}:?\*{0,2}\s*([\s\S]+?)(?=\n\s*\n|\n\s*\*{0,2}main risk\*{0,2}:|$)/i)?.[1]?.replace(/\*/g, '').trim() ?? ''
    dirs[matches[i].num] = { title: matches[i].title, fantasy, differentiator: diff }
  }
  return dirs
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
        background: accent ? 'var(--action)' : 'var(--bg-3)',
        color: accent ? 'var(--action-fg)' : 'var(--text-0)',
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
  const borderStyle = conflicted ? { borderColor: 'color-mix(in oklch, var(--state-warning) 55%, transparent)' } : {}
  const labelEl = conflicted
    ? <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}>{param.label} <span style={{ color: 'var(--state-warning)', fontSize: 9 }}>⚠</span></span>
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
  const color = hasHigh ? 'var(--state-error)' : 'var(--state-warning)'
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
              <span style={{ color: w.severity === 'high' ? 'var(--state-error)' : 'var(--state-warning)', marginRight: 6 }}>
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
    <div style={{ background: 'color-mix(in oklch, var(--state-warning) 8%, var(--bg-2))', border: '1px solid color-mix(in oklch, var(--state-warning) 30%, transparent)', borderRadius: 6, padding: '10px 12px' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
        <span style={{ fontSize: 11, fontFamily: 'var(--font-mono)', color: 'var(--state-warning)', fontWeight: 600 }}>Score {result.coherence_score}/100</span>
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

function GenCheckItem({ label, status, detail }: { label: string; status: 'running' | 'done'; detail?: string }) {
  const running = status === 'running'
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 10, animation: running ? 'item-pulse 1.6s ease-in-out infinite' : 'none' }}>
      <style>{`@keyframes item-pulse { 0%,100%{opacity:1} 50%{opacity:0.45} }`}</style>
      <div style={{ width: 18, height: 18, flexShrink: 0, display: 'grid', placeItems: 'center' }}>
        {running
          ? <div style={{ width: 10, height: 10, borderRadius: '50%', background: 'var(--cat-design)', animation: 'dot-ping 1.6s ease-in-out infinite' }} />
          : <span style={{ color: 'var(--state-success)', fontSize: 13, fontWeight: 700 }}>✓</span>
        }
      </div>
      <style>{`@keyframes dot-ping { 0%,100%{transform:scale(1);opacity:1} 50%{transform:scale(1.5);opacity:0.5} }`}</style>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
        <span style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: running ? 'var(--cat-design)' : 'var(--text-3)' }}>{label}</span>
        {detail && <span style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color: 'var(--state-success)' }}>{detail}</span>}
      </div>
    </div>
  )
}

// ─── Idea panel components ────────────────────────────────────────────────────

function IdeaCardComponent({ idea, onZoom, onUse, isSelected }: { idea: IdeaCard; onZoom: () => void; onUse: () => void; isSelected?: boolean }) {
  return (
    <div style={{
      borderRadius: 8,
      border: isSelected ? '2px solid var(--cat-design)' : '1px solid var(--line-2)',
      boxShadow: isSelected ? '0 0 0 3px color-mix(in oklch, var(--cat-design) 25%, transparent)' : 'none',
      overflow: 'hidden', background: 'var(--bg-2)', transition: 'border-color 150ms, box-shadow 150ms',
    }}>
      <div onClick={onZoom} style={{ width: '100%', aspectRatio: '16/9', overflow: 'hidden', position: 'relative', cursor: 'zoom-in', background: 'var(--bg-3)' }}>
        {idea.image_url
          ? <img src={idea.image_url} alt={idea.title} style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }} />
          : <div style={{ width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <span style={{ fontSize: 10, fontFamily: 'var(--font-mono)', color: 'var(--text-4)' }}>No image</span>
            </div>
        }
        <div style={{ position: 'absolute', top: 6, right: 6, fontSize: 9, fontFamily: 'var(--font-mono)', padding: '2px 6px', borderRadius: 99, background: 'rgba(0,0,0,0.55)', color: 'var(--text-2)' }}>{idea.genre}</div>
      </div>
      <div style={{ padding: '10px 12px', display: 'flex', flexDirection: 'column', gap: 6 }}>
        <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--text-0)', lineHeight: 1.3 }}>{idea.title}</div>
        <div style={{ fontSize: 10, color: 'var(--text-2)', lineHeight: 1.5, fontFamily: 'var(--font-sans)' }}>{idea.elevator_pitch}</div>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 3 }}>
          {idea.tags.slice(0, 5).map(tag => (
            <span key={tag} style={{ fontSize: 9, fontFamily: 'var(--font-mono)', padding: '1px 6px', borderRadius: 99, background: 'var(--bg-3)', border: '1px solid var(--line-2)', color: 'var(--text-3)' }}>{tag}</span>
          ))}
        </div>
        <div style={{ display: 'flex', gap: 6, marginTop: 2 }}>
          <button onClick={onZoom} style={{ flex: 1, padding: '5px', borderRadius: 5, fontSize: 10, fontFamily: 'var(--font-mono)', border: '1px solid var(--line-2)', background: 'var(--bg-3)', color: 'var(--text-2)', cursor: 'pointer' }}>Details ↗</button>
          <button onClick={onUse} style={{ flex: 2, padding: '5px', borderRadius: 5, fontSize: 10, fontFamily: 'var(--font-mono)', fontWeight: 600, border: 'none', background: 'var(--cat-design)', color: '#000', cursor: 'pointer' }}>Use this idea →</button>
        </div>
      </div>
    </div>
  )
}

function IdeaZoomOverlay({ idea, onClose, onUse }: { idea: IdeaCard; onClose: () => void; onUse: () => void }) {
  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 3500, background: 'rgba(0,0,0,0.88)', backdropFilter: 'blur(8px)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 32 }}>
      <div onClick={e => e.stopPropagation()} style={{ maxWidth: 820, width: '100%', maxHeight: '88vh', overflowY: 'auto', background: 'var(--bg-1)', borderRadius: 12, border: '1px solid var(--line-2)', boxShadow: '0 32px 100px rgba(0,0,0,0.7)', display: 'flex', flexDirection: 'column' }}>
        {idea.image_url && <img src={idea.image_url} alt={idea.title} style={{ width: '100%', aspectRatio: '16/9', objectFit: 'cover', display: 'block', borderRadius: '12px 12px 0 0' }} />}
        <div style={{ padding: 24, display: 'flex', flexDirection: 'column', gap: 14 }}>
          <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12 }}>
            <div style={{ fontSize: 18, fontWeight: 700, color: 'var(--text-0)', lineHeight: 1.2 }}>{idea.title}</div>
            <button onClick={onClose} style={{ flexShrink: 0, background: 'none', border: 'none', color: 'var(--text-3)', cursor: 'pointer', fontSize: 20, lineHeight: 1, padding: 0 }}>×</button>
          </div>
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
            {[idea.genre, idea.tone].map(t => t && <span key={t} style={{ fontSize: 10, fontFamily: 'var(--font-mono)', padding: '2px 8px', borderRadius: 99, background: 'color-mix(in oklch, var(--cat-design) 12%, var(--bg-3))', border: '1px solid color-mix(in oklch, var(--cat-design) 25%, transparent)', color: 'var(--cat-design)' }}>{t}</span>)}
            {idea.tags.map(tag => <span key={tag} style={{ fontSize: 10, fontFamily: 'var(--font-mono)', padding: '2px 8px', borderRadius: 99, background: 'var(--bg-3)', border: '1px solid var(--line-2)', color: 'var(--text-3)' }}>{tag}</span>)}
          </div>
          <div style={{ fontSize: 13, color: 'var(--text-1)', lineHeight: 1.65 }}>{idea.elevator_pitch}</div>
          {[
            { label: 'Core mechanic', value: idea.core_mechanic },
            { label: 'Unique hook',   value: idea.unique_hook   },
            { label: 'Visual style',  value: idea.visual_style  },
          ].map(({ label, value }) => value && (
            <div key={label} style={{ paddingTop: 10, borderTop: '1px solid var(--line-2)' }}>
              <div style={{ fontSize: 9, fontFamily: 'var(--font-mono)', color: 'var(--text-3)', textTransform: 'uppercase', letterSpacing: '0.07em', marginBottom: 4 }}>{label}</div>
              <div style={{ fontSize: 12, color: 'var(--text-2)', lineHeight: 1.6 }}>{value}</div>
            </div>
          ))}
          <button onClick={onUse} style={{ marginTop: 6, padding: '10px', borderRadius: 7, fontSize: 12, fontFamily: 'var(--font-mono)', fontWeight: 600, border: 'none', background: 'var(--cat-design)', color: '#000', cursor: 'pointer' }}>
            ← Use this idea
          </button>
        </div>
      </div>
    </div>
  )
}

// ─── Main component ───────────────────────────────────────────────────────────

export interface NewProjectModalProps {
  open: boolean
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

  const [phase, setPhase]                   = useState<Phase>(isRegenMode ? 'form' : 'name')
  const [draftProjectId, setDraftProjectId] = useState<string | null>(projectId ?? null)

  // Step 1 — nombre + miembros
  const [nameInput, setNameInput]     = useState('')
  const [nameLoading, setNameLoading] = useState(false)
  const [nameError, setNameError]     = useState('')
  const [stagedMembers, setStagedMembers]     = useState<StagedMember[]>([])
  const [memberSearch, setMemberSearch]       = useState('')
  const [memberResults, setMemberResults]     = useState<Member[]>([])
  const [memberSearching, setMemberSearching] = useState(false)
  const [selectedMember, setSelectedMember]   = useState<Member | null>(null)
  const [memberDisc, setMemberDisc] = useState<Discipline>('design')
  const [memberRole, setMemberRole] = useState('reviewer')
  const searchTimeout = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Ideas panel
  const [ideas, setIdeas]               = useState<IdeaCard[]>([])
  const [ideaLoading, setIdeaLoading]   = useState(false)
  const [ideaError, setIdeaError]       = useState<string | null>(null)
  const [zoomIdea, setZoomIdea]         = useState<IdeaCard | null>(null)
  const [selectedIdeaTitle, setSelectedIdeaTitle] = useState<string | null>(null)
  const [ideaProgress, setIdeaProgress] = useState(0)
  const ideaProgressTimer               = useRef<ReturnType<typeof setInterval> | null>(null)

  // Step 2 — idea form
  const [ideaPrompt, setIdeaPrompt]       = useState(initialIdea ?? '')
  const [params, setParams]               = useState<Record<string, string | string[]>>(initialParams ?? initParams())
  const [showParams, setShowParams]       = useState(true)
  const [validation, setValidation]       = useState<ValidationResult | null>(null)
  const [validationFailure, setValidationFailure] = useState<ValidationResult | null>(null)
  const [error, setError]                 = useState<string | null>(null)

  // Stage 0 — output de 00a y 00b
  const [stage0aOutput, setStage0aOutput] = useState<string | null>(null)
  const [gameIdea, setGameIdea]           = useState<string | null>(null)
  const [openingCanvas, setOpeningCanvas] = useState(false)
  const [expandedDir, setExpandedDir]     = useState<1|2|3|null>(null)

  // Restaurar estado al abrir — si hay projectId carga desde DB para retomar en la fase correcta
  useEffect(() => {
    if (!open) return

    // Limpiar estado común en todos los casos
    setNameError(''); setError(null)
    setValidation(null); setValidationFailure(null)
    setIdeas([]); setIdeaLoading(false); setIdeaError(null); setZoomIdea(null)
    setOpeningCanvas(false)
    setStagedMembers([]); setMemberSearch(''); setMemberResults([]); setSelectedMember(null)

    if (!projectId) {
      // Proyecto nuevo — reset completo al estado inicial
      setPhase('name')
      setDraftProjectId(null)
      setNameInput('')
      setIdeaPrompt(initialIdea ?? '')
      setParams(initialParams ?? initParams())
      setStage0aOutput(null); setGameIdea(null); setSelectedIdeaTitle(null)
      return
    }

    // Proyecto existente — cargar estado guardado y restaurar fase
    setDraftProjectId(projectId)
    setPhase('form') // fase provisional mientras carga

    Promise.all([
      getProject(projectId),
      getIdeaCandidate(projectId).catch(() => null),
    ]).then(([project, candidate]) => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const pipeline = project.concept?.pipeline as Record<string, any> | undefined

      if (pipeline?.game_idea?.text) {
        // 00b completado → ir directo a locked
        setGameIdea(stripThink(pipeline.game_idea.text))
        setStage0aOutput(pipeline.idea_expansion?.output ? stripThink(pipeline.idea_expansion.output) : null)
        setNameInput(project.name)
        if (candidate) setSelectedIdeaTitle(candidate.title)
        setPhase('locked')
      } else if (pipeline?.idea_expansion?.output) {
        // 00a completado → ir a selección de dirección
        setStage0aOutput(stripThink(pipeline.idea_expansion.output))
        setNameInput(project.name)
        if (candidate) {
          setIdeaPrompt(buildIdeaPromptFromCard(candidate.idea_data))
          setSelectedIdeaTitle(candidate.title)
        } else {
          setIdeaPrompt(initialIdea ?? '')
          setSelectedIdeaTitle(null)
        }
        setGameIdea(null)
        setPhase('directions')
      } else if (candidate) {
        // Idea seleccionada pero sin expansión → form con idea pre-cargada
        setIdeaPrompt(buildIdeaPromptFromCard(candidate.idea_data))
        setSelectedIdeaTitle(candidate.title)
        setNameInput(project.name)
        setParams(initialParams ?? initParams())
        setStage0aOutput(null); setGameIdea(null)
        setPhase('form')
      } else {
        // Sin datos guardados → form vacío
        setIdeaPrompt(initialIdea ?? '')
        setParams(initialParams ?? initParams())
        setNameInput(project.name)
        setStage0aOutput(null); setGameIdea(null); setSelectedIdeaTitle(null)
        setPhase('form')
      }
    }).catch(() => {
      setIdeaPrompt(initialIdea ?? '')
      setParams(initialParams ?? initParams())
      setStage0aOutput(null); setGameIdea(null); setSelectedIdeaTitle(null)
      setPhase('form')
    })
  }, [open]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!open) return
    const handleKey = (_e: KeyboardEvent) => {}
    window.addEventListener('keydown', handleKey)
    return () => window.removeEventListener('keydown', handleKey)
  }, [open])

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

  // ── Idea generator ─────────────────────────────────────────────────────────

  async function handleGenerateIdeas(addMore = false) {
    if (ideaPrompt.trim().length < 10) return
    setIdeaLoading(true); setIdeaError(null)
    setIdeaProgress(0)
    if (ideaProgressTimer.current) clearInterval(ideaProgressTimer.current)
    ideaProgressTimer.current = setInterval(() => {
      setIdeaProgress(prev => {
        if (prev >= 90) return prev
        return Math.min(90, prev + Math.max(0.4, (90 - prev) * 0.035))
      })
    }, 400)
    try {
      const genre  = (params.genre  as string[]).join(', ') || undefined
      const tone   = (params.tone   as string[]).join(', ') || undefined
      const scope  = params.scope   as string || undefined
      const engine = params.engine  as string || undefined
      const result = await generateIdeas({
        prompt: ideaPrompt.trim(), genre, tone, scope, engine,
        count: addMore ? 1 : 3,
        exclude: addMore ? ideas.map(i => i.title) : [],
      })
      if (ideaProgressTimer.current) clearInterval(ideaProgressTimer.current)
      setIdeaProgress(100)
      setIdeas(prev => addMore ? [...prev, ...result.ideas] : result.ideas)
    } catch (e) {
      if (ideaProgressTimer.current) clearInterval(ideaProgressTimer.current)
      setIdeaProgress(0)
      setIdeaError(e instanceof Error ? e.message : 'Failed to generate ideas')
    } finally {
      setIdeaLoading(false)
      setTimeout(() => setIdeaProgress(0), 600)
    }
  }

  function buildIdeaPromptFromCard(idea: IdeaCard): string {
    return [
      idea.title, '',
      idea.elevator_pitch, '',
      `Genre: ${idea.genre}`,
      `Tone: ${idea.tone}`,
      idea.visual_style ? `Visual style: ${idea.visual_style}` : null,
      '',
      `Core mechanic: ${idea.core_mechanic}`,
      `Unique hook: ${idea.unique_hook}`,
      idea.tags?.length ? `Tags: ${idea.tags.join(', ')}` : null,
    ].filter((l): l is string => l !== null && l !== undefined).join('\n')
  }

  function handleUseIdea(idea: IdeaCard) {
    const originalDescription = ideaPrompt.trim()
    const lines = [
      idea.title, '',
      idea.elevator_pitch, '',
      `Genre: ${idea.genre}`,
      `Tone: ${idea.tone}`,
      idea.visual_style ? `Visual style: ${idea.visual_style}` : '',
      '',
      `Core mechanic: ${idea.core_mechanic}`,
      `Unique hook: ${idea.unique_hook}`,
      idea.tags?.length ? `Tags: ${idea.tags.join(', ')}` : '',
    ].filter(l => l !== undefined && l !== null)
    setIdeaPrompt(lines.join('\n'))
    setNameInput(idea.title)
    setSelectedIdeaTitle(idea.title)
    setZoomIdea(null)
    if (draftProjectId) {
      saveIdeaCandidate(draftProjectId, idea, originalDescription).catch(e =>
        console.warn('[gen-idea] Failed to save idea candidate:', e.message)
      )
      updateProjectName(draftProjectId, idea.title).catch(e =>
        console.warn('[gen-idea] Failed to update project name:', e.message)
      )
    }
  }

  // ── Step 1: crear proyecto ─────────────────────────────────────────────────

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

  // ── Step 2: validate + expand (00a) ────────────────────────────────────────

  async function handleSubmit() {
    if (ideaPrompt.trim().length < 10) return
    setError(null); setValidationFailure(null); setPhase('validating')
    const fullPrompt = buildFullPrompt()
    try {
      const genre    = (params.genre          as string[]).join(', ') || undefined
      const tone     = (params.tone           as string[]).join(', ') || undefined
      const audience = (params.target_audience as string[]).join(', ') || undefined
      const v = await validateIdea({
        prompt: fullPrompt, genre, tone, audience,
        scope:      params.scope       as string || undefined,
        engine:     params.engine      as string || undefined,
        references: params.inspiration as string || undefined,
      })
      setValidation(v)
      if (v.coherence_score < 60) {
        setPhase('form'); setValidationFailure(v); return
      }
    } catch (e) {
      setPhase('form'); setError(e instanceof Error ? e.message : 'Validation failed — please retry'); return
    }
    await handleExpand()
  }

  async function handleExpand() {
    if (!draftProjectId) return
    setPhase('expanding'); setError(null)
    try {
      const genre  = (params.genre  as string[]).join(', ') || undefined
      const tone   = (params.tone   as string[]).join(', ') || undefined
      const scope  = params.scope   as string || undefined
      const engine = params.engine  as string || undefined
      const res = await ideaExpansion({
        project_id: draftProjectId,
        raw_idea:   ideaPrompt.trim(),
        genre, tone, scope, engine,
      })
      setStage0aOutput(stripThink(res.output))
      setPhase('directions')
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Idea expansion failed — please retry')
      setPhase('form')
    }
  }

  // ── Step 3: lock direction (00b) ───────────────────────────────────────────

  async function handleDirectionSelect(dir: 1 | 2 | 3) {
    if (!stage0aOutput || !draftProjectId) return
    setPhase('locking'); setError(null)
    try {
      const res = await directionLock({
        project_id:         draftProjectId,
        stage0a_output:     stage0aOutput,
        selected_direction: dir,
      })
      setGameIdea(res.game_idea)
      setPhase('locked')
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Direction lock failed — please retry')
      setPhase('directions')
    }
  }

  // ── Step 4: abrir canvas ───────────────────────────────────────────────────

  async function handleOpenCanvas() {
    if (!draftProjectId) return
    setOpeningCanvas(true); setError(null)
    try {
      const project = await getProject(draftProjectId)
      onProjectCreated(project)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load project')
      setOpeningCanvas(false)
    }
  }

  if (!open) return null

  const conflicted = conflictedParamIds(params)
  const showIdeas  = phase === 'form' && (ideas.length > 0 || ideaLoading)
  const parsedDirs = stage0aOutput ? parseDirections(stage0aOutput) : []

  // Ancho del modal según fase
  const modalMaxWidth = showIdeas ? 1100 : (phase === 'directions' ? 760 : 600)

  // Índice del step activo para el indicador del header
  const activeStepIdx = STEP_PHASES.findIndex(s => s.phases.includes(phase))

  return (
    <>
    {zoomIdea && (
      <IdeaZoomOverlay idea={zoomIdea} onClose={() => setZoomIdea(null)} onUse={() => handleUseIdea(zoomIdea)} />
    )}
    <div
      style={{ position: 'fixed', inset: 0, zIndex: 2000, background: 'rgba(0,0,0,0.75)', backdropFilter: 'blur(3px)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24 }}
      onClick={e => e.stopPropagation()}
    >
      <div style={{
        background: 'var(--bg-1)', border: '1px solid var(--line-2)', borderRadius: 12,
        width: '100%', maxWidth: modalMaxWidth, maxHeight: '90vh', display: 'flex', flexDirection: 'column',
        overflow: 'hidden', boxShadow: '0 24px 80px rgba(0,0,0,0.6)', transition: 'max-width 0.3s ease',
      }}>

        {/* Header */}
        <div style={{ padding: '18px 24px 14px', borderBottom: '1px solid var(--line-2)', display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexShrink: 0 }}>
          <div>
            <div style={{ fontSize: 15, fontWeight: 700, color: 'var(--text-0)', letterSpacing: '-0.01em' }}>
              {isRegenMode ? 'Regenerate concept' : phase === 'name' ? 'New project' : (nameInput || projectName || 'New project')}
            </div>
            {!isRegenMode && (
              <div style={{ display: 'flex', gap: 16, marginTop: 6 }}>
                {STEP_PHASES.map((step, i) => {
                  const done   = i < activeStepIdx
                  const active = i === activeStepIdx
                  return (
                    <div key={step.label} style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
                      <div style={{
                        width: 16, height: 16, borderRadius: '50%', fontSize: 9, fontFamily: 'var(--font-mono)',
                        display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 700,
                        background: done ? 'var(--state-success)' : active ? 'var(--action)' : 'var(--bg-3)',
                        color: done || active ? 'var(--action-fg)' : 'var(--text-3)',
                        opacity: done || active ? 1 : 0.45,
                      }}>
                        {done ? '✓' : i + 1}
                      </div>
                      <span style={{ fontSize: 10, fontFamily: 'var(--font-mono)', color: active ? 'var(--text-1)' : done ? 'var(--state-success)' : 'var(--text-3)', opacity: done || active ? 1 : 0.45 }}>
                        {step.label}
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
        <div style={{ flex: 1, overflow: 'hidden', display: 'flex' }}>
        <div style={{ flex: showIdeas ? '0 0 480px' : '1', overflowY: 'auto', padding: '20px 24px', borderRight: showIdeas ? '1px solid var(--line-2)' : 'none' }}>

          {/* ── Fase: name ── */}
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

              <div style={{ borderTop: '1px solid var(--line-2)', paddingTop: 14, display: 'flex', flexDirection: 'column', gap: 10 }}>
                <div style={{ fontSize: 10, fontFamily: 'var(--font-mono)', color: 'var(--text-3)', textTransform: 'uppercase', letterSpacing: '0.07em' }}>
                  Team members <span style={{ color: 'var(--text-4)', fontWeight: 400 }}>(optional)</span>
                </div>
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
                <div style={{ display: 'flex', gap: 8 }}>
                  <select value={memberDisc} onChange={e => setMemberDisc(e.target.value as Discipline)} style={{ ...INPUT, flex: 1, cursor: 'pointer' }}>
                    {DISCIPLINES.map(d => <option key={d} value={d}>{d}</option>)}
                  </select>
                  <select value={memberRole} onChange={e => setMemberRole(e.target.value)} style={{ ...INPUT, flex: 1, cursor: 'pointer' }}>
                    {ROLES.map(r => <option key={r} value={r}>{r}</option>)}
                  </select>
                  <button type="button" onClick={addStagedMember} disabled={!selectedMember}
                    style={{ padding: '8px 14px', borderRadius: 6, border: 'none', cursor: selectedMember ? 'pointer' : 'not-allowed', background: selectedMember ? 'var(--bg-3)' : 'var(--bg-2)', color: selectedMember ? 'var(--text-0)' : 'var(--text-4)', fontSize: 12, fontFamily: 'var(--font-mono)', fontWeight: 600, flexShrink: 0 }}
                  >+ Add</button>
                </div>
              </div>

              {nameError && <div style={{ fontSize: 11, fontFamily: 'var(--font-mono)', color: 'var(--state-error)' }}>{nameError}</div>}
              <Btn label={nameLoading ? 'Creating…' : 'Create project →'} onClick={handleCreateProject} accent disabled={nameLoading || !nameInput.trim()} />
            </div>
          )}

          {/* ── Fase: validating ── */}
          {phase === 'validating' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12, padding: '24px 0' }}>
              <GenCheckItem label="Validating idea coherence…" status="running" />
            </div>
          )}

          {/* ── Fase: expanding (00a) ── */}
          {phase === 'expanding' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12, padding: '24px 0' }}>
              <GenCheckItem label="Validation passed" status="done" detail={validation ? `Coherence ${validation.coherence_score}/100` : undefined} />
              <GenCheckItem label="Expanding your idea into 3 design directions…" status="running" />
            </div>
          )}

          {/* ── Fase: locking (00b) ── */}
          {phase === 'locking' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12, padding: '24px 0' }}>
              <GenCheckItem label="3 directions generated" status="done" />
              <GenCheckItem label="Locking selected direction…" status="running" />
            </div>
          )}

          {/* ── Fase: form ── */}
          {phase === 'form' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
              {selectedIdeaTitle && (
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 10px', background: 'color-mix(in oklch, var(--cat-audio) 8%, var(--bg-2))', border: '1px solid color-mix(in oklch, var(--cat-audio) 25%, transparent)', borderRadius: 6 }}>
                  <span style={{ fontSize: 10, color: 'var(--cat-audio)' }}>✦</span>
                  <span style={{ fontSize: 10, fontFamily: 'var(--font-mono)', color: 'var(--cat-audio)', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    Using: <strong>{selectedIdeaTitle}</strong>
                  </span>
                  <button type="button" onClick={() => { setSelectedIdeaTitle(null); setIdeaPrompt('') }} style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 10, fontFamily: 'var(--font-mono)', color: 'var(--text-3)', padding: 0 }}>
                    clear
                  </button>
                </div>
              )}
              {validationFailure && <ValidationFeedback result={validationFailure} />}
              {error && (
                <div style={{ fontSize: 11, fontFamily: 'var(--font-mono)', color: 'var(--state-error)', background: 'color-mix(in oklch, var(--state-error) 8%, var(--bg-2))', border: '1px solid color-mix(in oklch, var(--state-error) 25%, transparent)', borderRadius: 4, padding: '8px 10px', lineHeight: 1.5 }}>
                  {error}
                </div>
              )}
              <div>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 5 }}>
                  <div style={{ fontSize: 10, fontFamily: 'var(--font-mono)', color: 'var(--text-3)', textTransform: 'uppercase', letterSpacing: '0.07em' }}>Describe your game</div>
                  <button
                    type="button"
                    onClick={() => handleGenerateIdeas(false)}
                    disabled={ideaLoading || ideaPrompt.trim().length < 10}
                    style={{
                      padding: '3px 10px', borderRadius: 5,
                      border: '1px solid color-mix(in oklch, var(--cat-audio) 40%, transparent)',
                      background: ideaLoading || ideaPrompt.trim().length < 10 ? 'transparent' : 'color-mix(in oklch, var(--cat-audio) 10%, var(--bg-2))',
                      color: ideaLoading || ideaPrompt.trim().length < 10 ? 'var(--text-4)' : 'var(--cat-audio)',
                      fontSize: 10, fontFamily: 'var(--font-mono)', fontWeight: 600,
                      cursor: ideaLoading || ideaPrompt.trim().length < 10 ? 'not-allowed' : 'pointer',
                    }}
                  >
                    {ideaLoading && !ideas.length ? '⟳ …' : '✦ Generate ideas'}
                  </button>
                </div>
                <textarea
                  autoFocus
                  value={ideaPrompt}
                  onChange={e => setIdeaPrompt(e.target.value)}
                  placeholder="e.g. A rogue-like dungeon crawler where you collect spells…"
                  rows={5}
                  style={{ ...INPUT, resize: 'vertical', lineHeight: 1.5, fontFamily: 'var(--font-sans)', fontSize: 12 }}
                />
              </div>
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
              {ideaError && <div style={{ fontSize: 10, fontFamily: 'var(--font-mono)', color: 'var(--state-error)' }}>{ideaError}</div>}
              <Btn
                label={ideaPrompt.trim().length < 10 ? 'Min. 10 characters' : '▶ Validate & expand idea'}
                onClick={handleSubmit}
                accent
                disabled={ideaPrompt.trim().length < 10}
              />
            </div>
          )}

          {/* ── Fase: directions ── */}
          {phase === 'directions' && stage0aOutput && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
              {error && (
                <div style={{ fontSize: 11, fontFamily: 'var(--font-mono)', color: 'var(--state-error)', background: 'color-mix(in oklch, var(--state-error) 8%, var(--bg-2))', border: '1px solid color-mix(in oklch, var(--state-error) 25%, transparent)', borderRadius: 4, padding: '8px 10px' }}>
                  {error}
                </div>
              )}

              <div style={{ fontSize: 11, fontFamily: 'var(--font-mono)', color: 'var(--text-3)', display: 'flex', alignItems: 'center', gap: 6 }}>
                <span style={{ color: 'var(--state-success)', fontSize: 12 }}>✓</span>
                Idea expanded — choose a design direction to lock
              </div>

              {/* Brief del juego — todo excepto las 3 direcciones */}
              {extractBrief(stage0aOutput) && (
                <div style={{ background: 'var(--bg-2)', border: '1px solid var(--line-2)', borderRadius: 8, padding: '14px 16px', maxHeight: 220, overflowY: 'auto' }}>
                  <div className="raw-md" style={{ fontSize: 11, lineHeight: 1.7, color: 'var(--text-1)' }}>
                    <ReactMarkdown remarkPlugins={[remarkGfm]}>{extractBrief(stage0aOutput)}</ReactMarkdown>
                  </div>
                </div>
              )}

              {/* Tarjetas de dirección — accordion */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                <div style={{ fontSize: 10, fontFamily: 'var(--font-mono)', color: 'var(--text-3)', textTransform: 'uppercase', letterSpacing: '0.07em' }}>
                  Select direction
                </div>
                {([1, 2, 3] as const).map(dir => {
                  const d = parsedDirs[dir - 1]
                  const isOpen = expandedDir === dir
                  return (
                    <div key={dir} style={{ borderRadius: 8, border: `1px solid ${isOpen ? 'var(--action)' : 'var(--line-2)'}`, overflow: 'hidden', transition: 'border-color 120ms' }}>
                      {/* Header — siempre visible */}
                      <button
                        type="button"
                        onClick={() => setExpandedDir(isOpen ? null : dir)}
                        style={{
                          width: '100%', padding: '10px 14px', background: isOpen ? 'color-mix(in oklch, var(--action) 8%, var(--bg-2))' : 'var(--bg-2)',
                          border: 'none', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 10, textAlign: 'left',
                          transition: 'background 120ms',
                        }}
                      >
                        <span style={{ width: 22, height: 22, borderRadius: '50%', background: isOpen ? 'var(--action)' : 'var(--bg-4)', color: isOpen ? 'var(--action-fg)' : 'var(--text-2)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 10, fontFamily: 'var(--font-mono)', fontWeight: 700, flexShrink: 0, transition: 'background 120ms' }}>
                          {dir}
                        </span>
                        <span style={{ flex: 1, fontSize: 12, fontWeight: 600, fontFamily: 'var(--font-mono)', color: isOpen ? 'var(--text-0)' : 'var(--text-1)', textAlign: 'left' }}>
                          {d?.title || `Direction ${dir}`}
                        </span>
                        <span style={{ fontSize: 10, color: 'var(--text-4)', flexShrink: 0, transition: 'transform 120ms', transform: isOpen ? 'rotate(180deg)' : 'none' }}>▾</span>
                      </button>

                      {/* Contenido expandido */}
                      {isOpen && (
                        <div style={{ padding: '0 14px 14px', background: 'color-mix(in oklch, var(--action) 5%, var(--bg-2))', display: 'flex', flexDirection: 'column', gap: 10 }}>
                          {d?.fantasy && (
                            <div>
                              <div style={{ fontSize: 9, fontFamily: 'var(--font-mono)', color: 'var(--action)', textTransform: 'uppercase', letterSpacing: '0.07em', marginBottom: 3 }}>Core fantasy</div>
                              <p style={{ margin: 0, fontSize: 11, fontFamily: 'var(--font-sans)', color: 'var(--text-1)', lineHeight: 1.6 }}>{d.fantasy}</p>
                            </div>
                          )}
                          {d?.differentiator && (
                            <div>
                              <div style={{ fontSize: 9, fontFamily: 'var(--font-mono)', color: 'var(--text-3)', textTransform: 'uppercase', letterSpacing: '0.07em', marginBottom: 3 }}>Differentiator</div>
                              <p style={{ margin: 0, fontSize: 11, fontFamily: 'var(--font-sans)', color: 'var(--text-2)', lineHeight: 1.6 }}>{d.differentiator}</p>
                            </div>
                          )}
                          <button
                            type="button"
                            onClick={() => handleDirectionSelect(dir)}
                            style={{ alignSelf: 'flex-start', padding: '7px 16px', borderRadius: 6, border: 'none', background: 'var(--action)', color: 'var(--action-fg)', fontSize: 11, fontFamily: 'var(--font-mono)', fontWeight: 700, cursor: 'pointer' }}
                          >
                            Select direction {dir} →
                          </button>
                        </div>
                      )}
                    </div>
                  )
                })}
              </div>

              <button
                type="button"
                onClick={() => setPhase('form')}
                style={{ fontSize: 10, fontFamily: 'var(--font-mono)', color: 'var(--text-3)', background: 'none', border: 'none', cursor: 'pointer', padding: 0, textAlign: 'left' }}
              >
                ← Edit idea
              </button>
            </div>
          )}

          {/* ── Fase: locked ── */}
          {phase === 'locked' && gameIdea && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <span style={{ fontSize: 16, color: 'var(--state-success)' }}>✓</span>
                <span style={{ fontSize: 14, fontWeight: 700, color: 'var(--text-0)' }}>Game concept locked</span>
              </div>

              <div style={{ background: 'color-mix(in oklch, var(--state-success) 6%, var(--bg-2))', border: '1px solid color-mix(in oklch, var(--state-success) 25%, transparent)', borderRadius: 8, padding: '14px 16px', maxHeight: 320, overflowY: 'auto' }}>
                <pre style={{ margin: 0, fontSize: 11, lineHeight: 1.7, color: 'var(--text-1)', fontFamily: 'var(--font-mono)', whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
                  {gameIdea}
                </pre>
              </div>

              <div style={{ fontSize: 10, fontFamily: 'var(--font-mono)', color: 'var(--text-3)', lineHeight: 1.6 }}>
                This concept will guide all 12 GDD sections. Each section can be generated and approved individually in the canvas.
              </div>

              {error && (
                <div style={{ fontSize: 11, fontFamily: 'var(--font-mono)', color: 'var(--state-error)', background: 'color-mix(in oklch, var(--state-error) 8%, var(--bg-2))', border: '1px solid color-mix(in oklch, var(--state-error) 25%, transparent)', borderRadius: 4, padding: '8px 10px' }}>
                  {error}
                </div>
              )}

              <Btn
                label={openingCanvas ? 'Opening canvas…' : 'Open canvas →'}
                onClick={handleOpenCanvas}
                accent
                disabled={openingCanvas}
              />
              <button
                type="button"
                onClick={() => setPhase('directions')}
                style={{ fontSize: 10, fontFamily: 'var(--font-mono)', color: 'var(--text-3)', background: 'none', border: 'none', cursor: 'pointer', padding: 0, textAlign: 'left' }}
              >
                ← Back to directions
              </button>
            </div>
          )}

        </div>{/* end left column */}

        {/* ── Panel derecho: ideas ── */}
        {showIdeas && (
          <div style={{ flex: 1, overflowY: 'auto', padding: '20px 16px', display: 'flex', flexDirection: 'column', gap: 12, minWidth: 0 }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexShrink: 0 }}>
              <div style={{ fontSize: 10, fontFamily: 'var(--font-mono)', color: 'var(--text-3)', textTransform: 'uppercase', letterSpacing: '0.07em' }}>
                Ideas {ideas.length > 0 && `· ${ideas.length}`}
              </div>
              {ideas.length > 0 && !ideaLoading && (
                <button type="button" onClick={() => handleGenerateIdeas(true)} style={{ padding: '4px 10px', borderRadius: 5, fontSize: 10, fontFamily: 'var(--font-mono)', border: '1px solid var(--line-2)', background: 'var(--bg-2)', color: 'var(--text-2)', cursor: 'pointer' }}>
                  + One more
                </button>
              )}
            </div>

            {ideaLoading && ideas.length === 0 && (
              <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 16, padding: '40px 16px' }}>
                <div style={{ width: '100%', display: 'flex', flexDirection: 'column', gap: 8 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <span style={{ fontSize: 10, fontFamily: 'var(--font-mono)', color: 'var(--text-3)', animation: 'item-pulse 1.6s ease-in-out infinite' }}>
                      {ideaProgress < 40 ? 'Generating ideas…' : ideaProgress < 80 ? 'Generating images…' : 'Almost ready…'}
                    </span>
                    <span style={{ fontSize: 10, fontFamily: 'var(--font-mono)', color: 'var(--cat-audio)' }}>{Math.round(ideaProgress)}%</span>
                  </div>
                  <div style={{ width: '100%', height: 3, background: 'var(--bg-3)', borderRadius: 99, overflow: 'hidden' }}>
                    <div style={{ height: '100%', borderRadius: 99, background: 'linear-gradient(90deg, var(--cat-audio), var(--cat-design))', width: `${ideaProgress}%`, transition: 'width 0.4s ease' }} />
                  </div>
                </div>
              </div>
            )}

            {ideas.map((idea, i) => (
              <IdeaCardComponent
                key={i}
                idea={idea}
                onZoom={() => setZoomIdea(idea)}
                onUse={() => handleUseIdea(idea)}
                isSelected={selectedIdeaTitle === idea.title}
              />
            ))}

            {ideaLoading && ideas.length > 0 && (
              <div style={{ padding: '12px 14px', borderRadius: 8, border: '1px solid var(--line-2)', background: 'var(--bg-2)', display: 'flex', flexDirection: 'column', gap: 8 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                  <span style={{ fontSize: 10, fontFamily: 'var(--font-mono)', color: 'var(--text-3)', animation: 'item-pulse 1.6s ease-in-out infinite' }}>
                    {ideaProgress < 40 ? 'Generating idea…' : ideaProgress < 80 ? 'Generating image…' : 'Almost ready…'}
                  </span>
                  <span style={{ fontSize: 10, fontFamily: 'var(--font-mono)', color: 'var(--cat-audio)' }}>{Math.round(ideaProgress)}%</span>
                </div>
                <div style={{ width: '100%', height: 3, background: 'var(--bg-3)', borderRadius: 99, overflow: 'hidden' }}>
                  <div style={{ height: '100%', borderRadius: 99, background: 'linear-gradient(90deg, var(--cat-audio), var(--cat-design))', width: `${ideaProgress}%`, transition: 'width 0.4s ease' }} />
                </div>
              </div>
            )}
          </div>
        )}
        </div>{/* end body flex row */}
      </div>
    </div>
    </>
  )
}
