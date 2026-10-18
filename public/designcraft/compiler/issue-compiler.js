// Compose a validated page plan into one editable DesignCraft issue.
// Port of tools/designcraft/compile-issue.py (plus native_flow.py and
// native_references.py) for new issues. Rebuilding protected pages against an
// existing native base stays with the server compiler, which holds that base.
import { composeSource, utf8Length } from './markdown-story.js';
import { CompileError, ISSUE_SCHEMA, buildPage, compilePage, documentFonts, fontScope } from './page-compiler.js';
import { clone, deepEqual, interchangeMetadata, readNative, sha256Hex, storyIds, textFrames, walkItems, writeNative } from './native-doc.js';

const ANCHOR_MARK = '';
const XREF_MARK = '';
const FORMAT_NAME = 'OTE Featured Article';
const FORMAT_DEFINITION = '<pageNum /> · <fullPara />';

// ---- Python-compatible canonical JSON, for the style-namespace digest ----
// json.dumps(styles, sort_keys=True, separators=(',', ':')) over the values
// Python parsed, so integers and floats keep their source spelling.
function parseKeepingNumbers(text) {
  let i = 0;
  const ws = () => { while (' \t\n\r'.includes(text[i])) i++; };
  const value = () => {
    ws();
    const c = text[i];
    if (c === '{') {
      i++; const out = {}; ws();
      if (text[i] === '}') { i++; return out; }
      for (;;) { ws(); const key = value(); ws(); i++; out[key] = value(); ws(); if (text[i++] === '}') return out; }
    }
    if (c === '[') {
      i++; const out = []; ws();
      if (text[i] === ']') { i++; return out; }
      for (;;) { out.push(value()); ws(); if (text[i++] === ']') return out; }
    }
    if (c === '"') {
      let j = i + 1;
      while (text[j] !== '"') j += text[j] === '\\' ? 2 : 1;
      const s = JSON.parse(text.slice(i, j + 1)); i = j + 1; return s;
    }
    const m = /^-?\d+(\.\d+)?([eE][+-]?\d+)?|^true|^false|^null/.exec(text.slice(i, i + 64));
    i += m[0].length;
    if (m[0] === 'true') return true;
    if (m[0] === 'false') return false;
    if (m[0] === 'null') return null;
    return { __number: m[0] };
  };
  return value();
}

function pyFloatRepr(n) {
  if (!Number.isFinite(n)) return n > 0 ? 'Infinity' : n < 0 ? '-Infinity' : 'NaN';
  if (n === 0) return Object.is(n, -0) ? '-0.0' : '0.0';
  const [mantissa, exp] = n.toExponential().split('e');
  const e = Number(exp), digits = mantissa.replace('-', '').replace('.', '');
  const sign = n < 0 ? '-' : '';
  if (e < -4 || e >= 16) return sign + digits[0] + (digits.length > 1 ? '.' + digits.slice(1) : '') + 'e' + (e < 0 ? '-' : '+') + String(Math.abs(e)).padStart(2, '0');
  if (e < 0) return sign + '0.' + '0'.repeat(-e - 1) + digits;
  const whole = digits.slice(0, e + 1).padEnd(e + 1, '0'), frac = digits.slice(e + 1);
  return sign + whole + '.' + (frac || '0');
}

function pyCanonical(value) {
  if (value && typeof value === 'object' && '__number' in value) {
    const raw = value.__number;
    return /[.eE]/.test(raw) ? pyFloatRepr(Number(raw)) : String(BigInt(raw));
  }
  if (Array.isArray(value)) return '[' + value.map(pyCanonical).join(',') + ']';
  if (value && typeof value === 'object') {
    const keys = Object.keys(value).sort((a, b) => { const x = [...a], y = [...b]; for (let k = 0; k < Math.min(x.length, y.length); k++) { const d = x[k].codePointAt(0) - y[k].codePointAt(0); if (d) return d; } return x.length - y.length; });
    return '{' + keys.map((k) => JSON.stringify(k) + ':' + pyCanonical(value[k])).join(',') + '}';
  }
  return JSON.stringify(value);
}

