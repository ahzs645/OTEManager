import JSZip from "jszip";
import { spawn, execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { access, mkdir, mkdtemp, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import { constants } from "node:fs";
import { delimiter, dirname, join, resolve } from "node:path";
import { tmpdir } from "node:os";
import type { StorageProvider } from "../storage/types";

const MiB = 1024 * 1024;
export const NATIVE_LIMITS = Object.freeze({
  compressedBytes: 64 * MiB,
  uncompressedBytes: 256 * MiB,
  entries: 2048,
  jsonBytes: 8 * MiB,
  jobs: 12,
  concurrentJobs: 1,
  concurrentUploads: 2,
  timeoutMs: 10 * 60 * 1000,
  retentionMs: 60 * 60 * 1000,
  outputBytes: 512 * MiB,
  memoryBytes: 2 * 1024 * MiB,
  uploadTimeoutMs: 60 * 1000,
  persistenceTimeoutMs: 15 * 1000,
});

export class NativeRequestError extends Error {
  constructor(message: string, public status = 400) { super(message); }
}
type Mode = "page" | "issue";
type FontProfile = "portable" | "original2025";
type Status = "queued" | "running" | "completed" | "failed";
type Json = Record<string, any>;
export type NativeSubmission = {
  recipe: Buffer;
  base?: Buffer;
  mode: Mode;
  fontProfile?: FontProfile;
  booklet?: boolean;
};
export type NativeRunner = (command: string, args: string[], cwd: string, signal: AbortSignal) =>
  Promise<{ exitCode: number; stdout: string; stderr: string }>;
type Config = {
  repository?: string;
  root?: string;
  cli?: string;
  python?: string;
  toolsDir?: string;
  fontDir?: string;
  originalFontDir?: string;
  runner?: NativeRunner;
  storage?: Pick<StorageProvider, "saveFile">;
  persist?: boolean;
  limits?: Partial<typeof NATIVE_LIMITS>;
};
type Artifact = { file: string; name: string; mimeType: string; bytes: number; storagePath?: string };
type Job = {
  id: string; status: Status; mode: Mode; fontProfile: FontProfile; directory: string;
  createdAt: number; finishedAt?: number; message?: string; artifacts: Record<string, Artifact>;
  args: string[]; controller?: AbortController;
};

/** ZIP paths are data, never server paths. Reject aliases on both POSIX and Windows. */
export function safeZipPath(value: string): string {
  if (!value || value.length > 512 || /[\\\x00-\x1f\x7f:]/.test(value) || value.startsWith("/"))
    throw new NativeRequestError("ZIP entries must use relative paths without drives or backslashes.");
  const directory = value.endsWith("/");
  const parts = (directory ? value.slice(0, -1) : value).split("/");
  if (parts.some((part) => !part || part === "." || part === ".." || /[. ]$/.test(part)))
    throw new NativeRequestError("ZIP entries cannot traverse directories or contain ambiguous path segments.");
  return parts.join("/") + (directory ? "/" : "");
}

/** Read sizes/names BEFORE JSZip can inflate payloads; ZIP64 and encrypted archives are unsupported. */
export function inspectNativeZip(buffer: Buffer, limits = NATIVE_LIMITS) {
  if (buffer.length > limits.compressedBytes) throw new NativeRequestError("ZIP exceeds the compressed upload limit.", 413);
  let end = -1;
  for (let at = buffer.length - 22; at >= Math.max(0, buffer.length - 22 - 65535); at--) {
    if (buffer.readUInt32LE(at) === 0x06054b50 && at + 22 + buffer.readUInt16LE(at + 20) === buffer.length) { end = at; break; }
  }
  if (end < 0) throw new NativeRequestError("Invalid ZIP directory.");
  const count = buffer.readUInt16LE(end + 10), size = buffer.readUInt32LE(end + 12), start = buffer.readUInt32LE(end + 16);
  if (buffer.readUInt16LE(end + 4) || buffer.readUInt16LE(end + 6) || buffer.readUInt16LE(end + 8) !== count || count === 65535 || start === 0xffffffff || size === 0xffffffff)
    throw new NativeRequestError("Split and ZIP64 archives are unsupported.");
  if (!count || count > limits.entries || start + size !== end) throw new NativeRequestError("ZIP has too many entries or an invalid directory.");
  const names = new Set<string>(), entries: { name: string; bytes: number; compressedBytes: number }[] = [];
  let cursor = start, total = 0;
  for (let i = 0; i < count; i++) {
    if (cursor + 46 > end || buffer.readUInt32LE(cursor) !== 0x02014b50) throw new NativeRequestError("Invalid ZIP entry.");
    const flags = buffer.readUInt16LE(cursor + 8), method = buffer.readUInt16LE(cursor + 10);
    const compressed = buffer.readUInt32LE(cursor + 20), bytes = buffer.readUInt32LE(cursor + 24);
    const nameLength = buffer.readUInt16LE(cursor + 28), extraLength = buffer.readUInt16LE(cursor + 30), commentLength = buffer.readUInt16LE(cursor + 32);
    const local = buffer.readUInt32LE(cursor + 42), mode = buffer.readUInt32LE(cursor + 38) >>> 16;
    const next = cursor + 46 + nameLength + extraLength + commentLength;
    if (next > end || flags & 1 || ![0, 8].includes(method) || compressed === 0xffffffff || bytes === 0xffffffff || local === 0xffffffff)
      throw new NativeRequestError("Encrypted, ZIP64 or unsupported ZIP entries are not accepted.");
    const raw = buffer.subarray(cursor + 46, cursor + 46 + nameLength);
    const name = safeZipPath(raw.toString("utf8"));
    if (name.includes("\ufffd") || ((mode & 0xf000) && ![0x8000, 0x4000].includes(mode & 0xf000)))
      throw new NativeRequestError("ZIP symlinks and special files are not accepted.");
    const key = name.replace(/\/$/, "").toLocaleLowerCase("en-US");
    if (names.has(key)) throw new NativeRequestError("ZIP contains duplicate or aliased paths.");
    names.add(key);
    if (local + 30 > start || buffer.readUInt32LE(local) !== 0x04034b50) throw new NativeRequestError("Invalid ZIP local entry.");
    const localNameLength = buffer.readUInt16LE(local + 26), localExtraLength = buffer.readUInt16LE(local + 28);
    if (!raw.equals(buffer.subarray(local + 30, local + 30 + localNameLength)) || local + 30 + localNameLength + localExtraLength + compressed > start)
      throw new NativeRequestError("ZIP local paths or sizes do not match the directory.");
    total += bytes;
    if (total > limits.uncompressedBytes) throw new NativeRequestError("ZIP exceeds the expanded data limit.", 413);
    entries.push({ name, bytes, compressedBytes: compressed });
    cursor = next;
  }
  if (cursor !== end) throw new NativeRequestError("Invalid ZIP directory size.");
  return { entries, uncompressedBytes: total };
}

async function checkedZip(buffer: Buffer, limits: typeof NATIVE_LIMITS) {
  const directory = inspectNativeZip(buffer, limits);
  try {
    const zip = await JSZip.loadAsync(buffer);
    const expected = new Set(directory.entries.map((entry) => entry.name));
    if (Object.keys(zip.files).length !== expected.size || Object.entries(zip.files).some(([name, entry]) =>
      !expected.has(name) || (entry as any).unsafeOriginalName && (entry as any).unsafeOriginalName !== name))
      throw new NativeRequestError("ZIP paths have unsupported encoding aliases.");
    return { zip, directory };
  } catch (error) { if (error instanceof NativeRequestError) throw error; throw new NativeRequestError("Cannot read this ZIP."); }
}
async function entryBytes(zip: JSZip, name: string, expected?: number, maximum = NATIVE_LIMITS.uncompressedBytes) {
  const entry = zip.file(name);
  if (!entry) throw new NativeRequestError("Missing recipe resource: " + name);
  return new Promise<Buffer>((done, reject) => {
    const chunks: Buffer[] = []; let size = 0;
    const stream = entry.nodeStream("nodebuffer");
    stream.on("data", (data: Buffer) => {
      size += data.length;
      if (size > maximum || expected !== undefined && size > expected) {
        stream.pause(); reject(new NativeRequestError("ZIP expanded entry exceeds its allowed size: " + name, 413)); return;
      }
      chunks.push(data);
    }).on("error", () => reject(new NativeRequestError("Cannot decompress ZIP entry: " + name)))
      .on("end", () => expected !== undefined && size !== expected ? reject(new NativeRequestError("ZIP entry size is inconsistent: " + name)) : done(Buffer.concat(chunks))).resume();
  });
}
function record(value: unknown, label: string): Json {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new NativeRequestError(label + " must be an object.");
  return value as Json;
}
function array(value: unknown, label: string, max = 2048): any[] {
  if (!Array.isArray(value) || value.length > max) throw new NativeRequestError(label + " must be a bounded array.");
  return value;
}
function identifier(value: unknown, label: string): string {
  if (typeof value !== "string" || !value || value.length > 200 || /[,\x00-\x1f]/.test(value) || value.startsWith("-"))
    throw new NativeRequestError(label + " must be a nonempty stable ID.");
  return value;
}
function finite(value: unknown, label: string, min: number, max: number): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value < min || value > max)
    throw new NativeRequestError(label + " is outside the allowed numeric range.");
  return value;
}
function boundedJson(value: unknown, depth = 0, budget = { nodes: 0 }) {
  if (depth > 32 || ++budget.nodes > 100000) throw new NativeRequestError("JSON is too deeply nested or too large.");
  if (typeof value === "number" && !Number.isFinite(value)) throw new NativeRequestError("JSON numbers must be finite.");
  if (Array.isArray(value)) for (const item of value) boundedJson(item, depth + 1, budget);
  else if (value && typeof value === "object") for (const [key, item] of Object.entries(value)) {
    if (["__proto__", "constructor", "prototype"].includes(key)) throw new NativeRequestError("Unsupported JSON property.");
    boundedJson(item, depth + 1, budget);
  }
}
async function readJson(zip: JSZip, name: string, limits: typeof NATIVE_LIMITS) {
  const file = zip.file(name);
  if (!file) throw new NativeRequestError("Recipe must contain " + name + " at its root.");
  const declared = (file as any)._data?.uncompressedSize as number | undefined;
  if (declared !== undefined && declared > limits.jsonBytes) throw new NativeRequestError(name + " exceeds the JSON limit.", 413);
  const data = await entryBytes(zip, name, declared, limits.jsonBytes);
  if (data.length > limits.jsonBytes) throw new NativeRequestError(name + " exceeds the JSON limit.", 413);
  let parsed: unknown;
  try { parsed = JSON.parse(data.toString("utf8")); } catch { throw new NativeRequestError("Invalid JSON in " + name); }
  boundedJson(parsed);
  return record(parsed, name);
}

