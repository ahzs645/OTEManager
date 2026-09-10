import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/api/uploadAttachment")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        try {
          const formData = await request.formData();
          const file = formData.get("file") as File | null;
          const articleId = formData.get("articleId") as string | null;
          const attachmentType = formData.get("attachmentType") as
            string | null; // 'word_document' or 'photo'

          if (!file || !articleId || !attachmentType) {
            return new Response(
              JSON.stringify({
                error:
                  "Missing required fields: file, articleId, attachmentType",
              }),
              { status: 400, headers: { "Content-Type": "application/json" } },
            );
          }

          // Validate file type
          const allowedDocTypes = [
            "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
            "application/msword",
          ];
          const allowedImageTypes = [
            "image/jpeg",
            "image/png",
            "image/gif",
            "image/webp",
          ];

          if (
            attachmentType === "word_document" &&
            !allowedDocTypes.includes(file.type)
          ) {
            return new Response(
              JSON.stringify({
                error:
                  "Invalid file type. Please upload a Word document (.doc or .docx)",
              }),
              { status: 400, headers: { "Content-Type": "application/json" } },
            );
          }

          if (
            attachmentType === "photo" &&
            !allowedImageTypes.includes(file.type)
          ) {
            return new Response(
              JSON.stringify({
                error:
                  "Invalid file type. Please upload an image (JPEG, PNG, GIF, or WebP)",
              }),
              { status: 400, headers: { "Content-Type": "application/json" } },
            );
          }

          // Validate file size (defaults to 10MB, configurable via MAX_FILE_SIZE env var)
          const maxSize =
            parseInt(process.env.MAX_FILE_SIZE || "") || 10 * 1024 * 1024;
          if (file.size > maxSize) {
            return new Response(
              JSON.stringify({
                error: `File too large. Maximum size is ${Math.round(maxSize / 1024 / 1024)}MB`,
              }),
              { status: 400, headers: { "Content-Type": "application/json" } },
            );
          }

          const { get } = await import("../../../server/records");
          const { mutate } = await import("../../../server/convex");
          const { getStorage } = await import("../../../storage");
          const article = await get("articles", articleId);

          if (!article) {
            return new Response(
              JSON.stringify({ error: "Article not found" }),
              { status: 404, headers: { "Content-Type": "application/json" } },
            );
          }

          // Get file buffer
          const arrayBuffer = await file.arrayBuffer();
          const buffer = Buffer.from(arrayBuffer);

          // Upload to storage
          const storage = getStorage();
          const directory =
            attachmentType === "photo"
              ? `articles/${articleId}/photos`
              : `articles/${articleId}/documents`;
          const uploadResult = await storage.upload(
            buffer,
            file.name,
            directory,
          );

          if (!uploadResult.success || !uploadResult.file) {
            return new Response(
              JSON.stringify({
                error: uploadResult.error || "Failed to upload file",
              }),
              { status: 500, headers: { "Content-Type": "application/json" } },
            );
          }

          let newAttachment;
          try {
            const result = await mutate("addAttachment", {
              articleId,
              attachmentType,
              fileName: uploadResult.file.name,
              originalFileName: file.name,
              filePath: uploadResult.file.path,
              fileSize: uploadResult.file.size,
              mimeType: uploadResult.file.mimeType,
            });
            newAttachment = result.attachment;
          } catch (error) {
            await storage.delete(uploadResult.file.path).catch(() => {});
            throw error;
          }

          return new Response(
            JSON.stringify({
              success: true,
              attachment: newAttachment,
            }),
            { status: 200, headers: { "Content-Type": "application/json" } },
          );
        } catch (error) {
          console.error("Upload error:", error);
          return new Response(
            JSON.stringify({
              error: "Failed to upload file",
              details: error instanceof Error ? error.message : "Unknown error",
            }),
            { status: 500, headers: { "Content-Type": "application/json" } },
          );
        }
      },
    },
  },
});
