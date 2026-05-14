'use client'
import { useState, useEffect } from 'react'
import type { Node } from '@xyflow/react'
import type { Project } from '@/lib/types'
import type { ForgeNodeData } from '@/components/pipeline/ForgeNode'
import {
  validateProjectRepo, exportProjectToRepo,
  saveProjectRepoConfig, createProjectRepo, getMemberByAuth,
} from '@/lib/api'
import { useAuth } from '@/lib/auth-context'

// ─── Detección de proveedor ───────────────────────────────────────────────────

function detectProvider(url: string): { name: string; color: string } {
  if (/gitlab/i.test(url))    return { name: 'GitLab',    color: '#e24329' }
  if (/github/i.test(url))    return { name: 'GitHub',    color: '#238636' }
  if (/bitbucket/i.test(url)) return { name: 'Bitbucket', color: '#2684ff' }
  return { name: 'Git', color: 'var(--text-3)' }
}

// ─── Tipos ────────────────────────────────────────────────────────────────────

interface Props {
  project: Project
  nodes: Node[]
  onClose: () => void
  onRepoSaved?: () => void
}

type ValidationState = 'idle' | 'validating' | 'ok' | 'error'
type ExportState     = 'idle' | 'exporting' | 'done' | 'error'
type CreateState     = 'idle' | 'creating' | 'error'

// ─── Estilos ──────────────────────────────────────────────────────────────────

const mono: React.CSSProperties = { fontFamily: 'var(--font-mono)', fontSize: 11 }

const labelStyle: React.CSSProperties = {
  ...mono, fontSize: 10, color: 'var(--text-3)',
  textTransform: 'uppercase', letterSpacing: '0.08em',
  display: 'block', marginBottom: 5,
}

const inputStyle: React.CSSProperties = {
  width: '100%', background: 'var(--bg-2)', border: '1px solid var(--line-2)',
  borderRadius: 6, padding: '7px 10px', fontSize: 12, color: 'var(--text-0)',
  outline: 'none', boxSizing: 'border-box', fontFamily: 'inherit',
}

function Divider() {
  return <div style={{ borderTop: '1px solid var(--line-2)', margin: '4px 0' }} />
}

function Step({ n, label, done }: { n: number; label: string; done?: boolean }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
      <span style={{
        width: 20, height: 20, borderRadius: '50%', flexShrink: 0,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        fontSize: 10, fontFamily: 'var(--font-mono)', fontWeight: 700,
        background: done ? 'var(--cat-code)' : 'var(--bg-3)',
        color: done ? '#000' : 'var(--text-3)',
        border: done ? 'none' : '1px solid var(--line-2)',
      }}>
        {done ? '✓' : n}
      </span>
      <span style={{ ...mono, fontSize: 11, color: done ? 'var(--cat-code)' : 'var(--text-1)' }}>{label}</span>
    </div>
  )
}

// ─── Componente ───────────────────────────────────────────────────────────────

