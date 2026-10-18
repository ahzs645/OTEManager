#!/usr/bin/env python3
"""Compose a validated page plan into one editable DesignCraft issue.

Uses native page placement, retaining full editorial source. Preservation
requires a native base and checks the preserved objects after saving.
"""
import argparse
from collections import Counter
import copy
import importlib.util
import json
import hashlib
from pathlib import Path
import shutil
import sys
import subprocess
import zipfile
from native_flow import thread_article_stories, _read_native, _write_native
from native_references import attach_cover_references, verify_cover_references
from preservation import validate_protected_identity, page_story_texts, validate_cover_photo, embedded_cover_hash

spec = importlib.util.spec_from_file_location('ote_page_compiler', Path(__file__).with_name('compile-template.py'))
page_compiler = importlib.util.module_from_spec(spec)
spec.loader.exec_module(page_compiler)


def load_native(path):
    with zipfile.ZipFile(path) as z:
        return json.loads(z.read('document.json'))


def namespace_styles(source, destination, prefix):
    with zipfile.ZipFile(source) as z:
        entries = [(i, z.read(i.filename)) for i in z.infolist()]
    d = json.loads(next(data for i, data in entries if i.filename == 'document.json'))
    # Native placement reuses existing style names. Include the source
    # definitions so an edited recipe cannot inherit its older typography.
    style_digest = hashlib.sha256(json.dumps(d['styles'], ensure_ascii=False, sort_keys=True, separators=(',', ':')).encode()).hexdigest()[:16]
    prefix = prefix + '/' + style_digest
    names = {}
    for kind in ('paragraph', 'character', 'object', 'cell', 'table'):
        for style in d['styles'].get(kind, []):
            if not style['name'].startswith('['):
                names[style['name']] = prefix + '/' + style['name']

    def rename(value):
        if isinstance(value, dict):
            return {key: names.get(v, v) if isinstance(v, str) and key in
                    ('name', 'style', 'basedOn', 'nextStyle', 'objectStyle', 'paragraphStyle', 'characterStyle')
                    else rename(v) for key, v in value.items()}
        if isinstance(value, list):
            return [rename(v) for v in value]
        return value
    d = rename(d)
    with zipfile.ZipFile(destination, 'w', zipfile.ZIP_DEFLATED) as z:
        for i, data in entries:
            z.writestr(i, json.dumps(d, ensure_ascii=False).encode() if i.filename == 'document.json' else data)


def page_objects(document, index):
    pages = [(sp, page) for sp in document['spreads'] for page in sp['pages']]
    spread, page = pages[index]
    # A whole single-page spread is exact. For facing spreads, protect the
    # entire spread: shared objects may cross the gutter.
    return dict(spread=spread, parents=document['parents'],
                stories={str(i): document['stories'][str(i)] for i in story_ids(spread['items'])})


def story_ids(items):
    result = set()
    for item in walk_items(items):
        content = item.get('content', {})
        if content.get('type') == 'text':
            result.add(content['story'])
    return result


def walk_items(items, depth=0):
    if depth > 64:
        raise ValueError('Native group nesting exceeds 64')
    for item in items:
        yield item
        if item.get('content', {}).get('type') == 'group':
            yield from walk_items(item['content']['items'], depth + 1)


def locations(document):
    return [(si, page) for si, spread in enumerate(document['spreads']) for page in spread['pages']]


