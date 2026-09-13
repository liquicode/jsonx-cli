'use strict';

const LIB_ASSERT = require( 'assert' );
const LIB_CHILD_PROCESS = require( 'child_process' );
const LIB_FS = require( 'fs' );
const LIB_OS = require( 'os' );
const LIB_PATH = require( 'path' );
const { describe, it, beforeEach, after } = require( 'node:test' );

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
describe( 'jsonx plan, datasource info and describe, and the manage verbs', function ()
{

	let root = LIB_FS.mkdtempSync( LIB_PATH.join( LIB_OS.tmpdir(), 'jsonx-manage-' ) );
	let directory = null;
	let file = null;
	let counter = 0;

	beforeEach( function ()
	{
		counter++;
		directory = LIB_PATH.join( root, 'case-' + counter );
		LIB_FS.mkdirSync( directory );
		file = LIB_PATH.join( directory, 'observatory.jsonx' );
		LIB_FS.writeFileSync( file, JSON.stringify( Spec.AppendixB() ) );
	} );

	after( function () { LIB_FS.rmSync( root, { recursive: true, force: true } ); } );

	function read_file() { return JSON.parse( LIB_FS.readFileSync( file, 'utf8' ) ); }

	it( 'plans an object: the plan on stdout, the tree on stderr, nothing opened', function ()
	{
		let result = run( [ 'plan', 'Prepare the season' ], directory );
		LIB_ASSERT.strictEqual( result.Code, 0, result.Stderr );
		let plan = JSON.parse( result.Stdout );
		LIB_ASSERT.strictEqual( plan.Tree.Does.length, 5 );
		LIB_ASSERT.ok( result.Stderr.includes( 'Triggers it could fire:' ) );
		LIB_ASSERT.ok( result.Stderr.endsWith( 'Nothing was opened.\n' ) );

		LIB_ASSERT.strictEqual( run( [ 'plan', 'Bookings' ], directory ).Code, 2 );
	} );

	it( 'lists and shows without writing the file', function ()
	{
		let before = LIB_FS.readFileSync( file, 'utf8' );
		let listed = run( [ 'process', 'list', '-q' ], directory );
		LIB_ASSERT.strictEqual( JSON.parse( listed.Stdout ).length, 3 );
		let shown = run( [ 'datasource', 'show', 'Notes', '-q' ], directory );
		LIB_ASSERT.deepStrictEqual( JSON.parse( shown.Stdout ), { Name: 'Notes', AdapterName: 'jsonstor-memory' } );
		LIB_ASSERT.strictEqual( LIB_FS.readFileSync( file, 'utf8' ), before );

		let wrong = run( [ 'query', 'show', 'Notes' ], directory );
		LIB_ASSERT.strictEqual( wrong.Code, 2 );
		LIB_ASSERT.ok( wrong.Stderr.includes( 'not a Query' ) );
	} );

	it( 'adds from @file and writes the file tab indented; refuses a reserved name with exit 3 and no write', function ()
	{
		let body = LIB_PATH.join( directory, 'query.json' );
		LIB_FS.writeFileSync( body, JSON.stringify( { Name: 'Read notes', DataSource: 'Notes', Criteria: {} } ) );
		let added = run( [ 'query', 'add', '--json', '@' + body ], directory );
		LIB_ASSERT.strictEqual( added.Code, 0, added.Stderr );
		LIB_ASSERT.strictEqual( read_file().Objects[ 7 ].Kind, 'Query' );
		LIB_ASSERT.ok( LIB_FS.readFileSync( file, 'utf8' ).startsWith( '{\n\t"Jsonx"' ) );

		let before = LIB_FS.readFileSync( file, 'utf8' );
		LIB_FS.writeFileSync( body, JSON.stringify( { Name: 'Count', DataSource: 'Notes', Criteria: {} } ) );
		let refused = run( [ 'query', 'add', '--json', '@' + body ], directory );
		LIB_ASSERT.strictEqual( refused.Code, 3 );
		LIB_ASSERT.ok( refused.Stderr.includes( 'Refused: this add would add' ) );
		LIB_ASSERT.strictEqual( LIB_FS.readFileSync( file, 'utf8' ), before );
	} );

	it( 'renames a data source and every reference, and the file still validates', function ()
	{
		let renamed = run( [ 'datasource', 'rename', 'Bookings', 'Reservations', '-q' ], directory );
		LIB_ASSERT.strictEqual( renamed.Code, 0, renamed.Stderr );
		LIB_ASSERT.strictEqual( JSON.parse( renamed.Stdout ).References.length, 5 );
		LIB_ASSERT.strictEqual( run( [ 'validate', '-q' ], directory ).Stdout, '[]\n' );
	} );

	it( 'sets a field from stdin, and refuses a remove while the name is used', function ()
	{
		let env = Object.assign( {}, process.env );
		delete env.JSONX_FILE;
		let set = LIB_CHILD_PROCESS.spawnSync( process.execPath, [ BIN, 'insert', 'set', 'Two telescopes', '--json', '-', '-q' ], {
			cwd: directory, env: env, encoding: 'utf8', input: '{ "Documents": [ { "Name": "Solo 10", "Site": { "Dome": "C" } } ] }',
		} );
		LIB_ASSERT.strictEqual( set.status, 0, set.stderr );
		LIB_ASSERT.strictEqual( read_file().Objects[ 0 ].Documents.length, 1 );

		let refused = run( [ 'datasource', 'remove', 'Telescopes' ], directory );
		LIB_ASSERT.strictEqual( refused.Code, 3 );
		LIB_ASSERT.ok( refused.Stderr.includes( 'Objects.4.Steps.0.$call.With.DataSource' ) );
		LIB_ASSERT.strictEqual( read_file().DataSources.length, 4 );
	} );

	it( 'reports datasource info and describes a data source read through a file-relative path', function ()
	{
		let document = Spec.AppendixB();
		document.DataSources[ 1 ] = { Name: 'Bookings', AdapterName: 'jsonstor-jsonfile', Settings: { Path: 'bookings.json' } };
		LIB_FS.writeFileSync( file, JSON.stringify( document ) );
		LIB_FS.writeFileSync( LIB_PATH.join( directory, 'bookings.json' ), JSON.stringify( [ { _id: 'b-1', Hours: 8 }, { _id: 'b-2', Hours: 3 } ] ) );

		let elsewhere = LIB_PATH.join( root, 'elsewhere-' + counter );
		LIB_FS.mkdirSync( elsewhere );
		let described = run( [ 'datasource', 'describe', 'Bookings', '--rows', '1', '-f', file ], elsewhere );
		LIB_ASSERT.strictEqual( described.Code, 0, described.Stderr );
		let description = JSON.parse( described.Stdout );
		LIB_ASSERT.strictEqual( description.Samples.length, 1 );
		LIB_ASSERT.ok( description.Schema.properties.Hours );

		let info = run( [ 'datasource', 'info', 'Bookings', '-f', file ], elsewhere );
		LIB_ASSERT.strictEqual( info.Code, 0, info.Stderr );
		LIB_ASSERT.strictEqual( JSON.parse( info.Stdout ).AdapterName, 'jsonstor-jsonfile' );

		LIB_ASSERT.strictEqual( run( [ 'datasource', 'info', 'Nobody', '-f', file ], elsewhere ).Code, 2 );
	} );

} );
