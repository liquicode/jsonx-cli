'use strict';

/*
	One WebSocket connection over an upgraded socket: frames in, text out, pings, and closing.

	***It knows nothing about jsonx.*** A text message is handed to OnText; what it means is Ws.js's.

	Closing (RFC 6455 7.1):
	-	***A close from the peer is answered with the peer's own code*** and the socket ended. An empty
		close answer reads as 1005 at the peer (measured 2026-09-14), so the code is always echoed.
	-	A close this side starts waits for the peer's answer, then ends the socket; a peer which does
		not answer within CloseWaitMs is cut off.
	-	A protocol mistake closes with the FrameError's code.

	***Keep-alive***: a ping every PingMs; a connection which has answered nothing - no pong, no message
	- for PongTimeoutMs is cut off, so a client which vanished without closing does not hold what it
	asked for (a served debug, in step 3) for ever.
*/

const Frames = require( './Frames.js' );


const DEFAULT_PING_MS = 30000;
const DEFAULT_PONG_TIMEOUT_MS = 60000;
const DEFAULT_CLOSE_WAIT_MS = 1000;


//---------------------------------------------------------------------
// Options:
//		OnText( Text )           a whole text message
//		OnClose( Code, Reason )  once, when the connection has ended, however it ended
//		PingMs, PongTimeoutMs, CloseWaitMs, MaxMessageBytes

