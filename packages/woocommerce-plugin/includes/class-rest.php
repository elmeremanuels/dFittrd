<?php
/**
 * Domain proof for Connect (carry-over #12):
 *
 *   GET /wp-json/curtain/v1/verify   (or /?rest_route=/curtain/v1/verify), at the root of the host
 *
 * On every Connect path (manual key and Stripe Checkout alike) the Curtain API issues keys only
 * after it has read the nonce it handed out at Connect back from the root of this host, which
 * proves that whoever clicked Connect controls the site they claimed. The API reads only the REST
 * route (no meta tag: a string reflected on a page must not count as proof), so WordPress must
 * answer at the host root, not in a subdirectory. The answer exists only while a Connect is pending
 * and the nonce is cleared when the connection finishes or is cancelled. The nonce is not a
 * secret (the API derives it from the Connect token with its own key; it cannot be turned back
 * into the token), so serving it publicly is safe.
 *
 * The signed backfill endpoints (`/curtain/v1/products…`) that used to live here were removed
 * (carry-over #13): the Curtain API never had a signer for them (it stores only a hash of the
 * key for Bearer auth), and nothing needs them, because the plugin pushes every product on save
 * and "Sync all" on the settings page re-pushes the whole catalogue. Removing an unauthenticated
 * surface beats keeping an unused signed one.
 *
 * @package Curtain
 */

declare(strict_types=1);

namespace Curtain;

defined('ABSPATH') || defined('CURTAIN_TESTING') || exit;

final class Rest {

	public const NAMESPACE   = 'curtain/v1';
	public const VERIFY_PATH = '/verify';

	public static function register(): void {
		add_action( 'rest_api_init', array( self::class, 'routes' ) );
	}

	public static function routes(): void {
		register_rest_route(
			self::NAMESPACE,
			self::VERIFY_PATH,
			array(
				'methods'             => \WP_REST_Server::READABLE,
				'callback'            => array( self::class, 'verify' ),
				// Public on purpose: the Curtain API reads it without credentials (see the file header).
				'permission_callback' => '__return_true',
			)
		);
	}

	/** The nonce to publish, or '' when no Connect is pending (or the shop is already connected). */
	public static function pending_nonce(): string {
		$s     = Settings::all();
		$nonce = (string) ( $s['connect_verify_nonce'] ?? '' );
		if ( '' === $nonce || '' === (string) $s['connect_token'] || Settings::is_connected() ) {
			return '';
		}
		return 1 === preg_match( '/^cv_[a-f0-9]{16,64}$/', $nonce ) ? $nonce : '';
	}

	/** @return array{status:int,body:array<string,mixed>} */
	public static function verify_payload(): array {
		$nonce = self::pending_nonce();
		if ( '' === $nonce ) {
			return array(
				'status' => 404,
				'body'   => array(
					'error' => array(
						'code'    => 'not_found',
						'message' => 'no pending Curtain connection',
					),
				),
			);
		}
		return array(
			'status' => 200,
			'body'   => array( 'nonce' => $nonce ),
		);
	}

	public static function verify(): \WP_REST_Response {
		$p = self::verify_payload();
		$r = new \WP_REST_Response( $p['body'], $p['status'] );
		$r->header( 'Cache-Control', 'no-store' );
		return $r;
	}
}
