// Compose an OTE template through stock DesignCraft commands and CommonMark.
// Port of tools/designcraft/compile-template.py. The command list is the same
// as the Python compiler's; files are symbolic so one script runs through the
// browser/Node WebAssembly engine or the native CLI (see executors.js):
//   @doc            the working .designcraft document
//   @media:<name>   placed media bytes (content-addressed, as Python's Links/)
//   @out:<name>     an export collected by the executor
import { composeSource, utf8Length } from './markdown-story.js';
import { resolveCover, resolveFields } from './cover-fields.js';
import { IDENTITY, clone, deepEqual, interchangeMetadata, readNative, sha256Hex, writeNative } from './native-doc.js';

export const LIBRARY_SCHEMA = 'ote.designcraft.templates.v1';
export const ISSUE_SCHEMA = 'ote.designcraft.issue.v1';
const MEDIA_SUFFIXES = ['.png', '.jpg', '.jpeg', '.pdf', '.tif', '.tiff', '.webp'];
const PORTABLE_FONT_PREFIXES = ['SourceSans3-', 'SourceSerif4-', 'JetBrainsMono-', 'Salted-'];
// Open substitutes for the original designs' faces; packaged only for design builds.
export const DESIGN_FONT_PREFIXES = ['texgyreheros', 'Barlow-', 'CaveatBrush-'];
const DESIGN_FONT_LICENSES = ['OFL-Barlow.txt', 'OFL-CaveatBrush.txt', 'GUST-FONT-LICENSE-TeXGyreHeros.txt'];
/** True when an open font file (or its licence) belongs to the design substitutes. */
export const isDesignFont = (name) => DESIGN_FONT_PREFIXES.some((p) => name.startsWith(p)) || DESIGN_FONT_LICENSES.includes(name);

/** A compilation that produced a draft but not final output; `artifacts` keeps what was made. */
export class CompileError extends Error {
  constructor(message, artifacts = {}) {
    super(message);
    this.name = 'CompileError';
    this.artifacts = artifacts;
  }
}

const isNumber = (v) => typeof v === 'number' && Number.isFinite(v);
const suffixOf = (path) => { const m = /(\.[^./\\]+)$/.exec(path); return m ? m[1].toLowerCase() : ''; };
// Python str.title() for field keys: each letter run gets one capital.
const titleCase = (value) => value.replace(/\p{L}+/gu, (w) => w[0].toUpperCase() + w.slice(1).toLowerCase());
// Python str()/repr() for custom-block field values, including list/dict fields.
function pyRepr(v) {
  if (typeof v === 'string') {
    const escaped = v.replaceAll('\\', '\\\\').replaceAll('\n', '\\n').replaceAll('\r', '\\r').replaceAll('\t', '\\t');
    return v.includes("'") && !v.includes('"') ? `"${escaped}"` : `'${escaped.replaceAll("'", "\\'")}'`;
  }
  if (Array.isArray(v)) return '[' + v.map(pyRepr).join(', ') + ']';
  if (v && typeof v === 'object') return '{' + Object.entries(v).map(([k, x]) => pyRepr(k) + ': ' + pyRepr(x)).join(', ') + '}';
  return pyStr(v);
}
const pyStr = (v) => (typeof v === 'string' ? v : v === true ? 'True' : v === false ? 'False' : v === null || v === undefined ? 'None' : typeof v === 'object' ? pyRepr(v) : String(v));

/**
 * Fonts accepted for a profile, as compile-template.py copies them into Document Fonts.
 * Builds with original designs (designs = true) also package the open substitutes.
 */
export function documentFonts(fonts, fontProfile, designs = false) {
  return fonts.filter(({ name }) => {
    if (!designs && isDesignFont(name)) return false;
    const suffix = suffixOf(name);
    const accepted = ['.ttf', '.otf', '.ttc', '.otc'].includes(suffix) && (fontProfile === 'original2025' || PORTABLE_FONT_PREFIXES.some((p) => name.startsWith(p)) || (designs && isDesignFont(name)));
    return accepted || name === 'LICENSE-Salted.txt' || (name.startsWith('OFL-') && name.endsWith('.txt')) || (designs && isDesignFont(name));
  });
}

/** True when any template in the library uses an original design. */
export const usesDesigns = (library) => (library?.templates ?? []).some((t) => t?.design);

export async function fontScope(fonts) {
  const scope = {};
  for (const font of [...fonts].sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0))) {
    if (['.ttf', '.otf', '.ttc', '.otc'].includes(suffixOf(font.name))) scope[font.name] = await sha256Hex(font.bytes);
  }
  return scope;
}

export function exampleArticles(count) {
  return Array.from({ length: count }, (_, i) => ({
    id: `example-${i + 1}`, title: `Example story ${i + 1}`, author: 'Example author',
    body: ('This is illustrative copy for the editable template. Replace it with an article from OTEManager. '
      + 'All submitted article text is retained; a page with overset copy needs a larger layout before final export.\n\n').repeat(3),
    photos: [],
  }));
}

