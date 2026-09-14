'use strict';

/*
	What every command which opens data sources shares: its options, and how it gets a session.

	***A file with errors runs nothing.*** A runner is a conforming reader (spec 2), so the file is
	validated first and its errors are reported on standard error with exit 3, before a data source
	opens. Warnings and notes do not stop a run.

	`--bind`, `--set` and `--verbose` are declared on the commands which read them rather than as
	global options, because an option a command accepts and ignores is the defect the parser exists
	to prevent.
*/

const jsongin = require( '@liquicode/jsongin' );
const jsonproc = require( '@liquicode/jsonproc' );

const Reader = require( '../src/File/Reader.js' );
const Validate = require( '../src/Validate/Validate.js' );
const Session = require( '../src/Session/Session.js' );
const Overrides = require( '../src/Session/Overrides.js' );
const Report = require( '../src/Report.js' );


//---------------------------------------------------------------------
// Every command which opens data sources.
const SESSION_OPTIONS = {
	'bind': { Type: 'string', Repeat: true, Describe: 'Point a data source at another adapter for this run: Name=adapter or Name=adapter:{settings}.' },
	'set': { Type: 'string', Repeat: true, Describe: 'Change one setting of a data source for this run: Name.Settings.Key=value.' },
};

// The commands which run objects.
const RUN_OPTIONS = Object.assign( {
	'verbose': { Type: 'boolean', Alias: 'v', Describe: 'Add what each storage call measured to the report.' },
	'trace': { Type: 'boolean', Describe: 'Add every storage call, with its parameters and result, to the report.' },
}, SESSION_OPTIONS );


//---------------------------------------------------------------------
// What a command with RUN_OPTIONS asks of its session.

function RunExtras( Parsed, Context )
{
	let value = function ( Name ) { return Context.Parser.Value( Context.Tree, Parsed, Name ); };
	return { Statistics: value( 'verbose' ), Trace: value( 'trace' ) };
}


//---------------------------------------------------------------------
// Opens a session for a command. Returns { Session, Path } or { ExitCode } when it cannot.
//
// Extra.Statistics measures every storage call the session's runner makes; Extra.Trace records
// each one with jsonstor-oplog.

async function OpenSession( Parsed, Context, Extra )
{
	let io = Context.Io;
	let out = Context.Out;
	let extra = ( Extra && typeof Extra === 'object' ) ? Extra : {};
	let value = function ( Name ) { return Context.Parser.Value( Context.Tree, Parsed, Name ); };

	// ***A served command borrows the held session*** (src/Session/Held.js): nothing is read or
	// built, the file is validated as it is held now, and this run's --verbose and --trace are set.
	if ( Context.Held )
	{
		let held = Context.Held;
		if ( refuse_errors( out, held.Path, held.Session.Document, io, held.Session.Catalog ) ) { return { ExitCode: 3 }; }
		held.Session.SetRunOptions( { Statistics: ( extra.Statistics === true ), Trace: ( extra.Trace === true ) } );
		return { Session: held.Lease(), Path: held.Path };
	}

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
		out.Log( error.message + '\n' );
		return { ExitCode: error.IsUsage ? 2 : 1 };
	}

	let read = Reader.ParseText( text );
	if ( typeof read.Document === 'undefined' || read.Document === null || typeof read.Document !== 'object' || Array.isArray( read.Document ) )
	{
		let findings = read.Findings.length > 0 ? read.Findings : Validate.ValidateFile( read.Document, {} );
		write_findings( out, resolved.Path, findings );
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
			Statistics: ( extra.Statistics === true ),
			Trace: ( extra.Trace === true ),
		} );
	}
	catch ( error )
	{
		if ( !( error instanceof Overrides.OverrideError ) ) { throw error; }
		out.Log( error.message + '\n' );
		return { ExitCode: 2 };
	}

	if ( refuse_errors( out, resolved.Path, read.Document, io, session.Catalog ) ) { return { ExitCode: 3 }; }

	return { Session: session, Path: resolved.Path };
}


//---------------------------------------------------------------------
// Validates the file; when it has errors, writes them and answers true.

function refuse_errors( Out, Path, Document, Io, Catalog )
{
	let findings = Validate.ValidateFile( Document, {
		jsongin: jsongin, jsonproc: jsonproc, Env: Io.Env, CheckSettings: Catalog.ValidateSettings,
	} );
	if ( Validate.Summarize( findings ).Errors === 0 ) { return false; }
	write_findings( Out, Path, findings.filter( function ( Finding ) { return Finding.Severity === 'error'; } ) );
	Out.Log( 'Nothing ran: the file has errors. Run jsonx validate for every finding.\n' );
	return true;
}


//---------------------------------------------------------------------
function write_findings( Out, Path, Findings )
{
	for ( let index = 0; index < Findings.length; index++ ) { Out.Finding( Findings[ index ] ); }
	Out.Log( Report.FormatSummary( Path, Validate.Summarize( Findings ) ) );
	return;
}


//---------------------------------------------------------------------
// Writes a run report and the result, releases the session, and answers the exit code.

async function FinishRun( RunReport, Session_, Parsed, Context )
{
	let out = Context.Out;
	let value = function ( Name ) { return Context.Parser.Value( Context.Tree, Parsed, Name ); };

	try
	{
		if ( !value( 'quiet' ) ) { out.Log( Report.FormatRunReport( RunReport, 0, { Statistics: value( 'verbose' ), Trace: value( 'trace' ) } ) ); }
		if ( RunReport.Ok ) { out.Result( RunReport.Result ); }
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
	RUN_OPTIONS: RUN_OPTIONS,
	RunExtras: RunExtras,
	OpenSession: OpenSession,
	FinishRun: FinishRun,
};
