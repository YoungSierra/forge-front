// Cuántas imágenes declara un output — la misma regla que el back (`src/services/image-count.js`).
//
// Desde v2.9.31 `image_count` tiene dos formas: un entero cuando la cantidad es fija, y
// `{ min, max, per }` cuando depende de un hermano (los pilares, las pantallas, las entradas del
// plan). Leerlo como número, que es lo que hacía el botón RENDER, imprime «[object Object]».

export type CuentaDeclarada = number | { min?: number; max?: number; per?: string } | null | undefined

export type Cuenta = { min: number; max: number; per: string | null }

export function cuantasDeclara(v: CuentaDeclarada): Cuenta | null {
  if (v == null) return null
  if (typeof v === 'number' && Number.isFinite(v)) return { min: v, max: v, per: null }
  if (typeof v === 'object') {
    const min = Number(v.min), max = Number(v.max)
    if (!Number.isFinite(min) && !Number.isFinite(max)) return null
    return {
      min: Number.isFinite(min) ? min : max,
      max: Number.isFinite(max) ? max : min,
      per: v.per ?? null,
    }
  }
  const n = Number(v)
  return Number.isFinite(n) ? { min: n, max: n, per: null } : null
}

// El techo. Es lo que se usa para medir el avance: con «3–5» la barra tiene que llegar a 5.
export const techoDeclarado = (v: CuentaDeclarada): number => cuantasDeclara(v)?.max ?? 0

// Cómo se le dice a una persona: «1 image», «3–5 images», o nada si no se declaró.
export function textoDeCuenta(v: CuentaDeclarada): string | null {
  const c = cuantasDeclara(v)
  if (!c) return null
  if (c.min === c.max) return `${c.min} image${c.min === 1 ? '' : 's'}`
  return `${c.min}–${c.max} images`
}
