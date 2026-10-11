#!/usr/bin/env python3
"""Package the reconstructed review without credentials or the source archive."""
import argparse
import hashlib
import json
import shutil
import zipfile
from pathlib import Path
import fitz
from reportlab.pdfgen import canvas
from reportlab.lib.colors import HexColor

REPO=Path(__file__).resolve().parents[2]
ROOT=REPO/'public/designcraft'


def notes_pdf():
    c=canvas.Canvas(str(ROOT/'pdfs/implementation-guide.pdf'),pagesize=(756,792));c.setTitle('OTE DesignCraft reconstructed workflow')
    pages=[('What was recovered',[
        '12 distinct source PDFs, with 156 pages, and 12 IDML files were recovered from the supplied Drive archive.',
        'The earlier custom prototype and its generated ZIP files were not recovered. Recipes and tools here are newly recreated.',
        'Byte-identical PDFs are in originals/. Reading copies larger than 24 MiB were optimized for static hosting.',
        'Actual horizontal logo artwork and the stacked masthead from the September cover are included.',
        '104 recipes: 76 story layouts, 14 ads, six custom pieces, eight covers. Catalogue pages are schematic geometry.',
        'Native examples are generated through stock DesignCraft v0.4.0; their own preflight reports describe actual results.'
    ]),('Using OTEManager and DesignCraft',[
        '1. In OTEManager Publications, choose DesignCraft ZIP for an issue.',
        '2. Open Utilities > DesignCraft layouts, or the separate review Site. Import the issue ZIP.',
        '3. Choose one, two or three stories and their photo arrangement. Reserve custom pieces if required.',
        '4. Adjust shared questions/answers and boundaries. Download the page recipe ZIP and extract it.',
        '5. Run compile-template.py against templates.json and issue.json, with the stock CLI path.',
        '6. Inspect preflight.json. Overset blocks final export; the native draft retains the complete article text.',
        'The browser preview shows composition; it does not perform native font shaping or prove text fit.',
        'Issue JSON includes exact stored Markdown, original media bytes, captions and stable IDs. Missing media rejects export.'
    ]),('Fonts, covers and the double truck',[
        'The original PDFs preserve their rendered branding. New editable samples use licensed Source Sans 3 and Source Serif 4.',
        'Source 2025 covers reference Decalotype Black, Helvetica Neue Bold/Condensed Bold, and Salted. Salted file was not found.',
        'Original font references are documented. Proprietary font files are not redistributed in this package.',
        'The double truck is the continuous centre spread: 16 pages means 8/9; 20 pages means 10/11.',
        'A print-ready booklet requires a multiple-of-four page count. Several supplied 17-page issues are unfinished layouts.',
        'Recipes record cover/truck preservation requests. Native whole-issue preservation has not yet been rebuilt.',
        'The seven native examples passed DesignCraft preflight. Actual Adobe InDesign import has not been tested.',
        'Remaining integration: native export backend in OTEManager, exact original font profiles, whole-issue protection, and browser/WASM command bridge.'
    ])]
    import textwrap
    for title,paragraphs in pages:
        c.setFillColor(HexColor('#28624f'));c.setFont('Helvetica-Bold',24);c.drawString(36,744,title)
        c.setFont('Helvetica',11);c.drawString(36,720,'OTE DESIGNCRAFT REVIEW · RECOVERED SOURCES + RECONSTRUCTED TOOLS')
        y=680
        for p in paragraphs:
            for line in textwrap.wrap(p,width=100):c.drawString(36,y,line);y-=17
            y-=17
        c.setFont('Helvetica',9);c.drawString(36,30,'Source: user-supplied archive and stock DesignCraft v0.4.0. No recovered prototype claim.');c.showPage()
    c.save()


