import Link from 'next/link'

export default function AdminLayout({ children }: { children: React.ReactNode }) {
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
      </div>

      <div style={{ flex: 1, overflow: 'hidden' }}>
        {children}
      </div>
    </div>
  )
}
