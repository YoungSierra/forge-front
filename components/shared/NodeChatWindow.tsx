'use client'

import React, { useState, useRef, useEffect, useCallback } from 'react'
import { createPortal } from 'react-dom'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { CopyButton } from '@/components/shared/CopyButton'
import { downloadTextFile, mdFilename } from '@/lib/download'
import { chatWithNode, getNodeContextInputs } from '@/lib/api'
import type { ChatMessage, ChatAttachment, ChatToolCall, ApprovedAsset, OutputImageItem, OutputImagesMap, NodeContextInput } from '@/lib/api'
import type { Project } from '@/lib/types'
import { MD_COMPONENTS } from '@/lib/md-components'
import { forDisplay, stripMachineBlocks } from '@/lib/json-display'
import AttachmentCard from './AttachmentCard'
import Moodboard from '@/components/moodboard/Moodboard'
import { Paperclip } from 'lucide-react'

// ─── Utilidad — parsear items de un output para image gen ────────────────────

// Extrae un array JSON del contenido (con o sin fences ```json) y devuelve un ítem
// legible por objeto (prioriza title/one_liner). null si no hay array parseable.
function parseJsonArrayItems(content: string, outputKey?: string | null): string[] | null {
  // Se miran TODOS los bloques cercados, empezando por los marcados ```json.
  //
  // Antes se tomaba el primero y punto. Medido el 26-08: una respuesta abría con un diagrama ASCII
  // en un bloque sin lenguaje y traía las semillas en JSON más abajo — el extractor se quedaba con
  // el diagrama, no encontraba array, y todo caía a raspar prosa. Las semillas venían
  // estructuradas y no las leíamos. (Mismo bug que ya se había arreglado en el fan-out.)
  const bloques = [...content.matchAll(/```(\w*)\s*([\s\S]*?)```/g)]
    .map(m => ({ lang: (m[1] || '').toLowerCase(), cuerpo: m[2] }))
  const candidatos = [
    ...bloques.filter(b => b.lang === 'json').map(b => b.cuerpo),
    ...bloques.filter(b => b.lang === '').map(b => b.cuerpo),
    // Sin ningún bloque, el mensaje entero: hay respuestas que SON el array y nada más.
    ...(bloques.length ? [] : [content]),
  ]

  // El array se busca POR SU NOMBRE, no por ser el primero. Toda respuesta de concepto cierra con
  // `gaps_for_downstream`, que también es un array de objetos, y el 1.1 lo emite ANTES de las
  // semillas: pidiendo «el primer array» se ofrecía una imagen por cada hueco pendiente. Medido
  // el 01-09: diez ítems, los diez gaps, cero semillas.
  const esHueco = (o: unknown) => !!o && typeof o === 'object'
    && ('gap' in (o as object) || 'node_that_needs_it' in (o as object))

  const porNombre = (text: string): unknown[] | null => {
    if (!outputKey) return null
    const rx = new RegExp('"' + outputKey.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '"\\s*:\\s*\\[')
    const m = rx.exec(text)
    if (!m) return null
    const desde = text.indexOf('[', m.index)
    // Cierre por conteo de corchetes: `lastIndexOf` se pasa al siguiente array del documento.
    let nivel = 0
    for (let i = desde; i < text.length; i++) {
      if (text[i] === '[') nivel++
      else if (text[i] === ']' && --nivel === 0) {
        try { const v = JSON.parse(text.slice(desde, i + 1)); return Array.isArray(v) ? v : null } catch { return null }
      }
    }
    return null
  }

  let arr: unknown = null
  for (const text of candidatos) {
    const nombrado = porNombre(text)
    if (nombrado?.length) { arr = nombrado; break }
  }
  if (!Array.isArray(arr)) {
    for (const text of candidatos) {
      const start = text.indexOf('[')
      const end   = text.lastIndexOf(']')
      if (start === -1 || end <= start) continue
      try {
        const p = JSON.parse(text.slice(start, end + 1))
        if (Array.isArray(p) && p.length && !p.every(esHueco)) { arr = p; break }
      } catch { /* no era éste; sigue el próximo bloque */ }
    }
  }
  if (!Array.isArray(arr) || arr.length === 0) return null

  // La cabecera va primero y sin rótulo: es lo que identifica al ítem de un vistazo.
  const PREF = ['title', 'name', 'one_liner', 'oneLiner', 'summary', 'description', 'label']
  // Lo que nunca es contenido: identificadores internos que en la tarjeta son ruido.
  const OCULTO = new Set(['id', 'key', 'index', 'seed_id', 'uuid'])

  const rotulo = (k: string) => k.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase())
  const texto  = (v: unknown): string =>
    Array.isArray(v) ? v.filter(x => x != null).map(x => typeof x === 'string' ? x : JSON.stringify(x)).join(' · ')
    : typeof v === 'string' ? v
    : (typeof v === 'number' || typeof v === 'boolean') ? String(v)
    : v && typeof v === 'object' ? Object.entries(v as Record<string, unknown>).map(([k, x]) => `${rotulo(k)}: ${texto(x)}`).join(' · ')
    : ''

  const items = arr.map(el => {
    if (el && typeof el === 'object') {
      const o = el as Record<string, unknown>
      const cabecera = PREF.map(k => o[k]).filter((v): v is string => typeof v === 'string' && v.trim().length > 0)
      // El resto del objeto TAMBIÉN es la tarjeta: rationale, género, comparables, modificadores.
      // Antes se descartaba todo lo que no estuviera en PREF y la galería mostraba dos campos de
      // ocho — justo la información por la que se abre la tarjeta.
      const resto = Object.entries(o)
        .filter(([k, v]) => !PREF.includes(k) && !OCULTO.has(k) && texto(v).trim().length > 0)
        .map(([k, v]) => `${rotulo(k)}: ${texto(v)}`)

      if (cabecera.length || resto.length) {
        return [cabecera.join(' — '), ...resto].filter(Boolean).join('\n\n')
      }
      return JSON.stringify(el)
    }
    return String(el)
  }).filter(s => s.trim().length > 0)
  return items.length ? items : null
}

