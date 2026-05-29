'use client'

import { useEffect } from 'react'
import { useRouter, usePathname } from 'next/navigation'
import Link from 'next/link'
import UserMenu from '@/components/layout/UserMenu'
import { useAuth } from '@/lib/auth-context'
import { useTheme } from '@/lib/theme'

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  const { member, loading } = useAuth()
  const router = useRouter()
  const pathname = usePathname()
  const { theme, toggle: toggleTheme } = useTheme()

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
        <Link href="/" className="forge-logo" style={{ paddingRight: 10, marginRight: 4, borderRight: '1px solid var(--line-2)' }}>
          <img src="/forgy/forgyi.png" alt="Forge" width={18} height={18} style={{ objectFit: 'contain' }} />
          <span className="forge-logo-wordmark" style={{ fontSize: 13 }}>Forge</span>
        </Link>

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

        {[
          { href: '/admin/users',        label: 'Users'        },
          { href: '/admin/integrations', label: 'Integrations' },
          { href: '/admin/nodes',        label: 'NMS'          },
          { href: '/admin/blueprints',   label: 'BMS'          },
          { href: '/admin/skills',       label: 'Skills'       },
          { href: '/admin/analytics',    label: 'Analytics'    },
          { href: '/admin/feedback',     label: 'Feedback'     },
        ].map(({ href, label }) => {
          const active = pathname === href
          return (
            <Link key={href} href={href}
              className="admin-nav-link"
              style={{
                fontSize: 11, fontFamily: 'monospace', textDecoration: 'none', transition: 'color 120ms',
                color: active ? 'var(--text-0)' : 'var(--text-3)',
                fontWeight: active ? 600 : 400,
                display: 'inline-flex', alignItems: 'center',
                height: 44, boxSizing: 'border-box',
                borderBottom: `2px solid ${active ? 'var(--action)' : 'transparent'}`,
                paddingTop: 2,
              }}
            >
              {label}
            </Link>
          )
        })}

        <div style={{ flex: 1 }} />

        <div className="theme-toggle" role="group" aria-label="Theme">
          <button
            type="button"
            className={theme === 'dark' ? 'is-active' : ''}
            onClick={() => theme !== 'dark' && toggleTheme()}
            title="Dark mode"
          >
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/>
            </svg>
            Dark
          </button>
          <button
            type="button"
            className={theme === 'light' ? 'is-active' : ''}
            onClick={() => theme !== 'light' && toggleTheme()}
            title="Light mode"
          >
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M4.93 19.07l1.41-1.41M17.66 6.34l1.41-1.41"/>
            </svg>
            Light
          </button>
        </div>

        <UserMenu />
      </div>

      <div style={{ flex: 1, overflow: 'hidden' }}>
        {children}
      </div>
    </div>
  )
}
