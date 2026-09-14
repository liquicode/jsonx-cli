'use strict';

const LIB_ASSERT = require( 'assert' );
const LIB_CHILD_PROCESS = require( 'child_process' );
const LIB_FS = require( 'fs' );
const LIB_OS = require( 'os' );
const LIB_PATH = require( 'path' );
const { describe, it, beforeEach, afterEach } = require( 'node:test' );

const jsongin = require( '@liquicode/jsongin' );
const jsonproc = require( '@liquicode/jsonproc' );

const Format = require( '../src/File/Format.js' );
const Skeletons = require( '../src/File/Skeletons.js' );
const Writer = require( '../src/File/Writer.js' );
const Edit = require( '../src/File/Edit.js' );
const Validate = require( '../src/Validate/Validate.js' );
const Session = require( '../src/Session/Session.js' );
const Spec = require( './fixtures/Spec.js' );

const BIN = LIB_PATH.resolve( __dirname, '..', 'bin', 'jsonx.js' );


function errors_in( Document )
{
	return Validate.ValidateFile( Document, { jsongin: jsongin, jsonproc: jsonproc, Env: {} } ).filter( function ( Finding ) { return Finding.Severity === 'error'; } );
}


//---------------------------------------------------------------------
describe( 'Format', function ()
{

	it( 'orders the file, each data source, object and trigger as Appendix A lists them', function ()
	{
		let document = {
			Triggers: [ { Process: 'P', Name: 'T' } ],
			Objects: [
				{ Into: 'C', Steps: [], DataSource: 'S', Name: 'P', Kind: 'Process' },
				{ Update: { $set: { a: 1 } }, FirstOnly: true, Criteria: {}, DataSource: 'S', Name: 'U', Kind: 'Update' },
			],
			DataSources: [ { Settings: {}, AdapterName: 'jsonstor-memory', Name: 'S' } ],
			Name: 'F',
			Jsonx: '0.2',
		};
		let formatted = Format.FormatDocument( document );

		LIB_ASSERT.deepStrictEqual( Object.keys( formatted ), [ 'Jsonx', 'Name', 'DataSources', 'Objects', 'Triggers' ] );
		LIB_ASSERT.deepStrictEqual( Object.keys( formatted.DataSources[ 0 ] ), [ 'Name', 'AdapterName', 'Settings' ] );
		LIB_ASSERT.deepStrictEqual( Object.keys( formatted.Objects[ 0 ] ), [ 'Kind', 'Name', 'DataSource', 'Steps', 'Into' ] );
		LIB_ASSERT.deepStrictEqual( Object.keys( formatted.Objects[ 1 ] ), [ 'Kind', 'Name', 'DataSource', 'Criteria', 'Update', 'FirstOnly' ] );
		LIB_ASSERT.deepStrictEqual( Object.keys( formatted.Triggers[ 0 ] ), [ 'Name', 'Process' ] );
	} );

	it( 'keeps unknown fields after the named ones, in the order read, and never touches arrays or values', function ()
	{
		let document = {
			Zeta: 1,
			Objects: [
				{ Later: true, Kind: 'Delete', Criteria: { b: 1, a: 2 }, Earlier: true, Name: 'D', DataSource: 'S' },
				{ Kind: 'Nonsense', Other: 1, Name: 'N' },
			],
			Alpha: 2,
			DataSources: [ { Name: 'B', AdapterName: 'x' }, { Name: 'A', AdapterName: 'x' } ],
		};
		let formatted = Format.FormatDocument( document );

		LIB_ASSERT.deepStrictEqual( Object.keys( formatted ), [ 'DataSources', 'Objects', 'Zeta', 'Alpha' ] );
		LIB_ASSERT.deepStrictEqual( Object.keys( formatted.Objects[ 0 ] ), [ 'Kind', 'Name', 'DataSource', 'Criteria', 'Later', 'Earlier' ] );
		LIB_ASSERT.deepStrictEqual( Object.keys( formatted.Objects[ 0 ].Criteria ), [ 'b', 'a' ] );
		LIB_ASSERT.deepStrictEqual( Object.keys( formatted.Objects[ 1 ] ), [ 'Kind', 'Name', 'Other' ] );
		LIB_ASSERT.deepStrictEqual( formatted.DataSources.map( function ( Source ) { return Source.Name; } ), [ 'B', 'A' ] );
	} );

	it( 'is idempotent, leaves its input unchanged, and finds Appendix B already in order', function ()
	{
		let document = { Objects: [ { Name: 'Q', Kind: 'Query', Criteria: {}, DataSource: 'S' } ] };
		let before = JSON.stringify( document );
		let once = Format.FormatDocument( document );
		LIB_ASSERT.strictEqual( JSON.stringify( document ), before );
		LIB_ASSERT.strictEqual( JSON.stringify( Format.FormatDocument( once ) ), JSON.stringify( once ) );

		let appendix = Spec.AppendixB();
		LIB_ASSERT.strictEqual( JSON.stringify( Format.FormatDocument( appendix ) ), JSON.stringify( appendix ), 'the specification\'s own file is in canonical order' );
	} );

	it( 'reads a difference of line endings or a BOM alone as formatted', function ()
	{
		let canonical = Writer.FormatDocument( { Name: 'F' } );
		LIB_ASSERT.strictEqual( Format.IsFormatted( canonical, canonical ), true );
		LIB_ASSERT.strictEqual( Format.IsFormatted( '﻿' + canonical.replace( /\n/g, '\r\n' ), canonical ), true );
		LIB_ASSERT.strictEqual( Format.IsFormatted( JSON.stringify( { Name: 'F' }, null, 2 ) + '\n', canonical ), false );
	} );

} );


