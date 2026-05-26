'use client'

import React, { useState, useCallback, useRef, useEffect } from 'react'
import type { Project } from '@/lib/types'
import type { PhaseNodeConfig } from '@/lib/api'
import { saveNodeDraft, approveNode } from '@/lib/api'

const ANIM = `
@keyframes hn-fadein { from{opacity:0;transform:translateY(6px)} to{opacity:1;transform:translateY(0)} }
`

const PLACEHOLDER = `Key decisions:\n\nRejected concepts:\n\nChosen direction:\n\nNext steps:`

interface Props {
  node:      PhaseNodeConfig
  project:   Project
  /** step_key del nodo cuyo output sirve de input a este nodo */
  sourceStepKey?: string
  onClose:   () => void
  onSaved:   () => void
}

export default function HumanNodeModal({ node, project, sourceStepKey, onClose, onSaved }: Props) {
  const pipeline    = (project.concept as Record<string, unknown>)?.pipeline as Record<string, Record<string, unknown>> | undefined
  const nodeData    = pipeline?.[node.step_key]
  const sourceData  = sourceStepKey ? pipeline?.[sourceStepKey] : undefined
  const sourceOutput = typeof sourceData?.output === 'string' ? sourceData.output : null

  const existingOutput = typeof nodeData?.output === 'string' ? nodeData.output : ''
  const isApproved     = nodeData?.approved === true

  const [notes,     setNotes]     = useState(existingOutput)
  const [saving,    setSaving]    = useState(false)
  const [approving, setApproving] = useState(false)
  const [saved,     setSaved]     = useState(false)
  const [approved,  setApproved]  = useState(isApproved)
  const [editing,   setEditing]   = useState(false)
  const [error,     setError]     = useState('')
  const [srcOpen,   setSrcOpen]   = useState(!!sourceOutput)

  const textareaRef  = useRef<HTMLTextAreaElement>(null)
  const savedTimeout = useRef<ReturnType<typeof setTimeout> | null>(null)

  const isLocked = approved && !editing

  useEffect(() => {
    if (!isLocked) textareaRef.current?.focus()
  }, [isLocked])

  const handleSave = useCallback(async () => {
    if (!notes.trim()) return
    setSaving(true)
    setError('')
    try {
      await saveNodeDraft(project.id, node.step_key, notes)
      setSaved(true)
      onSaved()
      if (savedTimeout.current) clearTimeout(savedTimeout.current)
      savedTimeout.current = setTimeout(() => setSaved(false), 2500)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Save failed')
    } finally {
      setSaving(false)
    }
  }, [project.id, node.step_key, notes, onSaved])

  const handleApprove = useCallback(async () => {
    if (!notes.trim()) { setError('Write your team notes before approving.'); return }
    setApproving(true)
    setError('')
    try {
      await saveNodeDraft(project.id, node.step_key, notes)
      await approveNode(project.id, node.step_key, { output: notes })
      setApproved(true)
      onSaved()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Approve failed')
    } finally {
      setApproving(false)
    }
  }, [project.id, node.step_key, notes, onSaved])

  const statusColor = approved ? '#2DD4BF' : notes.trim() ? '#FBBF24' : '#6b7280'
  const statusLabel = approved ? '✓ approved' : notes.trim() ? 'in progress' : 'pending'

  return (
    <div
      style={{
        position: 'fixed', inset: 0, zIndex: 80,
        background: 'rgba(0,0,0,0.55)', backdropFilter: 'blur(4px)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
      }}
      onClick={e => e.stopPropagation()}
    >
      <style>{ANIM}</style>

      <div style={{
        width: '92%', maxWidth: 680,
        maxHeight: '88vh',
        background: 'var(--bg-1)',
        border: '1px solid var(--line-2)',
        borderRadius: 16,
        display: 'flex', flexDirection: 'column',
        boxShadow: '0 24px 80px rgba(0,0,0,0.5)',
        overflow: 'hidden',
        animation: 'hn-fadein 200ms ease both',
      }}>

        {/* Franja superior de status */}
        <div style={{
          height: 3, flexShrink: 0,
          background: statusColor,
          transition: 'background 300ms',
        }} />

        {/* Header */}
        <div style={{
          flexShrink: 0,
          padding: '14px 20px',
          borderBottom: '1px solid var(--line-2)',
          display: 'flex', alignItems: 'center', gap: 10,
        }}>
          <span style={{ fontSize: 18, lineHeight: 1 }}>👤</span>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 13, fontWeight: 700, fontFamily: 'var(--font-mono)', color: 'var(--text-0)' }}>
              {node.label}
            </div>
            {node.description && (
              <div style={{ fontSize: 10, fontFamily: 'var(--font-mono)', color: 'var(--text-3)', marginTop: 2 }}>
                {node.description}
              </div>
            )}
          </div>

          <span style={{
            fontSize: 9, fontFamily: 'var(--font-mono)', fontWeight: 700,
            padding: '3px 9px', borderRadius: 99,
            background: `color-mix(in srgb, ${statusColor} 14%, var(--bg-2))`,
            color: statusColor, textTransform: 'uppercase', letterSpacing: '0.08em',
          }}>
            {statusLabel}
          </span>

          <button
            onClick={onClose}
            style={{
              border: 'none', background: 'var(--bg-3)', borderRadius: 6,
              color: 'var(--text-2)', cursor: 'pointer', padding: '5px 10px',
              fontSize: 12, fontFamily: 'var(--font-mono)',
            }}
          >
            ✕
          </button>
        </div>

        {/* Body */}
        <div style={{ flex: 1, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 0 }}>

          {/* Panel de fuente colapsable */}
          {sourceOutput && (
            <div style={{
              borderBottom: '1px solid var(--line-2)',
              background: 'var(--bg-0, var(--bg-2))',
            }}>
              <button
                onClick={() => setSrcOpen(o => !o)}
                style={{
                  width: '100%', border: 'none', background: 'transparent',
                  padding: '10px 20px', display: 'flex', alignItems: 'center', gap: 8,
                  cursor: 'pointer', textAlign: 'left',
                }}
              >
                <span style={{ fontSize: 10, fontFamily: 'var(--font-mono)', color: 'var(--text-3)' }}>
                  {srcOpen ? '▾' : '▸'}
                </span>
                <span style={{ fontSize: 10, fontFamily: 'var(--font-mono)', color: 'var(--text-3)', fontWeight: 600 }}>
                  Source input
                </span>
                <span style={{ fontSize: 9, fontFamily: 'var(--font-mono)', color: 'var(--text-4)' }}>
                  — review before writing notes
                </span>
              </button>

              {srcOpen && (
                <div style={{ padding: '0 20px 14px' }}>
                  <pre style={{
                    margin: 0, fontSize: 10, lineHeight: 1.7,
                    fontFamily: 'var(--font-mono)', color: 'var(--text-2)',
                    whiteSpace: 'pre-wrap', wordBreak: 'break-word',
                    maxHeight: 200, overflowY: 'auto',
                    background: 'var(--bg-1)',
                    border: '1px solid var(--line-2)',
                    borderRadius: 6, padding: '10px 12px',
                  }}>
                    {sourceOutput}
                  </pre>
                </div>
              )}
            </div>
          )}

          {/* Textarea de notas */}
          <div style={{ padding: '16px 20px', flex: 1, display: 'flex', flexDirection: 'column', gap: 8 }}>
            <div style={{ fontSize: 10, fontFamily: 'var(--font-mono)', color: 'var(--text-3)', fontWeight: 600 }}>
              Team discussion notes
            </div>
            <textarea
              ref={textareaRef}
              value={notes}
              onChange={e => setNotes(e.target.value)}
              disabled={isLocked}
              placeholder={PLACEHOLDER}
              style={{
                flex: 1, minHeight: 200,
                background: 'var(--bg-0, var(--bg-2))',
                border: `1px solid ${approved ? 'var(--line-2)' : 'color-mix(in srgb, #2DD4BF 25%, var(--line-2))'}`,
                borderRadius: 8,
                color: 'var(--text-1)', fontSize: 12,
                fontFamily: 'var(--font-mono)', lineHeight: 1.7,
                padding: '12px 14px', resize: 'vertical',
                outline: 'none', transition: 'border-color 150ms',
                opacity: isLocked ? 0.65 : 1,
              }}
              onFocus={e => { if (!approved) e.target.style.borderColor = '#2DD4BF' }}
              onBlur={e  => { e.target.style.borderColor = approved ? 'var(--line-2)' : 'color-mix(in srgb, #2DD4BF 25%, var(--line-2))' }}
            />

            {approved && !editing && (
              <div style={{
                display: 'flex', alignItems: 'center', gap: 10,
                fontSize: 10, fontFamily: 'var(--font-mono)', color: '#2DD4BF',
                padding: '8px 12px', borderRadius: 6,
                background: 'color-mix(in srgb, #2DD4BF 8%, var(--bg-2))',
                border: '1px solid color-mix(in srgb, #2DD4BF 20%, var(--line-2))',
              }}>
                <span style={{ flex: 1 }}>✓ Approved — notes are locked.</span>
                <button
                  onClick={() => setEditing(true)}
                  style={{
                    border: '1px solid color-mix(in srgb, #2DD4BF 40%, var(--line-2))',
                    background: 'transparent', color: '#2DD4BF',
                    fontSize: 10, fontFamily: 'var(--font-mono)',
                    padding: '3px 10px', borderRadius: 5, cursor: 'pointer',
                  }}
                >
                  Edit & re-approve
                </button>
              </div>
            )}
          </div>
        </div>

        {/* Footer */}
        <div style={{
          flexShrink: 0,
          padding: '12px 20px',
          borderTop: '1px solid var(--line-2)',
          display: 'flex', alignItems: 'center', gap: 8,
          background: 'var(--bg-1)',
        }}>
          {error && (
            <span style={{ fontSize: 10, fontFamily: 'var(--font-mono)', color: '#F87171', flex: 1 }}>
              {error}
            </span>
          )}
          <div style={{ flex: 1 }} />

          {(!approved || editing) && (
            <button
              onClick={handleSave}
              disabled={saving || !notes.trim()}
              style={{
                padding: '7px 14px', borderRadius: 7,
                border: '1px solid var(--line-2)',
                background: saved ? 'color-mix(in srgb, #2DD4BF 12%, var(--bg-2))' : 'var(--bg-2)',
                color: saved ? '#2DD4BF' : 'var(--text-1)',
                fontSize: 11, fontFamily: 'var(--font-mono)', cursor: saving || !notes.trim() ? 'not-allowed' : 'pointer',
                opacity: !notes.trim() ? 0.4 : 1,
                transition: 'background 200ms, color 200ms',
              }}
            >
              {saving ? 'Saving…' : saved ? '✓ Saved' : 'Save draft'}
            </button>
          )}

          <button
            onClick={isLocked ? onClose : handleApprove}
            disabled={approving}
            style={{
              padding: '7px 16px', borderRadius: 7,
              border: 'none',
              background: isLocked ? 'var(--bg-3)' : 'var(--action)',
              color: isLocked ? 'var(--text-2)' : 'var(--action-fg)',
              fontSize: 11, fontFamily: 'var(--font-mono)', fontWeight: 700,
              cursor: approving ? 'not-allowed' : 'pointer',
              opacity: approving ? 0.6 : 1,
            }}
          >
            {approving ? 'Approving…' : isLocked ? 'Close' : editing ? 'Re-approve' : 'Approve'}
          </button>
        </div>
      </div>
    </div>
  )
}
