# OTE pipeline review and integration

The reviewed workflow now selects OTE articles, plans editable newspaper pages,
generates native DesignCraft/PDF/IDML output, and replaces content in a matched
existing native issue with checked preservation. This is implemented and tested
locally; production and the older hosted review Site have not been updated.

## Review scope

Both packages were recursively compared, including nested ZIPs, source PDFs,
IDML/INDD, linked artwork and fonts. The main package contains 424 meaningful
entries through three nested ZIPs, 167 distinct hashes, 12 PDFs (156 pages),
12 IDML and 18 INDD files. The companion has 349 recursive entries and 166 hashes.
Seven published archive PDFs contribute 107 physical pages. Source IDML contains
522 stories. Inventories, rendered pages, hashes and paired comparisons remain
in the local review evidence; duplicates were identified by content.

The source PDFs mostly contain reusable shells. Finished website issues are a
separate reference corpus. Nine available InDesign-PDF/IDML pairs (153 pages)
were compared again with the supplied fonts. Missing content/artwork and import/
preflight differences prevent claiming a faithful automatic remake of every
finished historical issue. INDD itself needs Adobe; IDML was the editable source.

## Connected workflow

1. In Publications, select articles and photos/graphics. Open the selection in
   the planner, or download a ZIP. Article choices apply to that export; image
   preferences are saved and shared with existing exports.
2. Set date/year, volume/issue, front headline/caption, image and focus. Choose
   up to three featured articles by stable ID. Their references resolve to the
   actual opening pages after interior placement.
3. Choose layouts and edit frame geometry, font size/leading, selected photos,
   matching captions, fitting and focus. Upload custom/ad image or PDF artwork.
4. Assign a continued article to its saved pages and declare their ordered IDs.
   The compiler retains one complete body and threads the allocated frames.
   It never splits or shortens copy by an estimated capacity.
5. Generate the current page or whole issue on a configured server. Continued
   articles require whole-issue generation. Bounded jobs return native/PDF/IDML,
   source, reports, fonts and checked metadata. Recipes and a verified local CLI
   remain available for standalone use.
6. To remake a matched existing issue, supply its native file/build manifest in
   a base ZIP and protect selected pages. Protect both halves of a continuous
   spread together. Conflicting identity, source, fields, media or intersecting
   threads block export. Use a separate output directory.

Original2025 uses the supplied valid Salted font and controlled Helvetica Neue
faces, alongside recovered Decalotype. The Helvetica ZIP has 52 files; controlled
selection avoids ambiguous duplicate faces. Proprietary fonts remain private
configuration, outside public assets. Portable output uses licensed open fonts.
Native composition decides fitting; the browser previews geometry.

Native cover references use named headline anchors and follow native edits/page
moves. Folios use native automatic page-number fields. A generated cover can retain its stored objects/stories while a rebuilt
headline updates its reference. Protected destinations without anchors use an
explicitly checked static fallback. Static references need an editable cover
when their destination moves. Unresolved references get a separate check because
stock preflight can miss them.

## Independent findings and corrections

| Finding | Correction |
|---|---|
| R1: protected facing-page assignments could swap | Validate actual-page frames, article bodies/metadata and manifest assignments. |
| R2: stable IDs could bind to the wrong page | Validate recorded order/native identity and matched native/source hashes. |
| R3: empty legacy bookmarks broke Markdown | Ignore only empty bookmarks; preserve visible copy and literal code. |
| R4: failed imports discarded live work/media | Stage and validate the complete import before committing. |
| R5: saved/custom recipes reset typography | Restore exact working templates, slots, size, leading and geometry. |
| R6: JSON-only exports omitted photos | Require all retained original media and package its original bytes. |
| R7: duplicate/unplaced articles exported invalid plans | Validate in browser/compiler; duplicates need an exact continuation chain. |
| R8: same-name protected photo replacement was ignored | Compare actual embedded/source hashes and reject conflicting bytes. |

