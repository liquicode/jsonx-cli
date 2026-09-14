'use strict';

/*
	jsonx mcp [--stdio | --http] [--host <host>] [--port <port>] [--token <token>] [--bind ...] [--set ...]

	Holds the file and serves its commands as MCP tools (plan F4.3, modes/mcp/), speaking protocol
	revision 2025-11-25 (user, 2026-09-14).

	***Over stdio*** (the default) a client launches it: MCP messages go on standard output and
	nothing else does, and it ends when standard input ends. ***Over HTTP*** it listens on
	http://host:port/mcp until stopped, under the Web API's rule: a host other than loopback needs a
	token. Either way the file is watched and reloaded as it changes, and what a person reads - the
	address, the file's findings, each reload - goes to standard error.

	Exit codes: 0 ended; 1 the address cannot be bound, or the file cannot be read; 2 a usage mistake -
	both transports, no token for the host, no file chosen, a bad override; 3 the file is not a jsonx
	file.
*/

const jsonx_cli = require( '../src/jsonx-cli.js' );
const Held = require( '../src/Session/Held.js' );
const Validate = require( '../src/Validate/Validate.js' );
const Report = require( '../src/Report.js' );
const Api = require( '../modes/api/Api.js' );
const Protocol = require( '../modes/mcp/Protocol.js' );
const Stdio = require( '../modes/mcp/Stdio.js' );
const Http = require( '../modes/mcp/Http.js' );
const SessionCommand = require( './session.js' );


const DEFAULT_PORT = 3471;


//---------------------------------------------------------------------
async function handler( Parsed, Context )
{
	let io = Context.Io;
	let out = Context.Out;
	let value = function ( Name ) { return Context.Parser.Value( Context.Tree, Parsed, Name ); };

	if ( Parsed.Given.output === true )
	{
		out.Log( 'Option [--output] does not apply to jsonx mcp, which writes MCP messages.\n' );
		return 2;
	}
	if ( value( 'stdio' ) === true && value( 'http' ) === true )
	{
		out.Log( 'Choose one transport: --stdio or --http.\n' );
		return 2;
	}
	let over_http = ( value( 'http' ) === true );
	let host = value( 'host' );
	let token = value( 'token' ) || ( io.Env && io.Env.JSONX_TOKEN ) || null;

	if ( !over_http )
	{
		let ignored = [ 'host', 'port', 'token' ].filter( function ( Name ) { return Parsed.Given[ Name ] === true; } );
		if ( ignored.length > 0 )
		{
			out.Log( 'Option [--' + ignored[ 0 ] + '] has an effect only with --http.\n' );
			return 2;
		}
	}
	else if ( !Api.IsLoopback( host ) && !token )
	{
		out.Log( 'Serving on [' + host + '] needs a token: pass --token or set JSONX_TOKEN. Without one, bind to 127.0.0.1.\n' );
		return 2;
	}

	let held = null;
	try
	{
		held = Held.NewHeld( {
			Tree: Context.Tree, File: value( 'file' ), Binds: value( 'bind' ), Sets: value( 'set' ), Io: io,
			Log: function ( Text ) { out.Log( Text ); },
		} );
	}
	catch ( error )
	{
		if ( !( error instanceof Held.HeldError ) ) { throw error; }
		out.Log( error.message + '\n' );
		return error.ExitCode;
	}

	let summary = Validate.Summarize( held.StartFindings );
	if ( summary.Errors + summary.Warnings > 0 )
	{
		for ( let index = 0; index < held.StartFindings.length; index++ )
		{
			if ( held.StartFindings[ index ].Severity !== 'note' ) { out.Finding( held.StartFindings[ index ] ); }
		}
		out.Log( Report.FormatSummary( held.Path, summary ) );
		if ( summary.Errors > 0 ) { out.Log( 'The file has errors: it is served, and runs nothing until they are repaired.\n' ); }
	}

	held.Watch();

	if ( !over_http )
	{
		out.Log( 'MCP over stdio for ' + held.Path + ' (protocol ' + Protocol.PROTOCOL_VERSION + ').\n' );
		let mcp = Protocol.NewMcp( held, { Version: jsonx_cli.Version } );
		try
		{
			await Stdio.ServeStdio( mcp, io.Lines(), function ( Text ) { out.Stream( Text ); } );
		}
		finally
		{
			await held.Release();
		}
		return 0;
	}

	let server = null;
	try
	{
		let app = Http.NewMcpHttp( held, { Host: host, Token: token, Version: jsonx_cli.Version } );
		server = await Api.Listen( app, host, value( 'port' ) );
	}
	catch ( error )
	{
		await held.Release();
		out.Log( 'Cannot serve on ' + host + ':' + value( 'port' ) + ': ' + error.message + '\n' );
		return 1;
	}

	let shown_host = ( host.indexOf( ':' ) >= 0 ) ? '[' + host + ']' : host;
	out.Log( 'Serving MCP for ' + held.Path + ' at http://' + shown_host + ':' + server.address().port + Http.ENDPOINT + ' (protocol ' + Protocol.PROTOCOL_VERSION + ( token ? ', token required' : '' ) + '). Ctrl+C stops it.\n' );

	await io.WaitForStop();

	await Api.Close( server );
	await held.Release();
	out.Log( 'Stopped.\n' );
	return 0;
}


//---------------------------------------------------------------------
module.exports = {
	DEFAULT_PORT: DEFAULT_PORT,
	Command: 'mcp',
	Describe: 'Hold the file and serve its commands as MCP tools, over stdio or HTTP.',
	Served: false,
	ServedReason: 'it is how a file is served to an MCP client',
	Options: Object.assign( {
		'stdio': { Type: 'boolean', Describe: 'Speak MCP on standard input and output (the default).' },
		'http': { Type: 'boolean', Describe: 'Speak MCP over HTTP at /mcp.' },
		'host': { Type: 'string', Default: '127.0.0.1', Describe: 'With --http: the address to bind. Anything but loopback needs a token.' },
		'port': { Type: 'integer', Default: DEFAULT_PORT, Describe: 'With --http: the port to bind; 0 picks a free one.' },
		'token': { Type: 'string', Describe: 'With --http: the bearer token every request must carry. Absent: JSONX_TOKEN.' },
	}, SessionCommand.SESSION_OPTIONS ),
	Handler: handler,
};
