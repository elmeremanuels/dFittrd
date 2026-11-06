<?php
/**
 * Fabric_Text = PHP twin of resolveFabricText / fabricFromProductText (@curtain/schema), and the
 * fabric names in Payload_Builder = coerceFabric. Cases: tests/fixtures/fabric-text.json, written by
 * scripts/export-fixtures.mjs from the TypeScript functions (English and Dutch shop texts).
 *
 * @package Curtain\Tests
 */

declare(strict_types=1);

use Curtain\Fabric_Text;
use Curtain\Payload_Builder;

function curtain_fabric_fixtures(): array {
	$file = __DIR__ . '/fixtures/fabric-text.json';
	assert_true( is_readable( $file ), 'run `node scripts/export-fixtures.mjs` first' );
	return json_decode( (string) file_get_contents( $file ), true );
}

test(
	'the generated fabric library asset is present',
	static function (): void {
		assert_true( Fabric_Text::available(), 'assets/fabric-library.json (scripts/export-fixtures.mjs writes it)' );
		assert_same( 'cotton', Fabric_Text::lookup( 'Katoen' ) );
		assert_same( 'lyocell', Fabric_Text::lookup( 'TENCEL™' ) );
		assert_same( 'lyocell', Fabric_Text::library_id( 'tencel' ) );
		assert_same( null, Fabric_Text::library_id( 'technical' ) );
		assert_same( 'tencel', Fabric_Text::payload_name( 'lyocell' ) );
		assert_same( 'satin', Fabric_Text::payload_name( 'satin' ) );
		assert_same( 'suede', Fabric_Text::normalise( '  Suède ' ) );
	}
);

test(
	'parity: Fabric_Text::resolve matches resolveFabricText for every English and Dutch text',
	static function (): void {
		$count = 0;
		foreach ( curtain_fabric_fixtures()['texts'] as $case ) {
			assert_json_equal( $case['resolved'], Fabric_Text::resolve( $case['text'] ), $case['text'] );
			++$count;
		}
		assert_true( $count >= 40, "expected 40+ texts, got $count" );
	}
);

test(
	'parity: the meta-box prefill from a Material / Materiaal / Samenstelling attribute',
	static function (): void {
		foreach ( curtain_fabric_fixtures()['prefills'] as $case ) {
			assert_json_equal( $case['prefill'], Fabric_Text::prefill_from_attributes( $case['attributes'] ), json_encode( $case['attributes'] ) );
		}
	}
);

test(
	'parity: Payload_Builder resolves fabric names like fromWooMeta (payload and warnings)',
	static function (): void {
		$product = array( 'id' => 4182, 'name' => 'Wikkeljurk Lotte', 'price' => '89.95', 'categories' => array( array( 'name' => 'Jurken' ) ) );
		foreach ( curtain_fabric_fixtures()['metas'] as $case ) {
			$built = Payload_Builder::build( $product, array( '_curtain_fabric' => $case['meta'] ), array( 'default_brand' => 'Aalter Studio' ) );
			assert_json_equal( $case['fabric'], $built['payload']['fabric'] ?? null, $case['meta'] );
			assert_json_equal( $case['warnings'], $built['warnings'], $case['meta'] . ' warnings' );
		}
	}
);

test(
	'without the generated lexicon, names pass through unchanged (no warning, no rewrite)',
	static function (): void {
		Fabric_Text::use_library_file( __DIR__ . '/fixtures/does-not-exist.json' );
		try {
			assert_false( Fabric_Text::available() );
			$built = Payload_Builder::build( array( 'id' => 1, 'name' => 'X' ), array( '_curtain_fabric' => '{"primary":"Katoen","blend":[["Katoen",100]],"stretchPct":2,"drape":0.5}' ) );
			assert_json_equal( array( 'primary' => 'katoen', 'blend' => array( array( 'Katoen', 100 ) ), 'stretchPct' => 2, 'drape' => 0.5 ), $built['payload']['fabric'] );
			assert_same( array(), $built['warnings'] );
			assert_same( null, Fabric_Text::resolve( '95% katoen' ) );
		} finally {
			Fabric_Text::use_library_file( null );
		}
	}
);
