'use client'

import { useState, useEffect, useRef } from 'react'
import { createProject, searchMembers, addProjectMember } from '@/lib/api'
import type { Project, Member, Discipline } from '@/lib/types'

type StagedMember = { member: Member; discipline: Discipline; role: string }

const DISCIPLINES: Discipline[] = ['design', 'art', 'vfx', 'code', 'audio', 'infra']
const ROLES = ['reviewer', 'editor', 'lead']

export interface NewProjectModalProps {
  open:             boolean
  projectId?:       string | null
  projectName?:     string
  initialIdea?:     string
  initialParams?:   Record<string, string | string[]>
  memberId?:        string | null
  onProjectCreated: (project: Project) => void
  onClose:          () => void
}

export default function NewProjectModal({
  open, memberId, onProjectCreated, onClose,
}: NewProjectModalProps) {
  const [nameInput,       setNameInput]       = useState('')
  const [loading,         setLoading]         = useState(false)
  const [error,           setError]           = useState('')

  // Equipo
  const [stagedMembers,   setStagedMembers]   = useState<StagedMember[]>([])
  const [memberSearch,    setMemberSearch]    = useState('')
  const [memberResults,   setMemberResults]   = useState<Member[]>([])
  const [memberSearching, setMemberSearching] = useState(false)
  const [selectedMember,  setSelectedMember]  = useState<Member | null>(null)
  const [memberDisc,      setMemberDisc]      = useState<Discipline>('design')
  const [memberRole,      setMemberRole]      = useState('reviewer')
  const searchTimeout = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Reset al abrir
  useEffect(() => {
    if (!open) return
    setNameInput('')
    setError('')
    setStagedMembers([])
    setMemberSearch('')
    setMemberResults([])
    setSelectedMember(null)
    setMemberDisc('design')
    setMemberRole('reviewer')
  }, [open])

  // Búsqueda de miembros con debounce
  useEffect(() => {
    if (!memberSearch.trim()) { setMemberResults([]); return }
    if (searchTimeout.current) clearTimeout(searchTimeout.current)
    searchTimeout.current = setTimeout(async () => {
      setMemberSearching(true)
      try {
        const results = await searchMembers(memberSearch)
        const existingIds = new Set(stagedMembers.map(s => s.member.id))
        setMemberResults(results.filter(r => !existingIds.has(r.id)))
      } finally {
        setMemberSearching(false)
      }
    }, 300)
  }, [memberSearch, stagedMembers])

  function selectMember(m: Member) {
    setSelectedMember(m)
    setMemberSearch(m.display_name)
    setMemberResults([])
  }

  function addMember() {
    if (!selectedMember) return
    setStagedMembers(prev => [...prev, { member: selectedMember!, discipline: memberDisc, role: memberRole }])
    setSelectedMember(null)
    setMemberSearch('')
    setMemberResults([])
  }

  function removeMember(idx: number) {
    setStagedMembers(prev => prev.filter((_, i) => i !== idx))
  }

  async function handleCreate() {
    if (!nameInput.trim() || loading) return
    setLoading(true)
    setError('')
    try {
      const res = await createProject(nameInput.trim(), memberId ?? undefined)
      const pid = res.project_id
      if (stagedMembers.length) {
        await Promise.allSettled(
          stagedMembers.map(s => addProjectMember(pid, s.member.id, s.role, s.discipline))
        )
      }
      onProjectCreated(res.project)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to create project')
      setLoading(false)
    }
  }

  if (!open) return null

  return (
    <>
      {/* Overlay */}
      <div
        style={{ position: 'fixed', inset: 0, zIndex: 1000, background: 'rgba(0,0,0,0.72)', backdropFilter: 'blur(4px)' }}
      />

      {/* Wrapper externo — overflow visible para que el mascot sobresalga */}
      <div style={{
        position: 'fixed', top: '50%', left: '50%',
        transform: 'translate(-50%,-50%)',
        zIndex: 1001, width: 480, maxWidth: 'calc(100vw - 32px)',
      }}>

        {/* Mascot — superpuesto sobre la esquina top-left del card */}
        <img
          src="/forgy/forgyigleasses.png"
          alt="Forge"
          style={{
            position: 'absolute',
            top: -54, left: -22,
            width: 120, height: 120,
            objectFit: 'contain',
            zIndex: 2,
            filter: 'drop-shadow(0 4px 16px rgba(255,138,61,0.28))',
            pointerEvents: 'none',
          }}
        />

        {/* Modal card */}
        <div className="modal-card" style={{
          borderRadius: 8,
          boxShadow: '0 18px 42px rgba(0,0,0,0.6), 0 0 0 1px var(--line-2)',
          overflow: 'hidden',
          position: 'relative',
          fontFamily: 'var(--font-sans)',
        }}>

          {/* Botón cerrar */}
          <button
            onClick={loading ? undefined : onClose}
            disabled={loading}
            style={{
              position: 'absolute', top: 14, right: 14,
              border: 'none', background: 'var(--bg-2)',
              cursor: loading ? 'not-allowed' : 'pointer',
              color: 'var(--text-2)', fontSize: 14,
              padding: '5px 9px', borderRadius: 6,
              opacity: loading ? 0.4 : 1, lineHeight: 1,
            }}
          >
            ✕
          </button>

          {/* Header — texto al lado del mascot como bocadillo */}
          <div style={{
            padding: '14px 24px 16px',
            borderBottom: '1px solid var(--line-2)',
            display: 'flex', alignItems: 'center', minHeight: 72,
          }}>
            {/* Espaciador para el área que ocupa el mascot */}
            <div style={{ width: 62, flexShrink: 0 }} />
            <div>
              <div style={{ fontSize: 17, fontWeight: 700, color: 'var(--text-0)', lineHeight: 1.25, marginBottom: 4 }}>
                We create a new project!
              </div>
              <div style={{ fontSize: 12, color: 'var(--text-3)', lineHeight: 1.5 }}>
                Describe your project and your team members.
              </div>
            </div>
          </div>

        {/* Body */}
        <div style={{ padding: '20px 24px', display: 'flex', flexDirection: 'column', gap: 18 }}>

          {/* Nombre del proyecto */}
          <div>
            <label style={{ fontSize: 12, fontFamily: 'var(--font-mono)', color: 'var(--text-3)', display: 'block', marginBottom: 6 }}>
              Project name
            </label>
            <input
              value={nameInput}
              onChange={e => setNameInput(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && !loading && handleCreate()}
              placeholder="My awesome game…"
              autoFocus
              disabled={loading}
              style={{
                width: '100%', boxSizing: 'border-box',
                background: 'var(--bg-2)', border: '1px solid var(--line-2)',
                borderRadius: 8, padding: '10px 12px',
                fontSize: 13, color: 'var(--text-0)', outline: 'none', fontFamily: 'var(--font-sans)',
                opacity: loading ? 0.6 : 1,
              }}
            />
          </div>

          {/* Team members */}
          <div>
            <label style={{ fontSize: 12, fontFamily: 'var(--font-mono)', color: 'var(--text-3)', display: 'block', marginBottom: 6 }}>
              Team members <span style={{ color: 'var(--text-4)' }}>(optional)</span>
            </label>

            {/* Campo de búsqueda */}
            <div style={{ position: 'relative', marginBottom: 8 }}>
              <input
                value={memberSearch}
                onChange={e => { setMemberSearch(e.target.value); setSelectedMember(null) }}
                placeholder="Search by name or email…"
                disabled={loading}
                style={{
                  width: '100%', boxSizing: 'border-box',
                  background: 'var(--bg-2)', border: '1px solid var(--line-2)',
                  borderRadius: 8, padding: '9px 12px',
                  fontSize: 12, color: 'var(--text-0)', outline: 'none', fontFamily: 'var(--font-sans)',
                  opacity: loading ? 0.6 : 1,
                }}
              />
              {memberSearching && (
                <span style={{ position: 'absolute', right: 10, top: '50%', transform: 'translateY(-50%)', fontSize: 10, fontFamily: 'var(--font-mono)', color: 'var(--text-3)' }}>
                  …
                </span>
              )}
            </div>

            {/* Resultados de búsqueda */}
            {memberResults.length > 0 && (
              <div style={{ background: 'var(--bg-2)', border: '1px solid var(--line-2)', borderRadius: 8, overflow: 'hidden', marginBottom: 8 }}>
                {memberResults.slice(0, 5).map(m => (
                  <button
                    key={m.id}
                    onClick={() => selectMember(m)}
                    style={{
                      width: '100%', textAlign: 'left', padding: '8px 12px', border: 'none',
                      borderBottom: '1px solid var(--line-2)',
                      background: selectedMember?.id === m.id ? 'var(--bg-3)' : 'transparent',
                      cursor: 'pointer', display: 'flex', flexDirection: 'column', gap: 1,
                    }}
                  >
                    <span style={{ fontSize: 12, color: 'var(--text-0)' }}>{m.display_name}</span>
                  </button>
                ))}
              </div>
            )}

            {/* Selector de disciplina + rol + botón Add — siempre visibles */}
            <div style={{ display: 'flex', gap: 6, alignItems: 'center', marginBottom: 8 }}>
              <select
                value={memberDisc}
                onChange={e => setMemberDisc(e.target.value as Discipline)}
                style={{
                  flex: 1, background: 'var(--bg-2)', border: '1px solid var(--line-2)',
                  borderRadius: 6, padding: '7px 8px',
                  fontSize: 12, fontFamily: 'var(--font-sans)', color: 'var(--text-1)', outline: 'none',
                }}
              >
                {DISCIPLINES.map(d => <option key={d} value={d}>{d}</option>)}
              </select>
              <select
                value={memberRole}
                onChange={e => setMemberRole(e.target.value)}
                style={{
                  flex: 1, background: 'var(--bg-2)', border: '1px solid var(--line-2)',
                  borderRadius: 6, padding: '7px 8px',
                  fontSize: 12, fontFamily: 'var(--font-sans)', color: 'var(--text-1)', outline: 'none',
                }}
              >
                {ROLES.map(r => <option key={r} value={r}>{r}</option>)}
              </select>
              <button
                onClick={addMember}
                disabled={!selectedMember}
                style={{
                  padding: '7px 16px', borderRadius: 6, border: 'none',
                  background: selectedMember ? 'var(--action)' : 'var(--bg-3)',
                  color: selectedMember ? 'var(--action-fg)' : 'var(--text-4)',
                  fontSize: 12, fontFamily: 'var(--font-sans)', fontWeight: 600,
                  cursor: selectedMember ? 'pointer' : 'not-allowed',
                }}
              >
                Add
              </button>
            </div>

            {/* Lista de miembros staged */}
            {stagedMembers.length > 0 && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                {stagedMembers.map((s, i) => (
                  <div key={i} style={{
                    display: 'flex', alignItems: 'center', gap: 8,
                    padding: '7px 10px', borderRadius: 6,
                    background: 'var(--bg-2)', border: '1px solid var(--line-2)',
                  }}>
                    <span style={{ fontSize: 12, color: 'var(--text-0)', flex: 1 }}>{s.member.display_name}</span>
                    <span style={{ fontSize: 9, fontFamily: 'var(--font-mono)', color: 'var(--text-3)', background: 'var(--bg-3)', padding: '2px 7px', borderRadius: 4 }}>
                      {s.discipline}
                    </span>
                    <span style={{ fontSize: 9, fontFamily: 'var(--font-mono)', color: 'var(--text-3)', background: 'var(--bg-3)', padding: '2px 7px', borderRadius: 4 }}>
                      {s.role}
                    </span>
                    <button
                      onClick={() => removeMember(i)}
                      style={{ border: 'none', background: 'none', cursor: 'pointer', color: 'var(--text-3)', fontSize: 14, padding: '0 2px', lineHeight: 1 }}
                    >
                      ×
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Error */}
          {error && (
            <div style={{
              fontSize: 11, color: 'var(--state-error)', fontFamily: 'var(--font-mono)',
              padding: '8px 12px', background: 'rgba(248,113,113,0.08)',
              borderRadius: 6, border: '1px solid rgba(248,113,113,0.2)',
            }}>
              {error}
            </div>
          )}
        </div>

        {/* Footer */}
        <div style={{ padding: '14px 24px', borderTop: '1px solid var(--line-2)', display: 'flex', gap: 8 }}>
          <button
            onClick={loading ? undefined : onClose}
            disabled={loading}
            style={{
              padding: '9px 18px', borderRadius: 8,
              border: '1px solid var(--line-2)', background: 'var(--bg-2)',
              color: 'var(--text-1)', fontSize: 12, fontFamily: 'var(--font-sans)',
              cursor: loading ? 'not-allowed' : 'pointer', opacity: loading ? 0.5 : 1,
            }}
          >
            Cancel
          </button>
          <button
            onClick={handleCreate}
            disabled={loading || !nameInput.trim()}
            style={{
              flex: 1, padding: '9px 18px', borderRadius: 8, border: 'none',
              background: loading || !nameInput.trim() ? 'var(--bg-3)' : 'var(--action)',
              color: loading || !nameInput.trim() ? 'var(--text-3)' : 'var(--action-fg)',
              fontSize: 12, fontFamily: 'var(--font-sans)', fontWeight: 700,
              cursor: loading || !nameInput.trim() ? 'not-allowed' : 'pointer',
              transition: 'background 150ms, color 150ms',
            }}
          >
            {loading ? 'Creating…' : 'Create project →'}
          </button>
        </div>

        </div>{/* modal card */}
      </div>{/* wrapper */}
    </>
  )
}
