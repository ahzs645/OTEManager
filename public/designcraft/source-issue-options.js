'use strict';

let sourceIssuesCatalogue=null;
const sourceWorkspaceHistory=[];
const sourceMime=path=>/\.pdf$/i.test(path)?'application/pdf':/\.png$/i.test(path)?'image/png':/\.webp$/i.test(path)?'image/webp':'image/jpeg';

function sourceWorkspaceSnapshot(){
 return {library:copy(library),issue:copy(issue),pages:copy(plannedPages),selected:copy(selected),templatePicker:$('selected-template').value,blocks:copy(blocks),fields:copy(sharedFields),assignments:[...assignments],featured:[...coverFeatured],media:[...bytes.entries()],heroBytes,heroMime,heroPath,controls:Object.fromEntries(controls.map(id=>[id,$(id).value])),booklet:Object.fromEntries(['browser-compose-booklet','native-export-booklet'].filter(id=>$(id)).map(id=>[id,$(id).checked])),preserve:$('preserve-page').checked,fitTitles:$('cover-fit-titles').checked};
}
function restoreSourceWorkspace(){
 const previous=sourceWorkspaceHistory.pop();if(!previous)return;
 clearMedia();library=previous.library;issue=previous.issue;plannedPages=previous.pages;blocks=previous.blocks;sharedFields=previous.fields;assignments=previous.assignments;coverFeatured=previous.featured;
 $('selected-template').replaceChildren();for(const template of library.templates)$('selected-template').append(editorNode('option',{value:template.id},template.name));
 for(const [path,data] of previous.media){bytes.set(path,data);urls.set(path,URL.createObjectURL(new Blob([data],{type:sourceMime(path)})));}
 for(const [id,value] of Object.entries(previous.controls))$(id).value=value;
 for(const [id,value] of Object.entries(previous.booklet||{}))if($(id))$(id).checked=value;
 heroBytes=previous.heroBytes;heroMime=previous.heroMime;heroPath=previous.heroPath;if(heroBytes)heroUrl=URL.createObjectURL(new Blob([heroBytes],{type:heroMime}));
 $('preserve-page').checked=previous.preserve;$('cover-fit-titles').checked=previous.fitTitles;
 renderIssuePlan();choose(previous.templatePicker||previous.selected.id,previous.selected);renderBlocks();renderSourceIssueOverview();
 $('source-issue-status').textContent='Previous workspace restored, including unsaved page edits and imported photographs.';
 $('source-issue-restore').disabled=!sourceWorkspaceHistory.length;
}
async function sourceJson(path){validateMediaPath(path);const response=await fetch(path);if(!response.ok)throw Error('Source issue file unavailable: '+path);return response.json();}
async function sourceBytes(path){validateMediaPath(path);const response=await fetch(path);if(!response.ok)throw Error('Source artwork unavailable: '+path);return new Uint8Array(await response.arrayBuffer());}
function sourceIssueEntry(){const reference=issue.sourceIssue||issue.sourceIssueReference;return sourceIssuesCatalogue?.issues?.find(entry=>entry.documentId===reference?.documentId||entry.id===reference?.id);}
function useSourceAsNewIssue(){
 if(!issue.sourceIssue){$('source-issue-status').textContent='Load a complete source issue first.';return;}
 if(!saveIssuePage())return;
 sourceWorkspaceHistory.push(sourceWorkspaceSnapshot());issue.sourceIssueReference=copy(issue.sourceIssue);delete issue.sourceIssue;
 issue.issue={...issue.issue,id:'new-'+crypto.randomUUID(),title:'New issue from '+(sourceIssueEntry()?.label||issue.issue?.title||'source issue')};
 renderIssuePlan();renderSourceIssueOverview();$('source-issue-restore').disabled=false;
 $('source-issue-status').textContent='New issue copy created. You can add, remove and reorder pages. Source cover dates, teaser page numbers and other printed source text stay fixed until edited; update those frames after changing the issue.';
}

