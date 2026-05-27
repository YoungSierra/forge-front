'use client'

import { useEffect, useState, useCallback } from 'react'
import { BACKEND_URL } from '@/lib/api'

function adminFetch(path: string, options?: RequestInit) {
  const memberId = typeof window !== 'undefined' ? localStorage.getItem('forge_member_id') : null
  return fetch(`${BACKEND_URL}${path}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...(memberId ? { 'x-member-id': memberId } : {}),
      ...(options?.headers as Record<string, string> | undefined),
    },
  })
}

// ─── Tipos ────────────────────────────────────────────────────

interface ForgeNode {
  id:       string
  node_key: string
  title:    string
  phase:    string
  purpose:  string
}

interface NodeSequenceItem {
  node_id:     string
  order_index: number
}

interface Edge {
  from_node_id: string
  to_node_id:   string
}

interface Gate {
  name:               string
  mode:               string
  suggested_rubrics:  string[]
  outcomes:           string[]
}

interface ForgeBlueprint {
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

const PHASES = ['ideation', 'concept', 'pre-production', 'production', 'live-ops']

const PHASE_COLOR: Record<string, string> = {
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

// ─── Blueprint Form ───────────────────────────────────────────

const EMPTY_BP: Partial<ForgeBlueprint> = {
  blueprint_key: '', name: '', phase: 'ideation', description: '',
  node_sequence: [], edges: [], is_default: false,
  gate: { name: '', mode: 'conversational', suggested_rubrics: [], outcomes: ['accept', 'refine', 'kill'] },
}

function BlueprintForm({ blueprint, allNodes, onSave, onCancel }: {
  blueprint: Partial<ForgeBlueprint>
  allNodes:  ForgeNode[]
  onSave:    (data: Partial<ForgeBlueprint>) => Promise<void>
  onCancel:  () => void
}) {
  const [form, setForm] = useState<Partial<ForgeBlueprint>>(blueprint)
  const [saving, setSaving] = useState(false)
  const [error,  setError]  = useState('')
  const [rubricDraft, setRubricDraft] = useState('')

  const set = (key: keyof ForgeBlueprint, val: unknown) =>
    setForm(f => ({ ...f, [key]: val }))

  const setGate = (key: keyof Gate, val: unknown) =>
    setForm(f => ({ ...f, gate: { ...(f.gate as Gate), [key]: val } }))

  // Nodos disponibles para añadir (misma fase, no en la secuencia ya)
  const phaseNodes    = allNodes.filter(n => n.phase === form.phase)
  const sequenceIds   = (form.node_sequence || []).map(s => s.node_id)
  const availableNodes = phaseNodes.filter(n => !sequenceIds.includes(n.id))

  const addNode = (nodeId: string) => {
    const next = [...(form.node_sequence || []), { node_id: nodeId, order_index: (form.node_sequence || []).length + 1 }]
    const edges = buildEdges(next)
    setForm(f => ({ ...f, node_sequence: next, edges }))
  }

  const removeNode = (nodeId: string) => {
    const next = (form.node_sequence || [])
      .filter(s => s.node_id !== nodeId)
      .map((s, i) => ({ ...s, order_index: i + 1 }))
    const edges = buildEdges(next)
    setForm(f => ({ ...f, node_sequence: next, edges }))
  }

  const moveNode = (nodeId: string, dir: -1 | 1) => {
    const seq  = [...(form.node_sequence || [])]
    const idx  = seq.findIndex(s => s.node_id === nodeId)
    const swap = idx + dir
    if (swap < 0 || swap >= seq.length) return
    ;[seq[idx], seq[swap]] = [seq[swap], seq[idx]]
    const next  = seq.map((s, i) => ({ ...s, order_index: i + 1 }))
    const edges = buildEdges(next)
    setForm(f => ({ ...f, node_sequence: next, edges }))
  }

  const buildEdges = (seq: NodeSequenceItem[]): Edge[] =>
    seq.slice(0, -1).map((s, i) => ({
      from_node_id: s.node_id,
      to_node_id:   seq[i + 1].node_id,
    }))

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
      setError('blueprint_key, name y phase son requeridos')
      return
    }
    setSaving(true)
    setError('')
    try { await onSave(form) }
    catch (e) { setError(e instanceof Error ? e.message : 'Error al guardar') }
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
        <div style={{ fontSize: 11, fontFamily: 'var(--font-mono)', fontWeight: 700, color: 'var(--text-2)', marginBottom: 12, textTransform: 'uppercase', letterSpacing: '0.06em' }}>
          Node Sequence
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>

          {/* Librería disponible */}
          <div>
            {lbl('available nodes — click to add')}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 4, maxHeight: 280, overflowY: 'auto' }}>
              {availableNodes.length === 0 && (
                <div style={{ fontSize: 11, fontFamily: 'var(--font-mono)', color: 'var(--text-3)', padding: '8px 0' }}>
                  All nodes in this phase are already added.
                </div>
              )}
              {availableNodes.map(n => (
                <button key={n.id} onClick={() => addNode(n.id)} style={{
                  border: '1px solid var(--line-2)', background: 'var(--bg-1)', borderRadius: 6,
                  padding: '7px 10px', textAlign: 'left', cursor: 'pointer',
                  display: 'flex', alignItems: 'center', gap: 8,
                }}>
                  <span style={{
                    fontSize: 9, fontFamily: 'var(--font-mono)', fontWeight: 700,
                    padding: '2px 5px', borderRadius: 3,
                    background: `color-mix(in srgb, ${PHASE_COLOR[n.phase] ?? '#6b7280'} 15%, var(--bg-2))`,
                    color: PHASE_COLOR[n.phase] ?? '#6b7280',
                  }}>{n.node_key}</span>
                  <span style={{ fontSize: 11, fontFamily: 'var(--font-mono)', color: 'var(--text-1)' }}>{n.title}</span>
                </button>
              ))}
            </div>
          </div>

          {/* Secuencia ordenada */}
          <div>
            {lbl('sequence — drag to reorder')}
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

// ─── Página principal ─────────────────────────────────────────

export default function AdminBlueprintsPage() {
  const [blueprints, setBlueprints] = useState<ForgeBlueprint[]>([])
  const [allNodes,   setAllNodes]   = useState<ForgeNode[]>([])
  const [loading,    setLoading]    = useState(true)
  const [selected,   setSelected]   = useState<Partial<ForgeBlueprint> | null>(null)
  const [isNew,      setIsNew]      = useState(false)
  const [error,      setError]      = useState('')

  const fetchAll = useCallback(async () => {
    setLoading(true)
    try {
      const [bpRes, nodesRes] = await Promise.all([
        adminFetch(`/api/admin/forge/blueprints`),
        adminFetch(`/api/admin/forge/nodes`),
      ])
      const [bpJson, nodesJson] = await Promise.all([bpRes.json(), nodesRes.json()])
      if (!bpJson.success)    throw new Error(bpJson.error)
      if (!nodesJson.success) throw new Error(nodesJson.error)
      setBlueprints(bpJson.blueprints)
      setAllNodes(nodesJson.nodes)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Error al cargar')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { fetchAll() }, [fetchAll])

  const handleNew  = () => { setSelected({ ...EMPTY_BP }); setIsNew(true) }
  const handleEdit = (b: ForgeBlueprint) => { setSelected({ ...b }); setIsNew(false) }
  const handleCancel = () => { setSelected(null); setIsNew(false) }

  const handleSave = async (data: Partial<ForgeBlueprint>) => {
    const path   = isNew ? `/api/admin/forge/blueprints` : `/api/admin/forge/blueprints/${data.id}`
    const method = isNew ? 'POST' : 'PATCH'
    const res  = await adminFetch(path, { method, body: JSON.stringify(data) })
    const json = await res.json()
    if (!json.success) throw new Error(json.error)
    if (isNew && json.blueprint) {
      setSelected(json.blueprint)
      setIsNew(false)
    }
    fetchAll()
  }

  const getNodeTitle = (id: string) => allNodes.find(n => n.id === id)?.title ?? id

  return (
    <div style={{ height: '100%', display: 'flex', overflow: 'hidden' }}>

      {/* Lista */}
      <div style={{
        width: 320, flexShrink: 0,
        borderRight: '1px solid var(--line-2)',
        display: 'flex', flexDirection: 'column', overflow: 'hidden',
      }}>
        <div style={{
          padding: '12px 16px', borderBottom: '1px solid var(--line-2)',
          display: 'flex', alignItems: 'center', gap: 10, flexShrink: 0,
          background: 'var(--bg-1)',
        }}>
          <span style={{ fontSize: 12, fontFamily: 'var(--font-mono)', fontWeight: 700, color: 'var(--text-1)', flex: 1 }}>
            Blueprints
          </span>
          <button onClick={handleNew} style={{
            padding: '6px 12px', borderRadius: 6, border: 'none',
            background: 'var(--action)', color: 'var(--action-fg)',
            fontSize: 11, fontFamily: 'var(--font-mono)', fontWeight: 700, cursor: 'pointer',
          }}>
            + New Blueprint
          </button>
        </div>

        <div style={{ flex: 1, overflowY: 'auto', padding: 12, display: 'flex', flexDirection: 'column', gap: 6 }}>
          {error && <div style={{ fontSize: 11, fontFamily: 'var(--font-mono)', color: '#F87171', padding: '8px 0' }}>{error}</div>}
          {loading && <div style={{ fontSize: 11, fontFamily: 'var(--font-mono)', color: 'var(--text-3)', padding: '8px 0' }}>Loading…</div>}
          {!loading && blueprints.map(b => {
            const isActive = selected && (selected as ForgeBlueprint).id === b.id
            return (
              <div key={b.id} onClick={() => handleEdit(b)} style={{
                padding: '12px 14px', borderRadius: 8, cursor: 'pointer',
                background: isActive ? 'color-mix(in srgb, var(--action) 10%, var(--bg-1))' : 'var(--bg-1)',
                border: `1px solid ${isActive ? 'color-mix(in srgb, var(--action) 30%, var(--line-2))' : 'var(--line-2)'}`,
              }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
                  <span style={{
                    fontSize: 9, fontFamily: 'var(--font-mono)', fontWeight: 700,
                    padding: '2px 6px', borderRadius: 4,
                    background: `color-mix(in srgb, ${PHASE_COLOR[b.phase] ?? '#6b7280'} 15%, var(--bg-2))`,
                    color: PHASE_COLOR[b.phase] ?? '#6b7280',
                  }}>{b.phase}</span>
                  <span style={{ fontSize: 12, fontFamily: 'var(--font-mono)', fontWeight: 600, color: 'var(--text-1)', flex: 1 }}>{b.name}</span>
                  {b.is_default && (
                    <span style={{ fontSize: 9, fontFamily: 'var(--font-mono)', color: 'var(--action)', background: 'color-mix(in srgb, var(--action) 10%, var(--bg-2))', padding: '2px 6px', borderRadius: 4 }}>default</span>
                  )}
                </div>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
                  {b.node_sequence.map((s, i) => (
                    <span key={s.node_id} style={{ fontSize: 9, fontFamily: 'var(--font-mono)', color: 'var(--text-3)' }}>
                      {i > 0 && '→ '}{getNodeTitle(s.node_id)}
                    </span>
                  ))}
                </div>
              </div>
            )
          })}
        </div>
      </div>

      {/* Formulario / placeholder */}
      <div style={{ flex: 1, overflowY: 'auto', padding: 24 }}>
        {selected ? (
          <>
            <div style={{ fontSize: 13, fontFamily: 'var(--font-mono)', fontWeight: 700, color: 'var(--text-1)', marginBottom: 20 }}>
              {isNew ? 'New Blueprint' : `Edit — ${(selected as ForgeBlueprint).name}`}
            </div>
            <BlueprintForm
              key={(selected as ForgeBlueprint).id ?? 'new'}
              blueprint={selected}
              allNodes={allNodes}
              onSave={handleSave}
              onCancel={handleCancel}
            />
          </>
        ) : (
          <div style={{
            height: '100%', display: 'flex', flexDirection: 'column',
            alignItems: 'center', justifyContent: 'center', gap: 12,
            color: 'var(--text-4)',
          }}>
            <div style={{ fontSize: 32, opacity: 0.3 }}>⬡</div>
            <div style={{ fontSize: 12, fontFamily: 'var(--font-mono)' }}>Select a blueprint to edit</div>
          </div>
        )}
      </div>
    </div>
  )
}
