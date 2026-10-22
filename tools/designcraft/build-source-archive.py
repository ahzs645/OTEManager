#!/usr/bin/env python3
"""Build semantic article records and a sanitized, reproducible OTE source archive.

Default inputs are the committed PDFs/IDMLs and the sanitized seven-edition
metadata fixture. Refresh that fixture with --metadata-backup <native ZIP>.
No contacts, payments, feedback, bank details or unrelated articles are copied.
Optional --recovery-report accepts recover-drive-files.py's local file index.
"""
import argparse
import copy
import csv
import hashlib
import json
import mimetypes
import re
import shutil
import unicodedata
import zipfile
from collections import Counter, defaultdict
from pathlib import Path
import xml.etree.ElementTree as ET

import fitz

ROOT = Path(__file__).resolve().parents[2]
PUBLIC = ROOT / 'public/designcraft'
ARCHIVE_ID = 'ote-original-issues-2026-10-09'
FIXTURE = PUBLIC / 'source-metadata/otemanager-source-metadata.json'
TARGET_EDITIONS = {(31, n) for n in range(3, 8)} | {(32, 1), (32, 2)}
NOV = 'cover-page-issue-3-lina-66de36f6.idml'
FEB = 'issue-6-feb-2025-8395eefe.idml'
MARCH = 'issue-7-march-2025-da7e3ca1.idml'

# Deliberate source pairings, not fuzzy matching. Database identity/title/byline
# remain primary; the IDML's alternative title and printed byline are retained.
DB_STORIES = [
    ('99e8c277-636a-4496-8245-454b7603cbbc', 'u1684', 'u1649'),
    ('475f8565-e5cf-4b1e-8c5e-19b4b138171b', 'u1552', 'u1535'),
    ('06640325-c8d8-4a49-b3a7-8581e80a8bda', 'u14ff', 'u14b7'),
    ('418cd2e3-28e7-4f4c-a896-bea4eb890179', 'u149f', 'u1425'),
    ('89f84904-eef4-4e34-aefc-99d445453dbb', 'u13c9', 'u13b0'),
    ('6ea4662e-7143-421c-bf2a-189596cec94d', 'u1338', 'u12e6'),
    ('ebd55d71-1c39-46bb-9a54-a5c0bc5c8587', 'u10d1', 'u108d'),
    ('a7795693-b827-4c6e-a4da-70c2ca5306a3', 'u104e', 'u1015'),
    ('e95039de-b595-41cc-b811-c254116987cd', 'ue76', 'ue55'),
    ('9625b3c9-6ac5-405a-9bd5-52496eb61b46', 'ufef', 'ue3a'),
    ('57970c81-218f-45f0-981a-658407a41bdd', 'ude2', 'uda7'),
    ('084387b3-87e0-48c9-8a2e-8dfac084aead', 'uc5b', 'uc27'),
]
EXTRA_STORIES = [
    (NOV, 'u12c6', 'u129d', 31, 3, None, 'Travis Nielsen'),
    (NOV, 'u126c', 'u123a', 31, 3, None, 'Carolynne Burkholder'),
    (FEB, 'u80d', 'u88c', 31, 6, 13, None),
    (FEB, 'u911', 'u8a2', 31, 6, 13, None),
    (FEB, 'u8e4', 'u876', 31, 6, 13, None),
    (FEB, 'u927', 'u8b8', 31, 6, 13, None),
    (FEB, 'u7f6', 'u7e0', 31, 6, None, None),
    (MARCH, 'u80d', 'u88c', 31, 7, 13, None),
    (MARCH, 'u911', 'u8a2', 31, 7, 13, None),
    (MARCH, 'u8e4', 'u876', 31, 7, 13, None),
    (MARCH, 'u927', 'u8b8', 31, 7, 13, None),
    (MARCH, 'uea7', 'ue6a', 31, 7, 10, None),
    (MARCH, 'ufe6', 'ue4e', 31, 7, 10, None),
]


def sha(data):
    return hashlib.sha256(data).hexdigest()


