<?php
/**
 * "Open the Curtain console" on the settings page (inventory S2): the plugin asks the API for a
 * one-time sign-in link with the shop's own PK-HMAC credentials and sends the browser there. The
 * link is kept nowhere, and the browser is only ever sent to the console's own sign-in page.
 *
 * @package Curtain\Tests
 */

declare(strict_types=1);

use Curtain\Hmac;
use Curtain\Settings;

require_once __DIR__ . '/settings-shims.php';

/** A link as the API answers it; the token is built here, never a literal from anywhere real. */
function curtain_test_console_url( string $origin = 'https://app.curtain.fit' ): string {
	return $origin . '/merchant/link#t=cl_' . str_repeat( 'Ab3_-', 8 ) . 'xyz';
}

test(
	'the settings page of a connected shop has the button, as its own form that opens a new tab',
	static function (): void {
		curtain_settings_connected();
		$html = curtain_render_settings();
		assert_true( 1 === preg_match( '#<form method="post" action="https://shop\.example/wp-admin/admin-post\.php" target="_blank">(.*?)</form>#s', $html, $m ), 'a form of its own, new tab' );
		assert_contains( 'name="action" value="curtain_console"', $m[1] );
		assert_contains( '<input type="hidden" name="_wpnonce"', $m[1], 'nonce' );
		assert_contains( '>Open the Curtain console</button>', $m[1] );
		assert_same( 1, substr_count( $html, 'Open the Curtain console' ), 'one button' );
		assert_contains( 'signs you in: no password, no key', $html );
		// The page itself holds no link and no token: the link is asked for when the button is pressed.
		assert_false( str_contains( $html, '/merchant/link' ) );
		assert_same( array(), Curtain_Test_State::$requests, 'rendering asks the API for nothing' );
	}
);

test(
	'a shop that is not connected has no console button',
	static function (): void {
		curtain_setup_state( 'new' );
		$html = curtain_render_settings();
		assert_false( str_contains( $html, 'curtain_console' ) );
		assert_false( str_contains( $html, 'Open the Curtain console' ) );
		$r = Settings::console_link();
		assert_same( array( false, '', 'warning' ), array( $r['ok'], $r['url'], $r['type'] ) );
		assert_same( array(), Curtain_Test_State::$requests, 'nothing is sent' );
	}
);

test(
	'pressing the button asks the API with the shop\'s PK-HMAC signature and returns the link',
	static function (): void {
		curtain_settings_connected();
		$url                              = curtain_test_console_url();
		Curtain_Test_State::$http_handler = static fn() => curtain_http_response( 200, array( 'url' => $url, 'expiresAt' => '2026-11-20T10:10:00.000Z' ) );
		$r                                = Settings::console_link();
		assert_same( array( 'ok' => true, 'url' => $url, 'notice' => '', 'type' => 'success' ), $r );
		assert_same( 1, count( Curtain_Test_State::$requests ) );
		$req = Curtain_Test_State::$requests[0];
		assert_same( 'https://api.curtain.fit/v1/merchant/console-link', $req['url'] );
		assert_same( 'POST', $req['args']['method'] );
		assert_same( 0, $req['args']['redirection'], 'the API call follows no redirect' );
		// The same credentials as a product sync: the public prefix and a signature, never the secret.
		$auth = (string) $req['args']['headers']['Authorization'];
		assert_true( 1 === preg_match( '/^PK-HMAC key=(pk_test_setup000001), ts=(\d+), sig=([0-9a-f]{64})$/', $auth, $m ), $auth );
		$secret = (string) Settings::get( 'api_key' );
		assert_false( str_contains( $auth, $secret ) );
		assert_same( Hmac::sign( $secret, 'POST', '/v1/merchant/console-link', $m[2], '' ), $m[3], 'signed over the method, path, time and empty body' );
	}
);

test(
	'the link is kept nowhere: not in an option, a transient or the last-error line',
	static function (): void {
		curtain_settings_connected();
		$url                              = curtain_test_console_url();
		$token                            = substr( $url, strpos( $url, '#t=' ) + 3 );
		Curtain_Test_State::$http_handler = static fn() => curtain_http_response( 200, array( 'url' => $url ) );
		Settings::console_link();
		$stored = var_export( array( Curtain_Test_State::$options, Curtain_Test_State::$meta, Curtain_Test_State::$cron ), true );
		assert_false( str_contains( $stored, $token ), 'the token is not stored' );
		assert_false( str_contains( $stored, '/merchant/link' ), 'the link is not stored' );
		assert_false( str_contains( curtain_render_settings(), $token ), 'nor shown on the page afterwards' );
	}
);

