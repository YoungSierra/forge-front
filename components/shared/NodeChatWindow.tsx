'use client'

import { useState, useRef, useEffect, useCallback } from 'react'
import { chatWithNode } from '@/lib/api'
import type { ChatMessage } from '@/lib/api'
import type { Project } from '@/lib/types'

const KEYFRAMES = `
  @keyframes chat-dot { 0%,80%,100%{opacity:.2;transform:scale(0.8)} 40%{opacity:1;transform:scale(1)} }
`

const WINDOW_W = 400
const WINDOW_H = 560

// ─── Typing dots ──────────────────────────────────────────────────────────────

function TypingDots() {
  return (
    <div style={{ display: 'flex', gap: 4, alignItems: 'center', padding: '4px 0' }}>
      {[0, 1, 2].map(i => (
        <div key={i} style={{
          width: 6, height: 6, borderRadius: '50%',
          background: 'var(--text-3)',
          animation: 'chat-dot 1.2s ease-in-out infinite',
          animationDelay: `${i * 0.2}s`,
        }} />
      ))}
    </div>
  )
}

// ─── Burbuja ──────────────────────────────────────────────────────────────────

function MessageBubble({ msg }: { msg: ChatMessage }) {
  const isUser = msg.role === 'user'
  return (
    <div style={{ display: 'flex', justifyContent: isUser ? 'flex-end' : 'flex-start', gap: 8 }}>
      {!isUser && (
        <div style={{
          width: 26, height: 26, borderRadius: '50%', flexShrink: 0,
          border: '1px solid rgba(255,138,61,0.25)',
          background: 'rgba(255,138,61,0.12)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          marginTop: 2,
        }}>
          <img src="/forgy/forgyi.png" alt="Forge" style={{ width: 14, height: 14, objectFit: 'contain' }} />
        </div>
      )}
      <div style={{
        maxWidth: '80%', padding: '9px 13px',
        borderRadius: isUser ? '12px 12px 4px 12px' : '12px 12px 12px 4px',
        background: isUser
          ? 'color-mix(in srgb, var(--action) 16%, var(--bg-2))'
          : 'var(--bg-2)',
        border: `1px solid ${isUser
          ? 'color-mix(in srgb, var(--action) 30%, transparent)'
          : 'var(--line-2)'}`,
        fontSize: 12, color: 'var(--text-0)', lineHeight: 1.65,
        whiteSpace: 'pre-wrap', wordBreak: 'break-word',
      }}>
        {msg.content}
      </div>
    </div>
  )
}

// ─── NodeChatWindow ───────────────────────────────────────────────────────────

export interface NodeChatWindowProps {
  stepKey:          string
  stepLabel:        string
  currentOutput:    unknown
  project:          Project
  locked:           boolean
  modelName?:       string | null
  initialMessages?:  ChatMessage[]
  onMessagesChange?: (msgs: ChatMessage[]) => void
  onApply?:          (data: unknown) => void
  validateOutput?:   (data: unknown) => string | null  // null = válido, string = mensaje de error
  onClose:           () => void
}