//---------------------------------------------------------------------
describe( 'Skeletons', function ()
{

	it( 'writes a file which validates with no errors and runs', async function ()
	{
		let file = Skeletons.Skeleton( 'file', 'Try' );
		LIB_ASSERT.strictEqual( file.Name, 'Try' );
		LIB_ASSERT.deepStrictEqual( errors_in( file ), [] );

		let session = Session.NewSession( { Document: file, Env: {} } );
		let report = await session.Run( 'Run everything' );
		LIB_ASSERT.strictEqual( report.Ok, true, JSON.stringify( report.Error ) );
		LIB_ASSERT.strictEqual( report.Result.length, 2 );
		await session.Release();
	} );

	it( 'gives every noun a skeleton add accepts, one after another, with no error added', function ()
	{
		let document = Skeletons.Skeleton( 'file' );
		let nouns = [ 'datasource', 'query', 'insert', 'update', 'delete', 'process', 'trigger' ];
		for ( let index = 0; index < nouns.length; index++ )
		{
			let outcome = Edit.Add( document, nouns[ index ], Skeletons.Skeleton( nouns[ index ] ), { Validate: { jsongin: jsongin, jsonproc: jsonproc, Env: {} } } );
			LIB_ASSERT.strictEqual( outcome.Ok, true, nouns[ index ] + ': ' + JSON.stringify( outcome.Findings ) );
		}
		LIB_ASSERT.deepStrictEqual( errors_in( document ), [] );
	} );

	it( 'is already in canonical order, takes a name, and refuses an unknown kind', function ()
	{
		for ( let index = 0; index < Skeletons.KINDS.length; index++ )
		{
			let kind = Skeletons.KINDS[ index ];
			let skeleton = Skeletons.Skeleton( kind );
			let wrapped = ( kind === 'file' ) ? skeleton : ( ( kind === 'datasource' ) ? { DataSources: [ skeleton ] } : ( ( kind === 'trigger' ) ? { Triggers: [ skeleton ] } : { Objects: [ skeleton ] } ) );
			LIB_ASSERT.strictEqual( JSON.stringify( Format.FormatDocument( wrapped ) ), JSON.stringify( wrapped ), kind );
		}
		LIB_ASSERT.strictEqual( Skeletons.Skeleton( 'query', 'Recent rows' ).Name, 'Recent rows' );
		LIB_ASSERT.throws( function () { Skeletons.Skeleton( 'table' ); }, /no skeleton for \[table\]/ );
	} );

} );


