<?php
/**
 * "Get set up" on the settings page (class-setup.php): five steps that tick themselves from this site's
 * own data; the words are checked against @curtain/schema by packages/schema/src/merchantSetup.test.ts.
 *
 * @package Curtain\Tests
 */

declare(strict_types=1);

use Curtain\Setup;

require_once __DIR__ . '/setup-shims.php';

$curtain_setup_done = static fn( string $state ): array => array_map( static fn( array $s ): bool => $s['done'], Setup::steps( Setup::facts() ) );

test( 'a fresh install: nothing done, connect first, nothing leaves the site', function () use ( $curtain_setup_done ) {
	curtain_setup_state( 'new' );
	assert_same( array( false, false, false, false, false ), $curtain_setup_done( 'new' ) );
	assert_same( 0, count( Curtain_Test_State::$requests ), 'no request' );
} );

test( 'each step ticks itself from the products and the settings, in order', function () use ( $curtain_setup_done ) {
	curtain_setup_state( 'connected' );
	assert_same( array( true, false, false, false, false ), $curtain_setup_done( 'c' ) );
	curtain_setup_state( 'chart' );
	assert_same( array( true, true, false, false, false ), $curtain_setup_done( 'c' ) );
	$steps = Setup::steps( Setup::facts() );
	assert_same( '2 products have a size chart.', $steps[1]['detail'] );
	assert_true( str_contains( $steps[2]['link'], 'post=4511' ), 'measure opens the skirt with a chart' );
	curtain_setup_state( 'measured' );
	assert_same( array( true, true, true, false, false ), $curtain_setup_done( 'c' ) );
	curtain_setup_state( 'button' );
	assert_same( array( true, true, true, true, false ), $curtain_setup_done( 'c' ) );
	$steps = Setup::steps( Setup::facts() );
	assert_same( 'https://shop.example/product/p4511/', $steps[4]['link'], 'the phone link is the measured skirt' );
	curtain_setup_state( 'done' );
	assert_same( array( true, true, true, true, true ), $curtain_setup_done( 'c' ) );
} );

test( 'the box shows the next step and hides itself once all is done', function () {
	curtain_setup_state( 'chart' );
	ob_start();
	Setup::render_box();
	$html = (string) ob_get_clean();
	assert_true( str_contains( $html, '2 of 5 done' ), 'progress' );
	assert_true( (bool) preg_match( '/data-step="measure"[^>]*aria-current="step"/', $html ), 'measure is the current step' );
	assert_true( str_contains( $html, 'It works on my phone' ), 'phone confirm button' );
	curtain_setup_state( 'done' );
	ob_start();
	Setup::render_box();
	$html = (string) ob_get_clean();
	assert_true( str_contains( $html, 'All done.' ) && ! str_contains( $html, '<ol' ), 'collapsed when done' );
} );
