<?php
/**
 * Push-on-save sync: WooCommerce product → GarmentPayload draft → PUT /v1/merchant/products/{id}
 * with PK-HMAC auth; retries through the Queue (Action Scheduler or WP-Cron); DELETE (archive) on
 * trash / unpublish; "Sync all" for backfill. Nothing leaves the site unless Settings::is_connected().
 *
 * Per-product state is kept in private meta (Vocab::META_SYNC_* …) for the meta box status panel.
 *
 * @package Curtain
 */

declare(strict_types=1);

namespace Curtain;

defined( 'ABSPATH' ) || exit;

final class Sync {

	public const MAX_ATTEMPTS  = 6;
	public const SYNC_ALL_PAGE = 50;

	/** @var array<int,bool> product ids already enqueued in this request */
	private static array $seen = array();

	public static function register_hooks(): void {
		// Product CRUD (admin, REST, CSV importer, CLI all go through WC_Product::save()).
		add_action( 'woocommerce_new_product', array( self::class, 'on_product_saved' ), 20 );
		add_action( 'woocommerce_update_product', array( self::class, 'on_product_saved' ), 20 );
		add_action( 'woocommerce_save_product_variation', array( self::class, 'on_variation_saved' ), 20, 1 );

		// Visibility / lifecycle.
		add_action( 'transition_post_status', array( self::class, 'on_transition' ), 20, 3 );
		add_action( 'wp_trash_post', array( self::class, 'on_trash' ), 20 );
		add_action( 'untrashed_post', array( self::class, 'on_untrash' ), 20 );
		add_action( 'before_delete_post', array( self::class, 'on_trash' ), 20 );

		// Jobs.
		add_action( Queue::HOOK_PUSH, array( self::class, 'job_push' ), 10, 2 );
		add_action( Queue::HOOK_DELETE, array( self::class, 'job_delete' ), 10, 2 );
		add_action( Queue::HOOK_SYNC_ALL, array( self::class, 'job_sync_all' ), 10, 1 );
	}

	// ---- hook handlers ---------------------------------------------------------------------

	public static function on_product_saved( $product_id ): void {
		$product_id = (int) $product_id;
		if ( $product_id <= 0 || ! Settings::is_connected() ) {
			return;
		}
		if ( 'publish' !== get_post_status( $product_id ) ) {
			return;
		}
		self::enqueue_push( $product_id );
	}

	public static function on_variation_saved( $variation_id ): void {
		$parent = (int) wp_get_post_parent_id( (int) $variation_id );
		if ( $parent > 0 ) {
			self::on_product_saved( $parent );
		}
	}

	public static function on_transition( string $new_status, string $old_status, \WP_Post $post ): void {
		if ( 'product' !== $post->post_type || $new_status === $old_status || ! Settings::is_connected() ) {
			return;
		}
		if ( 'publish' === $new_status ) {
			self::enqueue_push( (int) $post->ID );
		} elseif ( 'publish' === $old_status ) {
			self::enqueue_delete( (int) $post->ID );
		}
	}

	public static function on_trash( $post_id ): void {
		$post_id = (int) $post_id;
		if ( 'product' !== get_post_type( $post_id ) || ! Settings::is_connected() ) {
			return;
		}
		self::enqueue_delete( $post_id );
	}

	public static function on_untrash( $post_id ): void {
		$post_id = (int) $post_id;
		if ( 'product' === get_post_type( $post_id ) && 'publish' === get_post_status( $post_id ) ) {
			self::on_product_saved( $post_id );
		}
	}

	// ---- enqueue ---------------------------------------------------------------------------

	public static function enqueue_push( int $product_id, int $delay = 0 ): void {
		if ( isset( self::$seen[ $product_id ] ) ) {
			return;
		}
		self::$seen[ $product_id ] = true;
		update_post_meta( $product_id, Vocab::META_SYNC_STATUS, 'pending' );
		Queue::enqueue( Queue::HOOK_PUSH, array( $product_id, 1 ), $delay );
	}

	public static function enqueue_delete( int $product_id ): void {
		update_post_meta( $product_id, Vocab::META_SYNC_STATUS, 'archiving' );
		Queue::enqueue( Queue::HOOK_DELETE, array( (string) $product_id, 1 ) );
	}

