'use strict';

/*
	Completion of what is typed at the end of a front end's Input (plan F5.2), with no screen and no
	socket: a command line completes from the command tree and the file's names, and JSON completes
	operators, declared names and a data source's fields.

	Moved from the TUI model's Complete (cut 5, step 1). ***Fields are the caller's to find***: they come
	from `datasource describe`, which opens the data source, so CompleteText asks Options.Fields for what
	is known now and never waits.
*/

const Words = require( '../CommandLine/Words.js' );
const Complete = require( '../CommandLine/Complete.js' );
const Names = require( '../File/Names.js' );


//---------------------------------------------------------------------
// Where the end of a JSON text is, for completion:
//
//		{ In: 'string', Prefix, Key, IsKey }   typing inside a string; Key is the key it is the value of
//		{ In: 'none' }                          anywhere else

function JsonContext( Text )
{
	let text = String( Text );
	let in_string = false;
	let start = -1;
	for ( let index = 0; index < text.length; index++ )
	{
		let ch = text[ index ];
		if ( in_string )
		{
			if ( ch === '\\' ) { index++; continue; }
			if ( ch === '"' ) { in_string = false; }
			continue;
		}
		if ( ch === '"' ) { in_string = true; start = index; }
	}
	if ( !in_string ) { return { In: 'none' }; }

	let before = text.slice( 0, start ).replace( /\s+$/, '' );
	let is_key = before === '' || /[{,]$/.test( before );
	let key = null;
	if ( !is_key )
	{
		let match = /"((?:[^"\\]|\\.)*)"\s*:\s*\[?\s*$/.exec( before );
		if ( match ) { key = match[ 1 ]; }
	}
	return { In: 'string', Prefix: text.slice( start + 1 ), Key: key, IsKey: is_key };
}


//---------------------------------------------------------------------
function complete_json( Text, Document, Operators, Fields )
{
	let context = JsonContext( Text );
	if ( context.In !== 'string' ) { return { Prefix: '', Candidates: [], Json: true }; }
	let prefix = context.Prefix;
	let pool = [];
	let entries = Names.Entries( Document || {} );
	let names_where = function ( Test ) { return entries.filter( Test ).map( function ( Item ) { return Item.Name; } ); };

	if ( prefix.startsWith( '$' ) )
	{
		pool = Operators || [];
	}
	else if ( !context.IsKey && context.Key === 'Name' && /"\$call"/.test( Text ) )
	{
		pool = Names.HOST_FUNCTIONS.concat( names_where( function ( Item ) { return Item.Section === 'Objects'; } ) );
	}
	else if ( !context.IsKey && ( context.Key === 'DataSource' || context.Key === 'Into' ) )
	{
		pool = names_where( function ( Item ) { return Item.Section === 'DataSources'; } );
	}
	else if ( !context.IsKey && context.Key === 'Process' )
	{
		pool = names_where( function ( Item ) { return Item.Section === 'Objects' && Item.Entry.Kind === 'Process'; } );
	}
	else if ( context.IsKey )
	{
		let match = /"DataSource"\s*:\s*"((?:[^"\\]|\\.)*)"/.exec( Text );
		if ( match ) { pool = Fields( match[ 1 ] ) || []; }
	}

	let seen = [];
	let candidates = pool.filter( function ( Candidate )
	{
		if ( seen.includes( Candidate ) || !String( Candidate ).startsWith( prefix ) ) { return false; }
		seen.push( Candidate );
		return true;
	} );
	return { Prefix: prefix, Candidates: candidates, Json: true };
}


//---------------------------------------------------------------------
// The candidates for the end of Input's text: { Prefix, Candidates, Json }. Prefix is what is being
// typed, which a candidate replaces.
//
// Options:
//		Document    the jsonx file names come from
//		Operators   every operator name, for a JSON string beginning with $
//		Fields      function ( DataSource ): the field names known now, or null

function CompleteText( Tree, Text, Io, Options )
{
	let options = ( Options && typeof Options === 'object' ) ? Options : {};
	let text = String( ( typeof Text === 'undefined' || Text === null ) ? '' : Text );
	let fields = ( typeof options.Fields === 'function' ) ? options.Fields : function () { return null; };

	if ( text.trim()[ 0 ] === '{' ) { return complete_json( text, options.Document, options.Operators, fields ); }

	let split = Words.SplitWords( text );
	// A JSON option still being typed completes as JSON does.
	if ( split.Open === '{' || split.Open === '[' ) { return complete_json( split.Current, options.Document, options.Operators, fields ); }
	let words = split.Words.slice();
	if ( words[ 0 ] === 'jsonx' ) { words.shift(); }
	if ( split.Current === '' || words.length === 0 ) { words.push( '' ); }
	let prefix = words[ words.length - 1 ];
	let candidates = Complete.Candidates( Tree, words, Io, { Document: options.Document } );
	return { Prefix: prefix, Candidates: candidates, Json: false };
}


//---------------------------------------------------------------------
// What choosing each candidate does to the text: { Label, Insert, Replace } - Replace characters before the
// end are replaced by Insert. A name is quoted as SplitWords reads it back, and a quoted name replaces a
// quote already typed (moved from the TUI model's ApplyCompletion, cut 5, step 5).

function CompletionItems( Text, Completion )
{
	let text = String( ( typeof Text === 'undefined' || Text === null ) ? '' : Text );
	let prefix = String( Completion.Prefix || '' );
	return ( Completion.Candidates || [] ).map( function ( Candidate )
	{
		let insert = Completion.Json ? String( Candidate ) : Words.QuoteWord( String( Candidate ) );
		let replace = prefix.length;
		let base = text.slice( 0, text.length - replace );
		if ( !Completion.Json && insert[ 0 ] === '"' && /["']$/.test( base ) ) { replace++; }
		return { Label: String( Candidate ), Insert: insert, Replace: replace };
	} );
}

// The text with a candidate's item applied.
function ApplyItem( Text, Item )
{
	let text = String( ( typeof Text === 'undefined' || Text === null ) ? '' : Text );
	return text.slice( 0, text.length - Item.Replace ) + Item.Insert;
}


//---------------------------------------------------------------------
module.exports = {
	JsonContext: JsonContext,
	CompleteText: CompleteText,
	CompletionItems: CompletionItems,
	ApplyItem: ApplyItem,
};
