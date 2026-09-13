'use strict';

const LIB_ASSERT = require( 'assert' );
const LIB_PATH = require( 'path' );
const { describe, it } = require( 'node:test' );

const Overrides = require( '../src/Session/Overrides.js' );


const CWD = LIB_PATH.resolve( '/typed/here' );

function document()
{
	return {
		DataSources: [
			{ Name: 'Book', AdapterName: 'jsonstor-jsonfile', Settings: { Path: 'book.json' } },
			{ Name: 'Book.Archive', AdapterName: 'jsonstor-jsonfile', Settings: { Path: 'archive.json' } },
			{ Name: 'Lookup', AdapterName: 'jsonstor-memory' },
		],
	};
}

function path_settings( AdapterName )
{
	return ( AdapterName === 'jsonstor-jsonfile' || AdapterName === 'jsonstor-sqlite' ) ? [ 'Path' ] : [];
}

function apply( Binds, Sets, Document )
{
	return Overrides.Apply( Document || document(), Binds, Sets, CWD, path_settings );
}


//---------------------------------------------------------------------
describe( 'Overrides', function ()
{

	it( 'knows a relative path from an absolute one, a special name, a URL, and a non-string', function ()
	{
		LIB_ASSERT.strictEqual( Overrides.IsRelativePath( 'data/b.json' ), true );
		LIB_ASSERT.strictEqual( Overrides.IsRelativePath( LIB_PATH.resolve( '/abs/b.json' ) ), false );
		LIB_ASSERT.strictEqual( Overrides.IsRelativePath( ':memory:' ), false );
		LIB_ASSERT.strictEqual( Overrides.IsRelativePath( 'https://example.org/x' ), false );
		LIB_ASSERT.strictEqual( Overrides.IsRelativePath( '' ), false );
		LIB_ASSERT.strictEqual( Overrides.IsRelativePath( 5 ), false );
	} );

	it( 'returns every declared data source, copied, when there are no overrides', function ()
	{
		let source = document();
		let definitions = apply( [], [], source );
		LIB_ASSERT.deepStrictEqual( Object.keys( definitions ), [ 'Book', 'Book.Archive', 'Lookup' ] );
		definitions.Book.Settings.Path = 'changed';
		LIB_ASSERT.strictEqual( source.DataSources[ 0 ].Settings.Path, 'book.json' );
	} );

	it( 'binds an adapter, with and without settings, and makes a typed path absolute', function ()
	{
		let definitions = apply( [ 'Lookup=jsonstor-sqlite:{"Path":"test.db","Table":"T"}', 'Book=jsonstor-memory' ] );
		LIB_ASSERT.deepStrictEqual( definitions.Lookup, {
			Name: 'Lookup', AdapterName: 'jsonstor-sqlite', Settings: { Path: LIB_PATH.join( CWD, 'test.db' ), Table: 'T' },
		} );
		LIB_ASSERT.strictEqual( definitions.Book.AdapterName, 'jsonstor-memory' );
		LIB_ASSERT.deepStrictEqual( definitions.Book.Settings, {} );
	} );

	it( 'sets a setting, reading JSON where it can, and picks the longest data source name', function ()
	{
		let definitions = apply( [], [
			'Book.Archive.Settings.Path=copy.json',
			'Book.Settings.HostIndex=true',
			'Book.Settings.Nested.Depth=3',
			'Lookup.AdapterName=jsonstor-folder',
		] );
		LIB_ASSERT.strictEqual( definitions[ 'Book.Archive' ].Settings.Path, LIB_PATH.join( CWD, 'copy.json' ) );
		LIB_ASSERT.strictEqual( definitions.Book.Settings.Path, 'book.json', 'the file\'s own relative path is left for the session' );
		LIB_ASSERT.strictEqual( definitions.Book.Settings.HostIndex, true );
		LIB_ASSERT.deepStrictEqual( definitions.Book.Settings.Nested, { Depth: 3 } );
		LIB_ASSERT.strictEqual( definitions.Lookup.AdapterName, 'jsonstor-folder' );
	} );

	it( 'leaves an environment reference in a typed path alone', function ()
	{
		let definitions = apply( [], [ 'Book.Settings.Path=${env:BOOK}' ] );
		LIB_ASSERT.strictEqual( definitions.Book.Settings.Path, '${env:BOOK}' );
	} );

	it( 'refuses to create a name, and refuses malformed tokens', function ()
	{
		LIB_ASSERT.throws( function () { apply( [ 'Nobody=jsonstor-memory' ] ); }, /not a data source of this file; an override never creates a name/ );
		LIB_ASSERT.throws( function () { apply( [], [ 'Nobody.Settings.Path=x' ] ); }, /never creates a name/ );
		LIB_ASSERT.throws( function () { apply( [ 'Book' ] ); }, /must be Name=adapter/ );
		LIB_ASSERT.throws( function () { apply( [ 'Book=' ] ); }, /names no adapter/ );
		LIB_ASSERT.throws( function () { apply( [ 'Book=jsonstor-memory:{nope' ] ); }, /not valid JSON/ );
		LIB_ASSERT.throws( function () { apply( [ 'Book=jsonstor-memory:[1]' ] ); }, /must be a JSON object/ );
		LIB_ASSERT.throws( function () { apply( [], [ 'Book.Filters=[]' ] ); }, /can change Book\.AdapterName or Book\.Settings\.<key>/ );
		LIB_ASSERT.throws( function () { apply( [], [ 'Book.Settings.Path' ] ); }, /must be Name\.Settings\.Key=value/ );
	} );

} );
