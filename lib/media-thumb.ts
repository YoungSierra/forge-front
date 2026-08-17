// Miniaturas de video y audio, en el cliente y cacheadas en localStorage.
//
// Video: el primer fotograma con contenido. Se pide por el proxy same-origin porque dibujar un
// <video> de otro dominio en un canvas lo contamina y `toDataURL` tira SecurityError.
//
// Audio: la onda REAL cuando el archivo es chico (se decodifica y se miden picos). Por encima
// del tope se dibuja una onda estable derivada del id — no es el audio, es una marca de tipo
// que al menos no cambia entre recargas. La duración siempre es la de verdad.

const PREFIX  = 'forge_media_thumb3:'   // v3: onda densa con halo, como la referencia
const W       = 320
const H       = 180
const MAX_AUD = 6 * 1024 * 1024   // por encima de esto no se decodifica: la onda pasa a ser marca

const proxy = (url: string) => `/api/proxy-image?url=${encodeURIComponent(url)}`

// La clave lleva el color: sin eso, una miniatura pintada con el tema viejo se sirve para
// siempre y el cambio de paleta no se ve nunca. Fue justo lo que pasó con la onda blanca.
function leerCache(id: string): string | null | undefined {
  try {
    const v = localStorage.getItem(PREFIX + id)
    return v === null ? undefined : v === 'x' ? null : v
  } catch { return undefined }
}
function guardarCache(id: string, data: string | null) {
  try { localStorage.setItem(PREFIX + id, data ?? 'x') } catch { /* cuota llena o modo privado */ }
}

// ── Video ────────────────────────────────────────────────────────────────────

export async function videoThumb(url: string, id: string): Promise<string | null> {
  const hit = videoThumbCached(id)
  if (hit !== undefined) return hit

  const data = await new Promise<string | null>(resolve => {
    const v = document.createElement('video')
    v.muted = true
    v.preload = 'metadata'
    v.src = proxy(url)

    const fin = (r: string | null) => { v.src = ''; v.remove(); resolve(r) }
    const timeout = setTimeout(() => fin(null), 15000)

    v.onloadedmetadata = () => {
      // No el fotograma 0: muchos videos abren en negro. Un poco adentro casi siempre hay imagen.
      v.currentTime = Math.min(v.duration * 0.1 || 0.5, 2)
    }
    v.onseeked = () => {
      clearTimeout(timeout)
      try {
        const cv = document.createElement('canvas')
        const ratio = v.videoWidth / v.videoHeight || 16 / 9
        cv.width = W; cv.height = Math.round(W / ratio)
        cv.getContext('2d')!.drawImage(v, 0, 0, cv.width, cv.height)
        fin(cv.toDataURL('image/jpeg', 0.72))
      } catch { fin(null) }
    }
    v.onerror = () => { clearTimeout(timeout); fin(null) }
  })

  guardarCache(id, data)
  return data
}

// ── Audio ────────────────────────────────────────────────────────────────────

function pintarOnda(picos: number[], real: boolean, accent: string): string {
  const cv = document.createElement('canvas')
  // Se dibuja al doble y se muestra a la mitad: en pantallas densas el borde redondeado de una
  // barra de 4 px se ve dentado si se pinta al tamaño final.
  const esc = 2
  cv.width = W * esc; cv.height = H * esc
  const ctx = cv.getContext('2d')!
  ctx.scale(esc, esc)

  const mid   = H / 2
  const paso  = W / picos.length
  const barra = Math.max(1, paso * 0.62)   // barras finas y juntas: así se lee como onda, no
  const radio = barra / 2                  // como ecualizador. La referencia tiene ~150.

  // El pico máximo manda: un audio suave dibujado contra 1.0 sale como una línea plana.
  const tope = Math.max(...picos, 0.001)

  // Halo: es lo que separa una onda de diseño de unas rayitas. Va antes del trazo para que el
  // brillo quede por debajo y no lave las barras.
  ctx.shadowColor = hexA(accent, real ? 0.75 : 0.25)
  ctx.shadowBlur  = 7
  ctx.fillStyle   = hexA(accent, real ? 0.95 : 0.4)

  picos.forEach((p, i) => {
    // Raíz cuadrada: comprime la dinámica, así los pasajes bajos se ven en vez de desaparecer.
    const v    = Math.sqrt(Math.min(1, p / tope))
    const alto = Math.max(barra * 1.2, v * (H * 0.86))
    const x    = i * paso + (paso - barra) / 2
    ctx.beginPath()
    ctx.roundRect(x, mid - alto / 2, barra, alto, radio)
    ctx.fill()
  })

  return cv.toDataURL('image/png')
}

