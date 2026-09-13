'use strict';

// The specification's own blocks, read from docs/Jsonx-Specification.md, so the tests hold the
// code to the page rather than to a copy of it.

const LIB_FS = require( 'fs' );
const LIB_PATH = require( 'path' );

const SPEC_FILE = LIB_PATH.resolve( __dirname, '..', '..', 'docs', 'Jsonx-Specification.md' );


function Blocks()
{
	let text = LIB_FS.readFileSync( SPEC_FILE, 'utf8' );
	let pattern = /```\r?\n([\s\S]*?)```/g;
	let blocks = [];
	let found = pattern.exec( text );
	while ( found !== null )
	{
		blocks.push( found[ 1 ] );
		found = pattern.exec( text );
	}
	return blocks;
}


function first_json( Test )
{
	let blocks = Blocks();
	for ( let index = 0; index < blocks.length; index++ )
	{
		let value = null;
		try { value = JSON.parse( blocks[ index ] ); }
		catch ( error ) { continue; }
		if ( Test( value ) ) { return value; }
	}
	throw new Error( 'The specification holds no such block.' );
}


// Appendix A. A fresh parse on every call.
function AppendixA()
{
	return first_json( function ( Value ) { return Value && typeof Value.$schema === 'string'; } );
}


// Appendix B. A fresh parse on every call, so a test may change it.
function AppendixB()
{
	return first_json( function ( Value ) { return Value && typeof Value.Jsonx === 'string'; } );
}


module.exports = {
	SPEC_FILE: SPEC_FILE,
	Blocks: Blocks,
	AppendixA: AppendixA,
	AppendixB: AppendixB,
};
