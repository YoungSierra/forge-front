'use client'

import { useState } from 'react'
import type { GDDCharacter } from '@/lib/types'

const ROLE_STYLES: Record<string, string> = {
  hero: 'bg-purple-500/20 text-purple-300 border-purple-500/30',
  protagonist: 'bg-purple-500/20 text-purple-300 border-purple-500/30',
  enemy: 'bg-red-500/20 text-red-400 border-red-500/30',
  antagonist: 'bg-red-500/20 text-red-400 border-red-500/30',
  npc: 'bg-blue-500/20 text-blue-400 border-blue-500/30',
  mentor: 'bg-blue-500/20 text-blue-400 border-blue-500/30',
  boss: 'bg-orange-500/20 text-orange-400 border-orange-500/30',
}

const ROLE_BG: Record<string, string> = {
  hero: 'bg-purple-900/40',
  protagonist: 'bg-purple-900/40',
  enemy: 'bg-red-900/40',
  antagonist: 'bg-red-900/40',
  npc: 'bg-blue-900/40',
  mentor: 'bg-blue-900/40',
  boss: 'bg-orange-900/40',
}

interface Props {
  characters: GDDCharacter[]
  previewUrls?: Record<string, string>
}

export default function CharactersSection({ characters, previewUrls = {} }: Props) {
  const [expandedPrompts, setExpandedPrompts] = useState<Set<number>>(new Set())

  function togglePrompt(i: number) {
    setExpandedPrompts((prev) => {
      const next = new Set(prev)
      if (next.has(i)) next.delete(i)
      else next.add(i)
      return next
    })
  }

  return (
    <section>
      <h2 className="text-lg font-bold text-white mb-4 flex items-center gap-2">
        <span className="text-purple-400">👥</span> Characters
      </h2>
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {characters.map((char, i) => (
          <div
            key={i}
            className="rounded-xl border border-slate-800 bg-[#0d0f16] overflow-hidden flex flex-col"
          >
            <div
              className={`h-32 flex items-center justify-center ${ROLE_BG[char.role]} border-b border-slate-800`}
            >
              {previewUrls[char.name] ? (
                <img
                  src={previewUrls[char.name]}
                  alt={char.name}
                  className="h-full w-full object-contain"
                />
              ) : (
                <div className="w-16 h-16 rounded-xl bg-slate-800 border border-slate-700 flex items-center justify-center">
                  <span className="text-3xl font-black text-slate-500">
                    {char.name.charAt(0).toUpperCase()}
                  </span>
                </div>
              )}
            </div>
            <div className="p-4 flex flex-col gap-2 flex-1">
              <div className="flex items-center gap-2 flex-wrap">
                <h3 className="font-bold text-white text-sm">{char.name}</h3>
                <span
                  className={`text-xs px-2 py-0.5 rounded-md border capitalize ${ROLE_STYLES[char.role]}`}
                >
                  {char.role}
                </span>
              </div>
              <p className="text-slate-400 text-xs leading-relaxed line-clamp-2">
                {char.description}
              </p>
              {(char.abilities?.length ?? 0) > 0 && (
                <div className="flex flex-wrap gap-1 mt-1">
                  {char.abilities!.map((ability, j) => (
                    <span
                      key={j}
                      className="text-xs px-2 py-0.5 rounded-full bg-slate-800 border border-slate-700 text-slate-400"
                    >
                      {typeof ability === 'string' ? ability : ability.name}
                    </span>
                  ))}
                </div>
              )}
              <button
                onClick={() => togglePrompt(i)}
                className="text-xs text-slate-600 hover:text-slate-400 transition-colors text-left mt-auto pt-1"
              >
                {expandedPrompts.has(i) ? '▲ Hide prompt' : '▼ View sprite prompt'}
              </button>
              {expandedPrompts.has(i) && (
                <p className="text-xs text-slate-500 leading-relaxed border-t border-slate-800 pt-2 mt-1">
                  {char.sprite_prompt}
                </p>
              )}
            </div>
          </div>
        ))}
      </div>
    </section>
  )
}
