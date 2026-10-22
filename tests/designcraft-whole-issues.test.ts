// @vitest-environment node
import {beforeAll,expect,test} from 'vitest';
import JSZip from 'jszip';
import markdownit from 'markdown-it';
import {readFile,readdir} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {createHash} from 'node:crypto';

const root=process.cwd(),staticDir=join(root,'public/designcraft');
let compiler:any,pages:any,executor:any,fonts:any[],verify:any,nativeTools:any,locate:any;
beforeAll(async()=>{
 const module=(path:string)=>import(/* @vite-ignore */ pathToFileURL(path).href);
 const [issues,executors,native,checks,pageCompiler]=await Promise.all([
  module(join(staticDir,'compiler/issue-compiler.js')),module(join(staticDir,'compiler/executors.js')),
  module(join(staticDir,'compiler/native-doc.js')),module(join(root,'tools/designcraft/check-source-issues.mjs')),
  module(join(staticDir,'compiler/page-compiler.js')),
 ]);
 compiler=issues;pages=pageCompiler;verify=checks.verifyWholeIssue;locate=checks.locatedItems;nativeTools=native;
 const base=pathToFileURL(join(staticDir,'headless')+'/').href;
 const {Engine}=await executors.loadHeadlessEngine(base,async(name:string)=>new Uint8Array(await readFile(new URL(name,base))));
 executor=executors.wasmExecutor(Engine);
 fonts=await Promise.all((await readdir(join(staticDir,'assets/fonts'))).map(async name=>({name,bytes:new Uint8Array(await readFile(join(staticDir,'assets/fonts',name)))})));
},60000);

test.each([
 ['issue-2-october-2025-0eb630f7',16],
 ['issue-7-march-2025-dfcbb959',17],
 ['cover-page-issue-3-lina-2dc29f52',17],
])('complete %s reconstruction retains every physical page and editable source field',async(documentId,pageCount)=>{
 const directory=join(staticDir,'source-issues',String(documentId));
 const issue=JSON.parse(await readFile(join(directory,'reconstruction-issue.json'),'utf8'));
 const library=JSON.parse(await readFile(join(directory,'templates.json'),'utf8'));
 const loadMedia=async({root:scope,path}:{root:string,path:string})=>{
  for(const base of scope==='library'?[staticDir]:[directory,staticDir]){
   try{return new Uint8Array(await readFile(resolve(base,path)));}catch{/* Next source root. */}
  }
  return null;
 };
 const {manifest,artifacts}=await compiler.compileIssue({library,issue,executor,fonts,loadMedia,JSZip,markdownit,booklet:false});
 expect(manifest.status).toBe('exported');
 const verification=await verify({library,issue,manifest,artifacts,loadMedia});
 expect(verification.checks).toEqual({
  nativePageCount:true,idmlPageCount:true,sourcePageOrder:true,nativePageIds:true,
  nativePlacementOrder:true,originalArtworkEmbedded:true,editorialCopyPreserved:true,
  articleCopyPreserved:true,manifestPageCount:true,linkedSpreadsVerified:true,noPreflightErrors:true,
 });
 expect(verification.nativePageCount).toBe(pageCount);
 expect(verification.idmlPageCount).toBe(pageCount);
 expect(manifest.sourceReconstruction.pages.map((p:any)=>p.sourcePage)).toEqual(Array.from({length:Number(pageCount)},(_,i)=>i+1));
 expect(manifest.sourceReconstruction.pages[0]).toMatchObject({pageNumber:1,role:'cover',sourceMode:'editable'});
 const {document}=await nativeTools.readNative(artifacts.native,JSZip);
 const coverFrames=nativeTools.textFrames(document).filter((f:any)=>f.pageIndex===0);
 expect(coverFrames.some((f:any)=>document.stories[String(f.item.content.story)].text.trim())).toBe(true);
 const classified=manifest.sourceReconstruction;
 expect(classified.artworkPageNumbers).toEqual([]);
 expect(classified.editablePageNumbers.length+classified.blankPageNumbers.length).toBe(pageCount);
 if(documentId==='issue-2-october-2025-0eb630f7'){
  expect(classified.blankPageNumbers).toEqual([11]);
  const presidentText=nativeTools.textFrames(document).filter((f:any)=>f.pageIndex===3).map((f:any)=>document.stories[String(f.item.content.story)].text.trim());
  expect(presidentText.filter((text:string)=>text==='Question')).toHaveLength(1);
  expect(nativeTools.textFrames(document).filter((f:any)=>f.pageIndex===10)).toHaveLength(0);
  expect(verification.pages[10].editableCopyChecks).toEqual([]);
  const advertisements=locate(document).filter((i:any)=>i.label.slotId.startsWith('source-ad-'));
  expect(advertisements.map((i:any)=>[i.pageNumber,i.label.slotId])).toEqual([
   [14,'source-ad-cfur-event'],[15,'source-ad-thirsty-moose'],[16,'source-ad-ote-recruitment'],
  ]);
  expect(advertisements.every((i:any)=>i.item.content.type==='graphic')).toBe(true);
 }else if(documentId==='issue-7-march-2025-dfcbb959'){
  expect(Object.keys(manifest.articleBodyChecks)).toHaveLength(4);
  expect(Object.values(manifest.articleBodyChecks).every(Boolean)).toBe(true);
 }else{
  const wildlife=classified.spreads.find((s:any)=>JSON.stringify(s.pageNumbers)==='[8,9]');
  expect(wildlife).toBeDefined();
  expect(wildlife.nativeSpreadId).toBeDefined();
  const physical=document.spreads.flatMap((s:any)=>s.pages);
  const spread=document.spreads.find((s:any)=>s.id===wildlife.nativeSpreadId);
  expect(spread.pages.map((p:any)=>p.id)).toEqual([physical[7].id,physical[8].id]);
 }
 expect(new TextDecoder().decode(artifacts.pdf.slice(0,5))).toBe('%PDF-');
},180000);

