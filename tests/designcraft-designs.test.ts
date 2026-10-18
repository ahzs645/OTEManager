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

// The original OTE house designs (library.designs), recreated from the source InDesign files.
const root = process.cwd(), compilerDir = join(root, "public/designcraft/compiler");
const load = (name: string) => import(/* @vite-ignore */ pathToFileURL(join(compilerDir, name)).href);
const fixtureDir = join(root, "tests/fixtures/designcraft-march-2025");
let pages: any, issues: any, variants: any, fields: any, fit: any, executor: any, library: any, fixture: any, fonts: { name: string; bytes: Uint8Array }[];
const temporary: string[] = [];
const CFUR = "march-cfur-carbon-capture";

const loadMedia = async ({ root: base, path }: { root: string; path: string }) => {
  const directory = base === "issue" ? fixtureDir : join(root, "public/designcraft");
  try { return new Uint8Array(await readFile(resolve(directory, path))); } catch { return null; }
};

beforeAll(async () => {
  let executors: any;
  [pages, issues, variants, fields, fit, executors] = await Promise.all(["page-compiler.js", "issue-compiler.js", "variants.js", "cover-fields.js", "fit.js", "executors.js"].map(load));
  const base = pathToFileURL(join(root, "public/designcraft/headless") + "/").href;
  const { Engine } = await executors.loadHeadlessEngine(base, async (name: string) => new Uint8Array(await readFile(new URL(name, base))));
  executor = executors.wasmExecutor(Engine);
  library = JSON.parse(await readFile(join(root, "public/designcraft/templates.json"), "utf8"));
  fixture = JSON.parse(await readFile(join(fixtureDir, "issue.json"), "utf8"));
  const fontDir = join(root, "public/designcraft/assets/fonts");
  fonts = await Promise.all((await readdir(fontDir)).map(async (name) => ({ name, bytes: new Uint8Array(await readFile(join(fontDir, name))) })));
}, 60000);
afterAll(async () => { for (const directory of temporary) await rm(directory, { recursive: true, force: true }); });

test("both original designs ship complete: art layers, house styles and a template per classic story recipe", async () => {
  expect(Object.keys(library.designs).sort()).toEqual(["ote-2024", "ote-2025"]);
  for (const [id, design] of Object.entries<any>(library.designs)) {
    const templates = library.templates.filter((t: any) => t.design === id);
    expect(templates.filter((t: any) => t.kind === "story")).toHaveLength(76);
    expect(templates.filter((t: any) => t.kind === "cover")).toHaveLength(1);
    expect(design.styles["OTE Headline"].fontFamily).toBe("Decalotype");
    for (const layer of Object.values<any>(design.art)) for (const part of [layer, layer.over].filter(Boolean))
      for (const path of [part.original, part.portable]) expect((await JSZip.loadAsync(await readFile(join(root, "public/designcraft", path)))).file("document.json")).not.toBeNull();
  }
  expect(library.designs["ote-2024"].numbering).toBe("arabic");
  expect(library.designs["ote-2025"].numbering).toBe("arabicLeadingZero");
});

test("cover and dateline fields format like the originals", () => {
  const values = { date: "2025-03-13", volume: 31, number: 7 };
  expect(fields.fieldText("{WEEKDAY}, {MONTH} {D}, {YYYY}", values)).toBe("THURSDAY, MARCH 13, 2025");
  expect(fields.fieldText("{Month} {Dth}", { date: "2025-10-02" })).toBe("October 2nd");
  expect(fields.fieldText("{Month} {Dth}", { date: "2025-10-13" })).toBe("October 13th");
  expect(fields.fieldText("volume ({volume})", values)).toBe("volume (31)");
  expect(fields.fieldText("issue {number}", {})).toBeNull();
  expect([fields.pageLabel(3, "arabic"), fields.pageLabel(3, "arabicLeadingZero"), fields.pageLabel(12)]).toEqual(["3", "03", "12"]);
});

