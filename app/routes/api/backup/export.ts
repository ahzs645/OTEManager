import { createAPIFileRoute } from '@tanstack/start/api'
import archiver from 'archiver'
import { PassThrough } from 'stream'

export const APIRoute = createAPIFileRoute('/api/backup/export')({
  GET: async () => {
    try {
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

      // Create manifest with all data
      const manifest = {
        exportVersion: '1.0',
        exportedAt: new Date().toISOString(),
        counts: {
          articles: articles.length,
          authors: authors.length,
          volumes: volumes.length,
          issues: issues.length,
          attachments: attachments.length,
        },
        data: {
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
        },
      }

      // Create ZIP archive
      const archive = archiver('zip', { zlib: { level: 9 } })
      const passthrough = new PassThrough()

      // Collect chunks for response
      const chunks: Buffer[] = []
      passthrough.on('data', (chunk) => chunks.push(chunk))

      archive.pipe(passthrough)

      // Add manifest
      archive.append(JSON.stringify(manifest, null, 2), { name: 'manifest.json' })

      // Add all attachment files
      for (const attachment of attachments) {
        try {
          const fileBuffer = await storage.getFile(attachment.filePath)
          if (fileBuffer) {
            archive.append(fileBuffer, { name: `files/${attachment.filePath}` })
          }
        } catch (err) {
          console.warn(`Could not include file ${attachment.filePath}:`, err)
        }
      }

      // Finalize and wait for completion
      await archive.finalize()

      // Wait for all data to be collected
      await new Promise<void>((resolve) => {
        passthrough.on('end', resolve)
      })

      const zipBuffer = Buffer.concat(chunks)
      const timestamp = new Date().toISOString().slice(0, 10)

      return new Response(zipBuffer, {
        status: 200,
        headers: {
          'Content-Type': 'application/zip',
          'Content-Disposition': `attachment; filename="otemanager-backup-${timestamp}.zip"`,
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
