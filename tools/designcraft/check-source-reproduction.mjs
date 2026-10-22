#!/usr/bin/env node
// Compose source presets with the real engine; retain full exports/drafts and
// machine-readable copy/geometry checks. Requires only committed fixture assets.
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import JSZip from 'jszip';
import markdownit from 'markdown-it';
import { buildPage, compilePage } from '../../public/designcraft/compiler/page-compiler.js';
import { loadHeadlessEngine, wasmExecutor } from '../../public/designcraft/compiler/executors.js';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const staticDir = join(root, 'public/designcraft');
const fixtureDir = join(root, 'tests/fixtures/designcraft-march-2025');
const output = resolve(process.env.SOURCE_PROOF_OUTPUT ?? join(root, 'artifacts/source-reconstruction'));
const library = JSON.parse(await readFile(join(staticDir, 'templates.json'), 'utf8'));
const fixture = JSON.parse(await readFile(join(fixtureDir, 'issue.json'), 'utf8'));
const base = pathToFileURL(join(staticDir, 'headless') + '/').href;
const { Engine } = await loadHeadlessEngine(base, async (name) => new Uint8Array(await readFile(new URL(name, base))));
const executor = wasmExecutor(Engine);
const fonts = await Promise.all((await readdir(join(staticDir, 'assets/fonts'))).map(async (name) => ({ name, bytes: new Uint8Array(await readFile(join(staticDir, 'assets/fonts', name))) })));
const loadMedia = async ({ root: scope, path }) => {
  try { return new Uint8Array(await readFile(join(scope === 'issue' ? fixtureDir : staticDir, path))); }
  catch { return null; }
};
const chosen = new Set(process.argv.slice(2));
const report = {
  schemaVersion: 'ote.source-reconstruction-check.v1',
  engine: executor.version,
  fontProfile: 'portable',
  fixture: 'tests/fixtures/designcraft-march-2025/issue.json',
  comparisonLimit: 'Source presets retain original fixed artwork; portable fonts and new fixture copy differ from the supplied PDF. Export success is not a claim of pixel identity or Adobe InDesign verification.',
  entries: [],
};
await mkdir(output, { recursive: true });
for (const template of library.templates.filter((t) => t.id.startsWith('source-') && (!chosen.size || chosen.has(t.id)))) {
  const directory = join(output, template.id);
  await mkdir(directory, { recursive: true });
  const articleIds = fixture.articles.slice(0, template.storyCount).map((a) => a.id);
  const entry = { templateId: template.id, source: template.source, fixtureArticleIds: articleIds, status: 'failed' };
  let artifacts, manifest, built;
  try {
    built = await buildPage({ library, template, issue: fixture, articleIds, pageId: template.id, pageNumber: template.source?.page ?? 1, markdownit, loadMedia });
    const compiled = await compilePage(built, { executor, fonts, JSZip });
    artifacts = compiled.artifacts; manifest = compiled.manifest;
    entry.status = 'exported';
    await writeFile(join(directory, 'page.pdf'), artifacts.pdf);
    await writeFile(join(directory, 'page.idml'), artifacts.idml);
  } catch (error) {
    artifacts = error.artifacts; manifest = artifacts?.manifest;
    entry.error = error.message;
  }
  if (artifacts?.native) {
    await writeFile(join(directory, entry.status === 'exported' ? 'page.designcraft' : 'page-draft.designcraft'), artifacts.native);
    const document = JSON.parse(await (await JSZip.loadAsync(artifacts.native)).file('document.json').async('string'));
    const stories = Object.values(document.stories).map((s) => s.text);
    entry.articleCopyChecks = Object.fromEntries((built?.articles ?? []).map((a) => [a.id, stories.includes(built.composed[a.id].text)]));
    entry.structuredCopyChecks = (built?.structuredBlocks ?? []).flatMap((b) => b.fields.map((f) => ({ slotId: b.slotId, field: f.field, preserved: stories.some((t) => t.includes(f.text)) })));
    entry.wraps = document.spreads.flatMap((s) => s.items).filter((i) => i.wrap?.mode && i.wrap.mode !== 'none').map((i) => ({ name: i.name, mode: i.wrap.mode, offset: i.wrap.offsets }));
    await writeFile(join(directory, 'page.png'), await executor.renderPng(artifacts.native, { page: 0, scale: 1 }));
  }
  entry.preflight = artifacts?.preflight ?? manifest?.preflight;
  if (manifest) await writeFile(join(directory, 'build-manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
  report.entries.push(entry);
  console.log(JSON.stringify({ templateId: entry.templateId, status: entry.status, errors: entry.preflight?.errors, fullCopy: Object.values(entry.articleCopyChecks ?? {}).every(Boolean), error: entry.error }));
}
report.exported = report.entries.filter((e) => e.status === 'exported').length;
report.failed = report.entries.length - report.exported;
await writeFile(join(output, 'report.json'), JSON.stringify(report, null, 2) + '\n');
if (report.failed) process.exitCode = 1;
