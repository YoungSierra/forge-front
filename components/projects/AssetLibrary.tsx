'use client'

import { useEffect, useState, useCallback } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { getProjectAssets, getProjects, assetUrl } from '@/lib/api'
import type { UnifiedAsset, UnifiedAssetVersion } from '@/lib/api'
import type { Project } from '@/lib/types'
import ModelViewer from '@/components/shared/ModelViewer'
import { MD_COMPONENTS } from '@/lib/md-components'

// Mapeo de node_key → etiqueta legible
const NODE_KEY_LABEL: Record<string, string> = {
  gdd: 'GDD', sprites: 'Sprites', characters: 'Characters', charaters: 'Characters',
  levels: 'Levels', backgrounds: 'Backgrounds', concept_art: 'Concept Art',
  icons: 'Icons', hud: 'HUD', splash_art: 'Splash Art', marketing: 'Marketing',
  audio: 'Audio', sfx: 'SFX', code: 'Code', uiux: 'UI/UX',
  visual_guide: 'Visual Guide', art_direction_intake: 'Art Direction',
  modeling_characters: 'Modeling (Chars)', modeling_environments: 'Modeling (Envs)', modeling_props: 'Modeling (Props)',
  environments: 'Environments', props: 'Props',
  modeling: 'Modeling', texturing: 'Texturing', rigging: 'Rigging',
  animation: 'Animation', vfx: 'VFX', lighting: 'Lighting',
  cinematics: 'Cinematics', voice: 'Voice', playtesting: 'Playtesting',
  image_reference: 'Image Reference',
}

// Color por node_key (legacy) o por format (forge)
const NODE_KEY_COLOR: Record<string, string> = {
  gdd: 'var(--cat-design)', sprites: 'var(--cat-asset)', characters: 'var(--cat-asset)',
  charaters: 'var(--cat-asset)', levels: 'var(--cat-level)', backgrounds: 'var(--cat-level)',
  concept_art: 'var(--cat-design)', icons: 'var(--cat-asset)', hud: 'var(--cat-code)',
  splash_art: 'var(--cat-output)', marketing: 'var(--cat-output)', audio: 'var(--cat-audio)',
  sfx: 'var(--cat-audio)', code: 'var(--cat-code)', uiux: 'var(--cat-gate)',
  visual_guide: 'var(--cat-design)', art_direction_intake: 'var(--cat-design)',
  modeling_characters: 'var(--cat-asset)', modeling_environments: 'var(--cat-level)', modeling_props: 'var(--cat-asset)',
  environments: 'var(--cat-level)', props: 'var(--cat-asset)',
  modeling: 'var(--cat-asset)', texturing: 'var(--cat-asset)', rigging: 'var(--cat-asset)',
  animation: 'var(--cat-asset)', vfx: 'var(--cat-output)', lighting: 'var(--cat-design)',
  cinematics: 'var(--cat-output)', voice: 'var(--cat-audio)', playtesting: 'var(--cat-gate)',
  image_reference: 'var(--cat-asset)',
}

const FORMAT_COLOR: Record<string, string> = {
  image:    'var(--cat-asset)',
  document: 'var(--cat-design)',
  markdown: 'var(--cat-design)',
  audio:    'var(--cat-audio)',
  model_3d: 'var(--cat-asset)',
  code:     'var(--cat-code)',
  other:    'var(--text-3)',
}

const FORMAT_LABEL: Record<string, string> = {
  image: 'Image', document: 'Document', markdown: 'Document',
  audio: 'Audio', model_3d: '3D Model', code: 'Code', other: 'Other',
}

const STATUS_COLOR: Record<string, string> = {
  approved: 'var(--state-success)', pending: 'var(--state-warning)',
  rejected: 'var(--state-error)', invalidated: 'var(--text-3)',
}

function assetColor(a: UnifiedAsset) {
  if (a.source === 'legacy' && a.node_key && NODE_KEY_COLOR[a.node_key]) return NODE_KEY_COLOR[a.node_key]
  return FORMAT_COLOR[a.format] ?? 'var(--text-3)'
}

