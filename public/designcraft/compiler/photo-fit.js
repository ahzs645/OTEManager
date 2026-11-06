// Photo-shaped layouts: read each photo's real size, match photos to slots, and
// derive template variants whose frames follow the photo instead of cropping it.
// Like adaptive headline bands (fit.js) the result is an explicit template with
// recorded geometry, and the copy still gets an honest native preflight.
import { clone } from './native-doc.js';

const round = (value) => Math.round(value * 100) / 100;
const CAPTION_GAP = 3, WRAP_OFFSET = 8;
export const PRINT_PPI = 150;                                             // below this a photo prints visibly soft
const INSET_HEIGHT = [0.12, 0.85];                                        // share of the text area an inset may occupy
const ROW_HEIGHT = [72, 0.52];                                            // points, then share of the page's content height
const SIDE_WIDTH = [0.26, 0.52];                                          // share of the combined photo + body width
const COLUMN_WIDTH = 200;                                                 // comfortable 10/12 measure when a body frame widens

/** Pixel size after EXIF rotation, from the file header: {width, height}. Null for formats that hold no raster size here. */
export function imageSize(bytes) {
  const data = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  if (data.length > 24 && view.getUint32(0) === 0x89504e47) return { width: view.getUint32(16), height: view.getUint32(20) };
  if (data.length < 4 || view.getUint16(0) !== 0xffd8) return null;
  let offset = 2, orientation = 1;
  while (offset + 9 < data.length) {
    if (data[offset] !== 0xff) { offset++; continue; }
    const marker = data[offset + 1];
    if (marker === 0xff) { offset++; continue; }
    if (marker === 0xd8 || (marker >= 0xd0 && marker <= 0xd7)) { offset += 2; continue; }
    const length = view.getUint16(offset + 2);
    if (marker === 0xe1) orientation = exifOrientation(data, view, offset + 4, length - 2) ?? orientation;
    if (marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker)) {
      const height = view.getUint16(offset + 5), width = view.getUint16(offset + 7);
      return orientation >= 5 ? { width: height, height: width } : { width, height };
    }
    offset += 2 + length;
  }
  return null;
}

function exifOrientation(data, view, start, length) {
  if (length < 14 || String.fromCharCode(...data.subarray(start, start + 4)) !== 'Exif') return null;
  const tiff = start + 6, little = view.getUint16(tiff) === 0x4949;
  const first = tiff + view.getUint32(tiff + 4, little);
  if (first + 2 > data.length) return null;
  const entries = view.getUint16(first, little);
  for (let i = 0; i < entries; i++) {
    const entry = first + 2 + i * 12;
    if (entry + 12 > data.length) return null;
    if (view.getUint16(entry, little) === 0x0112) return view.getUint16(entry + 8, little);
  }
  return null;
}

/** Share of the photo a frame crops away: 0 when the shapes match. */
export const cropLoss = (photoAspect, frameAspect) => 1 - Math.min(photoAspect / frameAspect, frameAspect / photoAspect);

/** Plain-language photo shape for labels. */
export function shapeName(aspect) {
  if (aspect < 0.7) return 'tall portrait';
  if (aspect < 0.9) return 'portrait';
  if (aspect < 1.1) return 'square';
  return aspect < 1.6 ? 'landscape' : 'wide';
}

/** Sizes of every photo on these articles, by path; a photo's recorded width/height wins over reading its bytes. */
export async function photoSizes(articles, loadMedia) {
  const sizes = new Map();
  for (const article of articles) for (const photo of article.photos ?? []) {
    if (!photo.path || sizes.has(photo.path)) continue;
    let size = photo.width > 0 && photo.height > 0 ? { width: photo.width, height: photo.height } : null;
    if (!size && loadMedia) {
      const bytes = await loadMedia({ root: 'issue', path: photo.path });
      size = bytes ? imageSize(bytes) : null;
    }
    if (size?.width > 0 && size?.height > 0) sizes.set(photo.path, size);
  }
  return sizes;
}

const photoSlots = (template) => template.slots.filter((s) => s.role === 'photo' && !s.asset && s.enabled !== false);
const frameOf = (slot) => (slot.rect[2] - slot.rect[0]) / (slot.rect[3] - slot.rect[1]);
const xOverlap = (a, b) => Math.max(0, Math.min(a[2], b[2]) - Math.max(a[0], b[0]));
const captionFor = (template, photo) => template.slots.find((s) => s.role === 'caption' && s.enabled !== false && (s.articleIndex ?? 0) === (photo.articleIndex ?? 0)
  && s.rect[1] >= photo.rect[3] - 1 && s.rect[1] - photo.rect[3] < 24 && xOverlap(s.rect, photo.rect) > 0.5 * (photo.rect[2] - photo.rect[0]));
