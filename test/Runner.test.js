'use strict';

const LIB_ASSERT = require( 'assert' );
const { describe, it } = require( 'node:test' );

const Session = require( '../src/Session/Session.js' );
const Spec = require( './fixtures/Spec.js' );


//---------------------------------------------------------------------
function memory_sources( Names )
{
	return Names.map( function ( Name ) { return { Name: Name, AdapterName: 'jsonstor-memory' }; } );
}

function session_for( Objects, Sources, Extra )
{
	let document = { DataSources: memory_sources( Sources || [ 'S', 'T' ] ), Objects: Objects, Triggers: ( Extra && Extra.Triggers ) || [] };
	return Session.NewSession( Object.assign( { Document: document, Env: {} }, Extra || {} ) );
}

async function all( SessionObject, Name, Sort )
{
	return await SessionObject.DataSources.Open( Name ).FindMany2( {}, null, Sort || { _id: 1 }, null );
}

function without_ids( Documents )
{
	return Documents.map( function ( Document ) { let copy = Object.assign( {}, Document ); delete copy._id; return copy; } );
}


//---------------------------------------------------------------------
describe( 'Runner: Appendix B', function ()
{

	it( 'Prepare the season returns exactly the specification\'s result and leaves the one note', async function ()
	{
		let session = Session.NewSession( { Document: Spec.AppendixB(), Env: {} } );
		let report = await session.Run( 'Prepare the season' );

		LIB_ASSERT.strictEqual( report.Ok, true, JSON.stringify( report.Error ) );
		LIB_ASSERT.deepStrictEqual( report.Result, [ { Booking: 'b-1', Observer: 'R. Okafor', Dome: 'B' } ] );
		LIB_ASSERT.deepStrictEqual( without_ids( await all( session, 'Notes' ) ), [ { Booking: 'b-1', Note: 'Long booking on Meridian 40' } ] );

		LIB_ASSERT.deepStrictEqual( report.Calls.map( function ( Call ) { return Call.Name + ': ' + Call.Summary; } ), [
			'Two telescopes: inserted 2',
			'Three bookings: inserted 3',
			'Confirm the bookings with good seeing: selected 1, changed 1',
			'Drop the cancelled bookings: removed 1',
			'Assign a dome to each confirmed booking: ran 1, into Assignments 1',
		] );
		LIB_ASSERT.strictEqual( report.Calls[ 1 ].Fired.length, 1 );
		LIB_ASSERT.strictEqual( report.Calls[ 1 ].Fired[ 0 ].Trigger, 'Note every long booking as it arrives' );
		await session.Release();
	} );

} );


