'use strict';

const LIB_ASSERT = require( 'assert' );
const { describe, it } = require( 'node:test' );

const Help = require( '../src/CommandLine/Help.js' );
const Fixture = require( './fixtures/CommandTree.js' );


//---------------------------------------------------------------------
describe( 'Help', function ()
{

	it( 'lists the root commands and global options', function ()
	{
		let text = Help.HelpText( Fixture.Tree(), [] );
		LIB_ASSERT.ok( text.startsWith( 'Usage: jsonx <command> [options]' ) );
		LIB_ASSERT.ok( /\n  run\s+Run an object\./.test( text ) );
		LIB_ASSERT.ok( /\n  datasource, data\s+Data sources\./.test( text ) );
		LIB_ASSERT.ok( text.includes( 'Global options:' ) );
		LIB_ASSERT.ok( text.includes( '-o, --output <string>' ) );
		LIB_ASSERT.ok( text.includes( '(json | jsonl, default "json")' ) );
		LIB_ASSERT.ok( text.includes( '--version' ) );
	} );

	it( 'shows a command\'s arguments and own options before the global ones', function ()
	{
		let text = Help.HelpText( Fixture.Tree(), [ 'run' ] );
		LIB_ASSERT.ok( text.startsWith( 'Usage: jsonx run <name> [options]' ) );
		LIB_ASSERT.ok( text.includes( 'Arguments:' ) );
		LIB_ASSERT.ok( text.indexOf( '--max-steps <integer>' ) < text.indexOf( 'Global options:' ) );
		LIB_ASSERT.ok( text.includes( 'JSON, @file, or - for stdin' ) );
		LIB_ASSERT.ok( !text.includes( '--version' ), 'an Inherit: false option does not reach a command' );
	} );

	it( 'shows a group\'s commands and its inherited option', function ()
	{
		let text = Help.HelpText( Fixture.Tree(), [ 'datasource' ] );
		LIB_ASSERT.ok( text.startsWith( 'Usage: jsonx datasource <command> [options]' ) );
		LIB_ASSERT.ok( text.includes( 'describe' ) );
		LIB_ASSERT.ok( text.includes( '--strict' ) );
		LIB_ASSERT.ok( text.includes( 'Run jsonx datasource <command> --help' ) );

		let deeper = Help.HelpText( Fixture.Tree(), [ 'datasource', 'describe' ] );
		LIB_ASSERT.ok( deeper.includes( '--strict' ) );
		LIB_ASSERT.ok( deeper.includes( '--rows <integer>' ) );
	} );

	it( 'lists a command\'s aliases beside it and leaves out a hidden command', function ()
	{
		let text = Help.HelpText( Fixture.Tree(), [] );
		LIB_ASSERT.ok( /\n  datasource, data\s+Data sources\./.test( text ) );
		LIB_ASSERT.ok( !text.includes( '__hidden' ) );
	} );

	it( 'marks optional and repeatable positionals', function ()
	{
		let text = Help.HelpText( Fixture.Tree(), [ 'touch' ] );
		LIB_ASSERT.ok( text.startsWith( 'Usage: jsonx touch [names...] [options]' ) );
		LIB_ASSERT.ok( text.includes( '(required)' ) );
	} );

} );
