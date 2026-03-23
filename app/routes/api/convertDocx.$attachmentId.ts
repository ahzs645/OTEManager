import { createFileRoute } from '@tanstack/react-router'

// Clean up mammoth's overly-escaped markdown output
function cleanMarkdownEscapes(markdown: string): string {
  return markdown
    // Remove backslash escapes before common characters that don't need escaping in most contexts
    .replace(/\\([._*\[\]()!#`~>+\-])/g, '$1')
    // Fix double-escaped underscores in bold/italic
    .replace(/__\\_(.+?)\\___/g, '__*$1*__')
    .replace(/\\_\\_(.+?)\\_\\_/g, '__$1__')
    .replace(/\\_(.+?)\\_/g, '_$1_')
}

export const Route = createFileRoute('/api/convertDocx/$attachmentId')({
  server: {
    handlers: {
      GET: async ({ params, request }) => {
        const { attachmentId } = params
        const url = new URL(request.url)
        const format = url.searchParams.get('format') || 'markdown' // 'markdown', 'html', or 'raw'

        if (!attachmentId) {
          return new Response(JSON.stringify({ error: 'Attachment ID is required' }), {
            status: 400,
            headers: { 'Content-Type': 'application/json' },
          })
        }

        try {
          const { db, attachments } = await import('@db/index')
          const { eq } = await import('drizzle-orm')
          const { getStorage } = await import('../../../storage')

          // Get the attachment
          const attachment = await db.query.attachments.findFirst({
            where: eq(attachments.id, attachmentId),
          })

          if (!attachment) {
            return new Response(JSON.stringify({ error: 'Attachment not found' }), {
              status: 404,
              headers: { 'Content-Type': 'application/json' },
            })
          }

          // Read the file
          const storage = getStorage()
          const fileBuffer = await storage.getFile(attachment.filePath)

          if (!fileBuffer) {
            return new Response(JSON.stringify({ error: 'File not found in storage' }), {
              status: 404,
              headers: { 'Content-Type': 'application/json' },
            })
          }

          // Return raw file for docx-preview
          if (format === 'raw') {
            return new Response(fileBuffer, {
              status: 200,
              headers: {
                'Content-Type': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
                'Content-Disposition': `inline; filename="${attachment.originalFileName}"`,
              },
            })
          }

          // Use mammoth's browser build to avoid bluebird/promisify bundling issues
          const mammoth = await import('mammoth/mammoth.browser')

          // Convert Node Buffer to ArrayBuffer for the browser build
          const arrayBuffer = fileBuffer.buffer.slice(
            fileBuffer.byteOffset,
            fileBuffer.byteOffset + fileBuffer.byteLength,
          )

          // Custom image converter that skips images (they're handled separately in PhotoGallery)
          const imageHandler = {
            convertImage: mammoth.images.imgElement(() => {
              return Promise.resolve({ src: '' })
            }),
          }

          if (format === 'html') {
            const result = await mammoth.convertToHtml(
              { arrayBuffer },
              imageHandler,
            )
            // Remove empty img tags left from skipped images
            const cleanedHtml = result.value.replace(/<img[^>]*src=""[^>]*>/g, '')
            return new Response(
              JSON.stringify({
                success: true,
                content: cleanedHtml,
                messages: result.messages,
                format: 'html',
              }),
              {
                status: 200,
                headers: { 'Content-Type': 'application/json' },
              },
            )
          } else {
            const result = await mammoth.convertToMarkdown(
              { arrayBuffer },
              imageHandler,
            )
            // Clean up markdown and remove empty image references
            let cleanedMarkdown = cleanMarkdownEscapes(result.value)
            // Remove empty markdown image syntax left from skipped images
            cleanedMarkdown = cleanedMarkdown.replace(/!\[\]\(\)/g, '')
            // Remove any remaining empty lines from removed images
            cleanedMarkdown = cleanedMarkdown.replace(/\n{3,}/g, '\n\n')
            return new Response(
              JSON.stringify({
                success: true,
                content: cleanedMarkdown.trim(),
                messages: result.messages,
                format: 'markdown',
              }),
              {
                status: 200,
                headers: { 'Content-Type': 'application/json' },
              },
            )
          }
        } catch (error) {
          console.error('Convert error:', error)
          return new Response(
            JSON.stringify({
              error: 'Failed to convert document',
              details: error instanceof Error ? error.message : 'Unknown error',
            }),
            {
              status: 500,
              headers: { 'Content-Type': 'application/json' },
            },
          )
        }
      },
    },
  },
})
