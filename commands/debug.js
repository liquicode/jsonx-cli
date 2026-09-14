'use strict';

/*
	jsonx debug <process> [--input <json>]

	Steps a Process (plan F3.5), reading one command per line from standard input and writing one
	JSON snapshot per line to standard output: the first when the debug starts, then one for each
	command. It ends when the Process finishes, on `quit`, or at the end of input, and the run
	report goes to standard error then, as `jsonx run` writes it.

		step  into  continue  decline  answer <json>  state  skip  quit

	***Standard output is JSON Lines and nothing else***, so a script reads it a line at a time; the
	result is in the last snapshot, and --output does not apply. ***Standard input carries the
	commands***, so no value may be read from it with `-`.

	Exit codes: 0 the Process finished; 1 it failed, or was stopped by quit or the end of input;
	2 a usage mistake, or a name which is not a Process; 3 the file has errors.
*/

const Debugger = require( '../src/Session/Debugger.js' );
const Report = require( '../src/Report.js' );
const SessionCommand = require( './session.js' );


//---------------------------------------------------------------------
async function handler( Parsed, Context )
{
	let io = Context.Io;
	let out = Context.Out;
	let value = function ( Name ) { return Context.Parser.Value( Context.Tree, Parsed, Name ); };

	if ( Parsed.Given.output === true )
	{
		out.Log( 'Option [--output] does not apply to jsonx debug, which writes one JSON snapshot per line.\n' );
		return 2;
	}
	if ( Parsed.StdinRead === true )
	{
		out.Log( 'jsonx debug reads its commands from standard input, so no value can be read from it with -. Use @file.\n' );
		return 2;
	}

	let opened = await SessionCommand.OpenSession( Parsed, Context, SessionCommand.RunExtras( Parsed, Context ) );
	if ( typeof opened.ExitCode === 'number' ) { return opened.ExitCode; }
	let session = opened.Session;

	let debug = null;
	try
	{
		debug = Debugger.NewDebugger( session, value( 'process' ), value( 'input' ) );
	}
	catch ( error )
	{
		await session.Release();
		if ( !( error instanceof Debugger.DebugError ) ) { throw error; }
		out.Log( error.message + '\n' );
		return 2;
	}

	let write = function ( Snapshot ) { out.Line( Snapshot ); };

	try
	{
		write( await debug.Start() );

		if ( !debug.Finished && typeof io.Lines === 'function' )
		{
			for await ( let line of io.Lines() )
			{
				if ( String( line ).trim() === '' ) { continue; }
				write( await debug.Command( line ) );
				if ( debug.Finished ) { break; }
			}
		}

		// ***The end of input stops the debug***, as quit does, and says so.
		if ( !debug.Finished ) { write( await debug.Command( 'quit' ) ); }

		if ( !value( 'quiet' ) ) { out.Log( Report.FormatRunReport( debug.Report, 0, { Statistics: value( 'verbose' ), Trace: value( 'trace' ) } ) ); }
	}
	finally
	{
		await session.Release();
	}

	return ( debug.Outcome === 'done' ) ? 0 : 1;
}


//---------------------------------------------------------------------
module.exports = {
	Command: 'debug',
	Describe: 'Step a Process, reading commands from standard input: step, into, continue, decline, answer <json>, state, skip, quit.',
	Library: [ 'jsonproc.Start', 'jsonproc.Step', 'jsonproc.Resume' ],
	Positionals: [
		{ Name: 'process', Type: 'string', Required: true, Complete: 'objects:Process', Describe: 'The Process to debug.' },
	],
	Options: Object.assign( {
		'input': { Type: 'json', Describe: 'The starting document of a Process with no DataSource.' },
	}, SessionCommand.RUN_OPTIONS ),
	Handler: handler,
};
