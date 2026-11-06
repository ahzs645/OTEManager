import type { Store } from "../lib/store";
import type { TableName, RowMap } from "../../shared/model";
import {
  emptyIssueStudioState,
  studioTableNames,
  type IssueStudioState,
  type IssueStudioPlacement,
} from "../../shared/issue-studio";
import {
  evaluateIssueRelease,
  compositionHasProvenance,
  validateAdobeReport,
  type IssuePrintProfile,
  type CheckedComposition,
} from "../../shared/issue-studio-production";
import { fromDocument } from "../../shared/records";
import { validateFilePath } from "../../shared/file-path";

const MAX_JSON_BYTES = 750_000;
function json(value: unknown): string {
  const encoded = JSON.stringify(value);
  if (
    typeof encoded !== "string" ||
    new TextEncoder().encode(encoded).length > MAX_JSON_BYTES ||
    new TextEncoder().encode(JSON.stringify(encoded)).length > 900_000
  )
    throw new Error(
      "Issue Studio data exceeds the 750 KB save limit; split this issue or reduce embedded recipe data.",
    );
  return encoded;
}
function parse<T>(value: string): T {
  return JSON.parse(value) as T;
}
function canonical(value: unknown): string {
  function ordered(v: any): any {
    if (Array.isArray(v)) return v.map(ordered);
    if (v && typeof v === "object")
      return Object.fromEntries(
        Object.keys(v)
          .sort()
          .map((k) => [k, ordered(v[k])]),
      );
    return v;
  }
  return json(ordered(value));
}
function placementChoices(p: IssueStudioPlacement) {
  const { locked, currentSourceRevision, stale, ...choices } = p;
  return choices;
}
/** Dependency fingerprint only, never an authentication or artifact-integrity hash. */
function fingerprint(value: unknown) {
  const encoded = JSON.stringify(value);
  let a = 2166136261,
    b = 5381;
  for (let i = 0; i < encoded.length; i++) {
    a = Math.imul(a ^ encoded.charCodeAt(i), 16777619);
    b = Math.imul(b, 33) ^ encoded.charCodeAt(i);
  }
  return `ote-source-v1:${(a >>> 0).toString(16)}${(b >>> 0).toString(16)}:${encoded.length}`;
}
async function rows<T extends TableName>(
  s: Store,
  table: T,
  field: string,
  value: string,
  limit = 1000,
): Promise<RowMap[T][]> {
  const docs = await s.ctx.db
    .query(table)
    .withIndex(`by_${field}`, (q) => q.eq(field, value))
    .take(limit + 1);
  if (docs.length > limit)
    throw new Error(`Issue Studio ${table} limit (${limit}) exceeded`);
  return docs.map((doc) => fromDocument(table, doc));
}
async function findPlan(s: Store, issueId: string) {
  const found = await rows(s, "issueDesignPlans", "issueId", issueId, 1);
  return found[0] ?? null;
}
async function ensurePlan(s: Store, issueId: string) {
  await s.require("issues", issueId);
  return (
    (await findPlan(s, issueId)) ??
    (await s.insert("issueDesignPlans", { issueId }))
  );
}
async function sources(
  s: Store,
  issueId: string,
  placements: IssueStudioPlacement[] = [],
) {
  const articles = await rows(s, "articles", "issueId", issueId, 200);
  return Promise.all(
    articles.map((article) =>
      sourceFor(
        s,
        article,
        placements.find((p) => p.articleId === article.id),
      ),
    ),
  );
}
async function sourceFor(
  s: Store,
  article: RowMap["articles"],
  placement?: IssueStudioPlacement,
) {
  const author = await s.get("authors", article.authorId);
  const attachments = await rows(s, "attachments", "articleId", article.id, 64);
  const choices = placement?.imageChoices;
  const chosenIds = Array.isArray(choices)
    ? new Set(
        choices
          .map((c) => (typeof c === "string" ? c : (c as any)?.attachmentId))
          .filter(Boolean),
      )
    : null;
  const media = attachments
    .filter(
      (a) =>
        ["photo", "graphic"].includes(a.attachmentType) &&
        (chosenIds ? chosenIds.has(a.id) : a.includeInExport !== false),
    )
    .sort((a, b) => a.id.localeCompare(b.id))
    .map((a) => ({
      id: a.id,
      filePath: a.filePath,
      fileSize: a.fileSize,
      mimeType: a.mimeType,
      caption: a.caption,
      photoNumber: a.photoNumber,
    }));
  const displayAuthor = article.prefersAnonymity
    ? "Anonymous"
    : author
      ? `${author.givenName} ${author.surname}`.trim()
      : "Unknown author";
  const mediaIdentity = await Promise.all(
    media.map(async (item) => {
      const file = await s.ctx.db
        .query("storedFiles")
        .withIndex("by_path", (q) => q.eq("path", item.filePath))
        .unique();
      return {
        ...item,
        storageRevision: file?.sha256 ?? file?.storageId ?? null,
      };
    }),
  );
  const sourceRevision = fingerprint({
    id: article.id,
    title: article.title,
    content: article.content,
    displayAuthor,
    media: mediaIdentity,
  });
  return {
    ...article,
    attachments,
    author: article.prefersAnonymity ? null : author,
    displayAuthor,
    sourceRevision,
    currentSourceRevision: sourceRevision,
  };
}
async function stateFor(
  s: Store,
  plan: NonNullable<Awaited<ReturnType<typeof findPlan>>>,
): Promise<IssueStudioState> {
  const [pages, placements, reservations] = await Promise.all([
    rows(s, "issuePages", "planId", plan.id, 256),
    rows(s, "issuePlacements", "planId", plan.id, 200),
    rows(s, "issueReservations", "planId", plan.id, 128),
  ]);
  return {
    pageBudget: plan.pageBudget,
    houseStyle: plan.houseStyle,
    pages: pages
      .map((p) => parse<any>(p.data))
      .sort((a, b) => a.pageNumber - b.pageNumber),
    placements: placements.map((p) => parse<any>(p.data)),
    reservations: reservations.map((p) => parse<any>(p.data)),
    plannerState: parse(plan.plannerState),
  };
}
async function view(s: Store, issueId: string) {
  const issue = await s.require("issues", issueId),
    plan = await findPlan(s, issueId);
  const state = plan ? await stateFor(s, plan) : emptyIssueStudioState();
  const articles = await sources(s, issueId, state.placements);
  state.placements = state.placements.map((p) => {
    const source = articles.find((a) => a.id === p.articleId);
    return {
      ...p,
      currentSourceRevision: source?.sourceRevision,
      stale: !!source && p.sourceRevision !== source.sourceRevision,
    };
  });
  const revisions = plan
    ? await s.ctx.db
        .query("issueDesignRevisions")
        .withIndex("by_planId", (q) => q.eq("planId", plan.id))
        .order("desc")
        .take(4)
    : [];
  const recentJobs = plan
    ? await s.ctx.db
        .query("compositionJobs")
        .withIndex("by_planId", (q) => q.eq("planId", plan.id))
        .order("desc")
        .take(4)
    : [];
  const activeForks = plan
    ? await s.ctx.db
        .query("compositionJobs")
        .withIndex("by_planId_and_status", (q: any) =>
          q.eq("planId", plan.id).eq("status", "native-fork-active"),
        )
        .take(201)
    : [];
  if (activeForks.length > 200)
    throw new Error("Archive old manual document forks before adding more");
  const adobeRows = plan
    ? await s.ctx.db
        .query("compositionJobs")
        .withIndex("by_planId_and_status", (q: any) =>
          q.eq("planId", plan.id).eq("status", "adobe-report"),
        )
        .order("desc")
        .take(20)
    : [];
  const completedRows = plan
    ? await s.ctx.db
        .query("compositionJobs")
        .withIndex("by_planId_and_status", (q: any) =>
          q.eq("planId", plan.id).eq("status", "completed"),
        )
        .order("desc")
        .take(1)
    : [];
  const jobs = [
    ...new Map(
      [...recentJobs, ...activeForks, ...adobeRows, ...completedRows].map(
        (j) => [j.id, j],
      ),
    ).values(),
  ];
  const composition =
    jobs
      .map((j) => parse<any>(j.data).result?.composition)
      .find(
        (c) => c?.status === "completed" && c?.revision === plan?.revision,
      ) ??
    completedRows
      .map((j) => parse<any>(j.data).result?.composition)
      .find((c) => c?.status === "completed") ??
    null;
  const evidence = adobeRows
    .map((j) => parse<any>(j.data))
    .find(
      (r) =>
        r.adobe?.inputSha256 === composition?.inputSha256 &&
        r.adobe?.artifactSha256 === composition?.artifactSha256,
    );

  return {
    success: true as const,
    issue,
    plan,
    state,
    articles,
    releaseReadiness: evaluateIssueRelease({
      state,
      revision: plan?.revision ?? 0,
      nativeForks: activeForks.map((j) => parse<any>(j.data).fork),
      composition,
      adobe: evidence?.adobe,
      printProfile: evidence?.printProfile,
    }),
    revisions: revisions.map(({ snapshot, _id, _creationTime, ...r }) => r),
    jobs: jobs.map(({ _id, _creationTime, data, ...j }) => ({
      ...j,
      result: parse<any>(data).result ?? null,
      kind: parse<any>(data).kind ?? "composition",
      fork: parse<any>(data).fork ?? null,
      adobe: parse<any>(data).adobe ?? null,
      printProfile: parse<any>(data).printProfile ?? null,
    })),
  };
}
function validateState(input: unknown): IssueStudioState {
  if (!input || typeof input !== "object" || Array.isArray(input))
    throw new Error("Issue Studio state is required");
  const state = parse<IssueStudioState>(json(input));
  if (
    !Number.isInteger(state.pageBudget) ||
    state.pageBudget < 1 ||
    state.pageBudget > 256
  )
    throw new Error("Page budget must be between 1 and 256");
  if (
    typeof state.houseStyle !== "string" ||
    !state.houseStyle.trim() ||
    state.houseStyle.length > 100
  )
    throw new Error("A valid house style is required");
  if (
    !Array.isArray(state.pages) ||
    state.pages.length > 256 ||
    !Array.isArray(state.placements) ||
    state.placements.length > 200 ||
    !Array.isArray(state.reservations) ||
    state.reservations.length > 128
  )
    throw new Error("Invalid Issue Studio collections");
  if (
    state.plannerState !== null &&
    (typeof state.plannerState !== "object" ||
      Array.isArray(state.plannerState))
  )
    throw new Error("Invalid planner recipe");
  const ids = new Set<string>();
  for (const item of [
    ...state.pages,
    ...state.placements,
    ...state.reservations,
  ]) {
    if (
      !item ||
      typeof item.id !== "string" ||
      !item.id.trim() ||
      item.id.length > 200 ||
      ids.has(item.id)
    )
      throw new Error(
        "Issue Studio object IDs must be unique nonempty strings",
      );
    ids.add(item.id);
  }
  const pageIds = new Set(state.pages.map((p) => p.id)),
    numbers = new Set<number>(),
    articleIds = new Set<string>();
  for (const p of state.pages) {
    if (
      !Number.isInteger(p.pageNumber) ||
      p.pageNumber < 1 ||
      p.pageNumber > state.pageBudget ||
      numbers.has(p.pageNumber)
    )
      throw new Error(
        "Pages must have unique numbers within the fixed page budget",
      );
    numbers.add(p.pageNumber);
  }
  for (const p of state.placements) {
    if (
      typeof p.articleId !== "string" ||
      articleIds.has(p.articleId) ||
      !Array.isArray(p.pageIds) ||
      new Set(p.pageIds).size !== p.pageIds.length ||
      p.pageIds.some((id) => !pageIds.has(id))
    )
      throw new Error("Invalid article placement or continuation chain");
    articleIds.add(p.articleId);
    if (
      p.priority !== undefined &&
      (typeof p.priority !== "number" ||
        !Number.isFinite(p.priority) ||
        p.priority < -1000 ||
        p.priority > 1000)
    )
      throw new Error("Story priority must be between -1000 and 1000");
    if (p.allowedPages !== undefined) {
      if (
        !Array.isArray(p.allowedPages) ||
        p.allowedPages.length > state.pageBudget ||
        new Set(p.allowedPages).size !== p.allowedPages.length ||
        p.allowedPages.some(
          (n) =>
            !Number.isSafeInteger(n) ||
            Number(n) < 1 ||
            Number(n) > state.pageBudget,
        )
      )
        throw new Error(
          "Allowed story pages must be unique page numbers within the fixed budget",
        );
      if (
        p.allowedPages.length &&
        p.pageIds.some(
          (id) =>
            !(p.allowedPages as number[]).includes(
              state.pages.find((page) => page.id === id)!.pageNumber,
            ),
        )
      )
        throw new Error("Story placement is outside its allowed page range");
    }
    if (p.imageChoices !== undefined && !Array.isArray(p.imageChoices))
      throw new Error("Invalid print image choices");
    const order = p.pageIds.map(
      (id) => state.pages.find((page) => page.id === id)!.pageNumber,
    );
    if (order.some((n, i) => i > 0 && n <= order[i - 1]))
      throw new Error("Continuation pages must follow reading order");
  }
  for (const r of state.reservations) {
    if (
      !Number.isInteger(r.pageNumber) ||
      r.pageNumber < 1 ||
      r.pageNumber > state.pageBudget ||
      !["booked-ad", "house-ad", "editorial"].includes(r.kind) ||
      !["pending", "ready"].includes(r.artworkStatus) ||
      !Array.isArray(r.rect) ||
      r.rect.length !== 4 ||
      r.rect.some((n) => typeof n !== "number" || !Number.isFinite(n))
    )
      throw new Error("Invalid reservation");
    const [x, y, w, h] = r.rect;
    if (x < 0 || y < 0 || w <= 0 || h <= 0 || x + w > 756 || y + h > 792)
      throw new Error("Reservation must fit inside the 756 × 792 point page");
    if (r.artworkPath) validateFilePath(r.artworkPath);
  }
  for (let i = 0; i < state.reservations.length; i++)
    for (let j = i + 1; j < state.reservations.length; j++) {
      const a = state.reservations[i],
        b = state.reservations[j];
      if (a.pageNumber !== b.pageNumber) continue;
      if (
        a.rect[0] < b.rect[0] + b.rect[2] &&
        b.rect[0] < a.rect[0] + a.rect[2] &&
        a.rect[1] < b.rect[1] + b.rect[3] &&
        b.rect[1] < a.rect[1] + a.rect[3]
      )
        throw new Error("Reservations may not overlap");
    }
  return state;
}
async function replaceObjects(
  s: Store,
  planId: string,
  issueId: string,
  state: IssueStudioState,
) {
  for (const [table, items] of [
    ["issuePages", state.pages],
    ["issuePlacements", state.placements],
    ["issueReservations", state.reservations],
  ] as const) {
    const existing = await rows(s, table, "planId", planId);
    const byId = new Map(
      existing.map((row) => [parse<{ id: string }>(row.data).id, row]),
    );
    for (const old of existing)
      if (!items.some((item) => item.id === parse<{ id: string }>(old.data).id))
        await s.delete(table, old.id);
    for (const item of items) {
      const data = {
        issueId,
        planId,
        data: json(item),
        updatedAt: new Date(),
        ...(table === "issuePlacements"
          ? { articleId: (item as IssueStudioPlacement).articleId }
          : {}),
      };
      const old = byId.get(item.id);
      if (old) await s.patch(table, old.id, data as any);
      else
        await s.insert(table, {
          id: `studio-${planId}-${item.id}`,
          ...data,
        } as any);
    }
  }
}
async function snapshot(
  s: Store,
  plan: NonNullable<Awaited<ReturnType<typeof findPlan>>>,
  state: IssueStudioState,
) {
  const articleSources = await sources(s, plan.issueId, state.placements);
  const issue = await s.require("issues", plan.issueId),
    volume = await s.require("volumes", issue.volumeId);
  const encoded = json({
    issue,
    volume,
    schemaVersion: "ote.issue-studio.revision.v1",
    revision: plan.revision,
    state,
    sources: articleSources,
  });
  await s.insert("issueDesignRevisions", {
    issueId: plan.issueId,
    planId: plan.id,
    revision: plan.revision,
    snapshot: encoded,
  });
}
function checkRevision(plan: { revision: number }, expected: unknown) {
  if (!Number.isSafeInteger(expected) || expected !== plan.revision)
    throw new Error(
      `Issue Studio revision conflict: current revision is ${plan.revision}. Reload before saving.`,
    );
}
export async function syncIssueStudioArticle(
  s: Store,
  articleId: string,
  previousIssueId?: string | null,
) {
  const article = await s.get("articles", articleId);
  const existing = await rows(s, "issuePlacements", "articleId", articleId, 16);
  const oldIssues = new Set(
    existing
      .filter((p) => p.issueId !== article?.issueId)
      .map((p) => p.issueId),
  );
  if (previousIssueId && previousIssueId !== article?.issueId)
    oldIssues.add(previousIssueId);
  for (const issueId of oldIssues) {
    const plan = await findPlan(s, issueId);
    if (!plan) continue;
    let changed = false;
    for (const p of existing.filter((p) => p.issueId === issueId)) {
      await s.delete("issuePlacements", p.id);
      changed = true;
    }
    if (changed)
      await s.patch("issueDesignPlans", plan.id, {
        revision: plan.revision + 1,
        updatedAt: new Date(),
      });
  }
  if (!article?.issueId) return;
  const plan = await ensurePlan(s, article.issueId),
    state = await stateFor(s, plan),
    source = await sourceFor(
      s,
      article,
      state.placements.find((p) => p.articleId === articleId),
    );
  if (!source) return;
  const placement = state.placements.find((p) => p.articleId === articleId);
  if (
    placement &&
    placement.currentSourceRevision === source.sourceRevision &&
    placement.imageChoices !== undefined
  )
    return;
  const imageChoices =
    placement?.imageChoices ??
    source.attachments
      .filter(
        (a) =>
          ["photo", "graphic"].includes(a.attachmentType) &&
          a.includeInExport !== false,
      )
      .map((a) => ({ attachmentId: a.id }));
  const updated = placement
    ? {
        ...placement,
        imageChoices,
        currentSourceRevision: source.sourceRevision,
      }
    : {
        imageChoices,
        id: `placement-${articleId}`,
        articleId,
        pageIds: [],
        included: true,
        sourceRevision: source.sourceRevision,
        currentSourceRevision: source.sourceRevision,
      };
  const old = existing.find((p) => p.issueId === article.issueId);
  if (old)
    await s.patch("issuePlacements", old.id, {
      data: json(updated),
      updatedAt: new Date(),
    });
  else
    await s.insert("issuePlacements", {
      id: `studio-${plan.id}-${updated.id}`,
      issueId: article.issueId,
      planId: plan.id,
      articleId,
      data: json(updated),
    });
  await s.patch("issueDesignPlans", plan.id, {
    revision: plan.revision + 1,
    updatedAt: new Date(),
  });
}
export async function invalidateIssueStudioMetadata(s: Store, issueId: string) {
  const plan = await findPlan(s, issueId);
  if (!plan) return;
  const next = await s.patch("issueDesignPlans", plan.id, {
    revision: plan.revision + 1,
    updatedAt: new Date(),
  });
  await snapshot(s, next, await stateFor(s, next));
}
export async function detachIssueStudioArticle(s: Store, articleId: string) {
  const placements = await rows(
    s,
    "issuePlacements",
    "articleId",
    articleId,
    16,
  );
  for (const p of placements) {
    await s.delete("issuePlacements", p.id);
    const plan = await s.get("issueDesignPlans", p.planId);
    if (plan)
      await s.patch("issueDesignPlans", plan.id, {
        revision: plan.revision + 1,
        updatedAt: new Date(),
      });
  }
}
export async function deleteIssueStudio(s: Store, issueId: string) {
  for (const table of [...studioTableNames].reverse())
    for (const row of await rows(s, table, "issueId", issueId, 2000))
      await s.delete(table, row.id);
}
async function compositionJob(
  s: Store,
  issueId: string,
  jobId: string,
): Promise<RowMap["compositionJobs"] & Record<string, any>> {
  const job = await s.require("compositionJobs", jobId);
  if (job.issueId !== issueId)
    throw new Error("Composition job belongs to another issue");
  return { ...job, ...parse<Record<string, any>>(job.data) };
}
export const issueStudioQueries = {
  getIssueCompositionJob: async (
    s: Store,
    data: { issueId: string; jobId: string },
  ) => ({
    success: true as const,
    job: await compositionJob(s, data.issueId, data.jobId),
  }),
  getIssueStudio: async (s: Store, data: { issueId: string }) =>
    view(s, data.issueId),
};
export const issueStudioMutations = {
  async recordIssueAdobeReport(
    s: Store,
    data: {
      issueId: string;
      jobId: string;
      report: unknown;
      printProfile: IssuePrintProfile;
      nativePath: string;
    },
  ) {
    const job = await compositionJob(s, data.issueId, data.jobId),
      report = validateAdobeReport(data.report);
    if (
      !job.input?.profile ||
      canonical(job.input.profile) !== canonical(data.printProfile)
    )
      throw new Error(
        "Recompose with the approved print profile before importing Adobe evidence",
      );
    const composition = job.result?.composition as
      CheckedComposition | undefined;
    if (
      job.status !== "completed" ||
      !composition ||
      report.inputSha256 !== composition.inputSha256 ||
      report.artifactSha256 !== composition.artifactSha256
    )
      throw new Error(
        "Adobe report does not identify this completed composition input and IDML artifact",
      );
    validateFilePath(data.nativePath);
    if (
      !data.nativePath.startsWith(`issue-studio/${data.issueId}/`) ||
      !/\.(indd|indt)$/i.test(data.nativePath)
    )
      throw new Error(
        "Adobe evidence requires an issue-scoped native InDesign document",
      );
    const file = await s.ctx.db
      .query("storedFiles")
      .withIndex("by_path", (q) => q.eq("path", data.nativePath))
      .unique();
    if (!file || file.sha256 !== report.nativeSha256)
      throw new Error(
        "Native InDesign bytes do not match the imported Adobe report",
      );
    const detail = {
      kind: "adobe-report",
      jobId: job.id,
      adobe: report,
      printProfile: data.printProfile,
      nativePath: data.nativePath,
    };
    const id = `adobe-${job.id}-${report.nativeSha256}-${Date.parse(report.checkedAt)}`;
    const existing = await s.get("compositionJobs", id);
    if (existing && canonical(parse(existing.data)) !== canonical(detail))
      throw new Error(
        "An immutable Adobe report already exists for this evidence identity",
      );
    if (!existing)
      await s.insert("compositionJobs", {
        id,
        issueId: data.issueId,
        planId: job.planId,
        inputRevision: job.inputRevision,
        status: "adobe-report",
        data: json(detail),
      });
    return view(s, data.issueId);
  },
  async recordNativeFork(
    s: Store,
    data: {
      issueId: string;
      expectedRevision: number;
      path: string;
      sha256: string;
      name?: string;
    },
  ) {
    const plan = await ensurePlan(s, data.issueId);
    checkRevision(plan, data.expectedRevision);
    validateFilePath(data.path);
    if (
      !data.path.startsWith(`issue-studio/${data.issueId}/`) ||
      !/^[a-f0-9]{64}$/.test(data.sha256) ||
      !/\.(designcraft|idml|indd|indt)$/i.test(data.path)
    )
      throw new Error("Native fork must be an immutable issue document");
    const file = await s.ctx.db
      .query("storedFiles")
      .withIndex("by_path", (q) => q.eq("path", data.path))
      .unique();
    if (!file || file.sha256 !== data.sha256)
      throw new Error(
        "Native fork bytes have not been stored with the recorded checksum",
      );
    const id = `native-fork-${plan.id}-${plan.revision}-${data.sha256}`;
    if (!(await s.get("compositionJobs", id)))
      await s.insert("compositionJobs", {
        id,
        issueId: data.issueId,
        planId: plan.id,
        inputRevision: plan.revision,
        status: "native-fork-active",
        data: json({
          kind: "native-fork",
          fork: {
            id,
            sourceRevision: plan.revision,
            artifactSha256: data.sha256,
            status: "active",
            path: data.path,
            name:
              typeof data.name === "string"
                ? data.name.slice(0, 200)
                : data.path.split("/").pop(),
          },
        }),
      });
    return view(s, data.issueId);
  },
  async archiveNativeFork(
    s: Store,
    data: { issueId: string; forkId: string; expectedRevision: number },
  ) {
    const plan = await ensurePlan(s, data.issueId);
    checkRevision(plan, data.expectedRevision);
    const job = await s.require("compositionJobs", data.forkId),
      detail = parse<any>(job.data);
    if (
      job.issueId !== data.issueId ||
      detail.kind !== "native-fork" ||
      !detail.fork
    )
      throw new Error("Native fork does not belong to this issue");
    if (job.status !== "native-fork-archived")
      await s.patch("compositionJobs", job.id, {
        status: "native-fork-archived",
        updatedAt: new Date(),
        data: json({ ...detail, fork: { ...detail.fork, status: "archived" } }),
      });
    return view(s, data.issueId);
  },
  async transitionIssueComposition(
    s: Store,
    data: {
      issueId: string;
      jobId: string;
      expectedStatus: "queued" | "running";
      status: "running" | "completed" | "failed";
      workerId?: string;
      result?: {
        composition?: CheckedComposition;
        artifacts?: { path: string; sha256: string }[];
        diagnostics?: unknown;
      };
    },
  ) {
    const job = await compositionJob(s, data.issueId, data.jobId);
    if (
      !["queued", "running"].includes(data.expectedStatus) ||
      !["running", "completed", "failed"].includes(data.status)
    )
      throw new Error("Invalid composition job transition");
    if (job.status !== data.expectedStatus)
      throw new Error(
        `Composition status conflict: current status is ${job.status}`,
      );
    if (data.status === "running" && job.status !== "queued")
      throw new Error("Only queued jobs can be claimed");
    if (data.status !== "running" && job.status !== "running")
      throw new Error("Claim the composition job before recording a result");
    if (job.workerId && job.workerId !== data.workerId)
      throw new Error("Composition job is owned by another worker");
    if (
      typeof data.workerId !== "string" ||
      !data.workerId.trim() ||
      data.workerId.length > 100
    )
      throw new Error("Composition worker identity is required");
    if (data.status === "completed") {
      const c = data.result?.composition;
      if (
        !c ||
        c.status !== "completed" ||
        c.revision !== job.inputRevision ||
        !compositionHasProvenance(c) ||
        c.errors !== 0 ||
        c.copyPreserved !== true
      )
        throw new Error(
          "Completed composition requires complete provenance and recorded checks",
        );
      if (
        !Array.isArray(data.result?.artifacts) ||
        !data.result.artifacts.length ||
        data.result.artifacts.length > 20
      )
        throw new Error(
          "Completed composition requires immutable output artifacts",
        );
      let foundOutput = false;
      for (const artifact of data.result.artifacts) {
        validateFilePath(artifact.path);
        if (
          !artifact.path.startsWith(`issue-studio/${data.issueId}/`) ||
          !/^[a-f0-9]{64}$/.test(artifact.sha256)
        )
          throw new Error("Invalid issue output artifact identity");
        const file = await s.ctx.db
          .query("storedFiles")
          .withIndex("by_path", (q) => q.eq("path", artifact.path))
          .unique();
        if (!file || file.sha256 !== artifact.sha256)
          throw new Error(
            "Composition output bytes have not been stored with the recorded checksum",
          );
        if (artifact.sha256 === c.artifactSha256) foundOutput = true;
      }
      if (!foundOutput)
        throw new Error(
          "Composition checks do not identify a stored output artifact",
        );
    }
    if (new TextEncoder().encode(json(data.result ?? null)).length > 100_000)
      throw new Error(
        "Composition result metadata exceeds 100 KB; store full diagnostics as an immutable artifact",
      );
    const { input, idempotencyKey } = parse<Record<string, unknown>>(job.data);
    await s.patch("compositionJobs", job.id, {
      status: data.status,
      updatedAt: new Date(),
      data: json({
        input,
        idempotencyKey,
        workerId: data.workerId,
        result: data.result ?? null,
      }),
    });
    return {
      success: true as const,
      job: await compositionJob(s, data.issueId, data.jobId),
    };
  },
  async ensureIssueStudio(s: Store, data: { issueId: string }) {
    await ensurePlan(s, data.issueId);
    for (const a of await rows(s, "articles", "issueId", data.issueId, 200))
      await syncIssueStudioArticle(s, a.id);
    return view(s, data.issueId);
  },
  async saveIssueStudio(
    s: Store,
    data: {
      issueId: string;
      expectedRevision: number;
      state: IssueStudioState;
    },
  ) {
    const plan = await ensurePlan(s, data.issueId);
    checkRevision(plan, data.expectedRevision);
    const state = validateState(data.state);
    const previous = await stateFor(s, plan);
    const previousSources = await sources(s, data.issueId, previous.placements);
    for (const p of state.placements) {
      const old = previous.placements.find((n) => n.articleId === p.articleId);
      const current = previousSources.find((a) => a.id === p.articleId);
      if (
        old &&
        current &&
        p.currentSourceRevision &&
        p.currentSourceRevision !== current.sourceRevision
      )
        throw new Error(
          "Issue Studio source revision conflict: article changed after loading. Reload before saving.",
        );
    }
    const articleSources = await sources(s, data.issueId, state.placements),
      sourceIds = new Set(articleSources.map((a) => a.id));
    for (const p of state.placements) {
      if (!sourceIds.has(p.articleId))
        throw new Error("Placement article is not assigned to this issue");
      const source = articleSources.find((a) => a.id === p.articleId)!;
      for (const choice of p.imageChoices ?? []) {
        const id =
          typeof choice === "string" ? choice : (choice as any)?.attachmentId;
        const oldPlacement = previous.placements.find((old) => old.id === p.id);
        const retainedStaleChoice =
          oldPlacement &&
          p.sourceRevision === oldPlacement.sourceRevision &&
          p.sourceRevision !== source.sourceRevision &&
          (oldPlacement.imageChoices ?? []).some(
            (old) => canonical(old) === canonical(choice),
          );
        if (
          !id ||
          (!source.attachments.some(
            (a) =>
              a.id === id && ["photo", "graphic"].includes(a.attachmentType),
          ) &&
            !retainedStaleChoice)
        )
          throw new Error(
            "Print image choice is not an image belonging to this article",
          );
      }
      const accepted = p.sourceRevision === p.currentSourceRevision;
      p.currentSourceRevision = source.sourceRevision;
      if (!p.sourceRevision || accepted)
        p.sourceRevision = source.sourceRevision;
      if (p.imageChoices === undefined)
        p.imageChoices = source.attachments
          .filter(
            (a) =>
              ["photo", "graphic"].includes(a.attachmentType) &&
              a.includeInExport !== false,
          )
          .map((a) => ({ attachmentId: a.id }));
      delete p.stale;
    }
    // Membership is distinct from inclusion and placement: an omitted story remains unplaced.
    for (const a of articleSources)
      if (!state.placements.some((p) => p.articleId === a.id))
        state.placements.push({
          id: `placement-${a.id}`,
          articleId: a.id,
          pageIds: [],
          included: true,
          imageChoices: a.attachments
            .filter(
              (m) =>
                ["photo", "graphic"].includes(m.attachmentType) &&
                m.includeInExport !== false,
            )
            .map((m) => ({ attachmentId: m.id })),
          sourceRevision: a.sourceRevision,
          currentSourceRevision: a.sourceRevision,
        });
    for (const p of previous.pages.filter((p) => p.locked))
      if (
        canonical({
          ...state.pages.find((n) => n.id === p.id),
          locked: true,
        }) !== canonical(p)
      )
        throw new Error("Unlock the page before changing its saved layout");
    for (const p of previous.placements.filter((p) => p.locked)) {
      const next = state.placements.find((n) => n.id === p.id);
      if (
        !next ||
        canonical(placementChoices(next)) !== canonical(placementChoices(p))
      )
        throw new Error(
          "Unlock the placement before changing its saved choices",
        );
    }
    for (const r of previous.reservations.filter((r) => r.locked)) {
      const next = state.reservations.find((n) => n.id === r.id);
      if (
        !next ||
        canonical({
          pageNumber: next.pageNumber,
          rect: next.rect,
          kind: next.kind,
        }) !==
          canonical({ pageNumber: r.pageNumber, rect: r.rect, kind: r.kind })
      )
        throw new Error(
          "Unlock the reservation before changing its position or dimensions",
        );
    }
    const previousSaved = Array.isArray(previous.plannerState?.savedPages)
      ? (previous.plannerState.savedPages as any[])
      : [];
    const nextSaved = Array.isArray(state.plannerState?.savedPages)
      ? (state.plannerState.savedPages as any[])
      : [];
    for (const page of previous.pages.filter((p) => p.locked)) {
      const beforePlacements = previous.placements
        .filter((p) => p.pageIds.includes(page.id))
        .map(placementChoices)
        .sort((a, b) => a.id.localeCompare(b.id));
      const afterPlacements = state.placements
        .filter((p) => p.pageIds.includes(page.id))
        .map(placementChoices)
        .sort((a, b) => a.id.localeCompare(b.id));
      if (canonical(beforePlacements) !== canonical(afterPlacements))
        throw new Error(
          "Unlock the page before changing its article placements",
        );
      const adPositions = (reservations: IssueStudioState["reservations"]) =>
        reservations
          .filter((r) => r.pageNumber === page.pageNumber)
          .map((r) => ({ id: r.id, rect: r.rect, kind: r.kind }))
          .sort((a, b) => a.id.localeCompare(b.id));
      if (
        canonical(adPositions(previous.reservations)) !==
        canonical(adPositions(state.reservations))
      )
        throw new Error(
          "Unlock the page before changing its advertisement positions",
        );
      const before = previousSaved.find((p) => p?.id === page.id) ?? null,
        after = nextSaved.find((p) => p?.id === page.id) ?? null;
      if (canonical(before) !== canonical(after))
        throw new Error(
          "Unlock the page before changing its saved planner recipe",
        );
    }
    const previousMedia = Array.isArray(previous.plannerState?.mediaOverrides)
      ? (previous.plannerState.mediaOverrides as any[])
      : [];
    const nextMedia = Array.isArray(state.plannerState?.mediaOverrides)
      ? (state.plannerState.mediaOverrides as any[])
      : [];
    for (const placement of previous.placements.filter((p) => p.locked))
      if (
        canonical(
          previousMedia.filter((m) => m?.articleId === placement.articleId),
        ) !==
        canonical(nextMedia.filter((m) => m?.articleId === placement.articleId))
      )
        throw new Error(
          "Unlock the placement before changing its saved image crop",
        );
    const assetRefs = state.plannerState?.assetRefs;
    if (assetRefs !== undefined) {
      if (
        !assetRefs ||
        typeof assetRefs !== "object" ||
        Array.isArray(assetRefs)
      )
        throw new Error("Invalid issue artwork references");
      for (const path of Object.values(assetRefs)) {
        if (
          typeof path !== "string" ||
          !path.startsWith(`issue-studio/${data.issueId}/`)
        )
          throw new Error("Artwork reference belongs to another issue");
        validateFilePath(path);
        if (
          !(await s.ctx.db
            .query("storedFiles")
            .withIndex("by_path", (q) => q.eq("path", path))
            .unique())
        )
          throw new Error("Referenced issue artwork has not been uploaded");
      }
    }
    for (const r of state.reservations)
      if (
        r.artworkStatus === "ready" &&
        !r.artworkPath &&
        r.kind !== "editorial"
      )
        throw new Error(
          "Ready advertisement artwork requires an uploaded file",
        );
    for (const r of state.reservations)
      if (r.artworkPath) {
        const file = await s.ctx.db
          .query("storedFiles")
          .withIndex("by_path", (q) => q.eq("path", r.artworkPath!))
          .unique();
        const attached = articleSources.some((a) =>
          a.attachments.some((m) => m.filePath === r.artworkPath),
        );
        const uploaded = r.artworkPath.startsWith(
          `issue-studio/${data.issueId}/`,
        );
        const existing = previous.reservations.some(
          (old) => old.id === r.id && old.artworkPath === r.artworkPath,
        );
        if (!file || (!attached && !uploaded && !existing))
          throw new Error(
            "Advertisement artwork must reference an existing file uploaded to this issue",
          );
      }
    await replaceObjects(s, plan.id, data.issueId, state);
    const next = await s.patch("issueDesignPlans", plan.id, {
      revision: plan.revision + 1,
      pageBudget: state.pageBudget,
      houseStyle: state.houseStyle,
      plannerState: json(state.plannerState),
      updatedAt: new Date(),
    });
    await snapshot(s, next, state);
    return view(s, data.issueId);
  },
  async requestIssueComposition(
    s: Store,
    data: {
      issueId: string;
      expectedRevision: number;
      idempotencyKey: string;
      profile?: unknown;
      finalRelease?: boolean;
    },
  ) {
    const plan = await ensurePlan(s, data.issueId);
    checkRevision(plan, data.expectedRevision);
    if (
      typeof data.idempotencyKey !== "string" ||
      !data.idempotencyKey.trim() ||
      data.idempotencyKey.length > 100
    )
      throw new Error("A bounded idempotency key is required");
    const id = `composition-${plan.id}-${data.idempotencyKey}`,
      existing = await s.get("compositionJobs", id);
    if (existing) {
      if (existing.inputRevision !== plan.revision)
        throw new Error(
          "Composition idempotency key already belongs to another revision",
        );
      return { success: true as const, job: existing };
    }
    const state = await stateFor(s, plan);
    if (data.finalRelease) {
      const approved = await view(s, data.issueId),
        readiness = approved.releaseReadiness;
      if (!readiness.ready)
        throw new Error(
          "Final release blocked: " +
            readiness.blockers.map((b) => b.message).join(" "),
        );
      const completed = approved.jobs.find(
        (j) =>
          j.result?.composition?.revision === plan.revision &&
          j.result?.composition?.status === "completed",
      )?.result?.composition;
      const evidence = approved.jobs.find(
        (j) =>
          j.kind === "adobe-report" &&
          j.adobe?.inputSha256 === completed?.inputSha256 &&
          j.adobe?.artifactSha256 === completed?.artifactSha256,
      );
      if (
        !evidence ||
        canonical(evidence.printProfile) !== canonical(data.profile ?? null)
      )
        throw new Error(
          "Final release must use the Adobe-verified print profile",
        );
    }
    const issue = await s.require("issues", data.issueId);
    const volume = await s.require("volumes", issue.volumeId);
    const input = {
      schemaVersion: "ote.issue-studio.composition.v1",
      issue,
      volume,
      revision: plan.revision,
      state,
      sources: await sources(s, data.issueId, state.placements),
      profile: data.profile ?? null,
    };
    if (new TextEncoder().encode(json(input)).length > 550_000)
      throw new Error(
        "Composition input exceeds 550 KB; reduce embedded recipe data before composing so diagnostic results can be recorded safely",
      );
    const job = await s.insert("compositionJobs", {
      id,
      issueId: data.issueId,
      planId: plan.id,
      inputRevision: plan.revision,
      status: "queued",
      data: json({ input, idempotencyKey: data.idempotencyKey }),
    });
    return { success: true as const, job };
  },
};
