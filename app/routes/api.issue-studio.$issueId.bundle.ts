import { createFileRoute } from "@tanstack/react-router";

export async function handleStudioBundle(issueId: string) {
  const { query } = await import("../../server/convex");
  const { buildDesignCraftIssueZip } =
    await import("../../server/designcraft-export");
  const { getStorage } = await import("../../storage");
  try {
    const [studio, issueView] = await Promise.all([
      query("getIssueStudio", { issueId }),
      query("getIssueById", { id: issueId }),
    ]);
    if (!issueView.issue)
      return Response.json({ error: "Issue not found" }, { status: 404 });
    const placements = new Map(
      studio.state.placements.map((p) => [p.articleId, p]),
    );
    const articles = studio.articles
      .filter((a) => placements.get(a.id)?.included !== false)
      .map((article) => {
        const choices = placements.get(article.id)?.imageChoices;
        const selected = Array.isArray(choices)
          ? new Map(
              choices.map((choice: any) => [
                typeof choice === "string" ? choice : choice.attachmentId,
                choice,
              ]),
            )
          : null;
        return {
          ...article,
          attachments: article.attachments.map((attachment) => {
            const choice: any = selected?.get(attachment.id);
            return {
              ...attachment,
              includeInExport: selected
                ? selected.has(attachment.id)
                : attachment.includeInExport,
              caption: [
                choice && typeof choice.caption === "string"
                  ? choice.caption
                  : attachment.caption,
                choice &&
                typeof choice.credit === "string" &&
                choice.credit.trim()
                  ? `Credit: ${choice.credit.trim()}`
                  : "",
              ]
                .filter(Boolean)
                .join(" — "),
              photoNumber: selected
                ? [...selected.keys()].indexOf(attachment.id) + 1
                : attachment.photoNumber,
            };
          }),
        };
      });
    const bytes = await buildDesignCraftIssueZip(
      issueView.issue,
      articles,
      getStorage(),
    );
    return new Response(new Uint8Array(bytes), {
      headers: {
        "Content-Type": "application/zip",
        "Cache-Control": "no-store",
        "Content-Disposition": 'attachment; filename="issue-studio.zip"',
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch (error) {
    return Response.json(
      {
        error: error instanceof Error ? error.message : "Could not load issue",
      },
      { status: 400 },
    );
  }
}
export const Route = createFileRoute("/api/issue-studio/$issueId/bundle")({
  server: {
    handlers: { GET: ({ params }) => handleStudioBundle(params.issueId) },
  },
});
