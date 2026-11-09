<?php
/**
 * PHP twin of the @curtain/schema fabric-text resolution: `lookupFabricId`, `fabricLibraryId`,
 * `fabricPayloadName`, `parseFabricText` and `resolveFabricText`. It reads fabric names and
 * compositions in English and Dutch ("95% katoen, 5% elastaan", "Cotton jersey", "TENCEL™") and
 * answers in fabric library ids, so the payload this plugin pushes matches what `fromWooMeta`
 * builds. The lexicon is assets/fabric-library.json, generated from @curtain/schema by
 * scripts/fabric-library.mjs (build and test fixture export); without it every lookup misses and
 * names pass through unchanged. tests/fabric-text.test.php compares it with the TypeScript output.
 *
 * @package Curtain
 */

declare(strict_types=1);

namespace Curtain;

defined( 'ABSPATH' ) || exit;

final class Fabric_Text {

	/** Attribute names that hold fabric text (FABRIC_TEXT_FIELD in @curtain/schema). */
	public const TEXT_FIELD = '/^(?:pa_)?(?:materials?|materiaal|materialen|fabrics?|fabric[-_ ]composition|composition|stof|stoffen|samenstelling|materiaalsamenstelling)$/i';

	/** @var array<string,mixed>|null */
	private static ?array $library = null;

	/** @var array<int, array{term:string,id:string,re:string}>|null */
	private static ?array $lexicon = null;

	/** @var array<string,string>|null normalised term → id */
	private static ?array $terms = null;

	/** Library file override (tests); null = the bundled asset. */
	private static ?string $file = null;

	/** Test hook: use another library file (null = the bundled asset). */
	public static function use_library_file( ?string $file ): void {
		self::$library = null;
		self::$lexicon = null;
		self::$terms   = null;
		self::$file    = $file;
	}

	/** @return array<string,mixed> */
	private static function library(): array {
		if ( null !== self::$library ) {
			return self::$library;
		}
		$file = self::$file ?? dirname( __DIR__ ) . '/assets/fabric-library.json';
		$data = is_readable( $file ) ? json_decode( (string) file_get_contents( $file ), true ) : null;
		if ( ! is_array( $data ) || ! isset( $data['terms'], $data['fibres'], $data['constructions'], $data['v1Primaries'] ) ) {
			$data = array(
				'terms'              => array(),
				'fibres'             => array(),
				'constructions'      => array(),
				'baseFibre'          => array(),
				'v1Primaries'        => array(),
				'assumedElastanePct' => 3,
			);
		}
		self::$library = $data;
		return $data;
	}

	/** True when the generated lexicon was found (otherwise names pass through unchanged). */
	public static function available(): bool {
		return array() !== self::library()['terms'];
	}

	/** Lowercase, strip accents, collapse everything but a-z, 0-9, `%`, `.` and `,` to single spaces. */
	public static function normalise( string $text ): string {
		if ( class_exists( '\Normalizer' ) ) {
			$nfd  = \Normalizer::normalize( $text, \Normalizer::FORM_D );
			$text = false === $nfd ? $text : $nfd;
			$text = (string) preg_replace( '/[\x{0300}-\x{036F}]/u', '', $text );
		} elseif ( function_exists( 'iconv' ) ) {
			$ascii = @iconv( 'UTF-8', 'ASCII//TRANSLIT//IGNORE', $text );
			$text  = false === $ascii ? $text : $ascii;
		}
		$text = function_exists( 'mb_strtolower' ) ? mb_strtolower( $text, 'UTF-8' ) : strtolower( $text );
		return trim( (string) preg_replace( '/[^a-z0-9%.,]+/', ' ', $text ) );
	}

	/** @return array<string,string> */
	private static function terms(): array {
		if ( null === self::$terms ) {
			self::$terms = array();
			foreach ( self::library()['terms'] as $pair ) {
				self::$terms[ (string) $pair[0] ] = (string) $pair[1];
			}
		}
		return self::$terms;
	}

