// @vitest-environment node
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { createContext, Script } from 'node:vm';
import { randomUUID } from 'node:crypto';
import JSZip from 'jszip';
import { Window } from 'happy-dom';
import { afterEach, expect, test, vi } from 'vitest';

const root=resolve('public/designcraft');
const windows:Window[]=[];
afterEach(async()=>{for(const window of windows.splice(0))await window.happyDOM.abort();});

async function planner({whole=false}={}){
 const window=new Window({url:'http://ote.example/designcraft/index.html'});windows.push(window);
 window.document.documentElement.innerHTML=await readFile(resolve(root,'index.html'),'utf8');
 const context=createContext({
  window,document:window.document,location:window.location,Image:window.Image,
  JSZip,Blob,URL,Uint8Array,ArrayBuffer,crypto:{randomUUID},setTimeout,clearTimeout,
  fetch:async(path:string)=>{
   const target=resolve(root,path);if(!target.startsWith(root+'/'))throw Error('Outside test fixture');
   try{return new Response(await readFile(target));}catch{return new Response('Missing',{status:404});}
  },
 });
 const run=(code:string)=>new Script(code).runInContext(context);
 const scripts=await Promise.all(['app.js','cover-form.js','page-editor.js','issue-plan.js','source-options.js',...(whole?['source-issue-options.js']:[])].map(file=>readFile(resolve(root,file),'utf8')));
 for(const source of scripts)run(source);
 await run('plannerReady');
 // Catalogue loading follows the initial library load.
 for(let i=0;i<100&&!window.document.getElementById('source-page-preset');i++)await new Promise(done=>setTimeout(done,5));
 expect(window.document.getElementById('source-page-preset')).not.toBeNull();
 if(whole){for(let i=0;i<100&&!run('sourceIssuesCatalogue');i++)await new Promise(done=>setTimeout(done,5));expect(run('sourceIssuesCatalogue.issues.length')).toBeGreaterThan(0);}
 const element=(id:string)=>window.document.getElementById(id)! as any;
 const select=(id:string,value:string)=>{element(id).value=value;element(id).dispatchEvent(new window.Event('change'));};
 return{window,run,element,select};
}

test('a source Q&A can be edited, saved and reimported with its artwork and section intact',async()=>{
 const {run,element,select}=await planner();
 select('source-page-preset','source-2024-president-qa');
 element('source-page-preset').parentElement.nextElementSibling.click();
 expect(run('selected.id')).toBe('source-2024-president-qa');
 const answer=element('editor-slot-fields').querySelectorAll('textarea');
 const answerInput=[...answer].find((n:any)=>n.parentElement.textContent.includes('President’s answer')) as any;
 expect(answerInput).toBeDefined();
 answerInput.value='A replacement answer kept as editable text.';
 answerInput.dispatchEvent(new (element('source-options').ownerDocument.defaultView.Event)('input'));
 const answerRegion=[...element('editor-slot-fields').querySelectorAll('legend')].find((n:any)=>n.textContent==='answer')?.parentElement;
 const answerSize=answerRegion?.querySelector('input') as any;expect(answerSize).toBeDefined();
 answerSize.value='13.5';answerSize.dispatchEvent(new (element('source-options').ownerDocument.defaultView.Event)('input'));
 select('source-section-preset','president-qa');
 run('saveIssuePage()');
 expect(run('plannedPages[0].baseTemplate.section.label')).toBe('President question of the month');
 const zipBytes=await run('buildPageZip()');
 const zip=await JSZip.loadAsync(zipBytes);
 const saved=JSON.parse(await zip.file('page-plan.json')!.async('string'));
 expect(saved.baseTemplate.slots.find((s:any)=>s.fields?.answer).fields.answer).toBe('A replacement answer kept as editable text.');
 expect(saved.baseTemplate.slots.find((s:any)=>s.fields?.answer).contentLayout.find((p:any)=>p.field==='answer').fontSize).toBe(13.5);
 const template=JSON.parse(await zip.file('templates.json')!.async('string')).templates[0];
 for(const slot of template.slots)if(slot.asset?.startsWith('source-art/'))expect(zip.file(slot.asset)).not.toBeNull();
 const file=Object.assign(zipBytes,{name:'saved-source.zip'});
 (run('globalThis')).importedFile=file;
 await run('importIssue(importedFile)');
 expect(element('import-status').textContent).toContain('articles imported');
 expect(run('selected.slots.find(s=>s.fields?.answer).fields.answer')).toBe('A replacement answer kept as editable text.');
 expect(run('selected.section.label')).toBe('President question of the month');
 expect(run('[...bytes.keys()].some(p=>p.startsWith("source-art/"))')).toBe(true);
},30000);

