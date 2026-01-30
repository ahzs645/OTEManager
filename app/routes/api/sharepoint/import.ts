import { createAPIFileRoute } from '@tanstack/start/api'
import { db } from '@db/index'
import {
  authors,
  articles,
  articleMultimediaTypes,
  attachments,
} from '@db/schema'
import { eq } from 'drizzle-orm'
import JSZip from 'jszip'
import { promises as fs } from 'fs'
import path from 'path'

// SharePoint article type from export
interface SharePointArticle {
  Id: number
  FileLeafRef: string
  Title: string
  Internal_x0020_Status?: string
  Given_x0020_Name?: string
  Surname?: string
  Payment_x0020_Status?: boolean
  Article_x0020_Tier?: string
  Multimedia_x0020_Types?: string | null
  Prefers_x0020_Anonymity?: boolean
  Contact_x0020_Email?: string
  Autodeposit?: boolean
  Total_x0020_Payment?: number | null
  e_x002d_Transfer_x0020_Email?: string
  role?: string
  Volume?: string | number | null
  Issue?: string | number | null
  Article_x0020_Content1?: string | null
  Bonus_x0020_Type?: string | null
  Created?: string
  Modified?: string
  _fullName?: string
  _files?: Array<{
    name: string
    size: number
    isImage: boolean
    isDocument: boolean
    metadata?: {
      Caption?: string
    }
  }>
  _images?: Array<{
    name: string
    metadata?: {
      Caption?: string
    }
  }>
  _documents?: Array<{
    name: string
  }>
}

// Status mapping from SharePoint to our schema
const STATUS_MAP: Record<string, string> = {
  Draft: 'Draft',
  Accepted: 'Approved',
  Rejected: 'Archived',
  Backlog: 'Pending Review',
  'Pending Review': 'Pending Review',
  'In Progress': 'In Review',
  'In Review': 'In Review',
  'Needs Revision': 'Needs Revision',
  Approved: 'Approved',
  'In Editing': 'In Editing',
  'Ready for Publication': 'Ready for Publication',
  Published: 'Published',
  Archived: 'Archived',
}

// Role mapping
const STUDENT_TYPE_MAP: Record<string, string> = {
  Undergrad: 'Undergrad',
  Grad: 'Grad',
  Graduate: 'Grad',
  Alumni: 'Alumni',
  Faculty: 'Other',
  Staff: 'Other',
  Other: 'Other',
}

function sanitizeFilename(filename: string): string {
  return filename
    .replace(/[^a-zA-Z0-9._-]/g, '_')
    .replace(/_{2,}/g, '_')
    .substring(0, 255)
}

function getMimeType(filename: string): string {
  const ext = path.extname(filename).toLowerCase()
  const mimeTypes: Record<string, string> = {
    '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    '.doc': 'application/msword',
    '.pdf': 'application/pdf',
    '.txt': 'text/plain',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.png': 'image/png',
    '.gif': 'image/gif',
    '.webp': 'image/webp',
    '.heic': 'image/heic',
  }
  return mimeTypes[ext] || 'application/octet-stream'
}

function isImageFile(filename: string): boolean {
  const ext = path.extname(filename).toLowerCase()
  return ['.jpg', '.jpeg', '.png', '.gif', '.webp', '.heic'].includes(ext)
}

function isDocumentFile(filename: string): boolean {
  const ext = path.extname(filename).toLowerCase()
  return ['.docx', '.doc', '.pdf', '.txt'].includes(ext)
}

// Normalize folder name for matching (handle encoding issues with special chars)
function normalizeFolderName(name: string): string {
  return name
    .normalize('NFKD')
    .replace(/[\u2018\u2019\u201A\u201B\u0060\u00B4]/g, "'") // Normalize various apostrophe types
    .replace(/[\u201C\u201D\u201E\u201F]/g, '"') // Normalize various quote types
    .replace(/[^\x20-\x7E]/g, '') // Remove non-ASCII chars that might be corrupted
    .trim()
}

