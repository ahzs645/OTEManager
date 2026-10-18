// Client-only check: the actual static planner with no server composer, the
// committed headless engine in a Web Worker, and the official web editor.
// Serve public/ (e.g. `python3 -m http.server 8903 --directory public`) and run:
//   REVIEW_URL=http://127.0.0.1:8903 node tools/designcraft/check-browser-compose.cjs
const {chromium}=require(process.env.REVIEW_PLAYWRIGHT_MODULE||'/opt/node-tools/node_modules/playwright-core');
const JSZip=require('jszip');const fs=require('node:fs/promises');const path=require('node:path');const assert=require('node:assert/strict');
const root=path.resolve(__dirname,'../..'),fixture=path.join(root,'tests/fixtures/designcraft-march-2025');
const base=process.env.REVIEW_URL||'http://127.0.0.1:8903',out=process.env.OTE_BROWSER_QA_DIR||path.join(require('node:os').tmpdir(),'ote-browser-compose');
const waitStatus=(page,id,test,timeout=240000)=>page.waitForFunction(([id,source])=>new RegExp(source).test(document.getElementById(id).textContent),[id,test.source],{timeout});
(async()=>{
 await fs.mkdir(out,{recursive:true});
 const issue=JSON.parse(await fs.readFile(path.join(fixture,'issue.json'),'utf8'));
 const zip=new JSZip();zip.file('issue.json',JSON.stringify({...issue,layoutPlan:{pages:[]}}));
 for(const a of issue.articles)for(const p of a.photos)zip.file(p.path,await fs.readFile(path.join(fixture,p.path)));
 const bundle=await zip.generateAsync({type:'nodebuffer'});
 const browser=await chromium.launch({executablePath:process.env.REVIEW_CHROMIUM||'/opt/pw-browsers/chromium',args:['--no-sandbox']});
 const report={passed:false,serverComposer:'absent',engine:null,timingsMs:{}};
 try{
  const page=await browser.newPage({viewport:{width:1440,height:1100},acceptDownloads:true}),errors=[];
  page.on('pageerror',e=>errors.push(e.message));page.on('console',m=>{if(m.type()==='error'&&!/api\/designcraft\/native|404/.test(m.text()))errors.push(m.text());});
  await page.goto(base+'/designcraft/index.html');await page.waitForSelector('#browser-variants');
  await waitStatus(page,'native-export-mode',/./,1).catch(()=>{});
  await page.locator('#import-issue').setInputFiles({name:'ote-march-2025.zip',mimeType:'application/zip',buffer:bundle});
  await waitStatus(page,'import-status',/imported/i,60000);
  // 1. Variants for two real articles on one page
  await page.evaluate(()=>{choose('story-2-two-top-columns');assignments.splice(0,2,'march-cfur-carbon-capture','march-cn-centre-30');renderAssignments();renderPage();});
  let t=Date.now();await page.locator('#browser-variants').click();
  await waitStatus(page,'browser-compose-status',/layouts fit|No layout fits/);report.timingsMs.variantsIncludingEngineLoad=Date.now()-t;
  const cards=await page.locator('.browser-variant').count();assert(cards>0,'no variants rendered');report.variants=cards;
  report.variantStatus=await page.locator('#browser-compose-status').textContent();
  assert(await page.locator('.browser-variant img').first().evaluate(img=>img.complete&&img.naturalWidth>100));
  await page.locator('#browser-compose').screenshot({path:path.join(out,'variants.png')});
  await page.locator('.browser-variant button').first().click();
  report.appliedTemplate=await page.evaluate(()=>selected.id);assert.notEqual(report.appliedTemplate,'story-2-two-top-columns');
  // 2. Generate the chosen page entirely in the browser
  t=Date.now();await page.locator('#browser-generate-page').click();
  await waitStatus(page,'browser-compose-status',/Composed in your browser|failed|errors/);report.timingsMs.page=Date.now()-t;
  report.pageStatus=await page.locator('#browser-compose-status').textContent();assert.match(report.pageStatus,/Composed in your browser/);
  const pdfHead=await page.evaluate(async()=>{const a=[...document.querySelectorAll('#browser-compose-downloads a')].find(x=>x.download==='page.pdf');return new TextDecoder().decode((await (await fetch(a.href)).arrayBuffer()).slice(0,5));});assert.equal(pdfHead,'%PDF-');
  report.engine=report.pageStatus.match(/designcraft-headless [^.]+\.[^.]+\.\d+ \(WebAssembly\)/)?.[0];
  // 3. Suggest a whole issue, load it, generate it
  t=Date.now();await page.locator('#browser-suggest-issue').click();
  await waitStatus(page,'browser-compose-status',/Plan for \d+ pages/);report.timingsMs.issueSuggestion=Date.now()-t;
  report.suggestedPlan=await page.locator('#browser-compose-results ol').textContent();
  await page.locator('#browser-compose-results button',{hasText:'Load this plan'}).click();
  report.plannedPages=await page.evaluate(()=>plannedPages.length);assert(report.plannedPages>=2);
  t=Date.now();await page.locator('#browser-generate-issue').click();
  await waitStatus(page,'browser-compose-status',/Composed in your browser|failed|errors|needs/);report.timingsMs.issue=Date.now()-t;
  report.issueStatus=await page.locator('#browser-compose-status').textContent();assert.match(report.issueStatus,/Composed in your browser/);
  const download=page.waitForEvent('download');await page.locator('#browser-compose-downloads a',{hasText:'native-output.zip'}).click();
  const file=path.join(out,'ote-issue-native-output.zip');await (await download).saveAs(file);
  const output=await JSZip.loadAsync(await fs.readFile(file));report.bundleFiles=Object.keys(output.files).filter(n=>!n.startsWith('recipe/')&&!n.startsWith('Document Fonts/'));
  for(const name of ['issue.designcraft','issue.pdf','issue.idml','build-manifest.json','preflight.json'])assert(output.file(name),name+' missing');
  const manifest=JSON.parse(await output.file('build-manifest.json').async('string'));report.issuePreflight=manifest.preflight;assert.equal(manifest.preflight.errors,0);
  await fs.writeFile(path.join(out,'issue.pdf'),await output.file('issue.pdf').async('nodebuffer'));
  // 4. Open the browser-composed issue in the bundled web editor
  assert(!(await page.locator('#build-open-web-editor').isDisabled()),'web-editor build should use the browser composer');
  await page.locator('#open-generated-web-editor').click();
  await waitStatus(page,'web-editor-status',/^Document sent/,180000);await page.waitForTimeout(2000);
  await page.frameLocator('#web-editor-frame').locator('#designcraft_canvas').screenshot({path:path.join(out,'web-editor.png')});
  report.pageErrors=errors;assert.equal(errors.length,0,errors.join('\n'));report.passed=true;
 }finally{await fs.writeFile(path.join(out,'results.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,1));await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
