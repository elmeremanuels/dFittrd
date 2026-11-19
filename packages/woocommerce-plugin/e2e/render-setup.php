<?php
/**
 * Renders the settings page's "Get set up" box OUTSIDE WordPress (tests/shims.php) for screenshots:
 * `php e2e/render-setup.php <state>` with state new | connected | chart | measured | button | done.
 *
 * @package Curtain\E2E
 */

declare(strict_types=1);

require dirname( __DIR__ ) . '/tests/shims.php';
require dirname( __DIR__ ) . '/includes/autoload.php';
require dirname( __DIR__ ) . '/tests/setup-shims.php';

curtain_setup_state( $argv[1] ?? 'new' );
\Curtain\Setup::render_box();
