'use client'

import { useEffect, useState, useCallback } from 'react'
import Link from 'next/link'
import { BACKEND_URL, authHeaders } from '@/lib/api'
import { BlueprintForm, EMPTY_BP, type ForgeNode, type ForgeBlueprint, type NodeSequenceItem, type Edge, type Gate } from '@/components/BlueprintForm'

// Pega a /api/org/* (detrás de requireAuth + requireOrgAdmin) con el token Bearer del usuario
async function orgFetch(path: string, opts?: RequestInit) {
  const auth = await authHeaders()
  return fetch(`${BACKEND_URL}${path}`, {
    ...opts,
    headers: { 'Content-Type': 'application/json', ...auth, ...(opts?.headers as Record<string, string> || {}) },
  })
}

interface Credit { balance: number; last_topup_usd: number; alert: 'low' | 'depleted' | null }
interface Tx { id: string; type: string; amount_usd: number; balance_after: number | null; created_at: string }
interface OrgMember { org_member_id: string; member_id: string; org_role: string; display_name: string | null; email: string | null }
interface OrgBlueprint {
  id: string; blueprint_key: string; name: string; phase: string; description: string | null
  is_default?: boolean; node_sequence?: NodeSequenceItem[]; edges?: Edge[]; gate?: Gate
  standard: boolean; editable: boolean
}
// Confirmación in-app para acciones destructivas/financieras (deletes, degradar owner, comprar créditos)
type ConfirmOpts = { title: string; body: string; confirmLabel: string; danger?: boolean; onConfirm: () => void | Promise<void>; onCancel?: () => void }

const money = (v: number | null | undefined) => '$' + Number(v ?? 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
const fmtDate = (iso: string) => new Date(iso).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })

const box: React.CSSProperties = { background: 'var(--bg-1)', border: '1px solid var(--line-2)', borderRadius: 8, padding: 16 }
const inp: React.CSSProperties = { background: 'var(--bg-0)', border: '1px solid var(--line-2)', borderRadius: 5, padding: '5px 8px', fontSize: 12, color: 'var(--text-0)', fontFamily: 'inherit' }
const btn: React.CSSProperties = { background: 'var(--action)', color: '#fff', border: 'none', borderRadius: 5, padding: '5px 12px', fontSize: 12, cursor: 'pointer', fontWeight: 600 }
const btnGhost: React.CSSProperties = { background: 'transparent', color: 'var(--text-3)', border: '1px solid var(--line-2)', borderRadius: 5, padding: '3px 8px', fontSize: 10, cursor: 'pointer' }
const btnDanger: React.CSSProperties = { background: 'var(--danger,#b3261e)', color: '#fff', border: 'none', borderRadius: 5, padding: '5px 12px', fontSize: 12, cursor: 'pointer', fontWeight: 600 }
// Acción destructiva discreta pero legible como peligro (P2: la jerarquía debe seguir el riesgo)
const btnGhostDanger: React.CSSProperties = { background: 'transparent', color: 'var(--danger,#b3261e)', border: '1px solid color-mix(in srgb, var(--danger,#b3261e) 45%, var(--line-2))', borderRadius: 5, padding: '3px 8px', fontSize: 10, cursor: 'pointer' }
const label: React.CSSProperties = { fontSize: 10, color: 'var(--text-2)', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 3, display: 'block' }
const th: React.CSSProperties = { padding: '4px 6px', color: 'var(--text-2)', fontSize: 10, textTransform: 'uppercase', textAlign: 'left', fontWeight: 400 }
const h2: React.CSSProperties = { fontSize: 13, color: 'var(--text-0)', fontWeight: 700, margin: '0 0 12px', textTransform: 'uppercase', letterSpacing: '0.06em' }

