// @vitest-environment node
import { beforeAll, expect, test } from 'vitest';
import JSZip from 'jszip';
import markdownit from 'markdown-it';
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createNativeService } from '../server/designcraft-native';

const staticDir = join(process.cwd(), 'public/designcraft');
let compiler: any, pages: any, library: any, executor: any, fonts: any[];
const loadMedia = async ({ path }: { path: string }) => new Uint8Array(await readFile(join(staticDir, path)));
const templates = [
  { id: 'source-cover', name: 'Original cover', kind: 'cover', sourceCover: true, storyCount: 0, slots: [{ id: 'cover-card-1', role: 'text', rect: [40, 100, 700, 140], text: '03 · Original printed teaser', field: 'featureTitle' }] },
  { id: 'source-editorial', name: 'Editorial', kind: 'custom', storyCount: 0, slots: [{ id: 'editorial', role: 'piece', rect: [40, 100, 700, 700], fields: { heading: 'Inside the Edge', body: 'Complete recovered source editorial copy.' } }] },
  { id: 'source-ad', name: 'Original ad', kind: 'ad', storyCount: 0, slots: [{ id: 'source-art', role: 'ad', rect: [0, 0, 756, 792], asset: 'pdfs/implementation-guide.pdf', pdfPage: 2 }] },
  { id: 'source-blank', name: 'Original blank page', kind: 'custom', storyCount: 0, slots: [] },
];
const sourceIssue = () => ({ schemaVersion: 'ote.designcraft.issue.v1', articles: [], sourceIssue: { documentId: 'source-edition', pageCount: 4, mode: 'reconstruction', spreads: [{ id: 'inside-spread', pageNumbers: [2, 3] }] },
  layoutPlan: { cover: { articleIds: [], mode: 'editable' }, pages: templates.map((t, i) => ({ id: 'page-' + (i + 1), pageNumber: i + 1, templateId: t.id, articleIds: [], sourcePage: i + 1, sourceMode: i === 1 ? 'editable' : i === 3 ? 'blank' : 'artwork', role: ['cover', 'editorial', 'ad', 'blank'][i], ...(i === 1 || i === 2 ? { spreadId: 'inside-spread' } : {}) })) } });

beforeAll(async () => {
  const load = (name: string) => import(/* @vite-ignore */ pathToFileURL(join(staticDir, 'compiler', name)).href);
  let executors: any;
  [compiler, pages, executors] = await Promise.all(['issue-compiler.js', 'page-compiler.js', 'executors.js'].map(load));
  const base = pathToFileURL(join(staticDir, 'headless') + '/').href;
  const { Engine } = await executors.loadHeadlessEngine(base, async (name: string) => new Uint8Array(await readFile(new URL(name, base))));
  executor = executors.wasmExecutor(Engine);
  library = { ...JSON.parse(await readFile(join(staticDir, 'templates.json'), 'utf8')), templates };
  fonts = await Promise.all((await readdir(join(staticDir, 'assets/fonts'))).map(async (name) => ({ name, bytes: new Uint8Array(await readFile(join(staticDir, 'assets/fonts', name))) })));
}, 60000);

test('whole source issues retain cover teasers, native editorial text, selected PDF pages, blank pages and facing spreads', async () => {
  const { artifacts, manifest } = await compiler.compileIssue({ library, issue: sourceIssue(), executor, fonts, JSZip, markdownit, loadMedia });
  expect(manifest.preflight.errors).toBe(0);
  expect(manifest.sourceReconstruction).toMatchObject({ sourceDocumentId: 'source-edition', sourcePageCount: 4, outputPageCount: 4, complete: true, originalOrderPreserved: true, editablePageNumbers: [2], artworkPageNumbers: [1, 3], blankPageNumbers: [4] });
  expect(manifest.sourceReconstruction.spreads[0]).toMatchObject({ id: 'inside-spread', pageNumbers: [2, 3], verified: true });
  const document = JSON.parse(await (await JSZip.loadAsync(artifacts.native)).file('document.json')!.async('string'));
  expect(document.spreads.flatMap((s: any) => s.pages)).toHaveLength(4);
  const text = Object.values<any>(document.stories).map((s) => s.text);
  expect(text).toContain('03 · Original printed teaser');
  expect(text).toContain('Inside the Edge\nComplete recovered source editorial copy.');
  expect(Object.values<any>(document.assets).some((asset) => asset.mime === 'application/pdf' && asset.page === 1)).toBe(true);
  expect(manifest.nativeCoverReferences.features).toEqual([]);
  expect((await JSZip.loadAsync(artifacts.idml)).file('designmap.xml')).not.toBeNull();
}, 60000);

test('source completeness checks reject omitted pages, reordering and dishonest editability', async () => {
  const issue = sourceIssue();
  expect(() => compiler.validateSourceIssuePlan(issue.sourceIssue, issue.layoutPlan.pages.slice(0, 3))).toThrow(/complete original page count/);
  const reordered = structuredClone(issue.layoutPlan.pages); [reordered[1].sourcePage, reordered[2].sourcePage] = [3, 2];
  expect(() => compiler.validateSourceIssuePlan(issue.sourceIssue, reordered)).toThrow(/original order/);
  const noNativeText = sourceIssue(); noNativeText.layoutPlan.pages[2].sourceMode = 'editable';
  await expect(compiler.compileIssue({ library, issue: noNativeText, executor, fonts, JSZip, markdownit, loadMedia })).rejects.toThrow(/declared editable has no recovered native text/);
}, 60000);

