// @vitest-environment node
import { convexTest } from "convex-test";
import { beforeEach, expect, test, vi } from "vitest";
import schema from "../convex/schema";
import { api } from "../convex/_generated/api";
import { fromWire, toWire } from "../shared/codec";
import { parseManifest, validateSnapshot } from "../shared/backup";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import originals from "./fixtures/source-archive-originals.json";

const modules = import.meta.glob("../convex/**/*.{ts,js}");
const secret = "isolated-source-import-test";
beforeEach(() => vi.stubEnv("CONVEX_SERVER_SECRET", secret));

function sourceFixture() {
  const file = (path: string, letter = "a") => ({
    path,
    sha256: letter.repeat(64),
  });
  const placement = (documentId: string, pageNumbers = [13]) => ({
    documentId,
    pageNumbers,
    section: "News",
  });
  const article = (sourceKey: string, extra: Record<string, unknown> = {}) => ({
    sourceKey,
    title: "A recovered campus article",
    authorName: "Caleb Mueller",
    content:
      "Complete original paragraph.\n\nA second paragraph survives import.",
    bodyFormat: "markdown",
    kind: "article",
    placements: [placement("dec-final"), placement("dec-archive")],
    provenance: [file("source-idml/december.idml")],
    photos: [],
    ...extra,
  });
  return {
    schemaVersion: "ote.source-archive.v1",
    archiveId: "isolated-original-archive",
    issues: [
      {
        documentId: "dec-final",
        label: "December final",
        volumeNumber: 31,
        issueNumber: 4,
        releaseDate: "2024-12-05",
        pageCount: 17,
        source: file("originals/dec-final.pdf"),
      },
      {
        documentId: "dec-archive",
        label: "December alternate archive",
        volumeNumber: 31,
        issueNumber: 4,
        releaseDate: null,
        pageCount: 17,
        source: file("originals/dec-archive.pdf", "b"),
      },
    ],
    articles: [
      article("original-a", {
        originalArticleId: "original-a",
        authorSourceId: "source-caleb",
        prefersAnonymity: false,
        originalDates: {
          submittedAt: "2024-12-02T07:15:00.000Z",
          createdAt: "2024-12-01T10:00:00.000Z",
          updatedAt: "2024-12-04T18:30:00.000Z",
        },
      }),
      article("original-b", {
        originalArticleId: "original-b",
        authorSourceId: "source-caleb",
        content: "",
        recoveryStatus: "metadata-only",
      }),
      article("editorial-lina", {
        title: "Original editorial",
        kind: "editorial",
        authorName: "Lina Maksymova",
        authorSourceId: "source-lina",
        placements: [placement("dec-archive", [2])],
      }),
      article("unattributed", {
        title: "An article without a recorded author",
        authorName: null,
        placements: [placement("dec-final", [3])],
      }),
      article("president-panel", {
        title: "President question",
        kind: "recurring",
      }),
      article("photo-feature", {
        title: "Campus photographs",
        kind: "photo-feature",
      }),
      article("empty-reservation", {
        title: "Unfilled article reservation",
        kind: "placeholder",
        content: "",
      }),
    ],
    assets: [],
    coverage: { sourceDocumentCount: 2 },
  };
}

function setup() {
  const t = convexTest(schema, modules);
  const read = async (operation: string, data: any = {}) =>
    fromWire(
      await t.query(api.app.read, { secret, operation, data: toWire(data) }),
    );
  const write = async (operation: string, data: any = {}) =>
    fromWire(
      await t.mutation(api.app.write, {
        secret,
        operation,
        data: toWire(data),
      }),
    );
  const list = async (table: string) =>
    fromWire(await t.query(api.records.list, { secret, table }));
  const insert = async (table: string, data: any) =>
    fromWire(
      await t.mutation(api.records.insert, {
        secret,
        table,
        data: toWire(data),
      }),
    );
  const preview = (bundle: any, documentIds?: string[]) =>
    read("previewSourceArchive", { bundle, documentIds });
  const importBundle = async (bundle: any, documentIds?: string[]) => {
    const review = await preview(bundle, documentIds);
    return write("importSourceArchive", {
      bundle,
      documentIds,
      previewToken: review.previewToken,
    });
  };
  return { t, read, write, list, insert, preview, importBundle };
}

