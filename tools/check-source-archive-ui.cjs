const { chromium } = require('/opt/codex/cua_node/lib/node_modules/playwright-core');
const { readFile, mkdir, writeFile, rm } = require('node:fs/promises');
const { resolve } = require('node:path');
const JSZip = require('jszip');

(async () => {
  const origin = process.env.OTE_UI_ORIGIN || 'http://127.0.0.1:5173';
  const manifest = JSON.parse(await readFile(resolve('public/designcraft/source-archive.json'), 'utf8'));
  const output = resolve('docs/source-archive-review');
  await mkdir(output, { recursive: true });
  const browser = await chromium.launch({ executablePath: '/usr/bin/chromium', headless: true, args: ['--no-sandbox'] });
  const page = await browser.newPage({ viewport: { width: 1440, height: 1100 } });
  const browserErrors = [];
  const requests = [];
  page.on('pageerror', error => browserErrors.push(error.message));
  page.on('console', message => { if (message.type() === 'error') browserErrors.push(message.text()); });
  page.on('response', response => {
    if (response.url().endsWith('/api/source-archive/import')) requests.push({ response, contentType: response.request().headers()['content-type'] || '' });
  });
  const navigate = async (path) => {
    for (let attempt = 0; attempt < 3; attempt++) {
      try { await page.goto(origin + path, { waitUntil: 'networkidle' }); return; }
      catch (error) { if (attempt === 2 || !String(error).includes('interrupted by another navigation')) throw error; }
    }
  };
  try {
    await navigate('/utilities/source-archive');
    await page.getByRole('heading', { name: /Source issues ·/ }).waitFor();
    const checkboxes = page.getByRole('checkbox');
    if (await checkboxes.count() !== manifest.issues.length) throw Error('Not every source document is visible.');
    for (const checkbox of await checkboxes.all()) if (!await checkbox.isChecked()) throw Error('The complete source archive was not selected.');
    await page.getByRole('link', { name: 'Generated files on Drive' }).waitFor();

    // Inspect a subset, then restore the complete archive before importing.
    await page.getByRole('button', { name: 'Clear', exact: true }).click();
    await checkboxes.first().check();
    await page.getByRole('button', { name: 'Review import', exact: true }).click();
    await page.getByRole('heading', { name: 'Reviewed database changes' }).waitFor();
    const subset = await requests.at(-1).response.json();
    if (subset.summary.documents !== 1) throw Error('Issue selection did not reach the import preview.');
    await page.getByRole('button', { name: 'Select all', exact: true }).click();
    await page.getByRole('button', { name: 'Review import', exact: true }).click();
    await page.getByRole('heading', { name: 'Reviewed database changes' }).waitFor();
    let reviewed = await requests.at(-1).response.json();
    if (!reviewed.success || reviewed.summary.documents !== manifest.issues.length) throw Error('Full source preview failed.');
    if (reviewed.summary.conflicts) throw Error('Unexpected source archive conflicts: ' + reviewed.summary.conflicts);

    let imported = false;
    const importButton = page.getByRole('button', { name: 'Import reviewed records', exact: true });
    if (process.argv.includes('--import') && await importButton.isEnabled()) {
      await importButton.click();
      await page.getByRole('heading', { name: 'Source archive import complete' }).waitFor();
      reviewed = await requests.at(-1).response.json();
      if (!reviewed.success) throw Error('UI import failed.');
      imported = true;
    }
    await page.screenshot({ path: resolve(output, 'main-app-source-import.png'), fullPage: false });

    // Reopening a metadata ZIP exercises the real multipart path without changing records.
    const zip = new JSZip();
    zip.file('source-archive.json', JSON.stringify(manifest));
    await page.getByLabel('Open source archive JSON or ZIP').setInputFiles({ name: 'source-archive-metadata.zip', mimeType: 'application/zip', buffer: await zip.generateAsync({ type: 'nodebuffer' }) });
    await page.getByText('source-archive-metadata.zip', { exact: true }).waitFor();
    await page.getByRole('button', { name: 'Review import', exact: true }).click();
    await page.getByRole('heading', { name: 'Reviewed database changes' }).waitFor();
    const resumed = await requests.at(-1).response.json();
    if (!requests.at(-1).contentType.startsWith('multipart/form-data') || !resumed.success) throw Error('ZIP multipart preview failed.');
    if (imported && (resumed.summary.create || resumed.summary.link)) throw Error('Reopening the same source metadata proposed duplicate imports.');

    const saved = reviewed.articles.find(article => article.articleId && article.missingBody && !['excluded', 'conflict'].includes(article.action)) || reviewed.articles.find(article => article.articleId && !['excluded', 'conflict'].includes(article.action));
    if (saved?.articleId && (imported || reviewed.summary.existing)) {
      await navigate('/publications');
      await page.getByRole('link', { name: 'Source archive', exact: true }).first().waitFor();
      await page.screenshot({ path: resolve(output, 'main-app-publications.png'), fullPage: true });
      const missing = reviewed.articles.find(article => article.articleId && article.issueId && article.missingBody && !['excluded', 'conflict'].includes(article.action));
      if (missing) {
        const issueLink = page.locator(`a[href*="issueId=${missing.issueId}"]`).first();
        await issueLink.locator('..').getByRole('button', { name: 'DesignCraft ZIP', exact: true }).click();
        const dialog = page.getByRole('dialog');
        await dialog.getByText(/article records have no recovered text/).waitFor();
        await dialog.getByRole('link', { name: 'Recreate the complete original issue from its source pages →', exact: true }).waitFor();
        const selections = dialog.getByRole('checkbox', { name: /^Include .* in DesignCraft export$/ });
        let blocked = 0;
        for (const selection of await selections.all()) if (await selection.isDisabled()) { blocked++; if (await selection.isChecked()) throw Error('An empty source article was selected.'); }
        if (!blocked) throw Error('Metadata-only source articles were not blocked from content export.');
        await dialog.getByRole('button', { name: 'Select all with text', exact: true }).click();
        for (const selection of await selections.all()) if (await selection.isDisabled() && await selection.isChecked()) throw Error('Select all included an empty source article.');
        await dialog.getByRole('button', { name: 'Clear articles', exact: true }).click();
        if (!await dialog.getByRole('button', { name: 'Open selected in DesignCraft', exact: true }).isDisabled()) throw Error('Empty source content could reach the planner.');
        const rejected = await page.request.post(origin + '/api/exportIssue/' + encodeURIComponent(missing.issueId) + '?format=designcraft', { data: { articleIds: [missing.articleId] } });
        if (rejected.status() !== 409 || !/Full article text is missing/.test((await rejected.json()).error)) throw Error('The server allowed an empty-body content export.');
        await page.screenshot({ path: resolve(output, 'main-app-metadata-only-export.png'), fullPage: false });
        await dialog.getByRole('button', { name: 'Close', exact: true }).click();
      }
      const emptyEdition = manifest.issues.find(issue => {
        const articles = manifest.articles.filter(article => ['article', 'editorial'].includes(article.kind) && article.placements.some(placement => placement.documentId === issue.documentId));
        return articles.length && articles.every(article => !article.content.trim());
      });
      const emptyPublication = emptyEdition && reviewed.publications.find(publication => publication.documentId === emptyEdition.documentId);
      if (emptyPublication) {
        await page.locator(`a[href*="issueId=${emptyPublication.issueId}"]`).first().locator('..').getByRole('button', { name: 'DesignCraft ZIP', exact: true }).click();
        const dialog = page.getByRole('dialog');
        await dialog.getByText(/article records have no recovered text/).waitFor();
        await dialog.getByRole('button', { name: 'Select all with text', exact: true }).click();
        const selections = dialog.getByRole('checkbox', { name: /^Include .* in DesignCraft export$/ });
        for (const selection of await selections.all()) if (!await selection.isDisabled() || await selection.isChecked()) throw Error('An all-metadata edition selected bodyless content.');
        for (const name of ['Open selected in DesignCraft', 'Export selected for DesignCraft']) if (!await dialog.getByRole('button', { name, exact: true }).isDisabled()) throw Error('An all-metadata edition could trigger an empty-body export.');
        await page.screenshot({ path: resolve(output, 'main-app-all-metadata-export.png'), fullPage: false });
        await dialog.getByRole('button', { name: 'Close', exact: true }).click();
      }
      await navigate('/article/' + encodeURIComponent(saved.articleId));
      await page.getByRole('heading', { name: 'Original source', exact: true }).waitFor();
      if (saved.authorName && !await page.getByText(saved.authorName, { exact: true }).count()) throw Error('Original byline is absent from the article detail.');
      if (saved.missingBody) await page.getByText('Original article metadata is available. Full article text has not been recovered from the source archive.', { exact: true }).waitFor();
      const originalDate = manifest.articles.find(article => article.sourceKey === saved.sourceKey)?.originalDates?.submittedAt;
      if (originalDate) await page.locator('time').filter({ hasText: originalDate.replace('T', ' ').replace(/(?:\.000)?Z$/, ' UTC') }).waitFor();
      else await page.getByText('Not recorded in source', { exact: true }).waitFor();
      await page.getByText('Payment information was not verified in the original source archive.', { exact: true }).waitFor();
      await page.screenshot({ path: resolve(output, 'main-app-article-provenance.png'), fullPage: true });
      await navigate('/articles?status=Archived&search=' + encodeURIComponent(saved.authorName || saved.title));
      await page.getByRole('link', { name: 'Original issue archive', exact: true }).waitFor();
      await page.getByText(saved.title, { exact: true }).first().waitFor();
      await page.screenshot({ path: resolve(output, 'main-app-articles.png'), fullPage: false });
      const photoAsset = manifest.assets.find(asset => asset.sourceKey && asset.attachmentType === 'photo' && asset.availability === 'available' && reviewed.articles.some(article => article.sourceKey === asset.sourceKey && article.articleId && !['excluded', 'conflict'].includes(article.action)));
      const photoArticle = photoAsset && reviewed.articles.find(article => article.sourceKey === photoAsset.sourceKey && article.articleId);
      if (photoArticle) {
        await navigate('/article/' + encodeURIComponent(photoArticle.articleId));
        const image = page.locator('img').first();
        await image.waitFor({ state: 'visible' });
        await page.waitForFunction(() => { const image = document.querySelector('img'); return image?.complete && image.naturalWidth > 0; });
        if (!manifest.articles.find(article => article.sourceKey === photoArticle.sourceKey)?.originalDates?.submittedAt) await page.getByText('Submission date not recorded', { exact: true }).waitFor();
        await page.screenshot({ path: resolve(output, 'main-app-source-photo.png'), fullPage: true });
      }
    }
    if (browserErrors.length) throw Error('Browser errors: ' + browserErrors.join('; '));
    const files = reviewed.files ? Object.fromEntries(Object.entries(reviewed.files).filter(([key]) => key !== 'results')) : null;
    const result = { verifiedAt: new Date().toISOString(), documents: manifest.issues.length, subset: subset.summary, reviewed: reviewed.summary, files, imported, importedStats: imported ? { imported: reviewed.imported, linked: reviewed.linked, existing: reviewed.existing, conflicts: reviewed.conflicts } : null, zipPreview: resumed.summary, requestFormats: requests.map(request => request.contentType.split(';')[0]), articleId: saved?.articleId || null, browserErrors };
    await writeFile(resolve(output, 'main-app-browser.json'), JSON.stringify(result, null, 2) + '\n');
    await rm(resolve(output, 'main-app-failure.png'), { force: true });
    process.stdout.write(JSON.stringify(result, null, 2) + '\n');
  } catch (error) {
    await page.screenshot({ path: resolve(output, 'main-app-failure.png'), fullPage: true }).catch(() => {});
    const alert = await page.getByRole('alert').allTextContents().catch(() => []);
    if (alert.length || browserErrors.length) process.stderr.write(JSON.stringify({ alert, browserErrors }) + '\n');
    throw error;
  } finally { await browser.close(); }
})().catch(error => { process.stderr.write(error.stack + '\n'); process.exitCode = 1; });