	public static function is_fibre( string $id ): bool {
		return in_array( $id, self::library()['fibres'], true );
	}

	public static function is_construction( string $id ): bool {
		return in_array( $id, self::library()['constructions'], true );
	}

	private static function base_fibre( string $construction ): ?string {
		$b = self::library()['baseFibre'][ $construction ] ?? null;
		return is_string( $b ) ? $b : null;
	}

	/** `lookupFabricId`: a single name, alias or brand → library id. */
	public static function lookup( string $name ): ?string {
		return self::terms()[ self::normalise( $name ) ] ?? null;
	}

	/** True when the (lower-cased) name is a v1 `FABRIC_PRIMARIES` value. */
	public static function is_v1_primary( string $lower ): bool {
		return array_key_exists( $lower, self::library()['v1Primaries'] );
	}

	/** `fabricLibraryId`: library id of a payload primary or blend name (null for `technical` or unknown). */
	public static function library_id( string $name ): ?string {
		$key = self::normalise( $name );
		$v1  = self::library()['v1Primaries'];
		if ( array_key_exists( $key, $v1 ) ) {
			return is_string( $v1[ $key ] ) ? $v1[ $key ] : null;
		}
		return self::lookup( $name );
	}

	/** `fabricPayloadName`: the v1 name where v1 has one (lyocell → tencel), the id otherwise. */
	public static function payload_name( string $id ): string {
		foreach ( self::library()['v1Primaries'] as $v1 => $library_id ) {
			if ( $library_id === $id ) {
				return (string) $v1;
			}
		}
		return $id;
	}

	/** @return array<int, array{term:string,id:string,re:string}> Longest term first (stable). */
	private static function lexicon(): array {
		if ( null !== self::$lexicon ) {
			return self::$lexicon;
		}
		$list = array();
		$i    = 0;
		foreach ( self::terms() as $term => $id ) {
			$list[] = array(
				'term' => (string) $term,
				'id'   => $id,
				'i'    => $i++,
			);
		}
		usort(
			$list,
			static function ( array $a, array $b ): int {
				$by_length = strlen( $b['term'] ) <=> strlen( $a['term'] );
				return 0 !== $by_length ? $by_length : $a['i'] <=> $b['i'];
			}
		);
		self::$lexicon = array_map(
			static function ( array $e ): array {
				return array(
					'term' => $e['term'],
					'id'   => $e['id'],
					're'   => '/(?<![a-z0-9])' . preg_quote( $e['term'], '/' ) . '(?:s|en|n)?(?![a-z0-9])/',
				);
			},
			$list
		);
		return self::$lexicon;
	}

	/** @return array<int, array{id:string,term:string,index:int}> */
	private static function find_terms( string $norm ): array {
		$taken = array_fill( 0, strlen( $norm ), false );
		$found = array();
		foreach ( self::lexicon() as $lex ) {
			if ( ! preg_match_all( $lex['re'], $norm, $m, PREG_OFFSET_CAPTURE ) ) {
				continue;
			}
			foreach ( $m[0] as list( $text, $start ) ) {
				$end  = $start + strlen( $text );
				$busy = false;
				for ( $k = $start; $k < $end; $k++ ) {
					if ( $taken[ $k ] ) {
						$busy = true;
						break;
					}
				}
				if ( $busy ) {
					continue;
				}
				for ( $k = $start; $k < $end; $k++ ) {
					$taken[ $k ] = true;
				}
				$found[] = array(
					'id'    => $lex['id'],
					'term'  => $lex['term'],
					'index' => (int) $start,
				);
			}
		}
		usort(
			$found,
			static function ( array $a, array $b ): int {
				return $a['index'] <=> $b['index'];
			}
		);
		return $found;
	}

