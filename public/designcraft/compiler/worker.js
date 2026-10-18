// Client-only DesignCraft composition. Runs in a Web Worker so the page stays
// responsive; takes the same recipe ZIP the planner sends to the server.
// Nothing leaves this browser: articles, photos and any private fonts the
// user supplies stay on this device.
'use strict';
importScripts('../assets/jszip.min.js', '../assets/markdown-it.min.js');

const BRAND = new Set(['assets/ote-horizontal-logo.png', 'assets/ote-stacked-logo.pdf', 'assets/ote-stacked-logo.png', 'assets/source-cover-photo.jpeg']);
const FONT_FILES = ['SourceSans3-Regular.ttf', 'SourceSans3-Semibold.ttf', 'SourceSans3-Bold.ttf', 'SourceSans3-It.ttf',
  'SourceSerif4-Regular.ttf', 'SourceSerif4-It.ttf', 'SourceSerif4-Bold.ttf', 'SourceSerif4-BoldIt.ttf', 'JetBrainsMono-Regular.ttf',
  'OFL-SourceSans3.txt', 'OFL-SourceSerif4.txt', 'OFL-JetBrainsMono.txt'];
let modules, executor, portableFonts, version;

async function fetchBytes(path) {
  const response = await fetch(new URL(path, self.location));
  if (!response.ok) throw new Error(`Unavailable: ${path} (${response.status})`);
  return new Uint8Array(await response.arrayBuffer());
}

async function init() {
  if (executor) return;
  const [pages, issues, variants, executors] = await Promise.all(['./page-compiler.js', './issue-compiler.js', './variants.js', './executors.js'].map((m) => import(m)));
  const { Engine, manifest } = await executors.loadHeadlessEngine(new URL('../headless/', self.location).href);
  modules = { pages, issues, variants };
  executor = executors.wasmExecutor(Engine);
  version = executor.version;
  portableFonts = await Promise.all(FONT_FILES.map(async (name) => ({ name, bytes: await fetchBytes('../assets/fonts/' + name) })));
  return manifest;
}

async function readRecipe(bytes) {
  const zip = await JSZip.loadAsync(bytes);
  const json = async (name) => { const entry = zip.file(name); return entry ? JSON.parse(await entry.async('string')) : null; };
  const issue = await json('issue.json'), library = await json('templates.json');
  if (!issue || !library) throw new Error('The recipe needs issue.json and templates.json.');
  const loadMedia = async ({ path }) => {
    if (typeof path !== 'string' || path.startsWith('/') || path.split('/').includes('..')) return null;
    const entry = zip.file(path);
    if (entry) return entry.async('uint8array');
    return BRAND.has(path) ? fetchBytes('../' + path) : null;
  };
  return { zip, issue, library, plan: await json('page-plan.json'), loadMedia };
}

const encode = (value) => new TextEncoder().encode(JSON.stringify(value, null, 2) + '\n');

async function bundle(prefix, artifacts, fonts, recipeZip) {
  const out = new JSZip();
  const files = {
    [prefix + '.designcraft']: artifacts.native, [prefix + '.pdf']: artifacts.pdf, [prefix + '.idml']: artifacts.idml,
    'build-manifest.json': artifacts.manifest && encode(artifacts.manifest), 'preflight.json': artifacts.preflight && encode(artifacts.preflight),
    [prefix === 'issue' ? 'source-issue.json' : 'source-record.json']: (artifacts.sourceIssue || artifacts.sourceRecord) && encode(artifacts.sourceIssue || artifacts.sourceRecord),
    'interchange-metadata.json': artifacts.interchange && encode(artifacts.interchange),
  };
  if (artifacts.draftName && artifacts.native) { delete files[prefix + '.designcraft']; files[artifacts.draftName] = artifacts.native; }
  for (const [name, data] of Object.entries(files)) if (data) out.file(name, data);
  for (const font of fonts) out.file('Document Fonts/' + font.name, font.bytes);
  for (const [name, entry] of Object.entries(recipeZip.files)) if (!entry.dir) out.file('recipe/' + name, await entry.async('uint8array'));
  out.file('README.txt', 'OTE native output, composed in the browser by the headless DesignCraft engine. Keep Document Fonts and interchange-metadata.json beside the document. Failed builds retain a complete source and any native draft; PDF/IDML final exports exist only after compiler preflight passes. Adobe/printer verification is separate.\n');
  return out.generateAsync({ type: 'uint8array', compression: 'DEFLATE' });
}

function fontsFor(message) {
  const extra = (message.fonts || []).map((f) => ({ name: f.name, bytes: new Uint8Array(f.bytes) }));
  return message.fontProfile === 'original2025' ? [...extra, ...portableFonts.filter((f) => f.name.startsWith('JetBrainsMono-') || f.name.startsWith('OFL-'))] : portableFonts;
}

