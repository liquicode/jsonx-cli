'use strict';

const LIB_ASSERT = require( 'assert' );
const LIB_FS = require( 'fs' );
const LIB_OS = require( 'os' );
const LIB_PATH = require( 'path' );
const { describe, it, before, after } = require( 'node:test' );

const AdapterCatalog = require( '../src/Session/AdapterCatalog.js' );
const DataSources = require( '../src/Session/DataSources.js' );


//---------------------------------------------------------------------
function sources( Document, Extra )
{
	let jsonstor = require( '@liquicode/jsonstor' )();
	let options = Object.assign( {
		Document: Document,
		jsonstor: jsonstor,
		Catalog: AdapterCatalog.NewAdapterCatalog( { jsonstor: jsonstor } ),
		Env: {},
	}, Extra || {} );
	if ( Extra && Extra.Require )
	{
		options.Catalog = AdapterCatalog.NewAdapterCatalog( { jsonstor: jsonstor, Require: Extra.Require } );
	}
	return DataSources.NewDataSources( options );
}


//---------------------------------------------------------------------
describe( 'DataSources', function ()
{

	let root = null;

	before( function () { root = LIB_FS.mkdtempSync( LIB_PATH.join( LIB_OS.tmpdir(), 'jsonx-sources-' ) ); } );
	after( function () { LIB_FS.rmSync( root, { recursive: true, force: true } ); } );

	it( 'opens nothing until asked, then holds one storage per name', async function ()
	{
		let subject = sources( { DataSources: [ { Name: 'Scratch', AdapterName: 'jsonstor-memory' } ] } );
		LIB_ASSERT.deepStrictEqual( subject.Opened(), [] );

		let storage = subject.Open( 'Scratch' );
		await storage.InsertOne( { _id: 'a' } );
		LIB_ASSERT.strictEqual( subject.Open( 'Scratch' ), storage );
		LIB_ASSERT.strictEqual( await subject.Open( 'Scratch' ).Count( {} ), 1 );
		LIB_ASSERT.deepStrictEqual( subject.Opened(), [ 'Scratch' ] );
	} );

	it( 'refuses a name the file does not define', function ()
	{
		let subject = sources( { DataSources: [] } );
		LIB_ASSERT.throws( function () { subject.Open( 'Nobody' ); }, function ( Error ) { return ( Error instanceof DataSources.DataSourceError ) && /No data source is named \[Nobody\]/.test( Error.message ); } );
		LIB_ASSERT.throws( function () { subject.Definition( 'Nobody' ); }, /No data source is named/ );
	} );

	it( 'opens a relative path beside the jsonx file, and Release flushes it', async function ()
	{
		let project = LIB_PATH.join( root, 'project' );
		LIB_FS.mkdirSync( project );
		let subject = sources(
			{ DataSources: [ { Name: 'Bookings', AdapterName: 'jsonstor-jsonfile', Settings: { Path: 'bookings.json', AutoFlush: false } } ] },
			{ FilePath: LIB_PATH.join( project, 'season.jsonx' ), Cwd: root } );

		await subject.Open( 'Bookings' ).InsertOne( { _id: 'b-1' } );
		LIB_ASSERT.strictEqual( await subject.Release(), 1 );
		LIB_ASSERT.deepStrictEqual( subject.Opened(), [] );
		LIB_ASSERT.ok( LIB_FS.existsSync( LIB_PATH.join( project, 'bookings.json' ) ), 'written beside the file' );
		LIB_ASSERT.ok( !LIB_FS.existsSync( LIB_PATH.join( root, 'bookings.json' ) ), 'not in the working directory' );
		LIB_ASSERT.strictEqual( subject.Definition( 'Bookings' ).Settings.Path, 'bookings.json', 'the definition stays as written' );
	} );

	it( 'opens an overriding path in the working directory it was typed in', async function ()
	{
		let typed_in = LIB_PATH.join( root, 'typed' );
		LIB_FS.mkdirSync( typed_in );
		let subject = sources(
			{ DataSources: [ { Name: 'Bookings', AdapterName: 'jsonstor-jsonfile', Settings: { Path: 'bookings.json' } } ] },
			{ FilePath: LIB_PATH.join( root, 'elsewhere', 'season.jsonx' ), Cwd: typed_in, Sets: [ 'Bookings.Settings.Path=copy.json' ] } );

		await subject.Open( 'Bookings' ).InsertOne( { _id: 'b-1' } );
		await subject.Release();
		LIB_ASSERT.ok( LIB_FS.existsSync( LIB_PATH.join( typed_in, 'copy.json' ) ) );
	} );

	it( 'resolves an environment reference when it opens, and fails naming an unset one', async function ()
	{
		let document = { DataSources: [ { Name: 'Bookings', AdapterName: 'jsonstor-jsonfile', Settings: { Path: '${env:JSONX_BOOKINGS}' } } ] };

		let subject = sources( document, { FilePath: LIB_PATH.join( root, 'season.jsonx' ), Env: { JSONX_BOOKINGS: 'from-env.json' } } );
		await subject.Open( 'Bookings' ).InsertOne( { _id: 'x' } );
		await subject.Release();
		LIB_ASSERT.ok( LIB_FS.existsSync( LIB_PATH.join( root, 'from-env.json' ) ), 'the resolved relative value is relative to the file' );
		LIB_ASSERT.strictEqual( subject.Definition( 'Bookings' ).Settings.Path, '${env:JSONX_BOOKINGS}' );

		let unset = sources( document, { Env: {} } );
		LIB_ASSERT.throws( function () { unset.Open( 'Bookings' ); }, /JSONX_BOOKINGS is not set/ );
	} );

	it( 'passes a special name such as :memory: to the adapter untouched', async function ()
	{
		let subject = sources(
			{ DataSources: [ { Name: 'Lookup', AdapterName: 'jsonstor-sqlite', Settings: { Path: ':memory:', Table: 'Lookup', ModifySchema: true } } ] },
			{ FilePath: LIB_PATH.join( root, 'season.jsonx' ) } );
		let storage = subject.Open( 'Lookup' );
		await storage.InsertOne( { _id: 'x' } );
		LIB_ASSERT.strictEqual( await storage.Count( {} ), 1 );
		await subject.Release();
		LIB_ASSERT.ok( !LIB_FS.existsSync( LIB_PATH.join( root, ':memory:' ) ) );
	} );

	it( 'refuses to open an adapter which is not installed, naming the package', function ()
	{
		let subject = sources(
			{ DataSources: [ { Name: 'Orders', AdapterName: 'jsonstor-mongodb', Settings: {} } ] },
			{
				Require: function ( PackageName )
				{
					let error = new Error( 'Cannot find module \'' + PackageName + '\'' );
					error.code = 'MODULE_NOT_FOUND';
					throw error;
				},
			} );
		LIB_ASSERT.throws( function () { subject.Open( 'Orders' ); }, /\[jsonstor-mongodb\] is not installed here\. Install @liquicode\/jsonstor-mongodb\./ );
	} );

	it( 'places the session\'s inner filters before the declared ones', function ()
	{
		let seen = [];
		let jsonstor = require( '@liquicode/jsonstor' )();
		let original = jsonstor.GetStorage;
		jsonstor.GetStorage = function ( AdapterName, Settings, Filters ) { seen.push( Filters.map( function ( Filter ) { return Filter.FilterName; } ) ); return original.call( jsonstor, AdapterName, Settings, [] ); };

		let subject = DataSources.NewDataSources( {
			Document: { DataSources: [ { Name: 'S', AdapterName: 'jsonstor-memory', Filters: [ { FilterName: 'jsonstor-oplog', Settings: { Key: '${env:K}' } } ] } ] },
			jsonstor: jsonstor,
			Catalog: AdapterCatalog.NewAdapterCatalog( { jsonstor: jsonstor } ),
			Env: { K: 'k' },
			InnerFilters: function ( Name ) { return [ { FilterName: 'inner-for-' + Name, Settings: {} } ]; },
		} );
		subject.Open( 'S' );
		LIB_ASSERT.deepStrictEqual( seen, [ [ 'inner-for-S', 'jsonstor-oplog' ] ] );
	} );

} );
