'use strict';

/*
	The front requests on the WebSocket (cut 5, step 2): Line, Entry, Complete, Actions and Inventory,
	answered by the process from Library.Front over the held document, with Node's own client.
*/

const LIB_ASSERT = require( 'assert' );
const LIB_FS = require( 'fs' );
const LIB_OS = require( 'os' );
const LIB_PATH = require( 'path' );
const { describe, it, before, after } = require( 'node:test' );

const Front = {
	Inventory: require( '../src/Front/Inventory.js' ),
	Entry: require( '../src/Front/Entry.js' ),
	Line: require( '../src/Front/Line.js' ),
	Completion: require( '../src/Front/Completion.js' ),
};
const Commands = require( '../commands/jsonx.js' );
const Spec = require( './fixtures/Spec.js' );
const WsClient = require( './fixtures/WsClient.js' );


//---------------------------------------------------------------------
describe( 'Front requests on the WebSocket', function ()
{
	let root = null;
	let secret = null;

	before( function ()
	{
		root = LIB_FS.mkdtempSync( LIB_PATH.join( LIB_OS.tmpdir(), 'jsonx-wsfront-' ) );
		secret = LIB_PATH.join( root, 'secret.json' );
		LIB_FS.writeFileSync( secret, '{ "Password": "never shown" }' );
	} );

	after( function ()
	{
		LIB_FS.rmSync( root, { recursive: true, force: true } );
	} );


	it( 'answers each request as the library answers over the held document', async function ()
	{
		let file = WsClient.Write( root, 'answers.jsonx', Spec.AppendixB() );
		let served = await WsClient.Serve( file );
		let client = await WsClient.Connect( served.Url );
		try
		{
			let document = served.Held.Session.Document;
			let tree = Commands.TREE;

			let line = await client.Ask( { Line: 'data find Bookings --max 5' } );
			LIB_ASSERT.strictEqual( line.ExitCode, 0 );
			LIB_ASSERT.deepStrictEqual( line.Result, Front.Line.ReadLine( tree, 'data find Bookings --max 5', Front.Line.ServedIo() ) );
			LIB_ASSERT.strictEqual( ( await client.Ask( { Line: 'data delete Bookings --criteria {}' } ) ).Result.Outcome, 'confirm' );
			LIB_ASSERT.match( ( await client.Ask( { Line: 'tui' } ) ).Result.Findings[ 0 ].Message, /is not run from the Web UI/ );

			let typed = '{ "Kind": "Query", "Name": "Long nights", "DataSource": "Bookings", "Criteria": { "Hours": 8 } }';
			let entry = await client.Ask( { Entry: typed } );
			let expected = Front.Entry.ReadEntry( typed, document );
			expected.Save = Front.Entry.EditInvocation( expected.Target, false );
			expected.Check = Front.Entry.EditInvocation( expected.Target, true );
			LIB_ASSERT.deepStrictEqual( entry.Result, expected );
			LIB_ASSERT.deepStrictEqual( ( await client.Ask( { Entry: '{ "Kind": ' } ) ).Result.Target, null );

			// The Check it answered is a command the process runs: nothing written, the entry checked.
			let checked = await client.Ask( { Invoke: entry.Result.Check } );
			LIB_ASSERT.strictEqual( checked.ExitCode, 0, JSON.stringify( checked ) );
			LIB_ASSERT.strictEqual( served.Held.Session.Document.Objects.some( function ( Each ) { return Each.Name === 'Long nights'; } ), false );

			let complete = await client.Ask( { Complete: 'run "Prep' } );
			let expected_completion = Front.Completion.CompleteText( tree, 'run "Prep', Front.Line.ServedIo(), { Document: document } );
			expected_completion.Items = Front.Completion.CompletionItems( 'run "Prep', expected_completion );
			LIB_ASSERT.deepStrictEqual( complete.Result, expected_completion );
			// The page inserts what it is given: the quote already typed is replaced, and the name quoted.
			LIB_ASSERT.deepStrictEqual( complete.Result.Items.find( function ( Item ) { return Item.Label === 'Prepare the season'; } ), { Label: 'Prepare the season', Insert: '"Prepare the season"', Replace: 5 } );
			LIB_ASSERT.ok( complete.Result.Candidates.includes( 'Prepare the season' ) );
			let operator = await client.Ask( { Complete: '{ "Criteria": { "Hours": { "$gt' } );
			LIB_ASSERT.ok( operator.Result.Candidates.includes( '$gte' ), JSON.stringify( operator.Result ) );

			let actions = await client.Ask( { Actions: 'Bookings' } );
			let item = Front.Inventory.InventoryOf( document, [] ).find( function ( Each ) { return Each.Name === 'Bookings'; } );
			LIB_ASSERT.deepStrictEqual( actions.Result.map( function ( Each ) { let copy = Object.assign( {}, Each ); delete copy.Line; return copy; } ), Front.Inventory.ActionsFor( tree, item ) );
			LIB_ASSERT.strictEqual( actions.Result[ 0 ].Line, 'datasource find Bookings' );
			let season = await client.Ask( { Actions: 'Prepare the season' } );
			let run_line = season.Result.find( function ( Each ) { return Each.Command === 'run'; } ).Line;
			LIB_ASSERT.strictEqual( run_line, 'run "Prepare the season"' );
			// The line reads back as the entry's own name.
			LIB_ASSERT.strictEqual( ( await client.Ask( { Line: run_line } ) ).Result.Document.name, 'Prepare the season' );
			let unknown = await client.Ask( { Actions: 'Nowhere' } );
			LIB_ASSERT.strictEqual( unknown.ExitCode, 2 );

			let inventory = await client.Ask( { Inventory: true } );
			let validated = await served.Held.Invoke( { Command: 'validate' } );
			LIB_ASSERT.deepStrictEqual( inventory.Result, { Items: Front.Inventory.InventoryOf( document, validated.Findings ), Findings: validated.Findings } );

			// A request of the wrong shape is a usage mistake, not a failure.
			for ( let wrong of [ { Line: 1 }, { Entry: {} }, { Complete: null }, { Actions: [] } ] )
			{
				LIB_ASSERT.strictEqual( ( await client.Ask( wrong ) ).ExitCode, 2, JSON.stringify( wrong ) );
			}
		}
		finally { await client.Close(); await served.Close(); }
	} );


	it( 'reads no file and no standard input of the server\'s for a line or a completion', async function ()
	{
		let file = WsClient.Write( root, 'files.jsonx', Spec.AppendixB() );
		WsClient.Write( root, 'neighbour.jsonx', {} );
		let served = await WsClient.Serve( file );
		let client = await WsClient.Connect( served.Url );
		try
		{
			let from_file = await client.Ask( { Line: 'data find Bookings --criteria @' + secret } );
			LIB_ASSERT.strictEqual( from_file.Result.Outcome, 'usage' );
			LIB_ASSERT.ok( from_file.Result.Findings[ 0 ].Message.includes( Front.Line.SERVED_REFUSAL ) );
			LIB_ASSERT.ok( !JSON.stringify( from_file ).includes( 'never shown' ) );

			let from_stdin = await client.Ask( { Line: 'data insert Bookings --documents -' } );
			LIB_ASSERT.strictEqual( from_stdin.Result.Outcome, 'usage' );

			let files = await client.Ask( { Complete: 'validate --file ' } );
			LIB_ASSERT.deepStrictEqual( files.Result.Candidates, [] );
		}
		finally { await client.Close(); await served.Close(); }
	} );


	it( 'completes a data source\'s fields once describe has answered, and asks again after a write', async function ()
	{
		let file = WsClient.Write( root, 'fields.jsonx', Spec.AppendixB() );
		let served = await WsClient.Serve( file );
		let client = await WsClient.Connect( served.Url );
		try
		{
			await client.Ask( { Invoke: { Command: 'run', name: 'Two telescopes' } } );
			let typed = '{ "Kind": "Query", "Name": "Q", "DataSource": "Telescopes", "Criteria": { "Na';
			// The first completion starts describe and answers what is known: nothing yet.
			LIB_ASSERT.deepStrictEqual( ( await client.Ask( { Complete: typed } ) ).Result.Candidates, [] );
			let candidates = [];
			for ( let waited = 0; waited < 5000 && candidates.length === 0; waited += 50 )
			{
				await WsClient.Wait( 50 );
				candidates = ( await client.Ask( { Complete: typed } ) ).Result.Candidates;
			}
			LIB_ASSERT.deepStrictEqual( candidates, [ 'Name' ] );

			// A write may add fields: after an Invoke, describe is asked again.
			await client.Ask( { Invoke: { Command: 'datasource insert', name: 'Telescopes', documents: { Name: 'Newton 20', Nickname: 'N' } } } );
			let after_write = '{ "Kind": "Query", "Name": "Q", "DataSource": "Telescopes", "Criteria": { "Ni';
			let seen = [];
			for ( let waited = 0; waited < 5000 && seen.length === 0; waited += 50 )
			{
				seen = ( await client.Ask( { Complete: after_write } ) ).Result.Candidates;
				if ( seen.length === 0 ) { await WsClient.Wait( 50 ); }
			}
			LIB_ASSERT.deepStrictEqual( seen, [ 'Nickname' ] );
		}
		finally { await client.Close(); await served.Close(); }
	} );


	it( 'answers at once while a debug holds the queue', async function ()
	{
		let file = WsClient.Write( root, 'debug.jsonx', Spec.AppendixB() );
		let served = await WsClient.Serve( file );
		let debugger_client = await WsClient.Connect( served.Url );
		let client = await WsClient.Connect( served.Url );
		try
		{
			debugger_client.Socket.send( JSON.stringify( { Id: 'd', Debug: { process: 'Prepare the season' } } ) );
			await client.Next( function ( Message ) { return Message.Event === 'queue' && Message.HeldBy === 'debug'; } );

			let started = Date.now();
			LIB_ASSERT.strictEqual( ( await client.Ask( { Line: 'run "Prepare the season"' }, 2000 ) ).ExitCode, 0 );
			LIB_ASSERT.strictEqual( ( await client.Ask( { Entry: '{ "Kind": "Query", "Name": "X", "DataSource": "Bookings", "Criteria": {} }' }, 2000 ) ).ExitCode, 0 );
			LIB_ASSERT.strictEqual( ( await client.Ask( { Complete: 'run ' }, 2000 ) ).ExitCode, 0 );
			LIB_ASSERT.strictEqual( ( await client.Ask( { Actions: 'Bookings' }, 2000 ) ).ExitCode, 0 );
			LIB_ASSERT.strictEqual( ( await client.Ask( { Inventory: true }, 2000 ) ).ExitCode, 0 );
			LIB_ASSERT.ok( Date.now() - started < 2000 );

			debugger_client.Socket.send( JSON.stringify( { Id: 's', Step: 'quit' } ) );
			await debugger_client.Next( function ( Message ) { return Message.Id === 'd' && Message.Answer; } );
		}
		finally { await debugger_client.Close(); await client.Close(); await served.Close(); }
	} );

} );
