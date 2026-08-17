// Miniatura de un modelo .glb SIN bajar el modelo.
//
// Un .glb es: cabecera de 12 bytes · chunk JSON · chunk binario. El JSON declara en qué byte
// exacto del chunk binario vive cada cosa, así que se puede pedir solo lo que hace falta.
//
// Medido contra los dos modelos reales del proyecto (55,7 MB y 45,1 MB):
//   chunk JSON        1,9 KB   → entra de sobra en los primeros 64 KB
//   posiciones        3,5 MB   → ~600 ms
//   modelo completo    55 MB
//
// Se probó primero sacar una textura, que también es direccionable. No sirve: la primera imagen
// suele ser el normal map, y la de color base resuelta por el material es un ATLAS DE UVs —
// islas desparramadas, ilegible como miniatura — y pesa 18 MB. La geometría, en cambio, da la
// silueta, que es lo que uno quiere ver de un modelo.
//
// El resultado se guarda en localStorage: cada modelo se procesa una sola vez por navegador.

const CACHE_PREFIX = 'forge_glb_thumb4:'   // v4: rampa de color del proyecto
const SIZE   = 320    // lado del PNG que se genera
const HEAD   = 65536  // bytes iniciales para leer el chunk JSON

type Vista = [number, number, number]   // los dos ejes que se proyectan + el eje de profundidad

interface GltfMin {
  meshes?:      { primitives: { attributes: Record<string, number> }[] }[]
  accessors?:   { bufferView: number; count: number; byteOffset?: number; min?: number[]; max?: number[] }[]
  bufferViews?: { byteOffset?: number; byteLength: number; byteStride?: number }[]
}

const proxy = (url: string) => `/api/proxy-image?url=${encodeURIComponent(url)}`

async function rango(url: string, desde: number, hasta: number): Promise<ArrayBuffer> {
  const r = await fetch(proxy(url), { headers: { Range: `bytes=${desde}-${hasta}` } })
  if (!r.ok) throw new Error(`HTTP ${r.status}`)
  const ab = await r.arrayBuffer()
  // Si el origen ignorara el Range devolvería el archivo entero; mejor cortar que tragarse 55 MB.
  if (ab.byteLength > (hasta - desde + 1) * 2) throw new Error('el origen no respetó Range')
  return ab
}

// Qué par de ejes deja ver mejor el modelo. Se decide con el bounding box, que viaja en el JSON:
// se proyecta sobre las dos dimensiones más grandes, que es donde hay más forma que mirar.
function elegirVista(min: number[], max: number[]): Vista {
  const d = [max[0] - min[0], max[1] - min[1], max[2] - min[2]]
  const orden = [0, 1, 2].sort((a, b) => d[b] - d[a])
  const [a, b] = orden.slice(0, 2).sort((x, y) => x - y)
  return [a, b, orden[2]]   // el eje más chico queda de profundidad: se mira el lado ancho
}

