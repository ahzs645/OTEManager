'use strict';

// Source presets are measured from the archived issues. The reusable recipe and
// its reference PDF stay linked while article text and recurring fields remain editable.
let sourceCatalogue=null;

function sourceReference(parent,source){
 if(!source)return;
 const note=editorNode('p',{className:'muted'},source.label||('Source PDF · page '+source.page));
 if(source.pdf&&Number.isInteger(source.page)&&source.page>0){try{
  validateMediaPath(source.pdf);
  const link=editorNode('a',{href:source.pdf+'#page='+source.page,target:'_blank',rel:'noopener',className:'text-link'},'View source page '+source.page+' ↗');
  note.append(document.createElement('br'),link);
 }catch{/* Imported recipes can retain a source label without a local PDF link. */}}
 parent.append(note);
 if(source.notes)parent.append(editorNode('p',{className:'muted'},Array.isArray(source.notes)?source.notes.join(' '):source.notes));
}

function renderSourceOptions(){
 if(!sourceCatalogue||!$('source-page-preset'))return;
 const match=sourceCatalogue.templates?.find(p=>p.templateId===selected?.id),reference=$('source-page-reference');reference.replaceChildren();
 if(match)sourceReference(reference,match.source);else if(selected?.source)sourceReference(reference,selected.source);
 $('source-page-preset').value=match?.templateId||'';
 $('source-section-code').value=selected?.section?.code||'A';
 const editableHeader=!!(selected?.design&&selected?.art&&selected?.kind!=='cover');
 $('source-section-code').disabled=!editableHeader;
 $('source-header-note').textContent=editableHeader?'The archived house header uses A; choose another letter for this page.':'This layout has no editable house header. A header inside placed source artwork stays part of that artwork.';
 $('source-section-label').value=selected?.section?.label||'';
 const section=sourceCatalogue.sections?.find(s=>s.label===selected?.section?.label);
 $('source-section-preset').value=section?.id||'';
}

async function setupSourceOptions(){
 await plannerReady;
 if(!library)return;
 const panel=editorNode('details',{id:'source-options',open:true});panel.append(editorNode('summary',{},'Recreate an original page'));
 const status=editorNode('p',{id:'source-options-status',className:'muted'},'Loading measured source layouts…');status.setAttribute('role','status');panel.append(status);
 $('assignments').after(panel);
 try{
  const response=await fetch('source-presets.json');if(!response.ok)throw Error('The source layout catalogue is unavailable.');
  sourceCatalogue=await response.json();
  const presets=editorNode('select',{id:'source-page-preset'});presets.append(editorNode('option',{value:''},'Choose a measured source page'));
  for(const preset of sourceCatalogue.templates||[])if(library.templates.some(t=>t.id===preset.templateId))presets.append(editorNode('option',{value:preset.templateId},preset.label));
  editorLabel(panel,'Source page layout',presets);
  const load=editorNode('button',{type:'button',className:'outline'},'Use source page layout');
  load.onclick=()=>{try{
   if(!presets.value)throw Error('Choose a source page layout first.');
   blocks=[];sharedFields={};choose(presets.value);editorSlotId=selected.slots.find(s=>s.fields&&!s.asset)?.id||selected.slots[0]?.id;renderBlocks();
   status.textContent='Source layout loaded. Assign your articles and edit recurring text under Edit this page. Save it in the issue plan to keep this version.';
  }catch(error){status.textContent=error.message;}};
  panel.append(load,editorNode('p',{className:'muted'},'Loads the original frame positions and replaces this page’s reservations. Save your current page in the issue plan first to keep it.'));
  panel.append(editorNode('div',{id:'source-page-reference'}));
  const reservations=editorNode('select',{id:'source-block-preset'});reservations.append(editorNode('option',{value:''},'Choose an ad spot or recurring section'));
  for(const preset of sourceCatalogue.blocks||[])reservations.append(editorNode('option',{value:preset.id},preset.name));
  editorLabel(panel,'Add a source reservation to this page',reservations);
  const blockReference=editorNode('div',{id:'source-block-reference'});panel.append(blockReference);
  reservations.onchange=()=>{blockReference.replaceChildren();sourceReference(blockReference,sourceCatalogue.blocks.find(p=>p.id===reservations.value)?.source);};
  const add=editorNode('button',{type:'button',className:'outline'},'Add measured reservation');
  add.onclick=()=>{try{
   if(selected.kind==='cover')throw Error('Choose an interior recipe to add a reservation.');
   if(selected.source)throw Error('This source page already keeps its measured reservations. Choose a general story recipe to add another spot.');
   const preset=sourceCatalogue.blocks.find(p=>p.id===reservations.value);if(!preset)throw Error('Choose a measured reservation first.');
   const block={...copy(preset),id:'block-'+crypto.randomUUID(),fieldKey:'source-'+crypto.randomUUID()};delete block.fields;
   validateBlock(block);blocks.push(block);sharedFields[block.fieldKey]=copy(preset.fields||{});renderBlocks();renderPage();
   status.textContent='Added '+preset.name+'. Its original boundary and source reference are retained in the recipe.';
  }catch(error){status.textContent=error.message;}};
  panel.append(add);
  const section=editorNode('select',{id:'source-section-preset'});section.append(editorNode('option',{value:''},'Custom section'));
  for(const preset of sourceCatalogue.sections||[])section.append(editorNode('option',{value:preset.id},preset.label));
  editorLabel(panel,'Recurring section',section);
  const code=editorNode('input',{id:'source-section-code',type:'text',maxLength:1,pattern:'[A-Z]',value:'A'}),label=editorNode('input',{id:'source-section-label',type:'text',maxLength:120});
  editorLabel(panel,'Header letter',code);editorLabel(panel,'Section name',label);
  const apply=()=>{const value=code.value.trim().toUpperCase();if(!/^[A-Z]$/.test(value)){code.setCustomValidity('Use one letter A–Z.');status.textContent='Use one letter A–Z for the page header.';return;}code.setCustomValidity('');selected.section={code:value,label:label.value.trim()};renderPage();};
  code.oninput=apply;label.oninput=apply;
  section.onchange=()=>{const preset=sourceCatalogue.sections.find(s=>s.id===section.value);if(!preset)return;code.value=preset.code||'A';label.value=preset.label;apply();};
  panel.append(editorNode('p',{id:'source-header-note',className:'muted'}));
  status.textContent='Measured layouts, ad spots and recurring sections from the original PDFs. Editable recipes and source artwork are identified in each reference.';
  renderSourceOptions();
 }catch(error){status.textContent=error.message;}
}
setupSourceOptions();
