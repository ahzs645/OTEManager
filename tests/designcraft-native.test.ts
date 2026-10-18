// @vitest-environment node
import { afterEach, expect, test, vi } from "vitest";
import JSZip from "jszip";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createNativeService, inspectNativeZip, NATIVE_LIMITS, NativeRequestError, safeZipPath, type NativeRunner } from "../server/designcraft-native";

const services: ReturnType<typeof createNativeService>[] = [], directories: string[] = [];
afterEach(async () => {
  for (const service of services.splice(0)) await service.dispose();
  for (const directory of directories.splice(0)) await rm(directory, { recursive: true, force: true });
});
const issue = () => ({ schemaVersion: "ote.designcraft.issue.v1", issue: { id: "test", title: "Native service" },
  articles: [{ id: "article", title: "Exact headline", author: "Anonymous", body: "A **complete** source article.", photos: [] }],
  layoutPlan: { pages: [{ id: "page-1", pageNumber: 1, templateId: "story", kind: "story", articleIds: ["article"] }], cover: { mode: "editable" }, truck: { mode: "editable" } } });
const library = () => ({ schemaVersion: "ote.designcraft.templates.v1", page: { width: 756, height: 792, margin: 36 },
  templates: [{ id: "story", name: "Story", kind: "story", storyCount: 1, slots: [{ id: "body", role: "body", articleIndex: 0, rect: [36, 100, 720, 744] }] }] });
async function recipe(options: { issue?: any; library?: any; files?: Record<string, Buffer | string> } = {}) {
  const zip = new JSZip(); zip.file("issue.json", JSON.stringify(options.issue ?? issue())); zip.file("templates.json", JSON.stringify(options.library ?? library()));
  for (const [path, content] of Object.entries(options.files ?? {})) zip.file(path, content);
  return zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE" });
}
const success: NativeRunner = async (_command, args) => {
  const output = args[args.indexOf("--output") + 1], source = JSON.parse(await readFile(args[args.indexOf("--issue") + 1], "utf8"));
  const mode = args.some((a) => a.endsWith("compile-issue.py")) ? "issue" : "page";
  await writeFile(join(output, mode + ".designcraft"), "isolated-native-fixture");
  await writeFile(join(output, mode + ".pdf"), "isolated-pdf-fixture");
  await writeFile(join(output, mode + ".idml"), "isolated-idml-fixture");
  await writeFile(join(output, "preflight.json"), JSON.stringify({ errors: 0, warnings: 0, issues: [] }));
  await writeFile(join(output, "build-manifest.json"), JSON.stringify({ status: "exported" }));
  await writeFile(join(output, mode === "issue" ? "source-issue.json" : "source-record.json"), JSON.stringify(source));
  return { exitCode: 0, stdout: "success", stderr: "" };
};
function service(options: Partial<Parameters<typeof createNativeService>[0]> = {}) {
  const value = createNativeService({ repository: process.cwd(), cli: process.execPath, runner: success, ...options }); services.push(value); return value;
}
async function finished(value: ReturnType<typeof createNativeService>, id: string) {
  const deadline = Date.now() + 20000;
  while (Date.now() < deadline) { const job = await value.get(id); if (["completed", "failed"].includes(job.status)) return job; await new Promise((done) => setTimeout(done, 10)); }
  throw new Error("Native job did not finish");
}

test("ZIP inspection rejects traversal, absolute paths, aliases and symlinks before inflation", async () => {
  for (const path of ["../outside", "/outside", "C:/outside", "a\\b", "a/../b", "a./b"]) expect(() => safeZipPath(path)).toThrow(NativeRequestError);
  const traversal = new JSZip(); traversal.file("../outside", "payload");
  const bytes = await traversal.generateAsync({ type: "nodebuffer" }); expect(() => inspectNativeZip(bytes)).toThrow(/relative|traverse/);
  const links = new JSZip(); links.file("shortcut", "../outside", { unixPermissions: 0o120777 });
  const linked = await links.generateAsync({ type: "nodebuffer", platform: "UNIX" }); expect(() => inspectNativeZip(linked)).toThrow(/symlinks/);
  const aliases = new JSZip(); aliases.file("safeA", "A"); aliases.file("safeB", "B");
  const duplicate = await aliases.generateAsync({ type: "nodebuffer" });
  for (let at = 0; at < duplicate.length - 5; at++) if (duplicate.subarray(at, at + 5).toString() === "safeB") duplicate.write("safeA", at);
  expect(() => inspectNativeZip(duplicate)).toThrow(/duplicate/);
});

