<?php
/**
 * Renders the product meta box OUTSIDE WordPress (tests/shims.php) for screenshots of the size
 * chart: `php e2e/render-chart-box.php <state>` saves a meta box POST through Sanitizer → post
 * meta (as Product_Meta::save does) and prints the box. Not a substitute for e2e/run.mjs (real
 * WordPress in Docker): no admin styles, no jQuery behaviour.
 *
 * States: `women-body` (AU 8–16 body chart), `women-garment` (a dress measured flat),
 *         `men-tee` (men's tee with neck, sleeve from the shoulder seam, body length),
 *         `men-tee-error` (the same with no sleeve measuring point: not saved),
 *         `men-chino` (W/L chino chart, 15 sizes with rise and inseam),
 *         `men-chino-error` (a size "33" in the W/L chart: not saved).
 *
 * @package Curtain\E2E
 */

declare(strict_types=1);

require dirname( __DIR__ ) . '/tests/shims.php';
require dirname( __DIR__ ) . '/includes/autoload.php';

if ( ! function_exists( 'wp_nonce_field' ) ) {
	function wp_nonce_field( $action, $name ): void { echo '<input type="hidden" name="' . esc_attr( $name ) . '" value="x">'; }
}
if ( ! function_exists( 'selected' ) ) {
	function selected( $a, $b = true, $echo = true ) { $r = (string) $a === (string) $b ? ' selected="selected"' : ''; if ( $echo ) { echo $r; } return $r; }
}
if ( ! function_exists( 'checked' ) ) {
	function checked( $a, $b = true, $echo = true ) { $r = (string) $a === (string) $b ? ' checked="checked"' : ''; if ( $echo ) { echo $r; } return $r; }
}
if ( ! class_exists( 'WP_Post' ) ) {
	final class WP_Post { public int $ID = 0; }
}

$state = $argv[1] ?? 'women-body';
$id    = 4600;
$in    = array( 'fabric_primary' => 'cotton', 'fabric_stretch_pct' => '2', 'fabric_drape' => '0.4' );
switch ( $state ) {
	case 'women-body':
		$in += array(
			'category'        => 'dress',
			'size_chart_type' => 'body',
			'size_chart'      => array(
				array( 'size' => '8', 'bust' => 85, 'waist' => 67.5, 'hip' => 94 ),
				array( 'size' => '10', 'bust' => 90, 'waist' => 72.5, 'hip' => 99 ),
				array( 'size' => '12', 'bust' => 95, 'waist' => 77.5, 'hip' => 104 ),
				array( 'size' => '14', 'bust' => 100, 'waist' => 82.5, 'hip' => 109 ),
				array( 'size' => '16', 'bust' => 105, 'waist' => 87.5, 'hip' => 114 ),
			),
		);
		break;
	case 'women-garment':
		$in += array(
			'category'        => 'dress',
			'size_chart_type' => 'garment',
			'size_chart'      => array(
				array( 'size' => 'S', 'bust' => 92, 'waist' => 74, 'hip' => 100, 'shoulder' => 37 ),
				array( 'size' => 'M', 'bust' => 96, 'waist' => 78, 'hip' => 104, 'shoulder' => 38 ),
				array( 'size' => 'L', 'bust' => 102, 'waist' => 84, 'hip' => 110, 'shoulder' => 39.5 ),
			),
		);
		break;
	case 'men-tee':
	case 'men-tee-error':
		$rows = array();
		foreach ( array( array( 'S', 98, 43.5, 70, 20, 42 ), array( 'M', 106, 44, 72, 21, 43 ), array( 'L', 114, 45, 74, 22, 44 ), array( 'XL', 122, 46, 76, 23, 45 ), array( 'XXL', 131, 47, 78, 24, 46 ) ) as $r ) {
			$rows[] = array_combine( array( 'size', 'bust', 'shoulder', 'length', 'sleeve', 'neck' ), $r );
		}
		$in += array( 'category' => 'top', 'audience' => 'men', 'size_chart_type' => 'garment', 'size_chart' => $rows, 'sleeve_convention' => 'men-tee' === $state ? 'shoulder_point' : '' );
		break;
	case 'men-chino':
	case 'men-chino-error':
		$rows = array();
		foreach ( array( 30, 32, 34, 36, 38 ) as $wi => $w ) {
			foreach ( array( 30 => 76, 32 => 81, 34 => 86 ) as $l => $inseam ) {
				$rows[] = array( 'size' => $w . '/' . $l, 'waist' => 78.5 + 5 * $wi, 'hip' => 99 + 5 * $wi, 'thigh' => 59.5 + 2.5 * $wi, 'rise' => 26 + 0.5 * $wi, 'inseam' => $inseam );
			}
		}
		if ( 'men-chino-error' === $state ) {
			$rows[] = array( 'size' => '33', 'waist' => 86 );
		}
		$in += array( 'category' => 'bottom', 'audience' => 'men', 'size_chart_type' => 'garment', 'size_axes' => 'wl', 'size_chart' => $rows );
		break;
}

$r = Curtain\Sanitizer::from_post( $in );
foreach ( $r['meta'] as $k => $v ) {
	if ( null === $v ) {
		delete_post_meta( $id, $k );
	} else {
		update_post_meta( $id, $k, wp_slash( $v ) );
	}
}
if ( isset( $r['chart'] ) && null !== $r['chart'] && method_exists( 'Curtain\\Product_Meta', 'store_chart_issues' ) ) {
	Curtain\Product_Meta::store_chart_issues( $id, $r['chart'] );
}

$post     = new WP_Post();
$post->ID = $id;
Curtain\Product_Meta::render( $post );
