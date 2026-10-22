#!/usr/bin/env -S node --import tsx
// Exercise the real OTEManager native service: validation, source staging,
// asynchronous composition, artifact collection and the downloadable bundle.
// node --import tsx tools/designcraft/check-source-server.mts [issue.json]
import JSZip from 'jszip';
import { execFileSync } from 'node:child_process';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createNativeService } from '../../server/designcraft-native.ts';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const source = resolve(process.argv[2] ?? join(root, 'public/designcraft/source-issues/issue-7-march-2025-dfcbb959/reconstruction-issue.json'));
const output = resolve(process.env.SOURCE_SERVER_OUTPUT ?? join(root, 'artifacts/source-reconstruction/server-issue-job'));
const reportPath = resolve(process.env.SOURCE_SERVER_REPORT ?? join(root, 'docs/designcraft-review/source-server-whole-issue.json'));
const issue = JSON.parse(await readFile(source, 'utf8'));
const library = JSON.parse(await readFile(join(dirname(source), 'templates.json'), 'utf8'));
await mkdir(output, { recursive: true }); await mkdir(dirname(reportPath), { recursive: true });
const recipe = new JSZip(); recipe.file('issue.json', JSON.stringify(issue)); recipe.file('templates.json', JSON.stringify(library));
// Bundled source-art references intentionally stay out of this ZIP. The real
// service must validate and stage its canonical public resources itself.
const service = createNativeService({ engine: 'wasm', repository: root, root: join(output, 'jobs') });
const report: any = { schemaVersion: 'ote.source-server-whole-issue-check.v1', engine: 'wasm', source: issue.sourceIssue, status: 'running' };
const started = Date.now();
try {
  report.capabilities = await service.capabilities();
  const submitted = await service.submit({ recipe: await recipe.generateAsync({ type: 'nodebuffer' }), mode: 'issue', fontProfile: 'portable', booklet: false });
  process.stdout.write(JSON.stringify({ event: 'admitted', id: submitted.id, sourceDocumentId: issue.sourceIssue.documentId, pages: issue.sourceIssue.pageCount }) + '\n');
  let job = submitted;
  while (!['completed', 'failed'].includes(job.status)) {
    if (Date.now() - started > 600000) throw new Error('The actual server source issue job exceeded ten minutes');
    await new Promise((done) => setTimeout(done, 250)); job = await service.get(submitted.id);
  }
  report.job = job;
  for (const key of Object.keys(job.artifacts)) {
    const artifact = await service.artifact(job.id, key);
    await writeFile(join(output, artifact.name), artifact.buffer);
  }
  if (job.status !== 'completed') throw new Error(job.message ?? 'Source issue server composition failed');
  const manifest = JSON.parse(await readFile(join(output, job.artifacts.manifest.name), 'utf8'));
  const preflight = JSON.parse(await readFile(join(output, job.artifacts.preflight.name), 'utf8'));
  const native = await JSZip.loadAsync(await readFile(join(output, job.artifacts.native.name)));
  const document = JSON.parse(await native.file('document.json')!.async('string'));
  const nativePages = document.spreads.flatMap((spread: any) => spread.pages);
  const declaredAds = issue.layoutPlan.pages.flatMap((page: any) => library.templates.find((template: any) => template.id === page.templateId).slots.filter((slot: any) => slot.role === 'ad' && slot.id.startsWith('source-ad-')).map((slot: any) => ({ pageId: page.id, pageNumber: page.pageNumber, slotId: slot.id })));
  const nativeAds: any[] = [];
  const inspectAds = (items: any[]) => { for (const item of items) {
    if (item.label) { let label: any; try { label = JSON.parse(item.label); } catch { /* Free text label. */ }
      if (label?.role === 'ad' && label.slotId?.startsWith('source-ad-')) nativeAds.push({ pageId: label.pageId, slotId: label.slotId, assetId: item.content?.asset });
    }
    if (item.content?.type === 'group') inspectAds(item.content.items);
  } };
  for (const spread of document.spreads) inspectAds(spread.items);
  const idml = await JSZip.loadAsync(await readFile(join(output, job.artifacts.idml.name)));
  let idmlPages = 0;
  for (const path of Object.keys(idml.files).filter((path) => /^Spreads\/[^/]+\.xml$/.test(path))) idmlPages += ((await idml.file(path)!.async('string')).match(/<Page\s/g) ?? []).length;
  const pdf = JSON.parse(execFileSync('python3', ['-c', 'import fitz,json,sys;d=fitz.open(sys.argv[1]);print(json.dumps({"pages":len(d),"sizes":[[p.rect.width,p.rect.height] for p in d]}))', join(output, job.artifacts.pdf.name)], { encoding: 'utf8' }));
  const bundle = await JSZip.loadAsync(await readFile(join(output, job.artifacts.bundle.name)));
  const sourceReadback = JSON.parse(await bundle.file('recipe/issue.json')!.async('string'));
  const scales = library.templates.flatMap((template: any) => template.slots.flatMap((slot: any) => [slot.style, ...(slot.contentLayout ?? []).map((part: any) => part.style)].map((style: any) => style?.portable?.chars?.hScale).filter((scale: unknown) => typeof scale === 'number')));
  report.checks = {
    serverCompleted: job.status === 'completed',
    nativePageCount: nativePages.length === issue.sourceIssue.pageCount,
    idmlPageCount: idmlPages === issue.sourceIssue.pageCount,
    pdfPageCount: pdf.pages === issue.sourceIssue.pageCount,
    sourceComplete: manifest.sourceReconstruction?.complete === true,
    sourcePageOrder: manifest.sourceReconstruction?.originalOrderPreserved === true && manifest.pages.every((page: any, index: number) => page.sourcePage === index + 1),
    linkedSpreadsVerified: (manifest.sourceReconstruction?.spreads ?? []).every((spread: any) => spread.verified),
    preflightPassed: preflight.errors === 0 && manifest.status === 'exported',
    articleBodiesPreserved: Object.values(manifest.articleBodyChecks ?? {}).every(Boolean),
    recipeSourceRetained: JSON.stringify(sourceReadback) === JSON.stringify(issue),
    bundleContainsNativePdfIdml: ['native', 'pdf', 'idml'].every((key) => Boolean(bundle.file(job.artifacts[key].name))),
    bundleContainsSourceAssets: Object.keys(bundle.files).some((path) => path.startsWith('recipe/source-art/') && !bundle.files[path].dir),
    bundleContainsPortableFonts: Boolean(bundle.file('Document Fonts/SourceSerif4-Regular.ttf')),
    independentAdPlacements: declaredAds.every((ad: any) => nativeAds.filter((native) => native.pageId === ad.pageId && native.slotId === ad.slotId && native.assetId).length === 1) && nativeAds.length === declaredAds.length,
    marchTwoIndependentAds: issue.sourceIssue.documentId !== 'issue-7-march-2025-dfcbb959' || nativeAds.length === 2,
  };
  report.pageCounts = { expected: issue.sourceIssue.pageCount, native: nativePages.length, idml: idmlPages, pdf: pdf.pages };
  report.sourceReconstruction = manifest.sourceReconstruction;
  report.preflight = { errors: preflight.errors, warnings: preflight.warnings };
  report.validatedPortableScales = { count: scales.length, min: scales.length ? Math.min(...scales) : null, max: scales.length ? Math.max(...scales) : null };
  report.independentAds = { expected: declaredAds, native: nativeAds };
  const stagedPaths = Object.keys(bundle.files).filter((path) => path.startsWith('recipe/source-art/') && !bundle.files[path].dir);
  report.validatedSourceMedia = { jpeg: stagedPaths.filter((path) => /\.jpe?g$/.test(path)).length, png: stagedPaths.filter((path) => path.endsWith('.png')).length, pdf: stagedPaths.filter((path) => path.endsWith('.pdf')).length };
  report.status = Object.values(report.checks).every(Boolean) ? 'passed' : 'failed';
} catch (error: any) {
  report.status = 'failed'; report.error = error.message;
} finally {
  report.elapsedSeconds = Math.round((Date.now() - started) / 10) / 100;
  await service.dispose();
  await writeFile(reportPath, JSON.stringify(report, null, 2) + '\n');
}
process.stdout.write(JSON.stringify({ status: report.status, pageCounts: report.pageCounts, preflight: report.preflight, checks: report.checks, error: report.error, report: reportPath }) + '\n');
if (report.status !== 'passed') process.exitCode = 1;
