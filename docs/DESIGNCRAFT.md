# OTE DesignCraft companion workflow

OTEManager now has **Utilities → DesignCraft layouts** for the PDF archive and
page planner, and **Publications → DesignCraft ZIP** to select articles and images
for a download or direct planner handoff containing exact stored Markdown, original selected photo/graphic
bytes, captions and stable IDs.

The review and template toolkit live in `public/designcraft/`. They can also run
as a static Site or locally with `python -m http.server 8000 --directory public/designcraft`.
The full-view route is `/designcraft/index.html`; native export runs through the
configured server worker or downloaded stock DesignCraft CLI. The standalone static Site offers recipe downloads.

Sites project: OTE DesignCraft Review, private to its owner by default.
Source and version 3 are saved and published successfully at
https://ote-designcraft-review.ahmadjalil645.chatgpt.site. The confirmed publication
time, exact recovery IDs, archive metadata and source commit are in
`docs/designcraft-site.json`. Owner-private access is preserved.

The hosted Downloads section contains the complete 248,016,083-byte ZIP,
served as twelve pieces below the static per-file limit. The browser checks
SHA-256 for each piece before joining them into the byte-identical original ZIP.
Cancellation and integrity-failure paths were verified alongside the completed
browser download. The direct template-kit link and original PDF reading copies
use immutable OTEManager commit `c8c4b8f3b997f4017b94b85cbb01b7255eaca58a`.
Remote PDFs are loaded as typed blobs for inline viewing. This avoids duplicate
assets and keeps the saved deployment archive below the Sites 256 MiB input
limit. The hosted source lives in the Site repository, independently of this
repository's standalone review page.

## Provenance

The earlier `ote-layout-study` prototype and its generated downloads were not
recovered. This commit recreates its documented families and companion workflow.
The original user-supplied Drive archive was recovered, including 12 distinct
PDFs with 156 pages, 12 IDML files, and the actual OTE logo artwork. Duplicate
files share one record; different revisions remain separate. Source paths and
original SHA-256 hashes are in `documents.json`.

Original PDFs in `originals/` are byte-identical. Large reading copies in `pdfs/`
were optimized for static hosting. The Site uses reading copies; the complete
review ZIP additionally includes the original PDFs. The supplied raw source
archive and proprietary font files are excluded.

## Corrected page and issue workflow

The planner supports saved consecutive issue pages, stable IDs, reordering,
shared blocks, and whole-issue recipe export. Cover references follow actual
interior page assignments. Use `compile-template.py` for one page or
`compile-issue.py` for a complete facing-page issue. A native base supports
checked cover/centre-spread preservation. Native PDF output requests PDF/X-4.

Full source Markdown remains in source records; supported CommonMark is converted
to styled native stories. Explicit `bodyFormat: "plain"` keeps literal text.
Fonts are loaded before composition and native drafts are reopened before final
preflight. Focal crops now transfer for both asset and article-photo slots,
including browser-exported covers. The crop transform and image bytes are checked.

New typography uses licensed Source Sans 3, Source Serif 4 and JetBrains Mono.
Those substitutions do not reproduce missing original source fonts.

## Recursive audit, October 2026

The supplied source ZIP was recursively expanded through three nested ZIPs:
424 non-resource-fork file entries, 167 distinct payload hashes, 12 PDFs,
12 IDML files, and 18 distinct INDD files. All 156 source PDF pages and 107
physical PDF pages from the seven published issues were rendered and reviewed.
The source PDFs are largely reusable shells with blank article regions, rather
than finished copies of the website issues. February's nine PDF pages include
seven facing spreads, representing 16 newspaper pages.

All 522 source IDML stories matched imported text after whitespace normalization.
Three stock cycles retained exact imported story strings and embedded assets.
They exposed loss of parent-item overrides and URL hyperlinks. The checked
companion path stores `interchange-metadata.json` and restores those records after
verifying story text/ranges and page/object identity. Adobe does not consume this
sidecar. Consult pixel comparisons and source preflight before claiming fidelity.

