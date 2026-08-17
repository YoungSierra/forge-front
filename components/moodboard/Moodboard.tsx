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
import { getProjectMedia, getAssetContent, uploadLibraryAsset, NEUTRAL_THEME, type MoodboardTheme, type UnifiedAsset } from '@/lib/api'

// ── Pestañas ─────────────────────────────────────────────────────────────────
// El juego es el de la referencia. Las que no tienen activos se muestran apagadas en vez de
// esconderse: la barra no cambia de forma entre proyectos y se ve qué tipos faltan por producir.
const TABS: { key: string; label: string; formats: string[] }[] = [
  { key: 'concept', label: 'Concept Art', formats: ['image', 'png', 'jpg', 'jpeg'] },
  { key: '3d',      label: '3D',          formats: ['model_3d', 'glb'] },
  { key: 'audio',   label: 'Audio',       formats: ['audio'] },
  { key: 'video',   label: 'Video',       formats: ['video', 'mp4'] },
  { key: 'docs',    label: 'Docs',        formats: ['document', 'docx', 'pdf', 'pptx', 'md', 'markdown'] },
]

// El asset se guarda como "<título del nodo> — <label del output>", así que el output es lo
// que va después del guion largo. Para un documento es el dato que lo identifica: dos ADI
// distintos comparten nodo y solo se diferencian por ahí.
const outputOf = (a: UnifiedAsset) => {
  const parts = String(a.name || '').split('—')
  return parts.length > 1 ? parts[parts.length - 1].trim() : null
}

// Qué pestaña: siempre por tipo. La procedencia es el otro eje y vive en el selector de origen.
const tabOf = (a: UnifiedAsset) =>
  TABS.find(t => t.formats.includes(String(a.format).toLowerCase()))?.key ?? 'concept'

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

