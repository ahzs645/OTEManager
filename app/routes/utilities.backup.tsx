import { createFileRoute, Link } from '@tanstack/react-router'
import { useState, useRef } from 'react'
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

interface ImportResult {
  success: boolean
  error?: string
  stats?: {
    authors: { imported: number; skipped: number }
    volumes: { imported: number; skipped: number }
    issues: { imported: number; skipped: number }
    articles: { imported: number; skipped: number }
    attachments: { imported: number; skipped: number; filesRestored: number }
  }
  backupInfo?: {
    exportedAt: string
    version: string
  }
}

function BackupPage() {
  const [isExporting, setIsExporting] = useState(false)
  const [isImporting, setIsImporting] = useState(false)
  const [exportProgress, setExportProgress] = useState<{ stage: string; percent: number } | null>(null)
  const [exportResult, setExportResult] = useState<{ success: boolean; message: string } | null>(
    null
  )
  const [importResult, setImportResult] = useState<ImportResult | null>(null)
  const [importMode, setImportMode] = useState<'merge' | 'replace'>('merge')
  const [backupType, setBackupType] = useState<'both' | 'database' | 'files'>('both')
  const [restoreType, setRestoreType] = useState<'both' | 'database' | 'files'>('both')
  const [selectedFile, setSelectedFile] = useState<File | null>(null)
  const [showConfirmReplace, setShowConfirmReplace] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)

  const handleBackupExport = async () => {
    setIsExporting(true)
    setExportResult(null)
    setExportProgress({ stage: 'Preparing backup...', percent: 10 })

    try {
      // Start the fetch - server builds the entire ZIP before responding
      setExportProgress({ stage: 'Building backup on server...', percent: 20 })
      const response = await fetch(`/api/backup/export?type=${backupType}`)

      if (!response.ok) {
        throw new Error('Backup export failed')
      }

      // Get content length for progress tracking
      const contentLength = response.headers.get('Content-Length')
      const totalBytes = contentLength ? parseInt(contentLength, 10) : 0

      if (totalBytes && response.body) {
        // Stream the response with progress
        setExportProgress({ stage: 'Downloading...', percent: 30 })
        const reader = response.body.getReader()
        const chunks: Uint8Array[] = []
        let receivedBytes = 0

        while (true) {
          const { done, value } = await reader.read()
          if (done) break
          chunks.push(value)
          receivedBytes += value.length
          const percent = Math.min(30 + Math.round((receivedBytes / totalBytes) * 60), 90)
          setExportProgress({ stage: 'Downloading...', percent })
        }

        // Combine chunks into blob
        setExportProgress({ stage: 'Finalizing...', percent: 95 })
        const blob = new Blob(chunks)
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
      } else {
        // Fallback for when content-length is not available
        setExportProgress({ stage: 'Receiving backup data...', percent: 50 })
        const blob = await response.blob()
        setExportProgress({ stage: 'Preparing download...', percent: 90 })
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
      }

      setExportProgress({ stage: 'Complete!', percent: 100 })
      setExportResult({ success: true, message: 'Backup downloaded successfully' })
    } catch (error) {
      setExportResult({
        success: false,
        message: error instanceof Error ? error.message : 'Backup failed',
      })
    } finally {
      setIsExporting(false)
      setTimeout(() => setExportProgress(null), 1500)
    }
  }

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (file) {
      setSelectedFile(file)
      setImportResult(null)
      setShowConfirmReplace(false)
    }
  }

  const handleBackupImport = async () => {
    if (!selectedFile) return

    // If replace mode, show confirmation first
    if (importMode === 'replace' && !showConfirmReplace) {
      setShowConfirmReplace(true)
      return
    }

    setIsImporting(true)
    setShowConfirmReplace(false)
    setImportResult(null)

    try {
      const formData = new FormData()
      formData.append('backup', selectedFile)
      formData.append('mode', importMode)
      formData.append('type', restoreType)

      const response = await fetch('/api/backup/import', {
        method: 'POST',
        body: formData,
      })

      const result = await response.json()

      if (!response.ok) {
        setImportResult({
          success: false,
          error: result.error || 'Import failed',
        })
      } else {
        setImportResult(result)
        if (result.success) {
          setSelectedFile(null)
          if (fileInputRef.current) {
            fileInputRef.current.value = ''
          }
        }
      }
    } catch (error) {
      setImportResult({
        success: false,
        error: error instanceof Error ? error.message : 'Import failed',
      })
    } finally {
      setIsImporting(false)
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
            Download a backup of your database and/or uploaded files. The backup is saved as a ZIP file with a JSON manifest.
          </p>

          {/* Backup Type Selection */}
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
              What to Include
            </label>
            <div style={{ display: 'flex', gap: '1rem', flexWrap: 'wrap' }}>
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
                  name="backupType"
                  value="both"
                  checked={backupType === 'both'}
                  onChange={() => setBackupType('both')}
                  style={{ accentColor: 'var(--accent)' }}
                />
                <span style={{ fontSize: '0.875rem', color: 'var(--fg-default)' }}>
                  Database & Files
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
                  name="backupType"
                  value="database"
                  checked={backupType === 'database'}
                  onChange={() => setBackupType('database')}
                  style={{ accentColor: 'var(--accent)' }}
                />
                <span style={{ fontSize: '0.875rem', color: 'var(--fg-default)' }}>
                  Database Only
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
                  name="backupType"
                  value="files"
                  checked={backupType === 'files'}
                  onChange={() => setBackupType('files')}
                  style={{ accentColor: 'var(--accent)' }}
                />
                <span style={{ fontSize: '0.875rem', color: 'var(--fg-default)' }}>
                  Files Only
                </span>
              </label>
            </div>
          </div>

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

            {exportResult && !isExporting && (
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

          {/* Export Progress Bar */}
          {exportProgress && (
            <div style={{ marginTop: '1rem' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '0.5rem' }}>
                <span style={{ fontSize: '0.8125rem', color: 'var(--fg-muted)' }}>
                  {exportProgress.stage}
                </span>
                <span style={{ fontSize: '0.8125rem', color: 'var(--fg-muted)' }}>
                  {exportProgress.percent}%
                </span>
              </div>
              <div
                style={{
                  height: '6px',
                  background: 'var(--bg-subtle)',
                  borderRadius: '3px',
                  overflow: 'hidden',
                }}
              >
                <div
                  style={{
                    height: '100%',
                    width: `${exportProgress.percent}%`,
                    background: exportProgress.percent === 100 ? 'var(--status-success)' : 'var(--accent)',
                    borderRadius: '3px',
                    transition: 'width 0.3s ease, background 0.3s ease',
                  }}
                />
              </div>
            </div>
          )}
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

          {/* What to Restore Selection */}
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
              What to Restore
            </label>
            <div style={{ display: 'flex', gap: '1rem', flexWrap: 'wrap' }}>
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
                  name="restoreType"
                  value="both"
                  checked={restoreType === 'both'}
                  onChange={() => setRestoreType('both')}
                  style={{ accentColor: 'var(--accent)' }}
                />
                <span style={{ fontSize: '0.875rem', color: 'var(--fg-default)' }}>
                  Database & Files
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
                  name="restoreType"
                  value="database"
                  checked={restoreType === 'database'}
                  onChange={() => setRestoreType('database')}
                  style={{ accentColor: 'var(--accent)' }}
                />
                <span style={{ fontSize: '0.875rem', color: 'var(--fg-default)' }}>
                  Database Only
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
                  name="restoreType"
                  value="files"
                  checked={restoreType === 'files'}
                  onChange={() => setRestoreType('files')}
                  style={{ accentColor: 'var(--accent)' }}
                />
                <span style={{ fontSize: '0.875rem', color: 'var(--fg-default)' }}>
                  Files Only
                </span>
              </label>
            </div>
          </div>

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
                  onChange={() => { setImportMode('merge'); setShowConfirmReplace(false) }}
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
          {importMode === 'replace' && !showConfirmReplace && (
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

          {/* Replace Confirmation */}
          {showConfirmReplace && (
            <div
              style={{
                display: 'flex',
                alignItems: 'flex-start',
                gap: '0.75rem',
                padding: '1rem',
                background: 'rgba(239, 68, 68, 0.08)',
                border: '0.5px solid rgba(239, 68, 68, 0.25)',
                borderRadius: '6px',
                marginBottom: '1rem',
              }}
            >
              <AlertCircle className="w-4 h-4" style={{ color: 'var(--status-error)', flexShrink: 0, marginTop: '2px' }} />
              <div>
                <p style={{ fontSize: '0.875rem', fontWeight: 600, color: 'var(--status-error)', margin: '0 0 0.25rem 0' }}>
                  This will delete all existing data
                </p>
                <p style={{ fontSize: '0.8125rem', color: 'var(--fg-muted)', margin: '0 0 0.75rem 0' }}>
                  All current articles, authors, and files will be permanently removed before importing.
                </p>
                <div style={{ display: 'flex', gap: '0.5rem' }}>
                  <button
                    onClick={() => setShowConfirmReplace(false)}
                    className="btn btn-secondary"
                    style={{ fontSize: '0.8125rem' }}
                  >
                    Cancel
                  </button>
                  <button
                    onClick={handleBackupImport}
                    disabled={isImporting}
                    style={{
                      padding: '0.375rem 0.75rem',
                      fontSize: '0.8125rem',
                      fontWeight: 500,
                      borderRadius: '6px',
                      border: 'none',
                      background: 'var(--status-error)',
                      color: 'white',
                      cursor: isImporting ? 'not-allowed' : 'pointer',
                      opacity: isImporting ? 0.6 : 1,
                    }}
                  >
                    {isImporting ? 'Importing...' : 'Yes, Replace All'}
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* File Selection & Import */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '1rem', flexWrap: 'wrap' }}>
            <input
              type="file"
              ref={fileInputRef}
              accept=".zip"
              onChange={handleFileSelect}
              style={{ display: 'none' }}
            />
            <button
              onClick={() => fileInputRef.current?.click()}
              className="btn btn-secondary"
              style={{ gap: '0.5rem' }}
            >
              <Upload className="w-4 h-4" />
              Choose Backup File
            </button>

            {selectedFile && (
              <>
                <span style={{ fontSize: '0.8125rem', color: 'var(--fg-muted)' }}>
                  {selectedFile.name} ({(selectedFile.size / 1024 / 1024).toFixed(2)} MB)
                </span>
                {!showConfirmReplace && (
                  <button
                    onClick={handleBackupImport}
                    disabled={isImporting}
                    className="btn btn-primary"
                    style={{ gap: '0.5rem' }}
                  >
                    {isImporting ? (
                      <>
                        <LoadingSpinner size="sm" />
                        Importing...
                      </>
                    ) : (
                      <>
                        <Upload className="w-4 h-4" />
                        Import Backup
                      </>
                    )}
                  </button>
                )}
              </>
            )}
          </div>

          {/* Import Result */}
          {importResult && (
            <div
              style={{
                marginTop: '1rem',
                padding: '1rem',
                borderRadius: '6px',
                background: importResult.success ? 'rgba(34, 197, 94, 0.08)' : 'rgba(239, 68, 68, 0.08)',
                border: `0.5px solid ${importResult.success ? 'rgba(34, 197, 94, 0.25)' : 'rgba(239, 68, 68, 0.25)'}`,
              }}
            >
              <div style={{ display: 'flex', alignItems: 'flex-start', gap: '0.75rem' }}>
                {importResult.success ? (
                  <CheckCircle className="w-4 h-4" style={{ color: 'var(--status-success)', flexShrink: 0, marginTop: '2px' }} />
                ) : (
                  <AlertCircle className="w-4 h-4" style={{ color: 'var(--status-error)', flexShrink: 0, marginTop: '2px' }} />
                )}
                <div style={{ flex: 1 }}>
                  <p
                    style={{
                      fontSize: '0.875rem',
                      fontWeight: 600,
                      color: importResult.success ? 'var(--status-success)' : 'var(--status-error)',
                      margin: '0 0 0.25rem 0',
                    }}
                  >
                    {importResult.success ? 'Import Successful' : 'Import Failed'}
                  </p>
                  {importResult.error && (
                    <p style={{ fontSize: '0.8125rem', color: 'var(--fg-muted)', margin: '0 0 0.5rem 0' }}>
                      {importResult.error}
                    </p>
                  )}
                  {importResult.stats && (
                    <div style={{ fontSize: '0.8125rem', color: 'var(--fg-muted)', lineHeight: 1.6 }}>
                      <p style={{ margin: 0 }}>Authors: {importResult.stats.authors.imported} imported, {importResult.stats.authors.skipped} skipped</p>
                      <p style={{ margin: 0 }}>Volumes: {importResult.stats.volumes.imported} imported, {importResult.stats.volumes.skipped} skipped</p>
                      <p style={{ margin: 0 }}>Issues: {importResult.stats.issues.imported} imported, {importResult.stats.issues.skipped} skipped</p>
                      <p style={{ margin: 0 }}>Articles: {importResult.stats.articles.imported} imported, {importResult.stats.articles.skipped} skipped</p>
                      <p style={{ margin: 0 }}>Attachments: {importResult.stats.attachments.imported} imported, {importResult.stats.attachments.filesRestored} files restored</p>
                    </div>
                  )}
                  {importResult.backupInfo && (
                    <p style={{ fontSize: '0.75rem', color: 'var(--fg-faint)', margin: '0.5rem 0 0 0' }}>
                      Backup from: {new Date(importResult.backupInfo.exportedAt).toLocaleString()}
                    </p>
                  )}
                </div>
              </div>
            </div>
          )}
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
