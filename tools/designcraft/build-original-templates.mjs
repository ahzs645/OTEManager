#!/usr/bin/env node
// Recreate the original OTE paper designs as template families.
//
//   node tools/designcraft/build-original-templates.mjs --source /path/to/extracted/OneDrive_2026-10-09 \
//        --cli /path/to/designcraft-cli --fonts /path/to/private/original-fonts
//
// For each season, the source InDesign IDML is opened in DesignCraft (with its
// Links and the original fonts). The parent design is flattened onto a blank
// left and right page, and each cover is taken from page 1. Per-issue content
// (dates, volume/issue lines, cover photo, feature numbers and titles) is lifted
// out into slots that keep its exact geometry and typography; everything else
// is exported as a vector design snippet, once with the original fonts and once
// with open substitutes. The 76 story arrangements are then mapped into each
// season's content frame and set in that season's house styles.
// Outputs: public/designcraft/original-art/*.designcraft and the `designs` and
// design templates in public/designcraft/templates.json (regenerated in place).
import { execFile } from 'node:child_process';
import { copyFile, mkdir, mkdtemp, readFile, readdir, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { createRequire } from 'node:module';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const require = createRequire(join(ROOT, 'package.json'));
const JSZip = require('jszip');
const run = promisify(execFile);
const arg = (name) => { const i = process.argv.indexOf('--' + name); return i > 0 ? process.argv[i + 1] : undefined; };
const SOURCE = arg('source'), CLI = arg('cli'), FONTS = arg('fonts');
if (!SOURCE || !CLI || !FONTS) throw new Error('Usage: --source <extracted archive> --cli <designcraft-cli> --fonts <original font dir>');
const OUT = join(ROOT, 'public/designcraft'), ART = 'original-art';
const CLASSIC_AREA = [36, 100, 720, 744];
const MONTHS = 'January|February|March|April|May|June|July|August|September|October|November|December';
const WEEKDAYS = 'Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday';

// Open look-alikes for portable builds (see docs/DESIGNCRAFT-ORIGINALS.md for the comparison).
const HN = { Regular: ['TeX Gyre Heros', 'Regular'], Bold: ['TeX Gyre Heros', 'Bold'], Italic: ['TeX Gyre Heros', 'Italic'], 'Bold Italic': ['TeX Gyre Heros', 'Bold Italic'],
  Medium: ['TeX Gyre Heros', 'Regular'], 'Medium Italic': ['TeX Gyre Heros', 'Italic'], Light: ['TeX Gyre Heros', 'Regular'], Heavy: ['TeX Gyre Heros', 'Bold'],
  Oblique: ['TeX Gyre Heros', 'Italic'], 'Condensed Black': ['TeX Gyre Heros Cn', 'Bold'], 'Condensed Bold': ['TeX Gyre Heros Cn', 'Bold'] };
const PORTABLE = {};
for (const family of ['Helvetica Neue', 'Helvetica Neue (TT)', 'Helvetica Neue (OTF)', 'Helvetica']) for (const [face, to] of Object.entries(HN)) PORTABLE[`${family}|${face}`] = to;
Object.assign(PORTABLE, {
  'Decalotype|Black': ['Barlow', 'Black'], 'Decalotype|Bold': ['Barlow', 'ExtraBold'], 'Decalotype|Medium': ['Barlow', 'SemiBold'],
  'Salted|Regular': ['Caveat Brush', 'Regular'], 'Wordy Diva|Regular': ['Caveat Brush', 'Regular'],
  'Kefa|Regular': ['TeX Gyre Heros', 'Regular'], 'Kefa|Bold': ['TeX Gyre Heros', 'Bold'], 'Minion Pro|Regular': ['Source Serif 4', 'Regular'],
});

const FAMILIES = {
  'ote-2024': {
    name: 'OTE 2024–25', description: 'Fall 2024 – Winter 2025 design, from Issue 7 (March 2025): green header bar, solid frame, masthead cover with numbered feature boxes.',
    idml: 'Indesign Template/Fall 2024- Winter 2025/Issue 7 March 2025/Issue 7 March 2025 Folder/Issue 7 March 2025.idml',
    pages: { left: 3, right: 2, cover: 0 }, numbering: 'arabic', dateline: '{WEEKDAY}, {MONTH} {D}, {YYYY}',
    swatches: [{ name: 'OTE 2024 Green', color: { model: 'rgb', r: 45 / 255, g: 104 / 255, b: 83 / 255 } }],
    styles: {
      'OTE Headline': { fontFamily: 'Decalotype', fontStyle: 'Black', size: 24, leading: 25 },
      'OTE Body': { fontFamily: 'Helvetica Neue', fontStyle: 'Regular', size: 10, leading: 15 },
      'OTE Byline': { fontFamily: 'Helvetica Neue', fontStyle: 'Bold', size: 8, leading: 11, chars: { tracking: 60, capitalization: 'allCaps', fill: 'OTE 2024 Green' } },
      'OTE Caption': { fontFamily: 'Helvetica Neue', fontStyle: 'Italic', size: 8, leading: 10 },
      'OTE Label': { fontFamily: 'Helvetica Neue', fontStyle: 'Bold', size: 12, leading: 15 },
      'OTE Quote': { fontFamily: 'Helvetica Neue', fontStyle: 'Italic', size: 10, leading: 15 },
      ...headings('Helvetica Neue', 'Bold'),
    },
    cover: [
      { match: (t) => /^volume \d+ \| issue \d+/i.test(t.text), slot: { id: 'cover-volume-issue', field: 'volumeIssue', format: 'Volume {volume} | Issue {number}' } },
      { match: (t) => new RegExp(`^(${MONTHS})$`, 'i').test(t.text), slot: { id: 'cover-month', field: 'month', format: '{Month}' } },
      { match: (t) => new RegExp(`^(${WEEKDAYS})$`, 'i').test(t.text), slot: { id: 'cover-weekday', field: 'weekday', format: '{Weekday}' } },
      { match: (t) => /^\d{4}$/.test(t.text), slot: { id: 'cover-year', field: 'year', format: '{YYYY}' } },
      { match: (t) => /^\d{1,2}$/.test(t.text) && t.box[1] < 200, slot: { id: 'cover-day', field: 'day', format: '{D}' } },
      { match: (t) => /^\d{1,2}$/.test(t.text) && t.box[1] > 600, card: 'number', order: 'x' },
      { match: (t) => t.box[1] > 600 && t.text.length > 3, card: 'title', order: 'x' },
    ],
  },
  'ote-2025': {
    name: 'OTE 2025–26', description: '2025 – 2026 design, from Issue 2 (October 2025): dark green header bar, dashed frame, framed-photo cover with handwritten issue line and numbered feature list.',
    idml: "Indesign Template/2025-2026 Ahmad's Version/Issue 2/Issue 2 October 2025 Folder/Issue 2 October 2025.idml",
    pages: { left: 1, right: 2, cover: 0 }, numbering: 'arabicLeadingZero', dateline: '{MONTH} {D}, {YYYY}',
    swatches: [{ name: 'OTE 2025 Green', color: { model: 'rgb', r: 21 / 255, g: 83 / 255, b: 41 / 255 } },
      { name: 'OTE 2025 Ink Green', color: { model: 'cmyk', c: 0.87, m: 0.40, y: 0.99, k: 0.41 } }],
    styles: {
      'OTE Headline': { fontFamily: 'Decalotype', fontStyle: 'Black', size: 24, leading: 25 },
      'OTE Body': { fontFamily: 'Helvetica Neue', fontStyle: 'Medium', size: 9.5, leading: 14.5 },
      'OTE Byline': { fontFamily: 'Salted', fontStyle: 'Regular', size: 13, leading: 14, chars: { fill: 'OTE 2025 Ink Green' } },
      'OTE Caption': { fontFamily: 'Helvetica Neue', fontStyle: 'Medium Italic', size: 8, leading: 11 },
      'OTE Label': { fontFamily: 'Helvetica Neue', fontStyle: 'Bold', size: 12, leading: 15 },
      'OTE Quote': { fontFamily: 'Helvetica Neue', fontStyle: 'Medium Italic', size: 10, leading: 15 },
      ...headings('Helvetica Neue', 'Bold'),
    },
    cover: [
      { match: (t) => new RegExp(`^(${MONTHS}) \\d+(st|nd|rd|th)$`, 'i').test(t.text), slot: { id: 'cover-date', field: 'date', format: '{Month} {Dth}' } },
      { match: (t) => /^\d{4}$/.test(t.text), slot: { id: 'cover-year', field: 'year', format: '{YYYY}' } },
      { match: (t) => /^issue \d+$/i.test(t.text), slot: { id: 'cover-issue', field: 'number', format: 'issue {number}' } },
      { match: (t) => /^volume \(\d+\)$/i.test(t.text), slot: { id: 'cover-volume', field: 'volume', format: 'volume ({volume})' } },
      { match: (t) => /^over the edge is here!$/i.test(t.text), slot: { id: 'cover-line', field: 'coverLine' } },
      { match: (t) => /^\d{1,2}$/.test(t.text) && t.box[1] > 500, card: 'number', order: 'y' },
      { match: (t) => t.box[1] > 500 && t.box[0] > 400 && t.text.length > 3, card: 'title', order: 'y' },
    ],
  },
};

function headings(fontFamily, fontStyle) {
  return Object.fromEntries([1, 2, 3, 4, 5, 6].map((level) => { const size = { 1: 18, 2: 16, 3: 14, 4: 12, 5: 11, 6: 10 }[level]; return ['OTE Heading ' + level, { fontFamily, fontStyle, size, leading: size * 1.2 }]; }));
}

async function script(lines, options = []) {
  const dir = await mkdtemp(join(tmpdir(), 'ote-originals-'));
  const file = join(dir, 'build.dcs');
  await writeFile(file, lines.map((l) => (typeof l === 'string' ? l : l[0] + ' ' + JSON.stringify(l[1]))).join('\n') + '\n');
  try {
    const { stdout } = await run(CLI, ['script', file, ...options], { maxBuffer: 1 << 30, timeout: 600000 });
    const report = JSON.parse(stdout);
    if (report.error) throw new Error(report.error);
    return report.results;
  } finally { await rm(dir, { recursive: true, force: true }); }
}

const nativeDoc = async (path) => JSON.parse(await (await JSZip.loadAsync(await readFile(path))).file('document.json').async('string'));
const mul = (a, b) => [a[0] * b[0] + a[2] * b[1], a[1] * b[0] + a[3] * b[1], a[0] * b[2] + a[2] * b[3], a[1] * b[2] + a[3] * b[3], a[0] * b[4] + a[2] * b[5] + a[4], a[1] * b[4] + a[3] * b[5] + a[5]];
function bbox(item, xf) {
  const pts = (item.path?.subpaths ?? []).flatMap((s) => (s.anchors ?? []).filter((a) => a.p).map((a) => a.p));
  if (!pts.length) return null;
  const m = pts.map(([x, y]) => [xf[0] * x + xf[2] * y + xf[4], xf[1] * x + xf[3] * y + xf[5]]);
  return [Math.min(...m.map((p) => p[0])), Math.min(...m.map((p) => p[1])), Math.max(...m.map((p) => p[0])), Math.max(...m.map((p) => p[1]))];
}
/** Every item on a spread with its absolute box, depth and parent. */
function items(spread) {
  const out = [];
  const walk = (list, xf, depth, parent) => {
    for (const item of list) {
      const t = mul(xf, item.xf ?? [1, 0, 0, 1, 0, 0]);
      const kids = item.content?.type === 'group' ? item.content.items : [];
      let box = bbox(item, t);
      const record = { item, depth, parent, box };
      out.push(record);
      if (kids.length) {
        const before = out.length;
        walk(kids, t, depth + 1, record);
        const childBoxes = out.slice(before).map((r) => r.box).filter(Boolean);
        if (!box && childBoxes.length) record.box = [Math.min(...childBoxes.map((b) => b[0])), Math.min(...childBoxes.map((b) => b[1])), Math.max(...childBoxes.map((b) => b[2])), Math.max(...childBoxes.map((b) => b[3]))];
      }
    }
  };
  walk(spread.items, [1, 0, 0, 1, 0, 0], 0, null);
  return out;
}
const round = (b) => b.map((v) => Math.round(v * 100) / 100);
/** Keep a captured text frame on the page without moving its text: centred text keeps its centre, aligned text its edge. */
function clampText(box, align, width, height, style, widen = true, lines = 1) {
  // InDesign fitted these frames to their exact text; DesignCraft composes a little differently.
  // Give field frames room away from the aligned edge (and below), so the text itself does not move.
  // A one-line field (lines = 0.5) gets only half a line of slack, so longer text steps down to fit
  // (fitCoverTitles) instead of wrapping out of its place in the design.
  let [x, y, r, b] = box;
  if (style) {
    const grow = widen ? Math.max(12, (r - x) * 0.3) : 0;
    if (align === 'center') { x -= grow / 2; r += grow / 2; } else if (align === 'right') x -= grow; else r += grow;
    b += style.leading * lines;
  }
  if (align === 'center') { const c = (x + r) / 2, half = Math.min((r - x) / 2, c, width - c); [x, r] = [c - half, c + half]; }
  else if (align === 'right') { r = Math.min(r, width); x = Math.max(0, x); }
  else { x = Math.max(0, x); r = Math.min(r, width); }
  return round([x, Math.max(0, y), r, Math.min(b, height)]);
}
const normalFamily = (f) => String(f ?? 'Helvetica Neue').replace(/ \((TT|OTF)\)$/, '');

/** Captured typography of a text frame: first run and first paragraph. */
function captureStyle(doc, item, swatchNames, which = 'longest') {
  const story = doc.stories[String(item.content.story)];
  // Fields take their longest run; mixed-weight titles take their lead-in run (a generated
  // headline cannot know which words the original emphasised).
  const runs = story.chars ?? [];
  const run = (which === 'first' ? runs[0] : runs.reduce((a, b) => (b.len > (a?.len ?? -1) ? b : a), null))?.over ?? {};
  const para = story.paras?.[0]?.para ?? {};
  const size = run.size ?? 12;
  const leading = run.leading?.kind === 'points' ? run.leading.value : size * 1.2;
  const chars = {};
  if (run.tracking) chars.tracking = run.tracking;
  if (run.capitalization && run.capitalization !== 'normal') chars.capitalization = run.capitalization;
  if (run.fill && run.fill !== '[Black]') { chars.fill = run.fill; swatchNames.add(run.fill); }
  // Captured display lines were set without hyphenation in the originals.
  return { fontFamily: normalFamily(run.fontFamily), fontStyle: run.fontStyle ?? 'Regular', size, leading, chars, para: { ...(para.align ? { align: para.align } : {}), hyphenate: false } };
}

/** How the original photo was framed: the image point at the frame centre (fractions) and the zoom beyond a fill. */
function originalCrop(item) {
  const local = bbox(item, [1, 0, 0, 1, 0, 0]), g = item.content, [s, , , d, tx, ty] = g.xf ?? [1, 0, 0, 1, 0, 0], [iw, ih] = g.size ?? [0, 0];
  if (!local || !iw || !ih || !s || !d) return { focus: { x: 0.5, y: 0.5 } };
  const clamp = (v) => Math.round(Math.min(1, Math.max(0, v)) * 1000) / 1000;
  const fill = Math.max((local[2] - local[0]) / iw, (local[3] - local[1]) / ih), zoom = Math.round(Math.max(1, s / fill) * 1000) / 1000;
  return { focus: { x: clamp(((local[0] + local[2]) / 2 - tx) / s / iw), y: clamp(((local[1] + local[3]) / 2 - ty) / d / ih) }, ...(zoom > 1.001 ? { zoom } : {}) };
}

function swatchDefs(doc, names) {
  const out = [];
  for (const name of names) {
    if (name.startsWith('[')) continue;
    const sw = doc.swatches.find((s) => s.name === name);
    if (sw?.value?.color) out.push({ name, color: sw.value.color });
  }
  return out;
}

async function fontsIn(native) {
  const [list] = await script([['font.list', {}]], ['--in', native]);
  return list.map((f) => [f.family, f.style]);
}

/** Export selected page items as two snippets: original fonts and open substitutes. */
// DesignCraft draws InDesign's built-in "Dashed" style (an empty pattern) as solid; InDesign's
// default is a dash and gap of six times the weight (measured: 12.1/12.1 at 2 pt in the PDF).
function dashFixes(doc) {
  const fixes = [];
  const walk = (list) => { for (const item of list) { const st = item.stroke; if (st?.type?.kind === 'dashed' && !(st.type.pattern ?? []).length) fixes.push(['object.stroke', { ids: [item.id], type: { kind: 'dashed', pattern: [6 * st.weight, 6 * st.weight] } }]); if (item.content?.type === 'group') walk(item.content.items); } };
  for (const spread of doc.spreads) walk(spread.items);
  return fixes;
}

// Snippets keep their page coordinates: items of a right-hand page move onto x = 0 first.
// DesignCraft cannot draw embedded EPS artwork (the 2024 cover's ghost-logo background):
// convert each to vector PDF with Ghostscript and place it back into its frame.
async function epsFixes(native, doc, ids) {
  const zip = await JSZip.loadAsync(await readFile(native));
  const wanted = new Set(ids), fixes = [];
  const walk = async (list, inside) => {
    for (const item of list) {
      const keep = inside || wanted.has(item.id);
      if (keep && item.content?.type === 'graphic' && doc.assets?.[String(item.content.asset)]?.mime === 'application/postscript') {
        const entry = Object.keys(zip.files).find((n) => n.startsWith(`assets/${item.content.asset}.`));
        const eps = join(dirname(native), `eps-${item.id}.eps`), pdf = eps.replace(/\.eps$/, '.pdf');
        await writeFile(eps, await zip.file(entry).async('uint8array'));
        await run('gs', ['-q', '-dNOPAUSE', '-dBATCH', '-dEPSCrop', '-sDEVICE=pdfwrite', '-o', pdf, eps]);
        fixes.push(['file.place', { path: pdf, frame: item.id }], ['links.embed', { asset: '$last.asset' }]);
      }
      if (item.content?.type === 'group') await walk(item.content.items, keep);
    }
  };
  for (const spread of doc.spreads) await walk(spread.items, false);
  return fixes;
}

async function exportArt(native, ids, name, removeIds, fixes = [], dx = 0) {
  const original = join(OUT, ART, name + '.designcraft'), portable = join(OUT, ART, name + '-portable.designcraft');
  const fonts = await fontsIn(native);
  const replace = fonts.map(([f, s]) => PORTABLE[`${f}|${s}`] && ['font.replace', { family: f, style: s, toFamily: PORTABLE[`${f}|${s}`][0], toStyle: PORTABLE[`${f}|${s}`][1] }]).filter(Boolean);
  const clear = removeIds.length ? [['edit.clear', { ids: removeIds }]] : [];
  const move = dx ? [['transform.move', { dx, dy: 0, ids }]] : [];
  await script([...fixes, ...clear, ...move, ['selection.set', { ids }], ['snippet.export', { path: original }], ...replace, ['selection.set', { ids }], ['snippet.export', { path: portable }]], ['--in', native]);
  return { original: `${ART}/${name}.designcraft`, portable: `${ART}/${name}-portable.designcraft` };
}

async function buildFamily(id, config, work) {
  const sourceIdml = join(SOURCE, config.idml);
  const dir = join(work, id);
  await mkdir(join(dir, 'Document Fonts'), { recursive: true });
  await copyFile(sourceIdml, join(dir, 'source.idml'));
  await symlink(join(dirname(sourceIdml), 'Links'), join(dir, 'Links'));
  for (const font of await readdir(FONTS)) await copyFile(join(FONTS, font), join(dir, 'Document Fonts', font));
  // The open substitutes too, so font.replace can target them for the portable snippets.
  const open = join(OUT, 'assets/fonts');
  for (const font of (await readdir(open)).filter((f) => /\.(ttf|otf)$/i.test(f))) await copyFile(join(open, font), join(dir, 'Document Fonts', font));
  const imported = join(dir, 'source.designcraft');
  await script([['preflight.run', {}]], ['--in', join(dir, 'source.idml'), '--save', imported]);
  const { left, right, cover } = config.pages;
  const flat = join(dir, 'flat.designcraft');
  await script([left, right].flatMap((page) => [['layout.overrideParentItems', { page }], ['layout.detachAll', { page }]]), ['--in', imported, '--save', flat]);
  const doc = await nativeDoc(flat);
  const located = doc.spreads.flatMap((spread, si) => spread.pages.map((page) => ({ si, page })));
  const swatchNames = new Set();
  const family = { name: config.name, description: config.description, source: config.idml, numbering: config.numbering, art: {}, styles: config.styles, fonts: { portable: PORTABLE } };
  const slots = { left: [], right: [], cover: [] };
  let contentBox = null;
  for (const side of ['left', 'right']) {
    const { si, page } = located[config.pages[side]];
    const all = items(doc.spreads[si]).filter((r) => r.box && !r.item.hidden && (r.box[0] + r.box[2]) / 2 >= page.x && (r.box[0] + r.box[2]) / 2 < page.x + page.width);
    const top = all.filter((r) => r.depth === 0);
    const dates = all.filter((r) => r.item.content?.type === 'text' && /\d{4}\s*$/.test(doc.stories[String(r.item.content.story)].text));
    for (const date of dates) {
      slots[side].push({ id: 'dateline-' + side, role: 'text', side, field: 'issueDate', format: config.dateline,
        text: doc.stories[String(date.item.content.story)].text, style: captureStyle(doc, date.item, swatchNames) });
      const slot = slots[side].at(-1);
      slot.rect = clampText([date.box[0] - page.x, date.box[1], date.box[2] - page.x, date.box[3]], slot.style.para.align, page.width, page.height, slot.style);
    }
    // The content frame is the page's largest stroked rectangle.
    const frame = top.filter((r) => r.item.content?.type === 'unassigned' && r.item.stroke?.swatch && r.item.stroke.swatch !== '[None]')
      .sort((a, b) => (b.box[2] - b.box[0]) * (b.box[3] - b.box[1]) - (a.box[2] - a.box[0]) * (a.box[3] - a.box[1]))[0];
    contentBox ??= round([frame.box[0] - page.x + 12, frame.box[1] + 12, frame.box[2] - page.x - 12, frame.box[3] - 12]);
    const visibleTop = top.filter((r) => !r.item.hidden);
    family.art[side] = await exportArt(flat, visibleTop.map((r) => r.item.id), `${id}-${side}`, dates.map((d) => d.item.id), [...dashFixes(doc), ...(await epsFixes(flat, doc, visibleTop.map((r) => r.item.id)))], -page.x);
  }
  // Cover: page items and parent items of page 1, without per-issue content.
  const coverFlat = join(dir, 'cover.designcraft');
  await script([['layout.overrideParentItems', { page: cover }], ['layout.detachAll', { page: cover }]], ['--in', imported, '--save', coverFlat]);
  const cdoc = await nativeDoc(coverFlat);
  const { si, page } = cdoc.spreads.flatMap((spread, i) => spread.pages.map((p) => ({ si: i, page: p })))[cover];
  const all = items(cdoc.spreads[si]).filter((r) => r.box && (r.box[0] + r.box[2]) / 2 >= page.x && (r.box[0] + r.box[2]) / 2 < page.x + page.width);
  const area = (b) => (b[2] - b[0]) * (b[3] - b[1]);
  const graphics = all.filter((r) => r.item.content?.type === 'graphic' && !r.item.hidden);
  const background = graphics.filter((r) => area(r.box) > 0.9 * page.width * page.height);
  const photo = graphics.filter((r) => !background.includes(r)).sort((a, b) => area(b.box) - area(a.box))[0];
  const remove = graphics.filter((r) => !background.includes(r)).map((r) => r.item.id);
  const photoSlot = { id: 'cover-photo', role: 'photo', rect: round([photo.box[0] - page.x, photo.box[1], photo.box[2] - page.x, photo.box[3]]), fit: 'cover', ...originalCrop(photo.item) };
  if (photo.item.stroke?.swatch && photo.item.stroke.swatch !== '[None]') { photoSlot.stroke = { swatch: photo.item.stroke.swatch, weight: photo.item.stroke.weight }; swatchNames.add(photo.item.stroke.swatch); }
  slots.cover.push(photoSlot);
  const texts = all.filter((r) => r.item.content?.type === 'text' && !r.item.hidden).map((r) => ({ r, text: cdoc.stories[String(r.item.content.story)].text.trim(), box: [r.box[0] - page.x, r.box[1], r.box[2] - page.x, r.box[3]] })).filter((t) => t.text);
  const cards = { number: [], title: [] };
  for (const t of texts) {
    const rule = config.cover.find((rule) => rule.match(t));
    if (!rule) continue;
    remove.push(t.r.item.id);
    const style = captureStyle(cdoc, t.r.item, swatchNames, rule.card === 'title' ? 'first' : 'longest');
    if (rule.card) { cards[rule.card].push({ t, style, order: rule.order }); continue; }
    slots.cover.push({ ...rule.slot, role: 'text', text: t.text, rect: clampText(t.box, style.para.align, page.width, page.height, style, true, rule.slot.field === 'coverLine' ? 0.5 : 1), style });
  }
  for (const kind of ['number', 'title']) {
    cards[kind].sort((a, b) => (a.order === 'x' ? a.t.box[0] - b.t.box[0] : a.t.box[1] - b.t.box[1])).forEach(({ t, style }, i) => {
      slots.cover.push(kind === 'number'
        ? { id: `cover-card-${i + 1}`, role: 'text', cardPart: 'number', numbering: config.numbering, articleIndex: i, text: t.text, rect: clampText(t.box, style.para.align, page.width, page.height, style), style }
        : { id: `cover-title-${i + 1}`, role: 'text', field: 'featureTitle', articleIndex: i, text: t.text, rect: clampText(t.box, style.para.align, page.width, page.height, style, false), style });
    });
  }
  // Stacking order: design items above the photo (doodles, stickers) form an over layer placed after the slots.
  const topLevel = all.filter((r) => r.depth === 0);
  let photoTop = photo; while (photoTop.parent) photoTop = photoTop.parent;
  const photoIndex = topLevel.indexOf(photoTop);
  const keep = topLevel.filter((r) => !r.item.hidden && !remove.includes(r.item.id));
  const overlapsPhoto = (b) => Math.min(b[2], photo.box[2]) > Math.max(b[0], photo.box[0]) && Math.min(b[3], photo.box[3]) > Math.max(b[1], photo.box[1]);
  const over = keep.filter((r) => topLevel.indexOf(r) > photoIndex && overlapsPhoto(r.box) && area(r.box) < 0.5 * area(photo.box));
  const under = keep.filter((r) => !over.includes(r));
  const fixes = [...dashFixes(cdoc), ...(await epsFixes(coverFlat, cdoc, keep.map((r) => r.item.id)))];
  family.art.cover = await exportArt(coverFlat, under.map((r) => r.item.id), `${id}-cover`, remove, fixes, -page.x);
  if (over.length) family.art.cover.over = await exportArt(coverFlat, over.map((r) => r.item.id), `${id}-cover-over`, remove, fixes, -page.x);
  family.swatches = [...config.swatches, ...swatchDefs({ swatches: [...doc.swatches, ...cdoc.swatches] }, swatchNames).filter((s, i, list) => list.findIndex((o) => o.name === s.name) === i)];
  family.content = contentBox;
  return { family, slots };
}

function mapRect([x, y, r, b], box) {
  const sx = (box[2] - box[0]) / (CLASSIC_AREA[2] - CLASSIC_AREA[0]), sy = (box[3] - box[1]) / (CLASSIC_AREA[3] - CLASSIC_AREA[1]);
  return round([box[0] + (x - CLASSIC_AREA[0]) * sx, box[1] + (y - CLASSIC_AREA[1]) * sy, box[0] + (r - CLASSIC_AREA[0]) * sx, box[1] + (b - CLASSIC_AREA[1]) * sy]);
}

async function main() {
  const libraryPath = join(OUT, 'templates.json');
  const library = JSON.parse(await readFile(libraryPath, 'utf8'));
  library.templates = library.templates.filter((t) => !t.design || !FAMILIES[t.design]);
  library.designs = {};
  await mkdir(join(OUT, ART), { recursive: true });
  const work = await mkdtemp(join(tmpdir(), 'ote-originals-work-'));
  try {
    for (const [id, config] of Object.entries(FAMILIES)) {
      const { family, slots } = await buildFamily(id, config, work);
      library.designs[id] = family;
      library.templates.push({ id: `${id}-cover`, name: `${family.name} · Cover`, kind: 'cover', design: id, art: 'cover', storyCount: 0, photoCount: 1, slots: slots.cover });
      for (const classic of library.templates.filter((t) => t.kind === 'story' && !t.design)) {
        library.templates.push({
          ...classic, id: `${id}-${classic.id}`, name: `${family.name} · ${classic.name}`, design: id, art: 'interior',
          slots: [...classic.slots.filter((s) => s.role !== 'folio').map((s) => ({ ...s, rect: mapRect(s.rect, family.content) })), ...slots.left, ...slots.right],
        });
      }
      console.log(id, 'content', family.content, 'cover slots', slots.cover.map((s) => s.id).join(','), 'swatches', family.swatches.map((s) => s.name).join(', '));
    }
  } finally { await rm(work, { recursive: true, force: true }); }
  await writeFile(libraryPath, JSON.stringify(library, null, 2) + '\n');
  console.log('templates', library.templates.length, 'designs', Object.keys(library.designs).join(', '));
}

await main();
