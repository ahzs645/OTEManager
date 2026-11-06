<?php
/**
 * Creates or updates a WordPress draft from an OTEManager article.
 *
 * - The OTEManager article ID (ote_article_id) identifies the post, so sending
 *   again updates the same draft instead of creating a duplicate.
 * - Only draft or pending status can be requested. An update keeps the post's
 *   current status, and a post that is already published, scheduled or
 *   private is never changed.
 * - WordPress capabilities are always enforced for the authenticated user.
 */
class OTE_Publisher_Importer {
    const MAX_CONTENT_BYTES = 2097152;
    const MAX_GALLERY = 50;
    const LIVE_STATUSES = array('publish', 'future', 'private');

    public function status() {
        $user = wp_get_current_user();
        return rest_ensure_response(array(
            'plugin_version' => OTE_PUBLISHER_VERSION,
            'user' => array('id' => $user->ID, 'name' => $user->display_name, 'roles' => array_values((array) $user->roles)),
            'can_create_drafts' => current_user_can('edit_posts'),
            'can_upload_media' => current_user_can('upload_files'),
            'can_publish' => current_user_can('publish_posts'),
        ));
    }

    /** Validates the request body. Returns the cleaned article or WP_Error. */
    public static function validate($article) {
        if (!is_array($article)) return self::invalid('The article must be an object.');
        $external_id = (string) ($article['external_id'] ?? '');
        if (!preg_match('/^[A-Za-z0-9_-]{1,64}$/D', $external_id)) return self::invalid('A valid external_id is required.');
        $title = trim(sanitize_text_field((string) ($article['title'] ?? '')));
        if ($title === '' || strlen($title) > 300) return self::invalid('A title of at most 300 characters is required.');
        $content = (string) ($article['content'] ?? '');
        if (strlen($content) > self::MAX_CONTENT_BYTES) return self::invalid('The article content is too large.');
        $status = (string) ($article['status'] ?? 'draft');
        if (!in_array($status, array('draft', 'pending'), true)) return self::invalid('Articles can only be sent as draft or pending.');
        $byline = trim(sanitize_text_field((string) ($article['byline'] ?? '')));
        if (strlen($byline) > 200) return self::invalid('The byline is too long.');

        $int_or_null = function ($value, $name) {
            if ($value === null || $value === '') return null;
            if (!is_numeric($value) || (int) $value != $value || (int) $value < 0) throw new InvalidArgumentException("Invalid $name.");
            return (int) $value;
        };
        try {
            $volume = $int_or_null($article['volume'] ?? null, 'volume');
            $issue = $int_or_null($article['issue'] ?? null, 'issue');
            $featured = $int_or_null($article['featured_media'] ?? null, 'featured_media');
            $gallery = array();
            $items = $article['gallery'] ?? array();
            if (!is_array($items) || count($items) > self::MAX_GALLERY) throw new InvalidArgumentException('Invalid gallery.');
            foreach ($items as $item) {
                if (!is_array($item)) throw new InvalidArgumentException('Invalid gallery item.');
                $id = $int_or_null($item['id'] ?? null, 'gallery media ID');
                if (!$id) throw new InvalidArgumentException('Invalid gallery media ID.');
                $gallery[] = array('id' => $id, 'caption' => sanitize_textarea_field(substr((string) ($item['caption'] ?? ''), 0, 1000)));
            }
        } catch (InvalidArgumentException $e) {
            return self::invalid($e->getMessage());
        }
        $categories = $article['categories'] ?? array();
        if (!is_array($categories) || count($categories) > 10) return self::invalid('Invalid categories.');

        return array(
            'external_id' => $external_id,
            'title' => $title,
            'content' => $content,
            'status' => $status,
            'byline' => $byline,
            'anonymous' => !empty($article['anonymous']),
            'contributor_role' => sanitize_text_field((string) ($article['contributor_role'] ?? '')),
            'volume' => $volume,
            'issue' => $issue,
            'issue_title' => sanitize_text_field((string) ($article['issue_title'] ?? '')),
            'categories' => array_values(array_filter(array_map('sanitize_title', array_map('strval', $categories)))),
            'featured_media' => $featured,
            'gallery' => $gallery,
            'fingerprint' => preg_replace('/[^a-f0-9]/', '', strtolower((string) ($article['fingerprint'] ?? ''))),
        );
    }

