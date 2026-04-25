'use client'

import { useState } from 'react'

interface Props {
  gameJs: string
  architectureMd: string
}

export default function CodeViewer({ gameJs, architectureMd }: Props) {
  const [tab, setTab] = useState<'game' | 'arch'>('game')

  return (
    <div className="flex flex-col h-full">
      <div className="flex gap-1 p-1 bg-[#0a0a0f] rounded-t-lg border border-slate-800">
        <button
          onClick={() => setTab('game')}
          className={`px-4 py-1.5 rounded text-sm font-mono font-medium transition-colors ${
            tab === 'game'
              ? 'bg-[#13151f] text-green-400 border border-slate-700'
              : 'text-slate-500 hover:text-slate-300'
          }`}
        >
          game.js
        </button>
        <button
          onClick={() => setTab('arch')}
          className={`px-4 py-1.5 rounded text-sm font-mono font-medium transition-colors ${
            tab === 'arch'
              ? 'bg-[#13151f] text-blue-400 border border-slate-700'
              : 'text-slate-500 hover:text-slate-300'
          }`}
        >
          architecture.md
        </button>
      </div>
      <div className="flex-1 overflow-auto bg-[#0a0a0f] border border-t-0 border-slate-800 rounded-b-lg">
        {tab === 'game' ? (
          <pre className="p-4 text-green-400 text-sm font-mono leading-relaxed whitespace-pre-wrap break-words min-h-full">
            {gameJs || '// No code generated yet'}
          </pre>
        ) : (
          <pre className="p-4 text-slate-300 text-sm font-mono leading-relaxed whitespace-pre-wrap break-words min-h-full">
            {architectureMd || '# No architecture document yet'}
          </pre>
        )}
      </div>
    </div>
  )
}