const ROLES = new Set(["headline", "body", "byline", "caption", "label", "folio", "photo", "ad", "piece"]);
const BRAND = new Set(["assets/ote-horizontal-logo.png", "assets/ote-stacked-logo.pdf", "assets/source-cover-photo.jpeg"]);
const MEDIA_EXTENSION = /\.(png|jpe?g|pdf|tiff?|webp)$/i;

async function prepareRecipe(buffer: Buffer, directory: string, repository: string, mode: Mode, limits: typeof NATIVE_LIMITS) {
  const { zip, directory: inspected } = await checkedZip(buffer, limits);
  const issue = await readJson(zip, "issue.json", limits), library = await readJson(zip, "templates.json", limits);
  if (issue.schemaVersion !== "ote.designcraft.issue.v1" || library.schemaVersion !== "ote.designcraft.templates.v1")
    throw new NativeRequestError("Unsupported issue or template schema.");
  const articles = array(issue.articles, "Articles", 1000), templates = array(library.templates, "Templates", 256);
  const articleIds = new Set<string>(), templateIds = new Set<string>(), resources = new Set<string>();
  const page = record(library.page, "Page settings");
  const width = finite(page.width, "Page width", 36, 3000), height = finite(page.height, "Page height", 36, 3000);
  if (page.margin !== undefined) finite(page.margin, "Page margin", 0, Math.min(width, height) / 2);
  if (page.gutter !== undefined) finite(page.gutter, "Page gutter", 0, 300);
  const resource = (value: unknown) => {
    if (typeof value !== "string") throw new NativeRequestError("Media references must be relative ZIP paths.");
    const path = safeZipPath(value);
    if (path.endsWith("/") || !MEDIA_EXTENSION.test(path)) throw new NativeRequestError("Unsupported media reference: " + path);
    resources.add(path);
    return path;
  };
  for (const article of articles) {
    record(article, "Article"); const id = identifier(article.id, "Article ID");
    if (articleIds.has(id)) throw new NativeRequestError("Duplicate article ID.");
    articleIds.add(id);
    if (typeof article.title !== "string" || typeof article.body !== "string" || (article.bodyFormat !== undefined && !["plain", "markdown"].includes(article.bodyFormat)))
      throw new NativeRequestError("Articles need a title and full source text.");
    for (const photo of array(article.photos, "Article photos", 100)) resource(record(photo, "Photo").path);
  }
  for (const template of templates) {
    record(template, "Template"); const id = identifier(template.id, "Template ID");
    if (templateIds.has(id)) throw new NativeRequestError("Duplicate template ID.");
    templateIds.add(id);
    if (!["story", "cover", "ad", "custom"].includes(template.kind)) throw new NativeRequestError("Unknown template kind.");
    finite(template.storyCount ?? 0, "Story count", 0, 3);
    const slotIds = new Set<string>();
    for (const slot of array(template.slots, "Template slots", 128)) {
      record(slot, "Slot"); const sid = identifier(slot.id, "Slot ID");
      if (slotIds.has(sid) || !ROLES.has(slot.role)) throw new NativeRequestError("Duplicate slot ID or unsupported slot role.");
      slotIds.add(sid);
      const rect = array(slot.rect, "Slot rectangle", 4);
      if (rect.length !== 4 || rect.some((n) => typeof n !== "number" || !Number.isFinite(n)) || rect[0] < 0 || rect[1] < 0 || rect[2] > width || rect[3] > height || rect[2] <= rect[0] || rect[3] <= rect[1])
        throw new NativeRequestError("Slot rectangles must fit within the finite page bounds.");
      for (const key of ["articleIndex", "photoIndex"]) if (slot[key] !== undefined && (!Number.isInteger(slot[key]) || slot[key] < 0 || slot[key] > 99))
        throw new NativeRequestError("Invalid slot index.");
      if (slot.fontSize !== undefined) finite(slot.fontSize, "Slot font size", 1, 300);
      if (slot.columns !== undefined && (!Number.isInteger(slot.columns) || slot.columns < 1 || slot.columns > 12)) throw new NativeRequestError("Invalid column count.");
      if (slot.asset) resource(slot.asset);
      if (slot.fit !== undefined && !["contain", "cover"].includes(slot.fit)) throw new NativeRequestError("Invalid image fitting mode.");
      if (slot.focus) { const focus = record(slot.focus, "Photo focus"); finite(focus.x, "Focus X", 0, 1); finite(focus.y, "Focus Y", 0, 1); }
    }
  }
  const plan = record(issue.layoutPlan ?? {}, "Layout plan");
  for (const p of array(plan.pages ?? [], "Planned pages", 256)) {
    record(p, "Planned page"); identifier(p.id, "Page ID");
    if (!Number.isInteger(p.pageNumber) || p.pageNumber < 1 || p.pageNumber > 256 || !templateIds.has(p.templateId)) throw new NativeRequestError("Planned page references an unknown template or invalid page number.");
    for (const aid of array(p.articleIds ?? [], "Article assignments", 3)) if (!articleIds.has(aid)) throw new NativeRequestError("Page references an unknown article.");
  }
  if (plan.cover?.photoPath) resource(plan.cover.photoPath);
  if (plan.cover?.focus) { finite(plan.cover.focus.x, "Cover focus X", 0, 1); finite(plan.cover.focus.y, "Cover focus Y", 0, 1); }
  for (const media of Object.values(plan.media ?? {})) resource(record(media, "Layout media").path);
  let selected: Json | undefined;
  if (zip.file("page-plan.json")) selected = await readJson(zip, "page-plan.json", limits);
  const templateId = mode === "page" ? selected?.templateId ?? (templates.length === 1 ? templates[0].id : undefined) : undefined;
  if (mode === "page" && !templateIds.has(templateId)) throw new NativeRequestError("A page recipe needs one selected template.");
  const pageNumber = Number(selected?.controls?.["page-number"] ?? 1);
  if (!Number.isInteger(pageNumber) || pageNumber < 1 || pageNumber > 9999) throw new NativeRequestError("Invalid selected page number.");
  const selectedArticles: string[] = selected?.articleIds ?? [];
  for (const aid of array(selectedArticles, "Selected articles", 3)) if (!articleIds.has(aid)) throw new NativeRequestError("Selected page references an unknown article.");
  await mkdir(directory, { recursive: true });
  await writeFile(join(directory, "issue.json"), JSON.stringify(issue));
  await writeFile(join(directory, "templates.json"), JSON.stringify(library));
  const sizes = new Map(inspected.entries.map((entry) => [entry.name, entry.bytes]));
  for (const path of resources) {
    const target = join(directory, path); await mkdir(dirname(target), { recursive: true });
    if (zip.file(path)) await writeFile(target, await entryBytes(zip, path, sizes.get(path)));
    else if (BRAND.has(path)) await writeFile(target, await readFile(join(repository, "public/designcraft", path)));
    else throw new NativeRequestError("Missing original media in the recipe ZIP: " + path);
  }
  // Archive scripts and executables are deliberately ignored. Only validated JSON/resources are staged.
  return { templateId, pageNumber, articleIds: selectedArticles };
}