test("source preview changes no records and import requires its current review token", async () => {
  const s = setup(),
    bundle = sourceFixture();
  const review = await s.preview(bundle);
  expect(review.summary).toMatchObject({
    documents: 2,
    publications: 1,
    eligible: 4,
    create: 4,
    excluded: 3,
    missingBodies: 1,
  });
  expect(typeof review.previewToken).toBe("string");
  for (const table of ["articles", "authors", "issues", "volumes"])
    expect(await s.list(table)).toEqual([]);
  await expect(
    s.write("importSourceArchive", {
      bundle,
      previewToken: "different-review",
    }),
  ).rejects.toThrow();
  expect(await s.list("articles")).toEqual([]);
  await s.write("importSourceArchive", {
    bundle,
    previewToken: review.previewToken,
  });
  expect(await s.list("articles")).toHaveLength(4);
});

test("repeated import preserves distinct original IDs, missing bodies and unknown financial metadata", async () => {
  const s = setup(),
    bundle = sourceFixture();
  await s.importBundle(bundle);
  const first = await s.list("articles"),
    authors = await s.list("authors");
  expect(first).toHaveLength(4);
  expect(await s.list("volumes")).toHaveLength(1);
  expect(await s.list("issues")).toHaveLength(1);
  expect(authors).toHaveLength(3);
  expect(
    authors.every((a: any) => a.email === "" && a.authorType === null),
  ).toBe(true);
  for (const article of first) {
    expect(article).toMatchObject({
      internalStatus: "Archived",
      articleTier: null,
      paymentStatus: null,
      paymentAmount: null,
      paidAt: null,
      paymentRateSnapshot: null,
      paymentCalculatedAt: null,
      paymentIsManual: null,
      hasResearchBonus: null,
      hasTimeSensitiveBonus: null,
      hasMultimediaBonus: null,
      hasProfessionalPhotos: null,
      hasProfessionalGraphics: null,
    });
    expect(JSON.parse(article.sourceProvenance).originalAuthorName).toBe(
      bundle.articles.find(
        (a) => a.sourceKey === JSON.parse(article.sourceProvenance).sourceKey,
      )?.authorName,
    );
  }
  const empty = first.find(
    (a: any) =>
      JSON.parse(a.sourceProvenance).originalArticleId === "original-b",
  );
  expect(empty.content).toBeNull();
  expect(JSON.parse(empty.sourceProvenance).recoveryStatus).toBe(
    "metadata-only",
  );
  const withBody = first.find(
    (a: any) =>
      JSON.parse(a.sourceProvenance).originalArticleId === "original-a",
  );
  expect(withBody.id).not.toBe(empty.id);
  expect(withBody.content).toBe(bundle.articles[0].content);
  const counts = await Promise.all(
    [
      "articles",
      "authors",
      "issues",
      "volumes",
      "articleNotes",
      "statusHistory",
    ].map(async (table) => (await s.list(table)).length),
  );
  const repeat = await s.preview(bundle);
  expect(repeat.summary).toMatchObject({
    create: 0,
    existing: 4,
    conflicts: 0,
  });
  await s.write("importSourceArchive", {
    bundle,
    previewToken: repeat.previewToken,
  });
  expect(
    await Promise.all(
      [
        "articles",
        "authors",
        "issues",
        "volumes",
        "articleNotes",
        "statusHistory",
      ].map(async (table) => (await s.list(table)).length),
    ),
  ).toEqual(counts);
  expect(await s.list("articles")).toEqual(first);
  expect(await s.list("authors")).toEqual(authors);
  expect((await s.read("getUnpaidArticlesPage")).articles).toEqual([]);
  const search = await s.read("getArticles", { search: "Caleb Mueller" });
  expect(search.articles).toHaveLength(2);
});

test("archive variants share one publication and retain reviewed source order independent of import order", async () => {
  const bundle = sourceFixture(),
    one = setup(),
    two = setup();
  await one.importBundle(bundle, ["dec-final"]);
  await one.importBundle(bundle, ["dec-archive"]);
  await two.importBundle(bundle, ["dec-archive"]);
  await two.importBundle(bundle, ["dec-final"]);
  const articles = (rows: any[]) =>
    rows
      .map((a) => [a.id, a.title, a.content, a.issueId])
      .sort((a, b) => String(a[0]).localeCompare(String(b[0])));
  expect(articles(await one.list("articles"))).toEqual(
    articles(await two.list("articles")),
  );
  for (const s of [one, two]) {
    const issues = await s.list("issues");
    expect(issues).toHaveLength(1);
    expect(issues[0].releaseDate?.toISOString().slice(0, 10)).toBe(
      "2024-12-05",
    );
    expect(await s.list("articles")).toHaveLength(4);
  }
});

