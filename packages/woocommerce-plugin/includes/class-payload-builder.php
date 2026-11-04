<?php
/**
 * Builds a GarmentPayload v1 draft from a WooCommerce product snapshot plus the `_paskamer_*`
 * post meta. This is the PHP twin of `fromWooMeta` in @paskamer/schema (mappings/woo.ts): the
 * same key list, the same lenient coercions and the same fallbacks (brand from attribute /
 * brand taxonomy / shop name, category inferred from WooCommerce categories, EUR-only price).
 *
 * Pure PHP: the product snapshot is a plain array (see Product_Snapshot for the WooCommerce
 * side), so the builder is unit-tested without WordPress.
 *
 * @package Paskamer
 */

declare(strict_types=1);

namespace Paskamer;

defined('ABSPATH') || defined('PASKAMER_TESTING') || exit;

final class Payload_Builder {

	/** @var array<int, array{source:string,path:string,message:string}> */
	private array $warnings = array();

	/**
	 * @param array<string,mixed> $product Snapshot: id, name, permalink, price, regular_price, currency,
	 *                                     images[{src,alt}], categories[{name,slug}], brands[{name}],
	 *                                     attributes[{name,slug,options[]}].
	 * @param array<string,mixed> $meta    `_paskamer_*` meta (keys with or without the prefix; values as
	 *                                     stored: JSON strings, scalars, or decoded arrays).
	 * @param array<string,mixed> $opts    currency (fallback for the snapshot), default_brand.
	 * @return array{payload: array<string,mixed>, warnings: array<int, array{source:string,path:string,message:string}>}
	 */
	public static function build( array $product, array $meta, array $opts = array() ): array {
		$b = new self();
		return array(
			'payload'  => $b->run( $product, $meta, $opts ),
			'warnings' => $b->warnings,
		);
	}

	/**
	 * sha256 over the canonical (sorted-key) JSON of a payload: used to skip pushes when nothing changed.
	 *
	 * @param array<string,mixed> $payload
	 */
	public static function hash( array $payload ): string {
		return hash( 'sha256', (string) json_encode( self::sort_keys( $payload ), JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE ) );
	}

	/**
	 * Heavy fields (backend completeness.ts) missing from a payload → status can never be 'active'.
	 *
	 * @param array<string,mixed> $payload
	 * @return string[]
	 */
	public static function missing_heavy_fields( array $payload ): array {
		$missing = array();
		foreach ( Vocab::HEAVY_FIELDS as $field ) {
			$node = $payload;
			foreach ( explode( '.', $field ) as $seg ) {
				if ( ! is_array( $node ) || ! array_key_exists( $seg, $node ) ) {
					$node = null;
					break;
				}
				$node = $node[ $seg ];
			}
			if ( null === $node || '' === $node || array() === $node ) {
				$missing[] = $field;
			}
		}
		return $missing;
	}

	// ------------------------------------------------------------------------------------------
	// Internals
	// ------------------------------------------------------------------------------------------

