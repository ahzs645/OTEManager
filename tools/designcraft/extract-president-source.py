#!/usr/bin/env python3
"""Extract the March 2025 President artwork without flattening its editable text.

PyMuPDF removes only PDF text operators: the portrait, grid, paper texture and
vector speech bubbles remain. Source bounds and typography are measured from
the supplied PDF, recorded in the sidecar, and used by the source layout preset.
"""
import hashlib
import json
from pathlib import Path

import fitz

ROOT = Path(__file__).resolve().parents[2]
SOURCE = ROOT / 'public/designcraft/originals/issue-7-march-2025-dfcbb959.pdf'
OUTPUT = ROOT / 'public/designcraft/source-art'
CLIP = fitz.Rect(374.69854736328125, 400.0000305175781,
                 717.664306640625, 757.4400024414062)
TEXTS = [
    dict(role='heading', text='President  Answers',
         rect=[467.9007873535156, 401.82928466796875, 647.7307739257812, 429.20928955078125],
         fontFamily='Decalotype', fontStyle='Black', size=20),
    dict(role='subtitle', text='Getting the Answers You Crave: We Ask, the\nPresident Delivers!',
         rect=[426.7685852050781, 432.42120361328125, 667.6661987304688, 465.5172119140625],
         fontFamily='Helvetica Neue', fontStyle='Regular', size=12),
    dict(role='question', text='Pineapple on pizza—\nyes or no?',
         rect=[423.3599853515625, 560.80078125, 549.4185180664062, 599.0358276367188],
         fontFamily='Minion Pro', fontStyle='Regular', size=15),
    dict(role='answer', text='I really like pizza but I would\nbe a no for pineapple on mine',
         rect=[498.9599914550781, 633.2698974609375, 677.9673461914062, 671.5049438476562],
         fontFamily='Minion Pro', fontStyle='Regular', size=15, fill='white'),
]


def main():
    OUTPUT.mkdir(parents=True, exist_ok=True)
    document = fitz.open(SOURCE)
    page = document[5]
    spans = [span for block in page.get_text('dict')['blocks'] if 'lines' in block
             for line in block['lines'] for span in line['spans']
             if fitz.Rect(span['bbox']).intersects(CLIP)]
    for kind in ['original', 'background']:
        if kind == 'background':
            for span in spans:
                page.add_redact_annot(span['bbox'], fill=False, cross_out=False)
            page.apply_redactions(images=0, graphics=0, text=0)
        crop = fitz.open()
        cropped = crop.new_page(width=CLIP.width, height=CLIP.height)
        cropped.show_pdf_page(cropped.rect, document, 5, clip=CLIP)
        if kind == 'background':
            assert not cropped.get_text().strip(), 'Background still contains source text'
        assert len(cropped.get_images()) == 3, 'Source illustration or portrait was lost'
        crop.save(OUTPUT / f'march-president-{kind}.pdf', garbage=4, deflate=True)
        crop.close()
    metadata = dict(
        source=str(SOURCE.relative_to(ROOT)),
        sourceSha256=hashlib.sha256(SOURCE.read_bytes()).hexdigest(), page=6,
        clip=list(CLIP), background='source-art/march-president-background.pdf',
        backgroundConstruction='Vector PDF crop; removed only PDF text operators in the clip with '
            'PyMuPDF redaction (images=0, graphics=0, text=0). Original background images, portrait '
            'and vector speech bubbles retained.',
        texts=TEXTS,
    )
    (OUTPUT / 'march-president-source.json').write_text(json.dumps(metadata, indent=2) + '\n')


if __name__ == '__main__':
    main()
