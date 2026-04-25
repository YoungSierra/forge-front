import type { Asset } from '@/lib/types'

const STATUS_STYLES = {
  pending: 'border-yellow-500/30 bg-yellow-500/5',
  approved: 'border-green-500/30 bg-green-500/5',
  rejected: 'border-red-500/30 bg-red-500/5',
  invalidated: 'border-amber-500/30 bg-amber-500/5',
}

const STATUS_LABELS = {
  pending: 'Pending',
  approved: 'Approved',
  rejected: 'Rejected',
  invalidated: 'Invalidated',
}

interface Props {
  asset: Asset
}

export default function AssetCard({ asset }: Props) {
  return (
    <div
      className={`rounded-xl border p-4 ${STATUS_STYLES[asset.review_status]}`}
    >
      <div className="flex items-start justify-between gap-2">
        <div>
          <p className="font-semibold text-white text-sm">{asset.name}</p>
          <p className="text-xs text-slate-500 mt-0.5">{asset.type} · {asset.discipline}</p>
        </div>
        <span className="text-xs px-2 py-0.5 rounded border border-slate-700 text-slate-400">
          {STATUS_LABELS[asset.review_status]}
        </span>
      </div>
      {asset.current_version && (
        <p className="text-xs text-slate-500 mt-2 truncate">
          {asset.current_version.model_used}
        </p>
      )}
    </div>
  )
}
