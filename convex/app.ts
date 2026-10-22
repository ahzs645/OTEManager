import { query, mutation } from "./_generated/server";
import { v } from "convex/values";
import { requireServer } from "./lib/auth";
import { Store } from "./lib/store";
import { queries } from "./operations/queries";
import { analytics } from "./operations/analytics";
import { mutations } from "./operations/mutations";
import { fromWire, toWire } from "../shared/codec";
import { utilityQueries, utilityMutations } from "./operations/utilities";
import {
  sourceArchiveQueries,
  sourceArchiveMutations,
} from "./operations/sourceArchive";
const queryOperations = {
  ...queries,
  ...analytics,
  ...utilityQueries,
  ...sourceArchiveQueries,
};
const writeOperations = {
  ...mutations,
  ...utilityMutations,
  ...sourceArchiveMutations,
};
// Only the trusted application server can call this bridge. Operation names are allowlisted.
export const read = query({
  args: { secret: v.string(), operation: v.string(), data: v.any() },
  returns: v.any(),
  handler: async (ctx, args) => {
    requireServer(args.secret);
    if (!Object.hasOwn(queryOperations, args.operation))
      throw new Error("Unknown query");
    const fn = queryOperations[args.operation as keyof typeof queryOperations];
    return toWire(
      await (fn as any)(new Store(ctx), fromWire(args.data) ?? undefined),
    );
  },
});
export const write = mutation({
  args: { secret: v.string(), operation: v.string(), data: v.any() },
  returns: v.any(),
  handler: async (ctx, args) => {
    requireServer(args.secret);
    if (!Object.hasOwn(writeOperations, args.operation))
      throw new Error("Unknown mutation");
    const fn = writeOperations[args.operation as keyof typeof writeOperations];
    return toWire(
      await (fn as any)(new Store(ctx), fromWire(args.data) ?? undefined),
    );
  },
});
export const health = query({
  args: { secret: v.string() },
  returns: v.any(),
  handler: async (ctx, args) => {
    requireServer(args.secret);
    await ctx.db.query("articles").first();
    return { database: "convex", storage: "convex" };
  },
});
