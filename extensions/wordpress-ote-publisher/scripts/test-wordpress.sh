#!/usr/bin/env bash
# Disposable WordPress + MariaDB for the OTE Publisher plugin and OTEManager's
# sender. Never touches a configured site. Run from the OTEManager root:
#   bash extensions/wordpress-ote-publisher/scripts/test-wordpress.sh
# Set WP_CLI_PHAR to a local wp-cli.phar to avoid downloading it in the container.
set -euo pipefail
name="ote-publisher-test-${GITHUB_RUN_ID:-$$}"
port="${WP_TEST_PORT:-8089}"
plugin_dir="$(cd "$(dirname "$0")/.." && pwd)"
cleanup() { docker rm -f "$name-wp" "$name-db" >/dev/null 2>&1 || true; docker network rm "$name" >/dev/null 2>&1 || true; }
trap cleanup EXIT
docker network create "$name" >/dev/null
docker run -d --name "$name-db" --network "$name" -e MARIADB_ROOT_PASSWORD=test-only -e MARIADB_DATABASE=wordpress mariadb:11.4 >/dev/null
docker run -d --name "$name-wp" --network "$name" -p "127.0.0.1:$port:80" -e WORDPRESS_DB_HOST="$name-db" -e WORDPRESS_DB_USER=root -e WORDPRESS_DB_PASSWORD=test-only -e WORDPRESS_DB_NAME=wordpress wordpress:6.9-php8.4-apache >/dev/null
for attempt in {1..60}; do
  if docker exec "$name-wp" test -f /var/www/html/wp-config.php; then break; fi
  sleep 1
done
if [ -n "${WP_CLI_PHAR:-}" ]; then
  docker cp "$WP_CLI_PHAR" "$name-wp:/tmp/wp"
else
  docker exec "$name-wp" sh -c 'curl -fsSL https://raw.githubusercontent.com/wp-cli/builds/gh-pages/phar/wp-cli.phar -o /tmp/wp'
fi
wp() { docker exec "$name-wp" php /tmp/wp "$@" --allow-root; }
for attempt in {1..60}; do
  if docker exec "$name-wp" php -r 'exit(@mysqli_connect(getenv("WORDPRESS_DB_HOST"), "root", "test-only", "wordpress") ? 0 : 1);'; then break; fi
  sleep 1
done
wp core install --url="http://localhost:$port" --title=Test --admin_user=testadmin --admin_password=test-only --admin_email=test@example.test --skip-email
# Application passwords over plain HTTP are only allowed for local environments.
wp config set WP_ENVIRONMENT_TYPE local
wp rewrite structure '/%postname%/'
docker cp "$plugin_dir/." "$name-wp:/var/www/html/wp-content/plugins/ote-publisher"
docker exec "$name-wp" chown -R www-data:www-data /var/www/html/wp-content
wp plugin activate ote-publisher
wp eval-file wp-content/plugins/ote-publisher/tests/wordpress-integration.php

wp user create ote-e2e ote-e2e@example.test --role=ote_publisher --user_pass="$(head -c 24 /dev/urandom | base64)" >/dev/null
password="$(wp user application-password create ote-e2e otemanager-e2e --porcelain)"
WP_E2E_URL="http://localhost:$port" WP_E2E_USER=ote-e2e WP_E2E_PASSWORD="$password" \
  WP_E2E_CLI="docker exec $name-wp php /tmp/wp" \
  node --import tsx scripts/wordpress-e2e.ts
