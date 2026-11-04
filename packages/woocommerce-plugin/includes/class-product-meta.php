<?php
/**
 * Product edit meta box: every GarmentPayload §3.1 field, saved as `_paskamer_*` post meta,
 * validated locally against the bundled JSON Schema (assets/garment-draft.schema.json from
 * @paskamer/schema) and — when connected — dry-run validated by POST /v1/merchant/products/validate
 * so the merchant sees the completeness score and the missing fields right after saving.
 *
 * @package Paskamer
 */

declare(strict_types=1);

namespace Paskamer;

defined('ABSPATH') || defined('PASKAMER_TESTING') || exit;

final class Product_Meta {

	public const NONCE = 'paskamer_meta';

	public static function register(): void {
		add_action( 'add_meta_boxes_product', array( self::class, 'add_box' ) );
		add_action( 'woocommerce_process_product_meta', array( self::class, 'save' ), 20 );
		add_action( 'admin_enqueue_scripts', array( self::class, 'assets' ) );
		add_filter( 'manage_product_posts_columns', array( self::class, 'column' ) );
		add_action( 'manage_product_posts_custom_column', array( self::class, 'column_value' ), 10, 2 );
	}

	public static function add_box(): void {
		add_meta_box(
			'paskamer-garment',
			__( 'Paskamer — fit data', 'paskamer-woocommerce' ),
			array( self::class, 'render' ),
			'product',
			'normal',
			'high'
		);
	}

	public static function assets( string $hook ): void {
		if ( ! in_array( $hook, array( 'post.php', 'post-new.php' ), true ) ) {
			return;
		}
		$screen = get_current_screen();
		if ( ! $screen || 'product' !== $screen->post_type ) {
			return;
		}
		wp_enqueue_media();
		wp_enqueue_style( 'paskamer-admin', PASKAMER_PLUGIN_URL . 'assets/admin/meta-box.css', array(), PASKAMER_VERSION );
		wp_enqueue_script( 'paskamer-admin', PASKAMER_PLUGIN_URL . 'assets/admin/meta-box.js', array( 'jquery' ), PASKAMER_VERSION, true );
		wp_localize_script(
			'paskamer-admin',
			'paskamerAdmin',
			array(
				'chooseFlatLay' => __( 'Choose flat-lay photo', 'paskamer-woocommerce' ),
				'useImage'      => __( 'Use this image', 'paskamer-woocommerce' ),
				'sizeColumns'   => Vocab::SIZE_ROW_COLUMNS,
			)
		);
	}

	// ---- list column ----------------------------------------------------------------------

	/** @param array<string,string> $columns @return array<string,string> */
	public static function column( array $columns ): array {
		$columns['paskamer'] = __( 'Paskamer', 'paskamer-woocommerce' );
		return $columns;
	}

	public static function column_value( string $column, int $post_id ): void {
		if ( 'paskamer' !== $column ) {
			return;
		}
		$status = (string) get_post_meta( $post_id, Vocab::META_SYNC_STATUS, true );
		if ( '' === $status ) {
			echo '<span class="paskamer-badge paskamer-badge--none">—</span>';
			return;
		}
		$score = get_post_meta( $post_id, Vocab::META_SCORE, true );
		printf(
			'<span class="paskamer-badge paskamer-badge--%s" title="%s">%s%s</span>',
			esc_attr( $status ),
			esc_attr( (string) get_post_meta( $post_id, Vocab::META_SYNC_ERROR, true ) ),
			esc_html( self::status_label( $status ) ),
			'' !== (string) $score && is_numeric( $score ) ? esc_html( ' ' . round( (float) $score * 100 ) . '%' ) : ''
		);
	}

	public static function status_label( string $status ): string {
		switch ( $status ) {
			case 'active':
				return __( 'Active', 'paskamer-woocommerce' );
			case 'incomplete':
				return __( 'Incomplete', 'paskamer-woocommerce' );
			case 'pending':
			case 'retrying':
				return __( 'Syncing…', 'paskamer-woocommerce' );
			case 'archived':
			case 'archiving':
				return __( 'Archived', 'paskamer-woocommerce' );
			case 'error':
				return __( 'Sync error', 'paskamer-woocommerce' );
			default:
				return ucfirst( $status );
		}
	}

	// ---- save ------------------------------------------------------------------------------

