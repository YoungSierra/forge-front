'use client'

import { useEffect, useState, useCallback } from 'react'
import {
  getAdminStepConfigs, updateAdminStepConfig,
  getAdminWorkflows, getAdminWorkflow, createAdminWorkflow, updateAdminWorkflow, deleteAdminWorkflow,
  getModelsConfig,
} from '@/lib/api'
import type { StepConfig, ComfyUIWorkflow, InjectConfig, ModelsConfig } from '@/lib/types'

// ─── Constants ────────────────────────────────────────────────────────────────

const MODELS_BY_PROVIDER: Record<string, string[]> = {
  gemini:     ['gemini-2.5-flash', 'gemini-2.5-pro', 'gemini-2.0-flash'],
  openai:     ['gpt-4o', 'gpt-4o-mini', 'gpt-4.1', 'gpt-4.1-mini', 'o3-mini'],
  groq:       ['llama-3.3-70b-versatile', 'llama-3.1-70b-versatile', 'mixtral-8x7b-32768'],
  together:   ['meta-llama/Llama-3-70b-chat-hf', 'mistralai/Mixtral-8x7B-Instruct-v0.1'],
  openrouter: ['meta-llama/llama-3.3-70b-instruct', 'deepseek/deepseek-r1', 'anthropic/claude-3.5-sonnet'],
}

// Auto-detection: class_type → { field }
const AUTO_DETECT: Record<'prompt' | 'width' | 'height' | 'seed', Record<string, string>> = {
  prompt: { CLIPTextEncode: 'text', CLIPLoader: 'text', WanTextEncode: 'text' },
  width:  { EmptyLatentImage: 'width', EmptySD3LatentImage: 'width', EmptyHunyuanLatentVideo: 'width' },
  height: { EmptyLatentImage: 'height', EmptySD3LatentImage: 'height', EmptyHunyuanLatentVideo: 'height' },
  seed:   { KSampler: 'seed', KSamplerAdvanced: 'noise_seed', RandomNoise: 'noise_seed', SamplerCustomAdvanced: 'noise_seed' },
}

const TYPE_COLOR: Record<string, string> = {
  llm:     'var(--cat-code)',
  comfyui: 'var(--cat-output)',
  n8n:     '#f5a623',
}

// ─── Shared styles ────────────────────────────────────────────────────────────

const labelStyle: React.CSSProperties = {
  fontSize: 10, fontFamily: 'monospace', color: 'var(--text-3)',
  textTransform: 'uppercase', letterSpacing: '0.08em', display: 'block', marginBottom: 5,
}
const inputStyle: React.CSSProperties = {
  width: '100%', background: 'var(--bg-1)', border: '1px solid var(--line-2)',
  borderRadius: 6, padding: '7px 10px', fontSize: 12, color: 'var(--text-0)',
  outline: 'none', boxSizing: 'border-box', fontFamily: 'inherit',
}
const selectStyle: React.CSSProperties = { ...inputStyle, cursor: 'pointer' }
const btnStyle = (active = true, accent = false): React.CSSProperties => ({
  padding: '7px 14px', borderRadius: 6, border: 'none', cursor: active ? 'pointer' : 'not-allowed',
  background: accent ? 'var(--cat-code)' : 'var(--bg-3)',
  color: accent ? '#0a0a0c' : 'var(--text-0)',
  fontSize: 11, fontFamily: 'monospace', fontWeight: 600, opacity: active ? 1 : 0.5,
})

// ─── Helpers ──────────────────────────────────────────────────────────────────

function stepConfigHint(s: StepConfig): string {
  if (s.integration_type === 'llm') {
    if (!s.model_name) return 'default model'
    const [provider, ...rest] = s.model_name.split(':')
    return `${provider} / ${rest.join(':')}`
  }
  if (s.integration_type === 'comfyui') {
    return s.comfyui_workflows?.name || 'no workflow'
  }
  if (s.integration_type === 'n8n') {
    if (!s.webhook_url) return 'no webhook'
    try { return new URL(s.webhook_url).hostname } catch { return s.webhook_url.slice(0, 28) }
  }
  return ''
}

