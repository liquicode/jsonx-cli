'use strict';

/*
	The profile on every surface (cut 7, step 3): the Web API's root, the WebSocket's Hello and Profile request,
	MCP's tools, initialize and jsonx/profile, and jsonx mcp's defaults. The profile is set once, at launch.
	The profile itself and the held session's enforcement are Profiles.test.js.
*/

const LIB_ASSERT = require( 'assert' );
const LIB_FS = require( 'fs' );
const LIB_OS = require( 'os' );
const LIB_PATH = require( 'path' );
const { describe, it, before, after } = require( 'node:test' );

const Held = require( '../src/Session/Held.js' );
const Parser = require( '../src/CommandLine/Parser.js' );
const Commands = require( '../commands/jsonx.js' );
const Main = require( '../modes/cli/Main.js' );
const Api = require( '../modes/api/Api.js' );
const Protocol = require( '../modes/mcp/Protocol.js' );
const Stdio = require( '../modes/mcp/Stdio.js' );
const Spec = require( './fixtures/Spec.js' );


const TRANSLATE = [ 'validate', 'plan', 'explain', 'datasource list', 'datasource describe', 'datasource find', 'datasource count', 'query list', 'insert list', 'update list', 'delete list', 'process list', 'trigger list' ];


//---------------------------------------------------------------------
function io_for( File )
{
	let io = Parser.DefaultIo();
	io.Env = {};
	io.Cwd = LIB_PATH.dirname( File );
	return io;
}

function hold( File, Profile )
{
	return Held.NewHeld( { Tree: Commands.TREE, File: File, Io: io_for( File ), Profile: Profile } );
}

// A held file served on a free loopback port, with the WebSocket on it.
async function serve( File, Profile )
{
	let held = hold( File, Profile );
	let app = Api.NewApi( held, { Host: '127.0.0.1', Version: 'test' } );
	let server = await Api.Listen( app, '127.0.0.1', 0 );
	let port = server.address().port;
	return {
		Held: held,
		Base: 'http://127.0.0.1:' + port,
		Url: 'ws://127.0.0.1:' + port + '/ws',
		Close: async function () { await Api.Close( server ); await held.Release(); },
	};
}

async function get( Base, Route )
{
	let response = await fetch( Base + Route );
	return { Status: response.status, Json: await response.json() };
}

async function post( Base, Route, Body )
{
	let response = await fetch( Base + Route, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify( Body || {} ) } );
	return { Status: response.status, Json: await response.json() };
}

// A connected client which keeps every message and answers the next one passing a test.
function connect( Url )
{
	return new Promise( function ( Resolve, Reject )
	{
		let socket = new WebSocket( Url );
		let client = { Socket: socket, Messages: [], Waiters: [] };
		socket.onmessage = function ( Event )
		{
			let message = JSON.parse( String( Event.data ) );
			client.Messages.push( message );
			client.Waiters = client.Waiters.filter( function ( Waiter )
			{
				if ( !Waiter.Test( message ) ) { return true; }
				Waiter.Resolve( message );
				return false;
			} );
		};
		socket.onerror = function () { if ( socket.readyState !== WebSocket.OPEN ) { Reject( new Error( 'The WebSocket did not open.' ) ); } };
		socket.onopen = function () { Resolve( client ); };
		client.Next = function ( Test )
		{
			return new Promise( function ( ResolveNext, RejectNext )
			{
				let timer = setTimeout( function () { RejectNext( new Error( 'No such message within the time.' ) ); }, 5000 );
				client.Waiters.push( { Test: Test, Resolve: function ( Message ) { clearTimeout( timer ); ResolveNext( Message ); } } );
			} );
		};
		client.Hello = function ()
		{
			let hello = client.Messages.find( function ( Message ) { return Message.Hello; } );
			return hello ? Promise.resolve( hello.Hello ) : client.Next( function ( Message ) { return Message.Hello; } ).then( function ( Message ) { return Message.Hello; } );
		};
		client.Send = async function ( Message )
		{
			let answered = client.Next( function ( Each ) { return Each.Id === Message.Id && Each.Answer; } );
			socket.send( JSON.stringify( Message ) );
			return ( await answered ).Answer;
		};
		client.Close = function ()
		{
			return new Promise( function ( ResolveClose ) { socket.onclose = function () { ResolveClose(); }; socket.close(); } );
		};
	} );
}

