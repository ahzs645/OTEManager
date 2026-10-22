#!/usr/bin/env node
// Compile complete source issue recipes, and independently check their saved
// native/IDML page order, placements, embedded artwork and editable copy.
// Usage: node tools/designcraft/check-source-issues.mjs path/to/issue.json [...]
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import JSZip from 'jszip';
import markdownit from 'markdown-it';
import { compileIssue } from '../../public/designcraft/compiler/issue-compiler.js';
import { loadHeadlessEngine, wasmExecutor } from '../../public/designcraft/compiler/executors.js';
import { readNative, sha256Hex, textFrames } from '../../public/designcraft/compiler/native-doc.js';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const STATIC = join(ROOT, 'public/designcraft');
const OUTPUT = resolve(process.env.SOURCE_ISSUE_PROOF_OUTPUT ?? join(ROOT, 'artifacts/source-reconstruction/whole-issues'));
const REPORT = process.env.SOURCE_ISSUE_PROOF_REPORT ?? 'report.json';
const IDENTITY = [1, 0, 0, 1, 0, 0];
const multiply = ([a,b,c,d,e,f], [g,h,i,j,k,l]) => [a*g+c*h,b*g+d*h,a*i+c*j,b*i+d*j,a*k+c*l+e,b*k+d*l+f];

/** Locate every labelled native item, including graphics inside placed groups. */
export function locatedItems(document) {
  const result = []; let offset = 0;
  for (const spread of document.spreads) {
    function walk(items, parent = IDENTITY) {
      for (const item of items) {
        const xf = multiply(parent, item.xf ?? IDENTITY);
        let label = {};
        try { label = JSON.parse(item.label ?? '{}'); } catch { /* User labels are ordinary text. */ }
        const points = (item.path?.subpaths ?? []).flatMap((p) => (p.anchors ?? []).map((a) => a.p)).filter(Boolean);
        let pageNumber = null;
        if (points.length) {
          const mapped = points.map(([x,y]) => [xf[0]*x+xf[2]*y+xf[4],xf[1]*x+xf[3]*y+xf[5]]);
          const xs = mapped.map((p) => p[0]), ys = mapped.map((p) => p[1]);
          const cx = (Math.min(...xs)+Math.max(...xs))/2, cy = (Math.min(...ys)+Math.max(...ys))/2;
          const matches = spread.pages.map((page,i) => ({ page, number: offset+i+1 })).filter(({page}) => page.x<=cx && cx<page.x+page.width && cy>=0 && cy<page.height);
          if (matches.length === 1) pageNumber = matches[0].number;
        }
        if (label.pageId) result.push({ item, label, pageNumber });
        if (item.content?.type === 'group') walk(item.content.items, xf);
      }
    }
    walk(spread.items); offset += spread.pages.length;
  }
  return result;
}

export async function verifyWholeIssue({ library, issue, manifest, artifacts, loadMedia }) {
  const { document, entries } = await readNative(artifacts.native, JSZip);
  const plan = [...issue.layoutPlan.pages].sort((a,b) => a.pageNumber-b.pageNumber);
  const physical = document.spreads.flatMap((s) => s.pages);
  const idml = await JSZip.loadAsync(artifacts.idml);
  let idmlPageCount = 0;
  for (const name of Object.keys(idml.files).filter((n) => /^Spreads\/[^/]+\.xml$/.test(n))) idmlPageCount += ((await idml.file(name).async('string')).match(/<Page\s/g) ?? []).length;
  const source = manifest.sourceReconstruction;
  const labels = locatedItems(document);
  const frames = textFrames(document);
  const pages = [];
  for (const [index,p] of plan.entries()) {
    const template = library.templates.find((t) => t.id === p.templateId);
    const items = labels.filter((i) => i.label.pageId === p.id);
    const fields = (manifest.pageBuilds[index]?.structuredBlocks ?? []).flatMap((b) => b.fields.map((f) => ({ blockId:b.slotId,field:f.field,text:f.text })));
    const stories = frames.filter((f) => f.label.pageId === p.id).map((f) => document.stories[String(f.item.content.story)].text);
    const artwork = [];
    for (const slot of template.slots.filter((s) => s.asset)) {
      const matches = items.filter((i) => i.label.slotId === slot.id && i.item.content?.type === 'graphic');
      const original = await loadMedia({ root:slot.assetRoot === 'issue'?'issue':'library',path:slot.asset });
      const id = matches[0]?.item.content.asset;
      const paths = [...entries.keys()].filter((n) => n.startsWith('assets/'+id+'.'));
      artwork.push({ slotId:slot.id,source:slot.asset,uniquePlacement:matches.length===1,
        embeddedOriginalBytes:Boolean(original && paths.length===1 && (await sha256Hex(entries.get(paths[0]))) === (await sha256Hex(original))) });
    }
    pages.push({ pageNumber:p.pageNumber,sourcePage:p.sourcePage,sourceMode:p.sourceMode,role:p.role,
      nativePageId:physical[index]?.id,manifestPageId:manifest.pages[index]?.nativePageId,
      correctlyLocated:items.every((i) => i.pageNumber === p.pageNumber),labelledItems:items.length,
      hasExpectedContent:template.slots.length===0 || items.length>0,
      editableCopyChecks:fields.map((f) => ({ blockId:f.blockId,field:f.field,preserved:stories.some((t) => t.includes(f.text)) })),artwork });
  }
  const checks = {
    nativePageCount:physical.length===issue.sourceIssue.pageCount,
    idmlPageCount:idmlPageCount===issue.sourceIssue.pageCount,
    sourcePageOrder:pages.every((p,i) => p.pageNumber===i+1 && p.sourcePage===i+1),
    nativePageIds:pages.every((p) => p.nativePageId===p.manifestPageId),
    nativePlacementOrder:pages.every((p) => p.correctlyLocated && p.hasExpectedContent),
    originalArtworkEmbedded:pages.every((p) => p.artwork.every((a) => a.uniquePlacement && a.embeddedOriginalBytes)),
    editorialCopyPreserved:pages.every((p) => p.editableCopyChecks.every((f) => f.preserved)),
    articleCopyPreserved:Object.values(manifest.articleBodyChecks ?? {}).every(Boolean),
    manifestPageCount:source?.outputPageCount===issue.sourceIssue.pageCount && source?.sourcePageCount===issue.sourceIssue.pageCount,
    linkedSpreadsVerified:(issue.sourceIssue.spreads ?? []).every((s) => {
      const ids=s.pageNumbers.map((n) => physical[n-1]?.id);
      const spread=document.spreads.find((p) => ids.every((id) => p.pages.some((page) => page.id===id)));
      return Boolean(spread && source?.spreads?.find((p) => p.id===s.id)?.nativeSpreadId===spread.id);
    }),
    noPreflightErrors:artifacts.preflight.errors===0,
  };
  return { checks,passed:Object.values(checks).every(Boolean),nativePageCount:physical.length,idmlPageCount,
    sourceReconstruction:source,pages,articleCopyChecks:manifest.articleBodyChecks,
    nativeSpreads:document.spreads.map((s) => ({ id:s.id,pageIds:s.pages.map((p) => p.id),sides:s.pages.map((p) => p.side) })) };
}

