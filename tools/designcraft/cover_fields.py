"""Resolve cover fields and article references from the issue's saved plan."""
import copy
from datetime import date
from pathlib import Path


def resolve_cover(template, issue, article_ids, issue_root, references=None):
    result = copy.deepcopy(template)
    info = issue.get('issue', {})
    cover = issue.get('layoutPlan', {}).get('cover', {})
    fields = {**info, **cover}
    if fields.get('date'):
        try:
            released = date.fromisoformat(fields['date'])
        except (TypeError, ValueError) as exc:
            raise ValueError('Choose a valid ISO cover release date') from exc
        date_text = released.strftime('%B ') + str(released.day)
    else:
        released = None
    for key in ('volume', 'number'):
        if key in fields and (isinstance(fields[key], bool) or not isinstance(fields[key], int) or fields[key] < 1):
            raise ValueError('Cover ' + key + ' must be a positive integer')
    for key in ('line', 'caption'):
        if key in cover and not isinstance(cover[key], str):
            raise ValueError('Cover ' + key + ' must be text')
    articles = {a['id']: a for a in issue.get('articles', [])}
    if len(article_ids) > 3 or len(set(article_ids)) != len(article_ids) or any(i not in articles for i in article_ids):
        raise ValueError('Choose up to three distinct cover articles')
    if references is None:
        references = {}
        for page in issue.get('layoutPlan', {}).get('pages', []):
            if page.get('kind') == 'cover' or page.get('templateId', '').startswith('cover-') or page.get('templateId') == template['id']:
                continue
            for aid in page.get('articleIds', []):
                if aid in references and aid not in issue.get('layoutPlan', {}).get('articleFlows', {}):
                    raise ValueError('A featured article has multiple interior page assignments')
                references[aid] = min(references.get(aid, page['pageNumber']), page['pageNumber'])
    missing = [aid for aid in article_ids if aid not in references]
    if missing:
        raise ValueError('Place each featured article on an interior page before exporting: ' + ', '.join(missing))
    for slot in result['slots']:
        sid = slot['id']
        if sid == 'cover-date' and released:
            slot['text'] = date_text.upper()
        elif sid == 'cover-year' and released:
            slot['text'] = str(released.year)
        elif sid == 'cover-issue' and 'volume' in fields and 'number' in fields:
            slot['text'] = f"VOLUME {fields['volume']} · ISSUE {fields['number']}" + (f' · {released.year}' if result.get('family') == 'framed' and released else '')
        elif sid == 'cover-line' and 'line' in cover:
            slot['text'] = cover['line']
        elif sid == 'cover-photo' and cover.get('photoPath'):
            slot.pop('articleIndex', None)
            slot['asset'] = str((Path(issue_root) / cover['photoPath']).resolve())
            slot['fit'] = cover.get('fit', slot.get('fit', 'cover'))
            slot['focus'] = cover.get('focus', {'x': .5, 'y': .5})
            if cover.get('zoom'):
                slot['zoom'] = cover['zoom']
        elif sid.startswith('cover-card-'):
            index = slot.get('articleIndex', 0)
            aid = article_ids[index] if index < len(article_ids) else None
            slot['text'] = f"{references[aid]:02d} · {articles[aid]['title']}" if aid else ''
            slot.pop('fields', None)
    result['slots'] = [s for s in result['slots'] if s['id'] != 'cover-caption']
    if cover.get('caption'):
        if result.get('family') == 'framed':
            rect = [42, 597, 714, 612]
            for slot in result['slots']:
                if slot['id'].startswith('cover-card-'):
                    slot['rect'][1] = max(slot['rect'][1], 616)
        else:
            rect = [60, 518, 696, 540]
        result['slots'].append({'id': 'cover-caption', 'role': 'caption', 'rect': rect,
                                'text': cover['caption'], 'fontSize': 8})
    return result
