'use strict';

const LIB_ASSERT = require( 'assert' );
const LIB_CHILD_PROCESS = require( 'child_process' );
const LIB_FS = require( 'fs' );
const LIB_OS = require( 'os' );
const LIB_PATH = require( 'path' );
const { describe, it, before, after } = require( 'node:test' );

const Spec = require( './fixtures/Spec.js' );

const BIN = LIB_PATH.resolve( __dirname, '..', 'bin', 'jsonx.js' );


//---------------------------------------------------------------------
function run( Argv, Cwd )
{
	let env = Object.assign( {}, process.env );
	delete env.JSONX_FILE;
	let result = LIB_CHILD_PROCESS.spawnSync( process.execPath, [ BIN ].concat( Argv ), { cwd: Cwd, env: env, encoding: 'utf8' } );
	return { Code: result.status, Stdout: result.stdout, Stderr: result.stderr };
}

function write( Directory, Name, Document )
{
	LIB_FS.writeFileSync( LIB_PATH.join( Directory, Name ), JSON.stringify( Document, null, '\t' ) );
	return;
}


//---------------------------------------------------------------------
describe( 'jsonx run and jsonx trigger run', function ()
{

	let root = null;
	let observatory = null;
	let scratch = null;

	before( function ()
	{
		root = LIB_FS.mkdtempSync( LIB_PATH.join( LIB_OS.tmpdir(), 'jsonx-run-' ) );

		observatory = LIB_PATH.join( root, 'observatory' );
		LIB_FS.mkdirSync( observatory );
		write( observatory, 'observatory.jsonx', Spec.AppendixB() );

		scratch = LIB_PATH.join( root, 'scratch' );
		LIB_FS.mkdirSync( scratch );
		write( scratch, 'scratch.jsonx', {
			DataSources: [ { Name: 'Scratch', AdapterName: 'jsonstor-memory' } ],
			Objects: [
				{ Kind: 'Insert', Name: 'Seed', DataSource: 'Scratch', Documents: [ { _id: 'a' }, { _id: 'b' } ] },
				{ Kind: 'Query', Name: 'Read', DataSource: 'Scratch', Criteria: {}, Sort: { _id: 1 } },
				{ Kind: 'Process', Name: 'Seed and read', Steps: [ { $call: { Name: 'Seed' } }, { $call: { Name: 'Read', Into: 'Rows' } }, { $return: '$Rows' } ] },
				{ Kind: 'Process', Name: 'Echo', Steps: [ { $return: { Seen: '$Seed' } } ] },
				{ Kind: 'Process', Name: 'Fail', Steps: [ { $throw: 'stopped on purpose' } ] },
			],
		} );
	} );

	after( function () { LIB_FS.rmSync( root, { recursive: true, force: true } ); } );

	it( 'runs Appendix B: the result on stdout, six object lines and a trigger line on stderr', function ()
	{
		let result = run( [ 'run', 'Prepare the season' ], observatory );
		LIB_ASSERT.strictEqual( result.Code, 0, result.Stderr );
		LIB_ASSERT.deepStrictEqual( JSON.parse( result.Stdout ), [ { Booking: 'b-1', Observer: 'R. Okafor', Dome: 'B' } ] );

		let lines = result.Stderr.trim().split( /\r?\n/ );
		LIB_ASSERT.strictEqual( lines.length, 7, result.Stderr );
		LIB_ASSERT.ok( lines[ 0 ].startsWith( 'Prepare the season  Process  ran once' ) );
		LIB_ASSERT.ok( lines[ 2 ].startsWith( '  Three bookings  Insert  inserted 3' ) );
		LIB_ASSERT.ok( lines[ 3 ].startsWith( '    trigger [Note every long booking as it arrives] Note a long booking' ) );
	} );

	it( 'writes nothing to stderr with --quiet, and one line per row with jsonl', function ()
	{
		let result = run( [ 'run', 'Seed and read', '--quiet', '-o', 'jsonl' ], scratch );
		LIB_ASSERT.strictEqual( result.Code, 0 );
		LIB_ASSERT.strictEqual( result.Stderr, '' );
		LIB_ASSERT.strictEqual( result.Stdout, '{"_id":"a"}\n{"_id":"b"}\n' );
	} );

	it( 'adds what each storage call measured with --verbose, leaving stdout unchanged', function ()
	{
		let plain = run( [ 'run', 'Seed and read' ], scratch );
		let verbose = run( [ 'run', 'Seed and read', '--verbose' ], scratch );
		LIB_ASSERT.strictEqual( verbose.Code, 0, verbose.Stderr );
		LIB_ASSERT.strictEqual( verbose.Stdout, plain.Stdout );
		LIB_ASSERT.ok( /\| FindMany2 on Scratch: backend 2 rows, kept 2/.test( verbose.Stderr ), verbose.Stderr );
		LIB_ASSERT.ok( !/InsertMany on/.test( verbose.Stderr ), 'an insert has nothing to measure' );
		LIB_ASSERT.ok( !plain.Stderr.includes( '|' ) );

		LIB_ASSERT.strictEqual( run( [ 'validate', '--verbose' ], scratch ).Code, 2, '--verbose belongs to the commands which run' );
	} );

	it( 'starts a Process with no DataSource from --input', function ()
	{
		let result = run( [ 'run', 'Echo', '--input', '{"Seed":42}', '-q' ], scratch );
		LIB_ASSERT.deepStrictEqual( JSON.parse( result.Stdout ), { Seen: 42 } );
	} );

	it( 'exits 1 with nothing on stdout when the object fails, and says why', function ()
	{
		let result = run( [ 'run', 'Fail' ], scratch );
		LIB_ASSERT.strictEqual( result.Code, 1 );
		LIB_ASSERT.strictEqual( result.Stdout, '' );
		LIB_ASSERT.ok( result.Stderr.includes( 'stopped on purpose' ), result.Stderr );
	} );

	it( 'exits 2 for a name which is not an object, and 3 for a file with errors, running nothing', function ()
	{
		let missing = run( [ 'run', 'Scratch' ], scratch );
		LIB_ASSERT.strictEqual( missing.Code, 2 );
		LIB_ASSERT.ok( missing.Stderr.includes( '[Scratch] is not an object' ) );

		let broken = LIB_PATH.join( root, 'broken' );
		LIB_FS.mkdirSync( broken );
		let document = Spec.AppendixB();
		document.Objects[ 3 ].Criteria = [];
		write( broken, 'broken.jsonx', document );
		let result = run( [ 'run', 'Prepare the season' ], broken );
		LIB_ASSERT.strictEqual( result.Code, 3 );
		LIB_ASSERT.strictEqual( result.Stdout, '' );
		LIB_ASSERT.ok( result.Stderr.includes( 'Nothing ran: the file has errors.' ) );
	} );

	it( 'binds a data source to a sqlite file for one run, and refuses to bind a name the file lacks', function ()
	{
		let result = run( [ 'run', 'Seed and read', '-q', '--bind', 'Scratch=jsonstor-sqlite:{"Path":"bound.db","Table":"Scratch","ModifySchema":true}' ], scratch );
		LIB_ASSERT.strictEqual( result.Code, 0, result.Stderr );
		LIB_ASSERT.deepStrictEqual( JSON.parse( result.Stdout ), [ { _id: 'a' }, { _id: 'b' } ] );
		LIB_ASSERT.ok( LIB_FS.existsSync( LIB_PATH.join( scratch, 'bound.db' ) ) );

		let refused = run( [ 'run', 'Read', '--bind', 'Nobody=jsonstor-memory' ], scratch );
		LIB_ASSERT.strictEqual( refused.Code, 2 );
		LIB_ASSERT.ok( refused.Stderr.includes( 'never creates a name' ) );
	} );

	it( 'runs a trigger by hand, and exits 2 for a name which is not a trigger', function ()
	{
		let result = run( [ 'trigger', 'run', 'Note every long booking as it arrives', '-q' ], observatory );
		LIB_ASSERT.strictEqual( result.Code, 0, result.Stderr );
		LIB_ASSERT.deepStrictEqual( JSON.parse( result.Stdout ), [] );

		let missing = run( [ 'trigger', 'run', 'Nobody' ], observatory );
		LIB_ASSERT.strictEqual( missing.Code, 2 );
	} );

} );