All 104 corrected recipes pass illustrative-copy native preflight and three
repeat cycles. Testing every recipe with the same recovered March story and
original media gave 62 exports and 42 full-copy overflow drafts. This is a fit
stress test, not 104 different editorial pages or a complete historical remake.

The 16-page issue proof passed preflight. A subsequent edit retained its cover and
pages 8/9 exactly. Moving a referenced article while protecting its cover was
rejected; making that cover editable updated its reference. Browser checks passed
issue import, saved pages, reordering, recipe reload, mobile width, original
text/media retention, and native compilation. The final compiler suite passes 32 regression tests, including native checks.

## Running and repeating checks

See `tools/designcraft/native-readme.md` for commands and preservation constraints.
Install `requirements.txt` for compilation, `requirements-audit.txt` for audits,
recovery and packaging. Set `DESIGNCRAFT_CLI` and run `test-workflow.py` for native
regressions. `verify-workflow.py` sweeps recipes and repeated cycles;
`audit-sources.py` audits a source ZIP recursively.

The review runs over HTTP from `public/designcraft/`. The local corrected kit and
ZIP contain this work. The published Site described above is the earlier version;
these changes have not been deployed there.

## Remaining limits

Source repair resolves verified Helvetica family aliases and unambiguous linked
resources, preserving layout geometry and text. Every original IDML still reports
native preflight problems; some involve hidden/retained template objects. The later Salted and Helvetica uploads resolve those font gaps for the private original2025 profile; some original package files are still zero bytes and some linked artwork remains absent.
Do not solve these by silently shrinking text or inventing replacement graphics.

INDD cannot be opened by the stock CLI; paired IDML was audited where available.
Generated IDML needs Adobe InDesign review, and PDFs need printer validation.
OTEManager now includes a bounded asynchronous native worker at `/api/designcraft/native`; configure the CLI, Python and fonts on the server as described in `designcraft-native-service.md`. This local change has not been deployed. There is no browser/WASM renderer. Proprietary fonts remain outside public assets.

## Supplied fonts and cover form follow-up

The later upload provides a valid full Salted TTF and 52 Helvetica Neue font
files. Original2025 is an optional local compiler profile using a controlled
private font directory; these proprietary fonts are excluded from public assets.
All 104 recipes passed preflight with this profile and 312 checked IDML cycles
retained source text, media, links and parent state with identical raster output.
All 12 original IDML files were retested, and nine paired InDesign PDF exports
(153 pages) were compared again. Correct fonts do not fix imported frame fitting.

The cover form controls release date (including derived year), volume/issue,
headline/subtitle, caption/credit, uploaded photo and focus. Up to three selected
article IDs resolve to actual interior pages after reordering. Both compilers
resolve saved fields; ZIP reimport retains image bytes, extension and MIME type.
Unplaced or duplicate features block export. A four-page proof using a recovered
article and explicit 22pt headline variant passes native preflight and three
checked cycles. The proof demonstrates reuse; it is not a complete historic issue.

## Selected article export from Publications

Synced with main commit `0eff034`, which added persistent image export selection.
The DesignCraft ZIP button now opens the issue export dialog. All issue articles
start selected; choose individual articles, select all, or clear. Article choices
apply only to that download. Images use saved `includeInExport` preferences,
shared with DOCX/WordPress exports; graphics are included in the DesignCraft view.
Export waits for image preference saves. An empty selection disables download,
and failures keep the dialog and selection open.

The dialog POSTs `{articleIds: [...]}` to
`/api/exportIssue/:issueId?format=designcraft`. The server rejects empty, duplicate,
malformed or cross-issue IDs and packages only the requested issue articles in
selection order. It includes selected original media bytes and fails if required
media is incomplete. Missing media in omitted articles is not fetched. Existing
GET DesignCraft exports include the whole issue and respect image preferences;
the default DOCX export retains its existing behavior.

Import the downloaded ZIP in Utilities → DesignCraft layouts, choose layouts and
article placement, set cover fields/features, and download a page or whole-issue
recipe. Compile that recipe using the template kit and official CLI, then open
the resulting `.designcraft` file in the native program. The content ZIP itself
is not a native document; use the configured native worker or standalone compiler
to generate editable output.

