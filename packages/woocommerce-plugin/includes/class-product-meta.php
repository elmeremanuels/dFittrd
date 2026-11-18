<?php
/**
 * Product edit meta box: every GarmentPayload §3.1 field, saved as `_curtain_*` post meta,
 * validated locally against the bundled JSON Schema (assets/garment-draft.schema.json from
 * @curtain/schema) and — when connected — dry-run validated by POST /v1/merchant/products/validate
 * so the merchant sees the completeness score and the missing fields right after saving.
 *
 * @package Curtain
 */

declare(strict_types=1);

namespace Curtain;

defined( 'ABSPATH' ) || exit;

final class Product_Meta {

	public const NONCE = 'curtain_meta';

	public static function register(): void {
		add_action( 'add_meta_boxes_product', array( self::class, 'add_box' ) );
		add_action( 'woocommerce_process_product_meta', array( self::class, 'save' ), 20 );
		add_action( 'admin_enqueue_scripts', array( self::class, 'assets' ) );
		add_filter( 'manage_product_posts_columns', array( self::class, 'column' ) );
		add_action( 'manage_product_posts_custom_column', array( self::class, 'column_value' ), 10, 2 );
	}

	public static function add_box(): void {
		add_meta_box(
			'curtain-garment',
			__( 'Curtain — fit data', 'curtain-woocommerce' ),
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
		wp_enqueue_style( 'curtain-admin', CURTAIN_PLUGIN_URL . 'assets/admin/meta-box.css', array(), CURTAIN_VERSION );
		wp_enqueue_script( 'curtain-admin', CURTAIN_PLUGIN_URL . 'assets/admin/meta-box.js', array( 'jquery' ), CURTAIN_VERSION, true );
		wp_localize_script(
			'curtain-admin',
			'curtainAdmin',
			array(
				'chooseFlatLay' => __( 'Choose flat-lay photo', 'curtain-woocommerce' ),
				'useImage'      => __( 'Use this image', 'curtain-woocommerce' ),
				'sizeColumns'   => Vocab::SIZE_ROW_COLUMNS,
				'templates'     => self::chart_templates(),
				'replaceChart'  => __( 'Replace the size chart below with this template?', 'curtain-woocommerce' ),
				'measureNote'   => __( 'Fill in the measurements of each finished size (cm, all round).', 'curtain-woocommerce' ),
			)
		);
	}

	/**
	 * The size chart templates from @curtain/schema (assets/chart-templates.json, written by the
	 * build): body charts with their numbers, garment charts with the labels and points to measure.
	 *
	 * @return array<int,array<string,mixed>>
	 */
	public static function chart_templates(): array {
		static $templates = null;
		if ( null !== $templates ) {
			return $templates;
		}
		$templates = array();
		$file      = CURTAIN_PLUGIN_DIR . 'assets/chart-templates.json';
		if ( ! is_readable( $file ) ) {
			return $templates;
		}
		$data = json_decode( (string) file_get_contents( $file ), true ); // phpcs:ignore WordPress.WP.AlternativeFunctions.file_get_contents_file_get_contents -- local plugin file.
		foreach ( (array) ( $data['templates'] ?? array() ) as $t ) {
			if ( ! is_array( $t ) || ! isset( $t['id'], $t['kind'], $t['label'], $t['sizes'] ) || ! in_array( $t['kind'], array( 'body', 'garment' ), true ) ) {
				continue;
			}
			$templates[] = $t;
		}
		return $templates;
	}

	// ---- list column ----------------------------------------------------------------------

	/** @param array<string,string> $columns @return array<string,string> */
	public static function column( array $columns ): array {
		$columns['curtain'] = __( 'Curtain', 'curtain-woocommerce' );
		return $columns;
	}

	public static function column_value( string $column, int $post_id ): void {
		if ( 'curtain' !== $column ) {
			return;
		}
		$status = (string) get_post_meta( $post_id, Vocab::META_SYNC_STATUS, true );
		if ( '' === $status ) {
			echo '<span class="curtain-badge curtain-badge--none">—</span>';
			return;
		}
		$score = get_post_meta( $post_id, Vocab::META_SCORE, true );
		printf(
			'<span class="curtain-badge curtain-badge--%s" title="%s">%s%s</span>',
			esc_attr( $status ),
			esc_attr( (string) get_post_meta( $post_id, Vocab::META_SYNC_ERROR, true ) ),
			esc_html( self::status_label( $status ) ),
			'' !== (string) $score && is_numeric( $score ) ? esc_html( ' ' . round( (float) $score * 100 ) . '%' ) : ''
		);
	}

	public static function status_label( string $status ): string {
		switch ( $status ) {
			case 'active':
				return __( 'Active', 'curtain-woocommerce' );
			case 'incomplete':
				return __( 'Incomplete', 'curtain-woocommerce' );
			case 'pending':
			case 'retrying':
				return __( 'Syncing…', 'curtain-woocommerce' );
			case 'archived':
			case 'archiving':
				return __( 'Archived', 'curtain-woocommerce' );
			case 'error':
				return __( 'Sync error', 'curtain-woocommerce' );
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
		$in = isset( $_POST['curtain'] ) && is_array( $_POST['curtain'] ) ? wp_unslash( $_POST['curtain'] ) : array(); // phpcs:ignore WordPress.Security.ValidatedSanitizedInput -- sanitised by Sanitizer::from_post().

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
				// update_post_meta() unslashes its value: without wp_slash() a backslash inside the
				// JSON (a size called 32" is stored as 32\") is stripped and the stored JSON is corrupt.
				update_post_meta( $post_id, $key, wp_slash( $value ) );
			}
		}

		if ( null !== $result['tape'] ) {
			self::store_tape_issues( $post_id, $result['tape'] );
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
				'message' => __( 'invalid value was ignored', 'curtain-woocommerce' ),
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
			wp_slash(
				(string) wp_json_encode(
					array(
						'issues'       => $issues,
						'missingHeavy' => Payload_Builder::missing_heavy_fields( $payload ),
						'checkedAt'    => gmdate( 'c' ),
					)
				)
			)
		);

		if ( ! Settings::is_connected() ) {
			return;
		}
		$res = Api_Client::from_settings()->validate_product( $payload );
		if ( $res['ok'] && is_array( $res['data'] ) ) {
			update_post_meta( $post_id, Vocab::META_VALIDATION, wp_slash( (string) wp_json_encode( $res['data'] ) ) );
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
		$file  = CURTAIN_PLUGIN_DIR . 'assets/garment-draft.schema.json';
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

		$fabric         = $json( 'fabric' );
		$ease           = $json( 'ease' );
		$lengths        = $json( 'length_cm' );
		$chart          = $json( 'size_chart' );
		$critical       = $json( 'critical_fit_points' );
		$zones          = $json( 'stretch_zones' );
		$tags           = $json( 'style_tags' );
		$colorways      = $json( 'colorways' );
		$block          = (string) $get( 'pattern_block' );
		$custom         = '' !== $block && ! in_array( $block, Vocab::PATTERN_BLOCKS, true );
		$flat_id        = (int) $get( 'flat_lay_photo_id' );
		$flat_url       = (string) $get( 'flat_lay_photo' );
		$custom_lengths = array_diff_key( $lengths, array_flip( Vocab::LENGTH_KEYS ) );
		$other_zones    = array_values( array_diff( array_map( 'strval', $zones ), Vocab::STRETCH_ZONES ) );
		$prefill        = array() === $fabric ? self::fabric_prefill( $id ) : null;

		wp_nonce_field( self::NONCE, self::NONCE );
		self::render_status( $id );
		?>
		<div class="curtain-box">
			<p class="description"><?php esc_html_e( 'Everything here describes the garment, never a customer. Measurements in cm. Fields marked * are needed before the product is "active" in Curtain.', 'curtain-woocommerce' ); ?></p>

			<h4><?php esc_html_e( 'Classification', 'curtain-woocommerce' ); ?></h4>
			<div class="curtain-grid">
				<label><span><?php esc_html_e( 'Category *', 'curtain-woocommerce' ); ?></span>
					<select name="curtain[category]">
						<option value=""><?php esc_html_e( 'Infer from product categories', 'curtain-woocommerce' ); ?></option>
						<?php foreach ( Vocab::CATEGORIES as $c ) : ?>
							<option value="<?php echo esc_attr( $c ); ?>" <?php selected( $get( 'category' ), $c ); ?>><?php echo esc_html( $c ); ?></option>
						<?php endforeach; ?>
					</select></label>
				<label><span><?php esc_html_e( 'Subcategory', 'curtain-woocommerce' ); ?></span><input type="text" name="curtain[subcategory]" value="<?php echo esc_attr( (string) $get( 'subcategory' ) ); ?>" placeholder="wrap-midi" maxlength="64"></label>
				<label><span><?php esc_html_e( 'Made for', 'curtain-woocommerce' ); ?></span>
					<select name="curtain[audience]">
						<option value=""><?php esc_html_e( 'Read from categories, tags and name', 'curtain-woocommerce' ); ?></option>
						<option value="women" <?php selected( $get( 'audience' ), 'women' ); ?>><?php esc_html_e( 'Women', 'curtain-woocommerce' ); ?></option>
						<option value="men" <?php selected( $get( 'audience' ), 'men' ); ?>><?php esc_html_e( 'Men', 'curtain-woocommerce' ); ?></option>
						<option value="unisex" <?php selected( $get( 'audience' ), 'unisex' ); ?>><?php esc_html_e( 'Unisex', 'curtain-woocommerce' ); ?></option>
						<option value="none" <?php selected( $get( 'audience' ), 'none' ); ?>><?php esc_html_e( 'Leave out', 'curtain-woocommerce' ); ?></option>
					</select></label>
				<label><span><?php esc_html_e( 'Brand', 'curtain-woocommerce' ); ?></span><input type="text" name="curtain[brand]" value="<?php echo esc_attr( (string) $get( 'brand' ) ); ?>" placeholder="<?php echo esc_attr( (string) ( '' !== (string) Settings::get( 'default_brand' ) ? Settings::get( 'default_brand' ) : get_bloginfo( 'name' ) ) ); ?>" maxlength="120"></label>
				<label><span><?php esc_html_e( 'Pattern block', 'curtain-woocommerce' ); ?></span>
					<select name="curtain[pattern_block]" class="curtain-pattern-block">
						<option value=""><?php esc_html_e( '— none —', 'curtain-woocommerce' ); ?></option>
						<?php foreach ( Vocab::PATTERN_BLOCKS as $b ) : ?>
							<option value="<?php echo esc_attr( $b ); ?>" <?php selected( $block, $b ); ?>><?php echo esc_html( $b ); ?></option>
						<?php endforeach; ?>
						<option value="<?php echo esc_attr( Sanitizer::CUSTOM_PATTERN_BLOCK ); ?>" <?php selected( $custom ); ?>><?php esc_html_e( 'Other…', 'curtain-woocommerce' ); ?></option>
					</select>
					<input type="text" name="curtain[pattern_block_custom]" class="curtain-pattern-block-custom" value="<?php echo esc_attr( $custom ? $block : '' ); ?>" placeholder="<?php esc_attr_e( 'custom block name', 'curtain-woocommerce' ); ?>" maxlength="64" <?php echo $custom ? '' : 'style="display:none"'; ?>></label>
			</div>

			<h4><?php esc_html_e( 'Flat-lay photo *', 'curtain-woocommerce' ); ?></h4>
			<div class="curtain-flatlay">
				<input type="hidden" name="curtain[flat_lay_id]" class="curtain-flatlay-id" value="<?php echo esc_attr( (string) $flat_id ); ?>">
				<div class="curtain-flatlay-preview">
				<?php
				if ( '' !== $flat_url ) :
					?>
					<img src="<?php echo esc_url( $flat_url ); ?>" alt=""><?php endif; ?></div>
				<button type="button" class="button curtain-flatlay-pick"><?php esc_html_e( 'Choose from media library', 'curtain-woocommerce' ); ?></button>
				<button type="button" class="button-link-delete curtain-flatlay-remove" <?php echo '' === $flat_url ? 'style="display:none"' : ''; ?>><?php esc_html_e( 'Remove', 'curtain-woocommerce' ); ?></button>
				<p class="description"><?php esc_html_e( 'The garment laid flat on a white background, front view. This is what shoppers see draped on their own silhouette (labelled as an estimate).', 'curtain-woocommerce' ); ?></p>
			</div>

			<h4><?php esc_html_e( 'Fabric *', 'curtain-woocommerce' ); ?></h4>
			<?php if ( null !== $prefill ) : ?>
				<p class="curtain-fabric-prefill" data-prefill="<?php echo esc_attr( (string) wp_json_encode( $prefill ) ); ?>">
					<?php echo esc_html( sprintf( /* translators: %s: fibres read from the product's material attribute, e.g. "viscose 95 %, elastane 5 %" */ __( 'Found in this product\'s attributes: %s. Check it, add stretch and drape, then update the product.', 'curtain-woocommerce' ), self::fabric_summary( $prefill ) ) ); ?>
					<button type="button" class="button-link curtain-fabric-prefill-use"><?php esc_html_e( 'Use these fibres', 'curtain-woocommerce' ); ?></button>
				</p>
			<?php endif; ?>
			<div class="curtain-grid">
				<label><span><?php esc_html_e( 'Primary fibre *', 'curtain-woocommerce' ); ?></span><input type="text" list="curtain-fibres" name="curtain[fabric_primary]" value="<?php echo esc_attr( (string) ( $fabric['primary'] ?? '' ) ); ?>" maxlength="64">
					<datalist id="curtain-fibres">
					<?php
					foreach ( Vocab::FABRIC_PRIMARIES as $f ) :
						?>
						<option value="<?php echo esc_attr( $f ); ?>"></option><?php endforeach; ?></datalist></label>
				<label><span><?php esc_html_e( 'Weight (g/m²)', 'curtain-woocommerce' ); ?></span><input type="number" name="curtain[fabric_weight_gsm]" value="<?php echo esc_attr( self::num( $fabric['weightGsm'] ?? '' ) ); ?>" min="1" max="2000" step="1"></label>
				<label><span><?php esc_html_e( 'Stretch % *', 'curtain-woocommerce' ); ?></span><input type="number" name="curtain[fabric_stretch_pct]" value="<?php echo esc_attr( self::num( $fabric['stretchPct'] ?? '' ) ); ?>" min="0" max="100" step="1" placeholder="0 = none, 30 = jersey"></label>
				<label><span><?php esc_html_e( 'Drape (0 stiff – 1 fluid) *', 'curtain-woocommerce' ); ?></span><input type="number" name="curtain[fabric_drape]" value="<?php echo esc_attr( self::num( $fabric['drape'] ?? '' ) ); ?>" min="0" max="1" step="0.05" list="curtain-drape">
					<datalist id="curtain-drape">
					<?php
					foreach ( Vocab::drape_presets() as $v => $label ) :
						?>
						<option value="<?php echo esc_attr( $v ); ?>" label="<?php echo esc_attr( $label ); ?>"></option><?php endforeach; ?></datalist></label>
				<label><span><?php esc_html_e( 'Opacity (0 sheer – 1 opaque)', 'curtain-woocommerce' ); ?></span><input type="number" name="curtain[fabric_opacity]" value="<?php echo esc_attr( self::num( $fabric['opacity'] ?? '' ) ); ?>" min="0" max="1" step="0.05"></label>
				<label><span><?php esc_html_e( 'Sheen (0 matte – 1 shiny)', 'curtain-woocommerce' ); ?></span><input type="number" name="curtain[fabric_sheen]" value="<?php echo esc_attr( self::num( $fabric['sheen'] ?? '' ) ); ?>" min="0" max="1" step="0.05"></label>
			</div>
			<table class="curtain-table curtain-repeater" data-repeater="fabric_blend">
				<thead><tr><th><?php esc_html_e( 'Blend fibre', 'curtain-woocommerce' ); ?></th><th>%</th><th></th></tr></thead>
				<tbody>
					<?php
					$blend = is_array( $fabric['blend'] ?? null ) ? $fabric['blend'] : array();
					foreach ( array_merge( $blend, array( array( '', '' ) ) ) as $i => $row ) :
						?>
						<tr><td><input type="text" name="curtain[fabric_blend][<?php echo (int) $i; ?>][fibre]" value="<?php echo esc_attr( (string) ( $row[0] ?? '' ) ); ?>" list="curtain-fibres" maxlength="64"></td>
							<td><input type="number" name="curtain[fabric_blend][<?php echo (int) $i; ?>][pct]" value="<?php echo esc_attr( self::num( $row[1] ?? '' ) ); ?>" min="0" max="100" step="1" class="curtain-narrow"></td>
							<td><button type="button" class="button-link curtain-row-remove" aria-label="<?php esc_attr_e( 'Remove row', 'curtain-woocommerce' ); ?>">×</button></td></tr>
					<?php endforeach; ?>
				</tbody>
				<tfoot><tr><td colspan="3"><button type="button" class="button curtain-row-add"><?php esc_html_e( 'Add fibre', 'curtain-woocommerce' ); ?></button></td></tr></tfoot>
			</table>

			<h4><?php esc_html_e( 'Size chart *', 'curtain-woocommerce' ); ?></h4>
			<p class="curtain-radios">
				<strong><?php esc_html_e( 'The numbers below are *', 'curtain-woocommerce' ); ?></strong>
				<label><input type="radio" name="curtain[size_chart_type]" value="garment" <?php checked( $get( 'size_chart_type' ), 'garment' ); ?>> <?php esc_html_e( 'garment measurements (measured flat)', 'curtain-woocommerce' ); ?></label>
				<label><input type="radio" name="curtain[size_chart_type]" value="body" <?php checked( $get( 'size_chart_type' ), 'body' ); ?>> <?php esc_html_e( 'body measurements (the body each size is cut for)', 'curtain-woocommerce' ); ?></label>
			</p>
			<?php $templates = self::chart_templates(); ?>
			<?php if ( array() !== $templates ) : ?>
			<p class="curtain-template">
				<label for="curtain-chart-template"><strong><?php esc_html_e( 'Start from a template', 'curtain-woocommerce' ); ?></strong></label>
				<select id="curtain-chart-template" class="curtain-template-select">
					<option value=""><?php esc_html_e( '— choose a template —', 'curtain-woocommerce' ); ?></option>
					<optgroup label="<?php esc_attr_e( 'Body charts (numbers filled in)', 'curtain-woocommerce' ); ?>">
						<?php foreach ( $templates as $t ) : ?>
							<?php
							if ( 'body' === $t['kind'] ) :
								?>
								<option value="<?php echo esc_attr( (string) $t['id'] ); ?>"><?php echo esc_html( (string) $t['label'] ); ?></option><?php endif; ?>
						<?php endforeach; ?>
					</optgroup>
					<optgroup label="<?php esc_attr_e( 'Garment charts (you measure each size)', 'curtain-woocommerce' ); ?>">
						<?php foreach ( $templates as $t ) : ?>
							<?php
							if ( 'garment' === $t['kind'] ) :
								?>
								<option value="<?php echo esc_attr( (string) $t['id'] ); ?>"><?php echo esc_html( (string) $t['label'] ); ?></option><?php endif; ?>
						<?php endforeach; ?>
					</optgroup>
				</select>
				<button type="button" class="button curtain-template-apply"><?php esc_html_e( 'Use template', 'curtain-woocommerce' ); ?></button>
				<span class="description curtain-template-note"><?php esc_html_e( 'Fills the chart below; nothing is saved until you update the product. Check the sizes against your own labels.', 'curtain-woocommerce' ); ?></span>
			</p>
			<?php endif; ?>
			<table class="curtain-table curtain-repeater" data-repeater="size_chart">
				<thead><tr>
					<?php
					foreach ( Vocab::SIZE_ROW_COLUMNS as $col ) :
						?>
						<th><?php echo esc_html( self::column_label( $col, (string) $get( 'audience' ) ) ); ?></th><?php endforeach; ?><th></th>
				</tr></thead>
				<tbody>
					<?php
					$rows   = array_values( array_filter( $chart, 'is_array' ) );
					$rows[] = array();
					foreach ( $rows as $i => $row ) :
						?>
						<tr>
							<?php foreach ( Vocab::SIZE_ROW_COLUMNS as $col ) : ?>
								<td><?php if ( 'size' === $col ) : ?>
									<input type="text" name="curtain[size_chart][<?php echo (int) $i; ?>][size]" value="<?php echo esc_attr( (string) ( $row['size'] ?? '' ) ); ?>" maxlength="16" class="curtain-narrow" placeholder="S">
								<?php else : ?>
									<input type="number" name="curtain[size_chart][<?php echo (int) $i; ?>][<?php echo esc_attr( $col ); ?>]" value="<?php echo esc_attr( self::num( $row[ $col ] ?? '' ) ); ?>" min="0" max="300" step="0.5" class="curtain-narrow">
								<?php endif; ?></td>
							<?php endforeach; ?>
							<td><button type="button" class="button-link curtain-row-remove" aria-label="<?php esc_attr_e( 'Remove row', 'curtain-woocommerce' ); ?>">×</button></td>
						</tr>
					<?php endforeach; ?>
				</tbody>
				<tfoot><tr><td colspan="<?php echo count( Vocab::SIZE_ROW_COLUMNS ) + 1; ?>"><button type="button" class="button curtain-row-add"><?php esc_html_e( 'Add size', 'curtain-woocommerce' ); ?></button> <span class="description"><?php esc_html_e( 'Ascending order. Leave a cell empty (or 0) when the shop does not publish that measurement.', 'curtain-woocommerce' ); ?></span></td></tr></tfoot>
			</table>

			<?php self::render_tape( $id, array_values( array_filter( $chart, 'is_array' ) ), (string) $get( 'closure' ), $json( 'garment_tape' ) ); ?>

			<h4><?php esc_html_e( 'Designed ease (garment minus body, cm)', 'curtain-woocommerce' ); ?></h4>
			<div class="curtain-inline">
				<?php foreach ( Vocab::FIT_POINTS as $p ) : ?>
					<label><span><?php echo esc_html( $p ); ?></span><input type="number" name="curtain[ease][<?php echo esc_attr( $p ); ?>]" value="<?php echo esc_attr( self::num( $ease[ $p ] ?? '' ) ); ?>" min="-20" max="60" step="0.5" class="curtain-narrow"></label>
				<?php endforeach; ?>
			</div>

			<h4><?php esc_html_e( 'Lengths (cm)', 'curtain-woocommerce' ); ?></h4>
			<div class="curtain-inline">
				<?php foreach ( Vocab::LENGTH_KEYS as $k ) : ?>
					<label><span><?php echo esc_html( str_replace( '_', ' ', $k ) ); ?></span><input type="number" name="curtain[length][<?php echo esc_attr( $k ); ?>]" value="<?php echo esc_attr( self::num( $lengths[ $k ] ?? '' ) ); ?>" min="0" max="400" step="0.5" class="curtain-narrow"></label>
				<?php endforeach; ?>
			</div>
			<table class="curtain-table curtain-repeater" data-repeater="length_custom">
				<thead><tr><th><?php esc_html_e( 'Other length (key)', 'curtain-woocommerce' ); ?></th><th>cm</th><th></th></tr></thead>
				<tbody>
					<?php
					$custom_rows = array();
					foreach ( $custom_lengths as $k => $v ) {
						$custom_rows[] = array( (string) $k, $v );
					}
					$custom_rows[] = array( '', '' );
					foreach ( $custom_rows as $i => $row ) :
						?>
						<tr><td><input type="text" name="curtain[length_custom][<?php echo (int) $i; ?>][key]" value="<?php echo esc_attr( $row[0] ); ?>" placeholder="hem_circumference" maxlength="64"></td>
							<td><input type="number" name="curtain[length_custom][<?php echo (int) $i; ?>][value]" value="<?php echo esc_attr( self::num( $row[1] ) ); ?>" min="0" max="400" step="0.5" class="curtain-narrow"></td>
							<td><button type="button" class="button-link curtain-row-remove" aria-label="<?php esc_attr_e( 'Remove row', 'curtain-woocommerce' ); ?>">×</button></td></tr>
					<?php endforeach; ?>
				</tbody>
				<tfoot><tr><td colspan="3"><button type="button" class="button curtain-row-add"><?php esc_html_e( 'Add length', 'curtain-woocommerce' ); ?></button></td></tr></tfoot>
			</table>

			<h4><?php esc_html_e( 'Fit notes', 'curtain-woocommerce' ); ?></h4>
			<div class="curtain-grid">
				<label class="curtain-span2"><span><?php esc_html_e( 'Sizing notes', 'curtain-woocommerce' ); ?></span><textarea name="curtain[sizing_notes]" rows="2" maxlength="500" placeholder="<?php esc_attr_e( "e.g. 'runs small', 'size up if between sizes'", 'curtain-woocommerce' ); ?>"><?php echo esc_textarea( (string) $get( 'sizing_notes' ) ); ?></textarea></label>
				<label><span><?php esc_html_e( 'True-to-size score (0–1)', 'curtain-woocommerce' ); ?></span><input type="number" name="curtain[true_to_size_score]" value="<?php echo esc_attr( self::num( $get( 'true_to_size_score' ) ) ); ?>" min="0" max="1" step="0.01" placeholder="0.8"></label>
			</div>
			<div class="curtain-grid">
				<fieldset><legend><?php esc_html_e( 'Critical fit points', 'curtain-woocommerce' ); ?></legend>
					<?php foreach ( Vocab::FIT_POINTS as $p ) : ?>
						<label class="curtain-check"><input type="checkbox" name="curtain[critical_fit_points][]" value="<?php echo esc_attr( $p ); ?>" <?php checked( in_array( $p, $critical, true ) ); ?>> <?php echo esc_html( $p ); ?></label>
					<?php endforeach; ?>
				</fieldset>
				<fieldset><legend><?php esc_html_e( 'Stretch zones', 'curtain-woocommerce' ); ?></legend>
					<?php foreach ( Vocab::STRETCH_ZONES as $z ) : ?>
						<label class="curtain-check"><input type="checkbox" name="curtain[stretch_zones][]" value="<?php echo esc_attr( $z ); ?>" <?php checked( in_array( $z, $zones, true ) ); ?>> <?php echo esc_html( $z ); ?></label>
					<?php endforeach; ?>
					<input type="text" name="curtain[stretch_zones_other]" value="<?php echo esc_attr( implode( ', ', $other_zones ) ); ?>" placeholder="<?php esc_attr_e( 'other zones, comma separated', 'curtain-woocommerce' ); ?>" maxlength="400">
				</fieldset>
			</div>

			<h4><?php esc_html_e( 'Style tags (0–1 per axis, optional)', 'curtain-woocommerce' ); ?></h4>
			<div class="curtain-inline">
				<?php foreach ( Vocab::TASTE_AXES as $axis ) : ?>
					<label><span><?php echo esc_html( $axis ); ?></span><input type="number" name="curtain[style_tags][<?php echo esc_attr( $axis ); ?>]" value="<?php echo esc_attr( self::num( $tags[ $axis ] ?? '' ) ); ?>" min="0" max="1" step="0.1" class="curtain-narrow"></label>
				<?php endforeach; ?>
			</div>

			<h4><?php esc_html_e( 'Colours', 'curtain-woocommerce' ); ?></h4>
			<div class="curtain-grid">
				<label><span><?php esc_html_e( 'Primary colour (#RRGGBB)', 'curtain-woocommerce' ); ?></span>
					<span class="curtain-colour"><input type="text" name="curtain[primary_color_hex]" class="curtain-hex" value="<?php echo esc_attr( (string) $get( 'primary_color_hex' ) ); ?>" pattern="#?[0-9a-fA-F]{3}([0-9a-fA-F]{3})?" placeholder="#C97A4F" maxlength="7"><input type="color" class="curtain-swatch" value="<?php echo esc_attr( Payload_Builder::coerce_hex( $get( 'primary_color_hex' ) ) ?? '#ffffff' ); ?>" aria-hidden="true" tabindex="-1"></span></label>
			</div>
			<table class="curtain-table curtain-repeater" data-repeater="colorways">
				<thead><tr><th><?php esc_html_e( 'Colorway name', 'curtain-woocommerce' ); ?></th><th>#hex</th><th>SKU</th><th></th></tr></thead>
				<tbody>
					<?php
					$cw_rows   = array_values( array_filter( $colorways, 'is_array' ) );
					$cw_rows[] = array();
					foreach ( $cw_rows as $i => $row ) :
						?>
						<tr><td><input type="text" name="curtain[colorways][<?php echo (int) $i; ?>][name]" value="<?php echo esc_attr( (string) ( $row['name'] ?? '' ) ); ?>" maxlength="64"></td>
							<td><span class="curtain-colour"><input type="text" name="curtain[colorways][<?php echo (int) $i; ?>][hex]" class="curtain-hex curtain-narrow" value="<?php echo esc_attr( (string) ( $row['hex'] ?? '' ) ); ?>" maxlength="7"><input type="color" class="curtain-swatch" value="<?php echo esc_attr( Payload_Builder::coerce_hex( $row['hex'] ?? '' ) ?? '#ffffff' ); ?>" aria-hidden="true" tabindex="-1"></span></td>
							<td><input type="text" name="curtain[colorways][<?php echo (int) $i; ?>][sku]" value="<?php echo esc_attr( (string) ( $row['sku'] ?? '' ) ); ?>" maxlength="64"></td>
							<td><button type="button" class="button-link curtain-row-remove" aria-label="<?php esc_attr_e( 'Remove row', 'curtain-woocommerce' ); ?>">×</button></td></tr>
					<?php endforeach; ?>
				</tbody>
				<tfoot><tr><td colspan="4"><button type="button" class="button curtain-row-add"><?php esc_html_e( 'Add colorway', 'curtain-woocommerce' ); ?></button></td></tr></tfoot>
			</table>
		</div>
		<?php
	}

	/**
	 * The table's messages (and, through the basis, its draft) as of this save. The basis is the
	 * stored chart, tape and closure after the save: when sync, REST or anything else changes one of
	 * them later, the draft and messages are out of date and the box no longer shows them.
	 *
	 * @param array{errors: array<int,mixed>, warnings: array<int,mixed>} $tape
	 */
	public static function store_tape_issues( int $post_id, array $tape ): void {
		$tape['basis'] = self::tape_basis( $post_id );
		update_post_meta( $post_id, Garment_Tape::META_ISSUES, wp_slash( (string) wp_json_encode( $tape ) ) );
	}

	private static function tape_basis( int $post_id ): string {
		$parts = array();
		foreach ( array( '_curtain_size_chart', '_curtain_garment_tape', '_curtain_closure' ) as $k ) {
			$parts[] = (string) get_post_meta( $post_id, $k, true );
		}
		return md5( implode( "\n", $parts ) );
	}

	/**
	 * "Garment measurements": closure, hip depth and one row per chart size (Garment_Tape). A ticked
	 * row is typed in; an unticked row shows the stored estimate, labelled, read-only. After a save
	 * with an error, what was typed comes back from `_curtain_tape_input` with the messages.
	 *
	 * @param array<int,array<string,mixed>> $chart  The stored size chart.
	 * @param mixed                          $stored The stored `_curtain_garment_tape`.
	 */
	private static function render_tape( int $id, array $chart, string $closure, $stored ): void {
		$t      = Garment_Tape::form_text();
		$tape   = Garment_Tape::parse_stored( $stored );
		$filled = null !== $tape && $chart ? Garment_Tape::refill( $chart, $tape )['garmentTape'] : $tape;
		$typed  = Garment_Tape::measured_from_tape( $filled );
		$depth  = null;
		foreach ( $typed as $m ) {
			if ( isset( $m['hipDepthBelowBandCm'] ) ) {
				$depth = $m['hipDepthBelowBandCm'];
			}
		}
		$draft  = json_decode( (string) get_post_meta( $id, Garment_Tape::META_INPUT, true ), true );
		$issues = json_decode( (string) get_post_meta( $id, Garment_Tape::META_ISSUES, true ), true );
		if ( ! is_array( $issues ) || ( $issues['basis'] ?? null ) !== self::tape_basis( $id ) ) {
			// Written before the product changed elsewhere (sync, REST): what it says is about another product state.
			$issues = null;
			$draft  = null;
		}
		if ( is_array( $draft ) ) {
			$typed   = (array) ( $draft['measured'] ?? array() );
			$closure = (string) ( $draft['closure'] ?? $closure );
			$depth   = $draft['depth'] ?? $depth;
		}
		$by_size = array();
		foreach ( $typed as $m ) {
			$by_size[ Garment_Tape::key( (string) ( $m['size'] ?? '' ) ) ] = $m;
		}
		$filled_by = array();
		foreach ( (array) $filled as $row ) {
			$filled_by[ Garment_Tape::key( (string) $row['size'] ) ] = $row;
		}
		$bad       = array();
		$depth_bad = false;
		foreach ( (array) ( $issues['errors'] ?? array() ) as $e ) {
			if ( 'hipDepth' === ( $e['field'] ?? null ) ) {
				$depth_bad = true; // One input for every size.
			} elseif ( isset( $e['size'], $e['field'] ) ) {
				$bad[ Garment_Tape::key( (string) $e['size'] ) . '|' . $e['field'] ] = true;
			}
		}
		// Typed rows whose size the chart no longer has (renamed or removed in the same save): shown
		// after the chart rows with the label editable, so the numbers typed are not lost.
		$chart_keys = array();
		foreach ( array_slice( $chart, 0, 30 ) as $c ) {
			$chart_keys[ Garment_Tape::key( (string) ( $c['size'] ?? '' ) ) ] = true;
		}
		$orphans = array();
		if ( is_array( $draft ) ) {
			foreach ( $typed as $m ) {
				$size = (string) ( $m['size'] ?? '' );
				if ( '' !== trim( $size ) && ! isset( $chart_keys[ Garment_Tape::key( $size ) ] ) ) {
					$orphans[] = $m;
				}
			}
		}
		$has_errors = ! empty( $issues['errors'] );
		?>
		<div class="curtain-tape" id="curtain-tape">
			<h4><?php echo esc_html( $t['heading'] ); ?></h4>
			<p class="description"><?php echo esc_html( $t['intro'] ); ?></p>
			<details><summary><?php echo esc_html( $t['howTo'] ); ?></summary><ul class="curtain-tape-howto">
				<?php
				foreach ( $t['howToLines'] as $line ) :
					?>
					<li><?php echo esc_html( $line ); ?></li><?php endforeach; ?></ul></details>
			<div class="curtain-grid">
				<label><span><?php echo esc_html( $t['closureLabel'] ); ?></span>
					<select name="curtain[closure]">
						<option value=""><?php echo esc_html( $t['closureNone'] ); ?></option>
						<?php foreach ( Garment_Tape::CLOSURES as $c ) : ?>
							<option value="<?php echo esc_attr( $c ); ?>" <?php selected( $closure, $c ); ?>><?php echo esc_html( Garment_Tape::closure_label( $c ) ); ?></option>
						<?php endforeach; ?>
					</select></label>
				<label><span><?php echo esc_html( $t['hipDepthLabel'] ); ?></span><input type="text" inputmode="decimal" name="curtain[tape_depth]" value="<?php echo esc_attr( null === $depth ? '' : (string) $depth ); ?>" placeholder="<?php echo esc_attr( $t['hipDepthPlaceholder'] ); ?>" maxlength="8" class="curtain-narrow curtain-tape-depth" <?php echo $depth_bad ? 'aria-invalid="true"' : ''; ?>></label>
			</div>
			<?php if ( array() === $chart ) : ?>
				<p class="curtain-tape-note"><?php echo esc_html( $t['noChart'] ); ?></p>
			<?php else : ?>
				<p class="description"><?php echo esc_html( $t['measuredHint'] ); ?></p>
				<?php if ( $has_errors && null !== $filled ) : ?>
					<p class="curtain-tape-note"><?php echo esc_html( $t['estimatesStale'] ); ?></p>
				<?php endif; ?>
				<table class="curtain-table curtain-tape-table">
					<thead><tr><th><?php echo esc_html( $t['sizeColumn'] ); ?></th><th><?php echo esc_html( $t['measuredColumn'] ); ?></th>
						<?php
						foreach ( Garment_Tape::FIELDS as $f ) :
							?>
							<th><?php echo esc_html( Garment_Tape::field_label( $f ) ); ?></th><?php endforeach; ?></tr></thead>
					<tbody>
						<?php
						foreach ( array_slice( $chart, 0, 30 ) as $i => $c ) :
							$size     = (string) ( $c['size'] ?? '' );
							$k        = Garment_Tape::key( $size );
							$m        = $by_size[ $k ] ?? null;
							$estimate = $filled_by[ $k ] ?? null;
							?>
							<tr class="<?php echo null === $m ? 'curtain-tape-est' : ''; ?>">
								<td class="curtain-tape-size"><strong><?php echo esc_html( $size ); ?></strong><input type="hidden" name="curtain[tape][<?php echo (int) $i; ?>][size]" value="<?php echo esc_attr( $size ); ?>"></td>
								<td class="curtain-tape-flag" data-label="<?php echo esc_attr( $t['measuredColumn'] ); ?>"><input type="checkbox" class="curtain-tape-measured" name="curtain[tape][<?php echo (int) $i; ?>][measured]" value="1" <?php checked( null !== $m ); ?> aria-label="<?php echo esc_attr( $t['measuredColumn'] . ' ' . $size ); ?>"></td>
								<?php
								foreach ( Garment_Tape::FIELDS as $f ) :
									$key   = Garment_Tape::INPUT_KEYS[ $f ];
									$value = null === $m ? ( $estimate[ $f ]['cm'] ?? '' ) : ( $m[ $key ] ?? '' );
									$prov  = null === $m ? ( $estimate[ $f ]['provenance'] ?? '' ) : '';
									?>
									<td class="curtain-tape-num" data-label="<?php echo esc_attr( Garment_Tape::field_label( $f ) ); ?>">
										<input type="text" inputmode="decimal" maxlength="8" class="curtain-narrow curtain-tape-cm" name="curtain[tape][<?php echo (int) $i; ?>][<?php echo esc_attr( $f ); ?>]" value="<?php echo esc_attr( (string) $value ); ?>" aria-label="<?php echo esc_attr( $size . ', ' . Garment_Tape::field_label( $f ) . ' (cm)' ); ?>" <?php echo null === $m ? 'readonly' : ''; ?> <?php echo isset( $bad[ $k . '|' . $f ] ) ? 'aria-invalid="true"' : ''; ?> data-estimate="<?php echo esc_attr( null === $m ? '1' : '' ); ?>">
										<?php if ( null === $m ) : ?>
											<span class="curtain-tape-prov curtain-tape-prov--<?php echo esc_attr( '' === $prov ? 'none' : $prov ); ?>"><?php echo esc_html( '' === $prov ? $t['notMeasured'] : Garment_Tape::provenance_label( $prov ) ); ?></span>
										<?php endif; ?>
									</td>
								<?php endforeach; ?>
							</tr>
						<?php endforeach; ?>
						<?php
						foreach ( $orphans as $j => $m ) :
							$i    = min( count( $chart ), 30 ) + $j;
							$size = (string) $m['size'];
							?>
							<tr class="curtain-tape-orphan">
								<td class="curtain-tape-size"><input type="text" class="curtain-narrow curtain-tape-size-input" name="curtain[tape][<?php echo (int) $i; ?>][size]" value="<?php echo esc_attr( $size ); ?>" maxlength="16" aria-invalid="true" aria-label="<?php echo esc_attr( $t['sizeColumn'] ); ?>"><span class="curtain-tape-prov curtain-tape-prov--extrapolated"><?php echo esc_html( $t['orphanSize'] ); ?></span></td>
								<td class="curtain-tape-flag" data-label="<?php echo esc_attr( $t['measuredColumn'] ); ?>"><input type="checkbox" class="curtain-tape-measured" name="curtain[tape][<?php echo (int) $i; ?>][measured]" value="1" checked="checked" aria-label="<?php echo esc_attr( $t['measuredColumn'] . ' ' . $size ); ?>"></td>
								<?php
								foreach ( Garment_Tape::FIELDS as $f ) :
									$value = $m[ Garment_Tape::INPUT_KEYS[ $f ] ] ?? '';
									?>
									<td class="curtain-tape-num" data-label="<?php echo esc_attr( Garment_Tape::field_label( $f ) ); ?>"><input type="text" inputmode="decimal" maxlength="8" class="curtain-narrow curtain-tape-cm" name="curtain[tape][<?php echo (int) $i; ?>][<?php echo esc_attr( $f ); ?>]" value="<?php echo esc_attr( is_array( $value ) ? '' : (string) $value ); ?>" aria-label="<?php echo esc_attr( $size . ', ' . Garment_Tape::field_label( $f ) . ' (cm)' ); ?>" data-estimate=""></td>
								<?php endforeach; ?>
							</tr>
						<?php endforeach; ?>
					</tbody>
				</table>
				<p class="description"><?php echo esc_html( $t['legend'] ); ?></p>
			<?php endif; ?>
			<?php if ( ! empty( $issues['errors'] ) ) : ?>
				<div class="curtain-tape-issues curtain-tape-issues--error" role="alert"><strong><?php echo esc_html( $t['notSaved'] ); ?></strong><ul>
					<?php
					foreach ( (array) $issues['errors'] as $e ) :
						?>
						<li><?php echo esc_html( (string) ( $e['message'] ?? '' ) ); ?></li><?php endforeach; ?></ul></div>
			<?php endif; ?>
			<?php if ( ! empty( $issues['warnings'] ) ) : ?>
				<div class="curtain-tape-issues curtain-tape-issues--warning"><strong><?php echo esc_html( $t['warningsTitle'] ); ?></strong><ul>
					<?php
					foreach ( (array) $issues['warnings'] as $w ) :
						?>
						<li><?php echo esc_html( (string) ( $w['message'] ?? '' ) ); ?></li><?php endforeach; ?></ul></div>
			<?php endif; ?>
			<p class="description"><?php echo esc_html( $t['privacy'] ); ?></p>
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
		<div class="curtain-status curtain-status--<?php echo esc_attr( '' === $status ? 'none' : $status ); ?>">
			<?php if ( ! $connected ) : ?>
				<p><strong><?php esc_html_e( 'Not connected to Curtain.', 'curtain-woocommerce' ); ?></strong> <?php esc_html_e( 'Fit data is saved here and synced once you connect.', 'curtain-woocommerce' ); ?> <a href="<?php echo esc_url( Settings::page_url() ); ?>"><?php esc_html_e( 'Connect', 'curtain-woocommerce' ); ?></a></p>
			<?php else : ?>
				<p><strong><?php esc_html_e( 'Curtain status:', 'curtain-woocommerce' ); ?></strong>
					<span class="curtain-badge curtain-badge--<?php echo esc_attr( '' === $status ? 'none' : $status ); ?>"><?php echo esc_html( '' === $status ? __( 'Not synced yet', 'curtain-woocommerce' ) : self::status_label( $status ) ); ?></span>
					<?php if ( is_array( $validation ) && isset( $validation['completeness']['score'] ) ) : ?>
						· <?php echo esc_html( sprintf( /* translators: %d: percentage */ __( 'completeness %d%%', 'curtain-woocommerce' ), (int) round( (float) $validation['completeness']['score'] * 100 ) ) ); ?>
					<?php endif; ?>
					<?php
					if ( '' !== $synced_at ) :
						?>
						· <span class="description"><?php echo esc_html( sprintf( /* translators: %s: date */ __( 'synced %s', 'curtain-woocommerce' ), $synced_at ) ); ?></span><?php endif; ?>
				</p>
				<?php
				if ( '' !== $error ) :
					?>
					<p class="curtain-error"><?php echo esc_html( $error ); ?></p><?php endif; ?>
				<?php if ( is_array( $validation ) && ! empty( $validation['completeness']['missing'] ) ) : ?>
					<p><?php esc_html_e( 'Missing for a better fit:', 'curtain-woocommerce' ); ?>
					<?php foreach ( (array) $validation['completeness']['missing'] as $m ) : ?>
						<code class="curtain-missing curtain-missing--<?php echo esc_attr( (string) ( $m['severity'] ?? 'light' ) ); ?>" title="<?php echo esc_attr( (string) ( $m['reason'] ?? '' ) ); ?>"><?php echo esc_html( (string) ( $m['field'] ?? '' ) ); ?></code>
					<?php endforeach; ?></p>
				<?php endif; ?>
			<?php endif; ?>
			<?php if ( is_array( $local ) && ( ! empty( $local['issues'] ) || ! empty( $local['missingHeavy'] ) ) ) : ?>
				<?php if ( ! empty( $local['missingHeavy'] ) ) : ?>
					<p><?php esc_html_e( 'Required before the product can be active:', 'curtain-woocommerce' ); ?>
					<?php
					foreach ( (array) $local['missingHeavy'] as $f ) :
						?>
						<code><?php echo esc_html( (string) $f ); ?></code> <?php endforeach; ?></p>
				<?php endif; ?>
				<?php if ( ! empty( $local['issues'] ) ) : ?>
					<ul class="curtain-issues">
						<?php foreach ( (array) $local['issues'] as $issue ) : ?>
							<li><code><?php echo esc_html( (string) ( $issue['path'] ?? '' ) ); ?></code> <?php echo esc_html( (string) ( $issue['message'] ?? '' ) ); ?></li>
						<?php endforeach; ?>
					</ul>
				<?php endif; ?>
			<?php endif; ?>
		</div>
		<?php
	}

	/**
	 * Header of a size chart column. $audience is the merchant's "Made for" value: only men and
	 * unisex change a header (bust → chest). A product without that value keeps the headers it
	 * always had, also when the audience is read from its name or tags at sync time.
	 */
	private static function column_label( string $col, string $audience = '' ): string {
		switch ( Vocab::size_column_key( $col, $audience ) ) {
			case 'size':
				return __( 'Size', 'curtain-woocommerce' );
			case 'chest':
				// The stored point is `bust` for every audience; on men's garments it holds the chest.
				return __( 'chest', 'curtain-woocommerce' );
			case 'footEu':
				return __( 'Foot EU', 'curtain-woocommerce' );
			case 'footLengthCm':
				return __( 'Foot cm', 'curtain-woocommerce' );
			default:
				return $col;
		}
	}

	/**
	 * Fabric names read from the product's own "Material" / "Materiaal" / "Samenstelling" attribute
	 * (Fabric_Text, the twin of fabricFromProductText), offered when the product has no Curtain
	 * fabric yet. Prefill only: nothing is stored until the merchant uses it and saves, because a
	 * fabric without stretch and drape is not a valid payload.
	 *
	 * @return array{primary:string,blend?:array<int,array{0:string,1:int|float}>}|null
	 */
	public static function fabric_prefill( int $product_id ): ?array {
		$product = function_exists( 'wc_get_product' ) ? wc_get_product( $product_id ) : null;
		if ( ! $product instanceof \WC_Product ) {
			return null;
		}
		$snapshot = Product_Snapshot::from_product( $product );
		return Fabric_Text::prefill_from_attributes( (array) ( $snapshot['attributes'] ?? array() ) );
	}

	/** "viscose 95 %, elastane 5 %" (or just the primary). @param array{primary:string,blend?:array<int,array{0:string,1:int|float}>} $prefill */
	public static function fabric_summary( array $prefill ): string {
		if ( empty( $prefill['blend'] ) ) {
			return $prefill['primary'];
		}
		$parts = array();
		foreach ( $prefill['blend'] as $row ) {
			$parts[] = $row[0] . ' ' . self::num( $row[1] ) . ' %';
		}
		return ( $prefill['primary'] !== $prefill['blend'][0][0] ? $prefill['primary'] . ': ' : '' ) . implode( ', ', $parts );
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
