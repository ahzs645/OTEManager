function validatePlacements(){
 const assigned=new Map(issue.articles.map(a=>[a.id,[]]));for(const p of plannedPages)if(p.template.kind!=='cover')for(const id of p.articleIds){if(!assigned.has(id))throw Error('Unknown article in issue plan.');assigned.get(id).push(p.id);}
 const flows=issue.layoutPlan?.articleFlows||{};
 for(const [id,chain] of assigned){const declared=flows[id]?.pageIds||[];if(!chain.length)throw Error('Place every article on an interior page: '+id);if(chain.length>1&&JSON.stringify(chain)!==JSON.stringify(declared))throw Error('Repeated articles need an explicit continuation chain in page order: '+id);if(declared.length&&JSON.stringify(chain)!==JSON.stringify(declared))throw Error('Continuation chain does not match saved page assignments: '+id);if(declared.some(pid=>plannedPages.find(p=>p.id===pid)?.mode==='preserve'))throw Error('Continuation pages must be editable: '+id);}
 for(const id of Object.keys(flows))if(!assigned.has(id))throw Error('Unknown continuation article: '+id);
}
'use strict';
let plannedPages=[];
const sourcePageMetadataKeys=['sourcePage','sourceRegion','sourceMode','role','spreadId','label','section','sourceCategory','source'];
function sourcePageMetadata(page){const metadata=Object.fromEntries(sourcePageMetadataKeys.filter(key=>page?.[key]!==undefined&&(key!=='section'||page[key]!==null&&typeof page[key]==='object'&&!Array.isArray(page[key]))).map(key=>[key,copy(page[key])]));if(typeof page?.section==='string')metadata.sourceCategory=page.section;return metadata;}
function syncSourceIssueArticles(){
 if(!issue.sourceIssue&&!issue.sourceIssueReference)return;
 const available=typeof candidateArticles==='function'?candidateArticles():issue.articles,ids=new Set(plannedPages.flatMap(page=>page.articleIds));
 issue.articlePool=available.filter(article=>!ids.has(article.id)).map(copy);
 issue.articles=available.filter(article=>ids.has(article.id)).map(copy);
}
function editIssuePage(id,{saveCurrent=false}={}){
 if(saveCurrent&&(issue.sourceIssue||issue.sourceIssueReference)&&selected&&plannedPages.some(page=>page.pageNumber===Number($('page-number').value))&&!saveIssuePage())return false;
 const p=typeof id==='string'?plannedPages.find(page=>page.id===id):id;if(!p)return false;
 blocks=copy(p.blocks||[]);sharedFields=copy(p.sharedFields||{});assignments=[...p.articleIds];
 for(const [key,value] of Object.entries(p.controls||{}))if($(key)&&!coverControlIds.includes(key))$(key).value=value;
 if(p.template.kind==='cover')coverFeatured=p.template.sourceCover?[]:[...p.articleIds];
 $('page-number').value=p.pageNumber;$('preserve-page').checked=p.mode==='preserve';
 const base=baseFromSaved(p);
 if(!library.templates.some(t=>t.id===base.id)){library.templates.push(copy(base));const option=document.createElement('option');option.value=base.id;option.textContent=base.name||base.id;$('selected-template').append(option);}
 choose(base.id,base);renderBlocks();return true;
}
function renderIssuePlan(){
 for(const flow of Object.values(issue.layoutPlan?.articleFlows||{})){const ids=flow.pageIds||[];if(ids.every(id=>plannedPages.some(p=>p.id===id)))flow.pageIds=plannedPages.filter(p=>ids.includes(p.id)).map(p=>p.id);}
 const root=$('issue-pages');root.replaceChildren();
 plannedPages.forEach((p,index)=>{
  p.pageNumber=index+1;
  const row=document.createElement('div'),label=document.createElement('span');
  label.textContent=p.pageNumber+' · '+(p.label||p.template.name)+(p.sourceMode?' · '+(p.sourceMode==='artwork'?'source artwork':p.sourceMode):'')+(p.mode==='preserve'?' · preserve':'');row.append(label);
  const button=(name,action)=>{const b=document.createElement('button');b.textContent=name;b.onclick=action;row.append(b);};
  button('Edit',()=>editIssuePage(p.id,{saveCurrent:!!(issue.sourceIssue||issue.sourceIssueReference)}));
  if(!issue.sourceIssue&&index&&p.template.kind!=='cover'&&plannedPages[index-1].template.kind!=='cover')button('Move up',()=>{
   const active=plannedPages.find(page=>page.pageNumber===Number($('page-number').value))?.id;
   if(issue.sourceIssueReference&&!saveIssuePage())return;
   const position=plannedPages.findIndex(page=>page.id===p.id);[plannedPages[position-1],plannedPages[position]]=[plannedPages[position],plannedPages[position-1]];
   renderIssuePlan();if(issue.sourceIssueReference&&active)editIssuePage(active);else renderPage();
  });
  if(!issue.sourceIssue)button('Remove',()=>{
   const active=plannedPages.find(page=>page.pageNumber===Number($('page-number').value))?.id;
   if(issue.sourceIssueReference&&!saveIssuePage())return;
   const position=plannedPages.findIndex(page=>page.id===p.id);plannedPages.splice(position,1);syncSourceIssueArticles();renderIssuePlan();
   if(issue.sourceIssueReference&&plannedPages.length)editIssuePage(plannedPages.find(page=>page.id===active)?.id||plannedPages[Math.min(position,plannedPages.length-1)].id);else renderPage();
  });root.append(row);
 });
 if(typeof renderFlowEditor==='function')renderFlowEditor();
 if(typeof renderSourceIssueOverview==='function')renderSourceIssueOverview();
}
function saveIssuePage(){try{
 const n=Number($('page-number').value),template=resolved(selected),count=template.kind==='cover'?(template.sourceCover?0:coverFeatured.filter(Boolean).length):template.storyCount||0;
 if(!Number.isInteger(n)||n<1||n>plannedPages.length+1)throw Error('Add consecutive pages, starting at 1, or edit an existing page number.');
 if(template.kind==='cover'&&n!==1)throw Error('The front cover must be page 1.');
 if(n===1&&template.kind!=='cover'&&plannedPages[0]?.template.kind==='cover')throw Error('Keep the front cover on page 1.');
 const articleIds=template.kind==='cover'?(template.sourceCover?[]:coverFeatured.filter(Boolean)):assignments.slice(0,count);
 if(articleIds.length!==count||new Set(articleIds).size!==count)throw Error('Select a distinct article for every slot.');
 const previous=plannedPages[n-1],id=previous?.id||'page-'+crypto.randomUUID(),metadata=sourcePageMetadata(previous);
 if(previous?.sourcePage&&(previous.baseTemplate?.id||previous.templateId)!==selected.id)metadata.sourceMode=template.sourceMode||(template.source?.mode==='artwork'?'artwork':'editable');
 plannedPages[n-1]={...metadata,id,pageNumber:n,templateId:template.id,articleIds,mode:$('preserve-page').checked?'preserve':'replace',template,baseTemplate:copy(selected),blocks:copy(blocks),sharedFields:copy(sharedFields),controls:Object.fromEntries(controls.map(k=>[k,$(k).value]))};
 syncSourceIssueArticles();
 renderIssuePlan();$('issue-plan-status').textContent='Page saved. '+plannedPages.length+' pages in the issue plan.';renderPage();
 return true;
 }catch(e){$('issue-plan-status').textContent=e.message;return false;}}
