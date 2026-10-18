"""Native cover references that follow an article headline after export.

Stock preflight does not flag an unresolved cross-reference. These helpers
therefore check every expected anchor and generated reference explicitly.
Protected destinations without an existing named anchor retain a checked
static reference; adding an anchor would change their protected story.
"""
import copy
import json
from pathlib import Path
import shutil
import subprocess
import tempfile

from native_flow import _read_native, _text_frames, _write_native

ANCHOR_MARK = '\ue00b'
XREF_MARK = '\ue00c'
# Only the page number is a live cross-reference; the headline follows as ordinary text so it
# wraps at word boundaries inside the cover card (a generated reference never breaks inside).
FORMAT_NAME = 'OTE Featured Page'
FORMAT_DEFINITION = '<pageNum />'
SEPARATOR = ' · '
# Covers built before October 2026 generate "page · headline" as one reference.
LEGACY_FORMAT_NAME = 'OTE Featured Article'
FORMATS = (FORMAT_NAME, LEGACY_FORMAT_NAME)


def _run(cli, output_dir, name, steps):
    output = Path(output_dir)
    output.mkdir(parents=True, exist_ok=True)
    script = output / (name + '.dcs')
    script.write_text('\n'.join(command + ' ' + json.dumps(params, ensure_ascii=False)
                                for command, params in steps) + '\n', encoding='utf-8')
    process = subprocess.run([str(cli), 'script', str(script)], capture_output=True, text=True, timeout=180)
    (output / (name + '-stdout.json')).write_text(process.stdout, encoding='utf-8')
    (output / (name + '-stderr.txt')).write_text(process.stderr, encoding='utf-8')
    try:
        result = json.loads(process.stdout)
    except json.JSONDecodeError as error:
        raise ValueError('Native reference command did not return JSON') from error
    if process.returncode or result.get('error'):
        raise ValueError('Native reference command failed: ' + str(result.get('error', process.stderr))[:600])
    return result['results']


def _anchor_name(aid):
    return 'ote:article:' + aid + ':headline'


def _anchors(document, name=None, identity=None):
    return [(int(sid), anchor) for sid, story in document['stories'].items()
            for anchor in story.get('anchors', [])
            if (name is None or anchor['name'] == name) and (identity is None or anchor['id'] == identity)]


def _one(frames, aid, role, cover=False):
    found = [frame for frame in frames if frame['label'].get('articleId') == aid
             and frame['label'].get('role') == role
             and (not cover or str(frame['label'].get('slotId', '')).startswith('cover-card-'))]
    if role == 'headline' and len(found) > 1:
        if any(frame['pageIndex'] is None for frame in found):
            raise ValueError('A featured headline has no unique physical page: ' + aid)
        first_page = min(frame['pageIndex'] for frame in found)
        found = [frame for frame in found if frame['pageIndex'] == first_page]
    if len(found) != 1:
        raise ValueError('Missing or ambiguous ' + ('cover reference' if cover else role) + ' frame for ' + aid)
    return found[0]


def _title(story):
    return story['text'].replace(ANCHOR_MARK, '')


def _generated_text(page, title):
    """Match stock xref.expand's typographic quote conversion exactly."""
    previous = ' '
    output = []
    for character in str(page) + ' · ' + title:
        if character == '"':
            output.append('\u201c' if previous.isspace() or previous in '([' else '\u201d')
        else:
            output.append(character)
        previous = character
    return ''.join(output)


def _card_text(format_name, title):
    return XREF_MARK if format_name == LEGACY_FORMAT_NAME else XREF_MARK + SEPARATOR + title


def _single_paragraph_title(title):
    if not isinstance(title, str) or not title.strip():
        raise ValueError('A featured article needs a nonempty headline')
    if '\n' in title or '\r' in title:
        raise ValueError('A featured headline needs one paragraph; use frame wrapping for visual line breaks')


