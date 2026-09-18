'use strict';

/*
	jsonx run <name> | --json <object> [--input <json>]

	Runs one object of the file by name (spec section 6), or a draft given as JSON: an object which is
	not in the file, checked as if it were (src/File/Draft.js) and run unsaved (cut 7). The result is written to standard output
	as --output asks; the report - one line per object run, indented under its caller, a line per
	trigger firing, and a failure expanded - goes to standard error.

	Exit codes: 0 the object ran; 1 it failed; 2 a usage mistake or no file; 3 the file has errors
	and nothing ran.
*/

const SessionCommand = require( './session.js' );
const Names = require( '../src/File/Names.js' );
const Draft = require( '../src/File/Draft.js' );
const Validate = require( '../src/Validate/Validate.js' );


//---------------------------------------------------------------------
async function handler( Parsed, Context )
{
	let name = Context.Parser.Value( Context.Tree, Parsed, 'name' );
	let draft = Context.Parser.Value( Context.Tree, Parsed, 'json' );
	let input = Context.Parser.Value( Context.Tree, Parsed, 'input' );

	if ( typeof name === 'string' && typeof draft !== 'undefined' )
	{
		Context.Out.Log( '--json is the object; do not name one as well.\n' );
		return 2;
	}
	if ( typeof name !== 'string' && typeof draft === 'undefined' )
	{
		Context.Out.Log( 'Name one object, or pass --json.\n' );
		return 2;
	}

	let opened = await SessionCommand.OpenSession( Parsed, Context, SessionCommand.RunExtras( Parsed, Context ) );
	if ( typeof opened.ExitCode === 'number' ) { return opened.ExitCode; }

	let entry = null;
	if ( typeof draft !== 'undefined' )
	{
		// ***A draft with errors runs nothing***, exit 3, as a built object of the storage verbs; a
		// draft which is not an object is a usage mistake. It is checked in a copy of the file
		// (src/File/Draft.js) and run as itself, unsaved.
		let placed = Draft.Place( opened.Session.Document, draft );
		if ( placed.Section !== 'Objects' )
		{
			await opened.Session.Release();
			Context.Out.Log( 'The draft is not an object: run takes a Query, an Insert, an Update, a Delete or a Process.\n' );
			return 2;
		}
		let findings = Draft.ValidateDraft( opened.Session.Document, draft, {
			jsongin: require( '@liquicode/jsongin' ), jsonproc: require( '@liquicode/jsonproc' ), Env: Context.Io.Env, CheckSettings: opened.Session.Catalog.ValidateSettings,
		} );
		let summary = Validate.Summarize( findings );
		if ( summary.Errors > 0 )
		{
			await opened.Session.Release();
			for ( let index = 0; index < findings.length; index++ ) { Context.Out.Finding( findings[ index ] ); }
			Context.Out.Log( 'The draft has ' + summary.Errors + ' error' + ( summary.Errors === 1 ? '' : 's' ) + '; nothing ran.\n' );
			return 3;
		}
		entry = placed.Entry;
		name = placed.Name;
	}
	else
	{
		// ***A name the file does not define is a usage mistake, exit 2***, as it is for validate;
		// exit 1 is kept for an object which ran and failed.
		let item = Names.FindEntry( opened.Session.Document, name );
		if ( item === null || item.Section !== 'Objects' )
		{
			await opened.Session.Release();
			let what = ( item === null ) ? 'No object is named [' + name + ']' : '[' + name + '] is not an object; it is in ' + item.Section;
			Context.Out.Log( what + ' in ' + opened.Path + '.\n' );
			return 2;
		}
		entry = item.Entry;
	}

	// --changes says what an Update changed; on anything else it would be accepted and ignored.
	if ( Context.Parser.Value( Context.Tree, Parsed, 'changes' ) === true && entry.Kind !== 'Update' )
	{
		await opened.Session.Release();
		let article = /^[AEIOU]/.test( entry.Kind ) ? 'an' : 'a';
		Context.Out.Log( 'Option [--changes] has an effect only on an Update, and [' + name + '] is ' + article + ' ' + entry.Kind + '.\n' );
		return 2;
	}

	let report = null;
	try
	{
		report = ( typeof draft !== 'undefined' ) ? await opened.Session.RunEntry( entry, input ) : await opened.Session.Run( name, input );
	}
	catch ( error )
	{
		await opened.Session.Release();
		throw error;
	}
	return await SessionCommand.FinishRun( report, opened.Session, Parsed, Context );
}


//---------------------------------------------------------------------
module.exports = {
	Command: 'run',
	Describe: 'Run an object of the file by name.',
	// A run drives jsonproc, and a Process reaches every host function through `$call` (spec 12.7).
	Library: [ 'jsonproc.Start', 'jsonproc.Execute', 'jsonproc.Resume' ].concat( require( '../src/File/Names.js' ).HOST_FUNCTIONS.map( function ( Name ) { return 'jsonstor.' + Name; } ) ),
	Positionals: [
		{ Name: 'name', Type: 'string', Complete: 'objects', Describe: 'The object to run; or pass --json.' },
	],
	Options: Object.assign( {
		'json': { Type: 'json', JsonType: 'object', Describe: 'A draft object as JSON, checked as if it were in the file and run unsaved.' },
		'input': { Type: 'json', Describe: 'The starting document of a Process with no DataSource.' },
	}, SessionCommand.CHANGES_OPTION, SessionCommand.RUN_OPTIONS ),
	Handler: handler,
};
