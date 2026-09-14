'use strict';

const LIB_ASSERT = require( 'assert' );
const LIB_FS = require( 'fs' );
const LIB_OS = require( 'os' );
const LIB_PATH = require( 'path' );
const { describe, it, before, after } = require( 'node:test' );

const Envelope = require( '../src/Envelope.js' );
const Report = require( '../src/Report.js' );
const Parser = require( '../src/CommandLine/Parser.js' );
const Main = require( '../modes/cli/Main.js' );
const Spec = require( './fixtures/Spec.js' );


//---------------------------------------------------------------------
// An Io over the real file system which records anything written to it.

function capture_io( Cwd )
{
	let io = Parser.DefaultIo();
	io.Out = '';
	io.Err = '';
	io.Stdout = function ( Text ) { io.Out += Text; };
	io.Stderr = function ( Text ) { io.Err += Text; };
	io.Env = {};
	io.Cwd = Cwd;
	return io;
}

// Runs a command with a collecting Out. Returns { Envelope, Io }.
async function invoke( Argv, Cwd )
{
	let io = capture_io( Cwd );
	let out = Envelope.NewOut();
	let code = await Main.Main( Argv, io, null, { Out: out } );
	return { Envelope: out.Envelope( code ), Io: io };
}

function write( Directory, Name, Document )
{
	let path = LIB_PATH.join( Directory, Name );
	LIB_FS.writeFileSync( path, JSON.stringify( Document, null, '\t' ) );
	return path;
}


//---------------------------------------------------------------------
describe( 'Out', function ()
{

	it( 'records without writing when it has no streams', function ()
	{
		let out = Envelope.NewOut();
		out.Result( { A: 1 } );
		out.Finding( { Severity: 'warning', Path: 'Objects.0', Message: 'Careful.' } );
		out.Log( 'first\nsecond\n' );
		out.Log( 'third\n' );
		LIB_ASSERT.deepStrictEqual( out.Envelope( 0 ), {
			Ok: true, ExitCode: 0, Result: { A: 1 },
			Findings: [ { Severity: 'warning', Path: 'Objects.0', Message: 'Careful.' } ],
			Log: [ 'first', 'second', 'third' ],
		} );
	} );

	it( 'leaves Result out when none was written, and is not Ok for any other exit code', function ()
	{
		let out = Envelope.NewOut();
		out.Log( 'No object is named [x].\n' );
		let envelope = out.Envelope( 2 );
		LIB_ASSERT.strictEqual( envelope.Ok, false );
		LIB_ASSERT.strictEqual( 'Result' in envelope, false );
	} );

	it( 'joins shell text into one Result, and JSON Lines records into an array', function ()
	{
		let text = Envelope.NewOut();
		text.Text( 'a\n' );
		text.Text( 'b\n' );
		LIB_ASSERT.strictEqual( text.Envelope( 0 ).Result, 'a\nb\n' );

		let lines = Envelope.NewOut();
		lines.Line( { Status: 'waiting' } );
		lines.Line( { Status: 'done' } );
		LIB_ASSERT.deepStrictEqual( lines.Envelope( 0 ).Result, [ { Status: 'waiting' }, { Status: 'done' } ] );
	} );

	it( 'on the command line writes each piece as Report formats it', function ()
	{
		let written = { Out: '', Err: '' };
		let out = Envelope.NewOut( {
			Stdout: function ( Text ) { written.Out += Text; },
			Stderr: function ( Text ) { written.Err += Text; },
			Output: 'table',
		} );
		let rows = [ { A: 1, B: 'x' } ];
		let finding = { Severity: 'error', Path: '', Message: 'Broken.' };
		out.Result( rows );
		out.Finding( finding );
		out.Log( 'done\n' );
		out.Line( { N: 1 } );
		LIB_ASSERT.strictEqual( written.Out, Report.FormatResult( 'table', rows ) + '{"N":1}\n' );
		LIB_ASSERT.strictEqual( written.Err, Report.FormatFinding( finding ) + 'done\n' );
	} );

} );


