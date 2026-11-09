<?php
/**
 * WP-CLI fixture for the real-WordPress e2e (`wp eval-file`, Twenty Twenty-Five active): what a
 * merchant gets after moving the add-to-cart form into a template part in the Site Editor. Saves a
 * theme-scoped `wp_template_part` holding the form block and a customised `single-product`
 * template that pulls it in, the way the Site Editor stores both. `remove` as the first argument
 * deletes them again. Prints "ok <template id>".
 *
 * @package Curtain
 */

defined( 'ABSPATH' ) || exit;

$curtain_e2e_theme = get_stylesheet();
$curtain_e2e_slug  = 'curtain-e2e-buy';

foreach ( array( 'wp_template_part' => $curtain_e2e_slug, 'wp_template' => 'single-product' ) as $curtain_e2e_type => $curtain_e2e_name ) {
	foreach ( get_posts( array( 'post_type' => $curtain_e2e_type, 'name' => $curtain_e2e_name, 'post_status' => 'any', 'numberposts' => -1 ) ) as $curtain_e2e_old ) {
		wp_delete_post( $curtain_e2e_old->ID, true );
	}
}
if ( 'remove' === ( $args[0] ?? '' ) ) {
	echo 'ok removed';
	return;
}

$curtain_e2e_tpl = get_block_template( $curtain_e2e_theme . '//single-product' );
if ( ! $curtain_e2e_tpl ) {
	$curtain_e2e_tpl = get_block_template( 'woocommerce/woocommerce//single-product' );
}
$curtain_e2e_content = $curtain_e2e_tpl ? (string) $curtain_e2e_tpl->content : '';
if ( '' === $curtain_e2e_content && function_exists( 'WC' ) && file_exists( WC()->plugin_path() . '/templates/templates/single-product.html' ) ) {
	$curtain_e2e_content = (string) file_get_contents( WC()->plugin_path() . '/templates/templates/single-product.html' ); // phpcs:ignore WordPress.WP.AlternativeFunctions
}
if ( ! preg_match( '#<!-- wp:woocommerce/add-to-cart-form(?: \{[^}]*\})? /-->#', $curtain_e2e_content, $curtain_e2e_m ) ) {
	WP_CLI::error( 'no add-to-cart-form block in the single-product template' );
}
$curtain_e2e_ref = '<!-- wp:template-part {"slug":"' . $curtain_e2e_slug . '","theme":"' . $curtain_e2e_theme . '"} /-->';

$curtain_e2e_part = wp_insert_post(
	array(
		'post_type'    => 'wp_template_part',
		'post_name'    => $curtain_e2e_slug,
		'post_title'   => 'Curtain e2e buy box',
		'post_status'  => 'publish',
		'post_content' => $curtain_e2e_m[0],
	),
	true
);
if ( is_wp_error( $curtain_e2e_part ) ) {
	WP_CLI::error( $curtain_e2e_part->get_error_message() );
}
wp_set_object_terms( $curtain_e2e_part, $curtain_e2e_theme, 'wp_theme' );
wp_set_object_terms( $curtain_e2e_part, 'uncategorized', 'wp_template_part_area' );

$curtain_e2e_template = wp_insert_post(
	array(
		'post_type'    => 'wp_template',
		'post_name'    => 'single-product',
		'post_title'   => 'Single Product',
		'post_status'  => 'publish',
		'post_content' => str_replace( $curtain_e2e_m[0], $curtain_e2e_ref, $curtain_e2e_content ),
	),
	true
);
if ( is_wp_error( $curtain_e2e_template ) ) {
	WP_CLI::error( $curtain_e2e_template->get_error_message() );
}
wp_set_object_terms( $curtain_e2e_template, $curtain_e2e_theme, 'wp_theme' );

$curtain_e2e_now = get_block_template( $curtain_e2e_theme . '//single-product' );
if ( ! $curtain_e2e_now || ! str_contains( (string) $curtain_e2e_now->content, $curtain_e2e_ref ) || str_contains( (string) $curtain_e2e_now->content, 'wp:woocommerce/add-to-cart-form' ) ) {
	WP_CLI::error( 'the customised single-product template is not the one WordPress resolves' );
}
echo 'ok ' . esc_html( $curtain_e2e_now->id );
