'use client'

import { useEffect, useState, useCallback } from 'react'
import { BACKEND_URL } from '@/lib/api'

function adminFetch(path: string, opts?: RequestInit) {
  const memberId = typeof window !== 'undefined' ? localStorage.getItem('forge_member_id') : null
  return fetch(`${BACKEND_URL}${path}`, {
    ...opts,
    headers: { 'Content-Type': 'application/json', ...(memberId ? { 'x-member-id': memberId } : {}), ...(opts?.headers as Record<string, string> || {}) },
  })
}

interface Org {
  id: string; name: string; slug: string; status: string
  credit_balance: number; margin_multiplier: number
  last_topup_usd: number | null; payment_provider: string | null; billing_email: string | null
  member_count: number; created_at: string
}
interface LedgerTx {
  id: string; type: string; amount_usd: number; balance_after: number | null
  raw_cost_usd: number | null; margin_multiplier: number | null
  payment_provider: string | null; external_ref: string | null; created_at: string
}
interface OrgBlueprint {
  id: string; blueprint_key: string; name: string; phase: string; description: string | null
  is_default: boolean; node_sequence: unknown[] | null; updated_at: string
}

const money = (v: number | null | undefined) =>
  '$' + Number(v ?? 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
const fmtDate = (iso: string) => new Date(iso).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })

const box: React.CSSProperties = { background: 'var(--bg-1)', border: '1px solid var(--line-2)', borderRadius: 8, padding: 14 }
const inp: React.CSSProperties = { background: 'var(--bg-0)', border: '1px solid var(--line-2)', borderRadius: 5, padding: '5px 8px', fontSize: 12, color: 'var(--text-0)', fontFamily: 'inherit' }
const btn: React.CSSProperties = { background: 'var(--action)', color: '#fff', border: 'none', borderRadius: 5, padding: '5px 12px', fontSize: 12, cursor: 'pointer', fontWeight: 600 }
const btnGhost: React.CSSProperties = { background: 'transparent', color: 'var(--text-2)', border: '1px solid var(--line-2)', borderRadius: 5, padding: '4px 10px', fontSize: 11, cursor: 'pointer' }
const label: React.CSSProperties = { fontSize: 10, color: 'var(--text-3)', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 3, display: 'block' }
const th: React.CSSProperties = { padding: '4px 6px', color: 'var(--text-3)', fontSize: 10, textTransform: 'uppercase', textAlign: 'left', fontWeight: 400 }

