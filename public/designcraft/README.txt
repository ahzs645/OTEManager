OTE DesignCraft review and corrected template toolkit

The supplied Drive archive contains reusable layout shells, source revisions,
PDF/IDML files and artwork. The website archive contains the finished published
issues. Those are different content sources; blank template pages do not contain
all published articles. The earlier ote-layout-study prototype was not recovered.

Serve this folder over HTTP (python3 -m http.server 8000) to use the planner.
In Publications, choose DesignCraft ZIP and select articles/images. Import the
downloaded ZIP here, choose layouts, assign articles, and reserve
custom pieces. Download a single-page recipe or save consecutive pages and
export a whole-issue recipe. Original text/media and stable page IDs are retained.
Native fitting runs locally with Python, the requirements.txt dependency, and
the checksum-verified official DesignCraft v0.4.0 CLI. See native-readme.md.

The kit includes 104 reconstructed recipes, schematic catalogue, seven native
examples, page/issue compilers, checked IDML reopening, regression/audit tools,
and licensed Source Sans 3, Source Serif 4 and JetBrains Mono fonts.
Whole-issue composition derives cover references from actual pages. Preservation
uses a same-length native base, protects both halves of continuous spreads, and
compares original objects/stories after saving. PDF alone cannot preserve
editable layout objects. Every article needs one interior assignment.

Full article Markdown is preserved as source; supported CommonMark is composed
into native styled text. bodyFormat=plain keeps literal text. Overset and missing
required photos prevent final PDF/IDML output while keeping a native draft.
Successful PDFs request PDF/X-4. Browser previews do not verify native fitting.

Stock IDML loses URL links and parent override lists. Keep the generated
interchange-metadata.json and use reopen-idml.py for checked companion round
trips. Adobe InDesign does not consume this sidecar and was not tested here.
Salted Regular is bundled in assets/fonts/ with its supplied personal-use-only
notice (LICENSE-Salted.txt), and loads automatically in the web editor. The optional
original2025 profile loads the other selected private fonts through --font-dir. Other source fonts and some graphics
remain missing. Older imported frames still need fitting and visual review.
Configured OTEManager servers provide native export from this planner through
/api/designcraft/native. Static hosting uses the included standalone CLI workflow;
there is no browser/WASM renderer. Production deployment remains outstanding.

Recovered PDFs under originals/ are byte-identical; pdfs/ reading copies may be
optimized. Other private original font files are excluded. Font and JSZip notices
are included. Review native preflight and obtain the printer's requirements
before treating any output as a production issue.

Cover options store date/year, volume/issue, headline/subtitle, caption/credit,
replaceable image and crop focus. Choose up to three featured articles; place
each on one interior page. References update with page order. Unplaced and
duplicate selections block export. Save the front cover as page 1. ZIP import
restores fields and exact image bytes. See native-readme.md for original fonts.

The seven native examples share assets/fonts. Before opening an example directly
in the desktop program, copy that font directory beside page.designcraft as
Document Fonts. Generated compiler and server bundles already carry that scope.

DesignCraft web 0.7.1 is now bundled in OTEManager at editor/index.html.
Use it to open/edit/save/export existing documents in your browser.
Automatic recipe composition/preflight still uses the configured OTE server.
The template kit carries recipes/compilers; web-editor.zip is the separate
standalone browser runtime. No desktop installation is needed for browser editing.
Private original font scopes are not connected to the web handoff.
