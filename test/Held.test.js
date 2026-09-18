'use strict';

const LIB_ASSERT = require( 'assert' );
const LIB_FS = require( 'fs' );
const LIB_OS = require( 'os' );
const LIB_PATH = require( 'path' );
const { describe, it, before, after } = require( 'node:test' );

const Held = require( '../src/Session/Held.js' );
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

function hold( File, Extra )
{
	let io = Parser.DefaultIo();
	io.Env = {};
	io.Cwd = LIB_PATH.dirname( File );
	return Held.NewHeld( Object.assign( { Tree: Commands.TREE, File: File, Io: io }, Extra || {} ) );
}

// The report lines at depth 0: one per object a request ran.
function top_lines( Envelope )
{
	return Envelope.Log.filter( function ( Line ) { return /^\S/.test( Line ); } );
}


// Two stores, each read and written by a Process of several calls, so two runs interleave at every
// await unless something orders them; and a trigger whose Process is also run by hand.
function scratch_document()
{
	let steps = function ( Store )
	{
		return [
			{ $call: { Name: 'Add to ' + Store } },
			{ $call: { Name: 'Count', With: { DataSource: Store, Criteria: {} }, Into: 'First' } },
			{ $call: { Name: 'Add to ' + Store } },
			{ $call: { Name: 'Count', With: { DataSource: Store, Criteria: {} }, Into: 'Second' } },
			{ $call: { Name: 'Add to ' + Store } },
			{ $return: '$Second' },
		];
	};
	return {
		DataSources: [
			{ Name: 'Left', AdapterName: 'jsonstor-memory' },
			{ Name: 'Right', AdapterName: 'jsonstor-memory' },
			{ Name: 'Watched', AdapterName: 'jsonstor-memory' },
			{ Name: 'Notes', AdapterName: 'jsonstor-memory' },
		],
		Objects: [
			{ Kind: 'Insert', Name: 'Add to Left', DataSource: 'Left', Documents: [ { Side: 'left' } ] },
			{ Kind: 'Insert', Name: 'Add to Right', DataSource: 'Right', Documents: [ { Side: 'right' } ] },
			{ Kind: 'Process', Name: 'Fill Left', Steps: steps( 'Left' ) },
			{ Kind: 'Process', Name: 'Fill Right', Steps: steps( 'Right' ) },
			{ Kind: 'Query', Name: 'Read notes', DataSource: 'Notes', Criteria: {} },
			{
				Kind: 'Process', Name: 'Note each arrival', DataSource: 'Watched', Criteria: {},
				Steps: [
					{ $call: { Name: 'Read notes', Into: 'Before' } },
					{ $call: { Name: 'Read notes', Into: 'Again' } },
					{ $call: { Name: 'InsertOne', With: { DataSource: 'Notes', Document: { Seen: '$Document.Name' } } } },
				],
			},
		],
		Triggers: [
			{ Name: 'On arrival', On: [ 'Insert' ], Process: 'Note each arrival' },
		],
	};
}


