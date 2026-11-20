<?php
/**
 * Shims the "Get set up" box needs on top of tests/shims.php (guarded: shared by tests/setup.test.php and
 * e2e/render-setup.php).
 *
 * @package Curtain\Tests
 */

declare(strict_types=1);

if ( ! function_exists( 'get_posts' ) ) {
	/** Published products from Curtain_Test_State::$posts, ids only (what Setup::facts asks for). */
	function get_posts( array $args = array() ): array {
		$ids = array();
		foreach ( Curtain_Test_State::$posts as $id => $p ) {
			if ( ( $p['type'] ?? '' ) === ( $args['post_type'] ?? 'post' ) && ( $p['status'] ?? '' ) === ( $args['post_status'] ?? 'publish' ) ) {
				$ids[] = (int) $id;
			}
		}
		sort( $ids );
		return array_slice( $ids, 0, (int) ( $args['posts_per_page'] ?? 10 ) );
	}
}
if ( ! function_exists( 'get_edit_post_link' ) ) {
	function get_edit_post_link( int $id, string $context = 'display' ): string { return 'https://shop.example/wp-admin/post.php?post=' . $id . '&action=edit'; }
}
if ( ! function_exists( 'wp_nonce_field' ) ) {
	function wp_nonce_field( $action, $name = '_wpnonce' ): void { echo '<input type="hidden" name="' . esc_attr( (string) $name ) . '" value="x">'; }
}

/** Puts the shop in one of the walk's states: new, connected, chart, measured, done. */
function curtain_setup_state( string $state ): void {
	Curtain_Test_State::reset();
	$order = array( 'new', 'connected', 'chart', 'measured', 'button', 'done' );
	$at    = array_search( $state, $order, true );
	$at    = false === $at ? 0 : $at;
	foreach ( array( 4511 => 'Crimson Wildflower Maxi Skirt', 4512 => 'Sunset Paisley Wrap Maxi Dress', 4513 => 'Rust Crochet Kimono' ) as $id => $name ) {
		Curtain_Test_State::$posts[ $id ] = array( 'type' => 'product', 'status' => 'publish', 'title' => $name );
	}
	if ( $at >= 1 ) {
		\Curtain\Settings::update( array( 'api_key' => 'sk_' . 'test_abcdefghijklmnopqrstuvwxyz0123', 'public_key_prefix' => 'pk_' . 'test_setup000001', 'button_enabled' => $at >= 4 ) );
	} else {
		\Curtain\Settings::update( array( 'button_enabled' => false ) );
	}
	if ( $at >= 2 ) {
		update_post_meta( 4511, '_curtain_size_chart', '[{"size":"8","bust":85,"waist":67.5,"hip":94}]' );
		update_post_meta( 4512, '_curtain_size_chart', '[{"size":"8","bust":85,"waist":67.5,"hip":94}]' );
	}
	if ( $at >= 3 ) {
		update_post_meta( 4511, '_curtain_garment_tape', '[{"size":"8","waistRelaxed":{"cm":67,"provenance":"measured"}}]' );
	}
	if ( $at >= 5 ) {
		\Curtain\Settings::update( array( 'setup_phone_confirmed' => true ) );
	}
}
