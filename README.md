# OTEManager

Article management with a TanStack Start web app and **Convex for both records and uploaded files**. PostgreSQL, S3, and a persistent uploads directory are no longer required.

## Run locally

Use Node.js 24 LTS (pinned in `.nvmrc`). The current Nitro development adapter drops response headers under Node 26; Node 24 is verified.

```sh
nvm use # if you use nvm; otherwise select Node 24 with your version manager
npm install
npm run setup:local
```

Keep these running in two terminals:

```sh
npm run convex:dev
npm run dev
```

The setup command creates an isolated local Convex deployment and a random server secret in the ignored `.env.local`. Local deployment data lives under `.convex/`; keep that directory to retain your imported data. Settings shows the connection status without exposing credentials.

## Restore a backup

The importer accepts native OTE ZIP exports (`manifest.json` and `files/`) and recovery bundles (`database/manifest.json`, `uploaded-files/`, and optional `recovery-report.json`). Existing UUIDs, dates, payment snapshots, article relationships, and file paths are preserved. Multiple attachment records can reference one stored file.

Use **Utilities → Backup & Restore**, or the CLI for large archives:

```sh
npm run backup:import -- /absolute/path/to/backup.zip --dry-run
npm run backup:import -- /absolute/path/to/backup.zip
```

The default is merge: existing record IDs are retained, and files with matching SHA-256 and size are skipped. `--database-only` imports just records. `--replace` replaces records with the snapshot after validation. It does not delete unreferenced stored files.

The importer validates the manifest, relationships, file sizes, and recovery checksums before changing data. The record restore commits in one Convex transaction. Files are then restored individually; if a connection fails, rerun in merge mode to resume. A database-only ZIP cannot restore file contents.

Archives are read from disk one entry at a time. HTTP uploads use temporary disk space, cleaned up after completion. The web server needs enough temporary disk space for the ZIP. Default limits are 5 GiB per archive, 512 MiB per archived file, and 8 MiB per manifest. Database restore currently targets snapshots that fit within one Convex transaction; larger datasets will need a staged migration.

Verify every restored record and download every file to compare against a recovery bundle:

```sh
npm run backup:verify -- /absolute/path/to/recovery.zip
```

A count-only verification report is written to `artifacts/convex-import-verification.json`. Backups, local data, and reports are not committed.

## Deploy with Convex Cloud

Create or select a Convex project using `npx convex dev --configure`. Deploy the functions using `npm run convex:deploy`. Set `CONVEX_URL` and `CONVEX_SERVER_SECRET` in the web server environment, and set the same `CONVEX_SERVER_SECRET` in the selected Convex deployment's environment using its dashboard. Use a randomly generated secret; do not put it in a `VITE_` variable.

Build and run the web app:

```sh
npm run build
npm start
```

The web app still needs a Node host. It calls Convex through a server-only bridge; the bridge authenticates every operation and never sends the secret to the browser. The app retains its existing access model; configure access to the web app at the hosting layer. No cloud project or production data is changed by local setup or testing.

## Deploy to self-hosted K3s

An alternative to Convex Cloud: the app and a self-hosted Convex backend both run on a single-node K3s cluster, so no Convex project is involved and no data leaves the network. The `Dockerfile` at the repo root builds the app in two stages — Nitro emits a self-contained `.output`, so the runtime stage carries no `node_modules`. Node 24 is pinned for the reason given above.

The image is built on the cluster node and imported directly into containerd; nothing is pushed to a registry. One command builds the current working tree, including uncommitted changes, and rolls it out:

```sh
./scripts/otemanager-deploy.sh   # in the infrastructure repo
```

A self-hosted Convex backend starts empty and needs three things before the app works: an admin key, the deployed functions and schema, and `CONVEX_SERVER_SECRET` set _inside_ Convex so it matches what the app sends. `CONVEX_CLOUD_ORIGIN` and `CONVEX_SITE_ORIGIN` are also required — without them Convex returns a relative upload URL and every file upload fails while records still import cleanly.

Full instructions, the first-time bootstrap, restoring a backup into the cluster, and the storage durability caveat: **[docs/DEPLOY-K3S.md](docs/DEPLOY-K3S.md)**.

## Implementation and checks

