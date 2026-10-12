"""Sidecar for URL links, parent overrides, numbering and native text labels.

Adobe does not consume this sidecar. It restores links only when reopening
through this companion, after checking exact story text and UTF-8 boundaries.
"""
import copy
import json
from pathlib import Path
import zipfile
from native_flow import _text_frames, _write_native


def page_stories(document):
    """Full story strings at each physical page, including threaded frames."""
    pages = [[] for spread in document['spreads'] for _ in spread['pages']]
    for frame in _text_frames(document):
        if frame['pageIndex'] is not None:
            pages[frame['pageIndex']].append(document['stories'][str(frame['item']['content']['story'])]['text'])
    return [sorted(stories) for stories in pages]


def text_frame_key(frame, document):
    return (frame['item'].get('name'), frame['pageIndex'],
            document['stories'][str(frame['item']['content']['story'])]['text'])


def validate_sections(sections, page_count):
    if not isinstance(sections, list):
        raise ValueError('Interchange sections must be a list')
    starts = []
    allowed_styles = {'arabic', 'upperRoman', 'lowerRoman', 'upperLetters', 'lowerLetters',
                      'arabicLeadingZero', 'arabicThreeDigits', 'arabicFourDigits', 'symbols'}
    for section in sections:
        if not isinstance(section, dict):
            raise ValueError('Invalid interchange numbering section')
        start = section.get('start')
        if isinstance(start, bool) or not isinstance(start, int) or not 0 <= start < page_count:
            raise ValueError('Interchange section starts outside the document')
        number = section.get('startNumber')
        if number is not None and (isinstance(number, bool) or not isinstance(number, int) or not 0 <= number <= 2**32-1):
            raise ValueError('Invalid interchange section start number')
        if section.get('style', 'arabic') not in allowed_styles:
            raise ValueError('Unsupported interchange section numbering style')
        if any(key in section and not isinstance(section[key], str) for key in ('prefix', 'marker')):
            raise ValueError('Invalid interchange section text')
        if 'includePrefix' in section and not isinstance(section['includePrefix'], bool):
            raise ValueError('Invalid interchange section prefix option')
        starts.append(start)
    if starts != sorted(set(starts)):
        raise ValueError('Interchange numbering sections must have unique ordered starts')


def save_metadata(native, destination):
    with zipfile.ZipFile(native) as z:
        document = json.loads(z.read('document.json'))
    records = []
    for link in document.get('hyperlinks', []):
        if link['source']['kind'] != 'text' or link['dest']['kind'] != 'url':
            raise ValueError('Unsupported interchange hyperlink type')
        sid = link['source']['story']
        records.append(dict(story=sid, text=document['stories'][str(sid)]['text'], link=link))
    pages = [dict(id=p['id'], parent=p.get('parent'), width=p['width'], height=p['height'],
                  overridden=p.get('overridden', []), showParentItems=p.get('showParentItems', True))
             for spread in document['spreads'] for p in spread['pages']]
    frames = _text_frames(document)
    labelled = []
    for frame in frames:
        if not frame['item'].get('label'):
            continue
        key = text_frame_key(frame, document)
        if len([candidate for candidate in frames if text_frame_key(candidate, document) == key]) != 1:
            raise ValueError('Cannot preserve an ambiguous native text-frame label')
        labelled.append(dict(name=key[0], pageIndex=key[1], text=key[2], label=frame['item']['label']))
    sections = copy.deepcopy(document.get('sections', []))
    validate_sections(sections, len(pages))
    Path(destination).write_text(json.dumps(dict(schemaVersion='ote.interchange.metadata.v1',
                                               idmlHyperlinksSupported=False, hyperlinks=records,
                                               parentOverrides=pages, sections=sections,
                                               sectionPageStories=page_stories(document), textFrameLabels=labelled),
                                           ensure_ascii=False, indent=2), encoding='utf-8')
    return len(records)


def restore_metadata(native, sidecar):
    metadata = json.loads(Path(sidecar).read_text())
    if metadata.get('schemaVersion') != 'ote.interchange.metadata.v1':
        raise ValueError('Unknown interchange metadata schema')
    with zipfile.ZipFile(native) as z:
        entries = [(i, z.read(i.filename)) for i in z.infolist()]
    document = json.loads(next(b for i, b in entries if i.filename == 'document.json'))
    if 'sections' in metadata:
        recorded_pages = metadata.get('sectionPageStories')
        if not isinstance(recorded_pages, list) or page_stories(document) != recorded_pages:
            raise ValueError('Interchange page/story order changed; section restoration refused')
        validate_sections(metadata['sections'], len(recorded_pages))
        document['sections'] = copy.deepcopy(metadata['sections'])
    frames = _text_frames(document)
    restored_frames = set()
    for record in metadata.get('textFrameLabels', []):
        if not isinstance(record, dict) or not isinstance(record.get('label'), str):
            raise ValueError('Invalid interchange native text-frame label')
        key = (record.get('name'), record.get('pageIndex'), record.get('text'))
        matches = [frame for frame in frames if text_frame_key(frame, document) == key]
        if len(matches) != 1 or matches[0]['item']['id'] in restored_frames:
            raise ValueError('Interchange text-frame label missing or ambiguous; restoration refused')
        frame = matches[0]
        existing = frame['item'].get('label')
        if existing and existing != record['label']:
            raise ValueError('Interchange text-frame label conflicts with the current native frame')
        frame['item']['label'] = record['label']
        restored_frames.add(frame['item']['id'])
    links = []
    for record in metadata['hyperlinks']:
        candidates = [int(sid) for sid, story in document['stories'].items() if story['text'] == record['text']]
        if len(candidates) == 1:
            sid = candidates[0]
        else:
            raise ValueError('Interchange link story missing or ambiguous')
        link = copy.deepcopy(record['link'])
        start, end = link['source']['start'], link['source']['end']
        body = record['text'].encode('utf-8')
        if not 0 <= start < end <= len(body):
            raise ValueError('Invalid interchange link range')
        body[:start].decode('utf-8');body[:end].decode('utf-8')
        link['source']['story'] = sid
        link['id'] = document['nextId'];document['nextId'] += 1
        links.append(link)
    document['hyperlinks'] = links
    pages = [p for spread in document['spreads'] for p in spread['pages']]
    protected_pages = metadata.get('parentOverrides', [])
    if protected_pages and len(pages) != len(protected_pages):
        raise ValueError('Interchange page count changed; parent overrides cannot be restored')
    def items_in(values, depth=0):
        if depth > 64:
            raise ValueError('Native group nesting exceeds 64')
        for item in values:
            yield item['id']
            if item.get('content', {}).get('type') == 'group':
                yield from items_in(item['content']['items'], depth+1)
    item_ids = {i for spread in document['parents'] + document['spreads'] for i in items_in(spread['items'])}
    for page, original in zip(pages, protected_pages):
        keys = ('id', 'parent', 'width', 'height') if original['overridden'] or not original['showParentItems'] else ('width', 'height')
        if any(page.get(k) != original[k] for k in keys):
            raise ValueError('Interchange page identity/geometry changed; parent override restoration refused')
        if set(original['overridden']) - item_ids:
            raise ValueError('Interchange parent objects changed; override restoration refused')
        if original['overridden']:
            page['overridden'] = original['overridden']
        else:
            page.pop('overridden', None)
        page['showParentItems'] = original['showParentItems']
    _write_native(native, document, entries)
    return len(links)
