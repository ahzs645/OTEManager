// Fixed editorial pieces keep their copy as editable native text. A source
// layout may position each field independently; ordinary reservations flow
// the same fields through one frame, so a longer answer remains complete.
import { composeSource, utf8Length } from './markdown-story.js';

const FIELD_STYLES = { heading: 'OTE Headline', subtitle: 'OTE Label', question: 'OTE Label', answer: 'OTE Body', president: 'OTE Byline', body: 'OTE Body', closing: 'OTE Caption' };

export function structuredContent(slot, fields, markdownit) {
  const structured = slot.blockType === 'president-qa' || 'question' in fields || 'answer' in fields || 'body' in fields || slot.contentLayout;
  if (!structured) return null;
  if (slot.blockType === 'president-qa' || 'question' in fields || 'answer' in fields) {
    for (const key of ['question', 'answer']) if (typeof fields[key] !== 'string' || !fields[key].trim()) throw new Error(`Editorial block ${slot.id} needs a nonempty ${key}`);
  }
  const values = { heading: slot.text ?? '', ...fields };
  const layout = slot.contentLayout;
  if (layout !== undefined && (!Array.isArray(layout) || !layout.length || layout.length > 32)) throw new Error('Editorial contentLayout needs 1–32 field regions');
  const definitions = layout ?? [...new Set([...Object.keys(FIELD_STYLES).filter((field) => field in values), ...Object.keys(values)])].map((field) => ({ field }));
  const parts = [];
  const used = new Set();
  for (const definition of definitions) {
    const field = definition.field;
    if (typeof field !== 'string' || !/^[A-Za-z][A-Za-z0-9_-]{0,63}$/.test(field) || used.has(field)) throw new Error('Editorial field regions need unique field names');
    used.add(field);
    const source = values[field];
    if (source === undefined || source === '') continue;
    if (typeof source !== 'string') throw new Error(`Editorial field ${field} must be text`);
    const rich = composeSource(source, definition.bodyFormat ?? slot.bodyFormat ?? 'plain', markdownit);
    if (!rich.text.trim()) continue;
    const style = definition.style ?? FIELD_STYLES[field] ?? 'OTE Body';
    if (layout) {
      const rect = definition.rect;
      if (!Array.isArray(rect) || rect.length !== 4 || rect.some((n) => typeof n !== 'number' || !Number.isFinite(n) || n < 0 || n > 1) || rect[0] >= rect[2] || rect[1] >= rect[3]) throw new Error('Editorial field rectangles must be positive fractions within the reserved block');
    }
    parts.push({ ...definition, field, style, source, rich });
  }
  // Refuse a source layout that would quietly omit supplied editorial copy.
  for (const [field, value] of Object.entries(fields)) if (value !== undefined && value !== '' && !used.has(field)) throw new Error(`Editorial contentLayout has no region for ${field}`);
  if (!parts.length) throw new Error(`Editorial block ${slot.id} has no printable fields`);
  let text = '', paragraphs = [], spans = [];
  for (const part of parts) {
    if (text) text += '\n';
    const offset = utf8Length(text);
    const sourceParagraphs = part.rich.paragraphs.length ? part.rich.paragraphs : [{ start: 0, end: utf8Length(part.rich.text), style: 'OTE Body' }];
    paragraphs.push(...sourceParagraphs.map((p) => ({ ...p, start: p.start + offset, end: p.end + offset, style: p.style === 'OTE Body' ? part.style : p.style })));
    spans.push(...part.rich.spans.map((span) => ({ ...span, start: span.start + offset, end: span.end + offset })));
    text += part.rich.text;
  }
  return { parts, separate: Boolean(layout), rich: { text, paragraphs, spans } };
}

export function pageBindings(issue, pageId, pageNumber) {
  const plan = issue?.layoutPlan ?? {};
  const pages = plan.pages ?? [];
  const page = pages.find((p) => p.id === pageId && (p.pageNumber === undefined || p.pageNumber === pageNumber)) ?? pages.find((p) => p.pageNumber === pageNumber) ?? {};
  const blocks = { ...(plan.blocks ?? {}) };
  for (const [id, block] of Object.entries(page.blocks ?? {})) blocks[id] = { ...(blocks[id] ?? {}), ...block, fields: { ...(blocks[id]?.fields ?? {}), ...(block?.fields ?? {}) } };
  return { media: { ...(plan.media ?? {}), ...(page.media ?? {}) }, blocks, section: page.section };
}