//---------------------------------------------------------------------
describe( 'The envelope of a command', function ()
{

	let root = null;
	let observatory = null;
	let broken = null;
	let scratch = null;

	before( function ()
	{
		root = LIB_FS.mkdtempSync( LIB_PATH.join( LIB_OS.tmpdir(), 'jsonx-envelope-' ) );
		observatory = write( root, 'observatory.jsonx', Spec.AppendixB() );

		let document = Spec.AppendixB();
		let entry = document.Objects.find( function ( Object_ ) { return typeof Object_.DataSource === 'string'; } );
		entry.DataSource = 'Nowhere';
		broken = write( root, 'broken.jsonx', document );

		scratch = write( root, 'scratch.jsonx', {
			DataSources: [ { Name: 'Scratch', AdapterName: 'jsonstor-memory' } ],
			Objects: [ { Kind: 'Process', Name: 'Fail', Steps: [ { $throw: 'stopped on purpose' } ] } ],
		} );
	} );

	after( function () { LIB_FS.rmSync( root, { recursive: true, force: true } ); } );

	it( 'carries a run\'s result and its report lines, and nothing reaches Io', async function ()
	{
		let invoked = await invoke( [ 'run', 'Prepare the season', '--file', observatory ], root );
		let envelope = invoked.Envelope;
		LIB_ASSERT.strictEqual( envelope.ExitCode, 0, envelope.Log.join( '\n' ) );
		LIB_ASSERT.strictEqual( envelope.Ok, true );
		LIB_ASSERT.deepStrictEqual( envelope.Result, [ { Booking: 'b-1', Observer: 'R. Okafor', Dome: 'B' } ] );
		LIB_ASSERT.strictEqual( envelope.Log.length, 7 );
		LIB_ASSERT.ok( envelope.Log[ 0 ].startsWith( 'Prepare the season  Process  ran once' ) );
		LIB_ASSERT.ok( envelope.Log[ 3 ].startsWith( '    trigger [Note every long booking as it arrives]' ) );
		LIB_ASSERT.strictEqual( invoked.Io.Out, '' );
		LIB_ASSERT.strictEqual( invoked.Io.Err, '' );
	} );

	it( 'answers a usage mistake with exit 2, the message in Log, and no Result', async function ()
	{
		let envelope = ( await invoke( [ 'run', 'Nothing by this name', '--file', observatory ], root ) ).Envelope;
		LIB_ASSERT.strictEqual( envelope.ExitCode, 2 );
		LIB_ASSERT.strictEqual( envelope.Ok, false );
		LIB_ASSERT.strictEqual( 'Result' in envelope, false );
		LIB_ASSERT.ok( envelope.Log[ 0 ].startsWith( 'No object is named [Nothing by this name]' ) );
	} );

	it( 'carries validation findings as objects, with exit 3', async function ()
	{
		let validated = ( await invoke( [ 'validate', '--file', broken ], root ) ).Envelope;
		LIB_ASSERT.strictEqual( validated.ExitCode, 3 );
		let errors = validated.Findings.filter( function ( Finding ) { return Finding.Severity === 'error'; } );
		LIB_ASSERT.ok( errors.length > 0 );
		LIB_ASSERT.ok( errors.some( function ( Finding ) { return /Nowhere/.test( Finding.Message ); } ), JSON.stringify( errors ) );
		LIB_ASSERT.deepStrictEqual( validated.Result, validated.Findings );

		// A run on the same file runs nothing, and says why.
		let ran = ( await invoke( [ 'run', 'Prepare the season', '--file', broken ], root ) ).Envelope;
		LIB_ASSERT.strictEqual( ran.ExitCode, 3 );
		LIB_ASSERT.ok( ran.Findings.length > 0 );
		LIB_ASSERT.ok( ran.Log.includes( 'Nothing ran: the file has errors. Run jsonx validate for every finding.' ) );
	} );

	it( 'answers a failed run with exit 1, the failure in Log, and no Result', async function ()
	{
		let envelope = ( await invoke( [ 'run', 'Fail', '--file', scratch ], root ) ).Envelope;
		LIB_ASSERT.strictEqual( envelope.ExitCode, 1 );
		LIB_ASSERT.strictEqual( 'Result' in envelope, false );
		LIB_ASSERT.ok( envelope.Log[ 0 ].startsWith( 'Fail  Process  FAILED' ), envelope.Log.join( '\n' ) );
	} );

	it( 'carries text written for a shell as a string Result', async function ()
	{
		let envelope = ( await invoke( [ 'completion', 'bash' ], root ) ).Envelope;
		LIB_ASSERT.strictEqual( envelope.ExitCode, 0 );
		LIB_ASSERT.strictEqual( typeof envelope.Result, 'string' );
		LIB_ASSERT.ok( envelope.Result.includes( '__complete' ) );
	} );

} );


//---------------------------------------------------------------------
describe( 'Commands write through Out', function ()
{

	it( 'no command file writes to Io, or formats a result itself', function ()
	{
		let folder = LIB_PATH.resolve( __dirname, '..', 'commands' );
		let offenders = [];
		for ( let name of LIB_FS.readdirSync( folder ) )
		{
			let lines = LIB_FS.readFileSync( LIB_PATH.join( folder, name ), 'utf8' ).split( /\r?\n/ );
			lines.forEach( function ( Line, Index )
			{
				if ( /\b(Io|io)\s*\.\s*(Stdout|Stderr)\b|\bWriteResult\s*\(/.test( Line ) ) { offenders.push( name + ':' + ( Index + 1 ) ); }
			} );
		}
		LIB_ASSERT.deepStrictEqual( offenders, [] );
	} );

} );
