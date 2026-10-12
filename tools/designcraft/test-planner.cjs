// Browser regressions for the actual static planner. Requires its HTTP server.
// REVIEW_URL=http://127.0.0.1:8891/ PLANNER_QA_OUTPUT=/tmp/ote-planner-qa node tools/designcraft/test-planner.cjs
const assert=require('node:assert/strict'),fs=require('node:fs/promises'),path=require('node:path');
const {chromium}=require(process.env.REVIEW_PLAYWRIGHT_MODULE||'playwright-core');
const JSZip=require('../../node_modules/jszip');
(async()=>{
 const out=process.env.PLANNER_QA_OUTPUT||'/tmp/ote-planner-qa';await fs.mkdir(out,{recursive:true});
 const browser=await chromium.launch({executablePath:process.env.REVIEW_CHROMIUM||'/usr/bin/chromium',headless:true,args:['--no-sandbox']});
 const results={passed:false,checks:{},pageErrors:[]};
 try{
  const page=await browser.newPage({viewport:{width:1440,height:1100}});page.setDefaultTimeout(10000);page.on('pageerror',e=>results.pageErrors.push(e.message));
  await page.goto(process.env.REVIEW_URL||'http://127.0.0.1:8891/');await page.waitForSelector('.pdf-card');await page.waitForSelector('#page-editor');
  const artwork=await fs.readFile(path.resolve(__dirname,'../../public/designcraft/assets/ote-horizontal-logo.png'));
  const seed={schemaVersion:'ote.designcraft.issue.v1',issue:{id:'planner-regression',date:'2026-10-11',volume:33,number:2},articles:[{id:'a',title:'First original article',author:'Review author',body:'Complete Unicode source — café 中文 🙂\n\n**Original Markdown stays unchanged.**',photos:[{path:'media/a-1.png',mimeType:'image/png',caption:'First photograph'},{path:'media/a-2.png',mimeType:'image/png',caption:'Second photograph'}]},{id:'b',title:'Second original article',author:'Review author',body:'The full second article.\n\nIts second paragraph.',photos:[]}],layoutPlan:{}};
  async function importFile(name,buffer,mimeType='application/json'){
   await page.locator('#import-status').evaluate(e=>e.textContent='Importing regression fixture');
   await page.locator('#import-issue').setInputFiles({name,mimeType,buffer});
   await page.waitForFunction(()=>document.querySelector('#import-status').textContent!=='Importing regression fixture');
   return page.locator('#import-status').textContent();
  }
  async function importSeed(data=seed){const zip=new JSZip();zip.file('issue.json',JSON.stringify(data));for(const a of data.articles)for(const photo of a.photos)zip.file(photo.path,artwork);const message=await importFile('source.zip',await zip.generateAsync({type:'nodebuffer'}),'application/zip');assert.match(message,/articles imported/);}
  async function zipFrom(build){const data=Buffer.from(await page.evaluate(async name=>Array.from(await window[name]()),build));return {buffer:data,zip:await JSZip.loadAsync(data)};}
  async function savePage(n,article){await page.locator('#page-number').fill(String(n));await page.locator('#assignments select').first().selectOption(article);await page.locator('#save-issue-page').click();assert.match(await page.locator('#issue-plan-status').textContent(),/Page saved/);}
  async function rejected(build){return page.evaluate(async name=>{try{await window[name]();return null;}catch(error){return error.message;}},build);}
  const snapshot=()=>page.evaluate(()=>({issue:copy(issue),selected:copy(selected),blocks:copy(blocks),pages:copy(plannedPages),assignments:[...assignments],media:[...bytes].map(([p,b])=>[p,Array.from(b)]),urls:[...urls],cover:coverSettings()}));

  // R4: reject an invalid imported plan without discarding live source/media/work.
  await importSeed();await page.locator('#selected-template').selectOption('story-1-top-balanced');await page.locator('#add-piece').click();await savePage(1,'a');
  const before=await snapshot(),invalid={schemaVersion:'ote.designcraft.plan.v1',issueBundle:{...seed,issue:{...seed.issue,id:'invalid-replacement'}},blocks:[{id:'invalid',rect:[0,0,50,50]}]};
  assert.match(await importFile('invalid-plan.json',Buffer.from(JSON.stringify(invalid))),/Keep boundaries/);assert.deepEqual(await snapshot(),before);results.checks.atomicImport=true;

  // R5: retain custom 22pt/26pt typography, actual geometry and reserved pieces through import/Edit/Save.
  const headline=await page.evaluate(()=>selected.slots.find(s=>s.role==='headline').id);await page.locator('#editor-slot').selectOption(headline);await page.locator('#editor-fontSize').fill('22');await page.locator('#editor-leading').fill('26');
  const left=Number(await page.locator('#editor-rect-0').inputValue());await page.locator('#editor-rect-0').fill(String(left+3));await savePage(1,'a');
  const expected=await page.evaluate(()=>copy(plannedPages[0]));const pageRecipe=await zipFrom('buildPageZip');await fs.writeFile(path.join(out,'custom-page-recipe.zip'),pageRecipe.buffer);
  assert.match(await importFile('custom-page-recipe.zip',pageRecipe.buffer,'application/zip'),/articles imported/);
  await page.locator('#issue-pages > div').first().getByRole('button',{name:'Edit',exact:true}).click();await page.locator('#save-issue-page').click();
  assert.deepEqual(await page.evaluate(()=>copy(plannedPages[0].template.slots)),expected.template.slots);assert.deepEqual(await page.evaluate(()=>copy(plannedPages[0].baseTemplate)),expected.baseTemplate);results.checks.customRecipeEditSave=true;
  const photoId=await page.evaluate(()=>selected.slots.find(s=>s.role==='photo').id);await page.locator('#editor-slot').selectOption(photoId);await page.locator('#editor-photo').selectOption('1');await page.locator('#editor-image-fit').selectOption('contain');
  await page.locator('#editor-artwork input[type=file]').setInputFiles({name:'advertisement.png',mimeType:'image/png',buffer:artwork});await page.waitForFunction(()=>blocks[0]?.asset?.endsWith('.png'));await savePage(1,'a');
  const asset=await page.evaluate(()=>blocks[0].asset),assetRecipe=await zipFrom('buildPageZip');assert.deepEqual(await assetRecipe.zip.file(asset).async('nodebuffer'),artwork);
  assert.match(await importFile('artwork-page-recipe.zip',assetRecipe.buffer,'application/zip'),/articles imported/);assert.deepEqual(Buffer.from(await page.evaluate(p=>Array.from(bytes.get(p)),asset)),artwork);assert.equal(await page.evaluate(()=>selected.slots.find(s=>s.role==='photo').photoIndex),1);assert.equal(await page.evaluate(()=>selected.slots.find(s=>s.role==='caption').photoIndex),1);results.checks.photoSelectionArtworkReload=true;

  // R6: JSON-only photos cannot produce a ZIP with dangling media paths.
  assert.match(await importFile('paths-only.json',Buffer.from(JSON.stringify(seed))),/articles imported/);await page.locator('#selected-template').selectOption('story-1-top-balanced');assert.match(await rejected('buildPageZip'),/Import the issue ZIP to include original media/);results.checks.missingMediaBlocked=true;

  // R7: unplaced/duplicate ordinary assignments fail before native export.
  const withoutPhotos=JSON.parse(JSON.stringify(seed));withoutPhotos.articles.forEach(a=>a.photos=[]);await importSeed(withoutPhotos);await page.locator('#selected-template').selectOption('story-1-none-balanced');await savePage(1,'a');
  assert.match(await rejected('buildIssueZip'),/Place every article/);await savePage(2,'a');assert.match(await rejected('buildIssueZip'),/explicit continuation chain/);results.checks.invalidPlacementsBlocked=true;

  // An explicitly declared editable flow permits one source story across two pages.
  await savePage(2,'b');await savePage(3,'a');
  const flowDetails=page.locator('#editor-flows').locator('..');if(!await flowDetails.getAttribute('open'))await flowDetails.locator('summary').click();
  const aFlow=page.locator('#editor-flows fieldset').filter({has:page.getByText('First original article',{exact:true})});const flowChecks=aFlow.locator('input[type=checkbox]:not(:disabled)');assert.equal(await flowChecks.count(),2);await flowChecks.nth(0).check();await flowChecks.nth(1).check();
  const flowRecipe=await zipFrom('buildIssueZip'),flowData=JSON.parse(await flowRecipe.zip.file('issue.json').async('string'));assert.equal(flowData.layoutPlan.articleFlows.a.pageIds.length,2);assert.deepEqual(flowData.articles.map(a=>a.body),seed.articles.map(a=>a.body));await fs.writeFile(path.join(out,'continuation-recipe.zip'),flowRecipe.buffer);results.checks.explicitContinuation=true;
  assert.match(await importFile('continuation-recipe.zip',flowRecipe.buffer,'application/zip'),/articles imported/);assert.deepEqual(await page.evaluate(()=>copy(issue.layoutPlan.articleFlows)),flowData.layoutPlan.articleFlows);await zipFrom('buildIssueZip');results.checks.continuationReload=true;
  await page.evaluate(()=>{$('preserve-page').checked=true;});await page.locator('#issue-pages > div').first().getByRole('button',{name:'Edit',exact:true}).click();await page.locator('#preserve-page').check();await page.locator('#save-issue-page').click();assert.match(await rejected('buildIssueZip'),/Continuation pages must be editable/);results.checks.protectedContinuationBlocked=true;

  await page.setViewportSize({width:390,height:844});assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));results.checks.mobile=true;assert.deepEqual(results.pageErrors,[]);results.passed=true;
  await fs.writeFile(path.join(out,'results.json'),JSON.stringify(results,null,2));console.log(JSON.stringify(results,null,2));
 }catch(error){results.error=error.stack;await fs.writeFile(path.join(out,'results.json'),JSON.stringify(results,null,2));throw error;}finally{await browser.close();}
})().catch(error=>{console.error(error);process.exit(1)});
