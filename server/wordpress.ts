/**
 * Sends approved articles to WordPress as drafts through the OTE Publisher
 * plugin (extensions/wordpress-ote-publisher). Server-only: credentials come
 * from the web server environment and never reach the browser or Convex.
 *
 * Only publishable fields leave OTEManager: title, content, byline, role,
 * volume/issue and photos with captions. Emails, payment details and notes
 * are never sent.
 */
import { createHash } from "node:crypto";
import MarkdownIt from "markdown-it";
import { hasPassedApproval } from "../shared/model";
import { stripBookmarkAnchors, stripLeadingTitle } from "../shared/docx-markdown";
import { articleDisplayAuthor } from "../app/lib/source-archive-display";

export const PLUGIN_NAMESPACE = "ote/v1";
const MAX_MEDIA_BYTES = 25 * 1024 * 1024;
const PUBLISHABLE_ATTACHMENTS = new Set(["photo", "graphic"]);

export interface WordPressConfig {
  siteUrl: string;
  username: string;
  appPassword: string;
  defaultCategory: string | null;
}

/** Reads WORDPRESS_* settings. Returns null when publishing is not set up. */
export function wordpressConfig(
  env: Record<string, string | undefined> = process.env,
): WordPressConfig | null {
  const siteUrl = (env.WORDPRESS_SITE_URL || "").trim().replace(/\/+$/, "");
  const username = (env.WORDPRESS_USERNAME || "").trim();
  // Application passwords are shown with spaces; WordPress accepts either form.
  const appPassword = (env.WORDPRESS_APP_PASSWORD || "").replace(/\s+/g, "");
  if (!siteUrl && !username && !appPassword) return null;
  if (!siteUrl || !username || !appPassword)
    throw new Error(
      "WordPress publishing is partly configured. Set WORDPRESS_SITE_URL, WORDPRESS_USERNAME and WORDPRESS_APP_PASSWORD together.",
    );
  let url: URL;
  try {
    url = new URL(siteUrl);
  } catch {
    throw new Error("WORDPRESS_SITE_URL is not a valid URL.");
  }
  const local = ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
  if (url.protocol !== "https:" && !(local && url.protocol === "http:"))
    throw new Error(
      "WORDPRESS_SITE_URL must use HTTPS so the application password is not sent in clear text.",
    );
  return {
    siteUrl,
    username,
    appPassword,
    defaultCategory: (env.WORDPRESS_DEFAULT_CATEGORY || "").trim() || null,
  };
}

// --- Payload -----------------------------------------------------------------

export interface PublishableAttachment {
  id: string;
  attachmentType: string;
  fileName: string;
  originalFileName: string | null;
  filePath: string;
  fileSize: number | null;
  mimeType: string | null;
  caption: string | null;
  photoNumber: number | null;
  includeInExport?: boolean | null;
}

export interface PublishableArticle {
  id: string;
  title: string;
  content: string | null;
  internalStatus: string | null;
  prefersAnonymity: boolean;
  sourceProvenance?: string | null;
  volume?: number | null;
  issue?: number | null;
  author?: { givenName: string; surname: string; role: string | null } | null;
  attachments: PublishableAttachment[];
  publicationIssue?: {
    issueNumber: number;
    title: string | null;
    volume: { volumeNumber: number };
  } | null;
}

export interface MediaRef {
  attachmentId: string;
  mediaId: number;
  caption: string;
}

export interface ArticlePayload {
  external_id: string;
  title: string;
  content: string;
  status: "draft";
  byline: string;
  anonymous: boolean;
  contributor_role: string | null;
  volume: number | null;
  issue: number | null;
  issue_title: string | null;
  categories: string[];
  featured_media: number | null;
  gallery: { id: number; caption: string }[];
  fingerprint: string;
}

const markdown = new MarkdownIt({ html: false, linkify: true, breaks: false });

export function articleHtml(article: Pick<PublishableArticle, "content" | "title">) {
  const body = stripLeadingTitle(stripBookmarkAnchors(article.content || ""), article.title);
  return markdown.render(body).trim();
}

/** Photos and graphics selected for export, in their photo order. */
export function publishableAttachments(article: PublishableArticle) {
  return article.attachments
    .filter((a) => PUBLISHABLE_ATTACHMENTS.has(a.attachmentType) && a.includeInExport !== false)
    .sort((a, b) => (a.photoNumber ?? 1e9) - (b.photoNumber ?? 1e9) || a.fileName.localeCompare(b.fileName));
}

export function articleByline(article: PublishableArticle) {
  if (article.prefersAnonymity) return { byline: "Anonymous", anonymous: true, role: null };
  return {
    byline: articleDisplayAuthor(article as any),
    anonymous: false,
    role: article.author?.role || null,
  };
}

