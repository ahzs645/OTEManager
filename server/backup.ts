import yauzl, { type Entry, type ZipFile } from "yauzl";
import { createHash } from "node:crypto";
import { makeFunctionReference } from "convex/server";
import { connection } from "./convex";
import { fromWire, toWire } from "../shared/codec";
import { parseManifest, validateSnapshot } from "../shared/backup";
import { validateFilePath } from "../shared/file-path";
import { getStorage } from "../storage";
const MAX_MANIFEST = 8 * 1024 * 1024,
  MAX_FILE = 512 * 1024 * 1024;
export class BackupArchive {
  constructor(
    readonly zip: ZipFile,
    readonly entries: Map<string, Entry>,
  ) {}
  static async open(path: string) {
    const zip = await new Promise<ZipFile>((resolve, reject) =>
      yauzl.open(
        path,
        { lazyEntries: true, autoClose: false, validateEntrySizes: true },
        (e, z) => (e ? reject(e) : resolve(z!)),
      ),
    );
    const entries = new Map<string, Entry>();
    try {
      await new Promise<void>((resolve, reject) => {
        zip.on("error", reject);
        zip.on("end", resolve);
        zip.on("entry", (e: Entry) => {
          try {
            if (e.fileName.endsWith("/")) {
              zip.readEntry();
              return;
            }
            validateFilePath(e.fileName);
            if (entries.has(e.fileName)) throw new Error("Duplicate ZIP entry");
            if (entries.size >= 100000) throw new Error("Too many ZIP entries");
            entries.set(e.fileName, e);
            zip.readEntry();
          } catch (err) {
            reject(err);
          }
        });
        zip.readEntry();
      });
      return new BackupArchive(zip, entries);
    } catch (e) {
      zip.close();
      throw e;
    }
  }
  async read(name: string, max = MAX_FILE) {
    const entry = this.entries.get(name);
    if (!entry) throw new Error(`Missing archive entry: ${name}`);
    if (entry.uncompressedSize > max)
      throw new Error("Archive entry exceeds the supported size");
    const stream = await new Promise<NodeJS.ReadableStream>((resolve, reject) =>
      this.zip.openReadStream(entry, (e, s) => (e ? reject(e) : resolve(s!))),
    );
    const chunks: Buffer[] = [];
    let bytes = 0;
    for await (const chunk of stream) {
      bytes += chunk.length;
      if (bytes > max)
        throw new Error("Archive entry exceeds the supported size");
      chunks.push(Buffer.from(chunk));
    }
    return Buffer.concat(chunks);
  }
  close() {
    this.zip.close();
  }
}
export interface ImportOptions {
  mode?: "merge" | "replace";
  type?: "both" | "database" | "files";
  dryRun?: boolean;
  onProgress?: (progress: {
    stage: string;
    completed: number;
    total: number;
  }) => void;
}
export async function importBackup(path: string, options: ImportOptions = {}) {
  const archive = await BackupArchive.open(path);
  try {
    const manifestName = archive.entries.has("manifest.json")
      ? "manifest.json"
      : "database/manifest.json";
    const manifest = JSON.parse(
      (await archive.read(manifestName, MAX_MANIFEST)).toString("utf8"),
    );
    const snapshot = parseManifest(manifest),
      type = options.type || "both",
      mode = options.mode || "merge";
    const importDatabase =
      type !== "files" && Array.isArray(manifest.data.authors);
    if (type === "database" && !importDatabase)
      throw new Error("This archive has no database records");
    if (importDatabase) validateSnapshot(snapshot);
    const paths = new Map(
      snapshot.attachments.map((a) => [validateFilePath(a.filePath), a]),
    );
    const report = archive.entries.has("recovery-report.json")
      ? JSON.parse(
          (await archive.read("recovery-report.json", MAX_MANIFEST)).toString(
            "utf8",
          ),
        )
      : null;
    const checksums = new Map<string, { bytes: number; sha256: string }>(
      (report?.files || []).map((f: any) => [f.path, f]),
    );
    const fileEntries = [...paths].map(([path, a]) => ({
      path,
      attachment: a,
      entry: archive.entries.has(`files/${path}`)
        ? `files/${path}`
        : archive.entries.has(`uploaded-files/${path}`)
          ? `uploaded-files/${path}`
          : null,
    }));
    const hasFiles = [...archive.entries.keys()].some(
      (n) => n.startsWith("files/") || n.startsWith("uploaded-files/"),
    );
    const expectsFiles =
      manifest.backupType === "both" ||
      manifest.backupType === "files" ||
      report !== null;
    if (type !== "database" && expectsFiles && paths.size > 0 && !hasFiles)
      throw new Error("Backup is incomplete: uploaded files are missing");
    const importFiles = type !== "database" && hasFiles;
    if (type === "files" && !hasFiles)
      throw new Error("This archive has no uploaded files");
    if (importFiles && fileEntries.some((f) => !f.entry))
      throw new Error(
        "Backup is incomplete: some referenced files are missing",
      );
    let verified = 0,
      totalBytes = 0;
    // Validate every file before touching records or storage.
    if (importFiles)
      for (const f of fileEntries) {
        const buffer = await archive.read(f.entry!);
        const expected = checksums.get(f.path);
        if (
          f.attachment.fileSize !== null &&
          buffer.length !== f.attachment.fileSize
        )
          throw new Error("Attachment size does not match the backup");
        if (
          expected &&
          (expected.bytes !== buffer.length ||
            createHash("sha256").update(buffer).digest("hex") !==
              expected.sha256)
        )
          throw new Error("Recovery file checksum mismatch");
        totalBytes += buffer.length;
        verified++;
        options.onProgress?.({
          stage: "Verifying files",
          completed: verified,
          total: fileEntries.length,
        });
      }
    const summary = {
      records: Object.fromEntries(
        Object.entries(snapshot).map(([k, v]) => [k, v.length]),
      ),
      uniqueFiles: paths.size,
      filesInArchive: hasFiles ? fileEntries.filter((f) => f.entry).length : 0,
      verifiedFiles: verified,
      totalBytes,
    };
    if (options.dryRun) return { success: true, summary, dryRun: true };
    const { client, secret } = connection();
    if (importDatabase)
      await client.query(makeFunctionReference<"query">("backup:validate"), {
        secret,
        manifest: toWire(manifest),
        mode,
      });
    const rawStats = importDatabase
      ? await client.mutation(
          makeFunctionReference<"mutation">("backup:restore"),
          { secret, manifest: toWire(manifest), mode },
        )
      : {};
    let restored = 0,
      skipped = 0;
    const storage = getStorage();
    if (importFiles)
      for (const f of fileEntries) {
        const existing = await storage.info(f.path),
          buffer = await archive.read(f.entry!);
        const hash = createHash("sha256").update(buffer).digest("hex");
        if (existing?.sha256 === hash && existing.size === buffer.length) {
          skipped++;
        } else {
          await storage.store(
            f.path,
            buffer,
            f.attachment.mimeType || undefined,
          );
          restored++;
        }
        options.onProgress?.({
          stage: "Restoring files",
          completed: restored + skipped,
          total: fileEntries.length,
        });
      }
    const empty = { imported: 0, skipped: 0 };
    const stats = {
      authors: rawStats.authors || empty,
      volumes: rawStats.volumes || empty,
      issues: rawStats.issues || empty,
      articles: rawStats.articles || empty,
      attachments: {
        ...(rawStats.attachments || empty),
        filesRestored: restored,
      },
      multimediaTypes: rawStats.articleMultimediaTypes || empty,
      notes: rawStats.articleNotes || empty,
      statusHistory: rawStats.statusHistory || empty,
    };
    return {
      success: true,
      stats,
      summary,
      filesSkipped: skipped,
      backupInfo: {
        exportedAt: manifest.exportedAt,
        version: manifest.exportVersion,
      },
      message: importFiles
        ? `Restored records and ${restored} files; ${skipped} files were already present.`
        : "Database restored. This archive contains no files to upload.",
    };
  } finally {
    archive.close();
  }
}
export async function exportManifest(type = "both") {
  const { client, secret } = connection();
  return fromWire(
    await client.query(makeFunctionReference<"query">("backup:exportData"), {
      secret,
      type,
    }),
  );
}
