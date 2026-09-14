'use strict';

/*
	Live output (cut 4, step 1): what a served mode can push while a command runs, and what it can
	push about the file. The WebSocket (step 2) is the first thing to send these; here they are
	asserted where they are made - Out's sinks, the runner's report listeners, Held.Invoke's Listen
	and Held.OnEvent.
*/

const LIB_ASSERT = require( 'assert' );
const LIB_FS = require( 'fs' );
const LIB_OS = require( 'os' );
const LIB_PATH = require( 'path' );
const { describe, it, before, after } = require( 'node:test' );

const Envelope = require( '../src/Envelope.js' );
const Held = require( '../src/Session/Held.js' );
const Debugger = require( '../src/Session/Debugger.js' );
const Parser = require( '../src/CommandLine/Parser.js' );
const Commands = require( '../commands/jsonx.js' );
const Spec = require( './fixtures/Spec.js' );


//---------------------------------------------------------------------
function write( Directory, Name, Document )
{
	let path = LIB_PATH.join( Directory, Name );
	LIB_FS.writeFileSync( path, JSON.stringify( Document, null, '\t' ) );
	return path;
}

function hold( File )
{
	let io = Parser.DefaultIo();
	io.Env = {};
	io.Cwd = LIB_PATH.dirname( File );
	return Held.NewHeld( { Tree: Commands.TREE, File: File, Io: io } );
}

// Two Processes of several calls each, so two runs interleave at every await unless the queue orders
// them.
function scratch_document()
{
	let steps = function ( Store )
	{
		return [
			{ $call: { Name: 'Add to ' + Store } },
			{ $call: { Name: 'Count', With: { DataSource: Store, Criteria: {} }, Into: 'Counted' } },
			{ $call: { Name: 'Add to ' + Store } },
			{ $return: '$Counted' },
		];
	};
	return {
		DataSources: [
			{ Name: 'Left', AdapterName: 'jsonstor-memory' },
			{ Name: 'Right', AdapterName: 'jsonstor-memory' },
		],
		Objects: [
			{ Kind: 'Insert', Name: 'Add to Left', DataSource: 'Left', Documents: [ { Side: 'left' } ] },
			{ Kind: 'Insert', Name: 'Add to Right', DataSource: 'Right', Documents: [ { Side: 'right' } ] },
			{ Kind: 'Process', Name: 'Fill Left', Steps: steps( 'Left' ) },
			{ Kind: 'Process', Name: 'Fill Right', Steps: steps( 'Right' ) },
		],
	};
}

// Every open has a close at the same depth, in stack order.
function assert_balanced( Reports )
{
	let open = [];
	for ( let index = 0; index < Reports.length; index++ )
	{
		let report = Reports[ index ];
		if ( report.Phase === 'open' )
		{
			LIB_ASSERT.strictEqual( report.Depth, open.length, JSON.stringify( report ) );
			open.push( report );
			continue;
		}
		let opened = open.pop();
		LIB_ASSERT.ok( opened, 'a close with nothing open: ' + JSON.stringify( report ) );
		LIB_ASSERT.strictEqual( report.Name, opened.Name );
		LIB_ASSERT.strictEqual( report.Depth, open.length );
		LIB_ASSERT.strictEqual( typeof report.Ms, 'number' );
	}
	LIB_ASSERT.deepStrictEqual( open, [] );
	return;
}


