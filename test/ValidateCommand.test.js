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
function run( Argv, Cwd, Env )
{
	let env = Object.assign( {}, process.env, Env || {} );
	delete env.JSONX_FILE;
	if ( Env && typeof Env.JSONX_FILE === 'string' ) { env.JSONX_FILE = Env.JSONX_FILE; }
	let result = LIB_CHILD_PROCESS.spawnSync( process.execPath, [ BIN ].concat( Argv ), { cwd: Cwd, env: env, encoding: 'utf8' } );
	return { Code: result.status, Stdout: result.stdout, Stderr: result.stderr };
}

function write( Directory, Name, Document )
{
	let path = LIB_PATH.join( Directory, Name );
	LIB_FS.writeFileSync( path, JSON.stringify( Document, null, '\t' ) );
	return path;
}


//---------------------------------------------------------------------
describe( 'jsonx validate', function ()
{

	let root = null;
	let good = null;
	let broken = null;
	let warned = null;

	before( function ()
	{
		root = LIB_FS.mkdtempSync( LIB_PATH.join( LIB_OS.tmpdir(), 'jsonx-validate-' ) );

		good = LIB_PATH.join( root, 'good' );
		LIB_FS.mkdirSync( good );
		write( good, 'observatory.jsonx', Spec.AppendixB() );

		broken = LIB_PATH.join( root, 'broken' );
		LIB_FS.mkdirSync( broken );
		let bad = Spec.AppendixB();
		bad.Objects[ 3 ].Criteria = [];
		write( broken, 'observatory.jsonx', bad );
		LIB_FS.writeFileSync( LIB_PATH.join( broken, 'not-json.jsonx' ), '{ "Objects": [], }' );

		warned = LIB_PATH.join( root, 'warned' );
		LIB_FS.mkdirSync( warned );
		let empty_update = Spec.AppendixB();
		empty_update.Objects[ 2 ].Update = {};
		write( warned, 'observatory.jsonx', empty_update );
	} );

	after( function ()
	{
		LIB_FS.rmSync( root, { recursive: true, force: true } );
	} );

	it( 'finds the one .jsonx file, prints [] and a summary, and exits 0', function ()
	{
		let result = run( [ 'validate' ], good );
		LIB_ASSERT.strictEqual( result.Code, 0 );
		LIB_ASSERT.strictEqual( result.Stdout, '[]\n' );
		LIB_ASSERT.ok( result.Stderr.endsWith( 'observatory.jsonx: 0 errors, 0 warnings, 0 notes\n' ), result.Stderr );
	} );

	it( 'names the file by its file name alone in a report, and by its full path with --report-paths', function ()
	{
		let plain = run( [ 'validate' ], good );
		LIB_ASSERT.strictEqual( plain.Stderr, 'observatory.jsonx: 0 errors, 0 warnings, 0 notes\n' );
		LIB_ASSERT.ok( !plain.Stderr.includes( good ), plain.Stderr );

		let full = run( [ 'validate', '--report-paths' ], good );
		LIB_ASSERT.strictEqual( full.Stderr, LIB_PATH.join( good, 'observatory.jsonx' ) + ': 0 errors, 0 warnings, 0 notes\n' );

		let missing = run( [ 'validate', 'No such entry' ], good );
		LIB_ASSERT.strictEqual( missing.Stderr, 'No entry is named [No such entry] in observatory.jsonx.\n' );
	} );

	it( 'exits 3 on an error, with the finding on stdout and a block on stderr', function ()
	{
		let result = run( [ 'validate', '--file', 'observatory.jsonx' ], broken );
		LIB_ASSERT.strictEqual( result.Code, 3 );
		let findings = JSON.parse( result.Stdout );
		LIB_ASSERT.strictEqual( findings[ 0 ].Path, 'Objects.3.Criteria' );
		LIB_ASSERT.ok( result.Stderr.includes( 'error   Objects.3.Criteria\n' ) );
	} );

	it( 'reports a file which is not JSON as a finding, exit 3', function ()
	{
		let result = run( [ 'validate', '-f', 'not-json.jsonx' ], broken );
		LIB_ASSERT.strictEqual( result.Code, 3 );
		LIB_ASSERT.ok( /not valid JSON at line 1, column \d+/.test( JSON.parse( result.Stdout )[ 0 ].Message ) );
	} );

	it( 'passes a warning, and exits 3 on it with --strict', function ()
	{
		LIB_ASSERT.strictEqual( run( [ 'validate' ], warned ).Code, 0 );
		LIB_ASSERT.strictEqual( run( [ 'validate', '--strict' ], warned ).Code, 3 );
	} );

	it( 'scopes to one entry, and exits 2 for a name nothing carries', function ()
	{
		let scoped = run( [ 'validate', 'Drop the cancelled bookings', '-f', 'observatory.jsonx' ], broken );
		LIB_ASSERT.strictEqual( scoped.Code, 3 );
		LIB_ASSERT.strictEqual( JSON.parse( scoped.Stdout ).length, 1 );

		let missing = run( [ 'validate', 'Nobody' ], good );
		LIB_ASSERT.strictEqual( missing.Code, 2 );
		LIB_ASSERT.ok( missing.Stderr.includes( 'No entry is named [Nobody]' ) );
	} );

	it( 'exits 2 when no file can be chosen, and 1 when the chosen file cannot be read', function ()
	{
		let several = run( [ 'validate' ], broken );
		LIB_ASSERT.strictEqual( several.Code, 2 );
		LIB_ASSERT.ok( several.Stderr.includes( 'holds 2 .jsonx files' ) );

		let gone = run( [ 'validate', '--file', 'gone.jsonx' ], good );
		LIB_ASSERT.strictEqual( gone.Code, 1 );
		LIB_ASSERT.ok( gone.Stderr.includes( 'Cannot read the jsonx file' ) );
	} );

	it( 'takes JSONX_FILE when --file is absent', function ()
	{
		let result = run( [ 'validate' ], root, { JSONX_FILE: LIB_PATH.join( 'broken', 'observatory.jsonx' ) } );
		LIB_ASSERT.strictEqual( result.Code, 3 );
	} );

	it( 'writes nothing to stderr with --quiet, and nothing to stdout for an empty jsonl result', function ()
	{
		let result = run( [ 'validate', '--quiet', '--output', 'jsonl' ], good );
		LIB_ASSERT.strictEqual( result.Code, 0 );
		LIB_ASSERT.strictEqual( result.Stdout, '' );
		LIB_ASSERT.strictEqual( result.Stderr, '' );
	} );

	it( 'runs through --input-json', function ()
	{
		let call = LIB_PATH.join( root, 'call.json' );
		LIB_FS.writeFileSync( call, JSON.stringify( { Command: 'validate', file: LIB_PATH.join( 'broken', 'observatory.jsonx' ), quiet: true } ) );
		let result = run( [ '--input-json', call ], root );
		LIB_ASSERT.strictEqual( result.Code, 3 );
		LIB_ASSERT.strictEqual( result.Stderr, '' );
	} );

} );
