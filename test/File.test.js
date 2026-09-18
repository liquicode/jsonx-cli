'use strict';

const LIB_ASSERT = require( 'assert' );
const LIB_FS = require( 'fs' );
const LIB_OS = require( 'os' );
const LIB_PATH = require( 'path' );
const { describe, it } = require( 'node:test' );

const Reader = require( '../src/File/Reader.js' );
const Writer = require( '../src/File/Writer.js' );
const Names = require( '../src/File/Names.js' );
const Spec = require( './fixtures/Spec.js' );


function directory_io( Names_ )
{
	return { ListDirectory: function () { return Names_; } };
}


//---------------------------------------------------------------------
describe( 'Reader.ParseText', function ()
{

	it( 'reads a document, byte order mark and all', function ()
	{
		let read = Reader.ParseText( '﻿{ "Objects": [] }' );
		LIB_ASSERT.deepStrictEqual( read.Document, { Objects: [] } );
		LIB_ASSERT.deepStrictEqual( read.Findings, [] );
	} );

	it( 'reports invalid JSON as an error finding with a line and a column', function ()
	{
		let read = Reader.ParseText( '{\n\t"Objects": [\n\t\t{ "Kind": "Query", }\n\t]\n}' );
		LIB_ASSERT.strictEqual( read.Document, undefined );
		LIB_ASSERT.strictEqual( read.Findings.length, 1 );
		LIB_ASSERT.strictEqual( read.Findings[ 0 ].Severity, 'error' );
		LIB_ASSERT.strictEqual( read.Findings[ 0 ].Path, '' );
		LIB_ASSERT.ok( /at line 3, column \d+/.test( read.Findings[ 0 ].Message ), read.Findings[ 0 ].Message );
		LIB_ASSERT.ok( read.Findings[ 0 ].Message.endsWith( '(3.1).' ) );
	} );

	it( 'places the end of the input at the end of the text, and keeps Node\'s words otherwise', function ()
	{
		LIB_ASSERT.ok( /at line 1, column 4: Unexpected end of JSON input \(3\.1\)\.$/.test( Reader.ParseText( '[1,' ).Findings[ 0 ].Message ) );
		LIB_ASSERT.ok( /^The file is not valid JSON: Unexpected token/.test( Reader.ParseText( '{ "Objects": [ }' ).Findings[ 0 ].Message ) );
	} );

} );


//---------------------------------------------------------------------
describe( 'Reader.ResolvePath', function ()
{

	let cwd = LIB_PATH.resolve( '/work' );

	it( 'takes --file first, resolved against the working directory', function ()
	{
		let resolved = Reader.ResolvePath( 'a.jsonx', { JSONX_FILE: 'b.jsonx' }, cwd, directory_io( [ 'c.jsonx' ] ) );
		LIB_ASSERT.deepStrictEqual( resolved, { Path: LIB_PATH.join( cwd, 'a.jsonx' ), Source: '--file' } );
	} );

	it( 'takes JSONX_FILE second', function ()
	{
		let resolved = Reader.ResolvePath( null, { JSONX_FILE: 'b.jsonx' }, cwd, directory_io( [ 'c.jsonx' ] ) );
		LIB_ASSERT.deepStrictEqual( resolved, { Path: LIB_PATH.join( cwd, 'b.jsonx' ), Source: 'JSONX_FILE' } );
	} );

	it( 'takes the one .jsonx file in the directory third', function ()
	{
		let resolved = Reader.ResolvePath( undefined, {}, cwd, directory_io( [ 'readme.md', 'season.jsonx' ] ) );
		LIB_ASSERT.deepStrictEqual( resolved, { Path: LIB_PATH.join( cwd, 'season.jsonx' ), Source: 'directory' } );
	} );

	it( 'refuses, as a usage error, a directory with none or with several', function ()
	{
		LIB_ASSERT.throws( function () { Reader.ResolvePath( undefined, {}, cwd, directory_io( [ 'readme.md' ] ) ); },
			function ( Error ) { return Error.IsUsage === true && /holds no \.jsonx file/.test( Error.message ); } );
		LIB_ASSERT.throws( function () { Reader.ResolvePath( undefined, {}, cwd, directory_io( [ 'b.jsonx', 'a.jsonx' ] ) ); },
			function ( Error ) { return Error.IsUsage === true && /holds 2 \.jsonx files \(a\.jsonx, b\.jsonx\)/.test( Error.message ); } );
	} );

	it( 'reports an unreadable file as a failure, not a usage error', function ()
	{
		LIB_ASSERT.throws( function () { Reader.ReadText( LIB_PATH.join( cwd, 'gone.jsonx' ), { ReadFile: function () { throw new Error( 'ENOENT' ); } } ); },
			function ( Error ) { return ( Error instanceof Reader.FileError ) && Error.IsUsage === false; } );
	} );

} );


