# DesignCraft web inside OTEManager

Use the browser editor for layout work, saving and PDF/IDML export. Staff do not install desktop DesignCraft or a local CLI. The DesignCraft 0.9.0 web runtime is committed under `public/designcraft/editor/`: the official release source plus a nine-line `add_font` export ([`packages/designcraft-web/add-font.patch`](../packages/designcraft-web/add-font.patch)) so fonts can be loaded into the editor, with its compressed WASM pieces, licences and provenance. It is served by the regular OTEManager build/Docker image, independently of Sites.

## Workflow

1. In Publications, choose DesignCraft ZIP, select articles/images and click **Open selected in DesignCraft**, or use **Import issue** in Utilities → DesignCraft.
2. Use **Plan & compose** to assign articles, choose a page recipe, save pages, or suggest an issue plan. The utility uses OTEManager’s own toolbar and a compact planner, with no separate archive or website navigation.
3. Click **Generate & edit**. It composes the saved issue (or the current page when no pages are saved), checks preflight, loads the document fonts and switches directly to the **Editor** tab. The editor fills the workspace. **Expand workspace** gives it the whole window.
4. **Downloads** contains the generated native, PDF, IDML and complete output ZIP. The editor’s **File** menu saves/exports subsequent edits; generated downloads remain the composition output. Preflight warnings remain visible in the utility’s status bar.
5. **Open document** accepts an existing `.idml` or `.designcraft` file, and **Fonts** loads faces on this device. Switching between Plan and Editor retains both sessions.

The utility’s React toolbar owns imports, document handoff, generation, downloads and expansion. The planner and the WebAssembly editor retain isolated browser contexts with a bounded, same-origin message bridge; the editor is a direct workspace panel rather than a nested editor inside the standalone planner site. The bridge accepts commands only from its parent and copies document/font buffers so reopening a generated document remains possible.

The standalone planner remains at `/designcraft/index.html`, with its archive and full reference material. The direct editor remains at `/designcraft/editor/index.html`. HTTPS or localhost is required for integrity checks and browser APIs.

## What is bundled, and what remains optional

| Component | Requirement |
|---|---|
| DesignCraft web 0.9.0 (+ `add_font`) | Bundled in this repository; the browser downloads it automatically (about 20 MB, once). |
| Existing IDML/native opening and editing | Browser only; no CLI installation. |
| Automatic selected-article recipe composition and server preflight | Configured `/api/designcraft/native` worker; see `designcraft-native-service.md`. This runs on the server, not staff machines. |
| Salted Regular | Bundled in `public/designcraft/assets/fonts/Salted-Regular.otf`, automatically loaded by the editor and browser composer, and included in server output. The supplied notice is preserved as `LICENSE-Salted.txt` and labels it personal use only. Portable layouts keep their existing open substitutes; original-font layouts can use bundled Salted without uploading it. |
| Other original private fonts | Loaded by the server’s original2025 profile, and now into the editor too: choose them under **Fonts for the editor**, or they come with an original-font build (server bundle or browser composer). They stay on the device. |
| Standalone web editor | `public/designcraft/web-editor.zip`, also downloadable from the planner; serve it from HTTPS or localhost. |
| Raw Drive archives | Needed for historical audits, not for opening the bundled web editor. |

The server CLI, the headless compiler engine and the editor are all DesignCraft 0.9.0. Server outputs continue to use checked preflight. Browser editing/export should be checked in its own editor and freshly in Adobe/printer workflows (`tools/designcraft/check-print.py`, `check-idml.py`).

## Packaging and integrity

`tools/designcraft/vendor-web-editor.py` vendors a release (official module, or a build of the same release with the committed patch) and `tools/designcraft/package-web-editor.py` verifies all compressed/uncompressed pieces and the complete module before building the standalone ZIP/checksum. Chunk filenames include their compressed SHA prefixes. `editor/OTE-PROVENANCE.json` records the official archive and module hashes, the patch hash, the build commands and why wasm-opt is skipped (binaryen 108 broke the module's start-up). Engine code is unchanged. The wrapper adds same-origin, bounded document and font handoff (`ote.designcraft.fonts` → `add_font`, at most 64 files), UI-ready messages that report font support, error/retry handling and gzip/hash checks. Source credentials are never included.

The template kit remains a separate compiler/recipe download. The regular Docker image bundles the editor and standalone ZIP; `Dockerfile.native` additionally installs the optional server composition tools. Existing `.env`/Convex/storage configuration is still needed to run OTEManager itself.

## Verification

`tools/designcraft/check-web-editor.cjs` loads the actual planner and WASM editor, opens a real compiled IDML with the composer unavailable, and tests the planner-to-editor handoff using intercepted API job status and actual real-CLI output bytes. Native `.designcraft` is preferred so labels, overrides, numbering and links stay intact; IDML is a fallback. The test records that transport boundary explicitly; it does not claim a fresh production-worker deployment. It also checks wrong-origin messages and invalid file rejection. The existing native service tests cover the real server compiler path.

Configure `REVIEW_URL`, `REVIEW_PLAYWRIGHT_MODULE`, `REVIEW_CHROMIUM`, `OTE_WEB_PROOF_DIR` and `OTE_WEB_QA_DIR` for another environment. The proof directory needs `issue.idml`, `issue.designcraft` and `safe-issue-recipe.zip`. `tools/designcraft/check-browser-compose.cjs` also loads a font into the editor (October 18: “Loaded 1 font file (1 new face)”). Adobe/printer approval remains outstanding.

[Committed integration evidence](designcraft-review/otemanager-web-editor-check.json) records the successful direct-file and generated-native handoff cases. Type checking, production build and all 45 application tests (including configured real-CLI cases) passed. OTEManager production deployment is a separate step.
