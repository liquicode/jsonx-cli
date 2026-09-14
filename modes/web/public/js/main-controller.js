'use strict';

/*
	The page: connect to the process, then show what it said. The panes join in later steps (cut 5).
*/

angular.module( 'JsonxWeb' ).controller( 'MainController', [ 'JsonxClient',
	function ( JsonxClient )
	{
		let main = this;

		main.Connection = 'connecting';
		main.Hello = null;
		main.Inventory = null;
		main.Message = null;

		main.ConnectionText = function ()
		{
			if ( main.Connection === 'open' ) { return 'connected'; }
			if ( main.Connection === 'closed' ) { return 'disconnected'; }
			return 'connecting';
		};


		//---------------------------------------------------------------------
		function refresh_inventory()
		{
			return JsonxClient.Send( { Inventory: true } ).then( function ( Answer )
			{
				if ( Answer.Ok ) { main.Inventory = Answer.Result; }
				return;
			} );
		}


		//---------------------------------------------------------------------
		JsonxClient.OnClose( function ()
		{
			main.Connection = 'closed';
			return;
		} );

		JsonxClient.OnEvent( function ( Event )
		{
			if ( Event.Event === 'document' ) { refresh_inventory(); }
			return;
		} );

		JsonxClient.Config().then( function ( Config )
		{
			if ( Config.TokenRequired )
			{
				main.Connection = 'closed';
				main.Message = 'This jsonx process needs a token.';
				return null;
			}
			return JsonxClient.Connect().then( function ( Hello )
			{
				main.Connection = 'open';
				main.Hello = Hello;
				return refresh_inventory();
			} );
		} ).catch( function ( error )
		{
			main.Connection = 'closed';
			main.Message = error.message;
			return;
		} );
	}
] );
