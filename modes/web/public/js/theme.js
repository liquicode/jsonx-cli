'use strict';

/*
	Light, dark or the system's; small, normal or large (jsongin.git/CLAUDE.md); and which panes are
	collapsed. Kept in this browser's storage.

	-	***Three theme states, not two*** (Studio's lesson): `system` follows prefers-color-scheme and
		changes when the machine does.
	-	***Bootstrap 5.3 themes itself from `data-bs-theme`***, and every colour on the page is a Bootstrap
		variable, so the page needs no palette of its own. Monaco paints its own editor and is told
		separately (`vs` or `vs-dark`).
	-	***Scale is the root font size***, and everything on the page is in rem; Monaco's font size follows.
	-	***Storage is wrapped***, because a browser can refuse it: a setting which cannot be kept still applies.
*/

angular.module( 'JsonxWeb' ).factory( 'JsonxView', [ '$rootScope', '$window',
	function ( $rootScope, $window )
	{
		const STORE = 'jsonx-web.view';
		const MODES = [ 'light', 'system', 'dark' ];
		const SCALES = [ 'small', 'normal', 'large' ];
		const PANES = [ 'Inventory', 'Log', 'Rows' ];
		// The root font size and Monaco's, per scale.
		const SIZES = { small: { Root: 12, Editor: 11 }, normal: { Root: 14, Editor: 13 }, large: { Root: 17, Editor: 16 } };

		let dark_query = $window.matchMedia ? $window.matchMedia( '( prefers-color-scheme: dark )' ) : null;

		let view = {
			Mode: 'system',
			Scale: 'normal',
			Collapsed: { Inventory: false, Log: false, Rows: false },
			// What the page draws with, worked out from the above.
			Dark: false,
			Monaco: 'vs',
			EditorFontSize: SIZES.normal.Editor,
			MODES: MODES,
			SCALES: SCALES,
		};


		//---------------------------------------------------------------------
		function read()
		{
			try
			{
				let saved = JSON.parse( $window.localStorage.getItem( STORE ) || '{}' );
				if ( MODES.includes( saved.Mode ) ) { view.Mode = saved.Mode; }
				if ( SCALES.includes( saved.Scale ) ) { view.Scale = saved.Scale; }
				if ( saved.Collapsed && typeof saved.Collapsed === 'object' ) { PANES.forEach( function ( Pane ) { view.Collapsed[ Pane ] = ( saved.Collapsed[ Pane ] === true ); } ); }
			}
			catch ( error ) { /* nothing kept, or storage refused */ }
			return;
		}

		function write()
		{
			try { $window.localStorage.setItem( STORE, JSON.stringify( { Mode: view.Mode, Scale: view.Scale, Collapsed: view.Collapsed } ) ); }
			catch ( error ) { /* a setting which cannot be kept still applies now */ }
			return;
		}

		function apply()
		{
			let root = $window.document.documentElement;
			view.Dark = ( view.Mode === 'dark' ) || ( view.Mode === 'system' && dark_query !== null && dark_query.matches );
			root.setAttribute( 'data-bs-theme', view.Dark ? 'dark' : 'light' );
			root.setAttribute( 'data-theme-mode', view.Mode );
			root.setAttribute( 'data-scale', view.Scale );
			root.style.fontSize = SIZES[ view.Scale ].Root + 'px';
			view.Monaco = view.Dark ? 'vs-dark' : 'vs';
			view.EditorFontSize = SIZES[ view.Scale ].Editor;
			$rootScope.$broadcast( 'jsonx.view-changed', view );
			return;
		}


		//---------------------------------------------------------------------
		view.SetMode = function ( Mode )
		{
			if ( !MODES.includes( Mode ) ) { return; }
			view.Mode = Mode;
			write();
			apply();
			return;
		};

		view.SetScale = function ( Scale )
		{
			if ( !SCALES.includes( Scale ) ) { return; }
			view.Scale = Scale;
			write();
			apply();
			return;
		};

		view.TogglePane = function ( Pane )
		{
			if ( !PANES.includes( Pane ) ) { return; }
			view.Collapsed[ Pane ] = !view.Collapsed[ Pane ];
			write();
			$rootScope.$broadcast( 'jsonx.view-changed', view );
			return;
		};


		//---------------------------------------------------------------------
		// Applied as the module starts, before the page is drawn, so a reload does not flash the defaults.
		read();
		apply();
		if ( dark_query !== null && typeof dark_query.addEventListener === 'function' )
		{
			dark_query.addEventListener( 'change', function ()
			{
				if ( view.Mode !== 'system' ) { return; }
				$rootScope.$applyAsync( apply );
				return;
			} );
		}

		return view;
	}
] );
