'use strict';

const LIB_ASSERT = require( 'assert' );
const LIB_CHILD_PROCESS = require( 'child_process' );
const LIB_FS = require( 'fs' );
const LIB_OS = require( 'os' );
const LIB_PATH = require( 'path' );
const { describe, it, before, after } = require( 'node:test' );

const Session = require( '../src/Session/Session.js' );
const Debugger = require( '../src/Session/Debugger.js' );
const Spec = require( './fixtures/Spec.js' );

const BIN = LIB_PATH.resolve( __dirname, '..', 'bin', 'jsonx.js' );


//---------------------------------------------------------------------
function session_for( Document, Extra )
{
	return Session.NewSession( Object.assign( { Document: Document, Env: {} }, Extra || {} ) );
}

function memory( Names )
{
	return Names.map( function ( Name ) { return { Name: Name, AdapterName: 'jsonstor-memory' }; } );
}

// Sends commands until the debug finishes or they run out. Answers every snapshot, the first included.
async function drive( Debug, Commands )
{
	let snapshots = [ await Debug.Start() ];
	for ( let index = 0; index < Commands.length && !Debug.Finished; index++ )
	{
		snapshots.push( await Debug.Command( Commands[ index ] ) );
	}
	return snapshots;
}

function last( Snapshots )
{
	return Snapshots[ Snapshots.length - 1 ];
}

function repeat( Command, Count )
{
	let commands = [];
	for ( let index = 0; index < Count; index++ ) { commands.push( Command ); }
	return commands;
}


