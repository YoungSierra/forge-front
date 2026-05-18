'use client'

import { useEffect, useState, useCallback } from 'react'
import { getAdminPromptConfigs, updateAdminPromptConfig } from '@/lib/api'
import type { PromptConfig } from '@/lib/types'

type RowState = {
  r2_path: string
  description: string
  saving: boolean
  saved: boolean
  error: string | null
  dirty: boolean
}

export default function PromptsPage() {
  const [configs, setConfigs] = useState<PromptConfig[]>([])
  const [rows, setRows] = useState<Record<string, RowState>>({})
  const [loading, setLoading] = useState(true)
  const [globalError, setGlobalError] = useState<string | null>(null)
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set())

  useEffect(() => {
    getAdminPromptConfigs()
      .then(data => {
        setConfigs(data)
        const initial: Record<string, RowState> = {}
        for (const cfg of data) {
          initial[cfg.key] = {
            r2_path: cfg.r2_path || '',
            description: cfg.description || '',
            saving: false,
            saved: false,
            error: null,
            dirty: false,
          }
        }
        setRows(initial)
      })
      .catch(err => setGlobalError(err.message))
      .finally(() => setLoading(false))
  }, [])

  const handleChange = useCallback((key: string, field: 'r2_path' | 'description', value: string) => {
    setRows(prev => ({
      ...prev,
      [key]: { ...prev[key], [field]: value, dirty: true, saved: false, error: null },
    }))
  }, [])

  const handleSave = useCallback(async (key: string) => {
    const row = rows[key]
    if (!row) return
    setRows(prev => ({ ...prev, [key]: { ...prev[key], saving: true, error: null } }))
    try {
      const updated = await updateAdminPromptConfig(key, {
        r2_path: row.r2_path.trim() || null,
        description: row.description.trim() || null,
      })
      setConfigs(prev => prev.map(c => c.key === key ? updated : c))
      setRows(prev => ({
        ...prev,
        [key]: { ...prev[key], saving: false, saved: true, dirty: false,
          r2_path: updated.r2_path || '',
          description: updated.description || '',
        },
      }))
      setTimeout(() => setRows(prev => ({ ...prev, [key]: { ...prev[key], saved: false } })), 2000)
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Save failed'
      setRows(prev => ({ ...prev, [key]: { ...prev[key], saving: false, error: msg } }))
    }
  }, [rows])

  // Mapa de order_index por container key para construir el índice "1.2"
  const containerIndex = configs
    .filter(c => c.step_type === 'container')
    .reduce<Record<string, number>>((acc, c) => {
      acc[c.key] = c.order_index ?? 0
      return acc
    }, {})

  const cell: React.CSSProperties = {
    padding: '10px 12px',
    borderBottom: '1px solid var(--line-2)',
    verticalAlign: 'middle',
    fontSize: 12,
    fontFamily: 'monospace',
  }

  if (loading) return (
    <div style={{ padding: 32, color: 'var(--text-3)', fontSize: 12, fontFamily: 'monospace' }}>
      Loading prompt configs…
    </div>
  )

  if (globalError) return (
    <div style={{ padding: 32, color: 'var(--red)', fontSize: 12, fontFamily: 'monospace' }}>
      Error: {globalError}
    </div>
  )

  return (
    <div style={{ height: '100%', overflow: 'auto', padding: '24px 32px' }}>

      {/* Header */}
      <div style={{ marginBottom: 24, maxWidth: 800 }}>
        <div style={{ fontSize: 14, fontFamily: 'monospace', fontWeight: 600, color: 'var(--text-0)', marginBottom: 6 }}>
          System Prompts
        </div>
        <div style={{ fontSize: 11, fontFamily: 'monospace', color: 'var(--text-3)', lineHeight: 1.6 }}>
          Upload <code style={{ background: 'var(--bg-2)', padding: '1px 4px', borderRadius: 3 }}>.md</code> files
          to your R2 bucket via the Cloudflare Dashboard, then paste the object path here
          (e.g.{' '}
          <code style={{ background: 'var(--bg-2)', padding: '1px 4px', borderRadius: 3 }}>
            gdd.md
          </code>
          ). Leave blank to use the built-in fallback prompt. Only the backend reads R2 — the path is never exposed publicly.
        </div>
      </div>

      {/* Table */}
      <div style={{
        background: 'var(--bg-1)',
        border: '1px solid var(--line-2)',
        borderRadius: 6,
        overflow: 'hidden',
      }}>
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead>
            <tr style={{ background: 'var(--bg-2)' }}>
              <th style={{ ...cell, color: 'var(--text-3)', textAlign: 'left', width: 180 }}>Step key</th>
              <th style={{ ...cell, color: 'var(--text-3)', textAlign: 'left', width: 180 }}>Description</th>
              <th style={{ ...cell, color: 'var(--text-3)', textAlign: 'left' }}>R2 path</th>
              <th style={{ ...cell, color: 'var(--text-3)', textAlign: 'left', width: 100 }}>Status</th>
              <th style={{ ...cell, color: 'var(--text-3)', textAlign: 'right', width: 80 }}></th>
            </tr>
          </thead>
          <tbody>
            {configs.map((cfg, i) => {
              if (cfg.step_type === 'container') {
                const isCollapsed = collapsed.has(cfg.key)
                return (
                  <tr
                    key={cfg.key}
                    onClick={() => setCollapsed(prev => {
                      const next = new Set(prev)
                      next.has(cfg.key) ? next.delete(cfg.key) : next.add(cfg.key)
                      return next
                    })}
                    style={{ cursor: 'pointer', userSelect: 'none', background: 'var(--bg-2)' }}
                  >
                    <td colSpan={5} style={{
                      padding: '8px 12px',
                      borderBottom: '1px solid var(--line-2)',
                      borderLeft: '3px solid var(--action)',
                      fontSize: 11,
                      fontFamily: 'var(--font-sans)',
                      fontWeight: 600,
                      color: 'var(--text-1)',
                      letterSpacing: '0.04em',
                    }}>
                      <span style={{
                        display: 'inline-block',
                        marginRight: 8,
                        color: 'var(--action)',
                        transition: 'transform 120ms',
                        transform: isCollapsed ? 'rotate(0deg)' : 'rotate(90deg)',
                      }}>▶</span>
                      <span style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color: 'var(--text-3)', marginRight: 8 }}>
                        {cfg.order_index ?? ''}
                      </span>
                      {cfg.description || cfg.key}
                    </td>
                  </tr>
                )
              }

              // buscar el container padre para saber si está colapsado
              const parentCfg = configs.slice(0, i).reverse().find(c => c.step_type === 'container')
              if (cfg.step_type === 'node' && parentCfg && collapsed.has(parentCfg.key)) return null

              const row = rows[cfg.key]
              if (!row) return null
              const hasR2 = !!cfg.r2_path
              return (
                <tr key={cfg.key} style={{ background: row.dirty ? 'var(--bg-2)' : 'transparent' }}>

                  {/* Key */}
                  <td style={{ ...cell, color: 'var(--text-1)', fontWeight: 600, paddingLeft: cfg.parent_key ? 28 : 12 }}>
                    {cfg.parent_key && (
                      <span style={{ color: 'var(--text-3)', fontWeight: 400, marginRight: 6, fontFamily: 'var(--font-mono)', fontSize: 11 }}>
                        {containerIndex[cfg.parent_key] ?? ''}.{cfg.order_index}
                      </span>
                    )}
                    {cfg.key}
                  </td>

                  {/* Description */}
                  <td style={{ ...cell, color: 'var(--text-3)' }}>
                    {cfg.description || '—'}
                  </td>

                  {/* R2 path */}
                  <td style={cell}>
                    <input
                      value={row.r2_path}
                      onChange={e => handleChange(cfg.key, 'r2_path', e.target.value)}
                      placeholder={`${cfg.key}.md`}
                      style={{
                        width: '100%', background: 'var(--bg-0)',
                        border: '1px solid var(--line-2)', borderRadius: 4,
                        padding: '4px 8px', outline: 'none',
                        color: 'var(--text-1)', fontSize: 12, fontFamily: 'var(--font-mono)',
                      }}
                    />
                    {row.error && (
                      <div style={{ color: '#ef4444', fontSize: 10, marginTop: 3 }}>{row.error}</div>
                    )}
                  </td>

                  {/* Status badge */}
                  <td style={cell}>
                    <span style={{
                      display: 'inline-block',
                      padding: '2px 8px', borderRadius: 10,
                      fontSize: 10, fontFamily: 'var(--font-mono)', fontWeight: 600,
                      background: hasR2 ? 'rgba(34,197,94,0.12)' : 'var(--bg-2)',
                      color: hasR2 ? 'var(--green, #22c55e)' : 'var(--text-3)',
                      border: `1px solid ${hasR2 ? 'rgba(34,197,94,0.3)' : 'var(--line-2)'}`,
                    }}>
                      {hasR2 ? 'R2 active' : 'Fallback'}
                    </span>
                  </td>

                  {/* Save */}
                  <td style={{ ...cell, textAlign: 'right' }}>
                    {row.saved ? (
                      <span style={{ color: 'var(--green, #22c55e)', fontSize: 11, fontFamily: 'var(--font-mono)' }}>
                        saved
                      </span>
                    ) : (
                      <button
                        onClick={() => handleSave(cfg.key)}
                        disabled={!row.dirty || row.saving}
                        style={{
                          padding: '4px 12px', borderRadius: 4, fontSize: 11, fontFamily: 'var(--font-mono)',
                          border: '1px solid var(--line-2)', cursor: row.dirty ? 'pointer' : 'default',
                          background: row.dirty ? 'var(--action)' : 'var(--bg-2)',
                          color: row.dirty ? '#fff' : 'var(--text-3)',
                          opacity: row.saving ? 0.6 : 1,
                          transition: 'background 120ms',
                        }}
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

      {/* Footer note */}
      <div style={{ marginTop: 16, fontSize: 10, fontFamily: 'monospace', color: 'var(--text-3)' }}>
        Changes take effect immediately — the backend cache is cleared on save. R2 reads happen only on the next request after a cache clear.
      </div>
    </div>
  )
}
