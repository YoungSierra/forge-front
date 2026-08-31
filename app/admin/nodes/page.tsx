'use client'

import { useEffect, useState, useCallback } from 'react'
import { BACKEND_URL, getAdminWorkflows, getAdminSkillConfigs, getModelsConfig } from '@/lib/api'
import type { SkillConfig } from '@/lib/api'
import type { ComfyUIWorkflow } from '@/lib/types'
import { compareNodeKey } from '@/lib/node-order'

function adminFetch(path: string, options?: RequestInit) {
  const memberId = typeof window !== 'undefined' ? localStorage.getItem('forge_member_id') : null
  return fetch(`${BACKEND_URL}${path}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...(memberId ? { 'x-member-id': memberId } : {}),
      ...(options?.headers as Record<string, string> | undefined),
    },
  })
}

// ─── Tipos ────────────────────────────────────────────────────

interface NodeOutput {
  // v1.3.0 campos (nuevos)
  key?:            string
  label?:          string
  type?:           'connection' | 'asset'
  prompt?:         string
  uses?: {
    inputs:               string[]
    siblings_if_present:  string[]
  }
  // campos legacy (siguen funcionando)
  name:            string
  format:          string
  description:     string
  optional?:       boolean
  mode?:           string
  image_gen?:      boolean
  image_gen_model?: string
  // Se compone por código desde una plantilla de slots en vez de generarlo el LLM.
  // Paralelo a image_gen: la marca va POR OUTPUT, no por nodo, porque un mismo nodo
  // mezcla outputs de LLM, de imagen y de ensamble.
  assembly?:       boolean
}

// Wired port del nuevo formato v1.3.0
interface WiredInput {
  key:         string
  type:        string      // ej: "list<concept_seed>", "single<positioning>"
  cardinality: string      // "single" | "one_or_more" | "list"
  required:    boolean
}

// Formato v1.3.0 de inputs
interface NodeInputsV2 {
  wired:          WiredInput[]
  direct_context: string
}

// Formato legacy: array de NodeInput
interface NodeInput {
  key:      string
  label:    string
  accepts:  string[]
  required: boolean
}

interface NodeExecutor {
  type:         'llm' | 'comfyui' | 'hybrid'
  model?:       string | null
  workflow_id?: string | null
}

// Detecta si el input está en formato v1.3.0 ({wired, direct_context})
function isInputsV2(raw: unknown): raw is NodeInputsV2 {
  return typeof raw === 'object' && raw !== null && !Array.isArray(raw) && 'wired' in raw
}

// Normaliza el formato legacy {required:[], optional:[]} al nuevo [{key, label, accepts, required}]
function normalizeInputsLegacy(raw: unknown): NodeInput[] {
  if (Array.isArray(raw)) return raw as NodeInput[]
  if (isInputsV2(raw)) return []  // no convertir v1.3.0 al formato legacy
  const legacy = raw as { required?: string[]; optional?: string[] } | null
  return [
    ...(legacy?.required ?? []).map(key => ({ key, label: key.replace(/_/g, ' '), accepts: ['text'], required: true  })),
    ...(legacy?.optional ?? []).map(key => ({ key, label: key.replace(/_/g, ' '), accepts: ['text'], required: false })),
  ]
}

interface ForgeNode {
  id:                string
  node_key:          string
  title:             string
  phase:             string
  status:            string
  role:              string
  parent_id:         string | null
  purpose:           string
  inputs:            NodeInput[] | NodeInputsV2
  outputs:           NodeOutput[]
  constraints:       string
  tools:             string[]
  skills:            string[]
  default_prompt:    string
  standalone_prompt: string
  executor:          NodeExecutor | null
  created_at:        string
}

const PHASES   = ['ideation', 'concept', 'pre-production', 'production', 'live-ops']
const FORMATS            = ['docx', 'pptx', 'png', 'markdown', 'markdown_table', 'json', 'artifact_bundle', 'single_sentence', 'structured']
// Formats de outputs connection (= el `type` de la connection en el ADN). Cubre Concept y
// Pre-Producción v2.6.0. El motor cablea por KEY, no por este format — pero completar la lista
// evita pisar el tipo al editar un output pre-prod en el NMS.
const CONNECTION_FORMATS = [
  // Genéricos / Concept
  'structured', 'text', 'decision', 'list<concept_seed>', 'gap_analysis', 'positioning',
  'concept_data', 'financial_case', 'review_verdict',
  // Pre-Producción — Diseño (3.1–3.7)
  'design_pillars', 'feel_statement', 'core_loop', 'list<mechanic_spec>', 'progression_sys',
  'economy_design', 'player_stats', 'item_catalog', 'world_lore', 'environments_x4', 'faction_map',
  'narrative_arc', 'dialogue_system', 'level_map', 'encounter_design', 'char_profiles',
  'char_abilities', 'hud_layout', 'menu_tree', 'control_map', 'feedback_system',
  // Pre-Producción — Assembly / Art / Tech / Scope (3.8–3.15)
  'gdd_ref', 'style_guide', 'color_palette', 'visual_targets', 'art_bible_intake', 'list<asset_brief>',
  'audio_direction', 'revenue_model', 'tech_stack', 'custom_systems', 'project_identity',
  'dependency_graph', 'vs_spec', 'production_plan', 'product_scope',
  // Pre-Producción — Prototipado (3.16–3.22)
  'prototype_spec', 'build_result', 'playtest_result',
]
const OUTCOMES = ['accept', 'refine', 'kill']

const MODELS_BY_PROVIDER: Record<string, string[]> = {
  gemini:     ['gemini-2.5-flash', 'gemini-2.5-pro', 'gemini-2.0-flash'],
  openai:     ['gpt-5', 'gpt-5-mini', 'gpt-4.1', 'gpt-4.1-mini', 'gpt-4o', 'gpt-4o-mini', 'o3', 'o4-mini'],
  groq:       ['llama-3.3-70b-versatile', 'llama-3.1-70b-versatile', 'mixtral-8x7b-32768'],
  together:   ['meta-llama/Llama-3-70b-chat-hf', 'mistralai/Mixtral-8x7B-Instruct-v0.1'],
  openrouter: ['meta-llama/llama-3.3-70b-instruct', 'deepseek/deepseek-r1', 'anthropic/claude-3.5-sonnet'],
  minimax:    ['MiniMax-M3', 'MiniMax-M2.7', 'MiniMax-Text-01', 'abab6.5s-chat'],
  mimo:       ['xiaomi/mimo-v2.5-pro', 'xiaomi/mimo-v2.5'],
  // Los diez que devuelve el catálogo de la cuenta (client.models.list), del más nuevo al más
  // viejo. Escribirlos a ojo no falla al guardar: falla el día que alguien corre ese nodo, con un
  // 404 después de haber armado todo el contexto. Verificar con scripts/probar-modelos-anthropic.js.
  anthropic:  ['claude-opus-5', 'claude-sonnet-5', 'claude-fable-5',
               'claude-opus-4-8', 'claude-opus-4-7', 'claude-sonnet-4-6', 'claude-opus-4-6',
               'claude-opus-4-5-20251101', 'claude-haiku-4-5-20251001', 'claude-sonnet-4-5-20250929'],
}

const PHASE_COLOR: Record<string, string> = {
  ideation:       '#2DD4BF',
  concept:        '#818CF8',
  'pre-production': '#F59E0B',
  production:     '#34D399',
  'live-ops':     '#F87171',
}

// ─── Estilos compartidos ──────────────────────────────────────

const label = (text: string) => (
  <div style={{ fontSize: 10, fontFamily: 'var(--font-mono)', color: 'var(--text-3)', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 5 }}>
    {text}
  </div>
)

const inputSx: React.CSSProperties = {
  width: '100%', background: 'var(--bg-1)', border: '1px solid var(--line-2)',
  borderRadius: 6, color: 'var(--text-1)', fontSize: 12,
  fontFamily: 'var(--font-mono)', padding: '7px 10px', boxSizing: 'border-box',
  outline: 'none',
}

const textareaSx: React.CSSProperties = {
  ...inputSx, resize: 'vertical', minHeight: 72, lineHeight: 1.6,
}

// ─── ModelSelector ────────────────────────────────────────────

function ModelSelector({ value, onChange, availableProviders }: {
  value: string | null
  onChange: (v: string | null) => void
  availableProviders: Record<string, boolean>
}) {
  const providers = Object.keys(MODELS_BY_PROVIDER).filter(p => availableProviders[p] !== false)
  const [provider, model] = value ? value.split(':') : ['', '']

  function set(p: string, m: string) { onChange(p && m ? `${p}:${m}` : null) }

  return (
    <div style={{ display: 'flex', gap: 8 }}>
      <div style={{ flex: 1 }}>
        {label('provider')}
        <select style={{ ...inputSx, cursor: 'pointer' }} value={provider || ''} onChange={e => set(e.target.value, MODELS_BY_PROVIDER[e.target.value]?.[0] || '')}>
          <option value="">— default global —</option>
          {providers.map(p => <option key={p} value={p}>{p}</option>)}
        </select>
      </div>
      {provider && (
        <div style={{ flex: 2 }}>
          {label('model')}
          <select style={{ ...inputSx, cursor: 'pointer' }} value={model || ''} onChange={e => set(provider, e.target.value)}>
            {(MODELS_BY_PROVIDER[provider] || []).map(m => <option key={m} value={m}>{m}</option>)}
          </select>
        </div>
      )}
    </div>
  )
}

// ─── Componente TagInput ──────────────────────────────────────

function TagInput({ values, onChange, placeholder }: {
  values: string[]
  onChange: (v: string[]) => void
  placeholder?: string
}) {
  const [draft, setDraft] = useState('')

  const add = () => {
    const v = draft.trim()
    if (v && !values.includes(v)) onChange([...values, v])
    setDraft('')
  }

  return (
    <div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5, marginBottom: 5 }}>
        {values.map(v => (
          <span key={v} style={{
            fontSize: 10, fontFamily: 'var(--font-mono)', padding: '3px 8px',
            background: 'var(--bg-3)', borderRadius: 4, color: 'var(--text-1)',
            display: 'flex', alignItems: 'center', gap: 5,
          }}>
            {v}
            <button type="button" onClick={() => onChange(values.filter(x => x !== v))}
              style={{ border: 'none', background: 'none', cursor: 'pointer', color: 'var(--text-3)', fontSize: 11, padding: 0 }}>
              ×
            </button>
          </span>
        ))}
      </div>
      <div style={{ display: 'flex', gap: 6 }}>
        <input
          style={{ ...inputSx, flex: 1 }}
          value={draft}
          placeholder={placeholder || 'Escribe y presiona Enter o +'}
          onChange={e => setDraft(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); add() } }}
        />
        <button type="button" onClick={add} style={{
          padding: '6px 12px', borderRadius: 6, border: '1px solid var(--line-2)',
          background: 'var(--bg-2)', color: 'var(--text-1)', cursor: 'pointer',
          fontSize: 12, fontFamily: 'var(--font-mono)',
        }}>+</button>
      </div>
    </div>
  )
}

// ─── Componente InputsList ────────────────────────────────────

const ACCEPTS_OPTIONS = ['text', 'image', 'document', 'audio', 'model_3d', 'artifact_bundle']

function InputsList({ inputs, onChange }: {
  inputs:   NodeInput[]
  onChange: (v: NodeInput[]) => void
}) {
  const update = (i: number, field: keyof NodeInput, val: string | boolean | string[]) => {
    onChange(inputs.map((inp, idx) => idx === i ? { ...inp, [field]: val } : inp))
  }
  const add    = () => onChange([...inputs, { key: '', label: '', accepts: ['text'], required: false }])
  const remove = (i: number) => onChange(inputs.filter((_, idx) => idx !== i))

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      {inputs.map((inp, i) => (
        <div key={i} style={{
          background: 'var(--bg-0)', border: '1px solid var(--line-2)',
          borderRadius: 8, padding: '10px 12px', display: 'flex', flexDirection: 'column', gap: 8,
        }}>
          <div style={{ display: 'flex', gap: 8, alignItems: 'flex-start' }}>
            <div style={{ flex: 1 }}>
              {label('key')}
              <input style={inputSx} value={inp.key}
                onChange={e => update(i, 'key', e.target.value)}
                placeholder="concept_brief" />
            </div>
            <div style={{ flex: 1 }}>
              {label('label')}
              <input style={inputSx} value={inp.label}
                onChange={e => update(i, 'label', e.target.value)}
                placeholder="Concept Brief" />
            </div>
            <div style={{ width: 80 }}>
              {label('required')}
              <div style={{ height: 32, display: 'flex', alignItems: 'center' }}>
                <input type="checkbox" checked={!!inp.required}
                  onChange={e => update(i, 'required', e.target.checked)} />
              </div>
            </div>
            <button type="button" onClick={() => remove(i)} style={{
              border: 'none', background: 'none', cursor: 'pointer',
              color: 'var(--text-3)', fontSize: 16, padding: '22px 0 0 0',
            }}>×</button>
          </div>
          <div>
            {label('accepts (types)')}
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5 }}>
              {ACCEPTS_OPTIONS.map(opt => {
                const active = inp.accepts.includes(opt)
                return (
                  <button key={opt} type="button"
                    onClick={() => update(i, 'accepts', active ? inp.accepts.filter(a => a !== opt) : [...inp.accepts, opt])}
                    style={{
                      fontSize: 9, fontFamily: 'var(--font-mono)', padding: '3px 8px',
                      borderRadius: 4, cursor: 'pointer',
                      background: active ? 'color-mix(in srgb, var(--action) 15%, var(--bg-2))' : 'var(--bg-2)',
                      border: `1px solid ${active ? 'var(--action)' : 'var(--line-2)'}`,
                      color: active ? 'var(--action)' : 'var(--text-3)',
                    }}>
                    {opt}
                  </button>
                )
              })}
            </div>
          </div>
        </div>
      ))}
      <button type="button" onClick={add} style={{
        border: '1px dashed var(--line-2)', background: 'transparent',
        borderRadius: 8, padding: '8px', cursor: 'pointer',
        color: 'var(--text-3)', fontSize: 12, fontFamily: 'var(--font-mono)',
      }}>
        + Add input slot
      </button>
    </div>
  )
}

// ─── WiredInputsList — formato v1.3.0 ────────────────────────

const CARDINALITY_OPTIONS = ['single', 'one_or_more', 'list']

// Tipos del type registry v1.3.0
// Tipos de connection (input.type / output.type) de todo el pipeline. La lista alimenta el
// selector del NMS. Debe cubrir Concept (1.x/2.x) Y Pre-Producción (3.x v2.6.0) — el ADN de
// pre-prod se insertó vía importador/SQL, así que estos tipos ya viven en la DB aunque no
// se hayan agregado nunca por la UI. El auto-wire matchea por KEY, no por esta lista; pero
// sin estos tipos, editar un input pre-prod en el NMS pisaría el tipo correcto.
const WIRED_INPUT_TYPES = [
  // Genéricos
  'text', 'image_set', 'deck', 'decision',
  // Concept (1.x / 2.x)
  'concept_seed', 'gap_analysis', 'positioning', 'concept_data', 'financial_case', 'review_verdict',
  // Pre-Producción — Diseño (3.1–3.7)
  'design_pillars', 'feel_statement', 'core_loop', 'mechanic_spec', 'progression_sys', 'economy_design',
  'player_stats', 'item_catalog', 'world_lore', 'environments_x4', 'faction_map', 'narrative_arc',
  'dialogue_system', 'level_map', 'encounter_design', 'char_profiles', 'char_abilities',
  'hud_layout', 'menu_tree', 'control_map', 'feedback_system',
  // Pre-Producción — Assembly / Art / Tech / Scope (3.8–3.15)
  'gdd_ref', 'style_guide', 'color_palette', 'visual_targets', 'art_bible_intake', 'asset_brief',
  'audio_direction', 'revenue_model', 'tech_stack', 'custom_systems', 'project_identity',
  'dependency_graph', 'vs_spec', 'production_plan', 'product_scope',
  // Pre-Producción — Prototipado (3.16–3.22)
  'prototype_spec', 'build_result', 'playtest_result',
]

function WiredInputsList({ value, onChange }: {
  value:    NodeInputsV2
  onChange: (v: NodeInputsV2) => void
}) {
  const updateWired = (i: number, field: keyof WiredInput, val: string | boolean) => {
    const next = value.wired.map((w, idx) => idx === i ? { ...w, [field]: val } : w)
    onChange({ ...value, wired: next })
  }
  const addWired    = () => onChange({ ...value, wired: [...value.wired, { key: '', type: 'text', cardinality: 'single', required: false }] })
  const removeWired = (i: number) => onChange({ ...value, wired: value.wired.filter((_, idx) => idx !== i) })

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      {/* direct_context */}
      <div>
        {label('direct context prompt (shown to user when no wired inputs)')}
        <input style={inputSx} value={value.direct_context || ''}
          onChange={e => onChange({ ...value, direct_context: e.target.value })}
          placeholder="Describe your concept, paste a document, or attach any relevant file" />
      </div>

      {/* wired ports */}
      <div>
        {label('wired ports')}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          {value.wired.map((w, i) => (
            <div key={i} style={{
              background: 'var(--bg-0)', border: '1px solid var(--line-2)',
              borderRadius: 8, padding: '10px 12px',
              display: 'grid', gridTemplateColumns: '1fr 1fr 130px 70px 28px', gap: 8, alignItems: 'end',
            }}>
              <div>
                {label('key')}
                <input style={inputSx} value={w.key}
                  onChange={e => updateWired(i, 'key', e.target.value)}
                  placeholder="concept_seeds" />
              </div>
              <div>
                {label('type')}
                <select style={{ ...inputSx, cursor: 'pointer' }} value={w.type ?? ''}
                  onChange={e => updateWired(i, 'type', e.target.value)}>
                  <option value="">— select —</option>
                  {WIRED_INPUT_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
                </select>
              </div>
              <div>
                {label('cardinality')}
                <select style={{ ...inputSx, cursor: 'pointer' }} value={w.cardinality}
                  onChange={e => updateWired(i, 'cardinality', e.target.value)}>
                  {CARDINALITY_OPTIONS.map(c => <option key={c} value={c}>{c}</option>)}
                </select>
              </div>
              <div>
                {label('required')}
                <div style={{ height: 32, display: 'flex', alignItems: 'center' }}>
                  <input type="checkbox" checked={!!w.required}
                    onChange={e => updateWired(i, 'required', e.target.checked)} />
                </div>
              </div>
              <button type="button" onClick={() => removeWired(i)} style={{
                border: 'none', background: 'none', cursor: 'pointer',
                color: 'var(--text-3)', fontSize: 16, alignSelf: 'flex-end', paddingBottom: 6,
              }}>×</button>
            </div>
          ))}
          <button type="button" onClick={addWired} style={{
            border: '1px dashed var(--line-2)', background: 'transparent',
            borderRadius: 8, padding: '6px', cursor: 'pointer',
            color: 'var(--text-3)', fontSize: 12, fontFamily: 'var(--font-mono)',
          }}>
            + Add wired port
          </button>
        </div>
      </div>
    </div>
  )
}

// ─── ImageGenSelector ─────────────────────────────────────────

const IMAGE_GEN_MODELS: Record<string, string[]> = {
  openai: ['dall-e-3', 'gpt-image-1'],
}

function ImageGenSelector({ value, onChange, workflows }: {
  value:     string | undefined
  onChange:  (v: string | undefined) => void
  workflows: ComfyUIWorkflow[]
}) {
  const [provider, modelOrWf] = value ? value.split(':') : ['', '']

  function set(p: string, m: string) { onChange(p && m ? `${p}:${m}` : undefined) }

  const providers = ['comfyui', ...Object.keys(IMAGE_GEN_MODELS)]

  return (
    <div style={{ display: 'flex', gap: 8 }}>
      <div style={{ flex: 1 }}>
        {label('provider')}
        <select style={{ ...inputSx, cursor: 'pointer' }} value={provider || ''}
          onChange={e => {
            const p = e.target.value
            const defaultModel = p === 'comfyui'
              ? (workflows[0]?.name || '')
              : (IMAGE_GEN_MODELS[p]?.[0] || '')
            set(p, defaultModel)
          }}>
          <option value="">— select —</option>
          {providers.map(p => <option key={p} value={p}>{p}</option>)}
        </select>
      </div>
      {provider === 'comfyui' && (
        <div style={{ flex: 2 }}>
          {label('comfyui workflow')}
          <select style={{ ...inputSx, cursor: 'pointer' }} value={modelOrWf || ''}
            onChange={e => set('comfyui', e.target.value)}>
            <option value="">— not assigned —</option>
            {workflows.filter(w => w.is_active).map(w => (
              <option key={w.id} value={w.name}>{w.name}{w.description ? ` — ${w.description}` : ''}</option>
            ))}
          </select>
        </div>
      )}
      {provider && provider !== 'comfyui' && IMAGE_GEN_MODELS[provider] && (
        <div style={{ flex: 2 }}>
          {label('model')}
          <select style={{ ...inputSx, cursor: 'pointer' }} value={modelOrWf || ''}
            onChange={e => set(provider, e.target.value)}>
            {IMAGE_GEN_MODELS[provider].map(m => <option key={m} value={m}>{m}</option>)}
          </select>
        </div>
      )}
    </div>
  )
}

// ─── Componente OutputsList ───────────────────────────────────

function OutputsList({ outputs, onChange, workflows, nodeKey }: {
  outputs:   NodeOutput[]
  onChange:  (v: NodeOutput[]) => void
  workflows: ComfyUIWorkflow[]
  nodeKey?:  string   // sólo para mostrar el id de plantilla esperado en outputs de ensamble
}) {
  const update = (i: number, field: keyof NodeOutput, val: string | boolean | undefined) => {
    const next = outputs.map((o, idx) => idx === i ? { ...o, [field]: val } : o)
    onChange(next)
  }

  const updateUses = (i: number, field: 'inputs' | 'siblings_if_present', csv: string) => {
    const arr = csv.split(',').map(s => s.trim()).filter(Boolean)
    const next = outputs.map((o, idx) => idx === i
      ? { ...o, uses: { inputs: [], siblings_if_present: [], ...(o.uses ?? {}), [field]: arr } }
      : o)
    onChange(next)
  }

  const add = () => onChange([...outputs, { key: '', name: '', label: '', type: 'asset', format: 'markdown', description: '', optional: false, prompt: '', uses: { inputs: [], siblings_if_present: [] } }])
  const remove = (i: number) => onChange(outputs.filter((_, idx) => idx !== i))

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      {outputs.map((out, i) => (
        <div key={i} style={{
          background: 'var(--bg-0)', border: '1px solid var(--line-2)',
          borderRadius: 8, padding: '10px 12px', display: 'flex', flexDirection: 'column', gap: 8,
        }}>
          {/* ── Fila superior: key/name, label, type, format, optional ── */}
          <div style={{ display: 'flex', gap: 8, alignItems: 'flex-start' }}>
            <div style={{ flex: 1 }}>
              {label('key / name')}
              <input style={inputSx} value={out.key || out.name}
                onChange={e => update(i, 'key', e.target.value)}
                placeholder="competitive_scan" />
            </div>
            <div style={{ flex: 1 }}>
              {label('label (display)')}
              <input style={inputSx} value={out.label || ''}
                onChange={e => update(i, 'label', e.target.value)}
                placeholder="Competitive Scan" />
            </div>
            <div style={{ width: 110 }}>
              {label('type')}
              <select style={{ ...inputSx, width: '100%', cursor: 'pointer' }} value={out.type || 'asset'}
                onChange={e => update(i, 'type', e.target.value)}>
                <option value="asset">asset</option>
                <option value="connection">connection</option>
              </select>
            </div>
            <div style={{ width: 130 }}>
              {label('format')}
              <select style={{ ...inputSx, width: '100%' }} value={out.format}
                onChange={e => update(i, 'format', e.target.value)}>
                {(out.type === 'connection' ? CONNECTION_FORMATS : FORMATS).map(f =>
                  <option key={f} value={f}>{f}</option>
                )}
              </select>
            </div>
            <div style={{ width: 70 }}>
              {label('optional')}
              <div style={{ height: 32, display: 'flex', alignItems: 'center' }}>
                <input type="checkbox" checked={!!out.optional}
                  onChange={e => update(i, 'optional', e.target.checked)} />
              </div>
            </div>
            <button type="button" onClick={() => remove(i)} style={{
              border: 'none', background: 'none', cursor: 'pointer',
              color: 'var(--text-3)', fontSize: 16, padding: '22px 0 0 0',
            }}>×</button>
          </div>

          {label('description')}
          <input style={inputSx} value={out.description}
            onChange={e => update(i, 'description', e.target.value)}
            placeholder="5-10 comparable titles with revenue and review data" />

          {/* ── Prompt independiente por output (v1.3.0) ── */}
          {label('output prompt (independent generation)')}
          <textarea style={{ ...textareaSx, minHeight: 72 }} value={out.prompt || ''}
            onChange={e => update(i, 'prompt', e.target.value)}
            placeholder="Produce the competitive scan: markdown table of 5-10 real titles with revenue data, review scores, and platform. Cite sources." />

          {/* ── uses block (v1.4.0) ─────────────────────────────── */}
          <div style={{ display: 'flex', gap: 8, paddingTop: 4, borderTop: '1px solid var(--line-2)' }}>
            <div style={{ flex: 1 }}>
              {label('uses · inputs (comma-separated)')}
              <input style={inputSx}
                value={(out.uses?.inputs ?? []).join(', ')}
                onChange={e => updateUses(i, 'inputs', e.target.value)}
                placeholder="concept_seeds, market_gap_analysis" />
            </div>
            <div style={{ flex: 1 }}>
              {label('uses · siblings_if_present (comma-separated)')}
              <input style={inputSx}
                value={(out.uses?.siblings_if_present ?? []).join(', ')}
                onChange={e => updateUses(i, 'siblings_if_present', e.target.value)}
                placeholder="competitive_scan" />
            </div>
          </div>

          <div style={{ display: 'flex', gap: 8 }}>
            <div style={{ flex: 1 }}>
              {label('mode (opcional / legacy)')}
              <input style={inputSx} value={out.mode || ''}
                onChange={e => update(i, 'mode', e.target.value)}
                placeholder="concept | ideation | broad_prompt | seed_prompt" />
            </div>
          </div>

          {/* ── Image gen ─────────────────────────────────────── */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, paddingTop: 4, borderTop: '1px solid var(--line-2)' }}>
            <input type="checkbox" id={`ig-${i}`} checked={!!out.image_gen}
              onChange={e => update(i, 'image_gen', e.target.checked)} />
            <label htmlFor={`ig-${i}`} style={{ fontSize: 10, fontFamily: 'var(--font-mono)', color: 'var(--text-2)', cursor: 'pointer' }}>
              Image gen per item
            </label>
          </div>
          {out.image_gen && (
            <ImageGenSelector
              value={out.image_gen_model}
              onChange={v => update(i, 'image_gen_model', v)}
              workflows={workflows}
            />
          )}

          {/* ── Assembly ──────────────────────────────────────── */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, paddingTop: 4, borderTop: '1px solid var(--line-2)' }}>
            <input type="checkbox" id={`asm-${i}`} checked={!!out.assembly}
              onChange={e => update(i, 'assembly', e.target.checked)} />
            <label htmlFor={`asm-${i}`} style={{ fontSize: 10, fontFamily: 'var(--font-mono)', color: 'var(--text-2)', cursor: 'pointer' }}>
              Assembled from template (no LLM)
            </label>
          </div>
          {out.assembly && (
            <div style={{ fontSize: 10, fontFamily: 'var(--font-mono)', color: 'var(--text-3)', paddingLeft: 22 }}>
              template: tpl_{(nodeKey || '?').replace(/\./g, '_')}_{out.key || out.name || '?'}
            </div>
          )}
        </div>
      ))}
      <button type="button" onClick={add} style={{
        border: '1px dashed var(--line-2)', background: 'transparent',
        borderRadius: 8, padding: '8px', cursor: 'pointer',
        color: 'var(--text-3)', fontSize: 12, fontFamily: 'var(--font-mono)',
      }}>
        + Add output artifact
      </button>
    </div>
  )
}

// ─── CollapsibleSection ───────────────────────────────────────

function CollapsibleSection({ title, summary, children }: {
  title:    string
  summary:  string
  children: React.ReactNode
}) {
  const [open, setOpen] = useState(false)
  return (
    <div style={{ borderBottom: '1px solid var(--line-2)' }}>
      <button
        type="button"
        onClick={() => setOpen(v => !v)}
        style={{
          width: '100%', display: 'flex', alignItems: 'center', gap: 10,
          padding: '10px 0', background: 'none', border: 'none', cursor: 'pointer',
          textAlign: 'left',
        }}
      >
        <span style={{ fontSize: 10, fontFamily: 'var(--font-mono)', fontWeight: 700, color: 'var(--text-2)', textTransform: 'uppercase', letterSpacing: '0.06em', width: 100, flexShrink: 0 }}>
          {title}
        </span>
        {!open && (
          <span style={{ fontSize: 10, fontFamily: 'var(--font-mono)', color: 'var(--text-4)', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {summary}
          </span>
        )}
        <span style={{ fontSize: 10, color: 'var(--text-3)', marginLeft: 'auto', flexShrink: 0 }}>
          {open ? '▲' : '▼'}
        </span>
      </button>
      {open && (
        <div style={{ paddingBottom: 14 }}>
          {children}
        </div>
      )}
    </div>
  )
}

// ─── SkillSelector ───────────────────────────────────────────

function SkillSelector({ values, onChange, skills }: {
  values:   string[]
  onChange: (v: string[]) => void
  skills:   SkillConfig[]
}) {
  const available = skills.filter(s => !values.includes(s.key))

  return (
    <div>
      {/* Tags seleccionados */}
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5, marginBottom: 6 }}>
        {values.map(v => {
          const meta = skills.find(s => s.key === v)
          return (
            <span key={v} style={{
              fontSize: 10, fontFamily: 'var(--font-mono)', padding: '3px 8px',
              background: 'color-mix(in srgb, var(--action) 12%, var(--bg-2))',
              border: '1px solid color-mix(in srgb, var(--action) 30%, transparent)',
              borderRadius: 4, color: 'var(--text-1)',
              display: 'flex', alignItems: 'center', gap: 5,
            }}
              title={meta?.description ?? v}
            >
              {v}
              <button type="button" onClick={() => onChange(values.filter(x => x !== v))}
                style={{ border: 'none', background: 'none', cursor: 'pointer', color: 'var(--text-3)', fontSize: 11, padding: 0 }}>
                ×
              </button>
            </span>
          )
        })}
        {values.length === 0 && (
          <span style={{ fontSize: 10, fontFamily: 'var(--font-mono)', color: 'var(--text-4)' }}>No skills assigned</span>
        )}
      </div>

      {/* Dropdown para agregar */}
      {available.length > 0 && (
        <select
          style={{ ...inputSx, cursor: 'pointer' }}
          value=""
          onChange={e => { if (e.target.value) onChange([...values, e.target.value]) }}
        >
          <option value="">+ Add skill…</option>
          {available.map(s => (
            <option key={s.key} value={s.key}>
              {s.key}{s.description ? ` — ${s.description}` : ''}
            </option>
          ))}
        </select>
      )}
    </div>
  )
}

// ─── Formulario de nodo ───────────────────────────────────────

const EMPTY_NODE: Partial<ForgeNode> = {
  node_key: '', title: '', phase: 'ideation', status: 'active', role: 'standard',
  purpose: '', inputs: { wired: [], direct_context: '' } as NodeInputsV2,
  outputs: [], constraints: '', tools: [], skills: [],
  default_prompt: '', standalone_prompt: '',
  executor: null,
}

function NodeForm({ node, onSave, onCancel, workflows, availableProviders, skillCatalog }: {
  node:               Partial<ForgeNode>
  onSave:             (data: Partial<ForgeNode>) => Promise<void>
  onCancel:           () => void
  workflows:          ComfyUIWorkflow[]
  availableProviders: Record<string, boolean>
  skillCatalog:       SkillConfig[]
}) {
  const [form, setForm] = useState<Partial<ForgeNode>>(() => {
    // Preservar formato v1.3.0 si ya es {wired, direct_context}; normalizar legacy a array
    const rawInputs = node.inputs
    const inputs = isInputsV2(rawInputs) ? rawInputs : normalizeInputsLegacy(rawInputs)
    return { ...node, inputs }
  })
  const [saving, setSaving] = useState(false)
  const [error,  setError]  = useState('')

  const set = (key: keyof ForgeNode, val: unknown) =>
    setForm(f => ({ ...f, [key]: val }))

  const handleSave = async () => {
    if (!form.node_key || !form.title || !form.phase) {
      setError('node_key, title y phase son requeridos')
      return
    }
    setSaving(true)
    setError('')
    try {
      await onSave(form)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Error al guardar')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>

      {/* ── Identity — siempre visible ── */}
      <div style={{ padding: '12px 0', borderBottom: '1px solid var(--line-2)' }}>
        <div style={{ display: 'grid', gridTemplateColumns: '80px 1fr 130px 110px', gap: 8 }}>
          <div>
            {label('key')}
            <input style={inputSx} value={form.node_key || ''} onChange={e => set('node_key', e.target.value)} placeholder="1.1" />
          </div>
          <div>
            {label('title')}
            <input style={inputSx} value={form.title || ''} onChange={e => set('title', e.target.value)} placeholder="Idea Generation" />
          </div>
          <div>
            {label('phase')}
            <select style={{ ...inputSx, cursor: 'pointer' }} value={form.phase || 'ideation'} onChange={e => set('phase', e.target.value)}>
              {PHASES.map(p => <option key={p} value={p}>{p}</option>)}
            </select>
          </div>
          <div>
            {label('role')}
            <select style={{ ...inputSx, cursor: 'pointer' }} value={form.role || 'standard'} onChange={e => set('role', e.target.value)}>
              <option value="standard">standard</option>
              <option value="gate">◆ gate</option>
            </select>
          </div>
        </div>
      </div>

      {/* ── Secciones colapsables ── */}
      {([
        {
          key: 'purpose',
          title: 'Purpose',
          summary: (form.purpose as string)?.slice(0, 60) || '—',
          content: (
            <textarea style={{ ...textareaSx, minHeight: 56 }}
              value={form.purpose || ''}
              onChange={e => set('purpose', e.target.value)}
              placeholder="Research the market context for this game." />
          ),
        },
        {
          key: 'inputs',
          title: 'Inputs',
          summary: isInputsV2(form.inputs)
            ? `v1.3.0 — ${(form.inputs as NodeInputsV2).wired.length} wired port(s)`
            : ((form.inputs as NodeInput[]) || []).map((inp: NodeInput) => inp.required ? inp.key : `${inp.key}?`).join(', ') || '—',
          content: isInputsV2(form.inputs)
            ? <WiredInputsList value={form.inputs as NodeInputsV2} onChange={v => set('inputs', v)} />
            : (
              <div>
                <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 8 }}>
                  <button type="button" onClick={() => set('inputs', { wired: [], direct_context: '' } as NodeInputsV2)}
                    style={{ fontSize: 10, fontFamily: 'var(--font-mono)', padding: '3px 10px', borderRadius: 4, cursor: 'pointer', border: '1px solid var(--line-2)', background: 'var(--bg-2)', color: 'var(--text-3)' }}>
                    Upgrade to v1.3.0 format
                  </button>
                </div>
                <InputsList inputs={(form.inputs as NodeInput[]) || []} onChange={v => set('inputs', v)} />
              </div>
            ),
        },
        {
          key: 'outputs',
          title: 'Outputs',
          summary: ((form.outputs as NodeOutput[]) || []).map((o: NodeOutput) => o.key || o.name).join(', ') || '—',
          content: <OutputsList outputs={(form.outputs as NodeOutput[]) || []} onChange={v => set('outputs', v)} workflows={workflows} nodeKey={form.node_key as string} />,
        },
        {
          key: 'constraints',
          title: 'Constraints',
          summary: (form.constraints as string)?.slice(0, 60) || '—',
          content: (
            <textarea style={{ ...textareaSx, minHeight: 72 }}
              value={form.constraints || ''}
              onChange={e => set('constraints', e.target.value)}
              placeholder="Cite real sources. No invented studios…" />
          ),
        },
        {
          key: 'tools',
          title: 'Tools & Skills',
          summary: [...(form.tools || []), ...(form.skills || [])].join(', ') || '—',
          content: (
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
              <div>{label('tools')}<TagInput values={form.tools || []} onChange={v => set('tools', v)} placeholder="web_search" /></div>
              <div>{label('skills')}<SkillSelector values={form.skills || []} onChange={v => set('skills', v)} skills={skillCatalog} /></div>
            </div>
          ),
        },
        {
          key: 'prompt',
          title: 'Default Prompt',
          summary: (form.default_prompt as string)?.slice(0, 60) || '—',
          content: (
            <textarea style={{ ...textareaSx, minHeight: 100 }}
              value={form.default_prompt || ''}
              onChange={e => set('default_prompt', e.target.value)}
              placeholder="Scan the market for [project]. Produce: (1) competitive scan…" />
          ),
        },
        {
          key: 'standalone_prompt',
          title: 'Standalone Prompt',
          summary: (form.standalone_prompt as string)?.slice(0, 60) || '—',
          content: (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              <div style={{ fontSize: 10, fontFamily: 'var(--font-mono)', color: 'var(--text-4)', lineHeight: 1.5 }}>
                Shown to the LLM when the node runs without wired inputs. Describes how to extract context from direct chat or attachments.
              </div>
              <textarea style={{ ...textareaSx, minHeight: 80 }}
                value={form.standalone_prompt || ''}
                onChange={e => set('standalone_prompt', e.target.value)}
                placeholder="This node can start from a direct description. Extract the concept seed from the user's message or attached document." />
            </div>
          ),
        },
        {
          key: 'executor',
          title: 'Executor',
          summary: (() => {
            const ex = form.executor as NodeExecutor | null
            if (!ex) return 'default (global LLM)'
            if (ex.type === 'llm') return ex.model || 'llm — default model'
            if (ex.type === 'comfyui') return `comfyui — ${workflows.find(w => w.id === ex.workflow_id)?.name || 'no workflow'}`
            if (ex.type === 'hybrid') return `hybrid — ${ex.model || 'default'}`
            return '—'
          })(),
          content: (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              <div style={{ display: 'flex', gap: 6 }}>
                {([null, 'llm', 'comfyui', 'hybrid'] as const).map(t => {
                  const current = (form.executor as NodeExecutor | null)?.type ?? null
                  const active  = t === null ? !form.executor : current === t
                  const COLOR: Record<string, string> = { llm: 'var(--cat-code)', comfyui: 'var(--cat-output)', hybrid: '#a78bfa' }
                  const color = t ? COLOR[t] : 'var(--text-3)'
                  return (
                    <button key={String(t)} type="button"
                      onClick={() => set('executor', t === null ? null : { type: t, model: null, workflow_id: null })}
                      style={{
                        flex: 1, padding: '5px 0', borderRadius: 5, fontSize: 11,
                        fontFamily: 'var(--font-mono)', cursor: 'pointer',
                        border: `1px solid ${active ? color : 'var(--line-2)'}`,
                        background: active ? `color-mix(in srgb, ${color} 15%, var(--bg-1))` : 'transparent',
                        color: active ? color : 'var(--text-3)',
                      }}>{t ?? 'default'}</button>
                  )
                })}
              </div>
              {((form.executor as NodeExecutor | null)?.type === 'llm' || (form.executor as NodeExecutor | null)?.type === 'hybrid') && (
                <div>
                  {label('model')}
                  <ModelSelector
                    value={(form.executor as NodeExecutor)?.model ?? null}
                    onChange={m => set('executor', { ...(form.executor as NodeExecutor), model: m })}
                    availableProviders={availableProviders}
                  />
                </div>
              )}
              {((form.executor as NodeExecutor | null)?.type === 'comfyui' || (form.executor as NodeExecutor | null)?.type === 'hybrid') && (
                <div>
                  {label('comfyui workflow')}
                  <select style={{ ...inputSx, cursor: 'pointer' }}
                    value={(form.executor as NodeExecutor)?.workflow_id ?? ''}
                    onChange={e => set('executor', { ...(form.executor as NodeExecutor), workflow_id: e.target.value || null })}>
                    <option value="">— not assigned —</option>
                    {workflows.filter(w => w.is_active).map(w => (
                      <option key={w.id} value={w.id}>{w.name}{w.description ? ` — ${w.description}` : ''}</option>
                    ))}
                  </select>
                </div>
              )}
            </div>
          ),
        },
      ] as { key: string; title: string; summary: string; content: React.ReactNode }[]).map(({ key, title, summary, content }) => (
        <CollapsibleSection key={key} title={title} summary={summary}>
          {content}
        </CollapsibleSection>
      ))}

      {error && (
        <div style={{ fontSize: 11, fontFamily: 'var(--font-mono)', color: '#F87171' }}>{error}</div>
      )}

      <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', paddingTop: 8, borderTop: '1px solid var(--line-2)' }}>
        <button type="button" onClick={onCancel} style={{
          padding: '7px 16px', borderRadius: 6, border: '1px solid var(--line-2)',
          background: 'var(--bg-2)', color: 'var(--text-2)', cursor: 'pointer',
          fontSize: 12, fontFamily: 'var(--font-mono)',
        }}>
          Cancel
        </button>
        <button type="button" onClick={handleSave} disabled={saving} style={{
          padding: '7px 16px', borderRadius: 6, border: 'none',
          background: 'var(--action)', color: 'var(--action-fg)', cursor: saving ? 'not-allowed' : 'pointer',
          fontSize: 12, fontFamily: 'var(--font-mono)', fontWeight: 700,
          opacity: saving ? 0.6 : 1,
        }}>
          {saving ? 'Saving…' : 'Save Node'}
        </button>
      </div>
    </div>
  )
}

// ─── ConfirmModal ─────────────────────────────────────────────

function ConfirmModal({ message, onConfirm, onCancel }: {
  message:   string
  onConfirm: () => void
  onCancel:  () => void
}) {
  return (
    <div style={{
      position: 'fixed', inset: 0, zIndex: 4000,
      background: 'rgba(0,0,0,0.5)', backdropFilter: 'blur(4px)',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
    }}>
      <div style={{
        background: 'var(--bg-1)', border: '1px solid var(--line-2)', borderRadius: 10,
        padding: '24px 28px', width: 340,
        boxShadow: '0 20px 60px rgba(0,0,0,0.5)',
        display: 'flex', flexDirection: 'column', gap: 20,
      }}>
        <div style={{ fontSize: 13, fontFamily: 'var(--font-mono)', color: 'var(--text-1)', lineHeight: 1.5 }}>
          {message}
        </div>
        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
          <button onClick={onCancel} style={{
            padding: '7px 16px', borderRadius: 6, border: '1px solid var(--line-2)',
            background: 'var(--bg-2)', color: 'var(--text-2)', cursor: 'pointer',
            fontSize: 12, fontFamily: 'var(--font-mono)',
          }}>Cancel</button>
          <button onClick={onConfirm} style={{
            padding: '7px 16px', borderRadius: 6, border: 'none',
            background: 'var(--state-error, #F87171)', color: '#fff',
            cursor: 'pointer', fontSize: 12, fontFamily: 'var(--font-mono)', fontWeight: 700,
          }}>Archive</button>
        </div>
      </div>
    </div>
  )
}

// ─── Página principal ─────────────────────────────────────────

export default function AdminNodesPage() {
  const [nodes,     setNodes]     = useState<ForgeNode[]>([])
  const [loading,   setLoading]   = useState(true)
  const [selected,  setSelected]  = useState<Partial<ForgeNode> | null>(null)
  const [isNew,     setIsNew]     = useState(false)
  const [phaseFilter,    setPhaseFilter]    = useState('all')
  const [showArchived,   setShowArchived]   = useState(false)
  const [confirmId,      setConfirmId]      = useState<string | null>(null)
  const [error,     setError]     = useState('')
  const [workflows,           setWorkflows]           = useState<ComfyUIWorkflow[]>([])
  const [availableProviders,  setAvailableProviders]  = useState<Record<string, boolean>>({})
  const [skillCatalog,        setSkillCatalog]        = useState<SkillConfig[]>([])

  useEffect(() => {
    Promise.all([getAdminWorkflows(), getModelsConfig(), getAdminSkillConfigs()])
      .then(([wfs, cfg, skills]) => {
        setWorkflows(wfs)
        setAvailableProviders(cfg.available_providers)
        setSkillCatalog(skills)
      })
      .catch(() => {})
  }, [])

  const fetchNodes = useCallback(async () => {
    setLoading(true)
    try {
      const params = new URLSearchParams()
      if (phaseFilter !== 'all') params.set('phase', phaseFilter)
      if (showArchived) params.set('status', 'archived')
      const qs = params.toString() ? `?${params}` : ''
      const res = await adminFetch(`/api/admin/forge/nodes${qs}`)
      const json = await res.json()
      if (!json.success) throw new Error(json.error)
      // Orden jerárquico por segmentos: "3.10" va después de "3.2" (no como decimal)
      const sorted = [...json.nodes].sort((a: ForgeNode, b: ForgeNode) => compareNodeKey(a.node_key, b.node_key))
      setNodes(sorted)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Error al cargar nodos')
    } finally {
      setLoading(false)
    }
  }, [phaseFilter, showArchived])

  useEffect(() => { fetchNodes() }, [fetchNodes])

  const handleNew = () => { setSelected({ ...EMPTY_NODE }); setIsNew(true) }
  const handleEdit = (n: ForgeNode) => { setSelected({ ...n }); setIsNew(false) }
  const handleCancel = () => { setSelected(null); setIsNew(false) }

  const handleSave = async (data: Partial<ForgeNode>) => {
    const path   = isNew ? `/api/admin/forge/nodes` : `/api/admin/forge/nodes/${data.id}`
    const method = isNew ? 'POST' : 'PATCH'
    const res = await adminFetch(path, { method, body: JSON.stringify(data) })
    const json = await res.json()
    if (!json.success) throw new Error(json.error)
    // No cerramos el form — el usuario lo cierra con Cancel cuando quiera
    if (isNew && json.node) {
      setSelected(json.node)
      setIsNew(false)
    }
    fetchNodes()
  }

  const handleClone = async (id: string) => {
    const res = await adminFetch(`/api/admin/forge/nodes/${id}/clone`, { method: 'POST' })
    const json = await res.json()
    if (!json.success) { setError(json.error); return }
    fetchNodes()
    handleEdit(json.node)
  }

  const handleArchive = async (id: string) => {
    const res = await adminFetch(`/api/admin/forge/nodes/${id}/archive`, { method: 'PATCH' })
    const json = await res.json()
    if (!json.success) { setError(json.error); return }
    fetchNodes()
    if (selected && (selected as ForgeNode).id === id) setSelected(null)
  }

  const handleRestore = async (id: string) => {
    const res = await adminFetch(`/api/admin/forge/nodes/${id}/restore`, { method: 'PATCH' })
    const json = await res.json()
    if (!json.success) { setError(json.error); return }
    fetchNodes()
  }

  return (
    <div style={{ height: '100%', display: 'flex', overflow: 'hidden' }}>

      {/* Lista */}
      <div style={{
        width: 340, flexShrink: 0,
        borderRight: '1px solid var(--line-2)',
        display: 'flex', flexDirection: 'column', overflow: 'hidden',
      }}>
        {/* Toolbar */}
        <div style={{
          padding: '12px 16px', borderBottom: '1px solid var(--line-2)',
          display: 'flex', alignItems: 'center', gap: 10, flexShrink: 0,
          background: 'var(--bg-1)',
        }}>
          <span style={{ fontSize: 12, fontFamily: 'var(--font-mono)', fontWeight: 700, color: 'var(--text-1)', flex: 1 }}>
            Node Management System
          </span>
          <select
            value={phaseFilter}
            onChange={e => setPhaseFilter(e.target.value)}
            style={{ ...inputSx, width: 130, padding: '5px 8px', fontSize: 11 }}
          >
            <option value="all">All phases</option>
            {PHASES.map(p => <option key={p} value={p}>{p}</option>)}
          </select>
          <button onClick={() => setShowArchived(v => !v)} style={{
            padding: '5px 10px', borderRadius: 6, fontSize: 11,
            fontFamily: 'var(--font-mono)', cursor: 'pointer',
            border: `1px solid ${showArchived ? 'var(--text-3)' : 'var(--line-2)'}`,
            background: showArchived ? 'var(--bg-3)' : 'transparent',
            color: showArchived ? 'var(--text-1)' : 'var(--text-3)',
          }}>
            {showArchived ? 'Archived' : 'Archived'}
          </button>
        </div>

        {/* Lista de nodos */}
        <div style={{ flex: 1, overflowY: 'auto', padding: 12, display: 'flex', flexDirection: 'column', gap: 4 }}>
          {error && (
            <div style={{ fontSize: 11, fontFamily: 'var(--font-mono)', color: '#F87171', padding: '8px 12px' }}>{error}</div>
          )}
          {loading && (
            <div style={{ fontSize: 11, fontFamily: 'var(--font-mono)', color: 'var(--text-3)', padding: '8px 12px' }}>Loading…</div>
          )}
          {!loading && nodes.map(n => {
            const isActive = selected && (selected as ForgeNode).id === n.id
            return (
              <div key={n.id}
                onClick={() => handleEdit(n)}
                style={{
                  padding: '10px 12px', borderRadius: 8, cursor: 'pointer',
                  background: isActive ? 'color-mix(in srgb, var(--action) 10%, var(--bg-1))' : 'var(--bg-1)',
                  border: `1px solid ${isActive ? 'color-mix(in srgb, var(--action) 30%, var(--line-2))' : 'var(--line-2)'}`,
                  display: 'flex', flexDirection: 'column', gap: 4,
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <span style={{
                    fontSize: 9, fontFamily: 'var(--font-mono)', fontWeight: 700,
                    padding: '2px 6px', borderRadius: 4,
                    background: `color-mix(in srgb, ${PHASE_COLOR[n.phase] ?? '#6b7280'} 15%, var(--bg-2))`,
                    color: PHASE_COLOR[n.phase] ?? '#6b7280',
                  }}>
                    {n.node_key}
                  </span>
                  <span style={{ fontSize: 12, fontFamily: 'var(--font-mono)', fontWeight: 600, color: 'var(--text-1)', flex: 1 }}>
                    {n.title}
                  </span>
                  {n.role === 'gate' && (
                    <span style={{ fontSize: 8, fontFamily: 'var(--font-mono)', fontWeight: 700, color: '#F59E0B', padding: '1px 5px', borderRadius: 3, border: '1px solid color-mix(in srgb, #F59E0B 30%, transparent)', background: 'color-mix(in srgb, #F59E0B 10%, var(--bg-2))' }}>◆ GATE</span>
                  )}
                  {n.parent_id && (
                    <span style={{ fontSize: 9, fontFamily: 'var(--font-mono)', color: 'var(--text-3)' }}>variant</span>
                  )}
                </div>
                <div style={{ fontSize: 10, fontFamily: 'var(--font-mono)', color: 'var(--text-3)', lineHeight: 1.4 }}>
                  {n.purpose?.slice(0, 80)}{(n.purpose?.length ?? 0) > 80 ? '…' : ''}
                </div>
                <div style={{ display: 'flex', gap: 6, marginTop: 2 }}>
                  {n.status === 'archived' ? (
                    <button
                      onClick={e => { e.stopPropagation(); handleRestore(n.id) }}
                      style={{ border: '1px solid var(--line-2)', background: 'var(--bg-2)', borderRadius: 4, padding: '2px 8px', fontSize: 10, fontFamily: 'var(--font-mono)', color: 'var(--text-2)', cursor: 'pointer' }}
                    >Restore</button>
                  ) : (
                    <button
                      onClick={e => { e.stopPropagation(); setConfirmId(n.id) }}
                      style={{ border: '1px solid var(--line-2)', background: 'var(--bg-2)', borderRadius: 4, padding: '2px 8px', fontSize: 10, fontFamily: 'var(--font-mono)', color: 'var(--text-3)', cursor: 'pointer' }}
                    >Archive</button>
                  )}
                </div>
              </div>
            )
          })}
        </div>
      </div>

      {/* Formulario / placeholder */}
      <div style={{ flex: 1, overflowY: 'auto', padding: 24 }}>
        {selected ? (
          <>
            <div style={{
              fontSize: 13, fontFamily: 'var(--font-mono)', fontWeight: 700,
              color: 'var(--text-1)', marginBottom: 20,
            }}>
              {isNew ? 'New Node' : `Edit — ${(selected as ForgeNode).title}`}
            </div>
            <NodeForm
              key={(selected as ForgeNode).id ?? 'new'}
              node={selected}
              onSave={handleSave}
              onCancel={handleCancel}
              workflows={workflows}
              availableProviders={availableProviders}
              skillCatalog={skillCatalog}
            />
          </>
        ) : (
          <div style={{
            height: '100%', display: 'flex', flexDirection: 'column',
            alignItems: 'center', justifyContent: 'center', gap: 12,
            color: 'var(--text-4)',
          }}>
            <div style={{ fontSize: 32, opacity: 0.3 }}>⬡</div>
            <div style={{ fontSize: 12, fontFamily: 'var(--font-mono)' }}>Select a node to edit</div>
          </div>
        )}
      </div>

      {confirmId && (
        <ConfirmModal
          message="Archive this node? It will be hidden from the library but can be restored later."
          onConfirm={() => { handleArchive(confirmId); setConfirmId(null) }}
          onCancel={() => setConfirmId(null)}
        />
      )}
    </div>
  )
}
