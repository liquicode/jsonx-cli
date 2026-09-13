'use strict';

const LIB_ASSERT = require( 'assert' );
const { describe, it } = require( 'node:test' );

const jsongin = require( '@liquicode/jsongin' );

const Schema = require( '../src/File/Schema.js' );
const Validate = require( '../src/Validate/Validate.js' );
const Spec = require( './fixtures/Spec.js' );


//---------------------------------------------------------------------
describe( 'The schema copy', function ()
{

	it( 'equals Appendix A of the specification', function ()
	{
		LIB_ASSERT.deepStrictEqual( Schema.SCHEMA, Spec.AppendixA() );
	} );

	it( 'names the version on the specification\'s first line', function ()
	{
		let first_line = require( 'fs' ).readFileSync( Spec.SPEC_FILE, 'utf8' ).split( /\r?\n/ ).find( function ( Line ) { return /Version \d/.test( Line ); } );
		LIB_ASSERT.ok( first_line.includes( 'Version ' + Schema.SPEC_VERSION + ',' ), first_line );
	} );

} );


//---------------------------------------------------------------------
describe( 'Appendix B', function ()
{

	it( 'has no schema findings', function ()
	{
		LIB_ASSERT.deepStrictEqual( jsongin.ValidateDocument( Spec.AppendixB(), Schema.SCHEMA ), [] );
	} );

	it( 'has no findings at all', function ()
	{
		LIB_ASSERT.deepStrictEqual( Validate.ValidateFile( Spec.AppendixB(), { Env: {} } ), [] );
	} );

	it( 'has no findings with its settings checked against the real adapter catalog', function ()
	{
		let catalog = require( '../src/Session/AdapterCatalog.js' ).NewAdapterCatalog( { jsonstor: require( '@liquicode/jsonstor' )() } );
		LIB_ASSERT.deepStrictEqual( Validate.ValidateFile( Spec.AppendixB(), { Env: {}, CheckSettings: catalog.ValidateSettings } ), [] );

		let jsonfile = Spec.AppendixB();
		jsonfile.DataSources[ 1 ].AdapterName = 'jsonstor-jsonfile';
		let findings = Validate.ValidateFile( jsonfile, { Env: {}, CheckSettings: catalog.ValidateSettings } );
		LIB_ASSERT.deepStrictEqual( findings.map( function ( Finding ) { return Finding.Severity + ' ' + Finding.Path; } ), [ 'error DataSources.1.Settings.Path' ] );
	} );

} );
