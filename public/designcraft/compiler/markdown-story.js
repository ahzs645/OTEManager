// CommonMark to native text and byte-ranged formatting, retaining the source.
// Port of tools/designcraft/markdown_story.py; ranges are UTF-8 byte offsets.
// HTML and inline images need explicit layout integration, so they fail
// instead of disappearing from a printed story.

const EMPTY_BOOKMARK_OPEN = /^<a\s+id=(["'])[^"']*\1\s*>$/i;
const EMPTY_BOOKMARK = /^\s*<a\s+id=(["'])[^"']*\1\s*>\s*<\/a>\s*$/i;
const encoder = new TextEncoder();

export const utf8Length = (value) => encoder.encode(value).length;

export function composeSource(source, bodyFormat = 'markdown', markdownit) {
  if (bodyFormat === 'plain') return { text: source, spans: [], paragraphs: [] };
  if (bodyFormat !== 'markdown') throw new Error('bodyFormat must be markdown or plain');
  if (typeof markdownit !== 'function') throw new Error('A markdown-it parser is required');
  const tokens = markdownit('commonmark', { html: true }).parse(source, {});
  const text = [], spans = [], paragraphs = [], lists = [];
  let length = 0, blockStyle = 'OTE Body', quoted = 0;
  const append = (value) => { text.push(value); length += utf8Length(value); };

  function inline(children = []) {
    const stack = [];
    let index = 0;
    while (index < children.length) {
      const token = children[index++];
      const kind = token.type;
      // Old Word/Google Docs conversions saved empty bookmark anchors.
      if (kind === 'html_inline' && EMPTY_BOOKMARK.test(token.content)) continue;
      if (kind === 'html_inline' && EMPTY_BOOKMARK_OPEN.test(token.content)) {
        if (index < children.length && children[index].type === 'html_inline' && children[index].content.toLowerCase() === '</a>') {
          index++;
          continue;
        }
      }
      if (kind === 'text' || kind === 'code_inline') {
        const start = length;
        append(token.content);
        if (kind === 'code_inline') spans.push({ start, end: length, attrs: { fontFamily: 'JetBrains Mono', fontStyle: 'Regular' } });
      } else if (kind === 'softbreak') append(' ');
      else if (kind === 'hardbreak') append(' ');
      else if (kind === 'strong_open' || kind === 'em_open' || kind === 'link_open') stack.push([kind, length, token.attrGet('href')]);
      else if (kind === 'strong_close' || kind === 'em_close' || kind === 'link_close') {
        if (!stack.length) throw new Error('Invalid inline formatting stack');
        const [opening, start, url] = stack.pop();
        if (opening.replace(/_open$/, '') !== kind.replace(/_close$/, '')) throw new Error('Mismatched inline formatting');
        if (start !== length) {
          const span = { start, end: length, kind: { strong_open: 'bold', em_open: 'italic', link_open: 'link' }[opening] };
          if (url) span.url = url;
          spans.push(span);
        }
      } else if (kind === 'html_inline' || kind === 'image') {
        throw new Error('Inline HTML/images require explicit layout slots; no content was discarded');
      } else throw new Error('Unsupported Markdown inline token: ' + kind);
    }
  }

  for (const token of tokens) {
    const kind = token.type;
    if (kind === 'heading_open') blockStyle = 'OTE Heading ' + token.tag.slice(1);
    else if (kind === 'heading_close' || kind === 'paragraph_close') blockStyle = 'OTE Body';
    else if (kind === 'bullet_list_open' || kind === 'ordered_list_open') lists.push({ ordered: kind === 'ordered_list_open', counter: Number.parseInt(token.attrGet('start') || '1', 10), pending: false });
    else if (kind === 'bullet_list_close' || kind === 'ordered_list_close') lists.pop();
    else if (kind === 'list_item_open') lists[lists.length - 1].pending = true;
    else if (kind === 'blockquote_open') quoted++;
    else if (kind === 'blockquote_close') quoted--;
    else if (kind === 'inline') {
      if (text.length) append('\n');
      const start = length;
      const listing = lists[lists.length - 1];
      if (listing?.pending) {
        append('  '.repeat(lists.length - 1) + (listing.ordered ? listing.counter + '. ' : '• '));
        listing.counter++;
        listing.pending = false;
      }
      inline(token.children);
      paragraphs.push({ start, end: length, style: quoted ? 'OTE Quote' : blockStyle });
    } else if (kind === 'fence' || kind === 'code_block') {
      if (text.length) append('\n');
      const start = length;
      append(token.content.replace(/\n$/, ''));
      paragraphs.push({ start, end: length, style: 'OTE Code' });
    } else if (kind === 'hr') {
      if (text.length) append('\n');
      const start = length;
      append('— — —');
      paragraphs.push({ start, end: length, style: 'OTE Body' });
    } else if (kind === 'html_block') {
      if (!EMPTY_BOOKMARK.test(token.content)) throw new Error('HTML blocks require explicit layout integration; no content was discarded');
    } else if (kind !== 'paragraph_open' && kind !== 'list_item_close') throw new Error('Unsupported Markdown block token: ' + kind);
  }
  if (!text.join('').trim()) throw new Error('Article has no printable text');
  // Resolve overlapping bold/emphasis ranges into explicit styles; applying
  // Bold then Italic separately would replace, rather than combine, the face.
  const emphasis = spans.filter((s) => s.kind === 'bold' || s.kind === 'italic');
  const endpoints = [...new Set(emphasis.flatMap((s) => [s.start, s.end]))].sort((a, b) => a - b);
  const formats = spans.filter((s) => s.kind !== 'bold' && s.kind !== 'italic');
  for (let i = 0; i + 1 < endpoints.length; i++) {
    const start = endpoints[i], end = endpoints[i + 1];
    const kinds = new Set(emphasis.filter((s) => s.start <= start && end <= s.end).map((s) => s.kind));
    if (kinds.size) formats.push({ start, end, attrs: { fontStyle: kinds.size === 2 ? 'Bold Italic' : kinds.has('bold') ? 'Bold' : 'Italic' } });
  }
  return { text: text.join(''), spans: formats, paragraphs };
}
