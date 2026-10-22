// @vitest-environment node
import { beforeAll, expect, test } from 'vitest';
import JSZip from 'jszip';
import markdownit from 'markdown-it';
import { mkdtemp, readFile, readdir } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { pathToFileURL } from 'node:url';
import { createNativeService } from '../server/designcraft-native';

const root = process.cwd(), staticDir = join(root, 'public/designcraft');
const fixtureDir = join(root, 'tests/fixtures/designcraft-march-2025');
let pages: any, issues: any, library: any, fixture: any, executor: any, fonts: any[];
const loadMedia = async ({ root: scope, path }: { root: string; path: string }) => {
  try { return new Uint8Array(await readFile(resolve(scope === 'issue' ? fixtureDir : staticDir, path))); }
  catch { return null; }
};
const native = async (bytes: Uint8Array) => JSON.parse(await (await JSZip.loadAsync(bytes)).file('document.json')!.async('string'));

beforeAll(async () => {
  const module = (name: string) => import(/* @vite-ignore */ pathToFileURL(join(staticDir, 'compiler', name)).href);
  let executors: any;
  [pages, issues, executors] = await Promise.all(['page-compiler.js', 'issue-compiler.js', 'executors.js'].map(module));
  const base = pathToFileURL(join(staticDir, 'headless') + '/').href;
  const { Engine } = await executors.loadHeadlessEngine(base, async (name: string) => new Uint8Array(await readFile(new URL(name, base))));
  executor = executors.wasmExecutor(Engine);
  library = JSON.parse(await readFile(join(staticDir, 'templates.json'), 'utf8'));
  fixture = JSON.parse(await readFile(join(fixtureDir, 'issue.json'), 'utf8'));
  fonts = await Promise.all((await readdir(join(staticDir, 'assets/fonts'))).map(async (name) => ({ name, bytes: new Uint8Array(await readFile(join(staticDir, 'assets/fonts', name))) })));
}, 60000);

test('March President source artwork and all four editable content fields export together', async () => {
  const built = await pages.buildPage({ library, templateId: 'source-2024-president-qa', issue: fixture, articleIds: [], pageId: 'president', pageNumber: 6, markdownit, loadMedia });
  const { manifest, artifacts } = await pages.compilePage(built, { executor, fonts, JSZip });
  expect(manifest.status).toBe('exported');
  expect(artifacts.preflight.errors).toBe(0);
  const document = await native(artifacts.native);
  const items = document.spreads.flatMap((s: any) => s.items);
  const fields = items.filter((i: any) => i.name?.startsWith('president-qa-'));
  expect(fields.map((i: any) => i.name).sort()).toEqual(['president-qa-answer', 'president-qa-heading', 'president-qa-question', 'president-qa-subtitle']);
  expect(document.stories[fields.find((i: any) => i.name === 'president-qa-question').content.story].text).toBe('Pineapple on pizza—yes or no?');
  expect(document.stories[fields.find((i: any) => i.name === 'president-qa-answer').content.story].text).toBe('I really like pizza but I would be a no for pineapple on mine');
  for (const field of built.structuredBlocks[0].fields) {
    expect(Object.values<any>(document.stories).some((s) => s.text === field.text)).toBe(true);
  }
  const answer = fields.find((i: any) => i.name === 'president-qa-answer');
  const answerStyle = document.styles.paragraph.find((s: any) => s.name === document.stories[answer.content.story].paras[0].style);
  expect(answerStyle.chars.fill).toBe('[Paper]');
  expect((await JSZip.loadAsync(artifacts.idml)).file('designmap.xml')).not.toBeNull();
  expect(new TextDecoder().decode(artifacts.pdf.slice(0, 5))).toBe('%PDF-');
}, 60000);

test('the four original March CFUR articles retain every body with native contour wrapping', async () => {
  const articles = fixture.articles.slice(0, 4);
  const built = await pages.buildPage({ library, templateId: 'source-2024-cfur-briefs', issue: fixture, articleIds: articles.map((a: any) => a.id), pageNumber: 13, markdownit, loadMedia });
  const { artifacts } = await pages.compilePage(built, { executor, fonts, JSZip });
  expect(artifacts.preflight.errors).toBe(0);
  const document = await native(artifacts.native);
  const items = document.spreads.flatMap((s: any) => s.items);
  const bodies = items.filter((i: any) => i.label && JSON.parse(i.label).role === 'body');
  expect(bodies).toHaveLength(4);
  for (const article of articles) {
    const body = bodies.find((i: any) => JSON.parse(i.label).articleId === article.id);
    expect(document.stories[body.content.story].text).toBe(built.composed[article.id].text);
  }
  expect(items.filter((i: any) => i.wrap?.mode === 'contour').length).toBeGreaterThanOrEqual(3);
  expect((await JSZip.loadAsync(artifacts.idml)).file('designmap.xml')).not.toBeNull();
}, 60000);

