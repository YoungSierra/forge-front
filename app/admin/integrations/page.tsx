'use client'

import { useEffect, useState, useCallback, useRef } from 'react'
import {
  getAdminStepConfigs, updateAdminStepConfig,
  getAdminWorkflows, getAdminWorkflow, createAdminWorkflow, updateAdminWorkflow, deleteAdminWorkflow,
  testAdminWorkflow, testAdminImage, getModelsConfig, uploadToComfyUI,
} from '@/lib/api'
import MaskPainter, { type MaskPainterHandle } from '@/components/shared/MaskPainter'
import ModelViewer from '@/components/shared/ModelViewer'
import type { StepConfig, ComfyUIWorkflow, InjectConfig, ExtraInjectPoint, ModelsConfig } from '@/lib/types'

// ─── Constants ────────────────────────────────────────────────────────────────

const MODELS_BY_PROVIDER: Record<string, string[]> = {
  gemini:     ['gemini-2.5-flash', 'gemini-2.5-pro', 'gemini-2.0-flash'],
  openai:     [
    'gpt-5', 'gpt-5-mini', 'gpt-5-nano',
    'o3', 'o3-pro', 'o4-mini',
    'gpt-4.1', 'gpt-4.1-mini', 'gpt-4.1-nano',
    'gpt-4o', 'gpt-4o-mini',
    'o1', 'o1-mini', 'o3-mini',
  ],
  groq:       ['llama-3.3-70b-versatile', 'llama-3.1-70b-versatile', 'mixtral-8x7b-32768'],
  together:   ['meta-llama/Llama-3-70b-chat-hf', 'mistralai/Mixtral-8x7B-Instruct-v0.1'],
  openrouter: ['meta-llama/llama-3.3-70b-instruct', 'deepseek/deepseek-r1', 'anthropic/claude-3.5-sonnet'],
}

const IMAGE_MODELS_BY_PROVIDER: Record<string, string[]> = {
  openai: ['gpt-image-2', 'gpt-image-1.5', 'gpt-image-1', 'dall-e-3', 'dall-e-2'],
  fal:    ['flux/schnell', 'flux/dev', 'flux/pro', 'flux-lora'],
}

// Auto-detection: class_type → { field }
const AUTO_DETECT: Record<'prompt' | 'width' | 'height' | 'seed', Record<string, string>> = {
  prompt: { CLIPTextEncode: 'text', WanTextEncode: 'text' },
  width:  { EmptyLatentImage: 'width', EmptySD3LatentImage: 'width', EmptyHunyuanLatentVideo: 'width' },
  height: { EmptyLatentImage: 'height', EmptySD3LatentImage: 'height', EmptyHunyuanLatentVideo: 'height' },
  seed:   { KSampler: 'seed', KSamplerAdvanced: 'noise_seed', RandomNoise: 'noise_seed', SamplerCustomAdvanced: 'noise_seed', OpenAIGPTImage1: 'seed' },
}

const EXTRA_TYPES: ExtraInjectPoint['type'][] = ['string', 'int', 'float', 'image']

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