//---------------------------------------------------------------------
describe( 'Runner: each kind\'s result (6.3)', function ()
{

	let seed = { Kind: 'Insert', Name: 'Seed', DataSource: 'S', Documents: [ { _id: 1, n: 1 }, { _id: 2, n: 2 }, { _id: 3, n: 2 }, { _id: 4, n: 3 } ] };

	it( 'an Insert answers how many it inserted, and inserts again when run again', async function ()
	{
		let session = session_for( [ seed ] );
		LIB_ASSERT.strictEqual( ( await session.Run( 'Seed' ) ).Result, 4 );
		await session.Run( 'Seed' ).catch( function () { } );
		LIB_ASSERT.ok( ( await all( session, 'S' ) ).length >= 4 );
	} );

	it( 'a Query answers its rows, paged in Sort order, and Into appends without emptying', async function ()
	{
		let session = session_for( [
			seed,
			{ Kind: 'Query', Name: 'Page', DataSource: 'S', Criteria: {}, Sort: { _id: -1 }, SkipCount: 1, MaxCount: 2, Into: 'T' },
		] );
		await session.Run( 'Seed' );

		let report = await session.Run( 'Page' );
		LIB_ASSERT.deepStrictEqual( report.Result.map( function ( Row ) { return Row._id; } ), [ 3, 2 ] );
		LIB_ASSERT.strictEqual( report.Summary, '2 rows, into T' );

		await session.DataSources.Open( 'T' ).InsertOne( { Marker: true } );
		await session.DataSources.Open( 'T' ).DeleteMany( { _id: { $in: [ 2, 3 ] } } );
		await session.Run( 'Page' );
		LIB_ASSERT.strictEqual( ( await session.DataSources.Open( 'T' ).Count( {} ) ), 3, 'the marker stayed and the page was appended' );
	} );

	it( 'an Update answers Selected and a measured Changed, and FirstOnly selects one', async function ()
	{
		let session = session_for( [
			seed,
			{ Kind: 'Update', Name: 'Same', DataSource: 'S', Criteria: { n: 2 }, Update: { $set: { n: 2 } } },
			{ Kind: 'Update', Name: 'Mixed', DataSource: 'S', Criteria: { n: { $gte: 2 } }, Update: { $set: { n: 3 } } },
			{ Kind: 'Update', Name: 'First', DataSource: 'S', Criteria: {}, Update: { $set: { First: true } }, FirstOnly: true },
		] );
		await session.Run( 'Seed' );
		LIB_ASSERT.deepStrictEqual( ( await session.Run( 'Same' ) ).Result, { Selected: 2, Changed: 0 } );
		LIB_ASSERT.deepStrictEqual( ( await session.Run( 'Mixed' ) ).Result, { Selected: 3, Changed: 2 } );
		LIB_ASSERT.deepStrictEqual( ( await session.Run( 'First' ) ).Result, { Selected: 1, Changed: 1 } );
	} );

	it( 'a Delete answers how many it removed, and FirstOnly removes one', async function ()
	{
		let session = session_for( [
			seed,
			{ Kind: 'Delete', Name: 'One', DataSource: 'S', Criteria: { n: 2 }, FirstOnly: true },
			{ Kind: 'Delete', Name: 'Rest', DataSource: 'S', Criteria: {} },
		] );
		await session.Run( 'Seed' );
		LIB_ASSERT.strictEqual( ( await session.Run( 'One' ) ).Result, 1 );
		LIB_ASSERT.strictEqual( ( await session.Run( 'Rest' ) ).Result, 3 );
	} );

	it( 'a Process with a DataSource answers one value per document; Into inserts only the objects', async function ()
	{
		let session = session_for( [
			seed,
			{
				Kind: 'Process', Name: 'Each', DataSource: 'S', Criteria: { n: { $lte: 2 } }, Into: 'T',
				Steps: [ { $when: { Check: { 'Document.n': 1 }, Then: [ { $return: 'one' } ], Else: [ { $return: { Id: '$Document._id' } } ] } } ],
			},
		] );
		await session.Run( 'Seed' );
		let report = await session.Run( 'Each' );
		LIB_ASSERT.deepStrictEqual( report.Result, [ 'one', { Id: 2 }, { Id: 3 } ] );
		LIB_ASSERT.deepStrictEqual( without_ids( await all( session, 'T', { Id: 1 } ) ), [ { Id: 2 }, { Id: 3 } ] );
	} );

	it( 'a Process with no DataSource runs once from its input, or from {}', async function ()
	{
		let session = session_for( [ { Kind: 'Process', Name: 'Echo', Steps: [ { $return: { Seen: '$Seed' } } ] } ] );
		LIB_ASSERT.deepStrictEqual( ( await session.Run( 'Echo', { Seed: 7 } ) ).Result, { Seen: 7 } );
		LIB_ASSERT.deepStrictEqual( ( await session.Run( 'Echo' ) ).Summary, 'ran once' );
	} );

} );


