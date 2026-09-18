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
			[ { Name: 'On insert', On: [ 'Insert' ], Process: 'Log it' } ] );

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
			[ { Name: 'On insert', On: [ 'Insert' ], Process: 'Log big' } ] );
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
			[ { Name: 'Before insert', On: [ 'Insert' ], When: 'Before', Process: 'Stamp' } ] );
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
				{ Name: 'Copy on insert', On: [ 'Insert' ], Process: 'Copy' },
				{ Name: 'Count on insert', On: [ 'Insert' ], Process: 'Count them' },
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
			[ { Name: 'After change', On: [ 'Update', 'Delete' ], Process: 'Log status' } ] );

		await session.Run( 'Seed' );
		await session.Run( 'Confirm' );
		await session.Run( 'Clear' );
		let log = ( await all( session, 'Log' ) ).map( function ( Row ) { return Row.Id + ' ' + Row.Status; } );
		LIB_ASSERT.deepStrictEqual( log, [ '1 confirmed', '2 other' ] );
	} );

	it( 'fire on an operation whichever of its functions makes the call: a first-only Delete and an every-match Delete alike', async function ()
	{
		let session = session_for(
			[
				{ Kind: 'Insert', Name: 'Seed', DataSource: 'S', Documents: [ { _id: 1, Group: 'a' }, { _id: 2, Group: 'a' }, { _id: 3, Group: 'b' } ] },
				{ Kind: 'Delete', Name: 'First a', DataSource: 'S', Criteria: { Group: 'a' }, FirstOnly: true },
				{ Kind: 'Delete', Name: 'Every b', DataSource: 'S', Criteria: { Group: 'b' } },
				{ Kind: 'Process', Name: 'Log it', DataSource: 'S', Into: 'Log', Steps: [ { $return: { Group: '$Document.Group', Function: '$Event.Function', Operation: '$Event.Operation' } } ] },
			],
			[ { Name: 'On delete', On: [ 'Delete' ], Process: 'Log it' } ] );

		await session.Run( 'Seed' );
		await session.Run( 'First a' );
		await session.Run( 'Every b' );
		let log = ( await all( session, 'Log' ) ).map( function ( Row ) { return Row.Group + ' ' + Row.Function + ' ' + Row.Operation; } ).sort();
		LIB_ASSERT.deepStrictEqual( log, [ 'a DeleteOne Delete', 'b DeleteMany Delete' ] );
	} );

	it( 'fire an Update trigger for a ReplaceOne, since a replaced document is a changed one, and no trigger for a Count', async function ()
	{
		let session = session_for(
			[
				{ Kind: 'Insert', Name: 'Seed', DataSource: 'S', Documents: [ { _id: 1, Status: 'old' } ] },
				{ Kind: 'Process', Name: 'Swap', Steps: [
					{ $call: { Name: 'Count', With: { DataSource: 'S', Criteria: {} }, Into: 'Before' } },
					{ $call: { Name: 'ReplaceOne', With: { DataSource: 'S', Criteria: { _id: 1 }, Document: { _id: 1, Status: 'new' } } } },
				] },
				{ Kind: 'Process', Name: 'Log it', DataSource: 'S', Into: 'Log', Steps: [ { $return: { Status: '$Document.Status', Function: '$Event.Function', Operation: '$Event.Operation' } } ] },
			],
			[ { Name: 'On change', On: [ 'Update' ], Process: 'Log it' } ] );

		await session.Run( 'Seed' );
		let report = await session.Run( 'Swap' );
		LIB_ASSERT.strictEqual( report.Ok, true, JSON.stringify( report.Error ) );
		let log = ( await all( session, 'Log' ) ).map( function ( Row ) { return Row.Status + ' ' + Row.Function + ' ' + Row.Operation; } );
		LIB_ASSERT.deepStrictEqual( log, [ 'new ReplaceOne Update' ] );
	} );

	it( 'cover, between the four operations, exactly the functions the filter watches', function ()
	{
		let Names = require( '../src/File/Names.js' );
		let Triggers = require( '../src/Session/Triggers.js' );
		let covered = [];
		Object.keys( Names.TRIGGER_OPERATIONS ).forEach( function ( Operation ) { covered = covered.concat( Names.TRIGGER_OPERATIONS[ Operation ] ); } );
		LIB_ASSERT.deepStrictEqual( Object.keys( Names.TRIGGER_OPERATIONS ), [ 'Insert', 'Find', 'Update', 'Delete' ] );
		LIB_ASSERT.deepStrictEqual( covered.slice().sort(), Object.keys( Triggers.WATCHED_FUNCTIONS ).sort() );
		LIB_ASSERT.strictEqual( Names.OperationOf( 'ReplaceOne' ), 'Update' );
		LIB_ASSERT.strictEqual( Names.OperationOf( 'Count' ), null );
	} );

	it( 'gate a first-only Delete on the one document it will touch, and refuse the whole call when a gate fails', async function ()
	{
		let session = session_for(
			[
				{ Kind: 'Insert', Name: 'Seed', DataSource: 'S', Documents: [ { _id: 1, Group: 'a', Protected: false }, { _id: 2, Group: 'a', Protected: true }, { _id: 3, Group: 'a', Protected: false } ] },
				{ Kind: 'Delete', Name: 'First a', DataSource: 'S', Criteria: { Group: 'a' }, FirstOnly: true },
				{ Kind: 'Delete', Name: 'Every a', DataSource: 'S', Criteria: { Group: 'a' } },
				{ Kind: 'Process', Name: 'Protect', DataSource: 'S', Criteria: { Protected: true }, Steps: [ { $throw: 'a protected document is never deleted' } ] },
			],
			[ { Name: 'Gate', On: [ 'Delete' ], When: 'Before', Process: 'Protect' } ] );

		await session.Run( 'Seed' );
		// The criteria selects the protected document too, but a first-only Delete touches the first alone.
		let first = await session.Run( 'First a' );
		LIB_ASSERT.strictEqual( first.Ok, true, JSON.stringify( first.Error ) );
		LIB_ASSERT.deepStrictEqual( ( await all( session, 'S' ) ).map( function ( Row ) { return Row._id; } ), [ 2, 3 ] );
		// An every-match Delete touches it, so the gate refuses the call, and the unprotected document stays too.
		let every = await session.Run( 'Every a' );
		LIB_ASSERT.strictEqual( every.Ok, false );
		LIB_ASSERT.ok( /The trigger \[Gate\] failed: .*never deleted/.test( every.Error.Message ), every.Error.Message );
		LIB_ASSERT.ok( !/stands/.test( every.Error.Message ), 'a refused call made nothing: ' + every.Error.Message );
		LIB_ASSERT.deepStrictEqual( ( await all( session, 'S' ) ).map( function ( Row ) { return Row._id; } ), [ 2, 3 ] );
	} );

	it( 'show a gate on an Update the update and the document as it would become, so it can refuse a change', async function ()
	{
		let session = session_for(
			[
				{ Kind: 'Insert', Name: 'Seed', DataSource: 'S', Documents: [ { _id: 1, Status: 'paid' }, { _id: 2, Status: 'open' } ] },
				{ Kind: 'Update', Name: 'Reopen all', DataSource: 'S', Criteria: {}, Update: { $set: { Status: 'draft' } } },
				{ Kind: 'Update', Name: 'Settle one', DataSource: 'S', Criteria: { _id: 1 }, Update: { $set: { Status: 'settled' } } },
				{ Kind: 'Process', Name: 'No reopening', DataSource: 'S', Criteria: { Status: 'paid' }, Steps: [
					{ $when: { Check: { 'Event.Proposed.Status': 'draft' }, Then: [ { $throw: 'a paid document does not go back to draft' } ] } },
					{ $return: { Saw: '$Event.Update', Becomes: '$Event.Proposed.Status' } },
				], Into: 'Log' },
			],
			[ { Name: 'Gate', On: [ 'Update' ], When: 'Before', Process: 'No reopening' } ] );

		await session.Run( 'Seed' );
		let refused = await session.Run( 'Reopen all' );
		LIB_ASSERT.strictEqual( refused.Ok, false );
		LIB_ASSERT.ok( /does not go back to draft/.test( refused.Error.Message ), refused.Error.Message );
		LIB_ASSERT.deepStrictEqual( ( await all( session, 'S' ) ).map( function ( Row ) { return Row.Status; } ), [ 'paid', 'open' ], 'the open document was not changed either' );
		let allowed = await session.Run( 'Settle one' );
		LIB_ASSERT.strictEqual( allowed.Ok, true, JSON.stringify( allowed.Error ) );
		LIB_ASSERT.deepStrictEqual( ( await all( session, 'S' ) ).map( function ( Row ) { return Row.Status; } ), [ 'settled', 'open' ] );
		LIB_ASSERT.deepStrictEqual( ( await all( session, 'Log' ) ).map( function ( Row ) { return JSON.stringify( Row.Saw ) + ' ' + Row.Becomes; } ), [ '{"$set":{"Status":"settled"}} settled' ] );
	} );

	it( 'cannot refuse After: the write stands, the object fails, and the failure says the write was made', async function ()
	{
		let session = session_for(
			[
				{ Kind: 'Insert', Name: 'Seed', DataSource: 'S', Documents: [ { _id: 1 }, { _id: 2 } ] },
				{ Kind: 'Delete', Name: 'Clear one', DataSource: 'S', Criteria: { _id: 1 } },
				{ Kind: 'Process', Name: 'Complain', DataSource: 'S', Steps: [ { $throw: 'too late' } ] },
			],
			[ { Name: 'Late', On: [ 'Delete' ], Process: 'Complain' } ] );

		await session.Run( 'Seed' );
		let report = await session.Run( 'Clear one' );
		LIB_ASSERT.strictEqual( report.Ok, false );
		LIB_ASSERT.ok( /The trigger \[Late\] failed: .*too late.*had been made, and stands/.test( report.Error.Message ), report.Error.Message );
		LIB_ASSERT.deepStrictEqual( ( await all( session, 'S' ) ).map( function ( Row ) { return Row._id; } ), [ 2 ], 'the delete was made' );
	} );

	it( 'fail the storage call, and so the object, when the triggered Process fails', async function ()
	{
		let session = session_for(
			[
				{ Kind: 'Process', Name: 'Refuse', DataSource: 'S', Steps: [ { $throw: 'not today' } ] },
				{ Kind: 'Insert', Name: 'Seed', DataSource: 'S', Documents: [ { _id: 1 } ] },
			],
			[ { Name: 'Guard', On: [ 'Insert' ], When: 'Before', Process: 'Refuse' } ] );

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
