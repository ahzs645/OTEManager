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

A self-hosted Convex backend starts empty and needs three things before the app works: an admin key, the deployed functions and schema, and `CONVEX_SERVER_SECRET` set *inside* Convex so it matches what the app sends. `CONVEX_CLOUD_ORIGIN` and `CONVEX_SITE_ORIGIN` are also required — without them Convex returns a relative upload URL and every file upload fails while records still import cleanly.

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

## DesignCraft newspaper workflow

In Publications, select articles and images and open them directly in the DesignCraft planner. Edit layouts, cover metadata/photo, featured article references and explicit continuation chains; generate native/PDF/IDML output through a configured worker or export recipes for the standalone CLI.

See the [workflow guide](docs/DESIGNCRAFT.md), [complete integration review](docs/DESIGNCRAFT-INTEGRATION-REVIEW.md), [worker setup](docs/designcraft-native-service.md), and [committed report, proof bundle and verification record](docs/designcraft-review/README.md). The optional `Dockerfile.native` supplies the Linux compiler runtime. Production deployment and fresh Adobe/printer verification remain outstanding.

The [published sample Issue Studio](https://ote-issue-studio.ahzs6455.chatgpt.site) offers story selection, issue/cover controls, PDF and editable IDML downloads, plus the full review/evidence/toolkit. See [demo documentation](docs/OTE-ISSUE-STUDIO.md) for verification and its distinction from the native OTEManager worker.
