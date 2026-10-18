#!/usr/bin/env python3
"""Build the committed real-content test fixture from the supplied source archive.

Copy comes from the March 2025 source IDML (already committed under
public/designcraft/source-idml); photos come from the same issue's folder in
OneDrive_2026-10-09.zip and are downscaled for the repository. Run once when
the fixture needs regenerating; the outputs are committed under
tests/fixtures/designcraft-march-2025/.
"""
import argparse
import hashlib
import io
import json
from pathlib import Path
import xml.etree.ElementTree as ET
import zipfile

from PIL import Image

IDML = 'public/designcraft/source-idml/issue-7-march-2025-da7e3ca1.idml'
PHOTO_DIR = 'Indesign Template/Fall 2024- Winter 2025/Issue 7 March 2025/'
# (article id, headline story, body story, author, photo file or None)
ARTICLES = [
    ('march-cfur-carbon-capture', 'Story_u80d', 'Story_u88c', 'CFUR Radio', '20250207_112107.jpg'),
    ('march-cn-centre-30', 'Story_u911', 'Story_u8a2', 'CFUR Radio', '20250211_133001.jpg'),
    ('march-rcmp-job-scams', 'Story_u8e4', 'Story_u876', 'CFUR Radio', None),
    ('march-compost-program', 'Story_u927', 'Story_u8b8', 'CFUR Radio', '20250227_123952.jpg'),
    ('march-alumni-harkness', 'Story_uea7', 'Story_ue6a', 'Over the Edge', None),
    ('march-alumni-moulton', 'Story_ufe6', 'Story_ue4e', 'Over the Edge', None),
]


# A plan verified through both the CLI and WebAssembly engines: cover plus three
# interior pages, i.e. one saddle-stitched sheet.
FEATURED = ['march-cfur-carbon-capture', 'march-cn-centre-30', 'march-compost-program']
LAYOUT_PLAN = dict(
    pages=[
        dict(id='page-1', pageNumber=1, templateId='cover-stacked-cards-plain', articleIds=FEATURED),
        dict(id='page-2', pageNumber=2, templateId='story-2-two-top-stacked', articleIds=['march-cfur-carbon-capture', 'march-cn-centre-30']),
        dict(id='page-3', pageNumber=3, templateId='story-2-one-top-stacked', articleIds=['march-compost-program', 'march-rcmp-job-scams']),
        dict(id='page-4', pageNumber=4, templateId='story-2-none-columns', articleIds=['march-alumni-harkness', 'march-alumni-moulton']),
    ],
    cover=dict(mode='editable', date='2025-03-13', volume=31, number=7, line='Campus news from CFUR Radio and OTE',
               caption='CN Centre at 30.', photoPath='media/march-cn-centre-30.jpg', focus=dict(x=0.5, y=0.4), articleIds=FEATURED),
    truck=dict(mode='editable', pageIds=[]),
)


def story_text(idml, name):
    root = ET.fromstring(idml.read(f'Stories/{name}.xml'))
    paragraphs, current = [], []
    for element in root.iter():
        tag = element.tag.split('}')[-1]
        if tag == 'Content' and element.text:
            current.append(element.text)
        elif tag == 'Br':
            paragraphs.append(''.join(current))
            current = []
    paragraphs.append(''.join(current))
    # Markdown paragraphs; the source line separator becomes a space in headlines.
    return '\n\n'.join(p.strip() for p in paragraphs if p.strip()).replace(' ', ' ')


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--archive', type=Path, required=True, help='OneDrive_2026-10-09.zip')
    parser.add_argument('--output', type=Path, default=Path('tests/fixtures/designcraft-march-2025'))
    args = parser.parse_args()
    args.output.mkdir(parents=True, exist_ok=True)
    (args.output / 'media').mkdir(exist_ok=True)
    idml = zipfile.ZipFile(IDML)
    source = zipfile.ZipFile(args.archive)
    articles, provenance = [], []
    for article_id, headline, body, author, photo in ARTICLES:
        photos = []
        if photo:
            original = source.read(PHOTO_DIR + photo)
            image = Image.open(io.BytesIO(original)).convert('RGB')
            image.thumbnail((1400, 1400))
            out = io.BytesIO()
            image.save(out, 'JPEG', quality=82)
            path = f'media/{article_id}.jpg'
            (args.output / path).write_bytes(out.getvalue())
            photos.append(dict(id=f'{article_id}-photo', path=path, caption='Photo from the March 2025 issue folder.',
                               photoNumber=1, mimeType='image/jpeg', attachmentType='photo'))
            provenance.append(dict(path=path, source=PHOTO_DIR + photo,
                                   sourceSha256=hashlib.sha256(original).hexdigest(), size=list(image.size)))
        articles.append(dict(id=article_id, title=story_text(idml, headline), body=story_text(idml, body),
                             author=author, photos=photos))
    issue = dict(schemaVersion='ote.designcraft.issue.v1',
                 issue=dict(id='fixture-march-2025', volume=31, number=7, date='2025-03-13', year=2025, title='Over the Edge'),
                 articles=articles, layoutPlan=LAYOUT_PLAN)
    (args.output / 'issue.json').write_text(json.dumps(issue, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
    (args.output / 'provenance.json').write_text(json.dumps(dict(
        copy=IDML, archive=args.archive.name, photos=provenance), indent=2) + '\n', encoding='utf-8')


if __name__ == '__main__':
    main()
