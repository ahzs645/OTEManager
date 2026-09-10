// @vitest-environment node
import { beforeEach, afterEach, expect, test, vi } from "vitest";
import { convexTest } from "convex-test";
import JSZip from "jszip";
import { mkdtemp, writeFile, mkdir, rm } from "node:fs/promises";
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
  expect((await query("getUnpaidArticles")).map((a) => a.id)).toEqual([id]);
  const bonus = await mutate("updateArticleBonusFlags", {
    articleId: id,
    hasResearchBonus: true,
  });
  expect(bonus.calculation!.totalAmount).toBeGreaterThan(2000);
  await mutate("setManualPayment", { articleId: id, amount: 4321 });
  await mutate("markPaymentComplete", { articleId: id, amount: 4321 });
  expect(await query("getUnpaidArticles")).toEqual([]);
  expect(
    (await query("getArticleById", { id })).article!.paidAt,
  ).toBeInstanceOf(Date);
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