export default function OrgsAdminPage() {
  const [orgs, setOrgs] = useState<Org[]>([])
  const [selId, setSelId] = useState<string | null>(null)
  const [ledger, setLedger] = useState<LedgerTx[]>([])
  const [blueprints, setBlueprints] = useState<OrgBlueprint[]>([])
  const [msg, setMsg] = useState<string>('')

  // forms
  const [nname, setNName] = useState(''); const [nMargin, setNMargin] = useState('1.5')
  const [credit, setCredit] = useState('')
  const [adm, setAdm] = useState({ email: '', password: '', display_name: '' })

  const load = useCallback(async () => {
    const r = await adminFetch('/api/admin/orgs'); const d = await r.json()
    if (d.success) setOrgs(d.orgs)
  }, [])
  useEffect(() => { load() }, [load])

  const sel = orgs.find(o => o.id === selId) || null

  const loadLedger = useCallback(async (id: string) => {
    const r = await adminFetch(`/api/admin/orgs/${id}/ledger`); const d = await r.json()
    if (d.success) setLedger(d.transactions)
  }, [])
  useEffect(() => { if (selId) loadLedger(selId) }, [selId, loadLedger])

  const loadBlueprints = useCallback(async (id: string) => {
    const r = await adminFetch(`/api/admin/orgs/${id}/blueprints`); const d = await r.json()
    if (d.success) setBlueprints(d.blueprints)
  }, [])
  useEffect(() => { if (selId) loadBlueprints(selId) }, [selId, loadBlueprints])

  const flash = (m: string) => { setMsg(m); setTimeout(() => setMsg(''), 3000) }

  async function createOrg() {
    if (!nname.trim()) return
    const r = await adminFetch('/api/admin/orgs', { method: 'POST', body: JSON.stringify({ name: nname.trim(), margin_multiplier: Number(nMargin) }) })
    const d = await r.json()
    if (d.success) { setNName(''); setNMargin('1.5'); flash('Organization created'); load() } else flash(d.error || 'Error')
  }
  async function loadCredits() {
    if (!sel || !credit) return
    const r = await adminFetch(`/api/admin/orgs/${sel.id}/credits`, { method: 'POST', body: JSON.stringify({ amount_usd: Number(credit) }) })
    const d = await r.json()
    if (d.success) { setCredit(''); flash(`Loaded. New balance ${money(d.new_balance)}`); load(); loadLedger(sel.id) } else flash(d.error || 'Error')
  }
  async function saveMargin(v: string) {
    if (!sel) return
    const r = await adminFetch(`/api/admin/orgs/${sel.id}`, { method: 'PATCH', body: JSON.stringify({ margin_multiplier: Number(v) }) })
    const d = await r.json(); if (d.success) { flash('Margin updated'); load() } else flash(d.error || 'Error')
  }
  async function createAdmin() {
    if (!sel || !adm.email || !adm.password || !adm.display_name) return
    const r = await adminFetch(`/api/admin/orgs/${sel.id}/admins`, { method: 'POST', body: JSON.stringify(adm) })
    const d = await r.json()
    if (d.success) { setAdm({ email: '', password: '', display_name: '' }); flash('Org-admin created'); load() } else flash(d.error || 'Error')
  }

  return (
    <div style={{ height: '100%', overflow: 'auto', padding: 20, fontFamily: 'monospace' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
        <h1 style={{ fontSize: 15, color: 'var(--text-0)', margin: 0 }}>Organizations</h1>
        {msg && <span style={{ fontSize: 11, color: 'var(--action)' }}>{msg}</span>}
      </div>

      {/* New org */}
      <div style={{ ...box, marginBottom: 16, display: 'flex', gap: 10, alignItems: 'flex-end', flexWrap: 'wrap' }}>
        <div><span style={label}>Name</span><input style={{ ...inp, width: 220 }} value={nname} onChange={e => setNName(e.target.value)} placeholder="Indie Studio X" /></div>
        <div><span style={label}>Margin (x)</span><input style={{ ...inp, width: 80 }} value={nMargin} onChange={e => setNMargin(e.target.value)} /></div>
        <button style={btn} onClick={createOrg}>Create organization</button>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: sel ? '1fr 1fr' : '1fr', gap: 16 }}>
        {/* Table */}
        <div style={box}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
            <thead><tr>
              <th style={th}>Org</th>
              <th style={th}>Credit</th>
              <th style={th}>Balance</th>
              <th style={th}>Margin</th><th style={th}>Members</th><th style={th}>Status</th>
            </tr></thead>
            <tbody>
              {orgs.map(o => (
                <tr key={o.id} onClick={() => setSelId(o.id)} style={{ cursor: 'pointer', borderTop: '1px solid var(--line-2)', background: o.id === selId ? 'var(--bg-2)' : 'transparent' }}>
                  <td style={{ padding: '6px' }}><div style={{ color: 'var(--text-0)' }}>{o.name}</div><div style={{ color: 'var(--text-3)', fontSize: 10 }}>{o.slug}</div></td>
                  <td style={{ padding: '6px', color: 'var(--text-3)' }} title="Credit loaded (last top-up)">{o.last_topup_usd != null ? money(o.last_topup_usd) : '—'}</td>
                  <td style={{ padding: '6px', color: 'var(--text-0)', fontWeight: 600 }} title="Remaining balance">{money(o.credit_balance)}</td>
                  <td style={{ padding: '6px', color: 'var(--text-2)' }}>x{o.margin_multiplier}</td>
                  <td style={{ padding: '6px', color: 'var(--text-2)' }}>{o.member_count}</td>
                  <td style={{ padding: '6px' }}><span style={{ fontSize: 10, color: o.status === 'active' ? 'var(--ok, #3a3)' : 'var(--text-3)' }}>{o.status}</span></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* Selected org detail */}
        {sel && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            <div style={{ ...box, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <div>
                <div style={{ color: 'var(--text-0)', fontSize: 14 }}>{sel.name}</div>
                <div style={{ color: 'var(--text-3)', fontSize: 10 }}>balance {money(sel.credit_balance)} · credit loaded {sel.last_topup_usd != null ? money(sel.last_topup_usd) : '—'} · {sel.member_count} members</div>
              </div>
              <button style={btnGhost} onClick={() => setSelId(null)}>close</button>
            </div>

            {/* Load credits */}
            <div style={box}>
              <span style={label}>Load credits (USD)</span>
              <div style={{ display: 'flex', gap: 8 }}>
                <input style={{ ...inp, width: 120 }} value={credit} onChange={e => setCredit(e.target.value)} placeholder="100" />
                <button style={btn} onClick={loadCredits}>Load</button>
              </div>
            </div>

            {/* Margin */}
            <div style={box}>
              <span style={label}>Margin (multiplier, per org)</span>
              <div style={{ display: 'flex', gap: 8 }}>
                <input style={{ ...inp, width: 80 }} defaultValue={String(sel.margin_multiplier)} onBlur={e => saveMargin(e.target.value)} />
                <span style={{ fontSize: 10, color: 'var(--text-3)', alignSelf: 'center' }}>saves on blur</span>
              </div>
            </div>

            {/* Create org-admin */}
            <div style={box}>
              <span style={label}>Create org-admin</span>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6, marginBottom: 6 }}>
                <input style={inp} value={adm.email} onChange={e => setAdm({ ...adm, email: e.target.value })} placeholder="email" autoComplete="off" name="new-admin-email" />
                <input style={inp} value={adm.display_name} onChange={e => setAdm({ ...adm, display_name: e.target.value })} placeholder="name" autoComplete="off" name="new-admin-name" />
                <input style={inp} type="password" value={adm.password} onChange={e => setAdm({ ...adm, password: e.target.value })} placeholder="password" autoComplete="new-password" name="new-admin-password" />
                <button style={btn} onClick={createAdmin}>Create admin</button>
              </div>
            </div>

            {/* Full ledger (raw cost + margin) */}
            <div style={box}>
              <span style={label}>Ledger (V57 detail)</span>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 11 }}>
                <thead><tr>
                  <th style={{ ...th, fontSize: 9 }}>Date</th><th style={{ ...th, fontSize: 9 }}>Type</th>
                  <th style={{ ...th, fontSize: 9 }}>Amount</th><th style={{ ...th, fontSize: 9 }}>Raw cost</th><th style={{ ...th, fontSize: 9 }}>Balance</th>
                </tr></thead>
                <tbody>
                  {ledger.map(t => (
                    <tr key={t.id} style={{ borderTop: '1px solid var(--line-2)' }}>
                      <td style={{ padding: '3px 4px', color: 'var(--text-3)' }}>{fmtDate(t.created_at)}</td>
                      <td style={{ padding: '3px 4px', color: t.type === 'purchase' ? 'var(--ok,#3a3)' : 'var(--text-2)' }}>{t.type}</td>
                      <td style={{ padding: '3px 4px', color: 'var(--text-1)' }}>{money(t.amount_usd)}</td>
                      <td style={{ padding: '3px 4px', color: 'var(--text-3)' }}>{t.raw_cost_usd != null ? money(t.raw_cost_usd) : '—'}</td>
                      <td style={{ padding: '3px 4px', color: 'var(--text-3)' }}>{money(t.balance_after)}</td>
                    </tr>
                  ))}
                  {ledger.length === 0 && <tr><td colSpan={5} style={{ padding: 8, color: 'var(--text-3)', fontSize: 10 }}>No transactions.</td></tr>}
                </tbody>
              </table>
            </div>

            {/* Org-owned blueprints — oversight read-only (el super-admin NO los edita) */}
            <div style={box}>
              <span style={label}>Blueprints (org-owned · read-only)</span>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 11 }}>
                <thead><tr>
                  <th style={{ ...th, fontSize: 9 }}>Name</th><th style={{ ...th, fontSize: 9 }}>Key</th>
                  <th style={{ ...th, fontSize: 9 }}>Phase</th><th style={{ ...th, fontSize: 9 }}>Nodes</th>
                </tr></thead>
                <tbody>
                  {blueprints.map(b => (
                    <tr key={b.id} style={{ borderTop: '1px solid var(--line-2)' }}>
                      <td style={{ padding: '3px 4px', color: 'var(--text-0)' }}>{b.name}{b.is_default && <span style={{ color: 'var(--action)', fontSize: 9 }}> ·default</span>}</td>
                      <td style={{ padding: '3px 4px', color: 'var(--text-3)', fontSize: 10 }}>{b.blueprint_key}</td>
                      <td style={{ padding: '3px 4px', color: 'var(--text-2)' }}>{b.phase}</td>
                      <td style={{ padding: '3px 4px', color: 'var(--text-3)' }}>{b.node_sequence?.length ?? 0}</td>
                    </tr>
                  ))}
                  {blueprints.length === 0 && <tr><td colSpan={4} style={{ padding: 8, color: 'var(--text-3)', fontSize: 10 }}>This organization has no own blueprints (uses standard only).</td></tr>}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
