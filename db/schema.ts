import {
  pgTable,
  text,
  timestamp,
  boolean,
  integer,
  uuid,
  pgEnum,
} from "drizzle-orm/pg-core";
import { relations } from "drizzle-orm";

// Enums based on your Power Automate flow
export const articleTierEnum = pgEnum("article_tier", [
  "Tier 1 (Basic)",
  "Tier 2 (Standard)",
  "Tier 3 (Advanced)",
]);

export const internalStatusEnum = pgEnum("internal_status", [
  "Draft",
  "Pending Review",
  "In Review",
  "Needs Revision",
  "Approved",
  "In Editing",
  "Ready for Publication",
  "Published",
  "Archived",
]);

export const automationStatusEnum = pgEnum("automation_status", [
  "Processing",
  "Pending Review",
  "Completed",
  "Failed",
]);

export const contributorRoleEnum = pgEnum("contributor_role", [
  "Staff Writer",
  "Guest Contributor",
  "Editor",
  "Photographer",
  "Graphic Designer",
  "Other",
]);

export const multimediaTypeEnum = pgEnum("multimedia_type", [
  "Photo",
  "Graphic",
  "Video",
  "Audio",
  "Other",
]);

export const attachmentTypeEnum = pgEnum("attachment_type", [
  "word_document",
  "photo",
  "graphic",
  "other",
]);

export const authorTypeEnum = pgEnum("author_type", [
  "Student",
  "Faculty",
  "Organization",
  "External",
]);