/** Prefix every user style so placed pages cannot inherit another page's typography. */
async function namespaceStyles(nativeBytes, prefix, JSZip) {
  const { document, entries } = await readNative(nativeBytes, JSZip);
  const raw = parseKeepingNumbers(new TextDecoder().decode(entries.get('document.json')));
  const digest = (await sha256Hex(new TextEncoder().encode(pyCanonical(raw.styles)))).slice(0, 16);
  prefix = prefix + '/' + digest;
  const names = new Map();
  for (const kind of ['paragraph', 'character', 'object', 'cell', 'table']) {
    for (const style of document.styles[kind] ?? []) if (!style.name.startsWith('[')) names.set(style.name, prefix + '/' + style.name);
  }
  const keys = new Set(['name', 'style', 'basedOn', 'nextStyle', 'objectStyle', 'paragraphStyle', 'characterStyle']);
  const rename = (value) => {
    if (Array.isArray(value)) return value.map(rename);
    if (value && typeof value === 'object') {
      return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, typeof v === 'string' && keys.has(k) ? names.get(v) ?? v : rename(v)]));
    }
    return value;
  };
  return writeNative(entries, rename(document), JSZip);
}

async function restorePageHyperlinks(issueBytes, prepared, JSZip) {
  const { document: d, entries } = await readNative(issueBytes, JSZip);
  const labelled = new Map();
  for (const sp of d.spreads) for (const i of walkItems(sp.items)) if (i.label) labelled.set(i.label, i);
  let restored = 0;
  for (const source of prepared) {
    if (!source) continue;
    const { document: src } = await readNative(source, JSZip);
    const frames = new Map();
    for (const sp of src.spreads) for (const i of walkItems(sp.items)) if (i.content?.type === 'text') frames.set(i.content.story, i);
    for (const link of src.hyperlinks ?? []) {
      if (link.source.kind !== 'text') throw new Error('Unsupported page hyperlink source; export refused');
      const sid = link.source.story, frame = frames.get(sid);
      const target = labelled.get(frame.label);
      if (!target) throw new Error('Cannot rebind hyperlink without its stable native label');
      const targetSid = target.content.story;
      if (d.stories[String(targetSid)].text !== src.stories[String(sid)].text) throw new Error('Hyperlink story text changed during placement');
      const record = clone(link);
      record.id = d.nextId++;
      record.source.story = targetSid;
      (d.hyperlinks ??= []).push(record);
      restored++;
    }
  }
  return { bytes: await writeNative(entries, d, JSZip), restored };
}

