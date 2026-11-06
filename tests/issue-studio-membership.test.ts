import { convexTest } from "convex-test";
import { beforeEach, expect, test, vi } from "vitest";
import schema from "../convex/schema";
import { api } from "../convex/_generated/api";
import { fromWire, toWire } from "../shared/codec";

const modules = import.meta.glob("../convex/**/*.{ts,js}");
const secret = "issue-membership-test-secret";
beforeEach(() => vi.stubEnv("CONVEX_SERVER_SECRET", secret));

async function setup() {
  const t = convexTest(schema, modules);
  const write = async (operation: string, data: unknown = null): Promise<any> =>
    fromWire(
      await t.mutation(api.app.write, {
        secret,
        operation,
        data: toWire(data),
      }),
    );
  const volume = (await write("createVolume", { volumeNumber: 1 })).volume;
  const first = (
    await write("createIssue", { volumeId: volume.id, issueNumber: 1 })
  ).issue;
  const second = (
    await write("createIssue", { volumeId: volume.id, issueNumber: 2 })
  ).issue;
  const rows = async (table: string) =>
    t.run(async (ctx) => ctx.db.query(table as any).collect());
  return { t, write, rows, first, second };
}
const article = {
  title: "Issue-bound article",
  authorEmail: "writer@example.test",
  authorGivenName: "News",
  authorSurname: "Writer",
};
const creationId = "cab4c6de-40ac-4365-974b-5f59e3133974";

test("create-and-assign retries keep one article and one planning member", async () => {
  const { write, rows, first } = await setup();
  const input = { ...article, issueId: first.id, creationId };
  const created = await write("createArticle", input);
  const retried = await write("createArticle", input);
  expect(retried.articleId).toBe(created.articleId);
  expect(await rows("articles")).toHaveLength(1);
  const placements = await rows("issuePlacements");
  expect(placements).toHaveLength(1);
  expect(placements[0]).toMatchObject({
    issueId: first.id,
    articleId: created.articleId,
  });
  expect((await rows("articles"))[0]).toMatchObject({
    issueId: first.id,
    volume: 1,
    issue: 1,
  });
  await expect(
    write("createArticle", { ...input, title: "Different request" }),
  ).rejects.toThrow("different request");
  await expect(
    write("createArticle", { ...article, issueId: "missing-issue" }),
  ).rejects.toThrow();
  expect(await rows("articles")).toHaveLength(1);
});

test("reassignment and removal update both issues without duplicate members", async () => {
  const { write, rows, first, second } = await setup();
  const { articleId } = await write("createArticle", {
    ...article,
    issueId: first.id,
  });
  await write("updateArticleIssue", { articleId, issueId: second.id });
  await write("updateArticleIssue", { articleId, issueId: second.id });
  expect(await rows("issuePlacements")).toEqual([
    expect.objectContaining({ issueId: second.id, articleId }),
  ]);
  await write("updateArticleIssue", { articleId, issueId: null });
  expect(await rows("issuePlacements")).toHaveLength(0);
  const retained = (await rows("articles"))[0];
  expect(retained).toMatchObject({ issueId: null, volume: null, issue: null });
});

test("administrative edits leave studio revision stable while source edits invalidate it", async () => {
  const { write, rows, first } = await setup();
  const { articleId } = await write("createArticle", {
    ...article,
    issueId: first.id,
  });
  const revision = (await rows("issueDesignPlans"))[0].revision;
  await write("updateArticleTier", { articleId, tier: "Tier 3 (Advanced)" });
  await write("updateArticleStatus", { articleId, status: "Approved" });
  expect((await rows("issueDesignPlans"))[0].revision).toBe(revision);
  await write("updateArticleContent", {
    articleId,
    content: "Revised complete copy.",
  });
  expect((await rows("issueDesignPlans"))[0].revision).toBeGreaterThan(
    revision,
  );
  const revised = (await rows("issueDesignPlans"))[0].revision;
  await write("updateArticleContent", {
    articleId,
    content: "Revised complete copy.",
  });
  expect((await rows("issueDesignPlans"))[0].revision).toBe(revised);
});

