"""Editable fixed editorial copy, matching compiler/structured-content.js."""
import math
import re
from markdown_story import compose_source

FIELD_STYLES = {'heading': 'OTE Headline', 'subtitle': 'OTE Label', 'question': 'OTE Label', 'answer': 'OTE Body', 'president': 'OTE Byline', 'body': 'OTE Body', 'closing': 'OTE Caption'}


def structured_content(slot, fields):
    if not (slot.get('blockType') == 'president-qa' or any(key in fields for key in ('question', 'answer', 'body')) or slot.get('contentLayout')):
        return None
    if slot.get('blockType') == 'president-qa' or any(key in fields for key in ('question', 'answer')):
        for key in ('question', 'answer'):
            if not isinstance(fields.get(key), str) or not fields[key].strip():
                raise ValueError(f'Editorial block {slot["id"]} needs a nonempty {key}')
    values = {'heading': slot.get('text', ''), **fields}
    layout = slot.get('contentLayout')
    if layout is not None and (not isinstance(layout, list) or not 1 <= len(layout) <= 32):
        raise ValueError('Editorial contentLayout needs 1–32 field regions')
    definitions = layout if layout is not None else [{'field': key} for key in dict.fromkeys([key for key in FIELD_STYLES if key in values] + list(values))]
    parts, used = [], set()
    for definition in definitions:
        field = definition.get('field')
        if not isinstance(field, str) or not re.fullmatch(r'[A-Za-z][A-Za-z0-9_-]{0,63}', field) or field in used:
            raise ValueError('Editorial field regions need unique field names')
        used.add(field)
        source = values.get(field)
        if source is None or source == '':
            continue
        if not isinstance(source, str):
            raise ValueError(f'Editorial field {field} must be text')
        rich = compose_source(source, definition.get('bodyFormat', slot.get('bodyFormat', 'plain')))
        if not rich['text'].strip():
            continue
        if layout is not None:
            rect = definition.get('rect')
            if not isinstance(rect, list) or len(rect) != 4 or any(not isinstance(n, (int, float)) or not math.isfinite(n) or not 0 <= n <= 1 for n in rect) or rect[0] >= rect[2] or rect[1] >= rect[3]:
                raise ValueError('Editorial field rectangles must be positive fractions within the reserved block')
        parts.append({**definition, 'field': field, 'style': definition.get('style', FIELD_STYLES.get(field, 'OTE Body')), 'source': source, 'rich': rich})
    for field, value in fields.items():
        if value is not None and value != '' and field not in used:
            raise ValueError(f'Editorial contentLayout has no region for {field}')
    if not parts:
        raise ValueError(f'Editorial block {slot["id"]} has no printable fields')
    text, paragraphs, spans = '', [], []
    for part in parts:
        if text:
            text += '\n'
        offset = len(text.encode('utf-8'))
        source_paragraphs = part['rich']['paragraphs'] or [{'start': 0, 'end': len(part['rich']['text'].encode('utf-8')), 'style': 'OTE Body'}]
        paragraphs.extend({**p, 'start': p['start'] + offset, 'end': p['end'] + offset, 'style': part['style'] if p['style'] == 'OTE Body' else p['style']} for p in source_paragraphs)
        spans.extend({**span, 'start': span['start'] + offset, 'end': span['end'] + offset} for span in part['rich']['spans'])
        text += part['rich']['text']
    return {'parts': parts, 'separate': layout is not None, 'rich': {'text': text, 'paragraphs': paragraphs, 'spans': spans}}
