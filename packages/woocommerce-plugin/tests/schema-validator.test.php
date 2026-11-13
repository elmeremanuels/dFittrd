<?php
/**
 * The bundled JSON Schema (from @curtain/schema) + our draft-2020-12 subset validator.
 *
 * @package Curtain\Tests
 */

declare(strict_types=1);

use Curtain\Schema_Validator;

function curtain_full_garment(): array {
	return array(
		'schemaVersion'   => 1,
		'id'              => 'aalter-studio-1',
		'brand'           => 'Aalter Studio',
		'name'            => 'Linen Wrap Dress',
		'category'        => 'dress',
		'subcategory'     => 'wrap-midi',
		'priceEur'        => 149,
		'productUrl'      => 'https://shop.example/product/linen-wrap-dress/',
		'primaryColorHex' => '#C97A4F',
		'productPhotos'   => array( 'https://shop.example/a.jpg' ),
		'flatLayPhoto'    => 'https://shop.example/flat.png',
		'fabric'          => array( 'primary' => 'linen', 'blend' => array( array( 'linen', 100 ) ), 'weightGsm' => 240, 'stretchPct' => 2, 'drape' => 0.78, 'opacity' => 0.92, 'sheen' => 0.15 ),
		'patternBlock'    => 'wrap',
		'ease'            => array( 'bust' => 6, 'waist' => 4, 'hip' => 8 ),
		'lengthCm'        => array( 'shoulder_to_hem' => 118, 'shoulder_to_waist' => 41, 'sleeve_length' => 0 ),
		'sizeChartType'   => 'body',
		'sizeChart'       => array(
			array( 'size' => 'XS', 'bust' => 84, 'waist' => 64, 'hip' => 92, 'shoulder' => 36 ),
			array( 'size' => 'S', 'bust' => 88, 'waist' => 68, 'hip' => 96, 'shoulder' => 37 ),
		),
		'sizingNotes'     => 'runs small',
		'trueToSizeScore' => 0.92,
		'criticalFitPoints' => array( 'bust', 'shoulder' ),
		'stretchZones'    => array( 'waist-tie' ),
		'styleTags'       => array( 'bohemian' => 0.7, 'minimal' => 0.2 ),
		'colorways'       => array( array( 'name' => 'Terracotta', 'hex' => '#C97A4F', 'sku' => 'AS1-TC' ) ),
	);
}

test(
	'full GarmentPayload passes garment.schema.json',
	static function (): void {
		$v = Schema_Validator::from_file( curtain_schema_path( 'garment.schema.json' ) );
		assert_same( array(), $v->validate( curtain_full_garment() ) );
	}
);

test(
	'required fields and value constraints are enforced',
	static function (): void {
		$v = Schema_Validator::from_file( curtain_schema_path( 'garment.schema.json' ) );

		$g = curtain_full_garment();
		unset( $g['sizeChartType'], $g['fabric'] );
		$paths = array_column( $v->validate( $g ), 'path' );
		assert_true( in_array( 'sizeChartType', $paths, true ), 'sizeChartType required: ' . implode( ',', $paths ) );
		assert_true( in_array( 'fabric', $paths, true ), 'fabric required' );

		$g = curtain_full_garment();
		$g['primaryColorHex'] = 'C97A4F';
		$g['schemaVersion']   = 2;
		$g['category']        = 'hat';
		$g['sizeChart']       = array();
		$g['fabric']['drape'] = 1.5;
		$g['fabric']['blend'] = array( array( 'linen' ) );
		$g['ease']['neck']    = 3;
		$g['styleTags']['minimal'] = 2;
		$g['flatLayPhoto']    = 'wp-content/uploads/not-absolute.png';
		$issues = $v->validate( $g );
		$paths  = array_column( $issues, 'path' );
		foreach ( array( 'primaryColorHex', 'schemaVersion', 'category', 'sizeChart', 'fabric.drape', 'fabric.blend.0', 'ease.neck', 'styleTags.minimal', 'flatLayPhoto' ) as $p ) {
			assert_true( in_array( $p, $paths, true ), "expected an issue at $p, got: " . implode( ', ', $paths ) );
		}
	}
);

test(
	'draft schema accepts a partial payload but still validates present fields',
	static function (): void {
		$v = Schema_Validator::from_file( curtain_schema_path( 'garment-draft.schema.json' ) );
		assert_same( array(), $v->validate( array( 'schemaVersion' => 1, 'id' => '42', 'name' => 'Tee', 'brand' => 'Shop' ) ) );
		$issues = $v->validate( array( 'schemaVersion' => 1, 'id' => '42', 'name' => 'Tee' ) );
		assert_same( array( array( 'path' => 'brand', 'message' => 'required' ) ), $issues );
		$issues = $v->validate( array( 'schemaVersion' => 1, 'id' => '42', 'name' => 'Tee', 'brand' => 'Shop', 'sizeChartType' => 'flat' ) );
		assert_same( 'sizeChartType', $issues[0]['path'] );
	}
);