function assetCategoryKey(a: UnifiedAsset): string {
  if (a.source === 'legacy' && a.node_key) return a.node_key
  return a.format ?? 'other'
}

function assetCategoryLabel(a: UnifiedAsset): string {
  if (a.source === 'legacy' && a.node_key) return NODE_KEY_LABEL[a.node_key] ?? a.node_key
  return FORMAT_LABEL[a.format] ?? a.format
}

function currentVersion(a: UnifiedAsset): UnifiedAssetVersion | undefined {
  return a.versions?.find(v => v.is_current) ?? a.versions?.[0]
}

function effectiveUrl(a: UnifiedAsset): string {
  const verUrl = currentVersion(a)?.storage_url
  const raw = verUrl || a.storage_url || ''
  return raw ? assetUrl(raw) : ''
}

function isImage(url: string) {
  if (!url) return false
  const ext = url.split('?')[0].split('.').pop()?.toLowerCase()
  return ['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'avif'].includes(ext ?? '')
}

function isGlb(url: string) {
  if (!url) return false
  const ext = url.split('?')[0].split('.').pop()?.toLowerCase()
  return ext === 'glb' || ext === 'gltf'
}

function isPdf(url: string) {
  if (!url) return false
  const ext = url.split('?')[0].split('.').pop()?.toLowerCase()
  return ext === 'pdf' || ext === 'docx' || ext === 'doc'
}

function thumbnailIcon(a: UnifiedAsset) {
  if (a.format === 'audio') return '♪'
  if (a.format === 'code') return '</>'
  if (a.format === 'model_3d') return '⬡'
  if (a.format === 'document' || a.format === 'markdown') return '◈'
  return '◈'
}


function AssetCard({ asset, onClick }: { asset: UnifiedAsset; onClick: () => void }) {
  const url        = effectiveUrl(asset)
  const hasImage   = isImage(url) || asset.format === 'image'
  const has3D      = isGlb(url) || asset.format === 'model_3d'
  const catColor   = assetColor(asset)
  const catLabel   = assetCategoryLabel(asset)
  const hasVersions = (asset.versions?.length ?? 0) > 1
  const ver        = currentVersion(asset)

  return (
    <div
      onClick={onClick}
      style={{
        background: 'var(--bg-2)', border: '1px solid var(--line-2)', borderRadius: 8,
        overflow: 'hidden', cursor: 'pointer', transition: 'border-color 120ms, box-shadow 120ms',
      }}
      onMouseEnter={e => {
        (e.currentTarget as HTMLDivElement).style.borderColor = catColor
        ;(e.currentTarget as HTMLDivElement).style.boxShadow = `0 4px 20px rgba(0,0,0,0.3)`
      }}
      onMouseLeave={e => {
        (e.currentTarget as HTMLDivElement).style.borderColor = 'var(--line-2)'
        ;(e.currentTarget as HTMLDivElement).style.boxShadow = 'none'
      }}
    >
      {/* Thumbnail */}
      <div style={{ width: '100%', aspectRatio: '16/9', background: 'var(--bg-3)', position: 'relative', overflow: 'hidden' }}>
        {hasImage && url ? (
          <img
            src={url}
            alt={asset.name}
            style={{ width: '100%', height: '100%', objectFit: 'cover', objectPosition: 'top' }}
            onError={e => { (e.target as HTMLImageElement).style.display = 'none' }}
          />
        ) : has3D ? (
          <div style={{ width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', flexDirection: 'column', gap: 6,
            background: `color-mix(in oklch, ${catColor} 6%, var(--bg-3))` }}>
            <div style={{ fontSize: 26, opacity: 0.7, animation: 'rotate3d 4s linear infinite', transformStyle: 'preserve-3d' }}>⬡</div>
            <div style={{ fontSize: 9, fontFamily: 'var(--font-mono)', color: catColor, textTransform: 'uppercase', letterSpacing: '0.08em', opacity: 0.8 }}>
              3D Model
            </div>
          </div>
        ) : (
          <div style={{ width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', flexDirection: 'column', gap: 6 }}>
            <div style={{ fontSize: 22, opacity: 0.3 }}>{thumbnailIcon(asset)}</div>
            <div style={{ fontSize: 9, fontFamily: 'var(--font-mono)', color: 'var(--text-2)', textTransform: 'uppercase' }}>
              {catLabel}
            </div>
          </div>
        )}
        {hasVersions && (
          <div style={{
            position: 'absolute', top: 6, right: 6,
            background: 'rgba(0,0,0,0.72)', borderRadius: 4, padding: '2px 6px',
            fontSize: 9, fontFamily: 'var(--font-mono)', color: 'rgba(255,255,255,0.9)',
          }}>
            v{ver?.version_number ?? 1} / {asset.versions.length}
          </div>
        )}
        {asset.source === 'forge' && (
          <div style={{
            position: 'absolute', top: 6, left: 6,
            background: 'color-mix(in oklch, var(--action) 20%, rgba(0,0,0,0.7))', borderRadius: 4, padding: '2px 6px',
            fontSize: 8, fontFamily: 'var(--font-mono)', color: 'var(--action)', letterSpacing: '0.06em',
          }}>
            FORGE
          </div>
        )}
      </div>

      {/* Info */}
      <div style={{ padding: '10px 12px' }}>
        <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-0)', marginBottom: 6, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {asset.name}
        </div>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 4 }}>
          <span style={{
            fontSize: 9, fontFamily: 'var(--font-mono)', padding: '2px 7px', borderRadius: 99,
            background: `color-mix(in oklch, ${catColor} 12%, var(--bg-3))`,
            border: `1px solid color-mix(in oklch, ${catColor} 30%, transparent)`,
            color: catColor, textTransform: 'uppercase', letterSpacing: '0.06em',
          }}>
            {catLabel}
          </span>
          <span style={{
            fontSize: 9, fontFamily: 'var(--font-mono)', padding: '2px 7px', borderRadius: 99,
            color: STATUS_COLOR[asset.status] ?? 'var(--text-3)',
          }}>
            {asset.status}
          </span>
        </div>
      </div>
    </div>
  )
}

