'use strict';

/*
	An entry of a jsonx file in English (plan F3.10): deterministic, and with no model anywhere in
	it.

	Lifted from jsonx-studio's src/Studio/Describe.js, which carries the reasoning:

	-	***The operator tables are the authority on which operators exist, and this file is the
		authority on how each one reads.*** A test walks jsongin's and jsonproc's own tables and
		fails when an operator has no phrase, which is how a newly added operator is noticed
		instead of silently rendering as its own name.
	-	***A value reads as itself***: a string is quoted, so the number 5 and the string "5" read
		differently.
	-	***Capitalizing a sentence must not rename a field***, so a sentence which begins with one
		of the document's own names is left alone.

	What changed for spec 0.2: the five kinds as the spec writes them (`Update` and `FirstOnly`,
	Insert and Delete, a Process with or without a `DataSource`), a trigger which names its
	Process, and a data source. ***A `$call` reads by what it names***: a host function is a storage
	call on a data source, an object of the file is a run of that object.

	***Inside a step, a string beginning with one `$` is a field reference*** (`$Document.Telescope`)
	and reads unquoted, because it stands for a value rather than being one. Inside `$literal` the
	same string is a string, and is quoted.
*/

const jsongin = require( '@liquicode/jsongin' );

const Names = require( '../File/Names.js' );


//---------------------------------------------------------------------
// Whether strings are being read as expressions. Set only around the description of a step's
// operand, and always restored.

let expression_strings = false;

function in_context( Expression, Work )
{
	let saved = expression_strings;
	expression_strings = Expression;
	try { return Work(); }
	finally { expression_strings = saved; }
}


//---------------------------------------------------------------------
// How each query operator reads, as a phrase which follows the field name.

const QUERY_PHRASES = {
	$eq: function ( Operand ) { return 'is ' + format_value( Operand ); },
	$ne: function ( Operand ) { return 'is not ' + format_value( Operand ); },
	$gt: function ( Operand ) { return 'is greater than ' + format_value( Operand ); },
	$gte: function ( Operand ) { return 'is at least ' + format_value( Operand ); },
	$lt: function ( Operand ) { return 'is less than ' + format_value( Operand ); },
	$lte: function ( Operand ) { return 'is at most ' + format_value( Operand ); },
	$in: function ( Operand ) { return 'is one of ' + format_list( Operand ); },
	$nin: function ( Operand ) { return 'is none of ' + format_list( Operand ); },
	$regex: function ( Operand ) { return 'matches the pattern ' + format_value( Operand ); },
	$mod: function ( Operand )
	{
		if ( !Array.isArray( Operand ) ) { return 'divided as ' + format_value( Operand ); }
		return 'divided by ' + format_value( Operand[ 0 ] ) + ' leaves ' + format_value( Operand[ 1 ] );
	},
	$size: function ( Operand ) { return 'is a list of ' + format_value( Operand ) + ' items'; },
	$all: function ( Operand ) { return 'contains all of ' + format_list( Operand ); },
	$type: function ( Operand ) { return 'is of type ' + format_value( Operand ); },
	$exists: function ( Operand )
	{
		if ( Operand === false ) { return 'is absent'; }
		return 'is present';
	},
	$bitsAllSet: function ( Operand ) { return 'has all of the bits ' + format_value( Operand ) + ' set'; },
	$bitsAllClear: function ( Operand ) { return 'has all of the bits ' + format_value( Operand ) + ' clear'; },
	$bitsAnySet: function ( Operand ) { return 'has any of the bits ' + format_value( Operand ) + ' set'; },
	$bitsAnyClear: function ( Operand ) { return 'has any of the bits ' + format_value( Operand ) + ' clear'; },
	$elemMatch: function ( Operand ) { return 'has an item where ' + criteria_body( Operand ); },
	$not: function ( Operand ) { return 'is not the case that it ' + field_operators( Operand ); },

	// ***The engine's own spellings.*** A person does not write these, but a criteria which came
	// back from a translator can carry them, and they read as their plain counterparts.
	$eqx: function ( Operand ) { return 'is exactly ' + format_value( Operand ); },
	$nex: function ( Operand ) { return 'is not exactly ' + format_value( Operand ); },
	$ImplicitEq: function ( Operand ) { return 'is ' + format_value( Operand ); },
};


