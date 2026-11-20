<?php
/**
 * Settings storage, API client transport, push job end-to-end (mocked HTTP) and retry policy.
 *
 * @package Curtain\Tests
 */

declare(strict_types=1);

use Curtain\Api_Client;
use Curtain\Hmac;
use Curtain\Queue;
use Curtain\Settings;
use Curtain\Sync;
use Curtain\Vocab;

const CURTAIN_T_PK = 'pk_' . 'test_shop123';
const CURTAIN_T_SK = 'sk_' . 'test_abcdefghijklmnopqrstuvwxyz0123';

function curtain_connect_test_shop(): void {
	Settings::update( array( 'api_key' => CURTAIN_T_SK, 'public_key_prefix' => CURTAIN_T_PK, 'api_base' => 'https://api.test.curtain.fit/' ) );
}

function curtain_seed_product( int $id, array $extra = array() ): void {
	Curtain_Test_State::$posts[ $id ] = array(
		'status'  => 'publish',
		'type'    => 'product',
		'parent'  => 0,
		'product' => new WC_Product( array_merge( array( 'id' => $id, 'name' => 'Linen Wrap Dress', 'price' => '149', 'regular_price' => '149', 'image_id' => 5 ), $extra ) ),
	);
}

test(
	'Settings: secrets are encrypted at rest, defaults merge, is_connected needs both keys',
	static function (): void {
		assert_false( Settings::is_connected() );
		Settings::update( array( 'api_key' => CURTAIN_T_SK, 'button_priority' => 25 ) );
		$raw = get_option( Settings::OPTION );
		assert_false( isset( $raw['api_key'] ) );
		assert_true( isset( $raw['api_key_enc'] ) && ! str_contains( $raw['api_key_enc'], CURTAIN_T_SK ) );
		assert_same( CURTAIN_T_SK, Settings::get( 'api_key' ) );
		assert_same( 25, Settings::get( 'button_priority' ) );
		assert_same( 'active', Settings::get( 'button_scope' ), 'default kept' );
		assert_false( Settings::is_connected(), 'needs the pk_ prefix too' );
		Settings::update( array( 'public_key_prefix' => CURTAIN_T_PK ) );
		assert_true( Settings::is_connected() );
		// D21: English only. The shim's site language is nl_NL and a stale 'nl' setting is ignored.
		assert_same( 'en', Settings::effective_locale(), 'the site language does not choose the text' );
		Settings::update( array( 'locale' => 'nl' ) );
		assert_same( 'en', Settings::effective_locale(), 'a setting saved by an earlier version is ignored' );
		// A loaded pack names its own language tag: the SDK and the overlay follow the pack.
		$GLOBALS['curtain_test_x'] = array( 'language tag of this translation' => 'xx-YY' );
		assert_same( 'xx-YY', Settings::effective_locale(), 'the tag of the loaded pack' );
		$GLOBALS['curtain_test_x'] = array( 'language tag of this translation' => '"><script>' );
		assert_same( 'en', Settings::effective_locale(), 'only a language tag is taken' );
		unset( $GLOBALS['curtain_test_x'] );
		assert_same( 'Try it on', Settings::button_label() );
	}
);