export function buildArticlePayload(
  article: PublishableArticle,
  media: MediaRef[],
  config: Pick<WordPressConfig, "defaultCategory">,
): ArticlePayload {
  const { byline, anonymous, role } = articleByline(article);
  const issue = article.publicationIssue;
  const payload: Omit<ArticlePayload, "fingerprint"> = {
    external_id: article.id,
    title: article.title.trim(),
    content: articleHtml(article),
    status: "draft",
    byline,
    anonymous,
    contributor_role: role,
    volume: issue?.volume.volumeNumber ?? article.volume ?? null,
    issue: issue?.issueNumber ?? article.issue ?? null,
    issue_title: issue?.title ?? null,
    categories: config.defaultCategory ? [config.defaultCategory] : [],
    featured_media: media[0]?.mediaId ?? null,
    gallery: media.map((m) => ({ id: m.mediaId, caption: m.caption })),
  };
  return { ...payload, fingerprint: fingerprint(payload) };
}

export function fingerprint(value: unknown) {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

// --- Client ------------------------------------------------------------------

export class WordPressError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code: string | null = null,
    readonly data: any = null,
  ) {
    super(message);
  }
}

type Fetch = typeof fetch;

export interface ImportResult {
  success: boolean;
  action: "created" | "updated" | "unchanged" | "skipped";
  reason?: string;
  post_id: number;
  status: string;
  edit_url: string | null;
  preview_url: string | null;
  permalink: string | null;
  warnings: string[];
}

export interface PublisherStatus {
  plugin_version: string;
  user: { id: number; name: string; roles: string[] };
  can_create_drafts: boolean;
  can_upload_media: boolean;
  can_publish: boolean;
}

export class WordPressClient {
  constructor(
    readonly config: WordPressConfig,
    private readonly fetchImpl: Fetch = fetch,
  ) {}

  private headers(extra: Record<string, string> = {}) {
    const token = Buffer.from(`${this.config.username}:${this.config.appPassword}`).toString("base64");
    return { Authorization: `Basic ${token}`, Accept: "application/json", ...extra };
  }

  private async request<T>(path: string, init: RequestInit): Promise<T> {
    let response: Response;
    try {
      response = await this.fetchImpl(`${this.config.siteUrl}/wp-json/${path}`, {
        ...init,
        redirect: "error",
        signal: AbortSignal.timeout(60_000),
      });
    } catch (error) {
      throw new WordPressError(
        `Could not reach WordPress at ${this.config.siteUrl}: ${error instanceof Error ? error.message : "network error"}`,
        0,
        "network",
      );
    }
    const text = await response.text();
    let body: any = null;
    try {
      body = text ? JSON.parse(text) : null;
    } catch {
      body = null;
    }
    if (response.ok && body !== null) return body as T;
    throw explainError(response.status, body, path);
  }

  status() {
    return this.request<PublisherStatus>(`${PLUGIN_NAMESPACE}/status`, {
      method: "GET",
      headers: this.headers(),
    });
  }

