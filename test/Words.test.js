'use strict';

const LIB_ASSERT = require( 'assert' );
const { describe, it } = require( 'node:test' );

const Words = require( '../src/CommandLine/Words.js' );
const Parser = require( '../src/CommandLine/Parser.js' );
const InputJson = require( '../src/CommandLine/InputJson.js' );
const Complete = require( '../src/CommandLine/Complete.js' );
const Commands = require( '../commands/jsonx.js' );
const Spec = require( './fixtures/Spec.js' );


//---------------------------------------------------------------------
describe( 'A typed command line', function ()
{

	it( 'splits into words by one rule: whitespace, and double or single quotes', function ()
	{
		let cases = [
			[ 'run "Prepare the season"', [ 'run', 'Prepare the season' ] ],
			[ '  data   count  Bookings ', [ 'data', 'count', 'Bookings' ] ],
			[ 'data find Bookings --criteria \'{"Status":"confirmed"}\'', [ 'data', 'find', 'Bookings', '--criteria', '{"Status":"confirmed"}' ] ],
			[ 'data find Bookings --criteria "{\\"Status\\":\\"confirmed\\"}"', [ 'data', 'find', 'Bookings', '--criteria', '{"Status":"confirmed"}' ] ],
			[ 'new file --name a"b c"d', [ 'new', 'file', '--name', 'ab cd' ] ],
			[ 'validate --file C:\\data\\x.jsonx', [ 'validate', '--file', 'C:\\data\\x.jsonx' ] ],
			[ 'x "" \'\'', [ 'x', '', '' ] ],
			// A word beginning with { or [ is JSON, to its matching bracket, quotes and spaces kept.
			[ 'data find Bookings --criteria {"Status": "confirmed", "Note": "a } in a string"} --max 2', [ 'data', 'find', 'Bookings', '--criteria', '{"Status": "confirmed", "Note": "a } in a string"}', '--max', '2' ] ],
			[ 'engine filter --documents [{"A":[1,2]}, {"A":"say \\"hi\\""}] --criteria {}', [ 'engine', 'filter', '--documents', '[{"A":[1,2]}, {"A":"say \\"hi\\""}]', '--criteria', '{}' ] ],
			[ 'new file --name x{y}', [ 'new', 'file', '--name', 'x{y}' ] ],
			[ '"a\\\\b" "c\\d"', [ 'a\\b', 'c\\d' ] ],
			[ '', [] ],
		];
		for ( let [ text, words ] of cases )
		{
			LIB_ASSERT.deepStrictEqual( Words.SplitWords( text ).Words, words, text );
		}
	} );

	it( 'says what is being typed: an open quote, and the current word', function ()
	{
		LIB_ASSERT.deepStrictEqual( Words.SplitWords( 'run "Prepare the' ), { Words: [ 'run', 'Prepare the' ], Open: '"', Current: 'Prepare the' } );
		LIB_ASSERT.deepStrictEqual( Words.SplitWords( 'run ' ), { Words: [ 'run' ], Open: null, Current: '' } );
		LIB_ASSERT.deepStrictEqual( Words.SplitWords( 'ru' ), { Words: [ 'ru' ], Open: null, Current: 'ru' } );
		LIB_ASSERT.deepStrictEqual( Words.SplitWords( '' ), { Words: [], Open: null, Current: '' } );
		LIB_ASSERT.deepStrictEqual( Words.SplitWords( 'data find B --criteria {"Hours": { "$g' ), { Words: [ 'data', 'find', 'B', '--criteria', '{"Hours": { "$g' ], Open: '{', Current: '{"Hours": { "$g' } );
	} );

	it( 'quotes a word so it splits back to itself', function ()
	{
		let words = [ 'plain', 'two words', '', 'say "hi"', 'it\'s', 'C:\\dir\\', 'a\\"b', 'back\\\\slash', 'tab\there', '{not json', '[x' ];
		for ( let word of words )
		{
			let quoted = Words.QuoteWord( word );
			LIB_ASSERT.deepStrictEqual( Words.SplitWords( 'x ' + quoted ).Words, [ 'x', word ], quoted );
		}
		LIB_ASSERT.strictEqual( Words.QuoteWord( 'plain' ), 'plain' );
	} );

	it( 'turns a parse back into the input document which parses to it', function ()
	{
		let io = Parser.DefaultIo();
		let lines = [
			[ 'run', 'Prepare the season', '--verbose' ],
			[ 'data', 'find', 'Bookings', '--criteria', '{"Hours":{"$gt":6}}', '--max', '2' ],
			[ 'datasource', 'update', 'Bookings', '--criteria', '{}', '--update', '{"$set":{"A":1}}', '--yes', '--changes' ],
			[ 'engine', 'schema', 'infer', '--documents', '[{"A":1}]' ],
			[ 'run', '--help' ],
			[ 'validate', '--strict' ],
		];
		for ( let argv of lines )
		{
			let parsed = InputJson.ParseInvocation( Commands.TREE, argv, io );
			let document = InputJson.ToDocument( parsed );
			LIB_ASSERT.ok( Array.isArray( document.Command ) );
			let again = InputJson.ParseDocument( Commands.TREE, JSON.parse( JSON.stringify( document ) ) );
			let expected = Object.assign( {}, parsed );
			delete expected.StdinRead;
			LIB_ASSERT.deepStrictEqual( again, expected, argv.join( ' ' ) );
		}
	} );

	it( 'completes names from a document given in memory, reading no file', function ()
	{
		let io = { Cwd: 'Z:\\nowhere', Env: {}, ReadFile: function () { throw new Error( 'no file may be read' ); } };
		let document = Spec.AppendixB();
		let names = Complete.Candidates( Commands.TREE, [ 'run', 'Pre' ], io, { Document: document } );
		LIB_ASSERT.deepStrictEqual( names, [ 'Prepare the season' ] );
		let sources = Complete.Candidates( Commands.TREE, [ 'data', 'count', '' ], io, { Document: document } );
		LIB_ASSERT.ok( sources.includes( 'Bookings' ) && sources.includes( 'Telescopes' ), JSON.stringify( sources ) );
		LIB_ASSERT.deepStrictEqual( Complete.Candidates( Commands.TREE, [ 'run', 'Pre' ], io ), [] );
	} );

} );
