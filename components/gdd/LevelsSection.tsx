import type { GDDLevel } from '@/lib/types'

const DIFF_STYLES: Record<GDDLevel['difficulty'], string> = {
  easy: 'bg-green-500/20 text-green-400 border-green-500/30',
  medium: 'bg-yellow-500/20 text-yellow-400 border-yellow-500/30',
  hard: 'bg-orange-500/20 text-orange-400 border-orange-500/30',
  boss: 'bg-red-500/20 text-red-400 border-red-500/30',
}

const DIFF_BAR_COLOR: Record<GDDLevel['difficulty'], string> = {
  easy: 'from-green-900/60 to-green-800/20',
  medium: 'from-yellow-900/60 to-yellow-800/20',
  hard: 'from-orange-900/60 to-orange-800/20',
  boss: 'from-red-900/60 to-red-800/20',
}

interface Props {
  levels: GDDLevel[]
}

export default function LevelsSection({ levels }: Props) {
  return (
    <section>
      <h2 className="text-lg font-bold text-white mb-4 flex items-center gap-2">
        <span className="text-blue-400">🗺️</span> Levels
      </h2>
      <div className="flex flex-col gap-3">
        {levels.map((level, i) => (
          <div
            key={i}
            className="rounded-xl border border-slate-800 bg-[#0d0f16] overflow-hidden"
          >
            <div
              className={`h-12 w-full bg-gradient-to-r ${DIFF_BAR_COLOR[level.difficulty]} border-b border-slate-800 flex items-center px-4 gap-3`}
            >
              <span className="text-slate-400 text-xs font-mono">#{level.order}</span>
              <span className="font-bold text-white text-sm">{level.name}</span>
              <span
                className={`text-xs px-2 py-0.5 rounded-md border capitalize ${DIFF_STYLES[level.difficulty]}`}
              >
                {level.difficulty}
              </span>
            </div>
            <div className="p-4">
              <p className="text-slate-400 text-xs leading-relaxed mb-1">
                <span className="text-slate-500 font-medium">Environment: </span>
                {level.environment}
              </p>
              <p className="text-slate-400 text-xs leading-relaxed">{level.description}</p>
            </div>
          </div>
        ))}
      </div>
    </section>
  )
}
