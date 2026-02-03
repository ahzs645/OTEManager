import { createFileRoute, Link } from '@tanstack/react-router'
import { useState, useEffect } from 'react'
import {
  ChevronLeft,
  Files,
  Trash2,
  AlertTriangle,
  CheckCircle,
  Info,
  Search,
  Image,
  FileText,
  ExternalLink,
} from 'lucide-react'
import { createServerFn } from '@tanstack/start'
import { LoadingSpinner } from '~/components/Layout'

type DuplicateFile = {
  id: string
  articleId: string
  articleTitle: string
  attachmentType: string
  fileName: string
  originalFileName: string
  filePath: string
  fileSize: number | null
  caption: string | null
  createdAt: string
}

type DuplicateGroup = {
  key: string
  matchType: 'exact' | 'similar' | 'size'
  files: DuplicateFile[]
}

// Normalize filename for comparison - removes extension and converts to lowercase
function normalizeFileName(fileName: string): string {
  // Remove extension and normalize
  const lastDot = fileName.lastIndexOf('.')
  const baseName = lastDot > 0 ? fileName.slice(0, lastDot) : fileName
  return baseName.toLowerCase().replace(/[_\-\s]+/g, '_').trim()
}

// Server function to find duplicate files
const findDuplicateFiles = createServerFn({ method: 'GET' }).handler(async () => {
  const { db } = await import('@db/index')
  const { attachments, articles } = await import('@db/schema')
  const { eq } = await import('drizzle-orm')

  // Get all attachments with article info
  const allAttachments = await db
    .select({
      id: attachments.id,
      articleId: attachments.articleId,
      attachmentType: attachments.attachmentType,
      fileName: attachments.fileName,
      originalFileName: attachments.originalFileName,
      filePath: attachments.filePath,
      fileSize: attachments.fileSize,
      caption: attachments.caption,
      createdAt: attachments.createdAt,
      articleTitle: articles.title,
    })
    .from(attachments)
    .leftJoin(articles, eq(attachments.articleId, articles.id))
    .orderBy(attachments.originalFileName)

  // Group by normalized original filename (same name, possibly different extension)
  const byNormalizedName = new Map<string, typeof allAttachments>()
  // Group by exact original filename
  const byExactName = new Map<string, typeof allAttachments>()
  // Group by file size (for potential identical files)
  const bySize = new Map<string, typeof allAttachments>()

  for (const attachment of allAttachments) {
    // Exact name match (including extension)
    const exactKey = attachment.originalFileName.toLowerCase()
    if (!byExactName.has(exactKey)) {
      byExactName.set(exactKey, [])
    }
    byExactName.get(exactKey)!.push(attachment)

    // Normalized name match (same base name, different extension)
    const normalizedKey = normalizeFileName(attachment.originalFileName)
    if (!byNormalizedName.has(normalizedKey)) {
      byNormalizedName.set(normalizedKey, [])
    }
    byNormalizedName.get(normalizedKey)!.push(attachment)

    // File size match (only for files > 1KB to avoid false positives on tiny files)
    if (attachment.fileSize && attachment.fileSize > 1024) {
      const sizeKey = `size_${attachment.fileSize}`
      if (!bySize.has(sizeKey)) {
        bySize.set(sizeKey, [])
      }
      bySize.get(sizeKey)!.push(attachment)
    }
  }

  // Build duplicate groups, prioritizing exact matches
  const duplicateGroups: DuplicateGroup[] = []
  const processedIds = new Set<string>()

  // First, add exact name duplicates
  for (const [key, files] of byExactName.entries()) {
    if (files.length > 1) {
      const unprocessed = files.filter((f) => !processedIds.has(f.id))
      if (unprocessed.length > 1) {
        duplicateGroups.push({
          key: `exact_${key}`,
          matchType: 'exact',
          files: unprocessed.map((f) => ({
            ...f,
            createdAt: f.createdAt.toISOString(),
            articleTitle: f.articleTitle || 'Unknown Article',
          })),
        })
        unprocessed.forEach((f) => processedIds.add(f.id))
      }
    }
  }

  // Then add similar name duplicates (same base name, different extension)
  for (const [key, files] of byNormalizedName.entries()) {
    const unprocessed = files.filter((f) => !processedIds.has(f.id))
    if (unprocessed.length > 1) {
      // Check if they have different extensions (not already caught by exact match)
      const extensions = new Set(
        unprocessed.map((f) => {
          const lastDot = f.originalFileName.lastIndexOf('.')
          return lastDot > 0 ? f.originalFileName.slice(lastDot).toLowerCase() : ''
        })
      )
      if (extensions.size > 1) {
        duplicateGroups.push({
          key: `similar_${key}`,
          matchType: 'similar',
          files: unprocessed.map((f) => ({
            ...f,
            createdAt: f.createdAt.toISOString(),
            articleTitle: f.articleTitle || 'Unknown Article',
          })),
        })
        unprocessed.forEach((f) => processedIds.add(f.id))
      }
    }
  }

  // Finally add same-size duplicates (potential identical files with different names)
  for (const [key, files] of bySize.entries()) {
    const unprocessed = files.filter((f) => !processedIds.has(f.id))
    if (unprocessed.length > 1) {
      // Only group if they're in the same article (likely accidental double upload)
      const byArticle = new Map<string, typeof unprocessed>()
      for (const f of unprocessed) {
        if (!byArticle.has(f.articleId)) {
          byArticle.set(f.articleId, [])
        }
        byArticle.get(f.articleId)!.push(f)
      }

      for (const [articleId, articleFiles] of byArticle.entries()) {
        if (articleFiles.length > 1) {
          duplicateGroups.push({
            key: `size_${key}_${articleId}`,
            matchType: 'size',
            files: articleFiles.map((f) => ({
              ...f,
              createdAt: f.createdAt.toISOString(),
              articleTitle: f.articleTitle || 'Unknown Article',
            })),
          })
          articleFiles.forEach((f) => processedIds.add(f.id))
        }
      }
    }
  }

  return {
    totalFiles: allAttachments.length,
    duplicateGroups,
    totalDuplicates: duplicateGroups.reduce((sum, g) => sum + g.files.length - 1, 0),
  }
})

