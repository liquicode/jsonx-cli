'use strict';

/*
	jsonx plan <name> | --json <object>

	The dry run (plan F3.3): what running the object would do, with nothing opened. The object is one of
	the file, by name, or a draft given as JSON and planned as if it were in the file (src/File/Draft.js). The plan goes
	to standard output; a readable tree of it to standard error.

	Exit codes: 0 the object has no errors; 3 it has; 2 the name is not an object or no file.
*/

const FileCommand = require( './file.js' );
const SessionCommand = require( './session.js' );
const Plan = require( '../src/Session/Plan.js' );
const Draft = require( '../src/File/Draft.js' );
const Overrides = require( '../src/Session/Overrides.js' );
const Report = require( '../src/Report.js' );


//---------------------------------------------------------------------
async function handler( Parsed, Context )
{
	let io = Context.Io;
	let value = function ( Name ) { return Context.Parser.Value( Context.Tree, Parsed, Name ); };

	let loaded = FileCommand.LoadFile( Parsed, Context );
	if ( typeof loaded.ExitCode === 'number' ) { return loaded.ExitCode; }

	let name = value( 'name' );
	let draft = value( 'json' );
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

	// A draft is planned in a copy of the file, where it is found by name (src/File/Draft.js).
	let document = loaded.Document;
	let placed = null;
	if ( typeof draft !== 'undefined' )
	{
		placed = Draft.Place( loaded.Document, draft );
		document = placed.Copy;
		name = placed.Name;
	}

	let plan = null;
	try
	{
		plan = Plan.PlanObject( document, name, Object.assign( {}, loaded.ValidateOptions, {
			// A served plan uses the held session's overrides; a request cannot give its own.
			Catalog: loaded.Catalog, Binds: loaded.Binds || value( 'bind' ), Sets: loaded.Sets || value( 'set' ), Cwd: io.Cwd, FilePath: loaded.Path,
		} ) );
	}
	catch ( error )
	{
		if ( !( error instanceof Overrides.OverrideError ) ) { throw error; }
		Context.Out.Log( error.message + '\n' );
		return 2;
	}

	if ( plan === null )
	{
		if ( placed !== null ) { Context.Out.Log( 'The draft is not an object: plan takes a Query, an Insert, an Update, a Delete or a Process.\n' ); }
		else { Context.Out.Log( 'No object is named [' + name + '] in ' + loaded.Path + '.\n' ); }
		return 2;
	}
	if ( placed !== null )
	{
		if ( placed.Note === null ) { plan.Findings = Draft.DropUncalledNote( plan.Findings, placed.Path ); }
		plan.Findings = Draft.Rewrite( plan.Findings, placed.Path );
		if ( placed.Note !== null ) { plan.Findings.unshift( placed.Note ); }
	}

	Context.Out.Result( plan );
	if ( !value( 'quiet' ) ) { Context.Out.Log( Report.FormatPlan( plan ) ); }

	return plan.Findings.some( function ( Finding ) { return Finding.Severity === 'error'; } ) ? 3 : 0;
}


//---------------------------------------------------------------------
module.exports = {
	Command: 'plan',
	Describe: 'Show what running an object would do, opening nothing.',
	Concurrent: true,
	Positionals: [
		{ Name: 'name', Type: 'string', Complete: 'objects', Describe: 'The object to plan; or pass --json.' },
	],
	Options: Object.assign( {
		'json': { Type: 'json', JsonType: 'object', Describe: 'A draft object as JSON, planned as if it were in the file.' },
	}, SessionCommand.SESSION_OPTIONS ),
	Handler: handler,
};
