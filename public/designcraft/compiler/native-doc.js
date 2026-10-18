// Native .designcraft helpers shared by the page and issue compilers.
// Ports of _read_native/_write_native/_text_frames (native_flow.py) and
// save_metadata (interchange_metadata.py). Metadata edits never touch other
// ZIP payloads; every rewrite is checked byte-for-byte.

export const IDENTITY = [1, 0, 0, 1, 0, 0];

export async function sha256Hex(bytes) {
  const digest = await globalThis.crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

export function bytesEqual(a, b) {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

export function deepEqual(a, b) {
  if (a === b) return true;
  if (typeof a !== typeof b || a === null || b === null || typeof a !== 'object') return false;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  if (Array.isArray(a)) return a.length === b.length && a.every((v, i) => deepEqual(v, b[i]));
  const ka = Object.keys(a), kb = Object.keys(b);
  return ka.length === kb.length && ka.every((k) => Object.hasOwn(b, k) && deepEqual(a[k], b[k]));
}

export const clone = (value) => JSON.parse(JSON.stringify(value));

export async function readNative(bytes, JSZip) {
  const zip = await JSZip.loadAsync(bytes);
  const names = Object.keys(zip.files).filter((name) => !zip.files[name].dir);
  if (!names.includes('document.json')) throw new Error('Native archive needs exactly one document.json');
  const entries = new Map();
  for (const name of names) entries.set(name, await zip.file(name).async('uint8array'));
  const document = JSON.parse(new TextDecoder().decode(entries.get('document.json')));
  return { document, entries };
}

/** Replace document.json, verifying every other payload is unchanged. */
export async function writeNative(entries, document, JSZip) {
  const zip = new JSZip();
  for (const [name, payload] of entries) {
    zip.file(name, name === 'document.json' ? new TextEncoder().encode(JSON.stringify(document)) : payload);
  }
  const bytes = await zip.generateAsync({ type: 'uint8array', compression: 'DEFLATE' });
  const check = await readNative(bytes, JSZip);
  for (const [name, payload] of entries) {
    if (name !== 'document.json' && !bytesEqual(check.entries.get(name), payload)) {
      throw new Error('Native metadata change altered an asset or other ZIP payload');
    }
  }
  return bytes;
}

export function* walkItems(items, depth = 0) {
  if (depth > 64) throw new Error('Native group nesting exceeds 64');
  for (const item of items) {
    yield item;
    if (item.content?.type === 'group') yield* walkItems(item.content.items, depth + 1);
  }
}

export function storyIds(items) {
  const result = new Set();
  for (const item of walkItems(items)) if (item.content?.type === 'text') result.add(item.content.story);
  return result;
}

function multiply(left, right) {
  const [a, b, c, d, e, f] = left, [g, h, i, j, k, l] = right;
  return [a * g + c * h, b * g + d * h, a * i + c * j, b * i + d * j, a * k + c * l + e, b * k + d * l + f];
}

/** Text frames with parsed labels and their actual physical page (parent transforms included). */
export function textFrames(document) {
  const output = [];
  let pageOffset = 0;
  for (const spread of document.spreads) {
    const walk = (items, parent, depth = 0) => {
      if (depth > 64) throw new Error('Native group nesting exceeds 64');
      for (const item of items) {
        const xf = item.xf ?? IDENTITY;
        if (xf.length !== 6 || xf.some((v) => typeof v !== 'number' || !Number.isFinite(v))) throw new Error('Invalid native frame transformation');
        const transform = multiply(parent, xf);
        const content = item.content ?? {};
        if (content.type === 'group') walk(content.items, transform, depth + 1);
        else if (content.type === 'text') {
          let label = {};
          if (item.label) {
            try {
              const candidate = JSON.parse(item.label);
              if (candidate && typeof candidate === 'object' && !Array.isArray(candidate)) label = candidate;
            } catch { /* free-text label */ }
          }
          const points = (item.path?.subpaths ?? []).flatMap((part) => (part.anchors ?? []).filter((a) => 'p' in a).map((a) => a.p));
          let located = null;
          if (points.length) {
            const mapped = points.map((p) => [transform[0] * p[0] + transform[2] * p[1] + transform[4], transform[1] * p[0] + transform[3] * p[1] + transform[5]]);
            const xs = mapped.map((p) => p[0]), ys = mapped.map((p) => p[1]);
            const cx = (Math.min(...xs) + Math.max(...xs)) / 2, cy = (Math.min(...ys) + Math.max(...ys)) / 2;
            const candidates = spread.pages.map((page, i) => [page, pageOffset + i]).filter(([page]) => page.x <= cx && cx < page.x + page.width && cy >= 0 && cy < page.height);
            if (candidates.length === 1) located = candidates[0][1];
          }
          output.push({ item, label, pageIndex: located });
        }
      }
    };
    walk(spread.items, IDENTITY);
    pageOffset += spread.pages.length;
  }
  const ids = output.map((f) => f.item.id);
  if (new Set(ids).size !== ids.length) throw new Error('Native text frame IDs are not unique');
  return output;
}

function pageStories(document) {
  const pages = document.spreads.flatMap((spread) => spread.pages.map(() => []));
  for (const frame of textFrames(document)) {
    if (frame.pageIndex !== null) pages[frame.pageIndex].push(document.stories[String(frame.item.content.story)].text);
  }
  return pages.map((stories) => stories.sort(codePointCompare));
}

// Python sorts strings by code point; JS's default sort compares UTF-16 units.
export function codePointCompare(a, b) {
  const x = [...a], y = [...b];
  for (let i = 0; i < Math.min(x.length, y.length); i++) {
    const d = x[i].codePointAt(0) - y[i].codePointAt(0);
    if (d) return d;
  }
  return x.length - y.length;
}

const SECTION_STYLES = new Set(['arabic', 'upperRoman', 'lowerRoman', 'upperLetters', 'lowerLetters', 'arabicLeadingZero', 'arabicThreeDigits', 'arabicFourDigits', 'symbols']);

function validateSections(sections, pageCount) {
  if (!Array.isArray(sections)) throw new Error('Interchange sections must be a list');
  const starts = [];
  for (const section of sections) {
    if (!section || typeof section !== 'object') throw new Error('Invalid interchange numbering section');
    if (!Number.isInteger(section.start) || section.start < 0 || section.start >= pageCount) throw new Error('Interchange section starts outside the document');
    const number = section.startNumber;
    if (number !== undefined && number !== null && (!Number.isInteger(number) || number < 0 || number > 2 ** 32 - 1)) throw new Error('Invalid interchange section start number');
    if (!SECTION_STYLES.has(section.style ?? 'arabic')) throw new Error('Unsupported interchange section numbering style');
    if (['prefix', 'marker'].some((key) => key in section && typeof section[key] !== 'string')) throw new Error('Invalid interchange section text');
    if ('includePrefix' in section && typeof section.includePrefix !== 'boolean') throw new Error('Invalid interchange section prefix option');
    starts.push(section.start);
  }
  if (starts.some((s, i) => i && s <= starts[i - 1])) throw new Error('Interchange numbering sections must have unique ordered starts');
}

/** The interchange sidecar (URL links, parent overrides, numbering, frame labels). */
export function interchangeMetadata(document) {
  const hyperlinks = (document.hyperlinks ?? []).map((link) => {
    if (link.source.kind !== 'text' || link.dest.kind !== 'url') throw new Error('Unsupported interchange hyperlink type');
    const sid = link.source.story;
    return { story: sid, text: document.stories[String(sid)].text, link };
  });
  const pages = document.spreads.flatMap((spread) => spread.pages.map((p) => ({
    id: p.id, parent: p.parent ?? null, width: p.width, height: p.height,
    overridden: p.overridden ?? [], showParentItems: p.showParentItems ?? true,
  })));
  const frames = textFrames(document);
  const key = (frame) => JSON.stringify([frame.item.name ?? null, frame.pageIndex, document.stories[String(frame.item.content.story)].text]);
  const labelled = [];
  for (const frame of frames) {
    if (!frame.item.label) continue;
    if (frames.filter((candidate) => key(candidate) === key(frame)).length !== 1) throw new Error('Cannot preserve an ambiguous native text-frame label');
    labelled.push({ name: frame.item.name ?? null, pageIndex: frame.pageIndex, text: document.stories[String(frame.item.content.story)].text, label: frame.item.label });
  }
  const sections = clone(document.sections ?? []);
  validateSections(sections, pages.length);
  return {
    schemaVersion: 'ote.interchange.metadata.v1', idmlHyperlinksSupported: false, hyperlinks,
    parentOverrides: pages, sections, sectionPageStories: pageStories(document), textFrameLabels: labelled,
  };
}
