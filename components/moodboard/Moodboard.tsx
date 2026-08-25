'use client'

// Moodboard — visualizador de todo el contenido visual de un proyecto.
//
// Se lanza con (projectId) o con (projectId, nodeKey). Sin nodo muestra todo el proyecto;
// con nodo abre filtrado a lo que ESE nodo produjo, y el filtro se puede quitar desde la barra.
//
// Solo entra contenido visual: imagen, 3D, video y audio. Markdown y documentos viven en la
// librería de activos, no acá — el endpoint los excluye con `media=1`.
//
// Iteración 1: grid, filtros, transición y detalle. El menú radial (clic derecho) y las
// herramientas de edición son Iteración 2 y 3.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import Image from 'next/image'
import ModelViewer from '@/components/shared/ModelViewer'
import { glbThumb, glbThumbCached, type Rampa } from '@/lib/glb-thumb'
import { videoThumb, videoThumbCached, audioThumb, audioThumbCached, mmss, type AudioThumb } from '@/lib/media-thumb'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { MD_COMPONENTS } from '@/lib/md-components'
import { getProjectMedia, getAssetContent, uploadLibraryAsset, NEUTRAL_THEME, type MoodboardTheme, type UnifiedAsset, iterateAssetPage, approveAssetVersion, designEditAsset, getAssetNotes, saveAssetNote, type AssetNote } from '@/lib/api'

// ── Pestañas ─────────────────────────────────────────────────────────────────
// El juego es el de la referencia. Las que no tienen activos se muestran apagadas en vez de
// esconderse: la barra no cambia de forma entre proyectos y se ve qué tipos faltan por producir.
// Orden pedido por el equipo (24-ago): Refs, Docs, Concept Art, 3D, Audio, Video — de lo que se
// consulta a lo que se produce.
const TABS: { key: string; label: string; formats: string[] }[] = [
  { key: 'refs',    label: 'Refs',        formats: [] },   // ver ARTE: se decide por nodo, no por formato
  { key: 'docs',    label: 'Docs',        formats: ['document', 'docx', 'pdf', 'pptx', 'md', 'markdown'] },
  { key: 'concept', label: 'Concept Art', formats: ['image', 'png', 'jpg', 'jpeg'] },
  { key: '3d',      label: '3D',          formats: ['model_3d', 'glb'] },
  { key: 'audio',   label: 'Audio',       formats: ['audio'] },
  { key: 'video',   label: 'Video',       formats: ['video', 'mp4'] },
]

// Los nodos cuyas imágenes son ARTE. Todo lo demás que sea imagen es material de referencia y
// va a `Ref`: las del 1.1 ilustran una semilla de concepto y las del 2.4 orientan, no son la
// obra. La DNA no tiene un campo de disciplina, así que la lista es explícita a propósito —
// cuando aparezca un nodo de arte nuevo hay que sumarlo acá.
//
// La partición es SOLO entre imágenes. Un GLB o un audio subidos siguen contando por su tipo,
// que es lo que evitó el problema viejo de que un modelo subido fuera 3D y Ref a la vez y
// desapareciera de la pestaña 3D.
const ARTE = new Set(['3.9', '3.20'])
const ES_IMAGEN = ['image', 'png', 'jpg', 'jpeg']

// ── Qué se puede iterar hoy ──────────────────────────────────────────────────
// MVP: solo las páginas del Art Style Guide. Son las únicas donde la iteración tiene un destino
// claro — el 3.20 despacha su deck por página, así que rehacer UNA no toca a las demás.
// Se pide que sea imagen del 3.20 Y que su nombre traiga el número de página; sin ese número no
// hay forma de decirle al workflow cuál rehacer.
const ITERABLE_NODO = '3.20'
function paginaASG(a: UnifiedAsset): { n: number; nombre: string } | null {
  if (a.node_key !== ITERABLE_NODO) return null
  if (!ES_IMAGEN.includes(String(a.format).toLowerCase())) return null
  const out = outputOf(a) ?? ''
  const m = /^(\d{1,3})[_\s.-]?(.*)$/.exec(out)
  return m ? { n: Number(m[1]), nombre: out } : null
}

// ── Fases ────────────────────────────────────────────────────────────────────
// El tercer eje. No es un filtro más: es DÓNDE ESTÁS PARADO mirando, y caminar cambia lo que se
// ve. El backend ya mandaba `phase` en cada activo desde el principio; acá se agrupa en las
// cuatro etapas con las que trabaja el estudio.
// Fecha y hora de una versión, corta pero sin ambigüedad: «20 Aug, 14:32». El día solo no sirve
// cuando se itera varias veces en una tarde, que es el caso normal.
const fechaLarga = (iso?: string | null) => {
  if (!iso) return ''
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  const dia = d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })
  const hora = d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })
  const esteAno = d.getFullYear() === new Date().getFullYear()
  return `${dia}${esteAno ? '' : ' ' + d.getFullYear()}, ${hora}`
}

// Las páginas raíz del espacio de trabajo. Son TRES, no cuatro: Post-Producción no existe todavía
// como etapa con nodos, y una página vacía permanente solo estorba (equipo, 24-ago). Estas páginas
// son la única paginación: la numérica de abajo desapareció con el lienzo.
const FASES: { key: string; label: string; phases: string[] }[] = [
  { key: 'doc',  label: 'Documentation',  phases: ['ideation', 'concept'] },
  { key: 'pre',  label: 'Pre-Production', phases: ['pre-production'] },
  { key: 'prod', label: 'Production',     phases: ['production', 'live-ops'] },
]

// null = el activo no pertenece a una fase. Lo que sube el usuario y lo legacy caen acá, y esa
// es la regla: una referencia pertenece a su TIPO, no a un momento. Un PDF vive en Docs y se ve
// camines a donde camines; tampoco cuenta para calcular hasta dónde llegó el proyecto.
const faseDe = (a: UnifiedAsset) =>
  FASES.find(f => f.phases.includes(String((a as { phase?: string | null }).phase ?? '')))?.key ?? null

// El asset se guarda como "<título del nodo> — <label del output>", así que el output es lo
// que va después del guion largo. Para un documento es el dato que lo identifica: dos ADI
// distintos comparten nodo y solo se diferencian por ahí.
const outputOf = (a: UnifiedAsset) => {
  const parts = String(a.name || '').split('—')
  return parts.length > 1 ? parts[parts.length - 1].trim() : null
}

// Qué pestaña. Por tipo, salvo las imágenes: esas se parten en dos según de dónde salieron —
// las de un nodo de arte son Concept Art y el resto es referencia. La procedencia SIGUE siendo
// el otro eje (de qué nodo vino), y este corte no la reemplaza: una imagen del 1.1 se ve en
// `Ref` y en el origen `1.1` a la vez.
const tabOf = (a: UnifiedAsset) => {
  const f = String(a.format).toLowerCase()
  if (ES_IMAGEN.includes(f)) return a.node_key && ARTE.has(a.node_key) ? 'concept' : 'refs'
  return TABS.find(t => t.formats.includes(f))?.key ?? 'concept'
}

// Cómo se dibuja el activo. Siempre por formato real, nunca por pestaña: una imagen subida
// vive en Refs pero se sigue viendo como imagen.
const kindOf = (a: UnifiedAsset): 'image' | 'video' | 'audio' | '3d' | 'doc' => {
  const f = String(a.format).toLowerCase()
  if (['image', 'png', 'jpg', 'jpeg'].includes(f)) return 'image'
  if (['video', 'mp4'].includes(f))                return 'video'
  if (f === 'audio')                               return 'audio'
  if (['model_3d', 'glb'].includes(f))             return '3d'
  return 'doc'
}

// De dónde viene, para el pie de la tarjeta.
const originOf = (a: UnifiedAsset) =>
  a.node_key ? `${a.node_key} ${a.node_title ?? ''}`.trim() : (a.node_title || 'Library')

// El nombre visible de una hoja. Las 34 páginas de un deck se llaman todas «Art Style Guide —
// 01_KeyArt», así que pintar el nodo dejaba las 34 tarjetas con la MISMA etiqueta y el número de
// nodo por delante. El nombre propio ya está guardado, después del guion: se usa ese, legible y
// sin la clave técnica, que a quien mira el moodboard no le dice nada.
//
//   «Art Style Guide — 01_KeyArt»  ->  «01 · Key Art»
//   «Concept Development — Output» ->  «Output»
const nombreDeHoja = (a: UnifiedAsset) => {
  const crudo = String(a.name || '')
  const partes = crudo.split(/\s+[—–-]\s+/)
  const cola = partes.length > 1 ? partes[partes.length - 1] : crudo
  const m = cola.match(/^(\d{1,2})[_\s-]+(.+)$/)
  const cuerpo = (m ? m[2] : cola)
    .replace(/[_-]+/g, ' ')
    .replace(/([a-z\d])([A-Z])/g, '$1 $2')   // KeyArt -> Key Art
    .replace(/\s+/g, ' ')
    .trim()
  return m ? `${m[1]} · ${cuerpo}` : cuerpo
}

const COLS = 4   // como la referencia
const ROWS = 3   // 4 x 3 = 12 en pantalla, sin scroll vertical

// Tamaño de una hoja en el lienzo y separación de la cuadrícula inicial. En coordenadas del
// lienzo, no de pantalla: el zoom las escala.
const HOJA_W = 300
const HOJA_H = 225
const HOJA_GAP = 26

// Bajar el activo a la máquina del usuario. Pasa por el proxy del servidor: el bucket es otro
// origen y un <a download> directo termina abriendo el archivo en vez de bajarlo.
async function bajarActivo(asset: UnifiedAsset) {
  if (!asset.storage_url) return
  try {
    const res  = await fetch(`/api/proxy-image?url=${encodeURIComponent(asset.storage_url)}`)
    const blob = await res.blob()
    const href = URL.createObjectURL(blob)
    const a    = document.createElement('a')
    const ext  = asset.storage_url.match(/\.[a-z0-9]{2,5}(?=$|\?)/i)?.[0] ?? ''
    a.href = href
    a.download = (outputOf(asset) ?? asset.name).replace(/[^\w.\- ]+/g, '_') + ext
    document.body.appendChild(a); a.click(); a.remove()
    URL.revokeObjectURL(href)
  } catch (e) { console.error('[moodboard] descarga', e) }
}

function BarraBtn({ children, titulo, activo, onClick }: {
  children: React.ReactNode; titulo: string; activo?: boolean
  onClick: (e: React.MouseEvent) => void
}) {
  const [hot, setHot] = useState(false)
  return (
    <button
      onClick={e => { e.stopPropagation(); onClick(e) }}
      onMouseEnter={() => setHot(true)} onMouseLeave={() => setHot(false)}
      title={titulo}
      style={{
        width: 28, height: 28, borderRadius: 7, cursor: 'pointer', border: 'none',
        background: hot ? 'rgba(255,255,255,0.10)' : 'transparent',
        color: activo ? 'var(--action)' : 'rgba(255,255,255,0.82)',
        fontSize: 13, lineHeight: 1, display: 'flex', alignItems: 'center', justifyContent: 'center',
      }}
    >{children}</button>
  )
}

interface Props {
  projectId:    string
  projectName?: string
  nodeKey?:     string | null
  /** Desde dónde nace la animación de apertura — la posición del botón que la lanzó. */
  origin?:      { x: number; y: number }
  onClose:      () => void
}

