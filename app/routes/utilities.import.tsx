import { createFileRoute, Link } from '@tanstack/react-router'
import { useState } from 'react'
import {
  Upload,
  ChevronLeft,
  CheckCircle,
  AlertCircle,
  FileJson,
  FolderOpen,
  FileArchive,
  Info,
} from 'lucide-react'
import { createServerFn } from '@tanstack/start'
import { LoadingSpinner } from '~/components/Layout'

// Server function to import data (legacy JSON-only import)
const importSharePointData = createServerFn({ method: 'POST' })
  .validator((data: { articles: any[] }) => data)
  .handler(async ({ data }) => {
    const { db, authors, articles, articleMultimediaTypes } = await import('@db/index')
    const { eq } = await import('drizzle-orm')

    const results = {
      success: 0,
      failed: 0,
      skipped: 0,
      errors: [] as string[],
    }

    for (const item of data.articles) {
      try {
        // Support both old format (ContactEmail) and new format (Contact_x0020_Email)
        const email = item.ContactEmail || item.Contact_x0020_Email
        const givenName = item.GivenName || item.Given_x0020_Name || 'Unknown'
        const surname = item.Surname || 'Unknown'
        const etransferEmail = item.EtransferEmail || item['e_x002d_Transfer_x0020_Email']
        const autoDeposit = item.Auto_x002d_depositAvailability || item.Autodeposit || false

        // Handle role - could be an object with Value or a direct string
        const roleValue = typeof item.role === 'object' ? item.role?.Value : item.role
        const studentType = mapRoleToStudentType(roleValue)

        // Check for existing article by SharePoint ID
        const sharePointId = item.Id ? `sp-${item.Id}` : null
        if (sharePointId) {
          const existingArticle = await db.query.articles.findFirst({
            where: eq(articles.formResponseId, sharePointId),
          })
          if (existingArticle) {
            results.skipped++
            continue
          }
        }

        // Find or create author
        let author = await db.query.authors.findFirst({
          where: eq(authors.email, email),
        })

        if (!author) {
          const [newAuthor] = await db
            .insert(authors)
            .values({
              givenName,
              surname,
              email,
              role: 'Guest Contributor',
              authorType: 'Student',
              studentType: studentType as any,
              autoDepositAvailable: autoDeposit,
              etransferEmail,
            })
            .returning()
          author = newAuthor
        } else if (studentType && !author.studentType) {
          // Update existing author's studentType if not already set
          await db
            .update(authors)
            .set({ studentType: studentType as any, updatedAt: new Date() })
            .where(eq(authors.id, author.id))
        }

        // Create article
        const [article] = await db
          .insert(articles)
          .values({
            title: item.Title,
            authorId: author.id,
            articleTier: item.ArticleTier?.Value || item.Article_x0020_Tier || 'Tier 1 (Basic)',
            internalStatus: mapStatus(item.InternalStaus?.Value || item.Internal_x0020_Status),
            automationStatus: item.AutomationStatus?.Value || 'Completed',
            prefersAnonymity: item.PrefersAnonymity || item.Prefers_x0020_Anonymity || false,
            paymentStatus: item.PaymentStatus || item.Payment_x0020_Status || false,
            articleFilePath: item.ArticleFileName,
            submittedAt: item.Created ? new Date(item.Created) : new Date(),
            formResponseId: sharePointId,
          })
          .returning()

        // Add multimedia types if present
        if (item.MultimediaType_x0028_s_x0029_?.results) {
          for (const type of item.MultimediaType_x0028_s_x0029_.results) {
            await db.insert(articleMultimediaTypes).values({
              articleId: article.id,
              multimediaType: type.Value,
            })
          }
        }

        results.success++
      } catch (error) {
        results.failed++
        results.errors.push(
          `Failed to import "${item.Title}": ${error instanceof Error ? error.message : 'Unknown error'}`
        )
      }
    }

    return results
  })

