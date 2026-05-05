'use client'

import { useEffect } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import UserMenu from '@/components/layout/UserMenu'
import { useAuth } from '@/lib/auth-context'

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  const { member, loading } = useAuth()
  const router = useRouter()

  useEffect(() => {
    if (!loading && member?.role !== 'admin') router.replace('/')
  }, [loading, member, router])

  if (loading || member?.role !== 'admin') return null

  return (
    <div style={{ height: '100vh', background: 'var(--bg-0)', display: 'flex', flexDirection: 'column' }}>
      <style>{`
        .admin-back:hover { color: var(--text-0) !important; }
        .admin-nav-link:hover { color: var(--text-0) !important; }
      `}</style>
      <div style={{
        height: 44, padding: '0 16px',
        borderBottom: '1px solid var(--line-2)',
        background: 'var(--bg-1)',
        display: 'flex', alignItems: 'center', gap: 16,
        flexShrink: 0,
      }}>
        <Link href="/" className="admin-back" style={{
          display: 'flex', alignItems: 'center', gap: 6,
          fontSize: 11, fontFamily: 'monospace', color: 'var(--text-3)',
          textDecoration: 'none', transition: 'color 120ms',
        }}>
          ← Projects
        </Link>

        <div style={{ width: 1, height: 16, background: 'var(--line-2)' }} />

        <span style={{ fontSize: 11, fontFamily: 'monospace', color: 'var(--text-2)', fontWeight: 600, letterSpacing: '0.06em', textTransform: 'uppercase' }}>
          Admin
        </span>

        <div style={{ width: 1, height: 16, background: 'var(--line-2)' }} />

        <Link href="/admin/users" className="admin-nav-link" style={{ fontSize: 11, fontFamily: 'monospace', color: 'var(--text-3)', textDecoration: 'none', transition: 'color 120ms' }}>
          Users
        </Link>
        <Link href="/admin/feedback" className="admin-nav-link" style={{ fontSize: 11, fontFamily: 'monospace', color: 'var(--text-3)', textDecoration: 'none', transition: 'color 120ms' }}>
          Feedback
        </Link>
        <Link href="/admin/integrations" className="admin-nav-link" style={{ fontSize: 11, fontFamily: 'monospace', color: 'var(--text-3)', textDecoration: 'none', transition: 'color 120ms' }}>
          Integrations
        </Link>

        <div style={{ flex: 1 }} />

        <UserMenu />
      </div>

      <div style={{ flex: 1, overflow: 'hidden' }}>
        {children}
      </div>
    </div>
  )
}