// Authors/Contributors table
export const authors = pgTable("authors", {
  id: uuid("id").primaryKey().defaultRandom(),
  givenName: text("given_name").notNull(),
  surname: text("surname").notNull(),
  email: text("email").notNull().unique(),
  role: contributorRoleEnum("role").default("Guest Contributor"),
  authorType: authorTypeEnum("author_type").default("Student"),
  autoDepositAvailable: boolean("auto_deposit_available").default(false),
  etransferEmail: text("etransfer_email"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

// Articles table - main entity
export const articles = pgTable("articles", {
  id: uuid("id").primaryKey().defaultRandom(),
  title: text("title").notNull(),
  authorId: uuid("author_id")
    .references(() => authors.id)
    .notNull(),
  articleTier: articleTierEnum("article_tier").default("Tier 1 (Basic)"),
  internalStatus: internalStatusEnum("internal_status").default("Draft"),
  automationStatus: automationStatusEnum("automation_status").default("Pending Review"),
  prefersAnonymity: boolean("prefers_anonymity").default(false),
  articleFilePath: text("article_file_path"),
  content: text("content"), // Markdown content
  feedbackLetter: text("feedback_letter"), // Markdown feedback letter for author

  // Publication info (legacy integer fields kept for imported data)
  volume: integer("volume"), // e.g., 12 (legacy)
  issue: integer("issue"), // e.g., 3 (legacy)
  // New: Reference to the issues table (includes volume relationship)
  issueId: uuid("issue_id").references(() => issues.id),

  // Payment info
  paymentStatus: boolean("payment_status").default(false),
  paymentAmount: integer("payment_amount"), // in cents
  paidAt: timestamp("paid_at"),
  paymentRateSnapshot: text("payment_rate_snapshot"), // JSON snapshot of rates used for calculation
  paymentCalculatedAt: timestamp("payment_calculated_at"), // When payment was auto-calculated
  paymentIsManual: boolean("payment_is_manual").default(false), // True if manually overridden

  // Bonus eligibility flags
  isFeatured: boolean("is_featured").default(false), // Legacy - kept for backward compatibility
  hasResearchBonus: boolean("has_research_bonus").default(false), // Extensive research or interviews
  hasTimeSensitiveBonus: boolean("has_time_sensitive_bonus").default(false), // Short notice or breaking news
  hasProfessionalPhotos: boolean("has_professional_photos").default(false), // High-quality professional photos
  hasProfessionalGraphics: boolean("has_professional_graphics").default(false), // Professional graphics/infographics

  // Form submission tracking
  formResponseId: text("form_response_id"), // Original MS Forms response ID
  submittedAt: timestamp("submitted_at"),

  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

// Article multimedia types (many-to-many via this table)
export const articleMultimediaTypes = pgTable("article_multimedia_types", {
  id: uuid("id").primaryKey().defaultRandom(),
  articleId: uuid("article_id")
    .references(() => articles.id, { onDelete: "cascade" })
    .notNull(),
  multimediaType: multimediaTypeEnum("multimedia_type").notNull(),
});

// Attachments table - for word docs, photos, etc.
export const attachments = pgTable("attachments", {
  id: uuid("id").primaryKey().defaultRandom(),
  articleId: uuid("article_id")
    .references(() => articles.id, { onDelete: "cascade" })
    .notNull(),
  attachmentType: attachmentTypeEnum("attachment_type").notNull(),
  fileName: text("file_name").notNull(),
  originalFileName: text("original_file_name").notNull(),
  filePath: text("file_path").notNull(),
  fileSize: integer("file_size"), // in bytes
  mimeType: text("mime_type"),
  caption: text("caption"), // For photos
  photoNumber: integer("photo_number"), // For ordering photos (Photo 1, Photo 2, etc.)
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

// Editorial comments/notes on articles
export const articleNotes = pgTable("article_notes", {
  id: uuid("id").primaryKey().defaultRandom(),
  articleId: uuid("article_id")
    .references(() => articles.id, { onDelete: "cascade" })
    .notNull(),
  content: text("content").notNull(),
  createdBy: text("created_by"), // Editor's name/email
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

// Status history for tracking article progression
export const statusHistory = pgTable("status_history", {
  id: uuid("id").primaryKey().defaultRandom(),
  articleId: uuid("article_id")
    .references(() => articles.id, { onDelete: "cascade" })
    .notNull(),
  fromStatus: internalStatusEnum("from_status"),
  toStatus: internalStatusEnum("to_status").notNull(),
  changedBy: text("changed_by"),
  changedAt: timestamp("changed_at").defaultNow().notNull(),
  notes: text("notes"),
});

// Payment rate configuration (single-row table for current rates)
export const paymentRateConfig = pgTable("payment_rate_config", {
  id: uuid("id").primaryKey().defaultRandom(),
  // Tier base rates (in cents)
  tier1Rate: integer("tier1_rate").notNull().default(2000), // $20.00 - Short news briefs, event announcements, simple reviews
  tier2Rate: integer("tier2_rate").notNull().default(3500), // $35.00 - General news articles, opinion pieces, basic feature stories
  tier3Rate: integer("tier3_rate").notNull().default(5000), // $50.00 - In-depth feature stories, investigative pieces, complex analyses
  // Bonus amounts (in cents)
  researchBonus: integer("research_bonus").notNull().default(1000), // $10.00 - For articles requiring extensive research or interviews
  multimediaBonus: integer("multimedia_bonus").notNull().default(500), // $5.00 - For including original photos, graphics, or video content
  timeSensitiveBonus: integer("time_sensitive_bonus").notNull().default(500), // $5.00 - For articles completed on short notice or covering breaking news
  professionalPhotoBonus: integer("professional_photo_bonus").notNull().default(1500), // $15.00 - For high-quality, professional-grade photographs
  professionalGraphicBonus: integer("professional_graphic_bonus").notNull().default(1500), // $15.00 - For original, professional-quality graphics or infographics
  // Metadata
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
  updatedBy: text("updated_by"),
});

// Payment rate history (audit trail of rate changes)
export const paymentRateHistory = pgTable("payment_rate_history", {
  id: uuid("id").primaryKey().defaultRandom(),
  ratesSnapshot: text("rates_snapshot").notNull(), // JSON snapshot of all rates
  changedBy: text("changed_by"),
  changedAt: timestamp("changed_at").defaultNow().notNull(),
  notes: text("notes"), // Optional reason for change
});

// Publication volumes (e.g., Volume 31)
export const volumes = pgTable("volumes", {
  id: uuid("id").primaryKey().defaultRandom(),
  volumeNumber: integer("volume_number").notNull().unique(),
  year: integer("year"), // Primary year for this volume (e.g., 2025)
  startDate: timestamp("start_date"), // When this volume period starts
  endDate: timestamp("end_date"), // When this volume period ends
  description: text("description"), // Optional description
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

// Publication issues within volumes (e.g., Issue 2 of Volume 31)
export const issues = pgTable("issues", {
  id: uuid("id").primaryKey().defaultRandom(),
  volumeId: uuid("volume_id")
    .references(() => volumes.id, { onDelete: "cascade" })
    .notNull(),
  issueNumber: integer("issue_number").notNull(),
  title: text("title"), // Optional title (e.g., "Fall Edition", "Special Issue")
  releaseDate: timestamp("release_date"), // When this issue is/was released
  description: text("description"), // Optional description
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

// Saved article views for filter/sort presets
export const savedArticleViews = pgTable("saved_article_views", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull(),
  isDefault: boolean("is_default").default(false),
  // Filter state
  status: text("status"),
  tier: text("tier"),
  search: text("search"),
  // Sort state
  sortBy: text("sort_by"),
  sortOrder: text("sort_order"),
  // View mode
  viewMode: text("view_mode").default("list"),
  // Timestamps
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

// Relations
export const authorsRelations = relations(authors, ({ many }) => ({
  articles: many(articles),
}));

export const articlesRelations = relations(articles, ({ one, many }) => ({
  author: one(authors, {
    fields: [articles.authorId],
    references: [authors.id],
  }),
  publicationIssue: one(issues, {
    fields: [articles.issueId],
    references: [issues.id],
  }),
  multimediaTypes: many(articleMultimediaTypes),
  attachments: many(attachments),
  notes: many(articleNotes),
  statusHistory: many(statusHistory),
}));

export const volumesRelations = relations(volumes, ({ many }) => ({
  issues: many(issues),
}));

export const issuesRelations = relations(issues, ({ one, many }) => ({
  volume: one(volumes, {
    fields: [issues.volumeId],
    references: [volumes.id],
  }),
  articles: many(articles),
}));

export const articleMultimediaTypesRelations = relations(
  articleMultimediaTypes,
  ({ one }) => ({
    article: one(articles, {
      fields: [articleMultimediaTypes.articleId],
      references: [articles.id],
    }),
  })
);

export const attachmentsRelations = relations(attachments, ({ one }) => ({
  article: one(articles, {
    fields: [attachments.articleId],
    references: [articles.id],
  }),
}));

export const articleNotesRelations = relations(articleNotes, ({ one }) => ({
  article: one(articles, {
    fields: [articleNotes.articleId],
    references: [articles.id],
  }),
}));

export const statusHistoryRelations = relations(statusHistory, ({ one }) => ({
  article: one(articles, {
    fields: [statusHistory.articleId],
    references: [articles.id],
  }),
}));
