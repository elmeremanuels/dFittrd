<?php
/**
 * The "Garment measurements" table of the meta box: the PHP twin of @curtain/schema's
 * `checkGarmentTapeInput`, `fillGarmentTape`, `measuredFromGarmentTape`, `refillGarmentTape` and
 * the `GarmentTapeSchema` check (packages/schema/src/garmentTape.ts, garmentTapeForm.ts).
 *
 * `tests/garment-tape.test.php` replays `GARMENT_TAPE_FORM_CASES` (exported with the TypeScript
 * answers to tests/fixtures/garment-tape.json) and must get the same errors, warnings, measured
 * sizes and filled tape. The sentences are the TypeScript catalogue's, word for word (D21: one
 * English catalogue; here through __() so a translation pack can reach them).
 *
 * Garment data only: no body measurement goes in or comes out (AGENTS.md rule 4). Pure: runs under
 * the test shims.
 *
 * @package Curtain
 */

declare(strict_types=1);

namespace Curtain;

defined( 'ABSPATH' ) || exit;

final class Garment_Tape {

	public const FIELDS        = array( 'waistRelaxed', 'waistStretched', 'hip', 'hemSweep', 'length' );
	public const INPUT_KEYS    = array(
		'waistRelaxed'   => 'waistRelaxedCm',
		'waistStretched' => 'waistStretchedCm',
		'hip'            => 'hipCm',
		'hemSweep'       => 'hemSweepCm',
		'length'         => 'lengthCm',
	);
	public const CLOSURES      = array( 'pull-on', 'zip', 'button', 'drawstring', 'wrap', 'other' );
	public const PROVENANCES   = array( 'measured', 'interpolated', 'extrapolated' );
	public const MAX_CM        = 600;
	public const MAX_DEPTH_CM  = 80;
	public const HIP_DEPTH_CM  = 20;
	public const FLAT_HINT_CM  = array(
		'waistRelaxed'   => 45,
		'waistStretched' => 45,
		'hip'            => 55,
		'hemSweep'       => 55,
	);
	public const META_INPUT    = '_curtain_tape_input';
	public const META_ISSUES   = '_curtain_tape_issues';
	public const INVALID_STORE = 'not a valid garment tape: every value needs cm and a provenance, and every size one row';

	/** Chart column that places a size on the line. */
	private const POSITION = array(
		'waistRelaxed'   => 'waist',
		'waistStretched' => 'waist',
		'hip'            => 'hip',
		'hemSweep'       => 'hip',
		'length'         => 'hip',
	);

	// ---- the catalogue (word for word the TypeScript GARMENT_TAPE_MESSAGES / labels) ------------

	public static function field_label( string $field ): string {
		switch ( $field ) {
			case 'waistRelaxed':
				return __( 'A (waistband, relaxed)', 'curtain-woocommerce' );
			case 'waistStretched':
				return __( 'B (waistband, stretched)', 'curtain-woocommerce' );
			case 'hip':
				return __( 'C (hip)', 'curtain-woocommerce' );
			case 'hemSweep':
				return __( 'D (hem)', 'curtain-woocommerce' );
			default:
				return __( 'E (length)', 'curtain-woocommerce' );
		}
	}

	public static function closure_label( string $closure ): string {
		switch ( $closure ) {
			case 'pull-on':
				return __( 'Pull-on (elastic band, nothing to open)', 'curtain-woocommerce' );
			case 'zip':
				return __( 'Zip', 'curtain-woocommerce' );
			case 'button':
				return __( 'Buttons', 'curtain-woocommerce' );
			case 'drawstring':
				return __( 'Drawstring (opens wider when loosened)', 'curtain-woocommerce' );
			case 'wrap':
				return __( 'Wrap', 'curtain-woocommerce' );
			default:
				return __( 'Something else', 'curtain-woocommerce' );
		}
	}

	public static function provenance_label( string $provenance ): string {
		switch ( $provenance ) {
			case 'measured':
				return __( 'measured', 'curtain-woocommerce' );
			case 'interpolated':
				return __( 'estimated', 'curtain-woocommerce' );
			default:
				return __( 'rough estimate', 'curtain-woocommerce' );
		}
	}

