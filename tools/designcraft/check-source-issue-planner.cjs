const {chromium}=require('/opt/codex/cua_node/lib/node_modules/playwright-core');
const fs=require('node:fs/promises');
const path=require('node:path');
const JSZip=require('jszip');
const sharp=require('sharp');

(async()=>{
 const base=process.env.REVIEW_URL||'http://127.0.0.1:8923/',output=path.resolve(process.argv[2]||'docs/designcraft-review/source-issue-planner-browser.json');
 const browser=await chromium.launch({executablePath:'/usr/bin/chromium',headless:true,args:['--no-sandbox','--disable-dev-shm-usage']});
 try{
  const page=await browser.newPage({viewport:{width:1600,height:1050}}),errors=[];
  page.setDefaultTimeout(60000);page.on('pageerror',error=>errors.push(error.message));
  await page.goto(base);
  await page.waitForFunction(()=>document.querySelectorAll('#source-issue-select option').length>1);
  await page.selectOption('#source-issue-select','issue-7-march-2025-dfcbb959');
  await page.selectOption('#source-issue-mode','artwork');
  await page.locator('#source-issue-load').click();
  await page.waitForFunction(()=>typeof plannedPages!=='undefined'&&plannedPages.length===17&&issue.sourceIssue?.mode==='artwork');
  const artwork=await page.evaluate(()=>({pages:plannedPages.length,cover:selected.sourceCover,sourcePages:plannedPages.map(p=>p.sourcePage),overviewPages:document.querySelectorAll('#source-issue-overview button').length,editable:plannedPages.filter(p=>p.sourceMode==='editable').length}));
  if(artwork.pages!==17||artwork.overviewPages!==17||!artwork.cover)throw Error('Artwork mode did not load the whole source issue.');
  process.stdout.write(JSON.stringify({stage:'artwork-loaded',pages:artwork.pages})+'\n');
  await page.selectOption('#source-issue-mode','reconstruction');await page.locator('#source-issue-load').click();
  await page.waitForFunction(()=>issue.sourceIssue?.mode==='reconstruction'&&document.getElementById('source-issue-load').disabled===false);
  const edit=await page.evaluate(()=>{const slot=selected.slots.find(s=>s.blockType==='source-text');return{slotId:slot.id,field:Object.keys(slot.fields)[0],oldText:Object.values(slot.fields)[0]};});
  await page.selectOption('#editor-slot',edit.slotId);await page.getByLabel('Source text',{exact:true}).fill('SOURCE CHECK');
  await page.getByRole('button',{name:'Open source issue page 16',exact:true}).click();
  await page.selectOption('#editor-slot','source-ad-thirsty-moose');
  const adImage=await sharp(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="720" height="1500"><rect width="720" height="1500" fill="#28624f"/><rect x="40" y="40" width="640" height="1420" fill="none" stroke="white" stroke-width="5"/><g fill="white" font-family="sans-serif" text-anchor="middle"><text x="360" y="340" font-size="62" font-weight="bold">OVER THE EDGE</text><text x="360" y="700" font-size="72" font-weight="bold">TEST AD</text><text x="360" y="830" font-size="36">Replacement artwork</text><text x="360" y="890" font-size="36">round-trip check</text></g></svg>')).png().toBuffer();
  await page.locator('#editor-slot-fields input[type="file"]').setInputFiles({name:'ote-replacement-ad.png',mimeType:'image/png',buffer:adImage});
  await page.waitForFunction(()=>selected.slots.find(slot=>slot.id==='source-ad-thirsty-moose').asset.startsWith('assets/user-'));
  const adReplacement=await page.evaluate(()=>{const slot=selected.slots.find(slot=>slot.id==='source-ad-thirsty-moose');return{page:16,slotId:slot.id,asset:slot.asset,previewAsset:slot.previewAsset};});
  if(adReplacement.asset!==adReplacement.previewAsset)throw Error('New advertisement kept the old source preview.');
  const recipeDownload=page.waitForEvent('download');await page.locator('#export-issue-plan').click();
  const recipe=await recipeDownload,recipeBytes=await fs.readFile(await recipe.path()),recipeZip=await JSZip.loadAsync(recipeBytes),sourceRecord=JSON.parse(await recipeZip.file('issue.json').async('string'));
  if(sourceRecord.layoutPlan.pages.length!==17||!Buffer.from(await recipeZip.file(adReplacement.asset).async('uint8array')).equals(adImage))throw Error('Whole source recipe omitted a page or replacement advertisement bytes.');
  await page.locator('#import-issue').setInputFiles({name:'complete-source-with-replacement.zip',mimeType:'application/zip',buffer:recipeBytes});
  await page.waitForFunction(()=>document.getElementById('import-status').textContent.includes('articles imported'));
  const reimported=await page.evaluate(()=>({pages:plannedPages.length,coverText:plannedPages[0].template.slots.some(slot=>Object.values(slot.fields||{}).includes('SOURCE CHECK')),ad:selected.slots.find(slot=>slot.id==='source-ad-thirsty-moose')}));
  if(reimported.pages!==17||!reimported.coverText||reimported.ad.asset!==adReplacement.asset||reimported.ad.previewAsset!==adReplacement.asset)throw Error('Whole issue reimport lost cover edits, pages or the new advertisement.');
  adReplacement.recipeRoundTrip=true;adReplacement.inputBytes=adImage.length;
  await page.locator('#source-issue-overview').scrollIntoViewIfNeeded();await page.screenshot({path:output.replace(/\.json$/,'-ad.png')});
  await page.getByRole('button',{name:'Open source issue page 1',exact:true}).click();
  await page.evaluate(()=>{
   const original=window.oteBrowserCompose.compose;
   window.oteBrowserCompose.compose=async mode=>{
    try{const result=await original(mode);window.wholeIssueCheck={status:result.status,message:result.message,preflight:result.preflight,coverage:result.manifest?.sourceReconstruction||result.manifest?.sourceIssue,outputs:{native:result.native?.byteLength,pdf:result.pdf?.byteLength,idml:result.idml?.byteLength}};return result;}
    catch(error){window.wholeIssueCheck={status:'error',message:error.message};throw error;}
   };
  });
  process.stdout.write(JSON.stringify({stage:'reconstruction-loaded',editedFrame:edit.slotId,advertisementRoundTrip:true})+'\n');
  await page.locator('#source-issue-generate').click();
  await page.waitForFunction(()=>!!window.wholeIssueCheck,{},{timeout:240000});
  const composition=await page.evaluate(()=>window.wholeIssueCheck);
  if(composition.status!=='completed'){
   await fs.writeFile(output,JSON.stringify({status:'failed',artwork,edit,adReplacement,composition,pageErrors:errors},null,2)+'\n');
   throw Error('Whole-issue browser composition failed: '+JSON.stringify(composition));
  }
  const downloaded=page.waitForEvent('download');await page.locator('#browser-compose-downloads a[download$=".designcraft"]').click();
  const download=await downloaded,zip=await JSZip.loadAsync(await fs.readFile(await download.path())),document=JSON.parse(await zip.file('document.json').async('string'));
  const nativePages=document.spreads.flatMap(spread=>spread.pages).length,editedText=Object.values(document.stories).some(story=>story.text==='SOURCE CHECK');
  if(nativePages!==17||!editedText)throw Error('The native issue lost pages or editable source text.');
  adReplacement.nativeEmbedded=false;for(const entry of Object.values(zip.files))if(!entry.dir&&/\.png$/i.test(entry.name)&&Buffer.from(await entry.async('uint8array')).equals(adImage))adReplacement.nativeEmbedded=true;
  if(!adReplacement.nativeEmbedded)throw Error('The native issue did not retain the uploaded advertisement artwork.');
  await page.waitForFunction(()=>document.getElementById('web-editor-status')?.textContent.includes('Document sent to DesignCraft'),{},{timeout:120000});
  const editor=await page.locator('#web-editor-status').textContent();
  await page.locator('#source-issue-overview').scrollIntoViewIfNeeded();await page.screenshot({path:output.replace(/\.json$/,'.png')});
  const report={status:'passed',artwork,edit,adReplacement,composition,nativePages,editedText,editor,pageErrors:errors};
  await fs.writeFile(output,JSON.stringify(report,null,2)+'\n');
  if(errors.length)throw Error('Browser errors: '+errors.join('; '));
  process.stdout.write(JSON.stringify({status:'passed',nativePages,editedText,adReplacement,editor,preflight:{errors:composition.preflight.errors,warnings:composition.preflight.warnings},outputs:composition.outputs,pageErrors:errors},null,2)+'\n');
 }finally{await browser.close();}
})().catch(error=>{process.stderr.write(error.stack+'\n');process.exitCode=1;});
