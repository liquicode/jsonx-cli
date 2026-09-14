'use strict';

/*
	The Web UI's files (plan F4.5): a page of plain script tags - AngularJS, Bootstrap, Monaco - served by
	the file's own process under /ui/, talking to it only over /ws. Nothing is built into public/.

		GET /ui/                   the page (public/index.html)
		GET /ui/vendor/angular/    the angular package's folder
		GET /ui/vendor/bootstrap/  the bootstrap package's folder
		GET /ui/vendor/monaco/     the monaco-editor package's folder
		GET /ui/config.json        { TokenRequired } (modes/api/Api.js)

	***The page's files carry no file data***, so they are public: a browser cannot send a token loading a
	page (cut 5). The Host and Origin checks still run on them, and the page reaches the file only through
	the WebSocket, with a ticket when a token is needed.

	***A vendor package is found by asking for it, never by joining a path*** (Studio's lesson): the
	workspace hoists node_modules to its root, so a path built from __dirname finds nothing in a checkout
	and something else in an install.
*/

const LIB_PATH = require( 'path' );
const LIB_EXPRESS = require( 'express' );


const ROUTE = '/ui/';
const PUBLIC_FOLDER = LIB_PATH.join( __dirname, 'public' );

// The folder each vendor route serves, by a file resolved inside its package.
const VENDORS = {
	angular: 'angular/angular.min.js',
	bootstrap: 'bootstrap/package.json',
	monaco: 'monaco-editor/package.json',
};


//---------------------------------------------------------------------
function package_folder( Inside, Require )
{
	return LIB_PATH.dirname( ( Require || require ).resolve( Inside ) );
}


//---------------------------------------------------------------------
// Adds the page and its vendor packages to an app, and a browser's GET / sent to the page. Call it before
// the app's 404 handler. Options.Require resolves the vendor packages (a test's).

function AttachUi( App, Options )
{
	let options = ( Options && typeof Options === 'object' ) ? Options : {};
	let static_options = { index: 'index.html', fallthrough: true, redirect: true };

	Object.keys( VENDORS ).forEach( function ( Name )
	{
		App.use( ROUTE + 'vendor/' + Name, LIB_EXPRESS.static( package_folder( VENDORS[ Name ], options.Require ), { fallthrough: true } ) );
	} );
	App.use( ROUTE, LIB_EXPRESS.static( PUBLIC_FOLDER, static_options ) );
	App.get( '/ui', function ( Request, Response ) { Response.redirect( 302, ROUTE ); return; } );
	return;
}


// Whether GET / came from a browser asking for a page, rather than a program asking for the commands.
function WantsPage( Request )
{
	return String( Request.get( 'Accept' ) || '' ).includes( 'text/html' );
}


//---------------------------------------------------------------------
module.exports = {
	ROUTE: ROUTE,
	PUBLIC_FOLDER: PUBLIC_FOLDER,
	VENDORS: VENDORS,
	AttachUi: AttachUi,
	WantsPage: WantsPage,
};
