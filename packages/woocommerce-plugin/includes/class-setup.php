<?php
/**
 * "Get set up": the five-step first-run checklist on the Curtain settings page, the WordPress twin of
 * `merchantSetupSteps` in @curtain/schema (merchantSetup.ts). The words are the TypeScript catalogue's
 * WooCommerce variants, word for word (`merchantSetup.test.ts` checks them against this file).
 *
 * Every step ticks itself from this site's own data: the connection, the products' Curtain size chart and
 * garment measurements, and the "Show button" setting. Only the phone check is ticked by hand: the plugin
 * does not ask Curtain how many sizes were shown.
 *
 * @package Curtain
 */

declare(strict_types=1);

namespace Curtain;

defined( 'ABSPATH' ) || exit;

final class Setup {

	/** Products checked for the counts (a first-run list; a shop with more still sees the right ticks). */
	private const SCAN = 300;

	/**
	 * The facts the five steps read.
	 *
	 * @return array{connected:bool,products:int,with_chart:int,measured:int,button:bool,phone:bool,first_product:int,measure_product:int}
	 */
	public static function facts(): array {
		$ids        = get_posts(
			array(
				'post_type'      => 'product',
				'post_status'    => 'publish',
				'posts_per_page' => self::SCAN,
				'fields'         => 'ids',
				'orderby'        => 'ID',
				'order'          => 'ASC',
			)
		);
		$with_chart = 0;
		$measured   = 0;
		$first      = 0;
		$measure    = 0;
		foreach ( (array) $ids as $id ) {
			$id    = (int) $id;
			$chart = (string) get_post_meta( $id, '_curtain_size_chart', true );
			if ( '' === trim( $chart ) || '[]' === trim( $chart ) ) {
				continue;
			}
			++$with_chart;
			$tape = (string) get_post_meta( $id, '_curtain_garment_tape', true );
			if ( str_contains( $tape, '"measured"' ) ) {
				++$measured;
				$first = $first ? $first : $id;
			} elseif ( ! $measure ) {
				$measure = $id;
			}
			$first = $first ? $first : $id;
		}
		return array(
			'connected'       => Settings::is_connected(),
			'products'        => count( (array) $ids ),
			'with_chart'      => $with_chart,
			'measured'        => $measured,
			'button'          => Settings::is_connected() && ! empty( Settings::get( 'button_enabled' ) ),
			'phone'           => ! empty( Settings::get( 'setup_phone_confirmed' ) ),
			'first_product'   => $first,
			'measure_product' => $measure,
		);
	}

	/**
	 * The five steps, in order.
	 *
	 * @param array<string,mixed> $f Facts from facts().
	 * @return list<array{key:string,title:string,done:bool,detail:string,minutes:int,link:string,label:string}>
	 */
	public static function steps( array $f ): array {
		$n      = static fn( int $c, string $one, string $many ): string => $c . ' ' . ( 1 === $c ? $one : $many );
		$edit   = static fn( int $id ): string => $id ? (string) get_edit_post_link( $id, 'raw' ) . '#curtain-tape' : admin_url( 'edit.php?post_type=product' );
		$steps  = array(
			array(
				'key'     => 'connect',
				'title'   => __( 'Connect your shop', 'curtain-woocommerce' ),
				'done'    => (bool) $f['connected'],
				'detail'  => $f['connected']
					? ( 0 === $f['products'] ? __( 'Connected. We are bringing in your products from your shop; this usually takes a minute or two.', 'curtain-woocommerce' ) : sprintf( /* translators: %s: "3 products" */ __( 'Connected. %s brought in from your shop.', 'curtain-woocommerce' ), $n( (int) $f['products'], __( 'product', 'curtain-woocommerce' ), __( 'products', 'curtain-woocommerce' ) ) ) )
					: __( 'In WordPress, go to WooCommerce → Curtain and click “Connect to Curtain”.', 'curtain-woocommerce' ),
				'minutes' => 1,
				'link'    => '#curtain-connection',
				'label'   => __( 'Connect', 'curtain-woocommerce' ),
			),
			array(
				'key'     => 'chart',
				'title'   => __( 'Add a size chart', 'curtain-woocommerce' ),
				'done'    => $f['with_chart'] > 0,
				'detail'  => $f['with_chart'] > 0
					? sprintf( /* translators: %s: "3 products have" */ __( '%s a size chart.', 'curtain-woocommerce' ), $n( (int) $f['with_chart'], __( 'product has', 'curtain-woocommerce' ), __( 'products have', 'curtain-woocommerce' ) ) )
					: __( 'Open a dress or skirt under Products. In the Curtain box choose “Start from a template” (Australian sizes are ready to use), press “Use template”, remove the sizes you do not sell and press Update.', 'curtain-woocommerce' ),
				'minutes' => 3,
				'link'    => admin_url( 'edit.php?post_type=product' ),
				'label'   => __( 'Add a size chart', 'curtain-woocommerce' ),
			),
			array(
				'key'     => 'measure',
				'title'   => __( 'Measure one skirt', 'curtain-woocommerce' ),
				'done'    => $f['measured'] > 0,
				'detail'  => $f['measured'] > 0
					? sprintf( /* translators: %s: "1 product has" */ __( '%s your own measurements. Thank you: these make the biggest difference.', 'curtain-woocommerce' ), $n( (int) $f['measured'], __( 'product has', 'curtain-woocommerce' ), __( 'products have', 'curtain-woocommerce' ) ) )
					: __( 'Lay one skirt flat and measure five numbers on three sizes (the smallest, the largest and one in between). About 3 minutes per size. This is what stops us recommending a size that will not go over the hips.', 'curtain-woocommerce' ),
				'minutes' => 10,
				'link'    => $edit( (int) $f['measure_product'] ),
				'label'   => __( 'Measure a skirt', 'curtain-woocommerce' ),
			),
			array(
				'key'     => 'button',
				'title'   => __( 'Turn the button on', 'curtain-woocommerce' ),
				'done'    => (bool) $f['button'],
				'detail'  => $f['button'] ? __( 'The “Try it on” button is on your product pages.', 'curtain-woocommerce' ) : __( 'In WordPress, go to WooCommerce → Curtain, tick “Show button” and save. The button then appears on your product pages by itself.', 'curtain-woocommerce' ),
				'minutes' => 2,
				'link'    => '#curtain-button',
				'label'   => __( 'Open the Curtain settings', 'curtain-woocommerce' ),
			),
			array(
				'key'     => 'phone',
				'title'   => __( 'Check it on your phone', 'curtain-woocommerce' ),
				'done'    => (bool) $f['phone'],
				'detail'  => $f['phone'] ? __( 'You checked it on your phone.', 'curtain-woocommerce' ) : __( 'Open the product link below on your phone (send it to yourself), tap “Try it on”, type a height and weight and see the size it suggests.', 'curtain-woocommerce' ),
				'minutes' => 2,
				'link'    => $f['first_product'] ? (string) get_permalink( (int) $f['first_product'] ) : '',
				'label'   => __( 'Open the product page', 'curtain-woocommerce' ),
			),
		);
		return $steps;
	}