test('measured ad reservations preserve exact source bounds and package their original artwork',async()=>{
 const {run,element,select}=await planner();
 select('source-block-preset','2024-moose-ad');
 const add=[...element('source-options').querySelectorAll('button')].find((n:any)=>n.textContent==='Add measured reservation') as any;
 add.click();
 expect(run('blocks[0].rect')).toEqual([386.601,65.249,716.849,752.743]);
 expect(run('resolved(selected).slots.find(s=>s.blockType==="ad").source.page')).toBe(16);
 const zip=await JSZip.loadAsync(await run('buildPageZip()'));
 expect(zip.file('source-art/2024-moose-ad.pdf')).not.toBeNull();
 expect(zip.file('source-art/2024-moose-ad.png')).not.toBeNull();
},30000);

test('structured board fields remain lists and invalid edits keep their last valid contents',async()=>{
 const {run,element,window}=await planner();
 run('choose("piece-board-members")');
 const members=[...element('editor-slot-fields').querySelectorAll('textarea')].find((n:any)=>n.parentElement.textContent.includes('Board members')) as any;
 expect(members).toBeDefined();
 members.value='[{"name":"Alex","role":"Director","bio":"Campus representative"}]';members.dispatchEvent(new window.Event('input'));
 expect(run('selected.slots[0].fields.members[0].name')).toBe('Alex');
 members.value='[broken';members.dispatchEvent(new window.Event('input'));
 expect(run('Array.isArray(selected.slots[0].fields.members)')).toBe(true);
 expect(run('selected.slots[0].fields.members[0].name')).toBe('Alex');
 expect(members.validationMessage).toContain('Invalid members');
});

test('adding a reservation cannot move the original source artwork or text exclusion shapes',async()=>{
 const {run,element,select}=await planner();
 select('source-page-preset','source-2024-moose-ad');
 element('source-page-preset').parentElement.nextElementSibling.click();
 const original=run('JSON.stringify(resolved(selected).slots)');
 select('source-block-preset','2024-moose-ad');
 const add=[...element('source-options').querySelectorAll('button')].find((n:any)=>n.textContent==='Add measured reservation') as any;
 add.click();
 expect(element('source-options-status').textContent).toContain('already keeps its measured reservations');
 expect(run('blocks.length')).toBe(0);
 expect(run('JSON.stringify(resolved(selected).slots)')).toBe(original);
});

test('the source CFUR page keeps four separate article assignments and its original text exclusions',async()=>{
 const {run,element,select}=await planner();
 run('issue.articles.push({...copy(issue.articles[0]),id:"demo-4",title:"Fourth brief"})');
 select('source-page-preset','source-2024-cfur-briefs');
 element('source-page-preset').parentElement.nextElementSibling.click();
 expect(element('assignments').querySelectorAll('select')).toHaveLength(4);
 expect(run('assignments.slice(0,selected.storyCount)')).toEqual(['demo-1','demo-2','demo-3','demo-4']);
 const zip=await JSZip.loadAsync(await run('buildPageZip()'));
 const plan=JSON.parse(await zip.file('page-plan.json')!.async('string'));
 const library=JSON.parse(await zip.file('templates.json')!.async('string'));
 expect(plan.articleIds).toHaveLength(4);
 expect(library.templates[0].slots.filter((s:any)=>s.role==='wrap')).toHaveLength(5);
 expect(zip.file('source-art/march-cfur-background.pdf')).not.toBeNull();
},30000);

