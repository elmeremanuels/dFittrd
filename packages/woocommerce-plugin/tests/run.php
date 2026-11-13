<?php
/**
 * Dependency-free test runner: `php tests/run.php [filter]`.
 * Every tests/*.test.php registers cases with test( 'name', fn() ) and uses the assert_* helpers.
 *
 * @package Curtain\Tests
 */

declare(strict_types=1);

error_reporting( E_ALL );
ini_set( 'display_errors', '1' );

require __DIR__ . '/shims.php';
require dirname( __DIR__ ) . '/includes/autoload.php';

final class Curtain_Test_Failure extends \RuntimeException {}

/** @var array<int, array{name:string,fn:callable,file:string}> */
$curtain_tests = array();

function test( string $name, callable $fn ): void {
	global $curtain_tests, $curtain_current_file;
	$curtain_tests[] = array(
		'name' => $name,
		'fn'   => $fn,
		'file' => $curtain_current_file ?? '',
	);
}

function assert_true( $cond, string $msg = 'expected true' ): void {
	if ( true !== $cond ) {
		throw new Curtain_Test_Failure( $msg );
	}
}
function assert_false( $cond, string $msg = 'expected false' ): void {
	if ( false !== $cond ) {
		throw new Curtain_Test_Failure( $msg );
	}
}
function assert_same( $expected, $actual, string $msg = '' ): void {
	if ( $expected !== $actual ) {
		throw new Curtain_Test_Failure( ( '' !== $msg ? $msg . ': ' : '' ) . 'expected ' . var_export( $expected, true ) . ', got ' . var_export( $actual, true ) );
	}
}
function assert_contains( string $needle, string $haystack, string $msg = '' ): void {
	if ( ! str_contains( $haystack, $needle ) ) {
		throw new Curtain_Test_Failure( ( '' !== $msg ? $msg . ': ' : '' ) . "expected to find '$needle' in " . var_export( $haystack, true ) );
	}
}
/** Canonical (sorted-key) JSON equality with a readable diff. */
function assert_json_equal( $expected, $actual, string $msg = '' ): void {
	$a = curtain_canonical( $expected );
	$b = curtain_canonical( $actual );
	if ( $a !== $b ) {
		$diff = curtain_json_diff( $expected, $actual );
		throw new Curtain_Test_Failure( ( '' !== $msg ? $msg . ': ' : '' ) . "JSON differs:\n" . $diff );
	}
}
function curtain_canonical( $v ): string {
	return (string) json_encode( curtain_sort( $v ), JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE );
}
function curtain_sort( $v ) {
	if ( ! is_array( $v ) ) {
		return $v;
	}
	if ( array_is_list( $v ) ) {
		return array_map( 'curtain_sort', $v );
	}
	ksort( $v, SORT_STRING );
	$o = array();
	foreach ( $v as $k => $x ) {
		$o[ $k ] = curtain_sort( $x );
	}
	return $o;
}
function curtain_json_diff( $expected, $actual, string $path = '' ): string {
	$out = '';
	if ( is_array( $expected ) && is_array( $actual ) ) {
		foreach ( array_unique( array_merge( array_keys( $expected ), array_keys( $actual ) ) ) as $k ) {
			$p = '' === $path ? (string) $k : $path . '.' . $k;
			if ( ! array_key_exists( $k, $expected ) ) {
				$out .= "  + $p = " . json_encode( $actual[ $k ] ) . "\n";
			} elseif ( ! array_key_exists( $k, $actual ) ) {
				$out .= "  - $p = " . json_encode( $expected[ $k ] ) . "\n";
			} else {
				$out .= curtain_json_diff( $expected[ $k ], $actual[ $k ], $p );
			}
		}
		return $out;
	}
	if ( curtain_canonical( $expected ) !== curtain_canonical( $actual ) ) {
		$out .= "  ~ $path: expected " . json_encode( $expected ) . ', got ' . json_encode( $actual ) . "\n";
	}
	return $out;
}

/** Path of a bundled schema, falling back to the schema package's dist in the monorepo. */
function curtain_schema_path( string $name ): string {
	$local = dirname( __DIR__ ) . '/assets/' . $name;
	if ( is_readable( $local ) ) {
		return $local;
	}
	return dirname( __DIR__, 2 ) . '/schema/dist/' . $name;
}

$filter = $argv[1] ?? '';
foreach ( glob( __DIR__ . '/*.test.php' ) ?: array() as $file ) {
	$curtain_current_file = basename( $file );
	require $file;
}

$passed = 0;
$failed = 0;
$start  = microtime( true );
foreach ( $curtain_tests as $t ) {
	if ( '' !== $filter && ! str_contains( $t['name'], $filter ) && ! str_contains( $t['file'], $filter ) ) {
		continue;
	}
	Curtain_Test_State::reset();
	try {
		( $t['fn'] )();
		++$passed;
		echo "  ✓ {$t['file']} › {$t['name']}\n";
	} catch ( \Throwable $e ) {
		++$failed;
		echo "  ✗ {$t['file']} › {$t['name']}\n      " . get_class( $e ) . ': ' . str_replace( "\n", "\n      ", $e->getMessage() ) . "\n";
		if ( ! $e instanceof Curtain_Test_Failure ) {
			echo '      at ' . $e->getFile() . ':' . $e->getLine() . "\n";
		}
	}
}
printf( "\n%d passed, %d failed (%.0f ms)\n", $passed, $failed, ( microtime( true ) - $start ) * 1000 );
exit( $failed > 0 ? 1 : 0 );
