'use strict';

const LIB_ASSERT = require( 'assert' );
const { describe, it } = require( 'node:test' );

const jsongin = require( '@liquicode/jsongin' );
const jsonproc = require( '@liquicode/jsonproc' );

const Draft = require( '../src/File/Draft.js' );
const Verbs = require( '../src/Storage/Verbs.js' );
const Spec = require( './fixtures/Spec.js' );


//---------------------------------------------------------------------
function validate_options()
{
	return { jsongin: jsongin, jsonproc: jsonproc, Env: {} };
}

function update_draft( Name )
{
	let draft = { Kind: 'Update', DataSource: 'Bookings', Criteria: { Status: 'requested' }, Update: { $set: { Status: 'confirmed' } } };
	if ( typeof Name === 'string' ) { draft.Name = Name; }
	return draft;
}


//---------------------------------------------------------------------
describe( 'Draft, an entry evaluated as if it were in the file', function ()
{

	it( 'picks the section by shape: a Kind is an object, an AdapterName a data source, a Process a trigger', function ()
	{
		LIB_ASSERT.strictEqual( Draft.Section( { Kind: 'Query' } ), 'Objects' );
		LIB_ASSERT.strictEqual( Draft.Section( { AdapterName: 'jsonstor-memory' } ), 'DataSources' );
		LIB_ASSERT.strictEqual( Draft.Section( { Process: 'Note a long booking', On: [ 'InsertOne' ] } ), 'Triggers' );
		// A Kind wins over either, and a shape which is none of the three is checked as an object.
		LIB_ASSERT.strictEqual( Draft.Section( { Kind: 'Process', Process: 'x' } ), 'Objects' );
		LIB_ASSERT.strictEqual( Draft.Section( { Name: 'Nothing' } ), 'Objects' );
		LIB_ASSERT.strictEqual( Draft.Section( null ), 'Objects' );
	} );

	it( 'places a copy in a copy: the document is untouched, the draft is found by name, and the path is its position', function ()
	{
		let document = Spec.AppendixB();
		let before = JSON.stringify( document );
		let draft = update_draft( 'Confirm now' );

		let placed = Draft.Place( document, draft );
		LIB_ASSERT.strictEqual( JSON.stringify( document ), before );
		LIB_ASSERT.strictEqual( placed.Name, 'Confirm now' );
		LIB_ASSERT.strictEqual( placed.Section, 'Objects' );
		LIB_ASSERT.strictEqual( placed.Path, 'Objects.' + document.Objects.length );
		LIB_ASSERT.strictEqual( placed.Note, null );
		LIB_ASSERT.deepStrictEqual( placed.Copy.Objects[ document.Objects.length ], placed.Entry );
		LIB_ASSERT.notStrictEqual( placed.Entry, draft );

		let source = Draft.Place( document, { Name: 'Scratch', AdapterName: 'jsonstor-memory' } );
		LIB_ASSERT.strictEqual( source.Path, 'DataSources.' + document.DataSources.length );

		let trigger = Draft.Place( document, { Name: 'Watch', On: [ 'InsertOne' ], Process: 'Note a long booking' } );
		LIB_ASSERT.strictEqual( trigger.Path, 'Triggers.' + document.Triggers.length );
	} );

	it( 'names a nameless draft (ad hoc), and makes the section when the file has none', function ()
	{
		let placed = Draft.Place( { DataSources: [] }, update_draft() );
		LIB_ASSERT.strictEqual( placed.Name, Draft.AD_HOC );
		LIB_ASSERT.strictEqual( placed.Entry.Name, '(ad hoc)' );
		LIB_ASSERT.strictEqual( placed.Path, 'Objects.0' );
		LIB_ASSERT.strictEqual( placed.Copy.Objects.length, 1 );
	} );

	it( 'stands in for an entry of the same section carrying its name, with a note; another section\'s name is appended', function ()
	{
		let document = Spec.AppendixB();
		let placed = Draft.Place( document, update_draft( 'Confirm the bookings with good seeing' ) );
		LIB_ASSERT.strictEqual( placed.Path, 'Objects.2' );
		LIB_ASSERT.strictEqual( placed.Copy.Objects.length, document.Objects.length );
		LIB_ASSERT.deepStrictEqual( placed.Copy.Objects[ 2 ].Criteria, { Status: 'requested' } );
		LIB_ASSERT.strictEqual( placed.Note.Severity, 'note' );
		LIB_ASSERT.strictEqual( placed.Note.Path, 'Draft' );
		LIB_ASSERT.match( placed.Note.Message, /^An Update named \[Confirm the bookings with good seeing\] is in the file; the draft is checked in its place\.$/ );

		// A data source's name on an object: appended, and the file's one-namespace rule reports it.
		let clash = Draft.Place( document, update_draft( 'Bookings' ) );
		LIB_ASSERT.strictEqual( clash.Note, null );
		LIB_ASSERT.strictEqual( clash.Path, 'Objects.' + document.Objects.length );
		let findings = Draft.ValidateDraft( document, update_draft( 'Bookings' ), validate_options() );
		LIB_ASSERT.ok( findings.some( function ( Finding ) { return Finding.Severity === 'error' && /3\.5/.test( Finding.Message ); } ), JSON.stringify( findings ) );
	} );

	it( 'rewrites paths under the draft to Draft, or to a prefix given, and leaves the rest', function ()
	{
		let findings = [
			{ Severity: 'error', Path: 'Objects.7', Message: 'a' },
			{ Severity: 'error', Path: 'Objects.7.Update.$set', Message: 'b' },
			{ Severity: 'error', Path: 'Objects.70', Message: 'c' },
			{ Severity: 'note', Path: '', Message: 'd' },
		];
		LIB_ASSERT.deepStrictEqual( Draft.Rewrite( findings, 'Objects.7' ).map( function ( Finding ) { return Finding.Path; } ), [ 'Draft', 'Draft.Update.$set', 'Objects.70', '' ] );
		LIB_ASSERT.deepStrictEqual( Draft.Rewrite( findings, 'Objects.7', '(ad hoc)' ).map( function ( Finding ) { return Finding.Path; } ), [ '(ad hoc)', '(ad hoc).Update.$set', 'Objects.70', '' ] );
	} );

	it( 'validates a draft with every severity, pathed Draft, and without the note that nothing calls it', function ()
	{
		let document = Spec.AppendixB();

		let clean = Draft.ValidateDraft( document, update_draft( 'Confirm now' ), validate_options() );
		LIB_ASSERT.deepStrictEqual( clean, [] );

		let warned = Draft.ValidateDraft( document, { Kind: 'Update', Name: 'Empty', DataSource: 'Bookings', Criteria: {}, Update: {} }, validate_options() );
		LIB_ASSERT.strictEqual( warned.length, 1, JSON.stringify( warned ) );
		LIB_ASSERT.strictEqual( warned[ 0 ].Severity, 'warning' );
		LIB_ASSERT.strictEqual( warned[ 0 ].Path, 'Draft.Update' );

		let wrong = Draft.ValidateDraft( document, { Kind: 'Update', Name: 'Bad', DataSource: 'Nowhere', Criteria: {}, Update: { $set: { A: 1 } } }, validate_options() );
		LIB_ASSERT.strictEqual( wrong.length, 1, JSON.stringify( wrong ) );
		LIB_ASSERT.strictEqual( wrong[ 0 ].Severity, 'error' );
		LIB_ASSERT.strictEqual( wrong[ 0 ].Path, 'Draft.DataSource' );

		// The file's own findings are not the draft's.
		let broken = Spec.AppendixB();
		broken.Objects[ 3 ].Criteria = [];
		let apart = Draft.ValidateDraft( broken, update_draft( 'Confirm now' ), validate_options() );
		LIB_ASSERT.deepStrictEqual( apart, [] );
	} );

	it( 'puts the stand-in note first, and keeps the callers note for a draft standing in for an entry', function ()
	{
		let document = Spec.AppendixB();
		let findings = Draft.ValidateDraft( document, update_draft( 'Confirm the bookings with good seeing' ), validate_options() );
		LIB_ASSERT.strictEqual( findings[ 0 ].Path, 'Draft' );
		LIB_ASSERT.match( findings[ 0 ].Message, /is in the file; the draft is checked in its place/ );
		LIB_ASSERT.strictEqual( findings.length, 1, JSON.stringify( findings ) );

		// Appendix B calls every object, so an uncalled one is made: standing in for it keeps the note, a fresh
		// draft never carries it.
		let lonely = { DataSources: [ { Name: 'Scratch', AdapterName: 'jsonstor-memory' } ], Objects: [ { Kind: 'Query', Name: 'Lonely', DataSource: 'Scratch', Criteria: {} } ] };
		let standing = Draft.ValidateDraft( lonely, { Kind: 'Query', Name: 'Lonely', DataSource: 'Scratch', Criteria: { A: 1 } }, validate_options() );
		LIB_ASSERT.ok( standing.some( function ( Finding ) { return /14\.3\.2/.test( Finding.Message ); } ), JSON.stringify( standing ) );
		let fresh = Draft.ValidateDraft( lonely, { Kind: 'Query', Name: 'Other', DataSource: 'Scratch', Criteria: { A: 1 } }, validate_options() );
		LIB_ASSERT.deepStrictEqual( fresh, [] );
	} );

	it( 'still answers the storage verbs their errors only, pathed (ad hoc)', function ()
	{
		let document = Spec.AppendixB();
		let built = Verbs.BuildObject( 'update', 'Bookings', { criteria: { A: 1 }, update: { $nope: {} } } );
		let errors = Verbs.ValidateObject( document, built, validate_options() );
		LIB_ASSERT.strictEqual( errors.length, 1, JSON.stringify( errors ) );
		LIB_ASSERT.strictEqual( errors[ 0 ].Path, '(ad hoc).Update' );
		LIB_ASSERT.strictEqual( errors[ 0 ].Severity, 'error' );

		// A built object standing in for an entry of the file: the note is not an error.
		let same = Verbs.BuildObject( 'find', 'Bookings', { criteria: {} }, 'Confirm the bookings with good seeing' );
		LIB_ASSERT.deepStrictEqual( Verbs.ValidateObject( document, same, validate_options() ), [] );
	} );

} );
