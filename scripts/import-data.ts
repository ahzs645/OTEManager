import { promises as fs } from "fs";
import path from "path";
import { db } from "../db";
import {
  authors,
  articles,
  articleMultimediaTypes,
  attachments,
} from "../db/schema";
import { eq } from "drizzle-orm";

// Source paths
const SOURCE_DIR = "/Users/ahmadjalil/Downloads/New Folder With Items";
const JSON_FILE = path.join(SOURCE_DIR, "ote-articles-full-2026-01-11.json");
const DOCUMENTS_DIR = path.join(SOURCE_DIR, "documents");
const PHOTOS_DIR = path.join(SOURCE_DIR, "photos");

// Destination
const UPLOAD_DIR = process.env.UPLOAD_DIR || "./uploads";

// SharePoint article type
interface SharePointArticle {
  Id: number;
  FileLeafRef: string;
  Title: string;
  Internal_x0020_Status: string;
  Given_x0020_Name: string;
  Surname: string;
  Payment_x0020_Status: boolean;
  Article_x0020_Tier: string;
  Multimedia_x0020_Types?: {
    results: string[];
  };
  Prefers_x0020_Anonymity: boolean;
  Contact_x0020_Email: string;
  Autodeposit: boolean;
  Total_x0020_Payment: number | null;
  e_x002d_Transfer_x0020_Email: string;
  role: string;
  Created: string;
  Modified: string;
  _fullName: string;
  _files: Array<{
    name: string;
    size: number;
    isImage: boolean;
    isDocument: boolean;
    metadata: {
      ImageWidth?: number;
      ImageHeight?: number;
    };
  }>;
}

// Status mapping from SharePoint to our schema
const STATUS_MAP: Record<string, typeof articles.$inferInsert.internalStatus> = {
  Draft: "Draft",
  Accepted: "Approved",
  Rejected: "Archived",
  Backlog: "Pending Review",
};

// Role mapping from SharePoint to our schema
const ROLE_MAP: Record<string, typeof authors.$inferInsert.role> = {
  Staff: "Staff Writer",
  Organization: "Other",
  Grad: "Guest Contributor",
  Undergrad: "Guest Contributor",
  Faculty: "Guest Contributor",
  Club: "Other",
};

// Multimedia type mapping
const MULTIMEDIA_MAP: Record<string, "Photo" | "Graphic" | "Video" | "Audio" | "Other"> = {
  Photo: "Photo",
  Graphic: "Graphic",
  Video: "Video",
  Audio: "Audio",
};

async function ensureDir(dir: string) {
  try {
    await fs.mkdir(dir, { recursive: true });
  } catch {
    // Directory exists
  }
}

function sanitizeFilename(filename: string): string {
  return filename
    .replace(/[^a-zA-Z0-9._-]/g, "_")
    .replace(/_{2,}/g, "_")
    .substring(0, 255);
}

async function copyFile(src: string, dest: string): Promise<boolean> {
  try {
    await fs.copyFile(src, dest);
    return true;
  } catch (error) {
    console.error(`Failed to copy ${src}:`, error);
    return false;
  }
}

async function findFile(folderPath: string, targetName: string): Promise<string | null> {
  try {
    const files = await fs.readdir(folderPath);
    // Try exact match first
    if (files.includes(targetName)) {
      return path.join(folderPath, targetName);
    }
    // Try matching by sanitized name
    const sanitized = sanitizeFilename(targetName);
    for (const file of files) {
      if (sanitizeFilename(file) === sanitized) {
        return path.join(folderPath, file);
      }
    }
    return null;
  } catch {
    return null;
  }
}