test(
	'Api_Client: HMAC header verifies against the api signing string; JSON body; error envelope',
	static function (): void {
		curtain_connect_test_shop();
		Curtain_Test_State::$http_handler = static function ( string $url, array $args ) {
			$target = Hmac::target_from_url( $url );
			$ok     = Hmac::verify( $args['headers']['Authorization'], CURTAIN_T_PK, array( CURTAIN_T_SK ), $args['method'], $target, (string) $args['body'] );
			if ( ! $ok['ok'] ) {
				return curtain_http_response( 401, array( 'error' => array( 'code' => $ok['code'], 'message' => 'bad' ) ) );
			}
			return curtain_http_response( 200, array( 'externalId' => '42', 'status' => 'active', 'score' => 0.9, 'missingFields' => array(), 'contentHash' => str_repeat( 'a', 64 ), 'changed' => true, 'updatedAt' => '2026-11-04T10:00:00.000Z' ) );
		};
		$c   = Api_Client::from_settings();
		$res = $c->upsert_product( '42', array( 'schemaVersion' => 1, 'id' => '42', 'name' => 'X', 'brand' => 'Y' ) );
		assert_true( $res['ok'], json_encode( $res ) );
		$req = Curtain_Test_State::$requests[0];
		assert_same( 'https://api.test.curtain.fit/v1/merchant/products/42', $req['url'], 'trailing slash on base trimmed' );
		assert_same( 'PUT', $req['args']['method'] );
		assert_same( 'application/json', $req['args']['headers']['Content-Type'] );
		assert_same( '{"schemaVersion":1,"id":"42","name":"X","brand":"Y"}', $req['args']['body'] );
		assert_contains( 'Curtain-WooCommerce/0.1.0', $req['args']['headers']['User-Agent'] );
		assert_same( 15, $req['args']['timeout'] );

		// The audience source goes in the query, inside the signed target, never in the body.
		$res = $c->upsert_product( '42', array( 'schemaVersion' => 1, 'id' => '42', 'name' => 'X', 'brand' => 'Y', 'audience' => 'men' ), 'title' );
		assert_true( $res['ok'], json_encode( $res ) );
		$req = array_pop( Curtain_Test_State::$requests );
		assert_same( 'https://api.test.curtain.fit/v1/merchant/products/42?audienceSource=title', $req['url'] );
		assert_same( '{"schemaVersion":1,"id":"42","name":"X","brand":"Y","audience":"men"}', $req['args']['body'] );

		// DELETE has no body: signed over sha256('').
		$res = $c->delete_product( '42' );
		assert_true( $res['ok'] );
		assert_same( null, Curtain_Test_State::$requests[1]['args']['body'] );

		// Error envelope → error_code/error_message.
		Curtain_Test_State::$http_handler = static fn() => curtain_http_response( 422, array( 'error' => array( 'code' => 'product_incomplete', 'message' => 'missing size chart' ) ) );
		$res = $c->validate_product( array( 'id' => '42' ) );
		assert_false( $res['ok'] );
		assert_same( 422, $res['status'] );
		assert_same( 'product_incomplete', $res['error_code'] );
		assert_same( 'missing size chart', $res['error_message'] );
		assert_same( '{"payload":{"id":"42"}}', Curtain_Test_State::$requests[2]['args']['body'], 'validate wraps the draft in {payload}' );

		// Transport error.
		Curtain_Test_State::$http_handler = static fn() => new WP_Error( 'http_request_failed', 'cURL error 28' );
		$res = $c->hello( array( 'name' => 'x' ) );
		assert_true( $res['transport_error'] );
		assert_same( 'network_error', $res['error_code'] );
	}
);

test(
	'Api_Client: not connected → no request leaves the site (D6 no telemetry before Connect)',
	static function (): void {
		$res = Api_Client::from_settings()->upsert_product( '1', array( 'id' => '1' ) );
		assert_false( $res['ok'] );
		assert_same( 'not_connected', $res['error_code'] );
		assert_same( array(), Curtain_Test_State::$requests );
		// Connect/complete are the only unauthenticated calls, and only run from the merchant's click.
		Curtain_Test_State::$http_handler = static fn() => curtain_http_response( 200, array( 'shopId' => 'u', 'connectToken' => 'ct_x', 'mode' => 'manual-key' ) );
		$res = Api_Client::from_settings()->connect( 'https://shop.example/', 'Shop', 'owner@shop.example', 'https://shop.example/wp-admin/admin.php?page=curtain' );
		assert_true( $res['ok'] );
		assert_false( isset( Curtain_Test_State::$requests[0]['args']['headers']['Authorization'] ) );
		assert_same( '{"siteUrl":"https://shop.example/","name":"Shop","returnUrl":"https://shop.example/wp-admin/admin.php?page=curtain","email":"owner@shop.example"}', Curtain_Test_State::$requests[0]['args']['body'] );
	}
);

