<?php
/** Run with: wp eval-file tests/wordpress-integration.php (disposable site only). */
if (!defined('ABSPATH')) throw new RuntimeException('Run inside WordPress.');

function ote_check($condition, $message) {
    if (!$condition) throw new RuntimeException('FAIL ' . $message);
    echo "PASS $message\n";
}
function ote_import($article) {
    $request = new WP_REST_Request('POST', '/ote/v1/import-article');
    $request->set_param('article', $article);
    return rest_do_request($request);
}
function ote_image($owner) {
    $file = wp_tempnam('ote-test.png');
    $image = imagecreatetruecolor(4, 4);
    imagepng($image, $file);
    imagedestroy($image);
    $upload = wp_upload_bits('ote-test-' . wp_generate_uuid4() . '.png', null, file_get_contents($file));
    unlink($file);
    $id = wp_insert_attachment(array('post_mime_type' => 'image/png', 'post_title' => 'fixture', 'post_status' => 'inherit', 'post_author' => $owner), $upload['file']);
    require_once ABSPATH . 'wp-admin/includes/image.php';
    wp_update_attachment_metadata($id, wp_generate_attachment_metadata($id, $upload['file']));
    return $id;
}

$prefix = 'ote-test-' . substr(wp_generate_uuid4(), 0, 8);
$users = array(); $posts = array();
$admin = get_users(array('role' => 'administrator', 'number' => 1))[0]->ID;
try {
    wp_set_current_user($admin);
    $role = get_role('ote_publisher');
    ote_check($role && $role->has_cap('edit_posts') && $role->has_cap('upload_files') && !$role->has_cap('publish_posts') && !$role->has_cap('edit_published_posts'),
        'OTE Publisher role can draft and upload but not publish');

    foreach (array('ote_publisher', 'subscriber', 'editor') as $r) {
        $id = wp_insert_user(array('user_login' => "$prefix-$r", 'user_pass' => wp_generate_password(24), 'role' => $r));
        if (is_wp_error($id)) throw new RuntimeException($id->get_error_message());
        $users[$r] = $id;
    }
    $category = wp_insert_term("$prefix News", 'category', array('slug' => "$prefix-news"));
    $photo = ote_image($users['ote_publisher']); $posts[] = $photo;
    $photo2 = ote_image($users['ote_publisher']); $posts[] = $photo2;
    $foreign_photo = ote_image($admin); $posts[] = $foreign_photo;

    wp_set_current_user($users['ote_publisher']);
    $status = rest_do_request(new WP_REST_Request('GET', '/ote/v1/status'))->get_data();
    ote_check($status['can_create_drafts'] && $status['can_upload_media'] && !$status['can_publish'] && $status['plugin_version'] === OTE_PUBLISHER_VERSION, 'status reports drafting rights without publishing');

    $article = array(
        'external_id' => "$prefix-article", 'title' => 'Bears on campus', 'content' => '<p>Body <script>alert(1)</script></p>',
        'status' => 'draft', 'byline' => 'Jordan Evans', 'anonymous' => false, 'contributor_role' => 'Staff Writer',
        'volume' => 32, 'issue' => 4, 'issue_title' => 'Winter', 'categories' => array("$prefix-news", "$prefix-missing"),
        'featured_media' => $photo, 'gallery' => array(array('id' => $photo, 'caption' => 'A bear'), array('id' => $photo2, 'caption' => 'Second photo')),
        'fingerprint' => str_repeat('a', 64),
    );
    $r = ote_import($article); $data = $r->get_data(); $post_id = $data['post_id'] ?? 0; $posts[] = $post_id;
    ote_check($r->get_status() === 200 && $data['action'] === 'created' && get_post_status($post_id) === 'draft', 'creates a draft');
    $post = get_post($post_id);
    ote_check(strpos($post->post_content, '<script>') === false && strpos($post->post_content, 'Body') !== false, 'content is filtered through kses');
    ote_check(strpos($post->post_content, 'wp-image-' . $photo2) !== false && strpos($post->post_content, 'wp-image-' . $photo . '"') === false && strpos($post->post_content, 'Second photo') !== false,
        'non-featured photos are appended with captions; featured photo is not repeated');
    ote_check((int) get_post_thumbnail_id($post_id) === $photo && get_post($photo)->post_excerpt === 'A bear' && (int) get_post($photo)->post_parent === $post_id, 'featured photo, caption and parent are set');
    ote_check(get_post_meta($post_id, 'ote_byline', true) === 'Jordan Evans' && (int) get_post_meta($post_id, 'ote_volume', true) === 32 && get_post_meta($post_id, 'ote_article_id', true) === "$prefix-article",
        'byline and issue metadata are stored');
    $terms = wp_get_object_terms($post_id, 'ote_contributor', array('fields' => 'names'));
    ote_check($terms === array('Jordan Evans'), 'contributor taxonomy term is assigned');
    ote_check(wp_get_post_categories($post_id) === array((int) $category['term_id']) && count($data['warnings']) === 1 && strpos($data['warnings'][0], 'missing') !== false,
        'known category assigned on create; unknown one reported as a warning');
    $GLOBALS['post'] = $post; setup_postdata($post);
    ote_check(get_the_author() === 'Jordan Evans', 'site shows the OTE byline instead of the integration account');
    wp_reset_postdata();

    $r = ote_import($article);
    ote_check($r->get_data()['action'] === 'unchanged' && $r->get_data()['post_id'] === $post_id, 'resending the same fingerprint is a no-op');

    $article['title'] = 'Bears on campus (updated)'; $article['fingerprint'] = str_repeat('b', 64); $article['categories'] = array();
    $r = ote_import($article);
    ote_check($r->get_data()['action'] === 'updated' && $r->get_data()['post_id'] === $post_id && get_the_title($post_id) === 'Bears on campus (updated)'
        && wp_get_post_categories($post_id) === array((int) $category['term_id']), 'resend updates the same draft and keeps editor categories');

    $bad = $article; $bad['status'] = 'publish';
    ote_check(ote_import($bad)->get_status() === 400, 'publish status cannot be requested');
    $bad = $article; $bad['external_id'] = '../etc';
    ote_check(ote_import($bad)->get_status() === 400, 'malformed external ID is rejected');

    $gone = $article; $gone['external_id'] = "$prefix-gone"; $gone['featured_media'] = 999999999; $gone['gallery'] = array(array('id' => 999999999, 'caption' => ''));
    $r = ote_import($gone);
    ote_check($r->get_status() === 400 && $r->get_data()['code'] === 'ote_missing_media' && $r->get_data()['data']['missing'] === array(999999999), 'missing photos are reported for re-upload');

    $foreign = $article; $foreign['external_id'] = "$prefix-foreign"; $foreign['featured_media'] = $foreign_photo; $foreign['gallery'] = array();
    ote_check(ote_import($foreign)->get_status() === 403, "another user's media cannot be attached");

    $anon = $article; $anon['external_id'] = "$prefix-anon"; $anon['byline'] = 'Anonymous'; $anon['anonymous'] = true; $anon['contributor_role'] = 'Staff Writer'; $anon['gallery'] = array(); $anon['featured_media'] = null;
    $r = ote_import($anon); $anon_id = $r->get_data()['post_id']; $posts[] = $anon_id;
    ote_check(!wp_get_object_terms($anon_id, 'ote_contributor') && get_post_meta($anon_id, 'ote_contributor_role', true) === '' && get_post_meta($anon_id, 'ote_byline', true) === 'Anonymous',
        'anonymous articles get no contributor term or role');

    wp_set_current_user($users['editor']);
    wp_update_post(array('ID' => $post_id, 'post_status' => 'publish', 'post_content' => 'Edited by an editor'));
    wp_set_current_user($users['ote_publisher']);
    $article['fingerprint'] = str_repeat('c', 64); $article['title'] = 'Should not apply';
    $r = ote_import($article);
    ote_check($r->get_status() === 200 && $r->get_data()['action'] === 'skipped' && get_the_title($post_id) === 'Bears on campus (updated)' && get_post($post_id)->post_content === 'Edited by an editor',
        'published posts are never changed');

    wp_set_current_user($users['subscriber']);
    ote_check(ote_import($anon)->get_status() === 403, 'accounts without edit_posts are refused');
    wp_set_current_user(0);
    ote_check(rest_do_request(new WP_REST_Request('GET', '/ote/v1/status'))->get_status() === 401, 'status requires authentication');
    echo "ALL OTE PUBLISHER REGRESSIONS PASSED\n";
} finally {
    wp_set_current_user($admin);
    foreach (array_unique(array_filter($posts)) as $id) wp_delete_post($id, true);
    if (!empty($category['term_id'])) wp_delete_term($category['term_id'], 'category');
    foreach (get_terms(array('taxonomy' => 'ote_contributor', 'hide_empty' => false, 'fields' => 'ids')) as $term) wp_delete_term($term, 'ote_contributor');
    require_once ABSPATH . 'wp-admin/includes/user.php';
    foreach ($users as $id) wp_delete_user($id);
    echo "Fixture cleanup complete\n";
}
