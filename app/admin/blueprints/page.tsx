'use client'

import { useEffect, useState, useCallback } from 'react'
import { BACKEND_URL } from '@/lib/api'
import { BlueprintForm, EMPTY_BP, PHASE_COLOR, type ForgeBlueprint, type ForgeNode } from '@/components/BlueprintForm'

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
            Blueprint Management System
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
