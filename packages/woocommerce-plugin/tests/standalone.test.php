<?php
/**
 * Standalone mode (docs/STANDALONE.md §3, D11): the "Experience" (`mode`) and "Size attribute"
 * (`size_attribute`) settings, their sanitising, and how they reach the SDK script tag, the button
 * and the [curtain_button] shortcode.
 *
 * @package Curtain\Tests
 */

declare(strict_types=1);

use Curtain\Frontend;
use Curtain\Settings;

// Shims only this file needs (guarded so a later shims.php addition does not clash).
if ( ! function_exists( 'wc_get_attribute_taxonomies' ) ) {
	function wc_get_attribute_taxonomies(): array { return Curtain_Test_State::$options['_attr_taxonomies'] ?? array(); }
}
if ( ! function_exists( 'shortcode_atts' ) ) {
	function shortcode_atts( array $pairs, array $atts, string $shortcode = '' ): array {
		$out = array();
		foreach ( $pairs as $k => $v ) {
			$out[ $k ] = array_key_exists( $k, $atts ) ? $atts[ $k ] : $v;
		}
		return $out;
	}
}
if ( ! function_exists( 'wp_script_is' ) ) {
	function wp_script_is( string $handle, string $status = 'enqueued' ): bool { return true; }
}
if ( ! function_exists( 'get_the_ID' ) ) {
	function get_the_ID() { return 0; }
}

function curtain_standalone_shop(): void {
	Settings::update( array( 'api_key' => 'sk_' . 'test_abcdefghijklmnopqrstuvwxyz0123', 'public_key_prefix' => 'pk_' . 'test_standalone01', 'api_base' => 'https://api.test.curtain.fit' ) );
}

function curtain_standalone_tag(): string {
	return Frontend::script_tag( "<script src='https://shop.example/sdk.v1.js' id='curtain-sdk-js'></script>\n", Frontend::HANDLE );
}

test(
	'defaults: standalone (embed) experience and pa_size',
	static function (): void {
		assert_same( 'embed', Settings::defaults()['mode'] );
		assert_same( 'pa_size', Settings::defaults()['size_attribute'] );
		assert_same( 'embed', Settings::mode() );
		assert_same( 'pa_size', Settings::size_attribute() );
	}
);

test(
	'sanitize_mode: only embed / app, anything else falls back to embed',
	static function (): void {
		assert_same( 'embed', Settings::sanitize_mode( 'embed' ) );
		assert_same( 'app', Settings::sanitize_mode( 'app' ) );
		assert_same( 'app', Settings::sanitize_mode( ' APP ' ) );
		foreach ( array( 'auto', 'redirect', 'modal', '', '<script>', null, 1, array( 'app' ) ) as $bad ) {
			assert_same( 'embed', Settings::sanitize_mode( $bad ), 'mode ' . var_export( $bad, true ) );
		}
		// A tampered stored value never reaches the page.
		Settings::update( array( 'mode' => 'javascript:alert(1)' ) );
		assert_same( 'embed', Settings::mode() );
	}
);

test(
	'sanitize_size_attribute: slug-like, max 32 chars, lower-cased, otherwise pa_size',
	static function (): void {
		assert_same( 'pa_size', Settings::sanitize_size_attribute( 'pa_size' ) );
		assert_same( 'pa_maat', Settings::sanitize_size_attribute( 'PA_Maat' ) );
		assert_same( 'size', Settings::sanitize_size_attribute( 'size' ) );
		assert_same( 'pa_shoe-size', Settings::sanitize_size_attribute( 'pa_shoe-size' ) );
		foreach ( array( '', ' ', 'pa size', '"><b>', 'pa_' . str_repeat( 'x', 40 ), '_pa', null, 7 ) as $bad ) {
			assert_same( 'pa_size', Settings::sanitize_size_attribute( $bad ), 'attr ' . var_export( $bad, true ) );
		}
	}
);

test(
	'size_attribute_choices: product attributes as pa_<name>, pa_size always present, current value kept',
	static function (): void {
		Curtain_Test_State::$options['_attr_taxonomies'] = array(
			(object) array( 'attribute_name' => 'color', 'attribute_label' => 'Colour' ),
			(object) array( 'attribute_name' => 'maat', 'attribute_label' => 'Maat' ),
		);
		$choices = Settings::size_attribute_choices();
		assert_same( array( 'pa_size', 'pa_color', 'pa_maat' ), array_keys( $choices ) );
		assert_same( 'Maat (pa_maat)', $choices['pa_maat'] );

		Curtain_Test_State::$options['_attr_taxonomies'][] = (object) array( 'attribute_name' => 'size', 'attribute_label' => 'Size' );
		Settings::update( array( 'size_attribute' => 'custom_size' ) );
		$choices = Settings::size_attribute_choices();
		assert_same( array( 'pa_color', 'pa_maat', 'pa_size', 'custom_size' ), array_keys( $choices ) );
	}
);

test(
	'script tag: data-mode="embed" and data-size-option="pa_size" by default',
	static function (): void {
		curtain_standalone_shop();
		$tag = curtain_standalone_tag();
		assert_contains( 'data-mode="embed"', $tag );
		assert_contains( 'data-size-option="pa_size"', $tag );
		assert_contains( 'data-shop="pk_test_standalone01"', $tag );
		assert_same( 1, substr_count( $tag, '<script' ) );
	}
);