test(
	'Sync::classify and backoff encode the retry policy',
	static function (): void {
		assert_same( 'ok', Sync::classify( 200, null, false ) );
		assert_same( 'retry', Sync::classify( 0, 'network_error', true ) );
		assert_same( 'fail', Sync::classify( 0, 'not_connected', false ) );
		foreach ( array( 408, 425, 429, 500, 502, 503, 504 ) as $s ) {
			assert_same( 'retry', Sync::classify( $s, 'x', false ), (string) $s );
		}
		assert_same( 'retry', Sync::classify( 401, 'stale_signature', false ), 'clock skew retries' );
		assert_same( 'fail', Sync::classify( 401, 'bad_signature', false ) );
		assert_same( 'fail', Sync::classify( 400, 'id_mismatch', false ) );
		assert_same( 'fail', Sync::classify( 422, 'validation', false ) );
		assert_same( array( 60, 120, 240, 480, 960, 1920, 3600 ), array_map( array( Sync::class, 'backoff' ), array( 1, 2, 3, 4, 5, 6, 7 ) ) );
	}
);

test(
	'job_push: builds the draft from WC data + meta, PUTs it, stores the backend verdict',
	static function (): void {
		curtain_connect_test_shop();
		curtain_seed_product( 42 );
		update_post_meta( 42, '_curtain_category', 'dress' );
		update_post_meta( 42, '_curtain_size_chart_type', 'body' );
		update_post_meta( 42, '_curtain_size_chart', '[{"size":"S","bust":88}]' );
		update_post_meta( 42, '_curtain_fabric', '{"primary":"linen","stretchPct":2,"drape":0.78}' );
		update_post_meta( 42, '_curtain_flat_lay_photo', 'https://shop.example/flat.png' );
		update_post_meta( 42, '_curtain_primary_color_hex', '#C97A4F' );
		update_post_meta( 42, '_curtain_pattern_block', 'wrap' );

		$captured = null;
		Curtain_Test_State::$http_handler = static function ( string $url, array $args ) use ( &$captured ) {
			$captured = json_decode( (string) $args['body'], true );
			return curtain_http_response( 200, array( 'externalId' => '42', 'status' => 'active', 'score' => 1, 'missingFields' => array(), 'contentHash' => str_repeat( 'b', 64 ), 'changed' => true, 'updatedAt' => '2026-11-04T10:00:00.000Z' ) );
		};
		$out = Sync::job_push( 42, 1 );
		assert_true( $out['ok'], $out['message'] );
		assert_same( '/v1/merchant/products/42', Hmac::target_from_url( Curtain_Test_State::$requests[0]['url'] ) );
		assert_same( '42', $captured['id'], 'body.id must equal :externalId (api contract 7)' );
		assert_same( 'Fixture Shop', $captured['brand'], 'shop name is the brand fallback' );
		assert_same( 149, $captured['priceEur'] );
		assert_same( array( 'https://shop.example/wp-content/uploads/att-5.jpg' ), $captured['productPhotos'] );
		assert_same( 'https://shop.example/product/p42/', $captured['productUrl'] );
		assert_same( 'body', $captured['sizeChartType'] );
		$v = \Curtain\Schema_Validator::from_file( curtain_schema_path( 'garment.schema.json' ) );
		assert_same( array(), $v->validate( $captured ), 'the pushed payload is a full GarmentPayload' );

		assert_same( 'active', get_post_meta( 42, Vocab::META_SYNC_STATUS, true ) );
		assert_same( '1', get_post_meta( 42, Vocab::META_SCORE, true ) );
		assert_same( str_repeat( 'b', 64 ), get_post_meta( 42, Vocab::META_CONTENT_HASH, true ) );
		assert_same( '2026-11-04T10:00:00.000Z', get_post_meta( 42, Vocab::META_SYNCED_AT, true ) );
		assert_same( array(), Curtain_Test_State::$cron, 'no retry scheduled on success' );
	}
);

