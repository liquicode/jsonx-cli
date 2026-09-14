'use strict';

/*
	The Web UI in a real browser (cut 5, decision 2), over the DevTools protocol (test/fixtures/Cdp.js):
	the page served by `jsonx serve --ui`, driven as a person drives it. One browser for the file.

	Step 3 holds the first case: the page connects and shows what the process said. The panes' cases join
	in steps 4 to 6.
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


function text_of( Id )
{
	return 'document.getElementById( ' + JSON.stringify( Id ) + ' ) ? document.getElementById( ' + JSON.stringify( Id ) + ' ).textContent : null';
}


//---------------------------------------------------------------------
describe( 'The Web UI in a browser', function ()
{
	let root = null;
	let browser = null;

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


	it( 'loads with no console error, connects, and shows what the process said', async function ()
	{
		let file = WsClient.Write( root, 'hello.jsonx', Spec.AppendixB() );
		let served = await WsClient.Serve( file, { Api: { Ui: true, Version: jsonx_cli.Version } } );
		// jsonx serve watches its file; a held session made here must be told to.
		served.Held.Watch();
		try
		{
			let page = await browser.OpenPage( served.Base + '/ui/' );
			await page.WaitFor( '( ' + text_of( 'jsonx-entries' ) + ' ) === "12"' );
			LIB_ASSERT.strictEqual( await page.Evaluate( text_of( 'jsonx-connection' ) ), 'connected' );
			LIB_ASSERT.strictEqual( await page.Evaluate( text_of( 'jsonx-file' ) ), file );
			LIB_ASSERT.strictEqual( await page.Evaluate( text_of( 'jsonx-version' ) ), jsonx_cli.Version );
			let listed = await ( await fetch( served.Base + '/' ) ).json();
			LIB_ASSERT.strictEqual( await page.Evaluate( text_of( 'jsonx-commands' ) ), String( listed.Commands.length ) );

			// A disk edit reaches the page: one entry fewer.
			let edited = Spec.AppendixB();
			edited.Objects.pop();
			edited.Triggers = [];
			WsClient.Write( root, 'hello.jsonx', edited );
			await page.WaitFor( '( ' + text_of( 'jsonx-entries' ) + ' ) === "10"' );

			// The process stopping shows as disconnected, and the page does not reconnect.
			await served.Close();
			served = null;
			await page.WaitFor( '( ' + text_of( 'jsonx-connection' ) + ' ) === "disconnected"' );

			LIB_ASSERT.deepStrictEqual( page.Errors, [] );
		}
		finally { if ( served ) { await served.Close(); } }
	} );


	it( 'says so when the process needs a token', async function ()
	{
		let file = WsClient.Write( root, 'token.jsonx', Spec.AppendixB() );
		let served = await WsClient.Serve( file, { Api: { Ui: true, Token: 'a long random value' } } );
		try
		{
			let page = await browser.OpenPage( served.Base + '/ui/' );
			await page.WaitFor( '( ' + text_of( 'jsonx-message' ) + ' ) === "This jsonx process needs a token."' );
			LIB_ASSERT.strictEqual( await page.Evaluate( text_of( 'jsonx-connection' ) ), 'disconnected' );
			LIB_ASSERT.deepStrictEqual( page.Errors, [] );
		}
		finally { await served.Close(); }
	} );

} );
