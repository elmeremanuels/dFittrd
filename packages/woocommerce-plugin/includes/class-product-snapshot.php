<?php
/**
 * Reads a WC_Product into the plain-array snapshot the Payload_Builder (and the signed REST
 * endpoint) use. The shape intentionally matches the WooCommerce REST v3 product subset that
 * @paskamer/schema's `WooProductSchema` accepts, so the backend can normalise either source.
 *
 * @package Paskamer
 */

declare(strict_types=1);

namespace Paskamer;

defined('ABSPATH') || defined('PASKAMER_TESTING') || exit;

final class Product_Snapshot {

	/**
	 * @return array<string,mixed>
	 */
	public static function from_product( \WC_Product $product ): array {
		$id = $product->get_id();

		$images = array();
		$ids    = array_merge( array( $product->get_image_id() ), (array) $product->get_gallery_image_ids() );
		foreach ( array_unique( array_filter( array_map( 'intval', $ids ) ) ) as $attachment_id ) {
			$src = wp_get_attachment_url( $attachment_id );
			if ( is_string( $src ) && '' !== $src ) {
				$images[] = array(
					'id'  => $attachment_id,
					'src' => $src,
					'alt' => (string) get_post_meta( $attachment_id, '_wp_attachment_image_alt', true ),
				);
			}
		}

		$categories = array();
		$terms      = get_the_terms( $id, 'product_cat' );
		if ( is_array( $terms ) ) {
			foreach ( $terms as $term ) {
				$categories[] = array(
					'id'   => (int) $term->term_id,
					'name' => self::term_path( $term, 'product_cat' ),
					'slug' => (string) $term->slug,
				);
			}
		}

		$brands = array();
		if ( taxonomy_exists( 'product_brand' ) ) {
			$brand_terms = get_the_terms( $id, 'product_brand' );
			if ( is_array( $brand_terms ) ) {
				foreach ( $brand_terms as $term ) {
					$brands[] = array(
						'id'   => (int) $term->term_id,
						'name' => (string) $term->name,
						'slug' => (string) $term->slug,
					);
				}
			}
		}

		$attributes = array();
		foreach ( $product->get_attributes() as $key => $attribute ) {
			if ( ! $attribute instanceof \WC_Product_Attribute ) {
				continue;
			}
			$options = array();
			if ( $attribute->is_taxonomy() ) {
				foreach ( (array) $attribute->get_terms() as $term ) {
					$options[] = (string) $term->name;
				}
			} else {
				foreach ( (array) $attribute->get_options() as $opt ) {
					$options[] = (string) $opt;
				}
			}
			$attributes[] = array(
				'name'    => wc_attribute_label( $attribute->get_name(), $product ),
				'slug'    => (string) $key,
				'options' => $options,
			);
		}

		return array(
			'id'            => $id,
			'name'          => $product->get_name(),
			'slug'          => $product->get_slug(),
			'permalink'     => get_permalink( $id ),
			'type'          => $product->get_type(),
			'status'        => $product->get_status(),
			'sku'           => $product->get_sku(),
			'price'         => (string) $product->get_price(),
			'regular_price' => (string) $product->get_regular_price(),
			'currency'      => get_woocommerce_currency(),
			'images'        => $images,
			'categories'    => $categories,
			'brands'        => $brands,
			'attributes'    => $attributes,
		);
	}

	/**
	 * All `_paskamer_*` meta of a product as key → raw stored value.
	 *
	 * @return array<string,mixed>
	 */
	public static function meta( int $product_id ): array {
		$all = get_post_meta( $product_id );
		$out = array();
		if ( ! is_array( $all ) ) {
			return $out;
		}
		foreach ( $all as $key => $values ) {
			if ( str_starts_with( (string) $key, Vocab::META_PREFIX ) && is_array( $values ) && array_key_exists( 0, $values ) ) {
				$out[ (string) $key ] = maybe_unserialize( $values[0] );
			}
		}
		return $out;
	}

	/** Only the wire-mapped keys (what the REST fallback exposes as `meta_data`). @return array<int, array{key:string,value:mixed}> */
	public static function wire_meta( int $product_id ): array {
		$out = array();
		foreach ( self::meta( $product_id ) as $key => $value ) {
			if ( isset( Vocab::META_KEYS[ $key ] ) ) {
				$out[] = array(
					'key'   => $key,
					'value' => $value,
				);
			}
		}
		return $out;
	}

	/** "Women > Dresses" — lets the category inference see the most specific segment first. */
	private static function term_path( \WP_Term $term, string $taxonomy ): string {
		$names = array( $term->name );
		$guard = 0;
		while ( $term->parent && $guard++ < 10 ) {
			$parent = get_term( $term->parent, $taxonomy );
			if ( ! $parent instanceof \WP_Term ) {
				break;
			}
			array_unshift( $names, $parent->name );
			$term = $parent;
		}
		return implode( ' > ', $names );
	}
}
