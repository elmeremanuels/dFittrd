<?php
/**
 * Translation catalogue tool (no gettext or WP-CLI needed, PHP tokenizer only):
 *
 *   php scripts/i18n.php pot     regenerate languages/curtain-woocommerce.pot from the PHP sources
 *   php scripts/i18n.php po      merge the .pot into every languages/*.po (keeps translations, drops
 *                                obsolete entries, adds new ones untranslated)
 *   php scripts/i18n.php mo [dir] compile every languages/*.po to its .mo (what WordPress loads);
 *                                the build passes its staging languages/ folder
 *   php scripts/i18n.php check   exit 1 when the .pot is out of date, a .po misses a translation,
 *                                or a translation changes the printf placeholders
 *
 * Extracted: the literal first argument(s) of __(), _e(), _x(), _n(), esc_html__(), esc_html_e(),
 * esc_attr__(), esc_attr_e() with the curtain-woocommerce domain, plus the plugin header's name
 * and description; a translators comment directly before the call is kept. tests/i18n.test.php
 * runs `check`.
 *
 * @package Curtain
 */

declare(strict_types=1);

const CURTAIN_I18N_DOMAIN = 'curtain-woocommerce';

/** @return string The plugin root. */
function curtain_i18n_root(): string {
	return dirname( __DIR__ );
}

/**
 * Source files in a stable order: the main file, then includes/ alphabetically, then uninstall.php.
 *
 * @return array<int, string> Paths relative to the plugin root.
 */
function curtain_i18n_sources( string $root ): array {
	$files = array( 'curtain.php' );
	$inc   = glob( $root . '/includes/*.php' ) ?: array();
	sort( $inc );
	foreach ( $inc as $f ) {
		$files[] = 'includes/' . basename( $f );
	}
	if ( is_file( $root . '/uninstall.php' ) ) {
		$files[] = 'uninstall.php';
	}
	return $files;
}

/**
 * @return array<string, array{msgctxt:?string,msgid:string,plural:?string,refs:array<int,string>,comments:array<int,string>}>
 *         Keyed by context + msgid, in order of first appearance.
 */
function curtain_i18n_extract( string $root ): array {
	$entries = array();
	$add     = static function ( ?string $ctx, string $msgid, ?string $plural, string $ref, ?string $comment ) use ( &$entries ): void {
		$key = ( null === $ctx ? '' : $ctx . "\x04" ) . $msgid;
		if ( ! isset( $entries[ $key ] ) ) {
			$entries[ $key ] = array(
				'msgctxt'  => $ctx,
				'msgid'    => $msgid,
				'plural'   => $plural,
				'refs'     => array(),
				'comments' => array(),
			);
		}
		if ( ! in_array( $ref, $entries[ $key ]['refs'], true ) ) {
			$entries[ $key ]['refs'][] = $ref;
		}
		if ( null !== $comment && ! in_array( $comment, $entries[ $key ]['comments'], true ) ) {
			$entries[ $key ]['comments'][] = $comment;
		}
	};

	// Plugin header (WordPress translates these from the header, under the plugin's text domain).
	$main = (string) file_get_contents( $root . '/curtain.php' );
	foreach ( array( 'Plugin Name', 'Description' ) as $field ) {
		if ( preg_match( '/^[ \t\/*#@]*' . preg_quote( $field, '/' ) . ':\s*(.+)$/mi', $main, $m ) ) {
			$add( null, trim( $m[1] ), null, 'curtain.php', $field . ' of the plugin' );
		}
	}

	$functions = array(
		'__'          => array( 'msgid' ),
		'_e'          => array( 'msgid' ),
		'esc_html__'  => array( 'msgid' ),
		'esc_html_e'  => array( 'msgid' ),
		'esc_attr__'  => array( 'msgid' ),
		'esc_attr_e'  => array( 'msgid' ),
		'_x'          => array( 'msgid', 'ctx' ),
		'esc_html_x'  => array( 'msgid', 'ctx' ),
		'esc_attr_x'  => array( 'msgid', 'ctx' ),
		'_n'          => array( 'msgid', 'plural', null ),
	);
	foreach ( curtain_i18n_sources( $root ) as $rel ) {
		$tokens = token_get_all( (string) file_get_contents( $root . '/' . $rel ) );
		$n      = count( $tokens );
		for ( $i = 0; $i < $n; $i++ ) {
			$t = $tokens[ $i ];
			if ( ! is_array( $t ) || T_STRING !== $t[0] || ! isset( $functions[ $t[1] ] ) ) {
				continue;
			}
			// Not a method or a function definition.
			$p = $i - 1;
			while ( $p >= 0 && is_array( $tokens[ $p ] ) && T_WHITESPACE === $tokens[ $p ][0] ) {
				--$p;
			}
			if ( $p >= 0 && is_array( $tokens[ $p ] ) && in_array( $tokens[ $p ][0], array( T_OBJECT_OPERATOR, T_DOUBLE_COLON, T_FUNCTION, T_NULLSAFE_OBJECT_OPERATOR ), true ) ) {
				continue;
			}
			$args = curtain_i18n_call_args( $tokens, $i + 1 );
			if ( null === $args ) {
				continue;
			}
			$shape = $functions[ $t[1] ];
			$want  = count( $shape ) + 1; // + the domain.
			if ( count( $args ) < $want ) {
				continue;
			}
			$domain = $args[ $want - 1 ];
			if ( CURTAIN_I18N_DOMAIN !== $domain ) {
				continue;
			}
			$vals = array();
			foreach ( $shape as $k => $role ) {
				if ( null !== $role ) {
					$vals[ $role ] = $args[ $k ];
				}
			}
			if ( ! is_string( $vals['msgid'] ?? null ) || ( array_key_exists( 'plural', $vals ) && ! is_string( $vals['plural'] ) ) || ( array_key_exists( 'ctx', $vals ) && ! is_string( $vals['ctx'] ) ) ) {
				throw new RuntimeException( sprintf( '%s:%d: %s() needs literal strings', $rel, $t[2], $t[1] ) );
			}
			$add( $vals['ctx'] ?? null, $vals['msgid'], $vals['plural'] ?? null, $rel, curtain_i18n_translators_comment( $tokens, $i ) );
		}
	}
	return $entries;
}

