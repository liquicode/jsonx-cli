'use strict';

/*
	The host interface (cut 5, step 6): modes/web/public/js/host.js's browser implementation held to its
	hand-written contract, types/jsonx-host.d.ts, with no browser - the contract read from the file, and the
	implementation driven over stub windows.
*/

const LIB_ASSERT = require( 'assert' );
const LIB_FS = require( 'fs' );
const LIB_PATH = require( 'path' );
const { describe, it } = require( 'node:test' );

const Host = require( '../modes/web/public/js/host.js' );

const DTS = LIB_FS.readFileSync( LIB_PATH.join( __dirname, '..', 'types', 'jsonx-host.d.ts' ), 'utf8' );


// The members of `interface JsonxHost` in the .d.ts: { Name, Optional, Method }.
function contract()
{
	let body = /export interface JsonxHost\s*\{([\s\S]*?)\n\}/.exec( DTS )[ 1 ];
	let members = [];
	let pattern = /^\t(\w+)(\?)?(\()?/gm;
	let found = pattern.exec( body );
	while ( found !== null )
	{
		members.push( { Name: found[ 1 ], Optional: found[ 2 ] === '?', Method: found[ 3 ] === '(' } );
		found = pattern.exec( body );
	}
	return members;
}

function capability_names()
{
	let union = /export type JsonxHostCapability\s*=([\s\S]*?);/.exec( DTS )[ 1 ];
	return union.match( /'(\w+)'/g ).map( function ( Quoted ) { return Quoted.slice( 1, -1 ); } );
}


//---------------------------------------------------------------------
describe( 'The host interface', function ()
{

	it( 'is implemented by the browser host as the declaration says', function ()
	{
		let members = contract();
		LIB_ASSERT.deepStrictEqual( members.map( function ( Each ) { return Each.Name; } ), [ 'Kind', 'Capabilities', 'Notify', 'CopyText', 'SaveText', 'OpenFile', 'NewFile', 'OpenPath', 'RecentFiles', 'OpenTerminal' ] );
		let host = Host.BrowserHost( {} );

		// Every member which is not optional is there, a method as a function.
		members.filter( function ( Each ) { return !Each.Optional; } ).forEach( function ( Each )
		{
			LIB_ASSERT.ok( Each.Name in host, Each.Name );
			if ( Each.Method ) { LIB_ASSERT.strictEqual( typeof host[ Each.Name ], 'function', Each.Name ); }
		} );
		// Every capability it lists is a declared name, is a function on it, and is a declared member.
		let declared = capability_names();
		host.Capabilities().forEach( function ( Name )
		{
			LIB_ASSERT.ok( declared.includes( Name ), Name );
			LIB_ASSERT.strictEqual( typeof host[ Name ], 'function', Name );
			LIB_ASSERT.ok( members.some( function ( Each ) { return Each.Name === Name && Each.Method; } ), Name );
		} );
		// Every declared capability is a member, and the desktop's are optional and absent in a browser.
		declared.forEach( function ( Name ) { LIB_ASSERT.ok( members.some( function ( Each ) { return Each.Name === Name; } ), Name ); } );
		[ 'OpenFile', 'NewFile', 'OpenPath', 'RecentFiles', 'OpenTerminal' ].forEach( function ( Name )
		{
			LIB_ASSERT.ok( members.find( function ( Each ) { return Each.Name === Name; } ).Optional, Name );
			LIB_ASSERT.strictEqual( host[ Name ], undefined, Name );
			LIB_ASSERT.ok( !host.Capabilities().includes( Name ), Name );
		} );
		LIB_ASSERT.strictEqual( host.Kind, 'browser' );
	} );


	it( 'is used through a view, so a frozen host works as a desktop really provides it', async function ()
	{
		// Electron's contextBridge hands the page a frozen object: writing to it throws, and the page
		// stopped with it (found by jsonx-desktop's first window, 2026-09-16).
		let called = [];
		let desktop = Object.freeze( {
			Kind: 'desktop',
			Capabilities: function () { return [ 'Notify', 'CopyText', 'OpenFile' ]; },
			Notify: function ( Title, Text ) { called.push( [ 'Notify', Title, Text ] ); return Promise.resolve( true ); },
			CopyText: function ( Text ) { called.push( [ 'CopyText', Text ] ); return Promise.resolve( true ); },
			OpenFile: function () { called.push( [ 'OpenFile' ] ); return Promise.resolve( { Path: 'C:\\season\\observatory.jsonx' } ); },
		} );
		LIB_ASSERT.ok( !Object.isExtensible( desktop ) );

		let view = Host.HostView( desktop );
		LIB_ASSERT.strictEqual( view.Kind, 'desktop' );
		LIB_ASSERT.deepStrictEqual( view.Capabilities(), [ 'Notify', 'CopyText', 'OpenFile' ] );
		LIB_ASSERT.strictEqual( view.Has( 'OpenFile' ), true );
		LIB_ASSERT.strictEqual( view.Has( 'SaveText' ), false );
		LIB_ASSERT.strictEqual( view.SaveText, undefined );

		// Each call reaches the host it came from, with its arguments and its answer.
		LIB_ASSERT.strictEqual( await view.Notify( 'jsonx', 'run finished' ), true );
		LIB_ASSERT.strictEqual( await view.CopyText( '{"a":1}' ), true );
		LIB_ASSERT.deepStrictEqual( ( await view.OpenFile() ).Path, 'C:\\season\\observatory.jsonx' );
		LIB_ASSERT.deepStrictEqual( called, [ [ 'Notify', 'jsonx', 'run finished' ], [ 'CopyText', '{"a":1}' ], [ 'OpenFile' ] ] );

		// The host itself is never written to.
		LIB_ASSERT.strictEqual( desktop.Has, undefined );

		// A browser host goes through the same view.
		let browser = Host.HostView( Host.BrowserHost( { navigator: {} } ) );
		LIB_ASSERT.strictEqual( browser.Kind, 'browser' );
		LIB_ASSERT.deepStrictEqual( browser.Capabilities(), [ 'Notify', 'CopyText', 'SaveText' ] );
		LIB_ASSERT.strictEqual( browser.Has( 'OpenFile' ), false );
	} );


	it( 'copies, saves and notifies through what the window has, and says false when it cannot', async function ()
	{
		// Copy.
		let copied = null;
		let with_clipboard = Host.BrowserHost( { navigator: { clipboard: { writeText: function ( Text ) { copied = Text; return Promise.resolve(); } } } } );
		LIB_ASSERT.strictEqual( await with_clipboard.CopyText( '{"a":1}' ), true );
		LIB_ASSERT.strictEqual( copied, '{"a":1}' );
		LIB_ASSERT.strictEqual( await Host.BrowserHost( { navigator: {} } ).CopyText( 'x' ), false );
		let refusing = Host.BrowserHost( { navigator: { clipboard: { writeText: function () { return Promise.reject( new Error( 'no' ) ); } } } } );
		LIB_ASSERT.strictEqual( await refusing.CopyText( 'x' ), false );

		// Save: a download link clicked with the suggested name and the text.
		let clicked = null;
		let appended = [];
		let fake_window = {
			Blob: function ( Parts, Options ) { this.Text = Parts.join( '' ); this.Type = Options.type; },
			URL: { createObjectURL: function ( Blob ) { return 'blob:' + Blob.Text; }, revokeObjectURL: function () {} },
			setTimeout: function ( Work ) { Work(); },
			document: {
				body: { appendChild: function ( Element ) { appended.push( Element ); } },
				createElement: function () { let link = { click: function () { clicked = { Href: link.href, Download: link.download }; }, remove: function () {} }; return link; },
			},
		};
		LIB_ASSERT.strictEqual( await Host.BrowserHost( fake_window ).SaveText( 'rows.json', '[1,2]' ), true );
		LIB_ASSERT.deepStrictEqual( clicked, { Href: 'blob:[1,2]', Download: 'rows.json' } );
		LIB_ASSERT.strictEqual( appended.length, 1 );

		// Notify: shown when granted, asked when not decided, and never when denied or missing.
		let shown = [];
		function notification( Permission, Answer )
		{
			let Notification_ = function ( Title, Options ) { shown.push( [ Title, Options.body ] ); };
			Notification_.permission = Permission;
			Notification_.requestPermission = function () { return Promise.resolve( Answer ); };
			return { Notification: Notification_ };
		}
		LIB_ASSERT.strictEqual( await Host.BrowserHost( notification( 'granted' ) ).Notify( 'jsonx', 'run finished' ), true );
		LIB_ASSERT.strictEqual( await Host.BrowserHost( notification( 'default', 'granted' ) ).Notify( 'jsonx', 'asked' ), true );
		LIB_ASSERT.strictEqual( await Host.BrowserHost( notification( 'default', 'denied' ) ).Notify( 'jsonx', 'refused' ), false );
		LIB_ASSERT.strictEqual( await Host.BrowserHost( notification( 'denied' ) ).Notify( 'jsonx', 'denied' ), false );
		LIB_ASSERT.strictEqual( await Host.BrowserHost( {} ).Notify( 'jsonx', 'none' ), false );
		LIB_ASSERT.deepStrictEqual( shown, [ [ 'jsonx', 'run finished' ], [ 'jsonx', 'asked' ] ] );
	} );

} );
