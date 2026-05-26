'use client'

import React, { useState, useEffect, useCallback, useRef } from 'react'
import type { ActionInstance } from '@/lib/types'
import { runActionInstance } from '@/lib/api'

const ACTION_ICON: Record<string, string> = {
  'docx':          '📄',
  'pptx':          '📊',
  'pdf':           '📑',
  'artefact-html': '🌐',
  'pitch-deck':    '🎯',
  'one-pager':     '📋',
  'social-kit':    '📢',
  'press-release': '📰',
  'spreadsheet':   '🗂️',
  'email-draft':   '✉️',
  'wiki-starter':  '📚',
}

const STATUS_COLOR: Record<string, string> = {
  pending: '#6b7280',
  running: '#FBBF24',
  done:    '#2DD4BF',
  error:   '#F87171',
}

const LOG_STEPS: Record<string, { ms: number; text: string }[]> = {
  pptx: [
    { ms: 1000,  text: '→ Sending slide structure request to LLM…' },
    { ms: 4000,  text: '→ Waiting for JSON response…' },
    { ms: 9000,  text: '→ Parsing slide data…' },
    { ms: 11000, text: '→ Rendering slides with Forge brand…' },
    { ms: 13000, text: '→ Uploading presentation file…' },
  ],
  default: [
    { ms: 1000, text: '→ Sending request to LLM…' },
    { ms: 4000, text: '→ Waiting for response…' },
    { ms: 9000, text: '→ Still processing — large output…' },
  ],
}

const MODAL_ANIM = `
@keyframes prog    { 0%{background-position:0% 50%} 100%{background-position:200% 50%} }
@keyframes fadein  { from{opacity:0;transform:translateY(4px)} to{opacity:1;transform:translateY(0)} }
@keyframes blink   { 0%,100%{opacity:1} 50%{opacity:0} }
`

interface Props {
  instance:      ActionInstance
  sourceLabel:   string
  actionLabel:   string
  projectId:     string
  autoRun?:      boolean
  onClose:       () => void
  onRunComplete: () => void
}

