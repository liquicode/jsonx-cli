'use strict';

/*
	WebSocket frames (RFC 6455), the server's half, and nothing about sockets or jsonx.

	***Written by hand, with no dependency*** (cut 4, decision 1), as the parser and MCP were. Node's
	built-in WebSocket client is what proves it (test/Ws.test.js).

	What a server needs and no more:
	-	the handshake's accept key (4.2.2)
	-	decoding what a client sends: ***every client frame is masked*** (5.1), a message may arrive in
		fragments (5.4), and a control frame - close, ping, pong - may arrive between them (5.5)
	-	encoding what a server sends, never masked
	-	***no extensions***: a client's offer of permessage-deflate is declined by not answering it
		(measured 2026-09-14: Node's client offers it, and connects without it), so a frame with a
		reserved bit set is a protocol error

	A mistake in what a client sent throws FrameError with the close code to answer it with.
*/

const LIB_CRYPTO = require( 'crypto' );


const GUID = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11';

const OPCODES = { continuation: 0x0, text: 0x1, binary: 0x2, close: 0x8, ping: 0x9, pong: 0xa };

const CLOSE_CODES = {
	Normal: 1000,
	GoingAway: 1001,
	ProtocolError: 1002,
	Unsupported: 1003,
	NoStatus: 1005,
	InvalidData: 1007,
	PolicyViolation: 1008,
	TooBig: 1009,
};

// The largest message accepted, whole or in fragments: the Web API's body limit.
const MAX_MESSAGE_BYTES = 16 * 1024 * 1024;


//---------------------------------------------------------------------
class FrameError extends Error
{
	constructor( Message, Code )
	{
		super( Message );
		this.name = 'FrameError';
		this.Code = Code || CLOSE_CODES.ProtocolError;
	}
}


//---------------------------------------------------------------------
// The Sec-WebSocket-Accept value for a client's Sec-WebSocket-Key.

function AcceptKey( Key )
{
	return LIB_CRYPTO.createHash( 'sha1' ).update( String( Key ) + GUID ).digest( 'base64' );
}


// Whether a Sec-WebSocket-Key is what 4.1 requires: 16 bytes, base64 encoded.
function IsValidKey( Key )
{
	if ( typeof Key !== 'string' || !/^[A-Za-z0-9+/]{22}==$/.test( Key.trim() ) ) { return false; }
	return Buffer.from( Key.trim(), 'base64' ).length === 16;
}


//---------------------------------------------------------------------
// A server frame: FIN set, never masked.

function Encode( Opcode, Payload )
{
	let payload = Buffer.isBuffer( Payload ) ? Payload : Buffer.from( ( typeof Payload === 'string' ) ? Payload : '', 'utf8' );
	let header = null;
	if ( payload.length < 126 )
	{
		header = Buffer.from( [ 0x80 | Opcode, payload.length ] );
	}
	else if ( payload.length < 65536 )
	{
		header = Buffer.alloc( 4 );
		header[ 0 ] = 0x80 | Opcode;
		header[ 1 ] = 126;
		header.writeUInt16BE( payload.length, 2 );
	}
	else
	{
		header = Buffer.alloc( 10 );
		header[ 0 ] = 0x80 | Opcode;
		header[ 1 ] = 127;
		header.writeBigUInt64BE( BigInt( payload.length ), 2 );
	}
	return Buffer.concat( [ header, payload ] );
}


function EncodeText( Text )
{
	return Encode( OPCODES.text, Buffer.from( String( Text ), 'utf8' ) );
}


// A close frame. With no code, an empty body - which the peer reads as 1005, no status (measured).
function EncodeClose( Code, Reason )
{
	if ( typeof Code !== 'number' ) { return Encode( OPCODES.close, Buffer.alloc( 0 ) ); }
	let reason = Buffer.from( String( Reason || '' ), 'utf8' );
	// A control frame's body is at most 125 bytes (5.5): the two of the code, then the reason.
	if ( reason.length > 123 ) { reason = reason.subarray( 0, 123 ); }
	let body = Buffer.alloc( 2 + reason.length );
	body.writeUInt16BE( Code, 0 );
	reason.copy( body, 2 );
	return Encode( OPCODES.close, body );
}


//---------------------------------------------------------------------
// Reads a client's byte stream. Push( Chunk ) answers the messages completed so far, in order:
//
//		{ Type: 'text', Text }         a whole text message, fragments joined
//		{ Type: 'binary', Data }       a whole binary message
//		{ Type: 'ping', Data }  { Type: 'pong', Data }
//		{ Type: 'close', Code, Reason }  Code is 1005 when the frame carried none
//
// and throws FrameError for what breaks the protocol. After a throw the decoder is spent.