// The operators which join whole criteria rather than describe one field.
const JOIN_PHRASES = {
	$and: ' and ',
	$or: ' or ',
	$nor: ' nor ',
};


// The operators which take a criteria or an expression and stand on their own.
const STANDALONE_PHRASES = {
	$expr: function ( Operand ) { return 'the expression ' + format_value( Operand ) + ' holds'; },
	$exprx: function ( Operand ) { return 'the expression ' + format_value( Operand ) + ' holds exactly'; },
	$comment: function ( Operand ) { return 'note: ' + String( Operand ); },
	$sampleRate: function ( Operand ) { return 'a random ' + format_percent( Operand ) + ' of documents are taken'; },
	$noop: function () { return 'nothing is required'; },
	// ***Added after Studio***: the operator arrived with jsongin's JSON Schema work (2026-09-12),
	// and this suite's coverage test is what found it unphrased.
	$jsonSchema: function ( Operand ) { return 'the document satisfies the JSON Schema ' + format_value( Operand ); },
};


// How each update operator reads.
const UPDATE_PHRASES = {
	$set: function ( Operand ) { return 'set ' + format_assignments( Operand ); },
	$unset: function ( Operand ) { return 'remove ' + format_field_list( Operand ); },
	$rename: function ( Operand ) { return 'rename ' + format_renames( Operand ); },
	$inc: function ( Operand ) { return 'increase ' + format_assignments( Operand, 'by' ); },
	$mul: function ( Operand ) { return 'multiply ' + format_assignments( Operand, 'by' ); },
	$min: function ( Operand ) { return 'lower ' + format_assignments( Operand, 'to' ) + ', if it is currently higher'; },
	$max: function ( Operand ) { return 'raise ' + format_assignments( Operand, 'to' ) + ', if it is currently lower'; },
	$bit: function ( Operand ) { return 'apply the bitwise operations ' + format_value( Operand ); },
	$currentDate: function ( Operand ) { return 'stamp ' + format_field_list( Operand ) + ' with the current date'; },
	$addToSet: function ( Operand ) { return 'add ' + format_assignments( Operand, 'to' ) + ', unless it is already there'; },
	$pop: function ( Operand ) { return 'remove an item from the end of ' + format_field_list( Operand ); },
	$push: function ( Operand ) { return 'append ' + format_assignments( Operand, 'to' ); },
	$pull: function ( Operand ) { return 'remove the matching items from ' + format_field_list( Operand ); },
	$pullAll: function ( Operand ) { return 'remove every listed item from ' + format_field_list( Operand ); },
};


// How each jsonproc step operator reads. The document is the file, for a $call to resolve its name.
const STEP_PHRASES = {
	$do: function ( Operand ) { return 'Compute ' + format_assignments( Operand, 'as' ) + '.'; },
	$when: function ( Operand )
	{
		let operand = is_object( Operand ) ? Operand : {};
		let text = 'If ' + criteria_body( operand.Check ) + ', do ' + step_count( operand.Then );
		if ( Array.isArray( operand.Else ) && operand.Else.length > 0 )
		{
			text += '; otherwise do ' + step_count( operand.Else );
		}
		return text + '.';
	},
	$while: function ( Operand )
	{
		let operand = is_object( Operand ) ? Operand : {};
		return 'While ' + criteria_body( operand.Check ) + ', repeat ' + step_count( operand.Do ) + '.';
	},
	$forEach: function ( Operand )
	{
		let operand = is_object( Operand ) ? Operand : {};
		return 'For each item of ' + format_value( operand.In ) + ' as ' + format_value( operand.As )
			+ ', do ' + step_count( operand.Do ) + '.';
	},
	$try: function ( Operand )
	{
		let operand = is_object( Operand ) ? Operand : {};
		let text = 'Try ' + step_count( operand.Do );
		if ( Array.isArray( operand.Catch ) ) { text += ', and on failure do ' + step_count( operand.Catch ); }
		if ( typeof operand.As === 'string' ) { text += ', with the failure at ' + quote( operand.As ); }
		return text + '.';
	},
	$throw: function ( Operand ) { return 'Fail with ' + format_value( Operand ) + '.'; },
	$call: function ( Operand, Document ) { return call_phrase( Operand, Document ); },
	$return: function ( Operand )
	{
		// A document returned field by field reads as its fields; anything else reads as a value.
		if ( is_object( Operand ) && !jsongin.IsQuery( Operand ) && Object.keys( Operand ).length > 0 )
		{
			return 'Finish, answering a document with ' + format_assignments( Operand, 'as' ) + '.';
		}
		return 'Finish, answering ' + format_value( Operand ) + '.';
	},
};