const sizeOf = (slot, order, sizes) => {
  const photo = (order[slot.articleIndex ?? 0]?.photos ?? []).filter((p) => p.path)[slot.photoIndex ?? 0];
  return photo ? sizes.get(photo.path) ?? null : null;
};

/**
 * Give each photo slot the article's closest-shaped photo; the matching caption follows it.
 * Returns a template copy with explicit photoIndex values. Only photos the base template would
 * reach are reassigned when an article has more photos than slots: the better-shaped ones win.
 */
export function assignPhotos(template, order, sizes) {
  const fitted = clone(template), counts = new Map();
  for (const slot of photoSlots(fitted)) {
    const ai = slot.articleIndex ?? 0;
    if (slot.photoIndex === undefined) { slot.photoIndex = counts.get(ai) ?? 0; counts.set(ai, slot.photoIndex + 1); }
  }
  order.forEach((article, ai) => {
    const slots = photoSlots(fitted).filter((s) => (s.articleIndex ?? 0) === ai);
    const photos = (article.photos ?? []).filter((p) => p.path);
    const free = photos.map((_, index) => index);
    // Most demanding frames (furthest from square) choose first.
    for (const slot of [...slots].sort((a, b) => Math.abs(Math.log(frameOf(b))) - Math.abs(Math.log(frameOf(a))))) {
      if (!free.length) break;
      const known = free.filter((i) => sizes.has(photos[i].path));
      if (!known.length) { slot.photoIndex = free.shift(); continue; }
      const loss = (i) => { const size = sizes.get(photos[i].path); return cropLoss(size.width / size.height, frameOf(slot)); };
      const best = known.reduce((a, b) => (loss(b) < loss(a) ? b : a));
      slot.photoIndex = best;
      free.splice(free.indexOf(best), 1);
    }
    for (const slot of slots) { const caption = captionFor(fitted, slot); if (caption) caption.photoIndex = slot.photoIndex; }
  });
  return fitted;
}

/** Cheap crop and print-resolution estimate for a template with explicit photo indexes. */
export function photoReport(template, order, sizes) {
  return photoSlots(template).map((slot) => {
    const size = sizeOf(slot, order, sizes);
    if (!size) return null;
    const aspect = size.width / size.height, widthInches = (slot.rect[2] - slot.rect[0]) / 72, heightInches = (slot.rect[3] - slot.rect[1]) / 72;
    const crop = cropLoss(aspect, frameOf(slot));
    // A cover-fit photo fills the frame, so its limiting axis sets the printed resolution.
    const ppi = Math.min(size.width / Math.max(widthInches, heightInches * aspect), size.height / Math.max(heightInches, widthInches / aspect));
    return { slotId: slot.id, aspect: round(aspect), shape: shapeName(aspect), frameAspect: round(frameOf(slot)), crop: round(crop), ppi: Math.round(ppi), width: size.width, height: size.height };
  }).filter(Boolean);
}

const groupRows = (slots) => {
  const rows = [];
  for (const slot of [...slots].sort((a, b) => a.rect[1] - b.rect[1] || a.rect[0] - b.rect[0])) {
    const row = rows.find((r) => Math.abs(r[0].rect[1] - slot.rect[1]) <= 1 && Math.abs(r[0].rect[3] - slot.rect[3]) <= 1);
    if (row) row.push(slot); else rows.push([slot]);
  }
  return rows.map((row) => row.sort((a, b) => a.rect[0] - b.rect[0]));
};

