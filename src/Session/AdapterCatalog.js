'use strict';

/*
	The adapter catalog: which adapters can open here, and what each one's settings are.

	Lifted from jsonx-studio's src/Studio/AdapterCatalog.js, which carries the reasoning about the
	two sources - the live jsonstor registry for names, the generated inventory for settings - and
	about walking an alias back to its package through AdapterFamilies rather than by prefix.

	***Adapters load lazily, which is the change from Studio.*** Loading one driver costs 126 ms for
	sqlite and 633 ms for oracle (measured 2026-09-13), so a command line which loaded every
	installed adapter would pay seconds on every invocation. A name is registered by trying the
	package the inventory names for it; only a name no inventory entry carries - an alias such as
	`jsonstor-valkey` - makes the catalog load every external package, once, and look again.

	***An adapter which is described but not installed is a warning, not an error.*** The file is
	not wrong: it is correct on a machine which has the package, as it is for an unset environment
	variable (spec 4.6). An adapter nobody describes and nothing registers is an error.
*/

const DATA = require( './AdapterCatalog.data.js' );


//---------------------------------------------------------------------
function is_object( Value )
{
	return ( Value !== null ) && ( typeof Value === 'object' ) && !Array.isArray( Value );
}


//---------------------------------------------------------------------
function families_intersect( Left, Right )
{
	if ( !Array.isArray( Left ) || !Array.isArray( Right ) ) { return false; }
	for ( let index = 0; index < Left.length; index++ )
	{
		if ( Right.includes( Left[ index ] ) ) { return true; }
	}
	return false;
}


//---------------------------------------------------------------------
// Options:
//		jsonstor   the instance adapters are registered into
//		Require    function ( PackageName ) -> plugin; `require` when absent
//		Data       the inventory; the generated file when absent