function mapStatus(status: string | undefined): any {
  const statusMap: Record<string, string> = {
    Draft: 'Draft',
    'Not Started': 'Pending Review',
    'Pending Review': 'Pending Review',
    'In Progress': 'In Review',
    'In Review': 'In Review',
    'Needs Revision': 'Needs Revision',
    Approved: 'Approved',
    'In Editing': 'In Editing',
    'Ready for Publication': 'Ready for Publication',
    Published: 'Published',
    Archived: 'Archived',
  }
  return statusMap[status || ''] || 'Pending Review'
}

// Map role values to studentType (for Student authors)
function mapRoleToStudentType(role: string | undefined): string | null {
  if (!role) return null

  const roleMap: Record<string, string> = {
    Undergrad: 'Undergrad',
    Grad: 'Grad',
    Graduate: 'Grad',
    Alumni: 'Alumni',
    Other: 'Other',
  }

  return roleMap[role] || null
}

export const Route = createFileRoute('/utilities/import')({
  component: ImportPage,
})

type ImportStats = {
  authors: { imported: number; skipped: number }
  articles: { imported: number; skipped: number; updated: number }
  attachments: { imported: number; skipped: number }
  errors: string[]
}

function ImportPage() {
  const [importMethod, setImportMethod] = useState<'json' | 'zip' | 'folder'>('zip')
  const [jsonData, setJsonData] = useState('')
  const [folderPath, setFolderPath] = useState('')
  const [importMode, setImportMode] = useState<'merge' | 'replace'>('merge')
  const [isImporting, setIsImporting] = useState(false)
  const [results, setResults] = useState<{
    success: number
    failed: number
    skipped?: number
    errors: string[]
    stats?: ImportStats
  } | null>(null)

  // Legacy JSON import
  const handleJsonImport = async () => {
    if (!jsonData.trim()) return

    try {
      const parsed = JSON.parse(jsonData)
      const articles = Array.isArray(parsed) ? parsed : parsed.value || [parsed]

      setIsImporting(true)
      setResults(null)

      const result = await importSharePointData({ data: { articles } })
      setResults(result)
    } catch (error) {
      setResults({
        success: 0,
        failed: 1,
        errors: [`JSON parse error: ${error instanceof Error ? error.message : 'Invalid JSON'}`],
      })
    } finally {
      setIsImporting(false)
    }
  }

  // ZIP file import with files
  const handleZipImport = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return

    setIsImporting(true)
    setResults(null)

    try {
      const formData = new FormData()
      formData.append('file', file)
      formData.append('mode', importMode)

      const response = await fetch('/api/sharepoint/import', {
        method: 'POST',
        body: formData,
      })

      const result = await response.json()

      if (!response.ok) {
        throw new Error(result.error || 'Import failed')
      }

      setResults({
        success: result.stats.articles.imported + result.stats.articles.updated,
        failed: result.stats.errors?.length || 0,
        skipped: result.stats.articles.skipped,
        errors: result.stats.errors || [],
        stats: result.stats,
      })
    } catch (error) {
      setResults({
        success: 0,
        failed: 1,
        errors: [error instanceof Error ? error.message : 'Import failed'],
      })
    } finally {
      setIsImporting(false)
      e.target.value = ''
    }
  }

  // Folder path import
  const handleFolderImport = async () => {
    if (!folderPath.trim()) return

    setIsImporting(true)
    setResults(null)

    try {
      const formData = new FormData()
      formData.append('folderPath', folderPath)
      formData.append('mode', importMode)

      const response = await fetch('/api/sharepoint/import', {
        method: 'POST',
        body: formData,
      })

      const result = await response.json()

      if (!response.ok) {
        throw new Error(result.error || 'Import failed')
      }

      setResults({
        success: result.stats.articles.imported + result.stats.articles.updated,
        failed: result.stats.errors?.length || 0,
        skipped: result.stats.articles.skipped,
        errors: result.stats.errors || [],
        stats: result.stats,
      })
    } catch (error) {
      setResults({
        success: 0,
        failed: 1,
        errors: [error instanceof Error ? error.message : 'Import failed'],
      })
    } finally {
      setIsImporting(false)
    }
  }

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return

    const reader = new FileReader()
    reader.onload = (event) => {
      setJsonData(event.target?.result as string)
    }
    reader.readAsText(file)
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
            <Upload className="w-5 h-5" style={{ color: 'var(--fg-muted)' }} />
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
              Import from SharePoint
            </h1>
            <p
              style={{ fontSize: '0.875rem', color: 'var(--fg-muted)', margin: '0.25rem 0 0 0' }}
            >
              Migrate existing article data from SharePoint export
            </p>
          </div>
        </div>
      </div>

      {/* Duplicate Detection Info */}
      <div
        style={{
          padding: '1rem 1.25rem',
          background: 'rgba(37, 99, 235, 0.05)',
          border: '0.5px solid rgba(37, 99, 235, 0.15)',
          borderRadius: '8px',
          marginBottom: '1.5rem',
          display: 'flex',
          gap: '0.75rem',
        }}
      >
        <Info className="w-4 h-4" style={{ color: 'rgb(37, 99, 235)', flexShrink: 0, marginTop: '2px' }} />
        <div>
          <div
            style={{
              fontSize: '0.875rem',
              fontWeight: 500,
              color: 'var(--fg-default)',
              marginBottom: '0.25rem',
            }}
          >
            Duplicate Detection
          </div>
          <p style={{ fontSize: '0.8125rem', color: 'var(--fg-muted)', margin: 0 }}>
            Articles are identified by their SharePoint ID. Existing articles will be <strong>skipped</strong> in
            merge mode or <strong>updated</strong> in replace mode. Authors are matched by email address.
          </p>
        </div>
      </div>

      {/* Import Method Selection */}
      <div
        style={{
          background: 'var(--bg-surface)',
          border: '0.5px solid var(--border-default)',
          borderRadius: '8px',
          padding: '1.5rem',
          marginBottom: '1.5rem',
        }}
      >
        <label
          style={{
            display: 'block',
            fontSize: '0.8125rem',
            fontWeight: 500,
            color: 'var(--fg-default)',
            marginBottom: '0.75rem',
          }}
        >
          Import Method
        </label>
        <div style={{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap' }}>
          <button
            onClick={() => setImportMethod('zip')}
            className={`btn ${importMethod === 'zip' ? 'btn-primary' : 'btn-secondary'}`}
            style={{ gap: '0.5rem' }}
          >
            <FileArchive className="w-4 h-4" />
            ZIP File
          </button>
          <button
            onClick={() => setImportMethod('folder')}
            className={`btn ${importMethod === 'folder' ? 'btn-primary' : 'btn-secondary'}`}
            style={{ gap: '0.5rem' }}
          >
            <FolderOpen className="w-4 h-4" />
            Folder Path
          </button>
          <button
            onClick={() => setImportMethod('json')}
            className={`btn ${importMethod === 'json' ? 'btn-primary' : 'btn-secondary'}`}
            style={{ gap: '0.5rem' }}
          >
            <FileJson className="w-4 h-4" />
            JSON Only
          </button>
        </div>
        <p style={{ fontSize: '0.75rem', color: 'var(--fg-muted)', marginTop: '0.5rem', marginBottom: 0 }}>
          {importMethod === 'zip' && 'Upload a ZIP containing JSON + documents/ and photos/ folders'}
          {importMethod === 'folder' && 'Enter the path to an unzipped SharePoint export folder'}
          {importMethod === 'json' && 'Paste or upload JSON data only (no file attachments)'}
        </p>
      </div>

      {/* Import Mode (for ZIP and Folder) */}
      {importMethod !== 'json' && (
        <div
          style={{
            background: 'var(--bg-surface)',
            border: '0.5px solid var(--border-default)',
            borderRadius: '8px',
            padding: '1.5rem',
            marginBottom: '1.5rem',
          }}
        >
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
                Merge (skip existing)
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
                Replace (update existing)
              </span>
            </label>
          </div>
        </div>
      )}

      {/* Main Content */}
      <div
        style={{
          background: 'var(--bg-surface)',
          border: '0.5px solid var(--border-default)',
          borderRadius: '8px',
          padding: '1.5rem',
        }}
      >
        {/* ZIP Upload */}
        {importMethod === 'zip' && (
          <>
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
                Upload ZIP File
              </label>
              <p style={{ fontSize: '0.8125rem', color: 'var(--fg-muted)', marginBottom: '0.75rem' }}>
                ZIP should contain: <code style={{ background: 'var(--bg-subtle)', padding: '0.125rem 0.375rem', borderRadius: '3px' }}>*.json</code>,
                <code style={{ background: 'var(--bg-subtle)', padding: '0.125rem 0.375rem', borderRadius: '3px', marginLeft: '0.25rem' }}>documents/</code>, and
                <code style={{ background: 'var(--bg-subtle)', padding: '0.125rem 0.375rem', borderRadius: '3px', marginLeft: '0.25rem' }}>photos/</code>
              </p>
              <label className="btn btn-secondary" style={{ gap: '0.5rem', cursor: 'pointer' }}>
                {isImporting ? (
                  <>
                    <LoadingSpinner size="sm" />
                    Importing...
                  </>
                ) : (
                  <>
                    <FileArchive className="w-4 h-4" />
                    Choose ZIP File
                  </>
                )}
                <input
                  type="file"
                  accept=".zip"
                  onChange={handleZipImport}
                  disabled={isImporting}
                  style={{ display: 'none' }}
                />
              </label>
            </div>
          </>
        )}

        {/* Folder Path */}
        {importMethod === 'folder' && (
          <>
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
                Folder Path
              </label>
              <p style={{ fontSize: '0.8125rem', color: 'var(--fg-muted)', marginBottom: '0.75rem' }}>
                Enter the full path to the unzipped SharePoint export folder
              </p>
              <input
                type="text"
                value={folderPath}
                onChange={(e) => setFolderPath(e.target.value)}
                placeholder="/Users/you/Downloads/ote-export-2026-01-29"
                className="input"
                style={{
                  width: '100%',
                  fontFamily: 'var(--font-mono)',
                  fontSize: '0.8125rem',
                }}
              />
            </div>
            <button
              onClick={handleFolderImport}
              disabled={isImporting || !folderPath.trim()}
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
                  Import from Folder
                </>
              )}
            </button>
          </>
        )}

        {/* JSON Input */}
        {importMethod === 'json' && (
          <>
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
                Upload JSON file
              </label>
              <input
                type="file"
                accept=".json"
                onChange={handleFileUpload}
                style={{
                  fontSize: '0.875rem',
                  color: 'var(--fg-muted)',
                }}
              />
            </div>

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
                Or paste JSON data
              </label>
              <textarea
                value={jsonData}
                onChange={(e) => setJsonData(e.target.value)}
                placeholder="Paste your SharePoint JSON export here..."
                rows={10}
                className="input"
                style={{
                  width: '100%',
                  fontFamily: 'var(--font-mono)',
                  fontSize: '0.8125rem',
                  resize: 'vertical',
                }}
              />
            </div>

            <div
              style={{
                paddingTop: '0.5rem',
                borderTop: '0.5px solid var(--border-subtle)',
              }}
            >
              <button
                onClick={handleJsonImport}
                disabled={isImporting || !jsonData.trim()}
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
                    Import Data
                  </>
                )}
              </button>
            </div>
          </>
        )}

        {/* Results */}
        {results && (
          <div
            style={{
              marginTop: '1.5rem',
              padding: '1rem',
              borderRadius: '6px',
              background:
                results.failed > 0 ? 'rgba(239, 68, 68, 0.05)' : 'rgba(34, 197, 94, 0.05)',
              border: `0.5px solid ${results.failed > 0 ? 'rgba(239, 68, 68, 0.2)' : 'rgba(34, 197, 94, 0.2)'}`,
            }}
          >
            {/* Summary Stats */}
            {results.stats && (
              <div style={{ marginBottom: '1rem' }}>
                <div style={{ fontSize: '0.875rem', fontWeight: 500, color: 'var(--fg-default)', marginBottom: '0.5rem' }}>
                  Import Summary
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: '0.5rem' }}>
                  <div style={{ fontSize: '0.8125rem', color: 'var(--fg-muted)' }}>
                    <strong>Articles:</strong> {results.stats.articles.imported} new, {results.stats.articles.updated} updated, {results.stats.articles.skipped} skipped
                  </div>
                  <div style={{ fontSize: '0.8125rem', color: 'var(--fg-muted)' }}>
                    <strong>Authors:</strong> {results.stats.authors.imported} new, {results.stats.authors.skipped} existing
                  </div>
                  <div style={{ fontSize: '0.8125rem', color: 'var(--fg-muted)' }}>
                    <strong>Files:</strong> {results.stats.attachments.imported} imported
                  </div>
                </div>
              </div>
            )}

            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '1rem',
                marginBottom: results.errors.length > 0 ? '1rem' : 0,
              }}
            >
              {results.success > 0 && (
                <div
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: '0.5rem',
                    fontSize: '0.875rem',
                    color: 'var(--status-success)',
                  }}
                >
                  <CheckCircle className="w-4 h-4" />
                  {results.success} imported successfully
                </div>
              )}
              {(results.skipped ?? 0) > 0 && (
                <div
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: '0.5rem',
                    fontSize: '0.875rem',
                    color: 'var(--fg-muted)',
                  }}
                >
                  {results.skipped} skipped (already exist)
                </div>
              )}
              {results.failed > 0 && (
                <div
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: '0.5rem',
                    fontSize: '0.875rem',
                    color: 'var(--status-error)',
                  }}
                >
                  <AlertCircle className="w-4 h-4" />
                  {results.failed} failed
                </div>
              )}
            </div>

            {results.errors.length > 0 && (
              <div style={{ fontSize: '0.8125rem', color: 'var(--status-error)' }}>
                {results.errors.slice(0, 10).map((error, i) => (
                  <div key={i} style={{ marginTop: i > 0 ? '0.25rem' : 0 }}>
                    {error}
                  </div>
                ))}
                {results.errors.length > 10 && (
                  <div style={{ marginTop: '0.5rem', color: 'var(--fg-muted)' }}>
                    ... and {results.errors.length - 10} more errors
                  </div>
                )}
              </div>
            )}
          </div>
        )}
      </div>

      {/* Expected Format (for JSON import) */}
      {importMethod === 'json' && (
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
              Expected JSON Format
            </span>
          </div>
          <p style={{ fontSize: '0.8125rem', color: 'var(--fg-muted)', margin: '0 0 0.75rem 0' }}>
            Based on your SharePoint list structure, the import expects these fields:
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
            {`{
  "Id": 1234,
  "Title": "Article Title",
  "Given_x0020_Name": "First Name",
  "Surname": "Last Name",
  "Contact_x0020_Email": "email@example.com",
  "role": "Undergrad",
  "Article_x0020_Tier": "Tier 2 (Standard)",
  "Internal_x0020_Status": "Pending Review",
  "Prefers_x0020_Anonymity": false,
  "Payment_x0020_Status": false,
  "Created": "2024-01-15T12:00:00Z"
}`}
          </pre>
        </div>
      )}

      {/* Folder Structure (for ZIP/Folder import) */}
      {importMethod !== 'json' && (
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
            <FolderOpen className="w-4 h-4" style={{ color: 'var(--fg-muted)' }} />
            <span
              style={{
                fontSize: '0.875rem',
                fontWeight: 500,
                color: 'var(--fg-default)',
              }}
            >
              Expected Folder Structure
            </span>
          </div>
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
            {`ote-export-2026-01-29/
├── ote-articles.json        # Required: Article data
├── documents/               # Optional: Word documents
│   ├── Article Title 1/
│   │   └── article.docx
│   └── Article Title 2/
│       └── article.docx
└── photos/                  # Optional: Photo attachments
    ├── Article Title 1/
    │   ├── photo1.jpg
    │   └── photo2.png
    └── Article Title 2/
        └── cover.jpg`}
          </pre>
        </div>
      )}
    </div>
  )
}
