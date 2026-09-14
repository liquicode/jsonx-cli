'use strict';

const LIB_ASSERT = require( 'assert' );
const LIB_CHILD_PROCESS = require( 'child_process' );
const LIB_FS = require( 'fs' );
const LIB_OS = require( 'os' );
const LIB_PATH = require( 'path' );
const { describe, it, before, after } = require( 'node:test' );

const jsongin = require( '@liquicode/jsongin' );

const Engine = require( '../src/Engine/Engine.js' );

const BIN = LIB_PATH.resolve( __dirname, '..', 'bin', 'jsonx.js' );


//---------------------------------------------------------------------
// A neutral domain: plants in a greenhouse.

function plants()
{
	return [
		{ _id: 'p1', Genus: 'Ficus', Height: 120, Bed: { Row: 2, Shade: true } },
		{ _id: 'p2', Genus: 'Aloe', Height: 30, Bed: { Row: 1, Shade: false } },
		{ _id: 'p3', Genus: 'Ficus', Height: 80, Bed: { Row: 1, Shade: true } },
	];
}

function run( Verb, Values )
{
	return Engine.Run( Verb, Values );
}

function refused( Verb, Values, Pattern )
{
	let answer = run( Verb, Values );
	LIB_ASSERT.strictEqual( answer.Findings.length, 1, JSON.stringify( answer ) );
	LIB_ASSERT.strictEqual( answer.Findings[ 0 ].Severity, 'error' );
	LIB_ASSERT.match( answer.Findings[ 0 ].Message, Pattern );
	return answer;
}