	/**
	 * @param array<int, array<string,mixed>> $events
	 * @return array{shares:array<string,float>,construction:?string,pairs:int,fibrePairs:int}
	 */
	private static function pair_percentages( array $events, bool $pct_first ): array {
		$out   = array(
			'shares'       => array(),
			'construction' => null,
			'pairs'        => 0,
			'fibrePairs'   => 0,
		);
		$used  = array();
		$total = 0.0;
		$n     = count( $events );
		for ( $i = 0; $i < $n; $i++ ) {
			$e = $events[ $i ];
			if ( 'pct' !== $e['kind'] ) {
				continue;
			}
			$j = $pct_first ? $i + 1 : $i - 1;
			$t = $events[ $j ] ?? null;
			if ( null === $t || 'term' !== $t['kind'] || isset( $used[ $j ] ) ) {
				continue;
			}
			if ( $total >= 99.5 ) {
				break;
			}
			$used[ $j ] = true;
			++$out['pairs'];
			$id    = $t['match']['id'];
			$fibre = self::is_fibre( $id ) ? $id : self::base_fibre( $id );
			if ( self::is_construction( $id ) && null === $out['construction'] ) {
				$out['construction'] = $id;
			}
			if ( null !== $fibre ) {
				++$out['fibrePairs'];
				$out['shares'][ $fibre ] = ( $out['shares'][ $fibre ] ?? 0 ) + $e['pct'];
				$total                  += $e['pct'];
			}
		}
		return $out;
	}

	/**
	 * `parseFabricText`.
	 *
	 * @return array{composition:array<int,array{fibre:string,pct:int|float}>,construction:?string,ids:array<int,string>,sharesAssumed:bool}|null
	 */
	public static function parse( string $text ): ?array {
		if ( '' === trim( $text ) ) {
			return null;
		}
		$norm    = self::normalise( $text );
		$matches = self::find_terms( $norm );
		if ( ! $matches ) {
			return null;
		}
		$events = array();
		foreach ( $matches as $match ) {
			$events[] = array(
				'kind'  => 'term',
				'index' => $match['index'],
				'match' => $match,
			);
		}
		if ( preg_match_all( '/(?<![0-9.,])(\d{1,3}(?:[.,]\d+)?)\s*%/', $norm, $pm, PREG_OFFSET_CAPTURE ) ) {
			foreach ( $pm[1] as $k => list( $num ) ) {
				$pct = (float) str_replace( ',', '.', $num );
				if ( $pct > 0 && $pct <= 100 ) {
					$events[] = array(
						'kind'  => 'pct',
						'index' => (int) $pm[0][ $k ][1],
						'pct'   => $pct,
					);
				}
			}
		}
		usort(
			$events,
			static function ( array $a, array $b ): int {
				return $a['index'] <=> $b['index'];
			}
		);

		$pct_first    = self::pair_percentages( $events, true );
		$name_first   = self::pair_percentages( $events, false );
		$first_is_pct = 'pct' === $events[0]['kind'];
		$better       = static function ( array $x, array $y ): bool {
			return $x['fibrePairs'] > $y['fibrePairs'] || ( $x['fibrePairs'] === $y['fibrePairs'] && $x['pairs'] > $y['pairs'] );
		};
		$pick         = $better( $pct_first, $name_first ) ? $pct_first : ( $better( $name_first, $pct_first ) ? $name_first : ( $first_is_pct ? $pct_first : $name_first ) );
		$shares       = $pick['shares'];
		$construction = $pick['construction'];
		if ( null === $construction ) {
			foreach ( $matches as $m ) {
				if ( self::is_construction( $m['id'] ) ) {
					$construction = $m['id'];
					break;
				}
			}
		}

		$assumed = false;
		if ( ! $shares ) {
			$named = array();
			foreach ( $matches as $m ) {
				if ( self::is_fibre( $m['id'] ) && ! in_array( $m['id'], $named, true ) ) {
					$named[] = $m['id'];
				}
			}
			if ( ! $named && null !== $construction && null !== self::base_fibre( $construction ) ) {
				$named[] = (string) self::base_fibre( $construction );
			}
			if ( 1 === count( $named ) ) {
				$shares[ $named[0] ] = 100;
			} elseif ( count( $named ) > 1 ) {
				$assumed  = true;
				$others   = array_values( array_filter( $named, static fn ( $f ) => 'elastane' !== $f ) );
				$elastane = count( $named ) > count( $others ) ? (float) self::library()['assumedElastanePct'] : 0.0;
				if ( $elastane > 0 ) {
					$shares['elastane'] = $elastane;
				}
				foreach ( $others as $f ) {
					$shares[ $f ] = round( ( ( 100 - $elastane ) / count( $others ) ) * 100 ) / 100;
				}
			}
		}

		$composition = array();
		foreach ( $shares as $fibre => $pct ) {
			$composition[] = array(
				'fibre' => (string) $fibre,
				'pct'   => self::num( (float) $pct ),
			);
		}
		$ids = array();
		foreach ( $matches as $m ) {
			if ( ! in_array( $m['id'], $ids, true ) ) {
				$ids[] = $m['id'];
			}
		}
		return array(
			'composition'   => $composition,
			'construction'  => $construction,
			'ids'           => $ids,
			'sharesAssumed' => $assumed,
		);
	}

