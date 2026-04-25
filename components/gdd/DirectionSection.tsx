import type { GDD } from '@/lib/types'

interface Props {
  art_direction: GDD['art_direction']
  audio_direction: GDD['audio_direction']
  development: GDD['development']
}

export default function DirectionSection({ art_direction, audio_direction, development }: Props) {
  return (
    <div className="flex flex-col gap-6">
      <section>
        <h2 className="text-lg font-bold text-white mb-4 flex items-center gap-2">
          <span className="text-pink-400">🎨</span> Art Direction
        </h2>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="rounded-xl border border-slate-800 bg-[#0d0f16] p-4 space-y-3">
            <Row label="Style" value={art_direction.style} />
            <Row label="Palette" value={art_direction.palette} />
            <Row label="Resolution" value={art_direction.sprite_resolution ?? art_direction.resolution ?? '–'} />
          </div>
          <div className="rounded-xl border border-slate-800 bg-[#0d0f16] p-4">
            <p className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-2">
              References
            </p>
            <ul className="space-y-1">
              {art_direction.references.map((ref, i) => (
                <li key={i} className="text-sm text-slate-300 flex items-start gap-1.5">
                  <span className="text-slate-600 mt-0.5">·</span>
                  {ref}
                </li>
              ))}
            </ul>
          </div>
        </div>
      </section>

      <section>
        <h2 className="text-lg font-bold text-white mb-4 flex items-center gap-2">
          <span className="text-teal-400">🎵</span> Audio Direction
        </h2>
        <div className="rounded-xl border border-slate-800 bg-[#0d0f16] p-4 grid grid-cols-1 md:grid-cols-3 gap-4">
          <Row label="Mood" value={audio_direction.music_mood} />
          <Row label="Music style" value={audio_direction.music_style} />
          <Row label="SFX notes" value={audio_direction.sfx_notes} />
        </div>
      </section>

      <section>
        <h2 className="text-lg font-bold text-white mb-4 flex items-center gap-2">
          <span className="text-cyan-400">💻</span> Development
        </h2>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="rounded-xl border border-slate-800 bg-[#0d0f16] p-4 space-y-3">
            <Row label="Estimated scope" value={development.estimated_scope} />
            <Row label="Suggested engine" value={development.suggested_engine} />
            <div>
              <p className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-1.5">
                Core features
              </p>
              <ul className="space-y-1">
                {development.core_features.map((f, i) => (
                  <li key={i} className="text-xs text-slate-300 flex items-start gap-1.5">
                    <span className="text-green-500 mt-0.5">✓</span>
                    {f}
                  </li>
                ))}
              </ul>
            </div>
          </div>
          <div className="rounded-xl border border-slate-800 bg-[#0d0f16] p-4">
            <p className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-1.5">
              Out of scope
            </p>
            <ul className="space-y-1">
              {development.out_of_scope.map((f, i) => (
                <li key={i} className="text-xs text-slate-400 flex items-start gap-1.5">
                  <span className="text-slate-600 mt-0.5">✗</span>
                  {f}
                </li>
              ))}
            </ul>
          </div>
        </div>
      </section>
    </div>
  )
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-0.5">
        {label}
      </p>
      <p className="text-sm text-slate-300">{value}</p>
    </div>
  )
}