// Bloques encabezados que enumeran entidades. Se exige el MISMO nivel en todos: un `### Rationale`
// dentro de un `## SEED 04` es parte de la semilla, no otra semilla.
// El SUSTANTIVO importa: «cualquier palabra + número» tomaba también el título del documento
// —«Concept Seeds · Pass 3»—. Con el vocabulario que la DNA usa de verdad, UN bloque ya alcanza:
// una corrida incremental agrega una sola semilla y las anteriores no se repiten.
// El encabezado EMPIEZA con el sustantivo: eso separa «## SEED I» —que nombra una entidad— de
// «# SMACK — Concept Seeds · Iteration 4», que la menciona al pasar. Exigir además un NÚMERO
// dejaba afuera las semillas nombradas con letra (SEED I, J, L), y ahí el nodo caía a viñetas y
// ofrecía quince imágenes de la lista de mecánicas.
// Y después del sustantivo tiene que venir un número, una letra sola o un separador — NO otra
// palabra. Sin eso entraban «Seed Comparison at a Glance» y «Seed Shortlist», que son una tabla y
// un índice: cada uno se llevaba un hueco de imagen que nadie pidió.
const RX_ENUMERADO = /^(#{1,4})\s+\**\s*(?:seeds?|variations?|concepts?|angles?|images?|options?|pages?)\s*(?:[·:.\-—]|\d|[A-Z]\b)/i
// Un encabezado que ES un identificador: «### pitch_01_hook». Desde v2.9.13 el título de cada
// entrada del plan ES el id de la imagen, y el 3.20 lo cita verbatim en su reference_map. No
// empieza con ninguna palabra del vocabulario, así que la regla del sustantivo apuntaba al plan
// correcto y adentro no reconocía nada: devolvía un solo ítem, «DECISION RECORD».
const RX_IDENTIFICADOR = /^(#{1,4})\s+\**\s*[a-z][a-z0-9]*(?:_[a-z0-9]+)+\**\s*$/

function bloquesPorMarcas(lineas: string[], marcas: { i: number; nivel: number }[], minimo = 1): string[] | null {
  if (marcas.length < minimo) return null
  const nivel   = Math.min(...marcas.map(m => m.nivel))
  const propias = marcas.filter(m => m.nivel === nivel)
  if (propias.length < minimo) return null
  return propias.map((p, k) => {
    const hasta = k + 1 < propias.length ? propias[k + 1].i : lineas.length
    return lineas.slice(p.i, hasta).join('\n').trim()
  })
}

function bloquesEnumerados(texto: string): string[] | null {
  const lineas = String(texto || '').split('\n')
  const porSustantivo: { i: number; nivel: number }[] = []
  const porIdentificador: { i: number; nivel: number }[] = []
  for (let i = 0; i < lineas.length; i++) {
    const m = RX_ENUMERADO.exec(lineas[i])
    if (m) { porSustantivo.push({ i, nivel: m[1].length }); continue }
    const d = RX_IDENTIFICADOR.exec(lineas[i])
    if (d) porIdentificador.push({ i, nivel: d[1].length })
  }
  // El sustantivo manda; los identificadores son el respaldo y piden DOS o más, porque un
  // `## concept_seeds` suelto es el ancla de un output, no una entrada.
  return bloquesPorMarcas(lineas, porSustantivo, 1) ?? bloquesPorMarcas(lineas, porIdentificador, 2)
}

/** Imágenes declaradas en un bloque JSON, una por objeto, con su prompt. Espejo de la misma
 *  regla en `image-gen.service.js` del backend: los dos parsers tienen que ver lo mismo, o el
 *  hueco que se dibuja no es el prompt que se despacha. */
function parseDeclaredImagePrompts(content: string): string[] | null {
  const bloques = [...String(content || '').matchAll(/```(\w*)\s*([\s\S]*?)```/g)]
    .map(m => ({ lang: (m[1] || '').toLowerCase(), cuerpo: m[2] }))
  for (const texto of [
    ...bloques.filter(b => b.lang === 'json').map(b => b.cuerpo),
    ...bloques.filter(b => b.lang === '').map(b => b.cuerpo),
  ]) {
    const a = texto.indexOf('['), b = texto.lastIndexOf(']')
    if (a === -1 || b <= a) continue
    let arr: unknown
    try { arr = JSON.parse(texto.slice(a, b + 1)) } catch { continue }
    if (!Array.isArray(arr) || !arr.length) continue
    if (!arr.every(x => x && typeof x === 'object' && !Array.isArray(x))) continue
    // `prompt` primero; `depicts` como segunda opción — el 2.2 declara sus imágenes así.
    const prompts = (arr as Record<string, unknown>[]).map(o => {
      for (const campo of ['prompt', 'image_prompt', 'depicts']) {
        const v = o[campo]
        if (typeof v === 'string' && v.trim()) return v.trim()
      }
      return ''
    })
    if (prompts.filter(Boolean).length * 2 < arr.length) continue
    // Va COMPLETO, sin el tope de 700 del respaldo: ese existe para no mandar un documento
    // entero, no para cortar a la mitad el prompt que el modelo escribió.
    const items = prompts.filter(Boolean)
    if (items.length) return items
  }
  return null
}

export function parseOutputItems(content: string, format: string, outputKey?: string | null): string[] {
  // Outputs de imagen: un output puede pedir VARIAS imágenes (ej. reference_images: 4-6 prompts
  // numerados). Extraer un ítem por prompt — cada bloque numerado, incluidas sus líneas siguientes
  // hasta el próximo número. Antes esto devolvía SIEMPRE el contenido entero como 1 solo ítem, así
  // que un output de N imágenes generaba una sola. Sin lista numerada, el contenido entero = 1 prompt.
  if (format === 'png' || format === 'image') {
    // Espejo de la regla del backend: la declaración que manda es la DEL OUTPUT. Un output que se
    // nombra a sí mismo con la lista vacía —«development_images: []», que su DNA acepta como
    // respuesta válida— no ofrece ningún hueco. Sin esto el back devolvía 0 ítems y el canvas
    // dibujaba 3: el hueco que se muestra tiene que ser el prompt que se despacha.
    if (outputKey && new RegExp('`?"?' + outputKey + '"?\\s*:\\s*\\[\\s*\\]').test(content)) return []

    // Un output de imagen puede DECLARAR sus imágenes en un bloque JSON, cada una con su prompt.
    // Eso manda sobre cualquier lectura de la prosa. Sin esto, el 2.2 declaró una imagen con su
    // prompt completo y el hueco que se ofreció llevaba la respuesta entera recortada a 700
    // caracteres —empezando por «I have the concept data from the existing node output»— y ESO
    // fue lo que se mandó a ComfyUI.
    //
    // Se exige un arreglo de objetos donde la mayoría traiga `prompt`, que es lo que distingue una
    // declaración de imágenes de un arreglo de paleta o de gaps.
    // El sobre se busca SIN depender de los cercados. Emparejar ``` funciona hasta que el modelo
    // abre un bloque y no lo cierra: el número de marcas queda impar, el emparejamiento se corre y
    // el sobre se vuelve invisible. Medido el 01-09 en el 2.2 — el modelo truncó su `concept_data`
    // a mitad de una URL y la respuesta quedó con cinco marcas; acá se ofrecían SEIS huecos
    // sacados de la prosa (las tres mecánicas y las tres entradas del plan) mientras el sobre
    // declaraba tres imágenes con su id, y el backend despachaba otra cosa distinta.
    //
    // Espejo exacto del backend: se ancla en la sección DEL OUTPUT y se lee el primer arreglo
    // balanceado, cerrando por conteo de corchetes. El hueco que se ve tiene que ser el prompt
    // que se paga.
    if (outputKey) {
      const esc = outputKey.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
      const anc = new RegExp(`^#{1,4}[ \\t]+\\**\\s*${esc}\\b.*$`, 'im').exec(content)
      if (anc) {
        const desde = content.slice(anc.index + anc[0].length)
        // No vale «el primer arreglo de la sección»: la del 2.4 abre con su tabla de paleta y una
        // lista de tres hex, que se llevaba el cupo. Un sobre se reconoce por dentro — objetos con
        // `prompt`/`image_prompt`/`depicts`—, así que se recorren todos y se toma el primero que
        // lo parezca. Mismo criterio que el backend, para que ambos vean lo mismo.
        // `subject` cuenta: el modelo alterna entre `prompt` y `subject`+`composition`+`mood`, y
        // exigiendo solo `prompt` la segunda forma no se reconocía — el chat ofrecía las mecánicas
        // del documento como si fueran imágenes mientras el sobre declaraba otras tres.
        const CAMPOS = ['prompt', 'image_prompt', 'depicts', 'subject']
        const esSobre = (v: unknown) => Array.isArray(v) && v.length > 0 && v.some(o => {
          if (!o || typeof o !== 'object' || Array.isArray(o)) return false
          const r = o as Record<string, unknown>
          return CAMPOS.some(k => typeof r[k] === 'string' && (r[k] as string).trim().length >= 40)
        })
        for (let ini = desde.indexOf('['); ini !== -1; ini = desde.indexOf('[', ini + 1)) {
          let nivel = 0
          let cerrado = false
          for (let i = ini; i < desde.length && !cerrado; i++) {
            if (desde[i] === '[') nivel++
            else if (desde[i] === ']' && --nivel === 0) {
              cerrado = true
              try {
                const v = JSON.parse(desde.slice(ini, i + 1))
                if (esSobre(v)) {
                  // Un `prompt` declarado va tal cual. Sin el, la entrada se arma con sus campos
                  // -sujeto, composicion, animo, paleta-, que es lo que describe la imagen.
                  const items = (v as unknown[]).map(o => {
                    const r = o as Record<string, unknown>
                    for (const campo of ['prompt', 'image_prompt']) {
                      const x = r?.[campo]
                      if (typeof x === 'string' && x.trim()) return x.trim()
                    }
                    const OCULTO = ['id', 'key', 'index']
                    return Object.entries(r || {})
                      .filter(([k, x]) => !OCULTO.includes(k) && typeof x === 'string' && x.trim())
                      .map(([k, x]) => `${k.replace(/_/g, ' ')}: ${x}`)
                      .join('\n')
                  }).filter(x => x)
                  if (items.length) return items
                }
              } catch { /* no era legible; se prueba el siguiente */ }
            }
          }
        }
      }
    }

    const declarados = parseDeclaredImagePrompts(content)
    if (declarados) return declarados

    // Si el sobre EXISTE pero no se pudo leer, no se adivina: se ofrece cero. Espejo de la misma
    // compuerta en el backend. El 2.2 emitió sus tres imágenes con `subject` y `composition_notes`
    // pero sin `prompt`; `parseDeclaredImagePrompts` lo rechazó —con razón— y la línea de abajo
    // ofrecía la respuesta entera recortada a 700 caracteres, que arranca con la tabla del Fact
    // Sheet. Eso fue lo que se mandó a ComfyUI, y por eso la imagen no se parecía a nada del plan.
    // Un sobre ilegible es un incumplimiento del contrato que hay que reportar, no rellenar.
    const traeSobre = [...content.matchAll(/```(\w*)\s*([\s\S]*?)```/g)].some(m => {
      try {
        const v = JSON.parse(m[2])
        return Array.isArray(v) && v.length > 0 && v.every(o => o && typeof o === 'object' && !Array.isArray(o))
      } catch { return false }
    })
    if (traeSobre) return []

    // Inicio de cada prompt. Cubre dos estilos: número al inicio ("1.", "**1.**", "### 1.") Y
    // "Palabra(s) N" + separador ("**Image 1 —**", "### Image 2:", "Image 3 -") — el LLM suele
    // titular las imágenes así en vez de una lista numerada, y antes eso quedaba como 1 solo prompt.
    const marker = '(?:#{1,4}[ \\t]+)?\\*{0,2}(?:[A-Za-z][A-Za-z]*[ \\t]+){0,3}\\d+[ \\t]*[.):\\u2014\\u2013-]'
    const blocks = content
      .split(new RegExp(`^(?=${marker})`, 'm'))
      .map(p => p.trim())
      .filter(p => new RegExp(`^${marker}`).test(p))
      .map(p => p.replace(new RegExp(`^${marker}`), '').replace(/^\*{0,2}/, '').trim())
    if (blocks.length > 1) return blocks.slice(0, 8).map(s => s.slice(0, 700))
    return [content.trim().slice(0, 700)]
  }

  // Estructurados (json / structured / list<...>): un ítem por objeto del array JSON, no por
  // línea. 'structured' se incluye porque 027 cambió concept_seeds a ese format; sin él, el
  // parser caía al split por bullets y generaba una celda por campo en vez de una por seed.
  if (format === 'json' || format === 'structured' || /^list</.test(format ?? '')) {
    const items = parseJsonArrayItems(content, outputKey)
    if (items) return items
  }
  // Lo que NO es un ítem generable, fuera antes de mirar nada más:
  //
  //  · los bloques cercados con ``` — son datos estructurados o código, nunca un sujeto de imagen;
  //  · la sección `gaps_for_downstream`, que la enmienda M-8 de v2.9.4 obliga a emitir al cierre
  //    de todo output de concepto. Sus líneas empiezan con "- gap:", y como la regla de bullets es
  //    la primera que dispara, el nodo 1.1 ofrecía generar una imagen POR CADA HUECO PENDIENTE en
  //    vez de por cada seed. El bloque es instrucción para los nodos de abajo, no contenido.
  content = content
    .replace(/```[\s\S]*?```/g, '')
    .replace(/^#{1,4}[ \t]+gaps_for_downstream[\s\S]*$/im, '')
    .trim()

  // Entidades enumeradas por encabezado — «## SEED 01», «### Angle 2», «### Image 3». Van ANTES
  // que las viñetas, que se llevan cualquier lista que encuentren.
  //
  // Medido el 26-08: a ComfyUI se le mandaron «Primary: Arcade / Action» y «Celeste (Extremely OK
  // Games, 2018) — precision platformer…» como prompts de imagen. Eran la clasificación de género
  // y los comparables del documento; las semillas, que son encabezados, nunca se miraron.
  const enumerados = bloquesEnumerados(content)
  if (enumerados) return enumerados

  // Bullet list: "- item", "* item", "• item"
  const bulletRx   = /^[ \t]*[-*•][ \t]+(.+)$/gm
  // Numbered list: "1. item", "1) item"
  const numberedRx = /^[ \t]*\d+[.)]\s+(.+)$/gm
  // Labeled: "Variation 1: title", "Option 2: title", "Concept 3: title"
  const labeledRx  = /^[A-Za-z]+\s+\d+[:.]\s+(.+)$/gm
  // Markdown heading con número: "## 1. title", "### Variation 1: title", "### **Variation 1:** title"
  const headingRx  = /^#{1,4}\s+(?:\*{0,2})(?:[A-Za-z]+\s+)?\d+[:.)]?\s+(.+)$/gm

  const bullets  = [...content.matchAll(bulletRx)].map(m => m[1].trim())
  if (bullets.length > 0) return bullets

  const numbered = [...content.matchAll(numberedRx)].map(m => m[1].trim())
  if (numbered.length > 0) return numbered

  // Labeled con descripción: dividir por el inicio de cada "Variation N:" y capturar el bloque completo
  const labeledParts = content
    .split(/(?=^[A-Za-z]+[ \t]+\d+[:.]\s)/m)
    .map(p => p.trim())
    .filter(p => /^[A-Za-z]+[ \t]+\d+[:.]\s/.test(p))
  if (labeledParts.length > 0) return labeledParts

  // Heading con número + contenido subsiguiente (bloque completo por ítem)
  // Soporta: "### Variation 1: título", "### Seed 001", "### **Seed 001:**"
  const richBlocks: string[] = []
  const richRx = /^#{1,4}[ \t]+([^\n]+(?:\n(?!#{1,4}[ \t])[^\n]*)*)/gm
  for (const m of content.matchAll(richRx)) {
    const block = m[1].trim()
    // El ordinal puede ser un número o una LETRA: el modelo rotula tan seguido "Seed A / Seed B"
    // como "Variation 1", y exigiendo dígito los seeds del 1.1 no se capturaban. La letra tiene
    // que ir sola —`(?![A-Za-z])`— o "## Image Descriptions" pasaría por "Image D…".
    if (/^(?:\*{0,2})(?:[A-Za-z]+[ \t]+)+(?:\d+|[A-Z](?![A-Za-z]))/.test(block)) {
      richBlocks.push(block)
    }
  }
  if (richBlocks.length > 0) return richBlocks

  const headings = [...content.matchAll(headingRx)].map(m => m[1].trim())
  if (headings.length > 0) return headings

  // Bloques tipo "Seed 001" / "Concept 002" — encabezado plano sin # ni delimitador (:)
  const seedBlocks = content
    .split(/(?=^[A-Za-z][A-Za-z ]*[ \t]+\d{1,4}\s*$)/m)
    .map(p => p.trim())
    .filter(p => /^[A-Za-z][A-Za-z ]*[ \t]+\d{1,4}/.test(p) && p.length > 40)
  if (seedBlocks.length > 1) return seedBlocks

  // Fallback: líneas no vacías (máx 20)
  return content.split('\n').map(l => l.trim()).filter(l => l.length > 5).slice(0, 20)
}

// ─── ¿El contenido trae ENTIDADES, o es un documento suelto? ──────────────────
//
// Un output `list<...>` promete varias piezas —semillas, vistas, páginas—. Cuando el modelo
// devuelve prosa sin entidades, o directamente «I need more information about your concept», el
// parser cae a su último recurso: tomar los primeros 700 caracteres como prompt. Ofrecer ahí un
// botón de generar es invitar a pagar una imagen de un párrafo cualquiera.
//
// Medido el 26-08 sobre 45 corridas: 34 salieron sin estructura, varias eran pedidos de datos.
//
// Solo aplica a los que PROMETEN varias: un output de una sola imagen cuyo prompt viene en prosa
// está perfecto y se deja como está.
export function tieneEntidades(content: string, format: string, outputKey?: string | null): boolean {
  const txt = String(content || '').trim()
  if (!txt) return false
  if (!/^list</.test(String(format || ''))) return true
  const items = parseOutputItems(txt, format, outputKey)
  // Un output que se declara VACIO no tiene nada que ilustrar.
  if (!items.length) return false
  return !(items.length === 1 && txt.startsWith(items[0].slice(0, 60)))
}


const KEYFRAMES = `
  @keyframes chat-dot { 0%,80%,100%{opacity:.2;transform:scale(0.8)} 40%{opacity:1;transform:scale(1)} }
  @keyframes img-gen-pulse { 0%,100%{opacity:.35} 50%{opacity:1} }
`

const WINDOW_W = 560
const WINDOW_H = 820
// Margen mínimo respecto al borde de pantalla
const MARGIN   = 12
// Ancho del panel de contexto (gate nodes)
const PANEL_W  = 288

// ─── Detección de la sección de un output en el markdown ───────────────────────
// Un output (ej. reference_images) marca su sección con un encabezado. El matcher es TOLERANTE:
// el título puede EMPEZAR con el label y seguir con más texto (ej. "Reference Image Set —
// Production Summary"), y el plural final es opcional (Image/Images). Antes se exigía coincidencia
// exacta (\s*$): un título con sufijo NO matcheaba → la auto-generación de imágenes no se disparaba
// y quedaban solo los placeholders que el LLM había incrustado. Compartido por triggerAutoImageGen
// y los dos builders de items para que generar y mostrar usen el MISMO criterio.
function outputHeaderPat(outputKey: string): string {
  return outputKey
    .replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    .replace(/_/g, '[_\\s]')
    .replace(/s$/i, 's?')
}
function outputHeaderRx(outputKey: string): RegExp {
  return new RegExp(`^(?:#{1,4}\\s+)?${outputHeaderPat(outputKey)}\\b`, 'im')
}

// ─── Typing dots ──────────────────────────────────────────────────────────────

function TypingDots() {
  return (
    <div style={{ display: 'flex', gap: 4, alignItems: 'center', padding: '4px 0' }}>
      {[0, 1, 2].map(i => (
        <div key={i} style={{
          width: 6, height: 6, borderRadius: '50%',
          background: 'var(--text-3)',
          animation: 'chat-dot 1.2s ease-in-out infinite',
          animationDelay: `${i * 0.2}s`,
        }} />
      ))}
    </div>
  )
}

// ─── Tipos para image gen inline ─────────────────────────────────────────────

export interface InlineImageItem {
  itemKey:      string   // "outputKey:index" — único entre todos los outputs
  index:        number
  text:         string
  imageUrl:     string | null                // última variación generada (null si ninguna)
  allVariations: { url: string; condition?: string | null }[]
  isGenerating: boolean
  onGenerate:   (condition?: string) => void
  onZoom:       (url: string) => void
}

const VP_W = 480
const VP_H = 520

// Panel modal para generar una nueva variación con condiciones del usuario
export function VariationPanel({ item, onClose }: { item: InlineImageItem; onClose: () => void }) {
  const [condition,      setCondition]      = useState('')
  const [generating,     setGenerating]     = useState(false)
  const [internalZoomUrl,setInternalZoomUrl]= useState<string | null>(null)
  const [vpPos,          setVpPos]          = useState({ x: 0, y: 0 })
  const [vpSize,         setVpSize]         = useState({ w: VP_W, h: VP_H })
  const [vpMaximized,    setVpMaximized]    = useState(false)
  const [vpDragging,     setVpDragging]     = useState(false)
  const [vpResizing,     setVpResizing]     = useState(false)
  const vpDragOrigin   = useRef({ sx: 0, sy: 0, ox: 0, oy: 0 })
  const vpResizeOrigin = useRef({ sx: 0, sy: 0, ow: 0, oh: 0 })
  const vpSizeRef      = useRef({ w: VP_W, h: VP_H })
  const vpSavedGeom    = useRef<{ pos: { x: number; y: number }; size: { w: number; h: number } } | null>(null)
  const textareaRef    = useRef<HTMLTextAreaElement>(null)

  // Centrar al montar
  useEffect(() => {
    setVpPos({
      x: Math.max(0, (window.innerWidth  - VP_W) / 2),
      y: Math.max(0, (window.innerHeight - VP_H) / 2),
    })
    textareaRef.current?.focus()
  }, [])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { internalZoomUrl ? setInternalZoomUrl(null) : onClose() }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose, internalZoomUrl])

  // Drag
  const onVpDragStart = (e: React.MouseEvent) => {
    if (vpMaximized) return
    e.preventDefault()
    vpDragOrigin.current = { sx: e.clientX, sy: e.clientY, ox: vpPos.x, oy: vpPos.y }
    setVpDragging(true)
  }
  useEffect(() => {
    if (!vpDragging) return
    const onMove = (e: MouseEvent) => setVpPos({ x: vpDragOrigin.current.ox + e.clientX - vpDragOrigin.current.sx, y: vpDragOrigin.current.oy + e.clientY - vpDragOrigin.current.sy })
    const onUp   = () => setVpDragging(false)
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup',   onUp)
    return () => { window.removeEventListener('mousemove', onMove); window.removeEventListener('mouseup', onUp) }
  }, [vpDragging])

  // Resize
  const onVpResizeStart = (e: React.MouseEvent) => {
    e.preventDefault(); e.stopPropagation()
    vpResizeOrigin.current = { sx: e.clientX, sy: e.clientY, ow: vpSizeRef.current.w, oh: vpSizeRef.current.h }
    setVpResizing(true)
  }
  useEffect(() => {
    if (!vpResizing) return
    const onMove = (e: MouseEvent) => {
      const nw = Math.max(420, vpResizeOrigin.current.ow + e.clientX - vpResizeOrigin.current.sx)
      const nh = Math.max(420, vpResizeOrigin.current.oh + e.clientY - vpResizeOrigin.current.sy)
      vpSizeRef.current = { w: nw, h: nh }
      setVpSize({ w: nw, h: nh })
    }
    const onUp = () => setVpResizing(false)
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup',   onUp)
    return () => { window.removeEventListener('mousemove', onMove); window.removeEventListener('mouseup', onUp) }
  }, [vpResizing])

  const toggleVpMaximize = () => {
    if (vpMaximized) {
      const g = vpSavedGeom.current
      if (g) { vpSizeRef.current = g.size; setVpSize(g.size); setVpPos(g.pos) }
    } else {
      vpSavedGeom.current = { pos: vpPos, size: vpSizeRef.current }
    }
    setVpMaximized(v => !v)
  }

  const handleGenerate = async () => {
    setGenerating(true)
    try { await item.onGenerate(condition.trim() || undefined); onClose() }
    finally { setGenerating(false) }
  }

  return createPortal(
    <>
      {/* Backdrop */}
      <div onClick={onClose} style={{ position: 'fixed', inset: 0, zIndex: 20000, background: 'rgba(0,0,0,0.72)' }} />

      {/* Modal draggable/resizable */}
      <div
        onClick={e => e.stopPropagation()}
        style={{
          position: 'fixed',
          left:   vpMaximized ? 0 : vpPos.x,
          top:    vpMaximized ? 0 : vpPos.y,
          width:    vpMaximized ? '100vw' : vpSize.w,
          height:   vpMaximized ? '100vh' : vpSize.h,
          minWidth: 420, minHeight: 420,
          zIndex: 20001,
          background: 'var(--bg-1)', border: '1px solid var(--line-2)',
          borderRadius: vpMaximized ? 0 : 12,
          boxShadow: vpMaximized ? 'none' : '0 24px 64px rgba(0,0,0,0.55)',
          display: 'flex', flexDirection: 'column', overflow: 'hidden',
          userSelect: vpDragging || vpResizing ? 'none' : 'auto',
        }}
      >
        {/* Header */}
        <div
          onMouseDown={onVpDragStart}
          style={{
            padding: '12px 16px', borderBottom: '1px solid var(--line-2)', flexShrink: 0,
            display: 'flex', alignItems: 'center', justifyContent: 'space-between',
            cursor: vpMaximized ? 'default' : (vpDragging ? 'grabbing' : 'grab'),
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <div style={{ width: 30, height: 30, borderRadius: '50%', flexShrink: 0, border: '1px solid rgba(255,138,61,0.25)', background: 'rgba(255,138,61,0.12)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <img src="/forgy/forgyi.png" alt="Forge" style={{ width: 16, height: 16, objectFit: 'contain' }} />
            </div>
            <span style={{ fontFamily: 'var(--font-mono)', fontSize: 10, fontWeight: 700, color: 'var(--text-0)', letterSpacing: '0.05em' }}>GENERATE VARIATION</span>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 4 }} onMouseDown={e => e.stopPropagation()}>
            <button onClick={toggleVpMaximize} title={vpMaximized ? 'Restore' : 'Maximize'} style={{ border: 'none', background: 'transparent', cursor: 'pointer', color: 'var(--text-2)', padding: '4px 8px', borderRadius: 6, flexShrink: 0 }}>
              {vpMaximized ? (
                <svg width="13" height="13" viewBox="0 0 13 13" fill="none" style={{ display: 'block' }}>
                  <rect x="3.75" y="0.75" width="8.5" height="8.5" stroke="currentColor" strokeWidth="1.5" rx="1"/>
                  <rect x="0.75" y="3.75" width="8.5" height="8.5" stroke="currentColor" strokeWidth="1.5" rx="1" fill="var(--bg-1)"/>
                </svg>
              ) : (
                <svg width="13" height="13" viewBox="0 0 13 13" fill="none" style={{ display: 'block' }}>
                  <rect x="0.75" y="0.75" width="11.5" height="11.5" stroke="currentColor" strokeWidth="1.5" rx="1"/>
                </svg>
              )}
            </button>
            <button onClick={onClose} style={{ background: 'transparent', border: 'none', cursor: 'pointer', color: 'var(--text-2)', fontSize: 16, padding: '4px 8px', borderRadius: 6, lineHeight: 1 }}>✕</button>
          </div>
        </div>

        {/* Contenido — columna flex que llena el alto del modal */}
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minHeight: 0 }}>
          {/* Galería de variaciones existentes */}
          {item.allVariations.length > 0 && (
            <div style={{ padding: '12px 16px 0', display: 'flex', gap: 8, overflowX: 'auto', flexShrink: 0 }}>
              {item.allVariations.map((v, i) => (
                <div key={i} style={{ flexShrink: 0, display: 'flex', flexDirection: 'column', gap: 4 }}>
                  <img src={v.url} alt={`Variation ${i + 1}`} onClick={e => { e.stopPropagation(); setInternalZoomUrl(v.url) }}
                    style={{ width: 90, height: 90, objectFit: 'cover', borderRadius: 6, border: '1px solid var(--line-2)', cursor: 'zoom-in', display: 'block' }} />
                  {v.condition && (
                    <span style={{ fontSize: 8, color: 'var(--text-3)', fontFamily: 'var(--font-mono)', maxWidth: 90, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={v.condition}>
                      {v.condition}
                    </span>
                  )}
                </div>
              ))}
            </div>
          )}

          {/* Concepto de referencia */}
          <div style={{ padding: '12px 16px 0', flexShrink: 0 }}>
            <div style={{ fontSize: 9, color: 'var(--text-3)', fontFamily: 'var(--font-mono)', marginBottom: 4 }}>CONCEPT</div>
            <div style={{ fontSize: 11, color: 'var(--text-2)', lineHeight: 1.5, background: 'var(--bg-2)', borderRadius: 6, padding: '8px 10px', border: '1px solid var(--line-2)', maxHeight: 160, overflowY: 'auto' }}>
              {item.text.replace(/\*{1,2}([^*]+)\*{1,2}/g, '$1')}
            </div>
          </div>

          {/* Input de condiciones — crece para llenar el alto restante */}
          <div style={{ padding: '12px 16px', flex: 1, display: 'flex', flexDirection: 'column', minHeight: 0 }}>
            <div style={{ fontSize: 9, color: 'var(--text-3)', fontFamily: 'var(--font-mono)', marginBottom: 6, flexShrink: 0 }}>VARIATION INSTRUCTIONS <span style={{ color: 'var(--text-4)' }}>(optional)</span></div>
            <div style={{ display: 'flex', gap: 7, flex: 1, minHeight: 0 }}>
              <textarea
                ref={textareaRef}
                value={condition}
                onChange={e => setCondition(e.target.value)}
                placeholder="Describe what to change — style, mood, color palette, composition…"
                style={{ flex: 1, resize: 'none', background: 'var(--bg-2)', border: '1px solid var(--line-2)', borderRadius: 8, padding: '8px 10px', fontSize: 12, color: 'var(--text-0)', lineHeight: 1.5, fontFamily: 'inherit', outline: 'none', minHeight: 80 }}
                onFocus={e => { e.currentTarget.style.borderColor = 'var(--action)' }}
                onBlur={e  => { e.currentTarget.style.borderColor = 'var(--line-2)' }}
              />
              <button
                onClick={handleGenerate} disabled={generating}
                style={{ width: 38, borderRadius: 8, border: 'none', flexShrink: 0, background: generating ? 'var(--bg-3)' : 'var(--action)', color: generating ? 'var(--text-4)' : 'var(--action-fg)', fontSize: 18, cursor: generating ? 'not-allowed' : 'pointer', transition: 'background 120ms', display: 'flex', alignItems: 'center', justifyContent: 'center', animation: generating ? 'img-gen-pulse 1.2s ease-in-out infinite' : 'none' }}
              >→</button>
            </div>
          </div>
        </div>

        {/* Handle de resize */}
        {!vpMaximized && (
          <div onMouseDown={onVpResizeStart} style={{ position: 'absolute', bottom: 0, right: 0, width: 18, height: 18, cursor: 'se-resize', display: 'flex', alignItems: 'flex-end', justifyContent: 'flex-end', padding: 4 }}>
            <svg width="10" height="10" viewBox="0 0 10 10" style={{ opacity: 0.3 }}>
              <line x1="2" y1="10" x2="10" y2="2" stroke="var(--text-1)" strokeWidth="1.5" strokeLinecap="round"/>
              <line x1="5" y1="10" x2="10" y2="5" stroke="var(--text-1)" strokeWidth="1.5" strokeLinecap="round"/>
              <line x1="8" y1="10" x2="10" y2="8" stroke="var(--text-1)" strokeWidth="1.5" strokeLinecap="round"/>
            </svg>
          </div>
        )}
      </div>

      {/* Zoom interno */}
      {internalZoomUrl && (
        <div onClick={() => setInternalZoomUrl(null)} style={{ position: 'fixed', inset: 0, zIndex: 30000, background: 'rgba(0,0,0,0.92)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <img src={internalZoomUrl} onClick={e => e.stopPropagation()} style={{ maxWidth: '90vw', maxHeight: '85vh', borderRadius: 10, display: 'block' }} />
        </div>
      )}
    </>,
    document.body,
  )
}

// Botón inline pegado al texto del ítem
function InlineGenButton({ item }: { item: InlineImageItem }) {
  const [showPanel, setShowPanel] = useState(false)

  return (
    <>
      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 3, marginLeft: 6, verticalAlign: 'middle' }}>
        {item.allVariations.map((v, i) => (
          <img
            key={i}
            src={v.url}
            onClick={e => { e.stopPropagation(); item.onZoom(v.url) }}
            title={v.condition ?? 'Click to view'}
            style={{ width: 22, height: 22, borderRadius: 3, objectFit: 'cover', cursor: 'zoom-in', border: '1px solid var(--line-2)', flexShrink: 0 }}
          />
        ))}
        <button
          disabled={item.isGenerating}
          onClick={e => {
            e.stopPropagation()
            if (item.imageUrl) { setShowPanel(true) } else { item.onGenerate() }
          }}
          title={item.isGenerating ? 'Generating image…' : item.imageUrl ? 'Generate a new variation' : 'Generate image for this item'}
          style={{
            fontSize: 9, padding: '1px 5px', borderRadius: 3, lineHeight: 1.4,
            border: '1px solid color-mix(in srgb, var(--action) 40%, transparent)',
            background: item.isGenerating
              ? 'color-mix(in srgb, var(--action) 14%, var(--bg-2))'
              : 'color-mix(in srgb, var(--action) 8%, var(--bg-2))',
            color: 'var(--action)', cursor: item.isGenerating ? 'not-allowed' : 'pointer',
            fontFamily: 'var(--font-mono)', flexShrink: 0,
            animation: item.isGenerating ? 'img-gen-pulse 1.2s ease-in-out infinite' : 'none',
          }}
        >
          {item.isGenerating ? 'Processing…' : item.imageUrl ? '↺' : '✦'}
        </button>
      </span>
      {showPanel && <VariationPanel item={item} onClose={() => setShowPanel(false)} />}
    </>
  )
}

// Tarjeta individual — muestra todas las variaciones como thumbnails separados
function ThumbnailCard({ item }: { item: InlineImageItem }) {
  const [showPanel, setShowPanel] = useState(false)
  const S = 80

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
      <div style={{ display: 'flex', gap: 4, alignItems: 'flex-end' }}>
        {/* Una thumbnail por variación */}
        {item.allVariations.map((v, i) => (
          <div
            key={i}
            style={{ width: S, height: S, borderRadius: 6, overflow: 'hidden', border: '1px solid var(--line-2)', flexShrink: 0 }}
          >
            <img
              src={v.url} alt=""
              onClick={() => item.onZoom(v.url)}
              style={{ width: '100%', height: '100%', objectFit: 'cover', cursor: 'zoom-in', display: 'block' }}
            />
          </div>
        ))}

        {/* Placeholder cuando no hay variaciones */}
        {item.allVariations.length === 0 && (
          <div style={{
            width: S, height: S, borderRadius: 6, border: '1px solid var(--line-2)',
            background: 'var(--bg-2)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
          }}>
            <span style={{
              fontSize: 9, color: 'var(--text-3)', textAlign: 'center',
              animation: item.isGenerating ? 'img-gen-pulse 1.2s ease-in-out infinite' : 'none',
            }}>
              {item.isGenerating ? 'Generating…' : '–'}
            </span>
          </div>
        )}

        {/* Botón generate / re-generate */}
        <button
          disabled={item.isGenerating}
          onClick={e => {
            e.stopPropagation()
            if (item.imageUrl) { setShowPanel(true) } else { item.onGenerate() }
          }}
          title={item.isGenerating ? 'Generating…' : item.imageUrl ? 'Generate a new variation' : 'Generate image'}
          style={{
            fontSize: 9, padding: '2px 6px', borderRadius: 5, lineHeight: 1.6,
            border: '1px solid color-mix(in srgb, var(--action) 40%, transparent)',
            background: item.isGenerating
              ? 'color-mix(in srgb, var(--action) 14%, var(--bg-2))'
              : 'color-mix(in srgb, var(--action) 8%, var(--bg-2))',
            color: 'var(--action)', cursor: item.isGenerating ? 'not-allowed' : 'pointer',
            fontFamily: 'var(--font-mono)', flexShrink: 0,
            animation: item.isGenerating ? 'img-gen-pulse 1.2s ease-in-out infinite' : 'none',
          }}
        >
          {item.isGenerating ? '…' : item.imageUrl ? '↺' : '✦'}
        </button>
      </div>
      <span style={{
        fontSize: 9, color: 'var(--text-3)', lineHeight: 1.35,
        overflow: 'hidden', display: '-webkit-box',
        WebkitLineClamp: 2, WebkitBoxOrient: 'vertical' as const,
        maxWidth: Math.max(item.allVariations.length, 1) * (S + 4),
      }}>
        {item.text.replace(/\*{1,2}([^*]+)\*{1,2}/g, '$1').split('\n')[0].slice(0, 70)}
      </span>
      {showPanel && <VariationPanel item={item} onClose={() => setShowPanel(false)} />}
    </div>
  )
}

// Grid de thumbnails — muestra todas las variaciones de cada ítem
export function ImageThumbnailRow({ items }: { items?: InlineImageItem[] }) {
  if (!items || items.length === 0) return null
  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, margin: '8px 0 4px 34px' }}>
      {items.map(item => <ThumbnailCard key={item.itemKey} item={item} />)}
    </div>
  )
}