	/**
	 * One sentence of the catalogue.
	 *
	 * @param mixed ...$a
	 */
	public static function message( string $code, ...$a ): string {
		switch ( $code ) {
			case 'no_chart':
				return __( 'Add a size chart first: the garment measurements are entered per size of the chart.', 'curtain-woocommerce' );
			case 'unknown_size':
				/* translators: %s: size label */
				return sprintf( __( 'Size %s is not in this product\'s size chart. Use the size labels of the chart.', 'curtain-woocommerce' ), $a[0] );
			case 'duplicate_size':
				/* translators: %s: size label */
				return sprintf( __( 'Size %s is entered twice. Keep one row per size.', 'curtain-woocommerce' ), $a[0] );
			case 'empty_measured':
				/* translators: %1$s: size label (twice) */
				return sprintf( __( 'Size %1$s is marked as measured but has no numbers. Enter its numbers, or untick "measured".', 'curtain-woocommerce' ), $a[0] );
			case 'not_a_number':
				/* translators: %1$s: size label, %2$s: the field, e.g. "C (hip)" */
				return sprintf( __( 'Size %1$s, %2$s: this is not a number. Write centimetres, for example 94 or 94.5.', 'curtain-woocommerce' ), $a[0], 'hipDepth' === $a[1] ? __( 'hip depth below the band', 'curtain-woocommerce' ) : self::field_label( $a[1] ) );
			case 'out_of_range':
				/* translators: %1$s: size label, %2$s: the field, %3$s: the number typed, %4$s: the largest number allowed */
				return sprintf( __( 'Size %1$s, %2$s: %3$s cm is not a garment measurement. Enter a number above 0 and at most %4$s cm.', 'curtain-woocommerce' ), $a[0], self::field_label( $a[1] ), self::fmt( $a[2] ), (string) self::MAX_CM );
			case 'depth_out_of_range':
				/* translators: %1$s: size label, %2$s: the depth typed, %3$s: the largest depth allowed, %4$s: the depth we ask for */
				return sprintf( __( 'Size %1$s: the hip depth below the band (%2$s cm) must be between 0 and %3$s cm. We ask for %4$s cm.', 'curtain-woocommerce' ), $a[0], self::fmt( $a[1] ), (string) self::MAX_DEPTH_CM, (string) self::HIP_DEPTH_CM );
			case 'stretched_below_relaxed':
				/* translators: %1$s: size label, %2$s: stretched band cm, %3$s: relaxed band cm */
				return sprintf( __( 'Size %1$s: the stretched waistband (%2$s cm) is smaller than the relaxed waistband (%3$s cm). Check the two measurements.', 'curtain-woocommerce' ), $a[0], self::fmt( $a[1] ), self::fmt( $a[2] ) );
			case 'unknown_closure':
				return __( 'Choose how the garment closes from the list.', 'curtain-woocommerce' );
			case 'looks_flat':
				/* translators: %1$s: size label, %2$s: the field, %3$s: the number typed */
				return sprintf( __( 'Size %1$s, %2$s: %3$s cm looks like the flat width. Widths are measured flat and then doubled: write the width x 2.', 'curtain-woocommerce' ), $a[0], self::field_label( $a[1] ), self::fmt( $a[2] ) );
			case 'hip_no_depth':
				/* translators: %1$s: size labels, comma separated, %2$s: the depth we ask for */
				return sprintf( __( 'The hip (C) of size %1$s has no distance below the band. A hip number without its distance cannot be compared: write the distance (we ask for %2$s cm).', 'curtain-woocommerce' ), implode( ', ', $a[0] ), (string) self::HIP_DEPTH_CM );
			case 'hip_depth_mixed':
				return __( 'The hip (C) was measured at different distances below the band. The estimated sizes get no hip distance; measure every size at the same distance.', 'curtain-woocommerce' );
			case 'not_bottom':
				/* translators: %s: the product's category */
				return sprintf( __( 'These five numbers are for skirts and trousers with a waistband. This product\'s category is "%s": they are stored, but the size advice uses them only for bottoms.', 'curtain-woocommerce' ), $a[0] );
			case 'no_closure':
				return __( 'Say how the garment closes. For a pull-on garment the stretched waistband (B) has to go over the hips, and the size advice checks that.', 'curtain-woocommerce' );
			case 'pull_on_no_stretch':
				return __( 'This garment is pull-on, but no size has a stretched waistband (B). Without it the size advice cannot check that the garment goes over the hips.', 'curtain-woocommerce' );
			case 'few_sizes':
				$lead = 1 === $a[0]
					? __( 'Only 1 size is', 'curtain-woocommerce' )
					/* translators: %d: number of sizes */
					: sprintf( __( 'Only %d sizes are', 'curtain-woocommerce' ), $a[0] );
				/* translators: %1$s: "Only 2 sizes are", %2$d: number of sizes wanted */
				return sprintf( __( '%1$s measured. Measure at least %2$d: the smallest, the largest and one in between. Every other size is estimated from the measured ones.', 'curtain-woocommerce' ), $lead, $a[1] );
			case 'edge_unmeasured':
				/* translators: %1$s: size label (twice) */
				return sprintf( __( 'Size %1$s lies outside the measured sizes: its numbers are a rough estimate, and the size advice is more careful with it. Measuring size %1$s makes them exact.', 'curtain-woocommerce' ), $a[0] );
			default: // not_increasing.
				/* translators: %1$s: the field, %2$s: larger size, %3$s: its cm, %4$s: smaller size, %5$s: its cm */
				return sprintf( __( '%1$s: size %2$s (%3$s cm) is smaller than size %4$s (%5$s cm). Larger sizes are usually larger; check the numbers.', 'curtain-woocommerce' ), self::field_label( $a[0] ), $a[1], self::fmt( $a[2] ), $a[3], self::fmt( $a[4] ) );
		}
	}

