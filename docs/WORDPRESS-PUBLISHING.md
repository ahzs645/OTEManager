# Sending articles to WordPress

OTEManager can send approved articles straight to the newspaper's WordPress site as **drafts**. Editors then review, lay out and publish them in WordPress. This replaces downloading a WP Export Bundle ZIP and importing it separately; the bundle still works.

It follows the same pattern as EventScrape → Campus Manager: a WordPress application password authenticates a dedicated account, WordPress capabilities decide what that account may do, and the article's OTEManager ID identifies the post so that sending again updates it instead of duplicating it.

## What is sent

| Sent | Never sent |
| --- | --- |
| Title and article text (Markdown rendered to HTML; raw HTML is escaped, and WordPress filters it again) | Author email or e-transfer address |
| Byline (`Anonymous` when the author asked for anonymity, with no role or contributor page) | Payment status, amounts, bank references or receipts |
| Contributor role (e.g. Staff Writer) | Notes, feedback letters, status history |
| Volume and issue number, issue title | Unselected photos (those excluded from export) |
| Photos and graphics selected for export, with captions. The first becomes the featured image and the rest follow the text as image blocks | Word documents |

## Rules

- Only articles that have passed approval (**Approved**, **In Editing**, **Ready for Publication**, **Published**) can be sent. Others are skipped.
- New posts are always created as drafts. The plugin refuses any request for another status.
- Sending again updates the same draft: title, text, byline, issue and photos. Categories chosen by editors are kept.
- Once a post is **published, scheduled or private** in WordPress, OTEManager never changes it. The send reports "Skipped: already published".
- Resending unchanged content is reported as "Already up to date" and changes nothing.
- Photos are uploaded once and reused. A photo deleted in WordPress is uploaded again automatically on the next send. A photo that cannot be uploaded is reported as a warning, and the article is still sent.

## Set up

### 1. WordPress

1. Install the plugin: zip `extensions/wordpress-ote-publisher` and upload it under **Plugins → Add New → Upload**, or copy the folder to `wp-content/plugins/ote-publisher`. Activate **OTE Publisher**.
2. Create a user for OTEManager (for example `otemanager`) with the **OTE Publisher** role. This role can create drafts and upload photos but cannot publish or edit published posts.
3. On that user's profile, create an **application password** named "OTEManager". Copy it once; WordPress will not show it again.

Bylines are shown on the site from the `ote_byline` field, so readers see the writer's name rather than the integration account's. Contributors have archive pages at `/contributor/<name>/`.

### 2. OTEManager

Set these on the **web server** (not in a `VITE_` variable, and not in Convex):

```sh
WORDPRESS_SITE_URL=https://your-wordpress-site.example
WORDPRESS_USERNAME=otemanager
WORDPRESS_APP_PASSWORD="xxxx xxxx xxxx xxxx xxxx xxxx"
# optional, an existing category slug for new drafts
WORDPRESS_DEFAULT_CATEGORY=news
```

Restart the app, then open **Settings → WordPress publishing → Test WordPress connection**. It checks that the plugin is active and that the account can create drafts and upload photos. It warns if the account can also publish.

The application password stays on the web server. The browser only sees the outcome of each send, and Convex only stores the remote post ID, status, photo IDs and warnings (table `articlePublications`, included in backups).

## Use

- **One article:** on the article page, use **WordPress → Send to WordPress** (or **Send update**). Save unsaved edits first; the saved version is sent.
- **A whole issue:** on **Publications**, use **WordPress** on the issue row. The dialog sends every approved article in the issue and lists each result (created, updated, unchanged, skipped, failed) with warnings.

## Results

| Result | Meaning |
| --- | --- |
| Draft created / Draft updated | Saved in WordPress as a draft. Open it with the link. |
| Already up to date | Nothing changed since the last send. |
| Skipped | Not approved yet, or already published in WordPress. |
| Failed | Nothing was changed. The message says why, for example a wrong application password (HTTP 401), missing permission (HTTP 403), or the plugin not being active. |

## Tests

```sh
npx vitest run tests/wordpress-publishing.test.ts
bash extensions/wordpress-ote-publisher/scripts/test-wordpress.sh
```

The second command starts a disposable WordPress and MariaDB in Docker, runs the plugin's WordPress integration checks, then runs `scripts/wordpress-e2e.ts`, which sends articles with OTEManager's real client and checks the result in WordPress. It never uses a configured site.
