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
 * Gana la más RECIENTE, por la fecha que lleva el nombre del archivo (`…-<índice>-<ms>.png`). Antes
 * ganaba la de más variaciones y, a igualdad, la que ya estaba: JM, 21-10, rehízo imágenes desde el
 * hilo (una variación, en la general) y seguía viendo las del primer despacho (una variación, en la
 * del output). Sin fecha legible se cae a la regla de antes. Igual que utils/output-images del back.
 */
const instanteDe = (it: OutputImageItem): number => {
  let t = 0
  for (const v of it.variations ?? []) {
    if ((v as { deleted?: boolean }).deleted) continue
    const m = /-(\d{13})\.[a-z0-9]+(?:\?|$)/i.exec(String(v.url ?? ''))
    if (m) t = Math.max(t, Number(m[1]))
  }
  return t
}

const ganaSobre = (nuevo: OutputImageItem, previo?: OutputImageItem): boolean => {
  if (!previo) return true
  const tn = instanteDe(nuevo), tp = instanteDe(previo)
  if (tn && tp && tn !== tp) return tn > tp
  return (nuevo.variations?.length ?? 0) > (previo.variations?.length ?? 0)
}

export function unirOutputImages(base: OutputImagesMap, extra?: OutputImagesMap | null): OutputImagesMap {
  if (!extra) return base
  const out: OutputImagesMap = { ...base }
  for (const [clave, lista] of Object.entries(extra)) {
    if (!Array.isArray(lista)) continue
    // Engine v1.10 — A1: la entrada que trae `id` se une por su id (tras iterar, la misma imagen puede estar en otra
    // posición); sin id, por índice como hasta ahora.
    const claveDe = (it: OutputImageItem) => ((it.id ?? it.name) ? `id:${it.id ?? it.name}` : `i:${it.index}`)
    const porIndice = new Map<string, OutputImageItem>((out[clave] ?? []).map(it => [claveDe(it), it]))
    for (const it of lista) {
      const previo = porIndice.get(claveDe(it))
      if (ganaSobre(it, previo)) porIndice.set(claveDe(it), previo ? { ...previo, ...it } : it)
    }
    out[clave] = [...porIndice.values()].sort((a, b) => (a.index ?? 0) - (b.index ?? 0))
  }
  return out
}
