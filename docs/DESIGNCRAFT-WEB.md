# DesignCraft web inside OTEManager

Use the browser editor for layout work, saving and PDF/IDML export. Staff do not install desktop DesignCraft or a local CLI. The actual official web runtime is committed under `public/designcraft/editor/`, including its compressed WASM pieces, unchanged upstream JavaScript, licences and provenance. It is served by the regular OTEManager build/Docker image, independently of Sites.

## Workflow

1. In Publications, choose DesignCraft ZIP, select articles/images, and click **Open selected in DesignCraft**.
2. Plan pages, cover fields and continuation chains. With the optional server composer configured, click **Build plan and open in web DesignCraft**. The checked generated native document opens in the actual editor without an intermediate download.
3. Alternatively, choose an existing `.idml` or `.designcraft` file under **Open existing IDML / DesignCraft file**. This works without the server composer.
4. Edit in the browser and use DesignCraft’s own File → Save / Export commands. Article records and planner recipes remain managed separately in OTEManager.

The direct editor URL is `/designcraft/editor/index.html`; the planner/embedded-editor route is `/utilities/designcraft`. A separate full editor tab is also available. HTTPS or localhost is required for the wrapper’s cryptographic integrity checks and browser APIs.

## What is bundled, and what remains optional

| Component | Requirement |
|---|---|
| DesignCraft web 0.7.1 | Bundled in this repository; the browser downloads it automatically. |
| Existing IDML/native opening and editing | Browser only; no CLI installation. |
| Automatic selected-article recipe composition and server preflight | Configured `/api/designcraft/native` worker; see `designcraft-native-service.md`. This runs on the server, not staff machines. |
| Original private fonts | Loaded by the server’s original2025 profile. Private-font loading into the browser editor is not connected by this bridge. Confirm fonts before exporting original-font edits in the editor. |
| Standalone web editor | `public/designcraft/web-editor.zip`, also downloadable from the planner; serve it from HTTPS or localhost. |
| Raw Drive archives | Needed for historical audits, not for opening the bundled web editor. |

The stock 0.4.0 CLI remains the tested server compiler. The official 0.7.1 web application is a separate engine version; do not interpret its inclusion as rerunning the 104-template native audit under 0.7.1. Server outputs continue to use checked preflight. Browser editing/export should be checked in its own editor and freshly in Adobe/printer workflows.

## Packaging and integrity

`tools/designcraft/package-web-editor.py` verifies all compressed/uncompressed pieces and the complete byte-identical official WASM before building the standalone ZIP/checksum. Chunk filenames include their compressed SHA prefixes. The upstream archive/module hashes are recorded in `editor/OTE-PROVENANCE.json`; the runtime is not rebuilt or modified. The wrapper adds same-origin, bounded document handoff, UI-ready messages, error/retry handling and gzip/hash checks. Source credentials are never included.

The template kit remains a separate compiler/recipe download. The regular Docker image bundles the editor and standalone ZIP; `Dockerfile.native` additionally installs the optional server composition tools. Existing `.env`/Convex/storage configuration is still needed to run OTEManager itself.

## Verification

`tools/designcraft/check-web-editor.cjs` loads the actual planner and WASM editor, opens a real compiled IDML with the composer unavailable, and tests the planner-to-editor handoff using intercepted API job status and actual real-CLI output bytes. Native `.designcraft` is preferred so labels, overrides, numbering and links stay intact; IDML is a fallback. The test records that transport boundary explicitly; it does not claim a fresh production-worker deployment. It also checks wrong-origin messages and invalid file rejection. The existing native service tests cover the real server compiler path.

Configure `REVIEW_URL`, `REVIEW_PLAYWRIGHT_MODULE`, `REVIEW_CHROMIUM`, `OTE_WEB_PROOF_DIR` and `OTE_WEB_QA_DIR` for another environment. The proof directory needs `issue.idml`, `issue.designcraft` and `safe-issue-recipe.zip`. Adobe/printer approval and original-font browser loading remain outstanding.

[Committed integration evidence](designcraft-review/otemanager-web-editor-check.json) records the successful direct-file and generated-native handoff cases. Type checking, production build and all 45 application tests (including configured real-CLI cases) passed. OTEManager production deployment is a separate step.