	/**
	 * @param array<string,mixed> $product
	 * @param array<string,mixed> $meta
	 * @param array<string,mixed> $opts
	 * @return array<string,mixed>
	 */
	private function run( array $product, array $meta, array $opts ): array {
		$mf  = self::index_meta( $meta );
		$get = static function ( string $key ) use ( $mf ) {
			return $mf[ $key ] ?? null;
		};

		$out = array( 'schemaVersion' => Vocab::SCHEMA_VERSION );

		$out['id']   = (string) ( $product['id'] ?? '' );
		$out['name'] = trim( (string) ( $product['name'] ?? '' ) );

		// Brand: meta → brand taxonomy → "Brand" attribute → shop name.
		$brand_attr = null;
		foreach ( (array) ( $product['attributes'] ?? array() ) as $attr ) {
			$slug = (string) ( $attr['slug'] ?? '' );
			$name = (string) ( $attr['name'] ?? '' );
			if ( preg_match( '/^(pa_)?brand$/i', $slug ) || preg_match( '/^brand$/i', $name ) ) {
				$brand_attr = $attr['options'][0] ?? null;
				break;
			}
		}
		$brand = self::coerce_string( $get( '_paskamer_brand' ) )
			?? self::coerce_string( $product['brands'][0]['name'] ?? null )
			?? self::coerce_string( $brand_attr )
			?? self::coerce_string( $opts['default_brand'] ?? null );
		if ( null !== $brand ) {
			$out['brand'] = $brand;
		}

		$explicit = self::coerce_string( $get( '_paskamer_category' ) );
		$hints    = array( $explicit );
		foreach ( (array) ( $product['categories'] ?? array() ) as $cat ) {
			$hints[] = (string) ( $cat['name'] ?? '' );
		}
		$hints[]  = $out['name'];
		$category = Vocab::infer_category( $hints );
		if ( null !== $category ) {
			$out['category'] = $category;
		} elseif ( null !== $explicit ) {
			$this->warn( '_paskamer_category', 'category', "unknown category '" . $explicit . "'" );
		}

		$sub = self::coerce_string( $get( '_paskamer_subcategory' ) );
		if ( null !== $sub ) {
			$out['subcategory'] = $sub;
		}

		$currency = strtoupper( (string) ( $product['currency'] ?? $opts['currency'] ?? 'EUR' ) );
		$amount   = self::coerce_number( $product['price'] ?? null ) ?? self::coerce_number( $product['regular_price'] ?? null );
		if ( null !== $amount ) {
			if ( 'EUR' === $currency ) {
				$out['priceEur'] = self::num( $amount );
			} else {
				$this->warn( 'price', 'priceEur', 'price is in ' . $currency . ', not EUR' );
			}
		}

		$url = self::coerce_url( $product['permalink'] ?? null );
		if ( null !== $url ) {
			$out['productUrl'] = $url;
		}

		$photos = array();
		foreach ( (array) ( $product['images'] ?? array() ) as $img ) {
			$src = self::coerce_url( is_array( $img ) ? ( $img['src'] ?? null ) : $img );
			if ( null !== $src && ! in_array( $src, $photos, true ) ) {
				$photos[] = $src;
			}
		}
		if ( $photos ) {
			$out['productPhotos'] = array_slice( $photos, 0, 20 );
		}

		$flat_raw  = $get( '_paskamer_flat_lay_photo' );
		$flat_cand = $flat_raw;
		if ( is_array( $flat_raw ) ) {
			$flat_cand = $flat_raw['url'] ?? $flat_raw['src'] ?? null;
		}
		$flat = self::coerce_url( $flat_cand );
		if ( null !== $flat ) {
			$out['flatLayPhoto'] = $flat;
		} elseif ( null !== $flat_raw && '' !== $flat_raw ) {
			$this->warn( '_paskamer_flat_lay_photo', 'flatLayPhoto', 'not an absolute http(s) URL' );
		}

		$sct = self::coerce_string( $get( '_paskamer_size_chart_type' ) );
		$sct = null === $sct ? null : strtolower( $sct );
		if ( 'garment' === $sct || 'body' === $sct ) {
			$out['sizeChartType'] = $sct;
		} elseif ( null !== $sct ) {
			$this->warn( '_paskamer_size_chart_type', 'sizeChartType', "expected 'garment' or 'body'" );
		}

		$chart = $this->coerce_size_chart( $get( '_paskamer_size_chart' ) );
		if ( null !== $chart ) {
			$out['sizeChart'] = $chart;
		}

		$fabric = $this->coerce_fabric( $get( '_paskamer_fabric' ) );
		if ( null !== $fabric ) {
			$out['fabric'] = $fabric;
		}

		$block = self::coerce_string( $get( '_paskamer_pattern_block' ) );
		if ( null !== $block ) {
			$out['patternBlock'] = strtolower( $block );
		}

		$ease = $this->coerce_keyed_numbers( $get( '_paskamer_ease' ), 'ease', Vocab::FIT_POINTS, array( 'hips' => 'hip', 'chest' => 'bust' ) );
		if ( null !== $ease ) {
			$out['ease'] = $ease;
		}

		$lengths = $this->coerce_length_cm( $get( '_paskamer_length_cm' ) );
		if ( null !== $lengths ) {
			$out['lengthCm'] = $lengths;
		}

		$notes = self::coerce_string( $get( '_paskamer_sizing_notes' ) );
		if ( null !== $notes ) {
			$out['sizingNotes'] = function_exists( 'mb_substr' ) ? mb_substr( $notes, 0, 500 ) : substr( $notes, 0, 500 );
		}

		$tts_raw = $get( '_paskamer_true_to_size_score' );
		$tts     = self::coerce_unit( self::parse_jsonish( $tts_raw ) );
		if ( null !== $tts ) {
			$out['trueToSizeScore'] = $tts;
		} elseif ( null !== $tts_raw && '' !== $tts_raw ) {
			$this->warn( '_paskamer_true_to_size_score', 'trueToSizeScore', 'expected 0..1' );
		}

		$critical = self::coerce_fit_points( $get( '_paskamer_critical_fit_points' ) );
		if ( null !== $critical ) {
			$out['criticalFitPoints'] = $critical;
		}
		$zones = self::coerce_string_list( $get( '_paskamer_stretch_zones' ) );
		if ( null !== $zones ) {
			$out['stretchZones'] = array_values( array_map( 'strtolower', $zones ) );
		}
		$tags = $this->coerce_style_tags( $get( '_paskamer_style_tags' ) );
		if ( null !== $tags ) {
			$out['styleTags'] = $tags;
		}

		$colorways = $this->coerce_colorways( $get( '_paskamer_colorways' ) );
		if ( null !== $colorways ) {
			$out['colorways'] = $colorways;
		}
		$hex = self::coerce_hex( $get( '_paskamer_primary_color_hex' ) ) ?? ( $colorways[0]['hex'] ?? null );
		if ( null !== $hex ) {
			$out['primaryColorHex'] = $hex;
		}

		return self::compact( $out );
	}

