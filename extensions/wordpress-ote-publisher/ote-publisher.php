<?php
/**
 * Plugin Name: OTE Publisher
 * Description: Receives approved articles from OTEManager as drafts, with bylines, issue details and photos.
 * Version:     1.0.0
 * Requires at least: 6.3
 * Requires PHP: 7.4
 * Author:      Over the Edge Newspaper Society
 * License:     GPL-2.0-or-later
 * Text Domain: ote-publisher
 */

if (!defined('ABSPATH')) {
    exit;
}

define('OTE_PUBLISHER_VERSION', '1.0.0');

require_once __DIR__ . '/includes/class-ote-publisher-importer.php';

/**
 * Role for the OTEManager integration account: it can create and edit its
 * own drafts and upload photos, but cannot publish or edit published posts.
 */
function ote_publisher_sync_role() {
    $caps = array('read' => true, 'edit_posts' => true, 'upload_files' => true);
    $role = get_role('ote_publisher');
    if (!$role) {
        add_role('ote_publisher', 'OTE Publisher', $caps);
        return;
    }
    foreach ($caps as $cap => $grant) {
        if (!$role->has_cap($cap)) $role->add_cap($cap, $grant);
    }
}
register_activation_hook(__FILE__, 'ote_publisher_sync_role');

add_action('init', function () {
    if (get_option('ote_publisher_version') !== OTE_PUBLISHER_VERSION) {
        ote_publisher_sync_role();
        update_option('ote_publisher_version', OTE_PUBLISHER_VERSION);
    }

    // Contributors get archive pages without needing WordPress accounts.
    register_taxonomy('ote_contributor', array('post'), array(
        'labels' => array(
            'name' => 'Contributors',
            'singular_name' => 'Contributor',
            'search_items' => 'Search contributors',
            'all_items' => 'All contributors',
            'edit_item' => 'Edit contributor',
            'add_new_item' => 'Add contributor',
        ),
        'public' => true,
        'hierarchical' => false,
        'show_in_rest' => true,
        'show_admin_column' => true,
        'rewrite' => array('slug' => 'contributor'),
        'capabilities' => array(
            'manage_terms' => 'manage_categories',
            'edit_terms' => 'manage_categories',
            'delete_terms' => 'manage_categories',
            'assign_terms' => 'edit_posts',
        ),
    ));

    $meta = array(
        'ote_article_id' => 'string', 'ote_byline' => 'string', 'ote_contributor_role' => 'string',
        'ote_issue_title' => 'string', 'ote_fingerprint' => 'string',
        'ote_volume' => 'integer', 'ote_issue' => 'integer', 'ote_anonymous' => 'boolean',
    );
    foreach ($meta as $key => $type) {
        register_post_meta('post', $key, array(
            'type' => $type,
            'single' => true,
            'show_in_rest' => in_array($key, array('ote_byline', 'ote_volume', 'ote_issue', 'ote_issue_title'), true),
            'auth_callback' => function () { return current_user_can('edit_posts'); },
        ));
    }
});

add_action('rest_api_init', function () {
    $importer = new OTE_Publisher_Importer();
    register_rest_route('ote/v1', '/status', array(
        'methods' => WP_REST_Server::READABLE,
        'callback' => array($importer, 'status'),
        'permission_callback' => function () { return is_user_logged_in(); },
    ));
    register_rest_route('ote/v1', '/import-article', array(
        'methods' => WP_REST_Server::CREATABLE,
        'callback' => array($importer, 'import'),
        'permission_callback' => function () {
            return current_user_can('edit_posts') ? true : new WP_Error(
                'rest_forbidden', 'This account cannot create posts. Give it the OTE Publisher role.', array('status' => 403));
        },
        'args' => array('article' => array('required' => true, 'type' => 'object')),
    ));
});

// Show the OTE byline instead of the integration account's name on the site.
add_filter('the_author', function ($name) {
    if (is_admin() || (defined('REST_REQUEST') && REST_REQUEST)) return $name;
    $post = get_post();
    if (!$post || $post->post_type !== 'post') return $name;
    $byline = get_post_meta($post->ID, 'ote_byline', true);
    return $byline !== '' ? $byline : $name;
});

add_filter('author_link', function ($link, $author_id) {
    $post = get_post();
    if (!$post || $post->post_type !== 'post' || get_post_meta($post->ID, 'ote_byline', true) === '') return $link;
    if (get_post_meta($post->ID, 'ote_anonymous', true)) return home_url('/');
    $terms = get_the_terms($post, 'ote_contributor');
    if ($terms && !is_wp_error($terms)) {
        $term_link = get_term_link($terms[0]);
        if (!is_wp_error($term_link)) return $term_link;
    }
    return $link;
}, 10, 2);

// Read-only summary for editors: where the post came from.
add_action('add_meta_boxes_post', function ($post) {
    if (get_post_meta($post->ID, 'ote_article_id', true) === '') return;
    add_meta_box('ote_publisher', 'From OTEManager', function ($post) {
        $row = function ($label, $value) {
            if ($value === '' || $value === null) return;
            echo '<p><strong>' . esc_html($label) . ':</strong> ' . esc_html($value) . '</p>';
        };
        $row('Byline', get_post_meta($post->ID, 'ote_byline', true));
        $row('Role', get_post_meta($post->ID, 'ote_contributor_role', true));
        $volume = get_post_meta($post->ID, 'ote_volume', true);
        $issue = get_post_meta($post->ID, 'ote_issue', true);
        if ($volume || $issue) $row('Issue', trim(($volume ? "Volume $volume" : '') . ($issue ? ", Issue $issue" : ''), ', '));
        $row('Article ID', get_post_meta($post->ID, 'ote_article_id', true));
        echo '<p class="description">Sending the article again from OTEManager updates this draft. Once it is published, OTEManager no longer changes it.</p>';
    }, 'post', 'side');
});