// Server function to delete a file
const deleteFile = createServerFn({ method: 'POST' })
  .validator((data: { attachmentId: string }) => data)
  .handler(async ({ data }) => {
    const { db } = await import('@db/index')
    const { attachments } = await import('@db/schema')
    const { eq } = await import('drizzle-orm')
    const { getStorage } = await import('../../storage')

    // Get the attachment first
    const attachment = await db.query.attachments.findFirst({
      where: eq(attachments.id, data.attachmentId),
    })

    if (!attachment) {
      return { success: false, error: 'Attachment not found' }
    }

    // Delete file from storage
    const storage = getStorage()
    try {
      await storage.delete(attachment.filePath)
    } catch {
      // Ignore file deletion errors (file might already be gone)
    }

    // Delete from database
    await db.delete(attachments).where(eq(attachments.id, data.attachmentId))

    return { success: true }
  })

// Server function to delete multiple files at once
const deleteFiles = createServerFn({ method: 'POST' })
  .validator((data: { attachmentIds: string[] }) => data)
  .handler(async ({ data }) => {
    const { db } = await import('@db/index')
    const { attachments } = await import('@db/schema')
    const { eq, inArray } = await import('drizzle-orm')
    const { getStorage } = await import('../../storage')

    // Get all attachments
    const toDelete = await db.query.attachments.findMany({
      where: inArray(attachments.id, data.attachmentIds),
    })

    // Delete files from storage
    const storage = getStorage()
    for (const attachment of toDelete) {
      try {
        await storage.delete(attachment.filePath)
      } catch {
        // Ignore file deletion errors
      }
    }

    // Delete from database
    await db.delete(attachments).where(inArray(attachments.id, data.attachmentIds))

    return { success: true, deletedCount: toDelete.length }
  })

export const Route = createFileRoute('/utilities/deduplicate-files')({
  component: DeduplicateFilesPage,
})