let next_id = 500;
function request( Method, Params )
{
	let message = { jsonrpc: '2.0', id: next_id++, method: Method };
	if ( typeof Params !== 'undefined' ) { message.params = Params; }
	return message;
}

function names( Tools )
{
	return Tools.map( function ( Tool ) { return Tool.name; } );
}


//---------------------------------------------------------------------
describe( 'The profile on every surface', function ()
{

	let root = null;
	let observatory = null;

	before( function ()
	{
		root = LIB_FS.mkdtempSync( LIB_PATH.join( LIB_OS.tmpdir(), 'jsonx-profile-surfaces-' ) );
		observatory = LIB_PATH.join( root, 'observatory.jsonx' );
		LIB_FS.writeFileSync( observatory, JSON.stringify( Spec.AppendixB(), null, '\t' ) );
		LIB_FS.writeFileSync( LIB_PATH.join( root, 'mine.json' ), JSON.stringify( { Name: 'mine', Describe: 'Validate only.', Commands: [ 'validate' ] } ) );
	} );

	after( function () { LIB_FS.rmSync( root, { recursive: true, force: true } ); } );


	//---------------------------------------------------------------------
	it( 'Web API: GET / carries the profile and only its commands, with defaults and confirms; a route outside it answers 400', async function ()
	{
		let served = await serve( observatory, 'translate' );
		try
		{
			let root_ = await get( served.Base, '/' );
			LIB_ASSERT.strictEqual( root_.Status, 200 );
			LIB_ASSERT.strictEqual( root_.Json.Profile.Name, 'translate' );
			LIB_ASSERT.deepStrictEqual( root_.Json.Profile.Confirm, [] );
			// The summary has the shape of a profile file: what is held back is said, not only left out.
			LIB_ASSERT.deepStrictEqual( Object.keys( root_.Json.Profile ), [ 'Name', 'Describe', 'Commands', 'Without', 'Defaults', 'Confirm', 'Instructions' ] );
			LIB_ASSERT.deepStrictEqual( root_.Json.Profile.Without, { 'datasource find': [ 'into', 'save', 'force' ] } );
			LIB_ASSERT.deepStrictEqual( root_.Json.Profile.Defaults, { 'datasource find': { max: 5 } } );
			LIB_ASSERT.match( root_.Json.Profile.Instructions, /do not run it/ );
			LIB_ASSERT.deepStrictEqual( root_.Json.Commands.map( function ( Command ) { return Command.Command; } ), TRANSLATE );
			let find = root_.Json.Commands.find( function ( Command ) { return Command.Command === 'datasource find'; } );
			LIB_ASSERT.deepStrictEqual( find.Defaults, { max: 5 } );
			LIB_ASSERT.strictEqual( find.Confirm, false );
			LIB_ASSERT.ok( !( 'save' in find.Options ) );

			let deleted = await post( served.Base, '/datasource/delete', { name: 'Notes', criteria: {}, yes: true } );
			LIB_ASSERT.strictEqual( deleted.Status, 400 );
			LIB_ASSERT.match( deleted.Json.Log.join( '\n' ), /is not served in this session/ );

			let saved = await post( served.Base, '/datasource/find', { name: 'Bookings', criteria: {}, save: 'Kept' } );
			LIB_ASSERT.strictEqual( saved.Status, 400 );
			LIB_ASSERT.match( saved.Json.Log.join( '\n' ), /--save\] is not served in this session/ );

			let found = await post( served.Base, '/datasource/find', { name: 'Bookings', criteria: {} } );
			LIB_ASSERT.strictEqual( found.Status, 200, JSON.stringify( found.Json ) );
		}
		finally { await served.Close(); }
	} );

	it( 'Web API: with no profile, GET / lists everything under full, as before', async function ()
	{
		let served = await serve( observatory );
		try
		{
			let root_ = await get( served.Base, '/' );
			LIB_ASSERT.strictEqual( root_.Json.Profile.Name, 'full' );
			LIB_ASSERT.strictEqual( root_.Json.Commands.length, Held.ServedCommands( Commands.TREE ).length );
			let find = root_.Json.Commands.find( function ( Command ) { return Command.Command === 'datasource find'; } );
			LIB_ASSERT.strictEqual( find.Options.max.Describe, 'The most documents to read. Set to 0 for all documents.', 'no default sentence without a profile default' );

			// max 0 reads every document: the verb leaves MaxCount out, which the specification would refuse as 0.
			let ran = await post( served.Base, '/run', { name: 'Two telescopes' } );
			LIB_ASSERT.strictEqual( ran.Status, 200, JSON.stringify( ran.Json ) );
			let one = await post( served.Base, '/datasource/find', { name: 'Telescopes', criteria: {}, max: 1 } );
			LIB_ASSERT.strictEqual( one.Json.Result.length, 1 );
			let all = await post( served.Base, '/datasource/find', { name: 'Telescopes', criteria: {}, max: 0 } );
			LIB_ASSERT.strictEqual( all.Status, 200, JSON.stringify( all.Json ) );
			LIB_ASSERT.strictEqual( all.Json.Result.length, 2 );
		}
		finally { await served.Close(); }
	} );

	// ***The profile is set once, when the server is launched*** (user, 2026-09-24): Profile asks for it and
	// what it serves, and a request to change it is refused with nothing changed.
	it( 'WebSocket: Hello carries the profile; Profile asks for it; a request to change it is refused', async function ()
	{
		let served = await serve( observatory, 'translate' );
		let first = null;
		try
		{
			first = await connect( served.Url );
			let hello = await first.Hello();
			LIB_ASSERT.strictEqual( hello.Profile.Name, 'translate' );
			LIB_ASSERT.deepStrictEqual( hello.Commands.map( function ( Command ) { return Command.Command; } ), TRANSLATE );

			let asked = await first.Send( { Id: 'a', Profile: null } );
			LIB_ASSERT.strictEqual( asked.ExitCode, 0 );
			LIB_ASSERT.strictEqual( asked.Result.Name, 'translate' );
			LIB_ASSERT.deepStrictEqual( asked.Result.Commands, TRANSLATE );

			let refused = await first.Send( { Id: 'b', Profile: 'run' } );
			LIB_ASSERT.strictEqual( refused.ExitCode, 2, JSON.stringify( refused ) );
			LIB_ASSERT.match( refused.Log.join( '\n' ), /set once, when the server is launched/ );
			let ran = await first.Send( { Id: 'c', Invoke: { Command: 'run', name: 'Prepare the season' } } );
			LIB_ASSERT.strictEqual( ran.ExitCode, 2, 'run is not the translate profile\'s' );
			LIB_ASSERT.strictEqual( ( await first.Send( { Id: 'd', Profile: null } ) ).Result.Name, 'translate' );
		}
		finally
		{
			if ( first ) { await first.Close(); }
			await served.Close();
		}
	} );

	it( 'MCP: the tools are the profile\'s, initialize says so, jsonx/profile asks for it, and a request to change it is refused', async function ()
	{
		let held = hold( observatory, 'translate' );
		try
		{
			let mcp = Protocol.NewMcp( held, { Version: '1' } );

			LIB_ASSERT.deepStrictEqual( names( mcp.Tools ), TRANSLATE.map( function ( Command ) { return Command.replace( / /g, '_' ); } ) );
			let find = mcp.Tools.find( function ( Tool ) { return Tool.name === 'datasource_find'; } );
			LIB_ASSERT.ok( !( 'save' in find.inputSchema.properties ) );
			LIB_ASSERT.strictEqual( find.inputSchema.properties.max.default, 5 );
			LIB_ASSERT.strictEqual( find.inputSchema.properties.max.description, 'The most documents to read. Set to 0 for all documents. Defaults to 5.' );

			let initialized = await mcp.Handle( request( 'initialize', { protocolVersion: '2025-11-25', capabilities: {}, clientInfo: { name: 't', version: '0' } } ) );
			LIB_ASSERT.deepStrictEqual( initialized.result.capabilities, { tools: {}, resources: {} } );
			// What the session does, never what the profile is called, and the file by its name, not its path.
			LIB_ASSERT.match( initialized.result.instructions, /as written\. Build objects from what the data says; run nothing\. Build the object; do not run it\./ );
			LIB_ASSERT.doesNotMatch( initialized.result.instructions, /translate|profile/i );
			LIB_ASSERT.ok( initialized.result.instructions.includes( 'against the file ' + LIB_PATH.basename( observatory ) + '.' ), initialized.result.instructions );
			LIB_ASSERT.ok( !initialized.result.instructions.includes( LIB_PATH.dirname( observatory ) ), initialized.result.instructions );

			let asked = await mcp.Handle( request( 'jsonx/profile' ) );
			LIB_ASSERT.strictEqual( asked.result.Name, 'translate' );

			let outside = await mcp.Handle( request( 'tools/call', { name: 'run', arguments: { name: 'Prepare the season' } } ) );
			LIB_ASSERT.strictEqual( outside.error.code, Protocol.ERRORS.INVALID_PARAMS );
			LIB_ASSERT.match( outside.error.message, /Unknown tool: run/ );

			LIB_ASSERT.deepStrictEqual( asked.result.Commands, TRANSLATE, 'the commands it serves are answered too' );

			let refused = await mcp.Handle( request( 'jsonx/profile', { profile: 'run' } ) );
			LIB_ASSERT.strictEqual( refused.error.code, Protocol.ERRORS.INVALID_PARAMS );
			LIB_ASSERT.match( refused.error.message, /set once, when the server is launched/ );
			LIB_ASSERT.ok( !names( mcp.Tools ).includes( 'run' ) );
			LIB_ASSERT.strictEqual( mcp.Profile.Name, 'translate' );
			mcp.Close();
		}
		finally { await held.Release(); }
	} );

	it( 'MCP over stdio: a request to change the profile is answered with an error, and nothing else is ever sent unasked', async function ()
	{
		let held = hold( observatory, 'translate' );
		try
		{
			let written = [];
			await Stdio.ServeStdio( Protocol.NewMcp( held ), [
				JSON.stringify( { jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-11-25', capabilities: {}, clientInfo: { name: 't', version: '0' } } } ),
				JSON.stringify( { jsonrpc: '2.0', id: 2, method: 'jsonx/profile', params: { profile: 'run' } } ),
				JSON.stringify( { jsonrpc: '2.0', id: 3, method: 'tools/list' } ),
			], function ( Text ) { written.push( JSON.parse( Text ) ); } );
			LIB_ASSERT.deepStrictEqual( written.map( function ( Message ) { return Message.id; } ), [ 1, 2, 3 ], JSON.stringify( written ) );
			LIB_ASSERT.strictEqual( written[ 1 ].error.code, Protocol.ERRORS.INVALID_PARAMS );
			LIB_ASSERT.ok( !names( written[ 2 ].result.tools ).includes( 'run' ) );
		}
		finally { await held.Release(); }
	} );

	it( 'jsonx mcp serves run with no --profile, the profile named otherwise, and refuses one it cannot load with exit 2', async function ()
	{
		async function tools_under( Argv )
		{
			let io = io_for( observatory );
			io.Out = '';
			io.Err = '';
			io.Stdout = function ( Text ) { io.Out += Text; };
			io.Stderr = function ( Text ) { io.Err += Text; };
			io.Lines = function () { return [ JSON.stringify( { jsonrpc: '2.0', id: 1, method: 'tools/list' } ) ]; };
			let code = await Main.Main( [ 'mcp', '--file', observatory ].concat( Argv ), io );
			return { Code: code, Err: io.Err, Tools: code === 0 ? names( JSON.parse( io.Out.trim() ).result.tools ) : null };
		}

		let plain = await tools_under( [] );
		LIB_ASSERT.strictEqual( plain.Code, 0, plain.Err );
		LIB_ASSERT.strictEqual( plain.Tools.length, 14 );
		LIB_ASSERT.ok( plain.Tools.includes( 'run' ) && !plain.Tools.includes( 'datasource_delete' ) );
		LIB_ASSERT.match( plain.Err, /profile run\)/ );

		let translate = await tools_under( [ '--profile', 'translate' ] );
		LIB_ASSERT.strictEqual( translate.Tools.length, 13 );

		let full = await tools_under( [ '--profile', 'full' ] );
		LIB_ASSERT.strictEqual( full.Tools.length, Held.ServedCommands( Commands.TREE ).length );

		let mine = await tools_under( [ '--profile', 'mine.json' ] );
		LIB_ASSERT.deepStrictEqual( mine.Tools, [ 'validate' ] );

		let bad = await tools_under( [ '--profile', 'nonsense' ] );
		LIB_ASSERT.strictEqual( bad.Code, 2 );
		LIB_ASSERT.match( bad.Err, /No profile is named \[nonsense\]/ );
	} );

} );
