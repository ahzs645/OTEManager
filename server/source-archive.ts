import { createHash } from "node:crypto";
import { readFile, realpath, stat } from "node:fs/promises";
import { resolve, sep, extname, basename } from "node:path";
import { crc32 } from "node:zlib";
import yauzl, { type Entry, type ZipFile } from "yauzl";
import {
  eligibleSourceArticle,
  parseSourceArchiveBundle,
  type SourceArchiveBundle,
  type SourceArchivePreview,
} from "../shared/source-archive";
import { validateFilePath } from "../shared/file-path";
import { getStorage } from "../storage";
import type { StorageProvider } from "../storage/types";
import { mutate, query } from "./convex";

export const SOURCE_ARCHIVE_LIMITS = Object.freeze({
  compressedBytes: 64 * 1024 ** 2,
  expandedBytes: 256 * 1024 ** 2,
  fileBytes: 64 * 1024 ** 2,
  manifestBytes: 6 * 1024 ** 2,
  entries: 2048,
});

export class SourceArchiveRequestError extends Error {
  constructor(message: string, readonly status = 400) { super(message); }
}

type AttachmentType = "word_document" | "photo" | "graphic" | "other";
type FileStatus = "available" | "missing" | "created" | "existing" | "failed";
interface SourceAsset {
  id: string;
  sourceKey: string;
  path: string;
  sha256: string | null;
  size: number | null;
  mimeType: string;
  originalFileName: string;
  attachmentType: AttachmentType;
  caption: string | null;
  photoNumber: number | null;
}
export interface SourceArchiveFileResult {
  id: string;
  sourceKey: string;
  path: string;
  status: FileStatus;
  reason: string | null;
}
export interface SourceArchiveFileSummary {
  referenced: number;
  available: number;
  missing: number;
  created: number;
  skipped: number;
  failed: number;
  results: SourceArchiveFileResult[];
}
type SuppliedFiles = ReadonlyMap<string, Buffer>;
type PreparedAsset = { asset: SourceAsset; bytes: Buffer | null; sha256: string | null; result: SourceArchiveFileResult };
type StoredInfo = { size: number; sha256: string | null };
type Storage = Pick<StorageProvider, "saveFile" | "exists" | "getFile"> & { info?: (path: string) => Promise<StoredInfo | null> };
interface ImportResult extends SourceArchivePreview {
  imported: number;
  linked: number;
  existing: number;
  conflicts: number;
  results: { sourceKey: string; articleId: string | null; issueId: string | null; action: string; reason: string | null }[];
}
interface Dependencies {
  preview: (bundle: SourceArchiveBundle, documentIds?: string[]) => Promise<SourceArchivePreview>;
  importMetadata: (bundle: SourceArchiveBundle, documentIds: string[] | undefined, previewToken: string) => Promise<ImportResult>;
  attach: (data: {
    archiveId: string; sourceKey: string; articleId: string; filePath: string; fileName: string;
    originalFileName: string; attachmentType: AttachmentType; fileSize: number; mimeType: string;
    caption: string | null; photoNumber: number | null; sha256: string;
  }) => Promise<{ success: boolean; created: boolean }>;
  storage: Storage;
  readPublicAsset?: (path: string) => Promise<Buffer | null>;
}

const mediaTypes: Record<string, string> = {
  ".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  ".doc": "application/msword", ".pdf": "application/pdf", ".txt": "text/plain", ".md": "text/markdown",
  ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".png": "image/png", ".webp": "image/webp",
  ".gif": "image/gif", ".tif": "image/tiff", ".tiff": "image/tiff", ".heic": "image/heic",
};
const digest = (bytes: Buffer | string) => createHash("sha256").update(bytes).digest("hex");

function relativePath(value: unknown): string {
  if (typeof value !== "string" || value.length > 1000 || /[\x00-\x1f\x7f:\\]/.test(value)) throw new SourceArchiveRequestError("Source files need safe relative paths");
  try { return validateFilePath(value); } catch { throw new SourceArchiveRequestError("Source files need safe relative paths"); }
}

function documentSelection(bundle: SourceArchiveBundle, input?: string[]): Set<string> {
  if (input !== undefined && (!Array.isArray(input) || input.length > 64 || input.some((id) => typeof id !== "string" || !bundle.issues.some((issue) => issue.documentId === id)))) throw new SourceArchiveRequestError("Unknown selected source document");
  const ids = new Set(input ?? bundle.issues.map((issue) => issue.documentId));
  if (!ids.size) throw new SourceArchiveRequestError("Select at least one source document");
  return ids;
}

