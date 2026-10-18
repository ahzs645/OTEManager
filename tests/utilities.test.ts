// @vitest-environment node
import { beforeEach, afterEach, expect, test, vi } from "vitest";
import { convexTest } from "convex-test";
import JSZip from "jszip";
import { mkdtemp, readFile, writeFile, mkdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import schema from "../convex/schema";
import { api } from "../convex/_generated/api";
import { ConvexStorageProvider } from "../storage/convex";
import {
  importSharePointJson,
  updateStudentTypes,
} from "../server/sharepoint-json";
import { query, mutate } from "../server/convex";
import * as records from "../server/records";
import { Route as SharePointRoute } from "../app/routes/api/sharepoint/import";
import { Route as WPRoute } from "../app/routes/api/exportBundle";
import { Route as IssueExportRoute } from "../app/routes/api/exportIssue.$issueId";
const state = vi.hoisted(() => ({ t: null as any }));
vi.mock("convex/browser", () => ({
  ConvexHttpClient: class {
    query(ref: any, args: any) {
      return state.t.query(ref, args);
    }
    mutation(ref: any, args: any) {
      return state.t.mutation(ref, args);
    }
  },
}));
vi.mock("@tanstack/react-router", () => ({
  createFileRoute: () => (options: any) => ({ options }),
}));
const modules = import.meta.glob("../convex/**/*.{ts,js}");
const secret = "isolated-utility-test";
const dirs: string[] = [];
beforeEach(() => {
  state.t = convexTest(schema, modules);
  vi.stubEnv("CONVEX_SERVER_SECRET", secret);
  vi.stubEnv("CONVEX_URL", "http://isolated.invalid");
  // Replace only the HTTP transfer; use real Convex storage and path mutations.
  vi.spyOn(ConvexStorageProvider.prototype, "store").mockImplementation(
    async (path, buffer, mimeType = "application/octet-stream") => {
      const storageId = await state.t.run((ctx: any) =>
        ctx.storage.store(new Blob([new Uint8Array(buffer)])),
      );
      await state.t.mutation(api.files.finalize, {
        secret,
        path,
        storageId,
        size: buffer.length,
        mimeType,
      });
    },
  );
  vi.spyOn(ConvexStorageProvider.prototype, "getFile").mockImplementation(
    async (path) => {
      const blob = await state.t.run(async (ctx: any) => {
        const f = await ctx.db
          .query("storedFiles")
          .withIndex("by_path", (q: any) => q.eq("path", path))
          .unique();
        const blob = f ? await ctx.storage.get(f.storageId) : null;
        return blob ? blob.arrayBuffer() : null;
      });
      return blob ? Buffer.from(blob) : null;
    },
  );
});
afterEach(async () => {
  vi.restoreAllMocks();
  for (const dir of dirs.splice(0))
    await rm(dir, { recursive: true, force: true });
});
async function article(title = "Test", authorEmail = "writer@example.test") {
  return (
    await mutate("createArticle", {
      title,
      authorEmail,
      authorGivenName: "Test",
      authorSurname: "Writer",
    })
  ).articleId;
}
async function attachment(articleId: string, path: string, name = "photo.png") {
  await new ConvexStorageProvider().saveFile(path, Buffer.from("photo-bytes"));
  return (
    await mutate("addAttachment", {
      articleId,
      filePath: path,
      attachmentType: "photo",
      fileName: name,
      originalFileName: name,
      fileSize: 11,
      mimeType: "image/png",
    })
  ).attachment;
}
const sp = () => ({
  Id: 123,
  Title: "Import test",
  FileLeafRef: "Import test",
  Contact_x0020_Email: "Writer@Example.test",
  Given_x0020_Name: "Test",
  Surname: "Writer",
  role: "Undergrad",
  Article_x0020_Tier: "Tier 2 (Standard)",
  Internal_x0020_Status: "Approved",
  Total_x0020_Payment: 42.5,
  Multimedia_x0020_Types: "Photo",
  Created: "2026-09-01T12:00:00Z",
  _images: [{ name: "photo.png", metadata: { Caption: "Original caption" } }],
});
async function sourceFolder() {
  const dir = await mkdtemp(join(tmpdir(), "ote-utility-"));
  dirs.push(dir);
  await writeFile(join(dir, "articles.json"), JSON.stringify([sp()]));
  for (const type of ["documents", "photos"])
    await mkdir(join(dir, type, "Import test"), { recursive: true });
  await writeFile(
    join(dir, "documents/Import test/article.docx"),
    "test-document",
  );
  await writeFile(join(dir, "photos/Import test/photo.png"), "photo-bytes");
  return dir;
}
async function importSP(
  source: string | File,
  mode = "merge",
  preview = false,
) {
  const form = new FormData();
  form.set(typeof source === "string" ? "folderPath" : "file", source);
  form.set("mode", mode);
  form.set("preview", String(preview));
  const response = await (SharePointRoute.options as any).server.handlers.POST({
    request: new Request("http://test/api/sharepoint/import", {
      method: "POST",
      body: form,
    }),
  });
  expect(response.status).toBe(200);
  return response.json();
}
test("duplicate merge preserves attachments, notes, history, multimedia and source IDs", async () => {
  const keep = await article("Same title"),
    drop = await article(" SAME   TITLE ");
  await records.patch("articles", keep, { formResponseId: "sp-1" });
  await records.patch("articles", drop, { formResponseId: "sp-2" });
  await attachment(drop, "photo.png");
  await mutate("addArticleNote", {
    articleId: drop,
    content: "Keep this note",
  });
  for (const id of [keep, drop])
    await records.insert("articleMultimediaTypes", {
      articleId: id,
      multimediaType: "Photo",
    });
  expect((await query("findDuplicates")).totalDuplicates).toBe(1);
  await mutate("mergeArticles", { keepId: keep, deleteIds: [drop, drop] });
  const result = (await query("getArticleById", { id: keep })).article!;
  expect(result.attachments).toHaveLength(1);
  expect(result.notes).toHaveLength(1);
  expect(result.statusHistory).toHaveLength(2);
  expect(result.multimediaTypes).toHaveLength(1);
  expect(result.formResponseId).toBe("sp-1,sp-2");
  expect(await new ConvexStorageProvider().getFile("photo.png")).not.toBeNull();
  expect((await query("findDuplicates")).totalDuplicates).toBe(0);
});
test("bulk duplicate-file deletion is atomic and protects files referenced by another article", async () => {
  const a = await article(),
    b = await article("Other");
  const first = await attachment(a, "shared.png"),
    second = await attachment(b, "shared.png");
  expect((await query("findDuplicateFiles")).duplicateGroups).toHaveLength(1);
  await expect(
    mutate("deleteFiles", { attachmentIds: [first.id, "missing"] }),
  ).rejects.toThrow();
  expect(await records.get("attachments", first.id)).not.toBeNull();
  await mutate("deleteFiles", { attachmentIds: [first.id, first.id] });
  expect(
    await new ConvexStorageProvider().getFile("shared.png"),
  ).not.toBeNull();
  await mutate("deleteFiles", { attachmentIds: [second.id] });
  expect(await new ConvexStorageProvider().getFile("shared.png")).toBeNull();
});
test("Payment Manager calculates bonuses, accepts manual amounts and removes completed articles", async () => {
  const id = await article();
  await article("Draft stays excluded");
  await mutate("updateArticleStatus", { articleId: id, status: "Approved" });
  expect((await query("getUnpaidArticlesPage")).articles.map((a) => a.id)).toEqual([
    id,
  ]);
  const bonus = await mutate("updateArticleBonusFlags", {
    articleId: id,
    hasResearchBonus: true,
  });
  expect(bonus.calculation!.totalAmount).toBeGreaterThan(2000);
  await mutate("setManualPayment", { articleId: id, amount: 4321 });
  await mutate("markPaymentComplete", { articleId: id, amount: 4321 });
  expect((await query("getUnpaidArticlesPage")).articles).toEqual([]);
  expect(
    (await query("getArticleById", { id })).article!.paidAt,
  ).toBeInstanceOf(Date);
});

async function paymentQueue(
  scope: { volumeId?: string; issueId?: string } = {},
) {
  const articles: Awaited<
    ReturnType<typeof query<"getUnpaidArticlesPage">>
  >["articles"] = [];
  let cursor: string | null = null;
  while (true) {
    const page = await query("getUnpaidArticlesPage", { ...scope, cursor });
    articles.push(...page.articles);
    if (page.isDone) return articles;
    cursor = page.continueCursor;
  }
}

test("the previous app keeps its array payment response during a backend-first rollout", async () => {
  const approved = await article("Legacy approved queue");
  const published = await article("Published queue");
  await mutate("updateArticleStatus", { articleId: approved, status: "Approved" });
  await mutate("updateArticleStatus", { articleId: published, status: "Published" });
  const legacy = await query("getUnpaidArticles");
  expect(Array.isArray(legacy)).toBe(true);
  expect(legacy.map((a) => a.id)).toEqual([approved]);
  expect(new Set((await paymentQueue()).map((a) => a.id))).toEqual(new Set([approved, published]));
});

test("payment queue keeps unpaid articles through publication and excludes pre-approval and archived work", async () => {
  const statuses = [
    "Draft",
    "Pending Review",
    "In Review",
    "Needs Revision",
    "Approved",
    "In Editing",
    "Ready for Publication",
    "Published",
    "Archived",
  ];
  const expected = new Set<string>();
  for (const status of statuses) {
    const id = await article(status);
    await mutate("updateArticleStatus", { articleId: id, status });
    if (
      ["Approved", "In Editing", "Ready for Publication", "Published"].includes(
        status,
      )
    )
      expected.add(id);
  }
  const nullPayment = await article("Imported unpaid publication");
  await records.patch("articles", nullPayment, {
    internalStatus: "Published",
    paymentStatus: null,
  });
  expected.add(nullPayment);
  const paid = await article("Already paid publication");
  await records.patch("articles", paid, {
    internalStatus: "Published",
    paymentStatus: true,
    paymentAmount: 3500,
  });
  expect(new Set((await paymentQueue()).map((a) => a.id))).toEqual(expected);
});

test("payment queue scopes linked and legacy articles to a volume or an issue without including other publications", async () => {
  const volume = (await mutate("createVolume", { volumeNumber: 33 })).volume;
  const otherVolume = (await mutate("createVolume", { volumeNumber: 32 }))
    .volume;
  const issue = (
    await mutate("createIssue", { volumeId: volume.id, issueNumber: 2 })
  ).issue;
  const sibling = (
    await mutate("createIssue", { volumeId: volume.id, issueNumber: 1 })
  ).issue;
  const otherIssue = (
    await mutate("createIssue", { volumeId: otherVolume.id, issueNumber: 2 })
  ).issue;
  const linked = await article("Linked publication");
  await records.patch("articles", linked, {
    internalStatus: "Published",
    issueId: issue.id,
    volume: 32,
    issue: 1,
  });
  const legacy = await article("Legacy publication");
  await records.patch("articles", legacy, {
    internalStatus: "Published",
    volume: 33,
    issue: 2,
  });
  const volumeOnly = await article("Volume only");
  await records.patch("articles", volumeOnly, {
    internalStatus: "Approved",
    volume: 33,
  });
  const siblingArticle = await article("Sibling issue");
  await records.patch("articles", siblingArticle, {
    internalStatus: "Approved",
    issueId: sibling.id,
  });
  const other = await article("Different volume");
  await records.patch("articles", other, {
    internalStatus: "Published",
    issueId: otherIssue.id,
    volume: 33,
    issue: 2,
  });
  const unassigned = await article("Unassigned");
  await records.patch("articles", unassigned, { internalStatus: "Approved" });
  const ids = async (scope: { volumeId?: string; issueId?: string }) =>
    new Set((await paymentQueue(scope)).map((a) => a.id));
  expect(await ids({ issueId: issue.id })).toEqual(new Set([linked, legacy]));
  expect(await ids({ volumeId: volume.id, issueId: issue.id })).toEqual(
    new Set([linked, legacy]),
  );
  expect(await ids({ volumeId: volume.id })).toEqual(
    new Set([linked, legacy, volumeOnly, siblingArticle]),
  );
  expect(await ids({ volumeId: otherVolume.id })).toEqual(new Set([other]));
  await expect(
    query("getUnpaidArticlesPage", { volumeId: otherVolume.id, issueId: issue.id }),
  ).rejects.toThrow("does not belong");
  await expect(
    query("getUnpaidArticlesPage", { issueId: "missing" }),
  ).rejects.toThrow("not found");
  await mutate("markPaymentComplete", { articleId: linked, amount: 3500 });
  expect(await ids({ issueId: issue.id })).toEqual(new Set([legacy]));
  expect(await ids({})).toEqual(
    new Set([legacy, volumeOnly, siblingArticle, other, unassigned]),
  );
});

test("payment pagination continues through empty filtered pages and includes unpaid null statuses", async () => {
  const author = await records.insert("authors", {
    email: "pages@example.test",
    givenName: "Page",
    surname: "Writer",
  });
  const expected = new Set<string>();
  for (let i = 0; i < 60; i++) {
    const row = await records.insert("articles", {
      authorId: author.id,
      title: `Published ${i}`,
      internalStatus: "Published",
      paymentStatus: i % 2 ? false : null,
    });
    expected.add(row.id);
  }
  for (let i = 0; i < 55; i++)
    await records.insert("articles", {
      authorId: author.id,
      title: `Draft ${i}`,
      internalStatus: "Draft",
    });
  const first = await query("getUnpaidArticlesPage");
  expect(first.articles).toEqual([]);
  expect(first.isDone).toBe(false);
  expect(new Set((await paymentQueue()).map((a) => a.id))).toEqual(expected);
});

test("student types accept role objects and mixed-case email while preserving non-students", async () => {
  const student = await records.insert("authors", {
    email: "Writer@Example.test",
    givenName: "A",
    surname: "B",
    authorType: "Student",
  });
  await records.insert("authors", {
    email: "staff@example.test",
    givenName: "A",
    surname: "B",
    authorType: "Staff",
  });
  const data = {
    articles: [
      { ContactEmail: " writer@example.test ", role: { Value: "Graduate" } },
      { ContactEmail: "staff@example.test", role: "Undergrad" },
    ],
  };
  const result = await updateStudentTypes(data);
  expect(result).toMatchObject({
    updated: 1,
    skipped: 1,
    notFound: 0,
    errors: [],
  });
  expect((await records.get("authors", student.id))!.studentType).toBe("Grad");
  expect((await updateStudentTypes(data)).updated).toBe(0);
});
test("legacy JSON import reuses authors case-insensitively and skips source IDs on repeat", async () => {
  const author = await records.insert("authors", {
    email: "writer@example.test",
    givenName: "A",
    surname: "B",
    authorType: "Student",
  });
  const data = {
    articles: [
      {
        Id: 1,
        Title: "Legacy",
        ContactEmail: "WRITER@example.test",
        GivenName: "A",
        Surname: "B",
        role: { Value: "Graduate" },
      },
    ],
  };
  expect(await importSharePointJson(data)).toMatchObject({
    success: 1,
    failed: 0,
  });
  expect(await records.list("authors")).toHaveLength(1);
  expect((await records.list("articles"))[0].authorId).toBe(author.id);
  expect((await importSharePointJson(data)).skipped).toBe(1);
});
test("SharePoint folder preview, merge, and repeat replacement preserve file counts and captions", async () => {
  const dir = await sourceFolder();
  const preview = await importSP(dir, "merge", true);
  expect(preview.stats.files).toEqual({ documents: 1, photos: 1 });
  expect(await records.list("articles")).toHaveLength(0);
  const initial = await importSP(dir);
  expect(initial.stats).toMatchObject({
    articles: { imported: 1 },
    attachments: { imported: 2 },
    errors: [],
  });
  expect((await importSP(dir)).stats.articles.skipped).toBe(1);
  const importedArticle = (await records.list("articles"))[0];
  await records.patch("articles", importedArticle.id, {
    formResponseId: "sp-456,sp-123",
  });
  for (let i = 0; i < 2; i++) {
    expect((await importSP(dir, "replace")).stats.errors).toEqual([]);
    expect(await records.list("attachments")).toHaveLength(2);
  }
  expect(
    (await records.list("attachments")).find(
      (a) => a.attachmentType === "photo",
    )!.caption,
  ).toBe("Original caption");
  expect((await records.list("articles"))[0].paymentAmount).toBe(4250);
  expect((await records.list("articles"))[0].formResponseId).toBe(
    "sp-456,sp-123",
  );
});
test("SharePoint ZIP uploads restore document and photo contents", async () => {
  const zip = new JSZip();
  zip.file("export/articles.json", JSON.stringify([sp()]));
  zip.file("export/documents/Import test/article.docx", "test-document");
  zip.file("export/photos/Import test/photo.png", "photo-bytes");
  const result = await importSP(
    new File(
      [await zip.generateAsync({ type: "uint8array" })],
      "sharepoint.zip",
    ),
  );
  expect(result.stats.attachments.imported).toBe(2);
  for (const a of await records.list("attachments"))
    expect(
      (await new ConvexStorageProvider().getFile(a.filePath))!.length,
    ).toBe(a.fileSize);
});
test("SharePoint file failures are reported and merge retries the missing file", async () => {
  const dir = await sourceFolder();
  vi.mocked(ConvexStorageProvider.prototype.store).mockRejectedValueOnce(
    new Error("Upload unavailable"),
  );
  const first = await importSP(dir);
  expect(first.stats.errors.join(" ")).toContain("Upload unavailable");
  await importSP(dir);
  expect(await records.list("attachments")).toHaveLength(2);
});
test("WordPress export contains article JSON and photos and rejects issues from another volume", async () => {
  const id = await article();
  const { volume } = await mutate("createVolume", { volumeNumber: 5 });
  const { issue } = await mutate("createIssue", {
    volumeId: volume.id,
    issueNumber: 1,
  });
  await mutate("updateArticleIssue", { articleId: id, issueId: issue.id });
  await mutate("updateArticleContent", {
    articleId: id,
    content: "Story body",
  });
  await attachment(id, "photo.png");
  const exportWP = (volumeId: string) =>
    (WPRoute.options as any).server.handlers.POST({
      request: new Request("http://test/api/exportBundle", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          volumeId,
          issueIds: [issue.id],
          includePhotos: true,
        }),
      }),
    });
  const response = await exportWP(volume.id);
  expect(response.status).toBe(200);
  const zip = await JSZip.loadAsync(await response.arrayBuffer());
  const json = Object.values(zip.files).find((f) => f.name.endsWith(".json"))!;
  expect(JSON.parse(await json.async("string"))[0]).toMatchObject({
    id,
    volume: "5",
    issue: "1",
    content: "Story body",
  });
  const photo = Object.values(zip.files).find((f) =>
    f.name.endsWith("photo.png"),
  )!;
  expect(await photo.async("string")).toBe("photo-bytes");
  const other = await mutate("createVolume", { volumeNumber: 6 });
  expect((await exportWP(other.volume.id)).status).toBe(400);
});

