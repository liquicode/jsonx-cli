'use strict';

/*
	Checks that the type declaration and the ESM wrapper both describe the library which is
	actually running.

	***Both of those files are written by hand, and both drift silently.*** Copied in shape from
	jsonproc's build/types-check.js, which carries the full reasoning. Three rules:

		1. Every library member is declared on the JsonxCliLibrary interface.
		2. Every declared member exists on the library.
		3. Every library member is re-exported by src/jsonx-cli.mjs and declared as a named
		   export.

	There are no deliberate exclusions yet. When one is needed it is named here, as jsonproc
	names OpLog and OpError, rather than inferred.

	Usage:
		npm run types-check
*/

const LIB_FS = require( 'fs' );
const LIB_PATH = require( 'path' );

const REPO = LIB_PATH.resolve( __dirname, '..' );
const LIBRARY_FILE = LIB_PATH.join( REPO, 'src', 'jsonx-cli.js' );
const WRAPPER_FILE = LIB_PATH.join( REPO, 'src', 'jsonx-cli.mjs' );
const TYPES_FILE = LIB_PATH.join( REPO, 'types', 'jsonx-cli.d.ts' );


//---------------------------------------------------------------------
function read_library_members()
{
	let library = require( LIBRARY_FILE );
	return Object.keys( library );
}


//---------------------------------------------------------------------
// The members declared on the JsonxCliLibrary interface: one tab in for the interface, two for
// its members, read by indentation rather than by understanding TypeScript.

function read_declared_members()
{
	let text = LIB_FS.readFileSync( TYPES_FILE, 'utf8' );
	let lines = text.split( /\r?\n/ );

	let members = [];
	let inside = false;

	for ( let index = 0; index < lines.length; index++ )
	{
		let line = lines[ index ];

		if ( inside === false )
		{
			if ( /^\texport interface JsonxCliLibrary\b/.test( line ) ) { inside = true; }
			continue;
		}

		if ( line === '\t}' ) { break; }

		let found = line.match( /^\t\t([A-Za-z_][A-Za-z0-9_]*)\s*[(<:]/ );
		if ( found ) { members.push( found[ 1 ] ); }
	}

	return members;
}


//---------------------------------------------------------------------
function read_names( File, Pattern )
{
	let text = LIB_FS.readFileSync( File, 'utf8' );
	let names = [];
	let found = Pattern.exec( text );
	while ( found !== null )
	{
		names.push( found[ 1 ] );
		found = Pattern.exec( text );
	}
	return names;
}


//---------------------------------------------------------------------
function missing_from( ListA, ListB )
{
	let missing = [];
	for ( let index = 0; index < ListA.length; index++ )
	{
		if ( ListB.includes( ListA[ index ] ) === false ) { missing.push( ListA[ index ] ); }
	}
	return missing;
}


//---------------------------------------------------------------------
function Check()
{
	let library_members = read_library_members();
	let declared_members = read_declared_members();
	let declared_exports = read_names( TYPES_FILE, /^\texport const ([A-Za-z_][A-Za-z0-9_]*)\s*:/gm );
	let wrapper_exports = read_names( WRAPPER_FILE, /^export const ([A-Za-z_][A-Za-z0-9_]*)\s*=/gm );

	let findings = [];

	function report( Message, Names )
	{
		if ( Names.length === 0 ) { return; }
		findings.push( { Message: Message, Names: Names } );
	}

	report( 'On the library but not declared in the JsonxCliLibrary interface', missing_from( library_members, declared_members ) );
	report( 'Declared in the JsonxCliLibrary interface but not on the library', missing_from( declared_members, library_members ) );
	report( 'On the library but not re-exported by src/jsonx-cli.mjs', missing_from( library_members, wrapper_exports ) );
	report( 'Re-exported by src/jsonx-cli.mjs but not on the library', missing_from( wrapper_exports, library_members ) );
	report( 'On the library but not declared as a named export in the .d.ts', missing_from( library_members, declared_exports ) );
	report( 'Declared as a named export in the .d.ts but not on the library', missing_from( declared_exports, library_members ) );

	return {
		LibraryMembers: library_members,
		DeclaredMembers: declared_members,
		DeclaredExports: declared_exports,
		WrapperExports: wrapper_exports,
		Findings: findings,
	};
}


//---------------------------------------------------------------------
function main()
{
	let result = Check();

	console.log( '' );
	console.log( 'Types Check' );
	console.log( '' );
	console.log( `   library members               : ${result.LibraryMembers.length}` );
	console.log( `   declared on the interface     : ${result.DeclaredMembers.length}` );
	console.log( `   named exports in the .d.ts    : ${result.DeclaredExports.length}` );
	console.log( `   re-exported by jsonx-cli.mjs  : ${result.WrapperExports.length}` );
	console.log( '' );

	if ( result.Findings.length === 0 )
	{
		console.log( '   The library, the declaration, and the ESM wrapper agree.' );
		console.log( '' );
		return;
	}

	for ( let index = 0; index < result.Findings.length; index++ )
	{
		let finding = result.Findings[ index ];
		console.log( `   ${finding.Message}:` );
		console.log( `      ${finding.Names.join( ', ' )}` );
	}
	console.log( '' );

	process.exitCode = 1;
}


//---------------------------------------------------------------------
module.exports = {
	Check: Check,
};

if ( require.main === module ) { main(); }
