import { useState, useRef, useEffect } from 'react'
import { useRouter } from '@tanstack/react-router'
import { Download, Edit2, Upload, ImageIcon, Trash2 } from 'lucide-react'
import { Section, LoadingSpinner } from '~/components/Layout'
import { fileUrl } from '~/lib/files'
import {
  updateAttachmentCaption,
  deleteAttachment,
  setAttachmentsIncludeInExport,
} from '~/lib/mutations'
import { CaptionModal } from './CaptionModal'

interface Photo {
  id: string
  filePath: string
  originalFileName: string
  photoNumber: number | null
  caption: string | null
  includeInExport?: boolean | null
}

// Photos predating the export selection have no flag and count as selected
const isSelectedForExport = (photo: Photo) => photo.includeInExport !== false

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
  const [isDeleting, setIsDeleting] = useState<string | null>(null)
  const [localPhotos, setLocalPhotos] = useState(photos)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const router = useRouter()

  // Keep local photos in sync when the route data is refreshed
  useEffect(() => {
    setLocalPhotos(photos)
  }, [photos])

  const handleDelete = async (attachmentId: string) => {
    if (!confirm('Are you sure you want to delete this photo?')) return
    setIsDeleting(attachmentId)
    try {
      const result = await deleteAttachment({ data: { attachmentId } })
      if (result.success) {
        setLocalPhotos((prev) => prev.filter((p) => p.id !== attachmentId))
      } else {
        alert('Failed to delete photo: ' + (result.error || 'Unknown error'))
      }
    } catch (error) {
      console.error('Failed to delete photo:', error)
      alert('Failed to delete photo')
    } finally {
      setIsDeleting(null)
    }
  }

  const setIncludeInExport = async (ids: string[], includeInExport: boolean) => {
    if (ids.length === 0) return
    const previous = localPhotos
    setLocalPhotos((prev) =>
      prev.map((p) => (ids.includes(p.id) ? { ...p, includeInExport } : p))
    )
    try {
      const result = await setAttachmentsIncludeInExport({
        data: { attachmentIds: ids, includeInExport },
      })
      if (!result.success) throw new Error(result.error || 'Unknown error')
    } catch (error) {
      console.error('Failed to update export selection:', error)
      setLocalPhotos(previous)
      alert('Failed to update export selection')
    }
  }

  const selectedCount = localPhotos.filter(isSelectedForExport).length

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
      await router.invalidate()
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
      photoUrl: fileUrl(photo.filePath, 960),
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
      // Update the caption locally right away, then refresh route data
      setLocalPhotos((prev) =>
        prev.map((p) => (p.id === editingCaption.id ? { ...p, caption: captionText } : p))
      )
      setEditingCaption(null)
      setCaptionText('')
      await router.invalidate()
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
        hidden
      />

      <Section
        title={`Photos (${localPhotos.length})`}
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
          style={isDragOver ? { '--tw-ring-color': 'var(--accent)', background: 'var(--accent-subtle)' } as React.CSSProperties : {}}
        >
        {localPhotos.length > 0 && (
          <div
            className="flex items-center justify-between mb-3 text-xs"
            style={{ color: 'var(--fg-muted)' }}
          >
            <span>
              {selectedCount} of {localPhotos.length} selected for export
            </span>
            <div className="flex items-center gap-3">
              <button
                onClick={() =>
                  setIncludeInExport(
                    localPhotos.filter((p) => !isSelectedForExport(p)).map((p) => p.id),
                    true
                  )
                }
                disabled={selectedCount === localPhotos.length}
                style={{ color: selectedCount === localPhotos.length ? 'var(--fg-faint)' : 'var(--accent)' }}
              >
                Select all
              </button>
              <button
                onClick={() =>
                  setIncludeInExport(
                    localPhotos.filter(isSelectedForExport).map((p) => p.id),
                    false
                  )
                }
                disabled={selectedCount === 0}
                style={{ color: selectedCount === 0 ? 'var(--fg-faint)' : 'var(--accent)' }}
              >
                Select none
              </button>
            </div>
          </div>
        )}
        {localPhotos.length === 0 ? (
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
          {localPhotos.map((photo) => {
            const selected = isSelectedForExport(photo)
            return (
            <div
              key={photo.id}
              className="rounded-lg overflow-hidden relative"
              style={{
                border: selected ? '1px solid var(--accent)' : '0.5px solid var(--border-default)',
              }}
            >
              {/* Export selection */}
              <label
                className="absolute top-2 left-2 z-10 flex items-center gap-1.5 rounded px-1.5 py-1 text-xs cursor-pointer"
                style={{ background: 'rgba(255,255,255,0.9)', color: 'var(--fg-default)' }}
                title={selected ? 'Included in exports' : 'Left out of exports'}
              >
                <input
                  type="checkbox"
                  checked={selected}
                  onChange={(e) => setIncludeInExport([photo.id], e.target.checked)}
                  style={{ accentColor: 'var(--accent)' }}
                />
                Export
              </label>
              {/* Photo Preview */}
              <a
                href={fileUrl(photo.filePath)}
                target="_blank"
                rel="noopener noreferrer"
                className="block aspect-square bg-gray-100 relative group"
              >
                <img
                  src={fileUrl(photo.filePath, 480)}
                  alt={photo.originalFileName}
                  loading="lazy"
                  decoding="async"
                  className="w-full h-full object-cover transition-opacity"
                  style={{ opacity: selected ? 1 : 0.45 }}
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
                {/* Download and Delete */}
                <div className="flex items-center justify-between mt-2">
                  <a
                    href={fileUrl(photo.filePath)}
                    download={photo.originalFileName}
                    className="text-xs inline-flex items-center gap-1"
                    style={{ color: 'var(--accent)' }}
                  >
                    <Download className="w-3 h-3" />
                    Download
                  </a>
                  <button
                    onClick={() => handleDelete(photo.id)}
                    disabled={isDeleting === photo.id}
                    className="btn btn-ghost !p-1"
                    title="Delete photo"
                    style={{ color: 'var(--status-error)' }}
                  >
                    {isDeleting === photo.id ? (
                      <LoadingSpinner size="sm" />
                    ) : (
                      <Trash2 className="w-3 h-3" />
                    )}
                  </button>
                </div>
              </div>
            </div>
            )
          })}
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
