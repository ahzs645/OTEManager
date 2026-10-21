import { convexTest } from "convex-test";
import { beforeEach, expect, test, vi } from "vitest";
import schema from "../convex/schema";
import { api } from "../convex/_generated/api";
import { fromWire, toWire } from "../shared/codec";
const modules = import.meta.glob("../convex/**/*.{ts,js}");
const secret = "studio-test-secret";
beforeEach(() => vi.stubEnv("CONVEX_SERVER_SECRET", secret));
function setup() {
  const t = convexTest(schema, modules);
  const write = async (operation: string, data?: unknown) =>
    fromWire(
      await t.mutation(api.app.write, {
        secret,
        operation,
        data: toWire(data),
      }),
    );
  const read = async (operation: string, data?: unknown) =>
    fromWire(
      await t.query(api.app.read, { secret, operation, data: toWire(data) }),
    );
  return { t, write, read };
}
async function issue(write: ReturnType<typeof setup>["write"]) {
  const { volume } = await write("createVolume", { volumeNumber: 1 });
  return (await write("createIssue", { volumeId: volume.id, issueNumber: 1 }))
    .issue;
}
async function article(
  write: ReturnType<typeof setup>["write"],
  issueId: string,
) {
  return (
    await write("createArticle", {
      title: "Original",
      authorGivenName: "Test",
      authorSurname: "Writer",
      authorEmail: "writer@example.test",
      issueId,
    })
  ).articleId;
}

test("empty issues persist reservations, reject stale saves, and restore normalized plans", async () => {
  const { t, write, read } = setup(),
    i = await issue(write);
  const first = await write("ensureIssueStudio", { issueId: i.id });
  expect((await write("ensureIssueStudio", { issueId: i.id })).plan.id).toBe(
    first.plan.id,
  );
  const state = {
    ...first.state,
    pageBudget: 4,
    pages: [{ id: "page-1", pageNumber: 1 }],
    reservations: [
      {
        id: "ad-1",
        pageNumber: 1,
        rect: [378, 396, 378, 396],
        kind: "booked-ad",
        artworkStatus: "pending",
      },
    ],
  };
  const saved = await write("saveIssueStudio", {
    issueId: i.id,
    expectedRevision: first.plan.revision,
    state,
  });
  expect(saved.plan.revision).toBe(first.plan.revision + 1);
  expect(saved.releaseReadiness.blockers.map((b: any) => b.code)).toContain(
    "booked-ad-artwork",
  );
  await expect(
    write("saveIssueStudio", {
      issueId: i.id,
      expectedRevision: first.plan.revision,
      state,
    }),
  ).rejects.toThrow("revision conflict");
  const reopened = await read("getIssueStudio", { issueId: i.id });
  expect(reopened.state).toEqual(saved.state);
  const manifest = await t.query(api.backup.exportData, { secret });
  await t.mutation(api.backup.restore, { secret, manifest, mode: "replace" });
  expect((await read("getIssueStudio", { issueId: i.id })).state).toEqual(
    saved.state,
  );
  expect(
    (await read("getIssueStudio", { issueId: i.id })).revisions,
  ).toHaveLength(1);
});

test("source changes stale locked work while administrative edits preserve the revision", async () => {
  const { t, write, read } = setup(),
    i = await issue(write),
    id = await article(write, i.id);
  const initial = await write("ensureIssueStudio", { issueId: i.id });
  const state = {
    ...initial.state,
    pages: [{ id: "p1", pageNumber: 1, locked: true }],
    placements: initial.state.placements.map((p: any) => ({
      ...p,
      pageIds: ["p1"],
      locked: true,
      imageChoices: [],
    })),
  };
  const saved = await write("saveIssueStudio", {
    issueId: i.id,
    expectedRevision: initial.plan.revision,
    state,
  });
  await write("updateArticleTier", {
    articleId: id,
    tier: "Tier 2 (Standard)",
  });
  expect((await read("getIssueStudio", { issueId: i.id })).plan.revision).toBe(
    saved.plan.revision,
  );
  await write("updateArticleContent", {
    articleId: id,
    content: "New copy with a different length",
  });
  const changed = await read("getIssueStudio", { issueId: i.id });
  expect(changed.state.placements[0].stale).toBe(true);
  expect(changed.state.pages[0].locked).toBe(true);
  expect(changed.state.placements[0].sourceRevision).toBe(
    saved.state.placements[0].sourceRevision,
  );
  const revision = await t.run((ctx) =>
    ctx.db.query("issueDesignRevisions").first(),
  );
  expect(JSON.parse(revision!.snapshot).sources[0].content).toBeNull();
  await expect(
    write("saveIssueStudio", {
      issueId: i.id,
      expectedRevision: saved.plan.revision,
      state,
    }),
  ).rejects.toThrow("revision conflict");
});

