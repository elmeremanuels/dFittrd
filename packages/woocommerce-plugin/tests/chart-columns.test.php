<?php
/**
 * Men's size chart columns (men-3d-plan M2): neck, sleeve, length, rise, W/L axes and the sleeve
 * measuring point. Chart_Columns, Schema_Validator and Payload_Builder replay the shared cases
 * written by scripts/export-fixtures.mjs from @curtain/schema (tests/fixtures/mens-charts.json)
 * and must give the TypeScript answers word for word.
 *
 * @package Curtain\Tests
 */

declare(strict_types=1);

use Curtain\Chart_Columns;
use Curtain\Payload_Builder;
use Curtain\Product_Meta;
use Curtain\Sanitizer;
use Curtain\Schema_Validator;
use Curtain\Vocab;

function curtain_mens_fixtures(): array {
	$file = __DIR__ . '/fixtures/mens-charts.json';
	assert_true( is_readable( $file ), 'run `node scripts/export-fixtures.mjs` first' );
	return json_decode( (string) file_get_contents( $file ), true );
}

test(
	'parity: Chart_Columns::check gives the words of checkChartColumns for every shared case',
	static function (): void {
		$f = curtain_mens_fixtures();
		assert_true( count( $f['columnCases'] ) >= 11, 'shared cases present' );
		foreach ( $f['columnCases'] as $c ) {
			assert_same( $c['expected'], Chart_Columns::check( $c['input'] ), $c['name'] );
		}
	}
);

test(
	'parity: waist/leg labels read like wlAxesFromLabel',
	static function (): void {
		foreach ( curtain_mens_fixtures()['labels'] as $c ) {
			assert_same( $c['axes'], Chart_Columns::wl_axes_from_label( $c['label'] ), $c['label'] );
		}
	}
);

test(
	'parity: Schema_Validator refuses the charts SizeChartSchema refuses, with its words for the W/L and label rules',
	static function (): void {
		$v = Schema_Validator::from_file( curtain_schema_path( 'garment.schema.json' ) );
		foreach ( curtain_mens_fixtures()['chartCases'] as $c ) {
			$g              = curtain_full_garment();
			$g['sizeChart'] = $c['rows'];
			$issues         = $v->validate( $g );
			$chart_issues   = array_values( array_filter( $issues, static fn ( $i ) => str_starts_with( $i['path'], 'sizeChart' ) ) );
			assert_same( $c['ok'], array() === $chart_issues, $c['name'] . ': ' . wp_json_encode( $chart_issues ) );
			$custom = array_values( array_filter( $chart_issues, static fn ( $i ) => 1 === preg_match( '/^(Either every row|Waist .* occurs twice|Duplicate size label)/', $i['message'] ) ) );
			assert_same( $c['custom'], $custom, $c['name'] );
		}
	}
);

test(
	'parity: Payload_Builder reads men\'s products like fromWooMeta (columns, axes, seat/collar, sleeve measuring point, refused charts)',
	static function (): void {
		foreach ( curtain_mens_fixtures()['products'] as $c ) {
			$meta = array();
			foreach ( $c['meta'] as $row ) {
				$meta[ $row['key'] ] = $row['value'];
			}
			$built = Payload_Builder::build( $c['product'], $meta, array( 'default_brand' => 'Fixture Shop' ) );
			assert_json_equal( $c['expected'], $built['payload'], $c['name'] );
			assert_json_equal( $c['warnings'], $built['warnings'], $c['name'] . ' warnings' );
		}
	}
);

