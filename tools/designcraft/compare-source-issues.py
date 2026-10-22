#!/usr/bin/env python3
"""Compare every physical page of assembled source issues at the same scale.

Run check-source-issues.mjs first. Artwork, editable and blank source pages are
reported separately; a faithful placed PDF is never described as editable copy.
"""
import hashlib
import json
import math
import sys
from pathlib import Path

import fitz
import matplotlib
matplotlib.use('Agg')
import matplotlib.pyplot as plt
import numpy as np

ROOT = Path(__file__).resolve().parents[2]
STATIC = ROOT / 'public/designcraft'
OUTPUT = ROOT / 'artifacts/source-reconstruction/whole-issues'
REVIEW = ROOT / 'docs/designcraft-review'


def pixels(page, region=None):
    pixmap = page.get_pixmap(matrix=fitz.Matrix(1, 1), clip=fitz.Rect(region) if region else None, alpha=False)
    return np.frombuffer(pixmap.samples, dtype=np.uint8).reshape(pixmap.height, pixmap.width, pixmap.n)


def cover_number_baselines(source, generated):
    """Check actual PDF baselines for the three large 2025 cover references."""
    def numbers(page):
        return {span['text'].strip(): span for block in page.get_text('dict')['blocks']
                for line in block.get('lines', []) for span in line['spans']
                if span['text'].strip() in {'03', '05', '10'} and span['size'] > 40}
    originals, outputs = numbers(source), numbers(generated)
    if set(originals) != {'03', '05', '10'}:
        return []
    checks = []
    for text, original in originals.items():
        output = outputs.get(text)
        difference = output['origin'][1] - original['origin'][1] if output else None
        checks.append(dict(text=text, sourceBaselineY=original['origin'][1],
                           outputBaselineY=output['origin'][1] if output else None,
                           differencePoints=difference,
                           passed=difference is not None and abs(difference) < .1))
    return checks