test('a complete source page accepts replacement ad artwork while retaining its editable header',async()=>{
 const directory=join(staticDir,'source-issues/issue-2-october-2025-0eb630f7');
 const issue=JSON.parse(await readFile(join(directory,'reconstruction-issue.json'),'utf8'));
 const library=JSON.parse(await readFile(join(directory,'templates.json'),'utf8'));
 const plan=issue.layoutPlan.pages[14],template=library.templates.find((t:any)=>t.id===plan.templateId);
 const ad=template.slots.find((s:any)=>s.id==='source-ad-thirsty-moose');
 const originalAd=new Uint8Array(await readFile(join(staticDir,ad.asset)));
 const replacementPath='assets/user-piece-ad-proof.jpg';
 const replacement=new Uint8Array(await readFile(join(root,'tests/fixtures/designcraft-march-2025/media/march-cn-centre-30.jpg')));
 // This is the saved template change made by the planner's artwork upload.
 ad.asset=replacementPath;ad.assetMimeType='image/jpeg';ad.previewAsset=replacementPath;
 const loadMedia=async({root:scope,path}:{root:string,path:string})=>{
  if(path===replacementPath)return replacement;
  for(const base of scope==='library'?[staticDir]:[directory,staticDir]){
   try{return new Uint8Array(await readFile(resolve(base,path)));}catch{/* Next source root. */}
  }
  return null;
 };
 const built=await pages.buildPage({library,issue,templateId:template.id,pageId:plan.id,pageNumber:15,articleIds:[],loadMedia,markdownit});
 const {manifest,artifacts}=await pages.compilePage(built,{executor,fonts,JSZip});
 expect(manifest.status).toBe('exported');expect(artifacts.preflight.errors).toBe(0);
 const {document,entries}=await nativeTools.readNative(artifacts.native,JSZip);
 const adItems=locate(document).filter((i:any)=>i.label.slotId===ad.id);
 expect(adItems).toHaveLength(1);expect(adItems[0].label.role).toBe('ad');
 const assetId=adItems[0].item.content.asset;
 const assetEntries=[...entries].filter(([name]:[string,Uint8Array])=>name.startsWith('assets/'+assetId+'.'));
 expect(assetEntries).toHaveLength(1);
 const hash=(data:Uint8Array)=>createHash('sha256').update(data).digest('hex');
 expect(hash(assetEntries[0][1])).toBe(hash(replacement));
 expect([...entries].filter(([name]:[string,Uint8Array])=>name.startsWith('assets/')).some(([,data]:[string,Uint8Array])=>hash(data)===hash(originalAd))).toBe(false);
 const copy=Object.values<any>(document.stories).map(s=>s.text);
 expect(built.structuredBlocks.flatMap((b:any)=>b.fields).every((f:any)=>copy.some(t=>t.includes(f.text)))).toBe(true);
 expect(copy).toContain('SEPTEMBER 12, 2025');
 expect(new TextDecoder().decode(artifacts.pdf.slice(0,5))).toBe('%PDF-');
},60000);
