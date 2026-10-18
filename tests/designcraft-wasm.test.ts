// @vitest-environment node
import { afterAll, beforeAll, expect, test } from "vitest";
import JSZip from "jszip";
import markdownit from "markdown-it";
import { execFileSync } from "node:child_process";
import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { createNativeService } from "../server/designcraft-native";

// The browser compiler modules are plain ES modules served from public/.
const root = process.cwd(), compilerDir = join(root, "public/designcraft/compiler");
const load = (name: string) => import(/* @vite-ignore */ pathToFileURL(join(compilerDir, name)).href);
const fixtureDir = join(root, "tests/fixtures/designcraft-march-2025");
let pages: any, issues: any, variants: any, story: any, executors: any, executor: any, library: any, fixture: any, fonts: { name: string; bytes: Uint8Array }[];
const temporary: string[] = [];

const loadMedia = async ({ root: base, path }: { root: string; path: string }) => {
  const directory = base === "issue" ? fixtureDir : join(root, "public/designcraft");
  try { return new Uint8Array(await readFile(resolve(directory, path))); } catch { return null; }
};

beforeAll(async () => {
  [pages, issues, variants, story, executors] = await Promise.all(["page-compiler.js", "issue-compiler.js", "variants.js", "markdown-story.js", "executors.js"].map(load));
  const base = pathToFileURL(join(root, "public/designcraft/headless") + "/").href;
  const { Engine } = await executors.loadHeadlessEngine(base, async (name: string) => new Uint8Array(await readFile(new URL(name, base))));
  executor = executors.wasmExecutor(Engine);
  library = JSON.parse(await readFile(join(root, "public/designcraft/templates.json"), "utf8"));
  fixture = JSON.parse(await readFile(join(fixtureDir, "issue.json"), "utf8"));
  const fontDir = join(root, "public/designcraft/assets/fonts");
  fonts = await Promise.all((await readdir(fontDir)).map(async (name) => ({ name, bytes: new Uint8Array(await readFile(join(fontDir, name))) })));
}, 60000);
afterAll(async () => { for (const directory of temporary) await rm(directory, { recursive: true, force: true }); });

test("committed headless engine passes its integrity manifest and runs a command script", async () => {
  const manifest = JSON.parse(await readFile(join(root, "public/designcraft/headless/manifest.json"), "utf8"));
  expect(manifest.upstream).toMatchObject({ tag: "v0.9.0", rev: "7cb8b12507def48fb9346e5004340b5e8e4cfcb7" });
  expect(executor.version).toBe("designcraft-headless 0.9.0 (WebAssembly)");
  const run = await executor.run([
    { command: "file.new", params: { width: 300, height: 300, pages: 1 } },
    { command: "frame.create", params: { rect: [20, 20, 280, 80], content: "text", text: "Headless", caret: false } },
    { command: "file.exportPdf", params: { path: "@out:a.pdf", standard: "x4" } },
    { command: "file.exportIdml", params: { path: "@out:a.idml" } },
    { command: "file.saveAs", params: { path: "@doc" } },
  ], { fonts });
  expect(new TextDecoder().decode(run.outputs["a.pdf"].subarray(0, 5))).toBe("%PDF-");
  expect((await JSZip.loadAsync(run.outputs["a.idml"])).file("designmap.xml")).not.toBeNull();
  expect((await JSZip.loadAsync(run.doc)).file("document.json")).not.toBeNull();
  const png = await executor.renderPng(run.doc, { page: 0, scale: 0.5 });
  expect([...png.subarray(1, 4)]).toEqual([0x50, 0x4e, 0x47]);
});

test("Markdown conversion keeps UTF-8 byte ranges, combined emphasis and links", () => {
  const result = story.composeSource("Café ***both*** [link](https://x.y)\n\n- one\n- two", "markdown", markdownit);
  expect(result.text).toBe("Café both link\n• one\n• two");
  expect(result.spans).toContainEqual({ start: 6, end: 10, attrs: { fontStyle: "Bold Italic" } });
  expect(result.spans).toContainEqual({ start: 11, end: 15, kind: "link", url: "https://x.y" });
  expect(() => story.composeSource("<div>x</div>", "markdown", markdownit)).toThrow(/HTML blocks/);
});

