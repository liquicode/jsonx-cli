'use strict';

const LIB_ASSERT = require( 'assert' );
const LIB_FS = require( 'fs' );
const LIB_OS = require( 'os' );
const LIB_PATH = require( 'path' );
const { describe, it, before, after } = require( 'node:test' );

const Protocol = require( '../modes/mcp/Protocol.js' );
const Stdio = require( '../modes/mcp/Stdio.js' );
const Http = require( '../modes/mcp/Http.js' );
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

function hold( File, Env )
{
	return Held.NewHeld( { Tree: Commands.TREE, File: File, Io: io_for( File, Env ) } );
}

let next_id = 100;
function request( Method, Params )
{
	let message = { jsonrpc: '2.0', id: next_id++, method: Method };
	if ( typeof Params !== 'undefined' ) { message.params = Params; }
	return message;
}

async function call( Mcp, Name, Arguments )
{
	let reply = await Mcp.Handle( request( 'tools/call', { name: Name, arguments: Arguments } ) );
	LIB_ASSERT.ok( reply.result, JSON.stringify( reply ) );
	return reply.result;
}


//---------------------------------------------------------------------
describe( 'MCP, the protocol', function ()
{

	let root = null;
	let observatory = null;
	let scratch = null;
	let secret = null;

	before( function ()
	{
		root = LIB_FS.mkdtempSync( LIB_PATH.join( LIB_OS.tmpdir(), 'jsonx-mcp-' ) );
		observatory = write( root, 'observatory.jsonx', Spec.AppendixB() );
		scratch = write( root, 'scratch.jsonx', {
			DataSources: [ { Name: 'Scratch', AdapterName: 'jsonstor-memory' } ],
			Objects: [ { Kind: 'Insert', Name: 'Seed', DataSource: 'Scratch', Documents: [ { _id: 'a' }, { _id: 'b' } ] } ],
		} );
		secret = write( root, 'secret.jsonx', {
			DataSources: [ { Name: 'Kept', AdapterName: 'jsonstor-jsonfile', Settings: { Path: '${env:JSONX_TEST_SECRET}' } } ],
			Objects: [ { Kind: 'Query', Name: 'Read kept', DataSource: 'Kept', Criteria: {} } ],
		} );
	} );

	after( function () { LIB_FS.rmSync( root, { recursive: true, force: true } ); } );


	it( 'initializes in the revision asked for when it speaks it, and in its own otherwise', async function ()
	{
		let held = hold( scratch );
		try
		{
			let mcp = Protocol.NewMcp( held, { Version: '9.9.9' } );
			let reply = await mcp.Handle( request( 'initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'test', version: '0' } } ) );
			LIB_ASSERT.strictEqual( reply.result.protocolVersion, '2025-06-18' );
			LIB_ASSERT.deepStrictEqual( reply.result.capabilities, { tools: { listChanged: true }, resources: {} } );
			LIB_ASSERT.deepStrictEqual( reply.result.serverInfo, { name: 'jsonx', title: 'jsonx', version: '9.9.9' } );

			let other = Protocol.NewMcp( held );
			let fallback = await other.Handle( request( 'initialize', { protocolVersion: '1999-01-01', capabilities: {}, clientInfo: { name: 'test', version: '0' } } ) );
			LIB_ASSERT.strictEqual( fallback.result.protocolVersion, Protocol.PROTOCOL_VERSION );
			LIB_ASSERT.strictEqual( Protocol.PROTOCOL_VERSION, '2025-11-25' );

			LIB_ASSERT.strictEqual( await mcp.Handle( { jsonrpc: '2.0', method: 'notifications/initialized' } ), null );
			LIB_ASSERT.deepStrictEqual( ( await mcp.Handle( request( 'ping' ) ) ).result, {} );
		}
		finally { await held.Release(); }
	} );

	it( 'lists one tool per served command, named by its words, with an object schema', async function ()
	{
		let held = hold( scratch );
		try
		{
			let mcp = Protocol.NewMcp( held );
			let tools = ( await mcp.Handle( request( 'tools/list' ) ) ).result.tools;
			let expected = Held.ServedCommands( Commands.TREE ).map( function ( Command ) { return Command.Path.join( '_' ); } );
			LIB_ASSERT.deepStrictEqual( tools.map( function ( Tool ) { return Tool.name; } ), expected );
			LIB_ASSERT.strictEqual( new Set( expected ).size, expected.length, 'tool names are unique' );
			for ( let tool of tools )
			{
				LIB_ASSERT.ok( /^[A-Za-z0-9_.-]{1,128}$/.test( tool.name ), tool.name );
				LIB_ASSERT.strictEqual( tool.inputSchema.type, 'object', tool.name );
				LIB_ASSERT.strictEqual( tool.inputSchema.additionalProperties, false, tool.name );
				LIB_ASSERT.strictEqual( typeof tool.description, 'string', tool.name );
			}
			for ( let unserved of [ 'debug', 'completion', '__complete', 'serve', 'mcp' ] )
			{
				LIB_ASSERT.ok( !tools.some( function ( Tool ) { return Tool.name === unserved; } ), unserved );
			}
		}
		finally { await held.Release(); }
	} );

	it( 'builds each input schema from the command\'s declarations', async function ()
	{
		let held = hold( scratch );
		try
		{
			let tools = {};
			for ( let tool of Protocol.NewMcp( held ).Tools ) { tools[ tool.name ] = tool; }

			let run = tools.run.inputSchema;
			LIB_ASSERT.deepStrictEqual( run.properties.name, { type: 'string', description: 'The object to run; or pass --json.' } );
			// name or json, so neither is required (cut 7); the handler refuses neither and both.
			LIB_ASSERT.strictEqual( 'required' in run, false, JSON.stringify( run.required ) );
			LIB_ASSERT.deepStrictEqual( run.properties.json.type, 'object' );
			LIB_ASSERT.strictEqual( 'type' in run.properties.input, false, 'a json value is any JSON value' );
			LIB_ASSERT.deepStrictEqual( run.properties.trace.type, 'boolean' );
			for ( let refused of [ 'file', 'bind', 'set', 'quiet', 'output', 'help', 'input-json' ] ) { LIB_ASSERT.ok( !( refused in run.properties ), refused ); }

			LIB_ASSERT.deepStrictEqual( tools.datasource_describe.inputSchema.properties.rows.type, 'integer' );
			LIB_ASSERT.strictEqual( tools.datasource_describe.inputSchema.properties.rows.default, require( '../src/Session/Inspect.js' ).DEFAULT_ROWS );
			LIB_ASSERT.deepStrictEqual( tools.new.inputSchema.properties.kind.enum, require( '../src/File/Skeletons.js' ).KINDS );
			LIB_ASSERT.strictEqual( tools.engine_filter.inputSchema.properties[ 'documents-jsonl' ].type, 'array' );

			// A json value which must be an object says so, or a model sends it as a string of JSON.
			let find = tools.datasource_find.inputSchema.properties;
			for ( let name of [ 'criteria', 'projection', 'sort' ] ) { LIB_ASSERT.strictEqual( find[ name ].type, 'object', 'datasource_find ' + name ); }
			LIB_ASSERT.strictEqual( tools.datasource_update.inputSchema.properties.update.type, 'object' );
			LIB_ASSERT.strictEqual( tools.datasource_replace.inputSchema.properties.document.type, 'object' );
			LIB_ASSERT.deepStrictEqual( tools.datasource_insert.inputSchema.properties.documents.type, [ 'object', 'array' ] );
			LIB_ASSERT.strictEqual( tools.query_add.inputSchema.properties.json.type, 'object' );
			LIB_ASSERT.strictEqual( tools.engine_match.inputSchema.properties.criteria.type, 'object' );
			LIB_ASSERT.strictEqual( tools.engine_aggregate.inputSchema.properties.pipeline.type, 'array' );
			LIB_ASSERT.strictEqual( tools.engine_aggregate.inputSchema.properties.scope.type, 'object' );
			LIB_ASSERT.deepStrictEqual( tools.engine_join.inputSchema.properties.with.type, [ 'object', 'array' ], 'a second set of documents is one or many' );
			LIB_ASSERT.deepStrictEqual( tools.engine_join.inputSchema.properties.type.enum, [ 'Left', 'Inner', 'Right', 'Outer' ] );
			LIB_ASSERT.deepStrictEqual( tools.engine_union.inputSchema.properties.with.type, [ 'object', 'array' ] );
			LIB_ASSERT.strictEqual( 'type' in tools.engine_evaluate.inputSchema.properties.expression, false, 'an expression can be a string' );
			LIB_ASSERT.strictEqual( 'type' in tools.engine_schema_validate.inputSchema.properties.schema, false, 'a JSON Schema can be a boolean' );
			LIB_ASSERT.ok( tools[ 'datasource_find-one' ], 'a hyphen is kept' );
		}
		finally { await held.Release(); }
	} );

	it( 'marks what only reads and what may destroy', async function ()
	{
		let held = hold( scratch );
		try
		{
			let hints = {};
			for ( let tool of Protocol.NewMcp( held ).Tools ) { hints[ tool.name ] = tool.annotations; }
			for ( let name of [ 'validate', 'plan', 'explain', 'new', 'engine_filter', 'adapters_list', 'query_list', 'datasource_show', 'datasource_count', 'datasource_describe' ] )
			{
				LIB_ASSERT.strictEqual( hints[ name ].readOnlyHint, true, name );
				LIB_ASSERT.strictEqual( 'destructiveHint' in hints[ name ], false, name );
			}
			for ( let name of [ 'run', 'trigger_run', 'datasource_update', 'datasource_delete', 'datasource_replace', 'datasource_drop', 'query_remove', 'query_rename', 'query_set', 'format' ] )
			{
				LIB_ASSERT.deepStrictEqual( [ hints[ name ].readOnlyHint, hints[ name ].destructiveHint ], [ false, true ], name );
			}
			for ( let name of [ 'datasource_insert', 'query_add', 'datasource_find' ] )
			{
				LIB_ASSERT.deepStrictEqual( [ hints[ name ].readOnlyHint, hints[ name ].destructiveHint ], [ false, false ], name );
			}
		}
		finally { await held.Release(); }
	} );

	it( 'requires yes on every tool whose command declares --yes, and the guard still decides', async function ()
	{
		let held = hold( scratch );
		try
		{
			let mcp = Protocol.NewMcp( held );
			let guarded = mcp.Tools.filter( function ( Tool ) { return ( Tool.inputSchema.required || [] ).includes( 'yes' ); } ).map( function ( Tool ) { return Tool.name; } );
			LIB_ASSERT.deepStrictEqual( guarded.sort(), [ 'datasource_delete', 'datasource_drop', 'datasource_update' ] );

			await call( mcp, 'run', { name: 'Seed' } );

			let missing = await call( mcp, 'datasource_delete', { name: 'Scratch', criteria: {} } );
			LIB_ASSERT.strictEqual( missing.isError, true );
			LIB_ASSERT.ok( /requires yes/.test( missing.structuredContent.Log[ 0 ] ) );

			let declined = await call( mcp, 'datasource_delete', { name: 'Scratch', criteria: {}, yes: false } );
			LIB_ASSERT.strictEqual( declined.isError, true );
			LIB_ASSERT.strictEqual( declined.structuredContent.ExitCode, 2 );
			// The guard's message names how a served client confirms, not only the command line's flag.
			LIB_ASSERT.ok( declined.structuredContent.Log[ 0 ].includes( '"yes": true in a Web API or MCP request' ), declined.structuredContent.Log[ 0 ] );
			LIB_ASSERT.strictEqual( ( await call( mcp, 'datasource_count', { name: 'Scratch' } ) ).structuredContent.Result, 2, 'nothing was removed' );

			let saved = await call( mcp, 'datasource_delete', { name: 'Scratch', criteria: { _id: 'a' }, save: 'Remove a', yes: true } );
			LIB_ASSERT.strictEqual( saved.isError, false, JSON.stringify( saved.structuredContent ) );
			LIB_ASSERT.strictEqual( ( await call( mcp, 'datasource_count', { name: 'Scratch' } ) ).structuredContent.Result, 2, 'save runs nothing' );

			let confirmed = await call( mcp, 'datasource_delete', { name: 'Scratch', criteria: {}, yes: true } );
			LIB_ASSERT.strictEqual( confirmed.isError, false, JSON.stringify( confirmed.structuredContent ) );
			LIB_ASSERT.strictEqual( ( await call( mcp, 'datasource_count', { name: 'Scratch' } ) ).structuredContent.Result, 0 );
		}
		finally { await held.Release(); }
	} );

	it( 'answers a call with the envelope, as text and as structuredContent, and a mistake as a tool error', async function ()
	{
		let held = hold( observatory );
		try
		{
			let mcp = Protocol.NewMcp( held );
			let ran = await call( mcp, 'run', { name: 'Prepare the season' } );
			LIB_ASSERT.strictEqual( ran.isError, false );
			LIB_ASSERT.deepStrictEqual( ran.structuredContent.Result, [ { Booking: 'b-1', Observer: 'R. Okafor', Dome: 'B' } ] );
			LIB_ASSERT.deepStrictEqual( JSON.parse( ran.content[ 0 ].text ), ran.structuredContent );
			LIB_ASSERT.ok( ran.structuredContent.Log.some( function ( Line ) { return Line.includes( 'trigger [Note every long booking as it arrives]' ); } ) );

			let usage = await call( mcp, 'run', { name: 'No such object' } );
			LIB_ASSERT.deepStrictEqual( [ usage.isError, usage.structuredContent.ExitCode ], [ true, 2 ] );

			let named = await call( mcp, 'validate', { Command: 'run' } );
			LIB_ASSERT.strictEqual( named.isError, true );

			let unknown = await mcp.Handle( request( 'tools/call', { name: 'no_such_tool', arguments: {} } ) );
			LIB_ASSERT.strictEqual( unknown.error.code, Protocol.ERRORS.INVALID_PARAMS );
			let shapeless = await mcp.Handle( request( 'tools/call', { name: 'validate', arguments: [ 1 ] } ) );
			LIB_ASSERT.strictEqual( shapeless.error.code, Protocol.ERRORS.INVALID_PARAMS );
		}
		finally { await held.Release(); }
	} );

	it( 'serves the file and its entries as resources, as written (F6.4)', async function ()
	{
		let value = 'the-resolved-secret-value';
		let held = hold( secret, { JSONX_TEST_SECRET: value } );
		try
		{
			let mcp = Protocol.NewMcp( held );
			let listed = ( await mcp.Handle( request( 'resources/list' ) ) ).result.resources;
			LIB_ASSERT.deepStrictEqual( listed.map( function ( Resource ) { return Resource.uri; } ), [ 'jsonx://file', 'jsonx://entry/Kept', 'jsonx://entry/Read%20kept' ] );

			let file = ( await mcp.Handle( request( 'resources/read', { uri: 'jsonx://file' } ) ) ).result.contents[ 0 ];
			LIB_ASSERT.deepStrictEqual( JSON.parse( file.text ), held.Session.Document );
			let entry = ( await mcp.Handle( request( 'resources/read', { uri: 'jsonx://entry/Kept' } ) ) ).result.contents[ 0 ];
			LIB_ASSERT.ok( entry.text.includes( '${env:JSONX_TEST_SECRET}' ) );
			let query = ( await mcp.Handle( request( 'resources/read', { uri: 'jsonx://entry/Read%20kept' } ) ) ).result.contents[ 0 ];
			LIB_ASSERT.strictEqual( JSON.parse( query.text ).Kind, 'Query' );

			for ( let reply of [ file, entry, listed ] ) { LIB_ASSERT.ok( !JSON.stringify( reply ).includes( value ) ); }

			let missing = await mcp.Handle( request( 'resources/read', { uri: 'jsonx://entry/Nothing' } ) );
			LIB_ASSERT.deepStrictEqual( [ missing.error.code, missing.error.data ], [ Protocol.ERRORS.RESOURCE_NOT_FOUND, { uri: 'jsonx://entry/Nothing' } ] );
			LIB_ASSERT.deepStrictEqual( ( await mcp.Handle( request( 'resources/templates/list' ) ) ).result, { resourceTemplates: [] } );
		}
		finally { await held.Release(); }
	} );

	it( 'answers malformed messages with JSON-RPC errors, and never answers a notification', async function ()
	{
		let held = hold( scratch );
		try
		{
			let mcp = Protocol.NewMcp( held );
			LIB_ASSERT.strictEqual( ( await mcp.Handle( [ request( 'ping' ) ] ) ).error.code, Protocol.ERRORS.INVALID_REQUEST );
			LIB_ASSERT.strictEqual( ( await mcp.Handle( { id: 1, method: 'ping' } ) ).error.code, Protocol.ERRORS.INVALID_REQUEST );
			LIB_ASSERT.strictEqual( ( await mcp.Handle( request( 'no/such' ) ) ).error.code, Protocol.ERRORS.METHOD_NOT_FOUND );
			LIB_ASSERT.strictEqual( ( await mcp.Handle( { jsonrpc: '2.0', id: 5, method: 'tools/list', params: [ 1 ] } ) ).error.code, Protocol.ERRORS.INVALID_PARAMS );
			LIB_ASSERT.strictEqual( await mcp.Handle( { jsonrpc: '2.0', method: 'notifications/anything' } ), null );
			LIB_ASSERT.strictEqual( await mcp.Handle( { jsonrpc: '2.0', id: 9, result: {} } ), null );
			let parse = await mcp.HandleText( '{nope' );
			LIB_ASSERT.deepStrictEqual( [ parse.id, parse.error.code ], [ null, Protocol.ERRORS.PARSE_ERROR ] );
		}
		finally { await held.Release(); }
	} );

} );


//---------------------------------------------------------------------
describe( 'MCP over stdio', function ()
{

	let root = null;
	let scratch = null;

	before( function ()
	{
		root = LIB_FS.mkdtempSync( LIB_PATH.join( LIB_OS.tmpdir(), 'jsonx-mcp-stdio-' ) );
		scratch = write( root, 'scratch.jsonx', {
			DataSources: [ { Name: 'Scratch', AdapterName: 'jsonstor-memory' } ],
			Objects: [ { Kind: 'Insert', Name: 'Seed', DataSource: 'Scratch', Documents: [ { _id: 'a' } ] } ],
		} );
	} );

	after( function () { LIB_FS.rmSync( root, { recursive: true, force: true } ); } );

	function lines_of( Messages )
	{
		return Messages.map( function ( Message ) { return ( typeof Message === 'string' ) ? Message : JSON.stringify( Message ); } );
	}

	it( 'writes one reply per request, and nothing for a notification or a blank line', async function ()
	{
		let held = hold( scratch );
		try
		{
			let written = [];
			await Stdio.ServeStdio( Protocol.NewMcp( held ), lines_of( [
				{ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-11-25', capabilities: {}, clientInfo: { name: 't', version: '0' } } },
				{ jsonrpc: '2.0', method: 'notifications/initialized' },
				'',
				{ jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: 'run', arguments: { name: 'Seed' } } },
				'{broken',
			] ), function ( Text ) { written.push( Text ); } );

			LIB_ASSERT.ok( written.every( function ( Text ) { return Text.endsWith( '\n' ) && Text.indexOf( '\n' ) === Text.length - 1; } ) );
			let replies = written.map( function ( Text ) { return JSON.parse( Text ); } );
			LIB_ASSERT.strictEqual( replies.length, 3 );
			let by_id = {};
			for ( let reply of replies ) { by_id[ reply.id ] = reply; }
			LIB_ASSERT.strictEqual( by_id[ 1 ].result.protocolVersion, '2025-11-25' );
			LIB_ASSERT.strictEqual( by_id[ 2 ].result.isError, false );
			LIB_ASSERT.strictEqual( by_id[ null ].error.code, Protocol.ERRORS.PARSE_ERROR );
		}
		finally { await held.Release(); }
	} );

	it( 'runs as jsonx mcp: only MCP messages on standard output, and exit 0 at the end of input', async function ()
	{
		let io = io_for( scratch );
		io.Out = '';
		io.Err = '';
		io.Stdout = function ( Text ) { io.Out += Text; };
		io.Stderr = function ( Text ) { io.Err += Text; };
		io.Lines = function () { return lines_of( [
			{ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-11-25', capabilities: {}, clientInfo: { name: 't', version: '0' } } },
			{ jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: 'run', arguments: { name: 'Seed' } } },
			{ jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'datasource_count', arguments: { name: 'Scratch' } } },
		] ); };

		let code = await Main.Main( [ 'mcp', '--file', scratch ], io );
		LIB_ASSERT.strictEqual( code, 0, io.Err );
		let replies = io.Out.trim().split( '\n' ).map( function ( Line ) { return JSON.parse( Line ); } );
		LIB_ASSERT.deepStrictEqual( replies.map( function ( Reply ) { return Reply.jsonrpc; } ), [ '2.0', '2.0', '2.0' ] );
		LIB_ASSERT.ok( io.Err.startsWith( 'MCP over stdio for ' ), io.Err );
	} );

	it( 'refuses both transports, an HTTP option without --http, --output, and a wide host without a token', async function ()
	{
		let cases = [
			[ [ 'mcp', '--stdio', '--http' ], /Choose one transport/ ],
			[ [ 'mcp', '--port', '4000' ], /\[--port\] has an effect only with --http/ ],
			[ [ 'mcp', '--output', 'json' ], /does not apply to jsonx mcp/ ],
			[ [ 'mcp', '--http', '--host', '0.0.0.0' ], /needs a token/ ],
		];
		for ( let index = 0; index < cases.length; index++ )
		{
			let io = io_for( scratch );
			io.Err = '';
			io.Stdout = function () { return; };
			io.Stderr = function ( Text ) { io.Err += Text; };
			let code = await Main.Main( cases[ index ][ 0 ].concat( [ '--file', scratch ] ), io );
			LIB_ASSERT.strictEqual( code, 2, io.Err );
			LIB_ASSERT.ok( cases[ index ][ 1 ].test( io.Err ), io.Err );
		}
	} );

} );


//---------------------------------------------------------------------
describe( 'MCP over HTTP', function ()
{

	let root = null;
	let scratch = null;

	before( function ()
	{
		root = LIB_FS.mkdtempSync( LIB_PATH.join( LIB_OS.tmpdir(), 'jsonx-mcp-http-' ) );
		scratch = write( root, 'scratch.jsonx', {
			DataSources: [ { Name: 'Scratch', AdapterName: 'jsonstor-memory' } ],
			Objects: [ { Kind: 'Insert', Name: 'Seed', DataSource: 'Scratch', Documents: [ { _id: 'a' } ] } ],
		} );
	} );

	after( function () { LIB_FS.rmSync( root, { recursive: true, force: true } ); } );

	async function serve( Options )
	{
		let held = hold( scratch );
		let app = Http.NewMcpHttp( held, Object.assign( { Version: 'test' }, Options || {} ) );
		let server = await Api.Listen( app, '127.0.0.1', 0 );
		return {
			Url: 'http://127.0.0.1:' + server.address().port + '/mcp',
			Close: async function () { await Api.Close( server ); await held.Release(); },
		};
	}

	async function post( Url, Body, Headers )
	{
		let response = await fetch( Url, {
			method: 'POST',
			headers: Object.assign( { 'Content-Type': 'application/json', 'Accept': 'application/json, text/event-stream' }, Headers || {} ),
			body: ( typeof Body === 'string' ) ? Body : JSON.stringify( Body ),
		} );
		let text = await response.text();
		return { Status: response.status, Session: response.headers.get( 'mcp-session-id' ), Text: text, Json: text ? JSON.parse( text ) : null };
	}

	const INITIALIZE = { jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-11-25', capabilities: {}, clientInfo: { name: 't', version: '0' } } };

	it( 'begins a session at initialize, and holds every later request to it', async function ()
	{
		let served = await serve();
		try
		{
			let started = await post( served.Url, INITIALIZE );
			LIB_ASSERT.strictEqual( started.Status, 200 );
			LIB_ASSERT.ok( /^[\x21-\x7E]+$/.test( started.Session ), started.Session );
			let session = { 'Mcp-Session-Id': started.Session, 'MCP-Protocol-Version': '2025-11-25' };

			let notified = await post( served.Url, { jsonrpc: '2.0', method: 'notifications/initialized' }, session );
			LIB_ASSERT.deepStrictEqual( [ notified.Status, notified.Text ], [ 202, '' ] );

			let listed = await post( served.Url, { jsonrpc: '2.0', id: 2, method: 'tools/list' }, session );
			LIB_ASSERT.strictEqual( listed.Status, 200 );
			LIB_ASSERT.ok( listed.Json.result.tools.length > 50 );

			let ran = await post( served.Url, { jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'run', arguments: { name: 'Seed' } } }, session );
			LIB_ASSERT.strictEqual( ran.Json.result.isError, false, ran.Text );

			let without = await post( served.Url, { jsonrpc: '2.0', id: 4, method: 'tools/list' } );
			LIB_ASSERT.strictEqual( without.Status, 400 );
			LIB_ASSERT.strictEqual( without.Json.id, null );

			let unknown = await post( served.Url, { jsonrpc: '2.0', id: 5, method: 'tools/list' }, { 'Mcp-Session-Id': 'not-a-session' } );
			LIB_ASSERT.strictEqual( unknown.Status, 404 );

			let ended = await fetch( served.Url, { method: 'DELETE', headers: { 'Mcp-Session-Id': started.Session } } );
			LIB_ASSERT.strictEqual( ended.status, 204 );
			let after_end = await post( served.Url, { jsonrpc: '2.0', id: 6, method: 'tools/list' }, session );
			LIB_ASSERT.strictEqual( after_end.Status, 404 );
		}
		finally { await served.Close(); }
	} );

	it( 'refuses a revision it does not speak, a batch, bad JSON, and GET', async function ()
	{
		let served = await serve();
		try
		{
			let version = await post( served.Url, INITIALIZE, { 'MCP-Protocol-Version': '1999-01-01' } );
			LIB_ASSERT.strictEqual( version.Status, 400 );
			LIB_ASSERT.ok( /Unsupported MCP-Protocol-Version/.test( version.Json.error.message ) );

			let batch = await post( served.Url, [ INITIALIZE ] );
			LIB_ASSERT.deepStrictEqual( [ batch.Status, batch.Json.error.code ], [ 400, Protocol.ERRORS.INVALID_REQUEST ] );

			let broken = await post( served.Url, '{nope' );
			LIB_ASSERT.deepStrictEqual( [ broken.Status, broken.Json.error.code ], [ 400, Protocol.ERRORS.PARSE_ERROR ] );

			let get = await fetch( served.Url, { headers: { Accept: 'text/event-stream' } } );
			LIB_ASSERT.strictEqual( get.status, 405 );
		}
		finally { await served.Close(); }
	} );

	it( 'applies the Web API\'s rule: a foreign Origin is 403, and a token is checked', async function ()
	{
		let served = await serve();
		try
		{
			let cross = await post( served.Url, INITIALIZE, { Origin: 'http://attacker.example' } );
			LIB_ASSERT.strictEqual( cross.Status, 403 );
			LIB_ASSERT.deepStrictEqual( [ cross.Json.jsonrpc, cross.Json.id ], [ '2.0', null ] );
		}
		finally { await served.Close(); }

		let guarded = await serve( { Token: 'correct horse' } );
		try
		{
			LIB_ASSERT.strictEqual( ( await post( guarded.Url, INITIALIZE ) ).Status, 401 );
			LIB_ASSERT.strictEqual( ( await post( guarded.Url, INITIALIZE, { Authorization: 'Bearer correct horse' } ) ).Status, 200 );
		}
		finally { await guarded.Close(); }
	} );

	it( 'runs as jsonx mcp --http until stopped', async function ()
	{
		let io = io_for( scratch );
		io.Err = '';
		io.Stdout = function () { return; };
		let announced = null;
		let address = new Promise( function ( Resolve ) { announced = Resolve; } );
		io.Stderr = function ( Text )
		{
			io.Err += Text;
			let match = /at (http:\/\/127\.0\.0\.1:\d+\/mcp)/.exec( io.Err );
			if ( match ) { announced( match[ 1 ] ); }
		};
		let stop = null;
		let stopped = new Promise( function ( Resolve ) { stop = Resolve; } );
		io.WaitForStop = function () { return stopped; };

		let running = Main.Main( [ 'mcp', '--http', '--port', '0', '--file', scratch ], io );
		let url = await address;
		let started = await post( url, INITIALIZE );
		LIB_ASSERT.strictEqual( started.Status, 200 );
		let counted = await post( url, { jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: 'datasource_count', arguments: { name: 'Scratch' } } }, { 'Mcp-Session-Id': started.Session } );
		LIB_ASSERT.strictEqual( counted.Json.result.structuredContent.Result, 0 );

		stop();
		LIB_ASSERT.strictEqual( await running, 0, io.Err );
		LIB_ASSERT.ok( io.Err.endsWith( 'Stopped.\n' ), io.Err );
	} );

} );