function Lightbox({ asset, onClose }: { asset: UnifiedAsset; onClose: () => void }) {
  const [viewingVersion, setViewingVersion] = useState<UnifiedAssetVersion | undefined>(currentVersion(asset))
  const verUrl   = viewingVersion?.storage_url
  const url      = verUrl ? assetUrl(verUrl) : effectiveUrl(asset)
  const hasImage = isImage(url) || asset.format === 'image'
  const has3D    = isGlb(url) || asset.format === 'model_3d'
  const hasDoc   = isPdf(url) || asset.format === 'document' || asset.format === 'markdown'
  const catColor = assetColor(asset)
  const sortedVersions = [...(asset.versions ?? [])].sort((a, b) => b.version_number - a.version_number)

  useEffect(() => {
    function onKey(e: KeyboardEvent) { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  return (
    <div
      onClick={e => { if (e.target === e.currentTarget) onClose() }}
      style={{
        position: 'fixed', inset: 0, zIndex: 1000,
        background: 'rgba(0,0,0,0.85)', backdropFilter: 'blur(4px)',
        display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24,
      }}
    >
      <div style={{
        background: 'var(--bg-1)', border: '1px solid var(--line-2)', borderRadius: 12,
        display: 'flex', maxWidth: 1100, width: '100%', maxHeight: '90vh', overflow: 'hidden',
      }}>
        {/* Panel de preview */}
        <div style={{ flex: 1, background: 'var(--bg-0)', display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: 400, position: 'relative', overflow: 'hidden' }}>
          {hasImage && url ? (
            <img
              src={url}
              alt={asset.name}
              style={{ maxWidth: '100%', maxHeight: '80vh', objectFit: 'contain' }}
            />
          ) : has3D ? (
            <ModelViewer url={url} style={{ width: '100%', height: '100%', minHeight: 400 }} />
          ) : asset.content ? (
            // Markdown / documento de texto — render completo con scroll
            <div style={{ width: '100%', height: '100%', overflowY: 'auto', padding: '28px 32px', fontSize: 12, color: 'var(--text-1)', lineHeight: 1.7, alignSelf: 'flex-start' }}>
              <ReactMarkdown remarkPlugins={[remarkGfm]} components={MD_COMPONENTS}>
                {asset.content}
              </ReactMarkdown>
            </div>
          ) : hasDoc && url ? (
            // PDF / DOCX con URL — iframe para PDFs, fallback descarga para otros
            url.endsWith('.pdf') ? (
              <iframe
                src={url}
                style={{ width: '100%', height: '100%', minHeight: 400, border: 'none' }}
                title={asset.name}
              />
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 16, opacity: 0.7 }}>
                <div style={{ fontSize: 48 }}>◈</div>
                <a href={url} target="_blank" rel="noreferrer"
                  style={{ background: 'var(--action)', color: '#0a0a0c', borderRadius: 6, padding: '8px 18px', fontSize: 12, fontFamily: 'var(--font-mono)', fontWeight: 600, textDecoration: 'none' }}>
                  ↓ Download file
                </a>
              </div>
            )
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 12, opacity: 0.4 }}>
              <div style={{ fontSize: 48 }}>{thumbnailIcon(asset)}</div>
              <div style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--text-3)' }}>No preview available</div>
            </div>
          )}
          {/* Botón download flotante para docs con URL */}
          {hasDoc && url && !url.endsWith('.pdf') && asset.content && (
            <a
              href={url} target="_blank" rel="noreferrer"
              style={{
                position: 'absolute', bottom: 16, right: 16,
                background: 'var(--action)', color: '#0a0a0c', borderRadius: 6,
                padding: '6px 14px', fontSize: 11, fontFamily: 'var(--font-mono)', fontWeight: 600,
                textDecoration: 'none',
              }}
            >
              ↓ Download
            </a>
          )}
        </div>

        {/* Sidebar */}
        <div style={{ width: 280, flexShrink: 0, borderLeft: '1px solid var(--line-2)', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
          {/* Header */}
          <div style={{ padding: '16px 20px', borderBottom: '1px solid var(--line-2)', display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 8 }}>
            <div style={{ minWidth: 0 }}>
              <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-0)', marginBottom: 4, wordBreak: 'break-word' }}>{asset.name}</div>
              <span style={{
                fontSize: 9, fontFamily: 'var(--font-mono)', padding: '2px 7px', borderRadius: 99,
                background: `color-mix(in oklch, ${catColor} 12%, var(--bg-3))`,
                border: `1px solid color-mix(in oklch, ${catColor} 30%, transparent)`,
                color: catColor, textTransform: 'uppercase', letterSpacing: '0.06em',
              }}>
                {assetCategoryLabel(asset)}
              </span>
            </div>
            <button
              onClick={onClose}
              style={{ background: 'none', border: 'none', color: 'var(--text-3)', cursor: 'pointer', fontSize: 18, padding: 0, flexShrink: 0 }}
            >
              ×
            </button>
          </div>

          {/* Metadata */}
          <div style={{ padding: '14px 20px', borderBottom: '1px solid var(--line-2)', display: 'flex', flexDirection: 'column', gap: 8 }}>
            <div>
              <div style={{ fontSize: 9, fontFamily: 'var(--font-mono)', color: 'var(--text-3)', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 2 }}>Status</div>
              <div style={{ fontSize: 11, color: STATUS_COLOR[asset.status] ?? 'var(--text-3)' }}>{asset.status}</div>
            </div>
            {asset.node_title && (
              <div>
                <div style={{ fontSize: 9, fontFamily: 'var(--font-mono)', color: 'var(--text-3)', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 2 }}>Node</div>
                <div style={{ fontSize: 11, color: 'var(--text-1)' }}>{asset.node_title}</div>
              </div>
            )}
            {asset.phase && (
              <div>
                <div style={{ fontSize: 9, fontFamily: 'var(--font-mono)', color: 'var(--text-3)', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 2 }}>Phase</div>
                <div style={{ fontSize: 11, color: 'var(--text-2)' }}>{asset.phase}</div>
              </div>
            )}
            {viewingVersion?.model_used && (
              <div>
                <div style={{ fontSize: 9, fontFamily: 'var(--font-mono)', color: 'var(--text-3)', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 2 }}>Model</div>
                <div style={{ fontSize: 10, color: 'var(--text-2)', fontFamily: 'var(--font-mono)', wordBreak: 'break-all' }}>{viewingVersion.model_used}</div>
              </div>
            )}
            {asset.created_at && (
              <div>
                <div style={{ fontSize: 9, fontFamily: 'var(--font-mono)', color: 'var(--text-2)', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 2 }}>Created</div>
                <div style={{ fontSize: 10, color: 'var(--text-2)', fontFamily: 'var(--font-mono)' }}>
                  {new Date(asset.created_at).toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' })}
                </div>
              </div>
            )}
          </div>


          {/* Version history */}
          {sortedVersions.length > 0 && (
            <div style={{ flex: 1, overflow: 'auto', padding: '14px 20px' }}>
              <div style={{ fontSize: 9, fontFamily: 'var(--font-mono)', color: 'var(--text-2)', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 10 }}>
                Versions ({sortedVersions.length})
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                {sortedVersions.map(v => {
                  const active = v.id === viewingVersion?.id
                  return (
                    <div
                      key={v.id}
                      onClick={() => setViewingVersion(v)}
                      style={{
                        padding: '8px 10px', borderRadius: 6, cursor: 'pointer',
                        border: `1px solid ${active ? catColor : 'var(--line-2)'}`,
                        background: active ? `color-mix(in oklch, ${catColor} 8%, var(--bg-2))` : 'var(--bg-2)',
                        transition: 'all 120ms',
                      }}
                    >
                      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 2 }}>
                        <span style={{ fontSize: 10, fontWeight: 600, color: active ? catColor : 'var(--text-1)', fontFamily: 'var(--font-mono)' }}>
                          v{v.version_number}
                        </span>
                        {v.is_current && (
                          <span style={{ fontSize: 8, fontFamily: 'var(--font-mono)', color: 'var(--cat-code)', background: 'color-mix(in oklch, var(--cat-code) 12%, var(--bg-3))', padding: '1px 5px', borderRadius: 3 }}>
                            current
                          </span>
                        )}
                      </div>
                      {v.model_used && (
                        <div style={{ fontSize: 9, color: 'var(--text-2)', fontFamily: 'var(--font-mono)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                          {v.model_used}
                        </div>
                      )}
                      {v.created_at && (
                        <div style={{ fontSize: 9, color: 'var(--text-2)', marginTop: 2 }}>
                          {new Date(v.created_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
                        </div>
                      )}
                    </div>
                  )
                })}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

export default function AssetLibrary({ defaultProjectId }: { defaultProjectId?: string }) {
  const [allAssets, setAllAssets] = useState<UnifiedAsset[]>([])
  const [projects, setProjects]   = useState<Project[]>([])
  const [loading, setLoading]     = useState(true)
  const [projectId, setProjectId] = useState<string>(defaultProjectId ?? '')
  const [categoryKey, setCategoryKey] = useState<string>('')
  const [page, setPage]           = useState(0)
  const [selected, setSelected]   = useState<UnifiedAsset | null>(null)
  const [pageSize, setPageSize]   = useState(12)

  useEffect(() => {
    getProjects().then(ps => setProjects([...ps].sort((a, b) => a.name.localeCompare(b.name)))).catch(() => {})
  }, [])

  const reload = useCallback(() => {
    setLoading(true)
    setPage(0)
    getProjectAssets(projectId || undefined)
      .then(setAllAssets)
      .catch(() => setAllAssets([]))
      .finally(() => setLoading(false))
  }, [projectId])

  useEffect(() => { reload() }, [reload])
  useEffect(() => { setPage(0) }, [categoryKey, pageSize])

  const assets     = categoryKey ? allAssets.filter(a => assetCategoryKey(a) === categoryKey) : allAssets
  const totalPages = Math.ceil(assets.length / pageSize)
  const pageAssets = assets.slice(page * pageSize, (page + 1) * pageSize)

  const countByCategory: Record<string, number> = {}
  allAssets.forEach(a => {
    const cat = assetCategoryKey(a)
    if (cat) countByCategory[cat] = (countByCategory[cat] ?? 0) + 1
  })

  return (
    <div style={{ display: 'flex', gap: 0, minHeight: 500 }}>

      {/* Left sidebar — category menu */}
      <div style={{ width: 180, flexShrink: 0, borderRight: '1px solid var(--line-2)', paddingRight: 0, marginRight: 24 }}>

        {/* Project selector */}
        <div style={{ marginBottom: 20 }}>
          <div style={{ fontSize: 9, fontFamily: 'var(--font-mono)', color: 'var(--text-3)', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 6 }}>
            Project
          </div>
          <select
            value={projectId}
            onChange={e => setProjectId(e.target.value)}
            style={{
              width: '100%', background: 'var(--bg-2)', border: '1px solid var(--line-2)',
              borderRadius: 6, padding: '5px 8px', fontSize: 11, color: 'var(--text-1)',
              fontFamily: 'var(--font-mono)', cursor: 'pointer', outline: 'none',
            }}
          >
            <option value="">All projects</option>
            {projects.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
        </div>

        {/* Category nav */}
        <div style={{ fontSize: 9, fontFamily: 'var(--font-mono)', color: 'var(--text-3)', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 6 }}>
          Type
        </div>
        <nav style={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
          {[['', 'All'] as [string, string], ...Object.keys(countByCategory).sort().map(k => [k, NODE_KEY_LABEL[k] ?? FORMAT_LABEL[k] ?? k] as [string, string])].map(([key, label]) => {
            const active = categoryKey === key
            const count  = key === '' ? allAssets.length : (countByCategory[key] ?? 0)
            const color  = key ? (NODE_KEY_COLOR[key] ?? FORMAT_COLOR[key] ?? 'var(--text-2)') : 'var(--text-2)'
            return (
              <button
                key={key}
                onClick={() => setCategoryKey(key)}
                style={{
                  display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                  padding: '7px 10px', borderRadius: 6, border: 'none', cursor: 'pointer',
                  background: active ? `color-mix(in oklch, ${color} 12%, var(--bg-2))` : 'transparent',
                  color: active ? color : 'var(--text-3)',
                  fontSize: 12, textAlign: 'left', transition: 'all 120ms',
                  borderLeft: active ? `2px solid ${color}` : '2px solid transparent',
                }}
                onMouseEnter={e => { if (!active) (e.currentTarget as HTMLButtonElement).style.background = 'var(--bg-2)' }}
                onMouseLeave={e => { if (!active) (e.currentTarget as HTMLButtonElement).style.background = 'transparent' }}
              >
                <span>{label}</span>
                {count > 0 && (
                  <span style={{ fontSize: 9, fontFamily: 'var(--font-mono)', color: active ? color : 'var(--text-3)', opacity: 0.7 }}>
                    {count}
                  </span>
                )}
              </button>
            )
          })}
        </nav>
      </div>

      {/* Main content */}
      <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', height: 'calc(100vh - 230px)' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: 10, marginBottom: 16, flexShrink: 0 }}>
          <span style={{ fontSize: 10, fontFamily: 'var(--font-mono)', color: 'var(--text-3)' }}>
            {loading ? '…' : `${assets.length} asset${assets.length !== 1 ? 's' : ''}`}
          </span>
          <button
              onClick={reload}
              disabled={loading}
              title="Reload assets"
              style={{
                background: 'var(--bg-2)', border: '1px solid var(--line-2)', borderRadius: 6,
                padding: '4px 9px', fontSize: 12, color: loading ? 'var(--text-3)' : 'var(--text-1)',
                cursor: loading ? 'not-allowed' : 'pointer', fontFamily: 'var(--font-mono)',
                display: 'flex', alignItems: 'center', gap: 5, opacity: loading ? 0.5 : 1,
              }}
            >
              <span style={loading ? { display: 'inline-block', animation: 'spin 0.8s linear infinite' } : undefined}>⟳</span>
            </button>
          <select
            value={pageSize}
            onChange={e => setPageSize(Number(e.target.value))}
            style={{
              background: 'var(--bg-2)', border: '1px solid var(--line-2)', borderRadius: 6,
              padding: '4px 8px', fontSize: 11, color: 'var(--text-1)', fontFamily: 'var(--font-mono)',
              cursor: 'pointer', outline: 'none',
            }}
          >
            {[12, 24, 36, 48].map(s => <option key={s} value={s}>{s} per page</option>)}
          </select>
        </div>

        {/* Scrollable grid area */}
        <div style={{ flex: 1, overflowY: 'auto', minHeight: 0 }}>
          {loading ? (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: 12 }}>
              {[1,2,3,4,5,6].map(i => (
                <div key={i} style={{ borderRadius: 8, border: '1px solid var(--line-2)', background: 'var(--bg-2)', aspectRatio: '4/3', opacity: 0.4, animation: 'pulse 1.5s ease-in-out infinite' }} />
              ))}
              <style>{`@keyframes pulse { 0%,100%{opacity:.4} 50%{opacity:.2} } @keyframes spin { to { transform: rotate(360deg) } } @keyframes rotate3d { 0%{transform:rotate(0deg)} 100%{transform:rotate(360deg)} }`}</style>
            </div>
          ) : assets.length === 0 ? (
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: '80px 0', gap: 12, textAlign: 'center' }}>
              <div style={{ fontSize: 32, opacity: 0.2 }}>◈</div>
              <p style={{ fontSize: 13, color: 'var(--text-3)', fontFamily: 'var(--font-mono)' }}>No assets found</p>
            </div>
          ) : (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: 12 }}>
              {pageAssets.map(a => (
                <AssetCard key={a.id} asset={a} onClick={() => setSelected(a)} />
              ))}
            </div>
          )}
        </div>

        {/* Pagination */}
        {totalPages > 1 && (
          <div style={{ flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6, paddingTop: 16, borderTop: '1px solid var(--line-2)', marginTop: 12 }}>
            <button
              onClick={() => setPage(p => Math.max(0, p - 1))}
              disabled={page === 0}
              style={{
                background: 'var(--bg-2)', border: '1px solid var(--line-2)', borderRadius: 6,
                padding: '5px 12px', fontSize: 11, color: page === 0 ? 'var(--text-3)' : 'var(--text-1)',
                cursor: page === 0 ? 'default' : 'pointer', fontFamily: 'var(--font-mono)',
              }}
            >
              ←
            </button>
            {Array.from({ length: totalPages }).map((_, i) => (
              <button
                key={i}
                onClick={() => setPage(i)}
                style={{
                  background: i === page ? 'var(--action)' : 'var(--bg-2)',
                  border: '1px solid var(--line-2)', borderRadius: 6,
                  padding: '5px 10px', fontSize: 11,
                  color: i === page ? '#0a0a0c' : 'var(--text-2)',
                  cursor: 'pointer', fontFamily: 'var(--font-mono)', fontWeight: i === page ? 600 : 400,
                  minWidth: 32,
                }}
              >
                {i + 1}
              </button>
            ))}
            <button
              onClick={() => setPage(p => Math.min(totalPages - 1, p + 1))}
              disabled={page === totalPages - 1}
              style={{
                background: 'var(--bg-2)', border: '1px solid var(--line-2)', borderRadius: 6,
                padding: '5px 12px', fontSize: 11, color: page === totalPages - 1 ? 'var(--text-3)' : 'var(--text-1)',
                cursor: page === totalPages - 1 ? 'default' : 'pointer', fontFamily: 'var(--font-mono)',
              }}
            >
              →
            </button>
          </div>
        )}
      </div>

      {selected && <Lightbox asset={selected} onClose={() => setSelected(null)} />}
    </div>
  )
}
