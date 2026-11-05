<?php
/**
 * Minimal WordPress / WooCommerce function shims so the plugin classes run under plain `php`.
 * Options, post meta, cron and HTTP are in-memory and inspectable through the Paskamer_Test_State
 * registry. Only what the tests exercise is implemented — this is not a WordPress emulator.
 *
 * @package Paskamer\Tests
 */

declare(strict_types=1);

define( 'PASKAMER_TESTING', true );
define( 'PASKAMER_VERSION', '0.1.0' );
define( 'PASKAMER_PLUGIN_FILE', dirname( __DIR__ ) . '/paskamer.php' );
define( 'PASKAMER_PLUGIN_DIR', dirname( __DIR__ ) . '/' );
define( 'PASKAMER_PLUGIN_URL', 'https://shop.example/wp-content/plugins/paskamer-woocommerce/' );
define( 'PASKAMER_DEFAULT_API_BASE', 'https://api.paskamer.app' );
define( 'AUTH_KEY', 'test-auth-key-0123456789' );
define( 'SECURE_AUTH_KEY', 'test-secure-auth-key-9876543210' );
define( 'WC_VERSION', '9.9.0' );

final class Paskamer_Test_State {
	/** @var array<string,mixed> */
	public static array $options = array();
	/** @var array<int, array<string, mixed>> */
	public static array $meta = array();
	/** @var array<int, array{ts:int,hook:string,args:array}> */
	public static array $cron = array();
	/** @var array<int, array{url:string,args:array}> */
	public static array $requests = array();
	/** @var callable|null */
	public static $http_handler = null;
	/** @var array<string, array<int, callable>> */
	public static array $actions = array();
	/** @var array<int, array{status:string,type:string,parent:int}> */
	public static array $posts = array();

	public static function reset(): void {
		self::$options      = array();
		self::$meta         = array();
		self::$cron         = array();
		self::$requests     = array();
		self::$http_handler = null;
		self::$actions      = array();
		self::$posts        = array();
	}
}

// ---- i18n / escaping ------------------------------------------------------------------------
function __( string $text, string $domain = 'default' ): string { return $text; }
function _e( string $text, string $domain = 'default' ): void { echo $text; }
function _n( string $single, string $plural, int $number, string $domain = 'default' ): string { return 1 === $number ? $single : $plural; }
function esc_html__( string $text, string $domain = 'default' ): string { return htmlspecialchars( $text, ENT_QUOTES, 'UTF-8' ); }
function esc_attr__( string $text, string $domain = 'default' ): string { return htmlspecialchars( $text, ENT_QUOTES, 'UTF-8' ); }
function esc_html_e( string $text, string $domain = 'default' ): void { echo htmlspecialchars( $text, ENT_QUOTES, 'UTF-8' ); }
function esc_attr_e( string $text, string $domain = 'default' ): void { echo htmlspecialchars( $text, ENT_QUOTES, 'UTF-8' ); }
function esc_html( $text ): string { return htmlspecialchars( (string) $text, ENT_QUOTES, 'UTF-8' ); }
function esc_attr( $text ): string { return htmlspecialchars( (string) $text, ENT_QUOTES, 'UTF-8' ); }
function esc_textarea( $text ): string { return htmlspecialchars( (string) $text, ENT_QUOTES, 'UTF-8' ); }
function esc_url( $url ): string { return (string) $url; }
function esc_url_raw( $url ): string { return (string) $url; }
function wp_parse_url( string $url, int $component = -1 ) { return parse_url( $url, $component ); }
function esc_js( $text ): string { return addslashes( (string) $text ); }
function wp_kses_post( $text ): string { return (string) $text; }

// ---- sanitisation ---------------------------------------------------------------------------
function sanitize_text_field( $str ): string {
	$str = (string) $str;
	$str = strip_tags( $str );
	$str = preg_replace( '/[\r\n\t ]+/', ' ', $str );
	return trim( (string) $str );
}
function sanitize_textarea_field( $str ): string {
	return trim( strip_tags( (string) $str ) );
}
function sanitize_key( $key ): string { return (string) preg_replace( '/[^a-z0-9_\-]/', '', strtolower( (string) $key ) ); }
function absint( $n ): int { return abs( (int) $n ); }
// Like WordPress (stripslashes_deep / addslashes via map_deep): only strings are touched.
function wp_unslash( $v ) { return is_array( $v ) ? array_map( 'wp_unslash', $v ) : ( is_string( $v ) ? stripslashes( $v ) : $v ); }
function wp_slash( $v ) { return is_array( $v ) ? array_map( 'wp_slash', $v ) : ( is_string( $v ) ? addslashes( $v ) : $v ); }
function wp_json_encode( $data, int $flags = 0, int $depth = 512 ) { return json_encode( $data, $flags, $depth ); }
function wp_parse_args( $args, $defaults = array() ) { return array_merge( (array) $defaults, (array) $args ); }
function maybe_unserialize( $data ) {
	if ( is_string( $data ) && preg_match( '/^[aOs]:\d+:/', $data ) ) {
		$u = @unserialize( $data );
		return false === $u ? $data : $u;
	}
	return $data;
}