	/**
	 * The form's own words: the TypeScript `GARMENT_TAPE_FORM_TEXT`, word for word (tested).
	 *
	 * @return array<string, string|string[]>
	 */
	public static function form_text(): array {
		return array(
			'heading'             => __( 'Garment measurements', 'curtain-woocommerce' ),
			'intro'               => __( 'Five numbers per size, measured on the garment lying flat. Widths are doubled, all in cm. Measure at least the smallest size, the largest and one in between: we estimate the other sizes and label them for the shopper.', 'curtain-woocommerce' ),
			'howTo'               => __( 'How to measure', 'curtain-woocommerce' ),
			'howToLines'          => array(
				__( 'A: across the top of the waistband as it lies, x 2.', 'curtain-woocommerce' ),
				__( 'B: the same, pulled as far as you would pull it to step in, x 2. A band that does not stretch: the same number as A.', 'curtain-woocommerce' ),
				__( 'C: straight across at the distance below the band given above (we ask for 20 cm), x 2.', 'curtain-woocommerce' ),
				__( 'D: across the hem, spread flat, x 2.', 'curtain-woocommerce' ),
				__( 'E: from the top of the band straight down to the hem, at the centre front. Not doubled.', 'curtain-woocommerce' ),
			),
			'closureLabel'        => __( 'How does it close?', 'curtain-woocommerce' ),
			'closureNone'         => __( 'Choose…', 'curtain-woocommerce' ),
			'hipDepthLabel'       => __( 'Hip (C) measured at this distance below the top of the band (cm)', 'curtain-woocommerce' ),
			'hipDepthPlaceholder' => __( 'e.g. 20', 'curtain-woocommerce' ),
			'sizeColumn'          => __( 'Size', 'curtain-woocommerce' ),
			'measuredColumn'      => __( 'Measured', 'curtain-woocommerce' ),
			'measuredHint'        => __( 'Tick the sizes you measured. Leave the others: we estimate them.', 'curtain-woocommerce' ),
			'notMeasured'         => __( 'not measured', 'curtain-woocommerce' ),
			'noChart'             => __( 'Add a size chart to this product first: the measurements are entered per size of the chart.', 'curtain-woocommerce' ),
			'save'                => __( 'Save measurements', 'curtain-woocommerce' ),
			'saving'              => __( 'Saving…', 'curtain-woocommerce' ),
			'checking'            => __( 'Checking…', 'curtain-woocommerce' ),
			'saved'               => __( 'Saved. Curtain is re-reading the product.', 'curtain-woocommerce' ),
			'nothingToSave'       => __( 'Nothing measured yet.', 'curtain-woocommerce' ),
			'errorsTitle'         => __( 'Fix these before saving:', 'curtain-woocommerce' ),
			'notSaved'            => __( 'The garment measurements were not saved. Fix these and update the product again:', 'curtain-woocommerce' ),
			'warningsTitle'       => __( 'Worth a look (you can still save):', 'curtain-woocommerce' ),
			'legend'              => __( 'measured = your number · estimated = between two measured sizes · rough estimate = beyond the measured sizes', 'curtain-woocommerce' ),
			'privacy'             => __( 'These numbers describe the garment, not a shopper. Shoppers’ measurements never reach you.', 'curtain-woocommerce' ),
		);
	}

