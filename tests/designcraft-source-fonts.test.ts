// @vitest-environment node
import { afterAll, expect, test } from 'vitest';
import JSZip from 'jszip';
import { execFileSync } from 'node:child_process';
import { copyFile, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runInNewContext } from 'node:vm';
import { createNativeService } from '../server/designcraft-native';

const root = process.cwd(), staticDir = join(root, 'public/designcraft');
const directories: string[] = [];
afterAll(async () => { for (const directory of directories) await rm(directory, { recursive: true, force: true }); });

async function fixture() {
  const directory = await mkdtemp(join(tmpdir(), 'ote-scoped-fonts-')); directories.push(directory);
  const privateFonts = join(directory, 'private-fonts'); await mkdir(privateFonts);
  // A real, readable font directory, deliberately without Kefa or Wordy Diva.
  await copyFile(join(staticDir, 'assets/fonts/SourceSans3-Bold.ttf'), join(privateFonts, 'SourceSans3-Bold.ttf'));
  const library = JSON.parse(await readFile(join(staticDir, 'templates.json'), 'utf8'));
  library.templates = library.templates.filter((t: any) => t.id === 'source-2024-cfur-briefs');
  const source = JSON.parse(await readFile(join(root, 'tests/fixtures/designcraft-march-2025/issue.json'), 'utf8'));
  const articles = source.articles.slice(0, 4).map((a: any) => ({ ...a, photos: [] }));
  const issue = { ...source, articles, layoutPlan: { pages: [{ id: 'cfur', pageNumber: 1, templateId: 'source-2024-cfur-briefs', articleIds: articles.map((a: any) => a.id) }] } };
  return { directory, privateFonts, library, issue };
}

function checkManifest(manifest: any) {
  expect(manifest.status).toBe('exported');
  expect(manifest.substitutedFonts).toEqual(expect.arrayContaining(['Kefa', 'Wordy Diva']));
  expect(Object.keys(manifest.documentFontSha256)).toEqual(expect.arrayContaining(['SourceSerif4-Regular.ttf', 'CaveatBrush-Regular.ttf', 'SourceSans3-Bold.ttf']));
}

async function checkNative(bytes: Uint8Array) {
  const document = JSON.parse(await (await JSZip.loadAsync(bytes)).file('document.json')!.async('string'));
  const bodies = document.spreads.flatMap((s: any) => s.items).filter((item: any) => item.label && JSON.parse(item.label).role === 'body');
  const bodyStyles = bodies.map((item: any) => document.styles.paragraph.find((style: any) => style.name === document.stories[item.content.story].paras[0].style));
  expect(bodyStyles).toHaveLength(4);
  expect(bodyStyles.every((s: any) => s.chars.fontFamily === 'Source Serif 4')).toBe(true);
}

test('the browser worker loads all portable fallbacks while keeping uploaded filenames first', async () => {
  const script = await readFile(join(staticDir, 'compiler/worker.js'), 'utf8');
  const fonts = await runInNewContext(script + `\nportableFonts = [
    { name: 'SourceSerif4-Regular.ttf', bytes: new Uint8Array([1]) },
    { name: 'SourceSans3-Regular.ttf', bytes: new Uint8Array([2]) },
    { name: 'JetBrainsMono-Regular.ttf', bytes: new Uint8Array([3]) }
  ]; designFonts = [{ name: 'CaveatBrush-Regular.ttf', bytes: new Uint8Array([4]) }];
  modules = { pages: { usesDesigns: () => true } };
  fontsFor({ fontProfile: 'original2025', fonts: [{ name: 'SourceSerif4-Regular.ttf', bytes: new Uint8Array([42]) }] }, {});`, { importScripts() {}, self: {} });
  expect(fonts.map((font: any) => font.name)).toEqual(['SourceSerif4-Regular.ttf', 'SourceSans3-Regular.ttf', 'JetBrainsMono-Regular.ttf', 'CaveatBrush-Regular.ttf']);
  expect(fonts[0].bytes[0]).toBe(42);
});

test('server original-font export loads scoped open substitutes when the private folder lacks Kefa', async () => {
  const { directory, privateFonts, library, issue } = await fixture();
  const service = createNativeService({ engine: 'wasm', repository: root, root: join(directory, 'jobs'), originalFontDir: privateFonts });
  const recipe = new JSZip(); recipe.file('templates.json', JSON.stringify(library)); recipe.file('issue.json', JSON.stringify(issue));
  recipe.file('page-plan.json', JSON.stringify({ templateId: 'source-2024-cfur-briefs', articleIds: issue.articles.map((a: any) => a.id), controls: { 'page-number': 13 } }));
  try {
    const job = await service.submit({ recipe: await recipe.generateAsync({ type: 'nodebuffer' }), mode: 'page', fontProfile: 'original2025' });
    let result: any = job;
    for (const deadline = Date.now() + 90000; !['completed', 'failed'].includes(result.status) && Date.now() < deadline;) { await new Promise((done) => setTimeout(done, 50)); result = await service.get(job.id); }
    expect(result.status, result.message).toBe('completed');
    const manifest = JSON.parse((await service.artifact(job.id, 'manifest')).buffer.toString());
    checkManifest(manifest);
    await checkNative((await service.artifact(job.id, 'native')).buffer);
    expect((await service.artifact(job.id, 'pdf')).buffer.subarray(0, 5).toString()).toBe('%PDF-');
  } finally { await service.dispose(); }
}, 120000);

test('standalone original-font export retains the same scoped fallback fonts and reports substitutions', async () => {
  const { directory, privateFonts, library, issue } = await fixture();
  await writeFile(join(directory, 'templates.json'), JSON.stringify(library));
  await writeFile(join(directory, 'issue.json'), JSON.stringify(issue));
  const output = join(directory, 'out');
  const stdout = execFileSync(process.execPath, ['tools/designcraft/compile.mjs', '--library', join(directory, 'templates.json'), '--issue', join(directory, 'issue.json'), '--output', output, '--template', 'source-2024-cfur-briefs', '--articles', issue.articles.map((a: any) => a.id).join(','), '--font-dir', privateFonts, '--font-profile', 'original2025'], { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: 90000 });
  expect(JSON.parse(stdout).substitutedFonts).toEqual(expect.arrayContaining(['Kefa', 'Wordy Diva']));
  checkManifest(JSON.parse(await readFile(join(output, 'build-manifest.json'), 'utf8')));
  await checkNative(new Uint8Array(await readFile(join(output, 'page.designcraft'))));
  expect((await readFile(join(output, 'Document Fonts/SourceSerif4-Regular.ttf'))).byteLength).toBeGreaterThan(1000);
}, 120000);
