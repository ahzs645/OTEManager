# Workflow and command map

All commands below run from the repository root. Read the linked repository
guides before rebuilding; generators overwrite their documented outputs.

## Prerequisites

- Node 24 and `npm ci` for the application and JavaScript compiler.
- Python 3 with PyMuPDF (`fitz`); comparison tools also use NumPy and Matplotlib.
- Committed PDFs in `public/designcraft/originals/`, IDML in
  `public/designcraft/source-idml/`, and bundled portable fonts/0.9.0 engine.
- Browser checks currently require `playwright-core` at
  `/opt/codex/cua_node/lib/node_modules/playwright-core` and Chromium at
  `/usr/bin/chromium`. Adapt these explicit script paths if the runtime differs.
- The main-app check needs a configured local Convex backend and running app.
  Follow `README.md`, `scripts/setup-local.mjs` and existing environment setup.
  Never print secret values or commit `.env.local` or `.convex/`.

## Source pages and complete issues

Read `docs/DESIGNCRAFT-SOURCE-RECREATION.md` and
`docs/DESIGNCRAFT-WHOLE-ISSUES.md`.

```sh
# Only needed when changing the measured extraction/preset inputs.
python3 tools/designcraft/extract-president-source.py
python3 tools/designcraft/extract-cfur-source.py
python3 tools/designcraft/build-source-presets.py

# Whole-issue data and actual native/PDF/IDML proofs.
python3 tools/designcraft/build-source-issues.py
node tools/designcraft/check-source-issues.mjs public/designcraft/source-issues/*/*-issue.json
python3 tools/designcraft/compare-source-issues.py
python3 tools/designcraft/check-source-ad-spots.py
```

The whole-issue builder accepts `--issues SOURCE_ID ...` for a bounded rebuild.
The check accepts explicit issue JSON paths for a bounded verification. Outputs
live in `artifacts/source-reconstruction/whole-issues/<id>-<mode>/`.

Individual preset verification:

```sh
node tools/designcraft/check-source-reproduction.mjs
python3 tools/designcraft/compare-source-reproduction.py
```

Main files to extend:

| Purpose | Paths |
| --- | --- |
| Measured source evidence | `public/designcraft/source-issue-maps.json`, `source-presets.json` |
| Whole-issue recipes | `public/designcraft/source-issues.json`, `source-issues/<id>/` |
| Independent source graphics | `public/designcraft/source-art/` |
| Source planner options | `public/designcraft/source-options.js`, `source-issue-options.js` |
| Compiler | `public/designcraft/compiler/`, `tools/designcraft/compile.mjs` |
| Planner/editor integration | `public/designcraft/issue-plan.js`, `page-editor.js`, `app.js` |
| Server engines | `server/designcraft-native.ts`, `designcraft-wasm.ts` |

## Original article recovery and import

Read `docs/DESIGNCRAFT-SOURCE-ARCHIVE.md` and
`docs/SOURCE-ARCHIVE-IMPORT.md`.

```sh
# Default uses committed sanitized metadata and original source documents.
python3 tools/designcraft/build-source-archive.py

# Optional: explicitly supplied local original metadata backup.
python3 tools/designcraft/build-source-archive.py --metadata-backup /path/to/native-metadata.zip

# Optional: selectively recover article files from an available local backup.
python3 tools/designcraft/recover-drive-files.py \
  --metadata-archive /path/to/native-metadata.zip \
  --archive /path/to/native-files.zip \
  --output artifacts/source-archive-recovery
python3 tools/designcraft/build-source-archive.py \
  --recovery-report artifacts/source-archive-recovery/recovery-report.json
```

For normal public Drive selective recovery, the recovery script also accepts
`--drive-file-id ID --archive-size BYTES` in place of `--archive`. Its help
documents `--inventory-only`. Do not treat an inaccessible private download as
an archive with zero files or circumvent its authentication.

| Purpose | Paths |
| --- | --- |
| Canonical contract | `shared/source-archive.ts`, `public/designcraft/source-archive.json` |
| Sanitized metadata fixture | `public/designcraft/source-metadata/` |
| Readable exports | `public/designcraft/source-archive/` |
| Actual embedded source images | `public/designcraft/source-archive-media/` |
| Import ZIP | `artifacts/source-archive/ote-source-articles.zip` |
| JSON/ZIP parsing, bytes and retries | `server/source-archive.ts` |
| App import API | `app/routes/api/source-archive/import.ts` |
| Idempotent database operations | `convex/operations/sourceArchive.ts`, `sourceArchiveLinks` table |
| App review screen | `app/routes/utilities.source-archive.tsx` |
| Visible original provenance | `app/components/article/SourceProvenancePanel.tsx`, `app/lib/source-archive-display.ts` |
| Content export guard | `app/components/publications/IssueExportModal.tsx`, `server/designcraft-export.ts` |

The ZIP limit is 64 MiB compressed / 256 MiB expanded; metadata is limited to
6 MiB. Use the existing bounded ZIP reader and real storage. Missing attachment
references do not count as attachments. The import token binds checked metadata
and supplied bytes; do not reuse it after changing a manifest or ZIP.

## Verification

```sh
npm test
npm run typecheck
npm run build

# Main application; defaults to http://127.0.0.1:5173.
node tools/check-source-archive-ui.cjs
# Add --import only when importing into this target is within the user's scope.
node tools/check-source-archive-ui.cjs --import

# Planner static files need an HTTP server rooted at public/designcraft/.
# The planner check defaults to http://127.0.0.1:8923/.
node tools/designcraft/check-source-issue-planner.cjs

# Actual server queue and artifact collection.
node --import tsx tools/designcraft/check-source-server.mts
```

`OTE_UI_ORIGIN` selects the main app URL; `REVIEW_URL` selects the static planner
URL. Keep local static and application servers distinct. Tests include source
metadata/body fidelity, import identity, backups, original dates, payment
preservation, actual file storage, source page order, artwork replacement and
empty-body export protection. A missing matching CLI can skip optional external
CLI checks; WebAssembly checks must still execute.

## Packaging and Drive delivery

```sh
node tools/designcraft/package-template-kit.mjs
# Requires completed whole-issue proofs from check-source-issues.mjs.
python3 tools/designcraft/package-source-deliverables.py
```

Per-issue editable bundles and self-contained recipes plus their sizes/hashes
are indexed in `artifacts/source-archive-publish/issue-deliverables.json`.
The compiler kit is `public/designcraft/template-kit.zip`. To verify an actual
download, extract a recipe and a separate kit, install the kit dependencies,
and run its `tools/designcraft/compile.mjs` with `--library`, `--issue` and
`--output`. Check its README for relative asset-root behavior.

The existing user delivery folder and observed file IDs are recorded in
`public/designcraft/source-archive-drive.json`. Treat that file as the previous
delivery index; check live Drive metadata before overwriting or reusing IDs.
Use the connected Drive upload/update tools with the exact generated bytes and
read back listings afterward. Do not copy the source archive or raw database
backup into a generated-deliverables folder unless separately requested.

## Change delivery

Run `git diff --check` and inspect staged paths, archive contents and file sizes.
`attachments/`, `artifacts/`, `.env*`, local Convex state and private fonts must
remain excluded as appropriate. Keep generated application source assets and
their required runtime files tracked. Include this skill and updated guides in
requested commits. Fetch the requested destination branch, preserve its latest
changes, push normally and verify its remote SHA. A branch push does not itself
run a production import; report deployments only when actually performed.