async function buildIssueZip(){
 if(!plannedPages.length)throw Error('Save the issue pages first.');
 validatePlacements();
 const data=issueWithCover(),templates=[];requireMedia(data);const coverPage=plannedPages.find(p=>p.template.kind==='cover');if(coverPage)validateFeatured(coverPage.articleIds);
 data.layoutPlan={...data.layoutPlan,blocks:{},pages:plannedPages.map(p=>{const tid='planned-'+p.id;templates.push({... (p.template.kind==='cover'?applyCover(p.template,p.articleIds):copy(p.template)),id:tid});return {...sourcePageMetadata(p),id:p.id,pageNumber:p.pageNumber,templateId:tid,kind:p.template.kind,articleIds:p.articleIds,mode:p.mode};})};
 const cover=plannedPages.find(p=>p.template.kind==='cover'),centre=plannedPages.slice(plannedPages.length/2-1,plannedPages.length/2+1);
 data.layoutPlan.cover.mode=cover?.mode==='preserve'?'preserve':'editable';data.layoutPlan.cover.articleIds=cover?.articleIds||[];
 data.layoutPlan.truck={mode:plannedPages.length%2===0&&centre.length===2&&centre.every(p=>p.mode==='preserve')?'preserve':'editable',pageIds:centre.map(p=>p.id)};
 const zip=new JSZip();zip.file('issue.json',JSON.stringify(data,null,2));zip.file('templates.json',JSON.stringify({...library,templates},null,2));
 zip.file('page-plan.json',JSON.stringify({schemaVersion:'ote.designcraft.plan.v1',templateId:selected.id,articleIds:assignments,baseTemplate:copy(selected),blocks,sharedFields,controls:Object.fromEntries(controls.map(k=>[k,$(k).value])),savedPages:plannedPages,issueBundle:data},null,2));
 for(const [path,content] of bytes)zip.file(path,content);
 for(const a of data.articles)for(const p of a.photos)if(!bytes.has(p.path))throw Error('Import the issue ZIP to include original media: '+p.path);
 for(const path of ['assets/ote-horizontal-logo.png','assets/ote-stacked-logo.pdf']){const r=await fetch(path);if(!r.ok)throw Error('Brand asset unavailable');zip.file(path,await r.arrayBuffer());}
 await addCoverMedia(zip);await addDesignArt(zip,templates);
 zip.file('README.txt','Extract this recipe and the template toolkit into separate folders. Run npm install in the toolkit root using Node.js 24. From this recipe folder, run:\n\nnode /path/to/kit/tools/designcraft/compile.mjs --library templates.json --issue issue.json --output output\n\nThe shared JavaScript compiler uses the bundled WebAssembly engine and checks the complete issue. Source issue recipes retain every original page and recorded spread; --booklet is an optional multiple-of-four check, not source-page padding. Original fonts can be supplied with --font-dir /path/to/private/fonts --font-profile original2025.\n\nLegacy Python/native CLI preservation needs a matching native base and recipes supported by that compiler; see the toolkit guide. Import this ZIP in the planner to resume editing. Preflight blocks final output when copy oversets. Adobe InDesign and press proof approval remain separate.\n');
 return zip.generateAsync({type:'uint8array',compression:'DEFLATE'});
}
async function exportIssuePlan(){try{if((issue.sourceIssue||issue.sourceIssueReference)&&!saveIssuePage())return;save('ote-whole-issue-recipe.zip',await buildIssueZip(),'application/zip');$('issue-plan-status').textContent='Whole issue recipe saved with full text, media and stable page IDs.';}catch(e){$('issue-plan-status').textContent=e.message;}}
$('save-issue-page').onclick=saveIssuePage;$('export-issue-plan').onclick=exportIssuePlan;
