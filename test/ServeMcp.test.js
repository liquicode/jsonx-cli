'use strict';

/*
	`jsonx serve --mcp` (cut 9, 2026-10-03): MCP at /mcp beside the Web API, on the same held session, each
	MCP session under the built-in profile it names when it begins.

	-	***What a model is served is what `jsonx mcp --profile` serves, word for word***: jsonx-llm's model
		was trained on the stdio server's instructions and tools, and the desktop's chat talks to this
		endpoint, so the official client reads both and they must be equal, for every built-in profile.
	-	***The model and the window share one copy of the data.*** Measured 2026-10-03: two processes on
		one file each held their own copy of a JSON-file source; the window never saw the model's insert,
		and its next write erased it. Here each side finds the other's row, and the file holds both.
*/

const LIB_ASSERT = require( 'assert' );
const LIB_FS = require( 'fs' );
const LIB_OS = require( 'os' );
const LIB_PATH = require( 'path' );
const { describe, it, before, after } = require( 'node:test' );

const { Client } = require( '@modelcontextprotocol/sdk/client/index.js' );
const { StdioClientTransport } = require( '@modelcontextprotocol/sdk/client/stdio.js' );
const { StreamableHTTPClientTransport } = require( '@modelcontextprotocol/sdk/client/streamableHttp.js' );
const { ResultSchema } = require( '@modelcontextprotocol/sdk/types.js' );

const Main = require( '../modes/cli/Main.js' );
const Parser = require( '../src/CommandLine/Parser.js' );
const Profiles = require( '../src/Session/Profiles.js' );
const Spec = require( './fixtures/Spec.js' );
const WsClient = require( './fixtures/WsClient.js' );

const BIN = LIB_PATH.resolve( __dirname, '..', 'bin', 'jsonx.js' );


//---------------------------------------------------------------------
function child_env()
{
	let env = Object.assign( {}, process.env );
	delete env.JSONX_FILE;
	delete env.JSONX_TOKEN;
	return env;
}


// An Io whose stop is ours, and whose standard error announces the address.
function serve_io( Root )
{
	let io = Parser.DefaultIo();
	io.Env = {};
	io.Cwd = Root;
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


async function http_client( Url )
{
	let client = new Client( { name: 'jsonx-serve-mcp', version: '0.0.0' } );
	await client.connect( new StreamableHTTPClientTransport( new URL( Url ) ) );
	return client;
}


async function stdio_client( File, Profile )
{
	let client = new Client( { name: 'jsonx-serve-mcp', version: '0.0.0' } );
	await client.connect( new StdioClientTransport( { command: process.execPath, args: [ BIN, 'mcp', '--profile', Profile, '--file', File ], env: child_env(), stderr: 'pipe' } ) );
	return client;
}


async function post( Base, Route, Body )
{
	let response = await fetch( Base + Route, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify( Body ) } );
	return await response.json();
}


