/**
 * End-to-end check of OTEManager's WordPress sender against a disposable
 * WordPress with the OTE Publisher plugin. Started by
 * extensions/wordpress-ote-publisher/scripts/test-wordpress.sh; never point it
 * at a real site (it creates and edits posts).
 *
 *   WP_E2E_URL=http://localhost:8089 WP_E2E_USER=... WP_E2E_PASSWORD=... \
 *   node --import tsx scripts/wordpress-e2e.ts
 */
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import sharp from "sharp";
import {
  WordPressClient,
  sendArticle,
  wordpressConfig,
  type ArticleWithPublications,
} from "../server/wordpress";

const config = wordpressConfig({
  WORDPRESS_SITE_URL: process.env.WP_E2E_URL,
  WORDPRESS_USERNAME: process.env.WP_E2E_USER,
  WORDPRESS_APP_PASSWORD: process.env.WP_E2E_PASSWORD,
});
assert.ok(config, "Set WP_E2E_URL, WP_E2E_USER and WP_E2E_PASSWORD");
const wpCli = (process.env.WP_E2E_CLI || "").split(" ").filter(Boolean);
const wp = (...args: string[]) =>
  execFileSync(wpCli[0], [...wpCli.slice(1), ...args, "--allow-root"], { encoding: "utf8" }).trim();
const pass = (message: string) => console.log(`PASS ${message}`);

const png = await sharp({ create: { width: 8, height: 8, channels: 3, background: "#336699" } }).png().toBuffer();
const files = new Map([["photos/a.png", png], ["photos/b.png", png]]);
let record: any = null;
const deps = (client: WordPressClient) => ({
  client,
  getFile: async (path: string) => files.get(path) ?? null,
  record: async (data: any) => {
    record = data;
  },
});

const client = new WordPressClient(config);
const status = await client.status();
assert.equal(status.can_create_drafts, true);
assert.equal(status.can_publish, false);
pass("status: drafts-only account");

const bad = new WordPressClient({ ...config, appPassword: "wrongwrongwrongwrongwrong" });
await assert.rejects(bad.status(), /rejected the username or application password/);
pass("wrong application password is explained");

const article: ArticleWithPublications = {
  id: `e2e-${Date.now()}`,
  title: "Campus garden opens",
  content: "Campus garden opens\n\nThe **garden** opened today.\n\n<script>alert(1)</script>",
  internalStatus: "Ready for Publication",
  prefersAnonymity: false,
  author: { givenName: "Sam", surname: "Lee", role: "Staff Writer" },
  attachments: [
    { id: "att-a", attachmentType: "photo", fileName: "a.png", originalFileName: "Garden.png", filePath: "photos/a.png", fileSize: png.length, mimeType: "image/png", caption: "The garden", photoNumber: 1 },
    { id: "att-b", attachmentType: "photo", fileName: "b.png", originalFileName: "Gate.png", filePath: "photos/b.png", fileSize: png.length, mimeType: "image/png", caption: "The gate", photoNumber: 2 },
    { id: "att-doc", attachmentType: "word_document", fileName: "a.docx", originalFileName: null, filePath: "docs/a.docx", fileSize: 1, mimeType: "application/msword", caption: null, photoNumber: null },
  ],
  publicationIssue: { issueNumber: 3, title: null, volume: { volumeNumber: 33 } },
  publications: [],
};

const first = await sendArticle(article, deps(client));
assert.equal(first.outcome, "created", JSON.stringify(first));
assert.equal(record.remoteStatus, "draft");
const postId = first.postId!;
const post = JSON.parse(wp("post", "get", String(postId), "--format=json"));
assert.equal(post.post_status, "draft");
assert.equal(post.post_title, "Campus garden opens");
assert.ok(post.post_content.includes("<strong>garden</strong>"));
assert.ok(!post.post_content.includes("<script>"), "raw HTML from Markdown must be escaped or removed");
assert.ok(!post.post_content.startsWith("<p>Campus garden opens"), "leading title is removed from the body");
assert.equal(wp("post", "meta", "get", String(postId), "ote_byline"), "Sam Lee");
assert.equal(wp("post", "meta", "get", String(postId), "ote_volume"), "33");
const media = JSON.parse(record.mediaMap ? JSON.stringify(record.mediaMap) : "{}");
assert.deepEqual(Object.keys(media).sort(), ["att-a", "att-b"]);
assert.equal(wp("post", "meta", "get", String(postId), "_thumbnail_id"), String(media["att-a"].mediaId));
pass("first send creates a draft with byline, issue, featured photo and gallery");

const publications = () => [{ siteUrl: config.siteUrl, mediaMap: JSON.stringify(record.mediaMap), remotePostId: postId }];
const again = await sendArticle({ ...article, publications: publications() }, deps(client));
assert.equal(again.outcome, "unchanged");
assert.deepEqual(record.mediaMap, media, "photos are not uploaded twice");
pass("resend without changes is unchanged and reuses uploaded photos");

const edited = await sendArticle({ ...article, title: "Campus garden opens today", publications: publications() }, deps(client));
assert.equal(edited.outcome, "updated");
assert.equal(edited.postId, postId);
assert.equal(JSON.parse(wp("post", "get", String(postId), "--format=json")).post_title, "Campus garden opens today");
pass("edited article updates the same draft");

wp("post", "delete", String(media["att-b"].mediaId), "--force");
const reupload = await sendArticle({ ...article, title: "Garden, photo deleted", publications: publications() }, deps(client));
assert.equal(reupload.outcome, "updated", JSON.stringify(reupload));
assert.notEqual(record.mediaMap["att-b"].mediaId, media["att-b"].mediaId);
assert.equal(record.mediaMap["att-a"].mediaId, media["att-a"].mediaId);
pass("a photo deleted in WordPress is uploaded again");

files.delete("photos/b.png");
const warned = await sendArticle({ ...article, title: "Garden, missing file", publications: [] }, deps(client));
assert.equal(warned.outcome, "updated");
assert.ok(warned.warnings.some((w) => w.includes("Gate.png")), JSON.stringify(warned.warnings));
assert.equal(record.lastResult, "warning");
pass("a missing stored photo is a warning, not a failure");

wp("post", "update", String(postId), "--post_status=publish");
const published = await sendArticle({ ...article, title: "Must not apply", publications: publications() }, deps(client));
assert.equal(published.outcome, "skipped");
assert.equal(JSON.parse(wp("post", "get", String(postId), "--format=json")).post_title, "Garden, missing file");
pass("a published post is left unchanged");

const draftOnly = await sendArticle({ ...article, id: `${article.id}-draft`, internalStatus: "Pending Review" }, deps(client));
assert.equal(draftOnly.outcome, "skipped");
assert.match(draftOnly.message || "", /Not approved/);
pass("unapproved articles are not sent");

const anon = await sendArticle({ ...article, id: `${article.id}-anon`, prefersAnonymity: true, attachments: [] }, deps(client));
assert.equal(anon.outcome, "created");
assert.equal(wp("post", "meta", "get", String(anon.postId), "ote_byline"), "Anonymous");
pass("anonymous articles are sent as Anonymous");

console.log("ALL WORDPRESS END-TO-END CHECKS PASSED");
