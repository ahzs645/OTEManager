# Issue Studio production checks

Issue Studio keeps editable issue choices and immutable revision snapshots. A saved layout is an **estimate**. It becomes **DesignCraft checked** only after a successful composition of that exact revision, with complete copy and recorded source, media, template, fonts, print-profile and engine identities. **Adobe verified** additionally requires a matching Adobe report for the exact input and IDML bytes. A change to the revision makes earlier results stale.

The shared production guard in `shared/issue-studio-production.ts` rejects final release when booked advertisement artwork is pending, included stories are unplaced or stale, the saved pages do not fill the fixed budget, composition evidence is incomplete, Adobe evidence differs from the composed bytes, preflight reports problems, printer requirements differ, or an active manual fork remains unreconciled. Drafts and source snapshots remain available when release is blocked. The server must run this guard at its final-output boundary; a browser label is not an authorization check.

Composition requests are persisted inputs, not evidence of completed composition. A queued job must never be presented as a checked document. The `/api/issue-studio/$issueId/compose` request claims its saved job transactionally and composes synchronously in Node with the real packaged WebAssembly engine. It stores exact source, templates, assets, fonts and engine provenance; immutable native output, proof PDF, IDML and font package; and real preflight diagnostics. It supports the bundled portable font profile. Proprietary uploaded font scopes and rebuilding preserved pages against an existing native base require separate integration. This is a synchronous request runner, with no unattended worker or automatic retry after process interruption; a process interruption can leave a recorded running job for operational review. A deliberately retried failed composition needs a new idempotency key. It does not claim Adobe service access. Importing a report is operator-supplied evidence; it is not cryptographically signed proof that Adobe ran. Do not accept a client-supplied `adobeInDesignTested` boolean as a substitute.

## Desktop Adobe handoff

The initial bridge is an operator-run desktop InDesign script. It preserves the incoming IDML and writes a separate native document. It does not overwrite an existing INDD or alter the editor's open document. It checks fonts, links, story overflow, raster effective resolution, page dimensions/count, bleed, the document CMYK profile and an explicitly installed Adobe preflight profile. It saves diagnostics even when checks find production problems. An unknown preflight DOM response stops the bridge.

Prepare a publisher-approved profile, for example:

```json
{
  "pageWidthPoints": 756,
  "pageHeightPoints": 792,
  "bleedPoints": [9, 9, 9, 9],
  "pageMultiple": 4,
  "preflightProfile": "OTE Press",
  "colorProfile": "Printer supplied CMYK profile name",
  "minImagePpi": 300
}
```

These numbers are examples, not OTE's confirmed printer requirements. Bleed order is top, bottom, inside/left, outside/right. The approved Adobe preflight profile must include the publisher's font, link, overset, color, resolution and print requirements. The separate profile equality check does not inspect the configuration of an Adobe profile with the same name; keep the approved profile installation under editorial control.

1. Select the approved print profile before composing the saved revision. Download its IDML, input/provenance and `document-fonts.zip`. The generated PDF is a proof and is not asserted to satisfy a printer's final PDF standard. Install the exact packaged fonts, linked artwork if needed, CMYK profile and approved preflight profile on the InDesign workstation. Engine-preflight failure keeps source and draft artifacts and blocks proof/IDML output; source acceptance or reservation mismatches fail before composition.
2. Create a fresh, empty output directory. Prepare the desktop script with Node 24:

   ```sh
   node tools/designcraft/adobe-validation.mjs prepare /absolute/issue.idml INPUT_SHA256 /absolute/print-profile.json /absolute/new-output-directory
   ```

3. In desktop InDesign, run the generated `run-adobe-validation.jsx` from the Scripts panel. It opens the IDML, recomposes it, runs checks and writes `validated.indd` plus `adobe-checks.json` in the output directory. It does not automatically relink missing files or substitute fonts. Missing resources remain visible failures.
4. Bind the report to actual source/native bytes:

   ```sh
   node tools/designcraft/adobe-validation.mjs finalize /absolute/new-output-directory
   ```

   This verifies the IDML still matches its prepared digest, hashes the saved INDD, validates the report contract, and writes `adobe-validation.json`. It refuses to overwrite an earlier report. Final release must still compare that report with the exact saved composition and approved print profile.
5. Upload the validated INDD through Issue Studio's native-fork upload and import `adobe-validation.json` with the same print profile against the completed composition job. The server verifies the uploaded INDD digest and exact IDML/input identity, records immutable report evidence, and recomputes release readiness. Reports are operator evidence and are not signed by Adobe. Changing the print profile requires another composition.
6. Open representative approved native documents and visually inspect typography, crops, continuations, references and intended page design. Print-profile approval and visual editorial approval are separate from machine checks. Generate the printer's final PDF using the publisher's approved Adobe export settings.

The ExtendScript bridge has not been executed in Adobe in this cloud workspace. Its DOM result handling must be confirmed on the team's recorded desktop InDesign version before production use. It does not claim INDT creation, PDF-export verification, hosted InDesign API support, or InDesign Server deployment. Those remain separate production integrations.

## Manual document forks

A freely edited native document is a named fork with its source revision and artifact SHA-256. Keep its bytes and the source revision. Regeneration writes a different named artifact. `assertNativeForkWritable` prevents replacing an active fork; final release is blocked until an active differing fork is reconciled or explicitly archived. Do not reconcile by silently regenerating over the editor's document.

## Historical artwork retention

Stored files referenced by live layouts or immutable snapshots cannot be deleted or replaced with different bytes. Upload replacement media under a new path. Identical retries preserve the original storage identity. Snapshot metadata and hashes identify a source; retained bytes make that source reproducible. Backup/restore must include those retained paths as well as the plan records.