	private function warn( string $source, string $path, string $message ): void {
		$this->warnings[] = array(
			'source'  => $source,
			'path'    => $path,
			'message' => $message,
		);
	}

	/**
	 * Normalise meta input to `_paskamer_*` → value, unwrapping get_post_meta's single-element arrays.
	 *
	 * @param array<string,mixed> $meta
	 * @return array<string,mixed>
	 */
	public static function index_meta( array $meta ): array {
		$out = array();
		// REST style: list of {key, value}.
		if ( array_is_list( $meta ) ) {
			$assoc = array();
			foreach ( $meta as $row ) {
				if ( is_array( $row ) && isset( $row['key'] ) ) {
					$assoc[ (string) $row['key'] ] = $row['value'] ?? null;
				}
			}
			$meta = $assoc;
		}
		foreach ( $meta as $raw_key => $raw_value ) {
			$key   = str_starts_with( (string) $raw_key, Vocab::META_PREFIX ) ? (string) $raw_key : Vocab::META_PREFIX . $raw_key;
			$value = $raw_value;
			if ( is_array( $value ) && 1 === count( $value ) && array_is_list( $value ) && is_string( $value[0] ) ) {
				$value = $value[0];
			}
			$out[ $key ] = $value;
		}
		return $out;
	}

	// ---- coercions (mappings/common.ts) -----------------------------------------------------

	/** @param mixed $value @return mixed */
	public static function parse_jsonish( $value ) {
		if ( ! is_string( $value ) ) {
			return $value;
		}
		$t = trim( $value );
		if ( '' === $t ) {
			return null;
		}
		if ( preg_match( '/^[\[{"]/', $t ) || preg_match( '/^-?\d+(\.\d+)?$/', $t ) || in_array( $t, array( 'true', 'false', 'null' ), true ) ) {
			$decoded = json_decode( $t, true );
			if ( JSON_ERROR_NONE === json_last_error() ) {
				return $decoded;
			}
		}
		return $value;
	}

	/** @param mixed $value */
	public static function coerce_number( $value ): ?float {
		if ( is_bool( $value ) ) {
			return null;
		}
		if ( is_int( $value ) || is_float( $value ) ) {
			return is_finite( (float) $value ) ? (float) $value : null;
		}
		if ( is_string( $value ) ) {
			$t = str_replace( ',', '.', trim( $value ) );
			if ( '' === $t || ! is_numeric( $t ) ) {
				return null;
			}
			return (float) $t;
		}
		return null;
	}

	/** @param mixed $value */
	public static function coerce_string( $value ): ?string {
		if ( is_string( $value ) ) {
			$t = trim( $value );
			return '' === $t ? null : $t;
		}
		if ( ( is_int( $value ) || is_float( $value ) ) && is_finite( (float) $value ) ) {
			return self::num_to_string( $value );
		}
		return null;
	}

