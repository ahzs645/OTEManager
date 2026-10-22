import { tableNames, type TableName, type RowMap } from "./model";
import { normalizeRecord } from "./records";
import { validateFilePath } from "./file-path";
export type Snapshot = { [T in TableName]: RowMap[T][] };
export const importOrder: TableName[] = [
  "authors",
  "volumes",
  "issues",
  "articles",
  "sourceArchiveLinks",
  "attachments",
  "articleMultimediaTypes",
  "articleNotes",
  "statusHistory",
  "paymentRateConfig",
  "paymentRateHistory",
  "savedArticleViews",
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
  const sourceAuthors = new Set<string>();
  for (const author of snapshot.authors)
    if (author.sourceAuthorKey) {
      if (sourceAuthors.has(author.sourceAuthorKey))
        throw new Error("Duplicate source author key in backup");
      sourceAuthors.add(author.sourceAuthorKey);
    }
  const sourceLinks = new Set<string>();
  for (const link of snapshot.sourceArchiveLinks) {
    const key = JSON.stringify([
      link.archiveId,
      link.sourceKey,
      link.publicationKey,
    ]);
    if (sourceLinks.has(key))
      throw new Error("Duplicate source archive link in backup");
    sourceLinks.add(key);
  }
  const emails = new Set<string>();
  for (const a of snapshot.authors) {
    const key = a.email.trim().toLowerCase();
    if (!key && a.sourceAuthorKey) continue;
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
    "sourceArchiveLinks",
  ] as const)
    for (const row of snapshot[table])
      if (!ids.get("articles")!.has(row.articleId))
        throw new Error(`${table} references a missing article`);
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
        ? { attachments: snapshot.attachments }
        : {
            ...data,
            paymentConfig: paymentRateConfig[0] || null,
            paymentRateHistory,
            savedViews: savedArticleViews,
          },
  };
}