//---------------------------------------------------------------------
describe( 'A held session', function ()
{

	let root = null;
	let observatory = null;
	let scratch = null;
	let broken = null;

	before( function ()
	{
		root = LIB_FS.mkdtempSync( LIB_PATH.join( LIB_OS.tmpdir(), 'jsonx-held-' ) );
		observatory = write( root, 'observatory.jsonx', Spec.AppendixB() );
		scratch = write( root, 'scratch.jsonx', scratch_document() );

		let document = Spec.AppendixB();
		document.Objects.find( function ( Entry ) { return typeof Entry.DataSource === 'string'; } ).DataSource = 'Nowhere';
		broken = write( root, 'broken.jsonx', document );
	} );

	after( function () { LIB_FS.rmSync( root, { recursive: true, force: true } ); } );


	it( 'runs Appendix B through a request, with the report in the envelope', async function ()
	{
		let held = hold( observatory );
		try
		{
			LIB_ASSERT.deepStrictEqual( held.StartFindings.filter( function ( Finding ) { return Finding.Severity === 'error'; } ), [] );
			let envelope = await held.Invoke( { Command: 'run', name: 'Prepare the season' } );
			LIB_ASSERT.strictEqual( envelope.ExitCode, 0, envelope.Log.join( '\n' ) );
			LIB_ASSERT.deepStrictEqual( envelope.Result, [ { Booking: 'b-1', Observer: 'R. Okafor', Dome: 'B' } ] );
			LIB_ASSERT.strictEqual( envelope.Log.length, 7 );
		}
		finally { await held.Release(); }
	} );

	it( 'keeps its data sources open between requests, so a memory store keeps its rows', async function ()
	{
		let held = hold( scratch );
		try
		{
			await held.Invoke( { Command: 'run', name: 'Add to Left' } );
			await held.Invoke( { Command: 'datasource insert', name: 'Left', documents: [ { Side: 'typed' } ] } );
			let counted = await held.Invoke( { Command: 'data count', name: 'Left' } );
			LIB_ASSERT.strictEqual( counted.ExitCode, 0, counted.Log.join( '\n' ) );
			LIB_ASSERT.strictEqual( counted.Result, 2 );
		}
		finally { await held.Release(); }
	} );

	it( 'orders overlapping runs, so neither report nests inside the other', async function ()
	{
		let held = hold( scratch );
		try
		{
			let answers = await Promise.all( [
				held.Invoke( { Command: 'run', name: 'Fill Left' } ),
				held.Invoke( { Command: 'run', name: 'Fill Right' } ),
			] );
			for ( let index = 0; index < answers.length; index++ )
			{
				LIB_ASSERT.strictEqual( answers[ index ].ExitCode, 0, answers[ index ].Log.join( '\n' ) );
				LIB_ASSERT.strictEqual( answers[ index ].Result, 2 );
				LIB_ASSERT.strictEqual( top_lines( answers[ index ] ).length, 1, answers[ index ].Log.join( '\n' ) );
			}
			LIB_ASSERT.ok( answers[ 0 ].Log.every( function ( Line ) { return !/Right/.test( Line ); } ), answers[ 0 ].Log.join( '\n' ) );
			LIB_ASSERT.ok( answers[ 1 ].Log.every( function ( Line ) { return !/Left/.test( Line ); } ), answers[ 1 ].Log.join( '\n' ) );
		}
		finally { await held.Release(); }
	} );

	it( 'fires a trigger for a write which arrives while another request runs the trigger\'s Process', async function ()
	{
		let held = hold( scratch );
		try
		{
			// A document to run over, so the Process run by hand is running while the insert arrives.
			let seeded = await held.Invoke( { Command: 'data insert', name: 'Watched', documents: { Name: 'seed' } } );
			LIB_ASSERT.strictEqual( seeded.ExitCode, 0, seeded.Log.join( '\n' ) );

			let answers = await Promise.all( [
				held.Invoke( { Command: 'run', name: 'Note each arrival' } ),
				held.Invoke( { Command: 'data insert', name: 'Watched', documents: { Name: 'second' } } ),
			] );
			LIB_ASSERT.strictEqual( answers[ 0 ].ExitCode, 0, answers[ 0 ].Log.join( '\n' ) );
			LIB_ASSERT.ok( answers[ 0 ].Log[ 0 ].startsWith( 'Note each arrival  Process  ran 1' ), answers[ 0 ].Log.join( '\n' ) );
			LIB_ASSERT.strictEqual( answers[ 1 ].ExitCode, 0, answers[ 1 ].Log.join( '\n' ) );
			LIB_ASSERT.ok( answers[ 1 ].Log.some( function ( Line ) { return Line.includes( 'trigger [On arrival] Note each arrival' ); } ), answers[ 1 ].Log.join( '\n' ) );

			// The seed's own trigger, the run by hand over the seed, and the second insert's trigger.
			let notes = await held.Invoke( { Command: 'data find', name: 'Notes' } );
			LIB_ASSERT.deepStrictEqual( notes.Result.map( function ( Row ) { return Row.Seen; } ), [ 'seed', 'seed', 'second' ] );
		}
		finally { await held.Release(); }
	} );

	it( 'measures and traces only the requests which ask', async function ()
	{
		let held = hold( scratch );
		try
		{
			let traced = await held.Invoke( { Command: 'data find', name: 'Left', trace: true, verbose: true } );
			LIB_ASSERT.ok( traced.Log.some( function ( Line ) { return Line.includes( '| === ' ); } ), traced.Log.join( '\n' ) );
			LIB_ASSERT.ok( traced.Log.some( function ( Line ) { return /\| FindMany2 on Left: /.test( Line ); } ), traced.Log.join( '\n' ) );

			let plain = await held.Invoke( { Command: 'data find', name: 'Left' } );
			LIB_ASSERT.deepStrictEqual( plain.Log.filter( function ( Line ) { return Line.includes( '|' ); } ), [] );
		}
		finally { await held.Release(); }
	} );

	it( 'refuses what one request cannot change for every client, and what is not served', async function ()
	{
		let held = hold( scratch );
		try
		{
			let refusals = [
				[ { Command: 'validate', file: 'other.jsonx' }, /\[--file\] cannot be given to a served command/ ],
				[ { Command: 'data count', name: 'Left', bind: [ 'Left=jsonstor-memory' ] }, /\[--bind\] cannot be given/ ],
				[ { Command: 'data count', name: 'Left', set: [ 'Left.Settings.X=1' ] }, /\[--set\] cannot be given/ ],
				[ { Command: 'validate', quiet: true }, /\[--quiet\] cannot be given/ ],
				[ { Command: 'validate', output: 'table' }, /\[--output\] cannot be \[table\]/ ],
				[ { Command: 'debug', process: 'Fill Left' }, /^\[debug\] is not served: / ],
				[ { Command: 'completion', shell: 'bash' }, /^\[completion\] is not served: / ],
				[ { Command: '__complete', words: [] }, /^\[__complete\] is not served: / ],
				[ { Command: 'datasource' }, /is a group of commands/ ],
				[ { Command: 'run' }, /Name one object, or pass --json/ ],
				[ { Command: 'no such command' }, /Unknown command/ ],
			];
			for ( let index = 0; index < refusals.length; index++ )
			{
				let envelope = await held.Invoke( refusals[ index ][ 0 ] );
				LIB_ASSERT.strictEqual( envelope.ExitCode, 2, JSON.stringify( refusals[ index ][ 0 ] ) );
				LIB_ASSERT.ok( refusals[ index ][ 1 ].test( envelope.Log.join( '\n' ) ), envelope.Log.join( '\n' ) );
			}

			let json = await held.Invoke( { Command: 'validate', output: 'json' } );
			LIB_ASSERT.strictEqual( json.ExitCode, 0, json.Log.join( '\n' ) );

			let help = await held.Invoke( { Command: 'run', help: true } );
			LIB_ASSERT.strictEqual( help.ExitCode, 0 );
			LIB_ASSERT.ok( help.Result.includes( 'jsonx run' ), help.Result );
		}
		finally { await held.Release(); }
	} );

	it( 'holds a file with errors, runs nothing, and still answers validate', async function ()
	{
		let held = hold( broken );
		try
		{
			LIB_ASSERT.ok( held.StartFindings.some( function ( Finding ) { return Finding.Severity === 'error'; } ) );
			let ran = await held.Invoke( { Command: 'run', name: 'Prepare the season' } );
			LIB_ASSERT.strictEqual( ran.ExitCode, 3 );
			LIB_ASSERT.ok( ran.Log.includes( 'Nothing ran: the file has errors. Run jsonx validate for every finding.' ) );
			let validated = await held.Invoke( { Command: 'validate' } );
			LIB_ASSERT.strictEqual( validated.ExitCode, 3 );
			LIB_ASSERT.ok( validated.Findings.some( function ( Finding ) { return /Nowhere/.test( Finding.Message ); } ) );
		}
		finally { await held.Release(); }
	} );

	it( 'edits the document it holds and the file, so the next request runs the edit', async function ()
	{
		let file = write( root, 'edited.jsonx', scratch_document() );
		let held = hold( file );
		try
		{
			let added = await held.Invoke( { Command: 'query add', json: { Name: 'Read left', DataSource: 'Left', Criteria: {} } } );
			LIB_ASSERT.strictEqual( added.ExitCode, 0, added.Log.join( '\n' ) );
			LIB_ASSERT.ok( JSON.parse( LIB_FS.readFileSync( file, 'utf8' ) ).Objects.some( function ( Entry ) { return Entry.Name === 'Read left'; } ) );

			await held.Invoke( { Command: 'run', name: 'Add to Left' } );
			let ran = await held.Invoke( { Command: 'run', name: 'Read left' } );
			LIB_ASSERT.strictEqual( ran.ExitCode, 0, ran.Log.join( '\n' ) );
			LIB_ASSERT.strictEqual( ran.Result.length, 1 );

			let shown = await held.Invoke( { Command: 'query show', name: 'Read left' } );
			LIB_ASSERT.strictEqual( shown.Result.Name, 'Read left' );
		}
		finally { await held.Release(); }
	} );

	it( 'answers a command which throws with exit 1 and the message, and carries on', async function ()
	{
		let tree = Object.assign( {}, Commands.TREE, {
			Commands: Commands.TREE.Commands.concat( [ { Command: 'explode', Describe: 'Throws.', Handler: async function () { throw new Error( 'on purpose' ); } } ] ),
		} );
		let held = hold( scratch, { Tree: tree } );
		try
		{
			let exploded = await held.Invoke( { Command: 'explode' } );
			LIB_ASSERT.strictEqual( exploded.ExitCode, 1 );
			LIB_ASSERT.ok( exploded.Log.includes( 'The command failed unexpectedly: on purpose' ) );
			let after_it = await held.Invoke( { Command: 'data count', name: 'Left' } );
			LIB_ASSERT.strictEqual( after_it.ExitCode, 0, after_it.Log.join( '\n' ) );
		}
		finally { await held.Release(); }
	} );

	it( 'cannot hold what is not there, or what is not a jsonx file', function ()
	{
		LIB_ASSERT.throws( function () { hold( LIB_PATH.join( root, 'missing.jsonx' ) ); }, Held.HeldError );
		let not_object = LIB_PATH.join( root, 'array.jsonx' );
		LIB_FS.writeFileSync( not_object, '[]' );
		LIB_ASSERT.throws( function () { hold( not_object ); }, /is not a jsonx file/ );
		LIB_ASSERT.throws( function () { hold( scratch, { Binds: [ 'no equals sign' ] } ); }, Held.HeldError );
	} );

} );
