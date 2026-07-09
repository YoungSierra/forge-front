// Orden jerárquico de node_keys: "3.2" va ANTES de "3.10" (no lexicográfico ni decimal).
// parseFloat fallaba porque "3.10"→3.1 y "3.2"→3.2. Compara segmento a segmento como
// enteros; desempata por string para tolerar sufijos legacy (ej. "3.4b").
export function compareNodeKey(a: string, b: string): number {
  const pa = a.split('.'), pb = b.split('.')
  const len = Math.max(pa.length, pb.length)
  for (let i = 0; i < len; i++) {
    const na = parseInt(pa[i] ?? '0', 10), nb = parseInt(pb[i] ?? '0', 10)
    if (na !== nb) return na - nb
    if ((pa[i] ?? '') !== (pb[i] ?? '')) return (pa[i] ?? '').localeCompare(pb[i] ?? '')
  }
  return 0
}