test.each(['source-2025-president-qa', 'source-2024-inside-edge-editable'])('%s exports the original fixed feature with all editable source copy', async (templateId) => {
  const built = await pages.buildPage({ library, templateId, issue: fixture, articleIds: [], pageNumber: 4, markdownit, loadMedia });
  const { artifacts } = await pages.compilePage(built, { executor, fonts, JSZip });
  expect(artifacts.preflight.errors).toBe(0);
  expect(built.structuredBlocks.length).toBeGreaterThan(0);
  const document = await native(artifacts.native);
  const stories = Object.values<any>(document.stories).map((s) => s.text);
  for (const block of built.structuredBlocks) for (const field of block.fields) {
    expect(stories.some((s) => s.includes(field.text))).toBe(true);
  }
}, 60000);

test('repeating an advertisement slot in a whole issue keeps each page own artwork', async () => {
  const issue = {
    ...fixture, articles: [],
    layoutPlan: { pages: [
      { id: 'ad-one', pageNumber: 1, templateId: 'ad-half-bottom', articleIds: [], media: { 'ad-1': { path: 'media/march-cfur-carbon-capture.jpg' } } },
      { id: 'ad-two', pageNumber: 2, templateId: 'ad-half-bottom', articleIds: [], media: { 'ad-1': { path: 'media/march-cn-centre-30.jpg' } } },
    ] },
  };
  const { artifacts, manifest } = await issues.compileIssue({ library, issue, executor, fonts, loadMedia, markdownit, JSZip });
  expect(manifest.preflight.errors).toBe(0);
  const document = await native(artifacts.native);
  const ads = document.spreads.flatMap((s: any) => s.items).filter((i: any) => i.label && JSON.parse(i.label).role === 'ad');
  expect(ads).toHaveLength(2);
  expect(new Set(ads.map((i: any) => i.content.asset)).size).toBe(2);
}, 60000);

test('the server accepts four source articles, stages bundled PDF artwork and collects checked native exports', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'ote-source-service-'));
  const service = createNativeService({ engine: 'wasm', repository: root, root: directory, python: '/nonexistent', cli: '/nonexistent' });
  const templateId = 'source-2024-cfur-briefs';
  const articles = fixture.articles.slice(0, 4), articleIds = articles.map((a: any) => a.id);
  const issue = { ...fixture, articles, layoutPlan: { pages: [{ id: 'page-1', pageNumber: 13, templateId, articleIds }] } };
  const recipe = new JSZip();
  recipe.file('issue.json', JSON.stringify(issue));
  // Keep the full planner catalogue: validation must accept its source slots,
  // while trusted source PDFs are deliberately omitted to exercise staging.
  recipe.file('templates.json', JSON.stringify(library));
  recipe.file('page-plan.json', JSON.stringify({ templateId, articleIds, controls: { 'page-number': 13 } }));
  for (const article of articles) for (const photo of article.photos) recipe.file(photo.path, await readFile(join(fixtureDir, photo.path)));
  try {
    const job = await service.submit({ recipe: await recipe.generateAsync({ type: 'nodebuffer' }), mode: 'page' });
    let result: any = job;
    for (const deadline = Date.now() + 120000; !['completed', 'failed'].includes(result.status) && Date.now() < deadline;) {
      await new Promise((done) => setTimeout(done, 50));
      result = await service.get(job.id);
    }
    expect(result.status, result.message).toBe('completed');
    const preflight = JSON.parse((await service.artifact(job.id, 'preflight')).buffer.toString('utf8'));
    expect(preflight.errors).toBe(0);
    expect((await service.artifact(job.id, 'pdf')).buffer.subarray(0, 5).toString()).toBe('%PDF-');
    expect((await JSZip.loadAsync((await service.artifact(job.id, 'idml')).buffer)).file('designmap.xml')).not.toBeNull();
    const document = await native((await service.artifact(job.id, 'native')).buffer);
    const expected = await pages.buildPage({ library, templateId, issue, articleIds, pageNumber: 13, markdownit, loadMedia });
    for (const article of articles) expect(Object.values<any>(document.stories).some((s) => s.text === expected.composed[article.id].text)).toBe(true);
    const bundle = await JSZip.loadAsync((await service.artifact(job.id, 'bundle')).buffer);
    const stagedArt = await bundle.file('recipe/source-art/march-cfur-background.pdf')!.async('nodebuffer');
    expect(stagedArt.equals(await readFile(join(staticDir, 'source-art/march-cfur-background.pdf')))).toBe(true);
    expect(bundle.file('page.pdf')).not.toBeNull();
    expect(bundle.file('page.idml')).not.toBeNull();
    expect(bundle.file('Document Fonts/CaveatBrush-Regular.ttf')).not.toBeNull();
  } finally {
    await service.dispose();
  }
}, 180000);
