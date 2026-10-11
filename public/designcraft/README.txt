OTE DesignCraft review and reconstructed template toolkit

Provenance
----------
The original prototype under ote-layout-study was not recovered. This is a
new reconstruction of its documented layout families and companion workflow.
Original PDFs/IDML and logo artwork were recovered from the supplied Drive ZIP.
documents.json records source paths, duplicate locations and original SHA-256.

Original PDFs are byte-identical under originals/. Reading PDFs under pdfs/
are optimized only where needed for static hosting. Never substitute a reading
copy for a printer-approved original without checking the print requirements.

Use the review
--------------
Serve the review directory over HTTP (python -m http.server 8000), then open
http://localhost:8000/ . Or use Utilities > DesignCraft layouts in OTEManager.
The hosted Site shows all reading PDFs and includes a smaller template kit.
The full ZIP additionally includes byte-identical original PDFs.

Use the native compiler
-----------------------
1. Export an issue's DesignCraft ZIP from OTEManager Publications.
2. Import that ZIP into the browser page planner, choose a layout and stories.
3. Reserve custom pieces, edit shared fields, then download a page recipe ZIP.
4. Extract the recipe and template-kit.zip. Run compile-template.py with the
   recipe templates.json, template ID, issue.json and stock DesignCraft CLI.
5. Inspect preflight.json. Complete article text is retained; overset prevents
   final PDF/IDML export. Native drafts and source records remain reviewable.

See native-readme.md in the toolkit for exact commands. download-cli.py pins
the official v0.4.0 CLI and checks the official archive checksum.

Included
--------
104 reconstructed recipes: 76 story layouts (1/2/3 stories), 14 ad areas,
six custom pieces and eight cover variants. The 104-page catalogue is a
schematic geometry reference. Native examples contain editable .designcraft,
actual PDFs, IDML, source records, scripts and preflight reports.
Source Sans 3 / Source Serif 4 are included under the supplied OFL notices.
JSZip is included under its supplied licence. Original font files are not
redistributed. Original PDF branding remains visible in the recovered archive.

Remaining limits
----------------
Browser previews do not prove text fit. Automatic suggestions use story count,
photo count and body area; native preflight verifies actual font shaping.
Story regions adapt into the largest free rectangle around reserved blocks.
This does not create arbitrary wrapping around multiple disconnected areas.
Cover/truck preservation fields record requests. Recreating native whole-issue
preservation remains outstanding and needs an original editable issue.
Native export from the hosted Site still needs the downloaded local compiler.
Generated IDML has not been verified by opening it in Adobe InDesign.
Original font profiles are not yet connected; Salted's font file was not found.
