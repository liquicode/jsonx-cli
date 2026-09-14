'use strict';

/*
	The TUI's connection to a file's jsonx process: its WebSocket (modes/ws/Ws.js), through ***Node's
	built-in WebSocket client*** (cut 4, decision 1), so the TUI needs no dependency to talk.

	Every request gets an Id of its own, and everything the server sends under that Id - events, then
	the answer - reaches that request's caller. What the server sends under no Id (`reload`, `document`,
	`queue`) reaches every OnEvent listener.

	***Node's client sends `Authorization` when given headers*** (measured 2026-09-14), which is how a
	token reaches a process on another host.
*/


//---------------------------------------------------------------------
class ClientError extends Error
{
	constructor( Message )
	{
		super( Message );
		this.name = 'ClientError';
	}
}


//---------------------------------------------------------------------
// Options:
//		Url           ws://host:port/ws
//		Token         a bearer token, when the process needs one
//		WebSocket     the client constructor; the global one when absent
//		ConnectMs     how long Connect waits for Hello (default 10 s)

function NewClient( Options )
{
	let options = ( Options && typeof Options === 'object' ) ? Options : {};
	let WebSocketClass = options.WebSocket || globalThis.WebSocket;
	if ( typeof WebSocketClass !== 'function' ) { throw new ClientError( 'This Node has no WebSocket client; jsonx tui needs Node 22 or later.' ); }
	let connect_ms = ( typeof options.ConnectMs === 'number' ) ? options.ConnectMs : 10000;

	let socket = null;
	let next_id = 1;
	// Id -> { OnEvent, Resolve }
	let waiting = new Map();
	let event_listeners = [];
	let close_listeners = [];

	let client = {
		Hello: null,
		Open: false,
		CloseCode: null,
	};


	//---------------------------------------------------------------------
	function tell( Listeners, Value )
	{
		for ( let listener of Listeners.slice() )
		{
			try { listener( Value ); }
			catch ( error ) { /* a listener is told, never asked */ }
		}
		return;
	}

	function on_message( Text )
	{
		let message = null;
		try { message = JSON.parse( Text ); }
		catch ( error ) { return; }
		if ( !message || typeof message !== 'object' ) { return; }

		if ( message.Hello ) { return; }
		if ( typeof message.Id !== 'string' )
		{
			if ( typeof message.Event === 'string' ) { tell( event_listeners, message ); }
			return;
		}
		let entry = waiting.get( message.Id );
		if ( !entry ) { return; }
		if ( message.Answer )
		{
			waiting.delete( message.Id );
			entry.Resolve( message.Answer );
			return;
		}
		if ( typeof entry.OnEvent === 'function' )
		{
			try { entry.OnEvent( message ); }
			catch ( error ) { /* told, never asked */ }
		}
		return;
	}


	//---------------------------------------------------------------------
	// Opens the connection. Resolves with Hello; rejects when it cannot connect or no Hello arrives.

	client.Connect = function ()
	{
		return new Promise( function ( Resolve, Reject )
		{
			let settled = false;
			let headers = options.Token ? { Authorization: 'Bearer ' + options.Token } : undefined;
			try
			{
				socket = new WebSocketClass( options.Url, headers ? { headers: headers } : undefined );
			}
			catch ( error )
			{
				Reject( new ClientError( 'Cannot connect to ' + options.Url + ': ' + error.message ) );
				return;
			}

			let timer = setTimeout( function ()
			{
				if ( settled ) { return; }
				settled = true;
				try { socket.close(); } catch ( error ) { /* closing what did not open */ }
				Reject( new ClientError( 'No answer from ' + options.Url + ' within ' + connect_ms + ' ms.' ) );
			}, connect_ms );

			socket.onmessage = function ( Event )
			{
				let text = String( Event.data );
				if ( !settled )
				{
					let first = null;
					try { first = JSON.parse( text ); } catch ( error ) { first = null; }
					if ( first && first.Hello )
					{
						settled = true;
						clearTimeout( timer );
						client.Hello = first.Hello;
						client.Open = true;
						Resolve( first.Hello );
					}
					return;
				}
				on_message( text );
				return;
			};

			socket.onerror = function ()
			{
				if ( settled ) { return; }
				settled = true;
				clearTimeout( timer );
				Reject( new ClientError( 'Cannot connect to ' + options.Url + ': it refused, or nothing is listening there.' ) );
			};

			socket.onclose = function ( Event )
			{
				client.Open = false;
				client.CloseCode = Event.code;
				// Nothing outstanding will be answered now.
				for ( let [ id, entry ] of waiting )
				{
					entry.Resolve( { Ok: false, ExitCode: 1, Findings: [], Log: [ 'The connection closed before [' + id + '] was answered.' ] } );
				}
				waiting.clear();
				if ( !settled )
				{
					settled = true;
					clearTimeout( timer );
					Reject( new ClientError( 'The connection to ' + options.Url + ' closed before it said hello (' + Event.code + ').' ) );
				}
				tell( close_listeners, { Code: Event.code, Reason: Event.reason } );
				return;
			};
		} );
	};


	//---------------------------------------------------------------------
	function send( Body, OnEvent )
	{
		if ( !client.Open ) { return Promise.resolve( { Ok: false, ExitCode: 1, Findings: [], Log: [ 'Not connected.' ] } ); }
		let id = String( next_id++ );
		return new Promise( function ( Resolve )
		{
			waiting.set( id, { OnEvent: OnEvent, Resolve: Resolve } );
			socket.send( JSON.stringify( Object.assign( { Id: id }, Body ) ) );
		} );
	}

	// A command, as an --input-json document. OnEvent hears its log, finding and report events.
	client.Invoke = function ( Invocation, OnEvent ) { return send( { Invoke: Invocation }, OnEvent ); };

	// The held document (jsonx://file) or an entry of it.
	client.Read = function ( Uri ) { return send( { Read: Uri } ); };

	// Opens this connection's debug. OnEvent hears its debug, log and report events; resolves when it ends.
	client.Debug = function ( DebugOptions, OnEvent ) { return send( { Debug: DebugOptions }, OnEvent ); };

	// One command line to the open debug; resolves with an answer whose Result is the snapshot.
	client.Step = function ( Line ) { return send( { Step: Line } ); };

	client.OnEvent = function ( Listener )
	{
		event_listeners.push( Listener );
		return function () { event_listeners = event_listeners.filter( function ( Each ) { return Each !== Listener; } ); };
	};

	client.OnClose = function ( Listener )
	{
		close_listeners.push( Listener );
		return function () { close_listeners = close_listeners.filter( function ( Each ) { return Each !== Listener; } ); };
	};

	client.Close = function ()
	{
		if ( socket && client.Open ) { socket.close( 1000 ); }
		return;
	};

	return client;
}


//---------------------------------------------------------------------
module.exports = {
	ClientError: ClientError,
	NewClient: NewClient,
};