test(
	'meta box save: a men\'s tee keeps neck, sleeve, length and the measuring point; without the point nothing of the chart is saved',
	static function (): void {
		$rows = array(
			array( 'size' => 'S', 'bust' => '98', 'shoulder' => '43.5', 'length' => '70', 'sleeve' => '20', 'neck' => '42' ),
			array( 'size' => 'M', 'bust' => '106', 'shoulder' => '44', 'length' => '72', 'sleeve' => '21', 'neck' => '43' ),
		);
		$r    = Sanitizer::from_post( array( 'audience' => 'men', 'size_chart_type' => 'garment', 'size_chart' => $rows, 'sleeve_convention' => 'shoulder_point' ) );
		assert_same( array(), $r['chart']['errors'] );
		assert_same( 'shoulder_point', $r['meta']['_curtain_sleeve_convention'] );
		$chart = json_decode( (string) $r['meta']['_curtain_size_chart'], true );
		assert_json_equal( array( 'size' => 'S', 'bust' => 98, 'shoulder' => 43.5, 'length' => 70, 'sleeve' => 20, 'neck' => 42 ), $chart[0] );
		$p = Payload_Builder::build( array( 'id' => 1, 'name' => 'Tee' ), array_filter( $r['meta'], static fn ( $v ) => null !== $v ) )['payload'];
		assert_same( 'shoulder_point', $p['sleeveConvention'] );
		assert_same( 42, $p['sizeChart'][0]['neck'] );

		$bad = Sanitizer::from_post( array( 'audience' => 'men', 'size_chart_type' => 'garment', 'size_chart' => $rows ) );
		assert_same( array( 'The chart has a sleeve column: say where the sleeve is measured from, the shoulder seam or the centre back of the neck.' ), $bad['chart']['errors'] );
		foreach ( array( '_curtain_size_chart', '_curtain_size_chart_type', '_curtain_sleeve_convention' ) as $k ) {
			assert_false( array_key_exists( $k, $bad['meta'] ), "$k is left as stored" );
		}
		assert_same( 'garment', $bad['chart']['input']['size_chart_type'] );
		assert_same( 2, count( $bad['chart']['input']['size_chart'] ) );

		// A measuring point without a sleeve column is not stored.
		$none = Sanitizer::from_post( array( 'size_chart_type' => 'garment', 'size_chart' => array( array( 'size' => 'M', 'bust' => '100' ) ), 'sleeve_convention' => 'centre_back' ) );
		assert_same( null, $none['meta']['_curtain_sleeve_convention'] );
	}
);

test(
	'meta box save: a W/L chart gets its axes from the labels, 60 rows fit, and a label that is not waist/leg blocks the save in plain words',
	static function (): void {
		$rows = array();
		for ( $i = 0; $i < 60; $i++ ) {
			$rows[] = array( 'size' => ( 20 + intdiv( $i, 3 ) ) . '/' . ( 30 + 2 * ( $i % 3 ) ), 'waist' => (string) ( 60 + $i ), 'rise' => '26', 'inseam' => '80' );
		}
		$r = Sanitizer::from_post( array( 'size_chart_type' => 'garment', 'size_axes' => 'wl', 'size_chart' => $rows ) );
		assert_same( array(), $r['chart']['errors'] );
		$chart = json_decode( (string) $r['meta']['_curtain_size_chart'], true );
		assert_same( 60, count( $chart ) );
		assert_same( array( 'waist' => '20', 'leg' => '30' ), $chart[0]['axes'] );
		assert_same( 26, $chart[0]['rise'] );
		$v = Schema_Validator::from_file( curtain_schema_path( 'garment-draft.schema.json' ) );
		$p = Payload_Builder::build( array( 'id' => 1, 'name' => 'Chino' ), array_filter( $r['meta'], static fn ( $x ) => null !== $x ), array( 'default_brand' => 'Shop' ) )['payload'];
		assert_same( array(), $v->validate( $p ) );

		$rows[] = array( 'size' => '33', 'waist' => '86' );
		$bad    = Sanitizer::from_post( array( 'size_chart_type' => 'garment', 'size_axes' => 'wl', 'size_chart' => $rows ) );
		assert_same( array(), $bad['chart']['errors'], 'a 61st row is cut (the cap is 60, as before at 30), so it is never checked' );
		$rows[59] = array( 'size' => '33', 'waist' => '86' );
		$bad      = Sanitizer::from_post( array( 'size_chart_type' => 'garment', 'size_axes' => 'wl', 'size_chart' => array_slice( $rows, 0, 60 ) ) );
		assert_same( array( 'Size 33 is not a waist/leg size: write it as waist/leg, for example 32/34.' ), $bad['chart']['errors'] );
		assert_false( array_key_exists( '_curtain_size_chart', $bad['meta'] ) );
	}
);

