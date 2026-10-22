// @vitest-environment node
import { beforeAll, expect, test } from "vitest";
import JSZip from "jszip";
import markdownit from "markdown-it";
import sharp from "sharp";
import { readFile, readdir } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

const root = process.cwd(), staticDir = join(root, "public/designcraft");
const load = (name: string) => import(/* @vite-ignore */ pathToFileURL(join(staticDir, "compiler", name)).href);
let pages: any, issues: any, content: any, library: any, executor: any, fonts: any[];
const media = new Map<string, Uint8Array>();
const loadMedia = async ({ path }: { path: string }) => media.get(path) ?? new Uint8Array(await readFile(join(staticDir, path)));
const documentOf = async (bytes: Uint8Array) => JSON.parse(await (await JSZip.loadAsync(bytes)).file("document.json")!.async("string"));

beforeAll(async () => {
  let executors: any;
  [pages, issues, content, executors] = await Promise.all(["page-compiler.js", "issue-compiler.js", "structured-content.js", "executors.js"].map(load));
  const base = pathToFileURL(join(staticDir, "headless") + "/").href;
  const { Engine } = await executors.loadHeadlessEngine(base, async (name: string) => new Uint8Array(await readFile(new URL(name, base))));
  executor = executors.wasmExecutor(Engine);
  library = JSON.parse(await readFile(join(staticDir, "templates.json"), "utf8"));
  fonts = await Promise.all((await readdir(join(staticDir, "assets/fonts"))).map(async (name) => ({ name, bytes: new Uint8Array(await readFile(join(staticDir, "assets/fonts", name))) })));
}, 60000);

test("page-specific artwork and question/answer copy stay distinct when the same slots recur", async () => {
  for (const color of ["red", "blue"]) media.set(`media/${color}.png`, new Uint8Array(await sharp({ create: { width: 1000, height: 1000, channels: 3, background: color } }).png().toBuffer()));
  const template = { id: "recurring", name: "Recurring editorial and ad", kind: "custom", storyCount: 0, slots: [
    { id: "ad", role: "ad", rect: [36, 100, 360, 500] },
    { id: "qa", role: "piece", blockType: "president-qa", rect: [390, 100, 720, 500], fields: { heading: "President Answers", question: "Default question?", answer: "Default answer." } },
  ] };
  const issue = { schemaVersion: pages.ISSUE_SCHEMA, articles: [], layoutPlan: { media: { ad: { path: "media/red.png" } }, blocks: { qa: { fields: { question: "Global question?", answer: "Global answer." } } }, pages: [
    { id: "p1", pageNumber: 1, templateId: template.id, articleIds: [] },
    { id: "p2", pageNumber: 2, templateId: template.id, articleIds: [], media: { ad: { path: "media/blue.png" } }, blocks: { qa: { fields: { question: "Page two question?", answer: "Page two answer." } } } },
  ] } };
  const { artifacts, manifest } = await issues.compileIssue({ library: { ...library, templates: [template] }, issue, executor, fonts, JSZip, markdownit, loadMedia });
  expect(manifest.preflight.errors).toBe(0);
  const document = await documentOf(artifacts.native);
  const texts = Object.values<any>(document.stories).map((s) => s.text);
  expect(texts).toContain("President Answers\nGlobal question?\nGlobal answer.");
  expect(texts).toContain("President Answers\nPage two question?\nPage two answer.");
  const sourcePages = artifacts.pages;
  expect(sourcePages[0].artifacts.manifest.structuredBlocks[0].fields.find((f: any) => f.field === "answer").text).toBe("Global answer.");
  const assetPayloads = await Promise.all(sourcePages.map(async (p: any) => {
    const zip = await JSZip.loadAsync(p.artifacts.native);
    const path = Object.keys(zip.files).find((name) => name.startsWith("assets/") && !zip.files[name].dir)!;
    return zip.file(path)!.async("uint8array");
  }));
  expect(Buffer.from(assetPayloads[0]).equals(Buffer.from(assetPayloads[1]))).toBe(false);
}, 60000);

test("an original interior section changes its native header and keeps the article copy intact", async () => {
  const template = library.templates.find((t: any) => t.id === "ote-2024-story-1-none-balanced");
  const issue = { schemaVersion: pages.ISSUE_SCHEMA, articles: [{ id: "a", title: "A", author: "Editor", body: "A short article.", photos: [] }], layoutPlan: { pages: [{ id: "p2", pageNumber: 2, section: { code: "C", label: "Culture" } }] } };
  const built = await pages.buildPage({ library, template, issue, articleIds: ["a"], pageId: "p2", pageNumber: 2, markdownit, loadMedia });
  const { artifacts, manifest } = await pages.compilePage(built, { executor, fonts, JSZip });
  expect(manifest.section).toEqual({ code: "C", label: "Culture" });
  const texts = Object.values<any>((await documentOf(artifacts.native)).stories).map((s) => s.text);
  expect(texts).toContain("C");
  expect(texts).toContain("A");
  expect(texts).toContain("A short article.");
}, 60000);

