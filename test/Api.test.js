'use strict';

const LIB_ASSERT = require( 'assert' );
const LIB_FS = require( 'fs' );
const LIB_HTTP = require( 'http' );
const LIB_NET = require( 'net' );
const LIB_OS = require( 'os' );
const LIB_PATH = require( 'path' );
const { describe, it, before, after } = require( 'node:test' );

const Api = require( '../modes/api/Api.js' );
const Main = require( '../modes/cli/Main.js' );
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

function io_for( File, Env )
{
	let io = Parser.DefaultIo();
	io.Env = Env || {};
	io.Cwd = LIB_PATH.dirname( File );
	return io;
}

// A held file served on a free loopback port. Returns { Base, Close }.
async function serve( File, Options )
{
	let options = Options || {};
	let held = Held.NewHeld( { Tree: Commands.TREE, File: File, Io: io_for( File, options.Env ) } );
	let app = Api.NewApi( held, { Host: options.Host || '127.0.0.1', Token: options.Token, Version: 'test' } );
	let server = await Api.Listen( app, '127.0.0.1', 0 );
	return {
		Base: 'http://127.0.0.1:' + server.address().port,
		Port: server.address().port,
		Close: async function () { await Api.Close( server ); await held.Release(); },
	};
}

async function post( Base, Route, Body, Headers )
{
	let response = await fetch( Base + Route, {
		method: 'POST',
		headers: Object.assign( { 'Content-Type': 'application/json' }, Headers || {} ),
		body: ( typeof Body === 'string' ) ? Body : JSON.stringify( Body || {} ),
	} );
	let text = await response.text();
	let json = null;
	try { json = JSON.parse( text ); } catch ( error ) { json = null; }
	return { Status: response.status, Type: response.headers.get( 'content-type' ), Text: text, Json: json };
}

// A request with a Host header of our choosing, which fetch does not allow.
function raw_request( Port, Path, Headers )
{
	return new Promise( function ( Resolve, Reject )
	{
		let request = LIB_HTTP.request( { host: '127.0.0.1', port: Port, path: Path, method: 'POST', headers: Headers }, function ( Response )
		{
			let text = '';
			Response.setEncoding( 'utf8' );
			Response.on( 'data', function ( Chunk ) { text += Chunk; } );
			Response.on( 'end', function () { Resolve( { Status: Response.statusCode, Text: text } ); } );
		} );
		request.on( 'error', Reject );
		request.end( '{}' );
	} );
}


