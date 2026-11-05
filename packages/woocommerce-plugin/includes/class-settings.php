<?php
/**
 * Settings storage + the WooCommerce → Paskamer settings page (Connect round-trip, manual key,
 * status, storefront button options, ads toggle, uninstall cleanup). D6: no telemetry before the
 * merchant clicks Connect; the secret key is stored encrypted (Secret_Store).
 *
 * @package Paskamer
 */

declare(strict_types=1);

namespace Paskamer;

defined('ABSPATH') || defined('PASKAMER_TESTING') || exit;

final class Settings {

	public const OPTION = 'paskamer_settings';
	public const PAGE   = 'paskamer';

	private const ENCRYPTED = array( 'api_key', 'connect_token' );

	/** @return array<string,mixed> */
	public static function defaults(): array {
		return array(
			'api_base'            => PASKAMER_DEFAULT_API_BASE,
			'api_key'             => '',
			'public_key_prefix'   => '',
			'shop_id'             => '',
			'shop_name'           => '',
			'plan'                => '',
			'paused'              => false,
			'connected_at'        => 0,
			'connect_token'       => '',
			'connect_shop_id'     => '',
			'connect_mode'        => '',
			'ads_enabled'         => false,
			'button_enabled'      => true,
			'button_priority'     => 35,
			'button_label'        => '',
			'button_scope'        => 'active',
			'locale'              => 'auto',
			'default_brand'       => '',
			'share_admin_email'   => true,
			'delete_on_uninstall' => false,
			'last_sync_at'        => 0,
			'last_status_at'      => 0,
			'last_error'          => '',
		);
	}

	/** Decrypted settings merged over the defaults. @return array<string,mixed> */
	public static function all(): array {
		$raw = get_option( self::OPTION, array() );
		$raw = is_array( $raw ) ? $raw : array();
		$out = array_merge( self::defaults(), $raw );
		foreach ( self::ENCRYPTED as $key ) {
			$out[ $key ] = Secret_Store::decrypt( (string) ( $raw[ $key . '_enc' ] ?? '' ) );
			unset( $out[ $key . '_enc' ] );
		}
		return $out;
	}

	/** @return mixed */
	public static function get( string $key ) {
		return self::all()[ $key ] ?? null;
	}

	/**
	 * Merge a patch into the stored option, encrypting secrets.
	 *
	 * @param array<string,mixed> $patch
	 */
	public static function update( array $patch ): void {
		$raw = get_option( self::OPTION, array() );
		$raw = is_array( $raw ) ? $raw : array();
		foreach ( $patch as $key => $value ) {
			if ( in_array( $key, self::ENCRYPTED, true ) ) {
				$raw[ $key . '_enc' ] = Secret_Store::encrypt( (string) $value );
				unset( $raw[ $key ] );
				continue;
			}
			$raw[ $key ] = $value;
		}
		update_option( self::OPTION, $raw, true );
	}

	public static function is_connected(): bool {
		$s = self::all();
		return Hmac::is_public_key( (string) $s['public_key_prefix'] ) && Hmac::is_secret_key( (string) $s['api_key'] );
	}

	public static function page_url( array $args = array() ): string {
		return add_query_arg( array_merge( array( 'page' => self::PAGE ), $args ), admin_url( 'admin.php' ) );
	}

	/** Button label with the locale default. */
	public static function button_label(): string {
		$label = trim( (string) self::get( 'button_label' ) );
		if ( '' !== $label ) {
			return $label;
		}
		return 'nl' === self::effective_locale() ? 'Pas in Paskamer' : __( 'Try in Paskamer', 'paskamer-woocommerce' );
	}

	/** 'en' | 'nl' for the SDK's data-locale. */
	public static function effective_locale(): string {
		$setting = (string) self::get( 'locale' );
		if ( 'en' === $setting || 'nl' === $setting ) {
			return $setting;
		}
		return str_starts_with( (string) get_locale(), 'nl' ) ? 'nl' : 'en';
	}

	// ---- admin page ------------------------------------------------------------------------