test(
	'validator keyword coverage: types, const/enum, lengths, prefixItems, propertyNames, $ref',
	static function (): void {
		$schema = array(
			'$defs'      => array( 'unit' => array( 'type' => 'number', 'minimum' => 0, 'maximum' => 1 ) ),
			'type'       => 'object',
			'required'   => array( 'a' ),
			'properties' => array(
				'a'   => array( 'type' => 'integer' ),
				'b'   => array( 'type' => 'string', 'minLength' => 2, 'maxLength' => 3, 'pattern' => '^[a-z]+$' ),
				'c'   => array( 'const' => 'x' ),
				'd'   => array( 'type' => 'array', 'prefixItems' => array( array( 'type' => 'string' ), array( 'type' => 'number' ) ), 'items' => false, 'minItems' => 2, 'maxItems' => 2 ),
				'e'   => array( 'type' => 'object', 'propertyNames' => array( 'enum' => array( 'k1', 'k2' ) ), 'additionalProperties' => array( '$ref' => '#/$defs/unit' ) ),
				'f'   => array( 'type' => array( 'string', 'null' ) ),
				'g'   => array( 'type' => 'number', 'exclusiveMinimum' => 0 ),
				'h'   => array( 'anyOf' => array( array( 'type' => 'string' ), array( 'type' => 'boolean' ) ) ),
				'uri' => array( 'type' => 'string', 'format' => 'uri' ),
			),
			'additionalProperties' => false,
		);
		$v = new Schema_Validator( $schema );
		assert_same( array(), $v->validate( array( 'a' => 1, 'b' => 'ab', 'c' => 'x', 'd' => array( 's', 1.5 ), 'e' => array( 'k1' => 0.5 ), 'f' => null, 'g' => 0.1, 'h' => true, 'uri' => 'https://x.example/p' ) ) );
		$issues = $v->validate( array( 'a' => 1.5, 'b' => 'A', 'c' => 'y', 'd' => array( 's', 'x', 3 ), 'e' => array( 'k3' => 2 ), 'f' => 1, 'g' => 0, 'h' => 1, 'uri' => 'ftp://x', 'zzz' => 1 ) );
		$paths = array_column( $issues, 'path' );
		foreach ( array( 'a', 'b', 'c', 'd.1', 'd.2', 'd', 'e.k3', 'f', 'g', 'h', 'uri', 'zzz' ) as $p ) {
			assert_true( in_array( $p, $paths, true ), "expected issue at $p, got " . implode( ', ', $paths ) );
		}
		assert_same( array(), $v->validate( array( 'a' => 2, 'e' => array() ) ), 'empty array is a valid empty object' );
		assert_same( 'expected object, got array', $v->validate( array( 'a' => 2, 'e' => array( 1 ) ) )[0]['message'] );
	}
);

test(
	'every MOCK_GARMENT fixture (as normalised by the TS mapping) validates against garment.schema.json',
	static function (): void {
		$file = __DIR__ . '/fixtures/garments.json';
		assert_true( is_readable( $file ), 'run `node scripts/export-fixtures.mjs` first' );
		$fixtures = json_decode( (string) file_get_contents( $file ), true );
		$v        = Schema_Validator::from_file( curtain_schema_path( 'garment.schema.json' ) );
		$count    = 0;
		foreach ( $fixtures['cases'] as $case ) {
			$issues = $v->validate( $case['expected'] );
			assert_same( array(), $issues, $case['id'] );
			++$count;
		}
		assert_true( $count >= 41, "expected 41 fixtures, got $count" );
	}
);

test(
	'duplicate size labels are rejected like the zod SizeChartSchema (trimmed, case-insensitive)',
	static function (): void {
		foreach ( array( 'garment.schema.json', 'garment-draft.schema.json' ) as $name ) {
			$v = Schema_Validator::from_file( curtain_schema_path( $name ) );
			$g = curtain_full_garment();
			$g['sizeChart'] = array(
				array( 'size' => 'S', 'bust' => 88 ),
				array( 'size' => 'M', 'bust' => 92 ),
				array( 'size' => ' m ', 'bust' => 96 ),
				array( 'size' => 'L', 'bust' => 100 ),
				array( 'size' => 's', 'bust' => 104 ),
				array( 'size' => 'M', 'bust' => 108 ),
			);
			$dupes = array_values( array_filter( $v->validate( $g ), static fn ( $i ) => str_starts_with( $i['message'], 'Duplicate size label' ) ) );
			assert_same( array( 'sizeChart.2.size', 'sizeChart.4.size', 'sizeChart.5.size' ), array_column( $dupes, 'path' ), $name );
			assert_same( 'Duplicate size label " m " (rows 2 and 3): every row of the size chart needs its own label', $dupes[0]['message'], $name );
			assert_same( 'Duplicate size label "M" (rows 2 and 6): every row of the size chart needs its own label', $dupes[2]['message'], $name );
		}

		// Unique labels (also ones that only look alike, e.g. "XL" and "XXL") stay valid.
		$v = Schema_Validator::from_file( curtain_schema_path( 'garment.schema.json' ) );
		$g = curtain_full_garment();
		$g['sizeChart'] = array( array( 'size' => 'XL', 'bust' => 104 ), array( 'size' => 'XXL', 'bust' => 110 ), array( 'size' => '38', 'bust' => 88 ) );
		assert_same( array(), $v->validate( $g ) );

		// A schema without a top-level sizeChart is not affected.
		$plain = new Schema_Validator( array( 'type' => 'object' ) );
		assert_same( array(), $plain->validate( array( 'sizeChart' => array( array( 'size' => 'M' ), array( 'size' => 'M' ) ) ) ) );
	}
);

test(
	'duplicate_size_labels mirrors duplicateSizeLabels in @curtain/schema',
	static function (): void {
		assert_same( array(), Schema_Validator::duplicate_size_labels( array() ) );
		assert_same( array( 'm', 'S' ), Schema_Validator::duplicate_size_labels( array( array( 'size' => 'M' ), array( 'size' => 's' ), array( 'size' => 'm' ), array( 'size' => 'S' ), array( 'size' => 'M ' ) ) ) );
		assert_same( 'XS', Schema_Validator::size_label_key( "\u{00A0} xs \t" ) );
		assert_same( 'ÉÉN MAAT', Schema_Validator::size_label_key( 'één maat' ) );
	}
);
