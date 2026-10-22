// Real Chromium check of source selection, recurring-field editing, recipe
// round-trip and client-only native composition. Run against a static studio.
const {chromium}=require('/opt/codex/cua_node/lib/node_modules/playwright-core');
const fs=require('node:fs/promises');
const path=require('node:path');
const JSZip=require('jszip');

(async()=>{
 const base=process.env.REVIEW_URL||'http://127.0.0.1:8923/';
 const output=path.resolve(process.argv[2]||'docs/designcraft-review/source-planner-browser.json');
 const browser=await chromium.launch({executablePath:'/usr/bin/chromium',headless:true,args:['--no-sandbox']});
 try{
  const page=await browser.newPage({viewport:{width:1600,height:1050}}),errors=[];
  page.on('pageerror',error=>errors.push(error.message));
  await page.goto(base+'?workspace=1');
  await page.waitForSelector('#source-page-preset');
  await page.selectOption('#source-page-preset','source-2024-president-qa');
  await page.getByRole('button',{name:'Use source page layout',exact:true}).click();
  const question='How can students share ideas?';
  const answer='Send your questions to the newspaper.';
  await page.getByLabel('Question of the month',{exact:true}).fill(question);
  await page.getByLabel('President’s answer',{exact:true}).fill(answer);
  await page.selectOption('#source-section-preset','president-qa');
  await page.getByRole('button',{name:'Save page in issue plan',exact:true}).click();
  const downloaded=page.waitForEvent('download');
  await page.getByRole('button',{name:'Download page recipe ↗',exact:true}).click();
  const download=await downloaded,zip=await JSZip.loadAsync(await fs.readFile(await download.path()));
  const plan=JSON.parse(await zip.file('page-plan.json').async('string'));
  if(plan.baseTemplate.slots.find(s=>s.fields?.answer)?.fields.answer!==answer)throw Error('Edited source answer missing from exported recipe.');
  const sourceAssets=Object.keys(zip.files).filter(name=>name.startsWith('source-art/'));
  if(!sourceAssets.some(name=>name.endsWith('.pdf'))||!sourceAssets.some(name=>name.endsWith('.png')))throw Error('Recipe omitted portable source artwork.');
  await page.locator('#import-issue').setInputFiles({name:'source-roundtrip.zip',mimeType:'application/zip',buffer:Buffer.from(await zip.generateAsync({type:'uint8array'}))});
  await page.waitForFunction(()=>document.getElementById('import-status').textContent.includes('articles imported'));
  const roundtrip=await page.evaluate(()=>({answer:selected.slots.find(s=>s.fields?.answer)?.fields.answer,section:selected.section,savedPages:plannedPages.length}));
  if(roundtrip.answer!==answer||roundtrip.section.label!=='President question of the month'||roundtrip.savedPages!==1)throw Error('Source recipe round-trip lost content or section.');
  const composed=await page.evaluate(async()=>{const result=await window.oteBrowserCompose.compose('page');return{status:result.status,preflight:result.preflight,version:result.version,outputs:{native:result.native?.byteLength,pdf:result.pdf?.byteLength,idml:result.idml?.byteLength}};});
  if(composed.status!=='completed'||composed.preflight.errors)throw Error('Browser source Q&A composition did not pass preflight: '+JSON.stringify(composed));
  await page.screenshot({path:output.replace(/\.json$/,'-fields.png')});
  await page.locator('#source-options').scrollIntoViewIfNeeded();
  await page.screenshot({path:output.replace(/\.json$/,'.png')});
  const report={status:'passed',base,roundtrip,sourceAssets,composed,pageErrors:errors};
  if(errors.length)throw Error('Browser errors: '+errors.join('; '));
  await fs.writeFile(output,JSON.stringify(report,null,2)+'\n');
  process.stdout.write(JSON.stringify({status:report.status,roundtrip,sourceAssets,outputs:composed.outputs,preflight:{errors:composed.preflight.errors,warnings:composed.preflight.warnings},pageErrors:errors},null,2)+'\n');
 }finally{await browser.close();}
})().catch(error=>{process.stderr.write(error.stack+'\n');process.exitCode=1;});
