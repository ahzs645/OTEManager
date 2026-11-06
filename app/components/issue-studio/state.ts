import type { IssueStudioState } from "../../../shared/issue-studio";

/** Reconcile planner page identities without replacing source acceptance or locks. */
export function mergePlannerRecipe(
  value: IssueStudioState,
  recipe: Record<string, unknown>,
): IssueStudioState {
  const saved = Array.isArray(recipe.savedPages)
    ? (recipe.savedPages as Array<Record<string, unknown>>)
    : [];
  const pages = saved.map((page, index) => ({
    ...value.pages.find((p) => p.id === page.id || p.pageNumber === index + 1),
    id: String(page.id),
    pageNumber: index + 1,
    templateId:
      typeof page.templateId === "string" ? page.templateId : undefined,
  }));
  const placements = value.placements.map((placement) => ({
    ...placement,
    pageIds: saved
      .filter(
        (page) =>
          (page.template as { kind?: string } | undefined)?.kind !== "cover" &&
          page.kind !== "cover" &&
          Array.isArray(page.articleIds) &&
          page.articleIds.includes(placement.articleId),
      )
      .map((page) => String(page.id)),
  }));
  const issueBundle =
    recipe.issueBundle && typeof recipe.issueBundle === "object"
      ? { ...recipe.issueBundle, articles: [] }
      : undefined;
  return {
    ...value,
    plannerState: { ...recipe, ...(issueBundle ? { issueBundle } : {}) },
    pages,
    placements,
  };
}

/** Remove only references to stories that have left the editorial issue. */
export function reconcileDepartedStories(
  value: IssueStudioState,
  articleIds: string[],
): IssueStudioState {
  const next = JSON.parse(JSON.stringify(value)) as IssueStudioState;
  const allowed = new Set(articleIds);
  const recipe = next.plannerState;
  if (!recipe) return next;
  if (Array.isArray(recipe.articleIds))
    recipe.articleIds = recipe.articleIds.filter((id) => allowed.has(id));
  if (Array.isArray(recipe.savedPages))
    for (const page of recipe.savedPages) {
      if (Array.isArray(page.articleIds))
        page.articleIds = page.articleIds.filter((id: string) =>
          allowed.has(id),
        );
    }
  const bundle = recipe.issueBundle as
    | {
        layoutPlan?: {
          cover?: { articleIds?: string[] };
          articleFlows?: Record<string, unknown>;
        };
      }
    | undefined;
  if (bundle?.layoutPlan?.cover?.articleIds)
    bundle.layoutPlan.cover.articleIds =
      bundle.layoutPlan.cover.articleIds.filter((id) => allowed.has(id));
  if (bundle?.layoutPlan?.articleFlows)
    for (const id of Object.keys(bundle.layoutPlan.articleFlows))
      if (!allowed.has(id)) delete bundle.layoutPlan.articleFlows[id];
  return next;
}
