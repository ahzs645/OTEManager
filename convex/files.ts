import { query, mutation } from "./_generated/server";
import { v } from "convex/values";
import { requireServer } from "./lib/auth";
import { validateFilePath } from "../shared/file-path";
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
      await ctx.db.replace(old._id, doc);
      if (old.storageId !== a.storageId)
        await ctx.storage.delete(old.storageId);
    } else await ctx.db.insert("storedFiles", doc);
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
    const inUse = (await ctx.db.query("storedFiles").collect()).some(
      (f) => f.storageId === a.storageId,
    );
    if (!inUse) await ctx.storage.delete(a.storageId);
  },
});