function stepConfigHint(s: StepConfig, workflows: ComfyUIWorkflow[]): string {
  let main = ''
  if (s.integration_type === 'llm') {
    main = s.model_name ? (() => { const [p, ...r] = s.model_name!.split(':'); return `${p} / ${r.join(':')}` })() : 'default model'
  } else if (s.integration_type === 'comfyui') {
    const wf = workflows.find(w => w.id === s.comfyui_workflow_id)
    main = wf?.name || s.comfyui_workflows?.name || 'no workflow'
  } else if (s.integration_type === 'n8n') {
    main = s.webhook_url ? (() => { try { return new URL(s.webhook_url!).hostname } catch { return s.webhook_url!.slice(0, 28) } })() : 'no webhook'
  }

  if (!s.image_enabled) return main

  let img = ''
  if (s.image_integration_type === 'llm') {
    img = s.image_model ? (() => { const [p, ...r] = s.image_model!.split(':'); return `img:${p}/${r.join(':')}` })() : 'img:default'
  } else if (s.image_integration_type === 'comfyui') {
    const wf = workflows.find(w => w.id === s.image_workflow_id)
    img = wf ? `img:${wf.name}` : 'img:no workflow'
  } else if (s.image_integration_type === 'n8n') {
    img = s.image_webhook_url ? `img:n8n` : 'img:no webhook'
  } else {
    img = 'img:not set'
  }

  return `${main}  ·  ${img}`
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

const EMPTY_INJECT: InjectConfig = {}

type StdPoint = 'prompt' | 'width' | 'height' | 'seed'

function autoDetectInject(nodes: WorkflowNode[]): { inject: InjectConfig; undetected: StdPoint[] } {
  const inject: InjectConfig = {}
  const undetected: StdPoint[] = []

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

function ModelSelector({ value, onChange, availableProviders, catalog = MODELS_BY_PROVIDER }: {
  value: string | null
  onChange: (v: string | null) => void
  availableProviders: Record<string, boolean>
  catalog?: Record<string, string[]>
}) {
  const providers = Object.keys(catalog).filter(p => availableProviders[p] !== false)
  const [provider, model] = value ? value.split(':') : ['', '']

  function set(p: string, m: string) { onChange(p && m ? `${p}:${m}` : null) }

  return (
    <div style={{ display: 'flex', gap: 8 }}>
      <div style={{ flex: 1 }}>
        <label style={labelStyle}>Provider</label>
        <select style={selectStyle} value={provider || ''} onChange={e => set(e.target.value, catalog[e.target.value]?.[0] || '')}>
          <option value="">— default —</option>
          {providers.map(p => <option key={p} value={p}>{p}</option>)}
        </select>
      </div>
      {provider && (
        <div style={{ flex: 2 }}>
          <label style={labelStyle}>Model</label>
          <select style={selectStyle} value={model || ''} onChange={e => set(provider, e.target.value)}>
            {(catalog[provider] || []).map(m => <option key={m} value={m}>{m}</option>)}
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
  undetected: StdPoint[]
}) {
  function setPoint(point: StdPoint, key: 'node' | 'field', val: string) {
    const current = value[point] ?? { node: '', field: '' }
    const next: InjectConfig = { ...value, [point]: { ...current, [key]: val } }
    if (key === 'node') {
      const node = nodes.find(n => n.id === val)
      if (node?.fields.length) next[point] = { node: val, field: node.fields[0] }
    }
    onChange(next)
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
                    <option key={n.id} value={n.id}>[{n.id}] {n.title} ({n.class_type})</option>
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

// ─── ExtraInjectEditor ───────────────────────────────────────────────────────

function ExtraInjectEditor({ nodes, inject, onChange }: {
  nodes: WorkflowNode[]
  inject: InjectConfig
  onChange: (v: InjectConfig) => void
}) {
  const extra = inject.extra ?? {}
  const keys  = Object.keys(extra)

  function setExtra(updated: Record<string, ExtraInjectPoint>) {
    onChange({ ...inject, extra: updated })
  }

  function addPoint() {
    let k = 'new_point'
    let i = 1
    while (k in extra) k = `new_point_${i++}`
    setExtra({ ...extra, [k]: { node: nodes[0]?.id ?? '', field: '', type: 'string' } })
  }

  function removePoint(key: string) {
    const next = { ...extra }
    delete next[key]
    setExtra(next)
  }

  function updateKey(oldKey: string, newKey: string) {
    if (oldKey === newKey || !newKey.trim()) return
    const next: Record<string, ExtraInjectPoint> = {}
    for (const [k, v] of Object.entries(extra)) next[k === oldKey ? newKey.trim() : k] = v
    setExtra(next)
  }

  function updatePoint(key: string, patch: Partial<ExtraInjectPoint>) {
    const point = { ...extra[key], ...patch }
    if (patch.node) {
      const node = nodes.find(n => n.id === patch.node)
      if (node?.fields.length) point.field = node.fields[0]
    }
    setExtra({ ...extra, [key]: point })
  }

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
        <label style={labelStyle}>Extra injection points</label>
        <button type="button" onClick={addPoint} style={{
          fontSize: 10, fontFamily: 'monospace', padding: '3px 10px', borderRadius: 5, cursor: 'pointer',
          border: '1px solid var(--line-2)', background: 'transparent', color: 'var(--cat-code)',
        }}>+ Add point</button>
      </div>

      {keys.length === 0 ? (
        <div style={{ fontSize: 10, fontFamily: 'monospace', color: 'var(--text-3)', padding: '8px 0' }}>
          No extra points — use for workflows with String, PrimitiveInt, LoadImage or other custom nodes.
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {keys.map(key => {
            const pt  = extra[key]
            const nd  = nodes.find(n => n.id === pt.node)
            return (
              <div key={key} style={{ background: 'var(--bg-2)', borderRadius: 6, padding: '10px 12px', display: 'flex', flexDirection: 'column', gap: 8 }}>
                <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                  <input
                    style={{ ...inputStyle, flex: 1, fontSize: 11, fontFamily: 'monospace' }}
                    value={key}
                    onChange={e => updateKey(key, e.target.value)}
                    onBlur={e => updateKey(key, e.target.value)}
                    placeholder="key_name"
                  />
                  <select
                    style={{ ...selectStyle, width: 72, fontSize: 11, flexShrink: 0 }}
                    value={pt.type}
                    onChange={e => updatePoint(key, { type: e.target.value as ExtraInjectPoint['type'] })}
                  >
                    {EXTRA_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
                  </select>
                  <button type="button" onClick={() => removePoint(key)} style={{
                    padding: '4px 8px', borderRadius: 5, fontSize: 11, cursor: 'pointer', flexShrink: 0,
                    border: '1px solid var(--line-2)', background: 'transparent', color: 'var(--cat-output)',
                  }}>✕</button>
                </div>
                <div style={{ display: 'flex', gap: 6 }}>
                  <div style={{ flex: 2 }}>
                    <label style={{ ...labelStyle, marginBottom: 3 }}>Node</label>
                    <select style={{ ...selectStyle, fontSize: 11 }} value={pt.node} onChange={e => updatePoint(key, { node: e.target.value })}>
                      <option value="">— select —</option>
                      {nodes.map(n => <option key={n.id} value={n.id}>[{n.id}] {n.title} ({n.class_type})</option>)}
                    </select>
                  </div>
                  <div style={{ flex: 1 }}>
                    <label style={{ ...labelStyle, marginBottom: 3 }}>Field</label>
                    <select style={{ ...selectStyle, fontSize: 11 }} value={pt.field} onChange={e => updatePoint(key, { field: e.target.value })}>
                      <option value="">— select —</option>
                      {(nd?.fields ?? []).map(f => <option key={f} value={f}>{f}</option>)}
                    </select>
                  </div>
                </div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}

// ─── WorkflowTester ──────────────────────────────────────────────────────────

function WorkflowTester({ workflow, onClose }: { workflow: ComfyUIWorkflow; onClose: () => void }) {
  const inject = workflow.inject_config || {}
  const extra  = inject.extra ?? {}

  const hasSeed = !!(inject.seed?.node && inject.seed?.field)

  // Read existing seed from workflow_json if available
  const existingSeed = (() => {
    if (!hasSeed || !inject.seed?.node || !inject.seed?.field) return ''
    const node = (workflow.workflow_json as Record<string, Record<string, Record<string, unknown>>> | undefined)?.[inject.seed.node]
    const val  = node?.inputs?.[inject.seed.field]
    return val !== undefined ? String(val) : ''
  })()

  // Build initial values
  const initValues = () => {
    const v: Record<string, string> = {}
    if (inject.prompt?.node)  v['prompt'] = 'A stylized 3D character in T-pose, white background, high quality render'
    if (inject.width?.node)   v['width']  = '512'
    if (inject.height?.node)  v['height'] = '512'
    if (hasSeed)              v['seed']   = existingSeed
    for (const [key, pt] of Object.entries(extra)) {
      v[key] = pt.type === 'int' ? '1' : pt.type === 'float' ? '1.0' : ''
    }
    return v
  }

  const [values, setValues]   = useState<Record<string, string>>(initValues)
  const [running, setRunning]           = useState(false)
  const [result, setResult]             = useState<string | null>(null)
  const [glbUrls, setGlbUrls]           = useState<string[]>([])
  const [preparedJson, setPreparedJson] = useState<string | null>(null)
  const [showJson, setShowJson]         = useState(false)
  const [error, setError]               = useState<string | null>(null)
  const [imageFile, setImageFile]       = useState<File | null>(null)
  const [nonMaskFiles, setNonMaskFiles] = useState<Record<string, File>>({})
  const [brushSize, setBrushSize]       = useState(30)
  const maskRef = useRef<MaskPainterHandle>(null)
  const [fakeProgress, setFakeProgress] = useState(0)

  useEffect(() => {
    if (!running) {
      if (result) setFakeProgress(100)
      return
    }
    setFakeProgress(0)
    const iv = setInterval(() => {
      setFakeProgress(prev => {
        if (prev >= 88) return prev
        const step = prev < 30 ? 2.5 : prev < 60 ? 0.9 : 0.35
        return Math.min(88, prev + step)
      })
    }, 300)
    return () => clearInterval(iv)
  }, [running, result])

  const imageExtras   = Object.entries(extra).filter(([, pt]) => pt.type === 'image')
  const isMaskMode    = workflow.mask_capable && imageExtras.length > 0
  const isRefinement  = !!workflow.refinement_capable

  function set(key: string, val: string) { setValues(prev => ({ ...prev, [key]: val })) }

  async function handleRun() {
    setRunning(true); setResult(null); setError(null)
    try {
      // Subir máscara compuesta a ComfyUI antes de armar el payload
      const uploadedFilenames: Record<string, string> = {}
      if (isMaskMode && imageFile) {
        const blob = await maskRef.current?.getComposedBlob()
        if (!blob) throw new Error('Could not compose mask — paint at least one stroke')
        const remoteFilename = await uploadToComfyUI(blob, `mask-test-${Date.now()}.png`)
        for (const [key] of imageExtras) uploadedFilenames[key] = remoteFilename
      } else if (!isMaskMode) {
        for (const [key] of imageExtras) {
          const file = nonMaskFiles[key]
          if (file) {
            const remoteFilename = await uploadToComfyUI(file, `img-test-${Date.now()}.png`)
            uploadedFilenames[key] = remoteFilename
          }
        }
      }

      const payload: Parameters<typeof testAdminWorkflow>[1] = {}
      if ('prompt' in values && values['prompt']) payload.prompt = values['prompt']
      if ('width'  in values && values['width'])  payload.width  = Number(values['width'])
      if ('height' in values && values['height']) payload.height = Number(values['height'])
      if ('seed'   in values && values['seed'])   payload.seed   = Number(values['seed'])
      const extrasPayload: Record<string, string | number> = {}
      for (const [key, pt] of Object.entries(extra)) {
        const val = uploadedFilenames[key] ?? values[key]
        if (!val) continue
        extrasPayload[key] = pt.type === 'int' || pt.type === 'float' ? Number(val) : val
      }
      if (Object.keys(extrasPayload).length) payload.extras = extrasPayload
      const res = await testAdminWorkflow(workflow.id, payload)
      setResult(res.image_url)
      setGlbUrls(res.glb_urls)
      if (res.prepared_workflow) setPreparedJson(JSON.stringify(res.prepared_workflow, null, 2))
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Error')
    } finally { setRunning(false) }
  }

  const TYPE_INPUT: Record<string, string> = { int: 'number', float: 'number', string: 'text', image: 'text' }

  const needsImage = isMaskMode ? !imageFile : (imageExtras.length > 0 && Object.keys(nonMaskFiles).length === 0)

  return (
    <div style={{
      position: 'fixed', inset: 0, zIndex: 3000,
      background: 'rgba(0,0,0,0.75)', backdropFilter: 'blur(4px)',
      display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24,
    }}>
      <div style={{
        background: 'var(--bg-1)', border: '1px solid var(--line-2)', borderRadius: 12,
        width: '100%', maxWidth: 1200, height: '82vh', minHeight: 520,
        boxShadow: '0 24px 80px rgba(0,0,0,0.6)',
        display: 'flex', flexDirection: 'column', overflow: 'hidden',
      }}>

        {/* ── Header ── */}
        <div style={{ padding: '12px 20px', borderBottom: '1px solid var(--line-2)', display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexShrink: 0 }}>
          <div>
            <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--text-0)' }}>Test workflow</div>
            <div style={{ fontSize: 11, fontFamily: 'monospace', color: 'var(--text-3)', marginTop: 2 }}>{workflow.name}</div>
          </div>
          <button onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 18, color: 'var(--text-3)' }}>✕</button>
        </div>

        {/* ── Controls bar (ancho completo) ── */}
        <div style={{ padding: '12px 20px', borderBottom: '1px solid var(--line-2)', display: 'flex', alignItems: 'flex-end', gap: 12, flexWrap: 'wrap', flexShrink: 0 }}>
          {inject.prompt?.node && (
            <div style={{ flex: '2 1 180px' }}>
              <label style={labelStyle}>prompt</label>
              <textarea style={{ ...inputStyle, fontFamily: 'monospace', fontSize: 11, height: 58, resize: 'none' }}
                value={values['prompt'] ?? ''} onChange={e => set('prompt', e.target.value)} />
            </div>
          )}
          {inject.width?.node && (
            <div style={{ flex: '0 0 76px' }}>
              <label style={labelStyle}>width</label>
              <input type="number" style={inputStyle} value={values['width'] ?? '512'} onChange={e => set('width', e.target.value)} />
            </div>
          )}
          {inject.height?.node && (
            <div style={{ flex: '0 0 76px' }}>
              <label style={labelStyle}>height</label>
              <input type="number" style={inputStyle} value={values['height'] ?? '512'} onChange={e => set('height', e.target.value)} />
            </div>
          )}
          {hasSeed && (
            <div style={{ flex: '0 0 110px' }}>
              <label style={labelStyle}>seed <span style={{ color: 'var(--text-3)', textTransform: 'none', letterSpacing: 0 }}>(blank = random)</span></label>
              <input type="number" style={inputStyle} value={values['seed'] ?? ''} onChange={e => set('seed', e.target.value)} placeholder="random" />
            </div>
          )}

          {/* Extras no-imagen */}
          {Object.entries(extra).filter(([, pt]) => pt.type !== 'image').map(([key, pt]) => (
            <div key={key} style={{ flex: pt.type === 'string' ? '1 1 160px' : '0 0 100px' }}>
              <label style={labelStyle}>{key} <span style={{ color: 'var(--cat-code)', textTransform: 'none', letterSpacing: 0 }}>{pt.type}</span></label>
              {pt.type === 'string'
                ? <textarea style={{ ...inputStyle, fontFamily: 'monospace', fontSize: 11, height: 58, resize: 'none' }} value={values[key] ?? ''} onChange={e => set(key, e.target.value)} />
                : <input type={TYPE_INPUT[pt.type] ?? 'text'} style={inputStyle} value={values[key] ?? ''} onChange={e => set(key, e.target.value)} />
              }
            </div>
          ))}

          {/* Image picker — mask mode */}
          {isMaskMode && (
            <div style={{ flex: '0 0 auto', display: 'flex', flexDirection: 'column', gap: 4 }}>
              <label style={labelStyle}>image <span style={{ color: 'var(--cat-asset)', textTransform: 'none', letterSpacing: 0 }}>— paint the area below</span></label>
              <label style={{ cursor: 'pointer' }}>
                <span style={{ fontSize: 11, fontFamily: 'monospace', padding: '6px 14px', borderRadius: 6, border: '1px solid var(--line-2)', background: 'var(--bg-3)', color: 'var(--text-1)', whiteSpace: 'nowrap', display: 'inline-block' }}>
                  {imageFile ? `✓ ${imageFile.name}` : '📁 Choose image…'}
                </span>
                <input type="file" accept="image/*" style={{ display: 'none' }} onChange={e => setImageFile(e.target.files?.[0] || null)} />
              </label>
            </div>
          )}

          {/* Image pickers — non-mask */}
          {!isMaskMode && imageExtras.map(([key]) => (
            <div key={key} style={{ flex: '0 0 auto', display: 'flex', flexDirection: 'column', gap: 4 }}>
              <label style={labelStyle}>{key} <span style={{ color: 'var(--cat-code)', textTransform: 'none', letterSpacing: 0 }}>image</span></label>
              <label style={{ cursor: 'pointer' }}>
                <span style={{ fontSize: 11, fontFamily: 'monospace', padding: '6px 14px', borderRadius: 6, border: '1px solid var(--line-2)', background: 'var(--bg-3)', color: 'var(--text-1)', whiteSpace: 'nowrap', display: 'inline-block' }}>
                  {nonMaskFiles[key] ? `✓ ${nonMaskFiles[key].name}` : '📁 Choose image…'}
                </span>
                <input type="file" accept="image/*" style={{ display: 'none' }}
                  onChange={e => { const f = e.target.files?.[0]; if (f) setNonMaskFiles(prev => ({ ...prev, [key]: f })) }} />
              </label>
            </div>
          ))}

          {/* Run button — siempre al final */}
          <div style={{ flex: '0 0 auto', marginLeft: 'auto', alignSelf: 'flex-end', display: 'flex', flexDirection: 'column', gap: 6 }}>
            {preparedJson && (
              <button type="button" onClick={() => setShowJson(v => !v)} style={{ fontSize: 9, fontFamily: 'monospace', padding: '4px 10px', borderRadius: 5, cursor: 'pointer', border: '1px solid var(--line-2)', background: 'transparent', color: 'var(--text-3)', alignSelf: 'flex-start' }}>
                {showJson ? 'Hide JSON' : 'Show JSON'}
              </button>
            )}
            <button type="button" onClick={handleRun} disabled={running || needsImage}
              style={{ ...btnStyle(!running && !needsImage, true), display: 'flex', alignItems: 'center', gap: 8, whiteSpace: 'nowrap' }}>
              {running
                ? <><span style={{ display: 'inline-block', width: 12, height: 12, border: '2px solid currentColor', borderTopColor: 'transparent', borderRadius: '50%', animation: 'spin 0.7s linear infinite' }} />Running…</>
                : needsImage ? 'Pick an image first'
                : '▶ Run workflow'}
            </button>
          </div>

          {/* Error + JSON */}
          {error && (
            <div style={{ flex: '1 1 100%', fontSize: 11, fontFamily: 'monospace', color: 'var(--cat-output)', background: 'color-mix(in srgb, var(--cat-output) 10%, var(--bg-1))', padding: '8px 10px', borderRadius: 6 }}>{error}</div>
          )}
          {showJson && preparedJson && (
            <div style={{ flex: '1 1 100%' }}>
              <textarea readOnly value={preparedJson}
                style={{ ...inputStyle, fontFamily: 'monospace', fontSize: 9, height: 110, resize: 'vertical', color: 'var(--text-2)' }} />
            </div>
          )}
        </div>

        {/* ── Paneles inferiores ── */}
        <div style={{ flex: 1, minHeight: 0, display: 'flex' }}>

          {/* Panel izquierdo: solo si hay image inputs */}
          {imageExtras.length > 0 && <div style={{ width: '50%', flexShrink: 0, borderRight: '1px solid var(--line-2)', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
            <div style={{ padding: '8px 16px', borderBottom: '1px solid var(--line-2)', display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexShrink: 0 }}>
              <span style={{ fontSize: 10, fontFamily: 'monospace', color: 'var(--text-3)', textTransform: 'uppercase', letterSpacing: '0.08em' }}>Original</span>
              {isMaskMode && imageFile && (
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <label style={{ ...labelStyle, marginBottom: 0, whiteSpace: 'nowrap' }}>Brush</label>
                  <input type="range" min={5} max={120} value={brushSize} onChange={e => setBrushSize(Number(e.target.value))} style={{ width: 80 }} />
                  <span style={{ fontSize: 10, fontFamily: 'monospace', color: 'var(--text-3)', width: 28, textAlign: 'right' }}>{brushSize}px</span>
                  <button type="button" onClick={() => maskRef.current?.clear()} style={{ fontSize: 10, fontFamily: 'monospace', padding: '3px 10px', borderRadius: 5, cursor: 'pointer', border: '1px solid var(--line-2)', background: 'transparent', color: 'var(--text-3)' }}>Clear</button>
                </div>
              )}
            </div>
            <div style={{ flex: 1, minHeight: 0, overflow: 'auto', display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#0a0a0c' }}>
              {isMaskMode && imageFile ? (
                <MaskPainter ref={maskRef} imageFile={imageFile} brushSize={brushSize} />
              ) : Object.values(nonMaskFiles)[0] ? (
                <img
                  src={URL.createObjectURL(Object.values(nonMaskFiles)[0])}
                  alt="input"
                  style={{ maxWidth: '100%', maxHeight: '100%', objectFit: 'contain', borderRadius: 6, display: 'block' }}
                />
              ) : (
                <div style={{ textAlign: 'center', opacity: 0.25 }}>
                  <div style={{ fontSize: 36, lineHeight: 1 }}>◧</div>
                  <div style={{ fontSize: 11, fontFamily: 'monospace', color: 'var(--text-3)', marginTop: 10 }}>
                    {isMaskMode ? 'Pick an image above to start painting' : 'No image input'}
                  </div>
                </div>
              )}
            </div>
          </div>}

          {/* Panel derecho: resultado 2D o viewer 3D */}
          <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', background: '#0d0d0d' }}>
            <div style={{ padding: '8px 16px', borderBottom: '1px solid var(--line-2)', display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexShrink: 0 }}>
              <span style={{ fontSize: 10, fontFamily: 'monospace', color: 'var(--text-3)', textTransform: 'uppercase', letterSpacing: '0.08em' }}>Result</span>
              {result && glbUrls.length === 0 && <a href={result} target="_blank" rel="noreferrer" style={{ fontSize: 10, fontFamily: 'monospace', color: 'var(--cat-code)' }}>Open full size ↗</a>}
              {!result && glbUrls.length === 0 && !running && <span style={{ fontSize: 10, fontFamily: 'monospace', color: 'var(--text-4)' }}>drag a .glb to load locally</span>}
            </div>

            <div style={{ flex: 1, minHeight: 0, position: 'relative', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: running || result ? 16 : 0, overflow: 'hidden' }}>
              {running ? (
                <div style={{ width: '72%', display: 'flex', flexDirection: 'column', gap: 8 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <span style={{ fontSize: 10, fontFamily: 'monospace', color: 'var(--text-3)', animation: 'item-pulse 1.6s ease-in-out infinite' }}>
                      {fakeProgress < 30 ? 'Sending to ComfyUI…' : fakeProgress < 65 ? 'Generating…' : 'Almost ready…'}
                    </span>
                    <span style={{ fontSize: 10, fontFamily: 'monospace', color: 'var(--cat-audio)' }}>{Math.round(fakeProgress)}%</span>
                  </div>
                  <div style={{ width: '100%', height: 3, background: 'var(--bg-3)', borderRadius: 99, overflow: 'hidden' }}>
                    <div style={{ height: '100%', borderRadius: 99, background: 'linear-gradient(90deg, var(--cat-audio), var(--cat-design))', width: `${fakeProgress}%`, transition: 'width 0.4s ease' }} />
                  </div>
                </div>
              ) : result && glbUrls.length === 0 ? (
                <img src={result} alt="result" style={{ maxWidth: '100%', maxHeight: '100%', objectFit: 'contain', borderRadius: 8, display: 'block' }} />
              ) : (
                <ModelViewer url={glbUrls[0]} style={{ position: 'absolute', inset: 0, height: '100%', borderRadius: 0, border: 'none' }} />
              )}
            </div>

            {glbUrls.length > 0 && !running && (
              <div style={{ padding: '10px 16px', borderTop: '1px solid var(--line-2)', display: 'flex', gap: 16, flexWrap: 'wrap', flexShrink: 0 }}>
                {glbUrls.map((url, i) => (
                  <a key={i} href={url} target="_blank" rel="noreferrer" style={{ fontSize: 10, fontFamily: 'monospace', color: 'var(--cat-asset)' }}>
                    ↓ model_{i + 1}.glb
                  </a>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
      <style>{`@keyframes spin { to { transform: rotate(360deg) } } @keyframes item-pulse { 0%,100%{opacity:1} 50%{opacity:0.45} }`}</style>
    </div>
  )
}

// ─── ImageTester ─────────────────────────────────────────────────────────────

function ImageTester({ model, onClose }: { model: string; onClose: () => void }) {
  const [prompt,  setPrompt]  = useState('A stylized game character, concept art, detailed illustration')
  const [width,   setWidth]   = useState(512)
  const [height,  setHeight]  = useState(512)
  const [running, setRunning] = useState(false)
  const [result,  setResult]  = useState<string | null>(null)
  const [error,   setError]   = useState<string | null>(null)

  const [provider] = model.split(':')

  async function handleRun() {
    setRunning(true); setResult(null); setError(null)
    try {
      const res = await testAdminImage(model, prompt, width, height)
      setResult(res.image_url)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Error')
    } finally { setRunning(false) }
  }

  return (
    <div style={{
      position: 'fixed', inset: 0, zIndex: 3000,
      background: 'rgba(0,0,0,0.75)', backdropFilter: 'blur(4px)',
      display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24,
    }}>
      <div style={{
        background: 'var(--bg-1)', border: '1px solid var(--line-2)', borderRadius: 12,
        width: '100%', maxWidth: 480, maxHeight: '90vh', overflow: 'auto',
        boxShadow: '0 24px 80px rgba(0,0,0,0.6)', padding: 24, display: 'flex', flexDirection: 'column', gap: 16,
      }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div>
            <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--text-0)' }}>Test image model</div>
            <div style={{ fontSize: 11, fontFamily: 'monospace', color: 'var(--text-3)', marginTop: 2 }}>{model}</div>
          </div>
          <button onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 18, color: 'var(--text-3)' }}>✕</button>
        </div>

        <div>
          <label style={labelStyle}>Prompt</label>
          <textarea
            style={{ ...inputStyle, fontFamily: 'monospace', fontSize: 11, height: 80, resize: 'vertical' }}
            value={prompt} onChange={e => setPrompt(e.target.value)}
          />
        </div>

        <div style={{ display: 'flex', gap: 8 }}>
          <div style={{ flex: 1 }}>
            <label style={labelStyle}>Width</label>
            <input type="number" style={inputStyle} value={width} min={64} max={2048} step={64}
              onChange={e => setWidth(Number(e.target.value))} />
          </div>
          <div style={{ flex: 1 }}>
            <label style={labelStyle}>Height</label>
            <input type="number" style={inputStyle} value={height} min={64} max={2048} step={64}
              onChange={e => setHeight(Number(e.target.value))} />
          </div>
        </div>

        {provider === 'openai' && (
          <div style={{ fontSize: 10, fontFamily: 'monospace', color: 'var(--text-3)', padding: '6px 10px', background: 'var(--bg-2)', borderRadius: 6 }}>
            Note: DALL-E and gpt-image models ignore width/height — use square sizes (512, 1024).
          </div>
        )}

        {error && (
          <div style={{ fontSize: 11, fontFamily: 'monospace', color: 'var(--cat-output)', background: 'color-mix(in srgb, var(--cat-output) 10%, var(--bg-1))', padding: '8px 10px', borderRadius: 6 }}>{error}</div>
        )}

        {result && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            <div style={{ fontSize: 10, fontFamily: 'monospace', color: 'var(--cat-code)' }}>✓ Generated</div>
            <img src={result} alt="result" style={{ width: '100%', borderRadius: 8, border: '1px solid var(--line-2)', display: 'block' }} />
            <a href={result} target="_blank" rel="noreferrer" style={{ fontSize: 10, fontFamily: 'monospace', color: 'var(--cat-code)' }}>Open full size ↗</a>
          </div>
        )}

        <button
          type="button" onClick={handleRun} disabled={running || !prompt.trim()}
          style={{ ...btnStyle(!running && !!prompt.trim(), true), display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8 }}
        >
          {running
            ? <><span style={{ display: 'inline-block', width: 12, height: 12, border: '2px solid currentColor', borderTopColor: 'transparent', borderRadius: '50%', animation: 'spin 0.7s linear infinite' }} />Generating…</>
            : '▶ Generate image'}
        </button>
        <style>{`@keyframes spin { to { transform: rotate(360deg) } }`}</style>
      </div>
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
  const [type, setType]         = useState(config.integration_type)
  const [model, setModel]       = useState<string | null>(config.model_name)
  const [wfId, setWfId]         = useState<string | null>(config.comfyui_workflow_id)
  const [url, setUrl]           = useState(config.webhook_url || '')
  const [imgEnabled, setImgEnabled]   = useState(config.image_enabled)
  const [imgType, setImgType]         = useState<'llm' | 'comfyui' | 'n8n'>(config.image_integration_type || 'comfyui')
  const [imgModel, setImgModel]       = useState<string | null>(config.image_model)
  const [imgWfId, setImgWfId]         = useState<string | null>(config.image_workflow_id)
  const [imgUrl, setImgUrl]           = useState(config.image_webhook_url || '')
  const [saving, setSaving]       = useState(false)
  const [error, setError]         = useState('')
  const [success, setSuccess]     = useState('')
  const [imageTesting, setImageTesting] = useState(false)

  useEffect(() => {
    setImageTesting(false)
    setType(config.integration_type); setModel(config.model_name)
    setWfId(config.comfyui_workflow_id); setUrl(config.webhook_url || '')
    setImgEnabled(config.image_enabled)
    setImgType(config.image_integration_type || 'comfyui')
    setImgModel(config.image_model); setImgWfId(config.image_workflow_id)
    setImgUrl(config.image_webhook_url || '')
    setError(''); setSuccess('')
  }, [config.step_key])

  async function handleSave(e: React.FormEvent) {
    e.preventDefault()
    setSaving(true); setError(''); setSuccess('')
    try {
      const payload: Partial<StepConfig> = { integration_type: type }
      if (type === 'llm')     { payload.model_name = model }
      if (type === 'comfyui') { payload.comfyui_workflow_id = wfId }
      if (type === 'n8n')     { payload.webhook_url = url || null }
      payload.image_enabled = imgEnabled
      if (imgEnabled) {
        payload.image_integration_type = imgType
        if (imgType === 'llm')     { payload.image_model = imgModel }
        if (imgType === 'comfyui') { payload.image_workflow_id = imgWfId }
        if (imgType === 'n8n')     { payload.image_webhook_url = imgUrl || null }
      }
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
            {workflows.filter(w => w.is_active && !w.refinement_capable).map(w => (
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

      {/* ── Preview images ── */}
      <div style={{ borderTop: '1px solid var(--line-2)', paddingTop: 14 }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: imgEnabled ? 12 : 0 }}>
          <label style={labelStyle}>Preview images</label>
          <button type="button" onClick={() => setImgEnabled(v => !v)} style={{
            padding: '3px 10px', borderRadius: 5, fontSize: 10, fontFamily: 'monospace', cursor: 'pointer',
            border: `1px solid ${imgEnabled ? 'var(--cat-code)' : 'var(--line-2)'}`,
            background: imgEnabled ? 'color-mix(in srgb, var(--cat-code) 15%, var(--bg-1))' : 'transparent',
            color: imgEnabled ? 'var(--cat-code)' : 'var(--text-3)',
          }}>{imgEnabled ? 'enabled' : 'disabled'}</button>
        </div>

        {imgEnabled && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            <div>
              <label style={labelStyle}>Image integration</label>
              <div style={{ display: 'flex', gap: 6 }}>
                {(['llm', 'comfyui', 'n8n'] as const).map(t => (
                  <button key={t} type="button" onClick={() => setImgType(t)} style={{
                    flex: 1, padding: '6px 0', borderRadius: 5, fontSize: 11, fontFamily: 'monospace', cursor: 'pointer',
                    border: `1px solid ${imgType === t ? TYPE_COLOR[t] : 'var(--line-2)'}`,
                    background: imgType === t ? `color-mix(in srgb, ${TYPE_COLOR[t]} 15%, var(--bg-1))` : 'transparent',
                    color: imgType === t ? TYPE_COLOR[t] : 'var(--text-3)',
                  }}>{t}</button>
                ))}
              </div>
            </div>

            {imgType === 'llm' && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                <div>
                  <label style={labelStyle}>Image model <span style={{ color: 'var(--text-3)', textTransform: 'none', letterSpacing: 0 }}>(empty = default)</span></label>
                  <ModelSelector value={imgModel} onChange={setImgModel} availableProviders={availableProviders} catalog={IMAGE_MODELS_BY_PROVIDER} />
                </div>
                {imgModel && (
                  <button type="button" onClick={() => setImageTesting(true)} style={{
                    alignSelf: 'flex-start', padding: '5px 12px', borderRadius: 5, fontSize: 11, fontFamily: 'monospace', cursor: 'pointer',
                    border: '1px solid var(--cat-gate)', background: 'color-mix(in srgb, var(--cat-gate) 10%, var(--bg-1))', color: 'var(--cat-gate)',
                  }}>
                    ▶ Test image
                  </button>
                )}
              </div>
            )}

            {imgType === 'comfyui' && (
              <div>
                <label style={labelStyle}>Image workflow</label>
                <select style={selectStyle} value={imgWfId || ''} onChange={e => setImgWfId(e.target.value || null)}>
                  <option value="">— not assigned —</option>
                  {workflows.filter(w => w.is_active && !w.refinement_capable).map(w => (
                    <option key={w.id} value={w.id}>{w.name}{w.description ? ` — ${w.description}` : ''}</option>
                  ))}
                </select>
              </div>
            )}

            {imgType === 'n8n' && (
              <div>
                <label style={labelStyle}>Image webhook URL</label>
                <input style={inputStyle} type="url" value={imgUrl} onChange={e => setImgUrl(e.target.value)} placeholder="https://..." />
              </div>
            )}
          </div>
        )}
      </div>

      {error   && <div style={{ fontSize: 11, fontFamily: 'monospace', color: 'var(--cat-output)', background: 'color-mix(in srgb, var(--cat-output) 10%, var(--bg-1))', padding: '8px 10px', borderRadius: 6 }}>{error}</div>}
      {success && <div style={{ fontSize: 11, fontFamily: 'monospace', color: 'var(--cat-code)', padding: '4px 0' }}>{success}</div>}

      <button type="submit" disabled={saving} style={btnStyle(!saving, true)}>
        {saving ? 'Saving...' : 'Save changes'}
      </button>

      {imageTesting && imgModel && <ImageTester model={imgModel} onClose={() => setImageTesting(false)} />}
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
  const [inject, setInject]       = useState<InjectConfig>(workflow?.inject_config || EMPTY_INJECT)
  const [nodes, setNodes]         = useState<WorkflowNode[]>([])
  const [expandedPoint, setExpandedPoint] = useState<StdPoint | null>(null)
  const [refinementCapable, setRefinementCapable] = useState(workflow?.refinement_capable ?? false)
  const [maskCapable, setMaskCapable]             = useState(workflow?.mask_capable ?? false)
  const [testing, setTesting]     = useState(false)
  const [jsonError, setJsonError]   = useState('')
  const [saving, setSaving]     = useState(false)
  const [error, setError]       = useState('')
  const [success, setSuccess]   = useState('')

  useEffect(() => {
    if (!workflow) { setName(''); setDesc(''); setJsonText(''); setInject(EMPTY_INJECT); setNodes([]); setRefinementCapable(false); setMaskCapable(false); return }
    setName(workflow.name); setDesc(workflow.description || '')
    setInject(workflow.inject_config || EMPTY_INJECT)
    setRefinementCapable(workflow.refinement_capable ?? false)
    setMaskCapable(workflow.mask_capable ?? false)
    setError(''); setSuccess('')

    const savedInject = workflow.inject_config || EMPTY_INJECT

    const loadJson = (wf: Record<string, unknown>) => {
      setJsonText(JSON.stringify(wf, null, 2))
      const parsed = parseNodes(wf)
      setNodes(parsed)
      // Use saved inject_config if it has any configured points; otherwise auto-detect
      const hasConfig = savedInject.prompt?.node || savedInject.seed?.node || Object.keys(savedInject.extra ?? {}).length > 0
      if (hasConfig) {
        setInject(savedInject)
      } else {
        const { inject: detected } = autoDetectInject(parsed)
        setInject(detected)
      }
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
      const { inject: detected } = autoDetectInject(parsed)
      // Preserve extra points already configured by the user
      setInject(prev => ({ ...detected, extra: prev.extra }))
    } catch {
      setJsonError('Invalid JSON'); setNodes([])
    }
  }

  async function handleSave(e: React.FormEvent) {
    e.preventDefault()
    if (jsonError) return
    setSaving(true); setError(''); setSuccess('')
    try {
      let parsed: Record<string, unknown>
      try { parsed = JSON.parse(jsonText) } catch { setError('Invalid JSON'); setSaving(false); return }
      const payload = { name, description: desc || undefined, workflow_json: parsed, inject_config: inject, refinement_capable: refinementCapable, mask_capable: maskCapable }
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

      {/* Flags de refinamiento */}
      <div style={{ display: 'flex', gap: 8 }}>
        {([
          { label: 'Refinement workflow', value: refinementCapable, set: setRefinementCapable, hint: 'Appears in the image refinement tool' },
          { label: 'Supports mask',       value: maskCapable,       set: setMaskCapable,       hint: 'Enables the mask brush when this workflow is selected' },
        ] as const).map(({ label, value, set, hint }) => (
          <div key={label} style={{ flex: 1, background: value ? 'color-mix(in oklch, var(--cat-asset) 10%, var(--bg-2))' : 'var(--bg-2)', border: `1px solid ${value ? 'color-mix(in oklch, var(--cat-asset) 35%, transparent)' : 'var(--line-2)'}`, borderRadius: 7, padding: '8px 12px', cursor: 'pointer', transition: 'all 120ms' }}
            onClick={() => set(v => !v)}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 7, marginBottom: 3 }}>
              <div style={{ width: 14, height: 14, borderRadius: 3, background: value ? 'var(--cat-asset)' : 'var(--bg-3)', border: `1px solid ${value ? 'var(--cat-asset)' : 'var(--line-2)'}`, display: 'grid', placeItems: 'center', fontSize: 9, color: '#0a0a0c', fontWeight: 700, flexShrink: 0 }}>
                {value ? '✓' : ''}
              </div>
              <span style={{ fontSize: 11, fontFamily: 'monospace', fontWeight: 600, color: value ? 'var(--text-0)' : 'var(--text-3)' }}>{label}</span>
            </div>
            <div style={{ fontSize: 10, fontFamily: 'monospace', color: 'var(--text-3)', paddingLeft: 21 }}>{hint}</div>
          </div>
        ))}
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

      {/* Injection config */}
      {nodes.length > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          <div>
            <label style={labelStyle}>Standard injection points <span style={{ color: 'var(--text-3)', textTransform: 'none', letterSpacing: 0 }}>— click "not used" to configure</span></label>
            <div style={{ background: 'var(--bg-2)', borderRadius: 6, padding: '10px 12px', display: 'flex', flexDirection: 'column', gap: 8 }}>
              {(['prompt', 'width', 'height', 'seed'] as const).map(point => {
                const cfg      = inject[point]
                const cfgNode  = nodes.find(n => n.id === cfg?.node)
                const ok       = !!(cfg?.node && cfg?.field)
                const expanded = expandedPoint === point
                return (
                  <div key={point}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <span style={{ fontSize: 10, fontFamily: 'monospace', color: 'var(--text-3)', width: 48, flexShrink: 0 }}>{point}</span>
                      {ok ? (
                        <>
                          <span style={{ fontSize: 10, fontFamily: 'monospace', color: 'var(--cat-code)' }}>✓</span>
                          <span style={{ fontSize: 10, fontFamily: 'monospace', color: 'var(--text-2)', flex: 1 }}>
                            {cfgNode?.title || cfg!.node} → <strong>{cfg!.field}</strong>
                          </span>
                          <button type="button" onClick={() => setExpandedPoint(expanded ? null : point)} style={{ fontSize: 9, fontFamily: 'monospace', padding: '2px 7px', borderRadius: 4, cursor: 'pointer', border: '1px solid var(--line-2)', background: 'transparent', color: 'var(--text-3)' }}>
                            {expanded ? 'close' : 'edit'}
                          </button>
                        </>
                      ) : (
                        <button type="button" onClick={() => setExpandedPoint(expanded ? null : point)} style={{ fontSize: 10, fontFamily: 'monospace', padding: '2px 8px', borderRadius: 4, cursor: 'pointer', border: '1px dashed var(--line-2)', background: 'transparent', color: 'var(--text-3)' }}>
                          — not used · configure
                        </button>
                      )}
                    </div>
                    {expanded && (
                      <div style={{ display: 'flex', gap: 6, marginTop: 6, paddingLeft: 56 }}>
                        <div style={{ flex: 2 }}>
                          <select style={{ ...selectStyle, fontSize: 11 }} value={cfg?.node || ''} onChange={e => {
                            const n = nodes.find(x => x.id === e.target.value)
                            setInject(prev => ({ ...prev, [point]: { node: e.target.value, field: n?.fields[0] ?? '' } }))
                          }}>
                            <option value="">— select node —</option>
                            {nodes.map(n => <option key={n.id} value={n.id}>[{n.id}] {n.title} ({n.class_type})</option>)}
                          </select>
                        </div>
                        <div style={{ flex: 1 }}>
                          <select style={{ ...selectStyle, fontSize: 11 }} value={cfg?.field || ''} onChange={e => setInject(prev => ({ ...prev, [point]: { node: prev[point]?.node ?? '', field: e.target.value } }))}>
                            <option value="">— field —</option>
                            {(cfgNode?.fields ?? nodes.find(n => n.id === cfg?.node)?.fields ?? []).map(f => <option key={f} value={f}>{f}</option>)}
                          </select>
                        </div>
                        {ok && (
                          <button type="button" onClick={() => { setInject(prev => { const next = { ...prev }; delete next[point]; return next }); setExpandedPoint(null) }} style={{ fontSize: 10, fontFamily: 'monospace', padding: '0 8px', borderRadius: 4, cursor: 'pointer', border: '1px solid var(--line-2)', background: 'transparent', color: 'var(--cat-output)' }}>clear</button>
                        )}
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
          </div>

          {/* Extra injection points */}
          <ExtraInjectEditor nodes={nodes} inject={inject} onChange={setInject} />
        </div>
      )}

      {error   && <div style={{ fontSize: 11, fontFamily: 'monospace', color: 'var(--cat-output)', background: 'color-mix(in srgb, var(--cat-output) 10%, var(--bg-1))', padding: '8px 10px', borderRadius: 6 }}>{error}</div>}
      {success && <div style={{ fontSize: 11, fontFamily: 'monospace', color: 'var(--cat-code)', padding: '4px 0' }}>{success}</div>}

      <div style={{ display: 'flex', gap: 8 }}>
        <button type="submit" disabled={saving || !!jsonError} style={btnStyle(!saving && !jsonError, true)}>
          {saving ? 'Saving...' : workflow ? 'Save changes' : 'Create workflow'}
        </button>
        {workflow && (
          <button type="button" onClick={() => setTesting(true)} style={{ ...btnStyle(), color: 'var(--cat-gate)', border: '1px solid var(--cat-gate)', background: 'color-mix(in srgb, var(--cat-gate) 10%, var(--bg-1))' }}>
            ▶ Test
          </button>
        )}
        {workflow && onDeleted && (
          <button type="button" onClick={handleDelete} style={{ ...btnStyle(), color: 'var(--cat-output)' }}>Delete</button>
        )}
      </div>

      {testing && workflow && <WorkflowTester workflow={{ ...workflow, inject_config: inject, refinement_capable: refinementCapable, mask_capable: maskCapable, workflow_json: (() => { try { return JSON.parse(jsonText) } catch { return workflow.workflow_json } })() }} onClose={() => setTesting(false)} />}
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
            <div style={{ width: 400, borderRight: '1px solid var(--line-2)', overflowY: 'auto', flexShrink: 0 }}>
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
                    {stepConfigHint(s, workflows)}
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
            <div style={{ width: 400, borderRight: '1px solid var(--line-2)', display: 'flex', flexDirection: 'column', flexShrink: 0 }}>
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
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                      <span style={{ fontSize: 11, fontFamily: 'monospace', color: 'var(--text-0)', flex: 1 }}>{w.name}</span>
                      {w.refinement_capable && (
                        <span style={{ fontSize: 8, fontFamily: 'monospace', padding: '1px 5px', borderRadius: 99, background: 'color-mix(in oklch, var(--cat-asset) 15%, var(--bg-1))', color: 'var(--cat-asset)', flexShrink: 0 }}>
                          {w.mask_capable ? 'refine+mask' : 'refine'}
                        </span>
                      )}
                    </div>
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
