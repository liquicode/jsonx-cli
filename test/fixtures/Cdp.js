'use strict';

/*
	A real browser for the Web UI's tests (cut 5, decision 2): the installed Chrome or Edge, spawned
	headless as jsonstor-docs' browser-runner spawns it, and driven over the DevTools protocol with Node
	22's own WebSocket. No dependency.

	-	***Real input***: keys go through Input.dispatchKeyEvent and clicks through
		Input.dispatchMouseEvent at an element's centre, so the page hears what a person's keys and clicks
		make (measured 2026-09-14: typed characters arrive as keydowns, a dispatched click registers).
	-	***A fresh profile per browser, deleted afterwards***: a profile kept between runs would let a page
		answer out of a previous run's storage. A cold profile costs 11-14 s, so a test file starts one
		browser and opens its pages in it.
	-	***No browser installed is a failure naming the paths tried***, never a skip: a green run must mean
		a page was driven.
*/

const LIB_CHILD_PROCESS = require( 'child_process' );
const LIB_FS = require( 'fs' );
const LIB_OS = require( 'os' );
const LIB_PATH = require( 'path' );


// browser-runner's list, in its order.
const BROWSERS = [
	'C:/Program Files/Google/Chrome/Application/chrome.exe',
	'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
	'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
	'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
	'/usr/bin/google-chrome',
	'/usr/bin/chromium',
	'/usr/bin/chromium-browser',
	'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
];

// What a named key sends: its key, code and Windows virtual key code, and the text it types.
const KEYS = {
	Enter: { key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13, text: '\r' },
	Tab: { key: 'Tab', code: 'Tab', windowsVirtualKeyCode: 9 },
	Escape: { key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 },
	Backspace: { key: 'Backspace', code: 'Backspace', windowsVirtualKeyCode: 8 },
	Delete: { key: 'Delete', code: 'Delete', windowsVirtualKeyCode: 46 },
	ArrowUp: { key: 'ArrowUp', code: 'ArrowUp', windowsVirtualKeyCode: 38 },
	ArrowDown: { key: 'ArrowDown', code: 'ArrowDown', windowsVirtualKeyCode: 40 },
	ArrowLeft: { key: 'ArrowLeft', code: 'ArrowLeft', windowsVirtualKeyCode: 37 },
	ArrowRight: { key: 'ArrowRight', code: 'ArrowRight', windowsVirtualKeyCode: 39 },
	PageUp: { key: 'PageUp', code: 'PageUp', windowsVirtualKeyCode: 33 },
	PageDown: { key: 'PageDown', code: 'PageDown', windowsVirtualKeyCode: 34 },
	Home: { key: 'Home', code: 'Home', windowsVirtualKeyCode: 36 },
	End: { key: 'End', code: 'End', windowsVirtualKeyCode: 35 },
	F1: { key: 'F1', code: 'F1', windowsVirtualKeyCode: 112 },
	Space: { key: ' ', code: 'Space', windowsVirtualKeyCode: 32, text: ' ' },
};

// CDP's modifier bits.
const MODIFIERS = { Alt: 1, Control: 2, Meta: 4, Shift: 8 };


//---------------------------------------------------------------------
function wait( Ms ) { return new Promise( function ( Resolve ) { setTimeout( Resolve, Ms ); } ); }

function FindBrowser()
{
	let found = BROWSERS.find( function ( Path ) { return LIB_FS.existsSync( Path ); } );
	if ( !found ) { throw new Error( 'No Chrome or Edge is installed where the Web UI tests look: ' + BROWSERS.join( ', ' ) ); }
	return found;
}


//---------------------------------------------------------------------
// One page target: commands, events, and the input a person makes.

