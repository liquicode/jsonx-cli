'use strict';

/*
	--check on add and set (user, 2026-09-14, following format --check): the edit validated exactly as
	it would be made, and nothing written - not the file, and not the document a held session holds.
*/

const LIB_ASSERT = require( 'assert' );
const LIB_FS = require( 'fs' );
const LIB_OS = require( 'os' );
const LIB_PATH = require( 'path' );
const { describe, it, before, after } = require( 'node:test' );

const Held = require( '../src/Session/Held.js' );
const Main = require( '../modes/cli/Main.js' );
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

async function cli( File, Argv )
{
	let io = Parser.DefaultIo();
	io.Env = {};
	io.Cwd = LIB_PATH.dirname( File );
	let stdout = '';
	let stderr = '';
	io.Stdout = function ( Text ) { stdout += Text; };
	io.Stderr = function ( Text ) { stderr += Text; };
	let code = await Main.Main( Argv.concat( [ '--file', File ] ), io );
	return { Code: code, Stdout: stdout, Stderr: stderr };
}


//---------------------------------------------------------------------
describe( '--check on add and set', function ()
{

	let root = null;

	before( function () { root = LIB_FS.mkdtempSync( LIB_PATH.join( LIB_OS.tmpdir(), 'jsonx-check-' ) ); } );
	after( function () { LIB_FS.rmSync( root, { recursive: true, force: true } ); } );


	it( 'answers what add and set would answer, and writes nothing', async function ()
	{
		let file = write( root, 'cli.jsonx', Spec.AppendixB() );
		let text = LIB_FS.readFileSync( file, 'utf8' );

		let good = await cli( file, [ 'query', 'add', '--check', '--json', '{"Name":"Every booking","DataSource":"Bookings","Criteria":{}}' ] );
		LIB_ASSERT.strictEqual( good.Code, 0, good.Stderr );
		LIB_ASSERT.deepStrictEqual( JSON.parse( good.Stdout ), { Kind: 'Query', Name: 'Every booking', DataSource: 'Bookings', Criteria: {} } );
		LIB_ASSERT.match( good.Stderr, /Checked: this add adds no error\. Nothing was written\./ );

		let bad = await cli( file, [ 'query', 'add', '--check', '--json', '{"Name":"Read nowhere","DataSource":"Nowhere","Criteria":{}}' ] );
		LIB_ASSERT.strictEqual( bad.Code, 3 );
		LIB_ASSERT.match( bad.Stderr, /No data source is named \[Nowhere\]/ );
		LIB_ASSERT.match( bad.Stderr, /would add 1 error\. Nothing was written\./ );
		LIB_ASSERT.strictEqual( bad.Stdout, '' );

		let set = await cli( file, [ 'datasource', 'set', 'Bookings', '--check', '--json', '{"AdapterName":"no-such-adapter"}' ] );
		LIB_ASSERT.strictEqual( set.Code, 3, set.Stderr );

		// The same edits made for real answer the same.
		let real_bad = await cli( file, [ 'query', 'add', '--json', '{"Name":"Read nowhere","DataSource":"Nowhere","Criteria":{}}' ] );
		LIB_ASSERT.strictEqual( real_bad.Code, 3 );

		LIB_ASSERT.strictEqual( LIB_FS.readFileSync( file, 'utf8' ), text, 'the file is as it was' );

		let forced = await cli( file, [ 'query', 'add', '--check', '--force', '--json', '{"Name":"X","DataSource":"Bookings"}' ] );
		LIB_ASSERT.strictEqual( forced.Code, 2 );
		LIB_ASSERT.match( forced.Stderr, /\[--force\] has no effect with --check/ );
	} );

	it( 'served, never changes the document the session holds, and sends no document event', async function ()
	{
		let file = write( root, 'held.jsonx', Spec.AppendixB() );
		let io = Parser.DefaultIo();
		io.Env = {};
		io.Cwd = root;
		let held = Held.NewHeld( { Tree: Commands.TREE, File: file, Io: io } );
		let events = [];
		held.OnEvent( function ( Event ) { events.push( Event.Event ); } );
		try
		{
			let before_text = JSON.stringify( held.Session.Document );
			let checks = [
				{ Command: 'query add', check: true, json: { Name: 'Every booking', DataSource: 'Bookings', Criteria: {} } },
				{ Command: 'query add', check: true, json: { Name: 'Read nowhere', DataSource: 'Nowhere', Criteria: {} } },
				{ Command: 'datasource set', name: 'Bookings', check: true, json: { Settings: { Extra: 1 } } },
				{ Command: 'datasource set', name: 'Bookings', check: true, json: { AdapterName: 'no-such-adapter' } },
			];
			let codes = [];
			for ( let check of checks ) { codes.push( ( await held.Invoke( check ) ).ExitCode ); }
			LIB_ASSERT.deepStrictEqual( codes, [ 0, 3, 0, 3 ] );
			LIB_ASSERT.strictEqual( JSON.stringify( held.Session.Document ), before_text );
			LIB_ASSERT.deepStrictEqual( events, [] );

			// And an edit made for real still changes it.
			let added = await held.Invoke( { Command: 'query add', json: { Name: 'Every booking', DataSource: 'Bookings', Criteria: {} } } );
			LIB_ASSERT.strictEqual( added.ExitCode, 0, added.Log.join( '\n' ) );
			LIB_ASSERT.notStrictEqual( JSON.stringify( held.Session.Document ), before_text );
			LIB_ASSERT.deepStrictEqual( events, [ 'document' ] );
		}
		finally { await held.Release(); }
	} );

} );
