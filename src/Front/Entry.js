'use strict';

/*
	What is typed into a front end's Input (plan F5.2), read with no screen and no socket: whether it is
	a command or a JSON entry, and for an entry which noun and name it saves as, and the `add` or `set`
	that saves or checks it.

	Moved from the TUI model's SetInput and edit_invocation (cut 5, step 1).
*/

const Names = require( '../File/Names.js' );
const Inventory = require( './Inventory.js' );


//---------------------------------------------------------------------
function is_object( Value )
{
	return ( Value !== null ) && ( typeof Value === 'object' ) && !Array.isArray( Value );
}


//---------------------------------------------------------------------
// Input's text, read against the document it would change:
//
//		{ Mode: 'empty' | 'command' | 'json', Syntax: { Message } | null,
//		  Target: { Noun, Name, Exists, Entry, Current } | null }
//
// Target is set only for JSON which is an entry with a Name. Exists and Current are as the document
// given has them; a front end whose copy may lag reads the entry again before it saves (EditInvocation).

function ReadEntry( Text, Document )
{
	let text = String( ( typeof Text === 'undefined' || Text === null ) ? '' : Text );
	let read = { Mode: 'empty', Syntax: null, Target: null };

	if ( text.trim() === '' ) { return read; }
	if ( text.trim()[ 0 ] !== '{' ) { read.Mode = 'command'; return read; }

	read.Mode = 'json';
	let entry = null;
	try
	{
		entry = JSON.parse( text );
	}
	catch ( error )
	{
		// Node gives a position for some mistakes and not others (cut 1): the message as it is.
		read.Syntax = { Message: error.message };
		return read;
	}
	let noun = Inventory.NounOf( entry );
	if ( noun === null )
	{
		read.Syntax = { Message: 'This is not an entry of a jsonx file: give it a Kind, an AdapterName (a data source), or a Process (a trigger).' };
	}
	else if ( typeof entry.Name !== 'string' || entry.Name === '' )
	{
		read.Syntax = { Message: 'An entry needs a Name.' };
	}
	else
	{
		let existing = Names.FindEntry( is_object( Document ) ? Document : {}, entry.Name );
		read.Target = { Noun: noun, Name: entry.Name, Exists: existing !== null, Entry: entry, Current: existing ? existing.Entry : null };
	}
	return read;
}


//---------------------------------------------------------------------
// The invocation which saves a target: `set` with a body making the entry exactly the one typed when it
// exists, else `add`. With Check, the same with `check: true`, which writes nothing.

function EditInvocation( Target, Check )
{
	let invocation = Target.Exists
		? { Command: [ Target.Noun, 'set' ], name: Target.Name, json: Inventory.ReplacementBody( Target.Current, Target.Entry ) }
		: { Command: [ Target.Noun, 'add' ], json: Target.Entry };
	if ( Check === true ) { invocation.check = true; }
	return invocation;
}


//---------------------------------------------------------------------
module.exports = {
	ReadEntry: ReadEntry,
	EditInvocation: EditInvocation,
};
