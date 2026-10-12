"""Checked native story threads through explicitly allocated article frames.

This changes document metadata only. It never splits source copy or estimates
where a page break belongs; DesignCraft's compositor determines the flow.
"""
import copy
import json
import math
from pathlib import Path
import tempfile
import zipfile


def _read_native(path):
    with zipfile.ZipFile(path) as archive:
        entries = [(info, archive.read(info.filename)) for info in archive.infolist()]
    documents = [payload for info, payload in entries if info.filename == 'document.json']
    if len(documents) != 1:
        raise ValueError('Native archive needs exactly one document.json')
    return json.loads(documents[0]), entries


def _write_native(path, document, entries):
    """Atomically replace metadata while verifying every other ZIP payload."""
    path = Path(path)
    handle = tempfile.NamedTemporaryFile(prefix=path.stem + '-', suffix='.tmp', dir=path.parent, delete=False)
    temporary = Path(handle.name)
    handle.close()
    try:
        with zipfile.ZipFile(temporary, 'w', zipfile.ZIP_DEFLATED) as archive:
            for info, payload in entries:
                archive.writestr(info, json.dumps(document, ensure_ascii=False).encode('utf-8')
                                 if info.filename == 'document.json' else payload)
        with zipfile.ZipFile(temporary) as archive:
            for info, payload in entries:
                if info.filename != 'document.json' and archive.read(info.filename) != payload:
                    raise ValueError('Native metadata change altered an asset or other ZIP payload')
        temporary.replace(path)
    finally:
        temporary.unlink(missing_ok=True)


def _multiply(left, right):
    a, b, c, d, e, f = left
    g, h, i, j, k, l = right
    return [a*g+c*h, b*g+d*h, a*i+c*j, b*i+d*j, a*k+c*l+e, b*k+d*l+f]


def _text_frames(document):
    """Include parent transforms and actual page position, never a spread guess."""
    output = []
    page_offset = 0
    for spread in document['spreads']:
        def walk(items, parent, depth=0):
            if depth > 64:
                raise ValueError('Native group nesting exceeds 64')
            for item in items:
                xf = item.get('xf', [1, 0, 0, 1, 0, 0])
                if len(xf) != 6 or any(not isinstance(v, (int, float)) or not math.isfinite(v) for v in xf):
                    raise ValueError('Invalid native frame transformation')
                transform = _multiply(parent, xf)
                content = item.get('content', {})
                if content.get('type') == 'group':
                    walk(content['items'], transform, depth + 1)
                elif content.get('type') == 'text':
                    label = {}
                    if item.get('label'):
                        try:
                            candidate = json.loads(item['label'])
                        except (json.JSONDecodeError, TypeError):
                            candidate = None
                        if isinstance(candidate, dict):
                            label = candidate
                    points = [anchor['p'] for part in item.get('path', {}).get('subpaths', [])
                              for anchor in part.get('anchors', []) if 'p' in anchor]
                    located = None
                    if points:
                        mapped = [(transform[0]*p[0]+transform[2]*p[1]+transform[4],
                                   transform[1]*p[0]+transform[3]*p[1]+transform[5]) for p in points]
                        cx = (min(p[0] for p in mapped) + max(p[0] for p in mapped)) / 2
                        cy = (min(p[1] for p in mapped) + max(p[1] for p in mapped)) / 2
                        candidates = [page_offset+i for i, page in enumerate(spread['pages'])
                                      if page['x'] <= cx < page['x']+page['width'] and 0 <= cy < page['height']]
                        if len(candidates) == 1:
                            located = candidates[0]
                    output.append(dict(item=item, label=label, pageIndex=located))
        walk(spread['items'], [1, 0, 0, 1, 0, 0])
        page_offset += len(spread['pages'])
    ids = [frame['item']['id'] for frame in output]
    if len(ids) != len(set(ids)):
        raise ValueError('Native text frame IDs are not unique')
    return output


