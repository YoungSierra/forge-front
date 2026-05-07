'use client'

import { useState } from 'react'
import Link from 'next/link'
import ProjectsList from '@/components/projects/ProjectsList'
import AssetLibrary from '@/components/projects/AssetLibrary'
import HomeHeader from '@/components/layout/HomeHeader'

type Tab = 'projects' | 'assets'

export default function HomePage() {
  const [tab, setTab] = useState<Tab>('projects')

  return (
    <div style={{ minHeight: '100vh', background: 'var(--bg-0)', display: 'flex', flexDirection: 'column' }}>
      <HomeHeader />
      <main style={{ flex: 1, maxWidth: 1120, width: '100%', margin: '0 auto', padding: '32px 24px' }}>

        {/* Header row */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 24 }}>
          {/* Tabs */}
          <div style={{ display: 'flex', gap: 0, borderBottom: '1px solid var(--line-2)' }}>
            {([['projects', 'Projects'], ['assets', 'Asset Library']] as [Tab, string][]).map(([id, label]) => {
              const active = tab === id
              return (
                <button
                  key={id}
                  onClick={() => setTab(id)}
                  style={{
                    background: 'none', border: 'none', cursor: 'pointer',
                    padding: '4px 20px 8px 0', fontSize: 22, fontWeight: 700,
                    letterSpacing: '-0.01em',
                    color: active ? 'var(--text-0)' : 'var(--text-3)',
                    borderBottom: active ? '2px solid var(--cat-code)' : '2px solid transparent',
                    marginBottom: -1, transition: 'color 120ms',
                  }}
                >
                  {label}
                </button>
              )
            })}
          </div>

          {tab === 'projects' && (
            <Link
              href="/projects/new"
              style={{
                display: 'inline-flex', alignItems: 'center', gap: 6,
                height: 32, padding: '0 14px',
                background: 'var(--cat-code)', color: '#0a0a0c',
                borderRadius: 5, fontSize: 12, fontWeight: 600,
                textDecoration: 'none',
              }}
            >
              + New game
            </Link>
          )}
        </div>

        {tab === 'projects' ? <ProjectsList /> : <AssetLibrary />}
      </main>
    </div>
  )
}
