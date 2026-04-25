'use client'

interface Props {
  onRegenerate: () => void
  onApprove: () => void
  approveDisabled?: boolean
  approveLabel: string
  centerText: string
  regenerateLabel?: string
}

export default function ApprovalBar({
  onRegenerate,
  onApprove,
  approveDisabled = false,
  approveLabel,
  centerText,
  regenerateLabel = '← Regenerar',
}: Props) {
  return (
    <div className="fixed bottom-0 left-0 right-0 z-40 border-t border-slate-800 bg-[#0d0f16]/95 backdrop-blur-sm px-6 py-4">
      <div className="max-w-7xl mx-auto flex items-center justify-between gap-4">
        <button
          onClick={onRegenerate}
          className="px-5 py-2.5 rounded-lg border border-slate-700 text-slate-300 hover:border-slate-500 hover:text-white transition-colors text-sm font-medium whitespace-nowrap"
        >
          {regenerateLabel}
        </button>

        <span className="text-slate-400 text-sm text-center flex-1 min-w-0 truncate">
          {centerText}
        </span>

        <button
          onClick={onApprove}
          disabled={approveDisabled}
          className={`px-6 py-2.5 rounded-lg text-sm font-semibold whitespace-nowrap transition-all ${
            approveDisabled
              ? 'bg-slate-700 text-slate-500 cursor-not-allowed'
              : 'bg-violet-600 hover:bg-violet-500 text-white shadow-lg shadow-violet-500/20'
          }`}
        >
          {approveLabel}
        </button>
      </div>
    </div>
  )
}
