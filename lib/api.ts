import type { GDD, SpritePreview, Project, Asset, ValidationResult, ScriptFile, CodeGenerationResult, Member, ProjectMember, Discipline, Feedback, FeedbackCategory, FeedbackSeverity, FeedbackStatus, AdminUser, StepConfig, ComfyUIWorkflow, InjectConfig, ModelsConfig, PromptConfig, RepoConfig, ActionInstance, ActionType, ChangelogEntry, ChangelogType } from './types'
import type { InputContext } from './nodeExecutionContext'
import { createClient } from '@/lib/supabase'

export type { ScriptFile, CodeGenerationResult }
export type { InputContext }

export const BACKEND_URL = process.env.NEXT_PUBLIC_BACKEND_URL || 'http://localhost:8000'
export const assetUrl = (path: string) =>
  path ? (path.startsWith('http') ? path : `${BACKEND_URL}${path}`) : ''

// ── Auth headers (Frente 2 Multi-Org) ─────────────────────────────────────────
// Adjunta el JWT de Supabase (Authorization: Bearer) + la org activa (X-Org-Id) a cada llamada.
// Mantiene x-member-id durante la transición (el back lo ignora una vez montado requireAuth).
let _sb: ReturnType<typeof createClient> | null = null
function sbClient() {
  if (typeof window === 'undefined') return null
  if (!_sb) _sb = createClient()
  return _sb
}
export async function authHeaders(): Promise<Record<string, string>> {
  const h: Record<string, string> = {}
  if (typeof window !== 'undefined') {
    const memberId = localStorage.getItem('forge_member_id')
    if (memberId) h['x-member-id'] = memberId
    const orgId = localStorage.getItem('forge_active_org_id')
    if (orgId) h['x-org-id'] = orgId
  }
  const client = sbClient()
  if (client) {
    const { data } = await client.auth.getSession()
    const token = data.session?.access_token
    if (token) h['Authorization'] = `Bearer ${token}`
  }
  return h
}

