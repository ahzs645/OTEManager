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
      slot.focus = cover.focus ?? { x: 0.5, y: 0.5 };
    } else if (sid.startsWith('cover-card-')) {
      const index = slot.articleIndex ?? 0;
      const aid = index < articleIds.length ? articleIds[index] : null;
      slot.text = aid ? `${String(references[aid]).padStart(2, '0')} · ${articles.get(aid).title}` : '';
      delete slot.fields;
    }
  }
  result.slots = result.slots.filter((s) => s.id !== 'cover-caption');
  if (cover.caption) {
    let rect;
    if (result.family === 'framed') {
      rect = [42, 597, 714, 612];
      for (const slot of result.slots) if (slot.id.startsWith('cover-card-')) slot.rect[1] = Math.max(slot.rect[1], 616);
    } else rect = [60, 518, 696, 540];
    result.slots.push({ id: 'cover-caption', role: 'caption', rect, text: cover.caption, fontSize: 8 });
  }
  return result;
}
