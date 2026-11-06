<?php
/**
 * Settings storage + the WooCommerce → Curtain settings page (Connect round-trip, manual key,
 * status, storefront button options incl. the shopper experience (standalone by default), ads toggle,
 * uninstall cleanup). D6: no telemetry before the
 * merchant clicks Connect; the secret key is stored encrypted (Secret_Store).
 *
 * @package Curtain
 */

declare(strict_types=1);

namespace Curtain;

defined('ABSPATH') || defined('CURTAIN_TESTING') || exit;

final class Settings {

	public const OPTION = 'curtain_settings';
	public const PAGE   = 'curtain';

	private const ENCRYPTED = array( 'api_key', 'connect_token' );

	/** Standalone (docs/STANDALONE.md, D11): the fit experience opens on the product page, no app needed. */
	public const MODE_EMBED = 'embed';
	/** Opt-in: the old flow that opens the Curtain app (deep link on phones, QR code on desktops). */
	public const MODE_APP = 'app';
	public const MODES    = array( self::MODE_EMBED, self::MODE_APP );

	public const DEFAULT_SIZE_ATTRIBUTE = 'pa_size';

	/** @return array<string,mixed> */
	public static function defaults(): array {
		return array(
			'api_base'            => CURTAIN_DEFAULT_API_BASE,
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
			'connect_verify_nonce' => '',
			'ads_enabled'         => false,
			'button_enabled'      => true,
			'button_priority'     => 35,
			'button_label'        => '',
			'button_scope'        => 'active',
			'mode'                => self::MODE_EMBED,
			'size_attribute'      => self::DEFAULT_SIZE_ATTRIBUTE,
			'show_size'           => true,
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

	/**
	 * The Connect redirect may only go to Stripe Checkout (carry-over #15): https, host exactly
	 * `checkout.stripe.com`, default port, no credentials. Anything else is refused.
	 */
	public static function is_stripe_checkout_url( string $url ): bool {
		if ( '' === $url || strlen( $url ) > 2048 || 1 === preg_match( '/[\x00-\x20\\\\]/', $url ) ) {
			return false;
		}
		$p = wp_parse_url( $url );
		if ( ! is_array( $p ) ) {
			return false;
		}
		return 'https' === strtolower( (string) ( $p['scheme'] ?? '' ) )
			&& 'checkout.stripe.com' === strtolower( (string) ( $p['host'] ?? '' ) )
			&& ! isset( $p['port'] ) && ! isset( $p['user'] ) && ! isset( $p['pass'] )
			&& str_starts_with( (string) ( $p['path'] ?? '' ), '/' );
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
		return 'nl' === self::effective_locale() ? 'Try it on' : __( 'Try it on', 'curtain-woocommerce' );
	}

	/** Shopper experience for the SDK's data-mode: 'embed' (default, standalone) or 'app'. Unknown values fall back to 'embed'. */
	public static function sanitize_mode( $raw ): string {
		$raw = is_string( $raw ) ? strtolower( trim( $raw ) ) : '';
		return in_array( $raw, self::MODES, true ) ? $raw : self::MODE_EMBED;
	}

	/**
	 * Product attribute that holds the size: a global attribute taxonomy (`pa_size`, `pa_maat`) or a
	 * custom attribute slug (`size`). Lower-case letters, digits, `_` and `-`, at most 32 characters
	 * (WooCommerce's own limit for `pa_` taxonomies). Anything else falls back to `pa_size`.
	 */
	public static function sanitize_size_attribute( $raw ): string {
		$raw = is_string( $raw ) ? strtolower( trim( $raw ) ) : '';
		if ( '' === $raw || 1 !== preg_match( '/^[a-z0-9][a-z0-9_-]{0,31}$/', $raw ) ) {
			return self::DEFAULT_SIZE_ATTRIBUTE;
		}
		return $raw;
	}

	public static function mode(): string {
		return self::sanitize_mode( self::get( 'mode' ) );
	}

	/**
	 * The size peek (packages/sdk/README.md "Size peek"): a returning shopper sees their size and figure
	 * in a small iframe next to the button. On by default; never in app mode (no overlay there).
	 */
	public static function show_size(): bool {
		return (bool) self::get( 'show_size' ) && self::MODE_EMBED === self::mode();
	}

	/**
	 * The fitting room's origin for the SDK's data-app: the API origin with `api.` replaced by
	 * `app.` (docs/DEPLOY.md fixes both names). Empty when the API host does not start with `api.`;
	 * the SDK then shows no size peek.
	 */
	public static function app_origin(): string {
		$p = wp_parse_url( Api_Client::from_settings()->base() );
		if ( ! is_array( $p ) || ! in_array( $p['scheme'] ?? '', array( 'https', 'http' ), true ) ) {
			return '';
		}
		$host = strtolower( (string) ( $p['host'] ?? '' ) );
		if ( ! str_starts_with( $host, 'api.' ) ) {
			return '';
		}
		return $p['scheme'] . '://app.' . substr( $host, 4 ) . ( isset( $p['port'] ) ? ':' . (int) $p['port'] : '' );
	}

	public static function size_attribute(): string {
		return self::sanitize_size_attribute( self::get( 'size_attribute' ) );
	}

	/**
	 * Choices for the size attribute dropdown: every global product attribute (`pa_<name>` => label),
	 * plus `pa_size` and the stored value so the current setting is always selectable.
	 *
	 * @return array<string,string>
	 */
	public static function size_attribute_choices(): array {
		$out = array();
		if ( function_exists( 'wc_get_attribute_taxonomies' ) ) {
			foreach ( (array) wc_get_attribute_taxonomies() as $tax ) {
				$name = is_object( $tax ) ? (string) ( $tax->attribute_name ?? '' ) : ( is_array( $tax ) ? (string) ( $tax['attribute_name'] ?? '' ) : '' );
				if ( '' === $name ) {
					continue;
				}
				$label = is_object( $tax ) ? (string) ( $tax->attribute_label ?? '' ) : (string) ( $tax['attribute_label'] ?? '' );
				$slug  = self::sanitize_size_attribute( 'pa_' . $name );
				$out[ $slug ] = ( '' !== $label ? $label : $name ) . ' (' . $slug . ')';
			}
		}
		if ( ! isset( $out[ self::DEFAULT_SIZE_ATTRIBUTE ] ) ) {
			$out = array( self::DEFAULT_SIZE_ATTRIBUTE => __( 'Size', 'curtain-woocommerce' ) . ' (' . self::DEFAULT_SIZE_ATTRIBUTE . ')' ) + $out;
		}
		$current = self::size_attribute();
		if ( ! isset( $out[ $current ] ) ) {
			$out[ $current ] = $current;
		}
		return $out;
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
		add_action( 'admin_post_curtain_save', array( self::class, 'handle_save' ) );
		add_action( 'admin_post_curtain_connect', array( self::class, 'handle_connect' ) );
		add_action( 'admin_post_curtain_complete', array( self::class, 'handle_complete' ) );
		add_action( 'admin_post_curtain_manual_key', array( self::class, 'handle_manual_key' ) );
		add_action( 'admin_post_curtain_disconnect', array( self::class, 'handle_disconnect' ) );
		add_action( 'admin_post_curtain_status', array( self::class, 'handle_status' ) );
		add_action( 'admin_post_curtain_sync_all', array( self::class, 'handle_sync_all' ) );
		add_action( 'admin_notices', array( self::class, 'notices' ) );
	}

	public static function menu(): void {
		$hook = add_submenu_page(
			'woocommerce',
			__( 'Curtain', 'curtain-woocommerce' ),
			__( 'Curtain', 'curtain-woocommerce' ),
			'manage_woocommerce',
			self::PAGE,
			array( self::class, 'render' )
		);
		if ( is_string( $hook ) && '' !== $hook ) {
			// Runs before the admin header is printed, so finish_connect() can still redirect.
			add_action( 'load-' . $hook, array( self::class, 'maybe_finish_connect' ) );
		}
	}

	/** Back from Stripe Checkout (`?curtain=connected`): finish automatically when a Connect token is pending. */
	public static function maybe_finish_connect(): void {
		if ( ! current_user_can( 'manage_woocommerce' ) ) {
			return;
		}
		if ( isset( $_GET['curtain'] ) && 'connected' === $_GET['curtain'] && '' !== (string) self::get( 'connect_token' ) ) { // phpcs:ignore WordPress.Security.NonceVerification.Recommended -- idempotent token exchange with a server-stored token.
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
			wp_die( esc_html__( 'You are not allowed to manage Curtain settings.', 'curtain-woocommerce' ), 403 );
		}
		check_admin_referer( $action );
	}

	private static function redirect( string $notice, string $type = 'success' ): void {
		set_transient( 'curtain_notice_' . get_current_user_id(), array( 'type' => $type, 'text' => $notice ), 60 );
		wp_safe_redirect( self::page_url() );
		exit;
	}

	public static function notices(): void {
		$screen = function_exists( 'get_current_screen' ) ? get_current_screen() : null;
		if ( ! $screen || 'woocommerce_page_' . self::PAGE !== $screen->id ) {
			return;
		}
		$notice = get_transient( 'curtain_notice_' . get_current_user_id() );
		if ( is_array( $notice ) ) {
			delete_transient( 'curtain_notice_' . get_current_user_id() );
			printf( '<div class="notice notice-%s is-dismissible"><p>%s</p></div>', esc_attr( (string) $notice['type'] ), esc_html( (string) $notice['text'] ) );
		}
		if ( 'plain' === Secret_Store::scheme() ) {
			echo '<div class="notice notice-warning"><p>' . esc_html__( 'Neither libsodium nor OpenSSL is available on this server, so the Curtain API key is stored unencrypted in the database. Ask your host to enable the sodium extension.', 'curtain-woocommerce' ) . '</p></div>';
		}
	}

	// ---- handlers --------------------------------------------------------------------------

	public static function handle_save(): void {
		self::guard( 'curtain_save' );
		$in = isset( $_POST['curtain'] ) && is_array( $_POST['curtain'] ) ? wp_unslash( $_POST['curtain'] ) : array(); // phpcs:ignore WordPress.Security.ValidatedSanitizedInput -- sanitised field by field below.

		$api_base = self::sanitize_api_base( (string) ( $in['api_base'] ?? '' ) );
		$priority = absint( $in['button_priority'] ?? 35 );
		$label    = sanitize_text_field( (string) ( $in['button_label'] ?? '' ) );
		$locale   = in_array( $in['locale'] ?? 'auto', array( 'auto', 'en', 'nl' ), true ) ? (string) $in['locale'] : 'auto';
		$scope    = in_array( $in['button_scope'] ?? 'active', array( 'active', 'all' ), true ) ? (string) $in['button_scope'] : 'active';
		$ads      = ! empty( $in['ads_enabled'] );
		$mode     = self::sanitize_mode( $in['mode'] ?? self::MODE_EMBED );
		$size_att = self::sanitize_size_attribute( $in['size_attribute'] ?? self::DEFAULT_SIZE_ATTRIBUTE );

		self::update(
			array(
				'api_base'            => '' === $api_base ? CURTAIN_DEFAULT_API_BASE : $api_base,
				'button_enabled'      => ! empty( $in['button_enabled'] ),
				'button_priority'     => $priority > 0 ? $priority : 35,
				'button_label'        => mb_substr( $label, 0, 60 ),
				'button_scope'        => $scope,
				'mode'                => $mode,
				'size_attribute'      => $size_att,
				'show_size'           => ! empty( $in['show_size'] ),
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
		self::redirect( __( 'Settings saved.', 'curtain-woocommerce' ) );
	}

	/** Step 1: create the shop on our backend, then go to Stripe Checkout (or finish immediately). */
	public static function handle_connect(): void {
		self::guard( 'curtain_connect' );
		$s      = self::all();
		$client = new Api_Client( $s );
		$email  = ! empty( $s['share_admin_email'] ) ? (string) get_option( 'admin_email' ) : null;
		$res    = $client->connect( home_url( '/' ), (string) get_bloginfo( 'name' ), $email, self::page_url() );
		if ( ! $res['ok'] ) {
			if ( 'already_connected' === $res['error_code'] ) {
				self::redirect( __( 'This site is already connected to Curtain. Paste the API key from your Curtain console below, or rotate it there first.', 'curtain-woocommerce' ), 'warning' );
			}
			self::redirect( sprintf( /* translators: %s: error message */ __( 'Could not connect: %s', 'curtain-woocommerce' ), (string) $res['error_message'] ), 'error' );
		}
		$data = $res['data'] ?? array();
		self::update(
			array(
				'connect_token'   => (string) ( $data['connectToken'] ?? '' ),
				'connect_shop_id' => (string) ( $data['shopId'] ?? '' ),
				'connect_mode'    => (string) ( $data['mode'] ?? '' ),
				// Every Connect path (manual key and Stripe): published at /wp-json/curtain/v1/verify
				// until Connect finishes, so the API can check that this site asked for the keys (Rest).
				'connect_verify_nonce' => (string) ( $data['verification']['nonce'] ?? '' ),
			)
		);
		if ( 'stripe' === ( $data['mode'] ?? '' ) ) {
			$checkout = (string) ( $data['checkoutUrl'] ?? '' );
			// Only ever leave the admin for Stripe Checkout itself, whatever the API answered.
			if ( ! self::is_stripe_checkout_url( $checkout ) ) {
				self::redirect( __( 'Could not connect: the payment page address was not a Stripe Checkout page.', 'curtain-woocommerce' ), 'error' );
			}
			wp_redirect( esc_url_raw( $checkout ) ); // phpcs:ignore WordPress.Security.SafeRedirect -- external URL, restricted to https://checkout.stripe.com/ above.
			exit;
		}
		self::finish_connect();
	}

	/** Step 2 (manual retry button after Checkout). */
	public static function handle_complete(): void {
		self::guard( 'curtain_complete' );
		self::finish_connect();
	}

	/** Exchange the stored Connect token for the merchant keys, then say hello. */
	public static function finish_connect(): void {
		$s     = self::all();
		$token = (string) $s['connect_token'];
		if ( '' === $token ) {
			self::redirect( __( 'No pending connection. Click Connect to start.', 'curtain-woocommerce' ), 'warning' );
		}
		$res = ( new Api_Client( $s ) )->complete( $token );
		if ( ! $res['ok'] ) {
			if ( 'payment_pending' === $res['error_code'] ) {
				self::redirect( __( 'Checkout has not completed yet. Finish the payment, then click "Finish connection".', 'curtain-woocommerce' ), 'warning' );
			}
			if ( 'domain_unverified' === $res['error_code'] ) {
				self::redirect( __( 'Curtain could not confirm that this site asked for the connection. Make sure the site is reachable from the internet (not a local or private address) and that no security plugin blocks /wp-json/curtain/v1/verify, then click "Finish connection".', 'curtain-woocommerce' ), 'warning' );
			}
			self::redirect( sprintf( /* translators: %s: error message */ __( 'Could not finish the connection: %s', 'curtain-woocommerce' ), (string) $res['error_message'] ), 'error' );
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
				'connect_verify_nonce' => '',
				'last_error'        => '',
			)
		);
		self::hello();
		Sync::enqueue_sync_all();
		self::redirect( __( 'Connected to Curtain. Your published products are being synced in the background.', 'curtain-woocommerce' ) );
	}

	/** Paste a key issued by the Curtain console (sk_live_…): the hello returns its pk_ prefix. */
	public static function handle_manual_key(): void {
		self::guard( 'curtain_manual_key' );
		$key = isset( $_POST['curtain_api_key'] ) ? sanitize_text_field( wp_unslash( $_POST['curtain_api_key'] ) ) : '';
		if ( ! Hmac::is_secret_key( $key ) ) {
			self::redirect( __( 'That does not look like a Curtain secret key (sk_live_… or sk_test_…).', 'curtain-woocommerce' ), 'error' );
		}
		$res = ( new Api_Client( self::all() ) )->hello( self::hello_body(), 'bearer', $key );
		if ( ! $res['ok'] ) {
			self::redirect( sprintf( /* translators: %s: error message */ __( 'The key was rejected: %s', 'curtain-woocommerce' ), (string) $res['error_message'] ), 'error' );
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
		self::redirect( __( 'Key accepted. Your published products are being synced in the background.', 'curtain-woocommerce' ) );
	}

	public static function handle_disconnect(): void {
		self::guard( 'curtain_disconnect' );
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
				'connect_verify_nonce' => '',
			)
		);
		self::redirect( __( 'Disconnected. The button is no longer shown and nothing is sent to Curtain. Your garment data stays in WooCommerce.', 'curtain-woocommerce' ) );
	}

	public static function handle_status(): void {
		self::guard( 'curtain_status' );
		$res = self::hello();
		if ( $res['ok'] ) {
			self::redirect( __( 'Status refreshed.', 'curtain-woocommerce' ) );
		}
		self::redirect( sprintf( /* translators: %s: error message */ __( 'Status check failed: %s', 'curtain-woocommerce' ), (string) $res['error_message'] ), 'error' );
	}

	public static function handle_sync_all(): void {
		self::guard( 'curtain_sync_all' );
		if ( ! self::is_connected() ) {
			self::redirect( __( 'Connect the shop first.', 'curtain-woocommerce' ), 'warning' );
		}
		Sync::enqueue_sync_all();
		self::redirect( __( 'Full sync queued. Products are pushed in the background.', 'curtain-woocommerce' ) );
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
			'pluginVersion'   => CURTAIN_VERSION,
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
		<div class="wrap curtain-settings">
			<h1><?php esc_html_e( 'Curtain for WooCommerce', 'curtain-woocommerce' ); ?></h1>
			<p class="description"><?php esc_html_e( 'Curtain is a private fitting room: shoppers find their size right on your product page, no app needed. Their measurements stay in their own browser. Only garment data (size charts, fabric, photos) leaves this site, never customer data.', 'curtain-woocommerce' ); ?></p>

			<h2><?php esc_html_e( 'Connection', 'curtain-woocommerce' ); ?></h2>
			<table class="form-table" role="presentation">
				<tr>
					<th scope="row"><?php esc_html_e( 'Status', 'curtain-woocommerce' ); ?></th>
					<td>
						<?php if ( $connected ) : ?>
							<strong style="color:#1a7f37">●</strong> <?php esc_html_e( 'Connected', 'curtain-woocommerce' ); ?>
							<?php if ( '' !== (string) $s['shop_name'] ) : ?> — <?php echo esc_html( (string) $s['shop_name'] ); ?><?php endif; ?>
							<br><code><?php echo esc_html( (string) $s['public_key_prefix'] ); ?></code>
							<?php if ( '' !== (string) $s['plan'] ) : ?> · <?php echo esc_html( sprintf( /* translators: %s: plan name */ __( 'plan: %s', 'curtain-woocommerce' ), (string) $s['plan'] ) ); ?><?php endif; ?>
							<?php if ( ! empty( $s['paused'] ) ) : ?> · <strong style="color:#b32d2e"><?php esc_html_e( 'paused (no active subscription: the button still renders, shoppers see a "shop paused" screen)', 'curtain-woocommerce' ); ?></strong><?php endif; ?>
							<br><span class="description">
								<?php echo esc_html( sprintf( /* translators: 1: key storage scheme, 2: queue backend */ __( 'Key stored with %1$s · job queue: %2$s', 'curtain-woocommerce' ), Secret_Store::scheme(), Queue::backend() ) ); ?>
								<?php $pending_jobs = Queue::pending_count(); ?>
								<?php if ( null !== $pending_jobs ) : ?> · <?php echo esc_html( sprintf( /* translators: %d: number of jobs */ _n( '%d pending job', '%d pending jobs', $pending_jobs, 'curtain-woocommerce' ), $pending_jobs ) ); ?><?php endif; ?>
								<?php if ( ! empty( $s['last_sync_at'] ) ) : ?> · <?php echo esc_html( sprintf( /* translators: %s: date */ __( 'last sync %s', 'curtain-woocommerce' ), wp_date( 'Y-m-d H:i', (int) $s['last_sync_at'] ) ) ); ?><?php endif; ?>
							</span>
							<?php if ( '' !== (string) $s['last_error'] ) : ?><br><span style="color:#b32d2e"><?php echo esc_html( sprintf( /* translators: %s: error message */ __( 'Last error: %s', 'curtain-woocommerce' ), (string) $s['last_error'] ) ); ?></span><?php endif; ?>
						<?php elseif ( $pending ) : ?>
							<strong style="color:#b26b00">●</strong> <?php esc_html_e( 'Waiting for checkout to complete.', 'curtain-woocommerce' ); ?>
						<?php else : ?>
							<strong style="color:#8c8f94">●</strong> <?php esc_html_e( 'Not connected — nothing is sent to Curtain.', 'curtain-woocommerce' ); ?>
						<?php endif; ?>
					</td>
				</tr>
				<tr>
					<th scope="row"><?php esc_html_e( 'Actions', 'curtain-woocommerce' ); ?></th>
					<td>
						<?php if ( $connected ) : ?>
							<form method="post" action="<?php echo esc_url( admin_url( 'admin-post.php' ) ); ?>" style="display:inline"><?php wp_nonce_field( 'curtain_status' ); ?><input type="hidden" name="action" value="curtain_status"><button class="button"><?php esc_html_e( 'Check status', 'curtain-woocommerce' ); ?></button></form>
							<form method="post" action="<?php echo esc_url( admin_url( 'admin-post.php' ) ); ?>" style="display:inline"><?php wp_nonce_field( 'curtain_sync_all' ); ?><input type="hidden" name="action" value="curtain_sync_all"><button class="button"><?php esc_html_e( 'Sync all products', 'curtain-woocommerce' ); ?></button></form>
							<form method="post" action="<?php echo esc_url( admin_url( 'admin-post.php' ) ); ?>" style="display:inline" onsubmit="return confirm('<?php echo esc_js( __( 'Disconnect this shop from Curtain?', 'curtain-woocommerce' ) ); ?>')"><?php wp_nonce_field( 'curtain_disconnect' ); ?><input type="hidden" name="action" value="curtain_disconnect"><button class="button button-link-delete"><?php esc_html_e( 'Disconnect', 'curtain-woocommerce' ); ?></button></form>
						<?php else : ?>
							<form method="post" action="<?php echo esc_url( admin_url( 'admin-post.php' ) ); ?>" style="display:inline"><?php wp_nonce_field( 'curtain_connect' ); ?><input type="hidden" name="action" value="curtain_connect"><button class="button button-primary"><?php esc_html_e( 'Connect to Curtain', 'curtain-woocommerce' ); ?></button></form>
							<?php if ( $pending ) : ?>
								<form method="post" action="<?php echo esc_url( admin_url( 'admin-post.php' ) ); ?>" style="display:inline"><?php wp_nonce_field( 'curtain_complete' ); ?><input type="hidden" name="action" value="curtain_complete"><button class="button"><?php esc_html_e( 'Finish connection', 'curtain-woocommerce' ); ?></button></form>
							<?php endif; ?>
							<p class="description"><?php esc_html_e( 'Connect sends your site URL and shop name to Curtain, creates your merchant account and (when billing is enabled) takes you to Stripe Checkout. You will be sent back here afterwards.', 'curtain-woocommerce' ); ?></p>
						<?php endif; ?>
					</td>
				</tr>
				<?php if ( ! $connected ) : ?>
				<tr>
					<th scope="row"><label for="curtain_api_key"><?php esc_html_e( 'Or paste an API key', 'curtain-woocommerce' ); ?></label></th>
					<td>
						<form method="post" action="<?php echo esc_url( admin_url( 'admin-post.php' ) ); ?>"><?php wp_nonce_field( 'curtain_manual_key' ); ?><input type="hidden" name="action" value="curtain_manual_key">
							<input type="password" id="curtain_api_key" name="curtain_api_key" class="regular-text" autocomplete="off" placeholder="sk_live_…">
							<button class="button"><?php esc_html_e( 'Use key', 'curtain-woocommerce' ); ?></button>
							<p class="description"><?php esc_html_e( 'Secret key from your Curtain merchant console. It is stored encrypted and never shown again.', 'curtain-woocommerce' ); ?></p>
						</form>
					</td>
				</tr>
				<?php endif; ?>
			</table>

			<form method="post" action="<?php echo esc_url( admin_url( 'admin-post.php' ) ); ?>">
				<?php wp_nonce_field( 'curtain_save' ); ?>
				<input type="hidden" name="action" value="curtain_save">
				<h2><?php esc_html_e( 'Storefront button', 'curtain-woocommerce' ); ?></h2>
				<table class="form-table" role="presentation">
					<tr>
						<th scope="row"><?php esc_html_e( 'Show button', 'curtain-woocommerce' ); ?></th>
						<td><label><input type="checkbox" name="curtain[button_enabled]" value="1" <?php checked( ! empty( $s['button_enabled'] ) ); ?>> <?php esc_html_e( 'Add a "Try it on" button to single product pages (bundled script, no third-party requests).', 'curtain-woocommerce' ); ?></label>
						<p class="description"><?php esc_html_e( 'You can also place it yourself with the [curtain_button] shortcode.', 'curtain-woocommerce' ); ?></p></td>
					</tr>
					<tr>
						<th scope="row"><label for="curtain_mode"><?php esc_html_e( 'Experience', 'curtain-woocommerce' ); ?></label></th>
						<td><select id="curtain_mode" name="curtain[mode]">
							<option value="embed" <?php selected( self::mode(), self::MODE_EMBED ); ?>><?php esc_html_e( 'On the product page (no app needed)', 'curtain-woocommerce' ); ?></option>
							<option value="app" <?php selected( self::mode(), self::MODE_APP ); ?>><?php esc_html_e( 'Curtain app', 'curtain-woocommerce' ); ?></option>
						</select>
						<p class="description"><?php esc_html_e( 'On the product page: shoppers get their recommended size in an overlay on your product page and Curtain selects it in the size dropdown. Curtain app: phones open the Curtain app, desktops show a QR code.', 'curtain-woocommerce' ); ?></p></td>
					</tr>
					<tr>
						<th scope="row"><label for="curtain_size_attribute"><?php esc_html_e( 'Size attribute', 'curtain-woocommerce' ); ?></label></th>
						<td><select id="curtain_size_attribute" name="curtain[size_attribute]">
							<?php foreach ( self::size_attribute_choices() as $slug => $label ) : ?>
								<option value="<?php echo esc_attr( $slug ); ?>" <?php selected( self::size_attribute(), $slug ); ?>><?php echo esc_html( $label ); ?></option>
							<?php endforeach; ?>
						</select>
						<p class="description"><?php esc_html_e( 'The product attribute that holds the size in your variation dropdowns. Curtain selects the recommended size in it.', 'curtain-woocommerce' ); ?></p></td>
					</tr>
					<tr>
						<th scope="row"><?php esc_html_e( 'Shopper\'s size', 'curtain-woocommerce' ); ?></th>
						<td><label><input type="checkbox" name="curtain[show_size]" value="1" <?php checked( ! empty( $s['show_size'] ) ); ?>> <?php esc_html_e( 'Show the shopper\'s size on product pages', 'curtain-woocommerce' ); ?></label>
						<p class="description"><?php esc_html_e( 'A shopper who found their size here before sees it next to the button, with a small drawing of their figure in that size, without clicking. Only the shopper sees it: your store cannot read it. Not shown with the Curtain app experience.', 'curtain-woocommerce' ); ?></p></td>
					</tr>
					<tr>
						<th scope="row"><label for="curtain_button_scope"><?php esc_html_e( 'Show for', 'curtain-woocommerce' ); ?></label></th>
						<td><select id="curtain_button_scope" name="curtain[button_scope]">
							<option value="active" <?php selected( $s['button_scope'], 'active' ); ?>><?php esc_html_e( 'Products synced as complete ("active") only', 'curtain-woocommerce' ); ?></option>
							<option value="all" <?php selected( $s['button_scope'], 'all' ); ?>><?php esc_html_e( 'All published products', 'curtain-woocommerce' ); ?></option>
						</select></td>
					</tr>
					<tr>
						<th scope="row"><label for="curtain_button_priority"><?php esc_html_e( 'Position', 'curtain-woocommerce' ); ?></label></th>
						<td><input type="number" id="curtain_button_priority" name="curtain[button_priority]" min="1" max="100" value="<?php echo esc_attr( (string) $s['button_priority'] ); ?>" class="small-text">
						<p class="description"><?php esc_html_e( 'woocommerce_single_product_summary priority: 35 = after the add-to-cart form, 25 = before it, 15 = after the price.', 'curtain-woocommerce' ); ?></p></td>
					</tr>
					<tr>
						<th scope="row"><label for="curtain_button_label"><?php esc_html_e( 'Label', 'curtain-woocommerce' ); ?></label></th>
						<td><input type="text" id="curtain_button_label" name="curtain[button_label]" value="<?php echo esc_attr( (string) $s['button_label'] ); ?>" class="regular-text" placeholder="<?php echo esc_attr( self::button_label() ); ?>"></td>
					</tr>
					<tr>
						<th scope="row"><label for="curtain_locale"><?php esc_html_e( 'Language', 'curtain-woocommerce' ); ?></label></th>
						<td><select id="curtain_locale" name="curtain[locale]">
							<option value="auto" <?php selected( $s['locale'], 'auto' ); ?>><?php esc_html_e( 'Follow the site language', 'curtain-woocommerce' ); ?></option>
							<option value="en" <?php selected( $s['locale'], 'en' ); ?>>English</option>
							<option value="nl" <?php selected( $s['locale'], 'nl' ); ?>>Nederlands</option>
						</select></td>
					</tr>
				</table>

				<h2><?php esc_html_e( 'Catalogue', 'curtain-woocommerce' ); ?></h2>
				<table class="form-table" role="presentation">
					<tr>
						<th scope="row"><label for="curtain_default_brand"><?php esc_html_e( 'Default brand', 'curtain-woocommerce' ); ?></label></th>
						<td><input type="text" id="curtain_default_brand" name="curtain[default_brand]" value="<?php echo esc_attr( (string) $s['default_brand'] ); ?>" class="regular-text" placeholder="<?php echo esc_attr( (string) get_bloginfo( 'name' ) ); ?>">
						<p class="description"><?php esc_html_e( 'Used when a product has no brand (Curtain field, Brands taxonomy or a "Brand" attribute).', 'curtain-woocommerce' ); ?></p></td>
					</tr>
					<tr>
						<th scope="row"><?php esc_html_e( 'Sponsored placement', 'curtain-woocommerce' ); ?></th>
						<td><label><input type="checkbox" name="curtain[ads_enabled]" value="1" <?php checked( ! empty( $s['ads_enabled'] ) ); ?>> <?php esc_html_e( 'Allow my products to appear as sponsored cards in the Curtain swipe deck (billed per plan).', 'curtain-woocommerce' ); ?></label></td>
					</tr>
				</table>

				<h2><?php esc_html_e( 'Advanced', 'curtain-woocommerce' ); ?></h2>
				<table class="form-table" role="presentation">
					<tr>
						<th scope="row"><label for="curtain_api_base"><?php esc_html_e( 'API base URL', 'curtain-woocommerce' ); ?></label></th>
						<td><input type="url" id="curtain_api_base" name="curtain[api_base]" value="<?php echo esc_attr( (string) $s['api_base'] ); ?>" class="regular-text" placeholder="<?php echo esc_attr( CURTAIN_DEFAULT_API_BASE ); ?>">
						<p class="description"><?php esc_html_e( 'Only change this for a staging environment.', 'curtain-woocommerce' ); ?></p></td>
					</tr>
					<tr>
						<th scope="row"><?php esc_html_e( 'Admin e-mail', 'curtain-woocommerce' ); ?></th>
						<td><label><input type="checkbox" name="curtain[share_admin_email]" value="1" <?php checked( ! empty( $s['share_admin_email'] ) ); ?>> <?php esc_html_e( 'Send the site admin e-mail with Connect so Curtain can reach you about billing (optional).', 'curtain-woocommerce' ); ?></label></td>
					</tr>
					<tr>
						<th scope="row"><?php esc_html_e( 'Uninstall', 'curtain-woocommerce' ); ?></th>
						<td><label><input type="checkbox" name="curtain[delete_on_uninstall]" value="1" <?php checked( ! empty( $s['delete_on_uninstall'] ) ); ?>> <?php esc_html_e( 'Delete all Curtain settings and product fit data when the plugin is uninstalled.', 'curtain-woocommerce' ); ?></label></td>
					</tr>
				</table>
				<?php submit_button( __( 'Save settings', 'curtain-woocommerce' ) ); ?>
			</form>

			<h2><?php esc_html_e( 'What is sent to Curtain', 'curtain-woocommerce' ); ?></h2>
			<p><?php echo esc_html( sprintf( /* translators: %s: API host */ __( 'After you connect, published products (name, price in EUR, product photos, categories, attributes) and the fit data from the Curtain box on the product page are sent to %s. Nothing about your customers or orders is ever sent. Disconnect at any time.', 'curtain-woocommerce' ), (string) wp_parse_url( ( new Api_Client( $s ) )->base(), PHP_URL_HOST ) ) ); ?>
			<a href="https://curtain.fit/privacy" target="_blank" rel="noopener"><?php esc_html_e( 'Privacy policy', 'curtain-woocommerce' ); ?></a> · <a href="https://curtain.fit/terms" target="_blank" rel="noopener"><?php esc_html_e( 'Terms', 'curtain-woocommerce' ); ?></a></p>
		</div>
		<?php
	}
}
