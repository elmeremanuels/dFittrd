<?php
/**
 * Storefront: enqueues the bundled SDK (assets/sdk.v1.js, copied from @curtain/sdk at build
 * time — never a remote script) on single product pages and renders the "Try it on"
 * button at the configured `woocommerce_single_product_summary` priority, plus a shortcode.
 *
 * Standalone by default (docs/STANDALONE.md, D11): data-mode="embed" opens the fit experience in an
 * overlay on the product page and selects the recommended size in the `data-size-option` attribute's
 * dropdown (`form.variations_form select[name=attribute_pa_size]`). The Curtain app is opt-in
 * (data-mode="app").
 *
 * D7: the button always renders once the shop is connected, even when the plan is paused —
 * the overlay shows the "shop paused" screen; the merchant's page is never broken.
 *
 * @package Curtain
 */

declare(strict_types=1);

namespace Curtain;

defined( 'ABSPATH' ) || exit;

final class Frontend {

	public const HANDLE = 'curtain-sdk';

	/**
	 * Block themes: the blocks that hold the add-to-cart / variation form. The button is appended
	 * after the first of them that renders. WooCommerce's block template compatibility layer fires
	 * every `woocommerce_single_product_summary` callback *before* the post excerpt, whatever its
	 * priority, which put the button above the price form on Twenty Twenty-Four/Five (found on a
	 * real WordPress 7.1 + WooCommerce 11.2 install, docs/LAUNCH-WOO.md).
	 */
	public const FORM_BLOCKS = array( 'woocommerce/add-to-cart-form', 'woocommerce/add-to-cart-with-options' );

	/** @var array<int,bool> Product ids whose button was printed on this request (one per product). */
	private static array $rendered = array();

	public static function register(): void {
		add_action( 'wp_enqueue_scripts', array( self::class, 'enqueue' ) );
		add_filter( 'script_loader_tag', array( self::class, 'script_tag' ), 10, 2 );
		add_action( 'init', array( self::class, 'hook_button' ) );
		add_shortcode( 'curtain_button', array( self::class, 'shortcode' ) );
	}

	public static function hook_button(): void {
		if ( ! Settings::is_connected() || ! Settings::get( 'button_enabled' ) ) {
			return;
		}
		add_action( 'woocommerce_single_product_summary', array( self::class, 'render_button' ), (int) Settings::get( 'button_priority' ) );
		add_filter( 'render_block', array( self::class, 'after_form_block' ), 10, 2 );
	}

	/**
	 * Whether the current block template places the add-to-cart form with a block (then the button
	 * goes after that block, not at the summary hook). False for classic themes and for block themes
	 * that render the classic single-product template.
	 */
	public static function template_has_form_block(): bool {
		global $_wp_current_template_content;
		if ( ! is_string( $_wp_current_template_content ) || '' === $_wp_current_template_content ) {
			return false;
		}
		foreach ( self::FORM_BLOCKS as $name ) {
			if ( str_contains( $_wp_current_template_content, '<!-- wp:' . $name . ' ' ) || str_contains( $_wp_current_template_content, '<!-- wp:' . $name . ' /-->' ) || str_contains( $_wp_current_template_content, '<!-- wp:' . $name . '-->' ) ) {
				return true;
			}
		}
		return false;
	}

	/**
	 * `render_block`: append the button after the product's add-to-cart form block (block themes).
	 *
	 * @param string|mixed        $content Rendered block HTML.
	 * @param array<string,mixed> $block   Parsed block.
	 * @return string|mixed
	 */
	public static function after_form_block( $content, $block ) {
		if ( ! is_string( $content ) || ! is_array( $block ) || ! in_array( (string) ( $block['blockName'] ?? '' ), self::FORM_BLOCKS, true ) ) {
			return $content;
		}
		if ( ! function_exists( 'is_product' ) || ! is_product() ) {
			return $content;
		}
		$product = wc_get_product( get_the_ID() );
		if ( ! $product instanceof \WC_Product || isset( self::$rendered[ $product->get_id() ] ) || ! self::eligible( $product ) ) {
			return $content;
		}
		self::$rendered[ $product->get_id() ] = true;
		return $content . self::button_html( $product, Settings::button_label(), 'button alt' );
	}

