import { query, mutation } from "./_generated/server";
import { v } from "convex/values";
import { requireServer } from "./lib/auth";
import { Store } from "./lib/store";
import { tableNames } from "../shared/model";
import {
  parseManifest,
  mergeSnapshots,
  importOrder,
  manifestFor,
  type Snapshot,
} from "../shared/backup";
import { toDocument } from "../shared/records";
import { toWire, fromWire } from "../shared/codec";
async function snapshot(s: Store): Promise<Snapshot> {
  return Object.fromEntries(
    await Promise.all(tableNames.map(async (t) => [t, await s.all(t)])),
  ) as Snapshot;
}
export const exportData = query({
  args: { secret: v.string(), type: v.optional(v.string()) },
  handler: async (ctx, a) => {
    requireServer(a.secret);
    return toWire(manifestFor(await snapshot(new Store(ctx)), a.type));
  },
});
export const validate = query({
  args: {
    secret: v.string(),
    manifest: v.any(),
    mode: v.union(v.literal("merge"), v.literal("replace")),
  },
  handler: async (ctx, a) => {
    requireServer(a.secret);
    mergeSnapshots(
      await snapshot(new Store(ctx)),
      parseManifest(fromWire(a.manifest)),
      a.mode,
    );
    return true;
  },
});
export const restore = mutation({
  args: {
    secret: v.string(),
    manifest: v.any(),
    mode: v.union(v.literal("merge"), v.literal("replace")),
  },
  handler: async (ctx, a) => {
    requireServer(a.secret);
    const current = await snapshot(new Store(ctx)),
      incoming = parseManifest(fromWire(a.manifest));
    mergeSnapshots(current, incoming, a.mode);
    const stats: Record<string, { imported: number; skipped: number }> = {};
    // The complete record restore is one Convex transaction: validation failure commits nothing.
    if (a.mode === "replace")
      for (const t of [...importOrder].reverse())
        for (const row of await ctx.db.query(t).collect())
          await ctx.db.delete(row._id);
    for (const t of importOrder) {
      const existing = new Set(
        a.mode === "merge" ? current[t].map((r) => r.id) : [],
      );
      stats[t] = { imported: 0, skipped: 0 };
      for (const row of incoming[t]) {
        if (
          existing.has(row.id) ||
          (t === "paymentRateConfig" && a.mode === "merge" && current[t].length)
        ) {
          stats[t].skipped++;
          continue;
        }
        await ctx.db.insert(t, toDocument(t, row) as any);
        stats[t].imported++;
      }
    }
    return stats;
  },
});