test("DesignCraft export preserves Markdown, anonymity, issue metadata and distinct media paths", async () => {
  const first = await article("Same title"),
    second = await article("Same title", "other@example.test");
  const { volume } = await mutate("createVolume", {
    volumeNumber: 31,
    year: 2026,
  });
  const { issue } = await mutate("createIssue", {
    volumeId: volume.id,
    issueNumber: 3,
    title: "Autumn",
    releaseDate: "2026-10-01",
  });
  const body =
    "# Heading\n\n**Exact** _Markdown_\n\n[Link](https://example.test)\n";
  for (const id of [first, second]) {
    await mutate("updateArticleIssue", { articleId: id, issueId: issue.id });
    await mutate("updateArticleContent", { articleId: id, content: body });
  }
  await records.patch("articles", first, { prefersAnonymity: true });
  const a = await attachment(first, "a.png", "same.png");
  const b = await attachment(second, "b.png", "same.png");
  await records.patch("attachments", a.id, {
    caption: "Original caption",
    photoNumber: 2,
  });
  await records.patch("attachments", b.id, { attachmentType: "graphic" });
  const exportIssue = (format = "designcraft") =>
    (IssueExportRoute.options as any).server.handlers.GET({
      params: { issueId: issue.id },
      request: new Request(
        `http://test/api/exportIssue/${issue.id}${format ? `?format=${format}` : ""}`,
      ),
    });
  const response = await exportIssue();
  expect(response.status).toBe(200);
  const zip = await JSZip.loadAsync(await response.arrayBuffer());
  const manifest = JSON.parse(await zip.file("issue.json")!.async("string"));
  expect(manifest).toMatchObject({
    schemaVersion: "ote.designcraft.issue.v1",
    issue: {
      id: issue.id,
      volume: 31,
      number: 3,
      date: "2026-10-01",
      year: 2026,
      title: "Autumn",
    },
    layoutPlan: {
      pages: [],
      cover: { mode: "preserve" },
      truck: { mode: "preserve", pageIds: [] },
    },
    templateLibrary: "/designcraft/templates.json",
  });
  const anonymous = manifest.articles.find((entry: any) => entry.id === first);
  const named = manifest.articles.find((entry: any) => entry.id === second);
  expect(anonymous).toMatchObject({
    title: "Same title",
    body,
    author: "Anonymous",
    photos: [
      {
        id: a.id,
        caption: "Original caption",
        photoNumber: 2,
        mimeType: "image/png",
      },
    ],
  });
  expect(named).toMatchObject({
    body,
    author: "Test Writer",
    photos: [{ id: b.id, attachmentType: "graphic" }],
  });
  expect(anonymous.photos[0].path).not.toBe(named.photos[0].path);
  for (const entry of manifest.articles) {
    expect(
      await zip.file(`articles/${entry.id}/article.md`)!.async("string"),
    ).toBe(body);
    expect(await zip.file(entry.photos[0].path)!.async("string")).toBe(
      "photo-bytes",
    );
  }
  expect(await zip.file("issue.json")!.async("string")).not.toContain(
    "writer@example.test",
  );
  expect(Object.keys(anonymous)).not.toContain("authorId");
  // The existing default remains a DOCX ZIP, not a DesignCraft manifest.
  const legacy = await exportIssue("");
  expect(legacy.status).toBe(200);
  const legacyZip = await JSZip.loadAsync(await legacy.arrayBuffer());
  expect(legacyZip.file("issue.json")).toBeNull();
  expect(
    Object.keys(legacyZip.files).some((path) => path.endsWith(".docx")),
  ).toBe(true);
  expect((await exportIssue("unknown")).status).toBe(400);
  // An asset failure must reject the entire export rather than silently dropping the photo.
  await records.patch("attachments", a.id, { fileSize: 12 });
  expect((await exportIssue()).status).toBe(409);
  await records.patch("attachments", a.id, {
    filePath: "missing.png",
    fileSize: 11,
  });
  const incomplete = await exportIssue();
  expect(incomplete.status).toBe(409);
  expect((await incomplete.json()).error).toContain("missing or incomplete");
});

