'use strict';

/*
	--changes (cut 4, F5.4): what an Update changed, before and after, for the TUI's diff. The runner
	keeps the documents it already reads to measure Changed; only the command's result carries them.
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


//---------------------------------------------------------------------
function write( Directory, Name, Document )
{
	let path = LIB_PATH.join( Directory, Name );
	LIB_FS.writeFileSync( path, JSON.stringify( Document, null, '\t' ) );
	return path;
}

function document_with( Store )
{
	return {
		DataSources: [ Store ],
		Objects: [
			{ Kind: 'Insert', Name: 'Seed', DataSource: 'Items', Documents: [ { _id: 'a', Color: 'blue' }, { _id: 'b', Color: 'red' }, { _id: 'c', Color: 'blue', Shade: 'dark' } ] },
			{ Kind: 'Update', Name: 'Darken blue', DataSource: 'Items', Criteria: { Color: 'blue' }, Update: { $set: { Shade: 'dark' } } },
			{ Kind: 'Update', Name: 'Darken green', DataSource: 'Items', Criteria: { Color: 'green' }, Update: { $set: { Shade: 'dark' } } },
			{
				Kind: 'Process', Name: 'Darken through a call',
				Steps: [ { $call: { Name: 'Darken blue', Into: 'Darkened' } }, { $return: '$Darkened' } ],
			},
		],
	};
}

function hold( File )
{
	let io = Parser.DefaultIo();
	io.Env = {};
	io.Cwd = LIB_PATH.dirname( File );
	return Held.NewHeld( { Tree: Commands.TREE, File: File, Io: io } );
}

async function invoke_ok( HeldSession, Invocation )
{
	let envelope = await HeldSession.Invoke( Invocation );
	LIB_ASSERT.strictEqual( envelope.ExitCode, 0, JSON.stringify( Invocation ) + '\n' + envelope.Log.join( '\n' ) );
	return envelope;
}


//---------------------------------------------------------------------
describe( '--changes', function ()
{

	let root = null;
	let memory = null;

	before( function ()
	{
		root = LIB_FS.mkdtempSync( LIB_PATH.join( LIB_OS.tmpdir(), 'jsonx-changes-' ) );
		memory = write( root, 'memory.jsonx', document_with( { Name: 'Items', AdapterName: 'jsonstor-memory' } ) );
	} );

	after( function () { LIB_FS.rmSync( root, { recursive: true, force: true } ); } );


	it( 'adds the documents an Update changed to run\'s result, and only those which changed', async function ()
	{
		let held = hold( memory );
		try
		{
			await invoke_ok( held, { Command: 'run', name: 'Seed' } );
			let ran = await invoke_ok( held, { Command: 'run', name: 'Darken blue', changes: true } );
			// c already held the value: selected, not changed, and not in Changes.
			LIB_ASSERT.deepStrictEqual( ran.Result, {
				Selected: 2,
				Changed: 1,
				Changes: [ { Before: { _id: 'a', Color: 'blue' }, After: { _id: 'a', Color: 'blue', Shade: 'dark' } } ],
			} );
		}
		finally { await held.Release(); }
	} );

	it( 'adds them to datasource update\'s result, answers [] when nothing was selected, and nothing when not asked', async function ()
	{
		let held = hold( memory );
		try
		{
			await invoke_ok( held, { Command: 'run', name: 'Seed' } );
			let updated = await invoke_ok( held, { Command: 'data update', name: 'Items', criteria: { Color: 'red' }, update: { $set: { Color: 'crimson' } }, changes: true } );
			LIB_ASSERT.deepStrictEqual( updated.Result.Changes, [ { Before: { _id: 'b', Color: 'red' }, After: { _id: 'b', Color: 'crimson' } } ] );

			let none = await invoke_ok( held, { Command: 'run', name: 'Darken green', changes: true } );
			LIB_ASSERT.deepStrictEqual( none.Result, { Selected: 0, Changed: 0, Changes: [] } );

			// A request which does not ask gets the spec's result, after one which did.
			let plain = await invoke_ok( held, { Command: 'data update', name: 'Items', criteria: { Color: 'crimson' }, update: { $set: { Color: 'red' } } } );
			LIB_ASSERT.deepStrictEqual( plain.Result, { Selected: 1, Changed: 1 } );
		}
		finally { await held.Release(); }
	} );

	it( 'never changes what a Process calling the Update receives', async function ()
	{
		let held = hold( memory );
		try
		{
			await invoke_ok( held, { Command: 'run', name: 'Seed' } );
			// The Update's own result - what a `$call` receives - never carries Changes, whatever the
			// runner keeps on its report.
			await invoke_ok( held, { Command: 'run', name: 'Darken green', changes: true } );
			let called = await invoke_ok( held, { Command: 'run', name: 'Darken through a call' } );
			LIB_ASSERT.deepStrictEqual( called.Result, { Selected: 2, Changed: 1 } );
		}
		finally { await held.Release(); }
	} );

	it( 'is refused where it would be ignored: on an object which is not an Update, and beside --save', async function ()
	{
		let held = hold( memory );
		try
		{
			let on_process = await held.Invoke( { Command: 'run', name: 'Darken through a call', changes: true } );
			LIB_ASSERT.strictEqual( on_process.ExitCode, 2 );
			LIB_ASSERT.match( on_process.Log.join( '\n' ), /\[--changes\] has an effect only on an Update, and \[Darken through a call\] is a Process/ );
			let on_insert = await held.Invoke( { Command: 'run', name: 'Seed', changes: true } );
			LIB_ASSERT.strictEqual( on_insert.ExitCode, 2 );
			LIB_ASSERT.match( on_insert.Log.join( '\n' ), /\[Seed\] is an Insert\./ );

			let saved = await held.Invoke( { Command: 'data update', name: 'Items', criteria: { Color: 'red' }, update: { $set: { A: 1 } }, changes: true, save: 'Saved update' } );
			LIB_ASSERT.strictEqual( saved.ExitCode, 2 );
			LIB_ASSERT.match( saved.Log.join( '\n' ), /\[--changes\] has no effect with --save/ );

			let elsewhere = await held.Invoke( { Command: 'data find', name: 'Items', changes: true } );
			LIB_ASSERT.strictEqual( elsewhere.ExitCode, 2 );
		}
		finally { await held.Release(); }
	} );

	it( 'on the command line, writes the changes in the result, and without it the same output as before', async function ()
	{
		let file = write( root, 'items.jsonx', document_with( { Name: 'Items', AdapterName: 'jsonstor-jsonfile', Settings: { Path: 'items.json' } } ) );
		let run_cli = async function ( Argv )
		{
			let io = Parser.DefaultIo();
			io.Env = {};
			io.Cwd = root;
			let stdout = '';
			let stderr = '';
			io.Stdout = function ( Text ) { stdout += Text; };
			io.Stderr = function ( Text ) { stderr += Text; };
			let code = await Main.Main( Argv.concat( [ '--file', file ] ), io );
			return { Code: code, Stdout: stdout, Stderr: stderr };
		};

		let seeded = await run_cli( [ 'run', 'Seed' ] );
		LIB_ASSERT.strictEqual( seeded.Code, 0, seeded.Stderr );

		let with_changes = await run_cli( [ 'data', 'update', 'Items', '--criteria', '{"_id":"a"}', '--update', '{"$set":{"Shade":"light"}}', '--changes' ] );
		LIB_ASSERT.strictEqual( with_changes.Code, 0, with_changes.Stderr );
		LIB_ASSERT.deepStrictEqual( JSON.parse( with_changes.Stdout ), {
			Selected: 1, Changed: 1, Changes: [ { Before: { _id: 'a', Color: 'blue' }, After: { _id: 'a', Color: 'blue', Shade: 'light' } } ],
		} );

		let without = await run_cli( [ 'data', 'update', 'Items', '--criteria', '{"_id":"b"}', '--update', '{"$set":{"Shade":"light"}}' ] );
		LIB_ASSERT.strictEqual( without.Code, 0, without.Stderr );
		LIB_ASSERT.strictEqual( without.Stdout, JSON.stringify( { Selected: 1, Changed: 1 }, null, '\t' ) + '\n' );
		// The report line is the same either way: --changes adds to the result only.
		LIB_ASSERT.strictEqual( with_changes.Stderr.replace( /\d+ ms/g, 'ms' ), without.Stderr.replace( /\d+ ms/g, 'ms' ) );
	} );

} );