test(
	'job_push: a fabric with only a name is pushed as it is, and the api\'s notices are stored for the product screen',
	static function (): void {
		curtain_connect_test_shop();
		curtain_seed_product( 43 );
		update_post_meta( 43, '_curtain_category', 'dress' );
		update_post_meta( 43, '_curtain_size_chart_type', 'body' );
		update_post_meta( 43, '_curtain_size_chart', '[{"size":"S","bust":88}]' );
		update_post_meta( 43, '_curtain_fabric', '{"primary":"linen"}' );

		$built = Sync::build( wc_get_product( 43 ) );
		assert_same( array( 'primary' => 'linen' ), $built['payload']['fabric'], 'the name is kept; nothing is invented for stretch or drape' );
		assert_same( array(), $built['warnings'], 'a missing stretch or drape is not a warning' );
		$draft = \Curtain\Schema_Validator::from_file( curtain_schema_path( 'garment-draft.schema.json' ) );
		assert_same( array(), $draft->validate( $built['payload'] ), 'the local draft check accepts a fabric with only a name' );

		$captured = null;
		$answer   = array( 'externalId' => '43', 'status' => 'active', 'score' => 0.6, 'missingFields' => array( 'fabric.stretchPct', 'fabric.drape' ), 'contentHash' => str_repeat( 'c', 64 ), 'changed' => true, 'updatedAt' => '2026-11-20T10:00:00.000Z' );
		Curtain_Test_State::$http_handler = static function ( string $url, array $args ) use ( &$captured, &$answer ) {
			$captured = json_decode( (string) $args['body'], true );
			return curtain_http_response( 200, $answer );
		};

		// let-through (the default): the product is active and the answer says what is assumed.
		$answer['notices']  = array( 'defaulted' => array( 'priceEur', 'fabric.stretchPct', 'fabric.drape' ), 'leftOut' => array() );
		$answer['heldBack'] = null;
		$out                = Sync::job_push( 43, 1 );
		assert_true( $out['ok'], $out['message'] );
		assert_same( array( 'primary' => 'linen' ), $captured['fabric'] );
		assert_same( 'active', get_post_meta( 43, Vocab::META_SYNC_STATUS, true ) );
		$stored = json_decode( (string) get_post_meta( 43, Vocab::META_NOTICES, true ), true );
		assert_same( array( 'priceEur', 'fabric.stretchPct', 'fabric.drape' ), $stored['notices']['defaulted'] );
		assert_same( null, $stored['heldBack'] );

		// hold-back: still HTTP 200, stored as incomplete with the reason.
		$answer['status']   = 'incomplete';
		$answer['notices']  = array( 'defaulted' => array(), 'leftOut' => array( array( 'field' => 'fabric.stretchPct', 'reason' => 'Too big: expected number to be <=100' ) ) );
		$answer['heldBack'] = array( 'reason' => 'incomplete_product_data', 'fields' => array( 'fabric.stretchPct' ) );
		$out                = Sync::job_push( 43, 1 );
		assert_true( $out['ok'], 'held back is not a sync error' );
		assert_same( 'incomplete', get_post_meta( 43, Vocab::META_SYNC_STATUS, true ) );
		assert_same( '', (string) get_post_meta( 43, Vocab::META_SYNC_ERROR, true ) );
		$stored = json_decode( (string) get_post_meta( 43, Vocab::META_NOTICES, true ), true );
		assert_same( array( 'reason' => 'incomplete_product_data', 'fields' => array( 'fabric.stretchPct' ) ), $stored['heldBack'] );
		assert_same( 'fabric.stretchPct', $stored['notices']['leftOut'][0]['field'] );
		ob_start();
		\Curtain\Product_Meta::column_value( 'curtain', 43 );
		assert_contains( 'Held back', (string) ob_get_clean() );

		// Completed: an answer with nothing to tell removes the stored notices (also an older api without the keys).
		$answer['status']   = 'active';
		$answer['notices']  = array( 'defaulted' => array(), 'leftOut' => array() );
		$answer['heldBack'] = null;
		Sync::job_push( 43, 1 );
		assert_same( '', (string) get_post_meta( 43, Vocab::META_NOTICES, true ) );
		assert_same( null, Sync::notices_from_response( array( 'status' => 'active' ) ) );
		assert_same( null, Sync::notices_from_response( array( 'notices' => 'x', 'heldBack' => array( 'fields' => array() ) ) ), 'a malformed answer is not shown' );
	}
);