const COLS = 4   // como la referencia
const ROWS = 3   // 4 x 3 = 12 en pantalla, sin scroll vertical

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

  useEffect(() => { setPage(0) }, [tab, node, cols, query, view])

  // Cuánto subió el usuario al proyecto: es el contador del chip de Refs.
  const refCount = useMemo(() => assets.filter(a => a.source === 'library').length, [assets])

  // Nodos presentes, ordenados por clave (3.2 antes que 3.13, no alfabético)
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
      const okOrigin = node === 'all'     ? true
                     : node === 'library' ? a.source === 'library'
                     :                      a.node_key === node
      if (!okOrigin) return false
      if (!q) return true
      // Se busca por lo que el usuario ve: nombre, output, y el nodo con su título.
      return [a.name, outputOf(a), a.node_key, a.node_title]
        .filter(Boolean).join(' ').toLowerCase().includes(q)
    })
  }, [assets, node, query])

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

    if (tab !== 'all') return base
    return [...base].sort((a, b) =>
      rankOf(a) - rankOf(b) ||
      new Date(b.created_at).getTime() - new Date(a.created_at).getTime())
  }, [shownSet, tab, view, sort])

  // La página es exactamente lo que entra en pantalla: 3 filas de `cols`. Así nunca hay que
  // scrollear dentro de una página — se pasa a la siguiente.
  const perPage = view === 'table' ? 14 : cols * ROWS
  const pages   = Math.max(1, Math.ceil(filtered.length / perPage))
  const visible = filtered.slice(page * perPage, (page + 1) * perPage)

  // La animación nace en el botón: el panel escala desde ese punto en vez de aparecer centrado.
  const ox = origin ? `${origin.x}px` : '100%'
  const oy = origin ? `${origin.y}px` : '100%'

  return (
    // El fondo no cierra el moodboard: es un espacio de trabajo, no un aviso. Se sale por la X.
    <div
      style={{
        position: 'fixed', inset: 0, zIndex: 1200,   // por encima del widget de Feedback (900)
        background: entered ? 'rgba(6,7,9,0.74)' : 'rgba(6,7,9,0)',
        backdropFilter: entered ? 'blur(7px)' : 'blur(0px)',
        transition: 'background 380ms ease, backdrop-filter 380ms ease',
        display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 22,
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
        width: '100%', height: '100%', maxWidth: 1720,
        background: 'linear-gradient(160deg, rgba(30,33,42,0.96) 0%, rgba(16,18,24,0.98) 55%, rgba(12,14,19,0.99) 100%)',
        border: '1px solid rgba(255,255,255,0.10)', borderRadius: 16,
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

          {/* Refs a la vista como chip: es un origen, no un tipo, pero sigue a un clic. */}
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
              Refs
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
            {nodes.map(([k, title]) => <option key={k} value={k}>{k} · {title}</option>)}
          </select>
        </div>

        {/* ── Grid ─────────────────────────────────────────────────────── */}
        <div style={{ flex: 1, minHeight: 0, overflow: 'hidden', padding: 18, position: 'relative' }}>
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
            <div style={{
              display: 'grid', gap: 16, height: '100%',
              gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))`,
              gridTemplateRows:    `repeat(${ROWS}, minmax(0, 1fr))`,
            }}>
              {visible.map((a, i) => (
                <Card key={a.id} asset={a} index={i} accent={theme.accent} colors={theme.colors}
                      selected={sel === a.id}
                      onOpen={(from) => { setSel(a.id); setDetail({ asset: a, from }) }}
                      onMenu={(x, y) => setMenu({ x, y, asset: a })} />
              ))}
            </div>
          )}
        </div>

        {/* ── Pie: paginación a la izquierda, barra de carga al centro ────── */}
        <div style={{
          display: 'flex', alignItems: 'center', gap: 10, position: 'relative',
          padding: '12px 18px', borderTop: '1px solid var(--line)',
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 4, minWidth: 200 }}>
            {pages > 1 && (
              <>
                <PageBtn label="←" disabled={page === 0} onClick={() => setPage(p => p - 1)} />
                {Array.from({ length: pages }, (_, i) => (
                  <PageBtn key={i} label={String(i + 1)} active={i === page} onClick={() => setPage(i)} />
                ))}
                <PageBtn label="→" disabled={page >= pages - 1} onClick={() => setPage(p => p + 1)} />
              </>
            )}
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

      {menu && <ContextMenu {...menu} accent={theme.accent} colors={theme.colors} onDone={() => setMenu(null)} />}

      {detail && <Detail asset={detail.asset} from={detail.from}
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
        position: 'relative', minHeight: 0, borderRadius: 12, overflow: 'hidden',
        cursor: 'pointer', background: 'var(--bg-2)',
        border: `1px solid ${selected ? accent : hover ? 'rgba(255,255,255,0.18)' : 'rgba(255,255,255,0.07)'}`,
        boxShadow: selected ? `0 0 0 1px ${accent}, 0 0 26px ${accent}33` : 'none',
        transition: 'border-color 150ms ease, box-shadow 150ms ease, transform 150ms ease',
        transform: hover && !selected ? 'translateY(-2px)' : 'none',
        animation: `mb-in 320ms ease ${index * 32}ms backwards`,
      }}
    >
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

      {/* Scrim + procedencia. El nombre completo del activo se ve al traerlo al frente:
          en la grilla repetía el nodo que ya dice la línea de abajo y tapaba la imagen. */}
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
          {` · ${originOf(asset)}`}
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
function Detail({ asset, from, onMenu, onClose }: {
  asset: UnifiedAsset; from: DOMRect; onMenu: (x: number, y: number) => void; onClose: () => void
}) {
  const t   = kindOf(asset)
  const url = asset.storage_url ?? ''
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
        position: 'fixed', inset: 0, zIndex: 1250,
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
        onContextMenu={e => { e.preventDefault(); e.stopPropagation(); onMenu(e.clientX, e.clientY) }}
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
        <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--text-0)' }}>{asset.name}</div>
        <div style={{ fontSize: 11, fontFamily: 'var(--font-mono)', color: 'var(--text-3)', marginTop: 3 }}>
          {asset.node_key ? `${asset.node_key} · ${asset.node_title}` : asset.source}
          {' · '}{new Date(asset.created_at).toLocaleDateString()}
        </div>
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
function ContextMenu({ x, y, asset, accent, colors, onDone }: {
  x: number; y: number; asset: UnifiedAsset; accent: string; colors: string[]; onDone: () => void
}) {
  // La descarga directa es solo para documentos; lo visual abre el radial.
  return kindOf(asset) === 'doc'
    ? <DownloadMenu x={x} y={y} asset={asset} onDone={onDone} />
    : <RadialMenu   x={x} y={y} asset={asset} accent={accent} colors={colors} onDone={onDone} />
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
      position: 'fixed', left, top, zIndex: 1300, width: W,
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

function RadialMenu({ x, y, asset, accent, colors, onDone }: {
  x: number; y: number; asset: UnifiedAsset; accent: string; colors: string[]; onDone: () => void
}) {
  const [shown, setShown] = useState(false)
  const [hot,   setHot]   = useState<string | null>(null)
  useEffect(() => { const r = requestAnimationFrame(() => setShown(true)); return () => cancelAnimationFrame(r) }, [])

  const R  = 152
  const cx = Math.min(Math.max(x, R + 12), window.innerWidth  - R - 12)
  const cy = Math.min(Math.max(y, R + 12), window.innerHeight - R - 12)

  // El aro toma los colores del proyecto, pero solo los que tienen luz: una paleta de juego
  // trae fondos casi negros (#050A14) y esos tramos se leían como mordidas en el círculo.
  const ring = useMemo(() => {
    const lum = (h: string) => {
      const n = parseInt(h.replace('#', ''), 16)
      return 0.2126 * ((n >> 16) & 255) + 0.7152 * ((n >> 8) & 255) + 0.0722 * (n & 255)
    }
    const bright = colors.filter(c => /^#[0-9a-f]{6}$/i.test(c) && lum(c) > 90)
    const stops  = bright.length >= 2 ? bright : [accent, '#ffffffaa', accent]
    return `conic-gradient(from 0deg, ${[...stops, stops[0]].join(', ')})`
  }, [colors, accent])

  return (
    <div
      data-mb-menu
      onClick={e => { e.stopPropagation(); onDone() }}
      style={{
        position: 'fixed', left: cx - R, top: cy - R, width: R * 2, height: R * 2, zIndex: 1300,
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
            title={`${q.label} — coming in ${q.hint}`}
            style={{
              position: 'absolute', inset: 3, borderRadius: '50%',
              clipPath: SECTOR[q.pos],
              background: hot === q.key
                ? `radial-gradient(circle at center, ${accent}00 34%, ${accent}26 100%)`
                : 'transparent',
              transition: 'background 160ms ease',
              cursor: 'default',
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
