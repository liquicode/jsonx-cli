'use strict';

/*
	The page: the session's state drawn, and a person's keys and clicks handed to it. Presentation only -
	how a badge, a cell or a page number reads.
*/

angular.module( 'JsonxWeb' ).controller( 'MainController', [ 'JsonxSession', '$timeout', '$document',
	function ( JsonxSession, $timeout, $document )
	{
		let main = this;
		let state = JsonxSession.State;

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

		// While a dialog is open it takes the keys: y and n answer a confirmation, Escape closes.
		main.OnKey = function ( Event )
		{
			if ( state.Confirm )
			{
				if ( Event.key === 'y' || Event.key === 'Y' ) { Event.preventDefault(); JsonxSession.Confirm( true ); }
				else if ( Event.key === 'n' || Event.key === 'N' || Event.key === 'Escape' ) { Event.preventDefault(); JsonxSession.Confirm( false ); }
				return;
			}
			if ( ( state.Menu || state.Json ) && Event.key === 'Escape' )
			{
				Event.preventDefault();
				JsonxSession.CloseActions();
				JsonxSession.CloseJson();
			}
			return;
		};

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
