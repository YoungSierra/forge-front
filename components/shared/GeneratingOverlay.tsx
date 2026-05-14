'use client'

import { useEffect, useState } from 'react'
import type { WizardStep } from '@/lib/types'

const MESSAGES: Record<WizardStep, string[]> = {
  1: [
    'Designing the game universe...',
    'Creating unique characters...',
    'Defining mechanics...',
    'Building the levels...',
  ],
  2: [
    'Generating character sprites...',
    'Creating visual placeholders...',
    'Processing concept art...',
  ],
  3: [
    'Expanding level details...',
    'Placing enemies and collectibles...',
    'Designing the visual atmosphere...',
  ],
  4: [
    'Writing the game code...',
    'Implementing mechanics...',
    'Documenting the architecture...',
  ],
  5: [
    'Composing the audio direction...',
    'Defining sound effects...',
    'Designing the soundtrack...',
  ],
  6: ['Packaging assets...', 'Generating the ZIP...', 'Preparing the download...'],
}

interface Props {
  step?: WizardStep
}

export default function GeneratingOverlay({ step = 1 }: Props) {
  const messages = MESSAGES[step]
  const [idx, setIdx] = useState(0)

  useEffect(() => {
    const interval = setInterval(() => {
      setIdx((i) => (i + 1) % messages.length)
    }, 2000)
    return () => clearInterval(interval)
  }, [messages.length])

  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 50, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'rgba(14,15,18,0.92)', backdropFilter: 'blur(4px)' }}>
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 20, textAlign: 'center' }}>
        <svg width="48" height="48" viewBox="0 0 32 32" style={{ animation: 'spin 2s linear infinite' }}>
          <path d="M16 4 L26 14 L26 22 L20 28 L12 28 L6 22 L6 14 Z" fill="#ff8a3d" stroke="#1a0d04" strokeWidth="0.5"/>
          <path d="M16 10 L22 16 L22 21 L18 25 L14 25 L10 21 L10 16 Z" fill="#ffe7d4" opacity="0.85"/>
        </svg>
        <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
        <div>
          <p style={{ fontSize: 15, fontWeight: 700, letterSpacing: '-0.02em', color: 'var(--text-0)', marginBottom: 6, fontFamily: 'var(--font-sans)' }}>Forge</p>
          <p style={{ fontSize: 12, color: 'var(--text-3)', fontFamily: 'var(--font-mono)', transition: 'all 0.5s' }}>{messages[idx]}</p>
        </div>
        <div style={{ display: 'flex', gap: 5 }}>
          {[0, 1, 2].map((i) => (
            <div key={i} style={{ width: 5, height: 5, borderRadius: '50%', background: 'var(--ember)', animation: 'bounce 0.8s infinite', animationDelay: `${i * 0.15}s` }} />
          ))}
        </div>
        <style>{`@keyframes bounce { 0%,100%{transform:translateY(0)}50%{transform:translateY(-5px)} }`}</style>
      </div>
    </div>
  )
}
