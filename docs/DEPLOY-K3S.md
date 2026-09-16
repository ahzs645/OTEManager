# Deploy to self-hosted K3s

Runs OTEManager on a single-node K3s cluster with a **self-hosted Convex
backend**, so no Convex Cloud project is involved and no data leaves the
network. The image is built on the cluster node and imported straight into
containerd; nothing is pushed to a registry.

This is an alternative to [Deploy with Convex Cloud](../README.md#deploy-with-convex-cloud).

Last verified: 2026-09-14, against K3s v1.31.4 with cert-manager and MetalLB.

## Shape of the deployment

```
Traefik ingress
   ├── http://otemanager.k8s.ote
   └── https://otemanager.k8s.overtheedgepaper.ca   (Let's Encrypt)
        │
        ▼
   Deployment/otemanager  :3000        ← this repo, built by the Dockerfile
        │  server-only bridge, authenticated with CONVEX_SERVER_SECRET
        ▼
   Deployment/otemanager-convex  :3210 api  :3211 site
        │
        ▼
   PVC 40Gi  storageClass: local-path
```

Manifests and the helper scripts referenced below live in the infrastructure
repo (`Proxmox-Playbook-main`) under `k8s/otemanager/` and `scripts/`.

## The Dockerfile

Two-stage. The builder installs dev dependencies and runs `npm run build`;
Nitro emits a self-contained `.output`, so the runtime stage copies only that
and carries no `node_modules` (~339 MB image, runs as the `node` user).

**Node 24 is pinned deliberately** — it matches `.nvmrc`, and the project README
notes the Nitro development adapter drops response headers under Node 26.

`TMPDIR` is set to `/tmp`, which the deployment backs with an `emptyDir`,
because backup import and export stream multi-GB archives through it.

## Everyday development loop

```sh
./scripts/otemanager-deploy.sh            # in the infrastructure repo
```

Builds the current working tree on the cluster node and rolls it out. The
source is **rsynced, not pulled from git**, so uncommitted changes are included.

This app bakes no build metadata into the bundle and exposes no health or
version endpoint, so the **image tag is the only record of what is running**. It
encodes the commit plus a `-dirty` suffix when the tree was modified:

```sh
kubectl -n otemanager get deploy otemanager \
  -o jsonpath='{.spec.template.spec.containers[0].image}{"\n"}'
# docker.io/otemanager-local/app:dev-1789395915-c8492df-dirty
#                                        ↑timestamp ↑commit ↑uncommitted changes
```

Settings in the app shows the Convex connection status without exposing
credentials, which is the quickest check that the backend link is healthy.

| Flag | Effect |
|---|---|
| *(none)* | Convex functions → build → apply → wait → prune |
| `--skip-convex` | Skip the Convex function deploy; faster when only app code changed |
| `--keep N` | Keep N old dev images on the node (default 3) |
| `--rollback` | Return to the previously deployed image |

Convex functions are deployed **before** the new image on purpose: push the app
first and it calls functions that do not exist yet. The previous image is
recorded on the Deployment as the `ote.previous-image` annotation before
applying, and a failed rollout is reverted automatically.

For tight UI iteration a node build is still slower than local development. Use
`npm run convex:dev` plus `npm run dev` for that, and the cluster deploy when
you want the real thing: built image, in-cluster Convex, ingress and TLS.

## First-time setup on a fresh cluster

A self-hosted Convex backend starts completely empty. Three things are required,
and until all three exist the app fails in ways that look like application bugs:

1. **Admin key** — `/convex/generate_admin_key.sh` inside the Convex container.
   Needed by the Convex CLI.
2. **Functions and schema** — `convex deploy`. Without them every query 404s.
3. **`CONVEX_SERVER_SECRET` set *inside* Convex** — `convex env set`. The value
   lives in **two** places: the Kubernetes Secret the app reads, and Convex's own
   environment, which validates it. If they differ, every call is rejected.

`scripts/otemanager-bootstrap.sh` performs all three.

> `.env.local` in this repo points the Convex CLI at a **local anonymous**
> deployment and silently wins over a self-hosted target. The scripts move it
> aside for the duration and restore it on exit, including on failure. If you run
> the CLI by hand against the cluster, do the same.

## Required Convex origin settings

`CONVEX_CLOUD_ORIGIN` and `CONVEX_SITE_ORIGIN` map to the backend's
`--convex-origin` / `--convex-site` flags and tell Convex how clients reach it.
They are **required**:

```yaml
- name: CONVEX_CLOUD_ORIGIN
  value: http://otemanager-convex:3210
- name: CONVEX_SITE_ORIGIN
  value: http://otemanager-convex:3211
```

Left unset, `files:uploadUrl` returns a **relative** URL and every upload fails
in `storage/convex.ts`:

```
TypeError: Failed to parse URL from /api/storage/upload?token=...
```

Records import perfectly in that state, so the fault surfaces only when files
are written — which reads like an app bug rather than missing configuration.

**Running the importer from outside the cluster:** the origin must be reachable
from wherever the importer runs, and `otemanager-convex:3210` does not resolve
on a laptop. Either run the importer inside the cluster, or temporarily point
the origin at `http://127.0.0.1:3210` while port-forwarding and set it back
afterwards. Stored records keep a `storageId`, not a URL, so changing the origin
later is safe.

## Restoring a backup into the cluster

```sh
kubectl -n otemanager port-forward svc/otemanager-convex 3210:3210 &

mv .env.local .env.local.bak
export CONVEX_URL=http://127.0.0.1:3210
export CONVEX_SERVER_SECRET="$(kubectl -n otemanager get secret otemanager-app-secret \
  -o jsonpath='{.data.CONVEX_SERVER_SECRET}' | base64 -d)"

node --import tsx scripts/import-backup.ts /path/to/backup.zip --dry-run
node --import tsx scripts/import-backup.ts /path/to/backup.zip
mv .env.local.bak .env.local
```

Always `--dry-run` first — it validates the manifest, relationships, file sizes
and checksums without writing anything. The default merge mode keeps existing
record IDs and skips files matching on SHA-256 and size, so re-running after a
failure resumes rather than duplicating.

A 1.5 GB restore (239 articles, 817 attachments, 795 files) completes in a few
minutes over a LAN port-forward.

## Storage durability

The Convex PVC uses **`local-path`, not a network StorageClass**, and that is
deliberate: Convex stores data in SQLite, which needs real filesystem locking,
and SQLite over NFS risks corruption.

The consequence is that **all records and uploaded files live on the cluster
node's disk and do not survive a node rebuild**. Take backups — Utilities →
Backup & Restore in the app, or the CLI export.

`kubectl delete namespace otemanager` deletes the PVC and all data with it.

## Operations

```sh
kubectl -n otemanager get pods,pvc,ingress,certificate
kubectl -n otemanager logs deploy/otemanager --tail=50
kubectl -n otemanager get deploy otemanager \
  -o jsonpath='{.spec.template.spec.containers[0].image}{"\n"}'
```