export default function ActionModal({
  instance, sourceLabel, actionLabel, projectId, autoRun, onClose, onRunComplete,
}: Props) {
  const [status,      setStatus]      = useState(instance.status)
  const [artifactUrl, setArtifactUrl] = useState(instance.artifact_url)
  const [generatedAt, setGeneratedAt] = useState(instance.generated_at)
  const [content,     setContent]     = useState<string | null>(null)
  const [loading,     setLoading]     = useState(false)
  const [error,       setError]       = useState('')
  const [elapsed,     setElapsed]     = useState(0)
  const [logLines,    setLogLines]    = useState<string[]>([])

  const autoRunFired = useRef(false)
  const startTime    = useRef<number>(0)
  const elapsedTimer = useRef<ReturnType<typeof setInterval> | null>(null)
  const logTimers    = useRef<ReturnType<typeof setTimeout>[]>([])

  const isHtml = instance.action_type === 'artefact-html'
  const isPdf  = instance.action_type === 'pdf' || instance.action_type === 'one-pager'
  const isPptx = instance.action_type === 'pptx'
  const icon   = ACTION_ICON[instance.action_type] ?? '⚡'

  // Carga contenido del artefacto para tipos de texto plano
  useEffect(() => {
    if (!artifactUrl || isHtml || isPdf || isPptx) return
    fetch(artifactUrl)
      .then(r => r.text())
      .then(setContent)
      .catch(() => setContent(null))
  }, [artifactUrl, isHtml])

  const stopTimers = useCallback(() => {
    if (elapsedTimer.current) { clearInterval(elapsedTimer.current); elapsedTimer.current = null }
    logTimers.current.forEach(clearTimeout)
    logTimers.current = []
  }, [])

  const startTimers = useCallback((actionType: string) => {
    stopTimers()
    startTime.current = Date.now()
    setElapsed(0)
    // Primera línea sincrónica — sin setTimeout, aparece de inmediato
    setLogLines(['→ Reading source node output…'])
    elapsedTimer.current = setInterval(() => {
      setElapsed(Math.floor((Date.now() - startTime.current) / 1000))
    }, 500)
    const steps = LOG_STEPS[actionType] ?? LOG_STEPS.default
    logTimers.current = steps.map(({ ms, text }) =>
      setTimeout(() => setLogLines(prev => [...prev, text]), ms)
    )
  }, [stopTimers])

  const handleRun = useCallback(async () => {
    setLoading(true)
    setError('')
    setStatus('running')
    startTimers(instance.action_type)
    try {
      const result = await runActionInstance(projectId, instance.id)
      stopTimers()
      setLogLines(prev => [...prev, '✓ Done — artifact saved.'])
      setStatus('done')
      setArtifactUrl(result.artifact_url)
      setGeneratedAt(new Date().toISOString())
      onRunComplete()
    } catch (err) {
      stopTimers()
      setLogLines(prev => [...prev, '✗ Error — see message below.'])
      setStatus('error')
      setError(err instanceof Error ? err.message : 'Run failed')
    } finally {
      setLoading(false)
    }
  }, [projectId, instance.id, onRunComplete, startTimers, stopTimers])

  // Auto-ejecuta al abrir — ref guard evita doble disparo en StrictMode
  useEffect(() => {
    if (autoRun && !autoRunFired.current) {
      autoRunFired.current = true
      handleRun()
    }
    return stopTimers
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const handleCopy = useCallback(() => {
    if (content) navigator.clipboard.writeText(content).catch(() => {})
  }, [content])

  const statusColor = STATUS_COLOR[status] ?? '#6b7280'

  return (
    <div
      style={{
        position: 'fixed', inset: 0, zIndex: 80,
        background: 'rgba(0,0,0,0.55)', backdropFilter: 'blur(4px)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
      }}
      onClick={e => { if (e.target === e.currentTarget) onClose() }}
    >
      <style>{MODAL_ANIM}</style>

      <div style={{
        width: '90%', maxWidth: 720,
        maxHeight: '88vh',
        background: 'var(--bg-1)',
        border: `1px solid ${status === 'running' ? 'color-mix(in oklch, var(--action) 50%, var(--line-2))' : 'var(--line-2)'}`,
        borderRadius: 16,
        display: 'flex', flexDirection: 'column',
        boxShadow: '0 24px 80px rgba(0,0,0,0.5)',
        overflow: 'hidden',
        transition: 'border-color 300ms',
      }}>

        {/* Barra de progreso animada — solo en running */}
        <div style={{ height: 3, flexShrink: 0, background: 'var(--bg-3)', position: 'relative' }}>
          {status === 'running' && (
            <div style={{
              position: 'absolute', inset: 0,
              backgroundImage: 'linear-gradient(90deg, transparent, var(--action), var(--action-hover, #f06a18), var(--action), transparent)',
              backgroundSize: '200% 100%',
              animation: 'prog 1.5s linear infinite',
            }} />
          )}
          {status === 'done' && (
            <div style={{ position: 'absolute', inset: 0, background: '#2DD4BF' }} />
          )}
          {status === 'error' && (
            <div style={{ position: 'absolute', inset: 0, background: '#F87171' }} />
          )}
        </div>

        {/* Header */}
        <div style={{
          flexShrink: 0,
          padding: '14px 20px',
          borderBottom: '1px solid var(--line-2)',
          display: 'flex', alignItems: 'center', gap: 12,
        }}>
          <span style={{ fontSize: 20, lineHeight: 1 }}>{icon}</span>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 13, fontWeight: 700, fontFamily: 'var(--font-mono)', color: 'var(--text-0)' }}>
              {actionLabel}
            </div>
            <div style={{ fontSize: 10, fontFamily: 'var(--font-mono)', color: 'var(--text-3)', marginTop: 2 }}>
              Source: <span style={{ color: 'var(--text-1)' }}>{sourceLabel}</span>
              {' · '}
              <span style={{ color: 'var(--text-3)' }}>{instance.action_type}</span>
              {status === 'running' && (
                <span style={{ color: 'var(--action)', marginLeft: 8 }}>
                  {elapsed}s — processing
                </span>
              )}
            </div>
          </div>

          <span style={{
            fontSize: 9, fontFamily: 'var(--font-mono)', fontWeight: 700,
            padding: '3px 9px', borderRadius: 99,
            background: `color-mix(in srgb, ${statusColor} 14%, var(--bg-2))`,
            color: statusColor, textTransform: 'uppercase', letterSpacing: '0.08em',
          }}>
            {status === 'running' ? 'running…' : status}
          </span>

          <button
            onClick={onClose}
            style={{
              border: 'none', background: 'var(--bg-3)', borderRadius: 6,
              color: 'var(--text-2)', cursor: 'pointer', padding: '5px 10px',
              fontSize: 12, fontFamily: 'var(--font-mono)',
            }}
          >
            ✕
          </button>
        </div>

        {/* Body */}
        <div style={{ flex: 1, overflowY: 'auto', padding: 20, display: 'flex', flexDirection: 'column', gap: 14 }}>

          {/* Estado pending */}
          {status === 'pending' && (
            <div style={{
              padding: 16, borderRadius: 10, border: '1px dashed var(--line-2)',
              background: 'var(--bg-2)', textAlign: 'center',
            }}>
              <div style={{ fontSize: 13, fontFamily: 'var(--font-mono)', color: 'var(--text-2)', marginBottom: 6 }}>
                Ready to generate
              </div>
              <div style={{ fontSize: 11, fontFamily: 'var(--font-mono)', color: 'var(--text-3)' }}>
                Will process output of <strong style={{ color: 'var(--text-1)' }}>{sourceLabel}</strong> and produce a <strong style={{ color: 'var(--text-1)' }}>{instance.action_type}</strong> artifact.
              </div>
            </div>
          )}

          {/* Log de proceso — visible en running y después */}
          {logLines.length > 0 && (
            <div style={{
              background: 'var(--bg-0, #0d0f14)',
              border: '1px solid var(--line-2)',
              borderRadius: 8, padding: '10px 14px',
              display: 'flex', flexDirection: 'column', gap: 4,
            }}>
              {logLines.map((line, i) => (
                <div
                  key={i}
                  style={{
                    fontSize: 10.5, fontFamily: 'var(--font-mono)',
                    color: line.startsWith('✓') ? '#2DD4BF' : line.startsWith('✗') ? '#F87171' : 'var(--text-2)',
                    animation: 'fadein 250ms ease both',
                  }}
                >
                  {line}
                </div>
              ))}
              {status === 'running' && (
                <div style={{
                  fontSize: 12, fontFamily: 'var(--font-mono)',
                  color: 'var(--action)', marginTop: 2,
                  animation: 'blink 1s step-start infinite',
                }}>
                  ▌
                </div>
              )}
            </div>
          )}

          {/* Error */}
          {status === 'error' && (
            <div style={{
              padding: 14, borderRadius: 8,
              background: 'color-mix(in srgb, #F87171 10%, var(--bg-2))',
              border: '1px solid color-mix(in srgb, #F87171 30%, var(--line-2))',
              fontSize: 11, fontFamily: 'var(--font-mono)', color: '#F87171',
            }}>
              {error || 'An error occurred. Try running again.'}
            </div>
          )}

          {/* Content preview */}
          {status === 'done' && artifactUrl && (
            <>
              {isHtml ? (
                <iframe
                  src={artifactUrl}
                  style={{
                    width: '100%', height: 420,
                    border: '1px solid var(--line-2)',
                    borderRadius: 8, background: '#fff',
                  }}
                  sandbox="allow-scripts allow-same-origin"
                  title="HTML artifact preview"
                />
              ) : isPdf ? (
                <iframe
                  src={artifactUrl}
                  style={{
                    width: '100%', height: 480,
                    border: '1px solid var(--line-2)',
                    borderRadius: 8, background: '#0d0f14',
                  }}
                  title="PDF preview"
                />
              ) : isPptx ? (
                <div style={{
                  padding: 28, borderRadius: 10,
                  background: 'linear-gradient(135deg, #0d0f14 0%, #181c24 100%)',
                  border: '1px solid color-mix(in oklch, var(--action) 30%, var(--line-2))',
                  display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 12,
                  textAlign: 'center',
                }}>
                  <div style={{ fontSize: 36 }}>📊</div>
                  <div style={{ fontSize: 13, fontWeight: 700, fontFamily: 'var(--font-mono)', color: 'var(--text-0)' }}>
                    Presentation ready
                  </div>
                  <div style={{ fontSize: 11, fontFamily: 'var(--font-mono)', color: 'var(--text-3)', maxWidth: 340 }}>
                    Your PPTX file has been generated with Forge brand styling. Open it in PowerPoint or Google Slides.
                  </div>
                  <a
                    href={artifactUrl}
                    download
                    target="_blank"
                    rel="noreferrer"
                    style={{
                      marginTop: 4,
                      padding: '9px 22px', borderRadius: 8,
                      background: 'var(--action)', color: 'var(--action-fg)',
                      fontSize: 12, fontFamily: 'var(--font-mono)', fontWeight: 700,
                      textDecoration: 'none', display: 'inline-block',
                    }}
                  >
                    Download PPTX
                  </a>
                </div>
              ) : (
                <div style={{
                  flex: 1, minHeight: 0,
                  background: 'var(--bg-0, var(--bg-2))',
                  border: '1px solid var(--line-2)',
                  borderRadius: 8, overflow: 'auto',
                  padding: '12px 14px',
                }}>
                  <pre style={{
                    margin: 0, fontSize: 11, lineHeight: 1.7,
                    fontFamily: 'var(--font-mono)', color: 'var(--text-1)',
                    whiteSpace: 'pre-wrap', wordBreak: 'break-word',
                  }}>
                    {content ?? '— loading content —'}
                  </pre>
                </div>
              )}

              {generatedAt && (
                <div style={{ fontSize: 9, fontFamily: 'var(--font-mono)', color: 'var(--text-4)', textAlign: 'right' }}>
                  Generated {new Date(generatedAt).toLocaleString()}
                </div>
              )}
            </>
          )}
        </div>

        {/* Footer */}
        <div style={{
          flexShrink: 0,
          padding: '12px 20px',
          borderTop: '1px solid var(--line-2)',
          display: 'flex', alignItems: 'center', gap: 8,
          background: 'var(--bg-1)',
        }}>
          <div style={{ flex: 1 }} />

          {status === 'done' && !isHtml && !isPptx && content && (
            <button
              onClick={handleCopy}
              style={{
                padding: '7px 14px', borderRadius: 7,
                border: '1px solid var(--line-2)',
                background: 'var(--bg-2)', color: 'var(--text-1)',
                fontSize: 11, fontFamily: 'var(--font-mono)', cursor: 'pointer',
              }}
            >
              Copy
            </button>
          )}

          {status === 'done' && artifactUrl && !isPptx && !isHtml && (
            <a
              href={artifactUrl}
              download
              target="_blank"
              rel="noreferrer"
              style={{
                padding: '7px 14px', borderRadius: 7,
                border: '1px solid var(--line-2)',
                background: 'var(--bg-2)', color: 'var(--text-1)',
                fontSize: 11, fontFamily: 'var(--font-mono)',
                textDecoration: 'none', display: 'inline-block',
              }}
            >
              Download
            </a>
          )}

          <button
            onClick={handleRun}
            disabled={loading || status === 'running'}
            style={{
              padding: '7px 16px', borderRadius: 7,
              border: 'none',
              background: loading || status === 'running' ? 'var(--bg-3)' : 'var(--action)',
              color: loading || status === 'running' ? 'var(--text-3)' : 'var(--action-fg)',
              fontSize: 11, fontFamily: 'var(--font-mono)', fontWeight: 700,
              cursor: loading || status === 'running' ? 'not-allowed' : 'pointer',
              opacity: loading || status === 'running' ? 0.6 : 1,
            }}
          >
            {loading ? 'Running…' : status === 'done' ? 'Re-run' : 'Run'}
          </button>
        </div>
      </div>
    </div>
  )
}
