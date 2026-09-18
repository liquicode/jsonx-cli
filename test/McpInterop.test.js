'use strict';

/*
	***A real client, not our reading of the protocol.*** The official SDK's Client
	(@modelcontextprotocol/sdk, a devDependency) connects to `jsonx mcp` over stdio, launching the bin
	as a client would, and over Streamable HTTP. When a revision of the SDK or of this server drifts from
	the other, this is the test which notices.
*/

const LIB_ASSERT = require( 'assert' );
const LIB_CHILD_PROCESS = require( 'child_process' );
const LIB_FS = require( 'fs' );
const LIB_OS = require( 'os' );
const LIB_PATH = require( 'path' );
const { describe, it, before, after } = require( 'node:test' );

const { Client } = require( '@modelcontextprotocol/sdk/client/index.js' );
const { StdioClientTransport } = require( '@modelcontextprotocol/sdk/client/stdio.js' );
const { StreamableHTTPClientTransport } = require( '@modelcontextprotocol/sdk/client/streamableHttp.js' );

const Protocol = require( '../modes/mcp/Protocol.js' );
const Spec = require( './fixtures/Spec.js' );

const BIN = LIB_PATH.resolve( __dirname, '..', 'bin', 'jsonx.js' );


//---------------------------------------------------------------------
function child_env()
{
	let env = Object.assign( {}, process.env );
	delete env.JSONX_FILE;
	delete env.JSONX_TOKEN;
	return env;
}

// What `jsonx run` writes for an object, for the MCP answer to equal.
function run_result( File, Name )
{
	let ran = LIB_CHILD_PROCESS.spawnSync( process.execPath, [ BIN, 'run', Name, '--file', File, '--quiet' ], { env: child_env(), encoding: 'utf8' } );
	LIB_ASSERT.strictEqual( ran.status, 0, ran.stderr );
	return JSON.parse( ran.stdout );
}

// What every client does with a connected server.
async function exercise( Client_, File )
{
	let tools = ( await Client_.listTools() ).tools;
	let names = tools.map( function ( Tool ) { return Tool.name; } );
	LIB_ASSERT.ok( names.includes( 'run' ) && names.includes( 'datasource_find' ), names.join( ' ' ) );
	LIB_ASSERT.ok( ( tools.find( function ( Tool ) { return Tool.name === 'datasource_drop'; } ).inputSchema.required || [] ).includes( 'yes' ) );

	let ran = await Client_.callTool( { name: 'run', arguments: { name: 'Prepare the season' } } );
	LIB_ASSERT.strictEqual( ran.isError, false, JSON.stringify( ran ) );
	LIB_ASSERT.deepStrictEqual( ran.structuredContent.Result, run_result( File, 'Prepare the season' ) );
	LIB_ASSERT.deepStrictEqual( JSON.parse( ran.content[ 0 ].text ), ran.structuredContent );

	let refused = await Client_.callTool( { name: 'datasource_delete', arguments: { name: 'Bookings', criteria: {} } } );
	LIB_ASSERT.strictEqual( refused.isError, true );

	let resources = ( await Client_.listResources() ).resources;
	LIB_ASSERT.strictEqual( resources[ 0 ].uri, Protocol.FILE_URI );
	let read = await Client_.readResource( { uri: Protocol.ENTRY_URI + 'Bookings' } );
	LIB_ASSERT.strictEqual( JSON.parse( read.contents[ 0 ].text ).Name, 'Bookings' );

	await Client_.ping();
	return;
}


