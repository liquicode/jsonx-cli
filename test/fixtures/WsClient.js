'use strict';

/*
	A held file served on a free loopback port, and Node's own WebSocket client over it, for the tests of
	what the WebSocket answers (cut 5). The same shapes as test/Ws.test.js's own helpers.
*/

const LIB_FS = require( 'fs' );
const LIB_HTTP = require( 'http' );
const LIB_PATH = require( 'path' );

const Api = require( '../../modes/api/Api.js' );
const Held = require( '../../src/Session/Held.js' );
const Parser = require( '../../src/CommandLine/Parser.js' );
const Commands = require( '../../commands/jsonx.js' );


const KEY = 'dGhlIHNhbXBsZSBub25jZQ==';


//---------------------------------------------------------------------
function Write( Directory, Name, Document )
{
	let path = LIB_PATH.join( Directory, Name );
	LIB_FS.writeFileSync( path, JSON.stringify( Document, null, '\t' ) );
	return path;
}

function Wait( Ms ) { return new Promise( function ( Resolve ) { setTimeout( Resolve, Ms ); } ); }


//---------------------------------------------------------------------
// Options: Api (merged into NewApi's options), Env.

async function Serve( File, Options )
{
	let options = Options || {};
	let io = Parser.DefaultIo();
	io.Env = options.Env || {};
	io.Cwd = LIB_PATH.dirname( File );
	let held = Held.NewHeld( { Tree: Commands.TREE, File: File, Io: io } );
	let app = Api.NewApi( held, Object.assign( { Host: '127.0.0.1', Version: 'test' }, options.Api || {} ) );
	let server = await Api.Listen( app, '127.0.0.1', 0 );
	let port = server.address().port;
	return {
		Held: held,
		App: app,
		Server: server,
		Port: port,
		Base: 'http://127.0.0.1:' + port,
		Url: 'ws://127.0.0.1:' + port + '/ws',
		Close: async function () { await Api.Close( server ); await held.Release(); },
	};
}


//---------------------------------------------------------------------
// A connected client which keeps every message. Rejects when the socket does not open.

function Connect( Url, Headers )
{
	return new Promise( function ( Resolve, Reject )
	{
		let socket = new WebSocket( Url, Headers ? { headers: Headers } : undefined );
		let client = { Socket: socket, Messages: [], Closed: null, Waiters: [], Sent: 0 };
		client.Closing = new Promise( function ( ResolveClose ) { client.ResolveClose = ResolveClose; } );

		socket.onmessage = function ( Event )
		{
			let message = JSON.parse( String( Event.data ) );
			client.Messages.push( message );
			client.Waiters = client.Waiters.filter( function ( Waiter )
			{
				if ( !Waiter.Test( message ) ) { return true; }
				Waiter.Resolve( message );
				return false;
			} );
		};
		socket.onclose = function ( Event )
		{
			client.Closed = { Code: Event.code, Reason: Event.reason };
			client.ResolveClose( client.Closed );
		};
		socket.onerror = function () { if ( socket.readyState !== WebSocket.OPEN ) { Reject( new Error( 'The WebSocket did not open.' ) ); } };
		socket.onopen = function () { Resolve( client ); };

		client.Next = function ( Test, TimeoutMs )
		{
			let found = client.Messages.find( Test );
			if ( found ) { return Promise.resolve( found ); }
			return new Promise( function ( ResolveNext, RejectNext )
			{
				let timer = setTimeout( function () { RejectNext( new Error( 'No such message within the time.' ) ); }, TimeoutMs || 5000 );
				client.Waiters.push( { Test: Test, Resolve: function ( Message ) { clearTimeout( timer ); ResolveNext( Message ); } } );
			} );
		};

		// Sends a request with a fresh Id and answers its Answer envelope.
		client.Ask = async function ( Request, TimeoutMs )
		{
			client.Sent++;
			let id = 'q' + client.Sent;
			let answered = client.Next( function ( Message ) { return Message.Id === id && Message.Answer; }, TimeoutMs || 20000 );
			socket.send( JSON.stringify( Object.assign( { Id: id }, Request ) ) );
			return ( await answered ).Answer;
		};

		client.Close = function ()
		{
			if ( client.Closed === null ) { socket.close(); }
			return client.Closing;
		};
	} );
}


//---------------------------------------------------------------------
// An upgrade request with the headers given; answers { Status, Json, Upgraded }.

function RawUpgrade( Port, Path, Headers )
{
	return new Promise( function ( Resolve, Reject )
	{
		let headers = Object.assign( {
			Host: '127.0.0.1:' + Port,
			Connection: 'Upgrade',
			Upgrade: 'websocket',
			'Sec-WebSocket-Version': '13',
			'Sec-WebSocket-Key': KEY,
		}, Headers || {} );
		Object.keys( headers ).forEach( function ( Name ) { if ( headers[ Name ] === null ) { delete headers[ Name ]; } } );
		let request = LIB_HTTP.request( { host: '127.0.0.1', port: Port, path: Path, method: 'GET', headers: headers, agent: false } );
		request.on( 'upgrade', function ( Response, Socket )
		{
			Socket.destroy();
			Resolve( { Status: Response.statusCode, Upgraded: true } );
		} );
		request.on( 'response', function ( Response )
		{
			let text = '';
			Response.setEncoding( 'utf8' );
			Response.on( 'data', function ( Chunk ) { text += Chunk; } );
			Response.on( 'end', function ()
			{
				let json = null;
				try { json = JSON.parse( text ); } catch ( error ) { json = null; }
				Resolve( { Status: Response.statusCode, Json: json, Headers: Response.headers, Upgraded: false } );
			} );
		} );
		request.on( 'error', Reject );
		request.end();
	} );
}


//---------------------------------------------------------------------
module.exports = {
	KEY: KEY,
	Write: Write,
	Wait: Wait,
	Serve: Serve,
	Connect: Connect,
	RawUpgrade: RawUpgrade,
};
