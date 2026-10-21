import { tableNames, type TableName, type RowMap } from "./model";
import { normalizeRecord } from "./records";
import { validateFilePath } from "./file-path";
import { collectBackupFiles } from "./issue-studio-assets";
export type Snapshot = { [T in TableName]: RowMap[T][] };
export const importOrder: TableName[] = [
  "authors",
  "volumes",
  "issues",
  "articles",
  "attachments",
  "articleMultimediaTypes",
  "articleNotes",
  "statusHistory",
  "paymentRateConfig",
  "paymentRateHistory",
  "savedArticleViews",
  "issueDesignPlans",
  "issuePages",
  "issuePlacements",
  "issueReservations",
  "issueDesignRevisions",
  "compositionJobs",
];
export function parseManifest(manifest: any): Snapshot {
  if (
    !manifest ||
    !["1.0", "2.0"].includes(manifest.exportVersion) ||
    !manifest.data
  )
    throw new Error("Unsupported or malformed backup manifest");
  const data = manifest.data;
  const snapshot = Object.fromEntries(
    tableNames.map((table) => {
      const source =
        table === "paymentRateConfig"
          ? data.paymentConfig
            ? [data.paymentConfig]
            : data.paymentRateConfig || []
          : table === "savedArticleViews"
            ? data.savedViews || data.savedArticleViews || []
            : data[table] || [];
      if (!Array.isArray(source)) throw new Error(`Invalid ${table} array`);
      return [table, source.map((row) => normalizeRecord(table, row))];
    }),
  ) as Snapshot;
  for (const a of snapshot.attachments) validateFilePath(a.filePath);
  return snapshot;
}
export function validateSnapshot(snapshot: Snapshot) {
  const ids = new Map<TableName, Set<string>>();
  for (const table of tableNames) {
    const set = new Set<string>();
    for (const row of snapshot[table]) {
      if (set.has(row.id)) throw new Error(`Duplicate ID in ${table}`);
      set.add(row.id);
    }
    ids.set(table, set);
  }
  const emails = new Set<string>();
  for (const a of snapshot.authors) {
    const key = a.email.trim().toLowerCase();
    if (emails.has(key)) throw new Error("Duplicate author email in backup");
    emails.add(key);
  }
  const volumes = new Set<number>();
  for (const v of snapshot.volumes) {
    if (volumes.has(v.volumeNumber)) throw new Error("Duplicate volume number");
    volumes.add(v.volumeNumber);
  }
  const issues = new Set<string>();
  for (const i of snapshot.issues) {
    const key = `${i.volumeId}:${i.issueNumber}`;
    if (issues.has(key)) throw new Error("Duplicate issue number");
    issues.add(key);
    if (!ids.get("volumes")!.has(i.volumeId))
      throw new Error("Issue references a missing volume");
  }
  for (const a of snapshot.articles) {
    if (!ids.get("authors")!.has(a.authorId))
      throw new Error("Article references a missing author");
    if (a.issueId && !ids.get("issues")!.has(a.issueId))
      throw new Error("Article references a missing issue");
  }
  for (const table of [
    "attachments",
    "articleMultimediaTypes",
    "articleNotes",
    "statusHistory",
  ] as const)
    for (const row of snapshot[table])
      if (!ids.get("articles")!.has(row.articleId))
        throw new Error(`${table} references a missing article`);
  const plans = new Map(snapshot.issueDesignPlans.map((p) => [p.id, p]));
  const plannedIssues = new Set<string>();
  for (const plan of snapshot.issueDesignPlans) {
    if (!ids.get("issues")!.has(plan.issueId))
      throw new Error("Issue Studio plan references a missing issue");
    if (plannedIssues.has(plan.issueId))
      throw new Error("Duplicate Issue Studio plan for an issue");
    plannedIssues.add(plan.issueId);
    if (plan.pageBudget < 1 || plan.pageBudget > 256 || plan.revision < 0)
      throw new Error("Invalid Issue Studio plan settings");
    JSON.parse(plan.plannerState);
  }
  for (const table of [
    "issuePages",
    "issuePlacements",
    "issueReservations",
    "issueDesignRevisions",
    "compositionJobs",
  ] as const)
    for (const row of snapshot[table]) {
      const plan = plans.get(row.planId);
      if (!plan || plan.issueId !== row.issueId)
        throw new Error(`${table} references a missing or mismatched plan`);
      const encoded = "snapshot" in row ? row.snapshot : row.data;
      if (new TextEncoder().encode(encoded).length > 750000)
        throw new Error("Issue Studio backup record exceeds save limit");
      JSON.parse(encoded);
      if (table === "issuePlacements") {
        const placement = row as RowMap["issuePlacements"];
        if (
          !snapshot.articles.some(
            (a) =>
              a.id === placement.articleId && a.issueId === placement.issueId,
          )
        )
          throw new Error(
            "Placement references a missing or reassigned article",
          );
      }
    }
  for (const plan of snapshot.issueDesignPlans) {
    const pages = snapshot.issuePages
      .filter((p) => p.planId === plan.id)
      .map((p) => JSON.parse(p.data));
    const pageIds = new Set<string>(),
      pageNumbers = new Set<number>(),
      objectIds = new Set<string>(),
      articleIds = new Set<string>();
    for (const p of pages) {
      if (
        typeof p.id !== "string" ||
        !p.id ||
        objectIds.has(p.id) ||
        !Number.isInteger(p.pageNumber) ||
        p.pageNumber < 1 ||
        p.pageNumber > plan.pageBudget ||
        pageNumbers.has(p.pageNumber)
      )
        throw new Error("Invalid or duplicate Issue Studio page in backup");
      pageIds.add(p.id);
      objectIds.add(p.id);
      pageNumbers.add(p.pageNumber);
    }
    for (const row of snapshot.issuePlacements.filter(
      (p) => p.planId === plan.id,
    )) {
      const p = JSON.parse(row.data);
      if (
        typeof p.id !== "string" ||
        !p.id ||
        objectIds.has(p.id) ||
        p.articleId !== row.articleId ||
        articleIds.has(p.articleId) ||
        !Array.isArray(p.pageIds) ||
        new Set(p.pageIds).size !== p.pageIds.length ||
        p.pageIds.some((id: string) => !pageIds.has(id))
      )
        throw new Error("Invalid Issue Studio placement graph in backup");
      objectIds.add(p.id);
      articleIds.add(p.articleId);
    }
    for (const row of snapshot.issueReservations.filter(
      (r) => r.planId === plan.id,
    )) {
      const r = JSON.parse(row.data);
      if (
        typeof r.id !== "string" ||
        !r.id ||
        objectIds.has(r.id) ||
        !Number.isInteger(r.pageNumber) ||
        r.pageNumber < 1 ||
        r.pageNumber > plan.pageBudget ||
        !Array.isArray(r.rect) ||
        r.rect.length !== 4 ||
        r.rect.some(
          (n: unknown) => typeof n !== "number" || !Number.isFinite(n),
        ) ||
        r.rect[0] < 0 ||
        r.rect[1] < 0 ||
        r.rect[2] <= 0 ||
        r.rect[3] <= 0 ||
        r.rect[0] + r.rect[2] > 756 ||
        r.rect[1] + r.rect[3] > 792
      )
        throw new Error("Invalid Issue Studio reservation in backup");
      objectIds.add(r.id);
      if (r.artworkPath) validateFilePath(r.artworkPath);
    }
  }
  if (snapshot.paymentRateConfig.length > 1)
    throw new Error("Only one current payment configuration is allowed");
  if (snapshot.savedArticleViews.filter((v) => v.isDefault).length > 1)
    throw new Error("Only one default saved view is allowed");
}
export function mergeSnapshots(
  existing: Snapshot,
  incoming: Snapshot,
  mode: "merge" | "replace",
) {
  if (mode === "replace") {
    validateSnapshot(incoming);
    return incoming;
  }
  const merged = Object.fromEntries(
    tableNames.map((table) => {
      const rows = new Map(existing[table].map((r) => [r.id, r]));
      for (const row of incoming[table])
        if (!rows.has(row.id) && !(table === "paymentRateConfig" && rows.size))
          rows.set(row.id, row);
      return [table, [...rows.values()]];
    }),
  ) as Snapshot;
  validateSnapshot(merged);
  return merged;
}
export function manifestFor(snapshot: Snapshot, type = "both") {
  const { paymentRateConfig, paymentRateHistory, savedArticleViews, ...data } =
    snapshot;
  return {
    exportVersion: "2.0",
    exportedAt: new Date().toISOString(),
    backupType: type,
    counts: Object.fromEntries(tableNames.map((t) => [t, snapshot[t].length])),
    data:
      type === "files"
        ? {
            attachments: snapshot.attachments,
            referencedFiles: collectBackupFiles(snapshot),
          }
        : {
            ...data,
            paymentConfig: paymentRateConfig[0] || null,
            paymentRateHistory,
            savedViews: savedArticleViews,
          },
  };
}
