'use strict';

/*
	MCP over standard input and output: one JSON-RPC message per line each way (revision 2025-11-25).

	***Nothing but MCP messages goes to standard output***; everything a person reads goes to standard
	error. Requests are answered as each finishes, not in the order they arrived - JSON-RPC matches a
	reply by its id - and the held session's queue orders what they run. The end of input ends the
	connection, after every request already read has been answered.
*/

const Protocol = require( './Protocol.js' );


//---------------------------------------------------------------------
// Serves one connection. Lines is an async iterable of text lines; Write( Text ) writes to standard
// output. Resolves when the input has ended and every reply is written.

async function ServeStdio( Mcp, Lines, Write )
{
	let pending = new Set();

	// A message the server starts - a profile switch's list_changed - is one more line out.
	if ( typeof Mcp.OnNotify === 'function' )
	{
		Mcp.OnNotify( function ( Message ) { Write( JSON.stringify( Message ) + '\n' ); } );
	}

	for await ( let line of Lines )
	{
		let text = String( line ).trim();
		if ( text === '' ) { continue; }

		let work = Mcp.HandleText( text ).then( function ( Reply )
		{
			// A reply never holds a raw newline: JSON.stringify escapes those inside strings.
			if ( Reply !== null ) { Write( JSON.stringify( Reply ) + '\n' ); }
			return;
		}, function ( error )
		{
			Write( JSON.stringify( { jsonrpc: '2.0', id: null, error: { code: Protocol.ERRORS.INTERNAL_ERROR, message: 'Internal error: ' + error.message } } ) + '\n' );
			return;
		} );
		pending.add( work );
		work.then( function () { pending.delete( work ); } );
	}

	await Promise.all( Array.from( pending ) );
	// A notification a reply caused goes out a turn later (Protocol.js): give it that turn.
	await new Promise( function ( Resolve ) { setImmediate( Resolve ); } );
	if ( typeof Mcp.Close === 'function' ) { Mcp.Close(); }
	return;
}


//---------------------------------------------------------------------
module.exports = {
	ServeStdio: ServeStdio,
};