	// ---- check and fill -------------------------------------------------------------------------

	/**
	 * Twin of `checkGarmentTapeInput`.
	 *
	 * @param array{category?:mixed, chart:array<int,array<string,mixed>>, closure?:mixed, measured:array<int,array<string,mixed>>} $input
	 * @return array{ok:bool, errors:array<int,array<string,mixed>>, warnings:array<int,array<string,mixed>>, measuredSizes:string[], garmentTape?:array<int,array<string,mixed>>, closure?:string}
	 */
	public static function check( array $input ): array {
		$errors   = array();
		$warnings = array();
		$chart    = array_values(
			array_filter(
				(array) ( $input['chart'] ?? array() ),
				static function ( $r ) {
					return is_array( $r ) && is_string( $r['size'] ?? null ) && '' !== trim( $r['size'] );
				}
			)
		);
		$index    = array();
		// Like the JS Map: the LAST index wins for a duplicate label.
		foreach ( $chart as $i => $r ) {
			$index[ self::key( $r['size'] ) ] = $i;
		}
		$rows = array_values(
			array_filter(
				(array) ( $input['measured'] ?? array() ),
				static function ( $r ) {
					return is_array( $r ) && is_string( $r['size'] ?? null ) && '' !== trim( $r['size'] );
				}
			)
		);

		if ( count( $rows ) > 0 && 0 === count( $chart ) ) {
			$errors[] = self::issue( 'no_chart' );
		}

		$seen = array();
		$kept = array();
		foreach ( $rows as $row ) {
			$size = trim( $row['size'] );
			$k    = self::key( $size );
			if ( count( $chart ) > 0 && ! isset( $index[ $k ] ) ) {
				$errors[] = self::issue( 'unknown_size', $size, null, $size );
				continue;
			}
			if ( isset( $seen[ $k ] ) ) {
				$errors[] = self::issue( 'duplicate_size', $size, null, $size );
				continue;
			}
			$seen[ $k ] = true;
			$values     = array();
			foreach ( self::FIELDS as $f ) {
				if ( array_key_exists( self::INPUT_KEYS[ $f ], $row ) && null !== $row[ self::INPUT_KEYS[ $f ] ] ) {
					$values[] = $f;
				}
			}
			if ( array() === $values ) {
				$errors[] = self::issue( 'empty_measured', $size, null, $size );
				continue;
			}
			$bad = false;
			foreach ( $values as $f ) {
				$v = $row[ self::INPUT_KEYS[ $f ] ];
				if ( ! self::is_num( $v ) ) {
					$errors[] = self::issue( 'not_a_number', $size, $f, $size, $f );
					$bad      = true;
				} elseif ( $v <= 0 || $v > self::MAX_CM ) {
					$errors[] = self::issue( 'out_of_range', $size, $f, $size, $f, $v );
					$bad      = true;
				}
			}
			$depth = $row['hipDepthBelowBandCm'] ?? null;
			if ( null !== $depth ) {
				if ( ! self::is_num( $depth ) ) {
					$errors[] = self::issue( 'not_a_number', $size, 'hipDepth', $size, 'hipDepth' );
					$bad      = true;
				} elseif ( $depth < 0 || $depth > self::MAX_DEPTH_CM ) {
					$errors[] = self::issue( 'depth_out_of_range', $size, 'hipDepth', $size, $depth );
					$bad      = true;
				}
			}
			$a = $row['waistRelaxedCm'] ?? null;
			$b = $row['waistStretchedCm'] ?? null;
			if ( ! $bad && self::is_num( $a ) && self::is_num( $b ) && $b < $a ) {
				$errors[] = self::issue( 'stretched_below_relaxed', $size, 'waistStretched', $size, $b, $a );
				$bad      = true;
			}
			if ( ! $bad ) {
				$row['size'] = count( $chart ) > 0 ? $chart[ $index[ $k ] ]['size'] : $size;
				$kept[]      = array(
					'row' => $row,
					'at'  => $index[ $k ] ?? count( $kept ),
				);
			}
		}

		$closure     = null;
		$raw_closure = $input['closure'] ?? null;
		if ( null !== $raw_closure && '' !== $raw_closure ) {
			if ( is_string( $raw_closure ) && in_array( $raw_closure, self::CLOSURES, true ) ) {
				$closure = $raw_closure;
			} else {
				$errors[] = self::issue( 'unknown_closure', null, 'closure' );
			}
		}

		// ---- warnings ----
		usort(
			$kept,
			static function ( $x, $y ) {
				return $x['at'] <=> $y['at'];
			}
		);
		foreach ( $kept as $item ) {
			$row = $item['row'];
			foreach ( self::FLAT_HINT_CM as $f => $hint ) {
				$v = $row[ self::INPUT_KEYS[ $f ] ] ?? null;
				if ( self::is_num( $v ) && $v < $hint ) {
					$warnings[] = self::issue( 'looks_flat', $row['size'], $f, $row['size'], $f, $v );
				}
			}
		}
		$hips     = array_values(
			array_filter(
				$kept,
				static function ( $item ) {
					return self::is_num( $item['row']['hipCm'] ?? null );
				}
			)
		);
		$no_depth = array();
		$depths   = array();
		foreach ( $hips as $item ) {
			$d = $item['row']['hipDepthBelowBandCm'] ?? null;
			if ( self::is_num( $d ) ) {
				$depths[ (string) (float) $d ] = true;
			} else {
				$no_depth[] = $item['row']['size'];
			}
		}
		if ( $no_depth ) {
			$warnings[] = self::issue( 'hip_no_depth', null, 'hipDepth', $no_depth );
		}
		if ( count( $depths ) > 1 ) {
			$warnings[] = self::issue( 'hip_depth_mixed', null, 'hipDepth' );
		}

		$any      = count( $kept ) > 0;
		$category = is_string( $input['category'] ?? null ) ? trim( $input['category'] ) : '';
		if ( $any && '' !== $category && 'bottom' !== $category ) {
			$warnings[] = self::issue( 'not_bottom', null, null, $category );
		}
		$unknown_closure = false;
		foreach ( $errors as $e ) {
			if ( 'unknown_closure' === $e['code'] ) {
				$unknown_closure = true;
			}
		}
		if ( $any && null === $closure && ! $unknown_closure ) {
			$warnings[] = self::issue( 'no_closure', null, 'closure' );
		}
		if ( 'pull-on' === $closure && $any ) {
			$stretch = false;
			foreach ( $kept as $item ) {
				if ( self::is_num( $item['row']['waistStretchedCm'] ?? null ) ) {
					$stretch = true;
				}
			}
			if ( ! $stretch ) {
				$warnings[] = self::issue( 'pull_on_no_stretch', null, 'waistStretched' );
			}
		}
		if ( $any && count( $chart ) > 0 ) {
			$want = min( 3, count( $chart ) );
			if ( count( $kept ) < $want ) {
				$warnings[] = self::issue( 'few_sizes', null, null, count( $kept ), $want );
			}
			$measured_keys = array();
			foreach ( $kept as $item ) {
				$measured_keys[ self::key( $item['row']['size'] ) ] = true;
			}
			$edges = count( $chart ) > 1 ? array( $chart[0], $chart[ count( $chart ) - 1 ] ) : array();
			foreach ( $edges as $edge ) {
				if ( ! isset( $measured_keys[ self::key( $edge['size'] ) ] ) ) {
					$warnings[] = self::issue( 'edge_unmeasured', $edge['size'], null, $edge['size'] );
				}
			}
			foreach ( self::FIELDS as $f ) {
				$prev = null;
				foreach ( $kept as $item ) {
					$row = $item['row'];
					$v   = $row[ self::INPUT_KEYS[ $f ] ] ?? null;
					if ( ! self::is_num( $v ) ) {
						continue;
					}
					$u = null === $prev ? null : ( $prev[ self::INPUT_KEYS[ $f ] ] ?? null );
					if ( null !== $prev && self::is_num( $u ) && $v < $u ) {
						$warnings[] = self::issue( 'not_increasing', $row['size'], $f, $f, $row['size'], $v, $prev['size'], $u );
					}
					$prev = $row;
				}
			}
		}

		$ok  = array() === $errors;
		$out = array(
			'ok'            => $ok,
			'errors'        => $errors,
			// Warnings only once there is no error (see the TypeScript check).
			'warnings'      => $ok ? $warnings : array(),
			'measuredSizes' => array_map(
				static function ( $item ) {
					return $item['row']['size'];
				},
				$kept
			),
		);
		if ( null !== $closure ) {
			$out['closure'] = $closure;
		}
		if ( $ok && $any && count( $chart ) > 0 ) {
			$tape = self::fill(
				$chart,
				array_map(
					static function ( $item ) {
						return self::clean_row( $item['row'] );
					},
					$kept
				)
			);
			if ( $tape ) {
				$out['garmentTape'] = $tape;
			}
		}
		return $out;
	}