//---------------------------------------------------------------------
function is_object( Value )
{
	return ( Value !== null ) && ( typeof Value === 'object' ) && !Array.isArray( Value );
}


//---------------------------------------------------------------------
// Value formatting.

function quote( Text )
{
	return '"' + Text + '"';
}


function format_value( Value )
{
	let short_type = jsongin.ShortType( Value );

	if ( short_type === 's' )
	{
		if ( expression_strings && /^\$[^$]/.test( Value ) ) { return Value; }
		return quote( Value );
	}
	if ( short_type === 'n' ) { return String( Value ); }
	if ( short_type === 'b' ) { return Value ? 'true' : 'false'; }
	if ( short_type === 'l' ) { return 'null'; }
	if ( short_type === 'u' ) { return 'nothing'; }
	if ( short_type === 'd' ) { return Value.toISOString(); }
	if ( short_type === 'r' ) { return String( Value ); }
	if ( short_type === 'a' ) { return format_list( Value ); }

	return jsongin.Format( Value );
}


function format_list( Values )
{
	if ( !Array.isArray( Values ) ) { return format_value( Values ); }
	if ( Values.length === 0 ) { return 'nothing'; }

	let parts = [];
	for ( let index = 0; index < Values.length; index++ )
	{
		parts.push( format_value( Values[ index ] ) );
	}
	if ( parts.length === 1 ) { return parts[ 0 ]; }
	return parts.slice( 0, parts.length - 1 ).join( ', ' ) + ' or ' + parts[ parts.length - 1 ];
}


function format_percent( Value )
{
	let number = jsongin.AsNumber( Value );
	if ( number === null ) { return format_value( Value ); }
	return String( Math.round( number * 100 ) ) + '%';
}


// `{ A: 1, B: 2 }` reads as `A to 1 and B to 2`, with the joining word chosen by the caller.
function format_assignments( Document, Word )
{
	let word = ( typeof Word === 'string' ) ? Word : 'to';
	if ( !is_object( Document ) ) { return format_value( Document ); }

	let parts = [];
	for ( let field in Document )
	{
		parts.push( field + ' ' + word + ' ' + format_value( Document[ field ] ) );
	}
	return join_parts( parts, 'and' );
}


function format_field_list( Document )
{
	if ( !is_object( Document ) ) { return format_value( Document ); }
	return join_parts( Object.keys( Document ), 'and' );
}


function format_renames( Document )
{
	if ( !is_object( Document ) ) { return format_value( Document ); }

	let parts = [];
	for ( let field in Document )
	{
		parts.push( field + ' to ' + Document[ field ] );
	}
	return join_parts( parts, 'and' );
}


function join_parts( Parts, Word )
{
	if ( Parts.length === 0 ) { return 'nothing'; }
	if ( Parts.length === 1 ) { return Parts[ 0 ]; }
	return Parts.slice( 0, Parts.length - 1 ).join( ', ' ) + ' ' + Word + ' ' + Parts[ Parts.length - 1 ];
}


function step_count( Steps )
{
	if ( !Array.isArray( Steps ) ) { return 'nothing'; }
	if ( Steps.length === 1 ) { return '1 step'; }
	return String( Steps.length ) + ' steps';
}


function plural( Count, Word )
{
	return Count + ' ' + Word + ( Count === 1 ? '' : 's' );
}


//---------------------------------------------------------------------
// The operator object sitting under one field name: `{ $gt: 500, $lt: 900 }`.

function field_operators( Operators )
{
	if ( !is_object( Operators ) ) { return 'is ' + format_value( Operators ); }

	let parts = [];
	for ( let key in Operators )
	{
		let phrase = QUERY_PHRASES[ key ];
		if ( typeof phrase === 'function' ) { parts.push( phrase( Operators[ key ] ) ); }
		else { parts.push( key + ' ' + format_value( Operators[ key ] ) ); }
	}
	return join_parts( parts, 'and' );
}