// Find matching folder in a directory, handling encoding differences
async function findMatchingFolder(baseDir: string, targetName: string): Promise<string | null> {
  try {
    const folders = await fs.readdir(baseDir)
    const normalizedTarget = normalizeFolderName(targetName)

    // First try exact match
    if (folders.includes(targetName)) {
      return path.join(baseDir, targetName)
    }

    // Then try normalized match
    for (const folder of folders) {
      if (normalizeFolderName(folder) === normalizedTarget) {
        return path.join(baseDir, folder)
      }
    }

    // Finally try a fuzzy match - strip all non-alphanumeric
    const fuzzyTarget = targetName.replace(/[^a-zA-Z0-9]/g, '').toLowerCase()
    for (const folder of folders) {
      const fuzzyFolder = folder.replace(/[^a-zA-Z0-9]/g, '').toLowerCase()
      if (fuzzyFolder === fuzzyTarget) {
        return path.join(baseDir, folder)
      }
    }

    return null
  } catch {
    return null
  }
}

export const APIRoute = createAPIFileRoute('/api/sharepoint/import')({
  POST: async ({ request }) => {
    try {
      const formData = await request.formData()
      const file = formData.get('file') as File | null
      const folderPath = formData.get('folderPath') as string | null
      const mode = (formData.get('mode') as string) || 'merge'
      const previewOnly = formData.get('preview') === 'true'

      const stats = {
        authors: { imported: 0, skipped: 0 },
        articles: { imported: 0, skipped: 0, updated: 0 },
        attachments: { imported: 0, skipped: 0 },
        errors: [] as string[],
      }

      // Get storage provider
      const { getStorage } = await import('../../../../storage')
      const storage = getStorage()

      let articlesData: SharePointArticle[] = []
      let documentsDir: string | null = null
      let photosDir: string | null = null
      let tempDir: string | null = null

      // Handle ZIP file upload
      if (file && file.size > 0) {
        const arrayBuffer = await file.arrayBuffer()
        const zip = await JSZip.loadAsync(arrayBuffer)

        // Find the JSON file
        const jsonFile = Object.keys(zip.files).find(
          (name) => name.endsWith('.json') && !name.startsWith('__MACOSX')
        )
        if (!jsonFile) {
          return Response.json(
            { error: 'No JSON file found in ZIP' },
            { status: 400 }
          )
        }

        const jsonContent = await zip.files[jsonFile].async('string')
        articlesData = JSON.parse(jsonContent)

        // Detect root folder prefix (e.g., "ote-export-2026-01-30-214907/")
        // by looking at the JSON file path
        const jsonDir = path.dirname(jsonFile)
        const rootPrefix = jsonDir && jsonDir !== '.' ? jsonDir + '/' : ''

        // Check for documents and photos folders in ZIP (with or without root prefix)
        const hasDocuments = Object.keys(zip.files).some((name) => {
          const lowerName = name.toLowerCase()
          return lowerName.startsWith('documents/') ||
                 lowerName.startsWith(rootPrefix.toLowerCase() + 'documents/')
        })
        const hasPhotos = Object.keys(zip.files).some((name) => {
          const lowerName = name.toLowerCase()
          return lowerName.startsWith('photos/') ||
                 lowerName.startsWith(rootPrefix.toLowerCase() + 'photos/')
        })

        if (hasDocuments || hasPhotos) {
          // Extract to temp directory for file processing
          tempDir = `/tmp/sharepoint-import-${Date.now()}`
          await fs.mkdir(tempDir, { recursive: true })

          for (const [filename, zipEntry] of Object.entries(zip.files)) {
            if (zipEntry.dir || filename.startsWith('__MACOSX')) continue
            const content = await zipEntry.async('nodebuffer')
            // Strip the root prefix when extracting so paths are normalized
            const normalizedFilename = rootPrefix && filename.startsWith(rootPrefix)
              ? filename.slice(rootPrefix.length)
              : filename
            const filePath = path.join(tempDir, normalizedFilename)
            await fs.mkdir(path.dirname(filePath), { recursive: true })
            await fs.writeFile(filePath, content)
          }

          documentsDir = path.join(tempDir, 'documents')
          photosDir = path.join(tempDir, 'photos')
        }
      }
      // Handle folder path
      else if (folderPath) {
        // Validate folder exists
        try {
          await fs.access(folderPath)
        } catch {
          return Response.json(
            { error: `Folder not found: ${folderPath}` },
            { status: 400 }
          )
        }

        // Find JSON file in folder
        const files = await fs.readdir(folderPath)
        const jsonFile = files.find((f) => f.endsWith('.json'))
        if (!jsonFile) {
          return Response.json(
            { error: 'No JSON file found in folder' },
            { status: 400 }
          )
        }

        const jsonContent = await fs.readFile(
          path.join(folderPath, jsonFile),
          'utf-8'
        )
        articlesData = JSON.parse(jsonContent)

        // Check for documents and photos folders
        documentsDir = path.join(folderPath, 'documents')
        photosDir = path.join(folderPath, 'photos')

        try {
          await fs.access(documentsDir)
        } catch {
          documentsDir = null
        }

        try {
          await fs.access(photosDir)
        } catch {
          photosDir = null
        }
      } else {
        return Response.json(
          { error: 'No file or folder path provided' },
          { status: 400 }
        )
      }

      if (!Array.isArray(articlesData)) {
        return Response.json(
          { error: 'Invalid JSON format - expected array of articles' },
          { status: 400 }
        )
      }

      // Preview mode - calculate what will happen without importing
      if (previewOnly) {
        const previewStats = {
          articles: { new: 0, update: 0, skip: 0 },
          authors: { new: 0, existing: 0 },
          files: { documents: 0, photos: 0 },
          articlePreviews: [] as Array<{
            title: string
            author: string
            email: string
            status: 'new' | 'update' | 'skip'
            documents: number
            photos: number
          }>,
        }

        const seenEmails = new Set<string>()
        const existingAuthorsCache = new Map<string, boolean>()

        for (const article of articlesData) {
          const email = article.Contact_x0020_Email?.toLowerCase().trim()
          if (!email) {
            previewStats.articles.skip++
            continue
          }

          // Check author
          if (!seenEmails.has(email)) {
            seenEmails.add(email)
            if (!existingAuthorsCache.has(email)) {
              const existingAuthor = await db.query.authors.findFirst({
                where: eq(authors.email, email),
              })
              existingAuthorsCache.set(email, !!existingAuthor)
            }
            if (existingAuthorsCache.get(email)) {
              previewStats.authors.existing++
            } else {
              previewStats.authors.new++
            }
          }

          // Check article - first by SharePoint ID, then by title + author
          const sharePointId = `sp-${article.Id}`
          let existingArticle = await db.query.articles.findFirst({
            where: eq(articles.formResponseId, sharePointId),
          })

          // If no match by SharePoint ID, check by title + author email
          const articleTitle = (article.Title || article.FileLeafRef || '').toLowerCase().trim()
          if (!existingArticle && articleTitle) {
            const { and, sql } = await import('drizzle-orm')
            // Find article with same title and same author email
            const titleMatch = await db
              .select({ id: articles.id })
              .from(articles)
              .leftJoin(authors, eq(articles.authorId, authors.id))
              .where(
                and(
                  sql`LOWER(${articles.title}) = ${articleTitle}`,
                  sql`LOWER(${authors.email}) = ${email}`
                )
              )
              .limit(1)

            if (titleMatch.length > 0) {
              existingArticle = { id: titleMatch[0].id } as any
            }
          }

          let articleStatus: 'new' | 'update' | 'skip' = 'new'
          if (existingArticle) {
            if (mode === 'merge') {
              articleStatus = 'skip'
              previewStats.articles.skip++
            } else {
              articleStatus = 'update'
              previewStats.articles.update++
            }
          } else {
            previewStats.articles.new++
          }

          // Count files
          let docCount = 0
          let photoCount = 0
          const articleFolderName = article.FileLeafRef

          if (documentsDir) {
            const docFolder = await findMatchingFolder(documentsDir, articleFolderName)
            if (docFolder) {
              try {
                const docFiles = await fs.readdir(docFolder)
                docCount = docFiles.filter(f => !f.startsWith('.') && isDocumentFile(f)).length
                previewStats.files.documents += docCount
              } catch {
                // No documents folder
              }
            }
          }

          if (photosDir) {
            const photoFolder = await findMatchingFolder(photosDir, articleFolderName)
            if (photoFolder) {
              try {
                const photoFiles = await fs.readdir(photoFolder)
                photoCount = photoFiles.filter(f => !f.startsWith('.') && isImageFile(f)).length
                previewStats.files.photos += photoCount
              } catch {
                // No photos folder
              }
            }
          }

          previewStats.articlePreviews.push({
            title: article.Title || article.FileLeafRef,
            author: `${article.Given_x0020_Name || ''} ${article.Surname || ''}`.trim() || 'Unknown',
            email,
            status: articleStatus,
            documents: docCount,
            photos: photoCount,
          })
        }

        // Cleanup temp directory if we created one
        if (tempDir) {
          try {
            await fs.rm(tempDir, { recursive: true, force: true })
          } catch {
            // Ignore cleanup errors
          }
        }

        return Response.json({
          success: true,
          preview: true,
          stats: previewStats,
        })
      }

      // Track authors by email to avoid duplicates
      const authorCache = new Map<string, string>() // email -> id

      for (const article of articlesData) {
        try {
          const email = article.Contact_x0020_Email?.toLowerCase().trim()
          if (!email) {
            stats.errors.push(
              `Skipping "${article.Title}" - no email address`
            )
            continue
          }

          // Check for existing article - first by SharePoint ID, then by title + author
          const sharePointId = `sp-${article.Id}`
          let existingArticle = await db.query.articles.findFirst({
            where: eq(articles.formResponseId, sharePointId),
          })

          // If no match by SharePoint ID, check by title + author email
          const articleTitle = (article.Title || article.FileLeafRef || '').toLowerCase().trim()
          if (!existingArticle && articleTitle) {
            const { and, sql } = await import('drizzle-orm')
            const titleMatch = await db
              .select({
                id: articles.id,
                formResponseId: articles.formResponseId,
              })
              .from(articles)
              .leftJoin(authors, eq(articles.authorId, authors.id))
              .where(
                and(
                  sql`LOWER(${articles.title}) = ${articleTitle}`,
                  sql`LOWER(${authors.email}) = ${email}`
                )
              )
              .limit(1)

            if (titleMatch.length > 0) {
              existingArticle = titleMatch[0] as any
            }
          }

          if (existingArticle && mode === 'merge') {
            stats.articles.skipped++
            continue
          }

          // Get or create author
          let authorId = authorCache.get(email)
          if (!authorId) {
            const existingAuthor = await db.query.authors.findFirst({
              where: eq(authors.email, email),
            })

            if (existingAuthor) {
              authorId = existingAuthor.id
              stats.authors.skipped++
            } else {
              const studentType = STUDENT_TYPE_MAP[article.role || ''] || null
              const [newAuthor] = await db
                .insert(authors)
                .values({
                  givenName: article.Given_x0020_Name || 'Unknown',
                  surname: article.Surname || '',
                  email: email,
                  role: 'Guest Contributor',
                  authorType: 'Student',
                  studentType: studentType as any,
                  autoDepositAvailable: article.Autodeposit || false,
                  etransferEmail: article.e_x002d_Transfer_x0020_Email || null,
                })
                .returning()
              authorId = newAuthor.id
              stats.authors.imported++
            }
            authorCache.set(email, authorId)
          }

          // Create or update article
          const hasExistingPayment =
            article.Total_x0020_Payment != null &&
            article.Total_x0020_Payment > 0

          const articleValues = {
            title: article.Title || article.FileLeafRef,
            authorId: authorId,
            articleTier: (article.Article_x0020_Tier as any) || 'Tier 1 (Basic)',
            internalStatus:
              (STATUS_MAP[article.Internal_x0020_Status || ''] as any) ||
              'Pending Review',
            automationStatus: 'Completed' as const,
            prefersAnonymity: article.Prefers_x0020_Anonymity || false,
            paymentStatus: article.Payment_x0020_Status || false,
            paymentAmount: article.Total_x0020_Payment
              ? Math.round(article.Total_x0020_Payment * 100)
              : null,
            paymentIsManual: hasExistingPayment,
            submittedAt: article.Created ? new Date(article.Created) : null,
            volume:
              article.Volume != null ? parseInt(String(article.Volume), 10) : null,
            issue:
              article.Issue != null ? parseInt(String(article.Issue), 10) : null,
            content: article.Article_x0020_Content1 || null,
            formResponseId: sharePointId,
          }

          let newArticleId: string

          if (existingArticle && mode === 'replace') {
            // Update existing article
            await db
              .update(articles)
              .set({ ...articleValues, updatedAt: new Date() })
              .where(eq(articles.id, existingArticle.id))
            newArticleId = existingArticle.id
            stats.articles.updated++
          } else {
            // Create new article
            const [newArticle] = await db
              .insert(articles)
              .values(articleValues)
              .returning()
            newArticleId = newArticle.id
            stats.articles.imported++
          }

          // Process files for this article
          const articleFolderName = article.FileLeafRef

          // Process documents
          if (documentsDir) {
            const docFolder = await findMatchingFolder(documentsDir, articleFolderName)
            if (docFolder) {
              try {
                const docFiles = await fs.readdir(docFolder)
                for (const fileName of docFiles) {
                  if (fileName.startsWith('.')) continue
                  if (!isDocumentFile(fileName)) continue

                  const srcPath = path.join(docFolder, fileName)
                  const fileBuffer = await fs.readFile(srcPath)
                  const sanitizedName = sanitizeFilename(fileName)
                  const destSubDir = 'documents'
                  const destPath = `${destSubDir}/${newArticleId}/${sanitizedName}`

                  // Upload using storage provider
                  await storage.saveFile(destPath, fileBuffer)

                  // Create attachment record
                  await db.insert(attachments).values({
                    articleId: newArticleId,
                    attachmentType: 'word_document',
                    fileName: sanitizedName,
                    originalFileName: fileName,
                    filePath: destPath,
                    fileSize: fileBuffer.length,
                    mimeType: getMimeType(fileName),
                  })
                  stats.attachments.imported++
                }
              } catch {
                // No documents folder for this article
              }
            }
          }

          // Process photos
          if (photosDir) {
            const photoFolder = await findMatchingFolder(photosDir, articleFolderName)
            if (photoFolder) {
              try {
                const photoFiles = await fs.readdir(photoFolder)
                let photoNumber = 1

                for (const fileName of photoFiles) {
                  if (fileName.startsWith('.')) continue
                  if (!isImageFile(fileName)) continue

                  const srcPath = path.join(photoFolder, fileName)
                  const fileBuffer = await fs.readFile(srcPath)
                  const sanitizedName = sanitizeFilename(fileName)
                  const destSubDir = 'photos'
                  const destPath = `${destSubDir}/${newArticleId}/${sanitizedName}`

                  // Upload using storage provider
                  await storage.saveFile(destPath, fileBuffer)

                  // Find caption from metadata if available
                  const imageMetadata = article._images?.find(
                    (img) => img.name === fileName
                  )
                  const caption = imageMetadata?.metadata?.Caption || null

                  // Create attachment record
                  await db.insert(attachments).values({
                    articleId: newArticleId,
                    attachmentType: 'photo',
                    fileName: sanitizedName,
                    originalFileName: fileName,
                    filePath: destPath,
                    fileSize: fileBuffer.length,
                    mimeType: getMimeType(fileName),
                    caption: caption,
                    photoNumber: photoNumber++,
                  })
                  stats.attachments.imported++
                }
              } catch {
                // No photos folder for this article
              }
            }
          }

          // Add multimedia types if present
          if (article.Multimedia_x0020_Types) {
            const types =
              typeof article.Multimedia_x0020_Types === 'string'
                ? article.Multimedia_x0020_Types.split(',').map((t) => t.trim())
                : []

            for (const type of types) {
              const mappedType = {
                Photo: 'Photo',
                Graphic: 'Graphic',
                Video: 'Video',
                Audio: 'Audio',
              }[type]

              if (mappedType) {
                try {
                  await db.insert(articleMultimediaTypes).values({
                    articleId: newArticleId,
                    multimediaType: mappedType as any,
                  })
                } catch {
                  // Ignore duplicate multimedia type entries
                }
              }
            }
          }
        } catch (error) {
          stats.errors.push(
            `Error importing "${article.Title}": ${error instanceof Error ? error.message : 'Unknown error'}`
          )
        }
      }

      // Cleanup temp directory if we created one
      if (tempDir) {
        try {
          await fs.rm(tempDir, { recursive: true, force: true })
        } catch {
          // Ignore cleanup errors
        }
      }

      return Response.json({
        success: true,
        stats,
        message: `Imported ${stats.articles.imported} articles, ${stats.authors.imported} authors, ${stats.attachments.imported} files`,
      })
    } catch (error) {
      console.error('SharePoint import error:', error)
      return Response.json(
        {
          error:
            error instanceof Error ? error.message : 'Import failed',
        },
        { status: 500 }
      )
    }
  },
})
