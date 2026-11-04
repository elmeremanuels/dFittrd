<?php
/**
 * Signed read endpoint for backfill / pull-resync by the Paskamer backend:
 *
 *   GET /wp-json/paskamer/v1/products/{id}
 *   GET /wp-json/paskamer/v1/products?page&per_page&status
 *
 * Auth: the same PK-HMAC scheme the plugin uses outbound, with the roles swapped — the backend
 * signs with the shop's secret and presents the public prefix; the plugin verifies with its stored
 * key. Only available once the shop is connected. The response is the WooCommerce REST v3 product
 * subset `fromWooMeta` consumes (+ `meta_data` with the `_paskamer_*` keys) and the plugin's own
 * `payload` draft.
 *
 * @package Paskamer
 */

declare(strict_types=1);

namespace Paskamer;

defined('ABSPATH') || defined('PASKAMER_TESTING') || exit;

final class Rest {

	public const NAMESPACE = 'paskamer/v1';

	public static function register(): void {
		add_action( 'rest_api_init', array( self::class, 'routes' ) );
	}

	public static function routes(): void {
		register_rest_route(
			self::NAMESPACE,
			'/products/(?P<id>\d+)',
			array(
				'methods'             => \WP_REST_Server::READABLE,
				'callback'            => array( self::class, 'get_product' ),
				'permission_callback' => array( self::class, 'authorize' ),
				'args'                => array(
					'id' => array(
						'type'     => 'integer',
						'required' => true,
					),
				),
			)
		);
		register_rest_route(
			self::NAMESPACE,
			'/products',
			array(
				'methods'             => \WP_REST_Server::READABLE,
				'callback'            => array( self::class, 'list_products' ),
				'permission_callback' => array( self::class, 'authorize' ),
				'args'                => array(
					'page'     => array(
						'type'    => 'integer',
						'default' => 1,
						'minimum' => 1,
					),
					'per_page' => array(
						'type'    => 'integer',
						'default' => 50,
						'minimum' => 1,
						'maximum' => 200,
					),
					'status'   => array(
						'type'    => 'string',
						'default' => 'publish',
					),
				),
			)
		);
	}

	/**
	 * @return true|\WP_Error
	 */
	public static function authorize( \WP_REST_Request $request ) {
		if ( ! Settings::is_connected() ) {
			return new \WP_Error( 'paskamer_not_connected', 'shop is not connected', array( 'status' => 403 ) );
		}
		$header = (string) $request->get_header( 'authorization' );
		if ( '' === $header && isset( $_SERVER['HTTP_AUTHORIZATION'] ) ) {
			$header = sanitize_text_field( wp_unslash( (string) $_SERVER['HTTP_AUTHORIZATION'] ) );
		}
		$target = isset( $_SERVER['REQUEST_URI'] ) ? (string) wp_unslash( $_SERVER['REQUEST_URI'] ) : $request->get_route(); // phpcs:ignore WordPress.Security.ValidatedSanitizedInput -- compared against an HMAC, never output.
		$body   = (string) $request->get_body();
		$s      = Settings::all();
		$result = Hmac::verify( $header, (string) $s['public_key_prefix'], array( (string) $s['api_key'] ), $request->get_method(), $target, $body );
		if ( ! $result['ok'] ) {
			return new \WP_Error( 'paskamer_' . $result['code'], 'invalid PK-HMAC signature (' . $result['code'] . ')', array( 'status' => 401 ) );
		}
		return true;
	}

	public static function get_product( \WP_REST_Request $request ): \WP_REST_Response {
		$product = wc_get_product( (int) $request['id'] );
		if ( ! $product instanceof \WC_Product ) {
			return self::response( array( 'error' => array( 'code' => 'not_found', 'message' => 'product not found' ) ), 404 );
		}
		return self::response( self::serialize( $product ) );
	}

	public static function list_products( \WP_REST_Request $request ): \WP_REST_Response {
		$page     = max( 1, (int) $request['page'] );
		$per_page = max( 1, min( 200, (int) $request['per_page'] ) );
		$status   = in_array( (string) $request['status'], array( 'publish', 'draft', 'private', 'pending', 'any' ), true ) ? (string) $request['status'] : 'publish';
		$ids      = wc_get_products(
			array(
				'status'  => $status,
				'limit'   => $per_page,
				'page'    => $page,
				'orderby' => 'ID',
				'order'   => 'ASC',
				'return'  => 'ids',
			)
		);
		$items = array();
		foreach ( (array) $ids as $id ) {
			$items[] = array(
				'id'         => (int) $id,
				'externalId' => (string) $id,
				'syncStatus' => (string) get_post_meta( (int) $id, Vocab::META_SYNC_STATUS, true ),
				'syncedAt'   => (string) get_post_meta( (int) $id, Vocab::META_SYNCED_AT, true ),
			);
		}
		return self::response(
			array(
				'items'    => $items,
				'page'     => $page,
				'per_page' => $per_page,
				'hasMore'  => count( (array) $ids ) === $per_page,
				'currency' => get_woocommerce_currency(),
			)
		);
	}

	/** @return array<string,mixed> */
	public static function serialize( \WC_Product $product ): array {
		$snapshot          = Product_Snapshot::from_product( $product );
		$built             = Sync::build( $product );
		$out               = $snapshot;
		$out['meta_data']  = Product_Snapshot::wire_meta( $product->get_id() );
		$out['payload']    = $built['payload'];
		$out['warnings']   = $built['warnings'];
		$out['syncState']  = array(
			'status'      => (string) get_post_meta( $product->get_id(), Vocab::META_SYNC_STATUS, true ),
			'error'       => (string) get_post_meta( $product->get_id(), Vocab::META_SYNC_ERROR, true ),
			'syncedAt'    => (string) get_post_meta( $product->get_id(), Vocab::META_SYNCED_AT, true ),
			'contentHash' => (string) get_post_meta( $product->get_id(), Vocab::META_CONTENT_HASH, true ),
		);
		return $out;
	}

	/** @param array<string,mixed> $data */
	private static function response( array $data, int $status = 200 ): \WP_REST_Response {
		$r = new \WP_REST_Response( $data, $status );
		$r->header( 'Cache-Control', 'no-store' );
		return $r;
	}
}
