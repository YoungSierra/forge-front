'use client'

import React, { useState, useEffect, useRef, useCallback, useMemo, createContext, useContext } from 'react'
import { createPortal } from 'react-dom'
import {
  ReactFlow, ReactFlowProvider,
  useNodesState, useEdgesState,
  useReactFlow, useViewport, useUpdateNodeInternals,
  addEdge,
  Handle, Position,
  type Node, type Edge, type Connection, type EdgeChange,
} from '@xyflow/react'
import '@xyflow/react/dist/style.css'
import ForgeEdge from './ForgeEdge'
import OrthogonalEdge, { type WayPoint } from './OrthogonalEdge'
import MoodboardButton from '../moodboard/MoodboardButton'
import ModelViewer from '@/components/shared/ModelViewer'
import { saveLayout, loadLayout, seedLayoutFromDB } from '@/lib/canvas-storage'
import { BACKEND_URL, authHeaders, chatWithForgeNode, getNodeSession, acceptNodeOutput, generateNodePdf, generateItemImage, runValidate, runPlan, saveRunConfig, autoRunNode, updateProjectName } from '@/lib/api'
import type { ApprovedAsset } from '@/lib/api'
import type { ChatMessage, OutputImageItem, OutputImagesMap, RunPlan, GateAuthMode } from '@/lib/api'
import type { Project, RunScope } from '@/lib/types'
import NodeChatWindow, { parseOutputItems, buildImageGenComponents, ImageThumbnailRow, VariationPanel } from '@/components/shared/NodeChatWindow'
import type { ImageOutputDef, InlineImageItem } from '@/components/shared/NodeChatWindow'
import AssetCardDeck, { invalidateAssetDeckCache } from './AssetCardDeck'
import ForgeToolbar, { type RunMenuItem } from './ForgeToolbar'
import ExportModal from '@/components/shared/ExportModal'
import { CopyButton } from '@/components/shared/CopyButton'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { MD_COMPONENTS } from '@/lib/md-components'
import { forDisplay } from '@/lib/json-display'
import { downloadTextFile, mdFilename } from '@/lib/download'
import { compareNodeKey } from '@/lib/node-order'

// ─── Types ────────────────────────────────────────────────────────────────────

interface ForgeSession {
  has_content?: boolean
  id: string
  node_id: string
  status: 'active' | 'approved' | 'auto_approved' | 'rejected' | 'abandoned'
  iteration_count: number
  started_at: string | null
  completed_at: string | null
  output_asset_id: string | null
  output_images: OutputImagesMap | null
  output_asset: {
    id: string
    name: string
    format: string
    storage_url: string | null
    content: string | null
  } | null
}

interface CanvasNode {
  project_node_id: string
  order_index: number
  blueprint_id: string | null
  sealed?:         boolean        // blueprint sellado (gate ACCEPT) — no re-ejecutable
  lane_id:         string | null
  bound_item_ref:  Record<string, unknown> | null
  node_type: 'forge_node' | 'library_asset' | 'text_input'
  text_label:   string | null
  text_content: string | null
  is_stale:     boolean
  node: {
    id: string
    node_key: string
    title: string
    phase: string
    purpose: string
    inputs: Array<{ key: string; label: string; accepts: string[]; required: boolean }> | { required?: string[]; optional?: string[]; description?: string } | null
    outputs: { name: string; key?: string; label?: string; type?: string; format: string; description?: string; optional?: boolean; image_gen?: boolean; image_gen_model?: string }[]
    tools: string[]
    skills: string[]
    executor: { type: string; model?: string; workflow_id?: string } | null
    status: string
    role?: string
    default_prompt?: string
    standalone_prompt?: string
  } | null
  asset: LibraryAsset | null
  session: ForgeSession | null
  output_sessions: Record<string, ForgeSession>
}

// ¿El nodo está pendiente de correr? No aprobado, o auto_approved pero stale.
// Fuente única de verdad — usada por runnableCount, runScope y el menú de run.
function isNodeRunnable(n: CanvasNode): boolean {
  if (n.node_type !== 'forge_node') return false
  if (n.sealed) return false  // fase sellada (gate ACCEPT) — bloqueada, el backend la rechaza
  const s = n.session?.status
  if (s === 'approved') return false
  if (s === 'auto_approved' && !n.is_stale) return false
  // Modelo per-output: un nodo cuya sesión general sigue 'active' pero con TODOS sus outputs
  // aprobados ya está hecho. Mismo criterio que approvedNodeIds (toolbar) — evita contarlo
  // como pendiente. Si está stale, sí se vuelve a correr.
  // `production: "deferred"` se produce en otra etapa y NUNCA bloquea al nodo (el Art Bible
  // compone arte de produccion aprobado, que en pre-produccion no existe). Contarlo como
  // pendiente dejaria el nodo eternamente por correr.
  const outs = (n.node?.outputs ?? []).filter(o => (o as unknown as { production?: string }).production !== 'deferred')
  if (outs.length > 0 && !n.is_stale) {
    const allOutputsApproved = outs.every(o => {
      const os = (n.output_sessions ?? {})[o.key ?? '']
      return os?.status === 'approved' || os?.status === 'auto_approved'
    })
    if (allOutputsApproved) return false
  }
  return true
}

interface BlueprintGate {
  name: string
  mode: string
  suggested_rubrics: string[]
  outcomes: string[]
}

interface DbEdge { id: string; source: string; target: string; sourceHandle?: string | null; targetHandle?: string | null }

interface ForgeLane {
  id:             string
  lane_key:       string
  label:          string
  color:          string
  bound_item_ref: Record<string, unknown>
}

interface CanvasData {
  success: boolean
  nodes: CanvasNode[]
  edges: DbEdge[]
  lanes: ForgeLane[]
  canvas_layout: unknown
  active_blueprint: {
    id: string
    blueprint_key: string
    name: string
    phase: string
    gate: BlueprintGate | null
    gate_decision: string | null
  } | null
}

// ¿El gate de la fase viva está listo? Todos los nodos del blueprint activo aprobados
// y sin decisión previa. Fuente única — usada por el UI (gateReady) y el loop de pipeline (#5).
function isGateReady(data: CanvasData | null): boolean {
  const bp = data?.active_blueprint
  if (!bp?.gate) return false
  if (bp.gate_decision) return false
  const bpNodes = data!.nodes.filter(n => n.blueprint_id === bp.id && n.node_type === 'forge_node')
  if (bpNodes.length === 0) return false
  const isApproved = (n: CanvasNode) => {
    const gs = n.session?.status
    if (gs === 'approved' || gs === 'auto_approved') return true
    return Object.values(n.output_sessions ?? {}).some(
      (s) => s.status === 'approved' || s.status === 'auto_approved',
    )
  }
  const hasSession = (n: CanvasNode) =>
    !!n.session || Object.keys(n.output_sessions ?? {}).length > 0
  // Solo bloquean: el nodo gate (obligatorio) y nodos ejecutados pero no aprobados.
  // Nodos sin sesión = el usuario los saltó voluntariamente.
  const notReady = bpNodes.filter(n => !isApproved(n) && (n.node?.role === 'gate' || hasSession(n)))
  return notReady.length === 0
}

interface CatalogNode {
  id: string
  node_key: string
  title: string
  phase: string
  purpose: string
  executor: { type: string } | null
  metadata?: { preview?: boolean } | null
}

interface ForgeNodeCardData extends Record<string, unknown> {
  canvasNode:      CanvasNode
  onClick:         () => void
  locked:          boolean
  projectId:       string
  isRunning?:      boolean
  isStale?:        boolean
  isError?:        boolean
  onImagesUpdate?: (imgs: OutputImagesMap, outputKey?: string) => void
  onOpenChat?:     (outputKey?: string | null, outputLabel?: string | null) => void
}

interface AssetNodeCardData extends Record<string, unknown> {
  canvasNode:       CanvasNode
  collapsed:        boolean
  projectId:        string
  onToggleCollapse: () => void
  onRemove:         () => void
}

interface TextInputCardData extends Record<string, unknown> {
  canvasNode: CanvasNode
  onSave:     (label: string, content: string) => void
  onRemove:   () => void
}

// ─── Constantes ───────────────────────────────────────────────────────────────

const NODE_W        = 240
const NODE_GAP      = 80
const ASSET_NODE_W  = 160
const ASSET_NODE_CLR = '#F59E0B'
const TEXT_NODE_W   = 200
const TEXT_NODE_CLR = ASSET_NODE_CLR

const SESSION_COLOR: Record<string, string> = {
  active:       '#A78BFA',
  approved:     '#34D399',
  auto_approved:'#86EFAC',
  rejected:     '#EF4444',
  abandoned:    '#FBBF24',
}

const EXECUTOR_LABEL: Record<string, string> = {
  llm:     'LLM',
  comfyui: 'ComfyUI',
  hybrid:  'Hybrid',
}

const PHASE_COLOR: Record<string, string> = {
  ideation:          '#60A5FA',
  concept:           '#A78BFA',
  'pre-production':  '#34D399',
  production:        '#FBBF24',
  'live-ops':        '#F87171',
}

// El giro del spinner es la única animación que queda: marca trabajo en curso sin
// hacer titilar el canvas. Los pulsos de opacidad (nodo activo y borde de ejecución)
// se sacaron — con decenas de nodos el parpadeo simultáneo era ilegible.
const SPIN_KF       = `@keyframes canvas-spin  { to { transform: rotate(360deg); } }`

// ─── Request helper ───────────────────────────────────────────────────────────

async function canvasFetch<T>(path: string, options?: RequestInit): Promise<T> {
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
    let msg = `${res.status} ${res.statusText}`
    try { const b = await res.json(); msg = b.error ?? b.message ?? msg } catch {}
    throw new Error(msg)
  }
  return res.json()
}

// ─── Tipos de librería ────────────────────────────────────────────────────────

interface LibraryAsset {
  id:              string
  display_name:    string
  description:     string | null
  file_name:       string
  mime_type:       string | null
  file_size_bytes: number | null
  asset_type:      'document' | 'image' | 'model_3d' | 'other'
  storage_url:     string
  extracted_text:  string | null
  created_at:      string
}

const ASSET_TYPE_ICON: Record<string, string> = {
  document: '📄',
  image:    '🖼',
  model_3d: '⬡',
  other:    '📎',
}

function fmtBytes(b: number | null) {
  if (!b) return ''
  if (b < 1024)        return `${b} B`
  if (b < 1024 * 1024) return `${(b / 1024).toFixed(1)} KB`
  return `${(b / 1024 / 1024).toFixed(1)} MB`
}

// Upload con FormData — no usa canvasFetch (que fuerza Content-Type: application/json)
async function libraryUpload(projectId: string, file: File, displayName: string, description: string): Promise<LibraryAsset> {
  const memberId = typeof window !== 'undefined' ? localStorage.getItem('forge_member_id') : null
  const fd = new FormData()
  fd.append('file', file)
  fd.append('display_name', displayName.trim() || file.name)
  if (description.trim()) fd.append('description', description.trim())
  if (memberId) fd.append('member_id', memberId)

  const res = await fetch(`${BACKEND_URL}/api/projects/${projectId}/library`, {
    method: 'POST',
    headers: await authHeaders(), // Bearer + x-org-id (sin Content-Type: el browser pone el boundary del FormData)
    body: fd,
  })
  if (!res.ok) {
    let msg = `${res.status}`
    try { const b = await res.json(); msg = b.error ?? msg } catch {}
    throw new Error(msg)
  }
  const json = await res.json()
  return json.asset
}

// ─── AssetPreviewOverlay ──────────────────────────────────────────────────────

// Declaración del web component para TypeScript
declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace JSX {
    interface IntrinsicElements {
      'model-viewer': React.DetailedHTMLProps<React.HTMLAttributes<HTMLElement> & {
        src?: string; alt?: string; 'auto-rotate'?: boolean | string; 'camera-controls'?: boolean | string;
        'shadow-intensity'?: string; ar?: boolean | string; style?: React.CSSProperties
      }, HTMLElement>
    }
  }
}

function AssetPreviewOverlay({ asset, onClose }: { asset: LibraryAsset; onClose: () => void }) {
  const isImage    = asset.asset_type === 'image'
  const isModel3d  = asset.asset_type === 'model_3d'
  const isMarkdown = asset.mime_type === 'text/markdown' || asset.file_name?.endsWith('.md')
  const hasText    = !!asset.extracted_text

  const panelWidth = isImage || isModel3d ? 'min(640px, 90vw)' : 480

  return (
    <>
      <div
        onClick={onClose}
        style={{ position: 'fixed', inset: 0, zIndex: 200, background: 'rgba(0,0,0,0.55)' }}
      />
      <div style={{
        position: 'fixed', top: '50%', left: '50%', transform: 'translate(-50%,-50%)',
        zIndex: 201, width: panelWidth,
        maxHeight: '80vh', background: 'var(--bg-1)', border: '1px solid var(--line-2)',
        borderRadius: 12, boxShadow: '0 24px 80px rgba(0,0,0,0.5)',
        display: 'flex', flexDirection: 'column', overflow: 'hidden',
      }}>
        {/* Header */}
        <div style={{ padding: '12px 14px 10px', borderBottom: '1px solid var(--line-2)', flexShrink: 0, display: 'flex', alignItems: 'flex-start', gap: 8 }}>
          <span style={{ fontSize: 18, flexShrink: 0 }}>{ASSET_TYPE_ICON[asset.asset_type] ?? '📎'}</span>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--text-0)', lineHeight: 1.3, wordBreak: 'break-word' }}>{asset.display_name}</div>
            {asset.description && (
              <div style={{ fontSize: 10, color: 'var(--text-2)', marginTop: 3, lineHeight: 1.5 }}>{asset.description}</div>
            )}
            <div style={{ fontSize: 9, fontFamily: 'var(--font-mono)', color: 'var(--text-3)', marginTop: 4 }}>
              {asset.asset_type}{asset.file_size_bytes ? ` · ${fmtBytes(asset.file_size_bytes)}` : ''}{asset.file_name !== asset.display_name ? ` · ${asset.file_name}` : ''}
            </div>
          </div>
          <button
            onClick={onClose}
            style={{ border: 'none', background: 'var(--bg-2)', cursor: 'pointer', color: 'var(--text-2)', fontSize: 13, padding: '4px 8px', borderRadius: 6, flexShrink: 0 }}
          >✕</button>
        </div>

        {/* Contenido */}
        <div style={{ flex: 1, overflow: isModel3d ? 'hidden' : 'auto', padding: isModel3d ? 0 : 14 }}>
          {isImage ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={asset.storage_url}
              alt={asset.display_name}
              style={{ width: '100%', borderRadius: 8, display: 'block' }}
            />
          ) : isModel3d ? (
            // El mismo visor de la librería de activos y del testeador de ComfyUI: descarga el
            // .glb a un blob antes de montarlo, cachea, y avisa mientras carga o si falla.
            <ModelViewer url={asset.storage_url} style={{ width: '100%', height: 400 }} />
          ) : isMarkdown && hasText ? (
            <div style={{ fontSize: 11, color: 'var(--text-1)', lineHeight: 1.7 }}>
              <ReactMarkdown remarkPlugins={[remarkGfm]} components={MD_COMPONENTS}>
                {asset.extracted_text!}
              </ReactMarkdown>
            </div>
          ) : hasText ? (
            <pre style={{
              margin: 0, fontSize: 10, fontFamily: 'var(--font-mono)',
              color: 'var(--text-1)', lineHeight: 1.65,
              whiteSpace: 'pre-wrap', wordBreak: 'break-word',
              background: 'var(--bg-0)', border: '1px solid var(--line-2)',
              borderRadius: 6, padding: '10px 12px',
            }}>
              {asset.extracted_text}
            </pre>
          ) : (
            <div style={{ fontSize: 11, fontFamily: 'var(--font-mono)', color: 'var(--text-3)', lineHeight: 1.6 }}>
              No preview available for this file type.
            </div>
          )}
        </div>

        {/* Footer con link */}
        <div style={{ padding: '8px 14px', borderTop: '1px solid var(--line-2)', flexShrink: 0 }}>
          <a
            href={asset.storage_url}
            target="_blank"
            rel="noreferrer"
            style={{ fontSize: 10, fontFamily: 'var(--font-mono)', color: 'var(--action)', textDecoration: 'none' }}
          >
            ↗ Open original file
          </a>
        </div>
      </div>
    </>
  )
}

// ─── ProjectLibraryPanel ──────────────────────────────────────────────────────

function ProjectLibraryPanel({ projectId }: { projectId: string }) {
  const [assets,      setAssets]      = useState<LibraryAsset[]>([])
  const [loading,     setLoading]     = useState(true)
  const [uploading,   setUploading]   = useState(false)
  const [error,       setError]       = useState('')
  const [confirmId,   setConfirmId]   = useState<string | null>(null)
  const [previewAsset, setPreviewAsset] = useState<LibraryAsset | null>(null)

  // Estado del formulario de upload (paso 2)
  const [pendingFile, setPendingFile] = useState<File | null>(null)
  const [uploadName,  setUploadName]  = useState('')
  const [uploadDesc,  setUploadDesc]  = useState('')

  const fileRef = useRef<HTMLInputElement>(null)

  const fetchAssets = useCallback(async () => {
    setLoading(true)
    try {
      const res = await canvasFetch<{ success: boolean; assets: LibraryAsset[] }>(
        `/api/projects/${projectId}/library`
      )
      setAssets(res.assets ?? [])
    } catch { setError('Failed to load library') }
    finally { setLoading(false) }
  }, [projectId])

  useEffect(() => { fetchAssets() }, [fetchAssets])

  // Paso 1 — el usuario elige el archivo; se muestra el form
  function handleFilePicked(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    e.target.value = ''
    setUploadName(file.name.replace(/\.[^.]+$/, ''))
    setUploadDesc('')
    setPendingFile(file)
  }

  function cancelUpload() {
    setPendingFile(null)
    setUploadName('')
    setUploadDesc('')
  }

  // Paso 2 — confirmar y subir
  async function handleUploadConfirm() {
    if (!pendingFile) return
    setUploading(true)
    setError('')
    try {
      const asset = await libraryUpload(projectId, pendingFile, uploadName, uploadDesc)
      setAssets(prev => [asset, ...prev])
      cancelUpload()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Upload failed')
    } finally { setUploading(false) }
  }

  async function handleDelete(id: string) {
    try {
      await canvasFetch(`/api/projects/${projectId}/library/${id}`, { method: 'DELETE' })
      setAssets(prev => prev.filter(a => a.id !== id))
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Delete failed')
    } finally { setConfirmId(null) }
  }

  const monoStyle: React.CSSProperties = { fontFamily: 'var(--font-mono)' }

  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>

      {/* Preview overlay */}
      {previewAsset && <AssetPreviewOverlay asset={previewAsset} onClose={() => setPreviewAsset(null)} />}

      {/* Upload form (paso 2) o botón trigger (paso 1) */}
      <div style={{ padding: '8px 10px', borderBottom: '1px solid var(--line-2)', flexShrink: 0 }}>
        <input
          ref={fileRef}
          type="file"
          style={{ display: 'none' }}
          accept=".pdf,.doc,.docx,.ppt,.pptx,.txt,.md,.json,.png,.jpg,.jpeg,.webp,.glb,.obj"
          onChange={handleFilePicked}
        />

        {pendingFile ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 7 }}>
            <div style={{ fontSize: 9, ...monoStyle, color: 'var(--text-3)', textTransform: 'uppercase', letterSpacing: '.08em' }}>
              Upload: {pendingFile.name}
            </div>
            <input
              value={uploadName}
              onChange={e => setUploadName(e.target.value)}
              placeholder="Name (required)"
              style={{
                width: '100%', boxSizing: 'border-box',
                background: 'var(--bg-0)', border: '1px solid var(--line-2)',
                borderRadius: 5, color: 'var(--text-1)', fontSize: 11,
                padding: '5px 8px', outline: 'none', ...monoStyle,
              }}
            />
            <textarea
              value={uploadDesc}
              onChange={e => setUploadDesc(e.target.value)}
              placeholder="Description (optional)"
              rows={2}
              style={{
                width: '100%', boxSizing: 'border-box', resize: 'none',
                background: 'var(--bg-0)', border: '1px solid var(--line-2)',
                borderRadius: 5, color: 'var(--text-1)', fontSize: 11,
                padding: '5px 8px', outline: 'none', ...monoStyle, lineHeight: 1.5,
              }}
            />
            <div style={{ display: 'flex', gap: 5 }}>
              <button
                onClick={handleUploadConfirm}
                disabled={uploading || !uploadName.trim()}
                style={{
                  flex: 1, padding: '5px 0', borderRadius: 5, border: 'none',
                  background: 'var(--action)', color: 'var(--action-fg)',
                  fontSize: 10, ...monoStyle, fontWeight: 700,
                  cursor: uploading || !uploadName.trim() ? 'not-allowed' : 'pointer',
                  opacity: uploading || !uploadName.trim() ? 0.5 : 1,
                }}
              >
                {uploading ? '⟳ Uploading…' : 'Upload'}
              </button>
              <button
                onClick={cancelUpload}
                disabled={uploading}
                style={{
                  flex: 1, padding: '5px 0', borderRadius: 5,
                  border: '1px solid var(--line-2)', background: 'transparent',
                  color: 'var(--text-3)', fontSize: 10, ...monoStyle, cursor: 'pointer',
                }}
              >
                Cancel
              </button>
            </div>
          </div>
        ) : (
          <button
            onClick={() => fileRef.current?.click()}
            style={{
              width: '100%', padding: '6px 0', borderRadius: 6, fontSize: 10,
              ...monoStyle, fontWeight: 700, cursor: 'pointer',
              border: '1px solid var(--action)',
              background: 'color-mix(in srgb, var(--action) 12%, transparent)',
              color: 'var(--action)',
            }}
          >
            + Upload asset
          </button>
        )}

        {error && (
          <div style={{ fontSize: 10, ...monoStyle, color: '#F87171', marginTop: 5 }}>{error}</div>
        )}
      </div>

      {/* Lista */}
      <div style={{ flex: 1, overflowY: 'auto', padding: '6px 8px', display: 'flex', flexDirection: 'column', gap: 4 }}>
        {loading && (
          <div style={{ fontSize: 10, ...monoStyle, color: 'var(--text-3)', padding: '8px 4px' }}>Loading…</div>
        )}
        {!loading && assets.length === 0 && !pendingFile && (
          <div style={{ fontSize: 10, ...monoStyle, color: 'var(--text-3)', padding: '8px 4px', lineHeight: 1.6 }}>
            No assets yet.<br />Upload documents, images or 3D models to use as node inputs.
          </div>
        )}
        {assets.map(a => (
          <div
            key={a.id}
            draggable
            onDragStart={e => {
              e.dataTransfer.setData('forge/asset-id', a.id)
              e.dataTransfer.effectAllowed = 'copy'
            }}
            style={{
              padding: '7px 9px', borderRadius: 7,
              background: 'var(--bg-1)', border: '1px solid var(--line-2)',
              display: 'flex', alignItems: 'flex-start', gap: 7,
              cursor: 'grab',
            }}
          >
            {/* Ícono — click abre preview */}
            <button
              onClick={() => setPreviewAsset(a)}
              title="Preview"
              style={{
                border: 'none', background: 'none', cursor: 'pointer',
                fontSize: 16, flexShrink: 0, padding: 0, lineHeight: 1,
                marginTop: 1, opacity: 0.85,
              }}
              onMouseEnter={e => { e.currentTarget.style.opacity = '1'; e.currentTarget.style.transform = 'scale(1.15)' }}
              onMouseLeave={e => { e.currentTarget.style.opacity = '0.85'; e.currentTarget.style.transform = '' }}
            >
              {ASSET_TYPE_ICON[a.asset_type] ?? '📎'}
            </button>

            <div style={{ flex: 1, minWidth: 0 }}>
              <div
                onClick={() => setPreviewAsset(a)}
                style={{
                  fontSize: 11, ...monoStyle, color: 'var(--text-1)',
                  whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
                  cursor: 'pointer',
                }}
                title={a.display_name}
              >
                {a.display_name}
              </div>
              {a.description && (
                <div style={{
                  fontSize: 9, color: 'var(--text-2)', marginTop: 2, lineHeight: 1.45,
                  overflow: 'hidden', display: '-webkit-box',
                  WebkitLineClamp: 2, WebkitBoxOrient: 'vertical',
                }}>
                  {a.description}
                </div>
              )}
              <div style={{ fontSize: 9, ...monoStyle, color: 'var(--text-3)', marginTop: 2 }}>
                {a.asset_type}{a.file_size_bytes ? ` · ${fmtBytes(a.file_size_bytes)}` : ''}
              </div>
            </div>

            {confirmId === a.id ? (
              <div style={{ display: 'flex', gap: 3, flexShrink: 0 }}>
                <button
                  onClick={() => handleDelete(a.id)}
                  style={{ border: 'none', background: '#F87171', color: '#fff', borderRadius: 4, padding: '2px 6px', fontSize: 9, ...monoStyle, cursor: 'pointer', fontWeight: 700 }}
                >✓</button>
                <button
                  onClick={() => setConfirmId(null)}
                  style={{ border: '1px solid var(--line-2)', background: 'transparent', color: 'var(--text-3)', borderRadius: 4, padding: '2px 6px', fontSize: 9, ...monoStyle, cursor: 'pointer' }}
                >✕</button>
              </div>
            ) : (
              <button
                onClick={() => setConfirmId(a.id)}
                style={{ border: 'none', background: 'none', color: 'var(--text-4)', cursor: 'pointer', fontSize: 13, padding: '0 2px', flexShrink: 0 }}
                title="Remove from library"
              >×</button>
            )}
          </div>
        ))}
      </div>
    </div>
  )
}

// ─── NodeLibrarySidebar ───────────────────────────────────────────────────────

