'use client'

import { useState } from 'react'
import type { Project } from '@/lib/types'
import { generateLevels, approveStep3 } from '@/lib/api'
import GeneratingOverlay from '@/components/shared/GeneratingOverlay'
import ApprovalBar from '@/components/shared/ApprovalBar'

type State = 'idle' | 'generating' | 'review'

interface LevelData {
  name: string
  order: number
  difficulty: string
  description: string
  environment?: string
  enemy_placements?: string[]
  collectibles?: string[]
  hazards?: string[]
  approved?: boolean
  [key: string]: unknown
}

interface Props {
  project: Project
  onApproved: () => void
  invalidated?: boolean
}

const DIFF_STYLES: Record<string, string> = {
  easy: 'bg-green-500/20 text-green-400 border-green-500/30',
  medium: 'bg-yellow-500/20 text-yellow-400 border-yellow-500/30',
  hard: 'bg-orange-500/20 text-orange-400 border-orange-500/30',
  boss: 'bg-red-500/20 text-red-400 border-red-500/30',
}

const DIFF_BG: Record<string, string> = {
  easy: 'from-green-900/40 to-transparent',
  medium: 'from-yellow-900/40 to-transparent',
  hard: 'from-orange-900/40 to-transparent',
  boss: 'from-red-900/40 to-transparent',
}

export default function Step3Levels({ project, onApproved, invalidated }: Props) {
  const [state, setState] = useState<State>('idle')
  const [levels, setLevels] = useState<LevelData[]>([])
  const [error, setError] = useState<string | null>(null)
  const [approving, setApproving] = useState(false)

  async function generate() {
    setError(null)
    setState('generating')
    try {
      const res = await generateLevels(project.id)
      setLevels((res as LevelData[]).map((l) => ({ ...l, approved: false })))
      setState('review')
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Error desconocido')
      setState('idle')
    }
  }

  function toggleApprove(idx: number) {
    setLevels((prev) =>
      prev.map((l, i) => (i === idx ? { ...l, approved: !l.approved } : l))
    )
  }

  function approveAll() {
    setLevels((prev) => prev.map((l) => ({ ...l, approved: true })))
  }

  async function handleApprove() {
    setApproving(true)
    try {
      await approveStep3(project.id, levels)
      onApproved()
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Error al aprobar')
      setApproving(false)
    }
  }

  const approvedCount = levels.filter((l) => l.approved).length
  const allApproved = levels.length > 0 && approvedCount === levels.length

  return (
    <div className="relative">
      {state === 'generating' && <GeneratingOverlay step={3} />}

      {state === 'idle' && (
        <div className="flex flex-col items-center justify-center py-20 gap-6 text-center">
          {invalidated && (
            <div className="flex items-center gap-2 px-4 py-2 rounded-lg bg-amber-500/10 border border-amber-500/30 text-amber-400 text-sm mb-2">
              ⚠️ This step was modified. Regenerate to update the content.
            </div>
          )}
          <div className="w-16 h-16 rounded-2xl bg-[#13151f] border border-slate-800 flex items-center justify-center text-3xl">
            🗺️
          </div>
          <div>
            <h2 className="text-white font-bold text-xl mb-2">Level design</h2>
            <p className="text-slate-500 text-sm">
              {project.concept?.pipeline?.gdd?.levels?.length ?? 0} levels ready to expand
            </p>
          </div>
          {error && <p className="text-red-400 text-sm">{error}</p>}
          <button
            onClick={generate}
            className="px-6 py-3 rounded-xl bg-violet-600 hover:bg-violet-500 text-white font-semibold text-sm transition-colors"
          >
            Generate level details
          </button>
        </div>
      )}

      {state === 'review' && (
        <div>
          <div className="flex items-center justify-between mb-6">
            <h2 className="text-white font-bold text-xl">Generated levels</h2>
            <button
              onClick={approveAll}
              className="text-sm text-violet-400 hover:text-violet-300 transition-colors"
            >
              Approve all
            </button>
          </div>

          <div className="flex flex-col gap-4 pb-28">
            {levels.map((level, i) => (
              <div
                key={i}
                className={`rounded-xl border overflow-hidden transition-all ${level.approved
                  ? 'border-green-500/50 bg-green-500/5'
                  : 'border-slate-800 bg-[#0d0f16]'
                  }`}
              >
                <div
                  className={`h-16 w-full bg-gradient-to-r ${DIFF_BG[level.difficulty] ?? 'from-slate-800/40 to-transparent'} border-b border-slate-800 flex items-center px-5 gap-3`}
                >
                  <span className="text-slate-500 font-mono text-sm">#{level.order}</span>
                  <span className="font-bold text-white">{level.name}</span>
                  <span
                    className={`text-xs px-2 py-0.5 rounded-md border capitalize ${DIFF_STYLES[level.difficulty] ?? 'bg-slate-700/50 text-slate-400 border-slate-700'
                      }`}
                  >
                    {level.difficulty}
                  </span>
                </div>
                <div className="p-5">
                  <p className="text-slate-400 text-sm leading-relaxed mb-4">{level.description}</p>
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                    {level.enemy_placements && level.enemy_placements.length > 0 && (
                      <ListGroup
                        label="Enemies"
                        items={level.enemy_placements.map((e: any) =>
                          typeof e === 'string' ? e : `${e.enemy_name ?? e.name ?? ''} — ${e.position ?? e.behavior ?? ''}`
                        )}
                        color="red"
                      />
                    )}

                    {level.collectibles && level.collectibles.length > 0 && (
                      <ListGroup
                        label="Collectibles"
                        items={level.collectibles.map((c: any) =>
                          typeof c === 'string' ? c : `${c.name ?? ''} — ${c.description ?? c.effect ?? ''}`
                        )}
                        color="yellow"
                      />
                    )}

                    {level.hazards && level.hazards.length > 0 && (
                      <ListGroup
                        label="Hazards"
                        items={level.hazards.map((h: any) =>
                          typeof h === 'string' ? h : `${h.name ?? ''} — ${h.description ?? ''}`
                        )}
                        color="orange"
                      />
                    )}
                  </div>
                  <div className="flex gap-2 mt-4">
                    <button
                      onClick={() => toggleApprove(i)}
                      className={`px-4 py-1.5 rounded-lg text-xs font-semibold transition-all ${level.approved
                        ? 'bg-green-500/20 text-green-400 border border-green-500/30'
                        : 'bg-slate-800 text-slate-400 border border-slate-700 hover:border-green-500/30 hover:text-green-400'
                        }`}
                    >
                      ✓ {level.approved ? 'Approved' : 'Approve'}
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
            approveLabel={approving ? 'Approving...' : 'Approve all levels →'}
            centerText={`${approvedCount}/${levels.length} levels approved`}
          />
        </div>
      )}
    </div>
  )
}

function ListGroup({
  label,
  items,
  color,
}: {
  label: string
  items: string[]
  color: string
}) {
  const colorClass =
    color === 'red'
      ? 'text-red-400'
      : color === 'yellow'
        ? 'text-yellow-400'
        : 'text-orange-400'

  return (
    <div>
      <p className={`text-xs font-semibold uppercase tracking-wider mb-1.5 ${colorClass}`}>
        {label}
      </p>
      <ul className="space-y-1">
        {items.map((item, i) => (
          <li key={i} className="text-xs text-slate-400 flex items-start gap-1.5">
            <span className="text-slate-600 mt-0.5">·</span>
            {item}
          </li>
        ))}
      </ul>
    </div>
  )
}
