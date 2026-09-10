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
