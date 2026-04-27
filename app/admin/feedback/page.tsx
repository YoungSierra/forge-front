'use client'

import { useEffect, useState } from 'react'
import { getFeedback, updateFeedback, getMemberByAuth } from '@/lib/api'
import type { Feedback, FeedbackCategory, FeedbackSeverity, FeedbackStatus } from '@/lib/types'
import { useAuth } from '@/lib/auth-context'
import { formatDateTime } from '@/lib/utils'

const CAT_COLOR: Record<FeedbackCategory, string> = {
  bug:         'var(--cat-output)',
  usability:   'var(--cat-design)',
  performance: 'var(--cat-audio)',
  suggestion:  'var(--cat-code)',
}

const SEV_COLOR: Record<FeedbackSeverity, string> = {
  low:    'var(--text-3)',
  medium: 'var(--cat-asset)',
  high:   'var(--cat-output)',
}

const STATUS_LABEL: Record<FeedbackStatus, string> = {
  open:     'Open',
  reviewed: 'Reviewed',
  resolved: 'Resolved',
}

export default function FeedbackAdminPage() {
  const { user } = useAuth()
  const [items, setItems]           = useState<Feedback[]>([])
  const [loading, setLoading]       = useState(true)
  const [statusFilter, setStatus]   = useState<FeedbackStatus | ''>('')
  const [catFilter, setCat]         = useState<FeedbackCategory | ''>('')
  const [sevFilter, setSev]         = useState<FeedbackSeverity | ''>('')
  const [selected, setSelected]     = useState<Feedback | null>(null)
  const [resNote, setResNote]       = useState('')
  const [saving, setSaving]         = useState(false)
  const [currentMemberId, setMemberId] = useState<string | null>(null)

  useEffect(() => {
    if (user?.id) getMemberByAuth(user.id).then(m => setMemberId(m?.id ?? null))
  }, [user?.id])

  useEffect(() => {
    setLoading(true)
    setSelected(null)
    getFeedback({
      status:   statusFilter || undefined,
      category: catFilter    || undefined,
      severity: sevFilter    || undefined,
    })
      .then(data => {
        const sorted = [...data].sort((a, b) => {
          const aResolved = a.status === 'resolved' ? 1 : 0
          const bResolved = b.status === 'resolved' ? 1 : 0
          if (aResolved !== bResolved) return aResolved - bResolved
          return new Date(a.created_at).getTime() - new Date(b.created_at).getTime()
        })
        setItems(sorted)
      })
      .finally(() => setLoading(false))
  }, [statusFilter, catFilter, sevFilter])

  async function handleUpdateStatus(item: Feedback, newStatus: FeedbackStatus) {
    setSaving(true)
    try {
      const updated = await updateFeedback(item.id, {
        status: newStatus,
        resolution_note: resNote || undefined,
        resolved_by: newStatus === 'resolved' ? (currentMemberId ?? undefined) : undefined,
      })
      setItems(prev => prev.map(i => i.id === updated.id ? updated : i))
      if (selected?.id === updated.id) setSelected(updated)
      setResNote('')
    } finally {
      setSaving(false)
    }
  }

  const counts = {
    open:     items.filter(i => i.status === 'open').length,
    reviewed: items.filter(i => i.status === 'reviewed').length,
    resolved: items.filter(i => i.status === 'resolved').length,
  }

  function exportCSV() {
    const headers = ['ID', 'Fecha', 'Categoría', 'Severidad', 'Status', 'Descripción', 'Miembro', 'Proyecto', 'URL', 'Nota resolución']
    const rows = items.map(i => [
      i.id,
      i.created_at,
      i.category,
      i.severity,
      i.status,
      `"${(i.description || '').replace(/"/g, '""')}"`,
      i.members?.display_name || '',
      i.projects?.name || '',
      i.url_context || '',
      `"${(i.resolution_note || '').replace(/"/g, '""')}"`,
    ])
    const csv = [headers.join(','), ...rows.map(r => r.join(','))].join('\n')
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' })
    const url  = URL.createObjectURL(blob)
    const a    = document.createElement('a')
    a.href     = url
    a.download = `forge-feedback-${new Date().toISOString().slice(0, 10)}.csv`
    a.click()
    URL.revokeObjectURL(url)
  }

  return (
    <div style={{ minHeight: '100vh', background: 'var(--bg-0)', color: 'var(--text-0)', display: 'flex', flexDirection: 'column' }}>
      {/* Header */}
      <div style={{ padding: '16px 24px', borderBottom: '1px solid var(--line-2)', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div>
          <div style={{ fontSize: 14, fontWeight: 700 }}>Feedback</div>
          <div style={{ fontSize: 11, fontFamily: 'monospace', color: 'var(--text-3)', marginTop: 2 }}>
            {items.length} total · {counts.open} open · {counts.reviewed} reviewed · {counts.resolved} resolved
          </div>
        </div>

        {/* Filters + Export */}
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          {([['', 'All'], ['open', 'Open'], ['reviewed', 'Reviewed'], ['resolved', 'Resolved']] as [string, string][]).map(([v, l]) => (
            <button key={v} onClick={() => setStatus(v as FeedbackStatus | '')} style={{
              padding: '4px 10px', borderRadius: 5, border: `1px solid ${statusFilter === v ? 'var(--text-2)' : 'var(--line-2)'}`,
              background: statusFilter === v ? 'var(--bg-3)' : 'transparent',
              color: statusFilter === v ? 'var(--text-0)' : 'var(--text-3)',
              fontSize: 10, fontFamily: 'monospace', cursor: 'pointer',
            }}>{l}</button>
          ))}
          <select value={catFilter} onChange={e => setCat(e.target.value as FeedbackCategory | '')} style={{ background: 'var(--bg-2)', border: '1px solid var(--line-2)', borderRadius: 5, padding: '4px 8px', fontSize: 10, fontFamily: 'monospace', color: 'var(--text-2)', outline: 'none' }}>
            <option value=''>Category</option>
            <option value='bug'>Bug</option>
            <option value='usability'>Usability</option>
            <option value='performance'>Performance</option>
            <option value='suggestion'>Suggestion</option>
          </select>
          <select value={sevFilter} onChange={e => setSev(e.target.value as FeedbackSeverity | '')} style={{ background: 'var(--bg-2)', border: '1px solid var(--line-2)', borderRadius: 5, padding: '4px 8px', fontSize: 10, fontFamily: 'monospace', color: 'var(--text-2)', outline: 'none' }}>
            <option value=''>Severity</option>
            <option value='high'>High</option>
            <option value='medium'>Medium</option>
            <option value='low'>Low</option>
          </select>
          <button
            onClick={exportCSV}
            disabled={items.length === 0}
            style={{ padding: '4px 12px', borderRadius: 5, border: '1px solid var(--line-2)', background: 'var(--bg-3)', color: items.length > 0 ? 'var(--text-1)' : 'var(--text-3)', fontSize: 10, fontFamily: 'monospace', cursor: items.length > 0 ? 'pointer' : 'not-allowed' }}
          >
            ↓ CSV
          </button>
        </div>
      </div>

      <div style={{ flex: 1, display: 'flex', overflow: 'hidden' }}>
        {/* List */}
        <div style={{ width: 400, borderRight: '1px solid var(--line-2)', overflowY: 'auto' }}>
          {loading ? (
            <div style={{ padding: 24, fontSize: 11, fontFamily: 'monospace', color: 'var(--text-3)' }}>Loading...</div>
          ) : items.length === 0 ? (
            <div style={{ padding: 24, fontSize: 11, fontFamily: 'monospace', color: 'var(--text-3)' }}>No results</div>
          ) : items.map(item => (
            <div
              key={item.id}
              onClick={() => { setSelected(item); setResNote(item.resolution_note || '') }}
              style={{
                padding: '12px 16px', borderBottom: '1px solid var(--line-2)', cursor: 'pointer',
                background: selected?.id === item.id ? 'var(--bg-2)' : 'transparent',
              }}
              onMouseEnter={e => { if (selected?.id !== item.id) (e.currentTarget as HTMLDivElement).style.background = 'var(--bg-2)' }}
              onMouseLeave={e => { if (selected?.id !== item.id) (e.currentTarget as HTMLDivElement).style.background = 'transparent' }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4, flexWrap: 'wrap' }}>
                <span style={{ fontSize: 9, fontFamily: 'monospace', color: CAT_COLOR[item.category], background: `color-mix(in srgb, ${CAT_COLOR[item.category]} 12%, transparent)`, padding: '1px 6px', borderRadius: 99 }}>{item.category}</span>
                <span style={{ fontSize: 9, fontFamily: 'monospace', color: SEV_COLOR[item.severity], background: 'var(--bg-3)', padding: '1px 6px', borderRadius: 99 }}>{item.severity}</span>
                <span style={{ fontSize: 9, fontFamily: 'monospace', color: item.status === 'resolved' ? 'var(--cat-code)' : item.status === 'reviewed' ? 'var(--cat-audio)' : 'var(--text-3)', background: 'var(--bg-3)', padding: '1px 6px', borderRadius: 99 }}>{STATUS_LABEL[item.status]}</span>
                <div style={{ marginLeft: 'auto', display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 2 }}>
                  <span style={{ fontSize: 9, fontFamily: 'monospace', color: 'var(--text-3)' }}>{formatDateTime(item.created_at)}</span>
                  {item.status === 'resolved' && item.resolved_at && (
                    <span style={{ fontSize: 9, fontFamily: 'monospace', color: 'var(--cat-code)' }}>✓ {formatDateTime(item.resolved_at)}</span>
                  )}
                </div>
              </div>
              <p style={{ fontSize: 11, color: 'var(--text-1)', margin: 0, lineHeight: 1.4, display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>
                {item.description}
              </p>
              {item.members && (
                <div style={{ fontSize: 10, fontFamily: 'monospace', color: 'var(--text-3)', marginTop: 4 }}>
                  {item.members.display_name} {item.projects && `· ${item.projects.name}`}
                </div>
              )}
            </div>
          ))}
        </div>

        {/* Detail */}
        <div style={{ flex: 1, overflowY: 'auto', padding: 24 }}>
          {!selected ? (
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', fontSize: 11, fontFamily: 'monospace', color: 'var(--text-3)' }}>
              Select an item to view details
            </div>
          ) : (
            <div style={{ maxWidth: 600 }}>
              {/* Badges */}
              <div style={{ display: 'flex', gap: 8, marginBottom: 16 }}>
                <span style={{ fontSize: 10, fontFamily: 'monospace', color: CAT_COLOR[selected.category], background: `color-mix(in srgb, ${CAT_COLOR[selected.category]} 12%, transparent)`, padding: '2px 8px', borderRadius: 99 }}>{selected.category}</span>
                <span style={{ fontSize: 10, fontFamily: 'monospace', color: SEV_COLOR[selected.severity], background: 'var(--bg-3)', padding: '2px 8px', borderRadius: 99 }}>{selected.severity}</span>
                <span style={{ fontSize: 10, fontFamily: 'monospace', color: 'var(--text-3)', background: 'var(--bg-3)', padding: '2px 8px', borderRadius: 99 }}>{STATUS_LABEL[selected.status]}</span>
              </div>

              {/* Description */}
              <p style={{ fontSize: 13, color: 'var(--text-0)', lineHeight: 1.6, marginBottom: 16 }}>{selected.description}</p>

              {/* Screenshot */}
              {selected.screenshot_url && (
                <div style={{ marginBottom: 16 }}>
                  <img src={selected.screenshot_url} alt="screenshot" style={{ width: '100%', borderRadius: 8, border: '1px solid var(--line-2)' }} />
                </div>
              )}

              {/* Meta */}
              <div style={{ fontSize: 10, fontFamily: 'monospace', color: 'var(--text-3)', marginBottom: 20, display: 'flex', flexDirection: 'column', gap: 3 }}>
                {selected.members && <span>Submitted by: {selected.members.display_name}</span>}
                {selected.projects && <span>Project: {selected.projects.name}</span>}
                {selected.url_context && <span>URL: {selected.url_context}</span>}
                <span>Created: {formatDateTime(selected.created_at)}</span>
                {selected.status === 'resolved' && selected.resolved_at && (
                  <span style={{ color: 'var(--cat-code)' }}>Resolved: {formatDateTime(selected.resolved_at)}</span>
                )}
                {selected.status === 'resolved' && selected.resolver && (
                  <span style={{ color: 'var(--cat-code)' }}>Resolved by: {selected.resolver.display_name}</span>
                )}
              </div>

              {/* Resolution note */}
              <div style={{ marginBottom: 12 }}>
                <label style={{ fontSize: 10, fontFamily: 'monospace', color: 'var(--text-3)', textTransform: 'uppercase', letterSpacing: '0.08em', display: 'block', marginBottom: 6 }}>
                  Resolution note
                </label>
                <textarea
                  value={resNote}
                  onChange={e => setResNote(e.target.value)}
                  placeholder="Describe how it was resolved or what was done..."
                  rows={3}
                  style={{ width: '100%', background: 'var(--bg-2)', border: '1px solid var(--line-2)', borderRadius: 6, padding: '8px 10px', fontSize: 12, color: 'var(--text-0)', resize: 'vertical', outline: 'none', fontFamily: 'inherit', boxSizing: 'border-box' }}
                />
              </div>

              {/* Status actions */}
              <div style={{ display: 'flex', gap: 8 }}>
                {selected.status === 'open' && (
                  <button onClick={() => handleUpdateStatus(selected, 'reviewed')} disabled={saving} style={{ padding: '7px 14px', borderRadius: 6, border: '1px solid var(--line-2)', background: 'var(--bg-3)', color: 'var(--text-1)', fontSize: 11, fontFamily: 'monospace', cursor: 'pointer' }}>
                    Mark reviewed
                  </button>
                )}
                {selected.status !== 'resolved' && (
                  <button onClick={() => handleUpdateStatus(selected, 'resolved')} disabled={saving} style={{ padding: '7px 14px', borderRadius: 6, border: 'none', background: 'var(--cat-code)', color: '#0a0a0c', fontSize: 11, fontFamily: 'monospace', fontWeight: 600, cursor: 'pointer' }}>
                    {saving ? 'Saving...' : 'Mark resolved'}
                  </button>
                )}
                {selected.status === 'resolved' && (
                  <button onClick={() => handleUpdateStatus(selected, 'open')} disabled={saving} style={{ padding: '7px 14px', borderRadius: 6, border: '1px solid var(--line-2)', background: 'transparent', color: 'var(--text-3)', fontSize: 11, fontFamily: 'monospace', cursor: 'pointer' }}>
                    Reopen
                  </button>
                )}
              </div>

              {selected.resolution_note && selected.status === 'resolved' && (
                <div style={{ marginTop: 16, padding: '10px 12px', background: 'color-mix(in srgb, var(--cat-code) 8%, var(--bg-1))', border: '1px solid color-mix(in srgb, var(--cat-code) 20%, transparent)', borderRadius: 6 }}>
                  <div style={{ fontSize: 9, fontFamily: 'monospace', color: 'var(--cat-code)', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 4 }}>Resolution</div>
                  <p style={{ fontSize: 11, color: 'var(--text-1)', margin: 0, lineHeight: 1.5 }}>{selected.resolution_note}</p>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
