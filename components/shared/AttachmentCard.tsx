'use client'

import type { ChatAttachment } from '@/lib/api'

// ─── Helpers ──────────────────────────────────────────────────────────────────

function fileTypeLabel(mime: string | null): string {
  if (!mime) return 'FILE'
  if (mime.startsWith('image/'))                         return 'IMG'
  if (mime === 'application/pdf')                        return 'PDF'
  if (mime.includes('wordprocessingml') || mime === 'application/msword') return 'DOC'
  if (mime.includes('presentationml') || mime.includes('powerpoint'))     return 'PPT'
  if (mime === 'text/plain')                             return 'TXT'
  if (mime === 'application/json')                       return 'JSON'
  if (mime === 'text/markdown')                          return 'MD'
  if (mime === 'text/uri-list')                          return 'URL'
  return 'FILE'
}

function fileSizeLabel(bytes: number | null): string {
  if (!bytes) return ''
  if (bytes < 1024)       return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

function typeBadgeColor(mime: string | null): { bg: string; color: string } {
  if (!mime) return { bg: 'rgba(148,163,184,0.12)', color: '#94A3B8' }
  if (mime.startsWith('image/'))  return { bg: 'rgba(139,92,246,0.12)', color: '#A78BFA' }
  if (mime === 'text/uri-list')   return { bg: 'rgba(56,189,248,0.12)',  color: '#38BDF8' }
  if (mime === 'application/pdf') return { bg: 'rgba(248,113,113,0.12)', color: '#F87171' }
  return { bg: 'rgba(251,191,36,0.12)', color: '#FBBF24' }
}

// ─── AttachmentCard ───────────────────────────────────────────────────────────

interface Props {
  attachment: ChatAttachment
  variant:    'composing' | 'history'
  onRemove?:  () => void
}

export default function AttachmentCard({ attachment, variant, onRemove }: Props) {
  const label  = fileTypeLabel(attachment.mime_type)
  const size   = fileSizeLabel(attachment.file_size_bytes)
  const colors = typeBadgeColor(attachment.mime_type)
  const isImg  = attachment.mime_type?.startsWith('image/')
  const isUrl  = attachment.mime_type === 'text/uri-list'

  return (
    <div style={{
      display:      'flex',
      alignItems:   'center',
      gap:          8,
      padding:      variant === 'composing' ? '7px 10px' : '5px 8px',
      borderRadius: 8,
      background:   'var(--bg-3)',
      border:       '1px solid var(--line-2)',
      maxWidth:     320,
      position:     'relative',
    }}>

      {/* Thumbnail para imágenes / badge de tipo para todo lo demás */}
      {isImg && attachment.storage_url ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={attachment.storage_url}
          alt={attachment.file_name}
          style={{
            width: 32, height: 32, borderRadius: 4,
            objectFit: 'cover', flexShrink: 0,
            border: '1px solid var(--line-2)',
          }}
        />
      ) : (
        <div style={{
          width:           32,
          height:          32,
          borderRadius:    4,
          background:      colors.bg,
          color:           colors.color,
          display:         'flex',
          alignItems:      'center',
          justifyContent:  'center',
          fontSize:        9,
          fontFamily:      'var(--font-mono)',
          fontWeight:      700,
          letterSpacing:   '.04em',
          flexShrink:      0,
        }}>
          {label}
        </div>
      )}

      {/* Nombre y tamaño */}
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{
          fontSize:     11,
          color:        'var(--text-0)',
          fontWeight:   500,
          overflow:     'hidden',
          textOverflow: 'ellipsis',
          whiteSpace:   'nowrap',
          maxWidth:     200,
        }}>
          {isUrl ? attachment.storage_url : attachment.file_name}
        </div>
        {size && (
          <div style={{
            fontSize:   9,
            color:      'var(--text-4)',
            fontFamily: 'var(--font-mono)',
            marginTop:  1,
          }}>
            {size}
          </div>
        )}
      </div>

      {/* Botón de eliminar — solo en variante composing */}
      {variant === 'composing' && onRemove && (
        <button
          onClick={onRemove}
          title="Remove attachment"
          style={{
            flexShrink: 0,
            width:      18,
            height:     18,
            borderRadius: 4,
            border:     '1px solid var(--line-2)',
            background: 'var(--bg-4)',
            color:      'var(--text-3)',
            fontSize:   10,
            cursor:     'pointer',
            display:    'flex',
            alignItems: 'center',
            justifyContent: 'center',
            lineHeight: 1,
            padding:    0,
          }}
        >
          ✕
        </button>
      )}
    </div>
  )
}
