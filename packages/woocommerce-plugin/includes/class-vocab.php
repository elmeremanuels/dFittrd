<?php
/**
 * Closed/open vocabularies of GarmentPayload v1, mirrored from @curtain/schema (garment.ts and
 * mappings/woo.ts). The JSON Schema copied into assets/ at build time is the authority for
 * validation; these lists only drive the meta box UI and the category inference.
 *
 * @package Curtain
 */

declare(strict_types=1);

namespace Curtain;

defined( 'ABSPATH' ) || exit;

final class Vocab {

	public const SCHEMA_VERSION = 1;
	public const META_PREFIX    = '_curtain_';

	public const CATEGORIES = array( 'top', 'bottom', 'dress', 'outerwear', 'shoes', 'accessory' );
	public const FIT_POINTS = array( 'bust', 'waist', 'hip', 'shoulder', 'thigh', 'inseam', 'foot' );
	public const TASTE_AXES = array( 'bohemian', 'minimal', 'classic', 'avantGarde', 'sporty' );

	public const FABRIC_PRIMARIES = array(
		'linen',
		'cotton',
		'wool',
		'silk',
		'cashmere',
		'tencel',
		'modal',
		'denim',
		'jersey',
		'technical',
		'leather',
		'viscose',
		'polyester',
		'nylon',
		'elastane',
	);

	public const PATTERN_BLOCKS = array(
		'wrap',
		'a-line',
		'fit-and-flare',
		'skater',
		'sheath',
		'bodycon',
		'column',
		'empire',
		'tent',
		'trapeze',
		'oversized',
		'boxy',
		'bias',
		'shirt',
		't-shirt',
		'straight',
		'wide-leg',
		'bootcut',
		'skinny',
		'slim',
	);

	public const STRETCH_ZONES = array( 'waist-tie', 'waistband', 'side-panel', 'back-panel', 'cuff', 'rib-hem', 'stretch-knit' );

	public const LENGTH_KEYS = array(
		'shoulder_to_hem',
		'shoulder_to_waist',
		'sleeve_length',
		'back_length',
		'inseam',
		'outseam',
		'rise',
		'waist_to_hem',
		'chest_width',
		'heel_height',
		'strap_drop',
	);

	/** Size-chart columns, in table order. */
	public const SIZE_ROW_COLUMNS = array( 'size', 'bust', 'waist', 'hip', 'shoulder', 'thigh', 'inseam', 'footEu', 'footLengthCm' );

	/** Fields the backend requires for status 'active' (schema completeness.ts heavy fields). */
	public const HEAVY_FIELDS = array( 'category', 'sizeChartType', 'sizeChart', 'fabric.primary', 'flatLayPhoto' );

	/**
	 * Meta keys in display order: key → [path, kind, heavy]. Mirrors WOO_META_KEYS.
	 */
	public const META_KEYS = array(
		'_curtain_category'            => array( 'category', 'enum', true ),
		'_curtain_size_chart_type'     => array( 'sizeChartType', 'enum', true ),
		'_curtain_size_chart'          => array( 'sizeChart', 'json', true ),
		'_curtain_fabric'              => array( 'fabric', 'json', true ),
		'_curtain_flat_lay_photo'      => array( 'flatLayPhoto', 'url', true ),
		'_curtain_pattern_block'       => array( 'patternBlock', 'string', false ),
		'_curtain_ease'                => array( 'ease', 'json', false ),
		'_curtain_length_cm'           => array( 'lengthCm', 'json', false ),
		'_curtain_sizing_notes'        => array( 'sizingNotes', 'text', false ),
		'_curtain_true_to_size_score'  => array( 'trueToSizeScore', 'number', false ),
		'_curtain_critical_fit_points' => array( 'criticalFitPoints', 'list', false ),
		'_curtain_stretch_zones'       => array( 'stretchZones', 'list', false ),
		'_curtain_style_tags'          => array( 'styleTags', 'json', false ),
		'_curtain_primary_color_hex'   => array( 'primaryColorHex', 'color', false ),
		'_curtain_colorways'           => array( 'colorways', 'json', false ),
		'_curtain_subcategory'         => array( 'subcategory', 'string', false ),
		'_curtain_brand'               => array( 'brand', 'string', false ),
	);

	/** Plugin-private meta keys (not part of the wire mapping). */
	public const META_FLAT_LAY_ID  = '_curtain_flat_lay_photo_id';
	public const META_SYNC_STATUS  = '_curtain_sync_status';
	public const META_SYNC_ERROR   = '_curtain_sync_error';
	public const META_SYNCED_AT    = '_curtain_synced_at';
	public const META_CONTENT_HASH = '_curtain_content_hash';
	public const META_SCORE        = '_curtain_score';
	public const META_MISSING      = '_curtain_missing_fields';
	public const META_VALIDATION   = '_curtain_validation';
	public const META_LOCAL_ISSUES = '_curtain_local_issues';

	/**
	 * Keyword table for inferring a category from WooCommerce category names (mappings/common.ts).
	 *
	 * @return array<int, array{0:string,1:string}>
	 */
	public static function category_keywords(): array {
		return array(
			array( 'shoes', '/\b(shoes?|sneakers?|boots?|heels?|sandals?|loafers?|footwear|trainers?|pumps?|mules?|schoenen|laarzen)\b/i' ),
			array( 'outerwear', '/\b(coats?|jackets?|blazers?|outerwear|parkas?|trench|puffer|anoraks?|gilets?|overcoat|jas|jassen|mantel)\b/i' ),
			array( 'dress', '/\b(dress(es)?|gowns?|jumpsuits?|rompers?|playsuits?|jurk(en)?)\b/i' ),
			array( 'bottom', '/\b(pants|trousers?|jeans|skirts?|shorts|leggings?|chinos?|culottes?|joggers?|bottoms?|broek(en)?|rok(ken)?)\b/i' ),
			array( 'top', '/\b(tops?|shirts?|t-shirts?|tees?|blouses?|sweaters?|knitwear|cardigans?|hoodies?|sweatshirts?|tanks?|camis?|bodysuits?|polos?|jumpers?|pullovers?|vests?|trui(en)?|bloes)\b/i' ),
			array( 'accessory', '/\b(accessor(y|ies)|belts?|bags?|hats?|caps?|scarves|scarf|gloves?|jewell?ery|sunglasses|socks|tights|wallets?|riem(en)?|tas(sen)?|sjaal)\b/i' ),
		);
	}

	/**
	 * Infer a category from hints (explicit value, taxonomy path, product name). First match wins;
	 * taxonomy paths are matched most-specific segment first.
	 *
	 * @param array<int, string|null> $hints
	 */
	public static function infer_category( array $hints ): ?string {
		foreach ( $hints as $hint ) {
			if ( null === $hint || '' === trim( (string) $hint ) ) {
				continue;
			}
			$h = strtolower( trim( (string) $hint ) );
			if ( in_array( $h, self::CATEGORIES, true ) ) {
				return $h;
			}
			$parts    = preg_split( '/\s*[>\/]\s*/', $h );
			$segments = array_reverse( false !== $parts ? $parts : array( $h ) );
			foreach ( $segments as $seg ) {
				foreach ( self::category_keywords() as $pair ) {
					if ( preg_match( $pair[1], $seg ) ) {
						return $pair[0];
					}
				}
			}
		}
		return null;
	}

	/** Known values labels for the UI (translated lazily by the caller). */
	public static function drape_presets(): array {
		return array(
			'0.15' => 'stiff',
			'0.4'  => 'structured',
			'0.65' => 'soft',
			'0.9'  => 'fluid',
		);
	}
}