function attachmentAssets(bundle: SourceArchiveBundle, documentIds?: string[]): SourceAsset[] {
  const selected = documentSelection(bundle, documentIds);
  const articles = new Set(bundle.articles.filter((article) => eligibleSourceArticle(article) && article.placements.some((placement) => selected.has(placement.documentId))).map((article) => article.sourceKey));
  const assets: SourceAsset[] = [], identities = new Set<string>();
  for (const value of bundle.assets) {
    // Source PDFs/IDML are provenance references, not article attachments.
    if (value.assetRole === "source-reference" || value.availability === "reference-only" || value.sourceKey === null) continue;
    if (typeof value.sourceKey !== "string" || !articles.has(value.sourceKey)) continue;
    const path = relativePath(value.path), suffix = extname(path).toLowerCase();
    if (!mediaTypes[suffix]) throw new SourceArchiveRequestError("Unsupported source attachment format: " + suffix);
    const id = typeof value.id === "string" && value.id ? value.id : path;
    if (id.length > 1000 || identities.has(`${value.sourceKey}|${id}`)) throw new SourceArchiveRequestError("Source attachment identities must be unique");
    identities.add(`${value.sourceKey}|${id}`);
    if (value.sha256 != null && (typeof value.sha256 !== "string" || !/^[a-f0-9]{64}$/i.test(value.sha256))) throw new SourceArchiveRequestError("Invalid source file checksum");
    if (value.size != null && (typeof value.size !== "number" || !Number.isSafeInteger(value.size) || value.size < 0 || value.size > SOURCE_ARCHIVE_LIMITS.fileBytes)) throw new SourceArchiveRequestError("Source attachment exceeds the supported size");
    if (!["word_document", "photo", "graphic", "other"].includes(String(value.attachmentType))) throw new SourceArchiveRequestError("Invalid source attachment type");
    const filename = value.originalFileName ?? basename(path);
    if (typeof filename !== "string" || !filename || filename.length > 1000 || /[\x00-\x1f\x7f]/.test(filename)) throw new SourceArchiveRequestError("Invalid source attachment filename");
    assets.push({ id, sourceKey: value.sourceKey, path, sha256: typeof value.sha256 === "string" ? value.sha256.toLowerCase() : null,
      size: typeof value.size === "number" ? value.size : null, mimeType: mediaTypes[suffix], originalFileName: basename(filename),
      attachmentType: value.attachmentType as AttachmentType, caption: typeof value.caption === "string" ? value.caption.slice(0, 10000) : null,
      photoNumber: typeof value.photoNumber === "number" && Number.isSafeInteger(value.photoNumber) && value.photoNumber > 0 ? value.photoNumber : null });
  }
  return assets;
}

/** Read canonical media in either a checkout or a packaged Nitro deployment. */
export async function readSourceArchivePublicAsset(path: string, repository = process.cwd()): Promise<Buffer | null> {
  if (!path.startsWith("source-archive-media/")) return null;
  const roots = new Set([
    ...(process.env.DESIGNCRAFT_STATIC_DIR ? [resolve(process.env.DESIGNCRAFT_STATIC_DIR, "source-archive-media")] : []),
    resolve(repository, "public/designcraft/source-archive-media"),
    resolve(repository, ".output/public/designcraft/source-archive-media"),
  ]);
  for (const root of roots) {
    let actual: string, canonicalRoot: string;
    try {
      canonicalRoot = await realpath(root);
      actual = await realpath(resolve(root, path.slice("source-archive-media/".length)));
    } catch (error: any) { if (["ENOENT", "ENOTDIR"].includes(error?.code)) continue; throw error; }
    if (!actual.startsWith(canonicalRoot + sep)) throw new SourceArchiveRequestError("Source media must remain inside the public source-media directory");
    const info = await stat(actual);
    if (!info.isFile() || info.size > SOURCE_ARCHIVE_LIMITS.fileBytes) throw new SourceArchiveRequestError("Source attachment exceeds the supported size");
    const bytes = await readFile(actual);
    if (bytes.length > SOURCE_ARCHIVE_LIMITS.fileBytes) throw new SourceArchiveRequestError("Source attachment exceeds the supported size");
    return bytes;
  }
  return null;
}

