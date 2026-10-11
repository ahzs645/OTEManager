import type { ReactNode } from 'react'

// Renders the Markdown subset the app produces (headings, paragraphs, lists,
// bold, italic, links) as React elements. Text is never parsed as HTML.

// Underscore emphasis only counts at word edges, so snake_case_names stays as written
const INLINE =
  /(\*\*\*[^*]+\*\*\*|\*\*[^*]+\*\*|(?<!\w)__[^_]+__(?!\w)|\*[^*\s][^*]*\*|(?<!\w)_[^_\s][^_]*_(?!\w)|\[[^\]]+\]\([^)\s]+\))/g

function renderInline(text: string, keyPrefix: string): ReactNode[] {
  return text.split(INLINE).map((part, i) => {
    const key = `${keyPrefix}-${i}`
    if (!part) return null
    let m: RegExpMatchArray | null
    if ((m = part.match(/^\*\*\*([^*]+)\*\*\*$/)))
      return <strong key={key}><em>{m[1]}</em></strong>
    if ((m = part.match(/^\*\*([^*]+)\*\*$/)) || (m = part.match(/^__([^_]+)__$/)))
      return <strong key={key}>{renderInline(m[1], key)}</strong>
    if ((m = part.match(/^\*([^*]+)\*$/)) || (m = part.match(/^_([^_]+)_$/)))
      return <em key={key}>{m[1]}</em>
    if ((m = part.match(/^\[([^\]]+)\]\(([^)\s]+)\)$/))) {
      const href = /^(https?:|mailto:)/i.test(m[2]) ? m[2] : undefined
      return href ? (
        <a key={key} href={href} target="_blank" rel="noopener noreferrer" style={{ color: 'var(--accent)', textDecoration: 'underline' }}>
          {m[1]}
        </a>
      ) : (
        m[1]
      )
    }
    return part
  })
}

const headingSizes = ['1.5rem', '1.25rem', '1.125rem', '1rem', '1rem', '1rem']

export function MarkdownPreview({ content }: { content: string }) {
  const blocks: ReactNode[] = []
  let list: { ordered: boolean; items: string[] } | null = null

  const flushList = () => {
    if (!list) return
    const Tag = list.ordered ? 'ol' : 'ul'
    blocks.push(
      <Tag
        key={`list-${blocks.length}`}
        style={{ paddingLeft: '1.5rem', margin: '0 0 0.75rem', listStyle: list.ordered ? 'decimal' : 'disc' }}
      >
        {list.items.map((item, i) => (
          <li key={i} style={{ marginBottom: '0.25rem' }}>{renderInline(item, `li-${blocks.length}-${i}`)}</li>
        ))}
      </Tag>
    )
    list = null
  }

  content.split('\n').forEach((raw, index) => {
    const line = raw.trim()
    const heading = line.match(/^(#{1,6})\s+(.*)$/)
    const bullet = line.match(/^[-*+]\s+(.*)$/)
    const numbered = line.match(/^\d+[.)]\s+(.*)$/)

    if (bullet || numbered) {
      const ordered = !!numbered
      if (list && list.ordered !== ordered) flushList()
      if (!list) list = { ordered, items: [] }
      list.items.push((bullet || numbered)![1])
      return
    }
    flushList()
    if (!line) return
    if (heading) {
      const level = heading[1].length
      const Tag = `h${level}` as 'h1'
      blocks.push(
        <Tag key={index} style={{ fontSize: headingSizes[level - 1], fontWeight: 600, margin: '1rem 0 0.5rem', color: 'var(--fg-default)' }}>
          {renderInline(heading[2], `h-${index}`)}
        </Tag>
      )
    } else {
      blocks.push(
        <p key={index} style={{ margin: '0 0 0.75rem' }}>{renderInline(line, `p-${index}`)}</p>
      )
    }
  })
  flushList()

  return (
    <div style={{ fontSize: '0.9375rem', lineHeight: 1.7, color: 'var(--fg-default)' }}>
      {blocks.length ? blocks : <p style={{ color: 'var(--fg-faint)' }}>Nothing to preview yet.</p>}
    </div>
  )
}

/** Edit / Preview switch shown in an editor's header. */
export function EditPreviewToggle({
  preview,
  onChange,
}: {
  preview: boolean
  onChange: (preview: boolean) => void
}) {
  return (
    <div className="flex rounded-md p-0.5 text-xs" style={{ background: 'var(--bg-subtle)' }} role="tablist">
      {(['Edit', 'Preview'] as const).map((mode) => {
        const active = (mode === 'Preview') === preview
        return (
          <button
            key={mode}
            role="tab"
            aria-selected={active}
            onClick={() => onChange(mode === 'Preview')}
            className="px-2 py-0.5 rounded"
            style={{
              background: active ? 'var(--bg-surface)' : 'transparent',
              color: active ? 'var(--fg-default)' : 'var(--fg-muted)',
              boxShadow: active ? '0 1px 2px rgba(0,0,0,0.06)' : undefined,
            }}
          >
            {mode}
          </button>
        )
      })}
    </div>
  )
}
