// Adaptive headline bands: measure, in the real engine, how many lines each
// headline needs at its slot width and grow the band to fit. Items between the
// headline and its body move down and the body starts lower, so the copy still
// gets an honest preflight. The result is an explicit template variant with
// recorded geometry; neither compiler adjusts layouts on its own.
import { clone } from './native-doc.js';
import { designFontMapper, documentFonts } from './page-compiler.js';

const DEFAULT_HEADLINE = { family: 'Source Sans 3', face: 'Bold', size: 24, leading: 27 };
const MAX_LINES = 4;
const ARTICLE_ROLES = new Set(['byline', 'photo', 'caption', 'body']);

const overlap = (a, b) => Math.max(0, Math.min(a[2], b[2]) - Math.max(a[0], b[0]));

/** Typography the compiler will use for a headline slot (see buildPage styles), including a design's house headline. */
export function headlineType(slot, { fontProfile, design, substituteFonts }) {
  const house = design?.styles?.['OTE Headline'];
  let base = fontProfile === 'original2025' ? { ...DEFAULT_HEADLINE, family: 'Helvetica Neue' } : DEFAULT_HEADLINE;
  if (house) {
    const [family, face] = designFontMapper(design, fontProfile, substituteFonts)(house.fontFamily, house.fontStyle);
    base = { family, face, size: house.size, leading: house.leading, chars: house.chars };
  }
  if (slot.style?.fontFamily) {
    const [family, face] = designFontMapper(design, fontProfile, substituteFonts)(slot.style.fontFamily, slot.style.fontStyle ?? base.face);
    return { family, face, size: slot.style.size ?? base.size, leading: slot.style.leading ?? (slot.style.size ?? base.size) * 1.125, chars: slot.style.chars };
  }
  if (!slot.fontSize && !slot.leading) return base;
  const size = Number(slot.fontSize ?? base.size);
  return { ...base, size, leading: Number(slot.leading ?? (slot.fontSize ? size * 1.15 : base.leading)) };
}

/**
 * Lines each headline needs: [{slotId, lines, height, fits}] measured in the engine with frames of growing height.
 * By default the probes grow the band a line at a time; with tight = true they start from the smallest
 * frame that can hold one line, so a band can also shrink when the headline needs fewer lines.
 */
export async function measureHeadlines(template, articles, { executor, library, fontProfile = 'portable', fonts = [], substituteFonts = [], tight = false }) {
  const slots = template.slots.filter((s) => s.role === 'headline' && s.enabled !== false && articles[s.articleIndex ?? 0]);
  if (!slots.length) return [];
  const design = template.design ? library.designs?.[template.design] ?? null : null;
  // One tall page holds every probe; save and reopen so the CLI loads Document Fonts first, as buildPage does.
  const steps = [{ command: 'file.new', params: { width: library.page.width, height: Math.max(library.page.height * 4, 40 + slots.length * MAX_LINES * (tight ? 2 : 1) * 400), pages: 1, facingPages: false } },
    { command: 'file.saveAs', params: { path: '@doc' } }, { command: 'file.open', params: { path: '@doc' } }];
  const probes = [];
  for (const slot of slots) {
    const type = headlineType(slot, { fontProfile, design, substituteFonts }), name = 'Fit ' + slot.id, title = articles[slot.articleIndex ?? 0].title;
    steps.push({ command: 'style.paragraph.create', params: { name, para: { hyphenate: false }, chars: { fontFamily: type.family, fontStyle: type.face, size: type.size, leading: { kind: 'points', value: type.leading }, ...(type.chars ?? {}) } } });
    const [x, y, r, b] = slot.rect;
    const heights = [];
    for (let lines = 1; lines <= MAX_LINES; lines++) {
      if (tight) for (const k of [1.1, 1.3]) heights.push([lines, Math.round(((lines - 1) * type.leading + type.size * k) * 100) / 100]);
      else heights.push([lines, b - y + (lines - 1) * type.leading]);
    }
    for (const [lines, height] of heights) {
      const top = 20 + probes.length * 400;
      const frame = steps.push({ command: 'frame.create', params: { rect: [x, top, r, top + height], content: 'text', text: title, caret: false } }) - 1;
      steps.push({ command: 'object.textFrameOptions', params: { ids: [`$${frame}.id`], inset: 0, columns: 1 } });
      steps.push({ command: 'text.select', params: { story: `$${frame}.story`, anchor: 0, focus: new TextEncoder().encode(title).length } });
      steps.push({ command: 'style.paragraph.apply', params: { name, clearOverrides: true } });
      probes.push({ slot, lines, height, get: steps.push({ command: 'story.get', params: { frame: `$${frame}.id` } }) - 1 });
    }
  }
  const { results } = await executor.run(steps, { media: new Map(), fonts: documentFonts(fonts, fontProfile, Boolean(design)) });
  return slots.map((slot) => {
    const fitting = probes.filter((p) => p.slot === slot && !results[p.get].overset).sort((p, q) => p.height - q.height);
    const best = fitting[0] ?? probes.filter((p) => p.slot === slot).at(-1);
    return { slotId: slot.id, lines: best.lines, height: best.height, fits: Boolean(fitting.length) };
  });
}

/**
 * Fit each headline band to its measured height. A band that grows pushes its own article's byline and
 * photo down and starts the body lower (the body keeps its bottom edge; a photo absorbs any shortfall when
 * no body follows). With tighten, a band taller than its headline shrinks: the byline moves up and the
 * photo's top edge rises with it, so the image grows into the space (the body starts higher when the
 * column has no photo). Folios, datelines and other stories never move.
 * Returns {template, changes} or null when no band changes.
 */
