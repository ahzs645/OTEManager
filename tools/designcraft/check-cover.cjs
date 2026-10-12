// Optional browser integration check. Uses the same tooling variables as check-review.cjs.
const assert=require('node:assert/strict'),fs=require('node:fs/promises'),path=require('node:path');
const {chromium}=require(process.env.REVIEW_PLAYWRIGHT_MODULE||'playwright-core');
const JSZip=require('../../node_modules/jszip');
(async()=>{
 const out=process.env.COVER_QA_OUTPUT||'/tmp/ote-cover-qa';await fs.mkdir(out,{recursive:true});
 const source=process.env.COVER_QA_SOURCE?JSON.parse(await fs.readFile(process.env.COVER_QA_SOURCE,'utf8')):{schemaVersion:'ote.designcraft.issue.v1',issue:{id:'cover-test',date:'2026-10-11',volume:33,number:2,title:'Over the Edge'},articles:[{id:'a',title:'First article',author:'Test author',body:'Complete original article text.',photos:[]}],layoutPlan:{}};
 source.articles.push({id:'second-test',title:'Second article',author:'Illustrative author',body:'Illustrative second article for the page reference test.',photos:[]});source.layoutPlan={pages:[],cover:{mode:'editable'},truck:{mode:'editable'}};
 const browser=await chromium.launch({executablePath:process.env.REVIEW_CHROMIUM||'/usr/bin/chromium',headless:true,args:['--no-sandbox']});
 const page=await browser.newPage({viewport:{width:1440,height:1100}}),errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.goto(process.env.REVIEW_URL||'http://127.0.0.1:8891/');await page.waitForSelector('.pdf-card');
 await page.locator('#import-issue').setInputFiles({name:'issue.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(source))});await page.waitForFunction(()=>document.querySelector('#import-status').textContent.includes('2 articles imported'));
 // An explicit 22pt headline variant fits the long original title; the compiler must not shorten it.
 await page.evaluate(()=>{const t=library.templates.find(t=>t.id==='story-1-none-balanced');t.slots.find(s=>s.role==='headline').fontSize=22;});
 await page.locator('#selected-template').selectOption('cover-framed-cards-border');await page.getByText('Cover options',{exact:true}).click();
 await page.locator('#release-date').fill('2026-10-11');await page.locator('#volume').fill('33');await page.locator('#issue-number').fill('2');
 await page.locator('#cover-line').fill('OUR CAMPUS, OUR STORIES');await page.locator('#cover-caption').fill('Layout test image · source artwork.');
 await page.locator('#cover-photo').setInputFiles(process.env.COVER_QA_PHOTO);
 await page.locator('#save-issue-page').click();assert.match(await page.locator('#issue-plan-status').textContent(),/Page saved/);
 await page.locator('#export-issue-plan').click();assert.match(await page.locator('#issue-plan-status').textContent(),/Place each featured/);
 async function savePage(n,template,article){await page.locator('#selected-template').selectOption(template);await page.locator('#page-number').fill(String(n));if(article)await page.locator('#assignments select').first().selectOption(article);await page.locator('#save-issue-page').click();assert.match(await page.locator('#issue-plan-status').textContent(),/Page saved/);}
 await savePage(2,'story-1-none-balanced',source.articles[0].id);await savePage(3,'story-1-none-balanced','second-test');await savePage(4,'ad-half-bottom');
 await page.locator('#issue-pages > div').nth(2).getByRole('button',{name:'Move up'}).click();
 await page.locator('#issue-pages > div').nth(2).getByRole('button',{name:'Edit',exact:true}).click();assert.equal(await page.locator('#release-date').inputValue(),'2026-10-11');
 await page.locator('#selected-template').selectOption('cover-framed-cards-border');
 // Edit metadata after saving the cover. Exports must use the current form values.
 await page.locator('#release-date').fill('2026-10-18');await page.locator('#issue-number').fill('3');
 assert.match(await page.locator('#cover-reference-status').textContent(),/page 3/);assert.match(await page.locator('#page-preview').textContent(),/OCTOBER 18/);
 const event=page.waitForEvent('download');await page.locator('#export-issue-plan').click();const download=await event,buffer=await fs.readFile(await download.path());await fs.writeFile(path.join(out,'recipe.zip'),buffer);
 const zip=await JSZip.loadAsync(buffer),data=JSON.parse(await zip.file('issue.json').async('string')),templates=JSON.parse(await zip.file('templates.json').async('string'));
 assert.equal(data.issue.date,'2026-10-18');assert.equal(data.issue.year,2026);assert.equal(data.issue.number,3);assert.equal(data.layoutPlan.cover.caption,'Layout test image · source artwork.');assert.equal(data.layoutPlan.cover.photoPath,'assets/cover-photo.png');
 assert.deepEqual(data.articles.map(a=>a.body),source.articles.map(a=>a.body));assert.deepEqual(await zip.file(data.layoutPlan.cover.photoPath).async('nodebuffer'),await fs.readFile(process.env.COVER_QA_PHOTO));
 const cover=templates.templates.find(t=>t.kind==='cover');assert(cover.slots.find(s=>s.id==='cover-card-1').text.startsWith('03 · '));assert(cover.slots.find(s=>s.id==='cover-card-2').text.startsWith('02 · '));assert.equal(cover.slots.find(s=>s.id==='cover-card-3').text,'');
 for(const [name,entry] of Object.entries(zip.files))if(!entry.dir){await fs.mkdir(path.dirname(path.join(out,'recipe',name)),{recursive:true});await fs.writeFile(path.join(out,'recipe',name),await entry.async('nodebuffer'));}
 await page.locator('#import-status').evaluate(e=>e.textContent='Reloading');await page.locator('#import-issue').setInputFiles({name:'recipe.zip',mimeType:'application/zip',buffer});await page.waitForFunction(()=>document.querySelector('#import-status').textContent.includes('2 articles imported'));
 assert.equal(await page.locator('#release-date').inputValue(),'2026-10-18');assert.equal(await page.locator('#cover-caption').inputValue(),data.layoutPlan.cover.caption);assert.match(await page.locator('#page-preview').textContent(),/03 · /);
 // A separate saved page recipe must keep the actual interior assignments for its automatic references.
 const singleEvent=page.waitForEvent('download');await page.locator('#page-number').fill('1');await page.locator('#export-recipe').click();const single=await singleEvent;await fs.writeFile(path.join(out,'cover-recipe.zip'),await fs.readFile(await single.path()));
 await page.locator('#assignments select').nth(1).selectOption(source.articles[0].id);await page.locator('#export-issue-plan').click();assert.match(await page.locator('#issue-plan-status').textContent(),/distinct featured/);
 await page.locator('#assignments select').nth(1).selectOption('second-test');await page.screenshot({path:path.join(out,'planner.png'),fullPage:true});await page.setViewportSize({width:390,height:844});assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));assert.deepEqual(errors,[]);
 await fs.writeFile(path.join(out,'browser-check.json'),JSON.stringify({passed:true,metadata:true,photoBytesUnchanged:true,photoMimeAndExtension:true,optionalFeatures:true,reorderedReferences:{[source.articles[0].id]:3,'second-test':2},reload:true,unplacedBlocked:true,duplicateBlocked:true,mobile:true,pageErrors:errors},null,2));
 await browser.close();console.log('Cover form passed: metadata, caption, exact PNG bytes, optional features, reordered references, export/reload, invalid assignments blocked, mobile, no page errors.');
})().catch(e=>{console.error(e);process.exit(1)});
