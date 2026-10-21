function validatePlacements(){
 const assigned=new Map(issue.articles.map(a=>[a.id,[]]));for(const p of plannedPages)if(p.template.kind!=='cover')for(const id of p.articleIds){if(!assigned.has(id))throw Error('Unknown article in issue plan.');assigned.get(id).push(p.id);}
 const flows=issue.layoutPlan?.articleFlows||{};
 for(const [id,chain] of assigned){const declared=flows[id]?.pageIds||[];if(!chain.length)throw Error('Place every article on an interior page: '+id);if(chain.length>1&&JSON.stringify(chain)!==JSON.stringify(declared))throw Error('Repeated articles need an explicit continuation chain in page order: '+id);if(declared.length&&JSON.stringify(chain)!==JSON.stringify(declared))throw Error('Continuation chain does not match saved page assignments: '+id);if(declared.some(pid=>plannedPages.find(p=>p.id===pid)?.mode==='preserve'))throw Error('Continuation pages must be editable: '+id);}
 for(const id of Object.keys(flows))if(!assigned.has(id))throw Error('Unknown continuation article: '+id);
}
'use strict';
let plannedPages=[];
function renderIssuePlan(){
 for(const flow of Object.values(issue.layoutPlan?.articleFlows||{})){const ids=flow.pageIds||[];if(ids.every(id=>plannedPages.some(p=>p.id===id)))flow.pageIds=plannedPages.filter(p=>ids.includes(p.id)).map(p=>p.id);}
 const root=$('issue-pages');root.replaceChildren();
 plannedPages.forEach((p,index)=>{
  p.pageNumber=index+1;
  const row=document.createElement('div'),label=document.createElement('span');
  label.textContent=p.pageNumber+' · '+p.template.name+(p.mode==='preserve'?' · preserve':'');row.append(label);
  const button=(name,action)=>{const b=document.createElement('button');b.textContent=name;b.onclick=action;row.append(b);};
  button('Edit',()=>{blocks=copy(p.blocks||[]);sharedFields=copy(p.sharedFields||{});assignments=[...p.articleIds];for(const [k,v] of Object.entries(p.controls||{}))if($(k)&&!coverControlIds.includes(k))$(k).value=v;if(p.template.kind==='cover')coverFeatured=[...p.articleIds];$('page-number').value=p.pageNumber;$('preserve-page').checked=p.mode==='preserve';const base=baseFromSaved(p);if(!library.templates.some(t=>t.id===base.id)){library.templates.push(copy(base));const o=document.createElement('option');o.value=base.id;o.textContent=base.name||base.id;$('selected-template').append(o);}choose(base.id,base);renderBlocks();});
  if(index&&p.template.kind!=='cover'&&plannedPages[index-1].template.kind!=='cover')button('Move up',()=>{[plannedPages[index-1],plannedPages[index]]=[plannedPages[index],plannedPages[index-1]];renderIssuePlan();renderPage();});
  button('Remove',()=>{plannedPages.splice(index,1);renderIssuePlan();renderPage();});root.append(row);
 });
 if(typeof renderFlowEditor==='function')renderFlowEditor();
}
function saveIssuePage(){try{
 const n=Number($('page-number').value),template=resolved(selected),count=template.kind==='cover'?coverFeatured.filter(Boolean).length:template.storyCount||0;
 if(!Number.isInteger(n)||n<1||n>plannedPages.length+1)throw Error('Add consecutive pages, starting at 1, or edit an existing page number.');
 if(template.kind==='cover'&&n!==1)throw Error('The front cover must be page 1.');
 if(n===1&&template.kind!=='cover'&&plannedPages[0]?.template.kind==='cover')throw Error('Keep the front cover on page 1.');
 const articleIds=template.kind==='cover'?coverFeatured.filter(Boolean):assignments.slice(0,count);
 if(articleIds.length!==count||new Set(articleIds).size!==count)throw Error('Select a distinct article for every slot.');
 const id=plannedPages[n-1]?.id||'page-'+crypto.randomUUID();
 plannedPages[n-1]={id,pageNumber:n,templateId:template.id,articleIds,mode:$('preserve-page').checked?'preserve':'replace',template,baseTemplate:copy(selected),blocks:copy(blocks),sharedFields:copy(sharedFields),controls:Object.fromEntries(controls.map(k=>[k,$(k).value]))};
 renderIssuePlan();$('issue-plan-status').textContent='Page saved. '+plannedPages.length+' pages in the issue plan.';renderPage();
 }catch(e){$('issue-plan-status').textContent=e.message;}}
