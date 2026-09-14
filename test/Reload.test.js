'use strict';

const LIB_ASSERT = require( 'assert' );
const LIB_FS = require( 'fs' );
const LIB_OS = require( 'os' );
const LIB_PATH = require( 'path' );
const { describe, it, before, after } = require( 'node:test' );

const Held = require( '../src/Session/Held.js' );
const Parser = require( '../src/CommandLine/Parser.js' );
const Commands = require( '../commands/jsonx.js' );


//---------------------------------------------------------------------
function write( Path, Document )
{
	LIB_FS.writeFileSync( Path, JSON.stringify( Document, null, '\t' ) );
	return Path;
}

function hold( File, Extra )
{
	let io = Parser.DefaultIo();
	io.Env = {};
	io.Cwd = LIB_PATH.dirname( File );
	let logged = [];
	let held = Held.NewHeld( Object.assign( { Tree: Commands.TREE, File: File, Io: io, Log: function ( Text ) { logged.push( Text ); } }, Extra || {} ) );
	held.Logged = logged;
	return held;
}

// Two memory stores and a query over each; a Process of several calls, which a reload can land in
// the middle of.
function base_document()
{
	return {
		DataSources: [
			{ Name: 'Kept', AdapterName: 'jsonstor-memory' },
			{ Name: 'Moved', AdapterName: 'jsonstor-memory' },
			{ Name: 'Notes', AdapterName: 'jsonstor-memory' },
		],
		Objects: [
			{ Kind: 'Insert', Name: 'Seed kept', DataSource: 'Kept', Documents: [ { _id: 'k1', Colour: 'red' }, { _id: 'k2', Colour: 'blue' } ] },
			{ Kind: 'Insert', Name: 'Seed moved', DataSource: 'Moved', Documents: [ { _id: 'm1' } ] },
			{ Kind: 'Query', Name: 'Pick', DataSource: 'Kept', Criteria: { Colour: 'red' } },
			{
				Kind: 'Process', Name: 'Slow count', Steps: [
					{ $call: { Name: 'Count', With: { DataSource: 'Kept', Criteria: {} }, Into: 'A' } },
					{ $call: { Name: 'Count', With: { DataSource: 'Kept', Criteria: {} }, Into: 'B' } },
					{ $call: { Name: 'Count', With: { DataSource: 'Kept', Criteria: {} }, Into: 'C' } },
					{ $return: 'old' },
				],
			},
		],
	};
}

async function count( Held_, Name )
{
	let envelope = await Held_.Invoke( { Command: 'data count', name: Name } );
	LIB_ASSERT.strictEqual( envelope.ExitCode, 0, envelope.Log.join( '\n' ) );
	return envelope.Result;
}