test('one action loads every original issue page and exports complete coverage, artwork and source cover',async()=>{
 const {run,element,window}=await planner({whole:true});
 run('issue.issue.id="manager-import";selected.slots[0].fontSize=17;library.designs["ote-2024"].styles["OTE Body"].size=17');
 const original=run('selected.id');
 await run('loadCompleteSourceIssue("issue-7-march-2025-dfcbb959","artwork")');
 expect(run('plannedPages.length')).toBe(17);
 expect(run('plannedPages.map(p=>p.sourcePage)')).toEqual(Array.from({length:17},(_,i)=>i+1));
 expect(run('selected.sourceCover')).toBe(true);
 expect(element('assignments').querySelectorAll('select')).toHaveLength(0);
 expect(element('source-issue-overview').querySelectorAll('button')).toHaveLength(17);
 expect([...element('issue-pages').querySelectorAll('button')].some((button:any)=>button.textContent==='Remove')).toBe(false);
 expect(run('issue.articlePool.length')).toBe(3);
 const zip=await JSZip.loadAsync(await run('buildIssueZip()'));
 const saved=JSON.parse(await zip.file('issue.json')!.async('string'));
 expect(saved.sourceIssue.pageCount).toBe(17);
 expect(saved.layoutPlan.pages).toHaveLength(17);
 expect(saved.layoutPlan.pages.map((page:any)=>page.sourcePage)).toEqual(Array.from({length:17},(_,i)=>i+1));
 expect(saved.layoutPlan.cover.articleIds).toEqual([]);
 expect(saved.articles).toEqual([]);
 const templates=JSON.parse(await zip.file('templates.json')!.async('string')).templates;
 expect(templates).toHaveLength(17);
 for(const template of templates)for(const slot of template.slots)if(slot.asset?.startsWith('source-art/'))expect(zip.file(slot.asset)).not.toBeNull();
 run('library.designs["ote-2024"].swatches=[]');
 (run('globalThis')).wholeSourceFile=Object.assign(await zip.generateAsync({type:'uint8array'}),{name:'complete-source.zip'});
 await run('importIssue(wholeSourceFile)');
 expect(element('import-status').textContent).toContain('articles imported');
 expect(run('plannedPages.length')).toBe(17);
 expect(run('issue.sourceIssue.pageCount')).toBe(17);
 expect(run('library.designs["ote-2024"].swatches.length')).toBeGreaterThan(0);
 expect(run('plannedPages[16].sourcePage')).toBe(17);
 const compose=vi.fn().mockResolvedValue({status:'completed'});(window as any).oteBrowserCompose={compose};
 element('source-issue-generate').click();for(let i=0;i<10&&!compose.mock.calls.length;i++)await new Promise(done=>setTimeout(done,1));
 expect(compose).toHaveBeenCalledWith('issue');
 run('restoreSourceWorkspace()');
 expect(run('selected.id')).toBe(original);
 expect(run('selected.slots[0].fontSize')).toBe(17);
 expect(run('library.designs["ote-2024"].styles["OTE Body"].size')).toBe(17);
 expect(run('issue.issue.id')).toBe('manager-import');
 expect(run('plannedPages.length')).toBe(0);
},60000);

test('an unknown release stays unknown and a source issue can become an unlocked new issue',async()=>{
 const {run,element}=await planner({whole:true});
 await run('loadCompleteSourceIssue("issue-5-ba123d17","artwork")');
 expect(element('release-date').value).toBe('');
 expect(run('issueWithCover().issue.date')).toBeUndefined();
 expect(run('issueWithCover().layoutPlan.cover.date')).toBeUndefined();
 const count=run('plannedPages.length');
 run('useSourceAsNewIssue()');
 expect(run('issue.sourceIssue')).toBeUndefined();
 expect(run('issue.sourceIssueReference.pageCount')).toBe(count);
 expect(run('issueWithCover().issue.date')).toBeUndefined();
 expect([...element('issue-pages').querySelectorAll('button')].some((button:any)=>button.textContent==='Remove')).toBe(true);
 run('restoreSourceWorkspace()');
 expect(run('issue.sourceIssue.pageCount')).toBe(count);
 expect(run('issue.sourceIssueReference')).toBeUndefined();
},30000);

test('replacement article import retains all source pages and joins active articles only after assignment',async()=>{
 const {run}=await planner({whole:true});
 await run('loadCompleteSourceIssue("issue-7-march-2025-dfcbb959","reconstruction")');
 const incoming={schemaVersion:'ote.designcraft.issue.v1',issue:{id:'new-manager'},articles:[{id:'new-author-story',title:'A new campus story',author:'New reporter',body:'Complete replacement copy.',photos:[]}]};
 (run('globalThis')).replacementFile={name:'replacement.json',text:async()=>JSON.stringify(incoming)};
 await run('importSourceReplacementArticles(replacementFile)');
 expect(run('plannedPages.length')).toBe(17);
 expect(run('issue.articles.some(a=>a.title==="A new campus story")')).toBe(false);
 run('editIssuePage(plannedPages[5].id);choose(library.templates.find(t=>!t.source&&t.kind==="story"&&t.storyCount===1&&t.photoCount===0&&t.design==="ote-2024").id);assignments=[issue.articlePool.find(a=>a.title==="A new campus story").id];saveIssuePage()');
 expect(run('plannedPages[5].sourcePage')).toBe(6);
 expect(run('plannedPages.length')).toBe(17);
 expect(run('issue.articles.some(a=>a.title==="A new campus story")')).toBe(true);
 expect(run('issue.articlePool.some(a=>a.title==="A new campus story")')).toBe(false);
 expect(run('validatePlacements()')).toBeUndefined();
},30000);