// ---- options / meta -------------------------------------------------------------------------
function get_option( string $name, $default = false ) { return Paskamer_Test_State::$options[ $name ] ?? $default; }
function update_option( string $name, $value, $autoload = null ): bool { Paskamer_Test_State::$options[ $name ] = $value; return true; }
function add_option( string $name, $value = '', $d = '', $autoload = 'yes' ): bool { if ( isset( Paskamer_Test_State::$options[ $name ] ) ) { return false; } Paskamer_Test_State::$options[ $name ] = $value; return true; }
function delete_option( string $name ): bool { unset( Paskamer_Test_State::$options[ $name ] ); return true; }
function set_transient( string $k, $v, int $ttl = 0 ): bool { Paskamer_Test_State::$options[ '_transient_' . $k ] = $v; return true; }
function get_transient( string $k ) { return Paskamer_Test_State::$options[ '_transient_' . $k ] ?? false; }
function delete_transient( string $k ): bool { unset( Paskamer_Test_State::$options[ '_transient_' . $k ] ); return true; }

function get_post_meta( int $post_id, string $key = '', bool $single = false ) {
	$all = Paskamer_Test_State::$meta[ $post_id ] ?? array();
	if ( '' === $key ) {
		$out = array();
		foreach ( $all as $k => $v ) { $out[ $k ] = array( $v ); }
		return $out;
	}
	if ( ! array_key_exists( $key, $all ) ) { return $single ? '' : array(); }
	return $single ? $all[ $key ] : array( $all[ $key ] );
}
// WordPress' update_metadata() runs wp_unslash() on the value: callers must wp_slash() anything
// that may contain a backslash (JSON!). The shim does the same so the tests catch it.
function update_post_meta( int $post_id, string $key, $value ) { Paskamer_Test_State::$meta[ $post_id ][ $key ] = wp_unslash( $value ); return true; }
function delete_post_meta( int $post_id, string $key ): bool { unset( Paskamer_Test_State::$meta[ $post_id ][ $key ] ); return true; }

// ---- posts ----------------------------------------------------------------------------------
function get_post_status( int $id ) { return Paskamer_Test_State::$posts[ $id ]['status'] ?? false; }
function get_post_type( int $id ) { return Paskamer_Test_State::$posts[ $id ]['type'] ?? false; }
function get_post( int $id ) { return isset( Paskamer_Test_State::$posts[ $id ] ) ? (object) array( 'ID' => $id ) : null; }
function wp_get_post_parent_id( int $id ): int { return (int) ( Paskamer_Test_State::$posts[ $id ]['parent'] ?? 0 ); }
function get_permalink( int $id ): string { return 'https://shop.example/product/p' . $id . '/'; }
function wp_get_attachment_url( int $id ) { return $id > 0 ? 'https://shop.example/wp-content/uploads/att-' . $id . '.jpg' : false; }
function get_the_terms( int $id, string $tax ) { return array(); }
function taxonomy_exists( string $tax ): bool { return false; }
function get_term( $id, $tax ) { return null; }

// ---- site -----------------------------------------------------------------------------------
function home_url( string $path = '' ): string { return 'https://shop.example' . $path; }
function admin_url( string $path = '' ): string { return 'https://shop.example/wp-admin/' . $path; }
function add_query_arg( array $args, string $url ): string { return $url . ( str_contains( $url, '?' ) ? '&' : '?' ) . http_build_query( $args ); }
function get_bloginfo( string $show = '' ): string { return 'name' === $show ? 'Fixture Shop' : ( 'version' === $show ? '6.7.1' : '' ); }
function get_locale(): string { return 'nl_NL'; }
function get_woocommerce_currency(): string { return Paskamer_Test_State::$options['_currency'] ?? 'EUR'; }
function wc_attribute_label( string $name, $product = null ): string { return $name; }
function current_user_can( string $cap, ...$args ): bool { return true; }
function wp_verify_nonce( $nonce, $action = -1 ) { return 'valid-' . $action === $nonce ? 1 : false; }
function wp_is_post_revision( $post ) { return false; }
function add_submenu_page( string $parent, string $page_title, string $menu_title, string $cap, string $slug, $cb = null ) { Paskamer_Test_State::$actions[ 'submenu:' . $slug ][] = $cb; return $parent . '_page_' . $slug; }
function get_current_user_id(): int { return 1; }
function wp_date( string $format, int $ts ): string { return gmdate( $format, $ts ); }

