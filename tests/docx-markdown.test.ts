import { expect, test } from "vitest";
import {
  cleanConvertedMarkdown,
  stripLeadingTitle,
} from "../shared/docx-markdown";

// Raw mammoth output for a Google Docs export with a bookmarked, bold heading
const mammothOutput =
  '# <a id="_yt8jkajz3m65"></a>__Bears Don’t Really Hibernate… Or Do They?__\n\n' +
  "__Do you also think bears hibernate all winter?__\n\n" +
  "I did too\\! It uses snake\\_case\\_names and costs $5 \\(roughly\\)\\.\n\n" +
  "Bears enter a state called __torpor__, or *winter dormancy*\\.\n\n" +
  '## <a id="_abc123"></a>__Section Two__\n\n' +
  "__Angry \\+ hungry = HANGRY\\.__\n\n\n\n![]()\n\n";

test("converted Word markdown drops bookmark anchors and bold headings", () => {
  expect(cleanConvertedMarkdown(mammothOutput)).toBe(
    "# Bears Don’t Really Hibernate… Or Do They?\n\n" +
      "**Do you also think bears hibernate all winter?**\n\n" +
      "I did too! It uses snake_case_names and costs $5 (roughly).\n\n" +
      "Bears enter a state called **torpor**, or *winter dormancy*.\n\n" +
      "## Section Two\n\n" +
      "**Angry + hungry = HANGRY.**",
  );
});

test("bold runs with surrounding spaces keep the spaces outside the markers", () => {
  expect(cleanConvertedMarkdown("a__ bold __b")).toBe("a **bold** b");
});

test("a leading heading that repeats the article title is removed", () => {
  const content = cleanConvertedMarkdown(mammothOutput);
  const stripped = stripLeadingTitle(
    content,
    "Bears Don't Really Hibernate... Or Do They?",
  );
  expect(stripped.startsWith("**Do you also think")).toBe(true);
  expect(stripLeadingTitle(content, "A different title")).toBe(content);
  expect(stripLeadingTitle("Bold first line\n\nBody", "")).toBe(
    "Bold first line\n\nBody",
  );
});
