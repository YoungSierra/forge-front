'use client'

import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react'
import { createPortal } from 'react-dom'
import {
  ReactFlow, ReactFlowProvider,
  useNodesState, useEdgesState,
  useReactFlow, useViewport,
  addEdge,
  Handle, Position,
  type Node, type Edge, type Connection, type EdgeChange,
} from '@xyflow/react'
import '@xyflow/react/dist/style.css'
import ForgeEdge from './ForgeEdge'
import { saveLayout, loadLayout, seedLayoutFromDB } from '@/lib/canvas-storage'
import { BACKEND_URL, chatWithForgeNode, getNodeSession, acceptNodeOutput, generateNodePdf, generateItemImage } from '@/lib/api'
import type { ChatMessage, OutputImageItem, OutputImagesMap } from '@/lib/api'
import type { Project } from '@/lib/types'
import NodeChatWindow, { parseOutputItems, buildImageGenComponents, ImageThumbnailRow } from '@/components/shared/NodeChatWindow'
import type { ImageOutputDef, InlineImageItem } from '@/components/shared/NodeChatWindow'
import AssetCardDeck, { invalidateAssetDeckCache } from './AssetCardDeck'
import ForgeToolbar from './ForgeToolbar'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { MD_COMPONENTS } from '@/lib/md-components'

// ─── Types ────────────────────────────────────────────────────────────────────

interface ForgeSession {
  id: string
  node_id: string
  status: 'active' | 'approved' | 'rejected' | 'abandoned'
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
  node_type: 'forge_node' | 'library_asset' | 'text_input'
  text_label:   string | null
  text_content: string | null
  node: {
    id: string
    node_key: string
    title: string
    phase: string
    purpose: string
    inputs: Array<{ key: string; label: string; accepts: string[]; required: boolean }> | { required?: string[]; optional?: string[]; description?: string } | null
    outputs: { name: string; format: string; description?: string; optional?: boolean; image_gen?: boolean; image_gen_model?: string }[]
    tools: string[]
    skills: string[]
    executor: { type: string; model?: string; workflow_id?: string } | null
    status: string
  } | null
  asset: LibraryAsset | null
  session: ForgeSession | null
}

interface BlueprintGate {
  name: string
  mode: string
  suggested_rubrics: string[]
  outcomes: string[]
}

interface DbEdge { id: string; source: string; target: string; sourceHandle?: string | null; targetHandle?: string | null }

