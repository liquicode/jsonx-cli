'use strict';

/*
	jsonx tui [--file <path>] [--bind ...] [--set ...]
	jsonx tui --url <ws://host:port/ws> [--token <token>]

	The terminal interface (plan F4.4, F5): four panes over a file's jsonx process, talking to it only
	through its WebSocket (decision 11).

	***Where the process comes from*** (cut 4, decision 2):
	-	With no --url, it starts one - `jsonx serve --api --attached --port 0` on the file - reads its ready
		line, connects, and stops it on the way out (modes/tui/Launch.js).
	-	With --url, it attaches to one already serving, and leaves it running on the way out. A process of
		another version is refused, because the commands typed here are parsed with this version's table.

	Exit codes: 0 quit; 1 the process could not start, or the connection could not be made; 2 a usage
	mistake, or a process of another version; 3 the file is not a jsonx file (the child's own exit).
*/

const jsonx_cli = require( '../src/jsonx-cli.js' );
const Client = require( '../modes/tui/Client.js' );
const Launch = require( '../modes/tui/Launch.js' );
const Model = require( '../modes/tui/Model.js' );
const SessionCommand = require( './session.js' );


//---------------------------------------------------------------------
async function handler( Parsed, Context )
{
	let io = Context.Io;
	let out = Context.Out;
	let value = function ( Name ) { return Context.Parser.Value( Context.Tree, Parsed, Name ); };

	if ( Parsed.Given.output === true )
	{
		out.Log( 'Option [--output] does not apply to jsonx tui, which writes no result.\n' );
		return 2;
	}

	let url = value( 'url' );
	if ( typeof url === 'string' )
	{
		let beside = [ 'file', 'bind', 'set', 'report-paths' ].filter( function ( Name ) { return Parsed.Given[ Name ] === true; } );
		if ( beside.length > 0 )
		{
			out.Log( 'Option [--' + beside[ 0 ] + '] has no effect with --url: the process there already holds its file.\n' );
			return 2;
		}
	}
	else if ( Parsed.Given.token === true )
	{
		out.Log( 'Option [--token] has an effect only with --url: a process this starts binds to 127.0.0.1 and needs none.\n' );
		return 2;
	}

	let launched = null;
	if ( typeof url !== 'string' )
	{
		try
		{
			launched = await Launch.Start( { File: value( 'file' ), Binds: value( 'bind' ), Sets: value( 'set' ), ReportPaths: value( 'report-paths' ), Env: io.Env, Cwd: io.Cwd } );
		}
		catch ( error )
		{
			if ( !( error instanceof Launch.LaunchError ) ) { throw error; }
			if ( error.Stderr ) { out.Log( error.Stderr.endsWith( '\n' ) ? error.Stderr : error.Stderr + '\n' ); }
			out.Log( error.message + '\n' );
			return error.ExitCode;
		}
		url = launched.Ready.Ws;
	}

	let client = Client.NewClient( { Url: url, Token: value( 'token' ) || ( io.Env && io.Env.JSONX_TOKEN ) || undefined } );
	let model = Model.NewModel( { Client: client, Url: url, Tree: Context.Tree, Version: jsonx_cli.Version, Io: io, SettingsPath: Context.SettingsPath } );

	let code = 0;
	try
	{
		await model.Start();
		let screen = Context.Screen || require( '../modes/tui/Screen.js' );
		code = await screen.Run( model, { Io: io } );
	}
	catch ( error )
	{
		if ( error instanceof Model.ModelError ) { out.Log( error.message + '\n' ); code = error.ExitCode; }
		else if ( error instanceof Client.ClientError ) { out.Log( error.message + '\n' ); code = 1; }
		else { throw error; }
	}
	finally
	{
		client.Close();
		if ( launched !== null ) { await launched.Stop(); }
	}
	return code;
}


//---------------------------------------------------------------------
module.exports = {
	Command: 'tui',
	Describe: 'Open the file in a terminal interface: inventory, input, log and data rows.',
	Served: false,
	ServedReason: 'it is a front end of its own, which talks to a served file',
	Options: Object.assign( {
		'url': { Type: 'string', Describe: 'Attach to a jsonx process already serving, at ws://host:port/ws, instead of starting one.' },
		'token': { Type: 'string', Describe: 'The bearer token the process at --url needs. Absent: JSONX_TOKEN.' },
	}, SessionCommand.SESSION_OPTIONS ),
	Handler: handler,
};
