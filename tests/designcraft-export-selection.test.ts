// @vitest-environment node
import { expect, test, vi } from "vitest";
import JSZip from "jszip";
import { buildDesignCraftIssueZip, IncompleteDesignCraftExport } from "../server/designcraft-export";

const issue = { id: "source-issue", issueNumber: 4, releaseDate: null, title: "Original edition", volume: { volumeNumber: 31, year: 2024 } };
const source = { id: "original-article", title: "Original title", content: null as string | null, prefersAnonymity: null, author: { givenName: "Original", surname: "Reporter" }, attachments: [] };

test("content exports reject absent source text before creating a bundle or reading media", async () => {
  const storage = { getFile: vi.fn(async () => null) };
  for (const content of [null, "", " \n\t "]) await expect(buildDesignCraftIssueZip(issue, [{ ...source, content }], storage)).rejects.toThrow(IncompleteDesignCraftExport);
  await expect(buildDesignCraftIssueZip(issue, [source], storage)).rejects.toThrow(/source pages in Utilities/);
  expect(storage.getFile).not.toHaveBeenCalled();
});

test("recovered text exports preserve the original content and byline", async () => {
  const content = "Original text.\n\n**Source formatting** stays intact.\n";
  const zip = await JSZip.loadAsync(await buildDesignCraftIssueZip(issue, [{ ...source, content }], { getFile: async () => null }));
  const manifest = JSON.parse(await zip.file("issue.json")!.async("string"));
  expect(manifest.articles).toHaveLength(1);
  expect(manifest.articles[0]).toMatchObject({ id: source.id, body: content, author: "Original Reporter" });
  expect(await zip.file(`articles/${source.id}/article.md`)!.async("string")).toBe(content);
});
