<?php
/**
 * Plugin Name:       Paskamer for WooCommerce
 * Plugin URI:        https://paskamer.app/woocommerce
 * Description:       Adds a "Try in Paskamer" button to your product pages and syncs garment fit data (size chart, fabric, flat-lay) to Paskamer, the private fitting room. Nothing is sent until you connect your shop.
 * Version:           0.1.0
 * Requires at least: 6.6
 * Requires PHP:      8.2
 * Requires Plugins:  woocommerce
 * WC requires at least: 9.0
 * WC tested up to:   9.9
 * Author:            Paskamer
 * Author URI:        https://paskamer.app
 * License:           GPL-2.0-or-later
 * License URI:       https://www.gnu.org/licenses/gpl-2.0.html
 * Text Domain:       paskamer-woocommerce
 * Domain Path:       /languages
 *
 * @package Paskamer
 */

declare(strict_types=1);

defined( 'ABSPATH' ) || exit;

define( 'PASKAMER_VERSION', '0.1.0' );
define( 'PASKAMER_PLUGIN_FILE', __FILE__ );
define( 'PASKAMER_PLUGIN_DIR', plugin_dir_path( __FILE__ ) );
define( 'PASKAMER_PLUGIN_URL', plugin_dir_url( __FILE__ ) );
define( 'PASKAMER_MIN_PHP', '8.2' );
define( 'PASKAMER_MIN_WC', '9.0' );
define( 'PASKAMER_DEFAULT_API_BASE', 'https://api.paskamer.app' );

require_once PASKAMER_PLUGIN_DIR . 'includes/autoload.php';

/**
 * Declare HPOS (custom order tables) compatibility before WooCommerce initialises. The plugin
 * never touches orders, so it is compatible by construction.
 */
add_action(
	'before_woocommerce_init',
	static function (): void {
		if ( class_exists( \Automattic\WooCommerce\Utilities\FeaturesUtil::class ) ) {
			\Automattic\WooCommerce\Utilities\FeaturesUtil::declare_compatibility( 'custom_order_tables', __FILE__, true );
			\Automattic\WooCommerce\Utilities\FeaturesUtil::declare_compatibility( 'product_block_editor', __FILE__, false );
		}
	}
);

/**
 * Boot once every plugin is loaded (WooCommerce must be active and recent enough).
 */
add_action(
	'plugins_loaded',
	static function (): void {
		if ( version_compare( PHP_VERSION, PASKAMER_MIN_PHP, '<' ) ) {
			\Paskamer\Plugin::admin_requirement_notice( sprintf( 'Paskamer for WooCommerce needs PHP %s or newer (this site runs %s).', PASKAMER_MIN_PHP, PHP_VERSION ) );
			return;
		}
		if ( ! class_exists( 'WooCommerce' ) || ! defined( 'WC_VERSION' ) ) {
			\Paskamer\Plugin::admin_requirement_notice( 'Paskamer for WooCommerce needs WooCommerce to be installed and active.' );
			return;
		}
		if ( version_compare( (string) WC_VERSION, PASKAMER_MIN_WC, '<' ) ) {
			\Paskamer\Plugin::admin_requirement_notice( sprintf( 'Paskamer for WooCommerce needs WooCommerce %s or newer (this site runs %s).', PASKAMER_MIN_WC, WC_VERSION ) );
			return;
		}
		\Paskamer\Plugin::instance()->boot();
	},
	20
);

register_activation_hook( __FILE__, array( \Paskamer\Plugin::class, 'activate' ) );
register_deactivation_hook( __FILE__, array( \Paskamer\Plugin::class, 'deactivate' ) );
