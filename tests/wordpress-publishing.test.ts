import { convexTest } from "convex-test";
import { beforeEach, describe, expect, test, vi } from "vitest";
import schema from "../convex/schema";
import { api } from "../convex/_generated/api";
import { toWire, fromWire } from "../shared/codec";
import {
  WordPressClient,
  articleHtml,
  buildArticlePayload,
  sendArticle,
  summarize,
  wordpressConfig,
  type ArticleWithPublications,
} from "../server/wordpress";

const config = {
  siteUrl: "https://news.example.test",
  username: "ote-publisher",
  appPassword: "abcd efgh ijkl mnop".replace(/\s/g, ""),
  defaultCategory: null,
};

const article = (overrides: Partial<ArticleWithPublications> = {}): ArticleWithPublications => ({
  id: "11111111-1111-4111-8111-111111111111",
  title: "Bears on campus",
  content: "# Bears on campus\n\nA **bear** was seen.<a id=\"_Toc1\"></a>",
  internalStatus: "Approved",
  prefersAnonymity: false,
  sourceProvenance: null,
  volume: 31,
  issue: 2,
  author: { givenName: "Jordan", surname: "Evans", role: "Staff Writer" },
  attachments: [
    { id: "p2", attachmentType: "photo", fileName: "b.jpg", originalFileName: "Second.jpg", filePath: "x/b.jpg", fileSize: 10, mimeType: "image/jpeg", caption: "Second", photoNumber: 2 },
    { id: "p1", attachmentType: "photo", fileName: "a.jpg", originalFileName: "First.jpg", filePath: "x/a.jpg", fileSize: 10, mimeType: "image/jpeg", caption: " First ", photoNumber: 1 },
    { id: "skip", attachmentType: "photo", fileName: "c.jpg", originalFileName: null, filePath: "x/c.jpg", fileSize: 10, mimeType: "image/jpeg", caption: null, photoNumber: 3, includeInExport: false },
    { id: "doc", attachmentType: "word_document", fileName: "a.docx", originalFileName: null, filePath: "x/a.docx", fileSize: 10, mimeType: "application/msword", caption: null, photoNumber: null },
  ],
  publicationIssue: { issueNumber: 4, title: "Winter", volume: { volumeNumber: 32 } },
  publications: [],
  ...overrides,
});

describe("configuration", () => {
  test("is optional, but all-or-nothing and HTTPS outside localhost", () => {
    expect(wordpressConfig({})).toBeNull();
    expect(() => wordpressConfig({ WORDPRESS_SITE_URL: "https://x.test" })).toThrow(/partly configured/);
    expect(() =>
      wordpressConfig({ WORDPRESS_SITE_URL: "http://news.example.test", WORDPRESS_USERNAME: "u", WORDPRESS_APP_PASSWORD: "p" }),
    ).toThrow(/HTTPS/);
    expect(
      wordpressConfig({ WORDPRESS_SITE_URL: "http://localhost:8089/", WORDPRESS_USERNAME: "u", WORDPRESS_APP_PASSWORD: "ab cd" }),
    ).toMatchObject({ siteUrl: "http://localhost:8089", appPassword: "abcd" });
  });
});

describe("payload", () => {
  test("sends only publishable fields: no emails, payment or notes", () => {
    const withPrivate = article({
      author: { givenName: "Jordan", surname: "Evans", role: "Staff Writer", email: "jordan@unbc.example", etransferEmail: "pay@example" } as any,
      ...({ paymentAmount: 5000, paymentBankReference: "REF", feedbackLetter: "private", notes: [{ content: "secret" }] } as any),
    });
    const json = JSON.stringify(buildArticlePayload(withPrivate, [], config));
    for (const secret of ["jordan@unbc.example", "pay@example", "REF", "private", "secret", "5000"]) expect(json).not.toContain(secret);
  });

  test("uses the linked issue, removes the repeated title and renders Markdown safely", () => {
    const payload = buildArticlePayload(article({ content: "Bears on campus\n\nHello <script>x</script> **bold**" }), [], config);
    expect(payload).toMatchObject({ volume: 32, issue: 4, issue_title: "Winter", status: "draft", byline: "Jordan Evans", contributor_role: "Staff Writer" });
    expect(payload.content).toBe("<p>Hello &lt;script&gt;x&lt;/script&gt; <strong>bold</strong></p>");
    expect(articleHtml(article())).not.toContain("_Toc1");
  });

  test("anonymous articles hide the author and role", () => {
    const payload = buildArticlePayload(article({ prefersAnonymity: true }), [], config);
    expect(payload).toMatchObject({ byline: "Anonymous", anonymous: true, contributor_role: null });
    expect(JSON.stringify(payload)).not.toContain("Jordan");
  });

  test("fingerprint changes with content and is stable otherwise", () => {
    const a = buildArticlePayload(article(), [], config).fingerprint;
    expect(buildArticlePayload(article(), [], config).fingerprint).toBe(a);
    expect(buildArticlePayload(article({ title: "Other" }), [], config).fingerprint).not.toBe(a);
  });
});

