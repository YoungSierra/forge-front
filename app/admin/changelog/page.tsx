'use client'

import { useEffect, useState, useCallback } from 'react'
import {
  getAdminChangelog, createChangelogEntry, updateChangelogEntry, deleteChangelogEntry,
} from '@/lib/api'
import type { ChangelogEntry, ChangelogType } from '@/lib/types'

const TYPES: ChangelogType[] = ['new_feature', 'improvement', 'bug_fix']

const TYPE_META: Record<ChangelogType, { label: string; color: string }> = {
  new_feature: { label: 'New Feature', color: 'var(--state-success, #22c55e)' },
  improvement: { label: 'Improvement', color: 'var(--action, #3b82f6)' },
  bug_fix:     { label: 'Bug Fix',     color: 'var(--state-error, #ef4444)' },
}

// Estado del formulario de creación / edición
type FormState = { version: string; type: ChangelogType; title: string; itemsText: string }

const EMPTY_FORM: FormState = { version: '', type: 'new_feature', title: '', itemsText: '' }

const inputStyle: React.CSSProperties = {
  width: '100%', background: 'var(--bg-1)', border: '1px solid var(--line-2)',
  borderRadius: 6, padding: '7px 10px', fontSize: 12, color: 'var(--text-0)',
  outline: 'none', boxSizing: 'border-box', fontFamily: 'var(--font-mono, monospace)',
}

const labelStyle: React.CSSProperties = {
  fontSize: 10, fontFamily: 'monospace', color: 'var(--text-3)',
  textTransform: 'uppercase', letterSpacing: '0.08em', display: 'block', marginBottom: 5,
}

const btnStyle: React.CSSProperties = {
  padding: '7px 14px', borderRadius: 6, border: '1px solid var(--line-2)',
  background: 'var(--bg-3)', color: 'var(--text-0)', fontSize: 11,
  fontFamily: 'monospace', fontWeight: 600, cursor: 'pointer',
}

// Convierte el textarea de bullets (una línea por ítem) en array y viceversa
const itemsFromText = (t: string) => t.split('\n').map(l => l.trim()).filter(Boolean)
const textFromItems = (items: string[]) => (items || []).join('\n')