/**
 * Build the page's command steps without running them.
 * options: {library, templateId | template, issue?, articleIds?, pageId, pageNumber, fontProfile,
 *   continuationArticleIds?, stagedFlowIds?, loadMedia(ref) → Uint8Array, markdownit}
 * ref is {root: 'library' | 'issue', path}.
 */
/** Family names in a font file's name table (typographic family, else family; every face of a collection). */
export function fontFamilies(bytes) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength), names = new Set();
  const tag = (at) => String.fromCharCode(bytes[at], bytes[at + 1], bytes[at + 2], bytes[at + 3]);
  const faces = tag(0) === 'ttcf' ? Array.from({ length: view.getUint32(8) }, (_, i) => view.getUint32(12 + 4 * i)) : [0];
  try {
    for (const face of faces) {
      const tables = view.getUint16(face + 4);
      for (let t = 0; t < tables; t++) {
        const record = face + 12 + 16 * t;
        if (tag(record) !== 'name') continue;
        const table = view.getUint32(record + 8), count = view.getUint16(table + 2), strings = table + view.getUint16(table + 4);
        const found = {};
        for (let r = 0; r < count; r++) {
          const at = table + 6 + 12 * r, platform = view.getUint16(at), id = view.getUint16(at + 6);
          if ((id !== 1 && id !== 16) || (platform !== 3 && platform !== 1 && platform !== 0)) continue;
          const length = view.getUint16(at + 8), offset = strings + view.getUint16(at + 10);
          let text = '';
          if (platform === 1) for (let i = 0; i < length; i++) text += String.fromCharCode(bytes[offset + i]);
          else for (let i = 0; i + 1 < length; i += 2) text += String.fromCharCode(view.getUint16(offset + i));
          if (text) found[id] ??= text;
        }
        if (found[16] ?? found[1]) names.add(found[16] ?? found[1]);
        if (found[1]) names.add(found[1]);
      }
    }
  } catch { /* not a readable sfnt: no families */ }
  return names;
}

/**
 * Original-font builds: the design families the supplied fonts do not provide, so each can use
 * its open substitute (compile option substituteFonts) instead of failing on a missing font.
 */
export function designFontGaps(library, fonts) {
  const wanted = new Set(), available = new Set();
  const want = (style) => { if (style && typeof style === 'object' && style.fontFamily) wanted.add(style.fontFamily); };
  const used = new Set(library.templates.map((t) => t.design).filter(Boolean));
  for (const name of used) for (const style of Object.values(library.designs?.[name]?.styles ?? {})) want(style);
  for (const template of library.templates) if (template.design) for (const slot of template.slots) want(slot.style);
  for (const font of fonts) if (/\.(ttf|otf|ttc|otc)$/i.test(font.name)) for (const family of fontFamilies(font.bytes)) available.add(family);
  return [...wanted].filter((family) => !available.has(family)).sort();
}

/** [family, face] a design prints with: the original, or its open substitute for portable builds and substituted faces. */
export function designFontMapper(design, fontProfile, substituteFonts = []) {
  const substitute = new Set(substituteFonts ?? []);
  return (fontFamily, face) => {
    if (!design || (fontProfile === 'original2025' && !substitute.has(fontFamily))) return [fontFamily, face];
    return design.fonts?.portable?.[`${fontFamily}|${face}`] ?? design.fonts?.portable?.[`${fontFamily}|*`] ?? [fontFamily, face];
  };
}

