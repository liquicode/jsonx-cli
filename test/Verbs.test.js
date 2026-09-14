'use strict';

const LIB_ASSERT = require( 'assert' );
const { describe, it } = require( 'node:test' );

const jsongin = require( '@liquicode/jsongin' );
const jsonproc = require( '@liquicode/jsonproc' );

const Session = require( '../src/Session/Session.js' );
const Verbs = require( '../src/Storage/Verbs.js' );
const Spec = require( './fixtures/Spec.js' );


//---------------------------------------------------------------------
function items_session( Extra )
{
	let document = {
		DataSources: [ { Name: 'Items', AdapterName: 'jsonstor-memory' }, { Name: 'Copies', AdapterName: 'jsonstor-memory' } ],
		Objects: [ { Kind: 'Query', Name: 'Blue items', DataSource: 'Items', Criteria: { Color: 'blue' }, Sort: { _id: 1 } } ],
	};
	return Session.NewSession( Object.assign( { Document: document, Env: {} }, Extra || {} ) );
}

async function seeded( Extra )
{
	let session = items_session( Extra );
	let report = await Verbs.Run( session, 'insert', 'Items', { documents: [
		{ _id: 'a', Color: 'blue', Size: 1 },
		{ _id: 'b', Color: 'red', Size: 2 },
		{ _id: 'c', Color: 'blue', Size: 3 },
	] } );
	LIB_ASSERT.strictEqual( report.Ok, true, JSON.stringify( report.Error ) );
	return session;
}

function validate_options()
{
	return { jsongin: jsongin, jsonproc: jsonproc, Env: {} };
}


