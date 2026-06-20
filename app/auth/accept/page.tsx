'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase'
import { updateAdminUser } from '@/lib/api'

export default function AcceptInvitePage() {
  const router = useRouter()
  const [ready, setReady]       = useState(false)
  const [email, setEmail]       = useState('')
  const [displayName, setDisplayName] = useState('')
  const [password, setPassword] = useState('')
  const [pwConfirm, setPwConfirm] = useState('')
  const [saving, setSaving]     = useState(false)
  const [error, setError]       = useState('')

  useEffect(() => {
    const supabase = createClient()

    async function init() {
      // Detectar errores en el hash (ej: otp_expired) antes de cualquier otra lógica
      const hashParams = new URLSearchParams(window.location.hash.slice(1))
      const hashError  = hashParams.get('error')
      if (hashError) {
        const desc = hashParams.get('error_description')?.replace(/\+/g, ' ') ?? hashError
        setError(desc)
        setReady(true)
        return
      }

      const params = new URLSearchParams(window.location.search)
      const code   = params.get('code')

      // PKCE invite: exchange code directly
      if (code) {
        const { data, error } = await supabase.auth.exchangeCodeForSession(code)
        if (error || !data.session) { router.replace('/login'); return }
        resolve(data.session.user.email ?? '')
        return
      }

      // Hash invite via login-page relay: tokens stored in sessionStorage
      const at = sessionStorage.getItem('invite_at')
      const rt = sessionStorage.getItem('invite_rt') ?? ''
      if (at) {
        sessionStorage.removeItem('invite_at')
        sessionStorage.removeItem('invite_rt')
        const { data, error } = await supabase.auth.setSession({ access_token: at, refresh_token: rt })
        if (error || !data.session) { router.replace('/login'); return }
        resolve(data.session.user.email ?? '')
        return
      }

      // Direct hash redirect from Supabase (production): Supabase already processed
      // the hash tokens on page load via detectSessionInUrl — just read the session.
      // Solo usar la sesión existente si hay tokens en el hash (no caer al admin logueado).
      const atHash = hashParams.get('access_token')
      if (atHash) {
        const { data: { session } } = await supabase.auth.getSession()
        if (session?.user?.email) {
          resolve(session.user.email)
          return
        }
      }

      // Sin tokens válidos — link expirado o ya usado
      setError('This invite link has expired or was already used. Please ask for a new invite.')
      setReady(true)
    }

    function resolve(userEmail: string) {
      setEmail(userEmail)
      setDisplayName(userEmail.split('@')[0])
      setReady(true)
    }

    init()
  }, [router])

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (password !== pwConfirm) { setError('Passwords do not match'); return }
    if (password.length < 6)    { setError('Password must be at least 6 characters'); return }

    setSaving(true)
    setError('')
    try {
      const supabase = createClient()

      const { data: { user }, error: updateError } = await supabase.auth.updateUser({
        password,
        data: { display_name: displayName },
      })
      if (updateError) throw updateError
      if (!user) throw new Error('No user returned')

      await updateAdminUser(user.id, { display_name: displayName })

      router.replace('/')
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Unknown error')
      setSaving(false)
    }
  }

  const inputStyle: React.CSSProperties = {
    width: '100%', background: 'var(--bg-1)', border: '1px solid var(--line-2)',
    borderRadius: 6, padding: '9px 11px', fontSize: 13, color: 'var(--text-0)',
    outline: 'none', boxSizing: 'border-box', fontFamily: 'inherit',
    transition: 'border-color 120ms',
  }

  const labelStyle: React.CSSProperties = {
    fontFamily: 'monospace', fontSize: 10, textTransform: 'uppercase',
    letterSpacing: '0.1em', color: 'var(--text-3)',
  }

  return (
    <div className="login-wrap">
      <div className="login-grid" />
      <div className="login-card">
        <div className="login-brand">
          <img src="/forgy/forgyi.png" alt="Forge" width={32} height={32} style={{ objectFit: 'contain', flexShrink: 0 }} />
          <div className="login-brand-text">
            <div className="login-brand-name">Forge</div>
            <div className="login-brand-tag">AI Game Pipeline</div>
          </div>
        </div>
        <div className="login-divider" />

        {!ready ? (
          <div style={{ fontSize: 12, fontFamily: 'monospace', color: 'var(--text-3)', textAlign: 'center', padding: '20px 0' }}>
            Setting up your account...
          </div>
        ) : error && !email ? (
          // Token expirado o inválido — mostrar error sin form
          <>
            <div className="login-title">Invite link expired</div>
            <div className="login-error" style={{ marginTop: 8 }}>{error}</div>
            <button
              type="button" className="login-btn" style={{ marginTop: 20 }}
              onClick={() => router.replace('/login')}
            >
              Back to login
            </button>
          </>
        ) : (
          <>
            <div className="login-title">Welcome to Forge</div>
            <div className="login-sub" style={{ marginBottom: 20 }}>
              Complete your profile to get started.
            </div>

            <form onSubmit={handleSubmit} className="login-form">
              <div className="login-field">
                <label style={labelStyle}>Email</label>
                <input type="email" value={email} disabled style={{ ...inputStyle, opacity: 0.5, cursor: 'not-allowed' }} />
              </div>

              <div className="login-field">
                <label style={labelStyle}>Display name</label>
                <input
                  type="text" value={displayName} onChange={e => setDisplayName(e.target.value)}
                  required autoFocus style={inputStyle}
                  onFocus={e => (e.currentTarget.style.borderColor = 'var(--ember)')}
                  onBlur={e => (e.currentTarget.style.borderColor = 'var(--line-2)')}
                />
              </div>

              <div className="login-field">
                <label style={labelStyle}>Password</label>
                <input
                  type="password" value={password} onChange={e => setPassword(e.target.value)}
                  required style={inputStyle}
                  onFocus={e => (e.currentTarget.style.borderColor = 'var(--ember)')}
                  onBlur={e => (e.currentTarget.style.borderColor = 'var(--line-2)')}
                />
              </div>

              <div className="login-field">
                <label style={labelStyle}>Confirm password</label>
                <input
                  type="password" value={pwConfirm} onChange={e => setPwConfirm(e.target.value)}
                  required style={inputStyle}
                  onFocus={e => (e.currentTarget.style.borderColor = 'var(--ember)')}
                  onBlur={e => (e.currentTarget.style.borderColor = 'var(--line-2)')}
                />
              </div>

              {error && <div className="login-error">{error}</div>}

              <button type="submit" disabled={saving} className="login-btn primary">
                {saving ? 'Activating...' : 'Activate account'}
              </button>
            </form>
          </>
        )}
      </div>
    </div>
  )
}
