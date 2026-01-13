import { createFileRoute, Link } from '@tanstack/react-router'
import { useState } from 'react'
import {
  Download,
  ChevronLeft,
  FileJson,
  CheckCircle,
  AlertCircle,
  ImageIcon,
  FolderArchive,
} from 'lucide-react'
import { getVolumes } from '../lib/queries'
import { LoadingSpinner } from '~/components/Layout'

interface Volume {
  id: string
  volumeNumber: number
  year: number | null
  issues: Array<{
    id: string
    issueNumber: number
    title: string | null
    articleCount: number
  }>
}

export const Route = createFileRoute('/utilities/wp-export')({
  loader: async () => {
    const { volumes } = await getVolumes()
    return { volumes }
  },
  component: WPExportPage,
})

function WPExportPage() {
  const { volumes } = Route.useLoaderData() as { volumes: Volume[] }
  const [selectedVolume, setSelectedVolume] = useState<string>('')
  const [selectedIssues, setSelectedIssues] = useState<Set<string>>(new Set())
  const [includePhotos, setIncludePhotos] = useState(true)
  const [isExporting, setIsExporting] = useState(false)
  const [exportResult, setExportResult] = useState<{
    success: boolean
    message: string
  } | null>(null)

  const currentVolume = volumes.find((v) => v.id === selectedVolume)

  const handleVolumeChange = (volumeId: string) => {
    setSelectedVolume(volumeId)
    setSelectedIssues(new Set())
    setExportResult(null)
  }

  const toggleIssue = (issueId: string) => {
    const newSelected = new Set(selectedIssues)
    if (newSelected.has(issueId)) {
      newSelected.delete(issueId)
    } else {
      newSelected.add(issueId)
    }
    setSelectedIssues(newSelected)
    setExportResult(null)
  }

  const selectAllIssues = () => {
    if (currentVolume) {
      setSelectedIssues(new Set(currentVolume.issues.map((i) => i.id)))
    }
  }

  const clearAllIssues = () => {
    setSelectedIssues(new Set())
  }

  const handleExport = async () => {
    if (!selectedVolume || selectedIssues.size === 0) return

    setIsExporting(true)
    setExportResult(null)

    try {
      const response = await fetch('/api/exportBundle', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          volumeId: selectedVolume,
          issueIds: Array.from(selectedIssues),
          includePhotos,
        }),
      })

      if (!response.ok) {
        const error = await response.json()
        throw new Error(error.error || 'Export failed')
      }

      // Download the ZIP file
      const blob = await response.blob()
      const filename =
        response.headers.get('Content-Disposition')?.match(/filename="(.+)"/)?.[1] || 'export.zip'

      const url = window.URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = filename
      document.body.appendChild(a)
      a.click()
      window.URL.revokeObjectURL(url)
      document.body.removeChild(a)

      setExportResult({
        success: true,
        message: `Successfully exported ${selectedIssues.size} issue(s)`,
      })
    } catch (error) {
      setExportResult({
        success: false,
        message: error instanceof Error ? error.message : 'Export failed',
      })
    } finally {
      setIsExporting(false)
    }
  }

  return (
    <div className="page-container">
      {/* Header with back button */}
      <div style={{ marginBottom: '1.5rem' }}>
        <Link
          to="/utilities"
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: '0.25rem',
            fontSize: '0.8125rem',
            color: 'var(--fg-muted)',
            textDecoration: 'none',
            marginBottom: '0.75rem',
          }}
        >
          <ChevronLeft className="w-4 h-4" />
          Back to Utilities
        </Link>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
          <div
            style={{
              width: '40px',
              height: '40px',
              borderRadius: '10px',
              background: 'var(--bg-subtle)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <FolderArchive className="w-5 h-5" style={{ color: 'var(--fg-muted)' }} />
          </div>
          <div>
            <h1
              style={{
                fontSize: '1.25rem',
                fontWeight: 600,
                color: 'var(--fg-default)',
                margin: 0,
                letterSpacing: '-0.02em',
              }}
            >
              WP Export Bundler
            </h1>
            <p
              style={{ fontSize: '0.875rem', color: 'var(--fg-muted)', margin: '0.25rem 0 0 0' }}
            >
              Export articles as JSON with optional photos for WordPress import
            </p>
          </div>
        </div>
      </div>

      {/* Main Content */}
      <div
        style={{
          background: 'var(--bg-surface)',
          border: '0.5px solid var(--border-default)',
          borderRadius: '8px',
          padding: '1.5rem',
        }}
      >
        {/* Volume Selection */}
        <div style={{ marginBottom: '1.5rem' }}>
          <label
            style={{
              display: 'block',
              fontSize: '0.8125rem',
              fontWeight: 500,
              color: 'var(--fg-default)',
              marginBottom: '0.5rem',
            }}
          >
            Select Volume
          </label>
          <select
            value={selectedVolume}
            onChange={(e) => handleVolumeChange(e.target.value)}
            className="input"
            style={{ width: '100%', maxWidth: '400px' }}
          >
            <option value="">Choose a volume...</option>
            {volumes.map((volume) => (
              <option key={volume.id} value={volume.id}>
                Volume {volume.volumeNumber}
                {volume.year ? ` (${volume.year})` : ''} - {volume.issues.length} issues
              </option>
            ))}
          </select>
        </div>

        {/* Issue Selection */}
        {currentVolume && currentVolume.issues.length > 0 && (
          <div style={{ marginBottom: '1.5rem' }}>
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                marginBottom: '0.5rem',
              }}
            >
              <label
                style={{
                  fontSize: '0.8125rem',
                  fontWeight: 500,
                  color: 'var(--fg-default)',
                }}
              >
                Select Issues
              </label>
              <div style={{ display: 'flex', gap: '0.5rem' }}>
                <button
                  onClick={selectAllIssues}
                  className="btn btn-ghost"
                  style={{ fontSize: '0.75rem', padding: '4px 10px' }}
                >
                  Select All
                </button>
                <button
                  onClick={clearAllIssues}
                  className="btn btn-ghost"
                  style={{ fontSize: '0.75rem', padding: '4px 10px' }}
                >
                  Clear
                </button>
              </div>
            </div>
            <div
              style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))',
                gap: '0.5rem',
              }}
            >
              {currentVolume.issues.map((issue) => (
                <label
                  key={issue.id}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: '0.75rem',
                    padding: '0.75rem 1rem',
                    background: selectedIssues.has(issue.id)
                      ? 'var(--bg-subtle)'
                      : 'transparent',
                    border: '0.5px solid var(--border-default)',
                    borderRadius: '6px',
                    cursor: 'pointer',
                    transition: 'background 0.15s',
                  }}
                >
                  <input
                    type="checkbox"
                    checked={selectedIssues.has(issue.id)}
                    onChange={() => toggleIssue(issue.id)}
                    style={{ accentColor: 'var(--accent)', width: '16px', height: '16px' }}
                  />
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div
                      style={{
                        fontSize: '0.875rem',
                        fontWeight: 500,
                        color: 'var(--fg-default)',
                      }}
                    >
                      Issue {issue.issueNumber}
                      {issue.title ? ` - ${issue.title}` : ''}
                    </div>
                    <div
                      style={{
                        fontSize: '0.75rem',
                        color: 'var(--fg-muted)',
                      }}
                    >
                      {issue.articleCount} article{issue.articleCount !== 1 ? 's' : ''}
                    </div>
                  </div>
                </label>
              ))}
            </div>
          </div>
        )}

        {currentVolume && currentVolume.issues.length === 0 && (
          <div
            style={{
              padding: '1.5rem',
              background: 'var(--bg-subtle)',
              borderRadius: '6px',
              color: 'var(--fg-muted)',
              fontSize: '0.875rem',
              textAlign: 'center',
              marginBottom: '1.5rem',
            }}
          >
            This volume has no issues yet.
          </div>
        )}

        {/* Photo Toggle */}
        {selectedIssues.size > 0 && (
          <div
            style={{
              marginBottom: '1.5rem',
              padding: '1rem',
              background: 'var(--bg-subtle)',
              borderRadius: '6px',
            }}
          >
            <label
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '0.75rem',
                cursor: 'pointer',
              }}
            >
              <input
                type="checkbox"
                checked={includePhotos}
                onChange={(e) => setIncludePhotos(e.target.checked)}
                style={{ accentColor: 'var(--accent)', width: '16px', height: '16px' }}
              />
              <ImageIcon className="w-5 h-5" style={{ color: 'var(--fg-muted)' }} />
              <div>
                <span style={{ fontSize: '0.875rem', fontWeight: 500, color: 'var(--fg-default)' }}>
                  Include photos in export
                </span>
                <p
                  style={{
                    fontSize: '0.75rem',
                    color: 'var(--fg-muted)',
                    margin: '0.25rem 0 0 0',
                  }}
                >
                  Photos will be organized by article in a separate folder within the ZIP
                </p>
              </div>
            </label>
          </div>
        )}

        {/* Export Button */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: '1rem',
            paddingTop: '0.5rem',
            borderTop: '0.5px solid var(--border-subtle)',
          }}
        >
          <button
            onClick={handleExport}
            disabled={isExporting || !selectedVolume || selectedIssues.size === 0}
            className="btn btn-primary"
            style={{ gap: '0.5rem' }}
          >
            {isExporting ? (
              <>
                <LoadingSpinner size="sm" />
                Exporting...
              </>
            ) : (
              <>
                <Download className="w-4 h-4" />
                Export {selectedIssues.size > 0 ? `${selectedIssues.size} Issue(s)` : 'Issues'}
              </>
            )}
          </button>

          {exportResult && (
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '0.5rem',
                fontSize: '0.875rem',
                color: exportResult.success ? 'var(--status-success)' : 'var(--status-error)',
              }}
            >
              {exportResult.success ? (
                <CheckCircle className="w-4 h-4" />
              ) : (
                <AlertCircle className="w-4 h-4" />
              )}
              {exportResult.message}
            </div>
          )}
        </div>
      </div>

      {/* Export Format Info */}
      <div
        style={{
          marginTop: '1.5rem',
          background: 'var(--bg-surface)',
          border: '0.5px solid var(--border-default)',
          borderRadius: '8px',
          padding: '1.25rem',
        }}
      >
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: '0.5rem',
            marginBottom: '0.75rem',
          }}
        >
          <FileJson className="w-4 h-4" style={{ color: 'var(--fg-muted)' }} />
          <span
            style={{
              fontSize: '0.875rem',
              fontWeight: 500,
              color: 'var(--fg-default)',
            }}
          >
            Export Format
          </span>
        </div>
        <p style={{ fontSize: '0.8125rem', color: 'var(--fg-muted)', margin: '0 0 0.75rem 0' }}>
          Each issue exports as a separate JSON file with the following structure:
        </p>
        <pre
          style={{
            fontSize: '0.75rem',
            color: 'var(--fg-muted)',
            margin: 0,
            padding: '1rem',
            background: 'var(--bg-subtle)',
            borderRadius: '6px',
            overflow: 'auto',
            fontFamily: 'var(--font-mono)',
          }}
        >
{`[
  {
    "id": "article-uuid",
    "title": "Article Title",
    "author": "Author Name",
    "role": "Contributor",
    "volume": "5",
    "issue": "3",
    "photo": [
      {
        "PhotoName": "image.jpg",
        "Caption": "Photo caption"
      }
    ],
    "content": "Article content in markdown..."
  }
]`}
        </pre>
      </div>
    </div>
  )
}