test("ZIP directory expanded limit is enforced before decompression", async () => {
  const bytes = await recipe();
  for (let at = 0; at < bytes.length - 46; at++) if (bytes.readUInt32LE(at) === 0x02014b50) { bytes.writeUInt32LE(NATIVE_LIMITS.uncompressedBytes + 1, at + 24); break; }
  expect(() => inspectNativeZip(bytes)).toThrow(/expanded/);
});

test("underreported expanded ZIP entries cannot bypass streaming size validation", async () => {
  const value = service(), bytes = await recipe();
  for (let at = 0; at < bytes.length - 46; at++) if (bytes.readUInt32LE(at) === 0x02014b50) { bytes.writeUInt32LE(1, at + 24); break; }
  await expect(value.submit({ recipe: bytes, mode: "page" })).rejects.toThrow(/expanded|decompress/);
});

test("resource references cannot access server files and invalid templates never run", async () => {
  const runner = vi.fn(success), value = service({ runner });
  for (const path of ["../../server-private.png", "/tmp/private.png", "https://example.test/photo.png"]) {
    const data = issue(); (data.articles[0].photos as any[]).push({ path });
    await expect(value.submit({ recipe: await recipe({ issue: data }), mode: "page" })).rejects.toThrow(/relative|traverse/);
  }
  const unknown = issue(); unknown.layoutPlan.pages[0].articleIds = ["missing"];
  await expect(value.submit({ recipe: await recipe({ issue: unknown }), mode: "issue" })).rejects.toThrow(/unknown article/);
  const bad = library(); bad.templates[0].slots[0].role = "shell.execute";
  await expect(value.submit({ recipe: await recipe({ library: bad }), mode: "page" })).rejects.toThrow(/slot role/);
  expect(runner).not.toHaveBeenCalled();
});

test("complete output/source is downloadable and optional storage persists exact artifact bytes", async () => {
  const stored = new Map<string, Buffer>(), storage = { saveFile: vi.fn(async (path: string, buffer: Buffer) => { stored.set(path, buffer); return true; }) };
  const value = service({ persist: true, storage });
  const job = await value.submit({ recipe: await recipe({ files: { "evil.py": "raise Exception('never execute')" } }), mode: "page" });
  const result = await finished(value, job.id); expect(result.status).toBe("completed"); expect(result.artifacts.pdf.persisted).toBe(true);
  const source = await value.artifact(job.id, "source"); expect(JSON.parse(source.buffer.toString()).articles[0].body).toBe(issue().articles[0].body);
  const bundle = await JSZip.loadAsync((await value.artifact(job.id, "bundle")).buffer);
  expect(bundle.file("recipe/issue.json")).not.toBeNull(); expect(bundle.file("evil.py")).toBeNull(); expect(bundle.file("recipe/evil.py")).toBeNull();
  expect([...stored.values()].some((buffer) => buffer.equals(source.buffer))).toBe(true);
  await expect(value.artifact(job.id, "../outside")).rejects.toMatchObject({ status: 404 });
  await expect(value.artifact(job.id, "constructor")).rejects.toMatchObject({ status: 404 });
});

test("failed preflight retains draft/source and removes even stale final PDF/IDML outputs", async () => {
  const runner: NativeRunner = async (...args) => {
    await success(...args); const output = args[1][args[1].indexOf("--output") + 1];
    await writeFile(join(output, "preflight.json"), JSON.stringify({ errors: 1, issues: [{ kind: "overset" }] }));
    return { exitCode: 1, stdout: "", stderr: "Full copy retained; overset blocks final output" };
  };
  const value = service({ runner }), job = await value.submit({ recipe: await recipe(), mode: "page" }), result = await finished(value, job.id);
  expect(result.status).toBe("failed"); expect(result.artifacts.native).toBeDefined(); expect(result.artifacts.source).toBeDefined(); expect(result.artifacts.pdf).toBeUndefined();
  const bundle = await JSZip.loadAsync((await value.artifact(job.id, "bundle")).buffer);
  expect(bundle.file("page.designcraft")).not.toBeNull(); expect(bundle.file("page.pdf")).toBeNull(); expect(bundle.file("page.idml")).toBeNull();
});

