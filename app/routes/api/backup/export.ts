import { createFileRoute } from "@tanstack/react-router";
export const Route = createFileRoute("/api/backup/export")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        try {
          const type = new URL(request.url).searchParams.get("type") || "both";
          if (!["both", "database", "files"].includes(type))
            return Response.json(
              { error: "Invalid backup type" },
              { status: 400 },
            );
          const { exportManifest } = await import("../../../../server/backup");
          const { getStorage } = await import("../../../../storage");
          const { default: archiver } = await import("archiver");
          const { Readable } = await import("node:stream");
          const manifest = await exportManifest(type),
            archive = archiver("zip", { zlib: { level: 1 } }),
            storage = getStorage();
          const body = Readable.toWeb(archive) as ReadableStream<Uint8Array>;
          const waitEntry = () =>
            new Promise<void>((resolve, reject) => {
              const onError = (e: Error) => {
                archive.off("entry", onEntry);
                reject(e);
              };
              const onEntry = () => {
                archive.off("error", onError);
                resolve();
              };
              archive.once("entry", onEntry);
              archive.once("error", onError);
            });
          // Return the stream immediately. Feed one file at a time and wait until it has been consumed.
          void (async () => {
            try {
              let entry = waitEntry();
              archive.append(JSON.stringify(manifest, null, 2), {
                name: "manifest.json",
              });
              await entry;
              if (type !== "database")
                for (const path of new Set<string>(
                  manifest.data.attachments.map((a: any) => a.filePath),
                )) {
                  const info = await storage.info(path);
                  if (!info?.url)
                    throw new Error(`Missing attachment: ${path}`);
                  const response = await fetch(info.url);
                  if (!response.ok || !response.body)
                    throw new Error("Attachment download failed");
                  entry = waitEntry();
                  archive.append(Readable.fromWeb(response.body as any), {
                    name: `files/${path}`,
                  });
                  await entry;
                }
              await archive.finalize();
            } catch (e) {
              archive.destroy(
                e instanceof Error ? e : new Error("Export failed"),
              );
            }
          })();
          return new Response(body, {
            headers: {
              "Content-Type": "application/zip",
              "Content-Disposition": `attachment; filename="otemanager-backup-${type}-${new Date().toISOString().slice(0, 10)}.zip"`,
            },
          });
        } catch (error) {
          return Response.json(
            { error: error instanceof Error ? error.message : "Backup failed" },
            { status: 500 },
          );
        }
      },
    },
  },
});