export default function Moodboard({ projectId, projectName, nodeKey, origin, onClose }: Props) {
  const [assets,  setAssets]  = useState<UnifiedAsset[]>([])
  // La identidad visual sale del proyecto si el 3.9 ya produjo su paleta; si no, neutro.
  // Un juego de autos no debería abrirse con el turquesa de uno submarino.
  const [theme,   setTheme]   = useState<MoodboardTheme>(NEUTRAL_THEME)
  const [loading, setLoading] = useState(true)
  const [error,   setError]   = useState<string | null>(null)
  const [tab,     setTab]     = useState('all')
  // Origen: 'all' · una clave de nodo · 'library' (lo que subió el usuario al proyecto).
  const [node,    setNode]    = useState<string>(nodeKey ?? 'all')
  const [page,    setPage]    = useState(0)
  // Encuadre del lienzo: escala y desplazamiento. Uno por etapa — cada página raíz conserva dónde
  // la dejaste, porque volver a una etapa y encontrarla movida se siente como perder el trabajo.
  const [vistas, setVistas] = useState<Record<string, { z: number; x: number; y: number }>>({})
  // Dónde puso el usuario cada hoja, por etapa. Vive en el navegador hasta que el equipo decida
  // si el orden del lienzo es del proyecto (compartido) o de cada quien; la estructura ya está
  // lista para mudarla al servidor sin tocar el resto.
  const [posiciones, setPosiciones] = useState<Record<string, { x: number; y: number }>>({})
  // Notas por elemento, en la BD y del proyecto: se pidieron para dejar indicaciones, y una
  // indicación que solo ve quien la escribió no es una indicación. Las posiciones siguen en el
  // navegador — eso es encuadre personal, no contenido.
  const [notando, setNotando] = useState<UnifiedAsset | null>(null)
  const [maximizado, setMaximizado] = useState(false)
  useEffect(() => { setMaximizado(localStorage.getItem('forge:mb:max') === '1') }, [])
  const [sel,     setSel]     = useState<string | null>(null)
  // Al abrir se guarda el rectángulo de la tarjeta: la imagen crece DESDE ahí, no aparece
  // centrada de golpe. Es el 'fluye al frente' de la referencia.
  const [detail,  setDetail]  = useState<{ asset: UnifiedAsset; from: DOMRect } | null>(null)
  // La entrada se dispara un frame después de montar para que la transición CSS ocurra.
  const [entered, setEntered] = useState(false)
  const [uploading, setUploading] = useState(0)  // cuántos archivos están subiendo
  const [dropping,  setDropping]  = useState(false)
  // Menú de clic derecho. Hoy solo lo usan los documentos, con Descargar; para las imágenes
  // este es el gancho donde entra el menú radial en la Iteración 2.
  const [menu, setMenu] = useState<{ x: number; y: number; asset: UnifiedAsset } | null>(null)
  // La iteracion vive ACA y no en el radial: el menu se cierra al elegir, y el modal tiene que
  // sobrevivirlo. `aviso` es el caso de lo que todavia no se puede iterar.
  // `pagina` solo existe cuando se rehace una hoja de un deck; en Design Edits va `pedido`.
  const [iterando, setIterando] = useState<{ asset: UnifiedAsset; pagina: { n: number; nombre: string } | null; pedido?: string } | null>(null)
  const [editando, setEditando] = useState<UnifiedAsset | null>(null)
  const [aviso,    setAviso]    = useState<string | null>(null)

  useEffect(() => {
    if (!menu) return
    const onClick = (e: MouseEvent) => {
      // Un clic dentro del menú es para el menú; el de afuera solo lo cierra y se detiene ahí.
      if ((e.target as Element)?.closest?.('[data-mb-menu]')) return
      e.stopPropagation()
      setMenu(null)
    }
    const onScroll = () => setMenu(null)
    window.addEventListener('click', onClick, true)
    window.addEventListener('scroll', onScroll, true)
    return () => {
      window.removeEventListener('click', onClick, true)
      window.removeEventListener('scroll', onScroll, true)
    }
  }, [menu])
  const [cols,    setCols]    = useState(COLS)
  const [query,   setQuery]   = useState('')
  const [view,    setView]    = useState<'grid' | 'table'>('grid')
  // En la tabla el orden lo elige el usuario; en la grilla manda la agrupación por tipo.
  const [sort,    setSort]    = useState<{ by: 'name' | 'type' | 'origin' | 'date'; dir: 1 | -1 }>({ by: 'date', dir: -1 })

  // Cuatro por fila, pero en pantallas angostas caben menos sin que la tarjeta se rompa.
  useEffect(() => {
    const fit = () => setCols(window.innerWidth < 760 ? 1 : window.innerWidth < 1080 ? 2 : window.innerWidth < 1400 ? 3 : COLS)
    fit()
    window.addEventListener('resize', fit)
    return () => window.removeEventListener('resize', fit)
  }, [])

  useEffect(() => { const t = requestAnimationFrame(() => setEntered(true)); return () => cancelAnimationFrame(t) }, [])

  const reload = useCallback(() =>
    getProjectMedia(projectId)
      .then(r => { setAssets(r.assets); setTheme(r.theme); setError(null) })
      .catch(e => setError(e.message)), [projectId])

  useEffect(() => {
    let alive = true
    setLoading(true)
    reload().finally(() => { if (alive) setLoading(false) })
    return () => { alive = false }
  }, [reload])

  // Los archivos van a la librería DEL PROYECTO, no a un nodo. Cualquier nodo puede
  // referenciarlos después conectándolos en el canvas.
  const upload = useCallback(async (files: FileList | File[]) => {
    const list = Array.from(files)
    if (!list.length) return
    setUploading(u => u + list.length)
    try {
      await Promise.all(list.map(f => uploadLibraryAsset(projectId, f)))
      await reload()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Upload failed')
    } finally {
      setUploading(0)
    }
  }, [projectId, reload])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') detail ? setDetail(null) : onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose, detail])

  // ── Fases ──────────────────────────────────────────────────────────────────
  // Hasta dónde llegó el proyecto: la fase más avanzada que YA produjo algo. Las referencias no
  // cuentan — subir un PDF no te hace avanzar de etapa.
  const alcanzada = useMemo(() => {
    let max = 0
    assets.forEach(a => {
      const i = FASES.findIndex(f => f.key === faseDe(a))
      if (i > max) max = i
    })
    return max
  }, [assets])

  // Se entra parado donde llegó el proyecto. Solo se re-sincroniza cuando cambia el alcance,
  // para no arrastrar al usuario de vuelta si eligió mirar una fase anterior.
  const [faseIdx, setFaseIdx] = useState(0)
  useEffect(() => { setFaseIdx(alcanzada) }, [alcanzada])
  const fase = FASES[faseIdx]
  // La posición de una hoja: la que el usuario le dio, o su lugar en la cuadrícula inicial.
  const claveMB = `forge:mb:pos:${projectId}`
  useEffect(() => {
    try { setPosiciones(JSON.parse(localStorage.getItem(claveMB) || '{}')) } catch { setPosiciones({}) }
  }, [claveMB])

  // Las notas del proyecto, TODAS las de cada hoja: una por persona. Aplanarlas a una sola por
  // activo hacía que ganara la última en llegar, y abrir el modal te ponía a editar el texto de
  // otro para guardarlo como tuyo. Cada quien edita la suya; las demás se leen.
  const [notasPorHoja, setNotasPorHoja] = useState<Record<string, AssetNote[]>>({})
  const miMiembro = typeof window !== 'undefined' ? localStorage.getItem('forge_member_id') : null

  const cargarNotas = useCallback(() => {
    getAssetNotes(projectId)
      .then(ns => {
        const m: Record<string, AssetNote[]> = {}
        for (const n of ns) (m[n.asset_id] ??= []).push(n)
        setNotasPorHoja(m)
      })
      .catch(e => console.error('[moodboard] notas', e))
  }, [projectId])
  useEffect(() => { cargarNotas() }, [cargarNotas])

  const miNota = useCallback(
    (id: string) => (notasPorHoja[id] ?? []).find(n => (n.member_id ?? null) === miMiembro)?.body ?? '',
    [notasPorHoja, miMiembro],
  )
  const otrasNotas = useCallback(
    (id: string) => (notasPorHoja[id] ?? []).filter(n => (n.member_id ?? null) !== miMiembro),
    [notasPorHoja, miMiembro],
  )

  const guardarNota = useCallback((id: string, texto: string) => {
    // Optimista sobre MI nota: esperar a la red para ver el ícono marcado se siente roto.
    setNotasPorHoja(m => {
      const lista = (m[id] ?? []).filter(n => (n.member_id ?? null) !== miMiembro)
      if (texto.trim()) {
        lista.push({ id: 'local', asset_id: id, member_id: miMiembro, body: texto.trim(), updated_at: new Date().toISOString(), author: null })
      }
      return { ...m, [id]: lista }
    })
    saveAssetNote(projectId, id, texto, miMiembro)
      .then(cargarNotas)   // relee: así aparece el autor y el id reales
      .catch(e => console.error('[moodboard] guardar nota', e))
  }, [projectId, miMiembro, cargarNotas])

  // ── Zonas por documento ─────────────────────────────────────────────────────
  // El lienzo no arranca como una grilla única: arranca como el trabajo está organizado — un
  // bloque por documento (Art Style Guide, GDD Art Style, Art Bible, Refs), sus hojas en
  // cuadrícula adentro, y los bloques separados entre sí. Al encuadrar se ve la ESTRUCTURA —
  // cuántos documentos hay y qué tamaño tiene cada uno—, que es lo que una galería no dice.
  const zonaDe = (a: UnifiedAsset) => a.node_title || (a.source === 'library' ? 'Refs' : 'Other')

  // Las zonas se calculan sobre TODA la etapa, no sobre lo filtrado: si se armaran con el filtro
  // puesto, cada vez que cambiaras de pestaña las hojas saltarían de sitio.
  const deLaFase = useMemo(
    () => assets.filter(a => { const f = faseDe(a); return f === null || f === fase.key }),
    [assets, fase.key],
  )

  const disposicion = useMemo(() => {
    const grupos = new Map<string, UnifiedAsset[]>()
    for (const a of deLaFase) {
      const z = zonaDe(a)
      if (!grupos.has(z)) grupos.set(z, [])
      grupos.get(z)!.push(a)
    }
    const SEP = 90            // aire entre zonas
    const TITULO = 46         // alto reservado para el nombre de la zona
    const pos = new Map<string, { x: number; y: number }>()
    const zonas: { nombre: string; x: number; y: number; w: number; h: number }[] = []
    let cursorX = 0
    for (const [nombre, items] of grupos) {
      // Bloque lo más cuadrado posible: una fila de 30 hojas no se lee, una columna tampoco.
      const cols = Math.max(1, Math.min(6, Math.ceil(Math.sqrt(items.length))))
      items.forEach((a, i) => {
        pos.set(a.id, {
          x: cursorX + (i % cols) * (HOJA_W + HOJA_GAP),
          y: TITULO + Math.floor(i / cols) * (HOJA_H + HOJA_GAP),
        })
      })
      const filas = Math.ceil(items.length / cols)
      const w = cols * HOJA_W + (cols - 1) * HOJA_GAP
      const h = filas * HOJA_H + (filas - 1) * HOJA_GAP
      zonas.push({ nombre, x: cursorX, y: 0, w, h: h + TITULO })
      cursorX += w + SEP
    }
    return { pos, zonas }
  }, [deLaFase])

  const posicionDe = useCallback((id: string, i: number) => {
    const guardada = posiciones[`${fase.key}:${id}`]
    if (guardada) return guardada
    return disposicion.pos.get(id) ?? {
      x: (i % COLS) * (HOJA_W + HOJA_GAP),
      y: Math.floor(i / COLS) * (HOJA_H + HOJA_GAP),
    }
  }, [posiciones, fase.key, disposicion])

  const moverElemento = useCallback((id: string, p: { x: number; y: number }) => {
    setPosiciones(m => {
      const n = { ...m, [`${fase.key}:${id}`]: p }
      try { localStorage.setItem(claveMB, JSON.stringify(n)) } catch { /* modo privado */ }
      return n
    })
  }, [fase.key, claveMB])

  // Un arrastre no debe terminar abriendo la tarjeta que acabás de soltar.
  const arrastrado = useRef(false)
  // La caja del lienzo en pantalla, para poder encuadrar contra su tamaño real.
  const lienzoRef = useRef<HTMLDivElement | null>(null)

  // El encuadre de la etapa que se está mirando. `setVista` escribe solo el de esta página.
  const vista = vistas[fase.key] ?? { z: 1, x: 0, y: 0 }
  const setVista = useCallback(
    (f: (v: { z: number; x: number; y: number }) => { z: number; x: number; y: number }) =>
      setVistas(m => ({ ...m, [fase.key]: f(m[fase.key] ?? { z: 1, x: 0, y: 0 }) })),
    [fase.key],
  )

  // ── Encuadrar ───────────────────────────────────────────────────────────────
  // Todo el contenido de la etapa, centrado y entero. Es también el estado inicial: abrir el
  // lienzo al 100 % lo deja pareciendo la galería de antes —cuatro tarjetas grandes y el resto
  // fuera de pantalla—, cuando lo que uno necesita al entrar es ver de qué tamaño es el trabajo.
  const encuadrar = useCallback((items: UnifiedAsset[]) => {
    const caja = lienzoRef.current?.getBoundingClientRect()
    if (!caja || !items.length) return
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity
    items.forEach((a, i) => {
      const p = posicionDe(a.id, i)
      x0 = Math.min(x0, p.x); y0 = Math.min(y0, p.y)
      x1 = Math.max(x1, p.x + HOJA_W); y1 = Math.max(y1, p.y + HOJA_H)
    })
    const M = 48
    const z = Math.min(1, Math.max(0.08,
      Math.min((caja.width - M * 2) / (x1 - x0), (caja.height - M * 2) / (y1 - y0))))
    setVista(() => ({
      z,
      x: (caja.width  - (x1 - x0) * z) / 2 - x0 * z,
      y: (caja.height - (y1 - y0) * z) / 2 - y0 * z,
    }))
  }, [posicionDe, setVista])

  useEffect(() => { setPage(0) }, [tab, node, cols, query, view, faseIdx])

  // Cuánto subió el usuario al proyecto: es el contador del chip de Refs.
  const refCount = useMemo(() => assets.filter(a => a.source === 'library').length, [assets])

  // Nodos presentes, ordenados por clave (3.2 antes que 3.13, no alfabético)
  // Las fuentes, agrupadas por ETAPA. El selector plano listaba 3.0…3.13 seguidos y no decía a
  // qué momento de la producción pertenece cada uno; agrupado, encontrar la hoja que buscas es
  // mirar la etapa y no recorrer la lista. Una fuente puede aportar a más de una etapa: aparece
  // en cada una, porque el usuario la busca donde la está viendo.
  const fuentesPorFase = useMemo(() => {
    const m = new Map<string, Map<string, string>>()
    for (const a of assets) {
      if (!a.node_key) continue
      const f = faseDe(a) ?? '__sin'
      if (!m.has(f)) m.set(f, new Map())
      m.get(f)!.set(a.node_key, a.node_title || a.node_key)
    }
    const ver = (k: string) => k.split('.').map(Number)
    const orden = (e: [string, string][]) => e.sort((a, b) =>
      (ver(a[0])[0] - ver(b[0])[0]) || ((ver(a[0])[1] ?? 0) - (ver(b[0])[1] ?? 0)))
    return FASES
      .map(f => ({ fase: f, items: orden([...(m.get(f.key) ?? new Map()).entries()]) }))
      .filter(g => g.items.length)
  }, [assets])

  const nodes = useMemo(() => {
    const m = new Map<string, string>()
    assets.forEach(a => { if (a.node_key) m.set(a.node_key, a.node_title || a.node_key) })
    const ver = (k: string) => k.split('.').map(Number)
    return [...m.entries()].sort((a, b) =>
      (ver(a[0])[0] - ver(b[0])[0]) || ((ver(a[0])[1] ?? 0) - (ver(b[0])[1] ?? 0)))
  }, [assets])

  // Lo que el filtro de origen deja ver. Origen y tipo son ejes distintos: acá se filtra por
  // de dónde viene el activo (un nodo, o la librería del proyecto), y las pestañas de arriba
  // filtran por qué es. Así un GLB subido cuenta en `3D` y en `Library` a la vez.
  const shownSet = useMemo(() => {
    const q = query.trim().toLowerCase()
    return assets.filter(a => {
      // La fase manda sobre lo que se ve, PERO las referencias la ignoran: pertenecen a su tipo
      // y están disponibles desde cualquier etapa a la que camines.
      const f = faseDe(a)
      if (f !== null && f !== fase.key) return false

      const okOrigin = node === 'all'     ? true
                     : node === 'library' ? a.source === 'library'
                     :                      a.node_key === node
      if (!okOrigin) return false
      if (!q) return true
      // Se busca por lo que el usuario ve: nombre, output, y el nodo con su título.
      return [a.name, outputOf(a), a.node_key, a.node_title]
        .filter(Boolean).join(' ').toLowerCase().includes(q)
    })
  }, [assets, node, query, fase.key])

  const counts = useMemo(() => {
    const c: Record<string, number> = { all: shownSet.length }
    shownSet.forEach(a => { const k = tabOf(a); c[k] = (c[k] || 0) + 1 })
    return c
  }, [shownSet])

  // En `All` la grilla se agrupa por tipo siguiendo el orden de las pestañas —Concept Art,
  // 3D, Audio, Video, Docs— y dentro de cada grupo, lo más nuevo primero. Mezclado por fecha,
  // la vista general no se podía leer. Lo subido por el usuario cierra cada grupo: lo que
  // produjo el pipeline es lo que se viene a mirar.
  const rankOf = (a: UnifiedAsset) => {
    const i = TABS.findIndex(t => t.key === tabOf(a))
    return (i === -1 ? TABS.length : i) * 2 + (a.source === 'library' ? 1 : 0)
  }

  // Un deck trae su número de página en el nombre: «Art Style Guide — 09_ColorSystem». Dentro
  // de un mismo output eso es un ORDEN, no una fecha — las 34 páginas se rinden en el mismo
  // minuto y ordenadas por fecha llegan barajadas, que es ilegible para una guía de estilo.
  const grupoDe  = (a: UnifiedAsset) => `${a.node_key ?? ''}|${String(a.name || '').split('—')[0].trim()}`
  const paginaDe = (a: UnifiedAsset) => {
    // El número puede venir al principio («09_ColorSystem») o precedido por el resto del
    // rótulo del output («Content 09_ColorSystem»), según cómo se nombró el asset. Se busca el
    // patrón NN_ en cualquier posición antes que exigirlo al inicio.
    const t = outputOf(a) ?? ''
    const m = /(?:^|\s)(\d{1,3})[_\s.-]\S/.exec(t)
    return m ? Number(m[1]) : null
  }
  // El grupo se ubica por su página más reciente, y adentro manda el número. Así un deck viejo
  // no se cuela entre los activos nuevos, y sigue siendo un orden total.
  const fechaGrupo = useMemo(() => {
    const m = new Map<string, number>()
    assets.forEach(a => {
      const g = grupoDe(a), t = new Date(a.created_at).getTime()
      if (!m.has(g) || t > (m.get(g) as number)) m.set(g, t)
    })
    return m
  }, [assets])

  const porFechaYPagina = (a: UnifiedAsset, b: UnifiedAsset) => {
    const ga = grupoDe(a), gb = grupoDe(b)
    if (ga !== gb) return (fechaGrupo.get(gb) ?? 0) - (fechaGrupo.get(ga) ?? 0)
    const pa = paginaDe(a), pb = paginaDe(b)
    if (pa != null && pb != null) return pa - pb
    return new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
  }

  const filtered = useMemo(() => {
    const base = tab === 'all' ? shownSet : shownSet.filter(a => tabOf(a) === tab)

    if (view === 'table') {
      const key = (a: UnifiedAsset) =>
        sort.by === 'name'   ? (outputOf(a) ?? a.name).toLowerCase()
      : sort.by === 'type'   ? kindOf(a)
      : sort.by === 'origin' ? originOf(a).toLowerCase()
      :                        new Date(a.created_at).getTime()
      return [...base].sort((a, b) => {
        const ka = key(a), kb = key(b)
        return (ka < kb ? -1 : ka > kb ? 1 : 0) * sort.dir
      })
    }

    if (tab !== 'all') return [...base].sort(porFechaYPagina)
    return [...base].sort((a, b) => rankOf(a) - rankOf(b) || porFechaYPagina(a, b))
  }, [shownSet, tab, view, sort, fechaGrupo])

  // La página es exactamente lo que entra en pantalla: 3 filas de `cols`. Así nunca hay que
  // scrollear dentro de una página — se pasa a la siguiente.
  // El lienzo muestra TODO lo de la etapa: paginar un lienzo infinito no tiene sentido, y las
  // páginas del espacio de trabajo son las tres etapas. La tabla sí sigue paginada, que ahí la
  // lista crece hacia abajo.
  const perPage = 14
  const pages   = view === 'table' ? Math.max(1, Math.ceil(filtered.length / perPage)) : 1
  const visible = view === 'table' ? filtered.slice(page * perPage, (page + 1) * perPage) : filtered

  // Al entrar a una etapa que todavía no tiene encuadre propio, se encuadra sola: todo el
  // contenido, centrado. Una sola vez por etapa — después el encuadre es del usuario.
  const yaEncuadrada = useRef<Record<string, boolean>>({})
  useEffect(() => {
    if (view !== 'grid' || loading || yaEncuadrada.current[fase.key] || !visible.length) return
    // Se marca DESPUÉS de encuadrar, no antes: en el primer intento el lienzo todavía no está
    // medido, `encuadrar` no hace nada, y marcarlo ahí dejaba la etapa en 100 % para siempre.
    // Un frame de espera basta para que el contenedor tenga tamaño.
    const t = requestAnimationFrame(() => {
      if (!lienzoRef.current) return
      encuadrar(visible)
      yaEncuadrada.current[fase.key] = true
    })
    return () => cancelAnimationFrame(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fase.key, view, loading, visible.length])

  // ── Rueda del mouse = ZOOM del lienzo ───────────────────────────────────────
  // Con el lienzo infinito la rueda deja de pasar páginas —las páginas son las tres etapas, y se
  // cambian con las marcas laterales— y pasa a acercar y alejar, que es lo que hace en cualquier
  // lienzo. El zoom es hacia el puntero: acercarse al centro de la pantalla obliga a re-encuadrar
  // a mano cada vez.
  const onRueda = useCallback((e: React.WheelEvent) => {
    const caja = (e.currentTarget as HTMLElement).getBoundingClientRect()
    const px = e.clientX - caja.left
    const py = e.clientY - caja.top
    setVista(v => {
      const factor = Math.exp(-e.deltaY * 0.0015)
      const z = Math.min(4, Math.max(0.08, v.z * factor))
      const k = z / v.z
      // El punto bajo el cursor no se mueve: se corrige el desplazamiento por el cambio de escala.
      return { z, x: px - (px - v.x) * k, y: py - (py - v.y) * k }
    })
    // `setVista` en las dependencias, no `[]`: escribe en la etapa ACTIVA, y con la lista vacía
    // este manejador se quedaba con la del primer render — girabas la rueda en Pre-Producción y
    // el zoom se guardaba en Documentación, así que en pantalla no pasaba nada.
  }, [setVista])

  // La animación nace en el botón: el panel escala desde ese punto en vez de aparecer centrado.
  const ox = origin ? `${origin.x}px` : '100%'
  const oy = origin ? `${origin.y}px` : '100%'

  return (
    // El fondo no cierra el moodboard: es un espacio de trabajo, no un aviso. Se sale por la X.
    <div
      style={{
        // El moodboard tapa la pantalla entera: nada del canvas puede quedar flotando encima.
        // El botón del gate (9000) y el modal de outputs (10001) se colaban sobre las imágenes.
        // Sigue por debajo del chat de nodo (30000) y del panel de render (16000).
        position: 'fixed', inset: 0, zIndex: 12000,
        background: entered ? 'rgba(6,7,9,0.74)' : 'rgba(6,7,9,0)',
        backdropFilter: entered ? 'blur(7px)' : 'blur(0px)',
        transition: 'background 380ms ease, backdrop-filter 380ms ease',
        display: 'flex', alignItems: 'center', justifyContent: 'center', padding: maximizado ? 0 : 22,
      }}
    >
      <style>{KEYFRAMES}</style>

      {/* Onda que se expande desde el botón al abrir */}
      {origin && (
        <div style={{
          position: 'fixed', left: origin.x, top: origin.y, width: 10, height: 10,
          marginLeft: -5, marginTop: -5, borderRadius: '50%', pointerEvents: 'none',
          border: `1px solid ${theme.accent}`,
          animation: 'mb-ripple 900ms cubic-bezier(0.22,1,0.36,1) forwards',
        }} />
      )}

      <div
        onDragOver={e => { e.preventDefault(); setDropping(true) }}
        onDragLeave={e => { if (e.currentTarget === e.target) setDropping(false) }}
        onDrop={e => { e.preventDefault(); setDropping(false); upload(e.dataTransfer.files) }}
        style={{
        width: '100%', height: '100%', maxWidth: maximizado ? 'none' : 1720,
        background: 'linear-gradient(160deg, rgba(30,33,42,0.96) 0%, rgba(16,18,24,0.98) 55%, rgba(12,14,19,0.99) 100%)',
        border: maximizado ? 'none' : '1px solid rgba(255,255,255,0.10)', borderRadius: maximizado ? 0 : 16,
        display: 'flex', flexDirection: 'column', overflow: 'hidden', position: 'relative',
        boxShadow: '0 30px 90px rgba(0,0,0,0.65)',
        transformOrigin: `${ox} ${oy}`,
        transform: entered ? 'scale(1)' : 'scale(0.08)',
        opacity:   entered ? 1 : 0,
        transition: 'transform 460ms cubic-bezier(0.22,1,0.36,1), opacity 260ms ease',
        outline: dropping ? `2px dashed ${theme.accent}` : 'none',
        outlineOffset: -6,
      }}>

        {/* Resplandor turquesa desde la esquina del botón, como en la referencia */}
        <div style={{
          position: 'absolute', right: -160, bottom: -160, width: 620, height: 620,
          background: `radial-gradient(circle, ${theme.accent}22 0%, ${theme.accent}0d 42%, transparent 70%)`,
          pointerEvents: 'none',
        }} />

        {/* ── Cabecera ─────────────────────────────────────────────────── */}
        <div style={{
          display: 'flex', alignItems: 'center', gap: 14, position: 'relative',
          padding: '13px 18px', borderBottom: '1px solid var(--line)',
        }}>
          <img src="/forgy/forgyi.png" alt="" width={24} height={24} style={{ objectFit: 'contain' }} />
          <span style={{ fontSize: 14.5, fontWeight: 700, color: 'var(--text-0)' }}>Moodboard</span>
          {projectName && (
            <span style={{ fontSize: 11.5, color: 'var(--text-3)', fontFamily: 'var(--font-mono)' }}>
              {projectName}
            </span>
          )}
          <div style={{ flex: 1 }} />

          {/* Maximizar: en pantallas chicas el margen y el tope de 1720 se comen el área útil, y
              este panel es donde se mira el arte. Se recuerda entre sesiones. */}
          <button
            onClick={() => setMaximizado(v => { localStorage.setItem('forge:mb:max', v ? '0' : '1'); return !v })}
            title={maximizado ? 'Restore' : 'Maximize'}
            style={{
              width: 27, height: 27, borderRadius: 6, cursor: 'pointer', background: 'transparent',
              border: '1px solid var(--line-2)', color: 'var(--text-2)', fontSize: 12, lineHeight: 1,
            }}>{maximizado ? '❐' : '▢'}</button>

          <button onClick={onClose} style={{
            width: 27, height: 27, borderRadius: 6, cursor: 'pointer', background: 'transparent',
            border: '1px solid var(--line-2)', color: 'var(--text-2)', fontSize: 15, lineHeight: 1,
          }}>×</button>
        </div>

        {/* ── Barra de filtros ─────────────────────────────────────────── */}
        <div style={{
          display: 'flex', alignItems: 'center', gap: 6, position: 'relative',
          padding: '10px 18px', borderBottom: '1px solid var(--line)',
        }}>
          <Tab label="All" count={counts.all || 0} active={tab === 'all'} onClick={() => setTab('all')} />
          {TABS.map(t => (
            <Tab key={t.key} label={t.label} count={counts[t.key] || 0}
                 active={tab === t.key} onClick={() => setTab(t.key)} />
          ))}

          <div style={{ flex: 1 }} />

          <div style={{ position: 'relative', marginRight: 2 }}>
            <SearchIcon />
            <input
              value={query}
              onChange={e => setQuery(e.target.value)}
              placeholder="Search assets…"
              style={{
                width: 190, padding: '6px 26px 6px 28px', borderRadius: 7, fontSize: 12,
                background: 'var(--bg-2)', border: '1px solid var(--line-2)',
                color: 'var(--text-1)', outline: 'none', fontFamily: 'var(--font-sans)',
              }}
            />
            {query && (
              <button onClick={() => setQuery('')} title="Clear"
                      style={{
                        position: 'absolute', right: 6, top: '50%', transform: 'translateY(-50%)',
                        width: 16, height: 16, borderRadius: 4, cursor: 'pointer',
                        background: 'transparent', border: 'none', color: 'var(--text-3)',
                        fontSize: 13, lineHeight: 1, padding: 0,
                      }}>×</button>
            )}
          </div>

          <div style={{ display: 'flex', gap: 2, marginRight: 4 }}>
            <ViewBtn active={view === 'grid'}  onClick={() => setView('grid')}  kind="grid" />
            <ViewBtn active={view === 'table'} onClick={() => setView('table')} kind="table" />
          </div>

          {/* Lo que subió el usuario, a un clic. Se llama Library y NO Ref para no chocar con la
              pestaña `Ref`, que es otra cosa: ésta es un ORIGEN (quién lo trajo) y aquélla un
              TIPO (imagen que no salió de un nodo de arte). */}
          {refCount > 0 && (
            <button
              onClick={() => setNode(n => n === 'library' ? 'all' : 'library')}
              title="Files uploaded to this project"
              style={{
                display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer',
                padding: '6px 11px', borderRadius: 8, fontSize: 12, marginRight: 4,
                background: node === 'library' ? 'rgba(255,255,255,0.09)' : 'transparent',
                border: `1px solid ${node === 'library' ? 'var(--line-2)' : 'transparent'}`,
                color: node === 'library' ? 'var(--text-0)' : 'var(--text-2)',
                fontWeight: node === 'library' ? 600 : 500,
              }}
            >
              Library
              <span style={{ fontSize: 10, fontFamily: 'var(--font-mono)', color: 'var(--text-3)' }}>
                {refCount}
              </span>
            </button>
          )}

          <select
            value={node}
            onChange={e => setNode(e.target.value)}
            style={{
              background: 'var(--bg-2)', color: 'var(--text-1)', fontSize: 12,
              border: '1px solid var(--line-2)', borderRadius: 7, padding: '6px 10px',
              fontFamily: 'var(--font-sans)', maxWidth: 280, cursor: 'pointer',
            }}>
            <option value="all">All sources</option>
            {refCount > 0 && <option value="library">Library · uploaded</option>}
            {/* Agrupadas por etapa, y sin la clave del nodo: acá se elige un documento, no una
                pieza de la DNA. La etapa que estás mirando va primero. */}
            {[...fuentesPorFase]
              .sort((a, b) => (a.fase.key === fase.key ? -1 : 0) - (b.fase.key === fase.key ? -1 : 0))
              .map(g => (
                <optgroup key={g.fase.key} label={g.fase.label}>
                  {g.items.map(([k, title]) => <option key={k} value={k}>{title}</option>)}
                </optgroup>
              ))}
          </select>
        </div>

        {/* ── Grid ─────────────────────────────────────────────────────── */}
        <div
          onWheel={onRueda}
          style={{ flex: 1, minHeight: 0, overflow: 'hidden', padding: '18px 58px', position: 'relative' }}
        >
          {/* Marcas de agua: a la izquierda de dónde venís, a la derecha hacia dónde seguís.
              Solo la fase inmediata a cada lado — más allá no se muestra nada, porque el proyecto
              todavía no llegó ahí. La siguiente aparece apagada hasta que produzca algo. */}
          <Marca lado="izq"
                 fase={FASES[faseIdx - 1]}
                 alcanzable={faseIdx - 1 >= 0}
                 onClick={() => setFaseIdx(i => Math.max(0, i - 1))} />
          <Marca lado="der"
                 fase={FASES[faseIdx + 1]}
                 alcanzable={faseIdx + 1 <= alcanzada}
                 onClick={() => setFaseIdx(i => Math.min(alcanzada, i + 1))} />

          {loading ? (
            <LoadingWash theme={theme} cols={cols} />
          ) : error ? (
            <Empty text={`Could not load assets: ${error}`} />
          ) : visible.length === 0 ? (
            <Empty text={
              node === 'all'
                ? 'No assets yet. They show up here as soon as the nodes generate them.'
                : `Node ${node} hasn't produced any assets yet.`
            } />
          ) : view === 'table' ? (
            <AssetTable
              assets={visible} accent={theme.accent} colors={theme.colors} sort={sort} selected={sel}
              onSort={by => setSort(s => ({ by, dir: s.by === by ? (s.dir === 1 ? -1 : 1) : -1 }))}
              onOpen={(a, from) => { setSel(a.id); setDetail({ asset: a, from }) }}
              onMenu={(a, x, y) => setMenu({ x, y, asset: a })}
            />
          ) : (
            // ── Lienzo ────────────────────────────────────────────────────────
            // Una sola capa transformada: mover y escalar el lienzo es mover y escalar ESTE div,
            // no cada elemento. Los elementos van en posición absoluta dentro de ella, así que
            // conservan su sitio al alejarse o acercarse.
            //
            // Arrancan en cuadrícula —es lo que pidió el equipo, y sin una posición inicial
            // ordenada un lienzo vacío no se puede leer— y desde ahí se mueven libremente.
            <div
              onPointerDown={e => {
                // Arrastrar el fondo = pasear el lienzo. Sobre un elemento no llega acá.
                if (e.target !== e.currentTarget) return
                const inicio = { x: e.clientX, y: e.clientY, vx: vista.x, vy: vista.y }
                const mover = (ev: PointerEvent) =>
                  setVista(v => ({ ...v, x: inicio.vx + (ev.clientX - inicio.x), y: inicio.vy + (ev.clientY - inicio.y) }))
                const soltar = () => {
                  window.removeEventListener('pointermove', mover)
                  window.removeEventListener('pointerup', soltar)
                }
                window.addEventListener('pointermove', mover)
                window.addEventListener('pointerup', soltar)
                setSel(null)
              }}
              ref={lienzoRef}
              style={{
                position: 'absolute', inset: 0, overflow: 'hidden', cursor: 'grab',
                // El área de edición más oscura que el panel, y con puntos: sin una textura que
                // se mueva con el contenido, alejarse o acercarse no se siente — el zoom parecía
                // que cambiaba el tamaño de las tarjetas y no que movía la cámara.
                background: 'rgba(4,5,7,0.55)',
                backgroundImage: 'radial-gradient(rgba(255,255,255,0.10) 1px, transparent 1px)',
                backgroundSize: `${24 * vista.z}px ${24 * vista.z}px`,
                backgroundPosition: `${vista.x}px ${vista.y}px`,
              }}
            >
              <div style={{
                position: 'absolute', left: 0, top: 0,
                transform: `translate(${vista.x}px, ${vista.y}px) scale(${vista.z})`,
                transformOrigin: '0 0',
                width: 1, height: 1,   // la capa no ocupa: la ocupan sus hijos
              }}>
                {/* El nombre de cada zona, sobre su bloque. Es lo que hace que al alejarse se lea
                    la estructura del proyecto en vez de un muro de miniaturas. */}
                {disposicion.zonas.map(z => (
                  <div key={z.nombre} style={{
                    position: 'absolute', left: z.x, top: z.y, width: z.w,
                    pointerEvents: 'none', userSelect: 'none',
                  }}>
                    <div style={{
                      fontSize: 15, fontWeight: 700, letterSpacing: '.02em',
                      color: 'var(--text-1)', marginBottom: 5,
                    }}>{z.nombre}</div>
                    <div style={{ height: 1, background: 'rgba(255,255,255,0.10)' }} />
                  </div>
                ))}

                {visible.map((a, i) => {
                  const p = posicionDe(a.id, i)
                  return (
                    <div
                      key={a.id}
                      // Sin `setPointerCapture`: capturar el puntero se lleva también el `click`,
                      // y entonces la tarjeta no se abría nunca. Se escucha en la ventana y el
                      // clic sigue llegando a la tarjeta salvo que haya habido arrastre de verdad.
                      onPointerDown={e => {
                        if (e.button !== 0) return
                        e.stopPropagation()
                        const inicio = { x: e.clientX, y: e.clientY, px: p.x, py: p.y }
                        let movido = false
                        const mover = (ev: PointerEvent) => {
                          const dx = (ev.clientX - inicio.x) / vista.z
                          const dy = (ev.clientY - inicio.y) / vista.z
                          if (!movido && Math.hypot(dx, dy) < 4) return   // un clic no es un arrastre
                          movido = true
                          moverElemento(a.id, { x: inicio.px + dx, y: inicio.py + dy })
                        }
                        const soltar = () => {
                          window.removeEventListener('pointermove', mover)
                          window.removeEventListener('pointerup', soltar)
                          // Si se arrastró, el clic que viene detrás abriría la tarjeta encima de
                          // donde acabás de soltarla. Se descarta ese único clic.
                          if (movido) arrastrado.current = true
                        }
                        window.addEventListener('pointermove', mover)
                        window.addEventListener('pointerup', soltar)
                      }}
                      onClickCapture={e => {
                        if (arrastrado.current) { e.stopPropagation(); arrastrado.current = false }
                      }}
                      data-hoja
                      style={{
                        position: 'absolute', left: p.x, top: p.y,
                        width: HOJA_W, height: HOJA_H, cursor: 'grab',
                      }}
                    >
                      <Card asset={a} index={i} accent={theme.accent} colors={theme.colors}
                            selected={sel === a.id}
                            onOpen={(from) => { setSel(a.id); setDetail({ asset: a, from }) }}
                            onMenu={(x, y) => setMenu({ x, y, asset: a })} />

                      {/* Barra del elemento seleccionado. Va anclada a la hoja y escala en
                          contra del zoom: a 30 % los íconos serían ilegibles. */}
                      {sel === a.id && (
                        <div
                          onPointerDown={e => e.stopPropagation()}
                          style={{
                            position: 'absolute', left: '50%', top: -12,
                            transform: `translate(-50%, -100%) scale(${1 / vista.z})`,
                            transformOrigin: 'bottom center',
                            display: 'flex', alignItems: 'center', gap: 2, padding: 3,
                            borderRadius: 9, whiteSpace: 'nowrap',
                            background: 'rgba(10,12,16,0.94)', border: '1px solid rgba(255,255,255,0.16)',
                            boxShadow: '0 8px 22px rgba(0,0,0,0.5)',
                          }}
                        >
                          <BarraBtn titulo="Open full screen" onClick={e => {
                            const caja = (e.currentTarget as HTMLElement).closest('[data-hoja]')?.getBoundingClientRect()
                            if (caja) { setSel(a.id); setDetail({ asset: a, from: caja }) }
                          }}>⛶</BarraBtn>
                          <BarraBtn titulo={(notasPorHoja[a.id]?.length ?? 0) > 0 ? `Notes (${notasPorHoja[a.id].length})` : 'Notes'} activo={(notasPorHoja[a.id]?.length ?? 0) > 0} onClick={() => setNotando(a)}>✎</BarraBtn>
                          <BarraBtn titulo="Save to my computer" onClick={() => bajarActivo(a)}>↓</BarraBtn>
                          <span style={{ width: 1, height: 16, background: 'rgba(255,255,255,0.14)', margin: '0 3px' }} />
                          <BarraBtn titulo="Design edits" onClick={() => setEditando(a)}>✦</BarraBtn>
                        </div>
                      )}
                    </div>
                  )
                })}
              </div>

              {/* ── Minimapa ────────────────────────────────────────────────
                  Un lienzo infinito no dice dónde estás parado. Esto sí: el contenido en
                  miniatura, el rectángulo de lo que se ve, y un clic para saltar. */}
              {visible.length > 1 && (() => {
                const MW = 168, MH = 108, M = 8
                let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity
                const pts = visible.map((a, i) => {
                  const p = posicionDe(a.id, i)
                  x0 = Math.min(x0, p.x); y0 = Math.min(y0, p.y)
                  x1 = Math.max(x1, p.x + HOJA_W); y1 = Math.max(y1, p.y + HOJA_H)
                  return { id: a.id, ...p }
                })
                const caja = lienzoRef.current?.getBoundingClientRect()
                const k = Math.min((MW - M * 2) / (x1 - x0), (MH - M * 2) / (y1 - y0))
                const aMini = (x: number, y: number) => ({ x: M + (x - x0) * k, y: M + (y - y0) * k })
                // Lo que se ve ahora, en coordenadas del lienzo.
                const visX = caja ? (-vista.x) / vista.z : 0
                const visY = caja ? (-vista.y) / vista.z : 0
                const visW = caja ? caja.width  / vista.z : 0
                const visH = caja ? caja.height / vista.z : 0
                const v0 = aMini(visX, visY)
                return (
                  <div
                    onPointerDown={e => {
                      e.stopPropagation()
                      const r = (e.currentTarget as HTMLElement).getBoundingClientRect()
                      // Centrar el lienzo en el punto pinchado.
                      const cx = x0 + (e.clientX - r.left - M) / k
                      const cy = y0 + (e.clientY - r.top  - M) / k
                      if (!caja) return
                      setVista(v => ({ ...v, x: caja.width / 2 - cx * v.z, y: caja.height / 2 - cy * v.z }))
                    }}
                    style={{
                      position: 'absolute', right: 14, bottom: 14, width: MW, height: MH,
                      borderRadius: 8, cursor: 'pointer',
                      background: 'rgba(6,7,9,0.82)', border: '1px solid rgba(255,255,255,0.14)',
                      boxShadow: '0 8px 24px rgba(0,0,0,0.45)', overflow: 'hidden',
                    }}
                  >
                    {pts.map(p => {
                      const m = aMini(p.x, p.y)
                      return <div key={p.id} style={{
                        position: 'absolute', left: m.x, top: m.y,
                        width: Math.max(2, HOJA_W * k), height: Math.max(2, HOJA_H * k),
                        background: 'rgba(255,255,255,0.28)', borderRadius: 1,
                      }} />
                    })}
                    <div style={{
                      position: 'absolute', left: v0.x, top: v0.y,
                      width: visW * k, height: visH * k,
                      border: `1px solid ${theme.accent}`, background: `${theme.accent}14`,
                      borderRadius: 2, pointerEvents: 'none',
                    }} />
                  </div>
                )
              })()}
            </div>
          )}
        </div>

        {/* ── Pie: paginación a la izquierda, barra de carga al centro ────── */}
        <div style={{
          display: 'flex', alignItems: 'center', gap: 10, position: 'relative',
          padding: '12px 18px', borderTop: '1px solid var(--line)',
        }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 5, minWidth: 200 }}>
            {/* La etapa que estás mirando —no la del proyecto—, encima de la paginación. */}
            <span style={{
              fontSize: 9.5, fontFamily: 'var(--font-mono)', letterSpacing: '.10em',
              textTransform: 'uppercase', color: theme.accent, opacity: 0.85, lineHeight: 1,
            }}>
              {fase.label}
            </span>
            <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
            {/* La paginación numérica solo existe en la tabla. En el lienzo, las páginas del
                espacio de trabajo son las tres etapas y se cambian con las marcas laterales. */}
            {view === 'table' && pages > 1 && (
              <>
                <PageBtn label="←" disabled={page === 0} onClick={() => setPage(p => p - 1)} />
                {Array.from({ length: pages }, (_, i) => (
                  <PageBtn key={i} label={String(i + 1)} active={i === page} onClick={() => setPage(i)} />
                ))}
                <PageBtn label="→" disabled={page >= pages - 1} onClick={() => setPage(p => p + 1)} />
              </>
            )}
            {view === 'grid' && (
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <PageBtn label="−" onClick={() => setVista(v => ({ ...v, z: Math.max(0.15, v.z / 1.2) }))} />
                <span style={{ fontSize: 10.5, fontFamily: 'var(--font-mono)', color: 'var(--text-3)', minWidth: 38, textAlign: 'center' }}>
                  {Math.round(vista.z * 100)}%
                </span>
                <PageBtn label="+" onClick={() => setVista(v => ({ ...v, z: Math.min(4, v.z * 1.2) }))} />
                <PageBtn label="Fit" onClick={() => encuadrar(visible)} />
              </div>
            )}
            </div>
          </div>

          <div style={{ flex: 1, display: 'flex', justifyContent: 'center' }}>
            <UploadBar
              accent={theme.accent}
              uploading={uploading}
              hasContext={assets.length > 0}
              onFiles={upload}
            />
          </div>

          <div style={{ minWidth: 200 }} />
        </div>
      </div>

      {menu && <ContextMenu {...menu} accent={theme.accent} colors={theme.colors}
                            onDone={() => setMenu(null)}
                            onIterar={a => {
                              setMenu(null)
                              const pg = paginaASG(a)
                              if (pg) setIterando({ asset: a, pagina: pg })
                              else setAviso(`"${outputOf(a) ?? a.name}" is not one of them.`)
                            }}
                            // Design Edits no exige que el activo sea una página de un deck: edita
                            // la imagen que haya, sea de donde sea.
                            onDesignEdit={a => { setMenu(null); setEditando(a) }} />}

      {notando && (
        <NotaModal
          asset={notando}
          valor={miNota(notando.id)}
          otras={otrasNotas(notando.id)}
          accent={theme.accent}
          onClose={() => setNotando(null)}
          onGuardar={t => { guardarNota(notando.id, t); setNotando(null) }}
        />
      )}

      {editando && (
        <DesignEditPrompt
          asset={editando}
          accent={theme.accent}
          onClose={() => setEditando(null)}
          onSubmit={texto => { const a = editando; setEditando(null); setIterando({ asset: a, pagina: null, pedido: texto }) }}
        />
      )}
      {iterando && (
        <IteracionModal
          asset={iterando.asset}
          projectId={projectId}
          pagina={iterando.pagina}
          pedido={iterando.pedido}
          accent={theme.accent}
          onClose={() => setIterando(null)}
          onListo={reload}
        />
      )}
      {aviso    && <NoDisponible  que={aviso}      accent={theme.accent} onClose={() => setAviso(null)} />}

      {detail && <Detail asset={detail.asset} from={detail.from} accent={theme.accent} onAprobado={reload}
                         notas={notasPorHoja[detail.asset.id] ?? []}
                         onNota={() => setNotando(detail.asset)}
                         onDesignEdit={() => setEditando(detail.asset)}
                         onMenu={(mx, my) => setMenu({ x: mx, y: my, asset: detail.asset })}
                         onClose={() => setDetail(null)} />}
    </div>
  )
}

