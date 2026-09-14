'use strict';

const LIB_ASSERT = require( 'assert' );
const LIB_CHILD_PROCESS = require( 'child_process' );
const LIB_FS = require( 'fs' );
const LIB_OS = require( 'os' );
const LIB_PATH = require( 'path' );
const { describe, it, before, after } = require( 'node:test' );

const Adapters = require( '../src/Adapters/Adapters.js' );
const AdapterCatalog = require( '../src/Session/AdapterCatalog.js' );

const BIN = LIB_PATH.resolve( __dirname, '..', 'bin', 'jsonx.js' );


//---------------------------------------------------------------------
// A package resolver and loader in memory: which packages are installed, what each exports, and
// how many loads were asked for.

function fake_packages( Installed, Exports )
{
	let fake = { Loads: [] };
	fake.Resolve = function ( PackageName )
	{
		if ( !Installed.includes( PackageName ) ) { let error = new Error( 'Cannot find module ' + PackageName ); error.code = 'MODULE_NOT_FOUND'; throw error; }
		return '/fake/' + PackageName;
	};
	fake.Require = function ( PackageName )
	{
		fake.Loads.push( PackageName );
		if ( !Installed.includes( PackageName ) ) { let error = new Error( 'Cannot find module ' + PackageName ); error.code = 'MODULE_NOT_FOUND'; throw error; }
		return Exports[ PackageName ] || {};
	};
	return fake;
}

const REDIS_FAMILY = {
	'@liquicode/jsonstor-redis': {
		Adapters: [ { AdapterName: 'jsonstor-redis-v6.2' } ],
		Aliases: {
			'jsonstor-valkey': 'jsonstor-redis-v6.2',
			'jsonstor-redis-v8.10': 'jsonstor-redis-v6.2',
			'jsonstor-redis': 'jsonstor-redis-v6.2',
			'jsonstor-redis-v7': 'jsonstor-redis-v6.2',
		},
	},
};