test("open font substitutes cover every licensed face the designs use", () => {
  const families = (name: string) => [...pages.fontFamilies(fonts.find((f) => f.name === name)!.bytes)];
  expect(families("Barlow-Black.ttf")).toContain("Barlow");
  expect(families("CaveatBrush-Regular.ttf")).toContain("Caveat Brush");
  expect(families("texgyreheros-bold.otf")).toContain("TeX Gyre Heros");
  const gaps = pages.designFontGaps(library, fonts);
  expect(gaps).toEqual(expect.arrayContaining(["Decalotype", "Helvetica Neue", "Salted"]));
  for (const design of Object.values<any>(library.designs)) for (const style of Object.values<any>(design.styles))
    expect(design.fonts.portable[`${style.fontFamily}|${style.fontStyle}`], style.fontFamily + " " + style.fontStyle).toBeDefined();
  // Classic builds keep their Document Fonts exactly as before; design builds add the substitutes.
  expect(pages.documentFonts(fonts, "portable").some((f: any) => pages.isDesignFont(f.name))).toBe(false);
  expect(pages.documentFonts(fonts, "portable", true).map((f: any) => f.name)).toEqual(expect.arrayContaining(["Barlow-Black.ttf", "GUST-FONT-LICENSE-TeXGyreHeros.txt"]));
});

test("a design page places the original art, house styles and dateline, and passes native preflight", async () => {
  const built = await pages.buildPage({ library, templateId: "ote-2025-story-2-none-stacked", issue: fixture, articleIds: [CFUR, "march-rcmp-job-scams"], pageNumber: 2, pageId: "p2", fontProfile: "portable", markdownit, loadMedia });
  expect(built.steps.filter((s: any) => s.command === "snippet.place")).toHaveLength(1);
  expect(built.steps.some((s: any) => s.command === "swatch.create" && s.params.name === "OTE 2025 Green")).toBe(true);
  const dateline = built.template.slots.find((s: any) => s.field === "issueDate" && s.side === "left");
  expect(dateline.text).toBe("MARCH 13, 2025");
  const { manifest, artifacts } = await pages.compilePage(built, { executor, fonts, JSZip });
  expect(manifest.status).toBe("exported");
  expect(artifacts.preflight.errors).toBe(0);
  const document = JSON.parse(await (await JSZip.loadAsync(artifacts.native)).file("document.json")!.async("string"));
  const texts = Object.values<any>(document.stories).map((s) => s.text);
  expect(texts).toContain("MARCH 13, 2025");
  // Page 2 is a left page: every text of the left design layer is on it.
  const art = JSON.parse(await (await JSZip.loadAsync(await readFile(join(root, "public/designcraft", library.designs["ote-2025"].art.left.portable)))).file("document.json")!.async("string"));
  const artTexts = Object.values<any>(art.stories).map((s) => s.text).filter(Boolean);
  expect(artTexts.length).toBeGreaterThan(0);
  for (const text of artTexts) expect(texts).toContain(text);
  // Portable builds use only open faces.
  const families = new Set(Object.values<any>(document.stories).flatMap((s) => (s.runs ?? []).map((r: any) => r.fontFamily)).filter(Boolean));
  for (const family of families) expect(["Barlow", "TeX Gyre Heros", "TeX Gyre Heros Cn", "Caveat Brush", "Source Serif 4", "Source Sans 3"]).toContain(family);
}, 60000);

test("long headlines in a design measure with its own face and grow the band", async () => {
  const template = library.templates.find((t: any) => t.id === "ote-2024-story-2-two-top-columns");
  const order = [CFUR, "march-cn-centre-30"].map((id) => fixture.articles.find((a: any) => a.id === id));
  const measured = await fit.measureHeadlines(template, order, { executor, library, fonts, fontProfile: "portable" });
  expect(measured.map((m: any) => m.slotId)).toEqual(["headline-1", "headline-6"]);
  expect(measured.every((m: any) => m.fits && m.lines >= 2)).toBe(true);
  // The design's Barlow Black 24/25 needs more room than the classic Source Sans 3 Bold measured here before.
  const classic = await fit.measureHeadlines({ ...template, design: undefined }, order, { executor, library, fonts, fontProfile: "portable" });
  expect(measured[0].height).toBeGreaterThanOrEqual(classic[0].height - 3);
  const grown = fit.growHeadlineBands(template, measured);
  const body = (t: any, id: string) => t.slots.find((s: any) => s.id === id).rect;
  expect(grown.template.id).toMatch(/^ote-2024-story-2-two-top-columns@fit-/);
  const bodies = template.slots.filter((s: any) => s.role === "body").map((s: any) => s.id);
  for (const id of bodies) { expect(body(grown.template, id)[1]).toBeGreaterThan(body(template, id)[1]); expect(body(grown.template, id)[3]).toBe(body(template, id)[3]); }
  expect(grown.template.slots.filter((s: any) => s.role === "text")).toEqual(template.slots.filter((s: any) => s.role === "text"));
}, 120000);

