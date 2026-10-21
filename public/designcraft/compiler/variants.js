// Layout variants for chosen articles: enumerate template × article order,
// pre-rank cheaply, then compose the best candidates in the real engine.
// Fit is decided by native preflight; copy is never cut or silently shrunk.
// Headline size steps are explicit, labelled variants, as the compiler allows.
import { composeSource } from './markdown-story.js';
import { allocateFixedIssue } from './issue-allocator.js';
import { CompileError, buildPage, compilePage } from './page-compiler.js';
import { clone, readNative } from './native-doc.js';
import { fitHeadlineBands, growHeadlineBands, measureHeadlines } from './fit.js';

const BODY_CHAR_FRACTION = 0.475; // Estimate only; shaping and preflight decide fit.
const HEADLINE_CHAR = 0.5;                                               // Source Sans 3 Bold, em fraction
export const HEADLINE_STEPS = [22, 20, 18];

function permutations(items) {
  if (items.length <= 1) return [items];
  return items.flatMap((item, i) => permutations([...items.slice(0, i), ...items.slice(i + 1)]).map((rest) => [item, ...rest]));
}

const photosOf = (article) => (article.photos ?? []).filter((p) => p.path);

/** Every story template of one design (null = classic recipes) × order whose photo slots the articles can fill. */
export function enumerateCandidates(library, articles, design = null) {
  const count = articles.length;
  const out = [];
  for (const template of library.templates) {
    if (template.kind !== 'story' || template.storyCount !== count || (template.design ?? null) !== design) continue;
    for (const order of permutations(articles)) {
      const used = new Map();
      let feasible = true;
      for (const slot of template.slots) {
        if (slot.role !== 'photo' || slot.asset || slot.enabled === false) continue;
        const ai = slot.articleIndex ?? 0, pi = slot.photoIndex ?? used.get(ai) ?? 0;
        used.set(ai, pi + 1);
        if (pi >= photosOf(order[ai]).length) { feasible = false; break; }
      }
      if (!feasible) continue;
      const unusedPhotos = order.reduce((sum, a, i) => sum + Math.max(0, photosOf(a).length - (used.get(i) ?? 0)), 0);
      out.push({ template, order, unusedPhotos });
    }
  }
  return out;
}

/** Effective point metrics used by buildPage, including house styles and slot overrides. */
export function slotMetrics(slot, template, library) {
  const defaults = slot.role === 'headline' ? { size: 24, leading: 27, para: {} } : { size: 10, leading: 12, para: { spaceAfter: 4 } };
  const family = template.design ? library.designs?.[template.design] : null;
  const styleName = family && typeof slot.style === 'string' ? slot.style : slot.role === 'headline' ? 'OTE Headline' : 'OTE Body';
  const house = family?.styles?.[styleName] ?? {};
  const base = {...defaults, ...house, para: {...defaults.para, ...house.para}};
  const size = Number(slot.fontSize ?? base.size), leading = Number(slot.leading ?? (slot.fontSize ? size * 1.15 : base.leading));
  return { size, leading, spaceAfter: Number(base.para.spaceAfter ?? 0), spaceBefore: Number(base.para.spaceBefore ?? 0), tracking: Number(base.chars?.tracking ?? 0) };
}

/** Estimate demand once per article across its explicitly linked body regions. */
export function estimate(candidate, library, markdownit) {
  const gutter = library.page.gutter ?? 12;
  let worstBody = 0, bodyFill = [], headlineOver = 0;
  const bodySlots = new Map();
  for (const slot of candidate.template.slots) {
    const ai = slot.articleIndex ?? 0, article = candidate.order[ai];
    if (!article || slot.enabled === false) continue;
    const [x, y, r, b] = slot.rect, w = r - x, h = b - y, type = slotMetrics(slot, candidate.template, library);
    if (slot.role === 'body') {
      if (!bodySlots.has(ai)) bodySlots.set(ai, []);
      bodySlots.get(ai).push(slot);
    } else if (slot.role === 'headline') {
      const perLine = Math.max(1, Math.floor(w / (type.size * HEADLINE_CHAR + type.tracking * type.size / 1000)));
      const words = article.title.split(/\s+/);
      let lines = 1, current = 0;
      for (const word of words) { const len = [...word].length; if (current && current + 1 + len > perLine) { lines++; current = len; } else current += (current ? 1 : 0) + len; }
      headlineOver = Math.max(headlineOver, lines - Math.max(1, Math.floor(h / type.leading)));
    }
  }
  for (const [ai, slots] of bodySlots) {
    const article = candidate.order[ai], paragraphs = composeSource(article.body, article.bodyFormat ?? 'markdown', markdownit).text.split('\n');
    let charCapacity = 0, paragraphCost = 0;
    for (const slot of slots) {
      const [x,y,r,b] = slot.rect, type = slotMetrics(slot, candidate.template, library), columns = slot.columns ?? 1;
      const colWidth = (r-x-gutter*(columns-1))/columns;
      const perLine = Math.max(1, Math.floor(colWidth / (type.size * BODY_CHAR_FRACTION + type.tracking * type.size/1000)));
      const lines = Math.max(0, Math.floor((b-y)/type.leading))*columns;
      charCapacity += perLine*lines;
      paragraphCost += (type.spaceAfter+type.spaceBefore)/type.leading*perLine;
    }
    const averagePerLine = slots.reduce((n,slot)=>{const type=slotMetrics(slot,candidate.template,library);return n+Math.max(1,Math.floor((slot.rect[2]-slot.rect[0]-gutter*((slot.columns??1)-1))/(slot.columns??1)/(type.size*BODY_CHAR_FRACTION)));},0)/slots.length;
    const chars = paragraphs.reduce((n,p)=>n+Math.max(averagePerLine,Math.ceil([...p].length/averagePerLine)*averagePerLine),0);
    const ratio = charCapacity > 0 ? (chars+paragraphs.length*paragraphCost/slots.length)/charCapacity : Infinity;
    bodyFill.push(ratio);worstBody=Math.max(worstBody,ratio);
  }
  const fill = bodyFill.length ? bodyFill.reduce((a, c) => a + c, 0) / bodyFill.length : 0;
  return { worstBody, fill, headlineOver, confidence: 'estimated' };
}