type WorkflowNode = { id: string; class_type: string; title: string; fields: string[] }

function parseNodes(wf: Record<string, unknown>): WorkflowNode[] {
  return Object.entries(wf).map(([id, raw]) => {
    const node   = raw as Record<string, unknown>
    const meta   = node._meta as Record<string, string> | undefined
    const inputs = (node.inputs as Record<string, unknown>) || {}
    return {
      id,
      class_type: (node.class_type as string) || id,
      title: meta?.title || (node.class_type as string) || id,
      fields: Object.keys(inputs),
    }
  }).sort((a, b) => a.title.localeCompare(b.title))
}

const EMPTY_INJECT: InjectConfig = {
  prompt: { node: '', field: '' }, width:  { node: '', field: '' },
  height: { node: '', field: '' }, seed:   { node: '', field: '' },
}

function autoDetectInject(nodes: WorkflowNode[]): { inject: InjectConfig; undetected: (keyof InjectConfig)[] } {
  const inject = { ...EMPTY_INJECT }
  const undetected: (keyof InjectConfig)[] = []

  for (const point of ['prompt', 'width', 'height', 'seed'] as const) {
    const map = AUTO_DETECT[point]
    const match = nodes.find(n => map[n.class_type] !== undefined)
    if (match) {
      inject[point] = { node: match.id, field: map[match.class_type] }
    } else {
      undetected.push(point)
    }
  }
  return { inject, undetected }
}

// ─── ModelSelector ────────────────────────────────────────────────────────────

function ModelSelector({ value, onChange, availableProviders }: {
  value: string | null
  onChange: (v: string | null) => void
  availableProviders: Record<string, boolean>
}) {
  const providers = Object.keys(MODELS_BY_PROVIDER).filter(p => availableProviders[p])
  const [provider, model] = value ? value.split(':') : ['', '']

  function set(p: string, m: string) { onChange(p && m ? `${p}:${m}` : null) }

  return (
    <div style={{ display: 'flex', gap: 8 }}>
      <div style={{ flex: 1 }}>
        <label style={labelStyle}>Provider</label>
        <select style={selectStyle} value={provider || ''} onChange={e => set(e.target.value, MODELS_BY_PROVIDER[e.target.value]?.[0] || '')}>
          <option value="">— default —</option>
          {providers.map(p => <option key={p} value={p}>{p}</option>)}
        </select>
      </div>
      {provider && (
        <div style={{ flex: 2 }}>
          <label style={labelStyle}>Model</label>
          <select style={selectStyle} value={model || ''} onChange={e => set(provider, e.target.value)}>
            {(MODELS_BY_PROVIDER[provider] || []).map(m => <option key={m} value={m}>{m}</option>)}
          </select>
        </div>
      )}
    </div>
  )
}

// ─── InjectConfigPicker ───────────────────────────────────────────────────────
// Only shown for fields that could not be auto-detected

