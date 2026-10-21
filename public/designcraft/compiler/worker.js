// Client-only DesignCraft composition. Runs in a Web Worker so the page stays
// responsive; takes the same recipe ZIP the planner sends to the server.
// Nothing leaves this browser: articles, photos and any private fonts the
// user supplies stay on this device.
'use strict';
importScripts('../assets/jszip.min.js', '../assets/markdown-it.min.js');

const BRAND = new Set(['assets/ote-horizontal-logo.png', 'assets/ote-stacked-logo.pdf', 'assets/ote-stacked-logo.png', 'assets/source-cover-photo.jpeg']);
const FONT_FILES = ['Salted-Regular.otf', 'LICENSE-Salted.txt', 'SourceSans3-Regular.ttf', 'SourceSans3-Semibold.ttf', 'SourceSans3-Bold.ttf', 'SourceSans3-It.ttf',
  'SourceSerif4-Regular.ttf', 'SourceSerif4-It.ttf', 'SourceSerif4-Bold.ttf', 'SourceSerif4-BoldIt.ttf', 'JetBrainsMono-Regular.ttf',
  'OFL-SourceSans3.txt', 'OFL-SourceSerif4.txt', 'OFL-JetBrainsMono.txt'];
// Open substitutes for the original designs' faces, fetched the first time a design is used.
const DESIGN_FONT_FILES = ['Barlow-Black.ttf', 'Barlow-ExtraBold.ttf', 'Barlow-SemiBold.ttf', 'CaveatBrush-Regular.ttf',
  'texgyreheros-regular.otf', 'texgyreheros-bold.otf', 'texgyreheros-italic.otf', 'texgyreheros-bolditalic.otf', 'texgyreheroscn-bold.otf',
  'OFL-Barlow.txt', 'OFL-CaveatBrush.txt', 'GUST-FONT-LICENSE-TeXGyreHeros.txt'];
const DESIGN_ART = /^original-art\/[a-z0-9][a-z0-9.-]{0,120}\.designcraft$/;
let modules, executor, portableFonts, designFonts, version;

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
    return BRAND.has(path) || DESIGN_ART.test(path) ? fetchBytes('../' + path) : null;
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

async function fontsFor(message, library) {
  const extra = (message.fonts || []).map((f) => ({ name: f.name, bytes: new Uint8Array(f.bytes) }));
  const fonts = message.fontProfile === 'original2025' ? [...extra, ...portableFonts.filter((f) => f.name.startsWith('JetBrainsMono-') || f.name.startsWith('OFL-') || f.name.startsWith('Salted-') || f.name === 'LICENSE-Salted.txt')] : [...portableFonts];
  if (modules.pages.usesDesigns(library)) {
    designFonts ??= await Promise.all(DESIGN_FONT_FILES.map(async (name) => ({ name, bytes: await fetchBytes('../assets/fonts/' + name) })));
    const present = new Set(fonts.map((f) => f.name));
    fonts.push(...designFonts.filter((f) => !present.has(f.name)));
  }
  return fonts;
}

/** The templates a recipe's plan uses (a page recipe: its selected template). */
function plannedLibrary(recipe, templateId) {
  const ids = new Set(templateId ? [templateId] : (recipe.issue.layoutPlan?.pages ?? []).map((p) => p.templateId));
  return { ...recipe.library, templates: recipe.library.templates.filter((t) => ids.has(t.id)) };
}

/** Faces the supplied original fonts lack, so a design uses its open substitutes for them. */
const substitutesFor = (message, library, fonts) => message.fontProfile === 'original2025' ? modules.pages.designFontGaps(library, fonts) : [];