test(
	'the product screen words the api\'s notices: held back, left out, assumed',
	static function (): void {
		assert_same( array(), \Curtain\Product_Meta::notice_lines( null ) );
		assert_same( array(), \Curtain\Product_Meta::notice_lines( array( 'notices' => array( 'defaulted' => array( 'priceEur', 'primaryColorHex', 'patternBlock' ), 'leftOut' => array() ), 'heldBack' => null ) ), 'defaults that do not touch size advice or the fabric are not listed' );

		$through = \Curtain\Product_Meta::notice_lines( array( 'notices' => array( 'defaulted' => array( 'priceEur', 'fabric.stretchPct', 'fabric.drape' ), 'leftOut' => array( array( 'field' => 'fabric.weightGsm', 'reason' => 'Too big: expected number to be <=2000' ) ) ), 'heldBack' => null ) );
		assert_same( array( 'left-out', 'assumed', 'assumed' ), array_column( $through, 'kind' ) );
		assert_same( 'Not saved: fabric weight (Too big: expected number to be <=2000). The rest of the product was saved.', $through[0]['text'] );
		assert_contains( 'treats the fabric as not stretching (0 %)', $through[1]['text'] );
		assert_contains( 'Size advice does not use drape', $through[2]['text'] );

		$held = \Curtain\Product_Meta::notice_lines( array( 'notices' => array( 'defaulted' => array( 'fabric.stretchPct' ), 'leftOut' => array() ), 'heldBack' => array( 'reason' => 'incomplete_product_data', 'fields' => array( 'fabric.stretchPct', 'fabric.drape' ) ) ) );
		assert_same( array( 'held-back' ), array_column( $held, 'kind' ), 'a held-back product gets no size advice, so nothing is said to be assumed' );
		assert_contains( 'until you complete: fabric stretch, fabric drape.', $held[0]['text'] );

		if ( ! class_exists( 'WP_Post' ) ) {
			eval( 'final class WP_Post { public int $ID = 0; }' ); // phpcs:ignore
		}
		if ( ! function_exists( 'wp_nonce_field' ) ) {
			return; // The shims of this run do not render forms.
		}
		curtain_connect_test_shop();
		Curtain_Test_State::$meta[9301] = array(
			Vocab::META_SYNC_STATUS => 'active',
			Vocab::META_NOTICES     => '{"notices":{"defaulted":["fabric.stretchPct"],"leftOut":[]},"heldBack":null}',
			'_curtain_fabric'       => '{"primary":"linen"}',
		);
		$post     = new WP_Post();
		$post->ID = 9301;
		ob_start();
		\Curtain\Product_Meta::render( $post );
		$html = (string) ob_get_clean();
		assert_contains( '<li class="curtain-notice curtain-notice--assumed">No fabric stretch entered', $html );
		assert_contains( '<span>Stretch %</span>', $html, 'stretch carries no required star' );
		assert_contains( '<span>Drape (0 stiff – 1 fluid)</span>', $html, 'drape carries no required star' );
		assert_contains( 'Stretch and drape are not required.', $html );
		assert_false( str_contains( $html, 'add stretch and drape' ), 'the old help line is gone' );
	}
);

