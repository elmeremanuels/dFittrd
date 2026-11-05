<?php
/**
 * Storefront: enqueues the bundled SDK (assets/sdk.v1.js, copied from @paskamer/sdk at build
 * time — never a remote script) on single product pages and renders the "Try in Paskamer"
 * button at the configured `woocommerce_single_product_summary` priority, plus a shortcode.
 *
 * D7: the button always renders once the shop is connected, even when the plan is paused —
 * the Paskamer app shows the "shop paused" screen; the merchant's page is never broken.
 *
 * @package Paskamer
 */

declare(strict_types=1);

namespace Paskamer;

defined('ABSPATH') || defined('PASKAMER_TESTING') || exit;

final class Frontend {

	public const HANDLE = 'paskamer-sdk';

	public static function register(): void {
		add_action( 'wp_enqueue_scripts', array( self::class, 'enqueue' ) );
		add_filter( 'script_loader_tag', array( self::class, 'script_tag' ), 10, 2 );
		add_action( 'init', array( self::class, 'hook_button' ) );
		add_shortcode( 'paskamer_button', array( self::class, 'shortcode' ) );
	}

	public static function hook_button(): void {
		if ( ! Settings::is_connected() || ! Settings::get( 'button_enabled' ) ) {
			return;
		}
		add_action( 'woocommerce_single_product_summary', array( self::class, 'render_button' ), (int) Settings::get( 'button_priority' ) );
	}

	public static function enqueue(): void {
		if ( ! function_exists( 'is_product' ) || ! is_product() || ! Settings::is_connected() ) {
			return;
		}
		$file = PASKAMER_PLUGIN_DIR . 'assets/sdk.v1.js';
		if ( ! file_exists( $file ) ) {
			return; // Development checkout without a build; the zip always carries it.
		}
		wp_enqueue_script( self::HANDLE, PASKAMER_PLUGIN_URL . 'assets/sdk.v1.js', array(), PASKAMER_VERSION . '.' . (string) filemtime( $file ), true );
	}

	/**
	 * Add the SDK's configuration attributes to its script tag.
	 */
	public static function script_tag( string $tag, string $handle ): string {
		if ( self::HANDLE !== $handle ) {
			return $tag;
		}
		$attrs = array(
			'data-shop'   => (string) Settings::get( 'public_key_prefix' ),
			'data-api'    => Api_Client::from_settings()->base(),
			'data-locale' => Settings::effective_locale(),
			'data-label'  => Settings::button_label(),
		);
		$extra = '';
		foreach ( $attrs as $name => $value ) {
			if ( '' !== $value ) {
				$extra .= ' ' . $name . '="' . esc_attr( $value ) . '"';
			}
		}
		// Callback, not a replacement string: `$1` or a backslash-digit in a merchant label stays literal.
		return (string) preg_replace_callback(
			'/<script\b/',
			static function () use ( $extra ): string {
				return '<script' . $extra;
			},
			$tag,
			1
		);
	}

	/** Whether the button should show for this product under the configured scope. */
	public static function eligible( \WC_Product $product ): bool {
		if ( 'publish' !== $product->get_status() ) {
			return false;
		}
		if ( 'all' === Settings::get( 'button_scope' ) ) {
			return true;
		}
		return 'active' === (string) get_post_meta( $product->get_id(), Vocab::META_SYNC_STATUS, true );
	}

	public static function render_button(): void {
		global $product;
		if ( ! $product instanceof \WC_Product || ! self::eligible( $product ) ) {
			return;
		}
		echo self::button_html( $product, Settings::button_label(), 'button alt' ); // phpcs:ignore WordPress.Security.EscapeOutput.OutputNotEscaped -- escaped in button_html().
	}

	/** @param array<string,mixed>|string $atts */
	public static function shortcode( $atts = array() ): string {
		$atts = shortcode_atts(
			array(
				'product_id' => 0,
				'label'      => '',
				'class'      => 'button alt',
			),
			is_array( $atts ) ? $atts : array(),
			'paskamer_button'
		);
		if ( ! Settings::is_connected() ) {
			return '';
		}
		$id      = absint( $atts['product_id'] );
		$product = $id > 0 ? wc_get_product( $id ) : ( function_exists( 'wc_get_product' ) ? wc_get_product( get_the_ID() ) : null );
		if ( ! $product instanceof \WC_Product || ! self::eligible( $product ) ) {
			return '';
		}
		if ( ! wp_script_is( self::HANDLE, 'enqueued' ) ) {
			$file = PASKAMER_PLUGIN_DIR . 'assets/sdk.v1.js';
			if ( file_exists( $file ) ) {
				wp_enqueue_script( self::HANDLE, PASKAMER_PLUGIN_URL . 'assets/sdk.v1.js', array(), PASKAMER_VERSION . '.' . (string) filemtime( $file ), true );
			}
		}
		$label = '' !== trim( (string) $atts['label'] ) ? (string) $atts['label'] : Settings::button_label();
		return self::button_html( $product, $label, (string) $atts['class'] );
	}

	public static function button_html( \WC_Product $product, string $label, string $class ): string {
		return sprintf(
			'<p class="paskamer-try"><button type="button" class="%s paskamer-try-button" data-paskamer-product="%s">%s</button><span class="paskamer-try-note screen-reader-text">%s</span></p>',
			esc_attr( trim( $class ) ),
			esc_attr( (string) $product->get_id() ),
			esc_html( $label ),
			esc_html__( 'Opens Paskamer, your private fitting room. Fit results are estimates.', 'paskamer-woocommerce' )
		);
	}
}
