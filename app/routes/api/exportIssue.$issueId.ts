import { createAPIFileRoute } from '@tanstack/start/api'
import JSZip from 'jszip'
import { Document, Packer, Paragraph, TextRun, HeadingLevel } from 'docx'

// Convert markdown content to docx document
async function markdownToDocx(
  content: string,
  title: string,
  authorName: string,
): Promise<Buffer> {
  const paragraphs: Paragraph[] = []

  // Add title
  paragraphs.push(
    new Paragraph({
      text: title,
      heading: HeadingLevel.TITLE,
      spacing: { after: 400 },
    }),
  )

  // Add author
  paragraphs.push(
    new Paragraph({
      children: [
        new TextRun({
          text: `By ${authorName}`,
          italics: true,
          size: 24, // 12pt
        }),
      ],
      spacing: { after: 400 },
    }),
  )

  // Add separator
  paragraphs.push(
    new Paragraph({
      text: '',
      spacing: { after: 200 },
    }),
  )

  // Helper function to clean markdown formatting from text
  const cleanMarkdown = (text: string): string => {
    // Remove bold (**text** or __text__)
    text = text.replace(/\*\*(.*?)\*\*/g, '$1')
    text = text.replace(/__(.*?)__/g, '$1')
    // Remove italic (*text* or _text_) - but only when surrounded by non-space chars
    text = text.replace(/(?<!\s)\*([^*]+)\*(?!\s)/g, '$1')
    text = text.replace(/(?<!\s)_([^_]+)_(?!\s)/g, '$1')
    // Remove links [text](url)
    text = text.replace(/\[(.*?)\]\(.*?\)/g, '$1')
    return text
  }

  // Parse markdown content into paragraphs
  if (content) {
    const lines = content.split('\n')

    for (const line of lines) {
      const trimmedLine = line.trim()

      // Handle empty lines - add spacing
      if (trimmedLine === '') {
        paragraphs.push(
          new Paragraph({
            text: '',
            spacing: { after: 200 },
          }),
        )
      }
      // Handle headings
      else if (trimmedLine.startsWith('### ')) {
        paragraphs.push(
          new Paragraph({
            text: cleanMarkdown(trimmedLine.substring(4)),
            heading: HeadingLevel.HEADING_3,
            spacing: { before: 200, after: 100 },
          }),
        )
      } else if (trimmedLine.startsWith('## ')) {
        paragraphs.push(
          new Paragraph({
            text: cleanMarkdown(trimmedLine.substring(3)),
            heading: HeadingLevel.HEADING_2,
            spacing: { before: 300, after: 150 },
          }),
        )
      } else if (trimmedLine.startsWith('# ')) {
        paragraphs.push(
          new Paragraph({
            text: cleanMarkdown(trimmedLine.substring(2)),
            heading: HeadingLevel.HEADING_1,
            spacing: { before: 400, after: 200 },
          }),
        )
      }
      // Handle bullet points (* or -)
      else if (trimmedLine.startsWith('* ') || trimmedLine.startsWith('- ')) {
        const bulletText = cleanMarkdown(trimmedLine.substring(2))
        paragraphs.push(
          new Paragraph({
            children: [
              new TextRun({ text: '• ', size: 24 }),
              new TextRun({ text: bulletText, size: 24 }),
            ],
            spacing: { after: 80 },
            indent: { left: 360 }, // Indent bullet points
          }),
        )
      }
      // Handle numbered lists (1. 2. etc)
      else if (/^\d+\.\s/.test(trimmedLine)) {
        const match = trimmedLine.match(/^(\d+\.)\s(.*)$/)
        if (match) {
          paragraphs.push(
            new Paragraph({
              children: [
                new TextRun({ text: match[1] + ' ', size: 24 }),
                new TextRun({ text: cleanMarkdown(match[2]), size: 24 }),
              ],
              spacing: { after: 80 },
              indent: { left: 360 },
            }),
          )
        }
      }
      // Regular paragraph - each line is its own paragraph
      else {
        const text = cleanMarkdown(trimmedLine)
        paragraphs.push(
          new Paragraph({
            children: [new TextRun({ text, size: 24 })],
            spacing: { after: 120 },
          }),
        )
      }
    }
  }

  const doc = new Document({
    sections: [
      {
        properties: {},
        children: paragraphs,
      },
    ],
  })

  return await Packer.toBuffer(doc)
}