async function prepareBase(buffer: Buffer, directory: string, limits: typeof NATIVE_LIMITS, expandedBeforeNative: number) {
  const { zip, directory: inspected } = await checkedZip(buffer, limits);
  const candidates = inspected.entries.filter((entry) => entry.name.endsWith(".designcraft"));
  if (candidates.length !== 1) throw new NativeRequestError("Base ZIP must contain exactly one native DesignCraft document.");
  const candidate = candidates[0], native = await entryBytes(zip, candidate.name, candidate.bytes);
  const { zip: inner, directory: nativeDirectory } = await checkedZip(native, limits);
  if (expandedBeforeNative + nativeDirectory.uncompressedBytes > limits.uncompressedBytes)
    throw new NativeRequestError("Combined recipe/base expansion exceeds the upload data limit.", 413);
  const document = await readJson(inner, "document.json", limits);
  for (const asset of Object.values(document.assets ?? {})) {
    const value = record(asset, "Native asset");
    for (const key of ["link", "path", "sourcePath", "filePath"]) if (value[key]) throw new NativeRequestError("Native bases must embed their media; external native asset paths are not accepted.");
    if (!Object.keys(inner.files).some((path) => path.startsWith("assets/" + value.id + ".")))
      throw new NativeRequestError("Native base contains missing or unembedded media.");
  }
  const prefix = candidate.name.includes("/") ? candidate.name.slice(0, candidate.name.lastIndexOf("/") + 1) : "";
  const manifest = await readJson(zip, prefix + "build-manifest.json", limits);
  await mkdir(directory, { recursive: true });
  const target = join(directory, "base.designcraft");
  await writeFile(target, native); await writeFile(join(directory, "build-manifest.json"), JSON.stringify(manifest));
  for (const entry of inspected.entries) if (entry.name.startsWith(prefix + "Document Fonts/") && /\.(ttf|otf|ttc|otc)$/i.test(entry.name)) {
    const name = entry.name.slice((prefix + "Document Fonts/").length);
    if (name.includes("/")) throw new NativeRequestError("Base fonts must be directly inside Document Fonts.");
    await mkdir(join(directory, "Document Fonts"), { recursive: true });
    await writeFile(join(directory, "Document Fonts", name), await entryBytes(zip, entry.name, entry.bytes));
  }
  return target;
}

