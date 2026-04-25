'use client'

import { useState } from 'react'
import type { Project, SpritePreview } from '@/lib/types'
import { generateSprites, approveStep2 } from '@/lib/api'
import GeneratingOverlay from '@/components/shared/GeneratingOverlay'
import ApprovalBar from '@/components/shared/ApprovalBar'

const BACKEND_URL = process.env.NEXT_PUBLIC_BACKEND_URL || 'http://localhost:8000'

type State = 'idle' | 'generating' | 'review'

interface Props {
  project: Project
  onApproved: () => void
  invalidated?: boolean
}

export default function Step2Sprites({ project, onApproved, invalidated }: Props) {
  const [state, setState] = useState<State>('idle')
  const [sprites, setSprites] = useState<SpritePreview[]>([])
  const [error, setError] = useState<string | null>(null)
  const [approving, setApproving] = useState(false)

  const characters = project.concept?.characters ?? []

  async function generate() {
    setError(null)
    setState('generating')
    try {
      const res = await generateSprites(project.id)
      setSprites(res.map((s) => ({ ...s, approved: false })))
      setState('review')
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Error desconocido')
      setState('idle')
    }
  }

  function toggleApprove(idx: number) {
    setSprites((prev) =>
      prev.map((s, i) => (i === idx ? { ...s, approved: !s.approved } : s))
    )
  }

  function approveAll() {
    setSprites((prev) => prev.map((s) => ({ ...s, approved: true })))
  }

  async function handleApprove() {
    setApproving(true)
    try {
      await approveStep2(project.id, sprites)
      onApproved()
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Error al aprobar')
      setApproving(false)
    }
  }

  const approvedCount = sprites.filter((s) => s.approved).length
  const allApproved = sprites.length > 0 && approvedCount === sprites.length

  return (
    <div className="relative">
      {state === 'generating' && <GeneratingOverlay step={2} />}

      {state === 'idle' && (
        <div className="flex flex-col items-center justify-center py-20 gap-6 text-center">
          {invalidated && (
            <div className="flex items-center gap-2 px-4 py-2 rounded-lg bg-amber-500/10 border border-amber-500/30 text-amber-400 text-sm mb-2">
              ⚠️ This step was modified. Regenerate to update the content.
            </div>
          )}
          <div className="w-16 h-16 rounded-2xl bg-[#13151f] border border-slate-800 flex items-center justify-center text-3xl">
            🎨
          </div>
          <div>
            <h2 className="text-white font-bold text-xl mb-2">Character sprites</h2>
            <p className="text-slate-500 text-sm">
              {characters.length} characters ready for sprite generation
            </p>
          </div>
          {error && <p className="text-red-400 text-sm">{error}</p>}
          <button
            onClick={generate}
            className="px-6 py-3 rounded-xl bg-violet-600 hover:bg-violet-500 text-white font-semibold text-sm transition-colors"
          >
            Generate sprites for all characters
          </button>
        </div>
      )}

      {state === 'review' && (
        <div>
          <div className="flex items-center justify-between mb-6">
            <h2 className="text-white font-bold text-xl">Generated sprites</h2>
            <button
              onClick={approveAll}
              className="text-sm text-violet-400 hover:text-violet-300 transition-colors"
            >
              Approve all
            </button>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 pb-28">
            {sprites.map((sprite, i) => (
              <div
                key={i}
                className={`rounded-xl border overflow-hidden transition-all ${sprite.approved
                    ? 'border-green-500/50 bg-green-500/5'
                    : 'border-slate-800 bg-[#0d0f16]'
                  }`}
              >
                <div className="h-48 bg-[#0a0a0f] border-b border-slate-800 flex items-center justify-center">
                  {sprite.preview_url ? (
                    <img
                      src={`${BACKEND_URL}${sprite.preview_url}`}
                      alt={sprite.character_name}
                      className="h-full w-full object-contain"
                    />
                  ) : (
                    <div className="w-24 h-24 rounded-xl bg-slate-800 flex items-center justify-center">
                      <span className="text-4xl font-black text-slate-600">
                        {sprite.character_name.charAt(0)}
                      </span>
                    </div>
                  )}
                </div>
                <div className="p-4">
                  <div className="flex items-center gap-2 mb-2">
                    <h3 className="font-bold text-white text-sm">{sprite.character_name}</h3>
                    <span className="text-xs text-slate-500 capitalize">{sprite.character_role}</span>
                  </div>
                  <p className="text-xs text-slate-500 mb-3 leading-relaxed line-clamp-2">
                    {sprite.sprite_prompt}
                  </p>
                  <div className="flex gap-2">
                    <button
                      onClick={() => toggleApprove(i)}
                      className={`flex-1 py-1.5 rounded-lg text-xs font-semibold transition-all ${sprite.approved
                          ? 'bg-green-500/20 text-green-400 border border-green-500/30'
                          : 'bg-slate-800 text-slate-400 border border-slate-700 hover:border-green-500/30 hover:text-green-400'
                        }`}
                    >
                      ✓ {sprite.approved ? 'Approved' : 'Approve'}
                    </button>
                    <button
                      onClick={generate}
                      className="flex-1 py-1.5 rounded-lg text-xs font-semibold bg-slate-800 text-slate-400 border border-slate-700 hover:border-red-500/30 hover:text-red-400 transition-all"
                    >
                      ✗ Regenerate
                    </button>
                  </div>
                </div>
              </div>
            ))}
          </div>

          <ApprovalBar
            onRegenerate={generate}
            onApprove={handleApprove}
            approveDisabled={!allApproved || approving}
            approveLabel={approving ? 'Approving...' : 'Approve all and continue →'}
            centerText={`${approvedCount}/${sprites.length} characters approved`}
          />
        </div>
      )}
    </div>
  )
}
