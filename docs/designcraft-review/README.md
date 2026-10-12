# Committed OTE pipeline review evidence

This records the completed local review and integration against main base `0eff034`. Pushing these changes does not itself establish a production deployment. The older hosted review Site remains its earlier version.

- [Full integration review](../DESIGNCRAFT-INTEGRATION-REVIEW.md): scope, findings, corrections, integration and publishing precedents.
- [Review report](OTE-pipeline-review.pdf): readable findings and verification summary.
- [Proof bundle](OTE-pipeline-proof.zip) and [SHA-256](OTE-pipeline-proof.zip.sha256): application/compiler logs, browser evidence, portable editable whole-issue proof, original-font rendered proof, container checks, research and reproduction scripts.
- [Machine-readable closure](review-closure.json): eight corrected findings and remaining boundaries.
- [Checked issue cycles](independent-checked-cycles.json): full text, links, artwork, frame order and rendered-page equality over three cycles.
- [Direct planner handoff](handoff-check.json), [portable container export](portable-container-check.json), [original-font container export](original2025-container-check.json), [failed container export](failed-container-check.json).
- [Worker configuration and API](../designcraft-native-service.md); [standalone compilers](../../tools/designcraft/native-readme.md).

## Verified results

| Check | Result |
|---|---|
| Application tests | 45 passed, including 13 worker/service tests |
| Compiler tests | 32 passed |
| Native helper tests | 9 passed on each engine 0.4.0 and 0.6.0 |
| Type checking / production build | Passed |
| Recipe sweep | 104 recipes; 312 checked cycles, text/assets/raster unchanged |
| Long article | Complete 12,331-character rendered body threaded across allocated pages; zero final errors/warnings |
| Actual Linux amd64 Docker server | Both font profiles export native/PDF/IDML; failed preflight keeps draft/source and withholds PDF/IDML |

The template sweep predates the last folio/metadata hardening; the final compiler/helper/application and container checks cover those changes. The original-font sweep also passed 104 recipes/312 cycles. These synthetic fixtures verify reuse and retention; they do not establish an automatic faithful remake of every published issue.

## Reproduce

From the repository root, install Node 24 dependencies and Python compiler dependencies, then download the verified stock CLI:

```sh
npm ci
python3 -m pip install -r tools/designcraft/requirements-audit.txt
python3 tools/designcraft/download-cli.py --output /tmp/ote-designcraft
npm run typecheck
npm run build
npm test
```

Set `DESIGNCRAFT_CLI` to the executable path printed by the downloader. Native service tests additionally use `DESIGNCRAFT_TEST_CLI` and optionally `DESIGNCRAFT_TEST_FIXTURE` (an extracted proof source directory containing `issue.json` and `templates.json`). Then run:

```sh
python3 tools/designcraft/test-workflow.py
python3 tools/designcraft/test-native-pipeline.py
python3 tools/designcraft/verify-workflow.py --help
python3 tools/designcraft/audit-sources.py --help
```

Use the verifier's documented arguments to select the recipe library, fonts, output directory and cycle count. The source auditor needs the original private input archive; the raw Drive packages and uploaded proprietary font files are intentionally outside the public repository. Native original2025 verification requires the controlled private font directory. Browser/container reproduction scripts inside the proof bundle record the fixtures and HTTP adapters used; they contain local review paths that must be adjusted on another machine.

The [template kit](../../public/designcraft/template-kit.zip) contains the standalone tools, recipes, licensed fonts and seven examples. The larger full-review ZIP is reproducible with `python3 tools/designcraft/package-review.py --zip /path/outside/repository/ote-designcraft-corrected.zip`; its constituent review files and source changes are already committed. It is not committed again as a >100 MB duplicate archive. The 11 MB proof bundle is a dated evidence snapshot; maintained implementation and documentation live in the repository.

## Still required

Fresh Adobe InDesign reopening/export, printer approval, native Mac/Windows execution, Linux arm64 container execution, production/Site deployment, and repairs to historical missing content/artwork remain outstanding. Multi-replica native service needs sticky routing or shared job/status storage; in-memory status is lost on restart. Original proprietary fonts remain privately configured, never public font assets or Docker image contents.
