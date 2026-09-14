'use strict';

/*
	The WebSocket (cut 4, step 2), driven by ***Node's built-in WebSocket client***: the client the
	TUI uses, and the proof that the hand-written server speaks the protocol (decision 1).
*/

const LIB_ASSERT = require( 'assert' );
const LIB_FS = require( 'fs' );
const LIB_HTTP = require( 'http' );
const LIB_NET = require( 'net' );
const LIB_OS = require( 'os' );
const LIB_PATH = require( 'path' );
const { describe, it, before, after } = require( 'node:test' );

const Api = require( '../modes/api/Api.js' );
const McpHttp = require( '../modes/mcp/Http.js' );
const Held = require( '../src/Session/Held.js' );
const Parser = require( '../src/CommandLine/Parser.js' );
const Commands = require( '../commands/jsonx.js' );
const Spec = require( './fixtures/Spec.js' );

const KEY = 'dGhlIHNhbXBsZSBub25jZQ==';


//---------------------------------------------------------------------
function write( Directory, Name, Document )
{
	let path = LIB_PATH.join( Directory, Name );
	LIB_FS.writeFileSync( path, JSON.stringify( Document, null, '\t' ) );
	return path;
}

function wait( Ms ) { return new Promise( function ( Resolve ) { setTimeout( Resolve, Ms ); } ); }

// A held file served on a free loopback port, with the WebSocket on it.
async function serve( File, Options )
{
	let options = Options || {};
	let io = Parser.DefaultIo();
	io.Env = options.Env || {};
	io.Cwd = LIB_PATH.dirname( File );
	let held = Held.NewHeld( { Tree: Commands.TREE, File: File, Io: io } );
	let app = Api.NewApi( held, Object.assign( { Host: '127.0.0.1', Version: 'test' }, options.Api || {} ) );
	let server = await Api.Listen( app, '127.0.0.1', 0 );
	let port = server.address().port;
	return {
		Held: held,
		App: app,
		Server: server,
		Port: port,
		Base: 'http://127.0.0.1:' + port,
		Url: 'ws://127.0.0.1:' + port + '/ws',
		Close: async function () { await Api.Close( server ); await held.Release(); },
	};
}

// A connected client which keeps every message, and answers what arrives next matching a test.
function connect( Url, Headers )
{
	return new Promise( function ( Resolve, Reject )
	{
		let socket = new WebSocket( Url, Headers ? { headers: Headers } : undefined );
		let client = { Socket: socket, Messages: [], Closed: null, Waiters: [] };
		client.Closing = new Promise( function ( ResolveClose ) { client.ResolveClose = ResolveClose; } );

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
		socket.onclose = function ( Event )
		{
			client.Closed = { Code: Event.code, Reason: Event.reason };
			client.ResolveClose( client.Closed );
		};
		socket.onerror = function () { if ( socket.readyState !== WebSocket.OPEN ) { Reject( new Error( 'The WebSocket did not open.' ) ); } };
		socket.onopen = function () { Resolve( client ); };

		// The next message to arrive which passes Test; one which arrived before the call is not seen.
		client.Next = function ( Test, TimeoutMs )
		{
			return new Promise( function ( ResolveNext, RejectNext )
			{
				let timer = setTimeout( function () { RejectNext( new Error( 'No such message within the time.' ) ); }, TimeoutMs || 5000 );
				client.Waiters.push( { Test: Test, Resolve: function ( Message ) { clearTimeout( timer ); ResolveNext( Message ); } } );
			} );
		};

		client.Hello = function ()
		{
			let hello = client.Messages.find( function ( Message ) { return Message.Hello; } );
			return hello ? Promise.resolve( hello.Hello ) : client.Next( function ( Message ) { return Message.Hello; } ).then( function ( Message ) { return Message.Hello; } );
		};

		// Sends an Invoke and answers { Answer, Events }: everything its Id brought, in order.
		client.Invoke = async function ( Id, Invocation )
		{
			let answered = client.Next( function ( Message ) { return Message.Id === Id && Message.Answer; }, 20000 );
			socket.send( JSON.stringify( { Id: Id, Invoke: Invocation } ) );
			let answer = await answered;
			let mine = client.Messages.filter( function ( Message ) { return Message.Id === Id; } );
			LIB_ASSERT.strictEqual( mine[ mine.length - 1 ], answer, 'the answer is the last message for its Id' );
			return { Answer: answer.Answer, Events: mine.slice( 0, -1 ) };
		};
	} );
}

