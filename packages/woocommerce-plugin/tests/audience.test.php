<?php
/**
 * Audience (women / men / unisex): Vocab::infer_audience is the PHP twin of @curtain/schema
 * mappings/audience.ts, and the payload builder maps it like fromWooMeta. The cases and their
 * answers are exported from TypeScript (scripts/export-fixtures.mjs → tests/fixtures/audience.json).
 *
 * @package Curtain\Tests
 */

declare(strict_types=1);

use Curtain\Payload_Builder;
use Curtain\Product_Meta;
use Curtain\Sanitizer;
use Curtain\Schema_Validator;
use Curtain\Vocab;

function curtain_audience_fixtures(): array {
	$f = json_decode( (string) file_get_contents( __DIR__ . '/fixtures/audience.json' ), true );
	assert_true( is_array( $f ) && isset( $f['cases'], $f['products'] ), 'tests/fixtures/audience.json present' );
	return $f;
}

test(
	'parity: Vocab::infer_audience_decision answers every shared case like the TypeScript inference',
	static function (): void {
		$cases = curtain_audience_fixtures()['cases'];
		assert_true( count( $cases ) >= 60, 'the shared cases were exported' );
		foreach ( $cases as $case ) {
			$d = Vocab::infer_audience_decision( $case['hints'] );
			assert_same( $case['audience'], null === $d ? null : $d['audience'], $case['name'] );
			assert_same( $case['source'], null === $d ? null : $d['source'], $case['name'] . ' (source)' );
			assert_same( $case['audience'], Vocab::infer_audience( $case['hints'] ), $case['name'] . ' (infer_audience)' );
		}
	}
);

test(
	'"women" is never read as "men": whole words only',
	static function (): void {
		assert_same( array( 'womens', 'slim', 'jeans' ), Vocab::audience_words( "Women's Slim Jeans" ) );
		assert_same( array( 'mens', 'oxford', 'shirt' ), Vocab::audience_words( 'Men’s Oxford Shirt' ) );
		assert_same( 'women', Vocab::infer_audience( array( 'title' => 'Women Linen Shirt' ) ) );
		assert_same( 'women', Vocab::infer_audience( array( 'productType' => 'Womenswear' ) ) );
		assert_same( 'women', Vocab::infer_audience( array( 'tags' => array( 'female' ) ) ) );
		foreach ( array( 'Garment-dyed tee', 'Element Cement Moment Tee', 'Amendment mental menu tee', 'Herenhuis poster', 'Boyfriend Jeans', 'Iron Man Tee', 'T-shirt voor alle mensen' ) as $title ) {
			assert_same( null, Vocab::infer_audience( array( 'title' => $title ) ), $title );
		}
		assert_same( null, Vocab::infer_audience( array( 'title' => 12, 'tags' => array( 12, null ) ) ), 'values that are not text are skipped' );
	}
);

test(
	'parity: the PHP builder maps the audience of WooCommerce products like fromWooMeta',
	static function (): void {
		$products = curtain_audience_fixtures()['products'];
		$seen     = array();
		foreach ( $products as $case ) {
			$meta = array();
			foreach ( $case['meta'] as $row ) {
				$meta[ $row['key'] ] = $row['value'];
			}
			$built = Payload_Builder::build( $case['product'], $meta, array( 'default_brand' => 'Fixture Shop' ) );
			assert_json_equal( $case['expected'], $built['payload'], $case['name'] );
			assert_json_equal( $case['warnings'], $built['warnings'], $case['name'] . ' warnings' );
			$seen[ $case['name'] ] = $built['payload']['audience'] ?? null;
		}
		assert_same( 'men', $seen["men's shirt, audience stored in the meta box"] );
		assert_same( 'men', $seen['jeans, audience read from the category path'] );
		assert_same( 'women', $seen["women contains men: a women's product stays women"] );
		assert_same( null, $seen['garment, element: no audience'] );
		assert_same( null, $seen['override none: no audience, no inference'] );
		assert_same( 'women', $seen['merchant override beats the category'] );
	}
);

