# Recreate an entire OTE issue

**Recreate a complete issue** in the DesignCraft planner loads every physical
page of a supplied issue at once. It includes the cover, advertisements, fixed
sections, President questions, board panels, photo spreads and blank editorial
pages, in the original order. The nine source issue PDFs contain 153 pages.

## Use the complete issue workflow

1. Open **Utilities → DesignCraft → Plan & compose** in OTEManager.
2. Under **Recreate a complete issue**, choose an original issue and a mode:
   - **Original pages · placed artwork** preserves the source pages as vector
     PDF graphics. Their printed text remains part of the placed artwork.
   - **Reconstruction · editable source text** separates the source graphics
     from supported text, rebuilding that copy in native editable text frames.
3. Choose **Load the complete issue**. The page overview shows every page,
   section, blank page and linked spread. Click a page to edit it; changing pages
   saves the current page in the issue plan. The previous workspace is retained
   in memory and can be restored.
4. Edit source fields and frame geometry with **Edit this page**, or generate the
   issue and edit the full native document in DesignCraft. Reconstructed covers
   have a separate photograph: replacing it removes the old photograph while
   retaining the source decorations. September and October retain their
   different photo-frame positions.
5. Reconstruction mode includes **22 measured advertisement frames**. On an ad
   page, choose its `source-ad-…` frame under **Edit this page**, then upload
   replacement advertisement artwork. The old creative is removed from the
   background, so a differently shaped replacement does not reveal it. The
   September empty reservation is also a replaceable frame.
6. To use new OTEManager articles, keep the current articles when loading, or
   import their exported OTE issue ZIP under **Import replacement OTE articles**.
   Open the destination page, choose an article recipe, assign the replacement
   articles and save. Unassigned replacement articles stay available without
   becoming unplaced content in the compiled issue.
7. Choose **Generate complete issue and open editor**. This composes the whole
   saved plan, checks page order and text fit, and exports a single native
   DesignCraft document, PDF and IDML. A 17-page source remains 17 pages; this
   workflow disables automatic print padding.
8. Download the issue recipe to keep an editable plan and its selected artwork.
   Workspace snapshots last only while the tab remains open. **Use this as a new
   issue** creates a copy with page additions, removal and reordering enabled.
   Update its printed source dates, cover teasers and page references as needed.

## Source coverage

| Supplied issue | Physical pages |
| --- | ---: |
| December 2024 · final layout | 17 |
| November 2024 · Issue 3 | 17 |
| December 2024 · print archive | 17 |
| September 2025 · Issue 1 | 18 |
| October 2025 · Issue 2 | 16 |
| Winter 2025 · Issue 5 | 17 |
| February 2025 · current revision | 17 |
| February 2025 · archived revision | 17 |
| March 2025 · Issue 7 | 17 |

The catalogue keeps the source variants separate. Four continuous photo spreads
retain their paired native pages. A complete-source plan enforces its recorded
page count and order; its spread partners must share a physical native spread.
October's completely white page 11 is preserved. Other blank editorial areas
retain their house headers and any partial source lettering.

The source PDFs include unfinished pages, repeated teasers, stale datelines,
an empty President response, placeholder copy and an unfilled ad reservation.
Those remain literal source content. Unknown release dates in Issue 5 and the
archived February revision are omitted from issue metadata. No absent articles
are invented.

## What is editable

The reconstruction rebuilds supported horizontal source text as native text
regions, usually one source line or style run per field. Source colour swatches,
point sizes and face names are captured. Portable builds use bundled fonts with
horizontal metrics calibrated to the original line width; private original
fonts retain their original metrics. This preserves the copy and point size,
but the substitute lettering and some baselines differ from the source.
The 2025 cover reference numbers have a measured baseline adjustment to clear
their dashed rules. Complete-issue proofs use the portable font profile;
rebuilding with private original fonts needs a fresh visual fit check.

March's CFUR page uses four recovered article records, with full paragraphs and
native wrap contours. The March/current-February President page and October's
President panel use dedicated editable question-and-answer frames. Other
supported source text in fixed sections is editable as source text regions
rather than being presented as invented article records. The supplied ad
creatives are raster artwork: replace their artwork in the separate ad frames.

Original photographs, illustrations, texture and decorative shapes remain
placed graphics. Advertisement creatives are separate placed graphics with
measured positions, including the older full-page and newer half-page
recruitment variants. Rotated lettering, tiny type and glyphs clipped at page edges
remain in those graphics. An artwork-mode page is explicitly labelled as
artwork. Use that mode when retaining the original typography matters most.

Replacement copy can need different space. Preflight blocks final PDF/IDML
export on overset and retains the complete copy and native draft for repair.
The source page recipes and measured ad/section reservations are also available
independently; see [individual source layouts](DESIGNCRAFT-SOURCE-RECREATION.md).

## Verification and reproduction

The full-issue checks use the real DesignCraft 0.9.0 WebAssembly engine. They
read back native and IDML page counts, source order, physical placement, original
artwork bytes, editable text and assigned article copy. The comparison tool
renders every exported PDF page beside its corresponding original, at the same
scale. Image differences are recorded as measurements, not as a quality score.

Evidence:

- [Whole-issue checks and page comparisons](designcraft-review/source-whole-issue-check.json)
- [Independent visual review](designcraft-review/whole-issue-visual-review.md)
- [Browser complete-issue generation](designcraft-review/source-issue-planner-browser.json)
- [Server complete-issue generation](designcraft-review/source-server-whole-issue.json)
- [Downloaded toolkit complete-issue generation](designcraft-review/source-offline-whole-issue.json)
- [All measured ad spots](designcraft-review/source-ad-spot-check.json)
- [Source issue map](../public/designcraft/source-issue-maps.json)

```sh
python3 tools/designcraft/build-source-issues.py
node tools/designcraft/check-source-issues.mjs public/designcraft/source-issues/*/*-issue.json
python3 tools/designcraft/compare-source-issues.py
python3 tools/designcraft/check-source-ad-spots.py
node tools/designcraft/check-source-issue-planner.cjs
node tools/designcraft/package-template-kit.mjs
npm test
npm run build
npm run typecheck
```

Proofs are written to `artifacts/source-reconstruction/whole-issues/<source-id>-<mode>/`
as `issue.pdf`, `issue.designcraft`, `issue.idml`, `build-manifest.json` and
`verification.json`. Exported recipes include the selected source assets and
compile with the downloadable template toolkit. The toolkit itself does not
duplicate the full historical PDF archive. Adobe InDesign opening and physical
press approval have not been checked.

Verification on October 22, 2026: all nine issues exported in both modes, with
the original page counts (306 output pages across 18 complete exports). All 22
ad spots passed independent placement and background-removal checks. Chromium,
the actual server queue and an independently installed downloadable toolkit each
generated a full 17-page issue; the browser also replaced an ad and round-tripped
the whole recipe. The application suite passed 281 tests, with three optional
native-CLI checks skipped. Production build and both TypeScript checks passed.
Source RGB colours and the cover photograph's supplied resolution produce
preflight warnings; the final issue exports have zero preflight errors.
PDF colour conversion also lightens September's grey ad placeholder in the
native export, although its original crop bytes and geometry are retained.
