import { X } from 'lucide-react'
import { LoadingSpinner } from '~/components/Layout'

interface CaptionModalProps {
  photo: {
    id: string
    name: string
    caption: string
    photoUrl: string
  }
  captionText: string
  onCaptionChange: (text: string) => void
  onSave: () => void
  onClose: () => void
  isSaving: boolean
}

export function CaptionModal({
  photo,
  captionText,
  onCaptionChange,
  onSave,
  onClose,
  isSaving,
}: CaptionModalProps) {
  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 50,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '1rem',
      }}
    >
      {/* Backdrop */}
      <div
        style={{
          position: 'absolute',
          inset: 0,
          background: 'rgba(0, 0, 0, 0.5)',
          backdropFilter: 'blur(4px)',
        }}
        onClick={onClose}
      />

      {/* Modal */}
      <div
        style={{
          position: 'relative',
          background: 'var(--bg-surface)',
          borderRadius: '12px',
          boxShadow: '0 25px 50px -12px rgba(0, 0, 0, 0.25)',
          width: '100%',
          maxWidth: '650px',
          maxHeight: '90vh',
          overflow: 'auto',
        }}
      >
        {/* Modal Header */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            padding: '1rem 1.25rem',
            borderBottom: '1px solid var(--border-default)',
          }}
        >
          <h3 style={{ fontSize: '1rem', fontWeight: 600, color: 'var(--fg-default)', margin: 0 }}>
            Edit Caption
          </h3>
          <button
            onClick={onClose}
            style={{
              background: 'none',
              border: 'none',
              cursor: 'pointer',
              padding: '0.25rem',
              color: 'var(--fg-muted)',
            }}
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Modal Body */}
        <div style={{ padding: '1.25rem' }}>
          {/* Photo Preview */}
          <div
            style={{
              marginBottom: '1rem',
              borderRadius: '8px',
              overflow: 'hidden',
              background: 'var(--bg-subtle)',
            }}
          >
            <img
              src={photo.photoUrl}
              alt={photo.name}
              style={{
                width: '100%',
                height: '350px',
                objectFit: 'contain',
              }}
            />
          </div>

          {/* Photo Name */}
          <p
            style={{
              fontSize: '0.875rem',
              fontWeight: 500,
              color: 'var(--fg-default)',
              marginBottom: '0.75rem',
            }}
          >
            {photo.name}
          </p>

          {/* Caption Input */}
          <label
            style={{
              display: 'block',
              fontSize: '0.75rem',
              fontWeight: 500,
              color: 'var(--fg-muted)',
              marginBottom: '0.5rem',
            }}
          >
            Caption
          </label>
          <textarea
            value={captionText}
            onChange={(e) => onCaptionChange(e.target.value)}
            placeholder="Enter a descriptive caption for this photo..."
            rows={4}
            style={{
              width: '100%',
              padding: '0.75rem',
              fontSize: '0.875rem',
              background: 'var(--bg-surface)',
              border: '1px solid var(--border-default)',
              borderRadius: '8px',
              color: 'var(--fg-default)',
              resize: 'vertical',
              minHeight: '100px',
            }}
            autoFocus
          />
        </div>

        {/* Modal Footer */}
        <div
          style={{
            display: 'flex',
            justifyContent: 'flex-end',
            gap: '0.5rem',
            padding: '1rem 1.25rem',
            borderTop: '1px solid var(--border-default)',
            background: 'var(--bg-subtle)',
          }}
        >
          <button
            onClick={onClose}
            className="btn btn-secondary"
          >
            Cancel
          </button>
          <button
            onClick={onSave}
            disabled={isSaving}
            className="btn btn-primary"
          >
            {isSaving ? <LoadingSpinner size="sm" /> : 'Save Caption'}
          </button>
        </div>
      </div>
    </div>
  )
}