test("structured regions refuse missing copy and layouts that omit supplied editorial fields", () => {
  expect(() => content.structuredContent({ id: "qa", blockType: "president-qa" }, { question: "Question?" }, markdownit)).toThrow(/nonempty answer/);
  expect(() => content.structuredContent({ id: "qa", contentLayout: [{ field: "question", rect: [0, 0, 1, 1] }] }, { question: "Question?", answer: "Must not disappear" }, markdownit)).toThrow(/no region for answer/);
  expect(() => content.structuredContent({ id: "qa", contentLayout: [{ field: "body", rect: [0, 0, 1.1, 1] }] }, { body: "Copy" }, markdownit)).toThrow(/fractions/);
  expect(content.pageBindings({ layoutPlan: { blocks: { qa: { fields: { question: "Shared?", answer: "Default" } } }, pages: [{ id: "p", pageNumber: 2, blocks: { qa: { fields: { answer: "Local" } } } }] } }, "p", 2).blocks.qa.fields).toEqual({ question: "Shared?", answer: "Local" });
  expect(content.pageBindings({ layoutPlan: { pages: [{ id: "page-1", pageNumber: 1, media: { ad: { path: "first.png" } } }, { id: "page-2", pageNumber: 2, media: { ad: { path: "second.png" } } }] } }, "page-1", 2).media.ad.path).toBe("second.png");
});

test("captured source typography uses its scoped portable substitute and restores uploaded original faces", async () => {
  const template = { id: "source-font", name: "Captured source typography", kind: "custom", design: "ote-2024", storyCount: 0, slots: [
    { id: "source-text", role: "text", rect: [40, 100, 400, 200], text: "Source copy", style: { fontFamily: "Kefa", fontStyle: "Regular", size: 12, leading: 14, portable: { fontFamily: "Source Serif 4", fontStyle: "Regular" } } },
  ] };
  const lib = { ...library, templates: [template] };
  expect(pages.designFontGaps(lib, fonts)).toContain("Kefa");
  const family = async (fontProfile: string, substituteFonts: string[] = []) => {
    const built = await pages.buildPage({ library: lib, template, fontProfile, substituteFonts, markdownit, loadMedia });
    return built.steps.find((s: any) => s.command === "style.paragraph.create" && s.params.name === "OTE Slot source-text").params.chars.fontFamily;
  };
  expect(await family("portable")).toBe("Source Serif 4");
  expect(await family("original2025", ["Kefa"])).toBe("Source Serif 4");
  expect(await family("original2025")).toBe("Kefa");
});

test("scoped portable horizontal fitting survives native and IDML export while original character scaling is retained", async () => {
  const template = { id: "source-scale", name: "Source-width fitting", kind: "custom", storyCount: 0, slots: [
    { id: "source-title", role: "text", rect: [40, 100, 700, 180], text: "Source headline stays complete", style: { fontFamily: "Source Serif 4", fontStyle: "Regular", size: 18, leading: 22, chars: { hScale: 1.1 }, portable: { fontFamily: "Source Serif 4", fontStyle: "Regular", chars: { hScale: 0.75 } } } },
  ] };
  const lib = { ...library, templates: [template] };
  for (const [fontProfile, scale, idmlScale, substituteFonts] of [["portable", 0.75, 75, []], ["original2025", 1.1, 110, []], ["original2025", 0.75, 75, ["Source Serif 4"]]] as const) {
    const built = await pages.buildPage({ library: lib, template, fontProfile, substituteFonts, markdownit, loadMedia });
    const { artifacts } = await pages.compilePage(built, { executor, fonts, JSZip });
    expect(artifacts.preflight.errors).toBe(0);
    const document = await documentOf(artifacts.native);
    expect(document.styles.paragraph.find((style: any) => style.name === "OTE Slot source-title").chars.hScale).toBeCloseTo(scale);
    expect(Object.values<any>(document.stories).map((story) => story.text)).toContain("Source headline stays complete");
    const idml = await JSZip.loadAsync(artifacts.idml);
    const styles = await idml.file("Resources/Styles.xml")!.async("string");
    expect(styles).toContain(`HorizontalScale="${idmlScale}"`);
  }
  for (const invalid of [0.1, 4.1, Number.NaN, Number.POSITIVE_INFINITY]) {
    const bad = structuredClone(template); bad.slots[0].style.portable.chars.hScale = invalid;
    await expect(pages.buildPage({ library: lib, template: bad, markdownit, loadMedia })).rejects.toThrow(/Portable horizontal scale/);
  }
}, 60000);

const python = (() => { try { execFileSync("python3", ["-c", "import markdown_it"], { stdio: "ignore" }); return true; } catch { return false; } })();
test.skipIf(!python)("standalone Python and JavaScript preserve the same structured Markdown and Unicode", () => {
  const cases = [
    [{ id: "qa", blockType: "president-qa", bodyFormat: "markdown" }, { heading: "President’s answers", question: "Pineapple?", answer: "**Yes**, please.\n\nMore details." }],
    [{ id: "board", text: "Meet the board" }, { body: "Name · Role\nIntroduction" }],
  ];
  const expected = JSON.parse(execFileSync("python3", ["-c", "import json,sys;sys.path.insert(0,'tools/designcraft');from structured_content import structured_content;print(json.dumps([structured_content(*c) for c in json.load(sys.stdin)],ensure_ascii=False))"], { input: JSON.stringify(cases), encoding: "utf8" }));
  expect(cases.map(([slot, fields]) => content.structuredContent(slot, fields, markdownit))).toEqual(expected);
});