//---------------------------------------------------------------------
describe( 'Engine: each verb agrees with jsongin', function ()
{

	it( 'match, filter and sort', function ()
	{
		LIB_ASSERT.strictEqual( run( 'match', { document: plants()[ 0 ], criteria: { Genus: 'Ficus' } } ).Result, true );
		LIB_ASSERT.strictEqual( run( 'match', { document: plants()[ 1 ], criteria: { Genus: 'Ficus' } } ).Result, false );

		let criteria = { Height: { $gte: 80 } };
		LIB_ASSERT.deepStrictEqual( run( 'filter', { documents: plants(), criteria: criteria } ).Result, jsongin.Filter( plants(), criteria ) );

		let given = plants();
		let sorted = run( 'sort', { documents: given, sort: { Height: 1 } } ).Result;
		LIB_ASSERT.deepStrictEqual( sorted.map( function ( Plant ) { return Plant._id; } ), [ 'p2', 'p3', 'p1' ] );
		LIB_ASSERT.deepStrictEqual( given.map( function ( Plant ) { return Plant._id; } ), [ 'p1', 'p2', 'p3' ], 'the documents given are not reordered' );
	} );

	it( 'project, update, flatten, expand and get answer one for one and an array for an array', function ()
	{
		LIB_ASSERT.deepStrictEqual( run( 'project', { documents: plants()[ 0 ], projection: { Genus: 1 } } ).Result, { _id: 'p1', Genus: 'Ficus' } );
		LIB_ASSERT.strictEqual( run( 'project', { documents: plants(), projection: { Genus: 1 } } ).Result.length, 3 );

		LIB_ASSERT.strictEqual( run( 'update', { documents: plants()[ 1 ], update: { $inc: { Height: 5 } } } ).Result.Height, 35 );

		let flat = run( 'flatten', { documents: plants()[ 0 ] } ).Result;
		LIB_ASSERT.strictEqual( flat[ 'Bed.Row' ], 2 );
		LIB_ASSERT.deepStrictEqual( run( 'expand', { documents: flat } ).Result, plants()[ 0 ] );

		LIB_ASSERT.deepStrictEqual( run( 'get', { documents: plants(), path: 'Bed.Row' } ).Result, [ 2, 1, 1 ] );
		LIB_ASSERT.strictEqual( run( 'get', { documents: plants()[ 0 ], path: 'Missing' } ).Result, null );
	} );

	it( 'diff and invert are each other\'s undoing', function ()
	{
		let before = plants()[ 0 ];
		let after = { _id: 'p1', Genus: 'Ficus', Height: 125 };
		let patch = run( 'diff', { before: before, after: after } ).Result;
		LIB_ASSERT.deepStrictEqual( jsongin.Update( before, patch ), after );

		let undo = run( 'invert', { before: before, patch: patch } ).Result;
		LIB_ASSERT.deepStrictEqual( jsongin.Update( after, undo ), before );
	} );

	it( 'distinct, evaluate, aggregate and merge', function ()
	{
		LIB_ASSERT.deepStrictEqual( run( 'distinct', { documents: plants(), fields: { Genus: 1 } } ).Result, [ { Genus: 'Ficus' }, { Genus: 'Aloe' } ] );
		LIB_ASSERT.strictEqual( run( 'evaluate', { document: { Height: 30 }, expression: { $multiply: [ '$Height', 2 ] } } ).Result, 60 );
		LIB_ASSERT.strictEqual( run( 'evaluate', { expression: { $add: [ 1, 2 ] } } ).Result, 3 );
		LIB_ASSERT.deepStrictEqual( run( 'aggregate', { documents: plants(), pipeline: [ { $match: { Genus: 'Ficus' } }, { $count: 'Ficus' } ] } ).Result, [ { Ficus: 2 } ] );
		LIB_ASSERT.deepStrictEqual( run( 'merge', { document: { Bed: { Row: 1 } }, with: { Bed: { Shade: true } } } ).Result, { Bed: { Row: 1, Shade: true } } );
	} );

	it( 'operators lists one family or all of them', function ()
	{
		LIB_ASSERT.deepStrictEqual( run( 'operators', { family: 'update' } ).Result, Object.keys( jsongin.UpdateOperators ) );
		let all = run( 'operators', {} ).Result;
		LIB_ASSERT.deepStrictEqual( Object.keys( all ), [ 'query', 'update', 'expression', 'stage', 'accumulator' ] );
		LIB_ASSERT.ok( all.stage.includes( '$match' ) );
	} );

	it( 'schema infer, validate, init and project', function ()
	{
		let schema = run( 'schema infer', { documents: plants() } ).Result;
		LIB_ASSERT.deepStrictEqual( schema, jsongin.InferSchema( plants() ) );

		LIB_ASSERT.deepStrictEqual( run( 'schema validate', { documents: plants(), schema: schema } ), { Result: [], Findings: [] } );

		let invalid = run( 'schema validate', { documents: [ plants()[ 0 ], { _id: 'p9', Genus: 7, Height: 1, Bed: { Row: 1, Shade: true } } ], schema: schema } );
		LIB_ASSERT.strictEqual( invalid.Findings.length, 1 );
		LIB_ASSERT.strictEqual( invalid.Findings[ 0 ].Path, '1.Genus' );
		LIB_ASSERT.deepStrictEqual( invalid.Result, invalid.Findings );

		let single = run( 'schema validate', { documents: { Genus: 'Ficus' }, schema: schema } );
		LIB_ASSERT.ok( single.Findings.every( function ( Finding ) { return !/^\d/.test( Finding.Path ); } ), 'one document, no position in the path' );

		LIB_ASSERT.deepStrictEqual( run( 'schema init', { schema: { type: 'object', properties: { Height: { type: 'number', default: 10 } } } } ).Result, { Height: 10 } );
		LIB_ASSERT.deepStrictEqual( run( 'schema project', { documents: { Genus: 'Aloe', Extra: 1 }, schema: schema } ).Result, { Genus: 'Aloe' } );
	} );

} );


//---------------------------------------------------------------------
describe( 'Engine: refusals', function ()
{

	it( 'refuses a criteria, update document or projection even with nothing to apply it to', function ()
	{
		refused( 'filter', { documents: [], criteria: { Height: { $bogus: 1 } } }, /Unknown operator \[\$bogus\]/ );
		refused( 'update', { documents: [], update: { $nope: {} } }, /Unknown update operator/ );
		refused( 'project', { documents: [], projection: { Genus: 1, Height: 0 } }, /Cannot combine inclusion and exclusion/ );
		LIB_ASSERT.strictEqual( refused( 'filter', { documents: [], criteria: { A: { $bogus: 1 } } }, /jsongin refused it/ ).Result, undefined );
	} );

	it( 'answers validate-query\'s findings as its result', function ()
	{
		LIB_ASSERT.deepStrictEqual( run( 'validate-query', { criteria: { A: { $in: [ 1 ] } } } ), { Result: [], Findings: [] } );
		let answer = refused( 'validate-query', { criteria: { A: { $in: 1 } } }, /./ );
		LIB_ASSERT.deepStrictEqual( answer.Result, answer.Findings );
	} );

	it( 'throws a usage mistake for documents given twice, not at all, or not as objects', function ()
	{
		LIB_ASSERT.throws( function () { run( 'sort', { documents: [], 'documents-jsonl': [], sort: {} } ); }, /not both/ );
		LIB_ASSERT.throws( function () { run( 'sort', { sort: {} } ); }, /documents are required/ );
		LIB_ASSERT.throws( function () { run( 'sort', { documents: [ 1 ], sort: {} } ); }, /Document 0 is not a JSON object/ );
		LIB_ASSERT.throws( function () { run( 'aggregate', { documents: [], pipeline: {} } ); }, /must be a JSON array/ );
		LIB_ASSERT.throws( function () { run( 'filter', { documents: [], criteria: [] } ); }, /must be a JSON object/ );
	} );

} );


