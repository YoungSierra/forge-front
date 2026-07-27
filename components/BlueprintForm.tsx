'use client'

import { useState } from 'react'

// ─── Tipos (compartidos entre el BMS super-admin y la consola org-admin) ──────
export interface ForgeNode {
  id:        string
  node_key:  string
  title:     string
  phase:     string
  purpose?:  string
  executor?: { type?: string }
}

export interface NodeSequenceItem {
  node_id:     string
  order_index: number
}

export interface Edge {
  from_node_id: string
  to_node_id:   string
}

export interface Gate {
  name:               string
  mode:               string
  suggested_rubrics:  string[]
  outcomes:           string[]
}

export interface ForgeBlueprint {
  id:            string
  blueprint_key: string
  name:          string
  phase:         string
  description:   string | null
  node_sequence: NodeSequenceItem[]
  edges:         Edge[]
  gate:          Gate
  is_default:    boolean
  created_at:    string
}

const EXECUTOR_LABEL: Record<string, string> = {
  llm:     'LLM',
  comfyui: 'ComfyUI',
  hybrid:  'Hybrid',
}

export const PHASES = ['ideation', 'concept', 'pre-production', 'production', 'live-ops']

export const PHASE_COLOR: Record<string, string> = {
  ideation:         '#2DD4BF',
  concept:          '#818CF8',
  'pre-production': '#F59E0B',
  production:       '#34D399',
  'live-ops':       '#F87171',
}

const inputSx: React.CSSProperties = {
  width: '100%', background: 'var(--bg-1)', border: '1px solid var(--line-2)',
  borderRadius: 6, color: 'var(--text-1)', fontSize: 12,
  fontFamily: 'var(--font-mono)', padding: '7px 10px', boxSizing: 'border-box', outline: 'none',
}

const lbl = (text: string) => (
  <div style={{ fontSize: 10, fontFamily: 'var(--font-mono)', color: 'var(--text-3)', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 5 }}>
    {text}
  </div>
)

export const EMPTY_BP: Partial<ForgeBlueprint> = {
  blueprint_key: '', name: '', phase: 'ideation', description: '',
  node_sequence: [], edges: [], is_default: false,
  gate: { name: '', mode: 'conversational', suggested_rubrics: [], outcomes: ['accept', 'refine', 'kill'] },
}

