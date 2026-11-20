<?php
/**
 * Shims the whole settings page needs on top of tests/shims.php and tests/setup-shims.php (guarded:
 * shared by tests/console-link.test.php and e2e/render-settings.php).
 *
 * @package Curtain\Tests
 */

declare(strict_types=1);

require_once __DIR__ . '/setup-shims.php';

if ( ! function_exists( 'submit_button' ) ) {
	function submit_button( string $text = 'Save Changes' ): void {
		echo '<p class="submit"><input type="submit" name="submit" id="submit" class="button button-primary" value="' . esc_attr( $text ) . '"></p>';
	}
}

/** A connected shop on the production API host, as the settings page meets it. */
function curtain_settings_connected( string $api_base = 'https://api.curtain.fit' ): void {
	curtain_setup_state( 'done' );
	\Curtain\Settings::update(
		array(
			'api_base'  => $api_base,
			'shop_name' => 'Aalter Studio',
			'plan'      => 'curtain',
		)
	);
}

/** The settings page as HTML. */
function curtain_render_settings(): string {
	ob_start();
	\Curtain\Settings::render();
	return (string) ob_get_clean();
}
