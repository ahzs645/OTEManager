import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/api/source-archive/import")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        try {
          const { previewSourceArchive, importSourceArchive, readSourceArchiveRequest } = await import("../../../../server/source-archive");
          const payload = await readSourceArchiveRequest(request);
          const result = payload.preview
            ? await previewSourceArchive(payload.manifest, payload.issueIds, payload.files)
            : await importSourceArchive(payload.manifest, payload.issueIds, payload.previewToken, payload.files);
          return Response.json(result);
        } catch (error) {
          return Response.json({ success: false, error: error instanceof Error ? error.message : "Source archive import failed." }, { status: (error as {status?: number})?.status === 413 ? 413 : 400 });
        }
      },
    },
  },
});
