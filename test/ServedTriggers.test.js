'use strict';

/*
	F2.4 over the wire: a write an outside client makes through a served mode fires the file's
	triggers, because it goes through the held session's data sources. Asserted through the Web API
	and through MCP alike, for a write alone and for a write which arrives while another request is
	running the trigger's own Process.
*/

const LIB_ASSERT = require( 'assert' );
const LIB_FS = require( 'fs' );
const LIB_OS = require( 'os' );
const LIB_PATH = require( 'path' );
const { describe, it, before, after } = require( 'node:test' );

const Api = require( '../modes/api/Api.js' );
const Http = require( '../modes/mcp/Http.js' );
const Held = require( '../src/Session/Held.js' );
const Parser = require( '../src/CommandLine/Parser.js' );
const Commands = require( '../commands/jsonx.js' );
const Watched = require( './fixtures/Watched.js' );


//---------------------------------------------------------------------
function hold( File )
{
	let io = Parser.DefaultIo();
	io.Env = {};
	io.Cwd = LIB_PATH.dirname( File );
	return Held.NewHeld( { Tree: Commands.TREE, File: File, Io: io } );
}

async function post_json( Url, Body, Headers )
{
	let response = await fetch( Url, {
		method: 'POST',
		headers: Object.assign( { 'Content-Type': 'application/json', 'Accept': 'application/json, text/event-stream' }, Headers || {} ),
		body: JSON.stringify( Body ),
	} );
	return { Status: response.status, Session: response.headers.get( 'mcp-session-id' ), Json: await response.json() };
}


// Each mode as the same three verbs: run an object, insert documents, find rows. Each answers the
// envelope.
async function web_api( File )
{
	let held = hold( File );
	let server = await Api.Listen( Api.NewApi( held, {} ), '127.0.0.1', 0 );
	let base = 'http://127.0.0.1:' + server.address().port;
	let send = async function ( Route, Body ) { return ( await post_json( base + Route, Body ) ).Json; };
	return {
		Run: function ( Name ) { return send( '/run', { name: Name } ); },
		Insert: function ( Name, Documents ) { return send( '/datasource/insert', { name: Name, documents: Documents } ); },
		Find: function ( Name ) { return send( '/datasource/find', { name: Name } ); },
		Close: async function () { await Api.Close( server ); await held.Release(); },
	};
}

async function mcp_http( File )
{
	let held = hold( File );
	let server = await Api.Listen( Http.NewMcpHttp( held, {} ), '127.0.0.1', 0 );
	let url = 'http://127.0.0.1:' + server.address().port + Http.ENDPOINT;
	let started = await post_json( url, { jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-11-25', capabilities: {}, clientInfo: { name: 't', version: '0' } } } );
	let headers = { 'Mcp-Session-Id': started.Session, 'MCP-Protocol-Version': '2025-11-25' };
	let id = 1;
	let tool = async function ( Name, Arguments )
	{
		id++;
		let reply = await post_json( url, { jsonrpc: '2.0', id: id, method: 'tools/call', params: { name: Name, arguments: Arguments } }, headers );
		return reply.Json.result.structuredContent;
	};
	return {
		Run: function ( Name ) { return tool( 'run', { name: Name } ); },
		Insert: function ( Name, Documents ) { return tool( 'datasource_insert', { name: Name, documents: Documents } ); },
		Find: function ( Name ) { return tool( 'datasource_find', { name: Name } ); },
		Close: async function () { await Api.Close( server ); await held.Release(); },
	};
}


//---------------------------------------------------------------------
function fired( Envelope )
{
	return Envelope.Log.some( function ( Line ) { return Line.includes( Watched.FIRED ); } );
}

for ( let mode of [ { Name: 'the Web API', Open: web_api }, { Name: 'MCP over HTTP', Open: mcp_http } ] )
{
	describe( 'Triggers fire for a client of ' + mode.Name, function ()
	{

		let root = null;
		let counter = 0;

		function fresh()
		{
			counter++;
			let file = LIB_PATH.join( root, 'watched-' + counter + '.jsonx' );
			LIB_FS.writeFileSync( file, JSON.stringify( Watched.Document(), null, '\t' ) );
			return file;
		}

		before( function () { root = LIB_FS.mkdtempSync( LIB_PATH.join( LIB_OS.tmpdir(), 'jsonx-served-triggers-' ) ); } );
		after( function () { LIB_FS.rmSync( root, { recursive: true, force: true } ); } );


		it( 'fires the file\'s trigger for an insert, and the triggered Process writes', async function ()
		{
			let client = await mode.Open( fresh() );
			try
			{
				let inserted = await client.Insert( 'Watched', [ { Name: 'first' }, { Name: 'second' } ] );
				LIB_ASSERT.strictEqual( inserted.ExitCode, 0, inserted.Log.join( '\n' ) );
				LIB_ASSERT.ok( fired( inserted ), inserted.Log.join( '\n' ) );

				let notes = await client.Find( 'Notes' );
				LIB_ASSERT.deepStrictEqual( notes.Result.map( function ( Row ) { return Row.Seen; } ).sort(), [ 'first', 'second' ] );
			}
			finally { await client.Close(); }
		} );

		// ***Sent together, not proven to overlap***: over HTTP the run often finishes before the
		// insert's request is read, so this cannot fail for want of the queue (a probe showed it). That
		// the queue keeps an overlapping run from blocking the trigger is asserted in process, where the
		// overlap is certain (Held.test.js).
		it( 'fires it for an insert sent together with a run of the trigger\'s Process', async function ()
		{
			let client = await mode.Open( fresh() );
			try
			{
				await client.Insert( 'Watched', { Name: 'seed' } );
				let answers = await Promise.all( [ client.Run( 'Note each arrival' ), client.Insert( 'Watched', { Name: 'arrived' } ) ] );
				LIB_ASSERT.strictEqual( answers[ 0 ].ExitCode, 0, answers[ 0 ].Log.join( '\n' ) );
				LIB_ASSERT.ok( fired( answers[ 1 ] ), answers[ 1 ].Log.join( '\n' ) );

				// ***Either may reach the queue first***, and both orders are right. The seed's own insert
				// has already noted the seed. Run first: the run notes the one document it finds, then the
				// insert notes its arrival. Insert first: the insert notes its arrival, then the run notes
				// both documents it finds.
				let notes = await client.Find( 'Notes' );
				let seen = notes.Result.map( function ( Row ) { return Row.Seen; } ).sort();
				let run_first = [ 'arrived', 'seed', 'seed' ];
				let insert_first = [ 'arrived', 'arrived', 'seed', 'seed' ];
				LIB_ASSERT.ok( JSON.stringify( seen ) === JSON.stringify( run_first ) || JSON.stringify( seen ) === JSON.stringify( insert_first ), JSON.stringify( seen ) );
				let documents_run = ( seen.length === run_first.length ) ? 1 : 2;
				LIB_ASSERT.ok( answers[ 0 ].Log[ 0 ].startsWith( 'Note each arrival  Process  ran ' + documents_run ), answers[ 0 ].Log.join( '\n' ) );
			}
			finally { await client.Close(); }
		} );

	} );
}