test("real articles compose into a checked page with focal crop, PDF and IDML", async () => {
  const built = await pages.buildPage({ library, templateId: "story-2-two-top-stacked", issue: fixture, articleIds: ["march-cfur-carbon-capture", "march-cn-centre-30"], pageNumber: 2, pageId: "page-2", markdownit, loadMedia });
  expect(built.steps.filter((s: any) => s.command === "file.place")).toHaveLength(2);
  const { manifest, artifacts } = await pages.compilePage(built, { executor, fonts, JSZip });
  expect(manifest.status).toBe("exported");
  expect(artifacts.preflight.errors).toBe(0);
  expect(artifacts.focalCrop.crops.every((c: any) => c.exactFocusApplied)).toBe(true);
  const { document } = await JSZip.loadAsync(artifacts.native).then(async (z) => ({ document: JSON.parse(await z.file("document.json")!.async("string")) }));
  const body = story.composeSource(fixture.articles[0].body, "markdown", markdownit).text;
  expect(Object.values<any>(document.stories).some((s) => s.text === body)).toBe(true);
  expect(new TextDecoder().decode(artifacts.pdf.subarray(0, 5))).toBe("%PDF-");
}, 60000);

test("an unfittable headline keeps a full-copy draft and blocks final exports", async () => {
  const issue = structuredClone(fixture);
  issue.articles[0].title = "A deliberately long headline that cannot fit. ".repeat(20);
  const built = await pages.buildPage({ library, templateId: "story-2-two-top-columns", issue, articleIds: ["march-cfur-carbon-capture", "march-cn-centre-30"], markdownit, loadMedia });
  const error = await pages.compilePage(built, { executor, fonts, JSZip }).catch((e: any) => e);
  expect(error).toBeInstanceOf(pages.CompileError);
  expect(error.artifacts.preflight.errors).toBeGreaterThan(0);
  expect(error.artifacts.native).toBeInstanceOf(Uint8Array);
  expect(error.artifacts.pdf).toBeUndefined();
}, 60000);

test("the fixture issue compiles to a booklet with live cover references in the browser engine", async () => {
  const { manifest, artifacts } = await issues.compileIssue({ library, issue: fixture, booklet: true, fonts, loadMedia, executor, markdownit, JSZip });
  expect(manifest.status).toBe("exported");
  expect(manifest.preflight.errors).toBe(0);
  const features = manifest.nativeCoverReferences.verification.features;
  expect(features.map((f: any) => f.generated)).toEqual(["02", "02", "03"]);
  expect(features.map((f: any) => f.text)).toEqual(["march-cfur-carbon-capture", "march-cn-centre-30", "march-compost-program"]
    .map((id, i) => ["02", "02", "03"][i] + " · " + fixture.articles.find((a: any) => a.id === id).title));
  expect(Object.values(manifest.articleBodyChecks).every(Boolean)).toBe(true);
  expect(manifest.pages.map((p: any) => p.nativePageId)).toHaveLength(4);
  expect(new TextDecoder().decode(artifacts.pdf.subarray(0, 5))).toBe("%PDF-");
}, 120000);

test("protected pages are refused in the browser compiler", async () => {
  const issue = structuredClone(fixture); issue.layoutPlan.pages[1].mode = "preserve";
  await expect(issues.compileIssue({ library, issue, fonts, loadMedia, executor, markdownit, JSZip })).rejects.toThrow(/server compiler/);
});

test("variants are composed for real and ranked; headline-only failures get explicit size steps", async () => {
  const result = await variants.generatePageVariants({ library, issue: fixture, articleIds: ["march-cfur-carbon-capture", "march-cn-centre-30"], executor, fonts, loadMedia, markdownit, JSZip, limit: 6, keep: 3 });
  expect(result.considered).toBeGreaterThan(result.composed);
  expect(result.variants.length).toBeGreaterThan(0);
  for (const v of result.variants) {
    expect(v.status).toBe("exported");
    expect(v.preflight.errors).toBe(0);
    expect(v.fill.every((f: number) => f > 0 && f <= 1.05)).toBe(true);
    expect([...v.preview.subarray(1, 4)]).toEqual([0x50, 0x4e, 0x47]);
  }
  expect(result.variants.map((v: any) => v.score)).toEqual([...result.variants.map((v: any) => v.score)].sort((a, b) => a - b));
  for (const v of result.rejected) expect(v.status).toBe("does-not-fit");
}, 120000);

