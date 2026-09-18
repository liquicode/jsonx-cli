'use strict';

/*
	`--json <object>` on validate, plan, explain and run (cut 7): a draft evaluated as if it were in the
	file, through the bin, against Appendix B. The mechanism itself is Draft.test.js.
*/

const LIB_ASSERT = require( 'assert' );
const LIB_CHILD_PROCESS = require( 'child_process' );
const LIB_FS = require( 'fs' );
const LIB_OS = require( 'os' );
const LIB_PATH = require( 'path' );
const { describe, it, before, after } = require( 'node:test' );

const Spec = require( './fixtures/Spec.js' );

const BIN = LIB_PATH.resolve( __dirname, '..', 'bin', 'jsonx.js' );

// Spec section 10's example, as Appendix B carries it.
const CONFIRM = { Kind: 'Update', Name: 'Confirm the bookings with good seeing', DataSource: 'Bookings', Criteria: { Status: 'requested', Seeing: { $lt: 2.5 } }, Update: { $set: { Status: 'confirmed' } } };


//---------------------------------------------------------------------
function run( Argv, Cwd )
{
	let env = Object.assign( {}, process.env );
	delete env.JSONX_FILE;
	let result = LIB_CHILD_PROCESS.spawnSync( process.execPath, [ BIN ].concat( Argv ), { cwd: Cwd, env: env, encoding: 'utf8' } );
	return { Code: result.status, Stdout: result.stdout, Stderr: result.stderr };
}

function draft( Object_, Changes )
{
	let entry = JSON.parse( JSON.stringify( CONFIRM ) );
	Object.assign( entry, Object_ || {} );
	if ( Changes ) { Object.assign( entry, Changes ); }
	return JSON.stringify( entry );
}