/** Join {articleId: {pageIds}} through the unique labelled body frames (native_flow.py). */
async function threadArticleStories(issueBytes, flows, JSZip) {
  if (!flows || !Object.keys(flows).length) return { bytes: issueBytes, manifest: {} };
  const { document, entries } = await readNative(issueBytes, JSZip);
  const frames = textFrames(document);
  const used = new Set(), requests = [];
  for (const [aid, flow] of Object.entries(flows)) {
    const pages = flow?.pageIds;
    if (!Array.isArray(pages) || pages.length < 2 || pages.some((p) => typeof p !== 'string' || !p)) throw new Error('A continuation needs at least two ordered stable page IDs');
    if (new Set(pages).size !== pages.length) throw new Error('An article flow cannot repeat a page or form a cycle');
    const chain = pages.map((pid) => {
      const matches = frames.filter((f) => f.label.role === 'body' && f.label.articleId === aid && f.label.pageId === pid);
      if (matches.length !== 1) throw new Error('Missing or ambiguous body frame for article ' + aid + ' on page ' + pid);
      const frame = matches[0];
      if (frame.pageIndex === null) throw new Error('Continuation frame has no unique physical page');
      if (used.has(frame.item.id)) throw new Error('Continuation frames cannot occur in multiple chains');
      used.add(frame.item.id);
      return frame;
    });
    const sid = chain[0].item.content.story;
    const first = document.stories[String(sid)];
    if (!first?.text) throw new Error('The first continuation frame needs its complete source story');
    requests.push({ aid, pages, chain, sid, original: clone(first), expected: chain.map((f) => f.item.id) });
  }
  const manifest = {};
  for (const { aid, pages, chain, sid, original, expected } of requests) {
    const first = document.stories[String(sid)];
    let unchanged = deepEqual(first.frames, expected) && chain.every((f) => f.item.content.story === sid);
    if (!unchanged) {
      if (!deepEqual(first.frames, [expected[0]])) throw new Error('The source story already has an undeclared thread');
      for (const frame of chain.slice(1)) {
        const otherSid = frame.item.content.story, other = document.stories[String(otherSid)];
        if (otherSid === sid || !other || other.text !== '' || !deepEqual(other.frames, [frame.item.id])) throw new Error('Continuation stories must be empty independent frames');
        if ((document.hyperlinks ?? []).some((l) => l.source?.story === otherSid)) throw new Error('An empty continuation story unexpectedly owns hyperlinks');
        if (['anchors', 'xrefs', 'notes', 'tables', 'objects', 'indexRefs'].some((k) => other[k]?.length)) throw new Error('An empty continuation story owns unsupported content');
        delete document.stories[String(otherSid)];
        frame.item.content.story = sid;
      }
      first.frames = expected;
    }
    if (!deepEqual(first, { ...original, frames: expected })) throw new Error('Threading changed source copy or rich story metadata');
    manifest[aid] = { storyId: sid, frameIds: expected, pageIds: pages, physicalPageNumbers: chain.map((f) => f.pageIndex + 1), sourceTextUnchanged: true, richStoryUnchanged: true, alreadyThreaded: unchanged };
  }
  const bytes = await writeNative(entries, document, JSZip);
  const saved = (await readNative(bytes, JSZip)).document;
  for (const record of Object.values(manifest)) if (!deepEqual(saved.stories[String(record.storyId)].frames, record.frameIds)) throw new Error('Saved native article thread differs from its declared chain');
  return { bytes, manifest };
}

// ---- Cover cross-references (native_references.py, unprotected covers) ----
const anchorName = (aid) => 'ote:article:' + aid + ':headline';
const titleOf = (story) => story.text.replaceAll(ANCHOR_MARK, '');

function singleParagraphTitle(title) {
  if (typeof title !== 'string' || !title.trim()) throw new Error('A featured article needs a nonempty headline');
  if (title.includes('\n') || title.includes('\r')) throw new Error('A featured headline needs one paragraph; use frame wrapping for visual line breaks');
}

function findOne(frames, aid, role, cover = false) {
  let found = frames.filter((f) => f.label.articleId === aid && f.label.role === role && (!cover || String(f.label.slotId ?? '').startsWith('cover-card-')));
  if (role === 'headline' && found.length > 1) {
    if (found.some((f) => f.pageIndex === null)) throw new Error('A featured headline has no unique physical page: ' + aid);
    const firstPage = Math.min(...found.map((f) => f.pageIndex));
    found = found.filter((f) => f.pageIndex === firstPage);
  }
  if (found.length !== 1) throw new Error('Missing or ambiguous ' + (cover ? 'cover reference' : role) + ' frame for ' + aid);
  return found[0];
}

function generatedText(page, title) {
  let previous = ' ', output = '';
  for (const ch of String(page) + ' · ' + title) {
    output += ch === '"' ? (/\s/.test(previous) || '(['.includes(previous) ? '“' : '”') : ch;
    previous = ch;
  }
  return output;
}

const anchorsIn = (document, name = null) => Object.entries(document.stories).flatMap(([sid, story]) => (story.anchors ?? []).filter((a) => name === null || a.name === name).map((a) => [Number(sid), a]));
const bodySnapshot = (document) => Object.fromEntries(textFrames(document).filter((f) => f.label.role === 'body').map((f) => [String(f.item.content.story), clone(document.stories[String(f.item.content.story)])]));

