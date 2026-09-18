'use strict';

/*
	The Web API mode (plan F4.2): one Express route per served command, answered by a held session.

		GET  /                    the served commands as data: { Version, File, Profile, Commands } - the
		                          profile in force (cut 7) and the commands it serves, with their defaults
		POST /<group>/<command>   the command; the body is its --input-json document without Command
		GET  /ws                  the WebSocket (modes/ws/Ws.js), behind the same guards

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
		-	***A request its browser marks `Sec-Fetch-Site: same-origin` (or `none`, an address typed) is
			not refused for its Origin***, only for its Host. Found 2026-09-15 in the user's Chrome: every
			stylesheet, script and fetch of the Web UI's own page arrived with `Origin: http://127.0.0.1`,
			the port dropped, beside `Sec-Fetch-Site: same-origin` - something in that browser adds the
			header; a stock Chrome sends no Origin on those at all. A page cannot set Sec-Fetch-Site, and
			one on another site or another port of 127.0.0.1 is marked cross-site or same-site, so its
			Origin is still compared. Its WebSocket upgrade carried the right Origin and no Sec-Fetch-Site.
	-	Bound to any other host, it needs a token, and NewApi throws without one.
	-	With a token, every request must carry `Authorization: Bearer <token>`, or it is refused with
		401. The comparison takes the same time whatever the token.

	***A browser's token*** (cut 5; cut 4's decision 4): a browser cannot set `Authorization` loading a
	page or opening a WebSocket. So:
	-	`POST /ws/ticket`, carrying the token like any request, answers `{ Ticket, ExpiresInMs }`: good for
		one upgrade within 30 s.
	-	`GET /ws?ticket=<ticket>` is accepted in place of `Authorization`, once. A used, expired or unknown
		ticket is the token's own 401, before any handshake.
	-	`GET /ui/config.json` answers `{ TokenRequired }` without a token, so a page knows to ask for one.
		A public path is exempt from the token only; the Host and Origin checks still run on it.
*/

const LIB_CRYPTO = require( 'crypto' );
const LIB_HTTP = require( 'http' );
const LIB_EXPRESS = require( 'express' );

const Held = require( '../../src/Session/Held.js' );
const Ws = require( '../ws/Ws.js' );
const Web = require( '../web/Web.js' );


const LOOPBACK_HOSTS = [ '127.0.0.1', 'localhost', '::1' ];

const STATUS_FOR_EXIT = { 0: 200, 1: 500, 2: 400, 3: 422 };

const BODY_LIMIT = '16mb';

const NDJSON = 'application/x-ndjson';

const TICKET_ROUTE = '/ws/ticket';
const TICKET_MS = 30000;
const CONFIG_ROUTE = '/ui/config.json';


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
// One-use tickets for a browser's WebSocket. Kept by their digest, so the store holds nothing a reader
// could present. Answers { Issue(), Take( Ticket ) }: Issue gives { Ticket, ExpiresInMs }; Take answers
// whether the ticket was good, and spends it.

function NewTickets( Options )
{
	let options = ( Options && typeof Options === 'object' ) ? Options : {};
	let lifetime = ( typeof options.LifetimeMs === 'number' ) ? options.LifetimeMs : TICKET_MS;
	let now = ( typeof options.Now === 'function' ) ? options.Now : Date.now;
	let issued = new Map();

	function digest( Ticket ) { return LIB_CRYPTO.createHash( 'sha256' ).update( String( Ticket ) ).digest( 'hex' ); }

	function prune()
	{
		let time = now();
		issued.forEach( function ( Expires, Key ) { if ( Expires <= time ) { issued.delete( Key ); } } );
		return;
	}

	return {
		Issue: function ()
		{
			prune();
			let ticket = LIB_CRYPTO.randomBytes( 32 ).toString( 'base64url' );
			issued.set( digest( ticket ), now() + lifetime );
			return { Ticket: ticket, ExpiresInMs: lifetime };
		},
		Take: function ( Ticket )
		{
			if ( typeof Ticket !== 'string' || Ticket === '' ) { return false; }
			let key = digest( Ticket );
			let expires = issued.get( key );
			issued.delete( key );
			return ( typeof expires === 'number' ) && ( expires > now() );
		},
	};
}