export default function ExportModal({ project, nodes, onClose, onRepoSaved }: Props) {
  const { user } = useAuth()

  const savedUrl   = project.repo_config?.repo_url ?? ''
  const hasToken   = project.repo_config?.has_token ?? false

  const [isAdmin, setIsAdmin]         = useState(false)
  const [token, setToken]             = useState('')
  const [showToken, setShowToken]     = useState(false)
  const [savingToken, setSavingToken] = useState(false)

  const [repoUrl, setRepoUrl]         = useState(savedUrl)
  const [createState, setCreateState] = useState<CreateState>('idle')
  const [createError, setCreateError] = useState('')

  const [validation, setValidation]   = useState<ValidationState>('idle')
  const [validMsg, setValidMsg]       = useState('')

  const [selected, setSelected]       = useState<Set<string>>(new Set())
  const [exportState, setExportState] = useState<ExportState>('idle')
  const [exportMsg, setExportMsg]     = useState('')

  useEffect(() => {
    if (user?.id) getMemberByAuth(user.id).then(m => setIsAdmin(m?.role === 'admin'))
  }, [user?.id])

  // Nodos aprobados
  const approvedNodes = nodes.filter(n => {
    const d = n.data as unknown as ForgeNodeData
    return d.approved === true && d.stepKey
  })

  // Derivados de estado
  const hasRepo      = !!repoUrl
  const provider     = hasRepo ? detectProvider(repoUrl) : null
  const tokenReady   = hasToken || token.trim().length > 0
  const canCreate    = isAdmin && tokenReady && !hasRepo && createState !== 'creating'
  const canValidate  = hasRepo && validation !== 'validating'
  const canExport    = hasRepo && validation === 'ok' && selected.size > 0 && exportState !== 'exporting'

  // Paso 1 completado: hay repo
  // Paso 2 completado: validación ok
  // Paso 3 completado: export done

  function toggleNode(key: string) {
    setSelected(prev => { const s = new Set(prev); s.has(key) ? s.delete(key) : s.add(key); return s })
  }
  function toggleAll() {
    setSelected(selected.size === approvedNodes.length
      ? new Set()
      : new Set(approvedNodes.map(n => (n.data as unknown as ForgeNodeData).stepKey!)))
  }

  async function handleSaveToken() {
    if (!token.trim()) return
    setSavingToken(true)
    try {
      await saveProjectRepoConfig(project.id, { repo_token: token.trim() })
      setToken('')
      setValidation('idle')
      onRepoSaved?.()
    } finally { setSavingToken(false) }
  }

  async function handleCreateRepo() {
    if (!canCreate) return
    // Si el token es nuevo, guardarlo primero
    if (token.trim()) {
      setSavingToken(true)
      try {
        await saveProjectRepoConfig(project.id, { repo_token: token.trim() })
        setToken('')
        onRepoSaved?.()
      } finally { setSavingToken(false) }
    }
    setCreateState('creating')
    setCreateError('')
    try {
      const res = await createProjectRepo(project.id)
      if (res.ok) {
        setRepoUrl(res.repo_url)
        setValidation('idle')
        onRepoSaved?.()
      } else {
        setCreateState('error')
        setCreateError(res.message ?? 'Error creating repository')
      }
    } catch (e) {
      setCreateState('error')
      setCreateError(e instanceof Error ? e.message : 'Error creating repository')
    } finally {
      setCreateState(s => s !== 'error' ? 'idle' : s)
    }
  }

  async function handleValidate() {
    setValidation('validating'); setValidMsg('')
    try {
      const res = await validateProjectRepo(project.id)
      setValidation(res.ok ? 'ok' : 'error')
      setValidMsg(res.message)
    } catch (e) {
      setValidation('error')
      setValidMsg(e instanceof Error ? e.message : 'Connection error')
    }
  }

  async function handleExport() {
    setExportState('exporting'); setExportMsg('')
    try {
      const res = await exportProjectToRepo(project.id, [...selected])
      if (res.ok) {
        setExportState('done')
        setExportMsg(`${res.pushed.length} file(s) pushed to repository.`)
      } else {
        setExportState('error')
        setExportMsg(res.errors.join(' · '))
      }
    } catch (e) {
      setExportState('error')
      setExportMsg(e instanceof Error ? e.message : 'Export failed')
    }
  }

  return (
    <div
      style={{
        position: 'fixed', inset: 0, zIndex: 3000,
        background: 'rgba(0,0,0,0.7)', backdropFilter: 'blur(4px)',
        display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24,
      }}
    >
      <div style={{
        background: 'var(--bg-1)', border: '1px solid var(--line-2)', borderRadius: 12,
        width: '100%', maxWidth: 460, maxHeight: '88vh', overflowY: 'auto',
        boxShadow: '0 24px 80px rgba(0,0,0,0.6)',
        display: 'flex', flexDirection: 'column', gap: 20, padding: 24,
      }}>

        {/* Header */}
        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between' }}>
          <div>
            <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--text-0)' }}>Export to Repository</div>
            <div style={{ ...mono, fontSize: 10, color: 'var(--text-3)', marginTop: 2 }}>{project.name}</div>
          </div>
          <button onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 18, color: 'var(--text-3)', lineHeight: 1 }}>✕</button>
        </div>

        {/* ── Paso 1: Configurar token y crear repo ── */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <Step n={1} label="Connect repository" done={hasRepo} />

          {/* Token — solo admins */}
          {isAdmin && !hasRepo && (
            <div>
              <label style={labelStyle}>
                Access Token
                {hasToken && !token && <span style={{ marginLeft: 8, color: 'var(--cat-code)', textTransform: 'none', letterSpacing: 0 }}>✓ saved</span>}
              </label>
              <div style={{ display: 'flex', gap: 8 }}>
                <input
                  style={inputStyle}
                  type={showToken ? 'text' : 'password'}
                  value={token}
                  placeholder={hasToken ? '••••••••••••••••' : 'glpat-xxxxxxxxxxxx'}
                  autoComplete="new-password"
                  onChange={e => setToken(e.target.value)}
                />
                <button type="button" onClick={() => setShowToken(v => !v)} style={{
                  flexShrink: 0, padding: '7px 10px', borderRadius: 6, cursor: 'pointer',
                  border: '1px solid var(--line-2)', background: 'var(--bg-2)',
                  color: 'var(--text-3)', fontSize: 13,
                }}>
                  {showToken ? '🙈' : '👁'}
                </button>
              </div>
              {!hasToken && !token && (
                <div style={{ ...mono, fontSize: 10, color: 'var(--cat-gate)', marginTop: 5 }}>
                  ⚠ Paste your GitLab token with <strong>api</strong> scope.
                </div>
              )}
            </div>
          )}

          {/* Repo URL — readonly si ya existe */}
          {hasRepo ? (
            <div style={{
              display: 'flex', alignItems: 'center', gap: 10,
              padding: '8px 12px', borderRadius: 6,
              background: 'color-mix(in oklch, var(--cat-code) 8%, var(--bg-2))',
              border: '1px solid color-mix(in oklch, var(--cat-code) 25%, transparent)',
            }}>
              {provider && (
                <span style={{ ...mono, fontSize: 10, color: provider.color, flexShrink: 0 }}>
                  {provider.name}
                </span>
              )}
              <span style={{ ...mono, fontSize: 11, color: 'var(--text-1)', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {repoUrl}
              </span>
              <a href={repoUrl} target="_blank" rel="noreferrer" style={{ ...mono, fontSize: 10, color: 'var(--text-3)', flexShrink: 0 }}>↗</a>
            </div>
          ) : (
            <button
              onClick={handleCreateRepo}
              disabled={!canCreate}
              style={{
                padding: '9px', borderRadius: 7, fontSize: 12,
                fontFamily: 'var(--font-mono)', fontWeight: 600, cursor: canCreate ? 'pointer' : 'not-allowed',
                border: 'none',
                background: canCreate ? 'var(--cat-asset)' : 'var(--bg-3)',
                color: canCreate ? '#000' : 'var(--text-3)',
                transition: 'background 0.15s',
              }}
            >
              {createState === 'creating' ? '⟳ Creating…' : '+ Create repository'}
            </button>
          )}

          {createError && (
            <div style={{ ...mono, fontSize: 10, color: 'var(--cat-output)' }}>✕ {createError}</div>
          )}

          {/* Actualizar token si ya hay repo — solo admin */}
          {isAdmin && hasRepo && (
            <details style={{ ...mono, fontSize: 10, color: 'var(--text-3)' }}>
              <summary style={{ cursor: 'pointer', userSelect: 'none' }}>Update access token</summary>
              <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
                <input
                  style={{ ...inputStyle, fontSize: 11 }}
                  type={showToken ? 'text' : 'password'}
                  value={token}
                  placeholder={hasToken ? '••••••••••••••••' : 'glpat-xxxxxxxxxxxx'}
                  autoComplete="new-password"
                  onChange={e => setToken(e.target.value)}
                />
                <button type="button" onClick={() => setShowToken(v => !v)} style={{
                  flexShrink: 0, padding: '6px 9px', borderRadius: 6, cursor: 'pointer',
                  border: '1px solid var(--line-2)', background: 'var(--bg-2)', color: 'var(--text-3)', fontSize: 13,
                }}>
                  {showToken ? '🙈' : '👁'}
                </button>
                <button
                  onClick={handleSaveToken}
                  disabled={!token.trim() || savingToken}
                  style={{
                    flexShrink: 0, padding: '0 12px', borderRadius: 6, cursor: token.trim() ? 'pointer' : 'not-allowed',
                    fontSize: 11, border: '1px solid var(--cat-code)',
                    background: 'color-mix(in oklch, var(--cat-code) 12%, transparent)',
                    color: 'var(--cat-code)', fontFamily: 'var(--font-mono)',
                  }}
                >
                  {savingToken ? '…' : 'Save'}
                </button>
              </div>
            </details>
          )}
        </div>

        <Divider />

        {/* ── Paso 2: Validar acceso ── */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          <Step n={2} label="Validate access" done={validation === 'ok'} />
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <button
              onClick={handleValidate}
              disabled={!canValidate}
              style={{
                padding: '6px 16px', borderRadius: 6, fontSize: 11,
                fontFamily: 'var(--font-mono)', cursor: canValidate ? 'pointer' : 'not-allowed',
                border: '1px solid var(--line-2)', background: 'var(--bg-2)', color: 'var(--text-1)',
              }}
            >
              {validation === 'validating' ? '⟳ Checking…' : 'Validate access'}
            </button>
            {validation === 'ok'    && <span style={{ ...mono, color: 'var(--cat-code)' }}>✓ {validMsg || 'Access confirmed'}</span>}
            {validation === 'error' && <span style={{ ...mono, color: 'var(--cat-output)' }}>✕ {validMsg || 'Access denied'}</span>}
          </div>
        </div>

        <Divider />

        {/* ── Paso 3: Seleccionar outputs ── */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          <Step n={3} label="Select outputs" done={exportState === 'done'} />

          {approvedNodes.length === 0 ? (
            <div style={{ ...mono, color: 'var(--text-3)', fontSize: 11 }}>
              No approved nodes yet.
            </div>
          ) : (
            <>
              <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
                <button onClick={toggleAll} style={{ ...mono, fontSize: 10, background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-3)' }}>
                  {selected.size === approvedNodes.length ? 'Deselect all' : 'Select all'}
                </button>
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                {approvedNodes.map(n => {
                  const d = n.data as unknown as ForgeNodeData
                  const key = d.stepKey!
                  const checked = selected.has(key)
                  return (
                    <label key={n.id} style={{
                      display: 'flex', alignItems: 'center', gap: 10,
                      padding: '7px 10px', borderRadius: 6, cursor: 'pointer',
                      background: checked ? 'color-mix(in oklch, var(--cat-code) 8%, var(--bg-2))' : 'var(--bg-2)',
                      border: `1px solid ${checked ? 'color-mix(in oklch, var(--cat-code) 30%, transparent)' : 'transparent'}`,
                      transition: 'background 0.1s, border-color 0.1s',
                    }}>
                      <input
                        type="checkbox" checked={checked} onChange={() => toggleNode(key)}
                        style={{ accentColor: 'var(--cat-code)', width: 14, height: 14, flexShrink: 0 }}
                      />
                      <div style={{ flex: 1 }}>
                        <div style={{ ...mono, fontSize: 12, color: 'var(--text-0)' }}>{d.label}</div>
                        <div style={{ ...mono, fontSize: 10, color: 'var(--text-3)' }}>{key}</div>
                      </div>
                      <span style={{ ...mono, fontSize: 10, color: 'var(--cat-code)' }}>✓</span>
                    </label>
                  )
                })}
              </div>
            </>
          )}
        </div>

        <Divider />

        {/* Resultado */}
        {exportState === 'done' && (
          <div style={{ ...mono, padding: '8px 12px', borderRadius: 6, color: 'var(--cat-code)', background: 'color-mix(in oklch, var(--cat-code) 10%, var(--bg-2))', border: '1px solid color-mix(in oklch, var(--cat-code) 25%, transparent)' }}>
            ✓ {exportMsg}
          </div>
        )}
        {exportState === 'error' && (
          <div style={{ ...mono, padding: '8px 12px', borderRadius: 6, color: 'var(--cat-output)', background: 'color-mix(in srgb, var(--cat-output) 10%, var(--bg-2))' }}>
            ✕ {exportMsg}
          </div>
        )}

        {/* ── Botón Export ── */}
        <button
          onClick={handleExport}
          disabled={!canExport}
          style={{
            padding: '10px', borderRadius: 8, fontSize: 12,
            fontFamily: 'var(--font-mono)', fontWeight: 600,
            cursor: canExport ? 'pointer' : 'not-allowed', border: 'none',
            background: canExport ? 'var(--cat-code)' : 'var(--bg-3)',
            color: canExport ? '#000' : 'var(--text-3)',
            transition: 'background 0.15s',
          }}
        >
          {exportState === 'exporting' ? '⟳ Exporting…' : `↑ Export${selected.size > 0 ? ` (${selected.size})` : ''}`}
        </button>

        {!hasRepo && <div style={{ ...mono, fontSize: 10, color: 'var(--text-3)', textAlign: 'center' }}>Create a repository first.</div>}
        {hasRepo && validation !== 'ok' && exportState === 'idle' && (
          <div style={{ ...mono, fontSize: 10, color: 'var(--text-3)', textAlign: 'center' }}>Validate access before exporting.</div>
        )}
      </div>
    </div>
  )
}
