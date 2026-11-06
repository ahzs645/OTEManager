#!/usr/bin/env node
// Walks the app like an editor, on a desktop and a phone, and reports what breaks: page errors, failed
// requests, sideways scrolling, undersized touch targets, then Publications → Issue Studio → layouts → editor → plan → composition.
//   PLAYWRIGHT_CORE=/path/to/playwright-core node tools/designcraft/check-interface-bot.cjs [--base URL] [--out DIR]
// It clicks and saves, so it only runs against a local app and refuses every other host.
const fs = require('node:fs'), path = require('node:path');
const { chromium } = require(process.env.PLAYWRIGHT_CORE || 'playwright-core');
const arg = (name, fallback) => { const i = process.argv.indexOf(name); return i > 0 ? process.argv[i + 1] : fallback; };
const BASE = arg('--base', 'http://localhost:5174'), OUT = path.resolve(arg('--out', 'artifacts/interface-bot'));
if (!['localhost', '127.0.0.1'].includes(new URL(BASE).hostname)) throw new Error('The interface bot only runs against a local app: ' + BASE);
const ROUTES = ['/', '/articles', '/publications', '/authors', '/analytics', '/settings', '/import', '/utilities', '/utilities/designcraft', '/utilities/source-archive', '/utilities/payment-manager', '/utilities/backup'];
const DEVICES = {
  desktop: { viewport: { width: 1440, height: 1000 } },
  mobile: { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2, userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1' },
};
const measure = () => {
  const width = document.documentElement.clientWidth, overflow = document.documentElement.scrollWidth - width;
  const visible = (el) => { const r = el.getBoundingClientRect(), s = getComputedStyle(el); return r.width > 0 && r.height > 0 && s.visibility !== 'hidden' && s.display !== 'none'; };
  const label = (el) => (el.getAttribute('aria-label') || el.innerText || el.title || el.tagName).trim().slice(0, 40);
  const wide = [...document.querySelectorAll('body *')].filter((el) => visible(el) && el.getBoundingClientRect().right > width + 1 && !el.closest('[class*=overflow-x], table, iframe, svg')).slice(0, 5).map((el) => `${el.tagName.toLowerCase()}.${String(el.className).slice(0, 50)}`);
  const small = [...document.querySelectorAll('a[href], button, input:not([type=hidden]), select, [role=button]')].filter((el) => { if (!visible(el)) return false; const r = el.getBoundingClientRect(); return r.height < 32 || r.width < 32; }).map(label);
  return { overflow: Math.max(0, overflow), wide, smallTargets: small.length, smallSample: [...new Set(small)].slice(0, 6) };
};
async function walk(browser, device, options, report) {
  const context = await browser.newContext({ ...options, acceptDownloads: true });
  const page = await context.newPage(), problems = [];
  let at = '';
  page.on('pageerror', (e) => problems.push({ at, kind: 'pageerror', text: e.message.slice(0, 200) }));
  page.on('console', (m) => { if (m.type() === 'error' && !/favicon/.test(m.text())) problems.push({ at, kind: 'console', text: m.text().slice(0, 200) }); });
  page.on('response', (r) => { if (r.status() >= 400 && !/favicon/.test(r.url())) problems.push({ at, kind: 'http', text: `${r.status()} ${r.url().replace(BASE, '').slice(0, 100)}` }); });
  const shots = path.join(OUT, device); fs.mkdirSync(shots, { recursive: true });
  const pages = [];
  for (const route of ROUTES) {
    at = route;
    const started = Date.now();
    const response = await page.goto(BASE + route, { waitUntil: 'load', timeout: 60000 }).catch((e) => ({ status: () => 'FAILED ' + e.message.slice(0, 80) }));
    await page.waitForTimeout(1200);
    const result = { route, status: response.status(), ms: Date.now() - started, ...(await page.evaluate(measure)) };
    pages.push(result);
    await page.screenshot({ path: path.join(shots, route.replace(/\W+/g, '-').replace(/^-$/, 'home') + '.png') });
  }
  const flow = [];
  const step = async (name, run) => {
    at = 'flow: ' + name;
    const started = Date.now();
    try { const detail = await run(); flow.push({ name, ok: true, ms: Date.now() - started, detail }); return true; }
    catch (e) { flow.push({ name, ok: false, ms: Date.now() - started, error: e.message.split('\n')[0].slice(0, 200) }); await page.screenshot({ path: path.join(shots, 'failed-' + name.replace(/\W+/g, '-') + '.png') }).catch(() => {}); return false; }
  };
  const plannerFrame = () => page.frames().find((f) => /designcraft\/(index\.html)?\?/.test(f.url()) || /workspace=1/.test(f.url()));
  const designer = async () => { for (let i = 0; i < 120; i++) { const f = plannerFrame(); if (f && await f.evaluate(() => !!document.getElementById('browser-suggest-issue')).catch(() => false)) return f; await page.waitForTimeout(500); } throw new Error('Designer frame not found: ' + page.frames().map((f) => f.url()).join(' ')); };
  const idle = (frame, id) => frame.waitForFunction((id) => { const b = document.getElementById(id); return b && !b.disabled; }, id, { timeout: 280000 });
  const opened = await step('open the issue on Publications', async () => {
    await page.goto(BASE + '/publications', { waitUntil: 'networkidle' });
    const issue = page.getByText('Bot test issue').first();
    for (let tries = 0; tries < 8 && !(await issue.isVisible()); tries++) { await page.getByText(/^Volume 33/).first().click(); await page.waitForTimeout(700); }
    await issue.waitFor({ timeout: 5000 });
    await page.screenshot({ path: path.join(shots, 'publications-open.png'), fullPage: true });
  }) && await step('open Issue Studio', async () => {
    const row = page.locator('div').filter({ hasText: /10 articles/ }).filter({ has: page.getByRole('button', { name: 'Design issue' }) }).last();
    await row.getByRole('button', { name: 'Design issue' }).click();
    await page.waitForURL(/publications\/issues\/.*\/studio/, { timeout: 30000 });
    await page.getByRole('heading', { name: 'Issue map', exact: true }).waitFor({ timeout: 30000 });
    await page.screenshot({ path: path.join(shots, 'studio.png'), fullPage: true });
    return await page.evaluate(measure);
  }) && await step('open the designer', async () => {
    await page.getByRole('button', { name: 'Open designer', exact: true }).first().click();
    const frame = await designer();
    await page.waitForTimeout(2000);
    return await frame.evaluate(() => ({ photoFit: !!document.getElementById('browser-compose-photo-fit') }));
  });
  const layouts = opened && await step('find fitting layouts', async () => {
    const frame = await designer();
    await frame.evaluate(() => { const recipe = document.getElementById('selected-template'); recipe.value = 'story-1-top-balanced'; recipe.dispatchEvent(new Event('change', { bubbles: true })); });
    await page.waitForTimeout(400);
    await frame.evaluate(() => { const story = [...document.querySelectorAll('select')].find((s) => [...s.options].some((o) => o.text.startsWith('Graduate Students'))); story.value = [...story.options].find((o) => o.text.startsWith('Graduate Students')).value; story.dispatchEvent(new Event('change', { bubbles: true })); });
    await page.waitForTimeout(400);
    await frame.evaluate(() => document.getElementById('browser-variants').click());
    await page.waitForTimeout(500);
    await idle(frame, 'browser-variants');
    await page.screenshot({ path: path.join(shots, 'planner-variants.png') });
    return await frame.evaluate(() => ({ status: document.getElementById('browser-compose-status')?.textContent?.slice(0, 120), cards: [...document.querySelectorAll('.browser-variant')].map((c) => c.innerText.replace(/\s+/g, ' ').slice(0, 130)).slice(0, 2) }));
  });
  if (layouts) await step('generate a layout and open the editor', async () => {
    const frame = await designer();
    await frame.getByRole('button', { name: 'Use this layout' }).first().evaluate((b) => b.click());
    await page.waitForTimeout(500);
    await page.getByRole('button', { name: /Generate & edit/ }).click();
    await page.waitForFunction(() => { const tab = document.getElementById('dc-editor-tab'); return tab && !tab.disabled; }, null, { timeout: 180000 });
    const editor = () => page.frames().find((f) => /designcraft\/editor/.test(f.url()));
    const deadline = Date.now() + 120000;
    while (Date.now() < deadline && !editor()) await page.waitForTimeout(500);
    const frame2 = editor();
    if (!frame2) throw new Error('Editor frame never appeared');
    await frame2.waitForFunction(() => { const l = document.getElementById('designcraft_loading'); return !l || getComputedStyle(l).display === 'none' || /could not load/.test(l.textContent); }, null, { timeout: 180000 });
    await page.waitForTimeout(2500);
    await page.screenshot({ path: path.join(shots, 'editor.png') });
    const message = await frame2.evaluate(() => document.getElementById('designcraft_loading')?.textContent ?? '');
    if (/could not load/.test(message)) throw new Error(message);
    await page.locator('#dc-plan-tab').click();
    await page.waitForTimeout(800);
    return frame2.url().replace(BASE, '');
  });
  if (opened) await step('suggest a whole-issue plan', async () => {
    const frame = await designer();
    await frame.evaluate(() => { const d = document.getElementById('browser-compose-design'); d.value = 'ote-2025'; d.dispatchEvent(new Event('change', { bubbles: true })); document.getElementById('browser-compose-photo-fit').checked = true; document.getElementById('browser-suggest-issue').click(); });
    await page.waitForTimeout(500);
    await idle(frame, 'browser-suggest-issue');
    await page.screenshot({ path: path.join(shots, 'studio-plan.png') });
    const detail = await frame.evaluate(() => ({ status: document.getElementById('browser-compose-status')?.textContent?.slice(0, 160), pages: document.querySelectorAll('#browser-compose-results ol li').length, fitted: [...document.querySelectorAll('#browser-compose-results ol li')].filter((l) => /text wraps|photo/.test(l.textContent)).length, notes: [...document.querySelectorAll('#browser-compose-results p')].map((l) => l.textContent.slice(0, 190)).filter((t) => /Not placed|cannot print/.test(t)) }));
    await frame.getByRole('button', { name: 'Load this plan into the issue builder' }).evaluate((b) => b.click());
    await page.waitForTimeout(1200);
    return detail;
  }) && await step('save and compose the issue', async () => {
    await page.getByRole('button', { name: 'Save issue', exact: true }).first().click();
    await page.waitForTimeout(2500);
    const close = page.getByRole('button', { name: 'Close designer', exact: true });
    if (await close.isVisible().catch(() => false)) await close.click();
    await page.getByRole('button', { name: /Compose saved revision/ }).click();
    await page.getByRole('button', { name: 'Compose saved revision', exact: true }).waitFor({ timeout: 280000 });
    await page.waitForTimeout(1500);
    await page.screenshot({ path: path.join(shots, 'studio-composed.png'), fullPage: true });
    const text = (await page.locator('body').innerText()).replace(/\s+/g, ' ');
    const outcome = text.match(/Composition: (\w+)/)?.[1];
    if (outcome !== 'completed' && !/DesignCraft checked/.test(text)) throw new Error('Composition did not complete: ' + (text.match(/Composition failed.{0,220}/)?.[0] ?? outcome));
    return { outcome, overflow: (await page.evaluate(measure)).overflow, release: text.match(/Release checks: \d+ unresolved/)?.[0] };
  });
  report[device] = { pages, flow, problems };
  return { page, context, step, shots, flow, problems };
}
module.exports = { walk, DEVICES, BASE, OUT };
if (require.main === module) (async () => {
  const browser = await chromium.launch({ channel: process.env.PW_CHANNEL || 'chrome', headless: true });
  const report = {};
  for (const [device, options] of Object.entries(DEVICES)) { const { context } = await walk(browser, device, options, report); await context.close(); }
  await browser.close();
  fs.mkdirSync(OUT, { recursive: true }); fs.writeFileSync(path.join(OUT, 'report.json'), JSON.stringify(report, null, 2));
  for (const [device, r] of Object.entries(report)) {
    console.log(`\n== ${device}`);
    for (const p of r.pages) console.log(`${String(p.status).padEnd(4)} ${p.route.padEnd(30)} ${String(p.ms).padStart(6)}ms overflow ${p.overflow}px small ${p.smallTargets}${p.overflow ? ' ' + p.wide.join(', ') : ''}`);
    for (const f of r.flow) console.log(`${f.ok ? 'ok  ' : 'FAIL'} ${f.name} ${f.ms}ms ${f.ok ? JSON.stringify(f.detail ?? '').slice(0, 300) : f.error}`);
    const seen = {}; for (const p of r.problems) { const k = `${p.kind} ${p.text}`; (seen[k] ??= []).push(p.at); }
    for (const [k, v] of Object.entries(seen)) console.log(`  ! ${k.slice(0, 170)} (${v.length}x, ${[...new Set(v)].slice(0, 3).join(' ')})`);
  }
})().catch((e) => { console.error(e); process.exit(1); });