test(
	'a product with no audience words gets no audience field (behaviour from before the field)',
	static function (): void {
		$p = Payload_Builder::build( array( 'id' => 5, 'name' => 'Linen Wrap Dress', 'categories' => array( array( 'name' => 'Dresses' ) ) ), array(), array() )['payload'];
		assert_false( array_key_exists( 'audience', $p ) );
	}
);

test(
	'the men\'s fixtures built by PHP pass garment.schema.json; an unknown audience does not',
	static function (): void {
		$v = Schema_Validator::from_file( curtain_schema_path( 'garment.schema.json' ) );
		foreach ( array_slice( curtain_audience_fixtures()['products'], 0, 2 ) as $case ) {
			$meta = array();
			foreach ( $case['meta'] as $row ) {
				$meta[ $row['key'] ] = $row['value'];
			}
			$payload = Payload_Builder::build( $case['product'], $meta, array( 'default_brand' => 'Fixture Shop' ) )['payload'];
			assert_same( 'men', $payload['audience'] );
			assert_same( array(), $v->validate( $payload ), $case['name'] );
			foreach ( array( 'women', 'unisex' ) as $a ) {
				$payload['audience'] = $a;
				assert_same( array(), $v->validate( $payload ), $a );
			}
			unset( $payload['audience'] );
			assert_same( array(), $v->validate( $payload ), 'audience is optional' );
			foreach ( array( 'kids', 'none', 'Men', '', 1, null ) as $bad ) {
				$payload['audience'] = $bad;
				assert_true( in_array( 'audience', array_column( $v->validate( $payload ), 'path' ), true ), 'rejected: ' . var_export( $bad, true ) );
			}
		}
	}
);

test(
	'the meta box value: women, men, unisex or none are stored, anything else is refused',
	static function (): void {
		assert_true( isset( Vocab::META_KEYS['_curtain_audience'] ) );
		assert_same( array( 'audience', 'enum', false ), Vocab::META_KEYS['_curtain_audience'] );
		foreach ( Vocab::AUDIENCE_OPTIONS as $value ) {
			$r = Sanitizer::from_post( array( 'audience' => $value ) );
			assert_same( $value, $r['meta']['_curtain_audience'] );
			assert_false( in_array( 'audience', $r['errors'], true ) );
		}
		$r = Sanitizer::from_post( array( 'audience' => ' MEN ' ) );
		assert_same( 'men', $r['meta']['_curtain_audience'] );
		$r = Sanitizer::from_post( array() );
		assert_same( null, $r['meta']['_curtain_audience'], 'empty = read from the product' );
		$r = Sanitizer::from_post( array( 'audience' => 'kids' ) );
		assert_same( null, $r['meta']['_curtain_audience'] );
		assert_true( in_array( 'audience', $r['errors'], true ) );
	}
);

test(
	'the chart templates asset carries the men\'s templates with their own points',
	static function (): void {
		$data = json_decode( (string) file_get_contents( dirname( __DIR__ ) . '/assets/chart-templates.json' ), true );
		$by   = array();
		foreach ( $data['templates'] as $t ) {
			$by[ $t['id'] ] = $t;
		}
		foreach ( array( 'mens-letter-body', 'eu-mens-body', 'mens-jeans-wl-body' ) as $id ) {
			assert_true( isset( $by[ $id ] ), $id );
			assert_same( 'men', $by[ $id ]['audience'] );
			assert_same( 'body', $by[ $id ]['kind'] );
			assert_same( count( $by[ $id ]['sizes'] ), count( $by[ $id ]['rows'] ) );
		}
		assert_same( array( 'size', 'bust', 'waist', 'hip' ), array_keys( $by['mens-letter-body']['rows'][0] ) );
		assert_same( array( 'size', 'waist', 'inseam' ), array_keys( $by['mens-jeans-wl-body']['rows'][0] ), 'jeans W/L: waist and inside leg only' );
		assert_false( isset( $by['au-womens-body']['audience'] ) && 'men' === $by['au-womens-body']['audience'] );
		foreach ( $by['mens-jeans-wl-body']['rows'][0] as $column => $_ ) {
			assert_true( in_array( $column, Vocab::SIZE_ROW_COLUMNS, true ), "the meta box table has a $column column" );
		}
	}
);