export default function OrgAdminPage() {
  const [denied, setDenied] = useState(false)
  const [credit, setCredit] = useState<Credit | null>(null)
  const [ledger, setLedger] = useState<Tx[]>([])
  const [members, setMembers] = useState<OrgMember[]>([])
  const [blueprints, setBlueprints] = useState<OrgBlueprint[]>([])
  const [catalog, setCatalog] = useState<ForgeNode[]>([])
  const [bpEditing, setBpEditing] = useState<Partial<ForgeBlueprint> | null>(null)
  const [msg, setMsg] = useState<{ text: string; type: 'ok' | 'error' } | null>(null)
  // Éxito: breve y se va solo. Error: persiste hasta descartarlo, para no perder el detalle en un parpadeo.
  const flash = (text: string, type: 'ok' | 'error' = 'ok') => {
    setMsg({ text, type })
    if (type === 'ok') setTimeout(() => setMsg(m => (m?.text === text ? null : m)), 3000)
  }

  const [nm, setNm] = useState({ email: '', password: '', display_name: '', org_role: 'member' })
  const [nmTried, setNmTried] = useState(false)  // marca los campos requeridos vacíos tras intentar
  const [buyAmount, setBuyAmount] = useState('')
  const [confirmState, setConfirmState] = useState<ConfirmOpts | null>(null)
  const [busy, setBusy] = useState(false)  // evita doble-checkout mientras se crea la sesión de pago
  const askConfirm = (o: ConfirmOpts) => setConfirmState(o)
  const closeConfirm = () => { confirmState?.onCancel?.(); setConfirmState(null) }

  const loadAll = useCallback(async () => {
    const cr = await orgFetch('/api/org/credit')
    if (cr.status === 403) { setDenied(true); return }
    const cd = await cr.json(); if (cd.success) setCredit(cd)
    const [lg, mb, blp, nd] = await Promise.all([orgFetch('/api/org/ledger'), orgFetch('/api/org/members'), orgFetch('/api/org/blueprints'), orgFetch('/api/org/nodes')])
    const [ld, md, bd, ndd] = await Promise.all([lg.json(), mb.json(), blp.json(), nd.json()])
    if (ld.success) setLedger(ld.transactions)
    if (md.success) setMembers(md.members)
    if (bd.success) setBlueprints(bd.blueprints)
    if (ndd.success) setCatalog(ndd.nodes)
  }, [])
  useEffect(() => { loadAll() }, [loadAll])

  // Retorno de la pasarela: los créditos llegan por webhook, así que refrescamos con un pequeño delay
  useEffect(() => {
    if (typeof window === 'undefined') return
    const p = new URLSearchParams(window.location.search)
    if (p.get('paid')) { flash('Payment received — credits will appear shortly.'); setTimeout(() => loadAll(), 2500); window.history.replaceState({}, '', '/org') }
    else if (p.get('canceled')) { flash('Payment canceled.'); window.history.replaceState({}, '', '/org') }
  }, [loadAll])

  // Escape cierra (cancela) el diálogo de confirmación
  useEffect(() => {
    if (!confirmState) return
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') { confirmState.onCancel?.(); setConfirmState(null) } }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [confirmState])

  function buyCredits() {
    if (!buyAmount || Number(buyAmount) <= 0) { flash('Enter an amount greater than 0.', 'error'); return }
    const amount = Number(buyAmount)
    // Readback del monto en NUESTRA superficie antes de mandar al usuario (y su plata) a la pasarela
    askConfirm({
      title: 'Confirm purchase',
      body: `Load ${money(amount)} of credit to your organization? You'll be taken to the payment provider to complete the purchase.`,
      confirmLabel: 'Continue to payment',
      onConfirm: async () => {
        if (busy) return
        setBusy(true)
        const r = await orgFetch('/api/org/credits/checkout', { method: 'POST', body: JSON.stringify({ amount_usd: amount }) })
        const d = await r.json()
        if (d.success && d.url) window.location.href = d.url  // redirige a la pasarela
        else { setBusy(false); flash(d.error || 'Something went wrong. Try again.', 'error') }
      },
    })
  }

  async function addMember() {
    if (!nm.email || !nm.password || !nm.display_name) {
      setNmTried(true)
      flash('Email, name and password are all required.', 'error')
      return
    }
    const r = await orgFetch('/api/org/members', { method: 'POST', body: JSON.stringify(nm) })
    const d = await r.json()
    if (d.success) { setNm({ email: '', password: '', display_name: '', org_role: 'member' }); setNmTried(false); flash('User added.') }
    else flash(d.error || 'Something went wrong. Try again.', 'error')
    if (d.success) loadAll()
  }
  function changeRole(m: OrgMember, org_role: string) {
    if (org_role === m.org_role) return
    const revert = () => setMembers(ms => [...ms])  // fuerza al <select> controlado a volver al rol real
    // No dejar la organización sin owner: bloquear degradar al único owner
    const owners = members.filter(x => x.org_role === 'owner')
    if (m.org_role === 'owner' && org_role !== 'owner' && owners.length <= 1) {
      flash('Assign another owner first — an organization must keep at least one owner.', 'error')
      revert(); return
    }
    const myId = typeof window !== 'undefined' ? localStorage.getItem('forge_member_id') : null
    const selfLosingAccess = m.member_id === myId && (m.org_role === 'owner' || m.org_role === 'admin') && (org_role === 'member' || org_role === 'viewer')
    const apply = async () => {
      const r = await orgFetch(`/api/org/members/${m.member_id}`, { method: 'PATCH', body: JSON.stringify({ org_role }) })
      const d = await r.json(); if (d.success) loadAll(); else { flash(d.error || 'Something went wrong. Try again.', 'error'); revert() }
    }
    if (selfLosingAccess) {
      askConfirm({
        title: 'Change your own role?',
        body: `You're about to set your own role to "${org_role}". You'll lose access to this admin page, and you can't undo it from here.`,
        confirmLabel: 'Change my role', danger: true, onConfirm: apply, onCancel: revert,
      })
    } else apply()
  }
  function removeMember(m: OrgMember) {
    const name = m.display_name || m.email || 'this member'
    askConfirm({
      title: 'Remove member',
      body: `Remove ${name} from your organization? They'll lose access to it. This can't be undone.`,
      confirmLabel: 'Remove', danger: true,
      onConfirm: async () => {
        const r = await orgFetch(`/api/org/members/${m.member_id}`, { method: 'DELETE' })
        const d = await r.json(); if (d.success) { flash('Member removed.'); loadAll() } else flash(d.error || 'Something went wrong. Try again.', 'error')
      },
    })
  }
  // Guardar blueprint desde el modal (crea o edita el propio)
  async function saveBp(data: Partial<ForgeBlueprint>) {
    const isNew = !data.id
    const r = await orgFetch(isNew ? '/api/org/blueprints' : `/api/org/blueprints/${data.id}`, { method: isNew ? 'POST' : 'PATCH', body: JSON.stringify(data) })
    const d = await r.json()
    if (!d.success) throw new Error(d.error)
    setBpEditing(null); flash(isNew ? 'Blueprint created.' : 'Blueprint updated.'); loadAll()
  }
  function deleteBlueprint(b: OrgBlueprint) {
    askConfirm({
      title: 'Delete blueprint',
      body: `Delete blueprint "${b.name}"? This can't be undone.`,
      confirmLabel: 'Delete', danger: true,
      onConfirm: async () => {
        const r = await orgFetch(`/api/org/blueprints/${b.id}`, { method: 'DELETE' })
        const d = await r.json(); if (d.success) { flash('Blueprint deleted.'); loadAll() } else flash(d.error || 'Something went wrong. Try again.', 'error')
      },
    })
  }

  if (denied) return (
    <div style={{ padding: 40, fontFamily: 'monospace', color: 'var(--text-2)' }}>
      You are not an organization admin. <Link href="/" style={{ color: 'var(--action)' }}>Back to projects</Link>
    </div>
  )

  return (
    <div style={{ minHeight: '100vh', background: 'var(--bg-0)', fontFamily: 'monospace' }}>
      {/* Top bar */}
      <div style={{ height: 44, padding: '0 16px', borderBottom: '1px solid var(--line-2)', background: 'var(--bg-1)', display: 'flex', alignItems: 'center', gap: 14 }}>
        <Link href="/" className="forge-logo" style={{ display: 'flex', alignItems: 'center', gap: 6, textDecoration: 'none' }}>
          <img src="/forgy/forgyi.png" alt="Forge" width={18} height={18} style={{ objectFit: 'contain' }} />
          <span style={{ fontSize: 13, color: 'var(--text-0)' }}>Forge</span>
        </Link>
        <div style={{ width: 1, height: 16, background: 'var(--line-2)' }} />
        <span style={{ fontSize: 11, color: 'var(--text-2)', fontWeight: 600, letterSpacing: '0.06em', textTransform: 'uppercase' }}>My Organization</span>
        <div style={{ flex: 1 }} />
        {msg && (
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 11, color: msg.type === 'error' ? 'var(--danger,#b3261e)' : 'var(--ok,#3a3)' }}>
            {msg.type === 'error' ? '⚠ ' : '✓ '}{msg.text}
            {msg.type === 'error' && (
              <button onClick={() => setMsg(null)} title="Dismiss" aria-label="Dismiss"
                style={{ background: 'none', border: 'none', color: 'inherit', cursor: 'pointer', fontSize: 13, lineHeight: 1, padding: 0 }}>×</button>
            )}
          </span>
        )}
        <Link href="/" style={{ fontSize: 11, color: 'var(--text-3)', textDecoration: 'none' }}>← Projects</Link>
      </div>

      <div style={{ maxWidth: 1000, margin: '0 auto', padding: 24, display: 'flex', flexDirection: 'column', gap: 20 }}>

        {/* Alert banner */}
        {credit?.alert && (
          <div style={{ ...box, borderColor: credit.alert === 'depleted' ? 'var(--danger,#b3261e)' : 'var(--warn,#a6720a)', display: 'flex', alignItems: 'center', gap: 10 }}>
            <span style={{ color: credit.alert === 'depleted' ? 'var(--danger,#b3261e)' : 'var(--warn,#a6720a)', fontSize: 12 }}>
              {credit.alert === 'depleted'
                ? '⚠ Your credit is depleted — runs are blocked until you top up.'
                : '⚠ Low credit — you have 10% or less of your loaded credit remaining.'}
            </span>
          </div>
        )}

        {/* Credit */}
        <div style={box}>
          <h2 style={h2}>Credit & consumption</h2>
          <div style={{ display: 'flex', gap: 40, marginBottom: 14, alignItems: 'flex-end' }}>
            <div><span style={label}>Balance (remaining)</span><div style={{ fontSize: 22, color: 'var(--text-0)', fontWeight: 700 }}>{money(credit?.balance)}</div></div>
            <div><span style={label}>Credit loaded</span><div style={{ fontSize: 22, color: 'var(--text-2)' }}>{money(credit?.last_topup_usd)}</div></div>
            <div style={{ flex: 1 }} />
            <div>
              <span style={label}>Buy credits (USD)</span>
              <div style={{ display: 'flex', gap: 8 }}>
                <input style={{ ...inp, width: 100 }} value={buyAmount} onChange={e => setBuyAmount(e.target.value)} placeholder="100" />
                <button style={btn} onClick={buyCredits}>Buy credits</button>
              </div>
            </div>
          </div>
          <span style={label}>Recent activity</span>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 11 }}>
            <thead><tr><th style={th}>Date</th><th style={th}>Type</th><th style={th}>Amount</th><th style={th}>Balance</th></tr></thead>
            <tbody>
              {ledger.map(t => (
                <tr key={t.id} style={{ borderTop: '1px solid var(--line-2)' }}>
                  <td style={{ padding: '3px 6px', color: 'var(--text-3)' }}>{fmtDate(t.created_at)}</td>
                  <td style={{ padding: '3px 6px', color: t.type === 'purchase' ? 'var(--ok,#3a3)' : 'var(--text-2)', textTransform: 'capitalize' }}>{t.type}</td>
                  <td style={{ padding: '3px 6px', color: 'var(--text-1)' }}>{money(t.amount_usd)}</td>
                  <td style={{ padding: '3px 6px', color: 'var(--text-3)' }}>{money(t.balance_after)}</td>
                </tr>
              ))}
              {ledger.length === 0 && <tr><td colSpan={4} style={{ padding: 8, color: 'var(--text-3)', fontSize: 10 }}>No activity yet.</td></tr>}
            </tbody>
          </table>
        </div>

        {/* Members */}
        <div style={box}>
          <h2 style={h2}>Members</h2>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12, marginBottom: 12 }}>
            <thead><tr><th style={th}>Name</th><th style={th}>Email</th><th style={th}>Role</th><th style={th}></th></tr></thead>
            <tbody>
              {members.map(m => (
                <tr key={m.member_id} style={{ borderTop: '1px solid var(--line-2)' }}>
                  <td style={{ padding: '5px 6px', color: 'var(--text-0)' }}>{m.display_name || '—'}</td>
                  <td style={{ padding: '5px 6px', color: 'var(--text-2)' }}>{m.email || '—'}</td>
                  <td style={{ padding: '5px 6px' }}>
                    <select value={m.org_role} onChange={e => changeRole(m, e.target.value)} style={{ ...inp, padding: '2px 4px', fontSize: 11 }}>
                      {['owner', 'admin', 'member', 'viewer'].map(r => <option key={r} value={r}>{r}</option>)}
                    </select>
                  </td>
                  <td style={{ padding: '5px 6px', textAlign: 'right' }}><button style={btnGhostDanger} onClick={() => removeMember(m)}>Remove</button></td>
                </tr>
              ))}
            </tbody>
          </table>
          <span style={label}>Add a user to your organization</span>
          <p style={{ fontSize: 10, color: 'var(--text-3)', margin: '0 0 6px' }}>You set an initial password; the user can change it later. All fields required.</p>
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
            <input style={{ ...inp, width: 180, ...(nmTried && !nm.email ? { borderColor: 'var(--danger,#b3261e)' } : {}) }} value={nm.email} onChange={e => setNm({ ...nm, email: e.target.value })} placeholder="email" autoComplete="off" name="new-user-email" />
            <input style={{ ...inp, width: 140, ...(nmTried && !nm.display_name ? { borderColor: 'var(--danger,#b3261e)' } : {}) }} value={nm.display_name} onChange={e => setNm({ ...nm, display_name: e.target.value })} placeholder="name" autoComplete="off" name="new-user-name" />
            <input style={{ ...inp, width: 120, ...(nmTried && !nm.password ? { borderColor: 'var(--danger,#b3261e)' } : {}) }} type="password" value={nm.password} onChange={e => setNm({ ...nm, password: e.target.value })} placeholder="password" autoComplete="new-password" name="new-user-password" />
            <select value={nm.org_role} onChange={e => setNm({ ...nm, org_role: e.target.value })} style={{ ...inp, fontSize: 11 }}>
              {['admin', 'member', 'viewer'].map(r => <option key={r} value={r}>{r}</option>)}
            </select>
            <button style={btn} onClick={addMember}>Add user</button>
          </div>
        </div>

        {/* Blueprints */}
        <div style={box}>
          <div style={{ display: 'flex', alignItems: 'center', marginBottom: 8 }}>
            <h2 style={{ ...h2, margin: 0, flex: 1 }}>Blueprints</h2>
            <button style={btn} onClick={() => setBpEditing({ ...EMPTY_BP })}>+ New blueprint</button>
          </div>
          <p style={{ fontSize: 11, color: 'var(--text-3)', margin: '0 0 10px' }}>Standard blueprints (by V57) are read-only. Click your own to edit.</p>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
            <thead><tr><th style={th}>Name</th><th style={th}>Key</th><th style={th}>Phase</th><th style={th}>Source</th><th style={th}></th></tr></thead>
            <tbody>
              {blueprints.map(b => (
                <tr key={b.id} onClick={() => b.editable && setBpEditing(b as Partial<ForgeBlueprint>)}
                  style={{ borderTop: '1px solid var(--line-2)', cursor: b.editable ? 'pointer' : 'default' }}>
                  <td style={{ padding: '5px 6px', color: 'var(--text-0)' }}>{b.name}</td>
                  <td style={{ padding: '5px 6px', color: 'var(--text-3)', fontSize: 10 }}>{b.blueprint_key}</td>
                  <td style={{ padding: '5px 6px', color: 'var(--text-2)' }}>{b.phase}</td>
                  <td style={{ padding: '5px 6px' }}><span style={{ fontSize: 10, color: b.standard ? 'var(--text-3)' : 'var(--action)' }}>{b.standard ? 'standard' : 'own'}</span></td>
                  <td style={{ padding: '5px 6px', textAlign: 'right' }}>{b.editable && <button style={btnGhostDanger} onClick={e => { e.stopPropagation(); deleteBlueprint(b) }}>Delete</button>}</td>
                </tr>
              ))}
              {blueprints.length === 0 && <tr><td colSpan={5} style={{ padding: 8, color: 'var(--text-3)', fontSize: 10 }}>No blueprints.</td></tr>}
            </tbody>
          </table>
        </div>

      </div>

      {/* Blueprint editor modal (mismo builder que el BMS super-admin) */}
      {bpEditing && (
        <div onClick={() => setBpEditing(null)}
          style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)', zIndex: 300, display: 'flex', alignItems: 'flex-start', justifyContent: 'center', padding: 24, overflow: 'auto' }}>
          <div onClick={e => e.stopPropagation()}
            style={{ width: '100%', maxWidth: 920, background: 'var(--bg-2)', border: '1px solid var(--line-2)', borderRadius: 10, padding: 24, margin: 'auto' }}>
            <div style={{ fontSize: 13, fontFamily: 'var(--font-mono)', fontWeight: 700, color: 'var(--text-1)', marginBottom: 20 }}>
              {bpEditing.id ? `Edit — ${bpEditing.name}` : 'New Blueprint'}
            </div>
            <BlueprintForm blueprint={bpEditing} allNodes={catalog} onSave={saveBp} onCancel={() => setBpEditing(null)} />
          </div>
        </div>
      )}

      {/* Diálogo de confirmación (deletes, auto-degradación, compra de créditos) */}
      {confirmState && (
        <div role="dialog" aria-modal="true" onClick={closeConfirm}
          style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)', zIndex: 400, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24 }}>
          <style>{`@keyframes org-confirm-in{from{opacity:0;transform:translateY(6px) scale(.98)}to{opacity:1;transform:none}} .org-confirm{animation:org-confirm-in .16s cubic-bezier(.2,.8,.2,1)}`}</style>
          <div className="org-confirm" onClick={e => e.stopPropagation()}
            style={{ width: '100%', maxWidth: 400, background: 'var(--bg-2)', border: '1px solid var(--line-2)', borderRadius: 10, padding: 20, boxShadow: '0 12px 40px rgba(0,0,0,0.45)' }}>
            <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--text-0)', marginBottom: 8 }}>{confirmState.title}</div>
            <div style={{ fontSize: 12, color: 'var(--text-1)', lineHeight: 1.5, marginBottom: 18 }}>{confirmState.body}</div>
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
              <button style={{ ...btnGhost, padding: '6px 12px', fontSize: 12 }} onClick={closeConfirm}>Cancel</button>
              <button autoFocus style={confirmState.danger ? btnDanger : btn}
                onClick={() => { const o = confirmState; setConfirmState(null); o.onConfirm() }}>
                {confirmState.confirmLabel}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
