// @vitest-environment node
import { afterEach, expect, test, vi } from "vitest";
import JSZip from "jszip";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createSourceArchiveService, readSourceArchivePublicAsset, readSourceArchiveRequest, readSourceArchiveZip } from "../server/source-archive";
import { sourceDigest, type SourceArchiveBundle, type SourceArchivePreview } from "../shared/source-archive";

const hash = (text: Buffer | string) => createHash("sha256").update(text).digest("hex");
const original = Buffer.from("Original source copy, kept intact.\n");
const filePath = "source-archive-media/original.txt";
function bundle(): SourceArchiveBundle {
  return {
    schemaVersion: "ote.source-archive.v1", archiveId: "originals",
    issues: [{ documentId: "issue", label: "Original issue", volumeNumber: 31, issueNumber: 7, releaseDate: null, pageCount: 17, source: {path: "originals/issue.pdf", sha256: "a".repeat(64)} }],
    articles: [{sourceKey: "legacy:original", title: "Original headline", authorName: null, content: "", bodyFormat: "plain", kind: "article", recoveryStatus: "metadata-only", placements: [{documentId: "issue", pageNumbers: []}], provenance: [{path: "metadata.json", sha256: "b".repeat(64)}], photos: []}],
    assets: [{id: "attachment:original", sourceKey: "legacy:original", path: filePath, sha256: hash(original), size: original.length, originalFileName: "Original article.txt", attachmentType: "word_document", availability: "missing"},
      {id: "source-pdf", assetRole: "source-reference", sourceKey: null, path: "originals/issue.pdf", availability: "reference-only"}],
    coverage: {notes: "This inventory does not cross the metadata bridge."},
  };
}

function fixture(options: { failSave?: boolean; readPublic?: (path: string) => Promise<Buffer | null> } = {}) {
  const stored = new Map<string, Buffer>(), attached = new Map<string, unknown>();
  const preview = vi.fn(async (metadata: SourceArchiveBundle): Promise<SourceArchivePreview> => ({
    success: true, archiveId: metadata.archiveId, previewToken: sourceDigest(JSON.stringify(metadata)),
    summary: {documents: 1, publications: 1, eligible: 1, create: 1, link: 0, existing: 0, conflicts: 0, excluded: 0, missingBodies: 1},
    publications: [{documentId: "issue", volumeId: "volume", issueId: "publication", action: "create"}],
    articles: [{sourceKey: "legacy:original", title: "Original headline", authorName: null, articleId: "article", issueId: "publication", documentIds: ["issue"], action: "create", reason: null, missingBody: true, fillsMissingBody: false}], warnings: [],
  }));
  const importMetadata = vi.fn(async (metadata: SourceArchiveBundle, _ids: string[] | undefined, token: string) => {
    const result = await preview(metadata);
    if (token !== result.previewToken) throw new Error("Stale metadata preview");
    return {...result, imported: 1, linked: 0, existing: 0, conflicts: 0, results: result.articles};
  });
  const storage = {
    exists: vi.fn(async (path: string) => stored.has(path)),
    getFile: vi.fn(async (path: string) => stored.get(path) ?? null),
    saveFile: vi.fn(async (path: string, bytes: Buffer) => { if (options.failSave) throw new Error("Storage unavailable"); stored.set(path, bytes); return true; }),
  };
  const attach = vi.fn(async (data: {filePath: string}) => {
    const created = !attached.has(data.filePath); attached.set(data.filePath, data); return {success: true, created};
  });
  const service = createSourceArchiveService({preview, importMetadata, attach, storage,
    ...(options.readPublic ? {readPublicAsset: options.readPublic} : {readPublicAsset: async () => null})});
  return {service, storage, stored, attached, attach, preview, importMetadata};
}

async function zip(manifest: SourceArchiveBundle, files: Record<string, Buffer> = {}) {
  const archive = new JSZip(); archive.file("source-archive.json", JSON.stringify(manifest));
  for (const [path, bytes] of Object.entries(files)) archive.file(path, bytes);
  return archive.generateAsync({type: "nodebuffer", compression: "STORE"});
}

