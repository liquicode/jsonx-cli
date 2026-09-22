'use strict';

/*
	The capability sentence (src/Session/Capabilities.js): every served command says what it does, the
	sentence is made from the commands a profile serves, and MCP says it only when asked.

	***Opt-in*** *(user, 2026-09-21)*: without `Capabilities` the instructions carry the profile's own
	Describe, as the model jsonx-llm trained on them saw it; with it, the sentence stands in its place.
*/

const LIB_ASSERT = require( 'assert' );
const LIB_FS = require( 'fs' );
const LIB_OS = require( 'os' );
const LIB_PATH = require( 'path' );
const { describe, it, before, after } = require( 'node:test' );

const Capabilities = require( '../src/Session/Capabilities.js' );
const Held = require( '../src/Session/Held.js' );
const Profiles = require( '../src/Session/Profiles.js' );
const Parser = require( '../src/CommandLine/Parser.js' );
const Protocol = require( '../modes/mcp/Protocol.js' );
const Commands = require( '../commands/jsonx.js' );
const Spec = require( './fixtures/Spec.js' );


function served_under( Name )
{
	let all = Held.ServedCommands( Commands.TREE );
	return Profiles.Apply( all, Profiles.Check( Profiles.Load( Name, {} ), all ) );
}


describe( 'the capability sentence', function ()
{
	let root = null;
	let file = null;

	before( function ()
	{
		root = LIB_FS.mkdtempSync( LIB_PATH.join( LIB_OS.tmpdir(), 'jsonx-capabilities-' ) );
		file = LIB_PATH.join( root, 'observatory.jsonx' );
		LIB_FS.writeFileSync( file, JSON.stringify( Spec.AppendixB(), null, '\t' ) );
	} );

	after( function () { LIB_FS.rmSync( root, { recursive: true, force: true } ); } );

	it( 'has every served command say what it does, in the sentence\'s own words', function ()
	{
		let words = Object.keys( Capabilities.DOES );
		let untagged = Held.ServedCommands( Commands.TREE ).filter( function ( C ) { return words.indexOf( C.Does ) < 0; } );
		LIB_ASSERT.deepStrictEqual( untagged.map( function ( C ) { return C.Command + ': ' + C.Does; } ), [] );
	} );

	it( 'says what each built-in profile does, and what it does not', function ()
	{
		LIB_ASSERT.strictEqual( Capabilities.Sentence( served_under( 'translate' ) ), 'This session reads data, lists the file\'s entries and checks drafts. It does not run objects, write data or change the file.' );
		LIB_ASSERT.strictEqual( Capabilities.Sentence( served_under( 'run' ) ), 'This session reads data, lists the file\'s entries, checks drafts and runs objects. It does not write data or change the file.' );
		LIB_ASSERT.strictEqual( Capabilities.Sentence( served_under( 'design' ) ), 'This session reads data, reads the adapters, lists the file\'s entries, checks drafts, runs objects and changes the file. It does not write data.' );
		LIB_ASSERT.strictEqual( Capabilities.Sentence( served_under( 'full' ) ), 'This session reads data, reads the adapters, lists the file\'s entries, checks drafts, computes on documents, runs objects, writes data and changes the file.' );
	} );

	it( 'follows a profile which takes commands away', function ()
	{
		let without = served_under( 'translate' ).filter( function ( C ) { return [ 'validate', 'plan', 'explain' ].indexOf( C.Command ) < 0; } );
		LIB_ASSERT.strictEqual( Capabilities.Sentence( without ), 'This session reads data and lists the file\'s entries. It does not run objects, write data or change the file.' );
	} );

	it( 'is said by MCP in place of the profile\'s Describe only when the session is held with Capabilities', async function ()
	{
		let io = Parser.DefaultIo();
		io.Env = {};
		io.Cwd = root;
		let initialize = { jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-11-25', capabilities: {}, clientInfo: { name: 'test', version: '0' } } };

		let plain = Held.NewHeld( { Tree: Commands.TREE, File: file, Io: io, Profile: 'translate' } );
		try
		{
			let said = ( await Protocol.NewMcp( plain ).Handle( initialize ) ).result.instructions;
			LIB_ASSERT.ok( said.indexOf( 'Build objects from what the data says; run nothing.' ) >= 0, said );
			LIB_ASSERT.ok( said.indexOf( 'This session' ) < 0, said );
		}
		finally { await plain.Release(); }

		let asked = Held.NewHeld( { Tree: Commands.TREE, File: file, Io: io, Profile: 'translate', Capabilities: true } );
		try
		{
			let said = ( await Protocol.NewMcp( asked ).Handle( initialize ) ).result.instructions;
			LIB_ASSERT.ok( said.indexOf( ' This session reads data, lists the file\'s entries and checks drafts. It does not run objects, write data or change the file. Build the object; do not run it.' ) >= 0, said );
			LIB_ASSERT.ok( said.indexOf( 'Build objects from what the data says' ) < 0, said );
		}
		finally { await asked.Release(); }
	} );
} );