async function main() {
  console.log("Starting import...\n");

  // Read JSON data
  const jsonData = await fs.readFile(JSON_FILE, "utf-8");
  const articlesData: SharePointArticle[] = JSON.parse(jsonData);
  console.log(`Found ${articlesData.length} articles to import\n`);

  // Ensure upload directories exist
  await ensureDir(path.join(UPLOAD_DIR, "documents"));
  await ensureDir(path.join(UPLOAD_DIR, "photos"));

  // Track authors by email to avoid duplicates
  const authorCache = new Map<string, string>(); // email -> id

  let importedArticles = 0;
  let importedAuthors = 0;
  let importedAttachments = 0;
  let skippedArticles = 0;

  for (const article of articlesData) {
    try {
      const email = article.Contact_x0020_Email?.toLowerCase().trim();
      if (!email) {
        console.log(`Skipping article "${article.Title}" - no email`);
        skippedArticles++;
        continue;
      }

      // Get or create author
      let authorId = authorCache.get(email);
      if (!authorId) {
        // Check if author exists in DB
        const existingAuthor = await db.query.authors.findFirst({
          where: eq(authors.email, email),
        });

        if (existingAuthor) {
          authorId = existingAuthor.id;
        } else {
          // Create new author
          const [newAuthor] = await db
            .insert(authors)
            .values({
              givenName: article.Given_x0020_Name || "Unknown",
              surname: article.Surname || "",
              email: email,
              role: ROLE_MAP[article.role] || "Guest Contributor",
              autoDepositAvailable: article.Autodeposit || false,
              etransferEmail: article.e_x002d_Transfer_x0020_Email || null,
            })
            .returning();
          authorId = newAuthor.id;
          importedAuthors++;
          console.log(`Created author: ${article._fullName} (${email})`);
        }
        authorCache.set(email, authorId);
      }

      // Create article
      const [newArticle] = await db
        .insert(articles)
        .values({
          title: article.Title || article.FileLeafRef,
          authorId: authorId,
          articleTier: (article.Article_x0020_Tier as any) || "Tier 1 (Basic)",
          internalStatus: STATUS_MAP[article.Internal_x0020_Status] || "Draft",
          automationStatus: "Completed",
          prefersAnonymity: article.Prefers_x0020_Anonymity || false,
          paymentStatus: article.Payment_x0020_Status || false,
          paymentAmount: article.Total_x0020_Payment
            ? Math.round(article.Total_x0020_Payment * 100)
            : null,
          submittedAt: article.Created ? new Date(article.Created) : null,
        })
        .returning();

      importedArticles++;

      // Add multimedia types
      const multimediaTypes = article.Multimedia_x0020_Types?.results || [];
      for (const type of multimediaTypes) {
        const mappedType = MULTIMEDIA_MAP[type];
        if (mappedType) {
          await db.insert(articleMultimediaTypes).values({
            articleId: newArticle.id,
            multimediaType: mappedType,
          });
        }
      }

      // Process files
      const articleFolderName = article.FileLeafRef;
      const docsFolderPath = path.join(DOCUMENTS_DIR, articleFolderName);
      const photosFolderPath = path.join(PHOTOS_DIR, articleFolderName);

      // Check for document files
      try {
        const docFiles = await fs.readdir(docsFolderPath);
        for (const file of docFiles) {
          if (file.startsWith(".")) continue;

          const srcPath = path.join(docsFolderPath, file);
          const destDir = path.join(UPLOAD_DIR, "documents", newArticle.id);
          await ensureDir(destDir);

          const destPath = path.join(destDir, sanitizeFilename(file));
          const copied = await copyFile(srcPath, destPath);

          if (copied) {
            const stats = await fs.stat(destPath);
            const ext = path.extname(file).toLowerCase();
            const isImage = [".jpg", ".jpeg", ".png", ".gif", ".webp"].includes(ext);

            await db.insert(attachments).values({
              articleId: newArticle.id,
              attachmentType: isImage ? "photo" : "word_document",
              fileName: sanitizeFilename(file),
              originalFileName: file,
              filePath: path.join("documents", newArticle.id, sanitizeFilename(file)),
              fileSize: stats.size,
              mimeType: getMimeType(file),
            });
            importedAttachments++;
          }
        }
      } catch {
        // No documents folder for this article
      }

      // Check for photo files
      try {
        const photoFiles = await fs.readdir(photosFolderPath);
        let photoNumber = 1;
        for (const file of photoFiles) {
          if (file.startsWith(".")) continue;

          const srcPath = path.join(photosFolderPath, file);
          const destDir = path.join(UPLOAD_DIR, "photos", newArticle.id);
          await ensureDir(destDir);

          const destPath = path.join(destDir, sanitizeFilename(file));
          const copied = await copyFile(srcPath, destPath);

          if (copied) {
            const stats = await fs.stat(destPath);
            await db.insert(attachments).values({
              articleId: newArticle.id,
              attachmentType: "photo",
              fileName: sanitizeFilename(file),
              originalFileName: file,
              filePath: path.join("photos", newArticle.id, sanitizeFilename(file)),
              fileSize: stats.size,
              mimeType: getMimeType(file),
              photoNumber: photoNumber++,
            });
            importedAttachments++;
          }
        }
      } catch {
        // No photos folder for this article
      }

      if (importedArticles % 10 === 0) {
        console.log(`Progress: ${importedArticles}/${articlesData.length} articles`);
      }
    } catch (error) {
      console.error(`Error importing article "${article.Title}":`, error);
      skippedArticles++;
    }
  }

  console.log("\n=== Import Complete ===");
  console.log(`Authors imported: ${importedAuthors}`);
  console.log(`Articles imported: ${importedArticles}`);
  console.log(`Attachments imported: ${importedAttachments}`);
  console.log(`Articles skipped: ${skippedArticles}`);
}

function getMimeType(filename: string): string {
  const ext = path.extname(filename).toLowerCase();
  const mimeTypes: Record<string, string> = {
    ".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    ".doc": "application/msword",
    ".pdf": "application/pdf",
    ".txt": "text/plain",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".png": "image/png",
    ".gif": "image/gif",
    ".webp": "image/webp",
  };
  return mimeTypes[ext] || "application/octet-stream";
}

main().catch(console.error);
