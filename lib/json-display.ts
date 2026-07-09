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