test(
	'script tag: the merchant can opt in to the Curtain app and pick another size attribute',
	static function (): void {
		curtain_standalone_shop();
		Settings::update( array( 'mode' => 'app', 'size_attribute' => 'pa_maat' ) );
		$tag = curtain_standalone_tag();
		assert_contains( 'data-mode="app"', $tag );
		assert_contains( 'data-size-option="pa_maat"', $tag );
	}
);

test(
	'button and shortcode carry data-curtain-mode / data-curtain-size-option and the standalone note',
	static function (): void {
		curtain_standalone_shop();
		Curtain_Test_State::$posts[31] = array(
			'status'  => 'publish',
			'type'    => 'product',
			'parent'  => 0,
			'product' => new WC_Product( array( 'id' => 31, 'name' => 'Linen Wrap Dress' ) ),
		);
		Settings::update( array( 'button_scope' => 'all' ) );

		$html = Frontend::button_html( Curtain_Test_State::$posts[31]['product'], 'Try it on', 'button alt' );
		assert_contains( 'data-curtain-product="31"', $html );
		assert_contains( 'data-curtain-mode="embed"', $html );
		assert_contains( 'data-curtain-size-option="pa_size"', $html );
		assert_contains( 'stay on this device', $html );
		assert_false( str_contains( $html, 'Curtain app' ) );

		$short = Frontend::shortcode( array( 'product_id' => '31', 'label' => 'Find my size' ) );
		assert_contains( 'data-curtain-mode="embed"', $short );
		assert_contains( '>Find my size</button>', $short );

		Settings::update( array( 'mode' => 'app', 'size_attribute' => 'pa_maat' ) );
		$short = Frontend::shortcode( array( 'product_id' => '31' ) );
		assert_contains( 'data-curtain-mode="app"', $short );
		assert_contains( 'data-curtain-size-option="pa_maat"', $short );
		assert_contains( 'Opens the Curtain app', $short );
	}
);

test(
	'size peek: on by default, data-peek="on" + data-app (api. → app.) on the script tag, data-curtain-peek on the button',
	static function (): void {
		curtain_standalone_shop();
		assert_same( true, Settings::defaults()['show_size'] );
		assert_true( Settings::show_size() );
		assert_same( 'https://app.test.curtain.fit', Settings::app_origin() );
		$tag = curtain_standalone_tag();
		assert_contains( 'data-peek="on"', $tag );
		assert_contains( 'data-app="https://app.test.curtain.fit"', $tag );

		Curtain_Test_State::$posts[32] = array(
			'status'  => 'publish',
			'type'    => 'product',
			'parent'  => 0,
			'product' => new WC_Product( array( 'id' => 32, 'name' => 'Linen Shirt' ) ),
		);
		Settings::update( array( 'button_scope' => 'all' ) );
		assert_contains( 'data-curtain-peek="on"', Frontend::button_html( Curtain_Test_State::$posts[32]['product'], 'Try it on', 'button alt' ) );
		assert_contains( 'data-curtain-peek="on"', Frontend::shortcode( array( 'product_id' => '32' ) ) );
		// The shortcode can keep the peek away from one button.
		assert_contains( 'data-curtain-peek="off"', Frontend::shortcode( array( 'product_id' => '32', 'peek' => 'off' ) ) );
		assert_contains( 'data-curtain-peek="off"', Frontend::shortcode( array( 'product_id' => '32', 'peek' => ' OFF ' ) ) );
	}
);

test(
	'size peek: the merchant can turn it off, and app mode never shows it',
	static function (): void {
		curtain_standalone_shop();
		Settings::update( array( 'show_size' => false ) );
		assert_false( Settings::show_size() );
		$tag = curtain_standalone_tag();
		assert_contains( 'data-peek="off"', $tag );
		assert_false( str_contains( $tag, 'data-app=' ) );

		Settings::update( array( 'show_size' => true, 'mode' => 'app' ) );
		assert_false( Settings::show_size() );
		assert_contains( 'data-peek="off"', curtain_standalone_tag() );
		Curtain_Test_State::$posts[33] = array(
			'status'  => 'publish',
			'type'    => 'product',
			'parent'  => 0,
			'product' => new WC_Product( array( 'id' => 33, 'name' => 'Linen Skirt' ) ),
		);
		assert_contains( 'data-curtain-peek="off"', Frontend::button_html( Curtain_Test_State::$posts[33]['product'], 'Try it on', 'button alt' ) );
	}
);

test(
	'app_origin: only for an api.<domain> origin over http(s); the port is kept',
	static function (): void {
		Settings::update( array( 'api_base' => 'https://api.curtain.fit/' ) );
		assert_same( 'https://app.curtain.fit', Settings::app_origin() );
		Settings::update( array( 'api_base' => 'http://api.localhost:8787' ) );
		assert_same( 'http://app.localhost:8787', Settings::app_origin() );
		Settings::update( array( 'api_base' => 'https://curtain.example' ) );
		assert_same( '', Settings::app_origin() );
	}
);
