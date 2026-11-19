<?php
/**
 * Regressions from the platform check on a real WordPress 7.1.4 + WooCommerce 11.2.2 on PHP 8.1 and
 * 8.5 (docs/reports/claude-platform-checks.md).
 *
 * @package Curtain\Tests
 */

declare(strict_types=1);

/**
 * Plugin Check 2.2.0 reports `WordPress.Security.EscapeOutput.ExceptionNotEscaped` as an ERROR for
 * every `throw new X( <expr> )` whose message is not passed through an escaping function. The
 * garment-tape code threw one (class-garment-tape.php, stretched_below_relaxed). A static scan keeps
 * the next one out without needing WordPress.
 */
test(
	'every exception thrown by the plugin escapes its message (Plugin Check ExceptionNotEscaped)',
	function (): void {
		$root  = dirname( __DIR__ );
		$files = array_merge( glob( $root . '/includes/*.php' ), array( $root . '/curtain.php', $root . '/uninstall.php' ) );
		$bad   = array();
		foreach ( $files as $file ) {
			$lines = file( $file );
			foreach ( $lines as $n => $line ) {
				if ( ! preg_match( '/throw\s+new\s+\\\\?[A-Za-z_\\\\]+\s*\(\s*(.*)$/', $line, $m ) ) {
					continue;
				}
				$arg = trim( $m[1] );
				// No message, or an escaped one.
				if ( str_starts_with( $arg, ')' ) || preg_match( '/^(esc_html|esc_attr|esc_html__|absint|intval)\s*\(/', $arg ) ) {
					continue;
				}
				$bad[] = basename( $file ) . ':' . ( $n + 1 ) . ' ' . trim( $line );
			}
		}
		assert_same( array(), $bad, 'unescaped exception messages' );
	}
);

test(
	'Garment_Tape::fill still throws RangeException with the readable message for a stretched band below the relaxed one',
	function (): void {
		$chart = array(
			array( 'size' => 'M' ),
		);
		$thrown = '';
		try {
			\Curtain\Garment_Tape::fill(
				$chart,
				array(
					array(
						'size'             => 'M',
						'waistRelaxedCm'   => 40,
						'waistStretchedCm' => 35,
					),
				)
			);
		} catch ( \RangeException $e ) {
			$thrown = $e->getMessage();
		}
		assert_contains( 'Size M: the stretched waistband (35 cm) is smaller than the relaxed waistband (40 cm)', $thrown );
	}
);

/**
 * On the real stack a product with a fabric but no drape was refused by the api with a 400
 * `validation`; the meta box showed only "request validation failed (validation)". The api's
 * `details` now go into the message, so the merchant reads which field to fix.
 */
test(
	'Api_Client: a 400 validation error names the failing fields from the api details',
	static function (): void {
		curtain_connect_test_shop();
		Curtain_Test_State::$http_handler = static fn() => curtain_http_response(
			400,
			array(
				'error' => array(
					'code'    => 'validation',
					'message' => 'request validation failed',
					'details' => array(
						array( 'path' => '/fabric/drape', 'message' => 'Invalid input: expected number, received undefined' ),
						array( 'path' => '/primaryColorHex', 'message' => 'Invalid input: expected string, received undefined' ),
					),
				),
			)
		);
		$res = \Curtain\Api_Client::from_settings()->upsert_product( '7', array( 'id' => '7' ) );
		assert_false( $res['ok'] );
		assert_same( 'validation', $res['error_code'] );
		assert_same( 'request validation failed — fabric.drape: Invalid input: expected number, received undefined; primaryColorHex: Invalid input: expected string, received undefined', $res['error_message'] );

		// Without details the message is unchanged.
		Curtain_Test_State::$http_handler = static fn() => curtain_http_response( 400, array( 'error' => array( 'code' => 'validation', 'message' => 'request validation failed' ) ) );
		$res = \Curtain\Api_Client::from_settings()->upsert_product( '7', array( 'id' => '7' ) );
		assert_same( 'request validation failed', $res['error_message'] );
	}
);
