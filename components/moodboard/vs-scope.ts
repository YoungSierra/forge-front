// El alcance del Vertical Slice, tal como lo define la spec de Migue del 08-09.
//
// Nueve categorías y veintidós elementos. La agrupación NO es por disciplina —el documento de
// alcance ponía VFX, props y paleta todos bajo «Arte · Personajes»— sino por la página del ASG que
// produce cada cosa, para que el menú y las hojas del moodboard hablen el mismo idioma. Lo que no
// sale de una página visual —mecánicas, controles, narrativa— se agrupa aparte como GDD y no lleva
// tarjeta en el lienzo.
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
  grupo:  'asg' | 'gdd'
  /** La página del ASG que la produce. `null` en las categorías GDD. */
  pagina: string | null
  /** Orden de producción. Es lo único que ordena la guía. */
  orden:  number
  elementos: ElementoAlcance[]
}

export const ALCANCE_VS: CategoriaAlcance[] = [
  {
    id: 'paleta', nombre: 'Style · Palette', grupo: 'asg', pagina: '02_VisualDNA', orden: 1,
    elementos: [
      { id: 'paleta_materiales', nombre: 'Palette / materials',
        regla: 'ALL of it (100%) — visual identity',
        minimo: "The game's full palette, uncut." },
    ],
  },
  {
    id: 'character', nombre: 'Character Sheet', grupo: 'asg', pagina: '18_CharacterSheet', orden: 2,
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
      { id: 'clips', nombre: 'Animation clips',
        regla: 'counted by listing, clip by clip',
        minimo: 'Idle + movement clips + 1 clip per loop action.' },
    ],
  },
  {
    id: 'environment', nombre: 'Environment Sheet', grupo: 'asg', pagina: '19_EnvironmentSheet', orden: 3,
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
    id: 'prop', nombre: 'Prop Sheet', grupo: 'asg', pagina: '20_PropSheet', orden: 4,
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
    id: 'vfx', nombre: 'VFX Sheet', grupo: 'asg', pagina: '22_VFXSheet', orden: 5,
    elementos: [
      { id: 'vfx', nombre: 'VFX (visual effects)',
        regla: 'counted by listing',
        minimo: 'The main action effect + the taking-damage one.' },
    ],
  },
  {
    id: 'ui', nombre: 'UI Component Sheet', grupo: 'asg', pagina: '21_UIComponentSheet', orden: 6,
    elementos: [
      { id: 'pantallas', nombre: 'Screens',
        regla: 'a share of the game (max. 25%)',
        minimo: 'The in-game screen (HUD) + the fail/defeat screen.' },
    ],
  },
  {
    id: 'audio', nombre: 'Audio Sheet', grupo: 'asg', pagina: '23_AudioSheet', orden: 7,
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
    id: 'sistemas', nombre: 'Systems and gameplay', grupo: 'gdd', pagina: null, orden: 8,
    elementos: [
      { id: 'mecanicas', nombre: 'Mechanics',
        regla: 'ALL of the chosen environment (100%)',
        minimo: 'Every mechanic that environment uses, without exception.' },
      { id: 'controles', nombre: 'Controls',
        regla: 'The whole verb (100%)',
        minimo: 'Every button of the main loop works.' },
      { id: 'feedback', nombre: 'Feedback',
        regla: 'counted by listing',
        minimo: 'The game ANSWERS (visually or with sound) to the main action and to damage.' },
      { id: 'progresion', nombre: 'Progression / economy',
        regla: "the slice's stretch, with numbers",
        minimo: 'The difficulty ramp of those levels, written with numbers.' },
    ],
  },
  {
    id: 'narrativa', nombre: 'Narrative', grupo: 'gdd', pagina: null, orden: 9,
    elementos: [
      { id: 'historia', nombre: 'Story / scenes',
        regla: 'the environment beat',
        minimo: 'The least story that makes the slice stand on its own.' },
      { id: 'dialogo', nombre: 'Dialogue',
        regla: 'a share of the game (max. 25%)',
        minimo: 'Only the conversations of that stretch.' },
    ],
  },
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
export const CATEGORIAS_PRODUCIBLES = new Set(['paleta', 'character', 'environment', 'prop', 'audio'])

export const esProducible = (c: CategoriaAlcance) =>
  c.grupo === 'gdd' || CATEGORIAS_PRODUCIBLES.has(c.id)

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
  /** Categorías incompletas que hoy no se pueden producir. Se nombran para que el equipo sepa
   *  que existen y por qué no se ofrecen — callarlas las volvería invisibles. */
  bloqueadas:   CategoriaAlcance[]
}

/**
 * Por dónde seguir: la primera categoría incompleta en orden de producción, saltando las que no
 * pueden producirse todavía. `falta` son sus dos primeros elementos sin aprobar; `alternativas`,
 * las siguientes tres incompletas que sí se pueden correr.
 *
 * Devuelve `null` cuando todo está aprobado.
 */
export function calcularGuia (estados: Estados): Guia | null {
  const incompletas = [...ALCANCE_VS]
    .sort((a, b) => a.orden - b.orden)
    .filter(c => progresoCategoria(c, estados) < 1)
  if (!incompletas.length) return null

  const disponibles = incompletas.filter(esProducible)
  const bloqueadas  = incompletas.filter(c => !esProducible(c))
  // Todo lo que queda está bloqueado: no se inventa una recomendación. La franja lo dice y nombra
  // qué falta destrabar, que es la información que sí sirve.
  if (!disponibles.length) {
    return { categoria: bloqueadas[0], falta: [], alternativas: [], bloqueadas }
  }

  const categoria = disponibles[0]
  return {
    categoria,
    falta: categoria.elementos
      .filter(e => estadoDe(estados, categoria.id, e.id) !== 'aprobado')
      .slice(0, 2),
    alternativas: disponibles.slice(1, 4),
    bloqueadas,
  }
}
