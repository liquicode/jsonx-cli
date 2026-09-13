'use strict';

/*
	Editing a jsonx file: the manage verbs (plan F3.1).

	***An edit which would add an error is refused*** unless forced. The file is validated before
	and after, and only an error the file did not already have counts, so a file which is already
	broken can still be repaired one edit at a time.

	***The document is changed in place and handed back***; the caller writes it. A refused edit
	leaves the document exactly as it was.

	Every function answers { Ok, Refused, Findings, Result } or throws EditError for a mistake in
	the request itself - no such name, a name of the wrong sort, a body which is not an object.

	The nouns: `datasource` and `trigger` are their sections; `query`, `insert`, `update`, `delete`
	and `process` are Objects of that Kind.
*/

const Names = require( './Names.js' );
const Validate = require( '../Validate/Validate.js' );


const NOUNS = {
	datasource: { Section: 'DataSources', Kind: null, Label: 'data source', Plural: 'data sources' },
	query: { Section: 'Objects', Kind: 'Query', Label: 'Query', Plural: 'Queries' },
	insert: { Section: 'Objects', Kind: 'Insert', Label: 'Insert', Plural: 'Inserts' },
	update: { Section: 'Objects', Kind: 'Update', Label: 'Update', Plural: 'Updates' },
	delete: { Section: 'Objects', Kind: 'Delete', Label: 'Delete', Plural: 'Deletes' },
	process: { Section: 'Objects', Kind: 'Process', Label: 'Process', Plural: 'Processes' },
	trigger: { Section: 'Triggers', Kind: null, Label: 'trigger', Plural: 'triggers' },
};


//---------------------------------------------------------------------
class EditError extends Error
{
	constructor( Message )
	{
		super( Message );
		this.name = 'EditError';
	}
}


//---------------------------------------------------------------------
function is_object( Value )
{
	return ( Value !== null ) && ( typeof Value === 'object' ) && !Array.isArray( Value );
}

function clone( Value )
{
	return JSON.parse( JSON.stringify( Value ) );
}

function noun_of( Noun )
{
	let noun = NOUNS[ Noun ];
	if ( !noun ) { throw new EditError( 'Unknown noun [' + Noun + '].' ); }
	return noun;
}


//---------------------------------------------------------------------
// The entry a noun names, or EditError.

function entry_for( Document, Noun, Name )
{
	let noun = noun_of( Noun );
	let item = Names.FindEntry( Document, Name );
	if ( item === null ) { throw new EditError( 'No ' + noun.Label + ' is named [' + Name + '].' ); }
	if ( item.Section !== noun.Section || ( noun.Kind !== null && item.Entry.Kind !== noun.Kind ) )
	{
		let is = ( item.Section === 'Objects' ) ? 'a ' + item.Entry.Kind : 'in ' + item.Section;
		throw new EditError( '[' + Name + '] is ' + is + ', not a ' + noun.Label + '.' );
	}
	return item;
}


//---------------------------------------------------------------------
// Applies a change, validates, and undoes it when it adds an error and is not forced.

function checked( Document, Options, Change )
{
	let options = is_object( Options ) ? Options : {};
	let validate_options = is_object( options.Validate ) ? options.Validate : {};

	let key = function ( Finding ) { return Finding.Path + '\t' + Finding.Message; };
	let before = Validate.ValidateFile( Document, validate_options ).filter( function ( Finding ) { return Finding.Severity === 'error'; } ).map( key );
	let snapshot = clone( Document );

	let result = Change();

	let after = Validate.ValidateFile( Document, validate_options );
	let added = after.filter( function ( Finding ) { return Finding.Severity === 'error' && !before.includes( key( Finding ) ); } );

	if ( added.length > 0 && options.Force !== true )
	{
		let keys = Object.keys( Document );
		for ( let index = 0; index < keys.length; index++ ) { delete Document[ keys[ index ] ]; }
		Object.assign( Document, snapshot );
		return { Ok: false, Refused: true, Findings: added, Result: null };
	}
	return { Ok: true, Refused: false, Findings: added, Result: result };
}


//---------------------------------------------------------------------
// A summary of each entry of a noun, in file order.

function List( Document, Noun )
{
	let noun = noun_of( Noun );
	return Names.Entries( Document )
		.filter( function ( Item ) { return Item.Section === noun.Section && ( noun.Kind === null || Item.Entry.Kind === noun.Kind ); } )
		.map( function ( Item )
		{
			let summary = { Name: Item.Name };
			let entry = Item.Entry;
			if ( noun.Section === 'DataSources' ) { summary.AdapterName = entry.AdapterName; }
			if ( noun.Section === 'Objects' )
			{
				if ( typeof entry.DataSource === 'string' ) { summary.DataSource = entry.DataSource; }
				if ( typeof entry.Into === 'string' ) { summary.Into = entry.Into; }
			}
			if ( noun.Section === 'Triggers' )
			{
				summary.Process = entry.Process;
				if ( Array.isArray( entry.On ) ) { summary.On = entry.On; }
				if ( typeof entry.When === 'string' ) { summary.When = entry.When; }
			}
			return summary;
		} );
}