test("a one-line headline tightens its band: the byline moves up and the photo grows into the space", async () => {
  const template = library.templates.find((t: any) => t.id === "ote-2024-story-1-hero-airy");
  const article = fixture.articles.filter((a: any) => a.id === "march-cn-centre-30");
  const [measured] = await fit.measureHeadlines(template, article, { executor, library, fonts, fontProfile: "portable", tight: true });
  expect(measured).toMatchObject({ slotId: "headline-1", lines: 1, fits: true });
  const rect = (t: any, role: string) => t.slots.find((s: any) => s.role === role).rect;
  expect(fit.fitHeadlineBands(template, [measured])).toBeNull();                   // grow-only: nothing to do
  const fitted = fit.fitHeadlineBands(template, [measured], { tighten: true });
  const rise = rect(template, "headline")[3] - rect(fitted.template, "headline")[3];
  expect(rise).toBeGreaterThan(15);
  expect(rect(fitted.template, "byline")[1]).toBeCloseTo(rect(template, "byline")[1] - rise, 2);
  expect(rect(fitted.template, "photo")[1]).toBeCloseTo(rect(template, "photo")[1] - rise, 2);  // grows upward
  expect(rect(fitted.template, "photo")[3]).toBe(rect(template, "photo")[3]);
  expect(rect(fitted.template, "body")).toEqual(rect(template, "body"));
  expect(fitted.changes[0].grownBy).toBeCloseTo(-rise, 2);
  const result = await variants.generatePageVariants({ library: { ...library, templates: [template] }, issue: fixture, articleIds: ["march-cn-centre-30"], executor, fonts, loadMedia, markdownit, JSZip, design: "ote-2024", previewScale: 0, tightenHeadlines: true });
  expect(result.variants[0].template.id).toBe("ote-2024-story-1-hero-airy@fit-headline-1-1");
  expect(result.variants[0].preflight.errors).toBe(0);
}, 120000);

test("a whole real issue in the 2025–26 design: planned, numbered covers, live references, fitted cover line", async () => {
  const plan = await variants.suggestIssuePlan({ library, issue: fixture, articleIds: fixture.articles.map((a: any) => a.id), executor, fonts, loadMedia, markdownit, JSZip, design: "ote-2025", previewScale: 0 });
  expect(plan.pages[0].templateId).toBe("ote-2025-cover");
  expect(plan.pages.every((p: any) => p.templateId.startsWith("ote-2025-"))).toBe(true);
  const issue = { ...fixture, layoutPlan: { ...fixture.layoutPlan, pages: plan.pages.map(({ template, ...p }: any) => p), cover: { ...fixture.layoutPlan.cover, articleIds: plan.featured } } };
  const { manifest } = await issues.compileIssue({ library: { ...library, templates: [...library.templates, ...plan.extraTemplates] }, issue, executor, fonts, loadMedia, markdownit, JSZip, fontProfile: "portable", fitCoverTitles: true });
  expect(manifest.status).toBe("exported");
  expect(manifest.preflight.errors).toBe(0);
  const references = manifest.nativeCoverReferences.verification.features.map((f: any) => f.generated);
  expect(manifest.nativeCoverReferences.verification.features.map((f: any) => f.text)).toEqual(references);  // number-only cards
  expect(references.length).toBe(plan.featured.length);
  for (const text of references) expect(text).toMatch(/^\d{2}$/);
}, 180000);

