// Resolve cover fields and article references from the issue's saved plan.
// Port of tools/designcraft/cover_fields.py. The cover photo stays an
// issue-relative media reference (assetRoot: 'issue') instead of a file path.
import { clone } from './native-doc.js';

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

function isoDate(value) {
  const match = typeof value === 'string' && /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return null;
  const [year, month, day] = match.slice(1).map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day ? { year, month, day } : null;
}

const positiveInt = (v) => Number.isInteger(v) && typeof v !== 'boolean' && v >= 1;
const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const ordinal = (n) => n + (n % 100 >= 11 && n % 100 <= 13 ? 'th' : { 1: 'st', 2: 'nd', 3: 'rd' }[n % 10] ?? 'th');

/** Page label as a family prints it: 5 (arabic) or 05 (arabicLeadingZero). */
export const pageLabel = (n, numbering = 'arabicLeadingZero') => numbering === 'arabic' ? String(n) : String(n).padStart(2, '0');

/**
 * Text for a field format such as "{WEEKDAY}, {MONTH} {D}, {YYYY}" or "issue {number}".
 * Tokens: {Weekday} {WEEKDAY} {Month} {MONTH} {D} {DD} {Dth} {YYYY} {volume} {number} {line}.
 * Returns null when a token's value is unknown, so the slot keeps its placeholder.
 */
export function fieldText(format, values) {
  const date = isoDate(values.date);
  const tokens = {
    Weekday: date && WEEKDAYS[new Date(Date.UTC(date.year, date.month - 1, date.day)).getUTCDay()],
    Month: date && MONTHS[date.month - 1], D: date && String(date.day), DD: date && String(date.day).padStart(2, '0'),
    Dth: date && ordinal(date.day), YYYY: date ? String(date.year) : values.year ? String(values.year) : null,
    volume: values.volume ?? null, number: values.number ?? null, line: values.line ?? null,
  };
  tokens.WEEKDAY = tokens.Weekday?.toUpperCase();
  tokens.MONTH = tokens.Month?.toUpperCase();
  let missing = false;
  const text = format.replace(/\{(\w+)\}/g, (_, key) => { const v = tokens[key]; if (v === null || v === undefined) { missing = true; return ''; } return String(v); });
  return missing ? null : text;
}

/** Fill a family template's field slots (datelines, cover date/issue/volume lines) from the issue. */
export function resolveFields(template, issue, family) {
  const result = clone(template);
  const values = { ...(issue?.issue ?? {}), ...(issue?.layoutPlan?.cover ?? {}) };
  for (const slot of result.slots) {
    if (!slot.field || slot.field === 'featureTitle') continue;
    const text = slot.field === 'coverLine' ? (values.line ?? slot.text) : fieldText(slot.format ?? '', values);
    if (text !== null && text !== undefined) slot.text = text;
  }
  return result;
}

export function resolveCover(template, issue, articleIds, references = null) {
  const result = clone(template);
  const info = issue.issue ?? {};
  const cover = issue.layoutPlan?.cover ?? {};
  const fields = { ...info, ...cover };
  let released = null;
  if (fields.date) {
    released = isoDate(fields.date);
    if (!released) throw new Error('Choose a valid ISO cover release date');
  }
  for (const key of ['volume', 'number']) {
    if (key in fields && !positiveInt(fields[key])) throw new Error('Cover ' + key + ' must be a positive integer');
  }
  for (const key of ['line', 'caption']) {
    if (key in cover && typeof cover[key] !== 'string') throw new Error('Cover ' + key + ' must be text');
  }
  const articles = new Map((issue.articles ?? []).map((a) => [a.id, a]));
  if (articleIds.length > 3 || new Set(articleIds).size !== articleIds.length || articleIds.some((id) => !articles.has(id))) {
    throw new Error('Choose up to three distinct cover articles');
  }
  if (references === null) {
    references = {};
    const flows = issue.layoutPlan?.articleFlows ?? {};
    for (const page of issue.layoutPlan?.pages ?? []) {
      if (page.kind === 'cover' || (page.templateId ?? '').startsWith('cover-') || page.templateId === template.id) continue;
      for (const aid of page.articleIds ?? []) {
        if (aid in references && !(aid in flows)) throw new Error('A featured article has multiple interior page assignments');
        references[aid] = Math.min(references[aid] ?? page.pageNumber, page.pageNumber);
      }
    }
  }
  const missing = articleIds.filter((aid) => !(aid in references));
  if (missing.length) throw new Error('Place each featured article on an interior page before exporting: ' + missing.join(', '));
  for (const slot of result.slots) {
    const sid = slot.id;
    if (sid === 'cover-date' && released) slot.text = (MONTHS[released.month - 1] + ' ' + released.day).toUpperCase();
    else if (sid === 'cover-year' && released) slot.text = String(released.year);
    else if (sid === 'cover-issue' && 'volume' in fields && 'number' in fields) {
      slot.text = `VOLUME ${fields.volume} · ISSUE ${fields.number}` + (result.family === 'framed' && released ? ` · ${released.year}` : '');
    } else if (sid === 'cover-line' && 'line' in cover) slot.text = cover.line;
    else if (sid === 'cover-photo' && cover.photoPath) {
      delete slot.articleIndex;
      slot.asset = cover.photoPath;
      slot.assetRoot = 'issue';
      slot.fit = cover.fit ?? slot.fit ?? 'cover';
      // A family template records how the original framed its photo; the cover form can override it.
      slot.focus = cover.focus ?? (result.design ? slot.focus : undefined) ?? { x: 0.5, y: 0.5 };
      if (cover.zoom) slot.zoom = cover.zoom;
    } else if (sid.startsWith('cover-card-')) {
      const index = slot.articleIndex ?? 0;
      const aid = index < articleIds.length ? articleIds[index] : null;
      // Family covers print the page number alone (it becomes a live reference) beside a title slot.
      if (slot.cardPart === 'number') slot.text = aid ? pageLabel(references[aid], slot.numbering) : '';
      else slot.text = aid ? `${String(references[aid]).padStart(2, '0')} · ${articles.get(aid).title}` : '';
      delete slot.fields;
    } else if (slot.field === 'featureTitle') {
      // Original covers carry short teasers; an editor's teaser wins over the full headline.
      const index = slot.articleIndex ?? 0, aid = index < articleIds.length ? articleIds[index] : null;
      slot.text = aid ? (typeof cover.teasers?.[aid] === 'string' && cover.teasers[aid].trim() ? cover.teasers[aid] : articles.get(aid).title) : '';
    }
  }
  result.slots = result.slots.filter((s) => s.id !== 'cover-caption');
  if (cover.caption && !result.design) {
    let rect;
    if (result.family === 'framed') {
      rect = [42, 597, 714, 612];
      for (const slot of result.slots) if (slot.id.startsWith('cover-card-')) slot.rect[1] = Math.max(slot.rect[1], 616);
    } else rect = [60, 518, 696, 540];
    result.slots.push({ id: 'cover-caption', role: 'caption', rect, text: cover.caption, fontSize: 8 });
  }
  return result;
}