async function executable(command: string) {
  const paths = command.includes("/") || command.includes("\\") ? [resolve(command)] :
    (process.env.PATH ?? "").split(delimiter).flatMap((directory) => [join(directory, command), ...(process.platform === "win32" ? [join(directory, command + ".exe")] : [])]);
  for (const path of paths) try { await access(path, constants.X_OK); if ((await stat(path)).isFile()) return path; } catch { /* try next PATH entry */ }
  return undefined;
}
const processRunner: NativeRunner = (command, args, cwd, signal) => new Promise((done, reject) => {
  const child = spawn(command, args, { cwd, shell: false, detached: process.platform !== "win32", stdio: ["ignore", "pipe", "pipe"] });
  let stdout = "", stderr = "";
  child.stdout.on("data", (data: Buffer) => { if (stdout.length < 2 * MiB) stdout += data.toString().slice(0, 2 * MiB - stdout.length); });
  child.stderr.on("data", (data: Buffer) => { if (stderr.length < 2 * MiB) stderr += data.toString().slice(0, 2 * MiB - stderr.length); });
  const stop = () => {
    if (!child.pid) return;
    if (process.platform === "win32") execFile("taskkill", ["/pid", String(child.pid), "/T", "/F"], () => {});
    else try { process.kill(-child.pid, "SIGKILL"); } catch { child.kill("SIGKILL"); }
  };
  signal.addEventListener("abort", stop, { once: true }); if (signal.aborted) stop();
  child.on("error", reject);
  child.on("close", (code) => { signal.removeEventListener("abort", stop); done({ exitCode: code ?? 1, stdout, stderr }); });
});