function InjectConfigPicker({ nodes, value, onChange, undetected }: {
  nodes: WorkflowNode[]
  value: InjectConfig
  onChange: (v: InjectConfig) => void
  undetected: (keyof InjectConfig)[]
}) {
  function setPoint(point: keyof InjectConfig, key: 'node' | 'field', val: string) {
    const updated = { ...value, [point]: { ...value[point], [key]: val } }
    if (key === 'node') {
      const node = nodes.find(n => n.id === val)
      if (node?.fields.length) updated[point].field = node.fields[0]
    }
    onChange(updated)
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      {undetected.map(point => {
        const selectedNode = nodes.find(n => n.id === value[point]?.node)
        return (
          <div key={point} style={{ background: 'color-mix(in srgb, var(--cat-output) 8%, var(--bg-1))', borderRadius: 6, padding: '10px 12px' }}>
            <label style={{ ...labelStyle, color: 'var(--cat-output)' }}>{point} — not detected, select manually</label>
            <div style={{ display: 'flex', gap: 6 }}>
              <div style={{ flex: 3 }}>
                <select style={{ ...selectStyle, fontSize: 11 }} value={value[point]?.node || ''} onChange={e => setPoint(point, 'node', e.target.value)}>
                  <option value="">— select node —</option>
                  {nodes.map(n => (
                    <option key={n.id} value={n.id}>{n.title} ({n.class_type})</option>
                  ))}
                </select>
              </div>
              <div style={{ flex: 1 }}>
                {selectedNode ? (
                  <select style={{ ...selectStyle, fontSize: 11 }} value={value[point]?.field || ''} onChange={e => setPoint(point, 'field', e.target.value)}>
                    <option value="">— field —</option>
                    {selectedNode.fields.map(f => <option key={f} value={f}>{f}</option>)}
                  </select>
                ) : (
                  <input style={{ ...inputStyle, fontSize: 11 }} placeholder="field" value={value[point]?.field || ''} onChange={e => setPoint(point, 'field', e.target.value)} />
                )}
              </div>
            </div>
          </div>
        )
      })}
    </div>
  )
}

// ─── StepConfigEditor ─────────────────────────────────────────────────────────

function StepConfigEditor({ config, workflows, availableProviders, onSaved }: {
  config: StepConfig
  workflows: ComfyUIWorkflow[]
  availableProviders: Record<string, boolean>
  onSaved: (c: StepConfig) => void
}) {
  const [type, setType]     = useState(config.integration_type)
  const [model, setModel]   = useState<string | null>(config.model_name)
  const [wfId, setWfId]     = useState<string | null>(config.comfyui_workflow_id)
  const [url, setUrl]       = useState(config.webhook_url || '')
  const [saving, setSaving] = useState(false)
  const [error, setError]   = useState('')
  const [success, setSuccess] = useState('')

  useEffect(() => {
    setType(config.integration_type); setModel(config.model_name)
    setWfId(config.comfyui_workflow_id); setUrl(config.webhook_url || '')
    setError(''); setSuccess('')
  }, [config.step_key])

  async function handleSave(e: React.FormEvent) {
    e.preventDefault()
    setSaving(true); setError(''); setSuccess('')
    try {
      const payload: Partial<StepConfig> = { integration_type: type }
      if (type === 'llm')     { payload.model_name = model }
      if (type === 'comfyui') { payload.comfyui_workflow_id = wfId; payload.model_name = model }
      if (type === 'n8n')     { payload.webhook_url = url || null }
      onSaved(await updateAdminStepConfig(config.step_key, payload))
      setSuccess('Saved.')
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Error')
    } finally { setSaving(false) }
  }

  return (
    <form onSubmit={handleSave} style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      <div>
        <label style={labelStyle}>Step</label>
        <div style={{ fontSize: 13, fontFamily: 'monospace', color: 'var(--text-0)', fontWeight: 600 }}>{config.step_key}</div>
      </div>

      <div>
        <label style={labelStyle}>Integration type</label>
        <div style={{ display: 'flex', gap: 6 }}>
          {(['llm', 'comfyui', 'n8n'] as const).map(t => (
            <button key={t} type="button" onClick={() => setType(t)} style={{
              flex: 1, padding: '6px 0', borderRadius: 5, fontSize: 11, fontFamily: 'monospace', cursor: 'pointer',
              border: `1px solid ${type === t ? TYPE_COLOR[t] : 'var(--line-2)'}`,
              background: type === t ? `color-mix(in srgb, ${TYPE_COLOR[t]} 15%, var(--bg-1))` : 'transparent',
              color: type === t ? TYPE_COLOR[t] : 'var(--text-3)',
            }}>{t}</button>
          ))}
        </div>
      </div>

      {type === 'llm' && (
        <div>
          <label style={labelStyle}>Model <span style={{ color: 'var(--text-3)', textTransform: 'none', letterSpacing: 0 }}>(empty = default)</span></label>
          <ModelSelector value={model} onChange={setModel} availableProviders={availableProviders} />
        </div>
      )}

      {type === 'comfyui' && (
        <div>
          <label style={labelStyle}>Workflow</label>
          <select style={selectStyle} value={wfId || ''} onChange={e => setWfId(e.target.value || null)}>
            <option value="">— not assigned —</option>
            {workflows.filter(w => w.is_active).map(w => (
              <option key={w.id} value={w.id}>
                {w.name}{w.description ? ` — ${w.description}` : ''}
              </option>
            ))}
          </select>
          {workflows.length === 0 && (
            <div style={{ fontSize: 10, fontFamily: 'monospace', color: 'var(--cat-output)', marginTop: 4 }}>
              No workflows yet. Create one in the Workflows tab.
            </div>
          )}
        </div>
      )}

      {type === 'n8n' && (
        <div>
          <label style={labelStyle}>Webhook URL</label>
          <input style={inputStyle} type="url" value={url} onChange={e => setUrl(e.target.value)} placeholder="https://..." />
        </div>
      )}

      {error   && <div style={{ fontSize: 11, fontFamily: 'monospace', color: 'var(--cat-output)', background: 'color-mix(in srgb, var(--cat-output) 10%, var(--bg-1))', padding: '8px 10px', borderRadius: 6 }}>{error}</div>}
      {success && <div style={{ fontSize: 11, fontFamily: 'monospace', color: 'var(--cat-code)', padding: '4px 0' }}>{success}</div>}

      <button type="submit" disabled={saving} style={btnStyle(!saving, true)}>
        {saving ? 'Saving...' : 'Save changes'}
      </button>
    </form>
  )
}

