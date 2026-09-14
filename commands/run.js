'use strict';

/*
	jsonx run <name> [--input <json>]

	Runs one object of the file by name (spec section 6). The result is written to standard output
	as --output asks; the report - one line per object run, indented under its caller, a line per
	trigger firing, and a failure expanded - goes to standard error.

	Exit codes: 0 the object ran; 1 it failed; 2 a usage mistake or no file; 3 the file has errors
	and nothing ran.
*/

const SessionCommand = require( './session.js' );
const Names = require( '../src/File/Names.js' );


//---------------------------------------------------------------------
async function handler( Parsed, Context )
{
	let opened = await SessionCommand.OpenSession( Parsed, Context, SessionCommand.RunExtras( Parsed, Context ) );
	if ( typeof opened.ExitCode === 'number' ) { return opened.ExitCode; }

	let name = Context.Parser.Value( Context.Tree, Parsed, 'name' );
	let input = Context.Parser.Value( Context.Tree, Parsed, 'input' );

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

	// --changes says what an Update changed; on anything else it would be accepted and ignored.
	if ( Context.Parser.Value( Context.Tree, Parsed, 'changes' ) === true && item.Entry.Kind !== 'Update' )
	{
		await opened.Session.Release();
		let article = /^[AEIOU]/.test( item.Entry.Kind ) ? 'an' : 'a';
		Context.Out.Log( 'Option [--changes] has an effect only on an Update, and [' + name + '] is ' + article + ' ' + item.Entry.Kind + '.\n' );
		return 2;
	}

	let report = null;
	try
	{
		report = await opened.Session.Run( name, input );
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
		{ Name: 'name', Type: 'string', Required: true, Complete: 'objects', Describe: 'The object to run.' },
	],
	Options: Object.assign( {
		'input': { Type: 'json', Describe: 'The starting document of a Process with no DataSource.' },
	}, SessionCommand.CHANGES_OPTION, SessionCommand.RUN_OPTIONS ),
	Handler: handler,
};