//---------------------------------------------------------------------
describe( 'jsonx serve --mcp', function ()
{
	let root = null;

	before( function () { root = LIB_FS.mkdtempSync( LIB_PATH.join( LIB_OS.tmpdir(), 'jsonx-serve-mcp-' ) ); } );
	after( function () { LIB_FS.rmSync( root, { recursive: true, force: true } ); } );


	it( 'serves each built-in profile the instructions and tools jsonx mcp serves over stdio, word for word', async function ()
	{
		let file = WsClient.Write( root, 'observatory.jsonx', Spec.AppendixB() );
		let io = serve_io( root );
		let running = Main.Main( [ 'serve', '--api', '--mcp', '--port', '0', '--file', file ], io );
		let base = await io.Address;
		try
		{
			for ( let index = 0; index < Profiles.NAMES.length; index++ )
			{
				let name = Profiles.NAMES[ index ];
				let over_stdio = await stdio_client( file, name );
				let over_http = await http_client( base + '/mcp?profile=' + name );
				try
				{
					LIB_ASSERT.strictEqual( over_http.getInstructions(), over_stdio.getInstructions(), name );
					LIB_ASSERT.deepStrictEqual( ( await over_http.listTools() ).tools, ( await over_stdio.listTools() ).tools, name );
					LIB_ASSERT.strictEqual( ( await over_http.request( { method: 'jsonx/profile' }, ResultSchema ) ).Name, name );
				}
				finally
				{
					await over_http.close();
					await over_stdio.close();
				}
			}

			// A session which names no profile is run's, as `jsonx mcp` is; the Web API keeps its own.
			let unnamed = await http_client( base + '/mcp' );
			try { LIB_ASSERT.strictEqual( ( await unnamed.request( { method: 'jsonx/profile' }, ResultSchema ) ).Name, Profiles.DEFAULT_MCP ); }
			finally { await unnamed.close(); }
			LIB_ASSERT.strictEqual( ( await ( await fetch( base + '/' ) ).json() ).Profile.Name, Profiles.DEFAULT_SERVE );
		}
		finally
		{
			io.Stop();
			LIB_ASSERT.strictEqual( await running, 0, io.Err );
		}
		LIB_ASSERT.strictEqual( JSON.parse( io.Out ).Mcp, base + '/mcp' );
		LIB_ASSERT.ok( io.Err.includes( 'MCP is at ' + base + '/mcp.' ), io.Err );
	} );


	it( 'holds a session to its profile, and refuses a profile which is not a built-in', async function ()
	{
		let file = WsClient.Write( root, 'observatory.jsonx', Spec.AppendixB() );
		let io = serve_io( root );
		let running = Main.Main( [ 'serve', '--api', '--mcp', '--port', '0', '--file', file ], io );
		let base = await io.Address;
		try
		{
			let translate = await http_client( base + '/mcp?profile=translate' );
			try
			{
				await LIB_ASSERT.rejects( translate.callTool( { name: 'run', arguments: { name: 'Prepare the season' } } ), /Unknown tool: run/ );
			}
			finally { await translate.close(); }

			// The window's API serves everything still.
			let ran = await post( base, '/run', { name: 'Prepare the season' } );
			LIB_ASSERT.strictEqual( ran.Ok, true, JSON.stringify( ran ) );

			let answer = await fetch( base + '/mcp?profile=nothing', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json', 'Accept': 'application/json, text/event-stream' },
				body: JSON.stringify( { jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-11-25', capabilities: {}, clientInfo: { name: 'x', version: '0' } } } ),
			} );
			LIB_ASSERT.strictEqual( answer.status, 400 );
			LIB_ASSERT.match( ( await answer.json() ).error.message, /No profile is named \[nothing\]/ );
		}
		finally
		{
			io.Stop();
			LIB_ASSERT.strictEqual( await running, 0, io.Err );
		}
	} );


	// A profile file is never named by a client; the server's own, given at launch, is served by its Name,
	// as `jsonx mcp --profile <file>` serves it.
	it( 'serves the server\'s own profile file to a session which names it, as jsonx mcp serves it', async function ()
	{
		let file = WsClient.Write( root, 'observatory.jsonx', Spec.AppendixB() );
		let mine = LIB_PATH.join( root, 'mine.json' );
		LIB_FS.writeFileSync( mine, JSON.stringify( { Name: 'mine', Describe: 'Validate and look.', Commands: [ 'validate', 'datasource list' ] } ) );
		let io = serve_io( root );
		let running = Main.Main( [ 'serve', '--api', '--mcp', '--profile', mine, '--port', '0', '--file', file ], io );
		let base = await io.Address;
		try
		{
			let over_stdio = await stdio_client( file, mine );
			let over_http = await http_client( base + '/mcp?profile=mine' );
			try
			{
				LIB_ASSERT.strictEqual( over_http.getInstructions(), over_stdio.getInstructions() );
				LIB_ASSERT.deepStrictEqual( ( await over_http.listTools() ).tools.map( function ( Tool ) { return Tool.name; } ), [ 'validate', 'datasource_list' ] );
				LIB_ASSERT.deepStrictEqual( ( await over_http.listTools() ).tools, ( await over_stdio.listTools() ).tools );
			}
			finally
			{
				await over_http.close();
				await over_stdio.close();
			}
		}
		finally
		{
			io.Stop();
			LIB_ASSERT.strictEqual( await running, 0, io.Err );
		}
	} );


	it( 'shares one copy of a JSON-file source between the model and the window, so neither write is lost', async function ()
	{
		let folder = LIB_FS.mkdtempSync( LIB_PATH.join( root, 'shop-' ) );
		LIB_FS.writeFileSync( LIB_PATH.join( folder, 'Widgets.json' ), JSON.stringify( [ { _id: 'w1', Name: 'Bolt', Color: 'red', Price: 2 } ] ) );
		let file = WsClient.Write( folder, 'Shop.jsonx', { Name: 'Shop', DataSources: [ { Name: 'Widgets', AdapterName: 'jsonstor-jsonfile', Settings: { Path: 'Widgets.json' } } ] } );
		let io = serve_io( folder );
		let running = Main.Main( [ 'serve', '--api', '--mcp', '--port', '0', '--file', file ], io );
		let base = await io.Address;
		try
		{
			let model = await http_client( base + '/mcp?profile=run' );
			try
			{
				let inserted = await model.callTool( { name: 'run', arguments: { json: { Kind: 'Insert', DataSource: 'Widgets', Documents: [ { Name: 'From the model', Color: 'blue', Price: 3 } ] } } } );
				LIB_ASSERT.strictEqual( inserted.structuredContent.Ok, true, JSON.stringify( inserted.structuredContent ) );

				let seen = await post( base, '/datasource/find', { name: 'Widgets', criteria: { Name: 'From the model' } } );
				LIB_ASSERT.strictEqual( seen.Result.length, 1, 'the window finds the model\'s row: ' + JSON.stringify( seen ) );

				let saved = await post( base, '/run', { json: { Kind: 'Insert', DataSource: 'Widgets', Documents: [ { Name: 'From the window', Color: 'green', Price: 4 } ] } } );
				LIB_ASSERT.strictEqual( saved.Ok, true, JSON.stringify( saved ) );

				let found = await model.callTool( { name: 'datasource_find', arguments: { name: 'Widgets', criteria: { Name: 'From the window' } } } );
				LIB_ASSERT.strictEqual( found.structuredContent.Result.length, 1, 'the model finds the window\'s row: ' + JSON.stringify( found.structuredContent ) );
			}
			finally { await model.close(); }
		}
		finally
		{
			io.Stop();
			LIB_ASSERT.strictEqual( await running, 0, io.Err );
		}
		let names = JSON.parse( LIB_FS.readFileSync( LIB_PATH.join( folder, 'Widgets.json' ), 'utf8' ) ).map( function ( Row ) { return Row.Name; } ).sort();
		LIB_ASSERT.deepStrictEqual( names, [ 'Bolt', 'From the model', 'From the window' ] );
	} );

} );
