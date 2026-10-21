'use strict';
// Client-only composition: the headless DesignCraft engine runs in a Web Worker
// in this browser. No server, CLI or upload is involved.
async function setupBrowserCompose(){
 await plannerReady;
 let worker=null,next=1,lastVariants=[];const pending=new Map(),objectUrls=[];
 function call(type,payload={},onProgress){
  if(!worker){worker=new Worker('compiler/worker.js');worker.onmessage=({data})=>{const job=pending.get(data.id);if(!job)return;if(data.progress){job.onProgress?.(data.progress);return;}pending.delete(data.id);data.error?job.reject(Error(data.error)):job.resolve(data.result);};worker.onerror=event=>{for(const job of pending.values())job.reject(Error(event.message||'The browser composer stopped.'));pending.clear();worker=null;};}
  const id=next++;return new Promise((resolve,reject)=>{pending.set(id,{resolve,reject,onProgress});worker.postMessage({id,type,...payload},Object.values(payload).filter(v=>v instanceof ArrayBuffer));});
 }
 const element=(tag,props={},...children)=>{const n=Object.assign(document.createElement(tag),props);n.append(...children);return n;};
 const blobUrl=(bytes,type)=>{const url=URL.createObjectURL(new Blob([bytes],{type}));objectUrls.push(url);return url;};
 const clearUrls=()=>{while(objectUrls.length)URL.revokeObjectURL(objectUrls.pop());};
 const percent=v=>Math.round(v*100)+'%';
 const panel=element('section',{className:'panel browser-compose',id:'browser-compose'});
 panel.append(element('h3',{textContent:'Compose in this browser'}));
 const status=element('p',{id:'browser-compose-status',textContent:'Runs the DesignCraft engine on this device: no server, no upload. The engine (about 9 MB) downloads the first time you use it.'});status.setAttribute('role','status');panel.append(status);
 const fontLabel=element('label',{textContent:'Original fonts (optional, stay on this device) '});const fontInput=element('input',{type:'file',multiple:true,accept:'.ttf,.otf,.ttc,.otc',id:'browser-compose-fonts'});fontLabel.append(fontInput);panel.append(fontLabel);
 const designLabel=element('label',{textContent:'House design for suggested plans '}),designSelect=element('select',{id:'browser-compose-design'});designSelect.append(element('option',{value:'',textContent:'Reconstructed recipes'}),...Object.entries(library.designs||{}).map(([id,d])=>element('option',{value:id,textContent:d.name+' (original design)'})));designLabel.append(designSelect);panel.append(designLabel);
 const tightenLabel=element('label'),tighten=element('input',{type:'checkbox',id:'browser-compose-tighten',checked:true});tightenLabel.append(tighten,' Fit headline bands: a one-line headline pulls its byline up and the photo grows');panel.append(tightenLabel);
 const bookletLabel=element('label'),booklet=element('input',{type:'checkbox',id:'browser-compose-booklet'});bookletLabel.append(booklet,' Check booklet page count');panel.append(bookletLabel);
 const row=element('div',{className:'browser-compose-actions'});
 const variantsButton=element('button',{id:'browser-variants',className:'outline',textContent:'Suggest checked layouts for these stories'});
 const pageButton=element('button',{id:'browser-generate-page',className:'outline',textContent:'Generate this page (native, PDF, IDML)'});
 const issueButton=element('button',{id:'browser-generate-issue',className:'outline',textContent:'Generate saved whole issue'});
 const planButton=element('button',{id:'browser-suggest-issue',className:'outline',textContent:'Suggest a whole-issue plan'});
 row.append(variantsButton,pageButton,issueButton,planButton);panel.append(row);
 const results=element('div',{id:'browser-compose-results',className:'browser-variants'});panel.append(results);
 const downloads=element('div',{id:'browser-compose-downloads'});panel.append(downloads);
 $('export-recipe').parentElement.append(panel);
 const buttons=[variantsButton,pageButton,issueButton,planButton];
 const busy=on=>buttons.forEach(b=>b.disabled=on);
 const describe=p=>p.stage==='page'?`Composing page ${p.pageNumber} of ${p.total}…`:p.stage==='compose'?`Checking layout ${p.done}: ${p.template}…`:{assemble:'Assembling pages…',references:'Linking cover references…',preflight:'Running preflight…',export:'Exporting PDF and IDML…'}[p.stage]||'Working…';
 async function fontPayload(){const files=[...fontInput.files];return {fontProfile:files.length?'original2025':(issue.layoutPlan?.fontProfile||'portable'),fonts:await Promise.all(files.map(async f=>({name:f.name,bytes:await f.arrayBuffer()})))};}
 const toBuffer=u8=>u8.buffer.slice(u8.byteOffset,u8.byteOffset+u8.byteLength);
 const designOf=t=>t?.design||null;
 function storyLibrary(count,design){return {...library,templates:library.templates.filter(t=>t.kind==='story'&&t.storyCount===count&&designOf(t)===design).map(t=>({...copy(resolved(t)),id:t.id,name:t.name}))};}
 function offer(result,label){
  downloads.replaceChildren();const p=result.prefix,add=(bytes,name,type)=>{if(bytes)downloads.append(element('a',{href:blobUrl(bytes,type),download:name,className:'text-link',textContent:'Download '+name}),' ');};
  add(result.bundle,'ote-'+p+'-native-output.zip','application/zip');add(result.native,result.draftName||p+'.designcraft','application/zip');add(result.pdf,p+'.pdf','application/pdf');add(result.idml,p+'.idml','application/zip');
  if(result.native){const fonts=result.localFonts||[];window.dispatchEvent(new CustomEvent('ote.browser.result',{detail:{name:'ote-generated-'+p+'.designcraft',bytes:toBuffer(result.native),label,fonts}}));}
 }
 async function compose(mode){
  busy(true);clearUrls();results.replaceChildren();downloads.replaceChildren();
  try{
   status.textContent='Preparing the recipe…';const recipe=mode==='issue'?await buildIssueZip():await buildPageZip();
   const fonts=await fontPayload(),localFonts=fonts.fonts.map(f=>({name:f.name,bytes:f.bytes.slice(0)}));
   const result=await call('compile',{mode,booklet:booklet.checked,recipe:toBuffer(recipe),...fonts},p=>status.textContent=describe(p));result.localFonts??=localFonts;
   status.textContent=result.status==='completed'?`Composed in your browser with ${result.version}. Preflight passed: ${result.preflight.warnings} warning(s). Download below.`:`${result.message} Download the draft and preflight below.`;
   offer(result,mode);return result;
  }catch(error){status.textContent=error.message;throw error;}finally{busy(false);}
 }
 window.oteBrowserCompose={compose,available:true};
 pageButton.onclick=()=>compose('page').catch(()=>{});
 issueButton.onclick=()=>compose('issue').catch(()=>{});
 variantsButton.onclick=async()=>{
  busy(true);clearUrls();results.replaceChildren();downloads.replaceChildren();
  try{
   if(selected.kind!=='story')throw Error('Choose a story recipe and its articles first; covers use the cover form.');
   const ids=assignments.slice(0,selected.storyCount);
   status.textContent='Preparing the articles…';const recipe=await buildPageZip();
   const design=designOf(selected);
   const result=await call('variants',{recipe:toBuffer(recipe),library:storyLibrary(ids.length,design),articleIds:ids,design,tightenHeadlines:tighten.checked,...await fontPayload()},p=>status.textContent=describe(p));
   lastVariants=result.variants;
   status.textContent=result.variants.length?`${result.variants.length} layouts fit, checked by the native engine (${result.composed} composed from ${result.considered} candidates).`:`No layout fits these ${ids.length} stories together. Try fewer stories on this page or a continuation.`;
   result.variants.forEach((v,i)=>{
    const card=element('article',{className:'browser-variant'});
    card.append(element('img',{src:blobUrl(v.preview,'image/png'),alt:'Preview of '+v.template.name,loading:'lazy'}));
    card.append(element('strong',{textContent:(i+1)+'. '+v.template.name}));
    const facts=[`body fill ${v.fill.map(percent).join(' / ')}`];if(v.crops.length)facts.push(`photo crop ${v.crops.map(percent).join(' / ')}`);if(v.headlineSize)facts.push(`${v.headlineSize}pt headlines`);if(v.headlineFit?.some(c=>c.grownBy>0))facts.push(`${Math.max(...v.headlineFit.map(c=>c.lines))}-line headline band`);if(v.headlineFit?.some(c=>c.grownBy<0))facts.push(`photo +${Math.round(-Math.min(...v.headlineFit.map(c=>c.grownBy)))} pt from a fitted headline`);if(v.unusedPhotos)facts.push(`${v.unusedPhotos} photo(s) unused`);
    card.append(element('p',{className:'muted',textContent:facts.join(' · ')}));
    card.append(element('p',{className:'muted',textContent:'Order: '+v.articleIds.map(id=>issue.articles.find(a=>a.id===id)?.title||id).join(' → ')}));
    const use=element('button',{className:'outline',textContent:'Use this layout'});
    use.onclick=()=>{assignments.splice(0,v.articleIds.length,...v.articleIds);choose(v.template.id,v.template);status.textContent='Applied '+v.template.name+'. Save it in the issue plan or generate it.';};
    card.append(use,' ',element('a',{href:blobUrl(v.pdf,'application/pdf'),download:v.template.id+'.pdf',className:'text-link',textContent:'PDF'}));
    results.append(card);
   });
   if(result.rejected.length){const d=element('details');d.append(element('summary',{textContent:result.rejected.length+' layouts did not fit'}),element('ul',{},...result.rejected.map(r=>element('li',{textContent:r.name+': '+r.reason}))));results.append(d);}
  }catch(error){status.textContent=error.message;}finally{busy(false);}
 };
 planButton.onclick=async()=>{
  busy(true);clearUrls();results.replaceChildren();downloads.replaceChildren();
  try{
   status.textContent='Preparing the articles…';const recipe=await buildPageZip();
   const design=designSelect.value||null,inDesign=t=>designOf(t)===design;
   const candidateLibrary={...library,templates:library.templates.filter(t=>['story','cover'].includes(t.kind)&&inDesign(t)).map(t=>copy(t))};
   const planning=window.oteIssueStudio?.planningOptions?window.oteIssueStudio.planningOptions(candidateLibrary):{
    pageBudget:Number($('page-count').value)||16,existingPages:copy(plannedPages),articleFlows:copy(issue.layoutPlan?.articleFlows||{}),
    pageLibraries:Object.fromEntries(Array.from({length:Number($('page-count').value)||16},(_,i)=>[i+1,{...candidateLibrary,templates:candidateLibrary.templates.map(t=>({...copy(resolved(t)),id:t.id,name:t.name}))}])),
    reservations:Array.from({length:Number($('page-count').value)||16},(_,i)=>blocks.map(b=>({id:b.id,pageNumber:i+1,kind:b.type==='ad'?'booked-ad':'editorial',rect:[b.rect[0],b.rect[1],b.rect[2]-b.rect[0],b.rect[3]-b.rect[1]],name:b.name,assetPath:b.asset}))).flat()
   };
   const result=await call('suggestIssue',{recipe:toBuffer(recipe),library:candidateLibrary,...planning,articleIds:issue.articles.map(a=>a.id),design,tightenHeadlines:tighten.checked,...await fontPayload()},p=>status.textContent=describe(p));
   const list=element('ol');for(const p of result.pages)list.append(element('li',{textContent:`Page ${p.pageNumber}: ${p.template?.name||library.templates.find(t=>t.id===p.templateId)?.name||p.templateId} · ${p.suggestionStatus||'protected'} — ${p.articleIds.map(id=>issue.articles.find(a=>a.id===id)?.title||id).join(', ')}`}));
   results.append(element('p',{textContent:'Fixed-budget proposal. Checked single-page variants, estimated continuations and reserved pages are labelled separately; compose the whole issue before approval.'}),list);
   for(const problem of result.problems)results.append(element('p',{className:'muted',textContent:`Page ${problem.pageNumber}: ${problem.error}`}));
   const apply=element('button',{className:'outline',textContent:'Load this plan into the issue builder'});
   apply.onclick=()=>{
    plannedPages.length=0;
    for(const p of result.pages){const template=p.template||library.templates.find(t=>t.id===p.templateId);plannedPages.push(p.suggestionStatus?{...copy(p),template:copy(template),baseTemplate:copy(template),blocks:copy(p.blocks||[]),sharedFields:copy(p.sharedFields||sharedFields),controls:p.controls||Object.fromEntries(controls.map(k=>[k,$(k).value]))}:copy(p));}
    coverFeatured=[...result.featured];issue.layoutPlan={...issue.layoutPlan,articleFlows:copy(result.articleFlows||{})};if(typeof renderIssuePlan==='function')renderIssuePlan();
    status.textContent='Plan loaded. Review the cover options, then generate the whole issue.';
   };
   results.append(apply);
   status.textContent=`Proposal uses the fixed ${result.pageBudget} pages. ${result.unplaced.length} article(s) remain unplaced.`+(result.pageBudget%4?' The page budget is not a multiple of four.':'');
  }catch(error){status.textContent=error.message;}finally{busy(false);}
 };
}
setupBrowserCompose();