test("verified original submission dates are retained while unknown IDML dates remain empty", async () => {
  const s = setup(),
    bundle = sourceFixture();
  await s.importBundle(bundle);
  const articles = await s.list("articles");
  const original = articles.find(
    (a: any) =>
      JSON.parse(a.sourceProvenance).originalArticleId === "original-a",
  );
  expect(original.submittedAt).toEqual(new Date("2024-12-02T07:15:00.000Z"));
  expect(original.createdAt).not.toEqual(new Date("2024-12-01T10:00:00.000Z"));
  expect(original.prefersAnonymity).toBe(false);
  expect(JSON.parse(original.sourceProvenance).originalDates).toEqual(
    bundle.articles[0].originalDates,
  );
  const idml = articles.find(
    (a: any) => JSON.parse(a.sourceProvenance).sourceKey === "editorial-lina",
  );
  expect(idml.submittedAt).toBeNull();
  expect(idml.prefersAnonymity).toBeNull();
});

test("original legacy identity links provenance without replacing edited content, payment or publication records", async () => {
  const s = setup(),
    bundle = sourceFixture();
  await s.insert("authors", {
    id: "source-caleb",
    givenName: "Current",
    surname: "Writer",
    email: "current@example.test",
    authorType: "Student",
    autoDepositAvailable: true,
  });
  await s.insert("volumes", {
    id: "existing-volume",
    volumeNumber: 31,
    description: "Editor maintained volume",
  });
  await s.insert("issues", {
    id: "existing-issue",
    volumeId: "existing-volume",
    issueNumber: 4,
    title: "Editor maintained issue",
    releaseDate: new Date("2026-01-02T00:00:00Z"),
  });
  const live = await s.insert("articles", {
    id: "original-a",
    title: "Edited current title",
    authorId: "source-caleb",
    content: "Editor corrected this body.",
    internalStatus: "Published",
    automationStatus: "Completed",
    issueId: "existing-issue",
    volume: 31,
    issue: 4,
    paymentStatus: true,
    paymentAmount: 4321,
    paymentIsManual: true,
    paidAt: new Date("2026-09-10T12:00:00Z"),
    paymentBankReference: "test-bank-reference",
    paymentReceipt: "test-receipt",
    submittedAt: new Date("2025-01-10T15:30:00Z"),
    paymentRateSnapshot: '{"manual":4321}',
    hasResearchBonus: true,
  });
  const issue = (await s.list("issues"))[0],
    author = (await s.list("authors"))[0];
  const preview = await s.preview(bundle);
  expect(
    preview.articles.find((a: any) => a.sourceKey === "original-a"),
  ).toMatchObject({ action: "link", articleId: "original-a" });
  await s.write("importSourceArchive", {
    bundle,
    previewToken: preview.previewToken,
  });
  const after = (await s.list("articles")).find((a: any) => a.id === live.id);
  for (const [key, value] of Object.entries(live))
    if (key !== "updatedAt" && !key.startsWith("source"))
      expect(after[key], key).toEqual(value);
  expect(after.sourceProvenance).toBeTruthy();
  const importedIssue = (await s.list("issues"))[0];
  for (const [key, value] of Object.entries(issue))
    if (key !== "sourceProvenance" && key !== "updatedAt")
      expect(importedIssue[key], key).toEqual(value);
  expect(
    (await s.list("authors")).find((a: any) => a.id === author.id),
  ).toEqual(author);
  const repeat = await s.preview(bundle);
  await s.write("importSourceArchive", {
    bundle,
    previewToken: repeat.previewToken,
  });
  expect(
    (await s.list("articles")).find((a: any) => a.id === "original-a"),
  ).toEqual(after);
});

test("changed source revisions are reported as conflicts and cannot replace an imported body", async () => {
  const s = setup(),
    bundle = sourceFixture();
  await s.importBundle(bundle);
  const before = await s.list("articles");
  const changed = structuredClone(bundle);
  changed.articles[0].content = "A conflicting later source revision.";
  const preview = await s.preview(changed);
  expect(
    preview.articles.find((a: any) => a.sourceKey === "original-a"),
  ).toMatchObject({ action: "conflict" });
  await s.write("importSourceArchive", {
    bundle: changed,
    previewToken: preview.previewToken,
  });
  expect(await s.list("articles")).toEqual(before);
});

