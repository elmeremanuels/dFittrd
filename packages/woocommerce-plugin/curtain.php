<?php
/**
 * Plugin Name:       Curtain for WooCommerce
 * Plugin URI:        https://curtain.fit/woocommerce
 * Description:       Adds a "Try it on" button to your product pages and syncs garment fit data (size chart, fabric, flat-lay) to Curtain, the private fitting room. Nothing is sent until you connect your shop.
 * Version:           0.1.0
 * Requires at least: 6.6
 * Requires PHP:      8.2
 * Requires Plugins:  woocommerce
 * WC requires at least: 9.0
 * WC tested up to:   11.2
 * Author:            Curtain
 * Author URI:        https://curtain.fit
 * License:           GPL-2.0-or-later
 * License URI:       https://www.gnu.org/licenses/gpl-2.0.html
 * Text Domain:       curtain-woocommerce
 * Domain Path:       /languages
 *
 * @package Curtain
 */

declare(strict_types=1);

defined( 'ABSPATH' ) || exit;

define( 'CURTAIN_VERSION', '0.1.0' );
define( 'CURTAIN_PLUGIN_FILE', __FILE__ );
define( 'CURTAIN_PLUGIN_DIR', plugin_dir_path( __FILE__ ) );
define( 'CURTAIN_PLUGIN_URL', plugin_dir_url( __FILE__ ) );
define( 'CURTAIN_MIN_PHP', '8.2' );
define( 'CURTAIN_MIN_WC', '9.0' );
define( 'CURTAIN_DEFAULT_API_BASE', 'https://api.curtain.fit' );

require_once CURTAIN_PLUGIN_DIR . 'includes/autoload.php';

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
		if ( version_compare( PHP_VERSION, CURTAIN_MIN_PHP, '<' ) ) {
			\Curtain\Plugin::admin_requirement_notice( sprintf( 'Curtain for WooCommerce needs PHP %s or newer (this site runs %s).', CURTAIN_MIN_PHP, PHP_VERSION ) );
			return;
		}
		if ( ! class_exists( 'WooCommerce' ) || ! defined( 'WC_VERSION' ) ) {
			\Curtain\Plugin::admin_requirement_notice( 'Curtain for WooCommerce needs WooCommerce to be installed and active.' );
			return;
		}
		if ( version_compare( (string) WC_VERSION, CURTAIN_MIN_WC, '<' ) ) {
			\Curtain\Plugin::admin_requirement_notice( sprintf( 'Curtain for WooCommerce needs WooCommerce %s or newer (this site runs %s).', CURTAIN_MIN_WC, WC_VERSION ) );
			return;
		}
		\Curtain\Plugin::instance()->boot();
	},
	20
);

register_activation_hook( __FILE__, array( \Curtain\Plugin::class, 'activate' ) );
register_deactivation_hook( __FILE__, array( \Curtain\Plugin::class, 'deactivate' ) );