	/** The box at the top of the settings page. Hidden once every step is done. */
	public static function render_box(): void {
		$steps = self::steps( self::facts() );
		$done  = count( array_filter( $steps, static fn( array $s ): bool => $s['done'] ) );
		$total = count( $steps );
		if ( $done === $total ) {
			echo '<div class="notice notice-success inline"><p>' . esc_html__( 'All done. Shoppers can find their size on your product pages.', 'curtain-woocommerce' ) . '</p></div>';
			return;
		}
		$next = '';
		foreach ( $steps as $s ) {
			if ( ! $s['done'] ) {
				$next = $s['key'];
				break;
			}
		}
		?>
		<div class="card curtain-setup" style="max-width:820px;padding:12px 16px">
			<h2 style="display:flex;justify-content:space-between;gap:12px;margin-top:4px"><?php esc_html_e( 'Get set up', 'curtain-woocommerce' ); ?> <span style="font-size:13px"><?php echo esc_html( sprintf( /* translators: 1: steps done, 2: all steps */ __( '%1$d of %2$d done', 'curtain-woocommerce' ), $done, $total ) ); ?></span></h2>
			<p class="description"><?php esc_html_e( 'Five short steps to the “Try it on” button with a good size on your product pages. Each one ticks itself when it is done.', 'curtain-woocommerce' ); ?></p>
			<ol style="list-style:none;margin:8px 0 0;padding:0">
				<?php
				foreach ( $steps as $i => $s ) :
					$current = $s['key'] === $next;
					?>
					<li data-step="<?php echo esc_attr( $s['key'] ); ?>" style="display:grid;grid-template-columns:28px 1fr;gap:2px 10px;padding:10px 0;border-top:1px solid #dcdcde<?php echo $current ? ';background:#fff8f6' : ''; ?>"<?php echo $current ? ' aria-current="step"' : ''; ?>>
						<span aria-hidden="true" style="width:24px;height:24px;border-radius:50%;display:inline-grid;place-items:center;font-weight:600;<?php echo $s['done'] ? 'background:#1a7f37;color:#fff' : 'border:2px solid #8c8f94'; ?>"><?php echo $s['done'] ? '✓' : esc_html( (string) ( $i + 1 ) ); ?></span>
						<div>
							<strong><?php echo esc_html( ( $i + 1 ) . '. ' . $s['title'] ); ?></strong>
							<?php if ( ! $s['done'] ) : ?>
								<span class="description"> · <?php echo esc_html( sprintf( /* translators: %d: minutes */ __( 'about %d min', 'curtain-woocommerce' ), $s['minutes'] ) ); ?></span>
							<?php endif; ?>
							<div class="description"><?php echo esc_html( $s['detail'] ); ?></div>
							<?php if ( ! $s['done'] && '' !== $s['link'] && 'connect' !== $s['key'] ) : ?>
								<p style="margin:6px 0 0"><a class="button<?php echo $current ? ' button-primary' : ''; ?>" href="<?php echo esc_url( $s['link'] ); ?>"<?php echo 'phone' === $s['key'] ? ' target="_blank" rel="noopener"' : ''; ?>><?php echo esc_html( $s['label'] ); ?></a>
								<?php if ( 'phone' === $s['key'] ) : ?>
									<span class="description"><?php echo esc_html( (string) $s['link'] ); ?></span>
								<?php endif; ?></p>
							<?php endif; ?>
							<?php if ( 'phone' === $s['key'] && ! $s['done'] ) : ?>
								<form method="post" action="<?php echo esc_url( admin_url( 'admin-post.php' ) ); ?>" style="margin:6px 0 0"><?php wp_nonce_field( 'curtain_setup_phone' ); ?><input type="hidden" name="action" value="curtain_setup_phone"><button class="button"><?php esc_html_e( 'It works on my phone', 'curtain-woocommerce' ); ?></button></form>
							<?php endif; ?>
						</div>
					</li>
				<?php endforeach; ?>
			</ol>
		</div>
		<?php
	}
}
