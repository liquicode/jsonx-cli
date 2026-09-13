'use strict';

const LIB_ASSERT = require( 'assert' );
const { describe, it } = require( 'node:test' );

const AdapterCatalog = require( '../src/Session/AdapterCatalog.js' );


//---------------------------------------------------------------------
// A catalog over a fresh jsonstor whose package loads are counted, and optionally refused.

function catalog_with( Missing )
{
	let loads = [];
	let missing = Array.isArray( Missing ) ? Missing : [];
	let catalog = AdapterCatalog.NewAdapterCatalog( {
		jsonstor: require( '@liquicode/jsonstor' )(),
		Require: function ( PackageName )
		{
			loads.push( PackageName );
			if ( missing === 'all' || missing.includes( PackageName ) )
			{
				let error = new Error( 'Cannot find module \'' + PackageName + '\'' );
				error.code = 'MODULE_NOT_FOUND';
				throw error;
			}
			return require( PackageName );
		},
	} );
	return { Catalog: catalog, Loads: loads };
}

function external_count()
{
	return AdapterCatalog.DATA.filter( function ( Entry ) { return Entry.Kind === 'external'; } ).length;
}


//---------------------------------------------------------------------
describe( 'AdapterCatalog', function ()
{

	it( 'registers a built-in adapter without loading any package', function ()
	{
		let subject = catalog_with();
		LIB_ASSERT.strictEqual( subject.Catalog.Ensure( 'jsonstor-memory' ), true );
		LIB_ASSERT.deepStrictEqual( subject.Loads, [] );
	} );

	it( 'loads only the package the inventory names for an external adapter', function ()
	{
		let subject = catalog_with();
		LIB_ASSERT.strictEqual( subject.Catalog.Ensure( 'jsonstor-sqlite' ), true );
		LIB_ASSERT.deepStrictEqual( subject.Loads, [ '@liquicode/jsonstor-sqlite' ] );
		LIB_ASSERT.deepStrictEqual( subject.Catalog.Report.Loaded, [ '@liquicode/jsonstor-sqlite' ] );

		subject.Catalog.Ensure( 'jsonstor-sqlite' );
		LIB_ASSERT.strictEqual( subject.Loads.length, 1, 'a registered name loads nothing again' );
	} );

	it( 'warns about an adapter which is described but not installed, and still checks its settings', function ()
	{
		let subject = catalog_with( [ '@liquicode/jsonstor-mongodb' ] );
		let findings = subject.Catalog.ValidateSettings( 'jsonstor-mongodb', {} );

		LIB_ASSERT.deepStrictEqual( subject.Loads, [ '@liquicode/jsonstor-mongodb' ], 'no fallback load for a described name' );
		LIB_ASSERT.deepStrictEqual( subject.Catalog.Report.NotInstalled, [ '@liquicode/jsonstor-mongodb' ] );
		LIB_ASSERT.strictEqual( findings[ 0 ].Severity, 'warning' );
		LIB_ASSERT.ok( /not installed here; install @liquicode\/jsonstor-mongodb/.test( findings[ 0 ].Message ) );
		LIB_ASSERT.ok( findings.some( function ( Finding ) { return Finding.Severity === 'error' && Finding.Path === 'Settings.ConnectionString'; } ) );
	} );

	it( 'loads every external package once for a name nobody describes, then refuses it', function ()
	{
		let subject = catalog_with( 'all' );
		let findings = subject.Catalog.ValidateSettings( 'jsonstor-nope', {} );
		LIB_ASSERT.strictEqual( subject.Loads.length, external_count() );
		LIB_ASSERT.deepStrictEqual( findings.map( function ( Finding ) { return Finding.Severity + ' ' + Finding.Path; } ), [ 'error AdapterName' ] );

		subject.Catalog.Ensure( 'jsonstor-other' );
		LIB_ASSERT.strictEqual( subject.Loads.length, external_count(), 'the fallback runs once' );
	} );

	it( 'reports a package which loads but will not register as a failure', function ()
	{
		let catalog = AdapterCatalog.NewAdapterCatalog( {
			jsonstor: require( '@liquicode/jsonstor' )(),
			Require: function () { return { Nonsense: true }; },
		} );
		LIB_ASSERT.strictEqual( catalog.Ensure( 'jsonstor-redis' ), false );
		LIB_ASSERT.strictEqual( catalog.Report.Failed.length, 1 );
		LIB_ASSERT.strictEqual( catalog.Report.Failed[ 0 ].Package, '@liquicode/jsonstor-redis' );
		LIB_ASSERT.ok( /registered no adapter/.test( catalog.Report.Failed[ 0 ].Message ) );
	} );

	it( 'names the path settings the inventory marks', function ()
	{
		let catalog = catalog_with().Catalog;
		LIB_ASSERT.deepStrictEqual( catalog.PathSettings( 'jsonstor-jsonfile' ), [ 'Path' ] );
		LIB_ASSERT.deepStrictEqual( catalog.PathSettings( 'jsonstor-sqlite' ), [ 'Path' ] );
		LIB_ASSERT.deepStrictEqual( catalog.PathSettings( 'jsonstor-duckdb' ), [ 'Database' ] );
		LIB_ASSERT.deepStrictEqual( catalog.PathSettings( 'jsonstor-memory' ), [] );
		LIB_ASSERT.deepStrictEqual( catalog.PathSettings( 'jsonstor-browser' ), [], 'a browser path is not a file system path' );
	} );

	it( 'checks required settings, types and undescribed settings; an environment reference fits any type', function ()
	{
		let catalog = catalog_with().Catalog;
		let findings = catalog.ValidateSettings( 'jsonstor-jsonfile', { Path: 5, HostIndex: '${env:INDEX}', Extra: 1 } );
		LIB_ASSERT.deepStrictEqual( findings.map( function ( Finding ) { return Finding.Severity + ' ' + Finding.Path; } ), [
			'error Settings.Path',
			'warning Settings.Extra',
		] );
		LIB_ASSERT.ok( /Path is required/.test( catalog.ValidateSettings( 'jsonstor-jsonfile', {} )[ 0 ].Message ) );
	} );

} );