//---------------------------------------------------------------------
describe( 'jsonx engine', function ()
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
		root = LIB_FS.mkdtempSync( LIB_PATH.join( LIB_OS.tmpdir(), 'jsonx-engine-' ) );
		LIB_FS.writeFileSync( LIB_PATH.join( root, 'plants.jsonl' ), plants().map( function ( Plant ) { return JSON.stringify( Plant ); } ).join( '\n' ) + '\n\n' );
	} );

	after( function ()
	{
		LIB_FS.rmSync( root, { recursive: true, force: true } );
	} );

	it( 'filters JSON Lines from a file and writes JSON Lines', function ()
	{
		let result = cli( [ 'engine', 'filter', '--documents-jsonl', '@plants.jsonl', '--criteria', '{"Genus":"Ficus"}', '--output', 'jsonl' ] );
		LIB_ASSERT.strictEqual( result.Code, 0, result.Stderr );
		LIB_ASSERT.deepStrictEqual( result.Stdout.trim().split( '\n' ).map( function ( Line ) { return JSON.parse( Line )._id; } ), [ 'p1', 'p3' ] );
		LIB_ASSERT.strictEqual( result.Stderr, '' );
	} );

	it( 'reads documents from standard input', function ()
	{
		let result = cli( [ 'engine', 'get', '--documents', '-', '--path', 'Genus' ], JSON.stringify( plants() ) );
		LIB_ASSERT.deepStrictEqual( JSON.parse( result.Stdout ), [ 'Ficus', 'Aloe', 'Ficus' ] );
	} );

	it( 'exits 3 with the finding on stderr and nothing on stdout when jsongin refuses', function ()
	{
		let result = cli( [ 'engine', 'filter', '--documents', '[]', '--criteria', '{"A":{"$bogus":1}}' ] );
		LIB_ASSERT.strictEqual( result.Code, 3 );
		LIB_ASSERT.strictEqual( result.Stdout, '' );
		LIB_ASSERT.match( result.Stderr, /jsongin refused it/ );
	} );

	it( 'exits 3 for schema findings and writes them as the result', function ()
	{
		let result = cli( [ 'engine', 'schema', 'validate', '--documents', '{"Height":"tall"}', '--schema', '{"type":"object","properties":{"Height":{"type":"number"}}}' ] );
		LIB_ASSERT.strictEqual( result.Code, 3 );
		LIB_ASSERT.strictEqual( JSON.parse( result.Stdout )[ 0 ].Path, 'Height' );
	} );

	it( 'exits 2 for --file, for documents given twice, and for bad JSON Lines', function ()
	{
		let with_file = cli( [ 'engine', 'operators', '--file', 'x.jsonx' ] );
		LIB_ASSERT.strictEqual( with_file.Code, 2 );
		LIB_ASSERT.match( with_file.Stderr, /reads no jsonx file/ );

		LIB_ASSERT.strictEqual( cli( [ 'engine', 'sort', '--documents', '[]', '--documents-jsonl', '@plants.jsonl', '--sort', '{}' ] ).Code, 2 );

		let bad_lines = cli( [ 'engine', 'flatten', '--documents-jsonl', '-' ], '{"a":1}\n{nope\n' );
		LIB_ASSERT.strictEqual( bad_lines.Code, 2 );
		LIB_ASSERT.match( bad_lines.Stderr, /not valid JSON Lines \(standard input, line 2\)/ );
	} );

	it( 'takes an engine invocation as --input-json, with JSON Lines as an array', function ()
	{
		let result = cli( [ '--input-json', '-' ], JSON.stringify( { Command: 'engine schema infer', 'documents-jsonl': plants() } ) );
		LIB_ASSERT.strictEqual( result.Code, 0, result.Stderr );
		LIB_ASSERT.deepStrictEqual( JSON.parse( result.Stdout ), jsongin.InferSchema( plants() ) );
	} );

} );
