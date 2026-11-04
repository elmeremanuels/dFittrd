<?php
/**
 * Tiny class map autoloader (no Composer: WP.org reviewers prefer vendored, dependency-free plugins).
 *
 * @package Paskamer
 */

declare(strict_types=1);

defined( 'ABSPATH' ) || defined( 'PASKAMER_TESTING' ) || exit;

spl_autoload_register(
	static function ( string $class ): void {
		if ( ! str_starts_with( $class, 'Paskamer\\' ) ) {
			return;
		}
		$short = substr( $class, strlen( 'Paskamer\\' ) );
		$file  = __DIR__ . '/class-' . str_replace( '_', '-', strtolower( $short ) ) . '.php';
		if ( is_readable( $file ) ) {
			require_once $file;
		}
	}
);
