'use strict';

/*
	What a front end decides (cut 5, step 1: src/Front/), with no screen, no socket and no server. The TUI's
	model calls these, and the WebSocket answers them for the Web UI, so both decide alike.
*/

const LIB_ASSERT = require( 'assert' );
const LIB_FS = require( 'fs' );
const LIB_OS = require( 'os' );
const LIB_PATH = require( 'path' );
const { describe, it, before, after } = require( 'node:test' );

const Parser = require( '../src/CommandLine/Parser.js' );
const InputJson = require( '../src/CommandLine/InputJson.js' );
const Validate = require( '../src/Validate/Validate.js' );
const Inventory = require( '../src/Front/Inventory.js' );
const Entry = require( '../src/Front/Entry.js' );
const Line = require( '../src/Front/Line.js' );
const Completion = require( '../src/Front/Completion.js' );
const Protocol = require( '../modes/mcp/Protocol.js' );
const Commands = require( '../commands/jsonx.js' );
const jsonx_cli = require( '../src/jsonx-cli.js' );
const Spec = require( './fixtures/Spec.js' );


const TREE = Commands.TREE;


//---------------------------------------------------------------------
describe( 'Front', function ()
{
	let root = null;
	let criteria_file = null;
	let document = null;

	before( function ()
	{
		root = LIB_FS.mkdtempSync( LIB_PATH.join( LIB_OS.tmpdir(), 'jsonx-front-' ) );
		criteria_file = LIB_PATH.join( root, 'criteria.json' );
		LIB_FS.writeFileSync( criteria_file, '{ "Status": "confirmed" }' );
		document = Spec.AppendixB();
	} );

	after( function ()
	{
		LIB_FS.rmSync( root, { recursive: true, force: true } );
	} );


	it( 'is part of the library', function ()
	{
		LIB_ASSERT.strictEqual( jsonx_cli.Library.Front.Inventory, Inventory );
		LIB_ASSERT.strictEqual( jsonx_cli.Library.Front.Entry, Entry );
		LIB_ASSERT.strictEqual( jsonx_cli.Library.Front.Line, Line );
		LIB_ASSERT.strictEqual( jsonx_cli.Library.Front.Completion, Completion );
		// One list judges what changes something, for MCP's hints and a front end's menu.
		LIB_ASSERT.strictEqual( Protocol.DESTRUCTIVE_WORDS, Inventory.DESTRUCTIVE_WORDS );
	} );


	it( 'reads a typed line as what sending it would do', function ()
	{
		let invoke = Line.ReadLine( TREE, 'jsonx data find Bookings --max 5' );
		LIB_ASSERT.strictEqual( invoke.Outcome, 'invoke' );
		LIB_ASSERT.deepStrictEqual( invoke.Document, InputJson.ToDocument( InputJson.ParseInvocation( TREE, [ 'data', 'find', 'Bookings', '--max', '5' ] ) ) );
		LIB_ASSERT.strictEqual( invoke.Label, 'data find Bookings --max 5' );

		let unclosed = Line.ReadLine( TREE, 'run "Prepare the season' );
		LIB_ASSERT.strictEqual( unclosed.Outcome, 'usage' );
		LIB_ASSERT.match( unclosed.Findings[ 0 ].Message, /quote is not closed/ );
		let open_json = Line.ReadLine( TREE, 'data find Bookings --criteria {"Status":' );
		LIB_ASSERT.match( open_json.Findings[ 0 ].Message, /The JSON beginning \{ is not closed/ );
		let bad = Line.ReadLine( TREE, 'run "Prepare the season" --bogus' );
		LIB_ASSERT.strictEqual( bad.Outcome, 'usage' );
		LIB_ASSERT.match( bad.Findings[ 0 ].Message, /bogus/ );

		LIB_ASSERT.strictEqual( Line.ReadLine( TREE, 'datasource' ).Outcome, 'help' );
		let help = Line.ReadLine( TREE, 'run --help' );
		LIB_ASSERT.strictEqual( help.Outcome, 'help' );
		LIB_ASSERT.match( help.Text, /Usage: jsonx run <name>/ );

		let refused = Line.ReadLine( TREE, 'serve --api' );
		LIB_ASSERT.strictEqual( refused.Outcome, 'refused' );
		LIB_ASSERT.match( refused.Findings[ 0 ].Message, /\[serve\] is not run from a front end\./ );
		LIB_ASSERT.match( Line.ReadLine( TREE, 'tui', null, { Front: 'the Web UI' } ).Findings[ 0 ].Message, /is not run from the Web UI\./ );

		let debug = Line.ReadLine( TREE, 'debug "Prepare the season"' );
		LIB_ASSERT.strictEqual( debug.Outcome, 'debug' );
		LIB_ASSERT.strictEqual( debug.Document.process, 'Prepare the season' );

		let confirm = Line.ReadLine( TREE, 'data delete Bookings --criteria {}' );
		LIB_ASSERT.strictEqual( confirm.Outcome, 'confirm' );
		LIB_ASSERT.ok( !/Confirm with|^Refused/.test( confirm.Message ), confirm.Message );
		LIB_ASSERT.strictEqual( confirm.Document.yes, undefined );
		// Saved, nothing runs, so nothing to confirm; confirmed already, nothing to ask.
		LIB_ASSERT.strictEqual( Line.ReadLine( TREE, 'data delete Bookings --criteria {} --save "Clear"' ).Outcome, 'invoke' );
		LIB_ASSERT.strictEqual( Line.ReadLine( TREE, 'data delete Bookings --criteria {} --yes' ).Outcome, 'invoke' );
	} );


	it( 'reads @file on the local machine, and a served line reads no file and no standard input', function ()
	{
		let local = Line.ReadLine( TREE, 'data find Bookings --criteria @' + criteria_file );
		LIB_ASSERT.strictEqual( local.Outcome, 'invoke' );
		LIB_ASSERT.deepStrictEqual( local.Document.criteria, { Status: 'confirmed' } );

		let served_file = Line.ReadLine( TREE, 'data find Bookings --criteria @' + criteria_file, Line.ServedIo() );
		LIB_ASSERT.strictEqual( served_file.Outcome, 'usage' );
		LIB_ASSERT.ok( served_file.Findings[ 0 ].Message.includes( Line.SERVED_REFUSAL ), served_file.Findings[ 0 ].Message );
		LIB_ASSERT.ok( !served_file.Findings[ 0 ].Message.includes( 'confirmed' ) );

		let served_stdin = Line.ReadLine( TREE, 'data find Bookings --criteria -', Line.ServedIo() );
		LIB_ASSERT.strictEqual( served_stdin.Outcome, 'usage' );
		LIB_ASSERT.ok( served_stdin.Findings[ 0 ].Message.includes( Line.SERVED_REFUSAL ), served_stdin.Findings[ 0 ].Message );

		// Inline JSON is what a served line takes.
		LIB_ASSERT.deepStrictEqual( Line.ReadLine( TREE, 'data find Bookings --criteria {"Hours":8}', Line.ServedIo() ).Document.criteria, { Hours: 8 } );

		// Completion lists no directory of the server's.
		LIB_FS.writeFileSync( LIB_PATH.join( root, 'other.jsonx' ), '{}' );
		let io = Line.ServedIo();
		io.Cwd = root;
		LIB_ASSERT.deepStrictEqual( Completion.CompleteText( TREE, 'validate --file ', io, { Document: document } ).Candidates, [] );
		let local_io = Parser.DefaultIo();
		local_io.Cwd = root;
		LIB_ASSERT.deepStrictEqual( Completion.CompleteText( TREE, 'validate --file ', local_io, { Document: document } ).Candidates, [ 'other.jsonx' ] );
	} );


	it( 'reads a typed entry, and the add or set which saves it', function ()
	{
		LIB_ASSERT.deepStrictEqual( Entry.ReadEntry( '  ', document ), { Mode: 'empty', Syntax: null, Target: null } );
		LIB_ASSERT.deepStrictEqual( Entry.ReadEntry( 'run x', document ), { Mode: 'command', Syntax: null, Target: null } );
		LIB_ASSERT.strictEqual( Entry.ReadEntry( '{ "Kind": ', document ).Syntax !== null, true );
		LIB_ASSERT.match( Entry.ReadEntry( '{ "Name": "X" }', document ).Syntax.Message, /not an entry/ );
		LIB_ASSERT.match( Entry.ReadEntry( '{ "Kind": "Query" }', document ).Syntax.Message, /needs a Name/ );

		let added = Entry.ReadEntry( '{ "Kind": "Query", "Name": "Long nights", "DataSource": "Bookings", "Criteria": {} }', document );
		LIB_ASSERT.deepStrictEqual( added.Target, { Noun: 'query', Name: 'Long nights', Exists: false, Entry: { Kind: 'Query', Name: 'Long nights', DataSource: 'Bookings', Criteria: {} }, Current: null } );
		LIB_ASSERT.deepStrictEqual( Entry.EditInvocation( added.Target ), { Command: [ 'query', 'add' ], json: added.Target.Entry } );
		LIB_ASSERT.deepStrictEqual( Entry.EditInvocation( added.Target, true ), { Command: [ 'query', 'add' ], json: added.Target.Entry, check: true } );

		// An existing entry typed without a field it has: set removes that field.
		let current = document.Objects.find( function ( Each ) { return Each.Kind === 'Update'; } );
		let typed = Object.assign( {}, current );
		delete typed.Update;
		let replaced = Entry.ReadEntry( JSON.stringify( typed ), document );
		LIB_ASSERT.strictEqual( replaced.Target.Exists, true );
		LIB_ASSERT.deepStrictEqual( replaced.Target.Current, current );
		let set = Entry.EditInvocation( replaced.Target );
		LIB_ASSERT.deepStrictEqual( set.Command, [ 'update', 'set' ] );
		LIB_ASSERT.strictEqual( set.name, current.Name );
		LIB_ASSERT.strictEqual( set.json.Update, null );
		LIB_ASSERT.deepStrictEqual( set.json.Criteria, current.Criteria );
	} );


	it( 'completes a command line and JSON', function ()
	{
		let run = Completion.CompleteText( TREE, 'run "Prep', null, { Document: document } );
		LIB_ASSERT.strictEqual( run.Json, false );
		LIB_ASSERT.ok( run.Candidates.includes( 'Prepare the season' ), JSON.stringify( run ) );
		LIB_ASSERT.ok( Completion.CompleteText( TREE, 'data ', null, { Document: document } ).Candidates.includes( 'find' ) );

		let source = Completion.CompleteText( TREE, '{ "Kind": "Query", "DataSource": "Bo', null, { Document: document } );
		LIB_ASSERT.deepStrictEqual( source, { Prefix: 'Bo', Candidates: [ 'Bookings' ], Json: true } );
		let call = Completion.CompleteText( TREE, '{ "$call": { "Name": "Prep', null, { Document: document } );
		LIB_ASSERT.deepStrictEqual( call.Candidates, [ 'Prepare the season' ] );
		LIB_ASSERT.deepStrictEqual( Completion.CompleteText( TREE, '{ "Criteria": { "Hours": { "$g', null, { Document: document, Operators: [ '$gt', '$gte', '$lt' ] } ).Candidates, [ '$gt', '$gte' ] );

		// Fields are the caller's: asked by data source name, and none known is no candidate.
		let asked = [];
		let fields = function ( Name ) { asked.push( Name ); return [ 'Hours', 'Observer' ]; };
		LIB_ASSERT.deepStrictEqual( Completion.CompleteText( TREE, '{ "DataSource": "Bookings", "Criteria": { "Ho', null, { Document: document, Fields: fields } ).Candidates, [ 'Hours' ] );
		LIB_ASSERT.deepStrictEqual( asked, [ 'Bookings' ] );
		LIB_ASSERT.deepStrictEqual( Completion.CompleteText( TREE, '{ "DataSource": "Bookings", "Criteria": { "Ho', null, { Document: document } ).Candidates, [] );

		// A JSON option still being typed completes as JSON does.
		let option = Completion.CompleteText( TREE, 'data find Bookings --criteria {"$an', null, { Document: document, Operators: [ '$and' ] } );
		LIB_ASSERT.deepStrictEqual( option, { Prefix: '$an', Candidates: [ '$and' ], Json: true } );
	} );


	it( 'lists the inventory with badges, and an entry\'s actions from the tree', function ()
	{
		let broken = JSON.parse( JSON.stringify( document ) );
		broken.Objects[ 0 ].DataSource = 'Nowhere';
		let items = Inventory.InventoryOf( broken, Validate.ValidateFile( broken ) );
		LIB_ASSERT.strictEqual( items.length, document.DataSources.length + document.Objects.length + document.Triggers.length );
		LIB_ASSERT.deepStrictEqual( items[ 0 ], { Section: 'DataSources', Index: 0, Kind: 'DataSource', Name: 'Telescopes', Label: 'jsonstor-memory', Severity: null } );
		let first_object = items.find( function ( Item ) { return Item.Section === 'Objects' && Item.Index === 0; } );
		LIB_ASSERT.strictEqual( first_object.Severity, 'error' );

		let bookings = items.find( function ( Item ) { return Item.Name === 'Bookings'; } );
		let actions = Inventory.ActionsFor( TREE, bookings );
		let by = function ( Command ) { return actions.find( function ( Each ) { return Each.Command === Command; } ); };
		LIB_ASSERT.strictEqual( actions[ 0 ].Command, 'datasource find' );
		LIB_ASSERT.strictEqual( by( 'datasource find' ).Sends, true );
		LIB_ASSERT.strictEqual( by( 'datasource drop' ).Sends, false );
		LIB_ASSERT.strictEqual( by( 'datasource update' ).Sends, false );
		LIB_ASSERT.strictEqual( by( 'datasource rename' ).Sends, false );

		let season = items.find( function ( Item ) { return Item.Name === 'Prepare the season'; } );
		let season_actions = Inventory.ActionsFor( TREE, season );
		LIB_ASSERT.deepStrictEqual( season_actions.slice( 0, 2 ).map( function ( Each ) { return Each.Command; } ), [ 'run', 'debug' ] );
		LIB_ASSERT.ok( season_actions.every( function ( Each ) { return !Inventory.NOT_SENT.includes( Each.Path[ 0 ] ); } ) );
		LIB_ASSERT.strictEqual( season_actions.find( function ( Each ) { return Each.Command === 'run'; } ).Sends, true );
	} );

} );
