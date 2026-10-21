import { beforeEach, expect, test, vi } from "vitest";
import { convexTest } from "convex-test";
import schema from "../convex/schema";
import { api } from "../convex/_generated/api";
import { fromWire, toWire } from "../shared/codec";
const modules = import.meta.glob("../convex/**/*.{ts,js}");
const secret = "issue-files-test-secret";
beforeEach(() => vi.stubEnv("CONVEX_SERVER_SECRET", secret));
async function fixture() {
  const t = convexTest(schema, modules);
  const write = async (operation: string, data: unknown) =>
    fromWire(
      await t.mutation(api.app.write, {
        secret,
        operation,
        data: toWire(data),
      }),
    ) as any;
  const read = async (operation: string, data: unknown) =>
    fromWire(
      await t.query(api.app.read, { secret, operation, data: toWire(data) }),
    ) as any;
  const { volume } = await write("createVolume", { volumeNumber: 901 });
  const { issue } = await write("createIssue", {
    volumeId: volume.id,
    issueNumber: 1,
  });
  const { articleId } = await write("createArticle", {
    title: "Retained source",
    authorEmail: "retain@example.test",
    authorGivenName: "Test",
    authorSurname: "Writer",
    issueId: issue.id,
  });
  const path = "issue-studio/retained-photo.jpg";
  const store = async (content: string) => {
    const storageId = await t.run((ctx) =>
      ctx.storage.store(new Blob([content])),
    );
    await t.mutation(api.files.finalize, {
      secret,
      path,
      storageId,
      size: content.length,
      mimeType: "image/jpeg",
    });
    return storageId;
  };
  const originalId = await store("original");
  const { attachment } = await write("addAttachment", {
    articleId,
    attachmentType: "photo",
    fileName: "photo.jpg",
    originalFileName: "photo.jpg",
    filePath: path,
    fileSize: 8,
    mimeType: "image/jpeg",
  });
  const view = await write("ensureIssueStudio", { issueId: issue.id });
  await write("saveIssueStudio", {
    issueId: issue.id,
    expectedRevision: view.plan.revision,
    state: view.state,
  });
  return {
    t,
    write,
    read,
    path,
    issue,
    articleId,
    attachment,
    originalId,
    store,
  };
}

test("immutable issue snapshots retain source bytes after attachment deletion and reject overwrite", async () => {
  const f = await fixture();
  await f.write("deleteAttachment", { attachmentId: f.attachment.id });
  const file = await f.t.query(api.files.info, { secret, path: f.path });
  expect(file).not.toBeNull();
  expect(
    await f.t.run(
      async (ctx) => await (await ctx.storage.get(f.originalId))?.text(),
    ),
  ).toBe("original");
  await expect(f.store("modified")).rejects.toThrow(
    /saved|revision|Issue Studio|retained/i,
  );
  await expect(
    f.t.mutation(api.files.remove, { secret, path: f.path }),
  ).rejects.toThrow(/saved|revision|Issue Studio|retained/i);
  expect(
    await f.t.run(
      async (ctx) => await (await ctx.storage.get(f.originalId))?.text(),
    ),
  ).toBe("original");
});

test("re-uploading identical historical bytes is idempotent and keeps recorded storage identity", async () => {
  const f = await fixture();
  const duplicate = await f.store("original");
  expect(
    await f.t.run((ctx) =>
      ctx.db
        .query("storedFiles")
        .withIndex("by_path", (q) => q.eq("path", f.path))
        .unique(),
    ),
  ).toMatchObject({ storageId: f.originalId });
  expect(await f.t.run((ctx) => ctx.storage.get(duplicate))).toBeNull();
});
