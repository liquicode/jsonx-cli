'use strict';

/*
	The adapters a data source can name (plan F3.9): which exist, which are installed here, the
	names each package answers to, and a settings skeleton for one.

	***The inventory is the generated catalog*** (src/Session/AdapterCatalog.data.js, from
	jsonstor-docs/docs/data/adapters.js), so listing reads no package.

	***`List` loads nothing.*** Loading a driver costs 126 to 633 ms (measured 2026-09-13), so
	whether a package is installed is asked of the module resolver, never of `require`. The list is
	one row per package, as the adapter index is (versioned-adapters.md): an alias is a name a
	package answers to, not an adapter of its own.

	***The names a package answers to come from the package***, its `Adapters` (the primes) and
	`Aliases` exports, as the documentation generator reads them - the package owns its tables and
	the inventory does not carry them. Primes come first in measured-version order, then the aliases
	with the bare name first (build-adapter-docs.js `family_table`). A package not installed here
	cannot be asked, so its names are not listed.

	***A name finds its package without loading when it can***: the inventory's own names first,
	then its targets (`jsonstor-valkey-v7.2` is a target of the redis package). Only a name neither
	carries - the bare `jsonstor-valkey` - loads installed packages, one at a time, until one
	answers to it.
*/

const DATA = require( '../Session/AdapterCatalog.data.js' );
const AdapterCatalog = require( '../Session/AdapterCatalog.js' );


//---------------------------------------------------------------------
class AdaptersError extends Error
{
	constructor( Message )
	{
		super( Message );
		this.name = 'AdaptersError';
	}
}


//---------------------------------------------------------------------
function is_object( Value )
{
	return ( Value !== null ) && ( typeof Value === 'object' ) && !Array.isArray( Value );
}


//---------------------------------------------------------------------
// Options:
//		Data      the inventory; the generated catalog when absent
//		Require   function ( PackageName ) -> the package; `require` when absent
//		Resolve   function ( PackageName ) -> a path, throwing when not installed; require.resolve
//		          when absent

