import type { GDD, SpritePreview, Project, Asset, ValidationResult, ScriptFile, CodeGenerationResult, Member, ProjectMember, Discipline, Feedback, FeedbackCategory, FeedbackSeverity, FeedbackStatus, AdminUser, StepConfig, ComfyUIWorkflow, InjectConfig, ModelsConfig, PromptConfig } from './types'
import type { InputContext } from './nodeExecutionContext'

export type { ScriptFile, CodeGenerationResult }
export type { InputContext }

export const BACKEND_URL = process.env.NEXT_PUBLIC_BACKEND_URL || 'http://localhost:8000'
export const assetUrl = (path: string) =>
  path ? (path.startsWith('http') ? path : `${BACKEND_URL}${path}`) : ''

async function request<T>(path: string, options?: RequestInit): Promise<T> {
  const memberId = typeof window !== 'undefined' ? localStorage.getItem('forge_member_id') : null
  const res = await fetch(`${BACKEND_URL}${path}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...(memberId ? { 'x-member-id': memberId } : {}),
      ...(options?.headers as Record<string, string> | undefined),
    },
  })
  if (!res.ok) {
    let message = `Request failed: ${res.status} ${res.statusText}`
    try {
      const body = await res.json()
      if (body.detail) message = body.detail
      else if (body.message) message = body.message
      else if (body.error) message = body.error
    } catch {}
    throw new Error(message)
  }
  return res.json()
}

// Health
export async function checkHealth() {
  return request<{ status: string; supabase: string }>('/api/health')
}

export async function createProject(name: string, memberId?: string) {
  return request<{ success: boolean; project_id: string; project: Project }>(
    '/api/projects',
    { method: 'POST', body: JSON.stringify({ name, member_id: memberId }) }
  )
}

// Step 1
export async function generateGDD(prompt: string, projectId?: string) {
  const data = await request<{ success: boolean; gdd: GDD; meta: unknown }>('/api/generate/gdd', {
    method: 'POST',
    body: JSON.stringify({ prompt, project_id: projectId }),
  })
  return { gdd: data.gdd, meta: data.meta }
}

export async function approveStep1(payload: { project_id: string; gdd: GDD; prompt: string; meta: unknown; member_id?: string }) {
  const data = await request<{ success: boolean; project_id: string; project: Project }>(
    '/api/projects/approve-step1',
    { method: 'POST', body: JSON.stringify(payload) }
  )
  return data
}

export async function validateIdea(data: {
  prompt: string
  genre?: string
  tone?: string
  audience?: string
  scope?: string
  engine?: string
  references?: string
}): Promise<ValidationResult> {
  const result = await request<{
    success: boolean
    validation: ValidationResult
    meta: unknown
  }>('/api/validate/idea', {
    method: 'POST',
    body: JSON.stringify(data),
  })
  return result.validation
}

// Step 2
export async function generateSprites(project_id: string, input_context?: InputContext) {
  const data = await request<{ success: boolean; sprites: SpritePreview[] }>(
    '/api/generate/sprites',
    { method: 'POST', body: JSON.stringify({ project_id, input_context }) }
  )
  return data.sprites || []
}

export async function approveStep2(project_id: string, sprites: SpritePreview[], member_id?: string) {
  return request(`/api/projects/${project_id}/approve-step2`, {
    method: 'POST',
    body: JSON.stringify({ approved_sprites: sprites, member_id }),
  })
}

// Step 3
export async function generateLevels(project_id: string, input_context?: InputContext) {
  const data = await request<{ success: boolean; levels: unknown[] }>(
    '/api/generate/levels',
    { method: 'POST', body: JSON.stringify({ project_id, input_context }) }
  )
  return data.levels || []
}

export async function approveStep3(project_id: string, levels: unknown[], member_id?: string) {
  return request(`/api/projects/${project_id}/approve-step3`, {
    method: 'POST',
    body: JSON.stringify({ approved_levels: levels, member_id }),
  })
}

// Step 4
export async function generateCode(project_id: string, input_context?: InputContext): Promise<CodeGenerationResult> {
  const data = await request<{
    success: boolean
    engine: string
    files: ScriptFile[]
    architecture_md: string
    meta: unknown
  }>('/api/generate/code', {
    method: 'POST',
    body: JSON.stringify({ project_id, input_context })
  })
  return {
    engine: data.engine,
    files: data.files,
    architecture_md: data.architecture_md
  }
}

export async function approveStep4(
  project_id: string,
  result: CodeGenerationResult,
  member_id?: string
): Promise<unknown> {
  return request(`/api/projects/${project_id}/approve-step4`, {
    method: 'POST',
    body: JSON.stringify({
      files: result.files,
      architecture_md: result.architecture_md,
      engine: result.engine,
      member_id,
    })
  })
}

// Step 5
export async function generateAudio(project_id: string, input_context?: InputContext) {
  const data = await request<{ success: boolean; audio: { sfx: unknown[]; music: unknown[] } }>(
    '/api/generate/audio',
    { method: 'POST', body: JSON.stringify({ project_id, input_context }) }
  )
  return data.audio
}

export async function approveStep5(project_id: string, audio: unknown, member_id?: string) {
  return request(`/api/projects/${project_id}/approve-step5`, {
    method: 'POST',
    body: JSON.stringify({ audio, member_id }),
  })
}

// Step 6
export async function exportProject(project_id: string, target_engine: string) {
  const data = await request<{ success: boolean; package_url: string; manifest: unknown }>(
    `/api/projects/${project_id}/export`,
    { method: 'POST', body: JSON.stringify({ target_engine }) }
  )
  return data
}

// Projects
export async function getProjects(auth_user_id?: string): Promise<Project[]> {
  const qs = auth_user_id ? `?auth_user_id=${encodeURIComponent(auth_user_id)}` : ''
  const data = await request<{ success: boolean; projects: Project[] }>(`/api/projects${qs}`)
  return data.projects || []
}

export async function getProject(id: string): Promise<Project> {
  const data = await request<{ success: boolean; project: Project }>(`/api/projects/${id}`)
  return data.project
}

// Members
export async function searchMembers(q: string): Promise<Member[]> {
  const data = await request<{ success: boolean; members: Member[] }>(`/api/members/search?q=${encodeURIComponent(q)}`)
  return data.members || []
}

const _memberByAuthCache = new Map<string, Promise<Member | null>>()

export function getMemberByAuth(auth_user_id: string): Promise<Member | null> {
  if (!_memberByAuthCache.has(auth_user_id)) {
    const promise = request<{ success: boolean; member: Member }>(`/api/members/by-auth/${auth_user_id}`)
      .then(data => data.member)
      .catch(() => null)
    _memberByAuthCache.set(auth_user_id, promise)
  }
  return _memberByAuthCache.get(auth_user_id)!
}

export function invalidateMemberCache(auth_user_id?: string) {
  if (auth_user_id) _memberByAuthCache.delete(auth_user_id)
  else _memberByAuthCache.clear()
}

export async function getProjectMembers(project_id: string): Promise<ProjectMember[]> {
  const data = await request<{ success: boolean; members: ProjectMember[] }>(`/api/projects/${project_id}/members`)
  return data.members || []
}

export async function addProjectMember(project_id: string, member_id: string, project_role: string, discipline: Discipline): Promise<ProjectMember> {
  const data = await request<{ success: boolean; member: ProjectMember }>(`/api/projects/${project_id}/members`, {
    method: 'POST',
    body: JSON.stringify({ member_id, project_role, discipline }),
  })
  return data.member
}

export async function removeProjectMember(project_id: string, member_id: string): Promise<void> {
  await request(`/api/projects/${project_id}/members/${member_id}`, { method: 'DELETE' })
}

// Assets
export async function getAssets(filters?: { project_id?: string; step_key?: string }) {
  const params = new URLSearchParams()
  if (filters?.project_id) params.set('project_id', filters.project_id)
  if (filters?.step_key)   params.set('step_key', filters.step_key)
  const qs = params.toString() ? `?${params.toString()}` : ''
  const data = await request<{ success: boolean; assets: import('./types').AssetWithVersions[] }>(`/api/assets${qs}`)
  return data.assets || []
}

export async function reviewAsset(asset_id: string, action: 'approve' | 'reject', notes?: string) {
  const data = await request<{ success: boolean; asset: Asset }>(`/api/assets/${asset_id}/review`, {
    method: 'PATCH',
    body: JSON.stringify({ action, notes }),
  })
  return data.asset
}

// Invalidate
export async function invalidateFromStep(project_id: string, from_step: number) {
  return request(`/api/projects/${project_id}/invalidate-from-step`, {
    method: 'PATCH',
    body: JSON.stringify({ from_step }),
  })
}

// Generic pipeline node generation
export interface SfxEntry {
  name: string
  category: string
  trigger: string
  description: string
  duration_ms: number
  loop: boolean
  variations: number
  notes?: string
}

export interface ConceptArtResult {
  character_concepts: { name: string; role: string; prompt: string; design_notes: string; preview_url?: string; placeholder?: boolean }[]
  environment_concepts: { name: string; type: string; prompt: string; mood: string; design_notes: string; preview_url?: string; placeholder?: boolean }[]
  style_notes: string
}

export interface UIUXResult {
  screens: { name: string; description: string; elements: string[]; flow: string }[]
  design_system: { color_primary: string; color_secondary: string; color_accent: string; corner_radius: string; font_heading: string; font_body: string; button_style: string; icon_style: string }
  navigation_flow: string
  accessibility_notes: string
  hud_elements: string[]
}

export async function generateUIUX(project_id: string, input_context?: InputContext) {
  const data = await request<{ success: boolean; uiux: UIUXResult }>(
    '/api/generate/uiux',
    { method: 'POST', body: JSON.stringify({ project_id, input_context }) }
  )
  return data.uiux
}

export interface IconsResult {
  icon_style: { shape: string; border: string; shadow: string; base_size?: string; size_base?: string; color_palette?: string[]; style_keywords?: string[] }
  icons: { name: string; category: string; description: string; prompt: string; color_hint: string; usage: string; image_url?: string | null }[]
  total_count: number
}

export async function generateIcons(project_id: string, input_context?: InputContext) {
  const data = await request<{ success: boolean; icons: IconsResult }>(
    '/api/generate/icons',
    { method: 'POST', body: JSON.stringify({ project_id, input_context }) }
  )
  return data.icons
}

export interface HUDResult {
  layout: string
  elements: { name: string; type: string; position: string; data_source: string; visual_description: string; visibility: string; priority: string }[]
  style: { opacity: string; theme: string; color_palette: string[]; animation: string }
  responsive_notes: string
  implementation_notes: string
}

export async function generateHUD(project_id: string, input_context?: InputContext) {
  const data = await request<{ success: boolean; hud: HUDResult }>(
    '/api/generate/hud',
    { method: 'POST', body: JSON.stringify({ project_id, input_context }) }
  )
  return data.hud
}

export interface SplashArtResult {
  title: string
  image_prompt: string
  composition: string
  mood: string
  focal_point: string
  color_treatment: string
  style_reference: string
  dimensions: string
  format_notes: string
  image_url?: string | null
}

export async function generateSplashArt(project_id: string, input_context?: InputContext) {
  const data = await request<{ success: boolean; splash_art: SplashArtResult }>(
    '/api/generate/splash-art',
    { method: 'POST', body: JSON.stringify({ project_id, input_context }) }
  )
  return data.splash_art
}

export interface MarketingAsset {
  name: string
  platform: string
  type: string
  width: number
  height: number
  image_prompt: string
  copy: string
  image_url?: string | null
}

export interface MarketingResult {
  campaign_concept: string
  tagline: string
  assets: MarketingAsset[]
  total_count: number
}

export async function generateMarketing(project_id: string, input_context?: InputContext) {
  const data = await request<{ success: boolean; marketing: MarketingResult }>(
    '/api/generate/marketing',
    { method: 'POST', body: JSON.stringify({ project_id, input_context }) }
  )
  return data.marketing
}

export async function generateConceptArt(project_id: string, input_context?: InputContext) {
  const data = await request<{ success: boolean } & ConceptArtResult>(
    '/api/generate/concept-art',
    { method: 'POST', body: JSON.stringify({ project_id, input_context }) }
  )
  return { character_concepts: data.character_concepts || [], environment_concepts: data.environment_concepts || [], style_notes: data.style_notes }
}

export async function generateSfx(project_id: string, input_context?: InputContext) {
  const data = await request<{ success: boolean; sfx_pack: SfxEntry[]; implementation_notes: string }>(
    '/api/generate/sfx',
    { method: 'POST', body: JSON.stringify({ project_id, input_context }) }
  )
  return { sfx_pack: data.sfx_pack || [], implementation_notes: data.implementation_notes }
}

export async function generateBackgrounds(project_id: string, input_context?: InputContext) {
  const data = await request<{ success: boolean; backgrounds: BackgroundPreview[] }>(
    '/api/generate/backgrounds',
    { method: 'POST', body: JSON.stringify({ project_id, input_context }) }
  )
  return data.backgrounds || []
}

export interface BackgroundPreview {
  level_name: string
  environment: string
  prompt: string
  layers: string[]
  preview_url: string
  placeholder: boolean
}

export async function generateVisualGuide(project_id: string, input_context?: InputContext) {
  const data = await request<{ success: boolean; visual_guide: VisualGuide; meta: unknown }>(
    '/api/generate/visual-guide',
    { method: 'POST', body: JSON.stringify({ project_id, input_context }) }
  )
  return data.visual_guide
}

// 3D pipeline node generators (all return raw doc objects)
async function generateDoc(stepKey: string, project_id: string, input_context?: InputContext) {
  const data = await request<{ success: boolean; [key: string]: unknown }>(
    `/api/generate/${stepKey}`,
    { method: 'POST', body: JSON.stringify({ project_id, input_context }) }
  )
  return data[stepKey]
}

export const generateModeling   = (id: string, ctx?: InputContext) => generateDoc('modeling',   id, ctx)
export const generateCharaters  = (id: string, ctx?: InputContext) => generateDoc('charaters',  id, ctx)
export const generateVfx        = (id: string, ctx?: InputContext) => generateDoc('vfx',        id, ctx)
export const generateTexturing  = (id: string, ctx?: InputContext) => generateDoc('texturing',  id, ctx)
export const generateRigging    = (id: string, ctx?: InputContext) => generateDoc('rigging',    id, ctx)
export const generateLighting   = (id: string, ctx?: InputContext) => generateDoc('lighting',   id, ctx)
export const generateAnimation  = (id: string, ctx?: InputContext) => generateDoc('animation',  id, ctx)
export const generateCinematics = (id: string, ctx?: InputContext) => generateDoc('cinematics', id, ctx)
export const generateVoice      = (id: string, ctx?: InputContext) => generateDoc('voice',      id, ctx)

// Feedback
export async function submitFeedback(payload: {
  member_id?: string
  project_id?: string
  category: FeedbackCategory
  severity: FeedbackSeverity
  description: string
  url_context?: string
  screenshot_url?: string
}): Promise<Feedback> {
  const data = await request<{ success: boolean; feedback: Feedback }>('/api/feedback', {
    method: 'POST',
    body: JSON.stringify(payload),
  })
  return data.feedback
}

export async function getFeedback(filters?: { status?: FeedbackStatus; category?: FeedbackCategory; severity?: FeedbackSeverity }): Promise<Feedback[]> {
  const params = new URLSearchParams()
  if (filters?.status)   params.set('status', filters.status)
  if (filters?.category) params.set('category', filters.category)
  if (filters?.severity) params.set('severity', filters.severity)
  const qs = params.toString() ? `?${params.toString()}` : ''
  const data = await request<{ success: boolean; feedback: Feedback[] }>(`/api/feedback${qs}`)
  return data.feedback || []
}

export async function updateFeedback(id: string, payload: { status: FeedbackStatus; resolution_note?: string; resolved_by?: string }): Promise<Feedback> {
  const data = await request<{ success: boolean; feedback: Feedback }>(`/api/feedback/${id}`, {
    method: 'PATCH',
    body: JSON.stringify(payload),
  })
  return data.feedback
}

export async function getAdminUsers(): Promise<AdminUser[]> {
  const data = await request<{ success: boolean; users: AdminUser[] }>('/api/admin/users')
  return data.users
}

export async function inviteAdminUser(payload: { email: string; role: 'member' | 'admin' }): Promise<AdminUser> {
  const data = await request<{ success: boolean; user: AdminUser }>('/api/admin/users/invite', {
    method: 'POST',
    body: JSON.stringify(payload),
  })
  return data.user
}

export async function updateAdminUser(auth_id: string, payload: { display_name?: string; role?: 'member' | 'admin' }): Promise<AdminUser> {
  const data = await request<{ success: boolean; member: AdminUser }>(`/api/admin/users/${auth_id}`, {
    method: 'PATCH',
    body: JSON.stringify(payload),
  })
  return data.member
}

export async function createAdminUser(payload: {
  email: string; password: string; display_name: string; role: 'member' | 'admin'
}): Promise<AdminUser> {
  const data = await request<{ success: boolean; user: AdminUser }>('/api/admin/users', {
    method: 'POST',
    body: JSON.stringify(payload),
  })
  return data.user
}

// ─── Admin: integrations ──────────────────────────────────────────────────────

export async function getModelsConfig(): Promise<ModelsConfig> {
  const data = await request<{ success: boolean } & ModelsConfig>('/api/models')
  const { success: _, ...rest } = data
  return rest as ModelsConfig
}

export async function getAdminStepConfigs(): Promise<StepConfig[]> {
  const data = await request<{ success: boolean; step_configs: StepConfig[] }>('/api/admin/step-configs')
  return data.step_configs
}

export async function updateAdminStepConfig(stepKey: string, payload: Partial<StepConfig>): Promise<StepConfig> {
  const data = await request<{ success: boolean; step_config: StepConfig }>(`/api/admin/step-configs/${stepKey}`, {
    method: 'PATCH',
    body: JSON.stringify(payload),
  })
  return data.step_config
}

export async function getAdminWorkflows(): Promise<ComfyUIWorkflow[]> {
  const data = await request<{ success: boolean; workflows: ComfyUIWorkflow[] }>('/api/admin/comfyui-workflows')
  return data.workflows
}

export async function getAdminWorkflow(id: string): Promise<ComfyUIWorkflow> {
  const data = await request<{ success: boolean; workflow: ComfyUIWorkflow }>(`/api/admin/comfyui-workflows/${id}`)
  return data.workflow
}

export async function createAdminWorkflow(payload: {
  name: string; description?: string; workflow_json: Record<string, unknown>; inject_config: InjectConfig
}): Promise<ComfyUIWorkflow> {
  const data = await request<{ success: boolean; workflow: ComfyUIWorkflow }>('/api/admin/comfyui-workflows', {
    method: 'POST',
    body: JSON.stringify(payload),
  })
  return data.workflow
}

export async function updateAdminWorkflow(id: string, payload: Partial<ComfyUIWorkflow>): Promise<ComfyUIWorkflow> {
  const data = await request<{ success: boolean; workflow: ComfyUIWorkflow }>(`/api/admin/comfyui-workflows/${id}`, {
    method: 'PATCH',
    body: JSON.stringify(payload),
  })
  return data.workflow
}

export async function deleteAdminWorkflow(id: string): Promise<void> {
  await request(`/api/admin/comfyui-workflows/${id}`, { method: 'DELETE' })
}

export async function testAdminImage(
  model: string, prompt: string, width: number, height: number
): Promise<{ image_url: string }> {
  return request<{ success: boolean; image_url: string }>('/api/admin/test-image', {
    method: 'POST', body: JSON.stringify({ model, prompt, width, height }),
  })
}

export async function testAdminWorkflow(
  id: string,
  values: { prompt?: string; width?: number; height?: number; seed?: number; extras?: Record<string, string | number> }
): Promise<{ image_url: string; job_id: string }> {
  const data = await request<{ success: boolean; image_url: string; job_id: string }>(
    `/api/admin/comfyui-workflows/${id}/test`,
    { method: 'POST', body: JSON.stringify(values) }
  )
  return { image_url: data.image_url, job_id: data.job_id }
}

// ─── Admin: prompt configs ────────────────────────────────────────────────────

export async function getAdminPromptConfigs(): Promise<PromptConfig[]> {
  const data = await request<{ success: boolean; prompt_configs: PromptConfig[] }>('/api/admin/prompt-configs')
  return data.prompt_configs
}

export async function updateAdminPromptConfig(key: string, payload: { r2_path?: string | null; description?: string | null }): Promise<PromptConfig> {
  const data = await request<{ success: boolean; prompt_config: PromptConfig }>(`/api/admin/prompt-configs/${key}`, {
    method: 'PATCH',
    body: JSON.stringify(payload),
  })
  return data.prompt_config
}

export async function saveCanvasLayout(projectId: string, layout: unknown): Promise<void> {
  await request(`/api/projects/${projectId}/canvas`, {
    method: 'PUT',
    body: JSON.stringify({ canvas_layout: layout }),
  })
}

export async function summarizeFeedback(): Promise<{ summary: string; count: number }> {
  const data = await request<{ success: boolean; summary: string; count: number }>('/api/feedback/summary', { method: 'POST' })
  return { summary: data.summary, count: data.count }
}

// Generic pipeline node approval — stores result in concept.pipeline.{stepKey}
export async function approveNode(project_id: string, stepKey: string, nodeData: unknown, member_id?: string) {
  return request(`/api/projects/${project_id}/approve-node`, {
    method: 'POST',
    body: JSON.stringify({ stepKey, data: nodeData, member_id }),
  })
}

// ─── Image Reference ──────────────────────────────────────────────────────────

import type { ImageRef, CharacterRefStatus, GlobalRefStatus } from './types'

export async function startImageReference(project_id: string): Promise<void> {
  await request(`/api/projects/${project_id}/image-reference/start`, { method: 'POST', body: JSON.stringify({}) })
}

export async function getImageReferenceStatus(project_id: string): Promise<{ status: GlobalRefStatus; prompt_used: string; max_pool: number }> {
  const data = await request<{ success: boolean; status: GlobalRefStatus; prompt_used: string; max_pool: number }>(`/api/projects/${project_id}/image-reference`)
  return { status: data.status, prompt_used: data.prompt_used, max_pool: data.max_pool }
}

export async function getImageReferencePool(project_id: string): Promise<ImageRef[]> {
  const data = await request<{ success: boolean; images: ImageRef[] }>(`/api/projects/${project_id}/image-reference/pool`)
  return data.images
}

export async function generateImageReferenceRound(project_id: string, count: number): Promise<ImageRef[]> {
  const data = await request<{ success: boolean; images: ImageRef[] }>(`/api/projects/${project_id}/image-reference/generate`, {
    method: 'POST', body: JSON.stringify({ count }),
  })
  return data.images
}

export async function approveImageReferenceSelection(project_id: string, selected_ids: string[]): Promise<ImageRef[]> {
  const data = await request<{ success: boolean; selected: ImageRef[] }>(`/api/projects/${project_id}/image-reference/approve`, {
    method: 'POST', body: JSON.stringify({ selected_ids }),
  })
  return data.selected
}

import type { CharacterRenderStatus, AssetVersion } from './types'

export async function getCharatersStatus(project_id: string): Promise<CharacterRenderStatus[]> {
  const data = await request<{ success: boolean; characters: CharacterRenderStatus[] }>(`/api/projects/${project_id}/charaters/status`)
  return data.characters
}

export async function generateCharacterRender(project_id: string, char_key: string): Promise<{ version: AssetVersion | null; image_url: string }> {
  const data = await request<{ success: boolean; version: AssetVersion | null; image_url: string }>(`/api/projects/${project_id}/charaters/${char_key}/generate`, {
    method: 'POST', body: JSON.stringify({}),
  })
  return { version: data.version, image_url: data.image_url }
}

export async function approveCharacterRender(project_id: string, char_key: string): Promise<void> {
  await request(`/api/projects/${project_id}/charaters/${char_key}/approve`, { method: 'POST', body: JSON.stringify({}) })
}

export async function approveCharatersNode(project_id: string): Promise<void> {
  await request(`/api/projects/${project_id}/charaters/approve-node`, { method: 'POST', body: JSON.stringify({}) })
}

// Request peer review for a pipeline node
export async function requestNodeReview(project_id: string, stepKey: string, reviewer_id: string, nodeData: unknown) {
  return request(`/api/projects/${project_id}/request-node-review`, {
    method: 'POST',
    body: JSON.stringify({ stepKey, reviewer_id, nodeData }),
  })
}

// Reviewer submits their review
export async function submitReview(job_id: string, review_status: 'reviewed' | 'changes_requested', reviewer_note?: string) {
  return request(`/api/projects/jobs/${job_id}/submit-review`, {
    method: 'PATCH',
    body: JSON.stringify({ review_status, reviewer_note }),
  })
}

// Get all jobs pending review for a member
type PendingReviewsResult = (import('./types').GenerationJob & { projects: { id: string; name: string } })[]
const _pendingReviewsCache = new Map<string, { result: Promise<PendingReviewsResult>; ts: number }>()
const PENDING_REVIEWS_TTL = 10_000

export function getPendingReviews(member_id: string): Promise<PendingReviewsResult> {
  const cached = _pendingReviewsCache.get(member_id)
  if (cached && Date.now() - cached.ts < PENDING_REVIEWS_TTL) return cached.result
  const result = request<{ success: boolean; jobs: PendingReviewsResult }>(
    `/api/projects/pending-reviews?member_id=${member_id}`
  ).then(data => data.jobs || []).catch(() => [])
  _pendingReviewsCache.set(member_id, { result, ts: Date.now() })
  return result
}

export interface ArtDirectionIntakeResult {
  description: string
  world_summary: {
    tone: string[]
    mood: string
    themes: string[]
    core_fantasy: string
    contradictions: string[]
  }
  key_elements: {
    characters: { name: string; role: string; behavior: string; visual_identity: string; gameplay_implications: string }[]
    environments: { name: string; gameplay_function: string; visual_language: string; emotional_impact: string }[]
    technology: { advancement_level: string; visual_logic: string; material_identity: string; world_interaction: string }
    narrative_elements: { core_conflict: string; visual_storytelling: string[]; symbolism: string[] }
  }
  visual_keywords: { style: string[]; world: string[]; character: string[]; material: string[]; fx: string[]; mood: string[] }
  visual_references: { titles: string[]; direction: string; rationale: string }
  art_direction_pillars: { name: string; description: string }[]
  ui_visual_direction: { style: string; palette_notes: string; typography_direction: string; iconography_style: string; hud_philosophy: string; menu_feel: string }
  splash_and_marketing: { key_art_direction: string; composition_notes: string; brand_identity: string; social_format_guidance: string }
  open_questions: { gap: string; type: string; impact: string }[]
  risks: { risk: string; type: string }[]
  acceptance_criteria: { clear_visual_direction: boolean; production_ready: boolean; concept_art_executable: boolean; cross_team_understandable: boolean; notes: string }
}

export async function generateArtDirectionIntake(project_id: string, input_context?: InputContext) {
  const data = await request<{ success: boolean; art_direction_intake: ArtDirectionIntakeResult; meta: unknown }>(
    '/api/generate/art-direction-intake',
    { method: 'POST', body: JSON.stringify({ project_id, input_context }) }
  )
  return data.art_direction_intake
}

export interface VisualGuide {
  style_summary: string
  palette: { name: string; hex: string; usage: string }[]
  typography: { heading: string; body: string; hud: string }
  sprite_rules: string[]
  background_rules: string[]
  ui_rules: string[]
  lighting: string
  key_references: string[]
  do_list: string[]
  dont_list: string[]
}