  async uploadMedia(file: Buffer, fileName: string, mimeType: string) {
    const safeName = fileName.replace(/[^\w.\- ]+/g, "_").replace(/"/g, "") || "photo";
    const media = await this.request<{ id: number }>("wp/v2/media", {
      method: "POST",
      headers: this.headers({
        "Content-Type": mimeType,
        "Content-Disposition": `attachment; filename="${safeName}"`,
      }),
      body: new Uint8Array(file),
    });
    if (!Number.isSafeInteger(media?.id)) throw new WordPressError("WordPress did not return a media ID.", 502);
    return media.id;
  }

  importArticle(payload: ArticlePayload) {
    return this.request<ImportResult>(`${PLUGIN_NAMESPACE}/import-article`, {
      method: "POST",
      headers: this.headers({ "Content-Type": "application/json" }),
      body: JSON.stringify({ article: payload }),
    });
  }
}

function explainError(status: number, body: any, path: string) {
  const code = typeof body?.code === "string" ? body.code : null;
  const remote = typeof body?.message === "string" ? body.message : "";
  if (status === 401)
    return new WordPressError("WordPress rejected the username or application password.", status, code);
  if (status === 403)
    return new WordPressError(
      remote || "The WordPress account does not have permission for this. Give it the OTE Publisher role.",
      status,
      code,
    );
  if (status === 404 && (code === "rest_no_route" || !body) && path.startsWith(PLUGIN_NAMESPACE))
    return new WordPressError(
      "The OTE Publisher plugin is not active on this WordPress site.",
      status,
      code,
    );
  return new WordPressError(
    remote || `WordPress returned HTTP ${status}.`,
    status,
    code,
    body?.data ?? null,
  );
}

// --- Sending -----------------------------------------------------------------

type MediaMap = Record<string, { mediaId: number; filePath: string; fileSize: number | null }>;

export interface SendDeps {
  client: WordPressClient;
  getFile: (filePath: string) => Promise<Buffer | null>;
  record: (data: Record<string, unknown>) => Promise<unknown>;
}

export interface SendResult {
  articleId: string;
  title: string;
  outcome: "created" | "updated" | "unchanged" | "skipped" | "failed";
  message: string | null;
  warnings: string[];
  postId: number | null;
  editUrl: string | null;
}

export interface ArticleWithPublications extends PublishableArticle {
  publications?: {
    siteUrl: string;
    mediaMap: string | null;
    remotePostId: number | null;
  }[];
}

function parseMediaMap(value: string | null | undefined): MediaMap {
  try {
    const parsed = value ? JSON.parse(value) : {};
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

/** Sends one article and records the outcome. Never throws for WordPress errors. */
export async function sendArticle(article: ArticleWithPublications, deps: SendDeps): Promise<SendResult> {
  const base = { articleId: article.id, title: article.title, warnings: [] as string[], postId: null, editUrl: null };
  if (!hasPassedApproval(article.internalStatus))
    return { ...base, outcome: "skipped", message: `Not approved yet (status: ${article.internalStatus || "none"}).` };

  const { siteUrl } = deps.client.config;
  const previous = article.publications?.find((p) => p.siteUrl === siteUrl);
  const mediaMap = parseMediaMap(previous?.mediaMap);
  const warnings: string[] = [];

  const uploadAll = async (forceIds: Set<string> = new Set()) => {
    const refs: MediaRef[] = [];
    for (const attachment of publishableAttachments(article)) {
      const known = mediaMap[attachment.id];
      const caption = (attachment.caption || "").trim();
      if (known && !forceIds.has(attachment.id) && known.filePath === attachment.filePath && known.fileSize === attachment.fileSize) {
        refs.push({ attachmentId: attachment.id, mediaId: known.mediaId, caption });
        continue;
      }
      const name = attachment.originalFileName || attachment.fileName;
      try {
        if ((attachment.fileSize ?? 0) > MAX_MEDIA_BYTES) throw new Error("it is larger than 25 MB");
        const file = await deps.getFile(attachment.filePath);
        if (!file) throw new Error("the stored file is missing");
        const mediaId = await deps.client.uploadMedia(file, name, attachment.mimeType || "application/octet-stream");
        mediaMap[attachment.id] = { mediaId, filePath: attachment.filePath, fileSize: attachment.fileSize };
        refs.push({ attachmentId: attachment.id, mediaId, caption });
      } catch (error) {
        delete mediaMap[attachment.id];
        warnings.push(`Photo "${name}" was not uploaded: ${error instanceof Error ? error.message : "upload failed"}.`);
      }
    }
    return refs;
  };

  try {
    let media = await uploadAll();
    let payload = buildArticlePayload(article, media, deps.client.config);
    let result: ImportResult;
    try {
      result = await deps.client.importArticle(payload);
    } catch (error) {
      // Media deleted in WordPress since the last send: upload it again once.
      const missing: number[] = error instanceof WordPressError && error.code === "ote_missing_media" ? error.data?.missing ?? [] : [];
      if (!missing.length) throw error;
      const stale = new Set(media.filter((m) => missing.includes(m.mediaId)).map((m) => m.attachmentId));
      media = await uploadAll(stale);
      payload = buildArticlePayload(article, media, deps.client.config);
      result = await deps.client.importArticle(payload);
    }
    const allWarnings = [...warnings, ...(result.warnings || [])];
    await deps.record({
      articleId: article.id,
      siteUrl,
      remotePostId: result.post_id,
      remoteUrl: result.permalink,
      remoteEditUrl: result.edit_url,
      remoteStatus: result.status,
      contentFingerprint: result.action === "skipped" ? null : payload.fingerprint,
      mediaMap,
      lastAction: result.action,
      lastResult: allWarnings.length ? "warning" : "success",
      warnings: allWarnings,
    });
    return {
      ...base,
      outcome: result.action,
      message: result.reason || null,
      warnings: allWarnings,
      postId: result.post_id,
      editUrl: result.edit_url,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Sending failed.";
    await deps
      .record({ articleId: article.id, siteUrl, mediaMap, lastAction: "failed", lastResult: "failed", lastError: message, warnings })
      .catch(() => undefined);
    return { ...base, outcome: "failed", message, warnings, postId: previous?.remotePostId ?? null };
  }
}

export function summarize(results: SendResult[]) {
  const count = (o: SendResult["outcome"]) => results.filter((r) => r.outcome === o).length;
  return {
    created: count("created"),
    updated: count("updated"),
    unchanged: count("unchanged"),
    skipped: count("skipped"),
    failed: count("failed"),
    warned: results.filter((r) => r.warnings.length).length,
  };
}