//---------------------------------------------------------------------
describe( 'A draft through validate, plan, explain and run', function ()
{

	let root = null;
	let text_before = null;

	before( function ()
	{
		root = LIB_FS.mkdtempSync( LIB_PATH.join( LIB_OS.tmpdir(), 'jsonx-draft-' ) );
		text_before = JSON.stringify( Spec.AppendixB(), null, '\t' );
		LIB_FS.writeFileSync( LIB_PATH.join( root, 'observatory.jsonx' ), text_before );
	} );

	after( function ()
	{
		// Nothing a draft does writes the file.
		LIB_ASSERT.strictEqual( LIB_FS.readFileSync( LIB_PATH.join( root, 'observatory.jsonx' ), 'utf8' ), text_before );
		LIB_FS.rmSync( root, { recursive: true, force: true } );
	} );


	//---------------------------------------------------------------------
	it( 'validate --json answers the draft\'s findings pathed Draft, with the report labelled [draft], and the exit code of the findings', function ()
	{
		let clean = run( [ 'validate', '--json', draft( { Name: 'Confirm now' } ) ], root );
		LIB_ASSERT.strictEqual( clean.Code, 0, clean.Stderr );
		LIB_ASSERT.deepStrictEqual( JSON.parse( clean.Stdout ), [] );
		LIB_ASSERT.match( clean.Stderr, /observatory\.jsonx \[draft\]: 0 errors, 0 warnings, 0 notes/ );

		let warned = run( [ 'validate', '--json', draft( { Name: 'Empty', Update: {} } ) ], root );
		LIB_ASSERT.strictEqual( warned.Code, 0, warned.Stderr );
		let findings = JSON.parse( warned.Stdout );
		LIB_ASSERT.strictEqual( findings.length, 1 );
		LIB_ASSERT.strictEqual( findings[ 0 ].Path, 'Draft.Update' );
		LIB_ASSERT.strictEqual( run( [ 'validate', '--strict', '--json', draft( { Name: 'Empty', Update: {} } ) ], root ).Code, 3 );

		let wrong = run( [ 'validate', '--json', draft( { Name: 'Bad', DataSource: 'Nowhere' } ) ], root );
		LIB_ASSERT.strictEqual( wrong.Code, 3 );
		LIB_ASSERT.strictEqual( JSON.parse( wrong.Stdout )[ 0 ].Path, 'Draft.DataSource' );

		// The same object as the file's entry stands in for it: one note, no error.
		let same = run( [ 'validate', '--json', draft() ], root );
		LIB_ASSERT.strictEqual( same.Code, 0, same.Stderr );
		let notes = JSON.parse( same.Stdout );
		LIB_ASSERT.strictEqual( notes.length, 1 );
		LIB_ASSERT.strictEqual( notes[ 0 ].Severity, 'note' );
		LIB_ASSERT.match( notes[ 0 ].Message, /is in the file; the draft is checked in its place/ );
	} );

	it( 'plan --json plans the draft as by name, its findings pathed Draft', function ()
	{
		let by_name = run( [ 'plan', 'Confirm the bookings with good seeing', '-q' ], root );
		let as_draft = run( [ 'plan', '--json', draft(), '-q' ], root );
		LIB_ASSERT.strictEqual( as_draft.Code, 0, as_draft.Stderr );
		let named = JSON.parse( by_name.Stdout );
		let drafted = JSON.parse( as_draft.Stdout );
		LIB_ASSERT.deepStrictEqual( drafted.Tree, named.Tree );
		LIB_ASSERT.deepStrictEqual( drafted.DataSources, named.DataSources );
		LIB_ASSERT.strictEqual( drafted.Findings[ 0 ].Path, 'Draft' );
		LIB_ASSERT.match( drafted.Findings[ 0 ].Message, /is in the file; the draft is checked in its place/ );

		let wrong = run( [ 'plan', '--json', draft( { Name: 'Bad', DataSource: 'Nowhere' } ), '-q' ], root );
		LIB_ASSERT.strictEqual( wrong.Code, 3 );
		LIB_ASSERT.ok( JSON.parse( wrong.Stdout ).Findings.some( function ( Finding ) { return Finding.Path === 'Draft.DataSource'; } ) );

		let not_object = run( [ 'plan', '--json', JSON.stringify( { Name: 'Scratch', AdapterName: 'jsonstor-memory' } ) ], root );
		LIB_ASSERT.strictEqual( not_object.Code, 2 );
		LIB_ASSERT.match( not_object.Stderr, /The draft is not an object/ );
	} );

	it( 'explain --json explains the draft in English, named as it names itself or (ad hoc)', function ()
	{
		let by_name = run( [ 'explain', 'Confirm the bookings with good seeing', '-q' ], root );
		let as_draft = run( [ 'explain', '--json', draft(), '-q' ], root );
		LIB_ASSERT.strictEqual( as_draft.Code, 0, as_draft.Stderr );
		LIB_ASSERT.deepStrictEqual( JSON.parse( as_draft.Stdout ), JSON.parse( by_name.Stdout ) );

		let nameless = JSON.parse( draft() );
		delete nameless.Name;
		let unnamed = run( [ 'explain', '--json', JSON.stringify( nameless ) ], root );
		LIB_ASSERT.strictEqual( unnamed.Code, 0, unnamed.Stderr );
		LIB_ASSERT.strictEqual( JSON.parse( unnamed.Stdout ).Name, '(ad hoc)' );
		LIB_ASSERT.match( unnamed.Stderr, /set Status to "confirmed"/ );

		let source = run( [ 'explain', '--json', JSON.stringify( { Name: 'Scratch', AdapterName: 'jsonstor-memory' } ), '-q' ], root );
		LIB_ASSERT.strictEqual( source.Code, 0, source.Stderr );
		LIB_ASSERT.strictEqual( JSON.parse( source.Stdout ).Kind, 'DataSource' );
	} );

	it( 'refuses a name beside --json, and neither, with exit 2', function ()
	{
		let cases = [
			[ 'validate', 'Bookings', '--json', draft() ],
			[ 'plan', 'Prepare the season', '--json', draft() ],
			[ 'explain', 'Bookings', '--json', draft() ],
			[ 'run', 'Prepare the season', '--json', draft() ],
			[ 'plan' ],
			[ 'explain' ],
			[ 'run' ],
		];
		for ( let index = 0; index < cases.length; index++ )
		{
			let result = run( cases[ index ], root );
			LIB_ASSERT.strictEqual( result.Code, 2, cases[ index ].join( ' ' ) + ': ' + result.Stderr );
			LIB_ASSERT.match( result.Stderr, /do not name one as well|Name one (object|entry), or pass --json/ );
		}
		// validate with neither is still the whole file.
		LIB_ASSERT.strictEqual( run( [ 'validate' ], root ).Code, 0 );
	} );

	it( 'run --json runs a draft unsaved, with the same result as by name, and its own name in the report', function ()
	{
		let by_name = run( [ 'run', 'Prepare the season', '-q' ], root );
		let season = Spec.AppendixB().Objects[ 6 ];
		season.Name = 'Season, drafted';
		let as_draft = run( [ 'run', '--json', JSON.stringify( season ) ], root );
		LIB_ASSERT.strictEqual( as_draft.Code, 0, as_draft.Stderr );
		LIB_ASSERT.deepStrictEqual( JSON.parse( as_draft.Stdout ), JSON.parse( by_name.Stdout ) );
		LIB_ASSERT.ok( as_draft.Stderr.startsWith( 'Season, drafted  Process  ran once' ), as_draft.Stderr );
	} );

	it( 'run --json refuses a draft with errors, exit 3, running nothing; and a draft which is not an object, exit 2', function ()
	{
		let wrong = run( [ 'run', '--json', draft( { Name: 'Bad', DataSource: 'Nowhere' } ) ], root );
		LIB_ASSERT.strictEqual( wrong.Code, 3 );
		LIB_ASSERT.strictEqual( wrong.Stdout, '' );
		LIB_ASSERT.match( wrong.Stderr, /error   Draft\.DataSource/ );
		LIB_ASSERT.match( wrong.Stderr, /The draft has 1 error; nothing ran\./ );

		let not_object = run( [ 'run', '--json', JSON.stringify( { Name: 'Scratch', AdapterName: 'jsonstor-memory' } ) ], root );
		LIB_ASSERT.strictEqual( not_object.Code, 2 );
		LIB_ASSERT.match( not_object.Stderr, /The draft is not an object/ );
	} );

	it( 'run --json honours --changes on an Update draft, and refuses it on another kind', function ()
	{
		let bind = 'Bookings=jsonstor-jsonfile:{"Path":"bookings.json"}';
		let seeded = run( [ 'run', 'Three bookings', '-q', '--bind', bind ], root );
		LIB_ASSERT.strictEqual( seeded.Code, 0, seeded.Stderr );

		let changed = run( [ 'run', '--json', draft( { Name: 'Confirm, drafted' } ), '--changes', '-q', '--bind', bind ], root );
		LIB_ASSERT.strictEqual( changed.Code, 0, changed.Stderr );
		let result = JSON.parse( changed.Stdout );
		LIB_ASSERT.strictEqual( result.Selected, 1 );
		LIB_ASSERT.strictEqual( result.Changed, 1 );
		LIB_ASSERT.strictEqual( result.Changes.length, 1 );
		LIB_ASSERT.strictEqual( result.Changes[ 0 ].After.Status, 'confirmed' );

		let season = Spec.AppendixB().Objects[ 6 ];
		let refused = run( [ 'run', '--json', JSON.stringify( season ), '--changes' ], root );
		LIB_ASSERT.strictEqual( refused.Code, 2 );
		LIB_ASSERT.match( refused.Stderr, /has an effect only on an Update/ );
	} );

} );
