# OTE page and issue compilers

This companion uses the official DesignCraft v0.4.0 CLI and Python 3.11 or newer. Native composition runs through the configured OTEManager worker or locally; the browser planner creates portable recipes. It is not an installed DesignCraft plugin.

Install the compiler dependency and download the checksum-verified CLI:

```sh
python3 -m pip install -r tools/designcraft/requirements.txt
python3 tools/designcraft/download-cli.py --output /tmp/ote-designcraft
```

The downloader detects your operating system and CPU, checks the archive against the official release's `SHA256SUMS.txt`, extracts it, and prints the absolute CLI path. Use that printed path for `--cli`; do not substitute the Linux path on another system.

| System | Official archive selected |
|---|---|
| Linux Intel/AMD 64-bit | `designcraft-0.4.0-linux-x86_64.tar.gz` |
| Linux ARM 64-bit | `designcraft-0.4.0-linux-aarch64.tar.gz` |
| macOS Intel or Apple silicon | `designcraft-cli-0.4.0-macos-universal.zip` |
| Windows Intel/AMD 64-bit | `designcraft-0.4.0-windows-x64-portable.zip` |
| Windows ARM 64-bit | `designcraft-0.4.0-windows-arm64-portable.zip` |
| Windows 32-bit | `designcraft-0.4.0-windows-x86-portable.zip` |

On Windows, run these commands in PowerShell from the project directory:

```powershell
py -3.11 -m pip install -r tools/designcraft/requirements.txt
py -3.11 tools/designcraft/download-cli.py --output "$env:TEMP/ote-designcraft"
```

