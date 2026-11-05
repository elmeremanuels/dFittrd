<?php
/**
 * Uninstall: WordPress runs this when the plugin is deleted from the Plugins screen.
 *
 * The pending Connect token, notices and job queue are always removed. Settings (incl. the
 * encrypted API key) and the `_curtain_*` product meta are removed only when the merchant ticked
 * "Delete all Curtain settings and product fit data when the plugin is uninstalled" — garment
 * fit data is hours of work and merchants reinstalling should not lose it by default.
 *
 * @package Curtain
 */

declare(strict_types=1);

if ( ! defined( 'WP_UNINSTALL_PLUGIN' ) ) {
	exit;
}

$curtain_option   = 'curtain_settings';
$curtain_settings = get_option( $curtain_option, array() );
$curtain_settings = is_array( $curtain_settings ) ? $curtain_settings : array();

// Job queue (Action Scheduler if WooCommerce is still around, WP-Cron always).
foreach ( array( 'curtain_push_product', 'curtain_delete_product', 'curtain_sync_all' ) as $curtain_hook ) {
	if ( function_exists( 'as_unschedule_all_actions' ) ) {
		as_unschedule_all_actions( $curtain_hook, array(), 'curtain' );
	}
	wp_clear_scheduled_hook( $curtain_hook );
}

// Transient notices.
global $wpdb;
$wpdb->query( "DELETE FROM {$wpdb->options} WHERE option_name LIKE '\_transient\_curtain\_%' OR option_name LIKE '\_transient\_timeout\_curtain\_%'" ); // phpcs:ignore WordPress.DB.DirectDatabaseQuery

if ( ! empty( $curtain_settings['delete_on_uninstall'] ) ) {
	delete_option( $curtain_option );
	$wpdb->query( "DELETE FROM {$wpdb->postmeta} WHERE meta_key LIKE '\_curtain\_%'" ); // phpcs:ignore WordPress.DB.DirectDatabaseQuery
	wp_cache_flush();
} else {
	// Keep the data, but never leave a half-finished Connect lying around.
	unset( $curtain_settings['connect_token_enc'], $curtain_settings['connect_shop_id'], $curtain_settings['connect_mode'] );
	update_option( $curtain_option, $curtain_settings, true );
}