test("a later recovered body fills only the exact original empty record and preserves its edited financial and workflow fields", async () => {
  const s = setup(),
    bundle = sourceFixture();
  await s.importBundle(bundle);
  const original = (await s.list("articles")).find(
    (a: any) =>
      JSON.parse(a.sourceProvenance).originalArticleId === "original-b",
  );
  await s.t.mutation(api.records.patch, {
    secret,
    table: "articles",
    id: original.id,
    data: toWire({
      title: "Editor maintained title",
      internalStatus: "Published",
      paymentStatus: true,
      paymentAmount: 7654,
      paymentIsManual: true,
      paymentReceipt: "kept-receipt",
      paidAt: new Date("2026-09-10T12:00:00Z"),
    }),
  });
  const before = (await s.list("articles")).find(
    (a: any) => a.id === original.id,
  );
  const recovered = structuredClone(bundle);
  recovered.articles[1].content =
    "The recovered original body, now available from its cited source.";
  recovered.articles[1].recoveryStatus = "complete";
  const preview = await s.preview(recovered);
  expect(
    preview.articles.find((a: any) => a.sourceKey === "original-b"),
  ).toMatchObject({
    action: "link",
    fillsMissingBody: true,
    articleId: original.id,
  });
  await s.write("importSourceArchive", {
    bundle: recovered,
    previewToken: preview.previewToken,
  });
  const after = (await s.list("articles")).find(
    (a: any) => a.id === original.id,
  );
  expect(after.content).toBe(recovered.articles[1].content);
  for (const [key, value] of Object.entries(before))
    if (!["content", "updatedAt"].includes(key) && !key.startsWith("source"))
      expect(after[key], key).toEqual(value);
  expect(await s.list("articles")).toHaveLength(4);
  const repeat = await s.preview(recovered);
  expect(repeat.summary).toMatchObject({
    create: 0,
    existing: 4,
    conflicts: 0,
  });
  await s.write("importSourceArchive", {
    bundle: recovered,
    previewToken: repeat.previewToken,
  });
  expect(
    (await s.list("articles")).find((a: any) => a.id === original.id),
  ).toEqual(after);
});

test("two different original database IDs stay distinct even when title, byline and body are identical", async () => {
  const s = setup(),
    bundle = sourceFixture();
  const duplicate = {
    ...structuredClone(bundle.articles[0]),
    sourceKey: "another-original-id",
    originalArticleId: "another-original-id",
  };
  bundle.articles = [bundle.articles[0], duplicate];
  const preview = await s.preview(bundle);
  expect(preview.summary).toMatchObject({ eligible: 2, create: 2, link: 0 });
  await s.write("importSourceArchive", {
    bundle,
    previewToken: preview.previewToken,
  });
  const articles = await s.list("articles");
  expect(articles).toHaveLength(2);
  expect(
    articles
      .map((a: any) => JSON.parse(a.sourceProvenance).originalArticleId)
      .sort(),
  ).toEqual(["another-original-id", "original-a"]);
});

test("source author records remain valid in ordinary backup export and restore validation", async () => {
  const s = setup();
  await s.importBundle(sourceFixture());
  const exported = fromWire(
    await s.t.query(api.backup.exportData, { secret, type: "database" }),
  );
  const snapshot = parseManifest(exported);
  expect(() => validateSnapshot(snapshot)).not.toThrow();
  expect(snapshot.authors.filter((a) => a.email === "")).toHaveLength(3);
  const restored = convexTest(schema, modules);
  await restored.mutation(api.backup.restore, {
    secret,
    manifest: toWire(exported),
    mode: "merge",
  });
  const articles = fromWire(
    await restored.query(api.records.list, { secret, table: "articles" }),
  );
  expect(articles).toHaveLength(4);
  const review = fromWire(
    await restored.query(api.app.read, {
      secret,
      operation: "previewSourceArchive",
      data: toWire({ bundle: sourceFixture() }),
    }),
  );
  expect(review.summary).toMatchObject({ existing: 4, create: 0, link: 0 });
});