/** Drop bulky, non-imported inventory before crossing the Convex metadata bridge. */
const metadataBundle = (bundle: SourceArchiveBundle): SourceArchiveBundle => ({
  schemaVersion: bundle.schemaVersion, archiveId: bundle.archiveId, issues: bundle.issues,
  articles: bundle.articles.map((article) => ({ ...article, photos: [] })), assets: [], coverage: {},
});

function fileSummary(files: PreparedAsset[]): SourceArchiveFileSummary {
  const count = (status: FileStatus) => files.filter((file) => file.result.status === status).length;
  return { referenced: files.length, available: files.filter((file) => file.bytes !== null).length,
    missing: count("missing"), created: count("created"), skipped: count("existing"), failed: count("failed"),
    results: files.map((file) => ({ ...file.result })) };
}

export function createSourceArchiveService(deps: Dependencies) {
  const prepare = async (bundle: SourceArchiveBundle, documentIds?: string[], supplied?: SuppliedFiles) => {
    const files: PreparedAsset[] = [];
    let bytesRead = 0;
    for (const asset of attachmentAssets(bundle, documentIds)) {
      const bytes = supplied?.get(asset.path) ?? await (deps.readPublicAsset ?? readSourceArchivePublicAsset)(asset.path);
      let sha256: string | null = null;
      if (bytes) {
        bytesRead += bytes.length;
        if (bytes.length > SOURCE_ARCHIVE_LIMITS.fileBytes || bytesRead > SOURCE_ARCHIVE_LIMITS.expandedBytes) throw new SourceArchiveRequestError("Source media exceeds the supported size", 413);
        sha256 = digest(bytes);
        if (asset.size !== null && bytes.length !== asset.size) throw new SourceArchiveRequestError("Source file size does not match its metadata: " + asset.path);
        if (asset.sha256 && sha256 !== asset.sha256) throw new SourceArchiveRequestError("Source file checksum does not match its metadata: " + asset.path);
      }
      files.push({ asset, bytes, sha256, result: { id: asset.id, sourceKey: asset.sourceKey, path: asset.path,
        status: bytes ? "available" : "missing", reason: bytes ? null : "Original file bytes are not supplied; only its metadata will be retained." } });
    }
    const fileToken = digest(JSON.stringify({ assets: bundle.assets, files: files.map(({asset, sha256}) => [asset.sourceKey, asset.id, asset.path, sha256]) }));
    return { files, fileToken };
  };
  const withFiles = <T extends SourceArchivePreview>(result: T, files: PreparedAsset[], fileToken: string) => {
    const summary = fileSummary(files), warnings = [...result.warnings];
    if (summary.missing) warnings.push(`${summary.missing} referenced original file(s) are unavailable. No attachment records will be created for those references.`);
    if (summary.failed) warnings.push(`${summary.failed} available file(s) could not be attached. The article metadata is retained; import the same package again to retry those files.`);
    return { ...result, previewToken: `sa1.${result.previewToken}.${fileToken}`, warnings, files: summary };
  };
  return {
    async preview(input: unknown, documentIds?: string[], supplied?: SuppliedFiles) {
      const bundle = parseSourceArchiveBundle(input), {files, fileToken} = await prepare(bundle, documentIds, supplied);
      return withFiles(await deps.preview(metadataBundle(bundle), documentIds), files, fileToken);
    },
    async import(input: unknown, documentIds?: string[], previewToken?: string, supplied?: SuppliedFiles) {
      const bundle = parseSourceArchiveBundle(input), {files, fileToken} = await prepare(bundle, documentIds, supplied);
      const token = typeof previewToken === "string" && /^sa1\.([a-f0-9]{32})\.([a-f0-9]{64})$/.exec(previewToken);
      if (!token || token[2] !== fileToken) throw new SourceArchiveRequestError("Review the same source archive and supplied files before importing");
      const result = await deps.importMetadata(metadataBundle(bundle), documentIds, token[1]);
      for (const file of files) {
        if (!file.bytes || !file.sha256) continue;
        const targets = result.results.filter((row) => row.sourceKey === file.asset.sourceKey && row.articleId && !["excluded", "conflict"].includes(row.action));
        if (!targets.length) { file.result.status = "failed"; file.result.reason = "This source record has no eligible imported article; no file was attached."; continue; }
        try {
          let created = false;
          for (const target of targets) {
            // Content-addressed paths preserve unrelated files and make retry safe.
            const path: string = `source-archive/${digest(bundle.archiveId).slice(0, 20)}/${target.articleId}/${digest(file.asset.id).slice(0, 16)}-${file.sha256}${extname(file.asset.path).toLowerCase()}`;
            const stored: StoredInfo | null = deps.storage.info ? await deps.storage.info(path) : null;
            if (stored) {
              if (stored.size !== file.bytes.length || stored.sha256 !== file.sha256) throw new Error("An existing source file has different bytes; it was preserved.");
            } else if (await deps.storage.exists(path)) {
              const existing = await deps.storage.getFile(path);
              if (!existing || digest(existing) !== file.sha256) throw new Error("An existing source file has different bytes; it was preserved.");
            } else if (!await deps.storage.saveFile(path, file.bytes)) throw new Error("The original file could not be saved.");
            const attached = await deps.attach({ archiveId: bundle.archiveId, sourceKey: file.asset.sourceKey, articleId: target.articleId!, filePath: path,
              fileName: file.asset.originalFileName, originalFileName: file.asset.originalFileName, attachmentType: file.asset.attachmentType,
              fileSize: file.bytes.length, mimeType: file.asset.mimeType, caption: file.asset.caption, photoNumber: file.asset.photoNumber, sha256: file.sha256 });
            if (!attached.success) throw new Error("The saved original file could not be attached.");
            created ||= attached.created;
          }
          file.result.status = created ? "created" : "existing"; file.result.reason = null;
        } catch (error) { file.result.status = "failed"; file.result.reason = error instanceof Error ? error.message : "Original file import failed"; }
      }
      return withFiles(result, files, fileToken);
    },
  };
}

