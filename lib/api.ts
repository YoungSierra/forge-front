import type { GDD, SpritePreview, Project, Asset, ValidationResult, ScriptFile, CodeGenerationResult, Member, ProjectMember, Discipline, Feedback, FeedbackCategory, FeedbackSeverity, FeedbackStatus, AdminUser } from './types'

export type { ScriptFile, CodeGenerationResult }

export const BACKEND_URL = process.env.NEXT_PUBLIC_BACKEND_URL || 'http://localhost:8000'
export const assetUrl = (path: string) =>
  path ? (path.startsWith('http') ? path : `${BACKEND_URL}${path}`) : ''

async function request<T>(path: string, options?: RequestInit): Promise<T> {
  const res = await fetch(`${BACKEND_URL}${path}`, {
    headers: { 'Content-Type': 'application/json' },
    ...options,
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

// Step 1
export async function generateGDD(prompt: string) {
  const data = await request<{ success: boolean; gdd: GDD; meta: unknown }>('/api/generate/gdd', {
    method: 'POST',
    body: JSON.stringify({ prompt }),
  })
  return { gdd: data.gdd, meta: data.meta }
}

export async function approveStep1(payload: { gdd: GDD; prompt: string; meta: unknown }) {
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
export async function generateSprites(project_id: string) {
  const data = await request<{ success: boolean; sprites: SpritePreview[] }>(
    '/api/generate/sprites',
    { method: 'POST', body: JSON.stringify({ project_id }) }
  )
  return data.sprites || []
}

export async function approveStep2(project_id: string, sprites: SpritePreview[]) {
  return request(`/api/projects/${project_id}/approve-step2`, {
    method: 'POST',
    body: JSON.stringify({ approved_sprites: sprites }),
  })
}

// Step 3
export async function generateLevels(project_id: string) {
  const data = await request<{ success: boolean; levels: unknown[] }>(
    '/api/generate/levels',
    { method: 'POST', body: JSON.stringify({ project_id }) }
  )
  return data.levels || []
}

export async function approveStep3(project_id: string, levels: unknown[]) {
  return request(`/api/projects/${project_id}/approve-step3`, {
    method: 'POST',
    body: JSON.stringify({ approved_levels: levels }),
  })
}

// Step 4
export async function generateCode(project_id: string): Promise<CodeGenerationResult> {
  const data = await request<{
    success: boolean
    engine: string
    files: ScriptFile[]
    architecture_md: string
    meta: unknown
  }>('/api/generate/code', {
    method: 'POST',
    body: JSON.stringify({ project_id })
  })
  return {
    engine: data.engine,
    files: data.files,
    architecture_md: data.architecture_md
  }
}

export async function approveStep4(
  project_id: string,
  result: CodeGenerationResult
): Promise<unknown> {
  return request(`/api/projects/${project_id}/approve-step4`, {
    method: 'POST',
    body: JSON.stringify({
      files: result.files,
      architecture_md: result.architecture_md,
      engine: result.engine
    })
  })
}

// Step 5
export async function generateAudio(project_id: string) {
  const data = await request<{ success: boolean; audio: { sfx: unknown[]; music: unknown[] } }>(
    '/api/generate/audio',
    { method: 'POST', body: JSON.stringify({ project_id }) }
  )
  return data.audio
}

export async function approveStep5(project_id: string, audio: unknown) {
  return request(`/api/projects/${project_id}/approve-step5`, {
    method: 'POST',
    body: JSON.stringify({ audio }),
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

export async function getMemberByAuth(auth_user_id: string): Promise<Member | null> {
  try {
    const data = await request<{ success: boolean; member: Member }>(`/api/members/by-auth/${auth_user_id}`)
    return data.member
  } catch { return null }
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

export async function generateUIUX(project_id: string) {
  const data = await request<{ success: boolean; uiux: UIUXResult }>(
    '/api/generate/uiux',
    { method: 'POST', body: JSON.stringify({ project_id }) }
  )
  return data.uiux
}

export interface IconsResult {
  icon_style: { shape: string; border: string; shadow: string; size_base: string; color_scheme: string }
  icons: { name: string; category: string; description: string; prompt: string; color_hint: string; usage: string }[]
  total_count: number
}

export async function generateIcons(project_id: string) {
  const data = await request<{ success: boolean; icons: IconsResult }>(
    '/api/generate/icons',
    { method: 'POST', body: JSON.stringify({ project_id }) }
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

export async function generateHUD(project_id: string) {
  const data = await request<{ success: boolean; hud: HUDResult }>(
    '/api/generate/hud',
    { method: 'POST', body: JSON.stringify({ project_id }) }
  )
  return data.hud
}

export async function generateConceptArt(project_id: string) {
  const data = await request<{ success: boolean } & ConceptArtResult>(
    '/api/generate/concept-art',
    { method: 'POST', body: JSON.stringify({ project_id }) }
  )
  return { character_concepts: data.character_concepts || [], environment_concepts: data.environment_concepts || [], style_notes: data.style_notes }
}

export async function generateSfx(project_id: string) {
  const data = await request<{ success: boolean; sfx_pack: SfxEntry[]; implementation_notes: string }>(
    '/api/generate/sfx',
    { method: 'POST', body: JSON.stringify({ project_id }) }
  )
  return { sfx_pack: data.sfx_pack || [], implementation_notes: data.implementation_notes }
}

export async function generateBackgrounds(project_id: string) {
  const data = await request<{ success: boolean; backgrounds: BackgroundPreview[] }>(
    '/api/generate/backgrounds',
    { method: 'POST', body: JSON.stringify({ project_id }) }
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

export async function generateVisualGuide(project_id: string) {
  const data = await request<{ success: boolean; visual_guide: VisualGuide; meta: unknown }>(
    '/api/generate/visual-guide',
    { method: 'POST', body: JSON.stringify({ project_id }) }
  )
  return data.visual_guide
}

// 3D pipeline node generators (all return raw doc objects)
async function generateDoc(stepKey: string, project_id: string) {
  const data = await request<{ success: boolean; [key: string]: unknown }>(
    `/api/generate/${stepKey}`,
    { method: 'POST', body: JSON.stringify({ project_id }) }
  )
  return data[stepKey]
}

export const generateModeling   = (id: string) => generateDoc('modeling',   id)
export const generateCharaters  = (id: string) => generateDoc('charaters',  id)
export const generateVfx        = (id: string) => generateDoc('vfx',        id)
export const generateTexturing  = (id: string) => generateDoc('texturing',  id)
export const generateRigging    = (id: string) => generateDoc('rigging',    id)
export const generateLighting   = (id: string) => generateDoc('lighting',   id)
export const generateAnimation  = (id: string) => generateDoc('animation',  id)
export const generateCinematics = (id: string) => generateDoc('cinematics', id)
export const generateVoice      = (id: string) => generateDoc('voice',      id)

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
export async function approveNode(project_id: string, stepKey: string, nodeData: unknown) {
  return request(`/api/projects/${project_id}/approve-node`, {
    method: 'POST',
    body: JSON.stringify({ stepKey, data: nodeData }),
  })
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
export async function getPendingReviews(member_id: string) {
  const data = await request<{ success: boolean; jobs: (import('./types').GenerationJob & { projects: { id: string; name: string } })[] }>(
    `/api/projects/pending-reviews?member_id=${member_id}`
  )
  return data.jobs || []
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