	/**
	 * Twin of `fillGarmentTape`. Throws \RangeException when a measured size has its stretched band
	 * below its relaxed band.
	 *
	 * @param array<int,array<string,mixed>> $chart
	 * @param array<int,array<string,mixed>> $measured
	 * @return array<int,array<string,mixed>>
	 */
	public static function fill( array $chart, array $measured ): array {
		$by = array();
		foreach ( $measured as $row ) {
			if ( is_array( $row ) && is_string( $row['size'] ?? null ) ) {
				$by[ self::key( $row['size'] ) ] = $row;
			}
		}
		foreach ( $chart as $c ) {
			$m = $by[ self::key( (string) $c['size'] ) ] ?? null;
			if ( $m && self::is_pos( $m['waistRelaxedCm'] ?? null ) && self::is_pos( $m['waistStretchedCm'] ?? null ) && $m['waistStretchedCm'] < $m['waistRelaxedCm'] ) {
				throw new \RangeException( self::message( 'stretched_below_relaxed', (string) $c['size'], $m['waistStretchedCm'], $m['waistRelaxedCm'] ) );
			}
		}
		$columns = array();
		foreach ( self::FIELDS as $f ) {
			$columns[ $f ] = self::fill_field( $chart, $by, $f );
		}
		$depths = array();
		foreach ( $chart as $c ) {
			$m = $by[ self::key( (string) $c['size'] ) ] ?? null;
			if ( null !== $m && self::is_pos( $m['hipCm'] ?? null ) ) {
				$depths[] = $m['hipDepthBelowBandCm'] ?? null;
			}
		}
		$shared = null;
		if ( $depths ) {
			$all = true;
			foreach ( $depths as $d ) {
				if ( ! self::is_num( $d ) || $d < 0 || (float) $d !== (float) $depths[0] ) {
					$all = false;
				}
			}
			$shared = $all ? $depths[0] : null;
		}

		$out = array();
		foreach ( $chart as $i => $c ) {
			$row      = array( 'size' => $c['size'] );
			$relaxed  = $columns['waistRelaxed'][ $i ];
			$stretched = $columns['waistStretched'][ $i ];
			if ( $relaxed && $stretched && $stretched['cm'] < $relaxed['cm'] ) {
				$relaxed   = null;
				$stretched = null;
			}
			if ( $relaxed ) {
				$row['waistRelaxed'] = $relaxed;
			}
			if ( $stretched ) {
				$row['waistStretched'] = $stretched;
			}
			$hip = $columns['hip'][ $i ];
			if ( $hip ) {
				$own   = $by[ self::key( (string) $c['size'] ) ]['hipDepthBelowBandCm'] ?? null;
				$depth = 'measured' === $hip['provenance'] ? $own : $shared;
				if ( self::is_num( $depth ) && $depth >= 0 ) {
					$hip['depthBelowBandCm'] = self::num( $depth );
				}
				$row['hip'] = $hip;
			}
			if ( $columns['hemSweep'][ $i ] ) {
				$row['hemSweep'] = $columns['hemSweep'][ $i ];
			}
			if ( $columns['length'][ $i ] ) {
				$row['length'] = $columns['length'][ $i ];
			}
			if ( count( $row ) > 1 ) {
				$out[] = $row;
			}
		}
		return $out;
	}

