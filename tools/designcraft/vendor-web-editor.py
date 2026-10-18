#!/usr/bin/env python3
"""Vendor a DesignCraft web build into public/designcraft/editor/.

  python3 tools/designcraft/vendor-web-editor.py --official designcraft-web-0.9.0.zip \
      [--wasm designcraft-web_bg.wasm --glue designcraft-web.js --patch packages/designcraft-web/add-font.patch]

Without --wasm/--glue the official module is vendored unchanged. With them, the
supplied build of the same release (the official source plus the committed
add-font patch, built with wasm-bindgen --weak-refs, no wasm-opt) is used and
recorded in OTE-PROVENANCE.json. The module is split into 10 MiB gzip pieces,
named by their compressed SHA-256 prefix, and checked by the wrapper page.
"""
import argparse
import gzip
import hashlib
import json
from pathlib import Path
import re
import shutil
import zipfile

ROOT = Path(__file__).resolve().parents[2]
EDITOR = ROOT / 'public/designcraft/editor'
PIECE = 10 * 1024 * 1024
KEEP = ('LICENSE-MIT', 'LICENSE-APACHE', 'README.md', 'HOSTING.md', '_headers', '.htaccess')


def sha(data):
    return hashlib.sha256(data).hexdigest()


WRAPPER = r'''<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1, user-scalable=no">
  <title>DesignCraft</title>

<script type="module">
import init, * as bindings from './__GLUE__';
try {
const manifest = await (await fetch('./wasm-manifest.json')).json();
const sha = async data => [...new Uint8Array(await crypto.subtle.digest('SHA-256', data))].map(v=>v.toString(16).padStart(2,'0')).join('');
const parts = await Promise.all(manifest.parts.map(async part => {const response=await fetch('./'+part.file);if(!response.ok)throw Error('DesignCraft engine download failed');const compressed=new Uint8Array(await response.arrayBuffer());let data;if(compressed.length===part.bytes&&await sha(compressed)===part.sha256){data=compressed}else{if(compressed.length!==part.compressedBytes||await sha(compressed)!==part.compressedSha256)throw Error('DesignCraft engine download integrity failed');const stream=new Blob([compressed]).stream().pipeThrough(new DecompressionStream('gzip'));data=new Uint8Array(await new Response(stream).arrayBuffer())}if(data.length!==part.bytes||await sha(data)!==part.sha256)throw Error('DesignCraft engine integrity check failed');return data}));
const bytes = new Uint8Array(manifest.bytes);let offset=0;for(const part of parts){bytes.set(part,offset);offset+=part.length}if(await sha(bytes)!==manifest.sha256)throw Error('DesignCraft engine checksum mismatch');
const wasm = await init({ module_or_path: bytes });
let readySent=false;const reportReady=()=>{const loading=document.getElementById('designcraft_loading');if(!readySent&&(!loading||getComputedStyle(loading).display==='none')){readySent=true;window.parent.postMessage({type:'ote.designcraft.ready',fonts:typeof bindings.add_font==='function'},location.origin)}};new MutationObserver(reportReady).observe(document.documentElement,{subtree:true,childList:true,attributes:true});reportReady();
window.addEventListener('message',event=>{if(event.origin!==location.origin||event.source!==window.parent)return;
if(event.data?.type==='ote.designcraft.fonts'&&Array.isArray(event.data.fonts)){let faces=0,accepted=0;if(typeof bindings.add_font==='function')for(const font of event.data.fonts.slice(0,64)){if(font?.bytes instanceof ArrayBuffer&&font.bytes.byteLength<=64*1024*1024&&/\.(ttf|otf|ttc|otc)$/i.test(String(font.name||''))){faces+=bindings.add_font(new Uint8Array(font.bytes));accepted++}}window.parent.postMessage({type:'ote.designcraft.fonts-loaded',accepted,faces,supported:typeof bindings.add_font==='function'},location.origin);return}
if(event.data?.type!=='ote.designcraft.open'||!(event.data.bytes instanceof ArrayBuffer)||event.data.bytes.byteLength>64*1024*1024)return;const name=String(event.data.name||'ote-sample.idml');if(!/\.(idml|designcraft)$/i.test(name))return;const transfer=new DataTransfer();transfer.items.add(new File([event.data.bytes],name,{type:'application/zip'}));const canvas=document.getElementById('designcraft_canvas');canvas.dispatchEvent(new DragEvent('drop',{dataTransfer:transfer,bubbles:true,cancelable:true}));canvas.focus();window.parent.postMessage({type:'ote.designcraft.received'},location.origin)});
window.wasmBindings = bindings;


dispatchEvent(new CustomEvent("TrunkApplicationStarted", {detail: {wasm}}));
} catch(error) {const loading=document.getElementById("designcraft_loading");if(loading)loading.textContent="DesignCraft could not load: "+error.message;window.parent.postMessage({type:"ote.designcraft.error",message:error.message},location.origin);console.error(error);}

</script>
  <style>
    html, body { margin: 0; padding: 0; width: 100%; height: 100%; overflow: hidden; background: #262626; }
    #designcraft_canvas { position: absolute; inset: 0; width: 100%; height: 100%; display: block; }
    #designcraft_loading { position: absolute; inset: 0; display: flex; flex-direction: column; align-items: center; justify-content: center;
      color: #b8b8b8; font: 14px system-ui, sans-serif; pointer-events: none; }
  </style>
</head>
<body>
  <canvas id="designcraft_canvas"></canvas>
  <div id="designcraft_loading">Loading DesignCraft&hellip;</div>
</body>
</html>
'''


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--official', type=Path, required=True, help='Official designcraft-web-<version>.zip')
    parser.add_argument('--wasm', type=Path, help='Patched build of the same release (optimised _bg.wasm)')
    parser.add_argument('--glue', type=Path, help='wasm-bindgen glue for --wasm')
    parser.add_argument('--patch', type=Path, help='Source patch applied for --wasm')
    args = parser.parse_args()
    if bool(args.wasm) != bool(args.glue):
        parser.error('--wasm and --glue go together')
    archive = zipfile.ZipFile(args.official)
    version = re.search(r'designcraft-web-(\d+\.\d+\.\d+)', args.official.name).group(1)
    prefix = f'designcraft-web-{version}/'
    names = archive.namelist()
    official_wasm = next(n for n in names if n.endswith('_bg.wasm'))
    official_glue = official_wasm.replace('_bg.wasm', '.js')
    wasm = args.wasm.read_bytes() if args.wasm else archive.read(official_wasm)
    glue = args.glue.read_bytes() if args.glue else archive.read(official_glue)
    glue_name = f'designcraft-web-{sha(glue)[:16]}.js'
    shutil.rmtree(EDITOR, ignore_errors=True)
    EDITOR.mkdir(parents=True)
    for name in KEEP:
        if prefix + name in names:
            (EDITOR / name).write_bytes(archive.read(prefix + name))
    (EDITOR / glue_name).write_bytes(glue)
    parts = []
    for index, start in enumerate(range(0, len(wasm), PIECE)):
        raw = wasm[start:start + PIECE]
        compressed = gzip.compress(raw, compresslevel=9, mtime=0)
        file = f'engine-part-{index}.{sha(compressed)[:16]}.bin.gz'
        (EDITOR / file).write_bytes(compressed)
        parts.append(dict(file=file, bytes=len(raw), sha256=sha(raw), compressedBytes=len(compressed), compressedSha256=sha(compressed), compression='gzip'))
    manifest = dict(release=version, originalFile=Path(args.wasm).name if args.wasm else Path(official_wasm).name,
                    bytes=len(wasm), sha256=sha(wasm), parts=parts)
    (EDITOR / 'wasm-manifest.json').write_text(json.dumps(manifest, indent=2) + '\n')
    (EDITOR / 'index.html').write_text(WRAPPER.replace('__GLUE__', glue_name))
    patched = bool(args.wasm)
    provenance = dict(
        engine='DesignCraft web' + (' (OTE build: official source + add_font export)' if patched else ' (official)'),
        version=version, release=f'https://github.com/storytold/designcraft/releases/tag/v{version}',
        archive=args.official.name, archiveSha256=sha(args.official.read_bytes()),
        officialModuleSha256=sha(archive.read(official_wasm)), moduleSha256=sha(wasm),
        moduleUnchanged=not patched, upstreamGlueUnchanged=not patched,
        patch=(dict(file=str(args.patch.resolve().relative_to(ROOT)) if args.patch else None,
                    sha256=sha(args.patch.read_bytes()) if args.patch else None,
                    summary='apps/designcraft-web exports add_font(bytes) → FontDb::global().add_font; no engine changes',
                    build='cargo build --release -p designcraft-web --target wasm32-unknown-unknown; wasm-bindgen --target web --weak-refs',
                    optimisation='none: wasm-opt from binaryen 108 produced a module whose externref table could not grow at start-up; '
                                 'gzipped, the unoptimised module is within about 5% of the official optimised one') if patched else None),
        wrapper='Same-origin document and font handoff, chunked module integrity checks and load-state messages.',
    )
    (EDITOR / 'OTE-PROVENANCE.json').write_text(json.dumps(provenance, indent=2) + '\n')
    print(json.dumps(dict(version=version, patched=patched, bytes=len(wasm), parts=len(parts),
                          compressed=sum(p['compressedBytes'] for p in parts))))


if __name__ == '__main__':
    main()
