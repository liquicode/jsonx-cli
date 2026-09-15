'use strict';

/*
	The page: the session's state drawn, and a person's keys and clicks handed to it. Presentation only -
	how a badge, a cell or a page number reads.
*/

angular.module( 'JsonxWeb' ).controller( 'MainController', [ 'JsonxSession', 'JsonxView', 'JsonxHost', '$timeout', '$document', '$scope',
	function ( JsonxSession, JsonxView, JsonxHost, $timeout, $document, $scope )
	{
		let main = this;
		let state = JsonxSession.State;

		// Theme, scale and collapsed panes; and what the host can do.
		main.View = JsonxView;
		main.Host = JsonxHost;
		main.TokenText = '';
		main.HostSaid = '';

		main.UseToken = function ()
		{
			let token = main.TokenText;
			main.TokenText = '';
			JsonxSession.UseToken( token );
			return;
		};

		function host_said( Promise_, Done, Failed )
		{
			main.HostSaid = '';
			Promise.resolve( Promise_ ).then( function ( Ok ) { $scope.$applyAsync( function () { main.HostSaid = Ok ? Done : Failed; } ); } );
			return;
		}

		main.CopyJson = function () { host_said( JsonxHost.CopyText( state.Json.Text ), 'copied', 'could not copy' ); return; };
		main.SaveJson = function () { host_said( JsonxHost.SaveText( 'row.json', state.Json.Text ), 'saved', 'could not save' ); return; };
		main.SaveRows = function ()
		{
			let name = String( state.Rows.Title || 'rows' ).replace( /[^A-Za-z0-9_-]+/g, '-' ) + '.json';
			JsonxHost.SaveText( name, JSON.stringify( state.Rows.Rows, null, '\t' ) );
			return;
		};

		// The panes read State, and call the session's flows on S.
		main.State = state;
		main.S = JsonxSession;

		main.SECTIONS = [
			{ Name: 'DataSources', Title: 'Data sources' },
			{ Name: 'Objects', Title: 'Objects' },
			{ Name: 'Triggers', Title: 'Triggers' },
		];

		const BADGES = { error: '✖', warning: '!', note: '·' };
		const CELL_WIDTH = 60;

		// The debug commands a button sends, with the key which sends it outside Input (the TUI's letters).
		main.DEBUG_COMMANDS = [
			{ Word: 'step', Key: 's', Describe: 'Take one step; at a call, run the call and go on' },
			{ Word: 'into', Key: 'i', Describe: 'At a call to a Process, step through that Process too' },
			{ Word: 'continue', Key: 'c', Describe: 'Run until the next call, or until this Process finishes' },
			{ Word: 'decline', Key: 'd', Describe: 'Fail the waiting call without running it' },
			{ Word: 'state', Key: 't', Describe: 'Show where the Process is again' },
			{ Word: 'skip', Key: 'k', Describe: 'Leave this document, and go on to the next' },
			{ Word: 'quit', Key: 'x', Describe: 'Stop' },
		];
		main.DebugAnswer = '';

		main.DebugStatus = function ()
		{
			let snapshot = state.Debug && state.Debug.Snapshot;
			if ( !snapshot ) { return 'starting'; }
			if ( snapshot.Finished ) { return snapshot.Outcome; }
			return ( snapshot.Status || '' ) + ( snapshot.Waiting ? ', waiting on a call' : '' );
		};

		main.AnswerDebug = function ()
		{
			let text = String( main.DebugAnswer || '' ).trim();
			if ( text === '' ) { return; }
			main.DebugAnswer = '';
			JsonxSession.StepDebug( 'answer ' + text );
			return;
		};

		// An entry's JSON in Input, and the cursor there to change it.
		main.Edit = function ( Name )
		{
			JsonxSession.Edit( Name ).then( function () { $scope.$broadcast( 'jsonx.focus-input' ); } );
			return;
		};


		//---------------------------------------------------------------------
		main.ConnectionText = function ()
		{
			if ( state.Connection === 'open' ) { return 'connected'; }
			if ( state.Connection === 'closed' ) { return 'disconnected'; }
			return 'connecting';
		};

		main.Badge = function ( Severity ) { return BADGES[ Severity ] || ''; };

		// A cell on one line: a string as it is, anything else as compact JSON, cut short.
		main.Cell = function ( Value )
		{
			if ( typeof Value === 'undefined' ) { return ''; }
			let text = ( typeof Value === 'string' ) ? Value : JSON.stringify( Value );
			return ( text.length > CELL_WIDTH ) ? text.slice( 0, CELL_WIDTH - 1 ) + '…' : text;
		};

		main.Json = function ( Value ) { return JSON.stringify( Value, null, '  ' ); };

		main.PageText = function ()
		{
			let rows = state.Rows;
			if ( rows.Max === null ) { return ''; }
			return 'rows ' + ( rows.Skip + 1 ) + '-' + ( rows.Skip + rows.Rows.length );
		};


		//---------------------------------------------------------------------
		// Keys.

		main.CloseDialogs = function ()
		{
			if ( state.Confirm ) { JsonxSession.Confirm( false ); }
			JsonxSession.CloseActions();
			JsonxSession.CloseJson();
			return;
		};

		// ***While a dialog is open it takes its keys before anything else can*** - y and n answer a
		// confirmation, Escape closes - heard on the document in the capture phase. Moving focus into the dialog
		// was not enough: it happens a tick after the dialog draws, and a key pressed in that tick went to Input's
		// editor, which swallows Escape and would type a y (found by the browser test, one run in several).
		function on_dialog_key( Event )
		{
			let handled = false;
			if ( state.Confirm )
			{
				if ( Event.key === 'y' || Event.key === 'Y' ) { handled = true; $scope.$applyAsync( function () { JsonxSession.Confirm( true ); } ); }
				else if ( Event.key === 'n' || Event.key === 'N' || Event.key === 'Escape' ) { handled = true; $scope.$applyAsync( function () { JsonxSession.Confirm( false ); } ); }
			}
			else if ( ( state.Menu || state.Json ) && Event.key === 'Escape' )
			{
				handled = true;
				$scope.$applyAsync( function () { JsonxSession.CloseActions(); JsonxSession.CloseJson(); } );
			}
			if ( handled ) { Event.preventDefault(); Event.stopPropagation(); }
			return;
		}
		$document[ 0 ].addEventListener( 'keydown', on_dialog_key, true );
		$scope.$on( '$destroy', function () { $document[ 0 ].removeEventListener( 'keydown', on_dialog_key, true ); } );

		main.OnKey = function ( Event )
		{
			// While debugging, a debug command's letter outside anything typed into.
			if ( state.Debug && !state.Menu && !state.Json && !Event.ctrlKey && !Event.metaKey && !Event.altKey && !is_typing( Event.target ) )
			{
				let command = main.DEBUG_COMMANDS.find( function ( Each ) { return Each.Key === Event.key; } );
				if ( command ) { Event.preventDefault(); JsonxSession.StepDebug( command.Word ); }
			}
			return;
		};

		function is_typing( Element )
		{
			if ( !Element ) { return false; }
			let tag = String( Element.tagName || '' ).toLowerCase();
			return tag === 'input' || tag === 'textarea' || Element.isContentEditable === true || !!( Element.closest && Element.closest( '.jsonx-editor' ) );
		}

		main.OnEntryKey = function ( Event, Item )
		{
			if ( Event.key === 'Enter' )
			{
				Event.preventDefault();
				JsonxSession.OpenActions( Item.Name ).then( function () { focus_first( '.jsonx-action' ); } );
			}
			else if ( Event.key === ' ' )
			{
				Event.preventDefault();
				JsonxSession.Select( Item.Name );
			}
			else if ( Event.key === 'ArrowDown' || Event.key === 'ArrowUp' )
			{
				Event.preventDefault();
				let entries = Array.prototype.slice.call( $document[ 0 ].querySelectorAll( '.jsonx-entry' ) );
				let index = entries.indexOf( Event.currentTarget ) + ( Event.key === 'ArrowDown' ? 1 : -1 );
				if ( index >= 0 && index < entries.length ) { entries[ index ].focus(); JsonxSession.Select( entries[ index ].getAttribute( 'data-name' ) ); }
			}
			return;
		};

		// Focus goes to the dialog once it is drawn, so its first key reaches it.
		function focus_first( Selector )
		{
			$timeout( function ()
			{
				let element = $document[ 0 ].querySelector( Selector );
				if ( element ) { element.focus(); }
				return;
			} );
			return;
		}


		// ***A dialog takes focus when it opens***, so its keys reach it: Input's editor handles Escape itself,
		// and a y or n would otherwise be typed into it (found by the step 5 browser test).
		$scope.$watch( function () { return state.Confirm; }, function ( Confirm ) { if ( Confirm ) { focus_first( '#jsonx-confirm-no' ); } } );
		$scope.$watch( function () { return state.Json; }, function ( Json ) { main.HostSaid = ''; if ( Json ) { focus_first( '#jsonx-json' ); } } );
		$scope.$watch( function () { return state.TokenNeeded; }, function ( Needed ) { if ( Needed ) { focus_first( '#jsonx-token-value' ); } } );


		//---------------------------------------------------------------------
		JsonxSession.Start();
	}
] );


//---------------------------------------------------------------------
// Keeps a scrolled pane at its bottom as lines arrive, unless the person has scrolled up.

angular.module( 'JsonxWeb' ).directive( 'jsonxScrollBottom', [ '$timeout',
	function ( $timeout )
	{
		return {
			restrict: 'A',
			link: function ( Scope, Element, Attributes )
			{
				let element = Element[ 0 ];
				Scope.$watch( Attributes.jsonxScrollBottom, function ()
				{
					let at_bottom = ( element.scrollHeight - element.scrollTop - element.clientHeight ) < 40;
					if ( at_bottom ) { $timeout( function () { element.scrollTop = element.scrollHeight; return; } ); }
					return;
				} );
				return;
			},
		};
	}
] );
