import { createFileRoute } from '@tanstack/react-router'
import { validateFilePath } from '../../../shared/file-path'

export const Route = createFileRoute('/api/files/$')({
  server: {
    handlers: {
      GET: async ({ request, params }) => {
        try {
          const { getStorage } = await import("../../../storage");
          const { mimeType } = await import("../../../storage/convex");
          const storage = getStorage();

          // Get the file path from the wildcard param
          const filePath = (params as any)._splat || (params as any)._ || (params as any)['*'];

          if (!filePath) {
            return new Response("File path required", { status: 400 });
          }

          // Prevent path traversal attacks. This checks whole path segments, so
          // names such as "1993..July04.jpg" are still allowed.
          try {
            validateFilePath(filePath);
          } catch {
            return new Response("Invalid file path", { status: 403 });
          }

          const info = await storage.info(filePath);
          if (!info) {
            return new Response("File not found", { status: 404 });
          }

          // Determine content type from the name; stored types can be generic
          const contentType = mimeType(filePath);
          const etag = info.sha256 ? `"${info.sha256}"` : null;

          // ?w=480 serves a downscaled WebP preview of an image
          const { thumbnailWidth, canThumbnail, getThumbnail } = await import(
            "../../../server/thumbnails"
          );
          const width = thumbnailWidth(new URL(request.url).searchParams.get("w"));
          if (width && canThumbnail(contentType)) {
            const thumbEtag = etag ? `"${info.sha256}-w${width}"` : null;
            if (thumbEtag && request.headers.get("If-None-Match") === thumbEtag) {
              return new Response(null, { status: 304, headers: { ETag: thumbEtag } });
            }
            const thumbnail = await getThumbnail(
              `${filePath}:${info.sha256 ?? info.size}`,
              width,
              () => storage.getFile(filePath),
            );
            if (thumbnail) {
              return new Response(thumbnail, {
                headers: {
                  "Content-Type": "image/webp",
                  "Content-Length": thumbnail.length.toString(),
                  "Cache-Control": "private, max-age=86400",
                  ...(thumbEtag ? { ETag: thumbEtag } : {}),
                },
              });
            }
          }

          if (etag && request.headers.get("If-None-Match") === etag) {
            return new Response(null, { status: 304, headers: { ETag: etag } });
          }

          // Get file content
          const content = await storage.getFile(filePath);
          if (!content) {
            return new Response("Failed to read file", { status: 500 });
          }

          return new Response(content, {
            headers: {
              "Content-Type": contentType,
              "Content-Length": content.length.toString(),
              "Cache-Control": "private, max-age=3600",
              ...(etag ? { ETag: etag } : {}),
            },
          });
        } catch (error) {
          console.error("File serve error:", error);
          return new Response("Internal server error", { status: 500 });
        }
      },
    },
  },
})
