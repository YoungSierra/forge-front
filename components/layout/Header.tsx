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
        <img src="/forgy/forgyi.png" alt="Forge" width={20} height={20} style={{ objectFit: 'contain' }} />
        <span className="forge-logo-wordmark" style={{ fontSize: 13 }}>Forge</span>
        <span className="forge-logo-sub">AI Pipeline</span>
      </Link>
      <UserMenu />
    </header>
  )
}