	public static function save( $post_id ): void {
		$post_id = (int) $post_id;
		if ( ! isset( $_POST[ self::NONCE ] ) || ! wp_verify_nonce( sanitize_text_field( wp_unslash( $_POST[ self::NONCE ] ) ), self::NONCE ) ) {
			return;
		}
		if ( ( defined( 'DOING_AUTOSAVE' ) && DOING_AUTOSAVE ) || wp_is_post_revision( $post_id ) || ! current_user_can( 'edit_post', $post_id ) ) {
			return;
		}
		$in = isset( $_POST['paskamer'] ) && is_array( $_POST['paskamer'] ) ? wp_unslash( $_POST['paskamer'] ) : array(); // phpcs:ignore WordPress.Security.ValidatedSanitizedInput -- sanitised by Sanitizer::from_post().

		$flat_id = absint( $in['flat_lay_id'] ?? 0 );
		if ( $flat_id > 0 ) {
			$url = wp_get_attachment_url( $flat_id );
			if ( is_string( $url ) && '' !== $url ) {
				$in['flat_lay_url'] = $url;
			} else {
				$in['flat_lay_id'] = 0;
				unset( $in['flat_lay_url'] );
			}
		} else {
			unset( $in['flat_lay_url'] );
		}

		$result = Sanitizer::from_post( $in );
		foreach ( $result['meta'] as $key => $value ) {
			if ( null === $value ) {
				delete_post_meta( $post_id, $key );
			} else {
				update_post_meta( $post_id, $key, $value );
			}
		}

		self::validate_and_store( $post_id, $result['errors'] );
	}

	/**
	 * Local schema validation + (when connected) the backend dry run; stores both for the panel.
	 *
	 * @param string[] $sanitizer_errors
	 */
	public static function validate_and_store( int $post_id, array $sanitizer_errors = array() ): void {
		$product = wc_get_product( $post_id );
		if ( ! $product instanceof \WC_Product ) {
			return;
		}
		$built   = Sync::build( $product );
		$payload = $built['payload'];

		$issues = array();
		foreach ( $sanitizer_errors as $field ) {
			$issues[] = array(
				'path'    => $field,
				'message' => __( 'invalid value was ignored', 'paskamer-woocommerce' ),
			);
		}
		foreach ( $built['warnings'] as $w ) {
			$issues[] = array(
				'path'    => $w['path'],
				'message' => $w['message'],
			);
		}
		$validator = self::draft_validator();
		if ( null !== $validator ) {
			foreach ( $validator->validate( $payload ) as $issue ) {
				$issues[] = $issue;
			}
		}
		update_post_meta(
			$post_id,
			Vocab::META_LOCAL_ISSUES,
			wp_json_encode(
				array(
					'issues'       => $issues,
					'missingHeavy' => Payload_Builder::missing_heavy_fields( $payload ),
					'checkedAt'    => gmdate( 'c' ),
				)
			)
		);

		if ( ! Settings::is_connected() ) {
			return;
		}
		$res = Api_Client::from_settings()->validate_product( $payload );
		if ( $res['ok'] && is_array( $res['data'] ) ) {
			update_post_meta( $post_id, Vocab::META_VALIDATION, wp_json_encode( $res['data'] ) );
		}
		if ( 'publish' === $product->get_status() ) {
			Sync::enqueue_push( $post_id );
		}
	}

	private static function draft_validator(): ?Schema_Validator {
		static $validator = null;
		static $tried     = false;
		if ( $tried ) {
			return $validator;
		}
		$tried = true;
		$file  = PASKAMER_PLUGIN_DIR . 'assets/garment-draft.schema.json';
		if ( is_readable( $file ) ) {
			try {
				$validator = Schema_Validator::from_file( $file );
			} catch ( \RuntimeException $e ) {
				$validator = null;
			}
		}
		return $validator;
	}

	// ---- render ----------------------------------------------------------------------------

