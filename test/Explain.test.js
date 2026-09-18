'use strict';

const LIB_ASSERT = require( 'assert' );
const { describe, it } = require( 'node:test' );

const jsongin = require( '@liquicode/jsongin' );
const jsonproc = require( '@liquicode/jsonproc' );

const Explain = require( '../src/Explain/Explain.js' );
const Names = require( '../src/File/Names.js' );
const Spec = require( './fixtures/Spec.js' );


//---------------------------------------------------------------------
// ***The coverage tests walk jsongin's and jsonproc's own tables***, so an operator added to an
// engine fails this suite until it has a reading, rather than quietly rendering as its own name.

describe( 'Explain: operator coverage', function ()
{

	it( 'has a phrase for every jsongin query operator', function ()
	{
		let missing = Object.keys( jsongin.QueryOperators ).filter( function ( Operator )
		{
			return ( typeof Explain.QUERY_PHRASES[ Operator ] !== 'function' )
				&& ( typeof Explain.JOIN_PHRASES[ Operator ] !== 'string' )
				&& ( typeof Explain.STANDALONE_PHRASES[ Operator ] !== 'function' );
		} );
		LIB_ASSERT.deepStrictEqual( missing, [] );
	} );

	it( 'has a phrase for every jsongin update operator', function ()
	{
		let missing = Object.keys( jsongin.UpdateOperators ).filter( function ( Operator ) { return typeof Explain.UPDATE_PHRASES[ Operator ] !== 'function'; } );
		LIB_ASSERT.deepStrictEqual( missing, [] );
	} );

	it( 'has a phrase for every jsonproc step operator', function ()
	{
		// Asserted rather than guarded: a guard would let this pass by finding nothing.
		let names = Object.keys( jsonproc.StepOperators );
		LIB_ASSERT.ok( names.length > 0 );
		let missing = names.filter( function ( Operator ) { return typeof Explain.STEP_PHRASES[ Operator ] !== 'function'; } );
		LIB_ASSERT.deepStrictEqual( missing, [] );
	} );

	it( 'renders every query operator without its own name', function ()
	{
		let operands = { $mod: [ 4, 1 ], $in: [ 1, 2 ], $nin: [ 1, 2 ], $all: [ 1, 2 ], $size: 2, $exists: true, $elemMatch: { A: 1 }, $not: { $gt: 1 } };
		let operators = Object.keys( Explain.QUERY_PHRASES );
		for ( let index = 0; index < operators.length; index++ )
		{
			let operator = operators[ index ];
			let criteria = { Field: {} };
			criteria.Field[ operator ] = ( typeof operands[ operator ] === 'undefined' ) ? 1 : operands[ operator ];
			let text = Explain.ExplainCriteria( criteria );
			LIB_ASSERT.ok( text.length > 0, operator + ' rendered nothing.' );
			LIB_ASSERT.ok( !text.includes( operator ), operator + ' rendered as its own name.' );
		}
	} );

	it( 'renders every update operator without its own name', function ()
	{
		let operators = Object.keys( Explain.UPDATE_PHRASES );
		for ( let index = 0; index < operators.length; index++ )
		{
			let update = {};
			update[ operators[ index ] ] = { Field: 1 };
			let text = Explain.ExplainUpdateDocument( update );
			LIB_ASSERT.ok( !text.includes( operators[ index ] ), operators[ index ] + ' rendered as its own name.' );
		}
	} );

} );


//---------------------------------------------------------------------
describe( 'Explain: criteria and update documents', function ()
{

	it( 'reads an empty criteria as matching everything', function ()
	{
		LIB_ASSERT.strictEqual( Explain.ExplainCriteria( {} ), 'Every document matches.' );
		LIB_ASSERT.strictEqual( Explain.ExplainCriteria( null ), 'Every document matches.' );
	} );

	it( 'quotes a string so that 5 and "5" read differently', function ()
	{
		LIB_ASSERT.strictEqual( Explain.ExplainCriteria( { A: 5 } ), 'A is 5.' );
		LIB_ASSERT.strictEqual( Explain.ExplainCriteria( { A: '5' } ), 'A is "5".' );
	} );

	it( 'does not capitalize a field name to start the sentence', function ()
	{
		LIB_ASSERT.strictEqual( Explain.ExplainCriteria( { total: { $gt: 2000 } } ), 'total is greater than 2000.' );
	} );

	it( 'reads joins, lists and two operators on one field', function ()
	{
		LIB_ASSERT.strictEqual( Explain.ExplainCriteria( { $or: [ { A: 1 }, { B: 2 } ] } ), '(A is 1) or (B is 2).' );
		LIB_ASSERT.strictEqual( Explain.ExplainCriteria( { A: { $in: [ 1, 2, 3 ] } } ), 'A is one of 1, 2 or 3.' );
		LIB_ASSERT.strictEqual( Explain.ExplainCriteria( { Total: { $gt: 100, $lt: 900 } } ), 'Total is greater than 100 and is less than 900.' );
	} );

	it( 'reads update operators in document order', function ()
	{
		LIB_ASSERT.strictEqual( Explain.ExplainUpdateDocument( { $set: { Vip: true }, $inc: { Visits: 1 } } ), 'Set Vip to true then increase Visits by 1.' );
		LIB_ASSERT.strictEqual( Explain.ExplainUpdateDocument( {} ), 'Nothing changes.' );
	} );

	it( 'reads a string beginning with $ as a string outside a step', function ()
	{
		LIB_ASSERT.strictEqual( Explain.ExplainCriteria( { Price: '$5' } ), 'Price is "$5".' );
	} );

} );


