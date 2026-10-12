'use strict';
let coverFeatured=['demo-1','demo-2','demo-3'];
const coverControlIds=['release-date','volume','issue-number','cover-line','cover-caption','focus-x','focus-y'];
function coverSettings(){
 const date=$('release-date').value,volume=Number($('volume').value),number=Number($('issue-number').value);
 if(!/^\d{4}-\d{2}-\d{2}$/.test(date)||!Number.isFinite(new Date(date+'T12:00:00Z').getTime())||new Date(date+'T12:00:00Z').toISOString().slice(0,10)!==date)throw Error('Choose a valid release date.');
 if(!Number.isInteger(volume)||volume<1||!Number.isInteger(number)||number<1)throw Error('Volume and issue must be positive whole numbers.');
 return {date,volume,number,fit:issue.layoutPlan?.cover?.fit||'cover',line:$('cover-line').value,caption:$('cover-caption').value,photoPath:heroPath,photoMimeType:heroMime,
  focus:{x:Number($('focus-x').value)/100,y:Number($('focus-y').value)/100},articleIds:coverFeatured.filter(Boolean)};
}
function coverReference(aid){return plannedPages.filter(p=>p.template.kind!=='cover'&&p.articleIds.includes(aid));}
function validateFeatured(ids){
 if(new Set(ids).size!==ids.length)throw Error('Choose distinct featured articles.');
 for(const aid of ids)if(!coverReference(aid).length||(coverReference(aid).length>1&&JSON.stringify(coverReference(aid).map(p=>p.id))!==JSON.stringify(issue.layoutPlan?.articleFlows?.[aid]?.pageIds)))throw Error('Place each featured article on an interior page or a declared continuation chain before exporting.');
}
function renderCoverReferences(){
 const ids=coverFeatured.filter(Boolean);$('cover-reference-status').textContent=ids.length?ids.map(id=>{
  const a=issue.articles.find(a=>a.id===id),pages=coverReference(id);
  return (a?.title||'Unknown article')+' → '+(pages.length?'page '+pages[0].pageNumber:pages.length?'Assigned more than once':'Not placed yet');
 }).join(' · '):'Choose up to three featured articles in a cover recipe. Their page numbers update when issue pages move.';
}
function applyCover(template,ids){
 const t=copy(template),c=coverSettings(),d=new Date(c.date+'T12:00:00Z');
 for(const s of t.slots){
  if(s.id==='cover-date')s.text=d.toLocaleDateString('en-US',{month:'long',day:'numeric',timeZone:'UTC'}).toUpperCase();
  if(s.id==='cover-year')s.text=String(d.getUTCFullYear());
  if(s.id==='cover-issue')s.text='VOLUME '+c.volume+' · ISSUE '+c.number+(t.family==='framed'?' · '+d.getUTCFullYear():'');
  if(s.id==='cover-line')s.text=c.line;
  if(s.id==='cover-photo'){s.asset=c.photoPath;delete s.articleIndex;s.fit=c.fit;s.focus=c.focus;}
  if(s.id.startsWith('cover-card-')){const aid=ids[s.articleIndex],a=issue.articles.find(a=>a.id===aid),pages=coverReference(aid);s.text=a?(pages.length?String(pages[0].pageNumber).padStart(2,'0'):'Not placed')+' · '+a.title:'';delete s.fields;}
 }
 t.slots=t.slots.filter(s=>s.id!=='cover-caption');
 if(c.caption){const framed=t.family==='framed';if(framed)for(const s of t.slots)if(s.id.startsWith('cover-card-'))s.rect[1]=Math.max(s.rect[1],616);
  t.slots.push({id:'cover-caption',role:'caption',rect:framed?[42,597,714,612]:[60,518,696,540],text:c.caption,fontSize:8});}
 return t;
}
function syncFeaturedCover(){for(const p of plannedPages)if(p.template.kind==='cover')p.articleIds=coverFeatured.filter(Boolean);}
function issueWithCover(){const data=copy(issue),c=coverSettings();data.issue={...data.issue,date:c.date,year:Number(c.date.slice(0,4)),volume:c.volume,number:c.number};data.layoutPlan||={};data.layoutPlan.cover={...data.layoutPlan.cover,...c};return data;}
function restoreCover(v,data){
 const c=v.layoutPlan?.cover||{},info=v.issue||{};
 $('release-date').value=c.date||info.date||'2025-09-12';$('volume').value=c.volume||info.volume||1;$('issue-number').value=c.number||info.number||1;
 $('cover-line').value=c.line??'';$('cover-caption').value=c.caption??'';$('focus-x').value=(c.focus?.x??.5)*100;$('focus-y').value=(c.focus?.y??.5)*100;
 coverFeatured=[...(c.articleIds||plannedPages.find(p=>p.template.kind==='cover')?.articleIds||v.articles.slice(0,3).map(a=>a.id))];
 heroPath=c.photoPath||'assets/source-cover-photo.jpeg';heroMime=c.photoMimeType||(/\.png$/i.test(heroPath)?'image/png':'image/jpeg');
 if(data){heroBytes=data;heroUrl=URL.createObjectURL(new Blob([data],{type:heroMime}));}
}
async function uploadCoverPhoto(){try{
 const f=$('cover-photo').files[0];if(!f)return;
 const ext={'image/jpeg':'jpg','image/png':'png','image/webp':'webp','image/tiff':'tif'}[f.type];
 if(!ext)throw Error('Use a JPEG, PNG, WebP or TIFF cover photo.');
 const data=new Uint8Array(await f.arrayBuffer());if(heroUrl)URL.revokeObjectURL(heroUrl);heroUrl=URL.createObjectURL(f);heroBytes=data;heroMime=f.type;heroPath='assets/cover-photo.'+ext;renderPage();
 }catch(e){$('planner-status').textContent=e.message;}}
async function addCoverMedia(zip){
 if(!heroBytes){const r=await fetch(heroPath);if(!r.ok)throw Error('Import the recipe ZIP or choose the cover photo to include its original image.');heroBytes=new Uint8Array(await r.arrayBuffer());}
 zip.file(heroPath,heroBytes);
}
