// Type declaration for mammoth's browser build, which ships without types.
// It exposes the same API surface as the main "mammoth" entry point, plus
// convertToMarkdown which exists at runtime but is missing from mammoth's types.
declare module "mammoth/mammoth.browser" {
  import mammoth = require("mammoth");

  const browserMammoth: typeof mammoth & {
    convertToMarkdown: typeof mammoth.convertToHtml;
  };

  export = browserMammoth;
}
