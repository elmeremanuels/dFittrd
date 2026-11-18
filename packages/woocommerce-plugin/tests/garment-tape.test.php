<?php
/**
 * Garment measurements: Garment_Tape (the PHP twin of checkGarmentTapeInput / fillGarmentTape) and
 * the closure + tape in Payload_Builder (twin of fromWooMeta), against tests/fixtures/garment-tape.json
 * exported from @curtain/schema. Then the meta box path: Sanitizer turns the table into meta, an
 * error saves nothing of the table and keeps what was typed.
 *
 * @package Curtain\Tests
 */

declare(strict_types=1);

use Curtain\Garment_Tape;
use Curtain\Payload_Builder;
use Curtain\Sanitizer;

function curtain_tape_fixtures(): array {
	$f = json_decode( (string) file_get_contents( __DIR__ . '/fixtures/garment-tape.json' ), true );
	assert_true( is_array( $f ) && isset( $f['cases'], $f['products'], $f['refills'] ), 'tests/fixtures/garment-tape.json present' );
	return $f;
}

/** The pilot skirt's chart and the shop's three measured sizes. */
function curtain_tape_chart(): array {
	return array(
		array( 'size' => '8', 'bust' => 85, 'waist' => 67.5, 'hip' => 94 ),
		array( 'size' => '10', 'bust' => 90, 'waist' => 72.5, 'hip' => 99 ),
		array( 'size' => '12', 'bust' => 95, 'waist' => 77.5, 'hip' => 104 ),
		array( 'size' => '14', 'bust' => 100, 'waist' => 82.5, 'hip' => 109 ),
		array( 'size' => '16', 'bust' => 105, 'waist' => 87.5, 'hip' => 114 ),
	);
}

test(
	'parity: every shared form case gives the TypeScript errors, warnings, measured sizes and filled tape',
	static function (): void {
		$cases = curtain_tape_fixtures()['cases'];
		assert_true( count( $cases ) >= 12, 'the shared cases were exported' );
		$codes = array();
		foreach ( $cases as $case ) {
			$got = Garment_Tape::check( $case['input'] );
			assert_json_equal( $case['expected'], $got, $case['name'] );
			foreach ( array_merge( $got['errors'], $got['warnings'] ) as $i ) {
				$codes[ $i['code'] ] = true;
			}
		}
		assert_same( 18, count( $codes ), 'every issue code is reached' );
	}
);

test(
	'parity: the stored tape read back by Payload_Builder (chart changes, broken tape, closure)',
	static function (): void {
		foreach ( curtain_tape_fixtures()['products'] as $case ) {
			$meta = array();
			foreach ( $case['meta'] as $row ) {
				$meta[ $row['key'] ] = $row['value'];
			}
			$built = Payload_Builder::build( $case['product'], $meta, array( 'default_brand' => 'Fixture Shop' ) );
			assert_json_equal( $case['expected'], $built['payload'], $case['name'] );
			assert_json_equal( $case['warnings'], $built['warnings'], $case['name'] . ' warnings' );
		}
	}
);

test(
	'parity: refill against a changed chart, and the sizes as typed',
	static function (): void {
		$f = curtain_tape_fixtures();
		foreach ( $f['refills'] as $i => $case ) {
			assert_json_equal( $case['expected'], Garment_Tape::refill( $case['chart'], $case['tape'] ), "refill $i" );
		}
		assert_json_equal( $f['measured'], Garment_Tape::measured_from_tape( $f['refills'][0]['tape'] ), 'measured_from_tape' );
	}
);

test(
	'the meta box words are the TypeScript catalogue, word for word (D21)',
	static function (): void {
		$text = curtain_tape_fixtures()['text'];
		foreach ( Garment_Tape::form_text() as $key => $value ) {
			assert_json_equal( $text[ $key ], $value, $key );
		}
		assert_same( array_keys( $text ), array_keys( Garment_Tape::form_text() ), 'same keys' );
	}
);