test("a photo's focal point and zoom follow it into every layout; a frame's own focus still wins", async () => {
  const issue = structuredClone(fixture);
  issue.articles.find((a: any) => a.id === CFUR).photos[0] = { ...issue.articles.find((a: any) => a.id === CFUR).photos[0], focus: { x: 0.2, y: 0.8 }, zoom: 1.5 };
  for (const templateId of ["story-1-top-balanced", "ote-2025-story-1-hero-airy"]) {
    const built = await pages.buildPage({ library, templateId, issue, articleIds: [CFUR], pageNumber: 3, pageId: "p3", fontProfile: "portable", markdownit, loadMedia });
    expect(built.focusRequests[0]).toMatchObject({ requestedFocus: { x: 0.2, y: 0.8 }, requestedZoom: 1.5 });
  }
  const template = structuredClone(library.templates.find((t: any) => t.id === "story-1-top-balanced"));
  template.slots.find((s: any) => s.role === "photo").focus = { x: 0.9, y: 0.1 };
  const built = await pages.buildPage({ library, template, issue, articleIds: [CFUR], pageNumber: 3, pageId: "p3", fontProfile: "portable", markdownit, loadMedia });
  expect(built.focusRequests[0].requestedFocus).toEqual({ x: 0.9, y: 0.1 });
  const { artifacts } = await pages.compilePage(built, { executor, fonts, JSZip });
  expect(artifacts.focalCrop.crops[0]).toMatchObject({ exactFocusApplied: true, requestedZoom: 1.5 });
}, 60000);

test("server: design jobs stage bundled art, reject foreign art and package the open substitutes", async () => {
  const directory = await mkdtemp(join(tmpdir(), "ote-design-service-")); temporary.push(directory);
  const service = createNativeService({ engine: "wasm", repository: root, root: directory, python: "/nonexistent", cli: "/nonexistent" });
  const recipe = async (lib: any, issue: any) => {
    const zip = new JSZip(); zip.file("issue.json", JSON.stringify(issue)); zip.file("templates.json", JSON.stringify(lib));
    for (const article of issue.articles) for (const photo of article.photos) zip.file(photo.path, await readFile(join(fixtureDir, photo.path)));
    return zip.generateAsync({ type: "nodebuffer" });
  };
  try {
    const templateId = "ote-2024-story-2-none-stacked";
    const issue = { ...fixture, layoutPlan: { pages: [{ id: "p2", pageNumber: 2, templateId, articleIds: [CFUR, "march-rcmp-job-scams"] }] } };
    const page = new JSZip(); page.file("issue.json", JSON.stringify(issue)); page.file("templates.json", JSON.stringify(library));
    page.file("page-plan.json", JSON.stringify({ templateId, articleIds: [CFUR, "march-rcmp-job-scams"], controls: { "page-number": 2 } }));
    for (const article of issue.articles) for (const photo of article.photos) page.file(photo.path, await readFile(join(fixtureDir, photo.path)));
    const job = await service.submit({ recipe: await page.generateAsync({ type: "nodebuffer" }), mode: "page" });
    let result: any = job;
    for (const deadline = Date.now() + 120000; !["completed", "failed"].includes(result.status) && Date.now() < deadline;) { await new Promise((done) => setTimeout(done, 50)); result = await service.get(job.id); }
    expect(result.status, result.message).toBe("completed");
    const bundle = await JSZip.loadAsync((await service.artifact(job.id, "bundle")).buffer);
    expect(bundle.file("recipe/original-art/ote-2024-left-portable.designcraft")).not.toBeNull();
    expect(Object.keys(bundle.files)).toEqual(expect.arrayContaining(["Document Fonts/Barlow-Black.ttf", "Document Fonts/OFL-Barlow.txt"]));
    const foreign = structuredClone(library); foreign.designs["ote-2024"].art.left.portable = "../../secrets.designcraft";
    await expect(service.submit({ recipe: await recipe(foreign, issue), mode: "issue" })).rejects.toThrow(/bundled original-art/);
    const stray = structuredClone(library); stray.templates.find((t: any) => t.id === "story-1-top-balanced").slots.push({ id: "x", role: "text", rect: [40, 40, 100, 60], text: "x" });
    await expect(service.submit({ recipe: await recipe(stray, issue), mode: "issue" })).rejects.toThrow(/original design/);
  } finally { await service.dispose(); }
}, 180000);

const python = (() => { try { execFileSync("python3", ["-c", "import markdown_it"], { stdio: "ignore" }); return true; } catch { return false; } })();
test.skipIf(!python)("the Python compiler declines design templates with a pointer to the JavaScript compiler", () => {
  expect(() => execFileSync("python3", ["tools/designcraft/compile-template.py", "--library", "public/designcraft/templates.json", "--template", "ote-2025-cover", "--output", join(tmpdir(), "ote-declined"), "--cli", "/nonexistent"], { stdio: "pipe" }))
    .toThrow(/JavaScript compiler/);
});