// ─── WorkflowEditor ───────────────────────────────────────────────────────────

function WorkflowEditor({ workflow, onSaved, onDeleted }: {
  workflow: ComfyUIWorkflow | null
  onSaved: (w: ComfyUIWorkflow) => void
  onDeleted?: (id: string) => void
}) {
  const [name, setName]         = useState(workflow?.name || '')
  const [desc, setDesc]         = useState(workflow?.description || '')
  const [jsonText, setJsonText] = useState('')
  const [inject, setInject]     = useState<InjectConfig>(workflow?.inject_config || EMPTY_INJECT)
  const [nodes, setNodes]       = useState<WorkflowNode[]>([])
  const [undetected, setUndetected] = useState<(keyof InjectConfig)[]>([])
  const [jsonError, setJsonError]   = useState('')
  const [saving, setSaving]     = useState(false)
  const [error, setError]       = useState('')
  const [success, setSuccess]   = useState('')

  useEffect(() => {
    if (!workflow) { setName(''); setDesc(''); setJsonText(''); setInject(EMPTY_INJECT); setNodes([]); setUndetected([]); return }
    setName(workflow.name); setDesc(workflow.description || '')
    setInject(workflow.inject_config || EMPTY_INJECT)
    setError(''); setSuccess('')

    const loadJson = (wf: Record<string, unknown>) => {
      setJsonText(JSON.stringify(wf, null, 2))
      const parsed = parseNodes(wf)
      setNodes(parsed)
      const { inject: detected, undetected: missing } = autoDetectInject(parsed)
      setInject(detected)
      setUndetected(missing)
    }

    if (workflow.workflow_json) {
      loadJson(workflow.workflow_json)
    } else {
      import('@/lib/api').then(({ getAdminWorkflow }) =>
        getAdminWorkflow(workflow.id).then(full => { if (full.workflow_json) loadJson(full.workflow_json) })
      )
    }
  }, [workflow?.id])

  function handleJsonChange(txt: string) {
    setJsonText(txt); setJsonError('')
    try {
      const parsed = parseNodes(JSON.parse(txt))
      setNodes(parsed)
      const { inject: detected, undetected: missing } = autoDetectInject(parsed)
      setInject(detected)
      setUndetected(missing)
    } catch {
      setJsonError('Invalid JSON'); setNodes([]); setUndetected([])
    }
  }

  async function handleSave(e: React.FormEvent) {
    e.preventDefault()
    if (jsonError) return
    setSaving(true); setError(''); setSuccess('')
    try {
      let parsed: Record<string, unknown>
      try { parsed = JSON.parse(jsonText) } catch { setError('Invalid JSON'); setSaving(false); return }
      const payload = { name, description: desc || undefined, workflow_json: parsed, inject_config: inject }
      onSaved(workflow ? await updateAdminWorkflow(workflow.id, payload) : await createAdminWorkflow(payload))
      setSuccess('Saved.')
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Error')
    } finally { setSaving(false) }
  }

  async function handleDelete() {
    if (!workflow || !onDeleted) return
    if (!confirm(`Delete workflow "${workflow.name}"?`)) return
    try { await deleteAdminWorkflow(workflow.id); onDeleted(workflow.id) }
    catch (err: unknown) { setError(err instanceof Error ? err.message : 'Error') }
  }

  return (
    <form onSubmit={handleSave} style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      <div style={{ display: 'flex', gap: 8 }}>
        <div style={{ flex: 2 }}>
          <label style={labelStyle}>Name (unique slug)</label>
          <input style={inputStyle} value={name} onChange={e => setName(e.target.value)} placeholder="z-image-turbo" required />
        </div>
        <div style={{ flex: 3 }}>
          <label style={labelStyle}>Description</label>
          <input style={inputStyle} value={desc} onChange={e => setDesc(e.target.value)} placeholder="Fast image generation pipeline" />
        </div>
      </div>

      <div>
        <label style={labelStyle}>
          Workflow JSON
          <span style={{ color: 'var(--text-3)', textTransform: 'none', letterSpacing: 0, marginLeft: 6 }}>
            — export from ComfyUI using Save (API format)
          </span>
        </label>
        <textarea
          style={{ ...inputStyle, fontFamily: 'monospace', fontSize: 10, height: 160, resize: 'vertical' }}
          value={jsonText}
          onChange={e => handleJsonChange(e.target.value)}
          placeholder="Paste ComfyUI workflow JSON here..."
          spellCheck={false}
        />
        {jsonError && <div style={{ fontSize: 10, fontFamily: 'monospace', color: 'var(--cat-output)', marginTop: 3 }}>{jsonError}</div>}
      </div>

      {/* Injection config — auto-detected summary */}
      {nodes.length > 0 && (
        <div>
          <label style={labelStyle}>Injection config</label>
          <div style={{ background: 'var(--bg-2)', borderRadius: 6, padding: '10px 12px', display: 'flex', flexDirection: 'column', gap: 6 }}>
            {(['prompt', 'width', 'height', 'seed'] as const).map(point => {
              const cfg  = inject[point]
              const node = nodes.find(n => n.id === cfg?.node)
              const ok   = cfg?.node && cfg?.field
              return (
                <div key={point} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <span style={{ fontSize: 10, fontFamily: 'monospace', color: 'var(--text-3)', width: 48, flexShrink: 0 }}>{point}</span>
                  {ok ? (
                    <>
                      <span style={{ fontSize: 10, fontFamily: 'monospace', color: 'var(--cat-code)' }}>✓</span>
                      <span style={{ fontSize: 10, fontFamily: 'monospace', color: 'var(--text-2)' }}>
                        {node?.title || cfg.node} → <strong>{cfg.field}</strong>
                      </span>
                    </>
                  ) : (
                    <span style={{ fontSize: 10, fontFamily: 'monospace', color: 'var(--cat-output)' }}>not detected</span>
                  )}
                </div>
              )
            })}
          </div>

          {/* Manual picker only for undetected fields */}
          {undetected.length > 0 && (
            <div style={{ marginTop: 10 }}>
              <div style={{ fontSize: 10, fontFamily: 'monospace', color: 'var(--cat-output)', marginBottom: 8 }}>
                {undetected.length} field{undetected.length > 1 ? 's' : ''} could not be auto-detected. Select them manually:
              </div>
              <InjectConfigPicker nodes={nodes} value={inject} onChange={setInject} undetected={undetected} />
            </div>
          )}
        </div>
      )}

      {error   && <div style={{ fontSize: 11, fontFamily: 'monospace', color: 'var(--cat-output)', background: 'color-mix(in srgb, var(--cat-output) 10%, var(--bg-1))', padding: '8px 10px', borderRadius: 6 }}>{error}</div>}
      {success && <div style={{ fontSize: 11, fontFamily: 'monospace', color: 'var(--cat-code)', padding: '4px 0' }}>{success}</div>}

      <div style={{ display: 'flex', gap: 8 }}>
        <button type="submit" disabled={saving || !!jsonError} style={btnStyle(!saving && !jsonError, true)}>
          {saving ? 'Saving...' : workflow ? 'Save changes' : 'Create workflow'}
        </button>
        {workflow && onDeleted && (
          <button type="button" onClick={handleDelete} style={{ ...btnStyle(), color: 'var(--cat-output)' }}>Delete</button>
        )}
      </div>
    </form>
  )
}