/**
 * The call's arguments starting at the token after the function name: a string for a literal
 * (constant-encapsed) argument, false for anything else. Null when no call follows.
 *
 * @param array<int, mixed> $tokens
 * @return array<int, string|false>|null
 */
function curtain_i18n_call_args( array $tokens, int $at ): ?array {
	$n = count( $tokens );
	while ( $at < $n && is_array( $tokens[ $at ] ) && in_array( $tokens[ $at ][0], array( T_WHITESPACE, T_COMMENT ), true ) ) {
		++$at;
	}
	if ( $at >= $n || '(' !== $tokens[ $at ] ) {
		return null;
	}
	$args  = array();
	$depth = 0;
	$cur   = array();
	for ( $i = $at + 1; $i < $n; $i++ ) {
		$t = $tokens[ $i ];
		if ( is_array( $t ) && in_array( $t[0], array( T_WHITESPACE, T_COMMENT, T_DOC_COMMENT ), true ) ) {
			continue;
		}
		if ( in_array( $t, array( '(', '[', '{' ), true ) || ( is_array( $t ) && in_array( $t[0], array( T_CURLY_OPEN, T_DOLLAR_OPEN_CURLY_BRACES ), true ) ) ) {
			++$depth;
		} elseif ( in_array( $t, array( ')', ']', '}' ), true ) ) {
			if ( 0 === $depth ) {
				if ( $cur ) {
					$args[] = curtain_i18n_literal( $cur );
				}
				return $args;
			}
			--$depth;
		} elseif ( ',' === $t && 0 === $depth ) {
			$args[] = curtain_i18n_literal( $cur );
			$cur    = array();
			continue;
		}
		$cur[] = $t;
	}
	return null;
}

/** @param array<int, mixed> $toks @return string|false */
function curtain_i18n_literal( array $toks ) {
	if ( 1 !== count( $toks ) || ! is_array( $toks[0] ) || T_CONSTANT_ENCAPSED_STRING !== $toks[0][0] ) {
		return false;
	}
	$raw = $toks[0][1];
	if ( "'" === $raw[0] ) {
		return str_replace( array( "\\\\", "\\'" ), array( "\\", "'" ), substr( $raw, 1, -1 ) );
	}
	return stripcslashes( substr( $raw, 1, -1 ) );
}

