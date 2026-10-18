// Run compiler command steps in the headless DesignCraft WebAssembly engine.
// Each run is a fresh session, like one `designcraft-cli script` process.
// Symbolic files (see page-compiler.js) map to in-memory byte commands; the
// step count never changes, so "$N.path" references stay valid.

const NOOP = { command: 'file.presets', params: {} };
const FONT = /\.(ttf|otf|ttc|otc)$/i;

export function bytesToBase64(bytes) {
  if (typeof Buffer !== 'undefined') return Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength).toString('base64');
  let binary = '';
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
  return btoa(binary);
}

export function base64ToBytes(text) {
  if (typeof Buffer !== 'undefined') return new Uint8Array(Buffer.from(text, 'base64'));
  const binary = atob(text), bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

/** Engine: the wasm-bindgen Engine class from designcraft_headless.js, already initialised. */
export function wasmExecutor(Engine) {
  const loadedFonts = new Set();
  return {
    kind: 'wasm',
    version: `designcraft-headless ${Engine.version()} (WebAssembly)`,
    async run(steps, { doc = null, media = new Map(), fonts = [] } = {}) {
      for (const font of fonts) {
        if (FONT.test(font.name) && !loadedFonts.has(font.name)) { Engine.addFont(font.bytes); loadedFonts.add(font.name); }
      }
      let open = false, docStep = -1;
      const exports = new Map();
      const mapped = steps.map((step, index) => {
        const { command } = step, params = { ...step.params };
        const path = typeof params.path === 'string' ? params.path : '';
        if (command === 'file.new' || command === 'file.openBytes') open = true;
        if (path === '@doc' && command === 'file.open') {
          if (open) return NOOP;
          if (!doc) throw new Error('No working document to open');
          open = true;
          return { command: 'file.openBytes', params: { name: 'page.designcraft', base64: bytesToBase64(doc) } };
        }
        if (path === '@doc' && command === 'file.saveAs') { docStep = index; return { command: 'file.serialize', params: {} }; }
        if (path.startsWith('@media:')) {
          const name = path.slice(7), bytes = media.get(name);
          if (!bytes) throw new Error('Missing media for ' + name);
          delete params.path;
          return { command, params: { ...params, base64: bytesToBase64(bytes), name } };
        }
        if (path.startsWith('@out:')) { exports.set(index, path.slice(5)); delete params.path; }
        else if (path.startsWith('@')) throw new Error('Unknown symbolic path ' + path);
        return { command, params };
      });
      const engine = new Engine();
      let report;
      try {
        report = JSON.parse(engine.runScript(mapped.map((s) => s.command + ' ' + JSON.stringify(s.params)).join('\n') + '\n', false));
      } finally {
        engine.free();
      }
      if (report.error) throw new Error('DesignCraft command failed: ' + String(report.error).slice(0, 800));
      const outputs = {};
      for (const [index, name] of exports) {
        outputs[name] = base64ToBytes(report.results[index].base64);
        report.results[index] = { ...report.results[index], base64: undefined, path: '@out:' + name };
      }
      let saved = null;
      if (docStep >= 0) {
        saved = base64ToBytes(report.results[docStep].base64);
        report.results[docStep] = { path: '@doc', bytes: saved.length };
      }
      return { results: report.results, doc: saved ?? doc, outputs };
    },
    /** A page of a native document as PNG (scale = pixels per point). */
    async renderPng(doc, { page = 0, scale = 0.25 } = {}) {
      const engine = new Engine();
      try {
        engine.execute('file.openBytes', JSON.stringify({ name: 'page.designcraft', base64: bytesToBase64(doc) }));
        return engine.renderPagePng(page, scale);
      } finally {
        engine.free();
      }
    },
  };
}

/** Initialise a wasm-bindgen glue module with raw module bytes; returns its Engine class. */
export async function loadHeadless(moduleUrl, wasmBytes) {
  const mod = await import(moduleUrl);
  mod.initSync({ module: wasmBytes });
  return mod.Engine;
}

async function gunzip(bytes) {
  const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

async function hex(bytes) {
  const digest = await globalThis.crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/**
 * Load the committed engine from public/designcraft/headless/, checking both
 * checksums in its manifest. baseUrl must end with "/". `read(name)` defaults
 * to fetch; Node callers pass a file reader and a file: URL for the glue.
 */
export async function loadHeadlessEngine(baseUrl, read = async (name) => {
  const response = await fetch(new URL(name, baseUrl));
  if (!response.ok) throw new Error(`DesignCraft engine file unavailable: ${name} (${response.status})`);
  return new Uint8Array(await response.arrayBuffer());
}) {
  const manifest = JSON.parse(new TextDecoder().decode(await read('manifest.json')));
  const compressed = await read(manifest.wasm.file);
  if (await hex(compressed) !== manifest.wasm.compressedSha256) throw new Error('DesignCraft engine download failed its integrity check; reload to retry.');
  const wasm = await gunzip(compressed);
  if (wasm.length !== manifest.wasm.bytes || await hex(wasm) !== manifest.wasm.sha256) throw new Error('DesignCraft engine failed its integrity check after decompression.');
  const Engine = await loadHeadless(new URL(manifest.glue.file, baseUrl).href, wasm);
  return { Engine, manifest };
}
