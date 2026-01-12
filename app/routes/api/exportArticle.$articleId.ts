import { createAPIFileRoute } from '@tanstack/start/api'
import { Document, Packer, Paragraph, TextRun, HeadingLevel } from 'docx'

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

export const APIRoute = createAPIFileRoute('/api/exportArticle/$articleId')({
  GET: async ({ params }) => {
    const { articleId } = params

    if (!articleId) {
      return new Response(JSON.stringify({ error: 'Article ID is required' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      })
    }

    try {
      const { db, articles } = await import('@db/index')
      const { eq } = await import('drizzle-orm')

      // Get the article with author
      const article = await db.query.articles.findFirst({
        where: eq(articles.id, articleId),
        with: {
          author: true,
        },
      })

      if (!article) {
        return new Response(JSON.stringify({ error: 'Article not found' }), {
          status: 404,
          headers: { 'Content-Type': 'application/json' },
        })
      }

      // Determine author name based on anonymity preference
      const authorName = article.prefersAnonymity
        ? 'Anonymous'
        : article.author
          ? `${article.author.givenName} ${article.author.surname}`
          : 'Unknown Author'

      // Generate the docx
      const docxBuffer = await markdownToDocx(
        article.content || '',
        article.title,
        authorName,
      )

      // Sanitize filename
      const filename = article.title
        .replace(/[<>:"/\\|?*]/g, '-')
        .replace(/\s+/g, ' ')
        .trim()
        .substring(0, 100)

      return new Response(docxBuffer, {
        status: 200,
        headers: {
          'Content-Type': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
          'Content-Disposition': `attachment; filename="${filename}.docx"`,
          'Content-Length': docxBuffer.length.toString(),
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
