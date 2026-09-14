'use strict';

/*
	A served debug (cut 4, decision 3): jsonx debug held as a conversation (Held.Converse), and the
	WebSocket's Debug and Step messages over it.
*/

const LIB_ASSERT = require( 'assert' );
const LIB_FS = require( 'fs' );
const LIB_OS = require( 'os' );
const LIB_PATH = require( 'path' );
const { describe, it, before, after } = require( 'node:test' );

const Api = require( '../modes/api/Api.js' );
const Main = require( '../modes/cli/Main.js' );
const Envelope = require( '../src/Envelope.js' );
const Held = require( '../src/Session/Held.js' );
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

function io_for( File )
{
	let io = Parser.DefaultIo();
	io.Env = {};
	io.Cwd = LIB_PATH.dirname( File );
	return io;
}

function hold( File, Extra )
{
	return Held.NewHeld( Object.assign( { Tree: Commands.TREE, File: File, Io: io_for( File ) }, Extra || {} ) );
}

function without_times( Envelope_ )
{
	return Object.assign( {}, Envelope_, { Log: Envelope_.Log.map( function ( Line ) { return Line.replace( /\s\d+ ms$/, ' - ms' ); } ) } );
}

function wait( Ms ) { return new Promise( function ( Resolve ) { setTimeout( Resolve, Ms ); } ); }

// Sends `continue` until the conversation finishes. Answers every Send's answer.
async function continue_to_end( Conversation )
{
	let answers = [];
	for ( let count = 0; count < 200; count++ )
	{
		let sent = await Conversation.Send( 'continue' );
		answers.push( sent );
		if ( !sent.Ok || sent.Record.Finished ) { break; }
	}
	return answers;
}

// jsonx debug on the command line, fed the lines given, answering its envelope.
async function debug_on_command_line( File, Name, Lines )
{
	let io = io_for( File );
	io.Stdout = function () { return; };
	io.Stderr = function () { return; };
	io.Lines = async function* () { for ( let line of Lines ) { yield line; } };
	let out = Envelope.NewOut();
	let code = await Main.Main( [ 'debug', Name, '--file', File ], io, undefined, { Out: out } );
	return out.Envelope( code );
}

// A WebSocket client keeping every message, answering the next one to pass a test.
function connect( Url )
{
	return new Promise( function ( Resolve, Reject )
	{
		let socket = new WebSocket( Url );
		let client = { Socket: socket, Messages: [], Waiters: [] };
		client.Closing = new Promise( function ( Done ) { socket.onclose = function ( Event ) { Done( Event.code ); }; } );
		socket.onmessage = function ( Event )
		{
			let message = JSON.parse( String( Event.data ) );
			client.Messages.push( message );
			client.Waiters = client.Waiters.filter( function ( Waiter ) { if ( !Waiter.Test( message ) ) { return true; } Waiter.Resolve( message ); return false; } );
		};
		socket.onerror = function () { if ( socket.readyState !== WebSocket.OPEN ) { Reject( new Error( 'The WebSocket did not open.' ) ); } };
		socket.onopen = function () { Resolve( client ); };
		client.Next = function ( Test )
		{
			return new Promise( function ( Done, Fail )
			{
				let timer = setTimeout( function () { Fail( new Error( 'No such message within the time.' ) ); }, 10000 );
				client.Waiters.push( { Test: Test, Resolve: function ( Message ) { clearTimeout( timer ); Done( Message ); } } );
			} );
		};
		client.Ask = function ( Message )
		{
			let answered = client.Next( function ( Each ) { return Each.Id === Message.Id && Each.Answer; } );
			socket.send( JSON.stringify( Message ) );
			return answered.then( function ( Each ) { return Each.Answer; } );
		};
	} );
}


