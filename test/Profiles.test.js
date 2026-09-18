'use strict';

/*
	Profiles (cut 7, decision 14): the built-ins, a custom file, the checks, and the held session enforcing
	one on every request and switching it.
*/

const LIB_ASSERT = require( 'assert' );
const LIB_FS = require( 'fs' );
const LIB_OS = require( 'os' );
const LIB_PATH = require( 'path' );
const { describe, it, before, after } = require( 'node:test' );

const Profiles = require( '../src/Session/Profiles.js' );
const Held = require( '../src/Session/Held.js' );
const Parser = require( '../src/CommandLine/Parser.js' );
const Commands = require( '../commands/jsonx.js' );
const Spec = require( './fixtures/Spec.js' );


const TREE = Commands.TREE;
const SERVED = Held.ServedCommands( TREE );

// The storage verbs which write, which no built-in but full serves.
const WRITING_VERBS = [ 'datasource insert', 'datasource update', 'datasource replace', 'datasource delete', 'datasource drop', 'datasource flush', 'datasource refresh-index' ];


//---------------------------------------------------------------------
function io_for( Cwd )
{
	let io = Parser.DefaultIo();
	io.Cwd = Cwd;
	io.Env = {};
	return io;
}

function hold( File, Extra )
{
	return Held.NewHeld( Object.assign( { Tree: TREE, File: File, Io: io_for( LIB_PATH.dirname( File ) ) }, Extra || {} ) );
}

function built_in( Name )
{
	return Profiles.Check( Profiles.Load( Name ), SERVED );
}

function names( Applied )
{
	return Applied.map( function ( Command ) { return Command.Command; } );
}


//---------------------------------------------------------------------
describe( 'The built-in profiles', function ()
{

	it( 'load, check against the served commands, and name commands which exist', function ()
	{
		for ( let index = 0; index < Profiles.NAMES.length; index++ )
		{
			let profile = built_in( Profiles.NAMES[ index ] );
			LIB_ASSERT.strictEqual( profile.Name, Profiles.NAMES[ index ] );
			LIB_ASSERT.ok( profile.Commands.length > 0 );
		}
		LIB_ASSERT.deepStrictEqual( names( Profiles.Apply( SERVED, built_in( 'full' ) ) ), names( SERVED ) );
		LIB_ASSERT.strictEqual( built_in( 'full' ).Everything, true );
	} );

	it( 'are each a superset of the one before: translate, run, design', function ()
	{
		let translate = built_in( 'translate' ).Commands;
		let run = built_in( 'run' ).Commands;
		let design = built_in( 'design' ).Commands;
		LIB_ASSERT.deepStrictEqual( translate, [ 'datasource list', 'datasource describe', 'datasource find', 'datasource count', 'validate', 'plan', 'explain' ] );
		LIB_ASSERT.ok( translate.every( function ( Command ) { return run.includes( Command ); } ) );
		LIB_ASSERT.ok( run.includes( 'run' ) && !translate.includes( 'run' ) );
		LIB_ASSERT.ok( run.every( function ( Command ) { return design.includes( Command ); } ) );
		LIB_ASSERT.ok( design.includes( 'query add' ) && design.includes( 'adapters settings' ) && design.includes( 'format' ) );
	} );

	it( 'serve no yes, nothing destructive, and no storage verb which writes, outside full; find is bounded and cannot write', function ()
	{
		for ( let profile of [ 'translate', 'run', 'design' ] )
		{
			let applied = Profiles.Apply( SERVED, built_in( profile ) );
			for ( let index = 0; index < applied.length; index++ )
			{
				let command = applied[ index ];
				LIB_ASSERT.ok( !( 'yes' in command.Options ), profile + ': ' + command.Command + ' declares yes' );
				LIB_ASSERT.ok( !WRITING_VERBS.includes( command.Command ), profile + ' serves ' + command.Command );
			}
			let find = applied.find( function ( Command ) { return Command.Command === 'datasource find'; } );
			LIB_ASSERT.ok( find, profile + ' serves find' );
			for ( let option of [ 'into', 'save', 'force' ] ) { LIB_ASSERT.ok( !( option in find.Options ), profile + ': find has ' + option ); }
			LIB_ASSERT.deepStrictEqual( find.Defaults, { max: 5 } );
		}
		let full = Profiles.Apply( SERVED, built_in( 'full' ) );
		let del = full.find( function ( Command ) { return Command.Command === 'datasource delete'; } );
		LIB_ASSERT.ok( 'yes' in del.Options, 'full keeps yes' );
		LIB_ASSERT.ok( 'save' in full.find( function ( Command ) { return Command.Command === 'datasource find'; } ).Options );
	} );

	it( 'mark what a relay confirms: run in run and design, every edit and format in design, nothing in translate', function ()
	{
		LIB_ASSERT.deepStrictEqual( built_in( 'translate' ).Confirm, [] );
		LIB_ASSERT.deepStrictEqual( built_in( 'run' ).Confirm, [ 'run' ] );
		let design = Profiles.Apply( SERVED, built_in( 'design' ) );
		for ( let index = 0; index < design.length; index++ )
		{
			let command = design[ index ];
			let edits = /^(datasource|query|insert|update|delete|process|trigger) (add|set|remove|rename)$/.test( command.Command );
			let expected = edits || command.Command === 'run' || command.Command === 'format';
			LIB_ASSERT.strictEqual( command.Confirm, expected, 'design: ' + command.Command );
		}
	} );

	it( 'carry instructions for a model, and full carries none', function ()
	{
		LIB_ASSERT.strictEqual( built_in( 'full' ).Instructions, '' );
		for ( let profile of [ 'translate', 'run', 'design' ] ) { LIB_ASSERT.ok( built_in( profile ).Instructions.length > 100, profile ); }
		LIB_ASSERT.match( built_in( 'translate' ).Instructions, /do not run it/ );
		LIB_ASSERT.match( built_in( 'run' ).Instructions, /run the object you built/ );
	} );

} );


