import { createAPIFileRoute } from '@tanstack/start/api'

export const APIRoute = createAPIFileRoute('/api/uploadAttachment')({
  POST: async ({ request }) => {
    try {
      const formData = await request.formData()
      const file = formData.get('file') as File | null
      const articleId = formData.get('articleId') as string | null
      const attachmentType = formData.get('attachmentType') as string | null // 'word_document' or 'photo'

      if (!file || !articleId || !attachmentType) {
        return new Response(
          JSON.stringify({ error: 'Missing required fields: file, articleId, attachmentType' }),
          { status: 400, headers: { 'Content-Type': 'application/json' } },
        )
      }

      // Validate file type
      const allowedDocTypes = [
        'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        'application/msword',
      ]
      const allowedImageTypes = ['image/jpeg', 'image/png', 'image/gif', 'image/webp']

      if (attachmentType === 'word_document' && !allowedDocTypes.includes(file.type)) {
        return new Response(
          JSON.stringify({ error: 'Invalid file type. Please upload a Word document (.doc or .docx)' }),
          { status: 400, headers: { 'Content-Type': 'application/json' } },
        )
      }

      if (attachmentType === 'photo' && !allowedImageTypes.includes(file.type)) {
        return new Response(
          JSON.stringify({ error: 'Invalid file type. Please upload an image (JPEG, PNG, GIF, or WebP)' }),
          { status: 400, headers: { 'Content-Type': 'application/json' } },
        )
      }

      // Validate file size (10MB max)
      const maxSize = 10 * 1024 * 1024
      if (file.size > maxSize) {
        return new Response(
          JSON.stringify({ error: 'File too large. Maximum size is 10MB' }),
          { status: 400, headers: { 'Content-Type': 'application/json' } },
        )
      }

      const { db, attachments, articles } = await import('@db/index')
      const { eq, count } = await import('drizzle-orm')
      const { getStorage } = await import('../../../storage')

      // Verify article exists
      const article = await db.query.articles.findFirst({
        where: eq(articles.id, articleId),
      })

      if (!article) {
        return new Response(
          JSON.stringify({ error: 'Article not found' }),
          { status: 404, headers: { 'Content-Type': 'application/json' } },
        )
      }

      // Get file buffer
      const arrayBuffer = await file.arrayBuffer()
      const buffer = Buffer.from(arrayBuffer)

      // Upload to storage
      const storage = getStorage()
      const directory = attachmentType === 'photo' ? `articles/${articleId}/photos` : `articles/${articleId}/documents`
      const uploadResult = await storage.upload(buffer, file.name, directory)

      if (!uploadResult.success || !uploadResult.file) {
        return new Response(
          JSON.stringify({ error: uploadResult.error || 'Failed to upload file' }),
          { status: 500, headers: { 'Content-Type': 'application/json' } },
        )
      }

      // Get photo number for photos
      let photoNumber: number | null = null
      if (attachmentType === 'photo') {
        const [photoCountResult] = await db
          .select({ count: count() })
          .from(attachments)
          .where(eq(attachments.articleId, articleId))
        photoNumber = (photoCountResult?.count || 0) + 1
      }

      // Create attachment record
      const [newAttachment] = await db
        .insert(attachments)
        .values({
          articleId,
          attachmentType: attachmentType as any,
          fileName: uploadResult.file.name,
          originalFileName: file.name,
          filePath: uploadResult.file.path,
          fileSize: uploadResult.file.size,
          mimeType: uploadResult.file.mimeType,
          photoNumber,
        })
        .returning()

      return new Response(
        JSON.stringify({
          success: true,
          attachment: newAttachment,
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      )
    } catch (error) {
      console.error('Upload error:', error)
      return new Response(
        JSON.stringify({
          error: 'Failed to upload file',
          details: error instanceof Error ? error.message : 'Unknown error',
        }),
        { status: 500, headers: { 'Content-Type': 'application/json' } },
      )
    }
  },
})
