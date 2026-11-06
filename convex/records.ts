import { query, mutation } from "./_generated/server";
import { v } from "convex/values";
import { Store } from "./lib/store";
import { requireServer } from "./lib/auth";
import { tableNames, type TableName } from "../shared/model";
import { toWire, fromWire } from "../shared/codec";
import {
  syncIssueStudioArticle,
  invalidateIssueStudioMetadata,
} from "./operations/issueStudio";
import { studioTableNames } from "../shared/issue-studio";

// Legacy imports use this bridge. Backup restoration deliberately restores the
// complete snapshot through backup.restore instead, without creating new plans.
async function syncStudioRecord(
  s: Store,
  name: TableName,
  row: any,
  previous?: any,
) {
  if (name === "articles")
    await syncIssueStudioArticle(s, row.id, previous?.issueId);
  else if (name === "attachments") {
    if (previous?.articleId && previous.articleId !== row.articleId)
      await syncIssueStudioArticle(s, previous.articleId);
    await syncIssueStudioArticle(s, row.articleId);
  } else if (
    name === "authors" &&
    previous &&
    (previous.givenName !== row.givenName || previous.surname !== row.surname)
  )
    for (const article of await s.by("articles", "authorId", row.id))
      await syncIssueStudioArticle(s, article.id);
  else if (
    name === "issues" &&
    previous &&
    (previous.title !== row.title ||
      previous.issueNumber !== row.issueNumber ||
      previous.releaseDate?.getTime() !== row.releaseDate?.getTime())
  )
    await invalidateIssueStudioMetadata(s, row.id);
  else if (
    name === "volumes" &&
    previous &&
    (previous.volumeNumber !== row.volumeNumber || previous.year !== row.year)
  )
    for (const issue of await s.by("issues", "volumeId", row.id))
      await invalidateIssueStudioMetadata(s, issue.id);
}
function table(value: string): TableName {
  if (!(tableNames as readonly string[]).includes(value))
    throw new Error("Unknown table");
  return value as TableName;
}
function writableTable(value: string): TableName {
  const name = table(value);
  if ((studioTableNames as readonly string[]).includes(name))
    throw new Error(
      "Issue Studio records must be edited through the revision-checked studio API",
    );
  return name;
}
export const list = query({
  args: { secret: v.string(), table: v.string() },
  handler: async (ctx, a) => {
    requireServer(a.secret);
    return toWire(await new Store(ctx).all(table(a.table)));
  },
});
export const get = query({
  args: { secret: v.string(), table: v.string(), id: v.string() },
  handler: async (ctx, a) => {
    requireServer(a.secret);
    return toWire(await new Store(ctx).get(table(a.table), a.id));
  },
});
export const insert = mutation({
  args: { secret: v.string(), table: v.string(), data: v.any() },
  handler: async (ctx, a) => {
    requireServer(a.secret);
    const s = new Store(ctx),
      name = writableTable(a.table);
    const row = await s.insert(name, fromWire(a.data));
    await syncStudioRecord(s, name, row);
    return toWire(row);
  },
});
export const patch = mutation({
  args: {
    secret: v.string(),
    table: v.string(),
    id: v.string(),
    data: v.any(),
  },
  handler: async (ctx, a) => {
    requireServer(a.secret);
    const s = new Store(ctx),
      name = writableTable(a.table);
    const previous = await s.require(name, a.id);
    const row = await s.patch(name, a.id, fromWire(a.data));
    await syncStudioRecord(s, name, row, previous);
    return toWire(row);
  },
});