//---------------------------------------------------------------------
describe( 'Debugger', function ()
{

	it( 'steps Appendix B\'s Prepare the season to the result jsonx run gives, with the same report', async function ()
	{
		let ran = session_for( Spec.AppendixB() );
		let run_report = await ran.Run( 'Prepare the season' );
		await ran.Release();

		let session = session_for( Spec.AppendixB() );
		let debug = Debugger.NewDebugger( session, 'Prepare the season' );
		let snapshots = await drive( debug, repeat( 'step', 100 ) );

		LIB_ASSERT.deepStrictEqual( last( snapshots ), { Command: 'step', Finished: true, Outcome: 'done', Result: run_report.Result } );
		LIB_ASSERT.deepStrictEqual(
			debug.Report.Calls.map( function ( Call ) { return Call.Name + ': ' + Call.Summary; } ),
			run_report.Calls.map( function ( Call ) { return Call.Name + ': ' + Call.Summary; } ) );
		LIB_ASSERT.strictEqual( debug.Report.Calls[ 1 ].Fired.length, 1, 'the trigger fired under the insert' );
		LIB_ASSERT.strictEqual( snapshots.length, 12, 'the first, two commands per call for five calls, and one for the return' );
		await session.Release();
	} );

	it( 'steps into a called Process with a DataSource, over its documents, and back out', async function ()
	{
		let session = session_for( Spec.AppendixB() );
		let debug = Debugger.NewDebugger( session, 'Prepare the season' );

		// Four objects: step onto each call, step to run it. Then onto the fifth call.
		let snapshots = await drive( debug, repeat( 'step', 9 ).concat( [ 'into' ] ) );
		let inside = last( snapshots );
		LIB_ASSERT.strictEqual( inside.Depth, 1 );
		LIB_ASSERT.strictEqual( inside.Process, 'Assign a dome to each confirmed booking' );
		LIB_ASSERT.deepStrictEqual( inside.Document, { Index: 0, Of: 1 } );
		LIB_ASSERT.strictEqual( inside.State.Document._id, 'b-1' );
		LIB_ASSERT.match( inside.Step, /^Call FindOne on "Telescopes"/ );

		let back = await debug.Command( 'continue' );
		LIB_ASSERT.strictEqual( back.Status, 'waiting', 'continue stops at the next call' );
		back = await debug.Command( 'continue' );
		LIB_ASSERT.strictEqual( back.Depth, 0, 'the frame finished and answered its caller' );
		LIB_ASSERT.deepStrictEqual( back.State.Assigned, [ { Booking: 'b-1', Observer: 'R. Okafor', Dome: 'B' } ] );

		let done = await debug.Command( 'continue' );
		LIB_ASSERT.strictEqual( done.Outcome, 'done' );
		LIB_ASSERT.strictEqual( debug.Report.Calls[ 4 ].Summary, 'ran 1, into Assignments 1' );
		LIB_ASSERT.strictEqual( await session.DataSources.Open( 'Assignments' ).Count( {} ), 1 );
		await session.Release();
	} );

	it( 'declines a call, says what it would have done, and a $try catches it', async function ()
	{
		let document = { DataSources: memory( [ 'S' ] ), Objects: [ { Kind: 'Process', Name: 'Guarded', Steps: [
			{ $try: { Do: [ { $call: { Name: 'Count', With: { DataSource: 'S', Criteria: { $literal: { Size: { $gt: 1 } } } }, Into: 'n' } } ], Catch: [ { $return: '$err.Message' } ], As: 'err' } },
			{ $return: '$n' },
		] } ] };
		let session = session_for( document );
		let debug = Debugger.NewDebugger( session, 'Guarded' );

		let snapshots = await drive( debug, [ 'step', 'step', 'decline' ] );
		let declined = last( snapshots );
		LIB_ASSERT.deepStrictEqual( declined.Declined, { Function: 'Count', DataSource: 'S', Parameters: { Criteria: { Size: { $gt: 1 } } } } );
		LIB_ASSERT.deepStrictEqual( declined.Cursor, [ 0, 'Catch', 0 ] );

		let done = await debug.Command( 'continue' );
		LIB_ASSERT.strictEqual( done.Outcome, 'done' );
		LIB_ASSERT.strictEqual( done.Result, 'Declined by the debugger: [Count] was not run.' );
		await session.Release();
	} );

	it( 'answers a waiting call by hand, and refuses answer and decline with nothing waiting', async function ()
	{
		let document = { DataSources: memory( [ 'S' ] ), Objects: [ { Kind: 'Process', Name: 'Ask', Steps: [
			{ $call: { Name: 'Count', With: { DataSource: 'S' }, Into: 'n' } },
			{ $return: '$n' },
		] } ] };
		let session = session_for( document );
		let debug = Debugger.NewDebugger( session, 'Ask' );

		LIB_ASSERT.match( ( await drive( debug, [ 'answer 1' ] ) )[ 1 ].Error, /Nothing is waiting/ );
		LIB_ASSERT.match( ( await debug.Command( 'decline' ) ).Error, /Nothing is waiting/ );
		await debug.Command( 'step' );
		LIB_ASSERT.match( ( await debug.Command( 'answer {nope' ) ).Error, /not one/ );
		LIB_ASSERT.strictEqual( ( await debug.Command( 'answer 7' ) ).Status, 'ready' );
		LIB_ASSERT.deepStrictEqual( await debug.Command( 'step' ), { Command: 'step', Finished: true, Outcome: 'done', Result: 7 } );
		LIB_ASSERT.match( ( await debug.Command( 'state' ) ).Error, /debug is over/ );
		await session.Release();
	} );

	it( 'skips a document, keeps inserts across commands, and quits', async function ()
	{
		let document = { DataSources: memory( [ 'S', 'Out' ] ), Objects: [
			{ Kind: 'Insert', Name: 'Seed', DataSource: 'S', Documents: [ { _id: 'a' }, { _id: 'b' }, { _id: 'c' } ] },
			{ Kind: 'Process', Name: 'Each', DataSource: 'S', Steps: [ { $return: { Id: '$Document._id' } } ], Into: 'Out' },
		] };
		let session = session_for( document );
		await session.Run( 'Seed' );

		let debug = Debugger.NewDebugger( session, 'Each' );
		let snapshots = await drive( debug, [ 'skip' ] );
		LIB_ASSERT.deepStrictEqual( last( snapshots ).Document, { Index: 1, Of: 3 } );
		let done = await debug.Command( 'continue' );
		LIB_ASSERT.deepStrictEqual( done.Result, [ { Id: 'b' }, { Id: 'c' } ] );
		LIB_ASSERT.strictEqual( debug.Report.Summary, 'ran 2, skipped 1, into Out 2' );
		LIB_ASSERT.strictEqual( await session.DataSources.Open( 'Out' ).Count( {} ), 2 );

		let quitting = Debugger.NewDebugger( session, 'Each' );
		let quit = last( await drive( quitting, [ 'quit' ] ) );
		LIB_ASSERT.strictEqual( quit.Outcome, 'quit' );
		LIB_ASSERT.strictEqual( quitting.Report.Error.Code, 'Quit' );
		LIB_ASSERT.deepStrictEqual( session.Runner.ActiveProcesses, [] );
		LIB_ASSERT.deepStrictEqual( session.Runner.Stack, [] );

		let no_source = Debugger.NewDebugger( session_for( { Objects: [ { Kind: 'Process', Name: 'Once', Steps: [ { $return: 1 } ] } ] } ), 'Once' );
		LIB_ASSERT.match( ( await drive( no_source, [ 'skip' ] ) )[ 1 ].Error, /has no DataSource/ );
		await session.Release();
	} );

	it( 'holds the trigger guard while a frame is open, and still fires the other triggers', async function ()
	{
		let document = {
			DataSources: memory( [ 'S', 'Log' ] ),
			Objects: [
				{ Kind: 'Process', Name: 'Copy', DataSource: 'S', Criteria: { Kind: 'seed' }, Steps: [
					{ $call: { Name: 'InsertOne', With: { DataSource: 'S', Document: { Kind: 'copy' } } } },
					{ $return: 1 },
				] },
				{ Kind: 'Process', Name: 'Note', DataSource: 'S', Steps: [ { $return: { Seen: '$Document.Kind' } } ], Into: 'Log' },
			],
			Triggers: [
				{ Name: 'Copy on insert', On: [ 'Insert' ], Process: 'Copy' },
				{ Name: 'Note on insert', On: [ 'Insert' ], Process: 'Note' },
			],
		};
		let session = session_for( document );
		// ***The seed is inserted with both Processes marked active***, which is how the guard lets a
		// write through without firing either trigger.
		session.Runner.ActiveProcesses.push( 'Copy', 'Note' );
		await session.DataSources.Open( 'S' ).InsertOne( { Kind: 'seed' } );
		session.Runner.ActiveProcesses.length = 0;

		let debug = Debugger.NewDebugger( session, 'Copy' );
		let done = last( await drive( debug, repeat( 'step', 10 ) ) );
		LIB_ASSERT.strictEqual( done.Outcome, 'done' );
		LIB_ASSERT.strictEqual( await session.DataSources.Open( 'S' ).Count( {} ), 2, 'Copy did not fire itself for its own insert' );
		LIB_ASSERT.deepStrictEqual( debug.Report.Fired.map( function ( Fired ) { return Fired.Trigger; } ), [ 'Note on insert' ] );
		await session.Release();
	} );

	it( 'fails a run which goes past the step limit', async function ()
	{
		let document = { Objects: [ { Kind: 'Process', Name: 'Forever', Steps: [ { $while: { Check: {}, Do: [ { $do: { x: 1 } } ] } } ] } ] };
		let session = session_for( document, { MaxSteps: 20 } );
		let debug = Debugger.NewDebugger( session, 'Forever' );
		let done = last( await drive( debug, [ 'continue' ] ) );
		LIB_ASSERT.strictEqual( done.Outcome, 'failed' );
		LIB_ASSERT.match( done.Error.Message, /more than 20 steps/ );
		await session.Release();
	} );

	it( 'refuses a name which is not a Process, and finds the step a cursor points at', function ()
	{
		let session = session_for( Spec.AppendixB() );
		LIB_ASSERT.throws( function () { Debugger.NewDebugger( session, 'Two telescopes' ); }, /is not a Process/ );
		LIB_ASSERT.throws( function () { Debugger.NewDebugger( session, 'Nobody' ); }, /No object is named/ );

		let process = { Steps: [ { $do: {} }, { $forEach: { In: '$l', As: 'i', Do: [ { $when: { Check: {}, Then: [ { $return: 1 } ] } } ] } } ] };
		LIB_ASSERT.deepStrictEqual( Debugger.StepAt( process, [ 1, [ 'Do', 3 ], 0, 'Then', 0 ] ), { $return: 1 } );
		LIB_ASSERT.strictEqual( Debugger.StepAt( process, [] ), null );
		LIB_ASSERT.strictEqual( Debugger.StepAt( process, [ 5 ] ), null );
	} );

} );


