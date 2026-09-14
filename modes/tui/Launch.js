'use strict';

/*
	Starting a file's jsonx process for the TUI (cut 4, decision 2), as the desktop will start one per
	file in cut 6: `jsonx serve --api --attached --port 0`, then its ready line.

	-	***`--attached`***: the child stops when its standard input ends, so Stop ends it cleanly - its data
		sources flushed and released, `Stopped.` said - where a kill would flush nothing. Where a child
		outlives its parent, it also stops when the TUI dies. ***On Windows the child dies with a Node
		parent anyway*** (measured 2026-09-14: silently, with or without --attached).
	-	***`--port 0`***: the child picks a free port and says which in its ready line, so two TUIs on
		one machine never collide.
	-	***A child which exits before its ready line*** is answered with its own exit code and standard
		error, so `jsonx tui` exits as `jsonx serve` would have: 3 for a file which is not a jsonx file.
*/

const LIB_CHILD_PROCESS = require( 'child_process' );
const LIB_PATH = require( 'path' );
const LIB_READLINE = require( 'readline' );


const BIN = LIB_PATH.resolve( __dirname, '..', '..', 'bin', 'jsonx.js' );
const READY_MS = 10000;
const STOP_MS = 5000;


//---------------------------------------------------------------------
class LaunchError extends Error
{
	constructor( Message, ExitCode, Stderr )
	{
		super( Message );
		this.name = 'LaunchError';
		this.ExitCode = ( typeof ExitCode === 'number' ) ? ExitCode : 1;
		this.Stderr = Stderr || '';
	}
}


//---------------------------------------------------------------------
// Options: File, Binds, Sets (as jsonx serve takes them), Env, Cwd, ReadyMs, Bin.
// Resolves with { Ready, Child, Stderr(), Stop() }; rejects with LaunchError.

function Start( Options )
{
	let options = ( Options && typeof Options === 'object' ) ? Options : {};
	let argv = [ options.Bin || BIN, 'serve', '--api', '--attached', '--port', '0' ];
	if ( typeof options.File === 'string' && options.File !== '' ) { argv.push( '--file', options.File ); }
	( options.Binds || [] ).forEach( function ( Bind ) { argv.push( '--bind', Bind ); } );
	( options.Sets || [] ).forEach( function ( Set ) { argv.push( '--set', Set ); } );

	let child = LIB_CHILD_PROCESS.spawn( process.execPath, argv, {
		cwd: options.Cwd || process.cwd(),
		env: options.Env || process.env,
		stdio: [ 'pipe', 'pipe', 'pipe' ],
		windowsHide: true,
	} );

	let stderr = '';
	child.stderr.setEncoding( 'utf8' );
	child.stderr.on( 'data', function ( Chunk ) { stderr += Chunk; } );

	let exited = new Promise( function ( Resolve ) { child.once( 'exit', function ( Code, Signal ) { Resolve( { Code: Code, Signal: Signal } ); } ); } );

	let launched = {
		Child: child,
		Ready: null,
		Stderr: function () { return stderr; },
	};

	// Ends the child's standard input, and waits for it to stop; kills it if it does not.
	launched.Stop = async function ()
	{
		if ( child.exitCode !== null || child.signalCode !== null ) { return await exited; }
		try { child.stdin.end(); } catch ( error ) { /* already closed */ }
		let timer = null;
		let outcome = await Promise.race( [ exited, new Promise( function ( Resolve ) { timer = setTimeout( function () { Resolve( null ); }, STOP_MS ); } ) ] );
		clearTimeout( timer );
		if ( outcome === null ) { child.kill(); outcome = await exited; }
		return outcome;
	};

	return new Promise( function ( Resolve, Reject )
	{
		let lines = LIB_READLINE.createInterface( { input: child.stdout } );
		let settled = false;

		let timer = setTimeout( function ()
		{
			if ( settled ) { return; }
			settled = true;
			lines.close();
			launched.Stop().then( function () { Reject( new LaunchError( 'jsonx serve did not say it was ready within ' + ( options.ReadyMs || READY_MS ) + ' ms.', 1, stderr ) ); } );
		}, options.ReadyMs || READY_MS );

		lines.once( 'line', function ( Line )
		{
			if ( settled ) { return; }
			settled = true;
			clearTimeout( timer );
			lines.close();
			let ready = null;
			try { ready = JSON.parse( Line ); } catch ( error ) { ready = null; }
			if ( !ready || typeof ready.Ws !== 'string' )
			{
				launched.Stop().then( function () { Reject( new LaunchError( 'jsonx serve wrote something other than its ready line: ' + Line, 1, stderr ) ); } );
				return;
			}
			launched.Ready = ready;
			Resolve( launched );
		} );

		exited.then( function ( Outcome )
		{
			if ( settled ) { return; }
			settled = true;
			clearTimeout( timer );
			let code = ( typeof Outcome.Code === 'number' ) ? Outcome.Code : 1;
			Reject( new LaunchError( 'jsonx serve stopped before it was ready (exit ' + code + ').', code, stderr ) );
		} );

		child.once( 'error', function ( error )
		{
			if ( settled ) { return; }
			settled = true;
			clearTimeout( timer );
			Reject( new LaunchError( 'jsonx serve could not start: ' + error.message, 1, stderr ) );
		} );
	} );
}


//---------------------------------------------------------------------
module.exports = {
	BIN: BIN,
	READY_MS: READY_MS,
	LaunchError: LaunchError,
	Start: Start,
};