Then call the compiler with `py -3.11` (or your installed newer Python version), using the printed `designcraft-cli.exe` path and quoting paths containing spaces. The command examples below use POSIX line continuations (`\`); in PowerShell put the command on one line, or use PowerShell's backtick continuation. For an extracted template kit, the Python scripts and `requirements.txt` are at the kit's root. The downloader also resolves the official FreeBSD x86_64 archive. Platform selection and extraction logic are tested on Linux; macOS and Windows CLI execution still need verification on those systems.

## Build a page

```sh
python3 tools/designcraft/compile-template.py \
  --library public/designcraft/templates.json \
  --template story-1-top-balanced \
  --output /tmp/ote-page \
  --cli /tmp/ote-designcraft/designcraft-0.4.0-linux-x86_64/bin/designcraft-cli
```

Without `--issue`, this produces explicitly illustrative copy and photo boundaries. For real content, add `--issue /path/to/issue.json`; local photo paths resolve relative to that JSON. `--articles id1,id2` selects distinct articles in slot order. For an extracted browser recipe, pass its `templates.json` and `issue.json`, plus `--font-dir /path/to/template-kit/assets/fonts`. `--page-id` and `--page-number` set stable labels and the folio.

## Build a whole issue

In Publications, choose **DesignCraft ZIP**, select the articles and images, and download the bundle. Import that ZIP into the planner. Article choices apply to this export; image preferences are saved and shared with other exports. Save consecutive pages beginning at 1, choose article assignments, and use **Download whole issue recipe**. Extract that ZIP and the template kit:

```sh
python3 /path/to/template-kit/compile-issue.py \
  --library templates.json --issue issue.json \
  --font-dir /path/to/template-kit/assets/fonts \
  --output output --booklet --cli /path/to/designcraft-cli
```

The `ote.designcraft.issue.v1` JSON needs `layoutPlan.pages`, with unique stable `id`, consecutive `pageNumber`, `templateId`, and `articleIds` for each page. Every article must have one interior assignment; cover references may repeat it. `--allow-unplaced` permits an explicitly partial review, while still rejecting duplicate interior placements. `--booklet` requires a multiple of four pages. New issues use facing spreads, so pages 8/9 form the centre of a 16-page issue. Per-page style namespaces prevent one page changing another's typography. Cover references are derived from actual interior assignments, including after reordering.

### Preserve an existing layout

Add `--base-native /path/to/original.designcraft`. The base must have the same page count. Mark protected pages `mode: "preserve"`; protect both pages of any continuous spread. `layoutPlan.cover.mode: "preserve"` requires page 1 to be preserved. A preserved `layoutPlan.truck` needs the two centre `pageIds` in order. Protected article assignments are checked against their full native story text.

The compiler compares protected spread objects, parents and stories after saving. It refuses edits across a protected text thread, replacement of one half of a protected spread, or a known cover reference becoming stale while the cover is protected. Original layouts without a companion reference manifest still need editorial reference checking. A PDF cannot preserve editable native objects. Import IDML into DesignCraft first, resolve its resources, and save a native base.

## Cover form and automatic references

Choose a cover recipe, then use **Cover options** for release date, volume, issue number, cover headline/subtitle, photo caption/credit, uploaded image and crop focus. Choose zero to three distinct featured articles. Save the cover as page 1, and assign each featured article to exactly one interior page. Page references derive from stable article IDs and the current issue page order; moving pages recalculates them. Unplaced or duplicate selections block export. Date also updates the year and issue metadata.

`layoutPlan.cover` stores `date`, `volume`, `number`, `line`, `caption`, `photoPath`, `photoMimeType`, `focus` and `articleIds`. These fields survive recipe ZIP import and are resolved again by both native compilers. Current form values update a saved cover at export. Image bytes, actual filename extension and MIME type are retained. Reimport the ZIP to restore media; JSON alone contains paths. To apply cover field changes to a protected native cover, make it editable; known protected fields and references are checked against the base manifest.

## Content, fitting and output

Article `bodyFormat` defaults to `markdown`; `plain` retains literal text, including whitespace. CommonMark headings, paragraphs, emphasis, combined bold/italic, lists, quotes, code and URL links become native styles/ranges. Unsupported inline images or HTML fail explicitly; they need layout slots. Original Markdown is retained in `source-record.json` / `source-issue.json`, independently of composed text. `composed-record.json` documents the page's rendered story text. Nothing is summarized, cut or silently shrunk to fit.

Success produces editable `.designcraft`, PDF/X-4, IDML, native preflight, source records, command scripts and a build manifest. A preflight or required-photo error blocks final PDF/IDML output and retains the complete native draft. Native warnings, placeholder boundaries and Adobe verification status are explicit in the manifest. Invalid rebuilding removes stale final exports. PDF/X-4 output is not printer approval.

Fonts are loaded before composition and checked again after reopening. Open Source Sans 3, Source Serif 4 and JetBrains Mono files and their OFL notices are included. They are deliberate substitutions for the source fonts. The user subsequently supplied valid Salted and Helvetica Neue fonts. Private audits can use `--font-profile original2025 --font-dir /path/to/selected-original-fonts` for Helvetica Neue text, Decalotype cover dates and Salted issue/subtitle lines. These files are kept outside the public kit. Other source families remain missing in older layouts. The Helvetica upload contains 52 files, several with incorrect internal style names; use the controlled face selection rather than loading the entire ZIP. Original frames can still overflow with the correct font. Choose an explicit layout/font-size variant and retain full copy. The test uses a 22pt headline variant for the long recovered CFUR title.

Image `fit` accepts `cover` or `contain`. Cover crops use clamped `focus: {x: 0..1, y: 0..1}` (default centre); automatic fitting is disabled once the transform is frozen. Reopening verifies the transform and unchanged embedded image bytes. `focal-crop.json` records the proof. Logos use containment.

## IDML interchange limitations and checked reopening

Stock DesignCraft v0.4.0 drops URL hyperlink records and parent-item override lists across IDML. Repeating stock round trips can therefore change inherited artwork despite retaining text and asset bytes. The companion writes `interchange-metadata.json` for these omissions. Keep it beside the exported IDML and reopen with:

```sh
python3 /path/to/template-kit/reopen-idml.py \
  --idml output/issue.idml --metadata output/interchange-metadata.json \
  --font-dir /path/to/template-kit/assets/fonts \
  --output reopened --cli /path/to/designcraft-cli
```

Restoration verifies exact story text, UTF-8 ranges, page identity/size and referenced parent objects, refusing changed or ambiguous inputs. The sidecar is consumed by this companion, not Adobe InDesign. Stock IDML also drops compiler object labels; stable issue/article identities remain in the source JSON. Interchange and rendered output still need visual comparison. Adobe InDesign was not available here.

## Repeat the audit

`test-workflow.py` covers content conversion, invalid assignments, stale outputs and native failure behavior. Set `DESIGNCRAFT_CLI` to include native tests. `verify-workflow.py` runs every recipe and three cycles, comparing text, embedded asset hashes, parent overrides, hyperlinks, preflight and rendered pixels. `audit-sources.py` recursively inventories a supplied ZIP, renders every PDF page and cycles every distinct IDML. Audit tools additionally require PyMuPDF; recovery and packaging require ReportLab. Install `requirements-audit.txt` for those tools. Original user files belong in private audit output, outside the toolkit repository.

The configured OTEManager worker supplies native output directly from the planner; see `docs/designcraft-native-service.md` in the repository. Production deployment, a browser/WASM bridge, and Adobe/printer verification remain separate work.

The seven packaged examples share `assets/fonts` to avoid duplicate font binaries. Before opening an example directly in the desktop program, copy that directory beside its `page.designcraft` as `Document Fonts`. Compiler/server output bundles already include the adjacent scope.