	/** @param mixed $value @return string[]|null */
	public static function coerce_string_list( $value ): ?array {
		$v = self::parse_jsonish( $value );
		if ( is_array( $v ) ) {
			$out = array();
			foreach ( $v as $item ) {
				$s = self::coerce_string( $item );
				if ( null !== $s ) {
					$out[] = $s;
				}
			}
			return $out ? $out : null;
		}
		if ( is_string( $v ) ) {
			$out = array();
			foreach ( preg_split( '/[,|;\n]/', $v ) ?: array() as $s ) {
				$s = trim( $s );
				if ( '' !== $s ) {
					$out[] = $s;
				}
			}
			return $out ? $out : null;
		}
		return null;
	}

	/** `#RGB`/`#RRGGBB`/`RRGGBB` → `#RRGGBB` upper-case. @param mixed $value */
	public static function coerce_hex( $value ): ?string {
		$s = self::coerce_string( $value );
		if ( null === $s ) {
			return null;
		}
		$h = str_starts_with( $s, '#' ) ? $s : '#' . $s;
		if ( ! preg_match( '/^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/', $h ) ) {
			return null;
		}
		if ( 4 === strlen( $h ) ) {
			$h = '#' . $h[1] . $h[1] . $h[2] . $h[2] . $h[3] . $h[3];
		}
		return strtoupper( $h );
	}

	/** Absolute http(s) URL or null. @param mixed $value */
	public static function coerce_url( $value ): ?string {
		$s = self::coerce_string( $value );
		if ( null === $s || strlen( $s ) > 2048 ) {
			return null;
		}
		if ( false === filter_var( $s, FILTER_VALIDATE_URL ) ) {
			return null;
		}
		$scheme = strtolower( (string) parse_url( $s, PHP_URL_SCHEME ) );
		return ( 'http' === $scheme || 'https' === $scheme ) ? $s : null;
	}

	/** @param mixed $value */
	public static function coerce_unit( $value ): ?float {
		$n = self::coerce_number( $value );
		if ( null === $n ) {
			return null;
		}
		$scaled = ( $n > 1 && $n <= 100 ) ? $n / 100 : $n;
		return ( $scaled >= 0 && $scaled <= 1 ) ? $scaled : null;
	}

	/** @param mixed $value @return string[]|null */
	public static function coerce_fit_points( $value ): ?array {
		$list = self::coerce_string_list( $value );
		if ( null === $list ) {
			return null;
		}
		$out = array();
		foreach ( $list as $s ) {
			$s = strtolower( $s );
			$s = array( 'hips' => 'hip', 'chest' => 'bust', 'shoulders' => 'shoulder' )[ $s ] ?? $s;
			if ( in_array( $s, Vocab::FIT_POINTS, true ) && ! in_array( $s, $out, true ) ) {
				$out[] = $s;
			}
		}
		return $out ? $out : null;
	}

	/** @param mixed $value @return array<int, array<string,mixed>>|null */
	private function coerce_size_chart( $value ): ?array {
		$v = self::parse_jsonish( $value );
		if ( is_array( $v ) && ! array_is_list( $v ) ) {
			$rows = array();
			foreach ( $v as $size => $row ) {
				$rows[] = is_array( $row ) ? array_merge( array( 'size' => (string) $size ), $row ) : array( 'size' => (string) $size );
			}
			$v = $rows;
		}
		if ( ! is_array( $v ) ) {
			if ( null !== $v ) {
				$this->warn( '_paskamer_size_chart', 'sizeChart', 'expected a JSON array of size rows' );
			}
			return null;
		}
		$out = array();
		foreach ( $v as $row ) {
			if ( ! is_array( $row ) ) {
				continue;
			}
			$size = self::coerce_string( $row['size'] ?? $row['label'] ?? $row['name'] ?? null );
			if ( null === $size ) {
				continue;
			}
			$r = array( 'size' => $size );
			foreach ( array( 'bust', 'waist', 'hip', 'shoulder', 'thigh', 'inseam', 'footEu', 'footLengthCm' ) as $p ) {
				$n = self::coerce_number( $row[ $p ] ?? null );
				if ( null !== $n ) {
					$r[ $p ] = self::num( $n );
				}
			}
			$aliases = array(
				array( 'bust', 'chest' ),
				array( 'hip', 'hips' ),
				array( 'footEu', 'eu' ),
				array( 'footEu', 'foot_eu' ),
				array( 'footLengthCm', 'foot_length_cm' ),
			);
			foreach ( $aliases as list( $canon, $alias ) ) {
				if ( ! isset( $r[ $canon ] ) ) {
					$n = self::coerce_number( $row[ $alias ] ?? null );
					if ( null !== $n ) {
						$r[ $canon ] = self::num( $n );
					}
				}
			}
			$out[] = $r;
		}
		if ( ! $out ) {
			$this->warn( '_paskamer_size_chart', 'sizeChart', 'no usable rows' );
			return null;
		}
		return $out;
	}

