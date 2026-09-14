'use strict';

/*
	jsonx tui (cut 4, decision 2): starting a file's process or attaching to one, with a screen which
	quits at once, so what is asserted is where the process came from and where it went.
*/

const LIB_ASSERT = require( 'assert' );
const LIB_FS = require( 'fs' );
const LIB_NET = require( 'net' );
const LIB_OS = require( 'os' );
const LIB_PATH = require( 'path' );
const { describe, it, before, after } = require( 'node:test' );

const Api = require( '../modes/api/Api.js' );
const Envelope = require( '../src/Envelope.js' );
const Held = require( '../src/Session/Held.js' );
const Parser = require( '../src/CommandLine/Parser.js' );
const Commands = require( '../commands/jsonx.js' );
const TuiCommand = require( '../commands/tui.js' );
const jsonx_cli = require( '../src/jsonx-cli.js' );
const Spec = require( './fixtures/Spec.js' );


// The tree with `tui` in it, as step 6 will register it.
const TREE = Object.assign( {}, Commands.TREE, { Commands: Commands.TREE.Commands.concat( [ TuiCommand ] ) } );


//---------------------------------------------------------------------
function write( Directory, Name, Document )
{
	let path = LIB_PATH.join( Directory, Name );
	LIB_FS.writeFileSync( path, typeof Document === 'string' ? Document : JSON.stringify( Document, null, '\t' ) );
	return path;
}

// Runs jsonx tui's handler with a screen of our own. Answers { Code, Log, Seen }.
async function tui( Argv, Root, Screen )
{
	let io = Parser.DefaultIo();
	io.Env = Object.assign( {}, process.env );
	delete io.Env.JSONX_FILE;
	delete io.Env.JSONX_TOKEN;
	io.Cwd = Root;
	let out = Envelope.NewOut();
	let parsed = Parser.ParseArgs( TREE, [ 'tui' ].concat( Argv ), io );
	let seen = {};
	let screen = Screen || { Run: async function ( Model ) { seen.State = JSON.parse( JSON.stringify( Model.State ) ); return 0; } };
	let context = { Tree: TREE, Io: io, Parser: Parser, Out: out, Screen: screen, SettingsPath: LIB_PATH.join( Root, 'tui-settings.json' ) };
	let code = await TuiCommand.Handler( parsed, context );
	return { Code: code, Log: out.Envelope( code ).Log.join( '\n' ), Seen: seen };
}

async function nothing_listens( Url )
{
	return await new Promise( function ( Resolve )
	{
		let socket = new WebSocket( Url );
		socket.onopen = function () { socket.close(); Resolve( false ); };
		socket.onerror = function () { Resolve( true ); };
	} );
}


