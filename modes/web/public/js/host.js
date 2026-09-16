'use strict';

/*
	The host interface (plan F4.6): how the Web UI asks for what only its host can give. The contract is
	types/jsonx-host.d.ts.

	-	***The desktop (cut 6) provides `window.JsonxHost`*** from its preload, with every capability; a
		browser gets the implementation below, with the few a page can have.
	-	***The page shows a control only for a capability the host lists***, so the desktop adds
		capabilities without the page changing, and the page is never forked.

	In a browser:
		Notify( Title, Text )           the Notification API, once the person has allowed it; else nothing
		CopyText( Text )                the clipboard
		SaveText( SuggestedName, Text ) a download of the text
	Desktop only, absent here: OpenFile(), RecentFiles(), OpenTerminal().
*/

( function ( Root )
{
	//---------------------------------------------------------------------
	function BrowserHost( Window )
	{
		let window_ = Window;
		let host = {};

		host.Kind = 'browser';

		host.Capabilities = function ()
		{
			return [ 'Notify', 'CopyText', 'SaveText' ];
		};

		host.Notify = function ( Title, Text )
		{
			let Notification_ = window_.Notification;
			if ( typeof Notification_ !== 'function' ) { return Promise.resolve( false ); }
			let show = function () { new Notification_( String( Title ), { body: String( Text || '' ) } ); return true; };
			if ( Notification_.permission === 'granted' ) { return Promise.resolve( show() ); }
			if ( Notification_.permission === 'denied' ) { return Promise.resolve( false ); }
			return Promise.resolve( Notification_.requestPermission() ).then( function ( Permission ) { return ( Permission === 'granted' ) ? show() : false; } );
		};

		host.CopyText = function ( Text )
		{
			let clipboard = window_.navigator && window_.navigator.clipboard;
			if ( !clipboard || typeof clipboard.writeText !== 'function' ) { return Promise.resolve( false ); }
			return clipboard.writeText( String( Text ) ).then( function () { return true; }, function () { return false; } );
		};

		host.SaveText = function ( SuggestedName, Text )
		{
			let document_ = window_.document;
			let blob = new window_.Blob( [ String( Text ) ], { type: 'application/json' } );
			let url = window_.URL.createObjectURL( blob );
			let link = document_.createElement( 'a' );
			link.href = url;
			link.download = String( SuggestedName || 'jsonx.json' );
			document_.body.appendChild( link );
			link.click();
			link.remove();
			window_.setTimeout( function () { window_.URL.revokeObjectURL( url ); }, 1000 );
			return Promise.resolve( true );
		};

		return host;
	}


	//---------------------------------------------------------------------
	// The page's view of a host: what it lists, each capability it provides, and Has( Name ).
	//
	// ***It is a copy, never the host itself***: a desktop host arrives through Electron's contextBridge,
	// which hands the page a frozen object - adding Has to that threw, and the whole page stopped with it
	// (found by jsonx-desktop's first window, 2026-09-16).

	function HostView( Provided )
	{
		let capabilities = Provided.Capabilities();
		let view = {
			Kind: Provided.Kind,
			Capabilities: function () { return capabilities.slice(); },
		};
		capabilities.forEach( function ( Name )
		{
			if ( typeof Provided[ Name ] !== 'function' ) { return; }
			view[ Name ] = function () { return Provided[ Name ].apply( Provided, arguments ); };
		} );
		view.Has = function ( Name ) { return capabilities.includes( Name ) && typeof view[ Name ] === 'function'; };
		return view;
	}


	//---------------------------------------------------------------------
	// Angular's view of the host: the desktop's when there is one, else a browser's.

	if ( Root.angular )
	{
		Root.angular.module( 'JsonxWeb' ).factory( 'JsonxHost', [ '$window',
			function ( $window )
			{
				let provided = ( $window.JsonxHost && typeof $window.JsonxHost.Capabilities === 'function' ) ? $window.JsonxHost : BrowserHost( $window );
				return HostView( provided );
			}
		] );
	}

	// For the test which holds this to types/jsonx-host.d.ts.
	if ( typeof module !== 'undefined' && module.exports ) { module.exports = { BrowserHost: BrowserHost, HostView: HostView }; }
} )( typeof window !== 'undefined' ? window : globalThis );
