"use strict";
// The application owns issue identity and persistence; this bridge owns the recipe.
// Source articles/media always come from the freshly imported application bundle.
async function setupIssueStudioBridge() {
  await plannerReady;
  if (window.parent === window) return;
  let config = null, loading = false, last = "", queued = false;
  let acceptedPages = [];
  const assetRefs = {};
  const send = data => window.parent.postMessage(data, location.origin);
  const report = error => send({type:"ote.studio.error",message:error.message || String(error)});
  const rawRenderPage = renderPage, rawRenderIssuePlan = renderIssuePlan;
  const rawSaveIssuePage = saveIssuePage, rawBuildIssueZip = buildIssueZip, rawBuildPageZip = buildPageZip;
  function reservations(number) {
    return (config?.reservations || []).filter(r => r.pageNumber === number).map(r => {
      const [x,y,w,h] = r.rect;
      return {id:"studio-reservation-"+r.id,type:r.kind==="editorial"?"custom":"ad",
        name:r.name || (r.kind==="booked-ad"?"Booked advertisement":"Reserved space"),
        fieldKey:"studio-reservation-"+r.id,rect:[x,y,x+w,y+h],
        ...(r.artworkPath?{asset:"assets/user-reservation-"+r.id+"."+(r.artworkPath.split(".").pop()||"png"),fit:"contain"}:{})};
    });
  }
  function pageBlocks(number, previous = []) {
    const reserved = reservations(number);
    const custom = previous.filter(b => !b.id.startsWith("studio-reservation-"));
    const result = [];
    for (const block of [...reserved,...custom]) { validateBlock(block,result);result.push(copy(block)); }
    return result;
  }
  function checkPages(pages) {
    if (!config) return;
    if (pages.length > config.pageBudget || pages.some(p => p.pageNumber > config.pageBudget))
      throw Error("The plan exceeds the saved issue page budget. Increase the budget in Issue Studio first.");
    const lockedPageIds=new Set((config.placements||[]).filter(p=>p.locked).flatMap(p=>p.pageIds||[]));
    for (const locked of config.pages || []) if (locked.locked || lockedPageIds.has(locked.id)) {
      const previous = acceptedPages.find(p => p.id === locked.id);
      if (previous && JSON.stringify(pages.find(p => p.id === locked.id)) !== JSON.stringify(previous))
        throw Error("Unlock this page in Issue Studio before changing or moving it.");
    }
  }
  function currentRecipe() {
    const data = issueWithCover();
    // Text/media are revisioned server-side. Do not embed stale source in the recipe.
    data.articles = [];
    return {schemaVersion:"ote.designcraft.plan.v1",templateId:selected.id,
      baseTemplate:copy(selected),articleIds:[...assignments],blocks:copy(blocks),
      sharedFields:copy(sharedFields),controls:Object.fromEntries(controls.map(k=>[k,$(k).value])),
      savedPages:copy(plannedPages),issueBundle:data,assetRefs:copy(assetRefs),
      mediaOverrides:issue.articles.flatMap(a=>a.photos.map(p=>({articleId:a.id,photoId:p.id,path:p.path,
        ...(p.focus?{focus:copy(p.focus)}:{}),...(p.zoom?{zoom:p.zoom}:{}),...(p.fit?{fit:p.fit}:{})})))};
  }
  function changed() {
    if (!config || loading || queued) return;
    queued = true;
    queueMicrotask(() => {
      queued = false;
      if (loading) return;
      try {
        const state = currentRecipe(), serialized = JSON.stringify(state);
        if (serialized !== last) {last=serialized;send({type:"ote.studio.changed",state});}
      } catch(error) {report(error);}
    });
  }
  renderPage = function() {
    if (config && !loading) {
      try { blocks=pageBlocks(Number($("page-number").value),blocks); }
      catch(error) {$("planner-status").textContent=error.message;report(error);return;}
    }
    rawRenderPage();changed();
  };
  renderIssuePlan = function() {
    if (config && !loading) {
      try {checkPages(plannedPages);}
      catch(error) {plannedPages=copy(acceptedPages);rawRenderIssuePlan();$("issue-plan-status").textContent=error.message;report(error);return;}
      acceptedPages=copy(plannedPages);
    }
    rawRenderIssuePlan();changed();
  };
  saveIssuePage = function() {
    if (config) {
      const n=Number($("page-number").value),existing=plannedPages[n-1];
      if(n>config.pageBudget || (existing && (config.pages?.some(p=>p.id===existing.id&&p.locked)||config.placements?.some(p=>p.locked&&p.pageIds?.includes(existing.id))))) {
        const error=Error(n>config.pageBudget?"This page exceeds the saved issue page budget.":"Unlock this page in Issue Studio before saving changes.");
        $("issue-plan-status").textContent=error.message;report(error);return;
      }
      try {blocks=pageBlocks(n,blocks);} catch(error) {report(error);return;}
    }
    rawSaveIssuePage();changed();
  };
  $("save-issue-page").onclick=()=>saveIssuePage();
  function checkBuild() {
    checkPages(plannedPages);
    if (config && plannedPages.length && plannedPages.length !== config.pageBudget)
      throw Error("Save exactly "+config.pageBudget+" pages before generating the whole issue. Empty reserved pages need their own saved recipe.");
  }
  buildIssueZip=async function(){checkBuild();return rawBuildIssueZip();};
  buildPageZip=async function(){
    if(config && Number($("page-number").value)>config.pageBudget)throw Error("This page exceeds the issue page budget.");
    return rawBuildPageZip();
  };
  async function hydrateUnchecked(data) {
    if (!Number.isInteger(data.pageBudget) || data.pageBudget<1 || data.pageBudget>256)throw Error("Invalid saved page budget.");
    const recipe=data.state || {}, pages=copy(recipe.savedPages || []);
    if (pages.length>data.pageBudget)throw Error("Saved recipe exceeds the issue page budget.");
    const stagedBlocks=[];
    for(const block of recipe.blocks||[]){validateBlock(block,stagedBlocks);stagedBlocks.push(copy(block));}
    for(const p of pages){
      if(!p.id||!Number.isInteger(p.pageNumber)||p.pageNumber<1||p.pageNumber>data.pageBudget||!p.template?.slots||!Array.isArray(p.articleIds))throw Error("Invalid saved page recipe.");
      if(p.articleIds.some(id=>!issue.articles.some(a=>a.id===id)))throw Error("Saved page references an article that is no longer included. Reconcile its placement in Issue Studio first.");
      baseFromSaved(p);
    }
    const design=data.houseStyle==="classic"?null:data.houseStyle;
    const source=recipe.baseTemplate || (design?library.templates.find(t=>t.kind==="story"&&t.design===design&&t.storyCount===Math.max(1,Math.min(3,issue.articles.length))):null) || selected;
    if(!source?.id||!Array.isArray(source.slots))throw Error("Invalid selected recipe.");
    const stagedAssets=[];
    const refs={...recipe.assetRefs};
    for(const r of data.reservations||[])if(r.artworkPath)refs["assets/user-reservation-"+r.id+"."+(r.artworkPath.split(".").pop()||"png")]=r.artworkPath;
    for(const [path,storagePath] of Object.entries(refs)){
      validateMediaPath(path);
      if(typeof storagePath!=="string"||!storagePath.startsWith("issue-studio/"))throw Error("Invalid saved artwork reference.");
      const response=await fetch("/api/files/"+storagePath.split("/").map(encodeURIComponent).join("/"));
      if(!response.ok)throw Error("Saved artwork is unavailable: "+path);
      stagedAssets.push([path,new Uint8Array(await response.arrayBuffer()),response.headers.get("content-type")||"application/octet-stream"]);
    }
    const previousConfig=config;
    try {
      config={pageBudget:data.pageBudget,reservations:copy(data.reservations||[]),pages:copy(data.pages||[]),placements:copy(data.placements||[])};
      for(const p of pages)p.blocks=pageBlocks(p.pageNumber,p.blocks||[]);
      pageBlocks(Number(recipe.controls?.["page-number"]||1),stagedBlocks);
    }catch(error){config=previousConfig;throw error;}
    loading=true;
    try {
      plannedPages=pages;
      blocks=pageBlocks(Number(recipe.controls?.["page-number"]||1),stagedBlocks);
      sharedFields=copy(recipe.sharedFields||{});
      assignments=(recipe.articleIds||issue.articles.slice(0,3).map(a=>a.id)).filter(id=>issue.articles.some(a=>a.id===id));
      if(recipe.issueBundle?.layoutPlan)issue.layoutPlan=copy(recipe.issueBundle.layoutPlan);
      for(const override of recipe.mediaOverrides||[]){
        const photo=issue.articles.find(a=>a.id===override.articleId)?.photos.find(p=>override.photoId?p.id===override.photoId:p.path===override.path);
        if(!photo)continue;
        if(override.focus){if(![override.focus.x,override.focus.y].every(n=>Number.isFinite(n)&&n>=0&&n<=1))throw Error("Invalid saved photo focus.");photo.focus=copy(override.focus);}
        if(override.zoom!==undefined){if(!Number.isFinite(override.zoom)||override.zoom<1||override.zoom>10)throw Error("Invalid saved photo zoom.");photo.zoom=override.zoom;}
        if(override.fit!==undefined){if(!["cover","contain"].includes(override.fit))throw Error("Invalid saved photo fitting.");photo.fit=override.fit;}
      }
      Object.keys(assetRefs).forEach(key=>delete assetRefs[key]);
      Object.assign(assetRefs,refs);
      for(const [path,data,mime] of stagedAssets){if(urls.has(path))URL.revokeObjectURL(urls.get(path));bytes.set(path,data);urls.set(path,URL.createObjectURL(new Blob([data],{type:mime})));}
      restoreCover(issue,null);
      for(const [key,value] of Object.entries(recipe.controls||{}))if($(key))$(key).value=value;
      $("page-count").value=data.pageBudget;
      $("page-count").disabled=true;
      if($("browser-compose-design")&&typeof data.houseStyle==="string")$("browser-compose-design").value=design||"";
      const savedHero=bytes.get(heroPath);if(savedHero){heroBytes=savedHero;if(heroUrl)URL.revokeObjectURL(heroUrl);heroUrl=URL.createObjectURL(new Blob([savedHero],{type:heroMime}));}
      // Cover binding reads issue controls. Page piece fields belong to their
      // own page, rather than whichever page happened to be active at save.
      for(const p of plannedPages){
        const oldBlocks=blocks,oldFields=sharedFields;
        try{blocks=copy(p.blocks);sharedFields=copy(p.sharedFields||{});p.template=resolved(baseFromSaved(p));}
        finally{blocks=oldBlocks;sharedFields=oldFields;}
      }
      if(!library.templates.some(t=>t.id===source.id)){library.templates.push(copy(source));const o=document.createElement("option");o.value=source.id;o.textContent=source.name||source.id;$("selected-template").append(o);}
      choose(source.id,source);rawRenderIssuePlan();renderBlocks();rawRenderPage();
      acceptedPages=copy(plannedPages);last=JSON.stringify(currentRecipe());
      send({type:"ote.studio.loaded",state:currentRecipe()});
    }finally{loading=false;}
  }
  async function hydrate(data) {
    const before={issue:copy(issue),pages:copy(plannedPages),selected:copy(selected),blocks:copy(blocks),fields:copy(sharedFields),assignments:[...assignments],config,
      acceptedPages:copy(acceptedPages),last,refs:copy(assetRefs),media:[...bytes],coverFeatured:[...coverFeatured],heroBytes,heroPath,heroMime,
      values:Object.fromEntries(controls.map(k=>[k,$(k).value])),fitTitles:$("cover-fit-titles").checked};
    try {await hydrateUnchecked(data);} catch(error) {
      loading=true;
      try {
        issue=before.issue;plannedPages=before.pages;selected=before.selected;blocks=before.blocks;sharedFields=before.fields;assignments=before.assignments;config=before.config;
        acceptedPages=before.acceptedPages;last=before.last;coverFeatured=before.coverFeatured;
        Object.keys(assetRefs).forEach(key=>delete assetRefs[key]);Object.assign(assetRefs,before.refs);
        for(const url of urls.values())URL.revokeObjectURL(url);urls.clear();bytes.clear();
        for(const [path,data] of before.media){bytes.set(path,data);urls.set(path,URL.createObjectURL(new Blob([data])));}
        heroBytes=before.heroBytes;heroPath=before.heroPath;heroMime=before.heroMime;
        if(heroUrl)URL.revokeObjectURL(heroUrl);heroUrl=heroBytes?URL.createObjectURL(new Blob([heroBytes],{type:heroMime})):null;
        for(const [key,value] of Object.entries(before.values))$(key).value=value;
        $("cover-fit-titles").checked=before.fitTitles;$("page-count").disabled=!!config;
        rawRenderIssuePlan();renderAssignments();renderBlocks();rawRenderPage();
      }finally{loading=false;}
      throw error;
    }
  }
  window.addEventListener("message",async event=>{
    if(event.origin!==location.origin||event.source!==window.parent)return;
    if(event.data?.type==="ote.studio.load")try{await hydrate(event.data);}catch(error){report(error);}
    if(event.data?.type==="ote.studio.snapshot" && config) {
      try {
        // Store custom artwork and uploaded cover media outside database documents.
        const assets=[...bytes].filter(([path])=>path.startsWith("assets/user-"));
        if(heroBytes && heroPath!=="assets/source-cover-photo.jpeg")assets.push([heroPath,heroBytes]);
        for(const [path,content] of assets){
          const form=new FormData();form.append("path",path);form.append("file",new Blob([content]),path.split("/").pop());
          const response=await fetch("/api/issue-studio/"+encodeURIComponent(event.data.issueId)+"/assets",{method:"POST",body:form});
          const result=await response.json();if(!response.ok)throw Error(result.error||"Artwork could not be saved.");assetRefs[path]=result.path;
        }
        const state=currentRecipe();last=JSON.stringify(state);send({type:"ote.studio.snapshot",requestId:event.data.requestId,state});
      }catch(error){send({type:"ote.studio.error",requestId:event.data.requestId,message:error.message});}
    }
  });
  window.addEventListener("input",changed);
  window.addEventListener("change",changed);
  window.addEventListener("click",()=>queueMicrotask(changed));
  window.oteIssueStudio={snapshot:currentRecipe,planningOptions(candidateLibrary=library){
    if(!config)return {};
    const oldBlocks=blocks,pageLibraries={};
    try{
      for(let n=1;n<=config.pageBudget;n++){
        blocks=pageBlocks(n,acceptedPages.find(p=>p.pageNumber===n)?.blocks||[]);
        const templates=[];
        for(const template of candidateLibrary.templates){
          try{templates.push(resolved(template));}catch{/* This recipe cannot occupy this page's remaining regions. */}
        }
        pageLibraries[n]={...candidateLibrary,templates};
      }
    }finally{blocks=oldBlocks;}
    const lockedIds=new Set((config.placements||[]).filter(p=>p.locked).flatMap(p=>p.pageIds||[]));
    return {pageBudget:config.pageBudget,reservations:copy(config.reservations),pageLibraries,articleFlows:copy(issue.layoutPlan?.articleFlows||{}),
      articleConstraints:Object.fromEntries((config.placements||[]).map(p=>[p.articleId,{priority:p.priority??0,...(p.allowedPages?{allowedPages:p.allowedPages}:{})}])),
      protectedPageIds:acceptedPages.filter(p=>lockedIds.has(p.id)||config.pages.some(item=>item.id===p.id&&item.locked)).map(p=>p.id),existingPages:copy(acceptedPages)};
  }};
}
setupIssueStudioBridge();