export default function NodeChatWindow({
  stepKey, stepLabel, currentOutput, project, locked, modelName,
  initialMessages, onMessagesChange, onApply, validateOutput, onClose,
}: NodeChatWindowProps) {
  const [messages,  setMessages]  = useState<ChatMessage[]>(initialMessages ?? [])
  const [input,     setInput]     = useState('')
  const [sending,   setSending]   = useState(false)
  const [applying,  setApplying]  = useState(false)
  const [error,     setError]     = useState<string | null>(null)

  // Posición del drag — calculada tras mount para evitar problemas de SSR
  const [pos,        setPos]        = useState({ x: 0, y: 0 })
  const [positioned, setPositioned] = useState(false)
  const [dragging,   setDragging]   = useState(false)
  const dragOrigin = useRef<{ sx: number; sy: number; ox: number; oy: number } | null>(null)

  const bottomRef = useRef<HTMLDivElement>(null)
  const inputRef  = useRef<HTMLTextAreaElement>(null)

  // Posición inicial: lado derecho, centrado verticalmente
  useEffect(() => {
    const x = Math.max(window.innerWidth - WINDOW_W - 24, 20)
    const y = Math.max((window.innerHeight - WINDOW_H) / 2, 20)
    setPos({ x, y })
    setPositioned(true)
  }, [])

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages, sending])

  // Sincroniza el historial al padre para que persista entre aperturas
  useEffect(() => {
    if (messages.length > 0) onMessagesChange?.(messages)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [messages])

  useEffect(() => {
    if (!sending) inputRef.current?.focus()
  }, [sending])

  // ── Drag ──────────────────────────────────────────────────────────────────

  const onMouseMove = useCallback((e: MouseEvent) => {
    if (!dragOrigin.current) return
    const nx = dragOrigin.current.ox + e.clientX - dragOrigin.current.sx
    const ny = dragOrigin.current.oy + e.clientY - dragOrigin.current.sy
    // Clamp para no salir de pantalla
    setPos({
      x: Math.max(0, Math.min(nx, window.innerWidth  - WINDOW_W)),
      y: Math.max(0, Math.min(ny, window.innerHeight - WINDOW_H)),
    })
  }, [])

  const onMouseUp = useCallback(() => {
    dragOrigin.current = null
    setDragging(false)
    window.removeEventListener('mousemove', onMouseMove)
    window.removeEventListener('mouseup',   onMouseUp)
  }, [onMouseMove])

  const onDragStart = (e: React.MouseEvent) => {
    e.preventDefault()
    dragOrigin.current = { sx: e.clientX, sy: e.clientY, ox: pos.x, oy: pos.y }
    setDragging(true)
    window.addEventListener('mousemove', onMouseMove)
    window.addEventListener('mouseup',   onMouseUp)
  }

  // ── Chat ──────────────────────────────────────────────────────────────────

  const send = async () => {
    const text = input.trim()
    if (!text || sending) return
    console.log('[chat] currentOutput items:', Array.isArray(currentOutput) ? (currentOutput as unknown[]).length : typeof currentOutput, currentOutput)
    const userMsg: ChatMessage = { role: 'user', content: text }
    setMessages(prev => [...prev, userMsg])
    setInput('')
    setSending(true)
    setError(null)
    try {
      const { reply } = await chatWithNode(stepKey, messages, text, currentOutput, project.id)
      setMessages(prev => [...prev, { role: 'assistant', content: reply }])
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Error contacting assistant')
    } finally {
      setSending(false)
    }
  }

  // Extrae JSON de la conversación, valida y llama onApply
  const applyOutput = async () => {
    if (!onApply || applying || sending) return
    setApplying(true)
    setError(null)
    try {
      const { reply } = await chatWithNode(
        stepKey, messages,
        'Return the complete updated list as a raw JSON array only. No markdown fences, no explanations.',
        currentOutput, project.id, true,
      )
      // Limpiar posibles markdown fences que el LLM incluya de todas formas
      const clean = reply.replace(/```(?:json)?\s*/gi, '').replace(/```/g, '').trim()
      let parsed: unknown
      try {
        parsed = JSON.parse(clean)
      } catch {
        setError('The assistant did not return valid JSON. Ask it to list the items again before applying.')
        return
      }
      // Validar estructura esperada
      if (validateOutput) {
        const validationError = validateOutput(parsed)
        if (validationError) {
          setError(validationError)
          return
        }
      }
      onApply(parsed)
    } catch {
      setError('Could not contact the assistant. Try again.')
    } finally {
      setApplying(false)
    }
  }

  if (!positioned) return null

  return (
    <>
      <style>{KEYFRAMES}</style>

      {/* Ventana flotante — sin overlay, no bloquea el modal de fondo */}
      <div style={{
        position:  'fixed',
        left:      pos.x,
        top:       pos.y,
        zIndex:    110,
        width:     WINDOW_W,
        height:    WINDOW_H,
        background:   'var(--bg-1)',
        borderRadius:  14,
        border:    '1px solid var(--line-2)',
        boxShadow: '0 24px 64px rgba(0,0,0,0.55), 0 0 0 1px rgba(255,255,255,0.04)',
        display:   'flex', flexDirection: 'column', overflow: 'hidden',
        // Evita selección de texto al arrastrar
        userSelect: dragging ? 'none' : 'auto',
      }}>

        {/* Header — drag handle */}
        <div
          onMouseDown={onDragStart}
          style={{
            padding: '12px 14px',
            borderBottom: '1px solid var(--line-2)',
            display: 'flex', alignItems: 'center', gap: 10,
            flexShrink: 0,
            background: 'var(--bg-2)',
            cursor: dragging ? 'grabbing' : 'grab',
          }}
        >
          <div style={{
            width: 30, height: 30, borderRadius: '50%', flexShrink: 0,
            border: '1px solid rgba(255,138,61,0.25)',
            background: 'rgba(255,138,61,0.12)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}>
            <img src="/forgy/forgyi.png" alt="Forge" style={{ width: 16, height: 16, objectFit: 'contain' }} />
          </div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--text-0)', lineHeight: 1.2 }}>
              Forge Assistant
            </div>
            <div style={{ fontSize: 9, fontFamily: 'var(--font-mono)', color: 'var(--text-3)', marginTop: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {stepLabel}
            </div>
          </div>
          {locked && (
            <span style={{
              fontSize: 9, fontFamily: 'var(--font-mono)', fontWeight: 600,
              padding: '2px 7px', borderRadius: 4, flexShrink: 0,
              background: 'rgba(52,211,153,0.10)', color: '#34D399',
              border: '1px solid rgba(52,211,153,0.20)',
            }}>
              ✓ Read only
            </span>
          )}
          {/* Grip visual */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 3, flexShrink: 0, opacity: 0.3, paddingRight: 4 }}>
            {[0,1,2].map(i => (
              <div key={i} style={{ width: 14, height: 2, borderRadius: 1, background: 'var(--text-2)' }} />
            ))}
          </div>
          <button
            onMouseDown={e => e.stopPropagation()}
            onClick={onClose}
            style={{
              border: 'none', background: 'var(--bg-3)', cursor: 'pointer',
              color: 'var(--text-2)', fontSize: 12, padding: '4px 8px',
              borderRadius: 5, lineHeight: 1, flexShrink: 0,
            }}
          >
            ✕
          </button>
        </div>

        {/* Mensajes */}
        <div style={{
          flex: 1, overflowY: 'auto',
          padding: '16px 14px',
          display: 'flex', flexDirection: 'column', gap: 12,
        }}>
          {messages.length === 0 && (
            <div style={{ margin: 'auto', textAlign: 'center', maxWidth: 280, padding: '12px 0', display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
              <img src="/forgy/forgyi.png" alt="Forge" style={{ width: 36, height: 36, objectFit: 'contain', marginBottom: 10, opacity: 0.6 }} />
              <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--text-0)', marginBottom: 6, lineHeight: 1.3 }}>
                {locked ? 'Ask about this output' : 'How can I help?'}
              </div>
              <div style={{ fontSize: 11, color: 'var(--text-2)', lineHeight: 1.6 }}>
                {locked
                  ? 'Step is approved. You can ask questions but changes are disabled.'
                  : 'Ask me to adjust tone, focus, constraints, or explain my reasoning.'}
              </div>
            </div>
          )}

          {messages.map((msg, i) => <MessageBubble key={i} msg={msg} />)}

          {sending && (
            <div style={{ display: 'flex', gap: 8 }}>
              <div style={{
                width: 26, height: 26, borderRadius: 7, flexShrink: 0,
                background: 'rgba(255,138,61,0.15)',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
              }}>
                <img src="/forgy/forgyi.png" alt="Forge" style={{ width: 16, height: 16, objectFit: 'contain' }} />
              </div>
              <div style={{
                padding: '9px 13px', borderRadius: '12px 12px 12px 4px',
                background: 'var(--bg-2)', border: '1px solid var(--line-2)',
              }}>
                <TypingDots />
              </div>
            </div>
          )}

          {error && (
            <div style={{
              fontSize: 11, color: '#F87171', lineHeight: 1.5,
              padding: '8px 12px', borderRadius: 8,
              background: 'rgba(248,113,113,0.07)',
              border: '1px solid rgba(248,113,113,0.20)',
            }}>
              {error}
            </div>
          )}

          <div ref={bottomRef} />
        </div>

        {/* Botón Apply — visible cuando hay conversación y onApply está definido */}
        {onApply && messages.length > 0 && messages.some(m => m.role === 'assistant') && (
          <div style={{ padding: '6px 12px', borderTop: '1px solid var(--line-2)', background: 'var(--bg-2)' }}>
            <button
              onClick={applyOutput}
              disabled={applying || sending || locked}
              style={{
                width: '100%', padding: '6px 0', borderRadius: 6, border: '1px solid',
                borderColor: applying || sending || locked ? 'var(--line-2)' : 'color-mix(in srgb, var(--action) 50%, transparent)',
                background: applying || sending || locked ? 'var(--bg-3)' : 'color-mix(in srgb, var(--action) 10%, var(--bg-2))',
                color: applying || sending || locked ? 'var(--text-4)' : 'var(--action)',
                fontSize: 11, fontFamily: 'var(--font-mono)', fontWeight: 600,
                cursor: applying || sending || locked ? 'not-allowed' : 'pointer',
                transition: 'all 120ms',
              }}
            >
              {applying ? 'Applying…' : '↑ Apply as output'}
            </button>
          </div>
        )}

        {/* Input */}
        <div style={{
          padding: '10px 12px', borderTop: '1px solid var(--line-2)',
          display: 'flex', gap: 7, flexShrink: 0,
          background: 'var(--bg-2)',
        }}>
          <textarea
            ref={inputRef}
            value={input}
            onChange={e => setInput(e.target.value)}
            onKeyDown={e => {
              if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send() }
            }}
            disabled={sending || locked}
            placeholder={locked
              ? 'Step is approved — read only'
              : 'Ask or describe an adjustment… (Enter to send)'}
            rows={2}
            style={{
              flex: 1, resize: 'none',
              background: 'var(--bg-1)', border: '1px solid var(--line-2)',
              borderRadius: 8, padding: '8px 11px',
              color: 'var(--text-0)', fontSize: 12, lineHeight: 1.5,
              outline: 'none', fontFamily: 'inherit',
              opacity: locked ? 0.4 : 1,
              transition: 'border-color 120ms',
            }}
            onFocus={e => { if (!locked) e.currentTarget.style.borderColor = 'var(--action)' }}
            onBlur={e => { e.currentTarget.style.borderColor = 'var(--line-2)' }}
          />
          <button
            onClick={send}
            disabled={sending || !input.trim() || locked}
            style={{
              padding: '0 14px', borderRadius: 8, border: 'none', flexShrink: 0,
              background: sending || !input.trim() || locked ? 'var(--bg-3)' : 'var(--action)',
              color:  sending || !input.trim() || locked ? 'var(--text-4)' : 'var(--action-fg)',
              fontSize: 16, cursor: sending || !input.trim() || locked ? 'not-allowed' : 'pointer',
              transition: 'background 120ms',
              alignSelf: 'stretch',
            }}
          >
            →
          </button>
        </div>

        {/* Modelo configurado para este step */}
        {modelName && (
          <div style={{
            padding: '5px 12px', borderTop: '1px solid var(--line-2)',
            background: 'var(--bg-2)',
            fontSize: 9, fontFamily: 'var(--font-mono)', color: 'var(--text-4)',
            textAlign: 'center', letterSpacing: '0.04em',
          }}>
            {modelName}
          </div>
        )}
      </div>
    </>
  )
}