def main():
    report = json.loads((OUTPUT / 'report.json').read_text())
    result = dict(schemaVersion='ote.source-whole-issue-comparison.v1', renderDpi=72,
                  engine=report['engine'], fontProfile=report['fontProfile'],
                  interpretation='Every source physical page is compared with the corresponding exported PDF page at 72 dpi. '
                    'Pixel differences are not a quality score. Artwork pages place the source PDF; editable pages rebuild text with '
                    'portable font substitutes. Blank flags preserve unfilled source content, including house frames and source remnants.',
                  issues=[])
    REVIEW.mkdir(parents=True, exist_ok=True)
    selected_prefixes = sys.argv[1:]
    for entry in report['issues']:
        if selected_prefixes and not any(entry['key'].startswith(prefix) for prefix in selected_prefixes):
            continue
        if entry['status'] != 'exported':
            raise RuntimeError('Whole-issue composition has not passed: ' + entry['key'])
        source = entry['source']
        directory = OUTPUT / entry['key']
        source_path = STATIC / source['pdf']
        original, generated = fitz.open(source_path), fitz.open(directory / 'issue.pdf')
        source_pages = source['pages']
        verification = entry['verification']
        modes = {page['pageNumber']: page for page in verification['pages']}
        comparisons, pictures = [], []
        assert len(generated) == source['physicalPageCount'], 'Exported PDF changed the physical page count'
        for page in source_pages:
            number = page['pageNumber']
            fitz.TOOLS.mupdf_warnings(reset=True)
            a = pixels(original[page['sourcePage'] - 1], page.get('sourceRegion'))
            source_warnings = fitz.TOOLS.mupdf_warnings(reset=True)
            b = pixels(generated[number - 1])
            output_warnings = fitz.TOOLS.mupdf_warnings(reset=True)
            assert a.shape == b.shape, f'Physical page {number} changed size'
            delta = np.abs(a.astype(np.int16) - b.astype(np.int16))
            mode = modes[number]['sourceMode']
            comparisons.append(dict(pageNumber=number, sourcePage=page['sourcePage'], sourceRegion=page.get('sourceRegion'),
                sourceMode=mode, role=page['role'], label=page['label'], spreadId=page.get('spreadId'),
                blankEditorial=bool(page.get('blankEditorial')),
                meanAbsoluteRgbDifference=float(delta.mean()),
                fractionPixelsWithin12Levels=float((delta.max(axis=2) <= 12).mean()),
                sourceRendererWarnings=source_warnings, generatedRendererWarnings=output_warnings))
            pictures.append((number, mode, a, b))
        figure, axes = plt.subplots(math.ceil(len(pictures) / 2), 4, figsize=(15, math.ceil(len(pictures) / 2) * 4.2), layout='constrained', squeeze=False)
        for axis in axes.flat:
            axis.axis('off')
        for index, (number, mode, a, b) in enumerate(pictures):
            row, column = index // 2, (index % 2) * 2
            for offset, (picture, label) in enumerate([(a, 'Source'), (b, 'Recreated · ' + mode)]):
                axes[row, column + offset].imshow(picture)
                axes[row, column + offset].set_title(f'{number:02} · {label}', fontsize=10)
        figure.suptitle(source['label'] + ' · complete issue\nEvery physical page, in source order; source and output shown at the same scale.', fontsize=15)
        image_name = 'source-whole-issue-' + entry['key'] + '.jpg'
        figure.savefig(REVIEW / image_name, dpi=100)
        plt.close(figure)
        classifications = {}
        for mode in sorted(set(page['sourceMode'] for page in comparisons)):
            mode_pages = [page for page in comparisons if page['sourceMode'] == mode]
            classifications[mode] = dict(pageNumbers=[p['pageNumber'] for p in mode_pages],
                meanAbsoluteRgbDifference=float(np.mean([p['meanAbsoluteRgbDifference'] for p in mode_pages])),
                meanFractionPixelsWithin12Levels=float(np.mean([p['fractionPixelsWithin12Levels'] for p in mode_pages])))
        content_classes = {}
        for page in comparisons:
            category = page['sourceMode'] + (' · blank editorial area' if page['blankEditorial'] else ' · content')
            content_classes.setdefault(category, []).append(page)
        content_classes = {name: dict(pageNumbers=[p['pageNumber'] for p in pages],
            meanAbsoluteRgbDifference=float(np.mean([p['meanAbsoluteRgbDifference'] for p in pages])),
            meanFractionPixelsWithin12Levels=float(np.mean([p['fractionPixelsWithin12Levels'] for p in pages])))
            for name, pages in content_classes.items()}
        result['issues'].append(dict(key=entry['key'], sourcePdf=source['pdf'],
            sourceSha256=hashlib.sha256(source_path.read_bytes()).hexdigest(),
            sourcePdfPageCount=len(original), sourcePhysicalPageCount=source['physicalPageCount'],
            exportedPdfPageCount=len(generated), nativePageCount=verification['nativePageCount'], idmlPageCount=verification['idmlPageCount'],
            checks=verification['checks'], sourceReconstruction=verification['sourceReconstruction'],
            coverNumberBaselines=cover_number_baselines(original[0], generated[0]),
            classifications=classifications, contentClasses=content_classes,
            coverage=dict(covers=[p['pageNumber'] for p in comparisons if p['role']=='cover'],
                advertisements=[p['pageNumber'] for p in comparisons if p['role']=='ad'],
                recurringSections=[p['pageNumber'] for p in comparisons if p['role']=='recurring'],
                blankEditorialAreas=[p['pageNumber'] for p in comparisons if p['blankEditorial']],
                linkedSpreadPages=[p['pageNumber'] for p in comparisons if p['spreadId']]),
            comparisons=comparisons, contactSheet=image_name))
    result['passed'] = all(all(issue['checks'].values()) and all(check['passed'] for check in issue['coverNumberBaselines']) for issue in result['issues'])
    (REVIEW / 'source-whole-issue-check.json').write_text(json.dumps(result, indent=2) + '\n')
    print(json.dumps({key: value for key, value in result.items() if key != 'issues'}, indent=2))
    for issue in result['issues']:
        print(issue['key'], issue['exportedPdfPageCount'], 'pages', json.dumps(issue['classifications']))
    if not result['passed']:
        raise RuntimeError('Whole-issue comparison or cover baseline verification failed')


if __name__ == '__main__':
    main()