export async function buildPage(options) {
  const { library, issue = null, markdownit, loadMedia } = options;
  const pageId = options.pageId ?? 'page-1', pageNumber = options.pageNumber ?? 1;
  const fontProfile = options.fontProfile ?? 'portable';
  if (library?.schemaVersion !== LIBRARY_SCHEMA) throw new Error('Unsupported template library schema');
  let template = options.template ?? null;
  if (!template) {
    const matches = library.templates.filter((t) => t.id === options.templateId);
    if (matches.length !== 1) throw new Error('Select a unique template ID from the library');
    template = matches[0];
  }
  if (!Array.isArray(template.slots) || template.slots.some((slot) => typeof slot.id !== 'string' || !slot.id) || new Set(template.slots.map((slot) => slot.id)).size !== template.slots.length) throw new Error('Template frame IDs must be unique and nonempty');
  const bodyFlows = {};
  for (let i = 0; i < (template.storyCount ?? 0); i++) {
    const slots = template.slots.filter((slot) => slot.role === 'body' && slot.enabled !== false && (slot.articleIndex ?? 0) === i);
    const declared = template.bodyFlows?.[i];
    if (!slots.length || (slots.length > 1 && !Array.isArray(declared))) throw new Error('Multiple body regions require an explicit ordered bodyFlows entry');
    const ids = declared ?? slots.map((slot) => slot.id);
    if (ids.length !== slots.length || new Set(ids).size !== ids.length || ids.some((id) => !slots.some((slot) => slot.id === id))) throw new Error('Body flow must list every article body frame exactly once');
    bodyFlows[i] = ids;
  }
  const page = library.page, width = page.width, height = page.height;
  if (issue && issue.schemaVersion !== ISSUE_SCHEMA) throw new Error('Unsupported issue schema');
  const storyCount = template.storyCount ?? 0;
  const isCover = template.kind === 'cover';
  if (!['portable', 'original2025'].includes(fontProfile)) throw new Error('Unknown font profile');
  let articles = issue ? issue.articles ?? [] : exampleArticles(storyCount);
  if (options.articleIds) {
    const selected = options.articleIds;
    const index = new Map(articles.map((a) => [String(a.id), a]));
    const validCount = isCover ? selected.length >= 1 && selected.length <= 3 : selected.length === storyCount;
    if (!validCount || new Set(selected).size !== selected.length) throw new Error('--articles requires 1–3 distinct IDs for a cover, or one distinct ID per story slot');
    if (selected.some((i) => !index.has(i))) throw new Error('An article ID is absent from the issue');
    articles = selected.map((i) => index.get(i));
  } else {
    const featured = issue && isCover ? issue.layoutPlan?.cover?.articleIds : undefined;
    if (featured !== undefined && featured !== null) {
      const index = new Map(articles.map((a) => [a.id, a]));
      if (featured.some((aid) => !index.has(aid))) throw new Error('An article ID is absent from the issue');
      articles = featured.map((aid) => index.get(aid));
    } else articles = articles.slice(0, isCover ? 3 : storyCount);
  }
  if (new Set(articles.map((a) => a.id)).size !== articles.length) throw new Error('Article IDs must be distinct');
  if (!isCover && articles.length !== storyCount) throw new Error(`Template needs ${storyCount} articles; export has ${articles.length}`);
  for (const article of articles) {
    for (const field of ['id', 'title', 'body']) if (typeof article[field] !== 'string') throw new Error(`Article ${field} must be a string`);
    if (!article.title.trim() || !article.body.trim()) throw new Error('An article title or body is empty');
  }
  const continuationIds = new Set(options.continuationArticleIds ?? []);
  const stagedFlowIds = new Set(options.stagedFlowIds ?? []);
  const composed = {};
  for (const a of articles) composed[a.id] = composeSource(a.body, a.bodyFormat ?? 'markdown', markdownit);
  if (!isCover && Object.values(composed).some((r) => !r.text.trim())) throw new Error('An article has no printable body after Markdown conversion');
  // Original designs (library.designs): house styles, swatches, a design layer
  // placed from the source documents, and open font substitutes for portable builds.
  const family = template.design ? library.designs?.[template.design] ?? null : null;
  if (template.design && !family) throw new Error('Unknown template design: ' + template.design);
  // Original fonts by default; open substitutes for portable builds, or for faces a build lists
  // in substituteFonts because their licensed files are not available.
  const mapFont = designFontMapper(family, fontProfile, options.substituteFonts);
  if (isCover && issue) template = resolveCover(template, issue, articles.map((a) => a.id), options.references ?? null);
  if (family) template = resolveFields(template, issue, family);

  const steps = [], slotRefs = [], warnings = [], missingMedia = [], focusRequests = [];
  const bodyCounts = {}, photoCounts = {}, media = new Map();
  const add = (command, params = {}) => { steps.push({ command, params }); return steps.length - 1; };
  const ref = (index, key = 'id') => `$${index}.${key}`;
  const labelFrame = (index, slot, article) => {
    const metadata = { templateId: template.id, slotId: slot.id, role: slot.role, articleId: article ? article.id ?? null : null, pageId };
    if (slot.role === 'body') metadata.flowOrder = bodyFlows[slot.articleIndex ?? 0]?.indexOf(slot.id) ?? 0;
    if (slot.cardPart) metadata.cardPart = slot.cardPart;
    add('object.label', { ids: [ref(index)], label: pythonJson(metadata) });
    add('object.rename', { id: ref(index), name: slot.id });
    slotRefs.push({ ...metadata, commandIndex: index });
  };
  const styledText = (rect, text, style, columns = 1, slot = null, article = null, rich = null) => {
    const index = add('frame.create', { rect, content: 'text', text, caret: false });
    add('object.textFrameOptions', { ids: [ref(index)], inset: 0, columns, gutter: page.gutter ?? 12 });
    add('text.select', { story: ref(index, 'story'), anchor: 0, focus: utf8Length(text) });
    add('style.paragraph.apply', { name: style, clearOverrides: true });
    if (rich) {
      for (const paragraph of rich.paragraphs) {
        add('text.select', { story: ref(index, 'story'), anchor: paragraph.start, focus: paragraph.end });
        add('style.paragraph.apply', { name: paragraph.style === 'OTE Body' ? style : paragraph.style, clearOverrides: true });
      }
      for (const span of rich.spans) {
        add('text.select', { story: ref(index, 'story'), anchor: span.start, focus: span.end });
        if (span.attrs) add('type.char', { attrs: span.attrs });
        if (span.kind === 'link') add('hyperlink.create', { url: span.url });
      }
    }
    if (slot) labelFrame(index, slot, article);
    return index;
  };

  add('file.new', { width, height, pages: 1, facingPages: false, margins: page.margin ?? 36, title: template.name });
  // Load the packaged font scope BEFORE composition (Document Fonts on the CLI).
  add('file.saveAs', { path: '@doc' });
  add('file.open', { path: '@doc' });
  add('layout.documentSetup', { startPage: pageNumber, intent: 'print' });
  add('swatch.create', { name: 'OTE Green', color: { c: 70, m: 30, y: 75, k: 40 } });
  add('swatch.create', { name: 'OTE Placeholder', color: { c: 10, m: 3, y: 8, k: 0 } });
  for (const swatch of family?.swatches ?? []) add('swatch.create', { name: swatch.name, color: swatch.color });
  const styles = {
    'OTE Headline': ['Source Sans 3', 'Bold', 24, 27],
    'OTE Body': ['Source Serif 4', 'Regular', 10, 12],
    'OTE Byline': ['Source Sans 3', 'Semibold', 9, 11],
    'OTE Caption': ['Source Sans 3', 'Regular', 8, 10],
    'OTE Label': ['Source Sans 3', 'Semibold', 12, 15],
    'OTE Folio': ['Source Sans 3', 'Regular', 8, 10],
    'OTE Quote': ['Source Serif 4', 'Italic', 10, 12],
    'OTE Code': ['JetBrains Mono', 'Regular', 9, 12],
  };
  for (let level = 1; level <= 6; level++) {
    const size = { 1: 18, 2: 16, 3: 14, 4: 12, 5: 11, 6: 10 }[level];
    styles['OTE Heading ' + level] = ['Source Sans 3', 'Bold', size, size * 1.2];
  }
  // A family's house styles: {fontFamily, fontStyle, size, leading, chars?: extra character
  // attributes (tracking, fill, capitalization…), para?: paragraph attributes}.
  for (const [name, def] of Object.entries(family?.styles ?? {})) {
    styles[name] = [...mapFont(def.fontFamily, def.fontStyle), def.size, def.leading, def.chars ?? {}, def.para ?? {}];
  }
  if (fontProfile === 'original2025' && !family) {
    for (const [name, [, , size, leading]] of Object.entries(styles)) {
      if (name === 'OTE Code') continue;
      const face = name === 'OTE Headline' || name.startsWith('OTE Heading ') ? 'Bold' : name === 'OTE Quote' ? 'Italic' : name === 'OTE Byline' || name === 'OTE Label' ? 'Medium' : 'Regular';
      styles[name] = ['Helvetica Neue', face, size, leading];
    }
    styles['OTE Cover Date'] = ['Decalotype', 'Black', 24, 27];
    styles['OTE Cover Issue'] = ['Salted', 'Regular', 9, 11];
    styles['OTE Cover Hand'] = ['Salted', 'Regular', 8, 10];
  }
  for (const [name, [fontFamily, fontStyle, size, leading, chars = {}, para = {}]] of Object.entries(styles)) {
    add('style.paragraph.create', {
      name, para: { spaceAfter: name === 'OTE Body' || name === 'OTE Quote' ? 4 : 0, hyphenate: name === 'OTE Body', ...para },
      chars: { fontFamily, fontStyle, size, leading: { kind: 'points', value: leading }, ...chars },
    });
  }
  if (template.border) {
    const border = add('frame.create', { rect: [30, 30, width - 30, height - 30], content: 'unassigned' });
    add('object.stroke', { ids: [ref(border)], weight: 2, swatch: 'OTE Green' });
  }
  // The design layer: header, frame, masthead and rules from the source document, by page side.
  // An optional `over` part (items the original stacked above its photo) is placed after the slots.
  const art = family && template.art ? family.art?.[template.art === 'interior' ? (pageNumber % 2 === 0 ? 'left' : 'right') : template.art] : null;
  if (family && template.art && !art) throw new Error(`Design ${template.design} has no design layer for ${template.art}`);
  const placeArt = async (layer) => {
    const path = fontProfile === 'original2025' ? layer.original : layer.portable;
    const bytes = await loadMedia({ root: 'library', path });
    if (!bytes) throw new Error('Missing design layer: ' + path);
    const name = (await sha256Hex(bytes)).slice(0, 16) + '.designcraft';
    media.set(name, bytes);
    add('snippet.place', layer.x === undefined ? { path: '@media:' + name } : { path: '@media:' + name, x: layer.x, y: layer.y });
  };
  if (art) await placeArt(art);
  const customStyle = (slot, base) => {
    const [fontFamily, fontStyle, defaultSize, defaultLeading, chars = {}, para = null] = styles[base];
    const size = Number(slot.fontSize ?? defaultSize);
    const leading = Number(slot.leading ?? (!slot.fontSize ? defaultLeading : size * 1.15));
    if (!(size >= 4 && size <= 144 && leading >= 4 && leading <= 200)) throw new Error('Typography values exceed supported bounds');
    const name = 'OTE Slot ' + slot.id;
    const params = { name, chars: { fontFamily, fontStyle, size, leading: { kind: 'points', value: leading }, ...chars } };
    if (para && Object.keys(para).length) params.para = para;
    add('style.paragraph.create', params);
    return name;
  };
  // A slot's own captured typography ({fontFamily, fontStyle, size, leading, chars, para}) or a house style name.
  const slotStyle = (slot) => {
    if (typeof slot.style === 'string') return slot.style;
    const def = slot.style;
    styles['OTE Slot ' + slot.id] = [...mapFont(def.fontFamily, def.fontStyle), def.size, def.leading ?? def.size * 1.2, def.chars ?? {}, def.para ?? {}];
    return customStyle({ ...slot, fontSize: undefined, leading: undefined }, 'OTE Slot ' + slot.id);
  };
  for (const slot of template.slots) {
    const rect = slot.rect;
    if (rect.length !== 4 || rect.some((x) => !isNumber(x))) throw new Error(`Invalid rectangle for ${slot.id}`);
    const [x, y, right, bottom] = rect;
    if (!(x >= 0 && x < right && right <= width && y >= 0 && y < bottom && bottom <= height)) throw new Error(`Slot ${slot.id} lies outside page boundaries`);
    if (slot.enabled === false) continue;
    if (slot.side && slot.side !== (pageNumber % 2 === 0 ? 'left' : 'right')) continue;
    const role = slot.role;
    const ai = slot.articleIndex ?? 0;
    const article = 'articleIndex' in slot && ai >= 0 && ai < articles.length ? articles[ai] : null;
    if ('articleIndex' in slot && ['headline', 'body', 'byline', 'photo', 'caption'].includes(role) && article === null && template.kind !== 'cover') throw new Error(`Slot ${slot.id} has no matching article`);
    if (['headline', 'body', 'byline', 'caption', 'folio'].includes(role)) {
      if (isCover && (slot.id === 'cover-line' || slot.id === 'cover-caption') && !slot.text) continue;
      let text, style;
      if (role === 'headline') { text = article ? article.title : String(slot.text || 'ILLUSTRATIVE COVER TITLE'); style = 'OTE Headline'; }
      else if (role === 'body') {
        bodyCounts[ai] = (bodyCounts[ai] ?? 0) + 1;
        text = article ? (continuationIds.has(article.id) || bodyFlows[ai][0] !== slot.id ? '' : composed[article.id].text) : String(slot.text || 'ILLUSTRATIVE COPY');
        style = 'OTE Body';
      } else if (role === 'byline') { text = article ? String(article.author || 'Author not provided') : String(slot.text || 'ILLUSTRATIVE BYLINE'); style = 'OTE Byline'; }
      else if (role === 'caption') {
        const pi = slot.photoIndex ?? 0;
        const photos = article ? article.photos ?? [] : [];
        text = pi < photos.length ? String(photos[pi].caption || 'Caption not provided') : String(slot.text || 'Illustrative photo caption');
        style = 'OTE Caption';
      } else {
        const info = issue ? issue.issue ?? {} : {};
        text = `  |  ${info.title || 'OVER THE EDGE'}  |  ${info.date || 'ILLUSTRATIVE TEMPLATE'}`;
        style = 'OTE Folio';
      }
      if (family && slot.style) style = typeof slot.style === 'string' ? slot.style : style;
      if (isCover && fontProfile === 'original2025' && !family) {
        style = { 'cover-date': 'OTE Cover Date', 'cover-year': 'OTE Cover Date', 'cover-issue': 'OTE Cover Issue', 'cover-line': 'OTE Cover Hand' }[slot.id] ?? style;
      }
      if (slot.fontSize || slot.leading) style = customStyle(slot, style);
      styledText(rect, text, style, slot.columns ?? 1, slot, article,
        role === 'body' && article && !continuationIds.has(article.id) && bodyFlows[ai][0] === slot.id ? composed[article.id] : null);
    } else if (['photo', 'ad', 'piece'].includes(role)) {
      if (isCover && slot.id.startsWith('cover-card-') && slot.text === '' && !slot.fields) continue;
      let mediaRecord = null, root = issue ? 'issue' : 'library';
      if (slot.asset) { mediaRecord = { path: slot.asset }; root = slot.assetRoot === 'issue' ? 'issue' : 'library'; }
      else if (role === 'photo' && article) {
        const pi = slot.photoIndex ?? photoCounts[ai] ?? 0;
        photoCounts[ai] = pi + 1;
        const photos = article.photos ?? [];
        if (pi < photos.length) mediaRecord = photos[pi];
      } else if (issue) mediaRecord = issue.layoutPlan?.media?.[slot.id] ?? null;
      if (mediaRecord && mediaRecord.path) {
        const suffix = suffixOf(mediaRecord.path);
        if (!MEDIA_SUFFIXES.includes(suffix)) throw new Error('Unsupported media format: ' + suffix);
        const bytes = await loadMedia({ root, path: mediaRecord.path });
        if (!bytes) throw new Error(`Missing image file: ${mediaRecord.path}`);
        const name = (await sha256Hex(bytes)).slice(0, 16) + suffix;
        media.set(name, bytes);
        const index = add('frame.create', { rect, content: 'graphic' });
        const placed = add('file.place', { path: '@media:' + name, frame: ref(index) });
        add('links.embed', { asset: ref(placed, 'asset') });
        // A photo's own focal point and zoom (set once, like a WordPress focal point) follow it into every
        // layout; a slot's explicit focus or zoom still wins.
        const focus = slot.focus ?? (slot.asset ? undefined : mediaRecord.focus), zoom = slot.zoom ?? (slot.asset ? undefined : mediaRecord.zoom);
        const fitting = slot.fit ?? (role === 'photo' && (!slot.asset || focus !== undefined && focus !== null) ? 'cover' : 'contain');
        if (fitting !== 'cover' && fitting !== 'contain') throw new Error('Image fit must be cover or contain');
        add('object.fittingOptions', { ids: [ref(index)], fitting: fitting === 'cover' ? 'fillProportionally' : 'fitProportionally', autoFit: true, align: 4 });
        if (slot.stroke) add('object.stroke', { ids: [ref(index)], weight: slot.stroke.weight, swatch: slot.stroke.swatch });
        if (fitting === 'cover') focusRequests.push({ slotId: slot.id, requestedFocus: focus ?? { x: 0.5, y: 0.5 }, ...(zoom ? { requestedZoom: zoom } : {}), nativeCrop: 'pending', exactFocusApplied: false });
        labelFrame(index, slot, article);
      } else {
        if (issue && role === 'photo' && article) missingMedia.push(slot.id);
        const index = add('frame.create', { rect, content: 'unassigned' });
        add('object.fill', { ids: [ref(index)], swatch: 'OTE Placeholder' });
        add('object.stroke', { ids: [ref(index)], weight: 0.5, swatch: 'OTE Green' });
        labelFrame(index, slot, article);
        let caption = String(slot.text || { photo: 'ILLUSTRATIVE PHOTO SLOT', ad: 'ADVERTISING BOUNDARY', piece: 'CUSTOM BLOCK BOUNDARY' }[role]);
        const fields = { ...(slot.fields ?? {}) };
        if (issue && role === 'piece') Object.assign(fields, issue.layoutPlan?.blocks?.[slot.id]?.fields ?? {});
        const keys = Object.keys(fields);
        if (keys.length) caption += '\n\n' + keys.map((key) => titleCase(String(key).replaceAll('_', ' ')) + ': ' + pyStr(fields[key])).join('\n\n');
        const h = keys.length || role === 'piece' ? bottom - y - 8 : Math.min(36, bottom - y - 8);
        const labelStyle = slot.fontSize || slot.leading ? customStyle({ ...slot, leading: slot.leading ?? styles['OTE Label'][3] }, 'OTE Label') : 'OTE Label';
        styledText([x + 4, y + 4, right - 4, y + 4 + h], caption, labelStyle, 1, slot, article);
        warnings.push(`${slot.id}: no media supplied; boundary placeholder drawn`);
      }
    } else if (role === 'text' && family) {
      // Fixed or field text in captured original typography (datelines, cover dates, feature cards).
      if (!slot.text) continue;
      styledText(rect, String(slot.text), slotStyle(slot), slot.columns ?? 1, slot, article);
    } else throw new Error('Unsupported slot role: ' + role);
  }
  if (art?.over) await placeArt(art.over);
  for (let i = 0; i < storyCount; i++) if (bodyCounts[i] !== bodyFlows[i].length) throw new Error('Article body frames differ from the declared reading sequence');
  const preflightIndex = add('preflight.run', { minPpi: 150 });
  const inspectIndex = add('document.inspect');
  add('file.saveAs', { path: '@doc' });
  return {
    steps, template, articles, composed, slotRefs, warnings, missingMedia, focusRequests, media, bodyFlows,
    preflightIndex, inspectIndex, pageId, pageNumber, fontProfile, isCover, issue,
    continuationIds: [...continuationIds], stagedFlowIds: [...stagedFlowIds],
  };
}

