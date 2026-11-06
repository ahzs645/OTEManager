// @vitest-environment node
import { expect, test } from "vitest";
import { composeSavedIssue } from "../server/issue-studio-compose";
import { emptyIssueStudioState } from "../shared/issue-studio";
const repository = process.cwd();
const staticDir = repository + "/public/designcraft";
function fixture(body = "A complete short article.", stale = false) {
  const template = {
    id: "fixture",
    name: "Fixture",
    kind: "story",
    storyCount: 1,
    slots: [
      {
        id: "headline",
        role: "headline",
        articleIndex: 0,
        rect: [36, 100, 720, 180],
        fontSize: 24,
      },
      { id: "body", role: "body", articleIndex: 0, rect: [36, 190, 720, 744] },
    ],
  };
  const placement = {
    id: "placement",
    articleId: "article",
    pageIds: ["p1"],
    sourceRevision: stale ? "old" : "source",
    currentSourceRevision: "source",
    included: true,
  };
  const input = {
    revision: 2,
    state: {
      ...emptyIssueStudioState(),
      pageBudget: 1,
      pages: [{ id: "p1", pageNumber: 1 }],
      placements: [placement],
      plannerState: {
        issueBundle: { layoutPlan: { cover: { articleIds: ["article"] } } },
        savedPages: [
          {
            id: "p1",
            pageNumber: 1,
            template,
            articleIds: ["article"],
            mode: "replace",
          },
        ],
      },
    },
    sources: [
      {
        id: "article",
        title: "Checked story",
        content: body,
        displayAuthor: "Anonymous",
        sourceRevision: "source",
        attachments: [],
      },
    ],
    profile: null,
    issue: { id: "test-issue", title: "Test issue", issueNumber: 1 },
    volume: { volumeNumber: 1 },
  };
  const files = new Map<string, Buffer>();
  let job: any = {
    id: "job-test",
    issueId: "test-issue",
    inputRevision: 2,
    status: "queued",
    input,
  };
  const backend = {
    read: async () => ({ success: true, job }),
    write: async (operation: string, data: any) => {
      if (operation === "requestIssueComposition")
        return { success: true, job };
      if (data.expectedStatus !== job.status) throw Error("status conflict");
      job = { ...job, status: data.status, result: data.result };
      return { success: true, job };
    },
  };
  const storage = {
    getFile: async (path: string) => files.get(path) ?? null,
    saveFile: async (path: string, buffer: Buffer) => {
      files.set(path, buffer);
      return true;
    },
  };
  return { files, backend, storage, job: () => job };
}

test("a saved issue really composes through WASM and persists exact checked output", async () => {
  const f = fixture();
  const response = await composeSavedIssue(
    { issueId: "test-issue", expectedRevision: 2, idempotencyKey: "fixture" },
    { backend: f.backend, storage: f.storage, staticDir },
  );
  expect(response.job.status, JSON.stringify(response.job.diagnostics)).toBe(
    "completed",
  );
  expect(response.job.composition).toMatchObject({
    revision: 2,
    status: "completed",
    errors: 0,
    copyPreserved: true,
  });
  expect(response.job.artifacts.map((a: any) => a.name)).toEqual(
    expect.arrayContaining([
      "saved-input.json",
      "composition-input.json",
      "issue.designcraft",
      "proof.pdf",
      "issue.idml",
      "preflight.json",
    ]),
  );
  expect(response.job.composition.artifactSha256).toMatch(/^[a-f0-9]{64}$/);
  const count = f.files.size;
  const repeated = await composeSavedIssue(
    { issueId: "test-issue", expectedRevision: 2, idempotencyKey: "fixture" },
    { backend: f.backend, storage: f.storage, staticDir },
  );
  expect(repeated.job.status).toBe("completed");
  expect(f.files.size).toBe(count);
}, 60000);

