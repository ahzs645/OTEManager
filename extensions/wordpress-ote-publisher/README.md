# OTE Publisher (WordPress plugin)

Receives approved articles from OTEManager as drafts. See [docs/WORDPRESS-PUBLISHING.md](../../docs/WORDPRESS-PUBLISHING.md) for setup and behaviour.

- `POST /wp-json/ote/v1/import-article`: create or update a draft, keyed on the OTEManager article ID. Only `draft` or `pending` can be requested. Published, scheduled and private posts are never changed.
- `GET /wp-json/ote/v1/status`: plugin version and the authenticated account's drafting, upload and publish rights.
- Adds the **OTE Publisher** role (`read`, `edit_posts`, `upload_files`), a public **Contributor** taxonomy (`/contributor/<name>/`), and a read-only "From OTEManager" box on the post editor.

All requests are authenticated WordPress users (application passwords), and WordPress capabilities are always enforced.

Test with `bash extensions/wordpress-ote-publisher/scripts/test-wordpress.sh` from the OTEManager root (needs Docker).
