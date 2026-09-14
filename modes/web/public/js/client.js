'use strict';

/*
	The page's connection to its jsonx process: the browser's WebSocket at /ws on the page's own host.

	-	***Ids are the page's***: every request gets one, and whatever arrives under it - events, then the
		Answer - goes to that request. An Answer is always last for its Id.
	-	What belongs to the file (reload, document, queue) goes to every OnEvent listener.
	-	***A closed connection is shown, not retried***: the process may have stopped, and a page which
		quietly reconnects to a restarted process would hold a document which is no longer the file's.
	-	When the process needs a token, the page asks /ws/ticket for a one-use ticket and upgrades with it
		(cut 5), since a browser cannot send Authorization on a WebSocket.
*/

angular.module( 'JsonxWeb' ).factory( 'JsonxClient', [ '$window', '$q', '$rootScope',
	function ( $window, $q, $rootScope )
	{
		let socket = null;
		let next_id = 0;
		let pending = {};
		let event_listeners = [];
		let close_listeners = [];

		let client = {
			State: 'connecting',
			Hello: null,
			Closed: null,
		};


		//---------------------------------------------------------------------
		function apply( Work )
		{
			$rootScope.$applyAsync( Work );
			return;
		}

		function socket_url( Ticket )
		{
			let location = $window.location;
			let url = ( location.protocol === 'https:' ? 'wss:' : 'ws:' ) + '//' + location.host + '/ws';
			if ( Ticket ) { url += '?ticket=' + encodeURIComponent( Ticket ); }
			return url;
		}


		//---------------------------------------------------------------------
		// Whether the process needs a token: { TokenRequired }.
		client.Config = function ()
		{
			return $q.when( $window.fetch( 'config.json', { cache: 'no-store' } ).then( function ( Response ) { return Response.json(); } ) );
		};

		// A one-use ticket for the WebSocket, asked for with the token.
		client.Ticket = function ( Token )
		{
			return $q.when( $window.fetch( '../ws/ticket', { method: 'POST', headers: { Authorization: 'Bearer ' + Token } } ).then( function ( Response )
			{
				if ( Response.status !== 200 ) { throw new Error( 'The token was refused (' + Response.status + ').' ); }
				return Response.json();
			} ) );
		};


		//---------------------------------------------------------------------
		// Opens the connection. Resolves with Hello; rejects when it does not open.
		client.Connect = function ( Ticket )
		{
			let deferred = $q.defer();
			client.State = 'connecting';
			socket = new $window.WebSocket( socket_url( Ticket ) );

			socket.onmessage = function ( Event )
			{
				let message = null;
				try { message = JSON.parse( Event.data ); }
				catch ( error ) { return; }

				if ( message.Hello )
				{
					apply( function ()
					{
						client.Hello = message.Hello;
						client.State = 'open';
						deferred.resolve( message.Hello );
					} );
					return;
				}
				if ( typeof message.Id === 'string' && pending[ message.Id ] )
				{
					let request = pending[ message.Id ];
					if ( message.Answer )
					{
						delete pending[ message.Id ];
						apply( function () { request.Resolve( message.Answer ); } );
					}
					else if ( request.Listen )
					{
						apply( function () { request.Listen( message ); } );
					}
					return;
				}
				if ( message.Event )
				{
					apply( function () { event_listeners.slice().forEach( function ( Listener ) { Listener( message ); } ); } );
				}
				return;
			};

			socket.onclose = function ( Event )
			{
				apply( function ()
				{
					client.State = 'closed';
					client.Closed = { Code: Event.code, Reason: Event.reason };
					deferred.reject( new Error( 'The connection to the jsonx process did not open.' ) );
					Object.keys( pending ).forEach( function ( Id )
					{
						pending[ Id ].Resolve( { Ok: false, ExitCode: 1, Findings: [], Log: [ 'The connection to the jsonx process closed.' ] } );
						delete pending[ Id ];
					} );
					close_listeners.slice().forEach( function ( Listener ) { Listener( client.Closed ); } );
				} );
				return;
			};

			return deferred.promise;
		};


		//---------------------------------------------------------------------
		// Sends one request - { Invoke }, { Read }, { Line }, ... - and resolves with its Answer envelope.
		// Listen hears the events which arrive under its Id first.
		client.Send = function ( Request, Listen )
		{
			if ( socket === null || socket.readyState !== $window.WebSocket.OPEN )
			{
				return $q.resolve( { Ok: false, ExitCode: 1, Findings: [], Log: [ 'Not connected to the jsonx process.' ] } );
			}
			next_id++;
			let id = 'p' + next_id;
			let deferred = $q.defer();
			pending[ id ] = { Resolve: deferred.resolve, Listen: Listen || null };
			socket.send( JSON.stringify( Object.assign( { Id: id }, Request ) ) );
			return deferred.promise;
		};

		client.Invoke = function ( Invocation, Listen ) { return client.Send( { Invoke: Invocation }, Listen ); };

		client.OnEvent = function ( Listener ) { event_listeners.push( Listener ); return; };
		client.OnClose = function ( Listener ) { close_listeners.push( Listener ); return; };

		return client;
	}
] );
