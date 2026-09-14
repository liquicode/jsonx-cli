'use strict';

const LIB_ASSERT = require( 'assert' );
const LIB_CHILD_PROCESS = require( 'child_process' );
const LIB_FS = require( 'fs' );
const LIB_OS = require( 'os' );
const LIB_PATH = require( 'path' );
const { describe, it, before, after } = require( 'node:test' );

const Report = require( '../src/Report.js' );
const Complete = require( '../src/CommandLine/Complete.js' );
const CompletionScripts = require( '../src/CommandLine/CompletionScripts.js' );
const Commands = require( '../commands/jsonx.js' );
const Spec = require( './fixtures/Spec.js' );

const BIN = LIB_PATH.resolve( __dirname, '..', 'bin', 'jsonx.js' );


//---------------------------------------------------------------------
describe( 'Report: text and table', function ()
{

	it( 'writes text for each shape of result', function ()
	{
		LIB_ASSERT.strictEqual( Report.FormatResult( 'text', 'plain words' ), 'plain words\n' );
		LIB_ASSERT.strictEqual( Report.FormatResult( 'text', 3 ), '3\n' );
		LIB_ASSERT.strictEqual( Report.FormatResult( 'text', null ), 'null\n' );
		LIB_ASSERT.strictEqual( Report.FormatResult( 'text', undefined ), '' );
		LIB_ASSERT.strictEqual( Report.FormatResult( 'text', [ 'a', 2, [ 3 ] ] ), 'a\n2\n[3]\n' );
		LIB_ASSERT.strictEqual(
			Report.FormatResult( 'text', { Name: 'N', Lines: [ 'one', 'two' ], Nested: { A: 1 }, Empty: [] } ),
			'Name: N\nLines:\n  one\n  two\nNested: {"A":1}\nEmpty: []\n' );
		LIB_ASSERT.strictEqual( Report.FormatResult( 'text', [ { A: 1 }, { A: 2 } ] ), 'A: 1\n\nA: 2\n' );
	} );

	it( 'writes an array of objects as a table with every key as a column, in order first seen', function ()
	{
		let text = Report.FormatResult( 'table', [ { Name: 'b-1', Hours: 8 }, { Name: 'b-2', Note: 'long', Hours: 3 } ] );
		LIB_ASSERT.strictEqual( text, [
			'Name  Hours  Note',
			'----  -----  ----',
			'b-1   8',
			'b-2   3      long',
			'',
		].join( '\n' ) );
	} );

	it( 'caps a cell, keeps a row on one line, and falls back to text for anything but an array of objects', function ()
	{
		let long = 'x'.repeat( 100 );
		let text = Report.FormatResult( 'table', [ { Wide: long, Deep: { a: [ 1, 2 ] }, Lines: 'one\r\ntwo' } ] );
		let row = text.split( '\n' )[ 2 ];
		LIB_ASSERT.ok( row.includes( 'x'.repeat( Report.CELL_WIDTH - 3 ) + '...' ) );
		LIB_ASSERT.ok( !row.includes( 'x'.repeat( Report.CELL_WIDTH ) ) );
		LIB_ASSERT.ok( row.includes( '{"a":[1,2]}' ) );
		LIB_ASSERT.ok( row.endsWith( 'one two' ) );

		LIB_ASSERT.strictEqual( Report.FormatResult( 'table', [] ), '' );
		LIB_ASSERT.strictEqual( Report.FormatResult( 'table', { A: 1 } ), 'A: 1\n' );
		LIB_ASSERT.strictEqual( Report.FormatResult( 'table', [ 1, 2 ] ), '1\n2\n' );
	} );

} );


