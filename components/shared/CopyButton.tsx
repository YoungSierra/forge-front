'use client'

import { useState } from 'react'

// Botón reutilizable para copiar texto al portapapeles. Muestra ⧉ y cambia a ✓ (verde) 1.5s al copiar.
// Se usa en la tarjeta de output del chat, el modal de expand y el modal de output del canvas.
export function CopyButton({ text, style, className, title = 'Copy as text' }: {
  text: string
  style?: React.CSSProperties
  className?: string
  title?: string
}) {
  const [copied, setCopied] = useState(false)
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text)
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    } catch { /* clipboard bloqueado */ }
  }
  return (
    <button
      onClick={copy}
      title={title}
      className={className}
      style={{
        width: 20, height: 20, borderRadius: 4, border: '1px solid var(--line-2)', background: 'var(--bg-3)',
        color: copied ? 'var(--ok,#3a3)' : 'var(--text-3)', fontSize: 11, cursor: 'pointer',
        display: 'flex', alignItems: 'center', justifyContent: 'center', lineHeight: 1, padding: 0, flexShrink: 0,
        ...style,
      }}
    >
      {copied ? '✓' : '⧉'}
    </button>
  )
}