def dump(path, value):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(value, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')


def slug(value):
    value = unicodedata.normalize('NFKD', value).encode('ascii', 'ignore').decode()
    return re.sub(r'[^a-z0-9]+', '-', value.lower()).strip('-')[:95] or 'untitled'


def sanitize_backup(path):
    """Allowlist target publication metadata; deliberately discard private tables."""
    payload = path.read_bytes()
    with zipfile.ZipFile(path) as archive:
        manifest = json.loads(archive.read('manifest.json'))
    data = manifest['data']
    volumes = {x['id']: x['volumeNumber'] for x in data['volumes']}
    editions = {x['id']: (volumes[x['volumeId']], x['issueNumber']) for x in data['issues']}
    authors = {x['id']: x for x in data['authors']}
    attachments = defaultdict(list)
    for item in data['attachments']:
        attachments[item['articleId']].append(item)
    rows = []
    for article in data['articles']:
        edition = editions.get(article.get('issueId'), (article.get('volume'), article.get('issue')))
        if edition not in TARGET_EDITIONS:
            continue
        person = authors.get(article.get('authorId'), {})
        anonymous = bool(article.get('prefersAnonymity'))
        name = 'Anonymous' if anonymous else ' '.join(str(person.get(k) or '').strip() for k in ['givenName', 'surname']).strip() or None
        row = dict(originalArticleId=article['id'], title=article['title'], authorName=name,
                   volumeNumber=edition[0], issueNumber=edition[1], content=article.get('content'),
                   prefersAnonymity=anonymous,
                   originalDates={key: article.get(key) for key in ['submittedAt', 'createdAt', 'updatedAt']},
                   attachments=[])
        if not anonymous and person.get('id'):
            row['authorSourceId'] = person['id']
        for index, item in enumerate(attachments[article['id']], 1):
            # Filenames can identify writers who requested anonymity. Public
            # recovery metadata uses safe names and opaque attachment IDs only.
            suffix = Path(item.get('fileName') or item.get('originalFileName') or '').suffix.lower()
            caption = item.get('caption')
            if anonymous and caption:
                real_name = ' '.join(str(person.get(k) or '').strip() for k in ['givenName', 'surname']).strip()
                if real_name and real_name.casefold() in caption.casefold():
                    caption = None
            row['attachments'].append(dict(
                originalAttachmentId=item['id'], attachmentType=item['attachmentType'],
                mimeType=item.get('mimeType'), caption=caption, photoNumber=item.get('photoNumber'),
                size=item.get('fileSize'), name=f'{slug(article["title"])}-{index}{suffix}',
            ))
        rows.append(row)
    selected_editions = [dict(volumeNumber=volumes[x['volumeId']], issueNumber=x['issueNumber'],
                             releaseDate=(x.get('releaseDate') or '')[:10] or None)
                         for x in data['issues'] if (volumes[x['volumeId']], x['issueNumber']) in TARGET_EDITIONS]
    result = dict(schemaVersion='ote.source-metadata.v1', source=dict(
        name=path.name, sha256=sha(payload), exportedAt=manifest.get('exportedAt'),
        notes='Allowlisted seven-edition article metadata and article copy only. Contacts, payments, feedback, private filenames and unrelated tables are excluded.'),
        editions=sorted(selected_editions, key=lambda x: (x['volumeNumber'], x['issueNumber'])),
        articles=sorted(rows, key=lambda x: (x['volumeNumber'], x['issueNumber'], x['originalArticleId'])))
    assert len(rows) == 87, f'Target backup changed: expected 87 original article identities, got {len(rows)}'
    dump(FIXTURE, result)


class Stories:
    def __init__(self):
        self.cache = {}

    def read(self, filename, story):
        if filename not in self.cache:
            self.cache[filename] = zipfile.ZipFile(PUBLIC / 'source-idml' / filename)
        root = ET.fromstring(self.cache[filename].read(f'Stories/Story_{story}.xml'))
        paragraphs, current = [], []
        for element in root.iter():
            tag = element.tag.split('}')[-1]
            if tag == 'Content' and element.text:
                current.append(element.text)
            elif tag == 'Br':
                paragraphs.append(''.join(current)); current = []
        paragraphs.append(''.join(current))
        return '\n\n'.join(p.strip() for p in paragraphs if p.strip()).replace('\u2028', ' ').replace('\u00ad', '')

    def title(self, filename, story):
        return re.sub(r'\s+', ' ', self.read(filename, story)).strip()


def remove_byline(content):
    """Remove only explicit byline paragraphs, retaining archival reprint notes."""
    paragraphs = content.split('\n\n')
    byline = None
    kept = []
    for index, paragraph in enumerate(paragraphs):
        if index < 3 and re.match(r'^(Author:|By\s+)', paragraph):
            byline = paragraph
        else:
            kept.append(paragraph)
    return '\n\n'.join(kept), byline


def docx_text(path):
    if path.suffix.lower() == '.txt':
        return path.read_text(encoding='utf-8-sig')
    with zipfile.ZipFile(path) as archive:
        root = ET.fromstring(archive.read('word/document.xml'))
    ns = {'w': 'http://schemas.openxmlformats.org/wordprocessingml/2006/main'}
    paragraphs = []
    for paragraph in root.findall('./w:body//w:p', ns):
        text = ''.join(element.text or '' for element in paragraph.iter() if element.tag == '{' + ns['w'] + '}t')
        if text.strip():
            paragraphs.append(text.strip())
    return '\n\n'.join(paragraphs)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--metadata-backup', type=Path)
    parser.add_argument('--recovery-report', type=Path)
    parser.add_argument('--output', type=Path, default=PUBLIC)
    parser.add_argument('--package', type=Path, default=ROOT / 'artifacts/source-archive/ote-source-articles.zip')
    args = parser.parse_args()
    if args.metadata_backup:
        sanitize_backup(args.metadata_backup)
    if not FIXTURE.exists():
        parser.error('Sanitized metadata fixture missing; provide --metadata-backup once')
    output = args.output.resolve()
    output.mkdir(parents=True, exist_ok=True)
    fixture = json.loads(FIXTURE.read_text())
    fixture_ref = dict(path='source-metadata/otemanager-source-metadata.json', sha256=sha(FIXTURE.read_bytes()),
                       notes='Sanitized metadata-only backup derivative; no original attachment bytes were included in that backup.')
    maps = json.loads((PUBLIC / 'source-issue-maps.json').read_text())['issues']
    catalogue = json.loads((PUBLIC / 'documents.json').read_text())
    stories = Stories()
    issues, articles, assets = [], [], []
    edition_docs = defaultdict(list)
    document_by_id = {x['id']: x for x in maps}
    by_key = {}
    for item in maps:
        meta = item['metadata']
        issues.append(dict(documentId=item['id'], label=item['label'], volumeNumber=meta['volume'],
                           issueNumber=meta['number'], releaseDate=meta['date'], pageCount=item['physicalPageCount'],
                           source=dict(path=item['pdf'], sha256=item['sourceSha256']),
                           sourceNotes=item.get('notes'), sourceCoverMetadata=item.get('sourceCoverMetadata')))
        edition_docs[(meta['volume'], meta['number'])].append(item['id'])
        assets.append(dict(id='source-pdf:' + item['id'], path=item['pdf'], sha256=item['sourceSha256'],
                           mimeType='application/pdf', availability='reference-only', assetRole='source-reference',
                           documentIds=[item['id']], label=item['label']))
    for item in catalogue['idml']:
        assets.append(dict(id='source-idml:' + Path(item['path']).stem, path=item['path'], sha256=item['sha256'],
                           mimeType='application/vnd.adobe.indesign-idml-package', availability='reference-only',
                           assetRole='source-reference', label=Path(item['path']).name))

    def placements(edition, page=None, section=None, visible_document=None):
        result = []
        for document_id in edition_docs[edition]:
            visible = page is not None and (visible_document is None or document_id == visible_document)
            result.append(dict(documentId=document_id, pageNumbers=[page] if visible else [], section=section,
                               sourceVisibility='visible-in-pdf' if visible else 'not-confirmed-in-this-pdf'))
        return result

    def idml_ref(filename, ids, **extra):
        path = 'source-idml/' + filename
        return dict(path=path, sha256=sha((PUBLIC / path).read_bytes()), storyIds=ids, **extra)

    for row in fixture['articles']:
        key = 'legacy:' + row['originalArticleId']
        body = row.get('content') or ''
        article = dict(sourceKey=key, originalArticleId=row['originalArticleId'], title=row['title'],
                       authorName=row['authorName'], content=body, bodyFormat='plain', kind='article',
                       placements=placements((row['volumeNumber'], row['issueNumber'])), provenance=[dict(
                           fixture_ref, originalArticleId=row['originalArticleId'], originalDates=row.get('originalDates')),
                           dict(path=fixture['source']['name'], sha256=fixture['source']['sha256'],
                                notes='Referenced original input backup. Only its sanitized selected article metadata is included in the generated archive.')], photos=[],
                       recoveryStatus='source-backup' if body.strip() else 'metadata-only', sourceVisibility='backup-only',
                       prefersAnonymity=row['prefersAnonymity'], originalDates=row.get('originalDates'))
        if row.get('authorSourceId'):
            article['authorSourceId'] = row['authorSourceId']
        articles.append(article); by_key[key] = article
        for item in row['attachments']:
            suffix = Path(item['name']).suffix.lower() or mimetypes.guess_extension(item.get('mimeType') or '') or '.bin'
            assets.append(dict(id='attachment:' + item['originalAttachmentId'], sourceKey=key,
                               originalArticleId=row['originalArticleId'], originalAttachmentId=item['originalAttachmentId'],
                               path=f'source-archive-media/{item["originalAttachmentId"]}{suffix}', sha256=None,
                               mimeType=item.get('mimeType'), size=item.get('size'), originalFileName=item['name'],
                               attachmentType=item['attachmentType'], availability='missing', caption=item.get('caption'),
                               photoNumber=item.get('photoNumber'), assetRole='article-attachment'))

    for original_id, headline, body_id in DB_STORIES:
        article = by_key['legacy:' + original_id]
        body, byline = remove_byline(stories.read(NOV, body_id))
        if not article['content'].strip():
            article['content'] = body
            article['recoveryStatus'] = 'source-idml'
            article['sourceVisibility'] = 'alternate-idml-not-in-paired-pdf'
        article['provenance'].append(idml_ref(NOV, [headline, body_id], sourceTitle=stories.title(NOV, headline),
                                              sourceByline=byline, notes='Complete source story recovered from a fuller IDML revision. The paired issue PDF contains blank editorial areas. Original database publication assignment/title/byline remain primary.'))

    for filename, headline, body_id, volume, number, page, author in EXTRA_STORIES:
        body, byline = remove_byline(stories.read(filename, body_id))
        current_feb = 'issue-6-feb-2025-5ed75bab' if filename == FEB else None
        kind = 'editorial' if 'CFUR' in stories.title(filename, headline) else 'article'
        section = 'alumni' if body_id in ['ue6a', 'ue4e'] else 'cfur' if filename in [FEB, MARCH] else 'editorial'
        article = dict(sourceKey='idml:' + filename.split('-')[-1].split('.')[0] + ':' + body_id,
                       title=stories.title(filename, headline), authorName=author, content=body, bodyFormat='plain', kind=kind,
                       placements=placements((volume, number), page, section, current_feb),
                       provenance=[idml_ref(filename, [headline, body_id], sourceByline=byline,
                                             notes='Byline is unknown unless explicitly printed. CFUR branding is a section attribution, not an invented personal byline.')],
                       photos=[], recoveryStatus='source-idml',
                       sourceVisibility='visible-in-source-pdf' if page else 'idml-only-not-in-paired-pdf')
        if filename in [FEB, MARCH] and section == 'cfur':
            article['sectionAttribution'] = 'CFUR Radio'
        articles.append(article); by_key[article['sourceKey']] = article

    # Recurring pieces are meaningful catalogue records, never main Articles rows.
    recurring = {}
    def add_recurring(document_id, filename, title, question_id, answer_id, page, section):
        question = stories.read(filename, question_id)
        answer = stories.read(filename, answer_id) if answer_id else ''
        content = '**Question**\n\n' + question + ('\n\n**Answer**\n\n' + answer if answer else '')
        key = 'recurring:' + section + ':' + sha(content.encode())[:16]
        if key not in recurring:
            recurring[key] = dict(sourceKey=key, title=title, authorName=None, content=content,
                                  bodyFormat='markdown', kind='recurring', placements=[], provenance=[], photos=[],
                                  recoveryStatus='source-idml', sourceVisibility='visible-in-source-pdf',
                                  question=question, answer=answer or None)
        record = recurring[key]
        record['placements'].append(dict(documentId=document_id, pageNumbers=[page], section=section))
        record['provenance'].append(idml_ref(filename, [question_id] + ([answer_id] if answer_id else []),
                                             notes='Original question/response grouped semantically; no respondent byline is invented.'))

    for spec in [
        ('cover-page-issue-3-lina-6dd82589', 'cover-page-issue-3-lina-a8e3ae7d.idml', 'u6a4', 'u6ba'),
        ('cover-page-issue-3-lina-2dc29f52', 'cover-page-issue-3-lina-db450802.idml', 'u394', 'u3aa'),
        ('cover-page-issue-3-lina-de16e159', 'cover-page-issue-3-lina-b4b35ce4.idml', 'u398', 'u3ae'),
        ('issue-5-ba123d17', 'issue-5-5f404889.idml', 'u398', None),
        ('issue-6-feb-2025-b91aa3a0', 'issue-6-feb-2025-ff0c4263.idml', 'u48c', 'u4a2'),
        ('issue-6-feb-2025-5ed75bab', FEB, 'u49e', 'u4b4'),
        ('issue-7-march-2025-dfcbb959', MARCH, 'u49e', 'u4b4'),
    ]:
        add_recurring(spec[0], spec[1], 'President Answers', spec[2], spec[3], 6, 'president-qa')
    add_recurring('issue-2-october-2025-0eb630f7', 'issue-2-october-2025-c98939e6.idml',
                  'Interim-President Question', 'u589', 'u59f', 4, 'president-qa')
    for document_id, filename, question, answer in [
        ('issue-5-ba123d17', 'issue-5-5f404889.idml', 'u737', 'u752'),
        ('issue-6-feb-2025-b91aa3a0', 'issue-6-feb-2025-ff0c4263.idml', 'u3fc', 'u412'),
        ('issue-6-feb-2025-5ed75bab', FEB, 'u409', 'u41f'),
        ('issue-7-march-2025-dfcbb959', MARCH, 'u409', 'u41f'),
    ]:
        add_recurring(document_id, filename, 'Inside the Edge', question, answer, 5, 'inside-the-edge')
    articles.extend(recurring.values())

    # One semantic record per photo feature, not one record per caption or line.
    def photo_feature(key, title, filename, ids, documents, pages):
        paragraphs = [stories.read(filename, story) for story in ids]
        articles.append(dict(sourceKey=key, title=title, authorName=None, content='\n\n'.join(paragraphs),
                             bodyFormat='plain', kind='photo-feature', placements=[dict(documentId=d, pageNumbers=pages, section='photo-feature') for d in documents],
                             provenance=[idml_ref(filename, ids, notes='Source feature captions/bios grouped as one feature; photographer names are not inferred article bylines.')],
                             photos=[], recoveryStatus='source-idml', sourceVisibility='visible-in-source-pdf'))
    photo_feature('feature:campus-corners-2025', stories.title('issue-1-sept-2025-7a5b7a69.idml', 'u609'),
                  'issue-1-sept-2025-7a5b7a69.idml', ['u628', 'u680', 'u66a', 'u6c2', 'u63e', 'u654', 'u696', 'u6ac'],
                  ['issue-1-sept-2025-741805e9'], [12, 13])
    photo_feature('feature:winter-visions-2025', 'Winter Visions — Photo Contest', FEB,
                  ['u650', 'u6bd', 'u666', 'u624', 'u63a', 'u5f8'], ['issue-6-feb-2025-5ed75bab'], [8, 9])
    # The same winners/intro appear in December and the archived February design.
    wildlife_file = 'cover-page-issue-3-lina-db450802.idml'
    photo_feature('feature:wildlife-photo-contest', 'Wildlife Photo Contest Winners!', wildlife_file,
                  ['u824', 'u586', 'u4e0', 'u5b2', 'u59d', 'u6b0', 'u741', 'u64d', 'u6cb', 'u7ae', 'u696', 'u67f', 'u777'],
                  ['cover-page-issue-3-lina-2dc29f52', 'issue-6-feb-2025-b91aa3a0'], [8, 9])

    # Optional real recovered attachment bytes. A missing index never implies a
    # missing file was restored; it remains an explicit reference-only gap.
    recovery = json.loads(args.recovery_report.read_text()) if args.recovery_report and args.recovery_report.exists() else {}
    recovered = {x['originalAttachmentId']: x for x in recovery.get('attachments', [])}
    file_versions = defaultdict(list)
    media_dir = output / 'source-archive-media'; media_dir.mkdir(exist_ok=True)
    for asset in assets:
        recovered_file = recovered.get(asset.get('originalAttachmentId'))
        if not recovered_file or recovered_file.get('status') != 'recovered' or not recovered_file.get('localPath'):
            continue
        local = Path(recovered_file['localPath'])
        if not local.is_file():
            continue
        payload = local.read_bytes(); digest = sha(payload)
        if recovered_file.get('sha256') and digest != recovered_file['sha256']:
            raise ValueError('Recovered attachment checksum mismatch: ' + asset['id'])
        target = output / asset['path']; target.parent.mkdir(parents=True, exist_ok=True)
        shutil.copyfile(local, target)
        asset.update(availability='available', sha256=digest, size=len(payload))
        if asset['attachmentType'] == 'word_document' and local.suffix.lower() in ['.docx', '.txt']:
            text = docx_text(local)
            file_versions[asset['sourceKey']].append((asset, text))
        elif asset['attachmentType'] == 'photo':
            by_key[asset['sourceKey']]['photos'].append(dict(assetId=asset['id'], path=asset['path'], mimeType=asset['mimeType'], caption=asset.get('caption'), photoNumber=asset.get('photoNumber')))
    for key, versions in file_versions.items():
        article = by_key[key]
        article['recoveredDocumentVersions'] = [dict(assetId=asset['id'], contentSha256=sha(text.encode()), characters=len(text)) for asset, text in versions]
        # Existing exact DB copy and verified paired-IDML paragraphs win. If only
        # metadata exists, identical recovered copies can be selected safely.
        unique = {text for _, text in versions if text.strip()}
        if article['recoveryStatus'] == 'metadata-only' and len(unique) == 1:
            article['content'] = next(iter(unique)); article['recoveryStatus'] = 'source-document'
            article['sourceVisibility'] = 'recovered-document-not-confirmed-in-pdf'
        elif article['recoveryStatus'] == 'metadata-only' and len(unique) > 1:
            article['recoveryNotes'] = 'Multiple different source document versions recovered; canonical body remains unset pending an explicit editorial selection.'

    # A deliberately bounded embedded-image inventory: original image bytes,
    # source placements and generated safe paths; never fictitious attachments.
    image_assets = {}
    for mapping in maps:
        document = fitz.open(PUBLIC / mapping['pdf'])
        for page_index, page in enumerate(document):
            for info in page.get_image_info(xrefs=True):
                if not info.get('xref') or min(info['width'], info['height']) < 64:
                    continue
                image = document.extract_image(info['xref'])
                if image.get('smask'):
                    base = fitz.Pixmap(document, info['xref'])
                    # DeviceN/spot grayscale also needs an explicit standard
                    # colorspace before PNG serialization, not just CMYK.
                    base = fitz.Pixmap(fitz.csRGB, base)
                    pixmap = fitz.Pixmap(base, fitz.Pixmap(document, image['smask']))
                    payload = pixmap.tobytes('png'); ext = 'png'
                else:
                    payload, ext = image['image'], image['ext']
                digest = sha(payload)
                if digest not in image_assets:
                    path = 'source-archive-media/' + digest[:24] + '.' + ext
                    (output / path).write_bytes(payload)
                    image_assets[digest] = dict(id='embedded-image:' + digest[:24], path=path, sha256=digest,
                        size=len(payload), mimeType=mimetypes.guess_type(path)[0] or 'application/octet-stream',
                        availability='available', assetRole='embedded-source-image', width=info['width'], height=info['height'],
                        label='Embedded source image', documentIds=[], sourcePlacements=[])
                asset = image_assets[digest]
                if mapping['id'] not in asset['documentIds']:
                    asset['documentIds'].append(mapping['id'])
                asset['sourcePlacements'].append(dict(documentId=mapping['id'], pageNumber=page_index + 1, rect=list(info['bbox'])))
    assets.extend(image_assets.values())

    # Associate only unambiguous actual source portraits/photos. Other embedded
    # image objects remain inventory, rather than being guessed onto articles.
    portrait_keys = {'ue6a': (600, 80, 745, 335), 'ue4e': (10, 440, 160, 700)}
    for article in articles:
        tail = article['sourceKey'].split(':')[-1]
        if tail not in portrait_keys:
            continue
        region = fitz.Rect(portrait_keys[tail])
        for asset in image_assets.values():
            found = [p for p in asset['sourcePlacements'] if p['documentId'] == 'issue-7-march-2025-dfcbb959' and p['pageNumber'] == 10 and region.contains(fitz.Rect(p['rect'])) and asset['height'] > asset['width']]
            if found:
                article['photos'].append(dict(assetId=asset['id'], path=asset['path'], mimeType=asset['mimeType'], caption=None, photoNumber=1))
                asset.setdefault('articleSourceKeys', []).append(article['sourceKey'])
                asset.update(sourceKey=article['sourceKey'], attachmentType='photo', caption=None, photoNumber=1)

    main_articles = [a for a in articles if a['kind'] in ['article', 'editorial']]
    available = [a for a in main_articles if a['content'].strip()]
    coverage = dict(sourceDocuments=len(issues), publicationEditions=len(edition_docs),
                    originalDatabaseArticles=len(fixture['articles']), mainArticles=len(main_articles),
                    mainArticlesWithBodies=len(available), metadataOnlyArticles=len(main_articles) - len(available),
                    databaseBodyCopies=sum(bool((row.get('content') or '').strip()) for row in fixture['articles']),
                    idmlBodyRecoveries=sum(a['recoveryStatus'] == 'source-idml' for a in main_articles),
                    recurringRecords=sum(a['kind'] == 'recurring' for a in articles),
                    photoFeatureRecords=sum(a['kind'] == 'photo-feature' for a in articles),
                    missingAttachmentReferences=sum(a.get('availability') == 'missing' for a in assets),
                    availableAttachmentFiles=sum(a.get('assetRole') == 'article-attachment' and a.get('availability') == 'available' for a in assets),
                    embeddedImageAssets=len(image_assets),
                    notes=[
                        'Blank PDF article areas are not evidence that the metadata-backed article is fabricated. Metadata-only records retain an empty body and an explicit recovery gap.',
                        'November fuller IDML is a different revision from the supplied mostly blank PDF; original database edition assignments are preserved.',
                        'The iMac story is stored in that November IDML but the original database assigns it to Volume31 Issue4; it is not silently moved to Issue3.',
                        'Recurring Q&A, photo features, board structures, advertisements and empty pages are not imported as paid/main article records.',
                        'Standalone image objects are source assets, not asserted original submission attachments. Raw DOCX and photograph submission bytes remain unavailable unless a recovery report supplies them.',
                    ],
                    byEdition=[])
    for edition, documents in sorted(edition_docs.items()):
        entries = [a for a in main_articles if any(p['documentId'] in documents for p in a['placements'])]
        coverage['byEdition'].append(dict(volumeNumber=edition[0], issueNumber=edition[1], documentIds=documents,
                                        articles=len(entries), withBodies=sum(bool(a['content'].strip()) for a in entries),
                                        metadataOnly=sum(not a['content'].strip() for a in entries)))
    bundle = dict(schemaVersion='ote.source-archive.v1', archiveId=ARCHIVE_ID, issues=issues,
                  articles=articles, assets=assets, coverage=coverage)
    dump(output / 'source-archive.json', bundle)
    article_dir = output / 'source-archive/articles'; article_dir.mkdir(parents=True, exist_ok=True)
    for article in articles:
        filename = slug(article['sourceKey']) + '-' + slug(article['title']) + '.md'
        metadata = {k: article.get(k) for k in ['sourceKey', 'originalArticleId', 'title', 'authorName', 'kind', 'recoveryStatus', 'sourceVisibility', 'originalDates', 'prefersAnonymity', 'placements', 'provenance']}
        header = '# ' + article['title'].strip() + '\n\n'
        if article['authorName']:
            header += 'Byline: ' + article['authorName'] + '\n\n'
        if not article['content'].strip():
            header += '> Source metadata is available; the article body has not been recovered.\n\n'
        text = header + article['content'] + '\n\n---\n\nSource metadata:\n\n```json\n' + json.dumps(metadata, ensure_ascii=False, indent=2) + '\n```\n'
        (article_dir / filename).write_text(text, encoding='utf-8')
        article['exportPath'] = 'source-archive/articles/' + filename
    # Export paths are part of the final catalogue and per-issue packages.
    dump(output / 'source-archive.json', bundle)
    for issue in issues:
        members = [a for a in articles if any(p['documentId'] == issue['documentId'] for p in a['placements'])]
        member_keys = {a['sourceKey'] for a in members}
        dump(output / 'source-archive/issues' / (issue['documentId'] + '.json'), dict(
            schemaVersion='ote.source-archive.issue.v1', archiveId=ARCHIVE_ID, issue=issue, articles=members,
            assets=[a for a in assets if issue['documentId'] in a.get('documentIds', []) or a.get('sourceKey') in member_keys]))
    report = ['# Original OTE article recovery', '',
              f'{len(issues)} source PDFs; {len(edition_docs)} publication editions; {len(main_articles)} semantic main article records.',
              f'{len(available)} recovered bodies; {len(main_articles) - len(available)} explicit metadata-only article records.', '',
              '| Edition | Main articles | Body recovered | Metadata only |', '|---|---:|---:|---:|']
    report += [f'| {x["volumeNumber"]}/{x["issueNumber"]} | {x["articles"]} | {x["withBodies"]} | {x["metadataOnly"]} |' for x in coverage['byEdition']]
    report += ['', *coverage['notes'], '']
    (output / 'source-archive/coverage.md').write_text('\n'.join(report), encoding='utf-8')
    with (output / 'source-archive/articles.csv').open('w', encoding='utf-8', newline='') as stream:
        columns = ['sourceKey', 'originalArticleId', 'title', 'authorName', 'kind', 'recoveryStatus', 'sourceVisibility', 'originalDates', 'prefersAnonymity', 'documentIds', 'pageNumbers', 'content', 'exportPath']
        writer = csv.DictWriter(stream, fieldnames=columns)
        writer.writeheader()
        for article in articles:
            row = {key: article.get(key, '') for key in columns}
            row['originalDates'] = json.dumps(article['originalDates']) if article.get('originalDates') else ''
            row['documentIds'] = '|'.join(p['documentId'] for p in article['placements'])
            row['pageNumbers'] = '|'.join(','.join(str(n) for n in p['pageNumbers']) for p in article['placements'])
            writer.writerow(row)
    args.package.parent.mkdir(parents=True, exist_ok=True)
    # Package generated catalogue/prose only. Original backups, source PDFs,
    # IDMLs, contacts and payment tables are deliberately not duplicated here.
    with zipfile.ZipFile(args.package, 'w', zipfile.ZIP_DEFLATED) as package:
        package.write(output / 'source-archive.json', 'source-archive.json')
        for path in sorted((output / 'source-archive').rglob('*')):
            if path.is_file():
                package.write(path, str(path.relative_to(output)))
        # Include real article-associated media so imports do not depend on
        # this host's public directory. Unassigned source artwork stays out.
        for asset in assets:
            if asset.get('sourceKey') and asset.get('availability') == 'available':
                path = output / asset['path']
                if path.is_file():
                    package.write(path, asset['path'])
    print(json.dumps(coverage, ensure_ascii=False, indent=2))


if __name__ == '__main__':
    main()
