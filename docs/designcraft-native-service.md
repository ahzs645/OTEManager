# Native output inside OTEManager

The planner submits its validated recipe ZIP to `POST /api/designcraft/native`, polls the returned job, and downloads editable native, PDF, IDML and source artifacts. This runs the existing Python compilers and configured DesignCraft CLI on the server. It does not use the desktop TCP control port.

Configure the normal application runtime:

| Variable | Value/default |
|---|---|
| `DESIGNCRAFT_CLI` | Executable path; defaults to `designcraft-cli` on PATH |
| `DESIGNCRAFT_PYTHON` | Python interpreter with `markdown-it-py`; default `python3` |
| `DESIGNCRAFT_TOOLS_DIR` | Trusted companion compiler directory; default `tools/designcraft` below the application working directory |
| `DESIGNCRAFT_FONT_DIR` | Portable open-font directory; default `public/designcraft/assets/fonts` |
| `DESIGNCRAFT_ORIGINAL_FONT_DIR` | Optional private, controlled original-font directory; enables `original2025` |
| `DESIGNCRAFT_PERSIST_ARTIFACTS` | `true` saves completed artifacts/source through the existing storage provider; default disabled |

Private Helvetica/Salted/Decalotype files are mounted or configured on the server and must be readable by the runtime user (UID 1000 in the container); they are not added to public assets or the Docker image. Native output bundles include their document-font scope for the requested private proof. Use the controlled selection of Helvetica faces rather than every uploaded font.

For a Linux container with Python and the checksum-verified stock CLI installed, build `Dockerfile.native`. It supports BuildKit `amd64`/`arm64`; the default engine version remains the tested `0.4.0`. The regular Dockerfile continues to run the app without installing a native worker. Run the native image with bounded CPU/memory and writable temporary storage, for example `--cpus=4 --memory=3g --tmpfs /tmp:size=2g`. Provide the app's normal Convex/storage configuration separately. Building the Docker image is separate from deploying it.

If a corporate or execution-environment proxy requires an additional trusted CA, pass it as an optional BuildKit secret:

```sh
docker build -f Dockerfile.native --secret id=build_ca,src=/path/to/proxy-ca.crt -t otemanager-native .
```

The npm install uses `NODE_EXTRA_CA_CERTS`. Python dependency and verified-release downloads temporarily combine the system CA bundle with this secret through `SSL_CERT_FILE`/`PIP_CERT`, then remove the temporary bundle in the same build step. The secret is optional, is not copied into the image, and does not disable TLS verification.

macOS and Windows may use the same server module with their official CLI and Python paths. Linux workers additionally apply inherited native-process address-space and single-file-size limits. The Linux amd64 container build and actual production server exports were verified with both font profiles. Native macOS/Windows execution and Linux arm64 container execution still need platform testing.

## API contract

- `GET /api/designcraft/native`: `{available,version,fontProfiles,limits,persistence,message}`.
- Multipart POST fields: `recipe` ZIP, `mode` (`page` or `issue`), `fontProfile` (`portable` or `original2025`), `booklet` (`true`/`false`), optional `base` ZIP with exactly one `.designcraft` file and its adjacent `build-manifest.json`. Base media must be embedded. Uploaded scripts are ignored.
- Successful admission returns HTTP 202 with `{id,status,...}`. Poll `GET /api/designcraft/native?job=ID`; statuses are `queued`, `running`, `completed`, `failed`. `message` gives the result or error. Only terminal jobs expose downloadable artifacts.
- Download with `?job=ID&artifact=KEY`. Keys include `bundle`, `native`, `pdf`, `idml`, `manifest`, `preflight`, `source`, `interchange`, `log`. The job's `artifacts` map lists available names, MIME types, byte counts and persistence flags.
- Missing/expired jobs return 404; bad recipes 400; stalled uploads 408; oversized requests 413; full queue/concurrent upload limits 429; unavailable native configuration 503. Unconfigured original fonts return 409.

The bundle contains the native document, available proof exports/reports, `Document Fonts`, sidecar metadata and the sanitized recipe's exact source/media. A failed build keeps source and any complete native draft, but final PDF/IDML artifacts are withheld. The caller must show failure and preflight results rather than interpreting a downloadable draft as completed output.

Jobs live in one application process. They expire after one hour; completed jobs can be evicted earlier to admit new work when the 12-job retention capacity fills. In-memory job status is not restored after restart. Optional persisted files remain in storage under `designcraft/jobs/ID/`; the application storage/backup policy governs those durable copies. For multiple replicas, route a job's polling/downloads to the same instance or replace this local registry with a shared queue/status store before enabling cross-replica native export.

Default bounds: two simultaneous uploads, a 60-second upload deadline, one compiler job, 12 retained jobs, 64 MiB combined compressed ZIP input, 256 MiB declared/streamed expansion including a nested native base, 2,048 ZIP entries, 8 MiB per JSON document, 10-minute compilation timeout, 512 MiB generated-output ceiling and a 2 GiB Linux native-process address-space ceiling. Optional persistence stops after a failed or 15-second stalled write; the completed local downloads remain available. The storage interface has no cancellation hook, so an already submitted storage write may finish later. Unknown/absolute/traversing paths, symlinks, duplicate paths, external native links and unsupported slot roles/geometry are rejected. Inputs cannot select executable paths, shell commands or server font directories.

## Verification

`npx vitest run tests/designcraft-native.test.ts` exercises traversal, aliases, symlinks, oversized and underreported ZIP expansion, invalid references/roles, failed-preflight drafts, persistence, queue/timeout/expiry and multipart validation.

Set `DESIGNCRAFT_TEST_CLI=/path/to/designcraft-cli` to include the real compiler test. `DESIGNCRAFT_TEST_FIXTURE` selects a complete issue fixture directory containing `issue.json`/`templates.json`; the test adapts its local media to safe ZIP-relative paths. The current fixture demonstrates exact long-source continuation and native cover references. Native/IDML synthetic proofs do not replace fresh Adobe or printer verification. See [committed verification evidence](designcraft-review/README.md) for the results and proof bundle.
