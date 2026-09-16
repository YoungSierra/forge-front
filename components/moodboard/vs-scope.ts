// El alcance del Vertical Slice, tal como lo define la spec de Migue del 08-09.
//
// Las NUEVE páginas del ASG: Color System (p.08) y las ocho hojas Sheet. Es el número que fijan
// los criterios de aceptación de la spec, y la agrupación NO es por disciplina —el documento de
// alcance ponía VFX, props y paleta todos bajo «Arte · Personajes»— sino por la página del ASG
// que produce cada cosa, para que el menú y las hojas del moodboard hablen el mismo idioma.
//
// Lo que no sale de una página visual —mecánicas, controles, narrativa— vive en el GDD y no se
// rastrea acá (spec §11.3).
//
// `regla` y `minimo` son texto literal del documento de alcance: no se resumen ni se reescriben
// acá. Cuando el equipo cambie el alcance, cambian ahí y se copian; inventarlos de nuestro lado
// haría que el menú prometa un criterio que el documento no dice.

export type EstadoElemento = 'pendiente' | 'en_progreso' | 'aprobado'

export type ElementoAlcance = {
  id:     string
  nombre: string
  /** «Cuánto entra», literal del documento de alcance. */
  regla:  string
  /** El mínimo obligatorio, literal. El criterio de «sí o sí» para no entregar un slice roto. */
  minimo: string
}

export type CategoriaAlcance = {
  id:     string
  nombre: string
  /** La página del ASG que la produce. Toda categoría del menú tiene una: lo que no sale de una
   *  página visual vive en el GDD y no se rastrea acá (spec §11.3). */
  pagina: string
  /** Orden de producción. Es lo único que ordena la guía. */
  orden:  number
  elementos: ElementoAlcance[]
}

