#!/usr/bin/env python3
"""Compare exported editable source presets with their supplied PDF regions.

Run check-source-reproduction.mjs first. Numerical differences cover only the
specified printed regions: they do not mistake a mostly blank page for a close
reconstruction. The artwork is retained from the PDF; text stays editable and
uses portable font substitutes, which account for much of the visible change.
"""
import json
from pathlib import Path

import fitz
import matplotlib
matplotlib.use('Agg')
import matplotlib.pyplot as plt
import numpy as np

ROOT = Path(__file__).resolve().parents[2]
STATIC = ROOT / 'public/designcraft'
OUTPUT = ROOT / 'artifacts/source-reconstruction'
REVIEW = ROOT / 'docs/designcraft-review'
CASES = [
    ('source-2024-president-qa', 'President Answers · March source p6', [374.6985, 400, 717.6643, 757.44]),
    ('source-2025-president-qa', 'Interim-President · October source p4', [54.622, 69.39, 676.838, 439]),
    ('source-2024-inside-edge-editable', 'Inside the Edge · March source p5', [39, 374, 717, 759]),
    ('source-2024-cfur-briefs', 'Four CFUR articles · March source p13', [0, 0, 756, 792]),
]


def pixels(page, region):
    pixmap = page.get_pixmap(matrix=fitz.Matrix(1, 1), clip=fitz.Rect(region), alpha=False)
    return np.frombuffer(pixmap.samples, dtype=np.uint8).reshape(pixmap.height, pixmap.width, pixmap.n)


def main():
    library = json.loads((STATIC / 'templates.json').read_text())
    report = json.loads((OUTPUT / 'report.json').read_text())
    entries = {entry['templateId']: entry for entry in report['entries']}
    rows = []
    for template_id, label, region in CASES:
        if entries.get(template_id, {}).get('status') != 'exported':
            raise RuntimeError('No successful exported proof for ' + template_id)
        template = next(t for t in library['templates'] if t['id'] == template_id)
        source = template['source']
        original = fitz.open(STATIC / source['pdf'])
        generated = fitz.open(OUTPUT / template_id / 'page.pdf')
        fitz.TOOLS.mupdf_warnings(reset=True)
        a = pixels(original[source['page'] - 1], region)
        source_warnings = fitz.TOOLS.mupdf_warnings(reset=True)
        b = pixels(generated[0], region)
        generated_warnings = fitz.TOOLS.mupdf_warnings(reset=True)
        assert a.shape == b.shape
        delta = np.abs(a.astype(np.int16) - b.astype(np.int16))
        metrics = dict(templateId=template_id, source=source['pdf'], page=source['page'],
                       region=region, pixels=int(a.shape[0] * a.shape[1]),
                       meanAbsoluteRgbDifference=float(delta.mean()),
                       fractionPixelsWithin12Levels=float((delta.max(axis=2) <= 12).mean()),
                       sourceRendererWarnings=source_warnings,
                       generatedRendererWarnings=generated_warnings)
        rows.append((label, a, b, metrics))
    figure, axes = plt.subplots(len(rows), 2, figsize=(12, 19), layout='constrained')
    for index, (label, a, b, metrics) in enumerate(rows):
        for column, (picture, title) in enumerate([(a, 'Supplied PDF'), (b, 'Editable reconstruction · portable fonts')]):
            axes[index, column].imshow(picture)
            axes[index, column].set_title(label + '\n' + title, fontsize=10)
            axes[index, column].axis('off')
    figure.suptitle('Source comparison: retained artwork and editable text\nText uses open font substitutes; all source article bodies are retained.', fontsize=13)
    REVIEW.mkdir(parents=True, exist_ok=True)
    figure.savefig(REVIEW / 'source-reproduction-comparison.jpg', dpi=120)
    plt.close(figure)
    result = dict(
        schemaVersion='ote.source-reconstruction-comparison.v1', renderDpi=72,
        engine=report['engine'], fontProfile='portable',
        interpretation='These are pixel differences over the indicated source region, not a quality score. '
            'Original artwork is retained; typography remains editable and differs with portable font substitutes. '
            'The source PDF and paired IDML also differ in some frame positions. Adobe InDesign and press proofs remain unverified.',
        compositions=dict(exported=report['exported'], failed=report['failed']),
        presets=[dict(templateId=entry['templateId'], status=entry['status'],
                      errors=entry.get('preflight', {}).get('errors'),
                      fullArticleCopy=all(entry.get('articleCopyChecks', {}).values()),
                      fullEditorialCopy=all(field['preserved'] for field in entry.get('structuredCopyChecks', [])))
                 for entry in report['entries']],
        comparisons=[row[3] for row in rows],
    )
    (REVIEW / 'source-reproduction-check.json').write_text(json.dumps(result, indent=2) + '\n')
    print(json.dumps(result, indent=2))


if __name__ == '__main__':
    main()
