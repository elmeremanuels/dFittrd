<?php
/**
 * The translation catalogue (scripts/i18n.php): the .pot lists every translatable string of the
 * plugin. DECISIONS.md D21: English only for now, so no .po is shipped; the pack seam (a .po in
 * languages/ is checked against the .pot and compiled to the .mo WordPress loads) is proven with
 * a test-only pack.
 *
 * @package Curtain\Tests
 */

declare(strict_types=1);

require_once dirname( __DIR__ ) . '/scripts/i18n.php';

test(
	'the .pot is in sync with the sources, and no translation is shipped (D21)',
	static function (): void {
		$problems = curtain_i18n_check( dirname( __DIR__ ) );
		assert_same( array(), $problems, 'run `php scripts/i18n.php pot`' );
		$shipped = array_map( 'basename', glob( dirname( __DIR__ ) . '/languages/*' ) ?: array() );
		assert_same( array( 'curtain-woocommerce.pot' ), $shipped, 'languages/ holds the English template only; drafts live in translation-packs/' );
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
	'placeholders are compared per printf conversion',
	static function (): void {
		assert_same( array( '%1$s', '%2$s' ), curtain_i18n_placeholders( 'Key stored with %1$s · job queue: %2$s' ) );
		assert_same( array( '%%', '%d' ), curtain_i18n_placeholders( 'completeness %d%%' ) );
		assert_same( array(), curtain_i18n_placeholders( 'Stretch % *' ), 'a literal percent sign is not a conversion' );
	}
);

/** A plugin folder with the real .pot and a complete test-only pack (xx_XX) in languages/. */
function curtain_test_fake_pack_root(): string {
	$real = dirname( __DIR__ );
	$root = sys_get_temp_dir() . '/curtain-pack-' . bin2hex( random_bytes( 4 ) );
	mkdir( $root . '/languages', 0777, true );
	symlink( $real . '/curtain.php', $root . '/curtain.php' );
	symlink( $real . '/uninstall.php', $root . '/uninstall.php' );
	symlink( $real . '/includes', $root . '/includes' );
	copy( $real . '/languages/curtain-woocommerce.pot', $root . '/languages/curtain-woocommerce.pot' );
	$entries = curtain_i18n_extract( $root );
	foreach ( $entries as $k => $e ) {
		$entries[ $k ]['str']         = '[xx] ' . $e['msgid'];
		$entries[ $k ]['plural_strs'] = null === $e['plural'] ? array() : array( '[xx] ' . $e['msgid'], '[xx] ' . $e['plural'] );
	}
	// The pack names its own language tag; the SDK and the overlay are asked for it.
	$entries[ "language tag of this translation\x04en" ]['str'] = 'xx-XX';
	$header = implode( "\n", array( 'msgid ""', 'msgstr ""', '"Content-Type: text/plain; charset=UTF-8\n"', '"Language: xx_XX\n"', '"Plural-Forms: nplurals=2; plural=(n != 1);\n"' ) );
	file_put_contents( $root . '/languages/curtain-woocommerce-xx_XX.po', curtain_i18n_render( $header, $entries, $entries ) );
	return $root;
}

function curtain_test_remove_pack_root( string $root ): void {
	foreach ( array( 'curtain.php', 'uninstall.php', 'includes' ) as $link ) {
		unlink( $root . '/' . $link );
	}
	array_map( 'unlink', glob( $root . '/languages/*' ) ?: array() );
	rmdir( $root . '/languages' );
	rmdir( $root );
}

test(
	'pack seam: a .po added to languages/ is checked against the sources, and an incomplete one fails',
	static function (): void {
		$root = curtain_test_fake_pack_root();
		$po   = $root . '/languages/curtain-woocommerce-xx_XX.po';
		assert_same( array(), curtain_i18n_check( $root ), 'a complete pack passes' );
		$text = (string) file_get_contents( $po );
		file_put_contents( $po, str_replace( 'msgstr "[xx] Finish connection"', 'msgstr ""', $text ) );
		$problems = curtain_i18n_check( $root );
		curtain_test_remove_pack_root( $root );
		assert_same( array( 'curtain-woocommerce-xx_XX.po has no translation for: Finish connection' ), $problems );
		$root = curtain_test_fake_pack_root();
		$po   = $root . '/languages/curtain-woocommerce-xx_XX.po';
		file_put_contents( $po, str_replace( 'msgstr "xx-XX"', 'msgstr "nl"', (string) file_get_contents( $po ) ) );
		$problems = curtain_i18n_check( $root );
		curtain_test_remove_pack_root( $root );
		assert_same( array( 'curtain-woocommerce-xx_XX.po names the language tag "nl", which is not the language of the file' ), $problems );
	}
);

test(
	'pack seam: the compiled .mo reads back to the pack\'s translations',
	static function (): void {
		$root = curtain_test_fake_pack_root();
		$mo   = $root . '/languages/xx.mo';
		$n    = curtain_i18n_compile_mo( $root . '/languages/curtain-woocommerce-xx_XX.po', $mo );
		$bin  = (string) file_get_contents( $mo );
		curtain_test_remove_pack_root( $root );
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
		assert_same( '[xx] Finish connection', $map['Finish connection'] );
		assert_same( "[xx] %d pending job\0[xx] %d pending jobs", $map["%d pending job\0%d pending jobs"] );
	}
);