test(
  "DesignCraft selection exports only requested issue articles and selected images",
  async () => {
    const chosen = await article("Selected story"),
      omitted = await article("Omitted story");
    const { volume } = await mutate("createVolume", {
      volumeNumber: 33,
      year: 2026,
    });
    const { issue } = await mutate("createIssue", {
      volumeId: volume.id,
      issueNumber: 2,
      releaseDate: "2026-10-11",
    });
    for (const id of [chosen, omitted]) {
      await mutate("updateArticleIssue", { articleId: id, issueId: issue.id });
      await mutate("updateArticleContent", {
        articleId: id,
        content: "Full **source Markdown**.\n\nSecond paragraph.",
      });
    }
    const kept = await attachment(chosen, "kept.png");
    const excluded = await attachment(chosen, "excluded.png");
    const graphic = await attachment(chosen, "graphic.png");
    await records.patch("attachments", graphic.id, {
      attachmentType: "graphic",
    });
    await records.patch("attachments", excluded.id, {
      includeInExport: false,
      filePath: "missing-excluded.png",
    });
    // Missing media in an article that was not chosen must not obstruct the selected export.
    const other = await attachment(omitted, "other.png");
    await records.patch("attachments", other.id, {
      filePath: "missing-omitted.png",
    });
    const image = process.env.DESIGNCRAFT_SELECTION_QA_IMAGE
      ? await readFile(process.env.DESIGNCRAFT_SELECTION_QA_IMAGE)
      : Buffer.from(
          "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
          "base64",
        );
    for (const photo of [kept, graphic]) {
      await new ConvexStorageProvider().saveFile(photo.filePath, image);
      await records.patch("attachments", photo.id, {
        fileSize: image.length,
        originalFileName: process.env.DESIGNCRAFT_SELECTION_QA_IMAGE
          ? "source-photo.jpg"
          : "photo.png",
        mimeType: process.env.DESIGNCRAFT_SELECTION_QA_IMAGE
          ? "image/jpeg"
          : "image/png",
      });
    }
    const response = await (
      IssueExportRoute.options as any
    ).server.handlers.POST({
      params: { issueId: issue.id },
      request: new Request(
        `http://test/api/exportIssue/${issue.id}?format=designcraft`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ articleIds: [chosen] }),
        },
      ),
    });
    expect(response.status).toBe(200);
    const exportBytes = Buffer.from(await response.arrayBuffer());
    const zip = await JSZip.loadAsync(exportBytes);
    const manifest = JSON.parse(await zip.file("issue.json")!.async("string"));
    expect(manifest.articles.map((entry: any) => entry.id)).toEqual([chosen]);
    expect(manifest.articles[0].body).toBe(
      "Full **source Markdown**.\n\nSecond paragraph.",
    );
    expect(
      manifest.articles[0].photos.map((entry: any) => entry.id).sort(),
    ).toEqual([kept.id, graphic.id].sort());
    expect(
      Object.keys(zip.files).some(
        (path) => path.includes(omitted) || path.includes(excluded.id),
      ),
    ).toBe(false);
    for (const photo of manifest.articles[0].photos)
      expect(await zip.file(photo.path)!.async("nodebuffer")).toEqual(image);
    expect(await zip.file("README.txt")!.async("string")).toContain(
      "not a native DesignCraft document",
    );
    if (process.env.DESIGNCRAFT_SELECTION_QA_OUTPUT) {
      const output = process.env.DESIGNCRAFT_SELECTION_QA_OUTPUT;
      await mkdir(output, { recursive: true });
      await writeFile(join(output, "selected-articles.zip"), exportBytes);
      await writeFile(
        join(output, "issue-articles.json"),
        JSON.stringify({
          issue: { ...issue, articleCount: 2 },
          volume,
          ...(await query("getIssueArticles", { issueId: issue.id })),
        }),
      );
      await writeFile(join(output, "selected-media.bin"), image);
    }
  },
  process.env.DESIGNCRAFT_SELECTION_QA_IMAGE ? 30000 : 5000,
);

test("DesignCraft selection rejects empty, duplicate, malformed and cross-issue IDs", async () => {
  const chosen = await article("Chosen"),
    outside = await article("Outside issue");
  const { volume } = await mutate("createVolume", { volumeNumber: 33 });
  const { issue } = await mutate("createIssue", {
    volumeId: volume.id,
    issueNumber: 3,
  });
  await mutate("updateArticleIssue", { articleId: chosen, issueId: issue.id });
  for (const body of [
    { articleIds: [] },
    { articleIds: [chosen, chosen] },
    { articleIds: [outside] },
    { articleIds: ["missing"] },
    { articleIds: [null] },
    {},
    null,
  ]) {
    const response = await (
      IssueExportRoute.options as any
    ).server.handlers.POST({
      params: { issueId: issue.id },
      request: new Request(
        `http://test/api/exportIssue/${issue.id}?format=designcraft`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        },
      ),
    });
    expect(response.status).toBe(400);
  }
  const malformed = await (
    IssueExportRoute.options as any
  ).server.handlers.POST({
    params: { issueId: issue.id },
    request: new Request(
      `http://test/api/exportIssue/${issue.id}?format=designcraft`,
      { method: "POST", body: "{" },
    ),
  });
  expect(malformed.status).toBe(400);
});
