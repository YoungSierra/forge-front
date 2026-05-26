'use client'

import { useState, useEffect, useRef } from 'react'
import {
  generateConceptVariations,
  scoreRankConcepts,
  surfaceTopCandidates,
  generateCandidateImages,
  saveNodeDraft,
  saveChatHistory,
  approveNode,
  getProject,
} from '@/lib/api'
import type {
  IdeationVariation,
  IdeationScoredConcept,
  IdeationCandidate,
  PipelineNodeItem,
  ChatMessage,
} from '@/lib/api'
import type { Project } from '@/lib/types'
import type { PhaseNodeConfig } from '@/lib/api'
import NodeChatWindow from '@/components/shared/NodeChatWindow'

// ─── Constantes ───────────────────────────────────────────────────────────────

const GENRES = ['Action', 'RPG', 'Strategy', 'Puzzle', 'Horror', 'Adventure', 'Simulation', 'Platformer']
const COUNTS = [10, 20, 35, 50] as const

type RunPhase = 'idle' | 'running' | 'done' | 'error'

interface StepState {
  phase:  RunPhase
  detail: string
}

// ─── Animaciones ─────────────────────────────────────────────────────────────

const KEYFRAMES = `
  @keyframes item-pulse    { 0%,100%{opacity:1} 50%{opacity:.45} }
  @keyframes dot-ping      { 0%,100%{transform:scale(1);opacity:1} 50%{transform:scale(1.5);opacity:.5} }
  @keyframes shimmer-slide { 0%{background-position:-200px 0} 100%{background-position:calc(200px + 100%) 0} }
  @keyframes presence-ping { 0%,100%{opacity:1;transform:scale(1)} 50%{opacity:0.45;transform:scale(1.25)} }
  @keyframes fake-progress { 0%{width:0%} 15%{width:38%} 40%{width:62%} 70%{width:79%} 100%{width:89%} }
`

// ─── CandidateCard ────────────────────────────────────────────────────────────

interface CandidateCardProps {
  candidate:     IdeationCandidate
  index:         number
  expanded:      boolean
  imagesLoading: boolean
  onToggle:      () => void
  onZoom:        (url: string) => void
}

function CandidateCard({ candidate, index, expanded, imagesLoading, onToggle, onZoom }: CandidateCardProps) {
  const scoreColor = candidate.score >= 80 ? '#34D399' : candidate.score >= 65 ? '#FBBF24' : '#F87171'
  const hasImage   = !!candidate.image_url

  return (
    <div
      onClick={onToggle}
      data-candidate-id={candidate.id}
      style={{
        borderRadius: 10, border: '1px solid var(--line-2)',
        background: 'var(--bg-1)', overflow: 'hidden',
        cursor: 'pointer', transition: 'border-color 120ms, box-shadow 120ms',
      }}
      onMouseEnter={e => {
        e.currentTarget.style.borderColor = 'var(--action)'
        e.currentTarget.style.boxShadow   = '0 0 0 1px color-mix(in srgb,var(--action) 25%,transparent)'
      }}
      onMouseLeave={e => {
        e.currentTarget.style.borderColor = 'var(--line-2)'
        e.currentTarget.style.boxShadow   = 'none'
      }}
    >
      {/* Fila principal */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '12px 16px' }}>
        <div style={{ flexShrink: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 2 }}>
          <span style={{ fontSize: 9, fontFamily: 'var(--font-mono)', color: 'var(--text-4)' }}>#{index + 1}</span>
          <span style={{
            fontSize: 15, fontWeight: 800, fontFamily: 'var(--font-mono)', color: scoreColor,
            background: `color-mix(in srgb, ${scoreColor} 12%, var(--bg-2))`,
            padding: '2px 7px', borderRadius: 6,
          }}>
            {candidate.score}
          </span>
        </div>

        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-0)', lineHeight: 1.4, marginBottom: 4 }}>
            {candidate.concept}
          </div>
          <div style={{ fontSize: 11, color: 'var(--text-2)', lineHeight: 1.5 }}>
            {candidate.hook}
          </div>
        </div>

        {(hasImage || imagesLoading) && (
          <div
            onClick={hasImage ? e => { e.stopPropagation(); onZoom(candidate.image_url!) } : undefined}
            style={{
              width: 64, height: 48, borderRadius: 6, flexShrink: 0,
              overflow: 'hidden', border: '1px solid var(--line-2)',
              cursor: hasImage ? 'zoom-in' : 'default',
            }}
          >
            {hasImage ? (
              <img src={candidate.image_url!} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }} />
            ) : (
              <div style={{
                width: '100%', height: '100%',
                background: 'linear-gradient(90deg, var(--bg-2) 0px, var(--bg-3) 40px, var(--bg-2) 80px)',
                backgroundSize: '200px 100%',
                animation: 'shimmer-slide 1.5s infinite linear',
              }} />
            )}
          </div>
        )}

        <span style={{
          fontSize: 13, color: 'var(--text-3)', flexShrink: 0,
          transform: expanded ? 'rotate(90deg)' : 'none',
          transition: 'transform 200ms',
        }}>›</span>
      </div>

      {/* Detalle expandido */}
      {expanded && (
        <div style={{ borderTop: '1px solid var(--line-2)', padding: '14px 16px', display: 'flex', flexDirection: 'column', gap: 12 }}>
          {hasImage && (
            <div
              onClick={e => { e.stopPropagation(); onZoom(candidate.image_url!) }}
              style={{ borderRadius: 8, overflow: 'hidden', cursor: 'zoom-in', border: '1px solid var(--line-2)' }}
            >
              <img src={candidate.image_url!} alt="" style={{ width: '100%', maxHeight: 240, objectFit: 'cover', display: 'block' }} />
            </div>
          )}
          <div>
            <div style={{ fontSize: 9, fontFamily: 'var(--font-mono)', color: 'var(--text-3)', marginBottom: 4, textTransform: 'uppercase', letterSpacing: '0.08em' }}>
              Why it&apos;s worth developing
            </div>
            <div style={{ fontSize: 11, color: 'var(--text-1)', lineHeight: 1.6 }}>{candidate.rationale}</div>
          </div>
          <div>
            <div style={{ fontSize: 9, fontFamily: 'var(--font-mono)', color: 'var(--text-3)', marginBottom: 4, textTransform: 'uppercase', letterSpacing: '0.08em' }}>
              Target audience
            </div>
            <div style={{ fontSize: 11, color: 'var(--text-1)', lineHeight: 1.6 }}>{candidate.target_audience}</div>
          </div>
        </div>
      )}
    </div>
  )
}

// ─── ForgyBtn — botón de chat con punto de presencia pulsante ────────────────

function ForgyBtn({ onClick }: { onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      title="Ask Forge AI about this step"
      style={{
        width: 28, height: 28, borderRadius: '50%', flexShrink: 0,
        border: '1px solid rgba(255,138,61,0.25)',
        background: 'rgba(255,138,61,0.12)', cursor: 'pointer',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        padding: 0, animation: 'presence-ping 2s ease-in-out infinite',
      }}
      onMouseEnter={e => { e.currentTarget.style.animationPlayState = 'paused'; e.currentTarget.style.background = 'rgba(255,138,61,0.28)' }}
      onMouseLeave={e => { e.currentTarget.style.animationPlayState = 'running'; e.currentTarget.style.background = 'rgba(255,138,61,0.12)' }}
    >
      <img src="/forgy/forgyi.png" width={16} height={16} style={{ objectFit: 'contain', display: 'block' }} />
    </button>
  )
}

