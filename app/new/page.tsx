'use client'

import { useState, useRef } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { generateGDD, approveStep1, validateIdea } from '@/lib/api'
import type { GDD, GameFormData, ValidationResult } from '@/lib/types'
import GeneratingOverlay from '@/components/shared/GeneratingOverlay'
import GDDCanvas from '@/components/gdd/GDDCanvas'
import ApprovalBar from '@/components/shared/ApprovalBar'
import GameIdeaForm from '@/components/wizard/GameIdeaForm'
import ValidationResultView from '@/components/wizard/ValidationResult'

type State = 'form' | 'validating' | 'failed' | 'generating' | 'review'

export default function NewProjectPage() {
  const router = useRouter()
  const [state, setState]                   = useState<State>('form')
  const [formData, setFormData]             = useState<GameFormData | null>(null)
  const [enrichedPrompt, setEnrichedPrompt] = useState('')
  const [validationResult, setValidationResult] = useState<ValidationResult | null>(null)
  const [gdd, setGdd]     = useState<GDD | null>(null)
  const [meta, setMeta]   = useState<unknown>(null)
  const [error, setError] = useState<string | null>(null)
  const [approving, setApproving] = useState(false)
  const autoTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  function buildEnrichedPrompt(data: GameFormData): string {
    const parts = [data.prompt]
    if (data.genre)      parts.push(`Genre: ${data.genre}`)
    if (data.tone)       parts.push(`Visual tone: ${data.tone}`)
    if (data.audience)   parts.push(`Target audience: ${data.audience}`)
    if (data.scope)      parts.push(`Prototype scope: ${data.scope}`)
    if (data.engine)     parts.push(`Target engine: ${data.engine}`)
    if (data.references) parts.push(`References: ${data.references}`)
    return parts.join('\n')
  }

  async function generateGDDFlow(ep: string, fd: GameFormData) {
    setState('generating')
    setError(null)
    try {
      const result = await generateGDD(ep)
      if (result.async) {
        setError('El paso GDD está configurado como n8n (async). Usa el canvas de pipeline para crear el proyecto.')
        setState('form')
        return
      }
      setGdd(result.gdd)
      setMeta(result.meta)
      setEnrichedPrompt(ep)
      setState('review')
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Error generating GDD')
      setState('form')
    }
  }

  async function handleFormSubmit(data: GameFormData) {
    setFormData(data)
    setState('validating')
    const ep = buildEnrichedPrompt(data)
    setEnrichedPrompt(ep)
    try {
      const validation = await validateIdea({ prompt: data.prompt, genre: data.genre, tone: data.tone, audience: data.audience, scope: data.scope, engine: data.engine, references: data.references })
      setValidationResult(validation)
      if (validation.coherence_score >= 80) {
        await generateGDDFlow(ep, data)
      } else if (validation.coherence_score >= 60) {
        setState('failed')
        autoTimerRef.current = setTimeout(() => generateGDDFlow(ep, data), 2000)
      } else {
        setState('failed')
      }
    } catch {
      await generateGDDFlow(ep, data)
    }
  }

  function handleContinueAnyway() {
    if (autoTimerRef.current) clearTimeout(autoTimerRef.current)
    if (formData) generateGDDFlow(enrichedPrompt, formData)
  }

  function handleImprove() {
    if (autoTimerRef.current) clearTimeout(autoTimerRef.current)
    setState('form')
  }

  async function handleApprove() {
    if (!gdd || !formData) return
    setApproving(true)
    try {
      const res = await approveStep1({ project_id: '', gdd, prompt: enrichedPrompt, meta })
      router.push(`/projects/${res.project_id}`)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Error al aprobar')
      setApproving(false)
    }
  }

  /* ─── Shared top bar ─── */
  const TopBar = () => (
    <header style={{
      height: 44, display: 'flex', alignItems: 'center', padding: '0 24px',
      borderBottom: '1px solid var(--line)', background: 'var(--bg-1)',
      position: 'sticky', top: 0, zIndex: 30,
    }}>
      <Link href="/" className="forge-logo">
        <svg width="18" height="18" viewBox="0 0 32 32" aria-hidden="true">
          <path d="M16 4 L26 14 L26 22 L20 28 L12 28 L6 22 L6 14 Z" fill="#ff8a3d" stroke="#1a0d04" strokeWidth="0.5"/>
          <path d="M16 10 L22 16 L22 21 L18 25 L14 25 L10 21 L10 16 Z" fill="#ffe7d4" opacity="0.85"/>
        </svg>
        <span className="forge-logo-wordmark" style={{ fontSize: 13 }}>Forge</span>
      </Link>
      <span style={{ margin: '0 10px', color: 'var(--line-2)' }}>/</span>
      <span style={{ fontSize: 12, color: 'var(--text-3)', fontFamily: 'monospace' }}>new game</span>
    </header>
  )

  /* ─── Error banner ─── */
  const ErrorBanner = () => error ? (
    <div style={{
      margin: '0 auto 20px', maxWidth: 680,
      padding: '8px 12px', borderRadius: 5,
      background: 'color-mix(in oklch, var(--state-error) 8%, var(--bg-1))',
      border: '1px solid color-mix(in oklch, var(--state-error) 25%, transparent)',
      fontSize: 12, color: 'var(--state-error)', fontFamily: 'monospace',
    }}>{error}</div>
  ) : null

  /* ─── Form / Validating ─── */
  if (state === 'form' || state === 'validating') {
    return (
      <div style={{ minHeight: '100vh', background: 'var(--bg-0)' }}>
        <TopBar />
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', padding: '48px 24px' }}>
          <h1 style={{ fontSize: 22, fontWeight: 700, color: 'var(--text-0)', textAlign: 'center', marginBottom: 32, maxWidth: 560, letterSpacing: '-0.01em', lineHeight: 1.35 }}>
            What game idea will we build today?
          </h1>
          <ErrorBanner />
          <GameIdeaForm
            onSubmit={handleFormSubmit}
            loading={state === 'validating'}
            initialData={formData ?? undefined}
          />
        </div>
      </div>
    )
  }

  /* ─── Generating ─── */
  if (state === 'generating') {
    return (
      <div style={{ minHeight: '100vh', background: 'var(--bg-0)' }}>
        <TopBar />
        <GeneratingOverlay step={1} />
      </div>
    )
  }

  /* ─── Validation failed ─── */
  if (state === 'failed' && validationResult) {
    return (
      <div style={{ minHeight: '100vh', background: 'var(--bg-0)' }}>
        <TopBar />
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', padding: '48px 24px' }}>
          <h2 style={{ fontSize: 18, fontWeight: 600, color: 'var(--text-0)', marginBottom: 24 }}>
            Let&apos;s review your idea
          </h2>
          <ValidationResultView
            validation={validationResult}
            onImprove={handleImprove}
            onContinueAnyway={handleContinueAnyway}
          />
        </div>
      </div>
    )
  }

  /* ─── GDD Review ─── */
  if (state === 'review' && gdd) {
    return (
      <div style={{ minHeight: '100vh', background: 'var(--bg-0)' }}>
        <TopBar />
        <main style={{ maxWidth: 1100, margin: '0 auto', padding: '32px 24px 120px' }}>
          {error && <ErrorBanner />}
          <GDDCanvas gdd={gdd} />
        </main>
        <ApprovalBar
          onRegenerate={() => { setState('form'); setGdd(null); setValidationResult(null) }}
          onApprove={handleApprove}
          approveDisabled={approving}
          approveLabel={approving ? 'Saving…' : 'Approve & continue →'}
          centerText={`${gdd.project.name} · ${gdd.project.genre}`}
        />
      </div>
    )
  }

  return null
}
