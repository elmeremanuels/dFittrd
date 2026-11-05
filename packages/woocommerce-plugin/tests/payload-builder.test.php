<?php
/**
 * Payload_Builder = PHP twin of @curtain/schema fromWooMeta.
 *
 * @package Curtain\Tests
 */

declare(strict_types=1);

use Curtain\Payload_Builder;
use Curtain\Vocab;

test(
	'parity: PHP builder reproduces the TS normaliser for all 41 MOCK_GARMENTS',
	static function (): void {
		$fixtures = json_decode( (string) file_get_contents( __DIR__ . '/fixtures/garments.json' ), true );
		assert_true( is_array( $fixtures ) && isset( $fixtures['cases'] ), 'fixtures present' );
		foreach ( $fixtures['cases'] as $case ) {
			$meta = array();
			foreach ( $case['meta'] as $row ) {
				$meta[ $row['key'] ] = $row['value'];
			}
			$built = Payload_Builder::build( $case['product'], $meta, array( 'default_brand' => 'Fixture Shop' ) );
			assert_json_equal( $case['expected'], $built['payload'], $case['id'] );
			assert_same( array(), $built['warnings'], $case['id'] . ' warnings' );
		}
	}
);

test(
	'identity, brand fallbacks and category inference from WooCommerce categories',
	static function (): void {
		$product = array(
			'id'         => 77,
			'name'       => 'Everyday Tee',
			'permalink'  => 'https://shop.example/product/everyday-tee/',
			'price'      => '29,90',
			'currency'   => 'EUR',
			'images'     => array( array( 'src' => 'https://shop.example/a.jpg' ), array( 'src' => 'https://shop.example/a.jpg' ), array( 'src' => 'relative.jpg' ) ),
			'categories' => array( array( 'name' => 'Women > Tops & T-shirts', 'slug' => 'tops' ) ),
			'attributes' => array( array( 'name' => 'Brand', 'slug' => 'pa_brand', 'options' => array( 'Aalter Studio' ) ) ),
		);
		$b = Payload_Builder::build( $product, array(), array( 'default_brand' => 'Shop' ) );
		$p = $b['payload'];
		assert_same( 1, $p['schemaVersion'] );
		assert_same( '77', $p['id'], 'external id = post id as string' );
		assert_same( 'Aalter Studio', $p['brand'], 'brand attribute beats shop default' );
		assert_same( 'top', $p['category'], 'inferred from the most specific category segment' );
		assert_same( 29.9, $p['priceEur'], 'decimal comma' );
		assert_same( array( 'https://shop.example/a.jpg' ), $p['productPhotos'], 'deduped, non-absolute dropped' );
		assert_same( 'https://shop.example/product/everyday-tee/', $p['productUrl'] );
		assert_false( isset( $p['flatLayPhoto'] ) );

		// Explicit meta category and brand win; brands taxonomy beats attribute.
		$product['brands'] = array( array( 'name' => 'Monochrome' ) );
		$p = Payload_Builder::build( $product, array( '_curtain_category' => 'dress', 'brand' => ' Indigo ' ), array() )['payload'];
		assert_same( 'dress', $p['category'] );
		assert_same( 'Indigo', $p['brand'], 'meta brand (prefix-less key accepted, trimmed)' );
		$p = Payload_Builder::build( $product, array(), array() )['payload'];
		assert_same( 'Monochrome', $p['brand'] );

		// Dutch categories.
		assert_same( 'bottom', Vocab::infer_category( array( 'Broeken' ) ) );
		assert_same( 'shoes', Vocab::infer_category( array( null, 'Dames / Schoenen' ) ) );
		assert_same( null, Vocab::infer_category( array( 'Gift cards' ) ) );
	}
);

test(
	'non-EUR shops get no priceEur and a warning (contract: only EUR prices are mapped)',
	static function (): void {
		$b = Payload_Builder::build( array( 'id' => 1, 'name' => 'X', 'price' => '10', 'currency' => 'USD' ), array() );
		assert_false( isset( $b['payload']['priceEur'] ) );
		assert_same( 'priceEur', $b['warnings'][0]['path'] );
		$b = Payload_Builder::build( array( 'id' => 1, 'name' => 'X', 'price' => '', 'regular_price' => '12' ), array(), array( 'currency' => 'eur' ) );
		assert_same( 12, $b['payload']['priceEur'], 'regular_price fallback, integer stays int' );
	}
);

test(
	'flat-lay accepts a URL string or an attachment object {id,url}; warns on relative paths',
	static function (): void {
		$base = array( 'id' => 1, 'name' => 'X' );
		assert_same( 'https://shop.example/flat.png', Payload_Builder::build( $base, array( '_curtain_flat_lay_photo' => 'https://shop.example/flat.png' ) )['payload']['flatLayPhoto'] );
		assert_same( 'https://shop.example/flat.png', Payload_Builder::build( $base, array( '_curtain_flat_lay_photo' => array( 'id' => 9, 'url' => 'https://shop.example/flat.png' ) ) )['payload']['flatLayPhoto'] );
		$b = Payload_Builder::build( $base, array( '_curtain_flat_lay_photo' => 'wp-content/uploads/flat.png' ) );
		assert_false( isset( $b['payload']['flatLayPhoto'] ) );
		assert_same( 'flatLayPhoto', $b['warnings'][0]['path'] );
		// get_post_meta(…, false) single-element wrapping is unwrapped.
		assert_same( 'https://shop.example/flat.png', Payload_Builder::build( $base, array( '_curtain_flat_lay_photo' => array( 'https://shop.example/flat.png' ) ) )['payload']['flatLayPhoto'] );
	}
);

