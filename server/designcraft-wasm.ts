import JSZip from "jszip";
import markdownit from "markdown-it";
import { access, mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

/**
 * Server-side native output without the DesignCraft CLI or Python: the same
 * browser compiler modules and headless WebAssembly engine, run in Node. Output
 * files use the Python compilers' layout, so job collection is unchanged.
 */
type Json = Record<string, any>;
type Compiler = {
  pages: any; issues: any; executors: any;
  Engine: any; version: string;
};
let loaded: Promise<Compiler> | undefined;

/** The static DesignCraft directory: source checkout first, then the built server bundle. */
export async function designcraftStaticDir(repository: string) {
  for (const candidate of [process.env.DESIGNCRAFT_STATIC_DIR, join(repository, "public/designcraft"), join(repository, ".output/public/designcraft")]) {
    if (!candidate) continue;
    try { await access(join(candidate, "headless/manifest.json")); await access(join(candidate, "compiler/issue-compiler.js")); return resolve(candidate); }
    catch { /* try the next location */ }
  }
  return undefined;
}

async function load(staticDir: string): Promise<Compiler> {
  const module = (name: string) => import(/* @vite-ignore */ pathToFileURL(join(staticDir, "compiler", name)).href);
  const [pages, issues, executors] = await Promise.all([module("page-compiler.js"), module("issue-compiler.js"), module("executors.js")]);
  const base = pathToFileURL(join(staticDir, "headless") + "/").href;
  const { Engine, manifest } = await executors.loadHeadlessEngine(base, async (name: string) => new Uint8Array(await readFile(new URL(name, base))));
  return { pages, issues, executors, Engine, version: `designcraft-headless ${manifest.upstream.tag.replace(/^v/, "")} (WebAssembly)` };
}

export async function wasmCompiler(staticDir: string) {
  loaded ??= load(staticDir).catch((error) => { loaded = undefined; throw error; });
  return loaded;
}

const json = (value: unknown) => JSON.stringify(value, null, 2) + "\n";

export type WasmJob = {
  staticDir: string; recipeDir: string; outputDir: string; mode: "page" | "issue";
  fontDir: string; fontProfile: "portable" | "original2025"; booklet: boolean;
  selected: { templateId?: string; pageNumber: number; articleIds: string[] };
  signal: AbortSignal;
};

/** Run one job; returns a process-like result for the service log. */
export async function runWasmJob(job: WasmJob): Promise<{ exitCode: number; stdout: string; stderr: string }> {
  const compiler = await wasmCompiler(job.staticDir);
  const base = compiler.executors.wasmExecutor(compiler.Engine);
  // Synchronous engine calls cannot be interrupted; stop between them instead.
  const executor = { ...base, run: (steps: unknown, session: unknown) => { if (job.signal.aborted) throw new Error("Native export was stopped."); return base.run(steps, session); } };
  const library = JSON.parse(await readFile(join(job.recipeDir, "templates.json"), "utf8"));
  const issue = JSON.parse(await readFile(join(job.recipeDir, "issue.json"), "utf8"));
  const fonts = await Promise.all((await readdir(job.fontDir)).filter((name) => /\.(ttf|otf|ttc|otc|txt)$/i.test(name))
    .map(async (name) => ({ name, bytes: new Uint8Array(await readFile(join(job.fontDir, name))) })));
  // Recipe resources were validated and staged by prepareRecipe; nothing else is readable.
  const loadMedia = async ({ path }: { root: string; path: string }) => {
    const file = resolve(job.recipeDir, path);
    if (!file.startsWith(resolve(job.recipeDir) + "/")) return null;
    try { return new Uint8Array(await readFile(file)); } catch { return null; }
  };
  const out = job.outputDir;
  const write = async (name: string, data: Uint8Array | string) => { await mkdir(dirname(join(out, name)), { recursive: true }); await writeFile(join(out, name), data); };
  const writeFonts = async (directory: string) => { for (const font of compiler.pages.documentFonts(fonts, job.fontProfile)) await write(join(directory, "Document Fonts", font.name), font.bytes); };
  const common = { markdownit, JSZip, loadMedia, executor, fontProfile: job.fontProfile };
  const pageFiles = async (directory: string, artifacts: Json) => {
    if (artifacts.native) await write(join(directory, "page.designcraft"), artifacts.native);
    for (const [name, key] of [["preflight.json", "preflight"], ["build-manifest.json", "manifest"], ["source-record.json", "sourceRecord"], ["composed-record.json", "composedRecord"], ["interchange-metadata.json", "interchange"], ["document-inspect.json", "inspect"], ["focal-crop.json", "focalCrop"]] as const)
      if (artifacts[key]) await write(join(directory, name), json(artifacts[key]));
    if (artifacts.pdf) await write(join(directory, "page.pdf"), artifacts.pdf);
    if (artifacts.idml) await write(join(directory, "page.idml"), artifacts.idml);
  };
  try {
    if (job.mode === "page") {
      await writeFonts("");
      const built = await compiler.pages.buildPage({ ...common, library, templateId: job.selected.templateId, issue,
        articleIds: job.selected.articleIds.length ? job.selected.articleIds : null, pageNumber: job.selected.pageNumber, pageId: "page-1" });
      const { manifest, artifacts } = await compiler.pages.compilePage(built, { executor, fonts, JSZip });
      await pageFiles("", artifacts);
      return { exitCode: 0, stdout: JSON.stringify(manifest), stderr: "" };
    }
    await writeFonts("");
    const { manifest, artifacts } = await compiler.issues.compileIssue({ ...common, library, issue, booklet: job.booklet, fonts });
    for (const page of artifacts.pages) await pageFiles(join("pages", String(page.pageNumber).padStart(3, "0")), page.artifacts);
    await write("issue.designcraft", artifacts.native); await write("issue.pdf", artifacts.pdf); await write("issue.idml", artifacts.idml);
    await write("build-manifest.json", json(manifest)); await write("preflight.json", json(artifacts.preflight));
    await write("source-issue.json", json(artifacts.sourceIssue)); await write("interchange-metadata.json", json(artifacts.interchange));
    return { exitCode: 0, stdout: JSON.stringify(manifest), stderr: "" };
  } catch (error: any) {
    const artifacts: Json = error?.artifacts ?? {};
    if (job.mode === "page") await pageFiles("", artifacts);
    else {
      for (const page of artifacts.pages ?? []) await pageFiles(join("pages", String(page.pageNumber).padStart(3, "0")), page.artifacts);
      const failed = artifacts.manifest?.failedPageNumber;
      if (Number.isInteger(failed) && artifacts.native) await write(join("pages", String(failed).padStart(3, "0"), "page.designcraft"), artifacts.native);
      else if (artifacts.native) await write("issue.designcraft", artifacts.native);
      if (artifacts.manifest) await write("build-manifest.json", json(artifacts.manifest));
      if (artifacts.preflight) await write("preflight.json", json(artifacts.preflight));
      if (artifacts.sourceIssue) await write("source-issue.json", json(artifacts.sourceIssue));
      if (artifacts.interchange) await write("interchange-metadata.json", json(artifacts.interchange));
    }
    const label = job.mode === "issue" ? "compile-issue" : "compile-template";
    return { exitCode: 1, stdout: "", stderr: `${label}: ${error instanceof Error ? error.message : String(error)}` };
  }
}
