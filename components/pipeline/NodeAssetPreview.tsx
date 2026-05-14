'use client'

import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import type { ImageRef, CharacterRenderStatus } from '@/lib/types'
import { getImageReferencePool, getCharatersStatus } from '@/lib/api'

type Item = { url: string; label?: string }
type PreviewData = { kind: 'loading' } | { kind: 'empty' } | { kind: 'ready'; items: Item[]; title: string }

const OVERLAY_W = 196
const THUMB_H   = 116
const CACHE = new Map<string, Item[]>()

interface Props {
  stepKey:        string
  projectId:      string
  anchor:         { left: number; top: number; width: number; height: number }
  onOverlayEnter: () => void
  onOverlayLeave: () => void
}

export default function NodeAssetPreview({ stepKey, projectId, anchor, onOverlayEnter, onOverlayLeave }: Props) {
  const [data, setData]           = useState<PreviewData>({ kind: 'loading' })
  const [zoomed, setZoomed]       = useState<Item | null>(null)

  useEffect(() => {
    let cancelled = false
    const key = `${projectId}:${stepKey}`
    const cached = CACHE.get(key)
    if (cached !== undefined) {
      const title = stepKey === 'image_reference' ? 'Reference images' : 'Character renders'
      setData(cached.length > 0 ? { kind: 'ready', items: cached, title } : { kind: 'empty' })
      return
    }

    async function load() {
      try {
        let items: Item[] = []
        if (stepKey === 'image_reference') {
          const pool: ImageRef[] = await getImageReferencePool(projectId)
          const selected = pool.filter(i => i.selected)
          items = (selected.length > 0 ? selected : pool).map(i => ({ url: i.image_url }))
        } else if (stepKey === 'charaters') {
          const chars: CharacterRenderStatus[] = await getCharatersStatus(projectId)
          items = chars
            .filter(c => c.current_version?.storage_url)
            .map(c => ({ url: c.current_version!.storage_url, label: c.character_name }))
        }
        if (cancelled) return
        CACHE.set(key, items)
        const title = stepKey === 'image_reference' ? 'Reference images' : 'Character renders'
        setData(items.length > 0 ? { kind: 'ready', items, title } : { kind: 'empty' })
      } catch {
        if (!cancelled) setData({ kind: 'empty' })
      }
    }
    load()
    return () => { cancelled = true }
  }, [stepKey, projectId])

  if (data.kind === 'empty') return null

  const spaceRight = window.innerWidth - (anchor.left + anchor.width)
  const left = spaceRight >= OVERLAY_W + 16
    ? anchor.left + anchor.width + 12
    : anchor.left - OVERLAY_W - 12
  const top = Math.min(anchor.top, window.innerHeight - 420)

  return createPortal(
    <>
      {/* Overlay panel */}
      <div
        onMouseEnter={onOverlayEnter}
        onMouseLeave={() => { if (!zoomed) onOverlayLeave() }}
        style={{
          position: 'fixed', left, top,
          width: OVERLAY_W, maxHeight: 420,
          background: 'var(--bg-1)',
          border: '1px solid var(--line-2)',
          borderRadius: 8,
          boxShadow: '0 8px 32px rgba(0,0,0,0.55)',
          zIndex: 9999,
          overflow: 'hidden',
          display: 'flex', flexDirection: 'column',
          animation: 'nodePreviewFadeIn 120ms ease',
        }}
      >
        <style>{`@keyframes nodePreviewFadeIn { from { opacity:0; transform:translateX(4px) } to { opacity:1; transform:none } }`}</style>

        {/* Header */}
        <div style={{
          padding: '5px 10px', borderBottom: '1px solid var(--line-2)',
          fontFamily: 'var(--font-mono)', fontSize: 9, color: 'var(--text-3)',
          textTransform: 'uppercase', letterSpacing: '0.08em',
          flexShrink: 0, display: 'flex', justifyContent: 'space-between',
        }}>
          {data.kind === 'loading' ? (
            <span>Loading…</span>
          ) : (
            <>
              <span>{data.title}</span>
              <span style={{ color: 'var(--text-2)' }}>{data.items.length}</span>
            </>
          )}
        </div>

        {/* Thumbnails */}
        {data.kind === 'loading' ? (
          <div style={{ padding: '20px 0', textAlign: 'center', fontFamily: 'var(--font-mono)', fontSize: 9, color: 'var(--text-3)' }}>…</div>
        ) : (
          <div style={{ overflowY: 'auto', flex: 1 }}>
            {data.items.map((item, i) => (
              <div
                key={i}
                onClick={() => setZoomed(item)}
                style={{ position: 'relative', borderBottom: '1px solid var(--line-2)', cursor: 'zoom-in' }}
              >
                <img
                  src={item.url}
                  alt={item.label ?? `Asset ${i + 1}`}
                  style={{ width: '100%', height: THUMB_H, objectFit: 'cover', objectPosition: 'top', display: 'block' }}
                />
                {item.label && (
                  <div style={{
                    position: 'absolute', bottom: 0, left: 0, right: 0,
                    background: 'linear-gradient(transparent, rgba(0,0,0,0.72))',
                    padding: '14px 8px 5px',
                    fontFamily: 'var(--font-mono)', fontSize: 9, color: '#fff',
                  }}>
                    {item.label}
                  </div>
                )}
                {/* Hover tint */}
                <div style={{
                  position: 'absolute', inset: 0,
                  background: 'rgba(255,255,255,0)',
                  transition: 'background 120ms',
                }}
                  onMouseEnter={e => (e.currentTarget.style.background = 'rgba(255,255,255,0.06)')}
                  onMouseLeave={e => (e.currentTarget.style.background = 'rgba(255,255,255,0)')}
                />
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Lightbox */}
      {zoomed && (
        <div
          onClick={() => setZoomed(null)}
          style={{
            position: 'fixed', inset: 0,
            background: 'rgba(0,0,0,0.88)',
            zIndex: 10000,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            animation: 'nodePreviewFadeIn 150ms ease',
          }}
        >
          <button
            onClick={() => setZoomed(null)}
            style={{
              position: 'fixed', top: 20, right: 24,
              background: 'none', border: 'none', cursor: 'pointer',
              color: '#fff', fontSize: 22, lineHeight: 1, opacity: 0.7,
              fontFamily: 'var(--font-mono)',
            }}
          >✕</button>
          <div onClick={e => e.stopPropagation()} style={{ position: 'relative', maxWidth: '90vw', maxHeight: '90vh' }}>
            <img
              src={zoomed.url}
              alt={zoomed.label ?? 'Asset'}
              style={{ maxWidth: '90vw', maxHeight: '90vh', objectFit: 'contain', borderRadius: 6, display: 'block' }}
            />
            {zoomed.label && (
              <div style={{
                position: 'absolute', bottom: 0, left: 0, right: 0,
                background: 'linear-gradient(transparent, rgba(0,0,0,0.75))',
                padding: '24px 16px 10px',
                fontFamily: 'var(--font-mono)', fontSize: 11, color: '#fff', borderRadius: '0 0 6px 6px',
              }}>
                {zoomed.label}
              </div>
            )}
          </div>
        </div>
      )}
    </>,
    document.body
  )
}