//---------------------------------------------------------------------
describe( 'Explain: steps', function ()
{

	it( 'reads a host call by its storage parameters, with a field reference unquoted', function ()
	{
		let text = Explain.ExplainStep( { $call: { Name: 'FindOne', With: { DataSource: 'Telescopes', Criteria: { Name: '$Document.Telescope' } }, Into: 'Telescope' } } );
		LIB_ASSERT.strictEqual( text, 'Call FindOne on "Telescopes" where Name is $Document.Telescope, and put the answer at "Telescope".' );
	} );

	it( 'reads what $literal holds as written', function ()
	{
		let text = Explain.ExplainStep( { $call: { Name: 'UpdateMany', With: {
			DataSource: 'Bookings',
			Criteria: { $literal: { Hours: { $gt: 6 }, Code: '$x' } },
			Updates: { $literal: { $set: { Long: true } } },
		} } } );
		LIB_ASSERT.strictEqual( text, 'Call UpdateMany on "Bookings" where Hours is greater than 6 and Code is "$x", to set Long to true.' );
	} );

	it( 'reads a call naming an object by its kind, when the file is given', function ()
	{
		let document = Spec.AppendixB();
		LIB_ASSERT.strictEqual(
			Explain.ExplainStep( { $call: { Name: 'Drop the cancelled bookings' } }, document ),
			'Run the Delete "Drop the cancelled bookings".' );
		LIB_ASSERT.match( Explain.ExplainStep( { $call: { Name: 'Nothing here' } }, document ), /neither a host function nor an object/ );
		LIB_ASSERT.match( Explain.ExplainStep( { $call: { Name: 'Drop the cancelled bookings', With: { A: 1 } } }, document ), /With is refused/ );
	} );

	it( 'says so for an unknown operator and for a step with two', function ()
	{
		LIB_ASSERT.match( Explain.ExplainStep( { $nosuch: {} } ), /unknown step operator \$nosuch/ );
		LIB_ASSERT.match( Explain.ExplainStep( { $do: { a: 1 }, $return: 1 } ), /does not read/ );
	} );

} );


