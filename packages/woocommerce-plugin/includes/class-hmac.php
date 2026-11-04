<?php
/**
 * PK-HMAC request signing / verification.
 *
 * Mirrors apps/api/src/lib/crypto.ts `merchantSigningString` + `signMerchantRequest` and
 * apps/api/src/auth/merchant.ts `parseHmacHeader` exactly:
 *
 *   Authorization: PK-HMAC key=<pk_live_…>, ts=<unix seconds>, sig=<hex>
 *   sig = HMAC-SHA256( sk_live_… , "METHOD\n<request target>\n<ts>\n<sha256hex(body)>" )
 *
 * The request target is the path plus the query string exactly as sent (no scheme/host).
 * The window is ±300 s. This class is pure PHP (no WordPress functions) so it is unit-tested
 * without a WordPress runtime and reused by the signed REST endpoint for verification.
 *
 * @package Paskamer
 */

declare(strict_types=1);

namespace Paskamer;

defined('ABSPATH') || defined('PASKAMER_TESTING') || exit;

final class Hmac {

	public const SCHEME     = 'PK-HMAC';
	public const WINDOW_SEC = 300;

	/**
	 * Canonical signing string.
	 */
	public static function signing_string( string $method, string $target, string $ts, string $body ): string {
		return strtoupper( $method ) . "\n" . $target . "\n" . $ts . "\n" . hash( 'sha256', $body );
	}

	/**
	 * Hex HMAC-SHA256 of the signing string.
	 */
	public static function sign( string $secret, string $method, string $target, string $ts, string $body ): string {
		return hash_hmac( 'sha256', self::signing_string( $method, $target, $ts, $body ), $secret );
	}

	/**
	 * Request target (path + query) of an absolute or relative URL, as the api sees it in `req.raw.url`.
	 */
	public static function target_from_url( string $url ): string {
		$parts = parse_url( $url );
		if ( false === $parts ) {
			return '/';
		}
		$path  = isset( $parts['path'] ) && '' !== $parts['path'] ? $parts['path'] : '/';
		$query = isset( $parts['query'] ) && '' !== $parts['query'] ? '?' . $parts['query'] : '';
		return $path . $query;
	}

	/**
	 * Build the Authorization header value for an outbound request.
	 */
	public static function header( string $public_prefix, string $secret, string $method, string $url, string $body, ?int $ts = null ): string {
		$ts  = (string) ( $ts ?? time() );
		$sig = self::sign( $secret, $method, self::target_from_url( $url ), $ts, $body );
		return sprintf( '%s key=%s, ts=%s, sig=%s', self::SCHEME, $public_prefix, $ts, $sig );
	}

	/**
	 * Parse `PK-HMAC key=…, ts=…, sig=…` → ['key'=>…, 'ts'=>…, 'sig'=>…] or null.
	 *
	 * @return array{key:string,ts:string,sig:string}|null
	 */
	public static function parse_header( string $header ): ?array {
		if ( ! preg_match( '/^PK-HMAC\s+(.+)$/i', trim( $header ), $m ) ) {
			return null;
		}
		$parts = array();
		foreach ( explode( ',', $m[1] ) as $kv ) {
			$i = strpos( $kv, '=' );
			if ( false === $i || 0 === $i ) {
				continue;
			}
			$k           = strtolower( trim( substr( $kv, 0, $i ) ) );
			$v           = trim( substr( $kv, $i + 1 ) );
			$v           = preg_replace( '/^"|"$/', '', $v );
			$parts[ $k ] = $v;
		}
		if ( empty( $parts['key'] ) || empty( $parts['ts'] ) || empty( $parts['sig'] ) ) {
			return null;
		}
		return array(
			'key' => $parts['key'],
			'ts'  => $parts['ts'],
			'sig' => $parts['sig'],
		);
	}

	/**
	 * Verify an inbound signed request (the plugin's REST fallback endpoint).
	 *
	 * @param string        $header     Authorization header value.
	 * @param string        $public_key The pk_ prefix the caller must present.
	 * @param string[]      $secrets    Candidate secrets (current + previous during the 24 h grace).
	 * @param string        $method     HTTP method.
	 * @param string        $target     Path + query as received.
	 * @param string        $body       Raw request body ('' for GET).
	 * @param int|null      $now        Unix seconds (for tests).
	 * @return array{ok:bool,code:string}
	 */
	public static function verify( string $header, string $public_key, array $secrets, string $method, string $target, string $body, ?int $now = null ): array {
		$parsed = self::parse_header( $header );
		if ( null === $parsed ) {
			return array(
				'ok'   => false,
				'code' => 'bad_signature',
			);
		}
		if ( ! hash_equals( $public_key, $parsed['key'] ) ) {
			return array(
				'ok'   => false,
				'code' => 'unknown_key',
			);
		}
		if ( ! preg_match( '/^\d{1,12}$/', $parsed['ts'] ) ) {
			return array(
				'ok'   => false,
				'code' => 'stale_signature',
			);
		}
		$now = $now ?? time();
		if ( abs( $now - (int) $parsed['ts'] ) > self::WINDOW_SEC ) {
			return array(
				'ok'   => false,
				'code' => 'stale_signature',
			);
		}
		foreach ( $secrets as $secret ) {
			if ( '' === $secret ) {
				continue;
			}
			$expected = self::sign( $secret, $method, $target, $parsed['ts'], $body );
			if ( hash_equals( $expected, strtolower( $parsed['sig'] ) ) ) {
				return array(
					'ok'   => true,
					'code' => 'ok',
				);
			}
		}
		return array(
			'ok'   => false,
			'code' => 'bad_signature',
		);
	}

	/** Public key prefix format (schema MerchantKeyRotateResponse.publicKeyPrefix). */
	public static function is_public_key( string $value ): bool {
		return 1 === preg_match( '/^pk_(live|test)_[A-Za-z0-9]{6,32}$/', $value );
	}

	/** Secret key format (schema MerchantKeyRotateResponse.apiKey). */
	public static function is_secret_key( string $value ): bool {
		return 1 === preg_match( '/^sk_(live|test)_[A-Za-z0-9]{24,64}$/', $value );
	}
}
