'use strict';

const LIB_ASSERT = require( 'assert' );
const LIB_CHILD_PROCESS = require( 'child_process' );
const LIB_FS = require( 'fs' );
const LIB_OS = require( 'os' );
const LIB_PATH = require( 'path' );
const { describe, it, beforeEach, afterEach } = require( 'node:test' );

const BIN = LIB_PATH.resolve( __dirname, '..', 'bin', 'jsonx.js' );


//---------------------------------------------------------------------
// A file whose Items live in a jsonfile store beside it, so what one invocation writes the next
// one reads.

const FILE = {
	DataSources: [
		{ Name: 'Items', AdapterName: 'jsonstor-jsonfile', Settings: { Path: 'items.json' } },
		{ Name: 'Copies', AdapterName: 'jsonstor-jsonfile', Settings: { Path: 'copies.json' } },
	],
	Objects: [
		{ Kind: 'Query', Name: 'Every copy', DataSource: 'Copies', Criteria: {} },
	],
};


//---------------------------------------------------------------------
describe( 'jsonx datasource <storage verb>', function ()
{

	let root = null;

	function run( Argv )
	{
		let env = Object.assign( {}, process.env );
		delete env.JSONX_FILE;
		let result = LIB_CHILD_PROCESS.spawnSync( process.execPath, [ BIN ].concat( Argv ), { cwd: root, env: env, encoding: 'utf8' } );
		return { Code: result.status, Stdout: result.stdout, Stderr: result.stderr };
	}

	function file_text()
	{
		return LIB_FS.readFileSync( LIB_PATH.join( root, 'items.jsonx' ), 'utf8' );
	}

	function count_items()
	{
		let result = run( [ 'data', 'count', 'Items', '--quiet' ] );
		LIB_ASSERT.strictEqual( result.Code, 0, result.Stderr );
		return JSON.parse( result.Stdout );
	}

	beforeEach( function ()
	{
		root = LIB_FS.mkdtempSync( LIB_PATH.join( LIB_OS.tmpdir(), 'jsonx-storage-' ) );
		LIB_FS.writeFileSync( LIB_PATH.join( root, 'items.jsonx' ), JSON.stringify( FILE, null, '\t' ) );
		let seeded = run( [ 'data', 'insert', 'Items', '--documents', JSON.stringify( [ { _id: 'a', Color: 'blue' }, { _id: 'b', Color: 'red' }, { _id: 'c', Color: 'blue' } ] ) ] );
		LIB_ASSERT.strictEqual( seeded.Code, 0, seeded.Stderr );
	} );

	afterEach( function ()
	{
		LIB_FS.rmSync( root, { recursive: true, force: true } );
	} );

	it( 'reads what an earlier invocation wrote: result on stdout, the (ad hoc) line on stderr', function ()
	{
		let result = run( [ 'datasource', 'find', 'Items', '--criteria', '{"Color":"blue"}', '--sort', '{"_id":1}' ] );
		LIB_ASSERT.strictEqual( result.Code, 0, result.Stderr );
		LIB_ASSERT.deepStrictEqual( JSON.parse( result.Stdout ).map( function ( Row ) { return Row._id; } ), [ 'a', 'c' ] );
		LIB_ASSERT.match( result.Stderr, /^\(ad hoc\)  Query  2 rows  \d+ ms\n$/ );
	} );

	it( 'refuses delete {} and drop without --yes, and changes nothing', function ()
	{
		let refused = run( [ 'data', 'delete', 'Items', '--criteria', '{}' ] );
		LIB_ASSERT.strictEqual( refused.Code, 2 );
		LIB_ASSERT.match( refused.Stderr, /selects every document/ );
		LIB_ASSERT.strictEqual( refused.Stdout, '' );
		LIB_ASSERT.strictEqual( run( [ 'data', 'drop', 'Items' ] ).Code, 2 );
		LIB_ASSERT.strictEqual( count_items(), 3 );

		let confirmed = run( [ 'data', 'delete', 'Items', '--criteria', '{}', '--yes' ] );
		LIB_ASSERT.strictEqual( confirmed.Code, 0, confirmed.Stderr );
		LIB_ASSERT.strictEqual( JSON.parse( confirmed.Stdout ), 3 );
		LIB_ASSERT.strictEqual( count_items(), 0 );
	} );

	it( '--save stores a validated object, runs nothing, and the object then runs by name', function ()
	{
		let saved = run( [ 'data', 'find', 'Items', '--criteria', '{"Color":"blue"}', '--into', 'Copies', '--save', 'Copy the blue items' ] );
		LIB_ASSERT.strictEqual( saved.Code, 0, saved.Stderr );
		LIB_ASSERT.match( saved.Stderr, /Nothing ran/ );
		LIB_ASSERT.deepStrictEqual( JSON.parse( saved.Stdout ), { Kind: 'Query', Name: 'Copy the blue items', DataSource: 'Items', Criteria: { Color: 'blue' }, Into: 'Copies' } );
		LIB_ASSERT.ok( file_text().includes( '"Copy the blue items"' ) );

		let copies = run( [ 'run', 'Every copy', '--quiet' ] );
		LIB_ASSERT.deepStrictEqual( JSON.parse( copies.Stdout ), [], 'saving ran nothing' );

		let ran = run( [ 'run', 'Copy the blue items' ] );
		LIB_ASSERT.strictEqual( ran.Code, 0, ran.Stderr );
		LIB_ASSERT.strictEqual( JSON.parse( ran.Stdout ).length, 2 );
		LIB_ASSERT.strictEqual( JSON.parse( run( [ 'run', 'Every copy', '--quiet' ] ).Stdout ).length, 2 );
	} );

	it( '--save refuses an object which adds an error unless --force, and a delete saves without --yes', function ()
	{
		let before = file_text();
		let refused = run( [ 'data', 'find', 'Items', '--into', 'Nowhere', '--save', 'Broken' ] );
		LIB_ASSERT.strictEqual( refused.Code, 3 );
		LIB_ASSERT.match( refused.Stderr, /Refused: saving \[Broken\]/ );
		LIB_ASSERT.strictEqual( file_text(), before );

		let everything = run( [ 'data', 'delete', 'Items', '--criteria', '{}', '--save', 'Empty the items' ] );
		LIB_ASSERT.strictEqual( everything.Code, 0, everything.Stderr );
		LIB_ASSERT.strictEqual( count_items(), 3 );

		LIB_ASSERT.strictEqual( run( [ 'data', 'find', 'Items', '--into', 'Nowhere', '--save', 'Broken', '--force' ] ).Code, 0 );
		LIB_ASSERT.ok( file_text().includes( '"Broken"' ) );

		// ***Forced in, the error is the file's now***, and a file with errors runs nothing.
		let blocked = run( [ 'data', 'count', 'Items' ] );
		LIB_ASSERT.strictEqual( blocked.Code, 3 );
		LIB_ASSERT.match( blocked.Stderr, /Nothing ran: the file has errors/ );
	} );

	it( 'refuses an option which has no effect, with or without --save', function ()
	{
		let with_save = run( [ 'data', 'delete', 'Items', '--criteria', '{}', '--save', 'X', '--yes' ] );
		LIB_ASSERT.strictEqual( with_save.Code, 2 );
		LIB_ASSERT.match( with_save.Stderr, /\[--yes\] has no effect with --save/ );

		LIB_ASSERT.strictEqual( run( [ 'data', 'find', 'Items', '--save', 'X', '--trace' ] ).Code, 2 );

		let force_alone = run( [ 'data', 'find', 'Items', '--force' ] );
		LIB_ASSERT.strictEqual( force_alone.Code, 2 );
		LIB_ASSERT.match( force_alone.Stderr, /only with --save/ );

		LIB_ASSERT.strictEqual( run( [ 'data', 'count', 'Items', '--save', 'X' ] ).Code, 2, 'count declares no --save' );
	} );

	it( 'keeps standard output identical with --trace, and puts the calls in the report', function ()
	{
		let plain = run( [ 'data', 'find', 'Items', '--sort', '{"_id":1}' ] );
		let traced = run( [ 'data', 'find', 'Items', '--sort', '{"_id":1}', '--trace' ] );
		LIB_ASSERT.strictEqual( traced.Code, 0, traced.Stderr );
		LIB_ASSERT.strictEqual( traced.Stdout, plain.Stdout );
		LIB_ASSERT.match( traced.Stderr, /\n  \| === [\d.]+ ms \| jsonstor-jsonfile \| FindMany2 ===\n/ );
		LIB_ASSERT.match( traced.Stderr, /\n  \|     Sort : \{"_id":1\}\n/ );
	} );

	it( 'exits 2 for an unknown data source and 3 for a criteria jsongin refuses', function ()
	{
		let unknown = run( [ 'data', 'count', 'Nowhere' ] );
		LIB_ASSERT.strictEqual( unknown.Code, 2 );
		LIB_ASSERT.match( unknown.Stderr, /No data source is named \[Nowhere\]/ );

		let refused = run( [ 'data', 'update', 'Items', '--criteria', '{"Color":{"$bogus":1}}', '--update', '{"$set":{"A":1}}' ] );
		LIB_ASSERT.strictEqual( refused.Code, 3 );
		LIB_ASSERT.match( refused.Stderr, /\(ad hoc\)\.Criteria/ );
		LIB_ASSERT.match( refused.Stderr, /Nothing ran/ );
	} );

	it( 'pings a data source', function ()
	{
		let result = run( [ 'data', 'ping', 'Items', '--quiet' ] );
		LIB_ASSERT.strictEqual( result.Code, 0, result.Stderr );
		let answer = JSON.parse( result.Stdout );
		LIB_ASSERT.strictEqual( answer.AdapterName, 'jsonstor-jsonfile' );
		LIB_ASSERT.strictEqual( answer.Count, 3 );
	} );

} );