async function loadCompleteSourceIssue(id,mode='artwork'){
 const entry=sourceIssuesCatalogue?.issues?.find(candidate=>candidate.id===id),status=$('source-issue-status');
 if(!entry||!entry.modes?.[mode])throw Error('Choose a complete source issue and recreation mode.');
 status.textContent='Loading every page of '+entry.label+'…';
 const selection=entry.modes[mode],[nextIssue,sourceLibrary]=await Promise.all([sourceJson(selection.issue),sourceJson(selection.library)]);
 validateIssue(nextIssue);
 const pageDefinitions=nextIssue.layoutPlan?.pages;
 if(!Array.isArray(pageDefinitions)||pageDefinitions.length!==entry.pageCount||pageDefinitions.some((page,index)=>page.pageNumber!==index+1))throw Error('The source issue must retain every page in its original order.');
 const templateMap=new Map(sourceLibrary.templates?.map(template=>[template.id,template]));
 const pages=pageDefinitions.map(page=>{
  const template=templateMap.get(page.templateId);if(!template||!Array.isArray(template.slots))throw Error('Missing source page layout: '+page.templateId);
  const original=entry.pages.find(candidate=>candidate.pageNumber===page.pageNumber);
  return {...sourcePageMetadata(original),...copy(page),mode:'replace',template:copy(template),baseTemplate:copy(template),blocks:[],sharedFields:{},controls:{'page-number':String(page.pageNumber)}};
 });
 if(!nextIssue.sourceIssue)throw Error('The complete source issue needs its page coverage record.');
 const keep=$('source-issue-keep-articles').checked&&issue.issue?.id!=='demo',pool=keep?candidateArticles():[],media=new Map(keep?[...bytes.entries()]:[]);
 const activeIds=new Set(nextIssue.articles.map(article=>article.id));
 nextIssue.articlePool=[...(nextIssue.articlePool||[]),...pool].filter((article,index,all)=>!activeIds.has(article.id)&&all.findIndex(candidate=>candidate.id===article.id)===index).map(copy);
 for(const article of nextIssue.articles)for(const photo of article.photos){if(!media.has(photo.path))media.set(photo.path,await sourceBytes(photo.path));}
 const coverPath=nextIssue.layoutPlan?.cover?.photoPath,coverBytes=coverPath?media.get(coverPath)||await sourceBytes(coverPath):null;
 // Nothing in the current workspace changes until the full issue and its linked
 // article media have been checked. One action restores the previous workspace.
 sourceWorkspaceHistory.push(sourceWorkspaceSnapshot());
 clearMedia();
 const knownSources=new Set(sourceIssuesCatalogue.issues.map(candidate=>candidate.documentId));
 const baseline=library.templates.filter(template=>!(template.id.startsWith('whole-')&&knownSources.has(template.source?.documentId)));
 const templates=new Map(baseline.map(template=>[template.id,template]));for(const template of sourceLibrary.templates)templates.set(template.id,template);
 library={...library,designs:{...library.designs,...(sourceLibrary.designs||{})},templates:[...templates.values()]};
 $('selected-template').replaceChildren();for(const template of library.templates)$('selected-template').append(editorNode('option',{value:template.id},template.name));
 issue=nextIssue;plannedPages=pages;blocks=[];sharedFields={};assignments=[...pages[0].articleIds];coverFeatured=[];
 for(const [path,data] of media){bytes.set(path,data);urls.set(path,URL.createObjectURL(new Blob([data],{type:sourceMime(path)})));}
 restoreCover(issue,coverBytes);$('page-count').value=String(pages.length);$('preserve-page').checked=false;
 for(const id of ['browser-compose-booklet','native-export-booklet'])if($(id))$(id).checked=false;
 renderIssuePlan();editIssuePage(pages[0].id);renderBlocks();renderSourceIssueOverview();
 $('source-issue-restore').disabled=false;
 const unknownDate=!issue.issue?.date;
 status.textContent=`Loaded all ${pages.length} pages, including the cover, fixed sections, ad pages and original page order. ${mode==='artwork'?'Original artwork is preserved as placed pages.':'Source text is editable where the page record indicates reconstruction.'}${unknownDate?' The release date is not established; the printed source metadata stays intact.':''}`;
 $('import-status').textContent=`Complete source issue loaded · ${pages.length} pages · ${issue.articles.length} assigned articles · ${issue.articlePool.length} replacement articles available.`;
 return {pages:pages.length,mode,documentId:entry.documentId};
}