// ---- hooks (recorded, never run) --------------------------------------------------------------
function add_action( string $hook, $cb, int $prio = 10, int $args = 1 ): void { Paskamer_Test_State::$actions[ $hook ][] = $cb; }
function add_filter( string $hook, $cb, int $prio = 10, int $args = 1 ): void { Paskamer_Test_State::$actions[ $hook ][] = $cb; }
function add_shortcode( string $tag, $cb ): void { Paskamer_Test_State::$actions[ 'shortcode:' . $tag ][] = $cb; }
function apply_filters( string $hook, $value, ...$args ) { return $value; }
function do_action( string $hook, ...$args ): void {}

// ---- cron -----------------------------------------------------------------------------------
function wp_schedule_single_event( int $ts, string $hook, array $args = array() ) { Paskamer_Test_State::$cron[] = array( 'ts' => $ts, 'hook' => $hook, 'args' => $args ); return true; }
function wp_next_scheduled( string $hook, array $args = array() ) {
	foreach ( Paskamer_Test_State::$cron as $job ) { if ( $job['hook'] === $hook && $job['args'] === $args ) { return $job['ts']; } }
	return false;
}
function wp_clear_scheduled_hook( string $hook, array $args = array() ): void {
	Paskamer_Test_State::$cron = array_values( array_filter( Paskamer_Test_State::$cron, static fn( $j ) => $j['hook'] !== $hook ) );
}

// ---- HTTP -----------------------------------------------------------------------------------
class WP_Error {
	public function __construct( private string $code = '', private string $message = '', private $data = null ) {}
	public function get_error_code(): string { return $this->code; }
	public function get_error_message(): string { return $this->message; }
	public function get_error_data() { return $this->data; }
}
function is_wp_error( $thing ): bool { return $thing instanceof WP_Error; }
function wp_remote_request( string $url, array $args = array() ) {
	Paskamer_Test_State::$requests[] = array( 'url' => $url, 'args' => $args );
	$handler = Paskamer_Test_State::$http_handler;
	if ( null === $handler ) { return new WP_Error( 'http_request_failed', 'no handler' ); }
	return $handler( $url, $args );
}
function wp_remote_retrieve_response_code( $response ) { return is_array( $response ) ? ( $response['response']['code'] ?? 0 ) : 0; }
function wp_remote_retrieve_body( $response ) { return is_array( $response ) ? (string) ( $response['body'] ?? '' ) : ''; }
/** Helper for tests: build a wp_remote_* response array. */
function paskamer_http_response( int $code, $body ) {
	return array( 'response' => array( 'code' => $code ), 'body' => is_string( $body ) ? $body : json_encode( $body ) );
}

// ---- WooCommerce product stub -----------------------------------------------------------------
class WC_Product {
	/** @param array<string,mixed> $d */
	public function __construct( private array $d ) {}
	public function get_id(): int { return (int) $this->d['id']; }
	public function get_name(): string { return (string) ( $this->d['name'] ?? '' ); }
	public function get_slug(): string { return (string) ( $this->d['slug'] ?? '' ); }
	public function get_type(): string { return (string) ( $this->d['type'] ?? 'simple' ); }
	public function get_status(): string { return (string) ( $this->d['status'] ?? 'publish' ); }
	public function get_sku(): string { return (string) ( $this->d['sku'] ?? '' ); }
	public function get_price(): string { return (string) ( $this->d['price'] ?? '' ); }
	public function get_regular_price(): string { return (string) ( $this->d['regular_price'] ?? '' ); }
	public function get_image_id(): int { return (int) ( $this->d['image_id'] ?? 0 ); }
	public function get_gallery_image_ids(): array { return $this->d['gallery'] ?? array(); }
	public function get_attributes(): array { return array(); }
}
function wc_get_product( $id ) {
	$id = (int) $id;
	return isset( Paskamer_Test_State::$posts[ $id ]['product'] ) ? Paskamer_Test_State::$posts[ $id ]['product'] : false;
}
function wc_get_products( array $args ) { return Paskamer_Test_State::$options['_product_ids'] ?? array(); }
