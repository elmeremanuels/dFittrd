<?php
/**
 * Meta box POST → `_paskamer_*` meta, and the round trip through the Payload_Builder.
 *
 * @package Paskamer\Tests
 */

declare(strict_types=1);

use Paskamer\Payload_Builder;
use Paskamer\Sanitizer;

function paskamer_sample_post(): array {
	return array(
		'category'             => 'dress',
		'subcategory'          => ' wrap-midi ',
		'brand'                => 'Aalter <b>Studio</b>',
		'pattern_block'        => 'wrap',
		'pattern_block_custom' => 'ignored',
		'fabric_primary'       => 'Linen',
		'fabric_blend'         => array( array( 'fibre' => 'Linen', 'pct' => '98' ), array( 'fibre' => 'elastane', 'pct' => '2' ), array( 'fibre' => '', 'pct' => '' ) ),
		'fabric_weight_gsm'    => '240',
		'fabric_stretch_pct'   => '2',
		'fabric_drape'         => '0,78',
		'fabric_opacity'       => '',
		'fabric_sheen'         => '0.15',
		'ease'                 => array( 'bust' => '6', 'waist' => '4', 'hip' => '8', 'foot' => '' ),
		'length'               => array( 'shoulder_to_hem' => '118', 'sleeve_length' => '0' ),
		'length_custom'        => array( array( 'key' => 'Hem Circumference', 'value' => '150' ), array( 'key' => '', 'value' => '' ) ),
		'size_chart'           => array(
			array( 'size' => 'XS', 'bust' => '84', 'waist' => '64', 'hip' => '92', 'shoulder' => '36', 'thigh' => '0', 'inseam' => '' ),
			array( 'size' => 'S', 'bust' => '88', 'waist' => '68', 'hip' => '96', 'shoulder' => '37' ),
			array( 'size' => '', 'bust' => '99' ),
		),
		'size_chart_type'      => 'body',
		'sizing_notes'         => "runs small\n<script>x</script>",
		'true_to_size_score'   => '0.92',
		'critical_fit_points'  => array( 'bust', 'shoulder', 'bust', 'neck' ),
		'stretch_zones'        => array( 'waist-tie' ),
		'stretch_zones_other'  => 'Side Seam, rib-hem',
		'style_tags'           => array( 'bohemian' => '0.7', 'minimal' => '', 'sporty' => '3' ),
		'primary_color_hex'    => 'c97a4f',
		'colorways'            => array( array( 'name' => 'Terracotta', 'hex' => '#C97A4F', 'sku' => 'AS1-TC' ), array( 'name' => '', 'hex' => '', 'sku' => '' ) ),
		'flat_lay_id'          => '991',
		'flat_lay_url'         => 'https://shop.example/wp-content/uploads/flat.png',
	);
}

test(
	'from_post stores JSON strings / scalars in the formats fromWooMeta reads',
	static function (): void {
		$r = Sanitizer::from_post( paskamer_sample_post() );
		$m = $r['meta'];
		assert_same( array(), $r['errors'] );
		assert_same( 'dress', $m['_paskamer_category'] );
		assert_same( 'wrap-midi', $m['_paskamer_subcategory'] );
		assert_same( 'Aalter Studio', $m['_paskamer_brand'], 'tags stripped' );
		assert_same( 'wrap', $m['_paskamer_pattern_block'] );
		assert_json_equal( array( 'primary' => 'linen', 'blend' => array( array( 'linen', 98 ), array( 'elastane', 2 ) ), 'weightGsm' => 240, 'stretchPct' => 2, 'drape' => 0.78, 'sheen' => 0.15 ), json_decode( $m['_paskamer_fabric'], true ) );
		assert_json_equal( array( 'bust' => 6, 'waist' => 4, 'hip' => 8 ), json_decode( $m['_paskamer_ease'], true ) );
		assert_json_equal( array( 'shoulder_to_hem' => 118, 'sleeve_length' => 0, 'hem_circumference' => 150 ), json_decode( $m['_paskamer_length_cm'], true ) );
		assert_json_equal(
			array( array( 'size' => 'XS', 'bust' => 84, 'waist' => 64, 'hip' => 92, 'shoulder' => 36 ), array( 'size' => 'S', 'bust' => 88, 'waist' => 68, 'hip' => 96, 'shoulder' => 37 ) ),
			json_decode( $m['_paskamer_size_chart'], true ),
			'0 / empty cells omitted, rows without a size dropped'
		);
		assert_same( 'body', $m['_paskamer_size_chart_type'] );
		assert_same( "runs small\nx", $m['_paskamer_sizing_notes'], 'tags stripped, newlines kept (textarea)' );
		assert_same( '0.92', $m['_paskamer_true_to_size_score'] );
		assert_same( '["bust","shoulder"]', $m['_paskamer_critical_fit_points'] );
		assert_same( '["waist-tie","side seam","rib-hem"]', $m['_paskamer_stretch_zones'] );
		assert_json_equal( array( 'bohemian' => 0.7, 'sporty' => 1 ), json_decode( $m['_paskamer_style_tags'], true ), 'clamped to 0..1' );
		assert_same( '#C97A4F', $m['_paskamer_primary_color_hex'] );
		assert_json_equal( array( array( 'name' => 'Terracotta', 'hex' => '#C97A4F', 'sku' => 'AS1-TC' ) ), json_decode( $m['_paskamer_colorways'], true ) );
		assert_same( 'https://shop.example/wp-content/uploads/flat.png', $m['_paskamer_flat_lay_photo'] );
		assert_same( '991', $m['_paskamer_flat_lay_photo_id'] );
	}
);

