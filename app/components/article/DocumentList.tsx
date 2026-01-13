import { useState, useRef, useEffect } from 'react'
import { FileText, Download, Wand2, Eye, FileEdit, MessageSquare, X, Upload } from 'lucide-react'
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
  const [isUploading, setIsUploading] = useState(false)
  const [isDragOver, setIsDragOver] = useState(false)
  const previewContainerRef = useRef<HTMLDivElement>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)

  const handleUploadClick = () => {
    fileInputRef.current?.click()
  }

  const uploadFile = async (file: File) => {
    setIsUploading(true)
    try {
      const formData = new FormData()
      formData.append('file', file)
      formData.append('articleId', articleId)
      formData.append('attachmentType', 'word_document')

      const response = await fetch('/api/uploadAttachment', {
        method: 'POST',
        body: formData,
      })

      const data = await response.json()
      if (!response.ok) {
        alert(data.error || 'Failed to upload document')
      } else {
        window.location.reload()
      }
    } catch (error) {
      console.error('Upload error:', error)
      alert('Failed to upload document')
    } finally {
      setIsUploading(false)
      if (fileInputRef.current) {
        fileInputRef.current.value = ''
      }
    }
  }

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    await uploadFile(file)
  }

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
    setIsDragOver(true)
  }

  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
    setIsDragOver(false)
  }

  const handleDrop = async (e: React.DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
    setIsDragOver(false)

    const files = e.dataTransfer.files
    if (files.length > 0) {
      const file = files[0]
      const validTypes = [
        'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        'application/msword',
      ]
      if (!validTypes.includes(file.type)) {
        alert('Please drop a Word document (.doc or .docx)')
        return
      }
      await uploadFile(file)
    }
  }

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
    if (previewAttachmentId === attachmentId) {
      // Toggle off if same document
      closePreview()
    } else {
      setPreviewAttachmentId(attachmentId)
      setPreviewFileName(fileName)
      setIsLoadingPreview(true)
    }
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
        const docxPreview = await import('docx-preview')
        const response = await fetch(`/api/convertDocx/${previewAttachmentId}?format=raw`)
        if (!response.ok) {
          throw new Error('Failed to fetch document')
        }
        const blob = await response.blob()

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

  return (
    <>
      {/* Hidden file input */}
      <input
        type="file"
        ref={fileInputRef}
        onChange={handleFileChange}
        accept=".doc,.docx,application/msword,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
        className="hidden"
      />

      <Section
        title={`Documents (${documents.length})`}
        noPadding
        action={
          <button
            onClick={handleUploadClick}
            disabled={isUploading}
            className="btn btn-ghost !p-1.5"
            title="Upload document"
          >
            {isUploading ? <LoadingSpinner size="sm" /> : <Upload className="w-4 h-4" />}
          </button>
        }
      >
        <div
          onDragOver={handleDragOver}
          onDragLeave={handleDragLeave}
          onDrop={handleDrop}
          className={isDragOver ? 'ring-2 ring-inset rounded-lg' : ''}
          style={isDragOver ? { ringColor: 'var(--accent)', background: 'var(--accent-subtle)' } : {}}
        >
          {documents.length === 0 ? (
            <div
              className={`px-4 py-6 text-center transition-colors ${isDragOver ? 'bg-[var(--accent-subtle)]' : ''}`}
            >
              <FileText className="w-8 h-8 mx-auto mb-2" style={{ color: isDragOver ? 'var(--accent)' : 'var(--fg-faint)' }} />
              <p className="text-sm" style={{ color: isDragOver ? 'var(--accent)' : 'var(--fg-muted)' }}>
                {isDragOver ? 'Drop document here' : 'No documents attached'}
              </p>
              {!isDragOver && (
                <button
                  onClick={handleUploadClick}
                  disabled={isUploading}
                  className="btn btn-secondary btn-sm mt-2"
                >
                  <Upload className="w-4 h-4" />
                  Upload Document
                </button>
              )}
              <p className="text-xs mt-2" style={{ color: 'var(--fg-faint)' }}>
                or drag and drop a Word document
              </p>
            </div>
          ) : null}
          {documents.map((attachment, index) => (
            <div
              key={attachment.id}
              className="flex items-center justify-between px-4 py-3"
              style={{
                borderBottom:
                  index < documents.length - 1 || previewAttachmentId
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
                  <>
                    {/* Preview Button */}
                    <button
                      onClick={() => handlePreview(attachment.id, attachment.originalFileName)}
                      className={`btn btn-ghost !p-2 ${previewAttachmentId === attachment.id ? 'bg-[var(--bg-subtle)]' : ''}`}
                      title="Preview document"
                    >
                      <Eye className="w-4 h-4" />
                    </button>

                    {/* Convert Options Menu */}
                    <div className="relative">
                      <button
                        onClick={() =>
                          setShowMenu(showMenu === attachment.id ? null : attachment.id)
                        }
                        className="btn btn-ghost !p-2"
                        title="Insert to content"
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
                  </>
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

          {/* Inline Preview Panel */}
          {previewAttachmentId && (
            <div
              className="border-t"
              style={{ borderColor: 'var(--border-subtle)' }}
            >
              {/* Preview Header */}
              <div
                className="flex items-center justify-between px-4 py-2"
                style={{
                  background: 'var(--bg-subtle)',
                  borderBottom: '0.5px solid var(--border-subtle)',
                }}
              >
                <div className="flex items-center gap-2">
                  <Eye className="w-3.5 h-3.5" style={{ color: 'var(--fg-muted)' }} />
                  <span className="text-xs font-medium" style={{ color: 'var(--fg-muted)' }}>
                    {previewFileName}
                  </span>
                </div>
                <button
                  onClick={closePreview}
                  className="btn btn-ghost !p-1"
                  title="Close preview"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              </div>

              {/* Preview Content */}
              <div
                className="relative"
                style={{
                  background: '#f8f9fa',
                  minHeight: '400px',
                  maxHeight: '600px',
                  overflow: 'auto',
                }}
              >
                {isLoadingPreview && (
                  <div
                    className="absolute inset-0 flex items-center justify-center"
                    style={{ background: '#f8f9fa' }}
                  >
                    <LoadingSpinner />
                  </div>
                )}
                <div
                  ref={previewContainerRef}
                  className="docx-preview-container"
                />
              </div>
            </div>
          )}
        </div>
      </Section>

      {/* Styles for docx-preview */}
      <style>{`
        .docx-preview-container .docx-wrapper {
          background: white;
          padding: 16px;
        }
        .docx-preview-container .docx-wrapper > section.docx {
          box-shadow: 0 1px 3px rgba(0,0,0,0.08);
          margin: 16px auto;
          background: white;
          border-radius: 4px;
        }
      `}</style>
    </>
  )
}
