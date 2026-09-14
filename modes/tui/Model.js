'use strict';

/*
	The TUI's state and behaviour (plan F4.4, F5), with no screen library: ***the TUI holds no
	behaviour a test needs a terminal to reach*** (the desktop's rule, F4.6, applied here). Screen.js
	draws this model and hands it keys; everything else is here and asserted in test/TuiModel.test.js.

	It talks to the file's jsonx process only through the Client (the WebSocket), and ***adds no
	behaviour the command table lacks***: a typed line is parsed with the package's own parser and sent
	as its --input-json document, a saved entry is `<noun> add` or `set`, a live check is `--check`
	(user, 2026-09-14), and a debug is `jsonx debug` served as a conversation.

	The panes (F5):
	-	Inventory: the file's data sources, objects by Kind and triggers, in file order, each with the
		worst severity validation finds in it. Refreshed on every `document` event. Each entry's actions
		(run, debug, find, explain, ...) are the commands the tree declares for its kind (ActionsFor).
	-	Input: a command in the CLI grammar, or a JSON entry. Completions come from the command tree and
		the file's names (Complete.Candidates), and inside JSON from operators, declared names and a
		data source's fields.
	-	Log: the report lines of every answer, findings, reloads and debug steps. ***Progress shows in the
		status line***, as the objects running now, from the report events; the run's report lines arrive
		with its answer, so showing both would print every object twice.
	-	Data Rows: a result as rows and columns, paged with --skip/--max, and an Update's --changes as
		before, after and the jsongin.Diff between them.
*/

const LIB_OS = require( 'os' );
const LIB_PATH = require( 'path' );

const jsongin = require( '@liquicode/jsongin' );

const Parser = require( '../../src/CommandLine/Parser.js' );
const InputJson = require( '../../src/CommandLine/InputJson.js' );
const Words = require( '../../src/CommandLine/Words.js' );
const Complete = require( '../../src/CommandLine/Complete.js' );
const Help = require( '../../src/CommandLine/Help.js' );
const Names = require( '../../src/File/Names.js' );
const Edit = require( '../../src/File/Edit.js' );
const Verbs = require( '../../src/Storage/Verbs.js' );
const Protocol = require( '../mcp/Protocol.js' );


const LOG_LIMIT = 2000;
const PAGE_ROWS = 100;
const THEMES = [ 'dark', 'light' ];
const SCALES = [ 'small', 'normal', 'large' ];
const PANES = [ 'Inventory', 'Log', 'Rows' ];
const SEVERITY_RANK = { note: 1, warning: 2, error: 3 };

// Commands a TUI does not send: they are front ends or shells of their own.
const NOT_IN_TUI = [ 'serve', 'mcp', 'tui', 'completion', '__complete' ];

// The actions an entry's menu lists first, in this order; the rest follow in the tree's order.
const FIRST_ACTIONS = [ 'run', 'trigger run', 'debug', 'datasource find', 'datasource count', 'plan', 'explain', 'validate' ];

// ***Actions which are the point of the menu***, sent at once although they change data: what the person
// chose was to run it (user, 2026-09-14: "no way to run/execute any of the objects").
const RUN_ACTIONS = [ 'run', 'trigger run', 'debug' ];


//---------------------------------------------------------------------
class ModelError extends Error
{
	constructor( Message, ExitCode )
	{
		super( Message );
		this.name = 'ModelError';
		this.ExitCode = ( typeof ExitCode === 'number' ) ? ExitCode : 1;
	}
}


//---------------------------------------------------------------------
function is_object( Value )
{
	return ( Value !== null ) && ( typeof Value === 'object' ) && !Array.isArray( Value );
}

function clone( Value )
{
	return ( typeof Value === 'undefined' ) ? undefined : JSON.parse( JSON.stringify( Value ) );
}


//---------------------------------------------------------------------
// The inventory of a document: every entry in file order, with the worst severity found in it.
//
//		{ Section, Index, Kind, Name, Label, Severity: 'error' | 'warning' | 'note' | null }