test("queue admission, timeout and expiry are bounded", async () => {
  const runner: NativeRunner = async (_command, _args, _cwd, signal) => new Promise((done) => signal.addEventListener("abort", () => done({ exitCode: 1, stdout: "", stderr: "timed out" }), { once: true }));
  const value = service({ runner, limits: { jobs: 1, timeoutMs: 60, retentionMs: 40 } }), bytes = await recipe();
  const first = await value.submit({ recipe: bytes, mode: "page" });
  await expect(value.submit({ recipe: bytes, mode: "page" })).rejects.toMatchObject({ status: 429 });
  const result = await finished(value, first.id); expect(result.status).toBe("failed"); expect(result.message).toMatch(/timeout/);
  await new Promise((done) => setTimeout(done, 60)); await expect(value.get(first.id)).rejects.toMatchObject({ status: 404 });
});

test("multipart upload validation and unavailable native configuration are explicit", async () => {
  const value = service(), form = new FormData(); form.set("recipe", new File([new Uint8Array(await recipe())], "recipe.zip")); form.set("mode", "page");
  const job = await value.submitRequest(new Request("http://test/api/designcraft/native", { method: "POST", body: form })); expect((await finished(value, job.id)).status).toBe("completed");
  await expect(value.submitRequest(new Request("http://test/api/designcraft/native", { method: "POST", body: "not multipart" }))).rejects.toMatchObject({ status: 400 });
  const unavailable = service({ cli: "/not-installed/designcraft-cli" }); expect((await unavailable.capabilities()).available).toBe(false);
  await expect(unavailable.submit({ recipe: await recipe(), mode: "page" })).rejects.toMatchObject({ status: 503 });
});

test("native base cannot retain external linked filesystem/URL resources", async () => {
  const value = service();
  const native = new JSZip(); native.file("document.json", JSON.stringify({ assets: { "1": { id: 1, link: "/private/photo.png" } } })); native.file("assets/1.png", "embedded");
  const base = new JSZip(); base.file("issue.designcraft", await native.generateAsync({ type: "nodebuffer" })); base.file("build-manifest.json", "{}");
  await expect(value.submit({ recipe: await recipe(), base: await base.generateAsync({ type: "nodebuffer" }), mode: "issue" })).rejects.toThrow(/external native asset/);
});

test("stalled uploads and optional storage do not keep capacity occupied indefinitely", async () => {
  const store = vi.fn(() => new Promise<boolean>(() => {}));
  const value = service({ storage: { saveFile: store }, persist: true, limits: { uploadTimeoutMs: 20, persistenceTimeoutMs: 20 } });
  const stream = new ReadableStream<Uint8Array>({ start() {} });
  await expect(value.submitRequest(new Request("http://test/api/designcraft/native", { method: "POST", body: stream, duplex: "half" } as RequestInit))).rejects.toMatchObject({ status: 408 });
  const job = await value.submit({ recipe: await recipe(), mode: "page" }), result = await finished(value, job.id);
  expect(result.status).toBe("completed"); expect(result.message).toContain("persistence failed or timed out");
  expect(store).toHaveBeenCalledTimes(1); expect((await value.artifact(job.id, "bundle")).buffer.length).toBeGreaterThan(0);
});

test("whole-issue page-stage failure exposes its page draft and matching sidecar without finals", async () => {
  const runner: NativeRunner = async (_command, args) => {
    const output = args[args.indexOf("--output") + 1], draft = join(output, "pages/002"); await mkdir(draft, { recursive: true });
    await writeFile(join(draft, "page.designcraft"), "complete isolated page draft");
    await writeFile(join(draft, "interchange-metadata.json"), JSON.stringify({ scope: "failed-page-2" }));
    await writeFile(join(output, "preflight.json"), JSON.stringify({ errors: 1, failedPageNumber: 2, issues: [{ kind: "overset" }] }));
    await writeFile(join(output, "build-manifest.json"), JSON.stringify({ status: "needs-layout-adjustment", failedPageNumber: 2 }));
    await writeFile(join(output, "interchange-metadata.json"), JSON.stringify({ scope: "unrelated-issue" }));
    return { exitCode: 1, stdout: "", stderr: "Page 2 headline overflowed" };
  };
  const value = service({ runner }), submitted = await value.submit({ recipe: await recipe(), mode: "issue" }), result = await finished(value, submitted.id);
  expect(result.status).toBe("failed"); expect(result.artifacts.native.name).toBe("draft-page-002.designcraft");
  expect(result.artifacts.pdf).toBeUndefined(); expect(result.artifacts.idml).toBeUndefined();
  expect(JSON.parse((await value.artifact(submitted.id, "interchange")).buffer.toString()).scope).toBe("failed-page-2");
  const bundle = await JSZip.loadAsync((await value.artifact(submitted.id, "bundle")).buffer);
  expect(bundle.file("draft-page-002.designcraft")).not.toBeNull(); expect(bundle.file("source-issue.json")).not.toBeNull(); expect(bundle.file("issue.pdf")).toBeNull();
});