//---------------------------------------------------------------------
describe( 'A custom profile', function ()
{

	let root = null;

	before( function ()
	{
		root = LIB_FS.mkdtempSync( LIB_PATH.join( LIB_OS.tmpdir(), 'jsonx-profile-' ) );
		LIB_FS.writeFileSync( LIB_PATH.join( root, 'mine.json' ), JSON.stringify( { Name: 'mine', Describe: 'Two reads and a run.', Commands: [ 'datasource find', 'datasource count', 'run' ], Without: { 'datasource find': [ 'save' ] }, Defaults: { 'datasource find': { max: 2 } }, Confirm: [ 'run' ], Instructions: 'Read, then run.' } ) );
		LIB_FS.writeFileSync( LIB_PATH.join( root, 'translate.json' ), JSON.stringify( { Name: 'translate', Commands: [ 'validate' ] } ) );
		LIB_FS.writeFileSync( LIB_PATH.join( root, 'not-json.json' ), '{ "Name": ' );
	} );

	after( function () { LIB_FS.rmSync( root, { recursive: true, force: true } ); } );

	it( 'loads from a file named relative to the working directory, and fills in what it leaves out', function ()
	{
		let profile = Profiles.Check( Profiles.Load( 'mine.json', io_for( root ) ), SERVED );
		LIB_ASSERT.deepStrictEqual( profile.Commands, [ 'datasource find', 'datasource count', 'run' ] );
		LIB_ASSERT.deepStrictEqual( profile.Without, { 'datasource find': [ 'save' ] } );
		LIB_ASSERT.deepStrictEqual( profile.Defaults, { 'datasource find': { max: 2 } } );
		LIB_ASSERT.strictEqual( profile.Everything, false );

		let sparse = Profiles.Check( Profiles.Load( LIB_PATH.join( root, 'translate.json' ) ), SERVED );
		LIB_ASSERT.deepStrictEqual( sparse, { Name: 'translate', Describe: '', Commands: [ 'validate' ], Everything: false, Without: {}, Defaults: {}, Confirm: [], Instructions: '' } );
	} );

	it( 'is refused for an unknown name, a missing or unparsable file, and a shape which is wrong, naming what is wrong', function ()
	{
		let cases = [
			[ function () { Profiles.Load( 'nonsense', io_for( root ) ); }, /No profile is named \[nonsense\]: it is not a built-in \(full, translate, run, design\)/ ],
			[ function () { Profiles.Load( 'missing.json', io_for( root ) ); }, /No profile is named \[missing\.json\]/ ],
			[ function () { Profiles.Load( 'not-json.json', io_for( root ) ); }, /is not JSON/ ],
			[ function () { Profiles.Check( { Commands: [ 'run' ] }, SERVED ); }, /must carry a Name/ ],
			[ function () { Profiles.Check( { Name: 'x' }, SERVED ); }, /must list its Commands/ ],
			[ function () { Profiles.Check( { Name: 'x', Commands: [ 'datasource fly' ] }, SERVED ); }, /names a command which is not served: \[datasource fly\]/ ],
			[ function () { Profiles.Check( { Name: 'x', Commands: [ 'run' ], Without: { 'validate': [ 'strict' ] } }, SERVED ); }, /withholds options of a command it does not serve: \[validate\]/ ],
			[ function () { Profiles.Check( { Name: 'x', Commands: [ 'run' ], Without: { 'run': [ 'nope' ] } }, SERVED ); }, /withholds an option \[run\] does not have: \[nope\]/ ],
			[ function () { Profiles.Check( { Name: 'x', Commands: [ 'datasource find' ], Defaults: { 'datasource find': { nope: 1 } } }, SERVED ); }, /defaults an option \[datasource find\] does not have: \[nope\]/ ],
			[ function () { Profiles.Check( { Name: 'x', Commands: [ 'datasource find' ], Without: { 'datasource find': [ 'max' ] }, Defaults: { 'datasource find': { max: 1 } } }, SERVED ); }, /defaults an option it withholds/ ],
			[ function () { Profiles.Check( { Name: 'x', Commands: [ 'run' ], Confirm: [ 'validate' ] }, SERVED ); }, /confirms a command it does not serve: \[validate\]/ ],
			[ function () { Profiles.Check( { Name: 'x', Commands: [ 'run' ], Instructions: 5 }, SERVED ); }, /Instructions must be a string/ ],
		];
		for ( let index = 0; index < cases.length; index++ )
		{
			LIB_ASSERT.throws( cases[ index ][ 0 ], function ( error ) { return ( error instanceof Profiles.ProfileError ) && cases[ index ][ 1 ].test( error.message ); }, 'case ' + index );
		}
	} );

	it( 'accepts a command written with extra spaces, and "*" for everything', function ()
	{
		let spaced = Profiles.Check( { Name: 'x', Commands: [ ' datasource   find ' ] }, SERVED );
		LIB_ASSERT.deepStrictEqual( spaced.Commands, [ 'datasource find' ] );
		let everything = Profiles.Check( { Name: 'x', Commands: '*' }, SERVED );
		LIB_ASSERT.strictEqual( everything.Commands.length, SERVED.length );
	} );

} );


