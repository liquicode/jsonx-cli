'use strict';

const LIB_ASSERT = require( 'assert' );
const { describe, it } = require( 'node:test' );

const Frames = require( '../modes/ws/Frames.js' );


//---------------------------------------------------------------------
// A client frame: masked, with FIN and the opcode given, and any reserved bits asked for.
function client_frame( Opcode, Payload, Extra )
{
	let extra = Extra || {};
	let payload = Buffer.isBuffer( Payload ) ? Payload : Buffer.from( Payload || '', 'utf8' );
	let fin = ( extra.Fin === false ) ? 0 : 0x80;
	let first = fin | ( extra.Rsv || 0 ) | Opcode;
	let masked = ( extra.Masked === false ) ? 0 : 0x80;
	let header = null;
	if ( payload.length < 126 ) { header = Buffer.from( [ first, masked | payload.length ] ); }
	else if ( payload.length < 65536 ) { header = Buffer.alloc( 4 ); header[ 0 ] = first; header[ 1 ] = masked | 126; header.writeUInt16BE( payload.length, 2 ); }
	else { header = Buffer.alloc( 10 ); header[ 0 ] = first; header[ 1 ] = masked | 127; header.writeBigUInt64BE( BigInt( payload.length ), 2 ); }
	if ( !masked ) { return Buffer.concat( [ header, payload ] ); }
	let mask = Buffer.from( [ 0x37, 0xfa, 0x21, 0x3d ] );
	let body = Buffer.from( payload );
	for ( let index = 0; index < body.length; index++ ) { body[ index ] ^= mask[ index % 4 ]; }
	return Buffer.concat( [ header, mask, body ] );
}

function refused( Buffer_, Code, Pattern, Options )
{
	let decoder = Frames.NewDecoder( Options );
	LIB_ASSERT.throws( function () { decoder.Push( Buffer_ ); }, function ( error )
	{
		LIB_ASSERT.ok( error instanceof Frames.FrameError, String( error ) );
		LIB_ASSERT.strictEqual( error.Code, Code, error.message );
		LIB_ASSERT.match( error.message, Pattern );
		return true;
	} );
}


