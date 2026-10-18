// Pretext (the browser's font engine, as the planner's live preview uses it) against the DesignCraft
// engine's own headline measurement, for every story recipe and both original designs.
// Serve public/designcraft (e.g. `python3 -m http.server 8891 --directory public/designcraft`), then:
//   REVIEW_URL=http://127.0.0.1:8891/ node tools/designcraft/check-pretext-fit.mjs report.json   (STRESS=1: title prefixes)
import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
const R = fileURLToPath(new URL('../..', import.meta.url)).replace(/\/$/, ''), require = createRequire(R + '/package.json');
const { chromium } = require(process.env.REVIEW_PLAYWRIGHT_MODULE || '/opt/node-tools/node_modules/playwright-core');
const { measureHeadlines } = await import(R + '/public/designcraft/compiler/fit.js');
const { wasmExecutor, loadHeadlessEngine } = await import(R + '/public/designcraft/compiler/executors.js');
const base = 'file://' + R + '/public/designcraft/headless/';
const { Engine } = await loadHeadlessEngine(base, async (n) => new Uint8Array(readFileSync(new URL(n, base))));
const executor = wasmExecutor(Engine);
const library = JSON.parse(readFileSync(R + '/public/designcraft/templates.json', 'utf8'));
const issue = JSON.parse(readFileSync(R + '/tests/fixtures/designcraft-march-2025/issue.json', 'utf8'));
const fonts = readdirSync(R + '/public/designcraft/assets/fonts').map((name) => ({ name, bytes: new Uint8Array(readFileSync(join(R + '/public/designcraft/assets/fonts', name))) }));
const STRESS = process.env.STRESS === '1';
const titles = issue.articles.map((a) => a.title);
const arts = STRESS ? titles.flatMap((title) => [18, 24, 30, 36, 42, 48, 54].filter((n) => n < title.length).map((n) => ({ title: title.slice(0, n).trim() }))) : issue.articles;
const cases = library.templates.filter((t) => t.kind === 'story').flatMap((t, i) => (STRESS ? [0, 7, 14] : [0]).map((shift) => ({ id: t.id, order: Array.from({ length: t.storyCount }, (_, k) => arts[(i + k + shift) % arts.length]) })));
const browser = await chromium.launch({ executablePath: process.env.REVIEW_CHROMIUM || '/opt/pw-browsers/chromium', args: ['--no-sandbox'] });
const page = await browser.newPage(); await page.goto(process.env.REVIEW_URL || 'http://127.0.0.1:8891/'); await page.waitForFunction(() => window.otePretext && typeof library !== 'undefined');
let t0 = Date.now();
const pre = await page.evaluate(async (cases) => { const out = {}; for (const [n, c] of cases.entries()) out[n] = await otePretext.measure(library.templates.find((t) => t.id === c.id), c.order); return out; }, cases);
const pretextMs = Date.now() - t0; t0 = Date.now();
const rows = []; let agree = 0, total = 0;
for (const [n, c] of cases.entries()) {
  const t = library.templates.find((x) => x.id === c.id);
  const eng = await measureHeadlines(t, c.order, { executor, library, fonts, tight: true });
  for (const e of eng) {
    const p = pre[n].find((m) => m.slotId === e.slotId); total++;
    if (p.lines === e.lines) agree++; else rows.push({ template: c.id, slot: e.slotId, title: c.order[t.slots.find((s) => s.id === e.slotId).articleIndex ?? 0].title, width: Math.round(t.slots.find((s) => s.id === e.slotId).rect[2] - t.slots.find((s) => s.id === e.slotId).rect[0]), pretext: p.lines, engine: e.lines });
  }
}
const engineMs = Date.now() - t0;
await browser.close();
const report = { headlines: total, agree, disagree: rows.length, agreement: +(agree / total).toFixed(4), pretextMs, engineMs, disagreements: rows };
writeFileSync(process.argv[2], JSON.stringify(report, null, 2));
console.log(JSON.stringify({ ...report, disagreements: rows.slice(0, 12) }, null, 1));