test("duplicate assignment retries stay singular and explicit print choices stay separate from export preferences", async () => {
  const { write, read } = setup(),
    i = await issue(write),
    id = await article(write, i.id);
  await write("updateArticleIssue", { articleId: id, issueId: i.id });
  await write("updateArticleIssue", { articleId: id, issueId: i.id });
  let current = await write("ensureIssueStudio", { issueId: i.id });
  expect(current.state.placements).toHaveLength(1);
  const { attachment } = await write("addAttachment", {
    articleId: id,
    attachmentType: "photo",
    fileName: "image.jpg",
    originalFileName: "image.jpg",
    filePath: "image.jpg",
  });
  current = await read("getIssueStudio", { issueId: i.id });
  current.state.placements[0].imageChoices = [
    { attachmentId: attachment.id, crop: { x: 0.2, y: 0.1 } },
  ];
  current.state.placements[0].sourceRevision =
    current.articles[0].sourceRevision;
  current = await write("saveIssueStudio", {
    issueId: i.id,
    expectedRevision: current.plan.revision,
    state: current.state,
  });
  await write("setAttachmentsIncludeInExport", {
    attachmentIds: [attachment.id],
    includeInExport: false,
  });
  const updated = await read("getIssueStudio", { issueId: i.id });
  expect(updated.state.placements[0].imageChoices).toEqual([
    { attachmentId: attachment.id, crop: { x: 0.2, y: 0.1 } },
  ]);
  expect(updated.state.placements[0].stale).toBe(false);
});

test("invalid continuation, overlap, oversized snapshot, and final-release requests fail atomically", async () => {
  const { write, read } = setup(),
    i = await issue(write),
    id = await article(write, i.id),
    current = await write("ensureIssueStudio", { issueId: i.id });
  const save = (state: any) =>
    write("saveIssueStudio", {
      issueId: i.id,
      expectedRevision: current.plan.revision,
      state,
    });
  await expect(
    save({
      ...current.state,
      pages: [{ id: "p1", pageNumber: 1 }],
      placements: [{ id: "placement", articleId: id, pageIds: ["missing"] }],
    }),
  ).rejects.toThrow("continuation");
  const ad = {
    id: "a",
    pageNumber: 1,
    rect: [0, 0, 100, 100],
    kind: "booked-ad",
    artworkStatus: "pending",
  };
  await expect(
    save({ ...current.state, reservations: [ad, { ...ad, id: "b" }] }),
  ).rejects.toThrow("overlap");
  await expect(
    save({ ...current.state, plannerState: { huge: "x".repeat(750001) } }),
  ).rejects.toThrow("750 KB");
  expect((await read("getIssueStudio", { issueId: i.id })).plan.revision).toBe(
    current.plan.revision,
  );
  await expect(
    write("requestIssueComposition", {
      issueId: i.id,
      expectedRevision: current.plan.revision,
      idempotencyKey: "release",
      finalRelease: true,
    }),
  ).rejects.toThrow("Final release blocked");
  const input = {
    issueId: i.id,
    expectedRevision: current.plan.revision,
    idempotencyKey: "draft",
  };
  const job = await write("requestIssueComposition", input);
  expect((await write("requestIssueComposition", input)).job.id).toBe(
    job.job.id,
  );
  expect(job.job.status).toBe("queued");
});

test("locked choices require an unlock-only save and cross-issue artwork is rejected", async () => {
  const { write } = setup(),
    i = await issue(write),
    id = await article(write, i.id);
  let current = await write("ensureIssueStudio", { issueId: i.id });
  current.state.pages = [{ id: "p", pageNumber: 1 }];
  current.state.placements[0] = {
    ...current.state.placements[0],
    pageIds: ["p"],
    locked: true,
  };
  current = await write("saveIssueStudio", {
    issueId: i.id,
    expectedRevision: current.plan.revision,
    state: current.state,
  });
  const changed = structuredClone(current.state);
  changed.placements[0].pageIds = [];
  await expect(
    write("saveIssueStudio", {
      issueId: i.id,
      expectedRevision: current.plan.revision,
      state: changed,
    }),
  ).rejects.toThrow("Unlock the placement");
  current.state.placements[0].locked = false;
  current = await write("saveIssueStudio", {
    issueId: i.id,
    expectedRevision: current.plan.revision,
    state: current.state,
  });
  current.state.placements[0].pageIds = [];
  await write("saveIssueStudio", {
    issueId: i.id,
    expectedRevision: current.plan.revision,
    state: current.state,
  });
  current = await write("ensureIssueStudio", { issueId: i.id });
  current.state.plannerState = {
    assetRefs: { "assets/user-ad.png": "issue-studio/other-issue/ad.png" },
  };
  await expect(
    write("saveIssueStudio", {
      issueId: i.id,
      expectedRevision: current.plan.revision,
      state: current.state,
    }),
  ).rejects.toThrow("another issue");
});

