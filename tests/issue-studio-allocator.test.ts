import { expect, test } from 'vitest';
// @ts-expect-error Browser compiler modules are plain JavaScript.
import { allocateFixedIssue } from '../public/designcraft/compiler/issue-allocator.js';
const story = (capacity = 100, id = 'story') => ({id,name:id,kind:'story',storyCount:1,capacity,slots:[]});
const cover = {id:'cover',name:'Cover',kind:'cover',storyCount:0,slots:[]};
const library = {templates:[story(),cover]};
const article = (id:string,length:number) => ({id,title:id,body:'x'.repeat(length)});
function harness() {
  const calls:any[]=[];
  const enumerateCandidates=(lib:any, articles:any[]) => lib.templates.filter((t:any)=>t.kind==='story'&&t.storyCount===articles.length).map((template:any)=>({template,order:articles,unusedPhotos:0}));
  const estimate=(candidate:any) => ({worstBody:Math.max(...candidate.order.map((a:any)=>a.body.length/candidate.template.capacity)),fill:1,headlineOver:0});
  const generatePageVariants=async(options:any)=>{
    calls.push(options);
    const candidates=enumerateCandidates(options.library,options.articleIds.map((id:string)=>options.issue.articles.find((a:any)=>a.id===id)));
    return {variants:candidates.filter((c:any)=>estimate(c).worstBody<=1).map((c:any)=>({template:c.template,articleIds:options.articleIds})),rejected:[]};
  };
  return {tools:{enumerateCandidates,estimate,generatePageVariants},calls};
}

test('fixed issue budget never grows or hides an oversized article', async()=>{
  const {tools}=harness();const issue={articles:[article('too-long',1000),article('short',50)]};
  const before=JSON.stringify(issue);
  const plan=await allocateFixedIssue({library,issue,pageBudget:3},tools);
  expect(plan.pages.map((p:any)=>p.pageNumber)).toEqual([1,2,3]);
  expect(plan.unplaced).toEqual(['too-long']);
  expect(plan.pages.find((p:any)=>p.pageNumber!==1&&p.articleIds.includes('short')).pageNumber).toBe(2);
  expect(plan.plans.some((p:any)=>p.error?.includes('Unplaced within the fixed 3-page budget'))).toBe(true);
  expect(JSON.stringify(issue)).toBe(before);
});

test('long copy is retained whole through an explicit estimated continuation chain',async()=>{
  const {tools,calls}=harness();const issue={articles:[article('long',260)]};
  const plan=await allocateFixedIssue({library,issue,pageBudget:5},tools);
  expect(plan.articleFlows.long.pageIds).toEqual(['page-2','page-3','page-4']);
  expect(plan.pages.filter((p:any)=>p.articleIds.includes('long'))).toHaveLength(4); // includes cover reference
  expect(plan.pages.filter((p:any)=>p.suggestionStatus==='estimated')).toHaveLength(5);
  expect(plan.unplaced).toEqual([]);expect(calls).toHaveLength(0);
  expect(issue.articles[0].body).toHaveLength(260);
  expect(plan.plans.some((p:any)=>p.error?.includes('Compose the whole issue'))).toBe(true);
});

test('protected pages remain byte-equivalent and their stories are not allocated twice',async()=>{
  const {tools}=harness();const issue={articles:[article('locked-story',50),article('new-story',50)]};
  const locked={id:'stable-3',pageNumber:3,template:story(),templateId:'story',articleIds:['locked-story'],mode:'replace',controls:{headline:'Keep me'},blocks:[]};
  const plan=await allocateFixedIssue({library,issue,pageBudget:4,existingPages:[locked],protectedPageIds:['stable-3']},tools);
  expect(plan.pages.find((p:any)=>p.id==='stable-3')).toEqual(locked);
  expect(plan.pages.filter((p:any)=>p.pageNumber!==1&&p.articleIds.includes('locked-story'))).toHaveLength(1);
  await expect(allocateFixedIssue({library,issue,articleIds:['new-story'],pageBudget:4,existingPages:[locked],protectedPageIds:['stable-3']},tools)).rejects.toThrow('protected page references unavailable');
});

test('reservations use the exact page library and full ad pages keep their footprint',async()=>{
  const {tools,calls}=harness();const issue={articles:[article('small',50)]};
  const reservation={id:'booked',pageNumber:2,kind:'booked-ad',rect:[36,36,684,720],assetPath:'assets/ad.png'};
  const plan=await allocateFixedIssue({library,issue,pageBudget:3,reservations:[reservation],pageLibraries:{1:library,2:{templates:[]},3:{templates:[story(60,'ad-aware')]}}},tools);
  expect(plan.pages[1].template.slots).toEqual([expect.objectContaining({id:'studio-reservation-booked',rect:[36,36,720,756],asset:'assets/ad.png',fit:'contain'})]);
  expect(plan.pages[2].articleIds).toEqual(['small']);
  expect(plan.pages[2].template.id).toBe('ad-aware@issue-page-3');
  expect(calls[0].library.templates[0].id).toBe('ad-aware');
  await expect(allocateFixedIssue({library,issue,pageBudget:3,reservations:[reservation]},tools)).rejects.toThrow('Reservation-aware');
});

