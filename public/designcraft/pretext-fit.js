'use strict';
// Live headline bands in the planner preview. Pretext measures each headline with the browser's own
// font engine (no DOM layout), using the open faces the native build uses, and the shared fit rules
// (compiler/fit.js) move the byline and grow the photo when a headline needs fewer lines than its
// band. The preview is instant; the DesignCraft engine re-measures and preflights before export.
const PRETEXT_FACES={'Source Sans 3|Bold':'SourceSans3-Bold.ttf','Source Sans 3|Semibold':'SourceSans3-Semibold.ttf','Source Sans 3|Regular':'SourceSans3-Regular.ttf',
 'Barlow|Black':'Barlow-Black.ttf','Barlow|ExtraBold':'Barlow-ExtraBold.ttf','Barlow|SemiBold':'Barlow-SemiBold.ttf','Caveat Brush|Regular':'CaveatBrush-Regular.ttf',
 'TeX Gyre Heros|Regular':'texgyreheros-regular.otf','TeX Gyre Heros|Bold':'texgyreheros-bold.otf','TeX Gyre Heros|Italic':'texgyreheros-italic.otf',
 'TeX Gyre Heros|Bold Italic':'texgyreheros-bolditalic.otf','TeX Gyre Heros Cn|Bold':'texgyreheroscn-bold.otf'};
let pretextModules=null,pretextRun=0,pretextFitted=null;const pretextLoaded=new Map(),pretextPrepared=new Map();
async function pretextLoad(){pretextModules??=Promise.all([import('./assets/pretext/layout.js'),import('./compiler/fit.js')]).then(([pretext,fit])=>({pretext,fit}));return pretextModules;}
async function pretextFace(family,face){
 const file=PRETEXT_FACES[family+'|'+face];if(!file)throw Error('No open face for '+family+' '+face+' in the live preview.');
 const name='ote-pretext-'+file.replace(/\W/g,'-');
 if(!pretextLoaded.has(name))pretextLoaded.set(name,(async()=>{const font=new FontFace(name,'url(assets/fonts/'+file+')');await font.load();document.fonts.add(font);return name;})());
 return pretextLoaded.get(name);
}
/** Engine-shaped measurements [{slotId, lines, height, fits}] for a template's headlines, measured with Pretext. */
async function pretextMeasure(template,stories){
 const {pretext,fit}=await pretextLoad(),design=template.design?library.designs?.[template.design]:null,out=[];
 for(const slot of template.slots){
  const article=stories[slot.articleIndex??0];if(slot.role!=='headline'||slot.enabled===false||!article)continue;
  // Portable faces: the preview measures with the same open fonts a portable native build embeds.
  const type=fit.headlineType(slot,{fontProfile:'portable',design}),name=await pretextFace(type.family,type.face);
  const text=type.chars?.capitalization==='allCaps'?article.title.toUpperCase():article.title,spacing=(type.chars?.tracking||0)*type.size/1000;
  const key=[name,type.size,spacing,text].join('|');
  if(!pretextPrepared.has(key))pretextPrepared.set(key,pretext.prepareWithSegments(text,`${type.size}px "${name}"`,spacing?{letterSpacing:spacing}:undefined));
  const width=slot.rect[2]-slot.rect[0],{lineCount,lines}=pretext.layoutWithLines(pretextPrepared.get(key),width,type.leading);
  out.push({slotId:slot.id,lines:lineCount,height:Math.round(((lineCount-1)*type.leading+type.size*1.1)*100)/100,fits:lineCount<=4,source:'pretext',
   text:lines.map(l=>l.text.trimEnd()),family:name,size:type.size,leading:type.leading,spacing});
 }
 return out;
}
/** Fit the selected recipe's headline bands with Pretext: {template, changes} or null when nothing changes. */
async function pretextFitTemplate(template,stories,tighten=true){
 const {fit}=await pretextLoad(),measured=await pretextMeasure(template,stories),fitted=fit.fitHeadlineBands(template,measured,{tighten});
 if(fitted)fitted.measured=measured;return fitted;
}
// Preview-only: the measured lines, so draw() can set each headline as it will compose.
const pretextLinesOf=measured=>Object.fromEntries(measured.map(m=>[m.slotId,{lines:m.text,family:m.family,size:m.size,leading:m.leading,spacing:m.spacing}]));
function pretextControls(){
 if($('pretext-fit'))return;
 const box=document.createElement('div');box.className='pretext-fit';
 const label=document.createElement('label'),toggle=document.createElement('input');toggle.type='checkbox';toggle.id='pretext-fit';label.append(toggle,' Fit headline bands live (Pretext)');
 const status=document.createElement('p');status.id='pretext-fit-status';status.className='muted';status.setAttribute('role','status');
 const keep=document.createElement('button');keep.id='pretext-fit-apply';keep.className='outline';keep.textContent='Keep the fitted layout';keep.hidden=true;
 keep.onclick=()=>{if(!pretextFitted)return;const fitted=pretextFitted;choose(selected.id.split('@')[0],fitted);$('pretext-fit-status').textContent='Applied '+fitted.name+'. Native preflight checks it when you generate.';};
 toggle.onchange=()=>renderPage();
 box.append(label,status,keep);$('auto-select').before(box);
}
async function pretextRefresh(){
 const toggle=$('pretext-fit'),status=$('pretext-fit-status'),keep=$('pretext-fit-apply');if(!toggle||!selected)return;
 pretextFitted=null;keep.hidden=true;
 if(!toggle.checked||selected.kind!=='story'){status.textContent=toggle.checked?'Live fitting works on story recipes.':'';return;}
 const run=++pretextRun;
 try{
  const base=resolved(selected),fitted=await pretextFitTemplate(base,articles());if(run!==pretextRun)return;
  if(!fitted){const measured=await pretextMeasure(base,articles());if(run!==pretextRun)return;$('page-preview').replaceChildren(draw({...base,pretextLines:pretextLinesOf(measured)}));status.textContent='Pretext: every headline already fills its band.';return;}
  $('page-preview').replaceChildren(draw({...fitted.template,pretextLines:pretextLinesOf(fitted.measured)}));$('preview-name').textContent=fitted.template.name+' · live';
  status.textContent='Pretext: '+fitted.changes.map(c=>`${c.slotId} ${c.lines} line${c.lines>1?'s':''}, band ${c.grownBy>0?'+':'−'}${Math.abs(c.grownBy).toFixed(1)} pt`).join(' · ')+(fitted.changes.some(c=>c.grownBy<0)?'. The byline moves up and the photo grows into the space.':'.');
  if(!blocks.length){pretextFitted=fitted.template;keep.hidden=false;}else status.textContent+=' Remove reserved pieces to keep it.';
 }catch(error){if(run===pretextRun)status.textContent=error.message;}
}
(async()=>{await plannerReady;pretextControls();const draw0=renderPage;renderPage=function(){draw0();void pretextRefresh();};renderPage();})();
window.otePretext={measure:pretextMeasure,fit:pretextFitTemplate};
