// @vitest-environment node
import { beforeAll, expect, test } from 'vitest';
import { readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createContext, runInContext } from 'node:vm';
import JSZip from 'jszip';
import markdownit from 'markdown-it';
import { createNativeService } from '../server/designcraft-native';

const root = process.cwd(), load = (name: string) => import(/* @vite-ignore */ pathToFileURL(join(root,'public/designcraft/compiler',name)).href);
let pages: any, issues: any, variants: any, executor: any, fonts: any[], context: any;
const template = () => ({id:'story', name:'Story', kind:'story', storyCount:1, slots:[
  {id:'headline',role:'headline',articleIndex:0,rect:[36,100,720,180]},
  {id:'byline',role:'byline',articleIndex:0,rect:[36,186,720,216]},
  {id:'body',role:'body',articleIndex:0,columns:2,rect:[36,224,720,744]},
]});
const library = () => ({schemaVersion:'ote.designcraft.templates.v1',page:{width:756,height:792,margin:36,gutter:12},templates:[template()]});
const article = {id:'a',title:'Around the advertisement',author:'Anonymous',body:'A complete **rich story** with a [source link](https://example.org).\n\n'+('This copy remains complete through the declared frame sequence. '.repeat(24)),photos:[]};
const reservation = {id:'quarter-ad',type:'ad',name:'Booked ad',rect:[378,422,720,744]};
beforeAll(async()=>{
  [pages,issues,variants] = await Promise.all(['page-compiler.js','issue-compiler.js','variants.js'].map(load));
  const executors = await load('executors.js'), base=pathToFileURL(join(root,'public/designcraft/headless')+'/').href;
  const {Engine}=await executors.loadHeadlessEngine(base,async(name:string)=>new Uint8Array(await readFile(new URL(name,base))));executor=executors.wasmExecutor(Engine);
  const dir=join(root,'public/designcraft/assets/fonts');fonts=await Promise.all((await readdir(dir)).map(async(name)=>({name,bytes:new Uint8Array(await readFile(join(dir,name)))})));
  const app=await readFile(join(root,'public/designcraft/app.js'),'utf8');context=createContext({console});
  runInContext(app.slice(0,app.indexOf('\nfunction draw(')),context);context.input=library();runInContext('library=input; blocks=[]; sharedFields={};',context);
},60000);
function resolve(t:any,reserved:any[]=[reservation]){context.input=t;context.reserved=reserved;return JSON.parse(runInContext('blocks=reserved;JSON.stringify(resolved(input))',context));}

test('quarter-page reservation retains all free regions, has disjoint eligible geometry, and resolves exactly once',()=>{
  const base=template(), first=resolve(base), twice=resolve(first);
  expect(twice).toEqual(first);expect(base).toEqual(template());
  expect(first.reservationLayout.regions).toHaveLength(2);
  const boxArea=684*644;
  expect(first.reservationLayout.physicalFreeArea/boxArea).toBe(0.75);
  expect(first.reservationLayout.eligibleArea/boxArea).toBeGreaterThan(0.72);
  expect(first.slots.filter((s:any)=>s.id==='quarter-ad')).toHaveLength(1);
  expect(first.bodyFlows[0]).toHaveLength(2);
  const [a,b]=first.reservationLayout.regions;
  expect(Math.min(a[2],b[2])<=Math.max(a[0],b[0])||Math.min(a[3],b[3])<=Math.max(a[1],b[1])).toBe(true);
  for(const slot of first.slots.filter((s:any)=>s.role==='body'))expect(first.reservationLayout.regions.some((r:number[])=>slot.rect[0]>=r[0]&&slot.rect[1]>=r[1]&&slot.rect[2]<=r[2]&&slot.rect[3]<=r[3])).toBe(true);
  expect(resolve(JSON.parse(JSON.stringify(first)))).toEqual(first);
  const checked=JSON.parse(JSON.stringify(first));checked.slots[0].rect[3]+=7.123;checked.slots[1].rect[1]+=7.123;expect(resolve(checked)).toEqual(checked);
  const restored=resolve(first,[]);for(const [index,slot] of restored.slots.entries())for(const [axis,value] of slot.rect.entries())expect(value).toBeCloseTo(base.slots[index].rect[axis],10);
});

test('duplicate template/reservation IDs are rejected and side reservations leave one full-height region',async()=>{
  const bad=template();bad.slots.push({...bad.slots[0]});expect(()=>resolve(bad)).toThrow(/unique/);
  expect(()=>resolve(template(),[{...reservation,id:'body'}])).toThrow(/unique/);
  const side=resolve(template(),[{...reservation,rect:[504,100,720,744]}]);expect(side.reservationLayout.regions).toEqual([[36,100,496,744]]);
  await expect(pages.buildPage({library:library(),template:bad,issue:{schemaVersion:'ote.designcraft.issue.v1',articles:[article]},articleIds:['a'],markdownit,loadMedia:async()=>null})).rejects.toThrow(/unique/);
});

