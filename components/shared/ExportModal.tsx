'use client'
import { useState, useEffect } from 'react'
import type { Project } from '@/lib/types'
import {
  validateProjectRepo, exportProjectToRepo,
  saveProjectRepoConfig, createProjectRepo, getMemberByAuth,
} from '@/lib/api'
import { useAuth } from '@/lib/auth-context'
import { isPlatformAdmin } from '@/lib/roles'

// ─── Detección de proveedor ───────────────────────────────────────────────────

function detectProvider(url: string): { name: string; color: string } {
  if (/gitlab/i.test(url))    return { name: 'GitLab',    color: '#e24329' }
  if (/github/i.test(url))    return { name: 'GitHub',    color: '#238636' }
  if (/bitbucket/i.test(url)) return { name: 'Bitbucket', color: '#2684ff' }
  return { name: 'Git', color: 'var(--text-3)' }
}

const ENGINES = [
  { value: 'unity',  label: 'Unity' },
  { value: 'unreal', label: 'Unreal Engine' },
  { value: 'godot',  label: 'Godot' },
]

// ─── Tipos ────────────────────────────────────────────────────────────────────

interface Props {
  project: Project
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

const selectStyle: React.CSSProperties = {
  ...inputStyle, cursor: 'pointer', appearance: 'none',
  backgroundImage: `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='10' height='6'%3E%3Cpath d='M0 0l5 6 5-6z' fill='%23666'/%3E%3C/svg%3E")`,
  backgroundRepeat: 'no-repeat', backgroundPosition: 'right 10px center',
  paddingRight: 28,
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

export default function ExportModal({ project, onClose, onRepoSaved }: Props) {
  const { user } = useAuth()

  const savedUrl = project.repo_config?.repo_url ?? ''
  const hasToken = project.repo_config?.has_token ?? false

  const [isAdmin,      setIsAdmin]      = useState(false)
  const [token,        setToken]        = useState('')
  const [showToken,    setShowToken]    = useState(false)
  const [savingToken,  setSavingToken]  = useState(false)

  const [repoUrl,      setRepoUrl]      = useState(savedUrl)
  const [createState,  setCreateState]  = useState<CreateState>('idle')
  const [createError,  setCreateError]  = useState('')

  const [engine,       setEngine]       = useState(project.target_engine || 'unity')

  const [validation,   setValidation]   = useState<ValidationState>('idle')
  const [validMsg,     setValidMsg]     = useState('')

  const [exportState,  setExportState]  = useState<ExportState>('idle')
  const [exportMsg,    setExportMsg]    = useState('')
  const [pushedFiles,  setPushedFiles]  = useState<string[]>([])
  const [exportErrors, setExportErrors] = useState<string[]>([])

  useEffect(() => {
    if (user?.id) getMemberByAuth(user.id).then(m => setIsAdmin(isPlatformAdmin(m?.role)))
  }, [user?.id])

  const hasRepo     = !!repoUrl
  const provider    = hasRepo ? detectProvider(repoUrl) : null
  const tokenReady  = hasToken || token.trim().length > 0
  const canCreate   = isAdmin && tokenReady && !hasRepo && createState !== 'creating'
  const canValidate = hasRepo && validation !== 'validating'
  const canExport   = hasRepo && validation === 'ok' && exportState !== 'exporting'

  async function handleSaveToken() {
    if (!token.trim()) return
    setSavingToken(true)
    try {
      await saveProjectRepoConfig(project.id, { repo_token: token.trim() })
      setToken('')
      onRepoSaved?.()
    } finally { setSavingToken(false) }
  }

  async function handleCreateRepo() {
    if (!canCreate) return
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
      const res = await exportProjectToRepo(project.id, engine)
      if (res.ok) {
        setExportState('done')
        setPushedFiles(res.pushed)
        setExportErrors(res.errors as unknown as string[])
        setExportMsg(`${res.pushed.length} file(s) pushed to repository.`)
      } else {
        setExportState('error')
        setExportMsg((res.errors as unknown as string[]).join(' · ') || 'Export failed')
      }
    } catch (e) {
      setExportState('error')
      setExportMsg(e instanceof Error ? e.message : 'Export failed')
    }
  }

  return (
    <div style={{
      position: 'fixed', inset: 0, zIndex: 3000,
      background: 'rgba(0,0,0,0.7)', backdropFilter: 'blur(4px)',
      display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24,
    }}>
      <div style={{
        background: 'var(--bg-1)', border: '1px solid var(--line-2)', borderRadius: 12,
        width: '100%', maxWidth: 460, maxHeight: '88vh', overflowY: 'auto',
        boxShadow: '0 24px 80px rgba(0,0,0,0.6)',
        display: 'flex', flexDirection: 'column', gap: 20, padding: 24,
      }}>

        {/* Header */}
        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between' }}>
          <div>
            <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--text-0)' }}>Initialize Repository</div>
            <div style={{ ...mono, fontSize: 10, color: 'var(--text-3)', marginTop: 2 }}>{project.name}</div>
          </div>
          <button onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 18, color: 'var(--text-3)', lineHeight: 1 }}>✕</button>
        </div>

        {/* ── Paso 1: Conectar repo ── */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <Step n={1} label="Connect repository" done={hasRepo} />

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
                  border: '1px solid var(--line-2)', background: 'var(--bg-2)', color: 'var(--text-3)', fontSize: 13,
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

          {hasRepo ? (
            <div style={{
              display: 'flex', alignItems: 'center', gap: 10,
              padding: '8px 12px', borderRadius: 6,
              background: 'color-mix(in oklch, var(--cat-code) 8%, var(--bg-2))',
              border: '1px solid color-mix(in oklch, var(--cat-code) 25%, transparent)',
            }}>
              {provider && <span style={{ ...mono, fontSize: 10, color: provider.color, flexShrink: 0 }}>{provider.name}</span>}
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
                fontFamily: 'var(--font-mono)', fontWeight: 600,
                cursor: canCreate ? 'pointer' : 'not-allowed', border: 'none',
                background: canCreate ? 'var(--cat-asset)' : 'var(--bg-3)',
                color: canCreate ? '#000' : 'var(--text-3)',
              }}
            >
              {createState === 'creating' ? '⟳ Creating…' : '+ Create repository'}
            </button>
          )}

          {createError && <div style={{ ...mono, fontSize: 10, color: 'var(--state-error)' }}>✕ {createError}</div>}

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
                    flexShrink: 0, padding: '0 12px', borderRadius: 6,
                    cursor: token.trim() ? 'pointer' : 'not-allowed',
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

        {/* ── Paso 2: Engine ── */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          <Step n={2} label="Select engine" done={exportState === 'done'} />
          <div>
            <label style={labelStyle}>Game Engine</label>
            <select
              value={engine}
              onChange={e => { setEngine(e.target.value); setValidation('idle'); setExportState('idle') }}
              style={selectStyle}
              disabled={exportState === 'done'}
            >
              {ENGINES.map(e => (
                <option key={e.value} value={e.value}>{e.label}</option>
              ))}
            </select>
          </div>
        </div>

        <Divider />

        {/* ── Paso 3: Validar acceso ── */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          <Step n={3} label="Validate access" done={validation === 'ok'} />
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
            {validation === 'ok'    && <span style={{ ...mono, color: 'var(--state-success)' }}>✓ {validMsg || 'Access confirmed'}</span>}
            {validation === 'error' && <span style={{ ...mono, color: 'var(--state-error)' }}>✕ {validMsg || 'Access denied'}</span>}
          </div>
        </div>

        <Divider />

        {/* ── Resultado ── */}
        {exportState === 'done' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            <div style={{ ...mono, padding: '8px 12px', borderRadius: 6, color: 'var(--cat-code)', background: 'color-mix(in oklch, var(--cat-code) 10%, var(--bg-2))', border: '1px solid color-mix(in oklch, var(--cat-code) 25%, transparent)' }}>
              ✓ {exportMsg}
            </div>
            {pushedFiles.length > 0 && (
              <details style={{ ...mono, fontSize: 10, color: 'var(--text-3)' }}>
                <summary style={{ cursor: 'pointer' }}>{pushedFiles.length} files pushed</summary>
                <div style={{ marginTop: 6, maxHeight: 160, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 2 }}>
                  {pushedFiles.map(f => <span key={f} style={{ color: 'var(--text-2)' }}>{f}</span>)}
                </div>
              </details>
            )}
            {exportErrors.length > 0 && (
              <details style={{ ...mono, fontSize: 10, color: 'var(--state-error)' }}>
                <summary style={{ cursor: 'pointer' }}>{exportErrors.length} errors</summary>
                <div style={{ marginTop: 6, display: 'flex', flexDirection: 'column', gap: 2 }}>
                  {exportErrors.map((e, i) => <span key={i}>{String(e)}</span>)}
                </div>
              </details>
            )}
          </div>
        )}

        {exportState === 'error' && (
          <div style={{ ...mono, padding: '8px 12px', borderRadius: 6, color: 'var(--state-error)', background: 'color-mix(in oklch, var(--state-error) 10%, var(--bg-2))' }}>
            ✕ {exportMsg}
          </div>
        )}

        {/* ── Botón Initialize ── */}
        <button
          onClick={handleExport}
          disabled={!canExport}
          style={{
            padding: '10px', borderRadius: 8, fontSize: 12,
            fontFamily: 'var(--font-mono)', fontWeight: 600,
            cursor: canExport ? 'pointer' : 'not-allowed', border: 'none',
            background: canExport ? 'var(--action)' : 'var(--bg-3)',
            color: canExport ? 'var(--action-fg)' : 'var(--text-3)',
            transition: 'background 0.15s',
          }}
        >
          {exportState === 'exporting' ? '⟳ Initializing…' : exportState === 'done' ? '✓ Done' : '↑ Initialize Repository'}
        </button>

        {!hasRepo && (
          <div style={{ ...mono, fontSize: 10, color: 'var(--text-3)', textAlign: 'center' }}>Create or connect a repository first.</div>
        )}
        {hasRepo && validation !== 'ok' && exportState === 'idle' && (
          <div style={{ ...mono, fontSize: 10, color: 'var(--text-3)', textAlign: 'center' }}>Validate access before initializing.</div>
        )}

      </div>
    </div>
  )
}
