'use strict';

/*
	The TUI's model (cut 4, step 5), against a real served file through the real client: what the TUI
	does, with no terminal (modes/tui/Model.js).
*/

const LIB_ASSERT = require( 'assert' );
const LIB_FS = require( 'fs' );
const LIB_OS = require( 'os' );
const LIB_PATH = require( 'path' );
const { describe, it, before, after } = require( 'node:test' );

const Api = require( '../modes/api/Api.js' );
const Client = require( '../modes/tui/Client.js' );
const Model = require( '../modes/tui/Model.js' );
const Held = require( '../src/Session/Held.js' );
const Parser = require( '../src/CommandLine/Parser.js' );
const Commands = require( '../commands/jsonx.js' );
const jsonx_cli = require( '../src/jsonx-cli.js' );
const Spec = require( './fixtures/Spec.js' );


//---------------------------------------------------------------------
function write( Directory, Name, Document )
{
	let path = LIB_PATH.join( Directory, Name );
	LIB_FS.writeFileSync( path, JSON.stringify( Document, null, '\t' ) );
	return path;
}

function wait( Ms ) { return new Promise( function ( Resolve ) { setTimeout( Resolve, Ms ); } ); }

async function until( Test, Label )
{
	for ( let waited = 0; waited < 5000; waited += 20 )
	{
		if ( Test() ) { return; }
		await wait( 20 );
	}
	throw new Error( 'Timed out waiting: ' + Label );
}

async function serve( File, Version )
{
	let io = Parser.DefaultIo();
	io.Env = {};
	io.Cwd = LIB_PATH.dirname( File );
	let held = Held.NewHeld( { Tree: Commands.TREE, File: File, Io: io } );
	let server = await Api.Listen( Api.NewApi( held, { Host: '127.0.0.1', Version: Version || jsonx_cli.Version } ), '127.0.0.1', 0 );
	return {
		Held: held,
		Url: 'ws://127.0.0.1:' + server.address().port + '/ws',
		Close: async function () { await Api.Close( server ); await held.Release(); },
	};
}

// A served file, a started model over it, and its closer.
async function open_model( File, Root, Extra )
{
	let served = await serve( File );
	let client = Client.NewClient( { Url: served.Url } );
	let io = Parser.DefaultIo();
	io.Env = {};
	io.Cwd = Root;
	let model = Model.NewModel( Object.assign( { Client: client, Tree: Commands.TREE, Version: jsonx_cli.Version, Io: io, SettingsPath: LIB_PATH.join( Root, 'settings', 'tui.json' ) }, Extra || {} ) );
	await model.Start();
	return {
		Served: served,
		Client: client,
		Model: model,
		Close: async function () { client.Close(); await served.Close(); },
	};
}


