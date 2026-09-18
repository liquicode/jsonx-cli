'use strict';

const LIB_ASSERT = require( 'assert' );
const { describe, it } = require( 'node:test' );

const AdapterCatalog = require( '../src/Session/AdapterCatalog.js' );
const Plan = require( '../src/Session/Plan.js' );
const Spec = require( './fixtures/Spec.js' );


//---------------------------------------------------------------------
// A catalog over a jsonstor whose GetStorage fails the test if anything opens.

function watched_catalog()
{
	let jsonstor = require( '@liquicode/jsonstor' )();
	jsonstor.GetStorage = function () { throw new Error( 'A plan opened a storage.' ); };
	return AdapterCatalog.NewAdapterCatalog( { jsonstor: jsonstor } );
}

function plan( Document, Name, Extra )
{
	return Plan.PlanObject( Document, Name, Object.assign( { Catalog: watched_catalog(), Env: {} }, Extra || {} ) );
}

function flatten( Node, Depth, Lines )
{
	let lines = Lines || [];
	let depth = Depth || 0;
	lines.push( '  '.repeat( depth ) + Node.Name );
	for ( let index = 0; index < Node.Does.length; index++ )
	{
		let item = Node.Does[ index ];
		if ( item.Object ) { flatten( item.Object, depth + 1, lines ); }
		else { lines.push( '  '.repeat( depth + 1 ) + item.Function + ' ' + item.DataSource ); }
	}
	return lines;
}


//---------------------------------------------------------------------
describe( 'Plan', function ()
{

	it( 'lays out Prepare the season in step order, opening nothing', function ()
	{
		let result = plan( Spec.AppendixB(), 'Prepare the season' );
		LIB_ASSERT.deepStrictEqual( flatten( result.Tree ), [
			'Prepare the season',
			'  Two telescopes',
			'    InsertMany Telescopes',
			'  Three bookings',
			'    InsertMany Bookings',
			'  Confirm the bookings with good seeing',
			'    FindMany Bookings',
			'    UpdateMany Bookings',
			'  Drop the cancelled bookings',
			'    DeleteMany Bookings',
			'  Assign a dome to each confirmed booking',
			'    FindMany2 Bookings',
			'    FindOne Telescopes',
			'    InsertMany Assignments',
		] );
		LIB_ASSERT.deepStrictEqual( result.DataSources.map( function ( Source ) { return Source.Name + ' ' + Source.AdapterName + ' ' + Source.Installed; } ), [
			'Telescopes jsonstor-memory true', 'Bookings jsonstor-memory true', 'Assignments jsonstor-memory true',
		] );
		LIB_ASSERT.deepStrictEqual( result.Triggers, [ { Name: 'Note every long booking as it arrives', Process: 'Note a long booking', DataSource: 'Bookings', On: [ 'Insert' ] } ] );
		LIB_ASSERT.deepStrictEqual( result.Findings, [] );
	} );

	it( 'reports environment variables as set or not, and settings as written', function ()
	{
		let document = Spec.AppendixB();
		document.DataSources[ 2 ] = { Name: 'Assignments', AdapterName: 'jsonstor-jsonfile', Settings: { Path: '${env:JSONX_PLAN_A}/${env:JSONX_PLAN_B}.json' } };
		let result = plan( document, 'Assign a dome to each confirmed booking', { Env: { JSONX_PLAN_A: 'data' } } );
		let assignments = result.DataSources.find( function ( Source ) { return Source.Name === 'Assignments'; } );
		LIB_ASSERT.deepStrictEqual( assignments.Environment, [ { Name: 'JSONX_PLAN_A', Set: true }, { Name: 'JSONX_PLAN_B', Set: false } ] );
		LIB_ASSERT.strictEqual( assignments.Settings.Path, '${env:JSONX_PLAN_A}/${env:JSONX_PLAN_B}.json' );
		LIB_ASSERT.ok( result.Findings.some( function ( Finding ) { return Finding.Severity === 'warning' && /JSONX_PLAN_B/.test( Finding.Message ); } ) );
	} );

	it( 'applies overrides, marks a computed data source, and stops at a Process which calls itself', function ()
	{
		let document = Spec.AppendixB();
		document.Objects[ 6 ].Steps.push( { $call: { Name: 'Count', With: { DataSource: '$Document.Source' } } } );
		document.Objects[ 6 ].Steps.push( { $call: { Name: 'Prepare the season' } } );

		let result = plan( document, 'Prepare the season', { Binds: [ 'Telescopes=jsonstor-folder:{"Path":"t"}' ] } );
		let does = result.Tree.Does;
		LIB_ASSERT.deepStrictEqual( does[ does.length - 2 ], { Function: 'Count', DataSource: null, Computed: '$Document.Source' } );
		LIB_ASSERT.strictEqual( does[ does.length - 1 ].Object.Repeats, true );
		LIB_ASSERT.strictEqual( result.DataSources[ 0 ].AdapterName, 'jsonstor-folder' );
		LIB_ASSERT.ok( result.Findings.some( function ( Finding ) { return /calls itself/.test( Finding.Message ); } ) );
	} );

	it( 'answers null for a name which is not an object', function ()
	{
		LIB_ASSERT.strictEqual( plan( Spec.AppendixB(), 'Bookings' ), null );
		LIB_ASSERT.strictEqual( plan( Spec.AppendixB(), 'Nobody' ), null );
	} );

} );