function InventoryOf( Document, Findings )
{
	let worst = {};
	( Array.isArray( Findings ) ? Findings : [] ).forEach( function ( Finding )
	{
		let parts = String( Finding.Path || '' ).split( '.' );
		if ( parts.length < 2 || !/^\d+$/.test( parts[ 1 ] ) ) { return; }
		let key = parts[ 0 ] + '.' + parts[ 1 ];
		if ( !worst[ key ] || SEVERITY_RANK[ Finding.Severity ] > SEVERITY_RANK[ worst[ key ] ] ) { worst[ key ] = Finding.Severity; }
	} );

	let items = [];
	[ 'DataSources', 'Objects', 'Triggers' ].forEach( function ( Section )
	{
		let entries = ( is_object( Document ) && Array.isArray( Document[ Section ] ) ) ? Document[ Section ] : [];
		entries.forEach( function ( Entry, Index )
		{
			if ( !is_object( Entry ) ) { return; }
			let kind = ( Section === 'Objects' ) ? ( Entry.Kind || null ) : ( Section === 'DataSources' ? 'DataSource' : 'Trigger' );
			items.push( {
				Section: Section,
				Index: Index,
				Kind: kind,
				Name: ( typeof Entry.Name === 'string' ) ? Entry.Name : '(unnamed)',
				Label: ( Section === 'DataSources' ) ? String( Entry.AdapterName || '' ) : ( Section === 'Triggers' ? 'runs ' + String( Entry.Process || '' ) : String( Entry.DataSource || '' ) ),
				Severity: worst[ Section + '.' + Index ] || null,
			} );
		} );
	} );
	return items;
}


//---------------------------------------------------------------------
// ***An entry's actions are read from the command tree*** (plan F5.1: "actions come from F3.1/F3.2"):
// every command, not hidden and not a front end, whose first positional declares it completes to this
// kind of entry. A command added to the table with such a positional joins the menu with no change here.
//
//		{ Command: 'datasource find', Path, Label, Describe, Sends }
//
// `Sends` is true when the command can be sent with the entry's name alone and changes nothing, or is
// one of RUN_ACTIONS. Otherwise choosing it puts the command in Input to finish or confirm with Enter:
// it needs more (rename's new name, update's criteria), or it changes the file or the data (remove,
// flush), judged by the words MCP marks destructive.

function ActionsFor( Tree, Item )
{
	if ( !is_object( Item ) ) { return []; }
	let actions = [];

	function completes_to( Complete )
	{
		if ( Complete === 'entries' ) { return true; }
		if ( Complete === 'objects' ) { return Item.Section === 'Objects'; }
		if ( typeof Complete === 'string' && Complete.startsWith( 'objects:' ) ) { return Item.Section === 'Objects' && Item.Kind === Complete.slice( 'objects:'.length ); }
		if ( Complete === 'datasources' ) { return Item.Section === 'DataSources'; }
		if ( Complete === 'triggers' ) { return Item.Section === 'Triggers'; }
		return false;
	}

	function visit( Node, Path )
	{
		if ( Node.Hidden === true || ( Path.length && NOT_IN_TUI.includes( Path[ 0 ] ) ) ) { return; }
		let positionals = Array.isArray( Node.Positionals ) ? Node.Positionals : [];
		if ( typeof Node.Handler === 'function' && positionals.length && completes_to( positionals[ 0 ].Complete ) )
		{
			let command = Path.join( ' ' );
			let needs_more = positionals.slice( 1 ).some( function ( Each ) { return Each.Required === true; } );
			let options = Parser.OptionsAt( Tree, Path );
			if ( Object.keys( options ).some( function ( Name ) { return options[ Name ].Required === true; } ) ) { needs_more = true; }
			let changes = Protocol.DESTRUCTIVE_WORDS.includes( Path[ Path.length - 1 ] );
			actions.push( {
				Command: command,
				Path: Path.slice(),
				Label: Path[ Path.length - 1 ],
				Describe: Node.Describe || '',
				Sends: RUN_ACTIONS.includes( command ) || ( !needs_more && !changes ),
			} );
		}
		( Array.isArray( Node.Commands ) ? Node.Commands : [] ).forEach( function ( Child ) { visit( Child, Path.concat( [ Child.Command ] ) ); } );
		return;
	}
	visit( Tree, [] );

	let rank = function ( Action ) { let index = FIRST_ACTIONS.indexOf( Action.Command ); return ( index < 0 ) ? FIRST_ACTIONS.length : index; };
	return actions
		.map( function ( Action, Index ) { return { Action: Action, Index: Index }; } )
		.sort( function ( A, B ) { return ( rank( A.Action ) - rank( B.Action ) ) || ( A.Index - B.Index ); } )
		.map( function ( Each ) { return Each.Action; } );
}


//---------------------------------------------------------------------
// The noun an entry typed as JSON belongs to, for add and set: a Kind names its noun; an AdapterName
// is a data source; a Process with no Kind is a trigger. Null when it is none of them.

function NounOf( Entry )
{
	if ( !is_object( Entry ) ) { return null; }
	if ( typeof Entry.Kind === 'string' )
	{
		let noun = Entry.Kind.toLowerCase();
		return ( Edit.NOUNS[ noun ] && Edit.NOUNS[ noun ].Kind === Entry.Kind ) ? noun : null;
	}
	if ( typeof Entry.AdapterName === 'string' ) { return 'datasource'; }
	if ( typeof Entry.Process === 'string' ) { return 'trigger'; }
	return null;
}


