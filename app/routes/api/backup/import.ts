import { createFileRoute } from "@tanstack/react-router";
export const Route = createFileRoute("/api/backup/import")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const { mkdtemp, rm } = await import("node:fs/promises");
        const { createWriteStream } = await import("node:fs");
        const { tmpdir } = await import("node:os");
        const { join } = await import("node:path");
        const { Readable, Transform } = await import("node:stream");
        const { pipeline } = await import("node:stream/promises");
        const dir = await mkdtemp(join(tmpdir(), "ote-restore-"));
        const path = join(dir, "backup.zip");
        try {
          const url = new URL(request.url),
            mode = url.searchParams.get("mode") || "merge",
            type = url.searchParams.get("type") || "both";
          if (
            !["merge", "replace"].includes(mode) ||
            !["both", "database", "files"].includes(type)
          )
            return Response.json(
              { error: "Invalid restore options" },
              { status: 400 },
            );
          if (!request.body)
            return Response.json(
              { error: "No backup file provided" },
              { status: 400 },
            );
          let bytes = 0;
          const limit = Number(process.env.MAX_BACKUP_SIZE) || 5 * 1024 ** 3;
          const meter = new Transform({
            transform(chunk, encoding, callback) {
              bytes += chunk.length;
              callback(
                bytes > limit ? new Error("Backup exceeds size limit") : null,
                chunk,
              );
            },
          });
          await pipeline(
            Readable.fromWeb(request.body as any),
            meter,
            createWriteStream(path),
          );
          const { importBackup } = await import("../../../../server/backup");
          return Response.json(
            await importBackup(path, {
              mode: mode as "merge" | "replace",
              type: type as "both" | "database" | "files",
            }),
          );
        } catch (error) {
          return Response.json(
            {
              success: false,
              error:
                error instanceof Error
                  ? error.message
                  : "Restore failed. Rerun in merge mode to resume any files already imported.",
            },
            { status: 400 },
          );
        } finally {
          await rm(dir, { recursive: true, force: true });
        }
      },
    },
  },
});