    public function import($request) {
        $article = self::validate($request->get_param('article'));
        if (is_wp_error($article)) return $article;

        global $wpdb;
        $lock = 'ote-publisher-' . md5($wpdb->prefix . $article['external_id']);
        if ((string) $wpdb->get_var($wpdb->prepare('SELECT GET_LOCK(%s, 15)', $lock)) !== '1') {
            return new WP_Error('ote_busy', 'This article is already being sent. Try again shortly.', array('status' => 409));
        }
        try {
            return $this->import_locked($article);
        } finally {
            $wpdb->query($wpdb->prepare('SELECT RELEASE_LOCK(%s)', $lock));
        }
    }

    public static function find_post($external_id) {
        $ids = get_posts(array(
            'post_type' => 'post',
            'post_status' => array('draft', 'pending', 'publish', 'future', 'private'),
            'meta_key' => 'ote_article_id',
            'meta_value' => $external_id,
            'fields' => 'ids',
            'numberposts' => 1,
            'orderby' => 'ID',
            'order' => 'ASC',
            'suppress_filters' => true,
        ));
        return $ids ? (int) $ids[0] : 0;
    }

    private function import_locked($article) {
        $post_id = self::find_post($article['external_id']);
        $warnings = array();

        if ($post_id) {
            // Checked before permissions: a drafts-only account cannot edit a
            // post once an editor publishes it, and that is the expected case.
            if (in_array(get_post_status($post_id), self::LIVE_STATUSES, true)) {
                return $this->response('skipped', $post_id, array(),
                    'Already published in WordPress, so it was not changed. Edit it in WordPress.');
            }
            if (!current_user_can('edit_post', $post_id)) {
                return new WP_Error('rest_forbidden', 'This account cannot edit the existing WordPress post for this article.', array('status' => 403));
            }
            if ($article['fingerprint'] !== '' && get_post_meta($post_id, 'ote_fingerprint', true) === $article['fingerprint']) {
                return $this->response('unchanged', $post_id, array());
            }
        } elseif (!current_user_can('edit_posts')) {
            return new WP_Error('rest_forbidden', 'This account cannot create posts.', array('status' => 403));
        }

        // Every photo must still exist and be editable by this account.
        $media_ids = array_unique(array_filter(array_merge(array($article['featured_media']), wp_list_pluck($article['gallery'], 'id'))));
        $missing = array();
        foreach ($media_ids as $media_id) {
            $media = get_post($media_id);
            if (!$media || $media->post_type !== 'attachment' || !wp_attachment_is_image($media_id)) {
                $missing[] = $media_id;
            } elseif (!current_user_can('edit_post', $media_id)) {
                return new WP_Error('rest_forbidden', 'This account cannot use one of the photos.', array('status' => 403));
            }
        }
        if ($missing) {
            return new WP_Error('ote_missing_media', 'Some photos no longer exist in WordPress.', array('status' => 400, 'missing' => array_values($missing)));
        }

        $postarr = array(
            'post_type' => 'post',
            'post_title' => $article['title'],
            'post_content' => $this->content($article),
        );
        if ($post_id) {
            $postarr['ID'] = $post_id;
            $action = 'updated';
        } else {
            $postarr['post_status'] = $article['status'];
            $postarr['post_author'] = get_current_user_id();
            $action = 'created';
        }
        $result = $post_id ? wp_update_post(wp_slash($postarr), true) : wp_insert_post(wp_slash($postarr), true);
        if (is_wp_error($result) || !$result) {
            return new WP_Error('ote_save_failed', 'WordPress could not save the post.', array('status' => 500));
        }
        $post_id = (int) $result;

        foreach (array(
            'ote_article_id' => $article['external_id'],
            'ote_byline' => $article['byline'],
            'ote_anonymous' => $article['anonymous'] ? 1 : 0,
            'ote_contributor_role' => $article['anonymous'] ? '' : $article['contributor_role'],
            'ote_volume' => $article['volume'],
            'ote_issue' => $article['issue'],
            'ote_issue_title' => $article['issue_title'],
            'ote_fingerprint' => $article['fingerprint'],
        ) as $key => $value) {
            if ($value === null || $value === '') delete_post_meta($post_id, $key);
            else update_post_meta($post_id, $key, wp_slash($value));
        }

        $contributors = (!$article['anonymous'] && $article['byline'] !== '') ? array($article['byline']) : array();
        $terms = wp_set_object_terms($post_id, $contributors, 'ote_contributor');
        if (is_wp_error($terms)) $warnings[] = 'The contributor could not be assigned.';

        // Categories are only set on a new draft so editors' choices are kept.
        if ($action === 'created' && $article['categories']) {
            $term_ids = array();
            foreach ($article['categories'] as $slug) {
                $term = get_term_by('slug', $slug, 'category');
                if ($term) $term_ids[] = (int) $term->term_id;
                else $warnings[] = sprintf('Category "%s" does not exist in WordPress.', $slug);
            }
            if ($term_ids) wp_set_post_categories($post_id, $term_ids);
        }

        foreach ($article['gallery'] as $item) {
            $attachment = get_post($item['id']);
            $update = array('ID' => $item['id']);
            if ($item['caption'] !== '' && $attachment->post_excerpt !== $item['caption']) $update['post_excerpt'] = $item['caption'];
            if (!$attachment->post_parent) $update['post_parent'] = $post_id;
            if (count($update) > 1) wp_update_post(wp_slash($update));
        }
        if ($article['featured_media'] && (int) get_post_thumbnail_id($post_id) !== $article['featured_media']) {
            if (!set_post_thumbnail($post_id, $article['featured_media'])) $warnings[] = 'The featured photo could not be set.';
        }

        return $this->response($action, $post_id, $warnings);
    }