//---------------------------------------------------------------------
// A `set` body which makes the entry exactly the one typed: its fields, and null for every field the
// file's entry has that the typed one does not (set removes a field set to null).

function ReplacementBody( Current, Typed )
{
	let body = clone( Typed );
	Object.keys( is_object( Current ) ? Current : {} ).forEach( function ( Key )
	{
		if ( !Object.prototype.hasOwnProperty.call( Typed, Key ) ) { body[ Key ] = null; }
	} );
	return body;
}


//---------------------------------------------------------------------
// Where the end of a JSON text is, for completion:
//
//		{ In: 'string', Prefix, Key, IsKey }   typing inside a string; Key is the key it is the value of
//		{ In: 'none' }                          anywhere else

function JsonContext( Text )
{
	let text = String( Text );
	let in_string = false;
	let start = -1;
	for ( let index = 0; index < text.length; index++ )
	{
		let ch = text[ index ];
		if ( in_string )
		{
			if ( ch === '\\' ) { index++; continue; }
			if ( ch === '"' ) { in_string = false; }
			continue;
		}
		if ( ch === '"' ) { in_string = true; start = index; }
	}
	if ( !in_string ) { return { In: 'none' }; }

	let before = text.slice( 0, start ).replace( /\s+$/, '' );
	let is_key = before === '' || /[{,]$/.test( before );
	let key = null;
	if ( !is_key )
	{
		let match = /"((?:[^"\\]|\\.)*)"\s*:\s*\[?\s*$/.exec( before );
		if ( match ) { key = match[ 1 ]; }
	}
	return { In: 'string', Prefix: text.slice( start + 1 ), Key: key, IsKey: is_key };
}


//---------------------------------------------------------------------
// Options:
//		Client     modes/tui/Client.js, connected or not
//		Url        the WebSocket address the client talks to, for the status line
//		Tree       the command tree (commands/jsonx.js)
//		Version    this package's version; a process of another version is refused
//		Io         where @file values are read (the TUI's own machine), and settings kept
//		SettingsPath   where view settings are kept (default ~/.jsonx/tui.json)