	public static function render( \WP_Post $post ): void {
		$id   = (int) $post->ID;
		$meta = Product_Snapshot::meta( $id );
		$get  = static function ( string $key ) use ( $meta ) {
			return $meta[ Vocab::META_PREFIX . $key ] ?? '';
		};
		$json = static function ( string $key ) use ( $get ) {
			$v = Payload_Builder::parse_jsonish( $get( $key ) );
			return is_array( $v ) ? $v : array();
		};

		$fabric    = $json( 'fabric' );
		$ease      = $json( 'ease' );
		$lengths   = $json( 'length_cm' );
		$chart     = $json( 'size_chart' );
		$critical  = $json( 'critical_fit_points' );
		$zones     = $json( 'stretch_zones' );
		$tags      = $json( 'style_tags' );
		$colorways = $json( 'colorways' );
		$block     = (string) $get( 'pattern_block' );
		$custom    = '' !== $block && ! in_array( $block, Vocab::PATTERN_BLOCKS, true );
		$flat_id   = (int) $get( 'flat_lay_photo_id' );
		$flat_url  = (string) $get( 'flat_lay_photo' );
		$custom_lengths = array_diff_key( $lengths, array_flip( Vocab::LENGTH_KEYS ) );
		$other_zones    = array_values( array_diff( array_map( 'strval', $zones ), Vocab::STRETCH_ZONES ) );

		wp_nonce_field( self::NONCE, self::NONCE );
		self::render_status( $id );
		?>
		<div class="paskamer-box">
			<p class="description"><?php esc_html_e( 'Everything here describes the garment, never a customer. Measurements in cm. Fields marked * are needed before the product is "active" in Paskamer.', 'paskamer-woocommerce' ); ?></p>

			<h4><?php esc_html_e( 'Classification', 'paskamer-woocommerce' ); ?></h4>
			<div class="paskamer-grid">
				<label><span><?php esc_html_e( 'Category *', 'paskamer-woocommerce' ); ?></span>
					<select name="paskamer[category]">
						<option value=""><?php esc_html_e( 'Infer from product categories', 'paskamer-woocommerce' ); ?></option>
						<?php foreach ( Vocab::CATEGORIES as $c ) : ?>
							<option value="<?php echo esc_attr( $c ); ?>" <?php selected( $get( 'category' ), $c ); ?>><?php echo esc_html( $c ); ?></option>
						<?php endforeach; ?>
					</select></label>
				<label><span><?php esc_html_e( 'Subcategory', 'paskamer-woocommerce' ); ?></span><input type="text" name="paskamer[subcategory]" value="<?php echo esc_attr( (string) $get( 'subcategory' ) ); ?>" placeholder="wrap-midi" maxlength="64"></label>
				<label><span><?php esc_html_e( 'Brand', 'paskamer-woocommerce' ); ?></span><input type="text" name="paskamer[brand]" value="<?php echo esc_attr( (string) $get( 'brand' ) ); ?>" placeholder="<?php echo esc_attr( (string) ( Settings::get( 'default_brand' ) ?: get_bloginfo( 'name' ) ) ); ?>" maxlength="120"></label>
				<label><span><?php esc_html_e( 'Pattern block', 'paskamer-woocommerce' ); ?></span>
					<select name="paskamer[pattern_block]" class="paskamer-pattern-block">
						<option value=""><?php esc_html_e( '— none —', 'paskamer-woocommerce' ); ?></option>
						<?php foreach ( Vocab::PATTERN_BLOCKS as $b ) : ?>
							<option value="<?php echo esc_attr( $b ); ?>" <?php selected( $block, $b ); ?>><?php echo esc_html( $b ); ?></option>
						<?php endforeach; ?>
						<option value="<?php echo esc_attr( Sanitizer::CUSTOM_PATTERN_BLOCK ); ?>" <?php selected( $custom ); ?>><?php esc_html_e( 'Other…', 'paskamer-woocommerce' ); ?></option>
					</select>
					<input type="text" name="paskamer[pattern_block_custom]" class="paskamer-pattern-block-custom" value="<?php echo esc_attr( $custom ? $block : '' ); ?>" placeholder="<?php esc_attr_e( 'custom block name', 'paskamer-woocommerce' ); ?>" maxlength="64" <?php echo $custom ? '' : 'style="display:none"'; ?>></label>
			</div>

			<h4><?php esc_html_e( 'Flat-lay photo *', 'paskamer-woocommerce' ); ?></h4>
			<div class="paskamer-flatlay">
				<input type="hidden" name="paskamer[flat_lay_id]" class="paskamer-flatlay-id" value="<?php echo esc_attr( (string) $flat_id ); ?>">
				<div class="paskamer-flatlay-preview"><?php if ( '' !== $flat_url ) : ?><img src="<?php echo esc_url( $flat_url ); ?>" alt=""><?php endif; ?></div>
				<button type="button" class="button paskamer-flatlay-pick"><?php esc_html_e( 'Choose from media library', 'paskamer-woocommerce' ); ?></button>
				<button type="button" class="button-link-delete paskamer-flatlay-remove" <?php echo '' === $flat_url ? 'style="display:none"' : ''; ?>><?php esc_html_e( 'Remove', 'paskamer-woocommerce' ); ?></button>
				<p class="description"><?php esc_html_e( 'The garment laid flat on a white background, front view. This is what shoppers see draped on their own silhouette (labelled as an estimate).', 'paskamer-woocommerce' ); ?></p>
			</div>

			<h4><?php esc_html_e( 'Fabric *', 'paskamer-woocommerce' ); ?></h4>
			<div class="paskamer-grid">
				<label><span><?php esc_html_e( 'Primary fibre *', 'paskamer-woocommerce' ); ?></span><input type="text" list="paskamer-fibres" name="paskamer[fabric_primary]" value="<?php echo esc_attr( (string) ( $fabric['primary'] ?? '' ) ); ?>" maxlength="64">
					<datalist id="paskamer-fibres"><?php foreach ( Vocab::FABRIC_PRIMARIES as $f ) : ?><option value="<?php echo esc_attr( $f ); ?>"></option><?php endforeach; ?></datalist></label>
				<label><span><?php esc_html_e( 'Weight (g/m²)', 'paskamer-woocommerce' ); ?></span><input type="number" name="paskamer[fabric_weight_gsm]" value="<?php echo esc_attr( self::num( $fabric['weightGsm'] ?? '' ) ); ?>" min="1" max="2000" step="1"></label>
				<label><span><?php esc_html_e( 'Stretch % *', 'paskamer-woocommerce' ); ?></span><input type="number" name="paskamer[fabric_stretch_pct]" value="<?php echo esc_attr( self::num( $fabric['stretchPct'] ?? '' ) ); ?>" min="0" max="100" step="1" placeholder="0 = none, 30 = jersey"></label>
				<label><span><?php esc_html_e( 'Drape (0 stiff – 1 fluid) *', 'paskamer-woocommerce' ); ?></span><input type="number" name="paskamer[fabric_drape]" value="<?php echo esc_attr( self::num( $fabric['drape'] ?? '' ) ); ?>" min="0" max="1" step="0.05" list="paskamer-drape">
					<datalist id="paskamer-drape"><?php foreach ( Vocab::drape_presets() as $v => $label ) : ?><option value="<?php echo esc_attr( $v ); ?>" label="<?php echo esc_attr( $label ); ?>"></option><?php endforeach; ?></datalist></label>
				<label><span><?php esc_html_e( 'Opacity (0 sheer – 1 opaque)', 'paskamer-woocommerce' ); ?></span><input type="number" name="paskamer[fabric_opacity]" value="<?php echo esc_attr( self::num( $fabric['opacity'] ?? '' ) ); ?>" min="0" max="1" step="0.05"></label>
				<label><span><?php esc_html_e( 'Sheen (0 matte – 1 shiny)', 'paskamer-woocommerce' ); ?></span><input type="number" name="paskamer[fabric_sheen]" value="<?php echo esc_attr( self::num( $fabric['sheen'] ?? '' ) ); ?>" min="0" max="1" step="0.05"></label>
			</div>
			<table class="paskamer-table paskamer-repeater" data-repeater="fabric_blend">
				<thead><tr><th><?php esc_html_e( 'Blend fibre', 'paskamer-woocommerce' ); ?></th><th>%</th><th></th></tr></thead>
				<tbody>
					<?php
					$blend = is_array( $fabric['blend'] ?? null ) ? $fabric['blend'] : array();
					foreach ( array_merge( $blend, array( array( '', '' ) ) ) as $i => $row ) :
						?>
						<tr><td><input type="text" name="paskamer[fabric_blend][<?php echo (int) $i; ?>][fibre]" value="<?php echo esc_attr( (string) ( $row[0] ?? '' ) ); ?>" list="paskamer-fibres" maxlength="64"></td>
							<td><input type="number" name="paskamer[fabric_blend][<?php echo (int) $i; ?>][pct]" value="<?php echo esc_attr( self::num( $row[1] ?? '' ) ); ?>" min="0" max="100" step="1" class="paskamer-narrow"></td>
							<td><button type="button" class="button-link paskamer-row-remove" aria-label="<?php esc_attr_e( 'Remove row', 'paskamer-woocommerce' ); ?>">×</button></td></tr>
					<?php endforeach; ?>
				</tbody>
				<tfoot><tr><td colspan="3"><button type="button" class="button paskamer-row-add"><?php esc_html_e( 'Add fibre', 'paskamer-woocommerce' ); ?></button></td></tr></tfoot>
			</table>

			<h4><?php esc_html_e( 'Size chart *', 'paskamer-woocommerce' ); ?></h4>
			<p class="paskamer-radios">
				<strong><?php esc_html_e( 'The numbers below are *', 'paskamer-woocommerce' ); ?></strong>
				<label><input type="radio" name="paskamer[size_chart_type]" value="garment" <?php checked( $get( 'size_chart_type' ), 'garment' ); ?>> <?php esc_html_e( 'garment measurements (measured flat)', 'paskamer-woocommerce' ); ?></label>
				<label><input type="radio" name="paskamer[size_chart_type]" value="body" <?php checked( $get( 'size_chart_type' ), 'body' ); ?>> <?php esc_html_e( 'body measurements (the body each size is cut for)', 'paskamer-woocommerce' ); ?></label>
			</p>
			<table class="paskamer-table paskamer-repeater" data-repeater="size_chart">
				<thead><tr>
					<?php foreach ( Vocab::SIZE_ROW_COLUMNS as $col ) : ?><th><?php echo esc_html( self::column_label( $col ) ); ?></th><?php endforeach; ?><th></th>
				</tr></thead>
				<tbody>
					<?php
					$rows = array_values( array_filter( $chart, 'is_array' ) );
					$rows[] = array();
					foreach ( $rows as $i => $row ) :
						?>
						<tr>
							<?php foreach ( Vocab::SIZE_ROW_COLUMNS as $col ) : ?>
								<td><?php if ( 'size' === $col ) : ?>
									<input type="text" name="paskamer[size_chart][<?php echo (int) $i; ?>][size]" value="<?php echo esc_attr( (string) ( $row['size'] ?? '' ) ); ?>" maxlength="16" class="paskamer-narrow" placeholder="S">
								<?php else : ?>
									<input type="number" name="paskamer[size_chart][<?php echo (int) $i; ?>][<?php echo esc_attr( $col ); ?>]" value="<?php echo esc_attr( self::num( $row[ $col ] ?? '' ) ); ?>" min="0" max="300" step="0.5" class="paskamer-narrow">
								<?php endif; ?></td>
							<?php endforeach; ?>
							<td><button type="button" class="button-link paskamer-row-remove" aria-label="<?php esc_attr_e( 'Remove row', 'paskamer-woocommerce' ); ?>">×</button></td>
						</tr>
					<?php endforeach; ?>
				</tbody>
				<tfoot><tr><td colspan="<?php echo count( Vocab::SIZE_ROW_COLUMNS ) + 1; ?>"><button type="button" class="button paskamer-row-add"><?php esc_html_e( 'Add size', 'paskamer-woocommerce' ); ?></button> <span class="description"><?php esc_html_e( 'Ascending order. Leave a cell empty (or 0) when the shop does not publish that measurement.', 'paskamer-woocommerce' ); ?></span></td></tr></tfoot>
			</table>

			<h4><?php esc_html_e( 'Designed ease (garment minus body, cm)', 'paskamer-woocommerce' ); ?></h4>
			<div class="paskamer-inline">
				<?php foreach ( Vocab::FIT_POINTS as $p ) : ?>
					<label><span><?php echo esc_html( $p ); ?></span><input type="number" name="paskamer[ease][<?php echo esc_attr( $p ); ?>]" value="<?php echo esc_attr( self::num( $ease[ $p ] ?? '' ) ); ?>" min="-20" max="60" step="0.5" class="paskamer-narrow"></label>
				<?php endforeach; ?>
			</div>

			<h4><?php esc_html_e( 'Lengths (cm)', 'paskamer-woocommerce' ); ?></h4>
			<div class="paskamer-inline">
				<?php foreach ( Vocab::LENGTH_KEYS as $k ) : ?>
					<label><span><?php echo esc_html( str_replace( '_', ' ', $k ) ); ?></span><input type="number" name="paskamer[length][<?php echo esc_attr( $k ); ?>]" value="<?php echo esc_attr( self::num( $lengths[ $k ] ?? '' ) ); ?>" min="0" max="400" step="0.5" class="paskamer-narrow"></label>
				<?php endforeach; ?>
			</div>
			<table class="paskamer-table paskamer-repeater" data-repeater="length_custom">
				<thead><tr><th><?php esc_html_e( 'Other length (key)', 'paskamer-woocommerce' ); ?></th><th>cm</th><th></th></tr></thead>
				<tbody>
					<?php
					$custom_rows = array();
					foreach ( $custom_lengths as $k => $v ) {
						$custom_rows[] = array( (string) $k, $v );
					}
					$custom_rows[] = array( '', '' );
					foreach ( $custom_rows as $i => $row ) :
						?>
						<tr><td><input type="text" name="paskamer[length_custom][<?php echo (int) $i; ?>][key]" value="<?php echo esc_attr( $row[0] ); ?>" placeholder="hem_circumference" maxlength="64"></td>
							<td><input type="number" name="paskamer[length_custom][<?php echo (int) $i; ?>][value]" value="<?php echo esc_attr( self::num( $row[1] ) ); ?>" min="0" max="400" step="0.5" class="paskamer-narrow"></td>
							<td><button type="button" class="button-link paskamer-row-remove" aria-label="<?php esc_attr_e( 'Remove row', 'paskamer-woocommerce' ); ?>">×</button></td></tr>
					<?php endforeach; ?>
				</tbody>
				<tfoot><tr><td colspan="3"><button type="button" class="button paskamer-row-add"><?php esc_html_e( 'Add length', 'paskamer-woocommerce' ); ?></button></td></tr></tfoot>
			</table>

			<h4><?php esc_html_e( 'Fit notes', 'paskamer-woocommerce' ); ?></h4>
			<div class="paskamer-grid">
				<label class="paskamer-span2"><span><?php esc_html_e( 'Sizing notes', 'paskamer-woocommerce' ); ?></span><textarea name="paskamer[sizing_notes]" rows="2" maxlength="500" placeholder="<?php esc_attr_e( "e.g. 'runs small', 'size up if between sizes'", 'paskamer-woocommerce' ); ?>"><?php echo esc_textarea( (string) $get( 'sizing_notes' ) ); ?></textarea></label>
				<label><span><?php esc_html_e( 'True-to-size score (0–1)', 'paskamer-woocommerce' ); ?></span><input type="number" name="paskamer[true_to_size_score]" value="<?php echo esc_attr( self::num( $get( 'true_to_size_score' ) ) ); ?>" min="0" max="1" step="0.01" placeholder="0.8"></label>
			</div>
			<div class="paskamer-grid">
				<fieldset><legend><?php esc_html_e( 'Critical fit points', 'paskamer-woocommerce' ); ?></legend>
					<?php foreach ( Vocab::FIT_POINTS as $p ) : ?>
						<label class="paskamer-check"><input type="checkbox" name="paskamer[critical_fit_points][]" value="<?php echo esc_attr( $p ); ?>" <?php checked( in_array( $p, $critical, true ) ); ?>> <?php echo esc_html( $p ); ?></label>
					<?php endforeach; ?>
				</fieldset>
				<fieldset><legend><?php esc_html_e( 'Stretch zones', 'paskamer-woocommerce' ); ?></legend>
					<?php foreach ( Vocab::STRETCH_ZONES as $z ) : ?>
						<label class="paskamer-check"><input type="checkbox" name="paskamer[stretch_zones][]" value="<?php echo esc_attr( $z ); ?>" <?php checked( in_array( $z, $zones, true ) ); ?>> <?php echo esc_html( $z ); ?></label>
					<?php endforeach; ?>
					<input type="text" name="paskamer[stretch_zones_other]" value="<?php echo esc_attr( implode( ', ', $other_zones ) ); ?>" placeholder="<?php esc_attr_e( 'other zones, comma separated', 'paskamer-woocommerce' ); ?>" maxlength="400">
				</fieldset>
			</div>

			<h4><?php esc_html_e( 'Style tags (0–1 per axis, optional)', 'paskamer-woocommerce' ); ?></h4>
			<div class="paskamer-inline">
				<?php foreach ( Vocab::TASTE_AXES as $axis ) : ?>
					<label><span><?php echo esc_html( $axis ); ?></span><input type="number" name="paskamer[style_tags][<?php echo esc_attr( $axis ); ?>]" value="<?php echo esc_attr( self::num( $tags[ $axis ] ?? '' ) ); ?>" min="0" max="1" step="0.1" class="paskamer-narrow"></label>
				<?php endforeach; ?>
			</div>

			<h4><?php esc_html_e( 'Colours', 'paskamer-woocommerce' ); ?></h4>
			<div class="paskamer-grid">
				<label><span><?php esc_html_e( 'Primary colour (#RRGGBB)', 'paskamer-woocommerce' ); ?></span>
					<span class="paskamer-colour"><input type="text" name="paskamer[primary_color_hex]" class="paskamer-hex" value="<?php echo esc_attr( (string) $get( 'primary_color_hex' ) ); ?>" pattern="#?[0-9a-fA-F]{3}([0-9a-fA-F]{3})?" placeholder="#C97A4F" maxlength="7"><input type="color" class="paskamer-swatch" value="<?php echo esc_attr( Payload_Builder::coerce_hex( $get( 'primary_color_hex' ) ) ?? '#ffffff' ); ?>" aria-hidden="true" tabindex="-1"></span></label>
			</div>
			<table class="paskamer-table paskamer-repeater" data-repeater="colorways">
				<thead><tr><th><?php esc_html_e( 'Colorway name', 'paskamer-woocommerce' ); ?></th><th>#hex</th><th>SKU</th><th></th></tr></thead>
				<tbody>
					<?php
					$cw_rows   = array_values( array_filter( $colorways, 'is_array' ) );
					$cw_rows[] = array();
					foreach ( $cw_rows as $i => $row ) :
						?>
						<tr><td><input type="text" name="paskamer[colorways][<?php echo (int) $i; ?>][name]" value="<?php echo esc_attr( (string) ( $row['name'] ?? '' ) ); ?>" maxlength="64"></td>
							<td><span class="paskamer-colour"><input type="text" name="paskamer[colorways][<?php echo (int) $i; ?>][hex]" class="paskamer-hex paskamer-narrow" value="<?php echo esc_attr( (string) ( $row['hex'] ?? '' ) ); ?>" maxlength="7"><input type="color" class="paskamer-swatch" value="<?php echo esc_attr( Payload_Builder::coerce_hex( $row['hex'] ?? '' ) ?? '#ffffff' ); ?>" aria-hidden="true" tabindex="-1"></span></td>
							<td><input type="text" name="paskamer[colorways][<?php echo (int) $i; ?>][sku]" value="<?php echo esc_attr( (string) ( $row['sku'] ?? '' ) ); ?>" maxlength="64"></td>
							<td><button type="button" class="button-link paskamer-row-remove" aria-label="<?php esc_attr_e( 'Remove row', 'paskamer-woocommerce' ); ?>">×</button></td></tr>
					<?php endforeach; ?>
				</tbody>
				<tfoot><tr><td colspan="4"><button type="button" class="button paskamer-row-add"><?php esc_html_e( 'Add colorway', 'paskamer-woocommerce' ); ?></button></td></tr></tfoot>
			</table>
		</div>
		<?php
	}

