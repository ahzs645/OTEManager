import { createFileRoute } from "@tanstack/react-router";
export const Route = createFileRoute("/api/issue-studio/$issueId/compose")({
  server: {
    handlers: {
      POST: async ({ request, params }) => {
        const { handleIssueStudioCompose } =
          await import("../../../../../server/issue-studio-compose");
        return handleIssueStudioCompose(request, params.issueId);
      },
    },
  },
});