function NewModel( Options )
{
	let options = is_object( Options ) ? Options : {};
	let client = options.Client;
	let tree = options.Tree;
	let io = options.Io || Parser.DefaultIo();
	let settings_path = options.SettingsPath || LIB_PATH.join( LIB_OS.homedir(), '.jsonx', 'tui.json' );

	let listeners = [];

	let state = {
		// The WebSocket this talks to.
		Url: options.Url || null,
		File: null,
		Version: null,
		Connected: false,
		// The command of the conversation holding the queue (a debug), or null.
		Queue: null,
		// The names of the objects running now, outermost first, from report events.
		Running: [],
		Busy: 0,
		Document: null,
		Findings: [],
		Inventory: [],
		Selected: null,
		Input: { Text: '', Mode: 'empty', Syntax: null, Findings: [], Checked: null, Target: null },
		Log: [],
		Rows: { Title: '', Columns: [], Rows: [], Value: undefined, Changes: null, Skip: 0, Max: null, More: false },
		Debug: null,
		Confirm: null,
		View: { Theme: 'dark', Scale: 'normal', Collapsed: { Inventory: false, Log: false, Rows: false } },
	};

	let model = { State: state };

	// What completion in JSON reads: operators once, and each data source's fields once asked.
	let operators = null;
	let fields = {};
	// The last find, for paging.
	let last_find = null;


	//---------------------------------------------------------------------
	function changed()
	{
		for ( let listener of listeners.slice() )
		{
			try { listener( state ); }
			catch ( error ) { /* a listener is told, never asked */ }
		}
		return;
	}

	model.OnChange = function ( Listener )
	{
		listeners.push( Listener );
		return function () { listeners = listeners.filter( function ( Each ) { return Each !== Listener; } ); };
	};

	function log( Kind, Text, Depth )
	{
		String( Text ).split( /\r?\n/ ).forEach( function ( Line, Index, All )
		{
			if ( Line === '' && Index === All.length - 1 ) { return; }
			state.Log.push( { Kind: Kind, Text: Line, Depth: Depth || 0 } );
		} );
		if ( state.Log.length > LOG_LIMIT ) { state.Log.splice( 0, state.Log.length - LOG_LIMIT ); }
		return;
	}

	function finding_text( Finding )
	{
		return Finding.Severity + '  ' + ( Finding.Path ? Finding.Path + ': ' : '' ) + Finding.Message;
	}


	//---------------------------------------------------------------------
	// View settings, kept between runs. A file which cannot be read or written changes nothing.

	function load_settings()
	{
		try
		{
			let saved = JSON.parse( io.ReadFile( settings_path ) );
			if ( THEMES.includes( saved.Theme ) ) { state.View.Theme = saved.Theme; }
			if ( SCALES.includes( saved.Scale ) ) { state.View.Scale = saved.Scale; }
			if ( is_object( saved.Collapsed ) ) { PANES.forEach( function ( Pane ) { state.View.Collapsed[ Pane ] = ( saved.Collapsed[ Pane ] === true ); } ); }
		}
		catch ( error ) { /* no settings yet */ }
		return;
	}

	function save_settings()
	{
		try
		{
			require( 'fs' ).mkdirSync( LIB_PATH.dirname( settings_path ), { recursive: true } );
			let text = JSON.stringify( state.View, null, '\t' ) + '\n';
			if ( typeof io.WriteFile === 'function' ) { io.WriteFile( settings_path, text ); }
			else { require( 'fs' ).writeFileSync( settings_path, text, 'utf8' ); }
		}
		catch ( error ) { /* settings are a convenience */ }
		return;
	}

	model.SetTheme = function ( Theme ) { if ( THEMES.includes( Theme ) ) { state.View.Theme = Theme; save_settings(); changed(); } return; };
	model.NextTheme = function () { return model.SetTheme( THEMES[ ( THEMES.indexOf( state.View.Theme ) + 1 ) % THEMES.length ] ); };
	model.SetScale = function ( Scale ) { if ( SCALES.includes( Scale ) ) { state.View.Scale = Scale; save_settings(); changed(); } return; };
	model.NextScale = function () { return model.SetScale( SCALES[ ( SCALES.indexOf( state.View.Scale ) + 1 ) % SCALES.length ] ); };
	model.TogglePane = function ( Pane )
	{
		if ( !PANES.includes( Pane ) ) { return; }
		state.View.Collapsed[ Pane ] = !state.View.Collapsed[ Pane ];
		save_settings();
		changed();
		return;
	};


	//---------------------------------------------------------------------
	// Connecting: the version must be this package's, so the tree parsed and completed here is the
	// tree the process serves.

	model.Start = async function ()
	{
		load_settings();
		let hello = client.Hello || await client.Connect();
		if ( options.Version && hello.Version !== options.Version )
		{
			client.Close();
			throw new ModelError( 'The jsonx process at the other end is version ' + hello.Version + ', and this one is ' + options.Version + '; a TUI reads the commands of its own version.', 2 );
		}
		state.Connected = true;
		state.File = hello.File;
		state.Version = hello.Version;
		state.Document = hello.Document;

		client.OnEvent( on_file_event );
		client.OnClose( function ( Closed )
		{
			state.Connected = false;
			log( 'error', 'The connection to the jsonx process closed (' + Closed.Code + ').' );
			changed();
		} );

		await model.Refresh( false );
		let answer = await client.Invoke( { Command: 'engine operators' } );
		if ( answer.Ok && is_object( answer.Result ) )
		{
			operators = [];
			Object.keys( answer.Result ).forEach( function ( Group ) { if ( Array.isArray( answer.Result[ Group ] ) ) { operators = operators.concat( answer.Result[ Group ] ); } } );
		}
		changed();
		return state;
	};


	function on_file_event( Event )
	{
		if ( Event.Event === 'queue' )
		{
			state.Queue = Event.HeldBy || null;
			changed();
			return;
		}
		if ( Event.Event === 'reload' )
		{
			let outcome = Event.Outcome || {};
			if ( outcome.Reloaded ) { log( 'reload', 'The file changed on disk and was reloaded' + ( Array.isArray( outcome.Changed ) && outcome.Changed.length ? '; opened again on next use: ' + outcome.Changed.join( ', ' ) : '' ) + '.' ); }
			else { log( 'error', 'The file changed on disk and was not reloaded: ' + ( outcome.Message || 'it could not be read' ) ); }
			changed();
			return;
		}
		if ( Event.Event === 'document' ) { model.Refresh(); }
		return;
	}


	//---------------------------------------------------------------------
	// The document and its validation, again.

	model.Refresh = async function ( Notify )
	{
		let read = await client.Read( 'jsonx://file' );
		if ( read.Ok ) { state.Document = read.Result; }
		let validated = await client.Invoke( { Command: 'validate' } );
		state.Findings = Array.isArray( validated.Findings ) ? validated.Findings : [];
		state.Inventory = InventoryOf( state.Document, state.Findings );
		if ( state.Selected !== null && Names.FindEntry( state.Document, state.Selected ) === null ) { state.Selected = null; }
		if ( Notify !== false ) { changed(); }
		return state.Inventory;
	};


	//---------------------------------------------------------------------
	// Inventory: selecting an entry puts it in Input, as JSON.

	model.Select = function ( Name )
	{
		let item = Names.FindEntry( state.Document, Name );
		if ( item === null ) { return; }
		state.Selected = Name;
		model.SetInput( JSON.stringify( item.Entry, null, '\t' ) );
		return;
	};

	// The actions of an entry in the inventory (ActionsFor), by its name.
	model.Actions = function ( Name )
	{
		let item = state.Inventory.find( function ( Each ) { return Each.Name === Name; } );
		return item ? ActionsFor( tree, item ) : [];
	};

	// ***Acting goes through Input's own path***: the command line an action stands for is sent as if typed,
	// so the --yes confirmation, a debug and the Log read the same. An action which does not send puts the
	// line in Input instead, and answers { Input: true }.
	model.Act = async function ( Name, Command )
	{
		let action = model.Actions( Name ).find( function ( Each ) { return Each.Command === Command; } );
		if ( !action ) { return null; }
		state.Selected = Name;
		let line = action.Path.concat( [ Words.QuoteWord( Name ) ] ).join( ' ' );
		if ( !action.Sends )
		{
			model.SetInput( line + ' ' );
			return { Input: true };
		}
		model.SetInput( '' );
		return await send_command( line );
	};


	//---------------------------------------------------------------------
	// Input.

	model.SetInput = function ( Text )
	{
		let text = String( Text );
		let input = state.Input;
		input.Text = text;
		input.Syntax = null;
		input.Findings = [];
		input.Checked = null;
		input.Target = null;

		if ( text.trim() === '' ) { input.Mode = 'empty'; changed(); return; }
		if ( text.trim()[ 0 ] !== '{' ) { input.Mode = 'command'; changed(); return; }

		input.Mode = 'json';
		let entry = null;
		try
		{
			entry = JSON.parse( text );
		}
		catch ( error )
		{
			// Node gives a position for some mistakes and not others (cut 1): the message as it is.
			input.Syntax = { Message: error.message };
			changed();
			return;
		}
		let noun = NounOf( entry );
		if ( noun === null )
		{
			input.Syntax = { Message: 'This is not an entry of a jsonx file: give it a Kind, an AdapterName (a data source), or a Process (a trigger).' };
		}
		else if ( typeof entry.Name !== 'string' || entry.Name === '' )
		{
			input.Syntax = { Message: 'An entry needs a Name.' };
		}
		else
		{
			let existing = Names.FindEntry( state.Document, entry.Name );
			input.Target = { Noun: noun, Name: entry.Name, Exists: existing !== null, Entry: entry, Current: existing ? existing.Entry : null };
		}
		changed();
		return;
	};


	// ***Whether the entry exists, and what it holds, are read from the process when the edit is sent***,
	// not from the copy of the document here: that copy follows `document` events, so an entry saved a
	// moment ago may not be in it yet (found by the model test: a second save kept a field it removed).
	async function edit_invocation( Target, Check )
	{
		let current = await client.Read( 'jsonx://entry/' + encodeURIComponent( Target.Name ) );
		Target.Exists = ( current.Ok === true );
		Target.Current = current.Ok ? current.Result : null;
		let invocation = Target.Exists
			? { Command: [ Target.Noun, 'set' ], name: Target.Name, json: ReplacementBody( Target.Current, Target.Entry ) }
			: { Command: [ Target.Noun, 'add' ], json: Target.Entry };
		if ( Check ) { invocation.check = true; }
		return invocation;
	}


	// ***A live check***: the JSON entry typed, validated by `add --check` or `set --check`. Nothing is
	// written. The screen calls it once typing pauses.
	model.CheckInput = async function ()
	{
		let input = state.Input;
		if ( input.Mode !== 'json' || input.Target === null ) { return null; }
		let text = input.Text;
		let answer = await client.Invoke( await edit_invocation( input.Target, true ) );
		// Typing moved on while the check ran: its answer is about another text.
		if ( state.Input.Text !== text ) { return null; }
		input.Findings = Array.isArray( answer.Findings ) ? answer.Findings : [];
		input.Checked = { ExitCode: answer.ExitCode, Log: answer.Log };
		changed();
		return answer;
	};


	//---------------------------------------------------------------------
	// Completion of what is typed at the end of Input. Answers { Prefix, Candidates }.

	model.Complete = function ()
	{
		let input = state.Input;
		if ( input.Mode === 'json' || input.Text.trim()[ 0 ] === '{' ) { return complete_json( input.Text ); }

		let split = Words.SplitWords( input.Text );
		// A JSON option still being typed completes as JSON does.
		if ( split.Open === '{' || split.Open === '[' ) { return complete_json( split.Current ); }
		let words = split.Words.slice();
		if ( words[ 0 ] === 'jsonx' ) { words.shift(); }
		if ( split.Current === '' || words.length === 0 ) { words.push( '' ); }
		let prefix = words[ words.length - 1 ];
		let candidates = Complete.Candidates( tree, words, io, { Document: state.Document } );
		return { Prefix: prefix, Candidates: candidates, Json: false };
	};

	function complete_json( Text )
	{
		let context = JsonContext( Text );
		if ( context.In !== 'string' ) { return { Prefix: '', Candidates: [], Json: true }; }
		let prefix = context.Prefix;
		let pool = [];
		let entries = Names.Entries( state.Document || {} );
		let names_where = function ( Test ) { return entries.filter( Test ).map( function ( Item ) { return Item.Name; } ); };

		if ( prefix.startsWith( '$' ) )
		{
			pool = operators || [];
		}
		else if ( !context.IsKey && context.Key === 'Name' && /"\$call"/.test( Text ) )
		{
			pool = Names.HOST_FUNCTIONS.concat( names_where( function ( Item ) { return Item.Section === 'Objects'; } ) );
		}
		else if ( !context.IsKey && ( context.Key === 'DataSource' || context.Key === 'Into' ) )
		{
			pool = names_where( function ( Item ) { return Item.Section === 'DataSources'; } );
		}
		else if ( !context.IsKey && context.Key === 'Process' )
		{
			pool = names_where( function ( Item ) { return Item.Section === 'Objects' && Item.Entry.Kind === 'Process'; } );
		}
		else if ( context.IsKey )
		{
			let match = /"DataSource"\s*:\s*"((?:[^"\\]|\\.)*)"/.exec( Text );
			if ( match ) { pool = fields_of( match[ 1 ] ); }
		}

		let seen = [];
		let candidates = pool.filter( function ( Candidate )
		{
			if ( seen.includes( Candidate ) || !String( Candidate ).startsWith( prefix ) ) { return false; }
			seen.push( Candidate );
			return true;
		} );
		return { Prefix: prefix, Candidates: candidates, Json: true };
	}

	// A data source's field names, from `datasource describe`, asked once and remembered. Until the answer
	// arrives there are none, and the change is announced when it does.
	function fields_of( DataSource )
	{
		if ( Array.isArray( fields[ DataSource ] ) ) { return fields[ DataSource ]; }
		if ( fields[ DataSource ] === 'asking' ) { return []; }
		fields[ DataSource ] = 'asking';
		client.Invoke( { Command: 'datasource describe', name: DataSource, rows: 20 } ).then( function ( Answer )
		{
			let found = [];
			let schema = ( Answer.Ok && is_object( Answer.Result ) ) ? Answer.Result.Schema : null;
			let walk = function ( Schema, Prefix )
			{
				if ( !is_object( Schema ) || !is_object( Schema.properties ) ) { return; }
				Object.keys( Schema.properties ).forEach( function ( Key )
				{
					found.push( Prefix + Key );
					walk( Schema.properties[ Key ], Prefix + Key + '.' );
				} );
			};
			walk( schema, '' );
			fields[ DataSource ] = found;
			changed();
			return;
		} );
		return [];
	}

	// Replaces what is being typed with a candidate.
	model.ApplyCompletion = function ( Candidate )
	{
		let completion = model.Complete();
		let text = state.Input.Text;
		let base = text.slice( 0, text.length - completion.Prefix.length );
		let word = completion.Json ? String( Candidate ) : Words.QuoteWord( Candidate );
		// A quoted word replaces its opening quote too.
		if ( !completion.Json && word[ 0 ] === '"' && /["']$/.test( base ) ) { base = base.slice( 0, -1 ); }
		model.SetInput( base + word );
		return state.Input.Text;
	};


	//---------------------------------------------------------------------
	// Submitting Input: a command is sent; a JSON entry is saved.

	model.Submit = async function ()
	{
		let input = state.Input;
		if ( input.Mode === 'json' ) { return await save_entry(); }
		if ( input.Mode === 'command' ) { return await send_command( input.Text ); }
		return null;
	};


	async function save_entry()
	{
		let input = state.Input;
		if ( input.Syntax !== null || input.Target === null )
		{
			log( 'error', 'Not saved: ' + ( input.Syntax ? input.Syntax.Message : 'this is not an entry.' ) );
			changed();
			return null;
		}
		let invocation = await edit_invocation( input.Target, false );
		let answer = await run( invocation, invocation.Command.join( ' ' ) + ' ' + input.Target.Name );
		if ( answer.Ok ) { state.Selected = input.Target.Name; }
		return answer;
	}


	async function send_command( Text )
	{
		let split = Words.SplitWords( Text );
		if ( split.Open !== null )
		{
			let what = ( split.Open === '{' || split.Open === '[' ) ? 'The JSON beginning ' + split.Open + ' is not closed.' : 'A ' + split.Open + ' quote is not closed.';
			state.Input.Findings = [ { Severity: 'error', Path: '', Message: what } ];
			changed();
			return null;
		}
		let words = split.Words.slice();
		if ( words[ 0 ] === 'jsonx' ) { words.shift(); }

		let parsed = null;
		try
		{
			parsed = InputJson.ParseInvocation( tree, words, io );
		}
		catch ( error )
		{
			if ( !( error instanceof Parser.UsageError ) ) { throw error; }
			state.Input.Findings = [ { Severity: 'error', Path: '', Message: error.message } ];
			changed();
			return null;
		}
		state.Input.Findings = [];

		if ( parsed.Help )
		{
			log( 'text', Help.HelpText( tree, parsed.Path ) );
			changed();
			return null;
		}

		let node = Parser.NodeAt( tree, parsed.Path );
		if ( typeof node.Handler !== 'function' )
		{
			log( 'text', Help.HelpText( tree, parsed.Path ) );
			changed();
			return null;
		}
		if ( NOT_IN_TUI.includes( parsed.Path[ 0 ] ) )
		{
			state.Input.Findings = [ { Severity: 'error', Path: '', Message: '[' + parsed.Path.join( ' ' ) + '] is not run from the TUI.' } ];
			changed();
			return null;
		}

		let document = InputJson.ToDocument( parsed );
		if ( parsed.Path[ 0 ] === 'debug' ) { return await model.StartDebug( document ); }

		// ***The --yes rule (F6.3) asks the person***, rather than refusing: the screen shows Confirm,
		// and Confirm( true ) sends it with yes.
		let verb = parsed.Path[ 1 ];
		if ( parsed.Path[ 0 ] === 'datasource' && Verbs.VERBS[ verb ] && Verbs.VERBS[ verb ].Guard !== null && typeof parsed.Options.save !== 'string' )
		{
			let refusal = Verbs.Guard( verb, parsed.Options );
			if ( refusal !== null )
			{
				state.Confirm = { Message: refusal.replace( /^Refused: /, '' ).replace( /\s*Confirm with[\s\S]*$/, '' ), Document: document };
				changed();
				return null;
			}
		}

		return await run( document, words.join( ' ' ) );
	}


	model.Confirm = async function ( Yes )
	{
		let confirm = state.Confirm;
		state.Confirm = null;
		if ( confirm === null ) { return null; }
		if ( Yes !== true )
		{
			log( 'text', 'Not sent.' );
			changed();
			return null;
		}
		let document = Object.assign( {}, confirm.Document, { yes: true } );
		return await run( document, document.Command.join( ' ' ) + ' (confirmed)' );
	};


	//---------------------------------------------------------------------
	// Sends one command, and puts its answer in Log and Data Rows.

	async function run( Document, Label )
	{
		state.Busy++;
		log( 'command', '> ' + Label );
		changed();

		let answer = await client.Invoke( Document, on_request_event );

		// What a command wrote may give a store fields it did not have: ask describe again when needed.
		fields = {};
		state.Busy--;
		state.Running = [];
		( answer.Findings || [] ).forEach( function ( Finding ) { log( 'finding', finding_text( Finding ) ); } );
		( answer.Log || [] ).forEach( function ( Line ) { log( answer.Ok ? 'log' : 'error', Line ); } );
		if ( !answer.Ok ) { log( 'error', 'exit ' + answer.ExitCode ); }

		if ( typeof answer.Result === 'string' ) { log( 'text', answer.Result ); }
		else if ( typeof answer.Result !== 'undefined' ) { show_rows( Document, answer.Result ); }
		changed();
		return answer;
	}


	function on_request_event( Message )
	{
		if ( Message.Event !== 'report' ) { return; }
		if ( Message.Phase === 'open' ) { state.Running = state.Running.slice( 0, Message.Depth ).concat( [ Message.Name ] ); }
		else { state.Running = state.Running.slice( 0, Message.Depth ); }
		changed();
		return;
	}


	//---------------------------------------------------------------------
	// Data Rows.

	function show_rows( Document, Result )
	{
		let command = Array.isArray( Document.Command ) ? Document.Command.join( ' ' ) : String( Document.Command );
		let rows = state.Rows;
		rows.Title = command;
		rows.Value = Result;
		rows.Changes = null;
		rows.More = false;

		let find = /^datasource find$/.test( command );
		if ( find )
		{
			last_find = Document;
			rows.Skip = ( typeof Document.skip === 'number' ) ? Document.skip : 0;
			rows.Max = ( typeof Document.max === 'number' ) ? Document.max : null;
			rows.More = ( rows.Max !== null && Array.isArray( Result ) && Result.length === rows.Max );
		}
		else
		{
			rows.Skip = 0;
			rows.Max = null;
		}

		if ( is_object( Result ) && Array.isArray( Result.Changes ) )
		{
			rows.Changes = Result.Changes.map( function ( Change )
			{
				return { Before: Change.Before, After: Change.After, Diff: ( Change.After === null ) ? null : jsongin.Diff( Change.Before, Change.After ) };
			} );
		}

		let list = Array.isArray( Result ) ? Result : [ Result ];
		if ( list.every( is_object ) )
		{
			let columns = [];
			list.forEach( function ( Row ) { Object.keys( Row ).forEach( function ( Key ) { if ( !columns.includes( Key ) ) { columns.push( Key ); } } ); } );
			rows.Columns = columns;
			rows.Rows = list;
		}
		else
		{
			rows.Columns = [ 'Value' ];
			rows.Rows = list.map( function ( Value ) { return { Value: Value }; } );
		}
		return;
	}

	// Paging a find: with no --max given, the first page asked for is PAGE_ROWS rows.
	model.Page = async function ( Direction )
	{
		if ( last_find === null ) { return null; }
		let max = ( typeof last_find.max === 'number' ) ? last_find.max : PAGE_ROWS;
		let skip = ( typeof last_find.skip === 'number' ) ? last_find.skip : 0;
		skip = Math.max( 0, skip + ( Direction < 0 ? -max : max ) );
		if ( typeof last_find.max !== 'number' && Direction < 0 ) { skip = 0; }
		return await run( Object.assign( {}, last_find, { skip: skip, max: max } ), 'page ' + ( Math.floor( skip / max ) + 1 ) );
	};


	//---------------------------------------------------------------------
	// Debug.

	model.StartDebug = async function ( Document )
	{
		if ( state.Debug !== null ) { log( 'error', 'A debug is already open: quit it first.' ); changed(); return null; }
		let options_ = Object.assign( {}, Document );
		delete options_.Command;
		state.Debug = { Process: options_.process, Snapshot: null, Over: false };
		log( 'command', '> debug ' + options_.process );
		changed();

		let done = client.Debug( options_, function ( Message )
		{
			if ( Message.Event === 'debug' && state.Debug ) { state.Debug.Snapshot = Message.Snapshot; changed(); }
			else { on_request_event( Message ); }
			return;
		} );

		done.then( function ( Answer )
		{
			( Answer.Findings || [] ).forEach( function ( Finding ) { log( 'finding', finding_text( Finding ) ); } );
			( Answer.Log || [] ).forEach( function ( Line ) { log( Answer.Ok ? 'log' : 'error', Line ); } );
			log( Answer.Ok ? 'debug' : 'error', 'The debug ended' + ( Answer.Ok ? '.' : ', exit ' + Answer.ExitCode + '.' ) );
			let last = Array.isArray( Answer.Result ) ? Answer.Result[ Answer.Result.length - 1 ] : null;
			if ( last && typeof last.Result !== 'undefined' ) { show_rows( { Command: [ 'debug' ] }, last.Result ); }
			state.Debug = null;
			state.Running = [];
			changed();
			return;
		} );
		return done;
	};

	// One debug command: step, into, continue, decline, answer <json>, state, skip, quit.
	model.StepDebug = async function ( Line )
	{
		if ( state.Debug === null ) { return null; }
		log( 'debug', '> ' + Line );
		let answer = await client.Step( Line );
		if ( !answer.Ok ) { log( 'error', ( answer.Log || [] ).join( ' ' ) ); changed(); return answer; }
		let snapshot = answer.Result;
		if ( state.Debug ) { state.Debug.Snapshot = snapshot; }
		if ( snapshot && snapshot.Error ) { log( 'error', snapshot.Error ); }
		else if ( snapshot && snapshot.Step ) { log( 'debug', ( snapshot.Process ? snapshot.Process + ': ' : '' ) + snapshot.Step, snapshot.Depth || 0 ); }
		changed();
		return answer;
	};


	return model;
}


//---------------------------------------------------------------------
module.exports = {
	LOG_LIMIT: LOG_LIMIT,
	PAGE_ROWS: PAGE_ROWS,
	THEMES: THEMES,
	SCALES: SCALES,
	PANES: PANES,
	ModelError: ModelError,
	InventoryOf: InventoryOf,
	ActionsFor: ActionsFor,
	NounOf: NounOf,
	ReplacementBody: ReplacementBody,
	JsonContext: JsonContext,
	NewModel: NewModel,
};