/** A `translators:` comment just before the call (skipping whitespace and an opening `sprintf(`). @param array<int, mixed> $tokens */
function curtain_i18n_translators_comment( array $tokens, int $i ): ?string {
	for ( $p = $i - 1, $seen = 0; $p >= 0 && $seen < 6; $p--, $seen++ ) {
		$t = $tokens[ $p ];
		if ( is_array( $t ) && T_WHITESPACE === $t[0] ) {
			continue;
		}
		if ( is_array( $t ) && in_array( $t[0], array( T_COMMENT, T_DOC_COMMENT ), true ) ) {
			if ( preg_match( '/translators:\s*(.*?)\s*(?:\*\/)?$/s', $t[1], $m ) ) {
				return 'translators: ' . trim( (string) preg_replace( '/\s+/', ' ', $m[1] ) );
			}
			continue;
		}
		return null;
	}
	return null;
}

/** PO string literal (wrapped like gettext does not matter to WordPress; one line keeps diffs small). */
function curtain_i18n_quote( string $s ): string {
	return '"' . str_replace( array( '\\', '"', "\n", "\t" ), array( '\\\\', '\\"', '\\n', '\\t' ), $s ) . '"';
}

/**
 * @param array<string, array{msgctxt:?string,msgid:string,plural:?string,refs:array<int,string>,comments:array<int,string>}> $entries
 * @param array<string, array{str:string,plural_strs:array<int,string>}>|null $translations Null for the .pot.
 */
function curtain_i18n_render( string $header, array $entries, ?array $translations ): string {
	$out = $header . "\n";
	foreach ( $entries as $key => $e ) {
		$out .= "\n";
		foreach ( $e['comments'] as $c ) {
			$out .= '#. ' . $c . "\n";
		}
		$out .= '#: ' . implode( ' ', $e['refs'] ) . "\n";
		if ( null !== $e['msgctxt'] ) {
			$out .= 'msgctxt ' . curtain_i18n_quote( $e['msgctxt'] ) . "\n";
		}
		$out .= 'msgid ' . curtain_i18n_quote( $e['msgid'] ) . "\n";
		$tr   = null === $translations ? null : ( $translations[ $key ] ?? null );
		if ( null !== $e['plural'] ) {
			$out .= 'msgid_plural ' . curtain_i18n_quote( $e['plural'] ) . "\n";
			$out .= 'msgstr[0] ' . curtain_i18n_quote( $tr['plural_strs'][0] ?? '' ) . "\n";
			$out .= 'msgstr[1] ' . curtain_i18n_quote( $tr['plural_strs'][1] ?? '' ) . "\n";
		} else {
			$out .= 'msgstr ' . curtain_i18n_quote( $tr['str'] ?? '' ) . "\n";
		}
	}
	return $out;
}

/**
 * @return array{header:string, entries:array<string, array{msgctxt:?string,msgid:string,plural:?string,str:string,plural_strs:array<int,string>}>}
 */
function curtain_i18n_parse_po( string $file ): array {
	$lines   = file( $file, FILE_IGNORE_NEW_LINES ) ?: array();
	$header  = array();
	$entries = array();
	$cur     = null;
	$field   = null;
	$flush   = static function () use ( &$cur, &$entries ): void {
		if ( null !== $cur && '' !== $cur['msgid'] ) {
			$key             = ( null === $cur['msgctxt'] ? '' : $cur['msgctxt'] . "\x04" ) . $cur['msgid'];
			$entries[ $key ] = $cur;
		}
	};
	$unquote = static function ( string $q ): string {
		return stripcslashes( substr( $q, 1, -1 ) );
	};
	$in_header = true;
	foreach ( $lines as $line ) {
		if ( $in_header ) {
			// The header: everything up to the first empty line after the empty msgid's msgstr.
			if ( '' === trim( $line ) && $header ) {
				$in_header = false;
				continue;
			}
			$header[] = $line;
			continue;
		}
		if ( preg_match( '/^msgctxt (".*")$/', $line, $m ) ) {
			$flush();
			$cur   = array( 'msgctxt' => $unquote( $m[1] ), 'msgid' => '', 'plural' => null, 'str' => '', 'plural_strs' => array() );
			$field = 'msgctxt';
		} elseif ( preg_match( '/^msgid (".*")$/', $line, $m ) ) {
			if ( null === $cur || 'msgctxt' !== $field ) {
				$flush();
				$cur = array( 'msgctxt' => null, 'msgid' => '', 'plural' => null, 'str' => '', 'plural_strs' => array() );
			}
			$cur['msgid'] = $unquote( $m[1] );
			$field        = 'msgid';
		} elseif ( preg_match( '/^msgid_plural (".*")$/', $line, $m ) && null !== $cur ) {
			$cur['plural'] = $unquote( $m[1] );
			$field         = 'plural';
		} elseif ( preg_match( '/^msgstr\[(\d+)\] (".*")$/', $line, $m ) && null !== $cur ) {
			$cur['plural_strs'][ (int) $m[1] ] = $unquote( $m[2] );
			$field                             = 'plural_strs:' . $m[1];
		} elseif ( preg_match( '/^msgstr (".*")$/', $line, $m ) && null !== $cur ) {
			$cur['str'] = $unquote( $m[1] );
			$field      = 'str';
		} elseif ( preg_match( '/^(".*")$/', $line, $m ) && null !== $cur && null !== $field ) {
			if ( str_starts_with( $field, 'plural_strs:' ) ) {
				$cur['plural_strs'][ (int) substr( $field, 12 ) ] .= $unquote( $m[1] );
			} else {
				$cur[ $field ] .= $unquote( $m[1] );
			}
		}
	}
	$flush();
	return array(
		'header'  => implode( "\n", $header ),
		'entries' => $entries,
	);
}

