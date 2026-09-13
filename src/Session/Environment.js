'use strict';

/*
	Environment references in data source settings (spec 4.4-4.6).

	***`${env:NAME}` stands for an environment variable's value, anywhere inside a settings
	string***, so a connection string can carry one among other text. A runner replaces them when
	a data source opens; nothing else ever sees the value.

	***A value is never shown.*** Mask returns the entry exactly as written, and nothing in this
	package prints a resolved settings object.
*/


const REFERENCE_PATTERN = /\$\{env:([A-Za-z0-9_]+)\}/g;


//---------------------------------------------------------------------
function is_object( Value )
{
	return ( Value !== null ) && ( typeof Value === 'object' ) && !Array.isArray( Value );
}


//---------------------------------------------------------------------
// Visits every string inside a value, with its dotted path.

function walk_strings( Value, Path, Visit )
{
	if ( typeof Value === 'string' ) { Visit( Value, Path ); return; }
	if ( Array.isArray( Value ) )
	{
		for ( let index = 0; index < Value.length; index++ ) { walk_strings( Value[ index ], Path + '.' + index, Visit ); }
		return;
	}
	if ( is_object( Value ) )
	{
		let keys = Object.keys( Value );
		for ( let index = 0; index < keys.length; index++ ) { walk_strings( Value[ keys[ index ] ], Path + '.' + keys[ index ], Visit ); }
	}
	return;
}


//---------------------------------------------------------------------
// The variable names referenced by one string, in order, repeats kept.

function names_in( Text )
{
	let names = [];
	let pattern = new RegExp( REFERENCE_PATTERN.source, 'g' );
	let found = pattern.exec( Text );
	while ( found !== null )
	{
		names.push( found[ 1 ] );
		found = pattern.exec( Text );
	}
	return names;
}


//---------------------------------------------------------------------
// Every environment reference in a data source: its Settings and its filters' Settings.
//
// Returns [ { Name, Path } ] with paths relative to the data source (`Settings.Password`,
// `Filters.0.Settings.Key`).

function References( DataSource )
{
	let references = [];
	if ( !is_object( DataSource ) ) { return references; }

	function take( Text, Path )
	{
		let names = names_in( Text );
		for ( let index = 0; index < names.length; index++ ) { references.push( { Name: names[ index ], Path: Path } ); }
	}

	walk_strings( DataSource.Settings, 'Settings', take );

	if ( Array.isArray( DataSource.Filters ) )
	{
		for ( let index = 0; index < DataSource.Filters.length; index++ )
		{
			let filter = DataSource.Filters[ index ];
			if ( is_object( filter ) ) { walk_strings( filter.Settings, 'Filters.' + index + '.Settings', take ); }
		}
	}
	return references;
}


//---------------------------------------------------------------------
// Whether a variable has a value in an environment. An empty string is a value.

function IsSet( Env, Name )
{
	return is_object( Env ) && ( typeof Env[ Name ] === 'string' );
}


//---------------------------------------------------------------------
// A deep copy of a value with every reference replaced. Throws naming the first unset variable.

function Resolve( Value, Env )
{
	if ( typeof Value === 'string' )
	{
		return Value.replace( new RegExp( REFERENCE_PATTERN.source, 'g' ), function ( Match, Name )
		{
			if ( !IsSet( Env, Name ) ) { throw new Error( 'The environment variable ' + Name + ' is not set (4.6).' ); }
			return Env[ Name ];
		} );
	}
	if ( Array.isArray( Value ) )
	{
		return Value.map( function ( Item ) { return Resolve( Item, Env ); } );
	}
	if ( is_object( Value ) )
	{
		let copy = {};
		let keys = Object.keys( Value );
		for ( let index = 0; index < keys.length; index++ ) { copy[ keys[ index ] ] = Resolve( Value[ keys[ index ] ], Env ); }
		return copy;
	}
	return Value;
}


//---------------------------------------------------------------------
// An entry as written, for display: a deep copy which shares nothing with a resolved one.

function Mask( Entry )
{
	return JSON.parse( JSON.stringify( Entry ) );
}


//---------------------------------------------------------------------
module.exports = {
	REFERENCE_PATTERN: REFERENCE_PATTERN,
	References: References,
	IsSet: IsSet,
	Resolve: Resolve,
	Mask: Mask,
};