//---------------------------------------------------------------------
describe( 'jsonx new and jsonx format', function ()
{

	let root = null;

	function cli( Argv, Stdin )
	{
		let env = Object.assign( {}, process.env );
		delete env.JSONX_FILE;
		let result = LIB_CHILD_PROCESS.spawnSync( process.execPath, [ BIN ].concat( Argv ), { cwd: root, env: env, encoding: 'utf8', input: Stdin } );
		return { Code: result.status, Stdout: result.stdout, Stderr: result.stderr };
	}

	function file_path()
	{
		return LIB_PATH.join( root, 'try.jsonx' );
	}

	beforeEach( function ()
	{
		root = LIB_FS.mkdtempSync( LIB_PATH.join( LIB_OS.tmpdir(), 'jsonx-format-' ) );
	} );

	afterEach( function ()
	{
		LIB_FS.rmSync( root, { recursive: true, force: true } );
	} );

	it( 'writes a file skeleton that validates, formatted', function ()
	{
		let created = cli( [ 'new', 'file', '--name', 'Try' ] );
		LIB_ASSERT.strictEqual( created.Code, 0, created.Stderr );
		LIB_FS.writeFileSync( file_path(), created.Stdout );

		LIB_ASSERT.strictEqual( cli( [ 'validate' ] ).Code, 0 );
		let check = cli( [ 'format', '--check' ] );
		LIB_ASSERT.strictEqual( check.Code, 0, check.Stderr );
		LIB_ASSERT.strictEqual( JSON.parse( check.Stdout ).Changed, false );
	} );

	it( 'checks without writing, rewrites, and then finds nothing to change', function ()
	{
		let scrambled = { Objects: [ { Criteria: {}, Name: 'Q', DataSource: 'S', Kind: 'Query', Mine: 1 } ], DataSources: [ { AdapterName: 'jsonstor-memory', Name: 'S' } ] };
		let text = JSON.stringify( scrambled, null, 2 );
		LIB_FS.writeFileSync( file_path(), text );

		let check = cli( [ 'format', '--check' ] );
		LIB_ASSERT.strictEqual( check.Code, 1 );
		LIB_ASSERT.match( check.Stderr, /is not formatted/ );
		LIB_ASSERT.strictEqual( LIB_FS.readFileSync( file_path(), 'utf8' ), text );

		let formatted = cli( [ 'format' ] );
		LIB_ASSERT.strictEqual( formatted.Code, 0, formatted.Stderr );
		LIB_ASSERT.strictEqual( JSON.parse( formatted.Stdout ).Changed, true );
		let written = JSON.parse( LIB_FS.readFileSync( file_path(), 'utf8' ) );
		LIB_ASSERT.deepStrictEqual( Object.keys( written ), [ 'DataSources', 'Objects' ] );
		LIB_ASSERT.deepStrictEqual( Object.keys( written.Objects[ 0 ] ), [ 'Kind', 'Name', 'DataSource', 'Criteria', 'Mine' ] );

		LIB_ASSERT.strictEqual( JSON.parse( cli( [ 'format' ] ).Stdout ).Changed, false );
	} );

	it( 'takes a CRLF copy of a formatted file as formatted, and formats a file with errors', function ()
	{
		LIB_FS.writeFileSync( file_path(), Writer.FormatDocument( { Objects: [ { Kind: 'Query', Name: 'Q', DataSource: 'Nowhere', Criteria: {} } ] } ).replace( /\n/g, '\r\n' ) );
		LIB_ASSERT.strictEqual( cli( [ 'format', '--check' ] ).Code, 0 );
		LIB_ASSERT.strictEqual( cli( [ 'validate' ] ).Code, 3, 'the file has an error, and format does not mind' );
	} );

	it( 'exits 2 for an unknown kind and for --file on new', function ()
	{
		let kind = cli( [ 'new', 'table' ] );
		LIB_ASSERT.strictEqual( kind.Code, 2 );
		LIB_ASSERT.match( kind.Stderr, /must be one of file, datasource/ );
		LIB_ASSERT.strictEqual( cli( [ 'new', 'query', '--file', 'try.jsonx' ] ).Code, 2 );
	} );

} );
