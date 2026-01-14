import { createFileRoute, Link } from '@tanstack/react-router'
import { useState } from 'react'
import {
  Upload,
  ChevronLeft,
  CheckCircle,
  AlertCircle,
  FileJson,
} from 'lucide-react'
import { createServerFn } from '@tanstack/start'
import { LoadingSpinner } from '~/components/Layout'

// Server function to import data
const importSharePointData = createServerFn({ method: 'POST' })
  .validator((data: { articles: any[] }) => data)
  .handler(async ({ data }) => {
    const { db, authors, articles, articleMultimediaTypes } = await import('@db/index')
    const { eq } = await import('drizzle-orm')

    const results = {
      success: 0,
      failed: 0,
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
            articleTier: item.ArticleTier?.Value || 'Tier 1 (Basic)',
            internalStatus: mapStatus(item.InternalStaus?.Value),
            automationStatus: item.AutomationStatus?.Value || 'Completed',
            prefersAnonymity: item.PrefersAnonymity || false,
            paymentStatus: item.PaymentStatus || false,
            articleFilePath: item.ArticleFileName,
            submittedAt: item.Created ? new Date(item.Created) : new Date(),
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
    'Undergrad': 'Undergrad',
    'Grad': 'Grad',
    'Graduate': 'Grad',
    'Alumni': 'Alumni',
    'Other': 'Other',
  }

  return roleMap[role] || null
}

export const Route = createFileRoute('/utilities/import')({
  component: ImportPage,
})

function ImportPage() {
  const [jsonData, setJsonData] = useState('')
  const [isImporting, setIsImporting] = useState(false)
  const [results, setResults] = useState<{
    success: number
    failed: number
    errors: string[]
  } | null>(null)

  const handleImport = async () => {
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
              Migrate existing article data from SharePoint JSON export
            </p>
          </div>
        </div>
      </div>

      {/* Instructions */}
      <div
        style={{
          padding: '1rem 1.25rem',
          background: 'rgba(37, 99, 235, 0.05)',
          border: '0.5px solid rgba(37, 99, 235, 0.15)',
          borderRadius: '8px',
          marginBottom: '1.5rem',
        }}
      >
        <div
          style={{
            fontSize: '0.875rem',
            fontWeight: 500,
            color: 'var(--fg-default)',
            marginBottom: '0.5rem',
          }}
        >
          How to export from SharePoint
        </div>
        <ol
          style={{
            fontSize: '0.8125rem',
            color: 'var(--fg-muted)',
            margin: 0,
            paddingLeft: '1.25rem',
            listStyleType: 'decimal',
            lineHeight: 1.6,
          }}
        >
          <li>Go to your SharePoint list containing articles</li>
          <li>Use Power Automate or the SharePoint REST API to export as JSON</li>
          <li>Paste the JSON data below or upload a JSON file</li>
        </ol>
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
        {/* File Upload */}
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

        {/* JSON Input */}
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

        {/* Import Button */}
        <div
          style={{
            paddingTop: '0.5rem',
            borderTop: '0.5px solid var(--border-subtle)',
          }}
        >
          <button
            onClick={handleImport}
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
                {results.errors.map((error, i) => (
                  <div key={i} style={{ marginTop: i > 0 ? '0.25rem' : 0 }}>
                    {error}
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>

      {/* Expected Format */}
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
  "Title": "Article Title",
  "GivenName": "First Name",
  "Surname": "Last Name",
  "ContactEmail": "email@example.com",
  "role": { "Value": "Staff Writer" },
  "ArticleTier": { "Value": "Tier 2 (Standard)" },
  "InternalStaus": { "Value": "Pending Review" },
  "AutomationStatus": { "Value": "Completed" },
  "PrefersAnonymity": false,
  "PaymentStatus": false,
  "Created": "2024-01-15T12:00:00Z"
}`}
        </pre>
      </div>
    </div>
  )
}
