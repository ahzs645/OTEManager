#!/usr/bin/env node
// The downloadable compiler kit uses the same modules/fonts/engine as the app.
// Source page recipes carry their selected artwork, rather than requiring every
// archive panel in every toolkit download.
import JSZip from 'jszip';
import { createHash } from 'node:crypto';
import { readFile, readdir, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root=resolve(dirname(fileURLToPath(import.meta.url)),'../..'), zip=new JSZip();
async function add(file,name=file){zip.file(name,await readFile(join(root,file)));}
async function tree(directory){for(const entry of await readdir(join(root,directory),{withFileTypes:true})){const file=directory+'/'+entry.name;if(entry.isDirectory())await tree(file);else if(entry.isFile())await add(file);}}
for(const directory of ['public/designcraft/compiler','public/designcraft/headless','public/designcraft/original-art','public/designcraft/assets'])await tree(directory);
for(const name of ['templates.json','source-presets.json','documents.json']){await add('public/designcraft/'+name);await add('public/designcraft/'+name,name);}
for(const entry of await readdir(join(root,'tools/designcraft'),{withFileTypes:true}))if(entry.isFile()&&/\.(mjs|py|md|txt)$/.test(entry.name)){
 await add('tools/designcraft/'+entry.name);
 if(/\.(py|md|txt)$/.test(entry.name))await add('tools/designcraft/'+entry.name,entry.name);
}
// Root aliases retain the existing Python/CLI workflow for classic recipes.
for(const directory of ['assets']){
 const files=await readdir(join(root,'public/designcraft',directory),{recursive:true,withFileTypes:true});
 for(const entry of files)if(entry.isFile()){
  const full=join(entry.parentPath,entry.name),relative=full.slice(join(root,'public/designcraft').length+1);
  zip.file(relative,await readFile(full));
 }
}
zip.file('package.json',JSON.stringify({name:'ote-designcraft-toolkit',private:true,type:'module',dependencies:{jszip:'3.10.1','markdown-it':'14.1.0'}},null,2)+'\n');
zip.file('README.txt',`OTE DesignCraft compiler toolkit

The app's browser composer needs no installation. For offline composition:

1. Export a page or issue recipe from OTEManager. Extract it in a separate folder.
   Each recipe carries its selected source artwork and original issue media.
2. Extract this toolkit and run npm install in its root (Node.js 24).
3. For a whole issue:
   node tools/designcraft/compile.mjs --library /path/to/recipe/templates.json --issue /path/to/recipe/issue.json --output /path/to/output
4. For one page, add --template TEMPLATE_ID --page-number N --articles ID1,ID2.
   A fixed section without articles uses --template TEMPLATE_ID with no --articles.

The committed WebAssembly engine produces editable DesignCraft, PDF and IDML.
--cli /path/to/designcraft-cli selects the native executor. --font-dir DIR
--font-profile original2025 uses private original fonts and reports substitutions.
Full source copy is retained. Preflight blocks final output when copy oversets.
Source template notes distinguish editable text from preserved source artwork.
Supplied historical dates, board members and advertisements stay historical.

Classic recipes can still use the Python scripts at the toolkit root after
pip install -r requirements.txt. Source/house designs use the JavaScript command.
The full historical PDF archive and native example gallery remain in OTEManager;
they are not required to compile exported recipes. Adobe/press approval is separate.
`);
const bytes=await zip.generateAsync({type:'nodebuffer',compression:'DEFLATE',compressionOptions:{level:6}});
const target=join(root,'public/designcraft/template-kit.zip');await writeFile(target,bytes);
const digest=createHash('sha256').update(bytes).digest('hex');
await writeFile(target+'.sha256',digest+'  template-kit.zip\n');
console.log(JSON.stringify({bytes:bytes.length,sha256:digest}));