async function open_target( WebSocketUrl )
{
	let socket = new WebSocket( WebSocketUrl );
	await new Promise( function ( Resolve, Reject )
	{
		socket.onopen = Resolve;
		socket.onerror = function () { Reject( new Error( 'The DevTools connection did not open.' ) ); };
	} );

	let next_id = 0;
	let pending = {};
	let listeners = [];
	let page = { Console: [], Errors: [] };

	socket.onmessage = function ( Message )
	{
		let message = JSON.parse( String( Message.data ) );
		if ( typeof message.id === 'number' && pending[ message.id ] )
		{
			let request = pending[ message.id ];
			delete pending[ message.id ];
			if ( message.error ) { request.Reject( new Error( message.error.message ) ); }
			else { request.Resolve( message.result ); }
			return;
		}
		if ( message.method === 'Runtime.consoleAPICalled' )
		{
			let text = ( message.params.args || [] ).map( function ( Arg ) { return ( typeof Arg.value !== 'undefined' ) ? String( Arg.value ) : ( Arg.description || '' ); } ).join( ' ' );
			page.Console.push( { Type: message.params.type, Text: text } );
			if ( message.params.type === 'error' ) { page.Errors.push( text ); }
		}
		if ( message.method === 'Runtime.exceptionThrown' )
		{
			let details = message.params.exceptionDetails || {};
			page.Errors.push( ( details.exception && details.exception.description ) || details.text || 'an exception' );
		}
		if ( message.method === 'Log.entryAdded' && message.params.entry.level === 'error' )
		{
			page.Errors.push( message.params.entry.text + ( message.params.entry.url ? ' (' + message.params.entry.url + ')' : '' ) );
		}
		listeners.slice().forEach( function ( Listener ) { Listener( message ); } );
		return;
	};

	// Hears every DevTools event of the page: { method, params }.
	page.OnEvent = function ( Listener )
	{
		listeners.push( Listener );
		return;
	};

	page.Send = function ( Method, Params )
	{
		next_id++;
		let id = next_id;
		return new Promise( function ( Resolve, Reject )
		{
			pending[ id ] = { Resolve: Resolve, Reject: Reject };
			socket.send( JSON.stringify( { id: id, method: Method, params: Params || {} } ) );
		} );
	};

	// The value of an expression in the page; a promise it gives is awaited.
	page.Evaluate = async function ( Expression )
	{
		let result = await page.Send( 'Runtime.evaluate', { expression: Expression, returnByValue: true, awaitPromise: true } );
		if ( result.exceptionDetails )
		{
			let details = result.exceptionDetails;
			throw new Error( 'In the page: ' + ( ( details.exception && details.exception.description ) || details.text ) );
		}
		return result.result ? result.result.value : undefined;
	};

	// Resolves when the expression is truthy; rejects, naming it, when it is not within the time.
	page.WaitFor = async function ( Expression, TimeoutMs )
	{
		let limit = Date.now() + ( TimeoutMs || 10000 );
		while ( Date.now() < limit )
		{
			let value = await page.Evaluate( Expression );
			if ( value ) { return value; }
			await wait( 50 );
		}
		throw new Error( 'The page did not come to [' + Expression + '] within ' + ( TimeoutMs || 10000 ) + ' ms. Errors: ' + JSON.stringify( page.Errors ) );
	};

	page.Navigate = async function ( Url )
	{
		let loaded = new Promise( function ( Resolve )
		{
			let listener = function ( Message ) { if ( Message.method === 'Page.loadEventFired' ) { listeners.splice( listeners.indexOf( listener ), 1 ); Resolve(); } };
			listeners.push( listener );
		} );
		await page.Send( 'Page.navigate', { url: Url } );
		await loaded;
		return;
	};

	// Typed text, one character at a time, as keydowns with text.
	page.Type = async function ( Text )
	{
		for ( let ch of String( Text ) )
		{
			await page.Send( 'Input.dispatchKeyEvent', { type: 'keyDown', key: ch, text: ch, unmodifiedText: ch } );
			await page.Send( 'Input.dispatchKeyEvent', { type: 'keyUp', key: ch } );
		}
		return;
	};

	// A named key (KEYS), or a character, with modifiers: Press( 's', [ 'Control' ] ).
	page.Press = async function ( Key, Modifiers )
	{
		let modifiers = ( Modifiers || [] ).reduce( function ( Bits, Name ) { return Bits | ( MODIFIERS[ Name ] || 0 ); }, 0 );
		let named = KEYS[ Key ];
		let base = named
			? Object.assign( {}, named )
			: { key: Key, code: 'Key' + String( Key ).toUpperCase(), windowsVirtualKeyCode: String( Key ).toUpperCase().charCodeAt( 0 ), text: Key };
		// A character typed with Control or Alt makes no text.
		if ( modifiers & ( MODIFIERS.Control | MODIFIERS.Alt | MODIFIERS.Meta ) ) { delete base.text; }
		await page.Send( 'Input.dispatchKeyEvent', Object.assign( { type: base.text ? 'keyDown' : 'rawKeyDown', modifiers: modifiers }, base ) );
		await page.Send( 'Input.dispatchKeyEvent', Object.assign( { type: 'keyUp', modifiers: modifiers }, base, { text: undefined } ) );
		return;
	};

	// A click at the centre of the first element the selector finds. ClickCount 2 is a double click.
	page.Click = async function ( Selector, ClickCount )
	{
		let box = await page.Evaluate( '( function () { let e = document.querySelector( ' + JSON.stringify( Selector ) + ' ); if ( !e ) { return null; } e.scrollIntoView( { block: "center" } ); let r = e.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2, w: r.width, h: r.height }; } )()' );
		if ( !box ) { throw new Error( 'Nothing on the page matches [' + Selector + '].' ); }
		if ( box.w === 0 || box.h === 0 ) { throw new Error( 'The element [' + Selector + '] is not visible.' ); }
		let count = ClickCount || 1;
		for ( let index = 1; index <= count; index++ )
		{
			await page.Send( 'Input.dispatchMouseEvent', { type: 'mousePressed', x: box.x, y: box.y, button: 'left', clickCount: index } );
			await page.Send( 'Input.dispatchMouseEvent', { type: 'mouseReleased', x: box.x, y: box.y, button: 'left', clickCount: index } );
		}
		return;
	};

	page.Close = function ()
	{
		try { socket.close(); } catch ( error ) { /* already closed */ }
		return;
	};

	await page.Send( 'Page.enable' );
	await page.Send( 'Runtime.enable' );
	await page.Send( 'Log.enable' );
	return page;
}


