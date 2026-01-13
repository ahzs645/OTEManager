import { createAPIFileRoute } from '@tanstack/start/api'
import { Document, Packer, Paragraph, TextRun, HeadingLevel, ExternalHyperlink } from 'docx'

interface TextSegment {
  text: string
  bold?: boolean
  italic?: boolean
  link?: string
}

// Parse inline markdown formatting and return styled TextRun segments
function parseInlineMarkdown(text: string): TextSegment[] {
  const segments: TextSegment[] = []

  // Combined regex to match bold+italic, bold, italic, and links
  // Order matters: check bold+italic first, then bold, then italic
  const patterns = [
    { regex: /\*\*\*(.+?)\*\*\*/g, bold: true, italic: true },      // ***bold italic***
    { regex: /___(.+?)___/g, bold: true, italic: true },            // ___bold italic___
    { regex: /\*\*(.+?)\*\*/g, bold: true, italic: false },         // **bold**
    { regex: /__(.+?)__/g, bold: true, italic: false },             // __bold__
    { regex: /\*([^*]+)\*/g, bold: false, italic: true },           // *italic*
    { regex: /_([^_]+)_/g, bold: false, italic: true },             // _italic_
    { regex: /\[([^\]]+)\]\(([^)]+)\)/g, bold: false, italic: false, isLink: true }, // [text](url)
  ]

  // Create a combined pattern to split text
  const combinedPattern = /(\*\*\*.+?\*\*\*|___.+?___|__[^_]+__|_[^_]+_|\*\*[^*]+\*\*|\*[^*]+\*|\[[^\]]+\]\([^)]+\))/g

  const parts = text.split(combinedPattern)

  for (const part of parts) {
    if (!part) continue

    let matched = false

    // Check if this part matches any pattern
    for (const pattern of patterns) {
      const match = part.match(new RegExp(`^${pattern.regex.source}$`))
      if (match) {
        if (pattern.isLink) {
          segments.push({
            text: match[1],
            link: match[2],
          })
        } else {
          segments.push({
            text: match[1],
            bold: pattern.bold,
            italic: pattern.italic,
          })
        }
        matched = true
        break
      }
    }

    if (!matched) {
      segments.push({ text: part })
    }
  }

  return segments
}

// Convert segments to TextRun objects
function segmentsToTextRuns(segments: TextSegment[], baseSize: number = 24): TextRun[] {
  return segments.map(seg =>
    new TextRun({
      text: seg.text,
      bold: seg.bold,
      italics: seg.italic,
      size: baseSize,
    })
  )
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
        const headingText = trimmedLine.substring(4)
        const segments = parseInlineMarkdown(headingText)
        paragraphs.push(
          new Paragraph({
            children: segmentsToTextRuns(segments),
            heading: HeadingLevel.HEADING_3,
            spacing: { before: 200, after: 100 },
          }),
        )
      } else if (trimmedLine.startsWith('## ')) {
        const headingText = trimmedLine.substring(3)
        const segments = parseInlineMarkdown(headingText)
        paragraphs.push(
          new Paragraph({
            children: segmentsToTextRuns(segments),
            heading: HeadingLevel.HEADING_2,
            spacing: { before: 300, after: 150 },
          }),
        )
      } else if (trimmedLine.startsWith('# ')) {
        const headingText = trimmedLine.substring(2)
        const segments = parseInlineMarkdown(headingText)
        paragraphs.push(
          new Paragraph({
            children: segmentsToTextRuns(segments),
            heading: HeadingLevel.HEADING_1,
            spacing: { before: 400, after: 200 },
          }),
        )
      }
      // Handle bullet points (* or -)
      else if (trimmedLine.startsWith('* ') || trimmedLine.startsWith('- ')) {
        const bulletText = trimmedLine.substring(2)
        const segments = parseInlineMarkdown(bulletText)
        paragraphs.push(
          new Paragraph({
            children: [
              new TextRun({ text: '• ', size: 24 }),
              ...segmentsToTextRuns(segments),
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
          const segments = parseInlineMarkdown(match[2])
          paragraphs.push(
            new Paragraph({
              children: [
                new TextRun({ text: match[1] + ' ', size: 24 }),
                ...segmentsToTextRuns(segments),
              ],
              spacing: { after: 80 },
              indent: { left: 360 },
            }),
          )
        }
      }
      // Regular paragraph
      else {
        const segments = parseInlineMarkdown(trimmedLine)
        paragraphs.push(
          new Paragraph({
            children: segmentsToTextRuns(segments),
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