	/** @param mixed $value @return array<string,mixed>|null */
	private function coerce_fabric( $value ): ?array {
		$v = self::parse_jsonish( $value );
		if ( ! is_array( $v ) || array_is_list( $v ) ) {
			if ( null !== $v ) {
				$this->warn( '_paskamer_fabric', 'fabric', 'expected a JSON object' );
			}
			return null;
		}
		$out     = array();
		$primary = self::coerce_string( $v['primary'] ?? $v['fibre'] ?? $v['fiber'] ?? $v['material'] ?? null );
		if ( null !== $primary ) {
			$out['primary'] = strtolower( $primary );
		}
		foreach ( array( 'weightGsm', 'stretchPct', 'drape', 'opacity', 'sheen' ) as $k ) {
			if ( ! isset( $v[ $k ] ) || '' === $v[ $k ] ) {
				continue;
			}
			$n = self::coerce_number( $v[ $k ] );
			if ( null !== $n ) {
				$out[ $k ] = self::num( $n );
			} else {
				$this->warn( '_paskamer_fabric', 'fabric.' . $k, 'expected a number' );
			}
		}
		$gsm = self::coerce_number( $v['gsm'] ?? $v['weight_gsm'] ?? null );
		if ( ! isset( $out['weightGsm'] ) && null !== $gsm ) {
			$out['weightGsm'] = self::num( $gsm );
		}
		$stretch = self::coerce_number( $v['stretch'] ?? $v['stretch_pct'] ?? null );
		if ( ! isset( $out['stretchPct'] ) && null !== $stretch ) {
			$out['stretchPct'] = self::num( $stretch );
		}
		if ( isset( $v['blend'] ) && is_array( $v['blend'] ) ) {
			$blend = array();
			foreach ( $v['blend'] as $b ) {
				$fibre = null;
				$pct   = null;
				if ( is_array( $b ) && array_is_list( $b ) && count( $b ) >= 2 ) {
					$fibre = self::coerce_string( $b[0] );
					$pct   = self::coerce_number( $b[1] );
				} elseif ( is_array( $b ) ) {
					$fibre = self::coerce_string( $b['fibre'] ?? $b['fiber'] ?? $b['name'] ?? null );
					$pct   = self::coerce_number( $b['pct'] ?? $b['percent'] ?? $b['share'] ?? null );
				}
				if ( null !== $fibre && null !== $pct ) {
					$blend[] = array( $fibre, self::num( $pct ) );
				}
			}
			if ( $blend ) {
				$out['blend'] = $blend;
			}
		}
		return $out ? $out : null;
	}

	/**
	 * @param mixed    $value
	 * @param string[] $allowed
	 * @param array<string,string> $aliases
	 * @return array<string,float|int>|null
	 */
	private function coerce_keyed_numbers( $value, string $path, array $allowed, array $aliases ): ?array {
		$v = self::parse_jsonish( $value );
		if ( ! is_array( $v ) || ( array_is_list( $v ) && array() !== $v ) ) {
			if ( null !== $v ) {
				$this->warn( Vocab::META_PREFIX . $path, $path, 'expected a JSON object keyed by fit point' );
			}
			return null;
		}
		$out = array();
		foreach ( $v as $k => $raw ) {
			$key = $aliases[ (string) $k ] ?? (string) $k;
			if ( ! in_array( $key, $allowed, true ) ) {
				continue;
			}
			$n = self::coerce_number( $raw );
			if ( null !== $n ) {
				$out[ $key ] = self::num( $n );
			}
		}
		return $out ? $out : null;
	}

	/** @param mixed $value @return array<string,float|int>|null */
	private function coerce_length_cm( $value ): ?array {
		$v = self::parse_jsonish( $value );
		if ( ! is_array( $v ) || ( array_is_list( $v ) && array() !== $v ) ) {
			if ( null !== $v ) {
				$this->warn( '_paskamer_length_cm', 'lengthCm', 'expected a JSON object keyed by length name' );
			}
			return null;
		}
		$out = array();
		foreach ( $v as $k => $raw ) {
			$n = self::coerce_number( $raw );
			if ( null === $n ) {
				continue;
			}
			$key = preg_replace( '/[\s-]+/', '_', strtolower( trim( (string) $k ) ) );
			if ( '' === $key ) {
				continue;
			}
			$out[ $key ] = self::num( $n );
		}
		return $out ? $out : null;
	}