async function post( Base, Route, Body )
{
	let response = await fetch( Base + Route, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify( Body || {} ) } );
	return { Status: response.status, Json: await response.json() };
}

// A report line's duration differs between two runs.
function without_times( Envelope )
{
	return Object.assign( {}, Envelope, { Log: Envelope.Log.map( function ( Line ) { return Line.replace( /\s\d+ ms$/, ' - ms' ); } ) } );
}

// An upgrade request with the headers given; answers { Status, Text, Upgraded, Ended }.
function raw_upgrade( Port, Path, Headers )
{
	return new Promise( function ( Resolve, Reject )
	{
		let headers = Object.assign( {
			Host: '127.0.0.1:' + Port,
			Connection: 'Upgrade',
			Upgrade: 'websocket',
			'Sec-WebSocket-Version': '13',
			'Sec-WebSocket-Key': KEY,
		}, Headers || {} );
		Object.keys( headers ).forEach( function ( Name ) { if ( headers[ Name ] === null ) { delete headers[ Name ]; } } );
		let request = LIB_HTTP.request( { host: '127.0.0.1', port: Port, path: Path, method: 'GET', headers: headers, agent: false } );
		request.on( 'upgrade', function ( Response, Socket )
		{
			Socket.destroy();
			Resolve( { Status: Response.statusCode, Accept: Response.headers[ 'sec-websocket-accept' ], Upgraded: true } );
		} );
		request.on( 'response', function ( Response )
		{
			let text = '';
			Response.setEncoding( 'utf8' );
			Response.on( 'data', function ( Chunk ) { text += Chunk; } );
			Response.on( 'end', function ()
			{
				let json = null;
				try { json = JSON.parse( text ); } catch ( error ) { json = null; }
				Resolve( { Status: Response.statusCode, Json: json, Headers: Response.headers, Upgraded: false } );
			} );
		} );
		request.on( 'error', Reject );
		request.end();
	} );
}


