'use client'

import { useState } from 'react'
import type { Project } from '@/lib/types'
import { generateAudio, approveStep5 } from '@/lib/api'
import GeneratingOverlay from '@/components/shared/GeneratingOverlay'
import ApprovalBar from '@/components/shared/ApprovalBar'

type State = 'idle' | 'generating' | 'review'

interface SFXItem {
  name: string
  trigger?: string
  description?: string
  mood?: string
  duration?: string
  [key: string]: unknown
}

interface MusicItem {
  level_name?: string
  mood?: string
  style?: string
  tempo?: string
  instruments?: string[]
  description?: string
  [key: string]: unknown
}

interface Props {
  project: Project
  onApproved: () => void
  invalidated?: boolean
}

function WaveformSVG() {
  const points = [4, 8, 12, 6, 14, 5, 10, 15, 7, 11, 9, 13, 6, 10, 8]
  return (
    <svg viewBox="0 0 120 24" className="w-full h-6 text-violet-500/40">
      <polyline
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
        points={points.map((y, x) => `${x * 8},${12 - y / 2}`).join(' ')}
      />
    </svg>
  )
}

export default function Step5Audio({ project, onApproved, invalidated }: Props) {
  const [state, setState] = useState<State>('idle')
  const [audio, setAudio] = useState<{ sfx: SFXItem[]; music: MusicItem[] } | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [approving, setApproving] = useState(false)

  async function generate() {
    setError(null)
    setState('generating')
    try {
      const res = await generateAudio(project.id)
      setAudio(res as { sfx: SFXItem[]; music: MusicItem[] })
      setState('review')
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Error desconocido')
      setState('idle')
    }
  }

  async function handleApprove() {
    if (!audio) return
    setApproving(true)
    try {
      await approveStep5(project.id, audio)
      onApproved()
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Error al aprobar')
      setApproving(false)
    }
  }

  return (
    <div className="relative">
      {state === 'generating' && <GeneratingOverlay step={5} />}

      {state === 'idle' && (
        <div className="flex flex-col items-center justify-center py-20 gap-6 text-center">
          {invalidated && (
            <div className="flex items-center gap-2 px-4 py-2 rounded-lg bg-amber-500/10 border border-amber-500/30 text-amber-400 text-sm mb-2">
              ⚠️ This step was modified. Regenerate to update the content.
            </div>
          )}
          <div className="w-16 h-16 rounded-2xl bg-[#13151f] border border-slate-800 flex items-center justify-center text-3xl">
            🎵
          </div>
          <div>
            <h2 className="text-white font-bold text-xl mb-2">Audio direction</h2>
            <p className="text-slate-500 text-sm">
              Gemini will design sound effects and music for each level
            </p>
          </div>
          {error && <p className="text-red-400 text-sm">{error}</p>}
          <button
            onClick={generate}
            className="px-6 py-3 rounded-xl bg-violet-600 hover:bg-violet-500 text-white font-semibold text-sm transition-colors"
          >
            Generate audio direction
          </button>
        </div>
      )}

      {state === 'review' && audio && (
        <div className="pb-28">
          <div className="mb-8">
            <h2 className="text-white font-bold text-xl mb-4 flex items-center gap-2">
              <span className="text-violet-400">🔊</span> Sound effects
            </h2>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
              {audio.sfx.map((sfx, i) => (
                <div
                  key={i}
                  className="rounded-xl border border-slate-800 bg-[#0d0f16] p-4 flex flex-col gap-3"
                >
                  <div className="flex items-start justify-between gap-2">
                    <h3 className="font-bold text-white text-sm">{sfx.name}</h3>
                    <span className="text-xs px-2 py-0.5 rounded-md bg-violet-500/10 text-violet-400 border border-violet-500/20 whitespace-nowrap">
                      🔊 Placeholder
                    </span>
                  </div>
                  {sfx.trigger && (
                    <p className="text-xs text-slate-500">
                      <span className="text-slate-400 font-medium">Trigger:</span> {sfx.trigger}
                    </p>
                  )}
                  <WaveformSVG />
                  {sfx.description && (
                    <p className="text-xs text-slate-400 leading-relaxed">{sfx.description}</p>
                  )}
                  {sfx.duration && (
                    <p className="text-xs text-slate-500">
                      <span className="text-slate-400 font-medium">Duration:</span> {sfx.duration}
                    </p>
                  )}
                </div>
              ))}
            </div>
          </div>

          <div>
            <h2 className="text-white font-bold text-xl mb-4 flex items-center gap-2">
              <span className="text-teal-400">🎵</span> Music by level
            </h2>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              {audio.music.map((track, i) => (
                <div
                  key={i}
                  className="rounded-xl border border-slate-800 bg-[#0d0f16] p-4 flex flex-col gap-3"
                >
                  <div className="flex items-start justify-between gap-2">
                    <h3 className="font-bold text-white text-sm">
                      {track.level_name ?? `Level ${i + 1}`}
                    </h3>
                    <span className="text-xs px-2 py-0.5 rounded-md bg-teal-500/10 text-teal-400 border border-teal-500/20 whitespace-nowrap">
                      🎵 Placeholder
                    </span>
                  </div>
                  <div className="grid grid-cols-2 gap-2 text-xs">
                    {track.mood && (
                      <div>
                        <span className="text-slate-500 font-medium">Mood:</span>{' '}
                        <span className="text-slate-300">{track.mood}</span>
                      </div>
                    )}
                    {track.style && (
                      <div>
                        <span className="text-slate-500 font-medium">Style:</span>{' '}
                        <span className="text-slate-300">{track.style}</span>
                      </div>
                    )}
                    {track.tempo && (
                      <div>
                        <span className="text-slate-500 font-medium">Tempo:</span>{' '}
                        <span className="text-slate-300">{track.tempo}</span>
                      </div>
                    )}
                  </div>
                  {track.instruments && track.instruments.length > 0 && (
                    <div className="flex flex-wrap gap-1">
                      {track.instruments.map((inst, j) => (
                        <span
                          key={j}
                          className="text-xs px-2 py-0.5 rounded-full bg-slate-800 border border-slate-700 text-slate-400"
                        >
                          {inst}
                        </span>
                      ))}
                    </div>
                  )}
                  {track.description && (
                    <p className="text-xs text-slate-400 leading-relaxed">{track.description}</p>
                  )}
                </div>
              ))}
            </div>
          </div>

          <ApprovalBar
            onRegenerate={generate}
            onApprove={handleApprove}
            approveDisabled={approving}
            approveLabel={approving ? 'Approving...' : 'Approve audio direction →'}
            centerText={`${audio.sfx.length} SFX · ${audio.music.length} tracks`}
          />
        </div>
      )}
    </div>
  )
}
