import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

export default defineSchema({
  authors: defineTable({
    id: v.string(),
    givenName: v.string(),
    surname: v.string(),
    email: v.string(),
    role: v.union(
      v.union(
        v.literal("Staff Writer"),
        v.literal("Guest Contributor"),
        v.literal("Editor"),
        v.literal("Photographer"),
        v.literal("Graphic Designer"),
        v.literal("Other"),
      ),
      v.null(),
    ),
    authorType: v.union(
      v.union(
        v.literal("Student"),
        v.literal("Faculty"),
        v.literal("Staff"),
        v.literal("Organization"),
        v.literal("External"),
      ),
      v.null(),
    ),
    studentType: v.union(
      v.union(
        v.literal("Undergrad"),
        v.literal("Grad"),
        v.literal("Alumni"),
        v.literal("Other"),
      ),
      v.null(),
    ),
    autoDepositAvailable: v.union(v.boolean(), v.null()),
    etransferEmail: v.union(v.string(), v.null()),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_legacy_id", ["id"])
    .index("by_email", ["email"]),
  articles: defineTable({
    id: v.string(),
    title: v.string(),
    authorId: v.string(),
    articleTier: v.union(
      v.union(
        v.literal("Tier 1 (Basic)"),
        v.literal("Tier 2 (Standard)"),
        v.literal("Tier 3 (Advanced)"),
      ),
      v.null(),
    ),
    internalStatus: v.union(
      v.union(
        v.literal("Draft"),
        v.literal("Pending Review"),
        v.literal("In Review"),
        v.literal("Needs Revision"),
        v.literal("Approved"),
        v.literal("In Editing"),
        v.literal("Ready for Publication"),
        v.literal("Published"),
        v.literal("Archived"),
      ),
      v.null(),
    ),
    automationStatus: v.union(
      v.union(
        v.literal("Processing"),
        v.literal("Pending Review"),
        v.literal("Completed"),
        v.literal("Failed"),
      ),
      v.null(),
    ),
    prefersAnonymity: v.union(v.boolean(), v.null()),
    articleFilePath: v.union(v.string(), v.null()),
    content: v.union(v.string(), v.null()),
    feedbackLetter: v.union(v.string(), v.null()),
    volume: v.union(v.number(), v.null()),
    issue: v.union(v.number(), v.null()),
    issueId: v.union(v.string(), v.null()),
    paymentStatus: v.union(v.boolean(), v.null()),
    paymentAmount: v.union(v.number(), v.null()),
    paidAt: v.union(v.number(), v.null()),
    paymentRateSnapshot: v.union(v.string(), v.null()),
    paymentCalculatedAt: v.union(v.number(), v.null()),
    paymentIsManual: v.union(v.boolean(), v.null()),
    isFeatured: v.union(v.boolean(), v.null()),
    hasResearchBonus: v.union(v.boolean(), v.null()),
    hasTimeSensitiveBonus: v.union(v.boolean(), v.null()),
    hasMultimediaBonus: v.union(v.boolean(), v.null()),
    hasProfessionalPhotos: v.union(v.boolean(), v.null()),
    hasProfessionalGraphics: v.union(v.boolean(), v.null()),
    formResponseId: v.union(v.string(), v.null()),
    submittedAt: v.union(v.number(), v.null()),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_legacy_id", ["id"])
    .index("by_authorId", ["authorId"])
    .index("by_internalStatus", ["internalStatus"])
    .index("by_issueId", ["issueId"])
    .index("by_paymentStatus", ["paymentStatus"])
    .index("by_formResponseId", ["formResponseId"]),
  articleMultimediaTypes: defineTable({
    id: v.string(),
    articleId: v.string(),
    multimediaType: v.union(
      v.literal("Photo"),
      v.literal("Graphic"),
      v.literal("Video"),
      v.literal("Audio"),
      v.literal("Other"),
    ),
  })
    .index("by_legacy_id", ["id"])
    .index("by_articleId", ["articleId"]),
  attachments: defineTable({
    id: v.string(),
    articleId: v.string(),
    attachmentType: v.union(
      v.literal("word_document"),
      v.literal("photo"),
      v.literal("graphic"),
      v.literal("other"),
    ),
    fileName: v.string(),
    originalFileName: v.string(),
    filePath: v.string(),
    fileSize: v.union(v.number(), v.null()),
    mimeType: v.union(v.string(), v.null()),
    caption: v.union(v.string(), v.null()),
    photoNumber: v.union(v.number(), v.null()),
    createdAt: v.number(),
  })
    .index("by_legacy_id", ["id"])
    .index("by_articleId", ["articleId"])
    .index("by_filePath", ["filePath"]),
  articleNotes: defineTable({
    id: v.string(),
    articleId: v.string(),
    content: v.string(),
    createdBy: v.union(v.string(), v.null()),
    createdAt: v.number(),
  })
    .index("by_legacy_id", ["id"])
    .index("by_articleId", ["articleId"]),
  statusHistory: defineTable({
    id: v.string(),
    articleId: v.string(),
    fromStatus: v.union(
      v.union(
        v.literal("Draft"),
        v.literal("Pending Review"),
        v.literal("In Review"),
        v.literal("Needs Revision"),
        v.literal("Approved"),
        v.literal("In Editing"),
        v.literal("Ready for Publication"),
        v.literal("Published"),
        v.literal("Archived"),
      ),
      v.null(),
    ),
    toStatus: v.union(
      v.literal("Draft"),
      v.literal("Pending Review"),
      v.literal("In Review"),
      v.literal("Needs Revision"),
      v.literal("Approved"),
      v.literal("In Editing"),
      v.literal("Ready for Publication"),
      v.literal("Published"),
      v.literal("Archived"),
    ),
    changedBy: v.union(v.string(), v.null()),
    changedAt: v.number(),
    notes: v.union(v.string(), v.null()),
  })
    .index("by_legacy_id", ["id"])
    .index("by_articleId", ["articleId"]),
  paymentRateConfig: defineTable({
    id: v.string(),
    tier1Rate: v.number(),
    tier2Rate: v.number(),
    tier3Rate: v.number(),
    researchBonus: v.number(),
    multimediaBonus: v.number(),
    timeSensitiveBonus: v.number(),
    professionalPhotoBonus: v.number(),
    professionalGraphicBonus: v.number(),
    updatedAt: v.number(),
    updatedBy: v.union(v.string(), v.null()),
  }).index("by_legacy_id", ["id"]),
  paymentRateHistory: defineTable({
    id: v.string(),
    ratesSnapshot: v.string(),
    changedBy: v.union(v.string(), v.null()),
    changedAt: v.number(),
    notes: v.union(v.string(), v.null()),
  }).index("by_legacy_id", ["id"]),
  volumes: defineTable({
    id: v.string(),
    volumeNumber: v.number(),
    year: v.union(v.number(), v.null()),
    startDate: v.union(v.number(), v.null()),
    endDate: v.union(v.number(), v.null()),
    description: v.union(v.string(), v.null()),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_legacy_id", ["id"])
    .index("by_volumeNumber", ["volumeNumber"]),
  issues: defineTable({
    id: v.string(),
    volumeId: v.string(),
    issueNumber: v.number(),
    title: v.union(v.string(), v.null()),
    releaseDate: v.union(v.number(), v.null()),
    description: v.union(v.string(), v.null()),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_legacy_id", ["id"])
    .index("by_volumeId", ["volumeId"]),
  savedArticleViews: defineTable({
    id: v.string(),
    name: v.string(),
    isDefault: v.union(v.boolean(), v.null()),
    status: v.union(v.string(), v.null()),
    tier: v.union(v.string(), v.null()),
    search: v.union(v.string(), v.null()),
    sortBy: v.union(v.string(), v.null()),
    sortOrder: v.union(v.string(), v.null()),
    viewMode: v.union(v.string(), v.null()),
    createdAt: v.number(),
    updatedAt: v.number(),
  }).index("by_legacy_id", ["id"]),
  storedFiles: defineTable({
    path: v.string(),
    storageId: v.id("_storage"),
    size: v.number(),
    mimeType: v.string(),
    sha256: v.optional(v.string()),
  }).index("by_path", ["path"]),
});