async function attachCoverReferences(issueBytes, featured, articles, ctx) {
  const manifest = { schemaVersion: 'ote.native.cover-references.v1', format: FORMAT_NAME, features: [], staticFallbacks: [] };
  if (featured.length > 3 || new Set(featured).size !== featured.length || featured.some((aid) => !articles.has(aid))) throw new Error('Choose up to three distinct known featured articles');
  if (!featured.length) return { bytes: issueBytes, manifest };
  const { document: original, entries: originalEntries } = await readNative(issueBytes, ctx.JSZip);
  const frames = textFrames(original);
  const plans = featured.map((aid) => {
    singleParagraphTitle(articles.get(aid).title);
    const headline = findOne(frames, aid, 'headline'), card = findOne(frames, aid, 'piece', true);
    const hsid = headline.item.content.story, csid = card.item.content.story;
    if (headline.pageIndex === null || card.pageIndex !== 0) throw new Error('Featured headline must be on a located page and its card on the front cover');
    if (titleOf(original.stories[String(hsid)]) !== articles.get(aid).title) throw new Error('Featured headline does not match its source article: ' + aid);
    const name = anchorName(aid), named = anchorsIn(original, name);
    if (named.length > 1) throw new Error('Featured article anchor name is ambiguous: ' + aid);
    if (named.length && named[0][0] !== hsid) throw new Error('Featured article anchor belongs to a different headline story');
    return {
      articleId: aid, headlineStoryId: hsid, coverStoryId: csid, headlinePageId: headline.label.pageId ?? null,
      headlinePageIndex: headline.pageIndex, coverPageId: card.label.pageId ?? null, anchorName: name,
      title: articles.get(aid).title, mode: 'dynamic', anchorId: named.length ? named[0][1].id : null, createAnchor: !named.length,
    };
  });
  const bodies = bodySnapshot(original);
  let staged = issueBytes;
  const steps = [{ command: 'file.open', params: { path: '@doc' } }], anchorSteps = [];
  for (const plan of plans) {
    if (!plan.createAnchor) continue;
    steps.push({ command: 'text.select', params: { story: plan.headlineStoryId, anchor: 0, focus: 0 } });
    anchorSteps.push([plan, steps.length]);
    steps.push({ command: 'anchor.create', params: { name: plan.anchorName } });
  }
  if (anchorSteps.length) {
    steps.push({ command: 'file.saveAs', params: { path: '@doc' } });
    const run = await ctx.executor.run(steps, { ...ctx.session, doc: staged });
    staged = run.doc;
    for (const [plan, index] of anchorSteps) plan.anchorId = run.results[index].id;
  }
  const updated = (await readNative(staged, ctx.JSZip)).document;
  const insert = [{ command: 'file.open', params: { path: '@doc' } }, { command: 'xref.defineFormat', params: { name: FORMAT_NAME, definition: FORMAT_DEFINITION } }];
  for (const plan of plans) {
    const story = updated.stories[String(plan.coverStoryId)];
    insert.push({ command: 'text.select', params: { story: plan.coverStoryId, anchor: 0, focus: utf8Length(story.text) } });
    insert.push({ command: 'xref.insert', params: { anchor: plan.anchorId, format: FORMAT_NAME } });
  }
  insert.push({ command: 'file.saveAs', params: { path: '@doc' } });
  staged = (await ctx.executor.run(insert, { ...ctx.session, doc: staged })).doc;
  const { document: final, entries: finalEntries } = await readNative(staged, ctx.JSZip);
  if (!deepEqual(bodies, bodySnapshot(final))) throw new Error('Attaching cover references changed a complete article body or its rich metadata');
  for (const [name, payload] of originalEntries) {
    if (name.startsWith('assets/') && (!finalEntries.has(name) || await sha256Hex(finalEntries.get(name)) !== await sha256Hex(payload))) throw new Error('Attaching cover references changed embedded asset bytes');
  }
  for (const plan of plans) { const { createAnchor, ...feature } = plan; manifest.features.push(feature); }
  manifest.verification = await verifyCoverReferences(staged, manifest, ctx);
  return { bytes: staged, manifest };
}

