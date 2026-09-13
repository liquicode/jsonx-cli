'use strict';

/*
	A session's data sources: a definition in the file, opened into a jsonstor storage when first
	needed.

	Lifted in mechanism from jsonx-studio's src/Studio/DataSources.js, which carries the reasoning:

	-	***A storage is cached because opening one connects.***
	-	***Release flushes***, because an adapter which buffers would otherwise lose what was
		written since its last flush.
	-	***The session's own filters are innermost***, against the adapter, and the filters the
		file declares stack over them in order. Studio measured that jsonstor applies a filter list
		inward out.

	***Opening happens in a fixed order***: the overrides (Overrides.js) give the definition, its
	environment references are resolved, its relative path settings are made relative to the
	jsonx file (user, 2026-09-13), then GetStorage. Nothing is opened before something asks, so a
	command which never touches a data source never connects to one.

	***A resolved definition is never kept or returned.*** It exists for the length of the
	GetStorage call; everything a caller can read is the definition as written.
*/

const LIB_PATH = require( 'path' );

const Environment = require( './Environment.js' );
const Overrides = require( './Overrides.js' );


//---------------------------------------------------------------------
class DataSourceError extends Error
{
	constructor( Message, Name )
	{
		super( Message );
		this.name = 'DataSourceError';
		this.DataSource = Name;
	}
}


//---------------------------------------------------------------------
function is_object( Value )
{
	return ( Value !== null ) && ( typeof Value === 'object' ) && !Array.isArray( Value );
}


//---------------------------------------------------------------------
// Options:
//		Document       the jsonx file
//		FilePath       where the file is; relative path settings are relative to its directory
//		Binds, Sets    the override tokens (Overrides.js)
//		Cwd            where the command was typed, for override paths
//		Env            the environment variables
//		jsonstor       the instance storages are built from
//		Catalog        an AdapterCatalog over that instance
//		InnerFilters   function ( Name, Definition ) -> filter entries placed nearest the adapter

function NewDataSources( Options )
{
	let options = is_object( Options ) ? Options : {};
	if ( !options.jsonstor ) { throw new Error( 'Data sources need a jsonstor instance.' ); }
	if ( !options.Catalog ) { throw new Error( 'Data sources need an adapter catalog.' ); }

	let cwd = ( typeof options.Cwd === 'string' ) ? options.Cwd : process.cwd();
	let base_directory = ( typeof options.FilePath === 'string' ) ? LIB_PATH.dirname( options.FilePath ) : cwd;

	let sources = {
		Definitions: Overrides.Apply( options.Document, options.Binds, options.Sets, cwd, options.Catalog.PathSettings ),
		Cache: {},
	};


	//---------------------------------------------------------------------
	// The definition of a data source as this session sees it: the file's entry with the overrides
	// applied, environment references unresolved. A copy.

	sources.Definition = function ( Name )
	{
		if ( !Object.prototype.hasOwnProperty.call( sources.Definitions, Name ) )
		{
			throw new DataSourceError( 'No data source is named [' + Name + '] (3.8).', Name );
		}
		return Environment.Mask( sources.Definitions[ Name ] );
	};


	//---------------------------------------------------------------------
	// The names of the data sources defined.

	sources.Names = function ()
	{
		return Object.keys( sources.Definitions );
	};


	//---------------------------------------------------------------------
	// The settings an adapter is handed: environment references resolved, relative paths made
	// relative to the file.

	function prepared_settings( Definition )
	{
		let settings = is_object( Definition.Settings ) ? Definition.Settings : {};
		let resolved = Environment.Resolve( settings, options.Env || {} );

		let paths = options.Catalog.PathSettings( Definition.AdapterName );
		for ( let index = 0; index < paths.length; index++ )
		{
			let key = paths[ index ];
			if ( Overrides.IsRelativePath( resolved[ key ] ) )
			{
				resolved[ key ] = LIB_PATH.resolve( base_directory, resolved[ key ] );
			}
		}
		return resolved;
	}


	//---------------------------------------------------------------------
	function prepared_filters( Name, Definition )
	{
		let filters = [];

		if ( typeof options.InnerFilters === 'function' )
		{
			let inner = options.InnerFilters( Name, Definition );
			if ( Array.isArray( inner ) ) { filters = filters.concat( inner ); }
		}

		if ( Array.isArray( Definition.Filters ) )
		{
			for ( let index = 0; index < Definition.Filters.length; index++ )
			{
				let filter = Definition.Filters[ index ];
				filters.push( {
					FilterName: filter.FilterName,
					Settings: Environment.Resolve( is_object( filter.Settings ) ? filter.Settings : {}, options.Env || {} ),
				} );
			}
		}
		return filters;
	}


	//---------------------------------------------------------------------
	// The storage for a data source, opened if it is not already held.
	//
	// Throws DataSourceError when it cannot be opened: no such name, an unset environment
	// variable, an adapter not installed, or the adapter refusing.

	sources.Open = function ( Name )
	{
		if ( Object.prototype.hasOwnProperty.call( sources.Cache, Name ) ) { return sources.Cache[ Name ].Storage; }

		let definition = sources.Definitions[ Name ];
		if ( !definition ) { throw new DataSourceError( 'No data source is named [' + Name + '] (3.8).', Name ); }

		if ( !options.Catalog.Ensure( definition.AdapterName ) )
		{
			let entry = options.Catalog.Entry( definition.AdapterName );
			let hint = ( entry && entry.Package ) ? ' Install ' + entry.Package + '.' : '';
			throw new DataSourceError( 'The data source [' + Name + '] cannot open: the adapter [' + definition.AdapterName + '] is not installed here.' + hint, Name );
		}

		let storage = null;
		try
		{
			storage = options.jsonstor.GetStorage( definition.AdapterName, prepared_settings( definition ), prepared_filters( Name, definition ) );
		}
		catch ( error )
		{
			throw new DataSourceError( 'The data source [' + Name + '] cannot open: ' + error.message, Name );
		}

		sources.Cache[ Name ] = {
			Name: Name,
			Storage: storage,
			Opened: ( new Date() ).toISOString(),
		};
		return storage;
	};


	//---------------------------------------------------------------------
	// Which data sources are open, in the order they opened.

	sources.Opened = function ()
	{
		return Object.keys( sources.Cache );
	};


	//---------------------------------------------------------------------
	// Everything open, flushed and dropped. A storage with nothing to flush is not a failure.

	sources.Release = async function ()
	{
		let names = Object.keys( sources.Cache );
		for ( let index = 0; index < names.length; index++ )
		{
			let held = sources.Cache[ names[ index ] ];
			try { await held.Storage.FlushStorage(); }
			catch ( error ) { /* nothing to flush */ }
			delete sources.Cache[ names[ index ] ];
		}
		return names.length;
	};


	return sources;
}


//---------------------------------------------------------------------
module.exports = {
	DataSourceError: DataSourceError,
	NewDataSources: NewDataSources,
};