async function request<T>(path: string, options?: RequestInit): Promise<T> {
  const auth = await authHeaders()
  const res = await fetch(`${BACKEND_URL}${path}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...auth,
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
export type GenerateGDDResult =
  | { async: false; gdd: GDD; meta: unknown }
  | { async: true; project_id: string }

export async function generateGDD(prompt: string, projectId?: string): Promise<GenerateGDDResult> {
  const data = await request<{ success: boolean; async?: boolean; gdd?: GDD; meta?: unknown; project_id?: string }>(
    '/api/generate/gdd',
    { method: 'POST', body: JSON.stringify({ prompt, project_id: projectId }) }
  )
  if (data.async) return { async: true, project_id: data.project_id || projectId || '' }
  return { async: false, gdd: data.gdd!, meta: data.meta }
}

export async function pollForGDD(projectId: string, timeoutMs = 600_000): Promise<GDD> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    await new Promise(r => setTimeout(r, 10_000))
    try {
      // _t rompe el cache HTTP del browser para que siempre llegue la respuesta fresca
      const data = await request<{ success: boolean; project: Project }>(`/api/projects/${projectId}?_t=${Date.now()}`)
      const gdd = data.project?.concept?.pipeline?.gdd
      if (gdd) return gdd
    } catch { /* continuar */ }
  }
  throw new Error('GDD generation timed out after 10 minutes — check n8n and try again')
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

export async function getGDDRaw(projectId: string): Promise<string> {
  const res = await fetch(`${BACKEND_URL}/api/projects/${projectId}/gdd/raw`, { headers: await authHeaders() })
  if (!res.ok) throw new Error('GDD raw not found')
  return res.text()
}

export async function getADIRaw(projectId: string): Promise<string> {
  const res = await fetch(`${BACKEND_URL}/api/projects/${projectId}/art-direction-intake/raw`, { headers: await authHeaders() })
  if (!res.ok) throw new Error('Art Direction Intake raw not found')
  return res.text()
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

export async function addProjectMember(project_id: string, member_id: string, project_role?: string, discipline?: string): Promise<ProjectMember> {
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
export interface UnifiedAssetVersion {
  id: string
  storage_url: string | null
  version_number: number
  is_current: boolean
  model_used: string | null
  /** Aprobada es distinto de vigente: una version puede estar a la vista sin haber sido elegida. */
  approved_at: string | null
  created_at: string
  /** Quién la generó. Null en las versiones anteriores a que se registrara el autor. */
  author?: string | null
}

export interface UnifiedAsset {
  id: string
  source: 'forge' | 'legacy' | 'generated' | 'library'   // 'library' = subido por el usuario al proyecto
  name: string
  project_id: string | null
  node_key: string | null
  node_title: string | null
  phase: string | null
  format: 'image' | 'document' | 'markdown' | 'audio' | 'model_3d' | 'code' | 'other'
  status: string
  storage_url: string | null
  content: string | null
  /** Primeras líneas del texto, solo para documentos y solo en modo media: la tarjeta muestra
   *  un asomo del contenido en vez de un ícono. `content` sigue sin viajar. */
  preview?: string | null
  created_at: string
  versions: UnifiedAssetVersion[]
}

export async function getProjectAssets(projectId?: string): Promise<UnifiedAsset[]> {
  const qs = projectId ? `?project_id=${projectId}` : ''
  const data = await request<{ success: boolean; assets: UnifiedAsset[] }>(
    `/api/assets/project-assets${qs}`,
  )
  return data.assets || []
}

// Identidad visual del proyecto para el moodboard. `source` dice de dónde salió: 'style_guide'
// si el 3.9 ya produjo la paleta bloqueada, 'default' si el proyecto todavía no tiene arte.
export interface MoodboardTheme {
  accent: string
  colors: string[]
  motion: 'neutral' | 'rise' | 'streak' | 'fall' | 'pulse'
  source: 'style_guide' | 'default'
}

export const NEUTRAL_THEME: MoodboardTheme = {
  accent: '#7d8493', colors: ['#7d8493'], motion: 'neutral', source: 'default',
}

// Sube un archivo a la librería DEL PROYECTO. No pertenece a ningún nodo: cualquiera puede
// referenciarlo después conectándolo en el canvas como `library_asset`.
export async function uploadLibraryAsset(
  projectId: string,
  file: File,
  displayName?: string,
): Promise<{ id: string; storage_url: string }> {
  const memberId = typeof window !== 'undefined' ? localStorage.getItem('forge_member_id') : null
  const fd = new FormData()
  fd.append('file', file)
  if (displayName) fd.append('display_name', displayName)
  if (memberId)    fd.append('member_id', memberId)

  // Sin Content-Type: el browser pone el boundary del multipart.
  const res = await fetch(`${BACKEND_URL}/api/projects/${projectId}/library`, {
    method: 'POST', headers: await authHeaders(), body: fd,
  })
  if (!res.ok) {
    let msg = `Upload failed: ${res.status}`
    try { const b = await res.json(); msg = b.error || b.message || msg } catch {}
    throw new Error(msg)
  }
  const data = await res.json()
  return data.asset
}

// Moodboard: solo activos que se ven, y sin el campo `content`. El listado completo de un
// proyecto son ~1,5 MB de texto que la galería no muestra; así viaja el metadato y la URL.
export async function getProjectMedia(
  projectId: string,
): Promise<{ assets: UnifiedAsset[]; theme: MoodboardTheme }> {
  const data = await request<{ success: boolean; assets: UnifiedAsset[]; theme?: MoodboardTheme }>(
    `/api/assets/project-assets?project_id=${projectId}&media=1`,
  )
  return { assets: data.assets || [], theme: data.theme || NEUTRAL_THEME }
}

// El texto completo de UN documento, para cuando se abre en el moodboard. El listado va sin
// `content` a propósito; esto lo trae de a uno y solo cuando hace falta.
export async function getAssetContent(
  assetId: string,
): Promise<{ name: string; format: string; content: string }> {
  return request<{ success: boolean; name: string; format: string; content: string }>(
    `/api/assets/${assetId}/content`,
  )
}

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

export const generateModelingCharacters   = (id: string, ctx?: InputContext) => generateDoc('modeling_characters',   id, ctx)
export const generateModelingEnvironments = (id: string, ctx?: InputContext) => generateDoc('modeling_environments', id, ctx)
export const generateModelingProps        = (id: string, ctx?: InputContext) => generateDoc('modeling_props',        id, ctx)
export const generateEnvironments         = (id: string, ctx?: InputContext) => generateDoc('environments',          id, ctx)
export const generateProps                = (id: string, ctx?: InputContext) => generateDoc('props',                 id, ctx)
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

// Sin requireAdmin — el propio usuario actualiza su display_name al aceptar invite
export async function updateOwnProfile(auth_user_id: string, display_name: string): Promise<void> {
  await fetch(`${process.env.NEXT_PUBLIC_API_URL}/api/members/profile`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ auth_user_id, display_name }),
  })
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
  refinement_capable?: boolean; mask_capable?: boolean
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

export async function uploadToComfyUI(blob: Blob, filename: string): Promise<string> {
  const buffer = await blob.arrayBuffer()
  const bytes  = new Uint8Array(buffer)
  let binary   = ''
  for (let i = 0; i < bytes.byteLength; i++) binary += String.fromCharCode(bytes[i])
  const data = await request<{ success: boolean; filename: string }>('/api/admin/comfyui-upload', {
    method: 'POST',
    body: JSON.stringify({ image_base64: btoa(binary), filename }),
  })
  return data.filename
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
  values: { prompt?: string; width?: number; height?: number; seed?: number; extras?: Record<string, string | number>; storage_path?: string }
): Promise<{ image_url: string; glb_urls: string[]; job_id: string; prepared_workflow?: Record<string, unknown> }> {
  const data = await request<{ success: boolean; image_url: string; glb_urls?: string[]; job_id: string; prepared_workflow?: Record<string, unknown> }>(
    `/api/admin/comfyui-workflows/${id}/test`,
    { method: 'POST', body: JSON.stringify(values) }
  )
  return { image_url: data.image_url, glb_urls: data.glb_urls ?? [], job_id: data.job_id, prepared_workflow: data.prepared_workflow }
}

// ─── Admin: skill configs ─────────────────────────────────────────────────────

export interface SkillConfig {
  key:         string
  r2_path:     string | null
  description: string | null
  updated_at:  string | null
}

export async function getAdminSkillConfigs(): Promise<SkillConfig[]> {
  const data = await request<{ success: boolean; skill_configs: SkillConfig[] }>('/api/admin/skill-configs')
  return data.skill_configs
}

export async function updateAdminSkillConfig(key: string, payload: { r2_path?: string | null }): Promise<SkillConfig> {
  const data = await request<{ success: boolean; skill_config: SkillConfig }>(`/api/admin/skill-configs/${key}`, {
    method: 'PATCH',
    body:   JSON.stringify(payload),
  })
  return data.skill_config
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

// ─── Repo export ──────────────────────────────────────────────────────────────

export async function getProjectRepoConfig(projectId: string): Promise<RepoConfig | null> {
  const data = await request<{ success: boolean; repo_config: RepoConfig | null }>(`/api/projects/${projectId}/repo-config`)
  return data.repo_config
}

export async function saveProjectRepoConfig(
  projectId: string,
  payload: { repo_url?: string; repo_token?: string }
): Promise<RepoConfig> {
  const data = await request<{ success: boolean; repo_config: RepoConfig }>(`/api/projects/${projectId}/repo-config`, {
    method: 'PUT',
    body: JSON.stringify(payload),
  })
  return data.repo_config
}

export async function createProjectRepo(projectId: string): Promise<{ ok: boolean; repo_url: string; message?: string }> {
  const data = await request<{ success: boolean; repo_url: string; message?: string }>(`/api/projects/${projectId}/repo/create`, { method: 'POST' })
  return { ok: data.success, repo_url: data.repo_url, message: data.message }
}

export async function validateProjectRepo(projectId: string): Promise<{ ok: boolean; message: string }> {
  return request<{ ok: boolean; message: string }>(`/api/projects/${projectId}/repo/validate`, { method: 'POST' })
}

export async function exportProjectToRepo(
  projectId: string,
  targetEngine?: string
): Promise<{ ok: boolean; pushed: string[]; errors: string[]; engine?: string }> {
  const data = await request<{ success: boolean; pushed: string[]; errors: string[]; engine?: string }>(`/api/projects/${projectId}/repo/export`, {
    method: 'POST',
    body: JSON.stringify({ target_engine: targetEngine }),
  })
  return { ok: data.success, pushed: data.pushed ?? [], errors: data.errors ?? [], engine: data.engine }
}

// ─── Idea Generator ──────────────────────────────────────────────────────────

export type IdeaCard = {
  title:         string
  elevator_pitch: string
  genre:         string
  tone:          string
  core_mechanic: string
  unique_hook:   string
  visual_style:  string
  tags:          string[]
  image_prompt:  string
  image_url:     string | null
}

export async function generateIdeas(payload: {
  prompt:   string
  genre?:   string
  tone?:    string
  scope?:   string
  engine?:  string
  count?:   number
  exclude?: string[]
}): Promise<{ ideas: IdeaCard[]; meta: unknown }> {
  return request<{ success: boolean; ideas: IdeaCard[]; meta: unknown }>('/api/gen-idea', {
    method: 'POST',
    body:   JSON.stringify(payload),
  })
}

export async function getIdeaCandidate(projectId: string): Promise<{ id: string; title: string; idea_data: IdeaCard; original_description: string | null; selected_at: string } | null> {
  const data = await request<{ success: boolean; candidate: { id: string; title: string; idea_data: IdeaCard; original_description: string | null; selected_at: string } | null }>(`/api/projects/${projectId}/idea-candidate`)
  return data.candidate
}

export async function saveIdeaCandidate(projectId: string, idea: IdeaCard, originalDescription: string): Promise<void> {
  await request(`/api/projects/${projectId}/idea-candidate`, {
    method: 'POST',
    body:   JSON.stringify({ title: idea.title, idea_data: idea, original_description: originalDescription }),
  })
}

export async function updateProjectName(projectId: string, name: string): Promise<void> {
  await request(`/api/projects/${projectId}/name`, {
    method: 'PATCH',
    body:   JSON.stringify({ name }),
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

export async function saveRefinedImageReference(project_id: string, image_url: string, refined_from_id: string): Promise<ImageRef> {
  const data = await request<{ success: boolean; image: ImageRef }>(`/api/projects/${project_id}/image-reference/save-refined`, {
    method: 'POST', body: JSON.stringify({ image_url, refined_from_id }),
  })
  return data.image
}

import type { CharacterRenderStatus, AssetVersion, ModelingCharacterStatus } from './types'
import type { RunScope } from './types'

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

export async function saveRefinedCharacterRender(project_id: string, char_key: string, storage_url: string): Promise<{ version: AssetVersion | null; image_url: string }> {
  const data = await request<{ success: boolean; version: AssetVersion | null; image_url: string }>(
    `/api/projects/${project_id}/charaters/${char_key}/save-refined`,
    { method: 'POST', body: JSON.stringify({ storage_url }) }
  )
  return { version: data.version, image_url: data.image_url }
}

export async function approveCharacterRender(project_id: string, char_key: string): Promise<void> {
  await request(`/api/projects/${project_id}/charaters/${char_key}/approve`, { method: 'POST', body: JSON.stringify({}) })
}

export async function restoreCharacterVersion(project_id: string, char_key: string, version_id: string): Promise<AssetVersion> {
  const data = await request<{ success: boolean; version: AssetVersion }>(
    `/api/projects/${project_id}/charaters/${char_key}/restore-version/${version_id}`,
    { method: 'POST', body: JSON.stringify({}) }
  )
  return data.version
}

export async function approveCharatersNode(project_id: string): Promise<void> {
  await request(`/api/projects/${project_id}/charaters/approve-node`, { method: 'POST', body: JSON.stringify({}) })
}

export async function getModelingCharactersStatus(project_id: string): Promise<ModelingCharacterStatus[]> {
  const data = await request<{ success: boolean; characters: ModelingCharacterStatus[] }>(`/api/projects/${project_id}/modeling-characters/status`)
  return data.characters
}

export async function generateModelingCharacter(project_id: string, char_key: string): Promise<{ version: AssetVersion | null; glb_url: string | null; texture_url: string; glb_urls: string[] }> {
  const data = await request<{ success: boolean; version: AssetVersion | null; glb_url: string | null; texture_url: string; glb_urls: string[] }>(
    `/api/projects/${project_id}/modeling-characters/${char_key}/generate`,
    { method: 'POST', body: JSON.stringify({}) }
  )
  return { version: data.version, glb_url: data.glb_url, texture_url: data.texture_url, glb_urls: data.glb_urls ?? [] }
}

export async function approveModelingCharacter(project_id: string, char_key: string): Promise<void> {
  await request(`/api/projects/${project_id}/modeling-characters/${char_key}/approve`, { method: 'POST', body: JSON.stringify({}) })
}

export async function approveModelingCharactersNode(project_id: string): Promise<void> {
  await request(`/api/projects/${project_id}/modeling-characters/approve-node`, { method: 'POST', body: JSON.stringify({}) })
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

// ── Pipeline config ──────────────────────────────────────────────────────────

export type PipelineSuggestion = {
  nodeId:  string
  active:  boolean
  reason:  string
}

export type PipelineCatalogEntry = {
  nodeId:      string
  phase:       string
  label:       string
  description: string
}

export async function suggestPipeline(project_id: string, force = false): Promise<{ suggestions: PipelineSuggestion[]; catalog: PipelineCatalogEntry[]; from_cache?: boolean }> {
  const url = `/api/projects/${project_id}/suggest-pipeline${force ? '?force=true' : ''}`
  const data = await request<{ success: boolean; suggestions: PipelineSuggestion[]; catalog: PipelineCatalogEntry[]; from_cache?: boolean }>(
    url,
    { method: 'POST' }
  )
  return { suggestions: data.suggestions, catalog: data.catalog, from_cache: data.from_cache }
}

export async function savePipelineConfig(project_id: string, active_nodes: string[]): Promise<void> {
  await request(`/api/projects/${project_id}/pipeline-config`, {
    method: 'PATCH',
    body: JSON.stringify({ active_nodes }),
  })
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

// ─── Stage 0 — Idea Expansion & Direction Lock ───────────────────────────────

export async function ideaExpansion(payload: {
  project_id: string
  raw_idea: string
  genre?: string
  tone?: string
  scope?: string
  engine?: string
}): Promise<{ output: string; meta: unknown }> {
  const data = await request<{ success: boolean; output: string; meta: unknown }>(
    '/api/generate/idea-expansion',
    { method: 'POST', body: JSON.stringify(payload) }
  )
  return { output: data.output, meta: data.meta }
}

export async function directionLock(payload: {
  project_id: string
  stage0a_output: string
  selected_direction: 1 | 2 | 3
}): Promise<{ game_idea: string; meta: unknown }> {
  const data = await request<{ success: boolean; game_idea: string; meta: unknown }>(
    '/api/generate/direction-lock',
    { method: 'POST', body: JSON.stringify(payload) }
  )
  return { game_idea: data.game_idea, meta: data.meta }
}

// ─── GDD Sections ────────────────────────────────────────────────────────────

export type GddSectionKey =
  | 'gdd_overview'
  | 'gdd_genre_platform'
  | 'gdd_gameplay'
  | 'gdd_core_loop'
  | 'gdd_mechanics'
  | 'gdd_progression'
  | 'gdd_narrative'
  | 'gdd_characters'
  | 'gdd_ui_ux'
  | 'gdd_art_audio'
  | 'gdd_economy'
  | 'gdd_technical'

export interface GddSectionStatus {
  section_key: GddSectionKey
  order: number
  generated: boolean
  generated_at: string | null
  output: string | null
}

export async function generateGddSection(payload: {
  project_id: string
  section_key: GddSectionKey
  prior_context?: string
}): Promise<{ output: string; section_key: GddSectionKey; meta: unknown }> {
  const data = await request<{ success: boolean; output: string; section_key: GddSectionKey; meta: unknown }>(
    '/api/generate/gdd-section',
    { method: 'POST', body: JSON.stringify(payload) }
  )
  return { output: data.output, section_key: data.section_key, meta: data.meta }
}

export async function getGddSections(project_id: string): Promise<GddSectionStatus[]> {
  const data = await request<{ success: boolean; sections: GddSectionStatus[] }>(
    `/api/generate/gdd-section/${project_id}`
  )
  return data.sections
}

// ─── Pipeline config ──────────────────────────────────────────────────────────

export interface PipelineNodeConfig {
  step_key:         string
  label:            string
  order_index:      number | null
  integration_type: string
  model_name:       string | null
  is_active:        boolean
}

export interface PipelineContainerConfig {
  step_key:         string
  label:            string
  order_index:      number | null
  integration_type: string
  is_active:        boolean
  children:         PipelineNodeConfig[]
}

export async function getPipelineConfig(): Promise<PipelineContainerConfig[]> {
  const data = await request<{ success: boolean; containers: PipelineContainerConfig[] }>('/api/pipeline/config')
  return data.containers
}

// ─── Phase canvas types ────────────────────────────────────────────────────────

export interface PhaseNodeConfig {
  step_key:         string
  label:            string
  description:      string | null
  order_index:      number
  integration_type: string | null
  model_name:       string | null
  is_active:        boolean
}

export interface PhaseContainerConfig {
  step_key:         string
  label:            string
  description:      string | null
  order_index:      number
  integration_type: string | null
  is_active:        boolean
  nodes:            PhaseNodeConfig[]
}

export interface PhaseConfig {
  step_key:    string
  label:       string
  description: string | null
  order_index: number
  is_active:   boolean
  containers:  PhaseContainerConfig[]
}

export async function getPipelinePhases(): Promise<PhaseConfig[]> {
  const data = await request<{ success: boolean; phases: PhaseConfig[] }>('/api/pipeline/config')
  return data.phases ?? []
}

// ─── Ideation (Pipeline Fase 1.1) ─────────────────────────────────────────────

export interface IdeationVariation {
  id:      string
  concept: string
}

export interface IdeationScoredConcept {
  id:               string
  concept:          string
  total:            number
  originality:      number
  market_fit:       number
  team_alignment:   number
  feasibility:      number
}

export interface IdeationCandidate {
  id:              string
  concept:         string
  score:           number
  rationale:       string
  hook:            string
  target_audience: string
  image_url?:      string | null
}

export async function generateConceptVariations(brief: string, genres: string[], count: number, stepKey?: string) {
  return request<{ success: boolean; variations: IdeationVariation[]; meta: unknown }>(
    '/api/ideation/generate-variations',
    { method: 'POST', body: JSON.stringify({ brief, genres, count, step_key: stepKey }) }
  )
}

export async function scoreRankConcepts(variations: IdeationVariation[], brief: string, genres: string[], stepKey?: string) {
  return request<{ success: boolean; scored: IdeationScoredConcept[]; meta: unknown }>(
    '/api/ideation/score-rank',
    { method: 'POST', body: JSON.stringify({ variations, brief, genres, step_key: stepKey }) }
  )
}

export async function surfaceTopCandidates(scored: IdeationScoredConcept[], countTop: number, stepKey?: string) {
  return request<{ success: boolean; candidates: IdeationCandidate[]; meta: unknown }>(
    '/api/ideation/surface-candidates',
    { method: 'POST', body: JSON.stringify({ scored, count_top: countTop, step_key: stepKey }) }
  )
}

export async function generateCandidateImages(
  candidates: Pick<IdeationCandidate, 'id' | 'concept' | 'hook'>[],
  projectId: string,
  stepKey?: string,
) {
  return request<{ success: boolean; images: { id: string; image_url: string | null }[] }>(
    '/api/ideation/generate-candidate-images',
    { method: 'POST', body: JSON.stringify({ candidates, project_id: projectId, step_key: stepKey }) }
  )
}

// ─── Market Research (1.2.x) ──────────────────────────────────────────────────

export interface ComparableGame {
  id:               string
  title:            string
  developer:        string
  publisher:        string
  platforms:        string[]
  release_year:     number
  genre:            string
  subgenre:         string
  revenue_tier:     'indie' | 'mid' | 'AA' | 'AAA'
  metacritic_score: number | null
  player_sentiment: 'very positive' | 'positive' | 'mixed' | 'negative' | 'unknown'
  similarity_score: number
  key_mechanics:    string[]
  why_comparable:   string
}

export interface ComparableGamesResult {
  candidate_id: string
  comparables:  ComparableGame[]
}

export interface GapAnalysisResult {
  candidate_id:          string
  competitor_strengths:  string[]
  competitor_weaknesses: string[]
  market_gaps:           string[]
  underserved_audiences: string[]
  timing_opportunities:  string[]
  positioning_statement: string
  differentiation_score: number
}

export interface PlatformSizing {
  size:      'massive' | 'large' | 'medium' | 'small' | 'niche'
  rationale: string
}

export interface AudienceSizingResult {
  candidate_id:          string
  platform_breakdown:    Record<string, PlatformSizing>
  demographic_breakdown: {
    age_range:   string
    gender_skew: string
    player_type: string
    regions:     string[]
  }
  tam:                string
  sam:                string
  market_opportunity: 'high' | 'medium' | 'low'
  confidence:         'high' | 'medium' | 'low'
  key_assumptions:    string[]
}

export async function researchComparableGames(candidates: IdeationCandidate[], stepKey?: string) {
  return request<{ success: boolean; results: ComparableGamesResult[]; meta: unknown }>(
    '/api/market-research/comparable-games',
    { method: 'POST', body: JSON.stringify({ candidates, step_key: stepKey }) }
  )
}

export async function analyzeGapsPositioning(
  candidates: IdeationCandidate[],
  comparablesResults: ComparableGamesResult[],
  stepKey?: string,
) {
  return request<{ success: boolean; results: GapAnalysisResult[]; meta: unknown }>(
    '/api/market-research/analyze-gaps',
    { method: 'POST', body: JSON.stringify({ candidates, comparables_results: comparablesResults, step_key: stepKey }) }
  )
}

export async function sizeAudience(
  candidates: IdeationCandidate[],
  gapResults: GapAnalysisResult[],
  stepKey?: string,
) {
  return request<{ success: boolean; results: AudienceSizingResult[]; meta: unknown }>(
    '/api/market-research/size-audience',
    { method: 'POST', body: JSON.stringify({ candidates, gap_results: gapResults, step_key: stepKey }) }
  )
}

// ─── Chat ─────────────────────────────────────────────────────────────────────

export interface ChatAttachment {
  file_name:       string
  mime_type:       string | null
  file_size_bytes: number | null
  storage_url:     string
}

export interface ChatToolCall {
  tool:   string
  args:   Record<string, unknown>
  result: string
}

export interface ApprovedAsset {
  id:          string
  name:        string
  format:      string
  content:     string | null
  storage_url: string | null
}

export interface ChatMessage {
  id?:          string
  role:         'user' | 'assistant'
  content:      string
  attachments?: ChatAttachment[]
  tool_calls?:  ChatToolCall[]
  // Lo que generó ESTE turno. El mapa de la sesión es lo último vigente; esto es el historial,
  // y es lo que evita que una respuesta nueva se pinte con las imágenes de la anterior.
  output_images?: OutputImagesMap
}

export async function saveChatHistory(
  projectId:   string,
  stepKey:     string,
  chatHistory: ChatMessage[],
): Promise<void> {
  await request<{ success: boolean }>(
    '/api/pipeline/save-chat-history',
    { method: 'POST', body: JSON.stringify({ project_id: projectId, step_key: stepKey, chat_history: chatHistory }) }
  )
}

export async function chatWithNode(
  stepKey:       string,
  messages:      ChatMessage[],
  userMessage:   string,
  currentOutput: unknown,
  projectId:     string,
  applyMode?:    boolean,
) {
  return request<{ success: boolean; reply: string; meta: unknown }>(
    '/api/chat/node',
    { method: 'POST', body: JSON.stringify({ step_key: stepKey, messages, user_message: userMessage, current_output: currentOutput, project_id: projectId, apply_mode: applyMode }) }
  )
}

// ─── Forge NodeDNA — chat con sesión persistida ───────────────

export async function chatWithForgeNode(
  projectId:        string,
  nodeId:           string,
  userMessage:      string,
  sessionId?:       string,
  file?:            File | null,
  attachmentUrl?:   string,
  targetOutputKey?: string | null,
  projectNodeId?:   string | null,
): Promise<{ reply: string; session_id: string; message_id?: string; output_images?: OutputImagesMap; doc_url?: string; doc_format?: string; attachment?: ChatAttachment }> {
  const memberId = typeof window !== 'undefined' ? localStorage.getItem('forge_member_id') : null

  let body: BodyInit
  const headers: Record<string, string> = await authHeaders()

  if (file) {
    const fd = new FormData()
    fd.append('user_message', userMessage)
    if (sessionId)       fd.append('session_id',          sessionId)
    if (memberId)        fd.append('member_id',           memberId)
    if (targetOutputKey) fd.append('target_output_key',   targetOutputKey)
    if (projectNodeId)   fd.append('project_node_id',     projectNodeId)
    fd.append('attachment', file)
    body = fd
    // Sin Content-Type — el browser lo pone con el boundary correcto
  } else {
    body    = JSON.stringify({ user_message: userMessage, session_id: sessionId, member_id: memberId, attachment_url: attachmentUrl || undefined, target_output_key: targetOutputKey || undefined, project_node_id: projectNodeId || undefined })
    headers['Content-Type'] = 'application/json'
  }

  const res = await fetch(`${BACKEND_URL}/api/projects/${projectId}/canvas/nodes/${nodeId}/chat`, {
    method: 'POST',
    headers,
    body,
  })

  if (!res.ok) {
    let message = `Request failed: ${res.status} ${res.statusText}`
    try {
      const errBody = await res.json()
      if (errBody.error)   message = errBody.error
      else if (errBody.message) message = errBody.message
    } catch { /* ignore */ }
    throw new Error(message)
  }

  return res.json()
}

export type NodeContextInput = {
  label:                  string
  content:                string
  source:                 'lane' | 'edge' | 'library'
  isImage?:               boolean
  source_project_node_id?: string | null
  output_key?:             string | null
}

export async function getNodeContextInputs(projectId: string, projectNodeId: string): Promise<NodeContextInput[]> {
  const res = await request<{ success: boolean; inputs: NodeContextInput[] }>(
    `/api/projects/${projectId}/canvas/nodes/${projectNodeId}/context-inputs`
  )
  return res.inputs ?? []
}

export async function acceptNodeOutput(
  projectId: string,
  nodeId:    string,
  sessionId: string,
  content:   string,
  docUrl?:   string,
  docFormat?: string,
): Promise<{ asset_id: string }> {
  const memberId = typeof window !== 'undefined' ? localStorage.getItem('forge_member_id') : null
  return request<{ success: boolean; asset_id: string }>(
    `/api/projects/${projectId}/canvas/nodes/${nodeId}/accept`,
    { method: 'POST', body: JSON.stringify({ session_id: sessionId, content, member_id: memberId, doc_url: docUrl || undefined, doc_format: docFormat || undefined }) },
  )
}

// El PDF es de UN output: sin `outputKey` el backend devuelve el documento aprobado más
// reciente del nodo, que en un nodo de varios outputs es casi siempre el equivocado.
export async function generateNodePdf(
  projectId:      string,
  nodeId:         string,
  outputKey?:     string | null,
  projectNodeId?: string | null,
): Promise<{ url: string }> {
  return request<{ success: boolean; url: string }>(
    `/api/projects/${projectId}/canvas/nodes/${nodeId}/generate-pdf`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ output_key: outputKey ?? null, project_node_id: projectNodeId ?? null }),
    },
  )
}

// ─── Iteración de una página de deck ─────────────────────────────────────────
// Re-renderiza UNA página y la guarda como versión nueva. La llamada espera: medido, una página
// tarda 33–36 s (las 34 juntas tardan 220 porque van en paralelo, una sola no aprovecha eso).
export interface IteracionResultado {
  version: { id: string; version_number: number; storage_url: string }
  pagina:  { indice: number; nombre: string }
  job: string
  segundos: number
}

/**
 * «Design Edits» del moodboard: se describe el cambio en palabras y la imagen se regenera
 * aplicando SOLO eso. A diferencia de `iterateAssetPage`, no rehace la página desde el documento
 * — parte de la imagen que ya existe—, así que sirve para cualquier activo visual.
 */
export async function designEditAsset(projectId: string, assetId: string, prompt: string, memberId?: string | null) {
  return request<{ success: boolean; version: { id: string; version_number: number; storage_url: string } }>(
    `/api/projects/${projectId}/canvas/assets/${assetId}/design-edit`,
    { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ prompt, member_id: memberId ?? null }) },
  )
}

export async function iterateAssetPage(projectId: string, assetId: string, memberId?: string | null) {
  return request<{ success: boolean } & IteracionResultado>(
    `/api/projects/${projectId}/canvas/assets/${assetId}/iterate`,
    { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ member_id: memberId ?? null }) },
  )
}

export async function approveAssetVersion(projectId: string, assetId: string, versionId: string, memberId?: string | null) {
  return request<{ success: boolean; version_number: number; storage_url: string }>(
    `/api/projects/${projectId}/canvas/assets/${assetId}/versions/${versionId}/approve`,
    { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ member_id: memberId ?? null }) },
  )
}

export interface OutputImageVariation { url: string; condition?: string | null }
export interface OutputImageItem     { index: number; variations: OutputImageVariation[] }
export type    OutputImagesMap       = Record<string, OutputImageItem[]>

export async function generateItemImage(
  projectId:  string,
  nodeId:     string,
  sessionId:  string,
  outputKey:  string,
  itemIndex:  number,
  itemText:   string,
  condition?: string,
  messageId?: string,
): Promise<{ image_url: string; output_images: OutputImagesMap }> {
  return request<{ success: boolean; image_url: string; output_images: OutputImagesMap }>(
    `/api/projects/${projectId}/canvas/nodes/${nodeId}/sessions/${sessionId}/generate-item-image`,
    { method: 'POST', body: JSON.stringify({ output_key: outputKey, item_index: itemIndex, item_text: itemText, condition, message_id: messageId ?? null }) },
  )
}

export async function getNodeSession(
  projectId:      string,
  nodeId:         string,
  outputKey?:     string | null,
  // Con fan-out los lanes instancian el mismo nodo del catálogo: sin la instancia, el lane B
  // abre la sesión del lane A.
  projectNodeId?: string | null,
): Promise<{ session: { id: string; status: string; iteration_count: number; output_images?: OutputImagesMap | null } | null; messages: ChatMessage[]; asset?: ApprovedAsset | null }> {
  const params = new URLSearchParams()
  if (outputKey)     params.set('output_key', outputKey)
  if (projectNodeId) params.set('project_node_id', projectNodeId)
  const qs = params.toString() ? `?${params.toString()}` : ''
  // `no-store`: esta llamada se usa para SEGUIR un render en curso. Con la cache del navegador
  // la segunda consulta y las siguientes vuelven 304 y el conteo de paginas se queda congelado
  // en el primer valor — el trabajo avanza y la pantalla no.
  return request<{ success: boolean; session: { id: string; status: string; iteration_count: number; output_images?: OutputImagesMap | null } | null; messages: ChatMessage[]; asset?: ApprovedAsset | null }>(
    `/api/projects/${projectId}/canvas/nodes/${nodeId}/session${qs}`,
    { cache: 'no-store' },
  )
}

export interface RunValidateError {
  type?:         'unreviewed_session' | 'missing_input' | 'empty_source' | 'gate_sealed'
  projectNodeId: string
  nodeId?:       string
  nodeKey:       string
  nodeTitle:     string
  reason:        string
}

export async function runValidate(
  projectId: string,
  scope:     RunScope = { type: 'pipeline' },
): Promise<{ valid: boolean; errors: RunValidateError[] }> {
  return request<{ success: boolean; valid: boolean; errors: RunValidateError[] }>(
    `/api/projects/${projectId}/canvas/run-validate`,
    { method: 'POST', body: JSON.stringify(scope) },
  )
}

// ── Run plan (#4): gates a cruzar + fan-out + costo estimado para un Run de pipeline ──
export type GateAuthMode = 'pause' | 'auto_accept'

export interface RunPlanPhase {
  blueprint_id: string
  name:         string
  phase:        string
  node_count:   number
  is_current:   boolean
  sealed:       boolean
}

export interface RunPlanGate {
  blueprint_id: string
  name:         string
  will_fan_out: boolean
  configured:   boolean
  item_count:   number | null
  item_type:    string | null
}

export interface RunPlan {
  requires_authorization: boolean
  phases:                 RunPlanPhase[]
  gates:                  RunPlanGate[]
  estimated: {
    node_runs:         number
    avg_cost_per_node: number
    cost_usd:          number
    is_estimated:      boolean
  } | null
  remembered: { mode: GateAuthMode } | null
}

export async function runPlan(
  projectId: string,
  scope:     RunScope = { type: 'pipeline' },
): Promise<RunPlan> {
  return request<{ success: boolean } & RunPlan>(
    `/api/projects/${projectId}/canvas/run-plan`,
    { method: 'POST', body: JSON.stringify(scope) },
  )
}

export async function saveRunConfig(
  projectId:         string,
  gate_authorization: { mode: GateAuthMode; remember: boolean },
): Promise<void> {
  await request(
    `/api/projects/${projectId}/canvas/run-config`,
    { method: 'PATCH', body: JSON.stringify({ gate_authorization }) },
  )
}

// Run per-output (bug A): corre solo los outputs pendientes del nodo.
// `ran` = output_keys ejecutados; `skipped` = true si el nodo ya estaba satisfecho.
export async function autoRunNode(
  projectId:     string,
  projectNodeId: string,
  memberId?:     string,
  /** Corre SOLO ese output. La ruta ya lo aceptaba; sin esto el Run dispara todos los pendientes,
   *  que en un nodo de decks son decenas de imagenes. */
  targetOutputKey?: string,
): Promise<{ ran?: string[]; skipped?: boolean; session_id?: string; reply?: string; doc_url?: string; doc_format?: string }> {
  return request<{ success: boolean; ran?: string[]; skipped?: boolean; session_id?: string; reply?: string; doc_url?: string; doc_format?: string }>(
    `/api/projects/${projectId}/canvas/nodes/${projectNodeId}/auto-run`,
    { method: 'POST', body: JSON.stringify({ member_id: memberId, target_output_key: targetOutputKey }) },
  )
}

// Elemento estructurado retornado por nodos con STEP_SCHEMAS en el backend
export interface PipelineNodeItem {
  name?:         string
  [key: string]: unknown
  image_url?:    string | null
}

export async function runPipelineNode(
  projectId: string,
  stepKey:   string,
): Promise<{ output: string; image_url?: string | null; items?: PipelineNodeItem[] | null }> {
  const data = await request<{ success: boolean; output: string; image_url?: string | null; items?: PipelineNodeItem[] | null }>(
    '/api/pipeline/run',
    { method: 'POST', body: JSON.stringify({ project_id: projectId, step_key: stepKey }) }
  )
  return { output: data.output, image_url: data.image_url, items: data.items }
}

export async function regeneratePipelineItem(
  projectId:  string,
  stepKey:    string,
  itemIndex:  number,
): Promise<{ item: PipelineNodeItem; item_index: number }> {
  const data = await request<{ success: boolean; item: PipelineNodeItem; item_index: number }>(
    '/api/pipeline/regenerate-item',
    { method: 'POST', body: JSON.stringify({ project_id: projectId, step_key: stepKey, item_index: itemIndex }) }
  )
  return { item: data.item, item_index: data.item_index }
}

export async function savePipelineImageVersion(
  projectId: string,
  stepKey:   string,
  imageUrl:  string,
): Promise<void> {
  await request<{ success: boolean }>(
    '/api/pipeline/save-image-version',
    { method: 'POST', body: JSON.stringify({ project_id: projectId, step_key: stepKey, image_url: imageUrl }) }
  )
}

export async function saveNodeDraft(
  projectId: string,
  stepKey:   string,
  output:    string,
  imageUrl?: string | null,
  items?:    PipelineNodeItem[] | null,
): Promise<void> {
  const memberId = typeof window !== 'undefined' ? localStorage.getItem('forge_member_id') : null
  await request<{ success: boolean }>(
    '/api/pipeline/save-draft',
    { method: 'POST', body: JSON.stringify({
      project_id: projectId, step_key: stepKey, output, image_url: imageUrl,
      ...(items && items.length > 0 ? { items } : {}),
      ...(memberId ? { member_id: memberId } : {}),
    }) }
  )
}

// ─── Action Nodes ─────────────────────────────────────────────────────────────

export async function getActionNodes(): Promise<{ action_nodes: StepConfig[] }> {
  return request('/api/action-nodes')
}

export async function getActionInstances(projectId: string): Promise<{ action_instances: ActionInstance[] }> {
  return request(`/api/projects/${projectId}/action-instances`)
}

export async function addActionInstance(
  projectId: string,
  payload: { action_step_key: string; source_step_key: string; container_key: string },
): Promise<{ instance: ActionInstance }> {
  return request(`/api/projects/${projectId}/action-instances`, {
    method: 'POST',
    body: JSON.stringify(payload),
  })
}

export async function removeActionInstance(projectId: string, instanceId: string): Promise<void> {
  await request(`/api/projects/${projectId}/action-instances/${instanceId}`, { method: 'DELETE' })
}

export async function runActionInstance(
  projectId: string,
  instanceId: string,
): Promise<{ instance_id: string; artifact_url: string; action_type: ActionType; ext: string }> {
  return request(`/api/projects/${projectId}/action-instances/${instanceId}/run`, { method: 'POST' })
}

// ─── Changelog / What's New ───────────────────────────────────────────────────

// Público: solo entradas publicadas (para el panel "What's New"), paginadas
export async function getChangelog(opts?: { limit?: number; offset?: number }): Promise<{ entries: ChangelogEntry[]; hasMore: boolean }> {
  const limit  = opts?.limit  ?? 25
  const offset = opts?.offset ?? 0
  const data = await request<{ success: boolean; entries: ChangelogEntry[]; has_more: boolean }>(
    `/api/changelog?limit=${limit}&offset=${offset}`,
  )
  return { entries: data.entries, hasMore: data.has_more }
}

// Admin: todas las entradas (borradores + publicadas)
export async function getAdminChangelog(): Promise<ChangelogEntry[]> {
  const data = await request<{ success: boolean; entries: ChangelogEntry[] }>('/api/admin/changelog')
  return data.entries
}

export async function createChangelogEntry(payload: {
  version: string; type: ChangelogType; title: string; items: string[]; source?: 'seed' | 'manual'; published?: boolean
}): Promise<ChangelogEntry> {
  const data = await request<{ success: boolean; entry: ChangelogEntry }>('/api/admin/changelog', {
    method: 'POST', body: JSON.stringify(payload),
  })
  return data.entry
}

export async function updateChangelogEntry(
  id: string,
  patch: Partial<{ version: string; type: ChangelogType; title: string; items: string[]; published: boolean }>,
): Promise<ChangelogEntry> {
  const data = await request<{ success: boolean; entry: ChangelogEntry }>(`/api/admin/changelog/${id}`, {
    method: 'PATCH', body: JSON.stringify(patch),
  })
  return data.entry
}

export async function deleteChangelogEntry(id: string): Promise<void> {
  await request<{ success: boolean }>(`/api/admin/changelog/${id}`, { method: 'DELETE' })
}
