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
      <Link href="/" style={{ display: 'flex', alignItems: 'center', gap: 10, textDecoration: 'none' }}>
        <div style={{
          width: 18, height: 18, flexShrink: 0,
          background: 'conic-gradient(from 45deg, var(--cat-asset), var(--cat-code), var(--cat-audio), var(--cat-gate), var(--cat-asset))',
          clipPath: 'polygon(50% 0, 100% 50%, 50% 100%, 0 50%)',
        }} />
        <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-0)', letterSpacing: '0.01em' }}>FORGE</span>
        <span style={{ fontSize: 10, color: 'var(--text-3)', fontFamily: 'monospace', borderLeft: '1px solid var(--line)', paddingLeft: 8, marginLeft: 2 }}>
          AI Pipeline
        </span>
      </Link>
      <UserMenu />
    </header>
  )
}
