<?php
/**
 * Plugin bootstrap: wires the settings page, product meta box, sync hooks, storefront button and
 * the signed REST endpoint. Activation seeds defaults; deactivation clears the job queue.
 *
 * @package Paskamer
 */

declare(strict_types=1);

namespace Paskamer;

defined('ABSPATH') || defined('PASKAMER_TESTING') || exit;

final class Plugin {

	private static ?Plugin $instance = null;

	public static function instance(): Plugin {
		if ( null === self::$instance ) {
			self::$instance = new self();
		}
		return self::$instance;
	}

	public function boot(): void {
		load_plugin_textdomain( 'paskamer-woocommerce', false, dirname( plugin_basename( PASKAMER_PLUGIN_FILE ) ) . '/languages' );

		Settings::register();
		Product_Meta::register();
		Sync::register_hooks();
		Frontend::register();
		Rest::register();

		add_filter( 'plugin_action_links_' . plugin_basename( PASKAMER_PLUGIN_FILE ), array( $this, 'action_links' ) );
		add_action( 'admin_notices', array( $this, 'connect_nudge' ) );
	}

	/** @param string[] $links @return string[] */
	public function action_links( array $links ): array {
		array_unshift( $links, '<a href="' . esc_url( Settings::page_url() ) . '">' . esc_html__( 'Settings', 'paskamer-woocommerce' ) . '</a>' );
		return $links;
	}

	/** One gentle notice on WooCommerce screens until the shop is connected. */
	public function connect_nudge(): void {
		if ( Settings::is_connected() || ! current_user_can( 'manage_woocommerce' ) ) {
			return;
		}
		$screen = function_exists( 'get_current_screen' ) ? get_current_screen() : null;
		if ( ! $screen || ! in_array( $screen->id, array( 'plugins', 'woocommerce_page_wc-settings', 'edit-product', 'product' ), true ) ) {
			return;
		}
		printf(
			'<div class="notice notice-info"><p>%s <a href="%s">%s</a></p></div>',
			esc_html__( 'Paskamer for WooCommerce is installed but not connected. Nothing is sent to Paskamer until you connect your shop.', 'paskamer-woocommerce' ),
			esc_url( Settings::page_url() ),
			esc_html__( 'Connect now', 'paskamer-woocommerce' )
		);
	}

	public static function admin_requirement_notice( string $message ): void {
		add_action(
			'admin_notices',
			static function () use ( $message ): void {
				echo '<div class="notice notice-error"><p>' . esc_html( $message ) . '</p></div>';
			}
		);
	}

	public static function activate(): void {
		if ( false === get_option( Settings::OPTION, false ) ) {
			add_option( Settings::OPTION, Settings::defaults(), '', true );
		}
	}

	public static function deactivate(): void {
		Queue::cancel_all();
	}
}