	public static function register(): void {
		add_action( 'admin_menu', array( self::class, 'menu' ) );
		add_action( 'admin_post_paskamer_save', array( self::class, 'handle_save' ) );
		add_action( 'admin_post_paskamer_connect', array( self::class, 'handle_connect' ) );
		add_action( 'admin_post_paskamer_complete', array( self::class, 'handle_complete' ) );
		add_action( 'admin_post_paskamer_manual_key', array( self::class, 'handle_manual_key' ) );
		add_action( 'admin_post_paskamer_disconnect', array( self::class, 'handle_disconnect' ) );
		add_action( 'admin_post_paskamer_status', array( self::class, 'handle_status' ) );
		add_action( 'admin_post_paskamer_sync_all', array( self::class, 'handle_sync_all' ) );
		add_action( 'admin_notices', array( self::class, 'notices' ) );
	}

	public static function menu(): void {
		$hook = add_submenu_page(
			'woocommerce',
			__( 'Paskamer', 'paskamer-woocommerce' ),
			__( 'Paskamer', 'paskamer-woocommerce' ),
			'manage_woocommerce',
			self::PAGE,
			array( self::class, 'render' )
		);
		if ( is_string( $hook ) && '' !== $hook ) {
			// Runs before the admin header is printed, so finish_connect() can still redirect.
			add_action( 'load-' . $hook, array( self::class, 'maybe_finish_connect' ) );
		}
	}

	/** Back from Stripe Checkout (`?paskamer=connected`): finish automatically when a Connect token is pending. */
	public static function maybe_finish_connect(): void {
		if ( ! current_user_can( 'manage_woocommerce' ) ) {
			return;
		}
		if ( isset( $_GET['paskamer'] ) && 'connected' === $_GET['paskamer'] && '' !== (string) self::get( 'connect_token' ) ) { // phpcs:ignore WordPress.Security.NonceVerification.Recommended -- idempotent token exchange with a server-stored token.
			self::finish_connect();
		}
	}

	/**
	 * API base URL from the settings form: https only (the Connect/complete responses and the manual
	 * key check carry the secret key), plain http only for local development hosts. '' = invalid.
	 */
	public static function sanitize_api_base( string $raw ): string {
		$url = esc_url_raw( trim( $raw ) );
		if ( '' === $url ) {
			return '';
		}
		$parts  = wp_parse_url( $url );
		$scheme = is_array( $parts ) ? strtolower( (string) ( $parts['scheme'] ?? '' ) ) : '';
		$host   = is_array( $parts ) ? strtolower( (string) ( $parts['host'] ?? '' ) ) : '';
		if ( '' === $host ) {
			return '';
		}
		$local = in_array( $host, array( 'localhost', '127.0.0.1', '[::1]', '::1' ), true ) || str_ends_with( $host, '.localhost' );
		if ( 'https' !== $scheme && ! ( 'http' === $scheme && $local ) ) {
			return '';
		}
		return rtrim( $url, '/' );
	}

	private static function guard( string $action ): void {
		if ( ! current_user_can( 'manage_woocommerce' ) ) {
			wp_die( esc_html__( 'You are not allowed to manage Paskamer settings.', 'paskamer-woocommerce' ), 403 );
		}
		check_admin_referer( $action );
	}

	private static function redirect( string $notice, string $type = 'success' ): void {
		set_transient( 'paskamer_notice_' . get_current_user_id(), array( 'type' => $type, 'text' => $notice ), 60 );
		wp_safe_redirect( self::page_url() );
		exit;
	}

	public static function notices(): void {
		$screen = function_exists( 'get_current_screen' ) ? get_current_screen() : null;
		if ( ! $screen || 'woocommerce_page_' . self::PAGE !== $screen->id ) {
			return;
		}
		$notice = get_transient( 'paskamer_notice_' . get_current_user_id() );
		if ( is_array( $notice ) ) {
			delete_transient( 'paskamer_notice_' . get_current_user_id() );
			printf( '<div class="notice notice-%s is-dismissible"><p>%s</p></div>', esc_attr( (string) $notice['type'] ), esc_html( (string) $notice['text'] ) );
		}
		if ( 'plain' === Secret_Store::scheme() ) {
			echo '<div class="notice notice-warning"><p>' . esc_html__( 'Neither libsodium nor OpenSSL is available on this server, so the Paskamer API key is stored unencrypted in the database. Ask your host to enable the sodium extension.', 'paskamer-woocommerce' ) . '</p></div>';
		}
	}