//---------------------------------------------------------------------
describe( 'A held session following its file', function ()
{

	let root = null;
	let counter = 0;

	// A fresh file for each test, so no test sees another's edits.
	function fresh( Document )
	{
		counter++;
		let folder = LIB_PATH.join( root, 'case-' + counter );
		LIB_FS.mkdirSync( folder );
		return write( LIB_PATH.join( folder, 'file.jsonx' ), Document || base_document() );
	}

	before( function () { root = LIB_FS.mkdtempSync( LIB_PATH.join( LIB_OS.tmpdir(), 'jsonx-reload-' ) ); } );
	after( function () { LIB_FS.rmSync( root, { recursive: true, force: true } ); } );


	it( 'runs an edit made on disk after a reload, and an unchanged data source keeps its rows', async function ()
	{
		let file = fresh();
		let held = hold( file );
		try
		{
			await held.Invoke( { Command: 'run', name: 'Seed kept' } );
			let before_edit = await held.Invoke( { Command: 'run', name: 'Pick' } );
			LIB_ASSERT.deepStrictEqual( before_edit.Result.map( function ( Row ) { return Row._id; } ), [ 'k1' ] );

			let document = base_document();
			document.Objects.find( function ( Entry ) { return Entry.Name === 'Pick'; } ).Criteria = { Colour: 'blue' };
			write( file, document );

			let outcome = await held.Reload();
			LIB_ASSERT.deepStrictEqual( [ outcome.Reloaded, outcome.Changed ], [ true, [] ] );
			LIB_ASSERT.ok( held.Logged.some( function ( Text ) { return Text.startsWith( 'Reloaded ' ); } ), held.Logged.join( '' ) );

			let after_edit = await held.Invoke( { Command: 'run', name: 'Pick' } );
			LIB_ASSERT.deepStrictEqual( after_edit.Result.map( function ( Row ) { return Row._id; } ), [ 'k2' ] );
			LIB_ASSERT.strictEqual( await count( held, 'Kept' ), 2 );
		}
		finally { await held.Release(); }
	} );

	it( 'opens a data source whose definition changed again from its new definition, and keeps the rest', async function ()
	{
		let file = fresh();
		let held = hold( file );
		try
		{
			await held.Invoke( { Command: 'run', name: 'Seed kept' } );
			await held.Invoke( { Command: 'run', name: 'Seed moved' } );
			LIB_ASSERT.strictEqual( await count( held, 'Moved' ), 1 );

			let document = base_document();
			document.DataSources[ 1 ] = { Name: 'Moved', AdapterName: 'jsonstor-jsonfile', Settings: { Path: 'moved.json' } };
			write( file, document );

			let outcome = await held.Reload();
			LIB_ASSERT.deepStrictEqual( outcome.Changed, [ 'Moved' ] );
			LIB_ASSERT.strictEqual( await count( held, 'Moved' ), 0 );
			LIB_ASSERT.strictEqual( await count( held, 'Kept' ), 2 );

			await held.Invoke( { Command: 'run', name: 'Seed moved' } );
			LIB_ASSERT.strictEqual( await count( held, 'Moved' ), 1 );
			LIB_ASSERT.ok( LIB_FS.existsSync( LIB_PATH.join( LIB_PATH.dirname( file ), 'moved.json' ) ), 'the new definition, relative to the file' );
		}
		finally { await held.Release(); }
	} );

	it( 'fires a trigger added on disk, by opening its data source again', async function ()
	{
		let file = fresh();
		let held = hold( file );
		try
		{
			await held.Invoke( { Command: 'run', name: 'Seed kept' } );

			let document = base_document();
			document.Objects.push( {
				Kind: 'Process', Name: 'Note it', DataSource: 'Kept', Criteria: {},
				Steps: [ { $call: { Name: 'InsertOne', With: { DataSource: 'Notes', Document: { Seen: '$Document._id' } } } } ],
			} );
			document.Triggers = [ { Name: 'On insert', On: [ 'InsertOne', 'InsertMany' ], Process: 'Note it' } ];
			write( file, document );

			let outcome = await held.Reload();
			LIB_ASSERT.deepStrictEqual( outcome.Changed, [ 'Kept' ] );

			let inserted = await held.Invoke( { Command: 'data insert', name: 'Kept', documents: { _id: 'k3' } } );
			LIB_ASSERT.ok( inserted.Log.some( function ( Line ) { return Line.includes( 'trigger [On insert] Note it' ); } ), inserted.Log.join( '\n' ) );
		}
		finally { await held.Release(); }
	} );

	it( 'keeps the old copy when the file no longer parses, or an override no longer fits', async function ()
	{
		let file = fresh();
		let held = hold( file );
		try
		{
			await held.Invoke( { Command: 'run', name: 'Seed kept' } );
			LIB_FS.writeFileSync( file, '{ "DataSources": [ ' );
			let broken = await held.Reload();
			LIB_ASSERT.deepStrictEqual( [ broken.Reloaded, broken.Reason ], [ false, 'kept' ] );
			LIB_ASSERT.ok( held.Logged.some( function ( Text ) { return Text.startsWith( 'Not reloaded: ' ); } ), held.Logged.join( '' ) );

			let still = await held.Invoke( { Command: 'run', name: 'Pick' } );
			LIB_ASSERT.strictEqual( still.ExitCode, 0, still.Log.join( '\n' ) );
			LIB_ASSERT.strictEqual( await count( held, 'Kept' ), 2 );
		}
		finally { await held.Release(); }

		let bound_file = fresh();
		let bound = hold( bound_file, { Binds: [ 'Moved=jsonstor-memory' ] } );
		try
		{
			let document = base_document();
			document.DataSources = document.DataSources.filter( function ( Entry ) { return Entry.Name !== 'Moved'; } );
			document.Objects = document.Objects.filter( function ( Entry ) { return Entry.DataSource !== 'Moved'; } );
			write( bound_file, document );
			let kept = await bound.Reload();
			LIB_ASSERT.deepStrictEqual( [ kept.Reloaded, kept.Reason ], [ false, 'kept' ] );
			LIB_ASSERT.ok( /not a data source of this file/.test( kept.Message ), kept.Message );
			LIB_ASSERT.ok( bound.Session.Document.DataSources.some( function ( Entry ) { return Entry.Name === 'Moved'; } ) );
		}
		finally { await bound.Release(); }
	} );

	it( 'does not reload its own write, and reopens a data source an edit changed', async function ()
	{
		let file = fresh();
		let held = hold( file );
		try
		{
			await held.Invoke( { Command: 'run', name: 'Seed kept' } );
			await held.Invoke( { Command: 'run', name: 'Seed moved' } );

			let added = await held.Invoke( { Command: 'query add', json: { Name: 'All kept', DataSource: 'Kept', Criteria: {} } } );
			LIB_ASSERT.strictEqual( added.ExitCode, 0, added.Log.join( '\n' ) );
			LIB_ASSERT.ok( added.Log.every( function ( Line ) { return !Line.startsWith( 'Changed data sources' ); } ), added.Log.join( '\n' ) );
			LIB_ASSERT.deepStrictEqual( await held.Reload(), { Reloaded: false, Reason: 'unchanged' } );

			let changed = await held.Invoke( { Command: 'datasource set', name: 'Moved', json: { AdapterName: 'jsonstor-jsonfile', Settings: { Path: 'moved.json' } } } );
			LIB_ASSERT.strictEqual( changed.ExitCode, 0, changed.Log.join( '\n' ) );
			LIB_ASSERT.ok( changed.Log.includes( 'Changed data sources, opened again on their next use: Moved.' ), changed.Log.join( '\n' ) );
			LIB_ASSERT.deepStrictEqual( await held.Reload(), { Reloaded: false, Reason: 'unchanged' } );

			LIB_ASSERT.strictEqual( await count( held, 'Moved' ), 0 );
			LIB_ASSERT.strictEqual( await count( held, 'Kept' ), 2 );
		}
		finally { await held.Release(); }
	} );

	it( 'finishes a run in flight on the copy it started with', async function ()
	{
		let file = fresh();
		let held = hold( file );
		try
		{
			let document = base_document();
			document.Objects.find( function ( Entry ) { return Entry.Name === 'Slow count'; } ).Steps[ 3 ] = { $return: 'new' };

			let running = held.Invoke( { Command: 'run', name: 'Slow count' } );
			write( file, document );
			let reloading = held.Reload();

			let ran = await running;
			LIB_ASSERT.strictEqual( ran.Result, 'old', ran.Log.join( '\n' ) );
			LIB_ASSERT.strictEqual( ( await reloading ).Reloaded, true );

			let again = await held.Invoke( { Command: 'run', name: 'Slow count' } );
			LIB_ASSERT.strictEqual( again.Result, 'new' );
		}
		finally { await held.Release(); }
	} );

	it( 'watches the file: an editor\'s change reloads, and the session\'s own write does not', async function ()
	{
		let file = fresh();
		let outcomes = [];
		let waiting = null;
		let held = hold( file, {
			OnReload: function ( Outcome ) { outcomes.push( Outcome ); if ( waiting ) { waiting(); } },
		} );
		let next_outcome = function ( Milliseconds )
		{
			return new Promise( function ( Resolve, Reject )
			{
				let timer = setTimeout( function () { Reject( new Error( 'no reload within ' + Milliseconds + ' ms' ) ); }, Milliseconds );
				waiting = function () { clearTimeout( timer ); waiting = null; Resolve( outcomes[ outcomes.length - 1 ] ); };
			} );
		};
		try
		{
			held.Watch();

			let own = next_outcome( 5000 );
			await held.Invoke( { Command: 'query add', json: { Name: 'All kept', DataSource: 'Kept', Criteria: {} } } );
			LIB_ASSERT.deepStrictEqual( await own, { Reloaded: false, Reason: 'unchanged' } );

			let document = JSON.parse( LIB_FS.readFileSync( file, 'utf8' ) );
			document.Objects.find( function ( Entry ) { return Entry.Name === 'Pick'; } ).Criteria = { Colour: 'blue' };
			let edited = next_outcome( 5000 );
			// An editor saving: replace the file.
			LIB_FS.writeFileSync( file + '.tmp', JSON.stringify( document, null, '  ' ) );
			LIB_FS.renameSync( file + '.tmp', file );
			let outcome = await edited;
			LIB_ASSERT.strictEqual( outcome.Reloaded, true, JSON.stringify( outcome ) );
			LIB_ASSERT.deepStrictEqual( held.Session.Document.Objects.find( function ( Entry ) { return Entry.Name === 'Pick'; } ).Criteria, { Colour: 'blue' } );
		}
		finally { await held.Release(); }
	} );

} );
