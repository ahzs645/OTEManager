import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/api/issue-studio/$issueId/assets")({
  server: {
    handlers: {
      POST: async ({ request, params }) => {
        const { handleIssueStudioAsset } = await import("../../../../../server/issue-studio-assets");
        return handleIssueStudioAsset(request, params.issueId);
      },
    },
  },
});
