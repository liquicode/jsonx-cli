'use strict';

const LIB_ASSERT = require( 'assert' );
const { describe, it } = require( 'node:test' );

const Parser = require( '../src/CommandLine/Parser.js' );
const Fixture = require( './fixtures/CommandTree.js' );


function parse( Argv, Files, Stdin )
{
	return Parser.ParseArgs( Fixture.Tree(), Argv, Fixture.MemoryIo( Files, Stdin ) );
}

function refuses( Argv, Pattern )
{
	LIB_ASSERT.throws(
		function () { parse( Argv ); },
		function ( Error ) { return ( Error instanceof Parser.UsageError ) && Pattern.test( Error.message ); } );
}


//---------------------------------------------------------------------
describe( 'Parser: commands and positionals', function ()
{

	it( 'descends into a command and assigns its positional', function ()
	{
		let parsed = parse( [ 'run', 'Prepare the season' ] );
		LIB_ASSERT.deepStrictEqual( parsed.Path, [ 'run' ] );
		LIB_ASSERT.strictEqual( parsed.Positionals.name, 'Prepare the season' );
	} );

	it( 'descends through a group', function ()
	{
		let parsed = parse( [ 'datasource', 'rename', 'Bookings', 'Reservations' ] );
		LIB_ASSERT.deepStrictEqual( parsed.Path, [ 'datasource', 'rename' ] );
		LIB_ASSERT.strictEqual( parsed.Positionals.name, 'Bookings' );
		LIB_ASSERT.strictEqual( parsed.Positionals[ 'new-name' ], 'Reservations' );
	} );

	it( 'keeps a positional which spells a command name as a positional', function ()
	{
		let parsed = parse( [ 'datasource', 'rename', 'describe', 'run' ] );
		LIB_ASSERT.strictEqual( parsed.Positionals.name, 'describe' );
		LIB_ASSERT.strictEqual( parsed.Positionals[ 'new-name' ], 'run' );
	} );

	it( 'collects a repeatable positional', function ()
	{
		let parsed = parse( [ 'touch', 'a', 'b', 'c', '--mode', 'x' ] );
		LIB_ASSERT.deepStrictEqual( parsed.Positionals.names, [ 'a', 'b', 'c' ] );
	} );

	it( 'treats everything after -- as positional', function ()
	{
		let parsed = parse( [ 'run', '--', '--dry' ] );
		LIB_ASSERT.strictEqual( parsed.Positionals.name, '--dry' );
		LIB_ASSERT.strictEqual( parsed.Options.dry, false );
	} );

	it( 'refuses an unknown command', function () { refuses( [ 'nope' ], /Unknown command \[nope\]/ ); } );
	it( 'refuses an unknown sub-command', function () { refuses( [ 'datasource', 'nope' ], /Unknown command \[datasource nope\]/ ); } );
	it( 'refuses a missing required positional', function () { refuses( [ 'run' ], /Argument <name> is required/ ); } );
	it( 'refuses an extra positional', function () { refuses( [ 'run', 'a', 'b' ], /Unexpected argument \[b\]/ ); } );

} );