function shapeRow(fitted, row, order, sizes, { contentHeight }) {
  const aspects = row.map((slot) => { const size = sizeOf(slot, order, sizes); return size ? size.width / size.height : null; });
  if (aspects.some((a) => a === null)) return null;
  const left = row[0].rect[0], right = row.at(-1).rect[2], top = row[0].rect[1], bottom = row[0].rect[3];
  const gaps = row.slice(1).reduce((sum, slot, i) => sum + slot.rect[0] - row[i].rect[2], 0);
  const span = [left, top, right, bottom], article = row[0].articleIndex ?? 0;
  const below = fitted.slots.filter((s) => !row.includes(s) && s.enabled !== false && s.rect[1] >= bottom - 1 && xOverlap(s.rect, span) > 0.5 * Math.min(right - left, s.rect[2] - s.rect[0]))
    .filter((s) => ['caption', 'body'].includes(s.role)).sort((a, b) => a.rect[1] - b.rect[1]);
  const above = fitted.slots.filter((s) => s.role === 'body' && s.enabled !== false && s.rect[3] <= top + 1 && (s.articleIndex ?? 0) === article && xOverlap(s.rect, span) > 0.5 * (right - left));
  const bodyBelow = below.find((s) => s.role === 'body');
  if (!bodyBelow && !above.length) return null;
  // A justified row: one height that lets every photo keep its own shape across the same width.
  const height = Math.min(Math.max((right - left - gaps) / aspects.reduce((a, b) => a + b, 0), ROW_HEIGHT[0]), ROW_HEIGHT[1] * contentHeight);
  const total = aspects.reduce((a, b) => a + b, 0);
  let x = left;
  row.forEach((slot, i) => {
    const width = i === row.length - 1 ? right - x : (right - left - gaps) * aspects[i] / total;
    const gap = i < row.length - 1 ? row[i + 1].rect[0] - slot.rect[2] : 0;
    const caption = captionFor(fitted, slot);
    slot._next = [x, x + width];
    slot._caption = caption;
    x += width + gap;
  });
  const delta = height - (bottom - top);
  if (bodyBelow) {
    if (bodyBelow.rect[3] - bodyBelow.rect[1] - delta < 96) return null;
    for (const slot of row) slot.rect = [slot._next[0], top, slot._next[1], top + height];
    for (const s of below) {
      if (s === bodyBelow) { s.rect = [s.rect[0], s.rect[1] + delta, s.rect[2], s.rect[3]]; break; }
      s.rect = [s.rect[0], s.rect[1] + delta, s.rect[2], s.rect[3] + delta];
    }
  } else {
    const body = above.sort((a, b) => b.rect[3] - a.rect[3])[0];
    if (body.rect[3] - body.rect[1] - delta < 96) return null;
    for (const slot of row) slot.rect = [slot._next[0], bottom - height, slot._next[1], bottom];
    body.rect = [body.rect[0], body.rect[1], body.rect[2], body.rect[3] - delta];
  }
  for (const slot of row) {
    if (slot._caption) slot._caption.rect = [slot.rect[0], slot._caption.rect[1], slot.rect[2], slot._caption.rect[3]];
    delete slot._next; delete slot._caption;
  }
  return row.map((slot) => slot.id);
}

function shapeSide(fitted, slot, order, sizes) {
  const size = sizeOf(slot, order, sizes), article = slot.articleIndex ?? 0;
  if (!size) return null;
  const body = fitted.slots.find((s) => s.role === 'body' && s.enabled !== false && (s.articleIndex ?? 0) === article);
  if (!body || xOverlap(slot.rect, body.rect) > 1) return null;
  const onLeft = slot.rect[2] <= body.rect[0], gap = onLeft ? body.rect[0] - slot.rect[2] : slot.rect[0] - body.rect[2];
  const outer = onLeft ? body.rect[2] - slot.rect[0] : slot.rect[2] - body.rect[0];
  const height = slot.rect[3] - slot.rect[1], width = height * size.width / size.height;
  if (width < SIDE_WIDTH[0] * outer || width > SIDE_WIDTH[1] * outer) return null;
  const caption = captionFor(fitted, slot);
  if (onLeft) { slot.rect = [slot.rect[0], slot.rect[1], slot.rect[0] + width, slot.rect[3]]; body.rect = [slot.rect[2] + gap, body.rect[1], body.rect[2], body.rect[3]]; }
  else { slot.rect = [slot.rect[2] - width, slot.rect[1], slot.rect[2], slot.rect[3]]; body.rect = [body.rect[0], body.rect[1], slot.rect[0] - gap, body.rect[3]]; }
  if (caption) caption.rect = [slot.rect[0], caption.rect[1], slot.rect[2], caption.rect[3]];
  body.columns = Math.max(1, Math.round((body.rect[2] - body.rect[0]) / COLUMN_WIDTH));
  return [slot.id];
}

/**
 * Reshape the layout's own photo frames: rows become justified to the photos' shapes (the body keeps
 * its far edge and gives or takes the difference) and side photos take their natural width, so a
 * wider body gains a column. Other stories, datelines and folios never move.
 * Returns {template, changes} or null when nothing changes.
 */
