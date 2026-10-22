#!/usr/bin/env node
// Diagnose every page, including pages after the first issue-level fit failure.
import {mkdir,readFile,readdir,writeFile} from 'node:fs/promises';
import {dirname,join,resolve} from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import JSZip from 'jszip';
import markdownit from 'markdown-it';
import {buildPage,compilePage} from '../../public/designcraft/compiler/page-compiler.js';
import {loadHeadlessEngine,wasmExecutor} from '../../public/designcraft/compiler/executors.js';
import {readNative,walkItems} from '../../public/designcraft/compiler/native-doc.js';
const root=resolve(dirname(fileURLToPath(import.meta.url)),'../..'),staticDir=join(root,'public/designcraft');
const output=join(root,'artifacts/source-reconstruction/whole-issues');
const base=pathToFileURL(join(staticDir,'headless')+'/').href;
const {Engine}=await loadHeadlessEngine(base,async name=>new Uint8Array(await readFile(new URL(name,base))));
const executor=wasmExecutor(Engine);
const fonts=await Promise.all((await readdir(join(staticDir,'assets/fonts'))).map(async name=>({name,bytes:new Uint8Array(await readFile(join(staticDir,'assets/fonts',name)))})));
const report={issues:[]};await mkdir(output,{recursive:true});
for(const input of process.argv.slice(2)){
 const path=resolve(input),issue=JSON.parse(await readFile(path,'utf8')),library=JSON.parse(await readFile(join(dirname(path),'templates.json'),'utf8'));
 const result={documentId:issue.sourceIssue.documentId,mode:issue.sourceIssue.mode,pages:[]};
 const loadMedia=async({root:scope,path:relative})=>{
  for(const directory of scope==='library'?[staticDir]:[dirname(path),staticDir]){try{return new Uint8Array(await readFile(join(directory,relative)));}catch{}}
  return null;
 };
 for(const p of issue.layoutPlan.pages){
  const record={pageNumber:p.pageNumber,templateId:p.templateId,status:'failed'};
  try{
   const built=await buildPage({library,templateId:p.templateId,issue,articleIds:p.articleIds,pageId:p.id,pageNumber:p.pageNumber,markdownit,loadMedia});
   const {artifacts}=await compilePage(built,{executor,fonts,JSZip});record.status='exported';record.errors=artifacts.preflight.errors;
  }catch(error){
   record.error=error.message;
   const artifacts=error.artifacts;
   if(artifacts?.native){
    const {document}=await readNative(artifacts.native,JSZip),items=document.spreads.flatMap(s=>[...walkItems(s.items)]);
    record.errors=artifacts.preflight.issues.filter(i=>i.severity==='error').map(i=>{
     const item=items.find(o=>o.id===i.item);return {...i,itemName:item?.name,label:item?.label,text:item?.content?.type==='text'?document.stories[String(item.content.story)].text:undefined};
    });
    const directory=join(output,'fit',issue.sourceIssue.documentId);await mkdir(directory,{recursive:true});
    await writeFile(join(directory,'page-'+p.pageNumber+'.designcraft'),artifacts.native);
    await writeFile(join(directory,'page-'+p.pageNumber+'.png'),await executor.renderPng(artifacts.native,{page:0,scale:1}));
   }
  }
  result.pages.push(record);console.log(JSON.stringify({documentId:result.documentId,...record}));
 }
 report.issues.push(result);await writeFile(join(output,'fit-report.json'),JSON.stringify(report,null,2)+'\n');
}
if(report.issues.some(i=>i.pages.some(p=>p.status!=='exported')))process.exitCode=1;
