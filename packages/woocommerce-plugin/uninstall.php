<?php
/**
 * Uninstall: WordPress runs this when the plugin is deleted from the Plugins screen.
 *
 * The pending Connect token, notices and job queue are always removed. Settings (incl. the
 * encrypted API key) and the `_paskamer_*` product meta are removed only when the merchant ticked
 * "Delete all Paskamer settings and product fit data when the plugin is uninstalled" — garment
 * fit data is hours of work and merchants reinstalling should not lose it by default.
 *
 * @package Paskamer
 */

declare(strict_types=1);

if ( ! defined( 'WP_UNINSTALL_PLUGIN' ) ) {
	exit;
}

$paskamer_option   = 'paskamer_settings';
$paskamer_settings = get_option( $paskamer_option, array() );
$paskamer_settings = is_array( $paskamer_settings ) ? $paskamer_settings : array();

// Job queue (Action Scheduler if WooCommerce is still around, WP-Cron always).
foreach ( array( 'paskamer_push_product', 'paskamer_delete_product', 'paskamer_sync_all' ) as $paskamer_hook ) {
	if ( function_exists( 'as_unschedule_all_actions' ) ) {
		as_unschedule_all_actions( $paskamer_hook, array(), 'paskamer' );
	}
	wp_clear_scheduled_hook( $paskamer_hook );
}

// Transient notices.
global $wpdb;
$wpdb->query( "DELETE FROM {$wpdb->options} WHERE option_name LIKE '\_transient\_paskamer\_%' OR option_name LIKE '\_transient\_timeout\_paskamer\_%'" ); // phpcs:ignore WordPress.DB.DirectDatabaseQuery

if ( ! empty( $paskamer_settings['delete_on_uninstall'] ) ) {
	delete_option( $paskamer_option );
	$wpdb->query( "DELETE FROM {$wpdb->postmeta} WHERE meta_key LIKE '\_paskamer\_%'" ); // phpcs:ignore WordPress.DB.DirectDatabaseQuery
	wp_cache_flush();
} else {
	// Keep the data, but never leave a half-finished Connect lying around.
	unset( $paskamer_settings['connect_token_enc'], $paskamer_settings['connect_shop_id'], $paskamer_settings['connect_mode'] );
	update_option( $paskamer_option, $paskamer_settings, true );
}