const handlers = {
  async init() { const manifest = await init(); return { version, upstream: manifest?.upstream }; },

  async compile(message) {
    await init();
    const recipe = await readRecipe(message.recipe);
    const fonts = fontsFor(message), fontProfile = message.fontProfile || 'portable';
    const progress = (detail) => self.postMessage({ id: message.id, progress: detail });
    const common = { markdownit: self.markdownit, JSZip: self.JSZip, executor, loadMedia: recipe.loadMedia, fontProfile };
    const prefix = message.mode === 'issue' ? 'issue' : 'page';
    const docFonts = modules.pages.documentFonts(fonts, fontProfile);
    try {
      let result;
      if (message.mode === 'issue') {
        result = await modules.issues.compileIssue({ ...common, library: recipe.library, issue: recipe.issue, booklet: !!message.booklet, fonts, onProgress: progress });
      } else {
        const templateId = recipe.plan?.templateId || (recipe.library.templates.length === 1 ? recipe.library.templates[0].id : null);
        const built = await modules.pages.buildPage({ ...common, library: recipe.library, templateId, issue: recipe.issue,
          articleIds: recipe.plan?.articleIds?.length ? recipe.plan.articleIds : null, pageNumber: Number(recipe.plan?.controls?.['page-number'] || 1), pageId: 'page-1' });
        result = await modules.pages.compilePage(built, { executor, fonts, JSZip: self.JSZip });
      }
      const zip = await bundle(prefix, result.artifacts, docFonts, recipe.zip);
      return { status: 'completed', prefix, version, manifest: result.manifest, preflight: result.artifacts.preflight, native: result.artifacts.native, pdf: result.artifacts.pdf, idml: result.artifacts.idml, bundle: zip };
    } catch (error) {
      if (!error.artifacts) throw error;
      const zip = await bundle(prefix, error.artifacts, docFonts, recipe.zip);
      return { status: 'failed', prefix, version, message: error.message, preflight: error.artifacts.preflight, native: error.artifacts.native, draftName: error.artifacts.draftName, bundle: zip };
    }
  },

  async variants(message) {
    await init();
    const recipe = await readRecipe(message.recipe);
    const result = await modules.variants.generatePageVariants({
      library: message.library, issue: recipe.issue, articleIds: message.articleIds, executor, fonts: fontsFor(message),
      fontProfile: message.fontProfile || 'portable', loadMedia: recipe.loadMedia, markdownit: self.markdownit, JSZip: self.JSZip,
      limit: message.limit || 8, keep: message.keep || 4, previewScale: 0.32,
      onProgress: (detail) => self.postMessage({ id: message.id, progress: detail }),
    });
    return {
      considered: result.considered, composed: result.composed,
      variants: result.variants.map((v) => ({ template: v.template, articleIds: v.articleIds, score: v.score, fill: v.fill, crops: v.crops, headlineSize: v.headlineSize, unusedPhotos: v.unusedPhotos, warnings: v.preflight.warnings, preview: v.preview, pdf: v.pdf, native: v.native })),
      rejected: result.rejected.map((v) => ({ template: v.template.id, name: v.template.name, reason: v.reason })),
    };
  },

  async suggestIssue(message) {
    await init();
    const recipe = await readRecipe(message.recipe);
    const plan = await modules.variants.suggestIssuePlan({
      library: message.library, issue: recipe.issue, articleIds: message.articleIds, executor, fonts: fontsFor(message),
      loadMedia: recipe.loadMedia, markdownit: self.markdownit, JSZip: self.JSZip, previewScale: 0,
      onProgress: (detail) => self.postMessage({ id: message.id, progress: detail }),
    });
    return {
      pages: plan.pages.map(({ template, ...page }) => ({ ...page, template })),
      featured: plan.featured, extraTemplates: plan.extraTemplates,
      problems: plan.plans.filter((p) => p.error).map((p) => ({ pageNumber: p.pageNumber, articleIds: p.articleIds, error: p.error })),
    };
  },
};

self.onmessage = async ({ data }) => {
  try {
    const result = await handlers[data.type](data);
    const transfer = [];
    const collect = (value) => { if (value instanceof Uint8Array && !transfer.includes(value.buffer)) transfer.push(value.buffer); else if (value && typeof value === 'object') Object.values(value).forEach(collect); };
    collect(result);
    self.postMessage({ id: data.id, result }, transfer);
  } catch (error) {
    self.postMessage({ id: data.id, error: error instanceof Error ? error.message : String(error) });
  }
};