//---------------------------------------------------------------------
// Who may call, for any app a served mode builds (the Web API, MCP over HTTP):
//
//		Host      the host it will be bound to; decides the checks (default 127.0.0.1)
//		Token     the bearer token every request must carry; required for a host which is not loopback
//		Refuse    function ( Status, Message, Response ): how a refusal is answered; an envelope when absent
//		Tickets   a NewTickets store: `GET /ws?ticket=` is accepted in place of the token
//		Public    paths a GET reaches without the token, a trailing / for a folder (the Host and Origin
//		          checks still apply)
//
// Throws ApiError for a host which is not loopback and no token. The port is read from
// app.locals.Port, which Listen sets once the server is bound.

function UseGuards( App, Options )
{
	let options = ( Options && typeof Options === 'object' ) ? Options : {};
	let host = options.Host || '127.0.0.1';
	let token = ( typeof options.Token === 'string' && options.Token !== '' ) ? options.Token : null;
	let loopback = IsLoopback( host );
	let tickets = ( options.Tickets && typeof options.Tickets.Take === 'function' ) ? options.Tickets : null;
	let public_paths = Array.isArray( options.Public ) ? options.Public : [];
	// A path ending in / is a folder: everything under it is public, and nothing above it.
	let is_public = function ( Path )
	{
		return public_paths.some( function ( Each ) { return Each.endsWith( '/' ) ? Path.startsWith( Each ) : ( Path === Each ); } );
	};
	let refuse = ( typeof options.Refuse === 'function' )
		? options.Refuse
		: function ( Status, Message, Response ) { Response.status( Status ).json( refusal( Message ) ); return; };

	if ( !loopback && token === null )
	{
		throw new ApiError( 'Serving on [' + host + '] needs a token: pass --token or set JSONX_TOKEN. Without one, bind to 127.0.0.1.' );
	}

	App.locals.Host = host;
	App.locals.Port = null;


	//---------------------------------------------------------------------
	// A browser's request to a loopback server: the Host it asked for, and the Origin it came from.

	App.use( function ( Request, Response, Next )
	{
		if ( !loopback ) { return Next(); }

		let port = App.locals.Port;
		let addresses = [ 'localhost', '127.0.0.1', '[::1]' ].map( function ( Name ) { return ( port === null ) ? Name : Name + ':' + port; } );

		let asked = String( Request.get( 'Host' ) || '' ).toLowerCase();
		if ( !addresses.includes( asked ) )
		{
			return refuse( 403, 'Refused: the Host header [' + asked + '] is not this server\'s address.', Response );
		}

		// The browser's own word that the request comes from this origin, which no page can set.
		let fetch_site = String( Request.get( 'Sec-Fetch-Site' ) || '' ).toLowerCase();
		if ( fetch_site === 'same-origin' || fetch_site === 'none' ) { return Next(); }

		let origin = Request.get( 'Origin' );
		if ( typeof origin === 'string' )
		{
			let allowed = addresses.map( function ( Address ) { return 'http://' + Address; } );
			if ( !allowed.includes( origin.toLowerCase() ) )
			{
				return refuse( 403, 'Refused: a request from [' + origin + '] cannot reach this server.', Response );
			}
		}
		return Next();
	} );


	//---------------------------------------------------------------------
	// The token.

	App.use( function ( Request, Response, Next )
	{
		if ( token === null ) { return Next(); }
		if ( ( Request.method === 'GET' || Request.method === 'HEAD' ) && is_public( Request.path ) ) { return Next(); }
		let header = String( Request.get( 'Authorization' ) || '' );
		let match = /^Bearer\s+(.+)$/i.exec( header );
		if ( match === null && tickets !== null && Request.method === 'GET' && Request.path === Ws.ROUTE && typeof Request.query.ticket === 'string' )
		{
			if ( tickets.Take( Request.query.ticket ) ) { return Next(); }
			Response.set( 'WWW-Authenticate', 'Bearer' );
			return refuse( 401, 'Refused: the ticket is used, expired or unknown; ask ' + TICKET_ROUTE + ' for another.', Response );
		}
		if ( match === null || !same_token( match[ 1 ].trim(), token ) )
		{
			Response.set( 'WWW-Authenticate', 'Bearer' );
			return refuse( 401, 'Refused: this server needs Authorization: Bearer <token>.', Response );
		}
		return Next();
	} );

	return;
}


//---------------------------------------------------------------------
// Options: Host, Token (as UseGuards), Version, reported by GET /, and Ui: serve the Web UI's page under
// /ui/ (modes/web/Web.js), and send a browser's GET / there.