test("unaccepted source changes fail durably before engine execution, retaining the immutable input", async () => {
  const f = fixture("Changed copy", true);
  const result = await composeSavedIssue(
    { issueId: "test-issue", expectedRevision: 2, idempotencyKey: "stale" },
    { backend: f.backend, storage: f.storage, staticDir },
  );
  expect(result.job.status).toBe("failed");
  expect(result.job.diagnostics.message).toMatch(/Explicitly accept/);
  expect(result.job.artifacts.map((a: any) => a.name)).toEqual([
    "saved-input.json",
  ]);
});

test("overset composition preserves draft and diagnostics, with no final PDF or IDML artifact", async () => {
  const f = fixture("Long complete body. ".repeat(2000));
  const result = await composeSavedIssue(
    { issueId: "test-issue", expectedRevision: 2, idempotencyKey: "overset" },
    { backend: f.backend, storage: f.storage, staticDir },
  );
  expect(result.job.status).toBe("failed");
  expect(result.job.diagnostics.preflight.errors).toBeGreaterThan(0);
  expect(result.job.artifacts.map((a: any) => a.name)).toEqual(
    expect.arrayContaining([
      "saved-input.json",
      "draft.designcraft",
      "preflight.json",
    ]),
  );
  expect(result.job.artifacts.map((a: any) => a.name)).not.toContain(
    "proof.pdf",
  );
  expect(result.job.artifacts.map((a: any) => a.name)).not.toContain(
    "issue.idml",
  );
}, 60000);