// ─── IdeaGeneratorModal ───────────────────────────────────────────────────────

export interface IdeaGeneratorModalProps {
  project:      Project
  nodes?:       PhaseNodeConfig[]
  label?:       string
  description?: string | null
  icon?:        string
  initialStep?: number
  layered?:     boolean   // true cuando se abre encima de otro modal (z-index mayor)
  onClose:      () => void
}

export default function IdeaGeneratorModal({ project, nodes = [], label = 'Idea Generation', description, icon = '⬡', initialStep, layered = false, onClose }: IdeaGeneratorModalProps) {
  const node1       = nodes.find(n => n.order_index === 1)
  const node2       = nodes.find(n => n.order_index === 2)
  const node3       = nodes.find(n => n.order_index === 3)
  const stepKey1    = node1?.step_key
  const stepKey2    = node2?.step_key
  const stepKey3    = node3?.step_key
  const modelName1  = node1?.model_name ?? null
  const modelName2  = node2?.model_name ?? null
  const modelName3  = node3?.model_name ?? null
  const nodeLabel1  = node1?.label ?? 'Step 1'
  const nodeLabel2  = node2?.label ?? 'Step 2'
  const nodeLabel3  = node3?.label ?? 'Step 3'

  // Formulario
  const [brief,  setBrief]  = useState('')
  const [genres, setGenres] = useState<string[]>([])
  const [count,  setCount]  = useState<10 | 20 | 35 | 50>(20)

  // Estado de ejecución
  const [step1, setStep1] = useState<StepState>({ phase: 'idle', detail: '' })
  const [step2, setStep2] = useState<StepState>({ phase: 'idle', detail: '' })
  const [step3, setStep3] = useState<StepState>({ phase: 'idle', detail: '' })
  const [step4, setStep4] = useState<StepState>({ phase: 'idle', detail: '' })
  const [globalError, setGlobalError] = useState<string | null>(null)

  // Resultados
  const [variations,     setVariations]     = useState<IdeationVariation[]>([])
  const [scored,         setScored]         = useState<IdeationScoredConcept[]>([])
  const [candidates,     setCandidates]     = useState<IdeationCandidate[]>([])
  // Snapshot completo para undo al presionar Regen en step 1
  const [prevVariations,  setPrevVariations]  = useState<IdeationVariation[]>([])
  const [prevApprovals,   setPrevApprovals]   = useState<[boolean, boolean, boolean] | null>(null)
  const [prevScored,      setPrevScored]      = useState<IdeationScoredConcept[]>([])
  const [prevCandidates,  setPrevCandidates]  = useState<IdeationCandidate[]>([])
  const [prevSteps,       setPrevSteps]       = useState<[StepState, StepState, StepState, StepState] | null>(null)

  // Aprobaciones locales (optimistas, sincronizadas con generation_jobs al abrir)
  const [step1Approved, setStep1Approved] = useState(false)
  const [step2Approved, setStep2Approved] = useState(false)
  const [step3Approved, setStep3Approved] = useState(false)

  // UI
  const [currentView,   setCurrentView]   = useState<'form' | 1 | 2 | 3>('form')
  const [chatStep,      setChatStep]      = useState<1 | 2 | 3 | null>(null)
  const [showAllVars,   setShowAllVars]   = useState(false)
  const [showAllScored, setShowAllScored] = useState(false)
  const [expandedId,    setExpandedId]    = useState<string | null>(null)
  const [zoomUrl,       setZoomUrl]       = useState<string | null>(null)

  // Historial de chat por step — se restaura desde concept.pipeline y se guarda en BD
  const [chatHistories, setChatHistories] = useState<Record<number, ChatMessage[]>>({})

  // Restaurar estado al montar — fetch directo para garantizar datos frescos
  useEffect(() => {
    type PipelineEntry = { items?: unknown[]; output?: string; chat_history?: ChatMessage[] }

    const applyRestore = (p: typeof project): boolean => {
      const pipeline = p.concept?.pipeline as Record<string, PipelineEntry> | undefined

      const key1 = stepKey1 || 'idtn_generate_concepts'
      const key2 = stepKey2 || 'idtn_score_rank'
      const key3 = stepKey3 || 'idtn_surface_candidates'

      const e1 = pipeline?.[key1]
      const e2 = pipeline?.[key2]
      const e3 = pipeline?.[key3]

      const jobs        = p.generation_jobs ?? []
      const s1approved  = jobs.some(j => j.current_step === key1 && j.status === 'approved')
      const s2approved  = jobs.some(j => j.current_step === key2 && j.status === 'approved')
      const s3approved  = jobs.some(j => j.current_step === key3 && j.status === 'approved')

      const hasItems1 = Array.isArray(e1?.items) && (e1!.items!.length > 0)
      const hasItems2 = Array.isArray(e2?.items) && (e2!.items!.length > 0)
      const hasItems3 = Array.isArray(e3?.items) && (e3!.items!.length > 0)
      const hasData   = hasItems1 || hasItems2 || hasItems3

      if (!hasData && !s1approved && !s2approved && !s3approved) return false

      if (hasItems1) {
        setVariations(e1!.items as IdeationVariation[])
        setStep1({ phase: 'done', detail: `${e1!.items!.length} concepts generated` })
        // el brief se guarda como output en save-draft
        if (e1!.output) setBrief(e1!.output)
        if (e1!.chat_history?.length) setChatHistories(prev => ({ ...prev, 1: e1!.chat_history! }))
      }

      if (hasItems2) {
        setScored(e2!.items as IdeationScoredConcept[])
        setStep2({ phase: 'done', detail: `${e2!.items!.length} concepts ranked` })
        if (e2!.chat_history?.length) setChatHistories(prev => ({ ...prev, 2: e2!.chat_history! }))
      }

      if (hasItems3) {
        const r = e3!.items as IdeationCandidate[]
        setCandidates(r)
        setStep3({ phase: 'done', detail: `Top ${r.length} ideas ready` })
        const n = r.filter((c: unknown) => (c as IdeationCandidate).image_url).length
        if (n > 0) setStep4({ phase: 'done', detail: `${n} reference images loaded` })
        if (e3!.chat_history?.length) setChatHistories(prev => ({ ...prev, 3: e3!.chat_history! }))
      }

      if (s1approved) setStep1Approved(true)
      if (s2approved) setStep2Approved(true)
      if (s3approved) setStep3Approved(true)

      // Navegar al step indicado; si no viene, al más avanzado
      if (initialStep === 1 || initialStep === 2 || initialStep === 3) {
        setCurrentView(initialStep)
      } else {
        if      (hasItems3) setCurrentView(3)
        else if (hasItems2) setCurrentView(2)
        else if (hasItems1) setCurrentView(1)
      }

      return true
    }

    // Aplica el prop inmediatamente para respuesta rápida
    const appliedFromProp = applyRestore(project)

    if (!appliedFromProp) {
      // Prop no tenía datos — fetch completo
      getProject(project.id).then(fresh => applyRestore(fresh)).catch(console.error)
    } else {
      // Prop tenía datos pero las aprobaciones pueden estar desactualizadas —
      // siempre confirmar desde backend sin tocar navegación ni resultados
      getProject(project.id).then(fresh => {
        const jobs = fresh.generation_jobs ?? []
        const key1 = stepKey1 || 'idtn_generate_concepts'
        const key2 = stepKey2 || 'idtn_score_rank'
        const key3 = stepKey3 || 'idtn_surface_candidates'
        if (jobs.some(j => j.current_step === key1 && j.status === 'approved')) setStep1Approved(true)
        if (jobs.some(j => j.current_step === key2 && j.status === 'approved')) setStep2Approved(true)
        if (jobs.some(j => j.current_step === key3 && j.status === 'approved')) setStep3Approved(true)
      }).catch(console.error)
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const isRunning     = [step1, step2, step3, step4].some(s => s.phase === 'running')
  const handleClose   = () => { flushChatSave(); onClose() }
  const imagesLoading = step4.phase === 'running'
  const topCount      = count === 10 ? 3 : count === 20 ? 5 : count === 35 ? 7 : 10

  // Persiste historial de chat en BD con debounce para no saturar requests
  const chatSaveTimer   = useRef<ReturnType<typeof setTimeout> | null>(null)
  const chatHistoriesRef = useRef(chatHistories)
  useEffect(() => { chatHistoriesRef.current = chatHistories }, [chatHistories])

  function flushChatSave() {
    if (chatSaveTimer.current) clearTimeout(chatSaveTimer.current)
    const h = chatHistoriesRef.current
    const saves: Array<[string, ChatMessage[]]> = [
      [stepKey1 || 'idtn_generate_concepts', h[1]],
      [stepKey2 || 'idtn_score_rank',         h[2]],
      [stepKey3 || 'idtn_surface_candidates', h[3]],
    ].filter(([, hist]) => hist?.length > 0) as Array<[string, ChatMessage[]]>
    saves.forEach(([key, history]) =>
      saveChatHistory(project.id, key, history).catch(console.error)
    )
  }

  useEffect(() => {
    if (Object.keys(chatHistories).length === 0) return
    if (chatSaveTimer.current) clearTimeout(chatSaveTimer.current)
    chatSaveTimer.current = setTimeout(flushChatSave, 1500)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chatHistories])

  // Cerrar con Escape (deshabilitado mientras corre)
  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape' && !isRunning) handleClose() }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [isRunning, onClose])

  // Auto-scroll al card expandido para que el contenido sea siempre visible
  const bodyRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!expandedId) return
    const el = bodyRef.current?.querySelector(`[data-candidate-id="${expandedId}"]`)
    if (el) el.scrollIntoView({ behavior: 'smooth', block: 'nearest' })
  }, [expandedId])

  // Formulario visible mientras step 1 no haya iniciado exitosamente
  const toggleGenre = (g: string) =>
    setGenres(prev => prev.includes(g) ? prev.filter(x => x !== g) : [...prev, g])

  // ── Funciones de ejecución ────────────────────────────────────────────────────

  async function runStep1() {
    if (!brief.trim()) return
    setGlobalError(null)
    setVariations([]); setScored([]); setCandidates([])
    setStep1({ phase: 'running', detail: '' })
    setStep2({ phase: 'idle', detail: '' })
    setStep3({ phase: 'idle', detail: '' })
    setStep4({ phase: 'idle', detail: '' })
    setStep1Approved(false); setStep2Approved(false); setStep3Approved(false)
    setExpandedId(null); setZoomUrl(null)
    setShowAllVars(false); setShowAllScored(false)
    setPrevVariations([])
    setCurrentView(1)
    try {
      const r1 = await generateConceptVariations(brief.trim(), genres, count, stepKey1)
      setVariations(r1.variations)
      setStep1({ phase: 'done', detail: `${r1.variations.length} concepts generated` })
      saveNodeDraft(project.id, stepKey1 || 'idtn_generate_concepts', brief.trim(), null, r1.variations as unknown as PipelineNodeItem[]).catch(console.error)
    } catch (err: unknown) {
      setGlobalError(err instanceof Error ? err.message : 'Unknown error')
      setStep1({ phase: 'error', detail: '' })
    }
  }

  async function runStep2(vars?: IdeationVariation[]) {
    const v = vars ?? variations
    setGlobalError(null)
    setScored([]); setCandidates([])
    setStep2({ phase: 'running', detail: '' })
    setStep3({ phase: 'idle', detail: '' })
    setStep4({ phase: 'idle', detail: '' })
    setStep2Approved(false); setStep3Approved(false)
    setShowAllScored(false)
    try {
      const r2 = await scoreRankConcepts(v, brief.trim(), genres, stepKey2)
      setScored(r2.scored)
      setStep2({ phase: 'done', detail: `${r2.scored.length} concepts ranked` })
      saveNodeDraft(project.id, stepKey2 || 'idtn_score_rank', '', null, r2.scored as unknown as PipelineNodeItem[]).catch(console.error)
    } catch (err: unknown) {
      setGlobalError(err instanceof Error ? err.message : 'Unknown error')
      setStep2({ phase: 'error', detail: '' })
    }
  }

  async function runStep3(sc?: IdeationScoredConcept[]) {
    const s = sc ?? scored
    setGlobalError(null)
    setCandidates([])
    setStep3({ phase: 'running', detail: '' })
    setStep4({ phase: 'idle', detail: '' })
    setStep3Approved(false)
    setExpandedId(null)
    try {
      const r3 = await surfaceTopCandidates(s, topCount, stepKey3)
      setCandidates(r3.candidates)
      setStep3({ phase: 'done', detail: `Top ${r3.candidates.length} ideas ready` })
      saveNodeDraft(project.id, stepKey3 || 'idtn_surface_candidates', '', null, r3.candidates as unknown as PipelineNodeItem[]).catch(console.error)
      // Imágenes de referencia en paralelo
      setStep4({ phase: 'running', detail: '' })
      try {
        const r4 = await generateCandidateImages(r3.candidates, project.id, stepKey3)
        const withImages = r3.candidates.map(c => ({
          ...c,
          image_url: r4.images.find(i => i.id === c.id)?.image_url ?? null,
        }))
        setCandidates(withImages)
        const n = r4.images.filter(i => i.image_url).length
        setStep4({ phase: 'done', detail: `${n} reference images ready` })
        saveNodeDraft(project.id, stepKey3 || 'idtn_surface_candidates', '', null, withImages as unknown as PipelineNodeItem[]).catch(console.error)
      } catch (imgErr) {
        console.error('[IdeaGeneratorModal] image generation failed:', imgErr)
        setStep4({ phase: 'error', detail: 'Image generation failed' })
      }
    } catch (err: unknown) {
      setGlobalError(err instanceof Error ? err.message : 'Unknown error')
      setStep3({ phase: 'error', detail: '' })
    }
  }

  // ── Funciones de aprobación (disparan el siguiente paso automáticamente) ─────

  async function approveStep1() {
    // Incluir items como doble seguro en caso que el backend no preserve el pipeline existente
    approveNode(project.id, stepKey1 || 'idtn_generate_concepts', {
      generated_at: new Date().toISOString(), items: variations, output: brief,
    }).catch(console.error)
    setStep1Approved(true)
    setCurrentView(2)
    await runStep2(variations)
  }

  async function approveStep2() {
    // Incluir items como doble seguro
    approveNode(project.id, stepKey2 || 'idtn_score_rank', {
      generated_at: new Date().toISOString(), items: scored,
    }).catch(console.error)
    setStep2Approved(true)
    setCurrentView(3)
    await runStep3(scored)
  }

  function approveStep3() {
    approveNode(project.id, stepKey3 || 'idtn_surface_candidates', {
      items: candidates, brief, generated_at: new Date().toISOString(),
    }).catch(console.error)
    setStep3Approved(true)
  }

  // Regen del paso 1: guarda snapshot completo para undo
  function regenStep1() {
    if (variations.length > 0) {
      setPrevVariations(variations)
      setPrevScored(scored)
      setPrevCandidates(candidates)
      setPrevApprovals([step1Approved, step2Approved, step3Approved])
      setPrevSteps([step1, step2, step3, step4])
    }
    setGlobalError(null)
    setStep1({ phase: 'idle', detail: '' })
    setStep2({ phase: 'idle', detail: '' })
    setStep3({ phase: 'idle', detail: '' })
    setStep4({ phase: 'idle', detail: '' })
    setVariations([]); setScored([]); setCandidates([])
    setStep1Approved(false); setStep2Approved(false); setStep3Approved(false)
    setShowAllVars(false); setShowAllScored(false)
    setCurrentView('form')
  }

  // Restaura el snapshot completo del paso 1
  function undoRegenStep1() {
    setVariations(prevVariations)
    setScored(prevScored)
    setCandidates(prevCandidates)
    if (prevApprovals) {
      setStep1Approved(prevApprovals[0])
      setStep2Approved(prevApprovals[1])
      setStep3Approved(prevApprovals[2])
    }
    if (prevSteps) {
      setStep1(prevSteps[0])
      setStep2(prevSteps[1])
      setStep3(prevSteps[2])
      setStep4(prevSteps[3])
    }
    setPrevVariations([])
    setPrevScored([])
    setPrevCandidates([])
    setPrevApprovals(null)
    setPrevSteps(null)
    setCurrentView(1)
  }

  // ── Estilos compartidos ───────────────────────────────────────────────────────

  const stepSectionStyle: React.CSSProperties = {
    background: 'var(--bg-1)', borderRadius: 10,
    border: '1px solid var(--line-2)', overflow: 'hidden',
  }

  const stepBadgeStyle: React.CSSProperties = {
    fontSize: 9, fontFamily: 'var(--font-mono)', color: 'var(--text-4)',
    background: 'var(--bg-3)', padding: '2px 7px', borderRadius: 4, flexShrink: 0,
  }

  const approvedBadgeStyle: React.CSSProperties = {
    fontSize: 10, fontFamily: 'var(--font-mono)', color: '#34D399',
    background: 'rgba(52,211,153,0.10)', border: '1px solid rgba(52,211,153,0.25)',
    padding: '2px 8px', borderRadius: 4,
  }

  const regenBtnStyle: React.CSSProperties = {
    padding: '6px 12px', borderRadius: 7, border: '1px solid var(--line-2)',
    background: 'var(--bg-2)', color: 'var(--text-1)',
    fontSize: 11, fontFamily: 'var(--font-mono)', cursor: 'pointer',
  }

  const approveBtnStyle = (disabled: boolean): React.CSSProperties => ({
    padding: '7px 18px', borderRadius: 7, border: 'none',
    background: disabled ? 'var(--bg-3)' : 'var(--action)',
    color: disabled ? 'var(--text-4)' : 'var(--action-fg)',
    fontSize: 12, fontFamily: 'var(--font-mono)', fontWeight: 700,
    cursor: disabled ? 'not-allowed' : 'pointer',
  })

  // Indicador de paso en ejecución (inline en el header de cada sección)
  function RunningDot() {
    return (
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, animation: 'item-pulse 1.6s ease-in-out infinite' }}>
        <div style={{ width: 8, height: 8, borderRadius: '50%', background: 'var(--cat-design)', animation: 'dot-ping 1.6s ease-in-out infinite' }} />
        <span style={{ fontSize: 10, fontFamily: 'var(--font-mono)', color: 'var(--cat-design)' }}>Running…</span>
      </div>
    )
  }

  // ── Render ────────────────────────────────────────────────────────────────────

  return (
    <>
      <style>{KEYFRAMES}</style>

      {/* Lightbox */}
      {zoomUrl && (
        <div
          onClick={() => setZoomUrl(null)}
          style={{
            position: 'fixed', inset: 0, zIndex: 200,
            background: 'rgba(0,0,0,0.88)', backdropFilter: 'blur(6px)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            cursor: 'zoom-out',
          }}
        >
          <img
            src={zoomUrl} alt=""
            onClick={e => e.stopPropagation()}
            style={{ maxWidth: 'calc(100vw - 64px)', maxHeight: 'calc(100vh - 64px)', borderRadius: 12, boxShadow: '0 32px 80px rgba(0,0,0,0.6)', cursor: 'default' }}
          />
          <button
            onClick={() => setZoomUrl(null)}
            style={{ position: 'fixed', top: 20, right: 20, border: 'none', background: 'rgba(255,255,255,0.12)', color: 'white', fontSize: 16, width: 36, height: 36, borderRadius: 8, cursor: 'pointer', display: 'grid', placeItems: 'center' }}
          >✕</button>
        </div>
      )}

      {/* Chat window — abre por paso */}
      {chatStep !== null && (
        <NodeChatWindow
          stepKey={
            chatStep === 1 ? (stepKey1 || 'idtn_generate_concepts') :
            chatStep === 2 ? (stepKey2 || 'idtn_score_rank') :
            (stepKey3 || 'idtn_surface_candidates')
          }
          stepLabel={
            chatStep === 1 ? nodeLabel1 :
            chatStep === 2 ? nodeLabel2 :
            nodeLabel3
          }
          currentOutput={
            chatStep === 1 ? variations :
            chatStep === 2 ? scored :
            candidates.map(({ id, concept, score, hook, rationale, target_audience }) =>
              ({ id, concept, score, hook, rationale, target_audience })
            )
          }
          project={project}
          locked={chatStep === 1 ? step1Approved : chatStep === 2 ? step2Approved : step3Approved}
          modelName={chatStep === 1 ? modelName1 : chatStep === 2 ? modelName2 : modelName3}
          initialMessages={chatHistories[chatStep!] ?? []}
          onMessagesChange={(msgs) => setChatHistories(prev => ({ ...prev, [chatStep!]: msgs }))}
          validateOutput={
            chatStep === 1 ? (data) => {
              if (!Array.isArray(data)) return 'Expected an array of concept variations — the assistant gave a conversational response, not a list.'
              if (data.length < Math.max(3, Math.floor(variations.length * 0.5)))
                return `Too few items (${data.length}). Expected at least ${Math.max(3, Math.floor(variations.length * 0.5))} concept variations.`
              if (!data[0]?.concept) return 'Items are missing the required "concept" field.'
              return null
            } :
            chatStep === 2 ? (data) => {
              if (!Array.isArray(data)) return 'Expected an array of scored concepts — the assistant gave a conversational response, not a list.'
              if (data.length < Math.max(3, Math.floor(scored.length * 0.5)))
                return `Too few items (${data.length}). Expected at least ${Math.max(3, Math.floor(scored.length * 0.5))} scored concepts.`
              if (data[0]?.total === undefined) return 'Items are missing the required "total" score field.'
              return null
            } :
            (data) => {
              if (!Array.isArray(data)) return 'Expected an array of candidates — the assistant gave a conversational response, not a list.'
              if (data.length < 1) return 'No candidates found in the output.'
              if (!data[0]?.hook) return 'Items are missing the required "hook" field.'
              return null
            }
          }
          onApply={
            chatStep === 1 ? (data) => {
              const v = data as IdeationVariation[]
              setVariations(v)
              setStep1({ phase: 'done', detail: `${v.length} concepts generated` })
              // Si el paso estaba aprobado, invalidar aprobación y pasos downstream
              if (step1Approved) {
                setStep1Approved(false); setStep2Approved(false); setStep3Approved(false)
                setScored([]); setCandidates([])
                setStep2({ phase: 'idle', detail: '' }); setStep3({ phase: 'idle', detail: '' })
              }
              saveNodeDraft(project.id, stepKey1 || 'idtn_generate_concepts', '', null, v as unknown as PipelineNodeItem[]).catch(console.error)
              flushChatSave(); setChatStep(null)
            } :
            chatStep === 2 ? (data) => {
              const s = data as IdeationScoredConcept[]
              setScored(s)
              setStep2({ phase: 'done', detail: `${s.length} concepts ranked` })
              // Si el paso estaba aprobado, invalidar aprobación y pasos downstream
              if (step2Approved) {
                setStep2Approved(false); setStep3Approved(false)
                setCandidates([])
                setStep3({ phase: 'idle', detail: '' })
              }
              saveNodeDraft(project.id, stepKey2 || 'idtn_score_rank', '', null, s as unknown as PipelineNodeItem[]).catch(console.error)
              flushChatSave(); setChatStep(null)
            } :
            (data) => {
              const c = data as IdeationCandidate[]
              setCandidates(c)
              setStep3({ phase: 'done', detail: `Top ${c.length} ideas ready` })
              // Si el paso estaba aprobado, invalidar aprobación
              if (step3Approved) setStep3Approved(false)
              saveNodeDraft(project.id, stepKey3 || 'idtn_surface_candidates', '', null, c as unknown as PipelineNodeItem[]).catch(console.error)
              flushChatSave(); setChatStep(null)
            }
          }
          onClose={() => { flushChatSave(); setChatStep(null) }}
        />
      )}

      {/* Overlay — sin onClick, solo se cierra con X o Esc */}
      <div style={{ position: 'fixed', inset: 0, zIndex: layered ? 85 : 60, background: 'rgba(0,0,0,0.72)', backdropFilter: 'blur(4px)' }} />

      {/* Modal */}
      <div className="modal-card" style={{
        position: 'fixed', top: '50%', left: '50%', transform: 'translate(-50%,-50%)',
        zIndex: layered ? 90 : 70, width: 680, maxWidth: 'calc(100vw - 32px)',
        maxHeight: 'calc(100vh - 48px)',
        borderRadius: 8,
        boxShadow: '0 18px 42px rgba(0,0,0,0.6), 0 0 0 1px var(--line-2)',
        display: 'flex', flexDirection: 'column', overflow: 'hidden',
        fontFamily: 'var(--font-sans)',
      }}>

        {/* Header */}
        {(() => {
          const activeNode =
            currentView === 1 ? node1 :
            currentView === 2 ? node2 :
            currentView === 3 ? node3 :
            null
          const headerLabel = activeNode?.label ?? label
          const headerDesc  = activeNode?.description ?? description ?? null
          return (
            <div style={{ padding: '18px 24px 16px', borderBottom: '1px solid var(--modal-border)', display: 'flex', alignItems: 'center', gap: 14, flexShrink: 0 }}>
              <div style={{ width: 36, height: 36, borderRadius: 8, flexShrink: 0, background: 'var(--bg-3)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 20 }}>
                {icon}
              </div>
              <div style={{ flex: 1, minWidth: 0 }}>
                {activeNode && (
                  <div style={{ fontSize: 10, fontFamily: 'var(--font-mono)', color: 'var(--text-4)', marginBottom: 2 }}>
                    {label}
                  </div>
                )}
                <div style={{ fontSize: 15, fontWeight: 700, color: 'var(--text-0)', lineHeight: 1.2, marginBottom: headerDesc ? 3 : 0 }}>
                  {headerLabel}
                </div>
                {headerDesc && (
                  <div style={{ fontSize: 12, color: 'var(--text-3)', lineHeight: 1.5 }}>
                    {headerDesc}
                  </div>
                )}
              </div>
              <button
                onClick={isRunning ? undefined : handleClose}
                disabled={isRunning}
                style={{ border: 'none', background: 'var(--bg-3)', cursor: isRunning ? 'not-allowed' : 'pointer', color: 'var(--text-2)', fontSize: 14, padding: '5px 9px', borderRadius: 6, flexShrink: 0, opacity: isRunning ? 0.4 : 1 }}
              >
                ✕
              </button>
            </div>
          )
        })()}

        {/* Body scroll */}
        <div ref={bodyRef} style={{ flex: 1, minHeight: 0, overflowY: 'auto', padding: '20px 24px', display: 'flex', flexDirection: 'column', gap: 16 }}>

          {/* Error global */}
          {globalError && (
            <div style={{ background: 'rgba(248,113,113,0.08)', border: '1px solid rgba(248,113,113,0.3)', borderRadius: 8, padding: '10px 14px', fontSize: 11, color: '#F87171', lineHeight: 1.5 }}>
              {globalError}
            </div>
          )}

          {/* Formulario — visible en 'form' o cuando step 1 está idle/error */}
          {(currentView === 'form' || (currentView === 1 && (step1.phase === 'idle' || step1.phase === 'error'))) && (
            <>
              {/* Undo regen — aparece solo si hay un snapshot previo */}
              {prevVariations.length > 0 && (
                <div style={{
                  display: 'flex', alignItems: 'center', gap: 10,
                  padding: '10px 14px', borderRadius: 8,
                  background: 'color-mix(in srgb, var(--action) 8%, var(--bg-2))',
                  border: '1px solid color-mix(in srgb, var(--action) 25%, transparent)',
                }}>
                  <span style={{ fontSize: 11, color: 'var(--text-2)', flex: 1 }}>
                    Previous results are still available.
                  </span>
                  <button
                    onClick={undoRegenStep1}
                    style={{
                      padding: '5px 14px', borderRadius: 6, border: 'none',
                      background: 'var(--action)', color: 'var(--action-fg)',
                      fontSize: 11, fontFamily: 'var(--font-mono)', fontWeight: 700, cursor: 'pointer',
                    }}
                  >
                    ↩ Restore
                  </button>
                </div>
              )}
              <div>
                <label style={{ fontSize: 11, fontFamily: 'var(--font-mono)', color: 'var(--text-2)', display: 'block', marginBottom: 6 }}>
                  Creative brief
                </label>
                <textarea
                  value={brief}
                  onChange={e => setBrief(e.target.value)}
                  disabled={isRunning}
                  placeholder="Describe your game idea, inspirations, or any creative direction…"
                  rows={4}
                  style={{
                    width: '100%', boxSizing: 'border-box',
                    background: 'var(--bg-2)', border: '1px solid var(--line-2)',
                    borderRadius: 8, padding: '10px 12px',
                    color: 'var(--text-0)', fontSize: 12, lineHeight: 1.6,
                    resize: 'vertical', outline: 'none', fontFamily: 'var(--font-sans)',
                    opacity: isRunning ? 0.6 : 1,
                  }}
                />
              </div>

              <div>
                <label style={{ fontSize: 11, fontFamily: 'var(--font-mono)', color: 'var(--text-2)', display: 'block', marginBottom: 8 }}>
                  Genre preferences <span style={{ color: 'var(--text-4)' }}>(optional)</span>
                </label>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                  {GENRES.map(g => {
                    const active = genres.includes(g)
                    return (
                      <button
                        key={g}
                        onClick={() => toggleGenre(g)}
                        disabled={isRunning}
                        style={{
                          padding: '5px 12px', borderRadius: 20, border: '1px solid',
                          fontSize: 11, fontFamily: 'var(--font-mono)', cursor: 'pointer',
                          borderColor: active ? '#A78BFA' : 'var(--line-2)',
                          background: active ? 'rgba(167,139,250,0.14)' : 'var(--bg-2)',
                          color: active ? '#A78BFA' : 'var(--text-2)',
                          transition: 'all 120ms', opacity: isRunning ? 0.5 : 1,
                        }}
                      >
                        {g}
                      </button>
                    )
                  })}
                </div>
              </div>

              <div>
                <label style={{ fontSize: 11, fontFamily: 'var(--font-mono)', color: 'var(--text-2)', display: 'block', marginBottom: 8 }}>
                  Concepts to generate
                </label>
                <div style={{ display: 'flex', gap: 6 }}>
                  {COUNTS.map(n => (
                    <button
                      key={n}
                      onClick={() => setCount(n)}
                      disabled={isRunning}
                      style={{
                        padding: '6px 20px', borderRadius: 8, border: '1px solid',
                        fontSize: 12, fontFamily: 'var(--font-mono)', fontWeight: 600,
                        cursor: 'pointer',
                        borderColor: count === n ? '#A78BFA' : 'var(--line-2)',
                        background: count === n ? 'rgba(167,139,250,0.14)' : 'var(--bg-2)',
                        color: count === n ? '#A78BFA' : 'var(--text-2)',
                        transition: 'all 120ms', opacity: isRunning ? 0.5 : 1,
                      }}
                    >
                      {n}
                    </button>
                  ))}
                </div>
              </div>
            </>
          )}

          {/* ── Step 1: Concept Variations ────────────────────────────────────── */}
          {currentView === 1 && (
            <div style={stepSectionStyle}>
              <div style={{
                padding: '10px 14px', display: 'flex', alignItems: 'center', gap: 8,
                borderBottom: step1.phase === 'done' && variations.length > 0 ? '1px solid var(--line-2)' : 'none',
              }}>
                <span style={stepBadgeStyle}>1.1.1</span>
                <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-0)', flex: 1 }}>Concept Variations</span>
                {step1.phase === 'running' && <RunningDot />}
                {step1.phase === 'done' && !step1Approved && (
                  <span style={{ fontSize: 10, fontFamily: 'var(--font-mono)', color: 'var(--state-success)' }}>{step1.detail}</span>
                )}
                {step1Approved && <span style={approvedBadgeStyle}>✓ Approved</span>}
                {step1.phase === 'error' && (
                  <span style={{ fontSize: 10, fontFamily: 'var(--font-mono)', color: '#F87171' }}>Failed</span>
                )}
              </div>
              {step1.phase === 'running' && (
                <div style={{ height: 3, background: 'var(--bg-3)', overflow: 'hidden' }}>
                  <div style={{ height: '100%', background: 'var(--action)', animation: 'fake-progress 14s ease-out forwards' }} />
                </div>
              )}

              {step1.phase === 'done' && variations.length > 0 && (
                <div style={{ padding: '10px 14px' }}>
                  <div style={{ display: 'flex', flexDirection: 'column' }}>
                    {(showAllVars ? variations : variations.slice(0, 10)).map((v, i, arr) => (
                      <div key={v.id} style={{ display: 'flex', gap: 8, padding: '5px 0', borderBottom: i < arr.length - 1 ? '1px solid var(--line-2)' : 'none' }}>
                        <span style={{ fontSize: 9, fontFamily: 'var(--font-mono)', color: 'var(--text-4)', flexShrink: 0, marginTop: 2, minWidth: 20 }}>#{i + 1}</span>
                        <span style={{ fontSize: 12, color: 'var(--text-1)', lineHeight: 1.4 }}>{v.concept}</span>
                      </div>
                    ))}
                    {variations.length > 10 && (
                      <button
                        onClick={() => setShowAllVars(s => !s)}
                        style={{ fontSize: 10, fontFamily: 'var(--font-mono)', color: 'var(--action)', background: 'none', border: 'none', cursor: 'pointer', textAlign: 'left', padding: '6px 0' }}
                      >
                        {showAllVars ? '↑ Show less' : `+${variations.length - 10} more`}
                      </button>
                    )}
                  </div>

                </div>
              )}

              {/* Step 1 aprobado pero sin items — datos perdidos, mostrar opción de re-run */}
              {step1Approved && step1.phase !== 'running' && variations.length === 0 && (
                <div style={{ padding: '14px', display: 'flex', flexDirection: 'column', gap: 10, alignItems: 'flex-start' }}>
                  <span style={{ fontSize: 12, color: 'var(--text-3)', fontFamily: 'var(--font-mono)' }}>
                    Output was approved but is no longer available. Re-run to regenerate.
                  </span>
                  <button onClick={regenStep1} disabled={isRunning} style={{ ...regenBtnStyle, cursor: isRunning ? 'not-allowed' : 'pointer', opacity: isRunning ? 0.5 : 1 }}>
                    ↺ Re-run Step 1
                  </button>
                </div>
              )}
            </div>
          )}

          {/* ── Step 2: Score & Rank ──────────────────────────────────────────── */}
          {currentView === 2 && (
            <div style={stepSectionStyle}>
              <div style={{
                padding: '10px 14px', display: 'flex', alignItems: 'center', gap: 8,
                borderBottom: step2.phase === 'done' && scored.length > 0 ? '1px solid var(--line-2)' : 'none',
              }}>
                <button onClick={() => setCurrentView(1)} disabled={isRunning} style={{ padding: '3px 8px', borderRadius: 5, border: '1px solid var(--line-2)', background: 'var(--bg-2)', color: 'var(--text-3)', fontSize: 10, fontFamily: 'var(--font-mono)', cursor: isRunning ? 'not-allowed' : 'pointer', flexShrink: 0 }}>← Step 1</button>
                <span style={stepBadgeStyle}>1.1.2</span>
                <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-0)', flex: 1 }}>Score & Rank</span>
                {step2.phase === 'running' && <RunningDot />}
                {step2.phase === 'done' && !step2Approved && (
                  <span style={{ fontSize: 10, fontFamily: 'var(--font-mono)', color: 'var(--state-success)' }}>{step2.detail}</span>
                )}
                {step2Approved && <span style={approvedBadgeStyle}>✓ Approved</span>}
                {step2.phase === 'error' && (
                  <span style={{ fontSize: 10, fontFamily: 'var(--font-mono)', color: '#F87171' }}>Failed</span>
                )}
              </div>
              {step2.phase === 'running' && (
                <div style={{ height: 3, background: 'var(--bg-3)', overflow: 'hidden' }}>
                  <div style={{ height: '100%', background: 'var(--action)', animation: 'fake-progress 16s ease-out forwards' }} />
                </div>
              )}

              {step2.phase === 'done' && scored.length > 0 && (
                <div style={{ padding: '10px 14px' }}>
                  <div style={{ display: 'flex', flexDirection: 'column' }}>
                    {(showAllScored ? scored : scored.slice(0, 10)).map((s, i, arr) => {
                      const sc    = s.total ?? 0
                      const color = sc >= 80 ? '#34D399' : sc >= 65 ? '#FBBF24' : '#F87171'
                      return (
                        <div key={s.id} style={{ display: 'flex', gap: 8, alignItems: 'flex-start', padding: '5px 0', borderBottom: i < arr.length - 1 ? '1px solid var(--line-2)' : 'none' }}>
                          <span style={{ fontSize: 9, fontFamily: 'var(--font-mono)', color: 'var(--text-4)', flexShrink: 0, marginTop: 2, minWidth: 20 }}>#{i + 1}</span>
                          <span style={{ flex: 1, fontSize: 12, color: 'var(--text-1)', lineHeight: 1.4 }}>{s.concept}</span>
                          <span style={{ fontSize: 11, fontWeight: 700, fontFamily: 'var(--font-mono)', color, background: `color-mix(in srgb, ${color} 12%, var(--bg-2))`, padding: '1px 6px', borderRadius: 4, flexShrink: 0 }}>
                            {sc}
                          </span>
                        </div>
                      )
                    })}
                    {scored.length > 10 && (
                      <button
                        onClick={() => setShowAllScored(s => !s)}
                        style={{ fontSize: 10, fontFamily: 'var(--font-mono)', color: 'var(--action)', background: 'none', border: 'none', cursor: 'pointer', textAlign: 'left', padding: '6px 0' }}
                      >
                        {showAllScored ? '↑ Show less' : `+${scored.length - 10} more`}
                      </button>
                    )}
                  </div>

                </div>
              )}

              {step2.phase === 'error' && (
                <div style={{ padding: '10px 14px' }}>
                  <button onClick={() => runStep2(variations)} style={regenBtnStyle}>↺ Retry Step 2</button>
                </div>
              )}

              {/* Step 2 idle sin items pero step 1 tiene datos — permite arrancar */}
              {step2.phase === 'idle' && scored.length === 0 && !step2Approved && variations.length > 0 && (
                <div style={{ padding: '14px', display: 'flex', alignItems: 'center', gap: 10 }}>
                  <span style={{ fontSize: 12, color: 'var(--text-3)', fontFamily: 'var(--font-mono)', flex: 1 }}>
                    Ready to score and rank {variations.length} concepts.
                  </span>
                </div>
              )}

              {/* Step 2 idle sin datos de step 1 — no hay nada que procesar */}
              {step2.phase === 'idle' && scored.length === 0 && !step2Approved && variations.length === 0 && (
                <div style={{ padding: '14px' }}>
                  <button onClick={() => setCurrentView(1)} style={regenBtnStyle}>← Go back to Step 1</button>
                </div>
              )}

              {/* Step 2 aprobado pero sin items — datos perdidos */}
              {step2Approved && step2.phase !== 'running' && scored.length === 0 && (
                <div style={{ padding: '14px', display: 'flex', flexDirection: 'column', gap: 10, alignItems: 'flex-start' }}>
                  <span style={{ fontSize: 12, color: 'var(--text-3)', fontFamily: 'var(--font-mono)' }}>
                    Output was approved but is no longer available. Re-run to regenerate.
                  </span>
                  {variations.length > 0
                    ? <button onClick={() => { setStep2Approved(false); setStep3Approved(false); runStep2(variations) }} disabled={isRunning} style={{ ...regenBtnStyle, cursor: isRunning ? 'not-allowed' : 'pointer', opacity: isRunning ? 0.5 : 1 }}>↺ Re-run Step 2</button>
                    : <button onClick={() => setCurrentView(1)} style={regenBtnStyle}>← Go back to Step 1</button>
                  }
                </div>
              )}
            </div>
          )}

          {/* ── Step 3: Top Candidates ────────────────────────────────────────── */}
          {currentView === 3 && (
            <div style={stepSectionStyle}>
              <div style={{
                padding: '10px 14px', display: 'flex', alignItems: 'center', gap: 8,
                borderBottom: step3.phase === 'done' && candidates.length > 0 ? '1px solid var(--line-2)' : 'none',
              }}>
                <button onClick={() => setCurrentView(2)} disabled={isRunning} style={{ padding: '3px 8px', borderRadius: 5, border: '1px solid var(--line-2)', background: 'var(--bg-2)', color: 'var(--text-3)', fontSize: 10, fontFamily: 'var(--font-mono)', cursor: isRunning ? 'not-allowed' : 'pointer', flexShrink: 0 }}>← Step 2</button>
                <span style={stepBadgeStyle}>1.1.3</span>
                <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-0)', flex: 1 }}>Top Candidates</span>
                {step3.phase === 'running' && <RunningDot />}
                {step3.phase === 'done' && !step3Approved && (
                  <span style={{ fontSize: 10, fontFamily: 'var(--font-mono)', color: 'var(--state-success)' }}>{step3.detail}</span>
                )}
                {step3Approved && <span style={approvedBadgeStyle}>✓ Approved</span>}
                {step3.phase === 'error' && (
                  <span style={{ fontSize: 10, fontFamily: 'var(--font-mono)', color: '#F87171' }}>Failed</span>
                )}
              </div>
              {step3.phase === 'running' && (
                <div style={{ height: 3, background: 'var(--bg-3)', overflow: 'hidden' }}>
                  <div style={{ height: '100%', background: 'var(--action)', animation: 'fake-progress 18s ease-out forwards' }} />
                </div>
              )}

              {step3.phase === 'done' && candidates.length > 0 && (
                <div style={{ padding: '10px 14px', display: 'flex', flexDirection: 'column', gap: 8 }}>
                  {candidates.map((c, i) => (
                    <CandidateCard
                      key={c.id}
                      candidate={c}
                      index={i}
                      expanded={expandedId === c.id}
                      imagesLoading={imagesLoading}
                      onToggle={() => setExpandedId(p => p === c.id ? null : c.id)}
                      onZoom={setZoomUrl}
                    />
                  ))}

                  {step4.phase === 'running' && (
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '4px 0', animation: 'item-pulse 1.6s ease-in-out infinite' }}>
                      <div style={{ width: 8, height: 8, borderRadius: '50%', background: 'var(--cat-design)', animation: 'dot-ping 1.6s ease-in-out infinite' }} />
                      <span style={{ fontSize: 10, fontFamily: 'var(--font-mono)', color: 'var(--cat-design)' }}>Generating reference images…</span>
                    </div>
                  )}
                  {step4.phase === 'error' && (
                    <div style={{ fontSize: 10, fontFamily: 'var(--font-mono)', color: 'var(--state-error)', padding: '4px 0' }}>
                      ⚠ {step4.detail}
                    </div>
                  )}
                </div>
              )}

              {step3.phase === 'error' && (
                <div style={{ padding: '10px 14px' }}>
                  <button onClick={() => runStep3(scored)} style={regenBtnStyle}>↺ Retry Step 3</button>
                </div>
              )}

              {/* Step 3 idle sin items pero step 2 tiene datos — permite arrancar */}
              {step3.phase === 'idle' && candidates.length === 0 && !step3Approved && scored.length > 0 && (
                <div style={{ padding: '14px', display: 'flex', alignItems: 'center', gap: 10 }}>
                  <span style={{ fontSize: 12, color: 'var(--text-3)', fontFamily: 'var(--font-mono)', flex: 1 }}>
                    Ready to surface top {topCount} candidates from {scored.length} scored concepts.
                  </span>
                </div>
              )}

              {/* Step 3 idle sin datos de step 2 */}
              {step3.phase === 'idle' && candidates.length === 0 && !step3Approved && scored.length === 0 && (
                <div style={{ padding: '14px' }}>
                  <button onClick={() => setCurrentView(2)} style={regenBtnStyle}>← Go back to Step 2</button>
                </div>
              )}
            </div>
          )}
        </div>

        {/* Footer */}
        <div style={{ padding: '14px 24px', borderTop: '1px solid var(--modal-border)', display: 'flex', alignItems: 'center', gap: 10, flexShrink: 0 }}>

          {/* Acciones step 1 */}
          {currentView === 1 && step1.phase === 'done' && variations.length > 0 && (
            <>
              <ForgyBtn onClick={() => setChatStep(1)} />
              <button onClick={regenStep1} disabled={isRunning} style={{ ...regenBtnStyle, cursor: isRunning ? 'not-allowed' : 'pointer', opacity: isRunning ? 0.5 : 1 }}>↺ Regen</button>
              <div style={{ flex: 1 }} />
              {scored.length > 0 && (
                <button onClick={() => setCurrentView(2)} disabled={isRunning} style={{ ...regenBtnStyle, cursor: isRunning ? 'not-allowed' : 'pointer', opacity: isRunning ? 0.5 : 1 }}>Step 2 →</button>
              )}
              {!step1Approved && (
                <button onClick={approveStep1} disabled={isRunning} style={approveBtnStyle(isRunning)}>Approve Step →</button>
              )}
            </>
          )}

          {/* Acción: step 2 listo para correr por primera vez */}
          {currentView === 2 && step2.phase === 'idle' && scored.length === 0 && !step2Approved && variations.length > 0 && (
            <>
              <div style={{ flex: 1, fontSize: 11, color: 'var(--text-3)', fontFamily: 'var(--font-mono)' }}>
                {isRunning ? 'Running — please wait…' : ''}
              </div>
              <button onClick={() => runStep2(variations)} disabled={isRunning} style={approveBtnStyle(isRunning)}>
                Run Step 2 →
              </button>
            </>
          )}

          {/* Acciones step 2 */}
          {currentView === 2 && step2.phase === 'done' && scored.length > 0 && (
            <>
              <ForgyBtn onClick={() => setChatStep(2)} />
              <button onClick={() => runStep2(variations)} disabled={isRunning} style={{ ...regenBtnStyle, cursor: isRunning ? 'not-allowed' : 'pointer', opacity: isRunning ? 0.5 : 1 }}>↺ Regen</button>
              <div style={{ flex: 1 }} />
              {candidates.length > 0 && (
                <button onClick={() => setCurrentView(3)} disabled={isRunning} style={{ ...regenBtnStyle, cursor: isRunning ? 'not-allowed' : 'pointer', opacity: isRunning ? 0.5 : 1 }}>Step 3 →</button>
              )}
              {!step2Approved && (
                <button onClick={approveStep2} disabled={isRunning} style={approveBtnStyle(isRunning)}>Approve Step →</button>
              )}
            </>
          )}

          {/* Acción: step 3 listo para correr por primera vez */}
          {currentView === 3 && step3.phase === 'idle' && candidates.length === 0 && !step3Approved && scored.length > 0 && (
            <>
              <div style={{ flex: 1, fontSize: 11, color: 'var(--text-3)', fontFamily: 'var(--font-mono)' }}>
                {isRunning ? 'Running — please wait…' : ''}
              </div>
              <button onClick={() => runStep3(scored)} disabled={isRunning} style={approveBtnStyle(isRunning)}>
                Run Step 3 →
              </button>
            </>
          )}

          {/* Acciones step 3 */}
          {currentView === 3 && step3.phase === 'done' && candidates.length > 0 && (
            <>
              <ForgyBtn onClick={() => setChatStep(3)} />
              <button onClick={() => runStep3(scored)} disabled={isRunning} style={{ ...regenBtnStyle, cursor: isRunning ? 'not-allowed' : 'pointer', opacity: isRunning ? 0.5 : 1 }}>↺ Regen</button>
              <div style={{ flex: 1 }} />
              {!step3Approved && (
                <button onClick={approveStep3} disabled={isRunning} style={approveBtnStyle(isRunning)}>Approve Step →</button>
              )}
            </>
          )}

          {/* Status text — formulario / running / estados sin acción */}
          {(currentView === 'form' || isRunning ||
            (currentView === 1 && step1.phase !== 'done') ||
            (currentView === 2 && step2.phase !== 'done' && !(step2.phase === 'idle' && scored.length === 0 && !step2Approved && variations.length > 0)) ||
            (currentView === 3 && step3.phase !== 'done' && !(step3.phase === 'idle' && candidates.length === 0 && !step3Approved && scored.length > 0))
          ) && (
            <div style={{ flex: 1, fontSize: 11, color: 'var(--text-3)', fontFamily: 'var(--font-mono)' }}>
              {isRunning
                ? 'Running — please wait…'
                : step1.phase === 'idle' || currentView === 'form'
                  ? brief.trim()
                    ? `${count} concepts → scored → top ${topCount} surfaced`
                    : 'Add a brief to get started'
                  : ''}
            </div>
          )}

          {/* Botón Generate */}
          {(currentView === 'form' || (currentView === 1 && (step1.phase === 'idle' || step1.phase === 'error'))) && (
            <button
              onClick={runStep1}
              disabled={isRunning || !brief.trim()}
              style={{
                padding: '9px 22px', borderRadius: 8, border: 'none',
                background: isRunning || !brief.trim() ? 'var(--bg-3)' : 'var(--action)',
                color: isRunning || !brief.trim() ? 'var(--text-3)' : 'var(--action-fg)',
                fontSize: 12, fontFamily: 'var(--font-mono)', fontWeight: 700,
                cursor: isRunning || !brief.trim() ? 'not-allowed' : 'pointer',
                transition: 'background 150ms, color 150ms',
              }}
            >
              {step1.phase === 'error' ? '↺ Retry' : 'Generate →'}
            </button>
          )}
        </div>
      </div>
    </>
  )
}