def _protected_snapshot(document, protected):
    frames = [frame for frame in _text_frames(document) if frame['label'].get('pageId') in protected]
    return {frame['item']['id']: dict(item=copy.deepcopy(frame['item']),
                                     story=copy.deepcopy(document['stories'][str(frame['item']['content']['story'])]))
            for frame in frames}


def _body_snapshot(document):
    return {str(frame['item']['content']['story']): copy.deepcopy(document['stories'][str(frame['item']['content']['story'])])
            for frame in _text_frames(document) if frame['label'].get('role') == 'body'}


def _asset_payloads(entries):
    return {info.filename: payload for info, payload in entries if info.filename.startswith('assets/')}


def attach_cover_references(native_path, featured_ids, articles_by_id, protected_ids, cli, output_dir, base_native=None):
    """Attach references transactionally and return a verification manifest.

    Labels identify actual cover text frames (piece/cover-card-N) and article
    headline frames. For protected covers, existing native references can keep
    their target ID by transferring the old anchor onto an editable replacement
    headline. Plain protected cards remain explicitly static and must be current.
    """
    ids = list(featured_ids)
    if len(ids) > 3 or len(ids) != len(set(ids)) or any(not isinstance(aid, str) or aid not in articles_by_id for aid in ids):
        raise ValueError('Choose up to three distinct known featured articles')
    manifest = dict(schemaVersion='ote.native.cover-references.v1', format=FORMAT_NAME,
                    features=[], staticFallbacks=[])
    if not ids:
        return manifest
    path = Path(native_path).resolve()
    original, original_entries = _read_native(path)
    frames = _text_frames(original)
    protected = set(protected_ids)
    base = _read_native(base_native)[0] if base_native else original
    plans = []
    for aid in ids:
        _single_paragraph_title(articles_by_id[aid].get('title'))
        headline = _one(frames, aid, 'headline')
        card = _one(frames, aid, 'piece', cover=True)
        hsid, csid = headline['item']['content']['story'], card['item']['content']['story']
        if headline['pageIndex'] is None or card['pageIndex'] != 0:
            raise ValueError('Featured headline must be on a located page and its card on the front cover')
        if _title(original['stories'][str(hsid)]) != articles_by_id[aid]['title']:
            raise ValueError('Featured headline does not match its source article: ' + aid)
        name = _anchor_name(aid)
        named = _anchors(original, name=name)
        if len(named) > 1:
            raise ValueError('Featured article anchor name is ambiguous: ' + aid)
        if named and named[0][0] != hsid:
            raise ValueError('Featured article anchor belongs to a different headline story')
        card_story = original['stories'][str(csid)]
        card_protected = card['label'].get('pageId') in protected
        headline_protected = headline['label'].get('pageId') in protected
        plan = dict(articleId=aid, headlineStoryId=hsid, coverStoryId=csid,
                    headlinePageId=headline['label'].get('pageId'),
                    headlinePageIndex=headline['pageIndex'], coverPageId=card['label'].get('pageId'),
                    anchorName=name, title=articles_by_id[aid]['title'], mode='dynamic',
                    anchorId=named[0][1]['id'] if named else None,
                    transfer=None, createAnchor=False, updateCard=not card_protected)
        if card_protected and card_story.get('xrefs'):
            old = card_story['xrefs'][0] if len(card_story['xrefs']) == 1 else None
            if old is not None and old['format'] == FORMAT_NAME and card_story['text'].startswith(XREF_MARK + SEPARATOR) \
                    and card_story['text'] != _card_text(old['format'], articles_by_id[aid]['title']):
                # Only the page number is live; the protected card prints the headline as plain text.
                raise ValueError('A protected cover card prints its headline as text and cannot follow a changed headline; '
                                 'unprotect the cover or keep the headline: ' + aid)
            if old is None or card_story['text'] != _card_text(old['format'], articles_by_id[aid]['title']):
                raise ValueError('Protected cover reference must contain one isolated native cross-reference')
            matches = _anchors(base, name=name, identity=old['target'])
            if len(matches) != 1 or old['format'] not in FORMATS:
                raise ValueError('Protected cover reference has an unknown article destination or format')
            if plan['anchorId'] != old['target']:
                if headline_protected or _anchors(original, identity=old['target']):
                    raise ValueError('Cannot transfer a live or protected article destination')
                if named:
                    plan['transfer'] = copy.deepcopy(matches[0][1])
                else:
                    plan['createAnchor'] = True
                    plan['transfer'] = copy.deepcopy(matches[0][1])
        elif card_protected or (headline_protected and not named):
            if card_story.get('xrefs'):
                raise ValueError('A protected destination without an anchor cannot retain an unverified reference')
            plan['mode'] = 'static'
            plan['staticText'] = card_story['text']
            plan['updateCard'] = False
            manifest['staticFallbacks'].append(dict(articleId=aid,
                reason='protected-cover-without-native-reference' if card_protected else 'protected-headline-without-anchor'))
        elif not named:
            plan['createAnchor'] = True
        plans.append(plan)
    snapshot = _protected_snapshot(original, protected)
    bodies = _body_snapshot(original)
    holder = tempfile.NamedTemporaryFile(prefix=path.stem + '-refs-', suffix='.designcraft', dir=path.parent, delete=False)
    staged = Path(holder.name)
    holder.close()
    try:
        shutil.copyfile(path, staged)
        steps = [('file.open', {'path': str(staged)})]
        anchor_steps = []
        for plan in plans:
            if plan['createAnchor']:
                steps.append(('text.select', dict(story=plan['headlineStoryId'], anchor=0, focus=0)))
                anchor_steps.append((plan, len(steps)))
                steps.append(('anchor.create', {'name': plan['anchorName']}))
        if anchor_steps:
            steps.append(('file.saveAs', {'path': str(staged)}))
            results = _run(cli, output_dir, 'native-reference-anchors', steps)
            for plan, index in anchor_steps:
                plan['anchorId'] = results[index]['id']
        updated, entries = _read_native(staged)
        for plan in plans:
            if plan['transfer']:
                transferred = plan['transfer']
                if _anchors(updated, identity=transferred['id']):
                    raise ValueError('Transferred anchor ID still exists in another story')
                story = updated['stories'][str(plan['headlineStoryId'])]
                found = [index for index, anchor in enumerate(story.get('anchors', [])) if anchor['id'] == plan['anchorId']]
                if len(found) != 1:
                    raise ValueError('Replacement headline anchor is ambiguous')
                story['anchors'][found[0]] = transferred
                plan['anchorId'] = transferred['id']
        _write_native(staged, updated, entries)
        dynamic = [plan for plan in plans if plan['mode'] == 'dynamic' and plan['updateCard']]
        if dynamic:
            steps = [('file.open', {'path': str(staged)}),
                     ('xref.defineFormat', dict(name=FORMAT_NAME, definition=FORMAT_DEFINITION))]
            for plan in dynamic:
                # Replace the whole card with the live page number followed by the plain headline.
                story = updated['stories'][str(plan['coverStoryId'])]
                steps.extend([('text.select', dict(story=plan['coverStoryId'], anchor=0, focus=len(story['text'].encode('utf-8')))),
                              ('text.insert', dict(text=SEPARATOR + plan['title'], raw=True)),
                              ('text.select', dict(story=plan['coverStoryId'], anchor=0, focus=0)),
                              ('xref.insert', dict(anchor=plan['anchorId'], format=FORMAT_NAME))])
            steps.append(('file.saveAs', {'path': str(staged)}))
            _run(cli, output_dir, 'native-reference-insert', steps)
        final, final_entries = _read_native(staged)
        if snapshot != _protected_snapshot(final, protected):
            raise ValueError('Attaching cover references changed protected native frames or stories')
        if bodies != _body_snapshot(final):
            raise ValueError('Attaching cover references changed a complete article body or its rich metadata')
        if _asset_payloads(original_entries) != _asset_payloads(final_entries):
            raise ValueError('Attaching cover references changed embedded asset bytes')
        for plan in plans:
            manifest['features'].append({key: value for key, value in plan.items()
                if key not in ('transfer', 'createAnchor', 'updateCard')})
        manifest['verification'] = verify_cover_references(staged, manifest, cli, output_dir)
        staged.replace(path)
        return manifest
    finally:
        staged.unlink(missing_ok=True)