/** Patch only graphic transforms; keep every embedded asset payload byte-identical. */
async function applyFocalCrops(nativeBytes, focusRequests, slots, JSZip) {
  const slotIndex = new Map(slots.map((slot) => [slot.id, slot]));
  const { document, entries } = await readNative(nativeBytes, JSZip);
  const items = new Map(document.spreads.flatMap((spread) => spread.items).filter((item) => item.name).map((item) => [item.name, item]));
  for (const request of focusRequests) {
    const focus = request.requestedFocus;
    if (!focus || typeof focus !== 'object' || Array.isArray(focus)) throw new Error('Photo focus must be {x: 0..1, y: 0..1}');
    const fx = focus.x ?? 0.5, fy = focus.y ?? 0.5;
    if ([fx, fy].some((v) => !isNumber(v) || v < 0 || v > 1)) throw new Error('Photo focal coordinates must be finite fractions from 0 to 1');
    const slot = slotIndex.get(request.slotId), item = items.get(slot.id);
    if (!deepEqual(item.xf, IDENTITY) || item.content.type !== 'graphic') throw new Error('Focal crop requires an untransformed rectangular graphic frame');
    const graphic = item.content;
    const [iw, ih] = graphic.size;
    if (!(iw > 0) || !(ih > 0)) throw new Error('Photo has invalid native dimensions');
    const [x, y, right, bottom] = slot.rect;
    const fw = right - x, fh = bottom - y;
    const zoom = request.requestedZoom ?? 1;
    if (!isNumber(zoom) || zoom < 1 || zoom > 8) throw new Error('Photo zoom must be from 1 to 8');
    const scale = Math.max(fw / iw, fh / ih) * zoom;
    const tx = Math.max(fw - iw * scale, Math.min(0, fw / 2 - fx * iw * scale));
    const ty = Math.max(fh - ih * scale, Math.min(0, fh / 2 - fy * ih * scale));
    const transform = [scale, 0, 0, scale, x + tx, y + ty];
    graphic.xf = transform;
    graphic.autoFit = 'none';
    graphic.crop = [0, 0, 0, 0];
    Object.assign(request, { nativeCrop: 'focal-point', exactFocusApplied: true, imageSize: [iw, ih], frameRect: slot.rect, transform });
  }
  const bytes = await writeNative(entries, document, JSZip);
  const hashes = {};
  for (const [name, payload] of entries) if (name.startsWith('assets/')) hashes[name] = await sha256Hex(payload);
  return { bytes, hashes };
}

