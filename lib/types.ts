export type WizardStep = 1 | 2 | 3 | 4 | 5 | 6

export type StepStatus =
  | 'locked'
  | 'active'
  | 'generating'
  | 'review'
  | 'approved'
  | 'invalidated'

export type GDDPaletteSwatch = {
  role: string
  color_description: string
  tone: string
  usage: string
}

export type GDDArtRef = {
  reference: string
  what_we_take: string
}

export type GDDMechanic = {
  id?: string
  name: string
  description?: string
  // formato n8n nuevo
  category?: string
  player_goal?: string
  rules?: string
  depth?: string
  integration?: string
  // formato antiguo
  type?: 'core' | 'secondary' | 'progression'
  player_fantasy?: string
  gameplay_tags?: string[]
  inputs?: string[]
  outputs?: string[]
  failure_state?: string
  tuning_levers?: string[]
  related_systems?: string[]
}

export type GDDLevel = {
  id?: string
  name: string
  // formato n8n nuevo
  visual_feel?: string
  gameplay_role?: string
  narrative_significance?: string
  // formato antiguo
  description?: string
  order?: number
  difficulty?: 'easy' | 'medium' | 'hard' | 'boss'
  environment?: string
  background_prompt?: string
  introduced_mechanics?: string[]
  objectives?: string[]
  preview_url?: string
  asset_type?: string
}

export type GDDCharacter = {
  id?: string
  name: string
  role: string
  // formato n8n nuevo
  age?: string
  appearance?: string
  backstory?: string
  motivation?: string
  arc?: string
  gameplay_role?: string
  // formato antiguo
  description?: string
  personality?: string
  abilities?: { name: string; mechanic_link: string; description: string }[] | string[]
  gameplay_tags?: string[]
  sprite_prompt?: string
  asset_type?: string
  preview_url?: string
}