//---------------------------------------------------------------------
describe( 'WebSocket frames', function ()
{

	it( 'computes the accept key of RFC 6455\'s own example, and knows a valid key', function ()
	{
		LIB_ASSERT.strictEqual( Frames.AcceptKey( 'dGhlIHNhbXBsZSBub25jZQ==' ), 's3pPLMBiTxaQ9kYGzzhZRbK+xOo=' );
		LIB_ASSERT.strictEqual( Frames.IsValidKey( 'dGhlIHNhbXBsZSBub25jZQ==' ), true );
		LIB_ASSERT.strictEqual( Frames.IsValidKey( 'c2hvcnQ=' ), false );
		LIB_ASSERT.strictEqual( Frames.IsValidKey( undefined ), false );
	} );

	it( 'encodes server frames unmasked, in each of the three length forms', function ()
	{
		for ( let length of [ 0, 125, 126, 65535, 65536 ] )
		{
			let frame = Frames.EncodeText( 'a'.repeat( length ) );
			LIB_ASSERT.strictEqual( frame[ 0 ], 0x81 );
			LIB_ASSERT.strictEqual( frame[ 1 ] & 0x80, 0, 'a server frame is never masked' );
			let form = frame[ 1 ] & 0x7f;
			if ( length < 126 ) { LIB_ASSERT.strictEqual( form, length ); LIB_ASSERT.strictEqual( frame.length, 2 + length ); }
			else if ( length < 65536 ) { LIB_ASSERT.strictEqual( form, 126 ); LIB_ASSERT.strictEqual( frame.readUInt16BE( 2 ), length ); LIB_ASSERT.strictEqual( frame.length, 4 + length ); }
			else { LIB_ASSERT.strictEqual( form, 127 ); LIB_ASSERT.strictEqual( Number( frame.readBigUInt64BE( 2 ) ), length ); LIB_ASSERT.strictEqual( frame.length, 10 + length ); }
		}
		LIB_ASSERT.deepStrictEqual( [ ...Frames.EncodeClose( 1001, 'bye' ) ], [ 0x88, 5, 0x03, 0xe9, 0x62, 0x79, 0x65 ] );
		LIB_ASSERT.deepStrictEqual( [ ...Frames.EncodeClose() ], [ 0x88, 0 ] );
		LIB_ASSERT.ok( Frames.EncodeClose( 1000, 'x'.repeat( 500 ) ).length <= 2 + 125, 'a close body is at most 125 bytes' );
	} );

	it( 'decodes masked client messages in each length form, byte by byte as well as whole', function ()
	{
		let texts = [ '', 'hello', 'é'.repeat( 70 ), 'b'.repeat( 126 ), 'c'.repeat( 70000 ) ];
		let stream = Buffer.concat( texts.map( function ( Text ) { return client_frame( Frames.OPCODES.text, Text ); } ) );

		let whole = Frames.NewDecoder().Push( stream );
		LIB_ASSERT.deepStrictEqual( whole.map( function ( Message ) { return Message.Text; } ), texts );

		let decoder = Frames.NewDecoder();
		let pieces = [];
		for ( let index = 0; index < stream.length; index += 7 ) { pieces = pieces.concat( decoder.Push( stream.subarray( index, index + 7 ) ) ); }
		LIB_ASSERT.deepStrictEqual( pieces.map( function ( Message ) { return Message.Text; } ), texts );

		let binary = Frames.NewDecoder().Push( client_frame( Frames.OPCODES.binary, Buffer.from( [ 1, 2, 3 ] ) ) );
		LIB_ASSERT.deepStrictEqual( [ binary[ 0 ].Type, [ ...binary[ 0 ].Data ] ], [ 'binary', [ 1, 2, 3 ] ] );
	} );

	it( 'joins a fragmented message, with a ping arriving between its fragments', function ()
	{
		let messages = Frames.NewDecoder().Push( Buffer.concat( [
			client_frame( Frames.OPCODES.text, 'one ', { Fin: false } ),
			client_frame( Frames.OPCODES.ping, 'are you there' ),
			client_frame( Frames.OPCODES.continuation, 'two ', { Fin: false } ),
			client_frame( Frames.OPCODES.continuation, 'three' ),
		] ) );
		LIB_ASSERT.deepStrictEqual( messages.map( function ( Message ) { return Message.Type; } ), [ 'ping', 'text' ] );
		LIB_ASSERT.strictEqual( messages[ 0 ].Data.toString(), 'are you there' );
		LIB_ASSERT.strictEqual( messages[ 1 ].Text, 'one two three' );

		// A multi-byte character split across two fragments is joined before it is read.
		let bytes = Buffer.from( 'é', 'utf8' );
		let split = Frames.NewDecoder().Push( Buffer.concat( [
			client_frame( Frames.OPCODES.text, bytes.subarray( 0, 1 ), { Fin: false } ),
			client_frame( Frames.OPCODES.continuation, bytes.subarray( 1 ) ),
		] ) );
		LIB_ASSERT.strictEqual( split[ 0 ].Text, 'é' );
	} );

	it( 'reads a close\'s code and reason, and an empty close as 1005', function ()
	{
		let body = Buffer.concat( [ Buffer.from( [ 0x03, 0xe8 ] ), Buffer.from( 'done', 'utf8' ) ] );
		LIB_ASSERT.deepStrictEqual( Frames.NewDecoder().Push( client_frame( Frames.OPCODES.close, body ) ), [ { Type: 'close', Code: 1000, Reason: 'done' } ] );
		LIB_ASSERT.deepStrictEqual( Frames.NewDecoder().Push( client_frame( Frames.OPCODES.close, '' ) ), [ { Type: 'close', Code: 1005, Reason: '' } ] );
	} );

	it( 'refuses what breaks the protocol, each with its close code', function ()
	{
		let codes = Frames.CLOSE_CODES;
		refused( client_frame( Frames.OPCODES.text, 'x', { Masked: false } ), codes.ProtocolError, /not masked/ );
		refused( client_frame( Frames.OPCODES.text, 'x', { Rsv: 0x40 } ), codes.ProtocolError, /reserved bit/ );
		refused( client_frame( 0x3, 'x' ), codes.ProtocolError, /unknown opcode/ );
		refused( client_frame( 0xb, 'x' ), codes.ProtocolError, /unknown control opcode/ );
		refused( client_frame( Frames.OPCODES.ping, 'x'.repeat( 126 ) ), codes.ProtocolError, /control frame/ );
		refused( client_frame( Frames.OPCODES.ping, 'x', { Fin: false } ), codes.ProtocolError, /control frame/ );
		refused( client_frame( Frames.OPCODES.continuation, 'x' ), codes.ProtocolError, /no message to continue/ );
		refused( Buffer.concat( [ client_frame( Frames.OPCODES.text, 'a', { Fin: false } ), client_frame( Frames.OPCODES.text, 'b' ) ] ), codes.ProtocolError, /before the fragmented one ended/ );
		refused( client_frame( Frames.OPCODES.close, Buffer.from( [ 0x03 ] ) ), codes.ProtocolError, /one byte/ );
		refused( client_frame( Frames.OPCODES.text, Buffer.from( [ 0xc3, 0x28 ] ) ), codes.InvalidData, /UTF-8/ );
		refused( client_frame( Frames.OPCODES.text, 'x'.repeat( 200 ) ), codes.TooBig, /larger than 100 bytes/, { MaxMessageBytes: 100 } );
		refused( Buffer.concat( [
			client_frame( Frames.OPCODES.text, 'x'.repeat( 60 ), { Fin: false } ),
			client_frame( Frames.OPCODES.continuation, 'x'.repeat( 60 ) ),
		] ), codes.TooBig, /message is larger than 100 bytes/, { MaxMessageBytes: 100 } );
		// A 64-bit length beyond the limit is refused from its header, before any payload arrives.
		let huge = Buffer.alloc( 10 );
		huge[ 0 ] = 0x81; huge[ 1 ] = 0x80 | 127; huge.writeBigUInt64BE( BigInt( Frames.MAX_MESSAGE_BYTES + 1 ), 2 );
		refused( huge, codes.TooBig, /frame is larger/ );
	} );

} );
