'use client'

import { useState, useEffect } from 'react'
import type { GameFormData } from '@/lib/types'
import ParameterSelect from '@/components/shared/ParameterSelect'

const OVERLOAD_KEYWORDS = ['multiplayer', 'online', 'mmo', 'open world', 'procedural', 'crafting', 'inventory', 'skill tree']

const GENRE_OPTIONS = [
  { value: '', label: '🤖 Let AI decide' },
  { value: 'platformer', label: '🏃 2D Platformer' },
  { value: 'rpg', label: '⚔️ Action RPG' },
  { value: 'puzzle', label: '🧩 Puzzle' },
  { value: 'shooter', label: '🔫 Shooter' },
  { value: 'adventure', label: '🗺️ Adventure' },
  { value: 'strategy', label: '🏰 Strategy' },
  { value: 'roguelike', label: '🎲 Roguelike' },
  { value: 'metroidvania', label: '🗝️ Metroidvania' },
]

const TONE_OPTIONS = [
  { value: '', label: '🤖 Let AI decide' },
  { value: 'dark fantasy', label: '🌑 Dark / Dark fantasy' },
  { value: 'colorful cartoon', label: '🌈 Colorful / Cartoon' },
  { value: 'cyberpunk', label: '⚡ Cyberpunk / Sci-fi' },
  { value: 'horror', label: '💀 Horror / Terror' },
  { value: 'epic fantasy', label: '✨ Epic fantasy' },
  { value: 'cute cozy', label: '🌸 Cute / Cozy' },
  { value: 'retro pixel', label: '👾 Retro / Classic pixel art' },
  { value: 'mythological', label: '🏛️ Mythological' },
]

const AUDIENCE_OPTIONS = [
  { value: '', label: '🤖 Let AI decide' },
  { value: 'casual', label: '😊 Casual (pick up and play)' },
  { value: 'core', label: '🎮 Core gamer' },
  { value: 'hardcore', label: '💪 Hardcore / Challenging' },
  { value: 'kids', label: '👶 Kids (all ages)' },
  { value: 'family', label: '👨‍👩‍👧 Family' },
]

const SCOPE_OPTIONS = [
  { value: 'demo', label: '⚡ Demo / Game jam (2-3 levels)' },
  { value: 'prototype', label: '🔧 Prototype (4-6 levels) — Recommended' },
  { value: 'full_game', label: '🎯 Full game (8+ levels)' },
]

const ENGINE_OPTIONS = [
  { value: 'unity', label: 'Unity' },
  { value: 'unreal', label: 'Unreal Engine' },
  { value: 'godot', label: 'Godot' },
  { value: 'phaser', label: 'Phaser.js (web)' },
]

interface GameIdeaFormProps {
  onSubmit: (formData: GameFormData) => void
  loading: boolean
  initialData?: GameFormData
}

