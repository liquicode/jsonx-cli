'use strict';

/*
	The WebSocket (plan F4.2a): one connection to a file's jsonx process carrying commands, their
	answers, and what the process pushes, in both directions.

	***It runs on top of the Web API*** (cut 4, decision 4). `GET /ws` is a route of the API's own
	Express app, so an upgrade meets exactly what a POST meets - the Host and Origin checks, the token,
	a 404 for a path which is not a route - before any handshake is written. Api.Listen hands every
	upgrade request to the app (measured 2026-09-14: the middleware runs, and frames flow both ways
	afterwards; Node's own HTTP timeouts do not close an upgraded socket).

	Messages are JSON objects, one per text message.

	From the client:

		{ "Id": "1", "Invoke": { "Command": [ "datasource", "find" ], "name": "Bookings" } }
		{ "Id": "2", "Debug": { "process": "Prepare the season" } }    opens this connection's debug
		{ "Id": "3", "Step": "step" }                                  one debug command
		{ "Id": "4", "Read": "jsonx://file" }                          the held document, as MCP's resource

	From the server:

		{ "Hello": { Version, File, Document, Commands } }       first, once
		{ "Id": "1", "Event": "log", "Line": "..." }
		{ "Id": "1", "Event": "finding", "Finding": { ... } }
		{ "Id": "1", "Event": "report", "Phase", "Name", "Kind", "Depth", ... }
		{ "Id": "2", "Event": "debug", "Snapshot": { ... } }       each snapshot of a debug
		{ "Id": "1", "Answer": <the envelope> }                   always last for its Id
		{ "Event": "reload", "Outcome": { ... } }  { "Event": "document" }  { "Event": "queue", "HeldBy" }

	***A served debug*** (cut 4, decision 3) is `jsonx debug` itself, held as a conversation
	(Held.Converse):
	-	`Debug` opens it, with the options jsonx debug takes. Its snapshots arrive as `debug` events
		under the Debug's Id - the first when it starts - and ***the Debug's Answer comes when the debug
		ends***, the envelope jsonx debug answers: every snapshot as Result, the run report as Log.
	-	`Step` sends one command line; its Answer's Result is the snapshot that line produced.
	-	One debug per connection. ***Closing the connection ends it***, as the end of standard input
		ends jsonx debug.
	-	***While it is open, every queued request from any client waits***: `queue` events say so.

	-	***An Invoke is a Web API request with its route written in `Command`***: the same --input-json
		document, answered by the same Held.Invoke, so the answer is the envelope a POST would carry.
	-	***`Id` is the client's***: a non-empty string, echoed on everything its request causes, and not
		reused while that request runs.
	-	***Requests on one connection run as they arrive***; the held queue orders what must wait, as it
		does over HTTP.
	-	`Hello` carries the served commands exactly as `GET /` lists them, and the held document as
		written, so an environment reference is never resolved (F6.4). A `document` event says the
		document changed; a client asks again for what it needs.
	-	A message which is not JSON closes the connection with 1002. One which is JSON but not a request
		answers `{ Id, Answer }` with ExitCode 2 - Id is null when it named none.
*/

const Frames = require( './Frames.js' );
const Connection = require( './Connection.js' );


const ROUTE = '/ws';


//---------------------------------------------------------------------
function is_object( Value )
{
	return ( Value !== null ) && ( typeof Value === 'object' ) && !Array.isArray( Value );
}

function refusal( Message )
{
	return { Ok: false, ExitCode: 2, Findings: [], Log: [ Message ] };
}


//---------------------------------------------------------------------
// Adds GET /ws to an Express app answering a held session. Call it before the app's 404 handler.
//
// Options:
//		Version       reported in Hello
//		Commands      function (): the served commands as GET / lists them
//		PingMs, PongTimeoutMs, CloseWaitMs, MaxMessageBytes   passed to each connection
//
// Answers { Connections, CloseAll( Code, Reason ) }. CloseAll closes every connection and resolves
// when each has ended: an HTTP server's close does not end an upgraded socket (measured), so a mode
// stopping must call it first.

