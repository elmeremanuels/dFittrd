<?php
/**
 * Turns the product meta box POST (`$_POST['curtain']`, already wp_unslash'ed) into the
 * `_curtain_*` meta rows, in exactly the formats @curtain/schema's `fromWooMeta` reads:
 * JSON strings for json/list kinds, plain strings for scalars, an absolute URL for the flat-lay
 * (+ the attachment id in a private key). A `null` value means "delete the meta".
 *
 * Only `sanitize_text_field`/`sanitize_textarea_field`/`absint`/`wp_json_encode` are used, so the
 * class runs under the test shims.
 *
 * @package Curtain
 */

declare(strict_types=1);

namespace Curtain;

defined( 'ABSPATH' ) || exit;

final class Sanitizer {

	public const CUSTOM_PATTERN_BLOCK = '__custom';

	/**
	 * @param array<string,mixed> $in  The `curtain` POST array.
	 * @return array{meta: array<string, string|null>, errors: string[]}
	 */
	public static function from_post( array $in ): array {
		$meta   = array();
		$errors = array();

		// -- category / subcategory / brand -------------------------------------------------
		$category = self::text( $in['category'] ?? '' );
		if ( '' !== $category && ! in_array( $category, Vocab::CATEGORIES, true ) ) {
			$errors[] = 'category';
			$category = '';
		}
		$meta['_curtain_category']    = self::or_null( $category );
		$meta['_curtain_subcategory'] = self::or_null( self::text( $in['subcategory'] ?? '', 64 ) );
		$meta['_curtain_brand']       = self::or_null( self::text( $in['brand'] ?? '', 120 ) );

		// -- pattern block --------------------------------------------------------------------
		$block = self::text( $in['pattern_block'] ?? '' );
		if ( self::CUSTOM_PATTERN_BLOCK === $block ) {
			$block = self::text( $in['pattern_block_custom'] ?? '', 64 );
		}
		$meta['_curtain_pattern_block'] = self::or_null( strtolower( $block ) );

		// -- fabric --------------------------------------------------------------------------
		$fabric  = array();
		$primary = strtolower( self::text( $in['fabric_primary'] ?? '', 64 ) );
		if ( '' !== $primary ) {
			$fabric['primary'] = $primary;
		}
		$blend = array();
		foreach ( (array) ( $in['fabric_blend'] ?? array() ) as $row ) {
			if ( ! is_array( $row ) ) {
				continue;
			}
			$fibre = strtolower( self::text( $row['fibre'] ?? '', 64 ) );
			$pct   = self::number( $row['pct'] ?? '' );
			if ( '' !== $fibre && null !== $pct ) {
				if ( $pct < 0 || $pct > 100 ) {
					$errors[] = 'fabric.blend';
					continue;
				}
				$blend[] = array( $fibre, $pct );
			}
		}
		if ( $blend ) {
			$fabric['blend'] = array_slice( $blend, 0, 8 );
		}
		foreach ( array( 'weightGsm' => 'fabric_weight_gsm', 'stretchPct' => 'fabric_stretch_pct', 'drape' => 'fabric_drape', 'opacity' => 'fabric_opacity', 'sheen' => 'fabric_sheen' ) as $key => $field ) {
			$n = self::number( $in[ $field ] ?? '' );
			if ( null !== $n ) {
				$fabric[ $key ] = $n;
			}
		}
		foreach ( array( 'drape', 'opacity', 'sheen' ) as $unit ) {
			if ( isset( $fabric[ $unit ] ) && ( $fabric[ $unit ] < 0 || $fabric[ $unit ] > 1 ) ) {
				$errors[]         = 'fabric.' . $unit;
				$fabric[ $unit ] = max( 0, min( 1, $fabric[ $unit ] ) );
			}
		}
		$meta['_curtain_fabric'] = $fabric ? self::json( $fabric ) : null;

		// -- ease -----------------------------------------------------------------------------
		$ease = array();
		foreach ( Vocab::FIT_POINTS as $point ) {
			$n = self::number( $in['ease'][ $point ] ?? '' );
			if ( null !== $n ) {
				$ease[ $point ] = $n;
			}
		}
		$meta['_curtain_ease'] = $ease ? self::json( $ease ) : null;

		// -- lengths --------------------------------------------------------------------------
		$lengths = array();
		foreach ( Vocab::LENGTH_KEYS as $key ) {
			$n = self::number( $in['length'][ $key ] ?? '' );
			if ( null !== $n ) {
				$lengths[ $key ] = $n;
			}
		}
		foreach ( (array) ( $in['length_custom'] ?? array() ) as $row ) {
			if ( ! is_array( $row ) ) {
				continue;
			}
			$key = preg_replace( '/[\s-]+/', '_', strtolower( self::text( $row['key'] ?? '', 64 ) ) );
			$key = preg_replace( '/[^a-z0-9_]/', '', (string) $key );
			$n   = self::number( $row['value'] ?? '' );
			if ( '' !== $key && null !== $n ) {
				$lengths[ $key ] = $n;
			}
		}
		$meta['_curtain_length_cm'] = $lengths ? self::json( $lengths ) : null;

		// -- size chart -----------------------------------------------------------------------
		$rows = array();
		foreach ( (array) ( $in['size_chart'] ?? array() ) as $row ) {
			if ( ! is_array( $row ) ) {
				continue;
			}
			$size = self::text( $row['size'] ?? '', 16 );
			if ( '' === $size ) {
				continue;
			}
			$r = array( 'size' => $size );
			foreach ( Vocab::SIZE_ROW_COLUMNS as $col ) {
				if ( 'size' === $col ) {
					continue;
				}
				$n = self::number( $row[ $col ] ?? '' );
				if ( null !== $n && $n > 0 ) { // 0 / empty = not provided (contract: fit engine omits the point).
					$r[ $col ] = $n;
				}
			}
			$rows[] = $r;
		}
		$meta['_curtain_size_chart'] = $rows ? self::json( array_slice( $rows, 0, 30 ) ) : null;

		$sct = self::text( $in['size_chart_type'] ?? '' );
		if ( '' !== $sct && ! in_array( $sct, array( 'garment', 'body' ), true ) ) {
			$errors[] = 'sizeChartType';
			$sct      = '';
		}
		if ( $rows && '' === $sct ) {
			$errors[] = 'sizeChartType'; // Required whenever a chart is present (T14).
		}
		$meta['_curtain_size_chart_type'] = self::or_null( $sct );

		// -- notes / score --------------------------------------------------------------------
		$meta['_curtain_sizing_notes'] = self::or_null( self::textarea( $in['sizing_notes'] ?? '', 500 ) );
		$tts                            = self::number( $in['true_to_size_score'] ?? '' );
		if ( null !== $tts && ( $tts < 0 || $tts > 1 ) ) {
			$errors[] = 'trueToSizeScore';
			$tts      = null;
		}
		$meta['_curtain_true_to_size_score'] = null === $tts ? null : self::num_string( $tts );

		// -- fit points / stretch zones -------------------------------------------------------
		$critical = array();
		foreach ( (array) ( $in['critical_fit_points'] ?? array() ) as $p ) {
			$p = self::text( $p );
			if ( in_array( $p, Vocab::FIT_POINTS, true ) && ! in_array( $p, $critical, true ) ) {
				$critical[] = $p;
			}
		}
		$meta['_curtain_critical_fit_points'] = $critical ? self::json( $critical ) : null;

		$zones = array();
		foreach ( (array) ( $in['stretch_zones'] ?? array() ) as $z ) {
			$z = strtolower( self::text( $z, 64 ) );
			if ( '' !== $z && ! in_array( $z, $zones, true ) ) {
				$zones[] = $z;
			}
		}
		foreach ( preg_split( '/[,|;\n]/', self::text( $in['stretch_zones_other'] ?? '', 400 ) ) ?: array() as $z ) {
			$z = strtolower( trim( $z ) );
			if ( '' !== $z && strlen( $z ) <= 64 && ! in_array( $z, $zones, true ) ) {
				$zones[] = $z;
			}
		}
		$meta['_curtain_stretch_zones'] = $zones ? self::json( array_slice( $zones, 0, 10 ) ) : null;

		// -- style tags -----------------------------------------------------------------------
		$tags = array();
		foreach ( Vocab::TASTE_AXES as $axis ) {
			$n = self::number( $in['style_tags'][ $axis ] ?? '' );
			if ( null !== $n ) {
				$tags[ $axis ] = max( 0, min( 1, $n ) );
			}
		}
		$meta['_curtain_style_tags'] = $tags ? self::json( $tags ) : null;

		// -- colours --------------------------------------------------------------------------
		$hex = Payload_Builder::coerce_hex( self::text( $in['primary_color_hex'] ?? '', 7 ) );
		if ( null === $hex && '' !== self::text( $in['primary_color_hex'] ?? '' ) ) {
			$errors[] = 'primaryColorHex';
		}
		$meta['_curtain_primary_color_hex'] = $hex;

		$colorways = array();
		foreach ( (array) ( $in['colorways'] ?? array() ) as $row ) {
			if ( ! is_array( $row ) ) {
				continue;
			}
			$name = self::text( $row['name'] ?? '', 64 );
			$chex = Payload_Builder::coerce_hex( self::text( $row['hex'] ?? '', 7 ) );
			if ( '' === $name && null === $chex ) {
				continue;
			}
			if ( '' === $name || null === $chex ) {
				$errors[] = 'colorways';
				continue;
			}
			$cw = array(
				'name' => $name,
				'hex'  => $chex,
			);
			$sku = self::text( $row['sku'] ?? '', 64 );
			if ( '' !== $sku ) {
				$cw['sku'] = $sku;
			}
			$colorways[] = $cw;
		}
		$meta['_curtain_colorways'] = $colorways ? self::json( array_slice( $colorways, 0, 40 ) ) : null;

		// -- flat-lay -------------------------------------------------------------------------
		$flat_id  = absint( $in['flat_lay_id'] ?? 0 );
		$flat_url = Payload_Builder::coerce_url( self::text( $in['flat_lay_url'] ?? '', 2048 ) );
		$meta[ Vocab::META_FLAT_LAY_ID ]   = $flat_id > 0 ? (string) $flat_id : null;
		$meta['_curtain_flat_lay_photo']  = $flat_url;

		return array(
			'meta'   => $meta,
			'errors' => array_values( array_unique( $errors ) ),
		);
	}