// ── Estado de carga ──────────────────────────────────────────────────────────
// Reemplaza al texto "Cargando…": el panel respira mientras llega el contenido.
//
// El efecto es NEUTRO y parametrizado por el tema del proyecto. El video de referencia tiene
// burbujas subiendo porque SMACK transcurre bajo el agua; un juego de autos no puede abrirse
// igual. Por eso el color sale de la paleta del proyecto y el movimiento es un arquetipo:
//   neutral — motas a la deriva, sin lectura temática (por defecto)
//   rise    — sube (agua, humo, magia)
//   fall    — cae (ceniza, nieve, hojas)
//   streak  — cruza en horizontal (velocidad)
//   pulse   — late en el lugar (tech)
// Hoy todos los proyectos resuelven 'neutral'; cuando exista el campo, cambia solo el dato.
const MOTION: Record<string, { anim: string; dur: [number, number] }> = {
  neutral: { anim: 'mb-mote',   dur: [9, 4] },
  rise:    { anim: 'mb-rise',   dur: [7, 2] },
  fall:    { anim: 'mb-fall',   dur: [8, 3] },
  streak:  { anim: 'mb-streak', dur: [5, 2] },
  pulse:   { anim: 'mb-pulse',  dur: [3, 1] },
}

function LoadingWash({ theme, cols }: { theme: MoodboardTheme; cols: number }) {
  const m = MOTION[theme.motion] ?? MOTION.neutral
  // Se usan los colores del proyecto por turno; con el tema neutro es un solo gris y el
  // resultado es sobrio a propósito.
  const hue = (i: number) => theme.colors[i % theme.colors.length] || theme.accent

  return (
    <div style={{ position: 'relative', height: '100%' }}>
      <div style={{
        position: 'absolute', left: -60, top: -40, width: 340, height: 260,
        background: 'radial-gradient(ellipse, rgba(255,255,255,0.05), transparent 68%)',
        borderRadius: '48% 52% 60% 40% / 45% 40% 60% 55%',
        animation: 'mb-drift 9s ease-in-out infinite',
      }} />
      <div style={{
        position: 'absolute', right: -40, bottom: -30, width: 300, height: 240,
        background: `radial-gradient(ellipse, ${theme.accent}1f, transparent 66%)`,
        borderRadius: '55% 45% 40% 60% / 50% 55% 45% 50%',
        animation: 'mb-drift 11s ease-in-out infinite reverse',
      }} />

      {[...Array(9)].map((_, i) => (
        <div key={i} style={{
          position: 'absolute',
          bottom: theme.motion === 'fall' ? undefined : -20,
          top:    theme.motion === 'fall' ? -20 : undefined,
          left: `${8 + i * 10.5}%`,
          width: 4 + (i % 3) * 3, height: 4 + (i % 3) * 3,
          borderRadius: '50%', background: `${hue(i)}55`,
          animation: `${m.anim} ${m.dur[0] + (i % 4) * m.dur[1]}s linear ${i * 0.7}s infinite`,
        }} />
      ))}

      <div style={{
        display: 'grid', gap: 16, position: 'relative', height: '100%',
        gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))`,
        gridTemplateRows:    `repeat(${ROWS}, minmax(0, 1fr))`,
      }}>
        {[...Array(cols * ROWS)].map((_, i) => (
          <div key={i} style={{
            borderRadius: 12, minHeight: 0,
            background: 'linear-gradient(100deg, rgba(255,255,255,0.03) 30%, rgba(255,255,255,0.075) 50%, rgba(255,255,255,0.03) 70%)',
            backgroundSize: '220% 100%',
            border: '1px solid rgba(255,255,255,0.05)',
            animation: `mb-shimmer 1.5s ease-in-out ${i * 0.09}s infinite`,
          }} />
        ))}
      </div>
    </div>
  )
}

// ── Pestaña ──────────────────────────────────────────────────────────────────
function Tab({ label, count, active, onClick }: {
  label: string; count: number; active: boolean; onClick: () => void
}) {
  const empty = count === 0
  return (
    <button
      onClick={() => { if (!empty) onClick() }}
      disabled={empty}
      style={{
        display: 'flex', alignItems: 'center', gap: 6,
        cursor: empty ? 'default' : 'pointer',
        padding: '6px 12px', borderRadius: 8, fontSize: 12,
        background: active ? 'rgba(255,255,255,0.09)' : 'transparent',
        border: `1px solid ${active ? 'var(--line-2)' : 'transparent'}`,
        color: active ? 'var(--text-0)' : empty ? 'var(--text-3)' : 'var(--text-2)',
        opacity: empty ? 0.42 : 1,
        fontWeight: active ? 600 : 500,
        transition: 'background 140ms ease, color 140ms ease',
      }}
    >
      {label}
      {count > 0 && (
        <span style={{ fontSize: 10, fontFamily: 'var(--font-mono)', color: 'var(--text-3)' }}>{count}</span>
      )}
    </button>
  )
}

// ── Tarjeta ──────────────────────────────────────────────────────────────────
// Como la referencia: la imagen ocupa la tarjeta entera y el título va encima, sobre un
// degradado que lo despega del fondo.
// Las miniaturas se calculan una sola vez por navegador y quedan en localStorage, así que a
// partir de la segunda vez aparecen sin red. Mientras tanto la tarjeta muestra su ícono.
function useGlbThumb(url: string, id: string, r: Rampa) {
  // Estado inicial = lo que ya está en cache. Si se dejaba en null y se esperaba al `await`,
  // React pintaba un frame con el ícono en CADA montaje — o sea en cada cambio de pestaña.
  const [data, setData] = useState<string | null>(() => (url ? glbThumbCached(id, r) ?? null : null))
  const [cargando, setCargando] = useState(false)
  // La rampa se serializa en la dependencia: si viniera como objeto nuevo en cada render el
  // efecto se dispararía en bucle y repintaría el modelo sin parar.
  const clave = `${r.sombra}|${r.luz}|${r.borde}`
  useEffect(() => {
    if (!url) { setData(null); setCargando(false); return }
    const [sombra, luz, borde] = clave.split('|')
    const hit = glbThumbCached(id, { sombra, luz, borde })
    if (hit !== undefined) { setData(hit); setCargando(false); return }
    let vivo = true
    setCargando(true)
    glbThumb(url, id, { sombra, luz, borde }).then(d => { if (vivo) { setData(d); setCargando(false) } })
    return () => { vivo = false }
  }, [url, id, clave])
  return { data, cargando }
}

// El documento entero, pedido de a uno cuando se abre. Se cachea en memoria por sesión: abrir
// y cerrar el mismo documento no vuelve a pegarle al backend.
const docCache = new Map<string, string>()

function useDocContent(id: string) {
  const [texto, setTexto] = useState<string | null>(() => (id ? docCache.get(id) ?? null : null))
  useEffect(() => {
    if (!id || docCache.has(id)) { setTexto(id ? docCache.get(id)! : null); return }
    let vivo = true
    getAssetContent(id)
      .then(r => { docCache.set(id, r.content); if (vivo) setTexto(r.content) })
      .catch(() => { /* sin contenido: queda el asomo de la tarjeta */ })
    return () => { vivo = false }
  }, [id])
  return texto
}

function useVideoThumb(url: string, id: string) {
  const [data, setData] = useState<string | null>(() => (url ? videoThumbCached(id) ?? null : null))
  const [cargando, setCargando] = useState(false)
  useEffect(() => {
    if (!url) { setData(null); setCargando(false); return }
    const hit = videoThumbCached(id)
    if (hit !== undefined) { setData(hit); setCargando(false); return }
    let vivo = true
    setCargando(true)
    videoThumb(url, id).then(d => { if (vivo) { setData(d); setCargando(false) } })
    return () => { vivo = false }
  }, [url, id])
  return { data, cargando }
}

// El acento del proyecto se elige por luminancia, que es lo correcto para el aro del radial pero
// deja la onda casi blanca: en SMACK gana `#D4E8F0` sobre un naranja y un rosa saturados. Para la
// onda se busca color, no luz — el más saturado de la paleta, ignorando los casi-negros del fondo
// del documento y los casi-blancos, que no son identidad de nadie.
// El play de la referencia: aro fino, relleno apenas, y el triángulo del color del proyecto.
function Play({ accent, size }: { accent: string; size: number }) {
  return (
    <div style={{
      width: size, height: size, borderRadius: '50%', flexShrink: 0,
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      border: `1.5px solid ${accent}`,
      background: `${accent}14`,
      boxShadow: `0 0 18px ${accent}44`,
    }}>
      <svg width={size * 0.34} height={size * 0.34} viewBox="0 0 12 14" fill={accent}
           style={{ marginLeft: size * 0.05 }}>
        <path d="M0 0 L12 7 L0 14 Z" />
      </svg>
    </div>
  )
}

function hsl(h: string): { s: number; l: number; hue: number } | null {
  const m = h.match(/^#([0-9a-f]{6})$/i)
  if (!m) return null
  const n = parseInt(m[1], 16)
  const r = ((n >> 16) & 255) / 255, g = ((n >> 8) & 255) / 255, b = (n & 255) / 255
  const max = Math.max(r, g, b), min = Math.min(r, g, b), l = (max + min) / 2
  const s = max === min ? 0 : (max - min) / (1 - Math.abs(2 * l - 1))
  let hue = 0
  if (max !== min) {
    hue = max === r ? ((g - b) / (max - min) + (g < b ? 6 : 0))
        : max === g ? ((b - r) / (max - min) + 2)
        :             ((r - g) / (max - min) + 4)
    hue *= 60
  }
  return { s, l, hue }
}

// Color con carácter para la onda y el borde del 3D. NO se usa el acento del tema: ése se elige
// por luminancia —correcto para el aro del radial— y en SMACK gana `#D4E8F0`, casi blanco.
//
// Se penalizan los tonos que en una interfaz YA significan algo: rojo-naranja es error o
// advertencia, verde es éxito. Usarlos de relleno decorativo pelea con ese significado, aunque
// sean los más saturados de la paleta. Lo que queda —violetas, magentas, azules— es color libre.
// En SMACK eso descarta el `#FF6B35` (el más saturado) y el `#A8E6CF`, y deja el rosa `#E8B4E8`.
function vivido(colors: string[], fallback: string): string {
  const puntaje = (h: string) => {
    const c = hsl(h)
    if (!c || c.l < 0.18 || c.l > 0.88 || c.s < 0.15) return -1
    const semantico = c.hue < 45 || c.hue > 345 || (c.hue > 90 && c.hue < 165)
    return semantico ? c.s * 0.35 : c.s
  }
  const mejor = [...colors].sort((a, b) => puntaje(b) - puntaje(a))[0]
  return mejor && puntaje(mejor) > 0 ? mejor : fallback
}

// La rampa con que se sombrea un modelo 3D: sombra, luz y borde, los tres de la paleta.
// La sombra no es el color más oscuro sin más — las paletas suelen traer un casi-negro que es el
// fondo del documento, y con ése la mitad en sombra queda plana. Se toma el más oscuro que
// todavía tenga algo de color.
function rampa(colors: string[], accent: string): Rampa {
  const conL = colors.map(c => ({ c, l: hsl(c)?.l ?? -1 })).filter(x => x.l >= 0)
  if (conL.length < 2) return { sombra: '#2a2f38', luz: '#eef2f7', borde: accent }
  const orden  = [...conL].sort((a, b) => a.l - b.l)
  const sombra = orden.find(x => x.l >= 0.08) ?? orden[0]
  return {
    sombra: sombra.c,
    luz:    orden[orden.length - 1].c,
    borde:  vivido(colors, accent),
  }
}

function useAudioThumb(url: string, id: string, accent: string) {
  const [data, setData] = useState<AudioThumb | null>(() => (url ? audioThumbCached(id, accent) ?? null : null))
  const [cargando, setCargando] = useState(false)
  useEffect(() => {
    if (!url) { setData(null); setCargando(false); return }
    const hit = audioThumbCached(id, accent)
    if (hit !== undefined) { setData(hit); setCargando(false); return }
    let vivo = true
    setCargando(true)
    audioThumb(url, id, accent).then(d => { if (vivo) { setData(d); setCargando(false) } })
    return () => { vivo = false }
  }, [url, id, accent])
  return { data, cargando }
}

function Card({ asset, index, accent, colors, selected, onOpen, onMenu }: {
  asset: UnifiedAsset; index: number; accent: string; colors: string[]
  selected: boolean; onOpen: (from: DOMRect) => void; onMenu: (x: number, y: number) => void
}) {
  const [hover, setHover] = useState(false)
  const t    = tabOf(asset)
  const kind = kindOf(asset)
  const url  = asset.storage_url ?? ''
  const g    = useGlbThumb(kind === '3d'    ? url : '', asset.id, rampa(colors, accent))
  const v    = useVideoThumb(kind === 'video' ? url : '', asset.id)
  const a    = useAudioThumb(kind === 'audio' ? url : '', asset.id, vivido(colors, accent))
  const glb = g.data, vid = v.data, aud = a.data
  // El ícono es el marcador de posición mientras se calcula la miniatura; late para que se lea
  // como "trabajando" y no como resultado final, y la miniatura entra fundida en vez de saltar.
  const calculando = g.cargando || v.cargando || a.cargando

  return (
    <div
      // Clic izquierdo: el activo fluye al frente desde su lugar en la grilla — también los
      // documentos, que desde ahí se pueden abrir. El clic derecho abre el menú (descargar).
      onClick={e => onOpen(e.currentTarget.getBoundingClientRect())}
      onContextMenu={e => { e.preventDefault(); onMenu(e.clientX, e.clientY) }}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      style={{
        // El tamaño lo daba la celda de la grilla. En el lienzo cada hoja va en posición absoluta
        // y sin esto la tarjeta colapsa a cero: se veían los bordes y nada adentro.
        position: 'relative', width: '100%', height: '100%', minHeight: 0,
        borderRadius: 12, overflow: 'hidden',
        cursor: 'pointer', background: 'var(--bg-2)',
        border: `1px solid ${selected ? accent : hover ? 'rgba(255,255,255,0.18)' : 'rgba(255,255,255,0.07)'}`,
        boxShadow: selected ? `0 0 0 1px ${accent}, 0 0 26px ${accent}33` : 'none',
        transition: 'border-color 150ms ease, box-shadow 150ms ease, transform 150ms ease',
        transform: hover && !selected ? 'translateY(-2px)' : 'none',
        animation: `mb-in 320ms ease ${index * 32}ms backwards`,
      }}
    >
      {/* Marca de versión: solo aparece cuando hay historial de verdad. El endpoint ya devuelve
          `versions`; hoy la tabla está vacía, así que no se ve nada — y eso es lo correcto. */}
      {asset.versions?.length > 1 && (
        <div style={{
          position: 'absolute', top: 7, left: 7, zIndex: 2,
          display: 'flex', alignItems: 'center', gap: 4,
          padding: '2px 7px', borderRadius: 5,
          background: 'rgba(6,7,9,0.72)', backdropFilter: 'blur(3px)',
          border: '1px solid rgba(255,255,255,0.14)',
          fontSize: 9.5, fontFamily: 'var(--font-mono)', color: '#fff', letterSpacing: '.04em',
        }}>
          v{asset.versions.find(v => v.is_current)?.version_number ?? asset.versions.length}
          <span style={{ opacity: 0.5 }}>of {asset.versions.length}</span>
        </div>
      )}

      {kind === 'image' && url ? (
        <Image src={url} alt={asset.name} fill sizes="(max-width: 1100px) 50vw, 320px"
               style={{ objectFit: 'cover' }} />
      ) : kind === 'video' && vid ? (
        <>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={vid} alt={asset.name}
               style={{ width: '100%', height: '100%', objectFit: 'cover', animation: 'mb-aparece 420ms ease' }} />
          <div style={{
            position: 'absolute', inset: 0, display: 'flex',
            alignItems: 'center', justifyContent: 'center', pointerEvents: 'none',
          }}>
            <Play accent={vivido(colors, accent)} size={54} />
          </div>
        </>
      ) : kind === 'audio' && aud ? (
        // Como en la referencia: play a la izquierda, onda ocupando el ancho, duración abajo
        // a la derecha. El play es una marca de tipo, no un reproductor — se escucha al abrir.
        <div style={{
          width: '100%', height: '100%', display: 'flex', alignItems: 'center', gap: 12,
          padding: '18px 16px 34px',
        }}>
          <Play accent={vivido(colors, accent)} size={38} />
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={aud.img} alt=""
               style={{ flex: 1, minWidth: 0, opacity: aud.real ? 1 : 0.6, animation: 'mb-aparece 420ms ease' }} />
        </div>
      ) : kind === '3d' && glb ? (
        // Silueta de la geometría real del modelo, no un ícono. Ver lib/glb-thumb.
        // eslint-disable-next-line @next/next/no-img-element
        <img src={glb} alt={asset.name}
             style={{ width: '100%', height: '100%', objectFit: 'contain', padding: 10,
                      animation: 'mb-aparece 420ms ease' }} />
      ) : kind === 'doc' ? (
        // La tarjeta de un documento se lee como una hoja: encabezado arriba —ícono y nombre en
        // una línea, no centrados— y debajo el texto ocupando lo que sobre. Antes el encabezado
        // estaba centrado en vertical y el texto empezaba al 52%: se pisaban.
        <div style={{
          width: '100%', height: '100%', display: 'flex', flexDirection: 'column',
          gap: 8, padding: '14px 14px 32px',
          background: 'linear-gradient(150deg, rgba(255,255,255,0.045), rgba(255,255,255,0.012))',
        }}>
          <div style={{ display: 'flex', alignItems: 'flex-start', gap: 9, flexShrink: 0 }}>
            <div style={{ flexShrink: 0, marginTop: 1, opacity: 0.9 }}>
              <TypeIcon type={kind} accent="var(--action)" size={17} />
            </div>
            <div style={{
              fontSize: 11.5, fontWeight: 600, color: 'var(--text-1)', lineHeight: 1.3,
              display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden',
            }}>{outputOf(asset) ?? asset.name}</div>
          </div>

          {asset.preview && (
            // Un documento se distingue de otro por lo que dice, no por su ícono. Se renderiza
            // como markdown —igual que al abrirlo— y se reduce al 62% con `scale`: así entran
            // encabezados y tablas legibles en una tarjeta, y al abrir no hay salto de formato.
            <div style={{
              flex: 1, minHeight: 0, overflow: 'hidden', pointerEvents: 'none',
              maskImage: 'linear-gradient(to bottom, #000 55%, transparent)',
              WebkitMaskImage: 'linear-gradient(to bottom, #000 55%, transparent)',
            }}>
              <div style={{
                transform: 'scale(0.62)', transformOrigin: 'top left',
                width: '161%',                       // 1/0.62: recupera el ancho que quita la escala
                fontSize: 12, lineHeight: 1.6, color: 'var(--text-2)',
              }}>
                <ReactMarkdown remarkPlugins={[remarkGfm]} components={MD_COMPONENTS}>
                  {asset.preview}
                </ReactMarkdown>
              </div>
            </div>
          )}
        </div>
      ) : (
        <div style={{
          width: '100%', height: '100%', display: 'flex', flexDirection: 'column',
          alignItems: 'center', justifyContent: 'center', gap: 12, padding: '18px 14px 34px',
          background: 'linear-gradient(150deg, rgba(255,255,255,0.045), rgba(255,255,255,0.012))',
        }}>
          <div style={{ animation: calculando ? 'mb-latido 1.4s ease-in-out infinite' : 'none' }}>
            <TypeIcon type={kind} accent={kind === '3d' ? 'var(--action)' : accent} />
          </div>
        </div>
      )}

      {/* Scrim + NOMBRE DE LA HOJA. Antes decía la procedencia («2D · 3.20 Art Style Guide») y eso
          dejaba las 34 páginas de un deck con la misma etiqueta, encabezadas por una clave técnica
          que a quien mira el moodboard no le dice nada. Ahora cada hoja se llama por lo que es. */}
      <div style={{
        position: 'absolute', left: 0, right: 0, bottom: 0, padding: '24px 12px 9px',
        background: 'linear-gradient(to top, rgba(8,9,12,0.9) 10%, rgba(8,9,12,0.45) 55%, transparent)',
        pointerEvents: 'none',
      }}>
        <div style={{
          fontSize: 10.5, fontFamily: 'var(--font-mono)', color: 'rgba(255,255,255,0.72)',
          whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
        }}>
          {kind === 'image' ? '2D' : kind === '3d' ? '3D' : kind.toUpperCase()}
          {` · ${nombreDeHoja(asset)}`}
        </div>
      </div>

      {/* Duración abajo a la derecha, como en la referencia. Convive con la procedencia de la
          izquierda porque el scrim ya ocupa todo el ancho. */}
      {(kind === 'audio' || kind === 'video') && aud?.segundos != null && (
        <div style={{
          position: 'absolute', right: 12, bottom: 9, pointerEvents: 'none',
          fontSize: 10.5, fontFamily: 'var(--font-mono)', color: 'rgba(255,255,255,0.72)',
        }}>{mmss(aud.segundos)}</div>
      )}

    </div>
  )
}

// ── Detalle ──────────────────────────────────────────────────────────────────
// No es un visor a pantalla completa: es una CARD que fluye al frente desde su lugar en la
// grilla, como en la referencia. La grilla sigue visible detrás, atenuada, así no se pierde
// el contexto de dónde estaba la imagen. Al cerrar vuelve exactamente a su celda.
function Detail({ asset, from, accent, onMenu, onClose, onAprobado, notas, onNota, onDesignEdit }: {
  asset: UnifiedAsset; from: DOMRect; accent: string
  onMenu: (x: number, y: number) => void; onClose: () => void; onAprobado: () => void
  // Las mismas acciones que en el lienzo. Al abrir la hoja no se pierden: es la misma pieza,
  // vista más grande, y tener que cerrarla para poder anotarla era el camino largo.
  notas: AssetNote[]; onNota: () => void; onDesignEdit: () => void
}) {
  const t   = kindOf(asset)
  // Historial de la pieza. Se mira desde aca: el badge de la tarjeta decia que habia dos
  // versiones y no habia forma de llegar a la anterior sin volver a iterar.
  const vers = useMemo(
    () => [...(asset.versions ?? [])].sort((a, b) => a.version_number - b.version_number),
    [asset.versions])
  const [verN, setVerN] = useState<number | null>(
    () => vers.find(v => v.is_current)?.version_number ?? null)
  const verSel = vers.find(v => v.version_number === verN)
  // Sin historial, lo que se ve ES la vigente.
  const esVigente = !vers.length || !!verSel?.is_current
  const [aprobando, setAprobando] = useState(false)
  const url = (verSel?.storage_url ?? asset.storage_url) ?? ''
  const texto = useDocContent(kindOf(asset) === 'doc' ? asset.id : '')
  const [open,  setOpen]  = useState(false)
  // Zoom dentro de la card, para mirar el detalle fino de un arte sin abrir otra ventana.
  // Rueda para acercar sobre el puntero, arrastre para desplazar, doble clic para volver.
  const [zoom,  setZoom]  = useState(1)
  const [pan,   setPan]   = useState({ x: 0, y: 0 })
  const frame   = useRef<HTMLDivElement>(null)
  const panning = useRef<{ x: number; y: number } | null>(null)
  // La card respeta la proporción real de la imagen, que solo se conoce al cargarla. Hasta
  // entonces se parte de la del origen, PERO acotada: en la vista de tabla el origen es una
  // fila de ~1500x40 y sin el tope la card salía como una tira. Un documento nunca corrige
  // esa proporción porque no hay imagen que cargue, así que arranca en formato hoja.
  const [ratio, setRatio] = useState(() => {
    if (t !== 'image') return 3 / 4                       // documento, audio, 3D: formato hoja
    return Math.min(Math.max(from.width / from.height, 0.45), 2.4)
  })

  useEffect(() => { const r = requestAnimationFrame(() => setOpen(true)); return () => cancelAnimationFrame(r) }, [])

  const close = () => { setOpen(false); setTimeout(onClose, 300) }

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') close() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  })

  // React registra onWheel como pasivo, así que no se puede frenar el scroll desde ahí.
  useEffect(() => {
    const el = frame.current
    if (!el) return
    const onWheel = (e: WheelEvent) => {
      e.preventDefault()
      const r    = el.getBoundingClientRect()
      const next = Math.min(6, Math.max(1, zoom * (e.deltaY < 0 ? 1.18 : 1 / 1.18)))
      if (next === zoom) return
      if (next === 1) { setZoom(1); setPan({ x: 0, y: 0 }); return }
      // El punto bajo el puntero se queda quieto: se corrige el desplazamiento por la
      // diferencia de escala respecto del centro de la card.
      const cx = e.clientX - (r.left + r.width  / 2)
      const cy = e.clientY - (r.top  + r.height / 2)
      const k  = next / zoom
      setPan(p => ({ x: cx - (cx - p.x) * k, y: cy - (cy - p.y) * k }))
      setZoom(next)
    }
    el.addEventListener('wheel', onWheel, { passive: false })
    return () => el.removeEventListener('wheel', onWheel)
  }, [zoom])

  // Caja de destino: alta pero sin llenar la pantalla — es una card, no un lightbox.
  // Se deja aire abajo para los datos y a la derecha para la X, que ahora van fuera del marco.
  // Un documento se lee, así que se le da más alto y más ancho que a una imagen: con el tamaño
  // de imagen entraban seis líneas y había que hacer scroll para todo.
  const doc  = t === 'doc'
  const maxH = window.innerHeight * (doc ? 0.80 : 0.68)
  const maxW = window.innerWidth  * (doc ? 0.62 : 0.50)
  let h = maxH, w = h * ratio
  if (w > maxW) { w = maxW; h = w / ratio }

  const box = open
    ? { left: (window.innerWidth - w) / 2, top: (window.innerHeight - h) / 2 - 26, width: w, height: h }
    : { left: from.left, top: from.top, width: from.width, height: from.height }

  const FLIGHT = 'left 360ms cubic-bezier(0.22,1,0.36,1), top 360ms cubic-bezier(0.22,1,0.36,1), width 360ms cubic-bezier(0.22,1,0.36,1), height 360ms cubic-bezier(0.22,1,0.36,1)'

  return (
    // El fondo NO cierra: con zoom y paneo activos, un clic fuera del marco es fácil de
    // disparar sin querer y se perdía la vista. Se sale por la X o con Esc.
    <div
      style={{
        position: 'fixed', inset: 0, zIndex: 12050,   // sobre la grilla (12000)
        background: open ? 'rgba(6,7,9,0.62)' : 'rgba(6,7,9,0)',
        backdropFilter: open ? 'blur(3px)' : 'blur(0px)',
        transition: 'background 300ms ease, backdrop-filter 300ms ease',
      }}
    >
      <div
        ref={frame}
        onPointerDown={e => { if (e.button === 0 && zoom > 1) { panning.current = { x: e.clientX - pan.x, y: e.clientY - pan.y }; (e.target as HTMLElement).setPointerCapture?.(e.pointerId) } }}
        onPointerMove={e => { if (panning.current) setPan({ x: e.clientX - panning.current.x, y: e.clientY - panning.current.y }) }}
        onPointerUp={() => { panning.current = null }}
        onDoubleClick={() => { setZoom(1); setPan({ x: 0, y: 0 }) }}
        // El menu solo sobre la VIGENTE. Iterar no ramifica desde la version que estas mirando:
        // vuelve a ejecutar el prompt de la pagina contra su plantilla, asi que hacerlo parado en
        // la v1 o en la v3 da lo mismo. Ofrecerlo ahi prometeria algo que no pasa.
        onContextMenu={e => {
          e.preventDefault(); e.stopPropagation()
          if (esVigente) onMenu(e.clientX, e.clientY)
        }}
        style={{
        position: 'fixed', ...box,
        borderRadius: 16, overflow: 'hidden',
        cursor: zoom > 1 ? (panning.current ? 'grabbing' : 'grab') : 'default',
        border: '1px solid rgba(255,255,255,0.14)',
        boxShadow: open ? '0 30px 90px rgba(0,0,0,0.7)' : 'none',
        background: 'var(--bg-2)',
        transition: `${FLIGHT}, box-shadow 300ms ease`,
      }}>
        {t === 'image' && url && (
          // Acá se pide la resolución completa: es la vista para juzgar la imagen.
          <img src={url} alt={asset.name}
               onLoad={e => {
                 const el = e.currentTarget
                 if (el.naturalWidth && el.naturalHeight)
                   setRatio(Math.min(Math.max(el.naturalWidth / el.naturalHeight, 0.45), 2.4))
               }}
               draggable={false}
               style={{
                 width: '100%', height: '100%', objectFit: 'cover', display: 'block',
                 transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})`,
                 transition: panning.current ? 'none' : 'transform 140ms ease-out',
                 userSelect: 'none',
               }} />
        )}
        {t === 'video' && url && (
          <video src={url} controls autoPlay style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
        )}
        {t === 'audio' && url && (
          <div style={{ width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24 }}>
            <audio src={url} controls style={{ width: '100%' }} />
          </div>
        )}
        {t === '3d' && (
          // El mismo visor que usan la librería de activos y el detalle de nodo.
          <ModelViewer url={url || undefined} style={{ width: '100%', height: '100%' }} />
        )}
        {t === 'doc' && (
          // Al frente el documento se lee, no solo se anuncia: el mismo asomo de texto de la
          // tarjeta pero con espacio, y la acción abajo del todo. Antes era un ícono gigante y
          // un botón — ocupaba media pantalla para decir menos que la miniatura.
          <div style={{
            width: '100%', height: '100%', display: 'flex', flexDirection: 'column',
            gap: 14, padding: '26px 28px 22px',
          }}>
            <div style={{ display: 'flex', alignItems: 'flex-start', gap: 11, flexShrink: 0 }}>
              <TypeIcon type="doc" accent="var(--action)" size={22} />
              <div style={{ fontSize: 15, fontWeight: 600, color: 'var(--text-0)', lineHeight: 1.3 }}>
                {outputOf(asset) ?? asset.name}
              </div>
            </div>

            {/* El listado viaja sin `content` a propósito; acá se pide el documento entero, de
                a uno, y se renderiza como markdown — que es lo que son. El asomo de la tarjeta
                se muestra mientras llega, así el marco nunca queda vacío. */}
            <div
              onWheel={e => e.stopPropagation()}
              style={{
                flex: 1, minHeight: 0, overflowY: 'auto', paddingRight: 6,
                fontSize: 12, lineHeight: 1.7, color: 'var(--text-1)',
              }}>
              {/* Un solo render para los dos estados: primero el asomo, después el documento
                  entero. Si el asomo se pintara como texto plano se vería el markdown crudo y
                  al llegar el contenido habría un salto de formato — que es justo lo que no
                  queremos. Acá lo único que cambia es cuánto texto hay. */}
              <ReactMarkdown remarkPlugins={[remarkGfm]} components={MD_COMPONENTS}>
                {texto ?? asset.preview ?? ''}
              </ReactMarkdown>
            </div>

            {url && (
              <a href={url} target="_blank" rel="noreferrer" onClick={e => e.stopPropagation()}
                 style={{
                   flexShrink: 0, alignSelf: 'flex-start',
                   display: 'flex', alignItems: 'center', gap: 7,
                   fontSize: 12, padding: '8px 15px', borderRadius: 8, textDecoration: 'none',
                   background: 'rgba(255,255,255,0.06)', border: '1px solid var(--line-2)', color: 'var(--text-1)',
                 }}>
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
                  <path d="M7 17 17 7M9 7h8v8" />
                </svg>
                Open document
              </a>
            )}
          </div>
        )}

      </div>

      {/* Nivel de zoom — solo aparece cuando se está usando */}
      {open && zoom > 1 && (
        <div style={{
          position: 'fixed', left: box.left + 12, top: box.top + 12,
          padding: '4px 9px', borderRadius: 7, fontSize: 11, fontFamily: 'var(--font-mono)',
          background: 'rgba(8,9,12,0.7)', border: '1px solid rgba(255,255,255,0.14)',
          color: 'var(--text-1)', pointerEvents: 'none',
        }}>{zoom.toFixed(1)}× · double-click to reset</div>
      )}

      {/* Datos DEBAJO del marco: encima tapaban justo la parte de la imagen que se vino a ver. */}
      <div style={{
        position: 'fixed',
        left: box.left, top: box.top + box.height + 14, width: box.width,
        textAlign: 'center', pointerEvents: 'none',
        opacity: open ? 1 : 0,
        transition: `${FLIGHT}, opacity 240ms ease 140ms`,
      }}>
        <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--text-0)' }}>{nombreDeHoja(asset)}</div>
        <div style={{ fontSize: 11, fontFamily: 'var(--font-mono)', color: 'var(--text-3)', marginTop: 3 }}>
          {/* El documento del que sale, sin la clave del nodo: el moodboard es para quien mira
              arte, no para quien edita la DNA. */}
          {asset.node_title || asset.source}
          {' · '}{new Date(asset.created_at).toLocaleDateString()}
        </div>
      </div>

      {/* Versiones: fuera del marco, debajo de la X. Adentro tapaba parte de la imagen. */}
        {vers.length > 1 && (
          <div
            onPointerDown={e => e.stopPropagation()}
            onDoubleClick={e => e.stopPropagation()}
            style={{
              position: 'fixed', zIndex: 12051,
              left: box.left + box.width + 12, top: box.top + 38,
              maxHeight: Math.max(120, box.height - 38),
              width: 74, display: 'flex', flexDirection: 'column', gap: 6,
              overflowY: 'auto', overflowX: 'hidden', padding: 6, borderRadius: 9,
              background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.16)',
              opacity: open ? 1 : 0,
              transition: `${FLIGHT}, opacity 220ms ease 140ms`,
            }}
          >
            {!esVigente && (
              <div style={{
                fontSize: 8.5, lineHeight: 1.35, color: 'var(--text-3)', textAlign: 'center',
                padding: '2px 1px 4px', borderBottom: '1px solid rgba(255,255,255,0.1)', marginBottom: 2,
              }}>
                viewing an earlier version
              </div>
            )}
            {[...vers].reverse().map(v => (
              <button
                key={v.id}
                onClick={e => { e.stopPropagation(); setVerN(v.version_number); setZoom(1); setPan({ x: 0, y: 0 }) }}
                title={[
                  `v${v.version_number}${v.is_current ? ' · current' : ''}${v.approved_at ? ' · approved' : ''}`,
                  v.author ? `by ${v.author}` : null,
                  fechaLarga(v.created_at),
                ].filter(Boolean).join('\n')}
                style={{
                  position: 'relative', width: '100%', aspectRatio: '4 / 3', flexShrink: 0,
                  borderRadius: 6, overflow: 'hidden', cursor: 'pointer', padding: 0,
                  background: 'var(--bg-2)',
                  border: `1px solid ${v.version_number === verN ? accent : 'rgba(255,255,255,0.16)'}`,
                  opacity: v.version_number === verN ? 1 : 0.6,
                }}
              >
                {v.storage_url && (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={v.storage_url} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                )}
                <span style={{
                  position: 'absolute', left: 0, right: 0, bottom: 0,
                  fontSize: 8.5, fontFamily: 'var(--font-mono)', lineHeight: '13px',
                  background: 'rgba(6,7,9,0.8)', color: v.is_current ? accent : '#fff',
                }}>v{v.version_number}{v.approved_at ? ' ✓' : ''}</span>
              </button>
            ))}

          </div>
        )}

      {/* Autoría de la versión que se está mirando, abajo a la izquierda —enfrente del botón de
          aprobar—. En la tira solo caben 74 px, así que el nombre y la hora van acá, donde se leen
          sin pasar el mouse por encima. */}
      {vers.length > 1 && verSel && (
        <div
          onPointerDown={e => e.stopPropagation()}
          style={{
            position: 'fixed',
            left: box.left, top: box.top + box.height + 10,
            display: 'flex', alignItems: 'center', gap: 8,
            padding: '6px 12px 6px 8px', borderRadius: 999,
            background: 'rgba(6,7,9,0.82)',
            border: `1px solid ${verSel.is_current ? accent + '66' : 'rgba(255,255,255,0.16)'}`,
            boxShadow: '0 6px 18px rgba(0,0,0,0.45)',
            backdropFilter: 'blur(6px)',
            fontSize: 11, fontFamily: 'var(--font-mono)', whiteSpace: 'nowrap',
            color: 'var(--text-2)',
            opacity: open ? 1 : 0,
            transition: `${FLIGHT}, opacity 220ms ease 140ms`,
          }}
        >
          {/* El número, en su propia pastilla: es lo que se busca primero al comparar versiones. */}
          <span style={{
            padding: '2px 8px', borderRadius: 999, fontWeight: 700,
            background: verSel.is_current ? `${accent}22` : 'rgba(255,255,255,0.07)',
            color: verSel.is_current ? accent : 'var(--text-1)',
          }}>
            v{verSel.version_number}
          </span>
          {verSel.author && (
            <span style={{ color: 'var(--text-1)' }}>{verSel.author}</span>
          )}
          <span style={{ opacity: 0.55 }}>{fechaLarga(verSel.created_at)}</span>
          {verSel.approved_at && (
            <span style={{
              padding: '2px 7px', borderRadius: 999, fontSize: 9.5, letterSpacing: '.06em',
              background: `${accent}1f`, border: `1px solid ${accent}55`, color: accent,
            }}>APPROVED</span>
          )}
        </div>
      )}

      {/* Aprobar, fuera del marco y abajo a la derecha. Vive aca y no solo en el modal de
          iteracion: si se cerraba sin decidir, no habia forma de volver a hacerlo. */}
      {vers.length > 0 && verSel && (
        <button
          onClick={async () => {
            if (verSel.approved_at || aprobando) return
            setAprobando(true)
            try { await approveAssetVersion(asset.project_id!, asset.id, verSel.id); onAprobado() }
            finally { setAprobando(false) }
          }}
          disabled={!!verSel.approved_at || aprobando}
          title={verSel.approved_at ? 'Already approved' : `Approve version ${verSel.version_number}`}
          style={{
            position: 'fixed',
            left: box.left + box.width, top: box.top + box.height + 10,
            transform: 'translateX(-100%)',
            padding: '7px 16px', borderRadius: 8,
            cursor: verSel.approved_at || aprobando ? 'default' : 'pointer',
            background: verSel.approved_at ? 'rgba(255,255,255,0.05)' : `${accent}22`,
            border: `1px solid ${verSel.approved_at ? 'rgba(255,255,255,0.16)' : accent + '88'}`,
            color: verSel.approved_at ? 'var(--text-3)' : accent,
            fontSize: 11.5, fontWeight: 600, fontFamily: 'var(--font-sans)', whiteSpace: 'nowrap',
            opacity: open ? 1 : 0,
            transition: `${FLIGHT}, opacity 220ms ease 140ms`,
          }}
        >{verSel.approved_at ? `v${verSel.version_number} approved` : aprobando ? 'Approving…' : `Approve v${verSel.version_number}`}</button>
      )}

      {/* La misma barra del lienzo, arriba a la izquierda del marco: abrir la hoja no debería
          quitarte las acciones que tenías sobre ella. */}
      <div
        onPointerDown={e => e.stopPropagation()}
        onDoubleClick={e => e.stopPropagation()}
        style={{
          position: 'fixed', left: box.left, top: box.top - 40,
          display: 'flex', alignItems: 'center', gap: 2, padding: 3, borderRadius: 9,
          background: 'rgba(10,12,16,0.94)', border: '1px solid rgba(255,255,255,0.16)',
          boxShadow: '0 8px 22px rgba(0,0,0,0.5)',
          opacity: open ? 1 : 0,
          transition: `${FLIGHT}, opacity 220ms ease 140ms`,
        }}
      >
        <BarraBtn titulo={notas.length ? `Notes (${notas.length})` : 'Notes'} activo={notas.length > 0} onClick={onNota}>✎</BarraBtn>
        <BarraBtn titulo="Save to my computer" onClick={() => bajarActivo(asset)}>↓</BarraBtn>
        <span style={{ width: 1, height: 16, background: 'rgba(255,255,255,0.14)', margin: '0 3px' }} />
        <BarraBtn titulo="Design edits" onClick={onDesignEdit}>✦</BarraBtn>
      </div>

      {/* Cerrar, fuera del marco */}
      <button
        onClick={close}
        title="Close (Esc)"
        style={{
          position: 'fixed',
          left: box.left + box.width + 12, top: box.top - 2,
          width: 30, height: 30, borderRadius: 8, cursor: 'pointer',
          background: 'rgba(255,255,255,0.07)', border: '1px solid rgba(255,255,255,0.18)',
          color: 'var(--text-1)', fontSize: 15, lineHeight: 1,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          opacity: open ? 1 : 0,
          transition: `${FLIGHT}, opacity 220ms ease 140ms`,
        }}
      >×</button>
    </div>
  )
}

// ── Barra de carga ───────────────────────────────────────────────────────────
// La forma es la de la referencia: la píldora de subida, el campo de prompt y el semáforo
// de contexto. Lo que hoy funciona es la subida — va a la librería DEL PROYECTO, no a un
// nodo, y acepta también documentos porque tienen su propia pestaña.
// El campo de prompt queda deshabilitado a la vista: preguntar sobre los activos toca el
// motor de nodos y es Iteración 2. Se muestra apagado en vez de simular que responde.
// ── Iconos por tipo ──────────────────────────────────────────────────────────
// Un glifo propio por tipo en vez del cuadradito genérico: en una grilla sin miniatura, el
// icono es lo único que dice qué es antes de leer.
// ── Menú de clic derecho ─────────────────────────────────────────────────────
// Dos formas según el activo, porque no piden lo mismo:
//   documento — una sola acción real, Descargar. Un popover chico alcanza.
//   visual    — el menú radial de la referencia, con las cuatro acciones de la v.3.
// Las acciones del radial todavía no hacen nada: se cablean en la Iteración 2 (contexto y
// output) y en la 3 (edición). Se muestran apagadas en vez de simular que responden.
function ContextMenu({ x, y, asset, accent, colors, onDone, onIterar, onDesignEdit }: {
  x: number; y: number; asset: UnifiedAsset; accent: string; colors: string[]
  onDone: () => void; onIterar: (a: UnifiedAsset) => void; onDesignEdit: (a: UnifiedAsset) => void
}) {
  // La descarga directa es solo para documentos; lo visual abre el radial.
  return kindOf(asset) === 'doc'
    ? <DownloadMenu x={x} y={y} asset={asset} onDone={onDone} />
    : <RadialMenu   x={x} y={y} asset={asset} accent={accent} colors={colors} onDone={onDone} onIterar={onIterar} onDesignEdit={onDesignEdit} />
}

function DownloadMenu({ x, y, asset, onDone }: {
  x: number; y: number; asset: UnifiedAsset; onDone: () => void
}) {
  const [busy, setBusy] = useState(false)

  const download = async () => {
    if (!asset.storage_url) return
    setBusy(true)
    try {
      // Pasa por el proxy del servidor: el bucket es otro origen y un <a download> directo
      // termina abriendo el archivo en vez de bajarlo.
      const res  = await fetch(`/api/proxy-image?url=${encodeURIComponent(asset.storage_url)}`)
      const blob = await res.blob()
      const href = URL.createObjectURL(blob)
      const a    = document.createElement('a')
      const ext  = asset.storage_url.match(/\.[a-z0-9]{2,5}(?=$|\?)/i)?.[0] ?? ''
      a.href = href
      a.download = (outputOf(asset) ?? asset.name).replace(/[^\w.\- ]+/g, '_') + ext
      document.body.appendChild(a); a.click(); a.remove()
      URL.revokeObjectURL(href)
    } finally {
      setBusy(false); onDone()
    }
  }

  const W = 190, H = 46
  const left = Math.min(x, window.innerWidth  - W - 12)
  const top  = Math.min(y, window.innerHeight - H - 12)

  return (
    <div data-mb-menu onClick={e => e.stopPropagation()} style={{
      position: 'fixed', left, top, zIndex: 12100, width: W,
      padding: 5, borderRadius: 10,
      background: 'var(--bg-3)', border: '1px solid var(--line-2)',
      boxShadow: '0 14px 40px rgba(0,0,0,0.55)', animation: 'mb-in 140ms ease',
    }}>
      <button
        onClick={download}
        disabled={busy || !asset.storage_url}
        onMouseEnter={e => { e.currentTarget.style.background = 'rgba(255,255,255,0.06)' }}
        onMouseLeave={e => { e.currentTarget.style.background = 'transparent' }}
        style={{
          width: '100%', display: 'flex', alignItems: 'center', gap: 9,
          padding: '8px 10px', borderRadius: 7, cursor: busy ? 'default' : 'pointer',
          background: 'transparent', border: 'none', color: 'var(--text-1)',
          fontSize: 12.5, textAlign: 'left', fontFamily: 'var(--font-sans)',
        }}
      >
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor"
             strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
          <path d="M12 3v12" /><path d="m7 11 5 5 5-5" /><path d="M4 21h16" />
        </svg>
        {busy ? 'Downloading…' : 'Download'}
      </button>
    </div>
  )
}

// El radial de la referencia: cuatro acciones en cruz —arriba, derecha, abajo, izquierda—
// separadas por diagonales, anillo con degradado de la paleta del proyecto y Forgy en el centro.
const RADIAL = [
  { key: 'edit',    label: 'Edit',          hint: 'Iteration 3', pos: 'top'    },
  { key: 'context', label: 'Add Context',   hint: 'Iteration 2', pos: 'right'  },
  { key: 'output',  label: 'Edit Output',   hint: 'Iteration 2', pos: 'bottom' },
  { key: 'library', label: 'Asset Library', hint: 'Iteration 3', pos: 'left'   },
] as const

// ── Submenú de «Edit», contextual por tipo de asset ──────────────────────────
// Definición del documento de menús radiales del equipo. La primera opción es siempre Nueva
// Iteración y la última Subir ajustes manuales, en los cinco tipos.
//
// Hoy SOLO se habilita la primera: es la única que tiene a dónde ir — vuelve a invocar el
// workflow de ComfyUI para ESA página. Las otras cuatro se muestran apagadas en vez de
// esconderse, para que se vea qué va a venir y qué no responde todavía.
const SUBMENU: Record<string, { label: string; items: string[] }> = {
  text:  { label: 'Edit Text',  items: ['New Iteration', 'Crop & extract', 'Format settings', 'Coherence & length review', 'Upload manual edits'] },
  image: { label: 'Edit 2D',    items: ['New Iteration', 'Design edits', 'New angle', 'Segmentation (masking)', 'Upload manual edits'] },
  '3d':  { label: 'Edit 3D',    items: ['New Iteration', '3D viewer (layers & maps)', 'Retexture', 'Download FBX or GLB', 'Upload manual edits'] },
  video: { label: 'Edit Video', items: ['New Iteration', 'Trim', 'Replace assets', 'Extract frames', 'Upload manual edits'] },
  audio: { label: 'Edit Audio', items: ['New Iteration', 'Trim', 'Transcribe', 'Replace track', 'Upload manual edits'] },
}
const submenuDe = (a: UnifiedAsset) => SUBMENU[kindOf(a) === 'doc' ? 'text' : kindOf(a)] ?? SUBMENU.image

// El radial principal son cuatro cuadrantes fijos; el submenú son cinco. Se calculan: un sector
// es el centro más un arco, y el arco se aproxima con puntos porque `clip-path` no traza curvas.
// El aro toma los colores del proyecto, pero solo los que tienen luz: una paleta de juego trae
// fondos casi negros (#050A14) y esos tramos se leían como mordidas en el círculo.
function anilloDe(colors: string[], accent: string): string {
  const lum = (h: string) => {
    const n = parseInt(h.replace('#', ''), 16)
    return 0.2126 * ((n >> 16) & 255) + 0.7152 * ((n >> 8) & 255) + 0.0722 * (n & 255)
  }
  const bright = colors.filter(c => /^#[0-9a-f]{6}$/i.test(c) && lum(c) > 90)
  const stops  = bright.length >= 2 ? bright : [accent, '#ffffffaa', accent]
  return `conic-gradient(from 0deg, ${[...stops, stops[0]].join(', ')})`
}

const ARCO = 10
function sectorPath(i: number, n: number): string {
  const paso = 360 / n
  const desde = -90 - paso / 2 + i * paso
  const pts = ['50% 50%']
  for (let k = 0; k <= ARCO; k++) {
    const a = ((desde + (paso * k) / ARCO) * Math.PI) / 180
    pts.push(`${(50 + 50 * Math.cos(a)).toFixed(2)}% ${(50 + 50 * Math.sin(a)).toFixed(2)}%`)
  }
  return `polygon(${pts.join(', ')})`
}
function sectorAt(i: number, n: number, radio = 0.63) {
  const a = ((-90 + i * (360 / n)) * Math.PI) / 180
  return { left: `${50 + radio * 50 * Math.cos(a)}%`, top: `${50 + radio * 50 * Math.sin(a)}%` }
}

// Cada sector es un triángulo desde el centro hacia un lado: así el hover ilumina el cuadrante
// entero y no solo la etiqueta.
const SECTOR: Record<string, string> = {
  top:    'polygon(50% 50%, 0% 0%, 100% 0%)',
  right:  'polygon(50% 50%, 100% 0%, 100% 100%)',
  bottom: 'polygon(50% 50%, 100% 100%, 0% 100%)',
  left:   'polygon(50% 50%, 0% 100%, 0% 0%)',
}
const AT: Record<string, { left: string; top: string }> = {
  top:    { left: '50%', top: '19%' },
  right:  { left: '78%', top: '50%' },
  bottom: { left: '50%', top: '81%' },
  left:   { left: '22%', top: '50%' },
}
// De dónde viene cada ítem al abrir: nacen pegados al centro y salen a su cuadrante.
const FROM: Record<string, [number, number]> = {
  top: [0, 46], right: [-46, 0], bottom: [0, -46], left: [46, 0],
}

// ── Modal de iteración ───────────────────────────────────────────────────────
// Chico y centrado: no es una pantalla de trabajo, es el aviso de que algo está corriendo.
// MUESTRA: el progreso todavía no viene del despacho real, se simula con el ritmo medido —
// 34 páginas en 220 s da ~6,5 s por página. Cuando se cablee, el porcentaje sale del job.
// Nota de un elemento: una indicación pegada a la hoja sin tocar la imagen. Vacía = se borra;
// no tiene sentido guardar una nota en blanco y que el ícono siga marcado.
function NotaModal({ asset, valor, otras, accent, onClose, onGuardar }: {
  asset: UnifiedAsset; valor: string; otras: AssetNote[]; accent: string
  onClose: () => void; onGuardar: (t: string) => void
}) {
  const [texto, setTexto] = useState(valor)
  useEffect(() => {
    const k = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', k)
    return () => window.removeEventListener('keydown', k)
  }, [onClose])
  return (
    <div onClick={onClose} style={{
      position: 'fixed', inset: 0, zIndex: 12200, display: 'flex',
      alignItems: 'center', justifyContent: 'center',
      background: 'rgba(6,7,9,0.6)', backdropFilter: 'blur(4px)',
    }}>
      <div onClick={e => e.stopPropagation()} style={{
        width: 460, padding: '18px 20px', borderRadius: 13,
        background: 'var(--bg-1)', border: '1px solid var(--line-2)',
        boxShadow: '0 24px 64px rgba(0,0,0,0.6)', display: 'flex', flexDirection: 'column', gap: 11,
      }}>
        <div>
          <div style={{ fontSize: 13.5, fontWeight: 600, color: 'var(--text-0)' }}>Notes</div>
          <div style={{ fontSize: 11, fontFamily: 'var(--font-mono)', color: 'var(--text-3)', marginTop: 2 }}>
            {nombreDeHoja(asset)}
          </div>
        </div>
        {/* Lo que dejó el resto del equipo, de más nueva a más vieja. Se lee, no se edita: la
            nota de otro no se toca, se responde con la propia. */}
        {otras.length > 0 && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 7, maxHeight: 190, overflowY: 'auto' }}>
            {[...otras]
              .sort((a, b) => (b.updated_at || '').localeCompare(a.updated_at || ''))
              .map(n => (
                <div key={n.id} style={{
                  padding: '8px 10px', borderRadius: 8,
                  background: 'var(--bg-2)', border: '1px solid var(--line-2)',
                }}>
                  <div style={{ fontSize: 10, fontFamily: 'var(--font-mono)', color: 'var(--text-3)', marginBottom: 3 }}>
                    {n.author ?? 'Someone'}
                    <span style={{ color: 'var(--text-4)' }}> · {fechaLarga(n.updated_at)}</span>
                  </div>
                  <div style={{ fontSize: 12.5, color: 'var(--text-1)', lineHeight: 1.5, whiteSpace: 'pre-wrap' }}>
                    {n.body}
                  </div>
                </div>
              ))}
          </div>
        )}

        <div style={{ fontSize: 10.5, fontFamily: 'var(--font-mono)', color: 'var(--text-3)', letterSpacing: '.04em' }}>
          {otras.length > 0 ? 'YOUR NOTE' : ''}
        </div>
        <textarea
          autoFocus value={texto} onChange={e => setTexto(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) onGuardar(texto) }}
          rows={5}
          placeholder="An indication for whoever picks this up — it does not change the image."
          style={{
            width: '100%', resize: 'vertical', padding: '10px 12px', borderRadius: 9,
            background: 'var(--bg-2)', border: '1px solid var(--line-2)', color: 'var(--text-0)',
            fontSize: 13, lineHeight: 1.5, fontFamily: 'var(--font-sans)', outline: 'none',
          }}
        />
        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
          <button onClick={onClose} style={{
            padding: '7px 15px', borderRadius: 8, cursor: 'pointer', background: 'transparent',
            border: '1px solid var(--line-2)', color: 'var(--text-2)', fontSize: 12, fontFamily: 'var(--font-mono)',
          }}>Cancel</button>
          <button onClick={() => onGuardar(texto)} style={{
            padding: '7px 15px', borderRadius: 8, cursor: 'pointer',
            background: `${accent}22`, border: `1px solid ${accent}88`, color: accent,
            fontSize: 12, fontWeight: 700, fontFamily: 'var(--font-mono)',
          }}>Save</button>
        </div>
      </div>
    </div>
  )
}

// ── Design Edits: la caja donde se pide el cambio ────────────────────────────
// Es un paso aparte y no un campo dentro del modal de progreso: acá todavía no se gastó nada, y
// el texto que se escriba es lo único que decide el resultado. Se avisa qué NO va a cambiar,
// porque el workflow conserva la plantilla a propósito y sin decirlo se pide lo imposible.
function DesignEditPrompt({ asset, accent, onClose, onSubmit }: {
  asset: UnifiedAsset; accent: string; onClose: () => void; onSubmit: (texto: string) => void
}) {
  const [texto, setTexto] = useState('')
  useEffect(() => {
    const k = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', k)
    return () => window.removeEventListener('keydown', k)
  }, [onClose])

  return (
    <div onClick={onClose} style={{
      position: 'fixed', inset: 0, zIndex: 12200, display: 'flex',
      alignItems: 'center', justifyContent: 'center',
      background: 'rgba(6,7,9,0.6)', backdropFilter: 'blur(4px)',
    }}>
      <div onClick={e => e.stopPropagation()} style={{
        width: 520, padding: '20px 22px', borderRadius: 14,
        background: 'var(--bg-1)', border: '1px solid var(--line-2)',
        boxShadow: '0 26px 70px rgba(0,0,0,0.6)',
        display: 'flex', flexDirection: 'column', gap: 12,
      }}>
        <div>
          <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--text-0)' }}>Design edits</div>
          <div style={{ fontSize: 11, fontFamily: 'var(--font-mono)', color: 'var(--text-3)', marginTop: 3 }}>
            {nombreDeHoja(asset)}
          </div>
        </div>

        <textarea
          autoFocus
          value={texto}
          onChange={e => setTexto(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey) && texto.trim()) onSubmit(texto.trim()) }}
          placeholder="Describe the design change — a character, an environment, a prop…"
          rows={4}
          style={{
            width: '100%', resize: 'vertical', padding: '10px 12px', borderRadius: 9,
            background: 'var(--bg-2)', border: '1px solid var(--line-2)', color: 'var(--text-0)',
            fontSize: 13, lineHeight: 1.5, fontFamily: 'var(--font-sans)', outline: 'none',
          }}
        />

        <div style={{ fontSize: 11, color: 'var(--text-3)', lineHeight: 1.5 }}>
          Only the design changes. The page keeps its layout, boxes, text and colours — those are
          what the rest of the pipeline reads.
        </div>

        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
          <button onClick={onClose} style={{
            padding: '7px 16px', borderRadius: 8, cursor: 'pointer',
            background: 'transparent', border: '1px solid var(--line-2)',
            color: 'var(--text-2)', fontSize: 12, fontFamily: 'var(--font-mono)',
          }}>Cancel</button>
          <button
            onClick={() => texto.trim() && onSubmit(texto.trim())}
            disabled={!texto.trim()}
            style={{
              padding: '7px 16px', borderRadius: 8,
              cursor: texto.trim() ? 'pointer' : 'default',
              background: texto.trim() ? `${accent}22` : 'transparent',
              border: `1px solid ${texto.trim() ? accent + '88' : 'var(--line-2)'}`,
              color: texto.trim() ? accent : 'var(--text-4)',
              fontSize: 12, fontWeight: 700, fontFamily: 'var(--font-mono)',
            }}>Generate</button>
        </div>
      </div>
    </div>
  )
}

function IteracionModal({ asset, projectId, pagina, accent, onClose, onListo, pedido }: {
  asset: UnifiedAsset; projectId: string; pagina: { n: number; nombre: string } | null; accent: string
  onClose: () => void; onListo: () => void
  /** Design Edits: el cambio pedido en palabras. Sin esto, se rehace la página desde su documento. */
  pedido?: string
}) {
  const [pct, setPct] = useState(0)
  const [listo, setListo] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [reintento, setReintento] = useState(0)
  // Historial real. Si el asset todavia no tiene versiones, lo que se ve hoy es la v1.
  const [vers, setVers] = useState<{ id: string | null; n: number; url: string | null }[]>(() => {
    const hist = (asset.versions ?? []).map(v => ({ id: v.id, n: v.version_number, url: v.storage_url }))
    return hist.length ? hist : [{ id: null, n: 1, url: asset.storage_url }]
  })
  const version = Math.max(...vers.map(v => v.n))
  // Que version se esta mirando. Arranca en la recien generada, que es lo que uno viene a ver.
  const [viendo, setViendo] = useState(version)
  useEffect(() => { setViendo(version) }, [version])
  const actual = vers.find(v => v.n === viendo) ?? vers[vers.length - 1]
  // Zoom del visor. Una página de guía de estilo tiene texto chico: sin acercar no se juzga.
  const [zoom, setZoom] = useState(1)
  // Proporcion real de la imagen. El modal se dimensiona a partir de ella para no mostrarla mas
  // chica de lo que se veia en la galeria, que es de donde uno viene.
  const [nat, setNat] = useState<{ w: number; h: number } | null>(null)
  const [desp, setDesp] = useState({ x: 0, y: 0 })
  const paneo = useRef<{ sx: number; sy: number; ox: number; oy: number } | null>(null)
  // Al cambiar de versión se vuelve a encuadrar: seguir con el zoom de la anterior desorienta.
  useEffect(() => { setZoom(1); setDesp({ x: 0, y: 0 }) }, [viendo])

  // El progreso se estima contra los 35 s medidos para una pagina, pero NO llega solo al final:
  // se frena en 95 y el 100 lo pone la respuesta. Una barra que se completa antes que el trabajo
  // es peor que una lenta.
  const ESPERADO = 35_000
  useEffect(() => {
    const t0 = Date.now()
    const t = setInterval(() => {
      const f = Math.min(1, (Date.now() - t0) / ESPERADO)
      setPct(p => Math.max(p, Math.min(95, f * 95)))
    }, 200)
    return () => clearInterval(t)
  }, [])

  // La iteracion real. Se dispara una sola vez al abrir.
  const lanzada = useRef(false)
  useEffect(() => {
    if (lanzada.current) return
    lanzada.current = true
    // Sin el miembro, la versión queda sin autor: las 29 que ya existen están así porque nadie
    // lo mandaba. Es el mismo id que usa el resto del front para atribuir el gasto.
    const miembro = typeof window !== 'undefined' ? localStorage.getItem('forge_member_id') : null
    const trabajo = pedido
      ? designEditAsset(projectId, asset.id, pedido, miembro)
      : iterateAssetPage(projectId, asset.id, miembro)
    trabajo
      .then(r => {
        setVers(v => [...v.filter(x => x.n !== r.version.version_number),
                      { id: r.version.id, n: r.version.version_number, url: r.version.storage_url }]
                     .sort((a, b) => a.n - b.n))
        setPct(100); setListo(true); onListo()
      })
      .catch(e => { setError(e?.message || 'The iteration could not be completed'); setPct(100) })
  }, [projectId, asset.id, onListo, reintento, pedido])

  // Tamano de la caja derivado de la proporcion de la imagen: el visor tiene que entrar entero
  // y ademas conviven la columna de miniaturas (84 + 10 de gap) y el cromo del modal (cabecera,
  // fila de estado y padding). Se acota a la ventana para no desbordarla.
  const medida = useMemo(() => {
    const CROMO_H = 132, CROMO_W = 94 + 40
    const maxW = Math.min(1240, window.innerWidth  * 0.9) - CROMO_W
    const maxH = Math.min(920,  window.innerHeight * 0.88) - CROMO_H
    const rel  = nat ? nat.w / nat.h : 16 / 10
    let vw = maxW, vh = vw / rel
    if (vh > maxH) { vh = maxH; vw = vh * rel }
    return { w: Math.round(vw + CROMO_W), h: Math.round(vh + CROMO_H) }
  }, [nat])

  // Arrastre desde la cabecera. El tamaño lo maneja CSS con `resize: both`, que ya se usa en el
  // modal de texto del chat: menos código que un manejador propio y con el mismo comportamiento.
  const [pos, setPos] = useState<{ x: number; y: number } | null>(null)
  const arrastre = useRef<{ sx: number; sy: number; ox: number; oy: number } | null>(null)
  const caja = useRef<HTMLDivElement>(null)

  // El modal esta centrado por flex y se mueve con `transform`, asi que el desplazamiento se
  // acota contra el centro. Sin esto se puede empujar arriba del borde y queda debajo de la barra
  // del navegador, desde donde ya no se recupera.
  const acotar = useCallback((x: number, y: number) => {
    const el = caja.current
    if (!el) return { x, y }
    const w = el.offsetWidth, h = el.offsetHeight
    const M = 10
    const cx = (window.innerWidth  - w) / 2
    const cy = (window.innerHeight - h) / 2
    return {
      x: Math.min(Math.max(x, M - cx), window.innerWidth  - w - M - cx),
      y: Math.min(Math.max(y, M - cy), window.innerHeight - h - M - cy),
    }
  }, [])

  const onDragStart = (e: React.MouseEvent) => {
    if ((e.target as HTMLElement).closest('button')) return
    const p = pos ?? { x: 0, y: 0 }
    arrastre.current = { sx: e.clientX, sy: e.clientY, ox: p.x, oy: p.y }
    e.preventDefault()
  }
  useEffect(() => {
    const mover = (e: MouseEvent) => {
      if (!arrastre.current) return
      const a = arrastre.current
      setPos(acotar(a.ox + e.clientX - a.sx, a.oy + e.clientY - a.sy))
    }
    const soltar = () => { arrastre.current = null }
    window.addEventListener('mousemove', mover)
    window.addEventListener('mouseup', soltar)
    return () => { window.removeEventListener('mousemove', mover); window.removeEventListener('mouseup', soltar) }
  }, [acotar])

  // Al crecer de chico a grande, o si cambia el tamano de la ventana, se vuelve a acotar: el
  // modal puede haber quedado fuera sin que nadie lo arrastre.
  useEffect(() => {
    const r = () => setPos(p => (p ? acotar(p.x, p.y) : p))
    window.addEventListener('resize', r)
    return () => window.removeEventListener('resize', r)
  }, [acotar])
  useEffect(() => { setPos(p => (p ? acotar(p.x, p.y) : p)) }, [listo, acotar])

  return (
    <div
      onClick={e => e.stopPropagation()}
      style={{
        position: 'fixed', inset: 0, zIndex: 12200, display: 'flex',
        alignItems: 'center', justifyContent: 'center',
        background: 'rgba(6,7,9,0.55)', backdropFilter: 'blur(3px)',
      }}
    >
      <div ref={caja} style={{
        // Mientras procesa alcanza con la barra: un modal grande y vacio esperando es peor que
        // uno chico que dice que esta trabajando. Crece cuando ya hay algo que mirar.
        width:  listo ? medida.w : 392,
        height: listo ? medida.h : 'auto',
        minWidth: listo ? 520 : undefined, minHeight: listo ? 420 : undefined,
        maxWidth: '94vw', maxHeight: '92vh',
        padding: '18px 20px 20px', borderRadius: 13,
        display: 'flex', flexDirection: 'column',
        // El tamano lo da el navegador; el arrastre, la cabecera.
        resize: listo ? 'both' : 'none', overflow: 'auto',
        transition: 'width 260ms ease, height 260ms ease',
        transform: pos ? `translate(${pos.x}px, ${pos.y}px)` : undefined,
        background: 'var(--bg-3)', border: '1px solid var(--line-2)',
        boxShadow: '0 22px 64px rgba(0,0,0,0.6)', animation: 'mb-in 180ms ease',
      }}>
        <div onMouseDown={onDragStart}
             style={{ display: 'flex', alignItems: 'center', gap: 9, marginBottom: 4,
                      cursor: 'move', userSelect: 'none' }}>
          <img src="/forgy/forgyi.png" alt="" width={18} height={18} style={{ objectFit: 'contain' }} />
          <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-0)' }}>
            {error ? 'Iteration failed' : listo ? 'Iteration ready' : 'Processing iteration'}
          </span>
          <div style={{ flex: 1 }} />
          <button
            onClick={onClose}
            title="Close"
            style={{
              width: 25, height: 25, borderRadius: 6, cursor: 'pointer', flexShrink: 0,
              background: 'transparent', border: '1px solid var(--line-2)',
              color: 'var(--text-2)', fontSize: 14, lineHeight: 1,
            }}
          >×</button>
        </div>

        <div style={{ fontSize: 11.5, color: 'var(--text-3)', marginBottom: 14, fontFamily: 'var(--font-mono)' }}>
          {/* Rehacer una hoja dice qué página es; un Design Edit dice qué se pidió, que es lo
              único que distingue esta versión de la anterior. */}
          {pagina
            ? `Page ${String(pagina.n).padStart(2, '0')} · ${pagina.nombre.replace(/^\d+[_\s.-]?/, '')}`
            : pedido
              ? `Design edit · ${pedido.length > 70 ? pedido.slice(0, 70) + '…' : pedido}`
              : nombreDeHoja(asset)}
        </div>

        {/* El progreso solo existe mientras corre: al terminar estorba y el resultado es lo que
            importa. */}
        {!listo && !error && (
          <>
            <div style={{
              height: 5, borderRadius: 3, overflow: 'hidden',
              background: 'rgba(255,255,255,0.07)', marginBottom: 9,
            }}>
              <div style={{
                width: `${pct}%`, height: '100%', borderRadius: 3,
                background: `linear-gradient(90deg, ${accent}88, ${accent})`,
                transition: 'width 300ms ease',
                boxShadow: `0 0 12px ${accent}66`,
              }} />
            </div>

            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <span style={{ fontSize: 10.5, color: 'var(--text-4)' }}>
                Re-running this page through its workflow…
              </span>
              <span style={{ fontSize: 10.5, color: 'var(--text-3)', fontFamily: 'var(--font-mono)' }}>
                {Math.round(pct)}%
              </span>
            </div>
          </>
        )}

        {/* Un fallo tiene que decirse. Antes se guardaba el mensaje y no se pintaba: quedaba la
            barra en 100% y nada mas, que es la peor forma de fallar. */}
        {error && (
          <div style={{ marginTop: 12 }}>
            <div style={{
              display: 'flex', gap: 9, padding: '11px 12px', borderRadius: 9,
              background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.32)',
            }}>
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="#EF4444"
                   strokeWidth="1.9" strokeLinecap="round" style={{ flexShrink: 0, marginTop: 1 }}>
                <circle cx="12" cy="12" r="9" /><path d="M12 8v5" /><path d="M12 16.5v.01" />
              </svg>
              <div style={{ minWidth: 0 }}>
                <div style={{ fontSize: 12, color: 'var(--text-1)', marginBottom: 3 }}>
                  The iteration did not complete
                </div>
                <div style={{ fontSize: 11, color: 'var(--text-3)', lineHeight: 1.5, wordBreak: 'break-word' }}>
                  {error}
                </div>
              </div>
            </div>
            <button
              onClick={() => { setError(null); setPct(0); lanzada.current = false; setReintento(r => r + 1) }}
              style={{
                marginTop: 10, width: '100%', padding: '8px 0', borderRadius: 8, cursor: 'pointer',
                background: 'transparent', border: `1px solid ${accent}66`, color: accent,
                fontSize: 12, fontFamily: 'var(--font-sans)',
              }}
            >Try again</button>
          </div>
        )}

        {/* Al terminar, la nueva queda VIGENTE pero no aprobada: aprobar es del usuario. Son dos
            estados distintos y la decisión no se toma sola.
            Se muestra UNA sola imagen y el resto se navega como páginas. Lado a lado no escala:
            a la versión 20 no hay pantalla que alcance. */}
        {listo && (
          <div style={{ marginTop: 12, flex: 1, display: 'flex', flexDirection: 'column', minHeight: 0 }}>
            {/* La generada, sola y grande; el resto como miniaturas en columna a la derecha,
                con scroll. Es lo único que escala: a la versión 20, una paginación de botones ya
                no se lee y un lado a lado no entra en pantalla. */}
            <div style={{ display: 'flex', gap: 10, flex: 1, minHeight: 0 }}>
              <div
                onWheel={e => {
                  // Rueda = zoom, sin scroll de por medio: el visor no tiene nada que scrollear.
                  const paso = e.deltaY < 0 ? 1.18 : 1 / 1.18
                  setZoom(z => Math.min(6, Math.max(1, z * paso)))
                }}
                onMouseDown={e => {
                  if (zoom <= 1) return
                  paneo.current = { sx: e.clientX, sy: e.clientY, ox: desp.x, oy: desp.y }
                  e.preventDefault()
                }}
                onMouseMove={e => {
                  if (!paneo.current) return
                  const p = paneo.current
                  setDesp({ x: p.ox + e.clientX - p.sx, y: p.oy + e.clientY - p.sy })
                }}
                onMouseUp={() => { paneo.current = null }}
                onMouseLeave={() => { paneo.current = null }}
                onDoubleClick={() => { setZoom(1); setDesp({ x: 0, y: 0 }) }}
                style={{
                  position: 'relative', flex: 1, minHeight: 0, borderRadius: 9,
                  overflow: 'hidden', background: 'var(--bg-2)',
                  border: `1px solid ${viendo === version ? accent + '88' : 'var(--line-2)'}`,
                  cursor: zoom > 1 ? (paneo.current ? 'grabbing' : 'grab') : 'zoom-in',
                }}>
                {actual?.url && (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={actual.url} alt={`v${viendo}`} draggable={false}
                       onLoad={e => {
                         const el = e.currentTarget
                         if (el.naturalWidth) setNat({ w: el.naturalWidth, h: el.naturalHeight })
                       }}
                       style={{ width: '100%', height: '100%', objectFit: 'contain',
                                transform: `translate(${desp.x}px, ${desp.y}px) scale(${zoom})`,
                                transition: paneo.current ? 'none' : 'transform 120ms ease',
                                userSelect: 'none' }} />
                )}

                {/* Solo aparece con zoom: un control permanente compite con la imagen. */}
                {zoom > 1 && (
                  <div style={{
                    position: 'absolute', right: 8, bottom: 8, display: 'flex', alignItems: 'center', gap: 6,
                    padding: '3px 8px', borderRadius: 6, pointerEvents: 'none',
                    background: 'rgba(6,7,9,0.74)', border: '1px solid rgba(255,255,255,0.14)',
                    fontSize: 9.5, fontFamily: 'var(--font-mono)', color: '#fff',
                  }}>
                    {zoom.toFixed(1)}×
                    <span style={{ opacity: 0.55 }}>double-click to reset</span>
                  </div>
                )}

              </div>

              {/* Carrusel vertical: la más nueva arriba */}
              <div style={{
                width: 84, overflowY: 'auto', overflowX: 'hidden',
                display: 'flex', flexDirection: 'column', gap: 6, paddingRight: 2,
                scrollbarWidth: 'thin',
              }}>
                {[...vers].reverse().map(({ n: v, url }) => (
                  <button
                    key={v}
                    onClick={() => setViendo(v)}
                    title={v === version ? `v${v} — current` : `v${v}`}
                    style={{
                      position: 'relative', width: '100%', aspectRatio: '4 / 3', flexShrink: 0,
                      borderRadius: 6, overflow: 'hidden', cursor: 'pointer', padding: 0,
                      background: 'var(--bg-2)',
                      border: `1px solid ${v === viendo ? accent : 'var(--line-2)'}`,
                      boxShadow: v === viendo ? `0 0 0 1px ${accent}66` : 'none',
                      opacity: v === viendo ? 1 : 0.62,
                      transition: 'opacity 140ms ease, border-color 140ms ease',
                    }}
                  >
                    {url && (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={url} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                    )}
                    <span style={{
                      position: 'absolute', left: 0, right: 0, bottom: 0,
                      fontSize: 8.5, fontFamily: 'var(--font-mono)', lineHeight: '13px',
                      background: 'rgba(6,7,9,0.78)', color: v === version ? accent : '#fff',
                    }}>v{v}</span>
                  </button>
                ))}
              </div>
            </div>

            {/* Estado y acción en la MISMA fila: el alto del modal lo tiene que gastar la imagen,
                no dos renglones de controles. */}
            {/* `paddingRight` = ancho de la columna de miniaturas (84) + su gap (10): con eso
                el borde derecho del boton cae justo sobre el borde derecho de la imagen. */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 16, paddingRight: 94 }}>
              <span style={{
                fontSize: 9.5, fontFamily: 'var(--font-mono)', fontWeight: 700, letterSpacing: '.05em',
                padding: '3px 7px', borderRadius: 4, flexShrink: 0,
                background: `${accent}1c`, color: accent, border: `1px solid ${accent}44`,
              }}>v{viendo}</span>

              {viendo === version
                ? <>
                    <span style={{ fontSize: 11, color: 'var(--text-2)', flexShrink: 0 }}>current</span>
                    <span style={{
                      fontSize: 9.5, fontFamily: 'var(--font-mono)', color: '#F59E0B', flexShrink: 0,
                      border: '1px solid color-mix(in srgb, #F59E0B 40%, transparent)',
                      borderRadius: 4, padding: '3px 7px',
                    }}>pending approval</span>
                  </>
                : <span style={{ fontSize: 11, color: 'var(--text-4)', flexShrink: 0 }}>earlier version</span>}

              <div style={{ flex: 1 }} />

              <button
                onClick={async () => {
                  const v = vers.find(x => x.n === viendo)
                  if (!v?.id) return
                  await approveAssetVersion(projectId, asset.id, v.id)
                  onListo()
                  onClose()
                }}
                style={{
                  padding: '8px 20px', borderRadius: 8, cursor: 'pointer', flexShrink: 0,
                  background: `${accent}1c`, border: `1px solid ${accent}88`, color: accent,
                  fontSize: 12.5, fontWeight: 600, fontFamily: 'var(--font-sans)',
                }}
              >Approve v{viendo}</button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

// Aviso para lo que todavía no se puede iterar. No se disfraza de error: dice qué falta.
function NoDisponible({ que, accent, onClose }: { que: string; accent: string; onClose: () => void }) {
  return (
    <div
      onClick={onClose}
      style={{
        position: 'fixed', inset: 0, zIndex: 12200, display: 'flex',
        alignItems: 'center', justifyContent: 'center',
        background: 'rgba(6,7,9,0.5)', backdropFilter: 'blur(3px)',
      }}
    >
      <div onClick={e => e.stopPropagation()} style={{
        width: 352, padding: '20px 22px', borderRadius: 13, textAlign: 'center',
        background: 'var(--bg-3)', border: '1px solid var(--line-2)',
        boxShadow: '0 22px 64px rgba(0,0,0,0.6)', animation: 'mb-in 180ms ease',
      }}>
        <div style={{
          width: 40, height: 40, borderRadius: '50%', margin: '0 auto 12px',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          background: `${accent}14`, border: `1px solid ${accent}44`,
        }}>
          <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke={accent}
               strokeWidth="1.8" strokeLinecap="round">
            <rect x="4" y="10" width="16" height="11" rx="2" /><path d="M8 10V7a4 4 0 0 1 8 0v3" />
          </svg>
        </div>
        <div style={{ fontSize: 13.5, fontWeight: 600, color: 'var(--text-0)', marginBottom: 6 }}>
          Not available yet
        </div>
        <div style={{ fontSize: 12, color: 'var(--text-3)', lineHeight: 1.55, marginBottom: 16 }}>
          Iteration currently runs on <strong style={{ color: 'var(--text-1)' }}>Art Style Guide</strong> pages,
          where a single page can be re-rendered on its own. {que}
        </div>
        <button
          onClick={onClose}
          style={{
            width: '100%', padding: '8px 0', borderRadius: 8, cursor: 'pointer',
            background: 'transparent', border: `1px solid ${accent}66`, color: accent,
            fontSize: 12, fontFamily: 'var(--font-sans)',
          }}
        >Got it</button>
      </div>
    </div>
  )
}

// Submenú de «Edit»: cinco sectores, contextual por tipo. Solo la primera opción responde.
// Vuelve al radial principal con Escape o con el botón del centro, para no dejar sin salida a
// quien entró por error.
function RadialSubmenu({ x, y, asset, accent, colors, onBack, onDone, onNewIteration, onDesignEdit }: {
  x: number; y: number; asset: UnifiedAsset; accent: string; colors: string[]
  onBack: () => void; onDone: () => void; onNewIteration: () => void; onDesignEdit: () => void
}) {
  const [shown, setShown] = useState(false)
  const [hot,   setHot]   = useState<number | null>(null)
  useEffect(() => { const r = requestAnimationFrame(() => setShown(true)); return () => cancelAnimationFrame(r) }, [])
  useEffect(() => {
    const k = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.stopPropagation(); onBack() } }
    window.addEventListener('keydown', k, true)
    return () => window.removeEventListener('keydown', k, true)
  }, [onBack])

  const cfg = submenuDe(asset)
  const N = cfg.items.length
  const R  = 172
  const cx = Math.min(Math.max(x, R + 12), window.innerWidth  - R - 12)
  const cy = Math.min(Math.max(y, R + 12), window.innerHeight - R - 12)
  const ring = anilloDe(colors, accent)

  return (
    <div
      data-mb-menu
      onClick={e => { e.stopPropagation(); onDone() }}
      style={{
        position: 'fixed', left: cx - R, top: cy - R, width: R * 2, height: R * 2, zIndex: 12110,
        transform: shown ? 'scale(1)' : 'scale(0.42)',
        opacity: shown ? 1 : 0,
        transition: 'transform 520ms cubic-bezier(0.34,1.56,0.44,1), opacity 220ms ease',
      }}
    >
      <div style={{
        position: 'absolute', inset: 0, borderRadius: '50%', background: ring,
        animation: 'mb-sweep 760ms ease-out backwards, mb-spin 11s linear 760ms infinite',
        filter: 'saturate(1.15)', boxShadow: `0 0 34px ${accent}44, 0 24px 70px rgba(0,0,0,0.6)`,
      }} />
      <div style={{
        position: 'absolute', inset: 3, borderRadius: '50%',
        background: 'radial-gradient(circle, rgba(14,17,22,0.97) 62%, rgba(14,17,22,0.9) 100%)',
        backdropFilter: 'blur(4px)',
      }} />

      {cfg.items.map((label, i) => {
        // Nueva Iteración (0) y Design Edits (1). Las otras tres siguen sin camino detrás.
        const activa = i === 0 || i === 1
        const pos = sectorAt(i, N)
        return (
          <div key={label}>
            <div
              onMouseEnter={() => setHot(i)}
              onMouseLeave={() => setHot(null)}
              // Siempre se corta la propagación: una opción bloqueada no hace nada, y menos
              // todavía cerrar el menú por el clic de fondo.
              onClick={e => { e.stopPropagation(); if (i === 0) onNewIteration(); else if (i === 1) onDesignEdit() }}
              title={i === 0 ? 'Re-run this page through its workflow'
                   : i === 1 ? 'Describe a design change and re-generate the image'
                   : `${label} — not available yet`}
              style={{
                position: 'absolute', inset: 3, borderRadius: '50%',
                clipPath: sectorPath(i, N),
                background: hot === i && activa
                  ? `radial-gradient(circle at center, ${accent}00 34%, ${accent}30 100%)`
                  : 'transparent',
                transition: 'background 160ms ease',
                cursor: activa ? 'pointer' : 'not-allowed',
              }}
            />
            <div style={{
              position: 'absolute', ...pos, transform: 'translate(-50%, -50%)',
              width: 104, textAlign: 'center', pointerEvents: 'none',
              display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 5,
              opacity: activa ? (hot === i ? 1 : 0.9) : 0.34,
              transition: 'opacity 160ms ease',
              animation: `mb-pop 480ms cubic-bezier(0.22,1,0.36,1) ${160 + i * 70}ms backwards`,
            }}>
              {!activa && (
                <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor"
                     strokeWidth="2" style={{ color: '#fff', opacity: 0.75 }}>
                  <rect x="4" y="10" width="16" height="11" rx="2" /><path d="M8 10V7a4 4 0 0 1 8 0v3" />
                </svg>
              )}
              <span style={{
                fontSize: 11, color: '#fff', lineHeight: 1.25,
                fontWeight: activa ? 600 : 400,
              }}>{label}</span>
            </div>
          </div>
        )
      })}

      {/* Centro: vuelve al menú principal */}
      <button
        onClick={e => { e.stopPropagation(); onBack() }}
        title="Back"
        style={{
          position: 'absolute', left: '50%', top: '50%', transform: 'translate(-50%, -50%)',
          width: 74, height: 74, borderRadius: '50%', cursor: 'pointer',
          display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 2,
          background: 'radial-gradient(circle, rgba(22,28,34,0.98), rgba(12,15,19,0.98))',
          border: `1px solid ${accent}aa`,
          boxShadow: `0 0 24px ${accent}66, inset 0 0 18px ${accent}22`,
          animation: 'mb-pop 520ms cubic-bezier(0.34,1.56,0.44,1) 100ms backwards',
        }}
      >
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke={accent}
             strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="m15 18-6-6 6-6" />
        </svg>
        <span style={{ fontSize: 8, color: 'var(--text-3)', fontFamily: 'var(--font-mono)', letterSpacing: '.06em' }}>
          {cfg.label.replace(/^Edit /, '').toUpperCase()}
        </span>
      </button>
    </div>
  )
}

function RadialMenu({ x, y, asset, accent, colors, onDone, onIterar, onDesignEdit }: {
  x: number; y: number; asset: UnifiedAsset; accent: string; colors: string[]
  onDone: () => void; onIterar: (a: UnifiedAsset) => void; onDesignEdit: (a: UnifiedAsset) => void
}) {
  const [shown, setShown] = useState(false)
  const [hot,   setHot]   = useState<string | null>(null)
  const [sub,   setSub]   = useState(false)
  useEffect(() => { const r = requestAnimationFrame(() => setShown(true)); return () => cancelAnimationFrame(r) }, [])

  const R  = 152
  const cx = Math.min(Math.max(x, R + 12), window.innerWidth  - R - 12)
  const cy = Math.min(Math.max(y, R + 12), window.innerHeight - R - 12)

  const ring = useMemo(() => anilloDe(colors, accent), [colors, accent])

  // El submenú REEMPLAZA al principal en vez de superponerse: dos aros girando encima del otro
  // no se leen, y el centro ya sirve de vuelta atrás.
  if (sub) return (
    <RadialSubmenu
      x={x} y={y} asset={asset} accent={accent} colors={colors}
      onBack={() => setSub(false)}
      onDone={onDone}
      onNewIteration={() => onIterar(asset)}
      onDesignEdit={() => onDesignEdit(asset)}
    />
  )

  return (
    <div
      data-mb-menu
      onClick={e => { e.stopPropagation(); onDone() }}
      style={{
        position: 'fixed', left: cx - R, top: cy - R, width: R * 2, height: R * 2, zIndex: 12100,
        // Sobrepasa apenas el tamaño final antes de asentarse: es lo que le da el golpe.
        transform: shown ? 'scale(1)' : 'scale(0.38)',
        opacity: shown ? 1 : 0,
        transition: 'transform 620ms cubic-bezier(0.34,1.56,0.44,1), opacity 260ms ease',
      }}
    >
      {/* onda de choque: sale del centro una sola vez al abrir */}
      <div style={{
        position: 'absolute', left: '50%', top: '50%', width: 10, height: 10,
        marginLeft: -5, marginTop: -5, borderRadius: '50%', pointerEvents: 'none',
        border: `2px solid ${accent}`,
        animation: 'mb-shock 950ms cubic-bezier(0.22,1,0.36,1) forwards',
      }} />
      {/* anillo de degradado, girando lento: es lo que le da vida */}
      <div style={{
        position: 'absolute', inset: 0, borderRadius: '50%', background: ring,
        // El barrido lo dibuja al aparecer; después queda el giro lento de siempre.
        animation: 'mb-sweep 880ms ease-out backwards, mb-spin 9s linear 880ms infinite',
        filter: 'saturate(1.15)',
        boxShadow: `0 0 34px ${accent}44, 0 24px 70px rgba(0,0,0,0.6)`,
      }} />
      {/* interior oscuro: deja el degradado sólo como aro */}
      <div style={{
        position: 'absolute', inset: 3, borderRadius: '50%',
        background: 'radial-gradient(circle, rgba(14,17,22,0.97) 62%, rgba(14,17,22,0.88) 100%)',
        backdropFilter: 'blur(4px)',
      }} />

      {/* divisores en diagonal */}
      {[45, 135].map(deg => (
        <div key={deg} style={{
          position: 'absolute', left: '50%', top: 12, bottom: 12, width: 1,
          background: `linear-gradient(to bottom, transparent, ${accent}55 18%, ${accent}55 82%, transparent)`,
          transform: `translateX(-0.5px) rotate(${deg}deg)`, transformOrigin: 'center',
        }} />
      ))}

      {/* sectores + etiquetas */}
      {RADIAL.map((q, i) => (
        <div key={q.key}>
          <div
            onMouseEnter={() => setHot(q.key)}
            onMouseLeave={() => setHot(null)}
            onClick={e => { if (q.key === 'edit') { e.stopPropagation(); setSub(true) } }}
            title={q.key === 'edit' ? `${q.label} — open the editing menu` : `${q.label} — coming in ${q.hint}`}
            style={{
              position: 'absolute', inset: 3, borderRadius: '50%',
              clipPath: SECTOR[q.pos],
              background: hot === q.key
                ? `radial-gradient(circle at center, ${accent}00 34%, ${accent}26 100%)`
                : 'transparent',
              transition: 'background 160ms ease',
              cursor: q.key === 'edit' ? 'pointer' : 'default',
            }}
          />
          <div style={{
            position: 'absolute', ...AT[q.pos], transform: 'translate(-50%, -50%)',
            display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 7,
            width: 96, textAlign: 'center', pointerEvents: 'none',
            opacity: hot === q.key ? 1 : 0.72,
            transition: 'opacity 160ms ease',
            // Cada uno sale del centro hacia su cuadrante, con retardo entre ellos.
            ['--dx' as string]: `${FROM[q.pos][0]}px`,
            ['--dy' as string]: `${FROM[q.pos][1]}px`,
            animation: `mb-fan 560ms cubic-bezier(0.22,1,0.36,1) ${200 + i * 105}ms backwards`,
          }}>
            <RadialIcon kind={q.key} />
            <span style={{ fontSize: 11.5, color: '#fff', lineHeight: 1.25, letterSpacing: '.01em' }}>
              {q.label}
            </span>
          </div>
        </div>
      ))}

      {/* Forgy en el centro */}
      <div style={{
        position: 'absolute', left: '50%', top: '50%', transform: 'translate(-50%, -50%)',
        width: 68, height: 68, borderRadius: '50%',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        background: 'radial-gradient(circle, rgba(22,28,34,0.98), rgba(12,15,19,0.98))',
        border: `1px solid ${accent}aa`,
        boxShadow: `0 0 24px ${accent}66, inset 0 0 18px ${accent}22`,
        animation: 'mb-pop 560ms cubic-bezier(0.34,1.56,0.44,1) 120ms backwards, mb-breathe 3.4s ease-in-out 700ms infinite',
      }}>
        <img src="/forgy/forgyi.png" alt="" width={34} height={34}
             style={{ objectFit: 'contain', pointerEvents: 'none' }} />
      </div>
    </div>
  )
}

function RadialIcon({ kind }: { kind: string }) {
  const p = {
    width: 22, height: 22, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor',
    strokeWidth: 1.5, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const,
    style: { color: '#fff' },
  }
  if (kind === 'edit')    return <svg {...p}><path d="M12 20h9" /><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z" /></svg>
  if (kind === 'context') return <svg {...p}><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" /></svg>
  if (kind === 'library') return <svg {...p}><path d="M15 3h6v6" /><path d="M10 14 21 3" /><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" /></svg>
  return <svg {...p}><path d="M8 6h13" /><path d="M8 12h13" /><path d="M8 18h13" /><path d="M3 6h.01" /><path d="M3 12h.01" /><path d="M3 18h.01" /></svg>
}

function TypeIcon({ type, accent, size = 40 }: { type: string; accent: string; size?: number }) {
  const common = {
    width: size, height: size, viewBox: '0 0 24 24', fill: 'none',
    stroke: accent, strokeWidth: 1.4, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const,
    style: { opacity: 0.85 },
  }
  if (type === 'doc') return (
    <svg {...common}>
      <path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z" />
      <path d="M14 3v5h5" /><path d="M9 13h6" /><path d="M9 17h6" /><path d="M9 9h1" />
    </svg>
  )
  if (type === '3d') return (
    <svg {...common}>
      <path d="M12 2 3 7v10l9 5 9-5V7z" /><path d="m3 7 9 5 9-5" /><path d="M12 12v10" />
    </svg>
  )
  if (type === 'audio') return (
    <svg {...common}>
      <path d="M3 12v2" /><path d="M7 8v10" /><path d="M11 4v16" />
      <path d="M15 7v10" /><path d="M19 10v4" />
    </svg>
  )
  return (
    <svg {...common}>
      <rect x="3" y="3" width="18" height="18" rx="2" />
      <circle cx="9" cy="9" r="1.6" /><path d="m21 15-5-5L5 21" />
    </svg>
  )
}

function UploadBar({ accent, uploading, hasContext, onFiles }: {
  accent: string; uploading: number; hasContext: boolean; onFiles: (f: FileList) => void
}) {
  const [last, setLast] = useState<string | null>(null)

  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: 10,
      padding: 7, borderRadius: 14, width: '100%', maxWidth: 780,
      background: 'rgba(10,12,16,0.72)', border: '1px solid var(--line-2)',
    }}>
      <label
        title="Upload images, video, audio, 3D or documents to the project library"
        style={{
          display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer', flexShrink: 0,
          padding: '8px 13px', borderRadius: 10, fontSize: 12.5,
          background: 'rgba(255,255,255,0.05)', border: '1px solid var(--line-2)',
          color: 'var(--text-1)',
        }}
      >
        <CloudIcon />
        {uploading > 0 ? `Uploading ${uploading}…` : last ?? 'Upload file'}
        <input
          type="file" multiple hidden
          accept="image/*,video/*,audio/*,.glb,.pdf,.md,.markdown,.doc,.docx,.ppt,.pptx,.txt"
          onChange={e => {
            if (e.target.files?.length) {
              setLast(e.target.files.length === 1 ? e.target.files[0].name : `${e.target.files.length} files`)
              onFiles(e.target.files)
            }
            e.target.value = ''
          }}
        />
      </label>

      {last && uploading === 0 && (
        <button onClick={() => setLast(null)} title="Clear"
                style={{
                  width: 20, height: 20, borderRadius: 5, flexShrink: 0, cursor: 'pointer',
                  background: 'transparent', border: 'none', color: 'var(--text-3)', fontSize: 13, lineHeight: 1,
                }}>×</button>
      )}

      <input
        disabled
        placeholder="Ask anything about your assets…"
        title="Coming in Iteration 2, with the node connection"
        style={{
          flex: 1, minWidth: 0, background: 'transparent', border: 'none', outline: 'none',
          color: 'var(--text-2)', fontSize: 13, fontFamily: 'var(--font-sans)',
          cursor: 'not-allowed', opacity: 0.5,
        }}
      />

      <button
        disabled
        title="Coming in Iteration 2"
        style={{
          width: 40, height: 34, borderRadius: 10, flexShrink: 0, cursor: 'not-allowed',
          background: `${accent}2e`, border: `1px solid ${accent}55`,
          color: accent, fontSize: 14, lineHeight: 1, opacity: 0.55,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
        }}
      >➤</button>

      {/* Semáforo de contexto: verde si el proyecto ya tiene material del cual tomar contexto */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, paddingRight: 6, flexShrink: 0 }}
           title={hasContext ? 'Context available in this project' : 'No assets in this project yet'}>
        <span style={{ width: 9, height: 9, borderRadius: '50%', background: hasContext ? '#f4728e33' : '#f4728e' }} />
        <span style={{ width: 9, height: 9, borderRadius: '50%', background: hasContext ? '#6ee7a8' : '#6ee7a833' }} />
      </div>
    </div>
  )
}

function CloudIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor"
         strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" style={{ opacity: 0.85 }}>
      <path d="M12 13v8" /><path d="m8 17 4-4 4 4" />
      <path d="M20.9 18.4A5 5 0 0 0 18 9h-1.3A8 8 0 1 0 4 16.7" />
    </svg>
  )
}

// ── Vista de tabla ───────────────────────────────────────────────────────────
// La grilla sirve para mirar; la tabla para encontrar. Acá el orden lo elige el usuario
// tocando la cabecera, que es lo que la grilla no puede ofrecer.
function AssetTable({ assets, accent, colors, sort, selected, onSort, onOpen, onMenu }: {
  assets: UnifiedAsset[]
  accent: string
  colors: string[]
  sort: { by: string; dir: 1 | -1 }
  selected: string | null
  onSort: (by: 'name' | 'type' | 'origin' | 'date') => void
  onOpen: (a: UnifiedAsset, from: DOMRect) => void
  onMenu: (a: UnifiedAsset, x: number, y: number) => void
}) {
  const COLS_T: { key: 'name' | 'type' | 'origin' | 'date'; label: string; w: string }[] = [
    { key: 'name',   label: 'Name',   w: '1fr'   },
    { key: 'type',   label: 'Type',   w: '90px'  },
    { key: 'origin', label: 'Source', w: '260px' },
    { key: 'date',   label: 'Created', w: '120px' },
  ]
  const grid = `44px ${COLS_T.map(c => c.w).join(' ')}`

  return (
    <div style={{ height: '100%', overflowY: 'auto' }}>
      <div style={{
        display: 'grid', gridTemplateColumns: grid, gap: 12, alignItems: 'center',
        padding: '0 10px 8px', position: 'sticky', top: 0, zIndex: 1,
        background: 'var(--bg-0)', borderBottom: '1px solid var(--line)',
      }}>
        <span />
        {COLS_T.map(c => (
          <button key={c.key} onClick={() => onSort(c.key)} style={{
            display: 'flex', alignItems: 'center', gap: 5, cursor: 'pointer',
            background: 'transparent', border: 'none', padding: '4px 0',
            fontSize: 10.5, fontFamily: 'var(--font-mono)', letterSpacing: '.06em',
            color: sort.by === c.key ? 'var(--text-1)' : 'var(--text-3)',
            textTransform: 'uppercase', textAlign: 'left',
          }}>
            {c.label}
            {sort.by === c.key && <span style={{ color: accent }}>{sort.dir === 1 ? '↑' : '↓'}</span>}
          </button>
        ))}
      </div>

      {assets.map(a => (
        <TableRow key={a.id} asset={a} accent={accent} colors={colors} grid={grid} selected={selected}
                  onOpen={onOpen} onMenu={onMenu} />
      ))}
    </div>
  )
}

// Una fila es su propio componente porque la miniatura del .glb necesita estado, y un hook no
// puede vivir dentro de un .map.
function TableRow({ asset: a, accent, colors, grid, selected, onOpen, onMenu }: {
  asset: UnifiedAsset; accent: string; colors: string[]; grid: string; selected: string | null
  onOpen: (a: UnifiedAsset, from: DOMRect) => void
  onMenu: (a: UnifiedAsset, x: number, y: number) => void
}) {
  const kind = kindOf(a)
  const glb  = useGlbThumb(kind === '3d' ? (a.storage_url ?? '') : '', a.id, rampa(colors, accent)).data
  const aud  = useAudioThumb(kind === 'audio' ? (a.storage_url ?? '') : '', a.id, vivido(colors, accent)).data

  return (
          <div
            onClick={e => onOpen(a, e.currentTarget.getBoundingClientRect())}
            onContextMenu={e => { e.preventDefault(); onMenu(a, e.clientX, e.clientY) }}
            style={{
              display: 'grid', gridTemplateColumns: grid, gap: 12, alignItems: 'center',
              padding: '7px 10px', borderRadius: 8, cursor: 'pointer',
              background: selected === a.id ? 'rgba(255,255,255,0.05)' : 'transparent',
              boxShadow: selected === a.id ? `inset 0 0 0 1px ${accent}66` : 'none',
            }}
            onMouseEnter={e => { if (selected !== a.id) e.currentTarget.style.background = 'rgba(255,255,255,0.03)' }}
            onMouseLeave={e => { if (selected !== a.id) e.currentTarget.style.background = 'transparent' }}
          >
            <div style={{
              width: 44, height: 32, borderRadius: 5, overflow: 'hidden', background: 'var(--bg-2)',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
            }}>
              {kind === 'image' && a.storage_url
                ? <img src={a.storage_url} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                : glb || aud?.img
                ? <img src={glb ?? aud!.img} alt="" style={{ width: '100%', height: '100%', objectFit: 'contain' }} />
                : <MiniIcon kind={kind} accent={kind === 'doc' || kind === '3d' ? 'var(--action)' : accent} />}
            </div>

            <span style={{
              fontSize: 12.5, color: 'var(--text-1)',
              whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
            }}>{outputOf(a) ?? a.name}</span>

            <span style={{ fontSize: 10.5, fontFamily: 'var(--font-mono)', color: 'var(--text-3)' }}>
              {kind === 'image' ? '2D' : kind === '3d' ? '3D' : kind.toUpperCase()}
            </span>

            <span style={{
              fontSize: 11.5, color: 'var(--text-2)',
              whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
            }}>{originOf(a)}</span>

            <span style={{ fontSize: 11, fontFamily: 'var(--font-mono)', color: 'var(--text-3)' }}>
              {new Date(a.created_at).toLocaleDateString()}
            </span>
          </div>
  )
}

function ViewBtn({ active, kind, onClick }: { active: boolean; kind: 'grid' | 'table'; onClick: () => void }) {
  return (
    <button onClick={onClick} title={kind === 'grid' ? 'Grid view' : 'Table view'} style={{
      width: 30, height: 28, borderRadius: 7, cursor: 'pointer',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      background: active ? 'rgba(255,255,255,0.09)' : 'transparent',
      border: `1px solid ${active ? 'var(--line-2)' : 'transparent'}`,
      color: active ? 'var(--text-0)' : 'var(--text-3)',
    }}>
      {kind === 'grid' ? (
        <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
          <rect x="3" y="3" width="8" height="8" rx="1.5" /><rect x="13" y="3" width="8" height="8" rx="1.5" />
          <rect x="3" y="13" width="8" height="8" rx="1.5" /><rect x="13" y="13" width="8" height="8" rx="1.5" />
        </svg>
      ) : (
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
          <path d="M4 6h16" /><path d="M4 12h16" /><path d="M4 18h16" />
        </svg>
      )}
    </button>
  )
}

function SearchIcon() {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
         strokeLinecap="round" style={{
           position: 'absolute', left: 9, top: '50%', transform: 'translateY(-50%)',
           color: 'var(--text-3)', pointerEvents: 'none',
         }}>
      <circle cx="11" cy="11" r="7" /><path d="m20 20-3.5-3.5" />
    </svg>
  )
}

function MiniIcon({ kind, accent }: { kind: string; accent: string }) {
  return <div style={{ transform: 'scale(0.42)' }}><TypeIcon type={kind} accent={accent} /></div>
}

function PageBtn({ label, active, disabled, onClick }: {
  label: string; active?: boolean; disabled?: boolean; onClick: () => void
}) {
  return (
    <button onClick={() => { if (!disabled) onClick() }} disabled={disabled} style={{
      minWidth: 28, height: 28, borderRadius: 7, fontSize: 12,
      cursor: disabled ? 'default' : 'pointer',
      background: active ? 'rgba(255,255,255,0.09)' : 'transparent',
      border: `1px solid ${active ? 'var(--line-2)' : 'transparent'}`,
      color: disabled ? 'var(--text-3)' : active ? 'var(--text-0)' : 'var(--text-2)',
      opacity: disabled ? 0.4 : 1,
    }}>{label}</button>
  )
}

// Marca de agua de fase, pegada al borde del área de contenido. Es el letrero de la etapa
// vecina: a la izquierda de dónde venís, a la derecha hacia dónde seguís. Va vertical y muy
// tenue porque acompaña, no compite con las tarjetas.
//
// `alcanzable` en false = el proyecto todavía no llegó ahí: se ve gris y no responde al clic.
// Si no hay fase vecina no se dibuja nada — no hay nada más a la derecha hasta que lo haya.
// Un ícono por fase. El texto vertical se descartó —el equipo lo rechazó y además obliga a girar
// la cabeza para leer dos palabras—; el nombre vive ahora en el tooltip, que es donde se lee sin
// esfuerzo y solo cuando hace falta.
function IconoFase({ clave, size = 27 }: { clave: string; size?: number }) {
  const p = { fill: 'none', stroke: 'currentColor', strokeWidth: 1.6, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const }
  const svg = (d: React.ReactNode) => (
    <svg width={size} height={size} viewBox="0 0 24 24" {...p}>{d}</svg>
  )
  switch (clave) {
    // Documentación: una hoja escrita.
    case 'doc':  return svg(<><path d="M6 3h8l4 4v14H6z" /><path d="M14 3v4h4" /><path d="M9 12h6M9 16h6" /></>)
    // Pre-producción: el plano, con su escuadra.
    case 'pre':  return svg(<><rect x="3" y="5" width="18" height="14" rx="1.5" /><path d="M7 15l4-6 3 4 1.5-2" /><path d="M3 10h4M17 5v4" /></>)
    // Producción: el engranaje, la máquina andando.
    case 'prod': return svg(<><circle cx="12" cy="12" r="3.2" /><path d="M12 3v2.4M12 18.6V21M21 12h-2.4M5.4 12H3M18.4 5.6l-1.7 1.7M7.3 16.7l-1.7 1.7M18.4 18.4l-1.7-1.7M7.3 7.3L5.6 5.6" /></>)
    // Post-producción / live-ops: la señal al aire.
    default:     return svg(<><circle cx="12" cy="12" r="2" /><path d="M8.4 8.4a5 5 0 000 7.2M15.6 8.4a5 5 0 010 7.2" /><path d="M5.6 5.6a9 9 0 000 12.8M18.4 5.6a9 9 0 010 12.8" /></>)
  }
}

function Marca({ lado, fase, alcanzable, onClick }: {
  lado: 'izq' | 'der'
  fase?: { key: string; label: string }
  alcanzable: boolean
  onClick: () => void
}) {
  const [hover, setHover] = useState(false)
  // Al caminar de fase, este mismo componente pasa a representar OTRA fase sin que el puntero se
  // mueva, así que el `onMouseLeave` nunca llega y el tooltip se quedaba abierto mostrando el
  // nombre de la fase anterior. Cambió la fase ⇒ el hover ya no significa nada.
  useEffect(() => { setHover(false) }, [fase?.key, alcanzable])
  if (!fase) return null
  const activa = alcanzable
  const izq    = lado === 'izq'
  return (
    <div
      onClick={() => { if (activa) { setHover(false); onClick() } }}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      style={{
        position: 'absolute', top: 0, bottom: 0, [izq ? 'left' : 'right']: 0,
        width: 56, display: 'flex', alignItems: 'center', justifyContent: 'center',
        cursor: activa ? 'pointer' : 'default',
        userSelect: 'none', zIndex: 1,
      }}
    >
      <div style={{ position: 'relative', display: 'flex', alignItems: 'center' }}>
        <div style={{
          width: 46, height: 46, borderRadius: 12,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          // Naranja de Forge cuando se puede ir; apagado cuando el proyecto no llegó ahí. El color
          // dice «esto se puede tocar» sin necesidad de leer nada.
          border: `1px solid ${activa ? 'color-mix(in srgb, var(--action) 45%, var(--line-2))' : 'var(--line-2)'}`,
          background: activa
            ? (hover ? 'color-mix(in srgb, var(--action) 16%, var(--bg-2))' : 'color-mix(in srgb, var(--action) 7%, var(--bg-2))')
            : 'var(--bg-2)',
          color: activa ? 'var(--action)' : 'var(--text-3)',
          opacity: activa ? (hover ? 1 : 0.85) : 0.32,
          transition: 'opacity 160ms ease, background 160ms ease, border-color 160ms ease',
        }}>
          <IconoFase clave={fase.key} />
        </div>

        {/* El nombre aparece al pasar el mouse, hacia el centro del tablero para no salirse. */}
        {hover && (
          <div style={{
            position: 'absolute', top: '50%', transform: 'translateY(-50%)',
            [izq ? 'left' : 'right']: 54, whiteSpace: 'nowrap',
            padding: '5px 9px', borderRadius: 7,
            background: 'var(--bg-3)', border: '1px solid var(--line-2)',
            boxShadow: '0 8px 22px rgba(0,0,0,0.45)',
            fontSize: 10.5, fontFamily: 'var(--font-mono)', letterSpacing: '.06em',
            color: activa ? 'var(--action)' : 'var(--text-3)',
            pointerEvents: 'none',
          }}>
            {izq ? '← ' : ''}{fase.label}{izq ? '' : ' →'}
            {!activa && (
              <span style={{ color: 'var(--text-4)' }}> · not reached yet</span>
            )}
          </div>
        )}
      </div>
    </div>
  )
}

function Empty({ text }: { text: string }) {
  return (
    <div style={{ padding: '70px 20px', textAlign: 'center', color: 'var(--text-3)', fontSize: 13, lineHeight: 1.6 }}>
      {text}
    </div>
  )
}

const KEYFRAMES = `
@keyframes mb-ripple {
  0%   { width: 10px;   height: 10px;   margin-left: -5px;   margin-top: -5px;   opacity: 0.85; }
  100% { width: 2400px; height: 2400px; margin-left: -1200px; margin-top: -1200px; opacity: 0; }
}
@keyframes mb-shimmer {
  0%   { background-position: 140% 0; }
  100% { background-position: -40% 0; }
}
@keyframes mb-mote {
  0%   { transform: translate(0, 0)          scale(1);    opacity: 0; }
  15%  { opacity: 0.42; }
  50%  { transform: translate(26px, -180px)  scale(1.15); }
  100% { transform: translate(-14px, -380px) scale(0.7);  opacity: 0; }
}
@keyframes mb-rise {
  0%   { transform: translateY(0)      scale(1);   opacity: 0; }
  12%  { opacity: 0.55; }
  100% { transform: translateY(-460px) scale(0.5); opacity: 0; }
}
@keyframes mb-fall {
  0%   { transform: translateY(0)     scale(1);   opacity: 0; }
  12%  { opacity: 0.5; }
  100% { transform: translateY(460px) scale(0.6); opacity: 0; }
}
@keyframes mb-streak {
  0%   { transform: translateX(-40px) scaleX(1);  opacity: 0; }
  15%  { opacity: 0.6; }
  100% { transform: translateX(680px) scaleX(3.5); opacity: 0; }
}
@keyframes mb-pulse {
  0%, 100% { transform: scale(1);   opacity: 0.12; }
  50%      { transform: scale(2.6); opacity: 0.5; }
}
@keyframes mb-drift {
  0%, 100% { transform: translate(0, 0)      scale(1); }
  50%      { transform: translate(22px, -16px) scale(1.07); }
}
@keyframes mb-spin {
  to { transform: rotate(360deg); }
}
@keyframes mb-sweep {
  0%   { opacity: 0; transform: rotate(-120deg) scale(0.9); filter: blur(6px) saturate(1.6); }
  60%  { opacity: 1; }
  100% { opacity: 1; transform: rotate(0deg) scale(1); filter: blur(0) saturate(1.15); }
}
@keyframes mb-fan {
  from { opacity: 0; transform: translate(calc(-50% + var(--dx)), calc(-50% + var(--dy))) scale(0.65); }
  to   { opacity: 0.72; transform: translate(-50%, -50%) scale(1); }
}
@keyframes mb-pop {
  0%   { transform: translate(-50%, -50%) scale(0.2); opacity: 0; }
  70%  { transform: translate(-50%, -50%) scale(1.18); opacity: 1; }
  100% { transform: translate(-50%, -50%) scale(1); opacity: 1; }
}
@keyframes mb-shock {
  0%   { width: 10px;  height: 10px;  margin-left: -5px;   margin-top: -5px;   opacity: 0.9; }
  100% { width: 420px; height: 420px; margin-left: -210px; margin-top: -210px; opacity: 0; }
}
@keyframes mb-breathe {
  0%, 100% { transform: translate(-50%, -50%) scale(1); }
  50%      { transform: translate(-50%, -50%) scale(1.05); }
}
@keyframes mb-aparece {
  from { opacity: 0; transform: scale(0.965); }
  to   { opacity: 1; transform: scale(1); }
}
@keyframes mb-latido {
  0%, 100% { opacity: 0.32; }
  50%      { opacity: 0.72; }
}
@keyframes mb-in {
  from { opacity: 0; transform: translateY(6px); }
  to   { opacity: 1; transform: translateY(0); }
}
`