	// ---- handlers --------------------------------------------------------------------------

	public static function handle_save(): void {
		self::guard( 'paskamer_save' );
		$in = isset( $_POST['paskamer'] ) && is_array( $_POST['paskamer'] ) ? wp_unslash( $_POST['paskamer'] ) : array(); // phpcs:ignore WordPress.Security.ValidatedSanitizedInput -- sanitised field by field below.

		$api_base = self::sanitize_api_base( (string) ( $in['api_base'] ?? '' ) );
		$priority = absint( $in['button_priority'] ?? 35 );
		$label    = sanitize_text_field( (string) ( $in['button_label'] ?? '' ) );
		$locale   = in_array( $in['locale'] ?? 'auto', array( 'auto', 'en', 'nl' ), true ) ? (string) $in['locale'] : 'auto';
		$scope    = in_array( $in['button_scope'] ?? 'active', array( 'active', 'all' ), true ) ? (string) $in['button_scope'] : 'active';
		$ads      = ! empty( $in['ads_enabled'] );

		self::update(
			array(
				'api_base'            => '' === $api_base ? PASKAMER_DEFAULT_API_BASE : $api_base,
				'button_enabled'      => ! empty( $in['button_enabled'] ),
				'button_priority'     => $priority > 0 ? $priority : 35,
				'button_label'        => mb_substr( $label, 0, 60 ),
				'button_scope'        => $scope,
				'locale'              => $locale,
				'default_brand'       => mb_substr( sanitize_text_field( (string) ( $in['default_brand'] ?? '' ) ), 0, 120 ),
				'share_admin_email'   => ! empty( $in['share_admin_email'] ),
				'ads_enabled'         => $ads,
				'delete_on_uninstall' => ! empty( $in['delete_on_uninstall'] ),
			)
		);

		// Propagate the ads toggle to the backend when connected (the api strips unknown keys; harmless if ignored).
		if ( self::is_connected() ) {
			self::hello();
		}
		self::redirect( __( 'Settings saved.', 'paskamer-woocommerce' ) );
	}

	/** Step 1: create the shop on our backend, then go to Stripe Checkout (or finish immediately). */
	public static function handle_connect(): void {
		self::guard( 'paskamer_connect' );
		$s      = self::all();
		$client = new Api_Client( $s );
		$email  = ! empty( $s['share_admin_email'] ) ? (string) get_option( 'admin_email' ) : null;
		$res    = $client->connect( home_url( '/' ), (string) get_bloginfo( 'name' ), $email, self::page_url() );
		if ( ! $res['ok'] ) {
			if ( 'already_connected' === $res['error_code'] ) {
				self::redirect( __( 'This site is already connected to Paskamer. Paste the API key from your Paskamer console below, or rotate it there first.', 'paskamer-woocommerce' ), 'warning' );
			}
			self::redirect( sprintf( /* translators: %s: error message */ __( 'Could not connect: %s', 'paskamer-woocommerce' ), (string) $res['error_message'] ), 'error' );
		}
		$data = $res['data'] ?? array();
		self::update(
			array(
				'connect_token'   => (string) ( $data['connectToken'] ?? '' ),
				'connect_shop_id' => (string) ( $data['shopId'] ?? '' ),
				'connect_mode'    => (string) ( $data['mode'] ?? '' ),
			)
		);
		if ( 'stripe' === ( $data['mode'] ?? '' ) && ! empty( $data['checkoutUrl'] ) ) {
			wp_redirect( esc_url_raw( (string) $data['checkoutUrl'] ) ); // phpcs:ignore WordPress.Security.SafeRedirect -- external Stripe Checkout URL returned by our API.
			exit;
		}
		self::finish_connect();
	}

	/** Step 2 (manual retry button after Checkout). */
	public static function handle_complete(): void {
		self::guard( 'paskamer_complete' );
		self::finish_connect();
	}

