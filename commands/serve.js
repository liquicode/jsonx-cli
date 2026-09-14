'use strict';

/*
	jsonx serve --api [--host <host>] [--port <port>] [--token <token>] [--bind ...] [--set ...]

	Holds the file and serves its commands over HTTP (plan F4.2, modes/api/Api.js) until it is
	stopped (Ctrl+C). What it says for a person goes to standard error: the address, the file's
	findings when it is held, and that it stopped.

	***Once it listens, it writes one JSON line to standard output***, `{ File, Url, Pid }`, for a
	program which starts it (the TUI, the desktop) to read instead of the prose. It is written as one
	line whatever the result would be formatted as, because the reader reads a line.

	***`--attached` also stops it when standard input ends***, so the program which started it cannot
	leave it running by going away: on Windows a killed parent does not take its children with it.

	***`--api` is required***, so adding the Web UI later (`--ui`) changes what no existing command
	line does. ***A host other than loopback needs a token***, from --token or JSONX_TOKEN, and is
	refused before anything listens. ***A file with errors is served***, so it can be repaired through
	the API; every run answers 422 until it is. ***The file is watched***: an edit made to it while it
	is served is reloaded, and reported, between requests (src/Session/Held.js).

	Exit codes: 0 stopped; 1 the address cannot be bound, or the file cannot be read; 2 a usage
	mistake - no --api, no token for the host, no file chosen, a bad override; 3 the file is not a
	jsonx file.
*/

const jsonx_cli = require( '../src/jsonx-cli.js' );
const Held = require( '../src/Session/Held.js' );
const Validate = require( '../src/Validate/Validate.js' );
const Report = require( '../src/Report.js' );
const Api = require( '../modes/api/Api.js' );
const SessionCommand = require( './session.js' );


const DEFAULT_PORT = 3470;


//---------------------------------------------------------------------
async function handler( Parsed, Context )
{
	let io = Context.Io;
	let out = Context.Out;
	let value = function ( Name ) { return Context.Parser.Value( Context.Tree, Parsed, Name ); };

	if ( Parsed.Given.output === true )
	{
		out.Log( 'Option [--output] does not apply to jsonx serve, which writes no result.\n' );
		return 2;
	}
	if ( value( 'api' ) !== true )
	{
		out.Log( 'Name what to serve: --api. The Web UI (--ui) arrives in a later release.\n' );
		return 2;
	}

	let host = value( 'host' );
	let token = value( 'token' ) || ( io.Env && io.Env.JSONX_TOKEN ) || null;
	if ( !Api.IsLoopback( host ) && !token )
	{
		out.Log( 'Serving on [' + host + '] needs a token: pass --token or set JSONX_TOKEN. Without one, bind to 127.0.0.1.\n' );
		return 2;
	}

	let held = null;
	try
	{
		held = Held.NewHeld( {
			Tree: Context.Tree, File: value( 'file' ), Binds: value( 'bind' ), Sets: value( 'set' ), Io: io,
			// A reload, and what it found, is reported as it happens (plan F2.5).
			Log: function ( Text ) { out.Log( Text ); },
		} );
	}
	catch ( error )
	{
		if ( !( error instanceof Held.HeldError ) ) { throw error; }
		out.Log( error.message + '\n' );
		return error.ExitCode;
	}

	let findings = held.StartFindings;
	let summary = Validate.Summarize( findings );
	if ( summary.Errors + summary.Warnings > 0 )
	{
		for ( let index = 0; index < findings.length; index++ )
		{
			if ( findings[ index ].Severity !== 'note' ) { out.Finding( findings[ index ] ); }
		}
		out.Log( Report.FormatSummary( held.Path, summary ) );
		if ( summary.Errors > 0 ) { out.Log( 'The file has errors: it is served, and runs nothing until they are repaired.\n' ); }
	}

	let server = null;
	try
	{
		let app = Api.NewApi( held, { Host: host, Token: token, Version: jsonx_cli.Version } );
		server = await Api.Listen( app, host, value( 'port' ) );
	}
	catch ( error )
	{
		await held.Release();
		out.Log( 'Cannot serve on ' + host + ':' + value( 'port' ) + ': ' + error.message + '\n' );
		return 1;
	}

	let shown_host = ( host.indexOf( ':' ) >= 0 ) ? '[' + host + ']' : host;
	let url = 'http://' + shown_host + ':' + server.address().port;
	held.Watch();
	out.Line( { File: held.Path, Url: url, Pid: process.pid } );
	out.Log( 'Serving ' + held.Path + ' at ' + url + ( token ? ' (token required)' : '' ) + '. ' + ( value( 'attached' ) ? 'The end of standard input, or Ctrl+C, stops it.' : 'Ctrl+C stops it.' ) + '\n' );

	let stops = [ io.WaitForStop() ];
	if ( value( 'attached' ) && typeof io.WaitForStdinEnd === 'function' ) { stops.push( io.WaitForStdinEnd() ); }
	await Promise.race( stops );

	await Api.Close( server );
	await held.Release();
	out.Log( 'Stopped.\n' );
	return 0;
}


//---------------------------------------------------------------------
module.exports = {
	DEFAULT_PORT: DEFAULT_PORT,
	Command: 'serve',
	Describe: 'Hold the file and serve its commands over HTTP until stopped.',
	Served: false,
	ServedReason: 'it is how a file is served',
	Options: Object.assign( {
		'api': { Type: 'boolean', Describe: 'Serve the Web API: one POST route per command.' },
		'host': { Type: 'string', Default: '127.0.0.1', Describe: 'The address to bind. Anything but loopback needs a token.' },
		'port': { Type: 'integer', Default: DEFAULT_PORT, Describe: 'The port to bind; 0 picks a free one.' },
		'token': { Type: 'string', Describe: 'The bearer token every request must carry. Absent: JSONX_TOKEN.' },
		'attached': { Type: 'boolean', Describe: 'Stop when standard input ends, for a program which starts jsonx serve.' },
	}, SessionCommand.SESSION_OPTIONS ),
	Handler: handler,
};