test('an empty reservation-only page retains a full-page booked ad without requiring story space',()=>{
  const ad={id:'ad-only',name:'Advertising',kind:'ad',storyCount:0,slots:[{id:'original-ad',role:'ad',rect:[36,100,720,744]}]};
  const first=resolve(ad,[{...reservation,rect:[36,100,720,744]}]);
  expect(first.slots).toHaveLength(1);expect(first.slots[0].id).toBe('quarter-ad');expect(first.reservationLayout.regions).toEqual([]);
  expect(resolve(first,[{...reservation,rect:[36,100,720,744]}])).toEqual(first);
  expect(resolve(first,[]).slots).toEqual(ad.slots);
});

test('estimates use house leading, point size, paragraph space and slot overrides',()=>{
  const l:any=library(), t:any=template();t.design='house';l.designs={house:{styles:{'OTE Body':{size:10,leading:15,para:{spaceAfter:8}},'OTE Headline':{size:30,leading:35}}}};
  const baseline=variants.estimate({template:template(),order:[article]},l,markdownit);
  const house=variants.estimate({template:t,order:[article]},l,markdownit);expect(house.fill).toBeGreaterThan(baseline.fill);
  const body=t.slots.find((s:any)=>s.role==='body');body.fontSize=12;body.leading=18;
  expect(variants.slotMetrics(body,t,l)).toMatchObject({size:12,leading:18,spaceAfter:8});
  expect(variants.estimate({template:t,order:[article]},l,markdownit).fill).toBeGreaterThan(house.fill);
});

test('real engine composes one complete rich story through both quarter-ad regions and reopens it',async()=>{
  const t=resolve(template()), l={...library(),templates:[t]};
  const built=await pages.buildPage({library:l,template:t,issue:{schemaVersion:'ote.designcraft.issue.v1',issue:{id:'test'},articles:[article]},articleIds:['a'],pageId:'p1',markdownit,loadMedia:async()=>null});
  const {manifest,artifacts}=await pages.compilePage(built,{executor,fonts,JSZip}).catch((error:any)=>{throw new Error(JSON.stringify(error.artifacts?.preflight??error.message));});
  expect(artifacts.preflight.errors).toBe(0);
  for(const key of ['sourceRecordSha256','templateSha256','nativeDocumentSha256'])expect(manifest[key]).toMatch(/^[a-f0-9]{64}$/);
  const doc=JSON.parse(await (await JSZip.loadAsync(artifacts.native)).file('document.json')!.async('string'));
  const bodies=doc.spreads.flatMap((s:any)=>s.items).filter((s:any)=>{try{return JSON.parse(s.label).role==='body'}catch{return false}});
  expect(bodies).toHaveLength(2);expect(new Set(bodies.map((b:any)=>b.content.story)).size).toBe(1);
  const story=doc.stories[String(bodies[0].content.story)];expect(story.frames).toEqual(bodies.map((b:any)=>b.id));expect(story.text).toContain('A complete rich story');
  expect(story.text.match(/This copy remains complete/g)).toHaveLength(24);
  expect(doc.hyperlinks).toHaveLength(1);expect(artifacts.idml.length).toBeGreaterThan(0);
},60000);

test('real issue compiler threads multiple regions on each page into one complete continuation',async()=>{
  const t=resolve(template()), l={...library(),templates:[t]}, data={schemaVersion:'ote.designcraft.issue.v1',issue:{id:'test'},articles:[article],layoutPlan:{pages:[1,2].map((n)=>({id:'p'+n,pageNumber:n,templateId:t.id,articleIds:['a']})),cover:{mode:'editable'},truck:{mode:'editable'},articleFlows:{a:{pageIds:['p1','p2']}}}};
  const {manifest,artifacts}=await issues.compileIssue({library:l,issue:data,executor,fonts,markdownit,JSZip,loadMedia:async()=>null});
  expect(artifacts.preflight.errors).toBe(0);expect(manifest.articleFlows.a.frameIds).toHaveLength(4);expect(manifest.articleBodyChecks.a).toBe(true);expect(manifest.templateLibrarySha256).toMatch(/^[a-f0-9]{64}$/);
},60000);


test('server routes a classic multi-region recipe through JavaScript instead of the legacy Python compiler',async()=>{
  const t=resolve(template()), l={...library(),templates:[t]}, data={schemaVersion:'ote.designcraft.issue.v1',issue:{id:'test'},articles:[article],layoutPlan:{pages:[{id:'p1',pageNumber:1,templateId:t.id,articleIds:['a']}],cover:{mode:'editable'},truck:{mode:'editable'}}};
  const zip=new JSZip();zip.file('templates.json',JSON.stringify(l));zip.file('issue.json',JSON.stringify(data));
  let legacyCalled=false;
  const service=createNativeService({repository:root,cli:process.execPath,runner:async()=>{legacyCalled=true;return {exitCode:1,stdout:'',stderr:'Legacy compiler must not handle explicit regions'};}});
  try{
    const job=await service.submit({recipe:await zip.generateAsync({type:'nodebuffer'}),mode:'issue'});
    let result=await service.get(job.id), attempts=0;
    while(!['failed','completed'].includes(result.status)&&attempts++<200){await new Promise(done=>setTimeout(done,10));result=await service.get(job.id);}
    expect(result.status,result.message).toBe('completed');expect(legacyCalled).toBe(false);expect(result.artifacts.idml).toBeDefined();
  }finally{await service.dispose();}
},60000);
