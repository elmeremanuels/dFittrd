<?php
/**
 * Connect hardening: the domain proof served for the manual-key path (carry-over #12), the
 * removed backfill endpoints (#13), the Stripe-only Connect redirect and the readme headers (#15).
 *
 * @package Curtain\Tests
 */

declare(strict_types=1);

use Curtain\Rest;
use Curtain\Settings;

const CURTAIN_T_NONCE = 'cv_0123456789abcdef0123456789abcdef01234567';

function curtain_pending_connect( string $nonce = CURTAIN_T_NONCE ): void {
	Settings::update( array( 'connect_token' => 'ct_' . str_repeat( 'a', 40 ), 'connect_mode' => 'manual-key', 'connect_verify_nonce' => $nonce ) );
}

test(
	'verify: 404 without a pending Connect, the nonce while one is pending, 404 again once connected',
	static function (): void {
		assert_same( 404, Rest::verify_payload()['status'] );
		curtain_pending_connect();
		$p = Rest::verify_payload();
		assert_same( 200, $p['status'] );
		assert_json_equal( array( 'nonce' => CURTAIN_T_NONCE ), $p['body'] );
		Settings::update( array( 'api_key' => 'sk_' . 'test_abcdefghijklmnopqrstuvwxyz0123', 'public_key_prefix' => 'pk_' . 'test_proof0000001' ) );
		assert_same( 404, Rest::verify_payload()['status'], 'connected shops publish nothing' );
	}
);

test(
	'verify: never publishes the Connect token or a malformed nonce',
	static function (): void {
		curtain_pending_connect( '"><script>alert(1)</script>' );
		assert_same( 404, Rest::verify_payload()['status'] );
		curtain_pending_connect();
		$body = (string) json_encode( Rest::verify_payload()['body'] );
		assert_false( str_contains( $body, 'ct_' ), 'the connect token stays private' );
		Settings::update( array( 'connect_token' => '' ) );
		assert_same( 404, Rest::verify_payload()['status'], 'no token, nothing pending' );
	}
);

test(
	'register: only the verify route (no meta tag, SEC-2); the unsigned-by-anyone backfill routes are gone',
	static function (): void {
		Rest::register();
		assert_same( 1, count( Curtain_Test_State::$actions['rest_api_init'] ?? array() ) );
		assert_same( 0, count( Curtain_Test_State::$actions['wp_head'] ?? array() ) );
		$src = (string) file_get_contents( dirname( __DIR__ ) . '/includes/class-rest.php' );
		assert_false( str_contains( $src, "'/products" ), 'no /products backfill route' );
		assert_false( str_contains( $src, 'get_product' ), 'no backfill callback' );
	}
);

test(
	'Connect redirect: only https://checkout.stripe.com/',
	static function (): void {
		assert_true( Settings::is_stripe_checkout_url( 'https://checkout.stripe.com/c/pay/cs_test_a1b2#fid' ) );
		assert_true( Settings::is_stripe_checkout_url( 'HTTPS://CHECKOUT.STRIPE.COM/c/pay/x' ) );
		foreach ( array(
			'',
			'http://checkout.stripe.com/c/pay/x',
			'https://checkout.stripe.com.evil.example/c/pay/x',
			'https://evil.example/checkout.stripe.com/',
			'https://evilcheckout.stripe.com/c',
			'https://stripe.com/',
			'https://checkout.stripe.com:8443/c',
			'https://user@checkout.stripe.com/c',
			'https://checkout.stripe.com@evil.example/c',
			'//checkout.stripe.com/c',
			'javascript:alert(1)//checkout.stripe.com/',
			"https://checkout.stripe.com/\nLocation: https://evil.example",
			'https://checkout.stripe.com\\@evil.example/',
		) as $bad ) {
			assert_false( Settings::is_stripe_checkout_url( $bad ), 'url ' . var_export( $bad, true ) );
		}
	}
);

test(
	'readme: current Tested up to headers, no backfill endpoint, honest source location',
	static function (): void {
		$readme = (string) file_get_contents( dirname( __DIR__ ) . '/readme.txt' );
		assert_contains( 'Tested up to: 7.1', $readme );
		assert_contains( 'WC tested up to: 11.2', $readme );
		assert_false( str_contains( $readme, '/wp-json/curtain/v1/products' ), 'backfill endpoint no longer documented' );
		assert_false( str_contains( $readme, 'github.com/curtain/curtain' ), 'no unpublished repository URL' );
		assert_contains( 'available on request', $readme );
		$main = (string) file_get_contents( dirname( __DIR__ ) . '/curtain.php' );
		assert_contains( 'WC tested up to:   11.2', $main );
	}
);