async function directorySize(path: string): Promise<number> {
  let total = 0;
  for (const entry of await readdir(path, { withFileTypes: true })) {
    if (entry.isSymbolicLink()) throw new NativeRequestError("Unexpected symlink in compiler output.");
    total += entry.isDirectory() ? await directorySize(join(path, entry.name)) : (await stat(join(path, entry.name))).size;
  }
  return total;
}

export function createNativeService(config: Config = {}) {
  const repository = resolve(config.repository ?? process.cwd()), tools = resolve(config.toolsDir ?? process.env.DESIGNCRAFT_TOOLS_DIR ?? join(repository, "tools/designcraft"));
  const python = config.python ?? process.env.DESIGNCRAFT_PYTHON ?? "python3", cli = config.cli ?? process.env.DESIGNCRAFT_CLI ?? "designcraft-cli";
  const fonts = resolve(config.fontDir ?? process.env.DESIGNCRAFT_FONT_DIR ?? join(repository, "public/designcraft/assets/fonts"));
  const originals = config.originalFontDir ?? process.env.DESIGNCRAFT_ORIGINAL_FONT_DIR;
  const limits = { ...NATIVE_LIMITS, ...config.limits };
  const run = config.runner ?? processRunner, jobs = new Map<string, Job>();
  const rootPromise = config.root ? mkdir(config.root, { recursive: true }).then(() => resolve(config.root!)) : mkdtemp(join(tmpdir(), "ote-native-jobs-"));
  let running = 0, admitting = 0, uploads = 0, disposed = false;
  let capabilityCache: { at: number; value: any } | undefined;
  async function capabilities() {
    if (capabilityCache && Date.now() - capabilityCache.at < 30000) return capabilityCache.value;
    const [cliPath, pythonPath] = await Promise.all([executable(cli), executable(python)]);
    const exists = async (path: string) => { try { await access(path); return true; } catch { return false; } };
    const [compilerPresent, portable, original] = await Promise.all([exists(join(tools, "compile-issue.py")), exists(fonts), originals ? exists(resolve(originals)) : Promise.resolve(false)]);
    let version: string | null = null;
    if (cliPath) version = await new Promise<string | null>((done) => execFile(cliPath, ["--version"], { timeout: 3000, maxBuffer: 8192 }, (error, stdout) => done(error ? null : stdout.trim())));
    const available = !!cliPath && !!pythonPath && compilerPresent && portable && !!version;
    const value = { available, version, fontProfiles: [...(portable ? ["portable"] : []), ...(original ? ["original2025"] : [])], limits, persistence: !!config.storage && !!config.persist,
      message: available ? "Native export is available on this server." : "Native export needs the DesignCraft CLI, Python compiler and fonts configured on this server." };
    capabilityCache = { at: Date.now(), value }; return value;
  }
  function publicJob(job: Job) {
    return { id: job.id, status: job.finishedAt ? job.status : job.status === "queued" ? "queued" : "running", mode: job.mode, fontProfile: job.fontProfile,
      createdAt: new Date(job.createdAt).toISOString(), finishedAt: job.finishedAt ? new Date(job.finishedAt).toISOString() : null,
      expiresAt: new Date((job.finishedAt ?? job.createdAt) + limits.retentionMs).toISOString(), message: job.message,
      artifacts: Object.fromEntries(Object.entries(job.artifacts).map(([key, artifact]) => [key, { name: artifact.name, mimeType: artifact.mimeType, bytes: artifact.bytes, persisted: !!artifact.storagePath }])) };
  }
  async function sweep(evictForAdmission = false) {
    const completed = [...jobs.values()].filter((job) => job.finishedAt).sort((a, b) => a.finishedAt! - b.finishedAt!);
    for (const job of completed) if (Date.now() - job.finishedAt! > limits.retentionMs || evictForAdmission && jobs.size >= limits.jobs) {
      jobs.delete(job.id); await rm(job.directory, { recursive: true, force: true });
    }
  }
  async function collect(job: Job) {
    const output = join(job.directory, "output"), prefix = job.mode === "issue" ? "issue" : "page";
    const names: Record<string, [string, string]> = {
      native: [prefix + ".designcraft", "application/zip"], pdf: [prefix + ".pdf", "application/pdf"], idml: [prefix + ".idml", "application/zip"],
      manifest: ["build-manifest.json", "application/json"], preflight: ["preflight.json", "application/json"], source: [job.mode === "issue" ? "source-issue.json" : "source-record.json", "application/json"], interchange: ["interchange-metadata.json", "application/json"],
      log: ["native-service-log.json", "application/json"],
    };
    for (const [key, [name, mimeType]] of Object.entries(names)) {
      if (job.status !== "completed" && ["pdf", "idml"].includes(key)) { await rm(join(output, name), { force: true }); continue; }
      try { const size = (await stat(join(output, name))).size; job.artifacts[key] = { file: join(output, name), name, mimeType, bytes: size }; } catch { /* failures may only have source/logs */ }
    }
    if (job.status === "failed" && job.mode === "issue" && !job.artifacts.native) {
      let pageNumber: unknown;
      for (const report of ["build-manifest.json", "preflight.json"]) {
        try { pageNumber = JSON.parse(await readFile(join(output, report), "utf8")).failedPageNumber; } catch { /* report may be absent */ }
        if (Number.isInteger(pageNumber)) break;
      }
      if (typeof pageNumber === "number" && Number.isInteger(pageNumber) && pageNumber >= 1 && pageNumber <= 256) {
        const label = String(pageNumber).padStart(3, "0"), pageDirectory = join(output, "pages", label);
        try {
          const file = join(pageDirectory, "page.designcraft"), bytes = (await stat(file)).size;
          job.artifacts.native = { file, name: "draft-page-" + label + ".designcraft", mimeType: "application/zip", bytes };
          // This sidecar belongs to the offered page draft, rather than to an
          // unassembled issue. Never pair a page draft with unrelated metadata.
          delete job.artifacts.interchange;
          try {
            const metadata = join(pageDirectory, "interchange-metadata.json");
            job.artifacts.interchange = { file: metadata, name: "interchange-metadata.json", mimeType: "application/json", bytes: (await stat(metadata)).size };
          } catch { /* draft may have failed before metadata was written */ }
        } catch { /* early page failures can still retain complete source/reports */ }
      }
    }
    if (!job.artifacts.source) {
      const file = join(job.directory, "recipe/issue.json");
      job.artifacts.source = { file, name: "source-issue.json", mimeType: "application/json", bytes: (await stat(file)).size };
    }
    const bundle = new JSZip();
    for (const artifact of Object.values(job.artifacts)) bundle.file(artifact.name, await readFile(artifact.file));
    const addSource = async (path: string, prefix: string) => {
      for (const entry of await readdir(path, { withFileTypes: true })) {
        if (entry.isSymbolicLink()) throw new Error("Unexpected symlink in staged source.");
        if (entry.isDirectory()) await addSource(join(path, entry.name), prefix + entry.name + "/");
        else bundle.file(prefix + entry.name, await readFile(join(path, entry.name)));
      }
    };
    await addSource(join(job.directory, "recipe"), "recipe/");
    const addFonts = async (directory: string) => {
      try { for (const name of await readdir(directory)) if (/\.(ttf|otf|ttc|otc|txt)$/i.test(name)) bundle.file("Document Fonts/" + name, await readFile(join(directory, name))); } catch { /* no fonts in an early failed job */ }
    };
    await addFonts(join(output, "Document Fonts"));
    bundle.file("README.txt", "OTE native output. Keep Document Fonts and interchange-metadata.json beside the document. Failed builds retain a complete source and any native draft; PDF/IDML final exports are available only after compiler preflight passes. Adobe/printer verification is separate.\n");
    const file = join(job.directory, "native-output.zip"), data = await bundle.generateAsync({ type: "nodebuffer", compression: "DEFLATE" });
    if (data.length > limits.outputBytes) throw new Error("Native artifact bundle exceeds the output limit.");
    await writeFile(file, data); job.artifacts.bundle = { file, name: "ote-" + job.mode + "-native-output.zip", mimeType: "application/zip", bytes: data.length };
    if (config.persist && config.storage) for (const artifact of Object.values(job.artifacts)) {
      const path = "designcraft/jobs/" + job.id + "/" + artifact.name;
      let timeout: ReturnType<typeof setTimeout> | undefined;
      try {
        const saved = await Promise.race([
          config.storage.saveFile(path, await readFile(artifact.file)),
          new Promise<boolean>((_done, reject) => { timeout = setTimeout(() => reject(new Error("Storage persistence timed out")), limits.persistenceTimeoutMs); }),
        ]);
        if (!saved) throw new Error("Storage rejected artifact");
        artifact.storagePath = path;
      } catch {
        job.message = (job.message ?? "") + " Artifact persistence failed or timed out; downloads remain available until expiry.";
        // The storage interface has no cancellation hook. Stop here so a stalled
        // provider cannot accumulate further pending writes or keep the job open.
        break;
      } finally { if (timeout) clearTimeout(timeout); }
    }
  }
  async function execute(job: Job) {
    running++; job.status = "running"; job.controller = new AbortController();
    const output = join(job.directory, "output");
    const timer = setTimeout(() => job.controller?.abort(), limits.timeoutMs);
    timer.unref();
    let oversized = false, monitoring = false;
    const monitor = setInterval(() => {
      if (monitoring) return; monitoring = true;
      void directorySize(output).then((size) => { if (size > limits.outputBytes) { oversized = true; job.controller?.abort(); } })
        .catch(() => {}).finally(() => { monitoring = false; });
    }, 1000); monitor.unref();
    try {
      await mkdir(output, { recursive: true });
      const result = await run(python, job.args, job.directory, job.controller.signal);
      await writeFile(join(output, "native-service-log.json"), JSON.stringify({ exitCode: result.exitCode, stdout: result.stdout, stderr: result.stderr }, null, 2));
      if (job.controller.signal.aborted) throw new Error(oversized ? "Native output exceeded the job data limit." : "Native export exceeded the job timeout. Any completed draft remains available.");
      if (await directorySize(output) > limits.outputBytes) throw new Error("Native output exceeds the job data limit.");
      let preflight: Json, manifest: Json;
      try { preflight = JSON.parse(await readFile(join(output, "preflight.json"), "utf8")); manifest = JSON.parse(await readFile(join(output, "build-manifest.json"), "utf8")); }
      catch { throw new Error(result.stderr.trim().slice(0, 1500) || "Native compilation failed before preflight."); }
      if (result.exitCode !== 0 || preflight.errors !== 0 || manifest.status !== "exported")
        throw new Error(result.stderr.trim().slice(0, 1500) || "Native preflight failed. Review the downloadable source, draft and preflight report.");
      const prefix = job.mode === "issue" ? "issue" : "page";
      await Promise.all(["designcraft", "pdf", "idml"].map((extension) => access(join(output, prefix + "." + extension))));
      job.status = "completed"; job.message = "Native, PDF and IDML output passed compiler preflight.";
    } catch (error) { job.status = "failed"; job.message = error instanceof Error ? error.message : "Native export failed."; }
    finally {
      clearTimeout(timer); clearInterval(monitor);
      try { await collect(job); } catch (error) { job.status = "failed"; job.message = "Cannot package native output: " + (error instanceof Error ? error.message : "unknown error"); delete job.artifacts.pdf; delete job.artifacts.idml; delete job.artifacts.bundle; }
      job.finishedAt = Date.now(); running--; pump();
    }
  }
  function pump() {
    if (disposed) return;
    for (const job of jobs.values()) if (job.status === "queued" && running < limits.concurrentJobs) void execute(job);
  }
  async function submit(input: NativeSubmission) {
    if (disposed) throw new NativeRequestError("Native export service is closed.", 503);
    await sweep(true);
    if (jobs.size + admitting >= limits.jobs) throw new NativeRequestError("Native export queue is full. Retry after a current job finishes.", 429);
    admitting++;
    let directory: string | undefined;
    try {
      if (!["page", "issue"].includes(input.mode)) throw new NativeRequestError("Choose page or issue native output.");
      const profile = input.fontProfile ?? "portable";
      if (!["portable", "original2025"].includes(profile)) throw new NativeRequestError("Unsupported font profile.");
      if (input.recipe.length + (input.base?.length ?? 0) > limits.compressedBytes) throw new NativeRequestError("Combined recipe/base ZIPs exceed the upload limit.", 413);
      const expanded = inspectNativeZip(input.recipe, limits).uncompressedBytes + (input.base ? inspectNativeZip(input.base, limits).uncompressedBytes : 0);
      if (expanded > limits.uncompressedBytes) throw new NativeRequestError("Combined recipe/base expansion exceeds the upload data limit.", 413);
      const capability = await capabilities();
      if (!capability.available) throw new NativeRequestError(capability.message, 503);
      if (!capability.fontProfiles.includes(profile)) throw new NativeRequestError("Original fonts are not configured on this server.", 409);
      const id = randomUUID(); directory = join(await rootPromise, id);
      await mkdir(directory, { recursive: true });
      const recipe = join(directory, "recipe"), selected = await prepareRecipe(input.recipe, recipe, repository, input.mode, limits);
      const base = input.base ? await prepareBase(input.base, join(directory, "base"), limits, expanded) : undefined;
      const output = join(directory, "output");
      const script = join(tools, input.mode === "issue" ? "compile-issue.py" : "compile-template.py");
      // Native subprocesses inherit bounded Linux address-space/file limits. The trusted
      // bootstrap uses runpy; uploaded scripts are never staged or executed.
      const bootstrap = "import os,runpy,sys;" + (process.platform === "linux" ?
        `import resource;resource.setrlimit(resource.RLIMIT_AS,(${limits.memoryBytes},${limits.memoryBytes}));resource.setrlimit(resource.RLIMIT_FSIZE,(${limits.outputBytes},${limits.outputBytes}));` : "") +
        "sys.path.insert(0,os.path.dirname(sys.argv[1]));sys.argv=sys.argv[1:];runpy.run_path(sys.argv[0],run_name='__main__')";
      const args = ["-c", bootstrap, script, "--library", join(recipe, "templates.json"), "--issue", join(recipe, "issue.json"), "--output", output, "--cli", cli, "--font-dir", profile === "original2025" ? resolve(originals!) : fonts, "--font-profile", profile];
      if (input.mode === "page") {
        args.push("--template", selected.templateId, "--page-number", String(selected.pageNumber));
        if (selected.articleIds.length) args.push("--articles", selected.articleIds.join(","));
        if (base) throw new NativeRequestError("Native base preservation is available for whole-issue output.");
      } else { if (input.booklet) args.push("--booklet"); if (base) args.push("--base-native", base); }
      const job: Job = { id, status: "queued", mode: input.mode, fontProfile: profile, directory, createdAt: Date.now(), artifacts: {}, args };
      jobs.set(id, job); queueMicrotask(pump); return publicJob(job);
    } catch (error) { if (directory) await rm(directory, { recursive: true, force: true }); throw error; }
    finally { admitting--; }
  }
  async function submitRequest(request: Request) {
    if (uploads >= limits.concurrentUploads) throw new NativeRequestError("Too many simultaneous native uploads.", 429);
    uploads++;
    try {
      const maximum = limits.compressedBytes + MiB, declared = Number(request.headers.get("content-length"));
      if (declared > maximum) throw new NativeRequestError("Native upload exceeds the request limit.", 413);
      const reader = request.body?.getReader(); if (!reader) throw new NativeRequestError("Upload a multipart recipe ZIP.");
      const chunks: Uint8Array[] = []; let size = 0;
      let timedOut = false;
      const timer = setTimeout(() => { timedOut = true; void reader.cancel().catch(() => {}); }, limits.uploadTimeoutMs);
      try {
        while (true) { const { done, value } = await reader.read(); if (timedOut) throw new NativeRequestError("Native upload timed out.", 408); if (done) break; size += value.byteLength; if (size > maximum) { await reader.cancel(); throw new NativeRequestError("Native upload exceeds the request limit.", 413); } chunks.push(value); }
      } finally { clearTimeout(timer); reader.releaseLock(); }
      let form: FormData;
      try { form = await new Request(request.url, { method: "POST", headers: request.headers, body: new Uint8Array(Buffer.concat(chunks)) }).formData(); }
      catch { throw new NativeRequestError("Upload a multipart recipe ZIP."); }
      for (const key of form.keys()) if (!["recipe", "base", "mode", "fontProfile", "booklet"].includes(key) || form.getAll(key).length !== 1) throw new NativeRequestError("Unknown or repeated native request field.");
      const recipe = form.get("recipe"), base = form.get("base");
      if (!(recipe instanceof File) || (base && !(base instanceof File))) throw new NativeRequestError("Upload the recipe ZIP and optional native base ZIP.");
      const mode = form.get("mode") ?? "issue", profile = form.get("fontProfile") ?? "portable", booklet = form.get("booklet") ?? "false";
      if (!["true", "false"].includes(String(booklet))) throw new NativeRequestError("Booklet must be true or false.");
      return submit({ recipe: Buffer.from(await recipe.arrayBuffer()), base: base ? Buffer.from(await (base as File).arrayBuffer()) : undefined, mode: mode as Mode, fontProfile: profile as FontProfile, booklet: booklet === "true" });
    } finally { uploads--; }
  }
  async function get(id: string) {
    await sweep(); const job = jobs.get(id); if (!job) throw new NativeRequestError("Native job not found or expired.", 404); return publicJob(job);
  }
  async function artifact(id: string, key: string) {
    await sweep(); const job = jobs.get(id); if (!job) throw new NativeRequestError("Native job not found or expired.", 404);
    const item = Object.hasOwn(job.artifacts, key) ? job.artifacts[key] : undefined; if (!item || !job.finishedAt) throw new NativeRequestError("Artifact is not available for this job.", 404);
    return { ...item, buffer: await readFile(item.file) };
  }
  const sweepTimer = setInterval(() => { void sweep().catch(() => {}); }, Math.min(60000, limits.retentionMs)); sweepTimer.unref();
  async function dispose() { disposed = true; clearInterval(sweepTimer); for (const job of jobs.values()) job.controller?.abort(); await rm(await rootPromise, { recursive: true, force: true }); jobs.clear(); }
  return { capabilities, submit, submitRequest, get, artifact, dispose };
}

let instance: ReturnType<typeof createNativeService> | undefined;
export async function nativeService() {
  if (!instance) {
    const persist = process.env.DESIGNCRAFT_PERSIST_ARTIFACTS === "true";
    const storage = persist ? (await import("../storage")).getStorage() : undefined;
    instance = createNativeService({ persist, storage });
  }
  return instance;
}