test("missing original bytes remain explicit references and never create attachment rows", async () => {
  const f = fixture(), data = bundle();
  const preview = await f.service.preview(data);
  expect(preview.files).toMatchObject({referenced: 1, available: 0, missing: 1});
  expect(preview.warnings[0]).toMatch(/No attachment records/);
  const result = await f.service.import(data, undefined, preview.previewToken);
  expect(result.imported).toBe(1); expect(result.files.missing).toBe(1);
  expect(f.storage.saveFile).not.toHaveBeenCalled(); expect(f.attach).not.toHaveBeenCalled();
  const bridged = f.importMetadata.mock.calls[0][0];
  expect(bridged.assets).toEqual([]); expect(bridged.coverage).toEqual({});
  expect(bridged.articles[0].content).toBe("");
});

test("a supplied original is byte-verified, attached once, and safely retried", async () => {
  const data = bundle(), parsed = await readSourceArchiveZip(await zip(data, {[filePath]: original})), f = fixture();
  const preview = await f.service.preview(parsed.bundle, undefined, parsed.files);
  expect(preview.files).toMatchObject({available: 1, missing: 0});
  const first = await f.service.import(data, undefined, preview.previewToken, parsed.files);
  expect(first.files.created).toBe(1); expect(f.attached.size).toBe(1); expect([...f.stored.values()]).toEqual([original]);
  const secondPreview = await f.service.preview(data, undefined, parsed.files);
  const second = await f.service.import(data, undefined, secondPreview.previewToken, parsed.files);
  expect(second.files.skipped).toBe(1); expect(f.attached.size).toBe(1); expect(f.storage.saveFile).toHaveBeenCalledTimes(1);
  expect(f.attach.mock.calls[0][0]).toMatchObject({fileSize: original.length, sha256: hash(original), attachmentType: "word_document"});
});

test("file integrity and preview identity are checked before any metadata writes", async () => {
  const data = bundle(), f = fixture();
  await expect(f.service.preview(data, undefined, new Map([[filePath, Buffer.from("changed")]]))).rejects.toThrow(/size|checksum/);
  const valid = new Map([[filePath, original]]), preview = await f.service.preview(data, undefined, valid);
  await expect(f.service.import(data, undefined, preview.previewToken)).rejects.toThrow(/same source archive/);
  expect(f.importMetadata).not.toHaveBeenCalled();
  const changed = structuredClone(data); changed.assets[0].sha256 = null; changed.assets[0].size = null;
  const changedPreview = await f.service.preview(changed, undefined, valid);
  await expect(f.service.import(changed, undefined, changedPreview.previewToken, new Map([[filePath, Buffer.from("Different original")]]))).rejects.toThrow(/same source archive/);
  expect(f.importMetadata).not.toHaveBeenCalled();
});

test("storage failures preserve metadata, report the failed file, and create no broken attachment", async () => {
  const data = bundle(), f = fixture({failSave: true}), supplied = new Map([[filePath, original]]);
  const preview = await f.service.preview(data, undefined, supplied);
  const result = await f.service.import(data, undefined, preview.previewToken, supplied);
  expect(result.imported).toBe(1); expect(result.files.failed).toBe(1); expect(result.files.results[0].reason).toBe("Storage unavailable");
  expect(result.warnings.join(" ")).toMatch(/import the same package again/); expect(f.attach).not.toHaveBeenCalled();
  f.storage.saveFile.mockImplementation(async (path: string, bytes: Buffer) => {f.stored.set(path, bytes); return true;});
  const retry = await f.service.import(data, undefined, preview.previewToken, supplied);
  expect(retry.files).toMatchObject({created: 1, failed: 0}); expect(f.attached.size).toBe(1);
});

