import { createFileRoute, Link } from '@tanstack/react-router'
import { useState } from 'react'
import {
  Download,
  Upload,
  ChevronLeft,
  Database,
  CheckCircle,
  AlertCircle,
  FileArchive,
  AlertTriangle,
} from 'lucide-react'
import { LoadingSpinner } from '~/components/Layout'

export const Route = createFileRoute('/utilities/backup')({
  component: BackupPage,
})

function BackupPage() {
  const [isExporting, setIsExporting] = useState(false)
  const [isImporting, setIsImporting] = useState(false)
  const [exportResult, setExportResult] = useState<{ success: boolean; message: string } | null>(
    null
  )
  const [importResult, setImportResult] = useState<{ success: boolean; message: string } | null>(
    null
  )
  const [importMode, setImportMode] = useState<'merge' | 'replace'>('merge')

  const handleBackupExport = async () => {
    setIsExporting(true)
    setExportResult(null)

    try {
      const response = await fetch('/api/backup/export')

      if (!response.ok) {
        throw new Error('Backup export failed')
      }

      const blob = await response.blob()
      const filename =
        response.headers.get('Content-Disposition')?.match(/filename="(.+)"/)?.[1] || 'backup.zip'

      const url = window.URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = filename
      document.body.appendChild(a)
      a.click()
      window.URL.revokeObjectURL(url)
      document.body.removeChild(a)

      setExportResult({ success: true, message: 'Backup downloaded successfully' })
    } catch (error) {
      setExportResult({
        success: false,
        message: error instanceof Error ? error.message : 'Backup failed',
      })
    } finally {
      setIsExporting(false)
    }
  }

  const handleBackupImport = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return

    setIsImporting(true)
    setImportResult(null)

    try {
      const formData = new FormData()
      formData.append('file', file)
      formData.append('mode', importMode)

      const response = await fetch('/api/backup/import', {
        method: 'POST',
        body: formData,
      })

      const result = await response.json()

      if (!response.ok) {
        throw new Error(result.error || 'Import failed')
      }

      setImportResult({
        success: true,
        message: `Restored successfully: ${result.stats?.articles?.imported || 0} articles, ${result.stats?.authors?.imported || 0} authors`,
      })
    } catch (error) {
      setImportResult({
        success: false,
        message: error instanceof Error ? error.message : 'Import failed',
      })
    } finally {
      setIsImporting(false)
      // Reset file input
      e.target.value = ''
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
            <Database className="w-5 h-5" style={{ color: 'var(--fg-muted)' }} />
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
              Backup & Restore
            </h1>
            <p
              style={{ fontSize: '0.875rem', color: 'var(--fg-muted)', margin: '0.25rem 0 0 0' }}
            >
              Export or restore your entire database including all files
            </p>
          </div>
        </div>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
        {/* Export Section */}
        <div
          style={{
            background: 'var(--bg-surface)',
            border: '0.5px solid var(--border-default)',
            borderRadius: '8px',
            padding: '1.5rem',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', marginBottom: '1rem' }}>
            <Download className="w-5 h-5" style={{ color: 'var(--fg-muted)' }} />
            <h2
              style={{
                fontSize: '1rem',
                fontWeight: 600,
                color: 'var(--fg-default)',
                margin: 0,
              }}
            >
              Export Backup
            </h2>
          </div>

          <p style={{ fontSize: '0.875rem', color: 'var(--fg-muted)', marginBottom: '1rem' }}>
            Download a complete backup of your database including all articles, authors, volumes,
            issues, and uploaded files. The backup is saved as a ZIP file with a JSON manifest.
          </p>

          <div style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
            <button
              onClick={handleBackupExport}
              disabled={isExporting}
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
                  <FileArchive className="w-4 h-4" />
                  Download Backup
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

        {/* Import Section */}
        <div
          style={{
            background: 'var(--bg-surface)',
            border: '0.5px solid var(--border-default)',
            borderRadius: '8px',
            padding: '1.5rem',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', marginBottom: '1rem' }}>
            <Upload className="w-5 h-5" style={{ color: 'var(--fg-muted)' }} />
            <h2
              style={{
                fontSize: '1rem',
                fontWeight: 600,
                color: 'var(--fg-default)',
                margin: 0,
              }}
            >
              Restore from Backup
            </h2>
          </div>

          <p style={{ fontSize: '0.875rem', color: 'var(--fg-muted)', marginBottom: '1rem' }}>
            Restore your database from a previously exported backup file. Choose between merging
            with existing data or replacing all data.
          </p>

          {/* Import Mode Selection */}
          <div style={{ marginBottom: '1rem' }}>
            <label
              style={{
                display: 'block',
                fontSize: '0.8125rem',
                fontWeight: 500,
                color: 'var(--fg-default)',
                marginBottom: '0.5rem',
              }}
            >
              Import Mode
            </label>
            <div style={{ display: 'flex', gap: '1rem' }}>
              <label
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '0.5rem',
                  cursor: 'pointer',
                }}
              >
                <input
                  type="radio"
                  name="importMode"
                  value="merge"
                  checked={importMode === 'merge'}
                  onChange={() => setImportMode('merge')}
                  style={{ accentColor: 'var(--accent)' }}
                />
                <span style={{ fontSize: '0.875rem', color: 'var(--fg-default)' }}>
                  Merge (add new, skip existing)
                </span>
              </label>
              <label
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '0.5rem',
                  cursor: 'pointer',
                }}
              >
                <input
                  type="radio"
                  name="importMode"
                  value="replace"
                  checked={importMode === 'replace'}
                  onChange={() => setImportMode('replace')}
                  style={{ accentColor: 'var(--accent)' }}
                />
                <span style={{ fontSize: '0.875rem', color: 'var(--fg-default)' }}>
                  Replace (delete all first)
                </span>
              </label>
            </div>
          </div>

          {/* Warning for Replace mode */}
          {importMode === 'replace' && (
            <div
              style={{
                display: 'flex',
                alignItems: 'flex-start',
                gap: '0.75rem',
                padding: '0.75rem 1rem',
                background: 'rgba(245, 158, 11, 0.08)',
                border: '0.5px solid rgba(245, 158, 11, 0.25)',
                borderRadius: '6px',
                marginBottom: '1rem',
              }}
            >
              <AlertTriangle className="w-4 h-4" style={{ color: 'var(--status-warning)', flexShrink: 0, marginTop: '2px' }} />
              <p style={{ fontSize: '0.8125rem', color: 'var(--fg-muted)', margin: 0 }}>
                Replace mode will <strong>permanently delete</strong> all existing data before
                importing. Make sure you have a backup of your current data.
              </p>
            </div>
          )}

          {/* File Upload */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
            <label className="btn btn-secondary" style={{ gap: '0.5rem', cursor: 'pointer' }}>
              {isImporting ? (
                <>
                  <LoadingSpinner size="sm" />
                  Importing...
                </>
              ) : (
                <>
                  <Upload className="w-4 h-4" />
                  Choose Backup File
                </>
              )}
              <input
                type="file"
                accept=".zip"
                onChange={handleBackupImport}
                disabled={isImporting}
                style={{ display: 'none' }}
              />
            </label>

            {importResult && (
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '0.5rem',
                  fontSize: '0.875rem',
                  color: importResult.success ? 'var(--status-success)' : 'var(--status-error)',
                }}
              >
                {importResult.success ? (
                  <CheckCircle className="w-4 h-4" />
                ) : (
                  <AlertCircle className="w-4 h-4" />
                )}
                {importResult.message}
              </div>
            )}
          </div>
        </div>

        {/* Info Section */}
        <div
          style={{
            padding: '1rem 1.25rem',
            background: 'var(--bg-subtle)',
            borderRadius: '8px',
          }}
        >
          <h3
            style={{
              fontSize: '0.875rem',
              fontWeight: 500,
              color: 'var(--fg-default)',
              margin: '0 0 0.5rem 0',
            }}
          >
            What's included in a backup?
          </h3>
          <ul
            style={{
              fontSize: '0.8125rem',
              color: 'var(--fg-muted)',
              margin: 0,
              paddingLeft: '1.25rem',
              lineHeight: 1.6,
            }}
          >
            <li>All articles with content, status, and payment information</li>
            <li>Authors and their contact information</li>
            <li>Volumes and issues structure</li>
            <li>All uploaded files (photos, documents)</li>
            <li>Article notes and status history</li>
            <li>Payment rate configuration</li>
            <li>Saved article views</li>
          </ul>
        </div>
      </div>
    </div>
  )
}