//---------------------------------------------------------------------
describe( 'The official MCP client against jsonx mcp', function ()
{

	let root = null;
	let observatory = null;

	before( function ()
	{
		root = LIB_FS.mkdtempSync( LIB_PATH.join( LIB_OS.tmpdir(), 'jsonx-interop-' ) );
		observatory = LIB_PATH.join( root, 'observatory.jsonx' );
		LIB_FS.writeFileSync( observatory, JSON.stringify( Spec.AppendixB(), null, '\t' ) );
	} );

	after( function () { LIB_FS.rmSync( root, { recursive: true, force: true } ); } );


	it( 'connects over stdio, launching the bin', async function ()
	{
		let transport = new StdioClientTransport( { command: process.execPath, args: [ BIN, 'mcp', '--profile', 'full', '--file', observatory ], env: child_env(), stderr: 'pipe' } );
		let client = new Client( { name: 'jsonx-interop', version: '0.0.0' } );
		await client.connect( transport );
		try
		{
			LIB_ASSERT.deepStrictEqual( client.getServerVersion(), { name: 'jsonx', title: 'jsonx', version: require( '../package.json' ).version } );
			LIB_ASSERT.ok( client.getServerCapabilities().tools );
			await exercise( client, observatory );
		}
		finally { await client.close(); }
	} );

	it( 'sees the translate profile\'s tools, switches with jsonx/profile, and is told the list changed', async function ()
	{
		const { ResultSchema, ToolListChangedNotificationSchema } = require( '@modelcontextprotocol/sdk/types.js' );
		let transport = new StdioClientTransport( { command: process.execPath, args: [ BIN, 'mcp', '--profile', 'translate', '--file', observatory ], env: child_env(), stderr: 'pipe' } );
		let client = new Client( { name: 'jsonx-interop', version: '0.0.0' } );
		let changed = new Promise( function ( Resolve ) { client.setNotificationHandler( ToolListChangedNotificationSchema, function () { Resolve(); } ); } );
		await client.connect( transport );
		try
		{
			LIB_ASSERT.strictEqual( client.getServerCapabilities().tools.listChanged, true );
			LIB_ASSERT.match( client.getInstructions(), /Build the object; do not run it\./ );
			LIB_ASSERT.doesNotMatch( client.getInstructions(), /translate/ );
			let before = ( await client.listTools() ).tools.map( function ( Tool ) { return Tool.name; } );
			LIB_ASSERT.strictEqual( before.length, 13, before.join( ' ' ) );
			LIB_ASSERT.ok( before.includes( 'process_list' ) && !before.includes( 'process_show' ) && !before.includes( 'process_add' ) );
			LIB_ASSERT.ok( !before.includes( 'run' ) );

			let asked = await client.request( { method: 'jsonx/profile' }, ResultSchema );
			LIB_ASSERT.strictEqual( asked.Name, 'translate' );

			let switched = await client.request( { method: 'jsonx/profile', params: { profile: 'run' } }, ResultSchema );
			LIB_ASSERT.strictEqual( switched.Name, 'run' );
			await changed;
			let after = ( await client.listTools() ).tools.map( function ( Tool ) { return Tool.name; } );
			LIB_ASSERT.ok( after.includes( 'run' ), after.join( ' ' ) );
			let ran = await client.callTool( { name: 'run', arguments: { name: 'Prepare the season' } } );
			LIB_ASSERT.strictEqual( ran.isError, false, JSON.stringify( ran ) );
		}
		finally { await client.close(); }
	} );

	it( 'connects over Streamable HTTP, and ends its session', async function ()
	{
		let child = LIB_CHILD_PROCESS.spawn( process.execPath, [ BIN, 'mcp', '--http', '--port', '0', '--profile', 'full', '--file', observatory ], { env: child_env() } );
		try
		{
			let url = await new Promise( function ( Resolve, Reject )
			{
				let text = '';
				let timer = setTimeout( function () { Reject( new Error( 'jsonx mcp --http did not announce its address: ' + text ) ); }, 15000 );
				child.stderr.on( 'data', function ( Chunk )
				{
					text += Chunk;
					let match = /at (http:\/\/127\.0\.0\.1:\d+\/mcp)/.exec( text );
					if ( match ) { clearTimeout( timer ); Resolve( match[ 1 ] ); }
				} );
				child.on( 'exit', function ( Code ) { clearTimeout( timer ); Reject( new Error( 'jsonx mcp --http exited ' + Code + ': ' + text ) ); } );
			} );

			let transport = new StreamableHTTPClientTransport( new URL( url ) );
			let client = new Client( { name: 'jsonx-interop', version: '0.0.0' } );
			await client.connect( transport );
			try
			{
				LIB_ASSERT.strictEqual( transport.protocolVersion, Protocol.PROTOCOL_VERSION );
				LIB_ASSERT.strictEqual( typeof transport.sessionId, 'string' );
				await exercise( client, observatory );
				await transport.terminateSession();
				LIB_ASSERT.strictEqual( transport.sessionId, undefined );
			}
			finally { await client.close(); }
		}
		finally { child.kill(); }
	} );

} );
