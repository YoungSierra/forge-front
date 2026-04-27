'use client'

import { useEffect, useState } from 'react'
import { getAdminUsers, createAdminUser, updateAdminUser } from '@/lib/api'
import type { AdminUser } from '@/lib/types'
import { formatDateTime } from '@/lib/utils'

const ROLE_COLOR: Record<string, string> = {
  admin:  'var(--cat-code)',
  member: 'var(--text-3)',
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

export default function UsersAdminPage() {
  const [users, setUsers]       = useState<AdminUser[]>([])
  const [loading, setLoading]   = useState(true)
  const [selected, setSelected] = useState<AdminUser | null>(null)

  // create fields
  const [email, setEmail]           = useState('')
  const [password, setPassword]     = useState('')
  const [createName, setCreateName] = useState('')
  const [createRole, setCreateRole] = useState<'member' | 'admin'>('member')

  // edit fields
  const [editName, setEditName] = useState('')
  const [editRole, setEditRole] = useState<'member' | 'admin'>('member')

  const [saving, setSaving] = useState(false)
  const [error, setError]   = useState('')

  useEffect(() => {
    getAdminUsers().then(setUsers).finally(() => setLoading(false))
  }, [])

  function selectUser(u: AdminUser) {
    setSelected(u)
    setEditName(u.display_name || '')
    setEditRole((u.role as 'member' | 'admin') || 'member')
    setError('')
  }

  function deselect() {
    setSelected(null)
    setError('')
  }

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault()
    setSaving(true)
    setError('')
    try {
      const user = await createAdminUser({ email, password, display_name: createName, role: createRole })
      setUsers(prev => [user, ...prev])
      setEmail(''); setPassword(''); setCreateName(''); setCreateRole('member')
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Unknown error')
    } finally {
      setSaving(false)
    }
  }

  async function handleUpdate(e: React.FormEvent) {
    e.preventDefault()
    if (!selected) return
    setSaving(true)
    setError('')
    try {
      const updated = await updateAdminUser(selected.auth_id, { display_name: editName, role: editRole })
      setUsers(prev => prev.map(u => u.auth_id === selected.auth_id ? { ...u, ...updated } : u))
      setSelected(prev => prev ? { ...prev, ...updated } : null)
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Unknown error')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div style={{ height: '100%', display: 'flex', overflow: 'hidden' }}>

      {/* Left panel — create or edit */}
      <div style={{ width: 280, borderRight: '1px solid var(--line-2)', display: 'flex', flexDirection: 'column', flexShrink: 0 }}>
        <div style={{ padding: '14px 16px', borderBottom: '1px solid var(--line-2)', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-0)' }}>
            {selected ? 'Edit user' : 'New user'}
          </span>
          {selected && (
            <button onClick={deselect} style={{ background: 'none', border: 'none', color: 'var(--text-3)', fontSize: 11, fontFamily: 'monospace', cursor: 'pointer' }}>
              + New
            </button>
          )}
        </div>

        <div style={{ flex: 1, overflowY: 'auto', padding: 16 }}>
          {selected ? (
            /* Edit form */
            <form onSubmit={handleUpdate} style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              <div style={{ fontSize: 10, fontFamily: 'monospace', color: 'var(--text-3)', padding: '6px 8px', background: 'var(--bg-2)', borderRadius: 5, wordBreak: 'break-all' }}>
                {selected.email}
              </div>

              <div>
                <label style={labelStyle}>Display name</label>
                <input type="text" value={editName} onChange={e => setEditName(e.target.value)} required style={inputStyle} />
              </div>

              <div>
                <label style={labelStyle}>Role</label>
                <div style={{ display: 'flex', gap: 6 }}>
                  {(['member', 'admin'] as const).map(r => (
                    <button key={r} type="button" onClick={() => setEditRole(r)} style={{
                      flex: 1, padding: '6px 0', borderRadius: 5,
                      border: `1px solid ${editRole === r ? 'var(--text-2)' : 'var(--line-2)'}`,
                      background: editRole === r ? 'var(--bg-3)' : 'transparent',
                      color: editRole === r ? (r === 'admin' ? 'var(--cat-code)' : 'var(--text-0)') : 'var(--text-3)',
                      fontSize: 11, fontFamily: 'monospace', cursor: 'pointer',
                    }}>{r}</button>
                  ))}
                </div>
              </div>

              {error && <div style={{ fontSize: 11, fontFamily: 'monospace', color: 'var(--cat-output)', background: 'color-mix(in srgb, var(--cat-output) 10%, var(--bg-1))', padding: '8px 10px', borderRadius: 6 }}>{error}</div>}

              <button type="submit" disabled={saving} style={{ padding: '8px 0', borderRadius: 6, border: 'none', background: 'var(--bg-3)', color: 'var(--text-0)', fontSize: 12, fontFamily: 'monospace', fontWeight: 600, cursor: saving ? 'not-allowed' : 'pointer' }}>
                {saving ? 'Saving...' : 'Save changes'}
              </button>
            </form>
          ) : (
            /* Create form */
            <form onSubmit={handleCreate} style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              {([
                { label: 'Display name', value: createName, set: setCreateName, type: 'text' },
                { label: 'Email',        value: email,       set: setEmail,       type: 'email' },
                { label: 'Password',     value: password,    set: setPassword,    type: 'password' },
              ] as { label: string; value: string; set: (v: string) => void; type: string }[]).map(({ label, value, set, type }) => (
                <div key={label}>
                  <label style={labelStyle}>{label}</label>
                  <input type={type} value={value} onChange={e => set(e.target.value)} required style={inputStyle} />
                </div>
              ))}

              <div>
                <label style={labelStyle}>Role</label>
                <div style={{ display: 'flex', gap: 6 }}>
                  {(['member', 'admin'] as const).map(r => (
                    <button key={r} type="button" onClick={() => setCreateRole(r)} style={{
                      flex: 1, padding: '6px 0', borderRadius: 5,
                      border: `1px solid ${createRole === r ? 'var(--text-2)' : 'var(--line-2)'}`,
                      background: createRole === r ? 'var(--bg-3)' : 'transparent',
                      color: createRole === r ? (r === 'admin' ? 'var(--cat-code)' : 'var(--text-0)') : 'var(--text-3)',
                      fontSize: 11, fontFamily: 'monospace', cursor: 'pointer',
                    }}>{r}</button>
                  ))}
                </div>
              </div>

              {error && <div style={{ fontSize: 11, fontFamily: 'monospace', color: 'var(--cat-output)', background: 'color-mix(in srgb, var(--cat-output) 10%, var(--bg-1))', padding: '8px 10px', borderRadius: 6 }}>{error}</div>}

              <button type="submit" disabled={saving} style={{ padding: '8px 0', borderRadius: 6, border: 'none', background: 'var(--cat-code)', color: '#0a0a0c', fontSize: 12, fontFamily: 'monospace', fontWeight: 600, cursor: saving ? 'not-allowed' : 'pointer' }}>
                {saving ? 'Creating...' : 'Create user'}
              </button>
            </form>
          )}
        </div>
      </div>

      {/* Right panel — users list */}
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
        <div style={{ padding: '14px 20px', borderBottom: '1px solid var(--line-2)', flexShrink: 0 }}>
          <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-0)' }}>Users</span>
          <span style={{ fontSize: 10, fontFamily: 'monospace', color: 'var(--text-3)', marginLeft: 10 }}>{users.length} total</span>
        </div>

        <div style={{ flex: 1, overflowY: 'auto' }}>
          {loading ? (
            <div style={{ padding: 24, fontSize: 11, fontFamily: 'monospace', color: 'var(--text-3)' }}>Loading...</div>
          ) : (
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
              <thead>
                <tr style={{ borderBottom: '1px solid var(--line-2)' }}>
                  {['Name', 'Email', 'Role', 'Created', 'Last sign in'].map(h => (
                    <th key={h} style={{ padding: '8px 16px', textAlign: 'left', fontSize: 10, fontFamily: 'monospace', color: 'var(--text-3)', fontWeight: 600, letterSpacing: '0.06em', textTransform: 'uppercase' }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {users.map(u => (
                  <tr
                    key={u.auth_id}
                    onClick={() => selectUser(u)}
                    style={{ borderBottom: '1px solid var(--line-2)', cursor: 'pointer', background: selected?.auth_id === u.auth_id ? 'var(--bg-2)' : 'transparent' }}
                    onMouseEnter={e => { if (selected?.auth_id !== u.auth_id) (e.currentTarget as HTMLTableRowElement).style.background = 'var(--bg-2)' }}
                    onMouseLeave={e => { if (selected?.auth_id !== u.auth_id) (e.currentTarget as HTMLTableRowElement).style.background = 'transparent' }}
                  >
                    <td style={{ padding: '10px 16px', color: 'var(--text-0)' }}>{u.display_name || '—'}</td>
                    <td style={{ padding: '10px 16px', fontFamily: 'monospace', fontSize: 11, color: 'var(--text-2)' }}>{u.email}</td>
                    <td style={{ padding: '10px 16px' }}>
                      <span style={{ fontSize: 10, fontFamily: 'monospace', color: ROLE_COLOR[u.role || 'member'], background: 'var(--bg-3)', padding: '2px 8px', borderRadius: 99 }}>
                        {u.role || 'member'}
                      </span>
                    </td>
                    <td style={{ padding: '10px 16px', fontFamily: 'monospace', fontSize: 11, color: 'var(--text-3)' }}>{u.created_at ? formatDateTime(u.created_at) : '—'}</td>
                    <td style={{ padding: '10px 16px', fontFamily: 'monospace', fontSize: 11, color: 'var(--text-3)' }}>{u.last_sign_in ? formatDateTime(u.last_sign_in) : '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </div>
  )
}
