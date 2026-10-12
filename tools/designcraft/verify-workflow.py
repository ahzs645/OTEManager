#!/usr/bin/env python3
"""Audit every recipe and three IDML cycles; requires PyMuPDF for pixel checks."""
import argparse
from concurrent.futures import ThreadPoolExecutor
import hashlib
import json
from pathlib import Path
import shutil
import subprocess
import zipfile
import fitz
from interchange_metadata import save_metadata, restore_metadata


def write(path, value):
    path.write_text(json.dumps(value, ensure_ascii=False, indent=2))


def snapshot(path):
    with zipfile.ZipFile(path) as z:
        d = json.loads(z.read('document.json'))
        assets = sorted(hashlib.sha256(z.read(n)).hexdigest() for n in z.namelist() if n.startswith('assets/'))
    links = sorted((d['stories'][str(h['source']['story'])]['text'], h['source']['start'], h['source']['end'], h['dest']['value']) for h in d.get('hyperlinks', []) if h['source']['kind'] == 'text')
    parent_index = {p['id']: i for i,p in enumerate(d['parents'])}
    return dict(pages=sum(len(s['pages']) for s in d['spreads']), text=sorted(s['text'] for s in d['stories'].values()), assets=assets, hyperlinks=links,
                parentOverrides=[(parent_index.get(p.get('parent')),p.get('overridden',[]),p.get('showParentItems',True)) for s in d['spreads'] for p in s['pages']])


def render_compare(first, second):
    with fitz.open(first) as a, fitz.open(second) as b:
        if len(a) != len(b):
            return dict(samePages=False)
        differences=[]
        for pa,pb in zip(a,b):
            xa=pa.get_pixmap(matrix=fitz.Matrix(.5,.5),alpha=False)
            xb=pb.get_pixmap(matrix=fitz.Matrix(.5,.5),alpha=False)
            if (xa.width,xa.height)!=(xb.width,xb.height):
                differences.append(dict(sameSize=False));continue
            differences.append(dict(sameSize=True,meanChannelDifference=sum(abs(x-y) for x,y in zip(xa.samples,xb.samples))/len(xa.samples),identical=xa.samples==xb.samples))
        return dict(samePages=True,pages=differences)


def roundtrip(cli, native, pdf, out, cycles=3, restore_links=False, shared_fonts=False):
    baseline=snapshot(native);previous=native;result=[]
    fonts=native.parent/'Document Fonts'
    for i in range(cycles):
        directory=out/f'cycle-{i+1}';directory.mkdir(parents=True,exist_ok=True)
        if fonts.is_dir():
            if shared_fonts:
                target=directory/'Document Fonts'
                if not target.exists():target.symlink_to(fonts.resolve(),target_is_directory=True)
            else:shutil.copytree(fonts,directory/'Document Fonts',dirs_exist_ok=True)
        idml=directory/'document.idml';reopened=directory/'document.designcraft';rendered=directory/'document.pdf'
        metadata=directory/'interchange-metadata.json'
        save_metadata(previous,metadata)
        export=subprocess.run([cli,'run','--in',str(previous),'--export',str(idml)],capture_output=True,text=True,timeout=180)
        if export.returncode:raise ValueError(export.stderr)
        run=subprocess.run([cli,'run','--in',str(idml),'--cmd','preflight.run','--export',str(reopened)],capture_output=True,text=True,timeout=180)
        (directory/'stdout.jsonl').write_text(run.stdout);(directory/'stderr.txt').write_text(run.stderr)
        if run.returncode:raise ValueError(run.stderr)
        if restore_links:restore_metadata(reopened,metadata)
        script=directory/'render.dcs'
        script.write_text('file.open '+json.dumps({'path':str(reopened)})+'\nfile.exportPdf '+json.dumps({'path':str(rendered),'standard':'x4'})+'\n')
        rendering=subprocess.run([cli,'script',str(script)],capture_output=True,text=True,timeout=180)
        if rendering.returncode:raise ValueError(rendering.stderr)
        preflight=next(json.loads(l) for l in run.stdout.splitlines() if l.startswith('{') and '"issues"' in l)
        current=snapshot(reopened)
        result.append(dict(cycle=i+1,companionLinkRestore=restore_links,checks={k:baseline[k]==current[k] for k in baseline},preflight=preflight,visual=render_compare(pdf,rendered)))
        previous=reopened
    return result


def main():
    p=argparse.ArgumentParser(description=__doc__)
    p.add_argument('--library',type=Path,required=True);p.add_argument('--output',type=Path,required=True);p.add_argument('--cli',required=True);p.add_argument('--source-issue',type=Path)
    p.add_argument('--font-profile',choices=['portable','original2025'],default='portable')
    p.add_argument('--font-dir',type=Path)
    p.add_argument('--shared-fonts',action='store_true',help='Local audit only: symlink fonts instead of copying them into each output')
    args=p.parse_args();args.output.mkdir(parents=True,exist_ok=True)
    library=json.loads(args.library.read_text());compiler=Path(__file__).with_name('compile-template.py')
    def one(template):
        directory=args.output/template['id'];directory.mkdir(exist_ok=True)
        cmd=['python3',str(compiler),'--library',str(args.library),'--template',template['id'],'--output',str(directory),'--cli',args.cli]
        cmd+=['--font-profile',args.font_profile]
        if args.font_dir:
            cmd+=['--font-dir',str(args.font_dir)]
            if args.shared_fonts and not (directory/'Document Fonts').exists():
                (directory/'Document Fonts').symlink_to(args.font_dir.resolve(),target_is_directory=True)
        if args.source_issue:
            issue=json.loads(args.source_issue.read_text());article=issue['articles'][0]
            count=3 if template['kind']=='cover' else template.get('storyCount',0)
            issue['articles']=[{**article,'id':'source-test-'+str(i),'photos':[{**photo,'path':str((args.source_issue.parent/photo['path']).resolve())} for photo in article.get('photos',[])]} for i in range(count)]
            # Reusing one supplied story tests transport/fit; this is not an editorial issue.
            issue['illustrative']=True;write(directory/'input.json',issue);cmd+=['--issue',str(directory/'input.json')]
        built=subprocess.run(cmd,capture_output=True,text=True,timeout=180)
        (directory/'compiler-stderr.txt').write_text(built.stderr)
        result=dict(id=template['id'],returncode=built.returncode,error=built.stderr.strip())
        if (directory/'build-manifest.json').exists():
            manifest=json.loads((directory/'build-manifest.json').read_text());result.update(preflight=json.loads((directory/'preflight.json').read_text()),fullCopyRetained=manifest['copyPreserved'])
        if built.returncode==0:
            try:result['cycles']=roundtrip(args.cli,directory/'page.designcraft',directory/'page.pdf',directory/'roundtrip',shared_fonts=args.shared_fonts)
            except Exception as e:result['cycleError']=str(e)
        return result
    results=[]
    with ThreadPoolExecutor(max_workers=3) as pool:
        for result in pool.map(one,library['templates']):
            results.append(result);write(args.output/'results.json',results)
            print(json.dumps(dict(id=result['id'],returncode=result['returncode'],cycles=len(result.get('cycles',[])))),flush=True)
    print(json.dumps(dict(total=len(results),exported=sum(r['returncode']==0 for r in results),cycled=sum(len(r.get('cycles',[]))==3 for r in results))))


if __name__=='__main__':main()
