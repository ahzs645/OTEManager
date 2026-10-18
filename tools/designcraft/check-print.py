#!/usr/bin/env python3
"""Print-readiness check for OTE PDFs, measured against PDFs the printer has accepted.

  python3 tools/designcraft/check-print.py output/issue.pdf [--baseline accepted/*.pdf ...] [--json report.json]

Each PDF is profiled: page count and size, trim/bleed boxes, PDF version, PDF/X
identification and output intent, font embedding, image resolution (effective ppi
of every placement) and image colour spaces. With --baseline, the candidate is
compared with the envelope of the accepted PDFs (for OTE: the files sent to the
Prince George Citizen press, which are PDF 1.4, RGB, 756x792 pt, trim = page, no
bleed, every font embedded). A candidate passes when it is at least as
print-ready as everything the printer took. This is a structural check; it does
not replace a press proof.

Requires PyMuPDF (tools/designcraft/requirements-audit.txt).
"""
import argparse
import json
import re
import sys
from pathlib import Path

import pymupdf


def profile(path):
    doc = pymupdf.open(path)
    catalog = doc.xref_object(doc.pdf_catalog(), compressed=True)
    trailer_info = doc.metadata or {}
    pages, fonts, images = [], {}, []
    for page in doc:
        trim, bleed = page.trimbox, page.bleedbox
        pages.append(dict(size=[round(page.rect.width, 2), round(page.rect.height, 2)],
                          trim=[round(v, 2) for v in trim], bleed=[round(v, 2) for v in bleed]))
        for xref, ext, kind, name, *_ in page.get_fonts(full=True):
            # ext 'n/a' means no font program; Type3 fonts carry their glyphs as drawings instead.
            fonts[name or f'{kind} #{xref}'] = dict(type=kind, embedded=ext != 'n/a' or kind == 'Type3', subset='+' in (name or ''))
        for info in page.get_image_info(xrefs=True):
            bbox, w, h = info['bbox'], info['width'], info['height']
            shown_w, shown_h = (bbox[2] - bbox[0]) / 72, (bbox[3] - bbox[1]) / 72
            if shown_w <= 0 or shown_h <= 0:
                continue
            ppi = min(w / shown_w, h / shown_h)
            images.append(dict(page=page.number + 1, pixels=[w, h], ppi=round(ppi, 1),
                               colorspace=info.get('colorspace_name') or str(info.get('cs-name', '')),
                               shown=[round(v, 1) for v in bbox]))
    intents = [doc.xref_object(int(x)) for x in re.findall(r'(\d+) 0 R', catalog.split('/OutputIntents', 1)[1].split(']', 1)[0])] if '/OutputIntents' in catalog else []
    xmp = doc.get_xml_metadata() or ''
    pdfx = any('GTS_PDFX' in intent for intent in intents) or 'GTS_PDFXVersion' in xmp
    return dict(
        file=str(path), pdfVersion=(trailer_info.get('format') or '').replace('PDF ', ''),
        producer=trailer_info.get('producer'), creator=trailer_info.get('creator'),
        pageCount=doc.page_count, pageSizes=sorted({tuple(p['size']) for p in pages}),
        trimEqualsPage=all(p['trim'] == [0, 0, p['size'][0], p['size'][1]] for p in pages),
        bleed=max((max(p['bleed'][2] - p['trim'][2], p['trim'][0] - p['bleed'][0]) for p in pages), default=0),
        pdfx=pdfx, outputIntent='/OutputIntents' in catalog,
        fonts=dict(count=len(fonts), notEmbedded=sorted(n for n, f in fonts.items() if not f['embedded']),
                   type3=sorted(n for n, f in fonts.items() if f['type'] == 'Type3')),
        images=dict(count=len(images), minPpi=min((i['ppi'] for i in images), default=None),
                    below150=[i for i in images if i['ppi'] < 150],
                    colorspaces=sorted({i['colorspace'] for i in images})),
    )


def compare(candidate, baselines):
    """Problems (block printing) and notes (differ from accepted files without being worse)."""
    problems, notes = [], []
    sizes = {s for b in baselines for s in b['pageSizes']}
    for size in candidate['pageSizes']:
        if size not in sizes:
            problems.append(f'Page size {size[0]}x{size[1]} pt differs from the accepted {sorted(sizes)}')
    if candidate['fonts']['notEmbedded']:
        problems.append('Fonts not embedded: ' + ', '.join(candidate['fonts']['notEmbedded']))
    if candidate['fonts']['type3'] and not any(b['fonts']['type3'] for b in baselines):
        notes.append(f"{len(candidate['fonts']['type3'])} Type3 font(s) (glyphs drawn as vector procedures; valid in PDF/X-4, worth a look on the press proof)")
    if not candidate['trimEqualsPage'] and all(b['trimEqualsPage'] for b in baselines):
        notes.append('Trim box differs from the page box (the accepted files trim at the page edge)')
    floor = min((b['images']['minPpi'] for b in baselines if b['images']['minPpi']), default=150)
    if candidate['images']['minPpi'] is not None and candidate['images']['minPpi'] < min(150, floor):
        problems.append(f"Lowest image resolution {candidate['images']['minPpi']} ppi is below 150 ppi and below the accepted files' {floor} ppi")
    elif candidate['images']['below150']:
        notes.append(f"{len(candidate['images']['below150'])} image placement(s) under 150 ppi (the accepted files go down to {floor} ppi)")
    accepted_spaces = {c for b in baselines for c in b['images']['colorspaces']}
    extra = set(candidate['images']['colorspaces']) - accepted_spaces
    if extra:
        notes.append('Image colour spaces not seen in the accepted files: ' + ', '.join(sorted(extra)))
    if candidate['pdfx'] and not any(b['pdfx'] for b in baselines):
        notes.append('Candidate is PDF/X with an output intent; the accepted files are plain PDF (stricter, not a problem)')
    if not candidate['pdfx'] and any(b['pdfx'] for b in baselines):
        problems.append('Accepted files are PDF/X; the candidate is not')
    if candidate['bleed'] < min(b['bleed'] for b in baselines) - 0.5:
        problems.append('Candidate has less bleed than the accepted files')
    if candidate['pageCount'] % 4:
        notes.append(f"{candidate['pageCount']} pages: a saddle-stitched issue needs a multiple of four")
    return problems, notes


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument('pdf', type=Path, nargs='+')
    parser.add_argument('--baseline', type=Path, nargs='*', default=[])
    parser.add_argument('--json', type=Path)
    args = parser.parse_args()
    baselines = [profile(p) for p in args.baseline]
    report = dict(baseline=baselines, candidates=[])
    failed = False
    for pdf in args.pdf:
        result = profile(pdf)
        if baselines:
            result['problems'], result['notes'] = compare(result, baselines)
            failed |= bool(result['problems'])
        report['candidates'].append(result)
        status = 'FAIL' if result.get('problems') else 'ok'
        print(f"{status:4} {pdf.name}: {result['pageCount']} pages {result['pageSizes']}, PDF {result['pdfVersion']}"
              f"{', PDF/X' if result['pdfx'] else ''}, fonts {result['fonts']['count']} (not embedded {len(result['fonts']['notEmbedded'])}),"
              f" images {result['images']['count']} (min {result['images']['minPpi']} ppi)")
        for line in result.get('problems', []):
            print('     problem:', line)
        for line in result.get('notes', []):
            print('     note:', line)
    if args.json:
        args.json.write_text(json.dumps(report, indent=2, default=list) + '\n')
    sys.exit(1 if failed else 0)


if __name__ == '__main__':
    main()
