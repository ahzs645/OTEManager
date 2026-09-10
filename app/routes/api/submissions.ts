import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";

// Schema for validating incoming webhook data from Power Automate
const ArticleSubmissionSchema = z.object({
  // Article information
  title: z.string().min(1, "Title is required"),
  articleTier: z.enum([
    "Tier 1 (Basic)",
    "Tier 2 (Standard)",
    "Tier 3 (Advanced)",
  ]),

  // Author information
  author: z.object({
    givenName: z.string().min(1),
    surname: z.string().min(1),
    email: z.string().email(),
    role: z
      .enum([
        "Staff Writer",
        "Guest Contributor",
        "Editor",
        "Photographer",
        "Graphic Designer",
        "Other",
      ])
      .optional()
      .default("Guest Contributor"),
  }),

  // Preferences
  prefersAnonymity: z.boolean().default(false),
  autoDepositAvailable: z.boolean().default(false),
  etransferEmail: z.string().email().optional(),

  // Multimedia
  multimediaTypes: z
    .array(z.enum(["Photo", "Graphic", "Video", "Audio", "Other"]))
    .optional()
    .default([]),

  // Form tracking
  formResponseId: z.string().optional(),
  submittedAt: z.string().optional(), // ISO date string

  // Attachments (base64 encoded). Size is bounded to prevent memory
  // exhaustion: base64 is ~4/3 of the raw size, so the per-attachment cap
  // mirrors the MAX_FILE_SIZE limit used by the upload endpoint.
  attachments: z
    .array(
      z.object({
        name: z.string().max(255),
        type: z.enum(["word_document", "photo", "graphic", "other"]),
        content: z
          .string()
          .max(
            Math.ceil(
              ((parseInt(process.env.MAX_FILE_SIZE || "") || 10 * 1024 * 1024) *
                4) /
                3,
            ),
            "Attachment exceeds maximum file size",
          ), // Base64 encoded content
        mimeType: z.string().optional(),
        caption: z.string().optional(), // For photos
        photoNumber: z.number().optional(),
      }),
    )
    .max(50, "Too many attachments")
    .optional()
    .default([]),
});

type ArticleSubmission = z.infer<typeof ArticleSubmissionSchema>;

export const Route = createFileRoute("/api/submissions")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        try {
          // Optional: Verify webhook secret
          const webhookSecret = process.env.WEBHOOK_SECRET;
          if (webhookSecret) {
            const authHeader = request.headers.get("X-Webhook-Secret");
            if (authHeader !== webhookSecret) {
              return Response.json({ error: "Unauthorized" }, { status: 401 });
            }
          }

          // Reject oversized payloads before buffering the body into memory
          // (defaults to 50MB, configurable via MAX_WEBHOOK_BODY env var)
          const maxBody =
            parseInt(process.env.MAX_WEBHOOK_BODY || "") || 50 * 1024 * 1024;
          const contentLength = parseInt(
            request.headers.get("content-length") || "",
          );
          if (contentLength && contentLength > maxBody) {
            return Response.json(
              { error: "Payload too large" },
              { status: 413 },
            );
          }

          // Parse and validate request body
          const body = await request.json();
          const validationResult = ArticleSubmissionSchema.safeParse(body);

          if (!validationResult.success) {
            return Response.json(
              {
                error: "Validation failed",
                details: validationResult.error.errors,
              },
              { status: 400 },
            );
          }

          const submission = validationResult.data;

          // Process the submission
          const result = await processSubmission(submission);

          return Response.json({
            success: true,
            message: "Article submission received",
            articleId: result.articleId,
          });
        } catch (error) {
          console.error("Webhook error:", error);
          return Response.json(
            {
              error: "Internal server error",
              message: error instanceof Error ? error.message : "Unknown error",
            },
            { status: 500 },
          );
        }
      },
    },
  },
});

async function processSubmission(
  submission: ArticleSubmission,
): Promise<{ articleId: string }> {
  const { getStorage } = await import("../../../storage");
  const { mutate } = await import("../../../server/convex");
  const storage = getStorage(),
    uploaded: string[] = [],
    attachments: Record<string, unknown>[] = [];
  try {
    for (const file of submission.attachments) {
      const result = await storage.upload(
        Buffer.from(file.content, "base64"),
        file.name,
        "submissions",
      );
      if (!result.success || !result.file)
        throw new Error(result.error || "Attachment upload failed");
      uploaded.push(result.file.path);
      attachments.push({
        attachmentType: file.type,
        fileName: result.file.name,
        originalFileName: file.name,
        filePath: result.file.path,
        fileSize: result.file.size,
        mimeType: file.mimeType || result.file.mimeType,
        caption: file.caption || null,
        photoNumber: file.photoNumber || null,
      });
    }
    const result = await mutate("submitArticle", {
      ...submission,
      attachments,
    });
    if (result.existing)
      for (const path of uploaded) await storage.delete(path);
    return result;
  } catch (error) {
    for (const path of uploaded) await storage.delete(path).catch(() => {});
    throw error;
  }
}