//---------------------------------------------------------------------
describe( 'The TUI model', function ()
{

	let root = null;

	before( function () { root = LIB_FS.mkdtempSync( LIB_PATH.join( LIB_OS.tmpdir(), 'jsonx-tuimodel-' ) ); } );
	after( function () { LIB_FS.rmSync( root, { recursive: true, force: true } ); } );


	it( 'reads the held document over the WebSocket, as MCP reads its resources, and never a resolved secret', async function ()
	{
		let file = write( root, 'secret.jsonx', {
			DataSources: [ { Name: 'Kept', AdapterName: 'jsonstor-memory', Settings: { Note: '${env:JSONX_TEST_SECRET}' } } ],
		} );
		let io = Parser.DefaultIo();
		io.Env = { JSONX_TEST_SECRET: 'the-resolved-secret-value' };
		io.Cwd = root;
		let held = Held.NewHeld( { Tree: Commands.TREE, File: file, Io: io } );
		let server = await Api.Listen( Api.NewApi( held, { Host: '127.0.0.1', Version: 'test' } ), '127.0.0.1', 0 );
		let client = Client.NewClient( { Url: 'ws://127.0.0.1:' + server.address().port + '/ws' } );
		try
		{
			await client.Connect();
			let whole = await client.Read( 'jsonx://file' );
			LIB_ASSERT.deepStrictEqual( whole.Result, JSON.parse( LIB_FS.readFileSync( file, 'utf8' ) ) );
			let entry = await client.Read( 'jsonx://entry/' + encodeURIComponent( 'Kept' ) );
			LIB_ASSERT.strictEqual( entry.Result.Settings.Note, '${env:JSONX_TEST_SECRET}' );
			let missing = await client.Read( 'jsonx://entry/Nothing' );
			LIB_ASSERT.strictEqual( missing.ExitCode, 2 );
			LIB_ASSERT.match( missing.Log[ 0 ], /Nothing is at \[jsonx:\/\/entry\/Nothing\]/ );
		}
		finally { client.Close(); await Api.Close( server ); await held.Release(); }
	} );

	it( 'refuses a process of another version, since what is typed is parsed with this version\'s commands', async function ()
	{
		let served = await serve( write( root, 'version.jsonx', Spec.AppendixB() ), '0.0.0-other' );
		try
		{
			let model = Model.NewModel( { Client: Client.NewClient( { Url: served.Url } ), Tree: Commands.TREE, Version: jsonx_cli.Version, SettingsPath: LIB_PATH.join( root, 'none.json' ) } );
			await LIB_ASSERT.rejects( model.Start(), function ( error )
			{
				LIB_ASSERT.ok( error instanceof Model.ModelError );
				LIB_ASSERT.strictEqual( error.ExitCode, 2 );
				LIB_ASSERT.match( error.message, /version 0\.0\.0-other/ );
				return true;
			} );
		}
		finally { await served.Close(); }
	} );

	it( 'shows the inventory in file order, each entry badged with the worst finding in it', async function ()
	{
		let document = Spec.AppendixB();
		let broken_index = document.Objects.findIndex( function ( Entry ) { return typeof Entry.DataSource === 'string'; } );
		document.Objects[ broken_index ].DataSource = 'Nowhere';
		let opened = await open_model( write( root, 'inventory.jsonx', document ), root );
		try
		{
			let state = opened.Model.State;
			LIB_ASSERT.strictEqual( state.Connected, true );
			LIB_ASSERT.strictEqual( state.Version, jsonx_cli.Version );
			let names = state.Inventory.map( function ( Item ) { return Item.Name; } );
			let expected = [].concat(
				document.DataSources.map( function ( Entry ) { return Entry.Name; } ),
				document.Objects.map( function ( Entry ) { return Entry.Name; } ),
				document.Triggers.map( function ( Entry ) { return Entry.Name; } ) );
			LIB_ASSERT.deepStrictEqual( names, expected );
			let broken = state.Inventory.find( function ( Item ) { return Item.Section === 'Objects' && Item.Index === broken_index; } );
			LIB_ASSERT.strictEqual( broken.Severity, 'error' );
			LIB_ASSERT.ok( state.Inventory.filter( function ( Item ) { return Item.Severity === 'error'; } ).length === 1, JSON.stringify( state.Inventory ) );
		}
		finally { await opened.Close(); }
	} );

	it( 'puts a selected entry in Input, checks a typed entry live, and writes nothing until it is saved', async function ()
	{
		let file = write( root, 'input.jsonx', Spec.AppendixB() );
		let text = LIB_FS.readFileSync( file, 'utf8' );
		let opened = await open_model( file, root );
		let model = opened.Model;
		try
		{
			model.Select( 'Bookings' );
			LIB_ASSERT.strictEqual( model.State.Input.Mode, 'json' );
			LIB_ASSERT.deepStrictEqual( model.State.Input.Target && [ model.State.Input.Target.Noun, model.State.Input.Target.Exists ], [ 'datasource', true ] );

			model.SetInput( '{ "Kind": "Query", "Name": "Every booking", ' );
			LIB_ASSERT.ok( model.State.Input.Syntax !== null );
			LIB_ASSERT.strictEqual( await model.CheckInput(), null, 'a text which is not JSON is not checked' );

			model.SetInput( JSON.stringify( { Kind: 'Query', Name: 'Every booking', DataSource: 'Nowhere', Criteria: {} } ) );
			let bad = await model.CheckInput();
			LIB_ASSERT.strictEqual( bad.ExitCode, 3 );
			LIB_ASSERT.ok( model.State.Input.Findings.some( function ( Finding ) { return /Nowhere/.test( Finding.Message ); } ) );

			model.SetInput( JSON.stringify( { Kind: 'Query', Name: 'Every booking', DataSource: 'Bookings', Criteria: {} } ) );
			let good = await model.CheckInput();
			LIB_ASSERT.strictEqual( good.ExitCode, 0, good.Log.join( '\n' ) );
			LIB_ASSERT.deepStrictEqual( model.State.Input.Findings, [] );
			LIB_ASSERT.strictEqual( LIB_FS.readFileSync( file, 'utf8' ), text, 'checking writes nothing' );

			// Saved, the inventory follows the document event.
			let saved = await model.Submit();
			LIB_ASSERT.strictEqual( saved.ExitCode, 0, saved.Log.join( '\n' ) );
			await until( function () { return model.State.Inventory.some( function ( Item ) { return Item.Name === 'Every booking'; } ); }, 'the new entry in the inventory' );

			// Saving an entry which exists replaces it, fields left out removed.
			// ***Typed straight after a save***, before the document event has refreshed the copy here.
			model.SetInput( JSON.stringify( { Kind: 'Query', Name: 'Every booking', DataSource: 'Bookings', Criteria: {}, MaxCount: 5 } ) );
			LIB_ASSERT.strictEqual( ( await model.Submit() ).ExitCode, 0 );
			model.SetInput( JSON.stringify( { Kind: 'Query', Name: 'Every booking', DataSource: 'Bookings', Criteria: { Status: 'confirmed' } } ) );
			let replaced = await model.Submit();
			LIB_ASSERT.strictEqual( replaced.ExitCode, 0, replaced.Log.join( '\n' ) );
			let written = JSON.parse( LIB_FS.readFileSync( file, 'utf8' ) ).Objects.find( function ( Entry ) { return Entry.Name === 'Every booking'; } );
			LIB_ASSERT.deepStrictEqual( written, { Kind: 'Query', Name: 'Every booking', DataSource: 'Bookings', Criteria: { Status: 'confirmed' } } );
		}
		finally { await opened.Close(); }
	} );

	it( 'completes commands, names, operators, and a data source\'s fields', async function ()
	{
		let opened = await open_model( write( root, 'complete.jsonx', Spec.AppendixB() ), root );
		let model = opened.Model;
		try
		{
			model.SetInput( 'run Pre' );
			LIB_ASSERT.deepStrictEqual( model.Complete(), { Prefix: 'Pre', Candidates: [ 'Prepare the season' ], Json: false } );
			LIB_ASSERT.strictEqual( model.ApplyCompletion( 'Prepare the season' ), 'run "Prepare the season"' );

			model.SetInput( 'data c' );
			LIB_ASSERT.ok( model.Complete().Candidates.includes( 'count' ) );

			model.SetInput( '{ "Kind": "Query", "Name": "Q", "DataSource": "Boo' );
			LIB_ASSERT.deepStrictEqual( model.Complete().Candidates, [ 'Bookings' ] );

			// Every operator jsongin knows is offered, whatever the key: query operators among them.
			model.SetInput( '{ "Kind": "Query", "Name": "Q", "DataSource": "Bookings", "Criteria": { "Hours": { "$g' );
			let operators = model.Complete().Candidates;
			LIB_ASSERT.ok( operators.includes( '$gt' ) && operators.includes( '$gte' ), JSON.stringify( operators ) );
			LIB_ASSERT.ok( operators.every( function ( Each ) { return Each.startsWith( '$g' ); } ) );

			// Inside a JSON option being typed on a command line, too.
			model.SetInput( 'data find Bookings --criteria {"Hours": {"$gt' );
			let typed = model.Complete();
			LIB_ASSERT.ok( typed.Candidates.includes( '$gte' ) );
			LIB_ASSERT.strictEqual( model.ApplyCompletion( '$gte' ), 'data find Bookings --criteria {"Hours": {"$gte' );

			model.SetInput( '{ "Kind": "Process", "Name": "P", "Steps": [ { "$call": { "Name": "Find' );
			LIB_ASSERT.deepStrictEqual( model.Complete().Candidates, [ 'FindOne', 'FindMany', 'FindMany2' ] );

			// A field name: an empty store has none; once it has rows, and describe has answered, its fields.
			model.SetInput( '{ "Kind": "Query", "Name": "Q", "DataSource": "Bookings", "Criteria": { "Ob' );
			LIB_ASSERT.deepStrictEqual( model.Complete().Candidates, [] );
			await wait( 300 );
			LIB_ASSERT.deepStrictEqual( model.Complete().Candidates, [], 'the empty store has no fields' );
			model.SetInput( 'run "Three bookings"' );
			await model.Submit();
			model.SetInput( '{ "Kind": "Query", "Name": "Q", "DataSource": "Bookings", "Criteria": { "Ob' );
			await until( function () { return model.Complete().Candidates.length > 0; }, 'fields from datasource describe' );
			LIB_ASSERT.deepStrictEqual( model.Complete().Candidates, [ 'Observer' ] );
		}
		finally { await opened.Close(); }
	} );

	it( 'runs a typed command: its report in Log, its result in Data Rows, and help and refusals kept here', async function ()
	{
		let opened = await open_model( write( root, 'run.jsonx', Spec.AppendixB() ), root );
		let model = opened.Model;
		let running_seen = [];
		model.OnChange( function ( State ) { if ( State.Running.length > 0 ) { running_seen.push( State.Running.slice() ); } } );
		try
		{
			model.SetInput( 'jsonx run "Prepare the season"' );
			let answer = await model.Submit();
			LIB_ASSERT.strictEqual( answer.ExitCode, 0, answer.Log.join( '\n' ) );
			LIB_ASSERT.deepStrictEqual( model.State.Rows.Rows, [ { Booking: 'b-1', Observer: 'R. Okafor', Dome: 'B' } ] );
			LIB_ASSERT.deepStrictEqual( model.State.Rows.Columns, [ 'Booking', 'Observer', 'Dome' ] );
			LIB_ASSERT.ok( model.State.Log.some( function ( Line ) { return Line.Kind === 'log' && /^Prepare the season {2}Process/.test( Line.Text ); } ), JSON.stringify( model.State.Log ) );
			LIB_ASSERT.ok( running_seen.some( function ( Stack ) { return Stack[ 0 ] === 'Prepare the season'; } ), 'progress was shown while it ran' );
			LIB_ASSERT.deepStrictEqual( model.State.Running, [] );

			model.SetInput( 'run --help' );
			LIB_ASSERT.strictEqual( await model.Submit(), null );
			LIB_ASSERT.ok( model.State.Log.some( function ( Line ) { return /jsonx run \[name\]/.test( Line.Text ); } ) );

			model.SetInput( 'serve --api' );
			await model.Submit();
			LIB_ASSERT.match( model.State.Input.Findings[ 0 ].Message, /is not run from the TUI/ );

			model.SetInput( 'run "Prepare the' );
			await model.Submit();
			LIB_ASSERT.match( model.State.Input.Findings[ 0 ].Message, /quote is not closed/ );

			// A bare run is refused by the command, not the parser, since --json stands in for the name (cut 7).
			model.SetInput( 'run' );
			let bare = await model.Submit();
			LIB_ASSERT.strictEqual( bare.ExitCode, 2 );
			LIB_ASSERT.ok( model.State.Log.some( function ( Line ) { return /Name one object, or pass --json/.test( Line.Text ); } ), JSON.stringify( model.State.Log ) );
		}
		finally { await opened.Close(); }
	} );

	it( 'lists an entry\'s actions from the command tree, and runs one as the same command typed', async function ()
	{
		let opened = await open_model( write( root, 'actions.jsonx', Spec.AppendixB() ), root );
		let model = opened.Model;
		try
		{
			let labels = function ( Name ) { return model.Actions( Name ).map( function ( Action ) { return Action.Label + ( Action.Sends ? '' : '…' ); } ); };
			let first = function ( Section ) { return model.State.Inventory.find( function ( Item ) { return Item.Section === Section; } ).Name; };
			let process = model.State.Inventory.find( function ( Item ) { return Item.Kind === 'Process'; } ).Name;
			let update = model.State.Inventory.find( function ( Item ) { return Item.Kind === 'Update'; } ).Name;

			LIB_ASSERT.deepStrictEqual( labels( process ).slice( 0, 5 ), [ 'run', 'debug', 'plan', 'explain', 'validate' ] );
			LIB_ASSERT.ok( labels( process ).includes( 'rename…' ) && labels( process ).includes( 'remove…' ) && labels( process ).includes( 'show' ) );
			LIB_ASSERT.deepStrictEqual( labels( update ).slice( 0, 4 ), [ 'run', 'plan', 'explain', 'validate' ], 'debug is a Process\'s only' );
			LIB_ASSERT.deepStrictEqual( labels( first( 'Triggers' ) ).slice( 0, 3 ), [ 'run', 'explain', 'validate' ] );
			LIB_ASSERT.strictEqual( model.Actions( first( 'Triggers' ) )[ 0 ].Command, 'trigger run' );
			let source = labels( first( 'DataSources' ) );
			LIB_ASSERT.deepStrictEqual( source.slice( 0, 2 ), [ 'find', 'count' ] );
			[ 'describe', 'ping', 'drop…', 'flush…', 'update…', 'delete…' ].forEach( function ( Label ) { LIB_ASSERT.ok( source.includes( Label ), Label + ' in ' + source.join( ', ' ) ); } );
			LIB_ASSERT.deepStrictEqual( model.Actions( 'No such entry' ), [] );

			// ***Every command whose name positional completes to an entry is listed***, read from the tree.
			let listed = model.Actions( process ).map( function ( Action ) { return Action.Command; } ).sort();
			let expected = Held.ServedCommands( Commands.TREE ).map( function ( Command ) { return Command.Command; } )
				.filter( function ( Command ) { return /^(run|plan|explain|validate|process [a-z-]+)$/.test( Command ) && Command !== 'process list' && Command !== 'process add'; } )
				.concat( [ 'debug' ] ).sort();
			LIB_ASSERT.deepStrictEqual( listed, expected );

			// run is sent, as the typed line is.
			let answer = await model.Act( 'Prepare the season', 'run' );
			LIB_ASSERT.strictEqual( answer.ExitCode, 0, ( answer.Log || [] ).join( '\n' ) );
			LIB_ASSERT.deepStrictEqual( model.State.Rows.Rows, [ { Booking: 'b-1', Observer: 'R. Okafor', Dome: 'B' } ] );
			LIB_ASSERT.ok( model.State.Log.some( function ( Line ) { return Line.Kind === 'command' && Line.Text === '> run Prepare the season'; } ) );

			// remove changes the file: it goes to Input, and the file keeps the entry.
			LIB_ASSERT.deepStrictEqual( await model.Act( 'Prepare the season', 'process remove' ), { Input: true } );
			LIB_ASSERT.strictEqual( model.State.Input.Text, 'process remove "Prepare the season" ' );
			LIB_ASSERT.ok( model.State.Inventory.some( function ( Item ) { return Item.Name === 'Prepare the season'; } ) );
			LIB_ASSERT.strictEqual( await model.Act( 'Prepare the season', 'no such command' ), null );
		}
		finally { await opened.Close(); }
	} );

	it( 'asks before a command which touches every document, and sends it only when confirmed', async function ()
	{
		let opened = await open_model( write( root, 'confirm.jsonx', Spec.AppendixB() ), root );
		let model = opened.Model;
		let count = async function () { return ( await opened.Client.Invoke( { Command: 'data count', name: 'Telescopes' } ) ).Result; };
		try
		{
			await opened.Client.Invoke( { Command: 'run', name: 'Two telescopes' } );
			LIB_ASSERT.strictEqual( await count(), 2 );

			model.SetInput( 'data delete Telescopes --criteria {}' );
			LIB_ASSERT.strictEqual( await model.Submit(), null );
			LIB_ASSERT.match( model.State.Confirm.Message, /every document/ );
			LIB_ASSERT.strictEqual( await count(), 2, 'nothing sent while it asks' );

			await model.Confirm( false );
			LIB_ASSERT.strictEqual( model.State.Confirm, null );
			LIB_ASSERT.strictEqual( await count(), 2 );

			await model.Submit();
			let confirmed = await model.Confirm( true );
			LIB_ASSERT.strictEqual( confirmed.ExitCode, 0, confirmed.Log.join( '\n' ) );
			LIB_ASSERT.strictEqual( await count(), 0 );

			// Typed with --yes, it does not ask.
			await opened.Client.Invoke( { Command: 'run', name: 'Two telescopes' } );
			model.SetInput( 'data delete Telescopes --criteria {} --yes' );
			let typed = await model.Submit();
			LIB_ASSERT.strictEqual( typed.ExitCode, 0 );
			LIB_ASSERT.strictEqual( model.State.Confirm, null );
		}
		finally { await opened.Close(); }
	} );

	it( 'pages a find, and shows an Update\'s --changes with the diff between before and after', async function ()
	{
		let opened = await open_model( write( root, 'rows.jsonx', Spec.AppendixB() ), root );
		let model = opened.Model;
		try
		{
			await opened.Client.Invoke( { Command: 'run', name: 'Three bookings' } );

			model.SetInput( 'data find Bookings --sort {"_id":1} --max 2' );
			await model.Submit();
			LIB_ASSERT.deepStrictEqual( model.State.Rows.Rows.map( function ( Row ) { return Row._id; } ), [ 'b-1', 'b-2' ] );
			LIB_ASSERT.deepStrictEqual( [ model.State.Rows.Skip, model.State.Rows.Max, model.State.Rows.More ], [ 0, 2, true ] );

			await model.Page( 1 );
			LIB_ASSERT.deepStrictEqual( model.State.Rows.Rows.map( function ( Row ) { return Row._id; } ), [ 'b-3' ] );
			LIB_ASSERT.deepStrictEqual( [ model.State.Rows.Skip, model.State.Rows.More ], [ 2, false ] );
			await model.Page( -1 );
			LIB_ASSERT.strictEqual( model.State.Rows.Skip, 0 );

			model.SetInput( 'data update Bookings --criteria {"_id":"b-1"} --update {"$set":{"Status":"moved"}} --changes' );
			await model.Submit();
			let changes = model.State.Rows.Changes;
			LIB_ASSERT.strictEqual( changes.length, 1 );
			LIB_ASSERT.strictEqual( changes[ 0 ].After.Status, 'moved' );
			LIB_ASSERT.deepStrictEqual( changes[ 0 ].Diff, require( '@liquicode/jsongin' ).Diff( changes[ 0 ].Before, changes[ 0 ].After ) );
		}
		finally { await opened.Close(); }
	} );

	it( 'debugs a Process typed as a command, showing the queue held and the result at the end', async function ()
	{
		let opened = await open_model( write( root, 'debug.jsonx', Spec.AppendixB() ), root );
		let model = opened.Model;
		try
		{
			model.SetInput( 'debug "Prepare the season"' );
			let done = model.Submit();
			await until( function () { return model.State.Debug && model.State.Debug.Snapshot; }, 'the first snapshot' );
			await until( function () { return model.State.Queue === 'debug'; }, 'the queue event' );

			let stepped = await model.StepDebug( 'step' );
			LIB_ASSERT.strictEqual( stepped.ExitCode, 0 );
			LIB_ASSERT.strictEqual( model.State.Debug.Snapshot.Process, 'Prepare the season' );

			for ( let count = 0; count < 100 && model.State.Debug && !( model.State.Debug.Snapshot && model.State.Debug.Snapshot.Finished ); count++ )
			{
				await model.StepDebug( 'continue' );
			}
			await done;
			await until( function () { return model.State.Debug === null && model.State.Queue === null; }, 'the debug to end' );
			LIB_ASSERT.deepStrictEqual( model.State.Rows.Rows, [ { Booking: 'b-1', Observer: 'R. Okafor', Dome: 'B' } ] );
			LIB_ASSERT.ok( model.State.Log.some( function ( Line ) { return Line.Text === 'The debug ended.'; } ) );
		}
		finally { await opened.Close(); }
	} );

	it( 'follows a disk edit, and keeps its view settings between runs', async function ()
	{
		let file = write( root, 'follow.jsonx', Spec.AppendixB() );
		let settings = LIB_PATH.join( root, 'kept', 'tui.json' );
		let opened = await open_model( file, root, { SettingsPath: settings } );
		let model = opened.Model;
		try
		{
			let document = JSON.parse( LIB_FS.readFileSync( file, 'utf8' ) );
			document.Objects.push( { Kind: 'Query', Name: 'Added on disk', DataSource: 'Bookings', Criteria: {} } );
			LIB_FS.writeFileSync( file, JSON.stringify( document, null, '\t' ) );
			await opened.Served.Held.Reload();
			await until( function () { return model.State.Inventory.some( function ( Item ) { return Item.Name === 'Added on disk'; } ); }, 'the reloaded inventory' );
			LIB_ASSERT.ok( model.State.Log.some( function ( Line ) { return Line.Kind === 'reload'; } ) );

			model.NextTheme();
			model.SetScale( 'large' );
			model.TogglePane( 'Log' );
			LIB_ASSERT.deepStrictEqual( JSON.parse( LIB_FS.readFileSync( settings, 'utf8' ) ), { Theme: 'light', Scale: 'large', Collapsed: { Inventory: false, Log: true, Rows: false } } );
		}
		finally { await opened.Close(); }

		let again = await open_model( file, root, { SettingsPath: settings } );
		try
		{
			LIB_ASSERT.deepStrictEqual( again.Model.State.View, { Theme: 'light', Scale: 'large', Collapsed: { Inventory: false, Log: true, Rows: false } } );
		}
		finally { await again.Close(); }
	} );

	it( 'reads a JSON entry\'s noun and the body which replaces one, without a server', function ()
	{
		LIB_ASSERT.strictEqual( Model.NounOf( { Kind: 'Update', Name: 'U' } ), 'update' );
		LIB_ASSERT.strictEqual( Model.NounOf( { Name: 'S', AdapterName: 'jsonstor-memory' } ), 'datasource' );
		LIB_ASSERT.strictEqual( Model.NounOf( { Name: 'T', Process: 'P', On: [ 'Insert' ] } ), 'trigger' );
		LIB_ASSERT.strictEqual( Model.NounOf( { Kind: 'Nonsense', Name: 'N' } ), null );
		LIB_ASSERT.deepStrictEqual( Model.ReplacementBody( { Name: 'Q', Kind: 'Query', DataSource: 'S', Criteria: {} }, { Name: 'Q', Kind: 'Query', DataSource: 'S' } ),
			{ Name: 'Q', Kind: 'Query', DataSource: 'S', Criteria: null } );
		LIB_ASSERT.deepStrictEqual( Model.JsonContext( '{ "DataSource": "Bo' ), { In: 'string', Prefix: 'Bo', Key: 'DataSource', IsKey: false } );
		LIB_ASSERT.deepStrictEqual( Model.JsonContext( '{ "A": 1, "Ke' ), { In: 'string', Prefix: 'Ke', Key: null, IsKey: true } );
		LIB_ASSERT.deepStrictEqual( Model.JsonContext( '{ "A": "done" ' ), { In: 'none' } );
	} );

} );
