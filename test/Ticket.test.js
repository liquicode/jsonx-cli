'use strict';

/*
	A browser's token (cut 5, step 2): a one-use ticket for the WebSocket, and the page's config without a
	token, while the Host and Origin checks still hold.
*/

const LIB_ASSERT = require( 'assert' );
const LIB_FS = require( 'fs' );
const LIB_OS = require( 'os' );
const LIB_PATH = require( 'path' );
const { describe, it, before, after } = require( 'node:test' );

const Api = require( '../modes/api/Api.js' );
const Spec = require( './fixtures/Spec.js' );
const WsClient = require( './fixtures/WsClient.js' );


const TOKEN = 'a long random value for the tests';


async function ticket( Base, Token )
{
	let headers = {};
	if ( Token ) { headers.Authorization = 'Bearer ' + Token; }
	let response = await fetch( Base + Api.TICKET_ROUTE, { method: 'POST', headers: headers } );
	return { Status: response.status, Json: await response.json(), CacheControl: response.headers.get( 'cache-control' ) };
}


//---------------------------------------------------------------------
describe( 'The ticket', function ()
{
	let root = null;

	before( function () { root = LIB_FS.mkdtempSync( LIB_PATH.join( LIB_OS.tmpdir(), 'jsonx-ticket-' ) ); } );
	after( function () { LIB_FS.rmSync( root, { recursive: true, force: true } ); } );


	it( 'is issued for the token, opens one WebSocket, and not a second', async function ()
	{
		let file = WsClient.Write( root, 'once.jsonx', Spec.AppendixB() );
		let served = await WsClient.Serve( file, { Api: { Token: TOKEN } } );
		try
		{
			LIB_ASSERT.strictEqual( ( await ticket( served.Base ) ).Status, 401 );
			let issued = await ticket( served.Base, TOKEN );
			LIB_ASSERT.strictEqual( issued.Status, 200 );
			LIB_ASSERT.strictEqual( issued.Json.ExpiresInMs, Api.TICKET_MS );
			LIB_ASSERT.match( issued.Json.Ticket, /^[A-Za-z0-9_-]{43}$/ );
			LIB_ASSERT.strictEqual( issued.CacheControl, 'no-store' );

			// Neither a token nor a ticket: the token's 401, before any handshake.
			let bare = await WsClient.RawUpgrade( served.Port, '/ws' );
			LIB_ASSERT.deepStrictEqual( [ bare.Status, bare.Upgraded ], [ 401, false ] );

			let client = await WsClient.Connect( served.Url + '?ticket=' + encodeURIComponent( issued.Json.Ticket ) );
			let hello = await client.Next( function ( Message ) { return Message.Hello; } );
			LIB_ASSERT.ok( hello.Hello.Commands.length > 0 );
			await client.Close();

			let again = await WsClient.RawUpgrade( served.Port, '/ws?ticket=' + encodeURIComponent( issued.Json.Ticket ) );
			LIB_ASSERT.deepStrictEqual( [ again.Status, again.Upgraded ], [ 401, false ] );
			LIB_ASSERT.match( again.Json.Log[ 0 ], /used, expired or unknown/ );

			let made_up = await WsClient.RawUpgrade( served.Port, '/ws?ticket=' + 'x'.repeat( 43 ) );
			LIB_ASSERT.strictEqual( made_up.Status, 401 );

			// A ticket is for the WebSocket only: it opens no command route.
			let fresh = ( await ticket( served.Base, TOKEN ) ).Json.Ticket;
			let route = await fetch( served.Base + '/validate?ticket=' + encodeURIComponent( fresh ), { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' } );
			LIB_ASSERT.strictEqual( route.status, 401 );
			let listing = await fetch( served.Base + '/?ticket=' + encodeURIComponent( fresh ) );
			LIB_ASSERT.strictEqual( listing.status, 401 );
			// And the token itself still opens the WebSocket.
			let with_token = await WsClient.RawUpgrade( served.Port, '/ws', { Authorization: 'Bearer ' + TOKEN } );
			LIB_ASSERT.deepStrictEqual( [ with_token.Status, with_token.Upgraded ], [ 101, true ] );
		}
		finally { await served.Close(); }
	} );


	it( 'expires', async function ()
	{
		let now = 1000;
		let tickets = Api.NewTickets( { LifetimeMs: 30000, Now: function () { return now; } } );
		let early = tickets.Issue().Ticket;
		let late = tickets.Issue().Ticket;
		now += 29999;
		LIB_ASSERT.strictEqual( tickets.Take( early ), true );
		now += 1;
		LIB_ASSERT.strictEqual( tickets.Take( late ), false );
		LIB_ASSERT.strictEqual( tickets.Take( '' ), false );
		LIB_ASSERT.strictEqual( tickets.Take( undefined ), false );

		// Through a server, with a short life.
		let file = WsClient.Write( root, 'expires.jsonx', Spec.AppendixB() );
		let served = await WsClient.Serve( file, { Api: { Token: TOKEN, TicketMs: 100 } } );
		try
		{
			let issued = ( await ticket( served.Base, TOKEN ) ).Json;
			LIB_ASSERT.strictEqual( issued.ExpiresInMs, 100 );
			await WsClient.Wait( 250 );
			let late_upgrade = await WsClient.RawUpgrade( served.Port, '/ws?ticket=' + encodeURIComponent( issued.Ticket ) );
			LIB_ASSERT.strictEqual( late_upgrade.Status, 401 );
		}
		finally { await served.Close(); }
	} );


	it( 'answers the page\'s config without a token, and needs no ticket on loopback with no token', async function ()
	{
		let file = WsClient.Write( root, 'config.jsonx', Spec.AppendixB() );
		let with_token = await WsClient.Serve( file, { Api: { Token: TOKEN } } );
		try
		{
			let config = await fetch( with_token.Base + Api.CONFIG_ROUTE );
			LIB_ASSERT.strictEqual( config.status, 200 );
			LIB_ASSERT.deepStrictEqual( await config.json(), { TokenRequired: true } );
			// Public to GET only.
			LIB_ASSERT.strictEqual( ( await fetch( with_token.Base + Api.CONFIG_ROUTE, { method: 'POST' } ) ).status, 401 );
			// The Host check still holds on a public path: a rebinding request is refused.
			let rebound = await new Promise( function ( Resolve, Reject )
			{
				let request = require( 'http' ).request( { host: '127.0.0.1', port: with_token.Port, path: Api.CONFIG_ROUTE, headers: { Host: 'attacker.example:' + with_token.Port } }, function ( Response ) { Response.resume(); Resolve( Response.statusCode ); } );
				request.on( 'error', Reject );
				request.end();
			} );
			LIB_ASSERT.strictEqual( rebound, 403 );
			let cross_site = await fetch( with_token.Base + Api.CONFIG_ROUTE, { headers: { Origin: 'http://attacker.example' } } );
			LIB_ASSERT.strictEqual( cross_site.status, 403 );
		}
		finally { await with_token.Close(); }

		let open = await WsClient.Serve( file );
		try
		{
			LIB_ASSERT.deepStrictEqual( await ( await fetch( open.Base + Api.CONFIG_ROUTE ) ).json(), { TokenRequired: false } );
			let client = await WsClient.Connect( open.Url );
			await client.Next( function ( Message ) { return Message.Hello; } );
			await client.Close();
		}
		finally { await open.Close(); }
	} );

} );
