<?php
/**
 * Background job abstraction: Action Scheduler (bundled with WooCommerce) when available, WP-Cron
 * otherwise. Jobs are keyed by (hook, args) so a product saved three times in a row is pushed once.
 *
 * @package Paskamer
 */

declare(strict_types=1);

namespace Paskamer;

defined('ABSPATH') || defined('PASKAMER_TESTING') || exit;

final class Queue {

	public const GROUP = 'paskamer';

	public const HOOK_PUSH     = 'paskamer_push_product';
	public const HOOK_DELETE   = 'paskamer_delete_product';
	public const HOOK_SYNC_ALL = 'paskamer_sync_all';

	public const HOOKS = array( self::HOOK_PUSH, self::HOOK_DELETE, self::HOOK_SYNC_ALL );

	/** @return 'action-scheduler'|'wp-cron' */
	public static function backend(): string {
		return function_exists( 'as_schedule_single_action' ) ? 'action-scheduler' : 'wp-cron';
	}

	/**
	 * Schedule a job in `$delay` seconds unless an identical one is already pending.
	 *
	 * @param array<int, mixed> $args Positional hook arguments.
	 */
	public static function enqueue( string $hook, array $args, int $delay = 0 ): void {
		$args = array_values( $args );
		if ( self::has_pending( $hook, $args ) ) {
			return;
		}
		$when = time() + max( 0, $delay );
		if ( 'action-scheduler' === self::backend() ) {
			as_schedule_single_action( $when, $hook, $args, self::GROUP, true );
			return;
		}
		wp_schedule_single_event( $when, $hook, $args );
	}

	/** @param array<int, mixed> $args */
	public static function has_pending( string $hook, array $args ): bool {
		$args = array_values( $args );
		if ( 'action-scheduler' === self::backend() ) {
			if ( function_exists( 'as_has_scheduled_action' ) ) {
				return (bool) as_has_scheduled_action( $hook, $args, self::GROUP );
			}
			return function_exists( 'as_next_scheduled_action' ) && false !== as_next_scheduled_action( $hook, $args, self::GROUP );
		}
		return false !== wp_next_scheduled( $hook, $args );
	}

	/** Remove every pending Paskamer job (deactivation / uninstall / disconnect). */
	public static function cancel_all(): void {
		if ( function_exists( 'as_unschedule_all_actions' ) ) {
			foreach ( self::HOOKS as $hook ) {
				as_unschedule_all_actions( $hook, array(), self::GROUP );
			}
		}
		foreach ( self::HOOKS as $hook ) {
			wp_clear_scheduled_hook( $hook );
		}
	}

	/** Number of pending jobs, for the settings page status line (null when unknown). */
	public static function pending_count(): ?int {
		if ( 'action-scheduler' === self::backend() && function_exists( 'as_get_scheduled_actions' ) ) {
			$ids = as_get_scheduled_actions(
				array(
					'group'    => self::GROUP,
					'status'   => \ActionScheduler_Store::STATUS_PENDING,
					'per_page' => 500,
				),
				'ids'
			);
			return is_array( $ids ) ? count( $ids ) : null;
		}
		return null;
	}
}
