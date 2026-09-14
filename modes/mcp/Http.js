'use strict';

/*
	MCP over Streamable HTTP, as revision 2025-11-25 defines it: one endpoint, `/mcp`.

		POST /mcp     one JSON-RPC message. A request answers one JSON object; a notification or a
		              response answers 202 with no body.
		GET /mcp      405: this server opens no stream of its own, which the revision allows.
		DELETE /mcp   ends the session named by Mcp-Session-Id.

	***A session begins at initialize***: the reply carries an `Mcp-Session-Id`, every later request
	must carry it (400 without one), and a session which is unknown or ended answers 404, which tells
	a client to initialize again. Each session is one MCP connection (Protocol.NewMcp); all of them
	share the held session, so they share its data sources, its triggers and its queue.

	***An MCP-Protocol-Version header must name a supported revision***, or the request is refused
	with 400. A request without one is accepted, as the revision says.

	***Who may call is the Web API's rule***, by the same code (Api.UseGuards): a loopback bind
	refuses a foreign Host or Origin with 403, another host needs a token, and a token is checked on
	every request. A refusal here is a JSON-RPC error with no id, as the transport allows.
*/

const LIB_CRYPTO = require( 'crypto' );
const LIB_EXPRESS = require( 'express' );

const Api = require( '../api/Api.js' );
const Protocol = require( './Protocol.js' );


const ENDPOINT = '/mcp';
const SESSION_HEADER = 'Mcp-Session-Id';
const VERSION_HEADER = 'MCP-Protocol-Version';
const BODY_LIMIT = '16mb';


//---------------------------------------------------------------------
function error_body( Code, Message )
{
	return { jsonrpc: '2.0', id: null, error: { code: Code, message: Message } };
}


//---------------------------------------------------------------------
// Options: Host, Token (as Api.UseGuards), Version (serverInfo).

function NewMcpHttp( HeldSession, Options )
{
	let options = ( Options && typeof Options === 'object' ) ? Options : {};

	let app = LIB_EXPRESS();
	app.disable( 'x-powered-by' );
	Api.UseGuards( app, {
		Host: options.Host,
		Token: options.Token,
		Refuse: function ( Status, Message, Response )
		{
			Response.status( Status ).json( error_body( Protocol.ERRORS.INVALID_REQUEST, Message ) );
			return;
		},
	} );

	let sessions = new Map();
	app.locals.Sessions = sessions;


	app.use( ENDPOINT, LIB_EXPRESS.json( { limit: BODY_LIMIT, strict: false } ) );


	//---------------------------------------------------------------------
	app.post( ENDPOINT, function ( Request, Response )
	{
		let version = Request.get( VERSION_HEADER );
		if ( typeof version === 'string' && !Protocol.SUPPORTED_VERSIONS.includes( version ) )
		{
			return Response.status( 400 ).json( error_body( Protocol.ERRORS.INVALID_REQUEST, 'Unsupported ' + VERSION_HEADER + ' [' + version + ']; supported: ' + Protocol.SUPPORTED_VERSIONS.join( ', ' ) + '.' ) );
		}

		let message = Request.body;
		if ( !Request.is( 'application/json' ) || typeof message === 'undefined' )
		{
			return Response.status( 400 ).json( error_body( Protocol.ERRORS.INVALID_REQUEST, 'The body must be one JSON-RPC message, sent as application/json.' ) );
		}
		if ( Array.isArray( message ) )
		{
			return Response.status( 400 ).json( error_body( Protocol.ERRORS.INVALID_REQUEST, 'Invalid Request: a batch of messages is not accepted; send one message at a time.' ) );
		}

		let initializing = ( message !== null && typeof message === 'object' && message.method === 'initialize' );
		let session_id = Request.get( SESSION_HEADER );
		let mcp = null;

		if ( initializing )
		{
			session_id = LIB_CRYPTO.randomUUID();
			mcp = Protocol.NewMcp( HeldSession, { Version: options.Version } );
		}
		else if ( typeof session_id !== 'string' || session_id === '' )
		{
			return Response.status( 400 ).json( error_body( Protocol.ERRORS.INVALID_REQUEST, 'Bad Request: ' + SESSION_HEADER + ' is required; send initialize first.' ) );
		}
		else if ( !sessions.has( session_id ) )
		{
			return Response.status( 404 ).json( error_body( Protocol.ERRORS.INVALID_REQUEST, 'Session not found: initialize again.' ) );
		}
		else
		{
			mcp = sessions.get( session_id );
		}

		mcp.Handle( message ).then( function ( Reply )
		{
			if ( initializing && Reply && Reply.result )
			{
				sessions.set( session_id, mcp );
				Response.set( SESSION_HEADER, session_id );
			}
			if ( Reply === null ) { Response.status( 202 ).end(); return; }
			Response.status( 200 ).json( Reply );
			return;
		}, function ( error )
		{
			Response.status( 500 ).json( error_body( Protocol.ERRORS.INTERNAL_ERROR, 'Internal error: ' + error.message ) );
			return;
		} );
		return;
	} );


	//---------------------------------------------------------------------
	app.get( ENDPOINT, function ( Request, Response )
	{
		Response.set( 'Allow', 'POST, DELETE' );
		Response.status( 405 ).json( error_body( Protocol.ERRORS.INVALID_REQUEST, 'This server opens no stream: send each message as a POST.' ) );
		return;
	} );


	app.delete( ENDPOINT, function ( Request, Response )
	{
		let session_id = Request.get( SESSION_HEADER );
		if ( typeof session_id !== 'string' || !sessions.has( session_id ) )
		{
			return Response.status( 404 ).json( error_body( Protocol.ERRORS.INVALID_REQUEST, 'Session not found.' ) );
		}
		sessions.delete( session_id );
		Response.status( 204 ).end();
		return;
	} );


	app.all( ENDPOINT, function ( Request, Response )
	{
		Response.set( 'Allow', 'POST, DELETE' );
		Response.status( 405 ).json( error_body( Protocol.ERRORS.INVALID_REQUEST, 'Use POST for ' + ENDPOINT + '.' ) );
		return;
	} );


	app.use( function ( Request, Response )
	{
		Response.status( 404 ).json( error_body( Protocol.ERRORS.INVALID_REQUEST, 'The MCP endpoint is ' + ENDPOINT + '.' ) );
		return;
	} );


	// A body which is not JSON is a JSON-RPC parse error.
	app.use( function ( Error_, Request, Response, Next )
	{
		if ( Error_ && Error_.type === 'entity.parse.failed' )
		{
			return Response.status( 400 ).json( Protocol.ParseError( Error_.message ) );
		}
		if ( Error_ && Error_.type === 'entity.too.large' )
		{
			return Response.status( 413 ).json( error_body( Protocol.ERRORS.INVALID_REQUEST, 'The body is larger than ' + BODY_LIMIT + '.' ) );
		}
		Response.status( 500 ).json( error_body( Protocol.ERRORS.INTERNAL_ERROR, 'Internal error: ' + ( Error_ && Error_.message ) ) );
		return;
	} );


	return app;
}


//---------------------------------------------------------------------
module.exports = {
	ENDPOINT: ENDPOINT,
	SESSION_HEADER: SESSION_HEADER,
	VERSION_HEADER: VERSION_HEADER,
	NewMcpHttp: NewMcpHttp,
};
