'use strict';

/*
	The Web UI in a real browser (cut 5, decision 2), over the DevTools protocol (test/fixtures/Cdp.js):
	the page served by `jsonx serve --ui`, driven as a person drives it - clicks and keys - with the DOM read
	back. One browser for the file; a fresh served process per case, so memory stores start empty.

	Step 3: the page connects. Step 4: Inventory, Log, Data Rows, the status bar and the confirmation.
*/

const LIB_ASSERT = require( 'assert' );
const LIB_FS = require( 'fs' );
const LIB_OS = require( 'os' );
const LIB_PATH = require( 'path' );
const { describe, it, before, after } = require( 'node:test' );

const jsonx_cli = require( '../src/jsonx-cli.js' );
const Cdp = require( './fixtures/Cdp.js' );
const Spec = require( './fixtures/Spec.js' );
const WsClient = require( './fixtures/WsClient.js' );


//---------------------------------------------------------------------
function q( Selector ) { return JSON.stringify( Selector ); }

function text_of( Selector )
{
	return '( document.querySelector( ' + q( Selector ) + ' ) ? document.querySelector( ' + q( Selector ) + ' ).textContent.trim() : null )';
}

function texts_of( Selector )
{
	return 'Array.from( document.querySelectorAll( ' + q( Selector ) + ' ) ).map( function ( Each ) { return Each.textContent.trim(); } )';
}

function count_of( Selector )
{
	return 'document.querySelectorAll( ' + q( Selector ) + ' ).length';
}


