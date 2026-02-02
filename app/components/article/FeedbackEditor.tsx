import { useState, useEffect, useRef, useCallback } from 'react'
import { Check, Save } from 'lucide-react'
import { Button, LoadingSpinner, Section } from '~/components/Layout'
import { updateArticleFeedbackLetter } from '~/lib/mutations'
import { useTrackUnsaved } from './UnsavedChangesContext'

interface FeedbackEditorProps {
  articleId: string
  initialContent: string
}

export function FeedbackEditor({ articleId, initialContent }: FeedbackEditorProps) {
  const [content, setContent] = useState(initialContent)
  const [isSaving, setIsSaving] = useState(false)
  // Track what's actually saved in the database
  const [savedContent, setSavedContent] = useState(initialContent)

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
  useTrackUnsaved('feedback', 'Feedback', !isSaved)

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
      const result = await updateArticleFeedbackLetter({
        data: {
          articleId,
          feedbackLetter: saveContent,
        },
      })
      if (result.success) {
        setSavedContent(saveContent)
      } else {
        console.error('Failed to save feedback letter:', result.error)
      }
    } catch (error) {
      console.error('Failed to save feedback letter:', error)
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

  return (
    <Section
      title="Feedback Letter"
      action={
        <div className="flex items-center gap-2">
          <span className="text-xs" style={{ color: 'var(--fg-muted)' }}>
            {wordCount} words
          </span>
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
        placeholder="Write a feedback letter in markdown format. This can be used to communicate feedback to the author about their submission..."
        className="w-full min-h-[300px] p-3 text-sm font-mono resize-y"
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
