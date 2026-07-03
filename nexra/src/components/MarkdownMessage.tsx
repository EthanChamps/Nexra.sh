import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import remarkBreaks from 'remark-breaks'
import { theme } from '../theme'

const blockSpacing = { margin: '0 0 10px' } as const
const bodyText = { fontSize: 14, lineHeight: 1.65, color: theme.textDim } as const
const headingBase = { color: theme.text, fontWeight: 600, margin: '14px 0 6px' } as const

function isBlockCode(children: unknown): boolean {
  return /\n/.test(String(children))
}

export function MarkdownMessage({ content }: { content: string }) {
  return (
    <ReactMarkdown
      remarkPlugins={[remarkGfm, remarkBreaks]}
      components={{
        p: ({ children }) => <p style={{ ...bodyText, ...blockSpacing }}>{children}</p>,
        strong: ({ children }) => <strong style={{ color: theme.text, fontWeight: 600 }}>{children}</strong>,
        em: ({ children }) => <em style={{ fontStyle: 'italic' }}>{children}</em>,
        a: ({ href, children }) => (
          <a href={href} target="_blank" rel="noreferrer" style={{ color: theme.accentSoft, textDecoration: 'underline' }}>
            {children}
          </a>
        ),
        ul: ({ children }) => <ul style={{ paddingLeft: 22, ...blockSpacing }}>{children}</ul>,
        ol: ({ children }) => <ol style={{ paddingLeft: 22, ...blockSpacing }}>{children}</ol>,
        li: ({ children }) => <li style={{ ...bodyText, marginBottom: 4 }}>{children}</li>,
        code: ({ className, children }) =>
          isBlockCode(children) ? (
            <code className={className} style={{ fontFamily: theme.mono, fontSize: 12.5, lineHeight: 1.55, color: '#c9cdd4' }}>
              {children}
            </code>
          ) : (
            <code style={{ background: theme.card2, padding: '1px 5px', borderRadius: 4, fontFamily: theme.mono, fontSize: 12.5, color: theme.textDim }}>
              {children}
            </code>
          ),
        pre: ({ children }) => (
          <pre
            style={{
              border: '1px solid rgba(255,255,255,0.09)', borderRadius: 10, background: '#0c0d10',
              padding: '11px 13px', overflow: 'auto', ...blockSpacing,
            }}
          >
            {children}
          </pre>
        ),
        blockquote: ({ children }) => (
          <blockquote style={{ borderLeft: `3px solid ${theme.border2}`, paddingLeft: 12, color: theme.muted, ...blockSpacing }}>
            {children}
          </blockquote>
        ),
        hr: () => <hr style={{ border: 'none', borderTop: `1px solid ${theme.border}`, margin: '14px 0' }} />,
        table: ({ children }) => <table style={{ borderCollapse: 'collapse', width: '100%', fontSize: 13, ...blockSpacing }}>{children}</table>,
        th: ({ children }) => (
          <th style={{ padding: '6px 10px', border: `1px solid ${theme.border}`, textAlign: 'left', color: theme.text, background: 'rgba(255,255,255,0.03)' }}>
            {children}
          </th>
        ),
        td: ({ children }) => (
          <td style={{ padding: '6px 10px', border: `1px solid ${theme.border}`, textAlign: 'left', color: theme.textDim }}>{children}</td>
        ),
        h1: ({ children }) => <h1 style={{ ...headingBase, fontSize: 18 }}>{children}</h1>,
        h2: ({ children }) => <h2 style={{ ...headingBase, fontSize: 16 }}>{children}</h2>,
        h3: ({ children }) => <h3 style={{ ...headingBase, fontSize: 15 }}>{children}</h3>,
        h4: ({ children }) => <h4 style={{ ...headingBase, fontSize: 15 }}>{children}</h4>,
        h5: ({ children }) => <h5 style={{ ...headingBase, fontSize: 15 }}>{children}</h5>,
        h6: ({ children }) => <h6 style={{ ...headingBase, fontSize: 15 }}>{children}</h6>,
      }}
    >
      {content}
    </ReactMarkdown>
  )
}