// Extrae texto plano recursivamente de React children (más fiable que el AST hast)
function extractChildrenText(children: React.ReactNode): string {
  if (children === null || children === undefined) return ''
  if (typeof children === 'string') return children
  if (typeof children === 'number') return String(children)
  if (Array.isArray(children)) return children.map(extractChildrenText).join(' ')
  if (React.isValidElement(children)) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const cp = (children as any).props as { children?: React.ReactNode }
    return extractChildrenText(cp?.children)
  }
  return ''
}

// Construye components de ReactMarkdown que inyectan InlineGenButton en los ítems correspondientes
export function buildImageGenComponents(imageItems: InlineImageItem[]) {
  // Keys de outputs que tienen image gen — solo se inyectan botones dentro de esas secciones
  const imageGenKeys = new Set(imageItems.map(item => item.itemKey.split(':')[0]))

  // Flag mutable: true solo cuando el render está dentro de una sección image-gen (## outputKey)
  // Se actualiza al renderizar cada h2 — React renderiza el árbol depth-first, por lo que
  // el h2 se procesa antes que sus li/p hermanos, haciendo este patrón seguro
  let inImageGenSection = false

  // Mapa de número de variación → item — soporta "Variation 1:", "**Variation 1:**", etc.
  const byNumber = new Map<number, InlineImageItem>()
  for (const item of imageItems) {
    const m = /(?:^|\*{1,2})(?:[A-Za-z]+[ \t]+)?(\d+)[:.]/i.exec(item.text.trim())
    if (m && !byNumber.has(parseInt(m[1], 10))) {
      byNumber.set(parseInt(m[1], 10), item)
    }
  }

  // Normaliza texto para comparación robusta: strip markdown inline, colapsa espacios, lowercase, 60 chars
  function normKey(text: string): string {
    return text.replace(/\*{1,2}([^*]+)\*{1,2}/g, '$1').replace(/\s+/g, ' ').trim().toLowerCase().slice(0, 60)
  }

  // Mapa de texto normalizado → item — fallback para ítems nombrados sin número
  const byText = new Map<string, InlineImageItem>()
  for (const item of imageItems) {
    const key = normKey(item.text)
    if (key && !byText.has(key)) byText.set(key, item)
  }

  function findItemByNumber(text: string): InlineImageItem | undefined {
    const m = /(?:^|\s)([A-Za-z]+)\s+(\d+)\s*[:.]/i.exec(text.trim())
    if (!m) return undefined
    return byNumber.get(parseInt(m[2], 10))
  }

  function findItemByText(text: string): InlineImageItem | undefined {
    return byText.get(normKey(text))
  }

  // Inyecta botón en headings de nivel 3/4 dentro de secciones image-gen
  const wrapInner = (Tag: string, children: React.ReactNode, props: Record<string, unknown>) => {
    if (!inImageGenSection) return React.createElement(Tag, props, children)
    const text = extractChildrenText(children)
    const item = findItemByNumber(text) ?? findItemByText(text)
    if (item) {
      return React.createElement(Tag, props, children, React.createElement(InlineGenButton, { key: item.itemKey, item }))
    }
    return React.createElement(Tag, props, children)
  }

  // Inyecta botón en li/p solo si estamos dentro de una sección image-gen
  const wrapStrict = (Tag: string, children: React.ReactNode, props: Record<string, unknown>) => {
    if (!inImageGenSection) return React.createElement(Tag, props, children)
    const text = extractChildrenText(children)
    const atStart = /^(?:[A-Za-z_]+[ \t]*[\r\n]+)?[A-Za-z]+\s+\d+[ \t]*[:.]/i.test(text)
    const item = (atStart ? findItemByNumber(text) : undefined) ?? findItemByText(text)
    if (item) {
      return React.createElement(Tag, props, children, React.createElement(InlineGenButton, { key: item.itemKey, item }))
    }
    return React.createElement(Tag, props, children)
  }

  // node es un objeto hast de react-markdown — no debe pasarse al DOM
  /* eslint-disable @typescript-eslint/no-explicit-any */
  return {
    ...MD_COMPONENTS,
    // h2 es el heading de sección — actualiza el flag y nunca inyecta botón
    h2: ({ children, node: _n, ...p }: any) => {
      const key = extractChildrenText(children).trim().toLowerCase().replace(/[\s-]+/g, '_')
      inImageGenSection = imageGenKeys.has(key) || [...imageGenKeys].some(k => key.includes(k) || k.includes(key))
      return React.createElement('h2', p, children)
    },
    h1: ({ children, node: _n, ...p }: any) => wrapInner('h1', children, p),
    h3: ({ children, node: _n, ...p }: any) => wrapInner('h3', children, p),
    h4: ({ children, node: _n, ...p }: any) => wrapInner('h4', children, p),
    p:  ({ children, node: _n, ...p }: any) => wrapStrict('p',  children, p),
    li: ({ children, node: _n, ...p }: any) => wrapStrict('li', children, p),
  }
  /* eslint-enable @typescript-eslint/no-explicit-any */
}

// ─── Tool call chips ──────────────────────────────────────────────────────────