async function verifyCoverReferences(issueBytes, expected, ctx) {
  if (expected.schemaVersion !== 'ote.native.cover-references.v1') throw new Error('Unknown native cover-reference manifest');
  if (!expected.features.length) return { valid: true, features: [] };
  const { document } = await readNative(issueBytes, ctx.JSZip);
  const frames = textFrames(document);
  const run = await ctx.executor.run([
    { command: 'file.open', params: { path: '@doc' } }, { command: 'xref.list', params: {} },
    { command: 'anchor.list', params: {} }, { command: 'document.inspect', params: {} },
  ], { ...ctx.session, doc: issueBytes });
  const [references, anchors] = run.results.slice(1);
  const checks = [];
  for (const feature of expected.features) {
    const aid = feature.articleId;
    const named = anchors.filter((a) => a.name === feature.anchorName);
    if (named.length !== 1 || named[0].page === null || named[0].page === undefined) throw new Error('Native featured article anchor is missing, ambiguous or overset: ' + aid);
    const anchor = named[0];
    if (anchors.filter((c) => c.id === anchor.id).length !== 1) throw new Error('Native article anchor ID is not globally unique: ' + aid);
    const records = references.filter((r) => r.target === anchor.id && r.format === FORMAT_NAME);
    if (records.length !== 1 || !records[0].text || records[0].text === '??') throw new Error('Native cover reference is missing, ambiguous or unresolved: ' + aid);
    const destination = frames.filter((f) => f.item.content.story === anchor.story), source = frames.filter((f) => f.item.content.story === records[0].story);
    if (destination.length !== 1 || source.length !== 1 || source[0].pageIndex !== 0) throw new Error('Native reference must link one cover card to one headline frame');
    const card = document.stories[String(records[0].story)];
    if (card.text !== XREF_MARK || (card.xrefs ?? []).length !== 1) throw new Error('Native cover card must contain its isolated generated reference');
    const headline = titleOf(document.stories[String(anchor.story)]);
    singleParagraphTitle(headline);
    if (records[0].text !== generatedText(anchor.page, headline)) throw new Error('Native cover reference generated unexpected text: ' + aid);
    checks.push({ articleId: aid, mode: 'dynamic', text: records[0].text, anchorId: anchor.id, pageName: anchor.page });
  }
  return { valid: true, features: checks };
}

async function embeddedCoverHash(entries, document) {
  if (!document.spreads.length) return null;
  const ids = [];
  for (const item of walkItems(document.spreads[0].items)) {
    let label = {};
    try { label = JSON.parse(item.label || '{}'); } catch { label = {}; }
    if (label?.slotId === 'cover-photo' && item.content?.type === 'graphic') ids.push(item.content.asset);
  }
  if (ids.length !== 1) return null;
  const candidates = [...entries.keys()].filter((n) => n.startsWith('assets/' + ids[0] + '.'));
  if (candidates.length !== 1) throw new Error('Cannot identify the embedded cover image');
  return sha256Hex(entries.get(candidates[0]));
}

/**
 * Compile a whole issue. Returns {manifest, artifacts: {native, pdf, idml, preflight,
 * sourceIssue, interchange, pages}}; throws CompileError with draft artifacts.
 * options: {library, issue, booklet, allowUnplaced, fontProfile, fonts, loadMedia,
 *   executor, markdownit, JSZip, onProgress?}
 */
