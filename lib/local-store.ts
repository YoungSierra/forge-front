// Escribir en localStorage sin tumbar la página.
//
// El cupo es de ~5 MB por origen y lo llena el caché de miniaturas 3D, que guarda PNG en base64
// (`forge_glb_thumb5:`) y nunca desaloja nada. Cuando se llena, CUALQUIER escritura lanza
// `QuotaExceededError` — y las que no estaban envueltas se llevaban la página entera: el 07-oct
// Migue vio «Failed to execute 'setItem' on 'Storage': Setting the value of 'forge_last_project'
// exceeded the quota» sobre una pantalla negra, y lo que se estaba guardando eran los 40 bytes del
// id y el nombre del proyecto. El que llena no es el que revienta.
//
// Acá se hacen las dos cosas: no dejar que una escritura tire la aplicación, y hacer sitio tirando
// el caché de miniaturas, que es derivado —se vuelve a calcular solo— y por eso es lo primero que
// sobra. Si aun así no cabe, se calla: perder una preferencia nunca justifica una pantalla negra.

// Los dos cachés de miniaturas —modelos 3D y medios— son lo único realmente desechable: se
// recalculan solos a partir del archivo, así que tirarlos cuesta unos milisegundos y nada más.
const PREFIJOS_DESECHABLES = ['forge_glb_thumb5:', 'forge_media_thumb3:']

/** Tira miniaturas cacheadas para hacer sitio. Devuelve cuántas quitó. */
function hacerSitio(): number {
  let quitadas = 0
  try {
    const claves: string[] = []
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i)
      if (k && PREFIJOS_DESECHABLES.some(p => k.startsWith(p))) claves.push(k)
    }
    // La mitad, no todas: vaciarlo entero obliga a recalcular cada miniatura del proyecto de una
    // vez, y eso se nota. Si con la mitad no alcanza, la siguiente vuelta tira la mitad de lo que
    // quede.
    for (const k of claves.slice(0, Math.max(1, Math.ceil(claves.length / 2)))) {
      localStorage.removeItem(k)
      quitadas++
    }
  } catch { /* ni siquiera se puede leer: no hay nada que hacer */ }
  return quitadas
}

/**
 * Guarda en localStorage. Devuelve `true` si quedó guardado.
 *
 * Nunca lanza: en una ventana privada el acceso mismo puede fallar, y un ajuste de interfaz no
 * puede ser la razón de que el usuario pierda lo que estaba haciendo.
 */
export function guardarLocal(clave: string, valor: string): boolean {
  if (typeof window === 'undefined') return false
  try {
    localStorage.setItem(clave, valor)
    return true
  } catch {
    // Casi siempre es el cupo. Se hace sitio y se reintenta — dos veces, porque la primera tanda
    // puede no bastar con un proyecto de muchos modelos.
    for (let intento = 0; intento < 2; intento++) {
      if (!hacerSitio()) break
      try {
        localStorage.setItem(clave, valor)
        return true
      } catch { /* sigue sin caber */ }
    }
    console.warn(`[local-store] no se pudo guardar «${clave}»: no hay sitio`)
    return false
  }
}
