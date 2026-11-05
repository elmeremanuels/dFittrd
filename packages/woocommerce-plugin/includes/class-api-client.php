<?php
/**
 * HTTP client for the Curtain merchant API (apps/api, routes/merchant.ts).
 *
 * Every call goes through `wp_remote_request`; outbound requests happen only when the merchant
 * has connected (or is clicking Connect). Errors never throw: the result array carries
 * `ok`, `status`, `data`, `error_code`, `error_message`, `transport_error`.
 *
 * @package Curtain
 */

declare(strict_types=1);

namespace Curtain;

defined('ABSPATH') || defined('CURTAIN_TESTING') || exit;

final class Api_Client {

	public const TIMEOUT = 15;

	/**
	 * @var array<string,mixed>
	 */
	private array $settings;

	/** @param array<string,mixed> $settings Settings::all() snapshot. */
	public function __construct( array $settings ) {
		$this->settings = $settings;
	}

	public static function from_settings(): self {
		return new self( Settings::all() );
	}

	// ---- endpoints -------------------------------------------------------------------------

	/**
	 * POST /v1/merchant/woo/connect
	 *
	 * @return array<string,mixed>
	 */
	public function connect( string $site_url, string $name, ?string $email, string $return_url ): array {
		$body = array(
			'siteUrl'   => $site_url,
			'name'      => $name,
			'returnUrl' => $return_url,
		);
		if ( null !== $email && '' !== $email ) {
			$body['email'] = $email;
		}
		return $this->request( 'POST', '/v1/merchant/woo/connect', $body, 'none' );
	}

	/** POST /v1/merchant/woo/complete @return array<string,mixed> */
	public function complete( string $connect_token ): array {
		return $this->request( 'POST', '/v1/merchant/woo/complete', array( 'connectToken' => $connect_token ), 'none' );
	}

	/**
	 * PUT /v1/merchant/shops/self — the "hello": identifies the plugin and returns plan/paused state.
	 *
	 * @param array<string,mixed> $body
	 * @return array<string,mixed>
	 */
	public function hello( array $body, string $auth = 'hmac', ?string $bearer = null ): array {
		return $this->request( 'PUT', '/v1/merchant/shops/self', $body, $auth, $bearer );
	}

	/** PUT /v1/merchant/products/{externalId} @param array<string,mixed> $payload @return array<string,mixed> */
	public function upsert_product( string $external_id, array $payload ): array {
		return $this->request( 'PUT', '/v1/merchant/products/' . rawurlencode( $external_id ), $payload );
	}

	/** POST /v1/merchant/products/validate (dry run) @param array<string,mixed> $payload @return array<string,mixed> */
	public function validate_product( array $payload ): array {
		return $this->request( 'POST', '/v1/merchant/products/validate', array( 'payload' => $payload ) );
	}

	/** DELETE /v1/merchant/products/{externalId} (archives) @return array<string,mixed> */
	public function delete_product( string $external_id ): array {
		return $this->request( 'DELETE', '/v1/merchant/products/' . rawurlencode( $external_id ), null );
	}

	/** GET /v1/merchant/products?status&limit @return array<string,mixed> */
	public function list_products( ?string $status = null, int $limit = 50, ?string $cursor = null ): array {
		$q = array( 'limit' => $limit );
		if ( $status ) {
			$q['status'] = $status;
		}
		if ( $cursor ) {
			$q['cursor'] = $cursor;
		}
		return $this->request( 'GET', '/v1/merchant/products?' . http_build_query( $q ), null );
	}

	// ---- transport -------------------------------------------------------------------------

	/**
	 * @param array<string,mixed>|null $body
	 * @param 'hmac'|'bearer'|'none'   $auth
	 * @return array{ok:bool,status:int,data:array<string,mixed>|null,error_code:?string,error_message:?string,transport_error:bool}
	 */
	public function request( string $method, string $path, ?array $body = null, string $auth = 'hmac', ?string $bearer = null ): array {
		$url      = $this->base() . $path;
		$raw_body = null === $body ? '' : (string) wp_json_encode( $body, JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE );
		$headers  = array(
			'Accept'     => 'application/json',
			'User-Agent' => self::user_agent(),
		);
		if ( null !== $body ) {
			$headers['Content-Type'] = 'application/json';
		}

		if ( 'hmac' === $auth ) {
			$public = (string) ( $this->settings['public_key_prefix'] ?? '' );
			$secret = (string) ( $this->settings['api_key'] ?? '' );
			if ( '' === $public || '' === $secret ) {
				return self::failure( 0, 'not_connected', 'the shop is not connected to Curtain' );
			}
			$headers['Authorization'] = Hmac::header( $public, $secret, $method, $url, $raw_body );
		} elseif ( 'bearer' === $auth ) {
			if ( null === $bearer || '' === $bearer ) {
				return self::failure( 0, 'not_connected', 'missing merchant key' );
			}
			$headers['Authorization'] = 'Bearer ' . $bearer;
		}

		$response = wp_remote_request(
			$url,
			array(
				'method'      => $method,
				'timeout'     => self::TIMEOUT,
				'redirection' => 0,
				'headers'     => $headers,
				'body'        => null === $body ? null : $raw_body,
				'sslverify'   => true,
			)
		);

		if ( is_wp_error( $response ) ) {
			return self::failure( 0, 'network_error', $response->get_error_message(), true );
		}

		$status = (int) wp_remote_retrieve_response_code( $response );
		$text   = (string) wp_remote_retrieve_body( $response );
		$data   = '' === $text ? null : json_decode( $text, true );
		$data   = is_array( $data ) ? $data : null;

		if ( $status >= 200 && $status < 300 ) {
			return array(
				'ok'              => true,
				'status'          => $status,
				'data'            => $data,
				'error_code'      => null,
				'error_message'   => null,
				'transport_error' => false,
			);
		}

		$code    = isset( $data['error']['code'] ) ? (string) $data['error']['code'] : 'http_' . $status;
		$message = isset( $data['error']['message'] ) ? (string) $data['error']['message'] : 'HTTP ' . $status;
		return array(
			'ok'              => false,
			'status'          => $status,
			'data'            => $data,
			'error_code'      => $code,
			'error_message'   => $message,
			'transport_error' => false,
		);
	}

	public function base(): string {
		$base = trim( (string) ( $this->settings['api_base'] ?? '' ) );
		if ( '' === $base ) {
			$base = CURTAIN_DEFAULT_API_BASE;
		}
		return rtrim( $base, '/' );
	}

	public static function user_agent(): string {
		$wp = function_exists( 'get_bloginfo' ) ? (string) get_bloginfo( 'version' ) : '';
		$wc = defined( 'WC_VERSION' ) ? (string) WC_VERSION : '';
		return sprintf( 'Curtain-WooCommerce/%s (WordPress/%s; WooCommerce/%s)', CURTAIN_VERSION, $wp, $wc );
	}

	/** @return array{ok:bool,status:int,data:null,error_code:string,error_message:string,transport_error:bool} */
	private static function failure( int $status, string $code, string $message, bool $transport = false ): array {
		return array(
			'ok'              => false,
			'status'          => $status,
			'data'            => null,
			'error_code'      => $code,
			'error_message'   => $message,
			'transport_error' => $transport,
		);
	}
}