	/**
	 * @param array<int,array<string,mixed>>  $chart
	 * @param array<string,array<string,mixed>> $by
	 * @return array<int, array{cm:int|float, provenance:string}|null>
	 */
	private static function fill_field( array $chart, array $by, string $field ): array {
		$point    = self::POSITION[ $field ];
		$by_chart = true;
		foreach ( $chart as $c ) {
			if ( ! self::is_pos( $c[ $point ] ?? null ) ) {
				$by_chart = false;
			}
		}
		$x     = static function ( int $i ) use ( $by_chart, $chart, $point ) {
			return $by_chart ? (float) $chart[ $i ][ $point ] : (float) $i;
		};
		$known = array();
		foreach ( $chart as $i => $c ) {
			$v = $by[ self::key( (string) $c['size'] ) ][ self::INPUT_KEYS[ $field ] ] ?? null;
			if ( self::is_pos( $v ) ) {
				$known[] = array(
					'i' => $i,
					'v' => $v,
				);
			}
		}
		$out = array();
		foreach ( $chart as $i => $c ) {
			if ( ! $known ) {
				$out[] = null;
				continue;
			}
			$own = null;
			foreach ( $known as $k ) {
				if ( $k['i'] === $i ) {
					$own = $k;
				}
			}
			if ( null !== $own ) {
				$out[] = array(
					'cm'         => self::num( $own['v'] ),
					'provenance' => 'measured',
				);
				continue;
			}
			if ( 1 === count( $known ) ) {
				if ( 'waistRelaxed' !== $field && 'waistStretched' !== $field ) {
					$out[] = null;
					continue;
				}
				$k          = $known[0];
				$cm         = self::round1( $k['v'] + ( $by_chart ? $x( $i ) - $x( $k['i'] ) : 0 ) );
				$provenance = 'extrapolated';
			} else {
				$below = array_values(
					array_filter(
						$known,
						static function ( $k ) use ( $i ) {
							return $k['i'] < $i;
						}
					)
				);
				$above = array_values(
					array_filter(
						$known,
						static function ( $k ) use ( $i ) {
							return $k['i'] > $i;
						}
					)
				);
				$between = $below && $above;
				if ( $between ) {
					$a = $below[ count( $below ) - 1 ];
					$b = $above[0];
				} elseif ( $below ) {
					$a = $below[ count( $below ) - 2 ];
					$b = $below[ count( $below ) - 1 ];
				} else {
					$a = $above[0];
					$b = $above[1];
				}
				$span       = $x( $b['i'] ) - $x( $a['i'] );
				$cm         = 0.0 === $span ? $a['v'] : self::round1( $a['v'] + ( ( $b['v'] - $a['v'] ) * ( $x( $i ) - $x( $a['i'] ) ) ) / $span );
				$provenance = $between ? 'interpolated' : 'extrapolated';
			}
			$out[] = self::is_pos( $cm ) ? array(
				'cm'         => self::num( $cm ),
				'provenance' => $provenance,
			) : null;
		}
		return $out;
	}