def catalogue():
    record=json.loads((ROOT/'documents.json').read_text())
    record['documents']=[d for d in record['documents'] if d['category']!='reconstructed']
    labels={'issue-1-sept':'September 2025 · Issue 1','issue-2-october':'October 2025 · Issue 2',
            'issue-5':'Winter 2025 · Issue 5','issue-7-march':'March 2025 · Issue 7'}
    for d in record['documents']:
        for prefix,title in labels.items():
            if d['id'].startswith(prefix):d['displayTitle']=title
        if d['id'].startswith('issue-6-feb'):d['displayTitle']='February 2025 · '+('archived revision' if '/Archive/' in d['sourcePaths'][0] else 'current revision')
        if d['id'].startswith('cover-page'):
            source=d['sourcePaths'][0]
            d['displayTitle']='November 2024 · Issue 3' if '20241114' in source else 'December 2024 · '+('final layout' if '/Final Issue 4/' in source else 'print archive')
    paths=[ROOT/'pdfs/reconstructed-template-catalogue.pdf',ROOT/'pdfs/implementation-guide.pdf']+sorted((ROOT/'native-examples').glob('*/page.pdf'))
    for p in paths:
        doc=fitz.open(p);name=p.parent.name if p.name=='page.pdf' else p.stem
        thumb=ROOT/'thumbnails'/('proof-'+name+'.jpg');doc[0].get_pixmap(matrix=fitz.Matrix(.55,.55),alpha=False).save(thumb)
        title=('Native DesignCraft · '+name.replace('-',' ')) if p.name=='page.pdf' else p.stem.replace('-',' ').title()
        record['documents'].append({'id':'proof-'+name,'title':title,'category':'reconstructed','pages':len(doc),'bytes':p.stat().st_size,
            'pdf':str(p.relative_to(ROOT)),'thumbnail':str(thumb.relative_to(ROOT)),'sourcePaths':[], 'sha256':hashlib.sha256(p.read_bytes()).hexdigest()})
    (ROOT/'documents.json').write_text(json.dumps(record,indent=2))


def package(site_path,full_path):
    tools=REPO/'tools/designcraft'
    with zipfile.ZipFile(ROOT/'template-kit.zip','w',zipfile.ZIP_DEFLATED,compresslevel=6) as z:
        for name in ['templates.json','README.txt','documents.json']:z.write(ROOT/name,name)
        for p in sorted(tools.glob('*')):
            if p.is_file() and p.suffix in ['.py','.md','.cjs']:z.write(p,p.name)
        for folder in ['assets','native-examples','source-idml']:
            for p in sorted((ROOT/folder).rglob('*')):
                if p.is_file() and p.name not in ['commands-stdout.json','commands-stderr.txt','document-inspect.json','export-stdout.json','export-stderr.txt'] and not (folder=='native-examples' and 'Document Fonts' in p.parts):z.write(p,str(p.relative_to(ROOT)))
        for p in [ROOT/'pdfs/reconstructed-template-catalogue.pdf',ROOT/'pdfs/implementation-guide.pdf']:z.write(p,str(p.relative_to(ROOT)))
    if (ROOT/'template-kit.zip').stat().st_size>24*1024*1024:raise ValueError('Template kit exceeds hosting limit')
    if site_path:
        site=Path(site_path);dist=site/'dist';dist.mkdir(parents=True,exist_ok=True)
        for p in ROOT.iterdir():
            if p.name=='originals':continue
            if p.is_dir():shutil.copytree(p,dist/p.name,dirs_exist_ok=True)
            else:shutil.copyfile(p,dist/p.name)
    if full_path:
        with zipfile.ZipFile(full_path,'w',zipfile.ZIP_DEFLATED,compresslevel=6) as z:
            for p in ROOT.rglob('*'):
                if p.is_file():z.write(p,'review/'+str(p.relative_to(ROOT)))
            for p in tools.glob('*'):
                if p.is_file() and p.suffix in ['.py','.md','.cjs']:z.write(p,'tools/'+p.name)
            changes=['server/designcraft-export.ts','app/routes/utilities.designcraft.tsx','app/routes/utilities.index.tsx',
                     'app/routes/api/exportIssue.$issueId.ts','app/components/publications/IssueRow.tsx',
                     'app/components/publications/VolumeCard.tsx','tests/utilities.test.ts','docs/DESIGNCRAFT.md']
            for name in changes:
                p=REPO/name;z.write(p,'otemanager/'+str(p.relative_to(REPO)))
        digest=hashlib.sha256(Path(full_path).read_bytes()).hexdigest()
        Path(str(full_path)+'.sha256').write_text(digest+'  '+Path(full_path).name+'\n')
        print(json.dumps({'archive':str(full_path),'bytes':Path(full_path).stat().st_size,'sha256':digest}))


if __name__=='__main__':
    p=argparse.ArgumentParser();p.add_argument('--site');p.add_argument('--zip');args=p.parse_args()
    notes_pdf();catalogue();package(args.site,args.zip)
