'use client'

import { useEffect, useState, useCallback, Suspense } from 'react'
import { useSearchParams } from 'next/navigation'
import { BACKEND_URL } from '@/lib/api'

function adminFetch(path: string) {
  const memberId = typeof window !== 'undefined' ? localStorage.getItem('forge_member_id') : null
  return fetch(`${BACKEND_URL}${path}`, {
    headers: { 'Content-Type': 'application/json', ...(memberId ? { 'x-member-id': memberId } : {}) },
  })
}

// ─── Tipos ────────────────────────────────────────────────────────────────────

interface Summary {
  total_calls:    number
  total_cost:     number
  total_input:    number
  total_output:   number
  total_cached:   number
  avg_duration:   number
  error_count:    number
  llm_calls:      number
  image_calls:    number
  cache_hit_rate: number
}

interface BreakdownRow {
  key:           string
  label:         string
  calls:         number
  cost_usd:      number
  input_tokens:  number
  output_tokens: number
  cached_tokens: number
  avg_duration:  number
  errors:        number
}

interface LogRow {
  id:            string
  created_at:    string
  trigger_type:  string
  executor_type: string
  provider:      string
  model:         string
  input_tokens:  number
  output_tokens: number
  cost_usd:      number
  is_estimated:  boolean
  duration_ms:   number
  status:        string
  error_code:    string | null
  projects:      { name: string } | null
  members:       { display_name: string } | null
}

interface Project { id: string; name: string }
interface Org { id: string; name: string }

type GroupBy = 'project' | 'member' | 'org' | 'provider' | 'day'

// ─── Helpers ──────────────────────────────────────────────────────────────────

function fmtCost(v: number) {
  if (v >= 1)    return `$${v.toFixed(4)}`
  if (v >= 0.01) return `$${v.toFixed(5)}`
  return `$${v.toFixed(6)}`
}