interface CanvasData {
  success: boolean
  nodes: CanvasNode[]
  edges: DbEdge[]
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

interface CatalogNode {
  id: string
  node_key: string
  title: string
  phase: string
  purpose: string
  executor: { type: string } | null
}

interface ForgeNodeCardData extends Record<string, unknown> {
  canvasNode:      CanvasNode
  onClick:         () => void
  locked:          boolean
  projectId:       string
  onImagesUpdate?: (imgs: OutputImagesMap) => void
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
  active:    '#A78BFA',
  approved:  '#34D399',
  rejected:  '#EF4444',
  abandoned: '#FBBF24',
}

const EXECUTOR_LABEL: Record<string, string> = {
  llm:     'LLM',
  comfyui: 'ComfyUI',
  hybrid:  'Hybrid',
}

const PHASE_COLOR: Record<string, string> = {
  ideation:   '#60A5FA',
  concept:    '#A78BFA',
  preprod:    '#34D399',
  production: '#FBBF24',
}

const PULSE_KF = `@keyframes canvas-pulse { 0%,100%{opacity:1} 50%{opacity:0.4} }`
const SPIN_KF  = `@keyframes canvas-spin  { to { transform: rotate(360deg); } }`

// ─── Request helper ───────────────────────────────────────────────────────────

async function canvasFetch<T>(path: string, options?: RequestInit): Promise<T> {
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
    headers: memberId ? { 'x-member-id': memberId } : {},
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

function AssetPreviewOverlay({ asset, projectId, onClose }: { asset: LibraryAsset; projectId: string; onClose: () => void }) {
  const isImage    = asset.asset_type === 'image'
  const isModel3d  = asset.asset_type === 'model_3d'
  const isMarkdown = asset.mime_type === 'text/markdown' || asset.file_name?.endsWith('.md')
  const hasText    = !!asset.extracted_text
  // Para modelos 3D usar el proxy del backend para evitar CORS con R2
  const modelSrc   = isModel3d ? `${BACKEND_URL}/api/projects/${projectId}/library/${asset.id}/file` : ''

  // Carga @google/model-viewer solo cuando se necesita (evita SSR)
  useEffect(() => {
    if (!isModel3d) return
    if (typeof window === 'undefined') return
    if (customElements.get('model-viewer')) return
    import('@google/model-viewer').catch(() => {})
  }, [isModel3d])

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
            <model-viewer
              src={modelSrc}
              alt={asset.display_name}
              camera-controls=""
              auto-rotate=""
              shadow-intensity="1"
              style={{ width: '100%', height: 400, background: 'var(--bg-0)' }}
            />
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
      {previewAsset && <AssetPreviewOverlay asset={previewAsset} projectId={projectId} onClose={() => setPreviewAsset(null)} />}

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

function NodeLibrarySidebar({ projectId, canvasNodeIds, approvedNodeIds, onAdded, collapsed, onCollapsedChange, onFocusNode }: {
  projectId: string
  canvasNodeIds: Set<string>
  approvedNodeIds: Set<string>
  onAdded: () => void
  collapsed: boolean
  onCollapsedChange: (v: boolean) => void
  onFocusNode?: (forgeNodeId: string) => void
}) {
  const [catalog,   setCatalog]   = useState<CatalogNode[]>([])
  const [loading,   setLoading]   = useState(true)
  const [query,     setQuery]     = useState('')
  const [adding,    setAdding]    = useState<string | null>(null)
  const [tab,       setTab]       = useState<'nodes' | 'library'>('nodes')
  const setCollapsed = onCollapsedChange

  useEffect(() => {
    canvasFetch<{ success: boolean; nodes: CatalogNode[] }>(`/api/projects/${projectId}/canvas/nodes-catalog`)
      .then(res => setCatalog(res.nodes ?? []))
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [projectId])

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
    <div style={{
      width: 220, flexShrink: 0,
      background: 'var(--bg-1)', borderRight: '1px solid var(--line-2)',
      display: 'flex', flexDirection: 'column', overflow: 'hidden',
      transition: 'width 150ms ease',
    }}>
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
              <div style={{
                padding: '9px 12px 4px',
                fontSize: 8, fontFamily: 'var(--font-mono)', color: PHASE_COLOR[phase] ?? 'var(--text-4)',
                textTransform: 'uppercase', letterSpacing: '0.1em',
                borderBottom: '1px solid var(--line-2)',
              }}>
                {phase}
              </div>
              {nodes.map(n => {
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
                      <div style={{ fontSize: 8, fontFamily: 'var(--font-mono)', color: 'var(--text-4)', marginBottom: 2, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {n.node_key}
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
        <AssetPreviewOverlay asset={asset} projectId={projectId} onClose={() => setPreviewOpen(false)} />,
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
  const startRx = new RegExp(`^(?:#{1,4}\\s+)?${escaped}\\s*$`, 'im')
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
  const { canvasNode, onClick, locked, projectId, onImagesUpdate } = data
  const { node, session } = canvasNode
  if (!node) return null
  const status      = session?.status ?? null
  const statusColor = locked ? null : (status ? (SESSION_COLOR[status] ?? null) : null)
  const phaseColor  = locked ? '#6B7280' : (PHASE_COLOR[node.phase] ?? '#6B7280')

  // Borde y glow reactivos al estado de sesión
  const borderColor = locked ? 'var(--line-2)' : (statusColor ?? 'var(--line-2)')
  const glowShadow  = !locked && status === 'active'
    ? `0 0 0 1px ${statusColor}, 0 0 18px ${statusColor}55, 0 4px 24px rgba(0,0,0,0.28)`
    : `0 4px 20px rgba(0,0,0,0.24)`

  // Hover deck para nodos aprobados
  const cardRef    = useRef<HTMLDivElement>(null)
  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const [deckAnchor, setDeckAnchor] = useState<{ x: number; y: number } | null>(null)
  const isApproved   = status === 'approved'
  const [outputOpen, setOutputOpen] = useState(false)
  const [generatedPdfUrl, setGeneratedPdfUrl] = useState<string | null>(null)
  const [pdfLoading, setPdfLoading] = useState(false)
  const [localOutputImages, setLocalOutputImages] = useState<OutputImagesMap>(
    (session?.output_images as OutputImagesMap) ?? {}
  )
  // Sincronizar cuando se genera desde el modal de expansión (chat)
  useEffect(() => {
    if (session?.output_images) {
      setLocalOutputImages(session.output_images as OutputImagesMap)
    }
  }, [session?.output_images])
  const [generatingImgKey, setGeneratingImgKey] = useState<string | null>(null)
  const [zoomUrl, setZoomUrl] = useState<string | null>(null)
  // Resolución del PDF URL: del asset (ya guardado) o generado on-demand en esta sesión
  const effectivePdfUrl = session?.output_asset?.storage_url || generatedPdfUrl

  const handleGeneratePdf = useCallback(async (e?: React.MouseEvent) => {
    e?.stopPropagation()
    if (pdfLoading) return
    setPdfLoading(true)
    try {
      const r = await generateNodePdf(projectId, node.id)
      setGeneratedPdfUrl(r.url)
      window.open(r.url, '_blank')
    } catch (err) {
      console.error('[ForgeNodeCard] PDF generation failed:', err)
    } finally {
      setPdfLoading(false)
    }
  }, [pdfLoading, projectId, node.id])

  const keepDeckOpen = useCallback(() => {
    if (closeTimer.current) clearTimeout(closeTimer.current)
  }, [])

  const scheduleDeckClose = useCallback(() => {
    closeTimer.current = setTimeout(() => setDeckAnchor(null), 160)
  }, [])

  return (
    <div style={{ position: 'relative' }} ref={cardRef}>
      {status === 'active' && <style>{PULSE_KF}</style>}

      <div
        onClick={onClick}
        style={{
          width: NODE_W,
          background: 'var(--bg-1)',
          border: `1px solid ${borderColor}`,
          borderRadius: 8,
          boxShadow: glowShadow,
          cursor: 'pointer',
          transition: 'box-shadow 200ms ease, border-color 200ms ease',
          animation: status === 'active' ? 'canvas-pulse 2s ease-in-out infinite' : 'none',
        }}
        onMouseEnter={e => {
          const hoverBorder = statusColor ?? 'var(--action)'
          const hoverGlow   = statusColor
            ? `0 0 0 1px ${statusColor}, 0 0 22px ${statusColor}66, 0 6px 28px rgba(0,0,0,0.34)`
            : `0 0 0 1px var(--action), 0 6px 28px rgba(0,0,0,0.34)`
          e.currentTarget.style.borderColor = hoverBorder
          e.currentTarget.style.boxShadow   = hoverGlow
          e.currentTarget.style.animation   = 'none'
          if (isApproved && cardRef.current) {
            keepDeckOpen()
            const rect = cardRef.current.getBoundingClientRect()
            setDeckAnchor({ x: rect.left + rect.width / 2, y: rect.top })
          }
        }}
        onMouseLeave={e => {
          e.currentTarget.style.borderColor = borderColor
          e.currentTarget.style.boxShadow   = glowShadow
          e.currentTarget.style.animation   = status === 'active' ? 'canvas-pulse 2s ease-in-out infinite' : 'none'
          if (isApproved) scheduleDeckClose()
        }}
      >
        {/* Header — borderRadius top para que el bg respete las esquinas sin overflow:hidden */}
        <div style={{
          background: `color-mix(in srgb, ${phaseColor} 14%, var(--bg-2))`,
          borderBottom: `1px solid color-mix(in srgb, ${phaseColor} 22%, var(--line-2))`,
          borderRadius: '7px 7px 0 0',
          padding: '8px 10px',
          display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8,
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
          {node.executor?.type && (
            <span style={{
              flexShrink: 0,
              fontSize: 8, fontFamily: 'var(--font-mono)',
              color: `color-mix(in srgb, ${phaseColor} 70%, var(--text-3))`,
              background: `color-mix(in srgb, ${phaseColor} 8%, var(--bg-3))`,
              border: `1px solid color-mix(in srgb, ${phaseColor} 18%, var(--line-2))`,
              padding: '1px 5px', borderRadius: 3,
            }}>
              {EXECUTOR_LABEL[node.executor.type] ?? node.executor.type}
            </span>
          )}
        </div>

        {/* Body — ComfyUI style: handles por slot */}
        {(() => {
          // Soporta nuevo formato array [{key,required}] y legacy {required:[], optional:[]}
          const rawInputs = node.inputs
          const allInputs: Array<{ name: string; optional: boolean }> = Array.isArray(rawInputs)
            ? rawInputs.map(inp => ({ name: inp.key, optional: !inp.required }))
            : [
                ...((rawInputs as { required?: string[] } | null)?.required ?? []).map(n => ({ name: n, optional: false })),
                ...((rawInputs as { optional?: string[] } | null)?.optional ?? []).map(n => ({ name: n, optional: true })),
              ]
          const allOutputs = node.outputs ?? []
          const hasIO = allInputs.length > 0 || allOutputs.length > 0

          const hBase: React.CSSProperties = {
            width: 10, height: 10, borderRadius: '50%',
            border: '2px solid var(--bg-0)', cursor: 'crosshair',
            position: 'absolute', top: '50%', transform: 'translateY(-50%)',
          }

          return (
            <>
              {hasIO ? (
                <div style={{ display: 'flex', borderBottom: '1px solid var(--line-2)' }}>
                  {/* Columna inputs — handle target por fila */}
                  <div style={{ flex: 1, minWidth: 0, padding: '5px 0', display: 'flex', flexDirection: 'column' }}>
                    {allInputs.map((inp, i) => (
                      <div key={i} style={{ position: 'relative', display: 'flex', alignItems: 'center', height: 20, minWidth: 0 }}>
                        <Handle
                          type="target"
                          position={Position.Left}
                          id={`in-${inp.name}`}
                          style={{
                            ...hBase, left: -6,
                            background: inp.optional ? 'var(--bg-2)' : phaseColor,
                            border: inp.optional ? `2px solid ${phaseColor}` : '2px solid var(--bg-0)',
                          }}
                        />
                        <span style={{
                          paddingLeft: 12, fontSize: 8, fontFamily: 'var(--font-mono)',
                          color: inp.optional ? 'var(--text-3)' : phaseColor,
                          fontWeight: inp.optional ? 400 : 600,
                          flex: 1, minWidth: 0,
                          overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                        }}>{inp.name}</span>
                      </div>
                    ))}
                    {allInputs.length === 0 && (
                      <Handle type="target" position={Position.Left}
                        style={{ ...hBase, left: -6, background: statusColor ?? '#374151', position: 'relative', top: 'auto', transform: 'none', margin: '5px 0 5px -6px' }}
                      />
                    )}
                  </div>

                  {/* Divisor vertical */}
                  {allInputs.length > 0 && allOutputs.length > 0 && (
                    <div style={{ width: 1, background: 'var(--line-2)', flexShrink: 0 }} />
                  )}

                  {/* Columna outputs — handle source por fila */}
                  <div style={{ flex: 1, minWidth: 0, padding: '5px 0', display: 'flex', flexDirection: 'column' }}>
                    {allOutputs.map((out, i) => (
                      <div key={i} style={{ position: 'relative', display: 'flex', alignItems: 'center', height: 20, minWidth: 0 }}>
                        <span style={{
                          paddingRight: 12, fontSize: 8, fontFamily: 'var(--font-mono)',
                          color: out.optional ? 'var(--text-3)' : phaseColor,
                          fontWeight: out.optional ? 400 : 600,
                          flex: 1, minWidth: 0, textAlign: 'right',
                          overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                        }} title={[out.format, out.description].filter(Boolean).join(' · ')}>{out.name}</span>
                        <Handle
                          type="source"
                          position={Position.Right}
                          id={`out-${out.name}`}
                          style={{
                            ...hBase, right: -6,
                            background: out.optional ? 'var(--bg-2)' : phaseColor,
                            border: out.optional ? `2px solid ${phaseColor}` : '2px solid var(--bg-0)',
                          }}
                        />
                      </div>
                    ))}
                    {allOutputs.length === 0 && (
                      <Handle type="source" position={Position.Right}
                        style={{ ...hBase, right: -6, background: statusColor ?? '#374151', position: 'relative', top: 'auto', transform: 'none', margin: '5px -6px 5px 0' }}
                      />
                    )}
                  </div>
                </div>
              ) : (
                // Sin DNA de IO: handles simples en los bordes
                <>
                  <Handle type="target" position={Position.Left}
                    style={{ ...hBase, left: -6, background: statusColor ?? '#374151' }}
                  />
                  <Handle type="source" position={Position.Right}
                    style={{ ...hBase, right: -6, background: statusColor ?? '#374151' }}
                  />
                </>
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

              {/* Imágenes generadas sin text asset — nodos de solo PNG */}
              {(() => {
                const hasImgs = Object.values(localOutputImages).some(arr => arr.some(i => i.variations?.length > 0))
                if (!hasImgs) return null
                const total = Object.values(localOutputImages).reduce((s, a) => s + a.reduce((n, i) => n + (i.variations?.length ?? 0), 0), 0)
                return (
                  <div style={{ padding: '5px 8px', borderBottom: '1px solid var(--line-2)' }} onClick={e => e.stopPropagation()}>
                    <div style={{
                      display: 'flex', alignItems: 'center', gap: 4,
                      background: 'color-mix(in srgb, #818CF8 9%, var(--bg-2))',
                      border: '1px solid color-mix(in srgb, #818CF8 22%, var(--line-2))',
                      borderRadius: 5, padding: '4px 7px',
                    }}>
                      <span style={{ fontSize: 10, color: '#818CF8', flexShrink: 0 }}>🖼</span>
                      <span style={{ fontSize: 9, fontFamily: 'var(--font-mono)', color: 'var(--text-1)', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {total} image{total !== 1 ? 's' : ''} generated
                      </span>
                      <button
                        onClick={() => setOutputOpen(true)}
                        title="View images"
                        style={{ border: 'none', background: 'none', color: '#818CF8', cursor: 'pointer', fontSize: 12, padding: '0 2px', lineHeight: 1, flexShrink: 0 }}
                      >👁</button>
                    </div>
                  </div>
                )
              })()}

              {/* Footer: phase + status / lock */}
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 6, padding: '5px 10px' }}>
                <span style={{
                  fontSize: 8, fontFamily: 'var(--font-mono)', fontWeight: 600,
                  color: phaseColor, textTransform: 'uppercase', letterSpacing: '0.08em',
                  opacity: locked ? 0.4 : 1,
                }}>
                  {node.phase}
                </span>
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
            </>
          )
        })()}
      </div>

      {/* Abanico de cartas — solo nodos aprobados */}
      {isApproved && deckAnchor && (
        <AssetCardDeck
          nodeId={node.id}
          projectId={projectId}
          anchorX={deckAnchor.x}
          anchorY={deckAnchor.y}
          onKeepOpen={keepDeckOpen}
          onScheduleClose={scheduleDeckClose}
        />
      )}

      {/* Modal de output — portal para escapar el contexto de ReactFlow */}
      {outputOpen && typeof document !== 'undefined' && (session?.output_asset || Object.values(localOutputImages).some(a => a.some(i => i.variations?.length > 0))) && createPortal(
        <>
          <div
            onClick={() => setOutputOpen(false)}
            style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.85)', zIndex: 10000 }}
          />
          <div
            onClick={e => e.stopPropagation()}
            style={{
              position: 'fixed', top: '50%', left: '50%', transform: 'translate(-50%,-50%)',
              zIndex: 10001, width: 720, maxHeight: '82vh',
              background: 'var(--bg-1)', border: '1px solid var(--line-2)',
              borderRadius: 10, boxShadow: '0 24px 64px rgba(0,0,0,0.6)',
              display: 'flex', flexDirection: 'column', overflow: 'hidden',
            }}
          >
            <div style={{ padding: '12px 20px', borderBottom: '1px solid var(--line-2)', flexShrink: 0, display: 'flex', alignItems: 'center', gap: 8 }}>
              <span style={{ fontSize: 14, flexShrink: 0 }}>
                {session?.output_asset ? (effectivePdfUrl ? '📄' : '📝') : '🖼'}
              </span>
              <span style={{ flex: 1, fontSize: 12, fontFamily: 'var(--font-mono)', fontWeight: 700, color: 'var(--text-0)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {session?.output_asset ? session.output_asset.name : `${node.title} — Image Outputs`}
              </span>
              {session?.output_asset && (
                <>
                  <span style={{ fontSize: 9, fontFamily: 'var(--font-mono)', color: 'var(--text-3)', background: 'var(--bg-3)', border: '1px solid var(--line-2)', padding: '2px 6px', borderRadius: 3, flexShrink: 0 }}>
                    {session.output_asset.format}
                  </span>
                  {effectivePdfUrl ? (
                    <a
                      href={effectivePdfUrl}
                      target="_blank"
                      rel="noreferrer"
                      style={{ fontSize: 9, fontFamily: 'var(--font-mono)', color: '#F59E0B', textDecoration: 'none', padding: '2px 8px', border: '1px solid color-mix(in srgb, #F59E0B 50%, transparent)', borderRadius: 3, flexShrink: 0 }}
                    >↓ {session.output_asset.format === 'pptx' ? 'PPTX' : 'PDF'}</a>
                  ) : session.output_asset.content ? (
                    <button
                      onClick={handleGeneratePdf}
                      disabled={pdfLoading}
                      style={{ fontSize: 9, fontFamily: 'var(--font-mono)', color: '#F59E0B', background: 'none', padding: '2px 8px', border: '1px solid color-mix(in srgb, #F59E0B 50%, transparent)', borderRadius: 3, flexShrink: 0, cursor: pdfLoading ? 'default' : 'pointer', opacity: pdfLoading ? 0.6 : 1 }}
                    >{pdfLoading ? '…' : '↓ PDF'}</button>
                  ) : null}
                </>
              )}
              <button
                onClick={() => setOutputOpen(false)}
                style={{ border: 'none', background: 'var(--bg-2)', cursor: 'pointer', color: 'var(--text-2)', fontSize: 13, padding: '4px 8px', borderRadius: 6, flexShrink: 0, fontFamily: 'var(--font-mono)' }}
              >✕</button>
            </div>
            {(() => {
              // Vista de solo imágenes cuando no hay text asset
              if (!session?.output_asset) {
                const imgOutputs = (node.outputs ?? []).filter(o => o.image_gen)
                return (
                  <div style={{ flex: 1, overflowY: 'auto', padding: '20px 28px' }}>
                    {imgOutputs.map(outDef => {
                      const imgs = (localOutputImages[outDef.name] ?? []).filter(i => i.variations?.length > 0)
                      return (
                        <div key={outDef.name} style={{ marginBottom: 28 }}>
                          <div style={{ fontSize: 9, fontFamily: 'var(--font-mono)', color: 'var(--text-3)', marginBottom: 10, letterSpacing: '0.06em', textTransform: 'uppercase' }}>
                            {outDef.name}
                          </div>
                          {imgs.length === 0 ? (
                            <div style={{ fontSize: 10, fontFamily: 'var(--font-mono)', color: 'var(--text-4)' }}>No image generated yet.</div>
                          ) : (
                            <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
                              {imgs.map(item => (
                                item.variations.map((v, vi) => (
                                  <div key={`${item.index}-${vi}`} style={{ position: 'relative' }}>
                                    <img
                                      src={v.url}
                                      alt={outDef.name}
                                      onClick={() => setZoomUrl(v.url)}
                                      style={{ width: 200, height: 200, objectFit: 'cover', borderRadius: 6, cursor: 'zoom-in', border: '1px solid var(--line-2)', display: 'block' }}
                                    />
                                  </div>
                                ))
                              ))}
                            </div>
                          )}
                        </div>
                      )
                    })}
                  </div>
                )
              }

              // Vista normal con markdown + botones de imagen inline
              const modalImageItems: InlineImageItem[] = []
              if (session.output_asset.content) {
                const imageGenDefs = (node.outputs ?? []).filter(o => o.image_gen && o.image_gen_model)
                let fullContentUsed = false
                for (const outDef of imageGenDefs) {
                  const otherKeys = imageGenDefs.filter(d => d.name !== outDef.name).map(d => d.name)
                  const foundSection = extractSection(session.output_asset.content, outDef.name, otherKeys)
                  if (!foundSection && fullContentUsed) continue
                  const section = foundSection || session.output_asset.content
                  if (!foundSection) fullContentUsed = true
                  const items = parseOutputItems(section, outDef.format)
                  const savedItems = localOutputImages[outDef.name] ?? []
                  for (let idx = 0; idx < items.length; idx++) {
                    const itemText   = items[idx]
                    const saved      = savedItems.find(s => s.index === idx)
                    const variations = saved?.variations ?? []
                    const key        = `${outDef.name}:${idx}`
                    modalImageItems.push({
                      itemKey:       key,
                      index:         idx,
                      text:          itemText,
                      imageUrl:      variations.at(-1)?.url ?? null,
                      allVariations: variations,
                      isGenerating:  generatingImgKey === key,
                      onZoom:        url => setZoomUrl(url),
                      onGenerate:    async (condition?: string) => {
                        if (!session?.id) return
                        setGeneratingImgKey(key)
                        try {
                          const r = await generateItemImage(projectId, node.id, session.id, outDef.name, idx, itemText, condition)
                          const imgs = r.output_images
                          setLocalOutputImages(imgs)
                          onImagesUpdate?.(imgs)
                        } catch (e) {
                          console.error('[image-gen]', e)
                        } finally {
                          setGeneratingImgKey(null)
                        }
                      },
                    })
                  }
                }
              }
              const mdComponents = modalImageItems.length > 0
                ? buildImageGenComponents(modalImageItems)
                : MD_COMPONENTS

              // Outputs PNG con imágenes guardadas — se muestran como grid debajo del texto
              const pngOutputsWithImages = (node.outputs ?? [])
                .filter(o => (o.format === 'png' || o.format === 'image') && o.image_gen)
                .filter(o => (localOutputImages[o.name] ?? []).some(i => i.variations?.length > 0))

              return (
                <div style={{ flex: 1, overflowY: 'auto', padding: '20px 28px', fontSize: 12, color: 'var(--text-1)', lineHeight: 1.7 }}>
                  {session.output_asset.content ? (
                    <ReactMarkdown remarkPlugins={[remarkGfm]} components={mdComponents}>
                      {session.output_asset.content}
                    </ReactMarkdown>
                  ) : session.output_asset.storage_url ? (
                    <div style={{ fontSize: 11, fontFamily: 'var(--font-mono)', color: 'var(--text-3)' }}>
                      This asset is stored as a file. Use the Open button above to view it.
                    </div>
                  ) : (
                    <div style={{ fontSize: 11, fontFamily: 'var(--font-mono)', color: 'var(--text-3)' }}>No preview available.</div>
                  )}

                  {/* Grid de imágenes PNG al final del contenido */}
                  {pngOutputsWithImages.length > 0 && (
                    <div style={{ marginTop: 24, paddingTop: 20, borderTop: '1px solid var(--line-2)' }}>
                      {pngOutputsWithImages.map(outDef => {
                        const imgs = (localOutputImages[outDef.name] ?? []).filter(i => i.variations?.length > 0)
                        return (
                          <div key={outDef.name} style={{ marginBottom: 20 }}>
                            <div style={{ fontSize: 9, fontFamily: 'var(--font-mono)', color: 'var(--text-3)', marginBottom: 10, letterSpacing: '0.06em', textTransform: 'uppercase' }}>
                              {outDef.name}
                            </div>
                            <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
                              {imgs.flatMap(item => item.variations.map((v, vi) => (
                                <img
                                  key={`${item.index}-${vi}`}
                                  src={v.url}
                                  alt={outDef.name}
                                  onClick={() => setZoomUrl(v.url)}
                                  style={{ width: 190, height: 190, objectFit: 'cover', borderRadius: 6, cursor: 'zoom-in', border: '1px solid var(--line-2)', display: 'block' }}
                                />
                              )))}
                            </div>
                          </div>
                        )
                      })}
                    </div>
                  )}
                </div>
              )
            })()}
          </div>

          {/* Zoom overlay */}
          {zoomUrl && (
            <div
              onClick={() => setZoomUrl(null)}
              style={{ position: 'fixed', inset: 0, zIndex: 10002, background: 'rgba(0,0,0,0.85)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 32, cursor: 'zoom-out' }}
            >
              <img src={zoomUrl} alt="Generated" onClick={e => e.stopPropagation()} style={{ maxWidth: '90vw', maxHeight: '85vh', borderRadius: 10, boxShadow: '0 24px 80px rgba(0,0,0,0.7)', cursor: 'default' }} />
              <button onClick={() => setZoomUrl(null)} style={{ position: 'absolute', top: 20, right: 20, background: 'rgba(255,255,255,0.1)', border: '1px solid rgba(255,255,255,0.2)', borderRadius: 6, color: '#fff', fontSize: 14, padding: '4px 10px', cursor: 'pointer' }}>✕</button>
            </div>
          )}
        </>,
        document.body
      )}
    </div>
  )
})

const NODE_TYPES = { forgeNode: ForgeNodeCard, assetNode: AssetNodeCard, textInputNode: TextInputCard }
const EDGE_TYPES = { forgeEdge: ForgeEdge }

// ─── ImportAsOutputButton ─────────────────────────────────────────────────────

// (NodeInputsPanel eliminado — inputs se manejan via asset-nodes en el canvas)

// ─── ImportAsOutputButton ─────────────────────────────────────────────────────

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

function MonoPair({ k, v, color }: { k: string; v: string; color?: string }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', fontFamily: 'var(--font-mono)', fontSize: 10, gap: 6 }}>
      <span style={{ color: 'var(--text-3)' }}>{k}</span>
      <span style={{ color: color ?? 'var(--text-1)', textAlign: 'right' }}>{v}</span>
    </div>
  )
}

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
  const { node, session } = canvasNode
  if (!node) return null
  const statusColor = session ? (SESSION_COLOR[session.status] ?? 'var(--text-3)') : null
  const phaseColor  = PHASE_COLOR[node.phase] ?? 'var(--text-3)'



  return (
    <>
      <div onClick={onClose} style={{ position: 'fixed', inset: 0, zIndex: 40, background: 'rgba(0,0,0,0.18)' }} />
      <div style={{
        position: 'fixed', top: 0, right: 0, bottom: 0, width: 340, zIndex: 50,
        background: 'var(--bg-1)', borderLeft: '1px solid var(--line-2)',
        boxShadow: '-8px 0 40px rgba(0,0,0,0.3)',
        display: 'flex', flexDirection: 'column', overflow: 'hidden',
      }}>
        {/* Header */}
        <div style={{ padding: '16px 18px 14px', borderBottom: '1px solid var(--line-2)', flexShrink: 0 }}>
          <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 10, marginBottom: 9 }}>
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
            {session && statusColor && (
              <span style={{ fontSize: 9, fontFamily: 'var(--font-mono)', color: statusColor, background: `color-mix(in srgb, ${statusColor} 10%, var(--bg-2))`, border: `1px solid color-mix(in srgb, ${statusColor} 28%, transparent)`, padding: '2px 7px', borderRadius: 3 }}>
                ● {session.status}
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

          <Section label="Inputs">
            {(() => {
              const incomingEdges = edges.filter(e => e.target === canvasNode.project_node_id)
              // Deduplicar por (source, sourceHandle) — evita mostrar duplicados si hay filas repetidas en DB
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
                  No inputs connected.<br />Drag assets from the library or connect nodes on the canvas.
                </div>
              )
              return (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                  {incomingRows.map(({ edgeId, sourceHandle, cn }) => {
                    const isAsset = cn.node_type === 'library_asset'
                    const isText  = cn.node_type === 'text_input'
                    const icon    = isAsset ? (ASSET_TYPE_ICON[cn.asset?.asset_type ?? 'other'] ?? '📎')
                                  : isText  ? 'T'
                                  : '⬡'
                    const label   = isAsset ? (cn.asset?.display_name ?? '—')
                                  : isText  ? (cn.text_label ?? 'Text Input')
                                  : (cn.node?.title ?? '—')
                    const slotLabel = (() => {
                      if (!sourceHandle?.startsWith('out-')) return null
                      const handleVal = sourceHandle.slice(4) // "out-concept_brief" → "concept_brief"
                      const outputs = cn.node?.outputs as { name: string; format: string }[] | undefined
                      const out = outputs?.find(o => o.name === handleVal)
                        ?? outputs?.[parseInt(handleVal, 10)]
                      return out?.name ?? null
                    })()
                    const sub     = isAsset ? (cn.asset?.asset_type ?? '')
                                  : isText  ? 'text input'
                                  : slotLabel ? `${cn.node?.node_key ?? ''} → ${slotLabel}` : (cn.node?.node_key ?? '')
                    return (
                      <div key={edgeId} style={{
                        display: 'flex', alignItems: 'center', gap: 7,
                        background: 'var(--bg-2)', border: '1px solid var(--line-2)',
                        borderRadius: 6, padding: '5px 8px',
                      }}>
                        <span style={{ fontSize: isText ? 10 : 12, fontFamily: isText ? 'var(--font-mono)' : undefined, fontWeight: isText ? 700 : undefined, color: isText ? ASSET_NODE_CLR : undefined, flexShrink: 0 }}>{icon}</span>
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{ fontSize: 10, fontFamily: 'var(--font-mono)', color: 'var(--text-1)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{label}</div>
                          <div style={{ fontSize: 8, fontFamily: 'var(--font-mono)', color: 'var(--text-3)', marginTop: 1 }}>{sub}</div>
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
          </Section>

          {Array.isArray(node.outputs) && node.outputs.length > 0 && (
            <Section label="Outputs">
              <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                {node.outputs.map((out, i) => (
                  <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 7, background: 'var(--bg-2)', border: '1px solid var(--line-2)', borderRadius: 6, padding: '5px 8px' }}>
                    <span style={{ fontSize: 8, color: out.optional ? 'var(--text-3)' : '#34D399', flexShrink: 0 }}>→</span>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 10, fontFamily: 'var(--font-mono)', color: out.optional ? 'var(--text-2)' : 'var(--text-1)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{out.name}</div>
                      {(out.format || out.description) && (
                        <div style={{ fontSize: 8, fontFamily: 'var(--font-mono)', color: 'var(--text-3)', marginTop: 1 }}>
                          {[out.format, out.description].filter(Boolean).join(' · ')}
                        </div>
                      )}
                    </div>
                    {out.optional && (
                      <span style={{ fontSize: 7, fontFamily: 'var(--font-mono)', color: 'var(--text-4)', background: 'var(--bg-3)', border: '1px solid var(--line-2)', padding: '1px 4px', borderRadius: 3, flexShrink: 0 }}>opt</span>
                    )}
                  </div>
                ))}
              </div>
            </Section>
          )}

          {node.tools?.length > 0 && (
            <Section label="Tools">
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
                {node.tools.map((t, i) => (
                  <span key={i} style={{ fontSize: 9, fontFamily: 'var(--font-mono)', background: 'var(--bg-3)', border: '1px solid var(--line-2)', borderRadius: 3, padding: '2px 7px', color: 'var(--text-2)' }}>{String(t)}</span>
                ))}
              </div>
            </Section>
          )}

          {node.skills?.length > 0 && (
            <Section label="Skills">
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
                {node.skills.map((s, i) => (
                  <span key={i} style={{ fontSize: 9, fontFamily: 'var(--font-mono)', background: 'var(--bg-3)', border: '1px solid var(--line-2)', borderRadius: 3, padding: '2px 7px', color: 'var(--text-2)' }}>{String(s)}</span>
                ))}
              </div>
            </Section>
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
          {canvasNode.session?.status !== 'approved' && !locked && (
            <ImportAsOutputButton projectId={projectId} canvasNode={canvasNode} onImported={onImportedAsOutput} />
          )}
          {(() => {
            const approved = canvasNode.session?.status === 'approved'
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
          {canvasNode.session?.status === 'approved' ? (
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
    </>
  )
}

// ─── BlueprintBar ─────────────────────────────────────────────────────────────

function BlueprintBar({ activeBlueprint, projectId, onLoaded }: {
  activeBlueprint: CanvasData['active_blueprint']
  projectId: string
  onLoaded: () => void
}) {
  const [loading,    setLoading]    = useState(false)
  const [blueprints, setBlueprints] = useState<{ id: string; name: string; blueprint_key: string }[]>([])
  const [showPicker, setShowPicker] = useState(false)

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
      {activeBlueprint ? (
        <>
          <span style={{ fontSize: 9, fontFamily: 'var(--font-mono)', color: 'var(--text-3)', textTransform: 'uppercase', letterSpacing: '0.08em' }}>Blueprint</span>
          <span style={{ fontSize: 11, fontFamily: 'var(--font-mono)', color: 'var(--text-1)', fontWeight: 600 }}>{activeBlueprint.name}</span>
          <span style={{ fontSize: 9, fontFamily: 'var(--font-mono)', color: 'var(--text-3)', background: 'var(--bg-2)', border: '1px solid var(--line-2)', padding: '2px 6px', borderRadius: 3 }}>
            {activeBlueprint.blueprint_key}
          </span>
        </>
      ) : (
        <span style={{ fontSize: 11, fontFamily: 'var(--font-mono)', color: 'var(--text-3)' }}>No blueprint loaded</span>
      )}

      <div style={{ flex: 1 }} />

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
    </div>
  )
}

// ─── ForgeCanvasInner ─────────────────────────────────────────────────────────

function ForgeCanvasInner({ project, onRefresh }: { project: Project; onRefresh: () => void }) {
  const [canvasData,        setCanvasData]        = useState<CanvasData | null>(null)
  const [loading,           setLoading]           = useState(true)
  const [selectedNode,      setSelectedNode]      = useState<CanvasNode | null>(null)
  const [removing,          setRemoving]          = useState(false)
  const [sidebarCollapsed,  setSidebarCollapsed]  = useState(false)
  const [chatNode,          setChatNode]          = useState<CanvasNode | null>(null)
  const [chatSessionId,     setChatSessionId]     = useState<string | null>(null)
  const [chatMessages,      setChatMessages]      = useState<ChatMessage[]>([])
  const [chatLoading,       setChatLoading]       = useState(false)
  const [chatDocUrl,        setChatDocUrl]        = useState<string | null>(null)
  const [chatDocFormat,     setChatDocFormat]     = useState<string | null>(null)
  const [chatOutputImages,  setChatOutputImages]  = useState<OutputImagesMap>({})
  const [collapsedAssets,   setCollapsedAssets]   = useState<Set<string>>(new Set())

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

  const persistEdges = useCallback((edgeList: Edge[]) => {
    // Deduplicar por source+handle+target antes de enviar
    const seen = new Set<string>()
    const unique = edgeList.filter(e => {
      const key = `${e.source}|${e.sourceHandle ?? ''}|${e.target}|${e.targetHandle ?? ''}`
      if (seen.has(key)) return false
      seen.add(key)
      return true
    })
    console.log(`[forge-canvas] persistEdges called — ${unique.length} edges (${edgeList.length} raw)`, new Error().stack?.split('\n')[2]?.trim())
    canvasFetch(`/api/projects/${project.id}/canvas/edges`, {
      method: 'PUT',
      body: JSON.stringify({
        edges: unique.map(e => ({
          source:       e.source,
          target:       e.target,
          sourceHandle: e.sourceHandle ?? null,
          targetHandle: e.targetHandle ?? null,
        })),
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

  const loadCanvas = useCallback(async (silent = false) => {
    if (!silent) setLoading(true)
    try {
      const data = await canvasFetch<CanvasData>(`/api/projects/${project.id}/canvas`)
      // En el primer load siempre aplicar el layout de DB (fuente de verdad cross-device).
      // En reloads silenciosos posteriores preservar las posiciones del usuario en esta sesión.
      if (data.canvas_layout && !dbLayoutAppliedRef.current) {
        dbLayoutAppliedRef.current = true
        const dbLayout = data.canvas_layout as Parameters<typeof seedLayoutFromDB>[1]
        seedLayoutFromDB(project.id, dbLayout)
        setSavedLayout(dbLayout)
      }
      setCanvasData(data)
    } catch (e) {
      console.error('[forge-canvas] load failed', e)
    } finally {
      if (!silent) setLoading(false)
    }
  }, [project.id])

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

  const canvasNodeIds = useMemo(
    () => new Set((canvasData?.nodes ?? []).filter(cn => cn.node_type === 'forge_node').map(cn => cn.node!.id)),
    [canvasData],
  )

  const approvedNodeIds = useMemo(
    () => new Set((canvasData?.nodes ?? []).filter(cn => cn.node_type === 'forge_node' && cn.session?.status === 'approved').map(cn => cn.node!.id)),
    [canvasData],
  )


  // Nodos bloqueados: secuencial — si el nodo i-1 no está aprobado, todos los siguientes están locked
  const lockedNodeIds = useMemo(() => {
    if (!canvasData) return new Set<string>()
    const sorted = [...canvasData.nodes]
      .filter(cn => cn.node_type === 'forge_node')
      .sort((a, b) => (a.order_index ?? 0) - (b.order_index ?? 0))
    const locked = new Set<string>()
    for (let i = 1; i < sorted.length; i++) {
      if (sorted[i - 1].session?.status !== 'approved') {
        for (let j = i; j < sorted.length; j++) locked.add(sorted[j].project_node_id)
        break
      }
    }
    return locked
  }, [canvasData])

  // Gate listo: todos los nodos del blueprint activo están aprobados y no hay decisión previa
  const gateReady = useMemo(() => {
    const bp = canvasData?.active_blueprint
    if (!bp?.gate || bp.gate_decision) return false
    const bpNodes = canvasData!.nodes.filter(n => n.blueprint_id === bp.id && n.node_type === 'forge_node')
    if (bpNodes.length === 0) return false
    // Todos los forge_nodes en canvas deben estar aprobados (incluyendo los re-agregados sin blueprint_id)
    const allForgeNodes = canvasData!.nodes.filter(n => n.node_type === 'forge_node')
    return allForgeNodes.every(n => n.session?.status === 'approved')
  }, [canvasData])

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
      const memberId = typeof window !== 'undefined' ? localStorage.getItem('forge_member_id') : null
      await canvasFetch(`/api/projects/${project.id}/canvas/gate`, {
        method: 'POST',
        body: JSON.stringify({ decision, blueprint_id: canvasData.active_blueprint.id, member_id: memberId }),
      })
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
    const savedPos = savedLayout?.nodes.reduce<Record<string, { x: number; y: number }>>((acc, n) => {
      acc[n.id] = n.position
      return acc
    }, {}) ?? {}

    let assetIdx = 0
    let textIdx  = 0
    return [...canvasNodes]
      .sort((a, b) => (a.order_index ?? 999) - (b.order_index ?? 999))
      .map((cn, i) => {
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
          position:  pos ?? { x: i * (NODE_W + NODE_GAP), y: 0 },
          data: {
            canvasNode: cn,
            onClick: () => {
              setChatNode(null); setChatMessages([]); setChatSessionId(null)
              setSelectedNode(cn)
            },
            locked:    lockedNodeIds.has(cn.project_node_id),
            projectId: project.id,
            onImagesUpdate: (imgs: OutputImagesMap) => {
              // Invalidar caché del deck para que muestre las nuevas variaciones
              invalidateAssetDeckCache(project.id, cn.node?.id ?? '')
              setChatOutputImages(imgs)
              setCanvasData(prev => prev ? {
                ...prev,
                nodes: prev.nodes.map(n =>
                  n.project_node_id === cn.project_node_id && n.session
                    ? { ...n, session: { ...n.session, output_images: imgs } }
                    : n
                ),
              } : null)
            },
          } as ForgeNodeCardData,
        }
      })
  }, [savedLayout, lockedNodeIds, collapsedAssets, toggleAssetCollapse, handleRemoveAssetNode, saveTextNode])

  // Edges vienen de savedLayout; el usuario las dibuja manualmente
  const initNodes = useMemo(() => canvasData ? buildNodes(canvasData.nodes) : [], [canvasData, buildNodes])
  // Edges vienen de DB (canvasData); localStorage solo como caché de arranque rápido
  const initEdges = useMemo(() => savedLayout?.edges ?? [], [savedLayout])

  const [selectedEdgeId, setSelectedEdgeId] = useState<string | null>(null)

  const [nodes, setNodes, onNodesChange] = useNodesState(initNodes)
  const [edges, setEdges, onEdgesChange] = useEdgesState(initEdges)
  const nodesRef  = useRef(nodes)
  const edgesRef  = useRef(edges)
  nodesRef.current = nodes
  edgesRef.current = edges

  const onEdgeClick = useCallback((_: React.MouseEvent, edge: Edge) => {
    setSelectedEdgeId(prev => prev === edge.id ? null : edge.id)
  }, [])

  const onPaneClick = useCallback(() => setSelectedEdgeId(null), [])

  // Filtrar los cambios de selección que ReactFlow intenta manejar internamente
  const onEdgesChangeSafe = useCallback((changes: EdgeChange[]) => {
    onEdgesChange(changes.filter(c => c.type !== 'select'))
  }, [onEdgesChange])

  useEffect(() => {
    if (!canvasData) return
    const newNodes = buildNodes(canvasData.nodes)
    setNodes(prev => newNodes.map(n => {
      const existing = prev.find(p => p.id === n.id)
      return existing ? { ...n, position: existing.position } : n
    }))
    pendingPositionsRef.current = {}
    const validIds = new Set(newNodes.map(n => n.id))

    // Reconstruir edges desde DB, filtrando los que apunten a nodos eliminados
    const dbEdges: Edge[] = (canvasData.edges ?? [])
      .filter(e => validIds.has(e.source) && validIds.has(e.target))
      .map(e => ({
        id:           e.id,
        source:       e.source,
        target:       e.target,
        sourceHandle: e.sourceHandle ?? undefined,
        targetHandle: e.targetHandle ?? undefined,
        type:         'forgeEdge' as const,
        deletable:    true,
        data:         { color: '#6b7280', active: false },
      }))

    // El backend corre auto-wiring al cargar blueprints — los edges ya vienen en dbEdges
    setEdges(dbEdges)
  }, [canvasData, buildNodes, setNodes, setEdges, persistEdges])

  const { zoomIn, zoomOut, fitView, getViewport, setViewport, screenToFlowPosition, getNodes, setCenter, getNode } = useReactFlow()
  const { zoom } = useViewport()

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
    // Esperar un frame para que ReactFlow posicione los nodos antes de cambiar la cámara
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
        .filter(cn =>
          cn.node_type === 'library_asset' ||
          cn.node_type === 'text_input'    ||
          (cn.node_type === 'forge_node' && cn.session?.status === 'approved')
        )
        .map(cn => cn.project_node_id)
    )
  }, [canvasData])

  // Selección y onDelete inyectados en runtime (onDelete no es serializable a localStorage)
  const displayEdges = useMemo(
    () => edges.map(e => {
      const approved = forgyiSourceIds.has(e.source)
      return {
        ...e,
        selected: e.id === selectedEdgeId,
        data: {
          ...(e.data as object),
          onDelete: () => deleteEdge(e.id),
          approved,
          active:   false,
          color:    '#6b7280',
        },
      }
    }),
    [edges, selectedEdgeId, deleteEdge, forgyiSourceIds],
  )

  const onConnect = useCallback((connection: Connection) => {
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
            await canvasFetch(`/api/projects/${project.id}/canvas/edges`, {
              method: 'PUT',
              body: JSON.stringify({
                edges: [...edgesRef.current, newEdge].map(e => ({ source: e.source, target: e.target })),
              }),
            })
          }
        }

        await loadCanvas(true)
      }
    } catch (err) {
      console.error('[forge-canvas] drop failed', err)
    }
  }, [project.id, screenToFlowPosition, loadCanvas, getNodes])

  async function handleRemoveNode() {
    if (!selectedNode) return
    setRemoving(true)
    try {
      await canvasFetch(`/api/projects/${project.id}/canvas/nodes/${selectedNode.project_node_id}`, { method: 'DELETE' })
      const removedId = selectedNode.project_node_id
      setSelectedNode(null)
      // Actualizar estado local sin recargar todo el canvas
      setNodes(prev => prev.filter(n => n.id !== removedId))
      setEdges(prev => prev.filter(e => e.source !== removedId && e.target !== removedId))
      setCanvasData(prev => prev
        ? { ...prev, nodes: prev.nodes.filter(cn => cn.project_node_id !== removedId) }
        : prev
      )
      requestAnimationFrame(persistLayout)
    } catch (e) {
      console.error('[forge-canvas] remove failed', e)
    } finally {
      setRemoving(false)
    }
  }

  // Abre el chat cargando la sesión persistida del nodo; cierra el panel para evitar superposición
  async function handleRunNode(node: CanvasNode) {
    setSelectedNode(null)
    setChatLoading(true)
    try {
      const { session, messages } = await getNodeSession(project.id, node.node!.id)
      setChatSessionId(session?.id ?? null)
      setChatMessages(messages)
      setChatOutputImages((session?.output_images as OutputImagesMap) ?? {})
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
        <ForgeToolbar project={project} phase="idle" onRefresh={onRefresh} approvedCount={0} totalCount={0} />
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

  return (
    <>
    <ForgeToolbar
      project={project}
      phase="idle"
      onRefresh={onRefresh}
      approvedCount={approvedNodeIds.size}
      totalCount={canvasNodeIds.size}
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
      />

      {/* Área principal: blueprint bar + canvas */}
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
        <BlueprintBar
          activeBlueprint={canvasData?.active_blueprint ?? null}
          projectId={project.id}
          onLoaded={() => loadCanvas(true)}
        />

        <div style={{ flex: 1, position: 'relative', overflow: 'hidden' }}>
          {/* Fondo punteado */}
          <div style={{ position: 'absolute', inset: 0, pointerEvents: 'none', backgroundImage: 'radial-gradient(circle, var(--line-2) 1px, transparent 1px)', backgroundSize: '28px 28px', opacity: 0.6 }} />

          {/* Zoom controls */}
          <div style={{ position: 'absolute', bottom: 16, right: 16, zIndex: 10, display: 'flex', alignItems: 'center', gap: 4, background: 'var(--bg-1)', borderRadius: 10, border: '1px solid var(--line-2)', boxShadow: '0 2px 12px rgba(0,0,0,0.22)', padding: '5px 8px' }}>
            {([
              { label: '+', action: () => zoomIn({ duration: 200 }),                title: 'Zoom in'  },
              { label: '−', action: () => zoomOut({ duration: 200 }),               title: 'Zoom out' },
              { label: '⊡', action: () => fitView({ padding: 0.3, duration: 300 }), title: 'Fit view' },
            ] as const).map(({ label, action, title }) => (
              <button key={label} title={title} onClick={action} style={{ padding: '5px 10px', borderRadius: 6, border: '1px solid var(--line-2)', background: 'var(--bg-2)', color: 'var(--text-1)', cursor: 'pointer', fontSize: 11, fontFamily: 'var(--font-mono)', fontWeight: 600 }}>
                {label}
              </button>
            ))}
            <span style={{ fontSize: 10, fontFamily: 'var(--font-mono)', color: 'var(--text-3)', minWidth: 32, textAlign: 'right' }}>
              {Math.round(zoom * 100)}%
            </span>
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
            onNodeDragStop={persistLayout}
            onMoveEnd={persistLayout}
            onDragOver={handleDragOver}
            onDrop={handleDrop}
            nodeTypes={NODE_TYPES}
            edgeTypes={EDGE_TYPES}
            proOptions={{ hideAttribution: true }}
            fitView={false}
            nodesDraggable
            nodesConnectable
            deleteKeyCode={null}
            isValidConnection={c => c.source !== c.target}
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
          locked={chatNode.session?.status === 'approved'}
          initialMessages={chatMessages}
          onSend={async (msg, file, attachmentUrl) => {
            const r = await chatWithForgeNode(project.id, chatForgeNode.id, msg, chatSessionId ?? undefined, file, attachmentUrl)
            if (r.doc_url) { setChatDocUrl(r.doc_url); setChatDocFormat(r.doc_format ?? null) }
            // Actualizar sesión en el estado local si es nueva
            if (!chatSessionId) {
              setChatSessionId(r.session_id)
              setCanvasData(prev => prev ? {
                ...prev,
                nodes: prev.nodes.map(n =>
                  n.node?.id === chatForgeNode.id
                    ? { ...n, session: { id: r.session_id, node_id: chatForgeNode.id, status: 'active' as const, iteration_count: 1, started_at: new Date().toISOString(), completed_at: null, output_asset_id: null, output_images: null, output_asset: null } }
                    : n
                ),
              } : null)
            } else {
              setChatSessionId(r.session_id)
            }
            return { reply: r.reply, attachment: r.attachment }
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
            // Recargar canvas para obtener output_asset actualizado
            loadCanvas(true)
          }}
          docUrl={chatDocUrl ?? undefined}
          docFormat={chatDocFormat ?? undefined}
          imageGenOutputs={(() => {
            const defs: ImageOutputDef[] = []
            for (const out of (chatForgeNode.outputs ?? [])) {
              if (out.image_gen && out.image_gen_model) {
                defs.push({ outputKey: out.name, format: out.format, imageGenModel: out.image_gen_model })
              }
            }
            return defs.length > 0 ? defs : undefined
          })()}
          outputImages={chatOutputImages}
          onGenerateItemImage={chatSessionId ? async (outputKey, itemIndex, itemText, condition) => {
            const r = await generateItemImage(project.id, chatForgeNode.id, chatSessionId, outputKey, itemIndex, itemText, condition)
            const imgs = r.output_images
            setChatOutputImages(imgs)
            // Sincronizar output modal: actualizar output_images en la sesión del nodo en canvas
            setCanvasData(prev => prev ? {
              ...prev,
              nodes: prev.nodes.map(n =>
                n.node?.id === chatForgeNode.id && n.session
                  ? { ...n, session: { ...n.session, output_images: imgs } }
                  : n
              ),
            } : null)
            return r
          } : undefined}
          onClose={() => { setChatNode(null); setChatMessages([]); setChatSessionId(null); setChatDocUrl(null); setChatDocFormat(null); setChatOutputImages({}) }}
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
    </div>
    </>
  )
}

// ─── ForgeCanvas ─────────────────────────────────────────────────────────────

export default function ForgeCanvas({ project, onRefresh }: { project: Project; onRefresh: () => void }) {
  return (
    <div style={{ height: '100vh', background: 'var(--bg-0)', display: 'flex', flexDirection: 'column' }}>
      <ReactFlowProvider>
        <ForgeCanvasInner project={project} onRefresh={onRefresh} />
      </ReactFlowProvider>
    </div>
  )
}