	/** Exchange the stored Connect token for the merchant keys, then say hello. */
	public static function finish_connect(): void {
		$s     = self::all();
		$token = (string) $s['connect_token'];
		if ( '' === $token ) {
			self::redirect( __( 'No pending connection. Click Connect to start.', 'paskamer-woocommerce' ), 'warning' );
		}
		$res = ( new Api_Client( $s ) )->complete( $token );
		if ( ! $res['ok'] ) {
			if ( 'payment_pending' === $res['error_code'] ) {
				self::redirect( __( 'Checkout has not completed yet. Finish the payment, then click "Finish connection".', 'paskamer-woocommerce' ), 'warning' );
			}
			self::redirect( sprintf( /* translators: %s: error message */ __( 'Could not finish the connection: %s', 'paskamer-woocommerce' ), (string) $res['error_message'] ), 'error' );
		}
		$data = $res['data'] ?? array();
		self::update(
			array(
				'api_key'           => (string) ( $data['apiKey'] ?? '' ),
				'public_key_prefix' => (string) ( $data['publicKeyPrefix'] ?? '' ),
				'shop_id'           => (string) ( $data['shopId'] ?? '' ),
				'plan'              => (string) ( $data['plan'] ?? '' ),
				'connected_at'      => time(),
				'connect_token'     => '',
				'connect_shop_id'   => '',
				'connect_mode'      => '',
				'last_error'        => '',
			)
		);
		self::hello();
		Sync::enqueue_sync_all();
		self::redirect( __( 'Connected to Paskamer. Your published products are being synced in the background.', 'paskamer-woocommerce' ) );
	}

	/** Paste a key issued by the Paskamer console (sk_live_…): the hello returns its pk_ prefix. */
	public static function handle_manual_key(): void {
		self::guard( 'paskamer_manual_key' );
		$key = isset( $_POST['paskamer_api_key'] ) ? sanitize_text_field( wp_unslash( $_POST['paskamer_api_key'] ) ) : '';
		if ( ! Hmac::is_secret_key( $key ) ) {
			self::redirect( __( 'That does not look like a Paskamer secret key (sk_live_… or sk_test_…).', 'paskamer-woocommerce' ), 'error' );
		}
		$res = ( new Api_Client( self::all() ) )->hello( self::hello_body(), 'bearer', $key );
		if ( ! $res['ok'] ) {
			self::redirect( sprintf( /* translators: %s: error message */ __( 'The key was rejected: %s', 'paskamer-woocommerce' ), (string) $res['error_message'] ), 'error' );
		}
		$data = $res['data'] ?? array();
		self::update(
			array(
				'api_key'           => $key,
				'public_key_prefix' => (string) ( $data['publicKeyPrefix'] ?? '' ),
				'shop_id'           => (string) ( $data['shopId'] ?? '' ),
				'shop_name'         => (string) ( $data['name'] ?? '' ),
				'plan'              => (string) ( $data['plan'] ?? '' ),
				'paused'            => ! empty( $data['paused'] ),
				'connected_at'      => time(),
				'last_status_at'    => time(),
				'last_error'        => '',
			)
		);
		Sync::enqueue_sync_all();
		self::redirect( __( 'Key accepted. Your published products are being synced in the background.', 'paskamer-woocommerce' ) );
	}

	public static function handle_disconnect(): void {
		self::guard( 'paskamer_disconnect' );
		Queue::cancel_all();
		self::update(
			array(
				'api_key'           => '',
				'public_key_prefix' => '',
				'shop_id'           => '',
				'shop_name'         => '',
				'plan'              => '',
				'paused'            => false,
				'connected_at'      => 0,
				'connect_token'     => '',
				'connect_shop_id'   => '',
				'connect_mode'      => '',
			)
		);
		self::redirect( __( 'Disconnected. The button is no longer shown and nothing is sent to Paskamer. Your garment data stays in WooCommerce.', 'paskamer-woocommerce' ) );
	}

	public static function handle_status(): void {
		self::guard( 'paskamer_status' );
		$res = self::hello();
		if ( $res['ok'] ) {
			self::redirect( __( 'Status refreshed.', 'paskamer-woocommerce' ) );
		}
		self::redirect( sprintf( /* translators: %s: error message */ __( 'Status check failed: %s', 'paskamer-woocommerce' ), (string) $res['error_message'] ), 'error' );
	}

