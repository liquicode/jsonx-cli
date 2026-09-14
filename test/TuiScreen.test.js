'use strict';

/*
	The TUI's screen (cut 4, step 6), driven with real keystrokes through neo-blessed on streams of its
	own, and read back as neo-blessed holds it. What it looks like in a real console is checked by hand;
	this asserts that the keys reach the model and the model reaches the panes.
*/

const LIB_ASSERT = require( 'assert' );
const LIB_FS = require( 'fs' );
const LIB_OS = require( 'os' );
const LIB_PATH = require( 'path' );
const { PassThrough } = require( 'stream' );
const { describe, it, before, after } = require( 'node:test' );

const Api = require( '../modes/api/Api.js' );
const Client = require( '../modes/tui/Client.js' );
const Model = require( '../modes/tui/Model.js' );
const Screen = require( '../modes/tui/Screen.js' );
const Held = require( '../src/Session/Held.js' );
const Parser = require( '../src/CommandLine/Parser.js' );
const Commands = require( '../commands/jsonx.js' );
const jsonx_cli = require( '../src/jsonx-cli.js' );
const Spec = require( './fixtures/Spec.js' );


const KEYS = { Enter: '\r', Tab: '\t', ShiftTab: '\x1b[Z', Escape: '\x1b', F1: '\x1bOP', F2: '\x1bOQ', F3: '\x1bOR', F5: '\x1b[15~', CtrlQ: '\x11' };

// SGR mouse events at a 0-based column and row. ***A press and its release are written separately***:
// neo-blessed reads one mouse sequence from each chunk of input (measured), as a terminal sends them.
function press( Column, Row ) { return '\x1b[<0;' + ( Column + 1 ) + ';' + ( Row + 1 ) + 'M'; }
function release( Column, Row ) { return '\x1b[<0;' + ( Column + 1 ) + ';' + ( Row + 1 ) + 'm'; }
function wheel_down( Column, Row ) { return '\x1b[<65;' + ( Column + 1 ) + ';' + ( Row + 1 ) + 'M'; }


//---------------------------------------------------------------------
function wait( Ms ) { return new Promise( function ( Resolve ) { setTimeout( Resolve, Ms ); } ); }

async function until( Test, Label )
{
	for ( let waited = 0; waited < 5000; waited += 25 )
	{
		if ( Test() ) { return; }
		await wait( 25 );
	}
	throw new Error( 'Timed out waiting: ' + Label );
}

// A served Appendix B, a started model over it, and the screen on streams, 120 by 40.
// Terminal is the name neo-blessed is given, `xterm` when absent; everything written is kept in Written.
async function open_screen( Root, Name, Terminal )
{
	let file = LIB_PATH.join( Root, Name );
	LIB_FS.writeFileSync( file, JSON.stringify( Spec.AppendixB(), null, '\t' ) );
	let io = Parser.DefaultIo();
	io.Env = {};
	io.Cwd = Root;
	let held = Held.NewHeld( { Tree: Commands.TREE, File: file, Io: io } );
	let server = await Api.Listen( Api.NewApi( held, { Host: '127.0.0.1', Version: jsonx_cli.Version } ), '127.0.0.1', 0 );
	let url = 'ws://127.0.0.1:' + server.address().port + '/ws';
	let client = Client.NewClient( { Url: url } );
	let model = Model.NewModel( { Client: client, Url: url, Tree: Commands.TREE, Version: jsonx_cli.Version, Io: io, SettingsPath: LIB_PATH.join( Root, Name + '.settings.json' ) } );
	await model.Start();

	let input = new PassThrough();
	input.isTTY = true;
	input.setRawMode = function () { return; };
	let output = new PassThrough();
	output.isTTY = true;
	output.columns = 120;
	output.rows = 40;

	let opened = { Model: model, Held: held, Screen: null, Widgets: null, Finish: null, Written: '' };
	output.on( 'data', function ( Chunk ) { opened.Written += Chunk.toString(); } );
	opened.Running = Screen.Run( model, { Input: input, Output: output, Terminal: Terminal, CheckDelayMs: 50, OnScreen: function ( S, W, Finish ) { opened.Screen = S; opened.Widgets = W; opened.Finish = Finish; } } );
	opened.Type = async function ( Text ) { input.write( Text ); await wait( 60 ); };
	opened.Click = async function ( Column, Row ) { await opened.Type( press( Column, Row ) ); await opened.Type( release( Column, Row ) ); };
	// Which pane has focus, by name: comparing widgets themselves makes a failing assertion print them.
	opened.Focused = function ()
	{
		let widgets = opened.Widgets;
		return [ 'inventory', 'log', 'rows', 'input' ].find( function ( Name ) { return opened.Screen.focused === widgets[ Name ]; } ) || 'other';
	};
	opened.Text = function ()
	{
		return opened.Screen.lines.map( function ( Line ) { return Line.map( function ( Cell ) { return Cell[ 1 ]; } ).join( '' ).replace( /\s+$/, '' ); } );
	};
	opened.Close = async function ()
	{
		if ( opened.Finish ) { opened.Finish( 0 ); }
		await opened.Running;
		client.Close();
		await Api.Close( server );
		await held.Release();
	};
	await wait( 100 );
	return opened;
}


