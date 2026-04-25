import type { StepStatus } from '@/lib/types'

interface Props {
  status: StepStatus
  label?: string
}

const STATUS_STYLES: Record<StepStatus, string> = {
  approved: 'bg-green-500/20 text-green-400 border-green-500/30',
  active: 'bg-violet-500/20 text-violet-300 border-violet-500/30',
  generating: 'bg-violet-500/20 text-violet-300 border-violet-500/30 animate-pulse',
  review: 'bg-yellow-500/20 text-yellow-400 border-yellow-500/30',
  locked: 'bg-slate-700/50 text-slate-500 border-slate-700',
  invalidated: 'bg-amber-500/20 text-amber-400 border-amber-500/30',
}

const STATUS_LABELS: Record<StepStatus, string> = {
  approved: 'Approved',
  active: 'Active',
  generating: 'Generating...',
  review: 'In review',
  locked: 'Locked',
  invalidated: 'Invalidated',
}

export default function StepBadge({ status, label }: Props) {
  return (
    <span
      className={`inline-flex items-center px-2 py-0.5 rounded-md border text-xs font-medium ${STATUS_STYLES[status]}`}
    >
      {label ?? STATUS_LABELS[status]}
    </span>
  )
}
