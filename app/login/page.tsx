'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase'
import { updateAdminUser } from '@/lib/api'

// Capture hash at module-load time (before Supabase's GoTrueClient clears it).
// Only runs in the browser; on the server this stays ''.
const _rawHash = typeof window !== 'undefined' ? window.location.hash : ''
// Prevent re-triggering invite flow when the component remounts (e.g. after sign-out).
let _inviteConsumed = false

export default function LoginPage() {
  const router = useRouter()

  // ── Normal login state ──────────────────────────────────────
  const [email, setEmail]               = useState('')
  const [password, setPassword]         = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [loading, setLoading]           = useState(false)
  const [error, setError]               = useState<string | null>(null)

  // ── Invite-accept state ─────────────────────────────────────
  // Starts null to match SSR (avoids hydration mismatch); set in useEffect.
  const [invite, setInvite]             = useState<{ at: string; rt: string } | null>(null)
  const [inviteReady, setInviteReady]   = useState(false)
  const [inviteEmail, setInviteEmail]   = useState('')
  const [displayName, setDisplayName]   = useState('')
  const [invitePw, setInvitePw]         = useState('')
  const [invitePwC, setInvitePwC]       = useState('')
  const [inviteSaving, setInviteSaving] = useState(false)
  const [inviteError, setInviteError]   = useState('')

  useEffect(() => {
    if (_inviteConsumed) return
    if (!_rawHash.includes('access_token') || !_rawHash.includes('type=invite')) return
    const p = new URLSearchParams(_rawHash.replace(/^#/, ''))
    const at = p.get('access_token')
    const rt = p.get('refresh_token') ?? ''
    if (!at) return
    _inviteConsumed = true
    const tokens = { at, rt }
    setInvite(tokens)
    // Establish the invite session to get the user's email
    const supabase = createClient()
    supabase.auth.setSession({ access_token: at, refresh_token: rt })
      .then(({ data, error }) => {
        if (error || !data.session?.user?.email) return
        const e = data.session.user.email
        setInviteEmail(e)
        setDisplayName(e.split('@')[0])
        setInviteReady(true)
      })
  }, [])

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
      await updateAdminUser(user.id, { display_name: displayName })
      router.replace('/')
    } catch (err: unknown) {
      setInviteError(err instanceof Error ? err.message : 'Unknown error')
      setInviteSaving(false)
    }
  }

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

  const cardStyle: React.CSSProperties = {
    position: 'relative', zIndex: 10,
    width: 360,
    background: '#111115',
    border: '1px solid #2a2a36',
    borderRadius: 12,
    padding: 28,
    boxShadow: '0 24px 64px rgba(0,0,0,0.6)',
  }

  const inputStyle: React.CSSProperties = {
    background: '#0a0a0c', border: '1px solid #2a2a36', borderRadius: 5,
    padding: '9px 11px', color: '#f0f0f2', fontSize: 13, outline: 'none',
    width: '100%', transition: 'border-color 120ms', boxSizing: 'border-box',
    fontFamily: 'inherit',
  }

  const labelStyle: React.CSSProperties = {
    fontFamily: 'monospace', fontSize: 10, textTransform: 'uppercase',
    letterSpacing: '0.1em', color: '#50505e',
  }

  return (
    <div style={{
      position: 'fixed', inset: 0, background: '#0a0a0c',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      fontFamily: 'var(--font-geist-sans, system-ui, sans-serif)',
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
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 22 }}>
          <div style={{
            width: 32, height: 32, flexShrink: 0,
            background: 'conic-gradient(from 45deg, #2563eb, #16a34a, #d97706, #ea580c, #2563eb)',
            clipPath: 'polygon(50% 0, 100% 50%, 50% 100%, 0 50%)',
          }} />
          <div>
            <div style={{ fontSize: 17, fontWeight: 700, letterSpacing: '0.14em', color: '#f0f0f2', lineHeight: 1 }}>FORGE</div>
            <div style={{ fontFamily: 'var(--font-geist-mono, monospace)', fontSize: 9, color: '#50505e', textTransform: 'uppercase', letterSpacing: '0.1em', marginTop: 3 }}>
              AI Game Pipeline
            </div>
          </div>
        </div>

        <div style={{ height: 1, background: 'linear-gradient(90deg, transparent, #2a2a36, transparent)', marginBottom: 20 }} />

        {/* ── Invite mode ─────────────────────────────────── */}
        {invite ? (
          !inviteReady ? (
            <div style={{ fontSize: 12, fontFamily: 'monospace', color: '#50505e', textAlign: 'center', padding: '20px 0' }}>
              Setting up your account…
            </div>
          ) : (
            <>
              <div style={{ fontSize: 15, fontWeight: 600, color: '#f0f0f2', marginBottom: 3 }}>Welcome to FORGE</div>
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
                    onFocus={e => { e.currentTarget.style.borderColor = '#4ade80' }}
                    onBlur={e =>  { e.currentTarget.style.borderColor = '#2a2a36' }}
                  />
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
                  <label style={labelStyle}>Password</label>
                  <input type="password" value={invitePw} onChange={e => setInvitePw(e.target.value)} required
                    style={inputStyle}
                    onFocus={e => { e.currentTarget.style.borderColor = '#4ade80' }}
                    onBlur={e =>  { e.currentTarget.style.borderColor = '#2a2a36' }}
                  />
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
                  <label style={labelStyle}>Confirm password</label>
                  <input type="password" value={invitePwC} onChange={e => setInvitePwC(e.target.value)} required
                    style={inputStyle}
                    onFocus={e => { e.currentTarget.style.borderColor = '#4ade80' }}
                    onBlur={e =>  { e.currentTarget.style.borderColor = '#2a2a36' }}
                  />
                </div>
                {inviteError && (
                  <div style={{ fontFamily: 'monospace', fontSize: 11, color: '#f87171', padding: '7px 10px', borderRadius: 4, background: 'rgba(248,113,113,0.08)', border: '1px solid rgba(248,113,113,0.25)' }}>
                    {inviteError}
                  </div>
                )}
                <button type="submit" disabled={inviteSaving} style={{
                  height: 38, borderRadius: 5, border: 'none', marginTop: 4,
                  background: inviteSaving ? '#166534' : '#16a34a',
                  color: '#0a0a0c', fontSize: 13, fontWeight: 600,
                  cursor: inviteSaving ? 'wait' : 'pointer', width: '100%',
                }}>
                  {inviteSaving ? 'Activating…' : 'Activate account'}
                </button>
              </form>
            </>
          )
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
                  onFocus={e => { e.currentTarget.style.borderColor = '#4ade80' }}
                  onBlur={e =>  { e.currentTarget.style.borderColor = '#2a2a36' }}
                />
              </div>

              <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
                <label htmlFor="password" style={labelStyle}>Password</label>
                <div style={{ position: 'relative' }}>
                  <input id="password" value={password} required
                    type={showPassword ? 'text' : 'password'}
                    onChange={e => setPassword(e.target.value)}
                    autoComplete="current-password" placeholder="••••••••"
                    style={{ ...inputStyle, padding: '9px 38px 9px 11px' }}
                    onFocus={e => { e.currentTarget.style.borderColor = '#4ade80' }}
                    onBlur={e =>  { e.currentTarget.style.borderColor = '#2a2a36' }}
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
                <div style={{ fontFamily: 'monospace', fontSize: 11, color: '#f87171', padding: '7px 10px', borderRadius: 4, background: 'rgba(248,113,113,0.08)', border: '1px solid rgba(248,113,113,0.25)' }}>
                  {error}
                </div>
              )}

              <button type="submit" disabled={loading} style={{
                height: 38, borderRadius: 5, border: 'none', marginTop: 4,
                background: loading ? '#166534' : '#16a34a',
                color: '#0a0a0c', fontSize: 13, fontWeight: 600,
                cursor: loading ? 'wait' : 'pointer',
                display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
                transition: 'filter 120ms', width: '100%',
              }}>
                {loading ? 'Signing in…' : 'Sign in →'}
              </button>
            </form>
          </>
        )}

        <div style={{ fontFamily: 'monospace', fontSize: 10, color: '#50505e', textAlign: 'center', marginTop: 20, letterSpacing: '0.05em' }}>
          V57 Studio · Authorized access only
        </div>
      </div>
    </div>
  )
}