test('browsing every source issue keeps the template library bounded and retains custom recipes',async()=>{
 const {run}=await planner({whole:true});
 const baseline=run('library.templates.length');
 run('library.templates.push({...copy(library.templates[0]),id:"my-own-recipe",name:"My custom recipe"})');
 const entries=run('sourceIssuesCatalogue.issues.map(entry=>({id:entry.id,pageCount:entry.pageCount}))');
 for(const entry of entries){
  (run('globalThis')).nextSourceId=entry.id;
  await run('loadCompleteSourceIssue(nextSourceId,"artwork")');
  expect(run('library.templates.filter(template=>template.id.startsWith("whole-")).length')).toBeLessThanOrEqual(entry.pageCount*2);
  expect(run('library.templates.length')).toBeLessThanOrEqual(baseline+1+entry.pageCount*2);
  expect(run('library.templates.some(template=>template.id==="my-own-recipe")')).toBe(true);
 }
 const previousPalette=run('JSON.stringify(sourceWorkspaceHistory.at(-1).library.designs)');
 run('restoreSourceWorkspace()');
 expect(run('JSON.stringify(library.designs)')).toBe(previousPalette);
 expect(run('library.templates.some(template=>template.id==="my-own-recipe")')).toBe(true);
},60000);

test('whole-issue download saves current source edits and original-photo focal settings, and aborts an invalid page',async()=>{
 const {run,element}=await planner({whole:true});
 await run('loadCompleteSourceIssue("issue-7-march-2025-dfcbb959","reconstruction")');
 const originalPhoto=run('selected.slots.find(slot=>slot.id==="cover-photo").asset');
 element('focus-x').value='15';element('focus-y').value='80';
 run('issue.layoutPlan.cover.fit="cover";issue.layoutPlan.cover.zoom=1.75;const sourceText=selected.slots.find(slot=>slot.blockType==="source-text");sourceText.fields[Object.keys(sourceText.fields)[0]]="SAVED SOURCE EDIT"');
 const previewPhoto=run('resolved(selected).slots.find(slot=>slot.id==="cover-photo")');
 expect(previewPhoto.asset).toBe(originalPhoto);
 expect(previewPhoto.focus).toEqual({x:.15,y:.8});
 expect(previewPhoto.zoom).toBe(1.75);
 run('globalThis.recipeDownloads=[];save=(name,data)=>recipeDownloads.push({name,data})');
 await run('exportIssuePlan()');
 expect(run('recipeDownloads.length')).toBe(1);
 const zip=await JSZip.loadAsync(run('recipeDownloads[0].data'));
 const templates=JSON.parse(await zip.file('templates.json')!.async('string')).templates;
 expect(templates[0].slots.some((slot:any)=>Object.values(slot.fields||{}).includes('SAVED SOURCE EDIT'))).toBe(true);
 expect(templates[0].slots.find((slot:any)=>slot.id==='cover-photo').focus).toEqual({x:.15,y:.8});
 expect(await zip.file('README.txt')!.async('string')).toContain('node /path/to/kit/tools/designcraft/compile.mjs');
 element('page-number').value='999';await run('exportIssuePlan()');
 expect(run('recipeDownloads.length')).toBe(1);
 expect(element('issue-plan-status').textContent).toContain('consecutive pages');
},60000);

test('replacing a source advertisement uses the uploaded preview and preserves its bytes through recipe reload',async()=>{
 const {run,element}=await planner();
 run('choose("source-2024-moose-ad");editorSlotId=selected.slots.find(slot=>slot.role==="ad").id;renderSlotEditor()');
 const png=new Uint8Array(Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+j9ioAAAAASUVORK5CYII=','base64'));
 const upload=element('editor-slot-fields').querySelector('input[type="file"]') as any;
 Object.defineProperty(upload,'files',{value:[{name:'new-ad.png',type:'image/png',arrayBuffer:async()=>png.buffer.slice(png.byteOffset,png.byteOffset+png.byteLength)}]});
 await upload.onchange();
 const asset=run('selected.slots.find(slot=>slot.role==="ad").asset');
 expect(asset).toMatch(/^assets\/user-piece-.*\.png$/);
 expect(run('selected.slots.find(slot=>slot.role==="ad").previewAsset')).toBe(asset);
 const zip=await JSZip.loadAsync(await run('buildPageZip()'));
 expect([...(await zip.file(asset)!.async('uint8array'))]).toEqual([...png]);
 (run('globalThis')).replacementAdRecipe=Object.assign(await zip.generateAsync({type:'uint8array'}),{name:'replacement-ad.zip'});
 await run('importIssue(replacementAdRecipe)');
 expect(element('import-status').textContent).toContain('articles imported');
 expect(run('selected.slots.find(slot=>slot.role==="ad").previewAsset')).toBe(asset);
 expect(run('[...bytes.get(selected.slots.find(slot=>slot.role==="ad").asset)]')).toEqual([...png]);
 run('editorSlotId=selected.slots.find(slot=>slot.role==="ad").id;renderSlotEditor()');
 const remove=[...element('editor-slot-fields').querySelectorAll('button')].find((button:any)=>button.textContent==='Remove artwork') as any;remove.click();
 expect(run('selected.slots.find(slot=>slot.role==="ad").asset')).toBeUndefined();
 expect(run('selected.slots.find(slot=>slot.role==="ad").previewAsset')).toBeUndefined();
},30000);