	/**
	 * Twin of `measuredFromGarmentTape`: what the shop typed, back from a stored tape.
	 *
	 * @param mixed $tape
	 * @return array<int,array<string,mixed>>
	 */
	public static function measured_from_tape( $tape ): array {
		$out = array();
		foreach ( is_array( $tape ) ? $tape : array() as $row ) {
			$m = array( 'size' => $row['size'] );
			foreach ( self::FIELDS as $f ) {
				$v = $row[ $f ] ?? null;
				if ( is_array( $v ) && 'measured' === ( $v['provenance'] ?? null ) ) {
					$m[ self::INPUT_KEYS[ $f ] ] = $v['cm'];
				}
			}
			if ( 'measured' === ( $row['hip']['provenance'] ?? null ) && isset( $row['hip']['depthBelowBandCm'] ) ) {
				$m['hipDepthBelowBandCm'] = $row['hip']['depthBelowBandCm'];
			}
			if ( count( $m ) > 1 ) {
				$out[] = $m;
			}
		}
		return $out;
	}

	/**
	 * Twin of `refillGarmentTape`.
	 *
	 * @param array<int,array<string,mixed>> $chart
	 * @param array<int,array<string,mixed>> $tape
	 * @return array{garmentTape: array<int,array<string,mixed>>|null, droppedSizes: string[]}
	 */
	public static function refill( array $chart, array $tape ): array {
		$labels = array();
		foreach ( $chart as $c ) {
			$labels[ self::key( (string) $c['size'] ) ] = true;
		}
		$dropped = array();
		$kept    = array();
		foreach ( $tape as $row ) {
			if ( isset( $labels[ self::key( (string) $row['size'] ) ] ) ) {
				$kept[] = $row;
			} else {
				$dropped[] = (string) $row['size'];
			}
		}
		$measured = self::measured_from_tape( $kept );
		if ( ! $measured ) {
			return array(
				'garmentTape'  => null,
				'droppedSizes' => $dropped,
			);
		}
		try {
			$filled = self::fill( $chart, $measured );
		} catch ( \RangeException $e ) {
			$filled = array();
		}
		return array(
			'garmentTape'  => $filled ? $filled : null,
			'droppedSizes' => $dropped,
		);
	}