export const ALCANCE_VS: CategoriaAlcance[] = [
  {
    // La paleta vive en Color System (p.08) y no en Visual DNA. Lo dice la propia spec de alcance
    // —«Paleta / materiales quedó en su página propia Color System (p.08), por ser la base que se
    // aprueba primero»— y la matriz de disparo la trata igual.
    //
    // Apuntar a la página equivocada no era un detalle: «Continue here» iluminaba Visual DNA
    // mientras la guía decía «Style · Palette». Es el punto 11 del informe v5 — el recuadro no
    // estaba desfasado, estaba en otra hoja.
    id: 'paleta', nombre: 'Color System · Palette', pagina: '08_ColorSystem', orden: 1,
    elementos: [
      { id: 'paleta_materiales', nombre: 'Palette / materials',
        regla: 'ALL of it (100%) — visual identity',
        minimo: "The game's full palette, uncut." },
    ],
  },
  {
    id: 'character', nombre: 'Character Sheet', pagina: '18_CharacterSheet', orden: 2,
    elementos: [
      { id: 'personajes', nombre: 'Characters / actors',
        regla: 'a chosen number, with a reason',
        minimo: '1 complete actor (acts on its own · takes part in the loop · appears under a condition).' },
      { id: 'modelos', nombre: 'Models per character',
        regla: '1 per actor in the slice',
        minimo: 'The hero model and one enemy.' },
      { id: 'rigs', nombre: 'Rigs + skinning',
        regla: '1 per model that moves',
        minimo: 'One rig for every character animated in the slice.' },
    ],
  },
  {
    // Los clips estaban dentro de Character Sheet, así que la guía mandaba a la p.18 a producir
    // algo que se produce en la 24. En la tabla de alcance son filas de hojas distintas.
    id: 'animation', nombre: 'Animation Sheet', pagina: '24_AnimationSheet', orden: 8,
    elementos: [
      { id: 'clips', nombre: 'Animation clips',
        regla: 'counted by listing, clip by clip',
        minimo: 'Idle + movement clips + 1 clip per loop action.' },
    ],
  },
  {
    id: 'environment', nombre: 'Environment Sheet', pagina: '19_EnvironmentSheet', orden: 3,
    elementos: [
      { id: 'entornos', nombre: 'Environments / scenes',
        regla: '1 of 4 (25%)',
        minimo: '1 mid-difficulty environment: neither the simplest nor the showpiece.' },
      { id: 'niveles', nombre: 'Levels',
        regla: 'a share of the game (max. 25%)',
        minimo: 'The levels that happen INSIDE the chosen environment.' },
      { id: 'encuentros', nombre: 'Encounters',
        regla: 'counted by listing',
        minimo: '1 encounter that triggers, plays and ends, complete.' },
      { id: 'tipos_mapa', nombre: 'Map types',
        regla: 'whichever the slice uses',
        minimo: '1 map type working start to finish.' },
    ],
  },
  {
    id: 'prop', nombre: 'Prop Sheet', pagina: '20_PropSheet', orden: 4,
    elementos: [
      { id: 'props', nombre: 'Props / scene objects',
        regla: 'a share of the game (max. 25%)',
        minimo: 'Only the objects SEEN or USED in the playable slice.' },
      { id: 'items', nombre: 'Items',
        regla: 'a share of the game (max. 25%)',
        minimo: 'Only the items without which the loop cannot be completed.' },
    ],
  },
  {
    id: 'vfx', nombre: 'VFX Sheet', pagina: '22_VFXSheet', orden: 5,
    elementos: [
      { id: 'vfx', nombre: 'VFX (visual effects)',
        regla: 'counted by listing',
        minimo: 'The main action effect + the taking-damage one.' },
    ],
  },
  {
    id: 'ui', nombre: 'UI Component Sheet', pagina: '21_UIComponentSheet', orden: 6,
    elementos: [
      { id: 'pantallas', nombre: 'Screens',
        regla: 'a share of the game (max. 25%)',
        minimo: 'The in-game screen (HUD) + the fail/defeat screen.' },
    ],
  },
  {
    id: 'audio', nombre: 'Audio Sheet', pagina: '23_AudioSheet', orden: 7,
    elementos: [
      { id: 'sfx', nombre: 'SFX',
        regla: 'a share of the game (max. 25%)',
        minimo: 'The sounds of the main loop actions.' },
      { id: 'musica', nombre: 'Music',
        regla: 'the environment theme',
        minimo: '1 track playing in the environment.' },
      { id: 'vo', nombre: 'Voice (VO)',
        regla: 'a share of the game, line by line',
        minimo: 'If there is voice, the slice ships real voice — not placeholder text.' },
    ],
  },
  {
    id: 'video_marketing', nombre: 'Video Marketing Sheet', pagina: '25_VideoMarketingSheet', orden: 9,
    elementos: [
      { id: 'video_promocional', nombre: 'Promotional video',
        regla: '1 per promotional video (conditional: only if the game declares promo)',
        minimo: 'If the scope declares promotional content: at least 1 video.' },
    ],
  },
  // Systems and gameplay, y Narrative, estaban acá y SALIERON del menú.
  //
  // No es que no importen: es que no se rastrean en esta pieza. La spec lo decide en su §11,
  // punto 3: «el menú solo lista páginas del ASG (cada una con tarjeta en el canvas);
  // jugabilidad y narrativa se gestionan en el GDD y no se rastrean aquí». Y sus criterios de
  // aceptación cuentan nueve categorías, no once.
  //
  // Tenerlas acá además falseaba el anillo global: seis elementos que este menú nunca puede
  // mover contaban dentro del porcentaje del slice.
]

// ── Qué se puede producir hoy ────────────────────────────────────────────────
//
// El motor define las cadenas de producción en `chain.service.js`: `character_sheet`,
// `prop_sheet`, `environment_sheet` y, desde el 11-09, `audio_sheet`. UI Component Sheet y VFX
// Sheet siguen sin workflow, así que `cadenaDe()` devuelve `null` a propósito para esas dos.
//
// La guía TIENE que saberlo. Su regla —«la primera categoría con progreso < 100%»— recomendaría
// VFX para siempre, porque nunca va a poder avanzar, y mandaría al equipo a una hoja donde no hay
// Run que apretar. Recomendar un callejón sin salida es peor que no recomendar nada.
//
// Vive acá y no en el motor porque es una pregunta de la interfaz: el motor ya responde «no hay
// cadena»; esto decide qué hacer con esa respuesta. Cuando Migue defina los workflows que faltan,
// se agregan a este conjunto y la guía los empieza a ofrecer sin tocar nada más.
/** Qué categorías tienen hoy una cadena de producción que se pueda correr desde el lienzo.
 *
 *  Ya no decide la guía —la spec §6 dice «la primera página con progreso < 100% en ese orden»,
 *  y saltarse una era una regla nuestra que el documento no pide—. Se conserva para la marca
 *  que avisa, dentro de la lista, cuál todavía no se puede correr: eso informa sin desviar.
 *
 *  Hoy están las nueve, así que la marca no se ve en ninguna. Se queda porque el día que entre
 *  una página nueva al alcance vuelve a hacer falta. */
