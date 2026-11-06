import { createServerFn } from "@tanstack/react-start";
import type { IssueStudioState } from "../../shared/issue-studio";
import type { issueStudioQueries } from "../../convex/operations/issueStudio";
import { fromWire, toWire } from "../../shared/codec";

export type IssueStudioView = Awaited<
  ReturnType<typeof issueStudioQueries.getIssueStudio>
>;
// Recipes are bounded JSON validated by the database service. A JSON wire keeps
// extension fields out of TanStack's recursive serializer type inference.
const getIssueStudioWire = createServerFn({ method: "POST" })
  .inputValidator((data: { issueId: string }) => data)
  .handler(async ({ data }) => {
    const { query } = await import("../../server/convex");
    return JSON.stringify(toWire(await query("getIssueStudio", data)));
  });
const ensureIssueStudioWire = createServerFn({ method: "POST" })
  .inputValidator((data: { issueId: string }) => data)
  .handler(async ({ data }) => {
    const { mutate } = await import("../../server/convex");
    return JSON.stringify(toWire(await mutate("ensureIssueStudio", data)));
  });
const saveIssueStudioWire = createServerFn({ method: "POST" })
  .inputValidator(
    (data: { issueId: string; expectedRevision: number; stateJSON: string }) =>
      data,
  )
  .handler(async ({ data }) => {
    const { mutate } = await import("../../server/convex");
    return JSON.stringify(
      toWire(
        await mutate("saveIssueStudio", {
          issueId: data.issueId,
          expectedRevision: data.expectedRevision,
          state: JSON.parse(data.stateJSON),
        }),
      ),
    );
  });
export async function getIssueStudio(options: {
  data: { issueId: string };
}): Promise<IssueStudioView> {
  return fromWire(JSON.parse(await getIssueStudioWire(options)));
}
export async function ensureIssueStudio(options: {
  data: { issueId: string };
}): Promise<IssueStudioView> {
  return fromWire(JSON.parse(await ensureIssueStudioWire(options)));
}
export async function saveIssueStudio(options: {
  data: { issueId: string; expectedRevision: number; state: IssueStudioState };
}): Promise<IssueStudioView> {
  const { state, ...data } = options.data;
  return fromWire(
    JSON.parse(
      await saveIssueStudioWire({
        data: { ...data, stateJSON: JSON.stringify(state) },
      }),
    ),
  );
}

const archiveNativeForkWire = createServerFn({ method: "POST" })
  .inputValidator(
    (data: { issueId: string; forkId: string; expectedRevision: number }) =>
      data,
  )
  .handler(async ({ data }) => {
    const { mutate } = await import("../../server/convex");
    return JSON.stringify(toWire(await mutate("archiveNativeFork", data)));
  });
export async function archiveNativeFork(options: {
  data: { issueId: string; forkId: string; expectedRevision: number };
}): Promise<IssueStudioView> {
  return fromWire(JSON.parse(await archiveNativeForkWire(options)));
}