test('continuations account for different ad-constrained capacity on each page',async()=>{
  const {tools}=harness();const issue={articles:[article('medium',130)]};
  const plan=await allocateFixedIssue({library,issue,pageBudget:3,pageLibraries:{1:library,2:{templates:[story(50,'quarter-ad')]},3:{templates:[story(100,'full-editorial')]}}},tools);
  expect(plan.articleFlows.medium.pageIds).toEqual(['page-2','page-3']);
  expect(plan.pages[1].template.id).toBe('quarter-ad@issue-page-2');
  expect(plan.pages[2].template.id).toBe('full-editorial@issue-page-3');
});

test('article priorities and eligible page ranges are honored',async()=>{
  const {tools}=harness();const issue={articles:[article('a',70),article('b',70)]};
  const plan=await allocateFixedIssue({library,issue,pageBudget:3,articleConstraints:{a:{allowedPages:[3]},b:{priority:10,allowedPages:[2]}}},tools);
  expect(plan.pages[1].articleIds).toEqual(['b']);expect(plan.pages[2].articleIds).toEqual(['a']);
  await expect(allocateFixedIssue({library,issue,pageBudget:3,articleConstraints:{a:{allowedPages:[4]}}},tools)).rejects.toThrow('within the issue budget');
});

test('invalid and duplicate page identities fail before composition',async()=>{
  const {tools,calls}=harness();const issue={articles:[article('a',20)]};
  await expect(allocateFixedIssue({library,issue,pageBudget:0},tools)).rejects.toThrow('budget');
  const page={id:'same',pageNumber:2,template:story(),articleIds:['a']};
  await expect(allocateFixedIssue({library,issue,pageBudget:3,existingPages:[page,{...page,pageNumber:3}]},tools)).rejects.toThrow('unique');
  expect(calls).toHaveLength(0);
});

test('protecting one continuation page preserves the complete existing chain',async()=>{
  const {tools}=harness();const issue={articles:[article('long',150)]};
  const existingPages=[2,3].map(pageNumber=>({id:'stable-'+pageNumber,pageNumber,template:story(),templateId:'story',articleIds:['long'],mode:'replace'}));
  const articleFlows={long:{pageIds:['stable-2','stable-3']}};
  const plan=await allocateFixedIssue({library,issue,pageBudget:4,existingPages,protectedPageIds:['stable-2'],articleFlows},tools);
  expect(plan.pages.filter((p:any)=>p.pageNumber===2||p.pageNumber===3)).toEqual(existingPages);
  expect(plan.articleFlows).toEqual(articleFlows);
  expect(plan.unplaced).toEqual([]);
});

test('reservation artwork uses the same archive reference as saved planner media',async()=>{
  const {tools}=harness();const issue={articles:[]};
  const plan=await allocateFixedIssue({library,issue,pageBudget:2,reservations:[{id:'fixed-ad',pageNumber:2,kind:'booked-ad',rect:[36,36,684,720],artworkPath:'issue-studio/issue/artwork-123.pdf'}],pageLibraries:{1:library,2:{templates:[]}}},tools);
  expect(plan.pages[1].template.slots[0].asset).toBe('assets/user-reservation-fixed-ad.pdf');
});

test('page-specific geometry gets distinct template identities for whole-issue compilation',async()=>{
  const {tools}=harness();const issue={articles:[article('long',130)]};
  const plan=await allocateFixedIssue({library,issue,pageBudget:3,pageLibraries:{1:library,2:{templates:[{...story(50,'same-pattern'),slots:[{id:'body',rect:[0,0,50,100]}]}]},3:{templates:[{...story(100,'same-pattern'),slots:[{id:'body',rect:[0,0,100,100]}]}]}}},tools);
  expect(plan.pages[1].templateId).not.toBe(plan.pages[2].templateId);
  const compiledTemplates=new Map(plan.extraTemplates.map((template:any)=>[template.id,template]));
  expect((compiledTemplates.get(plan.pages[1].templateId) as any).slots[0].rect).toEqual([0,0,50,100]);
  expect((compiledTemplates.get(plan.pages[2].templateId) as any).slots[0].rect).toEqual([0,0,100,100]);
  expect(plan.extraTemplates.some((template:any)=>template.id==='cover')).toBe(false);
});
