// @vitest-environment node
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, test } from "vitest";
import { MarkdownPreview } from "../app/components/article/MarkdownPreview";

const render = (content: string) =>
  renderToStaticMarkup(createElement(MarkdownPreview, { content }));

test("preview renders headings, emphasis, lists and links", () => {
  const html = render(
    "## Section\n\n**Bold** and *italic* with snake_case_names\n\n- one\n- two\n\n[site](https://example.com)",
  );
  expect(html).toContain(">Section</h2>");
  expect(html).toContain("<strong>Bold</strong>");
  expect(html).toContain("<em>italic</em>");
  expect(html).toContain("snake_case_names");
  expect(html).toMatch(/<ul[^>]*><li[^>]*>one<\/li><li[^>]*>two<\/li><\/ul>/);
  expect(html).toContain('href="https://example.com"');
});

test("preview never injects HTML or unsafe links from article text", () => {
  const html = render('<img src=x onerror="alert(1)"> [x](javascript:alert(1))');
  expect(html).not.toContain("<img");
  expect(html).toContain("&lt;img");
  expect(html).not.toContain("javascript:");
});