test("source ZIP traversal, symlinks, corruption and ambiguous file copies are rejected", async () => {
  const data = bundle(), traversal = new JSZip(); traversal.file("../outside.txt", "outside");
  await expect(readSourceArchiveZip(await traversal.generateAsync({type: "nodebuffer"}))).rejects.toThrow(/relative|path/);
  const linked = new JSZip(); linked.file("link.txt", "outside", {unixPermissions: 0o120777});
  await expect(readSourceArchiveZip(await linked.generateAsync({type: "nodebuffer", platform: "UNIX"}))).rejects.toThrow(/symlinks/);
  const corrupt = await zip(data, {[filePath]: original}), position = corrupt.indexOf(original); expect(position).toBeGreaterThan(0); corrupt[position] ^= 1;
  await expect(readSourceArchiveZip(corrupt)).rejects.toThrow(/integrity/);
  await expect(readSourceArchiveZip(await zip(data, {[filePath]: original, ["files/" + filePath]: original}))).rejects.toThrow(/Ambiguous/);
});

test("JSON and multipart source requests keep their original files and bounded preview contract", async () => {
  const data = bundle(), json = await readSourceArchiveRequest(new Request("http://local/import", {method: "POST", body: JSON.stringify({preview: true, manifest: data})}));
  expect(json.manifest.archiveId).toBe("originals"); expect(json.files).toBeUndefined();
  const form = new FormData(); form.set("file", new File([new Uint8Array(await zip(data, {[filePath]: original}))], "originals.zip")); form.set("preview", "true"); form.set("issueIds", JSON.stringify(["issue"]));
  const multipart = await readSourceArchiveRequest(new Request("http://local/import", {method: "POST", body: form}));
  expect(multipart.files?.get(filePath)).toEqual(original); expect(multipart.issueIds).toEqual(["issue"]);
  await expect(readSourceArchiveRequest(new Request("http://local/import", {method: "POST", headers: {"Content-Length": String(8 * 1024 ** 2)}, body: "{}"}))).rejects.toMatchObject({status: 413});
});

const temporary: string[] = [];
afterEach(async () => { for (const path of temporary.splice(0)) await rm(path, {recursive: true, force: true}); });
test("packaged deployments read source media from .output/public with the same path boundaries", async () => {
  const repository = await mkdtemp(join(tmpdir(), "ote-source-output-")); temporary.push(repository);
  await mkdir(join(repository, "public/designcraft/source-archive-media"), {recursive: true});
  const outputMedia = join(repository, ".output/public/designcraft/source-archive-media");
  await mkdir(outputMedia, {recursive: true}); await writeFile(join(outputMedia, "original.txt"), original);
  expect(await readSourceArchivePublicAsset(filePath, repository)).toEqual(original);
  expect(await readSourceArchivePublicAsset("source-archive-media/absent.txt", repository)).toBeNull();
  const privateFile = join(repository, "private.txt"); await writeFile(privateFile, original);
  await symlink(privateFile, join(outputMedia, "link.txt"));
  await expect(readSourceArchivePublicAsset("source-archive-media/link.txt", repository)).rejects.toThrow(/inside the public source-media directory/);
});

test("public canonical source media never follows a symlink outside its allowed directory", async () => {
  const privateDirectory = await mkdtemp(join(tmpdir(), "ote-source-private-")); temporary.push(privateDirectory);
  const publicRoot = join(process.cwd(), "public/designcraft/source-archive-media"); await mkdir(publicRoot, {recursive: true});
  const ownDirectory = await mkdtemp(join(publicRoot, "asset-test-")); temporary.push(ownDirectory);
  const privateFile = join(privateDirectory, "private.txt"); await writeFile(privateFile, original); await symlink(privateFile, join(ownDirectory, "link.txt"));
  const f = fixture(), data = bundle(); data.assets[0].path = "source-archive-media/" + ownDirectory.split("/").at(-1) + "/link.txt";
  const service = createSourceArchiveService({preview: f.preview, importMetadata: f.importMetadata, attach: f.attach, storage: f.storage});
  await expect(service.preview(data)).rejects.toThrow(/inside the public source-media directory/);
  expect(f.preview).not.toHaveBeenCalled();
});
