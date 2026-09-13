'use strict';

const LIB_ASSERT = require( 'assert' );
const { describe, it } = require( 'node:test' );

const Environment = require( '../src/Session/Environment.js' );


const SOURCE = {
	Name: 'Assignments',
	AdapterName: 'jsonstor-postgres',
	Settings: {
		ConnectionString: 'postgres://app:${env:DB_PASSWORD}@${env:DB_HOST}/season',
		Port: 5432,
		Nested: { Tokens: [ '${env:TOKEN}' ] },
	},
	Filters: [ { FilterName: 'jsonstor-userinfo', Settings: { Key: '${env:USER_KEY}' } } ],
};


//---------------------------------------------------------------------
describe( 'Environment', function ()
{

	it( 'finds every reference in Settings and in filter Settings, with its path', function ()
	{
		LIB_ASSERT.deepStrictEqual( Environment.References( SOURCE ), [
			{ Name: 'DB_PASSWORD', Path: 'Settings.ConnectionString' },
			{ Name: 'DB_HOST', Path: 'Settings.ConnectionString' },
			{ Name: 'TOKEN', Path: 'Settings.Nested.Tokens.0' },
			{ Name: 'USER_KEY', Path: 'Filters.0.Settings.Key' },
		] );
	} );

	it( 'replaces references inside a longer string and leaves other values alone', function ()
	{
		let resolved = Environment.Resolve( SOURCE.Settings, { DB_PASSWORD: 's3cret', DB_HOST: 'db', TOKEN: 't' } );
		LIB_ASSERT.deepStrictEqual( resolved, {
			ConnectionString: 'postgres://app:s3cret@db/season',
			Port: 5432,
			Nested: { Tokens: [ 't' ] },
		} );
		LIB_ASSERT.ok( SOURCE.Settings.ConnectionString.includes( '${env:DB_PASSWORD}' ), 'the entry is not changed' );
	} );

	it( 'throws naming an unset variable, and counts an empty string as set', function ()
	{
		LIB_ASSERT.throws( function () { Environment.Resolve( SOURCE.Settings, { DB_PASSWORD: '' } ); }, /DB_HOST is not set/ );
		LIB_ASSERT.strictEqual( Environment.IsSet( { A: '' }, 'A' ), true );
		LIB_ASSERT.strictEqual( Environment.IsSet( {}, 'A' ), false );
	} );

	it( 'masks an entry as written, sharing nothing with it', function ()
	{
		let masked = Environment.Mask( SOURCE );
		LIB_ASSERT.deepStrictEqual( masked, SOURCE );
		LIB_ASSERT.notStrictEqual( masked.Settings, SOURCE.Settings );
	} );

} );