async function main() {
  const inputs = process.argv.slice(2);
  if (!inputs.length) throw new Error('Pass one or more complete source issue JSON recipes.');
  const maps = JSON.parse(await readFile(join(STATIC,'source-issue-maps.json'),'utf8'));
  const base = pathToFileURL(join(STATIC,'headless')+'/').href;
  const { Engine } = await loadHeadlessEngine(base,async (name) => new Uint8Array(await readFile(new URL(name,base))));
  const executor = wasmExecutor(Engine);
  const fonts = await Promise.all((await readdir(join(STATIC,'assets/fonts'))).map(async (name) => ({name,bytes:new Uint8Array(await readFile(join(STATIC,'assets/fonts',name)))})));
  const report = {schemaVersion:'ote.source-whole-issue-check.v1',engine:executor.version,fontProfile:'portable',issues:[]};
  await mkdir(OUTPUT,{recursive:true});
  for (const input of inputs) {
    const issuePath = resolve(input),issue = JSON.parse(await readFile(issuePath,'utf8'));
    let library;
    try { library = JSON.parse(await readFile(join(dirname(issuePath),'templates.json'),'utf8')); }
    catch { library = JSON.parse(await readFile(join(STATIC,'templates.json'),'utf8')); }
    const key = issue.sourceIssue.documentId+'-'+issue.sourceIssue.mode;
    const directory = join(OUTPUT,key);await mkdir(directory,{recursive:true});
    const entry = {key,input:issuePath,source:maps.issues.find((s) => s.id===issue.sourceIssue.documentId),status:'failed'};
    const loadMedia = async ({root,path}) => {
      for (const base of root==='library'?[STATIC]:[dirname(issuePath),STATIC]) {
        try {return new Uint8Array(await readFile(join(base,path)));} catch { /* Next permitted source root. */ }
      }
      return null;
    };
    try {
      const {manifest,artifacts} = await compileIssue({library,issue,executor,fonts,loadMedia,markdownit,JSZip,booklet:false,
        onProgress:(p) => {if (p.stage==='page') console.log(key+': page '+p.pageNumber+'/'+p.total);} });
      for (const [name,value] of [['issue.designcraft',artifacts.native],['issue.pdf',artifacts.pdf],['issue.idml',artifacts.idml],
        ['build-manifest.json',JSON.stringify(manifest,null,2)+'\n'],['source-issue.json',JSON.stringify(issue,null,2)+'\n']]) await writeFile(join(directory,name),value);
      entry.verification = await verifyWholeIssue({library,issue,manifest,artifacts,loadMedia});
      entry.status = entry.verification.passed?'exported':'verification-failed';
      await writeFile(join(directory,'verification.json'),JSON.stringify(entry.verification,null,2)+'\n');
    } catch (error) {
      entry.error = error.message;
      if (error.artifacts?.native) await writeFile(join(directory,error.artifacts.draftName ?? 'issue-draft.designcraft'),error.artifacts.native);
      if (error.artifacts?.preflight) {
        await writeFile(join(directory,'preflight.json'),JSON.stringify(error.artifacts.preflight,null,2)+'\n');
        const document = error.artifacts.native ? (await readNative(error.artifacts.native,JSZip)).document : null;
        const items = document ? locatedItems(document) : [];
        entry.failedPageNumber = error.artifacts.manifest?.failedPageNumber;
        entry.errors = error.artifacts.preflight.issues.filter((i) => i.severity==='error').map((i) => {
          const item = items.find((o) => o.item.id===i.item);
          return {...i,itemName:item?.item.name,label:item?.label,text:item?.item.content?.type==='text'?document.stories[String(item.item.content.story)].text:undefined};
        });
      }
    }
    report.issues.push(entry);console.log(JSON.stringify({key,status:entry.status,error:entry.error,checks:entry.verification?.checks}));
    await writeFile(join(OUTPUT,REPORT),JSON.stringify(report,null,2)+'\n');
  }
  if (report.issues.some((e) => e.status!=='exported')) process.exitCode=1;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main();