const TOOL_ICONS: Record<string, string> = {
  web_search:   '⌕',
  web_fetch:    '⌕',
  doc_gen_docx: '⬡',
  doc_gen_pptx: '⬡',
  kb_read:      '⎘',
}

function ToolCallChips({ calls }: { calls: ChatToolCall[] }) {
  const [open, setOpen] = React.useState(false)
  if (!calls.length) return null
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 4, paddingLeft: 34, marginBottom: 4 }}>
      <button
        onClick={() => setOpen(o => !o)}
        style={{
          display: 'inline-flex', alignItems: 'center', gap: 5,
          background: 'none', border: '1px solid var(--line-2)',
          borderRadius: 5, padding: '2px 8px',
          color: 'var(--text-3)', fontSize: 10, fontFamily: 'var(--font-mono)',
          cursor: 'pointer', width: 'fit-content', letterSpacing: '.02em',
        }}
      >
        <span style={{ fontSize: 9, opacity: 0.7 }}>{open ? '▾' : '▸'}</span>
        {calls.length} tool{calls.length > 1 ? 's' : ''} used
      </button>
      {open && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
          {calls.map((c, i) => (
            <div key={i} style={{
              display: 'flex', alignItems: 'flex-start', gap: 6,
              background: 'var(--bg-2)', border: '1px solid var(--line-2)',
              borderRadius: 5, padding: '4px 8px',
              fontSize: 10, fontFamily: 'var(--font-mono)', color: 'var(--text-2)',
            }}>
              <span style={{ color: 'var(--text-3)', flexShrink: 0 }}>{TOOL_ICONS[c.tool] ?? '⚙'}</span>
              <span style={{ color: 'var(--action)', flexShrink: 0 }}>{c.tool}</span>
              {c.args && Object.keys(c.args).length > 0 && (
                <span style={{ color: 'var(--text-3)', wordBreak: 'break-all' }}>
                  {Object.values(c.args).map(String).join(' · ').slice(0, 120)}
                </span>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

// ─── Burbuja ──────────────────────────────────────────────────────────────────

function MessageBubble({ msg, onExpand }: {
  msg:       ChatMessage
  onExpand?: () => void
}) {
  const isUser = msg.role === 'user'
  // Texto a copiar: la versión legible (markdown), igual a lo que se muestra
  const copyText = forDisplay(msg.content)
  return (
    <div style={{ display: 'flex', justifyContent: isUser ? 'flex-end' : 'flex-start', gap: 8, flexDirection: 'column', alignItems: isUser ? 'flex-end' : 'flex-start' }}>
      {!isUser && msg.tool_calls && msg.tool_calls.length > 0 && (
        <ToolCallChips calls={msg.tool_calls} />
      )}
      <div style={{ display: 'flex', justifyContent: isUser ? 'flex-end' : 'flex-start', gap: 8, width: '100%' }}>
        {!isUser && (
          <div style={{
            width: 26, height: 26, borderRadius: '50%', flexShrink: 0,
            border: '1px solid rgba(255,138,61,0.25)',
            background: 'rgba(255,138,61,0.12)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            marginTop: 2,
          }}>
            <img src="/forgy/forgyi.png" alt="Forge" style={{ width: 14, height: 14, objectFit: 'contain' }} />
          </div>
        )}
        <div style={{ maxWidth: isUser ? '80%' : '96%', position: 'relative' }}>
          <div style={{
            padding: '9px 13px',
            borderRadius: isUser ? '12px 12px 4px 12px' : '12px 12px 12px 4px',
            background: isUser
              ? 'color-mix(in srgb, var(--action) 16%, var(--bg-2))'
              : 'var(--bg-2)',
            border: `1px solid ${isUser
              ? 'color-mix(in srgb, var(--action) 30%, transparent)'
              : 'var(--line-2)'}`,
            fontSize: 12, color: 'var(--text-0)', lineHeight: 1.65,
            wordBreak: 'break-word',
          }}>
            {isUser ? (
              <span style={{ whiteSpace: 'pre-wrap' }}>{msg.content}</span>
            ) : (
              <div style={{ fontSize: 12, color: 'var(--text-0)', lineHeight: 1.65 }}>
                <ReactMarkdown remarkPlugins={[remarkGfm]} components={MD_COMPONENTS}>
                  {forDisplay(msg.content)}
                </ReactMarkdown>
              </div>
            )}
          </div>

          {/* Botón copiar como texto — mensajes del asistente */}
          {!isUser && (
            <CopyButton text={copyText} className="msg-expand-btn"
              style={{ position: 'absolute', top: 6, right: onExpand ? 30 : 6, opacity: 0, transition: 'opacity 120ms' }} />
          )}

          {/* Botón expandir — solo en mensajes del asistente */}
          {!isUser && onExpand && (
            <button
              onClick={onExpand}
              title="Expand response"
              style={{
                position: 'absolute', top: 6, right: 6,
                width: 20, height: 20, borderRadius: 4,
                border: '1px solid var(--line-2)',
                background: 'var(--bg-3)',
                color: 'var(--text-3)', fontSize: 10,
                cursor: 'pointer', display: 'flex',
                alignItems: 'center', justifyContent: 'center',
                lineHeight: 1, padding: 0,
                opacity: 0, transition: 'opacity 120ms',
              }}
              className="msg-expand-btn"
            >
              ⊞
            </button>
          )}
        </div>
      </div>

      {/* Attachments del mensaje (historial) */}
      {isUser && msg.attachments && msg.attachments.length > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4, alignItems: 'flex-end', paddingRight: 0 }}>
          {msg.attachments.map((att, i) => (
            <AttachmentCard key={i} attachment={att} variant="history" />
          ))}
        </div>
      )}
    </div>
  )
}


// ─── NodeChatWindow ───────────────────────────────────────────────────────────

export interface ImageOutputDef {
  outputKey:      string
  format:         string
  imageGenModel:  string  // "provider:model" — ej: comfyui:concept_ref, openai:dall-e-3
  /** El hermano que DECLARA sus imágenes, si lo hay. El pitch document no elige sus imágenes:
   *  las elige `pitch_image_plan`, con una entrada por imagen y su título. Sin esto, el documento
   *  sacaba los sujetos de su propia prosa y mandaba a ComfyUI las viñetas de mercado. */
  declaradasPor?: string | null
}

// Deriva el doc_url del último mensaje del asistente con un doc_gen tool_call. Necesario para
// que el botón de descarga reaparezca al reabrir el chat sin haber aceptado: el prop docUrl es
// transitorio, pero el tool_call (con su result.url) SÍ persiste en el mensaje de la sesión.
function docFromMessages(msgs: ChatMessage[]): { url: string; format?: string } | null {
  // Solo el ÚLTIMO mensaje del asistente: si la respuesta actual no generó doc (ej. una connection
  // como feel_statement), NO mostrar un botón viejo de una respuesta anterior del historial.
  const last = [...msgs].reverse().find(m => m.role === 'assistant')
  for (const tc of (last?.tool_calls ?? [])) {
    if (tc.tool !== 'doc_gen_docx' && tc.tool !== 'doc_gen_pptx') continue
    const r = tc.result as unknown
    let url: string | undefined
    let format: string | undefined
    if (r && typeof r === 'object') {
      url    = (r as { url?: string }).url
      format = (r as { format?: string }).format
    } else if (typeof r === 'string') {
      url = r.match(/https?:\/\/\S+/)?.[0]
    }
    if (url) return { url, format: format ?? (tc.tool === 'doc_gen_pptx' ? 'pptx' : 'pdf') }
  }
  return null
}

export interface NodeChatWindowProps {
  stepKey:          string
  stepLabel:        string
  currentOutput:    unknown
  project:          Project
  locked:           boolean
  modelName?:       string | null
  initialMessages?:  ChatMessage[]
  onMessagesChange?: (msgs: ChatMessage[]) => void
  onApply?:          (data: unknown) => void
  validateOutput?:   (data: unknown) => string | null  // null = válido, string = mensaje de error
  onClose:           () => void
  // Si se provee, reemplaza la llamada interna a chatWithNode
  onSend?:          (userMessage: string, file?: File | null, attachmentUrl?: string, signal?: AbortSignal) => Promise<{ reply: string; attachment?: ChatAttachment; messageId?: string }>
  onAccept?:        (content: string) => Promise<void>
  /** Le pide al backend que corte la generación. Es una petición aparte y no «cerrar el fetch»:
   *  el backend ya no deduce el Stop de una conexión caída, porque una corrida larga la pierde
   *  sola y así se tiraba trabajo ya pagado. */
  onStop?:          () => Promise<unknown>
  docUrl?:          string
  docFormat?:       string
  /** Hay imágenes de este nodo renderizándose: el documento todavía no las tiene. */
  imagesPending?:   boolean
  approvedAsset?:       ApprovedAsset
  // Image gen por item
  imageGenOutputs?:     ImageOutputDef[]
  outputImages?:        OutputImagesMap
  onGenerateItemImage?: (outputKey: string, itemIndex: number, itemText: string, condition?: string, messageId?: string) => Promise<{ image_url: string; output_images: OutputImagesMap }>
  // Output enfocado: el chat trabaja sobre un output específico del nodo
  targetOutputKey?:     string | null
  targetOutputLabel?:   string | null
  /** Contenido YA APROBADO de los otros outputs del nodo, por clave. Un output que declara sus
   *  imágenes en un hermano —el pitch document las declara en su plan— necesita ese hermano, y
   *  corriendo output por output el hermano no viene en la respuesta: vive en su propio asset. */
  siblingContent?:      Record<string, string>
  // Prompt de sistema que se usará (solo lectura, para referencia del usuario)
  systemPrompt?:        string
  // Panel de contexto — solo para nodos gate
  isGate?:              boolean
  projectNodeId?:       string | null
  onOpenOutput?:        (sourceProjectNodeId: string, outputKey?: string | null) => void
}

// Una conexión caída: el navegador la nombra distinto en cada motor —«Failed to fetch»,
// «Load failed», «NetworkError»— y ninguno de esos textos significa que el servidor haya fallado.
// La corrida sigue del otro lado y guarda al terminar.
function esConexionCaida (err: unknown): boolean {
  const m = err instanceof Error ? `${err.name} ${err.message}` : String(err)
  return /failed to fetch|load failed|networkerror|network error|err_/i.test(m)
}

export default function NodeChatWindow({
  stepKey, stepLabel, currentOutput, project, locked, modelName,
  initialMessages, onMessagesChange, onApply, validateOutput, onClose, onSend, onAccept, onStop, docUrl, docFormat, imagesPending,
  approvedAsset, imageGenOutputs, outputImages: outputImagesProp, onGenerateItemImage,
  targetOutputKey, targetOutputLabel, systemPrompt, siblingContent,
  isGate, projectNodeId, onOpenOutput,
}: NodeChatWindowProps) {
  const [messages,        setMessages]        = useState<ChatMessage[]>(initialMessages ?? [])
  const [moodOpen,        setMoodOpen]        = useState(false)   // moodboard filtrado a este nodo
  const [input,           setInput]           = useState('')
  const [sending,         setSending]         = useState(false)
  // El controlador del turno en vuelo, para que el botón Stop pueda abortarlo.
  const abortRef = useRef<AbortController | null>(null)
  const [applying,        setApplying]        = useState(false)
  const [accepting,       setAccepting]       = useState(false)
  // Mostrar Accept solo si no había output aprobado al abrir, o si el usuario generó algo nuevo
  const [hasNewResponse,  setHasNewResponse]  = useState(!approvedAsset)
  const [error,           setError]           = useState<string | null>(null)
  const [expandedContent, setExpandedContent] = useState<{ content: string; imageItems?: InlineImageItem[]; pngImages?: OutputImagesMap } | null>(null)
  // Modal expand: arrastrable (offset desde el centro). El resize lo hace CSS (resize: both).
  const [expandPos, setExpandPos] = useState({ x: 0, y: 0 })
  useEffect(() => { if (expandedContent) setExpandPos({ x: 0, y: 0 }) }, [expandedContent])  // re-centrar al abrir
  const onExpandDrag = (e: React.MouseEvent) => {
    if ((e.target as HTMLElement).closest('button, a')) return  // no arrastrar desde los controles
    const start = { sx: e.clientX, sy: e.clientY, ox: expandPos.x, oy: expandPos.y }
    const move = (me: MouseEvent) => setExpandPos({ x: start.ox + (me.clientX - start.sx), y: start.oy + (me.clientY - start.sy) })
    const up = () => { window.removeEventListener('mousemove', move); window.removeEventListener('mouseup', up) }
    window.addEventListener('mousemove', move); window.addEventListener('mouseup', up)
  }
  const [promptOpen,      setPromptOpen]      = useState(false)
  const [pendingFile,     setPendingFile]     = useState<File | null>(null)
  const [pendingUrl,      setPendingUrl]      = useState<string | null>(null)
  const [dropTarget,      setDropTarget]      = useState(false)
  const [outputImages,    setOutputImages]    = useState<OutputImagesMap>(outputImagesProp ?? {})
  // Lo generado en esta pantalla, por turno. El backend ya lo guarda en el mensaje, pero la
  // respuesta del generador trae el mapa de la SESIÓN: sin esto, la imagen recién hecha no
  // aparecería en su turno hasta recargar.
  const [imgsPorMsg,      setImgsPorMsg]      = useState<Record<string, OutputImagesMap>>({})
  const [generatingImgKeys, setGeneratingImgKeys] = useState<Set<string>>(new Set())  // set de "outputKey:index" en progreso
  const [zoomImageUrl,    setZoomImageUrl]    = useState<string | null>(null)
  // Panel de contexto (gate nodes)
  const [showCtxPanel,   setShowCtxPanel]   = useState(false)
  const [ctxInputs,      setCtxInputs]      = useState<NodeContextInput[]>([])
  const [ctxLoading,     setCtxLoading]     = useState(false)
  const [ctxOpenIdx,     setCtxOpenIdx]     = useState<number | null>(null)

  // Posición y tamaño del modal — calculados tras mount para evitar SSR
  const [pos,        setPos]        = useState({ x: 0, y: 0 })
  const [size,       setSize]       = useState({ w: WINDOW_W, h: WINDOW_H })
  const [maximized,  setMaximized]  = useState(false)
  const [positioned, setPositioned] = useState(false)
  const [dragging,   setDragging]   = useState(false)
  const [resizing,   setResizing]   = useState(false)
  const dragOrigin   = useRef<{ sx: number; sy: number; ox: number; oy: number } | null>(null)
  const resizeOrigin = useRef<{ sx: number; sy: number; ow: number; oh: number } | null>(null)
  const savedGeom    = useRef<{ pos: { x: number; y: number }; size: { w: number; h: number } } | null>(null)
  // Ref para acceder al tamaño actual sin closure stale
  const sizeRef      = useRef({ w: WINDOW_W, h: WINDOW_H })

  const bottomRef  = useRef<HTMLDivElement>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)

  const inputRef = useRef<HTMLTextAreaElement>(null)

  // Posición y tamaño iniciales: lado derecho, centrado verticalmente
  useEffect(() => {
    const w = Math.min(WINDOW_W, window.innerWidth  - MARGIN * 2)
    const h = Math.min(WINDOW_H, window.innerHeight - MARGIN * 2)
    const x = Math.max(window.innerWidth  - w - MARGIN, MARGIN)
    const y = Math.max((window.innerHeight - h) / 2,    MARGIN)
    sizeRef.current = { w, h }
    setSize({ w, h })
    setPos({ x, y })
    setPositioned(true)
  }, [])

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages, sending])

  // Sincroniza el historial al padre para que persista entre aperturas
  useEffect(() => {
    if (messages.length > 0) onMessagesChange?.(messages)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [messages])

  // Enfocar el input al abrir el chat, al cambiar de nodo/output (focus / chat-to-generate /
  // run-node), al desbloquearse, y al terminar un envío — SOLO si es chateable (no locked).
  // El delay cubre el render/animación de apertura de la ventana.
  useEffect(() => {
    if (locked || sending) return
    const t = setTimeout(() => inputRef.current?.focus(), 60)
    return () => clearTimeout(t)
  }, [sending, stepKey, targetOutputKey, locked])

  // Botón de descarga: usa el docUrl transitorio (recién generado) o, al reabrir el chat sin
  // haber aceptado, lo deriva del tool_call persistido en el mensaje.
  const derivedDoc         = React.useMemo(() => docFromMessages(messages), [messages])
  // Un output de imagen (png/image) no tiene PDF. Aunque un mensaje YA generado traiga un doc_gen
  // tool_call (creado antes del guard de backend que ya no lo genera), no mostrar "Descargar PDF"
  // cuando el foco es un output de imagen — su salida son las imágenes, no un documento.
  const focusIsImageOutput = !!targetOutputKey && (imageGenOutputs ?? []).some(
    d => d.outputKey === targetOutputKey && ['png', 'png[]', 'image', 'image[]'].includes((d.format || '').toLowerCase()),
  )
  const effectiveDocUrl    = focusIsImageOutput ? undefined : (docUrl ?? derivedDoc?.url)
  const effectiveDocFormat = focusIsImageOutput ? undefined : (docFormat ?? derivedDoc?.format)

  // ── Drag ──────────────────────────────────────────────────────────────────

  const onMouseMove = useCallback((e: MouseEvent) => {
    if (!dragOrigin.current) return
    const nx = dragOrigin.current.ox + e.clientX - dragOrigin.current.sx
    const ny = dragOrigin.current.oy + e.clientY - dragOrigin.current.sy
    // Clamp usando sizeRef para evitar closure stale
    setPos({
      x: Math.max(MARGIN, Math.min(nx, window.innerWidth  - sizeRef.current.w - MARGIN)),
      y: Math.max(MARGIN, Math.min(ny, window.innerHeight - sizeRef.current.h - MARGIN)),
    })
  }, [])

  const onMouseUp = useCallback(() => {
    dragOrigin.current = null
    setDragging(false)
    window.removeEventListener('mousemove', onMouseMove)
    window.removeEventListener('mouseup',   onMouseUp)
  }, [onMouseMove])

  const onDragStart = (e: React.MouseEvent) => {
    if (maximized) return
    e.preventDefault()
    dragOrigin.current = { sx: e.clientX, sy: e.clientY, ox: pos.x, oy: pos.y }
    setDragging(true)
    window.addEventListener('mousemove', onMouseMove)
    window.addEventListener('mouseup',   onMouseUp)
  }

  // ── Resize ────────────────────────────────────────────────────────────────

  const onResizeMove = useCallback((e: MouseEvent) => {
    if (!resizeOrigin.current) return
    const MIN_W = 300, MIN_H = 360
    const nw = Math.max(MIN_W, Math.min(resizeOrigin.current.ow + e.clientX - resizeOrigin.current.sx, window.innerWidth  - MARGIN))
    const nh = Math.max(MIN_H, Math.min(resizeOrigin.current.oh + e.clientY - resizeOrigin.current.sy, window.innerHeight - MARGIN))
    sizeRef.current = { w: nw, h: nh }
    setSize({ w: nw, h: nh })
  }, [])

  const onResizeEnd = useCallback(() => {
    resizeOrigin.current = null
    setResizing(false)
    window.removeEventListener('mousemove', onResizeMove)
    window.removeEventListener('mouseup',   onResizeEnd)
  }, [onResizeMove])

  const onResizeStart = (e: React.MouseEvent) => {
    e.preventDefault()
    e.stopPropagation()
    resizeOrigin.current = { sx: e.clientX, sy: e.clientY, ow: sizeRef.current.w, oh: sizeRef.current.h }
    setResizing(true)
    window.addEventListener('mousemove', onResizeMove)
    window.addEventListener('mouseup',   onResizeEnd)
  }

  // ── Maximizar ─────────────────────────────────────────────────────────────

  const toggleMaximize = () => {
    if (maximized) {
      // Restaurar geometría guardada
      const g = savedGeom.current
      if (g) {
        sizeRef.current = g.size
        setSize(g.size)
        setPos(g.pos)
      }
      setMaximized(false)
    } else {
      savedGeom.current = { pos, size }
      setMaximized(true)
    }
  }

  // ── Auto-generación de imágenes al recibir respuesta del asistente ──────────

  // Texto de los ítems del turno anterior, por output. Es lo que permite saber qué cambió de
  // verdad en una iteración: los índices no se mueven, así que sin comparar el texto no hay forma
  // de distinguir «este prompt es otro» de «este quedó igual».
  const textoItemsPrevios = (outputKey: string, format: string): string[] => {
    for (let i = messages.length - 1; i >= 0; i--) {
      if (messages[i].role !== 'assistant') continue
      const m = outputHeaderRx(outputKey).exec(messages[i].content)
      const sec = m ? messages[i].content.slice(m.index + m[0].length) : messages[i].content
      const items = parseOutputItems(sec.trim() || messages[i].content, format)
      if (items.length) return items
    }
    return []
  }

  const triggerAutoImageGen = (content: string, messageId?: string) => {
    if (!imageGenOutputs?.length || !onGenerateItemImage) return
    const autoItems: Array<{ outputKey: string; idx: number; text: string; key: string }> = []

    // ¿Algún output de imagen trae sección explícita en el mensaje? Sirve para no duplicar el
    // fallback-al-contenido-completo cuando hay varios outputs de imagen y solo algunos traen sección.
    const anySectionFound = imageGenOutputs.some(def => {
      if (!(def.format === 'png' || def.format === 'image')) return false
      return outputHeaderRx(def.outputKey).test(content)
    })

    for (const def of imageGenOutputs) {
      const isPng = def.format === 'png' || def.format === 'image'
      // Auto-gen solo para outputs PNG/image — otros formatos usan botón on-demand
      if (!isPng) continue
      // En una sesión focus solo auto-generamos la imagen del output enfocado; esto evita que un
      // focus de OTRO output (ej. visual_targets) dispare la imagen de reference_images.
      if (targetOutputKey && def.outputKey !== targetOutputKey) continue

      // El run del NODO ENTERO ya no despacha desde acá: lo hace el motor, que lee los prompts del
      // sobre de emisión y, si falta, se lo pide. Este parser cae a las viñetas del documento
      // cuando no hay sobre, y eso mandó a ComfyUI párrafos de análisis de mercado como si fueran
      // arte — medido: 3 renders, $0.12, ninguna imagen utilizable.
      if (!targetOutputKey) continue
      const startRx = outputHeaderRx(def.outputKey)
      const sectionMatch = startRx.exec(content)

      // PNG sin sección explícita y sin ser el foco: no usar el fallback al contenido completo si
      // otro output de imagen sí trae sección (evita generar la imagen del documento entero duplicada).
      if (!sectionMatch && def.outputKey !== targetOutputKey && anySectionFound) continue

      const otherEscaped = imageGenOutputs
        .filter(d => d.outputKey !== def.outputKey)
        .map(d => outputHeaderPat(d.outputKey))
      const nextRx = otherEscaped.length > 0
        ? new RegExp(`^(?:#{1,4}\\s+)?(?:${otherEscaped.join('|')})\\b`, 'im')
        : null
      const section = sectionMatch
        ? (() => {
            const after = content.slice(sectionMatch.index + sectionMatch[0].length)
            const next  = nextRx ? nextRx.exec(after) : null
            const s = (next ? after.slice(0, next.index) : after).trim()
            return s || content
          })()
        : content

      if (!tieneEntidades(section, def.format, def.outputKey)) {
        console.warn(`[chat] ${def.outputKey}: la respuesta no trae entidades — no se generan imágenes`)
        continue
      }

      const previos = textoItemsPrevios(def.outputKey, def.format)
      parseOutputItems(section, def.format, def.outputKey).forEach((text, idx) => {
        const tieneImagen = (outputImages[def.outputKey] ?? []).some(s => s.index === idx && s.variations?.length > 0)
        // Antes bastaba con tener imagen para saltarlo, y eso volvía inútil TODA iteración: la
        // primera corrida llenaba los N ítems y de ahí en más ninguna respuesta generaba nada,
        // así que el prompt nuevo se seguía mostrando con la imagen vieja. Ahora lo que decide es
        // si el prompt CAMBIÓ; un ítem idéntico conserva su imagen, porque volver a pedirla cuesta
        // y además devuelve otra cosa (la generación no es reproducible).
        const sinCambios = previos[idx] != null && previos[idx].trim() === text.trim()
        if (tieneImagen && sinCambios) return
        autoItems.push({ outputKey: def.outputKey, idx, text, key: `${def.outputKey}:${idx}` })
      })
    }
    if (!autoItems.length) return
    setGeneratingImgKeys(new Set(autoItems.map(i => i.key)))
    for (const { outputKey, idx, text, key } of autoItems) {
      onGenerateItemImage(outputKey, idx, text, undefined, messageId)
        .then(r => {
          setOutputImages(r.output_images)
          // La imagen queda colgada del turno que la produjo: la sesión guarda «lo último
          // vigente» y cada respuesta conserva lo suyo.
          if (messageId) setImgsPorMsg(prev => {
            const mapa  = { ...(prev[messageId] ?? {}) }
            const lista = [...(mapa[outputKey] ?? [])]
            const j     = lista.findIndex(s => s.index === idx)
            const nueva = { url: r.image_url, condition: null }
            if (j >= 0) lista[j] = { ...lista[j], variations: [...(lista[j].variations ?? []), nueva] }
            else        lista.push({ index: idx, variations: [nueva] })
            return { ...prev, [messageId]: { ...mapa, [outputKey]: lista.sort((a, b) => a.index - b.index) } }
          })
        })
        .catch(e => console.error('[auto-image-gen]', outputKey, idx, e))
        .finally(() => setGeneratingImgKeys(prev => { const n = new Set(prev); n.delete(key); return n }))
    }
  }

  // ── Chat ──────────────────────────────────────────────────────────────────

  const send = async () => {
    const text = input.trim()
    if (!text || sending) return
    const file    = pendingFile
    const urlAtt  = pendingUrl
    setMessages(prev => [...prev, { role: 'user', content: text }])
    setInput('')
    setPendingFile(null)
    setPendingUrl(null)
    setSending(true)
    setError(null)
    // Abortarlo suelta al cliente. Parar de verdad la generación es otra cosa —`onStop`, que le
    // pide al backend que corte— porque el backend ya no deduce el Stop de que se cierre la
    // conexión: una corrida larga la pierde sola y así se tiraba trabajo pagado.
    const abortar = new AbortController()
    abortRef.current = abortar
    try {
      if (onSend) {
        const result = await onSend(text, file, urlAtt ?? undefined, abortar.signal)
        // El id del turno se calcula ANTES de agregarlo al historial: `triggerAutoImageGen` mira
        // los mensajes previos para saber qué cambió, y si el nuevo ya estuviera ahí se compararía
        // contra sí mismo — todo saldría «sin cambios» y no se generaría nada.
        triggerAutoImageGen(result.reply, result.messageId)
        setMessages(prev => {
          // Adjuntar info de attachment al último mensaje humano si la respuesta lo incluye
          const updated = result.attachment
            ? prev.map((m, i) => i === prev.length - 1 && m.role === 'user'
                ? { ...m, attachments: [result.attachment!] }
                : m
              )
            : [...prev]
          return [...updated, { id: result.messageId, role: 'assistant', content: result.reply }]
        })
        setHasNewResponse(true)
      } else {
        const res = await chatWithNode(stepKey, messages, text, currentOutput, project.id)
        setMessages(prev => [...prev, { role: 'assistant', content: res.reply }])
        setHasNewResponse(true)
        triggerAutoImageGen(res.reply)
      }
    } catch (err) {
      // Cancelar no es un error: lo pidió el usuario. Se deja constancia en el hilo para que no
      // parezca que el turno se perdió solo.
      if ((err as Error)?.name === 'AbortError') {
        setMessages(prev => [...prev, { role: 'assistant', content: '_Generation stopped._' }])
      } else if (esConexionCaida(err)) {
        // La conexión se cayó, no la corrida: el backend sigue trabajando y guarda al terminar.
        // Decir «failed to fetch» aquí hacía creer que se había perdido un TDD de trece minutos que
        // en realidad estaba a medio hacer y terminó bien.
        setMessages(prev => [...prev, { role: 'assistant', content:
          '_The connection dropped, but the run kept going on the server. It will appear here when it finishes — reopening this node also shows it._' }])
      } else {
        setError(err instanceof Error ? err.message : 'Error contacting assistant')
      }
    } finally {
      abortRef.current = null
      setSending(false)
    }
  }

  // Parar es pedirlo, no colgar el teléfono. Se avisa al backend primero —es lo que corta el gasto
  // de verdad— y recién después se suelta el fetch.
  const detener = () => {
    if (onStop) onStop().catch(() => {})
    abortRef.current?.abort()
  }


  // Extrae JSON de la conversación, valida y llama onApply
  const applyOutput = async () => {
    if (!onApply || applying || sending) return
    setApplying(true)
    setError(null)
    try {
      const { reply } = await chatWithNode(
        stepKey, messages,
        'Return the complete updated list as a raw JSON array only. No markdown fences, no explanations.',
        currentOutput, project.id, true,
      )
      // Limpiar posibles markdown fences que el LLM incluya de todas formas
      const clean = reply.replace(/```(?:json)?\s*/gi, '').replace(/```/g, '').trim()
      let parsed: unknown
      try {
        parsed = JSON.parse(clean)
      } catch {
        setError('The assistant did not return valid JSON. Ask it to list the items again before applying.')
        return
      }
      // Validar estructura esperada
      if (validateOutput) {
        const validationError = validateOutput(parsed)
        if (validationError) {
          setError(validationError)
          return
        }
      }
      onApply(parsed)
    } catch {
      setError('Could not contact the assistant. Try again.')
    } finally {
      setApplying(false)
    }
  }

  // En modo focus (targetOutputKey) la vista de imágenes se restringe al output enfocado; en modo
  // nodo/general se muestran todas. Evita ver imágenes de otros outputs (confuso).
  const visibleOutputImages = (targetOutputKey
    ? Object.fromEntries(Object.entries(outputImages ?? {}).filter(([k]) => k === targetOutputKey))
    : outputImages ?? {}) as typeof outputImages

  // Construye InlineImageItem[] desde cualquier contenido usando el estado actual de outputImages
  const buildItemsFromContent = (content: string): InlineImageItem[] | undefined => {
    // En focus, restringir al output enfocado (ver imágenes de otros outputs es confuso).
    const defs = targetOutputKey ? (imageGenOutputs ?? []).filter(d => d.outputKey === targetOutputKey) : (imageGenOutputs ?? [])
    if (!defs.length || !onGenerateItemImage) return undefined
    const items: InlineImageItem[] = []
    let fullMsgUsed = false
    for (const def of defs) {
      const isPng = def.format === 'png' || def.format === 'image'
      const startRx = outputHeaderRx(def.outputKey)
      const sectionMatch = startRx.exec(content)
      if (!sectionMatch && fullMsgUsed && !isPng) continue
      const otherEscaped = defs.filter(d => d.outputKey !== def.outputKey)
        .map(d => outputHeaderPat(d.outputKey))
      const nextRx = otherEscaped.length > 0
        ? new RegExp(`^(?:#{1,4}\\s+)?(?:${otherEscaped.join('|')})\\b`, 'im') : null
      const section = sectionMatch
        ? (() => {
            const after = content.slice(sectionMatch.index + sectionMatch[0].length)
            const next = nextRx ? nextRx.exec(after) : null
            const s = (next ? after.slice(0, next.index) : after).trim()
            return s || content
          })()
        : content
      if (!sectionMatch && !isPng) fullMsgUsed = true
      const parsed = parseOutputItems(section, def.format, def.outputKey)
      const savedList = outputImages[def.outputKey] ?? []
      for (let idx = 0; idx < parsed.length; idx++) {
        const itemText = parsed[idx]
        const saved = savedList.find(s => s.index === idx)
        const variations = saved?.variations ?? []
        const key = `${def.outputKey}:${idx}`
        items.push({
          itemKey: key, index: idx, text: itemText,
          imageUrl: variations.at(-1)?.url ?? null,
          allVariations: variations,
          isGenerating: generatingImgKeys.has(key),
          onZoom: url => setZoomImageUrl(url),
          onGenerate: async (condition?: string) => {
            setGeneratingImgKeys(prev => new Set(prev).add(key))
            try {
              const r = await onGenerateItemImage(def.outputKey, idx, itemText, condition)
              setOutputImages(r.output_images)
            } catch (e) {
              setError(e instanceof Error ? e.message : 'Image generation failed')
            } finally {
              setGeneratingImgKeys(prev => { const n = new Set(prev); n.delete(key); return n })
            }
          },
        })
      }
    }
    return items.length > 0 ? items : undefined
  }

  const handleToggleCtxPanel = useCallback(async () => {
    if (showCtxPanel) { setShowCtxPanel(false); return }
    setShowCtxPanel(true)
    if (ctxInputs.length > 0 || !projectNodeId) return
    setCtxLoading(true)
    try {
      const inputs = await getNodeContextInputs(project.id, projectNodeId)
      setCtxInputs(inputs)
    } catch (e) {
      console.error('[context-panel]', e)
    } finally {
      setCtxLoading(false)
    }
  }, [showCtxPanel, ctxInputs.length, projectNodeId, project.id])

  if (!positioned) return null

  return (
    <>
      <style>{KEYFRAMES}</style>

      {/* Ventana flotante — sin overlay, no bloquea el modal de fondo */}
      <div style={{
        position:     'fixed',
        left:         maximized ? 0 : pos.x,
        top:          maximized ? 0 : pos.y,
        zIndex:       110,
        width:        maximized ? '100vw' : size.w,
        height:       maximized ? '100vh' : size.h,
        background:   'var(--bg-1)',
        borderRadius: maximized ? 0 : 14,
        border:       '1px solid var(--line-2)',
        boxShadow:    maximized ? 'none' : '0 24px 64px rgba(0,0,0,0.55), 0 0 0 1px rgba(255,255,255,0.04)',
        display:      'flex', flexDirection: 'column', overflow: 'hidden',
        userSelect:   dragging || resizing ? 'none' : 'auto',
        transition:   maximized ? 'none' : undefined,
      }}>

        {/* Header — drag handle */}
        <div
          onMouseDown={onDragStart}
          style={{
            padding: '12px 14px',
            borderBottom: '1px solid var(--line-2)',
            display: 'flex', alignItems: 'center', gap: 10,
            flexShrink: 0,
            background: 'var(--bg-2)',
            cursor: dragging ? 'grabbing' : 'grab',
          }}
        >
          <div style={{
            width: 30, height: 30, borderRadius: '50%', flexShrink: 0,
            border: '1px solid rgba(255,138,61,0.25)',
            background: 'rgba(255,138,61,0.12)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}>
            <img src="/forgy/forgyi.png" alt="Forge" style={{ width: 16, height: 16, objectFit: 'contain' }} />
          </div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--text-0)', lineHeight: 1.2 }}>
              Forge Assistant
            </div>
            <div style={{ fontSize: 9, fontFamily: 'var(--font-mono)', color: 'var(--text-3)', marginTop: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {stepLabel}
            </div>
            {targetOutputKey && (
              <div style={{ display: 'flex', alignItems: 'center', gap: 4, marginTop: 3 }}>
                <span style={{
                  fontSize: 8, fontFamily: 'var(--font-mono)', fontWeight: 700,
                  color: '#F59E0B',
                  background: 'color-mix(in srgb, #F59E0B 10%, var(--bg-3))',
                  border: '1px solid color-mix(in srgb, #F59E0B 25%, var(--line-2))',
                  padding: '1px 6px', borderRadius: 3,
                }}>
                  ◆ {targetOutputLabel ?? targetOutputKey}
                </span>
              </div>
            )}
          </div>
          {locked && (
            <span style={{
              fontSize: 9, fontFamily: 'var(--font-mono)', fontWeight: 600,
              padding: '2px 7px', borderRadius: 4, flexShrink: 0,
              background: 'rgba(52,211,153,0.10)', color: '#34D399',
              border: '1px solid rgba(52,211,153,0.20)',
            }}>
              ✓ Read only
            </span>
          )}
          {/* Grip — mano blanca, igual al cursor grab del modal */}
          <span style={{ fontSize: 15, flexShrink: 0, lineHeight: 1, opacity: 0.55, userSelect: 'none', filter: 'brightness(0) invert(1)' }}>🖐️</span>
          {/* Moodboard del nodo — abre filtrado a lo que ESTE nodo produjo.
              Va inline y no con el FAB arrastrable: el FAB guarda su posición en una sola clave
              de localStorage, así que montarlo acá lo dejaría encima del botón del proyecto. */}
          <button
            onMouseDown={e => e.stopPropagation()}
            onClick={() => setMoodOpen(true)}
            title={`Moodboard — ${stepKey}`}
            style={{ border: 'none', background: 'transparent', cursor: 'pointer', padding: '2px 6px', borderRadius: 6, flexShrink: 0, display: 'inline-flex', alignItems: 'center', opacity: 0.75 }}
            onMouseEnter={e => { e.currentTarget.style.opacity = '1' }}
            onMouseLeave={e => { e.currentTarget.style.opacity = '0.75' }}
          >
            <img src="/forgy/forgyi.png" alt="" width={17} height={17} draggable={false} style={{ objectFit: 'contain', display: 'block' }} />
          </button>
          {/* Botón maximizar */}
          <button
            onMouseDown={e => e.stopPropagation()}
            onClick={toggleMaximize}
            title={maximized ? 'Restore' : 'Maximize'}
            style={{ border: 'none', background: 'transparent', cursor: 'pointer', color: 'var(--text-2)', padding: '4px 8px', borderRadius: 6, flexShrink: 0, display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }}
          >
            {maximized ? (
              <svg width="13" height="13" viewBox="0 0 13 13" fill="none" style={{ display: 'block' }}>
                <rect x="3.75" y="0.75" width="8.5" height="8.5" stroke="currentColor" strokeWidth="1.5" rx="1"/>
                <rect x="0.75" y="3.75" width="8.5" height="8.5" stroke="currentColor" strokeWidth="1.5" rx="1" fill="var(--bg-1)"/>
              </svg>
            ) : (
              <svg width="13" height="13" viewBox="0 0 13 13" fill="none" style={{ display: 'block' }}>
                <rect x="0.75" y="0.75" width="11.5" height="11.5" stroke="currentColor" strokeWidth="1.5" rx="1"/>
              </svg>
            )}
          </button>
          <button
            onMouseDown={e => e.stopPropagation()}
            onClick={onClose}
            style={{
              border: 'none', background: 'transparent', cursor: 'pointer',
              color: 'var(--text-2)', fontSize: 16, padding: '4px 8px',
              borderRadius: 6, lineHeight: 1, flexShrink: 0,
            }}
          >
            ✕
          </button>
        </div>

        {/* System prompt — colapsable, solo lectura */}
        {systemPrompt && (
          <div style={{ borderBottom: '1px solid var(--line-2)', flexShrink: 0 }}>
            <div style={{ display: 'flex', alignItems: 'center' }}>
              {/* Botón panel de contexto — disponible en todos los nodos */}
              {projectNodeId && (
                <button
                  onMouseDown={e => e.stopPropagation()}
                  onClick={handleToggleCtxPanel}
                  title="View context inputs"
                  style={{
                    border: `1px solid ${showCtxPanel ? 'color-mix(in srgb, var(--action) 40%, transparent)' : 'transparent'}`,
                    background: showCtxPanel ? 'color-mix(in srgb, var(--action) 12%, var(--bg-3))' : 'transparent',
                    cursor: 'pointer',
                    color: showCtxPanel ? 'var(--action)' : 'var(--text-3)',
                    padding: '4px 8px', marginLeft: 6, borderRadius: 6, flexShrink: 0,
                    display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                    transition: 'all 120ms',
                  }}
                >
                  {/* Tres flechas apuntando hacia una barra vertical = inputs confluyendo al nodo */}
                  <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
                    <line x1="1" y1="3"  x2="8" y2="3"  stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
                    <polyline points="6,1.5 8,3 6,4.5" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" strokeLinecap="round" fill="none"/>
                    <line x1="1" y1="7"  x2="8" y2="7"  stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
                    <polyline points="6,5.5 8,7 6,8.5" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" strokeLinecap="round" fill="none"/>
                    <line x1="1" y1="11" x2="8" y2="11" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
                    <polyline points="6,9.5 8,11 6,12.5" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" strokeLinecap="round" fill="none"/>
                    <line x1="11" y1="1" x2="11" y2="13" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
                  </svg>
                </button>
              )}
              <button
                onClick={() => setPromptOpen(v => !v)}
                style={{
                  flex: 1, display: 'flex', alignItems: 'center', gap: 6,
                  padding: '6px 14px', border: 'none', background: 'none', cursor: 'pointer',
                  color: 'var(--text-3)', fontSize: 9, fontFamily: 'var(--font-mono)', fontWeight: 600,
                  letterSpacing: '.06em', textTransform: 'uppercase', textAlign: 'right',
                  justifyContent: 'flex-end',
                }}
              >
                {targetOutputKey && (
                  <span style={{ color: '#F59E0B', opacity: 0.7 }}>· base + {targetOutputLabel ?? targetOutputKey}</span>
                )}
                System Prompt
                <span style={{ opacity: 0.6, fontSize: 8, lineHeight: 1 }}>{promptOpen ? '▾' : '▸'}</span>
              </button>
            </div>
            {promptOpen && (
              <div style={{
                margin: '0 10px 10px',
                background: 'var(--bg-0)', border: '1px solid var(--line-2)',
                borderRadius: 6, padding: '10px 12px',
                fontSize: 10, fontFamily: 'var(--font-mono)', color: 'var(--text-2)',
                lineHeight: 1.6, whiteSpace: 'pre-wrap', wordBreak: 'break-word',
                maxHeight: 200, overflowY: 'auto',
              }}>
                {systemPrompt}
              </div>
            )}
          </div>
        )}

        {/* Input de archivo oculto */}
        <input
          ref={fileInputRef}
          type="file"
          accept=".pdf,.doc,.docx,.ppt,.pptx,.txt,.md,.json,image/*"
          style={{ display: 'none' }}
          onChange={e => {
            const f = e.target.files?.[0] ?? null
            if (f) { setPendingFile(f); setPendingUrl(null) }
            e.target.value = ''
          }}
        />

        {/* Mensajes */}
        <div
          style={{
            flex: '1 1 0', minHeight: 0, overflowY: 'auto',
            padding: '16px 14px',
            display: 'flex', flexDirection: 'column', gap: 12,
            position: 'relative',
            outline: dropTarget ? '2px dashed var(--action)' : 'none',
            outlineOffset: -4,
            transition: 'outline 120ms',
          }}
          onDragOver={e => { e.preventDefault(); setDropTarget(true) }}
          onDragLeave={() => setDropTarget(false)}
          onDrop={e => {
            e.preventDefault()
            setDropTarget(false)
            const f = e.dataTransfer.files[0]
            if (f) { setPendingFile(f); setPendingUrl(null) }
          }}
        >
          {messages.length === 0 && (
            <div style={{ margin: 'auto', textAlign: 'center', maxWidth: 280, padding: '12px 0', display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
              <img src="/forgy/forgyi.png" alt="Forge" style={{ width: 36, height: 36, objectFit: 'contain', marginBottom: 10, opacity: 0.6 }} />
              <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--text-0)', marginBottom: 6, lineHeight: 1.3 }}>
                {locked ? 'Ask about this output' : 'How can I help?'}
              </div>
              <div style={{ fontSize: 11, color: 'var(--text-2)', lineHeight: 1.6 }}>
                {locked
                  ? 'Step is approved. You can ask questions but changes are disabled.'
                  : 'Ask me to adjust tone, focus, constraints, or explain my reasoning.'}
              </div>
            </div>
          )}

          {messages.map((msg, i) => {
            if (msg.role !== 'assistant') {
              return <MessageBubble key={i} msg={msg} />
            }

            // Solo el último mensaje del asistente muestra el grid de imágenes
            const isLastAssistant = messages.slice(i + 1).every(m => m.role !== 'assistant')

            // Para mensajes del asistente: construir imageItems para el modal expandido
            // Qué outputs se saltaron por no traer entidades. Se junta acá para poder DECIRLO:
            // que no aparezcan huecos es la señal correcta, pero sin explicación parece que la
            // función se rompió.
            const sinEntidades = new Set<string>()

            const buildItems = (): InlineImageItem[] | undefined => {
              // En focus, restringir al output enfocado (no mostrar imágenes de otros outputs).
              const defs = targetOutputKey ? (imageGenOutputs ?? []).filter(d => d.outputKey === targetOutputKey) : (imageGenOutputs ?? [])
              if (defs.length === 0 || !onGenerateItemImage) return undefined
              const items: InlineImageItem[] = []
              let fullMsgUsed = false  // evita agregar ítems duplicados cuando múltiples outputs usan el msg completo

              for (const def of defs) {
                const isPng = def.format === 'png' || def.format === 'image'
                const startRx     = outputHeaderRx(def.outputKey)
                const sectionMatch = startRx.exec(msg.content)

                // PNG outputs nunca se saltan: cada output imagen genera su propia imagen independientemente
                if (!sectionMatch && fullMsgUsed && !isPng) continue

                // nextRx dinámico: solo cortar en otras claves conocidas, nunca en headings arbitrarios
                const otherEscaped = defs
                  .filter(d => d.outputKey !== def.outputKey)
                  .map(d => outputHeaderPat(d.outputKey))
                const nextRx = otherEscaped.length > 0
                  ? new RegExp(`^(?:#{1,4}\\s+)?(?:${otherEscaped.join('|')})\\b`, 'im')
                  : null

                const section = sectionMatch
                  ? (() => {
                      const after = msg.content.slice(sectionMatch.index + sectionMatch[0].length)
                      const next  = nextRx ? nextRx.exec(after) : null
                      const s = (next ? after.slice(0, next.index) : after).trim()
                      return s || msg.content  // sección vacía → fallback a mensaje completo
                    })()
                  : msg.content

                // Solo marcar fullMsgUsed para outputs no-imagen
                if (!sectionMatch && !isPng) fullMsgUsed = true

                // Sin entidades no hay nada que ilustrar: no se ofrecen huecos. El caso típico
                // es que el nodo corrió sin sus inputs y respondió pidiendo datos — ahí un botón
                // de generar solo sirve para pagar la imagen de un párrafo.
                if (!def.declaradasPor && !tieneEntidades(section, def.format, def.outputKey)) {
                  sinEntidades.add(def.outputKey)
                  continue
                }

                // Si otro output declara sus imágenes, los ítems salen de la sección de ESE
                // hermano — no de la prosa propia. Y si el hermano no está en la respuesta, no
                // hay imágenes declaradas: mejor decirlo que inventar sujetos.
                let fuente = section
                if (def.declaradasPor) {
                  const planRx = outputHeaderRx(def.declaradasPor)
                  let m = planRx.exec(msg.content)
                  let texto = msg.content

                  // Corriendo output por output, el hermano NO está en esta respuesta: vive en su
                  // propio asset aprobado. Antes se avisaba «no hay imágenes que ofrecer» y el
                  // pitch document se quedaba sin ninguna, teniendo su plan de 4 entradas
                  // aprobado ahí al lado. El hermano solo se usa si el mensaje no lo trae: lo que
                  // se acaba de generar siempre manda sobre lo guardado.
                  if (!m) {
                    const guardado = siblingContent?.[def.declaradasPor]
                    if (guardado) {
                      const m2 = outputHeaderRx(def.declaradasPor).exec(guardado)
                      // El asset del hermano puede venir con su encabezado o sin él —depende de
                      // si se aceptó el nodo entero o ese output suelto—; los dos casos sirven.
                      texto = guardado
                      m = m2 ?? ({ index: 0, 0: '' } as unknown as RegExpExecArray)
                    }
                  }
                  if (!m) { sinEntidades.add(`${def.outputKey} (needs ${def.declaradasPor})`); continue }
                  const after = texto.slice(m.index + m[0].length)
                  // El corte va en el ancla del PRÓXIMO output de este nodo. Cortar en «el
                  // próximo encabezado que parezca un identificador» dejaba la sección en CERO
                  // caracteres: la primera entrada del plan —`### pitch_01_hook`— también es un
                  // identificador. Sin plan, el parseo caía a la prosa y cada CAMPO de cada entrada
                  // («Target section:», «Subject:», «Generation prompt:») se volvía un hueco aparte.
                  const cortes = (imageGenOutputs ?? [])
                    .map(d => d.outputKey)
                    .filter(k => k !== def.declaradasPor)
                    .map(k => outputHeaderRx(k).exec(after)?.index)
                    .filter((i): i is number => typeof i === 'number')
                  fuente = after.slice(0, cortes.length ? Math.min(...cortes) : after.length).trim() || section
                }

                const parsed = parseOutputItems(fuente, def.format, def.declaradasPor || def.outputKey)

                // Lo que generó ESTE turno manda. Iterar reescribe los prompts sin mover los
                // índices, así que leer siempre el mapa de la sesión emparejaba la respuesta nueva
                // con la imagen de la anterior. El mapa de la sesión queda como respaldo para los
                // turnos anteriores a este historial.
                const propias   = (msg.id ? imgsPorMsg[msg.id]?.[def.outputKey] : undefined) ?? msg.output_images?.[def.outputKey]

                // El mapa de la sesión es el respaldo para el historial viejo, de cuando las
                // imágenes no se guardaban por mensaje. Pero solo vale si NADIE más las reclama:
                // si algún mensaje ya las tiene como propias, ese mapa es una copia de ESAS, y
                // ofrecérselo a una respuesta nueva le colgaba las imágenes del turno anterior —
                // que es justo lo contrario de que cada respuesta muestre las suyas.
                const alguienLasTiene = messages.some(m =>
                  (m.id ? imgsPorMsg[m.id]?.[def.outputKey] : undefined)?.length ||
                  m.output_images?.[def.outputKey]?.length)
                const respaldo  = isLastAssistant && !alguienLasTiene ? (outputImages[def.outputKey] ?? []) : []
                const savedList = propias ?? respaldo
                for (let idx = 0; idx < parsed.length; idx++) {
                  const itemText   = parsed[idx]
                  const saved      = savedList.find(s => s.index === idx)
                  const variations = saved?.variations ?? []
                  const key        = `${def.outputKey}:${idx}`
                  items.push({
                    itemKey:      key,
                    index:        idx,
                    text:         itemText,
                    imageUrl:     variations.at(-1)?.url ?? null,
                    allVariations: variations,
                    isGenerating: generatingImgKeys.has(key),
                    onZoom:       url => setZoomImageUrl(url),
                    onGenerate:   async (condition?: string) => {
                      setGeneratingImgKeys(prev => new Set(prev).add(key))
                      try {
                        const r = await onGenerateItemImage(def.outputKey, idx, itemText, condition, msg.id)
                        setOutputImages(r.output_images)
                        if (msg.id) setImgsPorMsg(prev => {
                          const mapa  = { ...(prev[msg.id!] ?? {}) }
                          const lista = [...(mapa[def.outputKey] ?? savedList)]
                          const j     = lista.findIndex(s => s.index === idx)
                          const nueva = { url: r.image_url, condition: condition?.trim() || null }
                          if (j >= 0) lista[j] = { ...lista[j], variations: [...(lista[j].variations ?? []), nueva] }
                          else        lista.push({ index: idx, variations: [nueva] })
                          return { ...prev, [msg.id!]: { ...mapa, [def.outputKey]: lista.sort((a, b) => a.index - b.index) } }
                        })
                      } catch (e) {
                        setError(e instanceof Error ? e.message : 'Image generation failed')
                      } finally {
                        setGeneratingImgKeys(prev => { const n = new Set(prev); n.delete(key); return n })
                      }
                    },
                  })
                }
              }
              return items.length > 0 ? items : undefined
            }

            // Computar items una vez: se usa para el grid inline y para el expand modal.
            // Ya no es solo el último turno: una respuesta que generó imágenes las conserva y las
            // sigue mostrando cuando la conversación avanza.
            const tieneImagenesPropias = !!(msg.id && imgsPorMsg[msg.id]) || !!msg.output_images
            const imageItems = (isLastAssistant || tieneImagenesPropias) ? buildItems() : undefined

            return (
              <React.Fragment key={i}>
                <MessageBubble
                  msg={msg}
                  onExpand={() => setExpandedContent({ content: msg.content, imageItems: imageItems ?? buildItems(), pngImages: visibleOutputImages })}
                />
                {/* Cada respuesta pinta lo suyo. Atar esto al último turno era lo que hacía
                    desaparecer las imágenes de las respuestas anteriores al seguir conversando. */}
                {imageItems && <ImageThumbnailRow items={imageItems} />}
                {sinEntidades.size > 0 && (
                  <div style={{
                    display: 'flex', alignItems: 'flex-start', gap: 7, maxWidth: '92%',
                    margin: '2px 0 0 30px', padding: '7px 10px', borderRadius: 7,
                    background: 'var(--bg-2)', border: '1px dashed var(--line-2)',
                    fontSize: 10.5, lineHeight: 1.5, color: 'var(--text-3)',
                  }}>
                    <span style={{ flexShrink: 0, opacity: 0.7 }}>◇</span>
                    <span>
                      No images offered for{' '}
                      <strong style={{ color: 'var(--text-2)', fontFamily: 'var(--font-mono)' }}>
                        {[...sinEntidades].join(', ')}
                      </strong>
                      : this answer has no items to illustrate. It usually means the node ran
                      without its inputs — check the cables before running it again.
                    </span>
                  </div>
                )}
              </React.Fragment>
            )
          })}

          {sending && (
            <div style={{ display: 'flex', gap: 8 }}>
              <div style={{
                width: 26, height: 26, borderRadius: 7, flexShrink: 0,
                background: 'rgba(255,138,61,0.15)',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
              }}>
                <img src="/forgy/forgyi.png" alt="Forge" style={{ width: 16, height: 16, objectFit: 'contain' }} />
              </div>
              <div style={{
                padding: '9px 13px', borderRadius: '12px 12px 12px 4px',
                background: 'var(--bg-2)', border: '1px solid var(--line-2)',
              }}>
                <TypingDots />
              </div>
            </div>
          )}

          {error && (
            <div style={{
              fontSize: 11, color: '#F87171', lineHeight: 1.5,
              padding: '8px 12px', borderRadius: 8,
              background: 'rgba(248,113,113,0.07)',
              border: '1px solid rgba(248,113,113,0.20)',
            }}>
              {error}
            </div>
          )}

          {/* Card de asset aprobado — visible cuando la sesión está locked */}
          {locked && approvedAsset && (
            <div style={{
              margin: '12px 0 4px',
              padding: '10px 12px',
              borderRadius: 8,
              background: 'color-mix(in srgb, #34D399 8%, var(--bg-2))',
              border: '1px solid color-mix(in srgb, #34D399 30%, transparent)',
              display: 'flex', flexDirection: 'column', gap: 6,
            }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <span style={{ color: '#34D399', fontSize: 11 }}>✓</span>
                <span style={{ fontFamily: 'var(--font-mono)', fontSize: 11, fontWeight: 700, color: 'var(--text-0)', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {approvedAsset.name}
                </span>
                <span style={{ fontFamily: 'var(--font-mono)', fontSize: 9, color: 'var(--text-3)', textTransform: 'uppercase', letterSpacing: '.06em', flexShrink: 0 }}>
                  {approvedAsset.format}
                </span>
              </div>
              <div style={{ display: 'flex', gap: 6 }}>
                {approvedAsset.storage_url && (
                  <a
                    href={approvedAsset.storage_url}
                    target="_blank"
                    rel="noopener noreferrer"
                    style={{
                      flex: 1, padding: '5px 0', borderRadius: 5, textDecoration: 'none', textAlign: 'center',
                      background: 'color-mix(in srgb, #34D399 15%, var(--bg-2))',
                      border: '1px solid color-mix(in srgb, #34D399 35%, transparent)',
                      color: '#34D399', fontSize: 10, fontFamily: 'var(--font-mono)', fontWeight: 600,
                    }}
                  >
                    Open ↗
                  </a>
                )}
                {approvedAsset.storage_url && (
                  <a
                    href={approvedAsset.storage_url}
                    download
                    style={{
                      flex: 1, padding: '5px 0', borderRadius: 5, textDecoration: 'none', textAlign: 'center',
                      background: 'var(--bg-3)',
                      border: '1px solid var(--line-2)',
                      color: 'var(--text-2)', fontSize: 10, fontFamily: 'var(--font-mono)', fontWeight: 600,
                    }}
                  >
                    ↓ Download
                  </a>
                )}
              </div>
            </div>
          )}

          <div ref={bottomRef} />
        </div>

        {/* Chip de descarga — mitad PDF, mitad MD (texto original). Del run recién generado o del tool_call persistido */}
        {/* Mientras las imágenes se renderizan el documento todavía no las tiene: bajarlo ahora
            entrega el PDF con los [ IMAGE: … ] impresos como texto. */}
        {effectiveDocUrl && imagesPending && (
          <div style={{ padding: '6px 12px 0', borderTop: '1px solid var(--line-2)', background: 'var(--bg-2)' }}>
            <div style={{
              padding: '7px 10px', borderRadius: 6, fontSize: 10, lineHeight: 1.5,
              fontFamily: 'var(--font-mono)', color: '#F59E0B',
              background: 'color-mix(in srgb, #F59E0B 10%, var(--bg-2))',
              border: '1px solid color-mix(in srgb, #F59E0B 35%, transparent)',
            }}>
              ◷ RENDERING IMAGES — the document is not ready to download yet. It would print the
              [ IMAGE: … ] markers as text.
            </div>
          </div>
        )}
        {effectiveDocUrl && !imagesPending && (
          <div style={{ padding: '6px 12px 0', borderTop: '1px solid var(--line-2)', background: 'var(--bg-2)' }}>
            <div style={{ display: 'flex', gap: 6 }}>
              <a
                href={effectiveDocUrl}
                target="_blank"
                rel="noopener noreferrer"
                style={{
                  flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
                  padding: '7px 0', borderRadius: 6, textDecoration: 'none',
                  background: 'color-mix(in srgb, #F59E0B 12%, var(--bg-2))',
                  border: '1px solid color-mix(in srgb, #F59E0B 40%, transparent)',
                  color: '#F59E0B',
                  fontSize: 11, fontFamily: 'var(--font-mono)', fontWeight: 700,
                  letterSpacing: '.04em', transition: 'all 120ms',
                }}
              >
                ↓ Download {effectiveDocFormat === 'pptx' ? 'PPTX' : 'PDF'}
              </a>
              <button
                onClick={() => { const m = [...messages].reverse().find(x => x.role === 'assistant'); const c = m?.content ?? ''; downloadTextFile(forDisplay(c), mdFilename(stepLabel)) }}
                title="Download Markdown (original text)"
                style={{
                  flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
                  padding: '7px 0', borderRadius: 6, cursor: 'pointer',
                  background: 'var(--bg-3)',
                  border: '1px solid var(--line-2)',
                  color: 'var(--text-2)',
                  fontSize: 11, fontFamily: 'var(--font-mono)', fontWeight: 700,
                  letterSpacing: '.04em', transition: 'all 120ms',
                }}
              >
                ↓ Download MD
              </button>
            </div>
          </div>
        )}

        {/* Botón Accept — solo si hay respuesta nueva (no persiste en sesiones ya aprobadas) */}
        {onAccept && hasNewResponse && messages.some(m => m.role === 'assistant') && !locked && (
          <div style={{ padding: '6px 12px 0', borderTop: effectiveDocUrl ? 'none' : '1px solid var(--line-2)', background: 'var(--bg-2)' }}>
            <button
              onClick={async () => {
                const lastAssistant = [...messages].reverse().find(m => m.role === 'assistant')
                if (!lastAssistant || accepting || sending) return
                setAccepting(true)
                setError(null)
                try {
                  await onAccept(lastAssistant.content)
                } catch (err) {
                  setError(err instanceof Error ? err.message : 'Error accepting output')
                } finally {
                  setAccepting(false)
                }
              }}
              // Con imágenes en vuelo el nodo NO terminó de producir: aceptar ahí congela un output
              // al que todavía le faltan sus propias imágenes.
              disabled={accepting || sending || !!imagesPending}
              style={{
                width: '100%', padding: '7px 0', borderRadius: 6, border: 'none',
                background: accepting || sending || imagesPending ? 'var(--bg-4)' : '#34D399',
                color: accepting || sending || imagesPending ? 'var(--text-3)' : '#0a2e1f',
                fontSize: 11, fontFamily: 'var(--font-mono)', fontWeight: 700,
                cursor: accepting || sending || imagesPending ? 'not-allowed' : 'pointer',
                letterSpacing: '.04em', transition: 'all 120ms',
              }}
            >
              {accepting ? '⟳ Accepting…' : imagesPending ? '◷ Waiting for images…' : '✓ Accept as output'}
            </button>
          </div>
        )}

        {/* Botón Apply — visible cuando hay conversación y onApply está definido */}
        {onApply && messages.length > 0 && messages.some(m => m.role === 'assistant') && (
          <div style={{ padding: '6px 12px', borderTop: '1px solid var(--line-2)', background: 'var(--bg-2)' }}>
            <button
              onClick={applyOutput}
              disabled={applying || sending || locked}
              style={{
                width: '100%', padding: '6px 0', borderRadius: 6, border: '1px solid',
                borderColor: applying || sending || locked ? 'var(--line-2)' : 'color-mix(in srgb, var(--action) 50%, transparent)',
                background: applying || sending || locked ? 'var(--bg-3)' : 'color-mix(in srgb, var(--action) 10%, var(--bg-2))',
                color: applying || sending || locked ? 'var(--text-4)' : 'var(--action)',
                fontSize: 11, fontFamily: 'var(--font-mono)', fontWeight: 600,
                cursor: applying || sending || locked ? 'not-allowed' : 'pointer',
                transition: 'all 120ms',
              }}
            >
              {applying ? 'Applying…' : '↑ Apply as output'}
            </button>
          </div>
        )}

        {/* Input — 30% de la altura de la ventana */}
        <div style={{
          flex: '0 0 30%', minHeight: 0,
          padding: '8px 12px 10px', borderTop: '1px solid var(--line-2)',
          display: 'flex', flexDirection: 'column', gap: 6,
          background: 'var(--bg-2)',
          overflowY: 'auto',
        }}>

          {/* Attachment pendiente — visible antes de enviar */}
          {(pendingFile || pendingUrl) && (
            <div style={{ paddingBottom: 2 }}>
              <AttachmentCard
                attachment={{
                  file_name:       pendingFile ? pendingFile.name : (pendingUrl ?? ''),
                  mime_type:       pendingFile ? pendingFile.type || null : 'text/uri-list',
                  file_size_bytes: pendingFile ? pendingFile.size : null,
                  storage_url:     pendingUrl ?? '',
                }}
                variant="composing"
                onRemove={() => { setPendingFile(null); setPendingUrl(null) }}
              />
            </div>
          )}

          <div style={{ display: 'flex', gap: 7, flex: '1 1 0', minHeight: 0 }}>
            <textarea
              ref={inputRef}
              value={input}
              onChange={e => setInput(e.target.value)}
              onKeyDown={e => {
                if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send() }
              }}
              onPaste={e => {
                // Detectar URL pegada — convertir en attachment de URL
                const text = e.clipboardData.getData('text').trim()
                if (/^https?:\/\/\S+$/.test(text) && !input.trim()) {
                  e.preventDefault()
                  setPendingUrl(text)
                  setPendingFile(null)
                }
              }}
              disabled={sending || locked}
              placeholder={locked
                ? 'Step is approved — read only'
                : 'Ask or describe an adjustment… (Enter to send, or paste a URL / drop a file)'}
              style={{
                flex: '1 1 0', resize: 'none', overflow: 'auto',
                background: 'var(--bg-1)', border: '1px solid var(--line-2)',
                borderRadius: 8, padding: '8px 11px',
                color: 'var(--text-0)', fontSize: 12, lineHeight: 1.5,
                outline: 'none', fontFamily: 'inherit',
                opacity: locked ? 0.4 : 1,
                transition: 'border-color 120ms',
                minHeight: 0,
              }}
              onFocus={e => { if (!locked) e.currentTarget.style.borderColor = 'var(--action)' }}
              onBlur={e => { e.currentTarget.style.borderColor = 'var(--line-2)' }}
            />
            {/* Botones derechos: clip (20%) + send (80%) apilados */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 5, flexShrink: 0, alignSelf: 'stretch', width: 38 }}>
              {!locked && (
                <button
                  onClick={() => fileInputRef.current?.click()}
                  title="Attach file"
                  disabled={sending}
                  style={{
                    flex: '0 0 20%', width: '100%', borderRadius: 7, border: '1px solid var(--line-2)',
                    background: pendingFile || pendingUrl ? 'color-mix(in srgb, var(--action) 14%, var(--bg-3))' : 'var(--bg-3)',
                    color: pendingFile || pendingUrl ? 'var(--action)' : 'var(--text-3)',
                    cursor: sending ? 'not-allowed' : 'pointer',
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    transition: 'all 120ms',
                    opacity: sending ? 0.4 : 1,
                  }}
                >
                  <Paperclip size={15} strokeWidth={1.75} />
                </button>
              )}
              {/* Mientras genera, el mismo botón es Stop. Abortarlo cierra la conexión y el back
                  corta la llamada al proveedor: se deja de gastar de verdad, no solo se suelta la
                  ventana. */}
              {sending ? (
                <button
                  onClick={detener}
                  title="Stop generating — the model stops and no further credit is spent"
                  style={{
                    flex: '1 1 0', width: '100%', borderRadius: 8,
                    border: '1px solid color-mix(in srgb, #EF4444 45%, var(--line-2))',
                    background: 'color-mix(in srgb, #EF4444 12%, var(--bg-2))',
                    color: '#EF4444', fontSize: 11, fontWeight: 700, letterSpacing: '0.06em',
                    fontFamily: 'var(--font-mono)', cursor: 'pointer', transition: 'background 120ms',
                    display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
                  }}
                >
                  <span style={{ width: 9, height: 9, background: '#EF4444', borderRadius: 1.5, display: 'inline-block' }} />
                  STOP
                </button>
              ) : (
                <button
                  onClick={send}
                  disabled={!input.trim() || locked}
                  style={{
                    flex: '1 1 0', width: '100%', borderRadius: 8, border: 'none',
                    background: !input.trim() || locked ? 'var(--bg-3)' : 'var(--action)',
                    color:  !input.trim() || locked ? 'var(--text-4)' : 'var(--action-fg)',
                    fontSize: 18, cursor: !input.trim() || locked ? 'not-allowed' : 'pointer',
                    transition: 'background 120ms',
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                  }}
                >
                  →
                </button>
              )}
            </div>
          </div>
        </div>

        {/* Modelo configurado para este step */}
        {modelName && (
          <div style={{
            padding: '5px 12px', borderTop: '1px solid var(--line-2)',
            background: 'var(--bg-2)',
            fontSize: 9, fontFamily: 'var(--font-mono)', color: 'var(--text-4)',
            textAlign: 'center', letterSpacing: '0.04em',
          }}>
            {modelName}
          </div>
        )}

        {/* Handle de resize — esquina inferior derecha, oculto en maximizado */}
        {!maximized && (
          <div
            onMouseDown={onResizeStart}
            style={{
              position: 'absolute', bottom: 0, right: 0,
              width: 18, height: 18, cursor: 'se-resize',
              display: 'flex', alignItems: 'flex-end', justifyContent: 'flex-end',
              padding: 4,
            }}
          >
            <svg width="10" height="10" viewBox="0 0 10 10" style={{ opacity: 0.3 }}>
              <line x1="2" y1="10" x2="10" y2="2" stroke="var(--text-1)" strokeWidth="1.5" strokeLinecap="round"/>
              <line x1="5" y1="10" x2="10" y2="5" stroke="var(--text-1)" strokeWidth="1.5" strokeLinecap="round"/>
              <line x1="8" y1="10" x2="10" y2="8" stroke="var(--text-1)" strokeWidth="1.5" strokeLinecap="round"/>
            </svg>
          </div>
        )}
      </div>

      {/* Panel de contexto — aparece a la izquierda del chat, solo para nodos gate */}
      {showCtxPanel && !maximized && (
        <div style={{
          position:     'fixed',
          left:         Math.max(MARGIN, pos.x - PANEL_W - 8),
          top:          pos.y,
          width:        PANEL_W,
          height:       size.h,
          zIndex:       110,
          background:   'var(--bg-1)',
          border:       '1px solid var(--line-2)',
          borderRadius: 14,
          boxShadow:    '0 24px 64px rgba(0,0,0,0.55)',
          display:      'flex',
          flexDirection:'column',
          overflow:     'hidden',
        }}>
          {/* Header del panel */}
          <div style={{
            padding: '10px 14px', flexShrink: 0,
            borderBottom: '1px solid var(--line-2)',
            background: 'var(--bg-2)',
            display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <svg width="12" height="12" viewBox="0 0 14 14" fill="none" style={{ opacity: 0.5 }}>
                <rect x="1" y="2"  width="12" height="2" rx="1" fill="var(--text-2)"/>
                <rect x="1" y="6"  width="12" height="2" rx="1" fill="var(--text-2)"/>
                <rect x="1" y="10" width="12" height="2" rx="1" fill="var(--text-2)"/>
              </svg>
              <span style={{ fontSize: 9, fontFamily: 'var(--font-mono)', fontWeight: 700, color: 'var(--text-3)', letterSpacing: '.08em', textTransform: 'uppercase' }}>
                Context Inputs
              </span>
            </div>
            <button
              onClick={() => setShowCtxPanel(false)}
              style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-3)', fontSize: 14, padding: '2px 6px', lineHeight: 1, borderRadius: 4 }}
            >✕</button>
          </div>

          {/* Cuerpo — acordeón de inputs */}
          <div style={{ flex: 1, overflowY: 'auto', padding: '4px 0' }}>
            {ctxLoading && (
              <div style={{ padding: '24px 16px', textAlign: 'center', fontSize: 11, color: 'var(--text-3)', fontFamily: 'var(--font-mono)' }}>
                Loading…
              </div>
            )}
            {!ctxLoading && ctxInputs.length === 0 && (
              <div style={{ padding: '24px 16px', textAlign: 'center', fontSize: 11, color: 'var(--text-3)', lineHeight: 1.6 }}>
                No context inputs found for this node.
              </div>
            )}
            {!ctxLoading && ctxInputs.map((inp, i) => (
              <div key={i} style={{ borderBottom: i < ctxInputs.length - 1 ? '1px solid var(--line-2)' : 'none' }}>
                {/* Fila de acordeón */}
                <div style={{ display: 'flex', alignItems: 'center' }}>
                  <button
                    onClick={() => setCtxOpenIdx(ctxOpenIdx === i ? null : i)}
                    style={{
                      flex: 1, display: 'flex', alignItems: 'center', gap: 6, minWidth: 0,
                      padding: '8px 8px 8px 12px', background: 'none', border: 'none',
                      cursor: 'pointer', textAlign: 'left',
                    }}
                  >
                    <span style={{ fontSize: 8, flexShrink: 0, color: 'var(--text-3)', opacity: 0.7, width: 8 }}>
                      {ctxOpenIdx === i ? '▾' : '▸'}
                    </span>
                    <span style={{ flex: 1, fontSize: 11, fontWeight: 600, color: 'var(--text-0)', lineHeight: 1.3, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {inp.label}
                    </span>
                    <span style={{
                      fontSize: 7, fontFamily: 'var(--font-mono)', fontWeight: 700, flexShrink: 0,
                      padding: '1px 5px', borderRadius: 3,
                      textTransform: 'uppercase', letterSpacing: '.05em',
                      ...(inp.source === 'lane'
                        ? { background: 'rgba(245,158,11,0.12)', color: '#F59E0B', border: '1px solid rgba(245,158,11,0.25)' }
                        : inp.source === 'library'
                          ? { background: 'var(--bg-3)', color: 'var(--text-3)', border: '1px solid var(--line-2)' }
                          : { background: 'color-mix(in srgb, var(--action) 10%, var(--bg-3))', color: 'var(--action)', border: '1px solid color-mix(in srgb, var(--action) 30%, transparent)' }
                      ),
                    }}>
                      {inp.source}
                    </span>
                  </button>
                  {/* Botón "ver en output modal" — solo para edges con project_node_id */}
                  {onOpenOutput && inp.source_project_node_id && (
                    <button
                      onClick={() => onOpenOutput(inp.source_project_node_id!, inp.output_key)}
                      title="Open in output modal"
                      style={{
                        flexShrink: 0, padding: '6px 10px',
                        background: 'none', border: 'none', cursor: 'pointer',
                        color: 'var(--text-3)', fontSize: 11, lineHeight: 1,
                        transition: 'color 120ms',
                      }}
                      onMouseEnter={e => (e.currentTarget.style.color = 'var(--action)')}
                      onMouseLeave={e => (e.currentTarget.style.color = 'var(--text-3)')}
                    >
                      ↗
                    </button>
                  )}
                </div>
                {/* Contenido expandido */}
                {ctxOpenIdx === i && (
                  <div style={{
                    margin: '0 8px 8px',
                    padding: inp.isImage ? '6px 8px' : '10px 12px',
                    borderRadius: 6,
                    background: 'var(--bg-0)',
                    border: '1px solid var(--line-2)',
                    maxHeight: inp.isImage ? 340 : 320,
                    overflowY: 'auto',
                  }}>
                    {inp.isImage ? (
                      /* Imagen directa — centrada con click to zoom */
                      <img
                        src={inp.content.match(/\(([^)]+)\)/)?.[1] ?? inp.content}
                        alt={inp.label}
                        onClick={() => {
                          const url = inp.content.match(/\(([^)]+)\)/)?.[1] ?? inp.content
                          setZoomImageUrl(url)
                        }}
                        style={{
                          width: '100%', height: 'auto', maxHeight: 300,
                          objectFit: 'contain', borderRadius: 4,
                          display: 'block', cursor: 'zoom-in',
                        }}
                      />
                    ) : (
                      /* Markdown rico — mismos componentes que el output modal */
                      <div style={{ fontSize: 11, color: 'var(--text-0)', lineHeight: 1.65 }}>
                        <ReactMarkdown remarkPlugins={[remarkGfm]} components={{
                          ...MD_COMPONENTS,
                          h1: ({ children }) => <h1 style={{ fontSize: 13, fontWeight: 700, margin: '.5em 0 .25em', color: 'var(--text-0)' }}>{children}</h1>,
                          h2: ({ children }) => <h2 style={{ fontSize: 12, fontWeight: 700, margin: '.5em 0 .2em', color: 'var(--text-0)', borderBottom: '1px solid var(--line-2)', paddingBottom: '.15em' }}>{children}</h2>,
                          h3: ({ children }) => <h3 style={{ fontSize: 11, fontWeight: 700, margin: '.4em 0 .15em', color: 'var(--text-0)' }}>{children}</h3>,
                          // Imágenes inline dentro de markdown
                          // eslint-disable-next-line @typescript-eslint/no-explicit-any
                          img: ({ src, alt }: any) => (
                            <img
                              src={src} alt={alt ?? ''}
                              onClick={() => src && setZoomImageUrl(src)}
                              style={{ maxWidth: '100%', height: 'auto', borderRadius: 4, display: 'block', margin: '6px 0', cursor: 'zoom-in' }}
                            />
                          ),
                        }}>
                          {forDisplay(inp.content)}
                        </ReactMarkdown>
                      </div>
                    )}
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Modal de lectura expandida */}
      {expandedContent && (
        <div
          onClick={() => setExpandedContent(null)}
          style={{
            position: 'fixed', inset: 0, zIndex: 200,
            background: 'rgba(0,0,0,0.65)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            padding: 32,
          }}
        >
          <div
            onClick={e => e.stopPropagation()}
            style={{
              background: 'var(--bg-1)',
              border: '1px solid var(--line-2)',
              borderRadius: 12,
              width: 'min(820px, 92vw)', height: 'auto',
              minWidth: 360, minHeight: 200, maxWidth: '95vw', maxHeight: '85vh',
              resize: 'both',
              transform: `translate(${expandPos.x}px, ${expandPos.y}px)`,
              display: 'flex', flexDirection: 'column',
              boxShadow: '0 32px 80px rgba(0,0,0,0.7)',
              overflow: 'hidden',
            }}
          >
            {/* Header — arrastrable */}
            <div onMouseDown={onExpandDrag} style={{
              padding: '12px 16px', borderBottom: '1px solid var(--line-2)',
              display: 'flex', alignItems: 'center', gap: 10,
              flexShrink: 0, background: 'var(--bg-2)', cursor: 'move', userSelect: 'none',
            }}>
              <span style={{ fontSize: 11, fontFamily: 'var(--font-mono)', color: 'var(--text-3)', textTransform: 'uppercase', letterSpacing: '.08em', flex: 1 }}>
                {stepLabel}
              </span>
              {effectiveDocUrl && (
                <>
                  <button
                    onClick={e => { e.stopPropagation(); downloadTextFile(forDisplay(expandedContent.content), mdFilename(stepLabel)) }}
                    title="Download Markdown (original text)"
                    style={{
                      fontSize: 9, fontFamily: 'var(--font-mono)', fontWeight: 700,
                      color: 'var(--text-2)', background: 'none', cursor: 'pointer',
                      padding: '3px 10px', border: '1px solid var(--line-2)',
                      borderRadius: 4, letterSpacing: '.04em', flexShrink: 0,
                    }}
                  >
                    ↓ MD
                  </button>
                  <a
                    href={effectiveDocUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    onClick={e => e.stopPropagation()}
                    style={{
                      fontSize: 9, fontFamily: 'var(--font-mono)', fontWeight: 700,
                      color: '#F59E0B', textDecoration: 'none',
                      padding: '3px 10px', border: '1px solid color-mix(in srgb, #F59E0B 50%, transparent)',
                      borderRadius: 4, letterSpacing: '.04em', flexShrink: 0,
                    }}
                  >
                    ↓ {effectiveDocFormat === 'pptx' ? 'PPTX' : 'PDF'}
                  </a>
                </>
              )}
              <CopyButton text={forDisplay(expandedContent.content)} style={{ width: 24, height: 24, fontSize: 12 }} />
              <button
                onClick={() => setExpandedContent(null)}
                style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-3)', fontSize: 16, lineHeight: 1, padding: '2px 6px', flexShrink: 0 }}
              >
                ✕
              </button>
            </div>

            {/* Contenido */}
            {(() => {
              // Si el contenido es un array JSON, mostrarlo legible (tarjetas) y sin inyección
              // de botones por ítem: el markdown de tarjetas no matchea el patrón "Variation N",
              // y las imágenes siguen disponibles en el thumbnail row del chat. Para contenido
              // markdown normal (ej. art direction) se mantiene la inyección de botones ✦.
              // `forDisplay`, no `jsonToMarkdown`: éste convierte UN bloque y una respuesta trae
              // varios —los gaps, el contrato de carril, las semillas, la emisión—, así que el
              // contenido de verdad se quedaba crudo en pantalla mientras el primer bloque sí se
              // veía bien. Es el mismo render que usa el chat; no hay motivo para que difieran.
              const limpio   = stripMachineBlocks(expandedContent.content)
              const render   = forDisplay(expandedContent.content)
              const readable = render !== limpio
              const expandedItems = readable ? undefined : buildItemsFromContent(expandedContent.content)
              return (
                <div style={{ flex: 1, overflowY: 'auto', padding: '24px 32px' }}>
                  <div style={{ fontSize: 13, color: 'var(--text-0)', lineHeight: 1.7 }}>
                    <ReactMarkdown
                      remarkPlugins={[remarkGfm]}
                      components={expandedItems?.length ? buildImageGenComponents(expandedItems) : MD_COMPONENTS}
                    >
                      {render}
                    </ReactMarkdown>
                  </div>

                </div>
              )
            })()}
          </div>
        </div>
      )}

      {/* Zoom overlay de imagen generada */}
      {zoomImageUrl && (
        <div
          onClick={() => setZoomImageUrl(null)}
          style={{
            position: 'fixed', inset: 0, zIndex: 300,
            background: 'rgba(0,0,0,0.82)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            padding: 32, cursor: 'zoom-out',
          }}
        >
          <img
            src={zoomImageUrl}
            alt="Generated"
            onClick={e => e.stopPropagation()}
            style={{
              maxWidth: '90vw', maxHeight: '85vh',
              borderRadius: 10, boxShadow: '0 24px 80px rgba(0,0,0,0.7)',
              cursor: 'default',
            }}
          />
          <button
            onClick={() => setZoomImageUrl(null)}
            style={{
              position: 'absolute', top: 20, right: 20,
              background: 'rgba(255,255,255,0.1)', border: '1px solid rgba(255,255,255,0.2)',
              borderRadius: 6, color: '#fff', fontSize: 14, padding: '4px 10px',
              cursor: 'pointer',
            }}
          >
            ✕
          </button>
        </div>
      )}

      {/* Por portal y con su propio contexto de apilado: el moodboard vive en z-index 1200 y esta
          ventana llega a 30000, así que montado adentro quedaría detrás del chat que lo abrió. */}
      {moodOpen && createPortal(
        <div style={{ position: 'fixed', inset: 0, zIndex: 30001 }}>
          <Moodboard
            projectId={project.id}
            projectName={project.name}
            nodeKey={stepKey}
            onClose={() => setMoodOpen(false)}
          />
        </div>,
        document.body,
      )}
    </>
  )
}