//---------------------------------------------------------------------
describe( 'Parser: options', function ()
{

	it( 'reads --key value and --key=value', function ()
	{
		LIB_ASSERT.strictEqual( parse( [ 'run', 'x', '--output', 'jsonl' ] ).Options.output, 'jsonl' );
		LIB_ASSERT.strictEqual( parse( [ 'run', 'x', '--output=jsonl' ] ).Options.output, 'jsonl' );
	} );

	it( 'reads a one letter alias', function ()
	{
		let parsed = parse( [ '-o', 'jsonl', 'run', 'x', '-q' ] );
		LIB_ASSERT.strictEqual( parsed.Options.output, 'jsonl' );
		LIB_ASSERT.strictEqual( parsed.Options.quiet, true );
	} );

	it( 'accepts global options before and after the command', function ()
	{
		LIB_ASSERT.strictEqual( parse( [ '--quiet', 'run', 'x' ] ).Options.quiet, true );
		LIB_ASSERT.strictEqual( parse( [ 'run', 'x', '--quiet' ] ).Options.quiet, true );
	} );

	it( 'applies defaults and false for an absent boolean', function ()
	{
		let parsed = parse( [ 'run', 'x' ] );
		LIB_ASSERT.strictEqual( parsed.Options.output, 'json' );
		LIB_ASSERT.strictEqual( parsed.Options[ 'max-steps' ], 1000 );
		LIB_ASSERT.strictEqual( parsed.Options.dry, false );
		LIB_ASSERT.deepStrictEqual( parsed.Options.bind, [] );
		LIB_ASSERT.strictEqual( typeof parsed.Options.ratio, 'undefined' );
	} );

	it( 'reads a boolean as --x, --x=false and --no-x', function ()
	{
		LIB_ASSERT.strictEqual( parse( [ 'run', 'x', '--dry' ] ).Options.dry, true );
		LIB_ASSERT.strictEqual( parse( [ 'run', 'x', '--dry=false' ] ).Options.dry, false );
		LIB_ASSERT.strictEqual( parse( [ 'run', 'x', '--no-dry' ] ).Options.dry, false );
	} );

	it( 'never lets a boolean swallow the next token', function ()
	{
		let parsed = parse( [ 'run', '--dry', 'x' ] );
		LIB_ASSERT.strictEqual( parsed.Options.dry, true );
		LIB_ASSERT.strictEqual( parsed.Positionals.name, 'x' );
	} );

	it( 'collects a repeatable option', function ()
	{
		let parsed = parse( [ 'run', 'x', '--bind', 'A=jsonstor-memory', '--bind=B=jsonstor-memory' ] );
		LIB_ASSERT.deepStrictEqual( parsed.Options.bind, [ 'A=jsonstor-memory', 'B=jsonstor-memory' ] );
	} );

	it( 'coerces integers and numbers, including a negative value', function ()
	{
		let parsed = parse( [ 'run', 'x', '--max-steps', '50', '--ratio', '-2.5' ] );
		LIB_ASSERT.strictEqual( parsed.Options[ 'max-steps' ], 50 );
		LIB_ASSERT.strictEqual( parsed.Options.ratio, -2.5 );
	} );

	it( 'inherits a group option into its commands', function ()
	{
		LIB_ASSERT.strictEqual( parse( [ 'datasource', 'describe', 'B', '--strict' ] ).Options.strict, true );
	} );

	it( 'keeps an Inherit: false option on its own node', function ()
	{
		LIB_ASSERT.strictEqual( parse( [ '--version' ] ).Options.version, true );
		refuses( [ 'run', 'x', '--version' ], /Unknown option \[--version\]/ );
	} );

	it( 'refuses an unknown option', function () { refuses( [ 'run', 'x', '--nonsense' ], /Unknown option \[--nonsense\]/ ); } );
	it( 'refuses --no- on a value option', function () { refuses( [ 'run', 'x', '--no-output' ], /Unknown option \[--no-output\]/ ); } );
	it( 'refuses a value on --no-x', function () { refuses( [ 'run', 'x', '--no-dry=true' ], /takes no value/ ); } );
	it( 'refuses a missing value', function () { refuses( [ 'run', 'x', '--output' ], /requires a value/ ); } );
	it( 'refuses an option as the value of another', function () { refuses( [ 'run', 'x', '--output', '--quiet' ], /requires a value/ ); } );
	it( 'refuses a value outside the choices', function () { refuses( [ 'run', 'x', '--output', 'table' ], /must be one of json, jsonl/ ); } );
	it( 'refuses a non-integer integer', function () { refuses( [ 'run', 'x', '--max-steps', '2.5' ], /whole number/ ); } );
	it( 'refuses a non-number number', function () { refuses( [ 'run', 'x', '--ratio', 'abc' ], /takes a number/ ); } );
	it( 'refuses combined short options', function () { refuses( [ 'run', 'x', '-qh' ], /one letter/ ); } );
	it( 'refuses a non-repeatable option given twice', function () { refuses( [ 'run', 'x', '--output', 'json', '--output', 'jsonl' ], /more than once/ ); } );
	it( 'refuses a missing required option', function () { refuses( [ 'touch', 'a' ], /Option \[--mode\] is required/ ); } );

	it( 'says where an option belongs when it comes before its command', function ()
	{
		refuses( [ 'datasource', '--rows', '5', 'describe', 'B' ], /belongs to \[datasource describe\]/ );
	} );

} );


//---------------------------------------------------------------------
describe( 'Parser: json values', function ()
{

	it( 'reads inline JSON', function ()
	{
		LIB_ASSERT.deepStrictEqual( parse( [ 'run', 'x', '--input', '{"a":1}' ] ).Options.input, { a: 1 } );
	} );

	it( 'reads @path through the Io, BOM and all', function ()
	{
		let parsed = parse( [ 'run', 'x', '--input', '@in.json' ], { 'in.json': '﻿{"b":2}' } );
		LIB_ASSERT.deepStrictEqual( parsed.Options.input, { b: 2 } );
	} );

	it( 'reads - from standard input', function ()
	{
		LIB_ASSERT.deepStrictEqual( parse( [ 'run', 'x', '--input', '-' ], {}, '[1,2]' ).Options.input, [ 1, 2 ] );
	} );

	it( 'refuses invalid JSON and a missing file', function ()
	{
		refuses( [ 'run', 'x', '--input', '{nope' ], /is not valid JSON \(inline\)/ );
		refuses( [ 'run', 'x', '--input', '@missing.json' ], /could not read \[missing\.json\]/ );
	} );

} );


//---------------------------------------------------------------------
describe( 'Parser: help and Value', function ()
{

	it( 'returns a help parse without requiring arguments', function ()
	{
		let parsed = parse( [ 'run', '--help' ] );
		LIB_ASSERT.strictEqual( parsed.Help, true );
		LIB_ASSERT.deepStrictEqual( parsed.Path, [ 'run' ] );
	} );

	it( 'reads a declared name and throws on an undeclared one', function ()
	{
		let tree = Fixture.Tree();
		let parsed = Parser.ParseArgs( tree, [ 'datasource', 'describe', 'Bookings' ], Fixture.MemoryIo() );
		LIB_ASSERT.strictEqual( Parser.Value( tree, parsed, 'name' ), 'Bookings' );
		LIB_ASSERT.strictEqual( Parser.Value( tree, parsed, 'rows' ), 10 );
		LIB_ASSERT.strictEqual( Parser.Value( tree, parsed, 'output' ), 'json' );
		LIB_ASSERT.throws( function () { Parser.Value( tree, parsed, 'row' ); }, /\[row\] is not declared/ );
	} );

} );