//---------------------------------------------------------------------
describe( 'Adapters', function ()
{

	it( 'lists one row per package and loads none of them', function ()
	{
		let fake = fake_packages( [ '@liquicode/jsonstor-redis' ], REDIS_FAMILY );
		let rows = Adapters.NewAdapters( { Require: fake.Require, Resolve: fake.Resolve } ).List();

		LIB_ASSERT.strictEqual( rows.length, AdapterCatalog.DATA.length );
		LIB_ASSERT.deepStrictEqual( fake.Loads, [] );
		LIB_ASSERT.strictEqual( rows.find( function ( Row ) { return Row.AdapterName === 'jsonstor-memory'; } ).Installed, true );
		LIB_ASSERT.strictEqual( rows.find( function ( Row ) { return Row.AdapterName === 'jsonstor-redis'; } ).Installed, true );
		LIB_ASSERT.strictEqual( rows.find( function ( Row ) { return Row.AdapterName === 'jsonstor-mysql'; } ).Installed, false );
		LIB_ASSERT.ok( rows.every( function ( Row ) { return !/valkey|-v\d/.test( Row.AdapterName ); } ), 'no alias is a row' );
	} );

	it( 'names a package\'s primes first by version, then its aliases with the bare name first', function ()
	{
		let fake = fake_packages( [ '@liquicode/jsonstor-redis' ], REDIS_FAMILY );
		let info = Adapters.NewAdapters( { Require: fake.Require, Resolve: fake.Resolve } ).Info( 'jsonstor-redis' );

		LIB_ASSERT.deepStrictEqual( info.Names.map( function ( Row ) { return Row.Name; } ), [
			'jsonstor-redis-v6.2', 'jsonstor-redis', 'jsonstor-redis-v7', 'jsonstor-redis-v8.10', 'jsonstor-valkey',
		] );
		LIB_ASSERT.deepStrictEqual( info.Names[ 0 ], { Name: 'jsonstor-redis-v6.2', AliasOf: null, MeasuredAgainst: '6.2' } );
		LIB_ASSERT.deepStrictEqual( info.Names[ 3 ], { Name: 'jsonstor-redis-v8.10', AliasOf: 'jsonstor-redis-v6.2', MeasuredAgainst: '8.10' } );
		LIB_ASSERT.strictEqual( info.Names[ 1 ].MeasuredAgainst, null );
		LIB_ASSERT.strictEqual( info.Driver.Name, 'redis' );
		LIB_ASSERT.strictEqual( typeof info.Requested, 'undefined' );
	} );

	it( 'finds a package by a target name without loading, and by an alias only an installed package carries', function ()
	{
		let fake = fake_packages( [ '@liquicode/jsonstor-redis' ], REDIS_FAMILY );
		let adapters = Adapters.NewAdapters( { Require: fake.Require, Resolve: fake.Resolve } );

		LIB_ASSERT.strictEqual( adapters.Settings( 'jsonstor-valkey-v8.1' ).AdapterName, 'jsonstor-valkey-v8.1' );
		LIB_ASSERT.deepStrictEqual( fake.Loads, [], 'a target name needs no load' );

		let info = adapters.Info( 'jsonstor-valkey' );
		LIB_ASSERT.strictEqual( info.AdapterName, 'jsonstor-redis' );
		LIB_ASSERT.strictEqual( info.Requested, 'jsonstor-valkey' );
		LIB_ASSERT.ok( fake.Loads.includes( '@liquicode/jsonstor-redis' ) );
		LIB_ASSERT.ok( !fake.Loads.includes( '@liquicode/jsonstor-mysql' ), 'a package not installed is never loaded' );
	} );

	it( 'shows a package not installed from the inventory alone', function ()
	{
		let fake = fake_packages( [], {} );
		let info = Adapters.NewAdapters( { Require: fake.Require, Resolve: fake.Resolve } ).Info( 'jsonstor-mysql' );
		LIB_ASSERT.strictEqual( info.Installed, false );
		LIB_ASSERT.strictEqual( typeof info.Names, 'undefined' );
		LIB_ASSERT.ok( info.Settings.length > 0 );
		LIB_ASSERT.deepStrictEqual( fake.Loads, [] );
	} );

	it( 'refuses a name no adapter answers to', function ()
	{
		let fake = fake_packages( [], {} );
		LIB_ASSERT.throws( function () { Adapters.NewAdapters( { Require: fake.Require, Resolve: fake.Resolve } ).Info( 'jsonstor-nothing' ); }, Adapters.AdaptersError );
	} );

	it( 'gives every adapter a settings skeleton its own settings check accepts', function ()
	{
		let fake = fake_packages( [], {} );
		let adapters = Adapters.NewAdapters( { Require: fake.Require, Resolve: fake.Resolve } );
		let catalog = AdapterCatalog.NewAdapterCatalog( { jsonstor: require( '@liquicode/jsonstor' )(), Require: fake.Require } );

		for ( let index = 0; index < AdapterCatalog.DATA.length; index++ )
		{
			let name = AdapterCatalog.DATA[ index ].AdapterName;
			let skeleton = adapters.Settings( name, 'Local' );
			LIB_ASSERT.strictEqual( skeleton.Name, 'Local' );
			let errors = catalog.ValidateSettings( name, skeleton.Settings ).filter( function ( Finding ) { return Finding.Severity === 'error'; } );
			LIB_ASSERT.deepStrictEqual( errors, [], name );
		}
	} );

	it( 'takes a default only when it is JSON of the setting\'s type, and names the entry', function ()
	{
		let data = [ { AdapterName: 'x', Kind: 'built-in', Package: 'p', Description: '', Targets: [], Settings: [
			{ Name: 'Key', Type: 'string', Required: false, Default: '"_id"', Description: '' },
			{ Name: 'None', Type: 'string', Required: false, Default: '-', Description: '' },
			{ Name: 'Wrong', Type: 'number', Required: false, Default: '"many"', Description: '' },
			{ Name: 'Needed', Type: 'number', Required: true, Default: '-', Description: '' },
			{ Name: 'Columns', Type: 'ColumnDefinition[]', Required: true, Default: '-', Description: '' },
		] } ];
		LIB_ASSERT.deepStrictEqual( Adapters.NewAdapters( { Data: data } ).Settings( 'x' ), { Name: 'New data source', AdapterName: 'x', Settings: { Key: '_id', Needed: 0, Columns: [] } } );
	} );

} );


