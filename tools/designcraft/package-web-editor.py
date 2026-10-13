#!/usr/bin/env python3
"""Package the vendored web editor and verify its exact upstream WASM module."""
from pathlib import Path
import gzip,hashlib,json,zipfile
ROOT=Path(__file__).resolve().parents[2]
EDITOR=ROOT/'public/designcraft/editor'
manifest=json.loads((EDITOR/'wasm-manifest.json').read_text())
chunks=[]
for part in manifest['parts']:
 data=(EDITOR/part['file']).read_bytes()
 if len(data)!=part['compressedBytes'] or hashlib.sha256(data).hexdigest()!=part['compressedSha256']:raise ValueError('Compressed engine piece mismatch: '+part['file'])
 raw=gzip.decompress(data)
 if len(raw)!=part['bytes'] or hashlib.sha256(raw).hexdigest()!=part['sha256']:raise ValueError('Engine piece mismatch: '+part['file'])
 chunks.append(raw)
raw=b''.join(chunks)
if len(raw)!=manifest['bytes'] or hashlib.sha256(raw).hexdigest()!=manifest['sha256']:raise ValueError('Complete engine module mismatch')
output=ROOT/'public/designcraft/web-editor.zip'
with zipfile.ZipFile(output,'w',zipfile.ZIP_DEFLATED,compresslevel=6) as archive:
 for file in sorted(EDITOR.rglob('*')):
  if file.is_file():archive.write(file,'editor/'+str(file.relative_to(EDITOR)))
 archive.writestr('README.txt','DesignCraft web 0.7.1 — vendored official browser editor\n\nServe the extracted folder from HTTPS or localhost and open editor/index.html.\nFor example: python3 -m http.server 8000\nThen open http://localhost:8000/editor/index.html\nUse File → Open / Save / Export in the browser editor.\nNo desktop DesignCraft or local CLI is required.\nOriginal private OTE fonts are not included.\nThe wrapper checks every engine piece and the complete unchanged upstream WASM.\nLicences and provenance are in editor/.\n')
digest=hashlib.sha256(output.read_bytes()).hexdigest();output.with_suffix('.zip.sha256').write_text(digest+'  web-editor.zip\n')
print(json.dumps({'archive':str(output),'bytes':output.stat().st_size,'sha256':digest,'engineVersion':manifest['release'],'moduleVerified':True}))
