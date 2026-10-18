#!/usr/bin/env node
// Compile a recipe with the shared JavaScript compiler (public/designcraft/compiler):
// the path for original-design templates, which the Python compilers decline.
//
//   node tools/designcraft/compile.mjs --library templates.json --issue issue.json --output out \
//     [--template ID --page-number N --articles a,b] [--font-dir DIR --font-profile portable|original2025]
//     [--booklet] [--cli /path/to/designcraft-cli]
//
// Without --cli it runs the committed headless WebAssembly engine. Media resolve beside
// issue.json, then beside templates.json, then in public/designcraft (brand assets, design layers).
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const STATIC = join(ROOT, 'public/designcraft');
const require = createRequire(join(ROOT, 'package.json'));
const markdownit = require('markdown-it'), JSZip = require('jszip');

function parse(argv) {
  const args = { fontProfile: 'portable', booklet: false };
  for (let i = 0; i < argv.length; i++) {
    const key = argv[i], value = () => { if (i + 1 >= argv.length) throw new Error('Missing value for ' + key); return argv[++i]; };
    if (key === '--library') args.library = value();
    else if (key === '--issue') args.issue = value();
    else if (key === '--output') args.output = value();
    else if (key === '--template') args.template = value();
    else if (key === '--page-number') args.pageNumber = Number(value());
    else if (key === '--articles') args.articles = value().split(',').filter(Boolean);
    else if (key === '--font-dir') args.fontDir = value();
    else if (key === '--font-profile') args.fontProfile = value();
    else if (key === '--cli') args.cli = value();
    else if (key === '--booklet') args.booklet = true;
    else throw new Error('Unknown argument ' + key);
  }
  if (!args.library || !args.issue || !args.output) throw new Error('Use --library, --issue and --output');
  if (!['portable', 'original2025'].includes(args.fontProfile)) throw new Error('Unsupported font profile');
  return args;
}

const readFonts = async (directory, keep = () => true) => Promise.all((await readdir(directory))
  .filter((name) => /\.(ttf|otf|ttc|otc|txt)$/i.test(name) && keep(name))
  .map(async (name) => ({ name, bytes: new Uint8Array(await readFile(join(directory, name))) })));

async function main() {
  const args = parse(process.argv.slice(2));
  const module = (name) => import(pathToFileURL(join(STATIC, 'compiler', name)).href);
  const [pages, issues, executors] = await Promise.all([module('page-compiler.js'), module('issue-compiler.js'), module('executors.js')]);
  let executor;
  if (args.cli) executor = await (await import(pathToFileURL(join(ROOT, 'tools/designcraft/cli-executor.mjs')).href)).cliExecutor(args.cli);
  else {
    const base = pathToFileURL(join(STATIC, 'headless') + '/').href;
    const { Engine } = await executors.loadHeadlessEngine(base, async (name) => new Uint8Array(await readFile(new URL(name, base))));
    executor = executors.wasmExecutor(Engine);
  }
  const library = JSON.parse(await readFile(args.library, 'utf8')), issue = JSON.parse(await readFile(args.issue, 'utf8'));
  const page = Boolean(args.template);
  const planned = new Set(page ? [args.template] : (issue.layoutPlan?.pages ?? []).map((p) => p.templateId));
  const used = { ...library, templates: library.templates.filter((t) => planned.has(t.id)) };
  const designs = pages.usesDesigns(used);
  const fonts = await readFonts(resolve(args.fontDir ?? join(STATIC, 'assets/fonts')));
  if (designs && args.fontProfile === 'original2025') {
    const present = new Set(fonts.map((f) => f.name));
    fonts.push(...await readFonts(join(STATIC, 'assets/fonts'), (name) => pages.isDesignFont(name) && !present.has(name)));
  }
  const substituteFonts = args.fontProfile === 'original2025' ? pages.designFontGaps(used, fonts) : [];
  if (substituteFonts.length) console.error('Using open substitutes for: ' + substituteFonts.join(', '));
  const roots = { issue: [dirname(resolve(args.issue))], library: [dirname(resolve(args.library)), STATIC] };
  const loadMedia = async ({ root, path }) => {
    if (typeof path !== 'string' || path.startsWith('/') || path.split(/[\\/]/).includes('..')) return null;
    for (const directory of roots[root] ?? roots.issue) {
      try { return new Uint8Array(await readFile(join(directory, path))); } catch { /* next root */ }
    }
    return null;
  };
  const out = resolve(args.output);
  const write = async (name, data) => { await mkdir(dirname(join(out, name)), { recursive: true }); await writeFile(join(out, name), data); };
  const json = (value) => JSON.stringify(value, null, 2) + '\n';
  for (const font of pages.documentFonts(fonts, args.fontProfile, designs)) await write(join('Document Fonts', font.name), font.bytes);
  const common = { markdownit, JSZip, loadMedia, executor, fontProfile: args.fontProfile, substituteFonts };
  const prefix = page ? 'page' : 'issue';
  let result;
  try {
    if (page) {
      const built = await pages.buildPage({ ...common, library, templateId: args.template, issue, articleIds: args.articles ?? null, pageNumber: args.pageNumber || 1, pageId: 'page-1' });
      result = await pages.compilePage(built, { executor, fonts, JSZip });
    } else {
      result = await issues.compileIssue({ ...common, library, issue, booklet: args.booklet, fonts, fitCoverTitles: issue.layoutPlan?.cover?.fitTitles !== false });
    }
  } catch (error) {
    const artifacts = error?.artifacts;
    if (!artifacts) throw error;
    if (artifacts.native) await write(artifacts.draftName ?? prefix + '-draft.designcraft', artifacts.native);
    if (artifacts.preflight) await write('preflight.json', json(artifacts.preflight));
    if (artifacts.manifest) await write('build-manifest.json', json(artifacts.manifest));
    throw error;
  }
  const { manifest, artifacts } = result;
  await write(prefix + '.designcraft', artifacts.native); await write(prefix + '.pdf', artifacts.pdf); await write(prefix + '.idml', artifacts.idml);
  await write('build-manifest.json', json(manifest)); await write('preflight.json', json(artifacts.preflight));
  if (artifacts.interchange) await write('interchange-metadata.json', json(artifacts.interchange));
  console.log(JSON.stringify({ status: manifest.status, engine: executor.version, output: out, warnings: artifacts.preflight.warnings, substitutedFonts: substituteFonts }));
}

main().catch((error) => { console.error('compile: ' + (error instanceof Error ? error.message : String(error))); process.exit(1); });
