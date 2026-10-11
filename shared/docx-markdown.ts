/** Bookmark anchors such as <a id="_yt8jkajz3m65"></a>, which older conversions saved into content. */
export function stripBookmarkAnchors(markdown: string): string {
  return markdown.replace(/<a id="[^"]*"><\/a>/g, "");
}

/**
 * Clean mammoth's Markdown output into what editors expect to see.
 *
 * mammoth escapes most punctuation, emits `<a id>` anchors for every Word or
 * Google Docs bookmark (Google Docs adds one to each heading), writes bold as
 * `__text__`, and keeps bold runs inside headings (`# __Title__`).
 */
export function cleanConvertedMarkdown(markdown: string): string {
  return (
    stripBookmarkAnchors(markdown)
      // Bold as ** so literal underscores (snake_case, __init__) never read as bold.
      // Runs before unescaping, while literal underscores are still escaped as \_.
      .replace(/__(\s*)(.+?)(\s*)__/g, (_, lead, text, trail) =>
        text.trim() ? `${lead}**${text}**${trail}` : `${lead}${text}${trail}`,
      )
      // Drop escapes mammoth adds before punctuation that doesn't need them
      .replace(/\\([._*\[\]()!#`~>+\-])/g, "$1")
      // Headings are already bold: "# **Title**" -> "# Title"
      .replace(/^(#{1,6} +)\*\*(.+)\*\*[ \t]*$/gm, "$1$2")
      // Remove empty image syntax left from skipped images
      .replace(/!\[\]\(\)/g, "")
      .replace(/[ \t]+$/gm, "")
      .replace(/\n{3,}/g, "\n\n")
      .trim()
  );
}

const normalizeTitle = (text: string) =>
  text
    .replace(/[*_#]/g, "")
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/…/g, "...")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();

/** Remove a leading heading or line that repeats the article title. */
export function stripLeadingTitle(markdown: string, title: string): string {
  const match = markdown.match(/^\s*([^\n]*)\n*/);
  if (!match || !title.trim()) return markdown;
  return normalizeTitle(match[1]) === normalizeTitle(title)
    ? markdown.slice(match[0].length)
    : markdown;
}
