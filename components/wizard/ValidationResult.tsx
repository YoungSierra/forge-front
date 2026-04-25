import type { ValidationResult } from '@/lib/types'

interface ValidationResultProps {
  validation: ValidationResult
  onImprove: () => void
  onContinueAnyway: () => void
}

const SEVERITY_ICON: Record<string, string> = {
  high: '🔴',
  medium: '🟡',
  low: '🔵',
}

function ScoreBar({ score }: { score: number }) {
  const color = score >= 80 ? 'bg-emerald-500' : score >= 60 ? 'bg-yellow-500' : score >= 30 ? 'bg-orange-500' : 'bg-red-500'
  return (
    <div className="flex items-center gap-3">
      <div className="flex-1 h-2 rounded-full bg-slate-800">
        <div className={`h-2 rounded-full transition-all ${color}`} style={{ width: `${score}%` }} />
      </div>
      <span className="text-white font-bold text-sm w-8 text-right">{score}</span>
    </div>
  )
}

export default function ValidationResult({ validation, onImprove, onContinueAnyway }: ValidationResultProps) {
  const canContinue = validation.coherence_score >= 30

  return (
    <div className="w-full max-w-2xl mx-auto flex flex-col gap-5">
      <div className="rounded-xl border border-slate-800 bg-[#0d0f16] p-6 flex flex-col gap-4">
        <div className="flex flex-col gap-2">
          <div className="flex items-center justify-between">
            <span className="text-slate-400 text-sm font-medium">Coherence</span>
            <span className="text-slate-500 text-xs">{validation.coherence_score}/100</span>
          </div>
          <ScoreBar score={validation.coherence_score} />
          <p className="text-slate-400 text-sm mt-1">{validation.coherence_summary}</p>
        </div>

        {validation.issues.length > 0 && (
          <div className="flex flex-col gap-2">
            <span className="text-slate-400 text-xs font-medium uppercase tracking-wide">Detected issues</span>
            {validation.issues.map((issue, i) => (
              <div key={i} className="flex items-start gap-2 text-sm">
                <span className="mt-0.5">{SEVERITY_ICON[issue.severity] ?? '🔵'}</span>
                <span className="text-slate-300">{issue.description}</span>
              </div>
            ))}
          </div>
        )}

        {validation.suggestions.length > 0 && (
          <div className="flex flex-col gap-2">
            <span className="text-slate-400 text-xs font-medium uppercase tracking-wide">Suggestions</span>
            {validation.suggestions.map((s, i) => (
              <div key={i} className="flex items-start gap-2 text-sm text-slate-300">
                <span className="text-violet-400 mt-0.5">→</span>
                <span>{s}</span>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="flex gap-3">
        <button
          onClick={onImprove}
          className="flex-1 py-3 rounded-xl border border-slate-700 bg-transparent hover:bg-slate-800 text-white font-semibold text-sm transition-colors"
        >
          Improve my idea
        </button>
        {canContinue && (
          <button
            onClick={onContinueAnyway}
            className="flex-1 py-3 rounded-xl bg-violet-600 hover:bg-violet-500 text-white font-semibold text-sm transition-colors"
          >
            Continue anyway
          </button>
        )}
      </div>
    </div>
  )
}