	/** @param mixed $v */
	private static function text( $v, int $max = 200 ): string {
		if ( is_array( $v ) || is_object( $v ) ) {
			return '';
		}
		$s = sanitize_text_field( (string) $v );
		return function_exists( 'mb_substr' ) ? mb_substr( $s, 0, $max ) : substr( $s, 0, $max );
	}

	/** @param mixed $v */
	private static function textarea( $v, int $max ): string {
		if ( is_array( $v ) || is_object( $v ) ) {
			return '';
		}
		$s = sanitize_textarea_field( (string) $v );
		return function_exists( 'mb_substr' ) ? mb_substr( $s, 0, $max ) : substr( $s, 0, $max );
	}

	/** Decimal comma tolerant. @param mixed $v @return int|float|null */
	private static function number( $v ) {
		if ( is_array( $v ) || is_object( $v ) || is_bool( $v ) ) {
			return null;
		}
		$s = str_replace( ',', '.', trim( (string) $v ) );
		if ( '' === $s || ! is_numeric( $s ) ) {
			return null;
		}
		$f = (float) $s;
		if ( ! is_finite( $f ) ) {
			return null; // "1e999" is INF: json_encode() would fail and drop the whole field.
		}
		return ( floor( $f ) === $f && abs( $f ) < PHP_INT_MAX ) ? (int) $f : $f;
	}

	/** @param int|float $n */
	private static function num_string( $n ): string {
		return is_int( $n ) ? (string) $n : rtrim( rtrim( sprintf( '%.6F', $n ), '0' ), '.' );
	}

	private static function or_null( string $s ): ?string {
		return '' === $s ? null : $s;
	}

	/** @param mixed $v */
	private static function json( $v ): string {
		return (string) wp_json_encode( $v, JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE );
	}
}
