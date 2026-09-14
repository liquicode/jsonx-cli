'use strict';

const LIB_ASSERT = require( 'assert' );
const LIB_CHILD_PROCESS = require( 'child_process' );
const LIB_FS = require( 'fs' );
const LIB_OS = require( 'os' );
const LIB_PATH = require( 'path' );
const { describe, it, before, after } = require( 'node:test' );

const Spec = require( './fixtures/Spec.js' );

const BIN = LIB_PATH.resolve( __dirname, '..', 'bin', 'jsonx.js' );


//---------------------------------------------------------------------
function run( Argv, Cwd )
{
	let env = Object.assign( {}, process.env );
	delete env.JSONX_FILE;
	let result = LIB_CHILD_PROCESS.spawnSync( process.execPath, [ BIN ].concat( Argv ), { cwd: Cwd, env: env, encoding: 'utf8' } );
	return { Code: result.status, Stdout: result.stdout, Stderr: result.stderr };
}


//---------------------------------------------------------------------
describe( 'jsonx explain, and the data alias', function ()
{

	let root = null;

	before( function ()
	{
		root = LIB_FS.mkdtempSync( LIB_PATH.join( LIB_OS.tmpdir(), 'jsonx-explain-' ) );
		LIB_FS.writeFileSync( LIB_PATH.join( root, 'observatory.jsonx' ), JSON.stringify( Spec.AppendixB(), null, '\t' ) );
	} );

	after( function ()
	{
		LIB_FS.rmSync( root, { recursive: true, force: true } );
	} );

	it( 'writes the explanation as JSON, and its lines as the report', function ()
	{
		let result = run( [ 'explain', 'Drop the cancelled bookings' ], root );
		LIB_ASSERT.strictEqual( result.Code, 0, result.Stderr );
		LIB_ASSERT.deepStrictEqual( JSON.parse( result.Stdout ), {
			Name: 'Drop the cancelled bookings',
			Kind: 'Delete',
			Lines: [ 'Remove every document from "Bookings" where Status is "cancelled".' ],
		} );
		LIB_ASSERT.strictEqual( result.Stderr, 'Remove every document from "Bookings" where Status is "cancelled".\n' );
	} );

	it( 'writes no report with --quiet', function ()
	{
		let result = run( [ 'explain', 'Bookings', '--quiet' ], root );
		LIB_ASSERT.strictEqual( result.Code, 0 );
		LIB_ASSERT.strictEqual( result.Stderr, '' );
		LIB_ASSERT.strictEqual( JSON.parse( result.Stdout ).Kind, 'DataSource' );
	} );

	it( 'exits 2 for a name no entry carries', function ()
	{
		let result = run( [ 'explain', 'Nobody' ], root );
		LIB_ASSERT.strictEqual( result.Code, 2 );
		LIB_ASSERT.match( result.Stderr, /No entry is named \[Nobody\]/ );
		LIB_ASSERT.strictEqual( result.Stdout, '' );
	} );

	it( 'answers jsonx data exactly as jsonx datasource', function ()
	{
		let by_name = run( [ 'datasource', 'list' ], root );
		let by_alias = run( [ 'data', 'list' ], root );
		LIB_ASSERT.strictEqual( by_alias.Code, 0, by_alias.Stderr );
		LIB_ASSERT.strictEqual( by_alias.Stdout, by_name.Stdout );
		LIB_ASSERT.strictEqual( JSON.parse( by_alias.Stdout ).length, 4 );

		let help = run( [ '--help' ], root );
		LIB_ASSERT.match( help.Stdout, /\n  datasource, data\s/ );
		LIB_ASSERT.match( help.Stdout, /\n  explain\s/ );
	} );

} );
