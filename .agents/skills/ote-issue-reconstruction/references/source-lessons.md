# Source lessons and verified baseline

This is a dated record of the October 22, 2026 recovery. Recompute counts and
checks for new input; do not turn these observations into universal constants.
Current application manifests and source files remain the source of truth.

## Source coverage and revisions

- Nine complete issue PDF variants contain 153 physical pages and represent
  seven actual editions: Volume 31 issues 3–7 and Volume 32 issues 1–2.
- The source audit also includes standalone ad/logo PDFs; its 12 PDF / 156 page
  count is different from the nine whole-issue documents. Explain the scope.
- The original working PDFs contain many blank article areas. Their headers,
  dated labels and cover teasers do not establish absent body copy.
- The fuller November IDML (`cover-page-issue-3-lina-66de36f6.idml`) differs from
  the paired mostly blank PDF. Keep `alternate-idml-not-in-paired-pdf` evidence.
- The iMac article's recovered body occurs in that November IDML, but its
  original database assignment is Volume 31 Issue 4. Preserve the assignment.
- Two old reprints retain their historical reprint notes and Travis Nielsen /
  Carolynne Burkholder credits while remaining assigned to the current issue.
- The similar September event articles are distinct original IDs. Never use
  the recovered one's copy to silently fill the missing one's body.
- Literal house section letters, stale interior datelines, placeholder copy,
  an empty President response and an unfilled ad frame are source facts.

## Article recovery baseline

| Edition | Main article records | Recovered bodies | Metadata only |
| --- | ---: | ---: | ---: |
| 31/3 | 13 | 13 | 0 |
| 31/4 | 11 | 1 | 10 |
| 31/5 | 13 | 0 | 13 |
| 31/6 | 19 | 5 | 14 |
| 31/7 | 23 | 6 | 17 |
| 32/1 | 11 | 10 | 1 |
| 32/2 | 10 | 10 | 0 |
| Total | 100 | 45 | 55 |

- All 87 target database identities are preserved. Twenty bodies are exact
  stored database copy. Twenty-five complete source IDML stories supply the
  remaining recovered bodies, including 13 additional semantic article records.
- Eight recurring Q&A records and three photo features bring the readable
  archive to 111 records. They remain distinct from paid main article records.
- All 87 matched originals retain recorded submitted/created/updated dates,
  titles, public credits and anonymity preferences. Unknown dates for additional
  IDML-only records remain unknown; import time is not a submission date.
- Source sections such as CFUR are not automatically the personal author.
  A profile subject is not automatically its writer. Missing bylines stay null.
- Golden fixtures independently verify original metadata and stored body hashes.
  Source-fidelity tests also open the cited IDML story XML and compare complete
  bodies with narrowly defined whitespace/discretionary-glyph normalization.
- Readable article and CSV exports retain literal source trailing whitespace.
  The scoped `.gitattributes` settings preserve that source data without turning
  off whitespace checks for application code, tools or newly written guides.

## Files and access

- The initial Drive archive is about 1.78 GB; the connector could not download
  it through its 256 MiB limit. Normal public HTTP ranges exposed its central
  directory and selected entries. A central-directory listing is inventory,
  not a claim that every archive member was downloaded.
- A smaller available database metadata backup supplied the original identities.
  Its related larger private files backup required authentication. No original
  submission attachment bytes were recovered from that private backup.
- The target metadata references 350 unavailable files: 171 Word/text documents
  and 179 photos. Their bytes remain missing; no fake attachment rows exist.
- Ninety-one actual embedded source images are a separate inventory. Only two
  unambiguously associated March alumni portraits are attached to article
  records. Embedded inventory does not establish recovered submission files.
- Store raw inputs, bearer URLs, contacts, financial backup tables and recovery
  working files in ignored local locations. Commit only the allowlisted fixture,
  source evidence and generated runtime assets needed to reproduce the result.

## Layout and engine findings

- Artwork mode preserves page graphics but does not make their printed letters
  editable. Reconstruction separates supported source text into native regions;
  rotated, tiny or clipped lettering may remain in graphics.
- There are 22 measured replaceable advertisement frames. Remove the old
  creative from the background before inserting its independent replacement.
  Include the blank September reservation, and distinguish half/full-page ads.
- September and October cover photo frames have different measured positions.
  Original cover-number baseline adjustments avoid overlaps with dashed rules.
- Four continuous photo spreads need their original paired native pages.
  October's completely white page 11 and odd 17-page issues remain intact.
- March CFUR has four paragraph-level editable stories with source wrap contours.
  President Q&A uses dedicated heading/question/answer frames where supported.
- Portable fonts preserve copy and measured geometry with known substitutions.
  A matching font family label alone does not prove matching glyphs. Recheck fit
  with private original fonts; never commit unlicensed font files.
- Use DesignCraft 0.9.0. A nearby older 0.6.0 CLI was incompatible; the bundled
  0.9.0 WebAssembly engine is the portable verified execution path.
- RGB warnings, low supplied image resolution and PDF colour-conversion changes
  remain observable limits. Overset is an export error, not an accepted warning.
  Image difference values are evidence, not a blanket fidelity score.
- Adobe InDesign opening and physical printer approval were not performed.

## Import and product lessons

- Stable original IDs and `sourceArchiveLinks` prevent duplicate imports across
  alternate source variants, replays and backup/restore. Title-only matching
  destroys identity and is unsuitable here.
- Preserve existing nonempty edited bodies, workflow status, real payments and
  submission dates. Filling an exact original-ID match's empty body is a narrow,
  explicit recovery action. Changed source fingerprints need visible review.
- Historical unknown payment/tier stays unset. Display unknown values in both
  article lists and editing controls; nullable select fields need an empty state.
- New unknown archived imports do not enter unpaid queues or inflate financial
  totals. Do not exclude genuinely paid archived records from financial history.
- ZIP metadata/file hashes bind the review token. Retry failed storage safely;
  only actual stored verified bytes can become attachments. Protect extraction
  paths, sizes, CRC checks, symlinks and packaged static asset roots.
- An edition with only metadata can still recreate its full original pages.
  Its empty article bodies must stay excluded from content-layout export, with
  a visible explanation and a server guard against stale/direct requests.
- On reimport, show both newly attached and already attached files. A bare
  “0 attached” result hides successful earlier recovery.

## Delivery and evidence baseline

- Local import produced 100 articles across seven publications and attached the
  two actual portraits. Reopening both JSON and ZIP proposed zero duplicates.
- All nine source variants exported in two modes: 18 exports / 306 output pages,
  with native, PDF and IDML outputs. Browser, actual server and offline kit flows
  were checked. Source ad geometry and removal were checked independently.
- The generated Drive delivery contained 37 files: nine PDFs, nine editable
  bundles, nine recipe ZIPs, article import/metadata exports, kit, guides/index.
  IDs and byte counts were read back. Reported SHA-256 values are local hashes;
  read-back sizes alone do not establish remote hash verification.
- The full application suite passed 310 tests at the initial final verification,
  with three optional external CLI checks skipped. Later export/UI checks passed
  12 targeted tests; TypeScript and the settled production build also passed.
  The final pre-push full suite passed 312 tests, with the same three skips.
  Rerun current checks when code changes; these are historical results.
- The app was imported locally. Production deployment was separate. A Git push
  must not be described as production data migration or a fresh deployment.
