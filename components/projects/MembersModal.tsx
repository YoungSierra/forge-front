'use client'

import { useEffect, useState } from 'react'
import type { ProjectMember, Member } from '@/lib/types'
import { getProjectMembers, searchMembers, addProjectMember, removeProjectMember } from '@/lib/api'
import { isPlatformAdmin } from '@/lib/roles'

const DISC_COLOR: Record<string, string> = {
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
  const [allMembers, setAllMembers]   = useState<Member[]>([])
  const [loading, setLoading]         = useState(true)
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
  const [adding, setAdding]           = useState(false)
  const [error, setError]             = useState<string | null>(null)
  const [filterQ, setFilterQ]         = useState('')

  const isOwner   = currentMemberId === ownerMemberId
  const isAdmin   = members.some(m => m.members.id === currentMemberId && isPlatformAdmin(m.members.role))
  const canManage = isOwner || isAdmin

  useEffect(() => {
    Promise.all([
      getProjectMembers(projectId),
      searchMembers(''),
    ]).then(([pm, all]) => {
      setMembers(pm)
      setAllMembers(all)
    }).finally(() => setLoading(false))
  }, [projectId])

  // Miembros que todavía no están en el proyecto
  const existingIds  = new Set(members.map(m => m.members.id))
  const q            = filterQ.toLowerCase()
  const available    = allMembers
    .filter(m => !existingIds.has(m.id))
    .filter(m => !q || m.display_name.toLowerCase().includes(q))

  async function handleAdd() {
    if (selectedIds.size === 0) return
    setAdding(true)
    setError(null)
    try {
      const results = await Promise.all(
        [...selectedIds].map(id => addProjectMember(projectId, id))
      )
      setMembers(prev => [...prev, ...results])
      setSelectedIds(new Set())
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

  function toggleMember(id: string) {
    setSelectedIds(prev => {
      const next = new Set(prev)
      next.has(id) ? next.delete(id) : next.add(id)
      return next
    })
  }

  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'rgba(0,0,0,0.6)', backdropFilter: 'blur(4px)' }}>
      <div style={{ background: 'var(--bg-1)', border: '1px solid var(--line-2)', borderRadius: 12, width: '100%', maxWidth: 520, maxHeight: '82vh', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>

        {/* Header */}
        <div style={{ padding: '16px 20px', borderBottom: '1px solid var(--line-2)', display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexShrink: 0 }}>
          <div>
            <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-0)' }}>Team Members</div>
            <div style={{ fontSize: 11, color: 'var(--text-3)', fontFamily: 'monospace', marginTop: 2 }}>{projectName}</div>
          </div>
          <button onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-3)', fontSize: 18, lineHeight: 1, padding: 4 }}>✕</button>
        </div>

        <div style={{ flex: 1, overflowY: 'auto', display: 'flex', flexDirection: 'column', minHeight: 0 }}>

          {/* Miembros actuales del proyecto */}
          <div style={{ padding: '14px 20px 0' }}>
            <div style={{ fontSize: 10, fontFamily: 'monospace', color: 'var(--text-3)', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 8 }}>
              Members {!loading && `(${members.length})`}
            </div>
            {loading ? (
              <div style={{ fontSize: 11, color: 'var(--text-3)', fontFamily: 'monospace', paddingBottom: 12 }}>Loading...</div>
            ) : members.length === 0 ? (
              <div style={{ fontSize: 11, color: 'var(--text-3)', fontFamily: 'monospace', paddingBottom: 12 }}>No members yet</div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6, maxHeight: 200, overflowY: 'auto', paddingBottom: 14 }}>
                {members.map(pm => (
                  <div key={pm.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 10px', background: 'var(--bg-2)', borderRadius: 8, border: '1px solid var(--line-2)', flexShrink: 0 }}>
                    <Avatar member={pm.members} />
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-0)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {pm.members.display_name}
                      </div>
                      <div style={{ display: 'flex', gap: 4, marginTop: 3 }}>
                        {pm.discipline && (
                          <span style={{ fontSize: 9, fontFamily: 'monospace', color: DISC_COLOR[pm.discipline] ?? 'var(--text-3)', background: `color-mix(in srgb, ${DISC_COLOR[pm.discipline] ?? 'var(--text-3)'} 12%, transparent)`, padding: '1px 6px', borderRadius: 99 }}>
                            {pm.discipline}
                          </span>
                        )}
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
                    {canManage && pm.members.id !== ownerMemberId && pm.members.id !== currentMemberId && (
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

          {/* Panel de selección — solo si puede gestionar */}
          {canManage && !loading && (
            <div style={{ borderTop: '1px solid var(--line-2)', padding: '14px 20px', display: 'flex', flexDirection: 'column', gap: 10, flex: 1, minHeight: 0 }}>
              <div style={{ fontSize: 10, fontFamily: 'monospace', color: 'var(--text-3)', textTransform: 'uppercase', letterSpacing: '0.08em' }}>
                Add Member
              </div>

              {/* Filtro rápido */}
              <input
                value={filterQ}
                onChange={e => setFilterQ(e.target.value)}
                placeholder="Filter members..."
                style={{ background: 'var(--bg-2)', border: '1px solid var(--line-2)', borderRadius: 6, padding: '7px 10px', fontSize: 12, color: 'var(--text-0)', outline: 'none', flexShrink: 0 }}
              />

              {/* Lista scrolleable de todos los miembros disponibles */}
              <div style={{ flex: 1, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 4, minHeight: 120, maxHeight: 260 }}>
                {available.length === 0 ? (
                  <div style={{ fontSize: 11, color: 'var(--text-3)', fontFamily: 'monospace', padding: '12px 0', textAlign: 'center' }}>
                    {filterQ ? 'No members match the filter' : 'All members are already in this project'}
                  </div>
                ) : available.map(m => {
                  const isSelected = selectedIds.has(m.id)
                  return (
                    <div
                      key={m.id}
                      onClick={() => toggleMember(m.id)}
                      style={{
                        display: 'flex', alignItems: 'center', gap: 10,
                        padding: '8px 10px', borderRadius: 8, cursor: 'pointer',
                        border: `1px solid ${isSelected ? 'var(--action)' : 'var(--line-2)'}`,
                        background: isSelected ? 'color-mix(in srgb, var(--action) 10%, var(--bg-2))' : 'var(--bg-2)',
                        transition: 'border-color 120ms, background 120ms',
                        flexShrink: 0,
                      }}
                    >
                      {/* Checkbox visual */}
                      <div style={{
                        width: 16, height: 16, borderRadius: 4, flexShrink: 0,
                        border: `1.5px solid ${isSelected ? 'var(--action)' : 'var(--line-1)'}`,
                        background: isSelected ? 'var(--action)' : 'transparent',
                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                        transition: 'all 120ms',
                        fontSize: 10, color: '#fff',
                      }}>
                        {isSelected && '✓'}
                      </div>
                      <Avatar member={m} />
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-0)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                          {m.display_name}
                        </div>
                        {m.role && (
                          <div style={{ fontSize: 10, fontFamily: 'monospace', color: 'var(--text-3)', marginTop: 2 }}>{m.role}</div>
                        )}
                      </div>
                    </div>
                  )
                })}
              </div>

              {/* Botón de añadir */}
              <button
                onClick={handleAdd}
                disabled={selectedIds.size === 0 || adding}
                style={{
                  padding: '9px', borderRadius: 6, border: 'none', flexShrink: 0,
                  cursor: selectedIds.size > 0 ? 'pointer' : 'not-allowed',
                  background: selectedIds.size > 0 ? 'var(--action)' : 'var(--bg-4)',
                  color: selectedIds.size > 0 ? 'var(--action-fg)' : 'var(--text-3)',
                  fontSize: 12, fontWeight: 600, transition: 'all 120ms',
                }}
              >
                {adding
                  ? 'Adding...'
                  : selectedIds.size > 0
                    ? `+ Add ${selectedIds.size} member${selectedIds.size > 1 ? 's' : ''}`
                    : '+ Add Members'}
              </button>
            </div>
          )}

          {error && (
            <div style={{ margin: '0 20px 14px', fontSize: 11, color: 'var(--cat-output)', fontFamily: 'monospace', background: 'color-mix(in srgb, var(--cat-output) 10%, transparent)', padding: '6px 10px', borderRadius: 6 }}>
              {error}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