	/** Status panel: backend verdict (when connected) + local schema issues. */
	private static function render_status( int $id ): void {
		$status     = (string) get_post_meta( $id, Vocab::META_SYNC_STATUS, true );
		$error      = (string) get_post_meta( $id, Vocab::META_SYNC_ERROR, true );
		$synced_at  = (string) get_post_meta( $id, Vocab::META_SYNCED_AT, true );
		$validation = json_decode( (string) get_post_meta( $id, Vocab::META_VALIDATION, true ), true );
		$local      = json_decode( (string) get_post_meta( $id, Vocab::META_LOCAL_ISSUES, true ), true );
		$connected  = Settings::is_connected();
		?>
		<div class="paskamer-status paskamer-status--<?php echo esc_attr( '' === $status ? 'none' : $status ); ?>">
			<?php if ( ! $connected ) : ?>
				<p><strong><?php esc_html_e( 'Not connected to Paskamer.', 'paskamer-woocommerce' ); ?></strong> <?php esc_html_e( 'Fit data is saved here and synced once you connect.', 'paskamer-woocommerce' ); ?> <a href="<?php echo esc_url( Settings::page_url() ); ?>"><?php esc_html_e( 'Connect', 'paskamer-woocommerce' ); ?></a></p>
			<?php else : ?>
				<p><strong><?php esc_html_e( 'Paskamer status:', 'paskamer-woocommerce' ); ?></strong>
					<span class="paskamer-badge paskamer-badge--<?php echo esc_attr( '' === $status ? 'none' : $status ); ?>"><?php echo esc_html( '' === $status ? __( 'Not synced yet', 'paskamer-woocommerce' ) : self::status_label( $status ) ); ?></span>
					<?php if ( is_array( $validation ) && isset( $validation['completeness']['score'] ) ) : ?>
						· <?php echo esc_html( sprintf( /* translators: %d: percentage */ __( 'completeness %d%%', 'paskamer-woocommerce' ), (int) round( (float) $validation['completeness']['score'] * 100 ) ) ); ?>
					<?php endif; ?>
					<?php if ( '' !== $synced_at ) : ?> · <span class="description"><?php echo esc_html( sprintf( /* translators: %s: date */ __( 'synced %s', 'paskamer-woocommerce' ), $synced_at ) ); ?></span><?php endif; ?>
				</p>
				<?php if ( '' !== $error ) : ?><p class="paskamer-error"><?php echo esc_html( $error ); ?></p><?php endif; ?>
				<?php if ( is_array( $validation ) && ! empty( $validation['completeness']['missing'] ) ) : ?>
					<p><?php esc_html_e( 'Missing for a better fit:', 'paskamer-woocommerce' ); ?>
					<?php foreach ( (array) $validation['completeness']['missing'] as $m ) : ?>
						<code class="paskamer-missing paskamer-missing--<?php echo esc_attr( (string) ( $m['severity'] ?? 'light' ) ); ?>" title="<?php echo esc_attr( (string) ( $m['reason'] ?? '' ) ); ?>"><?php echo esc_html( (string) ( $m['field'] ?? '' ) ); ?></code>
					<?php endforeach; ?></p>
				<?php endif; ?>
			<?php endif; ?>
			<?php if ( is_array( $local ) && ( ! empty( $local['issues'] ) || ! empty( $local['missingHeavy'] ) ) ) : ?>
				<?php if ( ! empty( $local['missingHeavy'] ) ) : ?>
					<p><?php esc_html_e( 'Required before the product can be active:', 'paskamer-woocommerce' ); ?> <?php foreach ( (array) $local['missingHeavy'] as $f ) : ?><code><?php echo esc_html( (string) $f ); ?></code> <?php endforeach; ?></p>
				<?php endif; ?>
				<?php if ( ! empty( $local['issues'] ) ) : ?>
					<ul class="paskamer-issues">
						<?php foreach ( (array) $local['issues'] as $issue ) : ?>
							<li><code><?php echo esc_html( (string) ( $issue['path'] ?? '' ) ); ?></code> <?php echo esc_html( (string) ( $issue['message'] ?? '' ) ); ?></li>
						<?php endforeach; ?>
					</ul>
				<?php endif; ?>
			<?php endif; ?>
		</div>
		<?php
	}

	private static function column_label( string $col ): string {
		switch ( $col ) {
			case 'size':
				return __( 'Size', 'paskamer-woocommerce' );
			case 'footEu':
				return __( 'Foot EU', 'paskamer-woocommerce' );
			case 'footLengthCm':
				return __( 'Foot cm', 'paskamer-woocommerce' );
			default:
				return $col;
		}
	}

	/** Number for an input value: ints stay ints, empty stays empty. @param mixed $v */
	private static function num( $v ): string {
		if ( null === $v || '' === $v || is_array( $v ) ) {
			return '';
		}
		$n = Payload_Builder::coerce_number( $v );
		if ( null === $n ) {
			return '';
		}
		return floor( $n ) === $n ? (string) (int) $n : rtrim( rtrim( sprintf( '%.4F', $n ), '0' ), '.' );
	}
}