//---------------------------------------------------------------------
describe( 'Runner: calls', function ()
{

	// ***With is a jsonproc expression document***, so a query or update operator inside it is read
	// as an expression operator: `{ n: { $gt: 1 } }` fails, and `{ n: { $gt: [ '$x', 1 ] } }`
	// silently becomes `{ n: true }` (measured 2026-09-13). `$literal` passes one through unchanged.

	it( 'maps every host function\'s With onto its jsonstor parameters (12.7)', async function ()
	{
		let session = session_for( [ {
			Kind: 'Process', Name: 'Host',
			Steps: [
				{ $call: { Name: 'InsertMany', With: { DataSource: 'S', Documents: [ { _id: 1, n: 1 }, { _id: 2, n: 2 }, { _id: 3, n: 3 } ] }, Into: 'InsertedMany' } },
				{ $call: { Name: 'InsertOne', With: { DataSource: 'S', Document: { _id: 4, n: 4 } }, Into: 'InsertedOne' } },
				{ $call: { Name: 'Count', With: { DataSource: 'S', Criteria: { $literal: { n: { $gt: 1 } } } }, Into: 'Counted' } },
				{ $call: { Name: 'FindOne', With: { DataSource: 'S', Criteria: { n: 2 }, Projection: { n: 1, _id: 0 } }, Into: 'One' } },
				{ $call: { Name: 'FindMany', With: { DataSource: 'S', Criteria: { $literal: { n: { $gte: 3 } } } }, Into: 'Many' } },
				{ $call: { Name: 'FindMany2', With: { DataSource: 'S', Criteria: {}, Sort: { n: -1 }, Paging: { SkipCount: 1, MaxCount: 1 } }, Into: 'Paged' } },
				{ $call: { Name: 'UpdateOne', With: { DataSource: 'S', Criteria: { n: 1 }, Updates: { $literal: { $set: { u: 1 } } } }, Into: 'UpdatedOne' } },
				{ $call: { Name: 'UpdateMany', With: { DataSource: 'S', Criteria: { $literal: { n: { $gt: 2 } } }, Updates: { $literal: { $set: { u: 2 } } } }, Into: 'UpdatedMany' } },
				{ $call: { Name: 'ReplaceOne', With: { DataSource: 'S', Criteria: { n: 2 }, Document: { _id: 2, n: 20 } }, Into: 'Replaced' } },
				{ $call: { Name: 'DeleteOne', With: { DataSource: 'S', Criteria: { n: 20 } }, Into: 'DeletedOne' } },
				{ $call: { Name: 'DeleteMany', With: { DataSource: 'S', Criteria: { u: 2 } }, Into: 'DeletedMany' } },
				{ $return: {
					InsertedMany: '$InsertedMany', InsertedOne: '$InsertedOne', Counted: '$Counted', One: '$One',
					Many: { $size: '$Many' }, Paged: '$Paged', UpdatedOne: '$UpdatedOne', UpdatedMany: '$UpdatedMany',
					Replaced: '$Replaced', DeletedOne: '$DeletedOne', DeletedMany: '$DeletedMany',
				} },
			],
		} ] );

		let report = await session.Run( 'Host' );
		LIB_ASSERT.strictEqual( report.Ok, true, JSON.stringify( report.Error ) );
		LIB_ASSERT.deepStrictEqual( report.Result, {
			InsertedMany: 3, InsertedOne: 1, Counted: 3, One: { n: 2 }, Many: 2,
			Paged: [ { _id: 3, n: 3 } ], UpdatedOne: 1, UpdatedMany: 2, Replaced: 1, DeletedOne: 1, DeletedMany: 2,
		} );
		LIB_ASSERT.deepStrictEqual( await all( session, 'S' ), [ { _id: 1, n: 1, u: 1 } ] );
	} );

	it( 'runs spec 12.7\'s $literal example, and builds an operator from the state with $arrayToObject', async function ()
	{
		let session = session_for( [ {
			Kind: 'Process', Name: 'Mark', DataSource: 'S', Criteria: { Probe: true },
			Steps: [
				{ $call: { Name: 'UpdateMany', With: { DataSource: 'S', Criteria: { $literal: { Hours: { $gt: 6 } } }, Updates: { $literal: { $set: { Long: true } } } } } },
				{ $call: { Name: 'Count', With: { DataSource: 'S', Criteria: { Hours: { $arrayToObject: [ [ [ { $literal: '$gt' }, '$Document.Hours' ] ] ] } } }, Into: 'Longer' } },
				{ $return: '$Longer' },
			],
		} ] );
		await session.DataSources.Open( 'S' ).InsertMany( [ { _id: 1, Hours: 4, Probe: true }, { _id: 2, Hours: 8 }, { _id: 3, Hours: 9 } ] );

		let report = await session.Run( 'Mark' );
		LIB_ASSERT.strictEqual( report.Ok, true, JSON.stringify( report.Error ) );
		LIB_ASSERT.deepStrictEqual( report.Result, [ 2 ], 'two documents have more hours than the probe\'s four' );
		LIB_ASSERT.deepStrictEqual( ( await all( session, 'S' ) ).map( function ( Row ) { return Row._id + ':' + ( Row.Long === true ); } ), [ '1:false', '2:true', '3:true' ] );
	} );

	it( 'runs an object a $call names and hands back its result; nests its report', async function ()
	{
		let session = session_for( [
			{ Kind: 'Insert', Name: 'Seed', DataSource: 'S', Documents: [ { _id: 1 } ] },
			{ Kind: 'Query', Name: 'Read', DataSource: 'S', Criteria: {} },
			{ Kind: 'Process', Name: 'Outer', Steps: [ { $call: { Name: 'Seed' } }, { $call: { Name: 'Read', Into: 'Rows' } }, { $return: '$Rows' } ] },
		] );
		let report = await session.Run( 'Outer' );
		LIB_ASSERT.deepStrictEqual( report.Result, [ { _id: 1 } ] );
		LIB_ASSERT.deepStrictEqual( report.Calls.map( function ( Call ) { return Call.Name; } ), [ 'Seed', 'Read' ] );
	} );

	it( 'refuses a non-empty With on an object call at run time', async function ()
	{
		let session = session_for( [
			{ Kind: 'Query', Name: 'Read', DataSource: 'S', Criteria: {} },
			{ Kind: 'Process', Name: 'Outer', Steps: [ { $call: { Name: 'Read', With: { Criteria: { x: 1 } } } } ] },
		] );
		let report = await session.Run( 'Outer' );
		LIB_ASSERT.strictEqual( report.Ok, false );
		LIB_ASSERT.ok( /takes no With/.test( report.Error.Message ) );
	} );

	it( 'lets $try catch a failed object, and leaves earlier writes standing when nothing does', async function ()
	{
		// A criteria jsongin refuses fails every time; an update on an empty store would match nothing
		// and never reach its bad operator.
		let broken = { Kind: 'Query', Name: 'Broken', DataSource: 'S', Criteria: { n: { $nope: 1 } } };
		let seed = { Kind: 'Insert', Name: 'Seed', DataSource: 'S', Documents: [ { _id: 1 } ] };

		let caught = session_for( [ seed, broken, {
			Kind: 'Process', Name: 'Careful',
			Steps: [ { $try: { Do: [ { $call: { Name: 'Broken' } } ], Catch: [ { $return: 'handled' } ] } } ],
		} ] );
		LIB_ASSERT.strictEqual( ( await caught.Run( 'Careful' ) ).Result, 'handled' );

		let careless = session_for( [ seed, broken, {
			Kind: 'Process', Name: 'Careless', Steps: [ { $call: { Name: 'Seed' } }, { $call: { Name: 'Broken' } }, { $return: 'unreached' } ],
		} ] );
		let report = await careless.Run( 'Careless' );
		LIB_ASSERT.strictEqual( report.Ok, false );
		LIB_ASSERT.deepStrictEqual( report.Calls.map( function ( Call ) { return Call.Name + ' ' + Call.Ok; } ), [ 'Seed true', 'Broken false' ] );
		LIB_ASSERT.ok( /The object \[Broken\] failed/.test( report.Error.Message ) );
		LIB_ASSERT.deepStrictEqual( await all( careless, 'S' ), [ { _id: 1 } ], 'the earlier insert stands' );
	} );

	it( 'records what each storage call measured under the object which made it, with Statistics on', async function ()
	{
		let objects = [
			{ Kind: 'Insert', Name: 'Seed', DataSource: 'S', Documents: [ { _id: 1, n: 1 }, { _id: 2, n: 5 }, { _id: 3, n: 9 } ] },
			{ Kind: 'Query', Name: 'Big', DataSource: 'S', Criteria: { n: { $gt: 4 } } },
			{ Kind: 'Process', Name: 'Both', Steps: [ { $call: { Name: 'Seed' } }, { $call: { Name: 'Big', Into: 'Rows' } }, { $return: '$Rows' } ] },
		];

		let measured = session_for( objects, null, { Statistics: true } );
		let report = await measured.Run( 'Both' );
		LIB_ASSERT.strictEqual( report.Ok, true, JSON.stringify( report.Error ) );
		LIB_ASSERT.strictEqual( report.Result.length, 2, 'the result is unwrapped, not { Result, Statistics }' );

		let query = report.Calls[ 1 ].Statistics;
		LIB_ASSERT.strictEqual( query.length, 1 );
		LIB_ASSERT.strictEqual( query[ 0 ].Function, 'FindMany2' );
		LIB_ASSERT.strictEqual( query[ 0 ].DataSource, 'S' );
		LIB_ASSERT.strictEqual( query[ 0 ].Measured, true );
		LIB_ASSERT.strictEqual( query[ 0 ].ResidualRows, 2 );

		let plain = session_for( objects );
		LIB_ASSERT.deepStrictEqual( ( await plain.Run( 'Both' ) ).Calls[ 1 ].Statistics, [], 'nothing is measured by default' );
	} );

	it( 'reports an object nothing names as a failed run', async function ()
	{
		let report = await session_for( [] ).Run( 'Nobody' );
		LIB_ASSERT.strictEqual( report.Ok, false );
		LIB_ASSERT.strictEqual( report.Error.Code, 'NoSuchObject' );
	} );

	it( 'fails an object whose data source cannot open, naming the reason', async function ()
	{
		let session = Session.NewSession( {
			Document: {
				DataSources: [ { Name: 'Secret', AdapterName: 'jsonstor-jsonfile', Settings: { Path: '${env:JSONX_UNSET_FOR_TEST}' } } ],
				Objects: [ { Kind: 'Query', Name: 'Read', DataSource: 'Secret', Criteria: {} } ],
			},
			Env: {},
		} );
		let report = await session.Run( 'Read' );
		LIB_ASSERT.strictEqual( report.Ok, false );
		LIB_ASSERT.ok( /JSONX_UNSET_FOR_TEST is not set/.test( report.Error.Message ) );
	} );

} );
