import { json } from "@tanstack/start";
import { createAPIFileRoute } from "@tanstack/start/api";
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

  // Attachments (base64 encoded)
  attachments: z
    .array(
      z.object({
        name: z.string(),
        type: z.enum(["word_document", "photo", "graphic", "other"]),
        content: z.string(), // Base64 encoded content
        mimeType: z.string().optional(),
        caption: z.string().optional(), // For photos
        photoNumber: z.number().optional(),
      })
    )
    .optional()
    .default([]),
});

type ArticleSubmission = z.infer<typeof ArticleSubmissionSchema>;

export const APIRoute = createAPIFileRoute("/api/submissions")({
  POST: async ({ request }) => {
    try {
      // Optional: Verify webhook secret
      const webhookSecret = process.env.WEBHOOK_SECRET;
      if (webhookSecret) {
        const authHeader = request.headers.get("X-Webhook-Secret");
        if (authHeader !== webhookSecret) {
          return json({ error: "Unauthorized" }, { status: 401 });
        }
      }

      // Parse and validate request body
      const body = await request.json();
      const validationResult = ArticleSubmissionSchema.safeParse(body);

      if (!validationResult.success) {
        return json(
          {
            error: "Validation failed",
            details: validationResult.error.errors,
          },
          { status: 400 }
        );
      }

      const submission = validationResult.data;

      // Process the submission
      const result = await processSubmission(submission);

      return json({
        success: true,
        message: "Article submission received",
        articleId: result.articleId,
      });
    } catch (error) {
      console.error("Webhook error:", error);
      return json(
        {
          error: "Internal server error",
          message: error instanceof Error ? error.message : "Unknown error",
        },
        { status: 500 }
      );
    }
  },
});

async function processSubmission(submission: ArticleSubmission): Promise<{ articleId: string }> {
  const { db, authors, articles, attachments, articleMultimediaTypes } =
    await import("@db/index");
  const { getStorage } = await import("../../../storage");
  const { eq } = await import("drizzle-orm");

  const storage = getStorage();

  // 1. Find or create author
  let author = await db.query.authors.findFirst({
    where: eq(authors.email, submission.author.email),
  });

  if (!author) {
    const [newAuthor] = await db
      .insert(authors)
      .values({
        givenName: submission.author.givenName,
        surname: submission.author.surname,
        email: submission.author.email,
        role: submission.author.role,
        autoDepositAvailable: submission.autoDepositAvailable,
        etransferEmail: submission.etransferEmail,
      })
      .returning();
    author = newAuthor;
  }

  // 2. Create article
  const [article] = await db
    .insert(articles)
    .values({
      title: submission.title,
      authorId: author.id,
      articleTier: submission.articleTier,
      internalStatus: "Pending Review",
      automationStatus: "Processing",
      prefersAnonymity: submission.prefersAnonymity,
      formResponseId: submission.formResponseId,
      submittedAt: submission.submittedAt
        ? new Date(submission.submittedAt)
        : new Date(),
    })
    .returning();

  // 3. Add multimedia types
  if (submission.multimediaTypes.length > 0) {
    await db.insert(articleMultimediaTypes).values(
      submission.multimediaTypes.map((type) => ({
        articleId: article.id,
        multimediaType: type,
      }))
    );
  }

  // 4. Process and store attachments
  const authorFolder = `${submission.author.givenName}_${submission.author.surname}`.replace(
    /[^a-zA-Z0-9_]/g,
    "_"
  );
  const articleFolder = submission.title
    .substring(0, 50)
    .replace(/[^a-zA-Z0-9_]/g, "_");
  const baseDir = `articles/${authorFolder}/${articleFolder}`;

  for (const attachment of submission.attachments) {
    // Decode base64 content
    const buffer = Buffer.from(attachment.content, "base64");

    // Determine subdirectory
    let subDir = baseDir;
    if (attachment.type === "photo" && attachment.photoNumber) {
      subDir = `${baseDir}/photos/Photo_${attachment.photoNumber}`;
    } else if (attachment.type === "word_document") {
      subDir = `${baseDir}/documents`;
    }

    // Upload file
    const uploadResult = await storage.upload(buffer, attachment.name, subDir);

    if (uploadResult.success && uploadResult.file) {
      // Save attachment record
      await db.insert(attachments).values({
        articleId: article.id,
        attachmentType: attachment.type,
        fileName: uploadResult.file.name,
        originalFileName: attachment.name,
        filePath: uploadResult.file.path,
        fileSize: uploadResult.file.size,
        mimeType: attachment.mimeType || uploadResult.file.mimeType,
        caption: attachment.caption,
        photoNumber: attachment.photoNumber,
      });
    }
  }

  // 5. Update automation status
  await db
    .update(articles)
    .set({ automationStatus: "Pending Review" })
    .where(eq(articles.id, article.id));

  // 6. Calculate initial payment based on current rates
  const { paymentRateConfig } = await import("@db/index");
  const { calculatePayment } = await import("../../lib/payment-calculator");

  const config = await db.query.paymentRateConfig.findFirst();
  if (config) {
    const calculation = calculatePayment(
      submission.articleTier,
      submission.multimediaTypes,
      false, // Not featured by default
      config
    );

    await db
      .update(articles)
      .set({
        paymentAmount: calculation.totalAmount,
        paymentRateSnapshot: JSON.stringify(calculation),
        paymentCalculatedAt: new Date(),
        paymentIsManual: false,
      })
      .where(eq(articles.id, article.id));
  }

  return { articleId: article.id };
}
