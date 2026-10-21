// Fixed-budget proposals. Sources stay whole; multi-page stories carry an
// explicit continuation chain and remain Estimated until issue composition.
export async function allocateFixedIssue(options, tools) {
  const { library, issue } = options;
  const budget = options.pageBudget ?? issue.layoutPlan?.pageBudget ?? 16;
  if (!Number.isInteger(budget) || budget < 1 || budget > 256) throw Error('Issue page budget must be between 1 and 256');
  const articles = new Map(issue.articles.map(a => [a.id, a]));
  if (articles.size !== issue.articles.length || [...articles.keys()].some(id=>typeof id!=='string'||!id)) throw Error('Issue article identities must be unique and nonempty');
  const ids = options.articleIds ?? [...articles.keys()];
  if (ids.length > 200 || new Set(ids).size !== ids.length || ids.some(id => !articles.has(id))) throw Error('Choose at most 200 distinct known issue articles');
  const existing = options.existingPages ?? [];
  if (!Array.isArray(existing) || existing.length > budget || new Set(existing.map(p => p.id)).size !== existing.length || new Set(existing.map(p => p.pageNumber)).size !== existing.length || existing.some(p => !Number.isInteger(p.pageNumber) || p.pageNumber < 1 || p.pageNumber > budget)) throw Error('Existing pages must have unique identities within the issue budget');
  const reservations = options.reservations ?? [];
  if (new Set(reservations.map(r=>r.id)).size !== reservations.length) throw Error('Reservation identities must be unique');
  if (reservations.length && !options.pageLibraries) throw Error('Reservation-aware page libraries are required for issue suggestions');
  if (reservations.some(r => !r.id || !Number.isInteger(r.pageNumber) || r.pageNumber < 1 || r.pageNumber > budget || !options.pageLibraries?.[r.pageNumber] || !Array.isArray(r.rect) || r.rect.length !== 4 || r.rect.some(v=>!Number.isFinite(v)) || r.rect[2] <= 0 || r.rect[3] <= 0)) throw Error('Every reservation requires a valid page, rectangle and page-specific library');
  const libFor = number => options.pageLibraries?.[number] ?? library;
  const pages = new Map(), plans = [], articleFlows = {}, used = new Set();
  const protectedIds = new Set(options.protectedPageIds ?? []);
  for (const page of existing) if (page.locked || page.mode === 'preserve' || page.protectedSpread) protectedIds.add(page.id);
  // A protected continuation page protects its entire story chain. Otherwise a
  // suggestion could preserve the opening page but silently discard its end.
  let expanded = true;
  while (expanded) {
    expanded = false;
    for (const flow of Object.values(options.articleFlows ?? {})) if (flow.pageIds?.some(id=>protectedIds.has(id))) {
      for (const id of flow.pageIds) {
        if (!existing.some(p=>p.id===id)) throw Error('Protected continuation references a missing page');
        if (!protectedIds.has(id)) {protectedIds.add(id);expanded=true;}
      }
    }
  }
  const preserved = existing.filter(p => protectedIds.has(p.id));
  for (const page of preserved) {
    if (!page.template || !Array.isArray(page.articleIds) || page.articleIds.some(id => !ids.includes(id))) throw Error('A protected page references unavailable content; resolve it before suggesting a plan');
    pages.set(page.pageNumber, structuredClone(page));
    if (page.template.kind !== 'cover') for (const id of page.articleIds) used.add(id);
    plans.push({ pageNumber: page.pageNumber, status: 'preserved', error: 'Protected page retained; its prior check may be stale after source changes.' });
  }
  for (const id of used) {
    const chain = [...pages.values()].filter(p => p.template.kind !== 'cover' && p.articleIds.includes(id)).sort((a,b) => a.pageNumber-b.pageNumber).map(p => p.id);
    if (chain.length > 1) {
      const previous = options.articleFlows?.[id]?.pageIds;
      if (JSON.stringify(chain) !== JSON.stringify(previous)) throw Error('Protected repeated story requires its complete existing continuation chain: '+id);
      articleFlows[id] = { ...options.articleFlows[id], pageIds: chain };
    }
  }
  const candidates = (number, selected) => tools.enumerateCandidates(libFor(number), selected.map(id => articles.get(id)), options.design ?? null)
    .map(candidate => ({ ...candidate, estimate: tools.estimate(candidate, libFor(number), options.markdownit) }))
    .filter(candidate => Number.isFinite(candidate.estimate.worstBody) && candidate.estimate.worstBody > 0)
    .sort((a,b) => a.estimate.worstBody-b.estimate.worstBody || a.unusedPhotos-b.unusedPhotos);
  const constraints = options.articleConstraints ?? {};
  for (const id of ids) {
    const rule = constraints[id];
    if (rule?.allowedPages && (!Array.isArray(rule.allowedPages) || rule.allowedPages.some(n=>!Number.isInteger(n)||n<1||n>budget))) throw Error('Article page constraints must stay within the issue budget');
    if (rule?.priority !== undefined && !Number.isFinite(rule.priority)) throw Error('Article priority must be finite');
  }
  function allowed(id, number) {
    const rule = constraints[id];
    return !rule?.allowedPages || rule.allowedPages.includes(number);
  }
  const pending = ids.filter(id => !used.has(id)).sort((a,b) => (constraints[b]?.priority ?? 0)-(constraints[a]?.priority ?? 0) || String(articles.get(b).body ?? '').length-String(articles.get(a).body ?? '').length || a.localeCompare(b));
  const save = (number, template, articleIds, status, variant) => {
    const previous = existing.find(p => p.pageNumber === number);
    // Each resolved page needs its own identity: two pages may use the same
    // house pattern with different ad geometry. A template map must not let
    // the later page overwrite the earlier page's checked frame positions.
    const record = structuredClone(template);
    if (record.kind === 'story') record.id = record.id.replace(/(?:@issue-page-\d+)+$/, '')+'@issue-page-'+number;
    const page = { ...(previous ? structuredClone(previous) : {}), id: previous?.id ?? 'page-'+number, pageNumber: number, templateId: record.id, articleIds, template: record, mode: 'replace', suggestionStatus: status };
    pages.set(number, page);plans.push({pageNumber:number,status,...(variant?{variant}:{})});return page;
  };
  // Page one remains the deliberate cover position. Reserved first pages use a
  // labelled reservation page; cover artwork is never laid over a booked ad.
  if (!pages.has(1) && pending.length && !reservations.some(r => r.pageNumber === 1)) {
    const cover = libFor(1).templates.find(t => t.kind === 'cover' && (t.design ?? null) === (options.design ?? null) && (!options.coverTemplateId || t.id === options.coverTemplateId));
    if (cover) save(1, cover, [], 'estimated');
  }
  for (let number = 2; number <= budget && pending.length; number++) {
    if (pages.has(number)) continue;
    const eligible = pending.filter(id => allowed(id, number) && candidates(number,[id]).length);
    if (!eligible.length) continue;
    const first = eligible[0], single = candidates(number, [first])[0];
    if (!single) continue;
    let placed = false;
    if (single.estimate.worstBody <= 1.05) {
      // Try real checked groupings, falling back to one article on this page.
      for (let count = Math.min(3, eligible.length); count >= 1; count--) {
        const group = eligible.slice(0,count);
        const choices = candidates(number, group);
        if (!choices.some(c => c.estimate.worstBody <= 1.05)) continue;
        const result = await tools.generatePageVariants({ ...options, library: libFor(number), articleIds: group, pageNumber:number, pageId:existing.find(p=>p.pageNumber===number)?.id ?? 'page-'+number, keep:1, previewScale:0, limit:options.limit ?? 4 });
        if (!result.variants.length) continue;
        const best = result.variants[0];save(number,best.template,best.articleIds,'designcraft-checked',best);
        for (const id of best.articleIds) { used.add(id);pending.splice(pending.indexOf(id),1); }
        placed=true;break;
      }
    }
    if (placed) continue;
    // Chain complete sources through enough remaining eligible frames. The
    // per-page estimate is conservative; final threaded preflight decides fit.
    const chain = [];let capacity = 0;
    for (let target = number; target <= budget; target++) {
      if (pages.has(target) || !allowed(first,target)) continue;
      const choice = candidates(target,[first])[0];
      if (!choice) continue;
      chain.push({number:target,choice});capacity += 1/choice.estimate.worstBody;
      if (capacity >= 1.10) break;
    }
    if (chain.length > 1 && capacity >= 1.10) {
      const pageIds = chain.map(({number:target,choice}) => save(target,choice.template,[first],'estimated').id);
      articleFlows[first] = {pageIds};used.add(first);pending.splice(pending.indexOf(first),1);
      plans.push({pageNumber:number,articleIds:[first],status:'estimated',error:'Continuation proposed with complete copy across '+pageIds.length+' pages. Compose the whole issue to check its fit.'});
    } else {
      // Keep an oversized story visibly unplaced and let smaller stories use
      // the remaining fixed pages; never grow the issue to hide the conflict.
      pending.splice(pending.indexOf(first),1);number--;
    }
  }
  const unplaced = ids.filter(id => !used.has(id));
  for (const id of unplaced) plans.push({articleIds:[id],error:'Unplaced within the fixed '+budget+'-page budget: '+articles.get(id).title});
  const featured = ids.filter(id => used.has(id)).slice(0,3);
  const first = pages.get(1);
  if (first?.template.kind === 'cover' && !preserved.some(p => p.pageNumber === 1)) {
    if (featured.length) first.articleIds = featured;
    else pages.delete(1);
  }
  for (let number=1;number<=budget;number++) if (!pages.has(number)) {
    const slots = reservations.filter(r=>r.pageNumber===number).map(r=>{
      const [x,y,w,h] = r.rect;
      return {id:'studio-reservation-'+r.id,role:r.kind==='editorial'?'piece':'ad',rect:[x,y,x+w,y+h],text:r.name||'Reserved space',...((r.assetPath||r.artworkPath)?{asset:r.assetPath||('assets/user-reservation-'+r.id+'.'+(r.artworkPath.split('.').pop()||'png')),fit:'contain'}:{})};
    });
    if (!slots.length) slots.push({id:'unallocated-folio-'+number,role:'folio',rect:[36,760,720,780],fontSize:8,leading:10});
    const template = {id:(options.design||'classic')+'-issue-placeholder-'+number,...(options.design?{design:options.design}:{}),name:reservations.some(r=>r.pageNumber===number)?'Reserved page':'Unallocated editorial page',kind:'custom',storyCount:0,photoCount:0,slots};
    save(number,template,[],'estimated');
  }
  const result = [...pages.values()].sort((a,b)=>a.pageNumber-b.pageNumber);
  const known = new Map(library.templates.map(t=>[t.id,JSON.stringify(t)]));
  const extraTemplates = result.map(p=>p.template).filter(t=>known.get(t.id)!==JSON.stringify(t));
  return {pages:result,featured,plans,extraTemplates,articleFlows,unplaced,pageBudget:budget,confidence:'estimated'};
}