test(
	'meta box: ticked sizes become the filled tape, unticked rows are ignored, the closure is stored',
	static function (): void {
		$in = array(
			'category'        => 'bottom',
			'size_chart_type' => 'body',
			'size_chart'      => curtain_tape_chart(),
			'closure'         => 'pull-on',
			'tape_depth'      => '20',
			'tape'            => array(
				array( 'size' => '8', 'measured' => '1', 'waistRelaxed' => '67', 'waistStretched' => '94', 'hip' => '112', 'hemSweep' => '230', 'length' => '103' ),
				array( 'size' => '10', 'measured' => '1', 'waistRelaxed' => '71', 'waistStretched' => '100', 'hip' => '122', 'hemSweep' => '248', 'length' => '103' ),
				array( 'size' => '12', 'waistRelaxed' => '75.5', 'waistStretched' => '105' ),
				array( 'size' => '14', 'measured' => '1', 'waistRelaxed' => '80', 'waistStretched' => '110', 'hip' => '126', 'hemSweep' => '260', 'length' => '104' ),
				array( 'size' => '16' ),
			),
		);
		$r = Sanitizer::from_post( $in );
		assert_same( 'pull-on', $r['meta']['_curtain_closure'] );
		assert_same( null, $r['meta'][ Garment_Tape::META_INPUT ], 'no draft kept after a clean save' );
		$tape = json_decode( (string) $r['meta']['_curtain_garment_tape'], true );
		assert_same( array( '8', '10', '12', '14', '16' ), array_column( $tape, 'size' ) );
		assert_json_equal( array( 'cm' => 105, 'provenance' => 'interpolated' ), $tape[2]['waistStretched'], 'AU 12 is estimated, never the typed 105 marked as measured' );
		assert_json_equal( array( 'cm' => 115, 'provenance' => 'extrapolated' ), $tape[4]['waistStretched'], 'AU 16' );
		assert_same( 20, $tape[0]['hip']['depthBelowBandCm'] );
		assert_same( array(), $r['tape']['errors'] );
		assert_same( array( 'edge_unmeasured' ), array_column( $r['tape']['warnings'], 'code' ) );
	}
);

test(
	'meta box: an error saves nothing of the table, keeps what was typed, and says why in English',
	static function (): void {
		$in = array(
			'size_chart_type' => 'body',
			'size_chart'      => curtain_tape_chart(),
			'closure'         => 'pull-on',
			'tape'            => array(
				array( 'size' => '14', 'measured' => '1', 'waistRelaxed' => '80', 'waistStretched' => '78' ),
				array( 'size' => '8', 'measured' => '1', 'waistRelaxed' => 'sixty' ),
			),
		);
		$r = Sanitizer::from_post( $in );
		assert_false( array_key_exists( '_curtain_garment_tape', $r['meta'] ), 'stored tape left as it was' );
		assert_false( array_key_exists( '_curtain_closure', $r['meta'] ), 'stored closure left as it was' );
		$draft = json_decode( (string) $r['meta'][ Garment_Tape::META_INPUT ], true );
		assert_same( 'sixty', $draft['measured'][1]['waistRelaxedCm'] );
		assert_same(
			array(
				'Size 14: the stretched waistband (78 cm) is smaller than the relaxed waistband (80 cm). Check the two measurements.',
				'Size 8, A (waistband, relaxed): this is not a number. Write centimetres, for example 94 or 94.5.',
			),
			array_column( $r['tape']['errors'], 'message' )
		);
	}
);

test(
	'meta box: a decimal comma is a number; unticking every size and the closure clears both',
	static function (): void {
		$r = Sanitizer::from_post(
			array(
				'size_chart_type' => 'body',
				'size_chart'      => curtain_tape_chart(),
				'closure'         => 'zip',
				'tape'            => array( array( 'size' => '8', 'measured' => '1', 'waistRelaxed' => '67,5' ) ),
			)
		);
		$tape = json_decode( (string) $r['meta']['_curtain_garment_tape'], true );
		assert_same( 67.5, $tape[0]['waistRelaxed']['cm'] );
		$cleared = Sanitizer::from_post(
			array(
				'size_chart'      => curtain_tape_chart(),
				'size_chart_type' => 'body',
				'closure'         => '',
				'tape'            => array( array( 'size' => '8' ) ),
			)
		);
		assert_same( null, $cleared['meta']['_curtain_garment_tape'] );
		assert_same( null, $cleared['meta']['_curtain_closure'] );
		$untouched = Sanitizer::from_post( array( 'size_chart' => curtain_tape_chart(), 'size_chart_type' => 'body' ) );
		assert_false( array_key_exists( '_curtain_garment_tape', $untouched['meta'] ), 'a POST without the table (quick edit) leaves the tape alone' );
	}
);

