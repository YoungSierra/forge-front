'use client'

import { useEffect, useState, useRef } from 'react'
import type { ProjectMember, Member, Discipline } from '@/lib/types'
import { getProjectMembers, searchMembers, addProjectMember, removeProjectMember } from '@/lib/api'

const DISCIPLINES: Discipline[] = ['design', 'art', 'vfx', 'code', 'audio', 'infra']
const ROLES = ['reviewer', 'editor', 'lead']

const DISC_COLOR: Record<Discipline, string> = {
  design: 'var(--cat-design)',
  art:    'var(--cat-asset)',
  vfx:    'var(--cat-level)',
  code:   'var(--cat-code)',
  audio:  'var(--cat-audio)',
  infra:  'var(--cat-output)',
}

function Avatar({ member, size = 32 }: { member: Member; size?: number }) {
  if (member.avatar_url) {
    return <img src={member.avatar_url} alt={member.display_name} style={{ width: size, height: size, borderRadius: '50%', objectFit: 'cover', flexShrink: 0 }} />
  }
  return (
    <div style={{
      width: size, height: size, borderRadius: '50%', flexShrink: 0,
      background: 'var(--bg-4)', display: 'flex', alignItems: 'center', justifyContent: 'center',
      fontSize: size * 0.4, fontWeight: 700, color: 'var(--text-2)',
    }}>
      {member.display_name.charAt(0).toUpperCase()}
    </div>
  )
}

interface Props {
  projectId: string
  projectName: string
  ownerMemberId: string
  currentMemberId: string | null
  onClose: () => void
}