def verify_cover_references(native_path, expected_manifest, cli, output_dir):
    """Validate every expected target, including after an IDML ID remapping.

    Dynamic references follow current headline text/page. Static fallbacks are
    invalid if their saved title or actual destination page changes.
    """
    if expected_manifest.get('schemaVersion') != 'ote.native.cover-references.v1':
        raise ValueError('Unknown native cover-reference manifest')
    features = expected_manifest.get('features', [])
    if not features:
        return dict(valid=True, features=[])
    document, _ = _read_native(native_path)
    frames = _text_frames(document)
    results = _run(cli, output_dir, 'native-reference-verify', [
        ('file.open', {'path': str(Path(native_path).resolve())}), ('xref.list', {}),
        ('anchor.list', {}), ('document.inspect', {})])
    references, anchors, inspected = results[1:]
    names = {page['index']: page['name'] for spread in inspected['spreads'] for page in spread['pages']}
    checks = []
    for feature in features:
        aid = feature['articleId']
        if feature['mode'] == 'static':
            headline = _one(frames, aid, 'headline')
            card = _one(frames, aid, 'piece', cover=True)
            title = _title(document['stories'][str(headline['item']['content']['story'])])
            text = document['stories'][str(card['item']['content']['story'])]['text']
            index = headline['pageIndex']
            current = {f'{names.get(index)} · {title}', f'{index+1:02d} · {title}'} if index is not None else set()
            if index != feature['headlinePageIndex'] or title != feature['title'] or text != feature['staticText'] or text not in current:
                raise ValueError('Static protected cover reference is stale for ' + aid)
            checks.append(dict(articleId=aid, mode='static', text=text, pageName=names[index]))
            continue
        named = [anchor for anchor in anchors if anchor['name'] == feature['anchorName']]
        if len(named) != 1 or named[0].get('page') is None:
            raise ValueError('Native featured article anchor is missing, ambiguous or overset: ' + aid)
        anchor = named[0]
        if len([candidate for candidate in anchors if candidate['id'] == anchor['id']]) != 1:
            raise ValueError('Native article anchor ID is not globally unique: ' + aid)
        records = [record for record in references if record['target'] == anchor['id'] and record['format'] in FORMATS]
        if len(records) != 1 or not records[0].get('text') or records[0]['text'] == '??':
            raise ValueError('Native cover reference is missing, ambiguous or unresolved: ' + aid)
        destination_frames = [frame for frame in frames if frame['item']['content']['story'] == anchor['story']]
        source_frames = [frame for frame in frames if frame['item']['content']['story'] == records[0]['story']]
        if len(destination_frames) != 1 or len(source_frames) != 1 or source_frames[0]['pageIndex'] != 0:
            raise ValueError('Native reference must link one cover card to one headline frame')
        header = document['stories'][str(anchor['story'])]
        card = document['stories'][str(records[0]['story'])]
        headline = _title(header)
        _single_paragraph_title(headline)
        if card['text'] != _card_text(records[0]['format'], headline) or len(card.get('xrefs', [])) != 1:
            raise ValueError('Native cover card must contain its isolated generated reference')
        expected = _generated_text(anchor['page'], headline) if records[0]['format'] == LEGACY_FORMAT_NAME else str(anchor['page'])
        if records[0]['text'] != expected:
            raise ValueError('Native cover reference generated unexpected text: ' + aid)
        # text: the card as it reads; generated: the live part the engine wrote (the page number,
        # or the whole card for the legacy format).
        checks.append(dict(articleId=aid, mode='dynamic', text=card['text'].replace(XREF_MARK, records[0]['text'], 1),
                           generated=records[0]['text'], anchorId=anchor['id'], pageName=anchor['page']))
    return dict(valid=True, features=checks)
