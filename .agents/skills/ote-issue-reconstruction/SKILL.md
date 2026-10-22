---
name: ote-issue-reconstruction
description: Recreate complete OTE newspaper issues from PDF and InDesign sources, recover original article records and metadata, import them into OTEManager, verify editable DesignCraft/PDF/IDML outputs, and package generated deliverables for Google Drive. Use for historical issue recovery, original article setup, measured advertisements, recurring President questions, or extending this repository's source archive pipeline.
---

# OTE issue reconstruction

Work from the OTEManager repository root. Reuse its compilers, builders and import
contracts. Read applicable AGENTS.md instructions and use available Convex,
Drive and browser skills when working in those systems.

Read [workflow](references/workflow.md) for commands and integration points.
Read [source lessons](references/source-lessons.md) before interpreting originals
or changing identity, page assignment, text recovery or financial defaults.

## Establish the requested result

- A complete issue includes every physical page: cover, advertisements, blank
  editorial areas, fixed sections, President Q&A, board panels and photo spreads.
- Offer the existing modes explicitly: preserved source artwork, or supported
  source text rebuilt into editable native frames. State what remains artwork.
- Original article setup means semantic article records, public credits, actual
  edition assignments, original dates, available media and source provenance.
- When Drive delivery is requested, put generated PDFs, editable bundles,
  recipes, article exports, metadata and guides in the user's folder. Keep
  input backups and unrelated private data out of the publishing package.
- Continue authorized implementation and verification. Repository pushes,
  production deployment and historical-data import are distinct operations;
  perform the operations the user requested without adding approval gates.

## Inspect and recover source evidence

1. Inventory the supplied Drive files and committed originals. Record exact
   paths, sizes and SHA-256 values. Pair PDFs and IDML by evidence, retaining
   revision differences. Never assume similarly named files are identical.
2. Count physical pages and map each page's section, ad rectangles, source text,
   photographs, blank areas and spread partners. Preserve unfinished source
   pages, literal placeholders, unusual section letters and stale printed dates.
3. Read IDML story XML and available database metadata alongside the PDF. A blank
   PDF area does not establish that no article existed. Retain full paragraphs,
   source story IDs, credited bylines and historical reprint notes.
4. Use a sanitized allowlist when recovering metadata from a database backup.
   Exclude contacts, payments, bank information, feedback and unrelated records.
   Respect anonymous credits and omit their underlying identity from exports.
5. For large source archives, use local ZIP input or the selective recovery
   script's normal public Drive range support. Check actual HTTP results. If a
   source needs authentication or the connector cannot supply its bytes, record
   that limit and continue with available material. Do not fabricate recovery.

## Reconstruct the complete issue

1. Extend the measured source maps and existing page/whole-issue builders.
   Capture source page geometry and typography rather than guessing from labels.
2. Preserve source graphics as vector artwork where possible. Remove supported
   source text from its background before rebuilding editable text. Retain
   photographs, textures, lines and decorative graphics.
3. Make replacement artwork independent: clear the old photograph or ad from
   its background, then place it in its own measured frame. Test a replacement
   with a different aspect ratio to catch remnants of the old creative.
4. Use semantic paragraph frames for recovered articles and Q&A where available;
   retain generic editable source text regions for other supported lettering.
   Preserve source blanks. Never write missing editorial copy to fill a layout.
5. Keep source order, physical page count and linked spreads. Disable automatic
   print padding for historical reconstructions, including 17-page originals.
6. Use the shared JavaScript compiler and DesignCraft 0.9.0 WebAssembly engine
   across browser, server and offline exports. Recheck fit for font substitutions
   and private original fonts. Block final export on overset while retaining copy
   and a native draft for repair.

## Recover and import the original articles

1. Build `ote.source-archive.v1` with stable source keys and original article IDs.
   Keep distinct original IDs distinct even when their titles or bodies match.
   Keep layout revisions separate while linking them to their actual edition.
2. Preserve literal titles, public bylines, anonymity preferences and all recorded
   original dates in provenance. Unknown bodies stay empty with an explicit
   recovery status; unknown authors and dates stay unknown.
3. Record where copy was found without silently changing its original edition.
   An IDML-only story cannot claim a page in a different blank PDF revision.
4. Distinguish actual supplied file bytes from attachment metadata and embedded
   image inventory. Attach only verified stored bytes with a defensible article
   association. Missing references must not create broken attachment rows.
5. Use the existing review/import route and source-link table. Bind preview to
   metadata and file hashes. Preserve existing editorial and payment data; only
   fill a matching original record's empty body with verified recovered copy.
6. Import new historical records as Archived with unknown payment/tier unset.
   Keep unverified history out of unpaid queues and financial totals. Preserve
   real recorded payments, edits and submission dates on existing records.
7. Exercise first import, repeat import, backup/restore identity, file retry and
   conflicting edited copy. Ensure Articles and Publications expose original
   dates, credits, recovery status and provenance.
8. Exclude articles without body text from DesignCraft content exports and show
   the reason. Keep complete source-page reconstruction available for those
   editions. Verify all-bodyless editions cannot trigger an empty-body export.

## Verify the result users will receive

- Compare source and output PDF pages at equal scale. Check page order/count,
  source artwork, spread placement, complete copy, font substitutions, ads and
  original cover geometry. Describe numerical differences as measurements.
- Read back native and IDML output; inspect real PDF proofs. Never call placed
  PDF text editable or claim Adobe/printer approval from engine round-tripping.
- Verify original metadata and body text against independent source evidence,
  not just the generator's output. Keep known missing bodies/files visible.
- Test the main app and planner: edit/save, replace artwork, export/reimport,
  import JSON/ZIP, open Articles/Publications, inspect a real stored image, and
  repeat import. Capture actual browser failures and fix them before completion.
- Compile a delivered recipe from an independently extracted toolkit, with no
  checkout-only source asset fallback. Run appropriate tests, both TypeScript
  checks and a production build after implementation changes.
- Record current evidence under `docs/designcraft-review/` and
  `docs/source-archive-review/`. Prior evidence is historical, not a fresh pass.

## Package, publish and hand off

1. Generate complete PDFs, editable native/IDML bundles, self-contained issue
   recipes, article Markdown/CSV/JSON, an import ZIP, offline kit and usage guide.
2. If authorized, upload generated deliverables to Drive using its connected
   tools. Reuse the recorded folder/file IDs when continuing a delivery. Update
   existing files in place instead of creating duplicate versions accidentally.
3. Read back folder contents, IDs and byte counts. Keep local SHA-256 values
   separate from remote hash verification claims. Keep the Drive index separate
   from the canonical article manifest so links do not change import identities.
4. For a requested Git push, inspect the complete diff, exclude private inputs,
   preserve remote changes, commit source assets/tools/docs/skill, and push the
   requested branch without force. Verify the remote branch contains the commit.
5. Report actual links, recovered/missing counts, completed checks and whether
   the app was imported locally or deployed. Never imply a Git push migrated
   production data or that a successful upload recovered missing source files.
