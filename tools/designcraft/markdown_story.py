"""CommonMark to native text and byte-ranged formatting, retaining the source.

HTML and inline images need explicit layout integration, so they fail instead
of disappearing from a printed story. Editorial source remains separate.
"""
import re

EMPTY_BOOKMARK_OPEN = re.compile(r'<a\s+id=([\"\'])[^\"\']*\1\s*>', re.IGNORECASE)
EMPTY_BOOKMARK = re.compile(r'\s*<a\s+id=([\"\'])[^\"\']*\1\s*>\s*</a>\s*', re.IGNORECASE)


def compose_source(source, body_format='markdown'):
    if body_format == 'plain':
        return dict(text=source, spans=[], paragraphs=[])
    if body_format != 'markdown':
        raise ValueError('bodyFormat must be markdown or plain')
    try:
        from markdown_it import MarkdownIt
    except ImportError as error:
        raise ValueError('Install compiler dependencies: python3 -m pip install -r requirements.txt') from error
    tokens = MarkdownIt('commonmark', {'html': True}).parse(source)
    text, spans, paragraphs = [], [], []
    length = 0
    block_style = 'OTE Body'
    lists = []
    quoted = 0

    def append(value):
        nonlocal length
        text.append(value)
        length += len(value.encode('utf-8'))

    def inline(children):
        stack = []
        children = children or []
        index = 0
        while index < len(children):
            token = children[index]
            index += 1
            kind = token.type
            # Old Word/Google Docs conversions saved empty bookmark anchors.
            # Ignore only their HTML tokens; literal code/examples stay intact.
            if kind == 'html_inline' and EMPTY_BOOKMARK.fullmatch(token.content):
                continue
            if kind == 'html_inline' and EMPTY_BOOKMARK_OPEN.fullmatch(token.content):
                if index < len(children) and children[index].type == 'html_inline' and children[index].content.lower() == '</a>':
                    index += 1
                    continue
            if kind in ('text', 'code_inline'):
                start = length
                append(token.content)
                if kind == 'code_inline':
                    spans.append(dict(start=start, end=length, attrs={'fontFamily': 'JetBrains Mono', 'fontStyle': 'Regular'}))
            elif kind == 'softbreak':
                append(' ')
            elif kind == 'hardbreak':
                append('\u2028')
            elif kind in ('strong_open', 'em_open', 'link_open'):
                stack.append((kind, length, token.attrGet('href')))
            elif kind in ('strong_close', 'em_close', 'link_close'):
                if not stack:
                    raise ValueError('Invalid inline formatting stack')
                opening, start, url = stack.pop()
                if opening.removesuffix('_open') != kind.removesuffix('_close'):
                    raise ValueError('Mismatched inline formatting')
                if start != length:
                    spans.append(dict(start=start, end=length,
                                      kind={'strong_open': 'bold', 'em_open': 'italic', 'link_open': 'link'}[opening],
                                      **({'url': url} if url else {})))
            elif kind in ('html_inline', 'image'):
                raise ValueError('Inline HTML/images require explicit layout slots; no content was discarded')
            else:
                raise ValueError('Unsupported Markdown inline token: ' + kind)

    for token in tokens:
        kind = token.type
        if kind == 'heading_open':
            block_style = 'OTE Heading ' + token.tag[1:]
        elif kind in ('heading_close', 'paragraph_close'):
            block_style = 'OTE Body'
        elif kind in ('bullet_list_open', 'ordered_list_open'):
            lists.append(dict(ordered=kind == 'ordered_list_open', counter=int(token.attrGet('start') or 1), pending=False))
        elif kind in ('bullet_list_close', 'ordered_list_close'):
            lists.pop()
        elif kind == 'list_item_open':
            lists[-1]['pending'] = True
        elif kind == 'blockquote_open':
            quoted += 1
        elif kind == 'blockquote_close':
            quoted -= 1
        elif kind == 'inline':
            if text:
                append('\n')
            start = length
            if lists and lists[-1]['pending']:
                listing = lists[-1]
                append('  ' * (len(lists) - 1) + (str(listing['counter']) + '. ' if listing['ordered'] else '• '))
                listing['counter'] += 1
                listing['pending'] = False
            inline(token.children)
            paragraphs.append(dict(start=start, end=length, style='OTE Quote' if quoted else block_style))
        elif kind in ('fence', 'code_block'):
            if text:
                append('\n')
            start = length
            append(token.content.removesuffix('\n'))
            paragraphs.append(dict(start=start, end=length, style='OTE Code'))
        elif kind == 'hr':
            if text:
                append('\n')
            start = length
            append('— — —')
            paragraphs.append(dict(start=start, end=length, style='OTE Body'))
        elif kind == 'html_block':
            if not EMPTY_BOOKMARK.fullmatch(token.content):
                raise ValueError('HTML blocks require explicit layout integration; no content was discarded')
        elif kind not in ('paragraph_open', 'list_item_close'):
            raise ValueError('Unsupported Markdown block token: ' + kind)
    if not ''.join(text).strip():
        raise ValueError('Article has no printable text')
    # Resolve overlapping bold/emphasis ranges into explicit styles. Applying
    # Bold then Italic separately would replace, rather than combine, the face.
    emphasis = [s for s in spans if s.get('kind') in ('bold', 'italic')]
    endpoints = sorted({p for s in emphasis for p in (s['start'], s['end'])})
    formats = [s for s in spans if s.get('kind') not in ('bold', 'italic')]
    for start, end in zip(endpoints, endpoints[1:]):
        kinds = {s['kind'] for s in emphasis if s['start'] <= start and end <= s['end']}
        if kinds:
            formats.append(dict(start=start, end=end, attrs={'fontStyle': 'Bold Italic' if len(kinds) == 2 else 'Bold' if 'bold' in kinds else 'Italic'}))
    return dict(text=''.join(text), spans=formats, paragraphs=paragraphs)
