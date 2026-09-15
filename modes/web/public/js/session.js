'use strict';

/*
	The page's state and its flows (plan F5), over JsonxClient. The panes draw this; nothing else changes it.

	***It decides nothing the process does not answer***: a typed line is read by `Line`, an entry's actions
	and their lines come from `Actions`, the inventory and its badges from `Inventory`, and an Update's diff
	from `engine diff`. What is left here is wiring - which pane an answer goes to - and what the TUI's
	model does with the same answers.

		State.Inventory   { Items, Findings } from Inventory
		State.Selected    the name of the entry selected
		State.Menu        { Name, Actions } while an entry's actions are open
		State.Input       { Text, Findings } - the command line (Monaco replaces it in step 5)
		State.Log         [ { Kind, Text, Depth } ], newest last
		State.Rows        { Title, Columns, Rows, Changes, Skip, Max, More }
		State.Running     the objects running now, outermost first, from report events
		State.Busy        how many requests are out
		State.Queue       what holds the queue ('debug') or null
		State.Confirm     { Message, Document, Label } while the --yes rule asks
		State.Json        { Title, Text } while a row's JSON is shown
*/

angular.module( 'JsonxWeb' ).factory( 'JsonxSession', [ 'JsonxClient', '$q',
	function ( JsonxClient, $q )
	{
		const LOG_LIMIT = 2000;
		const PAGE_ROWS = 100;
		const FRONT = 'the Web UI';

		let state = {
			Connection: 'connecting',
			Hello: null,
			Message: null,
			Inventory: { Items: [], Findings: [] },
			Selected: null,
			Menu: null,
			Input: { Text: '', Findings: [] },
			Log: [],
			Rows: { Title: '', Columns: [], Rows: [], Changes: null, Skip: 0, Max: null, More: false },
			Running: [],
			Busy: 0,
			Queue: null,
			Confirm: null,
			Json: null,
		};

		let session = { State: state };

		// The last find, for paging.
		let last_find = null;


		//---------------------------------------------------------------------
		function is_object( Value )
		{
			return ( Value !== null ) && ( typeof Value === 'object' ) && !Array.isArray( Value );
		}

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

		session.Log = log;


		//---------------------------------------------------------------------
		// Connecting.

		session.Start = function ()
		{
			JsonxClient.OnClose( function ()
			{
				state.Connection = 'closed';
				log( 'error', 'The connection to the jsonx process closed.' );
				return;
			} );

			JsonxClient.OnEvent( function ( Event )
			{
				if ( Event.Event === 'document' ) { session.RefreshInventory(); }
				else if ( Event.Event === 'queue' ) { state.Queue = Event.HeldBy || null; }
				else if ( Event.Event === 'reload' )
				{
					let outcome = Event.Outcome || {};
					if ( outcome.Reloaded ) { log( 'reload', 'The file changed on disk and was reloaded' + ( Array.isArray( outcome.Changed ) && outcome.Changed.length ? '; opened again on next use: ' + outcome.Changed.join( ', ' ) : '' ) + '.' ); }
					else { log( 'error', 'The file changed on disk and was not reloaded: ' + ( outcome.Message || 'it could not be read' ) ); }
				}
				return;
			} );

			return JsonxClient.Config().then( function ( Config )
			{
				if ( Config.TokenRequired )
				{
					state.Connection = 'closed';
					state.Message = 'This jsonx process needs a token.';
					return null;
				}
				return JsonxClient.Connect().then( function ( Hello )
				{
					state.Connection = 'open';
					state.Hello = Hello;
					return session.RefreshInventory();
				} );
			} ).catch( function ( error )
			{
				state.Connection = 'closed';
				state.Message = error.message;
				return null;
			} );
		};


		//---------------------------------------------------------------------
		// Inventory.

		session.RefreshInventory = function ()
		{
			return JsonxClient.Send( { Inventory: true } ).then( function ( Answer )
			{
				if ( !Answer.Ok ) { return null; }
				state.Inventory = Answer.Result;
				if ( state.Selected !== null && !state.Inventory.Items.some( function ( Item ) { return Item.Name === state.Selected; } ) ) { state.Selected = null; }
				return state.Inventory;
			} );
		};

		session.Select = function ( Name )
		{
			state.Selected = Name;
			return;
		};

		// An entry's actions, from the process.
		session.OpenActions = function ( Name )
		{
			state.Selected = Name;
			return JsonxClient.Send( { Actions: Name } ).then( function ( Answer )
			{
				if ( !Answer.Ok ) { log( 'error', ( Answer.Log || [] ).join( ' ' ) ); return null; }
				state.Menu = { Name: Name, Actions: Answer.Result };
				return state.Menu;
			} );
		};

		session.CloseActions = function ()
		{
			state.Menu = null;
			return;
		};

		// ***Acting goes through Input's own path***, as in the TUI: an action which sends is sent as its line;
		// the rest put their line in Input to finish.
		session.Act = function ( Action )
		{
			state.Menu = null;
			if ( !Action.Sends )
			{
				session.SetInput( Action.Line + ' ' );
				return $q.resolve( { Input: true } );
			}
			return session.SendLine( Action.Line );
		};


		//---------------------------------------------------------------------
		// Input.

		session.SetInput = function ( Text )
		{
			state.Input.Text = String( Text );
			state.Input.Findings = [];
			return;
		};

		// A typed line, read by the process, then done as it says.
		session.SendLine = function ( Text )
		{
			let text = String( ( typeof Text === 'string' ) ? Text : state.Input.Text );
			if ( text.trim() === '' ) { return $q.resolve( null ); }
			return JsonxClient.Send( { Line: text } ).then( function ( Answer )
			{
				if ( !Answer.Ok )
				{
					state.Input.Findings = [ { Severity: 'error', Path: '', Message: ( Answer.Log || [] ).join( ' ' ) } ];
					return null;
				}
				let read = Answer.Result;
				if ( read.Outcome === 'usage' || read.Outcome === 'refused' )
				{
					state.Input.Findings = read.Findings;
					return null;
				}
				state.Input.Findings = [];
				if ( typeof Text !== 'string' ) { state.Input.Text = ''; }
				if ( read.Outcome === 'help' ) { log( 'text', read.Text ); return null; }
				if ( read.Outcome === 'debug' ) { log( 'text', 'Debugging from the page arrives with Input (cut 5, step 5).' ); return null; }
				if ( read.Outcome === 'confirm' )
				{
					state.Confirm = { Message: read.Message, Document: read.Document, Label: text.trim() };
					return null;
				}
				// The Log echoes the line as it was typed or sent, quotes and all.
				return run( read.Document, text.trim() );
			} );
		};

		// The --yes rule's answer: only yes sends, with yes: true.
		session.Confirm = function ( Yes )
		{
			let confirm = state.Confirm;
			state.Confirm = null;
			if ( confirm === null ) { return $q.resolve( null ); }
			if ( Yes !== true ) { log( 'text', 'Not sent.' ); return $q.resolve( null ); }
			return run( Object.assign( {}, confirm.Document, { yes: true } ), confirm.Label + ' (confirmed)' );
		};


		//---------------------------------------------------------------------
		// Running one command: its report in Log, its result in Data Rows.

		function run( Document, Label )
		{
			state.Busy++;
			log( 'command', '> ' + Label );
			return JsonxClient.Invoke( Document, function ( Message )
			{
				if ( Message.Event !== 'report' ) { return; }
				if ( Message.Phase === 'open' ) { state.Running = state.Running.slice( 0, Message.Depth ).concat( [ Message.Name ] ); }
				else { state.Running = state.Running.slice( 0, Message.Depth ); }
				return;
			} ).then( function ( Answer )
			{
				state.Busy--;
				state.Running = [];
				( Answer.Findings || [] ).forEach( function ( Finding ) { log( 'finding', finding_text( Finding ) ); } );
				( Answer.Log || [] ).forEach( function ( Line ) { log( Answer.Ok ? 'log' : 'error', Line ); } );
				if ( !Answer.Ok ) { log( 'error', 'exit ' + Answer.ExitCode ); }
				if ( typeof Answer.Result === 'string' ) { log( 'text', Answer.Result ); }
				else if ( typeof Answer.Result !== 'undefined' ) { return show_rows( Document, Answer.Result ).then( function () { return Answer; } ); }
				return Answer;
			} );
		}


		//---------------------------------------------------------------------
		// Data Rows.

		function show_rows( Document, Result )
		{
			let command = Array.isArray( Document.Command ) ? Document.Command.join( ' ' ) : String( Document.Command );
			let rows = { Title: command, Columns: [], Rows: [], Changes: null, Skip: 0, Max: null, More: false };

			if ( command === 'datasource find' )
			{
				last_find = Document;
				rows.Skip = ( typeof Document.skip === 'number' ) ? Document.skip : 0;
				rows.Max = ( typeof Document.max === 'number' ) ? Document.max : null;
				rows.More = ( rows.Max !== null && Array.isArray( Result ) && Result.length === rows.Max );
			}

			let list = Array.isArray( Result ) ? Result : [ Result ];
			if ( list.length > 0 && list.every( is_object ) )
			{
				list.forEach( function ( Row ) { Object.keys( Row ).forEach( function ( Key ) { if ( !rows.Columns.includes( Key ) ) { rows.Columns.push( Key ); } } ); } );
				rows.Rows = list;
			}
			else
			{
				rows.Columns = [ 'Value' ];
				rows.Rows = list.map( function ( Value ) { return { Value: Value }; } );
			}
			state.Rows = rows;

			// An Update's changes, with the diff the process's jsongin answers for each.
			if ( is_object( Result ) && Array.isArray( Result.Changes ) )
			{
				return $q.all( Result.Changes.map( function ( Change )
				{
					if ( Change.After === null ) { return $q.resolve( { Before: Change.Before, After: null, Diff: null } ); }
					return JsonxClient.Invoke( { Command: [ 'engine', 'diff' ], before: Change.Before, after: Change.After } ).then( function ( Answer )
					{
						return { Before: Change.Before, After: Change.After, Diff: Answer.Ok ? Answer.Result : null };
					} );
				} ) ).then( function ( Changes )
				{
					if ( state.Rows === rows ) { rows.Changes = Changes; }
					return rows;
				} );
			}
			return $q.resolve( rows );
		}

		// Paging a find: with no max given, a page is PAGE_ROWS rows.
		session.Page = function ( Direction )
		{
			if ( last_find === null ) { return $q.resolve( null ); }
			let max = ( typeof last_find.max === 'number' ) ? last_find.max : PAGE_ROWS;
			let skip = ( typeof last_find.skip === 'number' ) ? last_find.skip : 0;
			skip = Math.max( 0, skip + ( Direction < 0 ? -max : max ) );
			if ( typeof last_find.max !== 'number' && Direction < 0 ) { skip = 0; }
			return run( Object.assign( {}, last_find, { skip: skip, max: max } ), 'page ' + ( Math.floor( skip / max ) + 1 ) );
		};

		// A value shown whole, as JSON.
		session.ShowJson = function ( Title, Value )
		{
			state.Json = { Title: Title, Text: JSON.stringify( Value, null, '  ' ) };
			return;
		};

		session.CloseJson = function ()
		{
			state.Json = null;
			return;
		};

		session.FRONT = FRONT;
		return session;
	}
] );