Verification used the actual POST handler and isolated Convex storage, then the
actual Publications components with query/mutation transport stubbed for browser
QA. The selected ZIP imported into the production planner, retaining exact body
and image bytes. Its saved recipe compiled to native/PDF/IDML with zero errors
and warnings and passed three checked cycles. The compiler suite has 32 tests; the application suite has 45 tests.
Type checking and production build also passed.

## Integrated native workflow and independent-review fixes

Publications now offers **Open selected in planner** alongside the ZIP download.
The same selected-article API response transfers to the same-origin Utilities
iframe, retaining original media. Recipe downloads still support standalone use.
The planner can generate the current page or saved whole issue through a configured
server; it polls queued/running jobs and exposes source, native draft, preflight
and final artifacts. Failed composition blocks PDF/IDML and retains full source.
The service supports bounded ZIP extraction, concurrent jobs, timeouts, retention
and optional existing-storage persistence. See `designcraft-native-service.md` and
`Dockerfile.native` for installation; production has not been updated here.

Frame controls retain explicit geometry, size and leading through save/reload.
Photograph slots choose a specific article photo with matching caption, fitting
and focus. Custom/ad slots accept original image/PDF artwork. PDF artwork is
verified in the native proof. Choose the portable or configured original font
profile; proprietary fonts are not redistributed in the public template kit.

For continuations, save pages assigning the same article, then declare exactly
those stable page IDs in order. `layoutPlan.articleFlows` maps each article to
`{pageIds:[...]}`. The compiler places the full body once, stages empty continuation
frames, links their native story, and preflights the assembled issue. It never
cuts copy at a guessed character count. Overset can defer only for explicitly
labelled continuation body frames; other page errors and final overset block final
exports. Protected pages cannot belong to a newly rebuilt thread.

New cover features use native named headline anchors and cross-references, so
subsequent DesignCraft edits update headline/page text. New issues use leading-zero
page numbering. Every expected reference is checked separately because stock
preflight can report zero errors for a missing target. Protected headlines without
an existing anchor use an explicit checked static fallback, recorded in the build
manifest. Keep the reference manifest for later checks. Protected covers still
require consistent source fields and placements in the OTE rebuild plan.

The independent review's eight defects are addressed: actual-page body checks and
manifest page bindings prevent swapped protected assignments; empty legacy
bookmarks preserve visible copy; imports validate before committing; saved/custom
recipes retain typography; all retained media must be available; duplicate or
missing placements reject export unless covered by an exact continuation chain;
and protected cover photographs compare actual embedded bytes. Rebuilds require a
separate output directory and a matched base/manifest. Native object and story
preservation remains an exact check.

## Other publishing approaches

Adobe's named destinations/cross-references and Smart Text Reflow are useful
references for anchors and linked frames; InCopy adds editorial collaboration.
Paged.js provides HTML pagination and `target-counter()` with MIT licensing.
Vivliostyle documents newspaper columns, page floats and cross-reference counters,
with HTML/Markdown inputs and PDF/EPUB/WebPub output (AGPL). Scribus offers editable
linked frames and PDF scripting (GPL); its IDML plugin imports but does not export.
These were researched from primary sources, not installed or benchmarked. None
establishes fidelity to the supplied OTE layouts or replaces Adobe proofing.
The existing engine-independent issue JSON is retained so another adapter can be
compared against the same long-article, photos, references and reload fixtures.

Checked IDML reopening now restores numbering sections and text-frame labels after verifying exact physical-page story multisets and unambiguous frames. The long continuation proof retains its leading-zero reference and identical raster output across three checked cycles. Stock IDML alone still loses these records; Adobe does not use the companion sidecar.

## Final verification record

The [committed review evidence](designcraft-review/README.md) includes the report,
proof bundle, checksums, machine-readable closure and reproduction commands.
The final application suite passes 45 tests, the compiler suite passes 32 tests,
and nine native helper tests pass on each of DesignCraft 0.4.0 and 0.6.0.
Type checking and the production build pass. The actual built Linux native
container exports both portable and privately configured original2025 proofs,
and correctly retains a full-source failed draft while withholding PDF/IDML.
Adobe, printer and native Mac/Windows verification remain outstanding.