//---------------------------------------------------------------------
// One criteria, without a leading capital or a trailing stop, so that it composes.

function criteria_body( Criteria )
{
	if ( typeof Criteria === 'undefined' || Criteria === null ) { return 'every document matches'; }
	if ( !is_object( Criteria ) ) { return format_value( Criteria ); }

	let keys = Object.keys( Criteria );
	if ( keys.length === 0 ) { return 'every document matches'; }

	let parts = [];
	for ( let key_index = 0; key_index < keys.length; key_index++ )
	{
		let key = keys[ key_index ];
		let value = Criteria[ key ];

		if ( typeof JOIN_PHRASES[ key ] === 'string' )
		{
			let branches = [];
			if ( Array.isArray( value ) )
			{
				for ( let branch_index = 0; branch_index < value.length; branch_index++ )
				{
					branches.push( '(' + criteria_body( value[ branch_index ] ) + ')' );
				}
			}
			if ( key === '$nor' ) { parts.push( 'none of ' + branches.join( ' or ' ) + ' holds' ); }
			else { parts.push( branches.join( JOIN_PHRASES[ key ] ) ); }
			continue;
		}

		// A top level $not takes a criteria rather than a field's operators.
		if ( key === '$not' )
		{
			parts.push( 'it is not the case that ' + criteria_body( value ) );
			continue;
		}

		if ( typeof STANDALONE_PHRASES[ key ] === 'function' )
		{
			parts.push( STANDALONE_PHRASES[ key ]( value ) );
			continue;
		}

		// Anything else is a field name, and its value is an operator object or a value to equal.
		if ( jsongin.IsQuery( value ) ) { parts.push( key + ' ' + field_operators( value ) ); }
		else { parts.push( key + ' is ' + format_value( value ) ); }
	}

	return join_parts( parts, 'and' );
}


function update_body( Update )
{
	if ( !is_object( Update ) || Object.keys( Update ).length === 0 ) { return 'nothing changes'; }

	let parts = [];
	let keys = Object.keys( Update );
	for ( let key_index = 0; key_index < keys.length; key_index++ )
	{
		let key = keys[ key_index ];
		let phrase = UPDATE_PHRASES[ key ];
		if ( typeof phrase === 'function' ) { parts.push( phrase( Update[ key ] ) ); }
		else { parts.push( key + ' ' + format_value( Update[ key ] ) ); }
	}
	return join_parts( parts, 'then' );
}


//---------------------------------------------------------------------
// ***Capitalizing a sentence must not rename a field.*** The leading word is left alone when it is
// one of the document's own names, and only text this file generated is capitalized.

function sentence( Text, OwnNames )
{
	if ( Text.length === 0 ) { return ''; }

	let text = Text;
	let leading = text.split( ' ' )[ 0 ];
	let is_own_name = Array.isArray( OwnNames ) && OwnNames.includes( leading );

	if ( !is_own_name ) { text = text.charAt( 0 ).toUpperCase() + text.slice( 1 ); }
	if ( !text.endsWith( '.' ) && !text.endsWith( ':' ) ) { text += '.'; }
	return text;
}


//---------------------------------------------------------------------
// A criteria as a sentence.

function ExplainCriteria( Criteria )
{
	return sentence( criteria_body( Criteria ), is_object( Criteria ) ? Object.keys( Criteria ) : [] );
}


// An update document as a sentence.
function ExplainUpdateDocument( Update )
{
	return sentence( update_body( Update ) );
}


//---------------------------------------------------------------------
// A projection and a sort, each as a clause, or an empty string when there is nothing to say.

function projection_clause( Projection )
{
	if ( !is_object( Projection ) ) { return ''; }

	let included = [];
	let excluded = [];
	for ( let field in Projection )
	{
		let value = Projection[ field ];
		if ( value === 0 || value === false ) { excluded.push( field ); }
		else { included.push( field ); }
	}

	let parts = [];
	if ( included.length > 0 ) { parts.push( 'keeping ' + join_parts( included, 'and' ) ); }
	if ( excluded.length > 0 ) { parts.push( 'dropping ' + join_parts( excluded, 'and' ) ); }
	return parts.join( ' and ' );
}