//---------------------------------------------------------------------
describe( 'Writer', function ()
{

	it( 'keeps unknown fields and key order, tab indented with a trailing newline', function ()
	{
		let text = '{"Zeta":1,"Objects":[{"Name":"a","Kind":"Query","Custom":{"x":[1,2]}}],"Alpha":true}';
		let written = Writer.FormatDocument( JSON.parse( text ) );
		LIB_ASSERT.strictEqual( JSON.stringify( JSON.parse( written ) ), text );
		LIB_ASSERT.ok( written.includes( '\n\t"Objects": [' ) );
		LIB_ASSERT.ok( written.endsWith( '}\n' ) );
	} );

	it( 'writes a real file and leaves no temporary behind', function ()
	{
		let directory = LIB_FS.mkdtempSync( LIB_PATH.join( LIB_OS.tmpdir(), 'jsonx-writer-' ) );
		try
		{
			let path = LIB_PATH.join( directory, 'season.jsonx' );
			LIB_FS.writeFileSync( path, 'old' );
			Writer.WriteFile( path, { Objects: [] } );
			LIB_ASSERT.strictEqual( LIB_FS.readFileSync( path, 'utf8' ), '{\n\t"Objects": []\n}\n' );
			LIB_ASSERT.deepStrictEqual( LIB_FS.readdirSync( directory ), [ 'season.jsonx' ] );
		}
		finally
		{
			LIB_FS.rmSync( directory, { recursive: true, force: true } );
		}
	} );

} );


//---------------------------------------------------------------------
describe( 'Names', function ()
{

	it( 'lists the entries which are objects, with their paths', function ()
	{
		let entries = Names.Entries( { DataSources: [ { Name: 'A' }, 7 ], Objects: 'no', Triggers: [ { Name: 'T' } ] } );
		LIB_ASSERT.deepStrictEqual( entries.map( function ( Item ) { return Item.Path + ':' + Item.Name; } ), [ 'DataSources.0:A', 'Triggers.0:T' ] );
	} );

	it( 'finds an entry by name in any section', function ()
	{
		let document = Spec.AppendixB();
		LIB_ASSERT.strictEqual( Names.FindEntry( document, 'Notes' ).Path, 'DataSources.3' );
		LIB_ASSERT.strictEqual( Names.FindEntry( document, 'Prepare the season' ).Path, 'Objects.6' );
		LIB_ASSERT.strictEqual( Names.FindEntry( document, 'Nobody' ), null );
	} );

	it( 'finds every use of a name, through every nested step list', function ()
	{
		let document = {
			Objects: [
				{
					Name: 'P', Kind: 'Process', DataSource: 'S', Into: 'T',
					Steps: [
						{ $call: { Name: 'FindOne', With: { DataSource: 'Lookup' } } },
						{ $call: { Name: 'Count', With: { DataSource: '$Computed' } } },
						{ $when: { Check: {}, Then: [ { $call: { Name: 'InThen' } } ], Else: [ { $call: { Name: 'InElse' } } ] } },
						{ $while: { Check: {}, Do: [ { $call: { Name: 'InWhile' } } ] } },
						{ $forEach: { In: '$x', As: 'y', Do: [ { $call: { Name: 'InForEach' } } ] } },
						{ $try: { Do: [ { $call: { Name: 'InTry', With: {} } } ], Catch: [ { $call: { Name: 'InCatch' } } ] } },
					],
				},
			],
			Triggers: [ { Name: 'Tr', On: [ 'Insert' ], Process: 'P' } ],
		};

		let references = Names.References( document ).map( function ( Reference )
		{
			return Reference.Sort + ' ' + Reference.Name + ' @ ' + Reference.Path + ( Reference.HasWith ? ' (With)' : '' );
		} );

		LIB_ASSERT.deepStrictEqual( references, [
			'DataSource S @ Objects.0.DataSource',
			'DataSource T @ Objects.0.Into',
			'DataSource Lookup @ Objects.0.Steps.0.$call.With.DataSource',
			'Object InThen @ Objects.0.Steps.2.$when.Then.0.$call.Name',
			'Object InElse @ Objects.0.Steps.2.$when.Else.0.$call.Name',
			'Object InWhile @ Objects.0.Steps.3.$while.Do.0.$call.Name',
			'Object InForEach @ Objects.0.Steps.4.$forEach.Do.0.$call.Name',
			'Object InTry @ Objects.0.Steps.5.$try.Do.0.$call.Name (With)',
			'Object InCatch @ Objects.0.Steps.5.$try.Catch.0.$call.Name',
			'Process P @ Triggers.0.Process',
		] );
	} );

} );