//---------------------------------------------------------------------
describe( 'A served debug', function ()
{

	let root = null;
	let observatory = null;
	let broken = null;

	before( function ()
	{
		root = LIB_FS.mkdtempSync( LIB_PATH.join( LIB_OS.tmpdir(), 'jsonx-wsdebug-' ) );
		observatory = write( root, 'observatory.jsonx', Spec.AppendixB() );
		let document = Spec.AppendixB();
		document.Objects.find( function ( Entry ) { return typeof Entry.DataSource === 'string'; } ).DataSource = 'Nowhere';
		broken = write( root, 'broken.jsonx', document );
	} );

	after( function () { LIB_FS.rmSync( root, { recursive: true, force: true } ); } );


	it( 'is jsonx debug: conversed with to the end, it answers the envelope the command line answers', async function ()
	{
		let held = hold( observatory );
		try
		{
			let heard = [];
			let conversation = held.Converse( { Command: 'debug', process: 'Prepare the season' }, function ( Progress ) { if ( Progress.Line ) { heard.push( Progress.Line ); } } );
			let answers = await continue_to_end( conversation );
			let envelope = await conversation.Done;
			LIB_ASSERT.strictEqual( envelope.ExitCode, 0, envelope.Log.join( '\n' ) );
			LIB_ASSERT.strictEqual( conversation.Over, true );

			// Every record was heard as it was written; each Send answered the record its line produced.
			LIB_ASSERT.deepStrictEqual( heard, envelope.Result );
			LIB_ASSERT.deepStrictEqual( answers.map( function ( Each ) { return Each.Record; } ), envelope.Result.slice( 1 ) );
			let last = envelope.Result[ envelope.Result.length - 1 ];
			LIB_ASSERT.deepStrictEqual( [ last.Finished, last.Outcome, last.Result ], [ true, 'done', [ { Booking: 'b-1', Observer: 'R. Okafor', Dome: 'B' } ] ] );

			let typed = await debug_on_command_line( observatory, 'Prepare the season', answers.map( function () { return 'continue'; } ) );
			LIB_ASSERT.deepStrictEqual( without_times( envelope ), without_times( typed ) );

			let after_it = await conversation.Send( 'step' );
			LIB_ASSERT.deepStrictEqual( after_it, { Ok: false, Message: 'The conversation is over.' } );
		}
		finally { await held.Release(); }
	} );

	it( 'holds the queue while open: queued requests wait, concurrent ones answer, and every listener is told', async function ()
	{
		let held = hold( observatory );
		let events = [];
		held.OnEvent( function ( Event ) { if ( Event.Event === 'queue' ) { events.push( Event ); } } );
		try
		{
			let conversation = held.Converse( { Command: 'debug', process: 'Prepare the season' } );
			let first = await conversation.Send( 'step' );
			LIB_ASSERT.strictEqual( first.Ok, true );
			LIB_ASSERT.deepStrictEqual( events, [ { Event: 'queue', HeldBy: 'debug' } ] );

			let ran = false;
			let queued = held.Invoke( { Command: 'data count', name: 'Bookings' } ).then( function ( Answer ) { ran = true; return Answer; } );
			let validated = await held.Invoke( { Command: 'validate' } );
			LIB_ASSERT.strictEqual( validated.ExitCode, 0 );
			await wait( 150 );
			LIB_ASSERT.strictEqual( ran, false, 'a queued request waits while the debug is open' );

			let quit = await conversation.Send( 'quit' );
			LIB_ASSERT.deepStrictEqual( [ quit.Record.Finished, quit.Record.Outcome ], [ true, 'quit' ] );
			let envelope = await conversation.Done;
			LIB_ASSERT.strictEqual( envelope.ExitCode, 1 );
			LIB_ASSERT.strictEqual( ( await queued ).ExitCode, 0 );
			LIB_ASSERT.deepStrictEqual( events, [ { Event: 'queue', HeldBy: 'debug' }, { Event: 'queue', HeldBy: null } ] );
		}
		finally { await held.Release(); }
	} );

	it( 'ends when its input ends, as jsonx debug does at the end of standard input, and Release ends it', async function ()
	{
		let held = hold( observatory );
		try
		{
			let ended = held.Converse( { Command: 'debug', process: 'Prepare the season' } );
			await ended.Send( 'step' );
			ended.End();
			let envelope = await ended.Done;
			LIB_ASSERT.strictEqual( envelope.ExitCode, 1 );
			LIB_ASSERT.strictEqual( envelope.Result[ envelope.Result.length - 1 ].Outcome, 'quit' );

			let open = held.Converse( { Command: 'debug', process: 'Prepare the season' } );
			await open.Send( 'state' );
		}
		finally
		{
			// An open conversation holds the queue; Release must not wait for it for ever.
			let released = await Promise.race( [ held.Release().then( function () { return 'released'; } ), wait( 5000 ).then( function () { return 'stuck'; } ) ] );
			LIB_ASSERT.strictEqual( released, 'released' );
		}
	} );

	it( 'refuses as jsonx debug refuses, and only a conversational command can be conversed with', async function ()
	{
		let held = hold( observatory );
		try
		{
			let not_process = held.Converse( { Command: 'debug', process: 'Bookings' } );
			let sent = await not_process.Send( 'step' );
			LIB_ASSERT.strictEqual( sent.Ok, false );
			let refused = await not_process.Done;
			LIB_ASSERT.strictEqual( refused.ExitCode, 2 );
			LIB_ASSERT.match( refused.Log.join( '\n' ), /is not a Process|No object is named/ );

			let not_conversational = await held.Converse( { Command: 'run', name: 'Prepare the season' } ).Done;
			LIB_ASSERT.strictEqual( not_conversational.ExitCode, 2 );
			LIB_ASSERT.match( not_conversational.Log.join( '\n' ), /is not a conversation/ );

			let invoked = await held.Invoke( { Command: 'debug', process: 'Prepare the season' } );
			LIB_ASSERT.strictEqual( invoked.ExitCode, 2 );
			LIB_ASSERT.match( invoked.Log.join( '\n' ), /is not served: .*WebSocket/ );

			let blank = held.Converse( { Command: 'debug', process: 'Prepare the season' } );
			LIB_ASSERT.deepStrictEqual( await blank.Send( '   ' ), { Ok: false, Message: 'A line must say something.' } );
			blank.End();
			await blank.Done;
		}
		finally { await held.Release(); }

		let with_errors = hold( broken );
		try
		{
			let envelope = await with_errors.Converse( { Command: 'debug', process: 'Prepare the season' } ).Done;
			LIB_ASSERT.strictEqual( envelope.ExitCode, 3 );
		}
		finally { await with_errors.Release(); }
	} );


	//---------------------------------------------------------------------
	describe( 'over the WebSocket', function ()
	{

		async function serve( File )
		{
			let held = hold( File );
			let server = await Api.Listen( Api.NewApi( held, { Host: '127.0.0.1', Version: 'test' } ), '127.0.0.1', 0 );
			return {
				Held: held,
				Url: 'ws://127.0.0.1:' + server.address().port + '/ws',
				Close: async function () { await Api.Close( server ); await held.Release(); },
			};
		}

		it( 'steps to the end: a debug event per snapshot, a Step answer per line, and the Debug answered last', async function ()
		{
			let served = await serve( observatory );
			try
			{
				let client = await connect( served.Url );
				let started = client.Next( function ( Message ) { return Message.Id === 'd' && Message.Event === 'debug'; } );
				let debug_answer = client.Next( function ( Message ) { return Message.Id === 'd' && Message.Answer; } );
				client.Socket.send( JSON.stringify( { Id: 'd', Debug: { process: 'Prepare the season' } } ) );
				// ***Steps are sent before the debug has started***: each still answers its own line's
				// snapshot, never the first one, which belongs to the Debug.

				let steps = [];
				for ( let count = 0; count < 200; count++ )
				{
					let answer = await client.Ask( { Id: 's' + count, Step: 'continue' } );
					LIB_ASSERT.strictEqual( answer.ExitCode, 0, answer.Log.join( '\n' ) );
					steps.push( answer.Result );
					if ( answer.Result.Finished ) { break; }
				}
				await started;
				let envelope = ( await debug_answer ).Answer;
				LIB_ASSERT.strictEqual( envelope.ExitCode, 0, envelope.Log.join( '\n' ) );

				let snapshots = client.Messages.filter( function ( Message ) { return Message.Id === 'd' && Message.Event === 'debug'; } ).map( function ( Message ) { return Message.Snapshot; } );
				LIB_ASSERT.deepStrictEqual( snapshots, envelope.Result );
				LIB_ASSERT.deepStrictEqual( steps, envelope.Result.slice( 1 ) );
				let mine = client.Messages.filter( function ( Message ) { return Message.Id === 'd'; } );
				LIB_ASSERT.ok( mine[ mine.length - 1 ].Answer, 'the Debug\'s answer is the last message for its Id' );
				LIB_ASSERT.ok( mine.some( function ( Message ) { return Message.Event === 'report'; } ), 'the debug\'s reports are pushed too' );

				let typed = await debug_on_command_line( observatory, 'Prepare the season', steps.map( function () { return 'continue'; } ) );
				LIB_ASSERT.deepStrictEqual( without_times( envelope ), without_times( typed ) );

				let over = await client.Ask( { Id: 'after', Step: 'step' } );
				LIB_ASSERT.match( over.Log.join( '\n' ), /Nothing is being debugged/ );
				client.Socket.close();
			}
			finally { await served.Close(); }
		} );

		it( 'makes another client\'s run wait, and closing the debugging connection quits it and frees the queue', async function ()
		{
			let served = await serve( observatory );
			try
			{
				let debugger_client = await connect( served.Url );
				let other = await connect( served.Url );
				let held_by = other.Next( function ( Message ) { return Message.Event === 'queue' && Message.HeldBy === 'debug'; } );
				let started = debugger_client.Next( function ( Message ) { return Message.Event === 'debug'; } );
				debugger_client.Socket.send( JSON.stringify( { Id: 'd', Debug: { process: 'Prepare the season' } } ) );
				await started;
				await held_by;

				let answered = false;
				let run = other.Ask( { Id: 'r', Invoke: { Command: 'data count', name: 'Bookings' } } ).then( function ( Answer ) { answered = true; return Answer; } );
				let concurrent = await other.Ask( { Id: 'v', Invoke: { Command: 'validate' } } );
				LIB_ASSERT.strictEqual( concurrent.ExitCode, 0 );
				await wait( 150 );
				LIB_ASSERT.strictEqual( answered, false, 'the run waits for the debug' );

				let freed = other.Next( function ( Message ) { return Message.Event === 'queue' && Message.HeldBy === null; } );
				debugger_client.Socket.close();
				await freed;
				LIB_ASSERT.strictEqual( ( await run ).ExitCode, 0 );
				other.Socket.close();
			}
			finally { await served.Close(); }
		} );

		it( 'refuses a second debug on one connection, a Step with nothing to step, and a Debug naming a Command', async function ()
		{
			let served = await serve( observatory );
			try
			{
				let client = await connect( served.Url );
				let nothing = await client.Ask( { Id: 'a', Step: 'step' } );
				LIB_ASSERT.match( nothing.Log.join( '\n' ), /Nothing is being debugged/ );
				let not_string = await client.Ask( { Id: 'b', Step: 3 } );
				LIB_ASSERT.match( not_string.Log.join( '\n' ), /one debug command as a string/ );
				let named = await client.Ask( { Id: 'c', Debug: { Command: 'run', process: 'Prepare the season' } } );
				LIB_ASSERT.match( named.Log.join( '\n' ), /cannot name a Command/ );

				let started = client.Next( function ( Message ) { return Message.Id === 'd' && Message.Event === 'debug'; } );
				let ended = client.Next( function ( Message ) { return Message.Id === 'd' && Message.Answer; } );
				client.Socket.send( JSON.stringify( { Id: 'd', Debug: { process: 'Prepare the season' } } ) );
				await started;
				let second = await client.Ask( { Id: 'e', Debug: { process: 'Prepare the season' } } );
				LIB_ASSERT.match( second.Log.join( '\n' ), /already debugging, under the Id \[d\]/ );

				let quit = await client.Ask( { Id: 'q', Step: 'quit' } );
				LIB_ASSERT.strictEqual( quit.Result.Outcome, 'quit' );
				LIB_ASSERT.strictEqual( ( await ended ).Answer.ExitCode, 1 );

				// Once it ended, a new debug may open.
				let again = client.Next( function ( Message ) { return Message.Id === 'f' && Message.Event === 'debug'; } );
				client.Socket.send( JSON.stringify( { Id: 'f', Debug: { process: 'Prepare the season' } } ) );
				await again;
				client.Socket.close();
			}
			finally { await served.Close(); }
		} );

	} );

} );