const handlers = {
  async init() { const manifest = await init(); return { version, upstream: manifest?.upstream }; },

  async compile(message) {
    await init();
    const recipe = await readRecipe(message.recipe);
    const templateId = message.mode === 'issue' ? null : recipe.plan?.templateId || (recipe.library.templates.length === 1 ? recipe.library.templates[0].id : null);
    const planned = plannedLibrary(recipe, templateId);
    const fonts = await fontsFor(message, planned), fontProfile = message.fontProfile || 'portable';
    const progress = (detail) => self.postMessage({ id: message.id, progress: detail });
    const common = { markdownit: self.markdownit, JSZip: self.JSZip, executor, loadMedia: recipe.loadMedia, fontProfile, substituteFonts: substitutesFor(message, planned, fonts) };
    const prefix = message.mode === 'issue' ? 'issue' : 'page';
    const docFonts = modules.pages.documentFonts(fonts, fontProfile, modules.pages.usesDesigns(planned));
    // The editor has its own font database. Carry every face used by this
    // document, including bundled open substitutes for original house designs.
    const localFonts = docFonts.filter((font) => /\.(ttf|otf|ttc|otc)$/i.test(font.name)).map((font) => ({
      name: font.name, bytes: font.bytes.buffer.slice(font.bytes.byteOffset, font.bytes.byteOffset + font.bytes.byteLength),
    }));
    try {
      let result;
      if (message.mode === 'issue') {
        result = await modules.issues.compileIssue({ ...common, library: recipe.library, issue: recipe.issue, booklet: !!message.booklet, fonts, onProgress: progress,
          fitCoverTitles: recipe.issue.layoutPlan?.cover?.fitTitles !== false });
      } else {
        const built = await modules.pages.buildPage({ ...common, library: recipe.library, templateId, issue: recipe.issue,
          articleIds: recipe.plan?.articleIds?.length ? recipe.plan.articleIds : null, pageNumber: Number(recipe.plan?.controls?.['page-number'] || 1), pageId: 'page-1' });
        result = await modules.pages.compilePage(built, { executor, fonts, JSZip: self.JSZip });
      }
      const zip = await bundle(prefix, result.artifacts, docFonts, recipe.zip);
      return { status: 'completed', prefix, version, manifest: result.manifest, preflight: result.artifacts.preflight, native: result.artifacts.native, pdf: result.artifacts.pdf, idml: result.artifacts.idml, bundle: zip, localFonts };
    } catch (error) {
      if (!error.artifacts) throw error;
      const zip = await bundle(prefix, error.artifacts, docFonts, recipe.zip);
      return { status: 'failed', prefix, version, message: error.message, preflight: error.artifacts.preflight, native: error.artifacts.native, draftName: error.artifacts.draftName, bundle: zip, localFonts };
    }
  },

  async variants(message) {
    await init();
    const recipe = await readRecipe(message.recipe);
    const design = message.design || null, scope = { ...message.library, templates: message.library.templates.filter((t) => (t.design ?? null) === design) };
    const fonts = await fontsFor(message, scope);
    const result = await modules.variants.generatePageVariants({
      library: message.library, issue: recipe.issue, articleIds: message.articleIds, executor, fonts, design, substituteFonts: substitutesFor(message, scope, fonts), tightenHeadlines: !!message.tightenHeadlines,
      fontProfile: message.fontProfile || 'portable', loadMedia: recipe.loadMedia, markdownit: self.markdownit, JSZip: self.JSZip,
      limit: message.limit || 8, keep: message.keep || 4, previewScale: 0.32,
      onProgress: (detail) => self.postMessage({ id: message.id, progress: detail }),
    });
    return {
      considered: result.considered, composed: result.composed,
      variants: result.variants.map((v) => ({ template: v.template, articleIds: v.articleIds, score: v.score, fill: v.fill, crops: v.crops, headlineSize: v.headlineSize, headlineFit: v.headlineFit, unusedPhotos: v.unusedPhotos, warnings: v.preflight.warnings, preview: v.preview, pdf: v.pdf, native: v.native })),
      rejected: result.rejected.map((v) => ({ template: v.template.id, name: v.template.name, reason: v.reason })),
    };
  },

  async suggestIssue(message) {
    await init();
    const recipe = await readRecipe(message.recipe);
    const design = message.design || null, scope = { ...message.library, templates: message.library.templates.filter((t) => (t.design ?? null) === design) };
    const fonts = await fontsFor(message, scope);
    const plan = await modules.variants.suggestIssuePlan({
      library: message.library, issue: recipe.issue, articleIds: message.articleIds, executor, fonts, design,
      fontProfile: message.fontProfile || 'portable', substituteFonts: substitutesFor(message, scope, fonts), tightenHeadlines: !!message.tightenHeadlines,
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
