import { convexTest } from "convex-test";
import { beforeEach, expect, test, vi } from "vitest";
import schema from "../convex/schema";
import { api } from "../convex/_generated/api";
import { toWire, fromWire } from "../shared/codec";
import { normalizeRecord } from "../shared/records";
import { tableNames } from "../shared/model";
const modules = import.meta.glob("../convex/**/*.{ts,js}");
const secret = "isolated-test-secret";
beforeEach(() => vi.stubEnv("CONVEX_SERVER_SECRET", secret));
function setup() {
  const t = convexTest(schema, modules);
  return {
    t,
    write: async (operation: string, data?: any) =>
      fromWire(
        await t.mutation(api.app.write, {
          secret,
          operation,
          data: toWire(data),
        }),
      ),
    read: async (operation: string, data?: any) =>
      fromWire(
        await t.query(api.app.read, { secret, operation, data: toWire(data) }),
      ),
  };
}
const input = (title = "Test article") => ({
  title,
  authorEmail: "writer@example.test",
  authorGivenName: "Test",
  authorSurname: "Writer",
});

test("requires the application server secret on reads, writes and file uploads", async () => {
  const { t } = setup();
  await expect(t.query(api.app.health, { secret: "wrong" })).rejects.toThrow(
    "Unauthorized",
  );
  await expect(
    t.mutation(api.files.uploadUrl, { secret: "wrong" }),
  ).rejects.toThrow("Unauthorized");
  await expect(
    t.mutation(api.records.insert, {
      secret: "wrong",
      table: "authors",
      data: {},
    }),
  ).rejects.toThrow("Unauthorized");
});

test("creates related records atomically and records status transitions", async () => {
  const { write, read } = setup();
  const a = await write("createArticle", input());
  await write("createArticle", {
    ...input("Another"),
    authorEmail: "WRITER@example.test",
  });
  expect((await read("getAuthors")).authors).toHaveLength(1);
  await write("updateArticleStatus", {
    articleId: a.articleId,
    status: "Approved",
    changedBy: "Editor",
  });
  const article = (await read("getArticleById", { id: a.articleId })).article;
  expect(article.internalStatus).toBe("Approved");
  expect(article.createdAt).toBeInstanceOf(Date);
  expect(article.statusHistory).toHaveLength(2);
  await expect(
    write("updateArticleStatus", { articleId: a.articleId, status: "INVALID" }),
  ).rejects.toThrow();
  expect(
    (await read("getArticleById", { id: a.articleId })).article.statusHistory,
  ).toHaveLength(2);
});

test("preserves completed payment amounts when flags or rates change", async () => {
  const { write, read } = setup();
  const { articleId } = await write("createArticle", input());
  const result = await write("calculateArticlePayment", { articleId });
  expect(result.calculation.totalAmount).toBe(2000);
  await write("markPaymentComplete", { articleId, amount: 2000 });
  await write("updateArticleBonusFlags", { articleId, hasResearchBonus: true });
  expect(
    (await read("getArticleById", { id: articleId })).article.paymentAmount,
  ).toBe(2000);
  await expect(
    write("calculateArticlePayment", { articleId, recalculate: true }),
  ).rejects.toThrow("completed");
  await expect(
    write("setManualPayment", { articleId, amount: 5000 }),
  ).rejects.toThrow("Completed");
});

test("moving directly to Published acknowledges approval and keeps payment independent of editorial status", async () => {
  const { write, read } = setup();
  const { articleId } = await write("createArticle", input());
  await write("updateArticleStatus", { articleId, status: "Published" });
  expect((await read("getUnpaidArticlesPage")).articles.map((a: any) => a.id)).toEqual([articleId]);
  const article = (await read("getArticleById", { id: articleId })).article;
  expect(article.internalStatus).toBe("Published");
  expect(article.paymentStatus).toBe(false);
  expect(article.statusHistory).toEqual(expect.arrayContaining([
    expect.objectContaining({ fromStatus: "Draft", toStatus: "Published" }),
  ]));
  await write("updateArticleStatus", { articleId, status: "Needs Revision" });
  expect((await read("getUnpaidArticlesPage")).articles).toEqual([]);
  await write("updateArticleStatus", { articleId, status: "Approved" });
  await write("createArticle", input("Another article"));
  const other = (await read("getArticles", { search: "Another article" })).articles[0];
  await write("updateArticleStatus", { articleId: other.id, status: "Published" });
  expect(await read("getDashboardStats")).toMatchObject({ approved: 1, published: 1 });
  await write("markPaymentComplete", { articleId, amount: 2000 });
  await write("updateArticleStatus", { articleId, status: "Published" });
  expect((await read("getUnpaidArticlesPage")).articles.map((a: any) => a.id)).toEqual([other.id]);
});