	/**
	 * `GarmentTapeSchema.safeParse` in PHP: the parsed tape (unknown keys dropped) or null.
	 *
	 * @param mixed $v
	 * @return array<int,array<string,mixed>>|null
	 */
	public static function parse_stored( $v ): ?array {
		if ( ! is_array( $v ) || ! array_is_list( $v ) || count( $v ) < 1 || count( $v ) > 30 ) {
			return null;
		}
		$out  = array();
		$seen = array();
		foreach ( $v as $row ) {
			if ( ! is_array( $row ) || array_is_list( $row ) && array() !== $row ) {
				return null;
			}
			$size = $row['size'] ?? null;
			if ( ! is_string( $size ) || '' === $size || ( function_exists( 'mb_strlen' ) ? mb_strlen( $size ) : strlen( $size ) ) > 16 ) {
				return null;
			}
			$k = self::key( $size );
			if ( isset( $seen[ $k ] ) ) {
				return null;
			}
			$seen[ $k ] = true;
			$r          = array( 'size' => $size );
			foreach ( self::FIELDS as $f ) {
				if ( ! array_key_exists( $f, $row ) ) {
					continue;
				}
				$val = $row[ $f ];
				if ( ! is_array( $val ) || ! self::is_num( $val['cm'] ?? null ) || $val['cm'] <= 0 || $val['cm'] > self::MAX_CM || ! in_array( $val['provenance'] ?? null, self::PROVENANCES, true ) ) {
					return null;
				}
				$clean = array(
					'cm'         => self::num( $val['cm'] ),
					'provenance' => $val['provenance'],
				);
				if ( 'hip' === $f && array_key_exists( 'depthBelowBandCm', $val ) ) {
					$d = $val['depthBelowBandCm'];
					if ( ! self::is_num( $d ) || $d < 0 || $d > self::MAX_DEPTH_CM ) {
						return null;
					}
					$clean['depthBelowBandCm'] = self::num( $d );
				}
				$r[ $f ] = $clean;
			}
			if ( isset( $r['waistRelaxed'], $r['waistStretched'] ) && $r['waistStretched']['cm'] < $r['waistRelaxed']['cm'] ) {
				return null;
			}
			$out[] = $r;
		}
		return $out;
	}

	// ---- helpers ---------------------------------------------------------------------------------

	/**
	 * @param mixed ...$args Message arguments.
	 * @return array<string,mixed>
	 */
	private static function issue( string $code, ?string $size = null, ?string $field = null, ...$args ): array {
		$out = array( 'code' => $code );
		if ( null !== $size ) {
			$out['size'] = $size;
		}
		if ( null !== $field ) {
			$out['field'] = $field;
		}
		$out['message'] = self::message( $code, ...$args );
		return $out;
	}

	/** @param array<string,mixed> $row @return array<string,mixed> */
	private static function clean_row( array $row ): array {
		$out = array( 'size' => $row['size'] );
		foreach ( self::FIELDS as $f ) {
			$v = $row[ self::INPUT_KEYS[ $f ] ] ?? null;
			if ( self::is_num( $v ) ) {
				$out[ self::INPUT_KEYS[ $f ] ] = $v;
			}
		}
		if ( self::is_num( $row['hipDepthBelowBandCm'] ?? null ) ) {
			$out['hipDepthBelowBandCm'] = $row['hipDepthBelowBandCm'];
		}
		return $out;
	}

	public static function key( string $s ): string {
		$t = trim( $s );
		return function_exists( 'mb_strtoupper' ) ? mb_strtoupper( $t ) : strtoupper( $t );
	}

	/** @param mixed $v */
	public static function is_num( $v ): bool {
		return ( is_int( $v ) || is_float( $v ) ) && is_finite( (float) $v );
	}

	/** @param mixed $v */
	private static function is_pos( $v ): bool {
		return self::is_num( $v ) && $v > 0;
	}

	/** JavaScript's Math.round(v * 10) / 10. */
	private static function round1( float $v ): float {
		return floor( $v * 10 + 0.5 ) / 10;
	}

	/** Integers stay ints in JSON (105, not 105.0). @param int|float $n @return int|float */
	public static function num( $n ) {
		$f = (float) $n;
		return ( floor( $f ) === $f && abs( $f ) < PHP_INT_MAX ) ? (int) $f : $f;
	}

	/** A number as JavaScript's String() prints it. @param mixed $v */
	public static function fmt( $v ): string {
		if ( ! self::is_num( $v ) ) {
			return 'NaN';
		}
		$n = self::num( $v );
		return is_int( $n ) ? (string) $n : (string) json_encode( $n );
	}
}
