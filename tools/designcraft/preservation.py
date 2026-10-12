"""Validate protected page identity and content before native assembly."""
import hashlib
import json
from pathlib import Path
import zipfile


def items_in(items, depth=0):
    if depth > 64:
        raise ValueError('Native group nesting exceeds 64')
    for item in items:
        yield item
        if item.get('content', {}).get('type') == 'group':
            yield from items_in(item['content']['items'], depth + 1)


def embedded_cover_hash(native, document):
    if not document['spreads']:
        return None
    ids = []
    for item in items_in(document['spreads'][0]['items']):
        try:
            label = json.loads(item.get('label') or '{}')
        except (TypeError, ValueError):
            label = {}
        if label.get('slotId') == 'cover-photo' and item.get('content', {}).get('type') == 'graphic':
            ids.append(item['content']['asset'])
    if len(ids) != 1:
        return None
    with zipfile.ZipFile(native) as archive:
        candidates = [n for n in archive.namelist() if n.startswith('assets/' + str(ids[0]) + '.')]
        if len(candidates) != 1:
            raise ValueError('Cannot identify the embedded cover image')
        return hashlib.sha256(archive.read(candidates[0])).hexdigest()


def validate_protected_identity(pages, protected_ids, base, manifest):
    native_pages = [page for spread in base['spreads'] for page in spread['pages']]
    previous = {p['id']: p for p in manifest.get('pages', [])} if manifest else {}
    for index, page in enumerate(pages):
        if page['id'] not in protected_ids:
            continue
        original = previous.get(page['id'])
        if previous:
            if original is None or original['pageNumber'] != page['pageNumber']:
                raise ValueError('Protected page identity/order changed; make the page editable before moving it: ' + page['id'])
            if original.get('articleIds', []) != page.get('articleIds', []):
                raise ValueError('Protected article assignments changed; make the page editable: ' + page['id'])
            binding = original.get('nativePageId')
            if binding is not None and str(binding) != str(native_pages[index]['id']):
                raise ValueError('Native base page identity no longer matches its build manifest')
        else:
            binding = page.get('sourceNativePageId', page['id'])
            if str(binding) != str(native_pages[index]['id']):
                raise ValueError('An unmanifested base requires the exact sourceNativePageId for each protected page')


def page_story_texts(document, index):
    """Use frame positions within a page, never spread-wide story membership."""
    locations = [(spread, page) for spread in document['spreads'] for page in spread['pages']]
    spread, page = locations[index]
    story_ids = set()

    def multiply(a, b):
        return [a[0]*b[0]+a[2]*b[1], a[1]*b[0]+a[3]*b[1],
                a[0]*b[2]+a[2]*b[3], a[1]*b[2]+a[3]*b[3],
                a[0]*b[4]+a[2]*b[5]+a[4], a[1]*b[4]+a[3]*b[5]+a[5]]

    def visit(items, parent, depth=0):
        if depth > 64:
            raise ValueError('Native group nesting exceeds 64')
        for item in items:
            transform = multiply(parent, item.get('xf', [1, 0, 0, 1, 0, 0]))
            content = item.get('content', {})
            if content.get('type') == 'group':
                visit(content['items'], transform, depth + 1)
            elif content.get('type') == 'text':
                points = [a['p'] for path in item.get('path', {}).get('subpaths', []) for a in path.get('anchors', [])]
                if not points:
                    continue
                xs = [transform[0]*x+transform[2]*y+transform[4] for x, y in points]
                ys = [transform[1]*x+transform[3]*y+transform[5] for x, y in points]
                left, right = min(xs), max(xs)
                if left >= page['x']-.01 and right <= page['x']+page['width']+.01 and min(ys) >= -.01 and max(ys) <= page['height']+.01:
                    story_ids.add(str(content['story']))
    visit(spread['items'], [1, 0, 0, 1, 0, 0])
    return [document['stories'][sid]['text'] for sid in story_ids]


def validate_cover_photo(native, base, manifest, cover, issue_root):
    if not cover.get('photoPath'):
        return
    photo = Path(issue_root) / cover['photoPath']
    if not photo.is_file():
        raise ValueError('Protected cover photo source is missing')
    embedded = embedded_cover_hash(native, base)
    recorded = manifest.get('coverPhotoSha256')
    if recorded and embedded and recorded != embedded:
        raise ValueError('Cover photo hash does not match the native base manifest')
    expected = embedded or recorded
    if not expected:
        raise ValueError('Cannot verify this protected cover photo; provide a matched build manifest or remove its replacement request')
    if hashlib.sha256(photo.read_bytes()).hexdigest() != expected:
        raise ValueError('Cover image bytes changed while the cover was protected; make it editable to apply the replacement')