test("unknown historical payments do not enter financial totals, while saved or paid archived amounts remain counted", async () => {
  const s = setup(),
    bundle = sourceFixture();
  await s.importBundle(bundle);
  expect(await s.read("getDashboardStats")).toMatchObject({ totalArticles: 4 });
  expect(await s.read("getPaymentStats")).toMatchObject({
    paidCount: 0,
    unpaidCount: 0,
    totalPayments: 0,
    unpaidAmount: 0,
  });
  expect(await s.read("getBonusFrequency")).toMatchObject({ totalArticles: 0 });
  expect(
    (await s.read("getAllAnalyticsWithCrossFilter")).bonusFrequency,
  ).toMatchObject({ totalArticles: 0 });
  const articles = await s.list("articles");
  for (const [index, values] of [
    [0, { paymentStatus: true, paymentAmount: 4321, hasResearchBonus: true }],
    [1, { paymentAmount: 1234 }],
  ] as const) {
    await s.t.mutation(api.records.patch, {
      secret,
      table: "articles",
      id: articles[index].id,
      data: toWire(values),
    });
  }
  await s.importBundle(bundle);
  expect(await s.read("getPaymentStats")).toMatchObject({
    paidCount: 1,
    unpaidCount: 1,
    totalPayments: 4321,
    unpaidAmount: 1234,
  });
  const bonuses = await s.read("getBonusFrequency");
  expect(bonuses.totalArticles).toBe(2);
  expect(bonuses.bonuses.find((b: any) => b.name === "Research")).toMatchObject(
    { count: 1, percentage: 50 },
  );
  const combined = await s.read("getAllAnalyticsWithCrossFilter");
  expect(combined.paymentStats).toMatchObject({
    paidCount: 1,
    unpaidCount: 1,
    totalPayments: 4321,
    unpaidAmount: 1234,
  });
  expect(combined.bonusFrequency.totalArticles).toBe(2);
  expect((await s.read("getUnpaidArticlesPage")).articles).toEqual([]);
  expect(await s.read("getDashboardStats")).toMatchObject({ totalArticles: 4 });
});

test("source attachments require stored bytes and an imported identity, and repeating an attachment creates one record", async () => {
  const s = setup(),
    bundle = sourceFixture();
  await s.importBundle(bundle);
  const article = (await s.list("articles")).find(
    (a: any) =>
      JSON.parse(a.sourceProvenance).originalArticleId === "original-a",
  );
  const bytes = new TextEncoder().encode(bundle.articles[0].content);
  const sha256 = createHash("sha256").update(bytes).digest("hex");
  const request = {
    archiveId: bundle.archiveId,
    sourceKey: "original-a",
    articleId: article.id,
    filePath: "source-archive/verified/recovered-original.md",
    fileName: "recovered-original.md",
    originalFileName: "Recovered original article.md",
    attachmentType: "other",
    fileSize: bytes.length,
    mimeType: "text/markdown",
    sha256,
  };
  await expect(s.write("addSourceArchiveAttachment", request)).rejects.toThrow(
    "not been stored",
  );
  const storageId = await s.t.run((ctx) =>
    ctx.storage.store(new Blob([bytes], { type: request.mimeType })),
  );
  await s.t.mutation(api.files.finalize, {
    secret,
    path: request.filePath,
    storageId,
    size: bytes.length,
    mimeType: request.mimeType,
    sha256,
  });
  await expect(
    s.write("addSourceArchiveAttachment", {
      ...request,
      sourceKey: "unrelated-source",
    }),
  ).rejects.toThrow("imported source article");
  await expect(
    s.write("addSourceArchiveAttachment", {
      ...request,
      fileSize: bytes.length + 1,
    }),
  ).rejects.toThrow("not been stored");
  await expect(
    s.write("addSourceArchiveAttachment", {
      ...request,
      sha256: "0".repeat(64),
    }),
  ).rejects.toThrow("not been stored");
  const first = await s.write("addSourceArchiveAttachment", request);
  const second = await s.write("addSourceArchiveAttachment", request);
  expect(first.created).toBe(true);
  expect(second.created).toBe(false);
  expect(second.attachment.id).toBe(first.attachment.id);
  const detail = (await s.read("getArticleById", { id: article.id })).article;
  expect(detail.attachments).toHaveLength(1);
  expect(detail.attachments[0]).toMatchObject({
    filePath: request.filePath,
    fileSize: bytes.length,
    includeInExport: true,
  });
  const stored = await s.t.run(async (ctx) =>
    Array.from(
      new Uint8Array(await (await ctx.storage.get(storageId))!.arrayBuffer()),
    ),
  );
  expect(stored).toEqual(Array.from(bytes));
  await s.importBundle(bundle);
  expect(await s.list("attachments")).toHaveLength(1);
});