function staticScore(est, candidate) {
  let score = 0;
  if (est.worstBody > 1.05) score += 10 + (est.worstBody - 1) * 20;    // likely overset
  score += Math.abs(Math.min(est.fill, 1) - 0.9) * 6;                  // prefer well-filled bodies
  score += Math.max(0, est.headlineOver) * 1.5;                         // headline may need a step
  score += candidate.unusedPhotos * 1.2;
  return score;
}

/** Measured fill per body frame, crop loss per photo, from the composed native page. */
async function measure(native, built, executor, JSZip) {
  const { document } = await readNative(native, JSZip);
  const items = new Map(document.spreads.flatMap((s) => s.items).filter((i) => i.name).map((i) => [i.name, i]));
  const bodies = built.template.slots.filter((s) => s.role === 'body' && s.enabled !== false);
  const run = await executor.run([
    { command: 'file.open', params: { path: '@doc' } },
    ...bodies.map((s) => ({ command: 'story.get', params: { frame: items.get(s.id).id } })),
  ], { doc: native, media: new Map(), fonts: [] });
  const byArticle = new Map();
  for (const [index, slot] of bodies.entries()) {
    const ai = slot.articleIndex ?? 0, type = slotMetrics(slot, built.template, built.library ?? { designs: {}, page: {} });
    const record = byArticle.get(ai) ?? { demand: (run.results[index + 1].lines * type.leading + run.results[index + 1].paragraphs * (type.spaceAfter + type.spaceBefore)), capacity: 0 };
    record.capacity += (slot.columns ?? 1) * (slot.rect[3] - slot.rect[1]);byArticle.set(ai,record);
  }
  const fill = [...byArticle.values()].map((record)=>record.demand/record.capacity);
  const crops = built.template.slots.filter((s) => s.role === 'photo' && items.get(s.id)?.content?.type === 'graphic').map((slot) => {
    const [iw, ih] = items.get(slot.id).content.size, [x, y, r, b] = slot.rect;
    const a = iw / ih, f = (r - x) / (b - y);
    return 1 - Math.min(a / f, f / a);                                   // share of the photo cropped away
  });
  return { fill, crops };
}

function finalScore(v) {
  const meanFill = v.fill.length ? v.fill.reduce((a, c) => a + c, 0) / v.fill.length : 0.9;
  const minFill = v.fill.length ? Math.min(...v.fill) : 0.9;
  const crop = v.crops.length ? v.crops.reduce((a, c) => a + c, 0) / v.crops.length : 0;
  return Math.abs(meanFill - 0.9) * 8 + Math.max(0, 0.55 - minFill) * 12 + crop * 3
    + (v.headlineSize ? (24 - v.headlineSize) / 2 * 0.8 : 0) + (v.headlineFit?.some((c) => c.grownBy > 0) ? 0.4 : 0) + v.unusedPhotos * 1.2;
}

function withHeadline(template, size) {
  const copy = clone(template);
  copy.id = `${template.id}@headline-${size}`;
  copy.name = `${template.name} · ${size}pt headline`;
  for (const slot of copy.slots) if (slot.role === 'headline') { slot.fontSize = size; delete slot.leading; }
  return copy;
}

/**
 * Compose and rank variants for one interior page.
 * options: {library, issue, articleIds, executor, fonts, loadMedia, markdownit, JSZip,
 *   limit = 8, keep = 4, previewScale = 0.25, pageNumber, onProgress, design, fontProfile, substituteFonts,
 *   tightenHeadlines (fit bands to headlines first: one-line headlines pull the byline up and grow the photo)}
 * Returns {variants: [{template, articleIds, status, score, fill, crops, headlineSize,
 *   preflight, native, pdf?, idml?, preview?, reason?}], considered, composed}.
 */
