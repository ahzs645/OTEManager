import { useState, useRef, useEffect } from 'react'
import { FileText, Download, Wand2, Eye, FileEdit, MessageSquare, X } from 'lucide-react'
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
  onConvertToFeedback?: (content: string) => void
}

export function DocumentList({
  documents,
  articleId,
  onConvertToMarkdown,
  onConvertToFeedback,
}: DocumentListProps) {
  const [isConverting, setIsConverting] = useState<string | null>(null)
  const [showMenu, setShowMenu] = useState<string | null>(null)
  const [previewAttachmentId, setPreviewAttachmentId] = useState<string | null>(null)
  const [previewFileName, setPreviewFileName] = useState<string | null>(null)
  const [isLoadingPreview, setIsLoadingPreview] = useState(false)
  const previewContainerRef = useRef<HTMLDivElement>(null)

  const convertDocument = async (
    attachmentId: string,
    format: 'markdown' | 'html',
  ): Promise<{ success: boolean; content?: string; error?: string }> => {
    const response = await fetch(`/api/convertDocx/${attachmentId}?format=${format}`)
    const data = await response.json()
    if (!response.ok) {
      return { success: false, error: data.error || 'Failed to convert' }
    }
    return { success: true, content: data.content }
  }

  const handleConvertToContent = async (attachmentId: string) => {
    setIsConverting(attachmentId)
    setShowMenu(null)
    try {
      const result = await convertDocument(attachmentId, 'markdown')
      if (result.success && result.content) {
        onConvertToMarkdown(result.content)
      } else {
        alert('Failed to convert document: ' + (result.error || 'Unknown error'))
      }
    } catch (error) {
      console.error('Failed to convert document:', error)
      alert('Failed to convert document')
    } finally {
      setIsConverting(null)
    }
  }

  const handleConvertToFeedback = async (attachmentId: string) => {
    if (!onConvertToFeedback) return
    setIsConverting(attachmentId)
    setShowMenu(null)
    try {
      const result = await convertDocument(attachmentId, 'markdown')
      if (result.success && result.content) {
        onConvertToFeedback(result.content)
      } else {
        alert('Failed to convert document: ' + (result.error || 'Unknown error'))
      }
    } catch (error) {
      console.error('Failed to convert document:', error)
      alert('Failed to convert document')
    } finally {
      setIsConverting(null)
    }
  }

  const handlePreview = (attachmentId: string, fileName: string) => {
    setShowMenu(null)
    setPreviewAttachmentId(attachmentId)
    setPreviewFileName(fileName)
    setIsLoadingPreview(true)
  }

  const closePreview = () => {
    setPreviewAttachmentId(null)
    setPreviewFileName(null)
    setIsLoadingPreview(false)
  }

  // Load docx-preview when preview is opened
  useEffect(() => {
    if (!previewAttachmentId || !previewContainerRef.current) return

    const loadPreview = async () => {
      try {
        // Dynamically import docx-preview (browser-only)
        const docxPreview = await import('docx-preview')

        // Fetch the raw docx file
        const response = await fetch(`/api/convertDocx/${previewAttachmentId}?format=raw`)
        if (!response.ok) {
          throw new Error('Failed to fetch document')
        }
        const blob = await response.blob()

        // Clear container and render
        if (previewContainerRef.current) {
          previewContainerRef.current.innerHTML = ''
          await docxPreview.renderAsync(blob, previewContainerRef.current, undefined, {
            className: 'docx-preview',
            inWrapper: true,
            ignoreWidth: false,
            ignoreHeight: false,
            ignoreFonts: false,
            breakPages: true,
            ignoreLastRenderedPageBreak: true,
            experimental: false,
            trimXmlDeclaration: true,
            useBase64URL: true,
            renderHeaders: true,
            renderFooters: true,
            renderFootnotes: true,
            renderEndnotes: true,
          })
        }
      } catch (error) {
        console.error('Failed to load preview:', error)
        if (previewContainerRef.current) {
          previewContainerRef.current.innerHTML = `
            <div style="padding: 2rem; text-align: center; color: var(--fg-muted);">
              Failed to load document preview
            </div>
          `
        }
      } finally {
        setIsLoadingPreview(false)
      }
    }

    loadPreview()
  }, [previewAttachmentId])

  if (documents.length === 0) {
    return null
  }

  return (
    <>
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
              <div className="flex items-center gap-1 relative">
                {isConverting === attachment.id ? (
                  <div className="btn btn-ghost !p-2">
                    <LoadingSpinner size="sm" />
                  </div>
                ) : (
                  <div className="relative">
                    <button
                      onClick={() =>
                        setShowMenu(showMenu === attachment.id ? null : attachment.id)
                      }
                      className="btn btn-ghost !p-2"
                      title="Convert options"
                    >
                      <Wand2 className="w-4 h-4" />
                    </button>
                    {showMenu === attachment.id && (
                      <>
                        <div
                          className="fixed inset-0 z-10"
                          onClick={() => setShowMenu(null)}
                        />
                        <div
                          className="absolute right-0 top-full mt-1 z-20 min-w-[200px] py-1 rounded-md shadow-lg"
                          style={{
                            background: 'var(--bg-surface)',
                            border: '1px solid var(--border-default)',
                          }}
                        >
                          <button
                            onClick={() =>
                              handlePreview(attachment.id, attachment.originalFileName)
                            }
                            className="w-full flex items-center gap-2 px-3 py-2 text-sm text-left hover:bg-[var(--bg-subtle)]"
                            style={{ color: 'var(--fg-default)' }}
                          >
                            <Eye className="w-4 h-4" />
                            Preview Document
                          </button>
                          <button
                            onClick={() => handleConvertToContent(attachment.id)}
                            className="w-full flex items-center gap-2 px-3 py-2 text-sm text-left hover:bg-[var(--bg-subtle)]"
                            style={{ color: 'var(--fg-default)' }}
                          >
                            <FileEdit className="w-4 h-4" />
                            Insert to Article Content
                          </button>
                          {onConvertToFeedback && (
                            <button
                              onClick={() => handleConvertToFeedback(attachment.id)}
                              className="w-full flex items-center gap-2 px-3 py-2 text-sm text-left hover:bg-[var(--bg-subtle)]"
                              style={{ color: 'var(--fg-default)' }}
                            >
                              <MessageSquare className="w-4 h-4" />
                              Insert to Feedback Letter
                            </button>
                          )}
                        </div>
                      </>
                    )}
                  </div>
                )}
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

      {/* Preview Modal with docx-preview */}
      {previewAttachmentId && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4"
          style={{ background: 'rgba(0, 0, 0, 0.5)' }}
          onClick={closePreview}
        >
          <div
            className="relative w-full max-w-4xl max-h-[90vh] rounded-lg shadow-xl overflow-hidden flex flex-col"
            style={{ background: 'var(--bg-surface)' }}
            onClick={(e) => e.stopPropagation()}
          >
            <div
              className="flex items-center justify-between px-4 py-3 flex-shrink-0"
              style={{ borderBottom: '1px solid var(--border-default)' }}
            >
              <h3 className="font-medium" style={{ color: 'var(--fg-default)' }}>
                {previewFileName}
              </h3>
              <button onClick={closePreview} className="btn btn-ghost !p-2">
                <X className="w-4 h-4" />
              </button>
            </div>
            <div
              className="flex-1 overflow-auto relative"
              style={{ minHeight: '400px', background: '#f5f5f5' }}
            >
              {isLoadingPreview && (
                <div className="absolute inset-0 flex items-center justify-center">
                  <LoadingSpinner />
                </div>
              )}
              <div
                ref={previewContainerRef}
                className="docx-preview-container"
                style={{ minHeight: '100%' }}
              />
            </div>
          </div>
        </div>
      )}

      {/* Styles for docx-preview */}
      <style>{`
        .docx-preview-container .docx-wrapper {
          background: white;
          padding: 20px;
        }
        .docx-preview-container .docx-wrapper > section.docx {
          box-shadow: 0 2px 8px rgba(0,0,0,0.1);
          margin: 20px auto;
          background: white;
        }
      `}</style>
    </>
  )
}
