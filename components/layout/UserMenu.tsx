'use client'

import { useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { useAuth } from '@/lib/auth-context'
import { getMemberByAuth, updateAdminUser, invalidateMemberCache, getChangelog } from '@/lib/api'
import { createClient } from '@/lib/supabase'
import type { ChangelogEntry, ChangelogType } from '@/lib/types'

// Metadata visual por tipo de entrada (badge/color) — espejo del admin
const CHANGELOG_TYPE_META: Record<ChangelogType, { label: string; color: string }> = {
  new_feature: { label: 'New Feature', color: 'var(--state-success, #22c55e)' },
  improvement: { label: 'Improvement', color: 'var(--action, #3b82f6)' },
  bug_fix:     { label: 'Bug Fix',     color: 'var(--state-error, #ef4444)' },
}

const CHANGELOG_SEEN_KEY = 'forge_changelog_last_seen'

const menuItemStyle: React.CSSProperties = {
  display: 'flex', alignItems: 'center', gap: 8,
  width: '100%', padding: '9px 14px',
  fontSize: 12, color: 'var(--text-2)', textDecoration: 'none',
  borderBottom: '1px solid var(--line-2)',
  transition: 'background 80ms, color 80ms',
  background: 'none', border: 'none', cursor: 'pointer', textAlign: 'left',
}

const inputStyle: React.CSSProperties = {
  width: '100%', background: 'var(--bg-1)', border: '1px solid var(--line-2)',
  borderRadius: 6, padding: '7px 10px', fontSize: 12, color: 'var(--text-0)',
  outline: 'none', boxSizing: 'border-box', fontFamily: 'inherit',
}

const labelStyle: React.CSSProperties = {
  fontSize: 10, fontFamily: 'monospace', color: 'var(--text-3)',
  textTransform: 'uppercase', letterSpacing: '0.08em', display: 'block', marginBottom: 5,
}

export default function UserMenu() {
  const { user, signOut } = useAuth()
  const router = useRouter()
  const [open, setOpen]       = useState(false)
  const [isAdmin, setIsAdmin] = useState(false)
  const [profileModal, setProfileModal] = useState(false)
  const [profileName, setProfileName]   = useState('')
  const [pw, setPw]           = useState('')
  const [pwConfirm, setPwConfirm] = useState('')
  const [pwSaving, setPwSaving]   = useState(false)
  const [pwError, setPwError]     = useState('')
  const [pwSuccess, setPwSuccess] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  // ── What's New / Changelog ──
  const CHANGELOG_PAGE = 25
  const [changelog, setChangelog]   = useState<ChangelogEntry[]>([])
  const [whatsNewOpen, setWhatsNew] = useState(false)
  const [hasUnseen, setHasUnseen]   = useState(false)
  const [hasMore, setHasMore]       = useState(false)
  const [loadingMore, setLoadingMore] = useState(false)

  useEffect(() => {
    if (user?.id) getMemberByAuth(user.id).then(m => setIsAdmin(m?.role === 'admin'))
  }, [user?.id])

  // Carga la primera página del changelog y calcula si hay entradas sin ver (vs localStorage)
  useEffect(() => {
    if (!user) return
    getChangelog({ limit: CHANGELOG_PAGE, offset: 0 })
      .then(({ entries, hasMore: more }) => {
        setChangelog(entries)
        setHasMore(more)
        const latest = entries[0]?.released_at ?? null   // ya viene ordenado desc
        const lastSeen = typeof window !== 'undefined' ? localStorage.getItem(CHANGELOG_SEEN_KEY) : null
        if (latest && (!lastSeen || latest > lastSeen)) setHasUnseen(true)
      })
      .catch(() => { /* silencioso: el changelog no es crítico */ })
  }, [user])

  // Trae el siguiente bloque de entradas más antiguas y las anexa
  async function loadOlder() {
    setLoadingMore(true)
    try {
      const { entries, hasMore: more } = await getChangelog({ limit: CHANGELOG_PAGE, offset: changelog.length })
      setChangelog(prev => [...prev, ...entries])
      setHasMore(more)
    } catch { /* silencioso */ }
    finally { setLoadingMore(false) }
  }

  function openWhatsNew() {
    setOpen(false)
    setWhatsNew(true)
    // Marca como visto: guarda el released_at más reciente
    const latest = changelog[0]?.released_at
    if (latest && typeof window !== 'undefined') localStorage.setItem(CHANGELOG_SEEN_KEY, latest)
    setHasUnseen(false)
  }

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

  function openProfileModal() {
    setOpen(false)
    setPw(''); setPwConfirm(''); setPwError(''); setPwSuccess(false)
    getMemberByAuth(user!.id).then(m => setProfileName(m?.display_name ?? ''))
    setProfileModal(true)
  }

  async function handleProfileSave(e: React.FormEvent) {
    e.preventDefault()
    if (pw && pw !== pwConfirm) { setPwError('Passwords do not match'); return }
    if (pw && pw.length < 6)    { setPwError('Password must be at least 6 characters'); return }
    setPwSaving(true)
    setPwError('')
    try {
      const supabase = createClient()
      const updates: Record<string, unknown> = { data: { display_name: profileName } }
      if (pw) updates.password = pw
      const { error } = await supabase.auth.updateUser(updates as Parameters<typeof supabase.auth.updateUser>[0])
      if (error) throw error
      if (profileName && user?.id) {
        await updateAdminUser(user.id, { display_name: profileName })
        invalidateMemberCache(user.id)
      }
      setPwSuccess(true)
      setTimeout(() => setProfileModal(false), 1500)
    } catch (err: unknown) {
      setPwError(err instanceof Error ? err.message : 'Unknown error')
    } finally {
      setPwSaving(false)
    }
  }

  return (
    <>
      <div ref={ref} style={{ position: 'relative' }}>
        <button
          onClick={() => setOpen(v => !v)}
          title={user.email ?? undefined}
          style={{
            width: 26, height: 26, borderRadius: '50%',
            background: open ? 'var(--bg-4)' : 'var(--bg-3)',
            border: '1px solid var(--line-2)', color: 'var(--text-1)',
            fontFamily: 'var(--font-mono)', fontSize: 9, fontWeight: 600,
            letterSpacing: '0.04em', cursor: 'pointer',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            transition: 'background 100ms, border-color 100ms', flexShrink: 0,
          }}
        >
          {initials}
        </button>

        {/* Dot de "novedades sin ver" sobre el avatar */}
        {hasUnseen && !open && (
          <span style={{
            position: 'absolute', top: -1, right: -1, width: 9, height: 9,
            borderRadius: '50%', background: 'var(--action, #3b82f6)',
            border: '1.5px solid var(--bg-1)', pointerEvents: 'none',
          }} />
        )}

        {open && (
          <div style={{
            position: 'absolute', top: 'calc(100% + 6px)', right: 0,
            minWidth: 215, background: 'var(--bg-2)', border: '1px solid var(--line-2)',
            borderRadius: 6, overflow: 'hidden', zIndex: 200,
            boxShadow: '0 8px 24px rgba(0,0,0,0.5)',
          }}>
            {/* Email */}
            <div style={{ padding: '10px 14px', borderBottom: '1px solid var(--line)' }}>
              <div style={{ fontSize: 9, fontFamily: 'var(--font-mono)', color: 'var(--text-3)', textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: 4 }}>
                Signed in as
              </div>
              <div style={{ fontSize: 11, fontFamily: 'var(--font-mono)', color: 'var(--text-1)', wordBreak: 'break-all' }}>
                {user.email}
              </div>
            </div>

            {/* Admin */}
            {isAdmin && (
              <Link
                href="/admin/users"
                onClick={() => setOpen(false)}
                style={menuItemStyle}
                onMouseEnter={e => { (e.currentTarget as HTMLAnchorElement).style.background = 'var(--bg-3)'; (e.currentTarget as HTMLAnchorElement).style.color = 'var(--text-0)' }}
                onMouseLeave={e => { (e.currentTarget as HTMLAnchorElement).style.background = 'none'; (e.currentTarget as HTMLAnchorElement).style.color = 'var(--text-2)' }}
              >
                <span style={{ fontSize: 13, lineHeight: 1 }}>◈</span>
                ADMIN Tools
              </Link>
            )}

            {/* What's New */}
            <button
              onClick={openWhatsNew}
              style={menuItemStyle}
              onMouseEnter={e => { (e.currentTarget as HTMLButtonElement).style.background = 'var(--bg-3)'; (e.currentTarget as HTMLButtonElement).style.color = 'var(--text-0)' }}
              onMouseLeave={e => { (e.currentTarget as HTMLButtonElement).style.background = 'none'; (e.currentTarget as HTMLButtonElement).style.color = 'var(--text-2)' }}
            >
              <span style={{ fontSize: 13, lineHeight: 1 }}>✦</span>
              What&apos;s New
              {hasUnseen && (
                <span style={{ marginLeft: 'auto', width: 7, height: 7, borderRadius: '50%', background: 'var(--action, #3b82f6)' }} />
              )}
            </button>

            {/* Profile */}
            <button
              onClick={openProfileModal}
              style={{ ...menuItemStyle, borderBottom: '1px solid var(--line-2)' }}
              onMouseEnter={e => { (e.currentTarget as HTMLButtonElement).style.background = 'var(--bg-3)'; (e.currentTarget as HTMLButtonElement).style.color = 'var(--text-0)' }}
              onMouseLeave={e => { (e.currentTarget as HTMLButtonElement).style.background = 'none'; (e.currentTarget as HTMLButtonElement).style.color = 'var(--text-2)' }}
            >
              <span style={{ fontSize: 13, lineHeight: 1 }}>⊙</span>
              Profile
            </button>

            {/* Sign out */}
            <button
              onClick={handleSignOut}
              style={{ ...menuItemStyle, borderBottom: 'none' }}
              onMouseEnter={e => { (e.currentTarget as HTMLButtonElement).style.background = 'color-mix(in oklch, var(--state-error) 10%, var(--bg-3))'; (e.currentTarget as HTMLButtonElement).style.color = 'var(--state-error)' }}
              onMouseLeave={e => { (e.currentTarget as HTMLButtonElement).style.background = 'none'; (e.currentTarget as HTMLButtonElement).style.color = 'var(--text-2)' }}
            >
              <span style={{ fontSize: 13, lineHeight: 1 }}>→</span>
              Sign out
            </button>
          </div>
        )}
      </div>

      {/* Profile modal */}
      {profileModal && (
        <div
          onClick={() => setProfileModal(false)}
          style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)', zIndex: 300, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24 }}
        >
          <div
            onClick={e => e.stopPropagation()}
            style={{ width: '100%', maxWidth: 360, background: 'var(--bg-2)', border: '1px solid var(--line-2)', borderRadius: 10, overflow: 'hidden', boxShadow: '0 16px 48px rgba(0,0,0,0.6)' }}
          >
            <div style={{ padding: '14px 18px', borderBottom: '1px solid var(--line-2)', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-0)' }}>Profile</span>
              <button onClick={() => setProfileModal(false)} style={{ background: 'none', border: 'none', color: 'var(--text-3)', fontSize: 16, cursor: 'pointer', lineHeight: 1 }}>×</button>
            </div>

            <form onSubmit={handleProfileSave} style={{ padding: 18, display: 'flex', flexDirection: 'column', gap: 12 }}>
              {pwSuccess ? (
                <div style={{ fontSize: 12, fontFamily: 'monospace', color: 'var(--state-success)', padding: '10px', textAlign: 'center' }}>
                  ✓ Profile updated
                </div>
              ) : (
                <>
                  <div>
                    <label style={labelStyle}>Display name</label>
                    <input type="text" value={profileName} onChange={e => setProfileName(e.target.value)} autoFocus style={inputStyle} />
                  </div>
                  <div>
                    <label style={labelStyle}>New password <span style={{ opacity: 0.5, textTransform: 'none', letterSpacing: 0 }}>(optional)</span></label>
                    <input type="password" value={pw} onChange={e => setPw(e.target.value)} style={inputStyle} />
                  </div>
                  {pw && (
                    <div>
                      <label style={labelStyle}>Confirm password</label>
                      <input type="password" value={pwConfirm} onChange={e => setPwConfirm(e.target.value)} style={inputStyle} />
                    </div>
                  )}
                  {pwError && (
                    <div style={{ fontSize: 11, fontFamily: 'monospace', color: 'var(--state-error)', background: 'color-mix(in oklch, var(--state-error) 10%, var(--bg-1))', padding: '8px 10px', borderRadius: 6 }}>
                      {pwError}
                    </div>
                  )}
                  <button type="submit" disabled={pwSaving} style={{ padding: '8px 0', borderRadius: 6, border: 'none', background: 'var(--bg-3)', color: 'var(--text-0)', fontSize: 12, fontFamily: 'monospace', fontWeight: 600, cursor: pwSaving ? 'not-allowed' : 'pointer' }}>
                    {pwSaving ? 'Saving...' : 'Save'}
                  </button>
                </>
              )}
            </form>
          </div>
        </div>
      )}

      {/* What's New panel */}
      {whatsNewOpen && (
        <div
          onClick={() => setWhatsNew(false)}
          style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)', zIndex: 300, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24 }}
        >
          <div
            onClick={e => e.stopPropagation()}
            style={{ width: '100%', maxWidth: 680, height: '88vh', maxHeight: '88vh', display: 'flex', flexDirection: 'column', background: 'var(--bg-2)', border: '1px solid var(--line-2)', borderRadius: 10, overflow: 'hidden', boxShadow: '0 16px 48px rgba(0,0,0,0.6)' }}
          >
            <div style={{ padding: '14px 18px', borderBottom: '1px solid var(--line-2)', display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexShrink: 0 }}>
              <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-0)', display: 'flex', alignItems: 'center', gap: 8 }}>
                <span style={{ color: 'var(--action, #3b82f6)' }}>✦</span> What&apos;s New
              </span>
              <button onClick={() => setWhatsNew(false)} style={{ background: 'none', border: 'none', color: 'var(--text-3)', fontSize: 16, cursor: 'pointer', lineHeight: 1 }}>×</button>
            </div>

            <div style={{ overflow: 'auto', padding: 18 }}>
              {changelog.length === 0 ? (
                <div style={{ fontSize: 12, fontFamily: 'monospace', color: 'var(--text-3)', textAlign: 'center', padding: '24px 0' }}>
                  Nothing here yet — check back soon.
                </div>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
                  {changelog.map(entry => {
                    const meta = CHANGELOG_TYPE_META[entry.type]
                    const date = entry.released_at ? new Date(entry.released_at).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' }) : ''
                    return (
                      <div key={entry.id}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
                          <span style={{ fontSize: 9, fontFamily: 'monospace', fontWeight: 700, color: meta.color, border: `1px solid ${meta.color}`, borderRadius: 4, padding: '2px 6px', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                            {meta.label}
                          </span>
                          <span style={{ fontSize: 10, fontFamily: 'monospace', color: 'var(--text-3)' }}>{entry.version}</span>
                          <span style={{ flex: 1 }} />
                          {date && <span style={{ fontSize: 10, fontFamily: 'monospace', color: 'var(--text-4, #888)' }}>{date}</span>}
                        </div>
                        <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-0)', marginBottom: 5 }}>{entry.title}</div>
                        {entry.items?.length > 0 && (
                          <ul style={{ margin: 0, paddingLeft: 18, fontSize: 12, color: 'var(--text-2)', lineHeight: 1.6 }}>
                            {entry.items.map((it, i) => <li key={i}>{it}</li>)}
                          </ul>
                        )}
                      </div>
                    )
                  })}

                  {hasMore && (
                    <button
                      onClick={loadOlder}
                      disabled={loadingMore}
                      style={{
                        marginTop: 4, padding: '8px 0', borderRadius: 6,
                        border: '1px solid var(--line-2)', background: 'var(--bg-1)',
                        color: 'var(--text-2)', fontSize: 11, fontFamily: 'monospace',
                        cursor: loadingMore ? 'default' : 'pointer', opacity: loadingMore ? 0.5 : 1,
                      }}
                    >
                      {loadingMore ? 'Loading…' : 'Load older entries'}
                    </button>
                  )}
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </>
  )
}