test(
	'meta box: a chart emptied in the same save takes the stored tape with it; the stale table rows are not read',
	static function (): void {
		$r = Sanitizer::from_post(
			array(
				'size_chart_type' => 'body',
				'closure'         => 'pull-on',
				'tape'            => array( array( 'size' => '8', 'measured' => '1', 'waistRelaxed' => '67' ) ),
			)
		);
		assert_same( null, $r['meta']['_curtain_size_chart'] );
		assert_same( null, $r['meta']['_curtain_garment_tape'], 'the tape goes with the chart' );
		assert_same( 'pull-on', $r['meta']['_curtain_closure'] );
		assert_same( array(), $r['tape']['errors'], 'no no_chart error that would keep the old tape' );
		$bad = Sanitizer::from_post( array( 'closure' => 'velcro', 'tape' => array( array( 'size' => '8', 'measured' => '1', 'waistRelaxed' => '67' ) ) ) );
		assert_same( null, $bad['meta']['_curtain_garment_tape'], 'even with a closure error' );
		assert_same( array( 'unknown_closure' ), array_column( $bad['tape']['errors'], 'code' ) );
	}
);

test(
	'meta box: one depth input, so a bad depth is one error without a size (twin of collapseSharedDepthIssues)',
	static function (): void {
		$row = static function ( string $size, string $a ): array {
			return array( 'size' => $size, 'measured' => '1', 'waistRelaxed' => $a, 'hip' => '120' );
		};
		$r   = Sanitizer::from_post(
			array(
				'size_chart_type' => 'body',
				'size_chart'      => curtain_tape_chart(),
				'tape_depth'      => '90',
				'tape'            => array( $row( '8', '67' ), $row( '10', 'x' ), $row( '14', '80' ) ),
			)
		);
		assert_json_equal(
			array(
				array( 'code' => 'depth_out_of_range', 'field' => 'hipDepth', 'message' => 'The hip depth below the band (90 cm) must be between 0 and 80 cm. We ask for 20 cm.' ),
				array( 'code' => 'not_a_number', 'size' => '10', 'field' => 'waistRelaxed', 'message' => 'Size 10, A (waistband, relaxed): this is not a number. Write centimetres, for example 94 or 94.5.' ),
			),
			$r['tape']['errors']
		);
		$text = Garment_Tape::collapse_shared_depth( Garment_Tape::check( array( 'chart' => curtain_tape_chart(), 'measured' => array( array( 'size' => '8', 'hipCm' => 110, 'hipDepthBelowBandCm' => 'twenty' ), array( 'size' => '10', 'hipCm' => 115, 'hipDepthBelowBandCm' => 'twenty' ) ) ) )['errors'], 'twenty' );
		assert_json_equal( array( array( 'code' => 'not_a_number', 'field' => 'hipDepth', 'message' => 'The hip depth below the band is not a number. Write centimetres, for example 20.' ) ), $text );
	}
);

/** Saves the box as Product_Meta::save does (minus nonce and WordPress), then renders it. */
function curtain_tape_save_and_render( int $id, array $in ): string {
	$r = Sanitizer::from_post( $in );
	foreach ( $r['meta'] as $k => $v ) {
		if ( null === $v ) {
			delete_post_meta( $id, $k );
		} else {
			update_post_meta( $id, $k, wp_slash( $v ) );
		}
	}
	if ( null !== $r['tape'] ) {
		Curtain\Product_Meta::store_tape_issues( $id, $r['tape'] );
	}
	return curtain_tape_render( $id );
}