- `convex/schema.ts`: Convex tables, indexes, and file path mappings.
- `convex/operations/`: application queries, transactional edits, reports, and utilities.
- `shared/`: application record types, timestamp conversion, and backup validation.
- `server/`: server-only Convex client and streaming archive import.
- `storage/convex.ts`: file upload, retrieval, and deletion.

Article edits, status history, payments, note edits, and publication changes run in Convex mutations. SQL queries have been replaced with TypeScript queries. Existing UI refresh behavior is preserved; live Convex browser subscriptions are not enabled in this version. Reports currently read the relevant tables inside a single Convex query, appropriate for the supplied dataset; large installations would benefit from incremental aggregates.

```sh
npm run build       # also generates the TanStack route tree
npm run typecheck
npm test
```

## Utilities

All seven utility screens use Convex. SharePoint JSON, ZIP, and folder imports, student type updates, article merging, duplicate file deletion, payment review, WordPress bundles, and native backup restore have workflow coverage. Write/delete/payment tests use an isolated Convex test backend; browser checks and sample exports use the restored local dataset.

SharePoint replacement imports reuse attachment records at the same file path and preserve merged source IDs. Merge imports retain article metadata, skip existing files, and retry missing files. File failures are included in the import report. Folder imports refer to folders on the web server's machine; ZIP uploads work when accessing the app remotely. WordPress export produces a ZIP for a separate WordPress importer; this app does not publish directly to WordPress.

Payment Manager recognizes approval in **Approved**, **In Editing**, **Ready for Publication**, and **Published**. Unpaid eligible contributions remain in the queue through publication. Select a volume and optionally one of its issues to scope the overview, totals, exports, and step-by-step review; the selection is kept in the URL. Issue and volume article lists include a **Review Payments** shortcut. Linked publication records take precedence over legacy numbers, with unlinked older imports matched by their volume and issue numbers. Paid articles, Faculty/Staff contributions, pre-approval work, and Archived articles are excluded. Article details show **Approval complete** for the same production stages, while dashboard cards keep Approved and Published counts separate. Payment reports treat both false and blank payment flags as unpaid.

## Vancity payment helper

Payment Manager can preview and export selected payments as JSON, with separate transfers per article (default) or combined transfers per author. It refreshes eligible unpaid records in the current publication selection before preparing the preview, uses saved payment amounts and breakdowns, and excludes incomplete or ineligible records. Exporting does not mark articles paid.

The Manifest V3 Chrome extension lives in `extensions/vancity-payment-helper`. Its one-click preparation navigates to e-transfers, checks the exact recipient email, creates a real missing contact, selects a saved default source account when configured, and fills its payment form. It offers a bulk contact preflight and a question/answer preset remembered on this device for recipients without Autodeposit. Prepare opens the bank Review automatically after receipt capture is ready. Final payment review and sending remain manual; there is no extra extension review checkbox. Synthetic recipients are previewed without saving them. `npm run payment-helper:package` generates the web-downloadable files and ZIP; `npm run dev` and `npm run build` also run packaging. See [installation, workflow and limitations](extensions/vancity-payment-helper/README.md).

The helper can import selected previews directly from the local or hosted Payment Manager. Open it on Vancity once to connect the bank tab, then on OTEManager after **Preview export** and select **Import from OTEManager**. The connected workspace prepares the selected payments without a JSON file round trip.

Version 0.7 captures the matching bank send-success receipt and reference after the operator sends. In connected mode it atomically marks the included articles paid, saves a dedicated Vancity reference and receipt, and adds payment notes. It rechecks current records and rejects mismatches or an existing conflicting payment; retries of the same reference are idempotent. A failed write-back keeps a durable device-local receipt with reconnect/retry controls. This requires the updated OTEManager app/backend as well as the extension. The app and backend updates were deployed to hosted K3s on October 13, 2026; the live connected payment test is recorded separately from deployment verification.

Version 0.8 adds a remembered OTEManager URL and live browsing of unpaid payments by volume, issue, author/article and grouping. Connect requests optional access only to the chosen site and opens its signed-in Payment Manager tab. It loads current saved amounts without a preview/export step, refreshes while idle, and rechecks the selected payment before Prepare. Live receipt write-back reconnects a reloaded app tab on the same original origin; changing sites cannot redirect an existing receipt. File imports remain available under Use an export instead. The live-capable app and v0.8 download were deployed to hosted K3s on October 14, 2026.

