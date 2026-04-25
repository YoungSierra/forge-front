import Link from 'next/link'
import ProjectsList from '@/components/projects/ProjectsList'
import HomeHeader from '@/components/layout/HomeHeader'

export default function HomePage() {
  return (
    <div style={{ minHeight: '100vh', background: 'var(--bg-0)', display: 'flex', flexDirection: 'column' }}>
      <HomeHeader />
      <main style={{ flex: 1, maxWidth: 1120, width: '100%', margin: '0 auto', padding: '32px 24px' }}>
        <div style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', marginBottom: 28 }}>
          <div>
            <h1 style={{ fontSize: 22, fontWeight: 700, color: 'var(--text-0)', letterSpacing: '-0.01em', marginBottom: 4 }}>
              Projects
            </h1>
            <p style={{ fontSize: 12, color: 'var(--text-3)', fontFamily: 'var(--font-geist-mono, monospace)' }}>
              AI-powered game pipeline
            </p>
          </div>
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
        </div>
        <ProjectsList />
      </main>
    </div>
  )
}
