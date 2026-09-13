'use strict';

/*
	Session overrides of declared data sources: `--bind` and `--set` (plan F2.3).

		--bind Name=adapter             replace a data source's adapter, with no settings
		--bind Name=adapter:{json}      replace its adapter and its settings
		--set  Name.Settings.Path=value set one setting (the value read as JSON, else a string)
		--set  Name.AdapterName=adapter change only the adapter

	***An override never creates a name.*** Every name a file uses is defined in the file (spec
	3.8); an override points a defined data source somewhere else for one session - a test copy of
	a database, a scratch file - and naming anything the file does not define is a usage error.

	***A path typed on the command line is relative to where it was typed.*** A path setting in the
	file is relative to the file (user, 2026-09-13), but somebody typing `--set
	Bookings.Settings.Path=copy.json` means the copy in front of them, so an override's path value
	is made absolute against the working directory here, and the file-relative rule then leaves it
	alone.
*/

const LIB_PATH = require( 'path' );


//---------------------------------------------------------------------
class OverrideError extends Error
{
	constructor( Message )
	{
		super( Message );
		this.name = 'OverrideError';
	}
}


//---------------------------------------------------------------------
function is_object( Value )
{
	return ( Value !== null ) && ( typeof Value === 'object' ) && !Array.isArray( Value );
}


//---------------------------------------------------------------------
// Whether a setting value is a relative file system path which a base directory applies to.
//
// Not a path: an empty string, an absolute path, a special name beginning with a colon
// (`:memory:`), a URL, or a string holding an environment reference (resolved later).

