'use strict';

const LIB_ASSERT = require( 'assert' );
const { describe, it } = require( 'node:test' );

const Session = require( '../src/Session/Session.js' );
const Inspect = require( '../src/Session/Inspect.js' );


//---------------------------------------------------------------------
describe( 'Inspect', function ()
{

	async function seeded()
	{
		let session = Session.NewSession( {
			Document: { DataSources: [ { Name: 'Bookings', AdapterName: 'jsonstor-memory' } ] },
			Env: {},
		} );
		await session.DataSources.Open( 'Bookings' ).InsertMany( [
			{ _id: 'b-1', Telescope: 'Meridian 40', Hours: 4, Tags: [ 'deep' ] },
			{ _id: 'b-2', Telescope: 'Dobson 30', Hours: 8, Tags: [] },
			{ _id: 'b-3', Telescope: 'Dobson 30', Hours: 2 },
		] );
		return session;
	}

	it( 'reports StorageInfo and the dialect boundary check', async function ()
	{
		let session = await seeded();
		let info = await Inspect.Info( session, 'Bookings' );
		LIB_ASSERT.strictEqual( info.Name, 'Bookings' );
		LIB_ASSERT.strictEqual( info.AdapterName, 'jsonstor-memory' );
		LIB_ASSERT.strictEqual( info.Info.Dialect, 'jsonstor-memory' );
		LIB_ASSERT.deepStrictEqual( info.Boundary, [] );
	} );

	it( 'describes a data source with an inferred schema and the first rows', async function ()
	{
		let session = await seeded();
		let description = await Inspect.Describe( session, 'Bookings', 2 );
		LIB_ASSERT.strictEqual( description.Samples.length, 2 );
		LIB_ASSERT.strictEqual( description.Schema.type, 'object' );
		LIB_ASSERT.ok( description.Schema.properties.Hours, JSON.stringify( description.Schema ) );
		LIB_ASSERT.strictEqual( description.Schema.properties.Tags.type, 'array', 'an array path is marked' );

		LIB_ASSERT.strictEqual( ( await Inspect.Describe( session, 'Bookings' ) ).Samples.length, 3 );
	} );

} );