//---------------------------------------------------------------------
describe( 'Complete', function ()
{

	let root = null;
	let io = null;

	function candidates( Words )
	{
		return Complete.Candidates( Commands.TREE, Words, io );
	}

	before( function ()
	{
		root = LIB_FS.mkdtempSync( LIB_PATH.join( LIB_OS.tmpdir(), 'jsonx-complete-' ) );
		LIB_FS.writeFileSync( LIB_PATH.join( root, 'observatory.jsonx' ), JSON.stringify( Spec.AppendixB() ) );
		io = { Env: {}, Cwd: root };
	} );

	after( function ()
	{
		LIB_FS.rmSync( root, { recursive: true, force: true } );
	} );

	it( 'offers commands and aliases, never a hidden command', function ()
	{
		LIB_ASSERT.deepStrictEqual( candidates( [ 'da' ] ), [ 'datasource', 'data' ] );
		LIB_ASSERT.deepStrictEqual( candidates( [ 'engine', 'schema', '' ] ), [ 'infer', 'validate', 'init', 'project' ] );
		LIB_ASSERT.ok( !candidates( [ '' ] ).includes( '__complete' ) );
		LIB_ASSERT.ok( candidates( [ '' ] ).includes( 'completion' ) );
	} );

	it( 'offers the options in force, and an option\'s choices', function ()
	{
		LIB_ASSERT.deepStrictEqual( candidates( [ 'data', 'find', 'Bookings', '--c' ] ), [ '--criteria' ] );
		LIB_ASSERT.deepStrictEqual( candidates( [ 'run', '--output', '' ] ), [ 'json', 'jsonl', 'text', 'table' ] );
		LIB_ASSERT.deepStrictEqual( candidates( [ 'run', '-o', 't' ] ), [ 'text', 'table' ] );
		LIB_ASSERT.ok( !candidates( [ 'run', '--' ] ).includes( '--version' ), 'an Inherit: false option stays at the root' );
		LIB_ASSERT.deepStrictEqual( candidates( [ 'new', '' ] ), [ 'file', 'datasource', 'query', 'insert', 'update', 'delete', 'process', 'trigger' ] );
	} );

	it( 'offers the names a positional declares, from the file, and .jsonx files after --file', function ()
	{
		LIB_ASSERT.deepStrictEqual( candidates( [ 'debug', '' ] ), [ 'Assign a dome to each confirmed booking', 'Note a long booking', 'Prepare the season' ] );
		LIB_ASSERT.deepStrictEqual( candidates( [ 'data', 'find', '' ] ), [ 'Telescopes', 'Bookings', 'Assignments', 'Notes' ] );
		LIB_ASSERT.deepStrictEqual( candidates( [ 'delete', 'show', '' ] ), [ 'Drop the cancelled bookings' ] );
		LIB_ASSERT.deepStrictEqual( candidates( [ 'trigger', 'run', '' ] ), [ 'Note every long booking as it arrives' ] );
		LIB_ASSERT.strictEqual( candidates( [ 'explain', '' ] ).length, 12 );
		LIB_ASSERT.deepStrictEqual( candidates( [ 'run', '--quiet', 'Prep' ] ), [ 'Prepare the season' ] );
		LIB_ASSERT.deepStrictEqual( candidates( [ 'run', '--file', '' ] ), [ 'observatory.jsonx' ] );
		LIB_ASSERT.deepStrictEqual( candidates( [ 'run', 'Prepare the season', '' ] ), [], 'the one positional is given' );
		LIB_ASSERT.ok( candidates( [ 'adapters', 'info', 'jsonstor-mysql' ] ).includes( 'jsonstor-mysql-v8.4' ) );
	} );

	it( 'completes no names when the file cannot be read', function ()
	{
		LIB_ASSERT.deepStrictEqual( Complete.Candidates( Commands.TREE, [ 'run', '--file', 'missing.jsonx', '' ], io ), [] );
		let empty = LIB_FS.mkdtempSync( LIB_PATH.join( LIB_OS.tmpdir(), 'jsonx-complete-empty-' ) );
		try
		{
			LIB_ASSERT.deepStrictEqual( Complete.Candidates( Commands.TREE, [ 'run', '' ], { Env: {}, Cwd: empty } ), [], 'no .jsonx file here, so no names' );
		}
		finally
		{
			LIB_FS.rmSync( empty, { recursive: true, force: true } );
		}
	} );

} );


//---------------------------------------------------------------------
describe( 'jsonx completion and --output text|table', function ()
{

	let root = null;

	function cli( Argv )
	{
		let env = Object.assign( {}, process.env );
		delete env.JSONX_FILE;
		let result = LIB_CHILD_PROCESS.spawnSync( process.execPath, [ BIN ].concat( Argv ), { cwd: root, env: env, encoding: 'utf8' } );
		return { Code: result.status, Stdout: result.stdout, Stderr: result.stderr };
	}

	before( function ()
	{
		root = LIB_FS.mkdtempSync( LIB_PATH.join( LIB_OS.tmpdir(), 'jsonx-completion-' ) );
		LIB_FS.writeFileSync( LIB_PATH.join( root, 'observatory.jsonx' ), JSON.stringify( Spec.AppendixB() ) );
	} );

	after( function ()
	{
		LIB_FS.rmSync( root, { recursive: true, force: true } );
	} );

	it( 'answers the callback one candidate per line, the current word marked, including an empty one', function ()
	{
		LIB_ASSERT.strictEqual( cli( [ '__complete', '--', 'run', ':Prep' ] ).Stdout, 'Prepare the season\n' );
		LIB_ASSERT.strictEqual( cli( [ '__complete', '--', 'engine', 'schema', ':' ] ).Stdout, 'infer\nvalidate\ninit\nproject\n' );
		let nothing = cli( [ '__complete', '--', 'run', 'Prepare the season', ':' ] );
		LIB_ASSERT.strictEqual( nothing.Code, 0 );
		LIB_ASSERT.strictEqual( nothing.Stdout, '' );
	} );

	it( 'writes a script for each shell which calls back, and refuses --output', function ()
	{
		for ( let index = 0; index < CompletionScripts.SHELLS.length; index++ )
		{
			let shell = CompletionScripts.SHELLS[ index ];
			let result = cli( [ 'completion', shell ] );
			LIB_ASSERT.strictEqual( result.Code, 0, result.Stderr );
			LIB_ASSERT.ok( result.Stdout.includes( '__complete' ), shell );
			LIB_ASSERT.ok( result.Stdout.includes( Complete.CURRENT_MARK ), shell );
			LIB_ASSERT.strictEqual( result.Stdout, CompletionScripts.Script( shell, 'jsonx' ) );
		}
		LIB_ASSERT.strictEqual( cli( [ 'completion', 'fish' ] ).Code, 2 );
		LIB_ASSERT.strictEqual( cli( [ 'completion', 'bash', '--output', 'text' ] ).Code, 2 );
		LIB_ASSERT.ok( !cli( [ '--help' ] ).Stdout.includes( '__complete' ) );
	} );

	it( 'writes a run\'s rows as a table and an explanation as text', function ()
	{
		let table = cli( [ 'run', 'Prepare the season', '--output', 'table', '--quiet' ] );
		LIB_ASSERT.strictEqual( table.Code, 0, table.Stderr );
		LIB_ASSERT.strictEqual( table.Stdout, 'Booking  Observer   Dome\n-------  ---------  ----\nb-1      R. Okafor  B\n' );

		let text = cli( [ 'explain', 'Drop the cancelled bookings', '-o', 'text', '-q' ] );
		LIB_ASSERT.strictEqual( text.Stdout, 'Name: Drop the cancelled bookings\nKind: Delete\nLines:\n  Remove every document from "Bookings" where Status is "cancelled".\n' );
	} );

} );