export default function GameIdeaForm({ onSubmit, loading, initialData }: GameIdeaFormProps) {
  const [prompt, setPrompt] = useState(initialData?.prompt ?? '')
  const [genre, setGenre] = useState(initialData?.genre ?? '')
  const [tone, setTone] = useState(initialData?.tone ?? '')
  const [audience, setAudience] = useState(initialData?.audience ?? '')
  const [scope, setScope] = useState(initialData?.scope ?? 'prototype')
  const [engine, setEngine] = useState(initialData?.engine ?? 'unity')
  const [references, setReferences] = useState(initialData?.references ?? '')
  const [parametersOpen, setParametersOpen] = useState(true)
  const [warnings, setWarnings] = useState<string[]>([])

  useEffect(() => {
    const newWarnings: string[] = []
    const words = prompt.trim().split(/\s+/).filter(Boolean)
    if (words.length > 0 && words.length < 4) {
      newWarnings.push('Your idea is too short')
    }
    if (audience === 'kids' && (tone === 'horror' || tone === 'dark fantasy')) {
      newWarnings.push('Dark tone + kids audience')
    }
    if (scope === 'demo' && OVERLOAD_KEYWORDS.some((kw) => prompt.toLowerCase().includes(kw))) {
      newWarnings.push('Too complex for a demo')
    }
    setWarnings(newWarnings)
  }, [prompt, tone, audience, scope])

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (prompt.trim().length < 10) return
    onSubmit({ prompt: prompt.trim(), genre, tone, audience, scope, engine, references })
  }

  return (
    <form onSubmit={handleSubmit} className="w-full max-w-2xl flex flex-col gap-5">
      <div className="flex flex-col gap-2">
        <div className="relative">
          <textarea
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) handleSubmit(e) }}
            placeholder="Describe your game..."
            rows={5}
            maxLength={2000}
            className="w-full rounded-xl border border-slate-700 bg-[#0d0f16] text-white placeholder-slate-600 text-base px-5 py-4 resize-none focus:outline-none focus:border-violet-500 transition-colors leading-relaxed"
          />
          <span className="absolute bottom-3 right-4 text-xs text-slate-600">{prompt.length}/2000</span>
        </div>

        {warnings.length > 0 && (
          <div className="flex flex-col gap-1">
            {warnings.map((w, i) => (
              <p key={i} className="text-yellow-500 text-xs flex items-center gap-1">
                <span>⚠️</span> {w}
              </p>
            ))}
          </div>
        )}
      </div>

      <div className="rounded-xl border border-slate-800 bg-[#0d0f16] overflow-hidden">
        <button
          type="button"
          onClick={() => setParametersOpen(!parametersOpen)}
          className="w-full flex items-center justify-between px-5 py-3.5 text-slate-400 hover:text-white transition-colors text-sm font-medium"
        >
          <span>Game parameters</span>
          <span className="text-slate-600 text-xs">{parametersOpen ? '▲ Hide' : '▼ Show'}</span>
        </button>

        {parametersOpen && (
          <div className="px-5 pb-5 grid grid-cols-1 sm:grid-cols-2 gap-4 border-t border-slate-800 pt-4">
            <ParameterSelect label="Genre" value={genre} onChange={setGenre} options={GENRE_OPTIONS} optional />
            <ParameterSelect label="Visual tone" value={tone} onChange={setTone} options={TONE_OPTIONS} optional />
            <ParameterSelect label="Audience" value={audience} onChange={setAudience} options={AUDIENCE_OPTIONS} optional />
            <ParameterSelect label="Scope" value={scope} onChange={setScope} options={SCOPE_OPTIONS} />
            <ParameterSelect label="Engine" value={engine} onChange={setEngine} options={ENGINE_OPTIONS} />
            <div className="flex flex-col gap-1.5">
              <label className="text-slate-400 text-xs font-medium uppercase tracking-wide">
                Visual references <span className="text-slate-600 normal-case tracking-normal ml-1">(optional)</span>
              </label>
              <input
                type="text"
                value={references}
                onChange={(e) => setReferences(e.target.value)}
                placeholder="e.g. Hollow Knight, Celeste..."
                className="rounded-lg border border-slate-700 bg-[#0a0a0f] text-white placeholder-slate-600 text-sm px-3 py-2 focus:outline-none focus:border-violet-500 transition-colors"
              />
            </div>
          </div>
        )}
      </div>

      <button
        type="submit"
        disabled={prompt.trim().length < 10 || loading}
        className={`w-full py-4 rounded-xl font-bold text-base transition-all flex items-center justify-center gap-2 ${
          prompt.trim().length < 10 || loading
            ? 'bg-slate-800 text-slate-600 cursor-not-allowed'
            : 'bg-violet-600 hover:bg-violet-500 text-white shadow-lg shadow-violet-500/20'
        }`}
      >
        {loading ? (
          <>
            <svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
            </svg>
            Analyzing...
          </>
        ) : (
          'Validate and generate →'
        )}
      </button>
      <p className="text-center text-slate-600 text-xs">Ctrl+Enter to generate · Min. 10 characters</p>
    </form>
  )
}