//---------------------------------------------------------------------
// Starts the browser. Resolves with { Browser, Version, OpenPage( Url ), Close() }.

async function StartBrowser( Options )
{
	let options = Options || {};
	let browser = FindBrowser();
	let profile = LIB_FS.mkdtempSync( LIB_PATH.join( LIB_OS.tmpdir(), 'jsonx-cdp-' ) );
	let args = [
		'--remote-debugging-port=0',
		'--user-data-dir=' + profile,
		'--no-first-run',
		'--no-default-browser-check',
		'--disable-extensions',
		'--window-size=' + ( options.Width || 1280 ) + ',' + ( options.Height || 900 ),
		'about:blank',
	];
	if ( !options.Show ) { args.unshift( '--headless=new' ); }
	let child = LIB_CHILD_PROCESS.spawn( browser, args, { stdio: 'ignore' } );
	let exited = new Promise( function ( Resolve ) { child.on( 'exit', Resolve ); } );

	let port_file = LIB_PATH.join( profile, 'DevToolsActivePort' );
	for ( let waited = 0; waited < 30000 && !LIB_FS.existsSync( port_file ); waited += 100 ) { await wait( 100 ); }
	if ( !LIB_FS.existsSync( port_file ) ) { child.kill(); throw new Error( browser + ' did not start its DevTools within 30 s.' ); }
	let port = null;
	for ( let waited = 0; waited < 5000 && !port; waited += 50 )
	{
		port = LIB_FS.readFileSync( port_file, 'utf8' ).split( /\r?\n/ )[ 0 ].trim();
		if ( !port ) { await wait( 50 ); }
	}
	let base = 'http://127.0.0.1:' + port;
	let version = await ( await fetch( base + '/json/version' ) ).json();
	let pages = [];

	return {
		Browser: browser,
		Version: version.Browser,

		// A new tab at the address.
		OpenPage: async function ( Url )
		{
			let target = await ( await fetch( base + '/json/new?about:blank', { method: 'PUT' } ) ).json();
			let page = await open_target( target.webSocketDebuggerUrl );
			page.TargetId = target.id;
			pages.push( page );
			if ( Url ) { await page.Navigate( Url ); }
			return page;
		},

		Close: async function ()
		{
			pages.forEach( function ( Page ) { Page.Close(); } );
			child.kill();
			await Promise.race( [ exited, wait( 5000 ) ] );
			// The browser lets go of its profile a moment after it exits.
			for ( let attempt = 0; attempt < 20; attempt++ )
			{
				try { LIB_FS.rmSync( profile, { recursive: true, force: true } ); break; }
				catch ( error ) { await wait( 250 ); }
			}
			return;
		},
	};
}


//---------------------------------------------------------------------
module.exports = {
	BROWSERS: BROWSERS,
	KEYS: KEYS,
	FindBrowser: FindBrowser,
	StartBrowser: StartBrowser,
};