test("payment reports and drill-downs consistently treat imported null payment flags as unpaid", async () => {
  const { t, write, read } = setup();
  for (const [title, paymentStatus, paymentAmount] of [["Null", null, 3500], ["False", false, 2000], ["Paid", true, 5000]] as const) {
    const { articleId } = await write("createArticle", input(title));
    await t.mutation(api.records.patch, {
      secret, table: "articles", id: articleId,
      data: toWire({ internalStatus: "Published", paymentStatus, paymentAmount }),
    });
  }
  const breakdown = { paid: { count: 1, amount: 5000 }, unpaid: { count: 2, amount: 5500 } };
  expect(await read("getPaymentStats")).toMatchObject({ paidCount: 1, unpaidCount: 2, unpaidAmount: 5500 });
  expect(await read("getPaymentStatusBreakdown")).toEqual(breakdown);
  const all = await read("getAllAnalyticsWithCrossFilter");
  expect(all.paymentStats).toMatchObject({ unpaidCount: 2, unpaidAmount: 5500 });
  expect(all.statusBreakdown).toEqual(breakdown);
  const filtered = await read("getAllAnalyticsWithCrossFilter", { crossFilter: { paymentStatus: false } });
  expect(filtered.statusBreakdown).toEqual({ paid: { count: 0, amount: 0 }, unpaid: breakdown.unpaid });
  expect((await read("getArticlesByPaymentStatus", { paid: false })).articles.map((a: any) => a.title).sort()).toEqual(["False", "Null"]);
});

test("sorts before pagination and includes the final day of analytics filters", async () => {
  const { write, read, t } = setup();
  await write("createArticle", input("Zulu"));
  await write("createArticle", input("Alpha"));
  const result = await read("getArticles", {
    page: 1,
    limit: 1,
    sortBy: "title",
    sortOrder: "asc",
  });
  expect(result.articles[0].title).toBe("Alpha");
  expect(result.total).toBe(2);
  const a = result.articles[0];
  await t.mutation(api.records.patch, {
    secret,
    table: "articles",
    id: a.id,
    data: toWire({
      paymentStatus: true,
      paymentAmount: 1200,
      paidAt: new Date("2026-09-10T23:59:59.000Z"),
    }),
  });
  expect(
    (
      await read("getPaymentStats", {
        startDate: "2026-09-10",
        endDate: "2026-09-10",
      })
    ).paidCount,
  ).toBe(1);
});

test("keeps a shared file until its last attachment is deleted", async () => {
  const { t, write, read } = setup();
  const { articleId } = await write("createArticle", input());
  const storageId = await t.run((ctx) =>
    ctx.storage.store(new Blob(["shared"])),
  );
  await t.mutation(api.files.finalize, {
    secret,
    path: "shared.txt",
    storageId,
    size: 6,
    mimeType: "text/plain",
  });
  const make = () =>
    write("addAttachment", {
      articleId,
      attachmentType: "other",
      fileName: "shared.txt",
      originalFileName: "shared.txt",
      filePath: "shared.txt",
      fileSize: 6,
      mimeType: "text/plain",
    });
  const a = await make(),
    b = await make();
  await write("deleteAttachment", { attachmentId: a.attachment.id });
  expect(
    await t.query(api.files.info, { secret, path: "shared.txt" }),
  ).not.toBeNull();
  await write("deleteAttachment", { attachmentId: b.attachment.id });
  expect(
    await t.query(api.files.info, { secret, path: "shared.txt" }),
  ).toBeNull();
});

test("photos are included in exports by default and the selection can be changed", async () => {
  const { t, write, read } = setup();
  const { articleId } = await write("createArticle", input());
  const photo = (name: string) => ({
    articleId,
    attachmentType: "photo",
    fileName: name,
    originalFileName: name,
    filePath: name,
  });
  const { attachment } = await write("addAttachment", photo("new.jpg"));
  expect(attachment.includeInExport).toBe(true);
  // Rows written before the flag existed have no value at all
  await t.run((ctx) =>
    ctx.db.insert("attachments", {
      id: "legacy-photo",
      ...photo("legacy.jpg"),
      fileSize: null,
      mimeType: null,
      caption: null,
      photoNumber: 2,
      createdAt: Date.now(),
    } as any),
  );
  await write("setAttachmentsIncludeInExport", {
    attachmentIds: [attachment.id, "legacy-photo"],
    includeInExport: false,
  });
  const { article } = await read("getArticleById", { id: articleId });
  expect(
    article.attachments.map((a: any) => [a.fileName, a.includeInExport]),
  ).toEqual([
    ["new.jpg", false],
    ["legacy.jpg", false],
  ]);
});