test("real saved composition integrates transactional claims, immutable Convex storage and current verification status", async () => {
  const { convexTest } = await import("convex-test");
  const { default: schema } = await import("../convex/schema");
  const { api } = await import("../convex/_generated/api");
  const { fromWire, toWire } = await import("../shared/codec");
  const { vi } = await import("vitest");
  const { createHash } = await import("node:crypto");
  const secret = "saved-composition-integration";
  vi.stubEnv("CONVEX_SERVER_SECRET", secret);
  const t = convexTest(schema, import.meta.glob("../convex/**/*.{ts,js}"));
  const backend = {
    read: async (operation: string, data: any) =>
      fromWire(
        await t.query(api.app.read, { secret, operation, data: toWire(data) }),
      ) as any,
    write: async (operation: string, data: any) =>
      fromWire(
        await t.mutation(api.app.write, {
          secret,
          operation,
          data: toWire(data),
        }),
      ) as any,
  };
  const { volume } = await backend.write("createVolume", { volumeNumber: 932 });
  const { issue } = await backend.write("createIssue", {
    volumeId: volume.id,
    issueNumber: 1,
  });
  const { articleId } = await backend.write("createArticle", {
    title: "Live saved story",
    authorEmail: "runner@example.test",
    authorGivenName: "Run",
    authorSurname: "Writer",
    issueId: issue.id,
  });
  await backend.write("updateArticleContent", {
    articleId,
    content: "A complete saved story checked by the real engine.",
  });
  const initial = await backend.write("ensureIssueStudio", {
    issueId: issue.id,
  });
  const state = initial.state;
  state.pageBudget = 1;
  state.pages = [{ id: "p1", pageNumber: 1 }];
  state.placements[0].pageIds = ["p1"];
  state.placements[0].sourceRevision = initial.articles[0].sourceRevision;
  state.plannerState = {
    savedPages: [
      {
        id: "p1",
        pageNumber: 1,
        articleIds: [articleId],
        mode: "replace",
        template: {
          id: "story",
          name: "Story",
          kind: "story",
          storyCount: 1,
          slots: [
            {
              id: "body",
              role: "body",
              articleIndex: 0,
              rect: [36, 100, 720, 744],
            },
          ],
        },
      },
    ],
  };
  const saved = await backend.write("saveIssueStudio", {
    issueId: issue.id,
    expectedRevision: initial.plan.revision,
    state,
  });
  const storage = {
    getFile: async (path: string) =>
      t.run(async (ctx) => {
        const file = await ctx.db
          .query("storedFiles")
          .withIndex("by_path", (q) => q.eq("path", path))
          .unique();
        return file
          ? Buffer.from(
              await (await ctx.storage.get(file.storageId))!.arrayBuffer(),
            )
          : null;
      }),
    saveFile: async (path: string, bytes: Buffer) => {
      const storageId = await t.run((ctx) =>
        ctx.storage.store(new Blob([new Uint8Array(bytes)])),
      );
      return await t.mutation(api.files.finalize, {
        secret,
        path,
        storageId,
        size: bytes.length,
        mimeType: "application/octet-stream",
        sha256: createHash("sha256").update(bytes).digest("hex"),
      });
    },
  };
  const response = await composeSavedIssue(
    {
      issueId: issue.id,
      expectedRevision: saved.plan.revision,
      idempotencyKey: "actual",
      profile: {
        pageWidthPoints: 756,
        pageHeightPoints: 792,
        bleedPoints: [0, 0, 0, 0],
        pageMultiple: 1,
        preflightProfile: "Fixture Press",
        colorProfile: "Fixture CMYK",
        minImagePpi: 300,
      },
    },
    { backend, storage, staticDir },
  );
  expect(response.job.status, JSON.stringify(response.job.diagnostics)).toBe(
    "completed",
  );
  const view = await backend.read("getIssueStudio", { issueId: issue.id });
  expect(view.releaseReadiness.level).toBe("DesignCraft checked");
  expect(view.releaseReadiness.ready).toBe(false);
  expect(view.releaseReadiness.blockers.map((b: any) => b.code)).toContain(
    "adobe-identity",
  );
  // Synthetic operator evidence tests import integrity, not an Adobe runtime.
  const native = Buffer.from("synthetic-native-indd"),
    nativeSha = createHash("sha256").update(native).digest("hex");
  const nativePath = `issue-studio/${issue.id}/forks/${nativeSha}.indd`;
  await storage.saveFile(nativePath, native);
  await backend.write("recordNativeFork", {
    issueId: issue.id,
    expectedRevision: saved.plan.revision,
    path: nativePath,
    sha256: nativeSha,
    name: "Synthetic Adobe fixture",
  });
  const report = {
    schemaVersion: "ote.adobe-validation.v1",
    inputSha256: response.job.composition.inputSha256,
    artifactSha256: response.job.composition.artifactSha256,
    nativeSha256: nativeSha,
    checkedAt: "2026-10-21T00:00:00Z",
    application: {
      name: "Adobe InDesign",
      version: "synthetic",
      platform: "test",
    },
    checks: {
      missingFonts: [],
      invalidLinks: [],
      oversetStories: [],
      lowResolutionImages: [],
      minImagePpi: 300,
      pageCount: 1,
      pageWidthPoints: 756,
      pageHeightPoints: 792,
      bleedPoints: [0, 0, 0, 0],
      preflightProfile: "Fixture Press",
      preflightErrors: 0,
      colorProfile: "Fixture CMYK",
    },
    outputs: { native: "validated.indd" },
  };
  const printProfile = {
    pageWidthPoints: 756,
    pageHeightPoints: 792,
    bleedPoints: [0, 0, 0, 0],
    pageMultiple: 1,
    preflightProfile: "Fixture Press",
    colorProfile: "Fixture CMYK",
    minImagePpi: 300,
  };
  await expect(
    backend.write("recordIssueAdobeReport", {
      issueId: issue.id,
      jobId: response.job.id,
      report: { ...report, artifactSha256: "d".repeat(64) },
      nativePath,
      printProfile,
    }),
  ).rejects.toThrow(/does not identify/);
  const imported = await backend.write("recordIssueAdobeReport", {
    issueId: issue.id,
    jobId: response.job.id,
    report,
    nativePath,
    printProfile,
  });
  expect(imported.releaseReadiness.ready).toBe(true);
  expect(imported.releaseReadiness.level).toBe("Adobe verified");
  await backend.write("updateArticleContent", {
    articleId,
    content: "Updated after composition.",
  });
  const changed = await backend.read("getIssueStudio", { issueId: issue.id });
  expect(changed.releaseReadiness.ready).toBe(false);
  expect(changed.state.placements[0].stale).toBe(true);
  vi.unstubAllEnvs();
}, 60000);