function renderSourceIssueOverview(){
 let root=$('source-issue-overview');
 const reference=issue.sourceIssue||issue.sourceIssueReference;
 if(!root){if(!reference)return;root=editorNode('section',{id:'source-issue-overview',className:'source-issue-overview'});$('page-preview').before(root);}
 root.hidden=!reference;if(!reference)return;
 const entry=sourceIssueEntry(),current=Number($('page-number').value),editable=plannedPages.filter(page=>page.sourceMode==='editable').length,blanks=plannedPages.filter(page=>page.sourceMode==='blank'||page.role==='blank').length;
 root.replaceChildren(editorNode('h3',{},(issue.sourceIssueReference?'New issue from ':'')+(entry?.label||issue.issue?.title||'Source issue')+' · '+plannedPages.length+' pages'));
 root.append(editorNode('p',{className:'muted'},`${editable} pages with editable source text · ${plannedPages.length-editable-blanks} artwork pages · ${blanks} blank pages. ${issue.sourceIssue?'Original order and '+(reference.spreads||entry?.spreads||[]).length+' recorded spread(s) retained.':'Page order is unlocked. Edit printed source dates and cover page references after changing the issue.'}`));
 const strip=editorNode('div',{className:'source-issue-pages'});strip.setAttribute('aria-label','All source issue pages');
 for(const page of plannedPages){
  const card=editorNode('button',{type:'button',className:'source-issue-page'+(page.pageNumber===current?' active':''),'aria-label':'Open source issue page '+page.pageNumber});
  const original=entry?.pages?.find(candidate=>candidate.pageNumber===page.pageNumber),artwork=library.templates.find(template=>template.id===original?.artworkTemplateId),preview=page.previewAsset||artwork?.slots?.find(slot=>slot.previewAsset)?.previewAsset||page.template.slots.find(slot=>slot.previewAsset)?.previewAsset;
  if(preview){const url=mediaPreviewUrl(preview);if(url)card.append(editorNode('img',{src:url,alt:'',loading:'lazy'}));}
  card.append(editorNode('strong',{},'Page '+page.pageNumber),editorNode('span',{},page.label||page.role||page.template.name),editorNode('small',{},page.sourceMode==='artwork'?'Placed original artwork':page.sourceMode==='blank'?'Original blank page':'Editable source text'));
  if(page.spreadId)card.append(editorNode('small',{},'Part of spread'));
  card.onclick=()=>editIssuePage(page.id,{saveCurrent:true});strip.append(card);
 }
 root.append(strip);
 if(entry?.pdf){const reference=editorNode('a',{href:entry.pdf,target:'_blank',rel:'noopener',className:'text-link'},'Open the complete original PDF ↗');root.append(reference);}
}

async function importSourceReplacementArticles(file){
 if(!file)return;if(!issue.sourceIssue&&!issue.sourceIssueReference)throw Error('Load a complete source issue before adding replacement articles.');
 let incoming,archive;
 if(file.name.toLowerCase().endsWith('.zip')){archive=await JSZip.loadAsync(file);const record=archive.file('issue.json');if(!record)throw Error('The replacement ZIP needs issue.json.');incoming=JSON.parse(await record.async('string'));}
 else incoming=JSON.parse(await file.text());
 validateIssue(incoming);const staged=[],media=new Map(),remapped=new Map();
 for(const original of [...incoming.articles,...(incoming.articlePool||[])]){
  const article={...copy(original),id:'replacement-'+crypto.randomUUID(),sourceArticleId:original.id};
  for(const photo of article.photos){
   validateMediaPath(photo.path);const entry=archive?.file(photo.path);if(!entry)throw Error('Use the exported OTE issue ZIP to include replacement photographs: '+photo.path);
   const old=photo.path;let path=remapped.get(old);
   if(!path){const suffix=/\.[a-z0-9]{1,8}$/i.exec(old)?.[0]||'.jpg';path='assets/user-replacement-'+crypto.randomUUID()+suffix;media.set(path,await entry.async('uint8array'));remapped.set(old,path);}
   photo.path=path;
  }
  staged.push(article);
 }
 issue.articlePool||=[];issue.articlePool.push(...staged);
 for(const [path,data] of media){bytes.set(path,data);urls.set(path,URL.createObjectURL(new Blob([data],{type:sourceMime(path)})));}
 renderAssignments();$('source-issue-status').textContent=staged.length+' replacement articles imported. Open a page, choose an article recipe, assign the replacement and save the page. All other source pages stay in place.';
 return staged.length;
}

