import { createAPIFileRoute } from "@tanstack/start/api";

export const APIRoute = createAPIFileRoute("/api/files/$")({
  GET: async ({ request, params }) => {
    try {
      const { getStorage } = await import("../../../storage");
      const storage = getStorage();

      // Get the file path from the wildcard param
      const filePath = params._splat || params._ || params['*'];

      if (!filePath) {
        return new Response("File path required", { status: 400 });
      }

      // Check if file exists
      const exists = await storage.exists(filePath);
      if (!exists) {
        return new Response("File not found", { status: 404 });
      }

      // Get file content
      const content = await storage.getFile(filePath);
      if (!content) {
        return new Response("Failed to read file", { status: 500 });
      }

      // Determine content type
      const ext = filePath.split(".").pop()?.toLowerCase() || "";
      const contentTypes: Record<string, string> = {
        docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        doc: "application/msword",
        pdf: "application/pdf",
        txt: "text/plain",
        jpg: "image/jpeg",
        jpeg: "image/jpeg",
        png: "image/png",
        gif: "image/gif",
        webp: "image/webp",
      };
      const contentType = contentTypes[ext] || "application/octet-stream";

      return new Response(content, {
        headers: {
          "Content-Type": contentType,
          "Content-Length": content.length.toString(),
          "Cache-Control": "private, max-age=3600",
        },
      });
    } catch (error) {
      console.error("File serve error:", error);
      return new Response("Internal server error", { status: 500 });
    }
  },
});
