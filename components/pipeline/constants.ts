export type NodeCategory =
  | 'gdd'
  | 'sprites'
  | 'levels'
  | 'code'
  | 'audio'
  | 'export'
  | 'playtesting'
  | 'review'

export type PipelineNodeStatus =
  | 'idle'
  | 'running'
  | 'awaiting_approval'
  | 'approved'
  | 'rejected'
  | 'error'
  | 'locked'

export const CATEGORY_COLOR: Record<NodeCategory, string> = {
  gdd: '#7c3aed',
  sprites: '#2563eb',
  levels: '#0d9488',
  code: '#16a34a',
  audio: '#d97706',
  export: '#dc2626',
  playtesting: '#6b7280',
  review: '#6b7280',
}

export const CATEGORY_LABEL: Record<NodeCategory, string> = {
  gdd: 'GDD',
  sprites: 'Sprites',
  levels: 'Levels',
  code: 'Code',
  audio: 'Audio',
  export: 'Export',
  playtesting: 'Playtesting',
  review: 'Review',
}

export const STATUS_COLOR: Record<PipelineNodeStatus, string> = {
  idle: '#374151',
  running: '#3b82f6',
  awaiting_approval: '#ea580c',
  approved: '#16a34a',
  rejected: '#dc2626',
  error: '#dc2626',
  locked: '#1f2937',
}
