<?php
/**
 * What the admin-post handler of "Open the Curtain console" does, OUTSIDE WordPress (tests/shims.php)
 * but against a real api over real HTTP: Settings::console_link() signs the request with the shop's
 * key and checks the answer. Prints `{ok, url, notice}` for e2e/console-link-shots.mjs, which sends
 * the browser on. Credentials come from the environment (CURTAIN_API_BASE, CURTAIN_PK, CURTAIN_SK).
 *
 * @package Curtain\E2E
 */

declare(strict_types=1);

require dirname( __DIR__ ) . '/tests/shims.php';
require dirname( __DIR__ ) . '/includes/autoload.php';
require dirname( __DIR__ ) . '/tests/settings-shims.php';

curtain_setup_state( 'done' );
\Curtain\Settings::update(
	array(
		'api_base'          => (string) getenv( 'CURTAIN_API_BASE' ),
		'api_key'           => (string) getenv( 'CURTAIN_SK' ),
		'public_key_prefix' => (string) getenv( 'CURTAIN_PK' ),
	)
);
// The shim's HTTP, made real: one request with the headers and body the plugin built.
Curtain_Test_State::$http_handler = static function ( string $url, array $args ) {
	$headers = array();
	foreach ( $args['headers'] as $k => $v ) {
		$headers[] = $k . ': ' . $v;
	}
	$body = @file_get_contents( // phpcs:ignore -- local test transport.
		$url,
		false,
		stream_context_create(
			array(
				'http' => array(
					'method'          => $args['method'],
					'header'          => implode( "\r\n", $headers ),
					'content'         => (string) ( $args['body'] ?? '' ),
					'ignore_errors'   => true,
					'follow_location' => 0,
					'timeout'         => 10,
				),
			)
		)
	);
	if ( false === $body ) {
		return new WP_Error( 'http_request_failed', 'unreachable' );
	}
	$code = 1 === preg_match( '#^HTTP/\S+ (\d{3})#', (string) ( $http_response_header[0] ?? '' ), $m ) ? (int) $m[1] : 0;
	return curtain_http_response( $code, $body );
};
$r = \Curtain\Settings::console_link();
echo json_encode( array( 'ok' => $r['ok'], 'url' => $r['url'], 'notice' => $r['notice'] ) ); // phpcs:ignore