/** printf placeholders of a string, sorted (`%s`, `%d`, `%1$s`, `%%`). @return array<int, string> */
function curtain_i18n_placeholders( string $s ): array {
	preg_match_all( '/%(?:\d+\$)?[-+ 0#]*\d*(?:\.\d+)?[bcdeEfFgGosuxX%]/', $s, $m );
	$p = $m[0];
	sort( $p );
	return $p;
}

function curtain_i18n_pot_header( string $date ): string {
	return implode(
		"\n",
		array(
			'# Copyright (C) 2026 Curtain',
			'# This file is distributed under the GPL-2.0-or-later.',
			'# Generated by scripts/i18n.php from the plugin sources; do not edit by hand.',
			'msgid ""',
			'msgstr ""',
			'"Project-Id-Version: Curtain for WooCommerce 0.1.0\n"',
			'"Report-Msgid-Bugs-To: https://curtain.fit/woocommerce\n"',
			'"POT-Creation-Date: ' . $date . '\n"',
			'"MIME-Version: 1.0\n"',
			'"Content-Type: text/plain; charset=UTF-8\n"',
			'"Content-Transfer-Encoding: 8bit\n"',
			'"PO-Revision-Date: YEAR-MO-DA HO:MI+ZONE\n"',
			'"Last-Translator: FULL NAME <EMAIL@ADDRESS>\n"',
			'"Language-Team: LANGUAGE <LL@li.org>\n"',
			'"X-Domain: curtain-woocommerce\n"',
		)
	);
}

/** @return array<int, string> Problems; empty when the catalogue is complete and in sync. */
function curtain_i18n_check( string $root ): array {
	$problems = array();
	$entries  = curtain_i18n_extract( $root );
	$pot      = curtain_i18n_parse_po( $root . '/languages/curtain-woocommerce.pot' );
	foreach ( array_diff( array_keys( $entries ), array_keys( $pot['entries'] ) ) as $k ) {
		$problems[] = '.pot is missing: ' . str_replace( "\x04", ' | ', $k );
	}
	foreach ( array_diff( array_keys( $pot['entries'] ), array_keys( $entries ) ) as $k ) {
		$problems[] = '.pot has an obsolete entry: ' . str_replace( "\x04", ' | ', $k );
	}
	foreach ( glob( $root . '/languages/*.po' ) ?: array() as $po_file ) {
		$name = basename( $po_file );
		$po   = curtain_i18n_parse_po( $po_file );
		foreach ( $entries as $k => $e ) {
			$tr = $po['entries'][ $k ] ?? null;
			if ( null === $tr ) {
				$problems[] = "$name is missing: " . $e['msgid'];
				continue;
			}
			$strs = null === $e['plural'] ? array( $tr['str'] ) : array( $tr['plural_strs'][0] ?? '', $tr['plural_strs'][1] ?? '' );
			foreach ( $strs as $idx => $s ) {
				if ( '' === $s ) {
					$problems[] = "$name has no translation for: " . $e['msgid'];
					continue;
				}
				$src = 1 === $idx ? (string) $e['plural'] : $e['msgid'];
				if ( curtain_i18n_placeholders( $src ) !== curtain_i18n_placeholders( $s ) ) {
					$problems[] = "$name changes the placeholders of: " . $e['msgid'];
				}
			}
		}
		foreach ( array_diff( array_keys( $po['entries'] ), array_keys( $entries ) ) as $k ) {
			$problems[] = "$name has an obsolete entry: " . str_replace( "\x04", ' | ', $k );
		}
	}
	return $problems;
}