//---------------------------------------------------------------------
describe( 'jsonx debug', function ()
{

	let root = null;

	function cli( Argv, Stdin )
	{
		let env = Object.assign( {}, process.env );
		delete env.JSONX_FILE;
		let result = LIB_CHILD_PROCESS.spawnSync( process.execPath, [ BIN ].concat( Argv ), { cwd: root, env: env, encoding: 'utf8', input: Stdin } );
		return { Code: result.status, Stdout: result.stdout, Stderr: result.stderr };
	}

	function lines( Stdout )
	{
		return Stdout.trim().split( '\n' ).map( function ( Line ) { return JSON.parse( Line ); } );
	}

	before( function ()
	{
		root = LIB_FS.mkdtempSync( LIB_PATH.join( LIB_OS.tmpdir(), 'jsonx-debug-' ) );
		LIB_FS.writeFileSync( LIB_PATH.join( root, 'observatory.jsonx' ), JSON.stringify( Spec.AppendixB(), null, '\t' ) );
	} );

	after( function ()
	{
		LIB_FS.rmSync( root, { recursive: true, force: true } );
	} );

	it( 'writes a JSON line per command and exits 0 with the specification\'s result in the last', function ()
	{
		let result = cli( [ 'debug', 'Prepare the season' ], 'continue\n\ncontinue\ncontinue\ncontinue\ncontinue\ncontinue\n' );
		LIB_ASSERT.strictEqual( result.Code, 0, result.Stderr );
		let snapshots = lines( result.Stdout );
		LIB_ASSERT.deepStrictEqual( snapshots[ snapshots.length - 1 ].Result, [ { Booking: 'b-1', Observer: 'R. Okafor', Dome: 'B' } ] );
		LIB_ASSERT.match( result.Stderr, /^Prepare the season  Process  ran once/ );
	} );

	it( 'stops at the end of input, as quit does, with exit 1', function ()
	{
		let result = cli( [ 'debug', 'Prepare the season' ], 'step\n' );
		LIB_ASSERT.strictEqual( result.Code, 1 );
		let snapshots = lines( result.Stdout );
		LIB_ASSERT.strictEqual( snapshots.length, 3 );
		LIB_ASSERT.deepStrictEqual( snapshots[ 2 ], { Command: 'quit', Finished: true, Outcome: 'quit', Error: { Code: 'Quit', Message: 'Stopped by the debugger before the Process [Prepare the season] finished.' } } );
	} );

	it( 'exits 2 for --output, for a value read from standard input, and for an object which is not a Process', function ()
	{
		let output = cli( [ 'debug', 'Prepare the season', '--output', 'jsonl' ], '' );
		LIB_ASSERT.strictEqual( output.Code, 2 );
		LIB_ASSERT.match( output.Stderr, /--output\] does not apply/ );

		let stdin = cli( [ 'debug', 'Prepare the season', '--input', '-' ], '{}' );
		LIB_ASSERT.strictEqual( stdin.Code, 2 );
		LIB_ASSERT.match( stdin.Stderr, /reads its commands from standard input/ );

		let insert = cli( [ 'debug', 'Two telescopes' ], '' );
		LIB_ASSERT.strictEqual( insert.Code, 2 );
		LIB_ASSERT.match( insert.Stderr, /is not a Process/ );
		LIB_ASSERT.strictEqual( insert.Stdout, '' );
	} );

} );