//---------------------------------------------------------------------
describe( 'The WebSocket', function ()
{

	let root = null;
	let observatory = null;
	let scratch = null;
	let broken = null;
	let secret = null;

	before( function ()
	{
		root = LIB_FS.mkdtempSync( LIB_PATH.join( LIB_OS.tmpdir(), 'jsonx-ws-' ) );
		observatory = write( root, 'observatory.jsonx', Spec.AppendixB() );
		scratch = write( root, 'scratch.jsonx', {
			DataSources: [ { Name: 'Scratch', AdapterName: 'jsonstor-memory' } ],
			Objects: [
				{ Kind: 'Insert', Name: 'Seed', DataSource: 'Scratch', Documents: [ { _id: 'a' }, { _id: 'b' } ] },
				{ Kind: 'Process', Name: 'Fail', Steps: [ { $throw: 'stopped on purpose' } ] },
			],
		} );
		let document = Spec.AppendixB();
		document.Objects.find( function ( Entry ) { return typeof Entry.DataSource === 'string'; } ).DataSource = 'Nowhere';
		broken = write( root, 'broken.jsonx', document );
		secret = write( root, 'secret.jsonx', {
			DataSources: [ { Name: 'Kept', AdapterName: 'jsonstor-jsonfile', Settings: { Path: '${env:JSONX_TEST_SECRET}' } } ],
			Objects: [ { Kind: 'Query', Name: 'Read kept', DataSource: 'Kept', Criteria: {} } ],
		} );
	} );

	after( function () { LIB_FS.rmSync( root, { recursive: true, force: true } ); } );


	it( 'carries messages both ways after the upgrade the API hands on, in every length form', async function ()
	{
		let served = await serve( scratch );
		try
		{
			let client = await connect( served.Url );
			// Over 65536 bytes each way: the request's documents, and the answer echoing them.
			let long = 'x'.repeat( 70000 );
			let small = await client.Invoke( 'small', { Command: 'engine filter', documents: [ { A: 1 } ], criteria: { A: 1 } } );
			LIB_ASSERT.deepStrictEqual( small.Answer.Result, [ { A: 1 } ] );
			let medium = await client.Invoke( 'medium', { Command: 'engine filter', documents: [ { A: 'm'.repeat( 300 ) } ], criteria: {} } );
			LIB_ASSERT.strictEqual( medium.Answer.Result[ 0 ].A.length, 300 );
			let large = await client.Invoke( 'large', { Command: 'engine filter', documents: [ { A: long } ], criteria: {} } );
			LIB_ASSERT.strictEqual( large.Answer.ExitCode, 0, large.Answer.Log.join( '\n' ) );
			LIB_ASSERT.strictEqual( large.Answer.Result[ 0 ].A, long );
			client.Socket.close( 1000 );
			LIB_ASSERT.strictEqual( ( await client.Closing ).Code, 1000 );
		}
		finally { await served.Close(); }
	} );

	it( 'says Hello first: the served commands as GET / lists them, and the document as written', async function ()
	{
		let served = await serve( scratch );
		try
		{
			let client = await connect( served.Url );
			let hello = await client.Hello();
			LIB_ASSERT.ok( client.Messages[ 0 ].Hello, 'Hello is the first message' );
			let listed = await ( await fetch( served.Base + '/' ) ).json();
			LIB_ASSERT.deepStrictEqual( hello.Commands, listed.Commands );
			LIB_ASSERT.strictEqual( hello.Version, 'test' );
			LIB_ASSERT.strictEqual( hello.File, scratch );
			LIB_ASSERT.deepStrictEqual( hello.Document, JSON.parse( LIB_FS.readFileSync( scratch, 'utf8' ) ) );
			client.Socket.close();
		}
		finally { await served.Close(); }
	} );

	it( 'answers an Invoke with exactly the envelope a POST to the same route answers, for each exit code', async function ()
	{
		let served = await serve( scratch );
		let failing = await serve( broken );
		try
		{
			let client = await connect( served.Url );
			let broken_client = await connect( failing.Url );
			let cases = [
				[ client, served, 0, { Command: [ 'datasource', 'count' ], name: 'Scratch' }, '/datasource/count', { name: 'Scratch' } ],
				[ client, served, 1, { Command: 'run', name: 'Fail' }, '/run', { name: 'Fail' } ],
				[ client, served, 2, { Command: 'run' }, '/run', {} ],
				[ broken_client, failing, 3, { Command: 'run', name: 'Prepare the season' }, '/run', { name: 'Prepare the season' } ],
			];
			for ( let index = 0; index < cases.length; index++ )
			{
				let [ each, server, code, invocation, route, body ] = cases[ index ];
				let over_ws = await each.Invoke( 'case-' + index, invocation );
				let over_http = await post( server.Base, route, body );
				LIB_ASSERT.strictEqual( over_ws.Answer.ExitCode, code, over_ws.Answer.Log.join( '\n' ) );
				LIB_ASSERT.deepStrictEqual( without_times( over_ws.Answer ), without_times( over_http.Json ) );
			}
			client.Socket.close();
			broken_client.Socket.close();
		}
		finally { await served.Close(); await failing.Close(); }
	} );

	it( 'pushes a run\'s reports and lines before its answer, with a trigger\'s report nested under it', async function ()
	{
		let served = await serve( observatory );
		try
		{
			let client = await connect( served.Url );
			let ran = await client.Invoke( 'season', { Command: 'run', name: 'Prepare the season' } );
			LIB_ASSERT.strictEqual( ran.Answer.ExitCode, 0, ran.Answer.Log.join( '\n' ) );
			LIB_ASSERT.deepStrictEqual( ran.Answer.Result, [ { Booking: 'b-1', Observer: 'R. Okafor', Dome: 'B' } ] );

			let reports = ran.Events.filter( function ( Message ) { return Message.Event === 'report'; } );
			LIB_ASSERT.deepStrictEqual( [ reports[ 0 ].Phase, reports[ 0 ].Name, reports[ 0 ].Depth ], [ 'open', 'Prepare the season', 0 ] );
			let last = reports[ reports.length - 1 ];
			LIB_ASSERT.deepStrictEqual( [ last.Phase, last.Name, last.Depth, last.Ok ], [ 'close', 'Prepare the season', 0, true ] );
			let fired = reports.filter( function ( Report ) { return typeof Report.Trigger === 'string'; } );
			LIB_ASSERT.ok( fired.length > 0 && fired.every( function ( Report ) { return Report.Depth > 0; } ), JSON.stringify( reports ) );

			let lines = ran.Events.filter( function ( Message ) { return Message.Event === 'log'; } ).map( function ( Message ) { return Message.Line; } );
			LIB_ASSERT.deepStrictEqual( lines, ran.Answer.Log );
			client.Socket.close();
		}
		finally { await served.Close(); }
	} );

	it( 'runs requests on one connection as they arrive, each answered under its own Id', async function ()
	{
		let served = await serve( scratch );
		try
		{
			let client = await connect( served.Url );
			let answers = await Promise.all( [
				client.Invoke( 'seed', { Command: 'run', name: 'Seed' } ),
				client.Invoke( 'validate', { Command: 'validate' } ),
				client.Invoke( 'count', { Command: 'datasource count', name: 'Scratch' } ),
			] );
			LIB_ASSERT.deepStrictEqual( answers.map( function ( Each ) { return Each.Answer.ExitCode; } ), [ 0, 0, 0 ] );
			// The count queued behind the seed, so it counts what the seed wrote.
			LIB_ASSERT.strictEqual( answers[ 2 ].Answer.Result, 2 );
			LIB_ASSERT.ok( answers[ 0 ].Events.every( function ( Message ) { return Message.Id === 'seed'; } ) );
			client.Socket.close();
		}
		finally { await served.Close(); }
	} );

	it( 'tells every connection when the file changes, by a request or on disk', async function ()
	{
		let file = write( root, 'events.jsonx', {
			DataSources: [ { Name: 'Scratch', AdapterName: 'jsonstor-memory' } ],
			Objects: [ { Kind: 'Query', Name: 'Read', DataSource: 'Scratch', Criteria: {} } ],
		} );
		let served = await serve( file );
		try
		{
			let one = await connect( served.Url );
			let two = await connect( served.Url );
			await one.Hello();
			await two.Hello();

			let heard = two.Next( function ( Message ) { return Message.Event === 'document'; } );
			let added = await one.Invoke( 'add', { Command: 'query add', json: { Name: 'Read again', DataSource: 'Scratch', Criteria: {} } } );
			LIB_ASSERT.strictEqual( added.Answer.ExitCode, 0, added.Answer.Log.join( '\n' ) );
			await heard;
			LIB_ASSERT.ok( one.Messages.some( function ( Message ) { return Message.Event === 'document'; } ) );

			let reloaded_one = one.Next( function ( Message ) { return Message.Event === 'reload'; } );
			let reloaded_two = two.Next( function ( Message ) { return Message.Event === 'reload'; } );
			let changed = two.Next( function ( Message ) { return Message.Event === 'document'; } );
			let document = JSON.parse( LIB_FS.readFileSync( file, 'utf8' ) );
			document.Objects.push( { Kind: 'Query', Name: 'Read on disk', DataSource: 'Scratch', Criteria: {} } );
			LIB_FS.writeFileSync( file, JSON.stringify( document, null, '\t' ) );
			await served.Held.Reload();
			let reload = await reloaded_one;
			await reloaded_two;
			await changed;
			LIB_ASSERT.strictEqual( reload.Outcome.Reloaded, true );
			LIB_ASSERT.ok( !( 'Id' in reload ), 'a file event belongs to no request' );
			one.Socket.close();
			two.Socket.close();
		}
		finally { await served.Close(); }
	} );

	it( 'is behind the API\'s guards: a refusal is the guard\'s own status, and no handshake', async function ()
	{
		let served = await serve( scratch );
		try
		{
			let accepted = await raw_upgrade( served.Port, '/ws' );
			LIB_ASSERT.deepStrictEqual( [ accepted.Status, accepted.Upgraded, accepted.Accept ], [ 101, true, 's3pPLMBiTxaQ9kYGzzhZRbK+xOo=' ] );

			let host = await raw_upgrade( served.Port, '/ws', { Host: 'attacker.example:' + served.Port } );
			LIB_ASSERT.deepStrictEqual( [ host.Status, host.Upgraded ], [ 403, false ] );
			LIB_ASSERT.match( host.Json.Log[ 0 ], /Host header/ );

			let origin = await raw_upgrade( served.Port, '/ws', { Origin: 'http://attacker.example' } );
			LIB_ASSERT.deepStrictEqual( [ origin.Status, origin.Upgraded ], [ 403, false ] );

			let own_origin = await raw_upgrade( served.Port, '/ws', { Origin: 'http://localhost:' + served.Port } );
			LIB_ASSERT.strictEqual( own_origin.Status, 101 );

			let not_upgrade = await fetch( served.Base + '/ws' );
			LIB_ASSERT.strictEqual( not_upgrade.status, 400 );
			LIB_ASSERT.match( ( await not_upgrade.json() ).Log[ 0 ], /is a WebSocket/ );

			let version = await raw_upgrade( served.Port, '/ws', { 'Sec-WebSocket-Version': '8' } );
			LIB_ASSERT.deepStrictEqual( [ version.Status, version.Headers[ 'sec-websocket-version' ] ], [ 426, '13' ] );

			let key = await raw_upgrade( served.Port, '/ws', { 'Sec-WebSocket-Key': 'c2hvcnQ=' } );
			LIB_ASSERT.strictEqual( key.Status, 400 );

			let elsewhere = await raw_upgrade( served.Port, '/nowhere' );
			LIB_ASSERT.deepStrictEqual( [ elsewhere.Status, elsewhere.Upgraded ], [ 404, false ] );
		}
		finally { await served.Close(); }

		let guarded = await serve( scratch, { Api: { Token: 'correct horse' } } );
		try
		{
			let without = await raw_upgrade( guarded.Port, '/ws' );
			LIB_ASSERT.deepStrictEqual( [ without.Status, without.Headers[ 'www-authenticate' ] ], [ 401, 'Bearer' ] );
			await LIB_ASSERT.rejects( connect( guarded.Url, { Authorization: 'Bearer battery staple' } ) );
			let client = await connect( guarded.Url, { Authorization: 'Bearer correct horse' } );
			LIB_ASSERT.strictEqual( ( await client.Invoke( 'ok', { Command: 'validate' } ) ).Answer.ExitCode, 0 );
			client.Socket.close();
		}
		finally { await guarded.Close(); }
	} );

	it( 'answers a message which is not a request, and closes for one which is not JSON or not text', async function ()
	{
		let served = await serve( scratch );
		try
		{
			let client = await connect( served.Url );
			await client.Hello();
			let refusals = [
				[ [ 1, 2 ], null, /must be a JSON object/ ],
				[ { Invoke: { Command: 'validate' } }, null, /needs an Id/ ],
				[ { Id: '', Invoke: { Command: 'validate' } }, null, /needs an Id/ ],
				[ { Id: 'no-invoke' }, 'no-invoke', /names what it asks in Invoke/ ],
				[ { Id: 'unknown', Invoke: { Command: 'no such command' } }, 'unknown', /Unknown command/ ],
				[ { Id: 'refused', Invoke: { Command: 'validate', file: 'other.jsonx' } }, 'refused', /\[--file\] cannot be given/ ],
				[ { Id: 'unserved', Invoke: { Command: 'debug', process: 'Fail' } }, 'unserved', /is not served/ ],
			];
			for ( let [ message, id, pattern ] of refusals )
			{
				let answered = client.Next( function ( Each ) { return Each.Answer && Each.Id === id && pattern.test( Each.Answer.Log.join( '\n' ) ); } );
				client.Socket.send( JSON.stringify( message ) );
				let answer = await answered;
				LIB_ASSERT.strictEqual( answer.Answer.ExitCode, 2 );
			}

			// An Id is not reused while its request runs.
			let first = client.Next( function ( Each ) { return Each.Id === 'twice' && Each.Answer && Each.Answer.ExitCode === 0; } );
			let second = client.Next( function ( Each ) { return Each.Id === 'twice' && Each.Answer && /has not been answered/.test( Each.Answer.Log.join( '\n' ) ); } );
			client.Socket.send( JSON.stringify( { Id: 'twice', Invoke: { Command: 'run', name: 'Seed' } } ) );
			client.Socket.send( JSON.stringify( { Id: 'twice', Invoke: { Command: 'run', name: 'Seed' } } ) );
			await Promise.all( [ first, second ] );

			client.Socket.send( 'not json' );
			LIB_ASSERT.strictEqual( ( await client.Closing ).Code, 1002 );

			let binary = await connect( served.Url );
			binary.Socket.send( new Uint8Array( [ 1, 2, 3 ] ) );
			LIB_ASSERT.strictEqual( ( await binary.Closing ).Code, 1003 );
		}
		finally { await served.Close(); }
	} );

	it( 'cuts off a client which stops answering, and keeps one which answers pings', { timeout: 10000 }, async function ()
	{
		let served = await serve( scratch, { Api: { PingMs: 50, PongTimeoutMs: 250 } } );
		try
		{
			let answering = await connect( served.Url );

			// A raw client which completes the handshake and then never answers anything.
			let silent = LIB_NET.connect( served.Port, '127.0.0.1' );
			let silent_closed = new Promise( function ( Resolve ) { silent.on( 'close', Resolve ); } );
			await new Promise( function ( Resolve ) { silent.on( 'connect', Resolve ); } );
			silent.write( 'GET /ws HTTP/1.1\r\nHost: 127.0.0.1:' + served.Port + '\r\nConnection: Upgrade\r\nUpgrade: websocket\r\nSec-WebSocket-Version: 13\r\nSec-WebSocket-Key: ' + KEY + '\r\n\r\n' );
			silent.resume();

			let started = Date.now();
			await silent_closed;
			let waited = Date.now() - started;
			LIB_ASSERT.ok( waited >= 200 && waited < 3000, 'cut off after ' + waited + ' ms' );

			await wait( 400 );
			LIB_ASSERT.strictEqual( answering.Closed, null, 'the answering client is still open' );
			LIB_ASSERT.strictEqual( ( await answering.Invoke( 'still', { Command: 'validate' } ) ).Answer.ExitCode, 0 );
			answering.Socket.close();
		}
		finally { await served.Close(); }
	} );

	it( 'never pushes the value of an environment reference (F6.4)', async function ()
	{
		let value = 'the-resolved-secret-value';
		let served = await serve( secret, { Env: { JSONX_TEST_SECRET: value } } );
		try
		{
			let client = await connect( served.Url );
			await client.Hello();
			await client.Invoke( 'show', { Command: 'datasource show', name: 'Kept' } );
			await client.Invoke( 'plan', { Command: 'plan', name: 'Read kept' } );
			await client.Invoke( 'explain', { Command: 'explain', name: 'Kept' } );
			await client.Invoke( 'run', { Command: 'run', name: 'Read kept' } );
			let everything = JSON.stringify( client.Messages );
			LIB_ASSERT.ok( !everything.includes( value ), everything );
			LIB_ASSERT.ok( everything.includes( '${env:JSONX_TEST_SECRET}' ) );
			client.Socket.close();
		}
		finally { await served.Close(); }
	} );

	it( 'closes every connection with 1001 when the server stops, without waiting for the clients', { timeout: 10000 }, async function ()
	{
		let served = await serve( scratch );
		let one = await connect( served.Url );
		let two = await connect( served.Url );
		let started = Date.now();
		await served.Close();
		LIB_ASSERT.ok( Date.now() - started < 1500, 'stopped in ' + ( Date.now() - started ) + ' ms' );
		LIB_ASSERT.strictEqual( ( await one.Closing ).Code, 1001 );
		LIB_ASSERT.strictEqual( ( await two.Closing ).Code, 1001 );
	} );

	it( 'is not offered by MCP over HTTP: an upgrade there is refused, and its connection ended', async function ()
	{
		let io = Parser.DefaultIo();
		io.Env = {};
		io.Cwd = root;
		let held = Held.NewHeld( { Tree: Commands.TREE, File: scratch, Io: io } );
		let server = await Api.Listen( McpHttp.NewMcpHttp( held, { Host: '127.0.0.1', Version: 'test' } ), '127.0.0.1', 0 );
		try
		{
			let answered = await raw_upgrade( server.address().port, '/ws' );
			LIB_ASSERT.strictEqual( answered.Upgraded, false );
			LIB_ASSERT.ok( answered.Status >= 400, String( answered.Status ) );
		}
		finally { await Api.Close( server ); await held.Release(); }
	} );

} );