def restore_page_hyperlinks(native, prepared):
    """The stock layout-page placement command omits hyperlink records.

    Rebind them through stable object labels, checking text and UTF-8 ranges,
    without modifying any story or embedded asset.
    """
    with zipfile.ZipFile(native) as z:
        entries = [(i, z.read(i.filename)) for i in z.infolist()]
    d = json.loads(next(data for i, data in entries if i.filename == 'document.json'))
    labelled = {i['label']: i for sp in d['spreads'] for i in walk_items(sp['items']) if i.get('label')}
    restored = 0
    for source in prepared:
        if source is None:
            continue
        src = load_native(source)
        frames = {i['content']['story']: i for sp in src['spreads'] for i in walk_items(sp['items']) if i.get('content', {}).get('type') == 'text'}
        for link in src.get('hyperlinks', []):
            if link['source']['kind'] != 'text':
                raise ValueError('Unsupported page hyperlink source; export refused')
            sid = link['source']['story']
            frame = frames[sid]
            target = labelled.get(frame.get('label'))
            if target is None:
                raise ValueError('Cannot rebind hyperlink without its stable native label')
            target_sid = target['content']['story']
            if d['stories'][str(target_sid)]['text'] != src['stories'][str(sid)]['text']:
                raise ValueError('Hyperlink story text changed during placement')
            record = copy.deepcopy(link)
            record['id'] = d['nextId']
            d['nextId'] += 1
            record['source']['story'] = target_sid
            d.setdefault('hyperlinks', []).append(record)
            restored += 1
    temp = native.with_suffix('.links.tmp')
    with zipfile.ZipFile(temp, 'w', zipfile.ZIP_DEFLATED) as z:
        for i, data in entries:
            z.writestr(i, json.dumps(d, ensure_ascii=False).encode() if i.filename == 'document.json' else data)
    temp.replace(native)
    return restored


def remove_replaced_orphan_stories(native, base, pages, prepared, featured):
    if base is None:
        return 0
    changed = set()
    locs = locations(base)
    for index, path in enumerate(prepared):
        if path is not None:
            changed.update(story_ids(base['spreads'][locs[index][0]]['items']))
    document, entries = _read_native(native)
    live = {str(sid) for spread in document['spreads'] + document['parents'] for sid in story_ids(spread['items'])}
    removed = {str(sid) for sid in changed if str(sid) not in live}
    permitted = {'ote:article:' + aid + ':headline' for aid in featured}
    supported_targets = {anchor['id'] for sid in removed for anchor in (base['stories'].get(sid, {}).get('anchors', []) + document['stories'].get(sid, {}).get('anchors', [])) if anchor['name'] in permitted}
    removed_targets = {anchor['id'] for sid in removed for anchor in (base['stories'].get(sid, {}).get('anchors', []) + document['stories'].get(sid, {}).get('anchors', []))}
    referenced = {xref['target'] for sid, story in document['stories'].items() if sid not in removed for xref in story.get('xrefs', [])}
    if referenced & (removed_targets - supported_targets):
        raise ValueError('A replaced story owns an unmanaged cross-reference destination; keep it protected or update its references explicitly')
    for sid in removed:
        document['stories'].pop(sid, None)
    document['hyperlinks'] = [link for link in document.get('hyperlinks', []) if str(link.get('source', {}).get('story')) not in removed]
    _write_native(native, document, entries)
    return len(removed)


