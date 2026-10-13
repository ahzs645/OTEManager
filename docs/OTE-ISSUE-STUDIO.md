# OTE Issue Studio sample Site

Live private Site: [OTE Issue Studio](https://ote-issue-studio.ahzs6455.chatgpt.site). The existing review Site remains separate.

The user requested a standalone sample demo rather than a connection to a deployed OTEManager. This Site presents the verified pipeline review, evidence and updated toolkit alongside a working browser demo. Site identity, source commit, version and deployment are recorded in `ote-issue-studio-site.json`.

## Demo behavior

Select one to three clearly illustrative stories and change their order. Choose which selected stories are featured, then set date/year, volume, issue number, cover title, caption/credit and JPEG/PNG photograph/focus. Generate a four-page PDF, editable IDML and a complete ZIP with exact source JSON and licensed document fonts. Selected story order determines opening pages; featured cover references are recomputed at export. Unselected stories are excluded. Unused interior pages are reserved.

Current issue choices stay in browser storage; uploaded photo bytes are session-local and remain in the exported files. Empty selection, invalid issue fields and stale exports are blocked. Changes during an export require regeneration.

The sample runs independently of the OTEManager database/native worker. The official DesignCraft web editor now runs on the Site and accepts the current sample IDML through its browser file-drop path. Its PDF is a browser demonstration, not a PDF/X production proof. IDML is adapted from a native-generated, zero-preflight template; fresh Adobe reopening remains unverified. Demo references are fixed in each export, so regenerate after page edits. The actual OTEManager workflow uses named native references and its configured DesignCraft worker.

## Downloads

The Site directly hosts the full review PDF, working proof/evidence ZIP and updated template kit with SHA-256 files. It also provides fixed native sample PDF/IDML exports, an original-font native proof PDF, and machine-readable pipeline/demo checks. These fixed proofs are clearly separate from the current browser choices. Proprietary original font binaries are not public Site assets.

## Verification

[Committed demo evidence](designcraft-review/site-demo-verification.json) records browser selection/reordering, automatic references, uploaded cover bytes, issue controls, empty/invalid input rejection, stale-download cleanup, saved settings, responsive layout and fixed download checks. Both actual browser-generated IDML fixtures reopen/export with stock DesignCraft 0.4.0 and preserve the complete selected body text and current metadata. Both have zero preflight errors. The default has zero warnings; the latest low-resolution/partially featured fixture has six warnings for image resolution and intentionally blank text frames.

The maintained Site source is pushed to its Sites repository. It includes HTML/CSS/JavaScript, fixtures, licensed dependencies, preparation/check scripts and screenshots. The local checkout is `/workspace/sites/ote-issue-studio`; serve `dist/` over HTTP and run `node scripts/check-demo.cjs` followed by `python3 scripts/check-content.py`. Those QA scripts record local Playwright/CLI/font paths and must be adjusted when reproduced elsewhere. The skill's bundled source workflow helper was unavailable; a credential-safe portable fallback verifies the pushed SHA and packages the exact static source state. No source credential is persisted.

## Remaining boundaries

Publishing this Site does not deploy OTEManager or connect to stored production articles. Adobe/printer approval, native Mac/Windows execution, Linux arm64 container execution and historical missing-content/artwork repairs remain outstanding. The original hosted OTE DesignCraft Review Site is separate and unchanged.

## Original references and real DesignCraft web editor

The original demo used an older framed cover and a rough HTML sketch. That did not represent the supplied September design. The default preview now renders the actual September source PDF, with all nine supplied reference issues selectable and all their pages navigable. Original reference PDFs retain their embedded fonts/artwork; large reading copies may have optimized imagery.

The editable sample retains September’s source vector masthead, green photo panel, paper-plane artwork and feature-list rules. It uses separate editable number/title fields and white caption text, without the gray placeholder cards. Its text remains in portable fonts, so it is not an exact original-font remake. The current PDF preview is rendered with PDF.js and shares byte-identical output with its download.

The Site also hosts the official DesignCraft 0.7.1 WASM application, embedded on request. This corrects the earlier broad statement that Sites cannot host DesignCraft: the desktop CLI requires a worker, but its official web application runs in the browser. The real editor opens the current selected-story IDML through its browser drop path. Click the canvas to use its tools, then use its own Save/Export commands for edits. Editor and form state remain separate. The web engine is newer than the stock 0.4.0 compiler used for native fixture checks.

The official ZIP is checked against release SHA-256 sums. The unchanged 38,992,979-byte WASM module is split into four compressed assets (about 15 MB download); piece hashes and the complete original hash are verified before instantiation. This keeps every hosted file below 24 MiB. The HTML wrapper waits until the editor UI finishes loading and reports failures/retry; it does not alter engine glue or WASM. Original proprietary font binaries remain outside static assets.

Checks cover original-source rendering/navigation, native proof pages, updated sample PDF rendering, byte-identical preview/download, zoom/mobile fit, source-copy retention, zero native preflight errors, and actual browser-engine startup/file handoff. Reference viewing preserves original fonts; portable sample text and fresh Adobe/printer/desktop checks remain explicit boundaries.

[Actual hosted Site check](designcraft-review/site-live-preview-check.json) also passed: original reference rendering, official web-engine startup and current-sample file handoff, with no page errors. Private service access was scoped to this Site; its credential was not retained.