function curtain_tape_render( int $id ): string {
	$m = new ReflectionMethod( Curtain\Product_Meta::class, 'render_tape' );
	$m->setAccessible( true );
	$chart = json_decode( (string) get_post_meta( $id, '_curtain_size_chart', true ), true );
	ob_start();
	$m->invoke( null, $id, is_array( $chart ) ? $chart : array(), (string) get_post_meta( $id, '_curtain_closure', true ), json_decode( (string) get_post_meta( $id, '_curtain_garment_tape', true ), true ) );
	return (string) ob_get_clean();
}

test(
	'meta box: a size renamed in the chart in the same save keeps its typed numbers, under an editable label',
	static function (): void {
		$id    = 9101;
		$base  = array(
			'size_chart_type' => 'body',
			'size_chart'      => curtain_tape_chart(),
			'closure'         => 'pull-on',
			'tape'            => array(
				array( 'size' => '8', 'measured' => '1', 'waistRelaxed' => '67', 'waistStretched' => '94' ),
				array( 'size' => '14', 'measured' => '1', 'waistRelaxed' => '80', 'waistStretched' => '110' ),
			),
		);
		curtain_tape_save_and_render( $id, $base );
		$renamed                          = $base;
		$renamed['size_chart'][0]['size'] = 'XS';
		$renamed['tape'][0]['waistRelaxed'] = '68';
		$html = curtain_tape_save_and_render( $id, $renamed );
		assert_true( str_contains( $html, 'Size 8 is not in this product' ), 'the unknown size is said' );
		assert_true( 1 === preg_match( '/curtain-tape-size-input" name="curtain\[tape\]\[5\]\[size\]" value="8"/', $html ), 'the old label is an input' );
		assert_true( str_contains( $html, 'name="curtain[tape][5][waistRelaxed]" value="68"' ), 'the number typed in this save is kept' );
		// The merchant types the new label: it saves.
		$fixed         = $renamed;
		$fixed['tape'] = array(
			array( 'size' => 'XS', 'measured' => '1', 'waistRelaxed' => '68', 'waistStretched' => '94' ),
			array( 'size' => '14', 'measured' => '1', 'waistRelaxed' => '80', 'waistStretched' => '110' ),
		);
		$html = curtain_tape_save_and_render( $id, $fixed );
		assert_false( str_contains( $html, 'curtain-tape-size-input' ), 'no row left over' );
		$tape = json_decode( (string) get_post_meta( $id, '_curtain_garment_tape', true ), true );
		assert_same( 68, $tape[0]['waistRelaxed']['cm'] );
		assert_same( 'XS', $tape[0]['size'] );
	}
);

test(
	'meta box: a draft and its messages are dropped once the product changed elsewhere (sync, REST)',
	static function (): void {
		$id = 9102;
		curtain_tape_save_and_render(
			$id,
			array(
				'size_chart_type' => 'body',
				'size_chart'      => curtain_tape_chart(),
				'tape'            => array( array( 'size' => '8', 'measured' => '1', 'waistRelaxed' => 'sixty' ) ),
			)
		);
		assert_true( str_contains( curtain_tape_render( $id ), 'value="sixty"' ), 'the draft shows right after the save' );
		update_post_meta( $id, '_curtain_garment_tape', wp_slash( (string) wp_json_encode( array( array( 'size' => '8', 'waistRelaxed' => array( 'cm' => 66, 'provenance' => 'measured' ) ) ) ) ) );
		$html = curtain_tape_render( $id );
		assert_false( str_contains( $html, 'value="sixty"' ), 'the old draft is gone' );
		assert_false( str_contains( $html, 'were not saved' ), 'and so are its messages' );
		assert_true( str_contains( $html, 'value="66"' ), 'the box shows what is stored now' );
	}
);

test(
	'a merchant never receives a shopper measurement: the table only holds garment numbers',
	static function (): void {
		$src = (string) file_get_contents( dirname( __DIR__ ) . '/includes/class-garment-tape.php' );
		assert_false( (bool) preg_match( '/userBody|bodyHip|BodyProfile|fitSignature/i', $src ), 'no body data in the twin' );
	}
);