// ─── Main page ────────────────────────────────────────────────────────────────

type Tab = 'steps' | 'workflows'

export default function IntegrationsPage() {
  const [tab, setTab]             = useState<Tab>('steps')
  const [stepConfigs, setStepConfigs] = useState<StepConfig[]>([])
  const [workflows, setWorkflows] = useState<ComfyUIWorkflow[]>([])
  const [modelsConfig, setModelsConfig] = useState<ModelsConfig | null>(null)
  const [selectedStep, setSelectedStep] = useState<StepConfig | null>(null)
  const [selectedWf, setSelectedWf]     = useState<ComfyUIWorkflow | null>(null)
  const [newWorkflow, setNewWorkflow]   = useState(false)
  const [loading, setLoading]     = useState(true)

  const availableProviders = modelsConfig?.available_providers as Record<string, boolean> || {}

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const [steps, wfs, models] = await Promise.all([getAdminStepConfigs(), getAdminWorkflows(), getModelsConfig()])
      setStepConfigs(steps); setWorkflows(wfs); setModelsConfig(models)
      if (steps.length) setSelectedStep(steps[0])
    } finally { setLoading(false) }
  }, [])

  useEffect(() => { load() }, [load])

  function handleStepSaved(updated: StepConfig) {
    setStepConfigs(prev => prev.map(s => s.step_key === updated.step_key ? { ...s, ...updated } : s))
    setSelectedStep(updated)
  }

  function handleWfSaved(saved: ComfyUIWorkflow) {
    setWorkflows(prev => {
      const exists = prev.find(w => w.id === saved.id)
      return exists ? prev.map(w => w.id === saved.id ? { ...w, ...saved } : w) : [saved, ...prev]
    })
    setSelectedWf(saved); setNewWorkflow(false)
  }

  function handleWfDeleted(id: string) {
    setWorkflows(prev => prev.filter(w => w.id !== id))
    setSelectedWf(null)
  }

  if (loading) return <div style={{ padding: 24, fontSize: 11, fontFamily: 'monospace', color: 'var(--text-3)' }}>Loading...</div>

  return (
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column' }}>

      {/* Tab bar */}
      <div style={{ padding: '0 20px', borderBottom: '1px solid var(--line-2)', display: 'flex', gap: 2, background: 'var(--bg-1)', flexShrink: 0 }}>
        {([['steps', 'Step Configs'], ['workflows', 'ComfyUI Workflows']] as [Tab, string][]).map(([t, l]) => (
          <button key={t} onClick={() => setTab(t)} style={{
            padding: '10px 16px', background: 'none', border: 'none',
            borderBottom: `2px solid ${tab === t ? 'var(--cat-code)' : 'transparent'}`,
            color: tab === t ? 'var(--text-0)' : 'var(--text-3)',
            fontSize: 11, fontFamily: 'monospace', fontWeight: tab === t ? 600 : 400,
            cursor: 'pointer', transition: 'color 120ms', marginBottom: -1,
          }}>{l}</button>
        ))}
      </div>

      <div style={{ flex: 1, display: 'flex', overflow: 'hidden' }}>

        {/* Step Configs tab */}
        {tab === 'steps' && (
          <>
            <div style={{ width: 240, borderRight: '1px solid var(--line-2)', overflowY: 'auto', flexShrink: 0 }}>
              {stepConfigs.map(s => (
                <div key={s.step_key} onClick={() => setSelectedStep(s)} style={{
                  padding: '9px 16px', cursor: 'pointer', borderBottom: '1px solid var(--line-2)',
                  background: selectedStep?.step_key === s.step_key ? 'var(--bg-2)' : 'transparent',
                }}>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 3 }}>
                    <span style={{ fontSize: 11, fontFamily: 'monospace', color: 'var(--text-0)', fontWeight: 600 }}>{s.step_key}</span>
                    <span style={{
                      fontSize: 9, fontFamily: 'monospace', padding: '2px 6px', borderRadius: 99, flexShrink: 0,
                      background: `color-mix(in srgb, ${TYPE_COLOR[s.integration_type]} 15%, var(--bg-1))`,
                      color: TYPE_COLOR[s.integration_type],
                    }}>{s.integration_type}</span>
                  </div>
                  <div style={{ fontSize: 10, fontFamily: 'monospace', color: 'var(--text-3)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {stepConfigHint(s)}
                  </div>
                </div>
              ))}
            </div>
            <div style={{ flex: 1, overflowY: 'auto', padding: 24 }}>
              {selectedStep
                ? <StepConfigEditor key={selectedStep.step_key} config={selectedStep} workflows={workflows} availableProviders={availableProviders} onSaved={handleStepSaved} />
                : <div style={{ color: 'var(--text-3)', fontSize: 12, fontFamily: 'monospace' }}>Select a step</div>
              }
            </div>
          </>
        )}

        {/* Workflows tab */}
        {tab === 'workflows' && (
          <>
            <div style={{ width: 240, borderRight: '1px solid var(--line-2)', display: 'flex', flexDirection: 'column', flexShrink: 0 }}>
              <div style={{ padding: '12px 16px', borderBottom: '1px solid var(--line-2)' }}>
                <button onClick={() => { setNewWorkflow(true); setSelectedWf(null) }} style={btnStyle(true, true)}>+ New workflow</button>
              </div>
              <div style={{ flex: 1, overflowY: 'auto' }}>
                {workflows.length === 0 && (
                  <div style={{ padding: 16, fontSize: 11, fontFamily: 'monospace', color: 'var(--text-3)' }}>No workflows yet.</div>
                )}
                {workflows.map(w => (
                  <div key={w.id} onClick={() => { setSelectedWf(w); setNewWorkflow(false) }} style={{
                    padding: '10px 16px', cursor: 'pointer', borderBottom: '1px solid var(--line-2)',
                    background: selectedWf?.id === w.id ? 'var(--bg-2)' : 'transparent',
                  }}>
                    <div style={{ fontSize: 11, fontFamily: 'monospace', color: 'var(--text-0)' }}>{w.name}</div>
                    {w.description && <div style={{ fontSize: 10, color: 'var(--text-3)', marginTop: 2 }}>{w.description}</div>}
                  </div>
                ))}
              </div>
            </div>
            <div style={{ flex: 1, overflowY: 'auto', padding: 24 }}>
              {(newWorkflow || selectedWf)
                ? <WorkflowEditor key={selectedWf?.id || 'new'} workflow={newWorkflow ? null : selectedWf} onSaved={handleWfSaved} onDeleted={handleWfDeleted} />
                : <div style={{ color: 'var(--text-3)', fontSize: 12, fontFamily: 'monospace' }}>Select a workflow or create a new one.</div>
              }
            </div>
          </>
        )}
      </div>
    </div>
  )
}