Version 0.9 adds an optional **Create N missing contacts** action after the bulk email scan. It rechecks each email, saves real missing contacts and verifies them, skips existing recipients, and stops on bank errors with completed results retained. Contact creation stays on the contact list and does not prepare or send payments.

Version 0.9.1 handles Vancity's duplicate contact-name error by trying numbered display names (2, 3, and onward), then checking the accepted name on review and the exact email after saving. It retains the original OTEManager author name and reports the bank's saved display name in bulk results.

Version 0.10 adds a top-right **Settings** tab for connection, import, security preset, and default-account controls. Publication filters sit with the payment choice. Prepare waits for receipt capture, opens Review, and verifies its email, amount and article message; final Send or Confirm remains manual. The live hosted receipt write-back was verified on October 14, 2026. Paid in this workflow records a confirmed send; recipient deposit and later cancellation/return need separate reconciliation.

Version 0.11 adds optional automatic preparation after each successfully recorded payment. Enable it in Settings for a specific volume and issue (defaults: Volume 33, Issue 2). After OTEManager confirms the receipt write-back, the worker refreshes that issue's unpaid articles, excludes captured receipts and session-sent articles, checks or creates the next recipient, fills saved presets, and opens Review. Every final Send or Confirm remains manual. Stop prevents subsequent bank steps; durable per-receipt claims prevent replay after interrupted preparation. **Prepare next unpaid article now** can start from a payment already recorded in that issue.

Version 0.12 opens the helper in Chrome's sidebar by default, with a remembered Popover option in Settings. It recognises Review even when Vancity retains cached form widgets, and explains why bank-preparation controls pause while a payment awaits confirmation. **Match open Sent transfer** verifies an opened historical transfer against saved send receipts using exact payment details, retains the original confirmation reference, and reports bank status without adding a duplicate Paid record. The Payment Manager helper card separates the live workflow, helper download, optional export controls and receipt confirmation.

Version 0.12.1 adds **Connect Vancity**, an explicit optional bank-site grant that keeps the sidebar usable when Chrome's temporary tab access expires or a new bank tab is opened. It requests only `my.vancity.com`, can be removed in Settings, and never retargets a pending payment to another tab. Closed idle connections can recover to the active bank tab; missing metadata and permission errors show the connection action directly.

Version 0.12.2 fixes Review verification when Vancity renders the currency symbol inside the Amount value. It checks the uniquely labeled Amount row, so a matching fee, balance or cached form value cannot stand in for the reviewed amount. Displayed email and message values also take precedence over cached inputs.

## DesignCraft newspaper workflow

In Publications, select articles and images and open them directly in the DesignCraft planner. Edit layouts, cover metadata/photo, featured article references and explicit continuation chains; generate native/PDF/IDML output through a configured worker or export recipes for the standalone CLI.

See the [workflow guide](docs/DESIGNCRAFT.md), [complete integration review](docs/DESIGNCRAFT-INTEGRATION-REVIEW.md), [worker setup](docs/designcraft-native-service.md), and [committed report, proof bundle and verification record](docs/designcraft-review/README.md). The optional `Dockerfile.native` supplies the Linux compiler runtime. Production deployment and fresh Adobe/printer verification remain outstanding.

The [published sample Issue Studio](https://ote-issue-studio.ahzs6455.chatgpt.site) offers story selection, issue/cover controls, PDF and editable IDML downloads, plus the full review/evidence/toolkit. See [demo documentation](docs/OTE-ISSUE-STUDIO.md) for verification and its distinction from the native OTEManager worker.

The actual [DesignCraft web editor](docs/DESIGNCRAFT-WEB.md) is bundled in OTEManager under `public/designcraft/editor/`. Staff can edit/save/export in their browser; the optional server composer turns article recipes into checked editable pages and opens them in the editor.

Composition can also run entirely in the browser, or on the server without the CLI: the compilers are ported to JavaScript and drive a headless WebAssembly build of the same DesignCraft 0.4.0 engine (output pixel-identical to the CLI across all 104 recipes). The planner's **Compose in this browser** panel generates pages and whole issues locally and suggests checked layout variants for chosen articles. See [browser and server composition](docs/DESIGNCRAFT-CLIENT.md).
