'use strict';

const LIB_ASSERT = require( 'assert' );
const { describe, it } = require( 'node:test' );

const Main = require( '../modes/cli/Main.js' );
const Commands = require( '../commands/jsonx.js' );
const Fixture = require( './fixtures/CommandTree.js' );


//---------------------------------------------------------------------
describe( 'The command line mode, in process', function ()
{

	it( 'hands a parse to the handler of the command reached', async function ()
	{
		let calls = [];
		let io = Fixture.MemoryIo();
		let code = await Main.Main( [ 'datasource', 'describe', 'Bookings', '--rows=3' ], io, Fixture.Tree( calls ) );
		LIB_ASSERT.strictEqual( code, 0 );
		LIB_ASSERT.strictEqual( calls.length, 1 );
		LIB_ASSERT.strictEqual( calls[ 0 ].Name, 'datasource describe' );
		LIB_ASSERT.strictEqual( calls[ 0 ].Parsed.Options.rows, 3 );
	} );

	it( 'answers --help for the level reached, on standard output, without running', async function ()
	{
		let calls = [];
		let io = Fixture.MemoryIo();
		let code = await Main.Main( [ 'run', '--help' ], io, Fixture.Tree( calls ) );
		LIB_ASSERT.strictEqual( code, 0 );
		LIB_ASSERT.ok( io.Out.startsWith( 'Usage: jsonx run <name>' ) );
		LIB_ASSERT.strictEqual( calls.length, 0 );
	} );

	it( 'prints a group\'s help to standard error with exit 2 when no command is given', async function ()
	{
		let io = Fixture.MemoryIo();
		let code = await Main.Main( [ 'datasource' ], io, Fixture.Tree() );
		LIB_ASSERT.strictEqual( code, 2 );
		LIB_ASSERT.strictEqual( io.Out, '' );
		LIB_ASSERT.ok( io.Err.startsWith( 'Usage: jsonx datasource <command>' ) );
	} );

	it( 'reports a usage mistake with the command to ask for help on', async function ()
	{
		let io = Fixture.MemoryIo();
		let code = await Main.Main( [ 'datasource', 'describe' ], io, Fixture.Tree() );
		LIB_ASSERT.strictEqual( code, 2 );
		LIB_ASSERT.strictEqual( io.Out, '' );
		LIB_ASSERT.ok( io.Err.includes( 'Argument <name> is required.' ) );
		LIB_ASSERT.ok( io.Err.includes( 'Run jsonx datasource describe --help.' ) );
	} );

	it( 'runs through --input-json', async function ()
	{
		let calls = [];
		let io = Fixture.MemoryIo( { 'call.json': '{ "Command": "run", "name": "Nightly" }' } );
		let code = await Main.Main( [ '--input-json', 'call.json' ], io, Fixture.Tree( calls ) );
		LIB_ASSERT.strictEqual( code, 0 );
		LIB_ASSERT.strictEqual( calls[ 0 ].Parsed.Positionals.name, 'Nightly' );
	} );

	it( 'reads the real tree: help, version, and every global option declared', async function ()
	{
		let io = Fixture.MemoryIo();
		LIB_ASSERT.strictEqual( await Main.Main( [ '--help' ], io ), 0 );
		for ( let name of Object.keys( Commands.GLOBAL_OPTIONS ) )
		{
			LIB_ASSERT.ok( io.Out.includes( '--' + name ), 'help lists --' + name );
		}

		let version_io = Fixture.MemoryIo();
		LIB_ASSERT.strictEqual( await Main.Main( [ '--version' ], version_io ), 0 );
		LIB_ASSERT.strictEqual( version_io.Out, require( '../package.json' ).version + '\n' );
	} );

} );
