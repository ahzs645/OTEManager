'use strict';

// The working recipe is a base template. resolved(selected) applies reserved
// blocks; editing screen coordinates must undo that transform before saving.
let editorSlotId=null;
const editorFontDefaults={headline:24,body:10,byline:9,caption:8,folio:8,piece:12,ad:12,photo:12};
const editorLeadingDefaults={headline:27,body:12,byline:11,caption:10,folio:10,piece:15,ad:15};
const editorAssetTypes={'image/jpeg':'jpg','image/png':'png','image/webp':'webp','image/tiff':'tif','application/pdf':'pdf'};

function editorNode(tag,attributes={},value){
 const node=document.createElement(tag);
 for(const [key,attribute] of Object.entries(attributes)){
  if(key==='className')node.className=attribute;
  else if(key in node)node[key]=attribute;
  else node.setAttribute(key,attribute);
 }
 if(value!==undefined)node.textContent=value;
 return node;
}
function editorLabel(parent,title,input){
 const label=editorNode('label',{},title);label.append(input);parent.append(label);return input;
}
function editorStatus(message){$('planner-status').textContent=message;}
function editorShell(){
 let root=$('page-editor');if(root)return root;
 root=editorNode('section',{id:'page-editor'});
 root.append(editorNode('h3',{},'Edit this page'));
 const font=editorNode('select',{id:'font-profile'});
 for(const [value,label] of [['portable','Portable fonts'],['original2025','Original OTE fonts']])font.append(editorNode('option',{value},label));
 font.onchange=()=>{issue.layoutPlan||={};issue.layoutPlan.fontProfile=font.value;renderPage();};
 editorLabel(root,'Native font profile',font);
 root.append(editorNode('p',{className:'muted'},'Original OTE fonts require a configured native server or your local font directory. The native compiler verifies fonts, line spacing and text fit.'));
 const details=editorNode('details',{open:true});details.append(editorNode('summary',{},'Frames, typography and photographs'));
 const picker=editorNode('select',{id:'editor-slot'});picker.onchange=()=>{editorSlotId=picker.value;renderSlotEditor();};
 editorLabel(details,'Frame',picker);details.append(editorNode('div',{id:'editor-slot-fields'}));root.append(details);
 const artwork=editorNode('details');artwork.append(editorNode('summary',{},'Custom piece and advertisement artwork'));artwork.append(editorNode('div',{id:'editor-artwork'}));root.append(artwork);
 const flows=editorNode('details');flows.append(editorNode('summary',{},'Stories continued across pages'));flows.append(editorNode('p',{className:'muted'},'Save the pages, assign the same article to its continuation frames, then select those pages here. A continuation keeps one complete source article.'));flows.append(editorNode('div',{id:'editor-flows'}));root.append(flows);
 $('export-recipe').before(root);
 for(const axis of ['x','y'])$('focus-'+axis).addEventListener('input',()=>{
  if(selected?.kind==='cover'&&editorSlotId==='cover-photo'){
   const point=document.querySelector('#editor-slot-fields .focal-dot');if(point)point.style[axis==='x'?'left':'top']=$('focus-'+axis).value+'%';
  }
 });
 return root;
}
function editorBaseRect(slot,actual){
 if(selected.kind!=='story'||!blocks.length||slot.role==='folio')return [...actual];
 if(selected.reservationLayout){const regions=selected.reservationLayout.regions;if(!regions.some(r=>actual[0]>=r[0]&&actual[1]>=r[1]&&actual[2]<=r[2]&&actual[3]<=r[3]))throw Error('Keep this frame inside one of the eligible editorial regions.');return [...actual];}
 const area=freeArea(blocks,contentBox(selected));if(!area)throw Error('No usable story area remains.');
 if(actual[0]<area[0]||actual[1]<area[1]||actual[2]>area[2]||actual[3]>area[3])throw Error('Keep this frame inside the free story area around the reserved pieces.');
 const c=contentBox(selected);return [c[0]+(actual[0]-area[0])*(c[2]-c[0])/(area[2]-area[0]),c[1]+(actual[1]-area[1])*(c[3]-c[1])/(area[3]-area[1]),c[0]+(actual[2]-area[0])*(c[2]-c[0])/(area[2]-area[0]),c[1]+(actual[3]-area[1])*(c[3]-c[1])/(area[3]-area[1])];
}
function renderEditor(){
 if(!selected)return;editorShell();$('font-profile').value=issue.layoutPlan?.fontProfile||'portable';
 const picker=$('editor-slot');picker.replaceChildren();
 for(const slot of selected.slots)picker.append(editorNode('option',{value:slot.id},slot.id+' · '+slot.role));
 if(!selected.slots.some(slot=>slot.id===editorSlotId))editorSlotId=selected.slots[0]?.id||null;
 picker.value=editorSlotId||'';renderSlotEditor();renderArtworkEditor();renderFlowEditor();
}
function renderSlotEditor(){
 const parent=$('editor-slot-fields');if(!parent)return;parent.replaceChildren();
 const slot=selected?.slots.find(slot=>slot.id===editorSlotId);if(!slot)return;
 let actual;try{actual=resolved(selected).slots.find(item=>item.id===slot.id)?.rect||slot.rect;}catch(error){parent.append(editorNode('p',{},error.message));return;}
 const rectGroup=editorNode('div',{className:'boundary-inputs'}),rectInputs=[];
 for(const [index,label] of ['Left','Top','Right','Bottom'].entries()){
  const input=editorNode('input',{id:'editor-rect-'+index,type:'number',step:'0.1',value:String(Math.round(actual[index]*100)/100)});
  rectInputs.push(input);editorLabel(rectGroup,label+' (pt)',input);
  input.oninput=()=>{try{
   const rect=rectInputs.map(input=>Number(input.value));
   if(rectInputs.some(input=>input.value==='')||!rect.every(Number.isFinite)||rect[0]<0||rect[1]<0||rect[2]>756||rect[3]>792||rect[2]-rect[0]<8||rect[3]-rect[1]<8)throw Error('Use a frame within the page, at least 8pt wide and high.');
   slot.rect=editorBaseRect(slot,rect);renderPage();
  }catch(error){editorStatus(error.message);}};
 }
 parent.append(rectGroup);
 if(slot.role!=='photo'&&!slot.asset){
  const row=editorNode('div',{className:'two'}),size=Number(slot.fontSize||editorFontDefaults[slot.role]||12);
  for(const [key,label,value] of [['fontSize','Font size (pt)',size],['leading','Line spacing (pt)',slot.leading||(slot.fontSize?size*1.15:editorLeadingDefaults[slot.role]||15)]]){
   const maximum=key==='leading'?200:144,input=editorNode('input',{id:'editor-'+key,type:'number',min:'4',max:String(maximum),step:'0.1',value:String(Math.round(value*100)/100)});
   editorLabel(row,label,input);input.oninput=()=>{const value=Number(input.value);if(input.value===''||!Number.isFinite(value)||value<4||value>maximum){editorStatus('Use '+label.toLowerCase()+' between 4 and '+maximum+'pt.');return;}slot[key]=value;renderPage();};
  }parent.append(row);
 }
 if(slot.role==='photo'&&Number.isInteger(slot.articleIndex)&&slot.id!=='cover-photo'&&!slot.asset){
  const article=articles()[slot.articleIndex],photos=article?.photos||[],picker=editorNode('select',{id:'editor-photo'});
  if(!photos.length)picker.append(editorNode('option',{value:''},'This article has no imported photographs'));
  photos.forEach((photo,index)=>picker.append(editorNode('option',{value:String(index)},(index+1)+': '+(photo.caption||photo.originalName||photo.fileName||photo.path))));
  picker.value=String(slot.photoIndex||0);picker.disabled=!photos.length;
  picker.onchange=()=>{
   const before=slot.photoIndex||0;slot.photoIndex=Number(picker.value);
   for(const caption of selected.slots)if(caption.role==='caption'&&caption.articleIndex===slot.articleIndex&&(caption.photoIndex||0)===before)caption.photoIndex=slot.photoIndex;
   renderPage();
  };editorLabel(parent,'Article photograph',picker);
 }
 if(slot.role==='photo'||slot.asset)editorImageControls(parent,slot,'editor-image');
 if(slot.role==='ad'||slot.role==='piece')editorAssetControl(parent,slot,'frame artwork');
}
function editorImageControls(parent,target,prefix){
 const coverPhoto=selected?.kind==='cover'&&target.id==='cover-photo';
 const fit=editorNode('select',{id:prefix+'-fit'});
 for(const [value,label] of [['cover','Fill frame / crop'],['contain','Fit entire artwork']])fit.append(editorNode('option',{value},label));
 fit.value=coverPhoto?(issue.layoutPlan?.cover?.fit||'cover'):target.fit||(target.asset?'contain':'cover');
 fit.onchange=()=>{target.fit=fit.value;if(coverPhoto){issue.layoutPlan||={};issue.layoutPlan.cover||={};issue.layoutPlan.cover.fit=fit.value;}renderPage();renderSlotEditor();};editorLabel(parent,'Image fitting',fit);
 if(fit.value!=='cover')return;
 // Where the focal point lives: the cover form, the article photograph itself (so it follows the photo
 // into every layout and variant, like a WordPress focal point), or this frame for placed artwork.
 const photo=!coverPhoto&&!target.asset&&Number.isInteger(target.articleIndex)?articles()[target.articleIndex]?.photos?.[slotPhotoIndex(selected,target)]:null;
 const holder=coverPhoto?(issue.layoutPlan||={},issue.layoutPlan.cover||={}):photo||target;
 const focus=()=>coverPhoto?{x:Number($('focus-x').value)/100,y:Number($('focus-y').value)/100}:{x:.5,y:.5,...holder.focus};
 const url=coverPhoto?(heroUrl||heroPath):photo?urls.get(photo.path):target.asset?(urls.get(target.asset)||(target.asset.startsWith('assets/ote-')?target.asset:null)):null;
 const set=(next,zoom)=>{
  const f={x:Math.round(Math.min(1,Math.max(0,next.x))*1000)/1000,y:Math.round(Math.min(1,Math.max(0,next.y))*1000)/1000};
  if(coverPhoto){$('focus-x').value=f.x*100;$('focus-y').value=f.y*100;target.focus=f;}else holder.focus=f;
  if(zoom!==undefined){if(zoom>1)holder.zoom=zoom;else delete holder.zoom;}
  update();renderPage();
 };
 const box=editorNode('div',{className:'focal-picker'});
 const dot=editorNode('button',{type:'button',className:'focal-dot','aria-label':'Focal point. Use the arrow keys to move it.'});
 const previews=editorNode('div',{className:'focal-previews'});
 const [x,y,r,b]=target.rect,shapes=[['This frame',(r-x)/(b-y)],['Square',1],['Tall',2/3]];
 const panes=shapes.map(([label,ratio])=>{const pane=editorNode('figure',{className:'focal-preview'}),frame=editorNode('div',{className:'focal-frame'});frame.style.aspectRatio=String(ratio);pane.append(frame,editorNode('figcaption',{},label));previews.append(pane);return {frame,ratio};});
 let natural=null;
 function update(){
  const f=focus(),zoom=holder.zoom||1;dot.style.left=f.x*100+'%';dot.style.top=f.y*100+'%';
  zoomInput.value=String(Math.round(zoom*100));zoomValue.textContent=Math.round(zoom*100)+'%';
  if(!natural)return;
  for(const {frame,ratio} of panes){
   // Same placement as the compiler's focal crop: fill, zoom, centre the point, never show past an edge.
   const fw=frame.clientWidth||120,fh=fw/ratio,[iw,ih]=natural,scale=Math.max(fw/iw,fh/ih)*zoom;
   const tx=Math.max(fw-iw*scale,Math.min(0,fw/2-f.x*iw*scale)),ty=Math.max(fh-ih*scale,Math.min(0,fh/2-f.y*ih*scale));
   const img=frame.firstChild;Object.assign(img.style,{width:iw*scale+'px',height:ih*scale+'px',left:tx+'px',top:ty+'px'});
  }
 }
 const zoomInput=editorNode('input',{id:prefix+'-zoom',type:'range',min:'100',max:'300',step:'5',value:'100'}),zoomValue=editorNode('span',{className:'muted'});
 zoomInput.oninput=()=>set(focus(),Number(zoomInput.value)/100);
 if(url){
  const img=editorNode('img',{src:url,alt:'Drag the point to the part of the photo that must stay visible',draggable:false});
  img.onload=()=>{natural=[img.naturalWidth,img.naturalHeight];for(const {frame} of panes)frame.replaceChildren(editorNode('img',{src:url,alt:''}));update();};
  box.append(img,dot);
  const pick=event=>{const rect=img.getBoundingClientRect();set({x:(event.clientX-rect.left)/rect.width,y:(event.clientY-rect.top)/rect.height});};
  box.onpointerdown=event=>{event.preventDefault();box.setPointerCapture(event.pointerId);pick(event);dot.focus();box.onpointermove=pick;};
  box.onpointerup=box.onpointercancel=()=>{box.onpointermove=null;};
  dot.onkeydown=event=>{const step=event.shiftKey?.1:.01,f=focus(),move={ArrowLeft:[-step,0],ArrowRight:[step,0],ArrowUp:[0,-step],ArrowDown:[0,step]}[event.key];if(!move)return;event.preventDefault();set({x:f.x+move[0],y:f.y+move[1]});};
  parent.append(editorNode('p',{className:'muted'},photo?'Focal point: click or drag on the photo. It is saved with this photograph, so every layout, variant and crop keeps that part in view.':'Focal point: click or drag on the image to choose what stays in view when the frame crops it.'),box,previews);
 }else parent.append(editorNode('p',{className:'muted'},'Import the issue ZIP to see this photograph and set its focal point.'));
 const zoomLabel=editorLabel(parent,'Zoom',zoomInput);zoomLabel.after(zoomValue);
 const centre=editorNode('button',{type:'button',className:'outline'},'Reset focus and zoom');centre.onclick=()=>set({x:.5,y:.5},1);parent.append(centre);
 update();
}
function editorAssetControl(parent,target,label){
 const upload=editorNode('input',{type:'file',accept:'image/jpeg,image/png,image/webp,image/tiff,application/pdf'});
 const status=editorNode('p',{className:'muted'});
 const describe=()=>{status.textContent=target.asset?target.asset+(target.assetMimeType==='application/pdf'||/\.pdf$/i.test(target.asset)?' · PDF artwork: view the native PDF proof to verify it.':' · Original bytes included in recipe exports.'):'Choose JPEG, PNG, WebP, TIFF or PDF artwork.';};describe();
 upload.onchange=async()=>{try{
  const file=upload.files[0];if(!file)return;
  const mime=file.type||({'jpg':'image/jpeg','jpeg':'image/jpeg','png':'image/png','webp':'image/webp','tif':'image/tiff','tiff':'image/tiff','pdf':'application/pdf'}[file.name.split('.').pop().toLowerCase()]);
  const ext=editorAssetTypes[mime];if(!ext)throw Error('Use JPEG, PNG, WebP, TIFF or PDF artwork.');
  const data=new Uint8Array(await file.arrayBuffer());if(!data.length)throw Error('Choose a nonempty artwork file.');
  const asset='assets/user-piece-'+crypto.randomUUID()+'.'+ext;
  target.asset=asset;target.assetMimeType=mime;target.fit||='contain';bytes.set(asset,data);urls.set(asset,URL.createObjectURL(new Blob([data],{type:mime})));
  describe();renderPage();renderArtworkEditor();renderSlotEditor();
 }catch(error){editorStatus(error.message);}};
 editorLabel(parent,'Upload '+label,upload);parent.append(status);
 if(target.asset){
  const remove=editorNode('button',{type:'button',className:'outline'},'Remove artwork');
  remove.onclick=()=>{delete target.asset;delete target.assetMimeType;renderPage();renderArtworkEditor();renderSlotEditor();};parent.append(remove);
 }
}
function renderArtworkEditor(){
 const parent=$('editor-artwork');if(!parent)return;parent.replaceChildren();
 if(!blocks.length)parent.append(editorNode('p',{className:'muted'},'Reserve a custom piece or advertisement to attach its finished artwork. You can also choose an advertisement frame above.'));
 for(const block of blocks){
  const row=editorNode('div',{className:'piece-item'});row.append(editorNode('strong',{},block.name));editorAssetControl(row,block,block.name+' artwork');
  if(block.asset)editorImageControls(row,block,'piece-'+block.id);parent.append(row);
 }
}
function renderFlowEditor(){
 const parent=$('editor-flows');if(!parent)return;parent.replaceChildren();issue.layoutPlan||={};issue.layoutPlan.articleFlows||={};
 const pages=plannedPages.filter(page=>page.template.kind!=='cover');
 for(const article of issue.articles){
  const row=editorNode('fieldset'),legend=editorNode('legend',{},article.title),eligible=pages.filter(page=>page.articleIds.includes(article.id));row.append(legend);
  const chosen=new Set(issue.layoutPlan.articleFlows[article.id]?.pageIds||[]);
  if(eligible.length<2)row.append(editorNode('p',{className:'muted'},'Assign this article to two or more saved pages to declare a continuation.'));
  for(const page of pages){
   const check=editorNode('input',{type:'checkbox',value:page.id,checked:chosen.has(page.id),disabled:!page.articleIds.includes(article.id)});
   editorLabel(row,'Page '+page.pageNumber+' · '+page.template.name,check);
   check.onchange=()=>{
    const ids=pages.filter(page=>row.querySelector('input[value="'+CSS.escape(page.id)+'"]')?.checked).map(page=>page.id);
    if(ids.length)issue.layoutPlan.articleFlows[article.id]={pageIds:ids};else delete issue.layoutPlan.articleFlows[article.id];
    renderFlowEditor();renderPage();
   };
  }
  const numbered=pages.filter(page=>chosen.has(page.id)).map(page=>page.pageNumber);
  if(numbered.length)row.append(editorNode('p',{className:'muted'},numbered.length>1?'Starts on page '+numbered[0]+' · continues on '+numbered.slice(1).join(', '):'Choose at least one more assigned page to complete this continuation.'));
  parent.append(row);
 }
 if(!issue.articles.length)parent.append(editorNode('p',{className:'muted'},'Import articles to plan continuations.'));
}
