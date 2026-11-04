<?php
/**
 * @package Paskamer\Tests
 */

declare(strict_types=1);

use Paskamer\Secret_Store;

test(
	'encrypt/decrypt round-trips with the host scheme and never stores plaintext',
	static function (): void {
		$secret = 'sk_' . 'live_' . str_repeat( 'x9', 16 );
		$stored = Secret_Store::encrypt( $secret );
		assert_true( in_array( Secret_Store::scheme(), array( 'sodium', 'openssl' ), true ), 'this PHP has sodium or openssl' );
		assert_true( str_starts_with( $stored, Secret_Store::scheme() . ':' ), 'scheme prefix: ' . $stored );
		assert_false( str_contains( $stored, $secret ) );
		assert_false( str_contains( base64_decode( substr( $stored, strpos( $stored, ':' ) + 1 ) ), $secret ) );
		assert_same( $secret, Secret_Store::decrypt( $stored ) );
		assert_same( '', Secret_Store::encrypt( '' ) );
		assert_same( '', Secret_Store::decrypt( '' ) );
	}
);

test(
	'tampered or foreign ciphertext decrypts to empty string',
	static function (): void {
		$stored = Secret_Store::encrypt( 'sk_' . 'live_abcdefghijklmnopqrstuvwxyz' );
		$raw    = base64_decode( substr( $stored, strpos( $stored, ':' ) + 1 ) );
		$raw[ strlen( $raw ) - 1 ] = chr( ord( $raw[ strlen( $raw ) - 1 ] ) ^ 0x01 );
		$tampered = substr( $stored, 0, strpos( $stored, ':' ) + 1 ) . base64_encode( $raw );
		assert_same( '', Secret_Store::decrypt( $tampered ) );
		assert_same( '', Secret_Store::decrypt( 'nonsense' ) );
		assert_same( '', Secret_Store::decrypt( 'sodium:!!notbase64' ) );
		assert_same( 'legacy', Secret_Store::decrypt( 'plain:' . base64_encode( 'legacy' ) ), 'plain fallback readable' );
	}
);

test(
	'mask keeps the prefix and last four characters',
	static function (): void {
		assert_same( 'sk_' . 'live_••••wxyz', Secret_Store::mask( 'sk_' . 'live_abcdefghijklmnopqrstuvwxyz' ) );
		assert_same( '', Secret_Store::mask( '' ) );
	}
);