const service = createSourceArchiveService({
  preview: (bundle, documentIds) => query("previewSourceArchive", {bundle, documentIds}),
  importMetadata: (bundle, documentIds, previewToken) => mutate("importSourceArchive", {bundle, documentIds, previewToken}),
  attach: (data) => mutate("addSourceArchiveAttachment", data), storage: getStorage(),
});
export const previewSourceArchive = (manifest: unknown, issueIds?: string[], files?: SuppliedFiles) => service.preview(manifest, issueIds, files);
export const importSourceArchive = (manifest: unknown, issueIds?: string[], previewToken?: string, files?: SuppliedFiles) => service.import(manifest, issueIds, previewToken, files);

/** Inspect the directory before inflation; read only referenced files and verify ZIP CRCs. */
export async function readSourceArchiveZip(buffer: Buffer, documentIds?: string[]) {
  if (buffer.length > SOURCE_ARCHIVE_LIMITS.compressedBytes) throw new SourceArchiveRequestError("Source ZIP must fit within 64 MiB", 413);
  const zip = await new Promise<ZipFile>((done, fail) => yauzl.fromBuffer(buffer, {lazyEntries: true, autoClose: false, validateEntrySizes: true}, (error, value) => error ? fail(error) : done(value!)));
  const entries = new Map<string, Entry>();
  try {
    let expanded = 0;
    await new Promise<void>((done, fail) => {
      zip.on("error", fail); zip.on("end", done);
      zip.on("entry", (entry: Entry) => {
        try {
          const directory = entry.fileName.endsWith("/"), path = relativePath(directory ? entry.fileName.slice(0, -1) : entry.fileName);
          if ((entry.generalPurposeBitFlag & 1) || ((entry.externalFileAttributes >>> 16) & 0xf000) === 0xa000) throw new SourceArchiveRequestError("Encrypted files and symlinks are not supported");
          if (entries.has(path)) throw new SourceArchiveRequestError("Duplicate source ZIP entry");
          if (entries.size >= SOURCE_ARCHIVE_LIMITS.entries) throw new SourceArchiveRequestError("Too many source ZIP entries");
          expanded += entry.uncompressedSize;
          if (expanded > SOURCE_ARCHIVE_LIMITS.expandedBytes || entry.uncompressedSize > SOURCE_ARCHIVE_LIMITS.fileBytes) throw new SourceArchiveRequestError("Source ZIP exceeds its expanded size limit", 413);
          entries.set(path, entry); zip.readEntry();
        } catch (error) { fail(error); }
      });
      zip.readEntry();
    });
    const read = async (name: string, max: number) => {
      const entry = entries.get(name);
      if (!entry || entry.fileName.endsWith("/")) throw new SourceArchiveRequestError("Missing source archive file: " + name);
      if (entry.uncompressedSize > max) throw new SourceArchiveRequestError("Source archive file exceeds its size limit", 413);
      const stream = await new Promise<NodeJS.ReadableStream>((done, fail) => zip.openReadStream(entry, (error, value) => error ? fail(error) : done(value!)));
      const chunks: Buffer[] = []; let size = 0, checksum = 0;
      for await (const chunk of stream) {
        size += chunk.length;
        if (size > max) throw new SourceArchiveRequestError("Source archive file exceeds its size limit", 413);
        checksum = crc32(chunk, checksum); chunks.push(Buffer.from(chunk));
      }
      if (size !== entry.uncompressedSize || checksum !== entry.crc32) throw new SourceArchiveRequestError("Source ZIP file failed its integrity check");
      return Buffer.concat(chunks);
    };
    const name = entries.has("source-archive.json") ? "source-archive.json" : "manifest.json";
    const bundle = parseSourceArchiveBundle(JSON.parse((await read(name, SOURCE_ARCHIVE_LIMITS.manifestBytes)).toString("utf8")));
    const files = new Map<string, Buffer>();
    for (const asset of attachmentAssets(bundle, documentIds)) {
      const matches = [asset.path, `files/${asset.path}`, `uploaded-files/${asset.path}`].filter((path) => entries.has(path));
      if (matches.length > 1) throw new SourceArchiveRequestError("Ambiguous copies of a source attachment in the ZIP");
      if (matches[0] && !files.has(asset.path)) files.set(asset.path, await read(matches[0], SOURCE_ARCHIVE_LIMITS.fileBytes));
    }
    return {bundle, files};
  } finally { zip.close(); }
}

