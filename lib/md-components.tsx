import React from 'react'

// Componentes inline para ReactMarkdown — evita que Tailwind reset anule estilos
export const MD_COMPONENTS = {
  h1: ({ children }: React.HTMLAttributes<HTMLHeadingElement>) => <h1 style={{ fontSize: 15, fontWeight: 700, margin: '.7em 0 .3em', color: 'var(--text-0)', lineHeight: 1.25 }}>{children}</h1>,
  h2: ({ children }: React.HTMLAttributes<HTMLHeadingElement>) => <h2 style={{ fontSize: 13, fontWeight: 700, margin: '.7em 0 .25em', color: 'var(--text-0)', borderBottom: '1px solid var(--line-2)', paddingBottom: '.2em' }}>{children}</h2>,
  h3: ({ children }: React.HTMLAttributes<HTMLHeadingElement>) => <h3 style={{ fontSize: 12, fontWeight: 700, margin: '.6em 0 .2em', color: 'var(--text-0)' }}>{children}</h3>,
  h4: ({ children }: React.HTMLAttributes<HTMLHeadingElement>) => <h4 style={{ fontSize: 11, fontWeight: 700, margin: '.5em 0 .2em', color: 'var(--text-2)', textTransform: 'uppercase' as const, letterSpacing: '.04em' }}>{children}</h4>,
  p:  ({ children }: React.HTMLAttributes<HTMLParagraphElement>) => <p style={{ margin: '.35em 0' }}>{children}</p>,
  ul: ({ children }: React.HTMLAttributes<HTMLUListElement>) => <ul style={{ margin: '.35em 0', paddingLeft: '1.3em', listStyleType: 'disc' }}>{children}</ul>,
  ol: ({ children }: React.HTMLAttributes<HTMLOListElement>) => <ol style={{ margin: '.35em 0', paddingLeft: '1.3em', listStyleType: 'decimal' }}>{children}</ol>,
  li: ({ children }: React.HTMLAttributes<HTMLLIElement>) => <li style={{ margin: '.15em 0' }}>{children}</li>,
  strong: ({ children }: React.HTMLAttributes<HTMLElement>) => <strong style={{ fontWeight: 700, color: 'var(--text-0)' }}>{children}</strong>,
  em: ({ children }: React.HTMLAttributes<HTMLElement>) => <em style={{ fontStyle: 'italic', color: 'var(--text-1)' }}>{children}</em>,
  hr: () => <hr style={{ border: 'none', borderTop: '1px solid var(--line-2)', margin: '.7em 0' }} />,
  blockquote: ({ children }: React.HTMLAttributes<HTMLQuoteElement>) => <blockquote style={{ borderLeft: '3px solid var(--action)', margin: '.4em 0', padding: '.2em .8em', color: 'var(--text-2)', fontStyle: 'italic' }}>{children}</blockquote>,
  // La caja del bloque de código la da el <pre> (react-markdown ya envuelve el code en un pre).
  pre: ({ children }: React.HTMLAttributes<HTMLPreElement>) => (
    <pre style={{ background: 'var(--bg-3)', border: '1px solid var(--line-2)', borderRadius: 6, padding: '10px 12px', margin: '.5em 0', maxWidth: '100%', whiteSpace: 'pre-wrap', wordBreak: 'break-word', overflowWrap: 'anywhere', overflowX: 'hidden' }}>
      {children}
    </pre>
  ),
  code: ({ children, className }: React.HTMLAttributes<HTMLElement>) => {
    // Bloque = tiene language class O es multilínea (los fences sin lenguaje no traen className).
    const text = Array.isArray(children) ? children.join('') : String(children ?? '')
    const isBlock = !!className || text.includes('\n')
    return isBlock ? (
      <code style={{ fontFamily: 'var(--font-mono)', fontSize: 11, whiteSpace: 'pre-wrap', wordBreak: 'break-word', overflowWrap: 'anywhere' }}>{children}</code>
    ) : (
      <code style={{ fontFamily: 'var(--font-mono)', fontSize: 11, background: 'var(--bg-3)', padding: '1px 5px', borderRadius: 3, wordBreak: 'break-word' }}>{children}</code>
    )
  },
  table: ({ children }: React.HTMLAttributes<HTMLTableElement>) => (
    <div style={{ overflowX: 'auto', margin: '.6em 0' }}>
      <table style={{ borderCollapse: 'collapse', width: '100%', fontSize: 11 }}>{children}</table>
    </div>
  ),
  th: ({ children }: React.HTMLAttributes<HTMLTableCellElement>) => <th style={{ background: 'var(--bg-3)', border: '1px solid var(--line-2)', padding: '5px 8px', fontWeight: 600, textAlign: 'left', whiteSpace: 'nowrap' }}>{children}</th>,
  td: ({ children }: React.HTMLAttributes<HTMLTableCellElement>) => <td style={{ border: '1px solid var(--line-2)', padding: '4px 8px', verticalAlign: 'top' }}>{children}</td>,
  a: ({ children, href }: React.AnchorHTMLAttributes<HTMLAnchorElement>) => (
    <a href={href} target="_blank" rel="noopener noreferrer" style={{ color: 'var(--action)', textDecoration: 'underline', textUnderlineOffset: 2 }}>{children}</a>
  ),
}
