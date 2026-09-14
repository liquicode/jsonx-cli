'use strict';

/*
	Shell completion, answered from the command tree (plan F4.1).

	***The tree is the whole of what completes***: commands and their aliases, the options in force,
	an option's Choices, and a positional's `Complete`, which names what it takes -

		entries       every data source, object and trigger of the file
		objects       every object, or `objects:Query` for one kind
		datasources   the data sources
		triggers      the triggers
		adapters      the adapter names the inventory carries

	Names are read from the jsonx file the words would use (`--file`, JSONX_FILE, or the one .jsonx
	file here); ***reading it opens nothing***, and a file which cannot be read completes no names
	rather than failing.

	***The shell scripts call back*** `jsonx __complete -- <words>`, so a name added to a file
	completes without regenerating a script. The last word is the one being typed, sent with a
	leading `:` so that it is never empty: Windows PowerShell 5.1 drops an empty argument to a
	native program, which would lose the difference between `jsonx run` and `jsonx run `.
*/

const Parser = require( './Parser.js' );
const Reader = require( '../File/Reader.js' );
const Names = require( '../File/Names.js' );
const AdapterCatalog = require( '../Session/AdapterCatalog.js' );


// The mark the scripts put before the word being typed.
const CURRENT_MARK = ':';


//---------------------------------------------------------------------
function spellings( Node )
{
	return [ Node.Command ].concat( Array.isArray( Node.Aliases ) ? Node.Aliases : [] );
}


function child_for( Node, Word )
{
	if ( !Array.isArray( Node.Commands ) ) { return null; }
	for ( let index = 0; index < Node.Commands.length; index++ )
	{
		if ( spellings( Node.Commands[ index ] ).includes( Word ) ) { return Node.Commands[ index ]; }
	}
	return null;
}


//---------------------------------------------------------------------
// The names a positional's Complete declaration takes, from the file.

function names_for( Complete, Words, Io )
{
	if ( Complete === 'adapters' )
	{
		let names = [];
		AdapterCatalog.DATA.forEach( function ( Entry )
		{
			names.push( Entry.AdapterName );
			( Entry.Targets || [] ).forEach( function ( Target ) { if ( !names.includes( Target.Name ) ) { names.push( Target.Name ); } } );
		} );
		return names;
	}

	let document = read_file( Words, Io );
	if ( document === null ) { return []; }

	let parts = String( Complete ).split( ':' );
	let sort = parts[ 0 ];
	let kind = parts[ 1 ] || null;

	return Names.Entries( document )
		.filter( function ( Item )
		{
			if ( typeof Item.Name !== 'string' ) { return false; }
			if ( sort === 'entries' ) { return true; }
			if ( sort === 'datasources' ) { return Item.Section === 'DataSources'; }
			if ( sort === 'triggers' ) { return Item.Section === 'Triggers'; }
			if ( sort === 'objects' ) { return Item.Section === 'Objects' && ( kind === null || Item.Entry.Kind === kind ); }
			return false;
		} )
		.map( function ( Item ) { return Item.Name; } );
}


function read_file( Words, Io )
{
	let file = null;
	for ( let index = 0; index < Words.length; index++ )
	{
		if ( ( Words[ index ] === '--file' || Words[ index ] === '-f' ) && typeof Words[ index + 1 ] === 'string' ) { file = Words[ index + 1 ]; }
		if ( Words[ index ].startsWith( '--file=' ) ) { file = Words[ index ].slice( 7 ); }
	}
	try
	{
		let resolved = Reader.ResolvePath( file, Io.Env || {}, Io.Cwd || process.cwd(), Io );
		let read = Reader.ParseText( Reader.ReadText( resolved.Path, Io ) );
		return ( read.Document !== null && typeof read.Document === 'object' && !Array.isArray( read.Document ) ) ? read.Document : null;
	}
	catch ( error )
	{
		return null;
	}
}


function jsonx_files( Io )
{
	try
	{
		let list = ( typeof Io.ListDirectory === 'function' ) ? Io.ListDirectory( Io.Cwd || process.cwd() ) : require( 'fs' ).readdirSync( Io.Cwd || process.cwd() );
		return list.filter( function ( Name ) { return /\.jsonx$/i.test( Name ); } );
	}
	catch ( error )
	{
		return [];
	}
}


//---------------------------------------------------------------------
// The completions for the words typed after the program name. The last word is the one being typed,
// and may be empty. Answers the candidates which begin with it, in the tree's order.

function Candidates( Tree, Words, Io )
{
	let io = Io || {};
	let words = Array.isArray( Words ) ? Words.slice() : [];
	let current = ( words.length > 0 ) ? words.pop() : '';

	// Walk the words before the current one: descend through commands, step over options and their
	// values, and count the positionals given.
	let node = Tree;
	let path = [];
	let positionals = 0;
	let expecting = null;

	for ( let index = 0; index < words.length; index++ )
	{
		let word = words[ index ];
		let options = Parser.OptionsAt( Tree, path );

		if ( expecting !== null ) { expecting = null; continue; }
		if ( word === '--' ) { continue; }

		if ( word.startsWith( '-' ) && word !== '-' )
		{
			if ( word.includes( '=' ) ) { continue; }
			let name = word.startsWith( '--' ) ? word.slice( 2 ) : null;
			if ( name === null )
			{
				let letter = word.slice( 1 );
				name = Object.keys( options ).find( function ( Key ) { return options[ Key ].Alias === letter; } ) || null;
			}
			if ( name !== null && options[ name ] && ( options[ name ].Type || 'string' ) !== 'boolean' ) { expecting = options[ name ]; }
			continue;
		}

		let child = ( positionals === 0 ) ? child_for( node, word ) : null;
		if ( child !== null )
		{
			node = child;
			path.push( child.Command );
			continue;
		}
		positionals++;
	}

	let candidates = [];

	if ( expecting !== null )
	{
		if ( Array.isArray( expecting.Choices ) ) { candidates = expecting.Choices.map( String ); }
		else if ( words[ words.length - 1 ] === '--file' || words[ words.length - 1 ] === '-f' ) { candidates = jsonx_files( io ); }
	}
	else if ( current.startsWith( '-' ) )
	{
		candidates = Object.keys( Parser.OptionsAt( Tree, path ) ).map( function ( Name ) { return '--' + Name; } );
	}
	else
	{
		if ( positionals === 0 && Array.isArray( node.Commands ) )
		{
			node.Commands.forEach( function ( Child )
			{
				if ( Child.Hidden !== true ) { candidates = candidates.concat( spellings( Child ) ); }
			} );
		}
		let declared = Array.isArray( node.Positionals ) ? node.Positionals : [];
		let positional = declared[ Math.min( positionals, declared.length - 1 ) ];
		if ( positional && ( positionals < declared.length || positional.Repeat === true ) )
		{
			if ( Array.isArray( positional.Choices ) ) { candidates = candidates.concat( positional.Choices.map( String ) ); }
			else if ( typeof positional.Complete === 'string' ) { candidates = candidates.concat( names_for( positional.Complete, words, io ) ); }
		}
	}

	let seen = [];
	return candidates.filter( function ( Candidate )
	{
		if ( seen.includes( Candidate ) || !Candidate.startsWith( current ) ) { return false; }
		seen.push( Candidate );
		return true;
	} );
}


//---------------------------------------------------------------------
module.exports = {
	CURRENT_MARK: CURRENT_MARK,
	Candidates: Candidates,
};
