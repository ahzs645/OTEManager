'use strict';
async function setupNativeExport(){
 await plannerReady;
 window.addEventListener('message',async event=>{
  if(event.origin!==location.origin||event.source!==window.parent||event.data?.type!=='ote.import-issue'||!(event.data.bytes instanceof ArrayBuffer))return;
  try{await importIssue(new File([event.data.bytes],event.data.name||'issue.zip',{type:'application/zip'}));}catch(error){$('import-status').textContent=error.message;}
 });
 if(window.parent!==window)window.parent.postMessage({type:'ote.planner.ready'},location.origin);
 const panel=document.createElement('section');panel.className='panel';
 const title=document.createElement('h3');title.textContent='Generate editable output';panel.append(title);
 const status=document.createElement('p');status.textContent='Checking native generator…';panel.append(status);
 const mode=document.createElement('select');for(const [value,label] of [['issue','Saved whole issue'],['page','Current page']]){const o=document.createElement('option');o.value=value;o.textContent=label;mode.append(o);}panel.append(mode);
 const baseLabel=document.createElement('label');baseLabel.textContent='Existing issue for protected pages (ZIP containing .designcraft and build-manifest.json)';const base=document.createElement('input');base.type='file';base.accept='.zip';baseLabel.append(base);panel.append(baseLabel);
 const bookletLabel=document.createElement('label'),booklet=document.createElement('input');booklet.type='checkbox';bookletLabel.append(booklet,' Check booklet page count');panel.append(bookletLabel);
 const button=document.createElement('button');button.textContent='Generate native, PDF and IDML';button.disabled=true;panel.append(button);
 const downloads=document.createElement('div');panel.append(downloads);$('export-recipe').parentElement.append(panel);
 let capabilities;
 try{const response=await fetch('/api/designcraft/native');if(!response.ok)throw Error('unavailable');capabilities=await response.json();if(!capabilities.available)throw Error(capabilities.message||'unavailable');status.textContent='Native generator ready. Final PDF and IDML require successful text, media and reference checks.';button.disabled=false;}catch(error){status.textContent='Native generation is available when the OTE server has DesignCraft configured. Download a recipe ZIP and use the template kit for local generation.';return;}
 button.onclick=async()=>{
  button.disabled=true;downloads.replaceChildren();
  try{
   status.textContent='Preparing full source and media…';
   const recipe=mode.value==='issue'?await buildIssueZip():await buildPageZip();
   const form=new FormData();form.append('recipe',new Blob([recipe],{type:'application/zip'}),'recipe.zip');form.append('mode',mode.value);form.append('fontProfile',issue.layoutPlan?.fontProfile||'portable');form.append('booklet',String(booklet.checked));if(base.files[0])form.append('base',base.files[0]);
   const response=await fetch('/api/designcraft/native',{method:'POST',body:form});const job=await response.json();if(!response.ok)throw Error(job.error||'Generation could not start.');
   let result=job;
   while(['queued','running'].includes(result.status)){
    status.textContent=result.status==='queued'?'Queued for native generation…':'Composing and checking the native document…';
    await new Promise(resolve=>setTimeout(resolve,1500));const poll=await fetch('/api/designcraft/native?job='+encodeURIComponent(job.id));result=await poll.json();if(!poll.ok)throw Error(result.error||'Job status unavailable.');
   }
   status.textContent=result.status==='completed'?'Generation passed. Download editable output and the checked PDF.':result.error||result.message||'Generation needs layout adjustments. Draft and source files are retained.';
   const artifacts=Array.isArray(result.artifacts)?result.artifacts:Object.keys(result.artifacts||{});
   for(const artifact of artifacts){const key=typeof artifact==='string'?artifact:artifact.key;if(!key)continue;const a=document.createElement('a');a.href='/api/designcraft/native?job='+encodeURIComponent(job.id)+'&artifact='+encodeURIComponent(key);a.textContent='Download '+key;a.className='text-link';a.style.marginRight='1rem';downloads.append(a);}
  }catch(error){status.textContent=error.message;}finally{button.disabled=false;}
 };
}
setupNativeExport();
