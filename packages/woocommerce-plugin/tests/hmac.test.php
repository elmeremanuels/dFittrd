<?php
/**
 * PK-HMAC vectors cross-checked against Node's crypto (apps/api/src/lib/crypto.ts semantics).
 *
 * @package Paskamer\Tests
 */

declare(strict_types=1);

use Paskamer\Hmac;

const PASKAMER_T_SECRET = 'sk_' . 'test_abcdefghijklmnopqrstuvwxyz0123';
const PASKAMER_T_BODY   = '{"id":"42","name":"Linen Wrap Dress","brand":"Aalter Studio"}';
const PASKAMER_T_TS     = '1762300000';

test(
	'signing string matches METHOD\\n<target>\\n<ts>\\n<sha256(body)>',
	static function (): void {
		$s = Hmac::signing_string( 'put', '/v1/merchant/products/42?dry=1', PASKAMER_T_TS, PASKAMER_T_BODY );
		assert_same( "PUT\n/v1/merchant/products/42?dry=1\n1762300000\na544e7de99ef77dfd1445a7bf31fb6971f9e42b04e2b9dda6a3cc668c17dfd4b", $s );
	}
);

test(
	'sign() reproduces the Node reference signature',
	static function (): void {
		$sig = Hmac::sign( PASKAMER_T_SECRET, 'PUT', '/v1/merchant/products/42?dry=1', PASKAMER_T_TS, PASKAMER_T_BODY );
		assert_same( '46635340e9672b8fd6c088bb5eae87636158d0d251cf6a1ff80f7e19a1012244', $sig );
		$get = Hmac::sign( PASKAMER_T_SECRET, 'GET', '/wp-json/paskamer/v1/products/42', PASKAMER_T_TS, '' );
		assert_same( 'fd491cf7d19766617a018bcbbb1ce54cdce30d3c21866c3fa86d404470c861ea', $get, 'empty body hashes to e3b0c442…' );
	}
);

test(
	'target_from_url keeps path + query, drops scheme/host/fragment',
	static function (): void {
		assert_same( '/v1/merchant/products/42?dry=1', Hmac::target_from_url( 'https://api.paskamer.app/v1/merchant/products/42?dry=1#x' ) );
		assert_same( '/', Hmac::target_from_url( 'https://api.paskamer.app' ) );
		assert_same( '/v1/merchant/products/a%20b', Hmac::target_from_url( 'https://api.paskamer.app/v1/merchant/products/a%20b' ) );
	}
);

test(
	'header() builds "PK-HMAC key=…, ts=…, sig=…" that parse_header reads back',
	static function (): void {
		$h = Hmac::header( 'pk_' . 'test_abc123', PASKAMER_T_SECRET, 'PUT', 'https://api.paskamer.app/v1/merchant/products/42?dry=1', PASKAMER_T_BODY, (int) PASKAMER_T_TS );
		assert_same( 'PK-HMAC key=pk_test_abc123, ts=1762300000, sig=46635340e9672b8fd6c088bb5eae87636158d0d251cf6a1ff80f7e19a1012244', $h );
		$p = Hmac::parse_header( $h );
		assert_same( array( 'key' => 'pk_' . 'test_abc123', 'ts' => '1762300000', 'sig' => '46635340e9672b8fd6c088bb5eae87636158d0d251cf6a1ff80f7e19a1012244' ), $p );
		assert_same( null, Hmac::parse_header( 'Bearer sk_live_x' ) );
		assert_same( null, Hmac::parse_header( 'PK-HMAC key=pk_x, ts=1' ), 'missing sig' );
		$quoted = Hmac::parse_header( 'pk-hmac key="pk_x", TS="1", Sig="ab"' );
		assert_same( array( 'key' => 'pk_x', 'ts' => '1', 'sig' => 'ab' ), $quoted, 'case-insensitive scheme + quoted values' );
	}
);

test(
	'verify() accepts a good signature inside the window and rejects the rest',
	static function (): void {
		$now    = (int) PASKAMER_T_TS;
		$target = '/wp-json/paskamer/v1/products/42';
		$header = Hmac::header( 'pk_' . 'test_abc123', PASKAMER_T_SECRET, 'GET', 'https://shop.example' . $target, '', $now );

		assert_same( array( 'ok' => true, 'code' => 'ok' ), Hmac::verify( $header, 'pk_' . 'test_abc123', array( PASKAMER_T_SECRET ), 'GET', $target, '', $now + 299 ) );
		assert_same( 'stale_signature', Hmac::verify( $header, 'pk_' . 'test_abc123', array( PASKAMER_T_SECRET ), 'GET', $target, '', $now + 301 )['code'] );
		assert_same( 'unknown_key', Hmac::verify( $header, 'pk_' . 'test_other', array( PASKAMER_T_SECRET ), 'GET', $target, '', $now )['code'] );
		assert_same( 'bad_signature', Hmac::verify( $header, 'pk_' . 'test_abc123', array( 'sk_' . 'test_wrongwrongwrongwrongwrong' ), 'GET', $target, '', $now )['code'] );
		assert_same( 'bad_signature', Hmac::verify( $header, 'pk_' . 'test_abc123', array( PASKAMER_T_SECRET ), 'GET', $target . '?x=1', '', $now )['code'], 'query is part of the target' );
		assert_same( 'bad_signature', Hmac::verify( 'Basic abc', 'pk_' . 'test_abc123', array( PASKAMER_T_SECRET ), 'GET', $target, '', $now )['code'] );
		// Previous secret during the 24 h grace window.
		assert_true( Hmac::verify( $header, 'pk_' . 'test_abc123', array( 'sk_' . 'test_newnewnewnewnewnewnewnew', PASKAMER_T_SECRET ), 'GET', $target, '', $now )['ok'] );
	}
);

test(
	'key format guards match the schema regexes',
	static function (): void {
		assert_true( Hmac::is_public_key( 'pk_' . 'live_Ab12Cd' ) );
		assert_true( Hmac::is_public_key( 'pk_' . 'test_abcdef' ) );
		assert_false( Hmac::is_public_key( 'pk_' . 'live_ab' ) );
		assert_false( Hmac::is_public_key( 'sk_' . 'live_abcdefghijklmnopqrstuvwxyz' ) );
		assert_true( Hmac::is_secret_key( 'sk_' . 'live_abcdefghijklmnopqrstuvwxyz' ) );
		assert_false( Hmac::is_secret_key( 'sk_' . 'live_short' ) );
		assert_false( Hmac::is_secret_key( 'pk_' . 'live_abcdefghijklmnopqrstuvwxyz' ) );
	}
);