function NodeLibrarySidebar({ projectId, canvasNodeIds, approvedNodeIds, onAdded, collapsed, onCollapsedChange, onFocusNode, isDroppingNode, dropZoneRef }: {
  projectId: string
  canvasNodeIds: Set<string>
  approvedNodeIds: Set<string>
  onAdded: () => void
  collapsed: boolean
  onCollapsedChange: (v: boolean) => void
  onFocusNode?: (forgeNodeId: string) => void
  isDroppingNode?: boolean
  dropZoneRef?: React.RefObject<HTMLDivElement | null>
}) {
  const scale = useContext(CanvasScaleContext)
  const [catalog,   setCatalog]   = useState<CatalogNode[]>([])
  const [loading,   setLoading]   = useState(true)
  const [query,     setQuery]     = useState('')
  const [adding,    setAdding]    = useState<string | null>(null)
  const [tab,       setTab]       = useState<'nodes' | 'library'>('nodes')
  const [showPreview, setShowPreview] = useState(false)   // nodos en desarrollo (archived+preview) — atajo oculto
  const [collapsedPhases, setCollapsedPhases] = useState<Set<string>>(new Set())  // fases colapsadas en el sidebar
  const setCollapsed = onCollapsedChange

  const togglePhase = (phase: string) => setCollapsedPhases(prev => {
    const next = new Set(prev)
    if (next.has(phase)) next.delete(phase); else next.add(phase)
    return next
  })

  // Ctrl+Alt+P: revela/oculta los nodos preview. Atajo no descubrible (todos los users son admin);
  // efímero — se resetea al recargar. No es seguridad, es no-descubribilidad.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.ctrlKey && e.altKey && (e.code === 'KeyP' || e.key.toLowerCase() === 'p')) {
        e.preventDefault()
        setShowPreview(v => !v)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  useEffect(() => {
    setLoading(true)
    const url = `/api/projects/${projectId}/canvas/nodes-catalog${showPreview ? '?include_preview=1' : ''}`
    canvasFetch<{ success: boolean; nodes: CatalogNode[] }>(url)
      .then(res => setCatalog(res.nodes ?? []))
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [projectId, showPreview])

  async function addNode(nodeId: string) {
    setAdding(nodeId)
    try {
      await canvasFetch(`/api/projects/${projectId}/canvas/add-node`, {
        method: 'POST',
        body: JSON.stringify({ node_id: nodeId }),
      })
      onAdded()
    } catch (e) {
      console.error('[node-library] add failed', e)
    } finally {
      setAdding(null)
    }
  }

  const q = query.toLowerCase()
  const filtered = q
    ? catalog.filter(n => n.title.toLowerCase().includes(q) || n.node_key.includes(q))
    : catalog

  const byPhase: Record<string, CatalogNode[]> = {}
  for (const n of filtered) {
    if (!byPhase[n.phase]) byPhase[n.phase] = []
    byPhase[n.phase].push(n)
  }
  // Ordenar los nodos dentro de cada fase jerárquicamente (3.2 antes de 3.10)
  for (const phase of Object.keys(byPhase)) byPhase[phase].sort((a, b) => compareNodeKey(a.node_key, b.node_key))

  // Ordenar fases por el índice numérico del node_key más bajo en cada fase (1.x < 2.x < 3.x)
  const sortedPhases = Object.entries(byPhase).sort(([, a], [, b]) => {
    const idx = (nodes: CatalogNode[]) =>
      Math.min(...nodes.map(n => parseFloat(n.node_key) || 999))
    return idx(a) - idx(b)
  })

  /* ── Collapsed: solo franja con botón para expandir ── */
  if (collapsed) {
    return (
      <div style={{
        width: 32, flexShrink: 0,
        background: 'var(--bg-1)', borderRight: '1px solid var(--line-2)',
        display: 'flex', flexDirection: 'column', alignItems: 'center',
        paddingTop: 10, gap: 6,
      }}>
        <button
          onClick={() => setCollapsed(false)}
          title="Expand node library"
          style={{
            width: 22, height: 22, borderRadius: 5, border: '1px solid var(--line-2)',
            background: 'transparent', cursor: 'pointer',
            color: 'var(--text-3)', fontSize: 10, display: 'flex',
            alignItems: 'center', justifyContent: 'center', padding: 0,
          }}
          onMouseEnter={e => { e.currentTarget.style.borderColor = 'var(--action)'; e.currentTarget.style.color = 'var(--action)' }}
          onMouseLeave={e => { e.currentTarget.style.borderColor = 'var(--line-2)'; e.currentTarget.style.color = 'var(--text-3)' }}
        >
          ›
        </button>
      </div>
    )
  }

  /* ── Expanded ── */
  return (
    <div
      ref={dropZoneRef}
      style={{
        width: 220, flexShrink: 0, position: 'relative',
        background: isDroppingNode ? 'color-mix(in srgb, #EF4444 8%, var(--bg-1))' : 'var(--bg-1)',
        borderRight: `1px solid ${isDroppingNode ? 'rgba(239,68,68,0.5)' : 'var(--line-2)'}`,
        display: 'flex', flexDirection: 'column', overflow: 'hidden',
        transition: 'background 200ms, border-color 200ms',
        zoom: scale,
      }}
    >
      {/* Overlay de drop — cubre el sidebar con instrucción */}
      {isDroppingNode && (
        <div style={{
          position: 'absolute', inset: 0, zIndex: 30, pointerEvents: 'none',
          display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
          gap: 8, background: 'rgba(239,68,68,0.07)',
          animation: 'drop-zone-in 150ms ease',
        }}>
          <span style={{ fontSize: 28, lineHeight: 1, opacity: 0.7 }}>✕</span>
          <span style={{
            fontSize: 10, fontFamily: 'var(--font-mono)', fontWeight: 700,
            color: 'rgba(239,68,68,0.9)', textTransform: 'uppercase',
            letterSpacing: '0.1em', textAlign: 'center', lineHeight: 1.5,
          }}>
            Drop to<br/>remove
          </span>
          <style>{`@keyframes drop-zone-in { from { opacity:0 } to { opacity:1 } }`}</style>
        </div>
      )}
      {/* Header: tabs + collapse */}
      <div style={{ padding: '8px 10px 0', borderBottom: '1px solid var(--line-2)', flexShrink: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
          {/* Tabs */}
          <div style={{ display: 'flex', gap: 2 }}>
            {(['nodes', 'library'] as const).map(t => (
              <button key={t} onClick={() => setTab(t)} style={{
                padding: '3px 8px', borderRadius: 5, fontSize: 9,
                fontFamily: 'var(--font-mono)', textTransform: 'uppercase', letterSpacing: '0.07em',
                cursor: 'pointer', border: 'none',
                background: tab === t ? 'var(--action)' : 'transparent',
                color: tab === t ? 'var(--action-fg)' : 'var(--text-3)',
                fontWeight: tab === t ? 700 : 400,
              }}>
                {t === 'nodes' ? 'Nodes' : 'Library'}
              </button>
            ))}
          </div>
          <button
            onClick={() => setCollapsed(true)}
            title="Collapse sidebar"
            style={{
              width: 18, height: 18, borderRadius: 4, border: '1px solid var(--line-2)',
              background: 'transparent', cursor: 'pointer',
              color: 'var(--text-3)', fontSize: 10, display: 'flex',
              alignItems: 'center', justifyContent: 'center', padding: 0,
            }}
            onMouseEnter={e => { e.currentTarget.style.borderColor = 'var(--action)'; e.currentTarget.style.color = 'var(--action)' }}
            onMouseLeave={e => { e.currentTarget.style.borderColor = 'var(--line-2)'; e.currentTarget.style.color = 'var(--text-3)' }}
          >
            ‹
          </button>
        </div>
        {/* Search — solo visible en tab Nodes */}
        {tab === 'nodes' && (
          <input
            value={query}
            onChange={e => setQuery(e.target.value)}
            placeholder="Search…"
            style={{
              width: '100%', boxSizing: 'border-box',
              background: 'var(--bg-2)', border: '1px solid var(--line-2)',
              borderRadius: 5, padding: '5px 8px', marginBottom: 6,
              fontSize: 10, fontFamily: 'var(--font-mono)',
              color: 'var(--text-0)', outline: 'none',
            }}
            onFocus={e => (e.currentTarget.style.borderColor = 'var(--action)')}
            onBlur={e =>  (e.currentTarget.style.borderColor = 'var(--line-2)')}
          />
        )}
      </div>

      {/* Tab: Library */}
      {tab === 'library' && <ProjectLibraryPanel projectId={projectId} />}

      {/* Tab: Catalog list */}
      {tab === 'nodes' &&
      <div style={{ flex: 1, overflowY: 'auto' }}>
        {/* Primitives — visibles sin búsqueda o cuando el query coincide */}
        {(!q || 'text input primitive'.includes(q.toLowerCase())) && (
          <div>
            <div style={{
              padding: '9px 12px 4px',
              fontSize: 8, fontFamily: 'var(--font-mono)', color: TEXT_NODE_CLR,
              textTransform: 'uppercase', letterSpacing: '0.1em',
              borderBottom: '1px solid var(--line-2)',
            }}>
              Primitives
            </div>
            <div
              draggable
              onDragStart={e => {
                e.dataTransfer.setData('forge/text-input', '1')
                e.dataTransfer.effectAllowed = 'copy'
              }}
              style={{
                display: 'flex', alignItems: 'center', gap: 7,
                padding: '7px 10px 7px 12px',
                borderBottom: '1px solid var(--line-2)',
                transition: 'background 80ms',
                background: 'transparent',
                cursor: 'grab',
              }}
              onMouseEnter={e => { e.currentTarget.style.background = 'var(--bg-2)' }}
              onMouseLeave={e => { e.currentTarget.style.background = 'transparent' }}
            >
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 8, fontFamily: 'var(--font-mono)', color: TEXT_NODE_CLR, marginBottom: 2, opacity: 0.7 }}>
                  text
                </div>
                <div style={{ fontSize: 10, color: 'var(--text-1)', fontWeight: 500, lineHeight: 1.3 }}>
                  Text Input
                </div>
              </div>
              <span style={{ fontSize: 11, color: TEXT_NODE_CLR, opacity: 0.65, flexShrink: 0 }}>T</span>
            </div>
          </div>
        )}
        {loading ? (
          <div style={{ padding: '20px 12px', fontSize: 10, fontFamily: 'var(--font-mono)', color: 'var(--text-3)', textAlign: 'center' }}>
            Loading…
          </div>
        ) : filtered.length === 0 ? (
          <div style={{ padding: '20px 12px', fontSize: 10, fontFamily: 'var(--font-mono)', color: 'var(--text-3)', textAlign: 'center' }}>
            No nodes found
          </div>
        ) : (
          sortedPhases.map(([phase, nodes]) => (
            <div key={phase}>
              <div
                onClick={() => togglePhase(phase)}
                style={{
                  padding: '9px 12px', display: 'flex', alignItems: 'center', gap: 5,
                  fontSize: 8, fontFamily: 'var(--font-mono)', color: PHASE_COLOR[phase] ?? 'var(--text-4)',
                  textTransform: 'uppercase', letterSpacing: '0.1em',
                  borderBottom: '1px solid var(--line-2)',
                  cursor: 'pointer', userSelect: 'none',
                }}
              >
                <span style={{ fontSize: 7, width: 6, flexShrink: 0, opacity: 0.85 }}>{collapsedPhases.has(phase) ? '▸' : '▾'}</span>
                <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{phase}</span>
                <span style={{ opacity: 0.55, flexShrink: 0 }}>{nodes.length}</span>
              </div>
              {!collapsedPhases.has(phase) && nodes.map(n => {
                const inCanvas  = canvasNodeIds.has(n.id)
                const approved  = approvedNodeIds.has(n.id)
                const isAdding  = adding === n.id
                return (
                  <div
                    key={n.id}
                    draggable={!inCanvas}
                    onDragStart={e => {
                      e.dataTransfer.setData('forge/node-id', n.id)
                      e.dataTransfer.effectAllowed = 'copy'
                    }}
                    onClick={() => { if (inCanvas) onFocusNode?.(n.id) }}
                    style={{
                      display: 'flex', alignItems: 'center', gap: 7,
                      padding: '7px 10px 7px 12px',
                      borderBottom: '1px solid var(--line-2)',
                      opacity: inCanvas ? 0.65 : 1,
                      transition: 'background 80ms',
                      background: 'transparent',
                      cursor: inCanvas ? 'pointer' : 'grab',
                    }}
                    onMouseEnter={e => { e.currentTarget.style.background = 'var(--bg-2)' }}
                    onMouseLeave={e => { e.currentTarget.style.background = 'transparent' }}
                  >
                    {/* Indicador de aprobación */}
                    <span style={{
                      fontSize: 9, flexShrink: 0, width: 10, textAlign: 'center',
                      color: approved ? '#34D399' : 'transparent',
                      lineHeight: 1,
                    }}>✓</span>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 8, fontFamily: 'var(--font-mono)', color: 'var(--text-4)', marginBottom: 2, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', display: 'flex', alignItems: 'center', gap: 4 }}>
                        {n.node_key}
                        {n.metadata?.preview && (
                          <span style={{ fontSize: 7, fontWeight: 700, color: 'var(--action)', border: '1px solid var(--action)', borderRadius: 3, padding: '0 3px', letterSpacing: '0.05em', flexShrink: 0 }}>
                            PREVIEW
                          </span>
                        )}
                      </div>
                      <div style={{ fontSize: 10, color: 'var(--text-1)', fontWeight: 500, lineHeight: 1.3, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {n.title}
                      </div>
                    </div>
                    <button
                      onClick={() => { if (!inCanvas && !isAdding) addNode(n.id) }}
                      disabled={inCanvas || isAdding}
                      title={inCanvas ? 'Already in canvas' : 'Add to canvas'}
                      style={{
                        flexShrink: 0, width: 20, height: 20, borderRadius: 4,
                        border: '1px solid var(--line-2)', background: 'transparent',
                        cursor: inCanvas || isAdding ? 'default' : 'pointer',
                        color: inCanvas ? 'var(--action)' : 'var(--text-3)',
                        fontSize: 11, lineHeight: 1,
                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                        transition: 'border-color 100ms, color 100ms',
                        padding: 0,
                      }}
                      onMouseEnter={e => {
                        if (!inCanvas && !isAdding) {
                          e.currentTarget.style.borderColor = 'var(--action)'
                          e.currentTarget.style.color = 'var(--action)'
                        }
                      }}
                      onMouseLeave={e => {
                        e.currentTarget.style.borderColor = 'var(--line-2)'
                        e.currentTarget.style.color = inCanvas ? 'var(--action)' : 'var(--text-3)'
                      }}
                    >
                      {inCanvas ? '◉' : isAdding ? '⟳' : '○'}
                    </button>
                  </div>
                )
              })}
            </div>
          ))
        )}
      </div>}
    </div>
  )
}

// ─── AssetNodeCard ────────────────────────────────────────────────────────────

const AssetNodeCard = React.memo(function AssetNodeCard({ data }: { data: AssetNodeCardData }) {
  const { canvasNode, collapsed, projectId, onToggleCollapse, onRemove } = data
  const { asset } = canvasNode
  const [previewOpen, setPreviewOpen] = useState(false)

  // Colapsar cambia la tarjeta de 240 px a 36 y remonta el Handle en otra posición. React Flow
  // guarda las medidas del handle aparte y no las revisa solo: si quedan viejas, el cable que
  // sale de este nodo deja de dibujarse aunque el edge siga en el arreglo y en la base.
  const updateNodeInternals = useUpdateNodeInternals()
  useEffect(() => {
    updateNodeInternals(canvasNode.project_node_id)
  }, [collapsed, canvasNode.project_node_id, updateNodeInternals])

  if (!asset) return null

  const icon = ASSET_TYPE_ICON[asset.asset_type] ?? '📎'

  if (collapsed) {
    return (
      <div
        onClick={onToggleCollapse}
        title={asset.display_name}
        style={{
          width: 36, height: 36,
          background: 'var(--bg-1)',
          border: `1.5px solid color-mix(in srgb, ${ASSET_NODE_CLR} 40%, var(--line-2))`,
          borderRadius: 8,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          cursor: 'pointer', fontSize: 16,
          boxShadow: '0 2px 8px rgba(0,0,0,0.22)',
        }}
      >
        <Handle type="source" position={Position.Right}
          style={{ width: 10, height: 10, borderRadius: '50%', background: ASSET_NODE_CLR, border: '2px solid var(--bg-0)', right: -5, cursor: 'crosshair' }}
        />
        {icon}
      </div>
    )
  }

  return (
    <>
      <div style={{
        width: ASSET_NODE_W,
        background: 'var(--bg-1)',
        border: `1.5px solid color-mix(in srgb, ${ASSET_NODE_CLR} 40%, var(--line-2))`,
        borderRadius: 8, overflow: 'hidden',
        boxShadow: '0 2px 10px rgba(0,0,0,0.22)',
      }}>
        <Handle type="source" position={Position.Right}
          style={{ width: 10, height: 10, borderRadius: '50%', background: ASSET_NODE_CLR, border: '2px solid var(--bg-0)', right: -5, cursor: 'crosshair' }}
        />

        {/* Header */}
        <div style={{
          background: `color-mix(in srgb, ${ASSET_NODE_CLR} 12%, var(--bg-2))`,
          borderBottom: `1px solid color-mix(in srgb, ${ASSET_NODE_CLR} 22%, var(--line-2))`,
          padding: '4px 8px',
          display: 'flex', alignItems: 'center', gap: 5,
        }}>
          <span style={{ fontSize: 13, flexShrink: 0 }}>{icon}</span>
          <span style={{
            flex: 1, fontSize: 8, fontFamily: 'var(--font-mono)', fontWeight: 700,
            color: `color-mix(in srgb, ${ASSET_NODE_CLR} 80%, var(--text-0))`,
            textTransform: 'uppercase', letterSpacing: '0.06em',
          }}>
            {asset.asset_type}
          </span>
          <button onClick={e => { e.stopPropagation(); setPreviewOpen(true) }} title="Preview"
            style={{ border: 'none', background: 'none', cursor: 'pointer', color: 'var(--text-4)', fontSize: 11, padding: '0 2px', lineHeight: 1 }}>👁</button>
          <button onClick={e => { e.stopPropagation(); onToggleCollapse() }} title="Collapse"
            style={{ border: 'none', background: 'none', cursor: 'pointer', color: 'var(--text-4)', fontSize: 11, padding: '0 2px', lineHeight: 1 }}>−</button>
          <button onClick={e => { e.stopPropagation(); onRemove() }} title="Remove from canvas"
            style={{ border: 'none', background: 'none', cursor: 'pointer', color: 'var(--text-4)', fontSize: 14, padding: '0 2px', lineHeight: 1 }}>×</button>
        </div>

        {/* Body */}
        <div style={{ padding: '6px 9px' }}>
          <div
            onClick={e => { e.stopPropagation(); setPreviewOpen(true) }}
            style={{
              fontSize: 10, fontFamily: 'var(--font-mono)', color: 'var(--text-1)',
              overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
              cursor: 'pointer',
            }}
            title={asset.display_name}
          >
            {asset.display_name}
          </div>
          {asset.file_size_bytes && (
            <div style={{ fontSize: 8, fontFamily: 'var(--font-mono)', color: 'var(--text-4)', marginTop: 2 }}>
              {fmtBytes(asset.file_size_bytes)}
            </div>
          )}
        </div>
      </div>

      {/* Preview overlay — portal para escapar el contexto de ReactFlow */}
      {previewOpen && typeof document !== 'undefined' && createPortal(
        <AssetPreviewOverlay asset={asset} onClose={() => setPreviewOpen(false)} />,
        document.body,
      )}
    </>
  )
})

// ─── TextInputCard ────────────────────────────────────────────────────────────

const TextInputCard = React.memo(function TextInputCard({ data }: { data: TextInputCardData }) {
  const { canvasNode, onSave, onRemove } = data
  const [label,   setLabel]   = useState(canvasNode.text_label   ?? 'Text Input')
  const [content, setContent] = useState(canvasNode.text_content ?? '')
  const saveTimer   = useRef<ReturnType<typeof setTimeout> | null>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const [confirmRemove, setConfirmRemove] = useState(false)
  const [collapsed, setCollapsed] = useState(false)
  const [expanded,  setExpanded]  = useState(false)

  useEffect(() => {
    setLabel(canvasNode.text_label   ?? 'Text Input')
    setContent(canvasNode.text_content ?? '')
  }, [canvasNode.text_label, canvasNode.text_content])

  // La vista colapsada y la expandida son dos árboles distintos, y el Handle cambia de sitio
  // (top 10 vs top 40) y de tamaño de tarjeta (36 vs 240). React Flow cachea las medidas del
  // handle: si no se le avisa, quedan viejas y el cable de este nodo deja de dibujarse — sigue
  // en el arreglo de edges y en la base, pero no se ve. Es el «se ocultó el cable» del text input.
  const updateNodeInternals = useUpdateNodeInternals()
  useEffect(() => {
    updateNodeInternals(canvasNode.project_node_id)
  }, [collapsed, expanded, canvasNode.project_node_id, updateNodeInternals])

  // Cuando está expandido, ajusta la altura al contenido real
  useEffect(() => {
    const ta = textareaRef.current
    if (!ta) return
    if (expanded) {
      ta.style.height = 'auto'
      ta.style.height = `${ta.scrollHeight}px`
    } else {
      ta.style.height = '52px'
    }
  }, [expanded, content])

  // ReactFlow usa listeners nativos para el zoom — hay que parar el wheel a nivel nativo
  useEffect(() => {
    const ta = textareaRef.current
    if (!ta) return
    const stop = (e: WheelEvent) => e.stopPropagation()
    ta.addEventListener('wheel', stop, { passive: true })
    return () => ta.removeEventListener('wheel', stop)
  }, [])

  function schedSave(newLabel: string, newContent: string) {
    if (saveTimer.current) clearTimeout(saveTimer.current)
    saveTimer.current = setTimeout(() => onSave(newLabel, newContent), 600)
  }

  // ── Vista colapsada ──────────────────────────────────────────────────────────
  if (collapsed) {
    return (
      <div
        className="text-node-drag"
        onClick={() => setCollapsed(false)}
        title={label}
        style={{
          width: 36, height: 36,
          background: 'var(--bg-1)',
          border: `1.5px solid color-mix(in srgb, ${TEXT_NODE_CLR} 40%, var(--line-2))`,
          borderRadius: 8,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          cursor: 'pointer',
          boxShadow: '0 2px 8px rgba(0,0,0,0.22)',
        }}
      >
        <Handle type="source" position={Position.Right}
          style={{ width: 10, height: 10, borderRadius: '50%', background: TEXT_NODE_CLR, border: '2px solid var(--bg-0)', right: -5, top: 10, cursor: 'crosshair' }}
        />
        <span style={{ fontSize: 11, fontFamily: 'var(--font-mono)', fontWeight: 700, color: `color-mix(in srgb, ${TEXT_NODE_CLR} 70%, var(--text-1))` }}>T</span>
      </div>
    )
  }

  // ── Vista expandida ──────────────────────────────────────────────────────────
  return (
    <div style={{
      width: TEXT_NODE_W,
      background: 'var(--bg-1)',
      border: `1.5px solid color-mix(in srgb, ${TEXT_NODE_CLR} 40%, var(--line-2))`,
      borderRadius: 8,
      boxShadow: '0 2px 10px rgba(0,0,0,0.22)',
    }}>
      <Handle type="source" position={Position.Right}
        style={{ width: 10, height: 10, borderRadius: '50%', background: TEXT_NODE_CLR, border: '2px solid var(--bg-0)', right: -5, top: 40, cursor: 'crosshair' }}
      />

      {/* Franja de arrastre */}
      <div className="text-node-drag" style={{
        height: 8,
        background: `color-mix(in srgb, ${TEXT_NODE_CLR} 18%, var(--bg-2))`,
        borderRadius: '7px 7px 0 0',
        cursor: 'grab',
        display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 3,
      }}>
        {[0, 1, 2, 3].map(i => (
          <div key={i} style={{ width: 2, height: 2, borderRadius: '50%', background: `color-mix(in srgb, ${TEXT_NODE_CLR} 60%, var(--text-3))`, opacity: 0.7 }} />
        ))}
      </div>

      {/* Header — label editable + colapsar */}
      <div style={{
        background: `color-mix(in srgb, ${TEXT_NODE_CLR} 12%, var(--bg-2))`,
        borderBottom: `1px solid color-mix(in srgb, ${TEXT_NODE_CLR} 22%, var(--line-2))`,
        padding: '4px 8px',
        display: 'flex', alignItems: 'center', gap: 4,
      }}>
        <span style={{ fontSize: 10, flexShrink: 0, opacity: 0.8 }}>T</span>
        <input
          value={label}
          onChange={e => { setLabel(e.target.value); schedSave(e.target.value, content) }}
          className="nodrag nopan"
          style={{
            flex: 1, minWidth: 0, background: 'none', border: 'none', outline: 'none',
            fontSize: 9, fontFamily: 'var(--font-mono)', fontWeight: 700,
            color: `color-mix(in srgb, ${TEXT_NODE_CLR} 80%, var(--text-0))`,
          }}
        />
        <button
          onClick={e => { e.stopPropagation(); setCollapsed(true) }}
          className="nodrag nopan"
          title="Collapse"
          style={{ border: 'none', background: 'none', cursor: 'pointer', color: 'var(--text-4)', fontSize: 11, padding: '0 2px', lineHeight: 1, flexShrink: 0 }}
        >−</button>
        {confirmRemove ? (
          <>
            <button onClick={e => { e.stopPropagation(); onRemove() }} className="nodrag nopan"
              style={{ border: 'none', background: '#EF4444', color: '#fff', borderRadius: 3, padding: '1px 5px', fontSize: 8, fontFamily: 'var(--font-mono)', cursor: 'pointer', flexShrink: 0 }}>✓</button>
            <button onClick={e => { e.stopPropagation(); setConfirmRemove(false) }} className="nodrag nopan"
              style={{ border: '1px solid var(--line-2)', background: 'transparent', color: 'var(--text-3)', borderRadius: 3, padding: '1px 5px', fontSize: 8, fontFamily: 'var(--font-mono)', cursor: 'pointer', flexShrink: 0 }}>✕</button>
          </>
        ) : (
          <button onClick={e => { e.stopPropagation(); setConfirmRemove(true) }} className="nodrag nopan"
            style={{ border: 'none', background: 'none', cursor: 'pointer', color: 'var(--text-4)', fontSize: 13, padding: '0 2px', lineHeight: 1, flexShrink: 0 }}>×</button>
        )}
      </div>

      {/* Textarea — altura controlada por el usuario */}
      <div style={{ padding: '6px 9px 0' }}>
        <textarea
          ref={textareaRef}
          value={content}
          onChange={e => { setContent(e.target.value); schedSave(label, e.target.value) }}
          placeholder="Type text here…"
          className="nodrag nopan"
          style={{
            width: '100%', boxSizing: 'border-box', resize: 'none',
            background: 'none', border: 'none', outline: 'none',
            fontSize: 10, fontFamily: 'var(--font-mono)', color: 'var(--text-1)',
            lineHeight: 1.55, padding: 0, display: 'block',
            height: 52, overflow: expanded ? 'hidden' : 'auto',
            transition: 'height 180ms ease',
          }}
        />
      </div>

      {/* Footer — toggle expand texto */}
      <button
        onClick={e => { e.stopPropagation(); setExpanded(v => !v) }}
        className="nodrag nopan"
        title={expanded ? 'Collapse text' : 'Expand text'}
        style={{
          width: '100%', padding: '3px 0', border: 'none', background: 'none',
          borderTop: `1px solid color-mix(in srgb, ${TEXT_NODE_CLR} 15%, var(--line-2))`,
          cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center',
          color: `color-mix(in srgb, ${TEXT_NODE_CLR} 50%, var(--text-4))`,
          fontSize: 9, lineHeight: 1, borderRadius: '0 0 7px 7px',
          transition: 'background 120ms',
        }}
        onMouseEnter={e => { e.currentTarget.style.background = `color-mix(in srgb, ${TEXT_NODE_CLR} 8%, transparent)` }}
        onMouseLeave={e => { e.currentTarget.style.background = 'none' }}
      >
        {expanded ? '▲' : '▼'}
      </button>
    </div>
  )
})

// ─── Utilidad: extrae una sección del markdown por nombre de output ───────────

function extractSection(content: string, sectionName: string, otherKeys: string[] = []): string | null {
  const escaped = sectionName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
                             .replace(/_/g, '[_\\s]')  // "concept_list" también matchea "concept list"
  // Acepta "## Concept Seeds — subtítulo" además de "## Concept Seeds" exacto
  const startRx = new RegExp(`^(?:#{1,4}\\s+)?${escaped}(?:\\s*[—\\-–:].+)?\\s*$`, 'im')
  const match   = startRx.exec(content)
  if (!match) return null
  const after = content.slice(match.index + match[0].length)
  // nextRx dinámico: solo cortar en otras claves conocidas, nunca en headings arbitrarios
  const otherEscaped = otherKeys.map(k => k.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/_/g, '[_\\s]'))
  const nextRx = otherEscaped.length > 0
    ? new RegExp(`^(?:#{1,4}\\s+)?(?:${otherEscaped.join('|')})\\s*$`, 'im')
    : null
  const next = nextRx ? nextRx.exec(after) : null
  return (next ? after.slice(0, next.index) : after).trim() || null
}

// ─── ForgeNodeCard ────────────────────────────────────────────────────────────

const ForgeNodeCard = React.memo(function ForgeNodeCard({ data }: { data: ForgeNodeCardData }) {
  const { canvasNode, onClick, locked, projectId, onImagesUpdate, isRunning, isStale, isError, onOpenChat } = data
  const { node, session } = canvasNode
  const outputSessions = canvasNode.output_sessions ?? {}
  const scale      = useContext(CanvasScaleContext)
  const isDragging = useContext(DraggingContext)
  const { nodeId: pendingOutputId, outputKey: pendingOutputKey, clear: clearPendingOutput } = useContext(PendingOutputModalContext)
  // Abrir output modal cuando el canvas lo solicita (Run Node o panel de contexto)
  useEffect(() => {
    if (pendingOutputId === canvasNode.project_node_id) {
      setOutputOpen(true)
      if (pendingOutputKey) setOutTab(pendingOutputKey)
      clearPendingOutput()
    }
  }, [pendingOutputId, pendingOutputKey, canvasNode.project_node_id, clearPendingOutput])
  if (!node) return null
  const isGate = node.role === 'gate'
  // TODOS los outputs aprobados ⇒ el nodo está aprobado, y eso gana sobre la sesión general.
  // Antes mandaba `session?.status` y el respaldo solo entraba si NO había sesión general: una
  // sesión suelta sin output_key —la que se crea al abrir el chat sin enfocar un output— quedaba
  // en `active` y dejaba el nodo rotulado "active" para siempre aunque sus dos outputs
  // estuvieran aprobados. Un run en curso no se pierde: lo muestra `isRunning`, aparte.
  const allOuts = (node.outputs ?? []).filter((o) => (o as unknown as { production?: string }).production !== 'deferred')
  const allOutsApproved = allOuts.length > 0 && allOuts.every((o: { key?: string }) => {
    const s = outputSessions[(o.key ?? '')]
    return s?.status === 'approved' || s?.status === 'auto_approved'
  })
  const effectiveStatus: string | null = allOutsApproved
    ? (allOuts.some((o: { key?: string }) => outputSessions[(o.key ?? '')]?.status === 'auto_approved') ? 'auto_approved' : 'approved')
    : (session?.status ?? null)
  const status      = effectiveStatus
  const statusColor = locked ? null : isError ? '#EF4444' : isRunning ? '#60A5FA' : (status ? (SESSION_COLOR[status] ?? null) : null)
  const phaseColor  = locked ? '#6B7280' : (PHASE_COLOR[node.phase] ?? '#6B7280')
  // Stale solo es relevante si el nodo ya produjo output (status no nulo); idle = pendiente, no stale
  const showStale   = isStale && !!status

  // Borde y glow reactivos al estado de sesión
  const borderColor = showStale ? '#F59E0B'
                    : isError  ? '#EF4444'
                    : isRunning? 'transparent'
                    : locked   ? 'var(--line-2)'
                    : (statusColor ?? 'var(--line-2)')
  const glowShadow  = isRunning
    ? 'none'
    : !locked && status === 'active'
    ? `0 0 0 1px ${statusColor}, 0 0 18px ${statusColor}55, 0 4px 24px rgba(0,0,0,0.28)`
    : `0 4px 20px rgba(0,0,0,0.24)`

  // Hover deck para nodos aprobados
  const cardRef    = useRef<HTMLDivElement>(null)
  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const [deckAnchor, setDeckAnchor] = useState<{ x: number; y: number } | null>(null)
  // Cerrar deck inmediatamente al iniciar un drag
  useEffect(() => { if (isDragging) setDeckAnchor(null) }, [isDragging])
  // Mostrar deck cuando hay contenido disponible (aprobado, auto-aprobado, o active con output)
  const isApproved   = !!session?.has_content || Object.values(outputSessions).some(s => s.has_content)
  const [outputOpen, setOutputOpen] = useState(false)
  // PDFs generados en esta sesión, POR OUTPUT. Antes era una sola URL para toda la tarjeta: al
  // generar el del pitch_document, la pestaña del elevator_line mostraba ese mismo archivo.
  // La clave '' es el documento del nodo (la tarjeta, que no tiene pestañas).
  const [generatedPdfUrls, setGeneratedPdfUrls] = useState<Record<string, string>>({})
  const [pdfLoading, setPdfLoading] = useState(false)
  // Por qué no salió el PDF. El botón atrapaba el error y lo mandaba a la consola, así que desde
  // afuera «no hacía nada» — y el motivo más común es que el output todavía no se aceptó.
  const [pdfError, setPdfError] = useState<string | null>(null)
  // Qué output se está renderizando, para no disparar dos a la vez.
  const [runningOutput, setRunningOutput] = useState<string | null>(null)
  const [renderJob, setRenderJob] = useState<{ clave: string; esperadas: number; error?: string } | null>(null)
  // Despachos de este nodo que siguen corriendo en el servidor. `runningOutput` solo dura lo que
  // dura la petición (~1 s desde que despacha en segundo plano), así que por sí solo no protege
  // nada: el render sigue 4 minutos más con el botón habilitado.
  const [vivos, setVivos] = useState<Record<string, Despacho>>({})
  // Despacho pendiente de confirmar. Un render cuesta crédito y no se puede deshacer, así que no
  // sale de un solo clic.
  const [confirmar, setConfirmar] = useState<{ clave: string; etiqueta: string; cuantas: number } | null>(null)
  const marcarVivo = useCallback((clave: string, esperadas: number) => {
    const t = leerDespachos()
    t[`${canvasNode.project_node_id}:${clave}`] = { esperadas, desde: Date.now() }
    guardarDespachos(t)
    setVivos(v => ({ ...v, [clave]: { esperadas, desde: Date.now() } }))
  }, [canvasNode.project_node_id])
  const marcarMuerto = useCallback((clave: string) => {
    const t = leerDespachos()
    delete t[`${canvasNode.project_node_id}:${clave}`]
    guardarDespachos(t)
    setVivos(v => { const n = { ...v }; delete n[clave]; return n })
  }, [canvasNode.project_node_id])
  const despacharOutput = useCallback(async (clave: string, cuantas: number) => {
    setRunningOutput(clave)
    try {
      // La ruta despacha y responde enseguida; el avance se consulta aparte. Antes esperaba los
      // ~4 minutos del render y el navegador soltaba la petición con «Failed to fetch» — sin
      // señal, se apretaba de nuevo y salían despachos en paralelo.
      const r = await autoRunNode(projectId, canvasNode.project_node_id, undefined, clave)
      const esperadas = (r as { expected?: number }).expected ?? cuantas
      marcarVivo(clave, esperadas)
      setRenderJob({ clave, esperadas })
    } catch (e) {
      console.error('[run-output]', clave, e)
      marcarMuerto(clave)
      setRenderJob({ clave, esperadas: cuantas, error: String((e as Error)?.message || e) })
    } finally { setRunningOutput(null) }
  }, [projectId, canvasNode.project_node_id, marcarVivo, marcarMuerto])

  // Al montar (y al reabrir el modal) se recuperan los despachos anotados y se contrastan con la
  // sesión: si ya no está `active`, terminó mientras el modal estaba cerrado.
  useEffect(() => {
    if (!outputOpen) return
    const pref = `${canvasNode.project_node_id}:`
    const anotados = Object.entries(leerDespachos())
      .filter(([k]) => k.startsWith(pref))
      .map(([k, v]) => [k.slice(pref.length), v] as const)
    if (!anotados.length) { setVivos({}); return }
    let cancelado = false
    ;(async () => {
      const confirmados: Record<string, Despacho> = {}
      for (const [clave, d] of anotados) {
        try {
          const r = await getNodeSession(projectId, node.id, clave, canvasNode.project_node_id)
          if ((r.session?.status ?? 'active') === 'active') confirmados[clave] = d
          else marcarMuerto(clave)
        } catch { confirmados[clave] = d }   // sin respuesta, se asume vivo: bloquear es lo barato
      }
      if (!cancelado) setVivos(confirmados)
    })()
    return () => { cancelado = true }
  }, [outputOpen, projectId, node.id, canvasNode.project_node_id, marcarMuerto])
  const [localOutputImages, setLocalOutputImages] = useState<OutputImagesMap>(() => {
    // Merge images de sesión general + todas las sesiones de output
    const merged: OutputImagesMap = { ...((canvasNode.session?.output_images as OutputImagesMap) ?? {}) }
    for (const s of Object.values(canvasNode.output_sessions ?? {})) {
      Object.assign(merged, (s.output_images as OutputImagesMap) ?? {})
    }
    return merged
  })
  // Sincronizar cuando session o output_sessions cambian — merge general + todas las por-output
  useEffect(() => {
    const merged: OutputImagesMap = { ...((session?.output_images as OutputImagesMap) ?? {}) }
    for (const s of Object.values(canvasNode.output_sessions ?? {})) {
      Object.assign(merged, (s.output_images as OutputImagesMap) ?? {})
    }
    setLocalOutputImages(merged)
  }, [session?.output_images, canvasNode.output_sessions])
  const [generatingImgKey,  setGeneratingImgKey]  = useState<string | null>(null)
  const [zoomUrl,           setZoomUrl]           = useState<string | null>(null)
  const [ioModal,           setIoModal]           = useState<'in' | 'out' | null>(null)
  const [zoomGallery,       setZoomGallery]       = useState<{ urls: string[]; idx: number } | null>(null)
  // Estado de zoom interno del overlay de imagen
  const [imgScale,          setImgScale]          = useState(1)
  const [imgOffset,         setImgOffset]         = useState({ x: 0, y: 0 })
  const imgScaleRef   = useRef(1)
  const imgOffsetRef  = useRef({ x: 0, y: 0 })
  const imgDragRef    = useRef({ active: false, startX: 0, startY: 0, startOX: 0, startOY: 0 })
  const imgOverlayRef = useRef<HTMLDivElement>(null)
  // Modal de texto completo para cards de galería
  const [textModal,    setTextModal]    = useState<{ text: string; label: string } | null>(null)
  const [textFontSize, setTextFontSize] = useState(14)
  const [outTab,            setOutTab]            = useState<string>('')
  const [viewMode,          setViewMode]          = useState<'gallery' | 'list'>('gallery')
  // Guardamos solo el key; el item vivo se lee del ref en cada render para evitar datos stale
  const [variationItemKey,  setVariationItemKey]  = useState<string | null>(null)
  const imageItemsRef = useRef<import('@/components/shared/NodeChatWindow').InlineImageItem[]>([])

  // Navegación de teclado para el zoom gallery
  useEffect(() => {
    if (!zoomGallery) return
    const resetZoom = () => {
      imgScaleRef.current = 1; imgOffsetRef.current = { x: 0, y: 0 }
      setImgScale(1); setImgOffset({ x: 0, y: 0 })
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'ArrowLeft')  { resetZoom(); setZoomGallery(g => g && g.idx > 0                 ? { ...g, idx: g.idx - 1 } : g) }
      if (e.key === 'ArrowRight') { resetZoom(); setZoomGallery(g => g && g.idx < g.urls.length - 1 ? { ...g, idx: g.idx + 1 } : g) }
      if (e.key === 'Escape')     setZoomGallery(null)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [zoomGallery])

  // Resetear zoom cuando cambia la imagen (navegación o apertura nueva)
  useEffect(() => {
    imgScaleRef.current = 1; imgOffsetRef.current = { x: 0, y: 0 }
    setImgScale(1); setImgOffset({ x: 0, y: 0 })
  }, [zoomUrl, zoomGallery?.idx])

  // Rueda (no-pasiva) + drag de paneo cuando el overlay está abierto
  useEffect(() => {
    const el = imgOverlayRef.current
    if (!el || (!zoomUrl && !zoomGallery)) return

    const onWheel = (e: WheelEvent) => {
      e.preventDefault()
      const oldScale = imgScaleRef.current
      const factor   = e.deltaY < 0 ? 1.12 : 1 / 1.12
      const newScale = Math.min(8, Math.max(1, oldScale * factor))
      if (newScale === oldScale) return
      imgScaleRef.current = newScale
      setImgScale(newScale)
      // Al volver a escala 1 centrar siempre la imagen
      if (newScale === 1) {
        imgOffsetRef.current = { x: 0, y: 0 }
        setImgOffset({ x: 0, y: 0 })
        return
      }
      // zoom centrado en la posición del cursor
      const mx = e.clientX - window.innerWidth  / 2
      const my = e.clientY - window.innerHeight / 2
      const f  = newScale / oldScale
      const newOffset = {
        x: mx * (1 - f) + imgOffsetRef.current.x * f,
        y: my * (1 - f) + imgOffsetRef.current.y * f,
      }
      imgOffsetRef.current = newOffset
      setImgOffset({ ...newOffset })
    }

    const onMove = (e: MouseEvent) => {
      if (!imgDragRef.current.active) return
      const newOffset = {
        x: imgDragRef.current.startOX + (e.clientX - imgDragRef.current.startX),
        y: imgDragRef.current.startOY + (e.clientY - imgDragRef.current.startY),
      }
      imgOffsetRef.current = newOffset
      setImgOffset({ ...newOffset })
    }

    const onUp = () => { imgDragRef.current.active = false }

    el.addEventListener('wheel', onWheel, { passive: false })
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup',   onUp)
    return () => {
      el.removeEventListener('wheel', onWheel)
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup',   onUp)
    }
  }, [zoomUrl, zoomGallery])
  // outSession: sesión del tab activo en el modal de output
  const outSession         = outputSessions[outTab] ?? session ?? null
  // Resolución del PDF URL: del asset (ya guardado) o generado on-demand en esta sesión
  const effectivePdfUrl    = session?.output_asset?.storage_url || generatedPdfUrls['']
  // Solo el PDF de ESTA pestaña: sin la llave, un output sin documento heredaba el del vecino.
  const effectiveOutPdfUrl = outSession?.output_asset?.storage_url || generatedPdfUrls[outTab]

  // ── Drag / Resize / Maximize del modal de output ─────────────────────────
  const OUT_W = 720, OUT_H = 640, OUT_MARGIN = 12
  const [outPos,       setOutPos]       = useState({ x: 0, y: 0 })
  const [outSize,      setOutSize]      = useState({ w: OUT_W, h: OUT_H })
  const [outMaximized, setOutMaximized] = useState(false)
  const [outDragging,  setOutDragging]  = useState(false)
  const [outResizing,  setOutResizing]  = useState(false)
  const outDragOrigin   = useRef<{ sx: number; sy: number; ox: number; oy: number } | null>(null)
  const outResizeOrigin = useRef<{ sx: number; sy: number; ow: number; oh: number } | null>(null)
  const outSizeRef      = useRef({ w: OUT_W, h: OUT_H })
  const outSavedGeom    = useRef<{ pos: { x: number; y: number }; size: { w: number; h: number } } | null>(null)

  // Posición, tamaño y tab inicial al abrir el modal
  useEffect(() => {
    if (!outputOpen) return
    const w = Math.min(OUT_W, window.innerWidth  - OUT_MARGIN * 2)
    const h = Math.min(OUT_H, window.innerHeight - OUT_MARGIN * 2)
    const x = Math.max((window.innerWidth  - w) / 2, OUT_MARGIN)
    const y = Math.max((window.innerHeight - h) / 2, OUT_MARGIN)
    outSizeRef.current = { w, h }
    setOutSize({ w, h })
    setOutPos({ x, y })
    const firstOut = node.outputs?.[0]
    setOutTab((firstOut as {key?:string} | undefined)?.key || firstOut?.name || '')
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [outputOpen])

  const onOutDragMove = useCallback((e: MouseEvent) => {
    if (!outDragOrigin.current) return
    const nx = outDragOrigin.current.ox + e.clientX - outDragOrigin.current.sx
    const ny = outDragOrigin.current.oy + e.clientY - outDragOrigin.current.sy
    setOutPos({
      x: Math.max(OUT_MARGIN, Math.min(nx, window.innerWidth  - outSizeRef.current.w - OUT_MARGIN)),
      y: Math.max(OUT_MARGIN, Math.min(ny, window.innerHeight - outSizeRef.current.h - OUT_MARGIN)),
    })
  }, [])

  const onOutDragEnd = useCallback(() => {
    outDragOrigin.current = null
    setOutDragging(false)
    window.removeEventListener('mousemove', onOutDragMove)
    window.removeEventListener('mouseup',   onOutDragEnd)
  }, [onOutDragMove])

  const onOutDragStart = (e: React.MouseEvent) => {
    if (outMaximized) return
    e.preventDefault()
    outDragOrigin.current = { sx: e.clientX, sy: e.clientY, ox: outPos.x, oy: outPos.y }
    setOutDragging(true)
    window.addEventListener('mousemove', onOutDragMove)
    window.addEventListener('mouseup',   onOutDragEnd)
  }

  const onOutResizeMove = useCallback((e: MouseEvent) => {
    if (!outResizeOrigin.current) return
    const nw = Math.max(480, Math.min(outResizeOrigin.current.ow + e.clientX - outResizeOrigin.current.sx, window.innerWidth  - OUT_MARGIN))
    const nh = Math.max(320, Math.min(outResizeOrigin.current.oh + e.clientY - outResizeOrigin.current.sy, window.innerHeight - OUT_MARGIN))
    outSizeRef.current = { w: nw, h: nh }
    setOutSize({ w: nw, h: nh })
  }, [])

  const onOutResizeEnd = useCallback(() => {
    outResizeOrigin.current = null
    setOutResizing(false)
    window.removeEventListener('mousemove', onOutResizeMove)
    window.removeEventListener('mouseup',   onOutResizeEnd)
  }, [onOutResizeMove])

  const onOutResizeStart = (e: React.MouseEvent) => {
    e.preventDefault()
    e.stopPropagation()
    outResizeOrigin.current = { sx: e.clientX, sy: e.clientY, ow: outSizeRef.current.w, oh: outSizeRef.current.h }
    setOutResizing(true)
    window.addEventListener('mousemove', onOutResizeMove)
    window.addEventListener('mouseup',   onOutResizeEnd)
  }

  const toggleOutMaximize = () => {
    if (outMaximized) {
      const g = outSavedGeom.current
      if (g) { outSizeRef.current = g.size; setOutSize(g.size); setOutPos(g.pos) }
      setOutMaximized(false)
    } else {
      outSavedGeom.current = { pos: outPos, size: outSize }
      setOutMaximized(true)
    }
  }
  // ─────────────────────────────────────────────────────────────────────────

  // `outputKey` = la pestaña en la que está parado el usuario. Vacío desde la tarjeta, que no
  // tiene pestañas. El backend genera el PDF si ese output todavía no lo tenía y lo deja guardado.
  const handleGeneratePdf = useCallback(async (e?: React.MouseEvent, outputKey = '') => {
    e?.stopPropagation()
    if (pdfLoading) return
    setPdfLoading(true); setPdfError(null)
    try {
      const r = await generateNodePdf(projectId, node.id, outputKey || null, canvasNode.project_node_id)
      setGeneratedPdfUrls(prev => ({ ...prev, [outputKey]: r.url }))
      window.open(r.url, '_blank')
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'PDF generation failed'
      console.error('[ForgeNodeCard] PDF generation failed:', err)
      // El caso de todos los días dicho en criollo: el PDF se arma del output aceptado.
      setPdfError(/documento aprobado|approved/i.test(msg)
        ? 'Accept the output first — the PDF is built from the accepted document.'
        : msg)
    } finally {
      setPdfLoading(false)
    }
  }, [pdfLoading, projectId, node.id, canvasNode.project_node_id])

  const keepDeckOpen = useCallback(() => {
    if (closeTimer.current) clearTimeout(closeTimer.current)
  }, [])

  const scheduleDeckClose = useCallback(() => {
    closeTimer.current = setTimeout(() => setDeckAnchor(null), 160)
  }, [])

  return (
    <div style={{ position: 'relative', zoom: scale }} ref={cardRef}>
      {isRunning && <style>{SPIN_KF}</style>}

      {/* Borde naranja fijo — el parpadeo lo marca el spinner, no el borde */}
      {isRunning && (
        <div style={{
          position: 'absolute', inset: 0, borderRadius: 8, pointerEvents: 'none', zIndex: 5,
          border: '2px solid rgba(255,138,61,1)',
          boxShadow: '0 0 8px rgba(255,138,61,0.5)',
        }} />
      )}

      {/* Spinner ↻ — esquina superior derecha */}
      {isRunning && (
        <div style={{
          position: 'absolute', top: -11, right: -11, zIndex: 10,
          width: 22, height: 22, borderRadius: '50%',
          background: 'rgba(255,138,61,1)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          fontSize: 13, color: '#fff', fontWeight: 700,
          border: '2px solid var(--bg-1)',
          animation: 'canvas-spin 1s linear infinite',
          lineHeight: 1,
        }}>↻</div>
      )}

      {/* Badge de stale / error — el ⚠ de stale solo aplica si el nodo YA produjo output
          (showStale); un nodo idle nunca corrió, así que no puede estar "desactualizado" */}
      {!isRunning && (showStale || isError) && (
        <div
          // El badge no decía de qué se trata: un triángulo naranja sin explicación deja a
          // cualquiera adivinando si perdió trabajo. «Stale» solo significa que algo aguas arriba
          // se aceptó DESPUÉS de que este nodo produjo lo suyo — no que esté roto.
          title={isError
            ? 'This node failed on its last run. Open it to see the error.'
            : 'Out of date: something upstream was accepted after this node produced its output. What it holds is still valid — run it again to rebuild it from the current inputs.'}
          style={{
            position: 'absolute', top: -8, right: -8, zIndex: 10,
            width: 18, height: 18, borderRadius: '50%',
            background: isError ? '#EF4444' : '#F59E0B',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            fontSize: 9, border: '2px solid var(--bg-1)', cursor: 'help',
          }}
        >
          {isError ? '✕' : '⚠'}
        </div>
      )}

      <div
        style={{
          position: 'relative',
          width: NODE_W,
          background: 'var(--bg-1)',
          border: `1px solid ${borderColor}`,
          borderRadius: 8,
          boxShadow: glowShadow,
          transition: 'box-shadow 200ms ease, border-color 200ms ease',
        }}
        onMouseEnter={e => {
          const hoverBorder = statusColor ?? 'var(--action)'
          const hoverGlow   = statusColor
            ? `0 0 0 1px ${statusColor}, 0 0 22px ${statusColor}66, 0 6px 28px rgba(0,0,0,0.34)`
            : `0 0 0 1px var(--action), 0 6px 28px rgba(0,0,0,0.34)`
          e.currentTarget.style.borderColor = hoverBorder
          e.currentTarget.style.boxShadow   = hoverGlow
          if (isApproved && cardRef.current) {
            keepDeckOpen()
            const rect = cardRef.current.getBoundingClientRect()
            setDeckAnchor({ x: rect.left + rect.width / 2, y: rect.top })
          }
        }}
        onMouseLeave={e => {
          e.currentTarget.style.borderColor = borderColor
          e.currentTarget.style.boxShadow   = glowShadow
          if (isApproved) scheduleDeckClose()
        }}
      >
        {/* Header — click target para abrir el panel; IO row y body quedan fuera del area clickable */}
        <div style={{
          background: `color-mix(in srgb, ${phaseColor} 14%, var(--bg-2))`,
          borderBottom: `1px solid color-mix(in srgb, ${phaseColor} 22%, var(--line-2))`,
          borderRadius: '7px 7px 0 0',
          padding: '6px 8px 6px 10px',
          display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 6,
        }}>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{
              display: 'flex', alignItems: 'baseline', gap: 5,
              overflow: 'hidden', whiteSpace: 'nowrap',
            }}>
              <span style={{ fontSize: 9, fontFamily: 'var(--font-mono)', fontWeight: 700, color: phaseColor, flexShrink: 0 }}>
                {node.node_key}
              </span>
              <span style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-0)', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                {node.title}
              </span>
            </div>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 4, flexShrink: 0 }}>
            {node.executor?.type && (
              <span style={{
                fontSize: 8, fontFamily: 'var(--font-mono)',
                color: `color-mix(in srgb, ${phaseColor} 70%, var(--text-3))`,
                background: `color-mix(in srgb, ${phaseColor} 8%, var(--bg-3))`,
                border: `1px solid color-mix(in srgb, ${phaseColor} 18%, var(--line-2))`,
                padding: '1px 5px', borderRadius: 3,
              }}>
                {EXECUTOR_LABEL[node.executor.type] ?? node.executor.type}
              </span>
            )}
            {/* Boton play — abre el panel del nodo */}
            <button
              onClick={onClick}
              title="Open node"
              style={{
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                width: 22, height: 22, borderRadius: '50%', flexShrink: 0,
                background: phaseColor, border: 'none', cursor: 'pointer',
                color: '#000', fontSize: 9, fontWeight: 700, lineHeight: 1,
                opacity: locked ? 0.4 : 1,
              }}
            >&#9654;</button>
          </div>
        </div>

        {/* Body — handle IN / OUT con modal de descripcion */}
        {(() => {
          // Parsea inputs para el modal (soporta v1.3.0 y legacy)
          const rawInputs = node.inputs
          const wiredInputs: Array<{key:string;type?:string;cardinality?:string;required?:boolean}> = (() => {
            if (Array.isArray(rawInputs)) return (rawInputs as Array<{key:string;required?:boolean}>).map(i => ({ key: i.key, required: i.required }))
            const v2 = rawInputs as {wired?:Array<{key:string;type?:string;cardinality?:string;required?:boolean}>}|null
            if (Array.isArray(v2?.wired)) return v2!.wired
            const leg = rawInputs as {required?:string[];optional?:string[]}|null
            return [
              ...(leg?.required ?? []).map(k => ({ key: k, required: true as const })),
              ...(leg?.optional ?? []).map(k => ({ key: k, required: false as const })),
            ]
          })()
          const directContext = (rawInputs as {direct_context?:string}|null)?.direct_context ?? null
          // Normaliza outputs: v1.3.0 usa key/label, legacy usa name
          const allOutputs = (node.outputs ?? []).map(o => ({
            ...o,
            _key:   (o as {key?:string}).key   || o.name || '',
            _label: (o as {label?:string}).label || o.name || '',
          }))

          const hBase: React.CSSProperties = {
            width: 10, height: 10, borderRadius: '50%',
            border: '2px solid var(--bg-0)', cursor: 'crosshair',
            position: 'absolute', top: '50%', transform: 'translateY(-50%)',
          }

          return (
            <>
              {/* Fila IN / OUT — handles unicos por nodo */}
              <div style={{ display: 'flex', borderBottom: '1px solid var(--line-2)', position: 'relative' }}>
                {/* IN side */}
                <div style={{ position: 'relative', flex: 1, display: 'flex', alignItems: 'center', gap: 6, padding: '5px 10px 5px 14px' }}>
                  <Handle type="target" id="in" position={Position.Left}
                    style={{ ...hBase, left: -6, background: phaseColor }}
                  />
                  <span
                    style={{ fontSize: 8, fontFamily: 'var(--font-mono)', fontWeight: 700, color: phaseColor, letterSpacing: '0.06em', cursor: 'pointer', userSelect: 'none', textDecoration: 'underline dotted' }}
                    onPointerDown={e => { e.stopPropagation(); e.nativeEvent.stopImmediatePropagation() }}
                    onMouseDown={e => { e.stopPropagation(); e.nativeEvent.stopImmediatePropagation() }}
                    onClick={e => { e.stopPropagation(); e.nativeEvent.stopImmediatePropagation(); setIoModal(ioModal === 'in' ? null : 'in') }}
                  >IN</span>
                  {wiredInputs.length > 0 && (
                    <span style={{ fontSize: 8, fontFamily: 'var(--font-mono)', color: 'var(--text-3)' }}>{wiredInputs.length}</span>
                  )}
                </div>
                <div style={{ width: 1, background: 'var(--line-2)', alignSelf: 'stretch', flexShrink: 0 }} />
                {/* OUT side */}
                <div style={{ position: 'relative', flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: 6, padding: '5px 14px 5px 10px' }}>
                  {allOutputs.length > 0 && (
                    <span style={{ fontSize: 8, fontFamily: 'var(--font-mono)', color: 'var(--text-3)' }}>{allOutputs.length}</span>
                  )}
                  <span
                    style={{ fontSize: 8, fontFamily: 'var(--font-mono)', fontWeight: 700, color: phaseColor, letterSpacing: '0.06em', cursor: 'pointer', userSelect: 'none', textDecoration: 'underline dotted' }}
                    onPointerDown={e => { e.stopPropagation(); e.nativeEvent.stopImmediatePropagation() }}
                    onMouseDown={e => { e.stopPropagation(); e.nativeEvent.stopImmediatePropagation() }}
                    onClick={e => { e.stopPropagation(); e.nativeEvent.stopImmediatePropagation(); setIoModal(ioModal === 'out' ? null : 'out') }}
                  >OUT</span>
                  <Handle type="source" id="out" position={Position.Right}
                    style={{ ...hBase, right: -6, background: phaseColor }}
                  />
                </div>
              </div>

              {/* Modal portal — descripcion de inputs u outputs */}
              {ioModal && typeof window !== 'undefined' && createPortal(
                <div
                  style={{ position: 'fixed', inset: 0, zIndex: 9999, display: 'flex', alignItems: 'center', justifyContent: 'center' }}
                  onMouseDown={() => setIoModal(null)}
                >
                  <div
                    style={{
                      background: 'var(--bg-1)', border: `1px solid ${phaseColor}44`,
                      borderRadius: 8, padding: 16, minWidth: 260, maxWidth: 380,
                      boxShadow: '0 8px 32px rgba(0,0,0,0.6)',
                    }}
                    onMouseDown={e => e.stopPropagation()}
                  >
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
                      <span style={{ fontSize: 11, fontWeight: 700, color: phaseColor, fontFamily: 'var(--font-mono)', letterSpacing: '0.06em' }}>
                        {ioModal === 'in' ? 'INPUTS' : 'OUTPUTS'} &mdash; {node.title}
                      </span>
                      <button
                        onMouseDown={e => e.stopPropagation()}
                        onClick={() => setIoModal(null)}
                        style={{ background: 'none', border: 'none', color: 'var(--text-3)', cursor: 'pointer', fontSize: 14, lineHeight: 1, padding: '0 2px' }}
                      >&#x2715;</button>
                    </div>

                    {ioModal === 'in' ? (
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                        {wiredInputs.length === 0 && !directContext && (
                          <span style={{ fontSize: 10, color: 'var(--text-3)', fontStyle: 'italic' }}>No wired inputs</span>
                        )}
                        {wiredInputs.map((w, i) => (
                          <div key={i} style={{ display: 'flex', flexDirection: 'column', gap: 2, padding: '6px 8px', background: 'var(--bg-2)', borderRadius: 5 }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                              <span style={{ width: 6, height: 6, borderRadius: '50%', flexShrink: 0,
                                background: w.required ? phaseColor : 'transparent',
                                border: w.required ? 'none' : `1.5px solid ${phaseColor}`,
                              }} />
                              <span style={{ fontSize: 10, fontFamily: 'var(--font-mono)', fontWeight: 700, color: 'var(--text-1)' }}>{w.key}</span>
                              {w.type && <span style={{ fontSize: 9, color: 'var(--text-3)', fontFamily: 'var(--font-mono)' }}>{w.type}</span>}
                              {w.cardinality && <span style={{ fontSize: 9, color: phaseColor, fontFamily: 'var(--font-mono)', marginLeft: 'auto' }}>{w.cardinality}</span>}
                            </div>
                          </div>
                        ))}
                        {directContext && (
                          <div style={{
                            marginTop: wiredInputs.length ? 8 : 0,
                            padding: '6px 8px', background: 'var(--bg-2)', borderRadius: 5,
                            borderLeft: '2px solid var(--text-3)',
                          }}>
                            <div style={{ fontSize: 9, color: 'var(--text-3)', fontFamily: 'var(--font-mono)', marginBottom: 3, fontWeight: 700 }}>DIRECT</div>
                            <div style={{ fontSize: 10, color: 'var(--text-2)', lineHeight: 1.4 }}>{directContext}</div>
                          </div>
                        )}
                      </div>
                    ) : (
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                        {allOutputs.length === 0 && (
                          <span style={{ fontSize: 10, color: 'var(--text-3)', fontStyle: 'italic' }}>No outputs defined</span>
                        )}
                        {allOutputs.map((out, i) => {
                          const outType = (out as {type?:string}).type
                          const outDesc = (out as {description?:string}).description
                          return (
                            <div key={i} style={{ display: 'flex', flexDirection: 'column', gap: 2, padding: '6px 8px', background: 'var(--bg-2)', borderRadius: 5 }}>
                              <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                                <span style={{ width: 6, height: 6, borderRadius: '50%', flexShrink: 0,
                                  background: out.optional ? 'transparent' : phaseColor,
                                  border: out.optional ? `1.5px solid ${phaseColor}` : 'none',
                                }} />
                                <span style={{ fontSize: 10, fontFamily: 'var(--font-mono)', fontWeight: 700, color: 'var(--text-1)' }}>{out._label}</span>
                                {outType && <span style={{ fontSize: 9, color: 'var(--text-3)', fontFamily: 'var(--font-mono)', background: 'var(--bg-3)', padding: '1px 4px', borderRadius: 3 }}>{outType}</span>}
                                {out.format && <span style={{ fontSize: 9, color: phaseColor, fontFamily: 'var(--font-mono)', marginLeft: 'auto' }}>{out.format}</span>}
                              </div>
                              {outDesc && <div style={{ fontSize: 10, color: 'var(--text-3)', paddingLeft: 12, lineHeight: 1.4 }}>{outDesc}</div>}
                            </div>
                          )
                        })}
                      </div>
                    )}
                  </div>
                </div>,
                document.body
              )}

              {/* Output aprobado */}
              {isApproved && session?.output_asset && (
                <div style={{ padding: '5px 8px', borderBottom: '1px solid var(--line-2)' }} onClick={e => e.stopPropagation()}>
                  <div style={{
                    display: 'flex', alignItems: 'center', gap: 4,
                    background: 'color-mix(in srgb, #34D399 9%, var(--bg-2))',
                    border: '1px solid color-mix(in srgb, #34D399 22%, var(--line-2))',
                    borderRadius: 5, padding: '4px 7px',
                  }}>
                    <span style={{ fontSize: 10, color: '#34D399', flexShrink: 0 }}>
                      {effectivePdfUrl ? '📄' : '📝'}
                    </span>
                    <span style={{
                      fontSize: 9, fontFamily: 'var(--font-mono)', color: 'var(--text-1)',
                      flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                    }} title={session.output_asset.name}>
                      {session.output_asset.name}
                    </span>
                    <button
                      onClick={() => setOutputOpen(true)}
                      title="View output"
                      style={{ border: 'none', background: 'none', color: '#34D399', cursor: 'pointer', fontSize: 12, padding: '0 2px', lineHeight: 1, flexShrink: 0 }}
                    >👁</button>
                    {effectivePdfUrl ? (
                      <a
                        href={effectivePdfUrl}
                        target="_blank"
                        rel="noreferrer"
                        onClick={e => e.stopPropagation()}
                        title="Download PDF"
                        style={{ color: '#34D399', fontSize: 12, textDecoration: 'none', lineHeight: 1, padding: '0 2px', flexShrink: 0 }}
                      >⬇</a>
                    ) : session.output_asset.content ? (
                      <button
                        onClick={handleGeneratePdf}
                        title={pdfLoading ? 'Generating PDF…' : 'Generate & Download PDF'}
                        style={{ border: 'none', background: 'none', color: '#34D399', cursor: pdfLoading ? 'default' : 'pointer', fontSize: pdfLoading ? 9 : 12, padding: '0 2px', lineHeight: 1, flexShrink: 0, fontFamily: 'var(--font-mono)' }}
                      >{pdfLoading ? '…' : '⬇'}</button>
                    ) : null}
                  </div>
                </div>
              )}

              {/* Imágenes generadas — click abre slideshow directo */}
              {(() => {
                const hasImgs = Object.values(localOutputImages).some(arr => arr.some(i => i.variations?.length > 0))
                if (!hasImgs) return null
                const allUrls = Object.values(localOutputImages).flatMap(arr => arr.flatMap(i => (i.variations ?? []).map(v => v.url)))
                const total   = allUrls.length
                const openSlideshow = () => setZoomGallery({ urls: allUrls, idx: 0 })
                return (
                  <div style={{ padding: '5px 8px', borderBottom: '1px solid var(--line-2)' }} onClick={e => e.stopPropagation()}>
                    <div
                      onClick={openSlideshow}
                      style={{
                        display: 'flex', alignItems: 'center', gap: 4,
                        background: 'color-mix(in srgb, #818CF8 9%, var(--bg-2))',
                        border: '1px solid color-mix(in srgb, #818CF8 22%, var(--line-2))',
                        borderRadius: 5, padding: '4px 7px',
                        cursor: 'pointer',
                      }}
                    >
                      <span style={{ fontSize: 10, color: '#818CF8', flexShrink: 0 }}>🖼</span>
                      <span style={{ fontSize: 9, fontFamily: 'var(--font-mono)', color: 'var(--text-1)', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {total} image{total !== 1 ? 's' : ''} generated
                      </span>
                      <span style={{ color: '#818CF8', fontSize: 12, lineHeight: 1, flexShrink: 0 }}>👁</span>
                    </div>
                  </div>
                )
              })()}

              {/* Footer: phase + outputs picker + status / lock */}
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '5px 10px' }}>
                <span style={{
                  fontSize: 8, fontFamily: 'var(--font-mono)', fontWeight: 600,
                  color: phaseColor, textTransform: 'uppercase', letterSpacing: '0.08em',
                  opacity: locked ? 0.4 : 1, flexShrink: 0,
                }}>
                  {node.phase}
                </span>
                {isGate && (
                  <span style={{
                    flex: 1, textAlign: 'center', whiteSpace: 'nowrap',
                    fontSize: 8, fontFamily: 'var(--font-mono)', fontWeight: 700,
                    color: '#F59E0B', letterSpacing: '0.08em', pointerEvents: 'none',
                  }}>◆ GATE</span>
                )}
                <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginLeft: isGate ? undefined : 'auto', flexShrink: 0 }}>
                  {(node.outputs ?? []).length > 0 && (
                    <button
                      onClick={e => { e.stopPropagation(); setOutputOpen(true) }}
                      title="View outputs"
                      style={{
                        border: `1px solid ${isApproved ? 'color-mix(in srgb,#34D399 40%,var(--line-2))' : 'var(--line-2)'}`,
                        background: isApproved ? 'color-mix(in srgb,#34D399 8%,transparent)' : 'none',
                        borderRadius: 5, padding: '4px 10px', cursor: 'pointer',
                        fontFamily: 'var(--font-mono)', fontSize: 9, lineHeight: 1,
                        color: isApproved ? '#34D399' : 'var(--text-3)',
                        display: 'flex', alignItems: 'center', gap: 4,
                      }}
                    >&#9672; {(node.outputs ?? []).length}</button>
                  )}
                  {locked ? (
                    <span style={{ fontSize: 9, color: 'var(--text-4)', letterSpacing: '0.04em', fontFamily: 'var(--font-mono)' }}>
                      🔒 locked
                    </span>
                  ) : status && statusColor && (
                    <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                      <span style={{ width: 5, height: 5, borderRadius: '50%', background: statusColor, flexShrink: 0 }} />
                      <span style={{ fontSize: 8, fontFamily: 'var(--font-mono)', color: statusColor, letterSpacing: '0.06em' }}>
                        {status}
                      </span>
                    </div>
                  )}
                </div>
              </div>
            </>
          )
        })()}
      </div>

      {/* Abanico de cartas — solo nodos aprobados */}
      {isApproved && deckAnchor && (
        <AssetCardDeck
          nodeId={node.id}
          projectNodeId={canvasNode.project_node_id}
          projectId={projectId}
          anchorX={deckAnchor.x}
          anchorY={deckAnchor.y}
          onKeepOpen={keepDeckOpen}
          onScheduleClose={scheduleDeckClose}
        />
      )}

      {/* Modal de output — draggable, resizable, maximizable */}
      {renderJob && typeof document !== 'undefined' && createPortal(
        <RenderProgress
          projectId={projectId}
          nodeId={node.id}
          projectNodeId={canvasNode.project_node_id}
          outputKey={renderJob.clave}
          esperadas={renderJob.esperadas}
          error={renderJob.error}
          onClose={() => setRenderJob(null)}
          onDone={imgs => onImagesUpdate?.(imgs, renderJob.clave)}
          onSettled={() => marcarMuerto(renderJob.clave)}
        />, document.body)}

      {confirmar && typeof document !== 'undefined' && createPortal(
        <ConfirmarRender
          etiqueta={confirmar.etiqueta}
          cuantas={confirmar.cuantas}
          onCancel={() => setConfirmar(null)}
          onOk={() => { const c = confirmar; setConfirmar(null); despacharOutput(c.clave, c.cuantas) }}
        />, document.body)}

      {outputOpen && typeof document !== 'undefined' && (node.outputs ?? []).length > 0 && createPortal(
        <>
          <div
            onMouseDown={e => e.stopPropagation()}
            style={{
              position:     'fixed',
              left:         outMaximized ? 0 : outPos.x,
              top:          outMaximized ? 0 : outPos.y,
              zIndex:       10001,
              width:        outMaximized ? '100vw' : outSize.w,
              height:       outMaximized ? '100vh' : outSize.h,
              background:   'var(--bg-1)',
              border:       '1px solid var(--line-2)',
              borderRadius: outMaximized ? 0 : 10,
              boxShadow:    outMaximized ? 'none' : '0 24px 64px rgba(0,0,0,0.6)',
              display:      'flex', flexDirection: 'column', overflow: 'hidden',
              userSelect:   outDragging || outResizing ? 'none' : 'auto',
            }}
          >
            <div
              onMouseDown={onOutDragStart}
              style={{ padding: '12px 20px', borderBottom: '1px solid var(--line-2)', flexShrink: 0, display: 'flex', alignItems: 'center', gap: 8, cursor: outMaximized ? 'default' : (outDragging ? 'grabbing' : 'grab') }}
            >
              <span style={{ fontSize: 14, flexShrink: 0 }}>
                {outSession?.output_asset ? (effectiveOutPdfUrl ? '📄' : '📝') : Object.values(localOutputImages).some(a => a.some(i => i.variations?.length > 0)) ? '🖼' : '◈'}
              </span>
              <span style={{ flex: 1, fontSize: 12, fontFamily: 'var(--font-mono)', fontWeight: 700, color: 'var(--text-0)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {outSession?.output_asset ? outSession.output_asset.name : Object.values(localOutputImages).some(a => a.some(i => i.variations?.length > 0)) ? `${node.title} — Image Outputs` : `${node.title} — Outputs`}
              </span>
              {outSession?.output_asset && (
                <>
                  <span onMouseDown={e => e.stopPropagation()} style={{ fontSize: 9, fontFamily: 'var(--font-mono)', color: 'var(--text-3)', background: 'var(--bg-3)', border: '1px solid var(--line-2)', padding: '2px 6px', borderRadius: 3, flexShrink: 0 }}>
                    {outSession.output_asset.format}
                  </span>
                  {/* El PDF se rehace AL PEDIRLO, no se enlaza el que quedó de la corrida.
                      Un documento con imágenes no puede rendirse automáticamente al terminar el
                      Run: las imágenes de ComfyUI tardan y el PDF salía antes de que llegaran, así
                      que el archivo quedaba sin ellas para siempre aunque después aparecieran.
                      Regenerar no cuesta crédito —es pdfkit local— y el endpoint resuelve las
                      imágenes del momento y actualiza el asset, así que el enlace viejo no aporta.
                      El pptx sí se enlaza: ese archivo no se puede rehacer. */}
                  {/* Y solo para outputs que SON un documento. La pestaña activa manda: el
                      `pitch_image_plan` es un registro de decisión —no se entrega, se revisa— y
                      ofrecer ahí un PDF terminaba en «no tiene un documento aprobado del que sacar
                      PDF». Lo mismo vale para las `connection`, que son datos para el nodo
                      siguiente. */}
                  {(() => {
                    const def = (node.outputs ?? []).find(x => (x as {key?: string; name?: string}).key === outTab || x.name === outTab) as
                      { type?: string; format?: string } | undefined
                    const esDoc = !def
                      || ['docx', 'pdf', 'document', 'markdown', 'md', 'pptx'].includes(String(def.format || '').toLowerCase())
                    return esDoc
                  })() && (<>
                  {effectiveOutPdfUrl && (outSession.output_asset.format === 'pptx' || !outSession.output_asset.content) ? (
                    <a
                      onMouseDown={e => e.stopPropagation()}
                      href={effectiveOutPdfUrl}
                      target="_blank"
                      rel="noreferrer"
                      style={{ fontSize: 9, fontFamily: 'var(--font-mono)', color: '#F59E0B', textDecoration: 'none', padding: '2px 8px', border: '1px solid color-mix(in srgb, #F59E0B 50%, transparent)', borderRadius: 3, flexShrink: 0 }}
                    >↓ {outSession.output_asset.format === 'pptx' ? 'PPTX' : 'PDF'}</a>
                  ) : outSession.output_asset.content ? (
                    <button
                      onMouseDown={e => e.stopPropagation()}
                      onClick={e => handleGeneratePdf(e, outTab)}
                      disabled={pdfLoading}
                      title={`Generate & download the PDF of: ${outTab.replace(/_/g, ' ')}`}
                      style={{ fontSize: 9, fontFamily: 'var(--font-mono)', color: '#F59E0B', background: 'none', padding: '2px 8px', border: '1px solid color-mix(in srgb, #F59E0B 50%, transparent)', borderRadius: 3, flexShrink: 0, cursor: pdfLoading ? 'default' : 'pointer', opacity: pdfLoading ? 0.6 : 1 }}
                    >{pdfLoading ? '…' : '↓ PDF'}</button>
                  ) : null}
                  {pdfError && (
                    <span
                      onMouseDown={e => e.stopPropagation()}
                      title={pdfError}
                      style={{
                        fontSize: 9, fontFamily: 'var(--font-mono)', color: '#F87171',
                        border: '1px solid rgba(248,113,113,0.35)', background: 'rgba(248,113,113,0.08)',
                        padding: '2px 8px', borderRadius: 3, flexShrink: 1,
                        overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 260,
                      }}
                    >{pdfError}</span>
                  )}
                  </>)}
                  {outSession.output_asset.content && (
                    <button
                      onMouseDown={e => e.stopPropagation()}
                      onClick={() => { const c = outSession?.output_asset?.content; if (!c) return; downloadTextFile(forDisplay(c), mdFilename(outSession?.output_asset?.name || 'document')) }}
                      title="Download Markdown (original text)"
                      style={{ fontSize: 9, fontFamily: 'var(--font-mono)', color: 'var(--text-2)', background: 'none', padding: '2px 8px', border: '1px solid var(--line-2)', borderRadius: 3, flexShrink: 0, cursor: 'pointer' }}
                    >↓ MD</button>
                  )}
                </>
              )}
              {/* Copiar como texto (solo outputs de texto/documento) */}
              {outSession?.output_asset?.content && (
                <span onMouseDown={e => e.stopPropagation()} style={{ flexShrink: 0 }}>
                  <CopyButton text={outSession.output_asset.content} style={{ width: 24, height: 24, fontSize: 12 }} />
                </span>
              )}
              {/* Grip */}
              <span onMouseDown={e => e.stopPropagation()} style={{ fontSize: 15, flexShrink: 0, lineHeight: 1, opacity: 0.55, userSelect: 'none', filter: 'brightness(0) invert(1)' }}>🖐️</span>
              {/* Maximizar */}
              <button
                onMouseDown={e => e.stopPropagation()}
                onClick={toggleOutMaximize}
                title={outMaximized ? 'Restore' : 'Maximize'}
                style={{ border: 'none', background: 'transparent', cursor: 'pointer', color: 'var(--text-2)', fontSize: 13, padding: '4px 8px', borderRadius: 6, flexShrink: 0, fontFamily: 'var(--font-mono)' }}
              >
                {outMaximized ? (
                  <svg width="13" height="13" viewBox="0 0 13 13" fill="none" style={{ display: 'block' }}>
                    <rect x="3.75" y="0.75" width="8.5" height="8.5" stroke="currentColor" strokeWidth="1.5" rx="1"/>
                    <rect x="0.75" y="3.75" width="8.5" height="8.5" stroke="currentColor" strokeWidth="1.5" rx="1" fill="var(--bg-1)"/>
                  </svg>
                ) : (
                  <svg width="13" height="13" viewBox="0 0 13 13" fill="none" style={{ display: 'block' }}>
                    <rect x="0.75" y="0.75" width="11.5" height="11.5" stroke="currentColor" strokeWidth="1.5" rx="1"/>
                  </svg>
                )}
              </button>
              <button
                onMouseDown={e => e.stopPropagation()}
                onClick={() => setOutputOpen(false)}
                style={{ border: 'none', background: 'transparent', cursor: 'pointer', color: 'var(--text-2)', fontSize: 16, padding: '4px 8px', borderRadius: 6, flexShrink: 0, fontFamily: 'var(--font-mono)' }}
              >✕</button>
            </div>
            {/* Tab bar — una tab por output + toggle gallery/list */}
            {(node.outputs ?? []).length > 0 && (
              <div style={{ display: 'flex', alignItems: 'stretch', borderBottom: '1px solid var(--line-2)', flexShrink: 0 }}>
                {/* Tabs scrollables */}
                <div style={{ display: 'flex', overflowX: 'auto', flex: 1 }}>
                  {(node.outputs ?? []).map(o => {
                    const oKey    = (o as {key?:string}).key   || o.name || ''
                    const oLabel  = (o as {label?:string}).label || o.name || ''
                    const isConn  = (o as {type?:string}).type === 'connection'
                    const isActive = outTab === oKey
                    return (
                      <button
                        key={oKey}
                        onClick={() => { setOutTab(oKey); setViewMode('gallery') }}
                        style={{
                          padding: '8px 14px', border: 'none', borderBottom: isActive ? '2px solid var(--action)' : '2px solid transparent',
                          marginBottom: -1, background: 'none', cursor: 'pointer',
                          fontSize: 10, fontFamily: 'var(--font-mono)', fontWeight: isActive ? 700 : 400,
                          color: isActive ? 'var(--action)' : 'var(--text-3)',
                          flexShrink: 0, whiteSpace: 'nowrap', transition: 'color 120ms, border-color 120ms',
                          display: 'flex', alignItems: 'center', gap: 5,
                        }}
                      >
                        {oLabel.replace(/_/g, ' ')}
                        {isConn && (
                          <span style={{
                            fontSize: 7, fontWeight: 700, letterSpacing: '.05em',
                            color: '#34D399',
                            background: 'color-mix(in srgb, #34D399 15%, var(--bg-1))',
                            border: '1px solid color-mix(in srgb, #34D399 35%, transparent)',
                            borderRadius: 3, padding: '1px 4px', lineHeight: 1.4,
                          }}>WIRE</span>
                        )}
                      </button>
                    )
                  })}
                </div>
                {/* Focus output en chat + toggle gallery/list */}
                <div style={{ display: 'flex', alignItems: 'center', gap: 2, padding: '0 8px', borderLeft: '1px solid var(--line-2)', flexShrink: 0 }}>
                  {/* Correr SOLO este output. El Run del nodo dispara todos los pendientes: en el
                      3.20 eso son 55 imágenes. Y el chat no sirve para esto — no despacha nada,
                      solo llama al modelo. */}
                  {outTab && (() => {
                    const o = (node.outputs ?? []).find(x => (x as {key?:string;name:string}).key === outTab || x.name === outTab) as
                      { key?: string; name?: string; label?: string; image_gen?: boolean; image_count?: number; production?: string } | undefined
                    if (!o?.image_gen || o.production === 'deferred') return null
                    const clave = o.key || o.name || outTab
                    const vivo  = vivos[clave]
                    // El botón es para PRODUCIR lo que falta, no para rehacer lo que ya está: con
                    // imágenes en el output desaparece. Rehacer cuesta crédito y además no
                    // devuelve lo mismo — ComfyUI no reproduce un render —, así que no puede
                    // quedar a un clic de distancia. Para rehacer está el radial del moodboard,
                    // que versiona en vez de pisar.
                    // Mientras hay un despacho vivo se mantiene aunque ya lleguen imágenes: es la
                    // única puerta al panel de progreso.
                    if (!vivo && (localOutputImages[clave] ?? []).length > 0) return null
                    return (
                      <button
                        onClick={() => {
                          // Con un despacho vivo el botón no re-dispara: muestra en qué va. Volver
                          // a apretarlo fue exactamente lo que produjo tres renders en paralelo.
                          if (vivo) { setRenderJob({ clave, esperadas: vivo.esperadas }); return }
                          if (runningOutput) return
                          // Nunca despacha de una: primero dice qué va a hacer y cuánto.
                          setConfirmar({ clave, etiqueta: o.label || o.name || clave, cuantas: o.image_count ?? 0 })
                        }}
                        disabled={!!runningOutput && !vivo}
                        title={vivo
                          ? 'This output is already rendering — click to see progress'
                          : `Render this output${o.image_count ? ` — ${o.image_count} images` : ''}`}
                        style={{
                          border: '1px solid color-mix(in srgb, #F59E0B 35%, var(--line-2))',
                          background: 'color-mix(in srgb, #F59E0B 10%, var(--bg-2))',
                          borderRadius: 4, padding: '3px 8px',
                          cursor: runningOutput && !vivo ? 'default' : 'pointer',
                          color: '#F59E0B', fontSize: 9, fontFamily: 'var(--font-mono)', fontWeight: 700,
                          lineHeight: 1, marginRight: 4, opacity: runningOutput || vivo ? 0.55 : 1,
                        }}
                      >{vivo ? '◷ RENDERING…' : runningOutput === clave ? '…' : `▶ RENDER${o.image_count ? ` ${o.image_count}` : ''}`}</button>
                    )
                  })()}
                  {onOpenChat && outTab && (
                    <button
                      onClick={() => {
                        const activeO = (node.outputs ?? []).find(o => (o as {key?:string;name:string}).key === outTab || o.name === outTab)
                        const outKey   = (activeO as {key?:string;name:string} | undefined)?.key || outTab
                        const outLabel = (activeO as {label?:string;name:string} | undefined)?.label || outTab.replace(/_/g, ' ')
                        setOutputOpen(false)
                        onOpenChat(outKey, outLabel)
                      }}
                      title={`Focus chat on: ${outTab.replace(/_/g, ' ')}`}
                      style={{
                        border: '1px solid color-mix(in srgb, #F59E0B 30%, var(--line-2))',
                        background: 'color-mix(in srgb, #F59E0B 8%, var(--bg-2))',
                        borderRadius: 4, padding: '3px 8px', cursor: 'pointer',
                        color: '#F59E0B', fontSize: 9, fontFamily: 'var(--font-mono)', fontWeight: 700,
                        lineHeight: 1, marginRight: 4,
                      }}
                    >◆ Focus</button>
                  )}
                  <button
                    onClick={() => setViewMode('gallery')}
                    title="Gallery view"
                    style={{ border: 'none', background: viewMode === 'gallery' ? 'var(--bg-3)' : 'none', borderRadius: 4, padding: '4px 6px', cursor: 'pointer', color: viewMode === 'gallery' ? 'var(--text-0)' : 'var(--text-4)', fontSize: 13, lineHeight: 1 }}
                  >⊞</button>
                  <button
                    onClick={() => setViewMode('list')}
                    title="List view"
                    style={{ border: 'none', background: viewMode === 'list' ? 'var(--bg-3)' : 'none', borderRadius: 4, padding: '4px 6px', cursor: 'pointer', color: viewMode === 'list' ? 'var(--text-0)' : 'var(--text-4)', fontSize: 13, lineHeight: 1 }}
                  >☰</button>
                </div>
              </div>
            )}

            {/* Contenido del tab activo */}
            {(() => {
              const outputs    = node.outputs ?? []
              // Buscar por key (v1.3.0) o name (legacy)
              const activeOut  = outputs.find(o => ((o as {key?:string}).key || o.name) === outTab) ?? outputs[0]
              if (!activeOut) return null
              const activeOutKey = (activeOut as {key?:string}).key || activeOut.name || ''

              const isPureImage = activeOut.format === 'png' || activeOut.format === 'image'

              // Tab de imagen pura o sin contenido de texto
              if (isPureImage || !outSession?.output_asset) {
                const imgs    = (localOutputImages[activeOutKey] ?? []).filter(i => i.variations?.length > 0)
                const allUrls = imgs.flatMap(item => item.variations.map(v => v.url))

                // Empty state para outputs de texto/markdown sin contenido aún
                if (!isPureImage && imgs.length === 0) {
                  const emptyLabel = (activeOut as {label?:string}).label || activeOut.name || activeOutKey
                  const emptyDesc  = (activeOut as {description?:string}).description
                  return (
                    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: '40px 28px', gap: 14 }}>
                      <span style={{ fontSize: 30, opacity: 0.18, fontFamily: 'var(--font-mono)' }}>&#9672;</span>
                      <div style={{ textAlign: 'center' }}>
                        <div style={{ fontSize: 11, fontFamily: 'var(--font-mono)', fontWeight: 700, color: 'var(--text-2)', marginBottom: 4 }}>{emptyLabel}</div>
                        {emptyDesc && <div style={{ fontSize: 9, fontFamily: 'var(--font-mono)', color: 'var(--text-4)', maxWidth: 260 }}>{emptyDesc}</div>}
                        <div style={{ fontSize: 9, fontFamily: 'var(--font-mono)', color: 'var(--text-4)', marginTop: 6, opacity: 0.7 }}>Not generated yet</div>
                      </div>
                      {onOpenChat && (
                        <button
                          onClick={() => {
                            setOutputOpen(false)
                            onOpenChat(activeOutKey, emptyLabel)
                          }}
                          style={{
                            border: '1px solid color-mix(in srgb, #F59E0B 40%, var(--line-2))',
                            background: 'color-mix(in srgb, #F59E0B 10%, var(--bg-2))',
                            borderRadius: 5, padding: '7px 18px', cursor: 'pointer',
                            color: '#F59E0B', fontSize: 10, fontFamily: 'var(--font-mono)', fontWeight: 700, letterSpacing: '0.04em',
                          }}
                        >&#9670; Chat to generate</button>
                      )}
                    </div>
                  )
                }

                return (
                  <div style={{ flex: 1, overflowY: 'auto', padding: '20px 28px' }}>
                    {imgs.length === 0 ? (
                      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '100%', gap: 14, paddingTop: 40 }}>
                        <span style={{ fontSize: 30, opacity: 0.18 }}>🖼</span>
                        <div style={{ fontSize: 9, fontFamily: 'var(--font-mono)', color: 'var(--text-4)' }}>No images generated yet.</div>
                        {onOpenChat && (
                          <button
                            onClick={() => {
                              const lbl = (activeOut as {label?:string}).label || activeOut.name || activeOutKey
                              setOutputOpen(false)
                              onOpenChat(activeOutKey, lbl)
                            }}
                            style={{
                              border: '1px solid color-mix(in srgb, #F59E0B 40%, var(--line-2))',
                              background: 'color-mix(in srgb, #F59E0B 10%, var(--bg-2))',
                              borderRadius: 5, padding: '7px 18px', cursor: 'pointer',
                              color: '#F59E0B', fontSize: 10, fontFamily: 'var(--font-mono)', fontWeight: 700,
                            }}
                          >&#9670; Chat to generate</button>
                        )}
                      </div>
                    ) : (
                      <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
                        {imgs.flatMap(item => item.variations.map((v, vi) => (
                          <img
                            key={`${item.index}-${vi}`}
                            src={v.url}
                            alt={activeOutKey}
                            onClick={() => setZoomGallery({ urls: allUrls, idx: allUrls.indexOf(v.url) })}
                            style={{ width: 190, height: 190, objectFit: 'cover', borderRadius: 6, cursor: 'zoom-in', border: '1px solid var(--line-2)', display: 'block' }}
                          />
                        )))}
                      </div>
                    )}
                  </div>
                )
              }

              // Tab de texto/markdown
              const otherKeys   = outputs.filter(o => ((o as {key?:string}).key || o.name) !== activeOutKey).map(o => (o as {key?:string}).key || o.name || '')
              const section     = outSession?.output_asset?.content
                ? (extractSection(outSession.output_asset.content, activeOutKey, otherKeys) ?? outSession.output_asset.content)
                : null

              // Gallery solo tiene sentido cuando el output tiene image_gen (para generar imágenes por ítem)
              // Outputs de texto puro siempre van a vista prosa/markdown
              // Un DOCUMENTO nunca es una galería, aunque genere imágenes: sus imágenes van
              // incrustadas adentro, no al lado. La lista se escribió cuando «output con
              // image_gen» quería decir PNG; desde v2.9.13 el `pitch_document` es docx CON
              // image_gen, y sin `docx` acá la ventana mostraba las imágenes y escondía el texto.
              const PROSE_FORMATS = ['markdown', 'md', 'document', 'docx', 'text', 'pptx', 'pdf']
              const parsedItems = section ? parseOutputItems(section, activeOut.format) : []
              const isGallery   = parsedItems.length >= 2 && !!activeOut.image_gen && !PROSE_FORMATS.includes(activeOut.format ?? '')
              // Construir image items si el output tiene image_gen
              const imageItems: InlineImageItem[] = []
              imageItemsRef.current = imageItems   // se actualiza en cada render
              if (section && activeOut.image_gen && activeOut.image_gen_model) {
                const savedItems = localOutputImages[activeOutKey] ?? []
                for (let idx = 0; idx < parsedItems.length; idx++) {
                  const itemText   = parsedItems[idx]
                  const saved      = savedItems.find(s => s.index === idx)
                  const variations = saved?.variations ?? []
                  const key        = `${activeOutKey}:${idx}`
                  imageItems.push({
                    itemKey:       key,
                    index:         idx,
                    text:          itemText,
                    imageUrl:      variations.at(-1)?.url ?? null,
                    allVariations: variations,
                    isGenerating:  generatingImgKey === key,
                    onZoom:        url => setZoomUrl(url),
                    onGenerate:    async (condition?: string) => {
                      if (!outSession?.id) return
                      setGeneratingImgKey(key)
                      try {
                        const r = await generateItemImage(projectId, node.id, outSession.id, activeOutKey, idx, itemText, condition)
                        const imgs = r.output_images
                        setLocalOutputImages(imgs)
                        onImagesUpdate?.(imgs, activeOutKey)
                      } catch (e) { console.error('[image-gen]', e) }
                      finally { setGeneratingImgKey(null) }
                    },
                  })
                }
              }

              // Vista galería — lista estructurada con 2+ ítems y modo gallery activo
              if (isGallery && viewMode === 'gallery') {
                return (
                  <div style={{ flex: 1, overflowY: 'auto', padding: '20px 24px' }}>
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(185px, 1fr))', gap: 12 }}>
                      {imageItems.length > 0
                        ? imageItems.map(item => (
                          <div key={item.itemKey} style={{ background: 'var(--bg-2)', border: '1px solid var(--line-2)', borderRadius: 10, overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
                            {/* Área de imagen */}
                            <div style={{ position: 'relative', width: '100%', paddingBottom: '100%', background: 'var(--bg-3)', flexShrink: 0 }}>
                              <div style={{ position: 'absolute', inset: 0 }}>
                                {item.imageUrl ? (
                                  <>
                                    <img
                                      src={item.imageUrl} alt=""
                                      onClick={() => {
                                        // Navegar por las variaciones de esta card, no por el gallery completo
                                        const urls = item.allVariations.map(v => v.url)
                                        setZoomGallery({ urls, idx: urls.length - 1 })
                                      }}
                                      style={{ width: '100%', height: '100%', objectFit: 'cover', cursor: 'zoom-in', display: 'block' }}
                                    />
                                    {/* Botón ✦ — guarda solo el key para evitar datos stale */}
                                    <button
                                      onClick={() => item.isGenerating ? null : setVariationItemKey(item.itemKey)}
                                      disabled={item.isGenerating}
                                      title={item.isGenerating ? 'Generating…' : 'Generate new variation'}
                                      style={{
                                        position: 'absolute', bottom: 6, right: 6,
                                        width: 26, height: 26, borderRadius: '50%',
                                        border: '1px solid rgba(255,255,255,0.35)',
                                        background: 'rgba(0,0,0,0.55)',
                                        backdropFilter: 'blur(4px)',
                                        cursor: item.isGenerating ? 'default' : 'pointer',
                                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                                        fontSize: 12, color: '#fff',
                                        opacity: item.isGenerating ? 0.4 : 0.85,
                                      }}
                                    >
                                      {item.isGenerating ? '◌' : '✦'}
                                    </button>
                                    {/* Dots de variaciones */}
                                    {item.allVariations.length > 1 && (
                                      <div style={{ position: 'absolute', bottom: 7, left: 0, right: 40, display: 'flex', justifyContent: 'center', gap: 4 }}>
                                        {item.allVariations.map((_, vi) => (
                                          <div key={vi} style={{ width: 5, height: 5, borderRadius: '50%', background: '#fff', opacity: vi === item.allVariations.length - 1 ? 1 : 0.4 }} />
                                        ))}
                                      </div>
                                    )}
                                  </>
                                ) : (
                                  <button
                                    onClick={() => item.onGenerate?.()}
                                    disabled={item.isGenerating}
                                    style={{ width: '100%', height: '100%', border: 'none', background: 'none', cursor: item.isGenerating ? 'default' : 'pointer', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 6 }}
                                  >
                                    <span style={{ fontSize: 22, color: 'var(--action)', opacity: item.isGenerating ? 0.35 : 0.8 }}>{item.isGenerating ? '◌' : '✦'}</span>
                                    <span style={{ fontSize: 9, fontFamily: 'var(--font-mono)', color: 'var(--text-4)' }}>{item.isGenerating ? 'Generating…' : 'Generate'}</span>
                                  </button>
                                )}
                              </div>
                            </div>
                            {/* Texto — click abre modal de lectura */}
                            <div
                              onClick={() => setTextModal({ text: item.text, label: `Item ${item.index + 1}` })}
                              title="Click to read full text"
                              style={{ padding: '9px 11px', fontSize: 10, fontFamily: 'var(--font-mono)', color: 'var(--text-2)', lineHeight: 1.5, flex: 1, cursor: 'zoom-in', position: 'relative', display: 'flex', alignItems: 'flex-start', gap: 4 }}
                            >
                              <span style={{ flex: 1 }}>{item.text.length > 120 ? item.text.slice(0, 120) + '…' : item.text}</span>
                              <span style={{ fontSize: 9, color: 'var(--text-4)', flexShrink: 0, paddingTop: 1 }}>⊕</span>
                            </div>
                          </div>
                        ))
                        : parsedItems.map((text, i) => (
                          <div
                            key={i}
                            onClick={() => setTextModal({ text, label: `Item ${i + 1}` })}
                            style={{ background: 'var(--bg-2)', border: '1px solid var(--line-2)', borderRadius: 10, padding: '13px 14px', display: 'flex', flexDirection: 'column', gap: 6, cursor: 'zoom-in' }}
                          >
                            <span style={{ fontSize: 8, fontFamily: 'var(--font-mono)', color: 'var(--text-4)', letterSpacing: '0.08em' }}>#{i + 1}</span>
                            <div style={{ fontSize: 11, color: 'var(--text-1)', lineHeight: 1.6 }}>{text.length > 120 ? text.slice(0, 120) + '…' : text}</div>
                          </div>
                        ))
                      }
                    </div>
                  </div>
                )
              }

              // Vista lista — mismos imageItems en layout de filas, texto completo, sin shrink
              if (isGallery && viewMode === 'list') {
                return (
                  <div style={{ flex: 1, overflowY: 'auto', padding: '12px 20px' }}>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                      {imageItems.length > 0
                        ? imageItems.map(item => (
                          /* flexShrink:0 evita que el flex-column padre encoja las filas */
                          <div key={item.itemKey} style={{ display: 'grid', gridTemplateColumns: '76px 1fr', flexShrink: 0, background: 'var(--bg-2)', border: '1px solid var(--line-2)', borderRadius: 10, overflow: 'hidden' }}>
                            {/* Thumbnail — minHeight asegura alto mínimo visible */}
                            <div style={{ background: 'var(--bg-3)', minHeight: 80, position: 'relative', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                              {item.imageUrl ? (
                                <>
                                  <img
                                    src={item.imageUrl} alt=""
                                    onClick={() => {
                                      const urls = item.allVariations.map(v => v.url)
                                      setZoomGallery({ urls, idx: urls.length - 1 })
                                    }}
                                    style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover', cursor: 'zoom-in', display: 'block' }}
                                  />
                                </>
                              ) : (
                                <button
                                  onClick={() => item.onGenerate?.()}
                                  disabled={item.isGenerating}
                                  style={{ position: 'absolute', inset: 0, border: 'none', background: 'none', cursor: item.isGenerating ? 'default' : 'pointer', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 4 }}
                                >
                                  <span style={{ fontSize: 20, color: 'var(--action)', opacity: item.isGenerating ? 0.35 : 0.8 }}>{item.isGenerating ? '◌' : '✦'}</span>
                                  <span style={{ fontSize: 8, fontFamily: 'var(--font-mono)', color: 'var(--text-4)' }}>{item.isGenerating ? 'generating…' : 'generate'}</span>
                                </button>
                              )}
                            </div>
                            {/* Texto completo + botones */}
                            <div style={{ padding: '11px 14px', display: 'flex', flexDirection: 'column', gap: 8 }}>
                              {(() => {
                                const lines   = item.text.replace(/[*`]/g, '').split('\n').map(l => l.trim()).filter(Boolean)
                                const title   = lines[0] ?? `Item ${item.index + 1}`
                                const preview = lines.slice(1).join(' ').slice(0, 110)
                                return (
                                  <div
                                    onClick={() => setTextModal({ text: item.text, label: title })}
                                    title="Click to read full text"
                                    style={{ cursor: 'zoom-in', display: 'flex', alignItems: 'flex-start', gap: 4 }}
                                  >
                                    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 2 }}>
                                      <span style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-1)', lineHeight: 1.3 }}>{title}</span>
                                      {preview && <span style={{ fontSize: 10, color: 'var(--text-3)', lineHeight: 1.5 }}>{preview}{preview.length >= 110 ? '…' : ''}</span>}
                                    </div>
                                    <span style={{ fontSize: 9, color: 'var(--text-4)', flexShrink: 0, paddingTop: 2 }}>⊕</span>
                                  </div>
                                )
                              })()}
                              <div style={{ display: 'flex', gap: 5, flexWrap: 'wrap' }}>
                                {item.imageUrl ? (
                                  <>
                                    <button
                                      onClick={() => { const urls = item.allVariations.map(v => v.url); setZoomGallery({ urls, idx: urls.length - 1 }) }}
                                      style={{ fontSize: 9, fontFamily: 'var(--font-mono)', color: 'var(--text-3)', background: 'var(--bg-3)', border: '1px solid var(--line-2)', borderRadius: 4, padding: '3px 8px', cursor: 'pointer' }}
                                    >View image{item.allVariations.length > 1 ? ` (${item.allVariations.length})` : ''}</button>
                                    <button
                                      onClick={() => !item.isGenerating && setVariationItemKey(item.itemKey)}
                                      disabled={item.isGenerating}
                                      style={{ fontSize: 9, fontFamily: 'var(--font-mono)', color: 'var(--action)', background: 'color-mix(in srgb, var(--action) 10%, transparent)', border: '1px solid color-mix(in srgb, var(--action) 25%, transparent)', borderRadius: 4, padding: '3px 8px', cursor: item.isGenerating ? 'default' : 'pointer' }}
                                    >✦ New variation</button>
                                  </>
                                ) : (
                                  <button
                                    onClick={() => !item.isGenerating && item.onGenerate?.()}
                                    disabled={item.isGenerating}
                                    style={{ fontSize: 9, fontFamily: 'var(--font-mono)', color: 'var(--action)', background: 'color-mix(in srgb, var(--action) 10%, transparent)', border: '1px solid color-mix(in srgb, var(--action) 25%, transparent)', borderRadius: 4, padding: '3px 8px', cursor: item.isGenerating ? 'default' : 'pointer' }}
                                  >✦ {item.isGenerating ? 'Generating…' : 'Generate image'}</button>
                                )}
                              </div>
                            </div>
                          </div>
                        ))
                        : parsedItems.map((text, i) => {
                          // Primera línea como título, resto como preview truncada
                          const lines   = text.replace(/\*+/g, '').split('\n').map(l => l.trim()).filter(Boolean)
                          const title   = lines[0] ?? `Item ${i + 1}`
                          const preview = lines.slice(1).join(' ').slice(0, 180)
                          return (
                            <div
                              key={i}
                              onClick={() => setTextModal({ text, label: title })}
                              title="Click to read full content"
                              style={{ flexShrink: 0, background: 'var(--bg-2)', border: '1px solid var(--line-2)', borderRadius: 10, padding: '13px 15px', display: 'flex', flexDirection: 'column', gap: 6, cursor: 'zoom-in', minHeight: 90 }}
                            >
                              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                                <span style={{ fontSize: 8, fontFamily: 'var(--font-mono)', color: 'var(--text-4)', flexShrink: 0 }}>#{i + 1}</span>
                                <span style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-1)', lineHeight: 1.3 }}>{title}</span>
                              </div>
                              {preview && <div style={{ fontSize: 10, color: 'var(--text-3)', lineHeight: 1.55 }}>{preview}{preview.length >= 180 ? '…' : ''}</div>}
                              {!activeOut.image_gen_model && (
                                <div style={{ fontSize: 9, fontFamily: 'var(--font-mono)', color: 'var(--text-4)', marginTop: 2 }}>Set image_gen_model to enable generation</div>
                              )}
                            </div>
                          )
                        })
                      }
                    </div>
                  </div>
                )
              }

              // Vista prosa — markdown normal
              const mdComponents = imageItems.length > 0 ? buildImageGenComponents(imageItems) : MD_COMPONENTS
              return (
                <div style={{ flex: 1, overflowY: 'auto', padding: '20px 28px', fontSize: 12, color: 'var(--text-1)', lineHeight: 1.7 }}>
                  {section ? (
                    <ReactMarkdown remarkPlugins={[remarkGfm]} components={mdComponents}>
                      {/* JSON → markdown legible (solo presentación). Con image items se deja
                          crudo para no romper la inyección de botones ✦. */}
                      {imageItems.length > 0 ? section : forDisplay(section)}
                    </ReactMarkdown>
                  ) : outSession?.output_asset?.storage_url ? (
                    <div style={{ fontSize: 11, fontFamily: 'var(--font-mono)', color: 'var(--text-3)' }}>
                      This asset is stored as a file. Use the download button above to view it.
                    </div>
                  ) : (
                    <div style={{ fontSize: 11, fontFamily: 'var(--font-mono)', color: 'var(--text-3)' }}>No preview available.</div>
                  )}
                </div>
              )
            })()}

            {/* Handle de resize — esquina inferior derecha */}
            {!outMaximized && (
              <div
                onMouseDown={onOutResizeStart}
                style={{ position: 'absolute', bottom: 0, right: 0, width: 18, height: 18, cursor: 'se-resize', display: 'flex', alignItems: 'flex-end', justifyContent: 'flex-end', padding: 4 }}
              >
                <svg width="10" height="10" viewBox="0 0 10 10" style={{ opacity: 0.3 }}>
                  <line x1="2" y1="10" x2="10" y2="2" stroke="var(--text-1)" strokeWidth="1.5" strokeLinecap="round"/>
                  <line x1="5" y1="10" x2="10" y2="5" stroke="var(--text-1)" strokeWidth="1.5" strokeLinecap="round"/>
                  <line x1="8" y1="10" x2="10" y2="8" stroke="var(--text-1)" strokeWidth="1.5" strokeLinecap="round"/>
                </svg>
              </div>
            )}
          </div>

          {/* VariationPanel — lee item vivo del ref para no usar datos stale */}
          {variationItemKey && (() => {
            const liveItem = imageItemsRef.current.find(i => i.itemKey === variationItemKey)
            return liveItem
              ? <VariationPanel item={liveItem} onClose={() => setVariationItemKey(null)} />
              : null
          })()}

          {/* Modal de texto completo con control de tamaño de fuente */}
          {textModal && (
            // Solo se cierra con la ✕. Ni clic afuera ni Esc: al redimensionar se suelta el
            // puntero fuera del panel, y ese gesto terminaba cerrando lo que se estaba agrandando.
            <div
              style={{ position: 'fixed', inset: 0, zIndex: 10004, background: 'rgba(0,0,0,0.72)', backdropFilter: 'blur(4px)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 32 }}
            >
              <div
                onClick={e => e.stopPropagation()}
                // Redimensionable desde la esquina inferior derecha. Se le da un tamaño concreto
                // en vez de `width: 100%` porque `resize` no tiene contra qué tirar si el ancho
                // lo decide el contenedor. Los topes son de viewport: la ficha de un seed con sus
                // comparables y modificadores pide más alto que el 72vh de antes.
                style={{ background: 'var(--bg-1)', border: '1px solid var(--line-2)', borderRadius: 12, width: 620, height: '72vh', minWidth: 320, minHeight: 220, maxWidth: '95vw', maxHeight: '92vh', resize: 'both', display: 'flex', flexDirection: 'column', overflow: 'hidden', boxShadow: '0 24px 64px rgba(0,0,0,0.55)' }}
              >
                <div style={{ padding: '11px 16px', borderBottom: '1px solid var(--line-2)', display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexShrink: 0, gap: 12 }}>
                  <span style={{ fontSize: 10, fontFamily: 'var(--font-mono)', color: 'var(--text-3)', letterSpacing: '0.08em', textTransform: 'uppercase' }}>{textModal.label}</span>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                    <button onClick={() => setTextFontSize(s => Math.max(10, s - 1))} style={{ background: 'var(--bg-3)', border: '1px solid var(--line-2)', borderRadius: 5, color: 'var(--text-1)', fontSize: 13, fontWeight: 700, padding: '3px 9px', cursor: 'pointer', lineHeight: 1 }}>A−</button>
                    <span style={{ fontSize: 10, fontFamily: 'var(--font-mono)', color: 'var(--text-3)', minWidth: 32, textAlign: 'center' }}>{textFontSize}px</span>
                    <button onClick={() => setTextFontSize(s => Math.min(28, s + 1))} style={{ background: 'var(--bg-3)', border: '1px solid var(--line-2)', borderRadius: 5, color: 'var(--text-1)', fontSize: 13, fontWeight: 700, padding: '3px 9px', cursor: 'pointer', lineHeight: 1 }}>A+</button>
                    <button onClick={() => setTextFontSize(14)} style={{ background: 'var(--bg-3)', border: '1px solid var(--line-2)', borderRadius: 5, color: 'var(--text-3)', fontSize: 10, fontFamily: 'var(--font-mono)', padding: '4px 8px', cursor: 'pointer', lineHeight: 1, marginLeft: 2 }} title="Reset font size">↺</button>
                    <button onClick={() => setTextModal(null)} style={{ background: 'none', border: 'none', color: 'var(--text-3)', fontSize: 16, cursor: 'pointer', lineHeight: 1, padding: '0 0 0 8px' }}>✕</button>
                  </div>
                </div>
                {/* El padding inferior deja libre la esquina del grip: sin él, la última línea
                    del texto queda justo debajo y no se puede agarrar. */}
                <div style={{ padding: '20px 24px 26px', overflowY: 'auto', flex: 1, fontSize: textFontSize, lineHeight: 1.75, color: 'var(--text-1)', whiteSpace: 'pre-wrap' }}>
                  {textModal.text}
                </div>
              </div>
            </div>
          )}
        </>,
        document.body
      )}

      {/* Zoom overlay — portal independiente, funciona sin necesidad de outputOpen */}
      {(zoomUrl || zoomGallery) && typeof document !== 'undefined' && createPortal(
        (() => {
          const src      = zoomGallery ? zoomGallery.urls[zoomGallery.idx] : zoomUrl!
          const hasPrev  = zoomGallery && zoomGallery.idx > 0
          const hasNext  = zoomGallery && zoomGallery.idx < zoomGallery.urls.length - 1
          const close    = () => { setZoomUrl(null); setZoomGallery(null) }
          const resetZoom = () => {
            imgScaleRef.current = 1; imgOffsetRef.current = { x: 0, y: 0 }
            setImgScale(1); setImgOffset({ x: 0, y: 0 })
          }
          const navPrev = () => { resetZoom(); setZoomGallery(g => g ? { ...g, idx: g.idx - 1 } : g) }
          const navNext = () => { resetZoom(); setZoomGallery(g => g ? { ...g, idx: g.idx + 1 } : g) }
          const zoomIn  = () => {
            const ns = Math.min(8, imgScaleRef.current * 1.3)
            const f  = ns / imgScaleRef.current
            const no = { x: imgOffsetRef.current.x * f, y: imgOffsetRef.current.y * f }
            imgScaleRef.current = ns; imgOffsetRef.current = no
            setImgScale(ns); setImgOffset({ ...no })
          }
          const zoomOut = () => {
            const os = imgScaleRef.current
            const ns = Math.max(1, os / 1.3)
            imgScaleRef.current = ns
            setImgScale(ns)
            if (ns === 1) {
              imgOffsetRef.current = { x: 0, y: 0 }
              setImgOffset({ x: 0, y: 0 })
            } else {
              const f  = ns / os
              const no = { x: imgOffsetRef.current.x * f, y: imgOffsetRef.current.y * f }
              imgOffsetRef.current = no; setImgOffset({ ...no })
            }
          }
          const btn: React.CSSProperties = {
            background: 'rgba(255,255,255,0.1)', border: '1px solid rgba(255,255,255,0.2)',
            borderRadius: 6, color: '#fff', cursor: 'pointer', lineHeight: 1, flexShrink: 0,
          }
          return (
            <div
              ref={imgOverlayRef}
              onClick={() => { if (imgScaleRef.current <= 1) close() }}
              onMouseDown={e => {
                if (imgScaleRef.current <= 1 || e.button !== 0) return
                e.preventDefault()
                imgDragRef.current = { active: true, startX: e.clientX, startY: e.clientY, startOX: imgOffsetRef.current.x, startOY: imgOffsetRef.current.y }
              }}
              style={{ position: 'fixed', inset: 0, zIndex: 10002, background: 'rgba(0,0,0,0.92)', display: 'flex', alignItems: 'center', justifyContent: 'center', overflow: 'hidden', cursor: imgScale > 1 ? 'grab' : 'zoom-out', userSelect: 'none' }}
            >
              <img
                src={src} alt="" draggable={false}
                style={{ maxWidth: '90vw', maxHeight: '85vh', borderRadius: imgScale > 1 ? 4 : 10, boxShadow: '0 24px 80px rgba(0,0,0,0.7)', display: 'block', pointerEvents: 'none', transform: `translate(${imgOffset.x}px, ${imgOffset.y}px) scale(${imgScale})`, transformOrigin: 'center center', willChange: 'transform' }}
              />
              {hasPrev && <button onClick={e => { e.stopPropagation(); navPrev() }} style={{ ...btn, position: 'absolute', left: 20, top: '50%', transform: 'translateY(-50%)', fontSize: 22, padding: '10px 14px' }}>‹</button>}
              {hasNext && <button onClick={e => { e.stopPropagation(); navNext() }} style={{ ...btn, position: 'absolute', right: 20, top: '50%', transform: 'translateY(-50%)', fontSize: 22, padding: '10px 14px' }}>›</button>}
              <div onClick={e => e.stopPropagation()} style={{ position: 'absolute', bottom: 20, left: '50%', transform: 'translateX(-50%)', display: 'flex', alignItems: 'center', gap: 6 }}>
                {zoomGallery && zoomGallery.urls.length > 1 && (
                  <span style={{ fontSize: 11, fontFamily: 'var(--font-mono)', color: 'rgba(255,255,255,0.6)', background: 'rgba(0,0,0,0.45)', padding: '5px 12px', borderRadius: 99, marginRight: 4 }}>
                    {zoomGallery.idx + 1} / {zoomGallery.urls.length}
                  </span>
                )}
                <button onClick={() => zoomOut()} style={{ ...btn, fontSize: 18, padding: '4px 11px' }} title="Zoom out">−</button>
                <button onClick={() => resetZoom()} style={{ ...btn, fontSize: 10, fontFamily: 'var(--font-mono)', padding: '5px 10px', minWidth: 46, textAlign: 'center', opacity: imgScale === 1 ? 0.45 : 1 }} title="Reset zoom">{Math.round(imgScale * 100)}%</button>
                <button onClick={() => zoomIn()} style={{ ...btn, fontSize: 18, padding: '4px 11px' }} title="Zoom in">+</button>
              </div>
              <button onClick={e => { e.stopPropagation(); close() }} style={{ ...btn, position: 'absolute', top: 20, right: 20, fontSize: 14, padding: '4px 10px' }}>✕</button>
            </div>
          )
        })(),
        document.body
      )}
    </div>
  )
})

// ─── LaneGroupNode ────────────────────────────────────────────────────────────
// Renderiza el contenedor visual de un lane. Siempre detrás de los nodos miembro (zIndex: -1).
// El drag del header mueve todos los nodos miembro simultáneamente.
interface LaneGroupData {
  lane:          ForgeLane
  memberNodeIds: string[]
  onDragEnd:     () => void
  collapsed:     boolean
  onToggle:      () => void
  onDismiss:     () => void
  onRun:         () => void
}

const LaneGroupNode = React.memo(function LaneGroupNode({ data }: { data: LaneGroupData }) {
  const { lane, collapsed, onToggle, onDismiss, onRun } = data
  const [confirming, setConfirming] = React.useState(false)

  const handleStyle = {
    background:    lane.color,
    border:        `2px solid ${lane.color}88`,
    width:         10,
    height:        10,
    pointerEvents: 'none' as const,
  }

  const dismissBtn = confirming ? (
    /* Confirmación inline */
    <span style={{ display: 'flex', alignItems: 'center', gap: 4, pointerEvents: 'all' }}>
      <button
        onClick={e => { e.stopPropagation(); onDismiss() }}
        style={{ background: '#e53e3e', border: 'none', borderRadius: 3, cursor: 'pointer', padding: '1px 5px', color: '#fff', fontSize: 9, lineHeight: 1, pointerEvents: 'all' }}
      >
        Delete
      </button>
      <button
        onClick={e => { e.stopPropagation(); setConfirming(false) }}
        style={{ background: 'none', border: 'none', cursor: 'pointer', padding: '0 2px', color: '#888', fontSize: 9, lineHeight: 1, pointerEvents: 'all' }}
      >
        Cancel
      </button>
    </span>
  ) : (
    <button
      onClick={e => { e.stopPropagation(); setConfirming(true) }}
      style={{ background: 'none', border: 'none', cursor: 'pointer', padding: '0 2px', color: '#555', fontSize: 11, lineHeight: 1, pointerEvents: 'all', display: 'flex', alignItems: 'center' }}
      title="Remove lane"
    >
      ✕
    </button>
  )

  const toggleBtn = (
    <button
      onClick={e => { e.stopPropagation(); setConfirming(false); onToggle() }}
      style={{ background: 'none', border: 'none', cursor: 'pointer', padding: '0 2px', color: lane.color, fontSize: 9, lineHeight: 1, pointerEvents: 'all', display: 'flex', alignItems: 'center' }}
    >
      {collapsed ? '▶' : '▼'}
    </button>
  )

  // Botón ▶ Run — ejecuta solo los nodos de este lane
  const runBtn = (
    <button
      onClick={e => { e.stopPropagation(); setConfirming(false); onRun() }}
      style={{ background: 'none', border: `1px solid ${lane.color}66`, borderRadius: 3, cursor: 'pointer', padding: '0 4px', color: lane.color, fontSize: 8, fontWeight: 700, letterSpacing: '.04em', lineHeight: 1.6, pointerEvents: 'all', display: 'flex', alignItems: 'center', gap: 2 }}
      title={`Run lane ${lane.lane_key}`}
    >
      ▶ Run
    </button>
  )

  return (
    <>
      <Handle type="source" position={Position.Right} id="lane-out" style={handleStyle} />
      <Handle type="target" position={Position.Left}  id="lane-in"  style={handleStyle} />

      {collapsed ? (
        /* Colapsado: strip horizontal con X al extremo derecho */
        <div
          className="lane-drag-handle"
          style={{
            width:         '100%',
            height:        '100%',
            background:    'var(--bg-1)',
            border:        `1px solid ${lane.color}44`,
            borderRadius:  6,
            display:       'flex',
            alignItems:    'center',
            gap:           6,
            padding:       '0 8px',
            cursor:        'grab',
            pointerEvents: 'all',
            userSelect:    'none',
            boxSizing:     'border-box',
          }}
        >
          <div style={{ width: 7, height: 7, borderRadius: '50%', background: lane.color, flexShrink: 0 }} />
          <span style={{ fontSize: 9, fontWeight: 700, letterSpacing: '.06em', textTransform: 'uppercase', color: lane.color, whiteSpace: 'nowrap' }}>
            Lane {lane.lane_key} · {lane.label}
          </span>
          {toggleBtn}
          {runBtn}
          <span style={{ flex: 1 }} />
          {dismissBtn}
        </div>
      ) : (
        /* Expandido: contenedor con header flotante (▼) y X en esquina superior derecha */
        <div
          style={{
            width:         '100%',
            height:        '100%',
            border:        `1px solid ${lane.color}33`,
            borderRadius:  10,
            background:    `${lane.color}05`,
            position:      'relative',
            pointerEvents: 'none',
          }}
        >
          <div
            className="lane-drag-handle"
            style={{
              position:      'absolute',
              top:           -14,
              left:          12,
              display:       'flex',
              alignItems:    'center',
              gap:           6,
              background:    'var(--bg-1)',
              padding:       '0 8px',
              cursor:        'grab',
              pointerEvents: 'all',
              userSelect:    'none',
            }}
          >
            <div style={{ width: 7, height: 7, borderRadius: '50%', background: lane.color, flexShrink: 0 }} />
            <span style={{ fontSize: 9, fontWeight: 700, letterSpacing: '.06em', textTransform: 'uppercase', color: lane.color, whiteSpace: 'nowrap' }}>
              Lane {lane.lane_key} · {lane.label}
            </span>
            {toggleBtn}
            {runBtn}
          </div>
          {/* X en esquina superior derecha del contenedor */}
          <div style={{ position: 'absolute', top: 6, right: 8, pointerEvents: 'all' }}>
            {dismissBtn}
          </div>
        </div>
      )}
    </>
  )
})

const NODE_TYPES = { forgeNode: ForgeNodeCard, assetNode: AssetNodeCard, textInputNode: TextInputCard, laneGroup: LaneGroupNode }
const EDGE_TYPES = { forgeEdge: ForgeEdge, orthogonalEdge: OrthogonalEdge }

// ─── ImportAsOutputButton ─────────────────────────────────────────────────────

// (NodeInputsPanel eliminado — inputs se manejan via asset-nodes en el canvas)

// ─── ImportAsOutputButton ─────────────────────────────────────────────────────

// ─── Avance de un render de deck ─────────────────────────────────────────────
// El despacho ya no viaja en la respuesta: la ruta contesta enseguida y el trabajo sigue en el
// servidor. El avance se lee de la sesión, donde cada página se anota apenas llega — así el
// progreso es REAL, y cerrar esto (o la pestaña) no cancela nada.
// ── Despachos vivos ──────────────────────────────────────────────────────────
// Un deck tarda ~4 minutos del lado del servidor y este componente no sobrevive a cerrar el modal:
// el botón volvía a quedar habilitado con el render todavía corriendo, que es justo lo que llevó a
// despachar tres veces lo mismo. Se anota en localStorage y se limpia cuando la sesión deja de
// estar activa, así el bloqueo aguanta cerrar el modal e incluso recargar.
const CLAVE_DESPACHOS = 'forge:renders'
const VENCE_DESPACHO  = 30 * 60 * 1000   // más que cualquier deck; evita bloqueos eternos
type Despacho = { esperadas: number; desde: number }

function leerDespachos(): Record<string, Despacho> {
  if (typeof localStorage === 'undefined') return {}
  try {
    const raw = JSON.parse(localStorage.getItem(CLAVE_DESPACHOS) || '{}') as Record<string, Despacho>
    const vivos: Record<string, Despacho> = {}
    for (const [k, v] of Object.entries(raw)) if (Date.now() - (v?.desde ?? 0) < VENCE_DESPACHO) vivos[k] = v
    return vivos
  } catch { return {} }
}
function guardarDespachos(t: Record<string, Despacho>) {
  try { localStorage.setItem(CLAVE_DESPACHOS, JSON.stringify(t)) } catch { /* modo privado */ }
}

// Confirmación antes de gastar. Los dos botones van separados y el destructivo no es el que queda
// bajo el cursor: el clic accidental fue el que costó tres despachos en paralelo.
function ConfirmarRender({ etiqueta, cuantas, onCancel, onOk }: {
  etiqueta: string; cuantas: number; onCancel: () => void; onOk: () => void
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onCancel() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onCancel])

  return (
    <div onClick={onCancel} style={{
      position: 'fixed', inset: 0, zIndex: 16000, display: 'flex',
      alignItems: 'center', justifyContent: 'center',
      background: 'rgba(6,7,9,0.55)', backdropFilter: 'blur(3px)',
    }}>
      <div onClick={e => e.stopPropagation()} style={{
        width: 400, padding: '18px 20px', borderRadius: 12,
        background: 'var(--bg-3)', border: '1px solid var(--line-2)',
        boxShadow: '0 22px 64px rgba(0,0,0,0.6)',
      }}>
        <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-0)', marginBottom: 3 }}>
          Render {cuantas ? `${cuantas} image${cuantas > 1 ? 's' : ''}` : 'this output'}?
        </div>
        <div style={{ fontSize: 11, color: 'var(--text-3)', fontFamily: 'var(--font-mono)', marginBottom: 12 }}>
          {etiqueta}
        </div>
        <div style={{ fontSize: 11.5, color: 'var(--text-2)', lineHeight: 1.55, marginBottom: 16 }}>
          This spends credit and cannot be undone. Image generation is not reproducible — a second
          run returns different images, not the same ones.
        </div>
        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
          <button onClick={onCancel} style={{
            padding: '6px 14px', borderRadius: 6, cursor: 'pointer',
            background: 'transparent', border: '1px solid var(--line-2)',
            color: 'var(--text-2)', fontSize: 11, fontFamily: 'var(--font-mono)',
          }}>Cancel</button>
          <button onClick={onOk} style={{
            padding: '6px 14px', borderRadius: 6, cursor: 'pointer',
            background: '#F59E0B', border: '1px solid #F59E0B',
            color: '#000', fontSize: 11, fontFamily: 'var(--font-mono)', fontWeight: 700,
          }}>▶ Render</button>
        </div>
      </div>
    </div>
  )
}

function RenderProgress({ projectId, nodeId, projectNodeId, outputKey, esperadas, error, onClose, onDone, onSettled }: {
  projectId: string; nodeId: string; projectNodeId: string; outputKey: string
  esperadas: number; error?: string; onClose: () => void; onDone: (imgs: OutputImagesMap) => void
  onSettled?: () => void
}) {
  const [hechas, setHechas] = useState(0)
  const [estado, setEstado] = useState<string>('active')
  const avisado = useRef(false)

  useEffect(() => {
    if (error) return
    let vivo = true
    const mirar = async () => {
      try {
        const r = await getNodeSession(projectId, nodeId, outputKey, projectNodeId)
        if (!vivo) return
        const n = r.session?.output_images?.[outputKey]?.length ?? 0
        setHechas(n)
        setEstado(r.session?.status ?? 'active')
        const st = r.session?.status
        if ((st === 'auto_approved' || st === 'approved') && !avisado.current) {
          avisado.current = true
          onDone(r.session?.output_images ?? {})
          onSettled?.()
        }
        // Un despacho abandonado también cierra: si no, el botón queda bloqueado hasta que venza.
        if (st === 'abandoned' && !avisado.current) { avisado.current = true; onSettled?.() }
      } catch { /* una consulta perdida no rompe el seguimiento */ }
    }
    mirar()
    const t = setInterval(mirar, 4000)
    return () => { vivo = false; clearInterval(t) }
  }, [projectId, nodeId, projectNodeId, outputKey, error, onDone, onSettled])

  const listo   = estado === 'auto_approved' || estado === 'approved'
  const fallo   = !!error || estado === 'abandoned'
  const pct     = esperadas ? Math.round((hechas / esperadas) * 100) : 0

  return (
    <div onClick={e => e.stopPropagation()} style={{
      // Por encima del modal de outputs (10001) y del resto de las capas del canvas: es el panel
      // que dice si el render avanza, y quedaba tapado justo por la ventana desde donde se lanza.
      position: 'fixed', inset: 0, zIndex: 16000, display: 'flex',
      alignItems: 'center', justifyContent: 'center',
      background: 'rgba(6,7,9,0.55)', backdropFilter: 'blur(3px)',
    }}>
      <div style={{
        width: 400, padding: '18px 20px', borderRadius: 12,
        background: 'var(--bg-3)', border: '1px solid var(--line-2)',
        boxShadow: '0 22px 64px rgba(0,0,0,0.6)',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 3 }}>
          <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-0)' }}>
            {fallo ? 'Render failed' : listo ? 'Render complete' : 'Rendering'}
          </span>
          <div style={{ flex: 1 }} />
          <button onClick={onClose} title="Close" style={{
            width: 24, height: 24, borderRadius: 6, cursor: 'pointer',
            background: 'transparent', border: '1px solid var(--line-2)',
            color: 'var(--text-2)', fontSize: 13, lineHeight: 1,
          }}>×</button>
        </div>
        <div style={{ fontSize: 11, color: 'var(--text-3)', fontFamily: 'var(--font-mono)', marginBottom: 13 }}>
          {outputKey}
        </div>

        {fallo ? (
          <div style={{ fontSize: 11.5, color: 'var(--text-2)', lineHeight: 1.55 }}>
            {error || 'The dispatch did not complete. The node chat has the reason.'}
          </div>
        ) : (
          <>
            <div style={{ height: 5, borderRadius: 3, overflow: 'hidden', background: 'rgba(255,255,255,0.07)', marginBottom: 8 }}>
              <div style={{
                width: `${pct}%`, height: '100%', borderRadius: 3,
                background: 'linear-gradient(90deg, #F59E0B88, #F59E0B)',
                transition: 'width 400ms ease',
              }} />
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 10.5 }}>
              <span style={{ color: 'var(--text-4)' }}>
                {listo ? 'All pages rendered.' : 'Pages arrive as they finish — closing this does not stop it.'}
              </span>
              <span style={{ color: 'var(--text-3)', fontFamily: 'var(--font-mono)' }}>{hechas}/{esperadas}</span>
            </div>
          </>
        )}
      </div>
    </div>
  )
}

function ImportAsOutputButton({ projectId, canvasNode, onImported }: {
  projectId:  string
  canvasNode: CanvasNode
  onImported: () => void
}) {
  const [open,    setOpen]    = useState(false)
  const [assets,  setAssets]  = useState<LibraryAsset[]>([])
  const [assetId, setAssetId] = useState('')
  const [saving,  setSaving]  = useState(false)
  const [error,   setError]   = useState<string | null>(null)

  async function openPicker() {
    try {
      const data = await canvasFetch(`/api/projects/${projectId}/library`) as { assets?: LibraryAsset[] }
      setAssets(data.assets ?? [])
      setOpen(true)
    } catch { setError('Failed to load library') }
  }

  async function handleImport() {
    if (!assetId || !canvasNode.node) return
    setSaving(true)
    setError(null)
    try {
      await canvasFetch(`/api/projects/${projectId}/canvas/nodes/${canvasNode.node.id}/import-as-output`, {
        method: 'POST',
        body: JSON.stringify({ asset_id: assetId }),
      })
      setOpen(false)
      onImported()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Import failed')
    } finally { setSaving(false) }
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      {error && <div style={{ fontSize: 10, fontFamily: 'var(--font-mono)', color: '#F87171' }}>{error}</div>}
      {open ? (
        <div style={{ background: 'var(--bg-0)', border: '1px solid var(--line-2)', borderRadius: 7, padding: '10px 10px 8px', display: 'flex', flexDirection: 'column', gap: 8 }}>
          <div style={{ fontSize: 9, fontFamily: 'var(--font-mono)', color: 'var(--text-3)', textTransform: 'uppercase', letterSpacing: '.08em' }}>Import from library as output</div>
          <select
            value={assetId}
            onChange={e => setAssetId(e.target.value)}
            style={{ width: '100%', background: 'var(--bg-1)', border: '1px solid var(--line-2)', borderRadius: 5, color: 'var(--text-1)', fontSize: 10, fontFamily: 'var(--font-mono)', padding: '5px 8px', outline: 'none' }}
          >
            <option value="">— select asset —</option>
            {assets.map(a => <option key={a.id} value={a.id}>{a.display_name}</option>)}
          </select>
          <div style={{ display: 'flex', gap: 6 }}>
            <button
              onClick={handleImport}
              disabled={saving || !assetId}
              style={{ flex: 1, padding: '5px 0', borderRadius: 5, border: 'none', background: 'var(--action)', color: 'var(--action-fg)', fontSize: 10, fontFamily: 'var(--font-mono)', fontWeight: 700, cursor: saving || !assetId ? 'not-allowed' : 'pointer', opacity: saving || !assetId ? 0.5 : 1 }}
            >
              {saving ? '⟳' : 'Import'}
            </button>
            <button
              onClick={() => { setOpen(false); setAssetId('') }}
              style={{ flex: 1, padding: '5px 0', borderRadius: 5, border: '1px solid var(--line-2)', background: 'transparent', color: 'var(--text-3)', fontSize: 10, fontFamily: 'var(--font-mono)', cursor: 'pointer' }}
            >
              Cancel
            </button>
          </div>
        </div>
      ) : (
        <button
          onClick={openPicker}
          style={{
            width: '100%', height: 30, borderRadius: 5, fontSize: 10, fontFamily: 'var(--font-mono)',
            border: '1px solid var(--line-2)', background: 'transparent', color: 'var(--text-3)',
            cursor: 'pointer', transition: 'all 100ms',
          }}
          onMouseEnter={e => { e.currentTarget.style.borderColor = 'var(--action)'; e.currentTarget.style.color = 'var(--action)' }}
          onMouseLeave={e => { e.currentTarget.style.borderColor = 'var(--line-2)'; e.currentTarget.style.color = 'var(--text-3)' }}
        >
          ↑ Import from library
        </button>
      )}
    </div>
  )
}

// ─── ForgeNodePanel ───────────────────────────────────────────────────────────

function Section({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <div style={{ fontFamily: 'var(--font-mono)', fontSize: 9, color: 'var(--text-3)', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 6 }}>
        {label}
      </div>
      {children}
    </div>
  )
}

function CollapsibleSection({ label, count, children }: { label: string; count?: number; children: React.ReactNode }) {
  const [open, setOpen] = useState(false)
  return (
    <div style={{ border: '1px solid var(--line-2)', borderRadius: 6, overflow: 'hidden' }}>
      <button
        onClick={() => setOpen(v => !v)}
        style={{
          width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          padding: '6px 10px', background: 'var(--bg-2)', border: 'none', cursor: 'pointer',
          fontFamily: 'var(--font-mono)', fontSize: 9, color: 'var(--text-3)',
          textTransform: 'uppercase', letterSpacing: '0.08em',
        }}
      >
        <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          {label}
          {count != null && count > 0 && (
            <span style={{ background: 'var(--bg-3)', border: '1px solid var(--line-2)', borderRadius: 3, padding: '0 4px', fontSize: 8, color: 'var(--text-4)' }}>{count}</span>
          )}
        </span>
        <span style={{ fontSize: 8, opacity: 0.6 }}>{open ? '▲' : '▼'}</span>
      </button>
      {open && (
        <div style={{ padding: '8px 10px', background: 'var(--bg-1)' }}>
          {children}
        </div>
      )}
    </div>
  )
}

function MonoPair({ k, v, color }: { k: string; v: string; color?: string }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', fontFamily: 'var(--font-mono)', fontSize: 10, gap: 6 }}>
      <span style={{ color: 'var(--text-3)' }}>{k}</span>
      <span style={{ color: color ?? 'var(--text-1)', textAlign: 'right' }}>{v}</span>
    </div>
  )
}

const PANEL_POS_KEY = 'forge_node_panel_pos'

function ForgeNodePanel({ canvasNode, onClose, onRemove, onRun, onImportedAsOutput, removing, locked, projectId, canvasNodes, edges }: {
  canvasNode:          CanvasNode
  onClose:             () => void
  onRemove:            () => void
  onRun:               () => void
  onImportedAsOutput:  () => void
  removing:            boolean
  locked:              boolean
  projectId:           string
  canvasNodes:         CanvasNode[]
  edges:               Edge[]
}) {
  const [confirmRemove, setConfirmRemove] = useState(false)
  const [pos, setPos] = useState<{ x: number; y: number }>(() => {
    if (typeof window === 'undefined') return { x: 0, y: 80 }
    try {
      const saved = localStorage.getItem(PANEL_POS_KEY)
      if (saved) {
        const p = JSON.parse(saved)
        return {
          x: Math.max(0, Math.min(window.innerWidth  - 340, p.x)),
          y: Math.max(0, Math.min(window.innerHeight - 200, p.y)),
        }
      }
    } catch {}
    return { x: Math.max(0, window.innerWidth - 360), y: 80 }
  })
  const draggingRef  = useRef(false)
  const offsetRef    = useRef({ x: 0, y: 0 })

  useEffect(() => {
    function onMouseMove(e: MouseEvent) {
      if (!draggingRef.current) return
      setPos({
        x: Math.max(0, Math.min(window.innerWidth  - 340, e.clientX - offsetRef.current.x)),
        y: Math.max(0, Math.min(window.innerHeight - 200, e.clientY - offsetRef.current.y)),
      })
    }
    function onMouseUp() {
      if (!draggingRef.current) return
      draggingRef.current = false
      setPos(prev => { localStorage.setItem(PANEL_POS_KEY, JSON.stringify(prev)); return prev })
    }
    window.addEventListener('mousemove', onMouseMove)
    window.addEventListener('mouseup',   onMouseUp)
    return () => {
      window.removeEventListener('mousemove', onMouseMove)
      window.removeEventListener('mouseup',   onMouseUp)
    }
  }, [])

  function onHeaderMouseDown(e: React.MouseEvent) {
    if ((e.target as HTMLElement).closest('button')) return
    draggingRef.current = true
    offsetRef.current   = { x: e.clientX - pos.x, y: e.clientY - pos.y }
    e.preventDefault()
  }

  const { node, session } = canvasNode
  if (!node) return null
  // Misma regla que en la tarjeta: los outputs aprobados ganan sobre una sesión general suelta.
  const _panelAllOuts = (node.outputs ?? []).filter((o) => (o as unknown as { production?: string }).production !== 'deferred')
  const _panelAllDone = _panelAllOuts.length > 0 && _panelAllOuts.every((o: { key?: string }) => {
    const s = (canvasNode.output_sessions ?? {})[(o.key ?? '')]
    return s?.status === 'approved' || s?.status === 'auto_approved'
  })
  const effectiveStatus: string | null = _panelAllDone
    ? (_panelAllOuts.some((o: { key?: string }) => (canvasNode.output_sessions ?? {})[(o.key ?? '')]?.status === 'auto_approved') ? 'auto_approved' : 'approved')
    : (session?.status ?? null)
  const statusColor = effectiveStatus ? (SESSION_COLOR[effectiveStatus] ?? 'var(--text-3)') : null
  const phaseColor  = PHASE_COLOR[node.phase] ?? 'var(--text-3)'

  return (
    <div style={{
      position: 'fixed', left: pos.x, top: pos.y, width: 340, zIndex: 50,
      maxHeight: 'calc(100vh - 100px)',
      background: 'var(--bg-1)', border: '1px solid var(--line-2)',
      borderRadius: 10,
      boxShadow: '0 8px 40px rgba(0,0,0,0.45)',
      display: 'flex', flexDirection: 'column', overflow: 'hidden',
    }}>
      {/* Header — arrastrable */}
      <div
        onMouseDown={onHeaderMouseDown}
        style={{ padding: '12px 14px 12px', borderBottom: '1px solid var(--line-2)', flexShrink: 0, cursor: 'grab', userSelect: 'none' }}
      >
        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 10, marginBottom: 9 }}>
            {/* Grip — mano abierta blanca, igual al cursor grab del browser */}
            <span style={{ fontSize: 15, flexShrink: 0, lineHeight: 1, opacity: 0.55, userSelect: 'none', filter: 'brightness(0) invert(1)' }}>🖐️</span>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 9, fontFamily: 'var(--font-mono)', color: 'var(--text-3)', marginBottom: 3 }}>{node.node_key}</div>
              <div style={{ fontSize: 15, fontWeight: 700, color: 'var(--text-0)', lineHeight: 1.2 }}>{node.title}</div>
            </div>
            <button onClick={onClose} style={{ border: 'none', background: 'var(--bg-2)', cursor: 'pointer', color: 'var(--text-2)', fontSize: 14, padding: '5px 8px', borderRadius: 6, flexShrink: 0, lineHeight: 1 }}>✕</button>
          </div>
          <div style={{ display: 'flex', gap: 5, flexWrap: 'wrap' }}>
            <span style={{ fontSize: 9, fontFamily: 'var(--font-mono)', color: phaseColor, background: `color-mix(in srgb, ${phaseColor} 12%, var(--bg-2))`, border: `1px solid color-mix(in srgb, ${phaseColor} 28%, transparent)`, padding: '2px 7px', borderRadius: 3 }}>
              {node.phase}
            </span>
            {node.executor?.type && (
              <span style={{ fontSize: 9, fontFamily: 'var(--font-mono)', color: 'var(--text-3)', background: 'var(--bg-3)', border: '1px solid var(--line-2)', padding: '2px 7px', borderRadius: 3 }}>
                {EXECUTOR_LABEL[node.executor.type] ?? node.executor.type}
                {node.executor.model ? ` · ${node.executor.model}` : ''}
              </span>
            )}
            {/* El estado del NODO, no el de la sesión general: con los outputs aprobados el nodo
                está aprobado aunque quede una sesión suelta en `active`. El bloque "Last Session"
                de más abajo sí muestra el estado crudo de esa sesión, que es lo que describe. */}
            {effectiveStatus && statusColor && (
              <span style={{ fontSize: 9, fontFamily: 'var(--font-mono)', color: statusColor, background: `color-mix(in srgb, ${statusColor} 10%, var(--bg-2))`, border: `1px solid color-mix(in srgb, ${statusColor} 28%, transparent)`, padding: '2px 7px', borderRadius: 3 }}>
                ● {effectiveStatus}
              </span>
            )}
          </div>
        </div>

        {/* Contenido scrollable */}
        <div style={{ flex: 1, overflowY: 'auto', padding: '14px 16px', display: 'flex', flexDirection: 'column', gap: 14 }}>

          {node.purpose && (
            <Section label="Purpose">
              <div style={{ fontSize: 11, color: 'var(--text-1)', lineHeight: 1.65, background: 'var(--bg-2)', border: '1px solid var(--line-2)', borderRadius: 6, padding: '8px 10px' }}>
                {node.purpose}
              </div>
            </Section>
          )}

          <CollapsibleSection label="Inputs">
            {(() => {
              const incomingEdges = edges.filter(e => e.target === canvasNode.project_node_id)
              const seenIncoming = new Set<string>()
              const incomingRows = incomingEdges
                .map(e => ({ edgeId: e.id, sourceHandle: e.sourceHandle, cn: canvasNodes.find(cn => cn.project_node_id === e.source) }))
                .filter(r => {
                  if (!r.cn) return false
                  const key = `${r.cn.project_node_id}|${r.sourceHandle ?? ''}`
                  if (seenIncoming.has(key)) return false
                  seenIncoming.add(key)
                  return true
                }) as { edgeId: string; sourceHandle?: string | null; cn: CanvasNode }[]
              if (incomingRows.length === 0) return (
                <div style={{ fontSize: 10, fontFamily: 'var(--font-mono)', color: 'var(--text-4)', lineHeight: 1.6 }}>
                  No inputs connected.
                </div>
              )
              return (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                  {incomingRows.map(({ edgeId, sourceHandle, cn }) => {
                    const isAsset = cn.node_type === 'library_asset'
                    const isText  = cn.node_type === 'text_input'
                    const icon    = isAsset ? (ASSET_TYPE_ICON[cn.asset?.asset_type ?? 'other'] ?? '📎') : isText ? 'T' : '⬡'
                    const label   = isAsset ? (cn.asset?.display_name ?? '—') : isText ? (cn.text_label ?? 'Text Input') : (cn.node?.title ?? '—')
                    const slotLabel = (() => {
                      if (!sourceHandle?.startsWith('out-')) return null
                      const handleVal = sourceHandle.slice(4)
                      const outputs = cn.node?.outputs as { name: string; label?: string; key?: string; format: string }[] | undefined
                      const out = outputs?.find(o => (o.key || o.name) === handleVal) ?? outputs?.[parseInt(handleVal, 10)]
                      return (out as {label?:string})?.label || out?.name || null
                    })()
                    const sub = isAsset ? (cn.asset?.asset_type ?? '') : isText ? 'text input' : slotLabel ? `${cn.node?.node_key ?? ''} → ${slotLabel}` : (cn.node?.node_key ?? '')
                    return (
                      <div key={edgeId} style={{ display: 'flex', alignItems: 'center', gap: 7, background: 'var(--bg-2)', border: '1px solid var(--line-2)', borderRadius: 6, padding: '5px 8px' }}>
                        <span style={{ fontSize: isText ? 10 : 12, fontFamily: isText ? 'var(--font-mono)' : undefined, fontWeight: isText ? 700 : undefined, color: isText ? ASSET_NODE_CLR : undefined, flexShrink: 0 }}>{icon}</span>
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{ fontSize: 10, fontFamily: 'var(--font-mono)', color: 'var(--text-1)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{label}</div>
                          {sub && <div style={{ fontSize: 8, fontFamily: 'var(--font-mono)', color: 'var(--text-3)', marginTop: 1 }}>{sub}</div>}
                        </div>
                        {isAsset && (
                          <span style={{ fontSize: 8, fontFamily: 'var(--font-mono)', color: ASSET_NODE_CLR, background: `color-mix(in srgb,${ASSET_NODE_CLR} 12%,transparent)`, border: `1px solid color-mix(in srgb,${ASSET_NODE_CLR} 25%,transparent)`, padding: '1px 5px', borderRadius: 3 }}>asset</span>
                        )}
                      </div>
                    )
                  })}
                </div>
              )
            })()}
          </CollapsibleSection>

          {Array.isArray(node.outputs) && node.outputs.length > 0 && (
            <CollapsibleSection label="Outputs" count={node.outputs.length}>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                {node.outputs.map((out, i) => {
                  const outLabel = (out as {label?:string}).label || (out as {key?:string}).key || out.name || '—'
                  const outDesc  = (out as {description?:string}).description
                  const outType  = (out as {type?:string}).type
                  return (
                    <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 7, background: 'var(--bg-2)', border: '1px solid var(--line-2)', borderRadius: 6, padding: '5px 8px' }}>
                      <span style={{ fontSize: 8, color: out.optional ? 'var(--text-3)' : '#34D399', flexShrink: 0 }}>→</span>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontSize: 10, fontFamily: 'var(--font-mono)', color: out.optional ? 'var(--text-2)' : 'var(--text-1)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{outLabel}</div>
                        {(outType || out.format || outDesc) && (
                          <div style={{ fontSize: 8, fontFamily: 'var(--font-mono)', color: 'var(--text-3)', marginTop: 1 }}>
                            {[outType, out.format, outDesc].filter(Boolean).join(' · ')}
                          </div>
                        )}
                      </div>
                      {out.optional && (
                        <span style={{ fontSize: 7, fontFamily: 'var(--font-mono)', color: 'var(--text-4)', background: 'var(--bg-3)', border: '1px solid var(--line-2)', padding: '1px 4px', borderRadius: 3, flexShrink: 0 }}>opt</span>
                      )}
                    </div>
                  )
                })}
              </div>
            </CollapsibleSection>
          )}

          {node.tools?.length > 0 && (
            <CollapsibleSection label="Tools" count={node.tools.length}>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
                {node.tools.map((t, i) => (
                  <span key={i} style={{ fontSize: 9, fontFamily: 'var(--font-mono)', background: 'var(--bg-3)', border: '1px solid var(--line-2)', borderRadius: 3, padding: '2px 7px', color: 'var(--text-2)' }}>{String(t)}</span>
                ))}
              </div>
            </CollapsibleSection>
          )}

          {node.skills?.length > 0 && (
            <CollapsibleSection label="Skills" count={node.skills.length}>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
                {node.skills.map((s, i) => (
                  <span key={i} style={{ fontSize: 9, fontFamily: 'var(--font-mono)', background: 'var(--bg-3)', border: '1px solid var(--line-2)', borderRadius: 3, padding: '2px 7px', color: 'var(--text-2)' }}>{String(s)}</span>
                ))}
              </div>
            </CollapsibleSection>
          )}

          {session && (
            <Section label="Last Session">
              <div style={{ background: 'var(--bg-2)', border: '1px solid var(--line-2)', borderRadius: 6, padding: '8px 10px', display: 'flex', flexDirection: 'column', gap: 5 }}>
                <MonoPair k="status" v={session.status} color={statusColor ?? undefined} />
                {session.iteration_count > 0 && <MonoPair k="iterations" v={String(session.iteration_count)} />}
                {session.started_at   && <MonoPair k="started"   v={new Date(session.started_at).toLocaleDateString()}   />}
                {session.completed_at && <MonoPair k="completed" v={new Date(session.completed_at).toLocaleDateString()} />}
              </div>
            </Section>
          )}
        </div>

        {/* Footer */}
        <div style={{ padding: '12px 16px', borderTop: '1px solid var(--line-2)', flexShrink: 0, display: 'flex', flexDirection: 'column', gap: 6 }}>
          {effectiveStatus !== 'approved' && effectiveStatus !== 'auto_approved' && !locked && (
            <ImportAsOutputButton projectId={projectId} canvasNode={canvasNode} onImported={onImportedAsOutput} />
          )}
          {(() => {
            const approved = effectiveStatus === 'approved' || effectiveStatus === 'auto_approved'
            if (locked) return (
              <button disabled title="Approve the previous node first" style={{
                width: '100%', height: 32, borderRadius: 5, fontSize: 12, fontWeight: 600,
                border: '1px solid transparent', cursor: 'not-allowed',
                background: 'var(--bg-4)', color: 'var(--text-4)',
              }}>
                🔒 Locked
              </button>
            )
            if (approved) return (
              <button onClick={onRun} style={{
                width: '100%', height: 32, borderRadius: 5, fontSize: 12, fontWeight: 600,
                border: '1px solid #34D39944', cursor: 'pointer',
                background: 'color-mix(in srgb, #34D399 12%, var(--bg-2))',
                color: '#34D399', transition: 'all 120ms',
              }}>
                ◎ View output
              </button>
            )
            return (
              <button onClick={onRun} style={{
                width: '100%', height: 32, borderRadius: 5, fontSize: 12, fontWeight: 600,
                border: '1px solid transparent', cursor: 'pointer',
                background: 'var(--action)', color: 'var(--action-fg)', transition: 'all 120ms',
              }}>
                ▶ Run node
              </button>
            )
          })()}
          {(effectiveStatus === 'approved' || effectiveStatus === 'auto_approved') ? (
            <div style={{
              height: 32, borderRadius: 5, display: 'flex', alignItems: 'center', justifyContent: 'center',
              fontSize: 10, fontFamily: 'var(--font-mono)', color: 'var(--text-4)',
              border: '1px solid var(--line-2)', background: 'var(--bg-2)',
              letterSpacing: '.04em',
            }}>
              Approved nodes cannot be removed
            </div>
          ) : confirmRemove ? (
            <div style={{ display: 'flex', gap: 6 }}>
              <button
                onClick={() => { setConfirmRemove(false); onRemove() }}
                disabled={removing}
                style={{
                  flex: 1, height: 32, borderRadius: 5, cursor: removing ? 'not-allowed' : 'pointer',
                  fontSize: 11, opacity: removing ? 0.5 : 1,
                  background: '#EF4444', color: '#fff',
                  border: 'none', fontWeight: 600,
                  transition: 'opacity 100ms',
                }}
              >
                {removing ? '⟳ Removing…' : 'Confirm remove'}
              </button>
              <button
                onClick={() => setConfirmRemove(false)}
                disabled={removing}
                style={{
                  flex: 1, height: 32, borderRadius: 5, cursor: 'pointer',
                  fontSize: 11, background: 'var(--bg-2)',
                  color: 'var(--text-2)', border: '1px solid var(--line-2)',
                }}
              >
                Cancel
              </button>
            </div>
          ) : (
            <button
              onClick={() => setConfirmRemove(true)}
              disabled={removing}
              style={{
                width: '100%', height: 32, borderRadius: 5, cursor: removing ? 'not-allowed' : 'pointer',
                fontSize: 11, opacity: removing ? 0.5 : 1,
                background: 'color-mix(in srgb, #EF4444 8%, var(--bg-2))',
                color: '#EF4444',
                border: '1px solid color-mix(in srgb, #EF4444 30%, transparent)',
                transition: 'opacity 100ms',
              }}
            >
              ✕ Remove from canvas
            </button>
          )}
        </div>
    </div>
  )
}

// ─── BlueprintBar ─────────────────────────────────────────────────────────────

function BlueprintBar({ activeBlueprint, projectId, onLoaded, projectName, isOwner, onNameChange }: {
  activeBlueprint: CanvasData['active_blueprint']
  projectId: string
  onLoaded: () => void
  projectName: string
  isOwner: boolean
  onNameChange?: (name: string) => Promise<void>
}) {
  const [loading,    setLoading]    = useState(false)
  const [blueprints, setBlueprints] = useState<{ id: string; name: string; blueprint_key: string }[]>([])
  const [showPicker, setShowPicker] = useState(false)
  const [editing,    setEditing]    = useState(false)
  const [nameVal,    setNameVal]    = useState('')
  const [saving,     setSaving]     = useState(false)
  const nameRef = useRef<HTMLInputElement>(null)

  function startEdit() {
    if (!isOwner || !onNameChange) return
    setNameVal(projectName)
    setEditing(true)
    setTimeout(() => { nameRef.current?.select() }, 0)
  }

  async function commitEdit() {
    const trimmed = nameVal.trim()
    if (!trimmed || trimmed === projectName) { setEditing(false); return }
    setSaving(true)
    try { await onNameChange?.(trimmed) } finally { setSaving(false); setEditing(false) }
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Enter')  { e.preventDefault(); commitEdit() }
    if (e.key === 'Escape') { setEditing(false) }
  }

  async function openPicker() {
    if (!showPicker) {
      try {
        const res = await canvasFetch<{ success: boolean; blueprints: typeof blueprints }>(`/api/projects/${projectId}/canvas/blueprints`)
        setBlueprints(res.blueprints ?? [])
      } catch { /* noop */ }
    }
    setShowPicker(p => !p)
  }

  async function loadBlueprint(bpId: string) {
    setLoading(true)
    setShowPicker(false)
    try {
      await canvasFetch(`/api/projects/${projectId}/canvas/load-blueprint`, {
        method: 'POST',
        body: JSON.stringify({ blueprint_id: bpId, trigger: 'manual' }),
      })
      onLoaded()
    } catch (e) {
      console.error('[forge-canvas] blueprint load failed', e)
    } finally {
      setLoading(false)
    }
  }

  return (
    <div style={{ flexShrink: 0, height: 40, borderBottom: '1px solid var(--line-2)', background: 'var(--bg-1)', display: 'flex', alignItems: 'center', gap: 10, padding: '0 16px' }}>
      {/* Izquierda — info del blueprint */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0, flex: '0 1 auto' }}>
        {activeBlueprint ? (
          <>
            <span style={{ fontSize: 9, fontFamily: 'var(--font-mono)', color: 'var(--text-3)', textTransform: 'uppercase', letterSpacing: '0.08em', flexShrink: 0 }}>Blueprint</span>
            <span style={{ fontSize: 11, fontFamily: 'var(--font-mono)', color: 'var(--text-1)', fontWeight: 600, whiteSpace: 'nowrap' }}>{activeBlueprint.name}</span>
            <span style={{ fontSize: 9, fontFamily: 'var(--font-mono)', color: 'var(--text-3)', background: 'var(--bg-2)', border: '1px solid var(--line-2)', padding: '2px 6px', borderRadius: 3, flexShrink: 0 }}>
              {activeBlueprint.blueprint_key}
            </span>
          </>
        ) : (
          <span style={{ fontSize: 11, fontFamily: 'var(--font-mono)', color: 'var(--text-3)' }}>No blueprint loaded</span>
        )}
      </div>

      {/* Centro — nombre del proyecto */}
      <div style={{ flex: 1, display: 'flex', justifyContent: 'center', alignItems: 'center' }}>
        {editing ? (
          <input
            ref={nameRef}
            value={nameVal}
            onChange={e => setNameVal(e.target.value)}
            onKeyDown={onKeyDown}
            onBlur={() => setEditing(false)}
            disabled={saving}
            style={{
              fontFamily: 'var(--font-mono)', fontSize: 13, fontWeight: 600,
              color: 'var(--text-0)', background: 'var(--bg-2)',
              border: '1px solid var(--action)', borderRadius: 4,
              padding: '3px 8px', outline: 'none', textAlign: 'center',
              width: Math.max(160, nameVal.length * 8),
              maxWidth: 360,
            }}
          />
        ) : (
          <span
            onClick={isOwner && onNameChange ? startEdit : undefined}
            title={isOwner && onNameChange ? 'Click to rename' : undefined}
            style={{
              fontFamily: 'var(--font-mono)', fontSize: 13, fontWeight: 600,
              color: 'var(--text-0)', whiteSpace: 'nowrap', overflow: 'hidden',
              textOverflow: 'ellipsis', maxWidth: 360,
              cursor: isOwner && onNameChange ? 'text' : 'default',
              borderRadius: 4, padding: '3px 8px',
              transition: 'background 120ms',
            }}
            onMouseEnter={e => { if (isOwner && onNameChange) e.currentTarget.style.background = 'var(--bg-2)' }}
            onMouseLeave={e => { e.currentTarget.style.background = 'transparent' }}
          >
            {projectName}
          </span>
        )}
      </div>

      {/* Derecha — botón blueprint (ocupa lo mismo que la izquierda para centrar) */}
      <div style={{ flex: '0 1 auto', display: 'flex', justifyContent: 'flex-end' }}>

      <div style={{ position: 'relative' }}>
        <button
          onClick={openPicker}
          disabled={loading}
          style={{ fontSize: 11, fontFamily: 'var(--font-mono)', padding: '5px 12px', borderRadius: 5, background: 'var(--bg-2)', border: '1px solid var(--line-2)', color: loading ? 'var(--text-3)' : 'var(--text-1)', cursor: loading ? 'not-allowed' : 'pointer', opacity: loading ? 0.55 : 1, transition: 'border-color 100ms' }}
          onMouseEnter={e => { if (!loading) e.currentTarget.style.borderColor = 'var(--line)' }}
          onMouseLeave={e => { e.currentTarget.style.borderColor = 'var(--line-2)' }}
        >
          {loading ? '⟳ Loading…' : '⊕ Load Blueprint'}
        </button>

        {showPicker && (
          <>
            <div style={{ position: 'fixed', inset: 0, zIndex: 199 }} onClick={() => setShowPicker(false)} />
            <div style={{ position: 'absolute', top: '100%', right: 0, marginTop: 4, zIndex: 200, background: 'var(--bg-1)', border: '1px solid var(--line-2)', borderRadius: 8, boxShadow: '0 8px 32px rgba(0,0,0,0.35)', minWidth: 230, overflow: 'hidden' }}>
              {blueprints.length === 0 ? (
                <div style={{ padding: '12px 14px', fontSize: 11, fontFamily: 'var(--font-mono)', color: 'var(--text-3)' }}>No blueprints found</div>
              ) : (
                blueprints.map(bp => (
                  <button key={bp.id} onClick={() => loadBlueprint(bp.id)} style={{ display: 'block', width: '100%', textAlign: 'left', padding: '9px 13px', border: 'none', background: 'transparent', cursor: 'pointer', borderBottom: '1px solid var(--line-2)' }}
                    onMouseEnter={e => (e.currentTarget.style.background = 'var(--bg-2)')}
                    onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
                  >
                    <div style={{ fontSize: 11, fontFamily: 'var(--font-mono)', color: 'var(--text-0)', marginBottom: 1 }}>{bp.name}</div>
                    <div style={{ fontSize: 9, fontFamily: 'var(--font-mono)', color: 'var(--text-3)' }}>{bp.blueprint_key}</div>
                  </button>
                ))
              )}
            </div>
          </>
        )}
      </div>
      </div>{/* cierra flex: '0 1 auto' derecha */}
    </div>
  )
}

// ─── ForgeCanvasInner ─────────────────────────────────────────────────────────

const TEXT_SIZE_KEY    = 'forge_canvas_text_size'
const TEXT_SIZE_SCALES = { sm: 0.88, md: 1.0, lg: 1.22 } as const
type TextSize = keyof typeof TEXT_SIZE_SCALES

const EDGE_STYLE_KEY = 'forge_canvas_edge_style'
type EdgeStyle = 'bezier' | 'orthogonal'

// Contexto para pasar el scale a los nodos y sidebar sin prop-drilling
const CanvasScaleContext = createContext(1)
// Contexto que indica si hay un nodo siendo arrastrado (cierra decks abiertos)
const DraggingContext = createContext(false)
// Contexto para pedirle a un ForgeNodeCard específico que abra su output modal (opcionalmente en un tab específico)
const PendingOutputModalContext = createContext<{ nodeId: string | null; outputKey: string | null; clear: () => void }>({ nodeId: null, outputKey: null, clear: () => {} })

function ForgeCanvasInner({ project, onRefresh }: { project: Project; onRefresh: () => void }) {
  const [localName,         setLocalName]         = useState(project.name)
  const [canvasData,        setCanvasData]        = useState<CanvasData | null>(null)
  const [loading,           setLoading]           = useState(true)
  const [selectedNode,      setSelectedNode]      = useState<CanvasNode | null>(null)
  const [hoveredNodeId,     setHoveredNodeId]     = useState<string | null>(null)  // focus: resalta sus cables
  const [removing,          setRemoving]          = useState(false)
  const [sidebarCollapsed,  setSidebarCollapsed]  = useState(false)
  const [chatNode,          setChatNode]          = useState<CanvasNode | null>(null)
  const [chatSessionId,     setChatSessionId]     = useState<string | null>(null)
  const chatSessionIdRef = useRef<string | null>(null)
  const [chatMessages,      setChatMessages]      = useState<ChatMessage[]>([])
  const [chatLoading,       setChatLoading]       = useState(false)
  const [chatDocUrl,        setChatDocUrl]        = useState<string | null>(null)
  const [chatDocFormat,     setChatDocFormat]     = useState<string | null>(null)
  const [chatOutputImages,     setChatOutputImages]     = useState<OutputImagesMap>({})
  const [chatApprovedAsset,    setChatApprovedAsset]    = useState<ApprovedAsset | null>(null)
  const [chatTargetOutputKey,  setChatTargetOutputKey]  = useState<string | null>(null)
  const [chatTargetOutputLabel,setChatTargetOutputLabel]= useState<string | null>(null)
  const [collapsedAssets,   setCollapsedAssets]   = useState<Set<string>>(new Set())
  const [collapsedLanes,    setCollapsedLanes]    = useState<Set<string>>(new Set())
  const [runPhase,          setRunPhase]          = useState<'idle' | 'running' | 'error'>('idle')
  const [runProgress,       setRunProgress]       = useState<{ done: number; total: number } | null>(null)
  const [runningNodeIds,    setRunningNodeIds]     = useState<Set<string>>(new Set())
  const [runErrorNodeId,    setRunErrorNodeId]     = useState<string | null>(null)
  const [runErrors,         setRunErrors]          = useState<import('@/lib/api').RunValidateError[]>([])
  // Autorización de gates para Run de pipeline (#4) — modal + decisión
  const [runPlanModal,      setRunPlanModal]       = useState<{ plan: RunPlan; scope: RunScope } | null>(null)
  // Aviso: el run arrancaría sin contexto (ningún Text Input / Library Asset conectado)
  // → los nodos raíz correrían solo con el nombre del proyecto como referencia.
  const [noContextModal,    setNoContextModal]     = useState<{ scope: RunScope; roots: string[] } | null>(null)
  const [gateMode,          setGateMode]           = useState<GateAuthMode>('pause')
  const [gateRemember,      setGateRemember]       = useState(false)
  const [draggingNodeId,       setDraggingNodeId]       = useState<string | null>(null)
  const [pendingOutputModalId,  setPendingOutputModalId]  = useState<string | null>(null)
  const [pendingOutputModalKey, setPendingOutputModalKey] = useState<string | null>(null)
  const clearPendingOutputModal = useCallback(() => { setPendingOutputModalId(null); setPendingOutputModalKey(null) }, [])
  const [pendingRemoveId, setPendingRemoveId] = useState<string | null>(null)
  // Nodo aprobado que se intentó soltar en el panel para borrarlo: se avisa por qué no se fue.
  const [bloqueado, setBloqueado] = useState<string | null>(null)
  const dropZoneRef = useRef<HTMLDivElement>(null)
  const [textSize,   setTextSize]  = useState<TextSize>(() => {
    const saved = typeof window !== 'undefined' ? localStorage.getItem(TEXT_SIZE_KEY) : null
    return (saved as TextSize | null) ?? 'md'
  })
  const [edgeStyle,  setEdgeStyle] = useState<EdgeStyle>(() => {
    const saved = typeof window !== 'undefined' ? localStorage.getItem(EDGE_STYLE_KEY) : null
    return (saved as EdgeStyle | null) ?? 'bezier'
  })

  // Expone ancho del sidebar como CSS var para que FeedbackWidget calcule su posición
  useEffect(() => {
    const w = sidebarCollapsed ? 32 : 220
    document.documentElement.style.setProperty('--forge-library-w', `${w}px`)
    return () => { document.documentElement.style.removeProperty('--forge-library-w') }
  }, [sidebarCollapsed])

  const [savedLayout, setSavedLayout] = useState(() => loadLayout(project.id))

  // Posiciones pendientes de nodos recién dropeados (project_node_id → position)
  const pendingPositionsRef = useRef<Record<string, { x: number; y: number }>>({})
  // Flag: el layout de DB ya se aplicó en este montaje — no repetir en reloads silenciosos
  const dbLayoutAppliedRef  = useRef(false)
  // Indica que el gate acaba de dispararse — normalizar posiciones al cargar los nodos nuevos
  const autoNormalizeRef = useRef(false)

  const toggleLane = useCallback((laneId: string) => {
    setCollapsedLanes(prev => {
      const next = new Set(prev)
      if (next.has(laneId)) next.delete(laneId)
      else next.add(laneId)
      return next
    })
  }, [])

  const persistEdges = useCallback((edgeList: Edge[]) => {
    // Excluir edges virtuales de lane (source/target = "lane-<uuid>", id "virtual-*").
    // No representan conexiones reales nodo→nodo: el backend los reconstruye al cargar.
    // Si se enviaran, el PUT borra todos los edges y luego falla al insertar el uuid
    // inválido "lane-...", dejando el proyecto con 0 edges (los reales hidden ya van aparte).
    const real = edgeList.filter(e =>
      !e.id.startsWith('virtual-') &&
      !e.source.startsWith('lane-') &&
      !e.target.startsWith('lane-')
    )
    // Deduplicar por source+handle+target antes de enviar
    const seen = new Set<string>()
    const unique = real.filter(e => {
      // La clave usa el PUERTO. Con el handle de dibujo, un cable tipado y uno genérico entre el
      // mismo par se veían iguales y se fusionaban: así se perdieron 19 de 42 aristas.
      const p = (e.data as { puertos?: { source: string | null; target: string | null } } | undefined)?.puertos
      const key = `${e.source}|${p?.source ?? e.sourceHandle ?? ''}|${e.target}|${p?.target ?? e.targetHandle ?? ''}`
      if (seen.has(key)) return false
      seen.add(key)
      return true
    })
    console.log(`[forge-canvas] persistEdges called — ${unique.length} edges (${edgeList.length} raw)`, new Error().stack?.split('\n')[2]?.trim())
    return canvasFetch(`/api/projects/${project.id}/canvas/edges`, {
      method: 'PUT',
      body: JSON.stringify({
        // Se guarda el PUERTO, no el handle de dibujo. El arreglo trae 'out'/'in' porque es lo
        // que necesita React Flow para pintar; el puerto real viaja en `data.puertos` desde que
        // se armó el edge, y es lo único que le dice al motor qué output cruza por ese cable.
        edges: unique.map(e => {
          const p = (e.data as { puertos?: { source: string | null; target: string | null } } | undefined)?.puertos
          return {
            source:       e.source,
            target:       e.target,
            sourceHandle: p?.source ?? e.sourceHandle ?? null,
            targetHandle: p?.target ?? e.targetHandle ?? null,
          }
        }),
      }),
    }).catch(err => console.error('[forge-canvas] sync edges failed', err))
  }, [project.id])

  const toggleAssetCollapse = useCallback((id: string) => {
    setCollapsedAssets(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id); else next.add(id)
      return next
    })
  }, [])

  const loadCanvas = useCallback(async (silent = false): Promise<CanvasData | null> => {
    if (!silent) setLoading(true)
    try {
      const data = await canvasFetch<CanvasData>(`/api/projects/${project.id}/canvas`)
      if (data.canvas_layout && !dbLayoutAppliedRef.current) {
        dbLayoutAppliedRef.current = true
        const dbLayout = data.canvas_layout as Parameters<typeof seedLayoutFromDB>[1]
        seedLayoutFromDB(project.id, dbLayout)
        setSavedLayout(dbLayout)
      }
      setCanvasData(data)
      return data
    } catch (e) {
      console.error('[forge-canvas] load failed', e)
      return null
    } finally {
      if (!silent) setLoading(false)
    }
  }, [project.id])

  // La X del lane no borra: pregunta. Lo que hay detrás no es «quitar del canvas» — el endpoint
  // elimina TODOS los nodos miembro con sus sesiones, mensajes e imágenes, y no hay vuelta atrás.
  // Borrar un solo nodo ya avisaba; borrar tres de un clic no avisaba nada.
  const [pendingLaneId, setPendingLaneId] = useState<string | null>(null)

  const dismissLane = useCallback(async (laneId: string) => {
    try {
      await canvasFetch(`/api/projects/${project.id}/canvas/lanes/${laneId}`, { method: 'DELETE' })
      setCollapsedLanes(prev => { const next = new Set(prev); next.delete(laneId); return next })
      loadCanvas(true)
    } catch (e) {
      console.error('[forge-canvas] lane dismiss failed', e)
    }
  }, [project.id, loadCanvas])

  const handleRemoveAssetNode = useCallback(async (projectNodeId: string) => {
    try {
      await canvasFetch(`/api/projects/${project.id}/canvas/nodes/${projectNodeId}`, { method: 'DELETE' })
      loadCanvas(true)
    } catch (e) { console.error('[forge-canvas] remove asset-node failed', e) }
  }, [project.id, loadCanvas])

  const saveTextNode = useCallback(async (projectNodeId: string, label: string, content: string) => {
    try {
      await canvasFetch(`/api/projects/${project.id}/canvas/nodes/${projectNodeId}/text`, {
        method: 'PATCH',
        body: JSON.stringify({ text_label: label, text_content: content }),
      })
    } catch (e) { console.error('[forge-canvas] save text-node failed', e) }
  }, [project.id])

  useEffect(() => {
    loadCanvas()
  }, [loadCanvas])

  // Refresh tiene que traer lo que cambió por fuera de esta pestaña — que es para lo único que
  // sirve. `onRefresh` solo recargaba la fila de `projects`, y como `loadCanvas` depende de
  // `project.id` —que nunca cambia— el canvas no se volvía a pedir: los nodos, las sesiones y los
  // outputs seguían siendo los de cuando abriste. Si otro miembro corría un nodo, no aparecía
  // hasta recargar la página entera.
  const refrescarTodo = useCallback(() => {
    onRefresh()
    loadCanvas()
  }, [onRefresh, loadCanvas])

  const canvasNodeIds = useMemo(
    () => new Set((canvasData?.nodes ?? []).filter(cn => cn.node_type === 'forge_node').map(cn => cn.node!.id)),
    [canvasData],
  )

  const approvedNodeIds = useMemo(
    () => new Set((canvasData?.nodes ?? []).filter(cn => {
      if (cn.node_type !== 'forge_node') return false
      if (cn.session?.status === 'approved' || cn.session?.status === 'auto_approved') return true
      const aOuts = (cn.node?.outputs ?? [])
      if (aOuts.length === 0) return false
      return aOuts.every((o: { key?: string }) => {
        const s = (cn.output_sessions ?? {})[(o.key ?? '')]
        return s?.status === 'approved' || s?.status === 'auto_approved'
      })
    }).map(cn => cn.node!.id)),
    [canvasData],
  )

  // Set de project_node_ids con output válido — para activar FORGYI en edges salientes
  const approvedProjectNodeIds = useMemo(
    () => new Set((canvasData?.nodes ?? [])
      .filter(cn => cn.session?.status === 'approved' || cn.session?.status === 'auto_approved')
      .map(cn => cn.project_node_id)
    ),
    [canvasData],
  )

  // Nodos que el Run All puede correr:
  // - sin sesión (idle)
  // - sesión active (no corrió o está en progreso manual)
  // - auto_approved + is_stale (output desactualizado)
  // Excluye: approved (sellado) y auto_approved sin stale (ya tiene draft)
  const runnableCount = useMemo(
    () => (canvasData?.nodes ?? []).filter(isNodeRunnable).length,
    [canvasData],
  )

  // Menú de runs por alcance — pipeline completo + fase (blueprint activo) + cada lane.
  // count = nodos pendientes dentro de ese scope (para mostrar y deshabilitar items vacíos).
  const runMenu = useMemo<RunMenuItem[]>(() => {
    if (!canvasData) return []
    const items: RunMenuItem[] = [
      { scope: { type: 'pipeline' }, label: 'Run all', count: canvasData.nodes.filter(isNodeRunnable).length },
    ]
    const bp = canvasData.active_blueprint
    if (bp) {
      items.push({
        scope: { type: 'blueprint', blueprint_id: bp.id },
        label: `Run phase · ${bp.name}`,
        count: canvasData.nodes.filter(n => n.blueprint_id === bp.id && isNodeRunnable(n)).length,
      })
    }
    for (const lane of canvasData.lanes ?? []) {
      items.push({
        scope: { type: 'lane', lane_id: lane.id },
        label: `Run lane ${lane.lane_key} · ${lane.label}`,
        count: canvasData.nodes.filter(n => n.lane_id === lane.id && isNodeRunnable(n)).length,
      })
    }
    return items
  }, [canvasData])


  // v1.3.0: todos los nodos son standalone — ninguno bloquea a otro
  // El único estado "locked" es sesión aprobada (read-only), manejado en ForgeNodeCard directamente
  const lockedNodeIds = useMemo(() => new Set<string>(), [])

  // Gate listo: todos los nodos del blueprint activo están aprobados y no hay decisión previa
  const gateReady = useMemo(() => isGateReady(canvasData), [canvasData])

  const [gateLoading,   setGateLoading]   = useState(false)
  const [gateDismissed, setGateDismissed] = useState(false)
  const [gateKilled,    setGateKilled]    = useState(false)

  // El modal se muestra si el gate está listo, no fue descartado ni matado localmente
  const gateOpen = gateReady && !gateDismissed && !gateKilled

  async function handleGateDecision(decision: 'ACCEPT' | 'REFINE' | 'KILL') {
    if (!canvasData?.active_blueprint) return

    // REFINE y KILL: solo cierran el modal localmente, sin persistir
    // "Decisions are reversible" — el gate se puede reabrir en cualquier momento
    if (decision === 'REFINE') { setGateDismissed(true); return }
    if (decision === 'KILL')   { setGateKilled(true);    return }

    setGateLoading(true)
    try {
      await acceptGateCore(canvasData.active_blueprint.id)
      await loadCanvas(true)
    } catch (e) {
      console.error('[gate] decision failed', e)
    } finally {
      setGateLoading(false)
    }
  }

  // Resetear estados locales cuando el gate ya no está listo
  useEffect(() => {
    if (!gateReady) { setGateDismissed(false); setGateKilled(false) }
  }, [gateReady])

  const buildNodes = useCallback((canvasNodes: CanvasNode[]): Node[] => {
    // `?.nodes.reduce` protegía el layout pero no la clave: un `canvas_layout` que existe y NO
    // trae `nodes` -el de 13_lives_kitten_TEST, que quedó solo con `moodboard`- daba
    // «undefined.reduce» y tumbaba el canvas entero con «This page couldn't load». Sin posiciones
    // guardadas los nodos caen a su ubicación por defecto, que es exactamente lo que debe pasar.
    const savedPos = savedLayout?.nodes?.reduce<Record<string, { x: number; y: number }>>((acc, n) => {
      acc[n.id] = n.position
      return acc
    }, {}) ?? {}

    // Nodos nuevos (sin posición guardada) se colocan a la derecha del último nodo conocido
    const knownXValues = Object.values(savedPos).map(p => p.x)
    const baseX = knownXValues.length > 0 ? Math.max(...knownXValues) + NODE_W + NODE_GAP : 0
    let unsavedForgeIdx = 0

    let assetIdx = 0
    let textIdx  = 0
    return [...canvasNodes]
      .sort((a, b) => (a.order_index ?? 999) - (b.order_index ?? 999))
      .map((cn) => {
        const pos = pendingPositionsRef.current[cn.project_node_id]
               ?? savedPos[cn.project_node_id]

        if (cn.node_type === 'library_asset') {
          const defaultPos = pos ?? { x: assetIdx++ * (ASSET_NODE_W + 20), y: -140 }
          return {
            id:        cn.project_node_id,
            type:      'assetNode',
            deletable: false,
            position:  defaultPos,
            data: {
              canvasNode:       cn,
              collapsed:        collapsedAssets.has(cn.project_node_id),
              projectId:        project.id,
              onToggleCollapse: () => toggleAssetCollapse(cn.project_node_id),
              onRemove:         () => handleRemoveAssetNode(cn.project_node_id),
            } as AssetNodeCardData,
          }
        }

        if (cn.node_type === 'text_input') {
          const defaultPos = pos ?? { x: textIdx++ * (TEXT_NODE_W + 20), y: -280 }
          return {
            id:         cn.project_node_id,
            type:       'textInputNode',
            deletable:  false,
            position:   defaultPos,
            dragHandle: '.text-node-drag',
            data: {
              canvasNode: cn,
              onSave:     (label: string, content: string) => saveTextNode(cn.project_node_id, label, content),
              onRemove:   () => handleRemoveAssetNode(cn.project_node_id),
            } as TextInputCardData,
          }
        }

        return {
          id:        cn.project_node_id,
          type:      'forgeNode',
          deletable: false,
          zIndex:    1,
          position:  pos ?? { x: baseX + unsavedForgeIdx++ * (NODE_W + NODE_GAP), y: 0 },
          data: {
            canvasNode: cn,
            onClick: () => {
              setChatNode(null); setChatMessages([]); setChatSessionId(null)
              setSelectedNode(cn)
            },
            locked:    lockedNodeIds.has(cn.project_node_id),
            isRunning: false,
            isStale:   cn.is_stale,
            isError:   false,
            projectId: project.id,
            onImagesUpdate: (imgs: OutputImagesMap, outputKey?: string) => {
              // Invalidar caché del deck para que muestre las nuevas variaciones
              invalidateAssetDeckCache(project.id, cn.node?.id ?? '')
              setChatOutputImages(imgs)
              setCanvasData(prev => prev ? {
                ...prev,
                nodes: prev.nodes.map(n => {
                  if (n.project_node_id !== cn.project_node_id) return n
                  // Actualizar per-output session si corresponde
                  if (outputKey && (n.output_sessions ?? {})[outputKey]) {
                    const outSess = n.output_sessions![outputKey]
                    return { ...n, output_sessions: { ...n.output_sessions, [outputKey]: { ...outSess, output_images: imgs } } }
                  }
                  // Sesión general
                  if (n.session) return { ...n, session: { ...n.session, output_images: imgs } }
                  return n
                }),
              } : null)
            },
            onOpenChat: (outputKey?: string | null, outputLabel?: string | null) => {
              setChatTargetOutputKey(outputKey ?? null)
              setChatTargetOutputLabel(outputLabel ?? null)
              handleRunNode(cn, outputKey)
            },
          } as ForgeNodeCardData,
        }
      })
  }, [savedLayout, lockedNodeIds, collapsedAssets, toggleAssetCollapse, handleRemoveAssetNode, saveTextNode])

  // Edges vienen de savedLayout; el usuario las dibuja manualmente
  const initNodes = useMemo(() => canvasData ? buildNodes(canvasData.nodes) : [], [canvasData, buildNodes])
  // Edges vienen de DB (canvasData); localStorage solo como caché de arranque rápido
  // Normaliza handles legacy (out-xxx → out, in-xxx → in) tras el cambio a handle único por nodo
  const initEdges = useMemo((): Edge[] => (savedLayout?.edges ?? []).map(e => ({
    ...e,
    sourceHandle: e.sourceHandle?.startsWith('out-') ? 'out' : (e.sourceHandle ?? undefined),
    targetHandle: e.targetHandle?.startsWith('in-')  ? 'in'  : (e.targetHandle  ?? undefined),
  })), [savedLayout])

  const [selectedEdgeId,   setSelectedEdgeId]   = useState<string | null>(null)
  const [showExportModal,  setShowExportModal]   = useState(false)

  const [nodes, setNodes, onNodesChange] = useNodesState(initNodes)
  const [edges, setEdges, onEdgesChange] = useEdgesState(initEdges)
  const nodesRef  = useRef(nodes)
  const edgesRef  = useRef(edges)
  nodesRef.current = nodes
  edgesRef.current = edges

  // Refs para el useEffect de construcción de edges (evitan dependencias circulares)
  const edgeStyleRef         = useRef<EdgeStyle>(edgeStyle)
  edgeStyleRef.current       = edgeStyle
  const waypointsCallbackRef = useRef<((id: string, wps: WayPoint[]) => void) | null>(null)

  const onEdgeClick = useCallback((_: React.MouseEvent, edge: Edge) => {
    setSelectedEdgeId(prev => prev === edge.id ? null : edge.id)
  }, [])

  const onPaneClick = useCallback(() => setSelectedEdgeId(null), [])

  // Filtrar los cambios de selección que ReactFlow intenta manejar internamente
  const onEdgesChangeSafe = useCallback((changes: EdgeChange[]) => {
    onEdgesChange(changes.filter(c => c.type !== 'select'))
  }, [onEdgesChange])

  // Actualizar badges de running/stale/error sin recargar canvas
  useEffect(() => {
    if (!canvasData) return
    setNodes(prev => prev.map(n => {
      const d = n.data as ForgeNodeCardData
      if (!d.canvasNode) return n
      const id = d.canvasNode.project_node_id
      return { ...n, data: { ...d, isRunning: runningNodeIds.has(id), isStale: d.canvasNode.is_stale && !runningNodeIds.has(id), isError: runErrorNodeId === id } }
    }))
  }, [runningNodeIds, runErrorNodeId, canvasData])


  useEffect(() => {
    if (!canvasData) return
    const newNodes = buildNodes(canvasData.nodes)

    // Post-gate single-lane: conservar posiciones fase 1, colocar nodos nuevos a la derecha
    if (autoNormalizeRef.current && (canvasData.lanes?.length ?? 0) <= 1) {
      autoNormalizeRef.current = false
      setNodes(prev => {
        const existingForge = prev.filter(n => !n.id.startsWith('lane-'))
        // Y base = promedio de los nodos actuales para que los nuevos queden alineados
        const baseY = existingForge.length > 0
          ? Math.round(existingForge.reduce((s, n) => s + n.position.y, 0) / existingForge.length)
          : 0
        const maxX = existingForge.reduce((m, n) => Math.max(m, n.position.x), 0)
        let newIdx = 0
        return newNodes.map(n => {
          const existing = prev.find(p => p.id === n.id)
          if (existing) return { ...n, position: existing.position }
          return { ...n, position: { x: maxX + NODE_W + NODE_GAP + newIdx++ * (NODE_W + NODE_GAP), y: baseY } }
        })
      })
      requestAnimationFrame(() => fitView({ padding: 0.3, duration: 300 }))
      pendingPositionsRef.current = {}
    } else {
      setNodes(prev => newNodes.map(n => {
        const existing = prev.find(p => p.id === n.id)
        return existing ? { ...n, position: existing.position } : n
      }))
      pendingPositionsRef.current = {}
    }
    const validIds = new Set(newNodes.map(n => n.id))

    // Mapa project_node_id → lane_id para reemplazar edges cross-lane con edges virtuales
    const laneByNode = new Map<string, string | null>()
    for (const cn of canvasData.nodes) laneByNode.set(cn.project_node_id, cn.lane_id)

    // Mapa lane_id → color (para pintar los edges virtuales con el color del lane)
    const laneColor = new Map<string, string>()
    for (const lane of (canvasData.lanes ?? [])) laneColor.set(lane.id, lane.color)

    // Con un solo lane no hay cruces de frontera: edges directos, sin LaneGroupNode
    const singleLane = (canvasData.lanes?.length ?? 0) <= 1

    // Reconstruir edges desde DB — edges que cruzan la frontera de un lane quedan hidden;
    // se reemplazan por edges virtuales en los bordes del LaneGroupNode (simétrico: salida e entrada).
    // Salientes: (srcLane → external target) → virtual desde lane-out
    // Entrantes: (external source → tgtLane)  → virtual hacia lane-in
    // `reales` guarda qué nodos DE ADENTRO del lane representa cada cable virtual. Sin eso, pasar
    // el mouse por un nodo del lane no encendía sus cables hacia afuera: el resaltado compara
    // contra los extremos del cable, y los del virtual son el contenedor, no el nodo.
    const outgoingLanePairs = new Map<string, { laneGroupId: string; targetId: string; color: string; reales: Set<string> }>()
    const incomingLanePairs = new Map<string, { sourceId: string; laneGroupId: string; color: string; reales: Set<string> }>()

    // Waypoints guardados en canvas_layout (localStorage) por edge id
    const savedLayout    = loadLayout(project.id)
    const savedWaypoints = new Map<string, WayPoint[]>()
    for (const se of savedLayout?.edges ?? []) {
      const wp = (se.data as { waypoints?: WayPoint[] })?.waypoints
      if (wp?.length) savedWaypoints.set(se.id, wp)
    }

    const currentEdgeStyle = edgeStyleRef.current
    const edgeType = currentEdgeStyle === 'orthogonal' ? 'orthogonalEdge' : 'forgeEdge'

    const makeEdgeData = (color: string, extra?: Record<string, unknown>) => ({
      color,
      active: false,
      onWaypointsChange: waypointsCallbackRef.current ?? undefined,
      ...extra,
    })

    // Un edge cuyo extremo no está en el canvas no se puede dibujar — pero descartarlo callado es
    // lo que hace que un cable «desaparezca» sin explicación y que el usuario crea que se borró,
    // cuando en la base sigue intacto. Se avisa, con nombre y apellido.
    const huerfanos = (canvasData.edges ?? []).filter(e => !validIds.has(e.source) || !validIds.has(e.target))
    if (huerfanos.length) {
      console.warn(`[forge-canvas] ${huerfanos.length} edge(s) no se dibujan: un extremo no está en el canvas`,
        huerfanos.map(e => ({
          edge: e.id,
          source: e.source, sourceEnCanvas: validIds.has(e.source),
          target: e.target, targetEnCanvas: validIds.has(e.target),
        })))
    }

    const dbEdges: Edge[] = (canvasData.edges ?? [])
      .filter(e => validIds.has(e.source) && validIds.has(e.target))
      .map(e => {
        const srcLane = laneByNode.get(e.source) ?? null
        const tgtLane = laneByNode.get(e.target) ?? null

        // Con singleLane: todos los edges son directos, no hay virtualización
        const isOutgoing = !singleLane && srcLane !== null && srcLane !== tgtLane
        const isIncoming = !singleLane && tgtLane !== null && srcLane !== tgtLane

        if (isOutgoing) {
          const pairKey = `${srcLane}→${e.target}`
          if (!outgoingLanePairs.has(pairKey)) {
            outgoingLanePairs.set(pairKey, {
              laneGroupId: `lane-${srcLane}`,
              targetId:    e.target,
              color:       laneColor.get(srcLane) ?? '#6b7280',
              reales:      new Set(),
            })
          }
          outgoingLanePairs.get(pairKey)!.reales.add(e.source)
        }

        if (isIncoming) {
          const pairKey = `${e.source}→${tgtLane}`
          if (!incomingLanePairs.has(pairKey)) {
            incomingLanePairs.set(pairKey, {
              sourceId:    e.source,
              laneGroupId: `lane-${tgtLane}`,
              color:       laneColor.get(tgtLane) ?? '#6b7280',
              reales:      new Set(),
            })
          }
          incomingLanePairs.get(pairKey)!.reales.add(e.target)
        }

        const isHidden = isOutgoing || isIncoming
        const waypoints = savedWaypoints.get(e.id)
        return {
          id:           e.id,
          source:       e.source,
          target:       e.target,
          // Para DIBUJAR, el puerto se colapsa a 'out'/'in': los nodos tienen un solo handle por
          // lado. Pero el puerto real —`out-concept_data`— es lo que el motor usa para saber QUÉ
          // output viaja por ese cable, y `persistEdges` guarda lo que hay en el arreglo. Sin
          // llevarlo aparte, el primer PUT lo borraba: medido el 20-ago en Smack JM V2, 42 aristas
          // con 21 puertos quedaron en 23 sin ninguno, y el 2.4 pasó a recibir el documento entero
          // en vez del output que le tocaba.
          sourceHandle: e.sourceHandle?.startsWith('out-') ? 'out' : (e.sourceHandle ?? undefined),
          targetHandle: e.targetHandle?.startsWith('in-')  ? 'in'  : (e.targetHandle  ?? undefined),
          type:         isHidden ? 'forgeEdge' : edgeType,
          deletable:    !isHidden,
          hidden:       isHidden,
          data:         makeEdgeData('#6b7280', {
            puertos: { source: e.sourceHandle ?? null, target: e.targetHandle ?? null },
            ...(waypoints ? { waypoints } : {}),
          }),
        }
      })

    // Edges virtuales salientes: uno por (srcLane, target), desde el borde derecho del lane
    for (const [pairKey, { laneGroupId, targetId, color, reales }] of outgoingLanePairs) {
      const eid = `virtual-out-${pairKey}`
      const waypoints = savedWaypoints.get(eid)
      dbEdges.push({
        id:           eid,
        source:       laneGroupId,
        sourceHandle: 'lane-out',
        target:       targetId,
        type:         edgeType,
        deletable:    false,
        selectable:   false,
        data:         makeEdgeData(color, { reales: [...reales], ...(waypoints ? { waypoints } : {}) }),
      })
    }

    // Edges virtuales entrantes: uno por (source, tgtLane), hacia el borde izquierdo del lane
    for (const [pairKey, { sourceId, laneGroupId, color, reales }] of incomingLanePairs) {
      const eid = `virtual-in-${pairKey}`
      const waypoints = savedWaypoints.get(eid)
      dbEdges.push({
        id:           eid,
        source:       sourceId,
        // Sin handle fijo: React Flow toma el único de salida que tenga el nodo. Forzar 'out'
        // servía para los forge-nodes y dejaba fuera a los de asset y texto, cuyo handle no lleva
        // id — el cable real queda oculto y el virtual apunta a un handle inexistente, así que no
        // se dibuja ninguno de los dos. Ese era el «no sale el cable» al conectar una imagen de la
        // librería con un nodo dentro de un lane.
        target:       laneGroupId,
        targetHandle: 'lane-in',
        type:         edgeType,
        deletable:    false,
        selectable:   false,
        data:         makeEdgeData(color, { reales: [...reales], ...(waypoints ? { waypoints } : {}) }),
      })
    }

    // Un cable puede no verse por dos razones distintas y hay que poder distinguirlas: o se
    // descartó por tener un extremo fuera del canvas (arriba), o se dibujó OCULTO porque cruza un
    // lane y lo reemplaza un edge virtual. Las dos se ven igual en pantalla — no hay cable — y
    // llevan a arreglos opuestos.
    const ocultos = dbEdges.filter(e => e.hidden && !e.id.startsWith('virtual-'))
    console.log(`[forge-canvas] edges: ${(canvasData.edges ?? []).length} en la base · ${dbEdges.length} dibujados`
      + ` · ${ocultos.length} ocultos por lane · ${huerfanos.length} descartados`)

    // El backend corre auto-wiring al cargar blueprints — los edges ya vienen en dbEdges
    setEdges(dbEdges)
  }, [canvasData, buildNodes, setNodes, setEdges, persistEdges])

  const { zoomIn, zoomOut, fitView, getViewport, setViewport, screenToFlowPosition, getNodes, setCenter, getNode } = useReactFlow()
  const { zoom } = useViewport()

  function applyTextSize(size: TextSize) {
    setTextSize(size)
    localStorage.setItem(TEXT_SIZE_KEY, size)
  }

  function resetLayout() {
    if (!canvasData) return

    // Calcular posiciones limpias
    const sorted = [...canvasData.nodes].sort((a, b) => (a.order_index ?? 999) - (b.order_index ?? 999))
    let assetIdx = 0, textIdx = 0, forgeIdx = 0
    const cleanPositions: { id: string; position: { x: number; y: number } }[] = sorted.map(cn => {
      let pos: { x: number; y: number }
      if      (cn.node_type === 'library_asset') pos = { x: assetIdx++ * (ASSET_NODE_W + 20), y: -140 }
      else if (cn.node_type === 'text_input')    pos = { x: textIdx++  * (TEXT_NODE_W  + 20), y: -280 }
      else                                        pos = { x: forgeIdx++ * (NODE_W + NODE_GAP), y: 0    }
      return { id: cn.project_node_id, position: pos }
    })

    // Persistir al DB inmediatamente para que el fan-out las lea correctas
    const posMap = Object.fromEntries(cleanPositions.map(p => [p.id, p]))
    const layoutNodes = cleanPositions.map(p => ({ id: p.id, position: p.position }))
    saveLayout(project.id, { templateId: canvasData?.active_blueprint?.id ?? null, nodes: layoutNodes as never, edges: [] }, true)
    setSavedLayout(null)

    setNodes(prev => {
      const res = sorted.map(cn => {
        const existing = prev.find(n => n.id === cn.project_node_id)
        if (!existing) return null
        return { ...existing, position: posMap[cn.project_node_id].position }
      }).filter((n): n is NonNullable<typeof n> => n !== null)
      return res
    })

    requestAnimationFrame(() => fitView({ padding: 0.3, duration: 300 }))
  }

  // Auto-organiza en capas del DAG (rango topológico): las raíces a la izquierda y cada nodo a la
  // derecha de sus predecesores. Endereza el "plato de espagueti" minimizando cruces de cables.
  function autoArrange() {
    if (!canvasData) return

    const cns     = canvasData.nodes
    const idSet   = new Set(cns.map(n => n.project_node_id))
    const orderOf: Record<string, number> = Object.fromEntries(cns.map(n => [n.project_node_id, n.order_index ?? 999]))

    // Grafo dirigido source(out) -> target(in) sobre los nodos reales
    const succ: Record<string, string[]> = {}
    const pred: Record<string, string[]> = {}
    const indeg: Record<string, number>  = {}
    for (const id of idSet) { succ[id] = []; pred[id] = []; indeg[id] = 0 }
    for (const e of edgesRef.current) {
      if (!idSet.has(e.source) || !idSet.has(e.target) || e.source === e.target) continue
      succ[e.source].push(e.target); pred[e.target].push(e.source); indeg[e.target]++
    }

    // Rango por longest-path (Kahn). Nodos en ciclo o sueltos quedan en rango 0.
    const rank: Record<string, number> = {}
    const indegLeft: Record<string, number> = { ...indeg }
    const queue: string[] = []
    for (const id of idSet) if (indeg[id] === 0) { rank[id] = 0; queue.push(id) }
    while (queue.length) {
      const u = queue.shift() as string
      for (const v of succ[u]) {
        rank[v] = Math.max(rank[v] ?? 0, (rank[u] ?? 0) + 1)
        if (--indegLeft[v] === 0) queue.push(v)
      }
    }
    for (const id of idSet) if (rank[id] === undefined) rank[id] = 0

    // Agrupar por columna (rango) y ordenar cada columna por order_index (orden inicial estable)
    const cols: Record<number, string[]> = {}
    for (const id of idSet) (cols[rank[id]] ??= []).push(id)
    for (const r of Object.keys(cols)) cols[+r].sort((a, b) => orderOf[a] - orderOf[b])

    // Minimización de cruces (baricentro / método de Sugiyama): en varias pasadas se reordena cada
    // columna según la posición media de sus vecinos en la columna fija contigua. Los nodos sin
    // vecinos se quedan donde están. Alterna izquierda->derecha (por predecesores) y viceversa.
    const maxRank = Math.max(0, ...Object.keys(cols).map(Number))
    const idxOf: Record<string, number> = {}
    const reindex = () => { for (const r of Object.keys(cols)) cols[+r].forEach((id, i) => { idxOf[id] = i }) }
    const bary = (id: string, neigh: string[]) => {
      const ns = neigh.filter(n => idxOf[n] !== undefined)
      if (ns.length === 0) return idxOf[id]  // sin vecinos -> conserva su lugar
      return ns.reduce((s, n) => s + idxOf[n], 0) / ns.length
    }
    reindex()
    for (let sweep = 0; sweep < 4; sweep++) {
      for (let r = 1; r <= maxRank; r++) {                 // hacia adelante: ordena por predecesores
        if (!cols[r]) continue
        const b: Record<string, number> = {}
        cols[r].forEach(id => { b[id] = bary(id, pred[id]) })
        cols[r].sort((a, c) => b[a] - b[c]); reindex()
      }
      for (let r = maxRank - 1; r >= 0; r--) {             // hacia atrás: ordena por sucesores
        if (!cols[r]) continue
        const b: Record<string, number> = {}
        cols[r].forEach(id => { b[id] = bary(id, succ[id]) })
        cols[r].sort((a, c) => b[a] - b[c]); reindex()
      }
    }

    const COL_PITCH = NODE_W + 140  // separación horizontal entre columnas
    const ROW_PITCH = 200           // separación vertical dentro de una columna
    const positions: { id: string; position: { x: number; y: number } }[] = []
    for (const r of Object.keys(cols)) {
      const col = cols[+r]
      const x   = +r * COL_PITCH
      col.forEach((id, i) => {
        const y = (i - (col.length - 1) / 2) * ROW_PITCH  // columna centrada en y=0
        positions.push({ id, position: { x, y } })
      })
    }

    // Aplicar + persistir (mismo patrón que resetLayout); no toca los nodos de lane
    const posMap = Object.fromEntries(positions.map(p => [p.id, p]))
    saveLayout(project.id, { templateId: canvasData?.active_blueprint?.id ?? null, nodes: positions.map(p => ({ id: p.id, position: p.position })) as never, edges: [] }, true)
    setSavedLayout(null)
    setNodes(prev => prev.map(n => posMap[n.id] ? { ...n, position: posMap[n.id].position } : n))

    requestAnimationFrame(() => fitView({ padding: 0.25, duration: 400 }))
  }

  function toggleEdgeStyle() {
    setEdgeStyle(prev => {
      const next: EdgeStyle = prev === 'bezier' ? 'orthogonal' : 'bezier'
      localStorage.setItem(EDGE_STYLE_KEY, next)
      const nextType = next === 'orthogonal' ? 'orthogonalEdge' : 'forgeEdge'
      setEdges(es => es.map(e => ({ ...e, type: nextType })))
      return next
    })
  }

  // Callback estable que los OrthogonalEdge llaman al mover waypoints
  const handleWaypointsChange = useCallback((edgeId: string, waypoints: WayPoint[]) => {
    setEdges(prev => prev.map(e =>
      e.id === edgeId ? { ...e, data: { ...e.data, waypoints } } : e
    ))
    persistLayoutRef.current()
  }, [setEdges])
  waypointsCallbackRef.current = handleWaypointsChange

  const handleFocusNode = useCallback((forgeNodeId: string) => {
    const cn = canvasData?.nodes.find(n => n.node?.id === forgeNodeId)
    if (!cn) return
    const rfNode = getNode(cn.project_node_id)
    if (!rfNode) return
    const x = rfNode.position.x + ((rfNode.measured?.width  ?? 240) / 2)
    const y = rfNode.position.y + ((rfNode.measured?.height ?? 120) / 2)
    setCenter(x, y, { zoom: 1.1, duration: 500 })
  }, [canvasData, getNode, setCenter])

  // Aplicar viewport una sola vez cuando el canvas y el layout estén listos
  const viewportInitRef = useRef(false)
  useEffect(() => {
    if (viewportInitRef.current || !canvasData) return
    viewportInitRef.current = true
    setTimeout(() => {
      if (savedLayout?.viewport) {
        setViewport(savedLayout.viewport, { duration: 0 })
      } else {
        fitView({ padding: 0.3, duration: 0 })
      }
    }, 60)
  }, [canvasData, savedLayout, setViewport, fitView])

  const persistLayout = useCallback(() => {
    saveLayout(project.id, {
      templateId: canvasData?.active_blueprint?.id ?? null,
      nodes:      nodesRef.current,
      edges:      edgesRef.current,
      viewport:   getViewport(),
    })
  }, [project.id, canvasData, getViewport])

  // Ref para que syncLaneNodes siempre use la versión actual de persistLayout
  const persistLayoutRef = useRef(persistLayout)
  persistLayoutRef.current = persistLayout

  // Se marca .rf-moving en el canvas para apagar por CSS los filtros y animaciones pesados de los
  // cables (blur/drop-shadow/animaciones) en dos casos: (1) durante zoom/pan, y (2) con zoom alto
  // (>1.5), donde esos filtros se rasterizan a gran escala cada frame y causan parpadeo aun quieto.
  const [moving, setMoving] = useState(false)

  // Ref a runScope para que el botón ▶ del LaneGroupNode no quede con un closure stale
  const runScopeRef = useRef(runScope)
  runScopeRef.current = runScope

  // Lock real del Run (evita la trampa de estado async de runPhase en el loop de pipeline #5)
  const runLockRef = useRef(false)

  // Ref para arrastrar lane groups: captura posiciones relativas de nodos miembro al inicio
  const laneGroupDragRef = useRef<{
    laneGroupId:       string
    memberNodeIds:     string[]
    relativePositions: Record<string, { x: number; y: number }>
  } | null>(null)

  // Sincroniza posición y tamaño del LaneGroupNode con sus nodos miembro
  const syncLaneNodes = useCallback(() => {
    if (!canvasData?.lanes?.length) return
    // Un solo lane: no renderizar LaneGroupNode, los edges son directos
    if (canvasData.lanes.length <= 1) {
      setNodes(prev => prev.filter(n => !n.id.startsWith('lane-')))
      return
    }
    const PADDING     = { top: 28, right: 18, bottom: 28, left: 18 }
    const NODE_W      = 240
    const NODE_H_FALLBACK = 90
    const COLLAPSED_H = 28

    setNodes(prev => {
      const nodeMap: Record<string, typeof prev[0]> = {}
      for (const n of prev) if (!n.id.startsWith('lane-')) nodeMap[n.id] = n

      let changed = false
      const newLaneNodes = canvasData.lanes.map(lane => {
        const memberIds = canvasData.nodes
          .filter(cn => cn.lane_id === lane.id)
          .map(cn => cn.project_node_id)
        const memberNodes = memberIds.map(id => nodeMap[id]).filter((n): n is typeof prev[0] => !!n)
        if (!memberNodes.length) return null

        const laneId     = `lane-${lane.id}`
        const ex         = prev.find(n => n.id === laneId)
        const isCollapsed = collapsedLanes.has(lane.id)

        const minX = Math.min(...memberNodes.map(n => n.position.x))
        const minY = Math.min(...memberNodes.map(n => n.position.y))
        const maxX = Math.max(...memberNodes.map(n => n.position.x + (n.measured?.width ?? NODE_W)))

        if (isCollapsed) {
          // Posición y ancho del node existente; fallback al bounding box de miembros
          const colPos = ex?.position ?? { x: minX - PADDING.left, y: minY - PADDING.top }
          const colW   = (ex?.style as { width?: number } | undefined)?.width
                        ?? maxX - minX + PADDING.left + PADDING.right

          if (ex && ex.position.x === colPos.x && ex.position.y === colPos.y &&
              (ex.style as { width?: number })?.width  === colW &&
              (ex.style as { height?: number })?.height === COLLAPSED_H &&
              (ex.data as unknown as LaneGroupData).collapsed === true) return ex

          changed = true
          return {
            id: laneId, type: 'laneGroup' as const, connectable: false,
            draggable: true, selectable: false, zIndex: 0,
            dragHandle: '.lane-drag-handle',
            position: colPos, style: { width: colW, height: COLLAPSED_H, zIndex: 0 },
            data: { lane, memberNodeIds: memberIds, onDragEnd: persistLayoutRef.current, collapsed: true, onToggle: () => toggleLane(lane.id), onDismiss: () => setPendingLaneId(lane.id), onRun: () => runScopeRef.current({ type: 'lane', lane_id: lane.id }) } as LaneGroupData,
          }
        }

        // Expandido: calcular bounding box desde nodos miembro
        // React Flow v12 mide en `measured`; `n.height` solo tiene valor si se fija a mano, así
        // que leyéndolo se caía siempre al fallback de 90 px y el marco quedaba corto — un nodo
        // que crece (la fila de imágenes generadas) se salía por abajo.
        const maxY   = Math.max(...memberNodes.map(n => n.position.y + (n.measured?.height ?? n.height ?? NODE_H_FALLBACK)))
        const newPos = { x: minX - PADDING.left, y: minY - PADDING.top }
        const newW   = maxX - minX + PADDING.left + PADDING.right
        const newH   = maxY - minY + PADDING.top + PADDING.bottom

        if (ex && ex.position.x === newPos.x && ex.position.y === newPos.y &&
            (ex.style as { width?: number })?.width  === newW &&
            (ex.style as { height?: number })?.height === newH &&
            (ex.data as unknown as LaneGroupData).collapsed === false) return ex

        changed = true
        return {
          id: laneId, type: 'laneGroup' as const, connectable: false,
          draggable: true, selectable: false, zIndex: 0,
          dragHandle: '.lane-drag-handle',
          position: newPos, style: { width: newW, height: newH, zIndex: 0 },
          data: { lane, memberNodeIds: memberIds, onDragEnd: persistLayoutRef.current, collapsed: false, onToggle: () => toggleLane(lane.id), onDismiss: () => setPendingLaneId(lane.id), onRun: () => runScopeRef.current({ type: 'lane', lane_id: lane.id }) } as LaneGroupData,
        }
      }).filter(Boolean) as typeof prev

      // Ocultar nodos miembro de lanes colapsados
      const hiddenIds = new Set<string>(
        canvasData.lanes
          .filter(l => collapsedLanes.has(l.id))
          .flatMap(l => canvasData.nodes.filter(cn => cn.lane_id === l.id).map(cn => cn.project_node_id))
      )

      const updatedMembers = prev
        .filter(n => !n.id.startsWith('lane-'))
        .map(n => {
          const shouldHide = hiddenIds.has(n.id)
          if (!!n.hidden === shouldHide) return n
          changed = true
          return { ...n, hidden: shouldHide }
        })

      if (!changed) return prev
      return [...newLaneNodes, ...updatedMembers]
    })
  }, [canvasData, setNodes, collapsedLanes, toggleLane, dismissLane])

  // Disparar sync cada vez que cambia canvasData (carga inicial + refetch tras fan-out)
  useEffect(() => { syncLaneNodes() }, [syncLaneNodes])

  // Re-sincronizar cuando React Flow mide las alturas reales de los nodos por primera vez
  // o cuando cambian (nodo aprobado agrega la fila de output y crece)
  // Misma corrección que arriba: con `n.height` (vacío en v12) esta clave salía siempre igual y el
  // efecto no volvía a correr nunca, así que el marco se calculaba una vez y se quedaba ahí.
  const _laneNodeHeightKey = nodes
    .filter(n => !n.id.startsWith('lane-'))
    .map(n => `${n.id}:${n.measured?.height ?? n.height ?? 0}`)
    .join('|')
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { if (_laneNodeHeightKey) syncLaneNodes() }, [_laneNodeHeightKey])

  const deleteEdge = useCallback((id: string) => {
    const next = edgesRef.current.filter(e => e.id !== id)
    setEdges(next)
    persistEdges(next)
    setSelectedEdgeId(null)
    requestAnimationFrame(persistLayout)
  }, [setEdges, persistLayout, persistEdges])

  // Nodos que emiten el glow Forgyi: forge_nodes aprobados + assets + text_inputs
  const forgyiSourceIds = useMemo(() => {
    if (!canvasData) return new Set<string>()
    return new Set(
      canvasData.nodes
        .filter(cn => {
          if (cn.node_type === 'library_asset' || cn.node_type === 'text_input') return true
          if (cn.node_type !== 'forge_node') return false
          // Sesión general aprobada
          if (cn.session?.status === 'approved' || cn.session?.status === 'auto_approved') return true
          // O cualquier output aprobado vía per-output session (asset, connection, etc.) — no solo 'connection'
          return Object.values(cn.output_sessions ?? {}).some(
            (s: { status?: string } | null | undefined) => s?.status === 'approved' || s?.status === 'auto_approved'
          )
        })
        .map(cn => cn.project_node_id)
    )
  }, [canvasData])

  // Selección y onDelete inyectados en runtime (onDelete no es serializable a localStorage)
  const displayEdges = useMemo(
    () => {
      // Focus: con un nodo en hover (o seleccionado) se resaltan SOLO sus cables y se atenúa el resto,
      // para leer el grafo por denso que sea.
      const focusId = hoveredNodeId ?? selectedNode?.project_node_id ?? null
      return edges.map(e => {
        const approved = forgyiSourceIds.has(e.source)
        // Un cable que cruza la frontera de un lane se dibuja como virtual entre el contenedor y
        // el nodo de afuera, así que sus extremos NO son el nodo que uno está mirando. `reales`
        // dice a qué nodos de adentro representa, y con eso el hover vuelve a encenderlo.
        const reales   = (e.data as { reales?: string[] } | undefined)?.reales
        const touches  = focusId != null &&
          (e.source === focusId || e.target === focusId || !!reales?.includes(focusId))
        return {
          ...e,
          selected: e.id === selectedEdgeId,
          data: {
            ...(e.data as object),
            onDelete: () => deleteEdge(e.id),
            approved,
            active:   touches,
            dimmed:   focusId != null && !touches,
            color:    '#6b7280',
          },
        }
      })
    },
    [edges, selectedEdgeId, deleteEdge, forgyiSourceIds, hoveredNodeId, selectedNode],
  )

  const onConnect = useCallback((connection: Connection) => {
    // Los handles del contenedor de lane son anclas de dibujo para los edges virtuales, no puertos
    // conectables: un cable que termine ahí se ve un instante y `persistEdges` lo descarta por no
    // ser un uuid — el usuario lo dibuja y desaparece sin explicación.
    if (connection.source.startsWith('lane-') || connection.target.startsWith('lane-')) return
    const handleSuffix = [connection.sourceHandle, connection.targetHandle].filter(Boolean).join('-')
    const id = handleSuffix
      ? `e-${connection.source}-${handleSuffix}-${connection.target}`
      : `e-${connection.source}-${connection.target}`
    const newEdge = {
      ...connection,
      id,
      type:      'forgeEdge',
      deletable: true,
      data:      { color: '#6b7280', active: false },
    } as Edge
    // Pure state update — sin side effects (StrictMode llama updaters dos veces)
    setEdges(prev => addEdge(newEdge, prev))
    // Persistir fuera del updater usando edgesRef (siempre en sync con el estado)
    persistEdges(addEdge(newEdge, edgesRef.current))
    requestAnimationFrame(persistLayout)
  }, [setEdges, persistLayout, persistEdges])

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    e.dataTransfer.dropEffect = 'copy'
  }, [])

  const handleDrop = useCallback(async (e: React.DragEvent) => {
    e.preventDefault()
    const position = screenToFlowPosition({ x: e.clientX, y: e.clientY })

    const nodeId    = e.dataTransfer.getData('forge/node-id')
    const assetId   = e.dataTransfer.getData('forge/asset-id')
    const textInput = e.dataTransfer.getData('forge/text-input')

    try {
      if (textInput) {
        const res = await canvasFetch<{ success: boolean; project_node: { id: string } }>(
          `/api/projects/${project.id}/canvas/add-text-node`,
          { method: 'POST', body: JSON.stringify({}) },
        )
        pendingPositionsRef.current[res.project_node.id] = position
        await loadCanvas(true)
      } else if (nodeId) {
        const res = await canvasFetch<{ success: boolean; project_node: { id: string } }>(
          `/api/projects/${project.id}/canvas/add-node`,
          { method: 'POST', body: JSON.stringify({ node_id: nodeId }) },
        )
        pendingPositionsRef.current[res.project_node.id] = position
        await loadCanvas(true)
      } else if (assetId) {
        // Detectar si el drop cayó sobre un forge-node
        const allNodes = getNodes()
        const targetNode = allNodes.find(n => {
          const data = n.data as { canvasNode?: CanvasNode }
          if (data.canvasNode?.node_type !== 'forge_node') return false
          const nw = n.measured?.width  ?? NODE_W
          const nh = n.measured?.height ?? 160
          return (
            position.x >= n.position.x &&
            position.x <= n.position.x + nw &&
            position.y >= n.position.y &&
            position.y <= n.position.y + nh
          )
        })

        const res = await canvasFetch<{ success: boolean; project_node: { id: string }; already_exists?: boolean }>(
          `/api/projects/${project.id}/canvas/add-asset-node`,
          { method: 'POST', body: JSON.stringify({ asset_id: assetId }) },
        )
        const assetNodeId = res.project_node.id

        // Posicionar el asset-node
        if (!res.already_exists) {
          pendingPositionsRef.current[assetNodeId] = targetNode
            ? { x: targetNode.position.x - ASSET_NODE_W - 60, y: targetNode.position.y + 40 }
            : position
        } else if (targetNode) {
          // Ya existía en canvas — reposicionar a la izquierda del target
          pendingPositionsRef.current[assetNodeId] = {
            x: targetNode.position.x - ASSET_NODE_W - 60,
            y: targetNode.position.y + 40,
          }
        }

        // Crear edge si el drop fue sobre un forge-node y no existe ya
        if (targetNode) {
          const edgeId = `e-${assetNodeId}-${targetNode.id}`
          const alreadyConnected = edgesRef.current.some(e => e.id === edgeId)
          if (!alreadyConnected) {
            const newEdge: Edge = {
              id:        edgeId,
              source:    assetNodeId,
              target:    targetNode.id,
              type:      'forgeEdge',
              deletable: true,
              data:      { color: '#6b7280', active: false },
            }
            // persistEdges filtra los edges virtuales de lane y conserva los handles
            await persistEdges([...edgesRef.current, newEdge])
          }
        }

        await loadCanvas(true)
      }
    } catch (err) {
      console.error('[forge-canvas] drop failed', err)
    }
  }, [project.id, screenToFlowPosition, loadCanvas, getNodes, persistEdges])

  async function removeNodeById(projectNodeId: string) {
    try {
      await canvasFetch(`/api/projects/${project.id}/canvas/nodes/${projectNodeId}`, { method: 'DELETE' })
      setNodes(prev => prev.filter(n => n.id !== projectNodeId))
      setEdges(prev => prev.filter(e => e.source !== projectNodeId && e.target !== projectNodeId))
      setCanvasData(prev => prev
        ? { ...prev, nodes: prev.nodes.filter(cn => cn.project_node_id !== projectNodeId) }
        : prev
      )
      requestAnimationFrame(persistLayout)
    } catch (e) {
      // El servidor rechaza borrar un nodo aprobado. Sin decirlo, el nodo se quedaba en pantalla
      // y parecía que el clic no había hecho nada.
      console.error('[forge-canvas] remove failed', e)
      const msg = String((e as Error)?.message || e)
      if (/approved output/i.test(msg)) alert('This node has approved output and cannot be removed.\nReopen it and undo the approval first.')
    }
  }

  function nodeHasContent(projectNodeId: string): boolean {
    const cn = canvasData?.nodes.find(n => n.project_node_id === projectNodeId)
    if (!cn) return false
    return !!cn.session?.has_content || Object.values(cn.output_sessions ?? {}).some(s => s.has_content)
  }

  function nodeIsApproved(projectNodeId: string): boolean {
    const cn = canvasData?.nodes.find(n => n.project_node_id === projectNodeId)
    if (!cn) return false
    const gs = cn.session?.status
    if (gs === 'approved' || gs === 'auto_approved') return true
    // Los outputs `deferred` se producen en otra etapa y NUNCA se aprueban acá. Contarlos hacía
    // que un nodo aprobado no diera aprobado para esta comprobación: el panel escondía el botón
    // de borrar y el arrastre al panel izquierdo sí lo dejaba pasar. Misma regla que la tarjeta.
    const aOuts = (cn.node?.outputs ?? []).filter(
      o => (o as unknown as { production?: string }).production !== 'deferred',
    )
    return aOuts.length > 0 && aOuts.every((o: { key?: string }) => {
      const s = (cn.output_sessions ?? {})[(o.key ?? '')]?.status
      return s === 'approved' || s === 'auto_approved'
    })
  }

  async function handleRemoveNode() {
    if (!selectedNode) return
    if (nodeIsApproved(selectedNode.project_node_id)) return
    if (nodeHasContent(selectedNode.project_node_id)) {
      setPendingRemoveId(selectedNode.project_node_id)
      setSelectedNode(null)
      return
    }
    setRemoving(true)
    setSelectedNode(null)
    try {
      await removeNodeById(selectedNode.project_node_id)
    } finally {
      setRemoving(false)
    }
  }

  const handleNodeDragStart = useCallback((_event: React.MouseEvent, node: import('@xyflow/react').Node) => {
    if (node.type !== 'laneGroup') setDraggingNodeId(node.id)
    if (node.type === 'laneGroup') {
      const laneData = node.data as unknown as LaneGroupData
      const allNodes = getNodes()
      const relPos: Record<string, { x: number; y: number }> = {}
      for (const n of allNodes) {
        if (laneData.memberNodeIds.includes(n.id)) {
          relPos[n.id] = { x: n.position.x - node.position.x, y: n.position.y - node.position.y }
        }
      }
      laneGroupDragRef.current = { laneGroupId: node.id, memberNodeIds: laneData.memberNodeIds, relativePositions: relPos }
    }
  }, [getNodes])

  const handleNodeDrag = useCallback((_event: React.MouseEvent, node: import('@xyflow/react').Node) => {
    if (node.type !== 'laneGroup' || !laneGroupDragRef.current) return
    const { memberNodeIds, relativePositions } = laneGroupDragRef.current
    setNodes(prev => prev.map(n => {
      if (!memberNodeIds.includes(n.id)) return n
      const rel = relativePositions[n.id]
      if (!rel) return n
      return { ...n, position: { x: node.position.x + rel.x, y: node.position.y + rel.y } }
    }))
  }, [setNodes])

  const handleNodeDragStop = useCallback((event: React.MouseEvent, node: import('@xyflow/react').Node) => {
    laneGroupDragRef.current = null
    persistLayout()
    syncLaneNodes()
    if (node.type !== 'laneGroup' && dropZoneRef.current) {
      // getBoundingClientRect ya devuelve coords de pantalla reales (incluye zoom CSS)
      const rect = dropZoneRef.current.getBoundingClientRect()
      if (
        event.clientX >= rect.left && event.clientX <= rect.right &&
        event.clientY >= rect.top  && event.clientY <= rect.bottom
      ) {
        if (nodeIsApproved(node.id)) {
          // Antes no pasaba nada y en silencio: soltarlo ahí se leía como que el arrastre había
          // fallado, no como que el nodo está protegido.
          setBloqueado(node.id)
        } else {
          // Siempre pregunta. Un nodo sin contenido se borraba de una al soltarlo, y soltar es
          // fácil de hacer sin querer mientras se acomoda el canvas.
          setPendingRemoveId(node.id)
        }
      }
    }
    setDraggingNodeId(null)
  }, [persistLayout, syncLaneNodes])

  // Topological sort: devuelve tiers de project_node_ids en orden de ejecución
  function topoTiers(nodes: CanvasNode[], edges: DbEdge[]): string[][] {
    const forgeNodes = nodes.filter(n => n.node_type === 'forge_node')
    const ids        = new Set(forgeNodes.map(n => n.project_node_id))
    const inDegree:  Record<string, number>   = {}
    const children:  Record<string, string[]> = {}

    for (const n of forgeNodes) {
      inDegree[n.project_node_id]  = 0
      children[n.project_node_id]  = []
    }

    for (const e of edges) {
      if (ids.has(e.source) && ids.has(e.target)) {
        inDegree[e.target]++
        children[e.source].push(e.target)
      }
    }

    const tiers: string[][] = []
    let remaining = new Set(Object.keys(inDegree))

    while (remaining.size > 0) {
      const tier = [...remaining].filter(id => inDegree[id] === 0)
      if (!tier.length) break  // ciclo — no debería ocurrir
      tiers.push(tier)
      for (const id of tier) {
        remaining.delete(id)
        for (const child of children[id]) inDegree[child]--
      }
    }

    return tiers
  }

  async function handleNameChange(name: string) {
    await updateProjectName(project.id, name)
    setLocalName(name)
    localStorage.setItem('forge_last_project', JSON.stringify({ id: project.id, name }))
  }

  // Corre el pipeline completo — alias del scope 'pipeline'
  async function handleRunAll() {
    return runScope({ type: 'pipeline' })
  }

  // ¿Un nodo pertenece al alcance del run? pipeline = todos; lane/blueprint = solo los suyos
  function nodeInScope(n: CanvasNode, scope: RunScope): boolean {
    if (scope.type === 'pipeline')  return true
    if (scope.type === 'lane')      return n.lane_id === scope.lane_id
    return n.blueprint_id === scope.blueprint_id
  }

  // Nodos que el run arrancaría SIN contexto real: forge_nodes runnable dentro del scope
  // que son "raíz" — ninguno de sus inputs proviene de un Text Input con texto, un Library
  // Asset o un forge_node upstream. Sin fuente conectada, el backend igual corre usando solo
  // el nombre del proyecto como referencia (buildSystemPrompt rellena [project] siempre), lo
  // que produce output genérico. Devuelve los títulos de esos nodos para avisar antes de correr.
  function contextlessRunRoots(scope: RunScope): string[] {
    if (!canvasData) return []
    const nodes = canvasData.nodes
    const edges = canvasData.edges as DbEdge[]

    // Fuentes de contexto válidas: Text Input con texto, o Library Asset conectado
    // (un asset vacío lo bloquea el backend con empty_source por separado).
    const contextSourceIds = new Set(
      nodes.filter(n =>
        (n.node_type === 'text_input' && !!n.text_content?.trim()) ||
        n.node_type === 'library_asset'
      ).map(n => n.project_node_id)
    )
    // Un forge_node upstream también aporta contexto (su output alimenta al de abajo)
    const forgeIds = new Set(
      nodes.filter(n => n.node_type === 'forge_node').map(n => n.project_node_id)
    )

    const incomingByTarget = new Map<string, string[]>()
    for (const e of edges) {
      if (!incomingByTarget.has(e.target)) incomingByTarget.set(e.target, [])
      incomingByTarget.get(e.target)!.push(e.source)
    }

    const roots: string[] = []
    for (const n of nodes) {
      if (!nodeInScope(n, scope) || !isNodeRunnable(n)) continue
      const incoming = incomingByTarget.get(n.project_node_id) ?? []
      const hasContext = incoming.some(srcId => contextSourceIds.has(srcId) || forgeIds.has(srcId))
      if (!hasContext) roots.push(n.node?.title ?? n.node?.node_key ?? 'Untitled node')
    }
    return roots
  }

  // Entrada del Run por alcance. El pipeline cruza gates → pide autorización (modal #4)
  // salvo que el usuario ya la haya recordado en run_config. lane/blueprint corren directo.
  async function runScope(scope: RunScope, opts: { skipContextCheck?: boolean } = {}) {
    if (!canvasData) return
    if (runLockRef.current) return  // ya hay un run en curso — evitar solapes

    // Pre-flight: si algún nodo raíz correría sin contexto (sin idea ni asset conectado),
    // avisar antes de gastar el run — el usuario puede seguir igual desde el modal.
    if (!opts.skipContextCheck) {
      const roots = contextlessRunRoots(scope)
      if (roots.length > 0) {
        setNoContextModal({ scope, roots })
        return
      }
    }

    if (scope.type === 'pipeline') {
      let mode: GateAuthMode = 'pause'
      try {
        const plan = await runPlan(project.id, scope)
        if (plan.requires_authorization) {
          if (plan.remembered) {
            mode = plan.remembered.mode  // decisión recordada — sin modal
          } else {
            setGateMode('pause')
            setGateRemember(false)
            setRunPlanModal({ plan, scope })
            return  // espera la decisión del usuario en el modal
          }
        }
      } catch (e) {
        // El plan es best-effort — si falla, continuar con el run igual (modo pause)
        console.error('[run-plan] failed:', e)
      }
      return runPipeline(mode)
    }

    // lane / blueprint — un solo alcance, no cruzan gates
    runLockRef.current = true
    try { await executeRunScope(scope) }
    finally { runLockRef.current = false }
  }

  // Confirmación del modal de autorización: persiste la decisión (si remember) y arranca el loop.
  async function confirmRunPlan() {
    const ctx = runPlanModal
    if (!ctx) return
    const mode = gateMode
    if (gateRemember) {
      try { await saveRunConfig(project.id, { mode, remember: true }) } catch { /* no bloquear el run */ }
    }
    setRunPlanModal(null)
    await runPipeline(mode)
  }

  // Loop full-pipeline gate-crossing (#5): corre fase → evalúa gate → [auto-accept|pausa] →
  // recarga (fan-out incluido) → recomputa tiers. Consume el modo de autorización (#4).
  async function runPipeline(mode: GateAuthMode) {
    if (runLockRef.current) return
    runLockRef.current = true
    try {
      let data: CanvasData | null = canvasData
      const MAX_PHASES = 8  // cota de seguridad contra loops infinitos
      for (let i = 0; i < MAX_PHASES; i++) {
        // 1. Correr los runnable del pipeline (excluye sellados) con el estado más fresco
        data = await executeRunScope({ type: 'pipeline' }, data)
        if (!data) return  // error de validación/ejecución — executeRunScope ya lo reportó

        // 2. ¿El gate de la fase viva quedó listo?
        if (!isGateReady(data)) break

        // 3. Modo pause → el gate UI aparece solo (gateOpen); el usuario decide manualmente
        if (mode === 'pause') break

        // 4. Modo auto_accept → cruzar el gate (sella + carga siguiente + fan-out)
        const bpId = data.active_blueprint?.id
        if (!bpId) break
        const next = await acceptGateCore(bpId)
        if (!next?.next_blueprint) break  // última fase o sin siguiente blueprint

        // 5. Recargar canvas (nueva fase + lanes) y recomputar en la próxima vuelta
        data = await loadCanvas(true)
        if (!data) break
      }
    } finally {
      runLockRef.current = false
    }
  }

  // Núcleo del gate ACCEPT — persiste layout, postea la decisión y devuelve la respuesta.
  // Compartido por el botón manual (handleGateDecision) y el loop de pipeline (#5).
  async function acceptGateCore(blueprintId: string): Promise<{ next_blueprint: { id: string; name: string; phase: string } | null } | null> {
    // Persistir posiciones antes del fan-out para que el backend ubique las lanes correctamente
    await persistLayout()
    const memberId = typeof window !== 'undefined' ? localStorage.getItem('forge_member_id') : null
    const resp = await canvasFetch<{ success: boolean; decision: string; next_blueprint: { id: string; name: string; phase: string } | null }>(
      `/api/projects/${project.id}/canvas/gate`,
      { method: 'POST', body: JSON.stringify({ decision: 'ACCEPT', blueprint_id: blueprintId, member_id: memberId }) },
    )
    // Forzar re-aplicar canvas_layout del DB: el fan-out guarda posiciones nuevas
    dbLayoutAppliedRef.current = false
    autoNormalizeRef.current   = true
    return resp
  }

  // Motor de ejecución automática parametrizado por alcance (pipeline / lane / blueprint).
  // lane y blueprint NO cruzan gates ni re-ejecutan upstream fuera del scope (locked).
  // Acepta datos frescos (dataOverride) para el loop de pipeline (#5) y devuelve el estado
  // recargado tras correr (o null si hubo error/validación fallida).
  async function executeRunScope(scope: RunScope, dataOverride?: CanvasData | null): Promise<CanvasData | null> {
    const data = dataOverride ?? canvasData
    if (!data) return null
    const memberId = typeof window !== 'undefined' ? localStorage.getItem('forge_member_id') ?? undefined : undefined

    // Validar inputs — scope-aware
    const validation = await runValidate(project.id, scope)
    if (!validation.valid) {
      setRunErrors(validation.errors)
      setRunPhase('error')
      return null
    }

    const nodes = data.nodes
    const edges = data.edges as DbEdge[]

    // Determinar qué nodos correr — pendientes dentro del scope
    const runnable = new Set(
      nodes
        .filter(n => nodeInScope(n, scope) && isNodeRunnable(n))
        .map(n => n.project_node_id)
    )

    const tiers = topoTiers(nodes, edges).map(tier => tier.filter(id => runnable.has(id))).filter(t => t.length > 0)
    const total = tiers.flat().length

    if (total === 0) return data  // nada que correr — devuelve estado actual para evaluar el gate

    setRunPhase('running')
    setRunProgress({ done: 0, total })
    setRunErrors([])
    setRunErrorNodeId(null)

    let done = 0

    for (const tier of tiers) {
      setRunningNodeIds(new Set(tier))

      const results = await Promise.allSettled(
        tier.map(projectNodeId => autoRunNode(project.id, projectNodeId, memberId))
      )

      setRunningNodeIds(new Set())

      // Marcar nodos completados como auto_approved en el estado local — inmediato
      const succeeded = results
        .map((r, i) => ({ r, id: tier[i] }))
        .filter(({ r }) => r.status === 'fulfilled')
        .map(({ id }) => id)

      if (succeeded.length > 0) {
        setCanvasData(prev => prev ? {
          ...prev,
          nodes: prev.nodes.map(n => {
            if (!succeeded.includes(n.project_node_id)) return n
            return {
              ...n,
              is_stale: false,
              session: n.session
                ? { ...n.session, status: 'auto_approved' as const, has_content: true }
                : { id: '', status: 'auto_approved' as const, node_id: n.node?.id ?? '', iteration_count: 1, started_at: null, completed_at: null, output_asset_id: null, output_images: null, output_asset: null, has_content: true },
            }
          }),
        } : null)

      }

      const failed = results
        .map((r, i) => ({ r, id: tier[i] }))
        .filter(({ r }) => r.status === 'rejected')

      if (failed.length > 0) {
        const errorId = failed[0].id
        const reason  = (failed[0].r as PromiseRejectedResult).reason?.message ?? 'Unknown error'
        setRunErrorNodeId(errorId)
        const failedNode = data.nodes.find(n => n.project_node_id === errorId)
        setRunErrors([{
          projectNodeId: errorId,
          nodeTitle:     failedNode?.node?.title ?? errorId,
          nodeKey:       failedNode?.node?.node_key ?? '',
          reason,
          type:          'empty_source',
        }])
        setRunPhase('error')
        await loadCanvas(true)
        return null
      }

      done += tier.length
      setRunProgress({ done, total })
    }

    setRunPhase('idle')
    setRunProgress(null)
    return await loadCanvas(true)
  }

  // Abre el chat cargando la sesión persistida del nodo (o de un output específico)
  async function handleRunNode(node: CanvasNode, outputKey?: string | null) {
    // Sincronizar el target del chat con esta apertura. Un "Run node" general (sin outputKey) debe
    // resetear el target a null; si no, hereda un chatTargetOutputKey stale de un focus previo
    // (bug: creaba la sesión general con el output_key de otro nodo, ej. visual_targets del 3.9).
    setChatTargetOutputKey(outputKey ?? null)
    if (!outputKey) setChatTargetOutputLabel(null)
    // Si no se especifica output y el nodo ya tiene per-output sessions → abrir output modal
    if (!outputKey && Object.keys(node.output_sessions ?? {}).length > 0) {
      setSelectedNode(null)
      setPendingOutputModalId(node.project_node_id)
      return
    }
    setSelectedNode(null)
    setChatLoading(true)
    try {
      const { session, messages, asset } = await getNodeSession(project.id, node.node!.id, outputKey, node.project_node_id)
      setChatSessionId(session?.id ?? null)
      setChatMessages(messages)
      setChatOutputImages((session?.output_images as OutputImagesMap) ?? {})
      setChatApprovedAsset(asset ?? null)
    } catch {
      setChatSessionId(null)
      setChatMessages([])
      setChatOutputImages({})
    } finally {
      setChatLoading(false)
    }
    setChatNode(node)
  }

  if (loading) {
    return (
      <>
        <ForgeToolbar project={{ ...project, name: localName }} phase="idle" onRefresh={onRefresh} approvedCount={0} totalCount={0} />
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 14 }}>
          <style>{SPIN_KF}</style>
          <img src="/forgy/forgyi.png" alt="Forge" width={28} height={28} style={{ objectFit: 'contain', animation: 'canvas-spin 2s linear infinite' }} />
          <span style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color: 'var(--text-3)', textTransform: 'uppercase', letterSpacing: '0.1em' }}>
            Loading canvas…
          </span>
        </div>
      </>
    )
  }

  const canvasScale = TEXT_SIZE_SCALES[textSize]

  return (
    <CanvasScaleContext.Provider value={canvasScale}>
    <DraggingContext.Provider value={draggingNodeId !== null}>
    <PendingOutputModalContext.Provider value={{ nodeId: pendingOutputModalId, outputKey: pendingOutputModalKey, clear: clearPendingOutputModal }}>
    <>
    <ForgeToolbar
      project={{ ...project, name: localName }}
      phase={runPhase}
      onRefresh={refrescarTodo}
      onNameChange={handleNameChange}
      onRunPipeline={runPhase === 'idle' ? handleRunAll : undefined}
      onRunScope={runPhase === 'idle' ? runScope : undefined}
      runMenu={runMenu}
      onExport={() => setShowExportModal(true)}
      runProgress={runProgress ?? undefined}
      approvedCount={approvedNodeIds.size}
      totalCount={canvasNodeIds.size}
      runnableCount={runnableCount}
    />
    <div style={{ flex: 1, display: 'flex', flexDirection: 'row', overflow: 'hidden' }}>
      {/* Sidebar izquierdo — catálogo de nodos */}
      <NodeLibrarySidebar
        projectId={project.id}
        canvasNodeIds={canvasNodeIds}
        approvedNodeIds={approvedNodeIds}
        onAdded={() => loadCanvas(true)}
        collapsed={sidebarCollapsed}
        onCollapsedChange={setSidebarCollapsed}
        onFocusNode={handleFocusNode}
        isDroppingNode={!!draggingNodeId && !nodeIsApproved(draggingNodeId)}
        dropZoneRef={dropZoneRef}
      />

      {/* Área principal: blueprint bar + canvas */}
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
        <BlueprintBar
          activeBlueprint={canvasData?.active_blueprint ?? null}
          projectId={project.id}
          onLoaded={() => loadCanvas(true)}
          projectName={localName}
          isOwner={typeof window !== 'undefined' && localStorage.getItem('forge_member_id') === project.owner_member_id}
          onNameChange={handleNameChange}
        />

        <div style={{ flex: 1, position: 'relative', overflow: 'hidden' }}>
          {/* Fondo punteado */}
          <div style={{ position: 'absolute', inset: 0, pointerEvents: 'none', backgroundImage: 'radial-gradient(circle, var(--line-2) 1px, transparent 1px)', backgroundSize: '28px 28px', opacity: 0.6 }} />

          {/* Zoom controls */}
          <div style={{ position: 'absolute', bottom: 16, right: 16, zIndex: 10, display: 'flex', alignItems: 'center', gap: 4, background: 'var(--bg-1)', borderRadius: 10, border: '1px solid var(--line-2)', boxShadow: '0 2px 12px rgba(0,0,0,0.22)', padding: '5px 8px' }}>
            {([
              { label: '+', action: () => zoomIn({ duration: 200 }),                title: 'Zoom in'     },
              { label: '−', action: () => zoomOut({ duration: 200 }),               title: 'Zoom out'    },
              { label: '⊡', action: () => fitView({ padding: 0.3, duration: 300 }), title: 'Fit view'    },
              { label: '↺', action: () => resetLayout(),                             title: 'Reset layout' },
              { label: '≣', action: () => autoArrange(),                             title: 'Auto-arrange (tidy DAG layout)' },
            ] as const).map(({ label, action, title }) => (
              <button key={label} title={title} onClick={action} style={{ padding: '5px 10px', borderRadius: 6, border: '1px solid var(--line-2)', background: 'var(--bg-2)', color: 'var(--text-1)', cursor: 'pointer', fontSize: 11, fontFamily: 'var(--font-mono)', fontWeight: 600 }}>
                {label}
              </button>
            ))}
            {/* Separador */}
            <div style={{ width: 1, height: 16, background: 'var(--line-2)', margin: '0 2px', flexShrink: 0 }} />
            {/* Botones de tamaño de texto */}
            {(['sm', 'md', 'lg'] as const).map((size, i) => (
              <button
                key={size}
                title={{ sm: 'Small text', md: 'Medium text', lg: 'Large text' }[size]}
                onClick={() => applyTextSize(size)}
                style={{
                  padding: '3px 7px', borderRadius: 6, cursor: 'pointer',
                  border: `1px solid ${textSize === size ? 'var(--accent, #7c6af7)' : 'var(--line-2)'}`,
                  background: textSize === size ? 'color-mix(in srgb, var(--accent, #7c6af7) 15%, var(--bg-2))' : 'var(--bg-2)',
                  color: textSize === size ? 'var(--accent, #7c6af7)' : 'var(--text-2)',
                  fontFamily: 'var(--font-mono)', fontWeight: 700,
                  fontSize: [9, 11, 13][i],
                  lineHeight: 1, transition: 'all 150ms',
                }}
              >
                A
              </button>
            ))}
            <span style={{ fontSize: 10, fontFamily: 'var(--font-mono)', color: 'var(--text-3)', minWidth: 32, textAlign: 'right' }}>
              {Math.round(zoom * 100)}%
            </span>
            {/* Separador */}
            <div style={{ width: 1, height: 16, background: 'var(--line-2)', margin: '0 2px', flexShrink: 0 }} />
            {/* Toggle estilo de edge */}
            <button
              title={edgeStyle === 'bezier' ? 'Switch to orthogonal edges' : 'Switch to bezier edges'}
              onClick={toggleEdgeStyle}
              style={{
                padding: '3px 8px', borderRadius: 6, cursor: 'pointer',
                border: `1px solid ${edgeStyle === 'orthogonal' ? 'var(--accent, #7c6af7)' : 'var(--line-2)'}`,
                background: edgeStyle === 'orthogonal' ? 'color-mix(in srgb, var(--accent, #7c6af7) 15%, var(--bg-2))' : 'var(--bg-2)',
                color: edgeStyle === 'orthogonal' ? 'var(--accent, #7c6af7)' : 'var(--text-2)',
                fontFamily: 'var(--font-mono)', fontSize: 10, fontWeight: 700, lineHeight: 1,
                transition: 'all 150ms',
              }}
            >
              {edgeStyle === 'bezier' ? '~' : '⌐'}
            </button>
          </div>

          {/* Estado vacío */}
          {canvasData?.nodes.length === 0 && (
            <div style={{ position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 10, pointerEvents: 'none' }}>
              <span style={{ fontSize: 36, opacity: 0.18 }}>⬡</span>
              <span style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--text-3)' }}>
                Add nodes from the library or load a blueprint
              </span>
            </div>
          )}

          <ReactFlow
            nodes={nodes}
            edges={displayEdges}
            onNodesChange={onNodesChange}
            onEdgesChange={onEdgesChangeSafe}
            onConnect={onConnect}
            onEdgeClick={onEdgeClick}
            onPaneClick={onPaneClick}
            onNodeDragStart={handleNodeDragStart}
            onNodeDrag={handleNodeDrag}
            onNodeDragStop={handleNodeDragStop}
            onNodeMouseEnter={(_, node) => { if (!node.id.startsWith('lane-')) setHoveredNodeId(node.id) }}
            onNodeMouseLeave={() => setHoveredNodeId(null)}
            onMoveStart={() => setMoving(true)}
            onMoveEnd={() => { setMoving(false); persistLayout() }}
            className={(moving || zoom > 1.5) ? 'rf-moving' : undefined}
            onDragOver={handleDragOver}
            onDrop={handleDrop}
            nodeTypes={NODE_TYPES}
            edgeTypes={EDGE_TYPES}
            proOptions={{ hideAttribution: true }}
            fitView={false}
            nodesDraggable
            nodesConnectable
            deleteKeyCode={null}
            isValidConnection={c => c.source !== c.target && !c.target.startsWith('lane-')}
            // Los puntos de conexión miden 10 px y el default de captura son 20: adentro de un
            // lane, con el fondo del contenedor detrás, el punto se ve poco y es fácil soltar
            // fuera — y soltar fuera es el cable rojo, sin cable.
            connectionRadius={45}
            style={{ background: 'transparent' }}
          />
        </div>
      </div>

      {/* Panel de detalle (overlay) */}
      {selectedNode && (
        <ForgeNodePanel
          canvasNode={selectedNode}
          onClose={() => setSelectedNode(null)}
          onRemove={handleRemoveNode}
          onRun={() => handleRunNode(selectedNode)}
          onImportedAsOutput={() => { setSelectedNode(null); loadCanvas(true) }}
          removing={removing}
          locked={lockedNodeIds.has(selectedNode.project_node_id)}
          projectId={project.id}
          canvasNodes={canvasData?.nodes ?? []}
          edges={edges}
        />
      )}

      {/* Ventana de chat con el nodo */}
      {chatNode && chatNode.node && !chatLoading && (() => {
        const chatForgeNode = chatNode.node
        return (
        <NodeChatWindow
          stepKey={chatForgeNode.node_key}
          stepLabel={`${chatForgeNode.node_key} — ${chatForgeNode.title}`}
          currentOutput={chatNode.session ?? null}
          project={project}
          locked={(() => {
            // Gate nodes nunca se bloquean — son conversacionales y el usuario siempre puede re-aceptar
            if (chatForgeNode.role === 'gate') return false
            // Si el chat está enfocado en un output específico, verificar su per-output session
            if (chatTargetOutputKey) {
              const s = (chatNode.output_sessions ?? {})[chatTargetOutputKey]?.status
              return s === 'approved' || s === 'auto_approved'
            }
            // Sin target: verificar sesión general o todos los outputs aprobados
            const gs = chatNode.session?.status
            if (gs === 'approved' || gs === 'auto_approved') return true
            const cOuts = (chatForgeNode.outputs ?? [])
            return cOuts.length > 0 && cOuts.every((o: { key?: string }) => {
              const s = (chatNode.output_sessions ?? {})[(o.key ?? '')]?.status
              return s === 'approved' || s === 'auto_approved'
            })
          })()}
          initialMessages={chatMessages}
          onSend={async (msg, file, attachmentUrl, signal) => {
            const r = await chatWithForgeNode(project.id, chatForgeNode.id, msg, chatSessionId ?? undefined, file, attachmentUrl, chatTargetOutputKey, chatNode.project_node_id, signal)
            // Siempre setear (o resetear): si la respuesta nueva no trae doc (ej. connection),
            // limpiar el docUrl viejo para que no quede un botón de descarga stale.
            setChatDocUrl(r.doc_url ?? null); setChatDocFormat(r.doc_format ?? null)
            // Actualizar sesión en el estado local si es nueva
            chatSessionIdRef.current = r.session_id
            if (!chatSessionId) {
              setChatSessionId(r.session_id)
              const newSess: ForgeSession = { id: r.session_id, node_id: chatForgeNode.id, status: 'active' as const, iteration_count: 1, started_at: new Date().toISOString(), completed_at: null, output_asset_id: null, output_images: null, output_asset: null, has_content: true }
              setCanvasData(prev => prev ? {
                ...prev,
                nodes: prev.nodes.map(n => {
                  if (n.node?.id !== chatForgeNode.id) return n
                  if (chatTargetOutputKey) {
                    // Sesión de output específico — va en output_sessions
                    return { ...n, output_sessions: { ...(n.output_sessions ?? {}), [chatTargetOutputKey]: newSess } }
                  }
                  // Sesión general del nodo
                  return { ...n, session: newSess }
                }),
              } : null)
            } else {
              setChatSessionId(r.session_id)
            }
            return { reply: r.reply, attachment: r.attachment, messageId: r.message_id }
          }}
          onAccept={async (content) => {
            if (!chatSessionId) return
            await acceptNodeOutput(project.id, chatForgeNode.id, chatSessionId, content, chatDocUrl ?? undefined, chatDocFormat ?? undefined)
            invalidateAssetDeckCache(project.id, chatForgeNode.id)
            setChatNode(null)
            setChatMessages([])
            setChatSessionId(null)
            setChatDocUrl(null)
            setChatDocFormat(null)
            setChatOutputImages({})
            setChatApprovedAsset(null)
            // Recargar canvas para obtener output_asset actualizado
            loadCanvas(true)
          }}
          docUrl={chatDocUrl ?? undefined}
          docFormat={chatDocFormat ?? undefined}
          // Lo aprobado de los OTROS outputs del nodo. El pitch document declara sus imágenes en
          // su plan, y corriendo output por output ese plan no viene en la respuesta — está en su
          // propio asset. Sin esto el chat avisaba «no hay imágenes que ofrecer» con el plan
          // aprobado ahí mismo.
          siblingContent={(() => {
            const m: Record<string, string> = {}
            for (const [k, s] of Object.entries(chatNode.output_sessions ?? {})) {
              const c = (s as { output_asset?: { content?: string | null } })?.output_asset?.content
              if (c && k !== chatTargetOutputKey) m[k] = c
            }
            return m
          })()}
          imageGenOutputs={(() => {
            const defs: ImageOutputDef[] = []
            for (const out of (chatForgeNode.outputs ?? [])) {
              const o = out as unknown as { production?: string; pages?: number[]; uses?: { siblings?: string[]; siblings_if_present?: string[] } }
              // `production: deferred` se produce en otra etapa: el Art Bible compone arte
              // aprobado que en pre-producción no existe. El chat lo intentaba igual y el
              // servidor respondía 500.
              if (o.production === 'deferred') continue
              // Un DECK no se genera ítem por ítem: sus páginas son nodos fijos de un mismo
              // grafo y se despachan juntas desde el Run. Se reconoce porque declara `pages`.
              if (Array.isArray(o.pages) && o.pages.length) continue
              if (out.image_gen && out.image_gen_model) {
                defs.push({
                  outputKey: out.key || out.name, format: out.format, imageGenModel: out.image_gen_model,
                  // Qué hermano DECLARA sus imágenes. El pitch document no las decide: las decide
                  // `pitch_image_plan`, una entrada por imagen con su título. Sin esto, el
                  // documento sacaba los sujetos de su propia prosa y mandaba a ComfyUI las
                  // viñetas de «Numbers That Matter» — datos de mercado como si fueran arte.
                  declaradasPor: (o.uses?.siblings_if_present ?? o.uses?.siblings ?? [])
                    .find(k => /plan$/i.test(k)) ?? null,
                })
              }
            }
            return defs.length > 0 ? defs : undefined
          })()}
          outputImages={chatOutputImages}
          onGenerateItemImage={async (outputKey, itemIndex, itemText, condition, messageId) => {
            const sid = chatSessionIdRef.current ?? chatSessionId
            if (!sid) return { output_images: {} } as never
            const r = await generateItemImage(project.id, chatForgeNode.id, sid, outputKey, itemIndex, itemText, condition, messageId)
            const imgs = r.output_images
            setChatOutputImages(imgs)
            setCanvasData(prev => prev ? {
              ...prev,
              nodes: prev.nodes.map(n => {
                if (n.node?.id !== chatForgeNode.id) return n
                // Actualizar per-output session si el chat está enfocado en un output específico
                if (chatTargetOutputKey && (n.output_sessions ?? {})[chatTargetOutputKey]) {
                  const outSess = n.output_sessions![chatTargetOutputKey]
                  return { ...n, output_sessions: { ...n.output_sessions, [chatTargetOutputKey]: { ...outSess, output_images: imgs } } }
                }
                if (n.session) return { ...n, session: { ...n.session, output_images: imgs } }
                return n
              }),
            } : null)
            return r
          }}
          approvedAsset={chatApprovedAsset ?? undefined}
          isGate={chatForgeNode.role === 'gate'}
          projectNodeId={chatNode.project_node_id ?? undefined}
          onOpenOutput={(srcProjectNodeId, outputKey) => {
            setPendingOutputModalId(srcProjectNodeId)
            setPendingOutputModalKey(outputKey ?? null)
          }}
          targetOutputKey={chatTargetOutputKey}
          targetOutputLabel={chatTargetOutputLabel}
          systemPrompt={(() => {
            if (chatTargetOutputKey) {
              const targetOut = (chatForgeNode.outputs ?? []).find((o: { key?: string; name?: string }) => (o.key || o.name) === chatTargetOutputKey)
              return [chatForgeNode.default_prompt, (targetOut as { prompt?: string })?.prompt].filter(Boolean).join('\n\n') || undefined
            }
            return (chatForgeNode.default_prompt as string | undefined) || (chatForgeNode.standalone_prompt as string | undefined) || undefined
          })()}
          onClose={() => { setChatNode(null); setChatMessages([]); setChatSessionId(null); chatSessionIdRef.current = null; setChatDocUrl(null); setChatDocFormat(null); setChatOutputImages({}); setChatApprovedAsset(null); setChatTargetOutputKey(null); setChatTargetOutputLabel(null) }}
        />
        )
      })()}

      {/* ── Botón de gate — visible cuando el gate está listo pero fue descartado (REFINE) ── */}
      {gateReady && gateDismissed && !gateKilled && canvasData?.active_blueprint?.gate && (
        <button
          onClick={() => setGateDismissed(false)}
          style={{
            position: 'fixed', top: 120, left: '50%', transform: 'translateX(-50%)', zIndex: 9000,
            padding: '8px 18px', borderRadius: 8,
            background: '#34D399', color: '#000',
            border: 'none', cursor: 'pointer',
            fontFamily: 'var(--font-mono)', fontSize: 11, fontWeight: 700,
            boxShadow: '0 4px 20px rgba(52,211,153,0.35)',
            display: 'flex', alignItems: 'center', gap: 6,
            transition: 'opacity 150ms, box-shadow 150ms',
          }}
          onMouseEnter={e => { e.currentTarget.style.boxShadow = '0 6px 28px rgba(52,211,153,0.55)' }}
          onMouseLeave={e => { e.currentTarget.style.boxShadow = '0 4px 20px rgba(52,211,153,0.35)' }}
        >
          ◉ {canvasData.active_blueprint.gate.name}
        </button>
      )}

      {/* ── Banner de kill — visible cuando el gate fue matado (KILL) ── */}
      {gateReady && gateKilled && canvasData?.active_blueprint?.gate && (
        <div style={{
          position: 'fixed', top: 120, left: '50%', transform: 'translateX(-50%)', zIndex: 9000,
          display: 'flex', alignItems: 'center', gap: 12,
          padding: '8px 16px 8px 14px', borderRadius: 8,
          background: 'color-mix(in srgb, #EF4444 12%, var(--bg-1))',
          border: '1px solid color-mix(in srgb, #EF4444 40%, transparent)',
          boxShadow: '0 4px 20px rgba(239,68,68,0.2)',
        }}>
          <span style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: '#EF4444', fontWeight: 700 }}>
            ✕ {canvasData.active_blueprint.gate.name} — killed
          </span>
          <span style={{ width: 1, height: 14, background: 'var(--line-2)' }} />
          <button
            onClick={() => { setGateKilled(false); setGateDismissed(false) }}
            style={{
              background: 'none', border: 'none', cursor: 'pointer',
              fontFamily: 'var(--font-mono)', fontSize: 10,
              color: 'var(--text-3)', padding: 0,
              transition: 'color 120ms',
            }}
            onMouseEnter={e => { e.currentTarget.style.color = 'var(--text-0)' }}
            onMouseLeave={e => { e.currentTarget.style.color = 'var(--text-3)' }}
          >
            Reopen gate ↩
          </button>
        </div>
      )}

      {/* ── Modal de autorización de gates (Run de pipeline #4) ── */}
      {runPlanModal && (() => {
        const { plan } = runPlanModal
        const est = plan.estimated
        return (
          <div
            style={{ position: 'fixed', inset: 0, zIndex: 9500, background: 'rgba(0,0,0,.45)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
            onClick={() => setRunPlanModal(null)}
          >
            <div
              onClick={e => e.stopPropagation()}
              style={{ width: 440, maxWidth: '90vw', maxHeight: '82vh', overflowY: 'auto', background: 'var(--bg-1)', border: '1px solid var(--line)', borderRadius: 10, boxShadow: '0 16px 48px rgba(0,0,0,.4)', padding: 20 }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
                <span style={{ fontFamily: 'var(--font-mono)', fontSize: 13, fontWeight: 700, color: 'var(--text-1)', flex: 1 }}>
                  Run pipeline — authorize gates
                </span>
                <button
                  onClick={() => setRunPlanModal(null)}
                  style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-3)', fontSize: 14, padding: 0 }}
                >✕</button>
              </div>
              <p style={{ fontFamily: 'var(--font-sans)', fontSize: 11, color: 'var(--text-3)', margin: '0 0 14px' }}>
                This run crosses {plan.gates.length} gate{plan.gates.length === 1 ? '' : 's'}. Choose how each gate is handled.
              </p>

              {/* Fases del plan */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: 4, marginBottom: 12 }}>
                {plan.phases.map((ph, i) => (
                  <div key={ph.blueprint_id + i} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '5px 8px', borderRadius: 5, background: 'var(--bg-2)', border: '1px solid var(--line)' }}>
                    <span style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color: 'var(--text-1)', flex: 1, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                      {ph.is_current ? '▶ ' : ''}{ph.name}
                    </span>
                    {ph.sealed
                      ? <span style={{ fontFamily: 'var(--font-mono)', fontSize: 9, color: 'var(--text-3)' }}>sealed</span>
                      : <span style={{ fontFamily: 'var(--font-mono)', fontSize: 9, color: 'var(--text-3)' }}>{ph.node_count} node{ph.node_count === 1 ? '' : 's'}</span>}
                  </div>
                ))}
              </div>

              {/* Gates con fan-out detectado */}
              {plan.gates.some(g => g.will_fan_out) && (
                <div style={{ marginBottom: 12 }}>
                  {plan.gates.filter(g => g.will_fan_out).map((g, i) => (
                    <div key={i} style={{ fontFamily: 'var(--font-mono)', fontSize: 9, color: 'var(--accent, #6366F1)', padding: '2px 0' }}>
                      ⤳ {g.name}: fans out into {g.item_count} {g.item_type || 'item'}{g.item_count === 1 ? '' : 's'}
                    </div>
                  ))}
                </div>
              )}

              {/* Estimación de costo */}
              {est && (
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 10px', borderRadius: 6, background: 'var(--bg-2)', border: '1px solid var(--line)', marginBottom: 14 }}>
                  <span style={{ fontFamily: 'var(--font-sans)', fontSize: 10, color: 'var(--text-3)', flex: 1 }}>
                    ~{est.node_runs} node run{est.node_runs === 1 ? '' : 's'} · estimated cost
                  </span>
                  <span style={{ fontFamily: 'var(--font-mono)', fontSize: 12, fontWeight: 700, color: 'var(--text-1)' }}>
                    ${est.cost_usd.toFixed(2)}
                  </span>
                </div>
              )}

              {/* Modo de autorización */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginBottom: 14 }}>
                {([
                  { value: 'pause' as GateAuthMode,       label: 'Pause at each gate',  desc: 'Stop for manual review before crossing' },
                  { value: 'auto_accept' as GateAuthMode, label: 'Auto-accept gates',    desc: 'Cross gates automatically and keep running' },
                ]).map(opt => (
                  <label
                    key={opt.value}
                    style={{ display: 'flex', alignItems: 'flex-start', gap: 8, padding: '8px 10px', borderRadius: 6, cursor: 'pointer',
                      background: gateMode === opt.value ? 'color-mix(in srgb, var(--accent, #6366F1) 12%, var(--bg-2))' : 'var(--bg-2)',
                      border: `1px solid ${gateMode === opt.value ? 'var(--accent, #6366F1)' : 'var(--line)'}` }}
                  >
                    <input type="radio" name="gate-mode" checked={gateMode === opt.value} onChange={() => setGateMode(opt.value)} style={{ marginTop: 2 }} />
                    <div>
                      <div style={{ fontFamily: 'var(--font-sans)', fontSize: 11, fontWeight: 600, color: 'var(--text-1)' }}>{opt.label}</div>
                      <div style={{ fontFamily: 'var(--font-sans)', fontSize: 10, color: 'var(--text-3)' }}>{opt.desc}</div>
                    </div>
                  </label>
                ))}
              </div>

              {/* Remember */}
              <label style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 16, cursor: 'pointer' }}>
                <input type="checkbox" checked={gateRemember} onChange={e => setGateRemember(e.target.checked)} />
                <span style={{ fontFamily: 'var(--font-sans)', fontSize: 10, color: 'var(--text-3)' }}>Remember this choice for this project</span>
              </label>

              {/* Acciones */}
              <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
                <button
                  onClick={() => setRunPlanModal(null)}
                  style={{ fontFamily: 'var(--font-sans)', fontSize: 11, padding: '7px 14px', borderRadius: 6, border: '1px solid var(--line)', background: 'none', color: 'var(--text-2)', cursor: 'pointer' }}
                >Cancel</button>
                <button
                  onClick={confirmRunPlan}
                  className="tb-btn primary"
                  style={{ fontSize: 11, padding: '7px 16px' }}
                >Run pipeline ▶</button>
              </div>
            </div>
          </div>
        )
      })()}

      {/* ── Banner de error Run All ── */}
      {runPhase === 'error' && runErrors.length > 0 && (
        <div style={{
          position: 'fixed', top: 120, left: '50%', transform: 'translateX(-50%)', zIndex: 9000,
          maxWidth: 500, width: 'max-content',
          display: 'flex', flexDirection: 'column', gap: 6,
          padding: '10px 14px',
          background: 'color-mix(in srgb, #EF4444 10%, var(--bg-1))',
          border: '1px solid color-mix(in srgb, #EF4444 40%, transparent)',
          borderRadius: 8, boxShadow: '0 4px 20px rgba(239,68,68,0.2)',
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={{ color: '#EF4444', fontSize: 11, fontFamily: 'var(--font-mono)', fontWeight: 700, flex: 1 }}>
              Run All blocked
            </span>
            <button
              onClick={() => { setRunPhase('idle'); setRunErrors([]) }}
              style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-3)', fontSize: 12, padding: 0 }}
            >✕</button>
          </div>
          {runErrors.map((e, i) => (
            <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 8,
              background: 'color-mix(in srgb, #EF4444 6%, var(--bg-2))',
              border: '1px solid color-mix(in srgb, #EF4444 20%, transparent)',
              borderRadius: 5, padding: '6px 10px',
            }}>
              <div style={{ flex: 1 }}>
                <div style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color: 'var(--text-1)', fontWeight: 600 }}>
                  {e.nodeTitle}
                </div>
                <div style={{ fontFamily: 'var(--font-mono)', fontSize: 9, color: '#EF4444', marginTop: 2 }}>
                  {e.reason}
                </div>
              </div>
              {e.type === 'unreviewed_session' && (() => {
                const cn = canvasData?.nodes.find(n => n.project_node_id === e.projectNodeId)
                if (!cn) return null
                return (
                  <button
                    onClick={() => { setRunPhase('idle'); setRunErrors([]); handleRunNode(cn) }}
                    style={{
                      background: 'color-mix(in srgb, #EF4444 15%, var(--bg-2))',
                      border: '1px solid color-mix(in srgb, #EF4444 35%, transparent)',
                      borderRadius: 4, padding: '3px 8px', cursor: 'pointer',
                      fontFamily: 'var(--font-mono)', fontSize: 9, color: '#EF4444',
                      fontWeight: 600, whiteSpace: 'nowrap', flexShrink: 0,
                    }}
                  >
                    Open node →
                  </button>
                )
              })()}
            </div>
          ))}
        </div>
      )}

      {/* ── Aviso: Run sin contexto (ningún Text Input / Library Asset conectado) ── */}
      {noContextModal && (() => {
        const { scope, roots } = noContextModal
        const proceed = () => { setNoContextModal(null); runScope(scope, { skipContextCheck: true }) }
        return (
          <div
            style={{ position: 'fixed', inset: 0, zIndex: 9500, background: 'rgba(0,0,0,.45)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
            onClick={() => setNoContextModal(null)}
          >
            <div
              onClick={e => e.stopPropagation()}
              style={{ width: 420, maxWidth: '90vw', maxHeight: '82vh', overflowY: 'auto', background: 'var(--bg-1)', border: '1px solid var(--line)', borderRadius: 10, boxShadow: '0 16px 48px rgba(0,0,0,.4)', padding: 20 }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
                <span style={{ fontFamily: 'var(--font-mono)', fontSize: 13, fontWeight: 700, color: '#F59E0B', flex: 1 }}>
                  ⚠ No context connected
                </span>
                <button
                  onClick={() => setNoContextModal(null)}
                  style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-3)', fontSize: 14, padding: 0 }}
                >✕</button>
              </div>
              <p style={{ fontFamily: 'var(--font-sans)', fontSize: 11, color: 'var(--text-3)', margin: '0 0 12px', lineHeight: 1.5 }}>
                {roots.length === 1 ? 'This step has' : 'These steps have'} no idea or reference connected.
                Running now uses only the project name <strong style={{ color: 'var(--text-2)' }}>&ldquo;{localName}&rdquo;</strong> as
                context, which produces generic output. Connect a <strong style={{ color: 'var(--text-2)' }}>Text Input</strong> with
                your idea (or a <strong style={{ color: 'var(--text-2)' }}>Library Asset</strong>) first for real results.
              </p>

              <div style={{ display: 'flex', flexDirection: 'column', gap: 4, marginBottom: 16 }}>
                {roots.map((title, i) => (
                  <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '5px 8px', borderRadius: 5, background: 'color-mix(in srgb, #F59E0B 6%, var(--bg-2))', border: '1px solid color-mix(in srgb, #F59E0B 22%, transparent)' }}>
                    <span style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color: 'var(--text-1)', flex: 1, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                      {title}
                    </span>
                  </div>
                ))}
              </div>

              {/* Alerta, no bloqueo: el usuario decide. Ambas opciones son explícitas. */}
              <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
                <button
                  onClick={() => setNoContextModal(null)}
                  style={{ fontFamily: 'var(--font-sans)', fontSize: 11, padding: '7px 14px', borderRadius: 6, border: '1px solid var(--line)', background: 'none', color: 'var(--text-2)', cursor: 'pointer' }}
                >Add context first</button>
                <button
                  onClick={proceed}
                  style={{ fontFamily: 'var(--font-sans)', fontSize: 11, fontWeight: 600, padding: '7px 16px', borderRadius: 6, cursor: 'pointer',
                    color: '#F59E0B',
                    background: 'color-mix(in srgb, #F59E0B 12%, var(--bg-2))',
                    border: '1px solid color-mix(in srgb, #F59E0B 45%, transparent)' }}
                >Run anyway</button>
              </div>
            </div>
          </div>
        )
      })()}

      {/* ── Gate modal — aparece cuando todos los nodos del blueprint están aprobados ── */}
      {gateOpen && canvasData?.active_blueprint?.gate && (
        <div style={{
          position: 'fixed', inset: 0, zIndex: 10100,
          background: 'rgba(0,0,0,0.82)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
        }}>
          <div style={{
            width: 520,
            background: 'var(--bg-1)',
            border: '1px solid var(--line-2)',
            borderRadius: 12,
            overflow: 'hidden',
            boxShadow: '0 32px 80px rgba(0,0,0,0.6)',
          }}>
            {/* Header */}
            <div style={{
              padding: '18px 24px 14px',
              borderBottom: '1px solid var(--line-2)',
              background: 'var(--bg-2)',
            }}>
              <div style={{ fontSize: 9, fontFamily: 'var(--font-mono)', color: 'var(--text-3)', textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: 6 }}>
                Phase gate — {canvasData.active_blueprint.phase}
              </div>
              <div style={{ fontSize: 18, fontWeight: 700, color: 'var(--text-0)' }}>
                {canvasData.active_blueprint.gate.name}
              </div>
              <div style={{ fontSize: 11, color: 'var(--text-3)', marginTop: 4 }}>
                All nodes complete. Review and make your decision.
              </div>
            </div>

            {/* Rubrics */}
            {canvasData.active_blueprint.gate.suggested_rubrics?.length > 0 && (
              <div style={{ padding: '16px 24px', borderBottom: '1px solid var(--line-2)' }}>
                <div style={{ fontSize: 9, fontFamily: 'var(--font-mono)', color: 'var(--text-3)', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 10 }}>
                  Suggested rubrics
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 7 }}>
                  {canvasData.active_blueprint.gate.suggested_rubrics.map((r, i) => (
                    <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <div style={{
                        width: 14, height: 14, borderRadius: 3, flexShrink: 0,
                        border: '1.5px solid var(--line-2)',
                        background: 'var(--bg-3)',
                      }} />
                      <span style={{ fontSize: 11, color: 'var(--text-2)' }}>{r}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Barra de progreso mientras se procesa el gate */}
            {gateLoading && (
              <div style={{ padding: '0 24px 4px' }}>
                <div style={{ fontSize: 10, color: 'var(--text-3)', fontFamily: 'var(--font-mono)', marginBottom: 6, letterSpacing: '.06em' }}>
                  Processing decision…
                </div>
                <div style={{ height: 3, background: 'var(--line-1)', borderRadius: 2, overflow: 'hidden' }}>
                  <div style={{
                    height: '100%', width: '40%', background: '#34D399', borderRadius: 2,
                    animation: 'gateProgress 1.2s ease-in-out infinite alternate',
                  }} />
                </div>
                <style>{`@keyframes gateProgress { from { margin-left: 0; width: 40% } to { margin-left: 60%; width: 40% } }`}</style>
              </div>
            )}

            {/* Decisión */}
            <div style={{ padding: '18px 24px', display: 'flex', gap: 10 }}>
              <button
                disabled={gateLoading}
                onClick={() => handleGateDecision('ACCEPT')}
                style={{
                  flex: 1, padding: '10px 0', borderRadius: 7, border: 'none', cursor: 'pointer',
                  background: '#34D399', color: '#000', fontWeight: 700, fontSize: 12,
                  fontFamily: 'var(--font-mono)', opacity: gateLoading ? 0.6 : 1,
                  transition: 'opacity 150ms, transform 150ms',
                }}
                onMouseEnter={e => { e.currentTarget.style.transform = 'translateY(-1px)' }}
                onMouseLeave={e => { e.currentTarget.style.transform = 'none' }}
              >
                ✓ Accept
              </button>
              <button
                disabled={gateLoading}
                onClick={() => handleGateDecision('REFINE')}
                style={{
                  flex: 1, padding: '10px 0', borderRadius: 7, border: '1px solid var(--line-2)', cursor: 'pointer',
                  background: 'transparent', color: '#FBBF24', fontWeight: 700, fontSize: 12,
                  fontFamily: 'var(--font-mono)', opacity: gateLoading ? 0.6 : 1,
                  transition: 'opacity 150ms, transform 150ms',
                }}
                onMouseEnter={e => { e.currentTarget.style.transform = 'translateY(-1px)' }}
                onMouseLeave={e => { e.currentTarget.style.transform = 'none' }}
              >
                ↺ Refine
              </button>
              <button
                disabled={gateLoading}
                onClick={() => handleGateDecision('KILL')}
                style={{
                  flex: 1, padding: '10px 0', borderRadius: 7, border: '1px solid var(--line-2)', cursor: 'pointer',
                  background: 'transparent', color: '#EF4444', fontWeight: 700, fontSize: 12,
                  fontFamily: 'var(--font-mono)', opacity: gateLoading ? 0.6 : 1,
                  transition: 'opacity 150ms, transform 150ms',
                }}
                onMouseEnter={e => { e.currentTarget.style.transform = 'translateY(-1px)' }}
                onMouseLeave={e => { e.currentTarget.style.transform = 'none' }}
              >
                ✕ Kill
              </button>
            </div>
          </div>
        </div>
      )}

    {showExportModal && (
      <ExportModal
        project={project}
        onClose={() => setShowExportModal(false)}
        onRepoSaved={onRefresh}
      />
    )}

    {/* Aviso: se soltó un nodo aprobado en la zona de borrado */}
    {bloqueado && (() => {
      const cn = canvasData?.nodes.find(n => n.project_node_id === bloqueado)
      return (
        <div
          onClick={() => setBloqueado(null)}
          style={{ position: 'fixed', inset: 0, zIndex: 15000, background: 'rgba(0,0,0,0.6)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
        >
          <div
            onClick={e => e.stopPropagation()}
            style={{ background: 'var(--bg-1)', border: '1px solid var(--line-2)', borderRadius: 12, padding: '24px 28px', width: 380, boxShadow: '0 24px 64px rgba(0,0,0,0.55)', display: 'flex', flexDirection: 'column', gap: 14 }}
          >
            <span style={{ fontFamily: 'var(--font-mono)', fontSize: 11.5, fontWeight: 700, color: 'var(--action)', letterSpacing: '0.04em' }}>
              {cn?.node?.node_key ? `${cn.node.node_key} IS APPROVED` : 'NODE IS APPROVED'}
            </span>
            <span style={{ fontSize: 13, color: 'var(--text-1)', lineHeight: 1.5 }}>
              An approved node cannot be removed from the canvas — everything downstream was built on
              top of it. Reopen it and undo the approval first.
            </span>
            <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
              <button
                onClick={() => setBloqueado(null)}
                style={{ padding: '7px 18px', borderRadius: 7, border: '1px solid var(--line-2)', background: 'var(--bg-2)', color: 'var(--text-1)', fontSize: 12, cursor: 'pointer', fontFamily: 'var(--font-mono)' }}
              >Got it</button>
            </div>
          </div>
        </div>
      )
    })()}

    {/* Confirmación de borrado de un lane completo — dice CUÁNTOS nodos se lleva por delante */}
    {pendingLaneId && (() => {
      const lane   = (canvasData?.lanes ?? []).find(l => l.id === pendingLaneId)
      const miembros = (canvasData?.nodes ?? []).filter(n => n.lane_id === pendingLaneId)
      const conObra  = miembros.filter(n => n.session?.has_content || Object.values(n.output_sessions ?? {}).some(s => s.has_content))
      return (
        <div
          onClick={() => setPendingLaneId(null)}
          style={{ position: 'fixed', inset: 0, zIndex: 15000, background: 'rgba(0,0,0,0.72)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
        >
          <div
            onClick={e => e.stopPropagation()}
            style={{ background: 'var(--bg-1)', border: '1px solid var(--line-2)', borderRadius: 12, padding: '28px 32px', width: 400, boxShadow: '0 24px 64px rgba(0,0,0,0.55)', display: 'flex', flexDirection: 'column', gap: 16 }}
          >
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              <span style={{ fontFamily: 'var(--font-mono)', fontSize: 12, fontWeight: 700, color: '#EF4444', letterSpacing: '0.04em' }}>DELETE LANE</span>
              <span style={{ fontSize: 13, color: 'var(--text-1)', lineHeight: 1.5 }}>
                {lane ? `Lane ${lane.lane_key} · ${lane.label}` : 'This lane'} and its {miembros.length} node{miembros.length === 1 ? '' : 's'} will be deleted.
                {conObra.length > 0 && ` ${conObra.length} of them ${conObra.length === 1 ? 'has' : 'have'} generated content — sessions, messages and approved outputs go with them.`}
                {' '}This cannot be undone.
              </span>
              {miembros.length > 0 && (
                <span style={{ fontSize: 11, fontFamily: 'var(--font-mono)', color: 'var(--text-3)', lineHeight: 1.6 }}>
                  {miembros.map(n => n.node?.node_key ?? '·').join('  ')}
                </span>
              )}
            </div>
            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
              <button
                onClick={() => setPendingLaneId(null)}
                style={{ padding: '7px 16px', borderRadius: 7, border: '1px solid var(--line-2)', background: 'none', color: 'var(--text-2)', fontSize: 12, cursor: 'pointer', fontFamily: 'var(--font-mono)' }}
              >Cancel</button>
              <button
                onClick={() => { const id = pendingLaneId; setPendingLaneId(null); dismissLane(id) }}
                style={{ padding: '7px 16px', borderRadius: 7, border: 'none', background: '#EF4444', color: '#fff', fontSize: 12, fontWeight: 700, cursor: 'pointer', fontFamily: 'var(--font-mono)' }}
              >Delete lane</button>
            </div>
          </div>
        </div>
      )
    })()}

    {/* Confirmación de borrado para nodos con contenido generado */}
    {pendingRemoveId && (
      <div
        onClick={() => setPendingRemoveId(null)}
        style={{ position: 'fixed', inset: 0, zIndex: 15000, background: 'rgba(0,0,0,0.72)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
      >
        <div
          onClick={e => e.stopPropagation()}
          style={{ background: 'var(--bg-1)', border: '1px solid var(--line-2)', borderRadius: 12, padding: '28px 32px', width: 360, boxShadow: '0 24px 64px rgba(0,0,0,0.55)', display: 'flex', flexDirection: 'column', gap: 16 }}
        >
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            <span style={{ fontFamily: 'var(--font-mono)', fontSize: 12, fontWeight: 700, color: '#EF4444', letterSpacing: '0.04em' }}>REMOVE NODE</span>
            <span style={{ fontSize: 13, color: 'var(--text-1)', lineHeight: 1.5 }}>
              {/* El aviso cambia según haya trabajo detrás: si no lo hay, no tiene sentido hablar
                  de sesiones ni de outputs que no existen. */}
              {nodeHasContent(pendingRemoveId)
                ? 'This node has generated content. Removing it will permanently delete all sessions, messages and approved outputs.'
                : 'Remove this node from the canvas? It has not generated anything yet, so nothing is lost — but its connections go with it.'}
            </span>
          </div>
          <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
            <button
              onClick={() => setPendingRemoveId(null)}
              style={{ padding: '7px 16px', borderRadius: 7, border: '1px solid var(--line-2)', background: 'none', color: 'var(--text-2)', fontSize: 12, cursor: 'pointer', fontFamily: 'var(--font-mono)' }}
            >Cancel</button>
            <button
              onClick={async () => { const id = pendingRemoveId; setPendingRemoveId(null); setRemoving(true); try { await removeNodeById(id) } finally { setRemoving(false) } }}
              style={{ padding: '7px 16px', borderRadius: 7, border: 'none', background: '#EF4444', color: '#fff', fontSize: 12, fontWeight: 700, cursor: 'pointer', fontFamily: 'var(--font-mono)' }}
            >{nodeHasContent(pendingRemoveId) ? 'Remove anyway' : 'Remove node'}</button>
          </div>
        </div>
      </div>
    )}
    </div>
    </>
    </PendingOutputModalContext.Provider>
    </DraggingContext.Provider>
    </CanvasScaleContext.Provider>
  )
}

// ─── ForgeCanvas ─────────────────────────────────────────────────────────────

export default function ForgeCanvas({ project, onRefresh }: { project: Project; onRefresh: () => void }) {
  return (
    <div style={{ height: '100vh', background: 'var(--bg-0)', display: 'flex', flexDirection: 'column' }}>
      <ReactFlowProvider>
        <ForgeCanvasInner project={project} onRefresh={onRefresh} />
      </ReactFlowProvider>
      {/* Forgy: lanza el moodboard del proyecto. Fuera del ReactFlowProvider para que el
          overlay no quede atrapado por el z-index ni por el pan/zoom del canvas. */}
      <MoodboardButton projectId={project.id} projectName={project.name} />
    </div>
  )
}