	public static function enqueue_sync_all(): void {
		Queue::enqueue( Queue::HOOK_SYNC_ALL, array( 1 ) );
	}

	// ---- jobs ------------------------------------------------------------------------------

	/**
	 * Push one product now (also used synchronously by the "Sync now" row action).
	 *
	 * @return array{ok:bool,outcome:string,message:string}
	 */
	public static function job_push( $product_id, $attempt = 1 ): array {
		$product_id = (int) $product_id;
		$attempt    = max( 1, (int) $attempt );
		if ( ! Settings::is_connected() ) {
			return self::outcome( false, 'skipped', 'not connected' );
		}
		$product = wc_get_product( $product_id );
		if ( ! $product instanceof \WC_Product ) {
			return self::outcome( false, 'skipped', 'product not found' );
		}
		if ( 'publish' !== $product->get_status() ) {
			return self::outcome( false, 'skipped', 'product is not published' );
		}

		$built  = self::build( $product );
		$client = Api_Client::from_settings();
		$res    = $client->upsert_product( (string) $product_id, $built['payload'] );
		$class  = self::classify( $res['status'], $res['error_code'], $res['transport_error'] );

		if ( 'ok' === $class ) {
			$data = $res['data'] ?? array();
			update_post_meta( $product_id, Vocab::META_SYNC_STATUS, (string) ( $data['status'] ?? 'incomplete' ) );
			update_post_meta( $product_id, Vocab::META_SCORE, (string) ( $data['score'] ?? '0' ) );
			update_post_meta( $product_id, Vocab::META_MISSING, wp_slash( (string) wp_json_encode( array_values( (array) ( $data['missingFields'] ?? array() ) ) ) ) );
			update_post_meta( $product_id, Vocab::META_CONTENT_HASH, (string) ( $data['contentHash'] ?? '' ) );
			update_post_meta( $product_id, Vocab::META_SYNCED_AT, (string) ( $data['updatedAt'] ?? gmdate( 'c' ) ) );
			delete_post_meta( $product_id, Vocab::META_SYNC_ERROR );
			Settings::update( array( 'last_sync_at' => time(), 'last_error' => '' ) );
			return self::outcome( true, 'synced', (string) ( $data['status'] ?? 'ok' ) );
		}

		$message = sprintf( '%s (%s)', (string) $res['error_message'], (string) $res['error_code'] );
		if ( 'retry' === $class && $attempt < self::MAX_ATTEMPTS ) {
			update_post_meta( $product_id, Vocab::META_SYNC_STATUS, 'retrying' );
			update_post_meta( $product_id, Vocab::META_SYNC_ERROR, wp_slash( $message ) );
			Queue::enqueue( Queue::HOOK_PUSH, array( $product_id, $attempt + 1 ), self::backoff( $attempt ) );
			return self::outcome( false, 'retry', $message );
		}
		update_post_meta( $product_id, Vocab::META_SYNC_STATUS, 'error' );
		update_post_meta( $product_id, Vocab::META_SYNC_ERROR, wp_slash( $message ) );
		Settings::update( array( 'last_error' => $message ) );
		return self::outcome( false, 'failed', $message );
	}

	/** @return array{ok:bool,outcome:string,message:string} */
	public static function job_delete( $external_id, $attempt = 1 ): array {
		$external_id = (string) $external_id;
		$attempt     = max( 1, (int) $attempt );
		if ( ! Settings::is_connected() ) {
			return self::outcome( false, 'skipped', 'not connected' );
		}
		$pid_check = (int) $external_id;
		if ( $pid_check > 0 && 'publish' === get_post_status( $pid_check ) ) {
			// Re-published after this delete was queued (or while it was backing off): a push has
			// marked the product pending/synced since, so archiving now would hide a live product.
			$state = (string) get_post_meta( $pid_check, Vocab::META_SYNC_STATUS, true );
			if ( '' !== $state && 'archiving' !== $state && 'archived' !== $state ) {
				return self::outcome( false, 'skipped', 'product was re-published' );
			}
		}
		$res   = Api_Client::from_settings()->delete_product( $external_id );
		$class = self::classify( $res['status'], $res['error_code'], $res['transport_error'] );
		$pid   = (int) $external_id;
		if ( 'ok' === $class || 404 === $res['status'] ) {
			if ( $pid > 0 && get_post( $pid ) ) {
				update_post_meta( $pid, Vocab::META_SYNC_STATUS, 'archived' );
				delete_post_meta( $pid, Vocab::META_SYNC_ERROR );
			}
			return self::outcome( true, 'archived', 'ok' );
		}
		$message = sprintf( '%s (%s)', (string) $res['error_message'], (string) $res['error_code'] );
		if ( 'retry' === $class && $attempt < self::MAX_ATTEMPTS ) {
			Queue::enqueue( Queue::HOOK_DELETE, array( $external_id, $attempt + 1 ), self::backoff( $attempt ) );
			return self::outcome( false, 'retry', $message );
		}
		if ( $pid > 0 && get_post( $pid ) ) {
			update_post_meta( $pid, Vocab::META_SYNC_STATUS, 'error' );
			update_post_meta( $pid, Vocab::META_SYNC_ERROR, wp_slash( $message ) );
		}
		return self::outcome( false, 'failed', $message );
	}