//---------------------------------------------------------------------
describe( 'The Web API', function ()
{

	let root = null;
	let observatory = null;
	let scratch = null;
	let broken = null;
	let secret = null;

	before( function ()
	{
		root = LIB_FS.mkdtempSync( LIB_PATH.join( LIB_OS.tmpdir(), 'jsonx-api-' ) );
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


	it( 'lists the served commands at GET /, and nothing marked Served: false', async function ()
	{
		let served = await serve( scratch );
		try
		{
			let response = await fetch( served.Base + '/' );
			LIB_ASSERT.strictEqual( response.status, 200 );
			let listed = await response.json();
			LIB_ASSERT.strictEqual( listed.File, scratch );
			let expected = Held.ServedCommands( Commands.TREE ).map( function ( Command ) { return Command.Command; } );
			LIB_ASSERT.deepStrictEqual( listed.Commands.map( function ( Command ) { return Command.Command; } ), expected );
			let names = listed.Commands.map( function ( Command ) { return Command.Command; } );
			for ( let unserved of [ 'debug', 'completion', '__complete', 'serve' ] ) { LIB_ASSERT.ok( !names.includes( unserved ), unserved ); }
			let find = listed.Commands.find( function ( Command ) { return Command.Command === 'datasource find'; } );
			LIB_ASSERT.strictEqual( find.Route, '/datasource/find' );
			for ( let refused of [ 'file', 'bind', 'set', 'quiet', 'output', 'input-json', 'help' ] ) { LIB_ASSERT.ok( !( refused in find.Options ), refused ); }
			LIB_ASSERT.ok( 'criteria' in find.Options && 'trace' in find.Options );
		}
		finally { await served.Close(); }
	} );

	it( 'routes every served command: each answers its help', async function ()
	{
		let served = await serve( scratch );
		try
		{
			for ( let command of Held.ServedCommands( Commands.TREE ) )
			{
				let answered = await post( served.Base, '/' + command.Path.join( '/' ), { help: true } );
				LIB_ASSERT.strictEqual( answered.Status, 200, command.Command + ': ' + answered.Text );
				LIB_ASSERT.ok( answered.Json.Result.includes( 'jsonx ' + command.Command ), command.Command );
			}
		}
		finally { await served.Close(); }
	} );

	it( 'answers the status of the exit code, with the envelope as the body', async function ()
	{
		let served = await serve( observatory );
		let failing = await serve( scratch );
		let errors = await serve( broken );
		try
		{
			let ran = await post( served.Base, '/run', { name: 'Prepare the season' } );
			LIB_ASSERT.strictEqual( ran.Status, 200 );
			LIB_ASSERT.deepStrictEqual( ran.Json.Result, [ { Booking: 'b-1', Observer: 'R. Okafor', Dome: 'B' } ] );
			LIB_ASSERT.ok( ran.Json.Log.some( function ( Line ) { return Line.includes( 'trigger [Note every long booking as it arrives]' ); } ) );

			let failed = await post( failing.Base, '/run', { name: 'Fail' } );
			LIB_ASSERT.strictEqual( failed.Status, 500 );
			LIB_ASSERT.deepStrictEqual( [ failed.Json.Ok, failed.Json.ExitCode ], [ false, 1 ] );

			let usage = await post( served.Base, '/run', { name: 'No such object' } );
			LIB_ASSERT.strictEqual( usage.Status, 400 );
			LIB_ASSERT.strictEqual( usage.Json.ExitCode, 2 );

			let refused = await post( errors.Base, '/run', { name: 'Prepare the season' } );
			LIB_ASSERT.strictEqual( refused.Status, 422 );
			LIB_ASSERT.ok( refused.Json.Findings.length > 0 );

			let guarded = await post( served.Base, '/datasource/delete', { name: 'Bookings', criteria: {} } );
			LIB_ASSERT.strictEqual( guarded.Status, 400 );
			let count = await post( served.Base, '/datasource/count', { name: 'Bookings' } );
			LIB_ASSERT.strictEqual( count.Json.Result, 2, 'the refused delete removed nothing' );
		}
		finally { await served.Close(); await failing.Close(); await errors.Close(); }
	} );

	it( 'refuses a body it cannot answer, a route it does not have, and a method other than POST', async function ()
	{
		let served = await serve( scratch );
		try
		{
			let cases = [
				[ { name: 'Scratch', file: 'other.jsonx' }, '/datasource/count', /\[--file\] cannot be given/ ],
				[ { name: 'Scratch', bind: [ 'Scratch=jsonstor-memory' ] }, '/datasource/count', /\[--bind\] cannot be given/ ],
				[ { output: 'table' }, '/validate', /\[--output\] cannot be \[table\]/ ],
				[ { Command: 'run' }, '/validate', /The body cannot name a Command/ ],
				[ '[1,2]', '/validate', /The body must be a JSON object/ ],
				[ '{nope', '/validate', /The body is not valid JSON/ ],
				[ { rows: 'many' }, '/datasource/describe', /Argument <name> is required|must be a/ ],
			];
			for ( let index = 0; index < cases.length; index++ )
			{
				let answered = await post( served.Base, cases[ index ][ 1 ], cases[ index ][ 0 ] );
				LIB_ASSERT.strictEqual( answered.Status, 400, answered.Text );
				LIB_ASSERT.ok( cases[ index ][ 2 ].test( answered.Json.Log.join( '\n' ) ), answered.Text );
			}

			let missing = await post( served.Base, '/debug', { process: 'Fail' } );
			LIB_ASSERT.strictEqual( missing.Status, 404 );
			LIB_ASSERT.strictEqual( missing.Json.ExitCode, 2 );

			let method = await fetch( served.Base + '/run' );
			LIB_ASSERT.strictEqual( method.status, 405 );
			LIB_ASSERT.strictEqual( method.headers.get( 'allow' ), 'POST' );
		}
		finally { await served.Close(); }
	} );

	it( 'frames an array result as JSON Lines when asked, and anything else as the envelope', async function ()
	{
		let served = await serve( scratch );
		try
		{
			await post( served.Base, '/run', { name: 'Seed' } );
			let lines = await post( served.Base, '/datasource/find', { name: 'Scratch', sort: { _id: 1 } }, { Accept: Api.NDJSON } );
			LIB_ASSERT.strictEqual( lines.Status, 200 );
			LIB_ASSERT.ok( lines.Type.startsWith( Api.NDJSON ) );
			let parsed = lines.Text.trim().split( '\n' ).map( function ( Line ) { return JSON.parse( Line ); } );
			LIB_ASSERT.deepStrictEqual( parsed.slice( 0, 2 ), [ { Line: 'row', Row: { _id: 'a' } }, { Line: 'row', Row: { _id: 'b' } } ] );
			LIB_ASSERT.strictEqual( parsed[ 2 ].Line, 'end' );
			LIB_ASSERT.deepStrictEqual( [ parsed[ 2 ].Ok, parsed[ 2 ].ExitCode ], [ true, 0 ] );
			LIB_ASSERT.strictEqual( parsed.length, 3 );

			let counted = await post( served.Base, '/datasource/count', { name: 'Scratch' }, { Accept: Api.NDJSON } );
			LIB_ASSERT.ok( counted.Type.startsWith( 'application/json' ) );
			LIB_ASSERT.strictEqual( counted.Json.Result, 2 );
		}
		finally { await served.Close(); }
	} );

	it( 'on loopback, refuses a Host which is not its address and an Origin which is not its own', async function ()
	{
		let served = await serve( scratch );
		try
		{
			let rebound = await raw_request( served.Port, '/validate', { 'Host': 'attacker.example:' + served.Port, 'Content-Type': 'application/json' } );
			LIB_ASSERT.strictEqual( rebound.Status, 403, rebound.Text );
			LIB_ASSERT.ok( /the Host header/.test( rebound.Text ) );

			let localhost = await raw_request( served.Port, '/validate', { 'Host': 'localhost:' + served.Port, 'Content-Type': 'application/json' } );
			LIB_ASSERT.strictEqual( localhost.Status, 200, localhost.Text );

			let cross = await post( served.Base, '/validate', {}, { Origin: 'http://attacker.example' } );
			LIB_ASSERT.strictEqual( cross.Status, 403 );

			let own = await post( served.Base, '/validate', {}, { Origin: served.Base } );
			LIB_ASSERT.strictEqual( own.Status, 200, own.Text );
		}
		finally { await served.Close(); }
	} );

	it( 'needs the token when it has one, and a token for any host which is not loopback', async function ()
	{
		LIB_ASSERT.throws( function ()
		{
			let held = Held.NewHeld( { Tree: Commands.TREE, File: scratch, Io: io_for( scratch ) } );
			Api.NewApi( held, { Host: '0.0.0.0' } );
		}, Api.ApiError );

		let served = await serve( scratch, { Token: 'correct horse' } );
		try
		{
			let none = await post( served.Base, '/validate', {} );
			LIB_ASSERT.strictEqual( none.Status, 401 );
			LIB_ASSERT.strictEqual( none.Json.ExitCode, 2 );
			let wrong = await post( served.Base, '/validate', {}, { Authorization: 'Bearer battery staple' } );
			LIB_ASSERT.strictEqual( wrong.Status, 401 );
			let right = await post( served.Base, '/validate', {}, { Authorization: 'Bearer correct horse' } );
			LIB_ASSERT.strictEqual( right.Status, 200, right.Text );
		}
		finally { await served.Close(); }

		// Served for another host, the token is the guard and the browser checks do not apply.
		let wide = await serve( scratch, { Host: '0.0.0.0', Token: 'correct horse' } );
		try
		{
			let answered = await post( wide.Base, '/validate', {}, { Authorization: 'Bearer correct horse', Origin: 'http://elsewhere.example' } );
			LIB_ASSERT.strictEqual( answered.Status, 200, answered.Text );
		}
		finally { await wide.Close(); }
	} );

	it( 'never answers the value of an environment reference (F6.4)', async function ()
	{
		let value = 'the-resolved-secret-value';
		let served = await serve( secret, { Env: { JSONX_TEST_SECRET: value } } );
		try
		{
			let answers = [
				await post( served.Base, '/datasource/show', { name: 'Kept' } ),
				await post( served.Base, '/datasource/list', {} ),
				await post( served.Base, '/plan', { name: 'Read kept' } ),
				await post( served.Base, '/explain', { name: 'Kept' } ),
				await post( served.Base, '/validate', {} ),
			];
			for ( let answered of answers )
			{
				LIB_ASSERT.strictEqual( answered.Status, 200, answered.Text );
				LIB_ASSERT.ok( !answered.Text.includes( value ), answered.Text );
			}
			LIB_ASSERT.ok( answers[ 0 ].Text.includes( '${env:JSONX_TEST_SECRET}' ) );
		}
		finally { await served.Close(); }
	} );

} );


//---------------------------------------------------------------------
describe( 'jsonx serve', function ()
{

	let root = null;
	let scratch = null;

	before( function ()
	{
		root = LIB_FS.mkdtempSync( LIB_PATH.join( LIB_OS.tmpdir(), 'jsonx-serve-' ) );
		scratch = write( root, 'scratch.jsonx', {
			DataSources: [ { Name: 'Scratch', AdapterName: 'jsonstor-memory' } ],
			Objects: [ { Kind: 'Insert', Name: 'Seed', DataSource: 'Scratch', Documents: [ { _id: 'a' } ] } ],
		} );
	} );

	after( function () { LIB_FS.rmSync( root, { recursive: true, force: true } ); } );

	// An Io whose stop is ours to give, and whose standard error announces the address.
	function serve_io()
	{
		let io = io_for( scratch );
		io.Err = '';
		io.Out = '';
		io.Stdout = function ( Text ) { io.Out += Text; };
		let announced = null;
		io.Address = new Promise( function ( Resolve ) { announced = Resolve; } );
		io.Stderr = function ( Text )
		{
			io.Err += Text;
			let match = /at (http:\/\/127\.0\.0\.1:\d+)/.exec( io.Err );
			if ( match ) { announced( match[ 1 ] ); }
		};
		let stop = null;
		io.Stopped = new Promise( function ( Resolve ) { stop = Resolve; } );
		io.Stop = function () { stop(); };
		io.WaitForStop = function () { return io.Stopped; };
		return io;
	}

	it( 'serves until stopped, answers requests, and releases', async function ()
	{
		let io = serve_io();
		let running = Main.Main( [ 'serve', '--api', '--port', '0', '--file', scratch ], io );
		let base = await io.Address;

		let seeded = await post( base, '/run', { name: 'Seed' } );
		LIB_ASSERT.strictEqual( seeded.Status, 200, seeded.Text );
		let counted = await post( base, '/datasource/count', { name: 'Scratch' } );
		LIB_ASSERT.strictEqual( counted.Json.Result, 1 );

		// The file is watched: an edit on disk is reported, and the next request runs it.
		let document = JSON.parse( LIB_FS.readFileSync( scratch, 'utf8' ) );
		document.Objects.push( { Kind: 'Query', Name: 'Read scratch', DataSource: 'Scratch', Criteria: {} } );
		LIB_FS.writeFileSync( scratch, JSON.stringify( document, null, '\t' ) );
		for ( let waited = 0; waited < 5000 && !io.Err.includes( 'Reloaded ' ); waited += 50 )
		{
			await new Promise( function ( Resolve ) { setTimeout( Resolve, 50 ); } );
		}
		LIB_ASSERT.ok( io.Err.includes( 'Reloaded ' ), io.Err );
		let read = await post( base, '/run', { name: 'Read scratch' } );
		LIB_ASSERT.strictEqual( read.Status, 200, read.Text );
		LIB_ASSERT.deepStrictEqual( read.Json.Result, [ { _id: 'a' } ] );

		io.Stop();
		LIB_ASSERT.strictEqual( await running, 0 );
		LIB_ASSERT.ok( io.Err.endsWith( 'Stopped.\n' ), io.Err );
		// ***Standard output is the ready line and nothing else*** (cut 4), one JSON line a program reads.
		LIB_ASSERT.strictEqual( io.Out.split( '\n' ).length, 2, io.Out );
		LIB_ASSERT.deepStrictEqual( JSON.parse( io.Out ), { File: scratch, Url: base, Pid: process.pid } );
		await LIB_ASSERT.rejects( fetch( base + '/' ) );
	} );

	it( 'with --attached, stops when standard input ends; without it, does not', async function ()
	{
		let attached = serve_io();
		let stdin_ended = null;
		attached.WaitForStdinEnd = function () { return new Promise( function ( Resolve ) { stdin_ended = Resolve; } ); };
		let running = Main.Main( [ 'serve', '--api', '--attached', '--port', '0', '--file', scratch ], attached );
		let base = await attached.Address;
		LIB_ASSERT.ok( attached.Err.includes( 'The end of standard input, or Ctrl+C, stops it.' ), attached.Err );
		stdin_ended();
		LIB_ASSERT.strictEqual( await running, 0 );
		LIB_ASSERT.ok( attached.Err.endsWith( 'Stopped.\n' ), attached.Err );
		await LIB_ASSERT.rejects( fetch( base + '/' ) );

		let free = serve_io();
		let asked = false;
		free.WaitForStdinEnd = function () { asked = true; return Promise.resolve(); };
		let still = Main.Main( [ 'serve', '--api', '--port', '0', '--file', scratch ], free );
		let free_base = await free.Address;
		await new Promise( function ( Resolve ) { setTimeout( Resolve, 100 ); } );
		LIB_ASSERT.strictEqual( asked, false );
		LIB_ASSERT.strictEqual( ( await fetch( free_base + '/' ) ).status, 200 );
		free.Stop();
		LIB_ASSERT.strictEqual( await still, 0 );
	} );

	it( 'refuses to start without --api, without a token for a wide host, or with --output', async function ()
	{
		let cases = [
			[ [ 'serve', '--file', scratch ], /Name what to serve: --api/ ],
			[ [ 'serve', '--api', '--host', '0.0.0.0', '--file', scratch ], /needs a token/ ],
			[ [ 'serve', '--api', '--output', 'json', '--file', scratch ], /does not apply to jsonx serve/ ],
			[ [ 'serve', '--api', '--ui', '--file', scratch ], /--ui/ ],
		];
		for ( let index = 0; index < cases.length; index++ )
		{
			let io = serve_io();
			let code = await Main.Main( cases[ index ][ 0 ], io );
			LIB_ASSERT.strictEqual( code, 2, io.Err );
			LIB_ASSERT.ok( cases[ index ][ 1 ].test( io.Err ), io.Err );
		}
	} );

	it( 'exits 1 when its port is taken', async function ()
	{
		let blocker = LIB_NET.createServer();
		await new Promise( function ( Resolve ) { blocker.listen( 0, '127.0.0.1', Resolve ); } );
		try
		{
			let io = serve_io();
			let code = await Main.Main( [ 'serve', '--api', '--port', String( blocker.address().port ), '--file', scratch ], io );
			LIB_ASSERT.strictEqual( code, 1, io.Err );
			LIB_ASSERT.ok( /Cannot serve on 127\.0\.0\.1:/.test( io.Err ), io.Err );
		}
		finally { await new Promise( function ( Resolve ) { blocker.close( Resolve ); } ); }
	} );

} );
