<?php
/**
 * WP-CLI fixture for the real-WordPress e2e (`wp eval-file`): a global "Size" attribute (pa_size,
 * AU women's labels 8–16) and one published variable dress with a variation per size, built with
 * WooCommerce's own CRUD classes. Prints the product id. Idempotent: an existing product with the
 * same SKU is reused.
 *
 * @package Curtain
 */

defined( 'ABSPATH' ) || exit;

$curtain_e2e_sizes = array( '8', '10', '12', '14', '16' );

if ( ! taxonomy_exists( 'pa_size' ) ) {
	$curtain_e2e_attr = wc_create_attribute(
		array(
			'name'         => 'Size',
			'slug'         => 'size',
			'type'         => 'select',
			'order_by'     => 'menu_order',
			'has_archives' => false,
		)
	);
	if ( is_wp_error( $curtain_e2e_attr ) ) {
		WP_CLI::error( $curtain_e2e_attr->get_error_message() );
	}
	register_taxonomy( 'pa_size', array( 'product' ), array( 'hierarchical' => false ) );
}
foreach ( $curtain_e2e_sizes as $curtain_e2e_size ) {
	if ( ! term_exists( $curtain_e2e_size, 'pa_size' ) ) {
		wp_insert_term( $curtain_e2e_size, 'pa_size', array( 'slug' => 'au-' . $curtain_e2e_size ) );
	}
}

$curtain_e2e_existing = wc_get_product_id_by_sku( 'CURTAIN-E2E-DRESS' );
if ( $curtain_e2e_existing ) {
	WP_CLI::line( (string) $curtain_e2e_existing );
	return;
}

$curtain_e2e_attribute = new WC_Product_Attribute();
$curtain_e2e_attribute->set_id( wc_attribute_taxonomy_id_by_name( 'pa_size' ) );
$curtain_e2e_attribute->set_name( 'pa_size' );
$curtain_e2e_attribute->set_options(
	array_map(
		static fn( $s ) => (int) get_term_by( 'slug', 'au-' . $s, 'pa_size' )->term_id,
		$curtain_e2e_sizes
	)
);
$curtain_e2e_attribute->set_visible( true );
$curtain_e2e_attribute->set_variation( true );

$curtain_e2e_product = new WC_Product_Variable();
$curtain_e2e_product->set_name( 'Linen Wrap Midi Dress' );
$curtain_e2e_product->set_sku( 'CURTAIN-E2E-DRESS' );
$curtain_e2e_product->set_status( 'publish' );
$curtain_e2e_product->set_description( 'A relaxed wrap midi dress in washed linen. Test fixture for the Curtain e2e.' );
$curtain_e2e_product->set_short_description( 'Washed linen wrap dress.' );
$curtain_e2e_product->set_attributes( array( $curtain_e2e_attribute ) );
$curtain_e2e_id = $curtain_e2e_product->save();

foreach ( $curtain_e2e_sizes as $curtain_e2e_i => $curtain_e2e_size ) {
	$curtain_e2e_variation = new WC_Product_Variation();
	$curtain_e2e_variation->set_parent_id( $curtain_e2e_id );
	$curtain_e2e_variation->set_attributes( array( 'pa_size' => 'au-' . $curtain_e2e_size ) );
	$curtain_e2e_variation->set_regular_price( (string) ( 149 + $curtain_e2e_i ) );
	$curtain_e2e_variation->set_sku( 'CURTAIN-E2E-DRESS-' . $curtain_e2e_size );
	$curtain_e2e_variation->set_manage_stock( true );
	$curtain_e2e_variation->set_stock_quantity( 5 + $curtain_e2e_i );
	$curtain_e2e_variation->set_status( 'publish' );
	$curtain_e2e_variation->save();
}
WC_Product_Variable::sync( $curtain_e2e_id );
WP_CLI::line( (string) $curtain_e2e_id );
