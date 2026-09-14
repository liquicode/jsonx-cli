'use strict';

/*
	The Web API mode (plan F4.2): one Express route per served command, answered by a held session.

		GET  /                    the served commands as data: { Version, File, Commands }
		POST /<group>/<command>   the command; the body is its --input-json document without Command

	***The body is the `--input-json` shape***, `{ "name": "Bookings", "criteria": { ... } }`, so a
	program writes the same document to the API as it would pass to `jsonx --input-json`, and a
	value is never read from a file or standard input on the server.

	***The status comes from the exit code***, never from the text of a message: 0 is 200, 1 is 500,
	2 is 400 and 3 is 422. The body is always the envelope, `{ Ok, ExitCode, Result, Findings, Log }`.
	What the API itself refuses - no token, a browser's cross-site request, no such route - answers
	an envelope too, with ExitCode 2.

	***Asked for `application/x-ndjson`***, a command whose result is an array answers one line per
	element, `{ Line: 'row', Row }`, then `{ Line: 'end', Ok, ExitCode, Findings, Log }`. This is
	framing only: jsonstor answers a whole array, so the rows exist before the first line is written.

	Who may call (O4):
	-	Bound to a loopback host (the default, 127.0.0.1), the API checks what a browser sends: a
		request whose Host header is not the bound address, or whose Origin is not that address, is
		refused with 403. Without this, a web page the person has open could reach the API, directly
		or by DNS rebinding.
	-	Bound to any other host, it needs a token, and NewApi throws without one.
	-	With a token, every request must carry `Authorization: Bearer <token>`, or it is refused with
		401. The comparison takes the same time whatever the token.
*/

const LIB_CRYPTO = require( 'crypto' );
const LIB_EXPRESS = require( 'express' );

const Held = require( '../../src/Session/Held.js' );


const LOOPBACK_HOSTS = [ '127.0.0.1', 'localhost', '::1' ];

const STATUS_FOR_EXIT = { 0: 200, 1: 500, 2: 400, 3: 422 };

const BODY_LIMIT = '16mb';

const NDJSON = 'application/x-ndjson';


//---------------------------------------------------------------------
class ApiError extends Error
{
	constructor( Message )
	{
		super( Message );
		this.name = 'ApiError';
	}
}


//---------------------------------------------------------------------
function IsLoopback( Host )
{
	return LOOPBACK_HOSTS.includes( String( Host ).toLowerCase() );
}


function StatusFor( ExitCode )
{
	return Object.prototype.hasOwnProperty.call( STATUS_FOR_EXIT, ExitCode ) ? STATUS_FOR_EXIT[ ExitCode ] : 500;
}


// An envelope for what the API refuses before any command runs.
function refusal( Message )
{
	return { Ok: false, ExitCode: 2, Findings: [], Log: [ Message ] };
}


//---------------------------------------------------------------------
// Whether two tokens are the same, taking the same time whether or not they are.

function same_token( Given, Expected )
{
	let given = LIB_CRYPTO.createHash( 'sha256' ).update( String( Given ) ).digest();
	let expected = LIB_CRYPTO.createHash( 'sha256' ).update( String( Expected ) ).digest();
	return LIB_CRYPTO.timingSafeEqual( given, expected );
}


//---------------------------------------------------------------------
// Options:
//		Host      the host it will be bound to; decides the checks (default 127.0.0.1)
//		Token     the bearer token every request must carry; required for a host which is not loopback
//		Version   reported by GET /
//
// The port is read from app.locals.Port, which Listen sets once the server is bound.