export function fitHeadlineBands(template, measurements, { contentBottom = 744, tighten = false, minimum = 2 } = {}) {
  const fitted = clone(template), changes = [];
  for (const m of measurements) {
    const headline = fitted.slots.find((s) => s.id === m.slotId);
    const [x, y, r, b] = headline.rect, delta = Math.round((y + m.height - b) * 100) / 100;
    if (delta <= 0.01 && !(tighten && m.fits && -delta >= minimum)) continue;
    headline.rect = [x, y, r, y + m.height];
    // The headline's own article below it, in its column; folios and other stories stay put.
    const column = fitted.slots.filter((s) => s !== headline && s.enabled !== false && ARTICLE_ROLES.has(s.role) && (s.articleIndex ?? 0) === (headline.articleIndex ?? 0)
      && s.rect[1] >= b - 1 && overlap(s.rect, [x, y, r, b]) > 0.5 * Math.min(r - x, s.rect[2] - s.rect[0]))
      .sort((p, q) => p.rect[1] - q.rect[1]);
    const body = column.find((s) => s.role === 'body');
    if (delta > 0) {
      for (const slot of column) {
        if (body && slot.rect[1] > body.rect[1]) continue;              // below the body: unchanged
        if (slot === body) slot.rect = [slot.rect[0], slot.rect[1] + delta, slot.rect[2], slot.rect[3]];
        else slot.rect = [slot.rect[0], slot.rect[1] + delta, slot.rect[2], slot.rect[3] + delta];
      }
      if (!body) {
        const photo = column.find((s) => s.role === 'photo'), bottom = Math.max(...column.map((s) => s.rect[3]));
        if (photo && bottom > contentBottom) photo.rect[3] -= bottom - contentBottom;
      }
    } else {
      const rise = -delta, firstPhoto = column.find((s) => s.role === 'photo' && (!body || s.rect[1] <= body.rect[1]));
      // Everything between the headline and the photo row (or the body) moves up; that row grows upward.
      const row = firstPhoto ? column.filter((s) => s.role === 'photo' && Math.abs(s.rect[1] - firstPhoto.rect[1]) <= 1) : body ? [body] : [];
      const stop = row.length ? Math.min(...row.map((s) => s.rect[1])) : Infinity;
      for (const slot of column) {
        if (row.includes(slot)) slot.rect = [slot.rect[0], slot.rect[1] - rise, slot.rect[2], slot.rect[3]];
        else if (slot.rect[1] < stop - 0.5) slot.rect = [slot.rect[0], slot.rect[1] - rise, slot.rect[2], slot.rect[3] - rise];
      }
    }
    if (column.some((s) => s.rect[3] - s.rect[1] < 12 || s.rect[3] > contentBottom + 0.01)) return null;
    changes.push({ slotId: m.slotId, lines: m.lines, grownBy: delta });
  }
  if (!changes.length) return null;
  const lines = Math.max(...changes.map((c) => c.lines)), tight = changes.every((c) => c.grownBy < 0);
  fitted.id = `${template.id}@fit-${changes.map((c) => c.slotId + '-' + c.lines).join('-')}`;
  fitted.name = `${template.name} · ${tight ? 'fitted' : lines + '-line'} headline${changes.length > 1 ? 's' : ''}`;
  fitted.headlineFit = changes;
  return { template: fitted, changes };
}

/** Grow-only band fitting (the variant generator's overset repair). */
export const growHeadlineBands = (template, measurements, contentBottom = 744) => fitHeadlineBands(template, measurements, { contentBottom });

/** Convenience: measure and fit in one call (options.tighten also shrinks bands); returns the original template when nothing changes. */
export async function fitHeadlines(template, articles, options) {
  const measured = await measureHeadlines(template, articles, { ...options, tight: options.tighten ?? options.tight });
  return fitHeadlineBands(template, measured, options) ?? { template, changes: [] };
}

/**
 * Cover feature titles and cover lines in an original design were short teasers. When a full
 * headline or a long cover line oversets its slot, compose the cover in the engine and step only the overset
 * titles down 0.5 pt (leading in proportion), never below 60% of the design size.
 * Returns {template, changes}; changes record every adjusted slot for the manifest.
 */
export async function fitCoverTitles(template, compileCover, { minimum = 0.6, step = 0.5, attempts = 40 } = {}) {
  const fitted = clone(template), changes = new Map();
  for (let attempt = 0; attempt < attempts; attempt++) {
    const failure = await compileCover(fitted);
    if (!failure) return { template: fitted, changes: [...changes.values()] };
    const titles = new Map(fitted.slots.filter((s) => s.field === 'featureTitle' || s.field === 'coverLine').map((s) => [s.id, s]));
    const overset = failure.oversetSlotIds.filter((id) => titles.has(id));
    if (!overset.length || overset.length !== failure.oversetSlotIds.length || failure.otherErrors) return null;
    for (const id of overset) {
      const slot = titles.get(id), original = changes.get(id)?.from ?? slot.style.size;
      const size = Math.round((slot.style.size - step) * 100) / 100;
      if (size < original * minimum) return null;
      slot.style = { ...slot.style, size, leading: Math.round(slot.style.leading * (size / slot.style.size) * 100) / 100 };
      changes.set(id, { slotId: id, from: original, to: size });
    }
  }
  return null;
}