//---------------------------------------------------------------------
describe( 'Verbs: each verb', function ()
{

	it( 'find answers what the same Query in the file answers, under an (ad hoc) report', async function ()
	{
		let session = await seeded();
		let ad_hoc = await Verbs.Run( session, 'find', 'Items', { criteria: { Color: 'blue' }, sort: { _id: 1 } } );
		let saved = await session.Run( 'Blue items' );

		LIB_ASSERT.deepStrictEqual( ad_hoc.Result, saved.Result );
		LIB_ASSERT.strictEqual( ad_hoc.Name, '(ad hoc)' );
		LIB_ASSERT.strictEqual( ad_hoc.Kind, 'Query' );
		LIB_ASSERT.strictEqual( ad_hoc.Summary, '2 rows' );
		await session.Release();
	} );

	it( 'find pages, projects and routes Into', async function ()
	{
		let session = await seeded();
		let report = await Verbs.Run( session, 'find', 'Items', { criteria: {}, sort: { Size: -1 }, skip: 1, max: 1, projection: { Size: 1 }, into: 'Copies' } );
		LIB_ASSERT.deepStrictEqual( report.Result, [ { _id: 'b', Size: 2 } ] );
		LIB_ASSERT.strictEqual( report.Summary, '1 row, into Copies' );
		LIB_ASSERT.strictEqual( await session.DataSources.Open( 'Copies' ).Count( {} ), 1 );
		await session.Release();
	} );

	it( 'find-one, count and replace make their one call', async function ()
	{
		let session = await seeded();

		let one = await Verbs.Run( session, 'find-one', 'Items', { criteria: { Color: 'red' } } );
		LIB_ASSERT.strictEqual( one.Result._id, 'b' );
		LIB_ASSERT.strictEqual( one.Kind, 'FindOne' );
		LIB_ASSERT.strictEqual( ( await Verbs.Run( session, 'find-one', 'Items', { criteria: { Color: 'green' } } ) ).Summary, 'found none' );

		let counted = await Verbs.Run( session, 'count', 'Items', { criteria: { Color: 'blue' } } );
		LIB_ASSERT.strictEqual( counted.Result, 2 );
		LIB_ASSERT.strictEqual( counted.Summary, 'counted 2' );

		let replaced = await Verbs.Run( session, 'replace', 'Items', { criteria: { _id: 'b' }, document: { _id: 'b', Color: 'green' } } );
		LIB_ASSERT.strictEqual( replaced.Result, 1 );
		LIB_ASSERT.deepStrictEqual( await session.DataSources.Open( 'Items' ).FindOne( { _id: 'b' } ), { _id: 'b', Color: 'green' } );
		await session.Release();
	} );

	it( 'insert takes one document or an array', async function ()
	{
		let session = items_session();
		LIB_ASSERT.strictEqual( ( await Verbs.Run( session, 'insert', 'Items', { documents: { _id: 'x' } } ) ).Result, 1 );
		LIB_ASSERT.strictEqual( ( await Verbs.Run( session, 'insert', 'Items', { documents: [ { _id: 'y' }, { _id: 'z' } ] } ) ).Result, 2 );
		LIB_ASSERT.strictEqual( await session.DataSources.Open( 'Items' ).Count( {} ), 3 );
		await session.Release();
	} );

	it( 'update reports selected and changed, and first-only changes one', async function ()
	{
		let session = await seeded();
		let report = await Verbs.Run( session, 'update', 'Items', { criteria: { Color: 'blue' }, update: { $set: { Size: 3 } } } );
		LIB_ASSERT.deepStrictEqual( report.Result, { Selected: 2, Changed: 1 } );

		let first = await Verbs.Run( session, 'update', 'Items', { criteria: { Color: 'blue' }, update: { $set: { Size: 9 } }, 'first-only': true } );
		LIB_ASSERT.deepStrictEqual( first.Result, { Selected: 1, Changed: 1 } );
		await session.Release();
	} );

	it( 'delete removes, flush and refresh-index answer, drop empties, ping counts', async function ()
	{
		let session = await seeded();
		LIB_ASSERT.strictEqual( ( await Verbs.Run( session, 'delete', 'Items', { criteria: { Color: 'blue' }, 'first-only': true } ) ).Result, 1 );
		LIB_ASSERT.strictEqual( ( await Verbs.Run( session, 'flush', 'Items', {} ) ).Summary, 'flushed' );
		LIB_ASSERT.strictEqual( ( await Verbs.Run( session, 'refresh-index', 'Items', {} ) ).Ok, true );

		let ping = await Verbs.Run( session, 'ping', 'Items', {} );
		LIB_ASSERT.strictEqual( ping.Result.Name, 'Items' );
		LIB_ASSERT.strictEqual( ping.Result.AdapterName, 'jsonstor-memory' );
		LIB_ASSERT.strictEqual( ping.Result.Count, 2 );
		LIB_ASSERT.strictEqual( typeof ping.Result.Ms, 'number' );

		LIB_ASSERT.strictEqual( ( await Verbs.Run( session, 'drop', 'Items', { yes: true } ) ).Summary, 'dropped' );
		LIB_ASSERT.strictEqual( await session.DataSources.Open( 'Items' ).Count( {} ), 0 );
		await session.Release();
	} );

	it( 'fires the file\'s trigger for a verb\'s write', async function ()
	{
		let session = Session.NewSession( { Document: Spec.AppendixB(), Env: {} } );
		let report = await Verbs.Run( session, 'insert', 'Bookings', { documents: { _id: 'long', Telescope: 'Meridian 40', Hours: 9 } } );
		LIB_ASSERT.strictEqual( report.Fired.length, 1 );
		LIB_ASSERT.strictEqual( report.Fired[ 0 ].Trigger, 'Note every long booking as it arrives' );
		LIB_ASSERT.strictEqual( await session.DataSources.Open( 'Notes' ).Count( { Booking: 'long' } ), 1 );
		await session.Release();
	} );

	it( 'reports a failed call as a failed report', async function ()
	{
		let session = items_session();
		let report = await Verbs.Run( session, 'count', 'Nowhere', {} );
		LIB_ASSERT.strictEqual( report.Ok, false );
		LIB_ASSERT.match( report.Error.Message, /No data source is named \[Nowhere\]/ );
		await session.Release();
	} );

} );


