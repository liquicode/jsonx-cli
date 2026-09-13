'use strict';

/*
	jsonx plan <name>

	The dry run (plan F3.3): what running the object would do, with nothing opened. The plan goes
	to standard output; a readable tree of it to standard error.

	Exit codes: 0 the object has no errors; 3 it has; 2 the name is not an object or no file.
*/

const FileCommand = require( './file.js' );
const SessionCommand = require( './session.js' );
const Plan = require( '../src/Session/Plan.js' );
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
	let plan = null;
	try
	{
		plan = Plan.PlanObject( loaded.Document, name, Object.assign( {}, loaded.ValidateOptions, {
			Catalog: loaded.Catalog, Binds: value( 'bind' ), Sets: value( 'set' ), Cwd: io.Cwd, FilePath: loaded.Path,
		} ) );
	}
	catch ( error )
	{
		if ( !( error instanceof Overrides.OverrideError ) ) { throw error; }
		io.Stderr( error.message + '\n' );
		return 2;
	}

	if ( plan === null )
	{
		io.Stderr( 'No object is named [' + name + '] in ' + loaded.Path + '.\n' );
		return 2;
	}

	Report.WriteResult( io, value( 'output' ), plan );
	if ( !value( 'quiet' ) ) { io.Stderr( Report.FormatPlan( plan ) ); }

	return plan.Findings.some( function ( Finding ) { return Finding.Severity === 'error'; } ) ? 3 : 0;
}


//---------------------------------------------------------------------
module.exports = {
	Command: 'plan',
	Describe: 'Show what running an object would do, opening nothing.',
	Positionals: [
		{ Name: 'name', Type: 'string', Required: true, Describe: 'The object to plan.' },
	],
	Options: Object.assign( {}, SessionCommand.SESSION_OPTIONS ),
	Handler: handler,
};