test(
	'size chart: aliases, object-keyed charts, empty/0 values omitted, sizeChartType honoured',
	static function (): void {
		$base = array( 'id' => 1, 'name' => 'X' );
		$meta = array(
			'_curtain_size_chart_type' => 'Body',
			'_curtain_size_chart'      => '{"S":{"chest":88,"hips":"96,5","waist":""},"M":{"chest":92,"hips":100}}',
		);
		$p = Payload_Builder::build( $base, $meta )['payload'];
		assert_same( 'body', $p['sizeChartType'] );
		assert_json_equal( array( array( 'size' => 'S', 'bust' => 88, 'hip' => 96.5 ), array( 'size' => 'M', 'bust' => 92, 'hip' => 100 ) ), $p['sizeChart'] );
		$b = Payload_Builder::build( $base, array( '_curtain_size_chart_type' => 'flat', '_curtain_size_chart' => 'not json' ) );
		assert_false( isset( $b['payload']['sizeChartType'] ) );
		assert_same( array( 'sizeChartType', 'sizeChart' ), array_column( $b['warnings'], 'path' ) );
		$p = Payload_Builder::build( $base, array( '_curtain_size_chart' => '[{"size":"38","eu":38,"foot_length_cm":24.5},{"label":"39","footEu":39}]' ) )['payload'];
		assert_json_equal( array( array( 'size' => '38', 'footEu' => 38, 'footLengthCm' => 24.5 ), array( 'size' => '39', 'footEu' => 39 ) ), $p['sizeChart'] );
	}
);

test(
	'fabric, ease, lengths, style tags, lists and colours coerce like the TS helpers',
	static function (): void {
		$base = array( 'id' => 1, 'name' => 'X' );
		$meta = array(
			'_curtain_fabric'              => '{"material":"Linen","gsm":"240","stretch":2,"drape":"0.78","blend":[{"fibre":"linen","pct":98},["elastane",2]],"opacity":"x"}',
			'_curtain_ease'                => '{"chest":6,"hips":8,"neck":3,"waist":"4"}',
			'_curtain_length_cm'           => '{"Shoulder to hem":118,"sleeve-length":"0","bad":"x"}',
			'_curtain_style_tags'          => '{"avant-garde":1.4,"minimal":"0.2","nope":1}',
			'_curtain_critical_fit_points' => 'Chest, hips|shoulders;foot;nonsense',
			'_curtain_stretch_zones'       => 'Waist-Tie, cuff',
			'_curtain_primary_color_hex'   => 'c97',
			'_curtain_colorways'           => '[{"label":"Terracotta","color":"#c97a4f","sku":"T1","photos":"https://shop.example/t.jpg, nope"},{"name":"broken"}]',
			'_curtain_pattern_block'       => 'Wrap',
			'_curtain_sizing_notes'        => '  runs small  ',
			'_curtain_true_to_size_score'  => '92',
			'_curtain_subcategory'         => 'wrap-midi',
		);
		$b = Payload_Builder::build( $base, $meta );
		$p = $b['payload'];
		assert_json_equal( array( 'primary' => 'linen', 'weightGsm' => 240, 'stretchPct' => 2, 'drape' => 0.78, 'blend' => array( array( 'linen', 98 ), array( 'elastane', 2 ) ) ), $p['fabric'] );
		assert_json_equal( array( 'bust' => 6, 'hip' => 8, 'waist' => 4 ), $p['ease'] );
		assert_json_equal( array( 'shoulder_to_hem' => 118, 'sleeve_length' => 0 ), $p['lengthCm'] );
		assert_json_equal( array( 'avantGarde' => 1, 'minimal' => 0.2 ), $p['styleTags'] );
		assert_same( array( 'bust', 'hip', 'shoulder', 'foot' ), $p['criticalFitPoints'] );
		assert_same( array( 'waist-tie', 'cuff' ), $p['stretchZones'] );
		assert_same( '#CC9977', $p['primaryColorHex'], '#RGB expanded + upper-cased' );
		assert_json_equal( array( array( 'name' => 'Terracotta', 'hex' => '#C97A4F', 'sku' => 'T1', 'productPhotos' => array( 'https://shop.example/t.jpg' ) ) ), $p['colorways'] );
		assert_same( 'wrap', $p['patternBlock'] );
		assert_same( 'runs small', $p['sizingNotes'] );
		assert_same( 0.92, $p['trueToSizeScore'], 'percentages accepted for unit fields' );
		$paths = array_column( $b['warnings'], 'path' );
		assert_true( in_array( 'fabric.opacity', $paths, true ), 'non-numeric fabric field warns' );
		assert_true( in_array( 'colorways', $paths, true ), 'broken colorway warns' );

		// primaryColorHex falls back to the first colorway.
		$p = Payload_Builder::build( $base, array( '_curtain_colorways' => '[{"name":"Ink","hex":"#1a1612"}]' ) )['payload'];
		assert_same( '#1A1612', $p['primaryColorHex'] );
	}
);

test(
	'hash() is stable across key order; missing_heavy_fields lists what blocks "active"',
	static function (): void {
		$a = array( 'id' => '1', 'fabric' => array( 'primary' => 'linen', 'drape' => 0.5 ) );
		$b = array( 'fabric' => array( 'drape' => 0.5, 'primary' => 'linen' ), 'id' => '1' );
		assert_same( Payload_Builder::hash( $a ), Payload_Builder::hash( $b ) );
		assert_same( 64, strlen( Payload_Builder::hash( $a ) ) );
		assert_same( array( 'category', 'sizeChartType', 'sizeChart', 'flatLayPhoto' ), Payload_Builder::missing_heavy_fields( $a ) );
		assert_same( array(), Payload_Builder::missing_heavy_fields( curtain_full_garment() ) );
	}
);