test("server WASM engine produces the same job artifacts without a CLI or Python", async () => {
  const directory = await mkdtemp(join(tmpdir(), "ote-wasm-service-")); temporary.push(directory);
  const service = createNativeService({ engine: "wasm", repository: root, root: directory, python: "/nonexistent", cli: "/nonexistent" });
  try {
    const capabilities = await service.capabilities();
    expect(capabilities).toMatchObject({ available: true, engine: "wasm", version: "designcraft-headless 0.9.0 (WebAssembly)" });
    const zip = new JSZip();
    zip.file("issue.json", JSON.stringify(fixture)); zip.file("templates.json", JSON.stringify(library));
    for (const article of fixture.articles) for (const photo of article.photos) zip.file(photo.path, await readFile(join(fixtureDir, photo.path)));
    const recipe = await zip.generateAsync({ type: "nodebuffer" });
    const job = await service.submit({ recipe, mode: "issue", booklet: true });
    let result: any = job;
    for (const deadline = Date.now() + 120000; !["completed", "failed"].includes(result.status) && Date.now() < deadline;) { await new Promise((done) => setTimeout(done, 50)); result = await service.get(job.id); }
    expect(result.status, result.message).toBe("completed");
    expect((await service.artifact(job.id, "pdf")).buffer.subarray(0, 4).toString()).toBe("%PDF");
    const bundle = await JSZip.loadAsync((await service.artifact(job.id, "bundle")).buffer);
    expect(bundle.file("issue.designcraft")).not.toBeNull();
    expect(Object.keys(bundle.files).some((name) => name.startsWith("Document Fonts/SourceSerif4"))).toBe(true);
    await expect(service.submit({ recipe, base: recipe, mode: "issue" })).rejects.toThrow(/CLI engine/);
  } finally { await service.dispose(); }
}, 180000);

// Parity with the Python compilers (and the native CLI) when they are configured here.
const python = (() => { try { execFileSync("python3", ["-c", "import markdown_it"], { stdio: "ignore" }); return true; } catch { return false; } })();

test.skipIf(!python)("JavaScript Markdown conversion matches markdown_story.py exactly", () => {
  const cases = ["# H\n\n*a* **b** ***c*** `d` [e](http://f)", "1. x\n   - y\n2. z", "> q\n\nline  \nbreak", "<a id=\"_Toc\"></a>Bookmarked", "```\ncode\n```\n\n---"];
  const expected = JSON.parse(execFileSync("python3", ["-c", "import json,sys; sys.path.insert(0,'tools/designcraft'); from markdown_story import compose_source; print(json.dumps([compose_source(c) for c in json.load(sys.stdin)], ensure_ascii=False))"], { input: JSON.stringify(cases), encoding: "utf8" }));
  expect(cases.map((c) => story.composeSource(c, "markdown", markdownit))).toEqual(expected);
});

test.skipIf(!python || !process.env.DESIGNCRAFT_TEST_CLI)("command scripts and rendered pages match the Python compiler on the native CLI", async () => {
  const output = await mkdtemp(join(tmpdir(), "ote-parity-")); temporary.push(output);
  for (const templateId of ["story-3-three-top-lead-top", "cover-framed-cards-border", "piece-board-members", "ad-half-bottom"]) {
    execFileSync("python3", ["tools/designcraft/compile-template.py", "--library", "public/designcraft/templates.json", "--template", templateId, "--output", join(output, templateId), "--cli", process.env.DESIGNCRAFT_TEST_CLI!]);
    const built = await pages.buildPage({ library, templateId, markdownit, loadMedia });
    const mapped = built.steps.map((s: any) => ({ command: s.command, params: s.params.path === "@doc" ? { ...s.params, path: join(output, templateId, "page.designcraft") } : s.params.path?.startsWith("@media:") ? { ...s.params, path: join(output, templateId, "Links", s.params.path.slice(7)) } : s.params }));
    const lines = (await readFile(join(output, templateId, "commands.dcs"), "utf8")).trimEnd().split("\n").map((line) => { const at = line.indexOf(" "); return { command: line.slice(0, at), params: JSON.parse(line.slice(at + 1)) }; });
    expect(mapped).toEqual(lines);
    const { artifacts } = await pages.compilePage(built, { executor, fonts, JSZip });
    const native = JSON.parse(await (await JSZip.loadAsync(await readFile(join(output, templateId, "page.designcraft")))).file("document.json")!.async("string"));
    const ours = JSON.parse(await (await JSZip.loadAsync(artifacts.native)).file("document.json")!.async("string"));
    expect(Object.values<any>(ours.stories).map((s) => s.text).sort()).toEqual(Object.values<any>(native.stories).map((s) => s.text).sort());
  }
}, 180000);
