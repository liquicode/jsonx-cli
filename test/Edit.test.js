'use strict';

const LIB_ASSERT = require( 'assert' );
const { describe, it } = require( 'node:test' );

const Edit = require( '../src/File/Edit.js' );
const Validate = require( '../src/Validate/Validate.js' );
const Spec = require( './fixtures/Spec.js' );


const OPTIONS = { Validate: { Env: {} } };

function errors( Document )
{
	return Validate.ValidateFile( Document, { Env: {} } ).filter( function ( Finding ) { return Finding.Severity === 'error'; } );
}


//---------------------------------------------------------------------
describe( 'Edit: reading', function ()
{

	it( 'lists a noun\'s entries, an object noun by Kind', function ()
	{
		let document = Spec.AppendixB();
		LIB_ASSERT.deepStrictEqual( Edit.List( document, 'insert' ).map( function ( Item ) { return Item.Name; } ), [ 'Two telescopes', 'Three bookings' ] );
		LIB_ASSERT.deepStrictEqual( Edit.List( document, 'process' ).map( function ( Item ) { return Item.Name; } ),
			[ 'Assign a dome to each confirmed booking', 'Note a long booking', 'Prepare the season' ] );
		LIB_ASSERT.deepStrictEqual( Edit.List( document, 'trigger' ), [ { Name: 'Note every long booking as it arrives', Process: 'Note a long booking', On: [ 'Insert' ], When: 'After' } ] );
		LIB_ASSERT.deepStrictEqual( Edit.List( document, 'query' ), [] );
	} );

	it( 'shows a copy, and refuses a name of the wrong noun', function ()
	{
		let document = Spec.AppendixB();
		let shown = Edit.Show( document, 'datasource', 'Notes' );
		shown.AdapterName = 'changed';
		LIB_ASSERT.strictEqual( document.DataSources[ 3 ].AdapterName, 'jsonstor-memory' );
		LIB_ASSERT.throws( function () { Edit.Show( document, 'query', 'Two telescopes' ); }, /is a Insert, not a Query/ );
		LIB_ASSERT.throws( function () { Edit.Show( document, 'trigger', 'Nobody' ); }, /No trigger is named \[Nobody\]/ );
	} );

} );