/** Writes a little-endian GNU .mo file (what load_plugin_textdomain reads). */
function curtain_i18n_compile_mo( string $po_file, string $mo_file ): int {
	$po       = curtain_i18n_parse_po( $po_file );
	$messages = array();
	// The header entry (empty msgid) carries Plural-Forms.
	if ( preg_match_all( '/^"(.*)"$/m', $po['header'], $m ) ) {
		$messages[''] = stripcslashes( implode( '', $m[1] ) );
	}
	foreach ( $po['entries'] as $k => $e ) {
		if ( null !== $e['plural'] ) {
			if ( '' === ( $e['plural_strs'][0] ?? '' ) ) {
				continue;
			}
			ksort( $e['plural_strs'] );
			$messages[ $k . "\0" . $e['plural'] ] = implode( "\0", $e['plural_strs'] );
		} elseif ( '' !== $e['str'] ) {
			$messages[ $k ] = $e['str'];
		}
	}
	ksort( $messages, SORT_STRING );
	$n        = count( $messages );
	$orig_at  = 28;
	$trans_at = $orig_at + 8 * $n;
	$data_at  = $trans_at + 8 * $n;
	$orig_tbl = '';
	$tran_tbl = '';
	$data     = '';
	foreach ( array_keys( $messages ) as $id ) {
		$id        = (string) $id;
		$orig_tbl .= pack( 'VV', strlen( $id ), $data_at + strlen( $data ) );
		$data     .= $id . "\0";
	}
	foreach ( $messages as $str ) {
		$tran_tbl .= pack( 'VV', strlen( $str ), $data_at + strlen( $data ) );
		$data     .= $str . "\0";
	}
	$bin = pack( 'VVVVVVV', 0x950412de, 0, $n, $orig_at, $trans_at, 0, 0 ) . $orig_tbl . $tran_tbl . $data;
	file_put_contents( $mo_file, $bin );
	return $n;
}

if ( PHP_SAPI === 'cli' && isset( $argv ) && realpath( (string) $argv[0] ) === __FILE__ ) {
	$root = curtain_i18n_root();
	$cmd  = $argv[1] ?? 'check';
	if ( 'pot' === $cmd ) {
		$entries = curtain_i18n_extract( $root );
		file_put_contents( $root . '/languages/curtain-woocommerce.pot', curtain_i18n_render( curtain_i18n_pot_header( gmdate( 'Y-m-d H:i+0000' ) ), $entries, null ) );
		echo 'wrote languages/curtain-woocommerce.pot (' . count( $entries ) . " strings)\n";
	} elseif ( 'po' === $cmd ) {
		$entries = curtain_i18n_extract( $root );
		foreach ( glob( $root . '/languages/*.po' ) ?: array() as $po_file ) {
			$po    = curtain_i18n_parse_po( $po_file );
			$text  = curtain_i18n_render( $po['header'], $entries, $po['entries'] );
			$empty = 0;
			foreach ( $entries as $k => $e ) {
				$t      = $po['entries'][ $k ] ?? null;
				$empty += ( null === $t || ( null === $e['plural'] ? '' === $t['str'] : '' === ( $t['plural_strs'][0] ?? '' ) ) ) ? 1 : 0;
			}
			file_put_contents( $po_file, $text );
			echo 'merged ' . basename( $po_file ) . ' (' . count( $entries ) . " strings, $empty untranslated)\n";
		}
	} elseif ( 'mo' === $cmd ) {
		// Optional output directory (the build writes into its staging copy, so no .mo is committed).
		$out_dir = isset( $argv[2] ) ? rtrim( $argv[2], '/' ) : $root . '/languages';
		foreach ( glob( $root . '/languages/*.po' ) ?: array() as $po_file ) {
			$mo = $out_dir . '/' . basename( $po_file, '.po' ) . '.mo';
			echo 'wrote ' . $mo . ' (' . curtain_i18n_compile_mo( $po_file, $mo ) . " messages)\n";
		}
	} elseif ( 'check' === $cmd ) {
		$problems = curtain_i18n_check( $root );
		foreach ( $problems as $p ) {
			fwrite( STDERR, $p . "\n" );
		}
		echo $problems ? count( $problems ) . " translation problem(s)\n" : "translations complete\n";
		exit( $problems ? 1 : 0 );
	} else {
		fwrite( STDERR, "usage: php scripts/i18n.php pot|po|mo|check\n" );
		exit( 2 );
	}
}
