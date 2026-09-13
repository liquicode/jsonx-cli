'use strict';

/*
	Generates src/Session/AdapterCatalog.data.js from the family's adapter inventory.

	***An adapter is described in exactly one place, jsonstor-docs/docs/data/adapters.js.*** Copied
	in shape from jsonx-studio's build script, which carries the reasoning: the hub is read at
	build time and the result is committed, because jsonstor-docs is private and nothing in the
	family depends on it at run time.

	***`Format: 'path'` is carried through***, because a session rewrites a relative path setting
	to be relative to the jsonx file (user, 2026-09-13), and this marker is how it knows which
	settings are paths.

	Run it from the repository root, inside the jsonx workspace:

		npm run build-adapter-catalog
*/

const LIB_FS = require( 'fs' );
const LIB_PATH = require( 'path' );


const HUB_INVENTORY = LIB_PATH.join( __dirname, '..', '..', 'jsonstor-docs.git', 'docs', 'data', 'adapters.js' );
const OUTPUT_FILE = LIB_PATH.join( __dirname, '..', 'src', 'Session', 'AdapterCatalog.data.js' );


//---------------------------------------------------------------------
// What a session takes from an adapter entry: what a data source definition needs, and nothing
// of the family's test plumbing.

function adapter_entry( Adapter )
{
	let entry = {
		AdapterName: Adapter.AdapterName,
		Description: Adapter.Description,
		Kind: Adapter.Kind,
		Package: Adapter.Package,
		Settings: [],
	};

	if ( Adapter.Browser === true ) { entry.Browser = true; }

	if ( Array.isArray( Adapter.Settings ) )
	{
		for ( let setting_index = 0; setting_index < Adapter.Settings.length; setting_index++ )
		{
			let setting = Adapter.Settings[ setting_index ];
			let item = {
				Name: setting.Name,
				Type: setting.Type,
				Required: ( setting.Required === true ),
				Default: setting.Default,
				Description: setting.Description,
			};
			if ( typeof setting.Format === 'string' ) { item.Format = setting.Format; }
			entry.Settings.push( item );
		}
	}

	return entry;
}


//---------------------------------------------------------------------
function build()
{
	if ( !LIB_FS.existsSync( HUB_INVENTORY ) )
	{
		console.error( 'The adapter inventory was not found at:' );
		console.error( '    ' + HUB_INVENTORY );
		console.error( 'Run this from inside the jsonx workspace, beside jsonstor-docs.git.' );
		process.exitCode = 1;
		return;
	}

	let inventory = require( HUB_INVENTORY );
	let adapters = Array.isArray( inventory ) ? inventory : inventory.Adapters;
	if ( !Array.isArray( adapters ) )
	{
		console.error( 'The adapter inventory did not export an array of adapters.' );
		process.exitCode = 1;
		return;
	}

	let entries = adapters.map( adapter_entry );

	let lines = [
		'\'use strict\';',
		'',
		'/*',
		'\tThe adapter settings inventory.',
		'',
		'\t***GENERATED FILE. Do not edit it.*** Written by build/build-adapter-catalog.js from',
		'\tjsonstor-docs/docs/data/adapters.js, the one place an adapter is described.',
		'',
		'\t\tnpm run build-adapter-catalog',
		'*/',
		'',
		'module.exports = ' + JSON.stringify( entries, null, '\t' ) + ';',
		'',
	];
	LIB_FS.writeFileSync( OUTPUT_FILE, lines.join( '\n' ), 'utf8' );

	let setting_count = 0;
	let path_count = 0;
	for ( let index = 0; index < entries.length; index++ )
	{
		setting_count += entries[ index ].Settings.length;
		path_count += entries[ index ].Settings.filter( function ( Setting ) { return Setting.Format === 'path'; } ).length;
	}
	console.log( 'Wrote ' + entries.length + ' adapters, ' + setting_count + ' settings (' + path_count + ' paths) to:' );
	console.log( '    ' + OUTPUT_FILE );
	return;
}


build();