//---------------------------------------------------------------------
describe( 'The Web UI in a browser', function ()
{
	let root = null;
	let browser = null;
	let file_number = 0;

	before( async function ()
	{
		root = LIB_FS.mkdtempSync( LIB_PATH.join( LIB_OS.tmpdir(), 'jsonx-webui-' ) );
		browser = await Cdp.StartBrowser();
	} );

	after( async function ()
	{
		if ( browser ) { await browser.Close(); }
		LIB_FS.rmSync( root, { recursive: true, force: true } );
	} );

	// A served copy of a document and a page open on it, ready: the inventory drawn.
	async function open( Document, Api )
	{
		file_number++;
		let file = WsClient.Write( root, 'file-' + file_number + '.jsonx', Document || Spec.AppendixB() );
		let served = await WsClient.Serve( file, { Api: Object.assign( { Ui: true, Version: jsonx_cli.Version }, Api || {} ) } );
		served.Held.Watch();
		let page = await browser.OpenPage( served.Base + '/ui/' );
		return { File: file, Served: served, Page: page };
	}

	async function ready( Page, Entries )
	{
		await Page.WaitFor( count_of( '.jsonx-entry' ) + ' === ' + Entries );
		return;
	}

	// Types a command into Input and sends it with Enter.
	async function send( Page, Line )
	{
		await Page.Click( '#jsonx-input' );
		await Page.Type( Line );
		await Page.Press( 'Enter' );
		return;
	}


	//---------------------------------------------------------------------
	it( 'loads with no console error, connects, and shows what the process said', async function ()
	{
		let opened = await open();
		let served = opened.Served;
		let page = opened.Page;
		try
		{
			await ready( page, 12 );
			LIB_ASSERT.strictEqual( await page.Evaluate( text_of( '#jsonx-connection' ) ), 'connected' );
			LIB_ASSERT.strictEqual( await page.Evaluate( text_of( '#jsonx-file' ) ), opened.File );
			let listed = await ( await fetch( served.Base + '/' ) ).json();
			LIB_ASSERT.match( await page.Evaluate( text_of( '#jsonx-status' ) ), new RegExp( '12 entries, ' + listed.Commands.length + ' commands' ) );
			LIB_ASSERT.deepStrictEqual( await page.Evaluate( texts_of( '.jsonx-section-head' ) ), [ 'Data sources', 'Objects', 'Triggers' ] );

			// A disk edit reaches the page: two entries fewer.
			let edited = Spec.AppendixB();
			edited.Objects.pop();
			edited.Triggers = [];
			WsClient.Write( root, LIB_PATH.basename( opened.File ), edited );
			await ready( page, 10 );
			await page.WaitFor( texts_of( '.jsonx-log-line.is-reload' ) + '.length === 1' );

			// The process stopping shows as disconnected, and the page does not reconnect.
			await served.Close();
			served = null;
			await page.WaitFor( text_of( '#jsonx-connection' ) + ' === "disconnected"' );

			LIB_ASSERT.deepStrictEqual( page.Errors, [] );
		}
		finally { if ( served ) { await served.Close(); } }
	} );


	it( 'works in a browser which sends its page\'s Origin without the port', async function ()
	{
		// The user's Chrome (2026-09-15) sent `Origin: http://127.0.0.1` on every stylesheet, script and
		// fetch, beside Sec-Fetch-Site: same-origin, and the right Origin on the WebSocket. The DevTools
		// Fetch domain rewrites HTTP requests only, so the upgrade stays as that browser sent it.
		file_number++;
		let file = WsClient.Write( root, 'file-' + file_number + '.jsonx', Spec.AppendixB() );
		let served = await WsClient.Serve( file, { Api: { Ui: true, Version: jsonx_cli.Version } } );
		let page = await browser.OpenPage();
		try
		{
			let rewritten = 0;
			await page.Send( 'Fetch.enable', { patterns: [ { urlPattern: served.Base + '/*' } ] } );
			page.OnEvent( function ( Message )
			{
				if ( Message.method !== 'Fetch.requestPaused' ) { return; }
				let headers = Object.keys( Message.params.request.headers ).filter( function ( Name ) { return Name.toLowerCase() !== 'origin'; } )
					.map( function ( Name ) { return { name: Name, value: Message.params.request.headers[ Name ] }; } );
				headers.push( { name: 'Origin', value: 'http://127.0.0.1' } );
				rewritten++;
				page.Send( 'Fetch.continueRequest', { requestId: Message.params.requestId, headers: headers } );
				return;
			} );
			await page.Navigate( served.Base + '/ui/' );
			await ready( page, 12 );
			LIB_ASSERT.ok( rewritten >= 5, 'the page\'s requests went through the rewrite: ' + rewritten );
			await send( page, 'run "Prepare the season"' );
			await page.WaitFor( count_of( '.jsonx-row' ) + ' === 1' );
			LIB_ASSERT.deepStrictEqual( page.Errors, [] );
		}
		finally { await served.Close(); }
	} );


	it( 'says so when the process needs a token', async function ()
	{
		let opened = await open( null, { Token: 'a long random value' } );
		try
		{
			await opened.Page.WaitFor( text_of( '#jsonx-message' ) + ' === "This jsonx process needs a token."' );
			LIB_ASSERT.strictEqual( await opened.Page.Evaluate( text_of( '#jsonx-connection' ) ), 'disconnected' );
			LIB_ASSERT.deepStrictEqual( opened.Page.Errors, [] );
		}
		finally { await opened.Served.Close(); }
	} );


	it( 'marks each entry with its worst finding, and runs an entry from its actions by mouse and by keyboard', async function ()
	{
		let broken = Spec.AppendixB();
		broken.Objects.push( { Kind: 'Query', Name: 'Nowhere to look', DataSource: 'Nowhere', Criteria: {} } );
		let opened = await open( broken );
		let page = opened.Page;
		try
		{
			await ready( page, 13 );
			LIB_ASSERT.strictEqual( await page.Evaluate( text_of( '.jsonx-entry[data-name="Nowhere to look"] .jsonx-badge' ) ), '✖' );
			LIB_ASSERT.strictEqual( await page.Evaluate( text_of( '.jsonx-entry[data-name="Bookings"] .jsonx-badge' ) ), '' );

			// A double click opens the actions the process lists; run is first for a Process.
			await page.Click( '.jsonx-entry[data-name="Prepare the season"]', 2 );
			await page.WaitFor( count_of( '.jsonx-action' ) + ' > 0' );
			let actions = await page.Evaluate( texts_of( '.jsonx-action' ) );
			LIB_ASSERT.deepStrictEqual( actions.slice( 0, 2 ), [ 'run', 'debug' ] );
			LIB_ASSERT.ok( actions.includes( 'process rename …' ), JSON.stringify( actions ) );

			// The file has an error, so a run answers exit 3 and runs nothing; the Log says so.
			await page.Click( '.jsonx-action[data-command="run"]' );
			await page.WaitFor( texts_of( '.jsonx-log-line.is-error' ) + '.some( function ( Line ) { return Line === "exit 3"; } )' );
			LIB_ASSERT.ok( ( await page.Evaluate( texts_of( '.jsonx-log-line.is-command' ) ) ).includes( '> run "Prepare the season"' ) );
			LIB_ASSERT.strictEqual( await page.Evaluate( '!!document.getElementById( "jsonx-menu" )' ), false );
		}
		finally { await opened.Served.Close(); }

		// On a good file, by keyboard: focus an entry, move with the arrows, Enter opens, Enter runs.
		let good = await open();
		page = good.Page;
		try
		{
			await ready( page, 12 );
			await page.Evaluate( 'document.querySelector( ".jsonx-entry[data-name=\\"Note a long booking\\"]" ).focus()' );
			await page.Press( 'ArrowDown' );
			LIB_ASSERT.strictEqual( await page.Evaluate( 'document.activeElement.getAttribute( "data-name" )' ), 'Prepare the season' );
			await page.Press( 'Enter' );
			await page.WaitFor( 'document.activeElement && document.activeElement.classList.contains( "jsonx-action" )' );
			LIB_ASSERT.strictEqual( await page.Evaluate( 'document.activeElement.getAttribute( "data-command" )' ), 'run' );
			await page.Press( 'Enter' );

			// The specification's result, and its report with the trigger nested.
			await page.WaitFor( count_of( '.jsonx-row' ) + ' === 1' );
			LIB_ASSERT.deepStrictEqual( await page.Evaluate( texts_of( '.jsonx-table th' ) ), [ 'Booking', 'Observer', 'Dome' ] );
			LIB_ASSERT.deepStrictEqual( await page.Evaluate( texts_of( '.jsonx-row td' ) ), [ 'b-1', 'R. Okafor', 'B' ] );
			let log = await page.Evaluate( texts_of( '.jsonx-log-line.is-log' ) );
			LIB_ASSERT.ok( log.some( function ( Line ) { return /^trigger \[Note every long booking as it arrives\]/.test( Line ); } ), JSON.stringify( log ) );

			// An action which needs finishing goes to Input instead.
			await page.Click( '.jsonx-entry[data-name="Bookings"]', 2 );
			await page.WaitFor( count_of( '.jsonx-action' ) + ' > 0' );
			await page.Click( '.jsonx-action[data-command="datasource rename"]' );
			await page.WaitFor( 'document.getElementById( "jsonx-input" ).value === "datasource rename Bookings "' );

			// Escape closes an open menu.
			await page.Click( '.jsonx-entry[data-name="Notes"]', 2 );
			await page.WaitFor( '!!document.getElementById( "jsonx-menu" )' );
			await page.Press( 'Escape' );
			await page.WaitFor( '!document.getElementById( "jsonx-menu" )' );

			LIB_ASSERT.deepStrictEqual( page.Errors, [] );
		}
		finally { await good.Served.Close(); }
	} );


	it( 'asks before sending a command the --yes rule guards, and sends it only on yes', async function ()
	{
		let opened = await open();
		let page = opened.Page;
		let served = opened.Served;
		try
		{
			await ready( page, 12 );
			await send( page, 'run "Three bookings"' );
			await page.WaitFor( texts_of( '.jsonx-log-line.is-log' ) + '.some( function ( Line ) { return /inserted 3/.test( Line ); } )' );

			await send( page, 'data delete Bookings --criteria {}' );
			await page.WaitFor( '!!document.getElementById( "jsonx-confirm" )' );
			LIB_ASSERT.match( await page.Evaluate( text_of( '#jsonx-confirm-message' ) ), /selects every document/ );
			await page.Click( '#jsonx-confirm-no' );
			await page.WaitFor( '!document.getElementById( "jsonx-confirm" )' );
			await page.WaitFor( texts_of( '.jsonx-log-line.is-text' ) + '.includes( "Not sent." )' );
			LIB_ASSERT.strictEqual( ( await served.Held.Invoke( { Command: 'datasource count', name: 'Bookings' } ) ).Result, 3 );

			// n and Escape decline too; y sends it.
			await send( page, 'data delete Bookings --criteria {}' );
			await page.WaitFor( '!!document.getElementById( "jsonx-confirm" )' );
			await page.Press( 'Escape' );
			await page.WaitFor( '!document.getElementById( "jsonx-confirm" )' );
			LIB_ASSERT.strictEqual( ( await served.Held.Invoke( { Command: 'datasource count', name: 'Bookings' } ) ).Result, 3 );

			await send( page, 'data delete Bookings --criteria {}' );
			await page.WaitFor( '!!document.getElementById( "jsonx-confirm" )' );
			await page.Press( 'y' );
			await page.WaitFor( texts_of( '.jsonx-log-line.is-command' ) + '.includes( "> data delete Bookings --criteria {} (confirmed)" )' );
			await page.WaitFor( texts_of( '.jsonx-row td' ) + '.join( " " ) === "3"' );
			LIB_ASSERT.strictEqual( ( await served.Held.Invoke( { Command: 'datasource count', name: 'Bookings' } ) ).Result, 0 );

			LIB_ASSERT.deepStrictEqual( page.Errors, [] );
		}
		finally { await served.Close(); }
	} );


	it( 'pages a find, shows a row as JSON, and shows an update\'s changes with their diff', async function ()
	{
		let opened = await open();
		let page = opened.Page;
		try
		{
			await ready( page, 12 );
			await send( page, 'run "Three bookings"' );
			await page.WaitFor( texts_of( '.jsonx-log-line.is-log' ) + '.some( function ( Line ) { return /inserted 3/.test( Line ); } )' );

			await send( page, 'data find Bookings --max 2 --sort {"_id":1}' );
			await page.WaitFor( count_of( '.jsonx-row' ) + ' === 2' );
			LIB_ASSERT.strictEqual( await page.Evaluate( text_of( '#jsonx-page' ) ), 'rows 1-2' );
			LIB_ASSERT.strictEqual( await page.Evaluate( 'document.getElementById( "jsonx-page-previous" ).disabled' ), true );
			await page.Click( '#jsonx-page-next' );
			await page.WaitFor( text_of( '#jsonx-page' ) + ' === "rows 3-3"' );
			LIB_ASSERT.strictEqual( await page.Evaluate( count_of( '.jsonx-row' ) ), 1 );
			LIB_ASSERT.strictEqual( await page.Evaluate( 'document.getElementById( "jsonx-page-next" ).disabled' ), true );
			await page.Click( '#jsonx-page-previous' );
			await page.WaitFor( text_of( '#jsonx-page' ) + ' === "rows 1-2"' );

			// A row, whole, as JSON; Escape closes it.
			await page.Click( '.jsonx-row' );
			await page.WaitFor( '!!document.getElementById( "jsonx-json" )' );
			LIB_ASSERT.deepStrictEqual( JSON.parse( await page.Evaluate( text_of( '#jsonx-json-text' ) ) )._id, 'b-1' );
			await page.Press( 'Escape' );
			await page.WaitFor( '!document.getElementById( "jsonx-json" )' );

			await send( page, 'data update Bookings --criteria {"_id":"b-2"} --update {"$set":{"Status":"confirmed"}} --changes' );
			await page.WaitFor( count_of( '.jsonx-change .jsonx-diff' ) + ' === 1 && ' + text_of( '.jsonx-diff' ) + ' !== "null"' );
			LIB_ASSERT.strictEqual( JSON.parse( await page.Evaluate( text_of( '.jsonx-before' ) ) ).Status, 'requested' );
			LIB_ASSERT.strictEqual( JSON.parse( await page.Evaluate( text_of( '.jsonx-after' ) ) ).Status, 'confirmed' );
			LIB_ASSERT.deepStrictEqual( JSON.parse( await page.Evaluate( text_of( '.jsonx-diff' ) ) ), { $set: { Status: 'confirmed' } } );

			LIB_ASSERT.deepStrictEqual( page.Errors, [] );
		}
		finally { await opened.Served.Close(); }
	} );


	it( 'shows a usage mistake under Input, and a debug holding the queue in the status bar', async function ()
	{
		let opened = await open();
		let page = opened.Page;
		let other = null;
		try
		{
			await ready( page, 12 );
			await send( page, 'run "Prepare the season" --bogus' );
			await page.WaitFor( count_of( '.jsonx-input-finding.is-error' ) + ' === 1' );
			LIB_ASSERT.match( await page.Evaluate( text_of( '.jsonx-input-finding' ) ), /bogus/ );
			// The mistaken line stays, to be put right.
			LIB_ASSERT.strictEqual( await page.Evaluate( 'document.getElementById( "jsonx-input" ).value' ), 'run "Prepare the season" --bogus' );

			other = await WsClient.Connect( opened.Served.Url );
			other.Socket.send( JSON.stringify( { Id: 'd', Debug: { process: 'Prepare the season' } } ) );
			await page.WaitFor( text_of( '#jsonx-queue' ) + ' === "queue held by debug"' );
			other.Socket.send( JSON.stringify( { Id: 's', Step: 'quit' } ) );
			await page.WaitFor( '!document.getElementById( "jsonx-queue" )' );

			LIB_ASSERT.deepStrictEqual( page.Errors, [] );
		}
		finally { if ( other ) { await other.Close(); } await opened.Served.Close(); }
	} );

} );
