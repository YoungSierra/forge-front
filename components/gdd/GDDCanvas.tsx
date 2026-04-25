import type { GDD } from '@/lib/types'
import CharactersSection from './CharactersSection'
import MechanicsSection from './MechanicsSection'
import LevelsSection from './LevelsSection'
import DirectionSection from './DirectionSection'

interface Props {
  gdd: GDD
  previewUrls?: Record<string, string>
}

export default function GDDCanvas({ gdd, previewUrls }: Props) {
  const { project } = gdd

  return (
    <div className="flex flex-col gap-8 pb-28">
      <section className="rounded-2xl border border-slate-800 bg-[#0d0f16] p-6">
        <div className="flex flex-wrap items-start gap-3 mb-3">
          <h1 className="text-3xl font-black text-white tracking-tight">{project.name}</h1>
          <div className="flex flex-wrap gap-2 items-center mt-1">
            <span className="text-xs px-2.5 py-1 rounded-full bg-violet-500/20 text-violet-300 border border-violet-500/30 font-medium">
              {project.genre}
            </span>
            {gdd.development.suggested_engine && (
              <span className="text-xs px-2.5 py-1 rounded-full bg-slate-700/60 text-slate-300 border border-slate-700 font-medium">
                {gdd.development.suggested_engine}
              </span>
            )}
            {gdd.development.estimated_scope && (
              <span className="text-xs px-2.5 py-1 rounded-full bg-slate-700/60 text-slate-400 border border-slate-700">
                {gdd.development.estimated_scope}
              </span>
            )}
          </div>
        </div>
        <p className="text-slate-300 italic mb-3 leading-relaxed">{project.elevator_pitch}</p>
        <div className="flex flex-wrap gap-3">
          <div className="flex items-center gap-1.5 bg-[#13151f] border border-slate-800 rounded-lg px-3 py-1.5">
            <span className="text-xs font-semibold text-slate-500 uppercase tracking-wider">Loop:</span>
            <span className="text-xs text-slate-300">{project.core_loop}</span>
          </div>
          <div className="flex items-center gap-1.5 bg-[#13151f] border border-slate-800 rounded-lg px-3 py-1.5">
            <span className="text-xs font-semibold text-slate-500 uppercase tracking-wider">Tone:</span>
            <span className="text-xs text-slate-300">{project.tone}</span>
          </div>
        </div>
      </section>

      <CharactersSection characters={gdd.characters} previewUrls={previewUrls} />
      <MechanicsSection mechanics={gdd.mechanics} />
      <LevelsSection levels={gdd.levels} />
      <DirectionSection
        art_direction={gdd.art_direction}
        audio_direction={gdd.audio_direction}
        development={gdd.development}
      />
    </div>
  )
}