export async function compileIssue(options) {
  const { library, booklet = false, allowUnplaced = false, executor, markdownit, JSZip, loadMedia } = options;
  const fontProfile = options.fontProfile ?? 'portable';
  const progress = options.onProgress ?? (() => {});
  const issue = clone(options.issue);
  if (issue.schemaVersion !== ISSUE_SCHEMA) throw new Error('Unsupported issue schema');
  const plan = issue.layoutPlan ?? {};
  const coverFields = { ...Object.fromEntries(['date', 'volume', 'number', 'year'].filter((k) => k in (issue.issue ?? {})).map((k) => [k, issue.issue[k]])), ...(plan.cover ?? {}) };
  if (typeof coverFields.date === 'string' && coverFields.date.length === 10 && /^\d{4}/.test(coverFields.date)) coverFields.year = Number(coverFields.date.slice(0, 4));
  const pages = [...(plan.pages ?? [])].sort((a, b) => a.pageNumber - b.pageNumber);
  if (!pages.length || pages.length > 256) throw new Error('An issue needs 1–256 explicitly planned pages');
  if (pages.some((p, i) => p.pageNumber !== i + 1)) throw new Error('Page numbers must be consecutive, starting at 1');
  if (new Set(pages.map((p) => p.id)).size !== pages.length) throw new Error('Page IDs must be unique');
  if (pages.some((p) => typeof p.id !== 'string' || !p.id)) throw new Error('Page IDs must be nonempty strings');
  if (booklet && pages.length % 4) throw new Error('A saddle-stitched booklet needs a multiple-of-four page count');
  const templates = new Map(library.templates.map((t) => [t.id, t]));
  const articles = new Map(issue.articles.map((a) => [a.id, a]));
  if (articles.size !== issue.articles.length) throw new Error('Article IDs must be unique');
  const protectedIds = new Set(pages.filter((p) => p.mode === 'preserve').map((p) => p.id));
  if (plan.cover?.mode === 'preserve') protectedIds.add(pages[0].id);
  if (plan.truck?.mode === 'preserve') for (const id of plan.truck.pageIds ?? []) protectedIds.add(id);
  if (protectedIds.size) throw new Error('Protected pages need the server compiler with the existing native issue; generate in the browser with every page editable.');
  const placements = new Map(), references = {};
  for (const p of pages) {
    if (!templates.has(p.templateId)) throw new Error('Unknown template: ' + p.templateId);
    const t = templates.get(p.templateId);
    if (t.kind === 'cover' && p.pageNumber !== 1) throw new Error('The front cover must be page 1');
    const ids = p.articleIds ?? [];
    if (new Set(ids).size !== ids.length || ids.some((i) => !articles.has(i))) throw new Error('Invalid or repeated article assignments on page ' + p.id);
    if (t.kind !== 'cover') {
      if (ids.length !== (t.storyCount ?? 0)) throw new Error('Story assignment count does not match page ' + p.id);
      for (const aid of ids) { placements.set(aid, (placements.get(aid) ?? 0) + 1); references[aid] ??= p.pageNumber; }
    }
  }
  const flows = plan.articleFlows ?? {};
  if (typeof flows !== 'object' || Array.isArray(flows) || Object.keys(flows).some((aid) => !articles.has(aid))) throw new Error('Invalid continuation article IDs');
  for (const [aid, flow] of Object.entries(flows)) {
    const chain = flow.pageIds ?? [];
    const assigned = pages.filter((p) => (p.articleIds ?? []).includes(aid) && templates.get(p.templateId)?.kind !== 'cover').map((p) => p.id);
    if (chain.length < 2 || !deepEqual(chain, assigned) || new Set(chain).size !== chain.length) throw new Error('Continuation must list every assigned interior page exactly once in page order: ' + aid);
  }
  if (!allowUnplaced) {
    const unplaced = [...articles.keys()].filter((a) => !placements.get(a)).sort();
    if (unplaced.length) throw new Error('Each article needs an interior placement: ' + unplaced.join(', '));
  }
  if ([...placements].some(([aid, count]) => count > 1 && !(aid in flows))) throw new Error('Repeated article assignments require explicit continuation chains');

  const docFonts = documentFonts(options.fonts, fontProfile);
  const session = { fonts: docFonts, media: new Map() };
  const prepared = [], pageResults = [], pageArtifacts = [];
  for (const p of pages) {
    progress({ stage: 'page', pageNumber: p.pageNumber, total: pages.length });
    const t = templates.get(p.templateId);
    const pageIssue = { ...clone(issue), articles: clone((p.articleIds ?? []).map((i) => articles.get(i))) };
    try {
      const built = await buildPage({
        library: { ...library, templates: [t] }, template: t, issue: t.kind === 'cover' ? { ...pageIssue, articles: clone(issue.articles) } : pageIssue,
        articleIds: p.articleIds ?? [], pageId: p.id, pageNumber: p.pageNumber, fontProfile, references,
        stagedFlowIds: (p.articleIds ?? []).filter((aid) => aid in flows),
        continuationArticleIds: (p.articleIds ?? []).filter((aid) => aid in flows && flows[aid].pageIds[0] !== p.id),
        markdownit, loadMedia,
      });
      const { manifest, artifacts } = await compilePage(built, { executor, fonts: options.fonts, JSZip });
      pageResults.push(manifest);
      pageArtifacts.push({ pageNumber: p.pageNumber, pageId: p.id, artifacts });
      prepared.push(await namespaceStyles(artifacts.native, p.id, JSZip));
    } catch (error) {
      const failed = error.artifacts?.preflight ? clone(error.artifacts.preflight) : { errors: 1, warnings: 0, issues: [] };
      failed.issues = failed.issues.map((record) => ({ ...record, pageNumber: p.pageNumber, pageId: p.id }));
      if (!failed.errors || !failed.issues.length) {
        failed.errors = Math.max(1, failed.errors ?? 0);
        failed.issues.push({ kind: 'page-compilation-failed', severity: 'error', pageNumber: p.pageNumber, pageId: p.id, message: error.message });
      }
      throw new CompileError(`Page ${p.pageNumber} (${p.id}) failed composition; source, page draft and preflight retained: ${error.message}`, {
        native: error.artifacts?.native, draftName: `draft-page-${String(p.pageNumber).padStart(3, '0')}.designcraft`,
        preflight: failed, sourceIssue: issue,
        manifest: { schemaVersion: 'ote.designcraft.issue-build.v1', status: 'needs-layout-adjustment', failedPageNumber: p.pageNumber, failedPageId: p.id, sourceMarkdownPreserved: true, articleBodiesInNative: false, pageBuilds: pageResults, preflight: failed, message: error.message },
        pages: pageArtifacts,
      });
    }
  }
  progress({ stage: 'assemble' });
  const init = await executor.run([
    { command: 'file.new', params: { width: library.page.width, height: library.page.height, pages: pages.length, facingPages: true, title: issue.issue?.title || 'Over the Edge' } },
    { command: 'layout.section', params: { page: 1, style: 'arabicLeadingZero' } },
    { command: 'file.saveAs', params: { path: '@doc' } },
    { command: 'file.open', params: { path: '@doc' } },
    { command: 'file.saveAs', params: { path: '@doc' } },
  ], session);
  const locations = (await readNative(init.doc, JSZip)).document.spreads.flatMap((spread, si) => spread.pages.map((page) => [si, page]));
  const assemble = [{ command: 'file.open', params: { path: '@doc' } }];
  const pageMedia = new Map();
  prepared.forEach((bytes, n) => {
    const [si, page] = locations[n];
    const name = `page-${String(n + 1).padStart(3, '0')}.designcraft`;
    pageMedia.set(name, bytes);
    assemble.push({ command: 'file.place', params: { path: '@media:' + name, layoutPage: 1, spread: si, x: page.x, y: 0 } });
  });
  assemble.push({ command: 'file.saveAs', params: { path: '@doc' } });
  let native = (await executor.run(assemble, { ...session, media: pageMedia, doc: init.doc })).doc;
  const coverPage = pages.find((p) => templates.get(p.templateId)?.kind === 'cover');
  const featured = plan.cover?.articleIds ?? coverPage?.articleIds ?? [];
  if (coverPage && !deepEqual(featured, coverPage.articleIds ?? [])) throw new Error('Cover feature IDs disagree with the saved cover page');
  const links = await restorePageHyperlinks(native, prepared, JSZip);
  native = links.bytes;
  const threaded = await threadArticleStories(native, flows, JSZip);
  native = threaded.bytes;
  progress({ stage: 'references' });
  const ctx = { executor, session, JSZip };
  const referenced = await attachCoverReferences(native, featured, articles, ctx);
  native = referenced.bytes;
  progress({ stage: 'preflight' });
  const checked = await executor.run([
    { command: 'file.open', params: { path: '@doc' } }, { command: 'preflight.run', params: { minPpi: 150 } },
    { command: 'xref.list', params: {} }, { command: 'anchor.list', params: {} }, { command: 'document.inspect', params: {} },
  ], { ...session, doc: native });
  const [preflight, nativeXrefs, nativeAnchors] = checked.results.slice(-4);
  for (const reference of nativeXrefs) {
    const targets = nativeAnchors.filter((a) => a.id === reference.target);
    if (reference.text === '??' || targets.length !== 1 || targets[0].page === null || targets[0].page === undefined) {
      preflight.issues.push({ kind: 'unresolved-reference', severity: 'error', story: reference.story, message: 'Native cross-reference destination is missing, ambiguous or outside composed text' });
      preflight.errors += 1;
    }
  }
  const { document, entries } = await readNative(native, JSZip);
  const texts = new Map();
  for (const s of Object.values(document.stories)) texts.set(s.text, (texts.get(s.text) ?? 0) + 1);
  const bodyCopy = {};
  for (const [aid, count] of placements) {
    const a = articles.get(aid);
    const expected = composeSource(a.body, a.bodyFormat ?? 'markdown', markdownit).text;
    bodyCopy[aid] = (texts.get(expected) ?? 0) >= (aid in flows ? 1 : count);
  }
  if (!Object.values(bodyCopy).every(Boolean)) throw new Error('Issue assembly lost a composed article body');
  const physical = document.spreads.flatMap((spread) => spread.pages);
  pages.forEach((p, index) => { p.nativePageId = physical[index].id; });
  const sourceIssueText = JSON.stringify(issue, null, 2) + '\n';
  const sourceMedia = {};
  for (const article of issue.articles) for (const photo of article.photos ?? []) {
    const bytes = await loadMedia({ root: 'issue', path: photo.path });
    if (bytes) sourceMedia[photo.path] = await sha256Hex(bytes);
  }
  const manifest = {
    schemaVersion: 'ote.designcraft.issue-build.v1', pages, cliVersion: executor.version,
    documentFontSha256: await fontScope(docFonts), sourceIssueSha256: await sha256Hex(new TextEncoder().encode(sourceIssueText)),
    articleMetadata: Object.fromEntries([...articles].map(([aid, a]) => [aid, Object.fromEntries(['title', 'author', 'bodyFormat', 'photos'].map((k) => [k, a[k] ?? null]))])),
    articleFlows: threaded.manifest, nativeCoverReferences: referenced.manifest, sourceMediaSha256: sourceMedia,
    nativeDocumentSha256: await sha256Hex(native), coverPhotoSha256: await embeddedCoverHash(entries, document), articleBodyChecks: bodyCopy,
    fontProfile, restoredHyperlinks: links.restored, removedReplacedStories: 0, checkedNativeCrossReferences: nativeXrefs.length,
    coverFields, coverReferences: references, preservedNativePages: {}, pageBuilds: pageResults,
    preflight, sourceMarkdownPreserved: true, adobeInDesignTested: false,
    status: preflight.errors ? 'needs-layout-adjustment' : 'exported',
  };
  const interchange = interchangeMetadata(document);
  manifest.interchangeHyperlinks = { nativeAndPdf: true, stockIdml: false, sidecarCount: interchange.hyperlinks.length, reopenTool: 'reopen-idml.py' };
  const artifacts = { native, preflight, manifest, sourceIssue: issue, interchange, pages: pageArtifacts };
  if (preflight.errors) throw new CompileError('Issue preflight errors block final PDF/IDML export; native draft and source retained', artifacts);
  await verifyCoverReferences(native, referenced.manifest, ctx);
  progress({ stage: 'export' });
  const exported = await executor.run([
    { command: 'file.open', params: { path: '@doc' } },
    { command: 'file.exportPdf', params: { path: '@out:issue.pdf', standard: 'x4' } },
    { command: 'file.exportIdml', params: { path: '@out:issue.idml' } },
  ], { ...session, doc: native });
  artifacts.pdf = exported.outputs['issue.pdf'];
  artifacts.idml = exported.outputs['issue.idml'];
  return { manifest, artifacts };
}

export { storyIds };