function IsRelativePath( Value )
{
	if ( typeof Value !== 'string' || Value === '' ) { return false; }
	if ( Value.startsWith( ':' ) ) { return false; }
	if ( /^[A-Za-z][A-Za-z0-9+.-]*:\/\//.test( Value ) ) { return false; }
	if ( LIB_PATH.isAbsolute( Value ) ) { return false; }
	return true;
}


//---------------------------------------------------------------------
function read_value( Text )
{
	try { return JSON.parse( Text ); }
	catch ( error ) { return Text; }
}


//---------------------------------------------------------------------
// The declared data source a --set target begins with: the longest name followed by a dot.

function target_source( Names, Target )
{
	let best = null;
	for ( let index = 0; index < Names.length; index++ )
	{
		let name = Names[ index ];
		if ( !Target.startsWith( name + '.' ) ) { continue; }
		if ( best === null || name.length > best.length ) { best = name; }
	}
	return best;
}


//---------------------------------------------------------------------
function set_path( Object_, Parts, Value )
{
	let node = Object_;
	for ( let index = 0; index < Parts.length - 1; index++ )
	{
		if ( !is_object( node[ Parts[ index ] ] ) ) { node[ Parts[ index ] ] = {}; }
		node = node[ Parts[ index ] ];
	}
	node[ Parts[ Parts.length - 1 ] ] = Value;
	return;
}


//---------------------------------------------------------------------
// The data source definitions of a file with the overrides applied.
//
// Returns { Name: definition } for every declared data source, each a copy. Throws OverrideError.
//
//		Binds          [ 'Name=adapter[:json]', ... ]
//		Sets           [ 'Name.Settings.Key=value', ... ]
//		Cwd            where the command was typed
//		PathSettings   function ( AdapterName ) -> the names of its path settings

function Apply( Document, Binds, Sets, Cwd, PathSettings )
{
	let definitions = {};
	let names = [];
	let list = ( is_object( Document ) && Array.isArray( Document.DataSources ) ) ? Document.DataSources : [];
	for ( let index = 0; index < list.length; index++ )
	{
		let entry = list[ index ];
		if ( !is_object( entry ) || typeof entry.Name !== 'string' ) { continue; }
		if ( Object.prototype.hasOwnProperty.call( definitions, entry.Name ) ) { continue; }
		definitions[ entry.Name ] = JSON.parse( JSON.stringify( entry ) );
		names.push( entry.Name );
	}

	let cwd = ( typeof Cwd === 'string' ) ? Cwd : process.cwd();
	let path_settings = ( typeof PathSettings === 'function' ) ? PathSettings : function () { return []; };

	function absolute_paths( Definition, Keys )
	{
		let paths = path_settings( Definition.AdapterName );
		if ( !is_object( Definition.Settings ) ) { return; }
		for ( let index = 0; index < Keys.length; index++ )
		{
			let key = Keys[ index ];
			if ( paths.includes( key ) && IsRelativePath( Definition.Settings[ key ] ) && !/\$\{env:/.test( Definition.Settings[ key ] ) )
			{
				Definition.Settings[ key ] = LIB_PATH.resolve( cwd, Definition.Settings[ key ] );
			}
		}
		return;
	}

	let binds = Array.isArray( Binds ) ? Binds : [];
	for ( let index = 0; index < binds.length; index++ )
	{
		let token = binds[ index ];
		let equals_at = token.indexOf( '=' );
		if ( equals_at <= 0 ) { throw new OverrideError( '--bind [' + token + '] must be Name=adapter or Name=adapter:{settings}.' ); }

		let name = token.slice( 0, equals_at );
		let rest = token.slice( equals_at + 1 );
		if ( !Object.prototype.hasOwnProperty.call( definitions, name ) )
		{
			throw new OverrideError( '--bind names [' + name + '], which is not a data source of this file; an override never creates a name.' );
		}

		let colon_at = rest.indexOf( ':' );
		let adapter = ( colon_at < 0 ) ? rest : rest.slice( 0, colon_at );
		if ( adapter === '' ) { throw new OverrideError( '--bind [' + token + '] names no adapter.' ); }

		let settings = {};
		if ( colon_at >= 0 )
		{
			try { settings = JSON.parse( rest.slice( colon_at + 1 ) ); }
			catch ( error ) { throw new OverrideError( '--bind [' + name + '] settings are not valid JSON: ' + error.message ); }
			if ( !is_object( settings ) ) { throw new OverrideError( '--bind [' + name + '] settings must be a JSON object.' ); }
		}

		definitions[ name ].AdapterName = adapter;
		definitions[ name ].Settings = settings;
		absolute_paths( definitions[ name ], Object.keys( settings ) );
	}

	let sets = Array.isArray( Sets ) ? Sets : [];
	for ( let index = 0; index < sets.length; index++ )
	{
		let token = sets[ index ];
		let equals_at = token.indexOf( '=' );
		if ( equals_at <= 0 ) { throw new OverrideError( '--set [' + token + '] must be Name.Settings.Key=value.' ); }

		let target = token.slice( 0, equals_at );
		let value = read_value( token.slice( equals_at + 1 ) );
		let name = target_source( names, target );
		if ( name === null )
		{
			throw new OverrideError( '--set [' + target + '] does not begin with a data source of this file; an override never creates a name.' );
		}

		let field = target.slice( name.length + 1 );
		let definition = definitions[ name ];

		if ( field === 'AdapterName' )
		{
			if ( typeof value !== 'string' || value === '' ) { throw new OverrideError( '--set [' + target + '] needs an adapter name.' ); }
			definition.AdapterName = value;
			continue;
		}

		if ( !field.startsWith( 'Settings.' ) || field.length <= 'Settings.'.length )
		{
			throw new OverrideError( '--set [' + target + '] can change ' + name + '.AdapterName or ' + name + '.Settings.<key>, not ' + field + '.' );
		}

		if ( !is_object( definition.Settings ) ) { definition.Settings = {}; }
		let parts = field.slice( 'Settings.'.length ).split( '.' );
		set_path( definition.Settings, parts, value );
		if ( parts.length === 1 ) { absolute_paths( definition, parts ); }
	}

	return definitions;
}


//---------------------------------------------------------------------
module.exports = {
	OverrideError: OverrideError,
	IsRelativePath: IsRelativePath,
	Apply: Apply,
};