function NewConnection( Socket, Options )
{
	let options = ( Options && typeof Options === 'object' ) ? Options : {};
	let on_text = ( typeof options.OnText === 'function' ) ? options.OnText : function () { return; };
	let on_close = ( typeof options.OnClose === 'function' ) ? options.OnClose : function () { return; };
	let ping_ms = ( typeof options.PingMs === 'number' ) ? options.PingMs : DEFAULT_PING_MS;
	let pong_timeout_ms = ( typeof options.PongTimeoutMs === 'number' ) ? options.PongTimeoutMs : DEFAULT_PONG_TIMEOUT_MS;
	let close_wait_ms = ( typeof options.CloseWaitMs === 'number' ) ? options.CloseWaitMs : DEFAULT_CLOSE_WAIT_MS;

	let decoder = Frames.NewDecoder( { MaxMessageBytes: options.MaxMessageBytes } );

	let connection = {
		// 'open', 'closing' (this side sent a close), or 'closed'.
		State: 'open',
		CloseCode: null,
		CloseReason: '',
	};

	let heard_at = Date.now();
	let ping_timer = null;
	let close_timer = null;


	//---------------------------------------------------------------------
	function write( Buffer_ )
	{
		if ( Socket.destroyed || !Socket.writable ) { return false; }
		Socket.write( Buffer_ );
		return true;
	}

	function ended( Code, Reason )
	{
		if ( connection.State === 'closed' ) { return; }
		connection.State = 'closed';
		if ( connection.CloseCode === null ) { connection.CloseCode = Code; connection.CloseReason = Reason || ''; }
		if ( ping_timer !== null ) { clearInterval( ping_timer ); ping_timer = null; }
		if ( close_timer !== null ) { clearTimeout( close_timer ); close_timer = null; }
		if ( !Socket.destroyed ) { Socket.destroy(); }
		on_close( connection.CloseCode, connection.CloseReason );
		return;
	}


	//---------------------------------------------------------------------
	// Sends one text message. Answers false when the connection can no longer send.

	connection.SendText = function ( Text )
	{
		if ( connection.State !== 'open' ) { return false; }
		return write( Frames.EncodeText( Text ) );
	};


	//---------------------------------------------------------------------
	// Starts closing: sends the close, and ends the socket when the peer answers or CloseWaitMs passes.

	connection.Close = function ( Code, Reason )
	{
		if ( connection.State !== 'open' ) { return; }
		connection.State = 'closing';
		connection.CloseCode = ( typeof Code === 'number' ) ? Code : Frames.CLOSE_CODES.Normal;
		connection.CloseReason = Reason || '';
		write( Frames.EncodeClose( connection.CloseCode, connection.CloseReason ) );
		close_timer = setTimeout( function () { ended( connection.CloseCode, connection.CloseReason ); }, close_wait_ms );
		return;
	};


	//---------------------------------------------------------------------
	// Ends at once, without the closing handshake: for a peer which stopped answering.

	connection.Terminate = function ( Code, Reason )
	{
		ended( ( typeof Code === 'number' ) ? Code : Frames.CLOSE_CODES.GoingAway, Reason );
		return;
	};


	//---------------------------------------------------------------------
	Socket.setNoDelay( true );

	Socket.on( 'data', function ( Chunk )
	{
		if ( connection.State === 'closed' ) { return; }
		heard_at = Date.now();

		let messages = null;
		try
		{
			messages = decoder.Push( Chunk );
		}
		catch ( error )
		{
			if ( !( error instanceof Frames.FrameError ) ) { throw error; }
			if ( connection.State === 'open' )
			{
				connection.State = 'closing';
				connection.CloseCode = error.Code;
				connection.CloseReason = error.message;
				write( Frames.EncodeClose( error.Code, error.message ) );
			}
			if ( !Socket.destroyed ) { Socket.end(); }
			ended( error.Code, error.message );
			return;
		}

		for ( let index = 0; index < messages.length; index++ )
		{
			let message = messages[ index ];
			if ( message.Type === 'close' )
			{
				if ( connection.State === 'open' )
				{
					// Echo the peer's code; 1005 is never sent on the wire, so an empty close is answered empty.
					let code = ( message.Code === Frames.CLOSE_CODES.NoStatus ) ? undefined : message.Code;
					write( Frames.EncodeClose( code ) );
					connection.CloseCode = message.Code;
					connection.CloseReason = message.Reason;
				}
				if ( !Socket.destroyed ) { Socket.end(); }
				ended( message.Code, message.Reason );
				return;
			}
			if ( message.Type === 'ping' ) { write( Frames.Encode( Frames.OPCODES.pong, message.Data ) ); continue; }
			if ( message.Type === 'pong' ) { continue; }
			if ( connection.State !== 'open' ) { continue; }
			if ( message.Type === 'binary' )
			{
				connection.Close( Frames.CLOSE_CODES.Unsupported, 'Only text messages are accepted.' );
				return;
			}
			on_text( message.Text );
		}
		return;
	} );

	Socket.on( 'end', function () { ended( Frames.CLOSE_CODES.NoStatus, 'The connection ended without a close.' ); } );
	Socket.on( 'close', function () { ended( Frames.CLOSE_CODES.NoStatus, 'The connection ended without a close.' ); } );
	Socket.on( 'error', function () { ended( Frames.CLOSE_CODES.GoingAway, 'The connection failed.' ); } );

	if ( ping_ms > 0 )
	{
		ping_timer = setInterval( function ()
		{
			if ( Date.now() - heard_at > pong_timeout_ms )
			{
				connection.Terminate( Frames.CLOSE_CODES.GoingAway, 'The client stopped answering.' );
				return;
			}
			write( Frames.Encode( Frames.OPCODES.ping, Buffer.alloc( 0 ) ) );
		}, ping_ms );
		// A ping timer never keeps the process alive by itself.
		if ( typeof ping_timer.unref === 'function' ) { ping_timer.unref(); }
	}

	return connection;
}


//---------------------------------------------------------------------
module.exports = {
	DEFAULT_PING_MS: DEFAULT_PING_MS,
	DEFAULT_PONG_TIMEOUT_MS: DEFAULT_PONG_TIMEOUT_MS,
	DEFAULT_CLOSE_WAIT_MS: DEFAULT_CLOSE_WAIT_MS,
	NewConnection: NewConnection,
};
