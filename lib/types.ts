export type WizardStep = 1 | 2 | 3 | 4 | 5 | 6

export type StepStatus =
  | 'locked'
  | 'active'
  | 'generating'
  | 'review'
  | 'approved'
  | 'invalidated'

export type GDDMechanic = {
  id: string
  name: string
  description: string
  type: 'core' | 'secondary' | 'progression'
  gameplay_tags?: string[]
  inputs?: string[]
  outputs?: string[]
  related_systems?: string[]
}

export type GDDLevel = {
  id?: string
  name: string
  description: string
  order: number
  difficulty: 'easy' | 'medium' | 'hard' | 'boss'
  environment: string
  background_prompt: string
  introduced_mechanics?: string[]
  objectives?: string[]
  preview_url?: string
  asset_type?: string
}

export type GDDCharacter = {
  id?: string
  name: string
  role: 'hero' | 'enemy' | 'npc' | 'boss'
  description: string
  personality?: string
  abilities: { name: string; mechanic_link: string; description: string }[] | string[]
  gameplay_tags?: string[]
  sprite_prompt: string
  asset_type?: string
  preview_url?: string
}

export type GDD = {
  project: {
    name: string
    description: string
    genre: string
    subgenre?: string
    elevator_pitch: string
    core_loop: string
    tone: string
    target_platform?: string
    camera?: string
  }
  mechanics: GDDMechanic[]
  levels: GDDLevel[]
  characters: GDDCharacter[]
  art_direction: {
    style: string
    palette: string
    lighting_style?: string
    sprite_resolution?: string
    background_resolution?: string
    resolution?: string
    ui_style?: string
    references: string[]
  }
  audio_direction: {
    music_mood: string
    music_style: string
    adaptive_audio?: string
    sfx_notes: string
  }
  systems?: {
    progression?: string
    economy?: string
    combat?: string
    ui_flow?: string
  }
  development: {
    estimated_scope: string
    team_size?: number
    core_features: string[]
    out_of_scope: string[]
    technical_risks?: string[]
    suggested_engine: string
  }
}

export type SpritePreview = {
  character_name: string
  character_role: string
  sprite_prompt: string
  preview_url: string
  placeholder: boolean
  approved?: boolean
}

export type PipelineNodeArtifact = {
  approved?: boolean
  approved_at?: string
  [key: string]: unknown
}

export type GenerationJob = {
  id: string
  project_id: string
  current_step: string
  status: string
  progress?: number
  created_at?: string
  completed_at?: string
}

export type Discipline = 'code' | 'art' | 'vfx' | 'audio' | 'design' | 'infra'

export type Member = {
  id: string
  display_name: string
  avatar_url?: string
  role: string
}

export type ProjectMember = {
  id: string
  project_role: string
  discipline: Discipline
  joined_at: string
  members: Member
}

export type Project = {
  id: string
  name: string
  description: string
  genre: string
  target_engine: string
  status: string
  owner_member_id: string
  concept: GDD & { pipeline?: Record<string, PipelineNodeArtifact> }
  created_at: string
  current_step?: number
  current_wizard_step?: number
  approved_wizard_count?: number
  generation_jobs?: GenerationJob[]
}

export type FeedbackCategory = 'usability' | 'bug' | 'performance' | 'suggestion'
export type FeedbackSeverity = 'low' | 'medium' | 'high'
export type FeedbackStatus   = 'open' | 'reviewed' | 'resolved'

export type Feedback = {
  id: string
  member_id?: string
  project_id?: string
  category: FeedbackCategory
  severity: FeedbackSeverity
  description: string
  url_context?: string
  screenshot_url?: string
  status: FeedbackStatus
  resolution_note?: string
  resolved_by?: string
  resolved_at?: string
  created_at: string
  members?: Member
  projects?: { id: string; name: string }
}

export type GameFormData = {
  prompt: string
  genre: string
  tone: string
  audience: string
  scope: string
  engine: string
  references: string
}

export type ValidationIssue = {
  type: 'contradiction' | 'scope' | 'genre_mismatch' | 'vague' | 'impossible'
  description: string
  severity: 'low' | 'medium' | 'high'
}

export type ValidationResult = {
  is_viable: boolean
  coherence_score: number
  complexity_score: number
  issues: ValidationIssue[]
  suggestions: string[]
  detected_genres: string[]
  detected_tone: string
  estimated_scope: string
  coherence_summary: string
}

export type ScriptFile = {
  filename: string
  description: string
  url: string
  size_bytes: number
  content?: string
}

export type CodeGenerationResult = {
  engine: string
  files: ScriptFile[]
  architecture_md: string
}

export type Asset = {
  id: string
  project_id: string
  name: string
  type: string
  discipline: string
  review_status: 'pending' | 'approved' | 'rejected' | 'invalidated'
  current_version?: {
    storage_url: string
    metadata: Record<string, unknown>
    prompt_used: string
    model_used: string
  }
}