export default function MembersModal({ projectId, projectName, ownerMemberId, currentMemberId, onClose }: Props) {
  const [members, setMembers]         = useState<ProjectMember[]>([])
  const [loading, setLoading]         = useState(true)
  const [searchQ, setSearchQ]         = useState('')
  const [searchResults, setSearchResults] = useState<Member[]>([])
  const [searching, setSearching]     = useState(false)
  const [selectedMember, setSelected] = useState<Member | null>(null)
  const [discipline, setDiscipline]   = useState<Discipline>('design')
  const [role, setRole]               = useState('reviewer')
  const [adding, setAdding]           = useState(false)
  const [error, setError]             = useState<string | null>(null)
  const searchTimeout                 = useRef<ReturnType<typeof setTimeout> | null>(null)
  const isOwner                       = currentMemberId === ownerMemberId

  useEffect(() => {
    getProjectMembers(projectId)
      .then(setMembers)
      .finally(() => setLoading(false))
  }, [projectId])

  useEffect(() => {
    if (!searchQ.trim()) { setSearchResults([]); return }
    if (searchTimeout.current) clearTimeout(searchTimeout.current)
    searchTimeout.current = setTimeout(async () => {
      setSearching(true)
      const results = await searchMembers(searchQ)
      const existingIds = new Set(members.map(m => m.members.id))
      setSearchResults(results.filter(r => !existingIds.has(r.id)))
      setSearching(false)
    }, 300)
  }, [searchQ, members])

  async function handleAdd() {
    if (!selectedMember) return
    setAdding(true)
    setError(null)
    try {
      const newMember = await addProjectMember(projectId, selectedMember.id, role, discipline)
      setMembers(prev => [...prev, newMember])
      setSelected(null)
      setSearchQ('')
      setSearchResults([])
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Error adding member')
    } finally {
      setAdding(false)
    }
  }

  async function handleRemove(memberId: string) {
    try {
      await removeProjectMember(projectId, memberId)
      setMembers(prev => prev.filter(m => m.members.id !== memberId))
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Error removing member')
    }
  }

  return (
    <div
      style={{ position: 'fixed', inset: 0, zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'rgba(0,0,0,0.6)', backdropFilter: 'blur(4px)' }}
      onClick={e => { if (e.target === e.currentTarget) onClose() }}
    >
      <div style={{ background: 'var(--bg-1)', border: '1px solid var(--line-2)', borderRadius: 12, width: '100%', maxWidth: 480, maxHeight: '80vh', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
        {/* Header */}
        <div style={{ padding: '16px 20px', borderBottom: '1px solid var(--line-2)', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div>
            <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-0)' }}>Team Members</div>
            <div style={{ fontSize: 11, color: 'var(--text-3)', fontFamily: 'monospace', marginTop: 2 }}>{projectName}</div>
          </div>
          <button onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-3)', fontSize: 18, lineHeight: 1, padding: 4 }}>✕</button>
        </div>

        <div style={{ flex: 1, overflowY: 'auto', padding: '16px 20px', display: 'flex', flexDirection: 'column', gap: 16 }}>
          {/* Members list */}
          <div>
            <div style={{ fontSize: 10, fontFamily: 'monospace', color: 'var(--text-3)', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 8 }}>
              Members {!loading && `(${members.length})`}
            </div>
            {loading ? (
              <div style={{ fontSize: 11, color: 'var(--text-3)', fontFamily: 'monospace' }}>Loading...</div>
            ) : members.length === 0 ? (
              <div style={{ fontSize: 11, color: 'var(--text-3)', fontFamily: 'monospace' }}>No members yet</div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6, maxHeight: 220, overflowY: 'auto' }}>
                {members.map(pm => (
                  <div key={pm.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 10px', background: 'var(--bg-2)', borderRadius: 8, border: '1px solid var(--line-2)' }}>
                    <Avatar member={pm.members} />
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-0)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {pm.members.display_name}
                      </div>
                      <div style={{ display: 'flex', gap: 4, marginTop: 3 }}>
                        <span style={{ fontSize: 9, fontFamily: 'monospace', color: DISC_COLOR[pm.discipline], background: `color-mix(in srgb, ${DISC_COLOR[pm.discipline]} 12%, transparent)`, padding: '1px 6px', borderRadius: 99 }}>
                          {pm.discipline}
                        </span>
                        <span style={{ fontSize: 9, fontFamily: 'monospace', color: 'var(--text-3)', background: 'var(--bg-3)', padding: '1px 6px', borderRadius: 99 }}>
                          {pm.project_role}
                        </span>
                        {pm.members.id === ownerMemberId && (
                          <span style={{ fontSize: 9, fontFamily: 'monospace', color: 'var(--cat-code)', background: 'color-mix(in srgb, var(--cat-code) 12%, transparent)', padding: '1px 6px', borderRadius: 99 }}>
                            owner
                          </span>
                        )}
                      </div>
                    </div>
                    {isOwner && pm.members.id !== ownerMemberId && (
                      <button
                        onClick={() => handleRemove(pm.members.id)}
                        style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-3)', fontSize: 14, padding: 4, borderRadius: 4, lineHeight: 1 }}
                        title="Remove member"
                      >✕</button>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Add member — only owner */}
          {isOwner && (
            <div style={{ borderTop: '1px solid var(--line-2)', paddingTop: 16 }}>
              <div style={{ fontSize: 10, fontFamily: 'monospace', color: 'var(--text-3)', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 8 }}>
                Add Member
              </div>

              {/* Search */}
              <div style={{ position: 'relative', marginBottom: 8 }}>
                <input
                  value={searchQ}
                  onChange={e => { setSearchQ(e.target.value); setSelected(null) }}
                  placeholder="Search by name..."
                  style={{ width: '100%', background: 'var(--bg-2)', border: '1px solid var(--line-2)', borderRadius: 6, padding: '7px 10px', fontSize: 12, color: 'var(--text-0)', outline: 'none', boxSizing: 'border-box' }}
                />
                {searchResults.length > 0 && !selectedMember && (
                  <div style={{ position: 'absolute', top: '100%', left: 0, right: 0, background: 'var(--bg-2)', border: '1px solid var(--line-2)', borderRadius: 6, marginTop: 2, zIndex: 10, overflow: 'hidden' }}>
                    {searchResults.map(m => (
                      <div
                        key={m.id}
                        onClick={() => { setSelected(m); setSearchQ(m.display_name); setSearchResults([]) }}
                        style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 10px', cursor: 'pointer', fontSize: 12, color: 'var(--text-0)' }}
                        onMouseEnter={e => (e.currentTarget.style.background = 'var(--bg-3)')}
                        onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
                      >
                        <Avatar member={m} size={24} />
                        {m.display_name}
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* Discipline + Role */}
              <div style={{ display: 'flex', gap: 8, marginBottom: 8 }}>
                <select
                  value={discipline}
                  onChange={e => setDiscipline(e.target.value as Discipline)}
                  style={{ flex: 1, background: 'var(--bg-2)', border: '1px solid var(--line-2)', borderRadius: 6, padding: '7px 8px', fontSize: 12, color: 'var(--text-0)', outline: 'none' }}
                >
                  {DISCIPLINES.map(d => <option key={d} value={d}>{d}</option>)}
                </select>
                <select
                  value={role}
                  onChange={e => setRole(e.target.value)}
                  style={{ flex: 1, background: 'var(--bg-2)', border: '1px solid var(--line-2)', borderRadius: 6, padding: '7px 8px', fontSize: 12, color: 'var(--text-0)', outline: 'none' }}
                >
                  {ROLES.map(r => <option key={r} value={r}>{r}</option>)}
                </select>
              </div>

              <button
                onClick={handleAdd}
                disabled={!selectedMember || adding}
                style={{ width: '100%', padding: '8px', borderRadius: 6, border: 'none', cursor: selectedMember ? 'pointer' : 'not-allowed', background: selectedMember ? 'var(--cat-code)' : 'var(--bg-4)', color: selectedMember ? '#0a0a0c' : 'var(--text-3)', fontSize: 12, fontWeight: 600, transition: 'all 120ms' }}
              >
                {adding ? 'Adding...' : '+ Add to project'}
              </button>
            </div>
          )}

          {error && (
            <div style={{ fontSize: 11, color: 'var(--cat-output)', fontFamily: 'monospace', background: 'color-mix(in srgb, var(--cat-output) 10%, transparent)', padding: '6px 10px', borderRadius: 6 }}>
              {error}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
