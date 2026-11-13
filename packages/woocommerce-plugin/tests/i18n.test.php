<?php
/**
 * The translation catalogue (scripts/i18n.php): the .pot lists every translatable string of the
 * plugin, nl_NL translates all of them with the same printf placeholders, and the .mo the build
 * compiles reads back to the same translations.
 *
 * @package Curtain\Tests
 */

declare(strict_types=1);

require_once dirname( __DIR__ ) . '/scripts/i18n.php';

test(
	'the .pot is in sync with the sources and nl_NL translates every string',
	static function (): void {
		$problems = curtain_i18n_check( dirname( __DIR__ ) );
		assert_same( array(), $problems, 'run `php scripts/i18n.php pot && php scripts/i18n.php po` and translate' );
	}
);

test(
	'extraction finds the strings added since the first catalogue, with translators comments',
	static function (): void {
		$entries = curtain_i18n_extract( dirname( __DIR__ ) );
		$ids     = array_column( $entries, 'msgid' );
		foreach ( array(
			'Could not connect: the payment page address was not a Stripe Checkout page.',
			'Curtain could not confirm that this site asked for the connection. Make sure the site is reachable from the internet (not a local or private address) and that no security plugin blocks /wp-json/curtain/v1/verify, then click "Finish connection".',
			'Curtain for WooCommerce',
		) as $id ) {
			assert_true( in_array( $id, $ids, true ), "missing: $id" );
		}
		$plural = $entries['%d pending job'];
		assert_same( '%d pending jobs', $plural['plural'] );
		assert_same( array( 'translators: %d: number of jobs' ), $plural['comments'] );
	}
);

test(
	'the two connect errors have Dutch translations',
	static function (): void {
		$po = curtain_i18n_parse_po( dirname( __DIR__ ) . '/languages/curtain-woocommerce-nl_NL.po' );
		assert_contains( 'Stripe Checkout', $po['entries']['Could not connect: the payment page address was not a Stripe Checkout page.']['str'] );
		$verify = 'Curtain could not confirm that this site asked for the connection. Make sure the site is reachable from the internet (not a local or private address) and that no security plugin blocks /wp-json/curtain/v1/verify, then click "Finish connection".';
		assert_contains( '/wp-json/curtain/v1/verify', $po['entries'][ $verify ]['str'] );
		assert_contains( 'Koppeling afronden', $po['entries'][ $verify ]['str'], 'button name as translated elsewhere' );
	}
);

test(
	'placeholders are compared per printf conversion',
	static function (): void {
		assert_same( array( '%1$s', '%2$s' ), curtain_i18n_placeholders( 'Key stored with %1$s · job queue: %2$s' ) );
		assert_same( array( '%%', '%d' ), curtain_i18n_placeholders( 'completeness %d%%' ) );
		assert_same( array(), curtain_i18n_placeholders( 'Stretch % *' ), 'a literal percent sign is not a conversion' );
	}
);

test(
	'the compiled .mo reads back to the nl_NL translations',
	static function (): void {
		$dir = sys_get_temp_dir() . '/curtain-mo-' . bin2hex( random_bytes( 4 ) );
		mkdir( $dir );
		$mo = $dir . '/nl.mo';
		$n  = curtain_i18n_compile_mo( dirname( __DIR__ ) . '/languages/curtain-woocommerce-nl_NL.po', $mo );
		$bin = (string) file_get_contents( $mo );
		unlink( $mo );
		rmdir( $dir );
		$h = unpack( 'Vmagic/Vrev/Vn/Vorig/Vtrans', $bin );
		assert_same( 0x950412de, $h['magic'] );
		assert_same( $n, $h['n'] );
		$read = static function ( int $table, int $i ) use ( $bin ): string {
			$e = unpack( 'Vlen/Voff', substr( $bin, $table + 8 * $i, 8 ) );
			return substr( $bin, $e['off'], $e['len'] );
		};
		$map = array();
		for ( $i = 0; $i < $n; $i++ ) {
			$map[ $read( $h['orig'], $i ) ] = $read( $h['trans'], $i );
		}
		$keys = array_keys( $map );
		$sorted = $keys;
		sort( $sorted, SORT_STRING );
		assert_same( $sorted, $keys, 'original strings sorted (binary search in the reader)' );
		assert_contains( 'Plural-Forms: nplurals=2; plural=(n != 1);', $map[''] );
		assert_same( 'Koppeling afronden', $map['Finish connection'] );
		assert_same( "%d taak in de wachtrij\0%d taken in de wachtrij", $map["%d pending job\0%d pending jobs"] );
	}
);