	/** Enqueue every published product, one page per job so large catalogues never time out. */
	public static function job_sync_all( $page = 1 ): void {
		$page = max( 1, (int) $page );
		if ( ! Settings::is_connected() ) {
			return;
		}
		$ids = wc_get_products(
			array(
				'status'  => 'publish',
				'limit'   => self::SYNC_ALL_PAGE,
				'page'    => $page,
				'orderby' => 'ID',
				'order'   => 'ASC',
				'return'  => 'ids',
			)
		);
		foreach ( (array) $ids as $i => $id ) {
			self::$seen = array();
			self::enqueue_push( (int) $id, (int) $i ); // Spread one second apart.
		}
		if ( count( (array) $ids ) === self::SYNC_ALL_PAGE ) {
			Queue::enqueue( Queue::HOOK_SYNC_ALL, array( $page + 1 ), 5 );
		}
	}

	// ---- pure helpers (unit-tested) --------------------------------------------------------

	/**
	 * Build the payload for a product (snapshot + meta → draft).
	 *
	 * @return array{payload: array<string,mixed>, warnings: array<int, array{source:string,path:string,message:string}>}
	 */
	public static function build( \WC_Product $product ): array {
		$snapshot = Product_Snapshot::from_product( $product );
		$meta     = Product_Snapshot::meta( $product->get_id() );
		$settings = Settings::all();
		return Payload_Builder::build(
			$snapshot,
			$meta,
			array(
				'default_brand' => '' !== (string) $settings['default_brand'] ? (string) $settings['default_brand'] : get_bloginfo( 'name' ),
				'eur_rates'     => self::eur_rates(),
			)
		);
	}

	/** @return array<string,float> The EUR rate table shipped in the zip (assets/eur-rates.json). */
	public static function eur_rates(): array {
		static $rates = null;
		if ( null === $rates ) {
			$rates = Payload_Builder::load_eur_rates( CURTAIN_PLUGIN_DIR . 'assets/eur-rates.json' );
		}
		return $rates;
	}

	/**
	 * Decide what to do with an API result.
	 *
	 * @return 'ok'|'retry'|'fail'
	 */
	public static function classify( int $status, ?string $error_code, bool $transport_error ): string {
		if ( $transport_error || 0 === $status ) {
			return 'not_connected' === $error_code ? 'fail' : 'retry';
		}
		if ( $status >= 200 && $status < 300 ) {
			return 'ok';
		}
		if ( in_array( $status, array( 408, 425, 429, 500, 502, 503, 504 ), true ) ) {
			return 'retry';
		}
		if ( 401 === $status && 'stale_signature' === $error_code ) {
			return 'retry'; // Clock skew: Action Scheduler runs later; the site admin sees the error after MAX_ATTEMPTS.
		}
		return 'fail';
	}

	/** Exponential backoff in seconds: 60, 120, 240, 480, 960, capped at one hour. */
	public static function backoff( int $attempt ): int {
		return (int) min( 3600, 60 * ( 2 ** max( 0, $attempt - 1 ) ) );
	}

	/** @return array{ok:bool,outcome:string,message:string} */
	private static function outcome( bool $ok, string $outcome, string $message ): array {
		return array(
			'ok'      => $ok,
			'outcome' => $outcome,
			'message' => $message,
		);
	}
}
