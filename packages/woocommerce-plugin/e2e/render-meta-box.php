<?php
/**
 * Renders the product meta box OUTSIDE WordPress (tests/shims.php) for screenshots of the "Garment
 * measurements" table: `php e2e/render-meta-box.php <state>` prints the box's HTML, after the same
 * Sanitizer → post meta step a save runs. Not a substitute for e2e/run.mjs (real WordPress in Docker):
 * no WordPress admin styles, no list table, no jQuery behaviour.
 *
 * States: `measured` (the pilot skirt's AU 8, 10, 14 ticked, pull-on, no hip depth),
 *         `error` (AU 14's stretched band below its relaxed band, AU 8 with text: nothing saved).
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

$state = $argv[1] ?? 'measured';
$id    = 4512;
$chart = array(
	array( 'size' => '8', 'bust' => 85, 'waist' => 67.5, 'hip' => 94 ),
	array( 'size' => '10', 'bust' => 90, 'waist' => 72.5, 'hip' => 99 ),
	array( 'size' => '12', 'bust' => 95, 'waist' => 77.5, 'hip' => 104 ),
	array( 'size' => '14', 'bust' => 100, 'waist' => 82.5, 'hip' => 109 ),
	array( 'size' => '16', 'bust' => 105, 'waist' => 87.5, 'hip' => 114 ),
);
$row   = static function ( string $size, array $v ): array {
	return array_combine( array( 'waistRelaxed', 'waistStretched', 'hip', 'hemSweep', 'length' ), $v ) + array( 'size' => $size, 'measured' => '1' );
};
$first = array(
	'category'        => 'bottom',
	'size_chart_type' => 'body',
	'size_chart'      => $chart,
	'fabric_primary'  => 'viscose',
	'closure'         => 'pull-on',
	'tape_depth'      => '',
	'tape'            => array(
		$row( '8', array( '67', '94', '112', '230', '103' ) ),
		$row( '10', array( '71', '100', '122', '248', '103' ) ),
		array( 'size' => '12' ),
		$row( '14', array( '80', '110', '126', '260', '104' ) ),
		array( 'size' => '16' ),
	),
);
$save = static function ( array $in ) use ( $id ): void {
	$r = Curtain\Sanitizer::from_post( $in );
	foreach ( $r['meta'] as $k => $v ) {
		if ( null === $v ) {
			delete_post_meta( $id, $k );
		} else {
			update_post_meta( $id, $k, wp_slash( $v ) );
		}
	}
	if ( null !== $r['tape'] ) {
		update_post_meta( $id, Curtain\Garment_Tape::META_ISSUES, wp_slash( (string) wp_json_encode( $r['tape'] ) ) );
	}
};
$save( $first );
if ( 'error' === $state ) {
	$second                    = $first;
	$second['tape_depth']      = '20';
	$second['tape'][3]['waistStretched'] = '78';
	$second['tape'][0]['waistRelaxed']   = 'sixty-seven';
	$save( $second );
}

$post     = new WP_Post();
$post->ID = $id;
Curtain\Product_Meta::render( $post );