	/**
	 * `resolveFabricText`: `primary` and (when the text states it) `blend` of a payload fabric.
	 *
	 * @return array{primary:string,blend?:array<int,array{0:string,1:int|float}>}|null
	 */
	public static function resolve( string $text ): ?array {
		$parsed = self::parse( $text );
		if ( null === $parsed ) {
			return null;
		}
		$top = null;
		foreach ( $parsed['composition'] as $part ) {
			if ( null === $top || $part['pct'] > $top['pct'] ) {
				$top = $part;
			}
		}
		$primary_id = $parsed['construction'] ?? ( null !== $top ? $top['fibre'] : $parsed['ids'][0] );
		$out        = array( 'primary' => self::payload_name( $primary_id ) );
		if ( ! $parsed['sharesAssumed'] && $parsed['composition'] ) {
			$stated       = 1 === preg_match( '/\d\s*%/', self::normalise( $text ) );
			$only_primary = 1 === count( $parsed['composition'] ) && $parsed['composition'][0]['fibre'] === $primary_id;
			if ( $stated || ! $only_primary ) {
				$out['blend'] = array_map(
					static fn ( array $c ): array => array( self::payload_name( $c['fibre'] ), $c['pct'] ),
					$parsed['composition']
				);
			}
		}
		return $out;
	}

	/**
	 * `fabricFromProductText` over a product's attributes: the prefill the meta box offers when the
	 * product has no Curtain fabric yet (names only; the merchant adds stretch and drape and saves).
	 *
	 * @param array<int, array{name?:string,slug?:string,options?:array<int,string>}> $attributes
	 * @return array{primary:string,blend?:array<int,array{0:string,1:int|float}>}|null
	 */
	public static function prefill_from_attributes( array $attributes ): ?array {
		$texts = array();
		foreach ( $attributes as $a ) {
			$slug = (string) ( $a['slug'] ?? '' );
			$name = trim( (string) ( $a['name'] ?? '' ) );
			if ( 1 !== preg_match( self::TEXT_FIELD, $slug ) && 1 !== preg_match( self::TEXT_FIELD, $name ) ) {
				continue;
			}
			foreach ( (array) ( $a['options'] ?? array() ) as $opt ) {
				if ( is_string( $opt ) && '' !== trim( $opt ) ) {
					$texts[] = $opt;
				}
			}
		}
		return $texts ? self::resolve( implode( ', ', $texts ) ) : null;
	}

	/** Integers stay ints in JSON (95 not 95.0). @return int|float */
	private static function num( float $n ) {
		return ( floor( $n ) === $n && abs( $n ) < PHP_INT_MAX ) ? (int) $n : $n;
	}
}
