<?php
/**
 * Regression tests from the platform review (Nov 2026): meta slashing, the Stripe return flow,
 * the API base URL, non-finite numbers, the script tag filter and the delete/republish race.
 *
 * @package Curtain\Tests
 */

declare(strict_types=1);

use Curtain\Frontend;
use Curtain\Product_Meta;
use Curtain\Sanitizer;
use Curtain\Settings;
use Curtain\Sync;
use Curtain\Vocab;

test(
	'Product_Meta::save keeps JSON meta valid when values contain quotes or backslashes (update_post_meta unslashes)',
	static function (): void {
		curtain_seed_product( 21 );
		$post = array(
			'category'        => 'bottom',
			'fabric_primary'  => 'denim',
			'size_chart_type' => 'garment',
			'size_chart'      => array( array( 'size' => '32"', 'waist' => '82', 'hip' => '100' ), array( 'size' => '34\\L', 'waist' => '87', 'hip' => '105' ) ),
			'colorways'       => array( array( 'name' => 'Indigo "raw"', 'hex' => '#1F2A44', 'sku' => 'DN\\32' ) ),
		);
		// WordPress hands $_POST over slashed ("magic quotes"); save() unslashes it.
		$_POST = array(
			Product_Meta::NONCE => 'valid-' . Product_Meta::NONCE,
			'curtain'          => wp_slash( $post ),
		);
		try {
			Product_Meta::save( 21 );
		} finally {
			$_POST = array();
		}
		$chart = json_decode( (string) get_post_meta( 21, '_curtain_size_chart', true ), true );
		assert_true( is_array( $chart ), 'size chart meta must stay valid JSON, got ' . var_export( get_post_meta( 21, '_curtain_size_chart', true ), true ) );
		assert_same( '32"', $chart[0]['size'] );
		assert_same( '34\\L', $chart[1]['size'] );
		$cw = json_decode( (string) get_post_meta( 21, '_curtain_colorways', true ), true );
		assert_true( is_array( $cw ), 'colorways meta must stay valid JSON' );
		assert_same( 'Indigo "raw"', $cw[0]['name'] );
		assert_same( 'DN\\32', $cw[0]['sku'] );
		$issues = json_decode( (string) get_post_meta( 21, Vocab::META_LOCAL_ISSUES, true ), true );
		assert_true( is_array( $issues ), 'local issues meta must stay valid JSON' );
	}
);

test(
	'Sync::job_push stores the backend verdict as valid JSON even when an error message has quotes',
	static function (): void {
		curtain_connect_test_shop();
		curtain_seed_product( 22 );
		Curtain_Test_State::$http_handler = static fn() => curtain_http_response( 200, array( 'externalId' => '22', 'status' => 'incomplete', 'score' => 0.5, 'missingFields' => array( 'size "M" row', 'a\\b' ), 'contentHash' => str_repeat( 'b', 64 ), 'updatedAt' => '2026-11-04T10:00:00.000Z' ) );
		assert_same( 'synced', Sync::job_push( 22 )['outcome'] );
		assert_same( array( 'size "M" row', 'a\\b' ), json_decode( (string) get_post_meta( 22, Vocab::META_MISSING, true ), true ) );
		Curtain_Test_State::$http_handler = static fn() => curtain_http_response( 422, array( 'error' => array( 'code' => 'invalid', 'message' => 'path C:\\x is "bad"' ) ) );
		Sync::job_push( 22 );
		assert_contains( 'C:\\x is "bad"', (string) get_post_meta( 22, Vocab::META_SYNC_ERROR, true ) );
	}
);

test(
	'Settings: the Stripe return (?curtain=connected) is handled on load-<page>, before any output',
	static function (): void {
		Settings::menu();
		assert_true( isset( Curtain_Test_State::$actions['load-woocommerce_page_curtain'] ), 'a load- hook finishes the connection before headers are sent' );
		// Nothing pending: no request, no redirect.
		$_GET = array( 'page' => 'curtain', 'curtain' => 'connected' );
		try {
			Settings::maybe_finish_connect();
		} finally {
			$_GET = array();
		}
		assert_same( array(), Curtain_Test_State::$requests );
	}
);

test(
	'Settings::sanitize_api_base only accepts https (http for local development hosts)',
	static function (): void {
		assert_same( 'https://api.staging.curtain.fit', Settings::sanitize_api_base( ' https://api.staging.curtain.fit/ ' ) );
		assert_same( '', Settings::sanitize_api_base( 'http://api.curtain.fit' ), 'the secret key would travel in clear text' );
		assert_same( '', Settings::sanitize_api_base( 'ftp://api.curtain.fit' ) );
		assert_same( '', Settings::sanitize_api_base( 'javascript:alert(1)' ) );
		assert_same( 'http://localhost:3000', Settings::sanitize_api_base( 'http://localhost:3000' ) );
		assert_same( 'http://127.0.0.1:8080', Settings::sanitize_api_base( 'http://127.0.0.1:8080/' ) );
		assert_same( '', Settings::sanitize_api_base( 'http://localhost.evil.example' ) );
	}
);

test(
	'Sanitizer rejects non-finite numbers instead of silently dropping the whole JSON field',
	static function (): void {
		$r = Sanitizer::from_post(
			array(
				'fabric_primary'    => 'linen',
				'fabric_weight_gsm' => '1e999',
				'ease'              => array( 'bust' => '-1e999', 'waist' => '4' ),
			)
		);
		assert_json_equal( array( 'primary' => 'linen' ), json_decode( (string) $r['meta']['_curtain_fabric'], true ) );
		assert_json_equal( array( 'waist' => 4 ), json_decode( (string) $r['meta']['_curtain_ease'], true ) );
	}
);

test(
	'Frontend::script_tag inserts attribute values literally ($1 / \\0 in a label are not backreferences)',
	static function (): void {
		curtain_connect_test_shop();
		Settings::update( array( 'button_label' => 'Try for $0 \\1 extra' ) );
		$tag = Frontend::script_tag( "<script src='https://shop.example/sdk.v1.js' id='curtain-sdk-js'></script>\n", Frontend::HANDLE );
		assert_contains( 'data-label="Try for $0 \\1 extra"', $tag );
		assert_same( 1, substr_count( $tag, '<script' ) );
	}
);

test(
	'job_delete does not archive a product that was re-published (a newer push superseded it)',
	static function (): void {
		curtain_connect_test_shop();
		curtain_seed_product( 23 );
		update_post_meta( 23, Vocab::META_SYNC_STATUS, 'pending' ); // enqueue_push after the re-publish.
		Curtain_Test_State::$http_handler = static fn() => curtain_http_response( 200, array( 'externalId' => '23', 'status' => 'archived' ) );
		$r = Sync::job_delete( '23', 2 );
		assert_same( 'skipped', $r['outcome'] );
		assert_same( array(), Curtain_Test_State::$requests );
		assert_same( 'pending', get_post_meta( 23, Vocab::META_SYNC_STATUS, true ) );
		// Unpublished (or gone): the delete goes through.
		Curtain_Test_State::$posts[23]['status'] = 'draft';
		assert_same( 'archived', Sync::job_delete( '23', 2 )['outcome'] );
	}
);
