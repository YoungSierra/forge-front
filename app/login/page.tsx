'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase'

export default function LoginPage() {
  const router = useRouter()
  const [email, setEmail]               = useState('')
  const [password, setPassword]         = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [loading, setLoading]           = useState(false)
  const [error, setError]               = useState<string | null>(null)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setLoading(true)
    setError(null)
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

  return (
    <div style={{
      position: 'fixed', inset: 0,
      background: '#0a0a0c',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      fontFamily: 'var(--font-geist-sans, system-ui, sans-serif)',
    }}>
      {/* Dot grid */}
      <div style={{
        position: 'absolute', inset: 0, pointerEvents: 'none',
        backgroundImage: 'radial-gradient(circle, #252530 1px, transparent 1px)',
        backgroundSize: '24px 24px',
        opacity: 0.5,
        maskImage: 'radial-gradient(ellipse 60% 60% at 50% 50%, black 30%, transparent 80%)',
        WebkitMaskImage: 'radial-gradient(ellipse 60% 60% at 50% 50%, black 30%, transparent 80%)',
      }} />

      {/* Card */}
      <div style={{
        position: 'relative', zIndex: 10,
        width: 360,
        background: '#111115',
        border: '1px solid #2a2a36',
        borderRadius: 12,
        padding: 28,
        boxShadow: '0 24px 64px rgba(0,0,0,0.6)',
      }}>
        {/* Brand */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 22 }}>
          <div style={{
            width: 32, height: 32, flexShrink: 0,
            background: 'conic-gradient(from 45deg, #2563eb, #16a34a, #d97706, #ea580c, #2563eb)',
            clipPath: 'polygon(50% 0, 100% 50%, 50% 100%, 0 50%)',
          }} />
          <div>
            <div style={{ fontSize: 17, fontWeight: 700, letterSpacing: '0.14em', color: '#f0f0f2', lineHeight: 1 }}>
              FORGE
            </div>
            <div style={{ fontFamily: 'var(--font-geist-mono, monospace)', fontSize: 9, color: '#50505e', textTransform: 'uppercase', letterSpacing: '0.1em', marginTop: 3 }}>
              AI Game Pipeline
            </div>
          </div>
        </div>

        <div style={{ height: 1, background: 'linear-gradient(90deg, transparent, #2a2a36, transparent)', marginBottom: 20 }} />

        <div style={{ fontSize: 15, fontWeight: 600, color: '#f0f0f2', marginBottom: 3 }}>Welcome back</div>
        <div style={{ fontSize: 12, color: '#50505e', marginBottom: 20 }}>Sign in to your studio</div>

        <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          {/* Email */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
            <label htmlFor="email" style={{ fontFamily: 'monospace', fontSize: 10, textTransform: 'uppercase', letterSpacing: '0.1em', color: '#50505e' }}>
              Email
            </label>
            <input
              id="email" type="email" value={email} required
              onChange={e => setEmail(e.target.value)}
              autoComplete="email"
              placeholder="you@studio.com"
              style={{
                background: '#0a0a0c', border: '1px solid #2a2a36', borderRadius: 5,
                padding: '9px 11px', color: '#f0f0f2', fontSize: 13, outline: 'none',
                width: '100%', transition: 'border-color 120ms',
              }}
              onFocus={e => { e.currentTarget.style.borderColor = '#4ade80' }}
              onBlur={e =>  { e.currentTarget.style.borderColor = '#2a2a36' }}
            />
          </div>

          {/* Password */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
            <label htmlFor="password" style={{ fontFamily: 'monospace', fontSize: 10, textTransform: 'uppercase', letterSpacing: '0.1em', color: '#50505e' }}>
              Password
            </label>
            <div style={{ position: 'relative' }}>
              <input
                id="password" value={password} required
                type={showPassword ? 'text' : 'password'}
                onChange={e => setPassword(e.target.value)}
                autoComplete="current-password"
                placeholder="••••••••"
                style={{
                  background: '#0a0a0c', border: '1px solid #2a2a36', borderRadius: 5,
                  padding: '9px 38px 9px 11px', color: '#f0f0f2', fontSize: 13, outline: 'none',
                  width: '100%', transition: 'border-color 120ms',
                }}
                onFocus={e => { e.currentTarget.style.borderColor = '#4ade80' }}
                onBlur={e =>  { e.currentTarget.style.borderColor = '#2a2a36' }}
              />
              <button
                type="button" tabIndex={-1}
                onClick={() => setShowPassword(v => !v)}
                style={{
                  position: 'absolute', right: 10, top: '50%', transform: 'translateY(-50%)',
                  background: 'none', border: 'none', cursor: 'pointer', color: '#50505e',
                  display: 'grid', placeItems: 'center', padding: 2,
                }}
              >
                {showPassword
                  ? <svg width="16" height="16" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13.875 18.825A10.05 10.05 0 0112 19c-4.478 0-8.268-2.943-9.543-7a9.97 9.97 0 011.563-3.029m5.858.908a3 3 0 114.243 4.243M9.878 9.878l4.242 4.242M9.88 9.88l-3.29-3.29m7.532 7.532l3.29 3.29M3 3l3.59 3.59m0 0A9.953 9.953 0 0112 5c4.478 0 8.268 2.943 9.543 7a10.025 10.025 0 01-4.132 4.411m0 0L21 21" /></svg>
                  : <svg width="16" height="16" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" /><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" /></svg>
                }
              </button>
            </div>
          </div>

          {/* Error */}
          {error && (
            <div style={{
              fontFamily: 'monospace', fontSize: 11, color: '#f87171',
              padding: '7px 10px', borderRadius: 4,
              background: 'rgba(248,113,113,0.08)', border: '1px solid rgba(248,113,113,0.25)',
            }}>
              {error}
            </div>
          )}

          {/* Submit */}
          <button
            type="submit" disabled={loading}
            style={{
              height: 38, borderRadius: 5, border: 'none', marginTop: 4,
              background: loading ? '#166534' : '#16a34a',
              color: '#0a0a0c', fontSize: 13, fontWeight: 600,
              cursor: loading ? 'wait' : 'pointer',
              display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
              transition: 'filter 120ms', width: '100%',
            }}
          >
            {loading ? 'Signing in…' : 'Sign in →'}
          </button>
        </form>

        <div style={{ fontFamily: 'monospace', fontSize: 10, color: '#50505e', textAlign: 'center', marginTop: 20, letterSpacing: '0.05em' }}>
          V57 Studio · Authorized access only
        </div>
      </div>
    </div>
  )
}