function AttachWs( App, Held, Options )
{
	let options = is_object( Options ) ? Options : {};
	let commands = ( typeof options.Commands === 'function' ) ? options.Commands : function () { return []; };

	let attached = {
		Connections: new Set(),
	};


	//---------------------------------------------------------------------
	App.get( ROUTE, function ( Request, Response )
	{
		let upgrade = String( Request.get( 'Upgrade' ) || '' ).toLowerCase();
		let connection_header = String( Request.get( 'Connection' ) || '' ).toLowerCase();
		if ( upgrade !== 'websocket' || !connection_header.split( /\s*,\s*/ ).includes( 'upgrade' ) )
		{
			return Response.status( 400 ).json( refusal( 'Refused: ' + ROUTE + ' is a WebSocket; connect with a WebSocket client.' ) );
		}
		if ( String( Request.get( 'Sec-WebSocket-Version' ) || '' ).trim() !== '13' )
		{
			Response.set( 'Sec-WebSocket-Version', '13' );
			return Response.status( 426 ).json( refusal( 'Refused: this server speaks WebSocket version 13.' ) );
		}
		let key = Request.get( 'Sec-WebSocket-Key' );
		if ( !Frames.IsValidKey( key ) )
		{
			return Response.status( 400 ).json( refusal( 'Refused: the Sec-WebSocket-Key is not 16 bytes in base64.' ) );
		}

		let socket = Request.socket;
		// Express has answered nothing: from here the socket is the WebSocket's.
		Response.detachSocket( socket );
		socket.write(
			'HTTP/1.1 101 Switching Protocols\r\n' +
			'Upgrade: websocket\r\n' +
			'Connection: Upgrade\r\n' +
			'Sec-WebSocket-Accept: ' + Frames.AcceptKey( key ) + '\r\n\r\n' );

		open_connection( socket );
		return;
	} );


	//---------------------------------------------------------------------
	function open_connection( Socket )
	{
		// The Ids of this connection's requests which have not been answered.
		let running = new Set();
		let stop_events = null;
		// This connection's debug, while one is open: { Id, Conversation }.
		let debugging = null;
		let closed = null;
		let is_closed = new Promise( function ( Resolve ) { closed = Resolve; } );

		let connection = Connection.NewConnection( Socket, {
			PingMs: options.PingMs,
			PongTimeoutMs: options.PongTimeoutMs,
			CloseWaitMs: options.CloseWaitMs,
			MaxMessageBytes: options.MaxMessageBytes,
			OnText: on_text,
			OnClose: function ()
			{
				if ( stop_events ) { stop_events(); stop_events = null; }
				if ( debugging ) { debugging.Conversation.End(); }
				attached.Connections.delete( connection );
				closed();
				return;
			},
		} );
		// Resolves when the connection has ended, however it ended.
		connection.Closed = is_closed;
		attached.Connections.add( connection );

		function send( Message )
		{
			return connection.SendText( JSON.stringify( Message ) );
		}

		send( {
			Hello: {
				Version: options.Version || null,
				File: Held.Path,
				Document: Held.Session.Document,
				Commands: commands(),
			},
		} );

		stop_events = Held.OnEvent( function ( Event ) { send( Event ); } );


		//---------------------------------------------------------------------
		function on_text( Text )
		{
			let message = null;
			try
			{
				message = JSON.parse( Text );
			}
			catch ( error )
			{
				connection.Close( Frames.CLOSE_CODES.ProtocolError, 'A message is not JSON.' );
				return;
			}

			let id = ( is_object( message ) && typeof message.Id === 'string' && message.Id !== '' ) ? message.Id : null;
			if ( !is_object( message ) )
			{
				send( { Id: null, Answer: refusal( 'A message must be a JSON object: { Id, Invoke }.' ) } );
				return;
			}
			if ( id === null )
			{
				send( { Id: null, Answer: refusal( 'A request needs an Id: a non-empty string, echoed on its answer and events.' ) } );
				return;
			}
			if ( running.has( id ) )
			{
				send( { Id: id, Answer: refusal( 'The Id [' + id + '] belongs to a request which has not been answered.' ) } );
				return;
			}
			if ( typeof message.Read !== 'undefined' ) { return on_read( id, message.Read ); }
			if ( typeof message.Step !== 'undefined' ) { return on_step( id, message.Step ); }
			if ( typeof message.Debug !== 'undefined' ) { return on_debug( id, message.Debug ); }
			if ( !is_object( message.Invoke ) )
			{
				send( { Id: id, Answer: refusal( 'A request names what it asks in Invoke: { Command, ...arguments and options }; a debug in Debug or Step.' ) } );
				return;
			}

			running.add( id );
			Held.Invoke( message.Invoke, function ( Progress )
			{
				if ( typeof Progress.Log === 'string' ) { send( { Id: id, Event: 'log', Line: Progress.Log } ); }
				else if ( Progress.Finding ) { send( { Id: id, Event: 'finding', Finding: Progress.Finding } ); }
				else if ( Progress.Report ) { send( Object.assign( { Id: id, Event: 'report' }, Progress.Report ) ); }
				return;
			} ).then( function ( Envelope )
			{
				running.delete( id );
				send( { Id: id, Answer: Envelope } );
				return;
			}, function ( error )
			{
				running.delete( id );
				send( { Id: id, Answer: { Ok: false, ExitCode: 1, Findings: [], Log: [ 'The request failed unexpectedly: ' + error.message ] } } );
				return;
			} );
			return;
		}


		//---------------------------------------------------------------------
		// The held document, or an entry of it, by the address MCP's resources use. Answered at once.

		function on_read( Id, Uri )
		{
			let read = Held.ReadResource( Uri );
			if ( !read.Found )
			{
				send( { Id: Id, Answer: refusal( 'Nothing is at [' + Uri + ']: Read takes jsonx://file, or jsonx://entry/<name> with the name URI-encoded.' ) } );
				return;
			}
			send( { Id: Id, Answer: { Ok: true, ExitCode: 0, Result: read.Value, Findings: [], Log: [] } } );
			return;
		}


		//---------------------------------------------------------------------
		// Opens this connection's debug: jsonx debug, conversed with.

		function on_debug( Id, Options_ )
		{
			if ( !is_object( Options_ ) )
			{
				send( { Id: Id, Answer: refusal( 'Debug takes jsonx debug\'s arguments and options: { "process": "<name>" }.' ) } );
				return;
			}
			if ( Object.prototype.hasOwnProperty.call( Options_, 'Command' ) )
			{
				send( { Id: Id, Answer: refusal( 'Debug cannot name a Command: it is jsonx debug.' ) } );
				return;
			}
			if ( debugging )
			{
				send( { Id: Id, Answer: refusal( 'This connection is already debugging, under the Id [' + debugging.Id + ']. Quit it first.' ) } );
				return;
			}

			running.add( Id );
			let conversation = Held.Converse( Object.assign( {}, Options_, { Command: 'debug' } ), function ( Progress )
			{
				if ( Progress.Line ) { send( { Id: Id, Event: 'debug', Snapshot: Progress.Line } ); }
				else if ( typeof Progress.Log === 'string' ) { send( { Id: Id, Event: 'log', Line: Progress.Log } ); }
				else if ( Progress.Finding ) { send( { Id: Id, Event: 'finding', Finding: Progress.Finding } ); }
				else if ( Progress.Report ) { send( Object.assign( { Id: Id, Event: 'report' }, Progress.Report ) ); }
				return;
			} );
			debugging = { Id: Id, Conversation: conversation };

			conversation.Done.then( function ( Envelope )
			{
				running.delete( Id );
				if ( debugging && debugging.Conversation === conversation ) { debugging = null; }
				send( { Id: Id, Answer: Envelope } );
				return;
			} );
			return;
		}


		//---------------------------------------------------------------------
		// One command line to this connection's debug. Answers the snapshot it produced.

		function on_step( Id, Line )
		{
			if ( typeof Line !== 'string' )
			{
				send( { Id: Id, Answer: refusal( 'Step takes one debug command as a string: step, into, continue, decline, answer <json>, state, skip, quit.' ) } );
				return;
			}
			if ( !debugging )
			{
				send( { Id: Id, Answer: refusal( 'Nothing is being debugged on this connection: open one with Debug.' ) } );
				return;
			}
			running.add( Id );
			debugging.Conversation.Send( Line ).then( function ( Sent )
			{
				running.delete( Id );
				if ( !Sent.Ok ) { send( { Id: Id, Answer: refusal( Sent.Message ) } ); return; }
				send( { Id: Id, Answer: { Ok: true, ExitCode: 0, Result: Sent.Record, Findings: [], Log: [] } } );
				return;
			} );
			return;
		}

		return connection;
	}


	//---------------------------------------------------------------------
	attached.CloseAll = function ( Code, Reason )
	{
		let waits = [];
		Array.from( attached.Connections ).forEach( function ( Each )
		{
			waits.push( Each.Closed );
			Each.Close( ( typeof Code === 'number' ) ? Code : Frames.CLOSE_CODES.GoingAway, Reason || 'The server is stopping.' );
		} );
		return Promise.all( waits );
	};


	return attached;
}


//---------------------------------------------------------------------
module.exports = {
	ROUTE: ROUTE,
	AttachWs: AttachWs,
};