function NewApi( HeldSession, Options )
{
	let options = ( Options && typeof Options === 'object' ) ? Options : {};

	let app = LIB_EXPRESS();
	app.disable( 'x-powered-by' );
	let tickets = NewTickets( { LifetimeMs: options.TicketMs } );
	let public_paths = [ CONFIG_ROUTE ].concat( options.Ui === true ? [ Web.ROUTE ] : [] ).concat( Array.isArray( options.Public ) ? options.Public : [] );
	UseGuards( app, Object.assign( {}, options, { Tickets: tickets, Public: public_paths } ) );
	let token_required = ( typeof options.Token === 'string' && options.Token !== '' );

	let commands = Held.ServedCommands( HeldSession.Tree );

	// The served commands as a client reads them: GET / and the WebSocket's Hello answer this one list.
	// ***It is the profile's list*** (cut 7), read each time, since the profile can switch; every served
	// command keeps its route, and the held session refuses one outside the profile.
	function listed()
	{
		return HeldSession.Served().map( function ( Command )
		{
			return {
				Command: Command.Command,
				Route: '/' + Command.Path.join( '/' ),
				Describe: Command.Describe,
				Positionals: Command.Positionals,
				Options: Command.Options,
				Defaults: Command.Defaults,
				Confirm: Command.Confirm,
			};
		} );
	}

	app.use( LIB_EXPRESS.json( { limit: BODY_LIMIT } ) );


	//---------------------------------------------------------------------
	app.get( '/', function ( Request, Response )
	{
		if ( options.Ui === true && Web.WantsPage( Request ) ) { Response.redirect( 302, Web.ROUTE ); return; }
		Response.status( 200 ).json( {
			Version: options.Version || null,
			File: HeldSession.Path,
			Profile: HeldSession.ProfileSummary(),
			Commands: listed(),
		} );
		return;
	} );


	//---------------------------------------------------------------------
	// A browser's way in: whether a token is needed, and a one-use ticket for the WebSocket.

	app.get( CONFIG_ROUTE, function ( Request, Response )
	{
		Response.status( 200 ).json( { TokenRequired: token_required } );
		return;
	} );

	app.post( TICKET_ROUTE, function ( Request, Response )
	{
		Response.set( 'Cache-Control', 'no-store' );
		Response.status( 200 ).json( tickets.Issue() );
		return;
	} );

	if ( options.Ui === true ) { Web.AttachUi( app ); }


	//---------------------------------------------------------------------
	// The WebSocket, on top of the API (cut 4, decision 4): GET /ws, behind the guards above.

	app.locals.Ws = Ws.AttachWs( app, HeldSession, {
		Version: options.Version,
		Commands: listed,
		PingMs: options.PingMs,
		PongTimeoutMs: options.PongTimeoutMs,
		CloseWaitMs: options.CloseWaitMs,
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
//
// ***Every upgrade request is handed to the app***, with a response on its socket, so it meets the
// guards and the routes a POST meets (cut 4, decision 4). A route which takes the socket (GET /ws)
// detaches the response; one which answers - a refusal, a 404 - ends the socket once the answer is
// written, since an upgrade request's socket is never reused for HTTP.

const APPS = new WeakMap();

function Listen( App, Host, Port )
{
	return new Promise( function ( Resolve, Reject )
	{
		let server = LIB_HTTP.createServer( App );
		server.on( 'upgrade', function ( Request, Socket, Head )
		{
			if ( Head && Head.length > 0 ) { Socket.unshift( Head ); }
			let response = new LIB_HTTP.ServerResponse( Request );
			response.assignSocket( Socket );
			response.on( 'finish', function () { if ( !Socket.destroyed ) { Socket.end(); } } );
			App( Request, response );
		} );
		APPS.set( server, App );
		server.once( 'error', Reject );
		server.listen( Port, Host, function ()
		{
			server.removeListener( 'error', Reject );
			App.locals.Port = server.address().port;
			Resolve( server );
		} );
	} );
}


//---------------------------------------------------------------------
// Closes a server: every WebSocket first (1001), since the server's close does not end an upgraded
// socket (measured), then the server, ending idle keep-alive connections so it does not wait for them.

async function Close( Server )
{
	let app = APPS.get( Server );
	if ( app && app.locals.Ws ) { await app.locals.Ws.CloseAll(); }
	return await new Promise( function ( Resolve )
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
	TICKET_ROUTE: TICKET_ROUTE,
	TICKET_MS: TICKET_MS,
	CONFIG_ROUTE: CONFIG_ROUTE,
	ApiError: ApiError,
	IsLoopback: IsLoopback,
	StatusFor: StatusFor,
	NewTickets: NewTickets,
	UseGuards: UseGuards,
	NewApi: NewApi,
	Listen: Listen,
	Close: Close,
};