export default function ChangelogPage() {
  const [entries, setEntries] = useState<ChangelogEntry[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError]     = useState<string | null>(null)

  // Form de creación
  const [form, setForm]       = useState<FormState>(EMPTY_FORM)
  const [creating, setCreating] = useState(false)

  // Edición inline
  const [editId, setEditId]     = useState<string | null>(null)
  const [editForm, setEditForm] = useState<FormState>(EMPTY_FORM)
  const [busyId, setBusyId]     = useState<string | null>(null)

  const load = useCallback(() => {
    setLoading(true)
    getAdminChangelog()
      .then(setEntries)
      .catch(e => setError(e.message))
      .finally(() => setLoading(false))
  }, [])

  useEffect(() => { load() }, [load])

  async function handleCreate() {
    if (!form.version.trim() || !form.title.trim()) { setError('Version and title are required'); return }
    setCreating(true); setError(null)
    try {
      await createChangelogEntry({
        version: form.version.trim(), type: form.type, title: form.title.trim(),
        items: itemsFromText(form.itemsText), source: 'manual',
      })
      setForm(EMPTY_FORM)
      load()
    } catch (e) { setError(e instanceof Error ? e.message : 'Create failed') }
    finally { setCreating(false) }
  }

  function startEdit(entry: ChangelogEntry) {
    setEditId(entry.id)
    setEditForm({ version: entry.version, type: entry.type, title: entry.title, itemsText: textFromItems(entry.items) })
  }

  async function saveEdit(id: string) {
    setBusyId(id); setError(null)
    try {
      await updateChangelogEntry(id, {
        version: editForm.version.trim(), type: editForm.type,
        title: editForm.title.trim(), items: itemsFromText(editForm.itemsText),
      })
      setEditId(null)
      load()
    } catch (e) { setError(e instanceof Error ? e.message : 'Save failed') }
    finally { setBusyId(null) }
  }

  async function togglePublish(entry: ChangelogEntry) {
    setBusyId(entry.id); setError(null)
    try {
      await updateChangelogEntry(entry.id, { published: !entry.published })
      load()
    } catch (e) { setError(e instanceof Error ? e.message : 'Publish failed') }
    finally { setBusyId(null) }
  }

  async function remove(id: string) {
    if (!confirm('Delete this changelog entry?')) return
    setBusyId(id); setError(null)
    try { await deleteChangelogEntry(id); load() }
    catch (e) { setError(e instanceof Error ? e.message : 'Delete failed') }
    finally { setBusyId(null) }
  }

  if (loading) return <div style={{ padding: 32, color: 'var(--text-3)', fontSize: 12, fontFamily: 'monospace' }}>Loading changelog…</div>

  return (
    <div style={{ height: '100%', overflow: 'auto', padding: '24px 32px' }}>
      <div style={{ maxWidth: 760, margin: '0 auto' }}>
        <div style={{ marginBottom: 8, fontSize: 14, fontFamily: 'monospace', fontWeight: 600, color: 'var(--text-0)' }}>
          Changelog
        </div>
        <div style={{ fontSize: 11, fontFamily: 'monospace', color: 'var(--text-3)', lineHeight: 1.6, marginBottom: 20 }}>
          Manage the &quot;What&apos;s New&quot; entries shown to users. Drafts stay hidden until published.
        </div>

        {error && (
          <div style={{ fontSize: 11, fontFamily: 'monospace', color: 'var(--state-error, #ef4444)', background: 'color-mix(in oklch, var(--state-error) 10%, var(--bg-1))', padding: '8px 10px', borderRadius: 6, marginBottom: 16 }}>
            {error}
          </div>
        )}

        {/* ── Form de creación ── */}
        <div style={{ border: '1px solid var(--line-2)', borderRadius: 8, padding: 16, marginBottom: 28, background: 'var(--bg-1)' }}>
          <div style={{ fontSize: 11, fontFamily: 'monospace', fontWeight: 600, color: 'var(--text-1)', marginBottom: 12, textTransform: 'uppercase', letterSpacing: '0.06em' }}>
            New entry
          </div>
          <div style={{ display: 'flex', gap: 10, marginBottom: 10 }}>
            <div style={{ width: 160 }}>
              <label style={labelStyle}>Version</label>
              <input style={inputStyle} placeholder="v0.13.2026" value={form.version} onChange={e => setForm(f => ({ ...f, version: e.target.value }))} />
            </div>
            <div style={{ width: 170 }}>
              <label style={labelStyle}>Type</label>
              <select style={inputStyle} value={form.type} onChange={e => setForm(f => ({ ...f, type: e.target.value as ChangelogType }))}>
                {TYPES.map(t => <option key={t} value={t}>{TYPE_META[t].label}</option>)}
              </select>
            </div>
            <div style={{ flex: 1 }}>
              <label style={labelStyle}>Title</label>
              <input style={inputStyle} placeholder="Short headline" value={form.title} onChange={e => setForm(f => ({ ...f, title: e.target.value }))} />
            </div>
          </div>
          <label style={labelStyle}>Items (one bullet per line)</label>
          <textarea style={{ ...inputStyle, minHeight: 80, resize: 'vertical', lineHeight: 1.5 }}
            value={form.itemsText} onChange={e => setForm(f => ({ ...f, itemsText: e.target.value }))} />
          <div style={{ marginTop: 12, textAlign: 'right' }}>
            <button style={{ ...btnStyle, opacity: creating ? 0.5 : 1 }} disabled={creating} onClick={handleCreate}>
              {creating ? 'Creating…' : '+ Create draft'}
            </button>
          </div>
        </div>

        {/* ── Lista de entradas ── */}
        {entries.length === 0 && (
          <div style={{ fontSize: 12, fontFamily: 'monospace', color: 'var(--text-3)', textAlign: 'center', padding: 32 }}>
            No entries yet.
          </div>
        )}

        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          {entries.map(entry => {
            const isEditing = editId === entry.id
            const meta = TYPE_META[entry.type]
            return (
              <div key={entry.id} style={{ border: '1px solid var(--line-2)', borderRadius: 8, padding: 14, background: 'var(--bg-1)', opacity: busyId === entry.id ? 0.6 : 1 }}>
                {isEditing ? (
                  <>
                    <div style={{ display: 'flex', gap: 10, marginBottom: 10 }}>
                      <input style={{ ...inputStyle, width: 160 }} value={editForm.version} onChange={e => setEditForm(f => ({ ...f, version: e.target.value }))} />
                      <select style={{ ...inputStyle, width: 170 }} value={editForm.type} onChange={e => setEditForm(f => ({ ...f, type: e.target.value as ChangelogType }))}>
                        {TYPES.map(t => <option key={t} value={t}>{TYPE_META[t].label}</option>)}
                      </select>
                      <input style={{ ...inputStyle, flex: 1 }} value={editForm.title} onChange={e => setEditForm(f => ({ ...f, title: e.target.value }))} />
                    </div>
                    <textarea style={{ ...inputStyle, minHeight: 70, resize: 'vertical', lineHeight: 1.5 }}
                      value={editForm.itemsText} onChange={e => setEditForm(f => ({ ...f, itemsText: e.target.value }))} />
                    <div style={{ marginTop: 10, display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
                      <button style={btnStyle} onClick={() => setEditId(null)}>Cancel</button>
                      <button style={{ ...btnStyle, borderColor: 'var(--action)', color: 'var(--action)' }} onClick={() => saveEdit(entry.id)}>Save</button>
                    </div>
                  </>
                ) : (
                  <>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 8 }}>
                      <span style={{ fontSize: 9, fontFamily: 'monospace', fontWeight: 700, color: meta.color, border: `1px solid ${meta.color}`, borderRadius: 4, padding: '2px 6px', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                        {meta.label}
                      </span>
                      <span style={{ fontSize: 11, fontFamily: 'monospace', color: 'var(--text-3)' }}>{entry.version}</span>
                      <span style={{ flex: 1 }} />
                      <span style={{ fontSize: 9, fontFamily: 'monospace', fontWeight: 700, padding: '2px 6px', borderRadius: 4, textTransform: 'uppercase', letterSpacing: '0.05em',
                        color: entry.published ? 'var(--state-success, #22c55e)' : 'var(--text-4, #888)',
                        background: entry.published ? 'color-mix(in oklch, var(--state-success) 14%, transparent)' : 'var(--bg-3)' }}>
                        {entry.published ? 'Published' : 'Draft'}
                      </span>
                    </div>
                    <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-0)', marginBottom: 6 }}>{entry.title}</div>
                    {entry.items?.length > 0 && (
                      <ul style={{ margin: '0 0 4px', paddingLeft: 18, fontSize: 12, color: 'var(--text-2)', lineHeight: 1.6 }}>
                        {entry.items.map((it, i) => <li key={i}>{it}</li>)}
                      </ul>
                    )}
                    <div style={{ marginTop: 10, display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
                      <button style={btnStyle} onClick={() => remove(entry.id)}>Delete</button>
                      <button style={btnStyle} onClick={() => startEdit(entry)}>Edit</button>
                      <button style={{ ...btnStyle, borderColor: entry.published ? 'var(--line-2)' : 'var(--state-success, #22c55e)', color: entry.published ? 'var(--text-2)' : 'var(--state-success, #22c55e)' }} onClick={() => togglePublish(entry)}>
                        {entry.published ? 'Unpublish' : 'Publish'}
                      </button>
                    </div>
                  </>
                )}
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}
