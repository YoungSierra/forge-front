// Descarga un string como archivo (usado por los botones "↓ MD" de los modales que tienen PDF).
export function downloadTextFile(text: string, filename: string, mime = 'text/markdown;charset=utf-8') {
  const blob = new Blob([text], { type: mime })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  a.remove()
  URL.revokeObjectURL(url)
}

// Convierte un label de nodo/documento en un nombre de archivo .md seguro.
export function mdFilename(label: string): string {
  const base = (label || 'document').replace(/[^\w.-]+/g, '_').replace(/^_+|_+$/g, '') || 'document'
  return base.endsWith('.md') ? base : base + '.md'
}