export type GDD = {
  project: {
    name: string
    // formato n8n nuevo
    tagline?: string
    logline?: string
    player_mode?: string
    art_style?: string
    setting?: string
    lore?: string
    target_audience?: string
    // ambos formatos
    description?: string
    genre: string
    elevator_pitch?: string
    core_loop?: string
    tone?: string
    target_platform?: string
    camera?: string
    // formato antiguo
    subgenre?: string
    design_pillars?: string[]
    player_motivation?: string
  }
  // formato n8n nuevo
  design_pillars?: { pillar: string; description: string }[]
  key_features?: string[]
  story_acts?: { act: number; title: string; summary: string }[]
  themes?: { theme: string; manifestation: string }[]
  factions?: { name: string; alignment: string; goals: string; player_relationship: string }[]
  game_phases?: { phase: string; time_range: string; power_level: string; content_available: string; key_unlock: string }[]
  player_stats?: { stat: string; description: string; base_value: string; max_value: string; how_it_grows: string }[]
  player_abilities?: { ability: string; unlock_condition: string; description: string; cooldown_cost: string }[]
  magic_moments?: string[]
  economy?: {
    model: string
    price: string
    currencies: { currency: string; type: string; how_earned: string; how_spent: string; purchasable: string }[]
    reward_structure: { reward_type: string; trigger: string; frequency: string; emotion_targeted: string }[]
  }
  mechanics: GDDMechanic[]
  levels: GDDLevel[]
  characters: GDDCharacter[]
  art_direction: {
    style?: string
    palette?: string | GDDPaletteSwatch[]
    references?: string[] | GDDArtRef[]
    // formato n8n nuevo
    character_style?: string
    environment_style?: string
    technical_targets?: string
    // formato antiguo
    lighting_style?: string
    sprite_resolution?: string
    background_resolution?: string
    resolution?: string
    ui_style?: string
    mood?: string
  }
  audio_direction: {
    // formato n8n nuevo
    music_genre?: string
    instrumentation?: string
    adaptive_music?: string
    sound_design_style?: string
    voice_over?: string
    ambience?: string
    // formato antiguo
    music_mood?: string
    music_style?: string
    adaptive_audio?: string
    sfx_notes?: string
  }
  development: {
    suggested_engine?: string
    language?: string
    tools?: { category: string; tool: string }[]
    // formato antiguo
    estimated_scope?: string
    team_size?: number
    core_features?: string[]
    out_of_scope?: string[]
    technical_risks?: string[]
  }
  // formato antiguo
  systems?: Record<string, unknown>
  narrative?: Record<string, unknown>
  world?: Record<string, unknown>
  glossary?: unknown[]
  uiux_direction?: Record<string, unknown>
  open_questions?: unknown[]
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
  review_status?: 'pending' | 'reviewed' | 'changes_requested' | null
  reviewer_id?: string | null
  reviewer_note?: string | null
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

export type ProjectConcept = {
  pipeline?: {
    gdd?: GDD
    [key: string]: PipelineNodeArtifact | GDD | undefined
  }
  pipeline_config?: {
    active_nodes: string[]
    configured_at: string
  }
}

export type RepoConfig = {
  repo_url: string
  has_token: boolean
  configured_at: string
}

export type Project = {
  id: string
  name: string
  description: string
  genre: string
  target_engine: string
  status: string
  owner_member_id: string
  concept: ProjectConcept
  created_at: string
  updated_at?: string
  current_step?: number
  current_wizard_step?: number
  approved_wizard_count?: number
  node_approved_count?: number
  node_total_count?: number
  canvas_layout?: unknown
  generation_jobs?: GenerationJob[]
  repo_config?: RepoConfig
}

export type AdminUser = {
  auth_id: string
  email: string
  created_at: string
  last_sign_in?: string
  id?: string
  display_name?: string
  role?: 'member' | 'admin'
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
  resolver?: { id: string; display_name: string }
  projects?: { id: string; name: string }
}

export type InjectPoint = { node: string; field: string }
export type ExtraInjectPoint = { node: string; field: string; type: 'string' | 'int' | 'float' | 'image' }

export type InjectConfig = {
  prompt?: InjectPoint
  width?:  InjectPoint
  height?: InjectPoint
  seed?:   InjectPoint
  extra?:  Record<string, ExtraInjectPoint>
}

export type ComfyUIWorkflow = {
  id: string
  name: string
  description: string | null
  workflow_json?: Record<string, unknown>
  inject_config: InjectConfig
  is_active: boolean
  refinement_capable: boolean
  mask_capable: boolean
  created_at: string
  updated_at: string
}

export type StepConfig = {
  id: string
  step_key: string
  step_type: 'node' | 'container' | 'service'
  parent_key: string | null
  order_index: number
  label: string | null
  integration_type: 'llm' | 'comfyui' | 'n8n'
  model_name: string | null
  comfyui_workflow_id: string | null
  webhook_url: string | null
  extra_params: Record<string, unknown>
  is_active: boolean
  updated_at: string
  comfyui_workflows?: { id: string; name: string } | null
  image_enabled: boolean
  image_integration_type: 'llm' | 'comfyui' | 'n8n' | null
  image_model: string | null
  image_workflow_id: string | null
  image_webhook_url: string | null
}

export type ModelsConfig = {
  default: string
  available_providers: Record<string, boolean>
  [stepKey: string]: unknown
}

export type PromptConfig = {
  key: string
  r2_path: string | null
  description: string | null
  updated_at: string
  step_type?: 'node' | 'container' | 'service'
  order_index?: number
  parent_key?: string | null
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

export type AssetVersion = {
  id: string
  asset_id: string
  version_number: number
  source: string
  storage_url: string
  storage_bucket?: string
  model_used?: string
  uploaded_by?: string
  is_current: boolean
  created_at: string
  metadata?: Record<string, unknown>
}

export type ImageRef = {
  id:              string
  project_id:      string
  character_key:   string
  image_url:       string
  storage_path:    string
  round:           number
  selected:        boolean
  refined_from_id: string | null
  created_at:      string
}

export type CharacterRefStatus = {
  character_key:  string
  character_name: string
  sprite_prompt:  string
  total_images:   number
  selected_count: number
  rounds:         number
  status:         'empty' | 'pending' | 'approved'
  at_pool_limit:  boolean
}

export type GlobalRefStatus = {
  total_images:   number
  selected_count: number
  rounds:         number
  status:         'empty' | 'pending' | 'approved'
  at_pool_limit:  boolean
}

export type CharacterRenderStatus = {
  character_key:   string
  character_name:  string
  character_index: number
  sprite_prompt:   string
  status:          'empty' | 'generated' | 'approved'
  asset_id:        string | null
  review_status:   string | null
  current_version: AssetVersion | null
  total_versions:  number
  all_versions?:   AssetVersion[]
}

export type ModelingCharacterStatus = {
  character_key:      string
  character_name:     string
  character_index:    number
  render_2d_url:      string | null
  status_3d:          'empty' | 'generated' | 'approved'
  review_status_3d:   string | null
  asset_id_3d:        string | null
  current_version_3d: AssetVersion | null
  total_versions_3d:  number
}

export type AssetWithVersions = {
  id: string
  project_id: string
  step_key: string
  name: string
  type?: string
  discipline?: string
  review_status: 'pending' | 'approved' | 'rejected' | 'invalidated'
  created_at: string
  job_id?: string
  asset_versions: AssetVersion[]
  projects?: { id: string; name: string }
}