function sort_clause( Sort )
{
	if ( !is_object( Sort ) ) { return ''; }

	let parts = [];
	for ( let field in Sort )
	{
		let direction = jsongin.AsNumber( Sort[ field ] );
		if ( direction !== null && direction < 0 ) { parts.push( field + ' descending' ); }
		else { parts.push( field + ' ascending' ); }
	}
	if ( parts.length === 0 ) { return ''; }
	return 'sorted by ' + join_parts( parts, 'then' );
}


// ` where ...`, or nothing when the criteria selects every document.
function where_clause( Criteria )
{
	if ( !is_object( Criteria ) || Object.keys( Criteria ).length === 0 ) { return ''; }
	return ' where ' + criteria_body( Criteria );
}


//---------------------------------------------------------------------
// A value of a host call's With: `$literal` passes it through unevaluated, so what is inside reads
// as written; anything else is an expression.

function with_value( Value, Describe )
{
	if ( is_object( Value ) && Object.keys( Value ).length === 1 && Object.prototype.hasOwnProperty.call( Value, '$literal' ) )
	{
		return in_context( false, function () { return Describe( Value.$literal ); } );
	}
	return in_context( true, function () { return Describe( Value ); } );
}


//---------------------------------------------------------------------
// A $call: a storage call when it names a host function, a run when it names an object.

function call_phrase( Operand, Document )
{
	let operand = is_object( Operand ) ? Operand : {};
	let name = operand.Name;
	let with_document = is_object( operand.With ) ? operand.With : null;
	let text = '';

	if ( typeof name === 'string' && Names.HOST_FUNCTIONS.includes( name ) )
	{
		text = 'Call ' + name;
		let parts = [];
		let fields = with_document ? Object.keys( with_document ) : [];

		for ( let index = 0; index < fields.length; index++ )
		{
			let field = fields[ index ];
			let value = with_document[ field ];

			if ( field === 'DataSource' )
			{
				text += ' on ' + ( ( typeof value === 'string' && !value.startsWith( '$' ) ) ? quote( value ) : 'the data source at ' + in_context( true, function () { return format_value( value ); } ) );
				continue;
			}
			if ( field === 'Criteria' )
			{
				parts.push( 'where ' + with_value( value, criteria_body ) );
				continue;
			}
			if ( field === 'Updates' )
			{
				parts.push( 'to ' + with_value( value, update_body ) );
				continue;
			}
			if ( field === 'Projection' )
			{
				let clause = with_value( value, projection_clause );
				parts.push( clause !== '' ? clause : 'with the projection ' + with_value( value, format_value ) );
				continue;
			}
			if ( field === 'Sort' )
			{
				let clause = with_value( value, sort_clause );
				parts.push( clause !== '' ? clause : 'with the sort ' + with_value( value, format_value ) );
				continue;
			}
			parts.push( 'with ' + field + ' ' + with_value( value, format_value ) );
		}
		if ( parts.length > 0 ) { text += ' ' + parts.join( ', ' ); }
	}
	else
	{
		let item = ( is_object( Document ) && typeof name === 'string' ) ? Names.FindEntry( Document, name ) : null;
		if ( item !== null && item.Section === 'Objects' && typeof item.Entry.Kind === 'string' )
		{
			text = 'Run the ' + item.Entry.Kind + ' ' + quote( name );
		}
		else if ( is_object( Document ) )
		{
			text = 'Call ' + format_value( name ) + ', which is neither a host function nor an object of the file';
		}
		else
		{
			text = 'Call ' + format_value( name );
		}
		if ( with_document !== null && Object.keys( with_document ).length > 0 )
		{
			text += ' (its With is refused: a call naming an object takes none)';
		}
	}

	if ( typeof operand.Into === 'string' ) { text += ', and put the answer at ' + quote( operand.Into ); }
	return text + '.';
}


//---------------------------------------------------------------------
// One step as a sentence. Document is the file, so that a $call can say what it names.

