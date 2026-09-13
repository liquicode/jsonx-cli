'use strict';

const LIB_ASSERT = require( 'assert' );
const { describe, it } = require( 'node:test' );

const Parser = require( '../src/CommandLine/Parser.js' );
const InputJson = require( '../src/CommandLine/InputJson.js' );
const Fixture = require( './fixtures/CommandTree.js' );


function invoke( Argv, Files, Stdin )
{
	return InputJson.ParseInvocation( Fixture.Tree(), Argv, Fixture.MemoryIo( Files, Stdin ) );
}

function refuses( Argv, Files, Pattern )
{
	LIB_ASSERT.throws(
		function () { invoke( Argv, Files ); },
		function ( Error ) { return ( Error instanceof Parser.UsageError ) && Pattern.test( Error.message ); } );
}


//---------------------------------------------------------------------
describe( '--input-json', function ()
{

	it( 'gives the same parse as the typed command line', function ()
	{
		let typed = invoke( [ 'datasource', 'describe', 'Bookings', '--rows', '5', '-q', '--bind', 'A=x' ] );
		let document = {
			Command: 'datasource describe', name: 'Bookings', rows: 5, quiet: true, bind: [ 'A=x' ],
		};
		let from_file = invoke( [ '--input-json', 'call.json' ], { 'call.json': JSON.stringify( document ) } );

		LIB_ASSERT.deepStrictEqual( from_file.Path, typed.Path );
		LIB_ASSERT.deepStrictEqual( from_file.Positionals, typed.Positionals );
		LIB_ASSERT.deepStrictEqual( from_file.Options, typed.Options );
	} );

	it( 'accepts Command as an array, --input-json=path, and standard input', function ()
	{
		let files = { 'c.json': '{ "Command": [ "run" ], "name": "x" }' };
		LIB_ASSERT.deepStrictEqual( invoke( [ '--input-json=c.json' ], files ).Path, [ 'run' ] );
		LIB_ASSERT.strictEqual( invoke( [ '--input-json', '-' ], {}, '{ "Command": "run", "name": "y" }' ).Positionals.name, 'y' );
	} );

	it( 'takes a json option\'s value as the JSON itself', function ()
	{
		let parsed = invoke( [ '--input-json', '-' ], {}, '{ "Command": "run", "name": "x", "input": { "Seed": 7 } }' );
		LIB_ASSERT.deepStrictEqual( parsed.Options.input, { Seed: 7 } );
	} );

	it( 'falls through to the typed parser when it is not used', function ()
	{
		LIB_ASSERT.deepStrictEqual( invoke( [ 'run', 'x' ] ).Path, [ 'run' ] );
	} );

	it( 'refuses other arguments beside it', function ()
	{
		refuses( [ '--input-json', 'c.json', '--quiet' ], { 'c.json': '{}' }, /must be the only argument/ );
	} );

	it( 'refuses an unknown key, a wrong type, and a missing required argument', function ()
	{
		refuses( [ '--input-json', 'c.json' ], { 'c.json': '{ "Command": "run", "name": "x", "nmae": 1 }' }, /Unknown key \[nmae\]/ );
		refuses( [ '--input-json', 'c.json' ], { 'c.json': '{ "Command": "run", "name": "x", "max-steps": "5" }' }, /must be a integer/ );
		refuses( [ '--input-json', 'c.json' ], { 'c.json': '{ "Command": "run" }' }, /Argument <name> is required/ );
		refuses( [ '--input-json', 'c.json' ], { 'c.json': '{ "Command": "run", "name": "x", "bind": "A=x" }' }, /must be an array/ );
	} );

	it( 'refuses a document which is not an object, and an unreadable one', function ()
	{
		refuses( [ '--input-json', 'c.json' ], { 'c.json': '[ "run" ]' }, /must be a JSON object/ );
		refuses( [ '--input-json', 'c.json' ], { 'c.json': '{ nope' }, /did not read valid JSON/ );
		refuses( [ '--input-json', 'gone.json' ], {}, /could not read \[gone\.json\]/ );
	} );

} );
