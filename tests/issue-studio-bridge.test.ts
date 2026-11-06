// @vitest-environment node
import { readFile } from 'node:fs/promises';
import { createContext, runInContext } from 'node:vm';
import { Window } from 'happy-dom';
import { afterEach, expect, test, vi } from 'vitest';
const windows:Window[]=[];
afterEach(async()=>{for(const window of windows.splice(0))await window.happyDOM.abort();});
async function bridge() {
  const dom=new Window({url:'https://ote.example/designcraft/index.html'});windows.push(dom);
  const controls=['page-number','release-date','volume','issue-number','cover-line','cover-caption','cover-teasers','focus-x','focus-y','page-count','truck-ids','cover-fit-titles','save-issue-page','planner-status','issue-plan-status'];
  for(const id of controls){const input=dom.document.createElement('input');input.id=id;dom.document.body.append(input);}
  for(const id of ['selected-template','browser-compose-design']){const select=dom.document.createElement('select');select.id=id;dom.document.body.append(select);}
  const listeners:Record<string,Function[]>={};const parent={postMessage:vi.fn()};
  const window={parent,addEventListener:(type:string,fn:Function)=>(listeners[type]??=[]).push(fn)};
  const context=createContext({document:dom.document,window,location:dom.location,URL,Blob,FormData,queueMicrotask,console,plannerReady:Promise.resolve(),fetch:vi.fn()});
  const app=await readFile(new URL('../public/designcraft/app.js',import.meta.url),'utf8');
  runInContext(app.slice(0,app.indexOf('\nfunction draw(')),context);
  runInContext(app.slice(app.indexOf('function validateBlock('),app.indexOf('\nfunction renderBlocks(')),context);
  runInContext(app.slice(app.indexOf('function baseFromSaved('),app.indexOf('\nasync function importIssue(')),context);
  runInContext(await readFile(new URL('../public/designcraft/cover-form.js',import.meta.url),'utf8'),context);
  runInContext(`
    let plannedPages=[];
    function renderPage(){} function renderIssuePlan(){} function saveIssuePage(){}
    function buildIssueZip(){} function buildPageZip(){} function renderBlocks(){} function renderAssignments(){}
    function validateMediaPath(path){if(typeof path!=='string'||path.includes('..'))throw Error('Invalid media path');}
    function choose(id,source){selected=copy(source);}
    $('release-date').value='2025-01-01';$('volume').value=1;$('issue-number').value=1;
    $('focus-x').value=50;$('focus-y').value=50;$('page-number').value=1;$('page-count').value=3;
    issue.articles=[{id:'a',title:'A source headline',body:'Full original copy',photos:[{id:'photo',path:'media/a/photo.jpg'}]}];
    library={templates:[],designs:{},page:{width:756,height:792}};
    selected={id:'selected',name:'Selected',kind:'custom',slots:[]};library.templates=[selected];
  `,context);
  await runInContext(await readFile(new URL('../public/designcraft/studio-bridge.js',import.meta.url),'utf8'),context);
  const load=async(data:any)=>{await listeners.message[0]({origin:dom.location.origin,source:parent,data:{type:'ote.studio.load',...data}});};
  const snapshot=()=>JSON.parse(runInContext('JSON.stringify(window.oteIssueStudio.snapshot())',context));
  return {load,snapshot,parent,context};
}
function input() {
  const cover={id:'cover',name:'Cover',kind:'cover',slots:[
    {id:'cover-date',role:'caption',rect:[36,30,400,60]},
    {id:'cover-year',role:'caption',rect:[36,62,400,80]},
    {id:'cover-issue',role:'caption',rect:[36,82,400,100]},
    {id:'cover-line',role:'caption',rect:[36,102,400,120]},
    {id:'cover-photo',role:'photo',rect:[36,122,720,420]},
  ]};
  const page=(n:number)=>({id:'page-'+n,pageNumber:n,articleIds:['a'],template:{id:'custom-'+n,name:'Custom '+n,kind:'custom',slots:[]},baseTemplate:{id:'custom-'+n,name:'Custom '+n,kind:'custom',slots:[]},blocks:[{id:'qa-'+n,type:'president-qa',name:'Interview',fieldKey:'qa',rect:[36,100,720,400]}],sharedFields:{qa:{question:'Page '+n+' question',answer:'Page '+n+' answer'}}});
  return {pageBudget:3,houseStyle:'classic',pages:[],placements:[],reservations:[],state:{
    templateId:'selected',baseTemplate:{id:'selected',kind:'custom',slots:[]},blocks:[],sharedFields:{qa:{question:'Active page question',answer:'Active page answer'}},
    controls:{'release-date':'2027-02-03','volume':'9','issue-number':'8','cover-line':'Saved cover line','page-number':'3'},
    savedPages:[{id:'page-1',pageNumber:1,template:cover,baseTemplate:cover,articleIds:['a'],blocks:[],sharedFields:{}},page(2),page(3)],
    issueBundle:{layoutPlan:{cover:{date:'2026-11-01',volume:4,number:2,line:'Old cover line',photoPath:'assets/cover-photo.png',articleIds:['a']}}}
  }};
}

test('reopening preserves per-page custom fields and restores cover controls before resolving recipes',async()=>{
  const {load,snapshot,parent}=await bridge();await load(input());
  expect(parent.postMessage.mock.calls.some(([message]:any[])=>message.type==='ote.studio.error')).toBe(false);
  const recipe=snapshot();
  expect(recipe.savedPages[1].template.slots[0].fields).toEqual({question:'Page 2 question',answer:'Page 2 answer'});
  expect(recipe.savedPages[2].template.slots[0].fields).toEqual({question:'Page 3 question',answer:'Page 3 answer'});
  const slots=new Map(recipe.savedPages[0].template.slots.map((slot:any)=>[slot.id,slot]));
  expect((slots.get('cover-date') as any).text).toBe('FEBRUARY 3');
  expect((slots.get('cover-year') as any).text).toBe('2027');
  expect((slots.get('cover-issue') as any).text).toBe('VOLUME 9 · ISSUE 8');
  expect((slots.get('cover-line') as any).text).toBe('Saved cover line');
  expect((slots.get('cover-photo') as any).asset).toBe('assets/cover-photo.png');
});

test('failed restoration rolls back the current recipe and media choices',async()=>{
  const {load,snapshot,parent}=await bridge();await load(input());const before=snapshot();
  const invalid:any=input();invalid.state.controls['cover-line']='Must not survive';
  invalid.state.mediaOverrides=[{articleId:'a',photoId:'photo',focus:{x:2,y:0.5}}];
  await load(invalid);
  expect(parent.postMessage.mock.calls.some(([message]:any[])=>message.type==='ote.studio.error'&&message.message.includes('focus'))).toBe(true);
  expect(snapshot()).toEqual(before);
});
