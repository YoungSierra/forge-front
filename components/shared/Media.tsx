'use client'

import React from 'react'

/**
 * Un deck dejó de producir solo láminas.
 *
 * Desde que el motor recoge `videos` y `audio` además de `images`, en `output_images` conviven
 * un png del Art Style Guide, un mp4 de Marketing y un mp3 de Audio Base. Pintarlos todos con
 * `<img>` deja los dos últimos como imagen rota: el archivo está bien subido y en pantalla no se
 * ve nada, que es el peor de los fallos porque parece que la corrida no produjo.
 *
 * La clase sale de la EXTENSIÓN de la URL, igual que en el back: el `kind` del registro dice qué
 * se pidió, y el archivo dice qué llegó.
 */
export type MediaKind = 'image' | 'video' | 'audio'

export function mediaKind(url?: string | null): MediaKind {
  const ext = /\.([a-z0-9]{2,4})(?:[?#]|$)/i.exec(String(url || ''))?.[1]?.toLowerCase() ?? ''
  if (/^(mp4|webm|mov|m4v)$/.test(ext)) return 'video'
  if (/^(mp3|wav|flac|ogg|m4a|aac)$/.test(ext)) return 'audio'
  return 'image'
}

interface MediaProps {
  src:       string
  alt?:      string
  title?:    string
  style?:    React.CSSProperties
  onClick?:  React.MouseEventHandler
  /** Alto fijo de la tira de audio cuando el hueco es cuadrado (thumbnails). */
  compact?:  boolean
}

/**
 * Pinta lo que sea que haya en `src`. La firma es la de un `<img>` para poder reemplazarlo en el
 * sitio sin tocar el layout de alrededor.
 */
export function Media({ src, alt = '', title, style, onClick, compact }: MediaProps) {
  const kind = mediaKind(src)

  if (kind === 'video') {
    // Los visores de imagen apagan los eventos del `<img>` para arrastrar el lienzo por debajo.
    // Un video sin eventos es un video sin controles: no se puede ni darle play.
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { pointerEvents, objectFit, ...resto } = style ?? {}
    return (
      <video
        src={src}
        title={title ?? alt}
        controls
        preload="metadata"
        // Sin `onClick` propio, el click se queda acá: el visor de imágenes cierra al clickear el
        // fondo, y darle play a un video no puede ser lo mismo que cerrarlo.
        onClick={onClick ?? (e => e.stopPropagation())}
        style={{ background: '#000', objectFit: objectFit ?? 'contain', ...resto, cursor: onClick ? 'pointer' : undefined }}
      />
    )
  }

  if (kind === 'audio') {
    // Un `<audio>` no se deja recortar como una imagen: tiene alto propio. Dentro de una
    // miniatura cuadrada se envuelve en una tarjeta que ocupa el hueco y no lo desborda.
    const player = (
      <audio
        src={src} title={title ?? alt} controls preload="metadata"
        onClick={e => e.stopPropagation()}
        style={{ width: '100%', display: 'block' }}
      />
    )
    if (!compact) return <div style={{ ...style, display: 'flex', alignItems: 'center' }}>{player}</div>
    return (
      <div
        onClick={onClick}
        style={{
          ...style,
          display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
          gap: 4, padding: 4, background: 'var(--bg-2)', boxSizing: 'border-box', overflow: 'hidden',
        }}
      >
        <span style={{ fontSize: 16, lineHeight: 1 }}>♪</span>
        <span style={{ fontSize: 8, color: 'var(--text-3)', fontFamily: 'var(--font-mono)' }}>audio</span>
      </div>
    )
  }

  // eslint-disable-next-line @next/next/no-img-element
  return <img src={src} alt={alt} title={title} onClick={onClick} style={style} />
}

export default Media
