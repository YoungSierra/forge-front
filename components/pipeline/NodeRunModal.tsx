'use client'

import { useState, useEffect, useRef } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import type { Project } from '@/lib/types'
import type { PipelineNodeConfig, PipelineContainerConfig, PipelineNodeItem } from '@/lib/api'
import { runPipelineNode, saveNodeDraft, savePipelineImageVersion, approveNode, regeneratePipelineItem, assetUrl } from '@/lib/api'
import RefinementModal from '@/components/shared/RefinementModal'

interface Props {
  node:             PipelineNodeConfig
  container:        PipelineContainerConfig
  containers:       PipelineContainerConfig[]
  project:          Project
  color:            string
  onClose:          () => void
  onApproved:       () => void
  onDraftSaved?:    () => void
  onSaveComplete?:  () => void
  onNavigateTo?:    (node: PipelineNodeConfig) => void
  initialTab?:      Tab
  isLocked?:        boolean
  inline?:          boolean
}

type Tab      = 'input' | 'output'
type ViewMode = 'accordion' | 'cards'

// Claves de pipeline que no son outputs de nodos
const META_KEYS = new Set(['game_idea', 'idea_expansion', 'direction_lock', 'gdd_sections', 'gdd'])

// Campos que no se renderizan como texto (son metadatos o imagen)
const SKIP_FIELDS = new Set(['image_url', 'id'])

// Humaniza una clave snake_case a Title Case
function humanizeKey(key: string): string {
  return key.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase())
}

// ─── Renderer de item individual ─────────────────────────────────────────────

function ItemTextFields({ item }: { item: PipelineNodeItem }) {
  const entries = Object.entries(item).filter(
    ([k, v]) => !SKIP_FIELDS.has(k) && k !== (item.name != null ? 'name' : '') && typeof v === 'string' && v.trim()
  )
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      {entries.map(([k, v]) => (
        <div key={k}>
          <div style={{ fontFamily: 'var(--font-mono)', fontSize: 9, textTransform: 'uppercase', letterSpacing: '0.08em', color: 'var(--text-3)', marginBottom: 4 }}>
            {humanizeKey(k)}
          </div>
          <div style={{ fontSize: 12, lineHeight: 1.7, color: 'var(--text-1)' }}>
            <div className="raw-md">
              <ReactMarkdown remarkPlugins={[remarkGfm]}>{String(v)}</ReactMarkdown>
            </div>
          </div>
        </div>
      ))}
    </div>
  )
}

// ─── Acordeón ────────────────────────────────────────────────────────────────

