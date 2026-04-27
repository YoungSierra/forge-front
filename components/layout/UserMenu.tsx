'use client'

import { useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { useAuth } from '@/lib/auth-context'
import { getMemberByAuth } from '@/lib/api'

export default function UserMenu() {
  const { user, signOut } = useAuth()
  const router = useRouter()
  const [open, setOpen]     = useState(false)
  const [isAdmin, setIsAdmin] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (user?.id) getMemberByAuth(user.id).then(m => setIsAdmin(m?.role === 'admin'))
  }, [user?.id])

  useEffect(() => {
    if (!open) return
    function onClickOutside(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onClickOutside)
    return () => document.removeEventListener('mousedown', onClickOutside)
  }, [open])

  if (!user) return null

  const initials = (user.email ?? '?').slice(0, 2).toUpperCase()

  async function handleSignOut() {
    setOpen(false)
    await signOut()
    router.push('/login')
  }

  return (
    <div ref={ref} style={{ position: 'relative' }}>
      <button
        onClick={() => setOpen(v => !v)}
        title={user.email ?? undefined}
        style={{
          width: 26, height: 26,
          borderRadius: '50%',
          background: open ? 'var(--bg-4)' : 'var(--bg-3)',
          border: '1px solid var(--line-2)',
          color: 'var(--text-1)',
          fontFamily: 'var(--font-mono)',
          fontSize: 9,
          fontWeight: 600,
          letterSpacing: '0.04em',
          cursor: 'pointer',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          transition: 'background 100ms, border-color 100ms',
          flexShrink: 0,
        }}
      >
        {initials}
      </button>

      {open && (
        <div style={{
          position: 'absolute',
          top: 'calc(100% + 6px)',
          right: 0,
          minWidth: 200,
          background: 'var(--bg-2)',
          border: '1px solid var(--line-2)',
          borderRadius: 6,
          overflow: 'hidden',
          zIndex: 200,
          boxShadow: '0 8px 24px rgba(0,0,0,0.5)',
        }}>
          {/* Email — informativo */}
          <div style={{
            padding: '10px 14px',
            borderBottom: '1px solid var(--line)',
          }}>
            <div style={{ fontSize: 9, fontFamily: 'var(--font-mono)', color: 'var(--text-3)', textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: 4 }}>
              Signed in as
            </div>
            <div style={{ fontSize: 11, fontFamily: 'var(--font-mono)', color: 'var(--text-1)', wordBreak: 'break-all' }}>
              {user.email}
            </div>
          </div>

          {/* Feedback admin — only for admins */}
          {isAdmin && <Link
            href="/admin/feedback"
            onClick={() => setOpen(false)}
            style={{
              display: 'flex', alignItems: 'center', gap: 8,
              width: '100%', padding: '9px 14px',
              fontSize: 12, color: 'var(--text-2)', textDecoration: 'none',
              borderBottom: '1px solid var(--line-2)',
              transition: 'background 80ms, color 80ms',
            }}
            onMouseEnter={e => {
              (e.currentTarget as HTMLAnchorElement).style.background = 'var(--bg-3)'
              ;(e.currentTarget as HTMLAnchorElement).style.color = 'var(--text-0)'
            }}
            onMouseLeave={e => {
              (e.currentTarget as HTMLAnchorElement).style.background = 'none'
              ;(e.currentTarget as HTMLAnchorElement).style.color = 'var(--text-2)'
            }}
          >
            <span style={{ fontSize: 13, lineHeight: 1 }}>◎</span>
            Feedback
          </Link>}

          {/* Sign out */}
          <button
            onClick={handleSignOut}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 8,
              width: '100%',
              padding: '9px 14px',
              background: 'none',
              border: 'none',
              cursor: 'pointer',
              fontSize: 12,
              color: 'var(--text-2)',
              textAlign: 'left',
              transition: 'background 80ms, color 80ms',
            }}
            onMouseEnter={e => {
              (e.currentTarget as HTMLButtonElement).style.background = 'color-mix(in oklch, var(--cat-output) 10%, var(--bg-3))'
              ;(e.currentTarget as HTMLButtonElement).style.color = 'var(--cat-output)'
            }}
            onMouseLeave={e => {
              (e.currentTarget as HTMLButtonElement).style.background = 'none'
              ;(e.currentTarget as HTMLButtonElement).style.color = 'var(--text-2)'
            }}
          >
            <span style={{ fontSize: 13, lineHeight: 1 }}>→</span>
            Sign out
          </button>
        </div>
      )}
    </div>
  )
}
