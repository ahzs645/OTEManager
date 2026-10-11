# OTE DesignCraft companion workflow

OTEManager now has **Utilities → DesignCraft layouts** for the PDF archive and
page planner, and **Publications → DesignCraft ZIP** to export an issue's exact
stored Markdown, original photographs/graphics, captions and stable IDs.

The review and template toolkit live in `public/designcraft/`. They can also run
as a static Site or locally with `python -m http.server 8000 --directory public/designcraft`.
The full-view route is `/designcraft/index.html`; native export runs through the
downloaded stock DesignCraft CLI, not inside the hosted Site.

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

## Layouts and exports

The reconstructed catalogue contains 76 story recipes, 14 ad reservations,
six custom pieces and eight cover variants, for 104 definitions. Schematic PDF
pages demonstrate geometry; seven native examples include actual rendered PDFs,
editable `.designcraft`, IDML, complete source records and preflight reports.

The browser imports the OTEManager issue ZIP, lets the editor assign articles,
reserve boundaries and edit shared custom fields, and downloads a recipe ZIP.
Interior stories adapt into the largest remaining rectangular area. This does
not perform arbitrary wrapping around disconnected regions.

The included compiler retains complete article text and rejects overset final
exports. It composes through stock DesignCraft v0.4.0 command APIs. Actual OTE
logo artwork remains a graphic; new editable typography uses Source Sans 3 and
Source Serif 4 with their OFL notices. Manual photo focus uses the same clamped
crop formula in browser and native output, preserving original image bytes.

Source 2025 covers reference Decalotype Black, Helvetica Neue and Salted.
Salted's file was not found. Original font profiles are documented but not wired
into the new compiler. Proprietary fonts are not bundled.

## Development and validation

`tools/designcraft/recover-sources.py` extracts and deduplicates source documents;
`build-library.py` creates the explicit recipes and schematic catalogue;
`package-review.py` builds the PDF guide, gallery inventory and ZIP packages.
Recovery/packaging require PyMuPDF and ReportLab. The native compiler itself uses
Python standard library only. See `native-readme.md` for exact CLI usage.

The browser QA script optionally uses playwright-core and Chromium; repository
integration tests cover anonymity, exact Unicode/Markdown/media preservation,
duplicate-name paths, rejected incomplete media, and the existing DOCX export.

## Remaining integration

- Native export service inside OTEManager hosting; current export supplies input
  content and the planner recipe for a local compiler.
- Native whole-issue cover and double truck preservation. Recipe fields currently
  record preservation requests; the single-page compiler does not implement them.
- Automatic cover-reference updates when issue page order changes.
- Original font profile loading and metrics/glyph verification.
- Opening and comparing generated IDML in Adobe InDesign. A DesignCraft IDML
  roundtrip is not Adobe verification.
- Browser/WASM command bridge to remove the local CLI dependency.

The double truck is the continuous centre spread. A 16-page issue uses 8/9;
a 20-page issue uses 10/11. A finished booklet needs a multiple-of-four count.
Several supplied 17-page files are unfinished layouts.
