# Independent whole-issue visual review

Review date: October 22, 2026. This extends the [source PDF audit](source-layout-audit.md) and the earlier [fixed-piece review](source-visual-review.md) to complete issues.

**Final review complete:** all nine reconstructed issues, 153 physical pages, were visually reviewed. The refreshed September and October PDFs were reread after the last corrections. No remaining text-overlay duplication, source-picture deletion or rule/text collision was found in the reviewed default pages. The [review record](whole-issue-visual-review.json) identifies the exact PDF hashes and targeted final checks. The separate compiler verification passes all 18 issue/mode combinations, including source page count/order, copy, media and declared spreads.

The reference set is the nine hash-verified issue PDFs in `public/designcraft/originals/`: 153 physical pages. The [source issue maps](../../public/designcraft/source-issue-maps.json) retain their physical order, original page sizes, four continuous photo spreads, blank pages, unfinished reservations and draft content. Reconstruction proofs are read from `artifacts/source-reconstruction/whole-issues/<document-id>-reconstruction/issue.pdf`.

## Review scope

All nine reconstruction PDFs were reviewed as complete contact sheets, covering all 153 physical pages. Detailed inspection covered their covers, March Inside the Edge and President Answers, October President/Board/feedback, March Alumni Profiles and CFUR, both generations of recruitment ads, Thirsty Moose ads and the October CFUR event ad. All four linked photo spreads were checked: December Wildlife p8–9, archived February Wildlife p8–9, current February Winter Contest p8–9 and September Campus Corners p12–13. Source blank areas and the wholly blank October page 11 remain in their original order.

Source images, decorative backgrounds, original article positions and the source blank pages are preserved. The March CFUR contribution has four independently assigned article bodies; March President Answers has semantic question and answer fields. Other supported source copy is rebuilt as native text regions, often one source line or run per field. This does not imply that every line is a separate OTEManager article record.

Editable text uses portable font substitutions where the source faces are unavailable. The result is close in page structure and artwork but differs in lettering, line widths and some baseline positions. Source-artwork mode remains a separate choice when the original typography must be retained.

These full-issue proofs use the **portable font profile**. Full issues rebuilt with privately supplied original faces have not been visually verified. Geometry adjustments calibrated to substitutes, including the 2025 cover numbers, require a fresh fit/visual check with those original faces. The gray unfilled September ad placeholder also renders lighter through the PDF color conversion than in the source, despite retaining its exact geometry and single crossed frame. This is a known appearance limit, not a new booking or missing creative.

## Content-layer checks

The whole March p6 background contains no text, and the March p13 graphics layer contains no article text. March Alumni p10 retains only its rotated SECTION labels as source artwork. October p4 now uses the dedicated semantic President panel: the original upper-panel text, including its rotated question, is removed from the whole-page graphics. Independent extraction of that refreshed background returns only whitespace. The source heading, question and response are supplied by the native semantic panel, rather than being drawn over an old question.

An additional [background text check](whole-issue-background-text-check.json) covers all **153 reconstructed pages**. It compares native field strings of at least 12 characters with text remaining in their placed PDF graphics and finds **zero matches**. This checks extractable background text; rasterized lettering and very short labels still require visual review.

A separate [native overlap check](whole-issue-native-overlap-check.json) compares identical native field strings in overlapping field frames across those same 153 page templates. The corrected catalogue has zero candidates. This complements background checks, since two newly rebuilt text fields can overlap even when the background is text-free.

The recreated source issue retains source-template residue intentionally: old datelines, repeated cover teasers, an empty answer in Issue 5, placeholder CFUR copy in the archived February revision, and the unfilled September ad frame. These are visible properties of the supplied files. No new article copy is inferred for their blank editorial pages.

## Issues raised during review

- Cover photographs were initially duplicated beneath their replacement crops. The refreshed background PDFs independently render with those primary photographs removed; the remaining 1 × 1 transparent image resources are PDF deletion placeholders. Source overlays are separate, and the 2025 paper plane is restored above the photograph. September's taller cover frame is now measured from its own source border rather than borrowed from October: `[61.589,132.090,694.460,458.673]`.
- The generic line-based extraction initially discarded soft hyphens without joining their split words. The builder now preserves them as visible `-` in source-line fields; semantic paragraphs can join/reflow their words separately.
- October p4's feedback text initially touched its decorative dashed rule. Its source fields have been shifted down 3 pt; the final rendered crop confirms a clear gap and preserves the visible `im-` line ending.
- The generic October President heading initially occupied less width than the source handwriting. The whole page now uses the dedicated semantic panel; portable substitutions still change the letter forms.
- Replacing October's upper panel initially risked retaining its old rotated question beneath the new content. Explicit upper-panel text removal now clears that background completely before the native question is added.
- The first whole-issue ad pages retained their creative inside the full-page background. The corrected catalogue has **22 separate native ad frames**. Independent image inspection confirms all 21 supplied raster creatives are removed from their background PDFs. September's unfilled reservation is a separate source-art slot; the gray fill and crossed diagonals are both removed from its background, while the house header and dashed frame remain intact.
- Introducing October's semantic panel initially left an old rebuilt `Question` field alongside the new subtitle. A fresh full-page render exposed the doubled headline. The header selection now stops at 65 pt, excluding that source heading. Final PDF extraction and visual reread both confirm one `Question` heading; the native-overlap check is clear.
- Portable font ascenders initially placed the large 2025 cover feature numbers against their dashed row rules. Source/output baseline comparison measured an 18.079 pt displacement. Final September and October cover renders show all three numbers clearly within their rows, with source baselines restored. The [source/final comparison](whole-issue-cover-number-comparison.png) records that correction. Recheck it if original fonts are supplied.

The final whole-issue compile report and refreshed proofs establish the reported result; earlier draft files are not the final evidence. This review does not certify Adobe InDesign opening or a physical press proof.
