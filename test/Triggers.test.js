'use strict';

const LIB_ASSERT = require( 'assert' );
const { describe, it } = require( 'node:test' );

const Session = require( '../src/Session/Session.js' );


//---------------------------------------------------------------------
function session_for( Objects, Triggers, Sources )
{
	let names = Sources || [ 'S', 'Log', 'Other' ];
	return Session.NewSession( {
		Document: {
			DataSources: names.map( function ( Name ) { return { Name: Name, AdapterName: 'jsonstor-memory' }; } ),
			Objects: Objects,
			Triggers: Triggers,
		},
		Env: {},
	} );
}

async function all( SessionObject, Name )
{
	return await SessionObject.DataSources.Open( Name ).FindMany2( {}, null, null, null );
}


//---------------------------------------------------------------------
describe( 'Triggers', function ()
{

	it( 'fire for a host function call inside a Process, and record the firing under the object', async function ()
	{
		let session = session_for(
			[
				{ Kind: 'Process', Name: 'Log it', DataSource: 'S', Into: 'Log', Steps: [ { $return: { Saw: '$Document._id', Function: '$Event.Function' } } ] },
				{ Kind: 'Process', Name: 'Writer', Steps: [ { $call: { Name: 'InsertOne', With: { DataSource: 'S', Document: { _id: 'w' } } } } ] },
			],
			[ { Name: 'On insert', On: [ 'InsertOne', 'InsertMany' ], Process: 'Log it' } ] );

		let report = await session.Run( 'Writer' );
		LIB_ASSERT.strictEqual( report.Ok, true, JSON.stringify( report.Error ) );
		LIB_ASSERT.strictEqual( report.Fired.length, 1 );
		LIB_ASSERT.deepStrictEqual( ( await all( session, 'Log' ) ).map( function ( Row ) { return Row.Saw + ' ' + Row.Function; } ), [ 'w InsertOne' ] );
	} );

	it( 'run only for documents the Process\'s Criteria selects', async function ()
	{
		let session = session_for(
			[
				{ Kind: 'Process', Name: 'Log big', DataSource: 'S', Criteria: { n: { $gt: 5 } }, Into: 'Log', Steps: [ { $return: { Saw: '$Document.n' } } ] },
				{ Kind: 'Insert', Name: 'Seed', DataSource: 'S', Documents: [ { n: 1 }, { n: 9 }, { n: 6 } ] },
			],
			[ { Name: 'On insert', On: [ 'InsertMany' ], Process: 'Log big' } ] );
		await session.Run( 'Seed' );
		LIB_ASSERT.deepStrictEqual( ( await all( session, 'Log' ) ).map( function ( Row ) { return Row.Saw; } ).sort(), [ 6, 9 ] );
	} );

	it( 'let a Before trigger change the document an insert stores, without editing the file', async function ()
	{
		let seed = { Kind: 'Insert', Name: 'Seed', DataSource: 'S', Documents: [ { _id: 'a' } ] };
		let session = session_for(
			[
				{ Kind: 'Process', Name: 'Stamp', DataSource: 'S', Steps: [ { $do: { 'Document.Stamped': true } } ] },
				seed,
			],
			[ { Name: 'Before insert', On: [ 'InsertMany' ], When: 'Before', Process: 'Stamp' } ] );
		await session.Run( 'Seed' );
		LIB_ASSERT.deepStrictEqual( await all( session, 'S' ), [ { _id: 'a', Stamped: true } ] );
		LIB_ASSERT.deepStrictEqual( seed.Documents, [ { _id: 'a' } ], 'the file\'s Insert is unchanged' );
	} );

	it( 'do not re-fire for their own Process\'s writes, while another trigger on the source still fires', async function ()
	{
		let session = session_for(
			[
				{
					Kind: 'Process', Name: 'Copy', DataSource: 'S', Criteria: {},
					Steps: [ { $call: { Name: 'InsertOne', With: { DataSource: 'S', Document: { Copied: '$Document._id' } } } } ],
				},
				{ Kind: 'Process', Name: 'Count them', DataSource: 'S', Into: 'Log', Steps: [ { $return: { Seen: true } } ] },
				{ Kind: 'Insert', Name: 'Seed', DataSource: 'S', Documents: [ { _id: 'first' } ] },
			],
			[
				{ Name: 'Copy on insert', On: [ 'InsertOne', 'InsertMany' ], Process: 'Copy' },
				{ Name: 'Count on insert', On: [ 'InsertOne', 'InsertMany' ], Process: 'Count them' },
			] );

		let report = await session.Run( 'Seed' );
		LIB_ASSERT.strictEqual( report.Ok, true, JSON.stringify( report.Error ) );
		LIB_ASSERT.strictEqual( ( await all( session, 'S' ) ).length, 2, 'Copy ran once and did not copy its own copy' );
		LIB_ASSERT.strictEqual( ( await all( session, 'Log' ) ).length, 2, 'Count ran for the insert and for Copy\'s insert' );
	} );

	it( 'show an After update trigger the documents as they are after the update', async function ()
	{
		let session = session_for(
			[
				{ Kind: 'Insert', Name: 'Seed', DataSource: 'S', Documents: [ { _id: 1, Status: 'requested' }, { _id: 2, Status: 'other' } ] },
				{ Kind: 'Update', Name: 'Confirm', DataSource: 'S', Criteria: { Status: 'requested' }, Update: { $set: { Status: 'confirmed' } } },
				{ Kind: 'Process', Name: 'Log status', DataSource: 'S', Into: 'Log', Steps: [ { $return: { Id: '$Document._id', Status: '$Document.Status' } } ] },
				{ Kind: 'Delete', Name: 'Clear', DataSource: 'S', Criteria: { _id: 2 } },
			],
			[ { Name: 'After change', On: [ 'UpdateMany', 'DeleteMany' ], Process: 'Log status' } ] );

		await session.Run( 'Seed' );
		await session.Run( 'Confirm' );
		await session.Run( 'Clear' );
		let log = ( await all( session, 'Log' ) ).map( function ( Row ) { return Row.Id + ' ' + Row.Status; } );
		LIB_ASSERT.deepStrictEqual( log, [ '1 confirmed', '2 other' ] );
	} );

	it( 'fail the storage call, and so the object, when the triggered Process fails', async function ()
	{
		let session = session_for(
			[
				{ Kind: 'Process', Name: 'Refuse', DataSource: 'S', Steps: [ { $throw: 'not today' } ] },
				{ Kind: 'Insert', Name: 'Seed', DataSource: 'S', Documents: [ { _id: 1 } ] },
			],
			[ { Name: 'Guard', On: [ 'InsertMany' ], When: 'Before', Process: 'Refuse' } ] );

		let report = await session.Run( 'Seed' );
		LIB_ASSERT.strictEqual( report.Ok, false );
		LIB_ASSERT.ok( /The trigger \[Guard\] failed: .*not today/.test( report.Error.Message ), report.Error.Message );
		LIB_ASSERT.strictEqual( report.Fired[ 0 ].Ok, false );
		LIB_ASSERT.deepStrictEqual( await all( session, 'S' ), [], 'a Before failure stops the insert' );
	} );

	it( 'run by hand over their Process\'s data source, and refuse a name which is not a trigger', async function ()
	{
		let session = session_for(
			[
				{ Kind: 'Insert', Name: 'Seed', DataSource: 'S', Documents: [ { _id: 1 }, { _id: 2 } ] },
				{ Kind: 'Process', Name: 'Tally', DataSource: 'S', Steps: [ { $return: '$Document._id' } ] },
			],
			[ { Name: 'Manual tally', Process: 'Tally' } ] );

		await session.Run( 'Seed' );
		let report = await session.RunTrigger( 'Manual tally' );
		LIB_ASSERT.deepStrictEqual( report.Result.sort(), [ 1, 2 ] );
		LIB_ASSERT.strictEqual( report.Trigger, 'Manual tally' );
		await LIB_ASSERT.rejects( session.RunTrigger( 'Tally' ), /No trigger is named \[Tally\]/ );
	} );

} );
