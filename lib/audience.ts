// ─── Engine v1.9 · para quién es cada output ────────────────────────────────────────────────
// La DNA dice `audience: "document"` (se muestra como documento) o `"internal"` (datos para el motor y el
// nodo siguiente: planes, sobres de imagen, connections). Sin el campo, el mismo defecto que aplica el
// back (vista-documento.service.js): una connection, una imagen o un formato de datos es internal; un
// documento (markdown, docx, pdf, pptx…) es document.

export type Audience = 'document' | 'internal'

export type OutputDef = {
  key?: string
  name?: string
  label?: string
  type?: string
  format?: string
  image_gen?: boolean
  audience?: string
}

const FORMATOS_DOCUMENTO = ['markdown', 'md', 'document', 'docx', 'doc', 'pdf', 'pptx', 'text', 'txt', 'html', 'artifact_bundle']

export function audienciaDe(o: OutputDef | null | undefined): Audience {
  if (!o) return 'document'
  if (o.audience === 'internal' || o.audience === 'document') return o.audience
  if (o.type === 'connection') return 'internal'
  const fmt = String(o.format || '').toLowerCase()
  if (FORMATOS_DOCUMENTO.includes(fmt)) return 'document'
  if (o.image_gen) return 'internal'
  return fmt ? 'internal' : 'document'
}

/** La pestaña «Data» del modal del canvas: los outputs internal que no generan imágenes (los de imagen conservan su galería). */
export const DATA_TAB = '__data__'
export const esDeDatos = (o: OutputDef | null | undefined): boolean => !!o && audienciaDe(o) === 'internal' && !o.image_gen
export const claveDe = (o: OutputDef | null | undefined): string => (o?.key || o?.name || '')
/** A qué pestaña va una clave de output: la suya, o «Data» si es un output de datos. */
export function pestanaDe(outputs: OutputDef[] | undefined, key: string): string {
  const o = (outputs ?? []).find(x => claveDe(x) === key)
  return o && esDeDatos(o) ? DATA_TAB : key
}