	public static function handle_sync_all(): void {
		self::guard( 'paskamer_sync_all' );
		if ( ! self::is_connected() ) {
			self::redirect( __( 'Connect the shop first.', 'paskamer-woocommerce' ), 'warning' );
		}
		Sync::enqueue_sync_all();
		self::redirect( __( 'Full sync queued. Products are pushed in the background.', 'paskamer-woocommerce' ) );
	}

	/** PUT /v1/merchant/shops/self with HMAC; stores plan/paused/name. @return array<string,mixed> */
	public static function hello(): array {
		$res = Api_Client::from_settings()->hello( self::hello_body() );
		if ( $res['ok'] ) {
			$data = $res['data'] ?? array();
			self::update(
				array(
					'shop_name'         => (string) ( $data['name'] ?? '' ),
					'plan'              => (string) ( $data['plan'] ?? '' ),
					'paused'            => ! empty( $data['paused'] ),
					'public_key_prefix' => (string) ( $data['publicKeyPrefix'] ?? self::get( 'public_key_prefix' ) ),
					'shop_id'           => (string) ( $data['shopId'] ?? self::get( 'shop_id' ) ),
					'last_status_at'    => time(),
					'last_error'        => '',
				)
			);
		} else {
			self::update( array( 'last_error' => (string) $res['error_message'] ) );
		}
		return $res;
	}

	/** Body of the hello (ShopSelfRequestSchema in apps/api/src/routes/merchant.ts). @return array<string,mixed> */
	public static function hello_body(): array {
		$wc = defined( 'WC_VERSION' ) ? (string) WC_VERSION : '?';
		return array(
			'name'            => (string) get_bloginfo( 'name' ),
			'siteUrl'         => home_url( '/' ),
			'pluginVersion'   => PASKAMER_VERSION,
			'platformVersion' => mb_substr( 'wp' . get_bloginfo( 'version' ) . '-wc' . $wc, 0, 32 ),
			'adsEnabled'      => (bool) self::get( 'ads_enabled' ),
		);
	}

	// ---- page ------------------------------------------------------------------------------