	/** @param mixed $value @return array<string,float|int>|null */
	private function coerce_style_tags( $value ): ?array {
		$v = self::parse_jsonish( $value );
		if ( ! is_array( $v ) || ( array_is_list( $v ) && array() !== $v ) ) {
			if ( null !== $v ) {
				$this->warn( '_paskamer_style_tags', 'styleTags', 'expected a JSON object keyed by taste axis' );
			}
			return null;
		}
		$out = array();
		foreach ( $v as $k => $raw ) {
			$key = in_array( (string) $k, array( 'avant-garde', 'avantgarde' ), true ) ? 'avantGarde' : (string) $k;
			if ( ! in_array( $key, Vocab::TASTE_AXES, true ) ) {
				continue;
			}
			$n = self::coerce_number( $raw );
			if ( null !== $n ) {
				$out[ $key ] = self::num( max( 0.0, min( 1.0, $n ) ) );
			}
		}
		return $out ? $out : null;
	}

	/** @param mixed $value @return array<int, array<string,mixed>>|null */
	private function coerce_colorways( $value ): ?array {
		$v = self::parse_jsonish( $value );
		if ( ! is_array( $v ) || ! array_is_list( $v ) ) {
			if ( null !== $v ) {
				$this->warn( '_paskamer_colorways', 'colorways', 'expected a JSON array of colorways' );
			}
			return null;
		}
		$out = array();
		foreach ( $v as $c ) {
			if ( ! is_array( $c ) ) {
				continue;
			}
			$name = self::coerce_string( $c['name'] ?? $c['label'] ?? null );
			$hex  = self::coerce_hex( $c['hex'] ?? $c['color'] ?? $c['colour'] ?? null );
			if ( null === $name || null === $hex ) {
				$this->warn( '_paskamer_colorways', 'colorways', 'each colorway needs a name and a hex colour' );
				continue;
			}
			$row = array(
				'name' => $name,
				'hex'  => $hex,
			);
			$sku = self::coerce_string( $c['sku'] ?? null );
			if ( null !== $sku ) {
				$row['sku'] = $sku;
			}
			$photos = self::coerce_string_list( $c['productPhotos'] ?? $c['photos'] ?? $c['images'] ?? null );
			if ( null !== $photos ) {
				$urls = array_values( array_filter( array_map( array( self::class, 'coerce_url' ), $photos ) ) );
				if ( $urls ) {
					$row['productPhotos'] = $urls;
				}
			}
			$flat = self::coerce_url( $c['flatLayPhoto'] ?? $c['flat_lay'] ?? null );
			if ( null !== $flat ) {
				$row['flatLayPhoto'] = $flat;
			}
			$out[] = $row;
		}
		return $out ? $out : null;
	}

	/** Integers stay ints in JSON (84 not 84.0). @return int|float */
	private static function num( float $n ) {
		return ( floor( $n ) === $n && abs( $n ) < PHP_INT_MAX ) ? (int) $n : $n;
	}

	/** @param int|float $n */
	private static function num_to_string( $n ): string {
		$n = self::num( (float) $n );
		return is_int( $n ) ? (string) $n : rtrim( rtrim( sprintf( '%.6F', $n ), '0' ), '.' );
	}

	/** @param array<string,mixed> $obj @return array<string,mixed> */
	private static function compact( array $obj ): array {
		$out = array();
		foreach ( $obj as $k => $v ) {
			if ( null !== $v ) {
				$out[ $k ] = $v;
			}
		}
		return $out;
	}

	/** @param mixed $value @return mixed */
	private static function sort_keys( $value ) {
		if ( ! is_array( $value ) ) {
			return $value;
		}
		if ( array_is_list( $value ) ) {
			return array_map( array( self::class, 'sort_keys' ), $value );
		}
		ksort( $value, SORT_STRING );
		$out = array();
		foreach ( $value as $k => $v ) {
			$out[ $k ] = self::sort_keys( $v );
		}
		return $out;
	}
}
