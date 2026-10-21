// Actual Chromium integration checks for the saved Issue Studio planner bridge.
// npm install --prefix /tmp/ote-studio-qa playwright-core
// REVIEW_PLAYWRIGHT_MODULE=/tmp/ote-studio-qa/node_modules/playwright-core node tools/designcraft/test-issue-studio.cjs
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const http = require('node:http');
const path = require('node:path');
const { chromium } = require(process.env.REVIEW_PLAYWRIGHT_MODULE || 'playwright-core');
const JSZip = require('../../node_modules/jszip');
const root = path.resolve(__dirname, '../../public');
const mime = { '.html': 'text/html', '.js': 'text/javascript', '.json': 'application/json', '.css': 'text/css', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.svg': 'image/svg+xml', '.wasm': 'application/wasm' };
const server = http.createServer(async (request, response) => {
  try {
    const pathname = new URL(request.url, 'http://localhost').pathname;
    if (pathname === '/__studio-qa.html') {
      response.setHeader('Content-Type', 'text/html');
      response.end('<!doctype html><title>Issue Studio bridge QA</title><script>window.qaMessages=[];window.addEventListener("message",e=>{if(e.origin===location.origin)qaMessages.push(e.data)});</script><iframe id="planner" src="/designcraft/index.html?workspace=1" style="width:1400px;height:1000px;border:0"></iframe>');
      return;
    }
    if (pathname === '/api/designcraft/native') {
      response.setHeader('Content-Type', 'application/json');
      response.end(JSON.stringify({ available: false, message: 'Browser QA: no native worker' }));
      return;
    }
    if (pathname === '/api/files/issue-studio/saved-studio-browser-qa/booked.png') {
      response.setHeader('Content-Type', 'image/png');
      response.end(await fs.readFile(path.join(root, 'designcraft/assets/ote-horizontal-logo.png')));
      return;
    }
    const target = path.resolve(root, '.' + decodeURIComponent(pathname));
    if (!target.startsWith(root + path.sep)) throw Error('Invalid fixture path');
    const data = await fs.readFile(target);
    response.setHeader('Content-Type', mime[path.extname(target)] || 'application/octet-stream');
    response.end(data);
  } catch {
    response.writeHead(404); response.end('Not found');
  }
});

(async () => {
  const out = process.env.ISSUE_STUDIO_QA_OUTPUT || '/tmp/ote-issue-studio-qa';
  await fs.mkdir(out, { recursive: true });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  const browser = await chromium.launch({ executablePath: process.env.REVIEW_CHROMIUM || '/usr/bin/chromium', headless: true, args: ['--no-sandbox'] });
  const result = { passed: false, checks: {}, pageErrors: [] };
  try {
    const page = await browser.newPage({ viewport: { width: 1480, height: 1100 } });
    page.setDefaultTimeout(15000);
    page.on('pageerror', error => result.pageErrors.push(error.message));
    await page.goto(base + '/__studio-qa.html');
    const frame = page.frames().find(f => f.url().includes('/designcraft/index.html'));
    await frame.waitForSelector('#page-editor');
    await page.waitForFunction(() => qaMessages.some(m => m.type === 'ote.workspace.ready'));
    async function post(message) {
      await page.evaluate(message => document.querySelector('#planner').contentWindow.postMessage(message, location.origin), message);
    }
    async function load(state, extra = {}) {
      await page.evaluate(() => { window.qaMessages = []; });
      await post({ type: 'ote.studio.load', state, pageBudget: 1, reservations: [], placements: [], ...extra });
      await page.waitForFunction(() => qaMessages.some(m => m.type === 'ote.studio.loaded'));
    }
    const source = { schemaVersion: 'ote.designcraft.issue.v1', issue: { id: 'saved-studio-browser-qa', volume: 33, number: 2, date: '2026-10-21' }, articles: [{ id: 'a', title: 'Live source headline', author: 'Anonymous', body: 'Complete live copy — café 中文 🙂.\n\nThis source must survive restoration of the saved recipe.', photos: [{ id: 'photo-a', path: 'media/qa-photo.png', caption: 'Photo credit retained', mimeType: 'image/png' }] }], layoutPlan: {} };
    const zip = new JSZip(); zip.file('issue.json', JSON.stringify(source));
    zip.file('media/qa-photo.png', await fs.readFile(path.join(root, 'designcraft/assets/ote-horizontal-logo.png')));
    const sourceBytes = await zip.generateAsync({ type: 'uint8array' });
    await page.evaluate(bytes => { const buffer = new Uint8Array(bytes).buffer; document.querySelector('#planner').contentWindow.postMessage({ type: 'ote.import-issue', name: 'studio-qa.zip', bytes: buffer }, location.origin, [buffer]); }, Array.from(sourceBytes));
    await frame.waitForFunction(() => document.querySelector('#import-status').textContent.includes('1 articles imported'));
    await load(null);
    result.checks.liveSourceImported = true;

    await frame.locator('#selected-template').selectOption('story-1-none-balanced');
    await frame.locator('#assignments select').first().selectOption('a');
    await frame.locator('#page-number').fill('1');
    await frame.locator('#save-issue-page').click();
    await frame.waitForFunction(() => plannedPages.length === 1);
    await page.waitForFunction(() => qaMessages.some(m => m.type === 'ote.studio.changed'));
    let recipe = await page.evaluate(() => qaMessages.filter(m => m.type === 'ote.studio.changed').at(-1).state);
    assert.equal(recipe.savedPages[0].articleIds[0], 'a');
    result.checks.savedRecipeWriteback = true;

    await frame.evaluate(() => { issue.articles[0].photos[0].focus = { x: 0.2, y: 0.7 }; issue.articles[0].photos[0].zoom = 1.5; renderPage(); });
    recipe = await frame.evaluate(() => window.oteIssueStudio.snapshot());
    await frame.evaluate(() => { delete issue.articles[0].photos[0].focus; delete issue.articles[0].photos[0].zoom; });
    await load(recipe);
    assert.deepEqual(await frame.evaluate(() => issue.articles[0].photos[0].focus), { x: 0.2, y: 0.7 }, 'Print focal point must survive reopening the saved recipe');
    assert.equal(await frame.evaluate(() => issue.articles[0].photos[0].zoom), 1.5);
    result.checks.cropSurvivesReopen = true;

    // Restoring an older recipe must preserve the live imported article content.
    recipe.issueBundle ||= {};
    recipe.issueBundle.articles = [{ ...source.articles[0], title: 'Stale title', body: 'Stale truncated copy' }];
    const reservation = { id: 'booked-quarter', pageNumber: 1, rect: [378, 450, 342, 294], kind: 'booked-ad', artworkStatus: 'pending', locked: true };
    await load(recipe, { reservations: [reservation] });
    assert.equal(await frame.evaluate(() => issue.articles[0].body), source.articles[0].body);
    assert.equal(await frame.evaluate(() => issue.articles[0].title), source.articles[0].title);
    result.checks.restorationUsesCurrentSource = true;
    const reserved = await frame.evaluate(() => copy(plannedPages[0]));
    const ad = reserved.template.slots.find(s => s.id.includes('booked-quarter'));
    assert(ad, 'Saved page must contain the authoritative booked advertisement');
    assert.deepEqual(ad.rect, [378, 450, 720, 744]);
    const geometry = reserved.template.slots;
    await load(recipe, { reservations: [reservation] });
    assert.deepEqual(await frame.evaluate(() => copy(plannedPages[0].template.slots)), geometry);
    result.checks.authoritativeAdAndIdempotentRestore = true;

    const readyReservation = { ...reservation, artworkStatus: 'ready', artworkPath: 'issue-studio/saved-studio-browser-qa/booked.png' };
    await load(recipe, { reservations: [readyReservation] });
    const artwork = await frame.evaluate(() => { const slot = plannedPages[0].template.slots.find(s => s.id.includes('booked-quarter')); return { path: slot.asset, bytes: Array.from(bytes.get(slot.asset) || []), fit: slot.fit }; });
    assert.equal(artwork.path, 'assets/user-reservation-booked-quarter.png');
    assert.deepEqual(artwork.bytes.slice(0, 8), [137, 80, 78, 71, 13, 10, 26, 10]);
    assert.equal(artwork.fit, 'contain');
    result.checks.bookedArtworkLoadedWithoutStretch = true;

    // A second page cannot quietly grow a fixed one-page issue budget.
    await frame.locator('#page-number').fill('2');
    await frame.locator('#save-issue-page').click();
    assert.equal(await frame.evaluate(() => plannedPages.length), 1);
    assert.match(await frame.locator('#issue-plan-status').textContent(), /budget|page count|page limit/i);
    result.checks.fixedBudget = true;

    const before = await frame.evaluate(() => JSON.stringify({ issue, plannedPages }));
    const foreign = await frame.evaluate(() => { const count = plannedPages.length; window.dispatchEvent(new MessageEvent('message', { origin: 'https://unrelated.invalid', source: parent, data: { type: 'ote.studio.load', state: null, pageBudget: 50, reservations: [] } })); return count; });
    assert.equal(foreign, 1);
    assert.equal(await frame.evaluate(() => JSON.stringify({ issue, plannedPages })), before);
    result.checks.foreignOriginIgnored = true;

    await load(recipe, { reservations: [reservation], pages: [{ id: recipe.savedPages[0].id, pageNumber: 1, locked: true }], placements: [{ articleId: 'a', locked: true, pageIds: [recipe.savedPages[0].id], priority: 3, allowedPages: [1] }] });
    await frame.locator('#page-number').fill('1');
    const locked = await frame.evaluate(() => JSON.stringify(plannedPages));
    await frame.locator('#save-issue-page').click();
    assert.equal(await frame.evaluate(() => JSON.stringify(plannedPages)), locked);
    assert.match(await frame.locator('#issue-plan-status').textContent(), /unlock/i);
    result.checks.lockedPagePreserved = true;

    const options = await frame.evaluate(() => window.oteIssueStudio.planningOptions({ ...library, templates: [baseFromSaved(plannedPages[0])] }));
    assert.equal(options.pageBudget, 1);
    assert.deepEqual(options.protectedPageIds, [recipe.savedPages[0].id]);
    assert.deepEqual(options.articleConstraints.a, { priority: 3, allowedPages: [1] });
    assert.equal(options.reservations.length, 1);
    assert.deepEqual(options.pageLibraries[1].templates[0].slots.find(s => s.id.includes('booked-quarter')).rect, [378, 450, 720, 744]);
    assert.equal(await frame.evaluate(() => JSON.stringify(plannedPages)), locked);
    result.checks.allocatorReceivesSavedConstraints = true;

    const malformed = structuredClone(recipe);
    for (const key of ['template', 'baseTemplate']) {
      const template = malformed.savedPages[0][key];
      if (template) template.slots.push(structuredClone(template.slots[0]));
    }
    const validState = await frame.evaluate(() => JSON.stringify({ issue, plannedPages, blocks, assignments }));
    await page.evaluate(() => { window.qaMessages = []; });
    await post({ type: 'ote.studio.load', state: malformed, pageBudget: 1, reservations: [reservation], placements: [] });
    await page.waitForFunction(() => qaMessages.some(m => m.type === 'ote.studio.error'));
    assert.equal(await frame.evaluate(() => JSON.stringify({ issue, plannedPages, blocks, assignments })), validState, 'A rejected saved recipe must leave source, pages, and edits intact');
    result.checks.atomicRejectedRestore = true;
    await page.screenshot({ path: path.join(out, 'issue-studio-planner.png'), fullPage: true });
    assert.deepEqual(result.pageErrors, []);
    result.passed = true;
    console.log(JSON.stringify(result, null, 2));
  } catch (error) {
    result.error = error.stack;
    throw error;
  } finally {
    await fs.writeFile(path.join(out, 'results.json'), JSON.stringify(result, null, 2));
    await browser.close();
    await new Promise(resolve => server.close(resolve));
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
