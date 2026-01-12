import { useState, useEffect } from 'react'
import { Check, Save, Download } from 'lucide-react'
import { Button, LoadingSpinner, Section } from '~/components/Layout'
import { updateArticleContent } from '~/lib/mutations'

interface ContentEditorProps {
  articleId: string
  initialContent: string
  title?: string
}

export function ContentEditor({ articleId, initialContent, title = 'Article Content' }: ContentEditorProps) {
  const [content, setContent] = useState(initialContent)
  const [isSaving, setIsSaving] = useState(false)
  const [isSaved, setIsSaved] = useState(true)

  // Reset saved state when initial content changes
  useEffect(() => {
    setContent(initialContent)
    setIsSaved(true)
  }, [initialContent])

  const handleContentChange = (newContent: string) => {
    setContent(newContent)
    setIsSaved(false)
  }

  const handleSave = async () => {
    setIsSaving(true)
    try {
      const result = await updateArticleContent({
        data: {
          articleId,
          content,
        },
      })
      if (result.success) {
        setIsSaved(true)
      } else {
        console.error('Failed to save content:', result.error)
        alert('Failed to save content: ' + (result.error || 'Unknown error'))
      }
    } catch (error) {
      console.error('Failed to save content:', error)
      alert('Failed to save content')
    } finally {
      setIsSaving(false)
    }
  }

  const wordCount = content.trim() ? content.trim().split(/\s+/).length : 0
  const charCount = content.length

  return (
    <Section
      title={title}
      action={
        <div className="flex items-center gap-2">
          <span className="text-xs" style={{ color: 'var(--fg-muted)' }}>
            {wordCount} words · {charCount} chars
          </span>
          <a
            href={`/api/exportArticle/${articleId}`}
            download
            className="btn btn-ghost"
            style={{ padding: '0.25rem 0.5rem' }}
            title="Download as Word document"
          >
            <Download className="w-3 h-3" />
          </a>
          <Button
            onClick={handleSave}
            disabled={isSaving || isSaved}
            variant={isSaved ? 'secondary' : 'primary'}
            size="sm"
          >
            {isSaving ? (
              <LoadingSpinner size="sm" />
            ) : isSaved ? (
              <>
                <Check className="w-3 h-3" />
                Saved
              </>
            ) : (
              <>
                <Save className="w-3 h-3" />
                Save
              </>
            )}
          </Button>
        </div>
      }
    >
      <textarea
        value={content}
        onChange={(e) => handleContentChange(e.target.value)}
        placeholder="Paste or type article content here in markdown format..."
        className="w-full min-h-[400px] p-3 text-sm font-mono resize-y"
        style={{
          background: 'var(--bg-subtle)',
          border: '1px solid var(--border-default)',
          borderRadius: '6px',
          color: 'var(--fg-default)',
          lineHeight: '1.6',
        }}
      />
    </Section>
  )
}