const textOf = (bytes) => new TextDecoder().decode(bytes);

/** Join explicitly ordered body regions, preserving source rich text and asset bytes. */
async function threadPageBodyRegions(native, built, JSZip) {
  if (!Object.values(built.bodyFlows).some((ids) => ids.length > 1)) return native;
  const { document, entries } = await readNative(native, JSZip);
  const items = new Map(document.spreads.flatMap((spread) => spread.items).filter((item) => item.name).map((item) => [item.name, item]));
  for (const ids of Object.values(built.bodyFlows)) {
    if (ids.length < 2) continue;
    const frames = ids.map((id) => items.get(id));
    if (frames.some((frame) => frame?.content?.type !== 'text')) throw new Error('Missing declared body-region frame');
    const sid = frames[0].content.story, first = document.stories[String(sid)], original = clone(first);
    if (!deepEqual(first.frames, [frames[0].id])) throw new Error('Body opening frame has an undeclared thread');
    for (const frame of frames.slice(1)) {
      const otherId = frame.content.story, other = document.stories[String(otherId)];
      if (otherId === sid || !other || other.text !== '' || !deepEqual(other.frames, [frame.id])) throw new Error('Additional body regions must start as empty independent frames');
      if (['anchors', 'xrefs', 'notes', 'tables', 'objects', 'indexRefs'].some((key) => other[key]?.length) || (document.hyperlinks ?? []).some((link) => link.source?.story === otherId)) throw new Error('Additional body region contains unexpected source content');
      delete document.stories[String(otherId)];frame.content.story = sid;
    }
    first.frames = frames.map((frame) => frame.id);
    if (!deepEqual(first, {...original, frames: first.frames})) throw new Error('Body-region threading changed source rich text');
  }
  return writeNative(entries, document, JSZip);
}