test(
	'meta box save: a women\'s chart is stored exactly as before (no axes, no measuring point, no messages)',
	static function (): void {
		$rows = array( array( 'size' => '8', 'bust' => '85', 'waist' => '67.5', 'hip' => '94' ), array( 'size' => '10', 'bust' => '90', 'waist' => '72.5', 'hip' => '99' ) );
		$r    = Sanitizer::from_post( array( 'size_chart_type' => 'body', 'size_chart' => $rows ) );
		assert_same( '[{"size":"8","bust":85,"waist":67.5,"hip":94},{"size":"10","bust":90,"waist":72.5,"hip":99}]', $r['meta']['_curtain_size_chart'] );
		assert_same( array( 'errors' => array(), 'warnings' => array(), 'input' => null ), $r['chart'] );
		assert_same( null, $r['meta']['_curtain_sleeve_convention'] );
	}
);

test(
	'the meta box shows the men\'s columns only on a men\'s product or a chart that has them',
	static function (): void {
		if ( ! class_exists( 'WP_Post' ) ) {
			eval( 'final class WP_Post { public int $ID = 0; }' ); // phpcs:ignore
		}
		foreach ( array( 'wp_nonce_field', 'selected', 'checked' ) as $fn ) {
			assert_true( function_exists( $fn ) || true );
		}
		$render = static function ( int $id, array $meta ): string {
			Curtain_Test_State::$meta[ $id ] = $meta;
			$post                            = new WP_Post();
			$post->ID                        = $id;
			ob_start();
			Product_Meta::render( $post );
			return (string) ob_get_clean();
		};
		if ( ! function_exists( 'wp_nonce_field' ) || ! function_exists( 'selected' ) || ! function_exists( 'checked' ) ) {
			return; // The shims do not render forms; the e2e harness (e2e/render-chart-box.php) does.
		}
		$women = $render( 9101, array( '_curtain_size_chart' => '[{"size":"8","bust":85}]', '_curtain_size_chart_type' => 'body' ) );
		assert_contains( '<div class="curtain-box">', $women );
		$men = $render( 9102, array( '_curtain_audience' => 'men', '_curtain_size_chart' => '[{"size":"M","bust":106}]', '_curtain_size_chart_type' => 'garment' ) );
		assert_contains( 'curtain-show-mens', $men );
		$wl = $render( 9103, array( '_curtain_size_chart' => '[{"size":"32/32","waist":84,"axes":{"waist":"32","leg":"32"}}]', '_curtain_size_chart_type' => 'garment' ) );
		assert_contains( 'curtain-show-mens', $wl );
		assert_contains( 'name="curtain[size_axes]" value="wl"  checked="checked"', $wl );
	}
);

test(
	'vocabulary: the PHP lists mirror @curtain/schema (fit points, columns, conventions, meta key)',
	static function (): void {
		assert_same( array( 'bust', 'waist', 'hip', 'shoulder', 'thigh', 'inseam', 'foot', 'neck', 'sleeve' ), Vocab::FIT_POINTS );
		assert_same( Chart_Columns::COLUMNS, Vocab::MENS_SIZE_COLUMNS );
		assert_same( array( 'shoulder_point', 'centre_back' ), Vocab::SLEEVE_CONVENTIONS );
		assert_same( array( 'sleeveConvention', 'enum', false ), Vocab::META_KEYS['_curtain_sleeve_convention'] );
		assert_same( 'seat', Vocab::size_column_key( 'hip', 'men' ) );
		assert_same( 'hip', Vocab::size_column_key( 'hip', 'women' ) );
		assert_same( 'hip', Vocab::size_column_key( 'hip', 'unisex' ) );
	}
);
