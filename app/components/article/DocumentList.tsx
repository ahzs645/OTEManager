import { useState } from 'react'
import { FileText, Download, Wand2 } from 'lucide-react'
import { Section, LoadingSpinner } from '~/components/Layout'

interface Document {
  id: string
  filePath: string
  originalFileName: string
  fileSize: number | null
}

interface DocumentListProps {
  documents: Document[]
  articleId: string
  onConvertToMarkdown: (content: string) => void
}

export function DocumentList({ documents, articleId, onConvertToMarkdown }: DocumentListProps) {
  const [isConverting, setIsConverting] = useState<string | null>(null)

  const handleConvertFromWord = async (attachmentId: string) => {
    setIsConverting(attachmentId)
    try {
      // Dynamically import to avoid bundling mammoth in client
      const { convertDocxToMarkdown } = await import('~/lib/server-mutations')
      const result = await convertDocxToMarkdown({
        data: {
          articleId,
          attachmentId,
        },
      })
      if (result.success && result.content) {
        onConvertToMarkdown(result.content)
      } else {
        console.error('Conversion failed:', result.error)
        alert('Failed to convert document: ' + (result.error || 'Unknown error'))
      }
    } catch (error) {
      console.error('Failed to convert document:', error)
      alert('Failed to convert document')
    } finally {
      setIsConverting(null)
    }
  }

  if (documents.length === 0) {
    return null
  }

  return (
    <Section title={`Documents (${documents.length})`} noPadding>
      <div>
        {documents.map((attachment, index) => (
          <div
            key={attachment.id}
            className="flex items-center justify-between px-4 py-3"
            style={{
              borderBottom:
                index < documents.length - 1
                  ? '0.5px solid var(--border-subtle)'
                  : 'none',
            }}
          >
            <div className="flex items-center gap-3">
              <div className="icon-container">
                <FileText className="w-4 h-4" />
              </div>
              <div>
                <p className="text-sm font-medium" style={{ color: 'var(--fg-default)' }}>
                  {attachment.originalFileName}
                </p>
                <p className="text-xs" style={{ color: 'var(--fg-muted)' }}>
                  {attachment.fileSize && <>{(attachment.fileSize / 1024).toFixed(1)} KB</>}
                </p>
              </div>
            </div>
            <div className="flex items-center gap-1">
              <button
                onClick={() => handleConvertFromWord(attachment.id)}
                disabled={isConverting === attachment.id}
                className="btn btn-ghost !p-2"
                title="Convert to Markdown"
              >
                {isConverting === attachment.id ? (
                  <LoadingSpinner size="sm" />
                ) : (
                  <Wand2 className="w-4 h-4" />
                )}
              </button>
              <a
                href={`/uploads/${attachment.filePath}`}
                download={attachment.originalFileName}
                className="btn btn-ghost !p-2"
                title="Download"
              >
                <Download className="w-4 h-4" />
              </a>
            </div>
          </div>
        ))}
      </div>
    </Section>
  )
}
