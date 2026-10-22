// Layout variants for chosen articles: enumerate template × article order,
// pre-rank cheaply, then compose the best candidates in the real engine.
// Fit is decided by native preflight; copy is never cut or silently shrunk.
// Headline size steps are explicit, labelled variants, as the compiler allows.
import { composeSource } from './markdown-story.js';
import { CompileError, buildPage, compilePage } from './page-compiler.js';
import { clone, readNative } from './native-doc.js';
import { fitHeadlineBands, growHeadlineBands, measureHeadlines } from './fit.js';

const BODY_LEADING = 12, BODY_PARAGRAPH_SPACE = 4, BODY_CHAR = 4.75;   // Source Serif 4 10/12
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
    if (template.source || template.kind !== 'story' || template.storyCount !== count || (template.design ?? null) !== design) continue;
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

/** Cheap estimate: body lines needed vs available, headline lines needed vs available. */
export function estimate(candidate, library, markdownit) {
  const gutter = library.page.gutter ?? 12;
  let worstBody = 0, bodyFill = [], headlineOver = 0;
  for (const slot of candidate.template.slots) {
    const article = candidate.order[slot.articleIndex ?? 0];
    if (!article || slot.enabled === false) continue;
    const [x, y, r, b] = slot.rect, w = r - x, h = b - y;
    if (slot.role === 'body') {
      const columns = slot.columns ?? 1, colWidth = (w - gutter * (columns - 1)) / columns;
      const perLine = Math.max(1, Math.floor(colWidth / BODY_CHAR));
      const paragraphs = composeSource(article.body, article.bodyFormat ?? 'markdown', markdownit).text.split('\n');
      const lines = paragraphs.reduce((n, p) => n + Math.max(1, Math.ceil([...p].length / perLine)), 0);
      const ratio = (lines * BODY_LEADING + paragraphs.length * BODY_PARAGRAPH_SPACE) / (columns * h);
      bodyFill.push(ratio);
      worstBody = Math.max(worstBody, ratio);
    } else if (slot.role === 'headline') {
      const size = slot.fontSize ?? 24, perLine = Math.max(1, Math.floor(w / (size * HEADLINE_CHAR)));
      const words = article.title.split(/\s+/);
      let lines = 1, current = 0;
      for (const word of words) { const len = [...word].length; if (current && current + 1 + len > perLine) { lines++; current = len; } else current += (current ? 1 : 0) + len; }
      headlineOver = Math.max(headlineOver, lines - Math.max(1, Math.floor(h / (size * 1.125))));
    }
  }
  const fill = bodyFill.length ? bodyFill.reduce((a, c) => a + c, 0) / bodyFill.length : 0;
  return { worstBody, fill, headlineOver };
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
  const fill = bodies.map((slot, i) => {
    const story = run.results[i + 1], [, y, , b] = slot.rect;
    return (story.lines * BODY_LEADING + story.paragraphs * BODY_PARAGRAPH_SPACE) / ((slot.columns ?? 1) * (b - y));
  });
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
      Object.assign(variant, await measure(artifacts.native, built, executor, JSZip));
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
 * Suggest a whole-issue plan: group articles into interior pages, choose the best
 * fitting variant for each, and put a cover with up to three featured articles first.
 * Grouping is greedy by estimated length (long pieces alone, short ones together).
 */
export async function suggestIssuePlan(options) {
  const { library, issue, markdownit } = options;
  const coverTemplateId = options.coverTemplateId ?? library.templates.find((t) => t.kind === 'cover' && (t.design ?? null) === (options.design ?? null))?.id;
  const ids = options.articleIds ?? issue.articles.map((a) => a.id);
  const sized = ids.map((id) => {
    const a = issue.articles.find((x) => x.id === id);
    return { id, chars: composeSource(a.body, a.bodyFormat ?? 'markdown', markdownit).text.length };
  }).sort((a, b) => b.chars - a.chars);
  const pageBudget = options.pageChars ?? 5200;                          // roughly a full page of 10/12 body copy
  const groups = [];
  for (const item of sized) {
    const open = groups.find((g) => g.length < 3 && g.reduce((n, x) => n + x.chars, 0) + item.chars <= pageBudget);
    if (open) open.push(item); else groups.push([item]);
  }
  const pages = [], plans = [];
  // When nothing fits a group, split it (longest piece alone, the rest together) and retry.
  while (groups.length) {
    const group = groups.shift(), pageNumber = pages.length + 2;
    const { variants, rejected } = await generatePageVariants({ ...options, articleIds: group.map((g) => g.id), pageNumber, pageId: `page-${pageNumber}`, keep: 1, previewScale: options.previewScale ?? 0 });
    if (!variants.length) {
      if (group.length > 1) { groups.unshift([group[0]], group.slice(1)); continue; }
      plans.push({ pageNumber, articleIds: group.map((g) => g.id), error: 'No layout fits this article on one page; plan a continuation', rejected: rejected.map((r) => ({ template: r.template.id, reason: r.reason })) });
      continue;
    }
    const best = variants[0];
    pages.push({ id: `page-${pageNumber}`, pageNumber, templateId: best.template.id, articleIds: best.articleIds, template: best.template });
    plans.push({ pageNumber, variant: best });
  }
  const placed = new Set(pages.flatMap((p) => p.articleIds));
  const featured = ids.filter((id) => placed.has(id)).slice(0, 3);
  const cover = coverTemplateId ? { id: 'page-1', pageNumber: 1, templateId: coverTemplateId, articleIds: featured } : null;
  // Headline-step variants are new template records; ship them with the plan.
  const known = new Set(library.templates.map((t) => t.id));
  const extraTemplates = pages.map((p) => p.template).filter((t) => !known.has(t.id));
  return { pages: cover ? [cover, ...pages] : pages, featured, plans, extraTemplates };
}