def compile_issue(args):
    out = args.output.resolve()
    if args.base_native and out == args.base_native.resolve().parent:
        raise ValueError('Use a separate output directory when rebuilding a native base')
    out.mkdir(parents=True, exist_ok=True)
    for name in ('issue.pdf', 'issue.idml', 'issue.designcraft', 'preflight.json', 'build-manifest.json'):
        (out / name).unlink(missing_ok=True)
    library = json.loads(args.library.read_text())
    issue = json.loads(args.issue.read_text())
    if getattr(args, 'font_profile', 'portable') == 'original2025' and not args.font_dir:
        raise ValueError('original2025 needs --font-dir with your original fonts')
    if issue.get('schemaVersion') != page_compiler.ISSUE_SCHEMA:
        raise ValueError('Unsupported issue schema')
    plan = issue.get('layoutPlan', {})
    cover_fields = {**{key: issue.get('issue', {}).get(key) for key in ('date', 'volume', 'number', 'year') if key in issue.get('issue', {})}, **plan.get('cover', {})}
    if isinstance(cover_fields.get('date'), str) and len(cover_fields['date']) == 10 and cover_fields['date'][:4].isdigit():
        cover_fields['year'] = int(cover_fields['date'][:4])
    pages = sorted(plan.get('pages', []), key=lambda p: p['pageNumber'])
    if not pages or len(pages) > 256:
        raise ValueError('An issue needs 1–256 explicitly planned pages')
    if [p['pageNumber'] for p in pages] != list(range(1, len(pages) + 1)):
        raise ValueError('Page numbers must be consecutive, starting at 1')
    if len({p['id'] for p in pages}) != len(pages):
        raise ValueError('Page IDs must be unique')
    if any(not isinstance(p['id'], str) or not p['id'] for p in pages):
        raise ValueError('Page IDs must be nonempty strings')
    if args.booklet and len(pages) % 4:
        raise ValueError('A saddle-stitched booklet needs a multiple-of-four page count')
    templates = {t['id']: t for t in library['templates']}
    if any(templates.get(p.get('templateId'), {}).get('design') for p in pages):
        raise ValueError('Original-design templates need the JavaScript compiler (public/designcraft/compiler); '
                         'the server runs it on the bundled WebAssembly engine')
    articles = {a['id']: a for a in issue['articles']}
    if len(articles) != len(issue['articles']):
        raise ValueError('Article IDs must be unique')
    for p in pages:
        if templates.get(p.get('templateId'), {}).get('kind') == 'cover' and p['pageNumber'] != 1:
            raise ValueError('The front cover must be page 1')
    placements = Counter()
    references = {}
    for p in pages:
        if p.get('mode') == 'preserve':
            ids = p.get('articleIds', [])
            if len(set(ids)) != len(ids) or any(aid not in articles for aid in ids):
                raise ValueError('Invalid preserved article assignments')
            is_cover = templates.get(p.get('templateId'), {}).get('kind') == 'cover' or (
                p['pageNumber'] == 1 and plan.get('cover', {}).get('mode') == 'preserve')
            if not is_cover:
                for aid in ids:
                    placements[aid] += 1
                    references.setdefault(aid, p['pageNumber'])
            continue
        if p['templateId'] not in templates:
            raise ValueError('Unknown template: ' + p['templateId'])
        t = templates[p['templateId']]
        if t['kind'] == 'cover' and p['pageNumber'] != 1:
            raise ValueError('The front cover must be page 1')
        ids = p.get('articleIds', [])
        if len(set(ids)) != len(ids) or any(i not in articles for i in ids):
            raise ValueError('Invalid or repeated article assignments on page ' + p['id'])
        if t['kind'] != 'cover':
            if len(ids) != t.get('storyCount', 0):
                raise ValueError('Story assignment count does not match page ' + p['id'])
            for aid in ids:
                placements[aid] += 1
                references.setdefault(aid, p['pageNumber'])
    flows = plan.get('articleFlows', {})
    if not isinstance(flows, dict) or any(aid not in articles for aid in flows):
        raise ValueError('Invalid continuation article IDs')
    for aid, flow in flows.items():
        chain = flow.get('pageIds', [])
        assigned = [p['id'] for p in pages if aid in p.get('articleIds', []) and templates.get(p.get('templateId'), {}).get('kind') != 'cover']
        if len(chain) < 2 or chain != assigned or len(set(chain)) != len(chain):
            raise ValueError('Continuation must list every assigned interior page exactly once in page order: ' + aid)
    if not args.allow_unplaced:
        unplaced = sorted(a for a in articles if not placements[a])
        if unplaced:
            raise ValueError('Each article needs an interior placement: ' + ', '.join(unplaced))
    if any(count > 1 and aid not in flows for aid, count in placements.items()):
        raise ValueError('Repeated article assignments require explicit continuation chains')
    protected_ids = {p['id'] for p in pages if p.get('mode') == 'preserve'}
    if plan.get('cover', {}).get('mode') == 'preserve':
        protected_ids.add(pages[0]['id'])
    if plan.get('truck', {}).get('mode') == 'preserve':
        truck_ids = plan.get('truck', {}).get('pageIds', [])
        if len(truck_ids) != 2 or len(set(truck_ids)) != 2:
            raise ValueError('Preserved centre spread needs two stable page IDs')
        if len(pages) % 2 or truck_ids != [p['id'] for p in pages[len(pages)//2-1:len(pages)//2+1]]:
            raise ValueError('Preserved centre IDs must identify the two centre pages in order')
        protected_ids.update(truck_ids)
    if protected_ids - {p['id'] for p in pages}:
        raise ValueError('A protected page ID is absent from the plan')
    if protected_ids and not args.base_native:
        raise ValueError('Preservation needs --base-native; a content export is not an existing layout')
    if any(p['id'] in protected_ids and p.get('mode') != 'preserve' for p in pages):
        raise ValueError('A protected page cannot also be replaced')
    previous_manifest = {}
    if args.base_native and (args.base_native.resolve().parent / 'build-manifest.json').is_file():
        previous_manifest = json.loads((args.base_native.resolve().parent / 'build-manifest.json').read_text())
    if args.base_native and (plan.get('cover', {}).get('mode') == 'preserve' or pages[0]['id'] in protected_ids and templates.get(pages[0].get('templateId'), {}).get('kind') == 'cover'):
        base_manifest = args.base_native.resolve().parent / 'build-manifest.json'
        if base_manifest.is_file():
            previous_manifest = json.loads(base_manifest.read_text())
            previous_refs = previous_manifest.get('coverReferences', {})
            previous_source_path = args.base_native.resolve().parent / 'source-issue.json'
            previous_source = json.loads(previous_source_path.read_text()) if previous_source_path.is_file() else {}
            previous_fields = {**{key: previous_source.get('issue', {}).get(key) for key in ('date', 'volume', 'number', 'year') if key in previous_source.get('issue', {})}, **previous_manifest.get('coverFields', {})}
            if isinstance(previous_fields.get('date'), str) and len(previous_fields['date']) == 10 and previous_fields['date'][:4].isdigit():
                previous_fields['year'] = int(previous_fields['date'][:4])
            for key in ('date', 'volume', 'number', 'year', 'line', 'caption', 'photoPath', 'focus', 'fit', 'articleIds'):
                if key in cover_fields and key not in previous_fields:
                    raise ValueError('Cannot verify an unrecorded protected cover field; make it editable: ' + key)
                if key in previous_fields and cover_fields.get(key) != previous_fields[key]:
                    raise ValueError('Cover fields changed while the cover was protected; make it editable to apply changes')
            featured_ids = cover_fields.get('articleIds', pages[0].get('articleIds', []))
            dynamic_ids = {feature['articleId'] for feature in previous_manifest.get('nativeCoverReferences', {}).get('features', []) if feature.get('mode') == 'dynamic'}
            if any(aid in featured_ids and aid in previous_refs and previous_refs[aid] != number and aid not in dynamic_ids for aid, number in references.items()):
                raise ValueError('A statically referenced article moved while its cover was protected; make the cover editable to update its reference')
    fonts = (args.font_dir or args.library.resolve().parent / 'assets/fonts').resolve()
    base = load_native(args.base_native) if args.base_native else None
    destination_fonts = out / 'Document Fonts'
    if args.base_native:
        base_fonts = next((p for p in args.base_native.resolve().parent.iterdir() if p.is_dir() and p.name.lower() == 'document fonts'), None)
        if base_fonts:
            if protected_ids and fonts.is_dir():
                requested = {p.name.casefold(): p for p in fonts.iterdir() if p.is_file() and p.suffix.lower() in ('.ttf', '.otf', '.ttc', '.otc')}
                for original in base_fonts.iterdir():
                    replacement = requested.get(original.name.casefold())
                    if replacement and hashlib.sha256(original.read_bytes()).digest() != hashlib.sha256(replacement.read_bytes()).digest():
                        raise ValueError('Protected pages require the exact base font files; make their pages editable before replacing fonts')
            if destination_fonts.is_symlink():
                destination_fonts.unlink()
            shutil.copytree(base_fonts, destination_fonts, dirs_exist_ok=True)
    # Requested fonts take priority for rebuilt pages, after preserving the base
    # scope. Conflicting binaries cannot alter protected page composition.
    if fonts.is_dir() and fonts.resolve() != destination_fonts.resolve():
        shutil.copytree(fonts, destination_fonts, dirs_exist_ok=True)
    if base and sum(len(s['pages']) for s in base['spreads']) != len(pages):
        raise ValueError('Native base and page plan must have the same page count')
    if base:
        recorded_hash = previous_manifest.get('nativeDocumentSha256')
        if recorded_hash and hashlib.sha256(args.base_native.read_bytes()).hexdigest() != recorded_hash:
            raise ValueError('Native base bytes no longer match the build manifest; use a matched base and manifest')
        validate_protected_identity(pages, protected_ids, base, previous_manifest)
        if plan.get('cover', {}).get('mode') == 'preserve' or pages[0]['id'] in protected_ids and templates.get(pages[0].get('templateId'), {}).get('kind') == 'cover':
            validate_cover_photo(args.base_native, base, previous_manifest, plan.get('cover', {}), args.issue.resolve().parent)
        locs = locations(base)
        protected_spreads = {locs[n][0] for n, p in enumerate(pages) if p['id'] in protected_ids}
        if any(locs[n][0] in protected_spreads and p['id'] not in protected_ids for n, p in enumerate(pages)):
            raise ValueError('Protect both pages of a continuous native spread')
        # Cross-page threads cannot be partly replaced without breaking text
        # continuity in a protected page.
        changed_items = {i['id'] for n, p in enumerate(pages) if p['id'] not in protected_ids for i in walk_items(base['spreads'][locs[n][0]]['items'])}
        protected_items = {i['id'] for si in protected_spreads for i in walk_items(base['spreads'][si]['items'])}
        if any(set(story['frames']) & changed_items and set(story['frames']) & protected_items for story in base['stories'].values()):
            raise ValueError('A story thread crosses changed and protected pages; export refused')
    protected = {p['id']: page_objects(base, n) for n, p in enumerate(pages) if p['id'] in protected_ids} if base else {}
    for p in pages:
        if p['id'] in protected and p['pageNumber'] != 1:
            native_texts = Counter(page_story_texts(base, p['pageNumber'] - 1))
            for aid in p.get('articleIds', []):
                expected = page_compiler.compose_source(articles[aid]['body'], articles[aid].get('bodyFormat', 'markdown'))['text']
                if not native_texts[expected]:
                    raise ValueError('Preserved page does not contain the assigned full article body: ' + aid)
    # Rebuilding against a protected layout must not silently ignore updated
    # editorial metadata or same-path image bytes.
    base_source = args.base_native.resolve().parent / 'source-issue.json' if args.base_native else None
    if base_source and base_source.is_file() and previous_manifest.get('sourceIssueSha256') and hashlib.sha256(base_source.read_bytes()).hexdigest() != previous_manifest['sourceIssueSha256']:
        raise ValueError('Native base source snapshot does not match its build manifest')
    prior_articles = previous_manifest.get('articleMetadata') or ({a['id']: a for a in json.loads(base_source.read_text()).get('articles', [])} if base_source and base_source.is_file() else {})
    for p in pages:
        if p['id'] not in protected_ids or p['pageNumber'] == 1:
            continue
        visible = page_story_texts(base, p['pageNumber'] - 1)
        for aid in p.get('articleIds', []):
            article = articles[aid]
            previous = prior_articles.get(aid)
            if previous:
                for key in ('title', 'author', 'bodyFormat', 'photos'):
                    if previous.get(key) != article.get(key):
                        raise ValueError('Protected article metadata changed; make its page editable: ' + aid + ' / ' + key)
            else:
                if article['title'] not in [text.replace('\ue00b', '') for text in visible] or str(article.get('author') or 'Author not provided') not in visible:
                    raise ValueError('Cannot verify protected article headline/byline: ' + aid)
            for photo in article.get('photos', []):
                expected_hash = previous_manifest.get('sourceMediaSha256', {}).get(photo['path'])
                actual_file = args.issue.resolve().parent / photo['path']
                if not expected_hash or not actual_file.is_file() or hashlib.sha256(actual_file.read_bytes()).hexdigest() != expected_hash:
                    raise ValueError('Protected article media cannot be verified or changed; make its page editable: ' + aid)
    prepared = []
    page_results = []
    for p in pages:
        if p['id'] in protected_ids:
            prepared.append(None)
            continue
        t = copy.deepcopy(templates[p['templateId']])
        if t['kind'] == 'cover':
            t = page_compiler.resolve_cover(t, issue, p.get('articleIds', []), args.issue.resolve().parent, references)
        # Absolute library assets remain rooted in the trusted input library,
        # even though the per-page resolved recipe lives in the build folder.
        for slot in t['slots']:
            if slot.get('asset') and not Path(slot['asset']).is_absolute():
                slot['asset'] = str((args.library.resolve().parent / slot['asset']).resolve())
        page_dir = out / 'pages' / f"{p['pageNumber']:03}"
        page_dir.mkdir(parents=True, exist_ok=True)
        lib_path = page_dir / 'templates.json'
        page_compiler.write_json(lib_path, {**library, 'templates': [t]})
        page_issue = copy.deepcopy(issue)
        if page_issue.get('layoutPlan', {}).get('cover', {}).get('photoPath'):
            page_issue['layoutPlan']['cover']['photoPath'] = str((args.issue.resolve().parent / page_issue['layoutPlan']['cover']['photoPath']).resolve())
        page_issue['articles'] = copy.deepcopy([articles[i] for i in p.get('articleIds', [])])
        for article in page_issue['articles']:
            for photo in article.get('photos', []):
                if photo.get('path') and not Path(photo['path']).is_absolute():
                    photo['path'] = str((args.issue.resolve().parent / photo['path']).resolve())
        issue_path = page_dir / 'issue.json'
        page_compiler.write_json(issue_path, page_issue)
        ns = argparse.Namespace(library=lib_path, template=t['id'], issue=issue_path,
                                articles=','.join(p.get('articleIds', [])), output=page_dir,
                                cli=args.cli, font_dir=fonts, page_number=p['pageNumber'], page_id=p['id'],
                                font_profile=getattr(args, 'font_profile', 'portable'),
                                staged_flow_ids=[aid for aid in p.get('articleIds', []) if aid in flows],
                                continuation_article_ids=[aid for aid in p.get('articleIds', []) if aid in flows and flows[aid]['pageIds'][0] != p['id']])
        try:
            result = page_compiler.compile_page(ns)
        except (ValueError, OSError, KeyError, IndexError, subprocess.SubprocessError, zipfile.BadZipFile) as error:
            page_preflight_path = page_dir / 'preflight.json'
            failed_preflight = json.loads(page_preflight_path.read_text()) if page_preflight_path.is_file() else dict(errors=1, warnings=0, issues=[])
            failed_preflight['issues'] = [{**record, 'pageNumber': p['pageNumber'], 'pageId': p['id']} for record in failed_preflight.get('issues', [])]
            if not failed_preflight.get('errors') or not failed_preflight['issues']:
                failed_preflight['errors'] = max(1, failed_preflight.get('errors', 0))
                failed_preflight['issues'].append(dict(kind='page-compilation-failed', severity='error', pageNumber=p['pageNumber'], pageId=p['id'], message=str(error)))
            page_compiler.write_json(out / 'preflight.json', failed_preflight)
            page_compiler.write_json(out / 'source-issue.json', issue)
            page_compiler.write_json(out / 'build-manifest.json', dict(schemaVersion='ote.designcraft.issue-build.v1', status='needs-layout-adjustment', failedPageNumber=p['pageNumber'], failedPageId=p['id'], sourceMarkdownPreserved=True, articleBodiesInNative=False, pageBuilds=page_results, preflight=failed_preflight, message=str(error)))
            raise ValueError('Page ' + str(p['pageNumber']) + ' (' + p['id'] + ') failed composition; source, page draft and preflight retained: ' + str(error)) from error
        page_results.append(result)
        native = page_dir / 'namespaced.designcraft'
        namespace_styles(page_dir / 'page.designcraft', native, p['id'])
        prepared.append(native)
    steps = []
    if args.base_native:
        steps.append(('file.open', {'path': str(args.base_native.resolve())}))
    else:
        steps.append(('file.new', {'width': library['page']['width'], 'height': library['page']['height'],
                                   'pages': len(pages), 'facingPages': True, 'title': issue['issue'].get('title') or 'Over the Edge'}))
        steps.append(('layout.section', {'page': 1, 'style': 'arabicLeadingZero'}))
        steps.append(('file.saveAs', {'path': str(out / 'issue.designcraft')}))
        steps.append(('file.open', {'path': str(out / 'issue.designcraft')}))
    initialize = out / 'initialize.dcs'
    initialize.write_text('\n'.join(c + ' ' + json.dumps(p) for c, p in steps) + '\n' +
                          'file.saveAs ' + json.dumps({'path': str(out / 'issue.designcraft')}) + '\n')
    page_compiler.run_script(args.cli, initialize, out)
    locs = locations(load_native(out / 'issue.designcraft'))
    steps = [('file.open', {'path': str(out / 'issue.designcraft')})]
    cleared_spreads = set()
    for n, native in enumerate(prepared):
        if native is None:
            continue
        si, dest_page = locs[n]
        if base and si not in cleared_spreads:
            ids = [i['id'] for i in base['spreads'][si]['items']]
            if ids:
                steps.extend([('selection.set', {'ids': ids}), ('edit.clear', {})])
            cleared_spreads.add(si)
        steps.append(('file.place', {'path': str(native), 'layoutPage': 1, 'spread': si, 'x': dest_page['x'], 'y': 0}))
    steps.append(('file.saveAs', {'path': str(out / 'issue.designcraft')}))
    script = out / 'assemble.dcs'
    script.write_text('\n'.join(c + ' ' + json.dumps(p, ensure_ascii=False) for c, p in steps) + '\n')
    page_compiler.run_script(args.cli, script, out)
    cover_page = next((p for p in pages if templates.get(p.get('templateId'), {}).get('kind') == 'cover'), None)
    featured = plan.get('cover', {}).get('articleIds', cover_page.get('articleIds', []) if cover_page else [])
    if cover_page and featured != cover_page.get('articleIds', []):
        raise ValueError('Cover feature IDs disagree with the saved cover page')
    removed_stories = remove_replaced_orphan_stories(out / 'issue.designcraft', base, pages, prepared, featured)
    restored_links = restore_page_hyperlinks(out / 'issue.designcraft', prepared)
    flow_manifest = thread_article_stories(out / 'issue.designcraft', flows, protected_ids)
    reference_manifest = attach_cover_references(out / 'issue.designcraft', featured, articles, protected_ids, args.cli, out / 'references', base_native=args.base_native)
    steps = [('file.open', {'path': str(out / 'issue.designcraft')}),
                  ('preflight.run', {'minPpi': 150}), ('xref.list', {}), ('anchor.list', {}), ('document.inspect', {})]
    script = out / 'preflight.dcs'
    script.write_text('\n'.join(c + ' ' + json.dumps(p, ensure_ascii=False) for c, p in steps) + '\n')
    results = page_compiler.run_script(args.cli, script, out)['results']
    preflight = results[-4]
    native_xrefs, native_anchors = results[-3], results[-2]
    for reference in native_xrefs:
        targets = [a for a in native_anchors if a['id'] == reference['target']]
        if reference.get('text') == '??' or len(targets) != 1 or targets[0].get('page') is None:
            preflight['issues'].append(dict(kind='unresolved-reference', severity='error', story=reference['story'], message='Native cross-reference destination is missing, ambiguous or outside composed text'))
            preflight['errors'] += 1
    document = load_native(out / 'issue.designcraft')
    preserved = {p['id']: page_objects(document, n) == protected[p['id']] for n, p in enumerate(pages) if p['id'] in protected}
    if not all(preserved.values()):
        raise ValueError('Preserved native page objects changed; final export refused')
    # All rebuilt body stories survive grouping/placement; compare rendered
    # text independently of newly allocated native IDs.
    body_copy = {}
    texts = Counter(s['text'] for s in document['stories'].values())
    for aid, count in placements.items():
        expected = page_compiler.compose_source(articles[aid]['body'], articles[aid].get('bodyFormat', 'markdown'))['text']
        body_copy[aid] = texts[expected] >= (1 if aid in flows else count)
    if not all(body_copy.values()):
        raise ValueError('Issue assembly lost a composed article body')
    for index, p in enumerate(pages):
        p['nativePageId'] = [page for spread in document['spreads'] for page in spread['pages']][index]['id']
    page_compiler.write_json(out / 'source-issue.json', issue)
    manifest = dict(schemaVersion='ote.designcraft.issue-build.v1', pages=pages,
                    cliVersion=page_compiler.cli_version(args.cli), documentFontSha256=page_compiler.font_scope(out / 'Document Fonts'),
                    sourceIssueSha256=hashlib.sha256((out / 'source-issue.json').read_bytes()).hexdigest(),
                    articleMetadata={aid: {key: article.get(key) for key in ('title', 'author', 'bodyFormat', 'photos')} for aid, article in articles.items()},
                    articleFlows=flow_manifest, nativeCoverReferences=reference_manifest,
                    sourceMediaSha256={photo['path']: hashlib.sha256((args.issue.resolve().parent / photo['path']).read_bytes()).hexdigest() for article in issue['articles'] for photo in article.get('photos', [])},
                    nativeDocumentSha256=hashlib.sha256((out / 'issue.designcraft').read_bytes()).hexdigest(),
                    coverPhotoSha256=embedded_cover_hash(out / 'issue.designcraft', document), articleBodyChecks=body_copy,
                    fontProfile=getattr(args, 'font_profile', 'portable'),
                    restoredHyperlinks=restored_links, removedReplacedStories=removed_stories, checkedNativeCrossReferences=len(native_xrefs),
                    coverFields=cover_fields, coverReferences=references, preservedNativePages=preserved, pageBuilds=page_results,
                    preflight=preflight, sourceMarkdownPreserved=True, adobeInDesignTested=False,
                    status='needs-layout-adjustment' if preflight['errors'] else 'exported')
    page_compiler.write_json(out / 'preflight.json', preflight)
    page_compiler.write_json(out / 'source-issue.json', issue)
    manifest['interchangeHyperlinks'] = dict(nativeAndPdf=True, stockIdml=False,
        sidecarCount=page_compiler.save_metadata(out / 'issue.designcraft', out / 'interchange-metadata.json'),
        reopenTool='reopen-idml.py')
    page_compiler.write_json(out / 'build-manifest.json', manifest)
    if preflight['errors']:
        raise ValueError('Issue preflight errors block final PDF/IDML export; native draft and source retained')
    export = out / 'export.dcs'
    export.write_text('file.open ' + json.dumps({'path': str(out / 'issue.designcraft')}) + '\n' +
                      'file.exportPdf ' + json.dumps({'path': str(out / 'issue.pdf'), 'standard': 'x4'}) + '\n' +
                      'file.exportIdml ' + json.dumps({'path': str(out / 'issue.idml')}) + '\n')
    verify_cover_references(out / 'issue.designcraft', reference_manifest, args.cli, out / 'references-final')
    page_compiler.run_script(args.cli, export, out)
    return manifest


def main():
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument('--library', type=Path, required=True)
    p.add_argument('--issue', type=Path, required=True)
    p.add_argument('--output', type=Path, required=True)
    p.add_argument('--cli', required=True)
    p.add_argument('--font-dir', type=Path)
    p.add_argument('--font-profile', choices=['portable', 'original2025'], default='portable')
    p.add_argument('--base-native', type=Path)
    p.add_argument('--allow-unplaced', action='store_true', help='Explicit partial-issue review only')
    p.add_argument('--booklet', action='store_true')
    args = p.parse_args()
    try:
        print(json.dumps(compile_issue(args), ensure_ascii=False))
        return 0
    except (ValueError, OSError, KeyError, IndexError, subprocess.SubprocessError, zipfile.BadZipFile) as error:
        print('compile-issue: ' + str(error), file=sys.stderr)
        return 1


if __name__ == '__main__':
    sys.exit(main())
