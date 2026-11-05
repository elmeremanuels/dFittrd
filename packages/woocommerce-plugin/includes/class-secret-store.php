<?php
/**
 * At-rest encryption for the merchant secret key (sk_live_…) and the Connect token.
 *
 * Key material is derived from the site's wp-config.php salts (AUTH_KEY + SECURE_AUTH_KEY), so a
 * database dump alone does not leak the signing secret. libsodium (bundled with PHP ≥ 7.2) is
 * preferred; OpenSSL AES-256-GCM is the fallback; when neither extension is loaded the value is
 * stored with a `plain:` marker and the settings page shows a warning.
 *
 * Stored format: `<scheme>:<base64(nonce|ciphertext|tag)>`.
 *
 * @package Curtain
 */

declare(strict_types=1);

namespace Curtain;

defined('ABSPATH') || defined('CURTAIN_TESTING') || exit;

final class Secret_Store {

	private const CONTEXT = 'curtain-woocommerce-secret-v1';

	/**
	 * Which scheme this host can use.
	 *
	 * @return 'sodium'|'openssl'|'plain'
	 */
	public static function scheme(): string {
		if ( function_exists( 'sodium_crypto_secretbox' ) ) {
			return 'sodium';
		}
		if ( function_exists( 'openssl_encrypt' ) && in_array( 'aes-256-gcm', openssl_get_cipher_methods(), true ) ) {
			return 'openssl';
		}
		return 'plain';
	}

	public static function encrypt( string $plain ): string {
		if ( '' === $plain ) {
			return '';
		}
		$key = self::key();
		switch ( self::scheme() ) {
			case 'sodium':
				$nonce = random_bytes( SODIUM_CRYPTO_SECRETBOX_NONCEBYTES );
				$ct    = sodium_crypto_secretbox( $plain, $nonce, $key );
				return 'sodium:' . base64_encode( $nonce . $ct );
			case 'openssl':
				$iv  = random_bytes( 12 );
				$tag = '';
				$ct  = openssl_encrypt( $plain, 'aes-256-gcm', $key, OPENSSL_RAW_DATA, $iv, $tag, self::CONTEXT, 16 );
				if ( false === $ct ) {
					return 'plain:' . base64_encode( $plain );
				}
				return 'openssl:' . base64_encode( $iv . $ct . $tag );
			default:
				return 'plain:' . base64_encode( $plain );
		}
	}

	/**
	 * Decrypt; returns '' when the value is missing, malformed, or the salts changed.
	 */
	public static function decrypt( string $stored ): string {
		if ( '' === $stored ) {
			return '';
		}
		$i = strpos( $stored, ':' );
		if ( false === $i ) {
			return '';
		}
		$scheme = substr( $stored, 0, $i );
		$raw    = base64_decode( substr( $stored, $i + 1 ), true );
		if ( false === $raw ) {
			return '';
		}
		$key = self::key();
		switch ( $scheme ) {
			case 'sodium':
				if ( ! function_exists( 'sodium_crypto_secretbox_open' ) || strlen( $raw ) <= SODIUM_CRYPTO_SECRETBOX_NONCEBYTES ) {
					return '';
				}
				$nonce = substr( $raw, 0, SODIUM_CRYPTO_SECRETBOX_NONCEBYTES );
				$ct    = substr( $raw, SODIUM_CRYPTO_SECRETBOX_NONCEBYTES );
				$out   = sodium_crypto_secretbox_open( $ct, $nonce, $key );
				return false === $out ? '' : $out;
			case 'openssl':
				if ( ! function_exists( 'openssl_decrypt' ) || strlen( $raw ) <= 28 ) {
					return '';
				}
				$iv  = substr( $raw, 0, 12 );
				$tag = substr( $raw, -16 );
				$ct  = substr( $raw, 12, -16 );
				$out = openssl_decrypt( $ct, 'aes-256-gcm', $key, OPENSSL_RAW_DATA, $iv, $tag, self::CONTEXT );
				return false === $out ? '' : $out;
			case 'plain':
				return $raw;
			default:
				return '';
		}
	}

	/** 32-byte key derived from the WordPress salts. */
	private static function key(): string {
		$auth   = defined( 'AUTH_KEY' ) ? (string) AUTH_KEY : '';
		$secure = defined( 'SECURE_AUTH_KEY' ) ? (string) SECURE_AUTH_KEY : '';
		return hash( 'sha256', $auth . '|' . $secure . '|' . self::CONTEXT, true );
	}

	/** Last 4 characters for display (`sk_live_••••abcd`). */
	public static function mask( string $secret ): string {
		if ( '' === $secret ) {
			return '';
		}
		$prefix = preg_match( '/^(sk_(?:live|test)_)/', $secret, $m ) ? $m[1] : '';
		return $prefix . '••••' . substr( $secret, -4 );
	}
}