// ─── Blueprint Form (identity + secuencia de nodos con vista canvas/list + gate) ──
export function BlueprintForm({ blueprint, allNodes, onSave, onCancel }: {
  blueprint: Partial<ForgeBlueprint>
  allNodes:  ForgeNode[]
  onSave:    (data: Partial<ForgeBlueprint>) => Promise<void>
  onCancel:  () => void
}) {
  const [form, setForm] = useState<Partial<ForgeBlueprint>>(blueprint)
  const [saving, setSaving] = useState(false)
  const [error,  setError]  = useState('')
  const [rubricDraft, setRubricDraft] = useState('')
  const [seqViewMode,   setSeqViewMode]   = useState<'list' | 'canvas'>('canvas')
  const [dragIdx,       setDragIdx]       = useState<number | null>(null)
  const [dragOverIdx,   setDragOverIdx]   = useState<number | null>(null)
  const [dragType,      setDragType]      = useState<'reorder' | 'add' | null>(null)
  const [dragAddNodeId, setDragAddNodeId] = useState<string | null>(null)

  const set = (key: keyof ForgeBlueprint, val: unknown) =>
    setForm(f => ({ ...f, [key]: val }))

  const setGate = (key: keyof Gate, val: unknown) =>
    setForm(f => ({ ...f, gate: { ...(f.gate as Gate), [key]: val } }))

  // Nodos disponibles para añadir (misma fase, no en la secuencia ya)
  const phaseNodes    = allNodes.filter(n => n.phase === form.phase)
  const sequenceIds   = (form.node_sequence || []).map(s => s.node_id)
  const availableNodes = phaseNodes.filter(n => !sequenceIds.includes(n.id))

  const buildEdges = (seq: NodeSequenceItem[]): Edge[] =>
    seq.slice(0, -1).map((s, i) => ({
      from_node_id: s.node_id,
      to_node_id:   seq[i + 1].node_id,
    }))

  const addNode = (nodeId: string) => {
    const next = [...(form.node_sequence || []), { node_id: nodeId, order_index: (form.node_sequence || []).length + 1 }]
    setForm(f => ({ ...f, node_sequence: next, edges: buildEdges(next) }))
  }

  const removeNode = (nodeId: string) => {
    const next = (form.node_sequence || [])
      .filter(s => s.node_id !== nodeId)
      .map((s, i) => ({ ...s, order_index: i + 1 }))
    setForm(f => ({ ...f, node_sequence: next, edges: buildEdges(next) }))
  }

  const moveNode = (nodeId: string, dir: -1 | 1) => {
    const seq  = [...(form.node_sequence || [])]
    const idx  = seq.findIndex(s => s.node_id === nodeId)
    const swap = idx + dir
    if (swap < 0 || swap >= seq.length) return
    ;[seq[idx], seq[swap]] = [seq[swap], seq[idx]]
    const next  = seq.map((s, i) => ({ ...s, order_index: i + 1 }))
    setForm(f => ({ ...f, node_sequence: next, edges: buildEdges(next) }))
  }

  const resetDrag = () => {
    setDragIdx(null); setDragOverIdx(null); setDragType(null); setDragAddNodeId(null)
  }

  const handleCanvasDrop = (targetIdx: number) => {
    if (dragType === 'reorder') {
      if (dragIdx === null || dragIdx === targetIdx) { resetDrag(); return }
      const seq = [...(form.node_sequence || [])]
      const [moved] = seq.splice(dragIdx, 1)
      seq.splice(targetIdx, 0, moved)
      const next = seq.map((s, i) => ({ ...s, order_index: i + 1 }))
      setForm(f => ({ ...f, node_sequence: next, edges: buildEdges(next) }))
    } else if (dragType === 'add' && dragAddNodeId) {
      const seq = [...(form.node_sequence || [])]
      seq.splice(targetIdx, 0, { node_id: dragAddNodeId, order_index: 0 })
      const next = seq.map((s, i) => ({ ...s, order_index: i + 1 }))
      setForm(f => ({ ...f, node_sequence: next, edges: buildEdges(next) }))
    }
    resetDrag()
  }

  const addRubric = () => {
    const v = rubricDraft.trim()
    if (!v) return
    const rubrics = (form.gate as Gate)?.suggested_rubrics || []
    setGate('suggested_rubrics', [...rubrics, v])
    setRubricDraft('')
  }

  const removeRubric = (i: number) => {
    const rubrics = [...((form.gate as Gate)?.suggested_rubrics || [])]
    rubrics.splice(i, 1)
    setGate('suggested_rubrics', rubrics)
  }

  const getNode = (id: string) => allNodes.find(n => n.id === id)

  const handleSave = async () => {
    if (!form.blueprint_key || !form.name || !form.phase) {
      setError('blueprint_key, name and phase are required')
      return
    }
    setSaving(true)
    setError('')
    try { await onSave(form) }
    catch (e) { setError(e instanceof Error ? e.message : 'Save error') }
    finally { setSaving(false) }
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>

      {/* Identidad */}
      <section>
        <div style={{ fontSize: 11, fontFamily: 'var(--font-mono)', fontWeight: 700, color: 'var(--text-2)', marginBottom: 12, textTransform: 'uppercase', letterSpacing: '0.06em' }}>
          Identity
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 12 }}>
          <div>
            {lbl('blueprint_key')}
            <input style={inputSx} value={form.blueprint_key || ''} onChange={e => set('blueprint_key', e.target.value)} placeholder="ideation_default" />
          </div>
          <div>
            {lbl('name')}
            <input style={inputSx} value={form.name || ''} onChange={e => set('name', e.target.value)} placeholder="Ideation Blueprint" />
          </div>
          <div>
            {lbl('phase')}
            <select style={{ ...inputSx, width: '100%' }} value={form.phase || 'ideation'} onChange={e => set('phase', e.target.value)}>
              {PHASES.map(p => <option key={p} value={p}>{p}</option>)}
            </select>
          </div>
        </div>
        <div style={{ marginTop: 12 }}>
          {lbl('description')}
          <input style={inputSx} value={form.description || ''} onChange={e => set('description', e.target.value)} placeholder="Recommended starting workflow…" />
        </div>
        <div style={{ marginTop: 10, display: 'flex', alignItems: 'center', gap: 8 }}>
          <input type="checkbox" id="is_default" checked={!!form.is_default} onChange={e => set('is_default', e.target.checked)} />
          <label htmlFor="is_default" style={{ fontSize: 11, fontFamily: 'var(--font-mono)', color: 'var(--text-2)', cursor: 'pointer' }}>
            Default blueprint for this phase
          </label>
        </div>
      </section>

      {/* Node sequence */}
      <section>
        <div style={{ display: 'flex', alignItems: 'center', marginBottom: 12 }}>
          <div style={{ fontSize: 11, fontFamily: 'var(--font-mono)', fontWeight: 700, color: 'var(--text-2)', textTransform: 'uppercase', letterSpacing: '0.06em', flex: 1 }}>
            Node Sequence
          </div>
          {/* Toggle list / canvas */}
          <div style={{ display: 'flex', gap: 2, background: 'var(--bg-0)', border: '1px solid var(--line-2)', borderRadius: 6, padding: 2 }}>
            {(['list', 'canvas'] as const).map(mode => (
              <button key={mode} onClick={() => setSeqViewMode(mode)} style={{
                padding: '3px 10px', borderRadius: 4, border: 'none', cursor: 'pointer',
                fontSize: 10, fontFamily: 'var(--font-mono)', fontWeight: 600,
                background: seqViewMode === mode ? 'var(--bg-3)' : 'transparent',
                color: seqViewMode === mode ? 'var(--text-1)' : 'var(--text-4)',
                transition: 'background 0.15s, color 0.15s',
              }}>{mode === 'list' ? '≡ List' : '⬡ Canvas'}</button>
            ))}
          </div>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '200px 1fr', gap: 16 }}>

          {/* Librería disponible */}
          <div>
            {lbl('available nodes')}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 4, maxHeight: seqViewMode === 'canvas' ? 180 : 280, overflowY: 'auto' }}>
              {availableNodes.length === 0 && (
                <div style={{ fontSize: 11, fontFamily: 'var(--font-mono)', color: 'var(--text-3)', padding: '8px 0' }}>
                  All nodes added.
                </div>
              )}
              {availableNodes.map(n => (
                <button
                  key={n.id}
                  draggable={seqViewMode === 'canvas'}
                  onDragStart={() => { setDragType('add'); setDragAddNodeId(n.id) }}
                  onDragEnd={resetDrag}
                  onClick={() => addNode(n.id)}
                  style={{
                    border: '1px solid var(--line-2)', background: 'var(--bg-1)', borderRadius: 6,
                    padding: '6px 8px', textAlign: 'left',
                    cursor: seqViewMode === 'canvas' ? 'grab' : 'pointer',
                    display: 'flex', alignItems: 'center', gap: 6,
                  }}
                >
                  <span style={{
                    fontSize: 9, fontFamily: 'var(--font-mono)', fontWeight: 700,
                    padding: '2px 5px', borderRadius: 3, flexShrink: 0,
                    background: `color-mix(in srgb, ${PHASE_COLOR[n.phase] ?? '#6b7280'} 15%, var(--bg-2))`,
                    color: PHASE_COLOR[n.phase] ?? '#6b7280',
                  }}>{n.node_key}</span>
                  <span style={{ fontSize: 10, fontFamily: 'var(--font-mono)', color: 'var(--text-1)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{n.title}</span>
                </button>
              ))}
            </div>
          </div>

          {/* Secuencia — vista lista */}
          {seqViewMode === 'list' && (
            <div>
              {lbl('sequence — use arrows to reorder')}
              <div style={{ display: 'flex', flexDirection: 'column', gap: 4, minHeight: 60 }}>
                {(form.node_sequence || []).map((s, i) => {
                  const n = getNode(s.node_id)
                  if (!n) return null
                  return (
                    <div key={s.node_id} style={{
                      border: '1px solid var(--line-2)', background: 'var(--bg-2)',
                      borderRadius: 6, padding: '7px 10px',
                      display: 'flex', alignItems: 'center', gap: 8,
                    }}>
                      <span style={{ fontSize: 10, fontFamily: 'var(--font-mono)', color: 'var(--text-3)', width: 16, textAlign: 'center' }}>{i + 1}</span>
                      <span style={{
                        fontSize: 9, fontFamily: 'var(--font-mono)', fontWeight: 700,
                        padding: '2px 5px', borderRadius: 3,
                        background: `color-mix(in srgb, ${PHASE_COLOR[n.phase] ?? '#6b7280'} 15%, var(--bg-2))`,
                        color: PHASE_COLOR[n.phase] ?? '#6b7280',
                      }}>{n.node_key}</span>
                      <span style={{ fontSize: 11, fontFamily: 'var(--font-mono)', color: 'var(--text-1)', flex: 1 }}>{n.title}</span>
                      <div style={{ display: 'flex', gap: 2 }}>
                        <button onClick={() => moveNode(s.node_id, -1)} disabled={i === 0}
                          style={{ border: 'none', background: 'none', cursor: i === 0 ? 'default' : 'pointer', color: 'var(--text-3)', fontSize: 12, opacity: i === 0 ? 0.3 : 1 }}>↑</button>
                        <button onClick={() => moveNode(s.node_id, 1)} disabled={i === (form.node_sequence || []).length - 1}
                          style={{ border: 'none', background: 'none', cursor: 'pointer', color: 'var(--text-3)', fontSize: 12, opacity: i === (form.node_sequence || []).length - 1 ? 0.3 : 1 }}>↓</button>
                        <button onClick={() => removeNode(s.node_id)}
                          style={{ border: 'none', background: 'none', cursor: 'pointer', color: '#F87171', fontSize: 14, marginLeft: 2 }}>×</button>
                      </div>
                    </div>
                  )
                })}
                {(form.node_sequence || []).length === 0 && (
                  <div style={{ fontSize: 11, fontFamily: 'var(--font-mono)', color: 'var(--text-3)', padding: '12px 0' }}>
                    No nodes added yet. Click nodes on the left to add them.
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Secuencia — vista canvas */}
          {seqViewMode === 'canvas' && (
            <div>
              {lbl('canvas — drag cards to reorder')}
              <div
                onDragOver={e => e.preventDefault()}
                onDrop={() => {
                  if (dragType === 'add' && dragAddNodeId) { addNode(dragAddNodeId); resetDrag() }
                }}
                style={{
                  background: 'var(--bg-0)', border: '1px solid var(--line-2)', borderRadius: 8,
                  padding: '16px 20px', minHeight: 140, overflowX: 'auto',
                  display: 'flex', alignItems: 'center', gap: 0, flexWrap: 'nowrap',
                }}
              >
                {(form.node_sequence || []).length === 0 && (
                  <div style={{ fontSize: 11, fontFamily: 'var(--font-mono)', color: 'var(--text-3)' }}>
                    Click nodes on the left to add them.
                  </div>
                )}
                {(form.node_sequence || []).map((s, i) => {
                  const n = getNode(s.node_id)
                  if (!n) return null
                  const isDragging   = dragType === 'reorder' && dragIdx === i
                  const isDropTarget = dragOverIdx === i && (
                    (dragType === 'reorder' && dragIdx !== null && dragIdx !== i) ||
                    dragType === 'add'
                  )
                  return (
                    <div key={s.node_id} style={{ display: 'flex', alignItems: 'center', flexShrink: 0 }}>
                      {/* Conector */}
                      {i > 0 && (
                        <div style={{ color: 'var(--text-4)', fontSize: 14, padding: '0 6px', flexShrink: 0 }}>→</div>
                      )}
                      {/* Tarjeta estilo ForgeNodeCard */}
                      <div
                        draggable
                        onDragStart={() => { setDragIdx(i); setDragType('reorder') }}
                        onDragOver={e => { e.preventDefault(); e.stopPropagation(); setDragOverIdx(i) }}
                        onDragEnd={resetDrag}
                        onDrop={e => { e.stopPropagation(); handleCanvasDrop(i) }}
                        style={{
                          width: 168, flexShrink: 0,
                          background: 'var(--bg-1)',
                          border: `1px solid ${isDropTarget ? 'var(--action)' : 'var(--line-2)'}`,
                          boxShadow: isDropTarget
                            ? `0 0 0 1px var(--action), 0 0 14px color-mix(in srgb, var(--action) 30%, transparent)`
                            : '0 4px 20px rgba(0,0,0,0.24)',
                          borderRadius: 8, cursor: 'grab',
                          position: 'relative', opacity: isDragging ? 0.4 : 1,
                          transition: 'border-color 0.12s, opacity 0.12s, box-shadow 0.12s',
                          userSelect: 'none',
                        }}
                      >
                        {/* Header con color de fase */}
                        <div style={{
                          background: `color-mix(in srgb, ${PHASE_COLOR[n.phase] ?? '#6b7280'} 14%, var(--bg-2))`,
                          borderBottom: `1px solid color-mix(in srgb, ${PHASE_COLOR[n.phase] ?? '#6b7280'} 22%, var(--line-2))`,
                          borderRadius: '7px 7px 0 0',
                          padding: '8px 10px',
                          display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 6,
                        }}>
                          <div style={{ flex: 1, minWidth: 0, display: 'flex', alignItems: 'baseline', gap: 5, overflow: 'hidden', whiteSpace: 'nowrap' }}>
                            <span style={{ fontSize: 9, fontFamily: 'var(--font-mono)', fontWeight: 700, color: PHASE_COLOR[n.phase] ?? '#6b7280', flexShrink: 0 }}>
                              {n.node_key}
                            </span>
                            <span style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-0)', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                              {n.title}
                            </span>
                          </div>
                          {n.executor?.type && (
                            <span style={{
                              flexShrink: 0,
                              fontSize: 8, fontFamily: 'var(--font-mono)',
                              color: `color-mix(in srgb, ${PHASE_COLOR[n.phase] ?? '#6b7280'} 70%, var(--text-3))`,
                              background: `color-mix(in srgb, ${PHASE_COLOR[n.phase] ?? '#6b7280'} 8%, var(--bg-3))`,
                              border: `1px solid color-mix(in srgb, ${PHASE_COLOR[n.phase] ?? '#6b7280'} 18%, var(--line-2))`,
                              padding: '1px 5px', borderRadius: 3,
                            }}>
                              {EXECUTOR_LABEL[n.executor.type] ?? n.executor.type}
                            </span>
                          )}
                        </div>
                        {/* Índice en el body */}
                        <div style={{ padding: '5px 10px 6px', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                          <span style={{ fontSize: 9, fontFamily: 'var(--font-mono)', color: 'var(--text-4)' }}>#{i + 1}</span>
                          {/* Botón quitar */}
                          <button
                            onMouseDown={e => e.stopPropagation()}
                            onClick={e => { e.stopPropagation(); removeNode(s.node_id) }}
                            style={{
                              border: 'none', background: 'none', cursor: 'pointer',
                              color: 'var(--text-4)', fontSize: 13, lineHeight: 1, padding: '2px 4px',
                            }}
                          >×</button>
                        </div>
                      </div>
                    </div>
                  )
                })}
              </div>
            </div>
          )}
        </div>
      </section>

      {/* Gate */}
      <section>
        <div style={{ fontSize: 11, fontFamily: 'var(--font-mono)', fontWeight: 700, color: 'var(--text-2)', marginBottom: 12, textTransform: 'uppercase', letterSpacing: '0.06em' }}>
          Gate
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <div>
            {lbl('gate name')}
            <input style={inputSx} value={(form.gate as Gate)?.name || ''}
              onChange={e => setGate('name', e.target.value)} placeholder="Ideation Review" />
          </div>
          <div>
            {lbl('suggested rubrics (guidance, not checkboxes)')}
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5, marginBottom: 6 }}>
              {((form.gate as Gate)?.suggested_rubrics || []).map((r, i) => (
                <span key={i} style={{
                  fontSize: 10, fontFamily: 'var(--font-mono)', padding: '3px 8px',
                  background: 'var(--bg-3)', borderRadius: 4, color: 'var(--text-1)',
                  display: 'flex', alignItems: 'center', gap: 5,
                }}>
                  {r}
                  <button onClick={() => removeRubric(i)}
                    style={{ border: 'none', background: 'none', cursor: 'pointer', color: 'var(--text-3)', fontSize: 11, padding: 0 }}>×</button>
                </span>
              ))}
            </div>
            <div style={{ display: 'flex', gap: 6 }}>
              <input style={{ ...inputSx, flex: 1 }} value={rubricDraft}
                placeholder="clear hook"
                onChange={e => setRubricDraft(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); addRubric() } }} />
              <button onClick={addRubric} style={{
                padding: '6px 12px', borderRadius: 6, border: '1px solid var(--line-2)',
                background: 'var(--bg-2)', color: 'var(--text-1)', cursor: 'pointer',
                fontSize: 12, fontFamily: 'var(--font-mono)',
              }}>+</button>
            </div>
          </div>
          <div>
            {lbl('outcomes (always: accept, refine, kill)')}
            <div style={{ display: 'flex', gap: 6 }}>
              {['accept', 'refine', 'kill'].map(o => (
                <span key={o} style={{
                  fontSize: 10, fontFamily: 'var(--font-mono)', padding: '3px 10px',
                  background: 'var(--bg-3)', borderRadius: 4, color: 'var(--text-2)',
                }}>{o}</span>
              ))}
            </div>
          </div>
        </div>
      </section>

      {error && (
        <div style={{ fontSize: 11, fontFamily: 'var(--font-mono)', color: '#F87171' }}>{error}</div>
      )}

      <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', paddingTop: 8, borderTop: '1px solid var(--line-2)' }}>
        <button type="button" onClick={onCancel} style={{
          padding: '7px 16px', borderRadius: 6, border: '1px solid var(--line-2)',
          background: 'var(--bg-2)', color: 'var(--text-2)', cursor: 'pointer',
          fontSize: 12, fontFamily: 'var(--font-mono)',
        }}>Cancel</button>
        <button type="button" onClick={handleSave} disabled={saving} style={{
          padding: '7px 16px', borderRadius: 6, border: 'none',
          background: 'var(--action)', color: 'var(--action-fg)',
          cursor: saving ? 'not-allowed' : 'pointer',
          fontSize: 12, fontFamily: 'var(--font-mono)', fontWeight: 700,
          opacity: saving ? 0.6 : 1,
        }}>
          {saving ? 'Saving…' : 'Save Blueprint'}
        </button>
      </div>
    </div>
  )
}
