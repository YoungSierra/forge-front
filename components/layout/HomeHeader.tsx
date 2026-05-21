'use client'

import Link from 'next/link'
import UserMenu from './UserMenu'
import ReviewBadge from './ReviewBadge'
import { useTheme } from '@/lib/theme'

export default function HomeHeader() {
  const { theme, toggle: toggleTheme } = useTheme()

  return (
    <header style={{
      height: 44, display: 'flex', alignItems: 'center', justifyContent: 'space-between',
      padding: '0 24px', borderBottom: '1px solid var(--line)',
      background: 'var(--bg-1)', position: 'sticky', top: 0, zIndex: 30,
    }}>
      {/* Brand */}
      <Link href="/" className="forge-logo">
        <img src="/forgy/forgyi.png" alt="Forge" width={22} height={22} style={{ objectFit: 'contain' }} />
        <span className="forge-logo-wordmark">Forge</span>
        <span className="forge-logo-sub">AI Pipeline</span>
      </Link>

      {/* Right */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
        <ReviewBadge />

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
    </header>
  )
}
