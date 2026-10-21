import { query, mutation } from "./_generated/server";
import { v } from "convex/values";
import { requireServer } from "./lib/auth";
import { validateFilePath } from "../shared/file-path";
import { Store } from "./lib/store";
import { isIssueStudioFileReferenced } from "./lib/issueStudioFiles";
import { syncIssueStudioArticle } from "./operations/issueStudio";
export const uploadUrl = mutation({
  args: { secret: v.string() },
  handler: async (ctx, a) => {
    requireServer(a.secret);
    return ctx.storage.generateUploadUrl();
  },
});
export const finalize = mutation({
  args: {
    secret: v.string(),
    path: v.string(),
    storageId: v.id("_storage"),
    size: v.number(),
    mimeType: v.string(),
    sha256: v.optional(v.string()),
  },
  handler: async (ctx, a) => {
    requireServer(a.secret);
    validateFilePath(a.path);
    const meta = await ctx.db.system.get(a.storageId);
    if (!meta || meta.size !== a.size)
      throw new Error("Uploaded file size does not match");
    const old = await ctx.db
      .query("storedFiles")
      .withIndex("by_path", (q) => q.eq("path", a.path))
      .unique();
    const doc = {
      path: a.path,
      storageId: a.storageId,
      size: meta.size,
      mimeType: a.mimeType,
      ...(a.sha256 ? { sha256: a.sha256 } : {}),
    };
    if (old) {
      // Compare storage's actual checksums, including legacy files without a
      // caller-supplied checksum. An identical retry keeps the original links.
      const oldMeta = await ctx.db.system.get(old.storageId);
      if (
        old.storageId !== a.storageId &&
        oldMeta?.sha256 === meta.sha256 &&
        old.size === meta.size &&
        old.mimeType === a.mimeType
      ) {
        const stored = await ctx.db.query("storedFiles").take(1001);
        if (
          stored.length <= 1000 &&
          !stored.some((file) => file.storageId === a.storageId)
        )
          await ctx.storage.delete(a.storageId);
        return true;
      }
      if (
        old.storageId !== a.storageId &&
        old.sha256 &&
        old.sha256 === a.sha256 &&
        old.size === meta.size &&
        old.mimeType === a.mimeType
      ) {
        await ctx.storage.delete(a.storageId);
        return true;
      }
      if (
        old.storageId !== a.storageId &&
        (await isIssueStudioFileReferenced(new Store(ctx), a.path))
      )
        throw new Error(
          "This file is retained by an Issue Studio revision. Upload the replacement with a new file path.",
        );
      await ctx.db.replace(old._id, doc);
      if (old.storageId !== a.storageId)
        await ctx.storage.delete(old.storageId);
    } else await ctx.db.insert("storedFiles", doc);
    const s = new Store(ctx);
    for (const attachment of await s.by("attachments", "filePath", a.path))
      await syncIssueStudioArticle(s, attachment.articleId);
    return true;
  },
});
export const info = query({
  args: { secret: v.string(), path: v.string() },
  handler: async (ctx, a) => {
    requireServer(a.secret);
    validateFilePath(a.path);
    const file = await ctx.db
      .query("storedFiles")
      .withIndex("by_path", (q) => q.eq("path", a.path))
      .unique();
    return file
      ? {
          path: file.path,
          size: file.size,
          mimeType: file.mimeType,
          sha256: file.sha256 || null,
          url: await ctx.storage.getUrl(file.storageId),
        }
      : null;
  },
});
export const remove = mutation({
  args: { secret: v.string(), path: v.string() },
  handler: async (ctx, a) => {
    requireServer(a.secret);
    validateFilePath(a.path);
    if (
      await ctx.db
        .query("attachments")
        .withIndex("by_filePath", (q) => q.eq("filePath", a.path))
        .first()
    )
      throw new Error("File is still referenced by an attachment");
    if (await isIssueStudioFileReferenced(new Store(ctx), a.path))
      throw new Error("File is retained by an Issue Studio plan or revision");
    const f = await ctx.db
      .query("storedFiles")
      .withIndex("by_path", (q) => q.eq("path", a.path))
      .unique();
    if (f) {
      await ctx.storage.delete(f.storageId);
      await ctx.db.delete(f._id);
    }
    return true;
  },
});
export const discardUpload = mutation({
  args: { secret: v.string(), storageId: v.id("_storage") },
  handler: async (ctx, a) => {
    requireServer(a.secret);
    const stored = await ctx.db.query("storedFiles").take(1001);
    const inUse =
      stored.length > 1000 || stored.some((f) => f.storageId === a.storageId);
    if (!inUse) await ctx.storage.delete(a.storageId);
  },
});
