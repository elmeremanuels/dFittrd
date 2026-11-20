<?php
/**
 * Renders the whole settings page OUTSIDE WordPress (tests/shims.php) for screenshots:
 * `php e2e/render-settings.php [connected|new]`.
 *
 * @package Curtain\E2E
 */

declare(strict_types=1);

require dirname( __DIR__ ) . '/tests/shims.php';
require dirname( __DIR__ ) . '/includes/autoload.php';
require dirname( __DIR__ ) . '/tests/settings-shims.php';

if ( 'new' === ( $argv[1] ?? 'connected' ) ) {
	curtain_setup_state( 'new' );
} else {
	curtain_settings_connected();
}
echo curtain_render_settings(); // phpcs:ignore WordPress.Security.EscapeOutput -- the page's own, already escaped markup.