//---------------------------------------------------------------------
describe( 'jsonx tui', function ()
{

	let root = null;
	let observatory = null;

	before( function ()
	{
		root = LIB_FS.mkdtempSync( LIB_PATH.join( LIB_OS.tmpdir(), 'jsonx-tui-' ) );
		observatory = write( root, 'observatory.jsonx', Spec.AppendixB() );
	} );

	after( function () { LIB_FS.rmSync( root, { recursive: true, force: true } ); } );


	it( 'starts a jsonx process on the file, works through it, and leaves nothing behind on the way out', { timeout: 30000 }, async function ()
	{
		let url = null;
		let ran = await tui( [ '--file', observatory ], root, {
			Run: async function ( Model )
			{
				url = Model.State.Url;
				LIB_ASSERT.strictEqual( Model.State.File, observatory );
				LIB_ASSERT.ok( Model.State.Inventory.some( function ( Item ) { return Item.Name === 'Prepare the season'; } ) );
				Model.SetInput( 'run "Prepare the season"' );
				let answer = await Model.Submit();
				LIB_ASSERT.deepStrictEqual( answer.Result, [ { Booking: 'b-1', Observer: 'R. Okafor', Dome: 'B' } ] );
				LIB_ASSERT.strictEqual( await nothing_listens( url ), false, 'the process serves while the TUI runs' );
				return 0;
			},
		} );
		LIB_ASSERT.strictEqual( ran.Code, 0, ran.Log );
		LIB_ASSERT.match( url, /^ws:\/\/127\.0\.0\.1:\d+\/ws$/ );
		LIB_ASSERT.strictEqual( await nothing_listens( url ), true, 'the started process stopped' );
	} );

	it( 'stops the process it started even when the screen fails', { timeout: 30000 }, async function ()
	{
		let url = null;
		await LIB_ASSERT.rejects( tui( [ '--file', observatory ], root, {
			Run: async function ( Model ) { url = Model.State.Url; throw new Error( 'the screen broke' ); },
		} ), /the screen broke/ );
		LIB_ASSERT.strictEqual( await nothing_listens( url ), true, 'the started process stopped' );
	} );

	it( 'stops the process it started cleanly: its standard input ends, and it releases before exiting 0', { timeout: 30000 }, async function ()
	{
		let Launch = require( '../modes/tui/Launch.js' );
		let launched = await Launch.Start( { File: observatory, Cwd: root } );
		let started = Date.now();
		let outcome = await launched.Stop();
		// ***Not a kill***: Stop falls back to one only after 5 s, and a killed process flushes nothing.
		LIB_ASSERT.deepStrictEqual( outcome, { Code: 0, Signal: null }, launched.Stderr() );
		LIB_ASSERT.ok( Date.now() - started < 4000, 'stopped in ' + ( Date.now() - started ) + ' ms' );
		LIB_ASSERT.ok( launched.Stderr().endsWith( 'Stopped.\n' ), launched.Stderr() );
		LIB_ASSERT.strictEqual( await nothing_listens( launched.Ready.Ws ), true );
	} );

	it( 'leaves nothing behind when the program which started the process dies without stopping it', { timeout: 30000 }, async function ()
	{
		// A separate Node process starts the child, prints where it is, and exits at once: no Stop.
		// ***On Windows this holds with or without --attached*** (measured 2026-09-14): the child dies
		// with its parent, silently, before it would read the end of its input. --attached is what
		// makes the stop above clean; this asserts only that nothing is left.
		let launch = LIB_PATH.resolve( __dirname, '..', 'modes', 'tui', 'Launch.js' );
		let script = 'require(' + JSON.stringify( launch ) + ').Start({File:' + JSON.stringify( observatory ) + '}).then(function(L){process.stdout.write(L.Ready.Ws+"\\n");process.exit(0);},function(E){process.stdout.write("FAILED "+E.message+"\\n");process.exit(1);});';
		let parent = require( 'child_process' ).spawnSync( process.execPath, [ '-e', script ], { cwd: root, encoding: 'utf8', timeout: 20000 } );
		let url = String( parent.stdout ).trim();
		LIB_ASSERT.match( url, /^ws:\/\/127\.0\.0\.1:\d+\/ws$/, parent.stdout + parent.stderr );

		// The child sees its standard input end, and stops.
		let gone = false;
		for ( let waited = 0; waited < 10000 && !gone; waited += 250 )
		{
			gone = await nothing_listens( url );
			if ( !gone ) { await new Promise( function ( Resolve ) { setTimeout( Resolve, 250 ); } ); }
		}
		LIB_ASSERT.strictEqual( gone, true, 'the orphaned process stopped' );
	} );

	it( 'attaches to a process already serving, and leaves it serving', { timeout: 30000 }, async function ()
	{
		let io = Parser.DefaultIo();
		io.Env = {};
		io.Cwd = root;
		let held = Held.NewHeld( { Tree: Commands.TREE, File: observatory, Io: io } );
		let server = await Api.Listen( Api.NewApi( held, { Host: '127.0.0.1', Version: jsonx_cli.Version } ), '127.0.0.1', 0 );
		let url = 'ws://127.0.0.1:' + server.address().port + '/ws';
		try
		{
			let ran = await tui( [ '--url', url ], root );
			LIB_ASSERT.strictEqual( ran.Code, 0, ran.Log );
			LIB_ASSERT.strictEqual( ran.Seen.State.File, observatory );
			LIB_ASSERT.strictEqual( await nothing_listens( url ), false, 'the process it attached to still serves' );
		}
		finally { await Api.Close( server ); await held.Release(); }
	} );

	it( 'refuses a process of another version, and a file which is not a jsonx file, with their exit codes', { timeout: 30000 }, async function ()
	{
		let io = Parser.DefaultIo();
		io.Env = {};
		io.Cwd = root;
		let held = Held.NewHeld( { Tree: Commands.TREE, File: observatory, Io: io } );
		let server = await Api.Listen( Api.NewApi( held, { Host: '127.0.0.1', Version: '0.0.0-other' } ), '127.0.0.1', 0 );
		try
		{
			let other = await tui( [ '--url', 'ws://127.0.0.1:' + server.address().port + '/ws' ], root );
			LIB_ASSERT.strictEqual( other.Code, 2 );
			LIB_ASSERT.match( other.Log, /version 0\.0\.0-other/ );
		}
		finally { await Api.Close( server ); await held.Release(); }

		let not_jsonx = write( root, 'array.jsonx', '[]' );
		let refused = await tui( [ '--file', not_jsonx ], root );
		LIB_ASSERT.strictEqual( refused.Code, 3 );
		LIB_ASSERT.match( refused.Log, /is not a jsonx file/ );
		LIB_ASSERT.match( refused.Log, /stopped before it was ready \(exit 3\)/ );
	} );

	it( 'exits 1 when nothing is listening at --url, and 2 for options which would do nothing', { timeout: 30000 }, async function ()
	{
		let blocker = LIB_NET.createServer();
		await new Promise( function ( Resolve ) { blocker.listen( 0, '127.0.0.1', Resolve ); } );
		let port = blocker.address().port;
		await new Promise( function ( Resolve ) { blocker.close( Resolve ); } );

		let nothing = await tui( [ '--url', 'ws://127.0.0.1:' + port + '/ws' ], root );
		LIB_ASSERT.strictEqual( nothing.Code, 1 );
		LIB_ASSERT.match( nothing.Log, /Cannot connect/ );

		let cases = [
			[ [ '--url', 'ws://127.0.0.1:1/ws', '--file', observatory ], /\[--file\] has no effect with --url/ ],
			[ [ '--url', 'ws://127.0.0.1:1/ws', '--bind', 'Bookings=jsonstor-memory' ], /\[--bind\] has no effect with --url/ ],
			[ [ '--file', observatory, '--token', 'x' ], /\[--token\] has an effect only with --url/ ],
		];
		for ( let [ argv, pattern ] of cases )
		{
			let refused = await tui( argv, root );
			LIB_ASSERT.strictEqual( refused.Code, 2, argv.join( ' ' ) );
			LIB_ASSERT.match( refused.Log, pattern );
		}
	} );

} );