test.skipIf(!process.env.DESIGNCRAFT_TEST_CLI)("real whole-issue headline failure offers root preflight, full source and editable page draft", async () => {
  const data = issue(); data.articles[0].title = "A deliberately long headline that cannot fit. ".repeat(100);
  const templates = library(); templates.templates[0].slots.unshift({ id: "headline", role: "headline", articleIndex: 0, rect: [36, 40, 720, 64] });
  const value = service({ cli: process.env.DESIGNCRAFT_TEST_CLI, runner: undefined });
  const submitted = await value.submit({ recipe: await recipe({ issue: data, library: templates }), mode: "issue" }), result = await finished(value, submitted.id);
  expect(result.status).toBe("failed"); expect(result.artifacts.native.name).toBe("draft-page-001.designcraft"); expect(result.artifacts.pdf).toBeUndefined(); expect(result.artifacts.idml).toBeUndefined();
  const preflight = JSON.parse((await value.artifact(submitted.id, "preflight")).buffer.toString()); expect(preflight.errors).toBeGreaterThan(0); expect(preflight.issues.some((issue: any) => issue.pageNumber === 1 && issue.pageId === "page-1")).toBe(true);
  const manifest = JSON.parse((await value.artifact(submitted.id, "manifest")).buffer.toString()); expect(manifest.failedPageNumber).toBe(1);
  const source = JSON.parse((await value.artifact(submitted.id, "source")).buffer.toString()); expect(source.articles[0].title).toBe(data.articles[0].title); expect(source.articles[0].body).toBe(data.articles[0].body);
  const native = await JSZip.loadAsync((await value.artifact(submitted.id, "native")).buffer); expect(native.file("document.json")).not.toBeNull();
  const bundle = await JSZip.loadAsync((await value.artifact(submitted.id, "bundle")).buffer); expect(Object.keys(bundle.files).some((name) => name.startsWith("Document Fonts/") && name.endsWith(".ttf"))).toBe(true); expect(bundle.file("issue.pdf")).toBeNull(); expect(bundle.file("issue.idml")).toBeNull();
}, 30000);

const continuationFixture = process.env.DESIGNCRAFT_TEST_FIXTURE ?? "/workspace/ote-review/pipeline-integration";
test.skipIf(!process.env.DESIGNCRAFT_TEST_CLI || !existsSync(join(continuationFixture, "issue.json")))("real compiler assembles continuation + native references from safe relative resources", async () => {
  const fixture = continuationFixture;
  const data = JSON.parse(await readFile(join(fixture, "issue.json"), "utf8")), templates = JSON.parse(await readFile(join(fixture, "templates.json"), "utf8"));
  const assets: Record<string, Buffer> = {};
  for (const template of templates.templates) for (const slot of template.slots) if (slot.asset?.startsWith("/")) { const name = "assets/" + slot.asset.split("/").pop(); assets[name] = await readFile(slot.asset); slot.asset = name; }
  if (data.layoutPlan.cover.photoPath.startsWith("/")) { const path = "assets/" + data.layoutPlan.cover.photoPath.split("/").pop(); assets[path] = await readFile(data.layoutPlan.cover.photoPath); data.layoutPlan.cover.photoPath = path; }
  const root = await mkdtemp(join(tmpdir(), "ote-real-native-test-")); directories.push(root);
  const value = service({ root, cli: process.env.DESIGNCRAFT_TEST_CLI, runner: undefined });
  const job = await value.submit({ recipe: await recipe({ issue: data, library: templates, files: assets }), mode: "issue", booklet: true }), result = await finished(value, job.id);
  expect(result.status, result.message).toBe("completed");
  const manifest = JSON.parse((await value.artifact(job.id, "manifest")).buffer.toString());
  expect(manifest.preflight.errors).toBe(0); expect(manifest.articleFlows).toBeDefined();
  const source = JSON.parse((await value.artifact(job.id, "source")).buffer.toString()); expect(source.articles[0].body).toBe(data.articles[0].body);
  expect((await value.artifact(job.id, "pdf")).buffer.subarray(0, 4).toString()).toBe("%PDF");
}, 30000);