	public static function enqueue(): void {
		if ( ! function_exists( 'is_product' ) || ! is_product() || ! Settings::is_connected() ) {
			return;
		}
		$file = CURTAIN_PLUGIN_DIR . 'assets/sdk.v1.js';
		if ( ! file_exists( $file ) ) {
			return; // Development checkout without a build; the zip always carries it.
		}
		wp_enqueue_script( self::HANDLE, CURTAIN_PLUGIN_URL . 'assets/sdk.v1.js', array(), CURTAIN_VERSION . '.' . (string) filemtime( $file ), true );
	}

	/**
	 * Add the SDK's configuration attributes to its script tag.
	 */
	public static function script_tag( string $tag, string $handle ): string {
		if ( self::HANDLE !== $handle ) {
			return $tag;
		}
		$attrs = array(
			'data-shop'        => (string) Settings::get( 'public_key_prefix' ),
			'data-api'         => Api_Client::from_settings()->base(),
			'data-mode'        => Settings::mode(),
			'data-size-option' => Settings::size_attribute(),
			'data-locale'      => Settings::effective_locale(),
			'data-label'       => Settings::button_label(),
			// The size peek (a returning shopper's size next to the button, unreadable by this page).
			'data-peek'        => Settings::show_size() ? 'on' : 'off',
			'data-app'         => Settings::show_size() ? Settings::app_origin() : '',
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
		if ( ! $product instanceof \WC_Product || isset( self::$rendered[ $product->get_id() ] ) || ! self::eligible( $product ) ) {
			return;
		}
		// Block template with a form block: after_form_block() places it under the form instead.
		if ( self::template_has_form_block() ) {
			return;
		}
		self::$rendered[ $product->get_id() ] = true;
		echo self::button_html( $product, Settings::button_label(), 'button alt' ); // phpcs:ignore WordPress.Security.EscapeOutput.OutputNotEscaped -- escaped in button_html().
	}

	/** @param array<string,mixed>|string $atts */
	public static function shortcode( $atts = array() ): string {
		$atts = shortcode_atts(
			array(
				'product_id' => 0,
				'label'      => '',
				'class'      => 'button alt',
				// 'off' hides the size peek next to this button; anything else follows the setting.
				'peek'       => '',
			),
			is_array( $atts ) ? $atts : array(),
			'curtain_button'
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
			$file = CURTAIN_PLUGIN_DIR . 'assets/sdk.v1.js';
			if ( file_exists( $file ) ) {
				wp_enqueue_script( self::HANDLE, CURTAIN_PLUGIN_URL . 'assets/sdk.v1.js', array(), CURTAIN_VERSION . '.' . (string) filemtime( $file ), true );
			}
		}
		$label = '' !== trim( (string) $atts['label'] ) ? (string) $atts['label'] : Settings::button_label();
		$peek  = 'off' !== strtolower( trim( (string) $atts['peek'] ) );
		return self::button_html( $product, $label, (string) $atts['class'], $peek );
	}

	/**
	 * The button. It carries the experience and size attribute as data-curtain-mode /
	 * data-curtain-size-option so themes and the shortcode can see them; the SDK reads its config
	 * from the script tag (script_tag()), which renders the same values. data-curtain-peek is read
	 * by the SDK per button: "off" (the setting, app mode, or [curtain_button peek="off"]) keeps
	 * the size peek away from this button.
	 */
	public static function button_html( \WC_Product $product, string $label, string $class, bool $peek = true ): string {
		$mode = Settings::mode();
		$note = Settings::MODE_APP === $mode
			? esc_html__( 'Opens the Curtain app, your private fitting room. Fit results are estimates.', 'curtain-woocommerce' )
			: esc_html__( 'Find your size on this page. Your measurements stay on this device. Fit results are estimates.', 'curtain-woocommerce' );
		return sprintf(
			'<p class="curtain-try"><button type="button" class="%s curtain-try-button" data-curtain-product="%s" data-curtain-mode="%s" data-curtain-size-option="%s" data-curtain-peek="%s">%s</button><span class="curtain-try-note screen-reader-text">%s</span></p>',
			esc_attr( trim( $class ) ),
			esc_attr( (string) $product->get_id() ),
			esc_attr( $mode ),
			esc_attr( Settings::size_attribute() ),
			$peek && Settings::show_size() ? 'on' : 'off',
			esc_html( $label ),
			$note
		);
	}
}