test("the complete nine-issue catalogue imports all100 main articles into seven publications and repeats without changes", async () => {
  const s = setup();
  const bundle = JSON.parse(
    await readFile(
      join(process.cwd(), "public/designcraft/source-archive.json"),
      "utf8",
    ),
  );
  const preview = await s.preview(bundle);
  expect(preview.summary).toMatchObject({
    documents: 9,
    publications: 7,
    eligible: 100,
    create: 100,
    conflicts: 0,
    missingBodies: 55,
  });
  // A recurring feature can have placements in more than one publication;
  // its review rows remain inventory rather than creating main articles.
  expect(
    new Set(
      preview.articles
        .filter((a: any) => a.action === "excluded")
        .map((a: any) => a.sourceKey),
    ).size,
  ).toBe(11);
  await s.write("importSourceArchive", {
    bundle,
    previewToken: preview.previewToken,
  });
  const articles = await s.list("articles"),
    authors = await s.list("authors");
  expect(articles).toHaveLength(100);
  expect(await s.list("volumes")).toHaveLength(2);
  expect(await s.list("issues")).toHaveLength(7);
  const byOriginal = new Map(
    articles.map((a: any) => [
      JSON.parse(a.sourceProvenance).originalArticleId,
      a,
    ]),
  );
  for (const expected of originals.articles) {
    const article: any = byOriginal.get(expected.originalArticleId);
    expect(article, expected.originalArticleId).toBeDefined();
    expect(article.title).toBe(expected.title);
    expect(JSON.parse(article.sourceProvenance).originalAuthorName).toBe(
      expected.authorName,
    );
    expect(article.prefersAnonymity).toBe(expected.anonymous);
    expect(article.submittedAt).toEqual(
      expected.originalDates.submittedAt
        ? new Date(expected.originalDates.submittedAt)
        : null,
    );
    if (expected.storedBodySha256)
      expect(
        createHash("sha256").update(article.content).digest("hex"),
        expected.originalArticleId,
      ).toBe(expected.storedBodySha256);
    expect(article).toMatchObject({
      internalStatus: "Archived",
      paymentStatus: null,
      paymentAmount: null,
      articleTier: null,
    });
  }
  expect(
    authors.every((a: any) => a.email === "" && a.etransferEmail === null),
  ).toBe(true);
  const publicationCounts = (await s.read("getVolumes")).volumes
    .flatMap((v: any) => v.issues)
    .reduce((total: number, issue: any) => total + issue.articleCount, 0);
  expect(publicationCounts).toBe(100);
  expect((await s.read("getUnpaidArticlesPage")).articles).toEqual([]);
  expect(await s.read("getPaymentStats")).toMatchObject({
    paidCount: 0,
    unpaidCount: 0,
    totalPayments: 0,
  });
  const repeat = await s.preview(bundle);
  expect(repeat.summary).toMatchObject({
    existing: 100,
    create: 0,
    link: 0,
    conflicts: 0,
  });
  await s.write("importSourceArchive", {
    bundle,
    previewToken: repeat.previewToken,
  });
  expect(await s.list("articles")).toEqual(articles);
  expect(await s.list("authors")).toEqual(authors);
  expect(await s.list("sourceArchiveLinks")).toHaveLength(100);
}, 60000);

test("bad source placements and unauthorized calls leave no partial import records", async () => {
  const s = setup(),
    bundle = sourceFixture();
  bundle.articles[0].placements[0].pageNumbers = [99];
  await expect(s.preview(bundle)).rejects.toThrow();
  await expect(
    s.write("importSourceArchive", { bundle, previewToken: "invalid" }),
  ).rejects.toThrow();
  await expect(
    s.t.query(api.app.read, {
      secret: "wrong",
      operation: "previewSourceArchive",
      data: toWire({ bundle: sourceFixture() }),
    }),
  ).rejects.toThrow("Unauthorized");
  await expect(
    s.t.mutation(api.app.write, {
      secret: "wrong",
      operation: "importSourceArchive",
      data: toWire({ bundle: sourceFixture(), previewToken: "invalid" }),
    }),
  ).rejects.toThrow("Unauthorized");
  for (const table of [
    "articles",
    "authors",
    "issues",
    "volumes",
    "articleNotes",
    "statusHistory",
  ])
    expect(await s.list(table)).toEqual([]);
});
