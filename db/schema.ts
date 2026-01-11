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

// Authors/Contributors table
export const authors = pgTable("authors", {
  id: uuid("id").primaryKey().defaultRandom(),
  givenName: text("given_name").notNull(),
  surname: text("surname").notNull(),
  email: text("email").notNull().unique(),
  role: contributorRoleEnum("role").default("Guest Contributor"),
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

  // Payment info
  paymentStatus: boolean("payment_status").default(false),
  paymentAmount: integer("payment_amount"), // in cents
  paidAt: timestamp("paid_at"),

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

// Relations
export const authorsRelations = relations(authors, ({ many }) => ({
  articles: many(articles),
}));

export const articlesRelations = relations(articles, ({ one, many }) => ({
  author: one(authors, {
    fields: [articles.authorId],
    references: [authors.id],
  }),
  multimediaTypes: many(articleMultimediaTypes),
  attachments: many(attachments),
  notes: many(articleNotes),
  statusHistory: many(statusHistory),
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