/** Bounded request reading prevents oversized JSON or multipart uploads. */
export async function readSourceArchiveRequest(request: Request) {
  const multipart = request.headers.get("content-type")?.startsWith("multipart/form-data") ?? false;
  const maximum = multipart ? SOURCE_ARCHIVE_LIMITS.compressedBytes + 1024 ** 2 : SOURCE_ARCHIVE_LIMITS.manifestBytes + 1024 ** 2;
  if (Number(request.headers.get("content-length")) > maximum) throw new SourceArchiveRequestError("Source import request exceeds its size limit", 413);
  const chunks: Uint8Array[] = []; let size = 0;
  if (request.body) {
    const reader = request.body.getReader();
    try { for (;;) { const {done, value} = await reader.read(); if (done) break; size += value.byteLength; if (size > maximum) {await reader.cancel(); throw new SourceArchiveRequestError("Source import request exceeds its size limit", 413);} chunks.push(value); } }
    finally { reader.releaseLock(); }
  }
  const bytes = Buffer.concat(chunks);
  let payload: any, files: SuppliedFiles | undefined;
  if (multipart) {
    const form = await new Response(bytes, {headers: {"content-type": request.headers.get("content-type")!}}).formData();
    const upload = form.get("file"), preview = form.get("preview");
    if (!upload || typeof upload === "string" || !["true", "false"].includes(String(preview))) throw new SourceArchiveRequestError("Provide a source ZIP and choose preview or import");
    const issueIds = form.has("issueIds") ? JSON.parse(String(form.get("issueIds"))) : undefined;
    const parsed = await readSourceArchiveZip(Buffer.from(await upload.arrayBuffer()), issueIds);
    payload = {manifest: parsed.bundle, issueIds, preview: preview === "true", previewToken: form.get("previewToken") ?? undefined}; files = parsed.files;
  } else {
    payload = JSON.parse(bytes.toString("utf8"));
  }
  if (!payload || typeof payload !== "object" || typeof payload.preview !== "boolean") throw new SourceArchiveRequestError("Provide a source archive manifest and choose preview or import");
  if (payload.previewToken !== undefined && (typeof payload.previewToken !== "string" || payload.previewToken.length > 512)) throw new SourceArchiveRequestError("Invalid source import preview token");
  return {...payload, files};
}