function NewAdapterCatalog( Options )
{
	let options = is_object( Options ) ? Options : {};

	let catalog = {
		jsonstor: options.jsonstor,
		Data: Array.isArray( options.Data ) ? options.Data : DATA,
		Require: ( typeof options.Require === 'function' ) ? options.Require : require,
		Report: { Loaded: [], NotInstalled: [], Failed: [] },
		Tried: [],
		AllLoaded: false,
	};

	if ( !catalog.jsonstor ) { throw new Error( 'An adapter catalog needs a jsonstor instance.' ); }


	//---------------------------------------------------------------------
	function registered( AdapterName )
	{
		return ( typeof catalog.jsonstor.Adapters[ AdapterName ] !== 'undefined' );
	}


	//---------------------------------------------------------------------
	function exact_entry( AdapterName )
	{
		for ( let index = 0; index < catalog.Data.length; index++ )
		{
			if ( catalog.Data[ index ].AdapterName === AdapterName ) { return catalog.Data[ index ]; }
		}
		return null;
	}


	//---------------------------------------------------------------------
	// Tries one package once. A missing module is a missing install; anything else is a failure,
	// because telling somebody to install what they have would send them the wrong way.

	function try_package( PackageName )
	{
		if ( catalog.Tried.includes( PackageName ) ) { return; }
		catalog.Tried.push( PackageName );

		let plugin = null;
		try
		{
			plugin = catalog.Require( PackageName );
		}
		catch ( error )
		{
			if ( error && error.code === 'MODULE_NOT_FOUND' && String( error.message ).includes( PackageName ) )
			{
				catalog.Report.NotInstalled.push( PackageName );
			}
			else
			{
				catalog.Report.Failed.push( { Package: PackageName, Message: error.message } );
			}
			return;
		}

		// ***LoadPlugin accepts a package which registers nothing, without complaint*** (measured
		// 2026-09-13), so a load is judged by the registry growing, not by the call returning.
		let before = Object.keys( catalog.jsonstor.Adapters ).length;
		try
		{
			catalog.jsonstor.LoadPlugin( plugin );
		}
		catch ( error )
		{
			catalog.Report.Failed.push( { Package: PackageName, Message: error.message } );
			return;
		}

		if ( Object.keys( catalog.jsonstor.Adapters ).length === before )
		{
			catalog.Report.Failed.push( { Package: PackageName, Message: 'The package loaded but registered no adapter.' } );
			return;
		}
		catalog.Report.Loaded.push( PackageName );
		return;
	}


	//---------------------------------------------------------------------
	function load_all()
	{
		if ( catalog.AllLoaded ) { return; }
		catalog.AllLoaded = true;
		for ( let index = 0; index < catalog.Data.length; index++ )
		{
			let entry = catalog.Data[ index ];
			if ( entry.Kind === 'external' && typeof entry.Package === 'string' ) { try_package( entry.Package ); }
		}
		return;
	}


	//---------------------------------------------------------------------
	// Registers an adapter name if it can be. Returns whether it is registered.

	catalog.Ensure = function ( AdapterName )
	{
		if ( registered( AdapterName ) ) { return true; }

		let entry = exact_entry( AdapterName );
		if ( entry !== null )
		{
			if ( entry.Kind === 'external' && typeof entry.Package === 'string' ) { try_package( entry.Package ); }
			return registered( AdapterName );
		}

		load_all();
		return registered( AdapterName );
	};


	//---------------------------------------------------------------------
	// The inventory entry describing whichever package serves a name, or null.

	catalog.Entry = function ( AdapterName )
	{
		let entry = exact_entry( AdapterName );
		if ( entry !== null ) { return entry; }

		let families = catalog.jsonstor.AdapterFamilies || {};
		let family = families[ AdapterName ];
		if ( !Array.isArray( family ) ) { return null; }

		for ( let index = 0; index < catalog.Data.length; index++ )
		{
			let candidate = catalog.Data[ index ];
			if ( families_intersect( family, families[ candidate.AdapterName ] ) ) { return candidate; }
		}
		return null;
	};


	//---------------------------------------------------------------------
	// The names of the settings which are file system paths, for a name.

	catalog.PathSettings = function ( AdapterName )
	{
		let entry = catalog.Entry( AdapterName );
		if ( entry === null ) { return []; }
		return entry.Settings
			.filter( function ( Setting ) { return Setting.Format === 'path'; } )
			.map( function ( Setting ) { return Setting.Name; } );
	};


	//---------------------------------------------------------------------
	// Findings for a data source's settings, with paths relative to the data source.

	catalog.ValidateSettings = function ( AdapterName, Settings )
	{
		let findings = [];
		let is_registered = catalog.Ensure( AdapterName );
		let entry = catalog.Entry( AdapterName );

		if ( !is_registered && entry === null )
		{
			findings.push( {
				Severity: 'error', Path: 'AdapterName',
				Message: 'No adapter is named [' + AdapterName + ']: nothing registers it and the adapter inventory does not describe it (4.1).',
			} );
			return findings;
		}

		if ( !is_registered )
		{
			findings.push( {
				Severity: 'warning', Path: 'AdapterName',
				Message: '[' + AdapterName + '] is not installed here; install ' + entry.Package + ' to open this data source (4.1).',
			} );
		}

		if ( entry === null ) { return findings; }

		let settings = is_object( Settings ) ? Settings : {};
		let declared = entry.Settings.map( function ( Setting ) { return Setting.Name; } );

		for ( let index = 0; index < entry.Settings.length; index++ )
		{
			let setting = entry.Settings[ index ];
			let value = settings[ setting.Name ];

			if ( typeof value === 'undefined' || value === null )
			{
				if ( setting.Required )
				{
					findings.push( {
						Severity: 'error', Path: 'Settings.' + setting.Name,
						Message: setting.Name + ' is required by ' + AdapterName + ': ' + setting.Description.replace( /\s+$/, '' ) + ' (4.1).',
					} );
				}
				continue;
			}

			if ( !type_agrees( setting.Type, value ) )
			{
				findings.push( {
					Severity: 'error', Path: 'Settings.' + setting.Name,
					Message: setting.Name + ' should be a ' + setting.Type + ' (4.1).',
				} );
			}
		}

		let keys = Object.keys( settings );
		for ( let index = 0; index < keys.length; index++ )
		{
			if ( declared.includes( keys[ index ] ) ) { continue; }
			findings.push( {
				Severity: 'warning', Path: 'Settings.' + keys[ index ],
				Message: keys[ index ] + ' is not a setting ' + AdapterName + ' describes (4.1).',
			} );
		}

		return findings;
	};


	return catalog;
}


//---------------------------------------------------------------------
// ***A string holding an environment reference agrees with any type***: its value is only known
// when the data source opens, and a number setting written `${env:PORT}` is the ordinary case.

function type_agrees( Type, Value )
{
	if ( typeof Value === 'string' && /\$\{env:[A-Za-z0-9_]+\}/.test( Value ) ) { return true; }
	if ( Type === 'string' ) { return ( typeof Value === 'string' ); }
	if ( Type === 'number' ) { return ( typeof Value === 'number' ); }
	if ( Type === 'boolean' ) { return ( typeof Value === 'boolean' ); }
	if ( Type === 'object' ) { return is_object( Value ); }
	if ( Type === 'array' ) { return Array.isArray( Value ); }
	return true;
}


//---------------------------------------------------------------------
module.exports = {
	DATA: DATA,
	NewAdapterCatalog: NewAdapterCatalog,
	type_agrees: type_agrees,
};