//---------------------------------------------------------------------
describe( 'The TUI screen', function ()
{

	let root = null;

	before( function () { root = LIB_FS.mkdtempSync( LIB_PATH.join( LIB_OS.tmpdir(), 'jsonx-tuiscreen-' ) ); } );
	after( function () { LIB_FS.rmSync( root, { recursive: true, force: true } ); } );


	it( 'draws the four panes and the status line, with the file\'s inventory', { timeout: 20000 }, async function ()
	{
		let opened = await open_screen( root, 'draw.jsonx' );
		try
		{
			let text = opened.Text();
			LIB_ASSERT.match( text[ 0 ], /┌─ Inventory ─+┐┌─ Log ─+┐/ );
			LIB_ASSERT.ok( text.some( function ( Line ) { return /┌─ Data Rows ─/.test( Line ); } ), text.join( '\n' ) );
			LIB_ASSERT.ok( text.some( function ( Line ) { return /┌─ Input - Enter sends, Tab completes, Esc or Shift\+Tab leaves/.test( Line ); } ), text.join( '\n' ) );
			LIB_ASSERT.ok( text.some( function ( Line ) { return /│ {2}Process Prepare the season/.test( Line ); } ), text.join( '\n' ) );
			LIB_ASSERT.match( text[ 39 ], /draw\.jsonx {2}\| {2}connected {2}\| {2}queue free/ );
		}
		finally { await opened.Close(); }
	} );

	it( 'sends a typed command once, and shows its report and its rows', { timeout: 20000 }, async function ()
	{
		let opened = await open_screen( root, 'type.jsonx' );
		try
		{
			await opened.Type( 'run "Prepare the season"' );
			await opened.Type( KEYS.Enter );
			await until( function () { return opened.Model.State.Rows.Rows.length > 0 && opened.Model.State.Busy === 0; }, 'the run' );
			await wait( 150 );
			// ***One Enter is two keypresses in neo-blessed***; the command must run once, and the second
			// run of this Process would fail on its inserts.
			LIB_ASSERT.strictEqual( opened.Model.State.Log.filter( function ( Line ) { return Line.Kind === 'command'; } ).length, 1 );
			LIB_ASSERT.ok( !opened.Model.State.Log.some( function ( Line ) { return Line.Kind === 'error'; } ), JSON.stringify( opened.Model.State.Log ) );
			let text = opened.Text().join( '\n' );
			LIB_ASSERT.match( text, /Prepare the season {2}Process {2}ran once/ );
			LIB_ASSERT.match( text, /b-1 +R\. Okafor +B/ );
			LIB_ASSERT.strictEqual( opened.Model.State.Input.Text, '', 'Input is cleared after a command which parsed' );
		}
		finally { await opened.Close(); }
	} );

	it( 'completes with Tab in Input', { timeout: 20000 }, async function ()
	{
		let opened = await open_screen( root, 'complete.jsonx' );
		try
		{
			await opened.Type( 'run Pre' );
			await opened.Type( KEYS.Tab );
			await wait( 50 );
			LIB_ASSERT.strictEqual( opened.Model.State.Input.Text, 'run "Prepare the season"' );
			LIB_ASSERT.ok( opened.Text().some( function ( Line ) { return Line.includes( 'run "Prepare the season"' ); } ) );

			// Several candidates: a list to choose from, which hears the keys while Input holds its text.
			for ( let count = 0; count < 24; count++ ) { await opened.Type( '\x7f' ); }
			await opened.Type( 'data count ' );
			await opened.Type( KEYS.Tab );
			await until( function () { return opened.Text().some( function ( Line ) { return /─ Complete ─/.test( Line ); } ); }, 'the list of candidates' );
			await opened.Type( '\x1b[B' );
			await opened.Type( KEYS.Enter );
			await until( function () { return opened.Model.State.Input.Text !== 'data count '; }, 'the chosen candidate' );
			LIB_ASSERT.strictEqual( opened.Model.State.Input.Text, 'data count Bookings' );
		}
		finally { await opened.Close(); }
	} );

	it( 'asks before a command which touches every document, and sends nothing on n', { timeout: 20000 }, async function ()
	{
		let opened = await open_screen( root, 'confirm.jsonx' );
		try
		{
			await opened.Type( 'data delete Telescopes --criteria {}' );
			await opened.Type( KEYS.Enter );
			await until( function () { return opened.Model.State.Confirm !== null; }, 'the confirmation' );
			await wait( 50 );
			LIB_ASSERT.ok( opened.Text().some( function ( Line ) { return /Confirm/.test( Line ); } ) );
			LIB_ASSERT.ok( opened.Text().some( function ( Line ) { return /y send it +n do not/.test( Line ); } ), opened.Text().join( '\n' ) );
			await opened.Type( 'n' );
			await until( function () { return opened.Model.State.Confirm === null; }, 'the confirmation closed' );
			LIB_ASSERT.ok( opened.Model.State.Log.some( function ( Line ) { return Line.Text === 'Not sent.'; } ) );
			LIB_ASSERT.ok( !opened.Text().some( function ( Line ) { return /y send it/.test( Line ); } ) );
		}
		finally { await opened.Close(); }
	} );

	it( 'answers the keys which work everywhere from inside Input, with nothing pressed first', { timeout: 20000 }, async function ()
	{
		let opened = await open_screen( root, 'global.jsonx' );
		try
		{
			// Input has focus, as it has when the TUI opens.
			LIB_ASSERT.strictEqual( opened.Focused(), 'input' );
			await opened.Type( 'run' );
			LIB_ASSERT.strictEqual( opened.Model.State.Input.Text, 'run' );

			await opened.Type( KEYS.F2 );
			LIB_ASSERT.strictEqual( opened.Model.State.View.Theme, 'light' );
			await opened.Type( KEYS.F1 );
			await until( function () { return opened.Text().some( function ( Line ) { return /─ Help - Esc closes ─/.test( Line ); } ); }, 'the help popup' );
			await opened.Type( KEYS.Escape );
			await until( function () { return !opened.Text().some( function ( Line ) { return /Help - Esc closes/.test( Line ); } ); }, 'help closed' );
			LIB_ASSERT.strictEqual( opened.Model.State.Input.Text, 'run', 'Input kept its text through the popup' );

			// Shift+Tab leaves Input, and the keys then go to where focus went, not into Input.
			await opened.Type( KEYS.ShiftTab );
			LIB_ASSERT.strictEqual( opened.Focused(), 'rows' );
			await opened.Type( 'zz' );
			LIB_ASSERT.strictEqual( opened.Model.State.Input.Text, 'run' );

			// Back into Input, and Ctrl+Q from there quits.
			await opened.Type( KEYS.Tab );
			LIB_ASSERT.strictEqual( opened.Focused(), 'input' );
			await opened.Type( ' x' );
			LIB_ASSERT.strictEqual( opened.Model.State.Input.Text, 'run x' );
			await opened.Type( KEYS.CtrlQ );
			LIB_ASSERT.strictEqual( await opened.Running, 0 );
			opened.Finish = null;
		}
		finally { await opened.Close(); }
	} );

	it( 'takes the mouse: a click focuses a pane, selects and opens an entry, and the wheel scrolls', { timeout: 20000 }, async function ()
	{
		// ***As a Windows console with no TERM***, for which neo-blessed asks for no mouse reports itself
		// (the user found the mouse dead there, 2026-09-14, while this case passed as `xterm`).
		let opened = await open_screen( root, 'mouse.jsonx', 'windows-ansi' );
		try
		{
			// The terminal is asked for presses, releases and drags as SGR, and not for every move.
			LIB_ASSERT.ok( opened.Written.includes( '\x1b[?1000h' ), 'presses and releases asked for' );
			LIB_ASSERT.ok( opened.Written.includes( '\x1b[?1002h' ), 'drags asked for' );
			LIB_ASSERT.ok( opened.Written.includes( '\x1b[?1006h' ), 'SGR asked for' );
			LIB_ASSERT.ok( !opened.Written.includes( '\x1b[?1003h' ), 'every move not asked for' );
			LIB_ASSERT.ok( !opened.Written.includes( '\x1b[?1005h' ), 'UTF-8 reports not asked for' );

			let text = opened.Text();
			let row = text.findIndex( function ( Line ) { return /│ {2}Process Prepare the season/.test( Line ); } );
			LIB_ASSERT.ok( row > 0, text.join( '\n' ) );

			// From Input, a click on the entry: focus moves to Inventory, and the entry is selected.
			await opened.Click( 12, row );
			LIB_ASSERT.strictEqual( opened.Focused(), 'inventory' );
			LIB_ASSERT.strictEqual( opened.Widgets.inventory.Names[ opened.Widgets.inventory.selected ], 'Prepare the season' );
			await opened.Type( 'q' );
			LIB_ASSERT.strictEqual( opened.Model.State.Input.Text, '', 'what is typed goes where focus went' );

			// A second click opens it: the entry is in Input, and Input has focus.
			await opened.Click( 12, row );
			await until( function () { return opened.Model.State.Input.Mode === 'json'; }, 'the entry in Input' );
			LIB_ASSERT.strictEqual( JSON.parse( opened.Model.State.Input.Text ).Name, 'Prepare the season' );
			LIB_ASSERT.strictEqual( opened.Focused(), 'input' );

			// The wheel over Inventory moves its selection.
			let before = opened.Widgets.inventory.selected;
			await opened.Type( wheel_down( 12, 3 ) );
			LIB_ASSERT.notStrictEqual( opened.Widgets.inventory.selected, before );

			// A click on Data Rows focuses it; a click on Input, and typing there, types.
			await opened.Click( 40, 20 );
			LIB_ASSERT.strictEqual( opened.Focused(), 'rows' );
			let input_row = opened.Text().findIndex( function ( Line ) { return /┌─ Input/.test( Line ); } );
			await opened.Click( 10, input_row + 1 );
			LIB_ASSERT.strictEqual( opened.Focused(), 'input' );
			let held_text = opened.Model.State.Input.Text;
			await opened.Type( ' ' );
			LIB_ASSERT.strictEqual( opened.Model.State.Input.Text, held_text + ' ' );
		}
		finally { await opened.Close(); }
	} );

	it( 'changes scale, theme and collapsed panes from the keys, and quits on Ctrl+Q', { timeout: 20000 }, async function ()
	{
		let opened = await open_screen( root, 'view.jsonx' );
		try
		{
			await opened.Type( KEYS.Escape );
			await opened.Type( KEYS.F3 );
			LIB_ASSERT.strictEqual( opened.Model.State.View.Scale, 'large' );
			await opened.Type( KEYS.F3 );
			LIB_ASSERT.strictEqual( opened.Model.State.View.Scale, 'small' );
			await wait( 50 );
			LIB_ASSERT.ok( !opened.Text()[ 0 ].includes( '┌' ), 'small draws no borders: ' + opened.Text()[ 0 ] );
			await opened.Type( KEYS.F3 );
			LIB_ASSERT.strictEqual( opened.Model.State.View.Scale, 'normal' );
			await wait( 50 );
			LIB_ASSERT.match( opened.Text()[ 0 ], /┌─ Inventory/ );

			await opened.Type( KEYS.F2 );
			LIB_ASSERT.strictEqual( opened.Model.State.View.Theme, 'light' );

			await opened.Type( KEYS.F5 );
			LIB_ASSERT.strictEqual( opened.Model.State.View.Collapsed.Inventory, true );
			await wait( 50 );
			LIB_ASSERT.match( opened.Text()[ 0 ], /^┌─ Log/ );
			LIB_ASSERT.match( opened.Text()[ 39 ], /light\/normal/ );

			input_quit: {
				await opened.Type( KEYS.CtrlQ );
				LIB_ASSERT.strictEqual( await opened.Running, 0 );
				opened.Finish = null;
			}
		}
		finally { await opened.Close(); }
	} );

} );