//---------------------------------------------------------------------
describe( 'Explain: entries', function ()
{

	it( 'explains every Appendix B entry with no operator left unphrased', function ()
	{
		let document = Spec.AppendixB();
		let operators = Object.keys( jsongin.QueryOperators ).concat( Object.keys( jsongin.UpdateOperators ), Object.keys( jsonproc.StepOperators ) );
		let entries = Names.Entries( document );
		LIB_ASSERT.ok( entries.length === 12 );

		for ( let index = 0; index < entries.length; index++ )
		{
			let explained = Explain.ExplainEntry( document, entries[ index ].Name );
			let text = explained.Lines.join( '\n' );
			LIB_ASSERT.ok( !/unknown|neither/.test( text ), entries[ index ].Name + ': ' + text );
			for ( let operator = 0; operator < operators.length; operator++ )
			{
				LIB_ASSERT.ok( !text.includes( operators[ operator ] + '"' ) && !text.includes( operators[ operator ] + ':' ), entries[ index ].Name + ' shows ' + operators[ operator ] );
			}
		}
	} );

	it( 'numbers the steps of a Process beneath its heading', function ()
	{
		let explained = Explain.ExplainEntry( Spec.AppendixB(), 'Prepare the season' );
		LIB_ASSERT.strictEqual( explained.Kind, 'Process' );
		LIB_ASSERT.deepStrictEqual( explained.Lines, [
			'Run these steps once, from the input it is given or {}:',
			'1. Run the Insert "Two telescopes".',
			'2. Run the Insert "Three bookings".',
			'3. Run the Update "Confirm the bookings with good seeing".',
			'4. Run the Delete "Drop the cancelled bookings".',
			'5. Run the Process "Assign a dome to each confirmed booking", and put the answer at "Assigned".',
			'6. Finish, answering $Assigned.',
		] );
	} );

	it( 'nests the steps of $when and $try under their field names', function ()
	{
		let document = { Objects: [ { Kind: 'Process', Name: 'P', Steps: [
			{ $when: { Check: { n: { $gt: 1 } }, Then: [ { $return: 1 } ], Else: [ { $try: { Do: [ { $throw: 'x' } ], Catch: [ { $return: 2 } ] } } ] } },
		] } ] };
		LIB_ASSERT.deepStrictEqual( Explain.ExplainEntry( document, 'P' ).Lines.slice( 1 ), [
			'1. If n is greater than 1, do 1 step; otherwise do 1 step.',
			'   Then:',
			'      1. Finish, answering 1.',
			'   Else:',
			'      1. Try 1 step, and on failure do 1 step.',
			'         Do:',
			'            1. Fail with "x".',
			'         Catch:',
			'            1. Finish, answering 2.',
		] );
	} );

	it( 'reads a query with every clause, and FirstOnly on an update and a delete', function ()
	{
		let document = { Objects: [
			{ Kind: 'Query', Name: 'Q', DataSource: 'B', Criteria: { Status: 'requested' }, Projection: { Night: 1, Notes: 0 }, Sort: { Night: 1 }, SkipCount: 25, MaxCount: 25, Into: 'L' },
			{ Kind: 'Update', Name: 'U', DataSource: 'B', Criteria: {}, Update: { $set: { A: 1 } }, FirstOnly: true },
			{ Kind: 'Delete', Name: 'D', DataSource: 'B', Criteria: { A: 1 }, FirstOnly: true },
		] };
		LIB_ASSERT.strictEqual( Explain.ExplainEntry( document, 'Q' ).Lines[ 0 ],
			'Read documents from "B" where Status is "requested", keeping Night and dropping Notes, sorted by Night ascending, skipping the first 25, at most 25 of them, and insert them into "L".' );
		LIB_ASSERT.strictEqual( Explain.ExplainEntry( document, 'U' ).Lines[ 0 ], 'In "B", for the first document where every document matches: set A to 1.' );
		LIB_ASSERT.strictEqual( Explain.ExplainEntry( document, 'D' ).Lines[ 0 ], 'Remove the first document from "B" where A is 1.' );
	} );

	it( 'shows an environment reference as written, never its value', function ()
	{
		let document = { DataSources: [ { Name: 'S', AdapterName: 'jsonstor-mysql', Settings: { Password: '${env:SECRET}' }, Filters: [ { FilterName: 'jsonstor-oplog' } ] } ] };
		process.env.SECRET = 'do-not-show';
		try
		{
			let text = Explain.ExplainEntry( document, 'S' ).Lines.join( '\n' );
			LIB_ASSERT.ok( text.includes( '${env:SECRET}' ) );
			LIB_ASSERT.ok( !text.includes( 'do-not-show' ) );
			LIB_ASSERT.ok( text.includes( '"jsonstor-oplog"' ) );
		}
		finally
		{
			delete process.env.SECRET;
		}
	} );

	it( 'reads a manual trigger, a Before trigger, and one naming no Process', function ()
	{
		let document = Spec.AppendixB();
		document.Triggers.push( { Name: 'By hand', Process: 'Note a long booking' } );
		document.Triggers.push( { Name: 'Before', On: [ 'Insert' ], When: 'Before', Process: 'Note a long booking' } );
		document.Triggers.push( { Name: 'Broken', Process: 'Nothing' } );

		LIB_ASSERT.strictEqual( Explain.ExplainEntry( document, 'By hand' ).Lines[ 0 ], 'Runs only when asked: it runs the Process "Note a long booking" for each document in "Bookings" where Hours is greater than 6.' );
		// An occasion reads as a person says it, not as the functions it covers (13.3), and says
		// which of a gate or a consequence the trigger is (13.5).
		LIB_ASSERT.deepStrictEqual( Explain.ExplainEntry( document, 'Before' ).Lines, [
			'Before a document is inserted into "Bookings", run the Process "Note a long booking" for each such document where Hours is greater than 6.',
			'It is a gate: when the Process fails, the operation is refused and nothing is written.',
			'A change the Process makes to $Document is what an insert stores.',
		] );
		LIB_ASSERT.deepStrictEqual( Explain.ExplainEntry( document, 'Note every long booking as it arrives' ).Lines, [
			'After a document is inserted into "Bookings", run the Process "Note a long booking" for each such document where Hours is greater than 6.',
			'It cannot refuse what has happened: when the Process fails, the write stands.',
		] );
		document.Triggers.push( { Name: 'Several', On: [ 'Find', 'Update', 'Delete' ], When: 'Before', Process: 'Note a long booking' } );
		let several = Explain.ExplainEntry( document, 'Several' ).Lines;
		LIB_ASSERT.match( several[ 0 ], /^Before a document is read from, updated in or deleted from "Bookings", run / );
		LIB_ASSERT.strictEqual( several.length, 2, 'only an insert\'s gate can change what is stored' );
		LIB_ASSERT.match( Explain.ExplainEntry( document, 'Broken' ).Lines[ 0 ], /does not define as a Process with a DataSource/ );
	} );

	it( 'answers null for a name no entry carries', function ()
	{
		LIB_ASSERT.strictEqual( Explain.ExplainEntry( Spec.AppendixB(), 'Nobody' ), null );
	} );

} );