test("composition jobs claim once, retain immutable inputs, and require stored artifact checksums", async () => {
  const { t, write, read } = setup(),
    i = await issue(write),
    current = await write("ensureIssueStudio", { issueId: i.id });
  const { job } = await write("requestIssueComposition", {
    issueId: i.id,
    expectedRevision: current.plan.revision,
    idempotencyKey: "worker",
  });
  const fetched = await read("getIssueCompositionJob", {
    issueId: i.id,
    jobId: job.id,
  });
  expect(fetched.job.input.issue.id).toBe(i.id);
  const claim = {
    issueId: i.id,
    jobId: job.id,
    expectedStatus: "queued",
    status: "running",
    workerId: "worker-one",
  };
  await write("transitionIssueComposition", claim);
  await expect(write("transitionIssueComposition", claim)).rejects.toThrow(
    "status conflict",
  );
  await expect(
    write("transitionIssueComposition", {
      ...claim,
      expectedStatus: "running",
      status: "failed",
      workerId: "worker-two",
    }),
  ).rejects.toThrow("another worker");
  const checksum = "a".repeat(64),
    path = `issue-studio/${i.id}/${checksum}.idml`;
  const composition = {
    revision: current.plan.revision,
    inputSha256: "b".repeat(64),
    status: "completed",
    artifactSha256: checksum,
    errors: 0,
    copyPreserved: true,
    provenance: {
      sourceSha256: checksum,
      mediaSha256: checksum,
      templateSha256: checksum,
      fontsSha256: checksum,
      printProfileSha256: checksum,
      engineVersion: "test-engine",
    },
  };
  const finish = {
    ...claim,
    expectedStatus: "running",
    status: "completed",
    result: { composition, artifacts: [{ path, sha256: checksum }] },
  };
  await expect(write("transitionIssueComposition", finish)).rejects.toThrow(
    "not been stored",
  );
  const storageId = await t.run((ctx) =>
    ctx.storage.store(new Blob(["fixture output"])),
  );
  await t.mutation(api.files.finalize, {
    secret,
    path,
    storageId,
    size: 14,
    mimeType: "application/octet-stream",
    sha256: checksum,
  });
  await write("transitionIssueComposition", finish);
  await expect(write("transitionIssueComposition", finish)).rejects.toThrow(
    "status conflict",
  );
  const final = await read("getIssueStudio", { issueId: i.id });
  expect(final.releaseReadiness.level).toBe("DesignCraft checked");
  expect(final.releaseReadiness.ready).toBe(false);
  expect(final.jobs[0].input).toBeUndefined();
  expect(
    (await read("getIssueCompositionJob", { issueId: i.id, jobId: job.id })).job
      .input,
  ).toEqual(fetched.job.input);
});

test("locked pages protect the nested recipe and locked placements protect focal overrides", async () => {
  const { write } = setup(),
    i = await issue(write),
    id = await article(write, i.id);
  let current = await write("ensureIssueStudio", { issueId: i.id });
  current.state.pages = [{ id: "p", pageNumber: 1, locked: true }];
  current.state.placements[0] = {
    ...current.state.placements[0],
    pageIds: ["p"],
    locked: true,
  };
  current.state.plannerState = {
    savedPages: [
      { id: "p", template: { slots: [{ id: "body", rect: [1, 2, 3, 4] }] } },
    ],
    mediaOverrides: [],
  };
  current = await write("saveIssueStudio", {
    issueId: i.id,
    expectedRevision: current.plan.revision,
    state: current.state,
  });
  const recipe = structuredClone(current.state);
  recipe.plannerState.savedPages[0].template.slots[0].rect = [3, 4, 5, 6];
  await expect(
    write("saveIssueStudio", {
      issueId: i.id,
      expectedRevision: current.plan.revision,
      state: recipe,
    }),
  ).rejects.toThrow("planner recipe");
  const crop = structuredClone(current.state);
  crop.plannerState.mediaOverrides = [
    { articleId: id, photoId: "photo", focus: [0.2, 0.4] },
  ];
  await expect(
    write("saveIssueStudio", {
      issueId: i.id,
      expectedRevision: current.plan.revision,
      state: crop,
    }),
  ).rejects.toThrow("image crop");
  const constraint = structuredClone(current.state);
  constraint.placements[0].allowedPages = [2];
  await expect(
    write("saveIssueStudio", {
      issueId: i.id,
      expectedRevision: current.plan.revision,
      state: constraint,
    }),
  ).rejects.toThrow("allowed page range");
});