function fakeWordPress(handler: (url: string, init: RequestInit) => [number, unknown]) {
  const calls: { url: string; init: RequestInit }[] = [];
  const fetchImpl = (async (url: string, init: RequestInit) => {
    calls.push({ url, init });
    const [status, body] = handler(url, init);
    return new Response(body === undefined ? "" : JSON.stringify(body), { status });
  }) as unknown as typeof fetch;
  return { client: new WordPressClient(config, fetchImpl), calls };
}

describe("sending", () => {
  const ok = { success: true, action: "created", post_id: 7, status: "draft", edit_url: "https://news.example.test/wp-admin/post.php?post=7&action=edit", preview_url: null, permalink: null, warnings: [] };

  test("uploads selected photos in order, uses Basic auth, and records the draft", async () => {
    let media = 100;
    const { client, calls } = fakeWordPress((url) => (url.endsWith("/wp/v2/media") ? [201, { id: ++media }] : [200, ok]));
    const records: any[] = [];
    const result = await sendArticle(article(), { client, getFile: async () => Buffer.from("img"), record: async (d) => void records.push(d) });
    expect(result).toMatchObject({ outcome: "created", postId: 7, warnings: [] });
    expect(calls.map((c) => c.url.replace(config.siteUrl, ""))).toEqual(["/wp-json/wp/v2/media", "/wp-json/wp/v2/media", "/wp-json/ote/v1/import-article"]);
    expect((calls[0].init.headers as any).Authorization).toBe(`Basic ${Buffer.from(`ote-publisher:${config.appPassword}`).toString("base64")}`);
    expect((calls[0].init.headers as any)["Content-Disposition"]).toBe('attachment; filename="First.jpg"');
    const sent = JSON.parse(calls[2].init.body as string).article;
    expect(sent.featured_media).toBe(101);
    expect(sent.gallery).toEqual([{ id: 101, caption: "First" }, { id: 102, caption: "Second" }]);
    expect(records[0]).toMatchObject({ remotePostId: 7, remoteStatus: "draft", lastResult: "success", mediaMap: { p1: { mediaId: 101 }, p2: { mediaId: 102 } } });
  });

  test("unapproved articles are skipped without contacting WordPress", async () => {
    const { client, calls } = fakeWordPress(() => [500, {}]);
    const result = await sendArticle(article({ internalStatus: "In Review" }), { client, getFile: async () => null, record: async () => undefined });
    expect(result.outcome).toBe("skipped");
    expect(calls).toHaveLength(0);
  });

  test("failures are explained and recorded without losing the known post", async () => {
    for (const [status, body, message] of [
      [401, { code: "rest_not_logged_in" }, /application password/],
      [403, { code: "rest_forbidden", message: "This account cannot edit the existing WordPress post for this article." }, /cannot edit the existing/],
      [404, { code: "rest_no_route" }, /plugin is not active/],
    ] as const) {
      const { client } = fakeWordPress((url) => (url.endsWith("/wp/v2/media") ? [201, { id: 1 }] : [status, body]));
      const records: any[] = [];
      const result = await sendArticle(article({ attachments: [], publications: [{ siteUrl: config.siteUrl, mediaMap: null, remotePostId: 9 }] }), {
        client,
        getFile: async () => null,
        record: async (d) => void records.push(d),
      });
      expect(result.outcome).toBe("failed");
      expect(result.message).toMatch(message);
      expect(result.postId).toBe(9);
      expect(records[0]).toMatchObject({ lastResult: "failed" });
      expect(records[0]).not.toHaveProperty("remotePostId");
    }
  });

  test("a missing stored photo becomes a warning and the article is still sent", async () => {
    const { client } = fakeWordPress((url) => (url.endsWith("/wp/v2/media") ? [201, { id: 5 }] : [200, ok]));
    const result = await sendArticle(article(), { client, getFile: async (p) => (p === "x/a.jpg" ? Buffer.from("a") : null), record: async () => undefined });
    expect(result.outcome).toBe("created");
    expect(result.warnings).toEqual(['Photo "Second.jpg" was not uploaded: the stored file is missing.']);
  });

  test("summaries count each outcome", () => {
    const base = { articleId: "a", title: "t", message: null, postId: null, editUrl: null };
    expect(summarize([
      { ...base, outcome: "created", warnings: ["w"] },
      { ...base, outcome: "failed", warnings: [] },
      { ...base, outcome: "skipped", warnings: [] },
    ])).toEqual({ created: 1, updated: 0, unchanged: 0, skipped: 1, failed: 1, warned: 1 });
  });
});

