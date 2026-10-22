# Original articles and issue metadata

OTEManager now has **Utilities → Original issue archive**, with entry links from
Articles, Publications and Import. It reviews the recovered original article
records and imports them into the normal article and publication screens.

The [generated files on Google Drive](https://drive.google.com/drive/folders/1yR2KV9cd5DHDE_xzny43te-ncE9kKr3W)
include recreated issue PDFs, editable DesignCraft/IDML bundles, complete issue
recipes, article Markdown exports, metadata JSON/CSV and the article import ZIP.
The folder contains generated deliverables. Original archive links and hashes
are recorded as source references.

## What was recovered

Nine PDF variants describe seven publication editions. Their mostly blank
working layouts do not contain every article. The related OTEManager database
backup identifies **87 original article records**; its stored article copy
supplies 20 complete bodies. Source InDesign stories supply additional copy and
13 further semantic article records, including CFUR contributions, alumni
profiles and reprints.

The resulting catalogue has **100 main article records: 45 with recovered copy
and 55 with metadata only**. Metadata-only records have an empty source body and
an explicit recovery status. No body, byline, email, page number or release date
is invented. Recurring Q&A and photo features remain distinct archive records.

All 87 original records retain their original IDs, literal titles, bylines or
anonymity preferences, edition assignments, and recorded submission, creation
and modification dates. Alternate IDML titles and source-revision differences
are retained in provenance. The iMac article stays in its database-assigned
edition, even though its recovered text was found in a November layout revision.

The source inventory records 350 original attachment references whose raw bytes
are unavailable through the connected downloader. Those references create no
broken attachment rows. Two unambiguous alumni portraits recovered from source
PDFs are included as actual article media. Other embedded source images remain
an inventory; they are not guessed onto articles.

## Review and import

1. Open **Utilities → Original issue archive**. Use the supplied catalogue, or
   open its generated JSON/ZIP from Drive. The ZIP includes the same metadata,
   readable article exports and the two available portrait files.
2. Select the source issues to review. The screen distinguishes full source
   copy, recovered InDesign copy, metadata-only records and recurring features.
   It shows available files and original file references still awaiting bytes.
3. Choose **Review import**. The preview identifies new records, links to
   existing original IDs, conflicts and excluded archive-only content. A token
   binds the reviewed source and file checksums to the subsequent import.
4. Choose **Import reviewed records**. The result links to the regular Articles
   and Publications screens. Article details show the original source, recovery
   status, byline, recorded dates and file/page provenance.

New historical source articles start **Archived**, with unknown tier and payment
information left unset. They do not enter the unpaid payment queue or inflate
financial totals. Existing editorial copy, status, payment details and submission
dates are preserved. An exact original-ID match can fill an empty body with
verified recovered copy; different existing copy is reported for review.

Repeated imports use stable source identities and recorded links. Different
archive revisions share their actual publication edition. Distinct original
article IDs remain distinct even when their titles and copy match. Backups retain
the source links so restoring a backup does not lose import identity.

## Supplying files later

The import ZIP can carry additional original files at their manifest paths.
Files are checked against their declared sizes and SHA-256 values before they
are stored and attached. Reimporting retries failed files without duplicating
article or attachment records. ZIP uploads are limited to 64 MiB compressed and
256 MiB expanded; metadata is limited to 6 MiB.

`tools/designcraft/recover-drive-files.py` can selectively extract the relevant
article files from a locally available backup ZIP and produce a recovery report.
Pass that report to the catalogue builder to enrich available copy and media.
Multiple differing recovered document versions remain explicit alternatives
until their canonical text is selected. The private companion backup could not
be downloaded in this session: the connector has a 256 MiB limit and its public
download URL requires authentication.

## Reproduce the generated data

```sh
python3 tools/designcraft/build-source-archive.py
python3 tools/designcraft/package-source-deliverables.py
npm test
npm run typecheck
npm run build
node tools/check-source-archive-ui.cjs
```

The default builder uses the committed, sanitized metadata fixture and original
PDF/IDML sources. It omits contacts, payment records, feedback and unrelated
backup tables. Refreshing that fixture from a local source backup is an explicit
builder option. The metadata importer accepts file bytes only from a checked
ZIP or the app's bounded source-media directory.

## Verification

The full suite passed 310 tests, with three optional native-CLI checks skipped.
Both TypeScript projects and the production build passed. Independent source
checks verify all 87 original identities and all 45 recovered article bodies.
The main app browser check imported 100 articles into seven publications,
attached the two available portraits, and reopened JSON and ZIP imports with
zero duplicate records or browser errors. Article detail checks cover original
dates, public bylines, missing text and unverified payment information.

The app and backend checks run against the local development setup. Production
deployment is separate. See the [complete issue recreation guide](DESIGNCRAFT-WHOLE-ISSUES.md)
for the 153-page layout catalogue and export verification.