test("synthetic Adobe evidence is immutable, checks native bytes and profile identity, and preserves manual forks", async () => {
  const { t, write } = setup(),
    i = await issue(write);
  let current = await write("ensureIssueStudio", { issueId: i.id });
  current.state.pageBudget = 1;
  current.state.pages = [{ id: "p", pageNumber: 1 }];
  current = await write("saveIssueStudio", {
    issueId: i.id,
    expectedRevision: current.plan.revision,
    state: current.state,
  });
  const sha = "a".repeat(64),
    nativeSha = "c".repeat(64),
    inputSha = "b".repeat(64),
    path = `issue-studio/${i.id}/${sha}.idml`,
    nativePath = `issue-studio/${i.id}/forks/${nativeSha}.indd`;
  const profile = {
    pageWidthPoints: 756,
    pageHeightPoints: 792,
    bleedPoints: [0, 0, 0, 0],
    pageMultiple: 1,
    preflightProfile: "Synthetic test",
    colorProfile: "Synthetic CMYK",
    minImagePpi: 300,
  };
  const { job } = await write("requestIssueComposition", {
    issueId: i.id,
    expectedRevision: current.plan.revision,
    idempotencyKey: "evidence",
    profile,
  });
  for (const [filePath, checksum] of [
    [path, sha],
    [nativePath, nativeSha],
  ]) {
    const storageId = await t.run((ctx) =>
      ctx.storage.store(new Blob(["synthetic test bytes"])),
    );
    await t.mutation(api.files.finalize, {
      secret,
      path: filePath,
      storageId,
      size: 20,
      mimeType: "application/octet-stream",
      sha256: checksum,
    });
  }
  const worker = { issueId: i.id, jobId: job.id, workerId: "test-worker" };
  await write("transitionIssueComposition", {
    ...worker,
    expectedStatus: "queued",
    status: "running",
  });
  await write("transitionIssueComposition", {
    ...worker,
    expectedStatus: "running",
    status: "completed",
    result: {
      composition: {
        revision: current.plan.revision,
        inputSha256: inputSha,
        status: "completed",
        artifactSha256: sha,
        errors: 0,
        copyPreserved: true,
        provenance: {
          sourceSha256: sha,
          mediaSha256: sha,
          templateSha256: sha,
          fontsSha256: sha,
          printProfileSha256: sha,
          engineVersion: "synthetic-engine",
        },
      },
      artifacts: [{ path, sha256: sha }],
    },
  });
  current = await write("recordNativeFork", {
    issueId: i.id,
    expectedRevision: current.plan.revision,
    path: nativePath,
    sha256: nativeSha,
    name: "Synthetic document.indd",
  });
  const fork = current.jobs.find((j: any) => j.kind === "native-fork");
  expect(fork.fork.status).toBe("active");
  expect(current.releaseReadiness.ready).toBe(false);
  const report = {
    schemaVersion: "ote.adobe-validation.v1",
    inputSha256: inputSha,
    artifactSha256: sha,
    nativeSha256: nativeSha,
    checkedAt: "2026-10-21T19:00:00Z",
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
      preflightProfile: profile.preflightProfile,
      preflightErrors: 0,
      colorProfile: profile.colorProfile,
    },
    outputs: { native: "Synthetic document.indd" },
  };
  await expect(
    write("recordIssueAdobeReport", {
      issueId: i.id,
      jobId: job.id,
      report,
      printProfile: { ...profile, minImagePpi: 200 },
      nativePath,
    }),
  ).rejects.toThrow("approved print profile");
  current = await write("recordIssueAdobeReport", {
    issueId: i.id,
    jobId: job.id,
    report,
    printProfile: profile,
    nativePath,
  });
  expect(current.releaseReadiness.ready).toBe(true);
  expect(current.releaseReadiness.level).toBe("Adobe verified");
  current = await write("archiveNativeFork", {
    issueId: i.id,
    forkId: fork.id,
    expectedRevision: current.plan.revision,
  });
  expect(current.jobs.find((j: any) => j.id === fork.id).fork.status).toBe(
    "archived",
  );
  await expect(
    write("recordIssueAdobeReport", {
      issueId: i.id,
      jobId: job.id,
      report: { ...report, checks: { ...report.checks, preflightErrors: 1 } },
      printProfile: profile,
      nativePath,
    }),
  ).rejects.toThrow("immutable Adobe report");
});
