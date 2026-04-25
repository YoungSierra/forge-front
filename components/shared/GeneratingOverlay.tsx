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
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-[#0a0a0f]/90 backdrop-blur-sm">
      <div className="flex flex-col items-center gap-8 text-center animate-pulse">
        <div className="relative flex items-center justify-center">
          <div className="absolute w-24 h-24 rounded-full border-2 border-violet-500/30 animate-ping" />
          <div className="absolute w-16 h-16 rounded-full border-2 border-violet-500/50 animate-ping [animation-delay:0.3s]" />
          <div className="w-12 h-12 rounded-full bg-violet-600 flex items-center justify-center shadow-lg shadow-violet-500/50">
            <span className="text-white text-lg font-bold">F</span>
          </div>
        </div>
        <div>
          <p className="text-2xl font-bold text-white tracking-widest mb-2">FORGE</p>
          <p className="text-slate-400 text-sm transition-all duration-500">{messages[idx]}</p>
        </div>
        <div className="flex gap-1">
          {[0, 1, 2].map((i) => (
            <div
              key={i}
              className="w-1.5 h-1.5 rounded-full bg-violet-500 animate-bounce"
              style={{ animationDelay: `${i * 0.15}s` }}
            />
          ))}
        </div>
      </div>
    </div>
  )
}