function AccordionView({
  items, previousItems, regeneratingIdx, regenProgress, color, isApproved,
  onToggle, expanded,
  onRegenerate, onRevert, onFullsize,
}: {
  items:           PipelineNodeItem[]
  previousItems:   Record<number, PipelineNodeItem>
  regeneratingIdx: number | null
  regenProgress:   number
  color:           string
  isApproved:      boolean
  expanded:        Set<number>
  onToggle:        (i: number) => void
  onRegenerate:    (i: number) => void
  onRevert:        (i: number) => void
  onFullsize:      (url: string) => void
}) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      {items.map((item, i) => {
        const isOpen   = expanded.has(i)
        const isRegen  = regeneratingIdx === i
        const hasPrev  = i in previousItems
        const title    = String(item.name ?? item.title ?? `Item ${i + 1}`)
        const imgUrl   = item.image_url ? assetUrl(String(item.image_url)) : null

        return (
          <div
            key={i}
            style={{
              background: 'var(--bg-2)', border: `1px solid ${isOpen ? `color-mix(in srgb, ${color} 40%, var(--line-2))` : 'var(--line-2)'}`,
              borderRadius: 9, overflow: 'hidden', transition: 'border-color 150ms',
            }}
          >
            {/* Fila de título */}
            <div
              onClick={() => onToggle(i)}
              style={{
                display: 'flex', alignItems: 'center', gap: 10, padding: '10px 14px',
                cursor: 'pointer', userSelect: 'none',
                background: isOpen ? `color-mix(in srgb, ${color} 5%, var(--bg-2))` : 'transparent',
                transition: 'background 150ms',
              }}
            >
              <span style={{ fontFamily: 'var(--font-mono)', fontSize: 9, color, fontWeight: 700, flexShrink: 0 }}>
                {String(i + 1).padStart(2, '0')}
              </span>
              <span style={{ fontWeight: 600, fontSize: 13, color: 'var(--text-0)', flex: 1 }}>{title}</span>
              {imgUrl && !isOpen && (
                <img src={imgUrl} alt="" style={{ width: 28, height: 28, borderRadius: 4, objectFit: 'cover', flexShrink: 0, border: '1px solid var(--line-2)' }} />
              )}
              {isRegen && (
                <span style={{ fontFamily: 'var(--font-mono)', fontSize: 9, color: 'var(--state-running)', flexShrink: 0 }}>⟳ regenerating…</span>
              )}
              <span style={{ color: 'var(--text-3)', fontSize: 12, flexShrink: 0 }}>{isOpen ? '▲' : '▼'}</span>
            </div>

            {/* Contenido expandido */}
            {isOpen && (
              <div style={{ borderTop: '1px solid var(--line-2)', padding: '14px 14px 12px' }}>
                <div style={{ display: 'flex', gap: 18, alignItems: 'flex-start' }}>

                  {/* Izquierda: campos de texto */}
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <ItemTextFields item={item} />
                  </div>

                  {/* Derecha: thumbnail */}
                  {imgUrl && (
                    <div style={{ flexShrink: 0, width: 160 }}>
                      <img
                        src={imgUrl}
                        alt=""
                        onClick={() => onFullsize(imgUrl)}
                        style={{
                          width: '100%', aspectRatio: '1/1', objectFit: 'cover',
                          borderRadius: 8, border: '1px solid var(--line-2)',
                          cursor: 'zoom-in', display: 'block',
                          transition: 'opacity 100ms',
                        }}
                        onMouseEnter={e => (e.currentTarget.style.opacity = '0.85')}
                        onMouseLeave={e => (e.currentTarget.style.opacity = '1')}
                      />
                      <div style={{ fontFamily: 'var(--font-mono)', fontSize: 8, color: 'var(--text-4)', textAlign: 'center', marginTop: 4 }}>
                        click to enlarge
                      </div>
                    </div>
                  )}
                </div>

                {/* Acciones por item */}
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 12, paddingTop: 10, borderTop: '1px solid var(--line-2)' }}>
                  <div style={{ display: 'flex', gap: 8 }}>
                    {!isApproved && (
                    <button
                      onClick={() => onRegenerate(i)}
                      disabled={isRegen || regeneratingIdx !== null}
                      style={{
                        fontFamily: 'var(--font-mono)', fontSize: 10, fontWeight: 600,
                        padding: '5px 12px', borderRadius: 6,
                        border: `1px solid color-mix(in srgb, ${color} 35%, transparent)`,
                        background: `color-mix(in srgb, ${color} 10%, transparent)`,
                        color: isRegen ? 'var(--text-3)' : color,
                        cursor: (isRegen || regeneratingIdx !== null) ? 'not-allowed' : 'pointer',
                        opacity: regeneratingIdx !== null && !isRegen ? 0.4 : 1,
                        transition: 'opacity 120ms',
                      }}
                    >
                      {isRegen ? '⟳ Regenerating…' : '↺ Regenerate'}
                    </button>
                    )}
                    {hasPrev && (
                      <button
                        onClick={() => onRevert(i)}
                        disabled={isRegen}
                        style={{
                          fontFamily: 'var(--font-mono)', fontSize: 10, fontWeight: 600,
                          padding: '5px 12px', borderRadius: 6,
                          border: '1px solid var(--line-2)',
                          background: 'transparent',
                          color: 'var(--text-3)',
                          cursor: isRegen ? 'not-allowed' : 'pointer',
                        }}
                      >
                        ↩ Revert
                      </button>
                    )}
                  </div>
                  {isRegen && (
                    <div style={{ width: '100%', height: 3, background: 'var(--bg-3)', borderRadius: 99, overflow: 'hidden' }}>
                      <div style={{ height: '100%', borderRadius: 99, background: `linear-gradient(90deg, ${color}, color-mix(in srgb, ${color} 70%, white))`, width: `${regenProgress}%`, transition: 'width 0.4s ease' }} />
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
}

// ─── Cards view ───────────────────────────────────────────────────────────────

function CardsView({
  items, previousItems, regeneratingIdx, regenProgress, color, isApproved,
  onRegenerate, onRevert, onFullsize,
}: {
  items:           PipelineNodeItem[]
  previousItems:   Record<number, PipelineNodeItem>
  regeneratingIdx: number | null
  regenProgress:   number
  color:           string
  isApproved:      boolean
  onRegenerate:    (i: number) => void
  onRevert:        (i: number) => void
  onFullsize:      (url: string) => void
}) {
  const [expandedCards, setExpandedCards] = useState<Set<number>>(new Set())

  function toggleCard(i: number) {
    setExpandedCards(prev => {
      const next = new Set(prev)
      next.has(i) ? next.delete(i) : next.add(i)
      return next
    })
  }

  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))', gap: 12 }}>
      {items.map((item, i) => {
        const isRegen    = regeneratingIdx === i
        const hasPrev    = i in previousItems
        const isExpanded = expandedCards.has(i)
        const title      = String(item.name ?? item.title ?? `Item ${i + 1}`)
        const imgUrl     = item.image_url ? assetUrl(String(item.image_url)) : null
        const desc       = String(item.description ?? item.rules ?? '')

        return (
          <div
            key={i}
            style={{
              background: 'var(--bg-2)', border: '1px solid var(--line-2)',
              borderRadius: 9, overflow: 'hidden', display: 'flex', flexDirection: 'column',
            }}
          >
            {imgUrl ? (
              <img
                src={imgUrl}
                alt=""
                onClick={() => onFullsize(imgUrl)}
                style={{ width: '100%', height: 120, objectFit: 'cover', cursor: 'zoom-in', display: 'block' }}
              />
            ) : (
              <div style={{ width: '100%', height: 56, background: `color-mix(in srgb, ${color} 12%, var(--bg-3))`, display: 'grid', placeItems: 'center' }}>
                <span style={{ fontFamily: 'var(--font-mono)', fontSize: 9, color, opacity: 0.5 }}>{String(i + 1).padStart(2, '0')}</span>
              </div>
            )}
            <div style={{ padding: '10px 12px', flex: 1, display: 'flex', flexDirection: 'column', gap: 6 }}>
              <div style={{ fontWeight: 700, fontSize: 12, color: 'var(--text-0)' }}>{title}</div>
              {!isExpanded && desc && (
                <div
                  onClick={() => toggleCard(i)}
                  style={{ fontSize: 11, color: 'var(--text-2)', lineHeight: 1.55, cursor: 'pointer', display: '-webkit-box', WebkitLineClamp: 3, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}
                >
                  {desc}
                </div>
              )}
              {!isExpanded && desc && (
                <div onClick={() => toggleCard(i)} style={{ fontFamily: 'var(--font-mono)', fontSize: 8, color: 'var(--text-4)', cursor: 'pointer', marginTop: -2 }}>
                  read more
                </div>
              )}
              {isExpanded && (
                <div style={{ borderTop: '1px solid var(--line-2)', paddingTop: 10, marginTop: 2 }}>
                  <ItemTextFields item={item} />
                </div>
              )}
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 'auto', paddingTop: 8 }}>
                {!isApproved && (
                <button
                  onClick={() => onRegenerate(i)}
                  disabled={isRegen || regeneratingIdx !== null}
                  title={isRegen ? 'Regenerating…' : `Regenerate "${title}"`}
                  style={{
                    fontFamily: 'var(--font-mono)', fontSize: 9, padding: '4px 10px', borderRadius: 5,
                    border: `1px solid color-mix(in srgb, ${color} 35%, transparent)`,
                    background: `color-mix(in srgb, ${color} 10%, transparent)`,
                    color: isRegen ? 'var(--text-3)' : color,
                    cursor: (isRegen || regeneratingIdx !== null) ? 'not-allowed' : 'pointer',
                    opacity: regeneratingIdx !== null && !isRegen ? 0.4 : 1,
                    flexShrink: 0,
                  }}
                >
                  {isRegen ? '⟳' : '↺'}
                </button>
                )}
                {isRegen && (
                  <div style={{ flex: 1, height: 3, background: 'var(--bg-3)', borderRadius: 99, overflow: 'hidden' }}>
                    <div style={{ height: '100%', borderRadius: 99, background: `linear-gradient(90deg, ${color}, color-mix(in srgb, ${color} 70%, white))`, width: `${regenProgress}%`, transition: 'width 0.4s ease' }} />
                  </div>
                )}
                {hasPrev && (
                  <button
                    onClick={() => onRevert(i)}
                    style={{ fontFamily: 'var(--font-mono)', fontSize: 9, padding: '4px 10px', borderRadius: 5, border: '1px solid var(--line-2)', background: 'transparent', color: 'var(--text-3)', cursor: 'pointer' }}
                  >↩</button>
                )}
                {isExpanded && (
                  <button
                    onClick={() => toggleCard(i)}
                    style={{ fontFamily: 'var(--font-mono)', fontSize: 9, padding: '4px 10px', borderRadius: 5, border: '1px solid var(--line-2)', background: 'transparent', color: 'var(--text-4)', cursor: 'pointer', marginLeft: 'auto' }}
                  >collapse</button>
                )}
              </div>
            </div>
          </div>
        )
      })}
    </div>
  )
}

// ─── Modal principal ──────────────────────────────────────────────────────────

export default function NodeRunModal({ node, container, containers, project, color, onClose, onApproved, onDraftSaved, onSaveComplete, onNavigateTo, initialTab, isLocked, inline }: Props) {
  const existing0 = (project.concept?.pipeline as Record<string, unknown> | undefined)?.[node.step_key] as Record<string, unknown> | undefined
  const [tab,             setTab]             = useState<Tab>(initialTab ?? (existing0?.output || existing0?.items ? 'output' : 'input'))
  const [localApproved,   setLocalApproved]   = useState(existing0?.approved === true)
  const [output,          setOutput]          = useState<string | null>(null)
  const [imageUrl,        setImageUrl]        = useState<string | null>(null)
  const [items,           setItems]           = useState<PipelineNodeItem[] | null>(null)
  const [previousItems,   setPreviousItems]   = useState<Record<number, PipelineNodeItem>>({})
  const [expandedItems,   setExpandedItems]   = useState<Set<number>>(new Set())
  const [viewMode,        setViewMode]        = useState<ViewMode>('accordion')
  const [generating,      setGenerating]      = useState(false)
  const [approving,       setApproving]       = useState(false)
  const [regeneratingIdx, setRegeneratingIdx] = useState<number | null>(null)
  const [fakeProgress,    setFakeProgress]    = useState(0)
  const [regenProgress,   setRegenProgress]   = useState(0)
  const [error,           setError]           = useState<string | null>(null)
  const [refinementOpen,  setRefinementOpen]  = useState(false)
  const [fullsizeUrl,     setFullsizeUrl]     = useState<string | null>(null)
  const bodyRef = useRef<HTMLDivElement>(null)

  // Pre-cargar output existente
  useEffect(() => {
    const pipeline = project.concept?.pipeline as Record<string, unknown> | undefined
    const existing = pipeline?.[node.step_key] as Record<string, unknown> | undefined
    if (existing?.approved || existing?.pending_review) {
      if (typeof existing.output === 'string')         setOutput(existing.output)
      if (typeof existing.image_url === 'string')      setImageUrl(existing.image_url)

      // Cargar items existentes; si no hay pero el output parece JSON array, parsearlo como fallback
      if (Array.isArray(existing.items) && existing.items.length > 0) {
        setItems(existing.items as PipelineNodeItem[])
        setExpandedItems(new Set())
      } else if (typeof existing.output === 'string') {
        try {
          const match = existing.output.match(/\[[\s\S]*\]/)
          if (match) {
            const parsed = JSON.parse(match[0])
            if (Array.isArray(parsed) && parsed.length > 0 && parsed[0] && typeof parsed[0] === 'object') {
              setItems(parsed as PipelineNodeItem[])
              setExpandedItems(new Set())
            }
          }
        } catch { /* no era JSON, renderizar como markdown */ }
      }
    }
  }, [node.step_key, project])

  // Escape key
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key !== 'Escape') return
      if (fullsizeUrl) { setFullsizeUrl(null); return }
      if (!inline) onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose, fullsizeUrl, inline])

  // Progreso falso — generación completa
  useEffect(() => {
    if (!generating) { if (output || items) setFakeProgress(100); return }
    setFakeProgress(0)
    const iv = setInterval(() => {
      setFakeProgress(prev => {
        if (prev >= 88) return prev
        const step = prev < 30 ? 2.5 : prev < 60 ? 0.9 : 0.35
        return Math.min(88, prev + step)
      })
    }, 300)
    return () => clearInterval(iv)
  }, [generating, output, items])

  // Progreso falso — regeneración de item individual
  useEffect(() => {
    if (regeneratingIdx === null) { setRegenProgress(0); return }
    setRegenProgress(0)
    const iv = setInterval(() => {
      setRegenProgress(prev => {
        if (prev >= 88) return prev
        const step = prev < 30 ? 3 : prev < 60 ? 1.2 : 0.5
        return Math.min(88, prev + step)
      })
    }, 300)
    return () => clearInterval(iv)
  }, [regeneratingIdx])

  async function handleGenerate() {
    setGenerating(true)
    setError(null)
    setTab('output')
    try {
      const result = await runPipelineNode(project.id, node.step_key)
      setOutput(result.output)
      if (result.image_url) setImageUrl(result.image_url)

      // Usar items del backend; si no vienen (parse falló en servidor), intentar parsear el output aquí
      let resolvedItems = result.items && result.items.length > 0 ? result.items : null
      if (!resolvedItems && result.output) {
        try {
          const match = result.output.match(/\[[\s\S]*\]/)
          if (match) {
            const parsed = JSON.parse(match[0])
            if (Array.isArray(parsed) && parsed.length > 0) resolvedItems = parsed as PipelineNodeItem[]
          }
        } catch { /* fallback sin items */ }
      }

      if (resolvedItems) {
        setItems(resolvedItems)
        setPreviousItems({})
        setExpandedItems(new Set())
      }
      onDraftSaved?.()
      saveNodeDraft(project.id, node.step_key, result.output, result.image_url, resolvedItems)
        .then(() => onSaveComplete?.())
        .catch(e => console.warn('[NodeRunModal] save-draft failed:', e))
      setTimeout(() => { bodyRef.current?.scrollTo({ top: 0, behavior: 'smooth' }) }, 60)
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Generation failed')
    } finally {
      setGenerating(false)
    }
  }

  async function handleRegenerateItem(idx: number) {
    if (!items) return
    setRegeneratingIdx(idx)
    setError(null)
    try {
      const { item } = await regeneratePipelineItem(project.id, node.step_key, idx)
      // Guardar versión anterior para undo
      setPreviousItems(prev => ({ ...prev, [idx]: items[idx] }))
      const updatedItems = [...items]
      updatedItems[idx] = item
      setItems(updatedItems)
      // El backend ya guardó el item en BD preservando approved/pending_review — no llamar saveNodeDraft aquí
      onSaveComplete?.()
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Regeneration failed')
    } finally {
      setRegeneratingIdx(null)
    }
  }

  function handleRevertItem(idx: number) {
    if (!items || !(idx in previousItems)) return
    const restored = previousItems[idx]
    const updatedItems = [...items]
    updatedItems[idx] = restored
    setItems(updatedItems)
    setPreviousItems(prev => { const next = { ...prev }; delete next[idx]; return next })
    saveNodeDraft(project.id, node.step_key, output ?? '', null, updatedItems)
      .catch(e => console.warn('[NodeRunModal] save-draft after revert failed:', e))
  }

  function handleToggleItem(i: number) {
    setExpandedItems(prev => prev.has(i) ? new Set() : new Set([i]))
  }

  async function handleRefined({ image_url }: { image_url: string; refined_from_id: string }) {
    setImageUrl(image_url)
    setRefinementOpen(false)
    const currentOutput = output ?? ''
    savePipelineImageVersion(project.id, node.step_key, image_url)
      .catch(e => console.warn('[NodeRunModal] save-image-version failed:', e))
    saveNodeDraft(project.id, node.step_key, currentOutput, image_url, items)
      .then(() => onSaveComplete?.())
      .catch(e => console.warn('[NodeRunModal] save-draft after refine failed:', e))
  }

  async function handleApprove() {
    if (!output && !items) return
    setApproving(true)
    setError(null)
    try {
      const memberId = typeof window !== 'undefined' ? localStorage.getItem('forge_member_id') : null
      await approveNode(
        project.id,
        node.step_key,
        { output: output ?? '', image_url: imageUrl, ...(items ? { items } : {}) },
        memberId ?? undefined,
      )
      setLocalApproved(true)
      onApproved()
      if (!inline) onClose()
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Approve failed')
      setApproving(false)
    }
  }

  // Datos de contexto
  const pipeline   = project.concept?.pipeline as Record<string, unknown> | undefined
  const existing   = pipeline?.[node.step_key] as Record<string, unknown> | undefined
  const isApproved = existing?.approved === true || localApproved
  const gameIdea   = (pipeline?.game_idea as Record<string, unknown> | undefined)?.text as string | undefined

  // Encontrar el nodo inmediatamente anterior en el orden global
  const allNodeKeys: string[] = []
  const sortedContainers = [...containers].sort((a, b) => (a.order_index ?? 0) - (b.order_index ?? 0))
  for (const c of sortedContainers) {
    for (const n of [...c.children].sort((a, b) => (a.order_index ?? 0) - (b.order_index ?? 0))) {
      allNodeKeys.push(n.step_key)
    }
  }
  const currentIdx    = allNodeKeys.indexOf(node.step_key)
  const prevKey       = currentIdx > 0 ? allNodeKeys[currentIdx - 1] : null
  const prevEntry     = prevKey && pipeline?.[prevKey]
  const prevApproved  = prevEntry && typeof prevEntry === 'object' && (prevEntry as Record<string, unknown>).approved === true
    ? prevEntry as Record<string, unknown>
    : null
  const prevNodeConfig = prevKey
    ? sortedContainers.flatMap(c => c.children).find(n => n.step_key === prevKey) ?? null
    : null

  const hasOutput    = !!(output || (items && items.length > 0))
  const isStructured = !!(items && items.length > 0)

  const tabStyle = (active: boolean): React.CSSProperties => ({
    fontFamily: 'var(--font-mono)', fontSize: 10, fontWeight: active ? 700 : 400,
    padding: '7px 16px', border: 'none', cursor: 'pointer',
    background: active ? 'var(--bg-1)' : 'transparent',
    color: active ? 'var(--text-0)' : 'var(--text-3)',
    borderBottom: active ? `2px solid ${color}` : '2px solid transparent',
    transition: 'color 120ms, border-color 120ms',
  })

  return (
    <>
    <style>{`
      .raw-md h1 { font-size: 22px; font-weight: 700; color: var(--text-0); margin: 0 0 12px; border-bottom: 1px solid var(--line-2); padding-bottom: 8px; }
      .raw-md h2 { font-size: 17px; font-weight: 700; color: var(--text-0); margin: 24px 0 8px; }
      .raw-md h3 { font-size: 14px; font-weight: 600; color: var(--cat-design); margin: 18px 0 6px; text-transform: uppercase; letter-spacing: 0.06em; }
      .raw-md p  { margin: 0 0 10px; color: var(--text-1); }
      .raw-md ul, .raw-md ol { margin: 0 0 10px; padding-left: 20px; }
      .raw-md li { margin-bottom: 3px; color: var(--text-1); }
      .raw-md strong { color: var(--text-0); font-weight: 600; }
      .raw-md em { color: var(--text-2); font-style: italic; }
      .raw-md hr { border: none; border-top: 1px solid var(--line-2); margin: 20px 0; }
      .raw-md code { font-family: var(--font-mono); font-size: 12px; background: var(--bg-3); border: 1px solid var(--line-2); border-radius: 4px; padding: 1px 5px; color: var(--cat-code); }
      .raw-md pre { background: var(--bg-3); border: 1px solid var(--line-2); border-radius: 7px; padding: 14px 16px; overflow-x: auto; margin: 0 0 12px; }
      .raw-md pre code { background: none; border: none; padding: 0; }
      .raw-md blockquote { border-left: 3px solid var(--cat-design); margin: 0 0 10px; padding: 4px 0 4px 14px; color: var(--text-2); }
      .raw-md table { width: 100%; border-collapse: collapse; margin: 0 0 16px; font-size: 13px; }
      .raw-md th { background: var(--bg-3); color: var(--text-0); font-weight: 600; text-align: left; padding: 8px 12px; border: 1px solid var(--line-2); font-family: var(--font-mono); font-size: 11px; text-transform: uppercase; letter-spacing: 0.06em; }
      .raw-md td { padding: 8px 12px; border: 1px solid var(--line-2); color: var(--text-1); vertical-align: top; }
      .raw-md tr:nth-child(even) td { background: color-mix(in oklch, var(--bg-2) 60%, transparent); }
    `}</style>

    {/* Wrapper: inline llena el padre, normal es overlay fijo centrado */}
    <div style={inline ? {
      display: 'flex', flexDirection: 'column', height: '100%', overflow: 'hidden',
    } : {
      position: 'fixed', inset: 0, zIndex: 200,
      background: 'rgba(0,0,0,0.78)', backdropFilter: 'blur(4px)',
      display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24,
    }}>
      {/* Caja de contenido */}
      <div style={inline ? {
        display: 'flex', flexDirection: 'column', flex: 1, overflow: 'hidden',
        background: 'var(--bg-1)',
      } : {
        background: 'var(--bg-1)', border: '1px solid var(--line-2)', borderRadius: 14,
        width: '100%', maxWidth: isStructured ? 860 : 780, maxHeight: '88vh',
        display: 'flex', flexDirection: 'column', overflow: 'hidden',
        boxShadow: '0 32px 80px rgba(0,0,0,0.7)', transition: 'max-width 200ms',
      }}>

        {/* Header */}
        <div style={{ padding: '13px 18px', borderBottom: '1px solid var(--line-2)', display: 'flex', alignItems: 'center', gap: 10, flexShrink: 0 }}>
          <div style={{ width: 8, height: 8, borderRadius: '50%', background: color, flexShrink: 0 }} />
          <span style={{ fontFamily: 'var(--font-mono)', fontSize: 9, color: 'var(--text-3)', flexShrink: 0 }}>
            {container.order_index}.{node.order_index}
          </span>
          <span style={{ fontWeight: 700, fontSize: 13, color: 'var(--text-0)', flex: 1 }}>{node.label}</span>
          {isStructured && (
            <span style={{ fontFamily: 'var(--font-mono)', fontSize: 8, color: 'var(--text-3)', background: 'var(--bg-3)', border: '1px solid var(--line-2)', borderRadius: 99, padding: '2px 8px' }}>
              {items!.length} items
            </span>
          )}
          {node.integration_type && (
            <span style={{ fontFamily: 'var(--font-mono)', fontSize: 8, padding: '2px 8px', borderRadius: 99, background: 'var(--bg-3)', color: 'var(--text-3)', border: '1px solid var(--line-2)', flexShrink: 0 }}>
              {node.integration_type}
            </span>
          )}
          {!inline && (
            <button
              onClick={onClose}
              style={{ width: 28, height: 28, borderRadius: 7, border: '1px solid var(--line-2)', background: 'var(--bg-3)', cursor: 'pointer', color: 'var(--text-3)', fontSize: 15, display: 'grid', placeItems: 'center', flexShrink: 0 }}
              onMouseEnter={e => (e.currentTarget.style.color = 'var(--text-0)')}
              onMouseLeave={e => (e.currentTarget.style.color = 'var(--text-3)')}
            >✕</button>
          )}
        </div>

        {/* Tabs + toggle de vista */}
        <div style={{ display: 'flex', borderBottom: '1px solid var(--line-2)', flexShrink: 0, background: 'var(--bg-2)', alignItems: 'center' }}>
          <button style={tabStyle(tab === 'input')}  onClick={() => setTab('input')}>Input Context</button>
          <button style={tabStyle(tab === 'output')} onClick={() => setTab('output')}>
            Output {hasOutput && <span style={{ marginLeft: 6, width: 6, height: 6, borderRadius: '50%', background: 'var(--state-success)', display: 'inline-block', verticalAlign: 'middle' }} />}
          </button>
          {/* Toggle acordeón / cards — solo cuando hay items */}
          {isStructured && tab === 'output' && (
            <div style={{ marginLeft: 'auto', marginRight: 12, display: 'flex', background: 'var(--bg-3)', border: '1px solid var(--line-2)', borderRadius: 6, padding: 2, gap: 2 }}>
              {(['accordion', 'cards'] as ViewMode[]).map(v => (
                <button
                  key={v}
                  onClick={() => setViewMode(v)}
                  style={{
                    fontFamily: 'var(--font-mono)', fontSize: 8, fontWeight: 600, padding: '3px 9px', borderRadius: 4,
                    border: viewMode === v ? '1px solid var(--line-2)' : 'none',
                    background: viewMode === v ? 'var(--bg-4)' : 'transparent',
                    color: viewMode === v ? 'var(--text-0)' : 'var(--text-3)',
                    cursor: 'pointer',
                  }}
                >
                  {v === 'accordion' ? '☰' : '⊞'}
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Body */}
        <div ref={bodyRef} style={{ flex: 1, overflowY: 'auto', padding: 24 }}>

          {/* ── Tab: Input Context ── */}
          {tab === 'input' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 22, maxWidth: inline ? undefined : 640, margin: '0 auto' }}>
              <div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 10 }}>
                  <div style={{ width: 3, height: 14, borderRadius: 2, background: 'var(--cat-design)', flexShrink: 0 }} />
                  <span style={{ fontFamily: 'var(--font-mono)', fontSize: 9, textTransform: 'uppercase', letterSpacing: '0.1em', color: 'var(--cat-design)' }}>Game Idea</span>
                </div>
                {gameIdea ? (
                  <div style={{ fontSize: 13, lineHeight: 1.7, padding: '12px 14px', background: 'var(--bg-2)', borderRadius: 8, border: '1px solid var(--line-2)' }}>
                    <div className="raw-md"><ReactMarkdown remarkPlugins={[remarkGfm]}>{gameIdea}</ReactMarkdown></div>
                  </div>
                ) : (
                  <div style={{ fontSize: 11, fontFamily: 'var(--font-mono)', color: 'var(--text-3)', fontStyle: 'italic', padding: '10px 0' }}>
                    No game idea found — complete Stage 0 first.
                  </div>
                )}
              </div>
              {prevApproved && (
                <div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 10 }}>
                    <div style={{ width: 3, height: 14, borderRadius: 2, background: 'var(--cat-asset)', flexShrink: 0 }} />
                    <span style={{ fontFamily: 'var(--font-mono)', fontSize: 9, textTransform: 'uppercase', letterSpacing: '0.1em', color: 'var(--cat-asset)' }}>
                      Prior Output
                    </span>
                    {prevNodeConfig && onNavigateTo ? (
                      <button
                        onClick={() => { onClose(); onNavigateTo(prevNodeConfig) }}
                        style={{
                          fontFamily: 'var(--font-mono)', fontSize: 8, color: color,
                          background: `color-mix(in srgb, ${color} 10%, transparent)`,
                          border: `1px solid color-mix(in srgb, ${color} 30%, transparent)`,
                          borderRadius: 5, padding: '2px 8px', cursor: 'pointer',
                          transition: 'opacity 120ms',
                        }}
                        onMouseEnter={e => (e.currentTarget.style.opacity = '0.7')}
                        onMouseLeave={e => (e.currentTarget.style.opacity = '1')}
                      >
                        ↗ {prevNodeConfig.label}
                      </button>
                    ) : (
                      <span style={{ fontFamily: 'var(--font-mono)', fontSize: 8, color: 'var(--text-4)' }}>{prevKey}</span>
                    )}
                  </div>
                  <div style={{ background: 'var(--bg-2)', borderRadius: 8, border: '1px solid var(--line-2)', overflow: 'hidden' }}>
                    {Array.isArray(prevApproved.items) && (prevApproved.items as PipelineNodeItem[]).length > 0 ? (
                      // Nodo estructurado — mostrar lista de items, no el JSON crudo
                      <div style={{ display: 'flex', flexDirection: 'column' }}>
                        {(prevApproved.items as PipelineNodeItem[]).map((item, i) => {
                          const imgUrl = item.image_url ? assetUrl(String(item.image_url)) : null
                          const title  = String(item.name ?? item.title ?? `Item ${i + 1}`)
                          return (
                            <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 12px', borderBottom: i < (prevApproved.items as PipelineNodeItem[]).length - 1 ? '1px solid var(--line-2)' : 'none' }}>
                              {imgUrl && <img src={imgUrl} alt="" style={{ width: 28, height: 28, borderRadius: 4, objectFit: 'cover', flexShrink: 0 }} />}
                              <span style={{ fontFamily: 'var(--font-mono)', fontSize: 9, color: color, fontWeight: 700, flexShrink: 0 }}>{String(i + 1).padStart(2, '0')}</span>
                              <span style={{ fontSize: 12, color: 'var(--text-1)', fontWeight: 500 }}>{title}</span>
                              {typeof item.description === 'string' && (
                                <span style={{ fontSize: 11, color: 'var(--text-3)', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{item.description}</span>
                              )}
                            </div>
                          )
                        })}
                      </div>
                    ) : typeof prevApproved.output === 'string' && prevApproved.output ? (
                      // Nodo plano — render markdown normal
                      <div style={{ padding: '10px 14px', fontSize: 12, lineHeight: 1.65 }}>
                        <div className="raw-md"><ReactMarkdown remarkPlugins={[remarkGfm]}>{prevApproved.output as string}</ReactMarkdown></div>
                      </div>
                    ) : null}
                  </div>
                </div>
              )}
              {!gameIdea && !prevApproved && (
                <div style={{ textAlign: 'center', padding: '32px 0', color: 'var(--text-4)', fontFamily: 'var(--font-mono)', fontSize: 11 }}>
                  No input context available yet.
                </div>
              )}
            </div>
          )}

          {/* ── Tab: Output ── */}
          {tab === 'output' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 16, maxWidth: inline ? undefined : (isStructured ? 820 : 640), margin: '0 auto' }}>

              {error && (
                <div style={{ padding: '10px 14px', background: 'color-mix(in srgb, #ef4444 10%, transparent)', border: '1px solid color-mix(in srgb, #ef4444 30%, transparent)', borderRadius: 8, fontSize: 11, color: '#ef4444', fontFamily: 'var(--font-mono)', lineHeight: 1.5 }}>
                  {error}
                </div>
              )}

              {/* Barra de progreso */}
              {generating && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginBottom: 8 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                    <span style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color: 'var(--text-3)' }}>
                      {fakeProgress < 25 ? 'Processing request…' : fakeProgress < 60 ? 'Generating…' : fakeProgress < 85 ? 'Almost ready…' : 'Finishing up…'}
                    </span>
                    <span style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color: color }}>{Math.round(fakeProgress)}%</span>
                  </div>
                  <div style={{ width: '100%', height: 3, background: 'var(--bg-3)', borderRadius: 99, overflow: 'hidden' }}>
                    <div style={{ height: '100%', borderRadius: 99, background: `linear-gradient(90deg, ${color}, color-mix(in srgb, ${color} 70%, white))`, width: `${fakeProgress}%`, transition: 'width 0.4s ease' }} />
                  </div>
                </div>
              )}

              {/* Renderer estructurado (items) */}
              {isStructured && !generating && (
                viewMode === 'accordion' ? (
                  <AccordionView
                    items={items!}
                    previousItems={previousItems}
                    regeneratingIdx={regeneratingIdx}
                    regenProgress={regenProgress}
                    color={color}
                    isApproved={isApproved}
                    expanded={expandedItems}
                    onToggle={handleToggleItem}
                    onRegenerate={handleRegenerateItem}
                    onRevert={handleRevertItem}
                    onFullsize={setFullsizeUrl}
                  />
                ) : (
                  <CardsView
                    items={items!}
                    previousItems={previousItems}
                    regeneratingIdx={regeneratingIdx}
                    regenProgress={regenProgress}
                    color={color}
                    isApproved={isApproved}
                    onRegenerate={handleRegenerateItem}
                    onRevert={handleRevertItem}
                    onFullsize={setFullsizeUrl}
                  />
                )
              )}

              {/* Renderer genérico (texto markdown + imagen única) */}
              {!isStructured && !generating && (
                <>
                  {imageUrl && (
                    <img
                      src={assetUrl(imageUrl)}
                      alt=""
                      onClick={() => setFullsizeUrl(assetUrl(imageUrl))}
                      style={{ width: '100%', maxHeight: 380, objectFit: 'contain', borderRadius: 10, border: '1px solid var(--line-2)', display: 'block', background: 'var(--bg-2)', cursor: 'zoom-in' }}
                    />
                  )}
                  {output ? (
                    <div style={{ color: 'var(--text-1)', lineHeight: 1.7, fontSize: 13 }}>
                      <div className="raw-md">
                        <ReactMarkdown remarkPlugins={[remarkGfm]}>{output}</ReactMarkdown>
                      </div>
                    </div>
                  ) : !generating ? (
                    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 12, padding: '60px 0', color: 'var(--text-3)', fontFamily: 'var(--font-mono)', fontSize: 11, textAlign: 'center' }}>
                      <div style={{ fontSize: 32, opacity: 0.2 }}>◈</div>
                      <div>No output yet</div>
                      <div style={{ fontSize: 9, opacity: 0.5 }}>Click Generate to run this node</div>
                    </div>
                  ) : null}
                </>
              )}

            </div>
          )}
        </div>

        {/* Footer */}
        <div style={{ padding: '12px 18px', borderTop: '1px solid var(--line-2)', display: 'flex', alignItems: 'center', gap: 10, flexShrink: 0 }}>

          {!isApproved && (
            isLocked && !hasOutput ? (
              <span style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color: 'var(--text-4)', display: 'flex', alignItems: 'center', gap: 6 }}>
                ⊘ Approve the previous node first
              </span>
            ) : (
              <button
                onClick={handleGenerate}
                disabled={generating || approving || !!(isLocked && !hasOutput)}
                style={{
                  fontFamily: 'var(--font-mono)', fontSize: 11, fontWeight: 700,
                  padding: '8px 20px', borderRadius: 7, border: 'none',
                  cursor: (generating || approving) ? 'default' : 'pointer',
                  background: generating ? 'var(--bg-3)' : 'var(--action)',
                  color: generating ? 'var(--text-3)' : 'var(--action-fg)',
                  display: 'flex', alignItems: 'center', gap: 8,
                  opacity: (generating || approving) ? 0.7 : 1,
                  transition: 'background 120ms, opacity 120ms',
                }}
              >
                {generating ? '⟳ Generating…' : hasOutput ? '↺ Regenerate all' : '▶ Generate'}
              </button>
            )
          )}

          {isApproved && (
            <span style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color: 'var(--state-success)', display: 'flex', alignItems: 'center', gap: 5 }}>
              ✓ Approved
            </span>
          )}

          {hasOutput && !isApproved && (
            <button
              onClick={handleApprove}
              disabled={generating || approving}
              style={{
                fontFamily: 'var(--font-mono)', fontSize: 11, fontWeight: 700,
                padding: '8px 20px', borderRadius: 7,
                border: '1px solid color-mix(in srgb, var(--state-success) 40%, transparent)',
                cursor: (generating || approving) ? 'default' : 'pointer',
                background: 'color-mix(in srgb, var(--state-success) 12%, transparent)',
                color: 'var(--state-success)',
                display: 'flex', alignItems: 'center', gap: 7,
                opacity: (generating || approving) ? 0.7 : 1,
              }}
            >
              {approving ? '…' : '✓ Approve'}
            </button>
          )}

          {/* Refine — solo para imagen única (nodos no estructurados) */}
          {imageUrl && !isStructured && !generating && !approving && (
            <button
              onClick={() => setRefinementOpen(true)}
              style={{
                fontFamily: 'var(--font-mono)', fontSize: 11, fontWeight: 600,
                padding: '8px 16px', borderRadius: 7,
                border: `1px solid color-mix(in srgb, ${color} 40%, transparent)`,
                background: `color-mix(in srgb, ${color} 10%, transparent)`,
                color, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 6,
              }}
            >
              ✦ Refine
            </button>
          )}

          <div style={{ flex: 1 }} />

          {(node.model_name || node.integration_type) && (
            <span style={{ fontFamily: 'var(--font-mono)', fontSize: 9, color: 'var(--text-4)' }}>
              {node.model_name || node.integration_type}
            </span>
          )}
        </div>
      </div>{/* /content box */}
    </div>{/* /wrapper */}

    {/* RefinementModal */}
    {refinementOpen && imageUrl && (
      <div style={{ position: 'fixed', inset: 0, zIndex: 300 }}>
        <RefinementModal
          imageUrl={assetUrl(imageUrl)}
          imageId={node.step_key}
          project={project}
          storagePath={`projects/${project.id}/pipeline/${node.step_key}/image.png`}
          onRefined={handleRefined}
          onClose={() => setRefinementOpen(false)}
        />
      </div>
    )}

    {/* Fullsize image overlay */}
    {fullsizeUrl && (
      <div
        onClick={() => setFullsizeUrl(null)}
        style={{ position: 'fixed', inset: 0, zIndex: 400, background: 'rgba(0,0,0,0.92)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 32, cursor: 'zoom-out' }}
      >
        <img
          src={fullsizeUrl}
          alt=""
          style={{ maxWidth: '100%', maxHeight: '100%', objectFit: 'contain', borderRadius: 10, boxShadow: '0 32px 80px rgba(0,0,0,0.8)' }}
        />
        <button
          onClick={() => setFullsizeUrl(null)}
          style={{ position: 'absolute', top: 56, right: 16, width: 36, height: 36, borderRadius: 8, background: 'rgba(255,255,255,0.18)', border: '1px solid rgba(255,255,255,0.4)', color: 'white', fontSize: 18, cursor: 'pointer', display: 'grid', placeItems: 'center', transition: 'background 120ms' }}
          onMouseEnter={e => (e.currentTarget.style.background = 'rgba(255,255,255,0.32)')}
          onMouseLeave={e => (e.currentTarget.style.background = 'rgba(255,255,255,0.18)')}
          title="Close (Esc)"
        >✕</button>
      </div>
    )}
    </>
  )
}
