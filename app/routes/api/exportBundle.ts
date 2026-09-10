import { createFileRoute } from "@tanstack/react-router";
import JSZip from "jszip";

interface ExportArticle {
  id: string;
  title: string;
  author: string;
  role: string;
  volume: string;
  issue: string;
  photo: Array<{
    PhotoName: string;
    Caption: string;
  }>;
  content: string;
}

export const Route = createFileRoute("/api/exportBundle")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        try {
          const records = await import("../../../server/records");
          const { query } = await import("../../../server/convex");
          const body = await request.json();
          const { volumeId, issueIds, includePhotos } = body as {
            volumeId: string;
            issueIds: string[];
            includePhotos: boolean;
          };

          // Validate input
          if (!volumeId) {
            return new Response(
              JSON.stringify({ error: "Volume ID is required" }),
              {
                status: 400,
                headers: { "Content-Type": "application/json" },
              },
            );
          }

          if (
            !Array.isArray(issueIds) ||
            issueIds.length === 0 ||
            issueIds.some((id) => typeof id !== "string")
          ) {
            return new Response(
              JSON.stringify({ error: "At least one issue must be selected" }),
              {
                status: 400,
                headers: { "Content-Type": "application/json" },
              },
            );
          }

          const { getStorage } = await import("../../../storage");

          // Get the volume info
          const volume = await records.get("volumes", volumeId);

          if (!volume) {
            return new Response(JSON.stringify({ error: "Volume not found" }), {
              status: 404,
              headers: { "Content-Type": "application/json" },
            });
          }

          // Get the selected issues
          const selectedIssues = await records
            .list("issues")
            .then((rows) =>
              rows
                .filter((row) => issueIds.includes(row.id))
                .sort((a, b) => a.issueNumber - b.issueNumber),
            );

          if (
            selectedIssues.length !== new Set(issueIds).size ||
            selectedIssues.some((issue) => issue.volumeId !== volumeId)
          ) {
            return Response.json(
              {
                error:
                  "Every selected issue must belong to the selected volume",
              },
              { status: 400 },
            );
          }

          const storage = getStorage();
          const zip = new JSZip();

          // Generate unique folder name with random suffix
          const randomSuffix = Math.random().toString(36).substring(2, 8);
          const baseFolder = `Json_V${volume.volumeNumber}_${randomSuffix}`;

          // Process each selected issue
          for (const issue of selectedIssues) {
            // Get all articles for this issue with their attachments and authors
            const issueArticles = await query("getIssueArticles", {
              issueId: issue.id,
            }).then((r) => r.articles);

            // Build the export articles array
            const exportArticles: ExportArticle[] = [];

            for (const article of issueArticles) {
              // Determine author name based on anonymity preference
              const authorName = article.prefersAnonymity
                ? "Anonymous"
                : article.author
                  ? `${article.author.givenName} ${article.author.surname}`
                  : "Unknown Author";

              // Get author role
              const authorRole = article.author?.role || "Guest Contributor";

              // Get photos for this article
              const photos = article.attachments.filter(
                (a) => a.attachmentType === "photo",
              );

              // Build photo array
              const photoArray = photos.map((photo) => ({
                PhotoName: photo.originalFileName || photo.fileName,
                Caption: photo.caption || "No Caption",
              }));

              // Build the export article object
              const exportArticle: ExportArticle = {
                id: article.id,
                title: article.title,
                author: authorName,
                role: authorRole,
                volume: volume.volumeNumber.toString(),
                issue: issue.issueNumber.toString(),
                photo: photoArray,
                content: article.content || "",
              };

              exportArticles.push(exportArticle);

              // If including photos, add them to the ZIP
              if (includePhotos && photos.length > 0) {
                for (const photo of photos) {
                  const photoBuffer = await storage.getFile(photo.filePath);
                  if (!photoBuffer)
                    throw new Error(
                      `Missing photo: ${photo.originalFileName || photo.fileName}`,
                    );
                  if (photoBuffer) {
                    // Sanitize article title for folder name
                    const articleFolder = article.title
                      .replace(/[<>:"/\\|?*]/g, "-")
                      .replace(/\s+/g, " ")
                      .trim()
                      .substring(0, 50);

                    const photoPath = `${baseFolder}/Photos/V${volume.volumeNumber}_I${issue.issueNumber}/${articleFolder}/${photo.originalFileName || photo.fileName}`;
                    zip.file(photoPath, photoBuffer);
                  }
                }
              }
            }

            // Create JSON file for this issue
            const jsonContent = JSON.stringify(exportArticles, null, 2);
            const jsonFilename = `Json_Volume_${volume.volumeNumber}_Issue_${issue.issueNumber}.json`;
            zip.file(`${baseFolder}/${jsonFilename}`, jsonContent);
          }

          // Generate the ZIP file
          const zipBuffer = await zip.generateAsync({
            type: "nodebuffer",
            compression: "DEFLATE",
            compressionOptions: { level: 9 },
          });

          // Generate filename
          const issueNumbers = selectedIssues
            .map((i) => i.issueNumber)
            .join("_");
          const filename = `WP_Export_V${volume.volumeNumber}_I${issueNumbers}.zip`;

          return new Response(zipBuffer, {
            status: 200,
            headers: {
              "Content-Type": "application/zip",
              "Content-Disposition": `attachment; filename="${filename}"`,
              "Content-Length": zipBuffer.length.toString(),
            },
          });
        } catch (error) {
          console.error("Export bundle error:", error);
          return new Response(
            JSON.stringify({
              error: "Failed to generate export",
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