async function setupSourceIssueOptions(){
 await plannerReady;if(!library)return;
 const panel=editorNode('details',{id:'source-issue-options',open:true});panel.append(editorNode('summary',{},'Recreate a complete issue'));
 const status=editorNode('p',{id:'source-issue-status',className:'muted'},'Loading the complete issue catalogue…');status.setAttribute('role','status');panel.append(status);
 const select=editorNode('select',{id:'source-issue-select'});select.append(editorNode('option',{value:''},'Choose an original issue'));editorLabel(panel,'Original issue',select);
 const mode=editorNode('select',{id:'source-issue-mode'});mode.append(editorNode('option',{value:'artwork'},'Original pages · placed artwork'),editorNode('option',{value:'reconstruction'},'Reconstruction · editable source text'));editorLabel(panel,'Recreation mode',mode);
 panel.append(editorNode('p',{className:'muted'},'Artwork mode preserves the original pages as placed graphics. Reconstruction rebuilds source text as native frames and retains source graphics. Both modes keep the complete issue.'));
 const keep=editorNode('input',{id:'source-issue-keep-articles',type:'checkbox',checked:true});const keepLabel=editorNode('label',{className:'source-issue-toggle'});keepLabel.append(keep,' Keep my current articles available as replacements');panel.append(keepLabel);
 const load=editorNode('button',{id:'source-issue-load',type:'button',className:'outline'},'Load the complete issue');panel.append(load);
 const generate=editorNode('button',{id:'source-issue-generate',type:'button',className:'button'},'Generate complete issue and open editor');panel.append(generate);
 const detach=editorNode('button',{id:'source-issue-detach',type:'button',className:'outline'},'Use this as a new issue');detach.onclick=useSourceAsNewIssue;panel.append(detach);
 const restore=editorNode('button',{id:'source-issue-restore',type:'button',className:'outline',disabled:true},'Restore previous workspace');restore.onclick=restoreSourceWorkspace;panel.append(restore);
 const replacement=editorNode('input',{id:'source-issue-replacements',type:'file',accept:'.zip,.json'});editorLabel(panel,'Import replacement OTE articles',replacement);
 replacement.onchange=()=>importSourceReplacementArticles(replacement.files[0]).catch(error=>status.textContent=error.message);
 panel.append(editorNode('p',{className:'muted'},'Loading keeps a device-memory snapshot of your current work. Download its recipe before closing this tab to keep it permanently. The source page overview preserves blank pages and spread partners; it does not add print padding.'));
 const controlsRoot=document.querySelector('.planner-controls');controlsRoot.prepend(panel);
 load.onclick=async()=>{load.disabled=true;try{await loadCompleteSourceIssue(select.value,mode.value);}catch(error){status.textContent=error.message;}finally{load.disabled=false;}};
 generate.onclick=async()=>{
  if(!issue.sourceIssue&&!issue.sourceIssueReference){status.textContent='Load a complete source issue first.';return;}
  if(!saveIssuePage()){status.textContent=$('issue-plan-status').textContent;return;}
  generate.disabled=true;try{
   status.textContent='Generating all '+plannedPages.length+' pages and checking the complete issue…';
   const result=await window.oteBrowserCompose.compose('issue');
   if(result.status!=='completed'){status.textContent=result.message||'The complete issue has layout errors. Review the preflight report before exporting.';return;}
   $('open-generated-web-editor')?.click();status.textContent='Complete issue generated. The native document, PDF and IDML are available; edit the full document in DesignCraft.';
  }catch(error){status.textContent=error.message;}finally{generate.disabled=false;}
 };
 try{sourceIssuesCatalogue=await sourceJson('source-issues.json');for(const entry of sourceIssuesCatalogue.issues||[])select.append(editorNode('option',{value:entry.id},entry.label+' · '+entry.pageCount+' pages'));status.textContent='Load every source page in one step, then review the complete page overview and generate the whole issue.';renderSourceIssueOverview();}
 catch(error){status.textContent=error.message;load.disabled=true;}
}
setupSourceIssueOptions();