function NewAdapters( Options )
{
	let options = is_object( Options ) ? Options : {};
	let data = Array.isArray( options.Data ) ? options.Data : DATA;
	let load = ( typeof options.Require === 'function' ) ? options.Require : require;
	let resolve = ( typeof options.Resolve === 'function' ) ? options.Resolve : require.resolve;

	let adapters = { Data: data, Families: {} };


	//---------------------------------------------------------------------
	function installed( Entry )
	{
		if ( Entry.Kind === 'built-in' ) { return true; }
		try
		{
			resolve( Entry.Package );
			return true;
		}
		catch ( error )
		{
			return false;
		}
	}


	//---------------------------------------------------------------------
	// A package's primes and aliases, read from the package once. Null when it has no family, is not
	// installed, or fails to load.

	function family_of( Entry )
	{
		if ( Entry.Kind !== 'external' ) { return null; }
		if ( Object.prototype.hasOwnProperty.call( adapters.Families, Entry.Package ) ) { return adapters.Families[ Entry.Package ]; }

		let family = null;
		if ( installed( Entry ) )
		{
			try
			{
				let module_exports = load( Entry.Package );
				let primes = Array.isArray( module_exports.Adapters )
					? module_exports.Adapters.map( function ( Prime ) { return Prime.AdapterName; } )
					: [];
				let aliases = is_object( module_exports.Aliases ) ? module_exports.Aliases : {};
				if ( primes.length > 0 || Object.keys( aliases ).length > 0 ) { family = { Primes: primes, Aliases: aliases }; }
			}
			catch ( error )
			{
				family = null;
			}
		}
		adapters.Families[ Entry.Package ] = family;
		return family;
	}


	//---------------------------------------------------------------------
	// The inventory entry for a package name or any name it answers to, or null.

	function entry_for( Name )
	{
		for ( let index = 0; index < data.length; index++ )
		{
			if ( data[ index ].AdapterName === Name ) { return data[ index ]; }
		}
		for ( let index = 0; index < data.length; index++ )
		{
			let targets = Array.isArray( data[ index ].Targets ) ? data[ index ].Targets : [];
			for ( let target = 0; target < targets.length; target++ )
			{
				if ( targets[ target ].Name === Name ) { return data[ index ]; }
			}
		}
		for ( let index = 0; index < data.length; index++ )
		{
			let family = family_of( data[ index ] );
			if ( family === null ) { continue; }
			if ( family.Primes.includes( Name ) || Object.prototype.hasOwnProperty.call( family.Aliases, Name ) ) { return data[ index ]; }
		}
		return null;
	}


	//---------------------------------------------------------------------
	function required_entry( Name )
	{
		let entry = entry_for( Name );
		if ( entry === null )
		{
			throw new AdaptersError( 'No adapter answers to [' + Name + ']: the adapter inventory does not describe it, and no installed package registers it.' );
		}
		return entry;
	}


	//---------------------------------------------------------------------
	// The names a package answers to, primes first.

	function names_of( Entry )
	{
		let versions = {};
		let targets = Array.isArray( Entry.Targets ) ? Entry.Targets : [];
		for ( let index = 0; index < targets.length; index++ ) { versions[ targets[ index ].Name ] = targets[ index ].Version; }

		function measured( Name )
		{
			return Array.isArray( versions[ Name ] ) ? versions[ Name ].join( '.' ) : null;
		}

		let family = family_of( Entry );
		if ( family === null )
		{
			return [ { Name: Entry.AdapterName, AliasOf: null, MeasuredAgainst: measured( Entry.AdapterName ) } ];
		}

		let primes = family.Primes.slice().sort( function ( Left, Right )
		{
			let left = versions[ Left ] || [ 0, 0 ];
			let right = versions[ Right ] || [ 0, 0 ];
			return ( left[ 0 ] - right[ 0 ] ) || ( left[ 1 ] - right[ 1 ] );
		} );
		let aliases = Object.keys( family.Aliases ).sort( function ( Left, Right )
		{
			if ( Left === Entry.AdapterName ) { return -1; }
			if ( Right === Entry.AdapterName ) { return 1; }
			return Left.localeCompare( Right );
		} );

		return primes.map( function ( Name ) { return { Name: Name, AliasOf: null, MeasuredAgainst: measured( Name ) }; } )
			.concat( aliases.map( function ( Name ) { return { Name: Name, AliasOf: family.Aliases[ Name ], MeasuredAgainst: measured( Name ) }; } ) );
	}


	//---------------------------------------------------------------------
	// One row per package, in inventory order.

	adapters.List = function ()
	{
		return data.map( function ( Entry )
		{
			return { AdapterName: Entry.AdapterName, Kind: Entry.Kind, Package: Entry.Package, Installed: installed( Entry ), Description: Entry.Description };
		} );
	};


	//---------------------------------------------------------------------
	// Everything about the package serving a name.

	adapters.Info = function ( Name )
	{
		let entry = required_entry( Name );
		let is_installed = installed( entry );

		let info = {
			AdapterName: entry.AdapterName,
			Kind: entry.Kind,
			Package: entry.Package,
			Installed: is_installed,
			Description: entry.Description,
		};
		if ( Name !== entry.AdapterName ) { info.Requested = Name; }
		if ( is_object( entry.Driver ) ) { info.Driver = entry.Driver; }
		if ( is_installed ) { info.Names = names_of( entry ); }
		info.Settings = entry.Settings;
		return info;
	};


	//---------------------------------------------------------------------
	// A DataSources entry for a name, ready to add: every required setting as a placeholder of its
	// type, and every setting whose default is JSON of the right type, at that default.

	adapters.Settings = function ( Name, DataSourceName )
	{
		let entry = required_entry( Name );
		let settings = {};

		for ( let index = 0; index < entry.Settings.length; index++ )
		{
			let setting = entry.Settings[ index ];
			let parsed = parse_default( setting.Default );

			if ( parsed.Ok && AdapterCatalog.type_agrees( setting.Type, parsed.Value ) )
			{
				settings[ setting.Name ] = parsed.Value;
				continue;
			}
			if ( setting.Required ) { settings[ setting.Name ] = placeholder( setting.Type ); }
		}

		return {
			Name: ( typeof DataSourceName === 'string' && DataSourceName !== '' ) ? DataSourceName : 'New data source',
			AdapterName: Name,
			Settings: settings,
		};
	};


	return adapters;
}


//---------------------------------------------------------------------
// A default is display text in the inventory: `"_id"`, `false`, or `-` for none.

function parse_default( Text )
{
	if ( typeof Text !== 'string' || Text.trim() === '' || Text.trim() === '-' ) { return { Ok: false }; }
	try
	{
		return { Ok: true, Value: JSON.parse( Text ) };
	}
	catch ( error )
	{
		return { Ok: false };
	}
}


function placeholder( Type )
{
	if ( Type === 'number' ) { return 0; }
	if ( Type === 'boolean' ) { return false; }
	if ( Type === 'object' ) { return {}; }
	if ( Type === 'array' || ( typeof Type === 'string' && Type.endsWith( '[]' ) ) ) { return []; }
	return '';
}


//---------------------------------------------------------------------
module.exports = {
	AdaptersError: AdaptersError,
	NewAdapters: NewAdapters,
};
