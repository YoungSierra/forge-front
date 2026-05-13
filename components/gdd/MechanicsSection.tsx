import type { GDDMechanic } from '@/lib/types'

const TYPE_STYLES: Record<string, string> = {
  core: 'bg-yellow-500/20 text-yellow-400 border-yellow-500/30',
  secondary: 'bg-slate-600/40 text-slate-400 border-slate-600',
  progression: 'bg-teal-500/20 text-teal-400 border-teal-500/30',
}

interface Props {
  mechanics: GDDMechanic[]
}

export default function MechanicsSection({ mechanics }: Props) {
  return (
    <section>
      <h2 className="text-lg font-bold text-white mb-4 flex items-center gap-2">
        <span className="text-yellow-400">⚙️</span> Mechanics
      </h2>
      <div className="flex flex-wrap gap-4">
        {mechanics.map((mechanic, i) => (
          <div
            key={i}
            className="rounded-xl border border-slate-800 bg-[#0d0f16] p-4 min-w-[200px] max-w-sm flex-1"
          >
            <div className="flex items-center gap-2 mb-2">
              <h3 className="font-bold text-white text-sm">{mechanic.name}</h3>
              {(mechanic.type || mechanic.category) && (
                <span className={`text-xs px-2 py-0.5 rounded-md border capitalize ${TYPE_STYLES[mechanic.type ?? ''] ?? 'bg-slate-600/40 text-slate-400 border-slate-600'}`}>
                  {mechanic.category ?? mechanic.type}
                </span>
              )}
            </div>
            <p className="text-slate-400 text-xs leading-relaxed">{mechanic.description}</p>
          </div>
        ))}
      </div>
    </section>
  )
}