//---------------------------------------------------------------------
describe( 'Verbs: the guard, building and validation', function ()
{

	it( 'refuses an update or delete selecting everything, and every drop, without --yes', function ()
	{
		for ( let index = 0; index < 2; index++ )
		{
			let verb = [ 'update', 'delete' ][ index ];
			LIB_ASSERT.match( Verbs.Guard( verb, { criteria: {} } ), /selects every document/ );
			LIB_ASSERT.match( Verbs.Guard( verb, { criteria: null } ), /selects every document/ );
			LIB_ASSERT.match( Verbs.Guard( verb, {} ), /selects every document/ );
			LIB_ASSERT.strictEqual( Verbs.Guard( verb, { criteria: { A: 1 } } ), null );
			LIB_ASSERT.strictEqual( Verbs.Guard( verb, { criteria: {}, yes: true } ), null );
		}
		LIB_ASSERT.match( Verbs.Guard( 'drop', {} ), /removes the whole store/ );
		LIB_ASSERT.strictEqual( Verbs.Guard( 'drop', { yes: true } ), null );
		LIB_ASSERT.strictEqual( Verbs.Guard( 'find', { criteria: {} } ), null );
		LIB_ASSERT.strictEqual( Verbs.Guard( 'replace', { criteria: {} } ), null );
	} );

	it( 'builds only the fields given, Kind and Name first', function ()
	{
		LIB_ASSERT.deepStrictEqual( Verbs.BuildObject( 'find', 'Items', { criteria: {} }, 'All' ), { Kind: 'Query', Name: 'All', DataSource: 'Items', Criteria: {} } );
		LIB_ASSERT.deepStrictEqual( Object.keys( Verbs.BuildObject( 'delete', 'Items', { criteria: { A: 1 }, 'first-only': false } ) ), [ 'Kind', 'DataSource', 'Criteria' ] );
		LIB_ASSERT.deepStrictEqual( Verbs.BuildObject( 'insert', 'Items', { documents: { A: 1 } } ).Documents, [ { A: 1 } ] );
		LIB_ASSERT.throws( function () { Verbs.BuildObject( 'count', 'Items', {} ); }, /not an object of any kind/ );
	} );

	it( 'finds a built object\'s errors under the file\'s rules, with paths named (ad hoc)', function ()
	{
		let document = items_session().Document;

		LIB_ASSERT.deepStrictEqual( Verbs.ValidateObject( document, Verbs.BuildObject( 'find', 'Items', { criteria: { Color: 'blue' } } ), validate_options() ), [] );

		let bad_update = Verbs.ValidateObject( document, Verbs.BuildObject( 'update', 'Items', { criteria: { A: 1 }, update: { $nope: {} } } ), validate_options() );
		LIB_ASSERT.strictEqual( bad_update.length, 1 );
		LIB_ASSERT.strictEqual( bad_update[ 0 ].Path, '(ad hoc).Update' );

		let bad_into = Verbs.ValidateObject( document, Verbs.BuildObject( 'find', 'Items', { criteria: {}, into: 'Items' } ), validate_options() );
		LIB_ASSERT.ok( bad_into.length > 0 );
		LIB_ASSERT.ok( bad_into.every( function ( Finding ) { return Finding.Path.startsWith( '(ad hoc)' ); } ) );

		let bad_criteria = Verbs.ValidateObject( document, Verbs.BuildObject( 'delete', 'Items', { criteria: { A: { $bogus: 1 } } } ), validate_options() );
		LIB_ASSERT.ok( bad_criteria.length > 0 );
	} );

	it( 'leaves the file it validates against untouched', function ()
	{
		let document = items_session().Document;
		let before = JSON.stringify( document );
		Verbs.ValidateObject( document, Verbs.BuildObject( 'find', 'Items', { criteria: {} } ), validate_options() );
		LIB_ASSERT.strictEqual( JSON.stringify( document ), before );
	} );

} );


//---------------------------------------------------------------------
describe( 'Trace', function ()
{

	it( 'records each object\'s storage calls under that object, triggered Processes included, and changes no result', async function ()
	{
		let plain = Session.NewSession( { Document: Spec.AppendixB(), Env: {} } );
		let traced = Session.NewSession( { Document: Spec.AppendixB(), Env: {}, Trace: true } );

		let plain_report = await plain.Run( 'Prepare the season' );
		let traced_report = await traced.Run( 'Prepare the season' );
		LIB_ASSERT.deepStrictEqual( traced_report.Result, plain_report.Result );
		LIB_ASSERT.deepStrictEqual( plain_report.Calls[ 1 ].Trace, [] );

		let bookings = traced_report.Calls[ 1 ];
		LIB_ASSERT.ok( bookings.Trace.some( function ( Line ) { return /\| InsertMany ===$/.test( Line ); } ), bookings.Trace.join( '\n' ) );
		LIB_ASSERT.ok( bookings.Trace.every( function ( Line ) { return Line.trim() !== ''; } ) );

		let note = bookings.Fired[ 0 ];
		LIB_ASSERT.ok( note.Trace.some( function ( Line ) { return /InsertMany ===$/.test( Line ); } ), 'the triggered Process\'s Into insert is traced under it' );

		await plain.Release();
		await traced.Release();
	} );

	it( 'measures an update\'s Changed correctly behind the trace filter, which hides PrimaryKeyInfo', async function ()
	{
		let session = await seeded( { Trace: true } );
		LIB_ASSERT.strictEqual( typeof session.DataSources.Open( 'Items' ).PrimaryKeyInfo, 'undefined' );

		let report = await Verbs.Run( session, 'update', 'Items', { criteria: { Color: 'blue' }, update: { $set: { Size: 3 } } } );
		LIB_ASSERT.deepStrictEqual( report.Result, { Selected: 2, Changed: 1 } );
		await session.Release();
	} );

} );