//---------------------------------------------------------------------
function Show( Document, Noun, Name )
{
	return clone( entry_for( Document, Noun, Name ).Entry );
}


//---------------------------------------------------------------------
// Adds an entry. An object's Kind comes from the noun when the body leaves it out, and is written
// first; a body naming a different Kind is refused.

function Add( Document, Noun, Body, Options )
{
	let noun = noun_of( Noun );
	if ( !is_object( Body ) ) { throw new EditError( 'The body must be a JSON object.' ); }
	if ( typeof Body.Name !== 'string' || Body.Name === '' ) { throw new EditError( 'The body must carry a Name.' ); }
	if ( Names.FindEntry( Document, Body.Name ) !== null ) { throw new EditError( 'The name [' + Body.Name + '] is already used; one file has one namespace (3.5).' ); }

	let entry = clone( Body );
	if ( noun.Kind !== null )
	{
		if ( typeof entry.Kind !== 'undefined' && entry.Kind !== noun.Kind )
		{
			throw new EditError( 'The body is a ' + entry.Kind + '; `' + Noun + ' add` adds a ' + noun.Kind + '.' );
		}
		let rest = entry;
		delete rest.Kind;
		entry = Object.assign( { Kind: noun.Kind }, rest );
	}

	return checked( Document, Options, function ()
	{
		if ( !Array.isArray( Document[ noun.Section ] ) ) { Document[ noun.Section ] = []; }
		Document[ noun.Section ].push( entry );
		return clone( entry );
	} );
}


//---------------------------------------------------------------------
// Merges a body's top-level fields into an entry. A field set to null is removed. Name and Kind
// are not changed here: `rename` changes a name, and a Kind is what the entry is.

function Set( Document, Noun, Name, Body, Options )
{
	let item = entry_for( Document, Noun, Name );
	if ( !is_object( Body ) ) { throw new EditError( 'The body must be a JSON object.' ); }
	if ( typeof Body.Name !== 'undefined' && Body.Name !== Name ) { throw new EditError( 'Set does not change a Name; use rename, which rewrites every reference.' ); }
	if ( typeof Body.Kind !== 'undefined' && Body.Kind !== item.Entry.Kind ) { throw new EditError( 'Set does not change a Kind; remove the entry and add another.' ); }

	return checked( Document, Options, function ()
	{
		let keys = Object.keys( Body );
		for ( let index = 0; index < keys.length; index++ )
		{
			let key = keys[ index ];
			if ( Body[ key ] === null ) { delete item.Entry[ key ]; }
			else { item.Entry[ key ] = clone( Body[ key ] ); }
		}
		return clone( item.Entry );
	} );
}


//---------------------------------------------------------------------
// Removes an entry. Refused while anything refers to it, unless forced.

function Remove( Document, Noun, Name, Options )
{
	let item = entry_for( Document, Noun, Name );
	let options = is_object( Options ) ? Options : {};

	let users = Names.References( Document ).filter( function ( Reference ) { return Reference.Name === Name; } );
	if ( users.length > 0 && options.Force !== true )
	{
		return {
			Ok: false, Refused: true, Result: null,
			Findings: users.map( function ( Reference )
			{
				return { Severity: 'error', Path: Reference.Path, Message: '[' + Name + '] is used here; remove or change this first, or pass --force (3.8).' };
			} ),
		};
	}

	let removed = clone( item.Entry );
	Document[ item.Section ].splice( item.Index, 1 );
	return { Ok: true, Refused: false, Findings: [], Result: removed };
}


//---------------------------------------------------------------------
function set_by_path( Document, Path, Value )
{
	let parts = Path.split( '.' );
	let node = Document;
	for ( let index = 0; index < parts.length - 1; index++ )
	{
		let part = /^\d+$/.test( parts[ index ] ) ? Number( parts[ index ] ) : parts[ index ];
		node = node[ part ];
	}
	node[ parts[ parts.length - 1 ] ] = Value;
	return;
}


//---------------------------------------------------------------------
// Renames an entry and rewrites every reference to it.

function Rename( Document, Noun, Name, NewName, Options )
{
	let item = entry_for( Document, Noun, Name );
	if ( typeof NewName !== 'string' || NewName === '' ) { throw new EditError( 'The new name must be a non-empty string.' ); }
	if ( NewName === Name ) { throw new EditError( 'The new name is the name it already has.' ); }
	if ( Names.FindEntry( Document, NewName ) !== null ) { throw new EditError( 'The name [' + NewName + '] is already used; one file has one namespace (3.5).' ); }

	return checked( Document, Options, function ()
	{
		let references = Names.References( Document ).filter( function ( Reference ) { return Reference.Name === Name; } );
		for ( let index = 0; index < references.length; index++ ) { set_by_path( Document, references[ index ].Path, NewName ); }
		item.Entry.Name = NewName;
		return { Name: Name, NewName: NewName, References: references.map( function ( Reference ) { return Reference.Path; } ) };
	} );
}


//---------------------------------------------------------------------
module.exports = {
	NOUNS: NOUNS,
	EditError: EditError,
	List: List,
	Show: Show,
	Add: Add,
	Set: Set,
	Remove: Remove,
	Rename: Rename,
};