test('source covers keep static source fields when a photograph is replaced', async () => {
  const template = { ...templates[0], slots: [...templates[0].slots, { id: 'cover-photo', role: 'photo', rect: [40, 200, 700, 700], asset: 'pdfs/implementation-guide.pdf', pdfPage: 2 }] };
  const issue = sourceIssue(); Object.assign(issue.layoutPlan.cover, { photoPath: 'originals/logo-052e0d08.pdf', fit: 'contain' });
  const built = await pages.buildPage({ library, template, issue, articleIds: [], markdownit, loadMedia });
  expect(built.template.slots[0].text).toBe('03 · Original printed teaser');
  expect(built.template.slots.find((slot: any) => slot.id === 'cover-photo')).toMatchObject({ asset: 'originals/logo-052e0d08.pdf', assetRoot: 'issue', fit: 'contain' });
  expect(built.steps.find((step: any) => step.command === 'file.place').params.pdfPage).toBeUndefined();
});

test('a source cover can place the original paper-plane overlay without importing the cover underlay', async () => {
  const template = { ...templates[0], id: 'overlay-cover', design: 'ote-2025', overArt: 'cover', slots: [...templates[0].slots,
    { id: 'cover-photo', role: 'photo', rect: [40, 200, 700, 700], asset: 'originals/logo-052e0d08.pdf', fit: 'contain' },
  ] };
  const built = await pages.buildPage({ library, template, issue: sourceIssue(), articleIds: [], markdownit, loadMedia });
  const snippets = built.steps.map((step: any, index: number) => ({ ...step, index })).filter((step: any) => step.command === 'snippet.place');
  expect(snippets).toHaveLength(1);
  const overlayBytes = new Uint8Array(await readFile(join(staticDir, library.designs['ote-2025'].art.cover.over.portable)));
  expect(built.media.get(snippets[0].params.path.slice('@media:'.length))).toEqual(overlayBytes);
  expect(snippets[0].index).toBeGreaterThan(built.steps.findIndex((step: any) => step.command === 'file.place'));
  const { artifacts } = await pages.compilePage(built, { executor, fonts, JSZip });
  expect(artifacts.preflight.errors).toBe(0);
  const document = JSON.parse(await (await JSZip.loadAsync(artifacts.native)).file('document.json')!.async('string'));
  const texts = Object.values<any>(document.stories).map((story) => story.text);
  expect(texts).toContain('03 · Original printed teaser');
  expect(texts.some((text) => text.includes('VOLUME'))).toBe(false);
  await expect(pages.buildPage({ library, template: { ...template, overArt: 'interior' }, markdownit, loadMedia })).rejects.toThrow(/cover overlay/);
  await expect(pages.buildPage({ library, template: { ...template, design: 'ote-2024' }, markdownit, loadMedia })).rejects.toThrow(/cover overlay/);
}, 60000);

test('server source covers stage canonical JPEG photographs and PNG overlays without ZIP copies', async () => {
  const root = process.cwd(), directory = await mkdtemp(join(tmpdir(), 'ote-source-cover-media-'));
  const sourceLibrary = JSON.parse(await readFile(join(staticDir, 'source-issues/issue-7-march-2025-dfcbb959/templates.json'), 'utf8'));
  const template = sourceLibrary.templates.find((template: any) => template.id.endsWith('p001-editable'));
  sourceLibrary.templates = [template];
  const jpeg = template.slots.find((slot: any) => slot.asset?.endsWith('.jpeg')).asset;
  const png = template.slots.find((slot: any) => slot.asset?.endsWith('.png')).asset;
  const issue = { schemaVersion: 'ote.designcraft.issue.v1', articles: [], layoutPlan: { cover: { articleIds: [] }, pages: [{ id: 'cover', pageNumber: 1, templateId: template.id, articleIds: [] }] } };
  const recipe = new JSZip(); recipe.file('issue.json', JSON.stringify(issue)); recipe.file('templates.json', JSON.stringify(sourceLibrary));
  const service = createNativeService({ engine: 'wasm', repository: root, root: join(directory, 'jobs') });
  try {
    const submitted = await service.submit({ recipe: await recipe.generateAsync({ type: 'nodebuffer' }), mode: 'page' });
    let job: any = submitted;
    for (const deadline = Date.now() + 90000; !['completed', 'failed'].includes(job.status) && Date.now() < deadline;) { await new Promise((done) => setTimeout(done, 50)); job = await service.get(submitted.id); }
    expect(job.status, job.message).toBe('completed');
    const bundle = await JSZip.loadAsync((await service.artifact(job.id, 'bundle')).buffer);
    expect(bundle.file('recipe/' + jpeg)).not.toBeNull();
    expect(bundle.file('recipe/' + png)).not.toBeNull();
    expect(await bundle.file('recipe/' + jpeg)!.async('nodebuffer')).toEqual(await readFile(join(staticDir, jpeg)));
    expect(await bundle.file('recipe/' + png)!.async('nodebuffer')).toEqual(await readFile(join(staticDir, png)));
  } finally { await service.dispose(); await rm(directory, { recursive: true, force: true }); }
}, 120000);