def thread_article_stories(native_path, flows, protected_ids):
    """Join {articleId: {pageIds: [...]}} through unique labelled body frames.

    Returns one manifest record per article. All continuations must be empty,
    independently staged stories. Already-identical chains are idempotent.
    Any declared protected span is refused, even if its chain already exists.
    """
    if not isinstance(flows, dict):
        raise ValueError('Article flows must be a dictionary')
    if not flows:
        return {}
    document, entries = _read_native(native_path)
    frames = _text_frames(document)
    protected = set(protected_ids)
    requests = []
    used = set()
    for aid, flow in flows.items():
        if not isinstance(aid, str) or not aid or not isinstance(flow, dict):
            raise ValueError('Invalid article flow identity')
        pages = flow.get('pageIds')
        if not isinstance(pages, list) or len(pages) < 2 or any(not isinstance(p, str) or not p for p in pages):
            raise ValueError('A continuation needs at least two ordered stable page IDs')
        if len(pages) != len(set(pages)):
            raise ValueError('An article flow cannot repeat a page or form a cycle')
        if protected.intersection(pages):
            raise ValueError('A continuation cannot change protected pages')
        chain = []
        for pid in pages:
            matches = [frame for frame in frames if frame['label'].get('role') == 'body'
                       and frame['label'].get('articleId') == aid and frame['label'].get('pageId') == pid]
            if len(matches) != 1:
                raise ValueError('Missing or ambiguous body frame for article ' + aid + ' on page ' + pid)
            frame = matches[0]
            fid = frame['item']['id']
            if frame['pageIndex'] is None:
                raise ValueError('Continuation frame has no unique physical page')
            if fid in used:
                raise ValueError('Continuation frames cannot occur in multiple chains')
            used.add(fid)
            chain.append(frame)
        expected_frames = [frame['item']['id'] for frame in chain]
        sid = chain[0]['item']['content']['story']
        first = document['stories'].get(str(sid))
        if first is None or not first.get('text'):
            raise ValueError('The first continuation frame needs its complete source story')
        requests.append((aid, pages, chain, sid, copy.deepcopy(first), expected_frames))
    manifest = {}
    for aid, pages, chain, sid, original, expected_frames in requests:
        first = document['stories'][str(sid)]
        if first['frames'] == expected_frames and all(frame['item']['content']['story'] == sid for frame in chain):
            unchanged = True
        else:
            unchanged = False
            if first['frames'] != [expected_frames[0]]:
                raise ValueError('The source story already has an undeclared thread')
            for frame in chain[1:]:
                other_sid = frame['item']['content']['story']
                other = document['stories'].get(str(other_sid))
                if other_sid == sid or other is None or other.get('text') != '' or other.get('frames') != [frame['item']['id']]:
                    raise ValueError('Continuation stories must be empty independent frames')
                if any(link.get('source', {}).get('story') == other_sid for link in document.get('hyperlinks', [])):
                    raise ValueError('An empty continuation story unexpectedly owns hyperlinks')
                if any(other.get(key) for key in ('anchors', 'xrefs', 'notes', 'tables', 'objects', 'indexRefs')):
                    raise ValueError('An empty continuation story owns unsupported content')
                del document['stories'][str(other_sid)]
                frame['item']['content']['story'] = sid
            first['frames'] = expected_frames
        expected = {**original, 'frames': expected_frames}
        if first != expected:
            raise ValueError('Threading changed source copy or rich story metadata')
        manifest[aid] = dict(storyId=sid, frameIds=expected_frames, pageIds=pages,
                             physicalPageNumbers=[frame['pageIndex']+1 for frame in chain],
                             sourceTextUnchanged=True, richStoryUnchanged=True, alreadyThreaded=unchanged)
    _write_native(native_path, document, entries)
    saved, _ = _read_native(native_path)
    for aid, record in manifest.items():
        if saved['stories'][str(record['storyId'])]['frames'] != record['frameIds']:
            raise ValueError('Saved native article thread differs from its declared chain')
    return manifest
