<?php
/**
 * Regressions from the first run on a real WordPress 7.1 + WooCommerce 11.2 (e2e/run.mjs,
 * docs/LAUNCH-WOO.md): the job queue survived deactivation, the button sat above the form on block
 * themes, and the meta box had no size chart templates.
 *
 * @package Curtain\Tests
 */

declare(strict_types=1);

use Curtain\Frontend;
use Curtain\Product_Meta;
use Curtain\Queue;
use Curtain\Settings;

/**
 * Action Scheduler's `as_unschedule_all_actions` with its real matching rules (WooCommerce 11.2,
 * packages/action-scheduler/functions.php): empty args + hook only → every job of the hook; empty
 * args + group only → every job of the group; otherwise only jobs whose args equal $args exactly.
 */
if ( ! function_exists( 'as_unschedule_all_actions' ) ) {
	function as_unschedule_all_actions( $hook, $args = array(), $group = '' ): void {
		$jobs = Curtain_Test_State::$options['_as_jobs'] ?? array();
		$keep = array();
		foreach ( $jobs as $j ) {
			if ( empty( $args ) && '' !== $hook && '' === $group ) {
				$cancel = $j['hook'] === $hook;
			} elseif ( empty( $args ) && '' === $hook && '' !== $group ) {
				$cancel = $j['group'] === $group;
			} else {
				$cancel = ( '' === $hook || $j['hook'] === $hook ) && $j['args'] === $args && ( '' === $group || $j['group'] === $group );
			}
			if ( ! $cancel ) {
				$keep[] = $j;
			}
		}
		Curtain_Test_State::$options['_as_jobs'] = $keep;
	}
}
if ( ! function_exists( 'is_product' ) ) {
	function is_product(): bool { return ! empty( Curtain_Test_State::$options['_is_product'] ); }
}
if ( ! function_exists( 'get_the_ID' ) ) {
	function get_the_ID() { return Curtain_Test_State::$options['_the_id'] ?? 0; }
}

test(
	'Queue::cancel_all removes every Curtain job, whatever its args (deactivate, disconnect)',
	static function (): void {
		Curtain_Test_State::$options['_as_jobs'] = array(
			array( 'hook' => 'curtain_push_product', 'args' => array( 11, 0 ), 'group' => 'curtain' ),
			array( 'hook' => 'curtain_push_product', 'args' => array( 12, 3 ), 'group' => 'curtain' ),
			array( 'hook' => 'curtain_sync_all', 'args' => array( 1 ), 'group' => 'curtain' ),
			array( 'hook' => 'curtain_delete_product', 'args' => array( '9', 0 ), 'group' => 'curtain' ),
			array( 'hook' => 'woocommerce_cleanup_sessions', 'args' => array(), 'group' => 'woocommerce' ),
		);
		Queue::cancel_all();
		$left = Curtain_Test_State::$options['_as_jobs'];
		assert_same( 1, count( $left ), 'only the unrelated WooCommerce job is left' );
		assert_same( 'woocommerce_cleanup_sessions', $left[0]['hook'] );
	}
);

test(
	'uninstall.php cancels Curtain jobs with args too',
	static function (): void {
		$src = (string) file_get_contents( dirname( __DIR__ ) . '/uninstall.php' );
		assert_true( str_contains( $src, "as_unschedule_all_actions( '', array(), 'curtain' )" ), 'group-wide cancel' );
		assert_false( str_contains( $src, "array(), 'curtain' );\n\t}\n\twp_clear" ), 'no hook+group+[] form' );
	}
);

function curtain_golive_shop( int $id ): void {
	Settings::update( array( 'api_key' => 'sk_' . 'test_abcdefghijklmnopqrstuvwxyz0123', 'public_key_prefix' => 'pk_' . 'test_golive00001', 'api_base' => 'https://api.test.curtain.fit' ) );
	Curtain_Test_State::$posts[ $id ] = array( 'status' => 'publish', 'type' => 'product', 'product' => new WC_Product( array( 'id' => $id, 'name' => 'Wrap dress' ) ) );
	update_post_meta( $id, '_curtain_sync_status', 'active' );
	Curtain_Test_State::$options['_is_product'] = true;
	Curtain_Test_State::$options['_the_id']     = $id;
}

test(
	'block themes: the button follows the add-to-cart form block, once per product',
	static function (): void {
		curtain_golive_shop( 501 );
		$form = '<div class="wp-block-add-to-cart-form"><form class="variations_form cart"></form></div>';
		$out  = Frontend::after_form_block( $form, array( 'blockName' => 'woocommerce/add-to-cart-form' ) );
		assert_true( str_starts_with( $out, $form ), 'form first' );
		assert_true( str_contains( $out, 'curtain-try-button' ) && str_contains( $out, 'data-curtain-product="501"' ), 'button after it' );
		assert_same( $form, Frontend::after_form_block( $form, array( 'blockName' => 'woocommerce/add-to-cart-form' ) ), 'not twice' );
		assert_same( '<p>x</p>', Frontend::after_form_block( '<p>x</p>', array( 'blockName' => 'core/post-excerpt' ) ), 'other blocks untouched' );

		curtain_golive_shop( 502 );
		$new = Frontend::after_form_block( '<div>opts</div>', array( 'blockName' => 'woocommerce/add-to-cart-with-options' ) );
		assert_true( str_contains( $new, 'data-curtain-product="502"' ), 'the newer add-to-cart-with-options block too' );

		curtain_golive_shop( 503 );
		Curtain_Test_State::$options['_is_product'] = false;
		assert_same( '<div>f</div>', Frontend::after_form_block( '<div>f</div>', array( 'blockName' => 'woocommerce/add-to-cart-form' ) ), 'only on single product pages' );
	}
);

test(
	'block template detection decides between the summary hook and the form block',
	static function (): void {
		global $_wp_current_template_content;
		$_wp_current_template_content = null;
		assert_false( Frontend::template_has_form_block(), 'classic theme' );
		$_wp_current_template_content = '<!-- wp:woocommerce/legacy-template {"template":"single-product"} /-->';
		assert_false( Frontend::template_has_form_block(), 'block theme rendering the classic template' );
		$_wp_current_template_content = "<!-- wp:post-excerpt /-->\n<!-- wp:woocommerce/add-to-cart-form /-->";
		assert_true( Frontend::template_has_form_block(), 'TT4/TT5 single product template' );
		$_wp_current_template_content = '<!-- wp:woocommerce/add-to-cart-with-options {"lock":{}} -->x<!-- /wp:woocommerce/add-to-cart-with-options -->';
		assert_true( Frontend::template_has_form_block() );
		$_wp_current_template_content = null;
	}
);

test(
	'meta box: size chart templates come from @curtain/schema (assets/chart-templates.json)',
	static function (): void {
		$t   = Product_Meta::chart_templates();
		$ids = array_column( $t, 'id' );
		assert_true( in_array( 'au-womens-body', $ids, true ) && in_array( 'garment-letter-top', $ids, true ), 'body and garment templates: ' . implode( ',', $ids ) );
		$au = $t[ array_search( 'au-womens-body', $ids, true ) ];
		assert_same( 'body', $au['kind'] );
		assert_same( count( $au['sizes'] ), count( $au['rows'] ), 'a row per preselected size' );
		foreach ( $au['rows'] as $r ) {
			assert_true( $r['bust'] > 60 && $r['waist'] > 45 && $r['hip'] > 70, 'cm values for ' . $r['size'] );
		}
	}
);
