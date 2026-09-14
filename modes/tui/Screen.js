'use strict';

/*
	The TUI's screen (plan F4.4, F5): neo-blessed drawing the model (modes/tui/Model.js) and handing
	it keys. ***Nothing here decides anything a test needs a terminal to reach***; every action is a
	call on the model.

	neo-blessed was chosen by measurement (cut 4, step 4; user, 2026-09-14): it behaved as blessed did
	in Windows PowerShell 5.1's console and in Windows Terminal, and its ListTable keeps the selected
	row when Data Rows replaces its rows.

		Tab / Shift+Tab   move between Inventory, Log, Data Rows and Input (in Input, Tab completes)
		Enter             Inventory: put the entry in Input.  Data Rows: the row as JSON.
		                  Input: send a command; in a JSON entry, a new line
		Ctrl+S            Input: save the JSON entry
		Escape            Input: leave it for Inventory
		PgUp / PgDn       Data Rows: the previous or next page of a find
		F1 help   F2 theme   F3 scale   F5 / F6 / F7 collapse Inventory / Log / Data Rows
		Ctrl+Q            quit
		While debugging, outside Input:  s step  i into  c continue  d decline  t state  k skip  x quit
		Mouse             click a pane to work in it; in Inventory and Data Rows, click an entry to
		                  select it and again to open it; the wheel scrolls

	***Input is a box this screen edits, not neo-blessed's textarea*** (user found, 2026-09-14: no hotkey
	worked from Input, and Input could not be left). Measured in neo-blessed 0.2.0's textarea.js:
	-	while it reads it sets screen.grabKeys, and the screen's key handlers then run only for keys listed
		in ignoreLocked
	-	with inputOnFocus, reading which ends rewinds focus to the pane before, so every move away from
		Input is pulled back
	-	it attaches its key listener on the next tick, so reading ended and begun again within one key's
		handling attaches two, and every character typed after is doubled
	-	its arrow keys are a TODO: text is only ever typed at the end
	So Input here holds its text, appends what is typed, and never takes the keyboard from the screen:
	the keys which work everywhere work in Input too, with no list to keep.

	***Scale in a terminal is density, not font size***: the terminal owns the font. `small` draws no
	borders, `normal` draws them, and `large` adds padding and a taller Input. ***A change of scale
	rebuilds the panes***, because a widget's inner size is worked out from its border and padding when
	it is made.
*/

const THEMES = {
	dark: { fg: 'white', bg: 'black', border: 'cyan', focus: 'yellow', dim: 'gray', status_fg: 'black', status_bg: 'cyan', error: 'red', warning: 'yellow', note: 'blue', selected_fg: 'black', selected_bg: 'cyan' },
	light: { fg: 'black', bg: 'white', border: 'blue', focus: 'magenta', dim: 'gray', status_fg: 'white', status_bg: 'blue', error: 'red', warning: 'magenta', note: 'blue', selected_fg: 'white', selected_bg: 'blue' },
};

const BADGES = { error: '✖', warning: '!', note: '·' };

const DEBUG_KEYS = { s: 'step', i: 'into', c: 'continue', d: 'decline', t: 'state', k: 'skip', x: 'quit' };

const INPUT_HEIGHT = { small: 2, normal: 5, large: 7 };

// Where the next character typed into Input goes.
const CURSOR = '▏';

const CELL_WIDTH = 30;
const CHECK_DELAY_MS = 400;

const HELP_TEXT = [
	'Tab / Shift+Tab   move between the panes; in Input, Tab completes',
	'Enter             Inventory: put the entry in Input',
	'                  Data Rows: the row as JSON',
	'                  Input: send a command (in a JSON entry: a new line)',
	'Ctrl+S            save the JSON entry in Input',
	'Escape            leave Input',
	'PgUp / PgDn       the previous or next page of a find',
	'F2 theme   F3 scale   F5 / F6 / F7 collapse Inventory / Log / Data Rows',
	'Ctrl+Q            quit',
	'Mouse             click a pane to work in it; click an entry or a row to select it,',
	'                  and again to open it; the wheel scrolls',
	'',
	'Debugging, outside Input:',
	'  s step  i into  c continue  d decline  t state  k skip  x quit',
	'',
	'Type a command as on the command line: run "Prepare the season"',
	'or a JSON entry: { "Kind": "Query", "Name": "...", "DataSource": "..." }',
].join( '\n' );


