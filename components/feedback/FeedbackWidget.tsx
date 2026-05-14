'use client'

import { useState, useRef, useEffect } from 'react'
import { useAuth } from '@/lib/auth-context'
import { getMemberByAuth, submitFeedback, BACKEND_URL } from '@/lib/api'
import type { FeedbackCategory, FeedbackSeverity } from '@/lib/types'

const CATEGORIES: { value: FeedbackCategory; label: string; color: string }[] = [
  { value: 'bug',         label: 'Bug',         color: 'var(--cat-output)' },
  { value: 'usability',   label: 'Usability',   color: 'var(--cat-design)' },
  { value: 'performance', label: 'Performance', color: 'var(--cat-audio)'  },
  { value: 'suggestion',  label: 'Suggestion',  color: 'var(--cat-code)'   },
]

const SEVERITIES: { value: FeedbackSeverity; label: string }[] = [
  { value: 'low',    label: 'Low'    },
  { value: 'medium', label: 'Medium' },
  { value: 'high',   label: 'High'   },
]

function extractProjectId(): string | undefined {
  if (typeof window === 'undefined') return undefined
  const match = window.location.pathname.match(/\/projects\/([^/]+)/)
  return match?.[1]
}

export default function FeedbackWidget() {
  const { user } = useAuth()
  const [open, setOpen]             = useState(false)
  const [category, setCategory]     = useState<FeedbackCategory>('bug')
  const [severity, setSeverity]     = useState<FeedbackSeverity>('medium')
  const [description, setDesc]      = useState('')
  const [screenshot, setScreenshot] = useState<File | null>(null)
  const [screenshotPreview, setPreview] = useState<string | null>(null)
  const [sending, setSending]       = useState(false)
  const [sent, setSent]             = useState(false)
  const [memberId, setMemberId]     = useState<string | null>(null)
  const pasteAreaRef                = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (user?.id) getMemberByAuth(user.id).then(m => setMemberId(m?.id ?? null))
  }, [user?.id])

  // Listen for paste anywhere in the modal
  useEffect(() => {
    if (!open) return
    function onPaste(e: ClipboardEvent) {
      const items = e.clipboardData?.items
      if (!items) return
      for (const item of Array.from(items)) {
        if (item.type.startsWith('image/')) {
          const file = item.getAsFile()
          if (!file) continue
          setScreenshot(file)
          setPreview(URL.createObjectURL(file))
          break
        }
      }
    }
    window.addEventListener('paste', onPaste)
    return () => window.removeEventListener('paste', onPaste)
  }, [open])

  function handleClose() {
    setOpen(false)
    setDesc('')
    setCategory('bug')
    setSeverity('medium')
    setScreenshot(null)
    setPreview(null)
    setSent(false)
  }

  async function uploadScreenshot(file: File): Promise<string | undefined> {
    try {
      const b64 = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader()
        reader.onload = () => resolve((reader.result as string).split(',')[1])
        reader.onerror = reject
        reader.readAsDataURL(file)
      })
      const res = await fetch(`${BACKEND_URL}/api/feedback/upload-screenshot`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ data: b64, mimeType: file.type || 'image/png' }),
      })
      const json = await res.json()
      if (!json.success) { console.warn('Screenshot upload failed:', json.error); return undefined }
      return json.url
    } catch (e) {
      console.warn('Screenshot upload failed:', e)
      return undefined
    }
  }

  async function handleSubmit() {
    if (!description.trim()) return
    setSending(true)
    try {
      let screenshot_url: string | undefined
      if (screenshot) screenshot_url = await uploadScreenshot(screenshot)

      await submitFeedback({
        member_id: memberId ?? undefined,
        project_id: extractProjectId(),
        category,
        severity,
        description: description.trim(),
        url_context: typeof window !== 'undefined' ? window.location.href : undefined,
        screenshot_url,
      })
      setSent(true)
      setTimeout(handleClose, 2000)
    } catch (e) {
      console.error(e)
    } finally {
      setSending(false)
    }
  }

  if (!user) return null

  return (
    <>
      {/* Floating button — esquina inferior izquierda para no solapar el inspector */}
      <button
        onClick={() => setOpen(true)}
        title="Send feedback"
        style={{
          position: 'fixed', bottom: 24, left: 24, zIndex: 900,
          background: 'var(--bg-3)', border: '1px solid var(--line-2)',
          borderRadius: 99, padding: '7px 14px',
          fontSize: 11, fontFamily: 'monospace', color: 'var(--text-2)',
          cursor: 'pointer', boxShadow: '0 4px 16px rgba(0,0,0,0.3)',
          display: 'flex', alignItems: 'center', gap: 6,
          transition: 'all 120ms',
        }}
        onMouseEnter={e => { (e.currentTarget as HTMLButtonElement).style.borderColor = 'var(--cat-design)'; (e.currentTarget as HTMLButtonElement).style.color = 'var(--cat-design)' }}
        onMouseLeave={e => { (e.currentTarget as HTMLButtonElement).style.borderColor = 'var(--line-2)'; (e.currentTarget as HTMLButtonElement).style.color = 'var(--text-2)' }}
      >
        <span style={{ fontSize: 13 }}>◎</span> Feedback
      </button>

      {/* Modal */}
      {open && (
        <div
          style={{ position: 'fixed', inset: 0, zIndex: 1000, display: 'flex', alignItems: 'flex-end', justifyContent: 'flex-start', padding: 24, pointerEvents: 'none' }}
        >
          <div style={{ pointerEvents: 'all', background: 'var(--bg-1)', border: '1px solid var(--line-2)', borderRadius: 12, width: 360, boxShadow: '0 8px 40px rgba(0,0,0,0.5)', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>

            {/* Header */}
            <div style={{ padding: '14px 16px', borderBottom: '1px solid var(--line-2)', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-0)' }}>Send feedback</span>
              <button onClick={handleClose} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-3)', fontSize: 16, lineHeight: 1, padding: 2 }}>✕</button>
            </div>

            {sent ? (
              <div style={{ padding: 32, textAlign: 'center' }}>
                <div style={{ fontSize: 28, marginBottom: 8 }}>✓</div>
                <div style={{ fontSize: 12, color: 'var(--cat-code)', fontFamily: 'monospace' }}>Feedback sent</div>
              </div>
            ) : (
              <div style={{ padding: 16, display: 'flex', flexDirection: 'column', gap: 12 }}>

                {/* Category */}
                <div style={{ display: 'flex', gap: 6 }}>
                  {CATEGORIES.map(c => (
                    <button key={c.value} onClick={() => setCategory(c.value)} style={{
                      flex: 1, padding: '5px 0', borderRadius: 6, border: `1px solid ${category === c.value ? c.color : 'var(--line-2)'}`,
                      background: category === c.value ? `color-mix(in srgb, ${c.color} 15%, transparent)` : 'var(--bg-2)',
                      color: category === c.value ? c.color : 'var(--text-3)',
                      fontSize: 9, fontFamily: 'monospace', cursor: 'pointer', textTransform: 'uppercase', letterSpacing: '0.05em',
                    }}>{c.label}</button>
                  ))}
                </div>

                {/* Severity */}
                <div style={{ display: 'flex', gap: 6 }}>
                  {SEVERITIES.map(s => (
                    <button key={s.value} onClick={() => setSeverity(s.value)} style={{
                      flex: 1, padding: '5px 0', borderRadius: 6,
                      border: `1px solid ${severity === s.value ? 'var(--text-2)' : 'var(--line-2)'}`,
                      background: severity === s.value ? 'var(--bg-4)' : 'var(--bg-2)',
                      color: severity === s.value ? 'var(--text-0)' : 'var(--text-3)',
                      fontSize: 9, fontFamily: 'monospace', cursor: 'pointer', textTransform: 'uppercase', letterSpacing: '0.05em',
                    }}>{s.label}</button>
                  ))}
                </div>

                {/* Description */}
                <textarea
                  value={description}
                  onChange={e => setDesc(e.target.value)}
                  placeholder="Describe the issue or suggestion..."
                  rows={4}
                  style={{
                    background: 'var(--bg-2)', border: '1px solid var(--line-2)', borderRadius: 6,
                    padding: '8px 10px', fontSize: 12, color: 'var(--text-0)',
                    resize: 'vertical', outline: 'none', fontFamily: 'inherit', lineHeight: 1.5,
                  }}
                />

                {/* Screenshot paste area */}
                <div
                  ref={pasteAreaRef}
                  style={{
                    border: `1px dashed ${screenshotPreview ? 'var(--cat-code)' : 'var(--line-2)'}`,
                    borderRadius: 6, padding: screenshotPreview ? 0 : '10px 12px',
                    background: 'var(--bg-2)', overflow: 'hidden', cursor: 'default',
                  }}
                >
                  {screenshotPreview ? (
                    <div style={{ position: 'relative' }}>
                      <img src={screenshotPreview} alt="screenshot" style={{ width: '100%', display: 'block', borderRadius: 6, maxHeight: 160, objectFit: 'cover' }} />
                      <button
                        onClick={() => { setScreenshot(null); setPreview(null) }}
                        style={{ position: 'absolute', top: 6, right: 6, background: 'rgba(0,0,0,0.6)', border: 'none', borderRadius: 99, color: '#fff', fontSize: 11, cursor: 'pointer', padding: '2px 7px' }}
                      >✕</button>
                    </div>
                  ) : (
                    <p style={{ fontSize: 10, fontFamily: 'monospace', color: 'var(--text-3)', margin: 0, textAlign: 'center' }}>
                      Paste a screenshot here <span style={{ opacity: 0.5 }}>Ctrl+V</span>
                    </p>
                  )}
                </div>

                {/* Submit */}
                <button
                  onClick={handleSubmit}
                  disabled={!description.trim() || sending}
                  style={{
                    padding: '9px', borderRadius: 6, border: 'none',
                    background: description.trim() ? 'var(--action)' : 'var(--bg-4)',
                    color: description.trim() ? 'var(--action-fg)' : 'var(--text-3)',
                    fontSize: 12, fontWeight: 600, cursor: description.trim() ? 'pointer' : 'not-allowed',
                    transition: 'all 120ms',
                  }}
                >
                  {sending ? 'Sending...' : 'Send feedback'}
                </button>
              </div>
            )}
          </div>
        </div>
      )}
    </>
  )
}
