# Independent visual review of source reconstructions

Reviewed October 22, 2026 against the original March and October PDFs. This review follows the independent [source layout audit](source-layout-audit.md). It covers the PNG/PDF artifacts generated under `artifacts/source-reconstruction/`, plus the browser-planner screenshot in `source-planner-browser.png`.

## What was checked

- Every supplied source PDF page was reviewed before implementation. The reconstructed source-artwork pages were then inspected together and the four editable recurring pieces were inspected at full page size: March President Answers, October Interim-President Question, Inside the Edge and the four-article CFUR page.
- Source regions, reservations and artwork were compared at the same page scale. Ads occupy their measured source positions; adjoining stories are clearly new editable placements in source blank areas.
- Text extraction from the edited background PDFs was checked for old questions, answers and article copy. March President background has no text; October President background retains only the podium label. Inside the Edge retains the feedback panel and typing label. The CFUR background retains attribution, contact details and the source folio, while the four editable stories have been removed from that background.
- Generated President/Inside the Edge PDF extraction contains one question and one answer for the editable feature. The October board remains source artwork, including its original names and feedback details.
- [source-artwork-pixel-check.json](source-artwork-pixel-check.json) compares 11 placed-artwork regions by rendering the original and exported PDFs with PyMuPDF at 144 dpi. Mean absolute channel differences range from approximately 0.46 to 3.87 on a 0–255 scale. This quantifies the preserved-artwork regions only; it is not a whole-page or editable-text fidelity score.

## Visual result and limits

The source artwork versions closely preserve the original collage, photographs, ad creative and board arrangements. The editable versions retain those backgrounds and rebuild their changing text as native document text. They are useful reconstructions with meaningful controls, rather than flat page screenshots presented as editable articles.

Portable fonts visibly change the results. March President question/answer line breaks differ from the original. October's Interim-President heading was expanded during review to restore a comparable visual footprint, but its substitute handwriting remains visibly different. The CFUR CN Centre body extends 18 pt into the original empty gap to fit the complete source copy with portable typography. Native text is editable, but these portable outputs should not be described as typographically identical. Optional private original fonts are a separate input; this review does not certify every licensed font profile.

Alumni Profiles, the original CFUR collage, the complete original President/Board page and source board/ad panels retain their existing content as placed source artwork. Their source names, biographies, portraits, attribution and QR codes do not become independently editable merely because the enclosing document is editable. The catalogue distinguishes these artwork choices from editable Q&A/article recipes.

The current browser planner screenshot shows editable Q&A text over its source illustration and links to the relevant source page. Its main page view is schematic: the complete house header/frame is present in generated output but is not fully represented in that screenshot. The preview labels composition fit unverified; generated preflight and output are the authority for fit.

Dates in the review outputs come from their test issue, so they intentionally differ from the stale source interior dates. Ads and QR codes reproduced from these historical sources are historical creative, not verification of current events, hours, offers, personnel or destinations.

## Findings raised during implementation

1. Inside the Edge's rebuilt question initially rendered black on dark green. The final reviewed image renders it white, matching the source contrast.
2. Its default answer initially contained `off-lim its`, caused by PDF line-break/soft-hyphen extraction. Final PDF readback confirms `off-limits` and no broken version.
3. The source CFUR artwork note initially described the editable companion as rectangular frames. The final source catalogue correctly describes rebuilt native frames with wrap contours from the paired IDML.
4. Early CFUR and President-with-story builds had native text oversets. The refreshed October 22 artifacts at approximately 21:20 UTC export all **16 source templates with zero failed exports**. Latest CFUR and President-with-story manifests have no preflight errors. The newly rendered CFUR page preserves the full CN Centre ending and has no visible text/heading collision.

Final visual reread covered the refreshed editable CFUR, Inside the Edge and October President images. No remaining duplicate-original-text overlay or layout collision was found in those default fixture pages. This is a check of the supplied source text; longer user edits still require fresh preflight.

This document records visual/content review independently of the compiler test agent. Adobe InDesign opening and a physical press proof remain outside the evidence gathered here.