function hexA(hex: string, a: number): string {
  const m = hex.match(/^#([0-9a-f]{6})$/i)
  if (!m) return `rgba(232,236,242,${a})`
  const n = parseInt(m[1], 16)
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`
}

// Onda de respaldo: no es el audio, pero es SIEMPRE la misma para el mismo activo. Una aleatoria
// cambiaría en cada recarga y eso se lee como que el archivo cambió.
function ondaEstable(id: string): number[] {
  let h = 0
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0
  const out: number[] = []
  for (let i = 0; i < 150; i++) {
    h = (h * 1664525 + 1013904223) >>> 0
    const base = 0.25 + (h % 1000) / 1000 * 0.55
    out.push(base * (0.55 + 0.45 * Math.sin(i / 4)))   // un contorno de frase, no ruido plano
  }
  return out
}

export interface AudioThumb { img: string; segundos: number | null; real: boolean }

/** Cache síncrono del audio: guarda la onda Y la duración juntas. Antes la duración se pedía
 *  por red en cada montaje, incluso con la imagen ya cacheada — una ida y vuelta para un dato
 *  que no cambia nunca. */
export function audioThumbCached(id: string, accent: string): AudioThumb | null | undefined {
  const hit = leerCache(`${id}@${accent}`)
  if (hit === undefined) return undefined
  if (hit === null) return null
  try {
    const { img, seg } = JSON.parse(hit)
    return { img, segundos: seg, real: true }
  } catch { return undefined }
}

export function videoThumbCached(id: string): string | null | undefined {
  return leerCache(id)
}

export async function audioThumb(url: string, id: string, accent = '#e8ecf2'): Promise<AudioThumb> {
  const clave = `${id}@${accent}`
  const hit = audioThumbCached(id, accent)
  if (hit) return hit
  const dur = await duracion(url)
  if (hit === null) return { img: pintarOnda(ondaEstable(id), false, accent), segundos: dur, real: false }

  try {
    const head = await fetch(proxy(url), { headers: { Range: 'bytes=0-1' } })
    const total = Number((head.headers.get('content-range') || '').split('/')[1] || 0)
    if (total > MAX_AUD) throw new Error('archivo grande: no se decodifica')

    const buf = await (await fetch(proxy(url))).arrayBuffer()
    const AC = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext
    const audio = await new AC().decodeAudioData(buf)
    const ch = audio.getChannelData(0)
    const n = 150, paso = Math.floor(ch.length / n)
    const picos: number[] = []
    for (let i = 0; i < n; i++) {
      let max = 0
      for (let j = i * paso; j < (i + 1) * paso; j += 16) { const v = Math.abs(ch[j]); if (v > max) max = v }
      picos.push(max)
    }
    const img = pintarOnda(picos, true, accent)
    guardarCache(clave, JSON.stringify({ img, seg: audio.duration }))
    return { img, segundos: audio.duration, real: true }
  } catch {
    guardarCache(clave, null)
    return { img: pintarOnda(ondaEstable(id), false, accent), segundos: dur, real: false }
  }
}

// La duración sale de los metadatos, que son los primeros bytes: no baja el archivo.
function duracion(url: string): Promise<number | null> {
  return new Promise(resolve => {
    const a = document.createElement('audio')
    a.preload = 'metadata'
    a.src = proxy(url)
    const t = setTimeout(() => resolve(null), 8000)
    a.onloadedmetadata = () => { clearTimeout(t); resolve(isFinite(a.duration) ? a.duration : null) }
    a.onerror = () => { clearTimeout(t); resolve(null) }
  })
}

export const mmss = (s: number | null) =>
  s == null ? '' : `${Math.floor(s / 60)}:${String(Math.round(s % 60)).padStart(2, '0')}`