	public static function render(): void {
		if ( ! current_user_can( 'manage_woocommerce' ) ) {
			return;
		}
		// Back from Stripe Checkout is handled by maybe_finish_connect() on load-<page> (before output).
		$s         = self::all();
		$connected = self::is_connected();
		$pending   = '' !== (string) $s['connect_token'];
		?>
		<div class="wrap paskamer-settings">
			<h1><?php esc_html_e( 'Paskamer for WooCommerce', 'paskamer-woocommerce' ); ?></h1>
			<p class="description"><?php esc_html_e( 'Paskamer is a private fitting room: shoppers measure themselves on their own phone and see how your garments fit. Only garment data (size charts, fabric, photos) leaves this site — never customer data.', 'paskamer-woocommerce' ); ?></p>

			<h2><?php esc_html_e( 'Connection', 'paskamer-woocommerce' ); ?></h2>
			<table class="form-table" role="presentation">
				<tr>
					<th scope="row"><?php esc_html_e( 'Status', 'paskamer-woocommerce' ); ?></th>
					<td>
						<?php if ( $connected ) : ?>
							<strong style="color:#1a7f37">●</strong> <?php esc_html_e( 'Connected', 'paskamer-woocommerce' ); ?>
							<?php if ( '' !== (string) $s['shop_name'] ) : ?> — <?php echo esc_html( (string) $s['shop_name'] ); ?><?php endif; ?>
							<br><code><?php echo esc_html( (string) $s['public_key_prefix'] ); ?></code>
							<?php if ( '' !== (string) $s['plan'] ) : ?> · <?php echo esc_html( sprintf( /* translators: %s: plan name */ __( 'plan: %s', 'paskamer-woocommerce' ), (string) $s['plan'] ) ); ?><?php endif; ?>
							<?php if ( ! empty( $s['paused'] ) ) : ?> · <strong style="color:#b32d2e"><?php esc_html_e( 'paused (below plan — the button still renders, the app shows a "shop paused" screen)', 'paskamer-woocommerce' ); ?></strong><?php endif; ?>
							<br><span class="description">
								<?php echo esc_html( sprintf( /* translators: 1: key storage scheme, 2: queue backend */ __( 'Key stored with %1$s · job queue: %2$s', 'paskamer-woocommerce' ), Secret_Store::scheme(), Queue::backend() ) ); ?>
								<?php $pending_jobs = Queue::pending_count(); ?>
								<?php if ( null !== $pending_jobs ) : ?> · <?php echo esc_html( sprintf( /* translators: %d: number of jobs */ _n( '%d pending job', '%d pending jobs', $pending_jobs, 'paskamer-woocommerce' ), $pending_jobs ) ); ?><?php endif; ?>
								<?php if ( ! empty( $s['last_sync_at'] ) ) : ?> · <?php echo esc_html( sprintf( /* translators: %s: date */ __( 'last sync %s', 'paskamer-woocommerce' ), wp_date( 'Y-m-d H:i', (int) $s['last_sync_at'] ) ) ); ?><?php endif; ?>
							</span>
							<?php if ( '' !== (string) $s['last_error'] ) : ?><br><span style="color:#b32d2e"><?php echo esc_html( sprintf( /* translators: %s: error message */ __( 'Last error: %s', 'paskamer-woocommerce' ), (string) $s['last_error'] ) ); ?></span><?php endif; ?>
						<?php elseif ( $pending ) : ?>
							<strong style="color:#b26b00">●</strong> <?php esc_html_e( 'Waiting for checkout to complete.', 'paskamer-woocommerce' ); ?>
						<?php else : ?>
							<strong style="color:#8c8f94">●</strong> <?php esc_html_e( 'Not connected — nothing is sent to Paskamer.', 'paskamer-woocommerce' ); ?>
						<?php endif; ?>
					</td>
				</tr>
				<tr>
					<th scope="row"><?php esc_html_e( 'Actions', 'paskamer-woocommerce' ); ?></th>
					<td>
						<?php if ( $connected ) : ?>
							<form method="post" action="<?php echo esc_url( admin_url( 'admin-post.php' ) ); ?>" style="display:inline"><?php wp_nonce_field( 'paskamer_status' ); ?><input type="hidden" name="action" value="paskamer_status"><button class="button"><?php esc_html_e( 'Check status', 'paskamer-woocommerce' ); ?></button></form>
							<form method="post" action="<?php echo esc_url( admin_url( 'admin-post.php' ) ); ?>" style="display:inline"><?php wp_nonce_field( 'paskamer_sync_all' ); ?><input type="hidden" name="action" value="paskamer_sync_all"><button class="button"><?php esc_html_e( 'Sync all products', 'paskamer-woocommerce' ); ?></button></form>
							<form method="post" action="<?php echo esc_url( admin_url( 'admin-post.php' ) ); ?>" style="display:inline" onsubmit="return confirm('<?php echo esc_js( __( 'Disconnect this shop from Paskamer?', 'paskamer-woocommerce' ) ); ?>')"><?php wp_nonce_field( 'paskamer_disconnect' ); ?><input type="hidden" name="action" value="paskamer_disconnect"><button class="button button-link-delete"><?php esc_html_e( 'Disconnect', 'paskamer-woocommerce' ); ?></button></form>
						<?php else : ?>
							<form method="post" action="<?php echo esc_url( admin_url( 'admin-post.php' ) ); ?>" style="display:inline"><?php wp_nonce_field( 'paskamer_connect' ); ?><input type="hidden" name="action" value="paskamer_connect"><button class="button button-primary"><?php esc_html_e( 'Connect to Paskamer', 'paskamer-woocommerce' ); ?></button></form>
							<?php if ( $pending ) : ?>
								<form method="post" action="<?php echo esc_url( admin_url( 'admin-post.php' ) ); ?>" style="display:inline"><?php wp_nonce_field( 'paskamer_complete' ); ?><input type="hidden" name="action" value="paskamer_complete"><button class="button"><?php esc_html_e( 'Finish connection', 'paskamer-woocommerce' ); ?></button></form>
							<?php endif; ?>
							<p class="description"><?php esc_html_e( 'Connect sends your site URL and shop name to Paskamer, creates your merchant account and (when billing is enabled) takes you to Stripe Checkout. You will be sent back here afterwards.', 'paskamer-woocommerce' ); ?></p>
						<?php endif; ?>
					</td>
				</tr>
				<?php if ( ! $connected ) : ?>
				<tr>
					<th scope="row"><label for="paskamer_api_key"><?php esc_html_e( 'Or paste an API key', 'paskamer-woocommerce' ); ?></label></th>
					<td>
						<form method="post" action="<?php echo esc_url( admin_url( 'admin-post.php' ) ); ?>"><?php wp_nonce_field( 'paskamer_manual_key' ); ?><input type="hidden" name="action" value="paskamer_manual_key">
							<input type="password" id="paskamer_api_key" name="paskamer_api_key" class="regular-text" autocomplete="off" placeholder="sk_live_…">
							<button class="button"><?php esc_html_e( 'Use key', 'paskamer-woocommerce' ); ?></button>
							<p class="description"><?php esc_html_e( 'Secret key from your Paskamer merchant console. It is stored encrypted and never shown again.', 'paskamer-woocommerce' ); ?></p>
						</form>
					</td>
				</tr>
				<?php endif; ?>
			</table>

			<form method="post" action="<?php echo esc_url( admin_url( 'admin-post.php' ) ); ?>">
				<?php wp_nonce_field( 'paskamer_save' ); ?>
				<input type="hidden" name="action" value="paskamer_save">
				<h2><?php esc_html_e( 'Storefront button', 'paskamer-woocommerce' ); ?></h2>
				<table class="form-table" role="presentation">
					<tr>
						<th scope="row"><?php esc_html_e( 'Show button', 'paskamer-woocommerce' ); ?></th>
						<td><label><input type="checkbox" name="paskamer[button_enabled]" value="1" <?php checked( ! empty( $s['button_enabled'] ) ); ?>> <?php esc_html_e( 'Add a "Try in Paskamer" button to single product pages (bundled script, no third-party requests).', 'paskamer-woocommerce' ); ?></label>
						<p class="description"><?php esc_html_e( 'You can also place it yourself with the [paskamer_button] shortcode.', 'paskamer-woocommerce' ); ?></p></td>
					</tr>
					<tr>
						<th scope="row"><label for="paskamer_button_scope"><?php esc_html_e( 'Show for', 'paskamer-woocommerce' ); ?></label></th>
						<td><select id="paskamer_button_scope" name="paskamer[button_scope]">
							<option value="active" <?php selected( $s['button_scope'], 'active' ); ?>><?php esc_html_e( 'Products synced as complete ("active") only', 'paskamer-woocommerce' ); ?></option>
							<option value="all" <?php selected( $s['button_scope'], 'all' ); ?>><?php esc_html_e( 'All published products', 'paskamer-woocommerce' ); ?></option>
						</select></td>
					</tr>
					<tr>
						<th scope="row"><label for="paskamer_button_priority"><?php esc_html_e( 'Position', 'paskamer-woocommerce' ); ?></label></th>
						<td><input type="number" id="paskamer_button_priority" name="paskamer[button_priority]" min="1" max="100" value="<?php echo esc_attr( (string) $s['button_priority'] ); ?>" class="small-text">
						<p class="description"><?php esc_html_e( 'woocommerce_single_product_summary priority: 35 = after the add-to-cart form, 25 = before it, 15 = after the price.', 'paskamer-woocommerce' ); ?></p></td>
					</tr>
					<tr>
						<th scope="row"><label for="paskamer_button_label"><?php esc_html_e( 'Label', 'paskamer-woocommerce' ); ?></label></th>
						<td><input type="text" id="paskamer_button_label" name="paskamer[button_label]" value="<?php echo esc_attr( (string) $s['button_label'] ); ?>" class="regular-text" placeholder="<?php echo esc_attr( self::button_label() ); ?>"></td>
					</tr>
					<tr>
						<th scope="row"><label for="paskamer_locale"><?php esc_html_e( 'Language', 'paskamer-woocommerce' ); ?></label></th>
						<td><select id="paskamer_locale" name="paskamer[locale]">
							<option value="auto" <?php selected( $s['locale'], 'auto' ); ?>><?php esc_html_e( 'Follow the site language', 'paskamer-woocommerce' ); ?></option>
							<option value="en" <?php selected( $s['locale'], 'en' ); ?>>English</option>
							<option value="nl" <?php selected( $s['locale'], 'nl' ); ?>>Nederlands</option>
						</select></td>
					</tr>
				</table>

				<h2><?php esc_html_e( 'Catalogue', 'paskamer-woocommerce' ); ?></h2>
				<table class="form-table" role="presentation">
					<tr>
						<th scope="row"><label for="paskamer_default_brand"><?php esc_html_e( 'Default brand', 'paskamer-woocommerce' ); ?></label></th>
						<td><input type="text" id="paskamer_default_brand" name="paskamer[default_brand]" value="<?php echo esc_attr( (string) $s['default_brand'] ); ?>" class="regular-text" placeholder="<?php echo esc_attr( (string) get_bloginfo( 'name' ) ); ?>">
						<p class="description"><?php esc_html_e( 'Used when a product has no brand (Paskamer field, Brands taxonomy or a "Brand" attribute).', 'paskamer-woocommerce' ); ?></p></td>
					</tr>
					<tr>
						<th scope="row"><?php esc_html_e( 'Sponsored placement', 'paskamer-woocommerce' ); ?></th>
						<td><label><input type="checkbox" name="paskamer[ads_enabled]" value="1" <?php checked( ! empty( $s['ads_enabled'] ) ); ?>> <?php esc_html_e( 'Allow my products to appear as sponsored cards in the Paskamer swipe deck (billed per plan).', 'paskamer-woocommerce' ); ?></label></td>
					</tr>
				</table>

				<h2><?php esc_html_e( 'Advanced', 'paskamer-woocommerce' ); ?></h2>
				<table class="form-table" role="presentation">
					<tr>
						<th scope="row"><label for="paskamer_api_base"><?php esc_html_e( 'API base URL', 'paskamer-woocommerce' ); ?></label></th>
						<td><input type="url" id="paskamer_api_base" name="paskamer[api_base]" value="<?php echo esc_attr( (string) $s['api_base'] ); ?>" class="regular-text" placeholder="<?php echo esc_attr( PASKAMER_DEFAULT_API_BASE ); ?>">
						<p class="description"><?php esc_html_e( 'Only change this for a staging environment.', 'paskamer-woocommerce' ); ?></p></td>
					</tr>
					<tr>
						<th scope="row"><?php esc_html_e( 'Admin e-mail', 'paskamer-woocommerce' ); ?></th>
						<td><label><input type="checkbox" name="paskamer[share_admin_email]" value="1" <?php checked( ! empty( $s['share_admin_email'] ) ); ?>> <?php esc_html_e( 'Send the site admin e-mail with Connect so Paskamer can reach you about billing (optional).', 'paskamer-woocommerce' ); ?></label></td>
					</tr>
					<tr>
						<th scope="row"><?php esc_html_e( 'Uninstall', 'paskamer-woocommerce' ); ?></th>
						<td><label><input type="checkbox" name="paskamer[delete_on_uninstall]" value="1" <?php checked( ! empty( $s['delete_on_uninstall'] ) ); ?>> <?php esc_html_e( 'Delete all Paskamer settings and product fit data when the plugin is uninstalled.', 'paskamer-woocommerce' ); ?></label></td>
					</tr>
				</table>
				<?php submit_button( __( 'Save settings', 'paskamer-woocommerce' ) ); ?>
			</form>

			<h2><?php esc_html_e( 'What is sent to Paskamer', 'paskamer-woocommerce' ); ?></h2>
			<p><?php echo esc_html( sprintf( /* translators: %s: API host */ __( 'After you connect, published products (name, price in EUR, product photos, categories, attributes) and the fit data from the Paskamer box on the product page are sent to %s. Nothing about your customers or orders is ever sent. Disconnect at any time.', 'paskamer-woocommerce' ), (string) wp_parse_url( ( new Api_Client( $s ) )->base(), PHP_URL_HOST ) ) ); ?>
			<a href="https://paskamer.app/privacy" target="_blank" rel="noopener"><?php esc_html_e( 'Privacy policy', 'paskamer-woocommerce' ); ?></a> · <a href="https://paskamer.app/terms" target="_blank" rel="noopener"><?php esc_html_e( 'Terms', 'paskamer-woocommerce' ); ?></a></p>
		</div>
		<?php
	}
}