export function fitPhotoFrames(template, order, sizes, { contentTop = 100, contentBottom = 744 } = {}) {
  const fitted = clone(template), contentHeight = contentBottom - contentTop, changed = [];
  const bodies = fitted.slots.filter((s) => s.role === 'body' && s.enabled !== false);
  const stacked = (slot) => bodies.some((b) => (b.articleIndex ?? 0) === (slot.articleIndex ?? 0) && xOverlap(slot.rect, b.rect) > 0.5 * (slot.rect[2] - slot.rect[0]));
  const slots = photoSlots(fitted);
  for (const row of groupRows(slots.filter(stacked))) {
    const before = row.map((s) => s.rect.join());
    const ids = shapeRow(fitted, row, order, sizes, { contentHeight });
    if (ids && row.some((s, i) => s.rect.join() !== before[i])) changed.push(...ids);
  }
  for (const slot of slots.filter((s) => !stacked(s))) {
    const ids = shapeSide(fitted, slot, order, sizes);
    if (ids) changed.push(...ids);
  }
  if (!changed.length) return null;
  for (const slot of fitted.slots) slot.rect = slot.rect?.map(round);
  if (fitted.slots.some((s) => s.rect && (s.rect[2] <= s.rect[0] || s.rect[3] <= s.rect[1] || (s.role === 'body' && s.rect[3] > contentBottom + 0.01)))) return null;
  return named(fitted, template, 'shaped', 'frames shaped to the photos', changed);
}

function named(fitted, template, key, label, changed) {
  fitted.id = `${template.id}@photo-${key}`;
  fitted.name = `${template.name} · ${label}`;
  fitted.photoFit = { mode: key, slots: changed };
  return { template: fitted, changes: changed };
}

/**
 * For a photo a full-width frame would butcher (usually a portrait over wide columns): drop it into
 * the text at its exact shape, spanning whole body columns, with the copy wrapping around it.
 * side: 'right' or 'left'. size: 'large' takes the widest span that prints sharply, 'small' the narrowest,
 * which leaves a long story its room. Returns {template, changes} or null when no span suits, or when
 * 'small' would only repeat 'large'.
 */
export function insetPhotos(template, order, sizes, { side = 'right', size: reach = 'large', gutter = 12, ppi = PRINT_PPI } = {}) {
  const fitted = clone(template), changed = [];
  for (const slot of photoSlots(fitted)) {
    const article = slot.articleIndex ?? 0, size = sizeOf(slot, order, sizes);
    const body = fitted.slots.find((s) => s.role === 'body' && s.enabled !== false && (s.articleIndex ?? 0) === article);
    if (!size || !body) continue;
    const others = photoSlots(fitted).filter((s) => (s.articleIndex ?? 0) === article);
    if (others.length !== 1) continue;                                    // several photos keep their row
    const caption = captionFor(fitted, slot);
    const left = Math.min(body.rect[0], slot.rect[0]), right = Math.max(body.rect[2], slot.rect[2]);
    const top = Math.min(body.rect[1], slot.rect[1]), bottom = Math.max(body.rect[3], slot.rect[3], caption?.rect[3] ?? 0);
    const columns = Math.max(body.columns ?? 1, Math.round((right - left) / COLUMN_WIDTH));
    if (columns < 2) continue;
    const aspect = size.width / size.height, columnWidth = (right - left - gutter * (columns - 1)) / columns;
    const captionHeight = caption ? caption.rect[3] - caption.rect[1] : 0;
    const spans = [];
    for (let span = 1; span < columns; span++) {
      const width = span * columnWidth + (span - 1) * gutter, height = width / aspect;
      const share = (height + captionHeight) / (bottom - top);
      if (share < INSET_HEIGHT[0] || share > INSET_HEIGHT[1]) continue;
      spans.push({ width, height, share, sharp: size.width / (width / 72) >= ppi });
    }
    // Largest span that still prints sharply; otherwise the smallest, which is the sharpest we can offer.
    const large = spans.filter((s) => s.sharp).at(-1) ?? spans[0], pick = reach === 'small' ? spans[0] : large;
    if (!pick || (reach === 'small' && pick === large)) continue;
    const x = side === 'right' ? right - pick.width : left;
    slot.rect = [x, top, x + pick.width, top + pick.height];
    let wrapBottom = slot.rect[3];
    if (caption) {
      caption.rect = [x, slot.rect[3] + CAPTION_GAP, x + pick.width, slot.rect[3] + CAPTION_GAP + captionHeight];
      caption.ignoreWrap = true;                                          // the wrap keeps the body out, not its own caption
      wrapBottom = caption.rect[3];
    }
    body.rect = [left, top, right, bottom];
    body.columns = columns;
    fitted.slots.push({ id: `photo-wrap-${slot.id}`, role: 'wrap', offset: WRAP_OFFSET, points: [[x, top], [x + pick.width, top], [x + pick.width, wrapBottom], [x, wrapBottom]].map((p) => p.map(round)), rect: [x, top, x + pick.width, wrapBottom].map(round), articleIndex: article });
    changed.push(slot.id);
  }
  if (!changed.length) return null;
  for (const slot of fitted.slots) slot.rect = slot.rect?.map(round);
  return named(fitted, template, `inset-${side}${reach === 'small' ? '-small' : ''}`, `${reach === 'small' ? 'small ' : ''}photo inset ${side}, text wraps`, changed);
}

