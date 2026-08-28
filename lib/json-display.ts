// ─── JSON → markdown legible (SOLO presentación) ──────────────────────────────
// PRINCIPIO: la esencia de un output es JSON — el nodo siguiente lo consume estructurado.
// Estas funciones NO modifican el contenido real; solo le dan forma legible para mostrarlo
// (chat, context inputs, output overlay, expand modal). Maneja objeto o array con anidados.
// Devuelven null si no hay JSON parseable → el caller muestra el contenido tal cual.

const OMIT_KEYS = ['title', 'name']

// Renderiza recursivamente los campos de un objeto como bullets markdown (con indentación).
function renderFields(obj: Record<string, unknown>, indent: number): string[] {
  const pad = '  '.repeat(indent)
  const lines: string[] = []
  for (const [k, v] of Object.entries(obj)) {
    if (v == null || v === '') continue
    if (Array.isArray(v)) {
      const scalarArr = v.every(x => x == null || typeof x !== 'object')
      if (scalarArr) {
        const vals = v.filter(x => x != null).map(String)
        // Tags cortos → en línea; ítems largos (ej. pasos de core_loop) → sub-bullets
        if (vals.every(s => s.length <= 30) && vals.length <= 6) {
          lines.push(`${pad}- **${k}:** ${vals.join(', ')}`)
        } else {
          lines.push(`${pad}- **${k}:**`)
          for (const s of vals) lines.push(`${pad}  - ${s}`)
        }
      } else {
        lines.push(`${pad}- **${k}:**`)
        v.forEach((x, i) => {
          if (x && typeof x === 'object') {
            const xo = x as Record<string, unknown>
            const t = xo.name || xo.title || `#${i + 1}`
            lines.push(`${pad}  - **${t}**`)
            const rest = Object.fromEntries(Object.entries(xo).filter(([kk]) => !OMIT_KEYS.includes(kk)))
            lines.push(...renderFields(rest, indent + 2))
          } else {
            lines.push(`${pad}  - ${String(x)}`)
          }
        })
      }
    } else if (typeof v === 'object') {
      lines.push(`${pad}- **${k}:**`)
      lines.push(...renderFields(v as Record<string, unknown>, indent + 1))
    } else {
      lines.push(`${pad}- **${k}:** ${String(v)}`)
    }
  }
  return lines
}

// Extrae el primer valor JSON (objeto o array) del contenido — fenced ```json o suelto.
function extractTopJson(content: string): { value: unknown; before: string; after: string; fence: string | null } | null {
  const fenceMatch = content.match(/```(?:json)?\s*([\s\S]*?)```/i)
  const text = fenceMatch ? fenceMatch[1] : content
  const iObj = text.indexOf('{'), iArr = text.indexOf('[')
  let open: string, close: string
  if (iArr !== -1 && (iObj === -1 || iArr < iObj)) { open = '['; close = ']' }
  else if (iObj !== -1) { open = '{'; close = '}' }
  else return null
  const start = text.indexOf(open), end = text.lastIndexOf(close)
  if (start === -1 || end <= start) return null
  let value: unknown
  try { value = JSON.parse(text.slice(start, end + 1)) } catch { return null }
  if (!value || typeof value !== 'object') return null
  if (fenceMatch) return { value, before: '', after: '', fence: fenceMatch[0] }
  return { value, before: content.slice(0, content.indexOf(open)), after: content.slice(content.lastIndexOf(close) + 1), fence: null }
}

// ─── Bloques máquina — se conservan en el contenido, NO se muestran ───────────
// El DNA hace que cada respuesta cierre con bloques que lee el motor: el contrato de carril
// (`## <output_key>` + json) y el bloque de emisión de imágenes (`{"<output_key>": [{prompt}]}`).
// Son necesarios aguas abajo, pero para el usuario son ruido. Estas funciones los quitan SOLO
// al presentar; el contenido guardado en forge_messages / forge_assets queda intacto.

const CLAVE_SALIDA = /^[a-z][a-z0-9_]*$/

// ¿El cuerpo de un bloque cercado es un contrato de máquina? Hay varias formas, todas legítimas
// según qué escriba cada nodo, y todas ilegibles para una persona:
//   · el sobre de emisión      {"development_images": [{ id, prompt, placement }]}
//   · el sobre vacío           {"development_images": []}
//   · un registro de decisión  {"format": "development_image_plan", "decision": "zero_images", …}
// Reconocer solo la primera dejaba las otras dos en pantalla — que es justo lo que se veía.
function esEmisionDeImagenes(cuerpo: string): boolean {
  let v: unknown
  try { v = JSON.parse(cuerpo) } catch { return false }
  if (!v || typeof v !== 'object' || Array.isArray(v)) return false
  const obj = v as Record<string, unknown>
  const entradas = Object.entries(obj)

  // Lleva `format` nombrando una clave de salida: es el registro de ese output, no prosa
  if (typeof obj.format === 'string' && CLAVE_SALIDA.test(obj.format) && entradas.length <= 8) return true

  if (entradas.length !== 1) return false
  const [clave, valor] = entradas[0]
  if (!CLAVE_SALIDA.test(clave) || !Array.isArray(valor)) return false
  // [] es una emisión válida (cero imágenes) y también se oculta
  return valor.every(x => x && typeof x === 'object' && 'prompt' in (x as object))
}

