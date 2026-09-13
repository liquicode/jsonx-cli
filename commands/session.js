'use strict';

/*
	What every command which opens data sources shares: its options, and how it gets a session.

	***A file with errors runs nothing.*** A runner is a conforming reader (spec 2), so the file is
	validated first and its errors are reported on standard error with exit 3, before a data source
	opens. Warnings and notes do not stop a run.

	`--bind` and `--set` are declared here rather than as global options, because only these
	commands read them, and an option a command accepts and ignores is the defect the parser
	exists to prevent.
*/

const jsongin = require( '@liquicode/jsongin' );
const jsonproc = require( '@liquicode/jsonproc' );

const Reader = require( '../src/File/Reader.js' );
const Validate = require( '../src/Validate/Validate.js' );
const Session = require( '../src/Session/Session.js' );
const Overrides = require( '../src/Session/Overrides.js' );
const Report = require( '../src/Report.js' );


//---------------------------------------------------------------------
const SESSION_OPTIONS = {
	'bind': { Type: 'string', Repeat: true, Describe: 'Point a data source at another adapter for this run: Name=adapter or Name=adapter:{settings}.' },
	'set': { Type: 'string', Repeat: true, Describe: 'Change one setting of a data source for this run: Name.Settings.Key=value.' },
};


//---------------------------------------------------------------------
// Opens a session for a command. Returns { Session, Path } or { ExitCode } when it cannot.

async function OpenSession( Parsed, Context )
{
	let io = Context.Io;
	let value = function ( Name ) { return Context.Parser.Value( Context.Tree, Parsed, Name ); };

	let resolved = null;
	let text = null;
	try
	{
		resolved = Reader.ResolvePath( value( 'file' ), io.Env, io.Cwd, io );
		text = Reader.ReadText( resolved.Path, io );
	}
	catch ( error )
	{
		if ( !( error instanceof Reader.FileError ) ) { throw error; }
		io.Stderr( error.message + '\n' );
		return { ExitCode: error.IsUsage ? 2 : 1 };
	}

	let read = Reader.ParseText( text );
	if ( typeof read.Document === 'undefined' || read.Document === null || typeof read.Document !== 'object' || Array.isArray( read.Document ) )
	{
		let findings = read.Findings.length > 0 ? read.Findings : Validate.ValidateFile( read.Document, {} );
		write_findings( io, resolved.Path, findings );
		return { ExitCode: 3 };
	}

	let session = null;
	try
	{
		session = Session.NewSession( {
			Document: read.Document,
			Path: resolved.Path,
			Binds: value( 'bind' ),
			Sets: value( 'set' ),
			Env: io.Env,
			Cwd: io.Cwd,
		} );
	}
	catch ( error )
	{
		if ( !( error instanceof Overrides.OverrideError ) ) { throw error; }
		io.Stderr( error.message + '\n' );
		return { ExitCode: 2 };
	}

	let findings = Validate.ValidateFile( read.Document, {
		jsongin: jsongin, jsonproc: jsonproc, Env: io.Env, CheckSettings: session.Catalog.ValidateSettings,
	} );
	if ( Validate.Summarize( findings ).Errors > 0 )
	{
		write_findings( io, resolved.Path, findings.filter( function ( Finding ) { return Finding.Severity === 'error'; } ) );
		io.Stderr( 'Nothing ran: the file has errors. Run jsonx validate for every finding.\n' );
		return { ExitCode: 3 };
	}

	return { Session: session, Path: resolved.Path };
}


//---------------------------------------------------------------------
function write_findings( Io, Path, Findings )
{
	for ( let index = 0; index < Findings.length; index++ ) { Io.Stderr( Report.FormatFinding( Findings[ index ] ) ); }
	Io.Stderr( Report.FormatSummary( Path, Validate.Summarize( Findings ) ) );
	return;
}


//---------------------------------------------------------------------
// Writes a run report and the result, releases the session, and answers the exit code.

async function FinishRun( RunReport, Session_, Parsed, Context )
{
	let io = Context.Io;
	let value = function ( Name ) { return Context.Parser.Value( Context.Tree, Parsed, Name ); };

	try
	{
		if ( !value( 'quiet' ) ) { io.Stderr( Report.FormatRunReport( RunReport ) ); }
		if ( RunReport.Ok ) { Report.WriteResult( io, value( 'output' ), RunReport.Result ); }
	}
	finally
	{
		await Session_.Release();
	}
	return RunReport.Ok ? 0 : 1;
}


//---------------------------------------------------------------------
module.exports = {
	SESSION_OPTIONS: SESSION_OPTIONS,
	OpenSession: OpenSession,
	FinishRun: FinishRun,
};
