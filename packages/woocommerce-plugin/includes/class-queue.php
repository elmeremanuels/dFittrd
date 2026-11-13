<?php
/**
 * Background job abstraction: Action Scheduler (bundled with WooCommerce) when available, WP-Cron
 * otherwise. Jobs are keyed by (hook, args) so a product saved three times in a row is pushed once.
 *
 * @package Curtain
 */

declare(strict_types=1);

namespace Curtain;

defined( 'ABSPATH' ) || exit;

final class Queue {

	public const GROUP = 'curtain';

	public const HOOK_PUSH     = 'curtain_push_product';
	public const HOOK_DELETE   = 'curtain_delete_product';
	public const HOOK_SYNC_ALL = 'curtain_sync_all';

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

	/** Remove every pending Curtain job (deactivation / uninstall / disconnect). */
	public static function cancel_all(): void {
		if ( function_exists( 'as_unschedule_all_actions' ) ) {
			// Hook + group + empty args only cancels jobs whose args are exactly [] (Action Scheduler
			// matches args literally), so the queued pushes ([id, attempt]) survived deactivation.
			// Group alone and hook alone are Action Scheduler's "cancel all" forms. Found on a real
			// WooCommerce 11.2 install (docs/LAUNCH-WOO.md).
			as_unschedule_all_actions( '', array(), self::GROUP );
			foreach ( self::HOOKS as $hook ) {
				as_unschedule_all_actions( $hook );
			}
		}
		// WP-Cron backend: wp_clear_scheduled_hook( $hook ) only clears events with args [] (core
		// matches args exactly); wp_unschedule_hook() removes every event of the hook.
		foreach ( self::HOOKS as $hook ) {
			wp_unschedule_hook( $hook );
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