export const CATEGORIAS_PRODUCIBLES = new Set([
  'paleta', 'character', 'environment', 'prop', 'audio',
  'ui', 'vfx', 'video_marketing', 'animation',
])

export const esProducible = (c: CategoriaAlcance) => CATEGORIAS_PRODUCIBLES.has(c.id)

// ── Progreso ─────────────────────────────────────────────────────────────────
const PESO: Record<EstadoElemento, number> = { pendiente: 0, en_progreso: 0.5, aprobado: 1 }

export type Estados = Record<string, EstadoElemento>

/** Clave de un elemento dentro de los estados: categoría + elemento, para que dos categorías
 *  puedan tener un elemento con el mismo nombre sin pisarse. */
export const claveDe = (catId: string, elemId: string) => `${catId}.${elemId}`

export const estadoDe = (estados: Estados, catId: string, elemId: string): EstadoElemento =>
  estados[claveDe(catId, elemId)] ?? 'pendiente'

/** Promedio del avance de los elementos de una categoría, de 0 a 1. */
export function progresoCategoria (cat: CategoriaAlcance, estados: Estados): number {
  if (!cat.elementos.length) return 0
  const t = cat.elementos.reduce((s, e) => s + PESO[estadoDe(estados, cat.id, e.id)], 0)
  return t / cat.elementos.length
}

/** El anillo global: el mismo promedio sobre los 22 elementos, no el promedio de los promedios.
 *  Promediar categorías le daría a «Style · Paleta» —un elemento— el mismo peso que a Character
 *  Sheet, que tiene cuatro. */
export function progresoGlobal (estados: Estados): number {
  const todos = ALCANCE_VS.flatMap(c => c.elementos.map(e => estadoDe(estados, c.id, e.id)))
  if (!todos.length) return 0
  return todos.reduce((s, e) => s + PESO[e], 0) / todos.length
}

// ── La guía ──────────────────────────────────────────────────────────────────
export type Guia = {
  categoria:    CategoriaAlcance
  falta:        ElementoAlcance[]
  alternativas: CategoriaAlcance[]
}

/**
 * Por dónde seguir. Es la §6 de la spec, al pie de la letra:
 *
 *   «Orden de producción = el orden de las páginas del ASG (campo order).
 *    Recomendación = la primera página con progreso < 100% en ese orden.
 *    Falta = las primeras 2 instancias no aprobadas de esa página.
 *    Alternativas = las siguientes 2–3 páginas incompletas.»
 *
 * Antes se saltaba las que todavía no tienen cadena que correr. Sonaba razonable —no mandar a
 * nadie a una hoja sin Run— pero el documento no lo pide y cambiaba el orden de producción, que
 * es lo único que la guía define. Si una página incompleta va antes, es la que toca: quien la
 * mire verá en la lista que todavía no se puede correr.
 *
 * Devuelve `null` cuando todo está aprobado.
 */
export function calcularGuia (estados: Estados): Guia | null {
  const incompletas = [...ALCANCE_VS]
    .sort((a, b) => a.orden - b.orden)
    .filter(c => progresoCategoria(c, estados) < 1)
  if (!incompletas.length) return null

  const categoria = incompletas[0]
  return {
    categoria,
    falta: categoria.elementos
      .filter(e => estadoDe(estados, categoria.id, e.id) !== 'aprobado')
      .slice(0, 2),
    alternativas: incompletas.slice(1, 4),
  }
}
