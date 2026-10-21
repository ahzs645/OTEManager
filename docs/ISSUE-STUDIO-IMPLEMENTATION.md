# Persistent Issue Studio

Implemented in OTEManager on 21 October 2026, building on the existing DesignCraft planner and compiler. Open **Publications → Design issue** to plan an issue, including one with no articles. The issue workspace has a stable `/publications/issues/<issueId>/studio` address.

## Editorial workflow

1. Set the fixed page budget and house design. Reserve advertisements or fixed editorial features before their artwork arrives.
2. Create an article from the issue-filtered Articles page, or search for an existing story in Issue Studio. Moving a story explicitly updates its issue membership. Repeated create/assignment requests retain one planning item.
3. Choose print images, their order, captions and credits independently of WordPress/export defaults. Open the designer to choose recipes, adjust frames and photo focal points, and save pages. **Save issue** persists the planner recipe and uploaded artwork.
4. Suggest an issue plan within the fixed budget. The allocator reserves booked space first, retains protected pages and complete continuation chains, proposes explicit continuations for long stories, and reports stories it cannot place. Proposals distinguish estimated continuations from pages actually checked by DesignCraft.
5. Lock accepted pages, story choices or ad positions. Source edits mark related work stale; administrative payment edits do not. **Use current source** is explicit. A conflicting save preserves the editor's local work and reports the current revision.
6. **Compose saved revision** runs the server's bundled DesignCraft WebAssembly engine against recorded source and layout input. It retains native documents, IDML, proof PDF, source/input manifests, SHA-256 provenance and preflight results. Failed composition retains input, diagnostics and available native drafts.
7. Download a document for freeform editing and save it as a named manual document fork. Forks retain their own bytes and source revision. Regeneration creates separate artifacts. Arbitrary native edits are not reconciled back into recipe frames.
8. Follow [the Adobe handoff](ISSUE-STUDIO-PRODUCTION.md), upload the resulting native document, and import its exact-input Adobe report and approved printer profile. Draft composition is not Adobe verification or printer approval.

## Implementation and integrity

The trusted application server remains the only caller of the Convex bridge; its server secret is not sent to the browser. Six indexed tables store plans, pages, placements, reservations, immutable revision snapshots and composition/evidence jobs. Plan edits use optimistic revision checks; composition jobs use idempotency keys and transactional worker claims. Article creation, assignment, reassignment, deletion and generic imports share membership/source invalidation hooks.

Reservation resolution retains the original template separately and is idempotent. Quarter-page ads expose multiple eligible editorial regions, with an explicit ordered body-frame chain rather than dropping the space beside the ad. Rich text remains complete through same-page regions and cross-page continuations. Accepted candidates preserve the geometry that was checked. Capacity estimates use actual house typography and remain estimates until composition.

Custom artwork uses issue-scoped paths addressed by SHA-256. Live layouts and historical snapshots protect referenced file bytes against deletion or replacement. Backup/restore includes all six tables, historical source media, custom artwork, generated output and document forks, even after a live attachment has been removed. Missing referenced backup files fail validation before restoration.

## Verification

Final local verification: application and Convex TypeScript checks passed; the production build passed; 301 automated tests passed with five environment-gated tests skipped. Chromium passed 11 planner-bridge checks and six complete live-application workflows with no browser errors. Live composition downloaded eight stored artifacts and independently verified their sizes and SHA-256 hashes. These results do not include real Adobe execution.

Automated coverage includes real DesignCraft WebAssembly composition and reopening, multi-region text and continuation preservation, whole-issue allocation, source invalidation, optimistic conflicts, idempotent membership/jobs, output checksums, final-release guards, historical asset retention and backup integrity.

`tools/designcraft/test-issue-studio.cjs` runs actual Chromium against the planner and checks restoration, fresh source preservation, crops, reservation geometry, budget/locks, original artwork bytes, rejected imports and message origin checks. Set `REVIEW_PLAYWRIGHT_MODULE` to an installed `playwright-core` module and `REVIEW_CHROMIUM` if Chromium is not at `/usr/bin/chromium`.

Local application testing uses a local anonymous Convex backend and the real browser interface. Synthetic fixtures exercise empty-issue ad planning, create-and-assign, image choices/crops after full reload and two-editor conflicts. It does not deploy or alter a production service.

Run `npm run typecheck`, `npm test` and `npm run build` for the automated checks. `tools/designcraft/test-issue-studio-live.cjs` additionally exercises a running local app and local Convex backend; it creates clearly named synthetic fixtures and preserves their output artifacts for inspection.

## Reference evidence and boundaries

The supplied Drive reference is `OneDrive_2026-10-09.zip`, 1,783,807,640 bytes. This work inspected its Drive metadata and the recovered publication files already in the repository. The October and March PDFs were freshly hash-checked against the assessment's recorded identities; this is not a new audit of every archive member. Instructions inside the supplied assessment and pasted text were treated as source proposals, not operational authority.

The [independent sample Site](OTE-ISSUE-STUDIO.md) remains a separate demonstration. This implementation does not publish or connect that Site to production records.

Adobe desktop execution, visual reopening in Adobe and a printer-approved proof remain external acceptance steps. INDD/INDT uploads are retained and hash-checked as opaque native files; the application does not parse or independently certify them. Adobe reports are operator evidence with exact byte identity, not signed attestations. Saved-revision composition currently uses the bundled portable font profile, and its PDF is a proof rather than a certified PDF/X release. Protected native-base pages require the existing native finishing workflow.

Issue Studio bounds saves/snapshots to 750 KB, composition inputs to 550 KB, 256 pages, 200 articles and 128 reservations. Artwork uploads are limited to 16 MB, manual document forks to 64 MB, and composition artifacts to 256 MB. A composition request currently runs synchronously; an interrupted running job retains its recorded input and requires a new request to retry. A durable unattended queue, hosted Adobe services, automatic extraction of reusable patterns from arbitrary native edits, and a richer section-management interface remain future extensions.