/**
 * Run a built page through an executor and apply every compile-template.py check.
 * Returns {manifest, artifacts}; throws CompileError (with draft artifacts) on
 * preflight/input errors. artifacts: native, pdf?, idml?, preflight, manifest,
 * inspect, sourceRecord, composedRecord, interchange, focalCrop?
 */
export async function compilePage(built, { executor, fonts, JSZip }) {
  const docFonts = documentFonts(fonts, built.fontProfile, Boolean(built.template.design));
  const session = { fonts: docFonts, media: built.media };
  const first = await executor.run(built.steps, session);
  const results = first.results;
  let native = first.doc;
  let cropHashes = {};
  native = await threadPageBodyRegions(native, built, JSZip);
  if (built.focusRequests.length) ({ bytes: native, hashes: cropHashes } = await applyFocalCrops(native, built.focusRequests, built.template.slots, JSZip));
  const reopened = await executor.run([
    { command: 'file.open', params: { path: '@doc' } },
    { command: 'preflight.run', params: { minPpi: 150 } },
    { command: 'document.inspect', params: {} },
    { command: 'file.saveAs', params: { path: '@doc' } },
  ], { ...session, doc: native });
  native = reopened.doc;
  results[built.preflightIndex] = reopened.results[1];
  results[built.inspectIndex] = reopened.results[2];
  const { document, entries } = await readNative(native, JSZip);
  for (const [name, expected] of Object.entries(cropHashes)) {
    if (await sha256Hex(entries.get(name)) !== expected) throw new Error('Reopening focal crop changed an embedded asset payload');
  }
  const artifacts = {};
  if (built.focusRequests.length) {
    const items = new Map(document.spreads.flatMap((spread) => spread.items).filter((item) => item.name).map((item) => [item.name, item]));
    for (const crop of built.focusRequests) {
      const graphic = items.get(crop.slotId).content;
      if (graphic.autoFit !== 'none' || graphic.xf.some((v, i) => Math.abs(v - crop.transform[i]) > 1e-9)) throw new Error('Native focal transform changed during reopening');
    }
    artifacts.focalCrop = { crops: built.focusRequests, embeddedAssetSha256: cropHashes, preservedAssetBytes: true };
  }
  const bodyRefs = new Map();
  for (const ref of built.slotRefs.filter((x) => x.role === 'body' && x.flowOrder === 0)) bodyRefs.set(ref.articleId, ref);
  for (const article of built.isCover ? [] : built.articles) {
    const storyId = results[bodyRefs.get(article.id).commandIndex].story;
    const expected = built.continuationIds.includes(article.id) ? '' : built.composed[article.id].text;
    if (document.stories[String(storyId)].text !== expected) throw new Error('Native document failed composed-copy check for article ' + article.id);
  }
  const preflight = results[built.preflightIndex];
  artifacts.inspect = results[built.inspectIndex];
  let errors = preflight.issues.filter((x) => x.severity === 'error');
  let deferred = [];
  if (built.stagedFlowIds.length) {
    const allowed = new Set(built.slotRefs.filter((x) => x.role === 'body' && built.stagedFlowIds.includes(x.articleId)).map((x) => results[x.commandIndex].id));
    deferred = errors.filter((x) => x.kind === 'overset' && allowed.has(x.item));
    errors = errors.filter((x) => !deferred.includes(x));
  }
  for (const slotId of built.missingMedia) errors.push({ kind: 'missing-input-photo', severity: 'error', message: 'Photo slot has no local photo: ' + slotId });
  preflight.issues.push(...errors.slice(preflight.issues.filter((x) => x.severity === 'error').length));
  preflight.errors = errors.length;
  artifacts.preflight = preflight;
  const manifest = {
    schemaVersion: 'ote.designcraft.build.v1', templateId: built.template.id,
    cliVersion: executor.version, documentFontSha256: await fontScope(docFonts),
    sourceArticleIds: built.articles.map((a) => a.id), illustrative: built.issue === null || Boolean(built.issue.illustrative ?? false),
    pageId: built.pageId, pageNumber: built.pageNumber, slots: built.slotRefs,
    copyPreserved: true, copyScope: built.isCover ? 'source-record-article-bodies' : 'native-article-bodies',
    sourceMarkdownPreserved: true, nativeTextScope: 'rendered-commonmark-or-plain',
    articleBodiesInNative: !built.isCover, focalPointRequests: built.focusRequests,
    fontProfile: built.fontProfile,
    fonts: built.fontProfile === 'original2025' ? ['Helvetica Neue', 'Decalotype', 'Salted'] : ['Source Sans 3', 'Source Serif 4'],
    status: errors.length ? 'needs-layout-adjustment' : 'exported', errors, warnings: built.warnings,
    nativeWarnings: preflight.issues.filter((x) => x.severity === 'warning'),
    originalCoverAndTruck: 'Requires original native issue; not modified by this single-page compiler',
    adobeInDesignTested: false,
  };
  artifacts.sourceRecord = { issue: built.issue ? built.issue.issue ?? null : null, articles: built.articles };
  manifest.sourceRecordSha256 = await sha256Hex(new TextEncoder().encode(JSON.stringify(artifacts.sourceRecord)));
  manifest.templateSha256 = await sha256Hex(new TextEncoder().encode(JSON.stringify(built.template)));
  manifest.sourceMediaSha256 = Object.fromEntries(await Promise.all([...built.media].map(async ([name, bytes]) => [name, await sha256Hex(bytes)])));
  manifest.nativeDocumentSha256 = await sha256Hex(native);
  artifacts.composedRecord = built.composed;
  artifacts.interchange = interchangeMetadata(document);
  manifest.interchangeHyperlinks = { nativeAndPdf: true, stockIdml: false, sidecarCount: artifacts.interchange.hyperlinks.length, reopenTool: 'reopen-idml.py' };
  artifacts.native = native;
  artifacts.manifest = manifest;
  if (errors.length) {
    throw new CompileError(`${errors.length} preflight/input errors. Full copy retained in page.designcraft; final PDF/IDML export blocked. See preflight.json and build-manifest.json.`, artifacts);
  }
  if (built.stagedFlowIds.length) {
    manifest.status = 'staged-flow';
    manifest.deferredBodyOverset = deferred;
    return { manifest, artifacts };
  }
  const exported = await executor.run([
    { command: 'file.open', params: { path: '@doc' } },
    { command: 'file.exportPdf', params: { path: '@out:page.pdf', standard: 'x4' } },
    { command: 'file.exportIdml', params: { path: '@out:page.idml' } },
  ], { ...session, doc: native });
  artifacts.pdf = exported.outputs['page.pdf'];
  artifacts.idml = exported.outputs['page.idml'];
  return { manifest, artifacts };
}

/** JSON text the way Python's json.dumps(ensure_ascii=False) writes labels. */
export function pythonJson(value) {
  if (value === null || value === undefined) return 'null';
  if (typeof value === 'string') return JSON.stringify(value);
  if (typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return '[' + value.map(pythonJson).join(', ') + ']';
  return '{' + Object.entries(value).map(([k, v]) => JSON.stringify(k) + ': ' + pythonJson(v)).join(', ') + '}';
}

export { clone, textOf };