async function buildIssueZip(){
 if(!plannedPages.length)throw Error('Save the issue pages first.');
 validatePlacements();
 const data=issueWithCover(),templates=[];requireMedia(data);const coverPage=plannedPages.find(p=>p.template.kind==='cover');if(coverPage)validateFeatured(coverPage.articleIds);
 data.layoutPlan={...data.layoutPlan,blocks:{},pages:plannedPages.map(p=>{const tid='planned-'+p.id;templates.push({... (p.template.kind==='cover'?applyCover(p.template,p.articleIds):copy(p.template)),id:tid});return {id:p.id,pageNumber:p.pageNumber,templateId:tid,kind:p.template.kind,articleIds:p.articleIds,mode:p.mode};})};
 const cover=plannedPages.find(p=>p.template.kind==='cover'),centre=plannedPages.slice(plannedPages.length/2-1,plannedPages.length/2+1);
 data.layoutPlan.cover.mode=cover?.mode==='preserve'?'preserve':'editable';data.layoutPlan.cover.articleIds=cover?.articleIds||[];
 data.layoutPlan.truck={mode:plannedPages.length%2===0&&centre.length===2&&centre.every(p=>p.mode==='preserve')?'preserve':'editable',pageIds:centre.map(p=>p.id)};
 const zip=new JSZip();zip.file('issue.json',JSON.stringify(data,null,2));zip.file('templates.json',JSON.stringify({...library,templates},null,2));
 zip.file('page-plan.json',JSON.stringify({schemaVersion:'ote.designcraft.plan.v1',templateId:selected.id,articleIds:assignments,baseTemplate:copy(selected),blocks,sharedFields,controls:Object.fromEntries(controls.map(k=>[k,$(k).value])),savedPages:plannedPages,issueBundle:data},null,2));
 for(const [path,content] of bytes)zip.file(path,content);
 for(const a of data.articles)for(const p of a.photos)if(!bytes.has(p.path))throw Error('Import the issue ZIP to include original media: '+p.path);
 for(const path of ['assets/ote-horizontal-logo.png','assets/ote-stacked-logo.pdf']){const r=await fetch(path);if(!r.ok)throw Error('Brand asset unavailable');zip.file(path,await r.arrayBuffer());}
 await addCoverMedia(zip);await addDesignArt(zip,templates);
 zip.file('README.txt','Extract the recipe and template kit. Install the kit requirements, then run:\npython3 /path/to/kit/compile-issue.py --library templates.json --issue issue.json --font-dir /path/to/kit/assets/fonts --output output --cli /path/to/designcraft-cli\n\nFor preservation, add --base-native /path/to/original.designcraft. The base must have the same page count; preserve both pages of each continuous spread. Every article must have one interior assignment. Use --booklet for the multiple-of-four print check. Native preflight decides text fit; Adobe InDesign verification remains required.\n'+(templates.some(t=>t.bodyFlows)?'\nThis issue uses explicit body-region flows. Generate it in OTEManager or run node /path/to/OTEManager/tools/designcraft/compile.mjs --library templates.json --issue issue.json --output output. The legacy Python compilers reject body-region flows.\n':'')+(templates.some(t=>t.design)?DESIGN_README:''));
 return zip.generateAsync({type:'uint8array',compression:'DEFLATE'});
}
async function exportIssuePlan(){try{save('ote-whole-issue-recipe.zip',await buildIssueZip(),'application/zip');$('issue-plan-status').textContent='Whole issue recipe saved with full text, media and stable page IDs.';}catch(e){$('issue-plan-status').textContent=e.message;}}
$('save-issue-page').onclick=saveIssuePage;$('export-issue-plan').onclick=exportIssuePlan;
