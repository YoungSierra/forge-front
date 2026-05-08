'use client'

import { useEffect, useRef, useState } from 'react'
import type { Project } from '@/lib/types'
import type { PipelineSuggestion, PipelineCatalogEntry } from '@/lib/api'
import { suggestPipeline, savePipelineConfig } from '@/lib/api'

// Nodos que siempre están activos — no se pueden desactivar
const REQUIRED_NODES = new Set(['gdd', 'export'])

// Etiquetas de fase para mostrar en el modal
const PHASE_LABELS: Record<string, string> = {
  concept:    'Concept',
  characters: 'Characters',
  world:      'World',
  production: 'Production',
}

const PHASE_ORDER = ['concept', 'characters', 'world', 'production']

interface Props {
  project:    Project
  onConfirm:  (activeNodes: string[]) => void
  onSkip:     () => void
}

export default function PipelineSuggestionModal({ project, onConfirm, onSkip }: Props) {
  const [suggestions, setSuggestions] = useState<PipelineSuggestion[]>([])
  const [catalog,     setCatalog]     = useState<PipelineCatalogEntry[]>([])
  const [active,      setActive]      = useState<Set<string>>(new Set())
  const [loading,     setLoading]     = useState(true)
  const [fromCache,   setFromCache]   = useState(false)
  const [reanalyzing, setReanalyzing] = useState(false)
  const [saving,      setSaving]      = useState(false)
  const [error,       setError]       = useState<string | null>(null)
  // Guard contra la doble ejecución de React 18 Strict Mode en desarrollo
  const fetchedRef = useRef(false)

  useEffect(() => {
    if (fetchedRef.current) return
    fetchedRef.current = true
    suggestPipeline(project.id)
      .then(({ suggestions: s, catalog: c, from_cache }) => {
        setSuggestions(s)
        setCatalog(c)
        setFromCache(!!from_cache)
        const initialActive = new Set(s.filter(n => n.active).map(n => n.nodeId))
        setActive(initialActive)
      })
      .catch(e => setError(e instanceof Error ? e.message : 'Failed to load suggestions'))
      .finally(() => setLoading(false))
  }, [project.id])

  async function handleReanalyze() {
    setReanalyzing(true)
    setError(null)
    try {
      const { suggestions: s, catalog: c } = await suggestPipeline(project.id, true)
      setSuggestions(s)
      setCatalog(c)
      setFromCache(false)
      const initialActive = new Set(s.filter(n => n.active).map(n => n.nodeId))
      setActive(initialActive)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to re-analyze')
    } finally {
      setReanalyzing(false)
    }
  }

  // Cerrar con Escape
  useEffect(() => {
    function onKey(e: KeyboardEvent) { if (e.key === 'Escape') onSkip() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onSkip])

  function toggle(nodeId: string) {
    if (REQUIRED_NODES.has(nodeId)) return
    setActive(prev => {
      const next = new Set(prev)
      next.has(nodeId) ? next.delete(nodeId) : next.add(nodeId)
      return next
    })
  }

  async function handleConfirm() {
    setSaving(true)
    try {
      const activeNodes = Array.from(active)
      await savePipelineConfig(project.id, activeNodes)
      onConfirm(activeNodes)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to save pipeline config')
      setSaving(false)
    }
  }

  // Agrupar catálogo por fase
  const byPhase = PHASE_ORDER.reduce<Record<string, PipelineCatalogEntry[]>>((acc, phase) => {
    acc[phase] = catalog.filter(n => n.phase === phase)
    return acc
  }, {})

  // Buscar razón de la IA para un nodo
  const reasonFor = (nodeId: string) =>
    suggestions.find(s => s.nodeId === nodeId)?.reason ?? ''

  const activeCount = active.size

  return (
    <div
      style={{
        position: 'fixed', inset: 0, zIndex: 1100,
        background: 'rgba(0,0,0,0.75)', backdropFilter: 'blur(6px)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        padding: 24,
      }}
    >
      <div style={{
        width: '100%', maxWidth: 680,
        maxHeight: '90vh',
        background: 'var(--bg-1)',
        border: '1px solid var(--line-2)',
        borderRadius: 14,
        display: 'flex', flexDirection: 'column',
        boxShadow: '0 32px 80px rgba(0,0,0,0.6)',
        overflow: 'hidden',
      }}>

        {/* Cabecera */}
        <div style={{ padding: '18px 24px', borderBottom: '1px solid var(--line-2)', flexShrink: 0 }}>
          <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12 }}>
            <div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 4 }}>
                <div style={{ fontSize: 11, fontFamily: 'var(--font-mono)', color: 'var(--cat-code)', textTransform: 'uppercase', letterSpacing: '0.1em' }}>
                  ✦ {fromCache ? 'Saved pipeline config' : 'AI-suggested pipeline'}
                </div>
                {fromCache && (
                  <>
                    <style>{`@keyframes btn-spin { to { transform: rotate(360deg); } }`}</style>
                    <button
                      onClick={!reanalyzing ? handleReanalyze : undefined}
                      disabled={reanalyzing}
                      style={{
                        fontSize: 10, fontFamily: 'var(--font-mono)',
                        color: reanalyzing ? 'var(--cat-code)' : 'var(--text-3)',
                        background: reanalyzing ? 'color-mix(in oklch, var(--cat-code) 12%, var(--bg-2))' : 'var(--bg-3)',
                        border: `1px solid ${reanalyzing ? 'color-mix(in oklch, var(--cat-code) 35%, transparent)' : 'var(--line-2)'}`,
                        borderRadius: 4, padding: '2px 8px',
                        cursor: reanalyzing ? 'default' : 'pointer',
                        display: 'inline-flex', alignItems: 'center', gap: 5,
                        transition: 'all 150ms',
                      }}
                      onMouseEnter={e => { if (!reanalyzing) e.currentTarget.style.color = 'var(--text-1)' }}
                      onMouseLeave={e => { if (!reanalyzing) e.currentTarget.style.color = 'var(--text-3)' }}
                    >
                      {reanalyzing ? (
                        <>
                          <span style={{
                            display: 'inline-block', width: 8, height: 8, borderRadius: '50%',
                            border: '1.5px solid var(--cat-code)', borderTopColor: 'transparent',
                            animation: 'btn-spin 0.7s linear infinite', flexShrink: 0,
                          }} />
                          Analyzing…
                        </>
                      ) : '↺ Re-analyze'}
                    </button>
                  </>
                )}
              </div>
              <div style={{ fontSize: 16, fontWeight: 700, color: 'var(--text-0)' }}>
                {project.name}
              </div>
              <div style={{ fontSize: 11, color: 'var(--text-3)', fontFamily: 'var(--font-mono)', marginTop: 2 }}>
                {fromCache ? 'Showing your saved configuration — adjust as needed' : 'AI analyzed your GDD and suggests these production steps'}
              </div>
            </div>
            <button
              onClick={onSkip}
              style={{ background: 'var(--bg-3)', border: '1px solid var(--line-2)', borderRadius: 6, width: 28, height: 28, display: 'grid', placeItems: 'center', cursor: 'pointer', color: 'var(--text-2)', fontSize: 16, flexShrink: 0 }}
            >✕</button>
          </div>
        </div>

        {/* Cuerpo */}
        <div style={{ flex: 1, overflowY: 'auto', padding: '20px 24px', display: 'flex', flexDirection: 'column', gap: 24 }}>

          {loading && (
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 12, padding: '40px 0' }}>
              <div style={{
                width: 28, height: 28,
                background: 'conic-gradient(from 45deg, var(--cat-asset), var(--cat-code), var(--cat-audio), var(--cat-gate), var(--cat-asset))',
                clipPath: 'polygon(50% 0,100% 50%,50% 100%,0 50%)',
                animation: 'spin 1.2s linear infinite',
              }} />
              <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
              <span style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--text-3)' }}>
                Analyzing GDD…
              </span>
            </div>
          )}

          {error && (
            <div style={{ fontSize: 11, fontFamily: 'var(--font-mono)', color: 'var(--cat-output)', background: 'color-mix(in oklch, var(--cat-output) 10%, var(--bg-2))', padding: '10px 14px', borderRadius: 6 }}>
              {error}
            </div>
          )}

          {!loading && !error && PHASE_ORDER.map(phase => {
            const nodes = byPhase[phase]
            if (!nodes?.length) return null
            return (
              <div key={phase}>
                {/* Título de fase */}
                <div style={{ fontFamily: 'var(--font-mono)', fontSize: 10, textTransform: 'uppercase', letterSpacing: '0.1em', color: 'var(--text-3)', borderBottom: '1px solid var(--line)', paddingBottom: 6, marginBottom: 10 }}>
                  {PHASE_LABELS[phase] ?? phase}
                </div>

                <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                  {nodes.map(node => {
                    const isRequired = REQUIRED_NODES.has(node.nodeId)
                    const isActive   = isRequired || active.has(node.nodeId)
                    const reason     = reasonFor(node.nodeId)

                    return (
                      <div
                        key={node.nodeId}
                        onClick={() => toggle(node.nodeId)}
                        style={{
                          display: 'flex', alignItems: 'flex-start', gap: 12,
                          padding: '10px 12px', borderRadius: 8,
                          background: isActive ? 'color-mix(in oklch, var(--cat-code) 8%, var(--bg-2))' : 'var(--bg-2)',
                          border: `1px solid ${isActive ? 'color-mix(in oklch, var(--cat-code) 30%, transparent)' : 'var(--line-2)'}`,
                          cursor: isRequired ? 'default' : 'pointer',
                          transition: 'all 100ms',
                          opacity: isRequired ? 0.75 : 1,
                        }}
                        onMouseEnter={e => { if (!isRequired) (e.currentTarget as HTMLDivElement).style.borderColor = 'var(--line)' }}
                        onMouseLeave={e => { if (!isRequired) (e.currentTarget as HTMLDivElement).style.borderColor = isActive ? 'color-mix(in oklch, var(--cat-code) 30%, transparent)' : 'var(--line-2)' }}
                      >
                        {/* Toggle visual */}
                        <div style={{
                          width: 18, height: 18, borderRadius: 4, flexShrink: 0, marginTop: 1,
                          background: isActive ? 'var(--cat-code)' : 'var(--bg-3)',
                          border: `1px solid ${isActive ? 'var(--cat-code)' : 'var(--line-2)'}`,
                          display: 'grid', placeItems: 'center',
                          fontSize: 11, color: '#0a0a0c', fontWeight: 700,
                          transition: 'all 100ms',
                        }}>
                          {isActive ? '✓' : ''}
                        </div>

                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 2 }}>
                            <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-0)' }}>
                              {node.label}
                            </span>
                            {isRequired && (
                              <span style={{ fontSize: 9, fontFamily: 'var(--font-mono)', color: 'var(--text-3)', background: 'var(--bg-3)', padding: '1px 6px', borderRadius: 99 }}>
                                required
                              </span>
                            )}
                          </div>
                          <div style={{ fontSize: 10, fontFamily: 'var(--font-mono)', color: 'var(--text-3)', lineHeight: 1.5 }}>
                            {node.description}
                          </div>
                          {/* Razón de la IA */}
                          {reason && (
                            <div style={{ fontSize: 10, fontFamily: 'var(--font-mono)', color: 'var(--cat-code)', marginTop: 4, opacity: 0.8 }}>
                              ✦ {reason}
                            </div>
                          )}
                        </div>
                      </div>
                    )
                  })}
                </div>
              </div>
            )
          })}
        </div>

        {/* Pie */}
        {!loading && (
          <div style={{
            padding: '14px 24px', borderTop: '1px solid var(--line-2)',
            display: 'flex', alignItems: 'center', justifyContent: 'space-between',
            flexShrink: 0, gap: 12,
          }}>
            <span style={{ fontSize: 11, fontFamily: 'var(--font-mono)', color: 'var(--text-3)' }}>
              {activeCount} node{activeCount !== 1 ? 's' : ''} active
            </span>
            <div style={{ display: 'flex', gap: 8 }}>
              <button
                onClick={onSkip}
                style={{ padding: '7px 16px', borderRadius: 6, border: '1px solid var(--line-2)', background: 'none', cursor: 'pointer', fontSize: 11, fontFamily: 'var(--font-mono)', color: 'var(--text-2)' }}
              >
                Use all nodes
              </button>
              <button
                onClick={handleConfirm}
                disabled={saving}
                style={{ padding: '7px 20px', borderRadius: 6, border: 'none', cursor: saving ? 'not-allowed' : 'pointer', background: 'var(--cat-code)', color: '#0a0a0c', fontSize: 11, fontFamily: 'var(--font-mono)', fontWeight: 700, opacity: saving ? 0.7 : 1 }}
              >
                {saving ? 'Saving…' : 'Apply pipeline →'}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