Follow-up checks cover nonfeatured metadata/media changes, inherited cover fields,
in-place rebuild refusal, dangling old hyperlinks, unmanaged reference targets,
quoted headlines, upload/storage deadlines and safe archive paths.

Stock IDML drops URL links, parent overrides, numbering and frame labels. Checked
companion reopening restores those records after exact text, physical-page story
and unambiguous frame checks. Adobe does not consume the sidecar. Native references
and whole story chains survive the checked path.

## Verification and remaining boundaries

The final application suite passes 45 tests, the compiler suite passes 32 tests,
and nine native helper tests pass on each of engines 0.4.0 and 0.6.0. Type checking
and production build pass. The actual built Linux container serves the production
planner and completes native exports with both font profiles. Its failure proof
retains the exact source/native draft and withholds final PDF/IDML. See the
[committed evidence and reproduction instructions](designcraft-review/README.md).

The updated 104-template sweep passed preflight and 312 repeated cycles with
unchanged text/assets and raster output. The earlier original-font sweep also
passed 104 recipes/312 checked cycles. A four-page long-source fixture overflowed
its first page by 5,406 characters; threading pages 2/3 gave zero final errors and
warnings. Three checked issue cycles retain the 12,331-character rendered body,
original Markdown, two-frame order, one URL, assets and identical page rasters.
The original-font whole-issue proof also passes preflight.

Actual React selection components hand the real selected API ZIP to the actual
Utilities iframe without a download. The production planner/API handler, through
a thin HTTP adapter, queues a real compiler and returns native/PDF/IDML downloads.
Browser checks cover reload, artwork/photos, missing media, rejected imports and
placement failures. Test logs and scripts are packaged with the final evidence.

Fresh Adobe InDesign reopen/export, physical printer approval and native Mac/
Windows execution remain unverified. Archive selection/checksum/extraction tests
on Linux do not establish desktop runtime behavior. The worker registry is local
to one process; multiple replicas need sticky routing or shared job/status storage.
Optional stored artifacts are durable, but in-memory job status does not survive
a restart. Local changes have not been deployed.

## Other publishing systems

| Approach | Useful precedent | Boundary |
|---|---|---|
| Adobe InDesign/InCopy | Named destinations, references, linked stories, editorial collaboration. | Fresh Adobe runtime required. Smart Text Reflow can add pages and needs control with a fixed newspaper page budget. |
| Paged.js | HTML pagination and target-counter references; MIT. | Useful PDF comparison adapter; no documented editable DesignCraft/IDML output. |
| Vivliostyle | Markdown/HTML, root columns, page floats, counters, PDF/EPUB/WebPub; AGPL. | Web document source; exact OTE fitting needs its own fixture. |
| Scribus | Editable linked frames, photo placement, overflow checks and scripted PDF; GPL. | Imports IDML, but does not export it; runtime testing still needed. |

Primary references: [Adobe references](https://helpx.adobe.com/indesign/desktop/indexes-and-references/references-and-bookmarks/insert-cross-references.html),
[Adobe threading](https://helpx.adobe.com/indesign/desktop/add-and-manage-text/add-and-import-text/thread-text-frames.html),
[Smart Text Reflow](https://helpx.adobe.com/indesign/desktop/add-and-manage-text/add-and-import-text/set-up-smart-text-reflow.html),
[Paged.js](https://github.com/pagedjs/pagedjs),
[Vivliostyle CSS](https://docs.vivliostyle.org/en/reference/supported-css-features/),
[Scribus scripting](https://github.com/scribusproject/scribus/blob/master/doc/en/scripterapi-textframes.html),
[Scribus IDML importer](https://github.com/scribusproject/scribus/blob/master/scribus/plugins/import/idml/importidmlplugin.cpp),
[DesignCraft release](https://github.com/storytold/designcraft/releases/tag/v0.4.0).
These were researched from primary sources, not benchmarked or copied into the
implementation. Complete issue/media JSON remains engine-independent.
