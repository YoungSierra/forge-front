'use client'

import { useState, useEffect, useRef } from 'react'
import {
  researchComparableGames,
  analyzeGapsPositioning,
  sizeAudience,
  saveNodeDraft,
  saveChatHistory,
  approveNode,
  getProject,
} from '@/lib/api'
import type {
  IdeationCandidate,
  ComparableGamesResult,
  GapAnalysisResult,
  AudienceSizingResult,
  PipelineNodeItem,
  ChatMessage,
} from '@/lib/api'
import type { Project } from '@/lib/types'
import type { PhaseNodeConfig } from '@/lib/api'
import NodeChatWindow from '@/components/shared/NodeChatWindow'

// ─── Tipos ────────────────────────────────────────────────────────────────────

type RunPhase = 'idle' | 'running' | 'done' | 'error'
interface StepState { phase: RunPhase; detail: string }

// ─── Keyframes ───────────────────────────────────────────────────────────────

const KEYFRAMES = `
  @keyframes mkt-pulse    { 0%,100%{opacity:1} 50%{opacity:.45} }
  @keyframes mkt-dot      { 0%,100%{transform:scale(1);opacity:1} 50%{transform:scale(1.5);opacity:.5} }
  @keyframes mkt-progress { 0%{width:0%} 15%{width:30%} 45%{width:58%} 75%{width:76%} 100%{width:88%} }
  @keyframes presence-ping { 0%,100%{opacity:1;transform:scale(1)} 50%{opacity:0.45;transform:scale(1.25)} }
`

// ─── Helpers visuales ─────────────────────────────────────────────────────────

const SENTIMENT_COLOR: Record<string, string> = {
  'very positive': '#34D399',
  'positive':      '#86EFAC',
  'mixed':         '#FBBF24',
  'negative':      '#F87171',
  'unknown':       '#71717A',
}

const TIER_COLOR: Record<string, string> = {
  indie: '#A78BFA', mid: '#60A5FA', AA: '#FBBF24', AAA: '#F87171',
}

const OPP_COLOR: Record<string, string> = {
  high: '#34D399', medium: '#FBBF24', low: '#F87171',
}

const CONF_COLOR: Record<string, string> = {
  high: '#34D399', medium: '#FBBF24', low: '#F87171',
}

const SIZE_WIDTH: Record<string, string> = {
  massive: '100%', large: '75%', medium: '50%', small: '28%', niche: '12%',
}

function RunningDot() {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 6, animation: 'mkt-pulse 1.6s ease-in-out infinite' }}>
      <div style={{ width: 8, height: 8, borderRadius: '50%', background: 'var(--cat-design)', animation: 'mkt-dot 1.6s ease-in-out infinite' }} />
      <span style={{ fontSize: 10, fontFamily: 'var(--font-mono)', color: 'var(--cat-design)' }}>Running…</span>
    </div>
  )
}

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
      <img src="/forgy/forgyi.png" width={16} height={16} style={{ objectFit: 'contain', display: 'block' }} alt="" />
    </button>
  )
}

// ─── Tarjeta de comparables ───────────────────────────────────────────────────

function ComparablesCard({ result, expanded, onToggle }: {
  result:   ComparableGamesResult
  expanded: boolean
  onToggle: () => void
}) {
  return (
    <div
      onClick={onToggle}
      style={{
        borderRadius: 10, border: '1px solid var(--line-2)',
        background: 'var(--bg-1)', cursor: 'pointer',
        transition: 'border-color 120ms',
      }}
      onMouseEnter={e => e.currentTarget.style.borderColor = 'var(--action)'}
      onMouseLeave={e => e.currentTarget.style.borderColor = 'var(--line-2)'}
    >
      <div style={{ padding: '12px 16px', display: 'flex', alignItems: 'center', gap: 10 }}>
        <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-0)', flex: 1 }}>
          {result.comparables?.[0] ? `${result.comparables.length} comparables found` : 'No comparables'}
        </span>
        <span style={{ fontSize: 11, color: 'var(--text-3)', transform: expanded ? 'rotate(90deg)' : 'none', transition: 'transform 200ms' }}>›</span>
      </div>
      {expanded && result.comparables?.length > 0 && (
        <div style={{ borderTop: '1px solid var(--line-2)', padding: '12px 16px', display: 'flex', flexDirection: 'column', gap: 8 }}>
          {result.comparables.map(g => (
            <div key={g.id} style={{ display: 'flex', gap: 10, alignItems: 'flex-start', padding: '8px 0', borderBottom: '1px solid var(--line-2)' }}>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 3 }}>
                  <span style={{ fontSize: 12, fontWeight: 700, color: 'var(--text-0)' }}>{g.title}</span>
                  <span style={{ fontSize: 9, fontFamily: 'var(--font-mono)', color: 'var(--text-3)' }}>{g.release_year}</span>
                  <span style={{
                    fontSize: 9, fontFamily: 'var(--font-mono)', padding: '1px 5px', borderRadius: 3,
                    background: `color-mix(in srgb, ${TIER_COLOR[g.revenue_tier] ?? '#888'} 14%, var(--bg-3))`,
                    color: TIER_COLOR[g.revenue_tier] ?? '#888',
                  }}>{g.revenue_tier}</span>
                </div>
                <div style={{ fontSize: 11, color: 'var(--text-2)', marginBottom: 3 }}>{g.developer} · {g.genre}{g.subgenre ? ` / ${g.subgenre}` : ''}</div>
                <div style={{ fontSize: 11, color: 'var(--text-3)', lineHeight: 1.4 }}>{g.why_comparable}</div>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, marginTop: 5 }}>
                  {g.platforms.map(p => (
                    <span key={p} style={{ fontSize: 9, padding: '1px 6px', borderRadius: 3, background: 'var(--bg-3)', color: 'var(--text-3)', fontFamily: 'var(--font-mono)' }}>{p}</span>
                  ))}
                </div>
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 4, flexShrink: 0 }}>
                <div style={{ textAlign: 'right' }}>
                  <div style={{ fontSize: 9, fontFamily: 'var(--font-mono)', color: 'var(--text-4)' }}>SIM</div>
                  <div style={{ fontSize: 14, fontWeight: 800, color: 'var(--action)', fontFamily: 'var(--font-mono)' }}>{g.similarity_score}</div>
                </div>
                {g.metacritic_score !== null && (
                  <div style={{ textAlign: 'right' }}>
                    <div style={{ fontSize: 9, fontFamily: 'var(--font-mono)', color: 'var(--text-4)' }}>MC</div>
                    <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--text-1)', fontFamily: 'var(--font-mono)' }}>{g.metacritic_score}</div>
                  </div>
                )}
                <div style={{
                  fontSize: 8, fontFamily: 'var(--font-mono)', padding: '2px 5px', borderRadius: 3,
                  background: `color-mix(in srgb, ${SENTIMENT_COLOR[g.player_sentiment] ?? '#888'} 12%, var(--bg-3))`,
                  color: SENTIMENT_COLOR[g.player_sentiment] ?? '#888',
                }}>{g.player_sentiment}</div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