function fmtTokens(n: number) {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`
  if (n >= 1_000)     return `${(n / 1_000).toFixed(1)}K`
  return String(n)
}

function fmtMs(ms: number) {
  if (!ms) return '—'
  if (ms >= 60_000) return `${(ms / 60_000).toFixed(1)}m`
  if (ms >= 1_000)  return `${(ms / 1_000).toFixed(1)}s`
  return `${ms}ms`
}

function fmtDate(iso: string) {
  return new Date(iso).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })
}

// ─── KPI Chip ─────────────────────────────────────────────────────────────────

function KPI({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div style={{
      background: 'var(--bg-1)', border: '1px solid var(--line-2)', borderRadius: 8,
      padding: '14px 18px', minWidth: 140,
    }}>
      <div style={{ fontSize: 9, fontFamily: 'var(--font-mono)', color: 'var(--text-3)', letterSpacing: '0.06em', marginBottom: 6 }}>{label}</div>
      <div style={{ fontSize: 22, fontWeight: 700, color: 'var(--text-0)', lineHeight: 1 }}>{value}</div>
      {sub && <div style={{ fontSize: 10, color: 'var(--text-3)', marginTop: 4 }}>{sub}</div>}
    </div>
  )
}

// ─── Componente principal ─────────────────────────────────────────────────────

function AnalyticsContent() {
  const searchParams = useSearchParams()
  const [summary,   setSummary]   = useState<Summary | null>(null)
  const [breakdown, setBreakdown] = useState<BreakdownRow[]>([])
  const [logs,      setLogs]      = useState<LogRow[]>([])
  const [logTotal,  setLogTotal]  = useState(0)
  const [logPage,   setLogPage]   = useState(1)
  const [projects,  setProjects]  = useState<Project[]>([])
  const [orgs,      setOrgs]      = useState<Org[]>([])
  const [groupBy,   setGroupBy]   = useState<GroupBy>('org')
  const [projectId, setProjectId] = useState(() => searchParams.get('project_id') ?? '')
  const [orgId,     setOrgId]     = useState(() => searchParams.get('org_id') ?? '')
  const [from,      setFrom]      = useState('')
  const [to,        setTo]        = useState('')
  const [loading,   setLoading]   = useState(false)

  const buildQS = useCallback(() => {
    const p = new URLSearchParams()
    if (from)      p.set('from', from)
    if (to)        p.set('to', to)
    if (projectId) p.set('project_id', projectId)
    if (orgId)     p.set('org_id', orgId)
    return p.toString() ? `?${p}` : ''
  }, [from, to, projectId, orgId])

  const load = useCallback(async (page = 1) => {
    setLoading(true)
    try {
      const qs = buildQS()
      const [sumRes, bkRes, logRes] = await Promise.all([
        adminFetch(`/api/admin/analytics/summary${qs}`),
        adminFetch(`/api/admin/analytics/breakdown?group_by=${groupBy}${qs ? '&' + qs.slice(1) : ''}`),
        adminFetch(`/api/admin/analytics/logs${qs}${qs ? '&' : '?'}page=${page}&limit=50`),
      ])
      const [sum, bk, lg] = await Promise.all([sumRes.json(), bkRes.json(), logRes.json()])
      if (sum.success) setSummary(sum.summary)
      if (bk.success)  setBreakdown(bk.breakdown)
      if (lg.success)  { setLogs(lg.logs); setLogTotal(lg.total); setLogPage(page) }
    } finally {
      setLoading(false)
    }
  }, [buildQS, groupBy])

  useEffect(() => {
    adminFetch('/api/admin/analytics/projects-list').then(r => r.json()).then(d => {
      if (d.success) setProjects(d.projects)
    })
    adminFetch('/api/admin/analytics/orgs-list').then(r => r.json()).then(d => {
      if (d.success) setOrgs(d.orgs)
    })
  }, [])

  useEffect(() => { load(1) }, [load])

  const TH: React.CSSProperties = {
    padding: '7px 12px', textAlign: 'left', fontSize: 9, fontFamily: 'var(--font-mono)',
    color: 'var(--text-3)', fontWeight: 600, letterSpacing: '0.06em', whiteSpace: 'nowrap',
    borderBottom: '1px solid var(--line-2)', background: 'var(--bg-2)',
  }
  const TD: React.CSSProperties = {
    padding: '7px 12px', fontSize: 11, color: 'var(--text-1)',
    borderBottom: '1px solid var(--line-2)', whiteSpace: 'nowrap',
  }

  const TABS: { key: GroupBy; label: string }[] = [
    { key: 'org',      label: 'By Org'      },
    { key: 'project',  label: 'By Project'  },
    { key: 'member',   label: 'By Member'   },
    { key: 'provider', label: 'By Provider' },
    { key: 'day',      label: 'By Day'      },
  ]

  return (
    <div style={{ height: '100%', overflowY: 'auto', padding: '28px 32px', display: 'flex', flexDirection: 'column', gap: 24 }}>

      {/* Filtros */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
        <span style={{ fontSize: 11, fontFamily: 'var(--font-mono)', fontWeight: 700, color: 'var(--text-0)', letterSpacing: '0.06em' }}>
          ANALYTICS
        </span>
        <div style={{ width: 1, height: 16, background: 'var(--line-2)' }} />

        <select
          value={orgId}
          onChange={e => setOrgId(e.target.value)}
          style={{ fontSize: 11, background: 'var(--bg-2)', border: '1px solid var(--line-2)', borderRadius: 6, padding: '5px 8px', color: 'var(--text-1)', fontFamily: 'inherit' }}
        >
          <option value="">All orgs</option>
          {orgs.map(o => <option key={o.id} value={o.id}>{o.name}</option>)}
        </select>

        <select
          value={projectId}
          onChange={e => setProjectId(e.target.value)}
          style={{ fontSize: 11, background: 'var(--bg-2)', border: '1px solid var(--line-2)', borderRadius: 6, padding: '5px 8px', color: 'var(--text-1)', fontFamily: 'inherit' }}
        >
          <option value="">All projects</option>
          {projects.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
        </select>

        <input
          type="date" value={from} onChange={e => setFrom(e.target.value)}
          style={{ fontSize: 11, background: 'var(--bg-2)', border: '1px solid var(--line-2)', borderRadius: 6, padding: '5px 8px', color: 'var(--text-1)', fontFamily: 'inherit' }}
        />
        <span style={{ fontSize: 11, color: 'var(--text-3)' }}>→</span>
        <input
          type="date" value={to} onChange={e => setTo(e.target.value)}
          style={{ fontSize: 11, background: 'var(--bg-2)', border: '1px solid var(--line-2)', borderRadius: 6, padding: '5px 8px', color: 'var(--text-1)', fontFamily: 'inherit' }}
        />

        <button
          onClick={() => load(1)}
          disabled={loading}
          style={{
            fontSize: 11, padding: '5px 14px', borderRadius: 6, border: '1px solid var(--line-2)',
            background: 'var(--bg-2)', color: 'var(--text-1)', cursor: 'pointer', fontFamily: 'inherit',
          }}
        >
          {loading ? '…' : 'Apply'}
        </button>
        {(from || to || projectId || orgId) && (
          <button
            onClick={() => { setFrom(''); setTo(''); setProjectId(''); setOrgId('') }}
            style={{ fontSize: 11, padding: '5px 10px', borderRadius: 6, border: 'none', background: 'none', color: 'var(--text-3)', cursor: 'pointer' }}
          >
            Clear
          </button>
        )}
      </div>

      {/* KPIs */}
      {summary && (
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
          <KPI label="TOTAL COST"     value={fmtCost(summary.total_cost)} sub={`${summary.total_calls.toLocaleString()} calls`} />
          <KPI label="LLM CALLS"      value={summary.llm_calls.toLocaleString()} sub={`${summary.image_calls} image gen`} />
          <KPI label="TOKENS IN"      value={fmtTokens(summary.total_input)}  sub={`${fmtTokens(summary.total_output)} out`} />
          <KPI label="CACHE HIT"      value={`${(summary.cache_hit_rate * 100).toFixed(1)}%`} sub={`${fmtTokens(summary.total_cached)} cached`} />
          <KPI label="AVG LATENCY"    value={fmtMs(summary.avg_duration)} />
          <KPI label="ERRORS"         value={String(summary.error_count)} />
        </div>
      )}

      {/* Breakdown tabs */}
      <div>
        <div style={{ display: 'flex', gap: 0, borderBottom: '1px solid var(--line-2)', marginBottom: 0 }}>
          {TABS.map(t => (
            <button key={t.key} onClick={() => setGroupBy(t.key)}
              style={{
                padding: '7px 16px', fontSize: 11, fontFamily: 'var(--font-mono)',
                background: 'none', border: 'none', cursor: 'pointer',
                color: groupBy === t.key ? 'var(--text-0)' : 'var(--text-3)',
                fontWeight: groupBy === t.key ? 700 : 400,
                borderBottom: `2px solid ${groupBy === t.key ? 'var(--action)' : 'transparent'}`,
                marginBottom: -1,
              }}
            >{t.label}</button>
          ))}
        </div>

        <div style={{ overflowX: 'auto', border: '1px solid var(--line-2)', borderTop: 'none', borderRadius: '0 0 8px 8px' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr>
                <th style={TH}>{groupBy.toUpperCase()}</th>
                <th style={{ ...TH, textAlign: 'right' }}>CALLS</th>
                <th style={{ ...TH, textAlign: 'right' }}>COST</th>
                <th style={{ ...TH, textAlign: 'right' }}>IN TOKENS</th>
                <th style={{ ...TH, textAlign: 'right' }}>OUT TOKENS</th>
                <th style={{ ...TH, textAlign: 'right' }}>CACHED</th>
                <th style={{ ...TH, textAlign: 'right' }}>AVG LATENCY</th>
                <th style={{ ...TH, textAlign: 'right' }}>ERRORS</th>
              </tr>
            </thead>
            <tbody>
              {breakdown.length === 0 ? (
                <tr><td colSpan={8} style={{ ...TD, textAlign: 'center', color: 'var(--text-4)', padding: '24px' }}>No data yet</td></tr>
              ) : breakdown.map(row => (
                <tr key={row.key} style={{ transition: 'background 100ms' }}
                  onMouseEnter={e => (e.currentTarget.style.background = 'var(--bg-2)')}
                  onMouseLeave={e => (e.currentTarget.style.background = '')}>
                  <td style={{ ...TD, fontWeight: 600, color: 'var(--text-0)', maxWidth: 240, overflow: 'hidden', textOverflow: 'ellipsis' }}>{row.label || '—'}</td>
                  <td style={{ ...TD, textAlign: 'right' }}>{row.calls.toLocaleString()}</td>
                  <td style={{ ...TD, textAlign: 'right', fontFamily: 'var(--font-mono)', color: 'var(--action)' }}>{fmtCost(row.cost_usd)}</td>
                  <td style={{ ...TD, textAlign: 'right', fontFamily: 'var(--font-mono)' }}>{fmtTokens(row.input_tokens)}</td>
                  <td style={{ ...TD, textAlign: 'right', fontFamily: 'var(--font-mono)' }}>{fmtTokens(row.output_tokens)}</td>
                  <td style={{ ...TD, textAlign: 'right', fontFamily: 'var(--font-mono)', color: 'var(--text-3)' }}>{fmtTokens(row.cached_tokens)}</td>
                  <td style={{ ...TD, textAlign: 'right', fontFamily: 'var(--font-mono)' }}>{fmtMs(row.avg_duration)}</td>
                  <td style={{ ...TD, textAlign: 'right', color: row.errors > 0 ? '#ef4444' : 'var(--text-4)' }}>{row.errors || '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Log detallado */}
      <div>
        <div style={{ fontSize: 9, fontFamily: 'var(--font-mono)', fontWeight: 700, color: 'var(--text-3)', letterSpacing: '0.06em', marginBottom: 10 }}>
          EXECUTION LOG — {logTotal.toLocaleString()} entries
        </div>

        <div style={{ overflowX: 'auto', border: '1px solid var(--line-2)', borderRadius: 8 }}>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr>
                <th style={TH}>DATE</th>
                <th style={TH}>PROJECT</th>
                <th style={TH}>MEMBER</th>
                <th style={TH}>TRIGGER</th>
                <th style={TH}>EXECUTOR</th>
                <th style={TH}>PROVIDER / MODEL</th>
                <th style={{ ...TH, textAlign: 'right' }}>IN</th>
                <th style={{ ...TH, textAlign: 'right' }}>OUT</th>
                <th style={{ ...TH, textAlign: 'right' }}>COST</th>
                <th style={{ ...TH, textAlign: 'right' }}>LATENCY</th>
                <th style={TH}>STATUS</th>
              </tr>
            </thead>
            <tbody>
              {logs.length === 0 ? (
                <tr><td colSpan={11} style={{ ...TD, textAlign: 'center', color: 'var(--text-4)', padding: '24px' }}>No logs yet — executions will appear here once the system is active</td></tr>
              ) : logs.map(log => (
                <tr key={log.id}
                  onMouseEnter={e => (e.currentTarget.style.background = 'var(--bg-2)')}
                  onMouseLeave={e => (e.currentTarget.style.background = '')}>
                  <td style={{ ...TD, color: 'var(--text-3)', fontSize: 10 }}>{fmtDate(log.created_at)}</td>
                  <td style={{ ...TD, maxWidth: 140, overflow: 'hidden', textOverflow: 'ellipsis' }}>{log.projects?.name || '—'}</td>
                  <td style={{ ...TD, maxWidth: 120, overflow: 'hidden', textOverflow: 'ellipsis' }}>{log.members?.display_name || '—'}</td>
                  <td style={{ ...TD, fontFamily: 'var(--font-mono)', fontSize: 10 }}>{log.trigger_type}</td>
                  <td style={{ ...TD, fontFamily: 'var(--font-mono)', fontSize: 10 }}>{log.executor_type}</td>
                  <td style={{ ...TD, fontFamily: 'var(--font-mono)', fontSize: 10, color: 'var(--text-2)' }}>
                    {log.provider}{log.model ? ` / ${log.model.slice(0, 30)}` : ''}
                    {log.is_estimated && <span style={{ color: 'var(--text-4)', marginLeft: 4 }}>~</span>}
                  </td>
                  <td style={{ ...TD, textAlign: 'right', fontFamily: 'var(--font-mono)' }}>{fmtTokens(log.input_tokens)}</td>
                  <td style={{ ...TD, textAlign: 'right', fontFamily: 'var(--font-mono)' }}>{fmtTokens(log.output_tokens)}</td>
                  <td style={{ ...TD, textAlign: 'right', fontFamily: 'var(--font-mono)', color: 'var(--action)' }}>{fmtCost(parseFloat(String(log.cost_usd)))}</td>
                  <td style={{ ...TD, textAlign: 'right', fontFamily: 'var(--font-mono)' }}>{fmtMs(log.duration_ms)}</td>
                  <td style={{ ...TD }}>
                    <span style={{
                      fontSize: 9, padding: '2px 6px', borderRadius: 4,
                      fontFamily: 'var(--font-mono)', fontWeight: 600,
                      background: log.status === 'success' ? 'rgba(52,211,153,0.12)' : 'rgba(239,68,68,0.12)',
                      color:      log.status === 'success' ? '#34d399' : '#ef4444',
                    }}>{log.status}</span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* Paginación */}
        {logTotal > 50 && (
          <div style={{ display: 'flex', gap: 6, justifyContent: 'center', marginTop: 12 }}>
            <button disabled={logPage <= 1} onClick={() => load(logPage - 1)}
              style={{ fontSize: 11, padding: '4px 12px', borderRadius: 6, border: '1px solid var(--line-2)', background: 'var(--bg-2)', color: 'var(--text-2)', cursor: logPage <= 1 ? 'not-allowed' : 'pointer', opacity: logPage <= 1 ? 0.4 : 1 }}>
              ← Prev
            </button>
            <span style={{ fontSize: 11, color: 'var(--text-3)', alignSelf: 'center' }}>Page {logPage} of {Math.ceil(logTotal / 50)}</span>
            <button disabled={logPage >= Math.ceil(logTotal / 50)} onClick={() => load(logPage + 1)}
              style={{ fontSize: 11, padding: '4px 12px', borderRadius: 6, border: '1px solid var(--line-2)', background: 'var(--bg-2)', color: 'var(--text-2)', cursor: logPage >= Math.ceil(logTotal / 50) ? 'not-allowed' : 'pointer', opacity: logPage >= Math.ceil(logTotal / 50) ? 0.4 : 1 }}>
              Next →
            </button>
          </div>
        )}
      </div>
    </div>
  )
}

export default function AnalyticsPage() {
  return (
    <Suspense fallback={null}>
      <AnalyticsContent />
    </Suspense>
  )
}
