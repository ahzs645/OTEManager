import { useState, useEffect } from 'react'
import { Check, Save } from 'lucide-react'
import { Button, LoadingSpinner, Section } from '~/components/Layout'
import { updateArticleFeedbackLetter } from '~/lib/mutations'

interface FeedbackEditorProps {
  articleId: string
  initialContent: string
}

export function FeedbackEditor({ articleId, initialContent }: FeedbackEditorProps) {
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
      const result = await updateArticleFeedbackLetter({
        data: {
          articleId,
          feedbackLetter: content,
        },
      })
      if (result.success) {
        setIsSaved(true)
      } else {
        console.error('Failed to save feedback letter:', result.error)
        alert('Failed to save feedback letter: ' + (result.error || 'Unknown error'))
      }
    } catch (error) {
      console.error('Failed to save feedback letter:', error)
      alert('Failed to save feedback letter')
    } finally {
      setIsSaving(false)
    }
  }

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