// ─── Tarjeta de gaps ─────────────────────────────────────────────────────────

function GapsCard({ result, expanded, onToggle }: {
  result:   GapAnalysisResult
  expanded: boolean
  onToggle: () => void
}) {
  return (
    <div
      onClick={onToggle}
      style={{
        borderRadius: 10, border: '1px solid var(--line-2)',
        background: 'var(--bg-1)', cursor: 'pointer',
        transition: 'border-color 120ms',
      }}
      onMouseEnter={e => e.currentTarget.style.borderColor = 'var(--action)'}
      onMouseLeave={e => e.currentTarget.style.borderColor = 'var(--line-2)'}
    >
      <div style={{ padding: '12px 16px', display: 'flex', alignItems: 'center', gap: 10 }}>
        <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-0)', flex: 1 }}>
          {result.positioning_statement
            ? `${result.market_gaps?.length ?? 0} gaps · score ${result.differentiation_score}`
            : 'No analysis'}
        </span>
        <span style={{ fontSize: 11, color: 'var(--text-3)', transform: expanded ? 'rotate(90deg)' : 'none', transition: 'transform 200ms' }}>›</span>
      </div>
      {expanded && (
        <div style={{ borderTop: '1px solid var(--line-2)', padding: '12px 16px', display: 'flex', flexDirection: 'column', gap: 12 }}>
          {result.positioning_statement && (
            <div>
              <div style={{ fontSize: 9, fontFamily: 'var(--font-mono)', color: 'var(--text-4)', marginBottom: 4, textTransform: 'uppercase', letterSpacing: '0.08em' }}>Positioning</div>
              <div style={{ fontSize: 12, color: 'var(--text-0)', lineHeight: 1.5, fontStyle: 'italic' }}>&ldquo;{result.positioning_statement}&rdquo;</div>
            </div>
          )}
          {[
            { label: 'Market Gaps',           items: result.market_gaps,           color: '#34D399' },
            { label: 'Underserved Audiences',  items: result.underserved_audiences,  color: '#60A5FA' },
            { label: 'Timing Opportunities',   items: result.timing_opportunities,   color: '#A78BFA' },
            { label: 'Competitor Weaknesses',  items: result.competitor_weaknesses,  color: '#FBBF24' },
          ].filter(g => g.items?.length).map(g => (
            <div key={g.label}>
              <div style={{ fontSize: 9, fontFamily: 'var(--font-mono)', color: 'var(--text-4)', marginBottom: 6, textTransform: 'uppercase', letterSpacing: '0.08em' }}>{g.label}</div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                {g.items.map((item, i) => (
                  <div key={i} style={{ display: 'flex', gap: 8, alignItems: 'flex-start' }}>
                    <div style={{ width: 5, height: 5, borderRadius: '50%', background: g.color, flexShrink: 0, marginTop: 5 }} />
                    <span style={{ fontSize: 11, color: 'var(--text-1)', lineHeight: 1.5 }}>{item}</span>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

// ─── Tarjeta de audiencia ─────────────────────────────────────────────────────

function AudienceCard({ result, expanded, onToggle }: {
  result:   AudienceSizingResult
  expanded: boolean
  onToggle: () => void
}) {
  const oColor = OPP_COLOR[result.market_opportunity] ?? '#888'
  const cColor = CONF_COLOR[result.confidence] ?? '#888'
  return (
    <div
      onClick={onToggle}
      style={{
        borderRadius: 10, border: '1px solid var(--line-2)',
        background: 'var(--bg-1)', cursor: 'pointer',
        transition: 'border-color 120ms',
      }}
      onMouseEnter={e => e.currentTarget.style.borderColor = 'var(--action)'}
      onMouseLeave={e => e.currentTarget.style.borderColor = 'var(--line-2)'}
    >
      <div style={{ padding: '12px 16px', display: 'flex', alignItems: 'center', gap: 8 }}>
        <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-0)', flex: 1 }}>
          {result.tam ? result.sam : 'No sizing'}
        </span>
        {result.market_opportunity && (
          <span style={{
            fontSize: 9, fontFamily: 'var(--font-mono)', padding: '2px 6px', borderRadius: 3,
            background: `color-mix(in srgb, ${oColor} 12%, var(--bg-3))`,
            color: oColor,
          }}>{result.market_opportunity} opp.</span>
        )}
        <span style={{ fontSize: 11, color: 'var(--text-3)', transform: expanded ? 'rotate(90deg)' : 'none', transition: 'transform 200ms' }}>›</span>
      </div>
      {expanded && (
        <div style={{ borderTop: '1px solid var(--line-2)', padding: '12px 16px', display: 'flex', flexDirection: 'column', gap: 12 }}>
          {/* Platform breakdown */}
          {result.platform_breakdown && Object.keys(result.platform_breakdown).length > 0 && (
            <div>
              <div style={{ fontSize: 9, fontFamily: 'var(--font-mono)', color: 'var(--text-4)', marginBottom: 8, textTransform: 'uppercase', letterSpacing: '0.08em' }}>Platform Reach</div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                {Object.entries(result.platform_breakdown).map(([platform, data]) => (
                  <div key={platform}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 3 }}>
                      <span style={{ fontSize: 11, color: 'var(--text-1)', fontFamily: 'var(--font-mono)', textTransform: 'capitalize' }}>{platform}</span>
                      <span style={{ fontSize: 11, color: 'var(--text-3)' }}>{data.size}</span>
                    </div>
                    <div style={{ height: 4, background: 'var(--bg-3)', borderRadius: 2, overflow: 'hidden' }}>
                      <div style={{ height: '100%', width: SIZE_WIDTH[data.size] ?? '10%', background: 'var(--action)', borderRadius: 2, transition: 'width 400ms' }} />
                    </div>
                    <div style={{ fontSize: 10, color: 'var(--text-3)', marginTop: 2, lineHeight: 1.4 }}>{data.rationale}</div>
                  </div>
                ))}
              </div>
            </div>
          )}
          {/* TAM / SAM */}
          <div style={{ display: 'flex', gap: 12 }}>
            {result.tam && (
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: 9, fontFamily: 'var(--font-mono)', color: 'var(--text-4)', marginBottom: 3, textTransform: 'uppercase', letterSpacing: '0.08em' }}>TAM</div>
                <div style={{ fontSize: 11, color: 'var(--text-1)', lineHeight: 1.4 }}>{result.tam}</div>
              </div>
            )}
            {result.sam && (
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: 9, fontFamily: 'var(--font-mono)', color: 'var(--text-4)', marginBottom: 3, textTransform: 'uppercase', letterSpacing: '0.08em' }}>SAM</div>
                <div style={{ fontSize: 11, color: 'var(--action)', lineHeight: 1.4 }}>{result.sam}</div>
              </div>
            )}
          </div>
          {/* Demographic */}
          {result.demographic_breakdown && (
            <div>
              <div style={{ fontSize: 9, fontFamily: 'var(--font-mono)', color: 'var(--text-4)', marginBottom: 4, textTransform: 'uppercase', letterSpacing: '0.08em' }}>Demographics</div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                {[result.demographic_breakdown.age_range, result.demographic_breakdown.gender_skew, result.demographic_breakdown.player_type].filter(Boolean).map((v, i) => (
                  <span key={i} style={{ fontSize: 10, padding: '2px 7px', borderRadius: 4, background: 'var(--bg-3)', color: 'var(--text-2)', border: '1px solid var(--line-2)' }}>{v}</span>
                ))}
                {result.demographic_breakdown.regions?.map(r => (
                  <span key={r} style={{ fontSize: 10, padding: '2px 7px', borderRadius: 4, background: 'rgba(96,165,250,0.08)', color: '#60A5FA', border: '1px solid rgba(96,165,250,0.2)' }}>{r}</span>
                ))}
              </div>
            </div>
          )}
          {/* Confianza */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={{ fontSize: 10, fontFamily: 'var(--font-mono)', color: 'var(--text-4)' }}>Confidence:</span>
            <span style={{ fontSize: 10, fontFamily: 'var(--font-mono)', color: cColor }}>{result.confidence}</span>
          </div>
        </div>
      )}
    </div>
  )
}

// ─── Props del modal ──────────────────────────────────────────────────────────

export interface MarketResearchModalProps {
  project:        Project
  nodes?:         PhaseNodeConfig[]
  label?:         string
  description?:   string | null
  icon?:          string
  initialStep?:   number
  onOpenSource?:  (containerStepKey: string, nodeStep: number) => void
  onClose:        () => void
}

// ─── MarketResearchModal ──────────────────────────────────────────────────────

export default function MarketResearchModal({
  project, nodes = [], label = 'Market & Competitive Research',
  description, icon = '📊', initialStep, onOpenSource, onClose,
}: MarketResearchModalProps) {
  const node1      = nodes.find(n => n.order_index === 1)
  const node2      = nodes.find(n => n.order_index === 2)
  const node3      = nodes.find(n => n.order_index === 3)
  const stepKey1   = node1?.step_key ?? 'idtn_research_comparable'
  const stepKey2   = node2?.step_key ?? 'idtn_analyze_gaps'
  const stepKey3   = node3?.step_key ?? 'idtn_size_audience'
  const nodeLabel1 = node1?.label ?? 'Research Comparable Games'
  const nodeLabel2 = node2?.label ?? 'Analyze Gaps & Positioning'
  const nodeLabel3 = node3?.label ?? 'Size the Audience'

  // Candidates vienen de 1.1.3
  const [candidates, setCandidates] = useState<IdeationCandidate[]>([])

  // Resultados por paso
  const [comparables, setComparables] = useState<ComparableGamesResult[]>([])
  const [gapResults,  setGapResults]  = useState<GapAnalysisResult[]>([])
  const [audResults,  setAudResults]  = useState<AudienceSizingResult[]>([])

  // Estado de ejecución
  const [step1, setStep1] = useState<StepState>({ phase: 'idle', detail: '' })
  const [step2, setStep2] = useState<StepState>({ phase: 'idle', detail: '' })
  const [step3, setStep3] = useState<StepState>({ phase: 'idle', detail: '' })
  const [globalError, setGlobalError] = useState<string | null>(null)

  // Aprobaciones
  const [step1Approved, setStep1Approved] = useState(false)
  const [step2Approved, setStep2Approved] = useState(false)
  const [step3Approved, setStep3Approved] = useState(false)

  // UI
  const [currentView,  setCurrentView]  = useState<1 | 2 | 3>(1)
  const [chatStep,     setChatStep]      = useState<1 | 2 | 3 | null>(null)
  const [expandedId,   setExpandedId]   = useState<string | null>(null)
  const [showInput,    setShowInput]    = useState(false)

  // Chat
  const [chatHistories, setChatHistories] = useState<Record<number, ChatMessage[]>>({})
  const chatSaveTimer    = useRef<ReturnType<typeof setTimeout> | null>(null)
  const chatHistoriesRef = useRef(chatHistories)
  useEffect(() => { chatHistoriesRef.current = chatHistories }, [chatHistories])

  // Auto-scroll al card expandido para que el contenido sea siempre visible
  const bodyRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!expandedId) return
    const el = bodyRef.current?.querySelector(`[data-expanded-key="${expandedId}"]`)
    if (el) el.scrollIntoView({ behavior: 'smooth', block: 'nearest' })
  }, [expandedId])

  function flushChatSave() {
    if (chatSaveTimer.current) clearTimeout(chatSaveTimer.current)
    const h = chatHistoriesRef.current
    const saves: Array<[string, ChatMessage[]]> = [
      [stepKey1, h[1]], [stepKey2, h[2]], [stepKey3, h[3]],
    ].filter(([, hist]) => hist?.length > 0) as Array<[string, ChatMessage[]]>
    saves.forEach(([key, history]) => saveChatHistory(project.id, key, history).catch(console.error))
  }

  useEffect(() => {
    if (Object.keys(chatHistories).length === 0) return
    if (chatSaveTimer.current) clearTimeout(chatSaveTimer.current)
    chatSaveTimer.current = setTimeout(flushChatSave, 1500)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chatHistories])

  const isRunning   = [step1, step2, step3].some(s => s.phase === 'running')
  const handleClose = () => { flushChatSave(); onClose() }

  // Restaurar estado desde el proyecto
  useEffect(() => {
    type PipelineEntry = { items?: unknown[]; chat_history?: ChatMessage[] }

    const applyRestore = (p: typeof project) => {
      // Candidates vienen de idtn_surface_candidates (paso 1.1.3)
      const pipeline  = p.concept?.pipeline as Record<string, PipelineEntry> | undefined
      const candEntry = pipeline?.['idtn_surface_candidates']
      const cands     = Array.isArray(candEntry?.items) ? (candEntry!.items as IdeationCandidate[]) : []
      if (cands.length) setCandidates(cands)

      const e1 = pipeline?.[stepKey1]
      const e2 = pipeline?.[stepKey2]
      const e3 = pipeline?.[stepKey3]

      const jobs      = p.generation_jobs ?? []
      const s1app     = jobs.some(j => j.current_step === stepKey1 && j.status === 'approved')
      const s2app     = jobs.some(j => j.current_step === stepKey2 && j.status === 'approved')
      const s3app     = jobs.some(j => j.current_step === stepKey3 && j.status === 'approved')

      const hasItems1 = Array.isArray(e1?.items) && (e1!.items!.length > 0)
      const hasItems2 = Array.isArray(e2?.items) && (e2!.items!.length > 0)
      const hasItems3 = Array.isArray(e3?.items) && (e3!.items!.length > 0)

      if (hasItems1) {
        setComparables(e1!.items as ComparableGamesResult[])
        setStep1({ phase: 'done', detail: `${e1!.items!.length} candidates researched` })
        if (e1!.chat_history?.length) setChatHistories(prev => ({ ...prev, 1: e1!.chat_history! }))
      }
      if (hasItems2) {
        setGapResults(e2!.items as GapAnalysisResult[])
        setStep2({ phase: 'done', detail: `${e2!.items!.length} gap analyses done` })
        if (e2!.chat_history?.length) setChatHistories(prev => ({ ...prev, 2: e2!.chat_history! }))
      }
      if (hasItems3) {
        setAudResults(e3!.items as AudienceSizingResult[])
        setStep3({ phase: 'done', detail: `${e3!.items!.length} audience reports done` })
        if (e3!.chat_history?.length) setChatHistories(prev => ({ ...prev, 3: e3!.chat_history! }))
      }

      if (s1app) setStep1Approved(true)
      if (s2app) setStep2Approved(true)
      if (s3app) setStep3Approved(true)

      if (initialStep === 1 || initialStep === 2 || initialStep === 3) {
        setCurrentView(initialStep)
      } else {
        if      (hasItems3) setCurrentView(3)
        else if (hasItems2) setCurrentView(2)
        else                setCurrentView(1)
      }
    }

    applyRestore(project)
    getProject(project.id).then(fresh => {
      const jobs = fresh.generation_jobs ?? []
      if (jobs.some(j => j.current_step === stepKey1 && j.status === 'approved')) setStep1Approved(true)
      if (jobs.some(j => j.current_step === stepKey2 && j.status === 'approved')) setStep2Approved(true)
      if (jobs.some(j => j.current_step === stepKey3 && j.status === 'approved')) setStep3Approved(true)
    }).catch(console.error)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Esc para cerrar
  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape' && !isRunning) handleClose() }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [isRunning])

  // ── Ejecución de pasos ────────────────────────────────────────────────────────

  async function runStep1() {
    if (!candidates.length) { setGlobalError('No candidates from Idea Generation. Complete step 1.1 first.'); return }
    setGlobalError(null)
    setComparables([]); setGapResults([]); setAudResults([])
    setStep1({ phase: 'running', detail: '' })
    setStep2({ phase: 'idle', detail: '' })
    setStep3({ phase: 'idle', detail: '' })
    setStep1Approved(false); setStep2Approved(false); setStep3Approved(false)
    setExpandedId(null)
    try {
      const r = await researchComparableGames(candidates, stepKey1)
      setComparables(r.results)
      setStep1({ phase: 'done', detail: `${r.results.length} candidates researched` })
      saveNodeDraft(project.id, stepKey1, '', null, r.results as unknown as PipelineNodeItem[]).catch(console.error)
    } catch (err: unknown) {
      setGlobalError(err instanceof Error ? err.message : 'Unknown error')
      setStep1({ phase: 'error', detail: '' })
    }
  }

  async function runStep2(comps?: ComparableGamesResult[]) {
    const c = comps ?? comparables
    setGlobalError(null)
    setGapResults([]); setAudResults([])
    setStep2({ phase: 'running', detail: '' })
    setStep3({ phase: 'idle', detail: '' })
    setStep2Approved(false); setStep3Approved(false)
    setExpandedId(null)
    try {
      const r = await analyzeGapsPositioning(candidates, c, stepKey2)
      setGapResults(r.results)
      setStep2({ phase: 'done', detail: `${r.results.length} gap analyses done` })
      saveNodeDraft(project.id, stepKey2, '', null, r.results as unknown as PipelineNodeItem[]).catch(console.error)
    } catch (err: unknown) {
      setGlobalError(err instanceof Error ? err.message : 'Unknown error')
      setStep2({ phase: 'error', detail: '' })
    }
  }

  async function runStep3(gaps?: GapAnalysisResult[]) {
    const g = gaps ?? gapResults
    setGlobalError(null)
    setAudResults([])
    setStep3({ phase: 'running', detail: '' })
    setStep3Approved(false)
    setExpandedId(null)
    try {
      const r = await sizeAudience(candidates, g, stepKey3)
      setAudResults(r.results)
      setStep3({ phase: 'done', detail: `${r.results.length} audience reports done` })
      saveNodeDraft(project.id, stepKey3, '', null, r.results as unknown as PipelineNodeItem[]).catch(console.error)
    } catch (err: unknown) {
      setGlobalError(err instanceof Error ? err.message : 'Unknown error')
      setStep3({ phase: 'error', detail: '' })
    }
  }

  async function approveStep1() {
    approveNode(project.id, stepKey1, { items: comparables, generated_at: new Date().toISOString() }).catch(console.error)
    setStep1Approved(true)
    setCurrentView(2)
    await runStep2(comparables)
  }

  async function approveStep2() {
    approveNode(project.id, stepKey2, { items: gapResults, generated_at: new Date().toISOString() }).catch(console.error)
    setStep2Approved(true)
    setCurrentView(3)
    await runStep3(gapResults)
  }

  function approveStep3() {
    approveNode(project.id, stepKey3, { items: audResults, generated_at: new Date().toISOString() }).catch(console.error)
    setStep3Approved(true)
  }

  // ── Estilos ───────────────────────────────────────────────────────────────────

  const sectionStyle: React.CSSProperties = {
    background: 'var(--bg-1)', borderRadius: 10,
    border: '1px solid var(--line-2)',
  }
  const badgeStyle: React.CSSProperties = {
    fontSize: 9, fontFamily: 'var(--font-mono)', color: 'var(--text-4)',
    background: 'var(--bg-3)', padding: '2px 7px', borderRadius: 4, flexShrink: 0,
  }
  const approvedBadge: React.CSSProperties = {
    fontSize: 10, fontFamily: 'var(--font-mono)', color: '#34D399',
    background: 'rgba(52,211,153,0.10)', border: '1px solid rgba(52,211,153,0.25)',
    padding: '2px 8px', borderRadius: 4,
  }
  const regenBtn: React.CSSProperties = {
    padding: '6px 12px', borderRadius: 7, border: '1px solid var(--line-2)',
    background: 'var(--bg-2)', color: 'var(--text-1)',
    fontSize: 11, fontFamily: 'var(--font-mono)', cursor: 'pointer',
  }
  const approveBtn = (disabled: boolean): React.CSSProperties => ({
    padding: '7px 18px', borderRadius: 7, border: 'none',
    background: disabled ? 'var(--bg-3)' : 'var(--action)',
    color: disabled ? 'var(--text-4)' : 'var(--action-fg)',
    fontSize: 12, fontFamily: 'var(--font-mono)', fontWeight: 700,
    cursor: disabled ? 'not-allowed' : 'pointer',
  })

  const backBtn = (label: string, view: 1 | 2): React.CSSProperties => ({
    padding: '3px 8px', borderRadius: 5, border: '1px solid var(--line-2)',
    background: 'var(--bg-2)', color: 'var(--text-3)', fontSize: 10,
    fontFamily: 'var(--font-mono)', cursor: isRunning ? 'not-allowed' : 'pointer', flexShrink: 0,
  })
  void backBtn

  // ── Render ────────────────────────────────────────────────────────────────────

  const activeNode = currentView === 1 ? node1 : currentView === 2 ? node2 : node3
  const headerLabel = activeNode?.label ?? label
  const headerDesc  = activeNode?.description ?? description ?? null

  // Función para renderizar lista de candidatos por paso
  function renderCandidateList<T extends { candidate_id: string }>(
    results: T[],
    renderCard: (r: T, expanded: boolean, onToggle: () => void) => React.ReactNode,
  ) {
    return candidates.map(c => {
      const r = results.find(x => x.candidate_id === c.id)
      if (!r) return null
      const key = `${currentView}_${c.id}`
      return (
        <div key={c.id} data-expanded-key={key} style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={{ fontSize: 9, fontFamily: 'var(--font-mono)', color: 'var(--text-4)', background: 'var(--bg-3)', padding: '2px 6px', borderRadius: 4 }}>#{c.id}</span>
            <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-0)', flex: 1 }}>{c.concept}</span>
            <span style={{ fontSize: 11, fontWeight: 800, fontFamily: 'var(--font-mono)', color: 'var(--action)' }}>{c.score}</span>
          </div>
          {renderCard(r, expandedId === key, () => setExpandedId(p => p === key ? null : key))}
        </div>
      )
    })
  }

  return (
    <>
      <style>{KEYFRAMES}</style>

      {/* Chat window */}
      {chatStep !== null && (
        <NodeChatWindow
          stepKey={chatStep === 1 ? stepKey1 : chatStep === 2 ? stepKey2 : stepKey3}
          stepLabel={chatStep === 1 ? nodeLabel1 : chatStep === 2 ? nodeLabel2 : nodeLabel3}
          currentOutput={chatStep === 1 ? comparables : chatStep === 2 ? gapResults : audResults}
          project={project}
          locked={chatStep === 1 ? step1Approved : chatStep === 2 ? step2Approved : step3Approved}
          initialMessages={chatHistories[chatStep] ?? []}
          onMessagesChange={msgs => setChatHistories(prev => ({ ...prev, [chatStep!]: msgs }))}
          onClose={() => { flushChatSave(); setChatStep(null) }}
        />
      )}

      {/* Overlay */}
      <div style={{ position: 'fixed', inset: 0, zIndex: 60, background: 'rgba(0,0,0,0.72)', backdropFilter: 'blur(4px)' }} />

      {/* Modal */}
      <div className="modal-card" style={{
        position: 'fixed', top: '50%', left: '50%', transform: 'translate(-50%,-50%)',
        zIndex: 70, width: 720, maxWidth: 'calc(100vw - 32px)',
        maxHeight: 'calc(100vh - 48px)', borderRadius: 8,
        boxShadow: '0 18px 42px rgba(0,0,0,0.6), 0 0 0 1px var(--line-2)',
        display: 'flex', flexDirection: 'column', overflow: 'hidden',
        fontFamily: 'var(--font-sans)',
      }}>

        {/* Header */}
        <div style={{ padding: '18px 24px 16px', borderBottom: '1px solid var(--modal-border)', display: 'flex', alignItems: 'center', gap: 14, flexShrink: 0 }}>
          <div style={{ width: 36, height: 36, borderRadius: 8, flexShrink: 0, background: 'var(--bg-3)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 20 }}>
            {icon}
          </div>
          <div style={{ flex: 1, minWidth: 0 }}>
            {activeNode && (
              <div style={{ fontSize: 10, fontFamily: 'var(--font-mono)', color: 'var(--text-4)', marginBottom: 2 }}>{label}</div>
            )}
            <div style={{ fontSize: 15, fontWeight: 700, color: 'var(--text-0)', lineHeight: 1.2, marginBottom: headerDesc ? 3 : 0 }}>
              {headerLabel}
            </div>
            {headerDesc && (
              <div style={{ fontSize: 12, color: 'var(--text-3)', lineHeight: 1.5 }}>{headerDesc}</div>
            )}
          </div>
          <button
            onClick={isRunning ? undefined : handleClose}
            disabled={isRunning}
            style={{ border: 'none', background: 'var(--bg-3)', cursor: isRunning ? 'not-allowed' : 'pointer', color: 'var(--text-2)', fontSize: 14, padding: '5px 9px', borderRadius: 6, flexShrink: 0, opacity: isRunning ? 0.4 : 1 }}
          >✕</button>
        </div>

        {/* Body */}
        <div ref={bodyRef} style={{ flex: 1, minHeight: 0, overflowY: 'auto', padding: '20px 24px', display: 'flex', flexDirection: 'column', gap: 16 }}>

          {/* Panel de input context — candidates de 1.1.3 */}
          {candidates.length > 0 && (
            <div style={{ borderRadius: 8, border: '1px solid var(--line-2)', overflow: 'hidden', flexShrink: 0 }}>
              <div style={{ display: 'flex', alignItems: 'center', background: 'var(--bg-2)' }}>
                <button
                  onClick={() => setShowInput(v => !v)}
                  style={{
                    flex: 1, display: 'flex', alignItems: 'center', gap: 8,
                    padding: '8px 14px', background: 'none', border: 'none',
                    cursor: 'pointer', textAlign: 'left',
                  }}
                >
                  <span style={{ fontSize: 10, color: 'var(--text-4)' }}>📥</span>
                  <span style={{ fontSize: 11, fontFamily: 'var(--font-mono)', color: 'var(--text-3)', flex: 1 }}>
                    Input from 1.1.3 — {candidates.length} candidate{candidates.length !== 1 ? 's' : ''}
                  </span>
                  <span style={{ fontSize: 11, color: 'var(--text-4)', transform: showInput ? 'rotate(180deg)' : 'none', transition: 'transform 200ms' }}>▾</span>
                </button>
                {onOpenSource && (
                  <button
                    onClick={() => onOpenSource('idtn_idea_generation', 3)}
                    title="Open 1.1.3 Surface Candidates"
                    style={{
                      padding: '6px 12px', background: 'none', border: 'none',
                      borderLeft: '1px solid var(--line-2)', cursor: 'pointer',
                      fontSize: 10, fontFamily: 'var(--font-mono)', color: 'var(--action)',
                      whiteSpace: 'nowrap', flexShrink: 0,
                    }}
                    onMouseEnter={e => e.currentTarget.style.background = 'color-mix(in srgb, var(--action) 8%, var(--bg-2))'}
                    onMouseLeave={e => e.currentTarget.style.background = 'none'}
                  >
                    Open 1.1.3 →
                  </button>
                )}
              </div>
              {showInput && (
                <div style={{ borderTop: '1px solid var(--line-2)', padding: '10px 14px', display: 'flex', flexDirection: 'column', gap: 6, background: 'var(--bg-1)' }}>
                  {candidates.map((c, i) => (
                    <div key={c.id} style={{ display: 'flex', gap: 8, alignItems: 'flex-start', padding: '6px 0', borderBottom: i < candidates.length - 1 ? '1px solid var(--line-2)' : 'none' }}>
                      <span style={{ fontSize: 9, fontFamily: 'var(--font-mono)', color: 'var(--text-4)', background: 'var(--bg-3)', padding: '1px 5px', borderRadius: 3, flexShrink: 0, marginTop: 2 }}>#{c.id}</span>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontSize: 12, color: 'var(--text-0)', fontWeight: 600, lineHeight: 1.3 }}>{c.concept}</div>
                        {c.hook && <div style={{ fontSize: 11, color: 'var(--text-2)', lineHeight: 1.4, marginTop: 2 }}>{c.hook}</div>}
                        {c.target_audience && <div style={{ fontSize: 10, color: 'var(--text-3)', marginTop: 2 }}>👥 {c.target_audience}</div>}
                      </div>
                      <span style={{ fontSize: 13, fontWeight: 800, fontFamily: 'var(--font-mono)', color: 'var(--action)', flexShrink: 0 }}>{c.score}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* Error global */}
          {globalError && (
            <div style={{ background: 'rgba(248,113,113,0.08)', border: '1px solid rgba(248,113,113,0.3)', borderRadius: 8, padding: '10px 14px', fontSize: 11, color: '#F87171', lineHeight: 1.5 }}>
              {globalError}
            </div>
          )}

          {/* Sin candidates */}
          {candidates.length === 0 && (
            <div style={{ padding: '32px 0', textAlign: 'center', color: 'var(--text-3)', fontSize: 12, fontFamily: 'var(--font-mono)' }}>
              No candidates found. Complete Idea Generation (1.1) first.
            </div>
          )}

          {/* ── Step 1: Comparable Games ─── */}
          {currentView === 1 && candidates.length > 0 && (
            <div style={sectionStyle}>
              <div style={{ padding: '10px 14px', display: 'flex', alignItems: 'center', gap: 8, borderBottom: step1.phase === 'done' && comparables.length > 0 ? '1px solid var(--line-2)' : 'none' }}>
                <span style={badgeStyle}>1.2.1</span>
                <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-0)', flex: 1 }}>Research Comparable Games</span>
                {step1.phase === 'running' && <RunningDot />}
                {step1.phase === 'done' && !step1Approved && <span style={{ fontSize: 10, fontFamily: 'var(--font-mono)', color: 'var(--state-success)' }}>{step1.detail}</span>}
                {step1Approved && <span style={approvedBadge}>✓ Approved</span>}
                {step1.phase === 'error' && <span style={{ fontSize: 10, fontFamily: 'var(--font-mono)', color: '#F87171' }}>Failed</span>}
              </div>
              {step1.phase === 'running' && (
                <div style={{ height: 3, background: 'var(--bg-3)', overflow: 'hidden' }}>
                  <div style={{ height: '100%', background: 'var(--action)', animation: 'mkt-progress 30s ease-out forwards' }} />
                </div>
              )}
              {step1.phase === 'done' && comparables.length > 0 && (
                <div style={{ padding: '12px 16px', display: 'flex', flexDirection: 'column', gap: 14 }}>
                  {renderCandidateList(comparables, (r, expanded, onToggle) => (
                    <ComparablesCard result={r} expanded={expanded} onToggle={onToggle} />
                  ))}
                </div>
              )}
              {step1.phase === 'idle' && comparables.length === 0 && !step1Approved && (
                <div style={{ padding: '14px', display: 'flex', alignItems: 'center', gap: 10 }}>
                  <span style={{ fontSize: 12, color: 'var(--text-3)', fontFamily: 'var(--font-mono)', flex: 1 }}>
                    Ready to research comparables for {candidates.length} candidate{candidates.length !== 1 ? 's' : ''}.
                  </span>
                </div>
              )}
              {step1.phase === 'error' && (
                <div style={{ padding: '10px 14px' }}>
                  <button onClick={runStep1} style={regenBtn}>↺ Retry Step 1</button>
                </div>
              )}
            </div>
          )}

          {/* ── Step 2: Gaps & Positioning ─── */}
          {currentView === 2 && (
            <div style={sectionStyle}>
              <div style={{ padding: '10px 14px', display: 'flex', alignItems: 'center', gap: 8, borderBottom: step2.phase === 'done' && gapResults.length > 0 ? '1px solid var(--line-2)' : 'none' }}>
                <button onClick={() => setCurrentView(1)} disabled={isRunning} style={{ padding: '3px 8px', borderRadius: 5, border: '1px solid var(--line-2)', background: 'var(--bg-2)', color: 'var(--text-3)', fontSize: 10, fontFamily: 'var(--font-mono)', cursor: isRunning ? 'not-allowed' : 'pointer', flexShrink: 0 }}>← Step 1</button>
                <span style={badgeStyle}>1.2.2</span>
                <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-0)', flex: 1 }}>Analyze Gaps & Positioning</span>
                {step2.phase === 'running' && <RunningDot />}
                {step2.phase === 'done' && !step2Approved && <span style={{ fontSize: 10, fontFamily: 'var(--font-mono)', color: 'var(--state-success)' }}>{step2.detail}</span>}
                {step2Approved && <span style={approvedBadge}>✓ Approved</span>}
                {step2.phase === 'error' && <span style={{ fontSize: 10, fontFamily: 'var(--font-mono)', color: '#F87171' }}>Failed</span>}
              </div>
              {step2.phase === 'running' && (
                <div style={{ height: 3, background: 'var(--bg-3)', overflow: 'hidden' }}>
                  <div style={{ height: '100%', background: 'var(--action)', animation: 'mkt-progress 25s ease-out forwards' }} />
                </div>
              )}
              {step2.phase === 'done' && gapResults.length > 0 && (
                <div style={{ padding: '12px 16px', display: 'flex', flexDirection: 'column', gap: 14 }}>
                  {renderCandidateList(gapResults, (r, expanded, onToggle) => (
                    <GapsCard result={r} expanded={expanded} onToggle={onToggle} />
                  ))}
                </div>
              )}
              {step2.phase === 'idle' && gapResults.length === 0 && !step2Approved && comparables.length > 0 && (
                <div style={{ padding: '14px', display: 'flex', alignItems: 'center', gap: 10 }}>
                  <span style={{ fontSize: 12, color: 'var(--text-3)', fontFamily: 'var(--font-mono)', flex: 1 }}>Ready to analyze gaps for {comparables.length} candidates.</span>
                </div>
              )}
              {step2.phase === 'idle' && gapResults.length === 0 && !step2Approved && comparables.length === 0 && (
                <div style={{ padding: '14px' }}><button onClick={() => setCurrentView(1)} style={regenBtn}>← Go back to Step 1</button></div>
              )}
              {step2.phase === 'error' && (
                <div style={{ padding: '10px 14px' }}>
                  <button onClick={() => runStep2()} style={regenBtn}>↺ Retry Step 2</button>
                </div>
              )}
            </div>
          )}

          {/* ── Step 3: Audience Sizing ─── */}
          {currentView === 3 && (
            <div style={sectionStyle}>
              <div style={{ padding: '10px 14px', display: 'flex', alignItems: 'center', gap: 8, borderBottom: step3.phase === 'done' && audResults.length > 0 ? '1px solid var(--line-2)' : 'none' }}>
                <button onClick={() => setCurrentView(2)} disabled={isRunning} style={{ padding: '3px 8px', borderRadius: 5, border: '1px solid var(--line-2)', background: 'var(--bg-2)', color: 'var(--text-3)', fontSize: 10, fontFamily: 'var(--font-mono)', cursor: isRunning ? 'not-allowed' : 'pointer', flexShrink: 0 }}>← Step 2</button>
                <span style={badgeStyle}>1.2.3</span>
                <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-0)', flex: 1 }}>Size the Audience</span>
                {step3.phase === 'running' && <RunningDot />}
                {step3.phase === 'done' && !step3Approved && <span style={{ fontSize: 10, fontFamily: 'var(--font-mono)', color: 'var(--state-success)' }}>{step3.detail}</span>}
                {step3Approved && <span style={approvedBadge}>✓ Approved</span>}
                {step3.phase === 'error' && <span style={{ fontSize: 10, fontFamily: 'var(--font-mono)', color: '#F87171' }}>Failed</span>}
              </div>
              {step3.phase === 'running' && (
                <div style={{ height: 3, background: 'var(--bg-3)', overflow: 'hidden' }}>
                  <div style={{ height: '100%', background: 'var(--action)', animation: 'mkt-progress 20s ease-out forwards' }} />
                </div>
              )}
              {step3.phase === 'done' && audResults.length > 0 && (
                <div style={{ padding: '12px 16px', display: 'flex', flexDirection: 'column', gap: 14 }}>
                  {renderCandidateList(audResults, (r, expanded, onToggle) => (
                    <AudienceCard result={r} expanded={expanded} onToggle={onToggle} />
                  ))}
                </div>
              )}
              {step3.phase === 'idle' && audResults.length === 0 && !step3Approved && gapResults.length > 0 && (
                <div style={{ padding: '14px', display: 'flex', alignItems: 'center', gap: 10 }}>
                  <span style={{ fontSize: 12, color: 'var(--text-3)', fontFamily: 'var(--font-mono)', flex: 1 }}>Ready to size the audience for {gapResults.length} candidates.</span>
                </div>
              )}
              {step3.phase === 'idle' && audResults.length === 0 && !step3Approved && gapResults.length === 0 && (
                <div style={{ padding: '14px' }}><button onClick={() => setCurrentView(2)} style={regenBtn}>← Go back to Step 2</button></div>
              )}
              {step3.phase === 'error' && (
                <div style={{ padding: '10px 14px' }}>
                  <button onClick={() => runStep3()} style={regenBtn}>↺ Retry Step 3</button>
                </div>
              )}
            </div>
          )}
        </div>

        {/* Footer */}
        <div style={{ padding: '14px 24px', borderTop: '1px solid var(--modal-border)', display: 'flex', alignItems: 'center', gap: 10, flexShrink: 0 }}>

          {/* Step 1 listo para correr */}
          {currentView === 1 && step1.phase === 'idle' && comparables.length === 0 && candidates.length > 0 && !step1Approved && (
            <>
              <div style={{ flex: 1, fontSize: 11, color: 'var(--text-3)', fontFamily: 'var(--font-mono)' }}>
                {isRunning ? 'Running — please wait…' : `${candidates.length} candidates ready`}
              </div>
              <button onClick={runStep1} disabled={isRunning} style={approveBtn(isRunning)}>Research →</button>
            </>
          )}

          {/* Step 1 done */}
          {currentView === 1 && step1.phase === 'done' && comparables.length > 0 && (
            <>
              <ForgyBtn onClick={() => setChatStep(1)} />
              <button onClick={runStep1} disabled={isRunning} style={{ ...regenBtn, cursor: isRunning ? 'not-allowed' : 'pointer', opacity: isRunning ? 0.5 : 1 }}>↺ Regen</button>
              <div style={{ flex: 1 }} />
              {gapResults.length > 0 && <button onClick={() => setCurrentView(2)} disabled={isRunning} style={{ ...regenBtn, cursor: isRunning ? 'not-allowed' : 'pointer', opacity: isRunning ? 0.5 : 1 }}>Step 2 →</button>}
              {!step1Approved && <button onClick={approveStep1} disabled={isRunning} style={approveBtn(isRunning)}>Approve Step →</button>}
            </>
          )}

          {/* Step 2 listo para correr */}
          {currentView === 2 && step2.phase === 'idle' && gapResults.length === 0 && comparables.length > 0 && !step2Approved && (
            <>
              <div style={{ flex: 1, fontSize: 11, color: 'var(--text-3)', fontFamily: 'var(--font-mono)' }}>
                {isRunning ? 'Running — please wait…' : ''}
              </div>
              <button onClick={() => runStep2()} disabled={isRunning} style={approveBtn(isRunning)}>Analyze Gaps →</button>
            </>
          )}

          {/* Step 2 done */}
          {currentView === 2 && step2.phase === 'done' && gapResults.length > 0 && (
            <>
              <ForgyBtn onClick={() => setChatStep(2)} />
              <button onClick={() => runStep2()} disabled={isRunning} style={{ ...regenBtn, cursor: isRunning ? 'not-allowed' : 'pointer', opacity: isRunning ? 0.5 : 1 }}>↺ Regen</button>
              <div style={{ flex: 1 }} />
              {audResults.length > 0 && <button onClick={() => setCurrentView(3)} disabled={isRunning} style={{ ...regenBtn, cursor: isRunning ? 'not-allowed' : 'pointer', opacity: isRunning ? 0.5 : 1 }}>Step 3 →</button>}
              {!step2Approved && <button onClick={approveStep2} disabled={isRunning} style={approveBtn(isRunning)}>Approve Step →</button>}
            </>
          )}

          {/* Step 3 listo para correr */}
          {currentView === 3 && step3.phase === 'idle' && audResults.length === 0 && gapResults.length > 0 && !step3Approved && (
            <>
              <div style={{ flex: 1, fontSize: 11, color: 'var(--text-3)', fontFamily: 'var(--font-mono)' }}>
                {isRunning ? 'Running — please wait…' : ''}
              </div>
              <button onClick={() => runStep3()} disabled={isRunning} style={approveBtn(isRunning)}>Size Audience →</button>
            </>
          )}

          {/* Step 3 done */}
          {currentView === 3 && step3.phase === 'done' && audResults.length > 0 && (
            <>
              <ForgyBtn onClick={() => setChatStep(3)} />
              <button onClick={() => runStep3()} disabled={isRunning} style={{ ...regenBtn, cursor: isRunning ? 'not-allowed' : 'pointer', opacity: isRunning ? 0.5 : 1 }}>↺ Regen</button>
              <div style={{ flex: 1 }} />
              {!step3Approved && <button onClick={approveStep3} disabled={isRunning} style={approveBtn(isRunning)}>Approve Step →</button>}
            </>
          )}

          {/* Estado running genérico */}
          {isRunning && (
            <div style={{ fontSize: 11, color: 'var(--text-3)', fontFamily: 'var(--font-mono)', flex: 1 }}>
              Running — please wait…
            </div>
          )}
        </div>
      </div>
    </>
  )
}
