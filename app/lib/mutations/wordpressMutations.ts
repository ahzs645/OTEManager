import { createServerFn } from "@tanstack/react-start";

/**
 * WordPress publishing. Everything here runs on the web server; the
 * application password is read from its environment and never returned.
 */
async function publisher() {
  const wp = await import("../../../server/wordpress");
  const config = wp.wordpressConfig();
  if (!config) return { wp, client: null };
  return { wp, client: new wp.WordPressClient(config) };
}

export const getWordPressConnection = createServerFn({ method: "GET" }).handler(
  async () => {
    try {
      const { client } = await publisher();
      if (!client)
        return {
          configured: false as const,
          connected: false,
          siteUrl: null,
          message:
            "WordPress publishing is not set up. Set WORDPRESS_SITE_URL, WORDPRESS_USERNAME and WORDPRESS_APP_PASSWORD on the web server.",
        };
      const status = await client.status();
      const problems: string[] = [];
      if (!status.can_create_drafts) problems.push("cannot create drafts");
      if (!status.can_upload_media) problems.push("cannot upload photos");
      return {
        configured: true as const,
        connected: problems.length === 0,
        siteUrl: client.config.siteUrl,
        user: status.user.name,
        roles: status.user.roles,
        pluginVersion: status.plugin_version,
        canPublish: status.can_publish,
        message: problems.length
          ? `Connected as ${status.user.name}, but the account ${problems.join(" and ")}.`
          : `Connected as ${status.user.name}. Articles are sent as drafts.`,
      };
    } catch (error) {
      return {
        configured: true as const,
        connected: false,
        siteUrl: process.env.WORDPRESS_SITE_URL || null,
        message: error instanceof Error ? error.message : "Unable to reach WordPress.",
      };
    }
  },
);

async function sendMany(articles: any[]) {
  const { wp, client } = await publisher();
  if (!client) throw new Error("WordPress publishing is not set up.");
  const { mutate } = await import("../../../server/convex");
  const { getStorage } = await import("../../../storage");
  const storage = getStorage();
  const deps = {
    client,
    getFile: (path: string) => storage.getFile(path),
    record: (data: Record<string, unknown>) => mutate("recordArticlePublication", data),
  };
  const results = [];
  // One at a time keeps WordPress load and media uploads predictable.
  for (const article of articles) results.push(await wp.sendArticle(article, deps));
  return { results, summary: wp.summarize(results), siteUrl: client.config.siteUrl };
}

export const sendArticlesToWordPress = createServerFn({ method: "POST" })
  .inputValidator((data: { articleIds: string[] }) => {
    if (!Array.isArray(data?.articleIds) || !data.articleIds.length || data.articleIds.length > 200 || data.articleIds.some((id) => typeof id !== "string"))
      throw new Error("Choose between 1 and 200 articles.");
    return { articleIds: [...new Set(data.articleIds)] };
  })
  .handler(async ({ data }) => {
    try {
      const { query } = await import("../../../server/convex");
      const articles = [];
      for (const id of data.articleIds) {
        const { article } = await query("getArticleById", { id });
        if (!article) throw new Error(`Article ${id} was not found.`);
        articles.push(article);
      }
      return { success: true as const, ...(await sendMany(articles)) };
    } catch (error) {
      return { success: false as const, error: error instanceof Error ? error.message : "Sending failed." };
    }
  });

export const sendIssueToWordPress = createServerFn({ method: "POST" })
  .inputValidator((data: { issueId: string }) => {
    if (typeof data?.issueId !== "string" || !data.issueId) throw new Error("Issue ID is required.");
    return data;
  })
  .handler(async ({ data }) => {
    try {
      const { query } = await import("../../../server/convex");
      const { articles } = await query("getIssueArticles", { issueId: data.issueId });
      const { publications } = await query("getArticlePublications", { articleIds: articles.map((a) => a.id) });
      const withPublications = articles
        .map((a) => ({ ...a, publications: publications[a.id] || [] }))
        .sort((a, b) => a.title.localeCompare(b.title));
      return { success: true as const, ...(await sendMany(withPublications)) };
    } catch (error) {
      return { success: false as const, error: error instanceof Error ? error.message : "Sending failed." };
    }
  });