test(
	'the browser is only sent to the sign-in page of this shop\'s console',
	static function (): void {
		curtain_settings_connected();
		$t = '#t=cl_' . str_repeat( 'a', 43 );
		assert_true( Settings::is_console_link_url( 'https://app.curtain.fit/merchant/link' . $t ) );
		foreach ( array(
			'another host'             => 'https://evil.example/merchant/link' . $t,
			'the api host'             => 'https://api.curtain.fit/merchant/link' . $t,
			'a look-alike host'        => 'https://app.curtain.fit.evil.example/merchant/link' . $t,
			'credentials in the url'   => 'https://app.curtain.fit@evil.example/merchant/link' . $t,
			'user before the host'     => 'https://user:pw@app.curtain.fit/merchant/link' . $t,
			'plain http'               => 'http://app.curtain.fit/merchant/link' . $t,
			'another scheme'           => 'javascript://app.curtain.fit/merchant/link' . $t,
			'another path'             => 'https://app.curtain.fit/merchant/login' . $t,
			'a longer path'            => 'https://app.curtain.fit/merchant/link/x' . $t,
			'the token in the query'   => 'https://app.curtain.fit/merchant/link?t=cl_' . str_repeat( 'a', 43 ),
			'a query next to it'       => 'https://app.curtain.fit/merchant/link?next=https://evil.example' . $t,
			'no token'                 => 'https://app.curtain.fit/merchant/link',
			'a short token'            => 'https://app.curtain.fit/merchant/link#t=abc',
			'something after the token' => 'https://app.curtain.fit/merchant/link' . $t . '&x=<script>',
			'a space'                  => 'https://app.curtain.fit/merchant/link' . $t . ' x',
			'a line break'             => "https://app.curtain.fit/merchant/link\r\nLocation: https://evil.example" . $t,
			'a backslash'              => 'https://app.curtain.fit\\@evil.example/merchant/link' . $t,
			'nothing'                  => '',
		) as $what => $bad ) {
			assert_false( Settings::is_console_link_url( $bad ), $what );
		}
		assert_false( Settings::is_console_link_url( 'https://app.curtain.fit/merchant/link#t=' . str_repeat( 'a', 3000 ) ), 'too long' );

		// A staging API on its own host: the console is on the matching app. host, not production's.
		curtain_settings_connected( 'https://api.staging.curtain.fit' );
		assert_true( Settings::is_console_link_url( 'https://app.staging.curtain.fit/merchant/link' . $t ) );
		assert_false( Settings::is_console_link_url( 'https://app.curtain.fit/merchant/link' . $t ) );
		// One host for both (no api. prefix), and local development over http.
		curtain_settings_connected( 'https://curtain.example' );
		assert_true( Settings::is_console_link_url( 'https://curtain.example/merchant/link' . $t ) );
		curtain_settings_connected( 'http://localhost:3001' );
		assert_true( Settings::is_console_link_url( 'http://localhost:3000/merchant/link' . $t ) );
		assert_false( Settings::is_console_link_url( 'http://evil.example/merchant/link' . $t ) );
	}
);

test(
	'an answer that is not the console opens nothing and says so',
	static function (): void {
		curtain_settings_connected();
		foreach ( array( array( 'url' => curtain_test_console_url( 'https://evil.example' ) ), array( 'url' => '' ), array(), array( 'url' => array( 'x' ) ) ) as $body ) {
			Curtain_Test_State::$http_handler = static fn() => curtain_http_response( 200, $body );
			$r                                = Settings::console_link();
			assert_same( array( false, '', 'error' ), array( $r['ok'], $r['url'], $r['type'] ) );
			assert_contains( 'is not the Curtain console', $r['notice'] );
			assert_false( str_contains( $r['notice'], 'evil.example' ), 'the refused address is not repeated' );
		}
	}
);

test(
	'a refusal is explained in plain words: too often, unreachable, anything else',
	static function (): void {
		curtain_settings_connected();
		Curtain_Test_State::$http_handler = static fn() => curtain_http_response( 429, array( 'error' => array( 'code' => 'rate_limited', 'message' => 'too many sign-in links for this shop' ) ) );
		$r                                = Settings::console_link();
		assert_same( array( false, 'warning' ), array( $r['ok'], $r['type'] ) );
		assert_contains( 'Wait ten minutes', $r['notice'] );

		Curtain_Test_State::$http_handler = static fn() => new WP_Error( 'http_request_failed', 'cURL error 28' );
		$r                                = Settings::console_link();
		assert_same( array( false, 'error' ), array( $r['ok'], $r['type'] ) );
		assert_contains( 'Curtain could not be reached', $r['notice'] );
		assert_false( str_contains( $r['notice'], 'cURL' ) );

		Curtain_Test_State::$http_handler = static fn() => curtain_http_response( 401, array( 'error' => array( 'code' => 'bad_signature', 'message' => 'bad signature' ) ) );
		$r                                = Settings::console_link();
		assert_same( 'The console could not be opened: bad signature', $r['notice'] );
		assert_same( '', $r['url'] );
	}
);

test(
	'the handler is registered, checks the capability and its own nonce, and answers without a cache or a referrer',
	static function (): void {
		Curtain_Test_State::reset();
		Settings::register();
		assert_same( array( array( Settings::class, 'handle_console' ) ), Curtain_Test_State::$actions['admin_post_curtain_console'] ?? null );
		$src = (string) file_get_contents( dirname( __DIR__ ) . '/includes/class-settings.php' );
		assert_true( 1 === preg_match( '/function handle_console\(\): void \{(.*?)\n\t\}/s', $src, $m ) );
		$body  = $m[1];
		$order = array_map( static fn( string $needle ) => strpos( $body, $needle ), array( 'self::guard();', "check_admin_referer( 'curtain_console' );", 'self::console_link();', 'nocache_headers();', "header( 'Referrer-Policy: no-referrer' );", 'wp_redirect(' ) );
		assert_false( in_array( false, $order, true ), 'every step is there' );
		$sorted = $order;
		sort( $sorted );
		assert_same( $sorted, $order, 'in this order' );
	}
);