test("legacy record imports and direct patches maintain studio membership", async () => {
  const { t, rows, first, second } = await setup();
  const importedAuthor: any = fromWire(
    await t.mutation(api.records.insert, {
      secret,
      table: "authors",
      data: toWire({
        email: "import@example.test",
        givenName: "Import",
        surname: "Writer",
      }),
    }),
  );
  const imported: any = fromWire(
    await t.mutation(api.records.insert, {
      secret,
      table: "articles",
      data: toWire({
        title: "Imported article",
        authorId: importedAuthor.id,
        issueId: first.id,
      }),
    }),
  );
  expect(await rows("issuePlacements")).toEqual([
    expect.objectContaining({ articleId: imported.id, issueId: first.id }),
  ]);
  await t.mutation(api.records.patch, {
    secret,
    table: "articles",
    id: imported.id,
    data: toWire({ issueId: second.id }),
  });
  expect(await rows("issuePlacements")).toEqual([
    expect.objectContaining({ articleId: imported.id, issueId: second.id }),
  ]);
});

test("deleting an article or issue clears live studio records", async () => {
  const { write, rows, first, second } = await setup();
  const { articleId } = await write("createArticle", {
    ...article,
    issueId: first.id,
  });
  await write("deleteArticle", articleId);
  expect(await rows("issuePlacements")).toHaveLength(0);
  await write("createArticle", { ...article, issueId: second.id });
  await write("deleteIssue", { id: second.id });
  expect(await rows("issuePlacements")).toHaveLength(0);
  expect(
    (await rows("issueDesignPlans")).some((p: any) => p.issueId === second.id),
  ).toBe(false);
  expect((await rows("articles"))[0]).toMatchObject({
    issueId: null,
    volume: null,
    issue: null,
  });
});

test("generic record writes cannot bypass studio revision checks", async () => {
  const { t, write, rows, first } = await setup();
  await write("createArticle", { ...article, issueId: first.id });
  const plan = (await rows("issueDesignPlans"))[0];
  await expect(
    t.mutation(api.records.patch, {
      secret,
      table: "issueDesignPlans",
      id: plan.id,
      data: toWire({ pageBudget: 100 }),
    }),
  ).rejects.toThrow("revision-checked");
  await expect(
    t.mutation(api.records.insert, {
      secret,
      table: "issueDesignRevisions",
      data: {},
    }),
  ).rejects.toThrow("revision-checked");
});

test("public author edits invalidate print while payment metadata does not", async () => {
  const { write, rows, first } = await setup();
  const { articleId } = await write("createArticle", {
    ...article,
    issueId: first.id,
  });
  const authorId = (await rows("articles"))[0].authorId;
  const initial = (await rows("issueDesignPlans"))[0].revision;
  await write("updateAuthorPaymentInfo", {
    authorId,
    etransferEmail: "pay@example.test",
  });
  expect((await rows("issueDesignPlans"))[0].revision).toBe(initial);
  await write("updateAuthorPaymentInfo", { authorId, givenName: "Updated" });
  expect((await rows("issueDesignPlans"))[0].revision).toBeGreaterThan(initial);
  await write("updateArticle", { articleId, prefersAnonymity: true });
  const anonymous = (await rows("issueDesignPlans"))[0].revision;
  await write("updateAuthorPaymentInfo", { authorId, surname: "Changed" });
  expect((await rows("issueDesignPlans"))[0].revision).toBe(anonymous);
});

test("publication metadata invalidates exact output revisions while descriptions do not", async () => {
  const { t, write, rows, first } = await setup();
  await write("createArticle", { ...article, issueId: first.id });
  const revision = (await rows("issueDesignPlans"))[0].revision;
  await write("updateIssue", {
    id: first.id,
    description: "Administrative note",
  });
  expect((await rows("issueDesignPlans"))[0].revision).toBe(revision);
  await write("updateIssue", {
    id: first.id,
    title: "Current print issue",
    releaseDate: "2026-11-01",
  });
  const renamed = (await rows("issueDesignPlans"))[0].revision;
  expect(renamed).toBeGreaterThan(revision);
  const volume = (await rows("volumes"))[0];
  await write("updateVolume", { id: volume.id, year: 2027 });
  const yearChanged = (await rows("issueDesignPlans"))[0].revision;
  expect(yearChanged).toBeGreaterThan(renamed);
  await t.mutation(api.records.patch, {
    secret,
    table: "issues",
    id: first.id,
    data: toWire({ issueNumber: 7 }),
  });
  expect((await rows("issueDesignPlans"))[0].revision).toBeGreaterThan(
    yearChanged,
  );
  const snapshots = await rows("issueDesignRevisions");
  const latest = snapshots
    .map((row: any) => JSON.parse(row.snapshot))
    .sort((a: any, b: any) => b.revision - a.revision)[0];
  expect(latest.issue).toMatchObject({
    title: "Current print issue",
    issueNumber: 7,
  });
  expect(latest.volume).toMatchObject({ year: 2027 });
});
