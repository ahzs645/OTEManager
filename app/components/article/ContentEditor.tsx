import { useState, useEffect, useRef, useCallback } from 'react'
import { Check, Save, Download } from 'lucide-react'
import { Button, LoadingSpinner, Section } from '~/components/Layout'
import { updateArticleContent } from '~/lib/mutations'
import { useTrackUnsaved } from './UnsavedChangesContext'

interface ContentEditorProps {
  articleId: string
  initialContent: string
  title?: string
}

export function ContentEditor({ articleId, initialContent, title = 'Article Content' }: ContentEditorProps) {
  const [content, setContent] = useState(initialContent)
  const [isSaving, setIsSaving] = useState(false)
  // Track what's actually saved in the database
  const [savedContent, setSavedContent] = useState(initialContent)
  // Track last save time for auto-save status
  const [lastSavedAt, setLastSavedAt] = useState<Date | null>(null)

  // Refs for auto-save
  const contentRef = useRef(content)
  const savedContentRef = useRef(savedContent)
  const isSavingRef = useRef(false)

  // Keep refs in sync
  useEffect(() => {
    contentRef.current = content
  }, [content])

  useEffect(() => {
    savedContentRef.current = savedContent
  }, [savedContent])

  // Determine if current content matches what's saved
  const isSaved = content === savedContent

  // Track unsaved changes globally
  useTrackUnsaved('content', 'Content', !isSaved)

  // Update content when initialContent changes (e.g., from document insertion)
  useEffect(() => {
    setContent(initialContent)
    setSavedContent(initialContent) // Also update savedContent since this came from auto-save on insert
  }, [initialContent])

  const handleContentChange = (newContent: string) => {
    setContent(newContent)
  }

  const handleSave = useCallback(async (contentToSave?: string) => {
    const saveContent = contentToSave ?? contentRef.current

    // Don't save if already saving or if content matches saved
    if (isSavingRef.current || saveContent === savedContentRef.current) {
      return
    }

    isSavingRef.current = true
    setIsSaving(true)
    try {
      const result = await updateArticleContent({
        data: {
          articleId,
          content: saveContent,
        },
      })
      if (result.success) {
        setSavedContent(saveContent)
        setLastSavedAt(new Date())
      } else {
        console.error('Failed to save content:', result.error)
      }
    } catch (error) {
      console.error('Failed to save content:', error)
    } finally {
      isSavingRef.current = false
      setIsSaving(false)
    }
  }, [articleId])

  // Auto-save every 5 seconds if there are unsaved changes
  useEffect(() => {
    const autoSaveInterval = setInterval(() => {
      if (contentRef.current !== savedContentRef.current && !isSavingRef.current) {
        handleSave()
      }
    }, 5000)

    return () => clearInterval(autoSaveInterval)
  }, [handleSave])

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
            onClick={() => handleSave()}
            disabled={isSaving || isSaved}
            variant={isSaved ? 'secondary' : 'primary'}
            size="sm"
          >
            {isSaving ? (
              <>
                <LoadingSpinner size="sm" />
                Saving...
              </>
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
