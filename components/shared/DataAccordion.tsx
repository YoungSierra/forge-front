'use client'

// ─── Engine v1.9 · «Data (for the pipeline)» ────────────────────────────────────────────────
// Debajo de un documento, plegado: lo que la pieza lleva para el motor y los nodos siguientes —los
// outputs `internal` (connections, planes, sobres de imagen) y los bloques de máquina que iban dentro
// de una sección de documento—. Lo separa el back (`GET /api/assets/:id/content?view=document`); aquí
// solo se pinta: JSON en monoespaciada, lo demás como markdown.

import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { MD_COMPONENTS } from '@/lib/md-components'
import type { DocumentData, DocumentFile } from '@/lib/api'

const esJson = (t: string) => /^\s*```/.test(t) || /^\s*[\[{]/.test(t)

/** Las tarjetas de archivo de la vista: el visual_pitch (imagen), el .pptx del deck. Antes del acordeón «Data». */
export function DocumentFiles({ files }: { files: DocumentFile[] }) {
  if (!files?.length) return null
  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10, margin: '14px 0 4px' }}>
      {files.map((f, i) => (
        <a key={`${f.url}-${i}`} href={f.url} target="_blank" rel="noreferrer" onClick={e => e.stopPropagation()}
           style={{ display: 'flex', flexDirection: 'column', gap: 6, width: f.kind === 'image' ? 200 : 220, padding: 8, borderRadius: 8, textDecoration: 'none', background: 'var(--bg-3)', border: '1px solid var(--line-2)', color: 'var(--text-1)' }}>
          {f.kind === 'image' ? (
            <img src={f.url} alt={f.name} style={{ width: '100%', height: 150, objectFit: 'cover', borderRadius: 5, display: 'block' }} />
          ) : (
            <div style={{ height: 44, display: 'flex', alignItems: 'center', gap: 8, fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--text-2)' }}>
              <span style={{ fontSize: 20 }}>◈</span>{String(f.format || 'file').toUpperCase()} · open
            </div>
          )}
          <div style={{ fontSize: 10, fontFamily: 'var(--font-mono)', color: 'var(--text-2)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {(f.label || f.name).replace(/_/g, ' ')}
          </div>
        </a>
      ))}
    </div>
  )
}

export default function DataAccordion({ data, compact = false }: { data: DocumentData[]; compact?: boolean }) {
  if (!data?.length) return null
  return (
    <details style={{ marginTop: 18, borderTop: '1px solid var(--line-2)', paddingTop: 10 }}>
      <summary style={{
        cursor: 'pointer', fontSize: compact ? 10 : 11, fontFamily: 'var(--font-mono)', fontWeight: 700,
        color: 'var(--text-3)', letterSpacing: '0.04em', userSelect: 'none',
      }}>
        DATA (FOR THE PIPELINE) · {data.length}
      </summary>
      <div style={{ fontSize: 9, fontFamily: 'var(--font-mono)', color: 'var(--text-4)', margin: '6px 0 10px' }}>
        Read by the engine and the next nodes; not part of the document.
      </div>
      {data.map((d, i) => (
        <details key={`${d.key ?? 'block'}-${i}`} style={{ marginBottom: 8, border: '1px solid var(--line-2)', borderRadius: 6, background: 'var(--bg-2)' }}>
          <summary style={{ cursor: 'pointer', padding: '6px 10px', fontSize: 10, fontFamily: 'var(--font-mono)', fontWeight: 700, color: 'var(--text-2)' }}>
            {(d.label || d.key || 'block').replace(/_/g, ' ')}{d.kind === 'block' ? ' · machine block' : ''}
          </summary>
          <div style={{ padding: '4px 12px 12px', fontSize: compact ? 10.5 : 11, lineHeight: 1.6, color: 'var(--text-1)' }}>
            {esJson(d.content) ? (
              <pre style={{ margin: 0, fontFamily: 'var(--font-mono)', fontSize: 10.5, lineHeight: 1.45, whiteSpace: 'pre-wrap', wordBreak: 'break-word', color: 'var(--text-2)' }}>
                {d.content.replace(/^\s*```json\s*\n?|\n?```\s*$/g, '')}
              </pre>
            ) : (
              <ReactMarkdown remarkPlugins={[remarkGfm]} components={MD_COMPONENTS}>{d.content}</ReactMarkdown>
            )}
          </div>
        </details>
      ))}
    </details>
  )
}