function DeduplicateFilesPage() {
  const [isLoading, setIsLoading] = useState(true)
  const [duplicateGroups, setDuplicateGroups] = useState<DuplicateGroup[]>([])
  const [totalFiles, setTotalFiles] = useState(0)
  const [totalDuplicates, setTotalDuplicates] = useState(0)
  const [deletingId, setDeletingId] = useState<string | null>(null)
  const [deletingGroup, setDeletingGroup] = useState<string | null>(null)
  const [selectedToKeep, setSelectedToKeep] = useState<Record<string, string>>({})
  const [error, setError] = useState<string | null>(null)
  const [successMessage, setSuccessMessage] = useState<string | null>(null)
  const [filter, setFilter] = useState('')
  const [typeFilter, setTypeFilter] = useState<'all' | 'photo' | 'document'>('all')

  const loadDuplicates = async () => {
    setIsLoading(true)
    setError(null)
    try {
      const result = await findDuplicateFiles()
      setDuplicateGroups(result.duplicateGroups)
      setTotalFiles(result.totalFiles)
      setTotalDuplicates(result.totalDuplicates)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load duplicates')
    } finally {
      setIsLoading(false)
    }
  }

  useEffect(() => {
    loadDuplicates()
  }, [])

  const handleDeleteSingle = async (file: DuplicateFile) => {
    if (
      !confirm(
        `Delete "${file.originalFileName}" from "${file.articleTitle}"?\n\nThis action cannot be undone.`
      )
    ) {
      return
    }

    setDeletingId(file.id)
    setError(null)

    try {
      await deleteFile({ data: { attachmentId: file.id } })

      // Update local state
      setDuplicateGroups((groups) =>
        groups
          .map((g) => ({
            ...g,
            files: g.files.filter((f) => f.id !== file.id),
          }))
          .filter((g) => g.files.length > 1)
      )
      setTotalDuplicates((prev) => prev - 1)
      setSuccessMessage(`Deleted "${file.originalFileName}"`)
      setTimeout(() => setSuccessMessage(null), 3000)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to delete file')
    } finally {
      setDeletingId(null)
    }
  }

  const handleDeleteOthers = async (group: DuplicateGroup) => {
    const keepId = selectedToKeep[group.key]
    if (!keepId) {
      setError('Please select which file to keep')
      return
    }

    const keepFile = group.files.find((f) => f.id === keepId)
    const deleteIds = group.files.filter((f) => f.id !== keepId).map((f) => f.id)

    if (
      !confirm(
        `Keep "${keepFile?.originalFileName}" and delete ${deleteIds.length} other file(s)?\n\nThis action cannot be undone.`
      )
    ) {
      return
    }

    setDeletingGroup(group.key)
    setError(null)

    try {
      await deleteFiles({ data: { attachmentIds: deleteIds } })

      // Update local state - remove the group entirely
      setDuplicateGroups((groups) => groups.filter((g) => g.key !== group.key))
      setTotalDuplicates((prev) => prev - deleteIds.length)
      setSuccessMessage(`Deleted ${deleteIds.length} duplicate file(s)`)
      setTimeout(() => setSuccessMessage(null), 3000)

      // Clean up selection
      setSelectedToKeep((prev) => {
        const next = { ...prev }
        delete next[group.key]
        return next
      })
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to delete files')
    } finally {
      setDeletingGroup(null)
    }
  }

  const filteredGroups = duplicateGroups.filter((group) => {
    // Type filter
    if (typeFilter !== 'all') {
      const isPhoto = group.files[0]?.attachmentType === 'photo'
      if (typeFilter === 'photo' && !isPhoto) return false
      if (typeFilter === 'document' && isPhoto) return false
    }

    // Text filter
    if (!filter) return true
    const searchLower = filter.toLowerCase()
    return group.files.some(
      (f) =>
        f.originalFileName.toLowerCase().includes(searchLower) ||
        f.articleTitle.toLowerCase().includes(searchLower)
    )
  })

  const formatFileSize = (bytes: number | null) => {
    if (!bytes) return '—'
    if (bytes < 1024) return `${bytes} B`
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
  }

  const formatDate = (dateStr: string) => {
    return new Date(dateStr).toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
    })
  }

  const getMatchTypeLabel = (type: DuplicateGroup['matchType']) => {
    switch (type) {
      case 'exact':
        return 'Exact filename match'
      case 'similar':
        return 'Same name, different extension'
      case 'size':
        return 'Same file size (possibly identical)'
    }
  }

  const getMatchTypeColor = (type: DuplicateGroup['matchType']) => {
    switch (type) {
      case 'exact':
        return 'var(--status-error)'
      case 'similar':
        return 'var(--status-warning)'
      case 'size':
        return 'var(--fg-muted)'
    }
  }

  return (
    <div className="page-container">
      {/* Header */}
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
            <Files className="w-5 h-5" style={{ color: 'var(--fg-muted)' }} />
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
              Find Duplicate Files
            </h1>
            <p
              style={{
                fontSize: '0.875rem',
                color: 'var(--fg-muted)',
                margin: '0.25rem 0 0 0',
              }}
            >
              Find and remove duplicate photos and documents
            </p>
          </div>
        </div>
      </div>

      {/* Info Box */}
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
        <Info
          className="w-4 h-4"
          style={{
            color: 'rgb(37, 99, 235)',
            flexShrink: 0,
            marginTop: '2px',
          }}
        />
        <div>
          <div
            style={{
              fontSize: '0.875rem',
              fontWeight: 500,
              color: 'var(--fg-default)',
              marginBottom: '0.25rem',
            }}
          >
            How Duplicate Files Are Detected
          </div>
          <p style={{ fontSize: '0.8125rem', color: 'var(--fg-muted)', margin: 0 }}>
            Files are grouped by: <strong>exact filename match</strong> (highest confidence),{' '}
            <strong>same base name with different extension</strong> (e.g., photo.JPG vs photo.jpeg), or{' '}
            <strong>same file size within the same article</strong> (potential duplicates). Select
            which file to <strong>keep</strong>, then delete the others.
          </p>
        </div>
      </div>

      {/* Success/Error Messages */}
      {successMessage && (
        <div
          style={{
            padding: '0.75rem 1rem',
            background: 'rgba(34, 197, 94, 0.05)',
            border: '0.5px solid rgba(34, 197, 94, 0.2)',
            borderRadius: '6px',
            marginBottom: '1rem',
            display: 'flex',
            alignItems: 'center',
            gap: '0.5rem',
            fontSize: '0.875rem',
            color: 'var(--status-success)',
          }}
        >
          <CheckCircle className="w-4 h-4" />
          {successMessage}
        </div>
      )}

      {error && (
        <div
          style={{
            padding: '0.75rem 1rem',
            background: 'rgba(239, 68, 68, 0.05)',
            border: '0.5px solid rgba(239, 68, 68, 0.2)',
            borderRadius: '6px',
            marginBottom: '1rem',
            display: 'flex',
            alignItems: 'center',
            gap: '0.5rem',
            fontSize: '0.875rem',
            color: 'var(--status-error)',
          }}
        >
          <AlertTriangle className="w-4 h-4" />
          {error}
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
        {isLoading ? (
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              padding: '3rem',
              gap: '0.75rem',
              color: 'var(--fg-muted)',
            }}
          >
            <LoadingSpinner size="md" />
            <span>Scanning for duplicate files...</span>
          </div>
        ) : (
          <>
            {/* Stats */}
            <div
              style={{
                display: 'flex',
                gap: '1.5rem',
                marginBottom: '1.5rem',
                paddingBottom: '1rem',
                borderBottom: '0.5px solid var(--border-subtle)',
              }}
            >
              <div>
                <div
                  style={{
                    fontSize: '0.75rem',
                    color: 'var(--fg-muted)',
                    marginBottom: '0.25rem',
                  }}
                >
                  Total Files
                </div>
                <div
                  style={{
                    fontSize: '1.25rem',
                    fontWeight: 600,
                    color: 'var(--fg-default)',
                  }}
                >
                  {totalFiles}
                </div>
              </div>
              <div>
                <div
                  style={{
                    fontSize: '0.75rem',
                    color: 'var(--fg-muted)',
                    marginBottom: '0.25rem',
                  }}
                >
                  Duplicate Groups
                </div>
                <div
                  style={{
                    fontSize: '1.25rem',
                    fontWeight: 600,
                    color:
                      duplicateGroups.length > 0 ? 'var(--status-warning)' : 'var(--status-success)',
                  }}
                >
                  {duplicateGroups.length}
                </div>
              </div>
              <div>
                <div
                  style={{
                    fontSize: '0.75rem',
                    color: 'var(--fg-muted)',
                    marginBottom: '0.25rem',
                  }}
                >
                  Extra Copies
                </div>
                <div
                  style={{
                    fontSize: '1.25rem',
                    fontWeight: 600,
                    color: totalDuplicates > 0 ? 'var(--status-warning)' : 'var(--status-success)',
                  }}
                >
                  {totalDuplicates}
                </div>
              </div>
            </div>

            {duplicateGroups.length === 0 ? (
              <div
                style={{
                  textAlign: 'center',
                  padding: '2rem',
                  color: 'var(--fg-muted)',
                }}
              >
                <CheckCircle
                  className="w-12 h-12"
                  style={{ color: 'var(--status-success)', margin: '0 auto 1rem' }}
                />
                <div
                  style={{
                    fontSize: '1rem',
                    fontWeight: 500,
                    color: 'var(--fg-default)',
                    marginBottom: '0.25rem',
                  }}
                >
                  No duplicate files found
                </div>
                <div style={{ fontSize: '0.875rem' }}>All files appear to be unique.</div>
              </div>
            ) : (
              <>
                {/* Filters */}
                <div
                  style={{
                    marginBottom: '1rem',
                    display: 'flex',
                    gap: '0.75rem',
                    flexWrap: 'wrap',
                  }}
                >
                  <div style={{ position: 'relative', flex: '1', minWidth: '200px', maxWidth: '300px' }}>
                    <Search
                      className="w-4 h-4"
                      style={{
                        position: 'absolute',
                        left: '0.75rem',
                        top: '50%',
                        transform: 'translateY(-50%)',
                        color: 'var(--fg-muted)',
                      }}
                    />
                    <input
                      type="text"
                      placeholder="Filter by filename or article..."
                      value={filter}
                      onChange={(e) => setFilter(e.target.value)}
                      className="input"
                      style={{ width: '100%', paddingLeft: '2.25rem' }}
                    />
                  </div>
                  <div style={{ display: 'flex', gap: '0.25rem' }}>
                    <button
                      onClick={() => setTypeFilter('all')}
                      className={`btn ${typeFilter === 'all' ? 'btn-primary' : 'btn-secondary'}`}
                      style={{ padding: '0.5rem 0.75rem', fontSize: '0.8125rem' }}
                    >
                      All
                    </button>
                    <button
                      onClick={() => setTypeFilter('photo')}
                      className={`btn ${typeFilter === 'photo' ? 'btn-primary' : 'btn-secondary'}`}
                      style={{ padding: '0.5rem 0.75rem', fontSize: '0.8125rem', gap: '0.375rem' }}
                    >
                      <Image className="w-3.5 h-3.5" />
                      Photos
                    </button>
                    <button
                      onClick={() => setTypeFilter('document')}
                      className={`btn ${typeFilter === 'document' ? 'btn-primary' : 'btn-secondary'}`}
                      style={{ padding: '0.5rem 0.75rem', fontSize: '0.8125rem', gap: '0.375rem' }}
                    >
                      <FileText className="w-3.5 h-3.5" />
                      Documents
                    </button>
                  </div>
                </div>

                {/* Duplicate Groups */}
                <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
                  {filteredGroups.map((group) => (
                    <div
                      key={group.key}
                      style={{
                        border: '0.5px solid var(--border-default)',
                        borderRadius: '6px',
                        overflow: 'hidden',
                      }}
                    >
                      {/* Group Header */}
                      <div
                        style={{
                          padding: '0.75rem 1rem',
                          background: 'rgba(245, 158, 11, 0.05)',
                          borderBottom: '0.5px solid var(--border-subtle)',
                          display: 'flex',
                          alignItems: 'center',
                          gap: '0.5rem',
                          flexWrap: 'wrap',
                        }}
                      >
                        {group.files[0]?.attachmentType === 'photo' ? (
                          <Image className="w-4 h-4" style={{ color: 'var(--status-warning)' }} />
                        ) : (
                          <FileText className="w-4 h-4" style={{ color: 'var(--status-warning)' }} />
                        )}
                        <span
                          style={{
                            fontSize: '0.8125rem',
                            fontWeight: 500,
                            color: 'var(--fg-default)',
                          }}
                        >
                          {group.files.length} copies found
                        </span>
                        <span
                          style={{
                            fontSize: '0.75rem',
                            color: getMatchTypeColor(group.matchType),
                            padding: '0.125rem 0.5rem',
                            background: 'var(--bg-subtle)',
                            borderRadius: '4px',
                          }}
                        >
                          {getMatchTypeLabel(group.matchType)}
                        </span>
                        <button
                          onClick={() => handleDeleteOthers(group)}
                          disabled={!selectedToKeep[group.key] || deletingGroup === group.key}
                          className="btn btn-primary"
                          style={{
                            marginLeft: 'auto',
                            padding: '0.25rem 0.75rem',
                            fontSize: '0.75rem',
                            gap: '0.375rem',
                          }}
                        >
                          {deletingGroup === group.key ? (
                            <>
                              <LoadingSpinner size="sm" />
                              Deleting...
                            </>
                          ) : (
                            <>
                              <Trash2 className="w-3 h-3" />
                              Delete Others
                            </>
                          )}
                        </button>
                      </div>

                      {/* Files in Group */}
                      <div style={{ padding: '0.5rem' }}>
                        {group.files.map((file, idx) => {
                          const isSelected = selectedToKeep[group.key] === file.id
                          const isPhoto = file.attachmentType === 'photo'

                          return (
                            <div
                              key={file.id}
                              style={{
                                display: 'flex',
                                alignItems: 'center',
                                gap: '0.75rem',
                                padding: '0.75rem',
                                borderRadius: '4px',
                                background: isSelected ? 'rgba(34, 197, 94, 0.05)' : 'transparent',
                                borderBottom:
                                  idx < group.files.length - 1
                                    ? '0.5px solid var(--border-subtle)'
                                    : 'none',
                              }}
                            >
                              {/* Radio button */}
                              <input
                                type="radio"
                                name={`keep-${group.key}`}
                                checked={isSelected}
                                onChange={() =>
                                  setSelectedToKeep((prev) => ({
                                    ...prev,
                                    [group.key]: file.id,
                                  }))
                                }
                                style={{
                                  accentColor: 'var(--status-success)',
                                  width: '16px',
                                  height: '16px',
                                  cursor: 'pointer',
                                  flexShrink: 0,
                                }}
                              />

                              {/* Thumbnail for photos */}
                              {isPhoto && (
                                <div
                                  style={{
                                    width: '48px',
                                    height: '48px',
                                    borderRadius: '4px',
                                    overflow: 'hidden',
                                    flexShrink: 0,
                                    background: 'var(--bg-subtle)',
                                  }}
                                >
                                  <img
                                    src={`/api/files/${file.filePath}`}
                                    alt={file.originalFileName}
                                    style={{
                                      width: '100%',
                                      height: '100%',
                                      objectFit: 'cover',
                                    }}
                                  />
                                </div>
                              )}

                              {/* File icon for documents */}
                              {!isPhoto && (
                                <div
                                  style={{
                                    width: '48px',
                                    height: '48px',
                                    borderRadius: '4px',
                                    background: 'var(--bg-subtle)',
                                    display: 'flex',
                                    alignItems: 'center',
                                    justifyContent: 'center',
                                    flexShrink: 0,
                                  }}
                                >
                                  <FileText className="w-5 h-5" style={{ color: 'var(--fg-muted)' }} />
                                </div>
                              )}

                              {/* File info */}
                              <div style={{ flex: 1, minWidth: 0 }}>
                                <div
                                  style={{
                                    fontSize: '0.8125rem',
                                    fontWeight: 500,
                                    color: 'var(--fg-default)',
                                    whiteSpace: 'nowrap',
                                    overflow: 'hidden',
                                    textOverflow: 'ellipsis',
                                  }}
                                  title={file.originalFileName}
                                >
                                  {file.originalFileName}
                                </div>
                                <div
                                  style={{
                                    fontSize: '0.75rem',
                                    color: 'var(--fg-muted)',
                                    display: 'flex',
                                    gap: '0.75rem',
                                    marginTop: '0.125rem',
                                  }}
                                >
                                  <span>{formatFileSize(file.fileSize)}</span>
                                  <span>{formatDate(file.createdAt)}</span>
                                </div>
                              </div>

                              {/* Article link */}
                              <Link
                                to="/article/$articleId"
                                params={{ articleId: file.articleId }}
                                style={{
                                  fontSize: '0.75rem',
                                  color: 'var(--accent)',
                                  textDecoration: 'none',
                                  display: 'flex',
                                  alignItems: 'center',
                                  gap: '0.25rem',
                                  whiteSpace: 'nowrap',
                                }}
                                title={file.articleTitle}
                              >
                                <ExternalLink className="w-3 h-3" />
                                View Article
                              </Link>

                              {/* Delete single button */}
                              <button
                                onClick={() => handleDeleteSingle(file)}
                                disabled={deletingId === file.id}
                                className="btn btn-ghost"
                                style={{
                                  padding: '0.375rem',
                                  color: 'var(--status-error)',
                                }}
                                title="Delete this file"
                              >
                                {deletingId === file.id ? (
                                  <LoadingSpinner size="sm" />
                                ) : (
                                  <Trash2 className="w-4 h-4" />
                                )}
                              </button>
                            </div>
                          )
                        })}
                      </div>
                    </div>
                  ))}
                </div>

                {filteredGroups.length === 0 && (filter || typeFilter !== 'all') && (
                  <div
                    style={{
                      textAlign: 'center',
                      padding: '2rem',
                      color: 'var(--fg-muted)',
                    }}
                  >
                    No duplicates match your filters.
                  </div>
                )}
              </>
            )}
          </>
        )}
      </div>
    </div>
  )
}