test(
	'job_push: 503 schedules a retry with backoff; 4xx records the error and stops',
	static function (): void {
		curtain_connect_test_shop();
		curtain_seed_product( 7 );
		Curtain_Test_State::$http_handler = static fn() => curtain_http_response( 503, '' );
		$out = Sync::job_push( 7, 2 );
		assert_same( 'retry', $out['outcome'] );
		assert_same( 'retrying', get_post_meta( 7, Vocab::META_SYNC_STATUS, true ) );
		assert_same( 1, count( Curtain_Test_State::$cron ) );
		assert_same( Queue::HOOK_PUSH, Curtain_Test_State::$cron[0]['hook'] );
		assert_same( array( 7, 3 ), Curtain_Test_State::$cron[0]['args'] );
		assert_true( Curtain_Test_State::$cron[0]['ts'] >= time() + 120 - 1, 'attempt 2 → 120 s backoff' );

		// Same job already pending → not enqueued twice.
		Queue::enqueue( Queue::HOOK_PUSH, array( 7, 3 ), 0 );
		assert_same( 1, count( Curtain_Test_State::$cron ) );

		// Final attempt gives up.
		Curtain_Test_State::$cron = array();
		$out = Sync::job_push( 7, Sync::MAX_ATTEMPTS );
		assert_same( 'failed', $out['outcome'] );
		assert_same( 'error', get_post_meta( 7, Vocab::META_SYNC_STATUS, true ) );
		assert_same( array(), Curtain_Test_State::$cron );

		// 400 id_mismatch: no retry.
		Curtain_Test_State::$http_handler = static fn() => curtain_http_response( 400, array( 'error' => array( 'code' => 'id_mismatch', 'message' => 'payload.id must equal :externalId' ) ) );
		$out = Sync::job_push( 7, 1 );
		assert_same( 'failed', $out['outcome'] );
		assert_contains( 'id_mismatch', get_post_meta( 7, Vocab::META_SYNC_ERROR, true ) );
		assert_contains( 'id_mismatch', (string) Settings::get( 'last_error' ) );
		assert_same( array(), Curtain_Test_State::$cron );
	}
);

test(
	'job_push skips unpublished products and disconnected shops without any request',
	static function (): void {
		curtain_seed_product( 9, array( 'status' => 'draft' ) );
		assert_same( 'skipped', Sync::job_push( 9 )['outcome'] );
		curtain_connect_test_shop();
		assert_same( 'skipped', Sync::job_push( 9 )['outcome'] );
		assert_same( 'skipped', Sync::job_push( 404 )['outcome'] );
		assert_same( array(), Curtain_Test_State::$requests );
	}
);

test(
	'job_delete archives on 200 and treats 404 as already gone',
	static function (): void {
		curtain_connect_test_shop();
		curtain_seed_product( 11 );
		Curtain_Test_State::$http_handler = static fn() => curtain_http_response( 200, array( 'externalId' => '11', 'status' => 'archived' ) );
		assert_same( 'archived', Sync::job_delete( '11' )['outcome'] );
		assert_same( 'DELETE', Curtain_Test_State::$requests[0]['args']['method'] );
		assert_same( 'archived', get_post_meta( 11, Vocab::META_SYNC_STATUS, true ) );
		Curtain_Test_State::$http_handler = static fn() => curtain_http_response( 404, array( 'error' => array( 'code' => 'not_found', 'message' => 'product' ) ) );
		assert_true( Sync::job_delete( '11' )['ok'] );
		Curtain_Test_State::$http_handler = static fn() => curtain_http_response( 502, '' );
		assert_same( 'retry', Sync::job_delete( '11', 1 )['outcome'] );
		assert_same( array( '11', 2 ), Curtain_Test_State::$cron[0]['args'] );
	}
);

test(
	'enqueue_push dedupes within a request and marks the product pending; sync_all pages',
	static function (): void {
		curtain_connect_test_shop();
		Curtain_Test_State::$options['_product_ids'] = range( 1, Sync::SYNC_ALL_PAGE );
		Sync::job_sync_all( 1 );
		$hooks = array_count_values( array_column( Curtain_Test_State::$cron, 'hook' ) );
		assert_same( Sync::SYNC_ALL_PAGE, $hooks[ Queue::HOOK_PUSH ] );
		assert_same( 1, $hooks[ Queue::HOOK_SYNC_ALL ], 'a full page schedules the next page' );
		assert_same( 'pending', get_post_meta( 3, Vocab::META_SYNC_STATUS, true ) );
	}
);
