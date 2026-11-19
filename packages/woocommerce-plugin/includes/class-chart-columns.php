<?php
/**
 * The men's size chart columns in the meta box (men-3d-plan slice M2): PHP twin of
 * @curtain/schema chartColumns.ts. `wl_axes_from_label` reads a waist/leg label ("32/34",
 * "W32/L34", "32x34"); `check` is the plain-English check before a chart is saved (W/L labels and
 * pairs, the sleeve measuring point, plausible ranges). tests/chart-columns.test.php replays the
 * shared cases (`CHART_COLUMN_CASES`) and must give the same errors and warnings, word for word.
 *
 * @package Curtain
 */

declare(strict_types=1);

namespace Curtain;

defined( 'ABSPATH' ) || exit;

final class Chart_Columns {

	/** Men's columns, in table order (MENS_CHART_COLUMNS). */
	public const COLUMNS = array( 'neck', 'sleeve', 'length', 'rise' );

	/** Plausible ranges in cm [A] (MENS_COLUMN_RANGES, SLEEVE_RANGES). */
	public const RANGES       = array(
		'neck'   => array( 30, 55 ),
		'sleeve' => array( 10, 100 ),
		'length' => array( 45, 100 ),
		'rise'   => array( 15, 45 ),
	);
	public const SLEEVE_RANGES = array(
		'shoulder_point' => array( 10, 75 ),
		'centre_back'    => array( 35, 100 ),
	);

	private const WL_LABEL = '/^\s*W?\s*(\d{2})\s*[\/xX]\s*L?\s*(\d{2})\s*$/i';

	/** @return array{waist:string,leg:string}|null */
	public static function wl_axes_from_label( string $label ): ?array {
		return 1 === preg_match( self::WL_LABEL, $label, $m ) ? array(
			'waist' => $m[1],
			'leg'   => $m[2],
		) : null;
	}

	/**
	 * Rows of a W/L chart with `axes` read from each label (a row that has axes keeps them).
	 *
	 * @param array<int,array<string,mixed>> $rows
	 * @return array<int,array<string,mixed>>
	 */
	public static function with_wl_axes( array $rows ): array {
		$out = array();
		foreach ( $rows as $r ) {
			if ( ! isset( $r['axes'] ) ) {
				$axes = self::wl_axes_from_label( (string) ( $r['size'] ?? '' ) );
				if ( null !== $axes ) {
					$r['axes'] = $axes;
				}
			}
			$out[] = $r;
		}
		return $out;
	}

	/**
	 * Same rules and words as checkChartColumns.
	 *
	 * @param array{sizeChartType?:?string, sizeChart?:array<int,array<string,mixed>>, sleeveConvention?:mixed, wl?:bool} $input
	 * @return array{errors: string[], warnings: string[]}
	 */
	public static function check( array $input ): array {
		$errors   = array();
		$warnings = array();
		$rows     = is_array( $input['sizeChart'] ?? null ) ? array_values( $input['sizeChart'] ) : array();
		$type     = $input['sizeChartType'] ?? null;

		if ( ! empty( $input['wl'] ) ) {
			foreach ( $rows as $r ) {
				if ( ! isset( $r['axes'] ) ) {
					/* translators: %s: size label */
					$errors[] = sprintf( __( 'Size %s is not a waist/leg size: write it as waist/leg, for example 32/34.', 'curtain-woocommerce' ), (string) $r['size'] );
				}
			}
		} else {
			$with = count( array_filter( $rows, static fn ( $r ) => isset( $r['axes'] ) ) );
			if ( $with > 0 && $with < count( $rows ) ) {
				$errors[] = __( 'Either every size has a waist and a leg (for example 32/34) or none has.', 'curtain-woocommerce' );
			}
		}
		$pairs = array();
		foreach ( $rows as $r ) {
			if ( ! isset( $r['axes'] ) || ! is_array( $r['axes'] ) ) {
				continue;
			}
			$w   = (string) ( $r['axes']['waist'] ?? '' );
			$l   = (string) ( $r['axes']['leg'] ?? '' );
			$key = Schema_Validator::size_label_key( $w ) . "\0" . Schema_Validator::size_label_key( $l );
			if ( isset( $pairs[ $key ] ) ) {
				/* translators: 1: waist label, 2: leg label, 3: first size, 4: second size */
				$errors[] = sprintf( __( 'Waist %1$s with leg %2$s appears twice (sizes %3$s and %4$s).', 'curtain-woocommerce' ), $w, $l, $pairs[ $key ], (string) $r['size'] );
			} else {
				$pairs[ $key ] = (string) $r['size'];
			}
		}

		$has_sleeve = false;
		foreach ( $rows as $r ) {
			if ( isset( $r['sleeve'] ) && is_numeric( $r['sleeve'] ) ) {
				$has_sleeve = true;
			}
		}
		$conv  = $input['sleeveConvention'] ?? null;
		$known = is_string( $conv ) && in_array( $conv, Vocab::SLEEVE_CONVENTIONS, true ) ? $conv : null;
		if ( null !== $conv && '' !== $conv && null === $known ) {
			/* translators: %s: what the merchant entered */
			$errors[] = sprintf( __( "Unknown sleeve measuring point '%s': choose the shoulder seam or the centre back of the neck.", 'curtain-woocommerce' ), (string) $conv );
		} elseif ( $has_sleeve && 'garment' === $type && null === $known ) {
			$errors[] = __( 'The chart has a sleeve column: say where the sleeve is measured from, the shoulder seam or the centre back of the neck.', 'curtain-woocommerce' );
		}

		foreach ( $rows as $r ) {
			foreach ( self::COLUMNS as $col ) {
				if ( ! isset( $r[ $col ] ) || ! is_numeric( $r[ $col ] ) ) {
					continue;
				}
				$v        = $r[ $col ] + 0;
				list( $lo, $hi ) = 'sleeve' === $col && null !== $known && 'garment' === $type ? self::SLEEVE_RANGES[ $known ] : self::RANGES[ $col ];
				if ( $v < $lo || $v > $hi ) {
					/* translators: 1: size label, 2: column (neck, sleeve, length, rise), 3: value in cm, 4: lowest usual value, 5: highest usual value */
					$warnings[] = sprintf( __( 'Size %1$s: %2$s %3$s cm is outside the usual %4$s–%5$s cm.', 'curtain-woocommerce' ), (string) $r['size'], $col, self::num( $v ), (string) $lo, (string) $hi );
				}
			}
		}
		return array(
			'errors'   => $errors,
			'warnings' => $warnings,
		);
	}

	/** 42, 42.5 as JavaScript's String(n) prints them. @param int|float $v */
	private static function num( $v ): string {
		if ( is_float( $v ) && floor( $v ) === $v && abs( $v ) < 1e15 ) {
			return (string) (int) $v;
		}
		return (string) $v;
	}
}
