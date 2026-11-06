import { createFileRoute } from "@tanstack/react-router";
export const Route = createFileRoute("/api/issue-studio/$issueId/adobe-report")(
  {
    server: {
      handlers: {
        POST: async ({ request, params }) => {
          try {
            if (Number(request.headers.get("content-length") ?? 0) > 256000)
              return Response.json(
                { error: "Adobe report is too large" },
                { status: 413 },
              );
            const text = await request.text();
            if (new TextEncoder().encode(text).length > 256000)
              return Response.json(
                { error: "Adobe report is too large" },
                { status: 413 },
              );
            const data = JSON.parse(text);
            const { mutate } = await import("../../../../../server/convex");
            const result = await (mutate as any)("recordIssueAdobeReport", {
              issueId: params.issueId,
              jobId: data.jobId,
              report: data.report,
              printProfile: data.printProfile,
              nativePath: data.nativePath,
            });
            return Response.json(result, {
              headers: { "Cache-Control": "no-store" },
            });
          } catch (error) {
            return Response.json(
              {
                error:
                  error instanceof Error
                    ? error.message
                    : "Adobe report import failed",
              },
              { status: 400 },
            );
          }
        },
      },
    },
  },
);
