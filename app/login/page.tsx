'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase'
import { updateOwnProfile } from '@/lib/api'

// Captura el hash antes de que Supabase lo borre
const _rawHash = typeof window !== 'undefined' ? window.location.hash : ''
let _inviteConsumed = false

type Mode = 'login' | 'forgot' | 'reset'

export default function LoginPage() {
  const router = useRouter()

  // ── Login state ─────────────────────────────────────────────
  const [email, setEmail]               = useState('')
  const [password, setPassword]         = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [loading, setLoading]           = useState(false)
  const [error, setError]               = useState<string | null>(null)

  // ── Mode — inicializar en 'reset' si viene de /auth/callback ─
  const [mode, setMode] = useState<Mode>(() =>
    typeof window !== 'undefined' && new URLSearchParams(window.location.search).get('recovery') === '1'
      ? 'reset'
      : 'login'
  )

  // ── Forgot password state ────────────────────────────────────
  const [forgotEmail, setForgotEmail]   = useState('')
  const [forgotSent, setForgotSent]     = useState(false)
  const [forgotLoading, setForgotLoading] = useState(false)
  const [forgotError, setForgotError]   = useState('')

  // ── Reset password state ─────────────────────────────────────
  const [resetPw, setResetPw]           = useState('')
  const [resetPwC, setResetPwC]         = useState('')
  const [resetSaving, setResetSaving]   = useState(false)
  const [resetError, setResetError]     = useState('')
  const [resetDone, setResetDone]       = useState(false)

  // ── Invite-accept state ──────────────────────────────────────
  const [invite, setInvite]             = useState<{ at: string; rt: string } | null>(null)
  const [inviteReady, setInviteReady]   = useState(false)
  const [inviteEmail, setInviteEmail]   = useState('')
  const [displayName, setDisplayName]   = useState('')
  const [invitePw, setInvitePw]         = useState('')
  const [invitePwC, setInvitePwC]       = useState('')
  const [inviteSaving, setInviteSaving] = useState(false)
  const [inviteError, setInviteError]   = useState('')

  // Forzar dark mode en el login
  useEffect(() => {
    const html = document.documentElement
    const prev = html.getAttribute('data-theme')
    html.setAttribute('data-theme', 'dark')
    return () => {
      if (prev) html.setAttribute('data-theme', prev)
      else html.removeAttribute('data-theme')
    }
  }, [])

  // Detectar flujo de recovery via onAuthStateChange (PKCE) o hash (implicit)
  useEffect(() => {
    const supabase = createClient()

    // PKCE: el cliente de @supabase/ssr procesa ?code= automáticamente y emite PASSWORD_RECOVERY
    const { data: { subscription } } = supabase.auth.onAuthStateChange((event) => {
      if (event === 'PASSWORD_RECOVERY') setMode('reset')
    })

    // Implicit fallback: hash con access_token (flujo invite / legacy)
    if (_rawHash.includes('access_token')) {
      const p = new URLSearchParams(_rawHash.replace(/^#/, ''))
      const at = p.get('access_token')
      const rt = p.get('refresh_token') ?? ''
      const type = p.get('type')

      if (at && type === 'recovery') {
        supabase.auth.setSession({ access_token: at, refresh_token: rt })
          .then(() => setMode('reset'))
      } else if (at && type === 'invite' && !_inviteConsumed) {
        _inviteConsumed = true
        setInvite({ at, rt })
        supabase.auth.setSession({ access_token: at, refresh_token: rt })
          .then(({ data, error }) => {
            if (error || !data.session?.user?.email) return
            const e = data.session.user.email
            setInviteEmail(e)
            setDisplayName(e.split('@')[0])
            setInviteReady(true)
          })
      }
    }

    return () => subscription.unsubscribe()
  }, [])

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setLoading(true); setError(null)
    try {
      const supabase = createClient()
      const { error } = await supabase.auth.signInWithPassword({ email, password })
      if (error) {
        if (error.message.includes('Invalid login credentials')) setError('Incorrect email or password')
        else if (error.message.includes('Email not confirmed'))  setError('Confirm your email first')
        else setError(error.message)
      } else {
        router.push('/')
      }
    } catch {
      setError('Connection error. Please try again.')
    } finally {
      setLoading(false)
    }
  }

  async function handleForgot(e: React.FormEvent) {
    e.preventDefault()
    setForgotLoading(true); setForgotError('')
    try {
      const supabase = createClient()
      const redirectTo = `${window.location.origin}/auth/callback?type=recovery`
      const { error } = await supabase.auth.resetPasswordForEmail(forgotEmail, { redirectTo })
      if (error) throw error
      setForgotSent(true)
    } catch (err: unknown) {
      setForgotError(err instanceof Error ? err.message : 'Error sending email')
    } finally {
      setForgotLoading(false)
    }
  }

  async function handleReset(e: React.FormEvent) {
    e.preventDefault()
    if (resetPw !== resetPwC)   { setResetError('Passwords do not match'); return }
    if (resetPw.length < 6)     { setResetError('Password must be at least 6 characters'); return }
    setResetSaving(true); setResetError('')
    try {
      const supabase = createClient()
      const { error } = await supabase.auth.updateUser({ password: resetPw })
      if (error) throw error
      setResetDone(true)
      setTimeout(() => router.replace('/'), 2000)
    } catch (err: unknown) {
      setResetError(err instanceof Error ? err.message : 'Unknown error')
    } finally {
      setResetSaving(false)
    }
  }

  async function handleInviteSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (invitePw !== invitePwC)    { setInviteError('Passwords do not match'); return }
    if (invitePw.length < 6)       { setInviteError('Password must be at least 6 characters'); return }
    setInviteSaving(true); setInviteError('')
    try {
      const supabase = createClient()
      const { data: { user }, error: ue } = await supabase.auth.updateUser({
        password: invitePw,
        data: { display_name: displayName },
      })
      if (ue) throw ue
      if (!user) throw new Error('No user returned')
      await updateOwnProfile(user.id, displayName)
      router.replace('/')
    } catch (err: unknown) {
      setInviteError(err instanceof Error ? err.message : 'Unknown error')
      setInviteSaving(false)
    }
  }

  const cardStyle: React.CSSProperties = {
    position: 'relative', zIndex: 10,
    width: 400,
    background: 'var(--modal-bg)',
    border: '1px solid var(--modal-border)',
    borderRadius: 8,
    padding: 28,
    boxShadow: '0 18px 42px rgba(0,0,0,0.6), 0 0 0 1px var(--line-2)',
    fontFamily: 'var(--font-sans)',
  }

  const inputStyle: React.CSSProperties = {
    background: 'var(--bg-2)', border: '1px solid var(--line-2)', borderRadius: 5,
    padding: '9px 11px', color: '#f0f0f2', fontSize: 13, outline: 'none',
    width: '100%', transition: 'border-color 120ms', boxSizing: 'border-box',
    fontFamily: 'var(--font-sans)',
  }

  const labelStyle: React.CSSProperties = {
    fontFamily: 'var(--font-mono)', fontSize: 12, color: '#50505e',
  }

  const linkBtn: React.CSSProperties = {
    background: 'none', border: 'none', padding: 0, cursor: 'pointer',
    fontFamily: 'var(--font-mono)', fontSize: 11, color: '#50505e',
    textDecoration: 'underline', textUnderlineOffset: 3,
  }

  return (
    <div data-theme="dark" style={{
      position: 'fixed', inset: 0, background: '#0a0a0c',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      fontFamily: 'var(--font-sans)',
    }}>
      <div style={{
        position: 'absolute', inset: 0, pointerEvents: 'none',
        backgroundImage: 'radial-gradient(circle, #252530 1px, transparent 1px)',
        backgroundSize: '24px 24px', opacity: 0.5,
        maskImage: 'radial-gradient(ellipse 60% 60% at 50% 50%, black 30%, transparent 80%)',
        WebkitMaskImage: 'radial-gradient(ellipse 60% 60% at 50% 50%, black 30%, transparent 80%)',
      }} />

      <div style={cardStyle}>
        {/* Brand */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 12 }}>
          <img src="/forgy/forgyi.png" alt="Forge" width={80} height={80} style={{ objectFit: 'contain', flexShrink: 0, display: 'block' }} />
          <div style={{ display: 'flex', flexDirection: 'column', justifyContent: 'center', gap: 4, paddingTop: 24 }}>
            <div style={{ fontSize: 20, fontWeight: 700, letterSpacing: '-0.02em', color: '#f0f0f2', lineHeight: 1, fontFamily: 'var(--font-sans)' }}>Forge</div>
            <div style={{ fontFamily: 'var(--font-mono)', fontSize: 9, color: '#50505e', textTransform: 'uppercase', letterSpacing: '0.1em' }}>
              AI Game Pipeline
            </div>
          </div>
        </div>

        <div style={{ height: 1, background: 'linear-gradient(90deg, transparent, #2a2a36, transparent)', marginBottom: 20 }} />

        {/* ── Invite mode ─────────────────────────────────── */}
        {invite ? (
          !inviteReady ? (
            <div style={{ fontSize: 12, fontFamily: 'var(--font-mono)', color: '#50505e', textAlign: 'center', padding: '20px 0' }}>
              Setting up your account…
            </div>
          ) : (
            <>
              <div style={{ fontSize: 15, fontWeight: 600, color: '#f0f0f2', marginBottom: 3 }}>Welcome to Forge</div>
              <div style={{ fontSize: 12, color: '#50505e', marginBottom: 20 }}>Complete your profile to get started.</div>

              <form onSubmit={handleInviteSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
                  <label style={labelStyle}>Email</label>
                  <input type="email" value={inviteEmail} disabled style={{ ...inputStyle, opacity: 0.4, cursor: 'not-allowed' }} />
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
                  <label style={labelStyle}>Display name</label>
                  <input type="text" value={displayName} onChange={e => setDisplayName(e.target.value)} required autoFocus
                    style={inputStyle}
                    onFocus={e => { e.currentTarget.style.borderColor = 'var(--action)' }}
                    onBlur={e =>  { e.currentTarget.style.borderColor = 'var(--line-2)' }}
                  />
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
                  <label style={labelStyle}>Password</label>
                  <input type="password" value={invitePw} onChange={e => setInvitePw(e.target.value)} required
                    style={inputStyle}
                    onFocus={e => { e.currentTarget.style.borderColor = 'var(--action)' }}
                    onBlur={e =>  { e.currentTarget.style.borderColor = 'var(--line-2)' }}
                  />
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
                  <label style={labelStyle}>Confirm password</label>
                  <input type="password" value={invitePwC} onChange={e => setInvitePwC(e.target.value)} required
                    style={inputStyle}
                    onFocus={e => { e.currentTarget.style.borderColor = 'var(--action)' }}
                    onBlur={e =>  { e.currentTarget.style.borderColor = 'var(--line-2)' }}
                  />
                </div>
                {inviteError && (
                  <div style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: '#f87171', padding: '7px 10px', borderRadius: 4, background: 'rgba(248,113,113,0.08)', border: '1px solid rgba(248,113,113,0.25)' }}>
                    {inviteError}
                  </div>
                )}
                <button type="submit" disabled={inviteSaving} style={{
                  height: 38, borderRadius: 5, border: 'none', marginTop: 4,
                  background: inviteSaving ? 'var(--action-hover)' : 'var(--action)',
                  color: 'var(--action-fg)', fontSize: 13, fontWeight: 600,
                  cursor: inviteSaving ? 'wait' : 'pointer', width: '100%',
                }}>
                  {inviteSaving ? 'Activating…' : 'Activate account'}
                </button>
              </form>
            </>
          )

        /* ── Reset password mode ─────────────────────────── */
        ) : mode === 'reset' ? (
          <>
            <div style={{ fontSize: 15, fontWeight: 600, color: '#f0f0f2', marginBottom: 3 }}>Set new password</div>
            <div style={{ fontSize: 12, color: '#50505e', marginBottom: 20 }}>Choose a new password for your account.</div>

            {resetDone ? (
              <div style={{ fontFamily: 'var(--font-mono)', fontSize: 12, color: '#4ade80', padding: '12px 14px', borderRadius: 5, background: 'rgba(74,222,128,0.08)', border: '1px solid rgba(74,222,128,0.2)', textAlign: 'center' }}>
                Password updated. Redirecting…
              </div>
            ) : (
              <form onSubmit={handleReset} style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
                  <label style={labelStyle}>New password</label>
                  <input type="password" value={resetPw} onChange={e => setResetPw(e.target.value)} required autoFocus
                    style={inputStyle}
                    onFocus={e => { e.currentTarget.style.borderColor = 'var(--action)' }}
                    onBlur={e =>  { e.currentTarget.style.borderColor = 'var(--line-2)' }}
                  />
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
                  <label style={labelStyle}>Confirm new password</label>
                  <input type="password" value={resetPwC} onChange={e => setResetPwC(e.target.value)} required
                    style={inputStyle}
                    onFocus={e => { e.currentTarget.style.borderColor = 'var(--action)' }}
                    onBlur={e =>  { e.currentTarget.style.borderColor = 'var(--line-2)' }}
                  />
                </div>
                {resetError && (
                  <div style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: '#f87171', padding: '7px 10px', borderRadius: 4, background: 'rgba(248,113,113,0.08)', border: '1px solid rgba(248,113,113,0.25)' }}>
                    {resetError}
                  </div>
                )}
                <button type="submit" disabled={resetSaving} style={{
                  height: 38, borderRadius: 5, border: 'none', marginTop: 4,
                  background: resetSaving ? 'var(--action-hover)' : 'var(--action)',
                  color: 'var(--action-fg)', fontSize: 13, fontWeight: 600,
                  cursor: resetSaving ? 'wait' : 'pointer', width: '100%',
                }}>
                  {resetSaving ? 'Updating…' : 'Update password'}
                </button>
              </form>
            )}
          </>

        /* ── Forgot password mode ────────────────────────── */
        ) : mode === 'forgot' ? (
          <>
            <div style={{ fontSize: 15, fontWeight: 600, color: '#f0f0f2', marginBottom: 3 }}>Reset password</div>
            <div style={{ fontSize: 12, color: '#50505e', marginBottom: 20 }}>Enter your email and we&apos;ll send you a reset link.</div>

            {forgotSent ? (
              <>
                <div style={{ fontFamily: 'var(--font-mono)', fontSize: 12, color: '#4ade80', padding: '12px 14px', borderRadius: 5, background: 'rgba(74,222,128,0.08)', border: '1px solid rgba(74,222,128,0.2)', textAlign: 'center', marginBottom: 16 }}>
                  Check your inbox — link sent to {forgotEmail}
                </div>
                <button style={linkBtn} onClick={() => { setMode('login'); setForgotSent(false); setForgotEmail('') }}>
                  ← Back to sign in
                </button>
              </>
            ) : (
              <form onSubmit={handleForgot} style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
                  <label style={labelStyle}>Email</label>
                  <input type="email" value={forgotEmail} onChange={e => setForgotEmail(e.target.value)} required autoFocus
                    placeholder="you@studio.com" style={inputStyle}
                    onFocus={e => { e.currentTarget.style.borderColor = '#ff8a3d' }}
                    onBlur={e =>  { e.currentTarget.style.borderColor = 'var(--line-2)' }}
                  />
                </div>
                {forgotError && (
                  <div style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: '#f87171', padding: '7px 10px', borderRadius: 4, background: 'rgba(248,113,113,0.08)', border: '1px solid rgba(248,113,113,0.25)' }}>
                    {forgotError}
                  </div>
                )}
                <button type="submit" disabled={forgotLoading} style={{
                  height: 38, borderRadius: 5, border: 'none', marginTop: 4,
                  background: forgotLoading ? 'var(--action-hover)' : 'var(--action)',
                  color: 'var(--action-fg)', fontSize: 13, fontWeight: 600,
                  cursor: forgotLoading ? 'wait' : 'pointer', width: '100%',
                }}>
                  {forgotLoading ? 'Sending…' : 'Send reset link'}
                </button>
                <button type="button" style={{ ...linkBtn, textAlign: 'center' }} onClick={() => setMode('login')}>
                  ← Back to sign in
                </button>
              </form>
            )}
          </>

        ) : (
          /* ── Normal login ───────────────────────────────── */
          <>
            <div style={{ fontSize: 15, fontWeight: 600, color: '#f0f0f2', marginBottom: 3 }}>Welcome back</div>
            <div style={{ fontSize: 12, color: '#50505e', marginBottom: 20 }}>Sign in to your studio</div>

            <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
                <label htmlFor="email" style={labelStyle}>Email</label>
                <input id="email" type="email" value={email} required onChange={e => setEmail(e.target.value)}
                  autoComplete="email" placeholder="you@studio.com" style={inputStyle}
                  onFocus={e => { e.currentTarget.style.borderColor = '#ff8a3d' }}
                  onBlur={e =>  { e.currentTarget.style.borderColor = 'var(--line-2)' }}
                />
              </div>

              <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                  <label htmlFor="password" style={labelStyle}>Password</label>
                  <button type="button" style={linkBtn} onClick={() => { setMode('forgot'); setForgotEmail(email) }}>
                    Forgot password?
                  </button>
                </div>
                <div style={{ position: 'relative' }}>
                  <input id="password" value={password} required
                    type={showPassword ? 'text' : 'password'}
                    onChange={e => setPassword(e.target.value)}
                    autoComplete="current-password" placeholder="••••••••"
                    style={{ ...inputStyle, padding: '9px 38px 9px 11px' }}
                    onFocus={e => { e.currentTarget.style.borderColor = 'var(--action)' }}
                    onBlur={e =>  { e.currentTarget.style.borderColor = 'var(--line-2)' }}
                  />
                  <button type="button" tabIndex={-1} onClick={() => setShowPassword(v => !v)}
                    style={{ position: 'absolute', right: 10, top: '50%', transform: 'translateY(-50%)', background: 'none', border: 'none', cursor: 'pointer', color: '#50505e', display: 'grid', placeItems: 'center', padding: 2 }}>
                    {showPassword
                      ? <svg width="16" height="16" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13.875 18.825A10.05 10.05 0 0112 19c-4.478 0-8.268-2.943-9.543-7a9.97 9.97 0 011.563-3.029m5.858.908a3 3 0 114.243 4.243M9.878 9.878l4.242 4.242M9.88 9.88l-3.29-3.29m7.532 7.532l3.29 3.29M3 3l3.59 3.59m0 0A9.953 9.953 0 0112 5c4.478 0 8.268 2.943 9.543 7a10.025 10.025 0 01-4.132 4.411m0 0L21 21" /></svg>
                      : <svg width="16" height="16" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" /><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" /></svg>
                    }
                  </button>
                </div>
              </div>

              {error && (
                <div style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: '#f87171', padding: '7px 10px', borderRadius: 4, background: 'rgba(248,113,113,0.08)', border: '1px solid rgba(248,113,113,0.25)' }}>
                  {error}
                </div>
              )}

              <button type="submit" disabled={loading} style={{
                height: 38, borderRadius: 5, border: 'none', marginTop: 4,
                background: loading ? 'var(--action-hover)' : 'var(--action)',
                color: 'var(--action-fg)', fontSize: 13, fontWeight: 600,
                cursor: loading ? 'wait' : 'pointer',
                display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
                transition: 'filter 120ms', width: '100%',
              }}>
                {loading ? 'Signing in…' : 'Sign in →'}
              </button>
            </form>
          </>
        )}

        <div style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color: '#50505e', textAlign: 'center', marginTop: 20, letterSpacing: '0.05em' }}>
          V57 Studio · Authorized access only
        </div>
      </div>
    </div>
  )
}