//---------------------------------------------------------------------
describe( 'A held session under a profile', function ()
{

	let root = null;
	let observatory = null;

	before( function ()
	{
		root = LIB_FS.mkdtempSync( LIB_PATH.join( LIB_OS.tmpdir(), 'jsonx-held-profile-' ) );
		observatory = LIB_PATH.join( root, 'observatory.jsonx' );
		LIB_FS.writeFileSync( observatory, JSON.stringify( Spec.AppendixB(), null, '\t' ) );
		LIB_FS.writeFileSync( LIB_PATH.join( root, 'mine.json' ), JSON.stringify( { Name: 'mine', Commands: [ 'datasource find', 'datasource count', 'run' ], Defaults: { 'datasource find': { max: 2 } }, Confirm: [ 'run' ] } ) );
		LIB_FS.writeFileSync( LIB_PATH.join( root, 'translate.json' ), JSON.stringify( { Name: 'translate', Describe: 'Mine, standing in.', Commands: [ 'validate' ] } ) );
		LIB_FS.writeFileSync( LIB_PATH.join( root, 'broken.json' ), JSON.stringify( { Name: 'broken', Commands: [ 'datasource fly' ] } ) );
	} );

	after( function () { LIB_FS.rmSync( root, { recursive: true, force: true } ); } );


	it( 'serves everything with no profile, and lists it as full', async function ()
	{
		let held = hold( observatory );
		try
		{
			LIB_ASSERT.strictEqual( held.Profile.Name, 'full' );
			LIB_ASSERT.deepStrictEqual( names( held.Served() ), names( SERVED ) );
			let summary = held.ProfileSummary();
			LIB_ASSERT.strictEqual( summary.Name, 'full' );
			LIB_ASSERT.strictEqual( summary.Commands.length, SERVED.length );
			let deleted = await held.Invoke( { Command: 'datasource delete', name: 'Notes', criteria: { A: 1 } } );
			LIB_ASSERT.strictEqual( deleted.ExitCode, 0, deleted.Log.join( '\n' ) );
		}
		finally { await held.Release(); }
	} );

	it( 'refuses a command outside the profile, and an option it withholds, with exit 2 naming the profile', async function ()
	{
		let held = hold( observatory, { Profile: 'translate' } );
		try
		{
			LIB_ASSERT.deepStrictEqual( names( held.Served() ), [ 'validate', 'plan', 'explain', 'datasource list', 'datasource describe', 'datasource find', 'datasource count' ] );

			let ran = await held.Invoke( { Command: 'run', name: 'Prepare the season' } );
			LIB_ASSERT.strictEqual( ran.ExitCode, 2 );
			LIB_ASSERT.match( ran.Log.join( '\n' ), /^\[run\] is not served in profile \[translate\]\./ );

			let deleted = await held.Invoke( { Command: 'datasource delete', name: 'Notes', criteria: {}, yes: true } );
			LIB_ASSERT.strictEqual( deleted.ExitCode, 2 );

			let saved = await held.Invoke( { Command: 'datasource find', name: 'Bookings', criteria: {}, save: 'Kept' } );
			LIB_ASSERT.strictEqual( saved.ExitCode, 2 );
			LIB_ASSERT.match( saved.Log.join( '\n' ), /^Option \[--save\] is not served in profile \[translate\]\./ );
			LIB_ASSERT.strictEqual( LIB_FS.readFileSync( observatory, 'utf8' ), JSON.stringify( Spec.AppendixB(), null, '\t' ) );

			// What the profile serves still works, and help is never refused.
			let found = await held.Invoke( { Command: 'datasource find', name: 'Bookings', criteria: {} } );
			LIB_ASSERT.strictEqual( found.ExitCode, 0, found.Log.join( '\n' ) );
			let help = await held.Invoke( { Command: 'run', help: true } );
			LIB_ASSERT.strictEqual( help.ExitCode, 0 );
		}
		finally { await held.Release(); }
	} );

	it( 'puts a default into a request which gave none, and leaves one which did', async function ()
	{
		let held = hold( observatory, { Profile: 'mine.json' } );
		try
		{
			let seeded = await held.Invoke( { Command: 'run', name: 'Three bookings' } );
			LIB_ASSERT.strictEqual( seeded.ExitCode, 0, seeded.Log.join( '\n' ) );

			let bounded = await held.Invoke( { Command: 'datasource find', name: 'Bookings', criteria: {} } );
			LIB_ASSERT.strictEqual( bounded.ExitCode, 0, bounded.Log.join( '\n' ) );
			LIB_ASSERT.strictEqual( bounded.Result.length, 2 );

			let asked = await held.Invoke( { Command: 'datasource find', name: 'Bookings', criteria: {}, max: 3 } );
			LIB_ASSERT.strictEqual( asked.Result.length, 3 );

			let counted = await held.Invoke( { Command: 'datasource count', name: 'Bookings', criteria: {} } );
			LIB_ASSERT.strictEqual( counted.Result, 3 );
		}
		finally { await held.Release(); }
	} );

	it( 'switches profile, tells every listener, and judges the next request under the new one; a bad switch changes nothing', async function ()
	{
		let held = hold( observatory, { Profile: 'translate' } );
		try
		{
			let heard = [];
			held.OnEvent( function ( Event ) { if ( Event.Event === 'profile' ) { heard.push( Event.Profile ); } } );

			let summary = held.SetProfile( 'run' );
			LIB_ASSERT.strictEqual( summary.Name, 'run' );
			LIB_ASSERT.deepStrictEqual( summary.Confirm, [ 'run' ] );
			LIB_ASSERT.ok( summary.Commands.includes( 'run' ) );
			LIB_ASSERT.strictEqual( heard.length, 1 );
			LIB_ASSERT.strictEqual( heard[ 0 ].Name, 'run' );

			let ran = await held.Invoke( { Command: 'run', name: 'Prepare the season' } );
			LIB_ASSERT.strictEqual( ran.ExitCode, 0, ran.Log.join( '\n' ) );

			LIB_ASSERT.throws( function () { held.SetProfile( 'broken.json' ); }, function ( error ) { return ( error instanceof Profiles.ProfileError ) && /datasource fly/.test( error.message ); } );
			LIB_ASSERT.strictEqual( held.Profile.Name, 'run' );
			LIB_ASSERT.strictEqual( heard.length, 1 );

			// A file carrying a built-in's name stands in for it.
			held.SetProfile( 'translate.json' );
			LIB_ASSERT.strictEqual( held.Profile.Describe, 'Mine, standing in.' );
			LIB_ASSERT.deepStrictEqual( names( held.Served() ), [ 'validate' ] );
			LIB_ASSERT.strictEqual( heard.length, 2 );
		}
		finally { await held.Release(); }
	} );

	it( 'refuses to hold a session under a profile which does not check, with exit 2', function ()
	{
		LIB_ASSERT.throws( function () { hold( observatory, { Profile: 'broken.json' } ); }, function ( error ) { return ( error instanceof Held.HeldError ) && error.ExitCode === 2 && /datasource fly/.test( error.message ); } );
		LIB_ASSERT.throws( function () { hold( observatory, { Profile: 'nonsense' } ); }, function ( error ) { return ( error instanceof Held.HeldError ) && error.ExitCode === 2 && /No profile is named \[nonsense\]/.test( error.message ); } );
	} );

} );
