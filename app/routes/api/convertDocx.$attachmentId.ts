import { createFileRoute } from "@tanstack/react-router";
import { cleanConvertedMarkdown } from "../../../shared/docx-markdown";

export const Route = createFileRoute("/api/convertDocx/$attachmentId")({
  server: {
    handlers: {
      GET: async ({ params, request }) => {
        const { attachmentId } = params;
        const url = new URL(request.url);
        const format = url.searchParams.get("format") || "markdown"; // 'markdown', 'html', or 'raw'

        if (!attachmentId) {
          return new Response(
            JSON.stringify({ error: "Attachment ID is required" }),
            {
              status: 400,
              headers: { "Content-Type": "application/json" },
            },
          );
        }

        try {
          const records = await import("../../../server/records");
          const { getStorage } = await import("../../../storage");

          // Get the attachment
          const attachment = await records.get("attachments", attachmentId);

          if (!attachment) {
            return new Response(
              JSON.stringify({ error: "Attachment not found" }),
              {
                status: 404,
                headers: { "Content-Type": "application/json" },
              },
            );
          }

          // Read the file
          const storage = getStorage();
          const fileBuffer = await storage.getFile(attachment.filePath);

          if (!fileBuffer) {
            return new Response(
              JSON.stringify({ error: "File not found in storage" }),
              {
                status: 404,
                headers: { "Content-Type": "application/json" },
              },
            );
          }

          const extension =
            attachment.originalFileName.split(".").pop()?.toLowerCase() || "";

          // Plain-text attachments (e.g. caption files) need no conversion
          if (extension === "txt" || attachment.mimeType === "text/plain") {
            const text = fileBuffer.toString("utf8").replace(/\r\n?/g, "\n");
            if (format === "raw")
              return new Response(text, {
                headers: { "Content-Type": "text/plain; charset=utf-8" },
              });
            return Response.json({
              success: true,
              content: text.trim(),
              format: "text",
            });
          }

          // mammoth and docx-preview only read the .docx format
          if (extension === "doc") {
            return Response.json(
              {
                error:
                  "Legacy .doc files can't be previewed or converted. Open the file in Word and save it as .docx, then upload that copy.",
              },
              { status: 415 },
            );
          }

          // Return raw file for docx-preview
          if (format === "raw") {
            return new Response(fileBuffer, {
              status: 200,
              headers: {
                "Content-Type":
                  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
                "Content-Disposition": `inline; filename="${attachment.originalFileName}"`,
              },
            });
          }

          // Use mammoth's browser build to avoid bluebird/promisify bundling issues
          const mammoth = await import("mammoth/mammoth.browser");

          // Convert Node Buffer to ArrayBuffer for the browser build
          const arrayBuffer = fileBuffer.buffer.slice(
            fileBuffer.byteOffset,
            fileBuffer.byteOffset + fileBuffer.byteLength,
          );

          // Custom image converter that skips images (they're handled separately in PhotoGallery)
          const imageHandler = {
            convertImage: mammoth.images.imgElement(() => {
              return Promise.resolve({ src: "" });
            }),
          };

          if (format === "html") {
            const result = await mammoth.convertToHtml(
              { arrayBuffer },
              imageHandler,
            );
            // Remove empty img tags left from skipped images
            const cleanedHtml = result.value.replace(
              /<img[^>]*src=""[^>]*>/g,
              "",
            );
            return new Response(
              JSON.stringify({
                success: true,
                content: cleanedHtml,
                messages: result.messages,
                format: "html",
              }),
              {
                status: 200,
                headers: { "Content-Type": "application/json" },
              },
            );
          } else {
            const result = await mammoth.convertToMarkdown(
              { arrayBuffer },
              imageHandler,
            );
            return new Response(
              JSON.stringify({
                success: true,
                content: cleanConvertedMarkdown(result.value),
                messages: result.messages,
                format: "markdown",
              }),
              {
                status: 200,
                headers: { "Content-Type": "application/json" },
              },
            );
          }
        } catch (error) {
          console.error("Convert error:", error);
          return new Response(
            JSON.stringify({
              error: "Failed to convert document",
              details: error instanceof Error ? error.message : "Unknown error",
            }),
            {
              status: 500,
              headers: { "Content-Type": "application/json" },
            },
          );
        }
      },
    },
  },
});