const CONTENT_ROLES = new Set(['headline', 'byline', 'body', 'caption', 'photo', 'ad', 'piece']);
const OVERLAP_TOLERANCE = 2;

/**
 * Pairs of content frames that sit on top of each other. Native preflight only sees overset text, so a
 * body drawn over a headline passes it. A photo or caption inside its own wrap is the point of an inset.
 */
export function layoutCollisions(template) {
  const slots = template.slots.filter((s) => s.enabled !== false && s.rect && CONTENT_ROLES.has(s.role));
  const wraps = template.slots.filter((s) => s.role === 'wrap' && s.rect);
  const wrapped = (slot) => wraps.some((w) => slot.rect[0] >= w.rect[0] - 1 && slot.rect[2] <= w.rect[2] + 1 && slot.rect[1] >= w.rect[1] - 1 && slot.rect[3] <= w.rect[3] + 1);
  const hits = [];
  slots.forEach((a, i) => slots.slice(i + 1).forEach((b) => {
    const wide = Math.min(a.rect[2], b.rect[2]) - Math.max(a.rect[0], b.rect[0]), tall = Math.min(a.rect[3], b.rect[3]) - Math.max(a.rect[1], b.rect[1]);
    if (wide <= OVERLAP_TOLERANCE || tall <= OVERLAP_TOLERANCE) return;
    const body = a.role === 'body' ? a : b.role === 'body' ? b : null, other = body === a ? b : a;
    if (body && wrapped(other)) return;
    hits.push([a.id, b.id]);
  }));
  return hits;
}

/** Every photo-led reading of one candidate: the matched original, its reshaped frames, and insets. */
export function photoLayouts(template, order, sizes, options = {}) {
  const assigned = assignPhotos(template, order, sizes);
  const out = [{ template: assigned, mode: 'as-designed' }];
  // Ads and body flows hold checked geometry: match the photos, but leave those frames where they are.
  if (template.reservationLayout || Object.values(template.bodyFlows ?? {}).some((ids) => ids.length > 1)) return out;
  const known = new Set(layoutCollisions(assigned).map(String));          // a design's own layering is not ours to judge
  const add = (result) => { if (result && layoutCollisions(result.template).every((hit) => known.has(String(hit)))) out.push({ template: result.template, mode: result.template.photoFit.mode }); };
  add(fitPhotoFrames(assigned, order, sizes, options));
  for (const side of ['right', 'left']) for (const size of ['large', 'small']) add(insetPhotos(assigned, order, sizes, { ...options, side, size }));
  return out;
}

/** Area of a body frame a wrap takes, in column-heights, so fill is measured against the space left. */
export function wrappedColumns(template, body, gutter = 12) {
  const columns = body.columns ?? 1, width = (body.rect[2] - body.rect[0] - gutter * (columns - 1)) / columns, height = body.rect[3] - body.rect[1];
  const lost = template.slots.filter((s) => s.role === 'wrap' && s.articleIndex === body.articleIndex && xOverlap(s.rect ?? [0, 0, 0, 0], body.rect) > 0)
    .reduce((sum, wrap) => sum + (Math.ceil((wrap.rect[2] - wrap.rect[0] + WRAP_OFFSET) / (width + gutter)) * (wrap.rect[3] - wrap.rect[1] + WRAP_OFFSET)) / height, 0);
  return Math.max(0.25, columns - lost);
}
