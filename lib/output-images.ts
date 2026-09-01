import type { OutputImageItem, OutputImagesMap } from '@/lib/api'

/**
 * Une dos mapas de imágenes por (clave, índice), sin reemplazar arreglos enteros.
 *
 * Un output vive repartido entre varias sesiones de la misma instancia: la corrida de nodo entero
 * deja las suyas en la sesión general y el despacho por plan abre una sesión propia del output.
 * Mezclarlas con `{ ...a, ...b }` reemplaza la lista completa de la clave, así que la última que
 * llegue borra a la otra. Medido el 01-09 en el 2.2 — tres imágenes en la sesión enfocada y una en
 * la general; el chat enseñaba una sola y dos huecos vacíos con las imágenes ya renderizadas al
 * lado. Quien apretaba ✦ sobre un hueco pagaba un render que ya existía: así se generó la cuarta.
 *
 * Gana la entrada con más variaciones; a igualdad, la que ya estaba. Nunca se pierde una imagen
 * por el orden en que llegan las sesiones.
 */
export function unirOutputImages(base: OutputImagesMap, extra?: OutputImagesMap | null): OutputImagesMap {
  if (!extra) return base
  const out: OutputImagesMap = { ...base }
  for (const [clave, lista] of Object.entries(extra)) {
    if (!Array.isArray(lista)) continue
    const porIndice = new Map<number, OutputImageItem>((out[clave] ?? []).map(it => [it.index, it]))
    for (const it of lista) {
      const previo = porIndice.get(it.index)
      const gana = !previo || (it.variations?.length ?? 0) > (previo.variations?.length ?? 0)
      if (gana) porIndice.set(it.index, previo ? { ...previo, ...it } : it)
    }
    out[clave] = [...porIndice.values()].sort((a, b) => (a.index ?? 0) - (b.index ?? 0))
  }
  return out
}
