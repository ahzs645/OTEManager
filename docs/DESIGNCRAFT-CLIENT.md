# DesignCraft in the browser and on the server, from one compiler

OTEManager can now compose articles into editable DesignCraft, PDF/X-4 and IDML output in three ways, all using the same page/issue compiler and the same DesignCraft 0.9.0 engine:

| Mode | Where it runs | Needs | Protected-page rebuilds |
|---|---|---|---|
| **Browser** (client-only) | A Web Worker in the staff member's browser | Nothing installed; the engine (12.7 MB gzipped) downloads once | No — new issues only |
| **Server, WebAssembly** | OTEManager's Node process | `DESIGNCRAFT_ENGINE=wasm`; no CLI, Python or native binaries | No |
| **Server, CLI** (existing) | Python compilers + native `designcraft-cli` | `Dockerfile.native` / `designcraft-native-service.md` | Yes |

The browser mode keeps everything on the device: articles, photos and any private original fonts the user picks are never uploaded.

## What was built

- **`packages/designcraft-headless/`** — a small Rust crate (wasm-bindgen) over the upstream DesignCraft engine, pinned to the same `v0.9.0` commit (`7cb8b125`) as the server CLI (with upstream's own `[patch.crates-io]` for krilla and the hayro crates, which 0.9.0 needs). It exposes `execute`, `runScript` (exactly `designcraft-cli script` semantics), `addFont` and `renderPagePng`. Documents, images and exports travel as bytes through the engine's own `file.openBytes`, `file.place {base64}`, `file.serialize` and path-less exports. No engine source is modified.
- **`public/designcraft/headless/`** — the committed build: glue JS, gzipped module, licences and `manifest.json` with both checksums and the toolchain. The loader verifies both before use. Normal OTEManager builds need no Rust.
- **`public/designcraft/compiler/`** — the Python compilers ported to plain ES modules (`compile-template.py`, `compile-issue.py`, `markdown_story.py`, `cover_fields.py`, `native_flow.py`, `native_references.py`, the interchange sidecar). Dependencies (`JSZip`, `markdown-it` 14.1.0) are injected, so the same modules run in the browser worker, in Node, and in tests. Commands use symbolic files (`@doc`, `@media:…`, `@out:…`) that an executor maps to bytes (WebAssembly) or real paths (CLI), keeping step indices identical.
- **`variants.js`** — the layout-variant generator (below).
- **`worker.js` + `browser-compose.js`** — the planner panel **Compose in this browser**. It takes the same recipe ZIP the server receives.
- **`server/designcraft-wasm.ts`** — server WebAssembly mode, writing the Python output layout so job collection, bundles and the API are unchanged.

## Layout variants

**Suggest checked layouts for these stories** (planner) takes the chosen 1–3 articles and:

1. enumerates every story recipe with that story count × every article order, keeping those whose photo slots the articles can fill (48 candidates for two articles with one photo each);
2. pre-ranks them cheaply (estimated body lines vs. capacity, headline lines, unused photos) and keeps the best order per recipe;
3. **composes the shortlist in the real engine**; native preflight decides fit;
4. if a candidate fails *only* on headline overset, first grows the headline band at the designed size (measured in the engine), then tries explicit, labelled 22/20/18 pt headline variants, each with a grown band (body copy is never shrunk or cut). With *Fit headline bands* on, every candidate's bands are fitted first, so a one-line headline pulls its byline up and the photo grows (see [DESIGNCRAFT-ORIGINALS.md](DESIGNCRAFT-ORIGINALS.md#headline-bands-that-fit-the-headline));
5. ranks the passing variants by measured body fill (`story.get` composed lines against column capacity), photo crop loss, headline step and unused photos, with PNG previews.

**Use this layout** applies the recipe and article order (headline variants carry their font size). **Suggest a whole-issue plan** groups articles into pages (long pieces alone, short ones together), splits any group that no layout fits, picks the best checked variant per page, puts a cover with three featured articles first, and loads the result into the issue builder.

## Verification (October 18, 2026)

Evidence: [`designcraft-review/client-compose-check.json`](designcraft-review/client-compose-check.json), screenshots [`client-variants.png`](designcraft-review/client-variants.png) and [`client-web-editor.png`](designcraft-review/client-web-editor.png).

- **Source archive.** The Drive `OneDrive_2026-10-09.zip` (1.78 GB) was re-downloaded and hashed recursively: 424 entries, 167 distinct payloads, 12 PDF, 12 IDML, 18 INDD — byte-identical to the archive already recorded in `documents.json`. The folders OneDrive failed to export (Issue 7 INDD, Issue 8, 2025–26, 2026–27) are absent from the archive itself.
- **Pages, all 104 recipes.** The JavaScript command scripts are identical to Python's `commands.dcs`; every WebAssembly PDF is pixel-identical (72 dpi) to the native CLI's, with identical native stories.
- **Whole issue, real articles.** `tests/fixtures/designcraft-march-2025` (six March 2025 articles from the source IDML, three photos from the issue folder) compiled through Python+CLI, JavaScript+CLI and JavaScript+WebAssembly: 0 changed pixels on all four pages; identical stories, namespaced styles, anchors, cross-references and hyperlinks.
- **Browser, no server.** Chromium against the static planner: variants (4 of 48 fit, 11 composed, ≈5.7 s including first engine load), page generation (≈1.7 s), plan suggestion (≈7.6 s) and 4-page issue generation (≈8.6 s) with 0 preflight errors, then opening the result in the bundled web editor. Reproduce with `tools/designcraft/check-browser-compose.cjs`.
- **Server WebAssembly mode** completes the fixture booklet through the existing job API with no CLI or Python (`tests/designcraft-wasm.test.ts`).

Follow-ups (October 18, later):

- **Long headlines in half-width recipes** now get grown bands: `story-2-two-top-columns` with CFUR + CN Centre exports with 2-line bands, identically from WebAssembly and Python+CLI. One-line headlines can also tighten their bands (the byline moves up and the photo grows); the planner previews this live with Pretext.
- **Cover references** no longer break mid-word in 0.9.0: the cross-reference holds only the page number (format `<pageNum />`), followed by the plain title, so the card text wraps like ordinary text. Original-design covers print the number alone. Manifests record `text` (the card as it reads) and `generated` (the live page number). Because the title is now plain text, a *protected* cover can no longer follow a renamed headline; the compiler refuses with a clear message instead of printing the old title (covers from older bases, with the legacy whole-card reference, still follow).
- **DesignCraft 0.9.0** everywhere: headless engine, CLI (`download-cli.py`, `Dockerfile.native`) and web editor. The 104-recipe sweep was rerun: identical command scripts, pixel-identical WebAssembly and CLI PDFs, identical stories; the fixture issue is identical across Python+CLI, JS+CLI and JS+WebAssembly.
- **Fonts in the web editor**: the bundled editor is the official 0.9.0 source plus a nine-line `add_font` export ([`packages/designcraft-web/add-font.patch`](../packages/designcraft-web/add-font.patch)); fonts you choose (or the original fonts of a server build) load into it on your device.
- **Print and InDesign checks**: `check-print.py` and `check-idml.py` compare output with the PDFs the printer accepted and with InDesign's own IDMLs. Opening in Adobe InDesign and a press proof still need doing outside this environment.
- **Original designs**: the 2024–25 and 2025–26 house designs are recreated from the source IDMLs; see [DESIGNCRAFT-ORIGINALS.md](DESIGNCRAFT-ORIGINALS.md).
- Fixture photos are downscaled for the repository, so hero slots warn at 147 ppi; real uploads do not.

## Commands

```sh
npm test                                   # includes tests/designcraft-wasm.test.ts
DESIGNCRAFT_TEST_CLI=/path/to/designcraft-cli npm test   # adds Python/CLI parity checks
npm run designcraft:headless:verify        # checksums of the committed engine
npm run designcraft:headless:build         # rebuild (Rust ≥ 1.95, wasm32 target, wasm-bindgen-cli 0.2.129)
node tools/designcraft/compile.mjs --library templates.json --issue issue.json --output out   # JS compiler, any template
REVIEW_URL=http://127.0.0.1:8891/ node tools/designcraft/check-pretext-fit.mjs report.json   # Pretext vs engine
python3 tools/designcraft/build-test-fixture.py --archive /path/to/OneDrive_2026-10-09.zip
```

Enable the server WebAssembly engine with `DESIGNCRAFT_ENGINE=wasm` (the regular Dockerfile image already contains everything it needs). Fonts come from `DESIGNCRAFT_FONT_DIR` / `DESIGNCRAFT_ORIGINAL_FONT_DIR` as for the CLI engine.

## Upgrading DesignCraft

OTEManager is on 0.9.0 (headless `rev` in `packages/designcraft-headless/Cargo.toml`, CLI in `download-cli.py` and `Dockerfile.native`, web editor in `public/designcraft/editor/`). For the next upgrade:

1. Change the `rev` and copy upstream's `Cargo.lock` and `[patch.crates-io]`, then rebuild.
2. Rebuild the web editor from the release source with `add-font.patch`: `cargo build --release -p designcraft-web --target wasm32-unknown-unknown`, then `wasm-bindgen --target web --weak-refs`, then `tools/designcraft/vendor-web-editor.py --official designcraft-web-<v>.zip --wasm … --glue … --patch packages/designcraft-web/add-font.patch` and `package-web-editor.py`. Skip wasm-opt from binaryen 108: it produced a module whose externref table could not grow at start-up.
3. Rerun the parity checks (`DESIGNCRAFT_TEST_CLI=… npm test`), the browser check (`check-browser-compose.cjs`) and `check-pretext-fit.mjs`.
