# DesignCraft companion compiler

This is a reconstructed companion workflow for stock DesignCraft v0.4.0. It is not a DesignCraft plugin, fork, or browser WASM engine. The Sites gallery previews templates and downloads files; native composition runs locally with Python 3 and DesignCraft's CLI.

## Compile an editable page

Download the official DesignCraft v0.4.0 release for your operating system. `download-cli.py` fetches the pinned Linux x86_64 release and checks its published SHA256SUMS.

```sh
python3 tools/designcraft/download-cli.py --output /tmp/ote-designcraft
python3 tools/designcraft/compile-template.py \
  --library public/designcraft/templates.json \
  --template story-1-top-balanced \
  --output /tmp/ote-page \
  --cli /tmp/ote-designcraft/designcraft-0.4.0-linux-x86_64/bin/designcraft-cli
```

Use an ID listed in `templates.json`. Without an issue JSON, the page explicitly uses illustrative content and image/block boundaries. No generated example claims to reproduce a previous issue.

For OTEManager content, export the DesignCraft issue package, extract its ZIP, and pass its JSON file with `--issue`. The schema is `ote.designcraft.issue.v1`. Photos must have local `path` values relative to the JSON location or absolute paths. The compiler does not fetch remote photo URLs. `--articles article-id-1,article-id-2` selects distinct articles in slot order. Otherwise it uses the first required articles from the export. Cover templates keep up to three selected article records for photos and reference labels; they do not place full article bodies on the cover. Those bodies remain intact in the issue/source JSON for interior pages.

`--page-id stable-page-id --page-number 7` records the stable page identity in native object labels and writes the chosen folio. The compiler does not assemble an entire issue or recalculate cover references when page order changes.

## Files and full-copy handling

Successful output includes:

- `page.designcraft`, editable in DesignCraft.
- `page.pdf`, a rendered page preview.
- `page.idml`, an interchange package for an InDesign compatibility review.
- `commands.dcs` and `export.dcs`, the commands used; focal transforms additionally pass through the compiler’s native ZIP patch and reopening step. Paths reference the build location, so regenerate with the compiler after moving the output folder.
- `preflight.json`, `document-inspect.json`, `build-manifest.json`, and the full source article record.
- `Links/` containing local input images, and `Document Fonts/` when licensed Source font files were available beside the library in `assets/fonts/` or passed with `--font-dir`.

Every interior article body is compared against the saved native story. The cover manifest explicitly reports article body retention in the source record only. No text is summarized, cut, or silently shrunk. Overset, missing fonts/glyphs, or an article photo slot without a supplied local photo blocks final PDF/IDML export. The full-copy native draft and error reports remain available for adjustment. The schema supports a body frame's `columns` property. A single article uses one body frame; arbitrary shapes requiring separately threaded body fragments need additional engine integration.

Fonts use Source Sans 3 and Source Serif 4 with their SIL Open Font License notices. The editable presets use these Source fonts as substitutions for the original Decalotype/Helvetica Neue/Salted typography; they do not reproduce the original cover fonts. Proprietary source fonts are not redistributed by this compiler. A browser recipe ZIP contains its adjusted `templates.json`, `issue.json`, and local media; extract the ZIP and pass those two JSON paths to this compiler. Photo slots can carry `focus: {x: 0..1, y: 0..1}`. The compiler applies proportional fill and clamps the chosen focal point inside the frame, stores the resulting native graphic transform with automatic fitting disabled, and reopens the document for final preflight/export. Embedded image bytes remain unchanged. `focal-crop.json` records the dimensions, transform, and asset checksums. This matches the browser focal formula for the same frame and intrinsic image dimensions.

An actual OTE logo can be placed through a template slot's `asset` path relative to `templates.json`; the original artwork is preserved as a graphic.

## Original covers and centre spread

The issue package can carry requests to preserve the original cover and double truck. This single-page compiler records that requirement but does not perform preservation. Preserving all native geometry, text threads, linked graphics, and fonts requires the original native issue and a dedicated issue edit path. A PDF by itself is not enough to retain editable source objects. Reconstructed templates and recovered original PDFs are separately labeled in the gallery.

IDML export has been exercised through stock DesignCraft. It has not been opened and visually verified in Adobe InDesign here; check fonts, cropping, page numbers, and overset before production use.
