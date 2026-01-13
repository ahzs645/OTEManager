import { createAPIFileRoute } from '@tanstack/start/api'

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

export const APIRoute = createAPIFileRoute('/api/convertDocx/$attachmentId')({
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

      // Convert using mammoth
      const mammoth = await import('mammoth')

      if (format === 'html') {
        const result = await mammoth.convertToHtml({ buffer: fileBuffer })
        return new Response(
          JSON.stringify({
            success: true,
            content: result.value,
            messages: result.messages,
            format: 'html',
          }),
          {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          },
        )
      } else {
        const result = await mammoth.convertToMarkdown({ buffer: fileBuffer })
        const cleanedMarkdown = cleanMarkdownEscapes(result.value)
        return new Response(
          JSON.stringify({
            success: true,
            content: cleanedMarkdown,
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
})