//---------------------------------------------------------------------
describe( 'Edit: changing', function ()
{

	it( 'adds an object with its Kind first from the noun, and refuses another Kind or a used name', function ()
	{
		let document = Spec.AppendixB();
		let outcome = Edit.Add( document, 'query', { Name: 'Read notes', DataSource: 'Notes', Criteria: {} }, OPTIONS );
		LIB_ASSERT.strictEqual( outcome.Ok, true );
		LIB_ASSERT.deepStrictEqual( Object.keys( document.Objects[ 7 ] ), [ 'Kind', 'Name', 'DataSource', 'Criteria' ] );

		LIB_ASSERT.throws( function () { Edit.Add( document, 'query', { Kind: 'Delete', Name: 'X', DataSource: 'Notes', Criteria: {} }, OPTIONS ); }, /is a Delete/ );
		LIB_ASSERT.throws( function () { Edit.Add( document, 'datasource', { Name: 'Notes', AdapterName: 'jsonstor-memory' }, OPTIONS ); }, /already used/ );
		LIB_ASSERT.throws( function () { Edit.Add( document, 'datasource', [], OPTIONS ); }, /must be a JSON object/ );
	} );

	it( 'refuses an edit which adds an error, leaving the document as it was, unless forced', function ()
	{
		let document = Spec.AppendixB();
		let before = JSON.stringify( document );

		let refused = Edit.Add( document, 'query', { Name: 'Count', DataSource: 'Notes', Criteria: {} }, OPTIONS );
		LIB_ASSERT.strictEqual( refused.Ok, false );
		LIB_ASSERT.ok( refused.Findings.some( function ( Finding ) { return /reserved for a host function/.test( Finding.Message ); } ) );
		LIB_ASSERT.strictEqual( JSON.stringify( document ), before );

		let forced = Edit.Add( document, 'query', { Name: 'Count', DataSource: 'Notes', Criteria: {} }, Object.assign( { Force: true }, OPTIONS ) );
		LIB_ASSERT.strictEqual( forced.Ok, true );
		LIB_ASSERT.strictEqual( forced.Findings.length > 0, true, 'the added error is still reported' );
	} );

	it( 'lets an already broken file be repaired an edit at a time', function ()
	{
		let document = Spec.AppendixB();
		document.Objects[ 3 ].Criteria = [];
		document.Objects[ 2 ].Update = { $nope: 1 };
		LIB_ASSERT.strictEqual( errors( document ).length, 2 );

		let outcome = Edit.Set( document, 'delete', 'Drop the cancelled bookings', { Criteria: { Status: 'cancelled' } }, OPTIONS );
		LIB_ASSERT.strictEqual( outcome.Ok, true );
		LIB_ASSERT.strictEqual( errors( document ).length, 1 );
	} );

	it( 'sets fields, removes a field set to null, and refuses to change a Name or a Kind', function ()
	{
		let document = Spec.AppendixB();
		let outcome = Edit.Set( document, 'process', 'Assign a dome to each confirmed booking', { Into: null, Criteria: { Status: 'requested' } }, OPTIONS );
		LIB_ASSERT.strictEqual( outcome.Ok, true );
		LIB_ASSERT.strictEqual( typeof document.Objects[ 4 ].Into, 'undefined' );
		LIB_ASSERT.deepStrictEqual( document.Objects[ 4 ].Criteria, { Status: 'requested' } );

		LIB_ASSERT.throws( function () { Edit.Set( document, 'datasource', 'Notes', { Name: 'Other' }, OPTIONS ); }, /use rename/ );
		LIB_ASSERT.throws( function () { Edit.Set( document, 'insert', 'Two telescopes', { Kind: 'Query' }, OPTIONS ); }, /does not change a Kind/ );
	} );

	it( 'refuses to remove what is used, and removes it when forced or unused', function ()
	{
		let document = Spec.AppendixB();
		let refused = Edit.Remove( document, 'datasource', 'Telescopes', OPTIONS );
		LIB_ASSERT.strictEqual( refused.Ok, false );
		LIB_ASSERT.deepStrictEqual( refused.Findings.map( function ( Finding ) { return Finding.Path; } ), [ 'Objects.0.DataSource', 'Objects.4.Steps.0.$call.With.DataSource' ] );

		LIB_ASSERT.strictEqual( Edit.Remove( document, 'trigger', 'Note every long booking as it arrives', OPTIONS ).Ok, true );
		LIB_ASSERT.deepStrictEqual( document.Triggers, [] );

		LIB_ASSERT.strictEqual( Edit.Remove( document, 'datasource', 'Telescopes', Object.assign( { Force: true }, OPTIONS ) ).Ok, true );
		LIB_ASSERT.strictEqual( document.DataSources.length, 3 );
	} );

	it( 'renames and rewrites DataSource, Into, a trigger\'s Process, a nested $call and a literal With.DataSource', function ()
	{
		let document = Spec.AppendixB();
		document.Objects[ 6 ].Steps.push( { $try: { Do: [ { $call: { Name: 'Note a long booking' } } ], Catch: [] } } );

		let data_source = Edit.Rename( document, 'datasource', 'Telescopes', 'Scopes', OPTIONS );
		LIB_ASSERT.strictEqual( data_source.Ok, true );
		LIB_ASSERT.strictEqual( document.Objects[ 0 ].DataSource, 'Scopes' );
		LIB_ASSERT.strictEqual( document.Objects[ 4 ].Steps[ 0 ].$call.With.DataSource, 'Scopes' );

		let process = Edit.Rename( document, 'process', 'Note a long booking', 'Note long bookings', OPTIONS );
		LIB_ASSERT.strictEqual( process.Ok, true );
		LIB_ASSERT.strictEqual( document.Triggers[ 0 ].Process, 'Note long bookings' );
		LIB_ASSERT.strictEqual( document.Objects[ 6 ].Steps[ 6 ].$try.Do[ 0 ].$call.Name, 'Note long bookings' );

		Edit.Rename( document, 'datasource', 'Notes', 'Remarks', OPTIONS );
		LIB_ASSERT.strictEqual( document.Objects[ 5 ].Into, 'Remarks' );

		LIB_ASSERT.deepStrictEqual( errors( document ), [] );
		LIB_ASSERT.throws( function () { Edit.Rename( document, 'datasource', 'Scopes', 'Bookings', OPTIONS ); }, /already used/ );
	} );

	it( 'refuses a rename to a reserved name, as an added error', function ()
	{
		let document = Spec.AppendixB();
		let outcome = Edit.Rename( document, 'datasource', 'Notes', 'Count', OPTIONS );
		LIB_ASSERT.strictEqual( outcome.Ok, false );
		LIB_ASSERT.strictEqual( document.DataSources[ 3 ].Name, 'Notes' );
	} );

} );
