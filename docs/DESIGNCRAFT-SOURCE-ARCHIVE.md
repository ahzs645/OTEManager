# Original article archive

The archive converts the supplied source material into semantic article records, not a separate article for each layout text frame. Its canonical import manifest is `public/designcraft/source-archive.json` (`ote.source-archive.v1`). The generated CSV, readable Markdown articles and per-issue JSON live under `public/designcraft/source-archive/`. `artifacts/source-archive/ote-source-articles.zip` packages those generated documents and the two available article-associated alumni portraits, so the article import does not depend on this host's media files. It contains no copied input backups, PDFs or IDML packages. The other unassigned embedded images remain a separately identified source inventory.

## Coverage

The nine source PDFs represent seven publication editions. There are 100 main article records: all 87 original database article identities plus 13 independently recovered source stories. Forty-five have genuine body copy and 55 retain an explicitly empty body with `recoveryStatus: metadata-only`. Eight recurring question/answer records and three photo features are catalogued separately and excluded from the main-article import.

| Edition | Main articles | Recovered bodies | Metadata only |
|---|---:|---:|---:|
| 31/3 | 13 | 13 | 0 |
| 31/4 | 11 | 1 | 10 |
| 31/5 | 13 | 0 | 13 |
| 31/6 | 19 | 5 | 14 |
| 31/7 | 23 | 6 | 17 |
| 32/1 | 11 | 10 | 1 |
| 32/2 | 10 | 10 | 0 |

Twenty bodies are copied exactly from the original database backup; 25 more are recovered from identified IDML stories. In particular, the fuller November IDML is a different revision from its mostly empty paired PDF. Its recovered stories therefore say `alternate-idml-not-in-paired-pdf`. An iMac article in that IDML remains assigned to 31/4 because the original database explicitly assigns it there. Two archival reprints retain their original reprint notes. The two similar September events articles remain distinct original identities; the missing one is not filled with the other's copy.

Original titles and credited bylines remain primary for database records; differing IDML headlines/bylines are recorded in provenance. Unknown CFUR and alumni writers remain unknown; section branding and profile subjects are not invented personal bylines. All 87 original records retain verified `originalDates` (submission, creation and update) and their anonymity preference. Those source dates do not change the issue release date or justify overwriting a current workflow timestamp.

There are 350 referenced submission files (171 Word/text documents and 179 photographs) whose bytes were not available from the supplied metadata backup. They remain explicit missing asset references. Extracted images from the PDFs are a separate inventory of 91 actual embedded source images; they are not described as recovered original submission files. Only the two clearly located March alumni portraits are associated with individual article records. Other image placements remain source evidence without guessed article ownership.

## Rebuild

Run from the repository root with Python 3 and PyMuPDF installed:

```sh
python3 tools/designcraft/build-source-archive.py
```

The default build uses the committed, sanitized seven-edition fixture under `public/designcraft/source-metadata/` and the source PDFs/IDML already in the repository. The fixture contains an allowlist of original article metadata, original dates, credited authors, copy and safe attachment references. Contacts, payment information, feedback, private attachment filenames and unrelated records are excluded. Writers who requested anonymity receive the credit `Anonymous`; their underlying author identity is omitted.

To refresh that allowlisted fixture from an explicitly supplied native metadata ZIP:

```sh
python3 tools/designcraft/build-source-archive.py --metadata-backup /path/to/native-metadata.zip
```

If actual original submission bytes later become available locally, `tools/designcraft/recover-drive-files.py` can produce a recovery report. Supply it without changing the metadata contract:

```sh
python3 tools/designcraft/build-source-archive.py --recovery-report /path/to/recovery-report.json
```

Only files reported as recovered and present on disk are copied to safe generated paths; their checksums are verified. Exact stored database copy and curated IDML copy remain primary. An empty metadata-only body is filled automatically only when the recovered source documents provide one unambiguous text version. Different versions are retained as evidence without choosing a canonical body silently.

The source archive UI and backend import use stable source keys and original article IDs. Repeated imports are idempotent, retain distinct original records and preserve existing nonempty bodies and editorial/payment state. Recurring features, advertisements, board lists and blank editorial spaces are not converted into paid main article records.

The independent coverage tests in `tests/source-archive-coverage.test.ts` compare all 87 original IDs, titles, public credits, original dates and the 20 exact stored-body hashes against a separately prepared golden fixture. The original input backup hash is retained in provenance, but the backup itself is excluded from the generated publishing package.
