'use client'

import { useState, useEffect, useCallback, useRef } from 'react'
import type { Project, ModelingCharacterStatus } from '@/lib/types'
import {
  getModelingCharactersStatus,
  generateModelingCharacter,
  approveModelingCharacter,
  approveModelingCharactersNode,
} from '@/lib/api'
import ModelViewer from '@/components/shared/ModelViewer'

interface Props {
  project:    Project
  onClose:    () => void
  onApproved?: () => void
}

const STATUS_COLOR: Record<string, string> = {
  empty:     'var(--text-3)',
  generated: 'var(--cat-asset)',
  approved:  'var(--cat-code)',
}

export default function ModelingCharactersModal({ project, onClose, onApproved }: Props) {
  const [chars,         setChars]         = useState<ModelingCharacterStatus[]>([])
  const [selected,      setSelected]      = useState<string | null>(null)
  const [loading,       setLoading]       = useState(true)
  const [generating,    setGenerating]    = useState(false)
  const [approving,     setApproving]     = useState(false)
  const [approvingNode, setApprovingNode] = useState(false)
  const [error,         setError]         = useState<string | null>(null)
  const [freshGlb,      setFreshGlb]      = useState<string | null>(null)
  const [fakeProgress,  setFakeProgress]  = useState(0)
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null)

  useEffect(() => {
    if (!generating) {
      if (intervalRef.current) clearInterval(intervalRef.current)
      if (freshGlb !== null) setFakeProgress(100)
      return
    }
    setFakeProgress(0)
    intervalRef.current = setInterval(() => {
      setFakeProgress(prev => {
        if (prev >= 88) return prev
        const step = prev < 30 ? 2.5 : prev < 60 ? 0.9 : 0.35
        return Math.min(88, prev + step)
      })
    }, 300)
    return () => { if (intervalRef.current) clearInterval(intervalRef.current) }
  }, [generating, freshGlb])

  const loadStatus = useCallback(async () => {
    try {
      const res = await getModelingCharactersStatus(project.id)
      setChars(res)
      if (!selected && res.length > 0) setSelected(res[0].character_key)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Error loading status')
    } finally { setLoading(false) }
  }, [project.id, selected])

  useEffect(() => { loadStatus() }, [loadStatus])

  async function handleGenerate() {
    if (!selected || generating) return
    setGenerating(true); setError(null); setFreshGlb(null); setFakeProgress(0)
    try {
      const res = await generateModelingCharacter(project.id, selected)
      setFreshGlb(res.glb_url ?? null)
      await loadStatus()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Error generating')
    } finally { setGenerating(false) }
  }

  async function handleApprove() {
    if (!selected || approving) return
    setApproving(true); setError(null)
    try {
      await approveModelingCharacter(project.id, selected)
      await loadStatus()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Error approving')
    } finally { setApproving(false) }
  }

  async function handleApproveNode() {
    setApprovingNode(true); setError(null)
    try {
      await approveModelingCharactersNode(project.id)
      onApproved?.()
      onClose()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Error approving node')
    } finally { setApprovingNode(false) }
  }

  const charByKey   = Object.fromEntries(chars.map(c => [c.character_key, c]))
  const cur         = selected ? charByKey[selected] : null
  const glbUrl      = freshGlb ?? cur?.current_version_3d?.storage_url ?? null
  const isGlb       = glbUrl ? /\.glb(b)?$/i.test(glbUrl) : false
  const nodeApproved = !!((project.concept?.pipeline?.modeling_characters as Record<string, unknown> | undefined)?.approved)
  const allApproved  = chars.length > 0 && chars.every(c => c.status_3d === 'approved')

  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 1000, background: 'rgba(0,0,0,0.72)', backdropFilter: 'blur(4px)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24 }}>
      <div
        onClick={e => e.stopPropagation()}
        style={{ width: '100%', maxWidth: 1100, height: '86vh', background: 'var(--bg-1)', border: '1px solid var(--line-2)', borderRadius: 12, display: 'flex', flexDirection: 'column', boxShadow: '0 32px 80px rgba(0,0,0,0.6)', overflow: 'hidden' }}
      >
        {/* Header */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '14px 20px', borderBottom: '1px solid var(--line)', flexShrink: 0 }}>
          <div style={{ flex: 1 }}>
            <div style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color: 'var(--text-3)', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 2 }}>Modeling</div>
            <div style={{ fontSize: 15, fontWeight: 600, color: 'var(--text-0)' }}>
              Character 3D Models
              {nodeApproved && <span style={{ marginLeft: 10, fontSize: 11, fontFamily: 'var(--font-mono)', color: 'var(--cat-code)' }}>✓ Node approved</span>}
            </div>
          </div>
          <div style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color: 'var(--text-3)' }}>
            {chars.filter(c => c.status_3d === 'approved').length}/{chars.length} approved
          </div>
          <div style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color: 'var(--text-3)', marginLeft: 8 }}>{project.name}</div>
          <button
            onClick={onClose}
            style={{ background: 'var(--bg-3)', border: '1px solid var(--line-2)', borderRadius: 6, width: 28, height: 28, display: 'grid', placeItems: 'center', cursor: 'pointer', color: 'var(--text-2)', fontSize: 16 }}
            onMouseEnter={e => { (e.currentTarget as HTMLButtonElement).style.background = 'var(--bg-4)'; (e.currentTarget as HTMLButtonElement).style.color = 'var(--text-0)' }}
            onMouseLeave={e => { (e.currentTarget as HTMLButtonElement).style.background = 'var(--bg-3)'; (e.currentTarget as HTMLButtonElement).style.color = 'var(--text-2)' }}
          >✕</button>
        </div>

        {loading ? (
          <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: 'var(--font-mono)', fontSize: 12, color: 'var(--text-3)' }}>
            Loading characters…
          </div>
        ) : chars.length === 0 ? (
          <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: 'var(--font-mono)', fontSize: 12, color: 'var(--text-3)' }}>
            No characters found in GDD. Generate the GDD first.
          </div>
        ) : (
          <>
            {/* Character cards row */}
            <div style={{ flexShrink: 0, borderBottom: '1px solid var(--line)', overflowX: 'auto', display: 'flex', gap: 10, padding: '10px 16px' }}>
              {chars.map(c => {
                const isSelected  = selected === c.character_key
                const statusColor = STATUS_COLOR[c.status_3d] ?? STATUS_COLOR.empty
                return (
                  <div
                    key={c.character_key}
                    onClick={() => { setSelected(c.character_key); setFreshGlb(null); setError(null) }}
                    style={{
                      flexShrink: 0, width: 96, cursor: 'pointer', borderRadius: 8,
                      border: `1px solid ${isSelected ? 'var(--cat-asset)' : 'var(--line-2)'}`,
                      background: isSelected ? 'color-mix(in oklch, var(--cat-asset) 10%, var(--bg-2))' : 'var(--bg-2)',
                      overflow: 'hidden', transition: 'all 120ms',
                    }}
                  >
                    <div style={{ width: '100%', height: 72, background: 'var(--bg-3)', position: 'relative' }}>
                      {c.render_2d_url ? (
                        <img src={c.render_2d_url} alt={c.character_name} style={{ width: '100%', height: '100%', objectFit: 'cover', objectPosition: 'top', display: 'block' }} />
                      ) : (
                        <div style={{ width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: 'var(--font-mono)', fontSize: 9, color: 'var(--text-3)' }}>No render</div>
                      )}
                      {c.status_3d !== 'empty' && (
                        <div style={{
                          position: 'absolute', top: 4, right: 4, width: 16, height: 16, borderRadius: '50%',
                          background: statusColor, display: 'grid', placeItems: 'center',
                          fontSize: c.status_3d === 'approved' ? 10 : 8, color: '#0a0a0c', fontWeight: 700,
                        }}>
                          {c.status_3d === 'approved' ? '✓' : '3'}
                        </div>
                      )}
                    </div>
                    <div style={{ padding: '5px 7px' }}>
                      <div style={{ fontFamily: 'var(--font-mono)', fontSize: 9, color: 'var(--text-1)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{c.character_name}</div>
                      <div style={{ marginTop: 2, fontFamily: 'var(--font-mono)', fontSize: 8, color: statusColor }}>{c.status_3d}</div>
                    </div>
                  </div>
                )
              })}
            </div>

            {/* Body */}
            <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>

              {/* Two panels */}
              <div style={{ flex: 1, display: 'flex', overflow: 'hidden' }}>

                {/* Left: 2D render */}
                <div style={{ width: '42%', flexShrink: 0, borderRight: '1px solid var(--line)', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
                  <div style={{ padding: '8px 14px', borderBottom: '1px solid var(--line)', fontFamily: 'var(--font-mono)', fontSize: 9, color: 'var(--text-3)', textTransform: 'uppercase', letterSpacing: '0.08em' }}>
                    2D Render — {cur?.character_name ?? '—'}
                  </div>
                  <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16, overflow: 'hidden' }}>
                    {cur?.render_2d_url ? (
                      <img src={cur.render_2d_url} alt={cur.character_name} style={{ maxWidth: '100%', maxHeight: '100%', objectFit: 'contain', borderRadius: 8, display: 'block' }} />
                    ) : (
                      <div style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--text-3)', textAlign: 'center' }}>
                        <div style={{ fontSize: 28, marginBottom: 8, opacity: 0.3 }}>◧</div>
                        No 2D render available.<br />Generate the character render first.
                      </div>
                    )}
                  </div>
                </div>

                {/* Right: 3D result */}
                <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
                  <div style={{ padding: '8px 14px', borderBottom: '1px solid var(--line)', fontFamily: 'var(--font-mono)', fontSize: 9, color: 'var(--text-3)', textTransform: 'uppercase', letterSpacing: '0.08em', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                    <span>3D Model Result</span>
                    {cur && cur.total_versions_3d > 0 && (
                      <span>{cur.total_versions_3d} version{cur.total_versions_3d !== 1 ? 's' : ''}</span>
                    )}
                  </div>

                  {error && (
                    <div style={{ margin: '8px 14px', fontSize: 10, fontFamily: 'var(--font-mono)', color: 'var(--cat-output)', background: 'color-mix(in oklch, var(--cat-output) 10%, var(--bg-2))', padding: '7px 10px', borderRadius: 6 }}>
                      {error}
                    </div>
                  )}

                  <div style={{ flex: 1, padding: 16, display: 'flex', flexDirection: 'column', gap: 10, overflow: 'hidden' }}>
                    {/* ModelViewer / progress */}
                    <div style={{ flex: 1, minHeight: 0 }}>
                      {generating ? (
                        <div style={{ width: '100%', height: '100%', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 16 }}>
                          <div style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color: 'var(--text-3)' }}>Generating 3D model…</div>
                          <div style={{ width: '60%', height: 4, background: 'var(--bg-3)', borderRadius: 99, overflow: 'hidden' }}>
                            <div style={{ height: '100%', width: `${fakeProgress}%`, background: 'var(--cat-asset)', borderRadius: 99, transition: 'width 280ms ease' }} />
                          </div>
                          <div style={{ fontFamily: 'var(--font-mono)', fontSize: 9, color: 'var(--text-3)' }}>{Math.round(fakeProgress)}%</div>
                        </div>
                      ) : (
                        <ModelViewer url={isGlb ? glbUrl! : undefined} style={{ height: '100%' }} />
                      )}
                    </div>

                    {/* Action buttons */}
                    <div style={{ flexShrink: 0, display: 'flex', flexDirection: 'column', gap: 8 }}>
                      {!cur?.render_2d_url ? (
                        <div style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color: 'var(--text-3)', padding: '8px 12px', background: 'var(--bg-2)', borderRadius: 6, border: '1px solid var(--line-2)' }}>
                          Generate the 2D character render before creating the 3D model.
                        </div>
                      ) : nodeApproved ? (
                        <div style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color: 'var(--text-3)', padding: '8px 12px', background: 'var(--bg-2)', borderRadius: 6, border: '1px solid var(--line-2)' }}>
                          🔒 Node approved — regeneration locked
                        </div>
                      ) : (
                        <>
                          {/* Generate / Regenerate */}
                          <button
                            onClick={handleGenerate}
                            disabled={generating || approving}
                            style={{
                              width: '100%', padding: '9px 0', borderRadius: 6, border: 'none',
                              cursor: (generating || approving) ? 'not-allowed' : 'pointer',
                              background: generating ? 'var(--bg-3)' : 'var(--cat-asset)',
                              color: generating ? 'var(--text-3)' : '#0a0a0c',
                              fontSize: 11, fontFamily: 'var(--font-mono)', fontWeight: 700,
                              display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
                              opacity: (generating || approving) ? 0.7 : 1, transition: 'all 120ms',
                            }}
                          >
                            {generating
                              ? <><span style={{ display: 'inline-block', width: 10, height: 10, border: '2px solid currentColor', borderTopColor: 'transparent', borderRadius: '50%', animation: 'spin 0.7s linear infinite' }} />Generating…</>
                              : glbUrl ? '↺ Regenerate 3D Model' : '▶ Generate 3D Model'
                            }
                          </button>

                          {/* Approve model */}
                          {glbUrl && cur?.status_3d !== 'approved' && (
                            <button
                              onClick={handleApprove}
                              disabled={approving || generating}
                              style={{
                                width: '100%', padding: '8px 0', borderRadius: 6,
                                border: '1px solid var(--cat-code)',
                                cursor: (approving || generating) ? 'not-allowed' : 'pointer',
                                background: 'transparent', color: 'var(--cat-code)',
                                fontSize: 11, fontFamily: 'var(--font-mono)', fontWeight: 600,
                                opacity: (approving || generating) ? 0.6 : 1, transition: 'all 120ms',
                              }}
                            >
                              {approving ? 'Approving…' : '✓ Approve model'}
                            </button>
                          )}

                          {cur?.status_3d === 'approved' && (
                            <div style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color: 'var(--cat-code)', textAlign: 'center', padding: '6px 0' }}>
                              ✓ Model approved
                            </div>
                          )}
                        </>
                      )}
                    </div>
                  </div>
                </div>
              </div>

              {/* Approve node bar */}
              {allApproved && !nodeApproved && (
                <div style={{ flexShrink: 0, borderTop: '1px solid var(--line)', padding: '12px 20px', display: 'flex', alignItems: 'center', gap: 14 }}>
                  <span style={{ flex: 1, fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--cat-code)' }}>
                    All character models approved
                  </span>
                  <button
                    onClick={handleApproveNode}
                    disabled={approvingNode}
                    style={{
                      padding: '8px 24px', borderRadius: 6, border: 'none',
                      cursor: approvingNode ? 'not-allowed' : 'pointer',
                      background: 'var(--action)', color: 'var(--action-fg)',
                      fontSize: 12, fontFamily: 'var(--font-mono)', fontWeight: 700,
                      opacity: approvingNode ? 0.6 : 1,
                    }}
                  >
                    {approvingNode ? 'Approving…' : '✓ Approve Modeling node'}
                  </button>
                </div>
              )}
            </div>
          </>
        )}
      </div>
      <style>{`@keyframes spin { to { transform: rotate(360deg) } }`}</style>
    </div>
  )
}