// Superficie sombreada por profundidad, no nube de puntos.
//
// La primera versión pintaba densidad de puntos: se veía a través del modelo, con huecos y
// estructura interna, y leía como una radiografía rota en vez de un objeto. Acá cada píxel se
// queda con el punto MÁS CERCANO al observador — un z-buffer — y ese valor se convierte en luz.
// Lo que estaba detrás deja de sumar, aparece el volumen, y el modelo se ve sólido sin
// triangular nada ni bajar los índices (5,7 MB más).
function pintar(pos: Float32Array, [a, b, c]: Vista, rampa: Rampa): string {
  // glTF es Y arriba y mano derecha. Si el eje vertical de la proyección es Y, la pantalla crece
  // hacia abajo y hay que invertirlo. Pero en la vista de planta el eje vertical es Z, y mirando
  // desde arriba Z avanza HACIA el observador, o sea hacia abajo en pantalla: ahí no se invierte.
  // Sin esta distinción los modelos que se proyectan en planta salen de cabeza.
  const signo = b === 1 ? -1 : 1
  const SS = 2, N = SIZE * SS   // se rasteriza al doble y se promedia: bordes sin dientes

  let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity, z0 = Infinity, z1 = -Infinity
  for (let i = 0; i < pos.length; i += 3) {
    const x = pos[i + a], y = pos[i + b], z = pos[i + c]
    if (x < x0) x0 = x; if (x > x1) x1 = x
    if (y < y0) y0 = y; if (y > y1) y1 = y
    if (z < z0) z0 = z; if (z > z1) z1 = z
  }
  const cx = (x0 + x1) / 2, cy = (y0 + y1) / 2
  const esc = (N * 0.86) / Math.max(x1 - x0, y1 - y0, 1e-6)

  // Z-buffer: cada píxel se queda con el punto más cercano al observador. La salpicadura de
  // radio 2 cierra el espacio entre vértices — sin ella la superficie sale agujereada.
  const z = new Float32Array(N * N).fill(-Infinity)
  const R = 2
  for (let i = 0; i < pos.length; i += 3) {
    const px = Math.round((pos[i + a] - cx) * esc + N / 2)
    const py = Math.round(N / 2 + signo * (pos[i + b] - cy) * esc)
    const pz = pos[i + c]
    for (let dy = -R; dy <= R; dy++) for (let dx = -R; dx <= R; dx++) {
      if (dx * dx + dy * dy > R * R) continue
      const X = px + dx, Y = py + dy
      if (X < 0 || X >= N || Y < 0 || Y >= N) continue
      const k = Y * N + X
      if (pz > z[k]) z[k] = pz
    }
  }

  const cv = document.createElement('canvas')
  cv.width = cv.height = SIZE
  const ctx = cv.getContext('2d')!
  const img = ctx.createImageData(SIZE, SIZE)
  const [sr, sg, sb] = rgb(rampa.sombra)
  const [lr, lg, lb] = rgb(rampa.luz)
  const [br, bg, bb] = rgb(rampa.borde)
  const rango = Math.max(1e-6, z1 - z0)
  const zAt = (x: number, y: number) => (x < 0 || x >= N || y < 0 || y >= N) ? -Infinity : z[y * N + x]

  for (let y = 0; y < SIZE; y++) for (let x = 0; x < SIZE; x++) {
    let r = 0, g = 0, bl = 0, cob = 0
    for (let sy = 0; sy < SS; sy++) for (let sx = 0; sx < SS; sx++) {
      const X = x * SS + sx, Y = y * SS + sy, zc = zAt(X, Y)
      if (zc === -Infinity) continue
      // La normal sale de la pendiente de la profundidad: no hacen falta las normales del
      // archivo, que costarían otro range request del mismo tamaño que las posiciones.
      const zl = zAt(X - 1, Y), zr = zAt(X + 1, Y), zu = zAt(X, Y - 1), zd = zAt(X, Y + 1)
      const gx = (isFinite(zr) ? zr : zc) - (isFinite(zl) ? zl : zc)
      const gy = (isFinite(zd) ? zd : zc) - (isFinite(zu) ? zu : zc)
      const k = 26 / rango
      let nx = -gx * k, ny = -gy * k, nz = 1
      const L = Math.hypot(nx, ny, nz); nx /= L; ny /= L; nz /= L

      const dif  = Math.max(0, nx * -0.45 + ny * -0.62 + nz * 0.64)          // clave, arriba-izquierda
      const fill = Math.max(0, nx *  0.55 + ny *  0.30 + nz * 0.78) * 0.22   // relleno del otro lado
      const prof = 0.30 + 0.70 * ((zc - z0) / rango)                          // lo de atrás, más apagado
      const rim  = Math.pow(1 - nz, 3) * 0.85                                 // borde: despega del fondo
      // La luz no sube un solo color de negro a blanco: recorre la rampa de sombra a luz, y el
      // borde se suma encima. Con tres colores del proyecto el modelo deja de ser gris genérico.
      const t = Math.min(1, (0.10 + dif * 0.95 + fill) * prof)
      r  += sr + (lr - sr) * t + br * rim
      g  += sg + (lg - sg) * t + bg * rim
      bl += sb + (lb - sb) * t + bb * rim
      cob++
    }
    const o = (y * SIZE + x) * 4, tot = SS * SS
    img.data[o]     = Math.min(255, Math.round(r  / tot))
    img.data[o + 1] = Math.min(255, Math.round(g  / tot))
    img.data[o + 2] = Math.min(255, Math.round(bl / tot))
    img.data[o + 3] = Math.round(255 * cob / tot)   // el borde queda semitransparente, no dentado
  }
  ctx.putImageData(img, 0, 0)
  return cv.toDataURL('image/png')
}

