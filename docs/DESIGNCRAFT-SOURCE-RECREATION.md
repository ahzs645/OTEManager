# Recreate the supplied OTE layouts

For a whole newspaper, use **Recreate a complete issue**: all nine supplied
issues, 153 pages, including covers, advertisements, fixed sections, blank pages
and linked photo spreads. See the [complete issue workflow](DESIGNCRAFT-WHOLE-ISSUES.md).
The individual page tools below remain available for assembling new issues.

The DesignCraft planner now includes **Recreate an original page**. Its 16 source
presets and 11 measured reservations come from the supplied March 2025 and October
2025 PDFs and their paired IDML. The source audit covers all 12 distinct PDFs,
156 pages, and the other versions' different ad and section placements.

## Use it in OTEManager

1. In **Publications**, select the issue articles and images, then **Open selected
   in DesignCraft**. Alternatively import their DesignCraft ZIP under
   **Utilities → DesignCraft → Plan & compose**.
2. Under **Recreate an original page**, choose a source layout. Its PDF link opens
   the exact reference page; the notes identify editable content and preserved
   artwork. Assign the articles in order, or use a fixed section without articles.
3. **President Answers**, **Interim-President question**, and **Inside the Edge ·
   editable Q&A** expose their heading, question and response under **Edit this
   page**. Each field has its own position and typography controls. The original
   illustration and portrait stay behind the editable text.
4. **CFUR Radio · four editable articles** accepts all four March brief articles
   in source order: carbon capture, CN Centre, RCMP scams, compost program. All
   titles and bodies become native editable text. Invisible source contours wrap
   copy around the torn-photo artwork. The source photos, sponsor panel, texture
   and folio remain placed original artwork.
5. To build a different page with an ad, start with a normal story recipe and use
   **Add measured reservation**. The Thirsty Moose, recruitment and CFUR event
   presets carry their measured positions and original vector PDF creative.
   Source page presets already contain their fixed artwork; edit those frames
   directly. Extra reservations do not automatically rescale a source layout.
6. Choose a recurring section, optionally change an editable house header's letter, and **Save
   page in issue plan**. The source header is literally A; named sections do not
   imply historical News/Arts/Opinion codes. Page-specific ad and editorial
   assignments override legacy shared defaults independently.
7. **Generate & edit** produces the saved issue and opens its native document in
   the editor. **Compose in this browser** can also generate one page. Inspect
   the generated PDF for the full house design: the planning frame preview is
   schematic. A longer replacement answer or article may need more space; final
   PDF/IDML export stops on overset, with the complete source and draft retained.

The artwork-only presets are useful for preserving a historical section exactly.
They are identified as **source artwork**, including Alumni Profiles, the original
CFUR collage and the original board panel. Text within a placed PDF is not a
newly editable article. Generic automatic layout suggestions exclude historical
source presets so they cannot accidentally insert an old advertisement.

## Source fidelity and practical limits

- Dates and issue metadata in generated house headers come from the selected
  issue. Several source interior headers contain stale dates; those are recorded
  in the audit, rather than treated as the new issue's release date.
- Many source PDF article regions are blank. The four CFUR bodies and other
  recovered March articles come from the source IDML; absent articles are not
  invented. The comparison proof uses those recovered bodies in full.
- Original artwork remains vector PDF. Editable text uses bundled substitutes
  when original fonts are unavailable. Captured styles retain the original face
  names and scoped portable replacements; original-font composition can use
  private supplied faces. The bundled Salted face differs visibly from some
  source handwriting, so matching a font family name alone is not a guarantee of
  matching glyphs.
- The CN Centre body extends 18 pt into the source's empty gap so the portable
  serif fits every word at the original 10 pt size / 14 pt leading. Its original
  bounds remain in `sourceRect`. Other source geometry and wrap contours are
  retained; changing copy still requires checking fit.
- The source features use the shared JavaScript/WebAssembly compiler on both
  browser and server. A CLI-configured server also routes these new features
  through that compiler. Rebuilding protected pages for these layouts is not
  supported. Adobe InDesign opening and a physical press proof are separate
  checks and have not been performed here.

See the [source audit](designcraft-review/source-layout-audit.md),
[visual comparison](designcraft-review/source-reproduction-comparison.jpg),
[composition evidence](designcraft-review/source-reproduction-check.json), and
[browser round-trip evidence](designcraft-review/source-planner-browser.json).
Numerical image differences cover the shown content regions; they are not a
whole-issue quality score or a claim of pixel identity.

Verification on October 22, 2026: all 16 presets exported PDF, IDML and native
documents with complete source copy and zero preflight errors. The application
suite passed 265 tests; three optional native-CLI checks were skipped because a
matching standalone CLI was not configured. Production build and both TypeScript
checks passed. Chromium verified editing, saving, recipe export/import and browser
composition. A real server job verified four-article validation, bundled-artwork
staging and final artifact collection. Original-font fallback was exercised through
the browser worker, server and standalone JavaScript command. Retained source RGB
swatches and empty decorative frames still produce warnings.

## Repeat the work

The Drive file metadata identifies `OneDrive_2026-10-09.zip` (1,783,807,640 bytes).
The connected downloader's 256 MiB limit prevented a fresh raw ZIP download in
this session. The committed original PDFs were independently checksum-verified
against `documents.json`; source IDML, original artwork and the existing recovered
article fixture were used locally.

```sh
python3 tools/designcraft/extract-president-source.py
python3 tools/designcraft/extract-cfur-source.py
python3 tools/designcraft/build-source-presets.py
node tools/designcraft/check-source-reproduction.mjs
python3 tools/designcraft/compare-source-reproduction.py
node tools/designcraft/package-template-kit.mjs
npm test
npm run build
npm run typecheck
```

The downloadable template kit now contains the same compiler modules, fonts and
headless engine. Exported page/issue recipes carry their selected source artwork.
Extract the toolkit, run `npm install`, and follow its `README.txt` to compile a
recipe with `node tools/designcraft/compile.mjs`. No source ZIP or private fonts
are needed for the portable preset proofs.