//---------------------------------------------------------------------
describe( 'Live output', function ()
{

	let root = null;
	let observatory = null;
	let scratch = null;

	before( function ()
	{
		root = LIB_FS.mkdtempSync( LIB_PATH.join( LIB_OS.tmpdir(), 'jsonx-live-' ) );
		observatory = write( root, 'observatory.jsonx', Spec.AppendixB() );
		scratch = write( root, 'scratch.jsonx', scratch_document() );
	} );

	after( function () { LIB_FS.rmSync( root, { recursive: true, force: true } ); } );


	it( 'hands each report line and finding to Out\'s sinks, and records the same envelope', function ()
	{
		let lines = [];
		let findings = [];
		let told = Envelope.NewOut( {
			OnLog: function ( Line ) { lines.push( Line ); },
			OnFinding: function ( Finding ) { findings.push( Finding ); },
		} );
		let plain = Envelope.NewOut();
		let finding = { Severity: 'warning', Path: 'Objects.0', Message: 'Look.' };
		for ( let out of [ told, plain ] )
		{
			out.Log( 'one\ntwo\n' );
			out.Finding( finding );
			out.Log( 'three' );
			out.Result( [ 1 ] );
		}
		LIB_ASSERT.deepStrictEqual( lines, [ 'one', 'two', 'three' ] );
		LIB_ASSERT.deepStrictEqual( findings, [ finding ] );
		LIB_ASSERT.deepStrictEqual( told.Envelope( 0 ), plain.Envelope( 0 ) );

		let throwing = Envelope.NewOut( { OnLog: function () { throw new Error( 'gone' ); }, OnFinding: function () { throw new Error( 'gone' ); } } );
		throwing.Log( 'still recorded\n' );
		throwing.Finding( finding );
		LIB_ASSERT.deepStrictEqual( throwing.Envelope( 0 ).Log, [ 'still recorded' ] );
	} );

	it( 'tells a request\'s Listen its reports, lines and findings as it runs, before the answer', async function ()
	{
		let held = hold( observatory );
		try
		{
			let heard = [];
			let envelope = await held.Invoke( { Command: 'run', name: 'Prepare the season' }, function ( Progress ) { heard.push( Progress ); } );
			heard.push( 'answered' );
			LIB_ASSERT.strictEqual( envelope.ExitCode, 0, envelope.Log.join( '\n' ) );

			let reports = heard.filter( function ( Item ) { return Item.Report; } ).map( function ( Item ) { return Item.Report; } );
			assert_balanced( reports );
			LIB_ASSERT.deepStrictEqual( [ reports[ 0 ].Phase, reports[ 0 ].Name, reports[ 0 ].Depth ], [ 'open', 'Prepare the season', 0 ] );
			let closed = reports[ reports.length - 1 ];
			LIB_ASSERT.deepStrictEqual( [ closed.Phase, closed.Name, closed.Ok ], [ 'close', 'Prepare the season', true ] );

			// Appendix B's run fires its trigger: the triggered Process is a report of its own, nested.
			let fired = reports.filter( function ( Report ) { return typeof Report.Trigger === 'string'; } );
			LIB_ASSERT.ok( fired.length >= 2, JSON.stringify( reports ) );
			LIB_ASSERT.ok( fired.every( function ( Report ) { return Report.Depth > 0; } ), JSON.stringify( fired ) );

			// The lines heard are the envelope's, in order, and everything came before the answer.
			let lines = heard.filter( function ( Item ) { return typeof Item.Log === 'string'; } ).map( function ( Item ) { return Item.Log; } );
			LIB_ASSERT.deepStrictEqual( lines, envelope.Log );
			LIB_ASSERT.strictEqual( heard[ heard.length - 1 ], 'answered' );

			// No result travels in a report: the answer carries it.
			LIB_ASSERT.ok( reports.every( function ( Report ) { return !( 'Result' in Report ); } ) );
		}
		finally { await held.Release(); }
	} );

	it( 'tells a queued request only its own reports, never those of the request before it', async function ()
	{
		let held = hold( scratch );
		try
		{
			let left = [];
			let right = [];
			let answers = await Promise.all( [
				held.Invoke( { Command: 'run', name: 'Fill Left' }, function ( Progress ) { if ( Progress.Report ) { left.push( Progress.Report ); } } ),
				held.Invoke( { Command: 'run', name: 'Fill Right' }, function ( Progress ) { if ( Progress.Report ) { right.push( Progress.Report ); } } ),
			] );
			LIB_ASSERT.strictEqual( answers[ 0 ].ExitCode, 0, answers[ 0 ].Log.join( '\n' ) );
			LIB_ASSERT.strictEqual( answers[ 1 ].ExitCode, 0, answers[ 1 ].Log.join( '\n' ) );
			assert_balanced( left );
			assert_balanced( right );
			LIB_ASSERT.ok( left.length > 2 && right.length > 2 );
			LIB_ASSERT.ok( left.every( function ( Report ) { return !/Right/.test( Report.Name ); } ), JSON.stringify( left ) );
			LIB_ASSERT.ok( right.every( function ( Report ) { return !/Left/.test( Report.Name ); } ), JSON.stringify( right ) );
		}
		finally { await held.Release(); }
	} );

	it( 'runs to the same answer when a listener throws, and stops telling it once the request ends', async function ()
	{
		let held = hold( scratch );
		try
		{
			let quiet = await held.Invoke( { Command: 'run', name: 'Fill Left' } );
			let calls = 0;
			let loud = await held.Invoke( { Command: 'run', name: 'Fill Right' }, function () { calls++; throw new Error( 'the client went away' ); } );
			LIB_ASSERT.strictEqual( loud.ExitCode, 0, loud.Log.join( '\n' ) );
			LIB_ASSERT.strictEqual( loud.Result, quiet.Result );
			LIB_ASSERT.ok( calls > 0 );

			let after_it = calls;
			await held.Invoke( { Command: 'run', name: 'Fill Left' } );
			LIB_ASSERT.strictEqual( calls, after_it );
		}
		finally { await held.Release(); }
	} );

	it( 'tells report listeners about a debug\'s frames, which the debugger opens and closes itself', async function ()
	{
		let held = hold( observatory );
		try
		{
			let reports = [];
			let stop = held.Session.Runner.OnReport( function ( Phase, Report, Depth ) { reports.push( { Phase: Phase, Name: Report.Name, Depth: Depth, Ms: Report.Ms } ); } );
			let debug = Debugger.NewDebugger( held.Lease(), 'Prepare the season' );
			await debug.Start();
			for ( let steps = 0; steps < 200 && !debug.Finished; steps++ ) { await debug.Command( 'continue' ); }
			stop();
			LIB_ASSERT.strictEqual( debug.Outcome, 'done' );
			assert_balanced( reports );
			LIB_ASSERT.deepStrictEqual( [ reports[ 0 ].Name, reports[ reports.length - 1 ].Name ], [ 'Prepare the season', 'Prepare the season' ] );
		}
		finally { await held.Release(); }
	} );

	it( 'tells every OnEvent listener when the document changes, by a request or on disk, and nothing else', async function ()
	{
		let file = write( root, 'events.jsonx', scratch_document() );
		let held = hold( file );
		let events = [];
		let others = [];
		held.OnEvent( function ( Event ) { events.push( Event ); } );
		let stop_other = held.OnEvent( function ( Event ) { others.push( Event.Event ); throw new Error( 'ignored' ); } );
		try
		{
			// Running, reading and a concurrent command change nothing.
			await held.Invoke( { Command: 'run', name: 'Fill Left' } );
			await held.Invoke( { Command: 'query list' } );
			await held.Invoke( { Command: 'validate' } );
			LIB_ASSERT.deepStrictEqual( events, [] );

			// An edit through a request.
			let added = await held.Invoke( { Command: 'query add', json: { Name: 'Read left', DataSource: 'Left', Criteria: {} } } );
			LIB_ASSERT.strictEqual( added.ExitCode, 0, added.Log.join( '\n' ) );
			LIB_ASSERT.deepStrictEqual( events, [ { Event: 'document' } ] );

			// A refused edit writes nothing.
			let refused = await held.Invoke( { Command: 'query add', json: { Name: 'Read left', DataSource: 'Left', Criteria: {} } } );
			LIB_ASSERT.notStrictEqual( refused.ExitCode, 0 );
			LIB_ASSERT.strictEqual( events.length, 1 );

			// The session's own write, read back, is not a reload.
			let own = await held.Reload();
			LIB_ASSERT.strictEqual( own.Reason, 'unchanged' );
			LIB_ASSERT.strictEqual( events.length, 1 );

			// An edit on disk.
			events.length = 0;
			let document = JSON.parse( LIB_FS.readFileSync( file, 'utf8' ) );
			document.Objects.push( { Kind: 'Query', Name: 'Read right', DataSource: 'Right', Criteria: {} } );
			LIB_FS.writeFileSync( file, JSON.stringify( document, null, '\t' ) );
			let reloaded = await held.Reload();
			LIB_ASSERT.strictEqual( reloaded.Reloaded, true );
			LIB_ASSERT.deepStrictEqual( events.map( function ( Event ) { return Event.Event; } ), [ 'reload', 'document' ] );
			LIB_ASSERT.strictEqual( events[ 0 ].Outcome, reloaded );

			// A file which no longer parses is read, kept, and the document is unchanged.
			events.length = 0;
			LIB_FS.writeFileSync( file, '{ not json' );
			let kept = await held.Reload();
			LIB_ASSERT.strictEqual( kept.Reason, 'kept' );
			LIB_ASSERT.deepStrictEqual( events.map( function ( Event ) { return Event.Event; } ), [ 'reload' ] );

			// Repairing it back to the text the session already follows changes nothing, and tells nobody:
			// a kept reload never replaced what the session holds.
			LIB_FS.writeFileSync( file, JSON.stringify( document, null, '\t' ) );
			LIB_ASSERT.strictEqual( ( await held.Reload() ).Reason, 'unchanged' );
			LIB_ASSERT.deepStrictEqual( events.map( function ( Event ) { return Event.Event; } ), [ 'reload' ] );

			// A stopped listener hears nothing more.
			let heard = others.length;
			stop_other();
			document.Objects.push( { Kind: 'Query', Name: 'Read left again', DataSource: 'Left', Criteria: {} } );
			LIB_FS.writeFileSync( file, JSON.stringify( document, null, '\t' ) );
			LIB_ASSERT.strictEqual( ( await held.Reload() ).Reloaded, true );
			LIB_ASSERT.strictEqual( others.length, heard );
			LIB_ASSERT.deepStrictEqual( events.map( function ( Event ) { return Event.Event; } ), [ 'reload', 'reload', 'document' ] );
		}
		finally { await held.Release(); }
	} );

} );
