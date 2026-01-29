import { createAPIFileRoute } from '@tanstack/start/api'
import JSZip from 'jszip'

interface BackupManifest {
  exportVersion: string
  exportedAt: string
  backupType?: 'both' | 'database' | 'files'
  counts: {
    articles: number
    authors: number
    volumes: number
    issues: number
    attachments: number
  }
  data: {
    authors?: any[]
    volumes?: any[]
    issues?: any[]
    articles?: any[]
    attachments?: any[]
    articleMultimediaTypes?: any[]
    articleNotes?: any[]
    statusHistory?: any[]
    paymentConfig?: any | null
    savedViews?: any[]
  }
}

export const APIRoute = createAPIFileRoute('/api/backup/import')({
  POST: async ({ request }) => {
    try {
      const formData = await request.formData()
      const file = formData.get('backup') as File
      const mode = formData.get('mode') as string || 'merge' // 'merge' or 'replace'
      const restoreType = formData.get('type') as string || 'both' // 'both', 'database', or 'files'

      if (!file) {
        return new Response(
          JSON.stringify({ error: 'No backup file provided' }),
          { status: 400, headers: { 'Content-Type': 'application/json' } },
        )
      }

      // Read ZIP file
      const arrayBuffer = await file.arrayBuffer()
      const zip = await JSZip.loadAsync(arrayBuffer)

      // Parse manifest
      const manifestFile = zip.file('manifest.json')
      if (!manifestFile) {
        return new Response(
          JSON.stringify({ error: 'Invalid backup: manifest.json not found' }),
          { status: 400, headers: { 'Content-Type': 'application/json' } },
        )
      }

      const manifestContent = await manifestFile.async('string')
      const manifest: BackupManifest = JSON.parse(manifestContent)

      if (!manifest.exportVersion || !manifest.data) {
        return new Response(
          JSON.stringify({ error: 'Invalid backup: malformed manifest' }),
          { status: 400, headers: { 'Content-Type': 'application/json' } },
        )
      }

      // Import database
      const {
        db,
        authors,
        volumes,
        issues,
        articles,
        attachments,
        articleMultimediaTypes,
        articleNotes,
        statusHistory,
        paymentRateConfig,
        savedArticleViews,
      } = await import('@db/index')
      const { getStorage } = await import('../../../../storage')
      const storage = getStorage()

      const stats = {
        authors: { imported: 0, skipped: 0 },
        volumes: { imported: 0, skipped: 0 },
        issues: { imported: 0, skipped: 0 },
        articles: { imported: 0, skipped: 0 },
        attachments: { imported: 0, skipped: 0, filesRestored: 0 },
        multimediaTypes: { imported: 0, skipped: 0 },
        notes: { imported: 0, skipped: 0 },
        statusHistory: { imported: 0, skipped: 0 },
      }

      // Determine what to import based on user selection and what's in the backup
      const backupHasDatabase = manifest.data.authors !== undefined
      const importDatabase = (restoreType === 'both' || restoreType === 'database') && backupHasDatabase
      const importFiles = restoreType === 'both' || restoreType === 'files'

      // If replace mode, clear existing data (in reverse dependency order)
      if (mode === 'replace' && importDatabase) {
        const { sql } = await import('drizzle-orm')
        await db.delete(statusHistory)
        await db.delete(articleNotes)
        await db.delete(articleMultimediaTypes)
        await db.delete(attachments)
        await db.delete(articles)
        await db.delete(issues)
        await db.delete(volumes)
        await db.delete(authors)
        await db.delete(savedArticleViews)
        await db.delete(paymentRateConfig)
      }

      // Helper to check if record exists
      const { eq } = await import('drizzle-orm')

      // Import database records if requested
      if (importDatabase) {
      // Import authors
      for (const author of manifest.data.authors || []) {
        const existing = await db.query.authors.findFirst({
          where: eq(authors.id, author.id),
        })
        if (!existing) {
          await db.insert(authors).values({
            ...author,
            createdAt: new Date(author.createdAt),
            updatedAt: new Date(author.updatedAt),
          })
          stats.authors.imported++
        } else {
          stats.authors.skipped++
        }
      }

      // Import volumes
      for (const volume of manifest.data.volumes || []) {
        const existing = await db.query.volumes.findFirst({
          where: eq(volumes.id, volume.id),
        })
        if (!existing) {
          await db.insert(volumes).values({
            ...volume,
            startDate: volume.startDate ? new Date(volume.startDate) : null,
            endDate: volume.endDate ? new Date(volume.endDate) : null,
            createdAt: new Date(volume.createdAt),
            updatedAt: new Date(volume.updatedAt),
          })
          stats.volumes.imported++
        } else {
          stats.volumes.skipped++
        }
      }

      // Import issues
      for (const issue of manifest.data.issues || []) {
        const existing = await db.query.issues.findFirst({
          where: eq(issues.id, issue.id),
        })
        if (!existing) {
          await db.insert(issues).values({
            ...issue,
            releaseDate: issue.releaseDate ? new Date(issue.releaseDate) : null,
            createdAt: new Date(issue.createdAt),
            updatedAt: new Date(issue.updatedAt),
          })
          stats.issues.imported++
        } else {
          stats.issues.skipped++
        }
      }

      // Import articles
      for (const article of manifest.data.articles || []) {
        const existing = await db.query.articles.findFirst({
          where: eq(articles.id, article.id),
        })
        if (!existing) {
          await db.insert(articles).values({
            ...article,
            submittedAt: article.submittedAt ? new Date(article.submittedAt) : null,
            paidAt: article.paidAt ? new Date(article.paidAt) : null,
            paymentCalculatedAt: article.paymentCalculatedAt ? new Date(article.paymentCalculatedAt) : null,
            createdAt: new Date(article.createdAt),
            updatedAt: new Date(article.updatedAt),
          })
          stats.articles.imported++
        } else {
          stats.articles.skipped++
        }
      }

      // Import attachments (database records)
      for (const attachment of manifest.data.attachments || []) {
        const existing = await db.query.attachments.findFirst({
          where: eq(attachments.id, attachment.id),
        })
        if (!existing) {
          await db.insert(attachments).values({
            ...attachment,
            createdAt: new Date(attachment.createdAt),
          })
          stats.attachments.imported++
        } else {
          stats.attachments.skipped++
        }
      }

      // Import multimedia types
      for (const mt of manifest.data.articleMultimediaTypes || []) {
        const existing = await db.query.articleMultimediaTypes.findFirst({
          where: eq(articleMultimediaTypes.id, mt.id),
        })
        if (!existing) {
          await db.insert(articleMultimediaTypes).values(mt)
          stats.multimediaTypes.imported++
        } else {
          stats.multimediaTypes.skipped++
        }
      }

      // Import notes
      for (const note of manifest.data.articleNotes || []) {
        const existing = await db.query.articleNotes.findFirst({
          where: eq(articleNotes.id, note.id),
        })
        if (!existing) {
          await db.insert(articleNotes).values({
            ...note,
            createdAt: new Date(note.createdAt),
          })
          stats.notes.imported++
        } else {
          stats.notes.skipped++
        }
      }

      // Import status history
      for (const history of manifest.data.statusHistory || []) {
        const existing = await db.query.statusHistory.findFirst({
          where: eq(statusHistory.id, history.id),
        })
        if (!existing) {
          await db.insert(statusHistory).values({
            ...history,
            changedAt: new Date(history.changedAt),
          })
          stats.statusHistory.imported++
        } else {
          stats.statusHistory.skipped++
        }
      }

      // Import payment config (replace if exists in replace mode)
      if (manifest.data.paymentConfig) {
        const existingConfig = await db.query.paymentRateConfig.findFirst()
        if (!existingConfig) {
          await db.insert(paymentRateConfig).values({
            ...manifest.data.paymentConfig,
            updatedAt: new Date(manifest.data.paymentConfig.updatedAt),
          })
        }
      }

      // Import saved views
      for (const view of manifest.data.savedViews || []) {
        const existing = await db.query.savedArticleViews.findFirst({
          where: eq(savedArticleViews.id, view.id),
        })
        if (!existing) {
          await db.insert(savedArticleViews).values({
            ...view,
            createdAt: new Date(view.createdAt),
            updatedAt: new Date(view.updatedAt),
          })
        }
      }
      } // End of importDatabase block

      // Restore files if requested
      if (importFiles) {
        for (const attachment of manifest.data.attachments || []) {
          const fileInZip = zip.file(`files/${attachment.filePath}`)
          if (fileInZip) {
            const fileBuffer = await fileInZip.async('nodebuffer')
            await storage.saveFile(attachment.filePath, fileBuffer)
            stats.attachments.filesRestored++
          }
        }
      }

      return new Response(
        JSON.stringify({
          success: true,
          message: 'Backup restored successfully',
          stats,
          backupInfo: {
            exportedAt: manifest.exportedAt,
            version: manifest.exportVersion,
          },
        }),
        {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        },
      )
    } catch (error) {
      console.error('Backup import error:', error)
      return new Response(
        JSON.stringify({
          error: 'Failed to import backup',
          details: error instanceof Error ? error.message : 'Unknown error',
        }),
        {
          status: 500,
          headers: { 'Content-Type': 'application/json' },
        },
      )
    }
  },
})