function ExplainStep( Step, Document )
{
	if ( !is_object( Step ) ) { return 'A step which is not an object: ' + format_value( Step ) + '.'; }

	let keys = Object.keys( Step );
	if ( keys.length === 0 ) { return 'Do nothing.'; }

	// ***One document, one step operator.*** That is jsonproc's rule, so the first key is the
	// operator and anything beside it is a malformed step worth saying so about.
	let operator = keys[ 0 ];
	let phrase = STEP_PHRASES[ operator ];
	let text = '';

	if ( typeof phrase === 'function' )
	{
		text = in_context( true, function () { return phrase( Step[ operator ], Document ); } );
	}
	else
	{
		text = 'Run the unknown step operator ' + operator + '.';
	}

	if ( keys.length > 1 )
	{
		text += ' (This step also carries ' + join_parts( keys.slice( 1 ), 'and' ) + ', which jsonproc does not read.)';
	}
	return text;
}


//---------------------------------------------------------------------
// Numbered lines for a list of steps, with each nested list beneath its step under its field name.

function step_lines( Steps, Document, Indent, Lines )
{
	if ( !Array.isArray( Steps ) ) { return; }
	for ( let index = 0; index < Steps.length; index++ )
	{
		let step = Steps[ index ];
		Lines.push( Indent + String( index + 1 ) + '. ' + ExplainStep( step, Document ) );
		if ( !is_object( step ) ) { continue; }

		let operator = Object.keys( step )[ 0 ];
		let fields = Names.NESTED_STEPS[ operator ] || [];
		let operand = is_object( step[ operator ] ) ? step[ operator ] : {};
		for ( let field_index = 0; field_index < fields.length; field_index++ )
		{
			let field = fields[ field_index ];
			if ( !Array.isArray( operand[ field ] ) || operand[ field ].length === 0 ) { continue; }
			Lines.push( Indent + '   ' + field + ':' );
			step_lines( operand[ field ], Document, Indent + '      ', Lines );
		}
	}
	return;
}


//---------------------------------------------------------------------
// One entry per section and kind.

function data_source_lines( Entry )
{
	let lines = [ sentence( 'A data source opened by the adapter ' + format_value( Entry.AdapterName ) ) ];

	// ***Settings read as written***, so an environment reference is shown and never its value
	// (spec 4.5).
	if ( is_object( Entry.Settings ) && Object.keys( Entry.Settings ).length > 0 )
	{
		let parts = [];
		for ( let field in Entry.Settings ) { parts.push( field + ' ' + format_value( Entry.Settings[ field ] ) ); }
		lines.push( 'Its settings are ' + join_parts( parts, 'and' ) + '.' );
	}
	if ( Array.isArray( Entry.Filters ) && Entry.Filters.length > 0 )
	{
		let filters = Entry.Filters.map( function ( Filter ) { return format_value( is_object( Filter ) ? Filter.FilterName : Filter ); } );
		lines.push( 'Its filters, nearest the store first, are ' + join_parts( filters, 'then' ) + '.' );
	}
	return lines;
}


function insert_lines( Entry )
{
	let count = Array.isArray( Entry.Documents ) ? Entry.Documents.length : 0;
	return [ sentence( 'Insert ' + plural( count, 'document' ) + ' into ' + format_value( Entry.DataSource ) ) ];
}


function query_lines( Entry )
{
	let text = 'Read documents from ' + format_value( Entry.DataSource ) + ' where ' + criteria_body( Entry.Criteria );

	let projection = projection_clause( Entry.Projection );
	if ( projection !== '' ) { text += ', ' + projection; }

	let sort = sort_clause( Entry.Sort );
	if ( sort !== '' ) { text += ', ' + sort; }

	let skip_count = jsongin.AsNumber( Entry.SkipCount );
	if ( skip_count !== null && skip_count > 0 ) { text += ', skipping the first ' + String( skip_count ); }

	let max_count = jsongin.AsNumber( Entry.MaxCount );
	if ( max_count !== null && max_count > 0 ) { text += ', at most ' + String( max_count ) + ' of them'; }

	if ( typeof Entry.Into === 'string' ) { text += ', and insert them into ' + quote( Entry.Into ); }
	return [ sentence( text ) ];
}


function update_lines( Entry )
{
	let scope = ( Entry.FirstOnly === true ) ? 'the first document' : 'every document';
	return [ sentence( 'In ' + format_value( Entry.DataSource ) + ', for ' + scope + ' where ' + criteria_body( Entry.Criteria ) + ': ' + update_body( Entry.Update ) ) ];
}


