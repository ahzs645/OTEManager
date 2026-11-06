import type { Store } from "./store";

// Existing storage paths are immutable while an editable plan or recorded
// revision references them. Uploads already use UUID paths; replace artwork by
// uploading a new path instead of changing bytes behind an approved revision.
// Fail closed if the bounded legacy JSON scan cannot establish non-use. A future
// asset-reference index can replace this conservative retention policy.
function containsPath(input: unknown, path: string): boolean {
  const pending: unknown[] = [input];
  let inspected = 0;
  while (pending.length) {
    if (++inspected > 50_000) return true;
    const value = pending.pop();
    if (typeof value === "string") {
      if (value === path) return true;
      if (value.startsWith("{") || value.startsWith("[")) {
        try {
          pending.push(JSON.parse(value));
        } catch {
          /* Not a serialized record. */
        }
      }
    } else if (Array.isArray(value)) {
      for (const item of value) pending.push(item);
    } else if (value && typeof value === "object")
      for (const [key, item] of Object.entries(value)) {
        if (key === path) return true;
        pending.push(item);
      }
  }
  return false;
}

export async function isIssueStudioFileReferenced(
  s: Store,
  path: string,
): Promise<boolean> {
  for (const table of [
    "issueDesignPlans",
    "issuePages",
    "issuePlacements",
    "issueReservations",
    "issueDesignRevisions",
    "compositionJobs",
  ] as const) {
    const records = await s.ctx.db.query(table).take(513);
    if (records.length > 512) return true;
    for (const record of records) if (containsPath(record, path)) return true;
  }
  return false;
}
