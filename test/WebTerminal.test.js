'use strict';

/*
	The jsonx terminal page in a real browser (plan O7, cut 6): `/ui/terminal.html` served by
	`jsonx serve --ui`, driven as a person drives it.

	The desktop opens this page beside a file's window, and holds no part of it - which is what keeps the
	terminal testable here, with no desktop and no window of its own.
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
const TRANSCRIPT = 'Array.from( document.querySelectorAll( ".jsonx-line" ) ).map( function ( Each ) { return Each.textContent; } ).join( "\\n" )';
const PROMPT_VALUE = 'document.getElementById( "jsonx-prompt-input" ).value';


//---------------------------------------------------------------------
describe( 'The jsonx terminal in a browser', function ()
{
	let root = null;
	let browser = null;
	let file_number = 0;

	before( async function ()
	{
		root = LIB_FS.mkdtempSync( LIB_PATH.join( LIB_OS.tmpdir(), 'jsonx-terminal-' ) );
		browser = await Cdp.StartBrowser();
	} );

	after( async function ()
	{
		if ( browser ) { await browser.Close(); }
		LIB_FS.rmSync( root, { recursive: true, force: true } );
	} );


	// A served copy of Appendix B with the terminal page open on it, connected.
	async function open( Document )
	{
		file_number++;
		let file = WsClient.Write( root, 'file-' + file_number + '.jsonx', Document || Spec.AppendixB() );
		let served = await WsClient.Serve( file, { Api: { Ui: true, Version: jsonx_cli.Version } } );
		served.Held.Watch();
		let page = await browser.OpenPage( served.Base + '/ui/terminal.html' );
		await page.WaitFor( TRANSCRIPT + '.includes( "' + LIB_PATH.basename( file ) + '" )', 20000 );
		return { File: file, Served: served, Page: page };
	}

	// Types a line and sends it.
	async function send( Page, Line )
	{
		await Page.Click( '#jsonx-prompt-input' );
		await Page.Type( Line );
		await Page.WaitFor( PROMPT_VALUE + ' === ' + JSON.stringify( Line ) );
		await Page.Press( 'Enter' );
		return;
	}


	//---------------------------------------------------------------------
	it( 'runs a command and writes what it answered', async function ()
	{
		let opened = await open();
		try
		{
			await send( opened.Page, 'run "Prepare the season"' );
			await opened.Page.WaitFor( TRANSCRIPT + '.includes( "into Assignments" )', 20000 );

			let transcript = await opened.Page.Evaluate( TRANSCRIPT );
			// The line as it was typed, the process's own report, and its result as JSON.
			LIB_ASSERT.match( transcript, /> run "Prepare the season"/ );
			LIB_ASSERT.match( transcript, /Prepare the season {2}Process {2}ran once/ );
			LIB_ASSERT.match( transcript, /"Observer": "R\. Okafor"/ );
			// The line is gone from the prompt once it is sent, and nothing was refused.
			LIB_ASSERT.strictEqual( await opened.Page.Evaluate( PROMPT_VALUE ), '' );
			LIB_ASSERT.deepStrictEqual( opened.Page.Errors, [] );
		}
		finally { await opened.Served.Close(); opened.Page.Close(); }
	} );


	//---------------------------------------------------------------------
	it( 'asks before a command the --yes rule guards, and sends only on y', async function ()
	{
		let opened = await open();
		try
		{
			// The file's data sources start empty, so the process fills them first.
			await send( opened.Page, 'run "Prepare the season"' );
			await opened.Page.WaitFor( TRANSCRIPT + '.includes( "into Assignments" )', 20000 );

			await send( opened.Page, 'data delete Bookings --criteria {}' );
			await opened.Page.WaitFor( TRANSCRIPT + '.includes( "(y/n)" )', 20000 );
			LIB_ASSERT.strictEqual( await opened.Page.Evaluate( 'document.querySelector( ".jsonx-prompt-mark" ).textContent' ), 'y/n' );

			// No: nothing is sent, and the documents are still there.
			await send( opened.Page, 'n' );
			await opened.Page.WaitFor( TRANSCRIPT + '.includes( "Not sent." )' );
			LIB_ASSERT.strictEqual( await opened.Page.Evaluate( 'document.querySelector( ".jsonx-prompt-mark" ).textContent' ), 'jsonx' );
			await send( opened.Page, 'data count Bookings' );
			await opened.Page.WaitFor( TRANSCRIPT + '.includes( "Count" )', 20000 );
			LIB_ASSERT.match( await opened.Page.Evaluate( TRANSCRIPT ), /Count {2}counted 2/ );

			// Yes: it is sent, with yes: true, and now there is nothing left.
			await send( opened.Page, 'data delete Bookings --criteria {}' );
			// ***The second asking, not the first***: a wait which any "(y/n)" satisfied was already true, so
			// the y below was typed as an ordinary command (2026-09-16, under a whole suite's load).
			await opened.Page.WaitFor( 'document.querySelectorAll( ".jsonx-line-confirm" ).length === 2', 20000 );
			await opened.Page.WaitFor( 'document.querySelector( ".jsonx-prompt-mark" ).textContent === "y/n"', 20000 );
			await send( opened.Page, 'y' );
			// ***Waited for this command's own report***: the process's run wrote a Delete line of its own
			// earlier, which a wait for "Delete" was happy with, so the count below ran too soon (2026-09-16).
			await opened.Page.WaitFor( TRANSCRIPT + '.match( /\\(ad hoc\\)\\s+Delete/ ) !== null', 20000 );
			await send( opened.Page, 'data count Bookings' );
			await opened.Page.WaitFor( TRANSCRIPT + '.includes( "counted 0" )', 20000 );
			LIB_ASSERT.deepStrictEqual( opened.Page.Errors, [] );
		}
		finally { await opened.Served.Close(); opened.Page.Close(); }
	} );


	//---------------------------------------------------------------------
	it( 'completes from the process, and refuses what no front end sends', async function ()
	{
		let opened = await open();
		try
		{
			// Tab on a partly typed name: the process says what to insert, so the page never quotes.
			await opened.Page.Click( '#jsonx-prompt-input' );
			await opened.Page.Type( 'run "Prep' );
			await opened.Page.Press( 'Tab' );
			await opened.Page.WaitFor( PROMPT_VALUE + '.includes( "Prepare the season" )', 10000 );
			LIB_ASSERT.strictEqual( await opened.Page.Evaluate( PROMPT_VALUE ), 'run "Prepare the season"' );

			// A command no front end sends is refused, and says so.
			await opened.Page.Press( 'Escape' );
			await opened.Page.Evaluate( 'document.getElementById( "jsonx-prompt-input" ).value = ""' );
			await send( opened.Page, 'serve --api' );
			await opened.Page.WaitFor( TRANSCRIPT + '.includes( "[serve]" )', 10000 );
			LIB_ASSERT.match( await opened.Page.Evaluate( TRANSCRIPT ), /\[serve\] is not run from/ );
			LIB_ASSERT.deepStrictEqual( opened.Page.Errors, [] );
		}
		finally { await opened.Served.Close(); opened.Page.Close(); }
	} );


	//---------------------------------------------------------------------
	it( 'walks its own history with the arrow keys', async function ()
	{
		let opened = await open();
		try
		{
			await send( opened.Page, 'datasource list' );
			await send( opened.Page, 'data count Bookings' );
			await opened.Page.Click( '#jsonx-prompt-input' );

			await opened.Page.Press( 'ArrowUp' );
			LIB_ASSERT.strictEqual( await opened.Page.Evaluate( PROMPT_VALUE ), 'data count Bookings' );
			await opened.Page.Press( 'ArrowUp' );
			LIB_ASSERT.strictEqual( await opened.Page.Evaluate( PROMPT_VALUE ), 'datasource list' );
			await opened.Page.Press( 'ArrowDown' );
			LIB_ASSERT.strictEqual( await opened.Page.Evaluate( PROMPT_VALUE ), 'data count Bookings' );
			await opened.Page.Press( 'ArrowDown' );
			LIB_ASSERT.strictEqual( await opened.Page.Evaluate( PROMPT_VALUE ), '' );
		}
		finally { await opened.Served.Close(); opened.Page.Close(); }
	} );


	//---------------------------------------------------------------------
	it( 'holds a debug as a conversation, and every line is one of its commands', async function ()
	{
		let opened = await open();
		try
		{
			await send( opened.Page, 'debug "Prepare the season"' );
			await opened.Page.WaitFor( 'document.querySelector( ".jsonx-prompt-mark" ).textContent === "debug"', 20000 );
			await opened.Page.WaitFor( TRANSCRIPT + '.includes( "Run the Insert" )', 20000 );

			// ***One step, one line***: a snapshot arrives as an event and as the command's answer, and only
			// one of them is written (2026-09-16).
			let debug_lines = 'document.querySelectorAll( ".jsonx-line-debug" ).length';
			let before_ = await opened.Page.Evaluate( debug_lines );
			await send( opened.Page, 'step' );
			await opened.Page.WaitFor( debug_lines + ' > ' + before_, 20000 );
			await new Promise( function ( Resolve ) { setTimeout( Resolve, 1500 ); } );
			LIB_ASSERT.strictEqual( await opened.Page.Evaluate( debug_lines ), before_ + 1, 'one step wrote one line' );
			LIB_ASSERT.match( await opened.Page.Evaluate( TRANSCRIPT ), /Prepare the season: Run the / );

			// Quitting ends it, and the prompt goes back to taking commands.
			await send( opened.Page, 'quit' );
			await opened.Page.WaitFor( TRANSCRIPT + '.includes( "The debug ended" )', 20000 );
			LIB_ASSERT.strictEqual( await opened.Page.Evaluate( 'document.querySelector( ".jsonx-prompt-mark" ).textContent' ), 'jsonx' );
			LIB_ASSERT.deepStrictEqual( opened.Page.Errors, [] );
		}
		finally { await opened.Served.Close(); opened.Page.Close(); }
	} );

} );

