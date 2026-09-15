'use strict';

/*
	`jsonx serve --ui` (cut 5, step 3): the page and its vendor packages under /ui/, the Web API with it,
	the ready line's Ui, and a browser's GET / sent to the page - with no browser.
*/

const LIB_ASSERT = require( 'assert' );
const LIB_FS = require( 'fs' );
const LIB_OS = require( 'os' );
const LIB_PATH = require( 'path' );
const { describe, it, before, after } = require( 'node:test' );

const Main = require( '../modes/cli/Main.js' );
const Api = require( '../modes/api/Api.js' );
const Web = require( '../modes/web/Web.js' );
const Parser = require( '../src/CommandLine/Parser.js' );
const Spec = require( './fixtures/Spec.js' );
const WsClient = require( './fixtures/WsClient.js' );


const TOKEN = 'a long random value for the tests';


//---------------------------------------------------------------------
describe( 'jsonx serve --ui', function ()
{
	let root = null;
	let file = null;

	before( function ()
	{
		root = LIB_FS.mkdtempSync( LIB_PATH.join( LIB_OS.tmpdir(), 'jsonx-webserve-' ) );
		file = WsClient.Write( root, 'observatory.jsonx', Spec.AppendixB() );
	} );

	after( function () { LIB_FS.rmSync( root, { recursive: true, force: true } ); } );

	// An Io whose stop is ours, and whose standard error announces the address.
	function serve_io()
	{
		let io = Parser.DefaultIo();
		io.Env = {};
		io.Cwd = root;
		io.Err = '';
		io.Out = '';
		io.Stdout = function ( Text ) { io.Out += Text; };
		let announced = null;
		io.Address = new Promise( function ( Resolve ) { announced = Resolve; } );
		io.Stderr = function ( Text )
		{
			io.Err += Text;
			let match = /at (http:\/\/127\.0\.0\.1:\d+)/.exec( io.Err );
			if ( match ) { announced( match[ 1 ] ); }
		};
		let stop = null;
		io.Stopped = new Promise( function ( Resolve ) { stop = Resolve; } );
		io.Stop = function () { stop(); };
		io.WaitForStop = function () { return io.Stopped; };
		return io;
	}


	it( 'serves the page with the Web API, and says where in its ready line', async function ()
	{
		let io = serve_io();
		let running = Main.Main( [ 'serve', '--ui', '--port', '0', '--file', file ], io );
		let base = await io.Address;
		try
		{
			// The Web API came with it.
			let validated = await fetch( base + '/validate', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' } );
			LIB_ASSERT.strictEqual( validated.status, 200 );

			let page = await fetch( base + Web.ROUTE );
			LIB_ASSERT.strictEqual( page.status, 200 );
			LIB_ASSERT.match( page.headers.get( 'content-type' ), /text\/html/ );
			LIB_ASSERT.match( await page.text(), /ng-app="JsonxWeb"/ );
			LIB_ASSERT.strictEqual( ( await fetch( base + '/ui', { redirect: 'manual' } ) ).headers.get( 'location' ), Web.ROUTE );

			// Every vendor file the page loads is found, through the resolver.
			for ( let asset of [ 'vendor/angular/angular.min.js', 'vendor/bootstrap/dist/css/bootstrap.min.css', 'vendor/monaco/min/vs/loader.js', 'vendor/monaco/min/vs/base/worker/workerMain.js', 'js/client.js', 'css/jsonx.css' ] )
			{
				let response = await fetch( base + Web.ROUTE + asset );
				LIB_ASSERT.strictEqual( response.status, 200, asset );
				await response.arrayBuffer();
			}
			LIB_ASSERT.strictEqual( ( await fetch( base + Web.ROUTE + 'vendor/angular/nothing.js' ) ).status, 404 );

			// A browser's GET / goes to the page; a program's still gets the commands.
			let browser_root = await fetch( base + '/', { headers: { Accept: 'text/html,application/xhtml+xml' }, redirect: 'manual' } );
			LIB_ASSERT.deepStrictEqual( [ browser_root.status, browser_root.headers.get( 'location' ) ], [ 302, Web.ROUTE ] );
			let program_root = await fetch( base + '/' );
			LIB_ASSERT.ok( Array.isArray( ( await program_root.json() ).Commands ) );
		}
		finally
		{
			io.Stop();
			LIB_ASSERT.strictEqual( await running, 0, io.Err );
		}
		LIB_ASSERT.deepStrictEqual( JSON.parse( io.Out ), { File: file, Url: base, Ws: base.replace( 'http:', 'ws:' ) + '/ws', Pid: process.pid, Ui: base + '/ui/' } );
		LIB_ASSERT.ok( io.Err.includes( 'The Web UI is at ' + base + '/ui/.' ), io.Err );
	} );


	it( 'takes a browser\'s same-origin mark over an Origin with its port dropped, and nothing else', async function ()
	{
		let served = await WsClient.Serve( file, { Api: { Ui: true } } );
		try
		{
			let get = function ( Path, Headers ) { return fetch( served.Base + Path, { headers: Headers } ).then( function ( Response ) { return Response.status; } ); };
			let portless = 'http://127.0.0.1';

			// What the user's Chrome sent for the page's own files and fetches (2026-09-15).
			LIB_ASSERT.strictEqual( await get( Web.ROUTE + 'js/app.js', { Origin: portless, 'Sec-Fetch-Site': 'same-origin' } ), 200 );
			LIB_ASSERT.strictEqual( await get( Api.CONFIG_ROUTE, { Origin: portless, 'Sec-Fetch-Site': 'same-origin' } ), 200 );
			let posted = await fetch( served.Base + '/validate', { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: portless, 'Sec-Fetch-Site': 'same-origin' }, body: '{}' } );
			LIB_ASSERT.strictEqual( posted.status, 200 );
			// An address typed is `none`.
			LIB_ASSERT.strictEqual( await get( Web.ROUTE, { 'Sec-Fetch-Site': 'none' } ), 200 );

			// A page on another port of 127.0.0.1 is same-site, and one elsewhere cross-site: Origin decides.
			LIB_ASSERT.strictEqual( await get( Web.ROUTE, { Origin: portless, 'Sec-Fetch-Site': 'same-site' } ), 403 );
			LIB_ASSERT.strictEqual( await get( Web.ROUTE, { Origin: 'http://attacker.example', 'Sec-Fetch-Site': 'cross-site' } ), 403 );
			// No mark at all: the Origin is compared as before.
			LIB_ASSERT.strictEqual( await get( Web.ROUTE, { Origin: portless } ), 403 );
			LIB_ASSERT.strictEqual( await get( Web.ROUTE, { Origin: served.Base } ), 200 );

			// The mark is no way past the Host check.
			let rebound = await new Promise( function ( Resolve, Reject )
			{
				let request = require( 'http' ).request( { host: '127.0.0.1', port: served.Port, path: Web.ROUTE, headers: { Host: 'attacker.example:' + served.Port, 'Sec-Fetch-Site': 'same-origin' } }, function ( Response ) { Response.resume(); Resolve( Response.statusCode ); } );
				request.on( 'error', Reject );
				request.end();
			} );
			LIB_ASSERT.strictEqual( rebound, 403 );

			// The WebSocket's Origin is still compared: a port-less one is refused before the handshake.
			let upgrade = await WsClient.RawUpgrade( served.Port, '/ws', { Origin: portless } );
			LIB_ASSERT.deepStrictEqual( [ upgrade.Status, upgrade.Upgraded ], [ 403, false ] );
			let right = await WsClient.RawUpgrade( served.Port, '/ws', { Origin: served.Base } );
			LIB_ASSERT.deepStrictEqual( [ right.Status, right.Upgraded ], [ 101, true ] );
		}
		finally { await served.Close(); }
	} );


	it( 'serves no page without --ui', async function ()
	{
		let served = await WsClient.Serve( file );
		try
		{
			LIB_ASSERT.strictEqual( ( await fetch( served.Base + Web.ROUTE ) ).status, 404 );
			let root_page = await fetch( served.Base + '/', { headers: { Accept: 'text/html' }, redirect: 'manual' } );
			LIB_ASSERT.strictEqual( root_page.status, 200 );
			LIB_ASSERT.ok( Array.isArray( ( await root_page.json() ).Commands ) );
		}
		finally { await served.Close(); }
	} );


	it( 'serves the page\'s files without a token, and nothing else', async function ()
	{
		let served = await WsClient.Serve( file, { Api: { Token: TOKEN, Ui: true } } );
		try
		{
			LIB_ASSERT.strictEqual( ( await fetch( served.Base + Web.ROUTE ) ).status, 200 );
			LIB_ASSERT.strictEqual( ( await fetch( served.Base + Web.ROUTE + 'vendor/angular/angular.min.js' ) ).status, 200 );
			LIB_ASSERT.deepStrictEqual( await ( await fetch( served.Base + Api.CONFIG_ROUTE ) ).json(), { TokenRequired: true } );
			// A public folder is not a way around the token for anything above or beside it.
			LIB_ASSERT.strictEqual( ( await fetch( served.Base + '/' ) ).status, 401 );
			LIB_ASSERT.strictEqual( ( await fetch( served.Base + '/uix' ) ).status, 401 );
			LIB_ASSERT.strictEqual( ( await fetch( served.Base + '/validate', { method: 'POST' } ) ).status, 401 );
			LIB_ASSERT.strictEqual( ( await WsClient.RawUpgrade( served.Port, '/ws' ) ).Status, 401 );
			// Nor a way to write.
			LIB_ASSERT.strictEqual( ( await fetch( served.Base + Web.ROUTE, { method: 'POST' } ) ).status, 401 );
			// The Origin check holds on the page's files too.
			LIB_ASSERT.strictEqual( ( await fetch( served.Base + Web.ROUTE, { headers: { Origin: 'http://attacker.example' } } ) ).status, 403 );
		}
		finally { await served.Close(); }
	} );

} );
