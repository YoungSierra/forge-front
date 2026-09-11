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
    id: 'paleta', nombre: 'Style · Paleta', grupo: 'asg', pagina: '02_VisualDNA', orden: 1,
    elementos: [
      { id: 'paleta_materiales', nombre: 'Paleta / materiales',
        regla: 'TODO (100%) — identidad visual',
        minimo: 'La paleta completa del juego, sin recortes.' },
    ],
  },
  {
    id: 'character', nombre: 'Character Sheet', grupo: 'asg', pagina: '18_CharacterSheet', orden: 2,
    elementos: [
      { id: 'personajes', nombre: 'Personajes / actores',
        regla: 'cantidad elegida y justificada',
        minimo: '1 actor completo (hace algo solo · participa en el ciclo · aparece por condición).' },
      { id: 'modelos', nombre: 'Modelos por personaje',
        regla: '1 por actor del slice',
        minimo: 'El modelo del héroe y el de 1 enemigo.' },
      { id: 'rigs', nombre: 'Rigs + skinning',
        regla: '1 por modelo que se mueve',
        minimo: 'Un rig por cada personaje que se anima en el slice.' },
      { id: 'clips', nombre: 'Clips de animación',
        regla: 'se cuenta listando, clip por clip',
        minimo: 'Idle + clips de moverse + 1 clip por cada acción del ciclo.' },
    ],
  },
  {
    id: 'environment', nombre: 'Environment Sheet', grupo: 'asg', pagina: '19_EnvironmentSheet', orden: 3,
    elementos: [
      { id: 'entornos', nombre: 'Entornos / escenas',
        regla: '1 de 4 (25%)',
        minimo: '1 entorno de dificultad media: ni el más simple ni el espectacular.' },
      { id: 'niveles', nombre: 'Niveles',
        regla: 'una parte del juego (máx. 25%)',
        minimo: 'Los niveles que ocurren DENTRO del entorno elegido.' },
      { id: 'encuentros', nombre: 'Encuentros',
        regla: 'se cuenta listando',
        minimo: '1 encuentro que se activa, se juega y termina, completo.' },
      { id: 'tipos_mapa', nombre: 'Tipos de mapa',
        regla: 'los que el tramo use',
        minimo: '1 tipo de mapa funcionando de inicio a fin.' },
    ],
  },
  {
    id: 'prop', nombre: 'Prop Sheet', grupo: 'asg', pagina: '20_PropSheet', orden: 4,
    elementos: [
      { id: 'props', nombre: 'Props / objetos de escena',
        regla: 'una parte del juego (máx. 25%)',
        minimo: 'Solo los objetos que se VEN o se USAN en el tramo jugable.' },
      { id: 'items', nombre: 'Ítems',
        regla: 'una parte del juego (máx. 25%)',
        minimo: 'Solo los ítems sin los cuales el ciclo no se puede completar.' },
    ],
  },
  {
    id: 'vfx', nombre: 'VFX Sheet', grupo: 'asg', pagina: '22_VFXSheet', orden: 5,
    elementos: [
      { id: 'vfx', nombre: 'VFX (efectos visuales)',
        regla: 'se cuenta listando',
        minimo: 'El efecto de la acción principal + el de recibir daño.' },
    ],
  },
  {
    id: 'ui', nombre: 'UI Component Sheet', grupo: 'asg', pagina: '21_UIComponentSheet', orden: 6,
    elementos: [
      { id: 'pantallas', nombre: 'Pantallas',
        regla: 'una parte del juego (máx. 25%)',
        minimo: 'La pantalla de juego (HUD) + la pantalla de fallo/derrota.' },
    ],
  },
  {
    id: 'audio', nombre: 'Audio Sheet', grupo: 'asg', pagina: '23_AudioSheet', orden: 7,
    elementos: [
      { id: 'sfx', nombre: 'SFX',
        regla: 'una parte del juego (máx. 25%)',
        minimo: 'Los sonidos de las acciones del ciclo principal.' },
      { id: 'musica', nombre: 'Música',
        regla: 'el tema del entorno',
        minimo: '1 pista sonando en el entorno.' },
      { id: 'vo', nombre: 'Voces (VO)',
        regla: 'una parte del juego, por línea',
        minimo: 'Si hay voces, el slice lleva voces reales — no texto provisional.' },
    ],
  },
  {
    id: 'sistemas', nombre: 'Sistemas y jugabilidad', grupo: 'gdd', pagina: null, orden: 8,
    elementos: [
      { id: 'mecanicas', nombre: 'Mecánicas',
        regla: 'TODO lo del entorno elegido (100%)',
        minimo: 'Cada mecánica que ese entorno usa, sin excepción.' },
      { id: 'controles', nombre: 'Controles',
        regla: 'TODO el verbo (100%)',
        minimo: 'Todos los botones del ciclo principal funcionan.' },
      { id: 'feedback', nombre: 'Feedback',
        regla: 'se cuenta listando',
        minimo: 'El juego RESPONDE (visual o sonido) a la acción principal y al daño.' },
      { id: 'progresion', nombre: 'Progresión / economía',
        regla: 'el tramo del slice, con números',
        minimo: 'La subida de dificultad de esos niveles, escrita con números.' },
    ],
  },
  {
    id: 'narrativa', nombre: 'Narrativa', grupo: 'gdd', pagina: null, orden: 9,
    elementos: [
      { id: 'historia', nombre: 'Historia / escenas',
        regla: 'el beat del entorno',
        minimo: 'Lo mínimo de historia para que el tramo tenga sentido solo.' },
      { id: 'dialogo', nombre: 'Diálogo',
        regla: 'una parte del juego (máx. 25%)',
        minimo: 'Solo las conversaciones de ese tramo.' },
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