test(
	'empty form deletes every key (null) and a chart without a type is flagged',
	static function (): void {
		$r = Sanitizer::from_post( array() );
		foreach ( $r['meta'] as $key => $value ) {
			assert_same( null, $value, $key );
		}
		$r = Sanitizer::from_post( array( 'size_chart' => array( array( 'size' => 'M', 'bust' => '90' ) ) ) );
		assert_same( array( 'sizeChartType' ), $r['errors'] );
		assert_same( null, $r['meta']['_paskamer_size_chart_type'] );
		assert_same( '[{"size":"M","bust":90}]', $r['meta']['_paskamer_size_chart'] );
	}
);

test(
	'invalid values are dropped and reported, never stored',
	static function (): void {
		$r = Sanitizer::from_post(
			array(
				'category'           => 'hat',
				'size_chart_type'    => 'flat',
				'true_to_size_score' => '7',
				'primary_color_hex'  => 'red',
				'fabric_drape'       => '2',
				'colorways'          => array( array( 'name' => 'Only name' ) ),
				'fabric_blend'       => array( array( 'fibre' => 'x', 'pct' => '150' ) ),
				'pattern_block'      => Sanitizer::CUSTOM_PATTERN_BLOCK,
				'pattern_block_custom' => 'Cocoon',
			)
		);
		sort( $r['errors'] );
		assert_same( array( 'category', 'colorways', 'fabric.blend', 'fabric.drape', 'primaryColorHex', 'sizeChartType', 'trueToSizeScore' ), $r['errors'] );
		assert_same( null, $r['meta']['_paskamer_category'] );
		assert_same( null, $r['meta']['_paskamer_primary_color_hex'] );
		assert_same( null, $r['meta']['_paskamer_colorways'] );
		assert_same( '{"drape":1}', $r['meta']['_paskamer_fabric'], 'drape clamped' );
		assert_same( 'cocoon', $r['meta']['_paskamer_pattern_block'], 'custom block lower-cased' );
	}
);

test(
	'round trip: sanitised meta → Payload_Builder yields a full, schema-valid GarmentPayload',
	static function (): void {
		$meta = Sanitizer::from_post( paskamer_sample_post() )['meta'];
		$meta = array_filter( $meta, static fn( $v ) => null !== $v );
		$product = array(
			'id'        => 42,
			'name'      => 'Linen Wrap Dress',
			'permalink' => 'https://shop.example/product/linen-wrap-dress/',
			'price'     => '149',
			'currency'  => 'EUR',
			'images'    => array( array( 'src' => 'https://shop.example/a.jpg' ) ),
		);
		$b = Payload_Builder::build( $product, $meta, array( 'default_brand' => 'Shop' ) );
		assert_same( array(), $b['warnings'] );
		$v = \Paskamer\Schema_Validator::from_file( paskamer_schema_path( 'garment.schema.json' ) );
		assert_same( array(), $v->validate( $b['payload'] ), json_encode( $b['payload'] ) );
		assert_same( 'Aalter Studio', $b['payload']['brand'] );
		assert_same( array(), Payload_Builder::missing_heavy_fields( $b['payload'] ) );
	}
);
