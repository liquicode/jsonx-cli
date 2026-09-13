'use strict';

const LIB_ASSERT = require( 'assert' );
const LIB_CHILD_PROCESS = require( 'child_process' );
const LIB_PATH = require( 'path' );
const { describe, it } = require( 'node:test' );

const REPO = LIB_PATH.resolve( __dirname, '..' );
const BIN = LIB_PATH.join( REPO, 'bin', 'jsonx.js' );
const PACKAGE = require( '../package.json' );


//---------------------------------------------------------------------
function run_bin( Argv )
{
	let result = LIB_CHILD_PROCESS.spawnSync( process.execPath, [ BIN ].concat( Argv ), { encoding: 'utf8' } );
	return { Code: result.status, Stdout: result.stdout, Stderr: result.stderr };
}


//---------------------------------------------------------------------
describe( 'The jsonx bin', function ()
{

	it( 'prints help and exits 0 for --help', function ()
	{
		let result = run_bin( [ '--help' ] );
		LIB_ASSERT.strictEqual( result.Code, 0 );
		LIB_ASSERT.ok( result.Stdout.includes( 'Usage: jsonx' ) );
		LIB_ASSERT.strictEqual( result.Stderr, '' );
	} );

	it( 'prints help and exits 0 with no arguments', function ()
	{
		let result = run_bin( [] );
		LIB_ASSERT.strictEqual( result.Code, 0 );
		LIB_ASSERT.ok( result.Stdout.includes( 'Usage: jsonx' ) );
	} );

	it( 'prints the package version for --version', function ()
	{
		let result = run_bin( [ '--version' ] );
		LIB_ASSERT.strictEqual( result.Code, 0 );
		LIB_ASSERT.strictEqual( result.Stdout, PACKAGE.version + '\n' );
	} );

	it( 'refuses an unknown argument on stderr with exit 2', function ()
	{
		let result = run_bin( [ '--nonsense' ] );
		LIB_ASSERT.strictEqual( result.Code, 2 );
		LIB_ASSERT.strictEqual( result.Stdout, '' );
		LIB_ASSERT.ok( result.Stderr.includes( '--nonsense' ) );
	} );

} );


//---------------------------------------------------------------------
describe( 'The library', function ()
{

	it( 'does not run the command line when required', function ()
	{
		let script = 'require( ' + JSON.stringify( LIB_PATH.join( REPO, 'src', 'jsonx-cli.js' ) ) + ' ); console.log( "loaded" );';
		let result = LIB_CHILD_PROCESS.spawnSync( process.execPath, [ '-e', script ], { encoding: 'utf8' } );
		LIB_ASSERT.strictEqual( result.status, 0 );
		LIB_ASSERT.strictEqual( result.stdout, 'loaded\n' );
	} );

	it( 'reaches the same library through import and require', async function ()
	{
		let required = require( '../src/jsonx-cli.js' );
		let imported = await import( 'file://' + LIB_PATH.join( REPO, 'src', 'jsonx-cli.mjs' ).replace( /\\/g, '/' ) );
		LIB_ASSERT.strictEqual( imported.default, required );
		LIB_ASSERT.strictEqual( imported.Version, required.Version );
		LIB_ASSERT.strictEqual( imported.Library, required.Library );
	} );

	it( 'agrees with its declaration and its ESM wrapper', function ()
	{
		let result = require( '../build/types-check.js' ).Check();
		LIB_ASSERT.deepStrictEqual( result.Findings, [] );
	} );

} );
