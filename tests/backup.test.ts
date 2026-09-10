// @vitest-environment node
import { afterEach, expect, test } from "vitest";
import JSZip from "jszip";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { importBackup } from "../server/backup";
import { validateFilePath } from "../shared/file-path";
import { normalizeRecord } from "../shared/records";
const dirs: string[] = [];
afterEach(async () => {
  for (const path of dirs.splice(0))
    await rm(path, { recursive: true, force: true });
});
function manifest() {
  return {
    exportVersion: "1.0",
    exportedAt: "2026-09-10T00:00:00Z",
    backupType: "both",
    data: {
      authors: [
        normalizeRecord("authors", {
          id: "author",
          email: "test@example.test",
          givenName: "Test",
          surname: "Author",
        }),
      ],
      articles: [
        normalizeRecord("articles", {
          id: "article",
          title: "Test",
          authorId: "author",
        }),
      ],
      attachments: [
        normalizeRecord("attachments", {
          id: "attachment",
          articleId: "article",
          attachmentType: "other",
          fileName: "test.txt",
          originalFileName: "test.txt",
          filePath: "test.txt",
          fileSize: 4,
          mimeType: "text/plain",
        }),
      ],
    },
  };
}
async function archive(recovery = false, file?: string, checksum?: string) {
  const zip = new JSZip();
  zip.file(
    recovery ? "database/manifest.json" : "manifest.json",
    JSON.stringify(manifest()),
  );
  if (file !== undefined)
    zip.file(`${recovery ? "uploaded-files" : "files"}/test.txt`, file);
  if (checksum)
    zip.file(
      "recovery-report.json",
      JSON.stringify({
        files: [{ path: "test.txt", bytes: 4, sha256: checksum }],
      }),
    );
  const dir = await mkdtemp(join(tmpdir(), "ote-test-"));
  dirs.push(dir);
  const path = join(dir, "test.zip");
  await writeFile(path, await zip.generateAsync({ type: "nodebuffer" }));
  return path;
}
test("accepts both native exports and recovery bundles", async () => {
  for (const recovery of [false, true]) {
    const result = await importBackup(await archive(recovery, "test"), {
      dryRun: true,
    });
    expect(result.summary.verifiedFiles).toBe(1);
    expect(result.summary.totalBytes).toBe(4);
  }
});
test("rejects incomplete or damaged file backups before importing", async () => {
  await expect(importBackup(await archive(), { dryRun: true })).rejects.toThrow(
    "incomplete",
  );
  await expect(
    importBackup(await archive(false, "bad"), { dryRun: true }),
  ).rejects.toThrow("size");
  await expect(
    importBackup(await archive(true, "test", "0".repeat(64)), { dryRun: true }),
  ).rejects.toThrow("checksum");
});
test("rejects unsafe file paths and malformed record values", () => {
  for (const path of ["../escape", "/absolute", "a/../b", "a\\b", "a\0b"])
    expect(() => validateFilePath(path)).toThrow();
  expect(() =>
    normalizeRecord("articles", {
      id: "bad",
      title: "Test",
      authorId: "a",
      paymentAmount: 1.5,
    }),
  ).toThrow("integer");
});
