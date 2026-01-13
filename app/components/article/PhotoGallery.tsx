import { useState, useRef } from 'react'
import { Download, Edit2, Upload, ImageIcon } from 'lucide-react'
import { Section, LoadingSpinner } from '~/components/Layout'
import { updateAttachmentCaption } from '~/lib/mutations'
import { CaptionModal } from './CaptionModal'

interface Photo {
  id: string
  filePath: string
  originalFileName: string
  photoNumber: number | null
  caption: string | null
}

interface PhotoGalleryProps {
  photos: Photo[]
  articleId: string
}

export function PhotoGallery({ photos, articleId }: PhotoGalleryProps) {
  const [editingCaption, setEditingCaption] = useState<{
    id: string
    name: string
    caption: string
    photoUrl: string
  } | null>(null)
  const [captionText, setCaptionText] = useState('')
  const [isSavingCaption, setIsSavingCaption] = useState(false)
  const [isUploading, setIsUploading] = useState(false)
  const [isDragOver, setIsDragOver] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)

  const handleUploadClick = () => {
    fileInputRef.current?.click()
  }

  const uploadFiles = async (files: FileList | File[]) => {
    setIsUploading(true)
    try {
      for (const file of Array.from(files)) {
        const formData = new FormData()
        formData.append('file', file)
        formData.append('articleId', articleId)
        formData.append('attachmentType', 'photo')

        const response = await fetch('/api/uploadAttachment', {
          method: 'POST',
          body: formData,
        })

        const data = await response.json()
        if (!response.ok) {
          alert(data.error || `Failed to upload ${file.name}`)
        }
      }
      window.location.reload()
    } catch (error) {
      console.error('Upload error:', error)
      alert('Failed to upload photos')
    } finally {
      setIsUploading(false)
      if (fileInputRef.current) {
        fileInputRef.current.value = ''
      }
    }
  }

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files
    if (!files || files.length === 0) return
    await uploadFiles(files)
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
      const validTypes = ['image/jpeg', 'image/png', 'image/gif', 'image/webp']
      const validFiles = Array.from(files).filter(file => validTypes.includes(file.type))

      if (validFiles.length === 0) {
        alert('Please drop image files (JPEG, PNG, GIF, or WebP)')
        return
      }
      if (validFiles.length < files.length) {
        alert(`${files.length - validFiles.length} file(s) were skipped (unsupported format)`)
      }
      await uploadFiles(validFiles)
    }
  }

  const openCaptionModal = (photo: Photo) => {
    setEditingCaption({
      id: photo.id,
      name: photo.photoNumber ? `Photo ${photo.photoNumber}` : photo.originalFileName,
      caption: photo.caption || '',
      photoUrl: `/uploads/${photo.filePath}`,
    })
    setCaptionText(photo.caption || '')
  }

  const closeCaptionModal = () => {
    setEditingCaption(null)
    setCaptionText('')
  }

  const handleSaveCaption = async () => {
    if (!editingCaption) return
    setIsSavingCaption(true)
    try {
      await updateAttachmentCaption({ data: { attachmentId: editingCaption.id, caption: captionText } })
      setEditingCaption(null)
      setCaptionText('')
      window.location.reload()
    } catch (error) {
      console.error('Failed to save caption:', error)
    } finally {
      setIsSavingCaption(false)
    }
  }

  return (
    <>
      {/* Hidden file input for multiple images */}
      <input
        type="file"
        ref={fileInputRef}
        onChange={handleFileChange}
        accept="image/jpeg,image/png,image/gif,image/webp"
        multiple
        className="hidden"
      />

      <Section
        title={`Photos (${photos.length})`}
        action={
          <button
            onClick={handleUploadClick}
            disabled={isUploading}
            className="btn btn-ghost !p-1.5"
            title="Upload photos"
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
        {photos.length === 0 ? (
          <div className={`py-8 text-center transition-colors ${isDragOver ? 'bg-[var(--accent-subtle)]' : ''}`}>
            <ImageIcon className="w-10 h-10 mx-auto mb-2" style={{ color: isDragOver ? 'var(--accent)' : 'var(--fg-faint)' }} />
            <p className="text-sm" style={{ color: isDragOver ? 'var(--accent)' : 'var(--fg-muted)' }}>
              {isDragOver ? 'Drop photos here' : 'No photos attached'}
            </p>
            {!isDragOver && (
            <button
              onClick={handleUploadClick}
              disabled={isUploading}
              className="btn btn-secondary btn-sm mt-2"
            >
              <Upload className="w-4 h-4" />
              Upload Photos
            </button>
            )}
            <p className="text-xs mt-2" style={{ color: 'var(--fg-faint)' }}>
              or drag and drop images
            </p>
          </div>
        ) : (
        <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
          {photos.map((photo) => (
            <div
              key={photo.id}
              className="rounded-lg overflow-hidden"
              style={{ border: '0.5px solid var(--border-default)' }}
            >
              {/* Photo Preview */}
              <a
                href={`/uploads/${photo.filePath}`}
                target="_blank"
                rel="noopener noreferrer"
                className="block aspect-square bg-gray-100 relative group"
              >
                <img
                  src={`/uploads/${photo.filePath}`}
                  alt={photo.originalFileName}
                  className="w-full h-full object-cover"
                />
                <div
                  className="absolute inset-0 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity"
                  style={{ background: 'rgba(0,0,0,0.3)' }}
                >
                  <span className="text-white text-sm">View full size</span>
                </div>
              </a>
              {/* Photo Info */}
              <div className="p-3" style={{ background: 'var(--bg-subtle)' }}>
                <p
                  className="text-xs font-medium truncate"
                  style={{ color: 'var(--fg-default)' }}
                  title={photo.originalFileName}
                >
                  {photo.photoNumber ? `Photo ${photo.photoNumber}` : photo.originalFileName}
                </p>
                {/* Caption */}
                <div className="mt-1 flex items-start gap-1">
                  {photo.caption ? (
                    <p
                      className="text-xs italic flex-1 line-clamp-2"
                      style={{ color: 'var(--fg-muted)' }}
                    >
                      {photo.caption}
                    </p>
                  ) : (
                    <p
                      className="text-xs flex-1"
                      style={{ color: 'var(--fg-faint)' }}
                    >
                      No caption
                    </p>
                  )}
                  <button
                    onClick={() => openCaptionModal(photo)}
                    className="btn btn-ghost !p-1"
                    title="Edit caption"
                  >
                    <Edit2 className="w-3 h-3" />
                  </button>
                </div>
                {/* Download link */}
                <a
                  href={`/uploads/${photo.filePath}`}
                  download={photo.originalFileName}
                  className="text-xs mt-2 inline-flex items-center gap-1"
                  style={{ color: 'var(--accent)' }}
                >
                  <Download className="w-3 h-3" />
                  Download
                </a>
              </div>
            </div>
          ))}
        </div>
        )}
        </div>
      </Section>

      {/* Caption Edit Modal */}
      {editingCaption && (
        <CaptionModal
          photo={editingCaption}
          captionText={captionText}
          onCaptionChange={setCaptionText}
          onSave={handleSaveCaption}
          onClose={closeCaptionModal}
          isSaving={isSavingCaption}
        />
      )}
    </>
  )
}
