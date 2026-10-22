#!/usr/bin/env python3
"""Check separate native source advertisements and genuine background removal.

Run check-source-issues.mjs first. Rendering uses the exact measured source
rectangle, with a three-point inset only for the background-white check so
adjacent house borders do not count as retained advertisement artwork.
"""
import hashlib
import json
from pathlib import Path

import fitz
import numpy as np

ROOT = Path(__file__).resolve().parents[2]
STATIC = ROOT / 'public/designcraft'
OUTPUT = ROOT / 'artifacts/source-reconstruction/whole-issues'
REVIEW = ROOT / 'docs/designcraft-review'


def pixels(page, rect):
    pix = page.get_pixmap(clip=rect, matrix=fitz.Matrix(1, 1), alpha=False)
    return np.frombuffer(pix.samples, dtype=np.uint8).reshape(pix.height, pix.width, pix.n)


def main():
    report = json.loads((OUTPUT / 'report.json').read_text())
    registry = json.loads((STATIC / 'source-issues.json').read_text())
    expected = {(issue['documentId'], page['pageNumber'], 'source-ad-' + ad['id'])
                for issue in registry['issues'] for page in issue['pages'] for ad in page.get('adSpots', [])}
    spots = []
    for entry in report['issues']:
        if not entry['key'].endswith('-reconstruction'):
            continue
        if entry['status'] != 'exported':
            raise RuntimeError('Whole issue must pass first: ' + entry['key'])
        issue_path = Path(entry['input'])
        issue = json.loads(issue_path.read_text())
        library = json.loads((issue_path.parent / 'templates.json').read_text())
        templates = {template['id']: template for template in library['templates']}
        original = fitz.open(STATIC / entry['source']['pdf'])
        generated = fitz.open(OUTPUT / entry['key'] / 'issue.pdf')
        for plan in issue['layoutPlan']['pages']:
            template = templates[plan['templateId']]
            advertisements = [slot for slot in template['slots'] if slot['id'].startswith('source-ad-')]
            if not advertisements:
                continue
            number = plan['pageNumber']
            verification = entry['verification']['pages'][number - 1]
            background = next(slot for slot in template['slots'] if slot['id'] == 'source-page-graphics')
            background_path = STATIC / background['asset']
            background_pdf = fitz.open(background_path)
            source_page = original[plan['sourcePage'] - 1]
            background_hashes = {image['digest'].hex() for image in background_pdf[0].get_image_info(hashes=True)}
            for slot in advertisements:
                rect = fitz.Rect(slot['rect'])
                inset = fitz.Rect(rect.x0 + 3, rect.y0 + 3, rect.x1 - 3, rect.y1 - 3)
                empty = pixels(background_pdf[0], inset)
                white_fraction = float((empty.min(axis=2) > 250).mean())
                source_images = []
                for image in source_page.get_image_info(hashes=True):
                    bounds = fitz.Rect(image['bbox'])
                    overlap = (bounds & rect).get_area() / max(1, min(bounds.get_area(), rect.get_area()))
                    if overlap > .95:
                        source_images.append(image['digest'].hex())
                artwork = next(art for art in verification['artwork'] if art['slotId'] == slot['id'])
                a, b = pixels(source_page, rect), pixels(generated[number - 1], rect)
                assert a.shape == b.shape, 'Advertisement crop changed size'
                delta = np.abs(a.astype(np.int16) - b.astype(np.int16))
                checks = dict(nativeSeparatePlacement=artwork['uniquePlacement'] and verification['correctlyLocated'],
                              nativeOriginalCropBytes=artwork['embeddedOriginalBytes'],
                              backgroundIsClear=white_fraction > .995,
                              originalAdImageRemoved=all(digest not in background_hashes for digest in source_images))
                spots.append(dict(documentId=issue['sourceIssue']['documentId'], pageNumber=number,
                    slotId=slot['id'], label=slot['source']['label'], rect=slot['rect'],
                    asset=slot['asset'], background=background['asset'],
                    backgroundSha256=hashlib.sha256(background_path.read_bytes()).hexdigest(),
                    backgroundInsetPoints=3, backgroundFractionWhite=white_fraction,
                    sourceAdImageCount=len(source_images), sourceAdImageDigests=source_images,
                    meanAbsoluteRgbDifference=float(delta.mean()),
                    fractionPixelsWithin12Levels=float((delta.max(axis=2) <= 12).mean()), checks=checks))
    actual = {(spot['documentId'], spot['pageNumber'], spot['slotId']) for spot in spots}
    result = dict(schemaVersion='ote.source-ad-spots-check.v1', renderDpi=72,
        interpretation='Each mapped advertisement is a separate native graphic containing the source crop. '
          'The original advertisement image must be absent from the page background; the three-point-inset '
          'background must be over 99.5% white. The blank September reservation is vector artwork and is '
          'checked by the clear-background measurement. Source/output pixel differences are measurements, not a quality score.',
        sourceIssueCount=len({spot['documentId'] for spot in spots}), adSpotCount=len(spots),
        expectedAdSpotCount=len(expected), allMappedSpotsPresent=actual == expected,
        passed=bool(spots) and actual == expected and all(all(spot['checks'].values()) for spot in spots), spots=spots)
    REVIEW.mkdir(parents=True, exist_ok=True)
    (REVIEW / 'source-ad-spot-check.json').write_text(json.dumps(result, indent=2) + '\n')
    print(json.dumps({key: value for key, value in result.items() if key != 'spots'}, indent=2))
    if not result['passed']:
        raise RuntimeError('Separate advertisement verification failed')


if __name__ == '__main__':
    main()