export const APIRoute = createAPIFileRoute('/api/exportIssue/$issueId')({
  GET: async ({ params }) => {
        const { issueId } = params

        if (!issueId) {
          return new Response(JSON.stringify({ error: 'Issue ID is required' }), {
            status: 400,
            headers: { 'Content-Type': 'application/json' },
          })
        }

        try {
          const { db, issues, articles } = await import('@db/index')
          const { eq } = await import('drizzle-orm')
          const { getStorage } = await import('../../../storage')

          // Get the issue with its volume
          const issue = await db.query.issues.findFirst({
            where: eq(issues.id, issueId),
            with: {
              volume: true,
            },
          })

          if (!issue) {
            return new Response(JSON.stringify({ error: 'Issue not found' }), {
              status: 404,
              headers: { 'Content-Type': 'application/json' },
            })
          }

          // Get all articles for this issue with their attachments and authors
          const issueArticles = await db.query.articles.findMany({
            where: eq(articles.issueId, issueId),
            with: {
              author: true,
              attachments: true,
            },
          })

          if (issueArticles.length === 0) {
            return new Response(
              JSON.stringify({ error: 'No articles found for this issue' }),
              {
                status: 404,
                headers: { 'Content-Type': 'application/json' },
              },
            )
          }

          const storage = getStorage()
          const zip = new JSZip()

          // Base path for the export
          const volumeFolder = `Volume ${issue.volume.volumeNumber}`
          const issueFolder = `Issue ${issue.issueNumber}${issue.title ? ` - ${issue.title}` : ''}`
          const basePath = `${volumeFolder}/${issueFolder}`

          // Process each article
          for (const article of issueArticles) {
            // Sanitize article title for folder name
            const articleFolder = article.title
              .replace(/[<>:"/\\|?*]/g, '-')
              .replace(/\s+/g, ' ')
              .trim()
              .substring(0, 100)

            const articlePath = `${basePath}/${articleFolder}`

            // Determine author name based on anonymity preference
            const authorName = article.prefersAnonymity
              ? 'Anonymous'
              : article.author
                ? `${article.author.givenName} ${article.author.surname}`
                : 'Unknown Author'

            // Get photos
            const photos = article.attachments.filter(
              (a) => a.attachmentType === 'photo',
            )

            // Create the article docx from markdown content (always created, even if empty)
            const docxBuffer = await markdownToDocx(
              article.content || '',
              article.title,
              authorName,
            )
            zip.file(`${articlePath}/${articleFolder}.docx`, docxBuffer)

            // Process photos
            let photoCount = 1
            for (const photo of photos) {
              const photoFolder = `${articlePath}/Photos/Photo ${photo.photoNumber || photoCount}`

              // Get photo file
              const photoBuffer = await storage.getFile(photo.filePath)
              if (photoBuffer) {
                zip.file(`${photoFolder}/${photo.originalFileName}`, photoBuffer)
              }

              // Create caption file - respecting article's anonymity preference
              const captionContent = `Author: ${authorName}
Caption: ${photo.caption || '(No caption provided)'}`

              zip.file(`${photoFolder}/Caption.txt`, captionContent)

              photoCount++
            }
          }

          // Generate the ZIP file
          const zipBuffer = await zip.generateAsync({
            type: 'nodebuffer',
            compression: 'DEFLATE',
            compressionOptions: { level: 9 },
          })

          // Generate filename
          const filename = `Volume_${issue.volume.volumeNumber}_Issue_${issue.issueNumber}_Export.zip`

          return new Response(zipBuffer, {
            status: 200,
            headers: {
              'Content-Type': 'application/zip',
              'Content-Disposition': `attachment; filename="${filename}"`,
              'Content-Length': zipBuffer.length.toString(),
            },
          })
        } catch (error) {
          console.error('Export error:', error)
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