function rgb(color: string): [number, number, number] {
  const m = color.match(/^#([0-9a-f]{6})$/i)
  if (m) {
    const n = parseInt(m[1], 16)
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255]
  }
  return [235, 240, 248]   // el tema puede traer un var(--…) que acá no se resuelve
}

/** Los tres colores con que se sombrea el modelo: sombra, luz y borde. Salen de la paleta del
 *  proyecto — ver `rampa()` en el moodboard — así el modelo se ve del mismo juego que el resto. */
export interface Rampa { sombra: string; luz: string; borde: string }

const RAMPA_NEUTRA: Rampa = { sombra: '#2a2f38', luz: '#eef2f7', borde: '#000000' }

// La rampa entra en la clave: si cambia la paleta, la miniatura se repinta sola.
const claveDe = (id: string, r: Rampa) => `${CACHE_PREFIX}${id}@${r.sombra}${r.luz}${r.borde}`

/** Lectura SÍNCRONA del cache. Existe para que un modelo ya calculado se pinte en el primer
 *  render: si se espera al `await`, React alcanza a pintar un frame con el ícono y se ve un
 *  parpadeo en cada montaje, aunque el dato estuviera ahí desde el principio.
 *  `undefined` = no está en cache · `null` = se intentó y este modelo no da miniatura. */
export function glbThumbCached(id: string, rampa: Rampa = RAMPA_NEUTRA): string | null | undefined {
  try {
    const hit = localStorage.getItem(claveDe(id, rampa))
    return hit === null ? undefined : hit === 'x' ? null : hit
  } catch { return undefined }
}

export async function glbThumb(url: string, id: string, rampa: Rampa = RAMPA_NEUTRA): Promise<string | null> {
  const key = claveDe(id, rampa)
  const cache = glbThumbCached(id, rampa)
  if (cache !== undefined) return cache

  try {
    const head = new DataView(await rango(url, 0, HEAD - 1))
    if (head.getUint32(0, true) !== 0x46546c67) throw new Error('no es un .glb')

    const jsonLen = head.getUint32(12, true)
    if (20 + jsonLen > head.byteLength) throw new Error('el chunk JSON no entra en la cabecera pedida')
    const json = new TextDecoder().decode(new Uint8Array(head.buffer, 20, jsonLen))
    const g: GltfMin = JSON.parse(json)
    const binStart = 20 + jsonLen + 8   // + la cabecera del propio chunk binario

    const prim = g.meshes?.[0]?.primitives?.[0]
    const acc  = prim ? g.accessors?.[prim.attributes.POSITION] : undefined
    const bv   = acc ? g.bufferViews?.[acc.bufferView] : undefined
    if (!acc || !bv || !acc.min || !acc.max) throw new Error('sin POSITION accesible')
    // Vértices intercalados con normales y UVs: leerlos sueltos daría basura.
    if (bv.byteStride && bv.byteStride !== 12) throw new Error('posiciones intercaladas')

    const desde = binStart + (bv.byteOffset ?? 0) + (acc.byteOffset ?? 0)
    const bytes = acc.count * 12
    const buf   = await rango(url, desde, desde + bytes - 1)
    const pos   = new Float32Array(buf.slice(0, Math.floor(buf.byteLength / 12) * 12))

    const data = pintar(pos, elegirVista(acc.min, acc.max), rampa)
    try { localStorage.setItem(key, data) } catch { /* se pasó la cuota */ }
    return data
  } catch {
    try { localStorage.setItem(key, 'x') } catch { /* nada */ }
    return null
  }
}
