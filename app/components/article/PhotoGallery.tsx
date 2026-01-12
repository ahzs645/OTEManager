import { useState } from 'react'
import { Download, Edit2 } from 'lucide-react'
import { Section } from '~/components/Layout'
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
}

export function PhotoGallery({ photos }: PhotoGalleryProps) {
  const [editingCaption, setEditingCaption] = useState<{
    id: string
    name: string
    caption: string
    photoUrl: string
  } | null>(null)
  const [captionText, setCaptionText] = useState('')
  const [isSavingCaption, setIsSavingCaption] = useState(false)

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

  if (photos.length === 0) {
    return null
  }

  return (
    <>
      <Section title={`Photos (${photos.length})`}>
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
