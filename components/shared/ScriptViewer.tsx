'use client'

import { useState } from 'react'

interface Props {
  content: string
  engine: string
  filename: string
}

function applySyntaxHighlighting(code: string): string {
  const escape = (s: string) =>
    s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

  const lines = code.split('\n')
  const highlighted = lines.map(line => {
    let l = escape(line)

    // Comments
    l = l.replace(/(\/\/.*$)/g, '<span style="color:#6a9955">$1</span>')
    l = l.replace(/(\/\*[\s\S]*?\*\/)/g, '<span style="color:#6a9955">$1</span>')

    // Strings
    l = l.replace(/("(?:[^"\\]|\\.)*")/g, '<span style="color:#ce9178">$1</span>')

    // Attributes / decorators
    l = l.replace(/(\[(?:Header|SerializeField|RequireComponent|Range|Tooltip)[^\]]*\])/g,
      '<span style="color:#c586c0">$1</span>')

    // Keywords
    l = l.replace(/\b(public|private|protected|static|override|virtual|abstract|readonly|const|new|return|if|else|for|foreach|while|switch|case|break|continue|using|namespace|class|interface|struct|void|async|await|null|true|false|this|base)\b/g,
      '<span style="color:#569cd6">$1</span>')

    // Types
    l = l.replace(/\b(string|int|float|double|bool|var|object|List|Dictionary|Array|MonoBehaviour|GameObject|Transform|Vector2|Vector3|Rigidbody2D|Collider2D|Sprite|AudioSource|Camera|SerializeField)\b/g,
      '<span style="color:#4ec9b0">$1</span>')

    // Numbers
    l = l.replace(/\b(\d+\.?\d*f?)\b/g, '<span style="color:#b5cea8">$1</span>')

    return l
  })
  return highlighted.join('\n')
}

function renderMarkdown(md: string): string {
  const escape = (s: string) =>
    s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

  const lines = md.split('\n')
  const out: string[] = []
  let inCode = false

  for (const raw of lines) {
    let line = escape(raw)

    if (line.startsWith('```')) {
      inCode = !inCode
      if (inCode) {
        out.push('<div style="background:#0a0a0f;border-radius:6px;padding:8px 12px;margin:4px 0;font-family:monospace;font-size:0.75rem;color:#d4d4d4">')
      } else {
        out.push('</div>')
      }
      continue
    }

    if (inCode) {
      out.push(line)
      continue
    }

    if (line.startsWith('### '))
      line = `<div style="color:#fff;font-weight:700;font-size:0.95rem;margin-top:12px">${line.slice(4)}</div>`
    else if (line.startsWith('## '))
      line = `<div style="color:#fff;font-weight:700;font-size:1.05rem;margin-top:16px">${line.slice(3)}</div>`
    else if (line.startsWith('# '))
      line = `<div style="color:#fff;font-weight:700;font-size:1.15rem;margin-top:16px">${line.slice(2)}</div>`
    else if (line.startsWith('- ') || line.startsWith('* '))
      line = `<div style="display:flex;gap:6px;color:#cbd5e1"><span style="color:#7c3aed">▸</span>${line.slice(2)}</div>`
    else
      line = line
        .replace(/\*\*(.+?)\*\*/g, '<span style="color:#fff;font-weight:600">$1</span>')

    out.push(line)
  }

  return out.join('\n')
}

export default function ScriptViewer({ content, engine, filename }: Props) {
  const [copied, setCopied] = useState(false)

  const isMarkdown = engine === 'markdown' || filename.endsWith('.md')

  const rendered = isMarkdown
    ? renderMarkdown(content)
    : applySyntaxHighlighting(content)

  function copy() {
    navigator.clipboard.writeText(content)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  return (
    <div className="relative rounded-xl border border-slate-800 bg-[#0a0a0f] overflow-hidden">
      <div className="flex items-center justify-between px-4 py-2 border-b border-slate-800 bg-[#0d0f16]">
        <span className="text-slate-400 text-xs font-mono">{filename}</span>
        <button
          onClick={copy}
          className="text-xs px-3 py-1 rounded-md bg-slate-800 hover:bg-slate-700 text-slate-300 transition-colors"
        >
          {copied ? 'Copied!' : 'Copy'}
        </button>
      </div>
      <div
        className="overflow-auto font-mono text-xs leading-relaxed p-4 text-slate-300"
        style={{ maxHeight: '60vh' }}
        dangerouslySetInnerHTML={{ __html: rendered }}
      />
    </div>
  )
}