describe("publication records", () => {
  const modules = import.meta.glob("../convex/**/*.{ts,js}");
  const secret = "isolated-test-secret";
  beforeEach(() => vi.stubEnv("CONVEX_SERVER_SECRET", secret));
  const setup = () => {
    const t = convexTest(schema, modules);
    const call = (fn: any, operation: string, data?: any) => fn({ secret, operation, data: toWire(data) }).then(fromWire);
    return {
      write: (operation: string, data?: any) => call((a: any) => t.mutation(api.app.write, a), operation, data),
      read: (operation: string, data?: any) => call((a: any) => t.query(api.app.read, a), operation, data),
    };
  };
  const create = (write: any, title: string) =>
    write("createArticle", { title, authorEmail: "w@example.test", authorGivenName: "W", authorSurname: "R" });

  test("records sends per site, keeps the post on failure, and appears on the article", async () => {
    const { write, read } = setup();
    const { articleId } = await create(write, "One");
    const siteUrl = "https://news.example.test";
    await write("recordArticlePublication", { articleId, siteUrl, remotePostId: 7, remoteStatus: "draft", lastResult: "success", lastAction: "created", mediaMap: { p: { mediaId: 1 } } });
    await write("recordArticlePublication", { articleId, siteUrl, lastResult: "failed", lastError: "down", warnings: ["w"] });
    const [row] = (await read("getArticleById", { id: articleId })).article.publications;
    expect(row).toMatchObject({ remotePostId: 7, remoteStatus: "draft", lastResult: "failed", lastError: "down", warnings: '["w"]' });
    expect(JSON.parse(row.mediaMap)).toEqual({ p: { mediaId: 1 } });
    const { publications } = await read("getArticlePublications", { articleIds: [articleId] });
    expect(publications[articleId]).toHaveLength(1);
    await expect(write("recordArticlePublication", { articleId, siteUrl, lastResult: "bogus" })).rejects.toThrow();
  });

  test("deleting or merging articles carries their publication records", async () => {
    const { write, read } = setup();
    const keep = (await create(write, "Keep")).articleId;
    const drop = (await create(write, "Drop")).articleId;
    const gone = (await create(write, "Gone")).articleId;
    await write("recordArticlePublication", { articleId: keep, siteUrl: "https://a.test", remotePostId: 1, lastResult: "success" });
    await write("recordArticlePublication", { articleId: drop, siteUrl: "https://a.test", remotePostId: 2, lastResult: "success" });
    await write("recordArticlePublication", { articleId: drop, siteUrl: "https://b.test", remotePostId: 3, lastResult: "success" });
    await write("recordArticlePublication", { articleId: gone, siteUrl: "https://a.test", remotePostId: 4, lastResult: "success" });
    await write("mergeArticles", { keepId: keep, deleteIds: [drop] });
    const kept = (await read("getArticleById", { id: keep })).article.publications;
    expect(kept.map((p: any) => [p.siteUrl, p.remotePostId]).sort()).toEqual([["https://a.test", 1], ["https://b.test", 3]]);
    await write("deleteArticle", gone);
    const { publications } = await read("getArticlePublications", { articleIds: [gone] });
    expect(publications[gone]).toEqual([]);
  });
});
