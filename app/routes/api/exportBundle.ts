import { createAPIFileRoute } from '@tanstack/start/api'
import JSZip from 'jszip'

interface ExportArticle {
  id: string
  title: string
  author: string
  role: string
  volume: string
  issue: string
  photo: Array<{
    PhotoName: string
    Caption: string
  }>
  content: string
}

export const APIRoute = createAPIFileRoute('/api/exportBundle')({
  POST: async ({ request }) => {
    try {
      const body = await request.json()
      const { volumeId, issueIds, includePhotos } = body as {
        volumeId: string
        issueIds: string[]
        includePhotos: boolean
      }

      // Validate input
      if (!volumeId) {
        return new Response(JSON.stringify({ error: 'Volume ID is required' }), {
          status: 400,
          headers: { 'Content-Type': 'application/json' },
        })
      }

      if (!issueIds || issueIds.length === 0) {
        return new Response(JSON.stringify({ error: 'At least one issue must be selected' }), {
          status: 400,
          headers: { 'Content-Type': 'application/json' },
        })
      }

      const { db, volumes, issues, articles } = await import('@db/index')
      const { eq, inArray } = await import('drizzle-orm')
      const { getStorage } = await import('../../../storage')

      // Get the volume info
      const volume = await db.query.volumes.findFirst({
        where: eq(volumes.id, volumeId),
      })

      if (!volume) {
        return new Response(JSON.stringify({ error: 'Volume not found' }), {
          status: 404,
          headers: { 'Content-Type': 'application/json' },
        })
      }

      // Get the selected issues
      const selectedIssues = await db.query.issues.findMany({
        where: inArray(issues.id, issueIds),
        orderBy: (issues, { asc }) => [asc(issues.issueNumber)],
      })

      if (selectedIssues.length === 0) {
        return new Response(JSON.stringify({ error: 'No issues found' }), {
          status: 404,
          headers: { 'Content-Type': 'application/json' },
        })
      }

      const storage = getStorage()
      const zip = new JSZip()

      // Generate unique folder name with random suffix
      const randomSuffix = Math.random().toString(36).substring(2, 8)
      const baseFolder = `Json_V${volume.volumeNumber}_${randomSuffix}`

      // Process each selected issue
      for (const issue of selectedIssues) {
        // Get all articles for this issue with their attachments and authors
        const issueArticles = await db.query.articles.findMany({
          where: eq(articles.issueId, issue.id),
          with: {
            author: true,
            attachments: true,
          },
        })

        // Build the export articles array
        const exportArticles: ExportArticle[] = []

        for (const article of issueArticles) {
          // Determine author name based on anonymity preference
          const authorName = article.prefersAnonymity
            ? 'Anonymous'
            : article.author
              ? `${article.author.givenName} ${article.author.surname}`
              : 'Unknown Author'

          // Get author role
          const authorRole = article.author?.role || 'Guest Contributor'

          // Get photos for this article
          const photos = article.attachments.filter(
            (a) => a.attachmentType === 'photo'
          )

          // Build photo array
          const photoArray = photos.map((photo) => ({
            PhotoName: photo.originalFileName || photo.fileName,
            Caption: photo.caption || 'No Caption',
          }))

          // Build the export article object
          const exportArticle: ExportArticle = {
            id: article.id,
            title: article.title,
            author: authorName,
            role: authorRole,
            volume: volume.volumeNumber.toString(),
            issue: issue.issueNumber.toString(),
            photo: photoArray,
            content: article.content || '',
          }

          exportArticles.push(exportArticle)

          // If including photos, add them to the ZIP
          if (includePhotos && photos.length > 0) {
            for (const photo of photos) {
              const photoBuffer = await storage.getFile(photo.filePath)
              if (photoBuffer) {
                // Sanitize article title for folder name
                const articleFolder = article.title
                  .replace(/[<>:"/\\|?*]/g, '-')
                  .replace(/\s+/g, ' ')
                  .trim()
                  .substring(0, 50)

                const photoPath = `${baseFolder}/Photos/V${volume.volumeNumber}_I${issue.issueNumber}/${articleFolder}/${photo.originalFileName || photo.fileName}`
                zip.file(photoPath, photoBuffer)
              }
            }
          }
        }

        // Create JSON file for this issue
        const jsonContent = JSON.stringify(exportArticles, null, 2)
        const jsonFilename = `Json_Volume_${volume.volumeNumber}_Issue_${issue.issueNumber}.json`
        zip.file(`${baseFolder}/${jsonFilename}`, jsonContent)
      }

      // Generate the ZIP file
      const zipBuffer = await zip.generateAsync({
        type: 'nodebuffer',
        compression: 'DEFLATE',
        compressionOptions: { level: 9 },
      })

      // Generate filename
      const issueNumbers = selectedIssues.map((i) => i.issueNumber).join('_')
      const filename = `WP_Export_V${volume.volumeNumber}_I${issueNumbers}.zip`

      return new Response(zipBuffer, {
        status: 200,
        headers: {
          'Content-Type': 'application/zip',
          'Content-Disposition': `attachment; filename="${filename}"`,
          'Content-Length': zipBuffer.length.toString(),
        },
      })
    } catch (error) {
      console.error('Export bundle error:', error)
      return new Response(
        JSON.stringify({
          error: 'Failed to generate export',
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
