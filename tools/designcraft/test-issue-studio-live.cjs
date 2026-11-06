// Actual app + local Convex smoke checks. Creates uniquely named synthetic QA records.
// Start npm run dev and npx convex dev first. Uses .env.local without printing credentials.
// REVIEW_PLAYWRIGHT_MODULE=/tmp/ote-studio-qa/node_modules/playwright-core node tools/designcraft/test-issue-studio-live.cjs
const { chromium } = require(process.env.REVIEW_PLAYWRIGHT_MODULE || 'playwright-core');
const fs = require('node:fs/promises');
const assert = require('node:assert/strict');
const { createHash } = require('node:crypto');
const { execFileSync } = require('node:child_process');
const path=require('node:path');
const root=path.resolve(__dirname,'../..');
const base=process.env.REVIEW_URL || 'http://127.0.0.1:3000';
if (!['127.0.0.1','localhost','[::1]'].includes(new URL(base).hostname)) throw Error('Live QA requires a local application URL');
function backend(code, args={}) {
 const program=`import {query,mutate,connection} from './server/convex.ts';import {insert,patch} from './server/records.ts';import {getStorage} from './storage/index.ts';import {readFile} from 'node:fs/promises';if(!['127.0.0.1','localhost','[::1]'].includes(new URL(connection().url).hostname))throw Error('Live QA requires a local Convex deployment');const args=${JSON.stringify(args)};const result=await(async()=>{${code}})();console.log(JSON.stringify(result));`;
 return JSON.parse(execFileSync(process.execPath,['--env-file-if-exists=.env.local','--import','tsx','--input-type=module','-'],{cwd:root,input:program,encoding:'utf8'}).trim().split('\n').at(-1));
}
(async()=>{
 const fixture=backend('const stamp=Date.now();const {volume}=await mutate("createVolume",{volumeNumber:900000000+(stamp%100000000),year:2026,description:"Synthetic Issue Studio browser QA"});const {issue}=await mutate("createIssue",{volumeId:volume.id,issueNumber:1,title:"Synthetic Issue Studio QA "+stamp});return {stamp,volumeId:volume.id,issueId:issue.id,title:"QA story "+stamp,email:"qa-"+stamp+"@example.test"}');
 await fs.writeFile('/tmp/ote-studio-live-fixture.json',JSON.stringify(fixture));
 const browser=await chromium.launch({executablePath:process.env.REVIEW_CHROMIUM || '/usr/bin/chromium',headless:true,args:['--no-sandbox']});
 const results={passed:false,checks:{},pageErrors:[],fixture};
 const out=process.env.ISSUE_STUDIO_APP_QA_OUTPUT || '/tmp/ote-studio-live-qa';await fs.mkdir(out,{recursive:true});
 let page;
 try{
  page=await browser.newPage({viewport:{width:1600,height:1100}});page.setDefaultTimeout(30000);
  page.on('pageerror',e=>results.pageErrors.push(e.message));
  await page.goto(base+'/publications/issues/'+fixture.issueId+'/studio');
  await page.getByRole('heading',{name:'Issue map',exact:true}).waitFor();
  assert(await page.getByText('Start with the page budget and ad reservations. Add articles whenever they are ready.').isVisible());
  await page.getByLabel('Page budget',{exact:true}).fill('1');
  await page.getByRole('button',{name:'Quarter-page ad',exact:true}).click();
  await page.getByRole('button',{name:'Save issue',exact:true}).click();
  await page.waitForFunction(()=>!document.body.textContent.includes('Unsaved changes')&&!document.body.textContent.includes('Saving…'));
  let view=backend('return query("getIssueStudio",{issueId:args.issueId})',fixture);
  assert.equal(view.state.reservations.length,1);assert.equal(view.state.pageBudget,1);
  await page.reload();await page.getByRole('heading',{name:'Issue map',exact:true}).waitFor();
  assert.equal(await page.getByLabel('Page budget',{exact:true}).inputValue(),'1');
  assert.equal(await page.getByLabel('Reservation Width',{exact:true}).inputValue(),'336');
  results.checks.emptyIssueAdSaveReload=true;
  await page.goto(base+'/articles?issueId='+fixture.issueId);
  await page.waitForLoadState('networkidle');
  await page.getByRole('button',{name:'Add Article',exact:true}).click();
  await page.getByText(/This article will be assigned to/).waitFor();
  await page.getByPlaceholder('Article title',{exact:true}).fill(fixture.title);
  await page.getByLabel('New Author',{exact:true}).check();
  await page.getByPlaceholder('First name',{exact:true}).fill('Synthetic');
  await page.getByPlaceholder('Last name',{exact:true}).fill('QA');
  await page.getByPlaceholder('Email address',{exact:true}).fill(fixture.email);
  await page.getByRole('button',{name:'Create Article',exact:true}).click();
  await page.getByText('Add New Article',{exact:true}).waitFor({state:'hidden'});
  view=backend('return query("getIssueStudio",{issueId:args.issueId})',fixture);
  assert.equal(view.articles.length,1);assert.equal(view.state.placements.length,1);
  fixture.articleId=view.articles[0].id;
  results.checks.createAndAssignInOneTransaction=true;
  await fs.writeFile('/tmp/ote-studio-live-fixture.json',JSON.stringify(fixture));
  backend('await mutate("updateArticleContent",{articleId:args.articleId,content:"Synthetic full copy — café 中文 🙂. ".repeat(50)});const bytes=await readFile("public/designcraft/assets/ote-horizontal-logo.png");const storage=getStorage();const path="issue-studio-qa/"+args.stamp+"/photo.png";await storage.saveFile(path,bytes);await insert("attachments",{articleId:args.articleId,attachmentType:"photo",fileName:"photo.png",originalFileName:"qa-photo.png",filePath:path,fileSize:bytes.length,mimeType:"image/png",caption:"Synthetic QA photographer",includeInExport:true});return {ok:true}',fixture);
  await page.goto(base+'/publications/issues/'+fixture.issueId+'/studio');
  await page.getByRole('heading',{name:'Issue map',exact:true}).waitFor();
  await page.getByLabel('qa-photo.png',{exact:true}).check();
  await page.getByRole('button',{name:'Save issue',exact:true}).click();
  await page.waitForFunction(()=>!document.body.textContent.includes('Unsaved changes')&&!document.body.textContent.includes('Saving…'));
  await page.getByRole('button',{name:'Open designer',exact:true}).click();
  const frame=page.frameLocator('iframe[src*="/designcraft/index.html"]');
  await frame.locator('#import-status').filter({hasText:'1 articles imported'}).waitFor({state:'attached'});
  await frame.locator('#selected-template').selectOption('story-1-top-balanced');
  await frame.locator('#assignments select').first().selectOption(fixture.articleId);
  await frame.locator('#page-number').fill('1');
  await frame.locator('#save-issue-page').click();
  await frame.locator('#issue-plan-status').filter({hasText:'Page saved'}).waitFor();
  const pf=page.frames().find(f=>f.url().includes('/designcraft/index.html'));
  await pf.evaluate(()=>{issue.articles[0].photos[0].focus={x:.25,y:.7};issue.articles[0].photos[0].zoom=1.4;renderPage()});
  await page.getByRole('button',{name:'Save issue',exact:true}).click();
  await page.waitForFunction(()=>!document.body.textContent.includes('Unsaved changes')&&!document.body.textContent.includes('Saving…'));
  view=backend('return query("getIssueStudio",{issueId:args.issueId})',fixture);
  assert.equal(view.state.pages.length,1);assert.equal(view.state.placements[0].pageIds.length,1);
  await page.reload();await page.getByRole('button',{name:'Open designer',exact:true}).click();
  await page.frameLocator('iframe[src*="/designcraft/index.html"]').locator('#issue-pages > div').first().waitFor();
  const restored=page.frames().find(f=>f.url().includes('/designcraft/index.html'));
  assert.deepEqual(await restored.evaluate(()=>issue.articles[0].photos[0].focus),{x:.25,y:.7});
  assert.equal(await restored.evaluate(()=>issue.articles[0].photos[0].zoom),1.4);
  assert.equal(await restored.evaluate(()=>plannedPages.length),1);
  results.checks.livePlannerSaveCropReopen=true;
  await page.getByRole('button',{name:'Close designer',exact:true}).click();
  const second=await browser.newPage({viewport:{width:1400,height:1000}});await second.goto(page.url());await second.getByLabel('Page budget',{exact:true}).waitFor();
  await page.getByLabel('Page budget',{exact:true}).fill('2');await page.getByRole('button',{name:'Save issue',exact:true}).click();
  await page.waitForFunction(()=>!document.body.textContent.includes('Unsaved changes')&&!document.body.textContent.includes('Saving…'));
  await second.getByLabel('Page budget',{exact:true}).fill('3');await second.getByRole('button',{name:'Save issue',exact:true}).click();
  await second.getByRole('status').filter({hasText:/revision conflict/i}).waitFor();
  assert.equal(await second.getByLabel('Page budget',{exact:true}).inputValue(),'3');
  view=backend('return query("getIssueStudio",{issueId:args.issueId})',fixture);assert.equal(view.state.pageBudget,2);
  results.checks.concurrentEditorsKeepUnsavedConflictingEdits=true;
  // The first layout is a schematic estimate. Make this synthetic fixture's
  // headline/byline/caption typography fit before testing checked production.
  view=backend('await mutate("updateArticleContent",{articleId:args.articleId,content:"Synthetic QA copy is retained in a complete editable story. This issue tests recorded composition, reserved advertising space, and revisioned output.\\n\\nThe original source remains available after composition and manual document handoff."});let view=await query("getIssueStudio",{issueId:args.issueId});view.state.pageBudget=1;for(const placement of view.state.placements)placement.sourceRevision=placement.currentSourceRevision;for(const page of view.state.plannerState.savedPages)for(const template of [page.template,page.baseTemplate])for(const slot of template?.slots??[])if(["headline","byline","caption"].includes(slot.role)){slot.fontSize=Math.min(slot.fontSize??9,Math.max(4,(slot.rect[3]-slot.rect[1])*.55));slot.leading=slot.fontSize*1.1;}return mutate("saveIssueStudio",{issueId:args.issueId,expectedRevision:view.plan.revision,state:view.state})',fixture);
  const composed=await fetch(base+'/api/issue-studio/'+fixture.issueId+'/compose',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({expectedRevision:view.plan.revision,idempotencyKey:'live-qa-'+Date.now()})});
  const composition=await composed.json();assert.equal(composed.status,200,JSON.stringify(composition));assert.equal(composition.job.status,'completed',JSON.stringify(composition.job.diagnostics));
  const downloads=new Map();
  for(const artifact of composition.job.artifacts){const response=await fetch(base+'/api/files/'+artifact.path.split('/').map(encodeURIComponent).join('/'));assert.equal(response.status,200,artifact.name);const bytes=Buffer.from(await response.arrayBuffer());assert.equal(bytes.length,artifact.bytes,artifact.name);assert.equal(createHash('sha256').update(bytes).digest('hex'),artifact.sha256,artifact.name);downloads.set(artifact.name,bytes);}
  for(const name of ['issue.designcraft','proof.pdf','issue.idml','preflight.json','build-manifest.json'])assert(downloads.has(name));
  assert.equal(downloads.get('proof.pdf').subarray(0,5).toString(),'%PDF-');
  assert.equal(composition.job.composition.copyPreserved,true);assert.equal(composition.job.composition.errors,0);
  results.checks.recordedCompositionAndArtifactHashes=true;
  results.artifacts=composition.job.artifacts.map(({name,sha256,bytes})=>({name,sha256,bytes}));
  const form=new FormData();form.append('file',new File([downloads.get('issue.designcraft')],'synthetic-manual.designcraft',{type:'application/octet-stream'}));form.append('name','Synthetic QA manual finishing fork');form.append('expectedRevision',String(view.plan.revision));
  const forkResponse=await fetch(base+'/api/issue-studio/'+fixture.issueId+'/forks',{method:'POST',body:form});const forkView=await forkResponse.json();assert.equal(forkResponse.status,200,JSON.stringify(forkView));
  const fork=forkView.jobs.find(job=>job.fork?.name==='Synthetic QA manual finishing fork');assert(fork);assert.equal(fork.status,'native-fork-active');assert.equal(fork.fork.artifactSha256,composition.job.artifacts.find(a=>a.name==='issue.designcraft').sha256);
  const forkDownload=await fetch(base+'/api/files/'+fork.fork.path.split('/').map(encodeURIComponent).join('/'));assert.equal(forkDownload.status,200);assert.equal(createHash('sha256').update(Buffer.from(await forkDownload.arrayBuffer())).digest('hex'),fork.fork.artifactSha256);
  const original=backend('return query("getIssueCompositionJob",{issueId:args.issueId,jobId:args.jobId})',{...fixture,jobId:composition.job.id});assert.equal(original.job.status,'completed');assert.deepEqual(original.job.result.artifacts,composition.job.artifacts);
  assert.equal(forkView.releaseReadiness.level,'DesignCraft checked');assert.equal(forkView.releaseReadiness.ready,false);assert(forkView.releaseReadiness.blockers.some(b=>b.code==='booked-ad-artwork'));
  results.checks.nativeForkPreservesRecordedOutput=true;
  results.releaseReadiness=forkView.releaseReadiness;
  results.fixtureRetainedForReview=true;
  await page.reload();await page.getByRole('heading',{name:'Issue map',exact:true}).waitFor();
  await page.screenshot({path:out+'/studio.png',fullPage:true});
  results.passed=true;console.log(JSON.stringify(results,null,2));
 }catch(e){results.error=e.stack;if(page)await page.screenshot({path:out+'/failure.png',fullPage:true});throw e;}
 finally{await fs.writeFile(out+'/results.json',JSON.stringify(results,null,2));await browser.close()}
})().catch(e=>{console.error(e);process.exitCode=1});
