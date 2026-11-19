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
	public const AUDIENCES  = array( 'women', 'men', 'unisex' );
	/** FIT_POINTS of @curtain/schema: `neck` and `sleeve` were added for menswear (men-3d-plan M2). */
	public const FIT_POINTS = array( 'bust', 'waist', 'hip', 'shoulder', 'thigh', 'inseam', 'foot', 'neck', 'sleeve' );
	/** The fit points the meta box always shows; the men's ones (`MENS_FIT_POINTS`) only with the men's columns. */
	public const FORM_FIT_POINTS = array( 'bust', 'waist', 'hip', 'shoulder', 'thigh', 'inseam', 'foot' );
	public const MENS_FIT_POINTS = array( 'neck', 'sleeve' );
	/** Where a chart's sleeve is measured from (SLEEVE_CONVENTIONS). */
	public const SLEEVE_CONVENTIONS = array( 'shoulder_point', 'centre_back' );
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
	public const SIZE_ROW_COLUMNS = array( 'size', 'bust', 'waist', 'hip', 'shoulder', 'thigh', 'inseam', 'neck', 'sleeve', 'length', 'rise', 'footEu', 'footLengthCm' );
	/** The men's columns of SIZE_ROW_COLUMNS: shown only on a men's product or a chart that has them. */
	public const MENS_SIZE_COLUMNS = array( 'neck', 'sleeve', 'length', 'rise' );
	/** Longest size label and largest chart (SIZE_LABEL_MAX, SIZE_CHART_MAX_ROWS). */
	public const SIZE_LABEL_MAX = 24;
	public const SIZE_CHART_MAX_ROWS = 60;

	/** Fields the backend requires for status 'active' (schema completeness.ts heavy fields). */
	public const HEAVY_FIELDS = array( 'category', 'sizeChartType', 'sizeChart', 'fabric.primary', 'flatLayPhoto' );

	/**
	 * Meta keys in display order: key → [path, kind, heavy]. Mirrors WOO_META_KEYS.
	 */
	public const META_KEYS = array(
		'_curtain_category'            => array( 'category', 'enum', 'whole' ),
		'_curtain_size_chart_type'     => array( 'sizeChartType', 'enum', true ),
		'_curtain_size_chart'          => array( 'sizeChart', 'json', true ),
		'_curtain_sleeve_convention'   => array( 'sleeveConvention', 'enum', false ),
		'_curtain_closure'             => array( 'closure', 'enum', false ),
		'_curtain_garment_tape'        => array( 'garmentTape', 'json', false ),
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
		'_curtain_audience'            => array( 'audience', 'enum', false ),
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

	// ---- audience (women / men / unisex) -----------------------------------------------------
	// PHP twin of @curtain/schema mappings/audience.ts. tests/audience.test.php replays the cases
	// that file exports, so the word lists and the order below must stay in step with it.

	/** Meta box values: the three audiences plus 'none' (send no audience, do not infer). */
	public const AUDIENCE_OPTIONS = array( 'women', 'men', 'unisex', 'none' );

	public const AUDIENCE_MEN_WORDS              = array( 'men', 'mens', 'menswear', 'male', 'males', 'gents', 'gentlemen', 'heren', 'mannen', 'herren', 'homme', 'hommes' );
	public const AUDIENCE_WOMEN_WORDS            = array( 'women', 'womens', 'womenswear', 'female', 'females', 'ladies', 'dames', 'vrouwen', 'damen', 'femme', 'femmes' );
	public const AUDIENCE_MEN_STRUCTURED_WORDS   = array( 'man', 'heer' );
	public const AUDIENCE_WOMEN_STRUCTURED_WORDS = array( 'woman', 'lady', 'vrouw', 'dame' );
	public const AUDIENCE_UNISEX_WORDS           = array( 'unisex', 'uniseks', 'genderneutral', 'genderneutraal', 'genderless' );
	public const AUDIENCE_MEN_PREFIXES           = array( 'heren', 'herren', 'mannen' );
	public const AUDIENCE_WOMEN_PREFIXES         = array( 'dames', 'damen', 'vrouwen' );
	/** What must follow the prefix for a compound to count: the start of a clothing word (ASCII only). */
	public const AUDIENCE_COMPOUND_TAILS         = array(
		'jeans', 'jas', 'jack', 'hemd', 'overhemd', 'shirt', 'tshirt', 'broek', 'hose', 'trui', 'pullover', 'pulli', 'sweater', 'hoodie',
		'vest', 'weste', 'pak', 'anzug', 'kostuum', 'colbert', 'sakko', 'blazer', 'mantel', 'kleding', 'kleidung', 'bekleidung', 'mode',
		'fashion', 'schoen', 'schuh', 'laars', 'stiefel', 'sneaker', 'sandal', 'sandaal', 'onder', 'unter', 'ober', 'boven', 'sok', 'socke',
		'zwem', 'bade', 'short', 'bermuda', 'polo', 'top', 'blouse', 'bluse', 'jurk', 'kleid', 'rok', 'rock', 'legging', 'pyjama', 'nacht',
		'boxer', 'slip', 'regen', 'winter', 'zomer', 'sommer', 'sport', 'outdoor', 'ski', 'fleece', 'thermo', 'chino', 'pantalon', 'tas',
		'riem', 'muts', 'sjaal', 'schal', 'handschoen', 'handschuh', 'maat', 'afdeling', 'collectie', 'kollektion', 'artikel',
	);
	public const AUDIENCE_STYLE_WORDS            = array( 'inspired', 'fit', 'style', 'styled', 'cut', 'look' );
	/** A word with one of these up to two words before it is skipped ("not for men"). */
	public const AUDIENCE_NEGATING_WORDS         = array( 'not', 'non', 'niet', 'geen', 'nicht', 'kein', 'keine', 'from' );
	public const AUDIENCE_GENDER_NEUTRAL_WORDS   = array( 'neutral', 'neutraal', 'neutrale', 'free' );
	public const AUDIENCE_NONE_VALUES            = array( 'none', 'unspecified', 'not specified', 'n/a', '-' );

	/** Attribute names that hold the audience (AUDIENCE_ATTRIBUTE_FIELD). */
	public const AUDIENCE_ATTRIBUTE_FIELD = '/^(?:pa_)?(?:gender|geslacht|sex|doelgroep|audience|department|afdeling|geschlecht|zielgruppe|target[-_ ]?(?:group|gender|audience))$/i';

	/**
	 * Text → whole lower-case words; a possessive 's is joined to its word ("men's" → mens).
	 * A word is compared as a whole, never as a substring: "women" does not contain the word "men".
	 *
	 * @return array<int, string>
	 */
	public static function audience_words( string $text ): array {
		$t = function_exists( 'mb_strtolower' ) ? mb_strtolower( $text, 'UTF-8' ) : strtolower( $text );
		$t = preg_replace( '/[\'’`´]s(?![\p{L}\p{N}])/u', 's', $t );
		$t = null === $t ? null : preg_replace( '/[\'’`´]/u', ' ', $t );
		if ( null === $t ) {
			return array(); // The pattern could not run on this text: nothing is read from it.
		}
		$words = preg_split( '/[^\p{L}\p{N}]+/u', $t, -1, PREG_SPLIT_NO_EMPTY );
		return false === $words ? array() : $words;
	}

	/** @param array<int, string> $prefixes */
	private static function audience_compound( string $word, array $prefixes ): bool {
		foreach ( $prefixes as $p ) {
			if ( ! str_starts_with( $word, $p ) ) {
				continue;
			}
			$rest = substr( $word, strlen( $p ) );
			foreach ( self::AUDIENCE_COMPOUND_TAILS as $t ) {
				if ( str_starts_with( $rest, $t ) ) {
					return true;
				}
			}
		}
		return false;
	}

	/**
	 * What the texts of one source say. $singular says how the name-like singular words ("man",
	 * "woman", "lady", "dame", "heer", "vrouw") are read: 'anywhere' (override, gender attribute),
	 * 'whole' (only as the whole value or a whole path segment: product type, category, tags,
	 * collections) or 'never' (product name). "Iron Man" as a tag is a name, not an audience.
	 *
	 * @param array<int, mixed> $texts
	 */
	public static function audience_of_texts( array $texts, string $singular ): ?string {
		$men   = false;
		$women = false;
		foreach ( $texts as $text ) {
			if ( ! is_string( $text ) ) {
				continue;
			}
			$segments = preg_split( '/[>\/|:;,]+/', $text );
			foreach ( false === $segments ? array( $text ) : $segments as $segment ) {
				$words         = self::audience_words( $segment );
				$n             = count( $words );
				$read_singular = 'anywhere' === $singular || ( 'whole' === $singular && 1 === $n );
				for ( $i = 0; $i < $n; $i++ ) {
					$w    = $words[ $i ];
					$next = $words[ $i + 1 ] ?? null;
					if ( in_array( $w, self::AUDIENCE_UNISEX_WORDS, true ) ) {
						return 'unisex';
					}
					if ( 'gender' === $w && null !== $next && in_array( $next, self::AUDIENCE_GENDER_NEUTRAL_WORDS, true ) ) {
						return 'unisex';
					}
					if ( null !== $next && in_array( $next, self::AUDIENCE_STYLE_WORDS, true ) ) {
						continue;
					}
					if ( ( $i >= 1 && in_array( $words[ $i - 1 ], self::AUDIENCE_NEGATING_WORDS, true ) ) || ( $i >= 2 && in_array( $words[ $i - 2 ], self::AUDIENCE_NEGATING_WORDS, true ) ) ) {
						continue;
					}
					if ( in_array( $w, self::AUDIENCE_MEN_WORDS, true ) || ( $read_singular && in_array( $w, self::AUDIENCE_MEN_STRUCTURED_WORDS, true ) ) || self::audience_compound( $w, self::AUDIENCE_MEN_PREFIXES ) ) {
						$men = true;
					} elseif ( in_array( $w, self::AUDIENCE_WOMEN_WORDS, true ) || ( $read_singular && in_array( $w, self::AUDIENCE_WOMEN_STRUCTURED_WORDS, true ) ) || self::audience_compound( $w, self::AUDIENCE_WOMEN_PREFIXES ) ) {
						$women = true;
					}
				}
			}
		}
		if ( $men && $women ) {
			return 'unisex';
		}
		if ( $men ) {
			return 'men';
		}
		return $women ? 'women' : null;
	}

	/**
	 * The merchant's own value: an audience, 'none' (send none, do not infer), or null when it is
	 * empty or not understood (inference then runs as if there were no override).
	 *
	 * @param mixed $value
	 */
	public static function coerce_audience_override( $value ): ?string {
		if ( ! is_string( $value ) ) {
			return null;
		}
		$t = trim( $value );
		$t = function_exists( 'mb_strtolower' ) ? mb_strtolower( $t, 'UTF-8' ) : strtolower( $t );
		if ( '' === $t ) {
			return null;
		}
		if ( in_array( $t, self::AUDIENCES, true ) ) {
			return $t;
		}
		if ( in_array( $t, self::AUDIENCE_NONE_VALUES, true ) ) {
			return 'none';
		}
		return self::audience_of_texts( array( $t ), 'anywhere' );
	}

	/**
	 * The audience and the source that decided it, strongest source first: override, attribute,
	 * productType, category, tags, title, collections. Null when nothing says anything; audience
	 * is null only for the override 'none'.
	 *
	 * @param array<string, mixed> $hints override, attribute[], productType, category[], tags[], title, collections[].
	 * @return array{audience:?string,source:string}|null
	 */
	public static function infer_audience_decision( array $hints ): ?array {
		$override = self::coerce_audience_override( $hints['override'] ?? null );
		if ( null !== $override ) {
			return array(
				'audience' => 'none' === $override ? null : $override,
				'source'   => 'override',
			);
		}
		$steps = array(
			array( 'attribute', (array) ( $hints['attribute'] ?? array() ), 'anywhere' ),
			array( 'productType', array( $hints['productType'] ?? null ), 'whole' ),
			array( 'category', (array) ( $hints['category'] ?? array() ), 'whole' ),
			array( 'tags', (array) ( $hints['tags'] ?? array() ), 'whole' ),
			array( 'title', array( $hints['title'] ?? null ), 'never' ),
			array( 'collections', (array) ( $hints['collections'] ?? array() ), 'whole' ),
		);
		foreach ( $steps as $step ) {
			$audience = self::audience_of_texts( $step[1], $step[2] );
			if ( null !== $audience ) {
				return array(
					'audience' => $audience,
					'source'   => $step[0],
				);
			}
		}
		return null;
	}

	/**
	 * The name a size chart column is shown under: `chest` for the `bust` column when the merchant
	 * set the audience to men or unisex, otherwise the column's own key (so a women's product, and
	 * every product without the "Made for" value, shows what it always showed).
	 */
	public static function size_column_key( string $col, ?string $audience ): string {
		if ( 'hip' === $col && 'men' === $audience ) {
			return 'seat'; // On a men's product the stored `hip` is the seat.
		}
		return 'bust' === $col && in_array( $audience, array( 'men', 'unisex' ), true ) ? 'chest' : $col;
	}

	/** The audience for the payload, or null (leave the field out). @param array<string, mixed> $hints */
	public static function infer_audience( array $hints ): ?string {
		$d = self::infer_audience_decision( $hints );
		return null === $d ? null : $d['audience'];
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