function NewDecoder( Options )
{
	let options = ( Options && typeof Options === 'object' ) ? Options : {};
	let max_bytes = ( typeof options.MaxMessageBytes === 'number' ) ? options.MaxMessageBytes : MAX_MESSAGE_BYTES;
	let utf8 = new TextDecoder( 'utf-8', { fatal: true } );

	let pending = Buffer.alloc( 0 );
	// The message being assembled from fragments: its opcode and its pieces.
	let fragment_opcode = null;
	let fragments = [];
	let fragment_bytes = 0;

	function text_of( Buffer_ )
	{
		try { return utf8.decode( Buffer_ ); }
		catch ( error ) { throw new FrameError( 'A text message is not valid UTF-8.', CLOSE_CODES.InvalidData ); }
	}

	function message_of( Opcode, Payload )
	{
		if ( Opcode === OPCODES.text ) { return { Type: 'text', Text: text_of( Payload ) }; }
		return { Type: 'binary', Data: Payload };
	}

	function control_of( Opcode, Payload )
	{
		if ( Opcode === OPCODES.ping ) { return { Type: 'ping', Data: Payload }; }
		if ( Opcode === OPCODES.pong ) { return { Type: 'pong', Data: Payload }; }
		if ( Payload.length === 0 ) { return { Type: 'close', Code: CLOSE_CODES.NoStatus, Reason: '' }; }
		if ( Payload.length === 1 ) { throw new FrameError( 'A close frame\'s body is one byte, too short for a code.' ); }
		return { Type: 'close', Code: Payload.readUInt16BE( 0 ), Reason: text_of( Payload.subarray( 2 ) ) };
	}

	let decoder = {};

	decoder.Push = function ( Chunk )
	{
		pending = ( pending.length === 0 ) ? Buffer.from( Chunk ) : Buffer.concat( [ pending, Chunk ] );
		let messages = [];

		while ( pending.length >= 2 )
		{
			let first = pending[ 0 ];
			let second = pending[ 1 ];
			let fin = ( first & 0x80 ) !== 0;
			let opcode = first & 0x0f;
			let masked = ( second & 0x80 ) !== 0;
			let length = second & 0x7f;
			let at = 2;

			if ( ( first & 0x70 ) !== 0 ) { throw new FrameError( 'A frame sets a reserved bit, and no extension was agreed.' ); }
			if ( !masked ) { throw new FrameError( 'A client frame is not masked.' ); }

			let control = ( opcode & 0x08 ) !== 0;
			if ( !control && opcode !== OPCODES.continuation && opcode !== OPCODES.text && opcode !== OPCODES.binary )
			{
				throw new FrameError( 'A frame has the unknown opcode ' + opcode + '.' );
			}
			if ( control && opcode !== OPCODES.close && opcode !== OPCODES.ping && opcode !== OPCODES.pong )
			{
				throw new FrameError( 'A frame has the unknown control opcode ' + opcode + '.' );
			}
			if ( control && ( !fin || length > 125 ) ) { throw new FrameError( 'A control frame is fragmented or longer than 125 bytes.' ); }

			if ( length === 126 )
			{
				if ( pending.length < at + 2 ) { break; }
				length = pending.readUInt16BE( at );
				at += 2;
			}
			else if ( length === 127 )
			{
				if ( pending.length < at + 8 ) { break; }
				let big = pending.readBigUInt64BE( at );
				if ( big > BigInt( max_bytes ) ) { throw new FrameError( 'A frame is larger than ' + max_bytes + ' bytes.', CLOSE_CODES.TooBig ); }
				length = Number( big );
				at += 8;
			}
			if ( length > max_bytes ) { throw new FrameError( 'A frame is larger than ' + max_bytes + ' bytes.', CLOSE_CODES.TooBig ); }

			if ( pending.length < at + 4 + length ) { break; }
			let mask = pending.subarray( at, at + 4 );
			at += 4;
			let payload = Buffer.from( pending.subarray( at, at + length ) );
			for ( let index = 0; index < payload.length; index++ ) { payload[ index ] ^= mask[ index % 4 ]; }
			pending = pending.subarray( at + length );

			if ( control )
			{
				messages.push( control_of( opcode, payload ) );
				continue;
			}

			if ( opcode === OPCODES.continuation )
			{
				if ( fragment_opcode === null ) { throw new FrameError( 'A continuation frame arrived with no message to continue.' ); }
			}
			else if ( fragment_opcode !== null )
			{
				throw new FrameError( 'A new message began before the fragmented one ended.' );
			}
			else
			{
				fragment_opcode = opcode;
			}

			fragment_bytes += payload.length;
			if ( fragment_bytes > max_bytes ) { throw new FrameError( 'A message is larger than ' + max_bytes + ' bytes.', CLOSE_CODES.TooBig ); }
			fragments.push( payload );

			if ( fin )
			{
				let whole = ( fragments.length === 1 ) ? fragments[ 0 ] : Buffer.concat( fragments );
				let message_opcode = fragment_opcode;
				fragment_opcode = null;
				fragments = [];
				fragment_bytes = 0;
				messages.push( message_of( message_opcode, whole ) );
			}
		}

		return messages;
	};

	return decoder;
}


//---------------------------------------------------------------------
module.exports = {
	GUID: GUID,
	OPCODES: OPCODES,
	CLOSE_CODES: CLOSE_CODES,
	MAX_MESSAGE_BYTES: MAX_MESSAGE_BYTES,
	FrameError: FrameError,
	AcceptKey: AcceptKey,
	IsValidKey: IsValidKey,
	Encode: Encode,
	EncodeText: EncodeText,
	EncodeClose: EncodeClose,
	NewDecoder: NewDecoder,
};