function delete_lines( Entry )
{
	let scope = ( Entry.FirstOnly === true ) ? 'the first document' : 'every document';
	return [ sentence( 'Remove ' + scope + ' from ' + format_value( Entry.DataSource ) + ' where ' + criteria_body( Entry.Criteria ) ) ];
}


function process_lines( Entry, Document )
{
	let into = ( typeof Entry.Into === 'string' ) ? ', and insert each object it returns into ' + quote( Entry.Into ) : '';
	let head = '';
	if ( typeof Entry.DataSource === 'string' )
	{
		head = 'For each document in ' + quote( Entry.DataSource ) + where_clause( Entry.Criteria ) + ', run these steps from { Document }' + into + ':';
	}
	else
	{
		head = 'Run these steps once, from the input it is given or {}' + into + ':';
	}

	let lines = [ sentence( head ) ];
	step_lines( Entry.Steps, Document, '', lines );
	return lines;
}


function trigger_lines( Entry, Document )
{
	let item = ( typeof Entry.Process === 'string' ) ? Names.FindEntry( Document, Entry.Process ) : null;
	let process = ( item !== null && item.Section === 'Objects' && item.Entry.Kind === 'Process' ) ? item.Entry : null;

	let target = 'the Process ' + format_value( Entry.Process );
	let over = '';
	if ( process === null || typeof process.DataSource !== 'string' )
	{
		target += ', which the file does not define as a Process with a DataSource';
	}
	else
	{
		over = ' in ' + quote( process.DataSource ) + where_clause( process.Criteria );
	}

	if ( !Array.isArray( Entry.On ) )
	{
		return [ sentence( 'Runs only when asked: it runs ' + target + ' for each document' + over ) ];
	}

	let when = ( Entry.When === 'Before' ) ? 'before' : 'after';
	let text = 'When ' + join_parts( Entry.On, 'or' ) + ' is called on ' + ( process && typeof process.DataSource === 'string' ? quote( process.DataSource ) : 'its data source' )
		+ ', run ' + target + ' ' + when + ' the call, for each document it touches' + where_clause( process ? process.Criteria : null );
	let lines = [ sentence( text ) ];
	if ( Entry.When === 'Before' ) { lines.push( 'A change the Process makes to $Document is what the call stores.' ); }
	return lines;
}


//---------------------------------------------------------------------
// An entry of the file by name: { Name, Kind, Lines }, or null when no entry carries the name.
// Kind is the object's Kind, or `DataSource` or `Trigger`.

function ExplainEntry( Document, Name )
{
	let item = Names.FindEntry( Document, Name );
	if ( item === null ) { return null; }

	let entry = item.Entry;
	if ( item.Section === 'DataSources' ) { return { Name: Name, Kind: 'DataSource', Lines: data_source_lines( entry ) }; }
	if ( item.Section === 'Triggers' ) { return { Name: Name, Kind: 'Trigger', Lines: trigger_lines( entry, Document ) }; }

	let lines = null;
	if ( entry.Kind === 'Insert' ) { lines = insert_lines( entry ); }
	else if ( entry.Kind === 'Query' ) { lines = query_lines( entry ); }
	else if ( entry.Kind === 'Update' ) { lines = update_lines( entry ); }
	else if ( entry.Kind === 'Delete' ) { lines = delete_lines( entry ); }
	else if ( entry.Kind === 'Process' ) { lines = process_lines( entry, Document ); }
	else { lines = [ 'An object whose Kind ' + format_value( entry.Kind ) + ' is not one of the five kinds.' ]; }

	return { Name: Name, Kind: ( typeof entry.Kind === 'string' ) ? entry.Kind : null, Lines: lines };
}


//---------------------------------------------------------------------
module.exports = {
	QUERY_PHRASES: QUERY_PHRASES,
	JOIN_PHRASES: JOIN_PHRASES,
	STANDALONE_PHRASES: STANDALONE_PHRASES,
	UPDATE_PHRASES: UPDATE_PHRASES,
	STEP_PHRASES: STEP_PHRASES,
	ExplainCriteria: ExplainCriteria,
	ExplainUpdateDocument: ExplainUpdateDocument,
	ExplainStep: ExplainStep,
	ExplainEntry: ExplainEntry,
};