// ¿Es un contrato de carril? Array de objetos con `id` — la lista que instancia los carriles.
function esContratoDeCarril(cuerpo: string): boolean {
  let v: unknown
  try { v = JSON.parse(cuerpo) } catch { return false }
  return Array.isArray(v) && v.length > 0 &&
    v.every(x => x && typeof x === 'object' && !Array.isArray(x) && 'id' in (x as object))
}

export function stripMachineBlocks(content: string): string {
  if (!content) return content

  // Los bloques máquina van al CIERRE de la respuesta, no pegados a su encabezado: el `##
  // concept_seeds` de arriba titula la sección legible y debe quedarse. Así que se recorren los
  // bloques desde el final y se van quitando mientras sigan siendo máquina.
  const bloques = [...content.matchAll(/```json\n([\s\S]*?)\n```/g)]
  let corte = content.length

  for (let i = bloques.length - 1; i >= 0; i--) {
    const b = bloques[i]
    const cuerpo = b[1]
    if (!esEmisionDeImagenes(cuerpo) && !esContratoDeCarril(cuerpo)) break
    // Solo entre el cierre anterior y el final puede haber separadores o líneas sueltas
    if (content.slice(b.index! + b[0].length, corte).trim().replace(/^-{3,}$/gm, '').trim()) break
    corte = b.index!
  }
  if (corte === content.length) return content

  // Al quitar el bloque suele quedar colgando el encabezado que lo anunciaba (`## concept_seeds`)
  // sin nada debajo; se va con él. El encabezado que titula la sección legible no queda al final,
  // así que esta poda no lo toca.
  const podar = (s: string) => s.trim()
    .replace(/(?:\n*-{3,})+$/, '').trim()
    .replace(/\n#{2,3}[ \t]+[a-z][a-z0-9_]*$/, '').trim()
  const out = podar(podar(content.slice(0, corte)))

  // Un output cuya esencia ES el json (format json/structured) no debe quedar vacío
  return out.length >= 400 ? out : content
}

// Lo que ve el usuario: sin bloques máquina y con el json restante en markdown legible.
export function forDisplay(content: string): string {
  const limpio = stripMachineBlocks(content)
  return jsonToMarkdown(limpio) ?? limpio
}

export function jsonToMarkdown(content: string): string | null {
  const ext = extractTopJson(content)
  if (!ext) return null
  const { value, before, after, fence } = ext

  let md: string
  if (Array.isArray(value)) {
    if (value.length === 0) return null
    const allObj = value.every(el => el && typeof el === 'object' && !Array.isArray(el))
    if (allObj) {
      // Array de objetos → tarjeta numerada por ítem + separador (ej. concept_seeds)
      md = value.map((el, i) => {
        const o = el as Record<string, unknown>
        const title = (o.title || o.name || `Item ${i + 1}`) as string
        const rest = Object.fromEntries(Object.entries(o).filter(([k]) => !OMIT_KEYS.includes(k)))
        return [`### ${i + 1}. ${title}`, ...renderFields(rest, 0)].join('\n')
      }).join('\n\n---\n\n')
    } else {
      md = value.map(v => `- ${typeof v === 'object' ? JSON.stringify(v) : String(v)}`).join('\n')
    }
  } else {
    // Objeto suelto (ej. concept_data): title/name como encabezado + campos
    const o = value as Record<string, unknown>
    const title = (o.title || o.name) as string | undefined
    const rest = title ? Object.fromEntries(Object.entries(o).filter(([k]) => !OMIT_KEYS.includes(k))) : o
    md = [...(title ? [`### ${title}`] : []), ...renderFields(rest, 0)].join('\n')
  }

  if (fence) return content.replace(fence, md)
  return `${before}${md}${after}`.trim()
}

// Variante para decks/cards: devuelve una card por objeto con el título = el title/name REAL
// del output (no "Overview" ni "### 1."), y el cuerpo como markdown legible de sus campos.
// Array de objetos → una card por ítem (ej. cada seed). Objeto suelto → una card.
// Devuelve null si no hay JSON parseable → el caller usa su propio split de markdown.
export function jsonToCards(content: string): { title: string; body: string }[] | null {
  const ext = extractTopJson(content)
  if (!ext) return null
  const { value } = ext

  if (Array.isArray(value)) {
    if (value.length === 0) return null
    if (!value.every(el => el && typeof el === 'object' && !Array.isArray(el))) return null
    return value.map((el, i) => {
      const o = el as Record<string, unknown>
      const title = String(o.title || o.name || `Item ${i + 1}`)
      const rest = Object.fromEntries(Object.entries(o).filter(([k]) => !OMIT_KEYS.includes(k)))
      return { title, body: renderFields(rest, 0).join('\n') }
    })
  }

  const o = value as Record<string, unknown>
  const hasTitle = !!(o.title || o.name)
  const title = String(o.title || o.name || 'Output')
  const rest = hasTitle ? Object.fromEntries(Object.entries(o).filter(([k]) => !OMIT_KEYS.includes(k))) : o
  return [{ title, body: renderFields(rest, 0).join('\n') }]
}
