'use strict';

/*
	***The served modes mirror the command line by construction*** (plan F3, F4), and this is the test
	which makes that a failure rather than a claim: every command in the tree is served or says why
	not, and the Web API's routes, MCP's tools and the served table are one set.
*/

const LIB_ASSERT = require( 'assert' );
const LIB_FS = require( 'fs' );
const LIB_OS = require( 'os' );
const LIB_PATH = require( 'path' );
const { describe, it, before, after } = require( 'node:test' );

const Api = require( '../modes/api/Api.js' );
const Protocol = require( '../modes/mcp/Protocol.js' );
const Held = require( '../src/Session/Held.js' );
const Parser = require( '../src/CommandLine/Parser.js' );
const Commands = require( '../commands/jsonx.js' );


//---------------------------------------------------------------------
// Every node with a handler, with the nodes on its path.

function every_command( Tree )
{
	let found = [];
	function visit( Node, Path, Nodes )
	{
		if ( typeof Node.Handler === 'function' && Path.length > 0 ) { found.push( { Command: Path.join( ' ' ), Path: Path, Nodes: Nodes } ); }
		for ( let child of ( Node.Commands || [] ) ) { visit( child, Path.concat( [ child.Command ] ), Nodes.concat( [ child ] ) ); }
		return;
	}
	visit( Tree, [], [ Tree ] );
	return found;
}


//---------------------------------------------------------------------
describe( 'What the served modes offer', function ()
{

	let root = null;
	let file = null;

	before( function ()
	{
		root = LIB_FS.mkdtempSync( LIB_PATH.join( LIB_OS.tmpdir(), 'jsonx-served-' ) );
		file = LIB_PATH.join( root, 'empty.jsonx' );
		LIB_FS.writeFileSync( file, '{}' );
	} );

	after( function () { LIB_FS.rmSync( root, { recursive: true, force: true } ); } );


	it( 'serves every command, or says on the command why it does not', function ()
	{
		let served = Held.ServedCommands( Commands.TREE ).map( function ( Command ) { return Command.Command; } );
		let unexplained = [];
		for ( let command of every_command( Commands.TREE ) )
		{
			let marked = command.Nodes.filter( function ( Node ) { return Node.Served === false; } );
			if ( marked.length === 0 )
			{
				LIB_ASSERT.ok( served.includes( command.Command ), command.Command + ' is neither served nor marked' );
				continue;
			}
			LIB_ASSERT.ok( !served.includes( command.Command ), command.Command + ' is marked and served' );
			if ( marked.some( function ( Node ) { return typeof Node.ServedReason !== 'string' || Node.ServedReason === ''; } ) ) { unexplained.push( command.Command ); }
		}
		LIB_ASSERT.deepStrictEqual( unexplained, [] );
		LIB_ASSERT.deepStrictEqual( every_command( Commands.TREE ).filter( function ( Command ) { return !served.includes( Command.Command ); } ).map( function ( Command ) { return Command.Command; } ).sort(),
			[ '__complete', 'completion', 'debug', 'mcp', 'serve' ] );
	} );

	it( 'routes, lists as tools, and tables the same commands', async function ()
	{
		let io = Parser.DefaultIo();
		io.Env = {};
		io.Cwd = root;
		let held = Held.NewHeld( { Tree: Commands.TREE, File: file, Io: io } );
		let server = await Api.Listen( Api.NewApi( held, {} ), '127.0.0.1', 0 );
		try
		{
			let table = Held.ServedCommands( Commands.TREE ).map( function ( Command ) { return Command.Path; } );

			let base = 'http://127.0.0.1:' + server.address().port;
			let listed = await ( await fetch( base + '/' ) ).json();
			let routes = listed.Commands.map( function ( Command ) { return Command.Route.slice( 1 ).split( '/' ); } );

			// ***A listed route is a route***: each answers, where a missing one would be 404.
			for ( let command of listed.Commands )
			{
				let answered = await fetch( base + command.Route, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{"help":true}' } );
				LIB_ASSERT.strictEqual( answered.status, 200, command.Route );
				await answered.text();
			}

			let mcp = Protocol.NewMcp( held );
			let tools = ( await mcp.Handle( { jsonrpc: '2.0', id: 1, method: 'tools/list' } ) ).result.tools.map( function ( Tool ) { return Tool.name; } );

			LIB_ASSERT.deepStrictEqual( routes, table );
			LIB_ASSERT.deepStrictEqual( tools, table.map( Protocol.ToolName ) );

			// A tool's arguments and a route's body are one declaration: the same names.
			for ( let command of Held.ServedCommands( Commands.TREE ) )
			{
				let route = listed.Commands.find( function ( Entry ) { return Entry.Command === command.Command; } );
				let tool = mcp.Tools.find( function ( Entry ) { return Entry.name === Protocol.ToolName( command.Path ); } );
				let body = route.Positionals.map( function ( Positional ) { return Positional.Name; } ).concat( Object.keys( route.Options ) ).sort();
				LIB_ASSERT.deepStrictEqual( Object.keys( tool.inputSchema.properties ).sort(), body, command.Command );
			}
		}
		finally
		{
			await Api.Close( server );
			await held.Release();
		}
	} );

} );
