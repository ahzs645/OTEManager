// @vitest-environment node
import { expect, test, vi, beforeEach } from "vitest";
import JSZip from "jszip";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { collectBackupFiles } from "../shared/issue-studio-assets";
import { importBackup } from "../server/backup";

const storage = vi.hoisted(() => ({ exists: vi.fn(), saveFile: vi.fn() }));
vi.mock("../storage", () => ({ getStorage: () => storage }));
vi.mock("../server/records", () => ({ get: vi.fn(async () => ({ id: "issue-1" })) }));
import { handleIssueStudioAsset } from "../server/issue-studio-assets";

beforeEach(() => { vi.clearAllMocks(); storage.exists.mockResolvedValue(false); storage.saveFile.mockResolvedValue(true); });
function request(path: string, bytes = "original artwork") {
  const form = new FormData();form.set("path", path);form.set("file", new File([bytes], "user-art.png"));
  return new Request("http://localhost/api/issue-studio/issue-1/assets", { method: "POST", body: form });
}
test("artwork retries address identical bytes without replacing historical artwork", async () => {
  const first = await (await handleIssueStudioAsset(request("assets/user-ad.png"), "issue-1")).json();
  storage.exists.mockResolvedValue(true);
  const retry = await (await handleIssueStudioAsset(request("assets/user-ad.png"), "issue-1")).json();
  expect(first.path).toBe(retry.path);
  expect(first.path).toMatch(/^issue-studio\/issue-1\/[a-f0-9]{64}\.png$/);
  expect(storage.saveFile).toHaveBeenCalledTimes(1);
  storage.exists.mockResolvedValue(false);
  const changed = await (await handleIssueStudioAsset(request("assets/user-ad.png", "new artwork"), "issue-1")).json();
  expect(changed.path).not.toBe(first.path);
  expect((await handleIssueStudioAsset(request("assets/../../escape.png"), "issue-1")).status).toBe(400);
});
test("backup includes artwork and historical source media after the live attachment disappears", async () => {
  const references = {
    issueDesignPlans: [{ plannerState: JSON.stringify({ assetRefs: { "assets/user-ad.png": "issue-studio/i/art.png" } }) }],
    issueDesignRevisions: [{ snapshot: JSON.stringify({ sources: [{ attachments: [{ filePath: "articles/deleted/photo.png", fileSize: 4 }] }], state: { reservations: [{ artworkPath: "issue-studio/i/art.png" }] } }) }],
  };
  expect(collectBackupFiles(references).map(f => f.path).sort()).toEqual(["articles/deleted/photo.png", "issue-studio/i/art.png"]);
  const dir = await mkdtemp(join(tmpdir(), "ote-studio-backup-"));
  try {
    const zip = new JSZip(), paths = collectBackupFiles(references);
    // A files-only backup carries references even without any live article rows.
    zip.file("manifest.json", JSON.stringify({ exportVersion: "2.0", backupType: "files", data: { referencedFiles: paths } }));
    zip.file("files/issue-studio/i/art.png", "art");
    const file = join(dir, "history.zip");
    await writeFile(file, await zip.generateAsync({ type: "nodebuffer" }));
    await expect(importBackup(file, { type: "files", dryRun: true })).rejects.toThrow("referenced files are missing");
    zip.file("files/articles/deleted/photo.png", "copy");
    await writeFile(file, await zip.generateAsync({ type: "nodebuffer" }));
    expect((await importBackup(file, { type: "files", dryRun: true })).summary.verifiedFiles).toBe(2);
  } finally { await rm(dir, { recursive: true, force: true }); }
});
