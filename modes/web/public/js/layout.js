'use strict';

/*
	Resizable panes (user, 2026-09-15: "add resizing panels"): draggable splitters, lifted from Studio's
	studio-layout.js.

	-	***A splitter writes a CSS variable and nothing else***: the panes are sized by `--inventory-width`,
		`--log-height` and `--input-height` on the root, so dragging sets the variable and the grid does the
		rest. Nothing here measures or knows a pane.
	-	***Monaco is not told***: it is made with automaticLayout and lays itself out.
	-	***The drag listens on the window***, with pointer capture only as an extra, so a pointer moving faster
		than the handle does not lose the gesture (Studio found capture alone could fail and strand a drag).
	-	Double click restores a boundary's default; the arrow keys move it (Shift for larger steps), as the
		separator role promises. Sizes are kept in this browser's storage, wrapped.
*/

angular.module( 'JsonxWeb' ).factory( 'JsonxLayout', [ '$window',
	function ( $window )
	{
		const STORE_PREFIX = 'jsonx-web.layout.';

		// Every boundary, and what it may become: a pane smaller than its minimum is one a person can only lose.
		let boundaries = {
			'--inventory-width': { Default: 300, Min: 180, Max: 720, Axis: 'x' },
			'--log-height': { Default: 260, Min: 80, Max: 1200, Axis: 'y' },
			'--input-height': { Default: 220, Min: 90, Max: 900, Axis: 'y' },
		};

		let layout = {};

		function read_stored( Name, Fallback )
		{
			try
			{
				let value = $window.localStorage.getItem( STORE_PREFIX + Name );
				if ( value === null ) { return Fallback; }
				let number = parseInt( value, 10 );
				return isNaN( number ) ? Fallback : number;
			}
			catch ( error ) { return Fallback; }
		}

		function write_stored( Name, Value )
		{
			try { $window.localStorage.setItem( STORE_PREFIX + Name, String( Value ) ); }
			catch ( error ) { /* a size which cannot be kept still applies now */ }
			return;
		}

		function clamp( Name, Value )
		{
			let boundary = boundaries[ Name ];
			return Math.min( boundary.Max, Math.max( boundary.Min, Value ) );
		}

		layout.BOUNDARIES = boundaries;

		layout.Get = function ( Name ) { return clamp( Name, read_stored( Name, boundaries[ Name ].Default ) ); };

		layout.Set = function ( Name, Value )
		{
			let size = clamp( Name, Math.round( Value ) );
			$window.document.documentElement.style.setProperty( Name, size + 'px' );
			write_stored( Name, size );
			return size;
		};

		layout.Reset = function ( Name ) { return layout.Set( Name, boundaries[ Name ].Default ); };

		layout.Axis = function ( Name ) { return boundaries[ Name ].Axis; };

		// Before the first paint, so a reload does not jump from the defaults to the kept sizes.
		layout.Apply = function ()
		{
			Object.keys( boundaries ).forEach( function ( Name ) { layout.Set( Name, layout.Get( Name ) ); } );
			return;
		};

		layout.Apply();
		return layout;
	}
] );


//---------------------------------------------------------------------
// <div jsonx-split="--inventory-width"></div> between two panes. grows="after" says the pane after the
// handle is the one being sized.

angular.module( 'JsonxWeb' ).directive( 'jsonxSplit', [ 'JsonxLayout', '$window',
	function ( JsonxLayout, $window )
	{
		return {
			restrict: 'A',
			link: function ( Scope, Element, Attributes )
			{
				let name = Attributes.jsonxSplit;
				let axis = JsonxLayout.Axis( name );
				let grows_before = ( Attributes.grows !== 'after' );
				let handle = Element[ 0 ];
				let dragging = false;
				let start_position = 0;
				let start_size = 0;

				handle.classList.add( 'jsonx-split', axis === 'x' ? 'jsonx-split-x' : 'jsonx-split-y' );
				handle.setAttribute( 'role', 'separator' );
				handle.setAttribute( 'tabindex', '0' );
				handle.setAttribute( 'aria-orientation', axis === 'x' ? 'vertical' : 'horizontal' );
				handle.setAttribute( 'title', 'Drag to resize; double click restores; arrow keys move it' );

				function on_pointer_down( Event )
				{
					if ( Event.button !== 0 ) { return; }
					dragging = true;
					start_position = ( axis === 'x' ) ? Event.clientX : Event.clientY;
					start_size = JsonxLayout.Get( name );
					try { handle.setPointerCapture( Event.pointerId ); }
					catch ( error ) { /* the window listeners carry the drag */ }
					$window.addEventListener( 'pointermove', on_pointer_move );
					$window.addEventListener( 'pointerup', on_pointer_up );
					$window.addEventListener( 'pointercancel', on_pointer_up );
					handle.classList.add( 'is-dragging' );
					// No text is selected across the page while dragging.
					$window.document.body.classList.add( 'is-splitting' );
					Event.preventDefault();
					// ***Preventing the default also prevents the focus a click gives***, so the arrow keys after a
					// click would go nowhere (found by the step 6 browser test): the handle takes it itself.
					handle.focus();
					return;
				}

				function on_pointer_move( Event )
				{
					if ( !dragging ) { return; }
					let travelled = ( ( axis === 'x' ) ? Event.clientX : Event.clientY ) - start_position;
					if ( !grows_before ) { travelled = -travelled; }
					JsonxLayout.Set( name, start_size + travelled );
					return;
				}

				function on_pointer_up( Event )
				{
					if ( !dragging ) { return; }
					dragging = false;
					stop_listening();
					try { handle.releasePointerCapture( Event.pointerId ); }
					catch ( error ) { /* never captured */ }
					handle.classList.remove( 'is-dragging' );
					return;
				}

				function stop_listening()
				{
					$window.removeEventListener( 'pointermove', on_pointer_move );
					$window.removeEventListener( 'pointerup', on_pointer_up );
					$window.removeEventListener( 'pointercancel', on_pointer_up );
					$window.document.body.classList.remove( 'is-splitting' );
					return;
				}

				function on_double_click() { JsonxLayout.Reset( name ); return; }

				function on_key_down( Event )
				{
					let step = Event.shiftKey ? 50 : 10;
					let forward = ( axis === 'x' ) ? 'ArrowRight' : 'ArrowDown';
					let backward = ( axis === 'x' ) ? 'ArrowLeft' : 'ArrowUp';
					if ( Event.key !== forward && Event.key !== backward ) { return; }
					let travelled = ( Event.key === forward ) ? step : -step;
					if ( !grows_before ) { travelled = -travelled; }
					JsonxLayout.Set( name, JsonxLayout.Get( name ) + travelled );
					Event.preventDefault();
					Event.stopPropagation();
					return;
				}

				handle.addEventListener( 'pointerdown', on_pointer_down );
				handle.addEventListener( 'dblclick', on_double_click );
				handle.addEventListener( 'keydown', on_key_down );

				// A splitter destroyed mid-drag takes its window listeners with it.
				Scope.$on( '$destroy', function ()
				{
					stop_listening();
					handle.removeEventListener( 'pointerdown', on_pointer_down );
					handle.removeEventListener( 'dblclick', on_double_click );
					handle.removeEventListener( 'keydown', on_key_down );
					return;
				} );
				return;
			},
		};
	}
] );
