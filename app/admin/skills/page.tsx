'use client'

import { useEffect, useState, useCallback } from 'react'
import { getAdminSkillConfigs, updateAdminSkillConfig, type SkillConfig } from '@/lib/api'

type RowState = {
  r2_path: string
  saving:  boolean
  saved:   boolean
  error:   string | null
  dirty:   boolean
}

export default function SkillsPage() {
  const [skills, setSkills]           = useState<SkillConfig[]>([])
  const [rows, setRows]               = useState<Record<string, RowState>>({})
  const [loading, setLoading]         = useState(true)
  const [globalError, setGlobalError] = useState<string | null>(null)

  useEffect(() => {
    getAdminSkillConfigs()
      .then(data => {
        setSkills(data)
        const initial: Record<string, RowState> = {}
        for (const s of data) {
          initial[s.key] = { r2_path: s.r2_path || '', saving: false, saved: false, error: null, dirty: false }
        }
        setRows(initial)
      })
      .catch(err => setGlobalError(err.message))
      .finally(() => setLoading(false))
  }, [])

  const handleChange = useCallback((key: string, value: string) => {
    setRows(prev => ({ ...prev, [key]: { ...prev[key], r2_path: value, dirty: true, saved: false, error: null } }))
  }, [])

  const handleSave = useCallback(async (key: string) => {
    const row = rows[key]
    if (!row) return
    setRows(prev => ({ ...prev, [key]: { ...prev[key], saving: true, error: null } }))
    try {
      const updated = await updateAdminSkillConfig(key, { r2_path: row.r2_path.trim() || null })
      setSkills(prev => prev.map(s => s.key === key ? updated : s))
      setRows(prev => ({ ...prev, [key]: { ...prev[key], saving: false, saved: true, dirty: false, r2_path: updated.r2_path || '' } }))
      setTimeout(() => setRows(prev => ({ ...prev, [key]: { ...prev[key], saved: false } })), 2000)
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Save failed'
      setRows(prev => ({ ...prev, [key]: { ...prev[key], saving: false, error: msg } }))
    }
  }, [rows])

  const cell: React.CSSProperties = {
    padding: '10px 12px', borderBottom: '1px solid var(--line-2)',
    verticalAlign: 'middle', fontSize: 12, fontFamily: 'monospace',
  }

  if (loading) return <div style={{ padding: 32, color: 'var(--text-3)', fontSize: 12, fontFamily: 'monospace' }}>Loading skills…</div>
  if (globalError) return <div style={{ padding: 32, color: '#ef4444', fontSize: 12, fontFamily: 'monospace' }}>Error: {globalError}</div>

  return (
    <div style={{ height: '100%', overflow: 'auto', padding: '24px 32px' }}>
      <div style={{ marginBottom: 24, maxWidth: 800 }}>
        <div style={{ fontSize: 14, fontFamily: 'monospace', fontWeight: 600, color: 'var(--text-0)', marginBottom: 6 }}>
          Skills
        </div>
        <div style={{ fontSize: 11, fontFamily: 'monospace', color: 'var(--text-3)', lineHeight: 1.6 }}>
          Cada skill es un <code style={{ background: 'var(--bg-2)', padding: '1px 4px', borderRadius: 3 }}>.md</code> en R2
          que se inyecta en el sistema prompt de los nodos que lo referencian.
          La lista se genera automáticamente desde los nodos del DNA.
        </div>
      </div>

      {skills.length === 0 ? (
        <div style={{ fontSize: 12, fontFamily: 'monospace', color: 'var(--text-3)', padding: '32px 0' }}>
          No hay skills registrados en ningún nodo del DNA.
        </div>
      ) : (
        <div style={{ background: 'var(--bg-1)', border: '1px solid var(--line-2)', borderRadius: 6, overflow: 'hidden' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr style={{ background: 'var(--bg-2)' }}>
                <th style={{ ...cell, color: 'var(--text-3)', textAlign: 'left', width: 240 }}>Skill key</th>
                <th style={{ ...cell, color: 'var(--text-3)', textAlign: 'left' }}>R2 path</th>
                <th style={{ ...cell, color: 'var(--text-3)', textAlign: 'left', width: 110 }}>Status</th>
                <th style={{ ...cell, color: 'var(--text-3)', textAlign: 'right', width: 80 }}></th>
              </tr>
            </thead>
            <tbody>
              {skills.map(s => {
                const row = rows[s.key]
                if (!row) return null
                const hasR2 = !!s.r2_path
                return (
                  <tr key={s.key} style={{ background: row.dirty ? 'var(--bg-2)' : 'transparent' }}>
                    <td style={{ ...cell, color: '#F59E0B', fontWeight: 600 }}>{s.key}</td>
                    <td style={cell}>
                      <input
                        value={row.r2_path}
                        onChange={e => handleChange(s.key, e.target.value)}
                        placeholder={`skills/${s.key}.md`}
                        style={{ width: '100%', background: 'var(--bg-0)', border: '1px solid var(--line-2)', borderRadius: 4, padding: '4px 8px', outline: 'none', color: 'var(--text-1)', fontSize: 12, fontFamily: 'var(--font-mono)' }}
                      />
                      {row.error && <div style={{ color: '#ef4444', fontSize: 10, marginTop: 3 }}>{row.error}</div>}
                    </td>
                    <td style={cell}>
                      <span style={{
                        display: 'inline-block', padding: '2px 8px', borderRadius: 10,
                        fontSize: 10, fontFamily: 'var(--font-mono)', fontWeight: 600,
                        background: hasR2 ? 'rgba(34,197,94,0.12)' : 'var(--bg-2)',
                        color: hasR2 ? 'var(--green, #22c55e)' : 'var(--text-3)',
                        border: `1px solid ${hasR2 ? 'rgba(34,197,94,0.3)' : 'var(--line-2)'}`,
                      }}>
                        {hasR2 ? 'R2 active' : 'Not set'}
                      </span>
                    </td>
                    <td style={{ ...cell, textAlign: 'right' }}>
                      {row.saved ? (
                        <span style={{ color: 'var(--green, #22c55e)', fontSize: 11, fontFamily: 'var(--font-mono)' }}>saved</span>
                      ) : (
                        <button
                          onClick={() => handleSave(s.key)}
                          disabled={!row.dirty || row.saving}
                          style={{ padding: '4px 12px', borderRadius: 4, fontSize: 11, fontFamily: 'var(--font-mono)', border: '1px solid var(--line-2)', cursor: row.dirty ? 'pointer' : 'default', background: row.dirty ? 'var(--action)' : 'var(--bg-2)', color: row.dirty ? '#fff' : 'var(--text-3)', opacity: row.saving ? 0.6 : 1, transition: 'background 120ms' }}
                        >
                          {row.saving ? '…' : 'Save'}
                        </button>
                      )}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}

      <div style={{ marginTop: 16, fontSize: 10, fontFamily: 'monospace', color: 'var(--text-3)' }}>
        Al guardar se valida que el archivo exista en R2 y se limpia el cache del backend.
      </div>
    </div>
  )
}