    /** Article HTML plus any photos after the featured one, as image blocks. */
    private function content($article) {
        $html = wp_kses_post($article['content']);
        foreach ($article['gallery'] as $item) {
            if ($item['id'] === $article['featured_media']) continue;
            $src = wp_get_attachment_image_url($item['id'], 'large');
            if (!$src) continue;
            $caption = $item['caption'] !== '' ? '<figcaption class="wp-element-caption">' . esc_html($item['caption']) . '</figcaption>' : '';
            $html .= "\n\n" . '<!-- wp:image {"id":' . (int) $item['id'] . ',"sizeSlug":"large"} -->'
                . '<figure class="wp-block-image size-large"><img src="' . esc_url($src) . '" alt="" class="wp-image-' . (int) $item['id'] . '"/>' . $caption . '</figure>'
                . '<!-- /wp:image -->';
        }
        return $html;
    }

    private function response($action, $post_id, $warnings, $reason = null) {
        $body = array(
            'success' => true,
            'action' => $action,
            'post_id' => $post_id,
            'status' => get_post_status($post_id),
            'edit_url' => get_edit_post_link($post_id, 'raw') ?: null,
            'preview_url' => get_preview_post_link($post_id) ?: null,
            'permalink' => get_post_status($post_id) === 'publish' ? get_permalink($post_id) : null,
            'warnings' => array_values($warnings),
        );
        if ($reason) $body['reason'] = $reason;
        return rest_ensure_response($body);
    }

    private static function invalid($message) {
        return new WP_Error('ote_invalid_article', $message, array('status' => 400));
    }
}
