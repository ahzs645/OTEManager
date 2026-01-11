import { createServerFn } from "@tanstack/start";

// Convert Word document to markdown - isolated to prevent mammoth from being bundled in client
export const convertDocxToMarkdown = createServerFn({ method: "POST" })
  .validator((data: { articleId: string; attachmentId: string }) => data)
  .handler(async ({ data }) => {
    try {
      const { db, articles, attachments } = await import("@db/index");
      const { eq } = await import("drizzle-orm");
      const { getStorage } = await import("../../storage");
      const mammoth = await import("mammoth");

      // Get the attachment
      const attachment = await db.query.attachments.findFirst({
        where: eq(attachments.id, data.attachmentId),
      });

      if (!attachment) {
        return { success: false, error: "Attachment not found" };
      }

      // Read the file
      const storage = getStorage();
      const fileBuffer = await storage.getFile(attachment.filePath);

      if (!fileBuffer) {
        return { success: false, error: "File not found in storage" };
      }

      // Convert to markdown
      const result = await mammoth.convertToMarkdown({ buffer: fileBuffer });
      const markdown = result.value;

      // Update article content
      await db
        .update(articles)
        .set({
          content: markdown,
          updatedAt: new Date(),
        })
        .where(eq(articles.id, data.articleId));

      return { success: true, content: markdown };
    } catch (error) {
      console.error("Failed to convert document:", error);
      return {
        success: false,
        error: error instanceof Error ? error.message : "Unknown error",
      };
    }
  });
