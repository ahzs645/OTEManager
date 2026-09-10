import { query, mutation } from "./_generated/server";
import { v } from "convex/values";
import { Store } from "./lib/store";
import { requireServer } from "./lib/auth";
import { tableNames, type TableName } from "../shared/model";
import { toWire, fromWire } from "../shared/codec";
function table(value: string): TableName {
  if (!(tableNames as readonly string[]).includes(value))
    throw new Error("Unknown table");
  return value as TableName;
}
export const list = query({
  args: { secret: v.string(), table: v.string() },
  handler: async (ctx, a) => {
    requireServer(a.secret);
    return toWire(await new Store(ctx).all(table(a.table)));
  },
});
export const get = query({
  args: { secret: v.string(), table: v.string(), id: v.string() },
  handler: async (ctx, a) => {
    requireServer(a.secret);
    return toWire(await new Store(ctx).get(table(a.table), a.id));
  },
});
export const insert = mutation({
  args: { secret: v.string(), table: v.string(), data: v.any() },
  handler: async (ctx, a) => {
    requireServer(a.secret);
    return toWire(
      await new Store(ctx).insert(table(a.table), fromWire(a.data)),
    );
  },
});
export const patch = mutation({
  args: {
    secret: v.string(),
    table: v.string(),
    id: v.string(),
    data: v.any(),
  },
  handler: async (ctx, a) => {
    requireServer(a.secret);
    return toWire(
      await new Store(ctx).patch(table(a.table), a.id, fromWire(a.data)),
    );
  },
});