//---------------------------------------------------------------------
function cell( Value )
{
	let text = ( typeof Value === 'string' ) ? Value : ( typeof Value === 'undefined' ? '' : JSON.stringify( Value ) );
	text = String( text ).replace( /\s+/g, ' ' );
	return ( text.length > CELL_WIDTH ) ? text.slice( 0, CELL_WIDTH - 1 ) + '…' : text;
}

function escape_tags( Text )
{
	return String( Text ).replace( /[{}]/g, function ( Brace ) { return Brace === '{' ? '{open}' : '{close}'; } );
}

// A character a person typed, as opposed to a control or function key.
function typed( Ch, Key )
{
	if ( typeof Ch !== 'string' || Ch === '' ) { return false; }
	if ( Key && ( Key.ctrl || Key.meta ) ) { return false; }
	return !/[\x00-\x1f\x7f]/.test( Ch );
}


//---------------------------------------------------------------------
// Options:
//		Blessed          the library (neo-blessed when absent)
//		Input, Output    streams, for a test; the process's when absent
//		CheckDelayMs     how long typing pauses before a live check
//		OnScreen         function ( Screen, Widgets, Finish ): once drawn, for a test to read and quit it
//
// Resolves with the exit code when the person quits.

function Run( Model, Options )
{
	let options = ( Options && typeof Options === 'object' ) ? Options : {};
	let blessed = options.Blessed || require( 'neo-blessed' );
	let state = Model.State;
	let check_delay = ( typeof options.CheckDelayMs === 'number' ) ? options.CheckDelayMs : CHECK_DELAY_MS;

	return new Promise( function ( Resolve )
	{
		let screen_options = { smartCSR: true, fullUnicode: true, autoPadding: true, title: 'jsonx ' + ( state.File || '' ) };
		if ( options.Input ) { screen_options.input = options.Input; }
		if ( options.Output ) { screen_options.output = options.Output; screen_options.terminal = options.Terminal || 'xterm'; }
		let screen = blessed.screen( screen_options );

		// One object whose members are replaced when the panes are rebuilt, so a reader keeps it.
		let widgets = {};
		let built_scale = null;
		let popup = null;
		let check_timer = null;
		let finished = false;
		let focus_index = 3;

		function theme() { return THEMES[ state.View.Theme ] || THEMES.dark; }
		function order() { return [ widgets.inventory, widgets.log, widgets.rows, widgets.input ]; }


		//---------------------------------------------------------------------
		// Building the panes for the scale in the view.

		function build()
		{
			for ( let name of Object.keys( widgets ) ) { widgets[ name ].destroy(); delete widgets[ name ]; }
			let scale = state.View.Scale;
			built_scale = scale;
			let frame = {
				border: ( scale === 'small' ) ? undefined : { type: 'line' },
				padding: ( scale === 'large' ) ? { left: 1, right: 1 } : 0,
			};
			let common = { parent: screen, keys: true, mouse: true, clickable: true };

			widgets.inventory = blessed.list( Object.assign( { tags: true, label: ' Inventory ' }, common, frame ) );
			widgets.log = blessed.box( Object.assign( { tags: true, scrollable: true, alwaysScroll: true, label: ' Log ' }, common, frame ) );
			widgets.rows = blessed.listtable( Object.assign( { interactive: true, noCellBorders: true, align: 'left', label: ' Data Rows ' }, common, frame ) );
			widgets.input = blessed.box( Object.assign( { tags: false, scrollable: true, alwaysScroll: true, label: ' Input ' }, common, frame ) );
			widgets.status = blessed.box( { parent: screen, bottom: 0, left: 0, height: 1, width: '100%', tags: true } );

			bind();
			return;
		}


		//---------------------------------------------------------------------
		// Layout and colours from the view.

		function layout()
		{
			let collapsed = state.View.Collapsed;
			let input_height = INPUT_HEIGHT[ state.View.Scale ] || INPUT_HEIGHT.normal;
			let body = '100%-' + ( input_height + 1 );

			Object.assign( widgets.input, { bottom: 1, left: 0, width: '100%', height: input_height } );

			widgets.inventory.hidden = collapsed.Inventory;
			Object.assign( widgets.inventory, { top: 0, left: 0, width: '30%', height: body } );

			let left = collapsed.Inventory ? 0 : '30%';
			let width = collapsed.Inventory ? '100%' : '70%';
			widgets.log.hidden = collapsed.Log;
			widgets.rows.hidden = collapsed.Rows;
			if ( !collapsed.Log && !collapsed.Rows )
			{
				Object.assign( widgets.log, { top: 0, left: left, width: width, height: '40%' } );
				Object.assign( widgets.rows, { top: '40%', left: left, width: width, height: '60%-' + ( input_height + 1 ) } );
			}
			else
			{
				Object.assign( widgets.log, { top: 0, left: left, width: width, height: body } );
				Object.assign( widgets.rows, { top: 0, left: left, width: width, height: body } );
			}
			return;
		}

		function colour()
		{
			let t = theme();
			for ( let widget of order() )
			{
				widget.style.fg = t.fg;
				widget.style.bg = t.bg;
				widget.style.border = { fg: ( widget === screen.focused ) ? t.focus : t.border, bg: t.bg };
				widget.style.label = { fg: ( widget === screen.focused ) ? t.focus : t.border, bg: t.bg };
			}
			widgets.inventory.style.selected = { fg: t.selected_fg, bg: t.selected_bg };
			widgets.inventory.style.item = { fg: t.fg, bg: t.bg };
			widgets.rows.style.header = { fg: t.border, bg: t.bg, bold: true };
			widgets.rows.style.cell = { fg: t.fg, bg: t.bg, selected: { fg: t.selected_fg, bg: t.selected_bg } };
			widgets.status.style.fg = t.status_fg;
			widgets.status.style.bg = t.status_bg;
			return;
		}


		//---------------------------------------------------------------------
		// Drawing the state.

		let drawn = { Inventory: null, LogLength: -1, Rows: null, RowsValue: undefined };

		function draw()
		{
			if ( finished ) { return; }
			if ( state.View.Scale !== built_scale )
			{
				build();
				drawn = { Inventory: null, LogLength: -1, Rows: null, RowsValue: undefined };
				focus( focus_index );
			}
			let t = theme();
			layout();
			colour();

			// Inventory: section headings, then entries with their badges.
			let lines = [];
			let names = [];
			let section = null;
			state.Inventory.forEach( function ( Item )
			{
				if ( Item.Section !== section )
				{
					section = Item.Section;
					lines.push( '{' + t.dim + '-fg}' + section + '{/}' );
					names.push( null );
				}
				let badge = Item.Severity ? '{' + t[ Item.Severity ] + '-fg}' + BADGES[ Item.Severity ] + '{/} ' : '  ';
				let kind = ( Item.Section === 'Objects' ) ? '{' + t.dim + '-fg}' + escape_tags( Item.Kind || '' ) + '{/} ' : '';
				lines.push( badge + kind + escape_tags( Item.Name ) );
				names.push( Item.Name );
			} );
			let inventory_key = lines.join( '\n' ) + t.dim;
			if ( inventory_key !== drawn.Inventory )
			{
				let selected = widgets.inventory.selected || 0;
				widgets.inventory.Names = names;
				widgets.inventory.setItems( lines );
				widgets.inventory.select( Math.min( selected, Math.max( 0, lines.length - 1 ) ) );
				drawn.Inventory = inventory_key;
			}

			// Log: its lines, coloured by kind, kept scrolled to the end.
			if ( state.Log.length !== drawn.LogLength )
			{
				let text = state.Log.map( function ( Line )
				{
					let body = '  '.repeat( Line.Depth || 0 ) + escape_tags( Line.Text );
					if ( Line.Kind === 'error' ) { return '{' + t.error + '-fg}' + body + '{/}'; }
					if ( Line.Kind === 'finding' ) { return '{' + t.warning + '-fg}' + body + '{/}'; }
					if ( Line.Kind === 'command' ) { return '{bold}' + body + '{/bold}'; }
					if ( Line.Kind === 'reload' || Line.Kind === 'debug' ) { return '{' + t.note + '-fg}' + body + '{/}'; }
					return body;
				} ).join( '\n' );
				widgets.log.setContent( text );
				widgets.log.setScrollPerc( 100 );
				drawn.LogLength = state.Log.length;
			}

			// Data Rows: rows as columns, or an Update's changes as before, after and the diff.
			let rows = state.Rows;
			if ( rows.Value !== drawn.RowsValue || rows !== drawn.Rows )
			{
				let data = null;
				if ( Array.isArray( rows.Changes ) )
				{
					data = [ [ 'Before', 'After', 'Diff' ] ].concat( rows.Changes.map( function ( Change ) { return [ cell( Change.Before ), cell( Change.After ), cell( Change.Diff ) ]; } ) );
					widgets.rows.Records = rows.Changes;
				}
				else
				{
					let columns = rows.Columns.length ? rows.Columns : [ ' ' ];
					data = [ columns.map( cell ) ].concat( rows.Rows.map( function ( Row ) { return columns.map( function ( Column ) { return cell( Row[ Column ] ); } ); } ) );
					widgets.rows.Records = rows.Rows;
				}
				let selected = widgets.rows.selected || 1;
				widgets.rows.setData( data );
				widgets.rows.select( Math.min( selected, Math.max( 1, data.length - 1 ) ) );
				drawn.Rows = rows;
				drawn.RowsValue = rows.Value;
			}
			let page = ( rows.Max !== null && rows.Max !== undefined ) ? ' - rows ' + ( rows.Skip + 1 ) + '-' + ( rows.Skip + rows.Rows.length ) + ( rows.More ? ', PgDn for more' : '' ) : '';
			widgets.rows.setLabel( ' Data Rows' + ( rows.Title ? ': ' + rows.Title : '' ) + page + ' ' );

			// Input: its text with the cursor while it has focus, its mode, and what the check found.
			let input = state.Input;
			widgets.input.setContent( input.Text + ( screen.focused === widgets.input ? CURSOR : '' ) );
			widgets.input.setScrollPerc( 100 );
			let label = ' Input';
			if ( input.Mode === 'empty' && !input.Findings.length && !state.Debug )
			{
				label += ' - Enter sends, Tab completes, Esc or Shift+Tab leaves, F1 help';
			}
			else if ( input.Mode === 'json' )
			{
				if ( input.Syntax ) { label += ' - JSON: ' + input.Syntax.Message.slice( 0, 60 ); }
				else if ( input.Target ) { label += ' - ' + ( input.Target.Exists ? 'set ' : 'add ' ) + input.Target.Noun + ' [' + input.Target.Name + '], Ctrl+S saves'; }
				if ( input.Checked ) { label += input.Findings.length ? ' - ' + input.Findings.length + ' finding' + ( input.Findings.length === 1 ? '' : 's' ) + ': ' + input.Findings[ 0 ].Message.slice( 0, 50 ) : ' - checked, no error'; }
			}
			else if ( input.Findings.length )
			{
				label += ' - ' + input.Findings[ 0 ].Message.slice( 0, 80 );
			}
			else if ( state.Debug )
			{
				label += ' - debugging ' + state.Debug.Process + ': Esc, then s step  i into  c continue  d decline  t state  k skip  x quit';
			}
			widgets.input.setLabel( label + ' ' );

			// Status: the file, the connection, the queue, what runs now.
			let parts = [
				' ' + ( state.File || '(no file)' ),
				state.Connected ? 'connected' : 'NOT CONNECTED',
				state.Queue ? 'queue held by ' + state.Queue : 'queue free',
			];
			if ( state.Running.length ) { parts.push( 'running ' + state.Running.join( ' > ' ) ); }
			else if ( state.Busy ) { parts.push( 'working' ); }
			if ( state.Debug && state.Debug.Snapshot )
			{
				let snapshot = state.Debug.Snapshot;
				parts.push( snapshot.Finished ? 'debug ' + snapshot.Outcome : 'debug ' + ( snapshot.Process || '' ) + ' ' + ( snapshot.Status || '' ) + ( snapshot.Step ? ': ' + snapshot.Step : '' ) );
			}
			parts.push( state.View.Theme + '/' + state.View.Scale + '  F1 help' );
			widgets.status.setContent( escape_tags( parts.join( '  |  ' ) ) );

			if ( state.Confirm && popup === null ) { open_confirm(); }
			screen.render();
			return;
		}


		//---------------------------------------------------------------------
		// Popups. Each takes focus while open and gives it back to the pane it came from.

		function close_popup()
		{
			if ( popup !== null ) { let closing = popup; popup = null; closing.destroy(); }
			return;
		}

		function message( Label, Text )
		{
			close_popup();
			let t = theme();
			popup = blessed.box( {
				parent: screen, top: 'center', left: 'center', width: '80%', height: '70%', border: { type: 'line' }, label: ' ' + Label + ' - Esc closes ',
				keys: true, mouse: true, scrollable: true, alwaysScroll: true, content: Text,
				style: { fg: t.fg, bg: t.bg, border: { fg: t.focus, bg: t.bg } },
			} );
			popup.key( [ 'escape', 'enter', 'q' ], function () { close_popup(); focus( focus_index ); } );
			popup.focus();
			screen.render();
			return;
		}

		function open_confirm()
		{
			let t = theme();
			popup = blessed.box( {
				parent: screen, top: 'center', left: 'center', width: 70, height: 8, border: { type: 'line' }, label: ' Confirm ',
				tags: true, keys: true,
				content: '\n ' + escape_tags( state.Confirm.Message ) + '\n\n {bold}y{/bold} send it    {bold}n{/bold} do not',
				style: { fg: t.fg, bg: t.bg, border: { fg: t.error, bg: t.bg } },
			} );
			popup.key( [ 'y', 'n', 'escape' ], function ( Ch, Key )
			{
				let yes = ( Key.name === 'y' );
				// ***The model first***: it clears Confirm at once. Closing a focused popup hands focus back,
				// and the redraw that makes would otherwise open the confirmation again.
				Model.Confirm( yes );
				close_popup();
				focus( focus_index );
			} );
			popup.focus();
			return;
		}

		function choose( Candidates )
		{
			close_popup();
			let t = theme();
			popup = blessed.list( {
				parent: screen, bottom: ( INPUT_HEIGHT[ state.View.Scale ] || 5 ) + 1, left: 2, width: 50, height: Math.min( 12, Candidates.length + 2 ), border: { type: 'line' }, label: ' Complete ',
				keys: true, mouse: true, items: Candidates.map( escape_tags ), tags: true,
				style: { fg: t.fg, bg: t.bg, border: { fg: t.focus, bg: t.bg }, selected: { fg: t.selected_fg, bg: t.selected_bg } },
			} );
			popup.on( 'select', function ( Item, Index )
			{
				close_popup();
				Model.ApplyCompletion( Candidates[ Index ] );
				focus( 3 );
			} );
			popup.key( [ 'escape' ], function () { close_popup(); focus( 3 ); } );
			popup.focus();
			screen.render();
			return;
		}


		//---------------------------------------------------------------------
		// Focus: the next pane which is showing.

		function focus( Index )
		{
			let panes = order();
			for ( let step = 0; step < panes.length; step++ )
			{
				let index = ( ( ( Index + step ) % panes.length ) + panes.length ) % panes.length;
				if ( !panes[ index ].hidden )
				{
					focus_index = index;
					panes[ index ].focus();
					draw();
					return;
				}
			}
			return;
		}


		//---------------------------------------------------------------------
		// Input's text changed: tell the model, and check a JSON entry once typing pauses.

		function input_changed( Text )
		{
			Model.SetInput( Text );
			if ( check_timer !== null ) { clearTimeout( check_timer ); check_timer = null; }
			if ( state.Input.Mode === 'json' && state.Input.Target )
			{
				check_timer = setTimeout( function () { check_timer = null; Model.CheckInput(); }, check_delay );
			}
			draw();
			return;
		}


		//---------------------------------------------------------------------
		// The panes' own keys and clicks, bound each time they are built.

		function bind()
		{
			let input = widgets.input;

			input.on( 'keypress', function ( Ch, Key )
			{
				if ( finished || popup !== null ) { return; }
				let name = Key ? Key.name : null;
				let text = state.Input.Text;

				// ***One Enter arrives as two keypresses, `enter` then `return`*** (measured, neo-blessed
				// 0.2.0 with a \r): act on the first only, or a command is sent twice.
				if ( name === 'return' ) { return; }

				if ( name === 'enter' )
				{
					if ( state.Input.Mode === 'json' ) { input_changed( text + '\n' ); return; }
					if ( text.trim() === '' ) { return; }
					Model.Submit().then( function ()
					{
						if ( state.Input.Findings.length === 0 && state.Confirm === null ) { Model.SetInput( '' ); }
						draw();
					} );
					return;
				}
				if ( name === 'tab' && !Key.shift )
				{
					let completion = Model.Complete();
					if ( completion.Candidates.length === 1 ) { Model.ApplyCompletion( completion.Candidates[ 0 ] ); draw(); }
					else if ( completion.Candidates.length > 1 ) { choose( completion.Candidates ); }
					return;
				}
				if ( name === 'escape' ) { focus( 0 ); return; }
				if ( Key && Key.ctrl && name === 's' )
				{
					Model.Submit().then( function () { draw(); } );
					return;
				}
				if ( name === 'backspace' )
				{
					if ( text.length ) { input_changed( Array.from( text ).slice( 0, -1 ).join( '' ) ); }
					return;
				}
				if ( typed( Ch, Key ) ) { input_changed( text + Ch ); }
				return;
			} );

			widgets.inventory.on( 'select', function ( Item, Index )
			{
				let name = ( widgets.inventory.Names || [] )[ Index ];
				if ( !name ) { return; }
				Model.Select( name );
				focus( 3 );
			} );

			widgets.rows.on( 'select', function ( Item, Index )
			{
				let record = ( widgets.rows.Records || [] )[ Index - 1 ];
				if ( typeof record === 'undefined' ) { return; }
				message( 'Row ' + Index, JSON.stringify( record, null, 2 ) );
			} );
			widgets.rows.key( [ 'pagedown' ], function () { Model.Page( 1 ); } );
			widgets.rows.key( [ 'pageup' ], function () { Model.Page( -1 ); } );

			// A pane which takes focus, by a key or a click, is the one Tab moves on from, and is drawn so.
			order().forEach( function ( Pane, Index )
			{
				Pane.on( 'focus', function () { focus_index = Index; if ( !finished ) { draw(); } } );
			} );
			return;
		}


		//---------------------------------------------------------------------
		// The screen's own keys: with nothing grabbing the keyboard, these work in every pane.

		function finish( Code )
		{
			if ( finished ) { return; }
			finished = true;
			if ( check_timer !== null ) { clearTimeout( check_timer ); }
			stop_listening();
			screen.destroy();
			Resolve( Code );
			return;
		}

		screen.key( [ 'C-q', 'C-c' ], function () { finish( 0 ); } );
		screen.key( [ 'tab' ], function () { if ( popup === null && screen.focused !== widgets.input ) { focus( focus_index + 1 ); } } );
		screen.key( [ 'S-tab' ], function () { if ( popup === null ) { focus( focus_index - 1 + order().length ); } } );
		screen.key( [ 'f1' ], function () { message( 'Help', HELP_TEXT ); } );
		screen.key( [ 'f2' ], function () { Model.NextTheme(); } );
		screen.key( [ 'f3' ], function () { Model.NextScale(); } );
		screen.key( [ 'f5' ], function () { Model.TogglePane( 'Inventory' ); focus( focus_index ); } );
		screen.key( [ 'f6' ], function () { Model.TogglePane( 'Log' ); focus( focus_index ); } );
		screen.key( [ 'f7' ], function () { Model.TogglePane( 'Rows' ); focus( focus_index ); } );

		screen.on( 'keypress', function ( Ch, Key )
		{
			if ( !state.Debug || popup !== null || screen.focused === widgets.input || !Key || Key.ctrl || Key.meta ) { return; }
			let command = DEBUG_KEYS[ Key.name ];
			if ( command ) { Model.StepDebug( command ); }
		} );

		screen.on( 'resize', function () { draw(); } );

		let stop_listening = Model.OnChange( function () { draw(); } );

		build();
		focus( 3 );
		if ( typeof options.OnScreen === 'function' ) { options.OnScreen( screen, widgets, finish ); }
	} );
}


//---------------------------------------------------------------------
module.exports = {
	THEMES: THEMES,
	BADGES: BADGES,
	DEBUG_KEYS: DEBUG_KEYS,
	INPUT_HEIGHT: INPUT_HEIGHT,
	CURSOR: CURSOR,
	HELP_TEXT: HELP_TEXT,
	Run: Run,
};