test("recent submissions follow the submission date, not the import date", async () => {
  const { write, read } = setup();
  const submit = (title: string, submittedAt: string) =>
    write("submitArticle", {
      title,
      articleTier: "Tier 1 (Basic)",
      author: { givenName: "Test", surname: "Writer", email: "writer@example.test" },
      submittedAt: new Date(submittedAt),
    });
  // Imported in the opposite order to when they were submitted
  await submit("Newest", "2026-09-25T12:00:00Z");
  await submit("Oldest", "2026-01-10T12:00:00Z");
  const { articles } = await read("getRecentArticles");
  expect(articles.map((a: any) => a.title)).toEqual(["Newest", "Oldest"]);
});

test("the In Progress filter and stat cover every status between review and approval", async () => {
  const { write, read } = setup();
  for (const [title, status] of [
    ["Reviewing", "In Review"],
    ["Revising", "Needs Revision"],
    ["Done", "Approved"],
  ]) {
    const { articleId } = await write("createArticle", input(title));
    await write("updateArticleStatus", { articleId, status });
  }
  const { articles } = await read("getArticles", { status: "In Progress" });
  expect(articles.map((a: any) => a.title).sort()).toEqual([
    "Reviewing",
    "Revising",
  ]);
  const stats = await read("getDashboardStats");
  expect([stats.inProgress, stats.approved]).toEqual([2, 1]);
});

test("article search matches titles and author names", async () => {
  const { write, read } = setup();
  await write("createArticle", input("Bears in winter"));
  const titles = async (search: string) =>
    (await read("getArticles", { search })).articles.map((a: any) => a.title);
  expect(await titles("bears")).toEqual(["Bears in winter"]);
  expect(await titles("test writer")).toEqual(["Bears in winter"]);
  expect(await titles("writer bears")).toEqual(["Bears in winter"]);
  expect(await titles("salami")).toEqual([]);
});

test("deleting a volume unassigns articles and removing an article removes its children", async () => {
  const { write, read } = setup();
  const { articleId } = await write("createArticle", input());
  const { volume } = await write("createVolume", { volumeNumber: 7 });
  const { issue } = await write("createIssue", {
    volumeId: volume.id,
    issueNumber: 2,
  });
  await write("updateArticleIssue", { articleId, issueId: issue.id });
  const { note } = await write("addArticleNote", {
    articleId,
    content: "Editorial note",
  });
  await write("updateArticleNote", { noteId: note.id, content: "Updated" });
  await write("deleteVolume", { id: volume.id });
  expect(
    (await read("getArticleById", { id: articleId })).article.issueId,
  ).toBeNull();
  await write("deleteArticle", articleId);
  expect((await read("getArticleById", { id: articleId })).article).toBeNull();
});

test("saved views have at most one default and merging rejects deleting the kept article", async () => {
  const { write, read } = setup();
  await write("createSavedView", {
    name: "First",
    config: {},
    setAsDefault: true,
  });
  const b = await write("createSavedView", {
    name: "Second",
    config: {},
    setAsDefault: true,
  });
  expect((await read("getDefaultView")).view.id).toBe(b.view.id);
  expect(
    (await read("getSavedViews")).views.filter((v: any) => v.isDefault),
  ).toHaveLength(1);
  const a = await write("createArticle", input());
  await expect(
    write("mergeArticles", { keepId: a.articleId, deleteIds: [a.articleId] }),
  ).rejects.toThrow("kept");
});

test("validates a backup before replace and merge is idempotent", async () => {
  const { t, write, read } = setup();
  await write("createArticle", input());
  const current = await t.query(api.backup.exportData, { secret });
  const bad = structuredClone(current);
  bad.data.articles[0].authorId = "missing";
  await expect(
    t.mutation(api.backup.restore, { secret, manifest: bad, mode: "replace" }),
  ).rejects.toThrow("missing author");
  expect((await read("getDashboardStats")).totalArticles).toBe(1);
  const result = await t.mutation(api.backup.restore, {
    secret,
    manifest: current,
    mode: "merge",
  });
  expect(result.articles).toEqual({ imported: 0, skipped: 1 });
});
