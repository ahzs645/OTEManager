import { useEffect, useState } from 'react'
import { Link } from '@tanstack/react-router'
import { Download, ImageIcon, X } from 'lucide-react'
import { LoadingSpinner } from '~/components/Layout'
import { getIssueArticles } from '~/lib/queries'
import { setAttachmentsIncludeInExport } from '~/lib/mutations'
import { fileUrl } from '~/lib/files'

interface ExportPhoto {
  id: string
  filePath: string
  originalFileName: string
  photoNumber: number | null
  caption: string | null
  includeInExport?: boolean | null
}

interface ExportArticle {
  id: string
  title: string
  photos: ExportPhoto[]
}

interface IssueExportModalProps {
  issueId: string
  issueLabel: string
  onExport: () => Promise<void>
  onClose: () => void
}

// Photos predating the export selection have no flag and count as selected
const isSelectedForExport = (photo: ExportPhoto) => photo.includeInExport !== false

export function IssueExportModal({ issueId, issueLabel, onExport, onClose }: IssueExportModalProps) {
  const [articles, setArticles] = useState<ExportArticle[] | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [isExporting, setIsExporting] = useState(false)

  useEffect(() => {
    let cancelled = false
    getIssueArticles({ data: { issueId } })
      .then(({ articles }) => {
        if (cancelled) return
        setArticles(
          articles
            .map((a) => ({
              id: a.id,
              title: a.title,
              photos: a.attachments
                .filter((f) => f.attachmentType === 'photo')
                .sort((x, y) => (x.photoNumber ?? 0) - (y.photoNumber ?? 0)),
            }))
            .sort((x, y) => x.title.localeCompare(y.title))
        )
      })
      .catch((error) => {
        console.error('Failed to load issue articles:', error)
        if (!cancelled) setLoadError('Could not load the articles in this issue.')
      })
    return () => {
      cancelled = true
    }
  }, [issueId])

  const setIncludeInExport = async (ids: string[], includeInExport: boolean) => {
    if (!articles || ids.length === 0) return
    const previous = articles
    setArticles(
      articles.map((a) => ({
        ...a,
        photos: a.photos.map((p) => (ids.includes(p.id) ? { ...p, includeInExport } : p)),
      }))
    )
    try {
      const result = await setAttachmentsIncludeInExport({
        data: { attachmentIds: ids, includeInExport },
      })
      if (!result.success) throw new Error(result.error || 'Unknown error')
    } catch (error) {
      console.error('Failed to update export selection:', error)
      setArticles(previous)
      alert('Failed to update export selection')
    }
  }

  const handleExport = async () => {
    setIsExporting(true)
    try {
      await onExport()
      onClose()
    } finally {
      setIsExporting(false)
    }
  }

  const allPhotos = articles?.flatMap((a) => a.photos) ?? []
  const selectedCount = allPhotos.filter(isSelectedForExport).length

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
        role="dialog"
        aria-label={`Export ${issueLabel}`}
        style={{
          position: 'relative',
          background: 'var(--bg-surface)',
          borderRadius: '12px',
          boxShadow: '0 25px 50px -12px rgba(0, 0, 0, 0.25)',
          width: '100%',
          maxWidth: '760px',
          maxHeight: '90vh',
          display: 'flex',
          flexDirection: 'column',
        }}
      >
        {/* Header */}
        <div
          style={{
            display: 'flex',
            alignItems: 'flex-start',
            justifyContent: 'space-between',
            gap: '1rem',
            padding: '1rem 1.25rem',
            borderBottom: '1px solid var(--border-default)',
          }}
        >
          <div>
            <h3 style={{ fontWeight: 600, color: 'var(--fg-default)' }}>Export {issueLabel}</h3>
            <p style={{ fontSize: '0.8125rem', color: 'var(--fg-muted)', marginTop: '0.125rem' }}>
              Choose the photos to include. Selections are saved to each article and also apply to the
              WordPress export.
            </p>
          </div>
          <button className="btn btn-ghost !p-1.5" onClick={onClose} title="Close">
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Body */}
        <div style={{ overflowY: 'auto', padding: '1rem 1.25rem', flex: 1 }}>
          {loadError ? (
            <p style={{ fontSize: '0.875rem', color: 'var(--status-error)' }}>{loadError}</p>
          ) : !articles ? (
            <div style={{ display: 'flex', justifyContent: 'center', padding: '2rem' }}>
              <LoadingSpinner />
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
              {articles.map((article) => {
                const articleSelected = article.photos.filter(isSelectedForExport)
                return (
                  <div key={article.id}>
                    <div
                      style={{
                        display: 'flex',
                        alignItems: 'baseline',
                        justifyContent: 'space-between',
                        gap: '0.75rem',
                        marginBottom: '0.5rem',
                      }}
                    >
                      <Link
                        to="/article/$articleId"
                        params={{ articleId: article.id }}
                        style={{ fontSize: '0.875rem', fontWeight: 500, color: 'var(--fg-default)', textDecoration: 'none' }}
                      >
                        {article.title}
                      </Link>
                      {article.photos.length > 0 && (
                        <div
                          style={{
                            display: 'flex',
                            alignItems: 'center',
                            gap: '0.75rem',
                            fontSize: '0.75rem',
                            color: 'var(--fg-muted)',
                            whiteSpace: 'nowrap',
                          }}
                        >
                          <span>
                            {articleSelected.length} of {article.photos.length}
                          </span>
                          <button
                            onClick={() =>
                              setIncludeInExport(
                                article.photos.filter((p) => !isSelectedForExport(p)).map((p) => p.id),
                                true
                              )
                            }
                            disabled={articleSelected.length === article.photos.length}
                            style={{
                              color:
                                articleSelected.length === article.photos.length
                                  ? 'var(--fg-faint)'
                                  : 'var(--accent)',
                            }}
                          >
                            All
                          </button>
                          <button
                            onClick={() =>
                              setIncludeInExport(articleSelected.map((p) => p.id), false)
                            }
                            disabled={articleSelected.length === 0}
                            style={{
                              color: articleSelected.length === 0 ? 'var(--fg-faint)' : 'var(--accent)',
                            }}
                          >
                            None
                          </button>
                        </div>
                      )}
                    </div>
                    {article.photos.length === 0 ? (
                      <p
                        style={{
                          fontSize: '0.75rem',
                          color: 'var(--fg-faint)',
                          display: 'flex',
                          alignItems: 'center',
                          gap: '0.375rem',
                        }}
                      >
                        <ImageIcon className="w-3.5 h-3.5" />
                        No photos attached
                      </p>
                    ) : (
                      <div
                        style={{
                          display: 'grid',
                          gridTemplateColumns: 'repeat(auto-fill, minmax(110px, 1fr))',
                          gap: '0.5rem',
                        }}
                      >
                        {article.photos.map((photo) => {
                          const selected = isSelectedForExport(photo)
                          const name = photo.photoNumber ? `Photo ${photo.photoNumber}` : photo.originalFileName
                          return (
                            <label
                              key={photo.id}
                              title={photo.caption ? `${name}: ${photo.caption}` : name}
                              style={{
                                position: 'relative',
                                display: 'block',
                                cursor: 'pointer',
                                borderRadius: '6px',
                                overflow: 'hidden',
                                border: selected
                                  ? '2px solid var(--accent)'
                                  : '2px solid var(--border-default)',
                              }}
                            >
                              <img
                                src={fileUrl(photo.filePath, 240)}
                                alt={name}
                                loading="lazy"
                                style={{
                                  display: 'block',
                                  width: '100%',
                                  aspectRatio: '1',
                                  objectFit: 'cover',
                                  opacity: selected ? 1 : 0.4,
                                }}
                              />
                              <input
                                type="checkbox"
                                checked={selected}
                                onChange={(e) => setIncludeInExport([photo.id], e.target.checked)}
                                aria-label={`Include ${name} in export`}
                                style={{
                                  position: 'absolute',
                                  top: '0.375rem',
                                  left: '0.375rem',
                                  width: '16px',
                                  height: '16px',
                                  accentColor: 'var(--accent)',
                                }}
                              />
                              <span
                                style={{
                                  position: 'absolute',
                                  left: 0,
                                  right: 0,
                                  bottom: 0,
                                  padding: '0.125rem 0.375rem',
                                  fontSize: '0.6875rem',
                                  color: 'white',
                                  background: 'rgba(0, 0, 0, 0.55)',
                                  whiteSpace: 'nowrap',
                                  overflow: 'hidden',
                                  textOverflow: 'ellipsis',
                                }}
                              >
                                {name}
                              </span>
                            </label>
                          )
                        })}
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
          )}
        </div>

        {/* Footer */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: '1rem',
            padding: '0.75rem 1.25rem',
            borderTop: '1px solid var(--border-default)',
          }}
        >
          <span style={{ fontSize: '0.8125rem', color: 'var(--fg-muted)' }}>
            {articles
              ? `${articles.length} article${articles.length !== 1 ? 's' : ''} · ${selectedCount} of ${allPhotos.length} photo${allPhotos.length !== 1 ? 's' : ''} selected`
              : ' '}
          </span>
          <div style={{ display: 'flex', gap: '0.5rem' }}>
            <button className="btn btn-ghost btn-sm" onClick={onClose}>
              Cancel
            </button>
            <button
              className="btn btn-primary btn-sm"
              onClick={handleExport}
              disabled={!articles || isExporting}
            >
              {isExporting ? <LoadingSpinner size="sm" /> : <Download className="w-3.5 h-3.5" />}
              Export ZIP
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
