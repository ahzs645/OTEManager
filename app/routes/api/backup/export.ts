import { createAPIFileRoute } from '@tanstack/start/api'
import archiver from 'archiver'

export const APIRoute = createAPIFileRoute('/api/backup/export')({
  GET: async ({ request }) => {
    try {
      const url = new URL(request.url)
      const backupType = url.searchParams.get('type') || 'both' // 'both', 'database', or 'files'

      const { db } = await import('@db/index')
      const { getStorage } = await import('../../../../storage')
      const storage = getStorage()

      // Fetch all data
      const [
        articles,
        authors,
        volumes,
        issues,
        attachments,
        articleMultimediaTypes,
        articleNotes,
        statusHistory,
        paymentConfig,
        savedViews,
      ] = await Promise.all([
        db.query.articles.findMany(),
        db.query.authors.findMany(),
        db.query.volumes.findMany(),
        db.query.issues.findMany(),
        db.query.attachments.findMany(),
        db.query.articleMultimediaTypes.findMany(),
        db.query.articleNotes.findMany(),
        db.query.statusHistory.findMany(),
        db.query.paymentRateConfig.findFirst(),
        db.query.savedArticleViews.findMany(),
      ])

      // Create manifest based on backup type
      const includeDatabase = backupType === 'both' || backupType === 'database'
      const includeFiles = backupType === 'both' || backupType === 'files'

      const manifest = {
        exportVersion: '1.0',
        exportedAt: new Date().toISOString(),
        backupType,
        counts: {
          articles: includeDatabase ? articles.length : 0,
          authors: includeDatabase ? authors.length : 0,
          volumes: includeDatabase ? volumes.length : 0,
          issues: includeDatabase ? issues.length : 0,
          attachments: attachments.length, // Always include for file references
        },
        data: includeDatabase ? {
          authors,
          volumes,
          issues,
          articles,
          attachments,
          articleMultimediaTypes,
          articleNotes,
          statusHistory,
          paymentConfig: paymentConfig || null,
          savedViews,
        } : {
          // For files-only backup, we still need attachment metadata to restore files
          attachments,
        },
      }

      // Create ZIP archive
      const archive = archiver('zip', { zlib: { level: 9 } })
      const chunks: Buffer[] = []

      // Create a promise that resolves when archiving is complete
      const archiveComplete = new Promise<Buffer>((resolve, reject) => {
        archive.on('data', (chunk) => chunks.push(chunk))
        archive.on('end', () => resolve(Buffer.concat(chunks)))
        archive.on('error', (err) => reject(err))
      })

      // Add manifest
      archive.append(JSON.stringify(manifest, null, 2), { name: 'manifest.json' })

      // Add attachment files if including files (process in parallel batches for speed)
      if (includeFiles && attachments.length > 0) {
        const BATCH_SIZE = 10 // Process 10 files at a time
        for (let i = 0; i < attachments.length; i += BATCH_SIZE) {
          const batch = attachments.slice(i, i + BATCH_SIZE)
          const results = await Promise.all(
            batch.map(async (attachment) => {
              try {
                const fileBuffer = await storage.getFile(attachment.filePath)
                return { attachment, fileBuffer }
              } catch (err) {
                console.warn(`Could not include file ${attachment.filePath}:`, err)
                return { attachment, fileBuffer: null }
              }
            })
          )
          // Add successfully fetched files to archive
          for (const { attachment, fileBuffer } of results) {
            if (fileBuffer) {
              archive.append(fileBuffer, { name: `files/${attachment.filePath}` })
            }
          }
        }
      }

      // Finalize and wait for completion
      archive.finalize()
      const zipBuffer = await archiveComplete
      const timestamp = new Date().toISOString().slice(0, 10)
      const typeSuffix = backupType === 'both' ? '' : `-${backupType}`

      return new Response(zipBuffer, {
        status: 200,
        headers: {
          'Content-Type': 'application/zip',
          'Content-Disposition': `attachment; filename="otemanager-backup${typeSuffix}-${timestamp}.zip"`,
          'Content-Length': zipBuffer.length.toString(),
        },
      })
    } catch (error) {
      console.error('Backup export error:', error)
      return new Response(
        JSON.stringify({
          error: 'Failed to create backup',
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
