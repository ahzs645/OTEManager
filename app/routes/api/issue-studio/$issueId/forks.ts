import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/api/issue-studio/$issueId/forks")({
  server: { handlers: { POST: async ({ request, params }) => {
    const { handleIssueStudioFork } = await import("../../../../../server/issue-studio-forks");
    return handleIssueStudioFork(request, params.issueId);
  } } },
});