function NewApi( HeldSession, Options )
{
	let options = ( Options && typeof Options === 'object' ) ? Options : {};
	let host = options.Host || '127.0.0.1';
	let token = ( typeof options.Token === 'string' && options.Token !== '' ) ? options.Token : null;
	let loopback = IsLoopback( host );

	if ( !loopback && token === null )
	{
		throw new ApiError( 'Serving on [' + host + '] needs a token: pass --token or set JSONX_TOKEN. Without one, bind to 127.0.0.1.' );
	}

	let app = LIB_EXPRESS();
	app.disable( 'x-powered-by' );
	app.locals.Host = host;
	app.locals.Port = null;

	let commands = Held.ServedCommands( HeldSession.Tree );


	//---------------------------------------------------------------------
	// A browser's request to a loopback server: the Host it asked for, and the Origin it came from.

	app.use( function ( Request, Response, Next )
	{
		if ( !loopback ) { return Next(); }

		let port = app.locals.Port;
		let addresses = [ 'localhost', '127.0.0.1', '[::1]' ].map( function ( Name ) { return ( port === null ) ? Name : Name + ':' + port; } );

		let asked = String( Request.get( 'Host' ) || '' ).toLowerCase();
		if ( !addresses.includes( asked ) )
		{
			return Response.status( 403 ).json( refusal( 'Refused: the Host header [' + asked + '] is not this server\'s address.' ) );
		}

		let origin = Request.get( 'Origin' );
		if ( typeof origin === 'string' )
		{
			let allowed = addresses.map( function ( Address ) { return 'http://' + Address; } );
			if ( !allowed.includes( origin.toLowerCase() ) )
			{
				return Response.status( 403 ).json( refusal( 'Refused: a request from [' + origin + '] cannot reach this server.' ) );
			}
		}
		return Next();
	} );


	//---------------------------------------------------------------------
	// The token.

	app.use( function ( Request, Response, Next )
	{
		if ( token === null ) { return Next(); }
		let header = String( Request.get( 'Authorization' ) || '' );
		let match = /^Bearer\s+(.+)$/i.exec( header );
		if ( match === null || !same_token( match[ 1 ].trim(), token ) )
		{
			Response.set( 'WWW-Authenticate', 'Bearer' );
			return Response.status( 401 ).json( refusal( 'Refused: this server needs Authorization: Bearer <token>.' ) );
		}
		return Next();
	} );


	app.use( LIB_EXPRESS.json( { limit: BODY_LIMIT } ) );


	//---------------------------------------------------------------------
	app.get( '/', function ( Request, Response )
	{
		Response.status( 200 ).json( {
			Version: options.Version || null,
			File: HeldSession.Path,
			Commands: commands.map( function ( Command )
			{
				return {
					Command: Command.Command,
					Route: '/' + Command.Path.join( '/' ),
					Describe: Command.Describe,
					Positionals: Command.Positionals,
					Options: Command.Options,
				};
			} ),
		} );
		return;
	} );


	//---------------------------------------------------------------------
	// One route per served command.

	commands.forEach( function ( Command )
	{
		let route = '/' + Command.Path.map( encodeURIComponent ).join( '/' );

		app.post( route, function ( Request, Response )
		{
			let body = Request.body;
			if ( typeof body === 'undefined' || body === null ) { body = {}; }
			if ( typeof body !== 'object' || Array.isArray( body ) )
			{
				return Response.status( 400 ).json( refusal( 'The body must be a JSON object: the command\'s arguments and options by name.' ) );
			}
			if ( Object.prototype.hasOwnProperty.call( body, 'Command' ) )
			{
				return Response.status( 400 ).json( refusal( 'The body cannot name a Command: the route [' + route + '] names it.' ) );
			}

			let invocation = Object.assign( {}, body, { Command: Command.Path } );
			HeldSession.Invoke( invocation ).then( function ( Envelope )
			{
				let status = StatusFor( Envelope.ExitCode );
				if ( Array.isArray( Envelope.Result ) && String( Request.get( 'Accept' ) || '' ).includes( NDJSON ) )
				{
					Response.status( status );
					Response.set( 'Content-Type', NDJSON );
					Response.set( 'Cache-Control', 'no-cache' );
					for ( let index = 0; index < Envelope.Result.length; index++ )
					{
						Response.write( JSON.stringify( { Line: 'row', Row: Envelope.Result[ index ] } ) + '\n' );
					}
					Response.end( JSON.stringify( { Line: 'end', Ok: Envelope.Ok, ExitCode: Envelope.ExitCode, Findings: Envelope.Findings, Log: Envelope.Log } ) + '\n' );
					return;
				}
				Response.status( status ).json( Envelope );
				return;
			} ).catch( function ( error )
			{
				Response.status( 500 ).json( { Ok: false, ExitCode: 1, Findings: [], Log: [ 'The request failed unexpectedly: ' + error.message ] } );
				return;
			} );
			return;
		} );

		app.all( route, function ( Request, Response )
		{
			Response.set( 'Allow', 'POST' );
			Response.status( 405 ).json( refusal( 'Use POST for [' + route + '].' ) );
			return;
		} );
	} );


	//---------------------------------------------------------------------
	app.use( function ( Request, Response )
	{
		Response.status( 404 ).json( refusal( 'No command answers [' + Request.method + ' ' + Request.path + ']. GET / lists them.' ) );
		return;
	} );


	// A body which is not JSON, or is too large, still answers an envelope.
	app.use( function ( Error_, Request, Response, Next )
	{
		if ( Error_ && Error_.type === 'entity.parse.failed' )
		{
			return Response.status( 400 ).json( refusal( 'The body is not valid JSON: ' + Error_.message ) );
		}
		if ( Error_ && Error_.type === 'entity.too.large' )
		{
			return Response.status( 413 ).json( refusal( 'The body is larger than ' + BODY_LIMIT + '.' ) );
		}
		Response.status( 500 ).json( { Ok: false, ExitCode: 1, Findings: [], Log: [ 'The request failed unexpectedly: ' + ( Error_ && Error_.message ) ] } );
		return;
	} );


	return app;
}


//---------------------------------------------------------------------
// Binds an app. Resolves with the server once it listens, with app.locals.Port set to the port
// bound (so --port 0 works); rejects when the address cannot be bound.

function Listen( App, Host, Port )
{
	return new Promise( function ( Resolve, Reject )
	{
		let server = App.listen( Port, Host );
		server.once( 'error', Reject );
		server.once( 'listening', function ()
		{
			server.removeListener( 'error', Reject );
			App.locals.Port = server.address().port;
			Resolve( server );
		} );
	} );
}


//---------------------------------------------------------------------
// Closes a server, ending idle keep-alive connections so it does not wait for them.

function Close( Server )
{
	return new Promise( function ( Resolve )
	{
		Server.close( function () { Resolve(); } );
		if ( typeof Server.closeIdleConnections === 'function' ) { Server.closeIdleConnections(); }
	} );
}


//---------------------------------------------------------------------
module.exports = {
	LOOPBACK_HOSTS: LOOPBACK_HOSTS,
	STATUS_FOR_EXIT: STATUS_FOR_EXIT,
	NDJSON: NDJSON,
	ApiError: ApiError,
	IsLoopback: IsLoopback,
	StatusFor: StatusFor,
	NewApi: NewApi,
	Listen: Listen,
	Close: Close,
};