//---------------------------------------------------------------------
describe( 'jsonx adapters', function ()
{

	let root = null;

	function cli( Argv, Stdin )
	{
		let env = Object.assign( {}, process.env );
		delete env.JSONX_FILE;
		let result = LIB_CHILD_PROCESS.spawnSync( process.execPath, [ BIN ].concat( Argv ), { cwd: root, env: env, encoding: 'utf8', input: Stdin } );
		return { Code: result.status, Stdout: result.stdout, Stderr: result.stderr };
	}

	before( function ()
	{
		root = LIB_FS.mkdtempSync( LIB_PATH.join( LIB_OS.tmpdir(), 'jsonx-adapters-' ) );
		LIB_FS.writeFileSync( LIB_PATH.join( root, 'empty.jsonx' ), '{ "DataSources": [] }' );
	} );

	after( function ()
	{
		LIB_FS.rmSync( root, { recursive: true, force: true } );
	} );

	it( 'pipes a settings skeleton into datasource add', function ()
	{
		let skeleton = cli( [ 'adapters', 'settings', 'jsonstor-jsonfile', '--data-source', 'Local' ] );
		LIB_ASSERT.strictEqual( skeleton.Code, 0, skeleton.Stderr );

		let added = cli( [ 'datasource', 'add', '--json', '-' ], skeleton.Stdout );
		LIB_ASSERT.strictEqual( added.Code, 0, added.Stderr );
		let file = JSON.parse( LIB_FS.readFileSync( LIB_PATH.join( root, 'empty.jsonx' ), 'utf8' ) );
		LIB_ASSERT.strictEqual( file.DataSources[ 0 ].Name, 'Local' );
		LIB_ASSERT.strictEqual( file.DataSources[ 0 ].AdapterName, 'jsonstor-jsonfile' );
	} );

	it( 'names the prime behind an installed alias', function ( Context )
	{
		try { require.resolve( '@liquicode/jsonstor-mysql' ); }
		catch ( error ) { Context.skip( '@liquicode/jsonstor-mysql is not installed here.' ); return; }

		let result = cli( [ 'adapters', 'info', 'jsonstor-mysql-v8.4' ] );
		LIB_ASSERT.strictEqual( result.Code, 0, result.Stderr );
		let info = JSON.parse( result.Stdout );
		LIB_ASSERT.strictEqual( info.AdapterName, 'jsonstor-mysql' );
		LIB_ASSERT.strictEqual( info.Requested, 'jsonstor-mysql-v8.4' );
		let row = info.Names.find( function ( Row ) { return Row.Name === 'jsonstor-mysql-v8.4'; } );
		LIB_ASSERT.strictEqual( row.MeasuredAgainst, '8.4' );
		LIB_ASSERT.strictEqual( info.Names[ 0 ].AliasOf, null );
		LIB_ASSERT.strictEqual( row.AliasOf, info.Names[ 0 ].Name );
	} );

	it( 'lists quickly, and exits 2 for an unknown name and for --file', function ()
	{
		let started = Date.now();
		let listed = cli( [ 'adapters', 'list' ] );
		LIB_ASSERT.strictEqual( listed.Code, 0, listed.Stderr );
		LIB_ASSERT.ok( Date.now() - started < 3000, 'listing took ' + ( Date.now() - started ) + ' ms' );
		LIB_ASSERT.strictEqual( JSON.parse( listed.Stdout ).length, AdapterCatalog.DATA.length );

		let unknown = cli( [ 'adapters', 'info', 'jsonstor-nothing' ] );
		LIB_ASSERT.strictEqual( unknown.Code, 2 );
		LIB_ASSERT.match( unknown.Stderr, /No adapter answers to \[jsonstor-nothing\]/ );

		LIB_ASSERT.strictEqual( cli( [ 'adapters', 'list', '--file', 'empty.jsonx' ] ).Code, 2 );
	} );

} );
