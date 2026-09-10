import { ConvexHttpClient } from "convex/browser";
import { makeFunctionReference } from "convex/server";
import { fromWire, toWire } from "../shared/codec";
import type { queries } from "../convex/operations/queries";
import type { analytics } from "../convex/operations/analytics";
import type { mutations } from "../convex/operations/mutations";
import type {
  utilityQueries,
  utilityMutations,
} from "../convex/operations/utilities";
type Queries = Omit<typeof queries, "getUnpaidArticles"> &
  typeof analytics &
  typeof utilityQueries;
type Mutations = typeof mutations & typeof utilityMutations;
export function connection() {
  const url = process.env.CONVEX_URL || process.env.VITE_CONVEX_URL;
  const secret = process.env.CONVEX_SERVER_SECRET;
  if (!url || !secret)
    throw new Error(
      "Convex is not configured. Run npm run setup:local or set CONVEX_URL and CONVEX_SERVER_SECRET.",
    );
  return { client: new ConvexHttpClient(url), secret, url };
}
export async function query<K extends keyof Queries>(
  operation: K,
  data?: any,
): Promise<Awaited<ReturnType<Queries[K]>>> {
  const { client, secret } = connection();
  return fromWire(
    await client.query(makeFunctionReference<"query">("app:read"), {
      secret,
      operation,
      data: toWire(data),
    }),
  );
}
export async function mutate<K extends keyof Mutations>(
  operation: K,
  data?: any,
): Promise<Awaited<ReturnType<Mutations[K]>>> {
  const { client, secret } = connection();
  return fromWire(
    await client.mutation(makeFunctionReference<"mutation">("app:write"), {
      secret,
      operation,
      data: toWire(data),
    }),
  );
}
export async function mutationResult<K extends keyof Mutations>(
  operation: K,
  data?: any,
): Promise<
  Awaited<ReturnType<Mutations[K]>> | { success: false; error: string }
> {
  try {
    return await mutate(operation, data);
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : "Operation failed",
    };
  }
}
export async function health() {
  const { client, secret } = connection();
  return client.query(makeFunctionReference<"query">("app:health"), { secret });
}