export async function generatePageVariants(options) {
  const { library, issue, executor, fonts, loadMedia, markdownit, JSZip } = options;
  const limit = options.limit ?? 8, keep = options.keep ?? 4;
  const progress = options.onProgress ?? (() => {});
  const byId = new Map(issue.articles.map((a) => [a.id, a]));
  const articles = options.articleIds.map((id) => byId.get(id));
  if (articles.some((a) => !a) || !articles.length || articles.length > 3) throw new Error('Choose one to three articles from the issue');
  const candidates = enumerateCandidates(library, articles, options.design ?? null).map((c) => {
    const est = estimate(c, library, markdownit);
    return { ...c, est, score: staticScore(est, c) };
  }).sort((a, b) => a.score - b.score);
  // Keep the shortlist varied: the best-estimated article order per template.
  const perPattern = new Map(), shortlist = [];
  for (const c of candidates) {
    const key = c.template.id;
    if ((perPattern.get(key) ?? 0) >= 1) continue;
    perPattern.set(key, (perPattern.get(key) ?? 0) + 1);
    shortlist.push(c);
    if (shortlist.length >= limit) break;
  }
  const results = [];
  let composed = 0;
  const attempt = async (template, order, headlineSize, unusedPhotos, headlineFit = null) => {
    composed++;
    progress({ stage: 'compose', template: template.id, done: composed });
    const built = await buildPage({
      library: { ...library, templates: [template] }, template, issue, articleIds: order.map((a) => a.id),
      pageId: options.pageId ?? 'variant', pageNumber: options.pageNumber ?? 2, fontProfile: options.fontProfile ?? 'portable', markdownit, loadMedia, substituteFonts: options.substituteFonts,
    });
    const variant = { template, articleIds: order.map((a) => a.id), headlineSize, unusedPhotos, headlineFit };
    try {
      const { manifest, artifacts } = await compilePage(built, { executor, fonts, JSZip });
      Object.assign(variant, { status: manifest.status, preflight: artifacts.preflight, native: artifacts.native, pdf: artifacts.pdf, idml: artifacts.idml, manifest });
      Object.assign(variant, await measure(artifacts.native, {...built, library}, executor, JSZip));
      variant.score = finalScore(variant);
    } catch (error) {
      if (!(error instanceof CompileError)) throw error;
      const issues = error.artifacts.preflight?.issues ?? [];
      const headlineIds = new Set(built.slotRefs.filter((s) => s.role === 'headline').map((s) => s.slotId));
      const names = new Map((await readNative(error.artifacts.native, JSZip)).document.spreads.flatMap((s) => s.items).map((i) => [i.id, i.name]));
      const errors = issues.filter((i) => i.severity === 'error');
      const oversetSlots = errors.filter((i) => i.kind === 'overset').map((i) => names.get(i.item));
      Object.assign(variant, {
        status: 'does-not-fit', preflight: error.artifacts.preflight, native: error.artifacts.native,
        headlineOnly: oversetSlots.length > 0 && oversetSlots.every((n) => headlineIds.has(n)) && errors.every((i) => i.kind === 'overset'),
        reason: oversetSlots.length ? 'Overset text in ' + oversetSlots.join(', ') : error.message,
      });
    }
    results.push(variant);
    return variant;
  };
  const measureBands = (template, order, tight = false) => measureHeadlines(template, order, { executor, library, fonts, fontProfile: options.fontProfile, substituteFonts: options.substituteFonts, tight });
  for (const c of shortlist) {
    // tightenHeadlines: fit every band to its headline first (a one-line headline pulls its byline and
    // photo up and the photo grows); the layout as drawn stays the fallback.
    if (options.tightenHeadlines) {
      const fitted = fitHeadlineBands(c.template, await measureBands(c.template, c.order, true), { tighten: true });
      if (fitted && (await attempt(fitted.template, c.order, null, c.unusedPhotos, fitted.changes)).status === 'exported') continue;
    }
    const first = await attempt(c.template, c.order, null, c.unusedPhotos);
    if (first.status === 'does-not-fit' && first.headlineOnly) {
      // Grow the headline band at the designed size first; then explicit smaller sizes, each grown to fit.
      for (const size of [null, ...HEADLINE_STEPS]) {
        const sized = size ? withHeadline(c.template, size) : c.template;
        const grown = growHeadlineBands(sized, await measureBands(sized, c.order));
        const v = await attempt(grown?.template ?? sized, c.order, size, c.unusedPhotos, grown?.changes);
        if (v.status === 'exported') break;
      }
    }
  }
  const fits = results.filter((v) => v.status === 'exported').sort((a, b) => a.score - b.score).slice(0, keep);
  if (options.previewScale !== 0) {
    for (const v of fits) if (executor.renderPng) v.preview = await executor.renderPng(v.native, { page: 0, scale: options.previewScale ?? 0.25 });
  }
  return { variants: fits, rejected: results.filter((v) => v.status !== 'exported'), considered: candidates.length, composed };
}

/**
 * Suggest within a fixed page budget, using page-specific reservation geometry.
 * Protected recipes and their continuation chains stay intact. Single-page
 * variants are checked; complete multi-page flows remain estimated until the
 * whole-issue compiler threads and preflights the original sources.
 */
export async function suggestIssuePlan(options) {
  return allocateFixedIssue(options, { generatePageVariants, enumerateCandidates, estimate });
}
