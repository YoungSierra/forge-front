'use client'

import Link from 'next/link'
import UserMenu from './UserMenu'

export default function Header() {
  return (
    <header style={{
      height: 44, display: 'flex', alignItems: 'center', justifyContent: 'space-between',
      padding: '0 24px', borderBottom: '1px solid var(--line)',
      background: 'var(--bg-1)', position: 'sticky', top: 0, zIndex: 30,
    }}>
      <Link href="/" className="forge-logo">
        <svg width="20" height="20" viewBox="0 0 32 32" aria-hidden="true">
          <path d="M16 4 L26 14 L26 22 L20 28 L12 28 L6 22 L6 14 Z" fill="#ff8a3d" stroke="#1a0d04" strokeWidth="0.5"/>
          <path d="M16 10 L22 16 L22 21 L18 25 L14 25 L10 21 L10 16 Z" fill="#ffe7d4" opacity="0.85"/>
        </svg>
        <span className="forge-logo-wordmark" style={{ fontSize: 13 }}>Forge</span>
        <span className="forge-logo-sub">AI Pipeline</span>
      </Link>
      <UserMenu />
    </header>
  )
}
