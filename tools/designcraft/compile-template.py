#!/usr/bin/env python3
"""Compose an OTE template through stock DesignCraft commands (Python 3 stdlib)."""
import argparse
import hashlib
import json
import math
from pathlib import Path
import shutil
import subprocess
import sys
import zipfile

LIBRARY_SCHEMA = 'ote.designcraft.templates.v1'
ISSUE_SCHEMA = 'ote.designcraft.issue.v1'


def write_json(path, value):
    path.write_text(json.dumps(value, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')


def run_script(cli, path, output):
    result = subprocess.run([cli, 'script', str(path)], capture_output=True, text=True, timeout=180)
    (output / (path.stem + '-stdout.json')).write_text(result.stdout, encoding='utf-8')
    (output / (path.stem + '-stderr.txt')).write_text(result.stderr, encoding='utf-8')
    try:
        data = json.loads(result.stdout)
    except json.JSONDecodeError as error:
        raise ValueError('CLI did not return JSON: ' + result.stderr[:800]) from error
    if result.returncode or data.get('error'):
        raise ValueError('DesignCraft command failed: ' + str(data.get('error', result.stderr))[:800])
    return data


def apply_focal_crops(native_path, focus_requests, slots):
    """Patch only graphic transforms; keep every embedded asset payload byte-identical."""
    slot_index = {slot['id']: slot for slot in slots}
    with zipfile.ZipFile(native_path) as archive:
        entries = [(info, archive.read(info.filename)) for info in archive.infolist()]
    document = json.loads(next(payload for info, payload in entries if info.filename == 'document.json'))
    items = {item['name']: item for spread in document['spreads'] for item in spread['items'] if item.get('name')}
    for request in focus_requests:
        focus = request['requestedFocus']
        if not isinstance(focus, dict):
            raise ValueError('Photo focus must be {x: 0..1, y: 0..1}')
        fx, fy = focus.get('x', 0.5), focus.get('y', 0.5)
        if any(not isinstance(v, (int, float)) or not math.isfinite(v) or not 0 <= v <= 1 for v in (fx, fy)):
            raise ValueError('Photo focal coordinates must be finite fractions from 0 to 1')
        slot = slot_index[request['slotId']]
        item = items[slot['id']]
        if item['xf'] != [1, 0, 0, 1, 0, 0] or item['content']['type'] != 'graphic':
            raise ValueError('Focal crop requires an untransformed rectangular graphic frame')
        graphic = item['content']
        iw, ih = graphic['size']
        if not iw > 0 or not ih > 0:
            raise ValueError('Photo has invalid native dimensions')
        x, y, right, bottom = slot['rect']
        fw, fh = right - x, bottom - y
        scale = max(fw / iw, fh / ih)
        tx = max(fw - iw * scale, min(0, fw / 2 - fx * iw * scale))
        ty = max(fh - ih * scale, min(0, fh / 2 - fy * ih * scale))
        transform = [scale, 0, 0, scale, x + tx, y + ty]
        graphic['xf'] = transform
        graphic['autoFit'] = 'none'
        graphic['crop'] = [0, 0, 0, 0]
        request.update(nativeCrop='focal-point', exactFocusApplied=True, imageSize=[iw, ih], frameRect=slot['rect'], transform=transform)
    temporary = native_path.with_suffix('.focal.tmp')
    with zipfile.ZipFile(temporary, 'w') as archive:
        for info, payload in entries:
            archive.writestr(info, json.dumps(document, ensure_ascii=False).encode('utf-8') if info.filename == 'document.json' else payload)
    with zipfile.ZipFile(temporary) as archive:
        for info, payload in entries:
            if info.filename != 'document.json' and archive.read(info.filename) != payload:
                raise ValueError('Focal patch altered a non-document ZIP payload')
    temporary.replace(native_path)
    return {info.filename: hashlib.sha256(payload).hexdigest() for info, payload in entries if info.filename.startswith('assets/')}


def example_articles(count):
    return [dict(id=f'example-{i+1}', title=f'Example story {i+1}', author='Example author',
                 body=('This is illustrative copy for the editable template. Replace it with an article from OTEManager. '
                       'All submitted article text is retained; a page with overset copy needs a larger layout before final export.\n\n') * 3,
                 photos=[]) for i in range(count)]


def compile_page(args):
    library = json.loads(args.library.read_text(encoding='utf-8'))
    if library.get('schemaVersion') != LIBRARY_SCHEMA:
        raise ValueError('Unsupported template library schema')
    matches = [t for t in library['templates'] if t['id'] == args.template]
    if len(matches) != 1:
        raise ValueError('Select a unique template ID from the library')
    template = matches[0]
    page = library['page']
    width, height = page['width'], page['height']
    issue = json.loads(args.issue.read_text(encoding='utf-8')) if args.issue else None
    if issue and issue.get('schemaVersion') != ISSUE_SCHEMA:
        raise ValueError('Unsupported issue schema')
    story_count = template.get('storyCount', 0)
    is_cover = template.get('kind') == 'cover'
    articles = issue.get('articles', []) if issue else example_articles(story_count)
    if args.articles:
        selected = args.articles.split(',')
        index = {str(a['id']): a for a in articles}
        valid_count = 1 <= len(selected) <= 3 if is_cover else len(selected) == story_count
        if not valid_count or len(set(selected)) != len(selected):
            raise ValueError('--articles requires 1–3 distinct IDs for a cover, or one distinct ID per story slot')
        if any(i not in index for i in selected):
            raise ValueError('An article ID is absent from the issue')
        articles = [index[i] for i in selected]
    else:
        articles = articles[:3 if is_cover else story_count]
    if len({a.get('id') for a in articles}) != len(articles):
        raise ValueError('Article IDs must be distinct')
    if not is_cover and len(articles) != story_count:
        raise ValueError(f'Template needs {story_count} articles; export has {len(articles)}')
    for article in articles:
        for field in ('id', 'title', 'body'):
            if not isinstance(article.get(field), str):
                raise ValueError(f'Article {field} must be a string')
        if not article['title'].strip() or not article['body'].strip():
            raise ValueError('An article title or body is empty')
    output = args.output.resolve()
    output.mkdir(parents=True, exist_ok=True)
    for stale_export in ('page.pdf', 'page.idml'):
        (output / stale_export).unlink(missing_ok=True)
    font_dir = args.font_dir or (args.library.resolve().parent / 'assets' / 'fonts')
    if font_dir.is_dir():
        document_fonts = output / 'Document Fonts'
        document_fonts.mkdir(exist_ok=True)
        for font in font_dir.iterdir():
            if font.is_file() and (font.name.startswith(('SourceSans3-', 'SourceSerif4-')) and font.suffix.lower() in ('.ttf', '.otf') or font.name in ('OFL-SourceSans3.txt', 'OFL-SourceSerif4.txt')):
                shutil.copyfile(font, document_fonts / font.name)
    steps = []
    slot_refs = []
    warnings = []
    missing_media = []
    body_counts = {}
    photo_counts = {}
    focus_requests = []

    def add(command, **params):
        index = len(steps)
        steps.append(dict(command=command, params=params))
        return index

    def ref(index, key='id'):
        return f'${index}.{key}'

    def label_frame(index, slot, article):
        metadata = dict(templateId=template['id'], slotId=slot['id'], role=slot['role'],
                        articleId=article.get('id') if article else None, pageId=args.page_id)
        add('object.label', ids=[ref(index)], label=json.dumps(metadata, ensure_ascii=False))
        add('object.rename', id=ref(index), name=slot['id'])
        slot_refs.append(dict(metadata, commandIndex=index))

    def styled_text(rect, text, style, columns=1, slot=None, article=None):
        index = add('frame.create', rect=rect, content='text', text=text, caret=False)
        add('object.textFrameOptions', ids=[ref(index)], inset=0, columns=columns, gutter=page.get('gutter', 12))
        add('text.select', story=ref(index, 'story'), anchor=0, focus=len(text.encode('utf-8')))
        add('style.paragraph.apply', name=style, clearOverrides=True)
        if slot:
            label_frame(index, slot, article)
        return index

    add('file.new', width=width, height=height, pages=1, facingPages=False,
        margins=page.get('margin', 36), title=template['name'])
    add('layout.documentSetup', startPage=args.page_number, intent='print')
    add('swatch.create', name='OTE Green', color={'c': 70, 'm': 30, 'y': 75, 'k': 40})
    add('swatch.create', name='OTE Placeholder', color={'c': 10, 'm': 3, 'y': 8, 'k': 0})
    styles = {
        'OTE Headline': ('Source Sans 3', 'Bold', 24, 27),
        'OTE Body': ('Source Serif 4', 'Regular', 10, 12),
        'OTE Byline': ('Source Sans 3', 'Semibold', 9, 11),
        'OTE Caption': ('Source Sans 3', 'Regular', 8, 10),
        'OTE Label': ('Source Sans 3', 'Semibold', 12, 15),
        'OTE Folio': ('Source Sans 3', 'Regular', 8, 10),
    }
    for name, (family, font_style, size, leading) in styles.items():
        add('style.paragraph.create', name=name, para={'spaceAfter': 4, 'hyphenate': name == 'OTE Body'},
            chars={'fontFamily': family, 'fontStyle': font_style, 'size': size,
                   'leading': {'kind': 'points', 'value': leading}})
    if template.get('border'):
        border = add('frame.create', rect=[30, 30, width - 30, height - 30], content='unassigned')
        add('object.stroke', ids=[ref(border)], weight=2, swatch='OTE Green')
    for slot in template['slots']:
        rect = slot['rect']
        if len(rect) != 4 or any(not isinstance(x, (int, float)) or not math.isfinite(x) for x in rect):
            raise ValueError(f'Invalid rectangle for {slot["id"]}')
        x, y, right, bottom = rect
        if not (0 <= x < right <= width and 0 <= y < bottom <= height):
            raise ValueError(f'Slot {slot["id"]} lies outside page boundaries')
        role = slot['role']
        ai = slot.get('articleIndex', 0)
        article = articles[ai] if 'articleIndex' in slot and 0 <= ai < len(articles) else None
        if 'articleIndex' in slot and role in ('headline', 'body', 'byline', 'photo', 'caption') and article is None and template.get('kind') != 'cover':
            raise ValueError(f'Slot {slot["id"]} has no matching article')
        if role in ('headline', 'body', 'byline', 'caption', 'folio'):
            if role == 'headline':
                text, style = article['title'] if article else str(slot.get('text') or 'ILLUSTRATIVE COVER TITLE'), 'OTE Headline'
            elif role == 'body':
                body_counts[ai] = body_counts.get(ai, 0) + 1
                text, style = article['body'] if article else str(slot.get('text') or 'ILLUSTRATIVE COPY'), 'OTE Body'
            elif role == 'byline':
                text, style = str(article.get('author') or 'Author not provided') if article else str(slot.get('text') or 'ILLUSTRATIVE BYLINE'), 'OTE Byline'
            elif role == 'caption':
                pi = slot.get('photoIndex', 0)
                photos = article.get('photos', []) if article else []
                text = str(photos[pi].get('caption') or 'Caption not provided') if pi < len(photos) else str(slot.get('text') or 'Illustrative photo caption')
                style = 'OTE Caption'
            else:
                info = issue.get('issue', {}) if issue else {}
                text = f'{args.page_number}  |  {info.get("title") or "OVER THE EDGE"}  |  {info.get("date") or "ILLUSTRATIVE TEMPLATE"}'
                style = 'OTE Folio'
            if slot.get('fontSize'):
                custom_style = 'OTE Slot ' + slot['id']
                family, font_style, _, _ = styles[style]
                size = float(slot['fontSize'])
                add('style.paragraph.create', name=custom_style,
                    chars={'fontFamily': family, 'fontStyle': font_style, 'size': size,
                           'leading': {'kind': 'points', 'value': size * 1.15}})
                style = custom_style
            styled_text(rect, text, style, columns=slot.get('columns', 1), slot=slot, article=article)
        elif role in ('photo', 'ad', 'piece'):
            media = None
            if slot.get('asset'):
                media = {'path': str((args.library.resolve().parent / slot['asset']).resolve())}
            elif role == 'photo' and article:
                pi = slot.get('photoIndex', photo_counts.get(ai, 0))
                photo_counts[ai] = pi + 1
                photos = article.get('photos', [])
                if pi < len(photos):
                    media = photos[pi]
            elif issue:
                media = issue.get('layoutPlan', {}).get('media', {}).get(slot['id'])
            if media and media.get('path'):
                source_path = Path(media['path'])
                if not source_path.is_absolute():
                    source_path = args.issue.resolve().parent / source_path if args.issue else args.library.resolve().parent / source_path
                if not source_path.is_file():
                    raise ValueError(f'Missing image file: {source_path}')
                suffix = source_path.suffix.lower()
                if suffix not in ('.png', '.jpg', '.jpeg', '.pdf', '.tif', '.tiff', '.webp'):
                    raise ValueError('Unsupported media format: ' + suffix)
                asset_dir = output / 'Links'
                asset_dir.mkdir(exist_ok=True)
                digest = hashlib.sha256(source_path.read_bytes()).hexdigest()
                portable = asset_dir / (digest[:16] + suffix)
                shutil.copyfile(source_path, portable)
                index = add('frame.create', rect=rect, content='graphic')
                add('file.place', path=str(portable), frame=ref(index))
                add('object.fittingOptions', ids=[ref(index)], fitting='fillProportionally' if role == 'photo' and not slot.get('asset') else 'fitProportionally', autoFit=True, align=4)
                if slot.get('focus') is not None and role == 'photo' and not slot.get('asset'):
                    focus_requests.append({'slotId': slot['id'], 'requestedFocus': slot['focus'], 'nativeCrop': 'pending', 'exactFocusApplied': False})
                label_frame(index, slot, article)
            else:
                if issue and role == 'photo' and article:
                    missing_media.append(slot['id'])
                index = add('frame.create', rect=rect, content='unassigned')
                add('object.fill', ids=[ref(index)], swatch='OTE Placeholder')
                add('object.stroke', ids=[ref(index)], weight=0.5, swatch='OTE Green')
                label_frame(index, slot, article)
                caption = str(slot.get('text') or {'photo': 'ILLUSTRATIVE PHOTO SLOT', 'ad': 'ADVERTISING BOUNDARY', 'piece': 'CUSTOM BLOCK BOUNDARY'}[role])
                fields = dict(slot.get('fields', {}))
                if issue and role == 'piece':
                    fields.update(issue.get('layoutPlan', {}).get('blocks', {}).get(slot['id'], {}).get('fields', {}))
                if fields:
                    caption += '\n\n' + '\n\n'.join(str(key).replace('_', ' ').title() + ': ' + str(value) for key, value in fields.items())
                h = bottom - y - 8 if fields or role == 'piece' else min(36, bottom - y - 8)
                styled_text([x+4, y+4, right-4, y+4+h], caption, 'OTE Label')
                warnings.append(f'{slot["id"]}: no media supplied; boundary placeholder drawn')
        else:
            raise ValueError('Unsupported slot role: ' + role)
    if any(body_counts.get(i) != 1 for i in range(story_count)):
        raise ValueError('Each article needs exactly one body slot; use its columns option for text columns')
    preflight_index = add('preflight.run', minPpi=150)
    inspect_index = add('document.inspect')
    add('file.saveAs', path=str(output / 'page.designcraft'))
    commands = output / 'commands.dcs'
    commands.write_text('\n'.join(s['command'] + ' ' + json.dumps(s['params'], ensure_ascii=False) for s in steps) + '\n', encoding='utf-8')
    result = run_script(args.cli, commands, output)
    results = result['results']
    crop_asset_hashes = {}
    if focus_requests:
        crop_asset_hashes = apply_focal_crops(output / 'page.designcraft', focus_requests, template['slots'])
        reopen_script = output / 'reopen-focal.dcs'
        reopen_steps = [dict(command='file.open', params={'path': str(output / 'page.designcraft')}),
                        dict(command='preflight.run', params={'minPpi': 150}),
                        dict(command='document.inspect', params={}),
                        dict(command='file.saveAs', params={'path': str(output / 'page.designcraft')})]
        reopen_script.write_text('\n'.join(s['command'] + ' ' + json.dumps(s['params']) for s in reopen_steps) + '\n', encoding='utf-8')
        reopened = run_script(args.cli, reopen_script, output)['results']
        results[preflight_index], results[inspect_index] = reopened[1], reopened[2]
    with zipfile.ZipFile(output / 'page.designcraft') as native:
        document = json.loads(native.read('document.json'))
        for asset_name, expected_hash in crop_asset_hashes.items():
            if hashlib.sha256(native.read(asset_name)).hexdigest() != expected_hash:
                raise ValueError('Reopening focal crop changed an embedded asset payload')
    if focus_requests:
        items = {item['name']: item for spread in document['spreads'] for item in spread['items'] if item.get('name')}
        for crop in focus_requests:
            graphic = items[crop['slotId']]['content']
            if graphic['autoFit'] != 'none' or any(abs(a-b) > 1e-9 for a,b in zip(graphic['xf'], crop['transform'])):
                raise ValueError('Native focal transform changed during reopening')
        write_json(output / 'focal-crop.json', dict(crops=focus_requests, embeddedAssetSha256=crop_asset_hashes, preservedAssetBytes=True))
    body_refs = {x['articleId']: x for x in slot_refs if x['role'] == 'body'}
    for article in articles if not is_cover else []:
        body_ref = body_refs[article['id']]
        story_id = results[body_ref['commandIndex']]['story']
        if document['stories'][str(story_id)]['text'] != article['body']:
            raise ValueError('Native document failed full-copy check for article ' + article['id'])
    preflight = results[preflight_index]
    write_json(output / 'preflight.json', preflight)
    write_json(output / 'document-inspect.json', results[inspect_index])
    errors = [x for x in preflight.get('issues', []) if x['severity'] == 'error']
    for slot_id in missing_media:
        errors.append(dict(kind='missing-input-photo', severity='error', message='Photo slot has no local photo: ' + slot_id))
    manifest = dict(schemaVersion='ote.designcraft.build.v1', templateId=template['id'],
                    sourceArticleIds=[a['id'] for a in articles], illustrative=issue is None or bool(issue.get('illustrative', False)),
                    pageId=args.page_id, pageNumber=args.page_number, slots=slot_refs,
                    copyPreserved=True, copyScope='source-record-article-bodies' if is_cover else 'native-article-bodies',
                    articleBodiesInNative=not is_cover, focalPointRequests=focus_requests, fonts=['Source Sans 3', 'Source Serif 4'],
                    status='needs-layout-adjustment' if errors else 'exported', errors=errors, warnings=warnings,
                    originalCoverAndTruck='Requires original native issue; not modified by this single-page compiler',
                    adobeInDesignTested=False)
    write_json(output / 'build-manifest.json', manifest)
    write_json(output / 'source-record.json', dict(issue=issue.get('issue') if issue else None, articles=articles))
    if errors:
        raise ValueError(f'{len(errors)} preflight/input errors. Full copy retained in page.designcraft; final PDF/IDML export blocked. See preflight.json and build-manifest.json.')
    export_steps = [dict(command='file.open', params={'path': str(output / 'page.designcraft')}),
                    dict(command='file.exportPdf', params={'path': str(output / 'page.pdf')}),
                    dict(command='file.exportIdml', params={'path': str(output / 'page.idml')})]
    export_script = output / 'export.dcs'
    export_script.write_text('\n'.join(s['command'] + ' ' + json.dumps(s['params']) for s in export_steps) + '\n', encoding='utf-8')
    run_script(args.cli, export_script, output)
    return manifest


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--library', type=Path, required=True)
    parser.add_argument('--template', required=True)
    parser.add_argument('--issue', type=Path)
    parser.add_argument('--articles', help='Comma-separated article IDs in slot order')
    parser.add_argument('--output', type=Path, required=True)
    parser.add_argument('--cli', default=shutil.which('designcraft-cli') or 'designcraft-cli')
    parser.add_argument('--font-dir', type=Path, help='Directory of licensed Source Sans 3/Source Serif 4 fonts and OFL files')
    parser.add_argument('--page-number', type=int, default=1)
    parser.add_argument('--page-id', default='page-1')
    args = parser.parse_args()
    if args.page_number < 1:
        parser.error('--page-number must be positive')
    try:
        print(json.dumps(compile_page(args), ensure_ascii=False))
    except (ValueError, OSError, KeyError, IndexError, subprocess.SubprocessError) as error:
        print('compile-template: ' + str(error), file=sys.stderr)
        return 1
    return 0


if __name__ == '__main__':
    sys.exit(main())
